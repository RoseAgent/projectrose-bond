import type {
  BondConfiguredBridge,
  BondDeviceView,
  BondRoom,
  BondScene,
  CapturedSignal,
  DeviceOverride,
  DeviceState,
  DiscoveredBridge,
  BondBridgeStatus
} from './types'

declare global {
  interface Window {
    api: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void
    }
  }
}

const inv = <T,>(channel: string, ...args: unknown[]): Promise<T> =>
  window.api.invoke(channel, ...args) as Promise<T>

// ---- Bridges -----------------------------------------------------------

export const bridgesList = (): Promise<{ configured: BondConfiguredBridge[] }> =>
  inv('rose-bond:bridges.list')

export const bridgesDiscover = (): Promise<{ discovered: DiscoveredBridge[] }> =>
  inv('rose-bond:bridges.discover')

export const bridgesVerify = (
  ip: string, token: string
): Promise<{ ok: true; bondid: string; model?: string; fw?: string } | { ok: false; error: string }> =>
  inv('rose-bond:bridges.verify', ip, token)

export const bridgesAdd = (
  ip: string, token: string, name?: string
): Promise<{ ok: true; bondid: string; model?: string } | { ok: false; error: string }> =>
  inv('rose-bond:bridges.add', ip, token, name)

export const bridgesRemove = (bondid: string): Promise<{ ok: boolean; error?: string }> =>
  inv('rose-bond:bridges.remove', bondid)

export const bridgesRename = (bondid: string, name: string): Promise<{ ok: boolean; error?: string }> =>
  inv('rose-bond:bridges.rename', bondid, name)

// ---- Devices -----------------------------------------------------------

export const devicesList = (): Promise<{ devices: BondDeviceView[] }> =>
  inv('rose-bond:devices.list')

export const devicesAction = (
  bondid: string, deviceId: string, action: string, params?: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> =>
  inv('rose-bond:devices.action', bondid, deviceId, action, params)

export const deviceOverride = (
  bondid: string, deviceId: string, override: DeviceOverride | null
): Promise<{ ok: boolean }> =>
  inv('rose-bond:devices.override', bondid, deviceId, override)

export const deviceRefresh = (bondid: string): Promise<{ ok: boolean }> =>
  inv('rose-bond:devices.refresh', bondid)

export const deviceDelete = (bondid: string, deviceId: string): Promise<{ ok: boolean; error?: string }> =>
  inv('rose-bond:devices.delete', bondid, deviceId)

// ---- Rooms -------------------------------------------------------------

export const roomsList = (): Promise<{ rooms: BondRoom[] }> =>
  inv('rose-bond:rooms.list')

export const roomsUpsert = (room: BondRoom): Promise<{ ok: boolean; error?: string }> =>
  inv('rose-bond:rooms.upsert', room)

export const roomsRemove = (id: string): Promise<{ ok: boolean }> =>
  inv('rose-bond:rooms.remove', id)

// ---- Scenes ------------------------------------------------------------

export const scenesList = (): Promise<{ scenes: BondScene[] }> =>
  inv('rose-bond:scenes.list')

export const scenesUpsert = (scene: BondScene): Promise<{ ok: boolean; error?: string }> =>
  inv('rose-bond:scenes.upsert', scene)

export const scenesRemove = (id: string): Promise<{ ok: boolean }> =>
  inv('rose-bond:scenes.remove', id)

export const scenesRun = (id: string): Promise<{ ok: boolean; result?: unknown; error?: string }> =>
  inv('rose-bond:scenes.run', id)

// ---- Learn -------------------------------------------------------------

export const learnStart = (bondid: string): Promise<{ ok: boolean; error?: string }> =>
  inv('rose-bond:learn.start', bondid)

export const learnStop = (bondid: string): Promise<{ ok: boolean }> =>
  inv('rose-bond:learn.stop', bondid)

export const learnAssign = (
  bondid: string,
  signal: CapturedSignal,
  params: { deviceId: string | null; newDevice?: { name: string; type: string }; actionName: string; commandName?: string }
): Promise<{ ok: true; deviceId: string } | { ok: false; error: string }> =>
  inv('rose-bond:learn.assign', bondid, signal, params)

// ---- Subscriptions (broadcasts) ---------------------------------------

export const onState = (cb: (msg: { bondid: string; deviceId: string; state: DeviceState }) => void): (() => void) =>
  window.api.on('rose-bond:state', (...args) => cb(args[0] as { bondid: string; deviceId: string; state: DeviceState }))

export const onBridgeStatus = (cb: (status: BondBridgeStatus) => void): (() => void) =>
  window.api.on('rose-bond:bridge.status', (...args) => cb(args[0] as BondBridgeStatus))

export const onDevicesChanged = (cb: (msg: { bondid: string }) => void): (() => void) =>
  window.api.on('rose-bond:devices.changed', (...args) => cb(args[0] as { bondid: string }))

export const onDiscovered = (cb: (msg: { bridges: DiscoveredBridge[] }) => void): (() => void) =>
  window.api.on('rose-bond:bridges.discovered', (...args) => cb(args[0] as { bridges: DiscoveredBridge[] }))

export const onLearnCaptured = (cb: (signal: CapturedSignal) => void): (() => void) =>
  window.api.on('rose-bond:learn.captured', (...args) => cb(args[0] as CapturedSignal))

export const onLearnStatus = (cb: (msg: { bondid: string; active?: boolean; error?: string; scanRestarted?: boolean }) => void): (() => void) =>
  window.api.on('rose-bond:learn.status', (...args) => cb(args[0] as { bondid: string; active?: boolean; error?: string; scanRestarted?: boolean }))

export const onSettingsChanged = (cb: () => void): (() => void) =>
  window.api.on('rose-bond:settings.changed', () => cb())
