import type { BondClient, CapturedSignalRaw } from './bondClient'
import type { CapturedSignal, DeviceType } from './types'

const POLL_INTERVAL_MS = 800
// Bond auto-times out scans after ~60s — re-arm well before that.
const SCAN_REARM_INTERVAL_MS = 30_000

export interface LearnSession {
  bondid: string
  isActive: () => boolean
  stop: () => Promise<void>
}

export interface LearnCallbacks {
  onCapture: (signal: CapturedSignal) => void
  onError: (err: Error) => void
  onScanRestart?: () => void
}

function signalFingerprint(sig: CapturedSignalRaw): string {
  // Bond's signal payload identifies an IR/RF capture by data + freq + bps.
  // Stable enough to dedupe within a polling burst.
  const data = String((sig as Record<string, unknown>)['data'] ?? '')
  const freq = String((sig as Record<string, unknown>)['freq'] ?? '')
  const bps  = String((sig as Record<string, unknown>)['bps']  ?? '')
  return `${freq}|${bps}|${data}`
}

/**
 * Begin a free-form IR/RF learn session against a bridge. The bridge is kept
 * in signal-scan mode by re-issuing a 60s scan command before each timeout.
 * /v2/sys/signal is polled at POLL_INTERVAL_MS; new captures (deduped by
 * data fingerprint) are emitted via onCapture.
 */
export function startLearnSession(client: BondClient, callbacks: LearnCallbacks): LearnSession {
  let stopped = false
  let pollTimer: NodeJS.Timeout | null = null
  let scanTimer: NodeJS.Timeout | null = null
  const seen = new Set<string>()

  const restartScan = async (): Promise<void> => {
    if (stopped) return
    try {
      // No body — scans all RF frequencies. (Pass {freq: 38} to scan IR-only.)
      await client.startSignalScan()
      callbacks.onScanRestart?.()
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  const poll = async (): Promise<void> => {
    if (stopped) return
    try {
      const sig = await client.readCapturedSignal()
      if (sig) {
        const fp = signalFingerprint(sig)
        if (!seen.has(fp)) {
          seen.add(fp)
          const captured: CapturedSignal = {
            id: `${client.bondid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            bondid: client.bondid,
            capturedAtMs: Date.now(),
            signal: sig
          }
          callbacks.onCapture(captured)
        }
      }
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  void restartScan()
  pollTimer = setInterval(() => { void poll() }, POLL_INTERVAL_MS)
  // Re-issue scan well before bridge timeout to keep capture continuous.
  scanTimer = setInterval(() => { void restartScan() }, SCAN_REARM_INTERVAL_MS)

  return {
    bondid: client.bondid,
    isActive: () => !stopped,
    stop: async () => {
      if (stopped) return
      stopped = true
      if (pollTimer) clearInterval(pollTimer)
      if (scanTimer) clearInterval(scanTimer)
      pollTimer = null
      scanTimer = null
      // Best-effort: tell the bridge to stop scanning. Failure is harmless —
      // the scan will time out on its own.
      try { await client.stopSignalScan() } catch { /* ok */ }
    }
  }
}

export interface AssignSignalParams {
  /** Either an existing deviceId on the bridge, or null to create a new device. */
  deviceId: string | null
  /** When deviceId is null, create a new device with this name + type. The bridge assigns the id. */
  newDevice?: { name: string; type: DeviceType }
  /** Action name (e.g. 'TurnOn', 'TurnOff', 'SetSpeed') — what the bridge fires when this command runs. */
  actionName: string
  /** Display name for the command (defaults to actionName). Shown in the Bond app. */
  commandName?: string
  /** Optional argument baked into the command (e.g. {argument: 3} for SetSpeed). */
  argument?: unknown
}

/**
 * Persist a captured signal as a command on a device. Creates the device
 * first if requested (the bridge assigns deviceId). Then creates a Command
 * (bridge assigns commandId) with `action` set to actionName, then attaches
 * the captured signal to that command. Returns the resolved deviceId.
 */
export async function assignCapturedSignal(
  client: BondClient,
  signal: CapturedSignal,
  params: AssignSignalParams
): Promise<{ deviceId: string; commandId: string }> {
  let deviceId = params.deviceId
  if (!deviceId) {
    if (!params.newDevice) {
      throw new Error('assignCapturedSignal: deviceId or newDevice is required')
    }
    deviceId = await client.createDevice({
      name: params.newDevice.name,
      type: params.newDevice.type
    })
  }

  const action = params.actionName.trim()
  if (!action) throw new Error('assignCapturedSignal: actionName cannot be empty')

  const commandId = await client.createCommand(deviceId, {
    name: params.commandName?.trim() || action,
    action,
    ...(params.argument !== undefined ? { argument: params.argument } : {})
  })

  await client.saveCommandSignal(deviceId, commandId, signal.signal)

  return { deviceId, commandId }
}
