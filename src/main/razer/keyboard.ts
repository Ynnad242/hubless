// Razer keyboards: whole-keyboard lighting (off, static colour, breathing, spectrum), backlight brightness and game
// mode, with the command variant and transaction id OpenRazer's razerkbd driver uses for each model
// (data/razer-keyboards.json, from tools/extract-razer-kbd.py). Current keyboards use the "extended matrix" commands
// (class 0x0F) like Razer mice; older Chroma ones the "standard" matrix commands (class 0x03, command 0x0A).
// Razer keyboards can't report which effect they're showing, so Hubless remembers what it last set.
import type HID from 'node-hid'
import type { DeviceKind, DeviceSetting, LightSetting, PeripheralState, SettingValue } from '@shared/types'
import data from '../../../data/razer-keyboards.json'
import { checkValue, type PeripheralSession } from '../peripheral'
import { RAZER_VID, type RazerTransport } from './razer'

export interface RazerKeyboardModel {
  id: string
  pid: number
  interface: number
  waitMs: number
  wireless: boolean
  variant: 'standard' | 'extended'
  tx: number
  effects: ('none' | 'static' | 'breath' | 'spectrum')[]
  led: number | null
  brightness: { variant: 'standard' | 'extended'; tx: number; args: number[] } | null
  game: { tx: number; args: number[] } | null
}

export const KEYBOARDS = new Map<number, RazerKeyboardModel>(
  (data as unknown as { models: RazerKeyboardModel[] }).models
    .filter((m) => m.variant === 'standard' || m.led !== null) // extended commands need to know their LED
    .map((m) => [m.pid, m])
)

export function razerKeyboardEndpoint(list: HID.Device[]) {
  for (const d of list) {
    const m = d.vendorId === RAZER_VID ? KEYBOARDS.get(d.productId) : undefined
    if (m && d.interface === m.interface && d.path) return { path: d.path, model: m, serial: d.serialNumber ?? '' }
  }
  return null
}

/** Razer's own product name from OpenRazer's id: BLACKWIDOW_V4_75PCT → BlackWidow V4 75%. */
export const keyboardName = (m: RazerKeyboardModel) =>
  m.id
    .replace(/_(WIRED|WIRELESS|ALT)$/, '')
    .replace(/_ALT_/, '_')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\btk\b/, 'tenkeyless')
    .replace(/\b75pct\b/, '75%')
    .replace(/\b(v\d|tkl|te|x|jp|he)\b/g, (w) => w.toUpperCase())
    .replace(/\b8khz\b/, '8KHz')
    .replace(/\bhyperspeed\b/, 'HyperSpeed')
    .replace(/\bblackwidow\b/, 'BlackWidow')
    .replace(/\bdeathstalker\b/, 'DeathStalker')
    .replace(/\b\w/g, (c) => c.toUpperCase())

const EFFECTS: { key: RazerKeyboardModel['effects'][number]; value: number; label: string }[] = [
  { key: 'none', value: 0, label: 'Off' },
  { key: 'static', value: 1, label: 'One colour' },
  { key: 'breath', value: 2, label: 'Breathing' },
  { key: 'spectrum', value: 3, label: 'Colour cycle' }
]

export interface KeyboardStore {
  load(key: string): LightSetting[] | null
  save(key: string, l: LightSetting[]): void
}

export class RazerKeyboard implements PeripheralSession {
  kind: DeviceKind = 'keyboard'
  settings: DeviceSetting[] = []
  battery: number | null = null
  charging = false

  constructor(
    public t: RazerTransport,
    public model: RazerKeyboardModel,
    private serial: string,
    private store: KeyboardStore
  ) {}

  get name() {
    return keyboardName(this.model)
  }
  private get key() {
    return `razer-kbd:${this.model.pid.toString(16)}:${this.serial}`
  }

  close() {
    this.t.close()
  }

