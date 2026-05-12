import { ipcMain } from 'electron'
import { BondClient } from './bondClient'
import { subscribeBpup, type BpupSubscription } from './bpup'
import { startDiscovery, type DiscoveryHandle } from './discovery'
import { DeviceCache } from './deviceCache'
import { startLearnSession, assignCapturedSignal, type LearnSession } from './learn'
import { makeListDevicesTool, makeTogglePowerTool } from './tools'
import {
  EMPTY_BOND_SETTINGS,
  type BondBridgeRecord,
  type BondRoom,
  type BondScene,
  type BondSettings,
  type BridgeRuntimeStatus,
  type CapturedSignal,
  type DiscoveredBridge
} from './types'
import type { ExtensionMainContext } from '../../../../ProjectRose/src/shared/extension-contract'

// IPC channel constants — keep in sync with src/renderer/lib/api.ts
const CH = {
  // Bridges
  BRIDGES_LIST:        'rose-bond:bridges.list',
  BRIDGES_DISCOVER:    'rose-bond:bridges.discover',
  BRIDGES_VERIFY:      'rose-bond:bridges.verify',
  BRIDGES_ADD:         'rose-bond:bridges.add',
  BRIDGES_REMOVE:      'rose-bond:bridges.remove',
  BRIDGES_RENAME:      'rose-bond:bridges.rename',
  BRIDGES_UPDATE_TOKEN: 'rose-bond:bridges.updateToken',
  // Devices
  DEVICES_LIST:        'rose-bond:devices.list',
  DEVICES_TOGGLE:      'rose-bond:devices.toggle',
  DEVICE_OVERRIDE:     'rose-bond:devices.override',
  DEVICE_REFRESH:      'rose-bond:devices.refresh',
  DEVICE_DELETE:       'rose-bond:devices.delete',
  // Rooms
  ROOMS_UPSERT:        'rose-bond:rooms.upsert',
  ROOMS_REMOVE:        'rose-bond:rooms.remove',
  ROOMS_LIST:          'rose-bond:rooms.list',
  // Scenes
  SCENES_UPSERT:       'rose-bond:scenes.upsert',
  SCENES_REMOVE:       'rose-bond:scenes.remove',
  SCENES_LIST:         'rose-bond:scenes.list',
  SCENES_RUN:          'rose-bond:scenes.run',
  // Learn
  LEARN_START:         'rose-bond:learn.start',
  LEARN_STOP:          'rose-bond:learn.stop',
  LEARN_ASSIGN:        'rose-bond:learn.assign',
  // Settings
  SETTINGS_GET:        'rose-bond:settings.get'
} as const

// Broadcast channels (events from main → renderer)
const BC = {
  BRIDGE_STATUS:       'rose-bond:bridge.status',
  DEVICES_CHANGED:     'rose-bond:devices.changed',
  DISCOVERED:          'rose-bond:bridges.discovered',
  LEARN_CAPTURED:      'rose-bond:learn.captured',
  LEARN_STATUS:        'rose-bond:learn.status',
  SETTINGS_CHANGED:    'rose-bond:settings.changed'
} as const

const ALL_INVOKE_CHANNELS = Object.values(CH)

interface BridgeRuntime {
  client: BondClient
  bpup: BpupSubscription | null
  status: BridgeRuntimeStatus
}

