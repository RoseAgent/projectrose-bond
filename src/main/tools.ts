import type { BondClient } from './bondClient'
import type { DeviceCache } from './deviceCache'
import { runScene } from './scenes'
import type {
  BondBridgeRecord,
  BondRoom,
  BondScene,
  BondSettings,
  ExtensionToolEntry
} from './types'
import { deviceTypeLabel } from './deviceCache'

export interface BondToolEnv {
  cache: DeviceCache
  getSettings: () => BondSettings
  bridges: () => BondBridgeRecord[]
  clientFor: (bondid: string) => BondClient | null
}

// ---- Resolution helpers -----------------------------------------------------

interface ResolvedDevice {
  bondid: string
  deviceId: string
  bridgeName: string
  effectiveName: string
  actions: string[]
}

interface TargetMatch {
  device?: ResolvedDevice
  room?: BondRoom
  scene?: BondScene
}

function bridgeName(bridges: BondBridgeRecord[], bondid: string): string {
  return bridges.find((b) => b.bondid === bondid)?.name ?? bondid
}

function listDevices(env: BondToolEnv): ResolvedDevice[] {
  const settings = env.getSettings()
  const bridges = env.bridges()
  return env.cache.resolveDisplay(settings.deviceOverrides, { aiOnly: true })
    .map((entry) => ({
      bondid: entry.meta.bondid,
      deviceId: entry.meta.deviceId,
      bridgeName: bridgeName(bridges, entry.meta.bondid),
      effectiveName: entry.effectiveName,
      actions: entry.meta.actions
    }))
}

function parseTarget(raw: string): { name: string; bridge: string | null } {
  const at = raw.lastIndexOf('@')
  if (at < 0) return { name: raw.trim(), bridge: null }
  return { name: raw.slice(0, at).trim(), bridge: raw.slice(at + 1).trim() }
}

function matchTarget(rawTarget: string, env: BondToolEnv): TargetMatch | { error: string } {
  const settings = env.getSettings()
  const { name, bridge } = parseTarget(rawTarget)
  if (!name) return { error: `Empty target` }

  const ciEq = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

  // Scene match (no bridge qualifier on scenes)
  const scenes = settings.scenes.filter((s) => ciEq(s.name, name))
  // Room match
  const rooms = settings.rooms.filter((r) => ciEq(r.name, name))
  // Device match (optionally filtered by bridge)
  const devices = listDevices(env).filter((d) => {
    if (!ciEq(d.effectiveName, name)) return false
    if (bridge && !ciEq(d.bridgeName, bridge)) return false
    return true
  })

  // Disambiguation rules:
  //   - If exactly one match across all categories, use it.
  //   - If multiple device matches across bridges, force qualifier.
  //   - If a device-name and a room-name and a scene-name collide, list all.
  const totalMatches = (scenes.length > 0 ? 1 : 0) + (rooms.length > 0 ? 1 : 0) + devices.length
  if (totalMatches === 0) {
    return { error: `No device, room, or scene named '${rawTarget}'` }
  }

  if (devices.length > 1) {
    const list = devices.map((d) => `${d.effectiveName}@${d.bridgeName}`).join(', ')
    return { error: `Ambiguous target '${name}' — multiple devices match: ${list}. Re-call with the @bridge qualifier.` }
  }

  const conflicting: string[] = []
  if (devices.length === 1) conflicting.push(`device '${devices[0]!.effectiveName}'`)
  if (rooms.length > 0) conflicting.push(`room '${rooms[0]!.name}'`)
  if (scenes.length > 0) conflicting.push(`scene '${scenes[0]!.name}'`)
  if (conflicting.length > 1) {
    return { error: `Ambiguous target '${name}' — matches ${conflicting.join(' and ')}. Rename one in Settings, or specify a different target.` }
  }

  if (devices.length === 1) return { device: devices[0]! }
  if (rooms.length === 1)   return { room: rooms[0]! }
  if (scenes.length === 1)  return { scene: scenes[0]! }
  return { error: 'Internal: no match selected' }
}

// ---- Tool: bond_list_devices -----------------------------------------------

