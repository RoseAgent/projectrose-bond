import { useEffect, useRef, useState } from 'react'
import { useBondStore, effectiveName } from '../store'
import { learnAssign, learnStart, learnStop, onLearnCaptured, onLearnStatus } from '../lib/api'
import type { CapturedSignal, DeviceType } from '../lib/types'
import styles from '../SettingsView.module.css'

const COMMON_ACTIONS = [
  'TurnOn', 'TurnOff', 'TurnLightOn', 'TurnLightOff',
  'IncreaseSpeed', 'DecreaseSpeed', 'SetSpeed1', 'SetSpeed2', 'SetSpeed3',
  'Open', 'Close', 'Hold', 'Stop',
  'IncreaseFlame', 'DecreaseFlame'
]

const DEVICE_TYPES: Array<{ value: DeviceType; label: string }> = [
  { value: 'CF', label: 'Ceiling Fan' },
  { value: 'FP', label: 'Fireplace' },
  { value: 'MS', label: 'Motorized Shade' },
  { value: 'GX', label: 'Generic' }
]

export function LearnTab(): JSX.Element {
  const bridges = useBondStore((s) => s.configuredBridges)
  const devices = useBondStore((s) => s.devices)

  const [bondid, setBondid] = useState<string>(bridges[0]?.bondid ?? '')
  const [active, setActive] = useState(false)
  const [scanLog, setScanLog] = useState<string[]>([])
  const [captures, setCaptures] = useState<CapturedSignal[]>([])

  // Default-select first bridge once one becomes available.
  useEffect(() => {
    if (!bondid && bridges.length > 0) setBondid(bridges[0]!.bondid)
  }, [bridges, bondid])

  useEffect(() => {
    const off1 = onLearnCaptured((sig) => {
      // Ignore captures from other bridges if user has multiple sessions
      if (bondid && sig.bondid !== bondid) return
      setCaptures((prev) => [sig, ...prev])
    })
    const off2 = onLearnStatus((msg) => {
      if (bondid && msg.bondid !== bondid) return
      if (typeof msg.active === 'boolean') setActive(msg.active)
      if (msg.error) setScanLog((p) => [`Error: ${msg.error}`, ...p].slice(0, 8))
      if (msg.scanRestarted) setScanLog((p) => [`Scan re-armed at ${new Date().toLocaleTimeString()}`, ...p].slice(0, 8))
    })
    return () => { off1(); off2() }
  }, [bondid])

  const start = async (): Promise<void> => {
    if (!bondid) return
    setCaptures([])
    setScanLog([])
    const res = await learnStart(bondid)
    if (!res.ok) setScanLog([`Start failed: ${res.error}`])
  }

  const stop = async (): Promise<void> => {
    if (!bondid) return
    await learnStop(bondid)
  }

  const dropCapture = (id: string): void => {
    setCaptures((prev) => prev.filter((c) => c.id !== id))
  }

  if (bridges.length === 0) {
    return <div className={styles.sectionHint}>Add a Bond bridge first (Bridges tab) before learning new remotes.</div>
  }

  const bridgeDevices = devices.filter((d) => d.bondid === bondid)

  return (
    <div>
      <section className={styles.section}>
        <div className={styles.sectionTitle}>Capture session</div>
        <div className={styles.formInline}>
          <select
            className={styles.select}
            value={bondid}
            onChange={(e) => setBondid(e.target.value)}
            disabled={active}
          >
            {bridges.map((b) => <option key={b.bondid} value={b.bondid}>{b.name} ({b.bondid})</option>)}
          </select>
          {!active
            ? <button className={styles.btnPrimary} onClick={start}>Start capturing</button>
            : <button className={styles.btn} onClick={stop}>Stop</button>
          }
          <span className={styles.kbdHint}>
            {active
              ? 'Listening… press a button on a physical remote within range of the bridge.'
              : 'Click Start, then press buttons on a remote to capture them.'}
          </span>
        </div>
        {scanLog.length > 0 && (
          <div className={styles.kbdHint} style={{ marginTop: 8 }}>
            {scanLog.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>Captured signals</div>
        {captures.length === 0
          ? <div className={styles.sectionHint}>No signals yet. Press a remote button while a capture session is active.</div>
          : captures.map((c) => (
              <CaptureCard
                key={c.id}
                capture={c}
                bridgeDevices={bridgeDevices}
                onAssigned={() => dropCapture(c.id)}
                onDismiss={() => dropCapture(c.id)}
              />
            ))
        }
      </section>
    </div>
  )
}

function CaptureCard({
  capture, bridgeDevices, onAssigned, onDismiss
}: {
  capture: CapturedSignal
  bridgeDevices: ReturnType<typeof useBondStore.getState>['devices']
  onAssigned: () => void
  onDismiss: () => void
}): JSX.Element {
  const [mode, setMode] = useState<'existing' | 'new'>(bridgeDevices.length > 0 ? 'existing' : 'new')
  const [deviceId, setDeviceId] = useState<string>(bridgeDevices[0]?.deviceId ?? '')
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<DeviceType>('GX')
  const [actionName, setActionName] = useState('TurnOn')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const refList = useRef<HTMLDataListElement>(null)

  const assign = async (): Promise<void> => {
    setBusy(true); setErr(null)
    try {
      const res = await learnAssign(capture.bondid, capture, {
        deviceId: mode === 'existing' ? deviceId : null,
        newDevice: mode === 'new' ? { name: newName.trim() || 'New Device', type: newType } : undefined,
        actionName: actionName.trim() || 'TurnOn'
      })
      if (res.ok) {
        onAssigned()
      } else {
        setErr(res.error)
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const sigSummary = (): string => {
    const s = capture.signal as Record<string, unknown>
    const parts = []
    if (s['freq']) parts.push(`${s['freq']} Hz`)
    if (s['bps'])  parts.push(`${s['bps']} bps`)
    if (s['encoding']) parts.push(String(s['encoding']))
    if (s['modulation']) parts.push(String(s['modulation']))
    const data = String(s['data'] ?? '')
    if (data) parts.push(`data: ${data.slice(0, 24)}${data.length > 24 ? '…' : ''}`)
    return parts.join(' • ') || JSON.stringify(s).slice(0, 80)
  }

  return (
    <div className={styles.captureCard}>
      <div className={styles.captureMeta}>
        Captured {new Date(capture.capturedAtMs).toLocaleTimeString()} • {sigSummary()}
      </div>

      <div className={styles.formInline} style={{ marginBottom: 6 }}>
        <label className={styles.checkboxRow}>
          <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} disabled={bridgeDevices.length === 0} />
          <span>Add to existing device</span>
        </label>
        <label className={styles.checkboxRow}>
          <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
          <span>Create new device</span>
        </label>
      </div>

      <div className={styles.assignGrid}>
        {mode === 'existing' ? (
          <select className={styles.inlineInput} value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            {bridgeDevices.map((d) => <option key={d.deviceId} value={d.deviceId}>{effectiveName(d)}</option>)}
          </select>
        ) : (
          <>
            <input
              className={styles.inlineInput}
              placeholder="New device name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <select className={styles.inlineInput} value={newType} onChange={(e) => setNewType(e.target.value as DeviceType)}>
              {DEVICE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </>
        )}
        <input
          className={styles.inlineInput}
          placeholder="Action name (e.g. TurnOn)"
          value={actionName}
          onChange={(e) => setActionName(e.target.value)}
          list={`actions-${capture.id}`}
        />
        <datalist id={`actions-${capture.id}`} ref={refList}>
          {COMMON_ACTIONS.map((a) => <option key={a} value={a} />)}
        </datalist>
      </div>

      <div className={styles.formInline} style={{ marginTop: 8 }}>
        <button className={styles.btnPrimary} onClick={assign} disabled={busy}>{busy ? 'Saving…' : 'Assign & save'}</button>
        <button className={styles.btnGhost} onClick={onDismiss}>Discard</button>
      </div>
      {err && <div className={styles.errorText}>{err}</div>}
    </div>
  )
}
