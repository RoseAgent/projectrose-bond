import { useMemo, useState } from 'react'
import { devicesAction } from '../lib/api'
import { DeviceCard } from './DeviceCard'
import type { BondDeviceView, BondRoom, BondConfiguredBridge } from '../lib/types'
import styles from '../PageView.module.css'

interface Props {
  title: string
  room?: BondRoom
  devices: BondDeviceView[]
  bridges: BondConfiguredBridge[]
  defaultOpen?: boolean
}

export function RoomSection({ title, room, devices, bridges, defaultOpen = true }: Props): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const [busy, setBusy] = useState(false)

  // "All on/off" is offered when every member supports the action.
  const allHave = (action: string): boolean => devices.length > 0 && devices.every((d) => d.actions.includes(action))
  const showAllOn  = allHave('TurnOn')
  const showAllOff = allHave('TurnOff')

  const fireAll = async (action: string): Promise<void> => {
    setBusy(true)
    try {
      await Promise.all(devices.map((d) => devicesAction(d.bondid, d.deviceId, action)))
    } finally {
      setBusy(false)
    }
  }

  const bridgeNameFor = useMemo(() => {
    const m = new Map(bridges.map((b) => [b.bondid, b.name]))
    return (bondid: string): string | undefined => m.get(bondid)
  }, [bridges])

  return (
    <section className={styles.roomSection}>
      <header className={styles.roomHeader}>
        <button
          className={styles.roomTitle}
          onClick={() => setOpen(!open)}
        >
          <span className={styles.roomToggle}>{open ? '▾' : '▸'}</span>
          <span>{title}</span>
          <span className={styles.roomCount}>({devices.length})</span>
        </button>
        {open && (showAllOn || showAllOff) && (
          <div className={styles.roomBulkBtns}>
            {showAllOn  && <button className={styles.cardBtn} disabled={busy} onClick={() => fireAll('TurnOn')}>All On</button>}
            {showAllOff && <button className={styles.cardBtn} disabled={busy} onClick={() => fireAll('TurnOff')}>All Off</button>}
          </div>
        )}
      </header>
      {open && (
        <div className={styles.deviceGrid}>
          {devices.length === 0 && (
            <div className={styles.emptyHint}>
              {room ? 'No devices assigned. Add some in Settings → Rooms.' : 'No devices.'}
            </div>
          )}
          {devices.map((d) => (
            <DeviceCard key={`${d.bondid}:${d.deviceId}`} device={d} bridgeName={bridgeNameFor(d.bondid)} />
          ))}
        </div>
      )}
    </section>
  )
}
