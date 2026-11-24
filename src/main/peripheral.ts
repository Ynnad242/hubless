// A headset or keyboard whose driver describes its own settings; the generic device page draws them.
import type { DeviceKind, DeviceSetting, PeripheralState, SettingValue } from '@shared/types'

export interface PeripheralSession {
  name: string
  kind: DeviceKind
  /** read everything once, when the device is found */
  load(): Promise<void>
  /** cheap status refresh (battery, connection) */
  refresh(): Promise<void>
  state(): PeripheralState
  set(key: string, value: SettingValue): Promise<void>
  close(): void
}

/** Checks a value against a setting before anything is sent to the device. */
export function checkValue(s: DeviceSetting | undefined, value: SettingValue): number | number[] {
  if (!s) throw new Error('That setting is not available on this device.')
  if (s.kind === 'eq') {
    if (!Array.isArray(value) || value.length !== s.bands!.length || value.some((v) => !Number.isFinite(v) || v < s.min! || v > s.max!))
      throw new Error('Those EQ values are out of range.')
    return value.map((v) => Math.round(v))
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('That value is not a number.')
  if (s.kind === 'switch') return value ? 1 : 0
  if (s.kind === 'color') {
    if (value < 0 || value > 0xffffff) throw new Error('That is not a colour.')
    return Math.round(value)
  }
  if (s.kind === 'choice') {
    if (!s.options!.some((o) => o.value === value)) throw new Error('That choice is not available.')
    return value
  }
  if (value < s.min! || value > s.max!) throw new Error('That value is out of range.')
  return Math.round(value)
}
