// Logitech G headsets and keyboards over HID++ 2.0 (the same protocol as the mice). Only settings the device
// firmware keeps or applies by itself, so nothing depends on Hubless staying open:
//   headsets  0x8300 sidetone, 0x8310 equalizer, 0x1F20 battery voltage and auto power-off, 0x1004/0x1000 battery
//   keyboards 0x8040 backlight brightness, 0x4521 disable keys (game mode), 0x1004/0x1000 battery
// Byte layouts follow Solaar (lib/logitech_receiver/settings_templates.py and hidpp20.py).
// Keyboard RGB effects need software control of the lighting (0x8071 SetSWControl), which switches off the keyboard's
// own lighting and must be kept alive by the host: not done yet.
import type { DeviceKind, DeviceSetting, PeripheralState, SettingValue } from '@shared/types'
import { checkValue, type PeripheralSession } from '../peripheral'
import { type LogitechDevice } from './device'

export const PF = {
  NAME: 0x0005, BATTERY_UNIFIED: 0x1004, BATTERY: 0x1000, ADC: 0x1f20, DISABLE_KEYS: 0x4521, BRIGHTNESS: 0x8040,
  SIDETONE: 0x8300, EQUALIZER: 0x8310, DPI: 0x2201, DPI_EXT: 0x2202, HITS: 0x1b0c
} as const

/** Battery voltage (mV) to percent, Solaar's table for the lithium cells in Logitech headsets. */
const VOLTS: [number, number][] = [[4186, 100], [4067, 90], [3989, 80], [3922, 70], [3859, 60], [3811, 50], [3778, 40], [3751, 30], [3717, 20], [3671, 10], [3646, 5], [3579, 2], [3500, 0]]
export function voltsToPercent(mv: number) {
  if (mv >= VOLTS[0][0]) return 100
  if (mv <= VOLTS[VOLTS.length - 1][0]) return 0
  for (let i = 0; i < VOLTS.length - 1; i++) {
    const [vh, ph] = VOLTS[i]
    const [vl, pl] = VOLTS[i + 1]
    if (mv <= vh && mv >= vl) return Math.round(pl + ((ph - pl) * (mv - vl)) / (vh - vl))
  }
  return 0
}

/**
 * What a Logitech HID++ device is. The device type (0x0005 function 2) says it directly on most; older ones are
 * told apart by their features. Anything that steers a pointer is a mouse.
 */
export async function logitechKind(dev: LogitechDevice): Promise<DeviceKind | null> {
  if (dev.has(PF.DPI) || dev.has(PF.DPI_EXT) || dev.has(PF.HITS)) return 'mouse'
  if (dev.has(PF.NAME)) {
    try {
      const t = (await dev.call(PF.NAME, 2))[0]
      if (t === 0 || t === 2) return 'keyboard'
      if (t >= 3 && t <= 5) return 'mouse'
      if (t === 8) return 'headset'
    } catch {
      /* older firmware: no type function */
    }
  }
  if (dev.has(PF.SIDETONE) || dev.has(PF.EQUALIZER) || dev.has(PF.ADC)) return 'headset'
  if (dev.has(PF.DISABLE_KEYS) || dev.has(PF.BRIGHTNESS)) return 'keyboard'
  return null
}

const KEY_NAMES: [number, string][] = [[0x10, 'Windows key'], [0x01, 'Caps Lock'], [0x02, 'Num Lock'], [0x04, 'Scroll Lock'], [0x08, 'Insert']]

abstract class LogiPeripheral implements PeripheralSession {
  battery: number | null = null
  charging = false
  settings: DeviceSetting[] = []
  abstract kind: DeviceKind

  constructor(public dev: LogitechDevice) {}

  get name() {
    return this.dev.name
  }
  close() {}

  abstract load(): Promise<void>

  async refresh() {
    await this.readBattery()
  }

  state(): PeripheralState {
    return { settings: this.settings, battery: this.battery, charging: this.charging, note: this.note }
  }

  protected note?: string

  abstract set(key: string, value: SettingValue): Promise<void>

  protected version(id: number) {
    return this.dev.featureList.find((f) => f.id === id)?.version ?? 0
  }

  protected setting(key: string) {
    return this.settings.find((s) => s.key === key)
  }

  protected async readBattery() {
    if (this.dev.has(PF.ADC)) {
      // Errors while the headset is on its stand or switched off; keep the last reading.
      try {
        const r = await this.dev.call(PF.ADC, 0)
        const mv = (r[0] << 8) | r[1]
        if (r[2] & 1 && mv) {
          this.battery = voltsToPercent(mv)
          this.charging = !!(r[2] & 2)
        }
      } catch {
        /* inactive */
      }
      return
    }
    if (this.dev.has(PF.BATTERY_UNIFIED) || this.dev.has(PF.BATTERY)) {
      const b = await this.dev.battery()
      if (b) {
        this.battery = b.percent
        this.charging = b.charging
      }
    }
  }
}

export class LogiHeadset extends LogiPeripheral {
  kind: DeviceKind = 'headset'
  private eqCount = 0

