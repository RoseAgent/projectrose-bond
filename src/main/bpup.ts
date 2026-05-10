import { createSocket, type Socket } from 'dgram'

const BPUP_PORT = 30007
const KEEPALIVE_INTERVAL_MS = 60_000
const KEEPALIVE_GRACE_MS = 90_000     // if no ack within this window, fall back

export interface BpupListenerCallbacks {
  /** Bridge acknowledged a keep-alive — BPUP is alive. */
  onAck: (bondid: string, source: { address: string; port: number }) => void
  /** Heard from the bridge in some other way (raw push). Optional debugging hook. */
  onMessage?: (bondid: string, message: BpupMessage) => void
  /** No keep-alive ack within the grace window — fall back to polling/refresh. */
  onFallback: (bondid: string, reason: string) => void
}

export interface BpupMessage {
  B?: string                          // bondid
  t?: string                          // topic, e.g. "devices/abc/state"
  i?: string                          // request id
  b?: Record<string, unknown>         // body
  s?: number                          // status
  f?: number                          // flags
}

export interface BpupSubscription {
  bondid: string
  ip: string
  isAlive: () => boolean
  stop: () => void
}

/**
 * Subscribe to push state changes from a single Bond bridge.
 *
 * One UDP socket per bridge. The bridge only pushes to addresses it has heard
 * a keep-alive from in the last ~120s, so we send `\n` every 60s. If no ack
 * arrives within the grace window we surface a fallback signal — the caller
 * is expected to switch that bridge to refresh-on-open + post-write polling.
 */
export function subscribeBpup(
  bondid: string,
  ip: string,
  callbacks: BpupListenerCallbacks
): BpupSubscription | null {
  let socket: Socket | null = null
  try {
    socket = createSocket('udp4')
  } catch (err) {
    callbacks.onFallback(bondid, `Failed to create UDP socket: ${(err as Error).message}`)
    return null
  }

  let alive = false
  let lastAckMs = 0
  let stopped = false

  const sendKeepalive = (): void => {
    if (stopped || !socket) return
    try {
      socket.send('\n', BPUP_PORT, ip, (err) => {
        if (err) {
          // Don't kill the subscription on a single send failure — try again
          // on the next interval. If grace window elapses, fallback fires.
        }
      })
    } catch {
      // Same as above
    }
  }

  socket.on('message', (msg, rinfo) => {
    if (stopped) return
    let parsed: BpupMessage | null = null
    try {
      parsed = JSON.parse(msg.toString('utf-8')) as BpupMessage
    } catch {
      return
    }
    if (!parsed) return

    // Any datagram = bridge is alive.
    lastAckMs = Date.now()
    if (!alive) {
      alive = true
      callbacks.onAck(bondid, { address: rinfo.address, port: rinfo.port })
    }

    callbacks.onMessage?.(bondid, parsed)
  })

  socket.on('error', (err) => {
    if (stopped) return
    callbacks.onFallback(bondid, `UDP socket error: ${err.message}`)
    stop()
  })

  try {
    socket.bind(0)
  } catch (err) {
    callbacks.onFallback(bondid, `Failed to bind UDP socket: ${(err as Error).message}`)
    socket?.close()
    return null
  }

  // Initial keep-alive immediately, then on interval.
  sendKeepalive()
  const keepaliveTimer: NodeJS.Timeout = setInterval(sendKeepalive, KEEPALIVE_INTERVAL_MS)

  // Watchdog — if no ack within grace window, declare fallback.
  const watchdog: NodeJS.Timeout = setInterval(() => {
    if (stopped || alive) return
    callbacks.onFallback(bondid, `No BPUP ack within ${KEEPALIVE_GRACE_MS}ms`)
    stop()
  }, KEEPALIVE_GRACE_MS)

  function stop(): void {
    if (stopped) return
    stopped = true
    clearInterval(keepaliveTimer)
    clearInterval(watchdog)
    try { socket?.close() } catch { /* already closed */ }
    socket = null
  }

  return {
    bondid,
    ip,
    isAlive: () => alive && Date.now() - lastAckMs < KEEPALIVE_GRACE_MS * 2,
    stop
  }
}
