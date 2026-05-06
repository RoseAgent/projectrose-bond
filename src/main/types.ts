// Local copies of the host's extension types — extensions don't import from
// the host. Keep these in sync with ProjectRose/src/shared/extension-types.ts.

export interface ExtensionToolEntry {
  name: string
  description: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: Record<string, any>
  execute: (input: Record<string, unknown>, projectRoot: string) => Promise<string>
}

export interface ExtensionMainContext {
  rootPath: string
  getSettings: () => Promise<Record<string, unknown>>
  updateSettings: (patch: Record<string, unknown>) => Promise<void>
  broadcast: (channel: string, data: unknown) => void
  notifyStatus?: (text: string, opts?: { tone?: 'info' | 'success' | 'error' | 'warning'; durationMs?: number }) => void
  registerTools: (tools: ExtensionToolEntry[]) => void
  registerSensitiveFields: (keys: string[]) => void
}

// ---- Bond domain types ------------------------------------------------------

export type DeviceType = 'CF' | 'FP' | 'MS' | 'GX' | string

export interface BondBridgeRecord {
  bondid: string
  name: string
  token: string
  lastIp?: string
  addedAt: number
}

export interface BondRoom {
  id: string
  name: string
  deviceRefs: Array<{ bondid: string; deviceId: string }>
}

export type BondSceneStep =
  | { kind: 'action'; bondid: string; deviceId: string; action: string; params?: Record<string, unknown> }
  | { kind: 'delay'; ms: number }

export interface BondScene {
  id: string
  name: string
  description?: string
  steps: BondSceneStep[]
}

export interface BondDeviceOverride {
  name?: string
  exposeToAi?: boolean
}

export interface BondSettings {
  bridges: BondBridgeRecord[]
  rooms: BondRoom[]
  scenes: BondScene[]
  deviceOverrides: Record<string, BondDeviceOverride> // key: `${bondid}:${deviceId}`
}

export const EMPTY_BOND_SETTINGS: BondSettings = {
  bridges: [],
  rooms: [],
  scenes: [],
  deviceOverrides: {}
}

// ---- In-memory cache --------------------------------------------------------

export interface DeviceMeta {
  bondid: string
  deviceId: string
  type: DeviceType
  name: string                    // override OR bond-reported
  bondReportedName: string        // raw name from bridge
  actions: string[]               // from /v2/devices/{id}
}

export interface DeviceState {
  power?: 0 | 1
  speed?: number
  brightness?: number
  position?: number
  flame?: number
  light?: 0 | 1
  direction?: -1 | 1
  // Free-form — Bond returns lots of variants.
  [key: string]: unknown
}

export interface DeviceCacheEntry {
  meta: DeviceMeta
  state: DeviceState
  online: boolean
  lastSeenMs: number
}

export interface BridgeRuntimeStatus {
  bondid: string
  online: boolean
  ip?: string
  lastSeenMs: number
  bpup: 'connected' | 'polling-fallback' | 'unknown'
}

// ---- Discovery --------------------------------------------------------------

export interface DiscoveredBridge {
  bondid: string                   // from TXT record
  ip: string
  port: number
  model?: string
  fw?: string
}

// ---- Captured signals (IR/RF learn) -----------------------------------------

export interface CapturedSignal {
  id: string                       // synthetic uuid we assign
  bondid: string
  capturedAtMs: number
  // The full /v2/sys/signal payload as returned by the bridge.
  // Includes freq, bps, encoding, modulation, data, etc.
  signal: Record<string, unknown>
}

// ---- BondError --------------------------------------------------------------

export class BondError extends Error {
  constructor(
    message: string,
    public readonly bondid?: string,
    public readonly status?: number,
    public readonly endpoint?: string
  ) {
    super(message)
    this.name = 'BondError'
  }
}
