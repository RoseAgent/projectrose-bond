import { useEffect, useState } from 'react'
import { useBondStore, effectiveName } from '../store'
import {
  bridgesAdd,
  bridgesRemove,
  bridgesRename,
  bridgesVerify,
  deviceDelete,
  deviceOverride,
  deviceRefresh
} from '../lib/api'
import type { BondConfiguredBridge, BondDeviceView, DiscoveredBridge } from '../lib/types'
import styles from '../SettingsView.module.css'

export function BridgesTab(): JSX.Element {
  const bridges = useBondStore((s) => s.configuredBridges)
  const discovered = useBondStore((s) => s.discoveredBridges)
  const devices = useBondStore((s) => s.devices)
  const rooms = useBondStore((s) => s.rooms)
  const refreshBridges = useBondStore((s) => s.refreshBridges)
  const refreshDevices = useBondStore((s) => s.refreshDevices)

  const configuredIds = new Set(bridges.map((b) => b.bondid))
  const newDiscovered = discovered.filter((d) => !configuredIds.has(d.bondid))

  return (
    <div>
      <section className={styles.section}>
        <div className={styles.sectionTitle}>Discovered on your network</div>
        {newDiscovered.length === 0 ? (
          <div className={styles.sectionHint}>
            {discovered.length === 0
              ? 'Listening for Bond bridges via mDNS… If yours doesn\'t appear, add it manually below.'
              : 'No new bridges. Already-configured bridges are listed below.'}
          </div>
        ) : (
          <div className={styles.cardList}>
            {newDiscovered.map((d) => (
              <DiscoveredBridgeCard key={d.bondid} bridge={d} onAdded={refreshBridges} />
            ))}
          </div>
        )}
      </section>

      <ManualAddBridge onAdded={refreshBridges} />

      <div className={styles.divider} />

      <section className={styles.section}>
        <div className={styles.sectionTitle}>Configured bridges</div>
        {bridges.length === 0 ? (
          <div className={styles.sectionHint}>No bridges yet.</div>
        ) : (
          <div className={styles.cardList}>
            {bridges.map((b) => (
              <ConfiguredBridgeCard
                key={b.bondid}
                bridge={b}
                devices={devices.filter((d) => d.bondid === b.bondid)}
                rooms={rooms}
                onRefresh={() => { void refreshDevices(); void refreshBridges() }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// ---- Discovered card -------------------------------------------------------

function DiscoveredBridgeCard({ bridge, onAdded }: { bridge: DiscoveredBridge; onAdded: () => void }): JSX.Element {
  const [token, setToken] = useState('')
  const [name, setName] = useState(bridge.model ? `Bond ${bridge.model}` : `Bond ${bridge.bondid}`)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const add = async (): Promise<void> => {
    if (!token.trim()) { setErr('Token required'); return }
    setBusy(true); setErr(null)
    try {
      const res = await bridgesAdd(bridge.ip, token.trim(), name.trim())
      if (res.ok) {
        onAdded()
      } else {
        setErr(res.error)
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.bridgeCard}>
      <div className={styles.bridgeCardHeader}>
        <div>
          <div className={styles.bridgeName}>{bridge.bondid}</div>
          <div className={styles.bridgeMeta}>
            {bridge.ip}{bridge.model ? ` • ${bridge.model}` : ''}{bridge.fw ? ` • fw ${bridge.fw}` : ''}
          </div>
        </div>
      </div>
      <div className={styles.formInline}>
        <input
          className={styles.inlineInput}
          style={{ flex: 1, minWidth: 200 }}
          placeholder="Display name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={styles.inlineInput}
          style={{ flex: 2, minWidth: 240 }}
          type="password"
          placeholder="Local token (Bond app → Advanced Settings)"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button className={styles.btnPrimary} onClick={add} disabled={busy}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
      {err && <div className={styles.errorText}>{err}</div>}
    </div>
  )
}

// ---- Manual add -----------------------------------------------------------

function ManualAddBridge({ onAdded }: { onAdded: () => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [ip, setIp] = useState('')
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const submit = async (mode: 'verify' | 'add'): Promise<void> => {
    if (!ip.trim() || !token.trim()) { setErr('IP and token required'); return }
    setBusy(true); setErr(null); setHint(null)
    try {
      if (mode === 'verify') {
        const res = await bridgesVerify(ip.trim(), token.trim())
        if (res.ok) {
          setHint(`Verified: ${res.bondid}${res.model ? ' (' + res.model + ')' : ''}`)
        } else {
          setErr(res.error)
        }
      } else {
        const res = await bridgesAdd(ip.trim(), token.trim(), name.trim() || undefined)
        if (res.ok) {
          setIp(''); setToken(''); setName('')
          setOpen(false)
          onAdded()
        } else {
          setErr(res.error)
        }
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <section className={styles.section}>
        <button className={styles.btn} onClick={() => setOpen(true)}>+ Add bridge manually</button>
      </section>
    )
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionTitle}>Add bridge manually</div>
      <div className={styles.row}>
        <label className={styles.label}>Bridge IP</label>
        <input className={styles.input} placeholder="192.168.1.50" value={ip} onChange={(e) => setIp(e.target.value)} />
      </div>
      <div className={styles.row}>
        <label className={styles.label}>Local token</label>
        <input className={styles.input} type="password" placeholder="From Bond app → Advanced Settings" value={token} onChange={(e) => setToken(e.target.value)} />
      </div>
      <div className={styles.row}>
        <label className={styles.label}>Display name (optional)</label>
        <input className={styles.input} placeholder="e.g. Upstairs" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className={styles.formInline}>
        <button className={styles.btn} onClick={() => submit('verify')} disabled={busy}>Verify</button>
        <button className={styles.btnPrimary} onClick={() => submit('add')} disabled={busy}>{busy ? 'Working…' : 'Add'}</button>
        <button className={styles.btnGhost} onClick={() => { setOpen(false); setErr(null); setHint(null) }}>Cancel</button>
      </div>
      {hint && <div className={styles.successText}>{hint}</div>}
      {err && <div className={styles.errorText}>{err}</div>}
    </section>
  )
}

// ---- Configured card ------------------------------------------------------

function ConfiguredBridgeCard({
  bridge, devices, rooms, onRefresh
}: {
  bridge: BondConfiguredBridge
  devices: BondDeviceView[]
  rooms: ReturnType<typeof useBondStore.getState>['rooms']
  onRefresh: () => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(bridge.name)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setDraftName(bridge.name) }, [bridge.name])

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await bridgesRename(bridge.bondid, draftName.trim())
      setEditing(false)
      onRefresh()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!confirm(`Remove bridge ${bridge.name}? This unlinks all of its devices, rooms members, and scene steps.`)) return
    await bridgesRemove(bridge.bondid)
    onRefresh()
  }

  const refresh = async (): Promise<void> => {
    setBusy(true)
    try {
      await deviceRefresh(bridge.bondid)
      onRefresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.bridgeCard}>
      <div className={styles.bridgeCardHeader}>
        <div>
          {editing ? (
            <input
              className={styles.inlineInput}
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') { setEditing(false); setDraftName(bridge.name) } }}
            />
          ) : (
            <div className={styles.bridgeName} onDoubleClick={() => setEditing(true)} title="Double-click to rename">
              {bridge.name}
            </div>
          )}
          <div className={styles.bridgeMeta}>
            {bridge.bondid} • {bridge.lastIp ?? 'unknown IP'} • {bridge.status.online ? 'online' : 'offline'} • bpup: {bridge.status.bpup}
          </div>
        </div>
        <div className={styles.bridgeActions}>
          <button className={styles.btnSm} onClick={refresh} disabled={busy}>Refresh</button>
          <button className={styles.btnSm} onClick={() => setEditing(true)}>Rename</button>
          <button className={styles.btnSm} style={{ color: 'var(--color-error, #dc3545)' }} onClick={remove}>Remove</button>
        </div>
      </div>

      {devices.length > 0 && (
        <div className={styles.deviceList}>
          {devices.map((d) => (
            <DeviceRow key={d.deviceId} device={d} rooms={rooms} onChange={onRefresh} />
          ))}
        </div>
      )}
    </div>
  )
}

function DeviceRow({
  device, rooms, onChange
}: {
  device: BondDeviceView
  rooms: ReturnType<typeof useBondStore.getState>['rooms']
  onChange: () => void
}): JSX.Element {
  const [name, setName] = useState(device.override?.name ?? '')
  const [exposeToAi, setExposeToAi] = useState(device.override?.exposeToAi !== false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(device.override?.name ?? '')
    setExposeToAi(device.override?.exposeToAi !== false)
  }, [device.override?.name, device.override?.exposeToAi])

  const saveName = async (): Promise<void> => {
    await deviceOverride(device.bondid, device.deviceId, {
      ...device.override,
      name: name.trim() || undefined
    })
    onChange()
  }

  const toggleAi = async (val: boolean): Promise<void> => {
    setExposeToAi(val)
    await deviceOverride(device.bondid, device.deviceId, {
      ...device.override,
      exposeToAi: val
    })
    onChange()
  }

  const remove = async (): Promise<void> => {
    if (!confirm(
      `Delete device '${effectiveName(device)}' from the bridge?\n\n` +
      `This permanently removes the device and all its learned commands from the Bond bridge. ` +
      `It will also be removed from any rooms or scenes here. This cannot be undone.`
    )) return
    setBusy(true)
    try {
      const res = await deviceDelete(device.bondid, device.deviceId)
      if (!res.ok) alert(`Failed to delete: ${res.error}`)
      else onChange()
    } finally {
      setBusy(false)
    }
  }

  // Find which room (if any) currently contains this device.
  const inRoom = rooms.find((r) => r.deviceRefs.some((ref) => ref.bondid === device.bondid && ref.deviceId === device.deviceId))?.name ?? '—'

  return (
    <div className={styles.deviceRow}>
      <div title={device.bondReportedName}>{effectiveName(device)}</div>
      <input
        className={styles.inlineInput}
        placeholder={`Override "${device.bondReportedName}"`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => { if (e.key === 'Enter') void saveName() }}
      />
      <span className={styles.deviceMeta}>Room: {inRoom}</span>
      <label className={styles.checkboxRow} title="Expose this device to the AI">
        <input type="checkbox" checked={exposeToAi} onChange={(e) => void toggleAi(e.target.checked)} />
        <span>AI</span>
      </label>
      <button
        className={styles.btnSm}
        style={{ color: 'var(--color-error, #dc3545)' }}
        onClick={remove}
        disabled={busy}
        title="Delete device from bridge"
      >
        ×
      </button>
    </div>
  )
}
