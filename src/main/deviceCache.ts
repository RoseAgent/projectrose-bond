import type {
  BondDeviceOverride,
  DeviceCacheEntry,
  DeviceMeta,
  DeviceState,
  DeviceType
} from './types'

export type CacheKey = `${string}:${string}` // `${bondid}:${deviceId}`
export const cacheKey = (bondid: string, deviceId: string): CacheKey => `${bondid}:${deviceId}`

export class DeviceCache {
  private readonly entries = new Map<CacheKey, DeviceCacheEntry>()
  private readonly listeners = new Set<(key: CacheKey, entry: DeviceCacheEntry | null) => void>()

  upsertMeta(bondid: string, deviceId: string, meta: Omit<DeviceMeta, 'bondid' | 'deviceId'>): DeviceCacheEntry {
    const key = cacheKey(bondid, deviceId)
    const prev = this.entries.get(key)
    const entry: DeviceCacheEntry = {
      meta: { bondid, deviceId, ...meta },
      state: prev?.state ?? {},
      online: prev?.online ?? true,
      lastSeenMs: Date.now()
    }
    this.entries.set(key, entry)
    this.emit(key, entry)
    return entry
  }

  setState(bondid: string, deviceId: string, state: DeviceState): DeviceCacheEntry | null {
    const key = cacheKey(bondid, deviceId)
    const prev = this.entries.get(key)
    if (!prev) return null
    const next: DeviceCacheEntry = {
      ...prev,
      state: { ...prev.state, ...state },
      online: true,
      lastSeenMs: Date.now()
    }
    this.entries.set(key, next)
    this.emit(key, next)
    return next
  }

  setOnline(bondid: string, online: boolean): void {
    for (const [key, entry] of this.entries) {
      if (entry.meta.bondid !== bondid) continue
      if (entry.online === online) continue
      const next = { ...entry, online, lastSeenMs: Date.now() }
      this.entries.set(key, next)
      this.emit(key, next)
    }
  }

  remove(bondid: string, deviceId: string): void {
    const key = cacheKey(bondid, deviceId)
    if (this.entries.delete(key)) this.emit(key, null)
  }

  removeAllForBridge(bondid: string): void {
    for (const [key, entry] of [...this.entries]) {
      if (entry.meta.bondid === bondid) {
        this.entries.delete(key)
        this.emit(key, null)
      }
    }
  }

  get(bondid: string, deviceId: string): DeviceCacheEntry | null {
    return this.entries.get(cacheKey(bondid, deviceId)) ?? null
  }

  list(): DeviceCacheEntry[] {
    return [...this.entries.values()]
  }

  listForBridge(bondid: string): DeviceCacheEntry[] {
    return this.list().filter((e) => e.meta.bondid === bondid)
  }

  /** Apply overrides to produce an "effective" view (renames, expose-to-AI filter). */
  resolveDisplay(
    overrides: Record<string, BondDeviceOverride>,
    opts?: { aiOnly?: boolean }
  ): Array<DeviceCacheEntry & { effectiveName: string; exposedToAi: boolean }> {
    return this.list()
      .map((entry) => {
        const k = `${entry.meta.bondid}:${entry.meta.deviceId}`
        const ov = overrides[k] ?? {}
        const effectiveName = ov.name?.trim() || entry.meta.name
        const exposedToAi = ov.exposeToAi !== false
        return { ...entry, effectiveName, exposedToAi }
      })
      .filter((e) => (opts?.aiOnly ? e.exposedToAi : true))
  }

  subscribe(cb: (key: CacheKey, entry: DeviceCacheEntry | null) => void): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  clear(): void {
    const keys = [...this.entries.keys()]
    this.entries.clear()
    for (const k of keys) this.emit(k, null)
  }

  private emit(key: CacheKey, entry: DeviceCacheEntry | null): void {
    for (const cb of this.listeners) {
      try { cb(key, entry) } catch { /* ignore listener crash */ }
    }
  }
}

// Friendlier display labels for device-type codes.
export function deviceTypeLabel(t: DeviceType): string {
  switch (t) {
    case 'CF': return 'Ceiling Fan'
    case 'FP': return 'Fireplace'
    case 'MS': return 'Motorized Shade'
    case 'GX': return 'Generic'
    default:   return String(t)
  }
}
