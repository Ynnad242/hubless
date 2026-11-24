// Webcams: any USB Video Class camera (Logitech C920/C922/Brio/StreamCam, Razer Kiyo, Elgato Facecam, laptop
// cameras on USB...). Linux's uvcvideo driver exposes the camera's settings as V4L2 controls; Hubless reads and sets
// them with v4l2-ctl (v4l-utils), which needs no extra permissions: the logged-in user can open /dev/video*.
//
// Most webcams have no memory for these settings: they go back to factory values when unplugged or when the PC
// sleeps, and apps such as Discord or Zoom change them freely. So Hubless saves the settings per camera, puts them
// back whenever the camera shows up, and (if "Keep my settings" is on) whenever another app changes them.
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import type { CameraControl } from '@shared/types'

export interface CameraInfo {
  dev: string // /dev/videoN, the capture node
  name: string // as the driver reports it, also what the browser lists for the preview
  vid: number
  pid: number
  serial: string
  usb: string // USB port path, e.g. 5-1, to tell two identical cameras apart when they have no serial
}

/** What Hubless needs from a camera, so tests and demo mode can use a simulated one. */
export interface CameraBackend {
  list(): CameraInfo[]
  read(dev: string): Promise<CameraControl[]>
  set(dev: string, values: [string, number][]): Promise<void>
}

const V4L = '/sys/class/video4linux'
const V4L2CTL = ['/usr/bin/v4l2-ctl', '/bin/v4l2-ctl', '/usr/local/bin/v4l2-ctl'].find(existsSync)
export const hasV4l2Ctl = () => !!V4L2CTL

const read = (p: string) => {
  try {
    return readFileSync(p, 'utf8').trim()
  } catch {
    return ''
  }
}

/** USB cameras handled by uvcvideo, one entry per camera (its capture node), from sysfs. */
export function listUvc(root = V4L): CameraInfo[] {
  let names: string[]
  try {
    names = readdirSync(root).filter((n) => /^video\d+$/.test(n))
  } catch {
    return []
  }
  const out: CameraInfo[] = []
  for (const n of names.sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))) {
    const node = join(root, n)
    if (read(join(node, 'index')) !== '0') continue // metadata and second streams
    let iface: string
    try {
      iface = realpathSync(join(node, 'device'))
    } catch {
      continue
    }
    let driver = ''
    try {
      driver = realpathSync(join(iface, 'driver')).split('/').pop() ?? ''
    } catch {
      /* no driver link */
    }
    if (driver !== 'uvcvideo') continue // virtual cameras (OBS, v4l2loopback), capture cards, ...
    const usbDev = join(iface, '..')
    const vid = parseInt(read(join(usbDev, 'idVendor')), 16)
    const pid = parseInt(read(join(usbDev, 'idProduct')), 16)
    if (!vid) continue
    out.push({ dev: `/dev/${n}`, name: read(join(node, 'name')) || read(join(usbDev, 'product')) || 'Webcam', vid, pid, serial: read(join(usbDev, 'serial')), usb: usbDev.split('/').pop() ?? '' })
  }
  return out
}

/** Parses `v4l2-ctl --list-ctrls-menus`. Buttons, strings and other types are left out. */
export function parseControls(text: string): CameraControl[] {
  const out: CameraControl[] = []
  let menu: CameraControl | null = null
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\w+)\s+0x[0-9a-f]+\s+\((int|bool|menu|intmenu)\)\s*:\s*(.*)$/)
    if (m) {
      const [, name, kind, rest] = m
      const num = (k: string) => {
        const v = rest.match(new RegExp(`\\b${k}=(-?\\d+)`))
        return v ? Number(v[1]) : undefined
      }
      const flags = rest.match(/flags=([\w, -]+)/)?.[1] ?? ''
      const type = kind === 'bool' ? 'bool' : kind === 'int' ? 'int' : 'menu'
      const c: CameraControl = {
        name, type,
        min: num('min') ?? 0, max: num('max') ?? 1, step: num('step') ?? 1,
        default: num('default') ?? 0, value: num('value') ?? 0,
        inactive: /\binactive\b/.test(flags)
      }
      if (/\b(read-only|write-only|disabled)\b/.test(flags)) {
        menu = null
        continue
      }
      if (type === 'menu') c.options = []
      out.push(c)
      menu = type === 'menu' ? c : null
      continue
    }
    const o = line.match(/^\s+(-?\d+):\s+(.+?)\s*$/)
    if (o && menu) menu.options!.push({ value: Number(o[1]), label: o[2].replace(/\s+\(0x[0-9a-f]+\)$/i, '') })
    else if (line.trim() && !/^\s/.test(line)) menu = null // section headings ("User Controls")
  }
  return out
}

function v4l2ctl(args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(V4L2CTL!, args, { timeout: 4000 }, (err, out, stderr) => (err ? reject(new Error(String(stderr).trim() || err.message)) : resolve(out)))
  )
}

