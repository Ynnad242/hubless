// Self-update from GitHub releases (electron-updater). The release's latest-linux.yml lists every package with its
// SHA-512; the download is checked against it before anything is installed.
//
// - AppImage: the file replaces itself, no password.
// - pacman / deb / rpm: the package's root-owned helper (/usr/lib/hubless/hubless-update) installs it through pkexec.
//   A polkit action shipped with the package lets the logged-in user run that helper without a password, and the
//   helper re-checks the file against the release on GitHub, so it can only ever install the real latest Hubless.
//   Installs from before the helper existed fall back to electron-updater's own pkexec prompt.
//
// Settings and backups live in the home folder and device settings live in the devices, so an update never touches
// them.
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { app } from 'electron'
import { PacmanUpdater, autoUpdater, type AppUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

type Listener = (s: UpdateStatus) => void
const SIX_HOURS = 6 * 60 * 60 * 1000
export const UPDATE_HELPER = '/usr/lib/hubless/hubless-update'
const PKEXEC = ['/usr/bin/pkexec', '/bin/pkexec'].find(existsSync)
/** Started with no_new_privs (e.g. restarted by an older Hubless through app.relaunch): pkexec can't run from here. */
const NO_NEW_PRIVS = (() => {
  try {
    return /NoNewPrivs:\s*1/.test(readFileSync('/proc/self/status', 'utf8'))
  } catch {
    return false
  }
})()
const REOPEN = 'Quit Hubless and open it again to finish updating.'

export class Updater {
  status: UpdateStatus = { state: 'idle', checkedAt: null }
  /** What to do once an update is downloaded; decided by the app (install now at startup or in the tray, or wait). */
  onReady: (version: string) => void = () => {}
  /** Called after an update was installed; the app restarts into it (execPath is the new AppImage, if renamed). */
  onInstalled: (execPath?: string) => void = () => {}
  /** The update found by the check at startup installs straight away (the "Updating Hubless" screen). */
  private startup = true
  private updater: AppUpdater | null = null
  private timer: NodeJS.Timeout | null = null
  private kind = ''
  private file = ''
  private newAppImage: string | undefined

  constructor(private onChange: Listener) {}

  get isAppImage() {
    return this.kind === 'AppImage'
  }

  /** Packages install silently through the helper; without it (or pkexec) the system asks for a password. */
  private get silentInstall() {
    return this.isAppImage || (!!PKEXEC && existsSync(UPDATE_HELPER))
  }

  /** Set up the updater for this install; returns false where self-update can't work. */
  async init() {
    if (!app.isPackaged) return this.set({ state: 'unsupported', reason: 'Updates are off when running from source.' }), false
    // electron-updater retries a failed `pacman -U` with `pacman -Sy`, a partial sync that can break an Arch system.
    // Retry plain -U only. (Only used by the password fallback.)
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
    autoUpdater.on('update-not-available', () => {
      this.startup = false
      this.set({ state: 'none', checkedAt: Date.now() })
    })
    autoUpdater.on('update-available', (i) => this.set({ state: 'downloading', version: i.version, percent: 0, startup: this.startup }))
    autoUpdater.on('download-progress', (p) => {
      if (this.status.state === 'downloading') this.set({ ...this.status, percent: Math.round(p.percent) })
    })
    autoUpdater.on('update-downloaded', (i) => {
      this.file = i.downloadedFile
      this.set({ state: 'ready', version: i.version, needsPassword: !this.silentInstall, startup: this.startup })
      this.onReady(i.version)
    })
    autoUpdater.on('appimage-filename-updated', (p: string) => (this.newAppImage = p))
    autoUpdater.on('error', (e) => {
      this.startup = false
      this.set({ state: 'error', message: friendly(e) })
    })
    return true
  }

  private set(s: UpdateStatus) {
    this.status = s
    this.onChange(s)
  }

  /** "Not now" on the startup update screen: keep downloading, but install when Hubless closes instead. */
  defer() {
    this.startup = false
    if (this.status.state === 'downloading' || this.status.state === 'ready') this.set({ ...this.status, startup: false })
  }

  /** True while the update found at startup should install as soon as it's downloaded. */
  get installsNow() {
    return this.startup
  }

  /** Check now; a found update downloads in the background. */
  async check() {
    if (!this.updater || ['downloading', 'ready', 'installing'].includes(this.status.state)) return this.status
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
    if (!on || !this.updater) {
      this.startup = false
      return
    }
    void this.check()
    this.timer = setInterval(() => void this.check(), SIX_HOURS)
    this.timer.unref()
  }

  /** Install the downloaded update, then hand over to onInstalled (which restarts the app). */
  async install() {
    if (!this.updater || this.status.state !== 'ready') return
    const { version, startup } = this.status
    if (!this.silentInstall) {
      // Old install without the helper: electron-updater asks for the password itself and restarts.
      this.updater.quitAndInstall(true, true)
      return
    }
    if (!this.isAppImage && NO_NEW_PRIVS) {
      this.startup = false
      this.set({ state: 'error', message: REOPEN })
      return
    }
    this.set({ state: 'installing', version, startup })
    try {
      if (this.isAppImage) this.installAppImage()
      else await runHelper(this.file)
    } catch (e) {
      this.startup = false
      this.set({ state: 'error', message: friendly(e) })
      return
    }
    // An AppImage runs from a temporary mount that disappears when it exits: restart the AppImage file itself.
    this.onInstalled(this.isAppImage ? (this.newAppImage ?? process.env.APPIMAGE) : undefined)
  }

  /** On quit: install a downloaded update quietly so the next start is already the new version. */
  installOnQuit() {
    if (!this.updater || this.status.state !== 'ready' || !this.silentInstall) return
    if (!this.isAppImage && NO_NEW_PRIVS) return
    try {
      if (this.isAppImage) this.installAppImage()
      else execFileSync(PKEXEC!, [UPDATE_HELPER, this.file], { timeout: 180_000, stdio: 'ignore' })
    } catch {
      /* tried again next time */
    }
  }

  /** Replace the AppImage file without starting it. */
  private installAppImage() {
    ;(this.updater as unknown as { install(silent: boolean, run: boolean): boolean }).install(true, false)
  }
}

function runHelper(file: string) {
  return new Promise<void>((resolve, reject) =>
    execFile(PKEXEC!, [UPDATE_HELPER, file], { timeout: 180_000 }, (err, _out, stderr) => {
      if (!err) return resolve()
      const msg = String(stderr).match(/hubless-update: (.*)/)?.[1]
      reject(new Error(msg ?? (String(stderr).trim().split('\n').pop() || err.message)))
    }),
  )
}

function friendly(e: unknown) {
  const msg = String((e as Error)?.message ?? e)
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|net::ERR_/.test(msg)) return 'No internet connection.'
  if (/404/.test(msg)) return 'No release found on GitHub yet.'
  if (/sha512|checksum/i.test(msg)) return 'The download was damaged and was not installed. It will be tried again.'
  if (/must be setuid root/i.test(msg)) return REOPEN
  if (/Not authorized|dismissed/i.test(msg)) return 'Your system didn’t allow the install.'
  return msg.split('\n')[0].slice(0, 160)
}
