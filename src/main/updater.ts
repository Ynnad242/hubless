// Self-update from GitHub releases (electron-updater). The release's latest-linux.yml lists every package with its
// SHA-512; the download is checked against it before anything is installed. AppImages replace themselves; pacman,
// deb and rpm installs go through the system password prompt (pkexec), like any package update. Settings and backups
// live in the home folder and device settings live in the devices, so an update never touches them.
import { app } from 'electron'
import { PacmanUpdater, autoUpdater, type AppUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

type Listener = (s: UpdateStatus) => void
const SIX_HOURS = 6 * 60 * 60 * 1000

export class Updater {
  status: UpdateStatus = { state: 'idle', checkedAt: null }
  private updater: AppUpdater | null = null
  private timer: NodeJS.Timeout | null = null
  private kind = ''

  constructor(private onChange: Listener) {}

  /** Set up the updater for this install; returns false where self-update can't work. */
  async init() {
    if (!app.isPackaged) return this.set({ state: 'unsupported', reason: 'Updates are off when running from source.' }), false
    // electron-updater retries a failed `pacman -U` with `pacman -Sy`, a partial sync that can break an Arch system.
    // Retry plain -U only.
    PacmanUpdater.installWithCommandRunner = (file: string, run: (cmd: string[]) => unknown) => {
      run(['pacman', '-U', '--noconfirm', file])
    }
    this.updater = autoUpdater
    this.kind = process.env.APPIMAGE ? 'AppImage' : ((autoUpdater as unknown as { constructor: { name: string } }).constructor.name.replace('Updater', '') || 'package')
    autoUpdater.autoDownload = true
    // Hubless exits with app.exit() (node-hid threads), which skips the 'quit' hook; installOnQuit() does it instead.
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false
    autoUpdater.logger = null
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }))
    autoUpdater.on('update-not-available', () => this.set({ state: 'none', checkedAt: Date.now() }))
    autoUpdater.on('update-available', (i) => this.set({ state: 'downloading', version: i.version, percent: 0 }))
    autoUpdater.on('download-progress', (p) => {
      if (this.status.state === 'downloading') this.set({ ...this.status, percent: Math.round(p.percent) })
    })
    autoUpdater.on('update-downloaded', (i) => this.set({ state: 'ready', version: i.version, needsPassword: this.kind !== 'AppImage' }))
    autoUpdater.on('error', (e) => this.set({ state: 'error', message: friendly(e) }))
    return true
  }

  private set(s: UpdateStatus) {
    this.status = s
    this.onChange(s)
  }

  /** Check now; a found update downloads in the background. */
  async check() {
    if (!this.updater || this.status.state === 'downloading' || this.status.state === 'ready') return this.status
    try {
      await this.updater.checkForUpdates()
    } catch (e) {
      this.set({ state: 'error', message: friendly(e) })
    }
    return this.status
  }

  /** Check at start and every six hours while Hubless keeps running (in the tray). */
  setAutomatic(on: boolean) {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (!on || !this.updater) return
    void this.check()
    this.timer = setInterval(() => void this.check(), SIX_HOURS)
    this.timer.unref()
  }

  /** On quit: an AppImage update replaces the file silently. Package installs need the password prompt, so they
   *  wait for the user to press "Restart to update" instead of prompting while the app closes or the session ends. */
  installOnQuit() {
    if (!this.updater || this.status.state !== 'ready' || this.kind !== 'AppImage') return
    try {
      ;(this.updater as unknown as { install(silent: boolean, run: boolean): boolean }).install(true, false)
    } catch {
      /* tried again next time */
    }
  }

  /** Install the downloaded update now and start the new version. */
  install() {
    if (!this.updater || this.status.state !== 'ready') return
    this.updater.quitAndInstall(true, true)
  }
}

function friendly(e: unknown) {
  const msg = String((e as Error)?.message ?? e)
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|net::ERR_/.test(msg)) return 'No internet connection.'
  if (/404/.test(msg)) return 'No release found on GitHub yet.'
  if (/sha512|checksum/i.test(msg)) return 'The download was damaged and was not installed. It will be tried again.'
  return msg.split('\n')[0].slice(0, 160)
}