export function makeListDevicesTool(env: BondToolEnv): ExtensionToolEntry {
  return {
    name: 'bond_list_devices',
    description:
      'List every Bond device, room, and scene with the actions and parameter schemas each one supports. ' +
      'Call this first when the user mentions home devices, lights, fans, shades, fireplaces, scenes, or rooms.',
    schema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    execute: async () => {
      const settings = env.getSettings()
      const bridges = env.bridges()
      const devicesEnriched = env.cache.resolveDisplay(settings.deviceOverrides, { aiOnly: true })

      const devices = devicesEnriched.map((entry) => {
        const actions: Record<string, unknown> = {}
        for (const action of entry.meta.actions) {
          actions[action] = paramSchemaForAction(action)
        }
        return {
          name: entry.effectiveName,
          bridge: bridgeName(bridges, entry.meta.bondid),
          type: deviceTypeLabel(entry.meta.type),
          online: entry.online,
          state: entry.state,
          actions
        }
      })

      const rooms = settings.rooms.map((room) => {
        const memberDevices = room.deviceRefs
          .map((ref) => env.cache.get(ref.bondid, ref.deviceId))
          .filter((e): e is NonNullable<typeof e> => e !== null)
        const actionSets = memberDevices.map((m) => new Set(m.meta.actions))
        const common = actionSets.reduce<Set<string> | null>((acc, set) => {
          if (acc === null) return new Set(set)
          for (const a of [...acc]) if (!set.has(a)) acc.delete(a)
          return acc
        }, null) ?? new Set()
        return {
          name: room.name,
          members: memberDevices.length,
          common_actions: [...common]
        }
      })

      const scenes = settings.scenes.map((s) => ({
        name: s.name,
        description: s.description ?? null,
        action: 'Run'
      }))

      const payload = { devices, rooms, scenes, bridges: bridges.map((b) => ({ name: b.name, bondid: b.bondid })) }
      return JSON.stringify(payload, null, 2)
    }
  }
}

// ---- Tool: bond_control -----------------------------------------------------

export function makeControlTool(env: BondToolEnv): ExtensionToolEntry {
  return {
    name: 'bond_control',
    description:
      "Control a Bond device, room, or scene. " +
      "Use the action name as listed by bond_list_devices (e.g. 'TurnOn', 'TurnOff', 'SetSpeed', 'SetBrightness', 'SetPosition', 'SetFlame'). " +
      "For scenes, set action to 'Run'. " +
      "When targeting a room, the action fans out to every member that supports it; members without that action are skipped (reported in the response). " +
      "If multiple devices share a name across bridges, append '@<bridge>' to disambiguate (e.g. 'Lamp@Upstairs').",
    schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: "Device, room, or scene name. Optional '@<bridge>' qualifier." },
        action: { type: 'string', description: "Action name. 'Run' for scenes." },
        params: {
          type: 'object',
          description: "Action arguments. Most actions need {argument: <number>}; TurnOn/TurnOff/Run take {} or are omitted.",
          additionalProperties: true
        }
      },
      required: ['target', 'action'],
      additionalProperties: false
    },
    execute: async (input) => {
      const target = String(input.target ?? '').trim()
      const action = String(input.action ?? '').trim()
      const params = (input.params && typeof input.params === 'object' ? input.params : {}) as Record<string, unknown>

      if (!target) return 'ERROR: target is required'
      if (!action) return 'ERROR: action is required'

      const match = matchTarget(target, env)
      if ('error' in match) return `ERROR: ${match.error}`

      // Scene
      if (match.scene) {
        if (action !== 'Run') return `ERROR: Scenes only support the 'Run' action; got '${action}'`
        const result = await runScene(match.scene, env.clientFor)
        const okSteps = result.steps.filter((s) => s.ok).length
        const failed = result.steps.filter((s) => !s.ok)
        if (result.ok) return `OK: Ran scene '${result.sceneName}' (${okSteps}/${result.steps.length} steps).`
        const failSummary = failed.map((s) =>
          s.step.kind === 'action'
            ? `step ${result.steps.indexOf(s) + 1} (${s.step.action}): ${s.error}`
            : `step ${result.steps.indexOf(s) + 1} (delay): ${s.error}`
        ).join('; ')
        return `ERROR: Scene '${result.sceneName}' completed with failures (${okSteps}/${result.steps.length} steps): ${failSummary}`
      }

      // Single device
      if (match.device) {
        if (!match.device.actions.includes(action)) {
          return `ERROR: Device '${match.device.effectiveName}' has no '${action}' action. Available: ${match.device.actions.join(', ') || '(none)'}`
        }
        const client = env.clientFor(match.device.bondid)
        if (!client) return `ERROR: Bridge '${match.device.bridgeName}' is offline`
        try {
          await client.runAction(match.device.deviceId, action, params)
          return `OK: ${match.device.effectiveName} ← ${action}${formatArgs(params)}`
        } catch (err) {
          return `ERROR: ${match.device.effectiveName}: ${(err as Error).message}`
        }
      }

      // Room fan-out
      if (match.room) {
        const memberRefs = match.room.deviceRefs
          .map((ref) => {
            const entry = env.cache.get(ref.bondid, ref.deviceId)
            const settings = env.getSettings()
            const k = `${ref.bondid}:${ref.deviceId}`
            const ov = settings.deviceOverrides[k] ?? {}
            return entry
              ? {
                  bondid: entry.meta.bondid,
                  deviceId: entry.meta.deviceId,
                  effectiveName: ov.name?.trim() || entry.meta.name,
                  actions: entry.meta.actions
                }
              : null
          })
          .filter((e): e is NonNullable<typeof e> => e !== null)

        const eligible = memberRefs.filter((m) => m.actions.includes(action))
        const skipped  = memberRefs.filter((m) => !m.actions.includes(action))

        if (eligible.length === 0) {
          return `ERROR: No device in room '${match.room.name}' supports action '${action}'`
        }

        const results = await Promise.all(eligible.map(async (m) => {
          const client = env.clientFor(m.bondid)
          if (!client) return { name: m.effectiveName, ok: false, err: 'bridge offline' }
          try {
            await client.runAction(m.deviceId, action, params)
            return { name: m.effectiveName, ok: true }
          } catch (err) {
            return { name: m.effectiveName, ok: false, err: (err as Error).message }
          }
        }))

        const ok = results.filter((r) => r.ok)
        const fail = results.filter((r) => !r.ok)
        let summary = `OK: ${match.room.name} ← ${action}${formatArgs(params)} on ${ok.length}/${eligible.length} device(s)`
        if (skipped.length > 0) {
          summary += `. Skipped: ${skipped.map((s) => s.effectiveName).join(', ')}`
        }
        if (fail.length > 0) {
          return `ERROR: ${match.room.name} ← ${action} partial failure. Succeeded: ${ok.map((r) => r.name).join(', ') || '(none)'}. Failed: ${fail.map((r) => `${r.name} (${r.err})`).join(', ')}${skipped.length ? `. Skipped: ${skipped.map((s) => s.effectiveName).join(', ')}` : ''}`
        }
        return summary
      }

      return `ERROR: No match for target '${target}'`
    }
  }
}

