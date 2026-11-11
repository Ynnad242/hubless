import { useCallback, useEffect, useState } from 'react'
import { Download, Settings } from 'lucide-react'
import type { AppSnapshot, Capability, UpdateStatus } from '@shared/types'
import { Button } from '@/components/ui/button'
import { AboutDialog, SettingsDialog } from '@/components/SettingsDialog'
import type { MouseCtl } from '@/hooks/useMouse'
import { DeviceView } from '@/views/DeviceView'
import { HeadsetView } from '@/views/HeadsetView'
import { KeyboardView } from '@/views/KeyboardView'
import { Home } from '@/views/Home'
import { photoFor } from '@shared/devices'

type Hooks = { __nav?: (c: Capability) => void; __flush?: () => Promise<void>; __open?: (id: string | null) => void }

function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <rect width="24" height="24" rx="6" fill="#2b8cff" />
      <path d="M12 5.5a4.5 4.5 0 0 0-4.5 4.5v4a4.5 4.5 0 0 0 9 0v-4A4.5 4.5 0 0 0 12 5.5Z" fill="none" stroke="#fff" strokeWidth="1.6" />
      <path d="M12 6v4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export default function App() {
  const [snap, setSnap] = useState<AppSnapshot | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [images, setImages] = useState<Record<string, string>>({})
  const [about, setAbout] = useState(false)
  const [settings, setSettings] = useState(false)
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle', checkedAt: null })
  useEffect(() => {
    void window.hubless.updateStatus().then(setUpdate)
    return window.hubless.onUpdate(setUpdate)
  }, [])

  useEffect(() => {
    void window.hubless.snapshot().then(setSnap)
    ;(window as unknown as Hooks).__open = setOpen
    return window.hubless.onChange(setSnap)
  }, [])

  // Fetch photos only for the devices on screen, and again only when that list changes (not on every status update).
  const devicesKey = snap?.devices.map((d) => `${d.id}|${d.vendor}|${d.name}`).join('\n') ?? ''
  useEffect(() => {
    if (!snap) return
    void window.hubless.deviceImages(snap.devices.map(({ id, vendor, name }) => ({ id, vendor, name }))).then(setImages)
  }, [devicesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const device = snap?.devices.find((d) => d.id === open && d.capabilities.length) ?? null
  // Leave the device page if the device disappears (unplugged, forgotten).
  useEffect(() => {
    if (open && snap && !device) setOpen(null)
  }, [open, snap, device])

  const expose = useCallback((m: MouseCtl, nav: (c: Capability) => void) => {
    const w = window as unknown as Hooks
    w.__nav = nav
    w.__flush = m.flush
  }, [])

  if (device?.kind === 'keyboard') return <KeyboardView key={device.id} device={device} photo={photoFor(images, device)} onBack={() => setOpen(null)} />
  if (device?.kind === 'headset') return <HeadsetView key={device.id} device={device} photo={photoFor(images, device)} onBack={() => setOpen(null)} />
  if (device) return <DeviceView key={device.id} device={device} photo={photoFor(images, device)} onBack={() => setOpen(null)} expose={expose} />

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 px-8">
        <Logo />
        <span className="text-lg font-bold tracking-tight">Hubless</span>
        <Button variant="ghost" size="icon" className="ml-auto size-9 text-muted-foreground hover:text-foreground" aria-label="Settings" title="Settings" onClick={() => setSettings(true)}>
          <Settings className="size-5" />
        </Button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        {update.state === 'ready' && (
          <div className="mx-auto mt-2 flex w-full max-w-6xl items-center gap-4 px-8">
            <div className="flex flex-1 items-center gap-4 rounded-xl border border-success/30 bg-success/8 px-5 py-3.5">
              <Download className="size-5 shrink-0 text-success" />
              <div className="flex-1 text-sm">
                <span className="font-semibold">Hubless {update.version} is ready.</span>{' '}
                <span className="text-muted-foreground">Restart to finish updating. Your settings and devices stay as they are.</span>
              </div>
              <Button size="sm" onClick={() => void window.hubless.installUpdate()}>
                Restart to update
              </Button>
            </div>
          </div>
        )}
        <Home snap={snap} images={images} onImages={setImages} onOpen={setOpen} />
      </main>
      <SettingsDialog open={settings} onOpenChange={setSettings} update={update} onAbout={() => setAbout(true)} />
      <AboutDialog open={about} onOpenChange={setAbout} />
    </div>
  )
}
