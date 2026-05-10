// Renderer-side mirrors of the main-side domain types. Kept separate so the
// renderer bundle doesn't pull in any node-only modules transitively.

export type DeviceType = 'CF' | 'FP' | 'MS' | 'GX' | string

export interface BondBridgePublic {
  bondid: string
  name: string
  lastIp: string | null
  addedAt: number
  hasToken: boolean
}

export interface BondBridgeStatus {
  bondid: string
  online: boolean
  ip?: string
  lastSeenMs: number
  bpup: 'connected' | 'polling-fallback' | 'unknown'
}

export interface BondConfiguredBridge {
  bondid: string
  name: string
  lastIp: string | null
  addedAt: number
  status: BondBridgeStatus
}

export interface DeviceOverride {
  name?: string
  exposeToAi?: boolean
}

export interface BondDeviceView {
  bondid: string
  deviceId: string
  type: DeviceType
  name: string
  bondReportedName: string
  override: DeviceOverride
  online: boolean
}

export interface BondRoom {
  id: string
  name: string
  deviceRefs: Array<{ bondid: string; deviceId: string }>
}

export type BondSceneStep =
  | { kind: 'toggle'; bondid: string; deviceId: string }
  | { kind: 'delay'; ms: number }

export interface BondScene {
  id: string
  name: string
  description?: string
  steps: BondSceneStep[]
}

export interface DiscoveredBridge {
  bondid: string
  ip: string
  port: number
  model?: string
  fw?: string
}

export interface CapturedSignal {
  id: string
  bondid: string
  capturedAtMs: number
  signal: Record<string, unknown>
}
