import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import type { Hits, HublessApi, ProfileData } from '@shared/types'
import { DeviceManager } from './manager'
import { TrayController, loadSettings, saveSettings } from './tray'
import * as storage from './storage'
import { fromHex } from './logitech/profile'
import { handleSignals, watchForUpgrade } from './lifecycle'

const demo = process.argv.includes('--demo') || process.env.HUBLESS_DEMO === '1'
const manager = new DeviceManager(demo)
let win: BrowserWindow | null = null
let quitting = false
let wipeUserData = false
const iconPath = () => (app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../build/icon.png'))

function showWindow() {
  if (!win) createWindow()
  win!.show()
  win!.focus()
}

function quit() {
  quitting = true
  win?.close()
  if (!win) app.exit(0)
}

/** Start the (possibly newly installed) app again, keeping it in the tray if the window was hidden. */
function restart() {
  const args = process.argv.slice(1).filter((a) => a !== '--hidden')
  if (!win?.isVisible()) args.push('--hidden')
  app.relaunch({ args })
  quit()
}

const tray = new TrayController(iconPath(), showWindow, quit)

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    title: 'Hubless',
    backgroundColor: '#14131a',
    autoHideMenuBar: true,
    icon: iconPath(),
    show: !process.env.HUBLESS_SHOTS && !process.argv.includes('--hidden'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      offscreen: !!process.env.HUBLESS_SHOTS
    }
  })
  win.setMenuBarVisibility(false)
  // Let the UI finish a pending save before the window goes away.
  let flushed = false
  win.on('close', (e) => {
    // With "keep running in the tray", closing hides the window so battery alerts keep working.
    if (!quitting && !process.env.HUBLESS_SHOTS && loadSettings().runInTray && tray.available) {
      e.preventDefault()
      void win?.webContents.executeJavaScript('window.__flush ? window.__flush() : null').finally(() => win?.hide())
      return
    }
    if (flushed || !win) return
    e.preventDefault()
    const done = () => {
      flushed = true
      win?.close()
    }
    win.webContents.executeJavaScript('window.__flush ? window.__flush() : null').then(done, done)
    setTimeout(done, 3000)
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

// Every renderer call goes through here; method names match HublessApi.
const api: Omit<HublessApi, 'onChange' | 'onButtons' | 'onDepth'> = {
  snapshot: async () => manager.snapshot(),
  mouseState: (id) => manager.runMouse(id, async (s) => s.state()),
  saveProfile: (id, p: ProfileData) =>
    manager.runMouse(id, async (s) => {
      await s.saveProfile(p)
      return s.state()
    }),
  previewHits: (id, hits: Hits[]) => manager.run(id, (s) => s.previewHits(hits)),
  watchDepth: (id, on) =>
    manager.run(id, async (s) => {
      if (on) await s.startDepth((l, r) => win?.webContents.send('hubless:depth', id, l, r))
      else await s.stopDepth()
    }),
  activateProfile: (id, sector) =>
    manager.run(id, async (s) => {
      await s.activate(sector)
      return s.state()
    }),
  setProfileEnabled: (id, slot, on) =>
    manager.run(id, async (s) => {
      await s.setEnabled(slot, on)
      return s.state()
    }),
  replaceProfile: (id, sector, source) =>
    manager.run(id, async (s) => {
      let raw: Uint8Array
      if (source === 'factory') {
        if (!s.factory) throw new Error('This mouse has no factory profile stored.')
        raw = s.factory
      } else if ('fromSector' in source) {
        raw = Uint8Array.from(s.rawOf(source.fromSector))
        if (s.dev.onboard!.fmt === 8) raw.set(s.rawOf(sector).subarray(0xa0, 0xd0), 0xa0) // keep the name
      } else raw = fromHex(source.raw)
      await s.replaceSector(sector, raw)
      return s.state()
    }),
  backup: (id) => manager.runMouse(id, (s) => s.backup()),
  listBackups: async (id) => storage.listBackups(manager.mouseSession(id).backupKey),
  restoreBackup: (id, path) =>
    manager.runMouse(id, async (s) => {
      await s.restore(storage.loadBackup(path))
      return s.state()
    }),
  openBackupsFolder: async (id) => {
    await shell.openPath(storage.backupDir(manager.mouseSession(id).backupKey))
  },
  exportProfile: async (id, sector) => {
    const s = manager.session(id)
    const p = s.profiles[s.slotOf(sector)]
    const r = await dialog.showSaveDialog(win!, {
      title: 'Export Profile',
      defaultPath: `${(p.name || 'profile').replace(/\//g, '-')}.hubless.json`,
      filters: [{ name: 'Hubless profile', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return null
    storage.exportProfile(r.filePath, s.dev.name, p.fmt, fromHex(p.raw), p.name)
    return r.filePath
  },
  importProfile: async (id, sector) => {
    const s = manager.session(id)
    const r = await dialog.showOpenDialog(win!, { title: 'Import Profile', filters: [{ name: 'Hubless profile', extensions: ['json'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const raw = storage.importProfile(r.filePaths[0], s.dev.onboard!.fmt, s.dev.onboard!.sectorSize)
    return manager.run(id, async (s2) => {
      await s2.replaceSector(sector, raw)
      return s2.state()
    })
  },
  keyboardState: (id) => manager.runKeyboard(id, async (s) => s.state),
  keyboardAction: (id, action) =>
    manager.runKeyboard(id, async (s) => {
      await s.act(action)
      return s.state
    }),
  keyboardAnalog: (id) => manager.runKeyboard(id, (s) => s.analog()),
  headsetState: (id) =>
    manager.runHeadset(id, async (s) => {
      await s.refresh() // live mute / boom / battery
      return s.state
    }),
  setHeadset: (id, patch) =>
    manager.runHeadset(id, async (s) => {
      await s.apply(patch)
      return s.state
    }),
  appSettings: async () => loadSettings(),
  setAppSettings: async (patch) => saveSettings(patch),
  forgetDevice: async (id) => {
    storage.clearDeviceImage(id)
    manager.forget(id)
  },
  appInfo: async () => ({ version: app.getVersion(), license: 'MIT' }),
  readDocument: async (name) => storage.readDocument(name),
  deleteAllData: async () => {
    manager.freeze()
    storage.deleteAllData()
    wipeUserData = true // Chromium's own folder goes once the window is closed (see window-all-closed)
    // Start over as a fresh install; the window is closed by quit() after this call returns.
    setTimeout(() => {
      app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--hidden') })
      quit()
    }, 100)
  },
  deviceImages: async () => storage.deviceImages(),
  chooseDeviceImage: async (id) => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Choose a Photo for This Device',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    return storage.setDeviceImage(id, r.filePaths[0])
  },
  clearDeviceImage: async (id) => storage.clearDeviceImage(id),
  grantAccess: async () => {
    const r = await storage.installUdevRule()
    if (r.ok) void manager.scan()
    return r
  }
}

ipcMain.handle('hubless:call', async (_e, method: keyof typeof api, args: unknown[]) => {
  const fn = api[method] as (...a: unknown[]) => Promise<unknown>
  if (!fn) throw new Error(`unknown method ${method}`)
  return fn(...args)
})

manager.on('buttons', (id: string, mask: number) => win?.webContents.send('hubless:buttons', id, mask))
manager.on('changed', (snap) => {
  win?.webContents.send('hubless:changed', snap)
  tray.update(snap)
})

if (!process.env.HUBLESS_SHOTS && !app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', showWindow)
// Any other quit path (session end, app.quit) must not be swallowed by hide-to-tray.
app.on('before-quit', () => (quitting = true))
handleSignals(quit)

app.whenReady().then(() => {
  createWindow()
  if (!demo && !process.env.HUBLESS_SHOTS) tray.ensure()
  manager.start()
  if (process.env.HUBLESS_SHOTS) void screenshots(process.env.HUBLESS_SHOTS)
  else watchForUpgrade(restart)
})

/** Dev aid: HUBLESS_SHOTS=dir renders the home screen and every device section into dir, then quits. */
async function screenshots(dir: string) {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(dir, { recursive: true })
  const w = win!
  w.setContentSize(1440, 900)
  if (w.webContents.isLoading()) await new Promise<void>((r) => w.webContents.once('did-finish-load', () => r()))
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const js = (code: string) => w.webContents.executeJavaScript(code)
  const shot = async (name: string) => writeFileSync(`${dir}/${name}.png`, (await w.webContents.capturePage()).toPNG())
  await wait(2500)
  await shot('0-home')
  for (const d of manager.snapshot().devices.filter((x) => x.capabilities.length && x.status !== 'inactive')) {
    await js(`window.__open(${JSON.stringify(d.id)})`)
    await wait(1800)
    for (const [i, page] of d.capabilities.entries()) {
      await js(`window.__nav && window.__nav(${JSON.stringify(page)})`)
      await wait(800)
      await shot(`${d.kind}-${i + 1}-${page}`)
    }
    await js('window.__open(null)')
    await wait(400)
  }
  manager.stop()
  app.exit(0)
}
app.on('window-all-closed', () => {
  manager.stop()
  if (wipeUserData) rmSync(app.getPath('userData'), { recursive: true, force: true })
  // node-hid keeps native read threads alive; exit explicitly once everything is saved.
  app.exit(0)
})
