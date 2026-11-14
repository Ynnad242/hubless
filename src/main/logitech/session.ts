// Everything the app knows about one Logitech mouse, and the safe ways to change it.
import type { Battery, DpiGridData, Hits, LightZone, MouseState, ProfileData } from '@shared/types'
import * as storage from '../storage'
import { F, type LogitechDevice } from './device'
import { HidppError, Timeout } from './hidpp'
import { LEDS, LIGHT_SECTOR_MIN, ZONE_NAMES, logitechZone } from './lighting'
import { decode, encode, fromHex, stageCount, toHex, withCrc } from './profile'

const ONBOARD = 1

export class LogitechSession {
  profiles: ProfileData[] = []
  activeSector = 0
  stage = 0
  battery: Battery | null = null
  rates: number[] = []
  grid: DpiGridData = { values: [], ranges: [] }
  hitsCaps: MouseState['hitsCaps'] = null
  factory: Uint8Array | null = null
  notice = ''
  /** RGB zones stored in the onboard profiles (none for mice without RGB). */
  zones: LightZone[] = []
  private backedUp = false

  constructor(public dev: LogitechDevice) {}

  get editable() {
    return !!this.dev.onboard && [1, 2, 3, 4, 5, 6, 8].includes(this.dev.onboard.fmt)
  }

  /** Backups are filed under this key. */
  get backupKey() {
    return this.dev.serial
  }

  /** Only the PRO X2 SUPERSTRIKE has been verified on hardware. */
  get verified() {
    return this.dev.isSuperstrike
  }

  async load() {
    const d = this.dev
    this.battery = await d.battery()
    this.rates = await d.reportRates()
    this.grid = await d.dpiGrid()
    if (d.isSuperstrike) this.hitsCaps = await d.hitsCaps()
    if (!this.editable) return
    this.zones = []
    if (d.onboard!.fmt !== 8 && d.onboard!.sectorSize >= LIGHT_SECTOR_MIN) {
      const locs = (await d.lightZones()).slice(0, LEDS.length)
      this.zones = locs.map((loc, i) => logitechZone(ZONE_NAMES[loc] ?? (locs.length === 1 ? 'Lights' : `Zone ${i + 1}`)))
    }
    if ((await d.onboardMode()) !== ONBOARD) {
      // Another tool left the mouse in host mode, where the stored profiles are ignored.
      await d.setOnboardMode(ONBOARD)
      this.notice = 'Switched the mouse back to its onboard profiles.'
    }
    this.profiles = []
    for (const { sector, enabled } of await d.profileTable())
      this.profiles.push(decode(sector, await d.readSector(sector), d.onboard!.fmt, enabled))
    this.activeSector = await d.currentProfileSector()
    this.stage = await d.currentStage()
    this.factory = await d.factorySector()
  }

  async refreshStatus() {
    this.battery = await this.dev.battery()
    if (this.editable) {
      this.activeSector = await this.dev.currentProfileSector()
      this.stage = await this.dev.currentStage()
    }
  }

  state(): MouseState {
    const d = this.dev
    const n = this.zones.length
    return {
      profiles: this.profiles.map((p) => ({ ...p, lighting: n ? p.lighting?.slice(0, n) : undefined })),
      lighting: this.zones, activeSector: this.activeSector, stage: this.stage, rates: this.rates,
      grid: this.grid, hitsCaps: this.hitsCaps, hasFactory: !!this.factory, firmware: d.firmware,
      serial: d.serial, protocol: d.protocol, onboard: d.onboard, features: d.featureList
    }
  }

  slotOf(sector: number) {
    const i = this.profiles.findIndex((p) => p.sector === sector)
    if (i < 0) throw new Error(`no profile in sector ${sector}`)
    return i
  }

  private async ensureBackup() {
    if (this.backedUp) return
    storage.saveBackup(this.dev.serial, this.dev.name, this.dev.onboard!.fmt, await this.dev.dumpMemory(), 'before-changes')
    this.backedUp = true
  }

