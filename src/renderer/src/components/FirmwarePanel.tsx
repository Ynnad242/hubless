import { useCallback, useEffect, useState } from 'react'
import { CircleCheck, Download, ExternalLink, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { DeviceSummary, FirmwareComponent, FirmwareInfo } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Caption } from '@/components/kit'

const api = () => window.hubless
const kb = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/**
 * Firmware updates, only where the maker allows them on Linux: fwupd (installed here), Wootility (Hubless hands the
 * keyboard over), or a note naming the maker's own app.
 */
export function FirmwarePanel({ device }: { device: DeviceSummary }) {
  const [info, setInfo] = useState<FirmwareInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [confirm, setConfirm] = useState<FirmwareComponent | null>(null)
  const [installing, setInstalling] = useState<{ name: string; pct: number } | null>(null)

  const load = useCallback(
    async (refresh = false) => {
      setChecking(true)
      try {
        setInfo(await api().firmwareStatus(device.id, refresh))
      } catch {
        /* device just went away; the panel stays as it was */
      } finally {
        setChecking(false)
      }
    },
    [device.id]
  )
  useEffect(() => void load(), [load])
  useEffect(() => api().onFirmwareProgress((id, pct) => id === device.id && setInstalling((s) => (s ? { ...s, pct } : s))), [device.id])

  const install = async (c: FirmwareComponent) => {
    setConfirm(null)
    setInstalling({ name: c.name, pct: 0 })
    try {
      setInfo(await api().installFirmware(device.id, c.fwupdId))
      toast.success(`Firmware updated to ${c.update!.version}`)
    } catch (e) {
      toast.error(String((e as Error).message ?? e))
      void load()
    } finally {
      setInstalling(null)
    }
  }

  const wootility = async () => {
    try {
      const how = await api().openWootility(device.id)
      setInfo((i) => (i ? { ...i, held: true } : i))
      toast.success(how === 'app' ? 'Wootility opened' : 'Wootility opened in your browser')
    } catch (e) {
      toast.error(String((e as Error).message ?? e))
    }
  }

  if (!info) return null
  const fwupd = info.route === 'fwupd'
  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between">
        <Caption>Firmware</Caption>
        {fwupd && !installing && (
          <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => void load(true)} disabled={checking}>
            <RefreshCw className={checking ? 'size-3 animate-spin' : 'size-3'} /> Check
          </button>
        )}
      </div>

      {installing && (
        <div className="space-y-2 rounded-lg bg-surface-2 p-3">
          <p className="text-sm font-medium">Updating {installing.name}… {installing.pct}%</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${installing.pct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">Keep it plugged in and don’t close Hubless.</p>
        </div>
      )}

      {fwupd &&
        !installing &&
        info.components.map((c) => (
          <div key={c.fwupdId} className="space-y-2 rounded-lg bg-surface-2 p-3">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium">{c.name}</span>
              <span className="selectable shrink-0 text-muted-foreground">{c.version}</span>
            </div>
            {c.update ? (
              <>
                <p className="text-xs">
                  Version <b>{c.update.version}</b> is available{c.update.sizeBytes ? ` (${kb(c.update.sizeBytes)})` : ''}.
                </p>
                {c.update.notes && <p className="max-h-24 overflow-y-auto text-xs whitespace-pre-line text-muted-foreground">{c.update.notes}</p>}
                <Button size="sm" className="w-full" onClick={() => setConfirm(c)}>
                  <Download className="size-4" /> Update firmware
                </Button>
              </>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-success">
                <CircleCheck className="size-3.5" /> Up to date
              </p>
            )}
          </div>
        ))}

      {info.route === 'wootility' &&
        (info.held ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Hubless has let go of the keyboard so Wootility can update it. When Wootility is done, take it back here.</p>
            <Button size="sm" className="w-full" data-keep onClick={() => void api().reconnectDevice(device.id).then(() => load())}>
              Reconnect keyboard
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Wooting firmware is installed with Wootility, Wooting’s own app. Hubless lets go of the keyboard while it runs.
            </p>
            <Button variant="secondary" size="sm" className="w-full justify-start" onClick={() => void wootility()}>
              <ExternalLink className="size-4" /> Update with Wootility
            </Button>
          </div>
        ))}

      {info.route === 'vendor-app' && (
        <p className="text-xs text-muted-foreground">
          {device.vendor} only releases firmware for this device through {info.vendorApp}, which doesn’t run on Linux, so Hubless can’t update it.
          {!info.fwupdInstalled && ' Installing fwupd lets Hubless update devices whose makers publish firmware for Linux.'}
        </p>
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update {confirm?.name} to {confirm?.update?.version}?</DialogTitle>
            <DialogDescription>
              The firmware comes from {device.vendor} through the Linux Vendor Firmware Service and is checked before it’s installed.
              {device.kind === 'mouse' && ' Hubless backs up the mouse’s settings first.'} It usually takes a minute or two: keep the device plugged in
              and don’t close Hubless. The device stops working until it’s done.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Not now
            </Button>
            <Button onClick={() => confirm && void install(confirm)}>Update</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
