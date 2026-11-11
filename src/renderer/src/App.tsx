import { useCallback, useEffect, useState } from 'react'
import { Info, Settings2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import type { AppSnapshot, Capability } from '@shared/types'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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

  useEffect(() => {
    void window.hubless.snapshot().then(setSnap)
    void window.hubless.deviceImages().then(setImages)
    ;(window as unknown as Hooks).__open = setOpen
    return window.hubless.onChange(setSnap)
  }, [])

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
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                Menu
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={async () => {
                  const r = await window.hubless.grantAccess()
                  ;(r.ok ? toast.success : toast.error)(r.message)
                }}
              >
                <ShieldCheck className="size-4" /> Grant device access…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSettings(true)}>
                <Settings2 className="size-4" /> Settings…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAbout(true)}>
                <Info className="size-4" /> About Hubless
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Home snap={snap} images={images} onImages={setImages} onOpen={setOpen} />
      </main>
      <SettingsDialog open={settings} onOpenChange={setSettings} />
      <AboutDialog open={about} onOpenChange={setAbout} />
    </div>
  )
}