  /** Write a profile; writing the active one applies it immediately. */
  async saveProfile(next: ProfileData): Promise<ProfileData> {
    await this.ensureBackup()
    const slot = this.slotOf(next.sector)
    const old = this.profiles[slot]
    const data = encode(next)
    if (toHex(data) !== old.raw) await this.dev.writeSector(next.sector, data)
    const saved = decode(next.sector, data, next.fmt, old.enabled)
    this.profiles[slot] = saved
    if (next.sector !== this.activeSector) return saved
    if (JSON.stringify(saved.lighting) !== JSON.stringify(old.lighting)) {
      // The mouse reads its lights from the profile when it is selected: select it again to show the change now.
      await this.quiet(() => this.dev.setCurrentProfile(next.sector))
    }
    this.stage = await this.dev.currentStage()
    if (saved.defaultStage !== old.defaultStage || this.stage >= stageCount(saved)) {
      // Also repairs a live stage the firmware dropped to 0xFF after its stage was switched off.
      await this.quiet(() => this.dev.setCurrentStage(saved.defaultStage))
      this.stage = saved.defaultStage
    }
    if (saved.hits) {
      for (let b = 0; b < saved.hits.length; b++) {
        const h = saved.hits[b]
        const o = old.hits?.[b]
        if (!o || o.actuation !== h.actuation || o.rtLevel !== h.rtLevel || o.rtOn !== h.rtOn || o.haptics !== h.haptics)
          await this.quiet(() => this.dev.hitsSet(b, h))
      }
    }
    return saved
  }

  private depthOff: (() => void) | null = null

  /**
   * Live button depth, like G HUB's HITS view. 0x1B0C fn3 [1, 0x3c] starts the stream (fn3 [0, 0x3c] stops it);
   * the mouse then sends fn0 events [left depth, right depth] on the same 1..10 scale as the actuation point.
   */
  async startDepth(cb: (left: number, right: number) => void) {
    if (!this.dev.isSuperstrike || !this.dev.t.onNotification) return
    this.stopDepth()
    const idx = this.dev.features.get(F.HITS)!
    this.depthOff = this.dev.t.onNotification((d) => {
      if (d[0] === 0x11 && d[1] === this.dev.index && d[2] === idx && d[3] === 0x00) cb(d[4], d[5])
    })
    await this.dev.call(F.HITS, 3, [1, 0x3c])
  }

  async stopDepth() {
    if (!this.depthOff) return
    this.depthOff()
    this.depthOff = null
    await this.quiet(() => this.dev.call(F.HITS, 3, [0, 0x3c]))
  }

  /** Live-only HITS change while a control is being dragged; the profile write follows. */
  async previewHits(hits: Hits[]) {
    for (let b = 0; b < hits.length; b++) await this.dev.hitsSet(b, hits[b])
  }

  async activate(sector: number) {
    const slot = this.slotOf(sector)
    if (!this.profiles[slot].enabled) await this.setEnabled(slot, true)
    await this.dev.setCurrentProfile(sector)
    this.activeSector = sector
    this.stage = await this.dev.currentStage()
  }

  async setEnabled(slot: number, on: boolean) {
    if (!on && this.profiles[slot].sector === this.activeSector)
      throw new Error("The profile in use can't be turned off. Switch to another profile first.")
    await this.ensureBackup()
    await this.dev.setProfileEnabled(slot, on)
    this.profiles[slot] = { ...this.profiles[slot], enabled: on }
  }

  /** Overwrite a whole profile (import, copy, factory reset). */
  async replaceSector(sector: number, raw: Uint8Array) {
    const slot = this.slotOf(sector)
    const p = decode(sector, withCrc(raw), this.dev.onboard!.fmt, this.profiles[slot].enabled)
    return this.saveProfile(p)
  }

  async restore(sectors: Map<number, Uint8Array>) {
    await this.ensureBackup()
    for (const raw of sectors.values())
      if (raw.length !== this.dev.onboard!.sectorSize) throw new Error('That backup is from a different kind of mouse.')
    for (const [sec, raw] of [...sectors].sort((a, b) => a[0] - b[0])) {
      const cur = await this.dev.readSector(sec)
      if (!cur.every((b, i) => b === raw[i])) await this.dev.writeSector(sec, raw)
    }
    await this.load()
    await this.dev.setCurrentProfile(this.activeSector)
  }

  async backup(label = 'manual') {
    return storage.saveBackup(this.dev.serial, this.dev.name, this.dev.onboard!.fmt, await this.dev.dumpMemory(), label)
  }

  rawOf(sector: number) {
    return fromHex(this.profiles[this.slotOf(sector)].raw)
  }

  private async quiet(fn: () => Promise<unknown>) {
    try {
      await fn()
    } catch (e) {
      if (!(e instanceof HidppError || e instanceof Timeout)) throw e
    }
  }
}

