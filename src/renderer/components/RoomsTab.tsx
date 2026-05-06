import { useState } from 'react'
import { useBondStore, effectiveName } from '../store'
import { roomsRemove, roomsUpsert } from '../lib/api'
import type { BondRoom } from '../lib/types'
import styles from '../SettingsView.module.css'

function newRoomId(): string {
  return `room-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export function RoomsTab(): JSX.Element {
  const rooms = useBondStore((s) => s.rooms)
  const refresh = useBondStore((s) => s.refreshRooms)

  const [draft, setDraft] = useState('')

  const addRoom = async (): Promise<void> => {
    const name = draft.trim()
    if (!name) return
    await roomsUpsert({ id: newRoomId(), name, deviceRefs: [] })
    setDraft('')
    await refresh()
  }

  return (
    <div>
      <section className={styles.section}>
        <div className={styles.sectionTitle}>Add room</div>
        <div className={styles.formInline}>
          <input
            className={styles.input}
            style={{ flex: 1 }}
            placeholder="Room name (e.g. Living Room)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addRoom() }}
          />
          <button className={styles.btnPrimary} onClick={addRoom} disabled={!draft.trim()}>Add</button>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>Rooms</div>
        {rooms.length === 0
          ? <div className={styles.sectionHint}>No rooms yet. Add one above to organize devices.</div>
          : <div className={styles.cardList}>{rooms.map((r) => <RoomEditor key={r.id} room={r} onChange={refresh} />)}</div>
        }
      </section>
    </div>
  )
}

function RoomEditor({ room, onChange }: { room: BondRoom; onChange: () => Promise<void> }): JSX.Element {
  const devices = useBondStore((s) => s.devices)
  const bridges = useBondStore((s) => s.configuredBridges)

  const [name, setName] = useState(room.name)
  const [busy, setBusy] = useState(false)

  const isMember = (bondid: string, deviceId: string): boolean =>
    room.deviceRefs.some((r) => r.bondid === bondid && r.deviceId === deviceId)

  const toggleMember = async (bondid: string, deviceId: string, on: boolean): Promise<void> => {
    setBusy(true)
    try {
      const next = on
        ? [...room.deviceRefs, { bondid, deviceId }]
        : room.deviceRefs.filter((r) => !(r.bondid === bondid && r.deviceId === deviceId))
      await roomsUpsert({ ...room, deviceRefs: next })
      await onChange()
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await roomsUpsert({ ...room, name: name.trim() || room.name })
      await onChange()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!confirm(`Delete room '${room.name}'? Devices stay where they are; only the grouping is removed.`)) return
    await roomsRemove(room.id)
    await onChange()
  }

  const bridgeNameOf = (bondid: string): string => bridges.find((b) => b.bondid === bondid)?.name ?? bondid

  return (
    <div className={styles.bridgeCard}>
      <div className={styles.bridgeCardHeader}>
        <input
          className={styles.inlineInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') void save() }}
          style={{ fontSize: 14, fontWeight: 600, flex: 1 }}
        />
        <button className={styles.btnSm} style={{ color: 'var(--color-error, #dc3545)' }} onClick={remove}>Delete</button>
      </div>

      <div className={styles.deviceCheckList}>
        {devices.length === 0
          ? <div className={styles.sectionHint}>No devices to assign yet.</div>
          : devices.map((d) => (
              <div key={`${d.bondid}:${d.deviceId}`} className={styles.deviceCheckRow}>
                <input
                  type="checkbox"
                  checked={isMember(d.bondid, d.deviceId)}
                  disabled={busy}
                  onChange={(e) => void toggleMember(d.bondid, d.deviceId, e.target.checked)}
                />
                <span style={{ flex: 1 }}>{effectiveName(d)}</span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>{bridgeNameOf(d.bondid)}</span>
              </div>
            ))
        }
      </div>
    </div>
  )
}
