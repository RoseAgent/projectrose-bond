import { useEffect, useMemo, useState } from 'react'
import { useBondStore, groupDevicesByRoom } from './store'
import { SceneChip } from './components/SceneChip'
import { RoomSection } from './components/RoomSection'
import styles from './PageView.module.css'

export function BondPageView(): JSX.Element {
  const init = useBondStore((s) => s.init)
  const refreshAll = useBondStore((s) => s.refreshAll)
  const initialized = useBondStore((s) => s.initialized)
  const loading = useBondStore((s) => s.loading)
  const lastError = useBondStore((s) => s.lastError)
  const bridges = useBondStore((s) => s.configuredBridges)
  const devices = useBondStore((s) => s.devices)
  const rooms = useBondStore((s) => s.rooms)
  const scenes = useBondStore((s) => s.scenes)

  const [filter, setFilter] = useState('')

  useEffect(() => {
    void init()
  }, [init])

  const filteredDevices = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return devices
    return devices.filter((d) => {
      const name = (d.override?.name?.trim() || d.name || '').toLowerCase()
      return name.includes(q)
    })
  }, [devices, filter])

  const groups = useMemo(() => groupDevicesByRoom(filteredDevices, rooms), [filteredDevices, rooms])

  // Empty state
  if (initialized && bridges.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <h2>No Bond bridges configured</h2>
          <p>Open Settings → Bond to discover bridges on your network and add one.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <header className={styles.topBar}>
        <h2 className={styles.pageTitle}>Bond</h2>
        <div className={styles.bridgeChips}>
          {bridges.map((b) => (
            <span
              key={b.bondid}
              className={`${styles.bridgeChip} ${b.status.online ? styles.bridgeChipOnline : styles.bridgeChipOffline}`}
              title={`${b.bondid} • ${b.status.bpup} • ${b.status.online ? 'online' : 'offline'}`}
            >
              <span className={`${styles.statusDot} ${b.status.online ? styles.statusDotOn : styles.statusDotOff}`} />
              {b.name}
              {b.status.bpup === 'polling-fallback' && <span className={styles.bridgeChipWarn} title="Live updates unavailable — using on-demand refresh">⚠</span>}
            </span>
          ))}
        </div>
        <input
          className={styles.searchInput}
          placeholder="Search devices…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className={styles.refreshBtn} onClick={() => void refreshAll()} disabled={loading}>
          ↻
        </button>
      </header>

      {lastError && <div className={styles.errorBanner}>{lastError}</div>}

      {scenes.length > 0 && (
        <section className={styles.scenesRow}>
          {scenes.map((s) => <SceneChip key={s.id} scene={s} />)}
        </section>
      )}

      <main className={styles.main}>
        {groups.map((g) => (
          <RoomSection
            key={g.roomId}
            title={g.room?.name ?? 'Unassigned'}
            room={g.room}
            devices={g.devices}
            bridges={bridges}
          />
        ))}
        {groups.length === 0 && initialized && (
          <div className={styles.emptyHint}>
            Bridges connected, but no devices yet — try Settings → Bond → Refresh.
          </div>
        )}
      </main>
    </div>
  )
}
