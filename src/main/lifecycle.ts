import { join } from 'node:path'
import { statSync } from 'original-fs'
import { app } from 'electron'

/**
 * Quit cleanly on SIGTERM / SIGINT / SIGHUP (pkill, logout, systemd) instead of hiding to the tray.
 * `quit` must flush pending device writes and exit; a hard exit follows if it hangs.
 */
export function handleSignals(quit: () => void) {
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(sig, () => {
      quit()
      setTimeout(() => app.exit(0), 5000).unref()
    })
  }
}

/**
 * A package upgrade replaces the files under /opt/Hubless while the old copy keeps running in the tray.
 * Poll the installed app bundle; once it has changed and stopped changing, restart into the new version.
 */
export function watchForUpgrade(restart: () => void, everyMs = 5000) {
  if (!app.isPackaged) return
  const files = [join(process.resourcesPath, 'app.asar'), process.execPath]
  const sig = () =>
    files
      .map((f) => {
        try {
          const s = statSync(f)
          return `${s.ino}:${s.size}:${s.mtimeMs}`
        } catch {
          return 'missing'
        }
      })
      .join('|')
  const original = sig()
  let last = original
  const timer = setInterval(() => {
    const now = sig()
    // Restart only after two identical readings that differ from what we started with (install finished).
    if (now !== original && now === last && !now.includes('missing')) {
      clearInterval(timer)
      restart()
    }
    last = now
  }, everyMs)
  timer.unref()
}
