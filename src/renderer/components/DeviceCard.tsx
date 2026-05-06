import { useState } from 'react'
import { devicesAction } from '../lib/api'
import { effectiveName, isOn } from '../store'
import type { BondDeviceView } from '../lib/types'
import styles from '../PageView.module.css'

interface DeviceCardProps {
  device: BondDeviceView
  bridgeName?: string
}

export function DeviceCard({ device, bridgeName }: DeviceCardProps): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const fire = async (action: string, params?: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      const res = await devicesAction(device.bondid, device.deviceId, action, params)
      if (!res.ok) setErr(res.error ?? 'Action failed')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const has = (action: string): boolean => device.actions.includes(action)
  const on = isOn(device)

  return (
    <div className={`${styles.card} ${!device.online ? styles.cardOffline : ''}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <span
            className={`${styles.statusDot} ${on ? styles.statusDotOn : styles.statusDotOff}`}
            title={device.online ? (on ? 'On' : 'Off') : 'Bridge offline'}
          />
          <span className={styles.cardName}>{effectiveName(device)}</span>
        </div>
        {bridgeName && <span className={styles.cardBridge}>{bridgeName}</span>}
      </div>

      <div className={styles.cardBody}>
        {/* Primary on/off */}
        {(has('TurnOn') || has('TurnOff')) && (
          <div className={styles.cardButtonRow}>
            {has('TurnOn') && (
              <button
                disabled={busy}
                onClick={() => fire('TurnOn')}
                className={`${styles.cardBtn} ${on ? styles.cardBtnPrimary : ''}`}
              >On</button>
            )}
            {has('TurnOff') && (
              <button
                disabled={busy}
                onClick={() => fire('TurnOff')}
                className={`${styles.cardBtn} ${!on ? styles.cardBtnPrimary : ''}`}
              >Off</button>
            )}
          </div>
        )}

        {/* Fan: speed slider + reverse */}
        {has('SetSpeed') && (
          <FanSpeedSlider
            value={Number(device.state.speed) || 0}
            disabled={busy}
            onChange={(v) => fire('SetSpeed', { argument: v })}
          />
        )}
        {has('SetDirection') && (
          <button
            disabled={busy}
            onClick={() => fire('SetDirection', { argument: device.state.direction === 1 ? -1 : 1 })}
            className={styles.cardBtn}
            title="Reverse"
          >Reverse</button>
        )}

        {/* Light controls (fans + fireplaces with light) */}
        {(has('TurnLightOn') || has('TurnLightOff')) && (
          <div className={styles.cardButtonRow}>
            {has('TurnLightOn') && (
              <button disabled={busy} onClick={() => fire('TurnLightOn')} className={styles.cardBtn}>Light On</button>
            )}
            {has('TurnLightOff') && (
              <button disabled={busy} onClick={() => fire('TurnLightOff')} className={styles.cardBtn}>Light Off</button>
            )}
          </div>
        )}

        {has('SetBrightness') && (
          <PercentSlider
            label="Brightness"
            value={Number(device.state.brightness) || 0}
            disabled={busy}
            onChange={(v) => fire('SetBrightness', { argument: v })}
          />
        )}

        {/* Fireplace flame */}
        {has('SetFlame') && (
          <PercentSlider
            label="Flame"
            value={Number(device.state.flame) || 0}
            disabled={busy}
            onChange={(v) => fire('SetFlame', { argument: v })}
          />
        )}

        {/* Shades */}
        {has('Open') && (
          <div className={styles.cardButtonRow}>
            <button disabled={busy} onClick={() => fire('Open')}  className={styles.cardBtn}>Open</button>
            {has('Close') && <button disabled={busy} onClick={() => fire('Close')} className={styles.cardBtn}>Close</button>}
            {has('Hold')  && <button disabled={busy} onClick={() => fire('Hold')}  className={styles.cardBtn}>Hold</button>}
          </div>
        )}
        {has('SetPosition') && (
          <PercentSlider
            label="Position"
            value={Number(device.state.position) || 0}
            disabled={busy}
            onChange={(v) => fire('SetPosition', { argument: v })}
          />
        )}

        {/* Generic — render every action that didn't get a dedicated control */}
        <GenericActions device={device} fire={fire} busy={busy} />

        {err && <div className={styles.cardError}>{err}</div>}
      </div>
    </div>
  )
}

function FanSpeedSlider({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (v: number) => void }): JSX.Element {
  // Bond Pro fans are typically 1–6. We don't know the exact max from /v2 — use 6
  // as a safe upper bound; the bridge will reject out-of-range values.
  const max = 6
  return (
    <div className={styles.sliderRow}>
      <label className={styles.sliderLabel}>Speed: {value || '—'}</label>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (v === 0) return  // ignore — speed 0 = off, use TurnOff instead
          onChange(v)
        }}
      />
    </div>
  )
}

function PercentSlider({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (v: number) => void }): JSX.Element {
  const [draft, setDraft] = useState<number | null>(null)
  const v = draft ?? value
  return (
    <div className={styles.sliderRow}>
      <label className={styles.sliderLabel}>{label}: {v}%</label>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={v}
        disabled={disabled}
        onChange={(e) => setDraft(Number(e.target.value))}
        onMouseUp={() => { if (draft !== null) { onChange(draft); setDraft(null) } }}
        onTouchEnd={() => { if (draft !== null) { onChange(draft); setDraft(null) } }}
      />
    </div>
  )
}

const HANDLED_ACTIONS = new Set([
  'TurnOn', 'TurnOff',
  'SetSpeed', 'SetDirection',
  'TurnLightOn', 'TurnLightOff', 'SetBrightness',
  'SetFlame',
  'Open', 'Close', 'Hold', 'SetPosition'
])

function GenericActions({ device, fire, busy }: { device: BondDeviceView; fire: (action: string, params?: Record<string, unknown>) => void; busy: boolean }): JSX.Element | null {
  const extras = device.actions.filter((a) => !HANDLED_ACTIONS.has(a))
  if (extras.length === 0) return null
  return (
    <div className={styles.genericActions}>
      <div className={styles.genericLabel}>Other</div>
      <div className={styles.cardButtonRow}>
        {extras.map((a) => (
          <button key={a} disabled={busy} onClick={() => fire(a)} className={styles.cardBtnSm} title={a}>
            {a}
          </button>
        ))}
      </div>
    </div>
  )
}
