// Tray icon, low-battery notifications, start-on-login and the settings behind them.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Menu, Notification, Tray, app, nativeImage } from 'electron'
import type { AppSettings, AppSnapshot } from '@shared/types'

const CONFIG = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'hubless')
const FILE = join(CONFIG, 'settings.json')
const AUTOSTART = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart', 'io.github.hubless.Hubless.desktop')
const DEFAULTS: AppSettings = { runInTray: true, startOnLogin: false, lowBattery: 15, autoUpdate: true }

export function loadSettings(): AppSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, 'utf8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...patch }
  mkdirSync(CONFIG, { recursive: true })
  writeFileSync(FILE, JSON.stringify(next, null, 1))
  setAutostart(next.startOnLogin)
  return next
}

/** XDG autostart entry; the packaged app lives at /opt/Hubless, the AppImage path is used when running from one. */
function setAutostart(on: boolean) {
  if (!on) {
    if (existsSync(AUTOSTART)) rmSync(AUTOSTART)
    return
  }
  const exec = process.env.APPIMAGE ?? (app.isPackaged ? process.execPath : `${process.execPath} ${app.getAppPath()}`)
  mkdirSync(join(AUTOSTART, '..'), { recursive: true })
  writeFileSync(
    AUTOSTART,
    `[Desktop Entry]\nType=Application\nName=Hubless\nExec=${exec} --hidden\nIcon=io.github.hubless.Hubless\nX-GNOME-Autostart-enabled=true\nNoDisplay=true\n`
  )
}

export class TrayController {
  private tray: Tray | null = null
  private warned = new Set<string>()

  constructor(private icon: string, private show: () => void, private quit: () => void) {}

  ensure() {
    if (this.tray) return
    try {
      this.tray = new Tray(nativeImage.createFromPath(this.icon).resize({ width: 22, height: 22 }))
      this.tray.setToolTip('Hubless')
      this.tray.on('click', this.show)
      this.update(null)
    } catch {
      this.tray = null // no tray on this desktop; the window simply stays the way to open Hubless
    }
  }

  get available() {
    return !!this.tray
  }

  update(snap: AppSnapshot | null) {
    if (snap) this.checkBatteries(snap)
    if (!this.tray) return
    const devices = snap?.devices.filter((d) => d.status === 'ready' || d.status === 'asleep') ?? []
    const lines = devices.map((d) => ({
      label: `${d.name}${d.battery ? ` · ${d.battery.percent}%${d.battery.charging ? ' ⚡' : ''}` : ''}${d.status === 'asleep' ? ' · asleep' : ''}`,
      enabled: false
    }))
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        ...(lines.length ? lines : [{ label: 'No devices connected', enabled: false }]),
        { type: 'separator' },
        { label: 'Open Hubless', click: this.show },
        { label: 'Quit', click: this.quit }
      ])
    )
    const low = devices.filter((d) => d.battery && d.battery.percent <= loadSettings().lowBattery && !d.battery.charging)
    this.tray.setToolTip(low.length ? `Hubless · ${low.map((d) => `${d.name} ${d.battery!.percent}%`).join(', ')}` : 'Hubless')
  }

  private checkBatteries(snap: AppSnapshot) {
    const limit = loadSettings().lowBattery
    if (!limit) return
    for (const d of snap.devices) {
      const b = d.battery
      if (!b) continue
      if (b.charging || b.percent > limit + 5) {
        this.warned.delete(d.id) // re-arm once it has charged a bit
        continue
      }
      if (b.percent <= limit && !this.warned.has(d.id) && Notification.isSupported()) {
        this.warned.add(d.id)
        new Notification({ title: `${d.name} battery low`, body: `${b.percent}% left. Time to charge it.`, icon: this.icon }).show()
      }
    }
  }
}