  async load() {
    const m = this.model
    const saved = this.store.load(this.key)?.[0]
    const effect = EFFECTS.find((e) => saved && { off: 'none', static: 'static', breathing: 'breath', cycle: 'spectrum' }[saved.effect as string] === e.key)
    this.settings = [
      {
        key: 'effect', label: 'Effect', group: 'Lighting', kind: 'choice', value: effect?.value ?? -1,
        hint: effect ? undefined : 'Razer keyboards can’t say which effect they’re showing. Pick one to set it.',
        options: EFFECTS.filter((e) => m.effects.includes(e.key)).map(({ value, label }) => ({ value, label }))
      },
      { key: 'color', label: 'Colour', group: 'Lighting', kind: 'color', value: parseInt((saved?.color ?? '#2b8cff').slice(1), 16) }
    ]
    if (m.brightness) {
      const [store, led] = m.brightness.args
      const cls = m.brightness.variant === 'extended' ? 0x0f : 0x03
      const r = await this.t.request(cls, cls === 0x0f ? 0x84 : 0x83, 3, [store, led], m.brightness.tx)
      this.settings.push({ key: 'brightness', label: 'Brightness', group: 'Lighting', kind: 'slider', value: Math.round((r[2] * 100) / 255), min: 0, max: 100, step: 1, unit: '%', zeroLabel: 'Off' })
    }
    if (m.game) {
      const [store, led] = m.game.args
      const r = await this.t.request(0x03, 0x80, 3, [store, led], m.game.tx)
      this.settings.push({ key: 'game', label: 'Game mode', hint: 'Turns off the Windows key so it can’t pull you out of a game', group: 'Game mode', kind: 'switch', value: r[2] ? 1 : 0 })
    }
  }

  async refresh() {
    // a keyboard has no battery; this just checks it still answers
    if (this.model.game) await this.t.request(0x03, 0x80, 3, this.model.game.args, this.model.game.tx)
  }

  state(): PeripheralState {
    return { settings: this.settings, battery: null, charging: false }
  }

  private setting(key: string) {
    return this.settings.find((s) => s.key === key)
  }

  /** The request that shows effect e in colour rgb. */
  effectRequest(e: number, rgb: number): [number, number, number, number[]] {
    const m = this.model
    const [r, g, b] = [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff]
    if (m.variant === 'extended') {
      const base = [0x01, m.led!]
      if (e === 0) return [0x0f, 0x02, 6, [...base, 0x00, 0, 0, 0]]
      if (e === 1) return [0x0f, 0x02, 9, [...base, 0x01, 0, 0, 1, r, g, b]]
      if (e === 2) return [0x0f, 0x02, 9, [...base, 0x02, 1, 0, 1, r, g, b]]
      return [0x0f, 0x02, 6, [...base, 0x03, 0, 0, 0]]
    }
    if (e === 0) return [0x03, 0x0a, 1, [0x00]]
    if (e === 1) return [0x03, 0x0a, 4, [0x06, r, g, b]]
    if (e === 2) return [0x03, 0x0a, 8, [0x03, 0x01, r, g, b]]
    return [0x03, 0x0a, 1, [0x04]]
  }

  async set(key: string, value: SettingValue) {
    const s = this.setting(key)
    const v = checkValue(s, value) as number
    const m = this.model
    if (key === 'effect' || key === 'color') {
      const effect = key === 'effect' ? v : this.setting('effect')!.value
      const color = key === 'color' ? v : this.setting('color')!.value
      if (effect >= 0) {
        const [cls, id, size, args] = this.effectRequest(effect, color)
        await this.t.request(cls, id, size, args, m.tx)
      }
      s!.value = v
      if (key === 'effect') s!.hint = undefined
      const name = ({ 0: 'off', 1: 'static', 2: 'breathing', 3: 'cycle' } as const)[effect as 0 | 1 | 2 | 3]
      if (name) this.store.save(this.key, [{ effect: name, color: `#${color.toString(16).padStart(6, '0')}`, brightness: 100, speedMs: 0 }])
    } else if (key === 'brightness' && m.brightness) {
      const [store, led] = m.brightness.args
      const cls = m.brightness.variant === 'extended' ? 0x0f : 0x03
      await this.t.request(cls, cls === 0x0f ? 0x04 : 0x03, 3, [store, led, Math.round((v * 255) / 100)], m.brightness.tx)
      const r = await this.t.request(cls, cls === 0x0f ? 0x84 : 0x83, 3, [store, led], m.brightness.tx)
      s!.value = Math.round((r[2] * 100) / 255)
    } else if (key === 'game' && m.game) {
      const [store, led] = m.game.args
      await this.t.request(0x03, 0x00, 3, [store, led, v], m.game.tx)
      const r = await this.t.request(0x03, 0x80, 3, [store, led], m.game.tx)
      s!.value = r[2] ? 1 : 0
      if (s!.value !== v) throw new Error('The keyboard did not keep that change.')
    }
  }
}
