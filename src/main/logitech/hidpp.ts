// HID++ 2.0 over node-hid (hidraw). One request in flight per handle; replies matched by software id.
import HID from 'node-hid'

export const LOGITECH = 0x046d
const SHORT = 0x10
const LONG = 0x11
const SWID = 0x0b

const ERRORS: Record<number, string> = {
  1: 'unknown error', 2: 'invalid argument', 3: 'out of range', 4: 'hardware error', 5: 'internal error',
  6: 'invalid feature index', 7: 'invalid function', 8: 'device busy', 9: 'unsupported'
}

export class HidppError extends Error {
  constructor(public code: number, feature = 0, fn = 0) {
    super(`${ERRORS[code] ?? `error ${code}`} (feature 0x${feature.toString(16)}, fn ${fn})`)
  }
}
export class Timeout extends Error {}
/** The receiver answered for the device: asleep, switched off or out of range. */
export class Offline extends Error {}

export interface Transport {
  path: string
  request(index: number, feature: number, fn: number, params?: number[], timeoutMs?: number): Promise<Buffer>
  ping(index: number, timeoutMs?: number): Promise<[number, number] | null>
  pairedDevices(): Promise<{ slot: number; wpid: number; name: string; serial: string }[]>
  onNotification?(fn: (d: Buffer) => void): () => void
  close(): void
}

interface Pending {
  match(d: Buffer): 'ok' | 'skip' | Error
  resolve(d: Buffer): void
  reject(e: Error): void
}

export class HidrawTransport implements Transport {
  private queue: Promise<unknown> = Promise.resolve()
  private pending: Pending | null = null
  private closed = false

  private constructor(public path: string, private dev: HID.HIDAsync) {
    dev.on('data', (d: Buffer) => this.onData(d))
    dev.on('error', () => {
      this.closed = true
      this.pending?.reject(new Offline(`${path} disconnected`))
    })
  }

  static async open(path: string): Promise<HidrawTransport> {
    return new HidrawTransport(path, await HID.HIDAsync.open(path))
  }

  close() {
    this.closed = true
    this.dev.close().catch(() => {})
  }

  private listeners = new Set<(d: Buffer) => void>()

  /** Unsolicited reports (device notifications) that no request is waiting for. */
  onNotification(fn: (d: Buffer) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private onData(d: Buffer) {
    const p = this.pending
    const m = p ? p.match(d) : 'skip'
    if (m === 'skip' || !p) {
      for (const fn of this.listeners) fn(d)
      return
    }
    this.pending = null
    if (m === 'ok') p.resolve(d)
    else p.reject(m)
  }

  /** Serialize exchanges: write `pkt`, wait for the reply `match` accepts. */
  private exchange(pkt: number[], match: Pending['match'], timeoutMs: number): Promise<Buffer> {
    const run = () =>
      new Promise<Buffer>((resolve, reject) => {
        if (this.closed) return reject(new Offline(`${this.path} is closed`))
        const timer = setTimeout(() => {
          this.pending = null
          reject(new Timeout(`no reply on ${this.path}`))
        }, timeoutMs)
        this.pending = {
          match,
          resolve: (d) => (clearTimeout(timer), resolve(d)),
          reject: (e) => (clearTimeout(timer), reject(e))
        }
        this.dev.write(pkt).catch((e) => this.pending?.reject(new Offline(String(e))))
      })
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => {})
    return next
  }

  async request(index: number, feature: number, fn: number, params: number[] = [], timeoutMs = 1000) {
    const fnsw = ((fn & 0x0f) << 4) | SWID
    const pkt = [LONG, index, feature, fnsw, ...params, ...new Array(16).fill(0)].slice(0, 20)
    for (let attempt = 0; ; attempt++) {
      try {
        const d = await this.exchange(
          pkt,
          (d) => {
            if (d.length < 4 || (d[0] !== SHORT && d[0] !== LONG) || d[1] !== index) return 'skip'
            if (d[2] === 0xff && d[3] === feature && d[4] === fnsw) return new HidppError(d[5], feature, fn)
            if (d[2] === 0x8f && d[3] === feature) return new Offline(`device ${index} not reachable (code ${d[5]})`)
            if (d[2] === feature && d[3] === fnsw) return 'ok'
            return 'skip'
          },
          timeoutMs
        )
        return d.subarray(4)
      } catch (e) {
        if (e instanceof HidppError && e.code === 8 && attempt < 3) {
          await sleep(50 * (attempt + 1))
          continue
        }
        throw e
      }
    }
  }

  async ping(index: number, timeoutMs = 1500): Promise<[number, number] | null> {
    try {
      const r = await this.request(index, 0, 1, [0, 0, 0x5a], timeoutMs)
      return [r[0], r[1]]
    } catch {
      return null
    }
  }

  /** HID++ 1.0 receiver register read (short request). */
  async readRegister(sub: number, address: number, params: number[] = []): Promise<Buffer | null> {
    const pkt = [SHORT, 0xff, sub, address, ...params, 0, 0, 0].slice(0, 7)
    try {
      const d = await this.exchange(
        pkt,
        (d) => {
          if (d.length < 4 || d[1] !== 0xff) return 'skip'
          if (d[2] === sub && d[3] === address) return 'ok'
          if (d[2] === 0x8f && d[3] === sub) return new HidppError(d[5] ?? 1)
          return 'skip'
        },
        500
      )
      return d.subarray(4)
    } catch {
      return null
    }
  }

  private paired: { at: number; value: { slot: number; wpid: number; name: string; serial: string }[] } | null = null

  /** Paired devices (3 register reads per slot). Pairings rarely change, so the answer is kept for a minute. */
  async pairedDevices() {
    if (this.paired && Date.now() - this.paired.at < 60_000) return this.paired.value
    const value = await this.readPairing()
    this.paired = { at: Date.now(), value }
    return value
  }

  private async readPairing() {
    const out: { slot: number; wpid: number; name: string; serial: string }[] = []
    for (let slot = 1; slot <= 6; slot++) {
      const info = await this.readRegister(0x83, 0xb5, [0x1f + slot])
      if (!info) continue
      const raw = await this.readRegister(0x83, 0xb5, [0x3f + slot])
      const name = raw && raw.length > 2 ? raw.subarray(2, 2 + raw[1]).toString('utf8') : ''
      const ext = await this.readRegister(0x83, 0xb5, [0x2f + slot]) // extended pairing info: serial
      const serial = ext ? ext.subarray(1, 5).toString('hex').toUpperCase() : ''
      out.push({ slot, wpid: (info[3] << 8) | info[4], name, serial })
    }
    return out
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** HID++ endpoints: Logitech vendor interfaces (usage page 0xFF00) that aren't dj children. */
export function endpoints(list: HID.Device[] = HID.devices()): { path: string; receiver: boolean; name: string; pid: number }[] {
  const seen = new Set<string>()
  const out: { path: string; receiver: boolean; name: string; pid: number }[] = []
  for (const d of list) {
    if (d.vendorId !== LOGITECH || d.usagePage !== 0xff00 || !d.path || seen.has(d.path)) continue
    seen.add(d.path)
    // Receivers expose the HID++ channel on interface 2; dj children reuse the receiver's channel.
    const receiver = /receiver/i.test(d.product ?? '') || [0xc539, 0xc53a, 0xc545, 0xc547, 0xc54d, 0xc54f].includes(d.productId)
    if (receiver && d.productId < 0xc500) continue
    out.push({ path: d.path, receiver, name: d.product ?? 'Logitech device', pid: d.productId })
  }
  return out
}
