import type { BondClient } from './bondClient'
import type { DeviceCache } from './deviceCache'
import type {
  BondBridgeRecord,
  BondRoom,
  BondScene,
  BondSettings
} from './types'
import type { ExtensionToolEntry } from '../../../../ProjectRose/src/shared/extension-contract'
import { deviceTypeLabel } from './deviceCache'

export interface BondToolEnv {
  cache: DeviceCache
  getSettings: () => BondSettings
  bridges: () => BondBridgeRecord[]
  clientFor: (bondid: string) => BondClient | null
}

const TOGGLE_ACTION = 'TogglePower'

// ---- Resolution helpers -----------------------------------------------------

interface ResolvedDevice {
  bondid: string
  deviceId: string
  bridgeName: string
  effectiveName: string
}

interface TargetMatch {
  device?: ResolvedDevice
  room?: BondRoom
  scene?: BondScene
}

function bridgeName(bridges: BondBridgeRecord[], bondid: string): string {
  return bridges.find((b) => b.bondid === bondid)?.name ?? bondid
}

function listDevices(env: BondToolEnv): ResolvedDevice[] {
  const settings = env.getSettings()
  const bridges = env.bridges()
  return env.cache.resolveDisplay(settings.deviceOverrides, { aiOnly: true })
    .map((entry) => ({
      bondid: entry.meta.bondid,
      deviceId: entry.meta.deviceId,
      bridgeName: bridgeName(bridges, entry.meta.bondid),
      effectiveName: entry.effectiveName
    }))
}

function parseTarget(raw: string): { name: string; bridge: string | null } {
  const at = raw.lastIndexOf('@')
  if (at < 0) return { name: raw.trim(), bridge: null }
  return { name: raw.slice(0, at).trim(), bridge: raw.slice(at + 1).trim() }
}

function matchTarget(rawTarget: string, env: BondToolEnv): TargetMatch | { error: string } {
  const settings = env.getSettings()
  const { name, bridge } = parseTarget(rawTarget)
  if (!name) return { error: `Empty target` }

  const ciEq = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

  const scenes = settings.scenes.filter((s) => ciEq(s.name, name))
  const rooms = settings.rooms.filter((r) => ciEq(r.name, name))
  const devices = listDevices(env).filter((d) => {
    if (!ciEq(d.effectiveName, name)) return false
    if (bridge && !ciEq(d.bridgeName, bridge)) return false
    return true
  })

  const totalMatches = (scenes.length > 0 ? 1 : 0) + (rooms.length > 0 ? 1 : 0) + devices.length
  if (totalMatches === 0) {
    return { error: `No device, room, or scene named '${rawTarget}'` }
  }

  if (devices.length > 1) {
    const list = devices.map((d) => `${d.effectiveName}@${d.bridgeName}`).join(', ')
    return { error: `Ambiguous target '${name}' — multiple devices match: ${list}. Re-call with the @bridge qualifier.` }
  }

  const conflicting: string[] = []
  if (devices.length === 1) conflicting.push(`device '${devices[0]!.effectiveName}'`)
  if (rooms.length > 0) conflicting.push(`room '${rooms[0]!.name}'`)
  if (scenes.length > 0) conflicting.push(`scene '${scenes[0]!.name}'`)
  if (conflicting.length > 1) {
    return { error: `Ambiguous target '${name}' — matches ${conflicting.join(' and ')}. Rename one in Settings, or specify a different target.` }
  }

  if (devices.length === 1) return { device: devices[0]! }
  if (rooms.length === 1)   return { room: rooms[0]! }
  if (scenes.length === 1)  return { scene: scenes[0]! }
  return { error: 'Internal: no match selected' }
}

// ---- Tool: bond_list_devices -----------------------------------------------

