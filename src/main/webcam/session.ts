// One webcam: its controls, the settings the user saved for it, and putting those back when they get lost.
import type { CameraControl, CameraState } from '@shared/types'
import type { SavedCamera } from '../storage'
import { applyOrder, type CameraBackend, type CameraInfo, drifted, isSwitch } from './uvc'

export interface CameraStore {
  load(key: string): SavedCamera
  save(key: string, c: SavedCamera): void
}

export class WebcamSession {
  controls: CameraControl[] = []
  saved: SavedCamera
  /** last time Hubless put a setting back, so a camera that refuses one isn't hammered */
  private restoredAt = 0
  /** one camera operation at a time: a check for lost settings must not run in the middle of a change or reset */
  private queue: Promise<unknown> = Promise.resolve()
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job)
    this.queue = run.catch(() => {})
    return run
  }

  constructor(
    public info: CameraInfo,
    private backend: CameraBackend,
    private store: CameraStore
  ) {
    this.saved = store.load(this.key)
  }

  /** Settings follow the camera: by serial when it has one, else by model and USB port. */
  get key() {
    const id = `${this.info.vid.toString(16).padStart(4, '0')}:${this.info.pid.toString(16).padStart(4, '0')}`
    return this.info.serial ? `${id}:${this.info.serial}` : `${id}@${this.info.usb}`
  }

  /** Read the controls, and put the saved settings back (a webcam forgets them when unplugged). */
  load() {
    return this.serial(() => this.loadNow())
  }
  private async loadNow() {
    this.controls = await this.backend.read(this.info.dev)
    await this.restore(true)
  }

  /** Put back saved settings the camera has lost. `always`: when it just showed up, even if "keep" is off. */
  async restore(always = false): Promise<boolean> {
    if (!always && !this.saved.keep) return false
    if (!always && Date.now() - this.restoredAt < 1500) return false
    const lost = drifted(this.controls, this.saved.values)
    if (!lost.length) return false
    // A manual value the camera greyed out (its auto switch got turned back on) comes back with the switch.
    if (lost.some(([k]) => isSwitch(k)))
      for (const [k, v] of Object.entries(this.saved.values)) {
        const c = this.controls.find((x) => x.name === k)
        if (c?.inactive && c.value !== v) lost.push([k, v])
      }
    this.restoredAt = Date.now()
    await this.write(lost)
    return true
  }

  /** Called every few seconds while the camera is plugged in. True when something changed. */
  poll(): Promise<boolean> {
    return this.serial(() => this.pollNow())
  }
  private async pollNow(): Promise<boolean> {
    const before = JSON.stringify(this.controls.map((c) => [c.value, c.inactive]))
    this.controls = await this.backend.read(this.info.dev)
    const fixed = await this.restore()
    return fixed || before !== JSON.stringify(this.controls.map((c) => [c.value, c.inactive]))
  }

  set(values: Record<string, number>) {
    return this.serial(() => this.setNow(values))
  }
  private async setNow(values: Record<string, number>) {
    const pairs = Object.entries(values).filter(([k, v]) => this.controls.some((c) => c.name === k) && Number.isFinite(v)) as [string, number][]
    await this.write(pairs.map(([k, v]) => [k, this.clamp(k, v)]))
    for (const [k] of pairs) {
      const c = this.controls.find((x) => x.name === k)!
      // Only what differs from the factory value is remembered, so a camera keeps its own defaults for the rest.
      if (c.value === c.default) delete this.saved.values[k]
      else this.saved.values[k] = c.value
    }
    this.store.save(this.key, this.saved)
  }

  setKeep(keep: boolean) {
    return this.serial(() => this.setKeepNow(keep))
  }
  private async setKeepNow(keep: boolean) {
    this.saved.keep = keep
    this.store.save(this.key, this.saved)
    if (keep) await this.restore(true)
  }

  reset() {
    return this.serial(() => this.resetNow())
  }
  private async resetNow() {
    // Values the auto switches lock go back first, while they can still be set; the switches after.
    const back = this.controls.filter((c) => c.value !== c.default).map((c): [string, number] => [c.name, c.default])
    const values = back.filter(([k]) => !isSwitch(k))
    if (values.length) await this.backend.set(this.info.dev, values)
    await this.write(back.filter(([k]) => isSwitch(k)))
    this.saved.values = {}
    this.store.save(this.key, this.saved)
  }

  state(): CameraState {
    return { controls: this.controls, keep: this.saved.keep, saved: { ...this.saved.values }, label: this.info.name }
  }

  private clamp(name: string, v: number) {
    const c = this.controls.find((x) => x.name === name)!
    if (c.type === 'menu') return c.options?.some((o) => o.value === v) ? v : c.value
    const stepped = c.min + Math.round((v - c.min) / (c.step || 1)) * (c.step || 1)
    return Math.max(c.min, Math.min(c.max, stepped))
  }

  private async write(pairs: [string, number][]) {
    for (const group of applyOrder(pairs)) await this.backend.set(this.info.dev, group)
    this.controls = await this.backend.read(this.info.dev)
  }
}
