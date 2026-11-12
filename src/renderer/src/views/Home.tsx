import { useState } from 'react'
import {
  BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, ClipboardCopy, ImagePlus, Lock, MoreHorizontal, Moon, Radio, Settings2, Trash2, Usb
} from 'lucide-react'
import { toast } from 'sonner'
import type { AppSnapshot, DeviceSummary } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { DeviceArt } from '@/components/DeviceArt'
import { copyDeviceReport } from '@/lib/report'
import { cn } from '@/lib/utils'
import { photoFor } from '@shared/devices'

interface Props {
  snap: AppSnapshot | null
  images: Record<string, string>
  onImages: (i: Record<string, string>) => void
  onOpen: (id: string) => void
}

function BatteryIcon({ percent, charging }: { percent: number; charging: boolean }) {
  const I = charging ? BatteryCharging : percent > 70 ? BatteryFull : percent > 25 ? BatteryMedium : BatteryLow
  return <I className={cn('size-4', percent <= 15 && !charging && 'text-destructive')} />
}

/** "Last used 3 days ago" for devices that aren't plugged in. */
function lastUsed(ms: number) {
  if (!ms) return 'Not connected'
  const min = Math.max(0, (Date.now() - ms) / 60000)
  const ago =
    min < 2 ? 'just now' : min < 60 ? `${Math.round(min)} minutes ago` : min < 60 * 24 ? `${Math.round(min / 60)} hour${min < 90 ? '' : 's'} ago`
    : min < 60 * 24 * 2 ? 'yesterday' : min < 60 * 24 * 60 ? `${Math.round(min / 1440)} days ago` : `${Math.round(min / 43200)} months ago`
  return `Last used ${ago}`
}

const STATUS_TEXT: Record<DeviceSummary['status'], string> = {
  ready: '',
  asleep: 'Asleep · move it to wake',
  unsupported: 'Support coming soon',
  inactive: 'Inactive'
}

