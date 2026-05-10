import { BondError, type DeviceType } from './types'

const REQUEST_TIMEOUT_MS = 5_000

export interface BridgeVersion {
  bondid: string
  fw_ver?: string
  target?: string
  make?: string
  model?: string
  branding_profile?: string
  [key: string]: unknown
}

export interface BridgeDevice {
  name: string
  type: DeviceType
  location?: string
  template?: string
  actions?: string[]
  // Bond returns either an `actions` array OR a `commands` map; we normalize
  // to `actions` in BondClient.getDevice().
  commands?: Record<string, unknown>
  [key: string]: unknown
}

export interface CapturedSignalRaw {
  // Bond's payload — keys vary per modulation. Only `freq` / `bps` /
  // `modulation` / `encoding` / `data` are commonly present.
  [key: string]: unknown
}

export class BondClient {
  constructor(public readonly bondid: string, public ip: string, public token: string) {}

  private async fetchJson<T>(method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const url = `http://${this.ip}/v2${path}`
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'BOND-Token': this.token,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal
      })
      if (!res.ok) {
        let text = ''
        try { text = await res.text() } catch { /* empty */ }
        throw new BondError(
          `${method} ${path} → ${res.status} ${res.statusText}${text ? ': ' + text.slice(0, 200) : ''}`,
          this.bondid,
          res.status,
          path
        )
      }
      // Some endpoints (PUT actions) return 204 No Content
      if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('json')) return undefined as T
      return await res.json() as T
    } catch (err) {
      if (err instanceof BondError) throw err
      const msg = err instanceof Error ? err.message : String(err)
      const isAbort = err instanceof Error && err.name === 'AbortError'
      throw new BondError(
        isAbort ? `${method} ${path} timed out after ${REQUEST_TIMEOUT_MS}ms` : `${method} ${path}: ${msg}`,
        this.bondid,
        undefined,
        path
      )
    } finally {
      clearTimeout(timer)
    }
  }

  // Retry-once on 5xx. Caller-side errors (4xx) propagate immediately.
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof BondError && err.status && err.status >= 500) {
        return await fn()
      }
      throw err
    }
  }

  async getVersion(): Promise<BridgeVersion> {
    return this.withRetry(() => this.fetchJson<BridgeVersion>('GET', '/sys/version'))
  }

  async listDeviceIds(): Promise<string[]> {
    const raw = await this.withRetry(() => this.fetchJson<Record<string, unknown>>('GET', '/devices'))
    // Bond responses include a '_' key holding the response hash; ignore it.
    return Object.keys(raw).filter((k) => !k.startsWith('_'))
  }

  async getDevice(deviceId: string): Promise<BridgeDevice> {
    const raw = await this.withRetry(() => this.fetchJson<BridgeDevice>('GET', `/devices/${encodeURIComponent(deviceId)}`))
    if (!raw.actions || raw.actions.length === 0) {
      // Some firmwares omit `actions` and only expose `commands`.
      // Fall back to commands keys, filtering hash entries.
      const cmd = raw.commands ?? {}
      raw.actions = Object.keys(cmd).filter((k) => !k.startsWith('_'))
    }
    return raw
  }

  async runAction(deviceId: string, action: string, args?: Record<string, unknown>): Promise<void> {
    // Bond expects an empty body `{}` for arg-less actions.
    const body = args && Object.keys(args).length > 0 ? args : {}
    await this.withRetry(() => this.fetchJson<void>('PUT', `/devices/${encodeURIComponent(deviceId)}/actions/${encodeURIComponent(action)}`, body))
  }

  // ---- Device CRUD (used by IR/RF learn flow) -------------------------------
  //
  // The bridge assigns the device id — we don't get to pick it. POST /devices
  // returns 201 with body {_id: "<chosen id>"}.

  async createDevice(payload: { name: string; type: DeviceType; template?: string; location?: string; subtype?: string; properties?: Record<string, unknown> }): Promise<string> {
    const res = await this.fetchJson<{ _id?: string }>('POST', '/devices', payload)
    if (!res || !res._id) {
      throw new BondError('POST /devices: bridge did not return a device id', this.bondid, undefined, '/devices')
    }
    return res._id
  }

  async patchDevice(deviceId: string, patch: Partial<{ name: string; location: string; properties: Record<string, unknown> }>): Promise<void> {
    await this.fetchJson<void>('PATCH', `/devices/${encodeURIComponent(deviceId)}`, patch)
  }

  async deleteDevice(deviceId: string): Promise<void> {
    await this.fetchJson<void>('DELETE', `/devices/${encodeURIComponent(deviceId)}`)
  }

  // ---- Signal scan / commands (IR/RF learn) ---------------------------------
  //
  // The actual Bond V2 endpoints (per bondhome/api-v2 local.yaml):
  //   PUT    /v2/signal/scan                         start a scan (body: {freq?, modulation?})
  //   GET    /v2/signal/scan                         read scan status (running, success, total_timeout)
  //   DELETE /v2/signal/scan                         stop the scan
  //   GET    /v2/signal/scan/signal                  read the most-recently captured Signal
  //   PUT    /v2/devices/{id}/commands/{cmd}/signal  attach a Signal to a command
  //
  // The bridge auto-times out the scan after ~60s; callers should re-issue
  // PUT /signal/scan to keep capture continuous.

  async startSignalScan(opts?: { freq?: number; modulation?: 'OOK' | 'GFSK' }): Promise<void> {
    // Body is optional. Pass freq=38 to scan IR, omit to scan all RF frequencies.
    const body: Record<string, unknown> = {}
    if (opts?.freq !== undefined)       body.freq       = opts.freq
    if (opts?.modulation !== undefined) body.modulation = opts.modulation
    await this.fetchJson<void>('PUT', '/signal/scan', body)
  }

  async stopSignalScan(): Promise<void> {
    try {
      await this.fetchJson<void>('DELETE', '/signal/scan')
    } catch (err) {
      // 404 just means no scan was running — harmless.
      if (err instanceof BondError && err.status === 404) return
      throw err
    }
  }

  async getSignalScanStatus(): Promise<{ running?: boolean; success?: boolean; total_timeout?: number } | null> {
    try {
      return await this.fetchJson('GET', '/signal/scan')
    } catch (err) {
      if (err instanceof BondError && err.status === 404) return null
      throw err
    }
  }

  async readCapturedSignal(): Promise<CapturedSignalRaw | null> {
    try {
      const sig = await this.fetchJson<CapturedSignalRaw>('GET', '/signal/scan/signal')
      return sig ?? null
    } catch (err) {
      // 404 = nothing captured yet. Don't surface as error.
      if (err instanceof BondError && (err.status === 404 || err.status === 204)) return null
      throw err
    }
  }

  // A Command is the bridge's bound (name, action, signal) tuple. Bond assigns
  // commandIds — same pattern as devices. POST returns 201 with {_id: "..."}.
  async createCommand(deviceId: string, payload: { name: string; action: string; argument?: unknown }): Promise<string> {
    const res = await this.fetchJson<{ _id?: string }>(
      'POST',
      `/devices/${encodeURIComponent(deviceId)}/commands`,
      payload
    )
    if (!res || !res._id) {
      throw new BondError(`POST /devices/${deviceId}/commands: bridge did not return a command id`, this.bondid, undefined, '/commands')
    }
    return res._id
  }

  async saveCommandSignal(deviceId: string, commandId: string, signal: CapturedSignalRaw): Promise<void> {
    await this.fetchJson<void>(
      'PUT',
      `/devices/${encodeURIComponent(deviceId)}/commands/${encodeURIComponent(commandId)}/signal`,
      signal
    )
  }
}
