import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import type { Capability, DeviceSetting, DeviceSummary, PeripheralState, SettingValue } from '@shared/types'
import { Button } from '@/components/ui/button'
import { FirmwarePanel } from '@/components/FirmwarePanel'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { DeviceArt } from '@/components/DeviceArt'
import { Canvas, Caption, Row, SidePanel } from '@/components/kit'
import type { SaveStatus } from '@/hooks/useMouse'
import { type RailItem, SaveState, Shell } from './Shell'

const RAIL: RailItem[] = [{ key: 'settings', label: 'Settings', icon: SlidersHorizontal }]
const SWATCHES = ['#ffffff', '#2b8cff', '#00e5ff', '#34c77b', '#ffd60a', '#ff9f0a', '#ff453a', '#ff2d92', '#bf5af2']
const hz = (f: number) => (f >= 1000 ? `${+(f / 1000).toFixed(1)}k` : String(f))

/**
 * Settings page for headsets and keyboards whose driver lists its own settings (Logitech G headsets and keyboards,
 * and more to come): sliders, switches, choices and an equalizer, grouped as the driver says.
 */
export function PeripheralView({ device, photo, onBack }: { device: DeviceSummary; photo?: string; onBack: () => void }) {
  const [state, setState] = useState<PeripheralState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [section, setSection] = useState<Capability>('settings')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const load = () => !timers.current.size && window.hubless.peripheralState(device.id).then(setState, (e) => setError(e.message))
    void load()
    const t = setInterval(load, 5000) // battery
    return () => clearInterval(t)
  }, [device.id, device.status])

  // The screen follows at once; the device a moment later, so dragging a slider sends a handful of writes.
  const set = useCallback(
    (key: string, value: SettingValue) => {
      setState((s) => s && { ...s, settings: s.settings.map((x) => (x.key !== key ? x : Array.isArray(value) ? { ...x, bands: x.bands!.map((b, i) => ({ ...b, gain: value[i] })) } : { ...x, value })) })
      setStatus('saving')
      clearTimeout(timers.current.get(key))
      timers.current.set(
        key,
        setTimeout(async () => {
          try {
            setState(await window.hubless.setPeripheral(device.id, key, value))
            setStatus('saved')
          } catch (e) {
            setStatus('error')
            toast.error((e as Error).message)
            void window.hubless.peripheralState(device.id).then(setState, () => {})
          } finally {
            timers.current.delete(key)
          }
        }, 150)
      )
    },
    [device.id]
  )

  const control = (s: DeviceSetting) => {
    if (s.kind === 'switch')
      return (
        <Row key={s.key} label={s.label} hint={s.hint}>
          <Switch checked={s.value !== 0} onCheckedChange={(v) => set(s.key, v ? 1 : 0)} />
        </Row>
      )
    if (s.kind === 'choice')
      return (
        <div key={s.key} className="space-y-2">
          <div className="text-sm">{s.label}</div>
          <Select value={s.options!.some((o) => o.value === s.value) ? String(s.value) : ''} onValueChange={(v) => set(s.key, Number(v))}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pick one" />
            </SelectTrigger>
            <SelectContent>
              {s.options!.map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {s.hint && <p className="text-xs text-muted-foreground">{s.hint}</p>}
        </div>
      )
    if (s.kind === 'color') {
      const hex = `#${s.value.toString(16).padStart(6, '0')}`
      return (
        <div key={s.key} className="space-y-2.5">
          <div className="text-sm">{s.label}</div>
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => set(s.key, parseInt(c.slice(1), 16))}
                className={hex.toLowerCase() === c ? 'size-7 rounded-full ring-2 ring-primary ring-offset-2 ring-offset-surface' : 'size-7 rounded-full'}
                style={{ background: c }}
              />
            ))}
            <label className="relative size-7 cursor-pointer overflow-hidden rounded-full border border-dashed" title="Any colour">
              <input type="color" value={hex} onChange={(e) => set(s.key, parseInt(e.target.value.slice(1), 16))} className="absolute inset-0 size-full cursor-pointer opacity-0" />
              <span className="flex size-full items-center justify-center text-xs text-muted-foreground">+</span>
            </label>
          </div>
        </div>
      )
    }
    if (s.kind === 'slider')
      return (
        <div key={s.key} className="space-y-2.5">
          <div className="flex items-baseline justify-between">
            <span className="text-sm">{s.label}</span>
            <span className="text-sm font-semibold text-primary tabular-nums">{s.value === s.min && s.zeroLabel ? s.zeroLabel : `${s.value}${s.unit ?? ''}`}</span>
          </div>
          <Slider min={s.min} max={s.max} step={s.step ?? 1} value={[s.value]} onValueChange={([v]) => set(s.key, v)} aria-label={s.label} />
          {s.hint && <p className="text-xs text-muted-foreground">{s.hint}</p>}
        </div>
      )
    return null
  }

  const picture = photo ? (
    <img src={photo} alt={`${device.vendor} ${device.name}`} draggable={false} className="max-h-72 w-auto max-w-full object-contain" />
  ) : (
    <DeviceArt kind={device.kind} className="h-56" />
  )

  const body = (() => {
    if (!state) return null
    if (section === 'device')
      return (
        <>
          <SidePanel title="Device settings">
            <dl className="space-y-3 text-sm">
              {[
                ['Model', `${device.vendor} ${device.name}`],
                ['Connection', device.connection]
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="selectable text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <FirmwarePanel device={device} />
          </SidePanel>
          <Canvas>{picture}</Canvas>
        </>
      )
    const eq = state.settings.find((s) => s.kind === 'eq')
    const groups = [...new Set(state.settings.filter((s) => s.kind !== 'eq').map((s) => s.group))]
    return (
      <>
        <SidePanel title="Settings">
          {!groups.length && <p className="text-sm text-muted-foreground">This device has no settings Hubless can change yet.</p>}
          {groups.map((g, i) => (
            <div key={g} className={i ? 'space-y-4 border-t pt-4' : 'space-y-4'}>
              <Caption>{g}</Caption>
              {state.settings.filter((s) => s.group === g && s.kind !== 'eq').map(control)}
            </div>
          ))}
          {state.note && <p className="mt-auto text-xs text-muted-foreground">{state.note}</p>}
          {!state.note && <p className="mt-auto text-xs text-muted-foreground">Saved in the device, so it keeps working without Hubless.</p>}
        </SidePanel>
        <Canvas className="flex-col gap-8 px-6">
          {picture}
          {eq?.bands && (
            <div className="w-full max-w-[720px] space-y-3 rounded-xl border bg-surface p-5">
              <div className="flex items-center justify-between">
                <Caption>Equalizer · {eq.min} to +{eq.max} dB</Caption>
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => set(eq.key, eq.bands!.map(() => 0))}>
                  <RotateCcw className="size-3.5" /> Flat
                </Button>
              </div>
              <div className="flex h-48 items-stretch justify-around gap-2">
                {eq.bands.map((b, i) => (
                  <div key={i} className="flex flex-col items-center gap-2">
                    <span className="text-xs font-semibold text-primary tabular-nums">{b.gain > 0 ? `+${b.gain}` : b.gain}</span>
                    <Slider
                      orientation="vertical"
                      min={eq.min}
                      max={eq.max}
                      step={eq.step ?? 1}
                      value={[b.gain]}
                      onValueChange={([v]) => set(eq.key, eq.bands!.map((x, j) => (j === i ? v : x.gain)))}
                      aria-label={`${hz(b.freq)} Hz`}
                      className="min-h-0 flex-1"
                    />
                    <span className="text-xs text-muted-foreground tabular-nums">{hz(b.freq)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Canvas>
      </>
    )
  })()

  return (
    <Shell
      name={device.name}
      rail={RAIL}
      section={section}
      onSection={setSection}
      onBack={onBack}
      loading={!state && !error}
      asleep={device.status === 'asleep' ? `The ${device.kind} is switched off or asleep. Turn it on to change its settings.` : null}
      right={
        <>
          <SaveState status={status} />
          {state?.battery != null && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {state.battery}% battery{state.charging ? ', charging' : ''}
            </span>
          )}
        </>
      }
    >
      {error && !state ? (
        <Canvas>
          <p className="max-w-md text-center text-sm text-muted-foreground">{error}</p>
        </Canvas>
      ) : (
        body
      )}
    </Shell>
  )
}
