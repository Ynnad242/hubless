// Backups, profile files and the one-time udev permission fix.
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { nativeImage } from 'electron'
import type { BackupInfo } from '@shared/types'
import { modelKey } from '@shared/devices'

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

/** A backup file the UI picked, accepted only if it lies inside that device's own backup folder. */
export function backupPathFor(key: string, path: unknown): string {
  if (typeof path !== 'string') throw new Error('Pick a backup from the list.')
  const dir = resolve(backupDir(key))
  const full = resolve(path)
  if (!full.startsWith(dir + sep) || !full.endsWith('.json')) throw new Error('That backup is not in this device’s backup folder.')
  return full
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

/** Product photos shipped with the app, one per model, named by modelKey() (data/devices in the source tree). */
const SHIPPED = [join(process.resourcesPath ?? '', 'devices'), join(__dirname, '../../data/devices')].find((d) => existsSync(d))

const urlCache = new Map<string, { mtime: number; url: string }>()

/** A photo as a data URL, read and encoded once per file version. */
function cachedUrl(path: string) {
  const mtime = statSync(path).mtimeMs
  const hit = urlCache.get(path)
  if (hit && hit.mtime === mtime) return hit.url
  const url = asDataUrl(path)
  urlCache.set(path, { mtime, url })
  return url
}

const findIn = (dir: string | undefined, base: string) =>
  dir && existsSync(dir) ? readdirSync(dir).find((f) => f.slice(0, f.lastIndexOf('.')) === base && MIME[extname(f).toLowerCase()]) : undefined

/** Photos for just these devices: the user's own (keyed by device id) or else the one shipped for the model
 *  (keyed "model:<modelKey>"). Photos for devices that aren't on screen are never read or sent. */
export function deviceImages(devices: { id: string; vendor: string; name: string }[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const d of devices.slice(0, 64)) {
    if (typeof d?.id !== 'string' || typeof d.vendor !== 'string' || typeof d.name !== 'string') continue
    const own = findIn(IMAGES, safe(d.id))
    if (own) {
      out[d.id] = cachedUrl(join(IMAGES, own))
      continue
    }
    const key = modelKey(d.vendor, d.name)
    const shipped = findIn(SHIPPED, key)
    if (shipped) out[`model:${key}`] = cachedUrl(join(SHIPPED!, shipped))
  }
  return out
}

export function setDeviceImage(id: string, source: string) {
  const ext = extname(source).toLowerCase()
  if (!MIME[ext]) throw new Error('Pick a PNG, JPEG or WebP image.')
  mkdirSync(IMAGES, { recursive: true })
  clearDeviceImage(id)
  // Phone photos are often 4000 px and several MB: keep at most 1200 px on the long side.
  const img = nativeImage.createFromPath(source)
  const { width, height } = img.getSize()
  if (!img.isEmpty() && Math.max(width, height) > 1200) {
    const dest = join(IMAGES, safe(id) + '.png')
    const scaled = width >= height ? img.resize({ width: 1200, quality: 'best' }) : img.resize({ height: 1200, quality: 'best' })
    writeFileSync(dest, scaled.toPNG())
    return cachedUrl(dest)
  }
  const dest = join(IMAGES, safe(id) + ext)
  copyFileSync(source, dest)
  return cachedUrl(dest)
}

export function clearDeviceImage(id: string) {
  const f = imageFile(id)
  if (f) rmSync(f)
}

// ---------------------------------------------------------------- privacy

const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'hubless')
const AUTOSTART_FILE = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart', 'io.github.hubless.Hubless.desktop')

/** Everything Hubless keeps on this computer (see PRIVACY.md). Device memory and the system udev rule are not touched. */
export function deleteAllData() {
  for (const p of [CONFIG_DIR, DATA, AUTOSTART_FILE]) rmSync(p, { recursive: true, force: true })
}

/** PRIVACY.md / THIRD_PARTY_NOTICES.md, shipped as resources/docs in the package. */
export function readDocument(name: 'privacy' | 'licenses') {
  const file = name === 'privacy' ? 'PRIVACY.md' : 'THIRD_PARTY_NOTICES.md'
  const path = [join(process.resourcesPath ?? '', 'docs', file), join(__dirname, '../..', file)].find((p) => existsSync(p))
  if (!path) throw new Error(`${file} is missing from this build.`)
  return readFileSync(path, 'utf8')
}
