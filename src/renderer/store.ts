import { create } from 'zustand'
import {
  bridgesList,
  bridgesDiscover,
  devicesList,
  roomsList,
  scenesList,
  onBridgeStatus,
  onDevicesChanged,
  onDiscovered,
  onSettingsChanged
} from './lib/api'
import type {
  BondBridgeStatus,
  BondConfiguredBridge,
  BondDeviceView,
  BondRoom,
  BondScene,
  DiscoveredBridge
} from './lib/types'

interface BondStoreState {
  configuredBridges: BondConfiguredBridge[]
  discoveredBridges: DiscoveredBridge[]
  devices: BondDeviceView[]
  rooms: BondRoom[]
  scenes: BondScene[]
  loading: boolean
  initialized: boolean
  lastError: string | null

  init: () => Promise<void>
  refreshAll: () => Promise<void>
  refreshDevices: () => Promise<void>
  refreshBridges: () => Promise<void>
  refreshRooms: () => Promise<void>
  refreshScenes: () => Promise<void>
  setError: (msg: string | null) => void
}

let bound = false
let unsubscribers: Array<() => void> = []

export const useBondStore = create<BondStoreState>((set, get) => ({
  configuredBridges: [],
  discoveredBridges: [],
  devices: [],
  rooms: [],
  scenes: [],
  loading: false,
  initialized: false,
  lastError: null,

  init: async () => {
    if (get().initialized) return
    set({ loading: true })
    try {
      await get().refreshAll()
      // Kick off discovery — main returns the snapshot from already-running browse.
      try {
        const { discovered } = await bridgesDiscover()
        set({ discoveredBridges: discovered })
      } catch { /* discovery is best-effort */ }

      if (!bound) {
        unsubscribers = [
          onBridgeStatus((status: BondBridgeStatus) => {
            set((s) => ({
              configuredBridges: s.configuredBridges.map((b) =>
                b.bondid === status.bondid ? { ...b, status } : b
              )
            }))
          }),
          onDevicesChanged(() => {
            void get().refreshDevices()
          }),
          onDiscovered(({ bridges }) => {
            set({ discoveredBridges: bridges })
          }),
          onSettingsChanged(() => {
            // Settings can change from anywhere (rename, override, etc.).
            // Re-pull bridges/rooms/scenes; devices are fine because the
            // main process broadcasts a separate devices.changed for that.
            void get().refreshBridges()
            void get().refreshRooms()
            void get().refreshScenes()
          })
        ]
        bound = true
      }
      set({ initialized: true })
    } catch (err) {
      set({ lastError: (err as Error).message })
    } finally {
      set({ loading: false })
    }
  },

  refreshAll: async () => {
    await Promise.all([
      get().refreshBridges(),
      get().refreshDevices(),
      get().refreshRooms(),
      get().refreshScenes()
    ])
  },

  refreshBridges: async () => {
    const { configured } = await bridgesList()
    set({ configuredBridges: configured })
  },

  refreshDevices: async () => {
    const { devices } = await devicesList()
    set({ devices })
  },

  refreshRooms: async () => {
    const { rooms } = await roomsList()
    set({ rooms })
  },

  refreshScenes: async () => {
    const { scenes } = await scenesList()
    set({ scenes })
  },

  setError: (msg) => set({ lastError: msg })
}))

/** Effective name = override.name || bondReportedName. */
export function effectiveName(d: BondDeviceView): string {
  return d.override?.name?.trim() || d.name || d.bondReportedName
}

/** Group devices by room. Returns { roomId: 'unassigned' | id, room?, devices }[]. */
export function groupDevicesByRoom(devices: BondDeviceView[], rooms: BondRoom[]): Array<{ roomId: string; room?: BondRoom; devices: BondDeviceView[] }> {
  const claimed = new Set<string>()
  const groups: Array<{ roomId: string; room?: BondRoom; devices: BondDeviceView[] }> = []

  for (const room of rooms) {
    const inRoom: BondDeviceView[] = []
    for (const ref of room.deviceRefs) {
      const d = devices.find((x) => x.bondid === ref.bondid && x.deviceId === ref.deviceId)
      if (d) {
        inRoom.push(d)
        claimed.add(`${d.bondid}:${d.deviceId}`)
      }
    }
    groups.push({ roomId: room.id, room, devices: inRoom })
  }

  const unassigned = devices.filter((d) => !claimed.has(`${d.bondid}:${d.deviceId}`))
  if (unassigned.length > 0) {
    groups.push({ roomId: 'unassigned', devices: unassigned })
  }

  return groups
}

