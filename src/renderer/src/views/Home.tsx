import { useState } from 'react'
import {
  BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, ImagePlus, Lock, MoreHorizontal, Moon, Radio, Settings2, Trash2, Usb
} from 'lucide-react'
import { toast } from 'sonner'
import type { AppSnapshot, DeviceSummary } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { DeviceArt } from '@/components/DeviceArt'
import { cn } from '@/lib/utils'

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

const STATUS_TEXT: Record<DeviceSummary['status'], string> = {
  ready: '',
  asleep: 'Asleep · move it to wake',
  unsupported: 'Support coming soon',
  inactive: 'Inactive'
}

function DeviceCard({ d, image, onOpen, onImage, onClearImage, onForget }: {
  d: DeviceSummary
  image?: string
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
            {(d.note ?? STATUS_TEXT[d.status]) && <span>{d.note ?? STATUS_TEXT[d.status]}</span>}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-8 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
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
            {image && <DropdownMenuItem onSelect={onClearImage}>Use the default picture</DropdownMenuItem>}
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
          <img src={image} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
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
  const devices = snap?.devices ?? []
  const perm = snap?.missingPermission ?? []

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

      {devices.length === 0 ? (
        <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center">
          <div className="h-40 opacity-60">
            <DeviceArt kind="mouse" className="h-full" />
          </div>
          <h2 className="text-xl font-bold">{snap?.searching ? 'Looking for your devices…' : 'No devices yet'}</h2>
          <p className="max-w-sm text-sm text-muted-foreground">Plug in a receiver or cable and switch your mouse on. Devices appear here automatically.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {devices.map((d) => (
            <DeviceCard
              key={d.id}
              d={d}
              image={images[d.id]}
              onOpen={() => onOpen(d.id)}
              onImage={async () => {
                const url = await api.chooseDeviceImage(d.id).catch((e) => (toast.error(e.message), null))
                if (url) onImages({ ...images, [d.id]: url })
              }}
              onClearImage={async () => {
                await api.clearDeviceImage(d.id)
                const next = { ...images }
                delete next[d.id]
                onImages(next)
              }}
              onForget={() => void api.forgetDevice(d.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