// ---- Helpers ---------------------------------------------------------------

function paramSchemaForAction(action: string): Record<string, unknown> {
  // Heuristic: actions with a numeric argument follow naming patterns.
  // Best-effort — the actual constraints are device-specific and not exposed
  // by Bond's API in a uniform schema. We surface what's well-known.
  if (action === 'TurnOn' || action === 'TurnOff' || action === 'TurnLightOn' || action === 'TurnLightOff' ||
      action === 'StartUpLight' || action === 'StartDimmer' || action === 'Stop' ||
      action === 'OpenNext' || action === 'CloseNext' || action === 'Hold') {
    return { params: 'none' }
  }
  if (action.startsWith('Set')) {
    // Most Set* actions take a single integer argument.
    if (action === 'SetBrightness') return { argument: { type: 'integer', min: 1, max: 100, description: 'Percent (1-100)' } }
    if (action === 'SetSpeed')      return { argument: { type: 'integer', min: 1, max: 6,  description: 'Fan speed (1-max)' } }
    if (action === 'SetPosition')   return { argument: { type: 'integer', min: 0, max: 100, description: 'Percent open' } }
    if (action === 'SetFlame')      return { argument: { type: 'integer', min: 1, max: 100, description: 'Flame level' } }
    if (action === 'SetDirection')  return { argument: { type: 'integer', enum: [-1, 1], description: '1 forward, -1 reverse' } }
    return { argument: { type: 'integer', description: 'Numeric argument' } }
  }
  if (action.startsWith('Increase') || action.startsWith('Decrease')) {
    return { argument: { type: 'integer', description: 'Step size (optional)', optional: true } }
  }
  return { params: 'unknown — pass an empty object {}' }
}

function formatArgs(params: Record<string, unknown>): string {
  if (Object.keys(params).length === 0) return ''
  return ` ${JSON.stringify(params)}`
}