function DeviceCard({ d, image, ownImage, onOpen, onImage, onClearImage, onForget }: {
  d: DeviceSummary
  image?: string
  ownImage: boolean
  onOpen: () => void
  onImage: () => void
  onClearImage: () => void
  onForget: () => void
}) {
  const openable = d.status === 'ready' || (d.status === 'asleep' && d.capabilities.length > 0)
  const dim = d.status === 'inactive' || d.status === 'unsupported'
  return (
    <div
      role={openable ? 'button' : undefined}
      tabIndex={openable ? 0 : -1}
      onClick={openable ? onOpen : undefined}
      onKeyDown={(e) => openable && e.key === 'Enter' && onOpen()}
      className={cn(
        'group relative flex h-[340px] flex-col justify-between rounded-xl border bg-surface p-5 transition-colors',
        openable && 'hover:border-foreground/20',
        d.kind === 'keyboard' && 'sm:col-span-2'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="caption">{d.vendor}</div>
          <h3 className={cn('truncate text-lg font-bold', dim && 'text-muted-foreground')}>{d.name}</h3>
          <div className="mt-1 flex h-5 items-center gap-2 text-sm text-muted-foreground">
            {d.battery && (
              <>
                <span className="font-medium tabular-nums">{d.battery.percent}%</span>
                <BatteryIcon percent={d.battery.percent} charging={d.battery.charging} />
              </>
            )}
            {d.status === 'ready' && (d.connection.includes('USB') ? <><Usb className="size-3.5" /> Wired</> : <><Radio className="size-3.5" /> Wireless</>)}
            {d.status === 'asleep' && <Moon className="size-3.5" />}
            {d.status === 'inactive' ? (
              <span>{lastUsed(d.lastSeen)}</span>
            ) : (
              (d.note ?? STATUS_TEXT[d.status]) && <span>{d.note ?? STATUS_TEXT[d.status]}</span>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-8 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              aria-label="Device options"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={onImage}>
              <ImagePlus className="size-4" /> Use your own photo…
            </DropdownMenuItem>
            {ownImage && <DropdownMenuItem onSelect={onClearImage}>Use the default picture</DropdownMenuItem>}
            {d.status !== 'inactive' && (
              <DropdownMenuItem onSelect={() => copyDeviceReport(d.id)}>
                <ClipboardCopy className="size-4" /> Copy device report
              </DropdownMenuItem>
            )}
            {d.status === 'inactive' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onForget}>
                  <Trash2 className="size-4" /> Forget device
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className={cn('flex h-48 items-center justify-center py-2 transition', dim && 'opacity-40 grayscale', d.status === 'asleep' && 'opacity-70')}>
        {image ? (
          <img src={image} alt={`${d.vendor} ${d.name}`} className="max-h-full max-w-full object-contain" draggable={false} />
        ) : (
          <DeviceArt kind={d.kind} className={d.kind === 'keyboard' ? 'h-auto max-h-full w-full max-w-[560px]' : 'h-full w-auto'} />
        )}
      </div>

      <div className="flex h-8 items-center justify-end">
        {openable && (
          <Button size="icon" variant="secondary" className="size-8" aria-label={`Configure ${d.name}`} onClick={onOpen}>
            <Settings2 className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

export function Home({ snap, images, onImages, onOpen }: Props) {
  const [busy, setBusy] = useState(false)
  const api = window.hubless
  const all = snap?.devices ?? []
  const perm = snap?.missingPermission ?? []
  // Connected = plugged in right now (incl. asleep wireless and recognised-but-unsupported); the rest were seen before.
  const connected = all.filter((d) => d.status !== 'inactive')
  const remembered = all.filter((d) => d.status === 'inactive').sort((a, b) => b.lastSeen - a.lastSeen)
  const [tab, setTab] = useState<'connected' | 'remembered'>('connected')
  const devices = tab === 'connected' ? connected : remembered

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-8">
      {perm.length > 0 && (
        <div className="mb-6 flex items-center gap-4 rounded-xl border border-primary/30 bg-primary/8 px-5 py-4">
          <Lock className="size-5 shrink-0 text-primary" />
          <div className="flex-1 text-sm">
            <div className="font-semibold">Allow Hubless to talk to your {perm.join(', ')} devices</div>
            <div className="text-muted-foreground">Linux locks these by default. You only need to do this once.</div>
          </div>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const r = await api.grantAccess()
              setBusy(false)
              ;(r.ok ? toast.success : toast.error)(r.message)
            }}
          >
            Allow access
          </Button>
        </div>
      )}

      <div role="tablist" aria-label="Devices" className="mb-6 inline-flex rounded-lg bg-surface p-1">
        {(
          [
            ['connected', 'Connected', connected.length],
            ['remembered', 'Not connected', remembered.length]
          ] as const
        ).map(([k, label, n]) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              'flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors',
              tab === k ? 'bg-surface-2 text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
            <span className={cn('rounded-full px-1.5 text-xs tabular-nums', tab === k ? 'bg-primary-solid text-white' : 'bg-surface-2')}>{n}</span>
          </button>
        ))}
      </div>

      {devices.length === 0 ? (
        tab === 'connected' ? (
          <div className="flex h-[55vh] flex-col items-center justify-center gap-3 text-center">
            <div className="h-40 opacity-60">
              <DeviceArt kind="mouse" className="h-full" />
            </div>
            <h2 className="text-xl font-bold">{snap?.searching ? 'Looking for your devices…' : 'Nothing plugged in'}</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Plug in a receiver or cable and switch your device on. It appears here automatically.
              {remembered.length > 0 && ` Devices you used before are under Not connected.`}
            </p>
          </div>
        ) : (
          <div className="flex h-[55vh] flex-col items-center justify-center gap-3 text-center">
            <h2 className="text-xl font-bold">Everything you own is plugged in</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              When you unplug a device it moves here, so it's easy to find when you switch back. Its settings stay on the device.
            </p>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {devices.map((d) => (
            <DeviceCard
              key={d.id}
              d={d}
              image={photoFor(images, d)}
              ownImage={!!images[d.id]}
              onOpen={() => onOpen(d.id)}
              onImage={async () => {
                const url = await api.chooseDeviceImage(d.id).catch((e) => (toast.error(e.message), null))
                if (url) onImages({ ...images, [d.id]: url })
              }}
              onClearImage={async () => {
                await api.clearDeviceImage(d.id)
                const next = { ...images }
                delete next[d.id]
                // Fall back to the photo shipped for this model, if there is one.
                onImages({ ...next, ...(await api.deviceImages([{ id: d.id, vendor: d.vendor, name: d.name }])) })
              }}
              onForget={() => void api.forgetDevice(d.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