export function registerBondHandlers(ctx: ExtensionMainContext): () => void {
  const cache = new DeviceCache()
  const bridges = new Map<string, BridgeRuntime>()  // bondid → runtime
  const learnSessions = new Map<string, LearnSession>() // bondid → active session
  let settings: BondSettings = { ...EMPTY_BOND_SETTINGS }
  let discovery: DiscoveryHandle | null = null
  let stopDiscoveryListener: (() => void) | null = null

  // ---- Settings I/O -------------------------------------------------------
  async function loadSettings(): Promise<void> {
    const raw = await ctx.getSettings()
    const stored = raw['bond'] as Partial<BondSettings> | undefined
    const { scenes, dirty } = migrateScenes(stored?.scenes ?? [])
    settings = {
      bridges:         stored?.bridges ?? [],
      rooms:           stored?.rooms ?? [],
      scenes,
      deviceOverrides: stored?.deviceOverrides ?? {}
    }
    if (dirty) await saveSettings()
  }

  // One-time migration: legacy scene steps used `kind: 'action'` with an
  // arbitrary action name. The simplified model only knows toggle + delay, so
  // collapse every action step (TurnOn/TurnOff/SetSpeed/etc.) into a toggle.
  function migrateScenes(stored: BondScene[]): { scenes: BondScene[]; dirty: boolean } {
    let dirty = false
    const scenes = stored.map((scene) => {
      const newSteps = scene.steps.flatMap((step) => {
        if (step.kind === 'delay' || step.kind === 'toggle') return [step]
        const legacy = step as unknown as { bondid?: string; deviceId?: string }
        if (legacy.bondid && legacy.deviceId) {
          dirty = true
          return [{ kind: 'toggle' as const, bondid: legacy.bondid, deviceId: legacy.deviceId }]
        }
        dirty = true
        return []
      })
      return { ...scene, steps: newSteps }
    })
    return { scenes, dirty }
  }

  async function saveSettings(): Promise<void> {
    await ctx.updateSettings({ bond: settings })
    ctx.broadcast(BC.SETTINGS_CHANGED, { settings: redactedSettings(settings) })
  }

  // ---- Bridge runtime -----------------------------------------------------
  function bridgeStatus(bondid: string): BridgeRuntimeStatus {
    return bridges.get(bondid)?.status ?? {
      bondid, online: false, lastSeenMs: 0, bpup: 'unknown'
    }
  }

  function emitBridgeStatus(bondid: string): void {
    ctx.broadcast(BC.BRIDGE_STATUS, bridgeStatus(bondid))
  }

  async function refreshBridgeDevices(bondid: string): Promise<void> {
    const rt = bridges.get(bondid)
    if (!rt) return
    try {
      const ids = await rt.client.listDeviceIds()
      // Drop devices that no longer exist on the bridge
      const stale = cache.listForBridge(bondid)
        .filter((e) => !ids.includes(e.meta.deviceId))
      for (const s of stale) cache.remove(bondid, s.meta.deviceId)

      for (const id of ids) {
        try {
          const meta = await rt.client.getDevice(id)
          cache.upsertMeta(bondid, id, {
            type: meta.type ?? 'GX',
            name: meta.name ?? id,
            bondReportedName: meta.name ?? id,
            actions: meta.actions ?? []
          })
        } catch (err) {
          console.warn(`[rose-bond] refresh device ${bondid}:${id} failed:`, (err as Error).message)
        }
      }
      ctx.broadcast(BC.DEVICES_CHANGED, { bondid })
    } catch (err) {
      console.warn(`[rose-bond] refresh bridge ${bondid} failed:`, (err as Error).message)
      cache.setOnline(bondid, false)
      const rt2 = bridges.get(bondid)
      if (rt2) {
        rt2.status.online = false
        emitBridgeStatus(bondid)
      }
    }
  }

  function attachBpup(bondid: string): void {
    const rt = bridges.get(bondid)
    if (!rt) return
    rt.bpup?.stop()
    const sub = subscribeBpup(bondid, rt.client.ip, {
      onAck: (b) => {
        const r = bridges.get(b)
        if (!r) return
        r.status.online = true
        r.status.bpup = 'connected'
        r.status.lastSeenMs = Date.now()
        cache.setOnline(b, true)
        emitBridgeStatus(b)
      },
      onFallback: (b, reason) => {
        console.warn(`[rose-bond] BPUP fallback for ${b}: ${reason}`)
        const r = bridges.get(b)
        if (r) {
          r.status.bpup = 'polling-fallback'
          emitBridgeStatus(b)
        }
        ctx.notifyStatus?.(`Bond ${bridgeName(b)}: live updates unavailable`, { tone: 'warning', durationMs: 4000 })
      }
    })
    rt.bpup = sub
    if (sub) {
      rt.status.bpup = 'unknown'  // pending ack
    } else {
      rt.status.bpup = 'polling-fallback'
    }
    emitBridgeStatus(bondid)
  }

  function bridgeName(bondid: string): string {
    return settings.bridges.find((b) => b.bondid === bondid)?.name ?? bondid
  }

  async function connectBridge(record: BondBridgeRecord, ip: string): Promise<void> {
    const existing = bridges.get(record.bondid)
    if (existing) {
      existing.bpup?.stop()
    }
    const client = new BondClient(record.bondid, ip, record.token)
    const status: BridgeRuntimeStatus = {
      bondid: record.bondid, online: false, ip, lastSeenMs: 0, bpup: 'unknown'
    }
    const rt: BridgeRuntime = { client, bpup: null, status }
    bridges.set(record.bondid, rt)

    try {
      const v = await client.getVersion()
      // Trust the bridge's reported bondid if it differs (rare DHCP/firmware quirks)
      if (v.bondid && v.bondid.toUpperCase() !== record.bondid.toUpperCase()) {
        console.warn(`[rose-bond] bondid mismatch: stored ${record.bondid}, returned ${v.bondid}`)
      }
      status.online = true
      status.lastSeenMs = Date.now()
      emitBridgeStatus(record.bondid)
    } catch (err) {
      console.warn(`[rose-bond] connect ${record.bondid} version check failed:`, (err as Error).message)
      status.online = false
      emitBridgeStatus(record.bondid)
      // Don't return — still attach BPUP, the bridge may come back.
    }

    attachBpup(record.bondid)
    await refreshBridgeDevices(record.bondid)
  }

  function disconnectBridge(bondid: string): void {
    const rt = bridges.get(bondid)
    if (!rt) return
    rt.bpup?.stop()
    bridges.delete(bondid)
    cache.removeAllForBridge(bondid)
    learnSessions.get(bondid)?.stop()
    learnSessions.delete(bondid)
    emitBridgeStatus(bondid)
    ctx.broadcast(BC.DEVICES_CHANGED, { bondid })
  }

  async function resolveIpForBridge(record: BondBridgeRecord): Promise<string | null> {
    if (discovery) {
      const found = await discovery.resolveBondid(record.bondid, 5_000)
      if (found) return found.ip
    }
    if (record.lastIp) {
      // Verify lastIp still hosts the bridge
      const tester = new BondClient(record.bondid, record.lastIp, record.token)
      try {
        await tester.getVersion()
        return record.lastIp
      } catch { /* fall through */ }
    }
    return null
  }

  async function connectAllSavedBridges(): Promise<void> {
    for (const record of settings.bridges) {
      const ip = await resolveIpForBridge(record)
      if (!ip) {
        console.warn(`[rose-bond] could not resolve IP for ${record.bondid}; bridge will appear offline.`)
        const status: BridgeRuntimeStatus = {
          bondid: record.bondid, online: false, lastSeenMs: 0, bpup: 'unknown'
        }
        bridges.set(record.bondid, {
          client: new BondClient(record.bondid, record.lastIp ?? '0.0.0.0', record.token),
          bpup: null,
          status
        })
        emitBridgeStatus(record.bondid)
        continue
      }
      if (record.lastIp !== ip) {
        record.lastIp = ip
        await saveSettings()
      }
      await connectBridge(record, ip)
    }
  }

  // ---- Discovery ---------------------------------------------------------

  function ensureDiscovery(): DiscoveryHandle {
    if (discovery) return discovery
    discovery = startDiscovery()
    stopDiscoveryListener = discovery.onChange((list) => {
      ctx.broadcast(BC.DISCOVERED, { bridges: list })
      // Opportunistically update lastIp for already-saved bridges that move IPs.
      let dirty = false
      for (const found of list) {
        const saved = settings.bridges.find((b) => b.bondid === found.bondid)
        if (saved && saved.lastIp !== found.ip) {
          saved.lastIp = found.ip
          dirty = true
          // If the bridge is offline, try reconnecting at the new IP.
          const rt = bridges.get(saved.bondid)
          if (rt && (!rt.status.online || rt.client.ip !== found.ip)) {
            rt.client.ip = found.ip
            rt.status.ip = found.ip
            attachBpup(saved.bondid)
            void refreshBridgeDevices(saved.bondid)
          }
        }
      }
      if (dirty) void saveSettings()
    })
    return discovery
  }

  // ---- Tool registration -------------------------------------------------

  ctx.registerTools([
    makeListDevicesTool({
      cache,
      getSettings: () => settings,
      bridges: () => settings.bridges,
      clientFor: (bondid) => bridges.get(bondid)?.client ?? null
    }),
    makeTogglePowerTool({
      cache,
      getSettings: () => settings,
      bridges: () => settings.bridges,
      clientFor: (bondid) => bridges.get(bondid)?.client ?? null
    })
  ])

  // ---- IPC handlers ------------------------------------------------------

  ipcMain.handle(CH.SETTINGS_GET, async () => ({
    settings: redactedSettings(settings),
    bridgeStatuses: [...bridges.values()].map((rt) => rt.status)
  }))

  // -- Bridges --
  ipcMain.handle(CH.BRIDGES_LIST, async () => {
    return {
      configured: settings.bridges.map((b) => ({
        bondid: b.bondid,
        name: b.name,
        lastIp: b.lastIp ?? null,
        addedAt: b.addedAt,
        status: bridgeStatus(b.bondid)
      }))
    }
  })

  ipcMain.handle(CH.BRIDGES_DISCOVER, async () => {
    ensureDiscovery()
    return { discovered: discovery!.list() }
  })

  ipcMain.handle(CH.BRIDGES_VERIFY, async (_event, ip: string, token: string) => {
    if (!ip || !token) return { ok: false, error: 'IP and token are required' }
    const client = new BondClient('?', ip, token)
    try {
      const v = await client.getVersion()
      if (!v.bondid) return { ok: false, error: 'Bridge did not return a bondid' }
      return { ok: true, bondid: v.bondid.toUpperCase(), model: v.model, fw: v.fw_ver }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(CH.BRIDGES_ADD, async (_event, ip: string, token: string, displayName?: string) => {
    if (!ip || !token) return { ok: false, error: 'IP and token are required' }
    const client = new BondClient('?', ip, token)
    let bondid: string
    let model: string | undefined
    try {
      const v = await client.getVersion()
      if (!v.bondid) throw new Error('Bridge did not return a bondid')
      bondid = v.bondid.toUpperCase()
      model = v.model
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }

    // Replace existing record for the same bondid (token rotation)
    const existing = settings.bridges.find((b) => b.bondid === bondid)
    if (existing) {
      existing.token = token
      existing.lastIp = ip
      // Keep existing name unless caller passed a new one explicitly
      if (displayName?.trim()) existing.name = displayName.trim()
    } else {
      settings.bridges.push({
        bondid,
        name: displayName?.trim() || `Bond ${bondid}`,
        token,
        lastIp: ip,
        addedAt: Date.now()
      })
    }
    await saveSettings()

    const record = settings.bridges.find((b) => b.bondid === bondid)!
    await connectBridge(record, ip)
    return { ok: true, bondid, model }
  })

  ipcMain.handle(CH.BRIDGES_REMOVE, async (_event, bondid: string) => {
    settings.bridges = settings.bridges.filter((b) => b.bondid !== bondid)
    // Clean up overrides + room references for this bridge
    for (const k of Object.keys(settings.deviceOverrides)) {
      if (k.startsWith(`${bondid}:`)) delete settings.deviceOverrides[k]
    }
    for (const room of settings.rooms) {
      room.deviceRefs = room.deviceRefs.filter((r) => r.bondid !== bondid)
    }
    settings.scenes = settings.scenes.map((s) => ({
      ...s,
      steps: s.steps.filter((st) => st.kind === 'delay' || st.bondid !== bondid)
    }))
    await saveSettings()
    disconnectBridge(bondid)
    return { ok: true }
  })

  ipcMain.handle(CH.BRIDGES_RENAME, async (_event, bondid: string, name: string) => {
    const b = settings.bridges.find((x) => x.bondid === bondid)
    if (!b) return { ok: false, error: 'Bridge not found' }
    b.name = name.trim() || b.name
    await saveSettings()
    return { ok: true }
  })

  // Rotate the local token on a configured bridge. By default we verify the
  // new token against the bridge before persisting; if the bridge is offline
  // and the user is sure the token is correct, they can pass forceSave=true
  // to skip verification.
  ipcMain.handle(CH.BRIDGES_UPDATE_TOKEN, async (
    _event,
    bondid: string,
    token: string,
    opts?: { forceSave?: boolean }
  ) => {
    if (!bondid || !token?.trim()) return { ok: false, error: 'bondid and token are required' }
    const record = settings.bridges.find((b) => b.bondid === bondid)
    if (!record) return { ok: false, error: 'Bridge not found' }

    const newToken = token.trim()
    const force = opts?.forceSave === true

    // Best-effort IP resolution: prefer the live runtime ip, then lastIp, then discovery.
    let ip = bridges.get(bondid)?.client.ip ?? record.lastIp ?? null
    if (!ip && discovery) {
      const found = await discovery.resolveBondid(bondid, 5_000)
      if (found) ip = found.ip
    }

    if (!force) {
      if (!ip) {
        return { ok: false, error: 'Bridge IP unknown — wait for discovery, or use Save without verifying.' }
      }
      const tester = new BondClient(bondid, ip, newToken)
      try {
        const v = await tester.getVersion()
        if (v.bondid && v.bondid.toUpperCase() !== bondid.toUpperCase()) {
          return { ok: false, error: `Bridge at ${ip} reported a different bondid (${v.bondid}).` }
        }
      } catch (err) {
        return { ok: false, error: `Token verification failed: ${(err as Error).message}` }
      }
    }

    record.token = newToken
    if (ip) record.lastIp = ip
    await saveSettings()

    if (ip) {
      // Reconnect with the new token. If verification was skipped and the
      // bridge is unreachable, this will simply leave the bridge offline —
      // mirrors the existing connectAllSavedBridges behaviour.
      await connectBridge(record, ip)
    }
    return { ok: true }
  })

  // -- Devices --
  ipcMain.handle(CH.DEVICES_LIST, async () => {
    const list = cache.list().map((entry) => {
      const k = `${entry.meta.bondid}:${entry.meta.deviceId}`
      const ov = settings.deviceOverrides[k] ?? {}
      return {
        bondid: entry.meta.bondid,
        deviceId: entry.meta.deviceId,
        type: entry.meta.type,
        name: entry.meta.name,
        bondReportedName: entry.meta.bondReportedName,
        override: ov,
        online: entry.online
      }
    })
    return { devices: list }
  })

  ipcMain.handle(CH.DEVICES_TOGGLE, async (_event, bondid: string, deviceId: string) => {
    const rt = bridges.get(bondid)
    if (!rt) return { ok: false, error: 'Bridge not connected' }
    try {
      await rt.client.runAction(deviceId, 'TogglePower', {})
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(CH.DEVICE_OVERRIDE, async (_event, bondid: string, deviceId: string, override: { name?: string; exposeToAi?: boolean } | null) => {
    const k = `${bondid}:${deviceId}`
    if (!override) {
      delete settings.deviceOverrides[k]
    } else {
      settings.deviceOverrides[k] = { ...settings.deviceOverrides[k], ...override }
    }
    await saveSettings()
    ctx.broadcast(BC.DEVICES_CHANGED, { bondid })
    return { ok: true }
  })

  ipcMain.handle(CH.DEVICE_REFRESH, async (_event, bondid: string) => {
    await refreshBridgeDevices(bondid)
    return { ok: true }
  })

  ipcMain.handle(CH.DEVICE_DELETE, async (_event, bondid: string, deviceId: string) => {
    const rt = bridges.get(bondid)
    if (!rt) return { ok: false, error: 'Bridge not connected' }
    try {
      await rt.client.deleteDevice(deviceId)
    } catch (err) {
      // 404 just means the bridge already lost it — proceed with local cleanup.
      const e = err as Error
      if (!/404/.test(e.message)) {
        return { ok: false, error: e.message }
      }
    }

    // Clean up local references so we don't dangle.
    const k = `${bondid}:${deviceId}`
    if (settings.deviceOverrides[k]) delete settings.deviceOverrides[k]
    let dirty = false
    for (const room of settings.rooms) {
      const before = room.deviceRefs.length
      room.deviceRefs = room.deviceRefs.filter((r) => !(r.bondid === bondid && r.deviceId === deviceId))
      if (room.deviceRefs.length !== before) dirty = true
    }
    for (const scene of settings.scenes) {
      const before = scene.steps.length
      scene.steps = scene.steps.filter((s) => s.kind === 'delay' || !(s.bondid === bondid && s.deviceId === deviceId))
      if (scene.steps.length !== before) dirty = true
    }
    if (dirty) await saveSettings()
    else await saveSettings()  // overrides may have changed even if rooms/scenes didn't

    cache.remove(bondid, deviceId)
    ctx.broadcast(BC.DEVICES_CHANGED, { bondid })
    return { ok: true }
  })

  // -- Rooms --
  ipcMain.handle(CH.ROOMS_LIST, async () => ({ rooms: settings.rooms }))

  ipcMain.handle(CH.ROOMS_UPSERT, async (_event, room: BondRoom) => {
    if (!room?.id || !room?.name?.trim()) return { ok: false, error: 'Room id and name are required' }
    const idx = settings.rooms.findIndex((r) => r.id === room.id)
    const sanitized: BondRoom = {
      id: room.id,
      name: room.name.trim(),
      deviceRefs: Array.isArray(room.deviceRefs) ? room.deviceRefs : []
    }
    if (idx >= 0) settings.rooms[idx] = sanitized
    else          settings.rooms.push(sanitized)
    await saveSettings()
    return { ok: true }
  })

  ipcMain.handle(CH.ROOMS_REMOVE, async (_event, roomId: string) => {
    settings.rooms = settings.rooms.filter((r) => r.id !== roomId)
    await saveSettings()
    return { ok: true }
  })

  // -- Scenes --
  ipcMain.handle(CH.SCENES_LIST, async () => ({ scenes: settings.scenes }))

  ipcMain.handle(CH.SCENES_UPSERT, async (_event, scene: BondScene) => {
    if (!scene?.id || !scene?.name?.trim()) return { ok: false, error: 'Scene id and name are required' }
    const idx = settings.scenes.findIndex((s) => s.id === scene.id)
    const sanitized: BondScene = {
      id: scene.id,
      name: scene.name.trim(),
      description: scene.description?.trim() || undefined,
      steps: Array.isArray(scene.steps) ? scene.steps : []
    }
    if (idx >= 0) settings.scenes[idx] = sanitized
    else          settings.scenes.push(sanitized)
    await saveSettings()
    return { ok: true }
  })

  ipcMain.handle(CH.SCENES_REMOVE, async (_event, sceneId: string) => {
    settings.scenes = settings.scenes.filter((s) => s.id !== sceneId)
    await saveSettings()
    return { ok: true }
  })

  ipcMain.handle(CH.SCENES_RUN, async (_event, sceneId: string) => {
    const scene = settings.scenes.find((s) => s.id === sceneId)
    if (!scene) return { ok: false, error: 'Scene not found' }
    const { runScene } = await import('./scenes')
    const result = await runScene(scene, (bondid) => bridges.get(bondid)?.client ?? null)
    return { ok: result.ok, result }
  })

  // -- Learn --
  ipcMain.handle(CH.LEARN_START, async (_event, bondid: string) => {
    const rt = bridges.get(bondid)
    if (!rt) return { ok: false, error: 'Bridge not connected' }
    learnSessions.get(bondid)?.stop()
    const session = startLearnSession(rt.client, {
      onCapture: (signal: CapturedSignal) => {
        ctx.broadcast(BC.LEARN_CAPTURED, signal)
      },
      onError: (err) => {
        console.warn(`[rose-bond] learn error on ${bondid}:`, err.message)
        ctx.broadcast(BC.LEARN_STATUS, { bondid, error: err.message })
      },
      onScanRestart: () => {
        ctx.broadcast(BC.LEARN_STATUS, { bondid, scanRestarted: true })
      }
    })
    learnSessions.set(bondid, session)
    ctx.broadcast(BC.LEARN_STATUS, { bondid, active: true })
    return { ok: true }
  })

  ipcMain.handle(CH.LEARN_STOP, async (_event, bondid: string) => {
    const session = learnSessions.get(bondid)
    if (session) {
      await session.stop()
      learnSessions.delete(bondid)
    }
    ctx.broadcast(BC.LEARN_STATUS, { bondid, active: false })
    return { ok: true }
  })

  ipcMain.handle(CH.LEARN_ASSIGN, async (_event, bondid: string, signal: CapturedSignal, params: { deviceId: string | null; newDevice?: { name: string; type: string }; actionName: string; commandName?: string }) => {
    const rt = bridges.get(bondid)
    if (!rt) return { ok: false, error: 'Bridge not connected' }
    try {
      const { deviceId } = await assignCapturedSignal(rt.client, signal, {
        deviceId: params.deviceId,
        newDevice: params.newDevice,
        actionName: params.actionName,
        commandName: params.commandName
      })
      // Refresh metadata for the (possibly new) device so cache + UI catch up.
      await refreshBridgeDevices(bondid)
      return { ok: true, deviceId }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // ---- Bring everything up -----------------------------------------------
  void (async () => {
    try {
      await loadSettings()
      ensureDiscovery()
      await connectAllSavedBridges()
    } catch (err) {
      console.error('[rose-bond] startup failed:', err)
    }
  })()

  // ---- Cleanup -----------------------------------------------------------
  return () => {
    for (const channel of ALL_INVOKE_CHANNELS) {
      try { ipcMain.removeHandler(channel) } catch { /* ok */ }
    }
    for (const session of learnSessions.values()) {
      void session.stop()
    }
    learnSessions.clear()
    for (const rt of bridges.values()) {
      rt.bpup?.stop()
    }
    bridges.clear()
    cache.clear()
    stopDiscoveryListener?.()
    discovery?.stop()
    discovery = null
  }
}

/** Token-redacted view for renderer. */
function redactedSettings(s: BondSettings): Omit<BondSettings, 'bridges'> & { bridges: Array<Omit<BondBridgeRecord, 'token'> & { hasToken: boolean }> } {
  return {
    ...s,
    bridges: s.bridges.map(({ token: _t, ...rest }) => ({ ...rest, hasToken: Boolean(_t) }))
  }
}
