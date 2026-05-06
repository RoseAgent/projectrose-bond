import { useState } from 'react'
import { scenesRun } from '../lib/api'
import type { BondScene } from '../lib/types'
import styles from '../PageView.module.css'

export function SceneChip({ scene }: { scene: BondScene }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = async (): Promise<void> => {
    setBusy(true); setErr(null)
    try {
      const res = await scenesRun(scene.id)
      if (!res.ok) setErr(res.error ?? 'Scene failed')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      className={`${styles.sceneChip} ${busy ? styles.sceneChipBusy : ''}`}
      onClick={run}
      disabled={busy}
      title={scene.description ?? scene.name}
    >
      <span className={styles.sceneChipIcon}>▶</span>
      <span>{scene.name}</span>
      {err && <span className={styles.sceneChipError} title={err}>!</span>}
    </button>
  )
}