export const realCameras: CameraBackend = {
  list: () => listUvc(),
  read: async (dev) => parseControls(await v4l2ctl(['-d', dev, '--list-ctrls-menus'])),
  set: async (dev, values) => {
    if (values.length) await v4l2ctl(['-d', dev, `--set-ctrl=${values.map(([k, v]) => `${k}=${v}`).join(',')}`])
  }
}

/**
 * Order matters: a manual value only sticks once its "auto" switch is off, so switches go first and the values they
 * unlock after (exposure time after auto exposure, temperature after auto white balance, focus after autofocus).
 */
const SWITCHES = ['auto_exposure', 'exposure_auto', 'white_balance_automatic', 'white_balance_temperature_auto', 'focus_automatic_continuous', 'focus_auto']
export const isSwitch = (name: string) => SWITCHES.includes(name)
export function applyOrder(values: [string, number][]): [string, number][][] {
  const first = values.filter(([k]) => isSwitch(k))
  const rest = values.filter(([k]) => !isSwitch(k))
  return [first, rest].filter((g) => g.length)
}

/** Which saved settings the camera has lost (unplugged, slept, or another app changed them). */
export function drifted(controls: CameraControl[], saved: Record<string, number>): [string, number][] {
  const out: [string, number][] = []
  for (const [k, v] of Object.entries(saved)) {
    const c = controls.find((x) => x.name === k)
    if (!c || c.value === v) continue
    // A manual value the camera ignores while its auto switch is on can't drift; its switch is checked instead.
    if (c.inactive) continue
    out.push([k, v])
  }
  return out
}

/** A camera for demo mode and tests, with the controls of a Logitech C922. */
export class SimCamera implements CameraBackend {
  controls = new Map<string, CameraControl[]>()
  writes: [string, number][] = []
  constructor(private cams: CameraInfo[] = [{ dev: '/dev/video-demo', name: 'C922 Pro Stream Webcam', vid: 0x046d, pid: 0x085c, serial: 'DEMO', usb: 'demo' }]) {
    for (const c of cams) this.controls.set(c.dev, c922())
  }
  list() {
    return this.cams
  }
  async read(dev: string) {
    const cs = this.controls.get(dev)!
    const val = (n: string) => cs.find((c) => c.name === n)?.value
    for (const c of cs) {
      c.inactive =
        (c.name === 'exposure_time_absolute' && val('auto_exposure') !== 1) ||
        (c.name === 'white_balance_temperature' && val('white_balance_automatic') === 1) ||
        (c.name === 'focus_absolute' && val('focus_automatic_continuous') === 1)
    }
    return structuredClone(cs)
  }
  async set(dev: string, values: [string, number][]) {
    const cs = this.controls.get(dev)!
    await this.read(dev) // which controls are locked right now
    for (const [k, v] of values) {
      const c = cs.find((x) => x.name === k)
      if (!c) throw new Error(`unknown control ${k}`)
      if (c.inactive) continue // like a real camera: a value its auto switch locks is ignored
      c.value = Math.max(c.min, Math.min(c.max, v))
      this.writes.push([k, v])
    }
  }
}

function c922(): CameraControl[] {
  const int = (name: string, min: number, max: number, def: number, step = 1): CameraControl => ({ name, type: 'int', min, max, step, default: def, value: def, inactive: false })
  const bool = (name: string, def: number): CameraControl => ({ name, type: 'bool', min: 0, max: 1, step: 1, default: def, value: def, inactive: false })
  return [
    int('brightness', 0, 255, 128), int('contrast', 0, 255, 128), int('saturation', 0, 255, 128),
    bool('white_balance_automatic', 1), int('gain', 0, 255, 0),
    { name: 'power_line_frequency', type: 'menu', min: 0, max: 2, step: 1, default: 2, value: 2, inactive: false, options: [{ value: 0, label: 'Disabled' }, { value: 1, label: '50 Hz' }, { value: 2, label: '60 Hz' }] },
    int('white_balance_temperature', 2000, 6500, 4000), int('sharpness', 0, 255, 128), int('backlight_compensation', 0, 1, 0),
    { name: 'auto_exposure', type: 'menu', min: 0, max: 3, step: 1, default: 3, value: 3, inactive: false, options: [{ value: 1, label: 'Manual Mode' }, { value: 3, label: 'Aperture Priority Mode' }] },
    int('exposure_time_absolute', 3, 2047, 250), bool('exposure_dynamic_framerate', 0),
    int('pan_absolute', -36000, 36000, 0, 3600), int('tilt_absolute', -36000, 36000, 0, 3600),
    int('focus_absolute', 0, 250, 0, 5), bool('focus_automatic_continuous', 1), int('zoom_absolute', 100, 500, 100)
  ]
}
