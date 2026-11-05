// Backups, profile files and the one-time udev permission fix.
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import type { BackupInfo } from '@shared/types'

const DATA = join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'hubless')

export const UDEV_RULE_PATH = '/etc/udev/rules.d/70-hubless.rules'
// Vendors whose peripherals Hubless talks to.
export const VENDORS: Record<string, string> = {
  '046d': 'Logitech', '31e3': 'Wooting', '36bc': 'Fractal Design', '1532': 'Razer', '3367': 'Endgame Gear'
}
export const UDEV_RULE =
  '# hubless: let the logged-in user configure their mice, keyboards and headsets\n' +
  Object.entries(VENDORS)
    // udev has no end-of-line comments: the vendor name goes on its own line.
    .map(([vid, name]) => `# ${name}\nKERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="${vid}", TAG+="uaccess"\n`)
    .join('')

export function backupDir(serial: string) {
  const d = join(DATA, 'backups', serial || 'unknown')
  mkdirSync(d, { recursive: true })
  return d
}

const stamp = () => new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')

export function saveBackup(serial: string, device: string, fmt: number, sectors: Map<number, Uint8Array>, label: string) {
  const path = join(backupDir(serial), `${stamp()}_${label}.json`)
  const obj: Record<string, string> = {}
  for (const [k, v] of sectors) obj['0x' + k.toString(16).padStart(4, '0')] = Buffer.from(v).toString('hex')
  writeFileSync(path, JSON.stringify({ hubless_backup: 1, device, serial, format: fmt, created: Date.now() / 1000, label, sectors: obj }, null, 1))
  return path
}

export function listBackups(serial: string): BackupInfo[] {
  const dir = backupDir(serial)
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .flatMap((f) => {
      try {
        const d = JSON.parse(readFileSync(join(dir, f), 'utf8'))
        return [{ path: join(dir, f), created: d.created, label: d.label }]
      } catch {
        return []
      }
    })
}

export function loadBackup(path: string): Map<number, Uint8Array> {
  const d = JSON.parse(readFileSync(path, 'utf8'))
  if (d.hubless_backup !== 1) throw new Error('Not a Hubless backup file.')
  return new Map(Object.entries(d.sectors as Record<string, string>).map(([k, v]) => [parseInt(k, 16), Uint8Array.from(Buffer.from(v, 'hex'))]))
}

export function exportProfile(path: string, device: string, fmt: number, raw: Uint8Array, name: string) {
  writeFileSync(path, JSON.stringify({ hubless_profile: 1, device, format: fmt, name, sector: Buffer.from(raw).toString('hex') }, null, 1))
}

export function importProfile(path: string, fmt: number, size: number): Uint8Array {
  const d = JSON.parse(readFileSync(path, 'utf8'))
  if (d.hubless_profile !== 1) throw new Error('Not a Hubless profile file.')
  if (d.format !== fmt) throw new Error('That profile was made for a different kind of mouse.')
  const raw = Uint8Array.from(Buffer.from(d.sector, 'hex'))
  if (raw.length !== size) throw new Error('That profile file is damaged.')
  return raw
}

/** Install the uaccess rule behind a polkit password prompt. */
export function installUdevRule(): Promise<{ ok: boolean; message: string }> {
  const pkexec = ['/usr/bin/pkexec', '/bin/pkexec'].find(existsSync)
  if (!pkexec) return Promise.resolve({ ok: false, message: `Polkit isn't installed. Copy the rule to ${UDEV_RULE_PATH} as root.` })
  const script =
    'printf "%s" "$1" > "$2" && chmod 644 "$2" && udevadm control --reload-rules && ' +
    'udevadm trigger --action=add --subsystem-match=hidraw && udevadm settle'
  return new Promise((resolve) => {
    execFile(pkexec, ['/bin/sh', '-c', script, 'hubless', UDEV_RULE, UDEV_RULE_PATH], { timeout: 120000 }, (err, _o, stderr) => {
      if (!err) return resolve({ ok: true, message: 'Access granted.' })
      const code = (err as NodeJS.ErrnoException & { code?: number }).code
      if (code === 126 || code === 127) return resolve({ ok: false, message: 'Permission was not granted.' })
      resolve({ ok: false, message: (stderr || String(err)).trim() })
    })
  })
}

// ---------------------------------------------------------------- custom device photos (stay on this PC)
const IMAGES = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'hubless', 'images')
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
const safe = (id: string) => id.replace(/[^a-z0-9._-]/gi, '_')

function imageFile(id: string) {
  if (!existsSync(IMAGES)) return null
  const f = readdirSync(IMAGES).find((n) => n.startsWith(safe(id) + '.'))
  return f ? join(IMAGES, f) : null
}

const asDataUrl = (path: string) => `data:${MIME[extname(path).toLowerCase()] ?? 'image/png'};base64,${readFileSync(path).toString('base64')}`

export function deviceImages(): Record<string, string> {
  if (!existsSync(IMAGES)) return {}
  const out: Record<string, string> = {}
  for (const f of readdirSync(IMAGES)) out[f.slice(0, f.lastIndexOf('.'))] = asDataUrl(join(IMAGES, f))
  return out
}

export function setDeviceImage(id: string, source: string) {
  const ext = extname(source).toLowerCase()
  if (!MIME[ext]) throw new Error('Pick a PNG, JPEG or WebP image.')
  mkdirSync(IMAGES, { recursive: true })
  clearDeviceImage(id)
  const dest = join(IMAGES, safe(id) + ext)
  copyFileSync(source, dest)
  return asDataUrl(dest)
}

export function clearDeviceImage(id: string) {
  const f = imageFile(id)
  if (f) rmSync(f)
}
