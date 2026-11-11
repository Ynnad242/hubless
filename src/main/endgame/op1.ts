// Endgame Gear OP1 8k driver: transport over the vendor feature reports (interface 1, usage page 0xFF01)
// and a session that shows the mouse to the UI in the same shape as a Logitech onboard profile.
import HID from 'node-hid'
import type { MouseState, ProfileData } from '@shared/types'
import { Offline, Timeout } from '../logitech/hidpp'
import * as storage from '../storage'
import { CONFIG_LEN, DPI_RANGE, FUNCTIONS, LEVELS, RATES, decode, encode, plausible } from './config'

export const EG_VID = 0x3367
/** Models with a verified layout. The OP1 8k v2 (0x1978) moved the button table, so it isn't claimed yet. */
export const MODELS: Record<number, string> = { 0x1964: 'OP1 8k' }

const OP_READ_CONFIG = 0x12a1
const OP_FIRMWARE = 0x02a1
const OP_WRITE_CONFIG = 0x11a0
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function endgameEndpoint(list: HID.Device[] = HID.devices()) {
  const d = list.find((x) => x.vendorId === EG_VID && MODELS[x.productId] && x.usagePage === 0xff01 && x.path)
  return d ? { path: d.path!, productId: d.productId, serial: d.serialNumber ?? '' } : null
}

export class EndgameTransport {
  private chain: Promise<unknown> = Promise.resolve()
  private constructor(private dev: HID.HIDAsync) {}

  static async open(path: string) {
    return new EndgameTransport(await HID.HIDAsync.open(path))
  }

  /** One request at a time; the mouse answers on the same feature report. */
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const next = this.chain.then(job, job)
    this.chain = next.catch(() => {})
    return next
  }

  private query(op: number, len: number, ok: (b: Uint8Array) => boolean): Promise<Uint8Array> {
    return this.serial(async () => {
      const cmd = new Array(64).fill(0)
      cmd[0] = op & 0xff
      cmd[1] = op >> 8
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await this.dev.sendFeatureReport(cmd)
        } catch {
          throw new Offline('unplugged')
        }
        await sleep(80)
        const r = Uint8Array.from(await this.dev.getFeatureReport(0xa1, len))
        if (ok(r)) return r
      }
      throw new Timeout('The mouse did not answer.')
    })
  }

  readConfig() {
    return this.query(OP_READ_CONFIG, CONFIG_LEN + 1, plausible).then((b) => b.slice(0, CONFIG_LEN))
  }

  async firmware() {
    const r = await this.query(OP_FIRMWARE, 64, (b) => b[17] !== 0 || b[18] !== 0)
    return `${r[18]}.${r[17].toString(16).padStart(2, '0')}`
  }

  writeConfig(cfg: Uint8Array) {
    return this.serial(async () => {
      const out = new Array(CONFIG_LEN + 1).fill(0)
      for (let i = 2; i < cfg.length; i++) out[i] = cfg[i]
      out[0] = OP_WRITE_CONFIG & 0xff
      out[1] = OP_WRITE_CONFIG >> 8
      await this.dev.sendFeatureReport(out)
      await sleep(150)
    })
  }

  close() {
    void this.dev.close().catch(() => {})
  }
}

export class EndgameSession {
  config = new Uint8Array(CONFIG_LEN)
  fw = ''
  private backedUp = false

  constructor(public t: EndgameTransport, public name: string, public productId: number, private usbSerial: string) {}

  /** Backups are filed under this key. */
  get backupKey() {
    return this.usbSerial || `endgame-${this.productId.toString(16)}`
  }

  async load() {
    this.fw = await this.t.firmware()
    this.config = await this.t.readConfig()
  }

  ping() {
    return this.t.firmware()
  }

  state(): MouseState {
    const p = decode(this.config)
    const levels = p.stages.filter((s) => s.x > 0).length
    return {
      profiles: [p], activeSector: 1, stage: levels === 1 ? 0 : -1, rates: RATES,
      grid: { values: [], ranges: [DPI_RANGE] }, hitsCaps: null, hasFactory: false,
      firmware: this.fw, serial: this.usbSerial, protocol: 'Endgame Gear',
      onboard: { fmt: 0, profiles: 1, buttons: 5, sectorSize: CONFIG_LEN }, features: [],
      limits: { stages: LEVELS, startStage: false, shiftStage: false, profiles: false, functions: FUNCTIONS }
    }
  }

  private async ensureBackup() {
    if (this.backedUp) return
    storage.saveBackup(this.backupKey, this.name, 0, new Map([[0, this.config]]), 'before-changes')
    this.backedUp = true
  }

  async backup() {
    return storage.saveBackup(this.backupKey, this.name, 0, new Map([[0, await this.t.readConfig()]]), 'manual')
  }

  /** Write a whole config block and make sure the mouse kept every byte. */
  private async put(cfg: Uint8Array) {
    await this.t.writeConfig(cfg)
    const back = await this.t.readConfig()
    for (let i = 2; i < CONFIG_LEN; i++)
      if (back[i] !== cfg[i]) throw new Error(`The mouse did not keep the change (byte ${i}). Nothing else was touched.`)
    this.config = back
  }

  async saveProfile(p: ProfileData) {
    await this.ensureBackup()
    await this.put(encode(p))
  }

  async restore(mem: Map<number, Uint8Array>) {
    const cfg = mem.get(0)
    if (!cfg || !plausible(cfg)) throw new Error('That backup is not an OP1 8k configuration.')
    await this.ensureBackup()
    await this.put(cfg)
  }
}