  async load() {
    this.settings = []
    await this.readBattery()
    if (this.dev.has(PF.SIDETONE)) {
      const level = (await this.dev.call(PF.SIDETONE, 0))[0]
      this.settings.push({ key: 'sidetone', label: 'Sidetone', hint: 'Hear your own voice in the headset while you talk', group: 'Microphone', kind: 'slider', value: Math.min(100, level), min: 0, max: 100, step: 1, unit: '%', zeroLabel: 'Off' })
    }
    if (this.dev.has(PF.EQUALIZER)) {
      const info = await this.dev.call(PF.EQUALIZER, 0)
      const count = Math.min(info[0], 20)
      const range = info[1]
      const min = info[3] ? (info[3] << 24) >> 24 : -range
      const max = info[4] ? (info[4] << 24) >> 24 : range
      const freqs: number[] = []
      for (let g = 0; g * 7 < count; g++) {
        const r = await this.dev.call(PF.EQUALIZER, 1, [g * 7])
        for (let b = 0; b < 7 && g * 7 + b < count; b++) freqs.push((r[1 + 2 * b] << 8) | r[2 + 2 * b])
      }
      const gains = await this.dev.call(PF.EQUALIZER, 2, [0])
      this.eqCount = count
      this.settings.push({
        key: 'eq', label: 'Equalizer', group: 'Sound', kind: 'eq', value: 0, min, max, step: 1, unit: ' dB',
        bands: freqs.map((freq, i) => ({ freq, gain: Math.max(min, Math.min(max, (gains[i] << 24) >> 24)) }))
      })
    }
    if (this.dev.has(PF.ADC) && this.version(PF.ADC) >= 2) {
      try {
        const mins = (await this.dev.call(PF.ADC, 1))[0]
        this.settings.push({ key: 'autoOff', label: 'Turn off when idle', hint: 'Switches the headset off after this long without sound', group: 'Power', kind: 'slider', value: mins, min: 0, max: 60, step: 5, unit: ' min', zeroLabel: 'Never' })
      } catch {
        /* inactive */
      }
    }
  }

  async set(key: string, value: SettingValue) {
    const s = this.setting(key)
    const v = checkValue(s, value)
    if (key === 'sidetone') {
      await this.dev.call(PF.SIDETONE, 1, [v as number])
      s!.value = (await this.dev.call(PF.SIDETONE, 0))[0]
    } else if (key === 'eq') {
      const gains = v as number[]
      await this.dev.call(PF.EQUALIZER, 3, [0x02, ...gains.map((g) => g & 0xff)])
      const back = await this.dev.call(PF.EQUALIZER, 2, [0])
      s!.bands = s!.bands!.map((b, i) => ({ ...b, gain: (back[i] << 24) >> 24 }))
      if (s!.bands.some((b, i) => b.gain !== gains[i])) throw new Error('The headset did not keep the new EQ.')
    } else if (key === 'autoOff') {
      await this.dev.call(PF.ADC, 2, [v as number])
      s!.value = (await this.dev.call(PF.ADC, 1))[0]
    }
  }

  get bandCount() {
    return this.eqCount
  }
}

export class LogiKeyboard extends LogiPeripheral {
  kind: DeviceKind = 'keyboard'
  private brightness: { min: number; max: number; onOff: boolean } | null = null
  private keyMask = 0

  async load() {
    this.settings = []
    this.note = 'Lighting effects for Logitech keyboards aren’t supported yet; the keyboard keeps its own.'
    await this.readBattery()
    if (this.dev.has(PF.BRIGHTNESS)) {
      const i = await this.dev.call(PF.BRIGHTNESS, 0)
      const max = (i[0] << 8) | i[1]
      const onOff = !!(i[3] & 0x04)
      const min = (i[4] << 8) | i[5]
      if (max > 0) {
        this.brightness = { min, max, onOff }
        let on = true
        if (onOff) on = !!((await this.dev.call(PF.BRIGHTNESS, 3))[0] & 1)
        const r = await this.dev.call(PF.BRIGHTNESS, 1)
        const value = on ? (r[0] << 8) | r[1] : 0
        this.settings.push({ key: 'brightness', label: 'Backlight brightness', group: 'Lighting', kind: 'slider', value, min: onOff ? 0 : min, max, step: 1, unit: max === 100 ? '%' : '', zeroLabel: 'Off' })
      }
    }
    if (this.dev.has(PF.DISABLE_KEYS)) {
      this.keyMask = (await this.dev.call(PF.DISABLE_KEYS, 0))[0]
      const off = (await this.dev.call(PF.DISABLE_KEYS, 1))[0]
      for (const [bit, name] of KEY_NAMES)
        if (this.keyMask & bit)
          this.settings.push({ key: `lock${bit}`, label: `Lock the ${name}`, hint: bit === 0x10 ? 'Game mode: the Windows key does nothing, so it can’t pull you out of a game' : undefined, group: 'Game mode', kind: 'switch', value: off & bit ? 1 : 0 })
    }
  }

  async set(key: string, value: SettingValue) {
    const s = this.setting(key)
    const v = checkValue(s, value) as number
    if (key === 'brightness' && this.brightness) {
      const { min, onOff } = this.brightness
      if (onOff && v < Math.max(1, min)) {
        await this.dev.call(PF.BRIGHTNESS, 4, [0])
        s!.value = 0
        return
      }
      if (onOff) await this.dev.call(PF.BRIGHTNESS, 4, [1])
      const level = Math.max(min, v)
      await this.dev.call(PF.BRIGHTNESS, 2, [level >> 8, level & 0xff])
      const r = await this.dev.call(PF.BRIGHTNESS, 1)
      s!.value = (r[0] << 8) | r[1]
    } else if (key.startsWith('lock')) {
      const bit = Number(key.slice(4))
      const cur = (await this.dev.call(PF.DISABLE_KEYS, 1))[0]
      const next = (v ? cur | bit : cur & ~bit) & this.keyMask
      await this.dev.call(PF.DISABLE_KEYS, 2, [next])
      const back = (await this.dev.call(PF.DISABLE_KEYS, 1))[0]
      for (const x of this.settings) if (x.key.startsWith('lock')) x.value = back & Number(x.key.slice(4)) ? 1 : 0
      if ((back & bit) !== (next & bit)) throw new Error('The keyboard did not keep that change.')
    }
  }
}
