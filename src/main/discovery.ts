import { Bonjour, type Service } from 'bonjour-service'
import type { DiscoveredBridge } from './types'

const SERVICE_TYPE = 'bond'
const BROWSE_PROTOCOL = 'tcp'

export interface DiscoveryHandle {
  list: () => DiscoveredBridge[]
  /** Fired whenever the discovered set changes. */
  onChange: (cb: (bridges: DiscoveredBridge[]) => void) => () => void
  /** Try to find a specific bondid; resolves to its IP/port if seen within timeoutMs. */
  resolveBondid: (bondid: string, timeoutMs?: number) => Promise<DiscoveredBridge | null>
  stop: () => void
}

function serviceToBridge(svc: Service): DiscoveredBridge | null {
  // bonjour-service exposes addresses[]; pick the first IPv4.
  const ipv4 = (svc.addresses ?? []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a))
  if (!ipv4) return null

  // TXT record may carry { bondid: 'ZZBL12345', model: '...', fw: '...' }.
  const txt = (svc.txt ?? {}) as Record<string, string>
  const bondid = (txt.bondid ?? txt.id ?? svc.name ?? '').toString().toUpperCase()
  if (!bondid) return null

  return {
    bondid,
    ip: ipv4,
    port: svc.port ?? 80,
    model: txt.model ?? txt.make,
    fw: txt.fw ?? txt.version
  }
}

export function startDiscovery(): DiscoveryHandle {
  const bonjour = new Bonjour()
  const browser = bonjour.find({ type: SERVICE_TYPE, protocol: BROWSE_PROTOCOL })

  const found = new Map<string, DiscoveredBridge>()
  const listeners = new Set<(bridges: DiscoveredBridge[]) => void>()

  const emit = (): void => {
    const snapshot = [...found.values()]
    for (const cb of listeners) {
      try { cb(snapshot) } catch { /* listener crash shouldn't break discovery */ }
    }
  }

  browser.on('up', (svc) => {
    const b = serviceToBridge(svc)
    if (!b) return
    found.set(b.bondid, b)
    emit()
  })

  browser.on('down', (svc) => {
    const b = serviceToBridge(svc)
    if (!b) return
    found.delete(b.bondid)
    emit()
  })

  browser.start()

  return {
    list: () => [...found.values()],
    onChange: (cb) => {
      listeners.add(cb)
      // Fire once with current snapshot so subscribers don't miss already-found bridges.
      try { cb([...found.values()]) } catch { /* ignore */ }
      return () => { listeners.delete(cb) }
    },
    resolveBondid: (bondid, timeoutMs = 5_000) => {
      const target = bondid.toUpperCase()
      const existing = found.get(target)
      if (existing) return Promise.resolve(existing)

      return new Promise<DiscoveredBridge | null>((resolve) => {
        let done = false
        const timer = setTimeout(() => {
          if (done) return
          done = true
          listeners.delete(check)
          resolve(null)
        }, timeoutMs)

        const check = (bridges: DiscoveredBridge[]): void => {
          const hit = bridges.find((b) => b.bondid === target)
          if (hit && !done) {
            done = true
            clearTimeout(timer)
            listeners.delete(check)
            resolve(hit)
          }
        }
        listeners.add(check)
      })
    },
    stop: () => {
      try { browser.stop() } catch { /* ok */ }
      try { bonjour.destroy() } catch { /* ok */ }
      listeners.clear()
      found.clear()
    }
  }
}
