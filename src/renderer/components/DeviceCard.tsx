import { useState } from 'react'
import { devicesToggle } from '../lib/api'
import { effectiveName } from '../store'
import type { BondDeviceView } from '../lib/types'
import styles from '../PageView.module.css'

interface DeviceCardProps {
  device: BondDeviceView
  bridgeName?: string
}

export function DeviceCard({ device, bridgeName }: DeviceCardProps): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const toggle = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      const res = await devicesToggle(device.bondid, device.deviceId)
      if (!res.ok) setErr(res.error ?? 'Toggle failed')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`${styles.card} ${!device.online ? styles.cardOffline : ''}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <span className={styles.cardName}>{effectiveName(device)}</span>
        </div>
        {bridgeName && <span className={styles.cardBridge}>{bridgeName}</span>}
      </div>

      <div className={styles.cardBody}>
        <button disabled={busy} onClick={toggle} className={styles.cardBtn}>Toggle</button>
        {err && <div className={styles.cardError}>{err}</div>}
      </div>
    </div>
  )
}