export function makeListDevicesTool(env: BondToolEnv): ExtensionToolEntry {
  return {
    name: 'bond_list_devices',
    description:
      'List every Bond device, room, and scene available to control. ' +
      'Call this first when the user mentions home devices, lights, fans, shades, fireplaces, scenes, or rooms.',
    schema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    execute: async () => {
      const settings = env.getSettings()
      const bridges = env.bridges()
      const devicesEnriched = env.cache.resolveDisplay(settings.deviceOverrides, { aiOnly: true })

      const devices = devicesEnriched.map((entry) => ({
        name: entry.effectiveName,
        bridge: bridgeName(bridges, entry.meta.bondid),
        type: deviceTypeLabel(entry.meta.type),
        online: entry.online
      }))

      const rooms = settings.rooms.map((room) => ({
        name: room.name,
        members: room.deviceRefs.length
      }))

      const scenes = settings.scenes.map((s) => ({
        name: s.name,
        description: s.description ?? null
      }))

      const payload = { devices, rooms, scenes, bridges: bridges.map((b) => ({ name: b.name, bondid: b.bondid })) }
      return JSON.stringify(payload, null, 2)
    }
  }
}

// ---- Tool: bond_toggle_power -----------------------------------------------

export function makeTogglePowerTool(env: BondToolEnv): ExtensionToolEntry {
  return {
    name: 'bond_toggle_power',
    description:
      'Toggle power on a Bond device or room. ' +
      'For a device, flips its power. For a room, toggles every member device. ' +
      "If multiple devices share a name across bridges, append '@<bridge>' to disambiguate (e.g. 'Lamp@Upstairs').",
    schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: "Device or room name. Optional '@<bridge>' qualifier." }
      },
      required: ['target'],
      additionalProperties: false
    },
    execute: async (input) => {
      const target = String(input.target ?? '').trim()
      if (!target) return 'ERROR: target is required'

      const match = matchTarget(target, env)
      if ('error' in match) return `ERROR: ${match.error}`

      if (match.scene) {
        return `ERROR: '${match.scene.name}' is a scene; use scene playback in the UI to run it.`
      }

      if (match.device) {
        const client = env.clientFor(match.device.bondid)
        if (!client) return `ERROR: Bridge '${match.device.bridgeName}' is offline`
        try {
          await client.runAction(match.device.deviceId, TOGGLE_ACTION, {})
          return `OK: Toggled ${match.device.effectiveName}`
        } catch (err) {
          return `ERROR: ${match.device.effectiveName}: ${(err as Error).message}`
        }
      }

      if (match.room) {
        const memberRefs = match.room.deviceRefs
          .map((ref) => {
            const entry = env.cache.get(ref.bondid, ref.deviceId)
            const settings = env.getSettings()
            const k = `${ref.bondid}:${ref.deviceId}`
            const ov = settings.deviceOverrides[k] ?? {}
            return entry
              ? {
                  bondid: entry.meta.bondid,
                  deviceId: entry.meta.deviceId,
                  effectiveName: ov.name?.trim() || entry.meta.name
                }
              : null
          })
          .filter((e): e is NonNullable<typeof e> => e !== null)

        if (memberRefs.length === 0) {
          return `ERROR: Room '${match.room.name}' has no devices`
        }

        const results = await Promise.all(memberRefs.map(async (m) => {
          const client = env.clientFor(m.bondid)
          if (!client) return { name: m.effectiveName, ok: false, err: 'bridge offline' }
          try {
            await client.runAction(m.deviceId, TOGGLE_ACTION, {})
            return { name: m.effectiveName, ok: true }
          } catch (err) {
            return { name: m.effectiveName, ok: false, err: (err as Error).message }
          }
        }))

        const ok = results.filter((r) => r.ok)
        const fail = results.filter((r) => !r.ok)
        if (fail.length > 0) {
          return `ERROR: ${match.room.name} toggle partial failure. Succeeded: ${ok.map((r) => r.name).join(', ') || '(none)'}. Failed: ${fail.map((r) => `${r.name} (${r.err})`).join(', ')}`
        }
        return `OK: Toggled ${ok.length} device(s) in ${match.room.name}`
      }

      return `ERROR: No match for target '${target}'`
    }
  }
}
