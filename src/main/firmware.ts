// Firmware updates, only where the maker allows them on Linux:
// - fwupd (the Linux firmware service): makers publish signed firmware to the LVFS, fwupd checks and installs it.
//   Hubless asks fwupdmgr, matches its devices to ours by USB id, and runs the install.
// - Wooting: Wootility (app or wootility.io in the browser) installs Wooting firmware; Hubless lets go of the
//   keyboard while it does.
// Everything else (Logitech G, Razer, Endgame Gear, WLmouse, Fractal) only ships firmware through the maker's Windows
// app, so Hubless just says so. Hubless never writes firmware itself.
import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { FirmwareComponent } from '@shared/types'

const FWUPDMGR = ['/usr/bin/fwupdmgr', '/usr/local/bin/fwupdmgr'].find((p) => existsSync(p)) ?? null
export const hasFwupd = () => FWUPDMGR !== null

/** Who ships firmware for each maker Hubless supports, when it isn't fwupd or Wootility. */
export const VENDOR_APP: Record<string, string> = {
  Logitech: 'Logitech G HUB',
  Razer: 'Razer Synapse',
  'Endgame Gear': 'the Endgame Gear firmware updater',
  WLmouse: 'the WLmouse app',
  'Fractal Design': 'Fractal Adjust'
}

function run(args: string[], timeoutMs = 60_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    if (!FWUPDMGR) return resolve({ code: -1, out: '' })
    execFile(FWUPDMGR, args, { timeout: timeoutMs, maxBuffer: 16 << 20 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out: stdout || stderr })
    )
  })
}

interface FwDevice {
  DeviceId?: string
  Name?: string
  Version?: string
  Flags?: string[]
  InstanceIds?: string[]
  Releases?: { Version?: string; Summary?: string; Description?: string; Size?: number; Flags?: string[] }[]
}

const parse = (out: string): FwDevice[] => {
  try {
    return (JSON.parse(out) as { Devices?: FwDevice[] }).Devices ?? []
  } catch {
    return []
  }
}

/** USB ids ("046d:c54d") an fwupd device answers to: USB devices, and HID++ peripherals behind a receiver. */
export function usbIdsOf(d: FwDevice): string[] {
  const out = new Set<string>()
  for (const i of d.InstanceIds ?? []) {
    const m = /^(?:USB\\VID_|HIDRAW\\VEN_)([0-9A-F]{4})&(?:PID|DEV)_([0-9A-F]{4})/i.exec(i)
    if (m) out.add(`${m[1]}:${m[2]}`.toLowerCase())
  }
  return [...out]
}

/** Firmware description from the LVFS is a small XML-ish markup (<p>, <li>): plain text for the UI. */
export const plainNotes = (s = '') =>
  s.replace(/<li>/g, '• ').replace(/<\/(p|li)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{2,}/g, '\n').trim()

/** Merge fwupd's device list with its update list into what the UI shows. */
export function components(devices: FwDevice[], updates: FwDevice[], usb: string[]): FirmwareComponent[] {
  const want = new Set(usb.map((u) => u.toLowerCase()))
  return devices
    .filter((d) => d.DeviceId && usbIdsOf(d).some((u) => want.has(u)))
    .map((d) => {
      const r = updates.find((u) => u.DeviceId === d.DeviceId)?.Releases?.[0]
      return {
        fwupdId: d.DeviceId!,
        name: d.Name ?? 'Device',
        version: d.Version ?? '',
        updatable: (d.Flags ?? []).includes('updatable'),
        update: r?.Version
          ? { version: r.Version, summary: r.Summary ?? '', notes: plainNotes(r.Description), sizeBytes: r.Size ?? 0 }
          : undefined
      }
    })
}

let lastRefresh = 0

/** Ask fwupd about the devices with these USB ids. Refreshes the LVFS list at most once a day (no password needed). */
export async function check(usb: string[], refresh = false): Promise<FirmwareComponent[]> {
  if (!FWUPDMGR || !usb.length) return []
  if (refresh || Date.now() - lastRefresh > 86_400_000) {
    await run(['refresh', '--json'], 90_000) // "already up to date" is fine too
    lastRefresh = Date.now()
  }
  const devices = parse((await run(['get-devices', '--json'])).out)
  const updates = parse((await run(['get-updates', '--json'])).out)
  return components(devices, updates, usb)
}

/**
 * Install the newest firmware for one fwupd device. fwupd downloads it from the LVFS, checks its signature and
 * flashes it; progress percentages from its output go to onProgress.
 */
export function install(fwupdId: string, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!FWUPDMGR) return reject(new Error('fwupd is not installed.'))
    if (!/^[0-9a-f]{40}$/i.test(fwupdId)) return reject(new Error('Unknown firmware device.'))
    const p = spawn(FWUPDMGR, ['update', fwupdId, '--assume-yes', '--no-reboot-check', '--no-unreported-check'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    const read = (b: Buffer) => {
      const s = b.toString()
      log = (log + s).slice(-4000)
      for (const m of s.matchAll(/(\d{1,3})%/g)) onProgress(Math.min(100, Number(m[1])))
    }
    p.stdout.on('data', read)
    p.stderr.on('data', read)
    p.on('error', reject)
    p.on('close', (code) => {
      if (code === 0) return resolve()
      const line = log.trim().split('\n').filter(Boolean).pop() ?? ''
      reject(new Error(`The firmware update did not finish${line ? `: ${line}` : ''}. The device keeps its old firmware.`))
    })
  })
}

// ---------------------------------------------------------------- Wootility

const WOOTILITY_WEB = 'https://wootility.io'

/** An installed Wootility: a program on PATH, an AppImage in the usual places, or a desktop entry. */
export function findWootility(): { cmd: string; args: string[] } | null {
  const home = homedir()
  for (const dir of (process.env.PATH ?? '').split(':').filter(Boolean))
    for (const name of ['wootility', 'Wootility', 'wootility-lekker']) if (existsSync(join(dir, name))) return { cmd: join(dir, name), args: [] }
  for (const dir of [join(home, 'Applications'), join(home, '.local/bin'), join(home, 'Downloads'), '/opt']) {
    try {
      const f = readdirSync(dir).find((n) => /^wootility.*\.appimage$/i.test(n))
      if (f) return { cmd: join(dir, f), args: [] }
    } catch {
      /* folder missing */
    }
  }
  for (const dir of [join(home, '.local/share/applications'), '/usr/share/applications', '/var/lib/flatpak/exports/share/applications']) {
    try {
      const f = readdirSync(dir).find((n) => /wootility/i.test(n) && n.endsWith('.desktop'))
      if (f && /Exec=/.test(readFileSync(join(dir, f), 'utf8'))) return { cmd: 'gio', args: ['launch', join(dir, f)] }
    } catch {
      /* folder missing */
    }
  }
  return null
}

/** Start Wootility; without the app, open the web version (it updates firmware in Chromium-based browsers). */
export async function openWootility(openUrl: (url: string) => Promise<void>): Promise<'app' | 'web'> {
  const w = findWootility()
  if (w) {
    const started = await new Promise<boolean>((resolve) => {
      const p = spawn(w.cmd, w.args, { detached: true, stdio: 'ignore' })
      p.once('spawn', () => (p.unref(), resolve(true)))
      p.once('error', () => resolve(false))
    })
    if (started) return 'app'
  }
  await openUrl(WOOTILITY_WEB)
  return 'web'
}
