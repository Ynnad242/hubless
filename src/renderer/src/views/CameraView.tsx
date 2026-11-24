import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import type { CameraControl, CameraState, Capability, DeviceSummary } from '@shared/types'
import { Button } from '@/components/ui/button'
import { FirmwarePanel } from '@/components/FirmwarePanel'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { WebcamArt } from '@/components/DeviceArt'
import { Canvas, Caption, Row, SidePanel } from '@/components/kit'
import type { SaveStatus } from '@/hooks/useMouse'
import { type RailItem, SaveState, Shell } from './Shell'

const RAIL: RailItem[] = [{ key: 'camera', label: 'Camera', icon: Camera }]

// V4L2 names differ between kernels and cameras; the first one a camera has is used.
const AUTO_EXPOSURE = ['auto_exposure', 'exposure_auto']
const EXPOSURE = ['exposure_time_absolute', 'exposure_absolute']
const AUTO_WB = ['white_balance_automatic', 'white_balance_temperature_auto']
const AUTOFOCUS = ['focus_automatic_continuous', 'focus_auto']
const LABELS: Record<string, string> = {
  brightness: 'Brightness', contrast: 'Contrast', saturation: 'Saturation', sharpness: 'Sharpness', gain: 'Gain', hue: 'Hue', gamma: 'Gamma',
  backlight_compensation: 'Backlight compensation', exposure_dynamic_framerate: 'Low-light compensation', white_balance_temperature: 'Temperature',
  focus_absolute: 'Focus', zoom_absolute: 'Zoom', pan_absolute: 'Pan', tilt_absolute: 'Tilt', power_line_frequency: 'Anti-flicker',
  exposure_time_absolute: 'Exposure time', exposure_absolute: 'Exposure time', hue_automatic: 'Auto hue', privacy: 'Privacy shutter'
}
const label = (n: string) => LABELS[n] ?? n.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const HINTS: Record<string, string> = {
  exposure_dynamic_framerate: 'Lowers the frame rate in dim light for a brighter picture',
  backlight_compensation: 'Brightens you when there’s a window or lamp behind you',
  power_line_frequency: 'Match your mains power to stop flickering lights: 50 Hz in Europe and most of Asia, 60 Hz in the Americas'
}

/** A setting's value as a person reads it. */
function shown(c: CameraControl, v: number) {
  if (c.name === 'white_balance_temperature') return `${v} K`
  if (c.name === 'zoom_absolute') return `${(v / (c.min || 100)).toFixed(1)}×`
  if (c.name === 'pan_absolute' || c.name === 'tilt_absolute') return `${Math.round(v / 3600)}°`
  if (c.name.startsWith('exposure_') && c.type === 'int') return `${(v / 10).toFixed(1)} ms`
  if (c.max - c.min > 20 && c.min === 0) return `${Math.round((v / c.max) * 100)}%`
  return String(v)
}

export function CameraView({ device, photo, onBack }: { device: DeviceSummary; photo?: string; onBack: () => void }) {
  const [state, setState] = useState<CameraState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [section, setSection] = useState<Capability>('camera')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const pending = useRef<Record<string, number>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busy = useRef(false)

  useEffect(() => {
    const load = () => !timer.current && !busy.current && window.hubless.cameraState(device.id).then(setState, (e) => setError(e.message))
    void load()
    // Other apps change webcam settings too: stay current while the page is open.
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [device.id])

  // Sliders update the screen at once and reach the camera a moment later, a few values at a time.
  const set = useCallback(
    (values: Record<string, number>) => {
      setState((s) => s && { ...s, controls: s.controls.map((c) => (c.name in values ? { ...c, value: values[c.name] } : c)) })
      Object.assign(pending.current, values)
      setStatus('saving')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(async () => {
        const batch = pending.current
        pending.current = {}
        busy.current = true
        try {
          setState(await window.hubless.setCamera(device.id, batch))
          setStatus('saved')
        } catch (e) {
          setStatus('error')
          toast.error((e as Error).message)
        } finally {
          busy.current = false
          timer.current = null
        }
      }, 120)
    },
    [device.id]
  )

  const find = (names: string[]) => names.map((n) => state?.controls.find((c) => c.name === n)).find(Boolean)
  const ctl = (n: string) => state?.controls.find((c) => c.name === n)
  const used = new Set<string>()

  const slider = (c: CameraControl | undefined, extra?: { disabled?: boolean }) => {
    if (!c || c.type !== 'int' || c.max - c.min < 2) return null
    used.add(c.name)
    return (
      <div key={c.name} className="space-y-2.5">
        <div className="flex items-baseline justify-between">
          <span className={c.inactive || extra?.disabled ? 'text-sm text-muted-foreground' : 'text-sm'}>{label(c.name)}</span>
          <span className="text-sm font-semibold text-primary tabular-nums">{shown(c, c.value)}</span>
        </div>
        <Slider
          min={c.min}
          max={c.max}
          step={c.step || 1}
          value={[c.value]}
          disabled={c.inactive || extra?.disabled}
          onValueChange={([v]) => set({ [c.name]: v })}
          aria-label={label(c.name)}
        />
      </div>
    )
  }
  const toggle = (c: CameraControl | undefined, title?: string, hint?: string, invert = false) => {
    if (!c) return null
    used.add(c.name)
    const on = invert ? c.value === 0 : c.value !== 0
    return (
      <Row key={c.name} label={title ?? label(c.name)} hint={hint ?? HINTS[c.name]}>
        <Switch checked={on} onCheckedChange={(v) => set({ [c.name]: (invert ? !v : v) ? 1 : 0 })} />
      </Row>
    )
  }

  const body = (() => {
    if (!state) return null
    if (section === 'device')
      return (
        <>
          <SidePanel title="Device settings">
            <dl className="space-y-3 text-sm">
              {[
                ['Model', `${device.vendor} ${device.name}`],
                ['Connection', device.connection],
                ['Settings stored', 'On this PC (webcams forget them when unplugged)']
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="selectable text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <FirmwarePanel device={device} />
          </SidePanel>
          <Canvas>{photo ? <img src={photo} alt={`${device.vendor} ${device.name}`} draggable={false} className="h-72 w-auto object-contain" /> : <WebcamArt className="h-56" />}</Canvas>
        </>
      )
    if (state.needsTools) return <Canvas><p className="max-w-md text-center text-sm text-muted-foreground">Install v4l-utils (for example <code>sudo pacman -S v4l-utils</code>) and reopen Hubless to change this webcam’s settings.</p></Canvas>

    const ae = find(AUTO_EXPOSURE)
    // auto_exposure is a menu: 1 is manual, anything else (3 aperture priority, 0 auto) lets the camera decide.
    const aeOn = ae ? ae.value !== 1 : false
    const aeAuto = ae?.options?.find((o) => o.value !== 1)?.value ?? 3
    if (ae) used.add(ae.name)
    const exp = find(EXPOSURE)
    const wb = find(AUTO_WB)
    const af = find(AUTOFOCUS)
    const plf = ctl('power_line_frequency')
    if (plf) used.add(plf.name)

    const groups: [string, (ReactElement | null)[]][] = [
      [
        'Exposure',
        [
          ae ? (
            <Row key="ae" label="Auto exposure" hint="The camera adjusts to the light in the room">
              <Switch
                checked={aeOn}
                onCheckedChange={(v) => set(v ? { [ae.name]: aeAuto } : { [ae.name]: 1, ...(exp ? { [exp.name]: exp.value } : {}) })}
              />
            </Row>
          ) : null,
          slider(exp, { disabled: aeOn }),
          toggle(ctl('exposure_dynamic_framerate')),
          slider(ctl('gain'), { disabled: aeOn && !!ae }),
          ctl('backlight_compensation')?.max === 1 ? toggle(ctl('backlight_compensation')) : slider(ctl('backlight_compensation'))
        ]
      ],
      ['White balance', [toggle(wb, 'Auto white balance', 'Keeps colours natural as the light changes'), slider(ctl('white_balance_temperature'), { disabled: !!wb && wb.value !== 0 })]],
      ['Focus', [toggle(af, 'Autofocus'), slider(ctl('focus_absolute'), { disabled: !!af && af.value !== 0 })]],
      ['Picture', ['brightness', 'contrast', 'saturation', 'sharpness', 'hue', 'gamma'].map((n) => slider(ctl(n)))],
      ['Framing', ['zoom_absolute', 'pan_absolute', 'tilt_absolute'].map((n) => slider(ctl(n)))]
    ]
    // Anything else this camera offers, shown plainly.
    const more = state.controls.filter((c) => !used.has(c.name) && c.name !== 'power_line_frequency').map((c) => (c.type === 'int' ? slider(c) : c.type === 'bool' ? toggle(c) : null))

    return (
      <>
        <SidePanel
          title="Camera"
          action={
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void window.hubless.resetCamera(device.id).then(setState, (e) => toast.error(e.message))}>
              <RotateCcw className="size-3.5" /> Defaults
            </Button>
          }
        >
          <Row label="Keep my settings" hint="Puts them back when Discord, Zoom or OBS change them, and after the camera is unplugged">
            <Switch checked={state.keep} onCheckedChange={(v) => void window.hubless.setCameraKeep(device.id, v).then(setState, (e) => toast.error(e.message))} />
          </Row>
          {groups.map(([title, items]) =>
            items.some(Boolean) ? (
              <div key={title} className="space-y-4 border-t pt-4">
                <Caption>{title}</Caption>
                {items}
              </div>
            ) : null
          )}
          {plf?.options && (
            <div className="space-y-2 border-t pt-4">
              <Caption>Anti-flicker</Caption>
              <Select value={String(plf.value)} onValueChange={(v) => set({ [plf.name]: Number(v) })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {plf.options.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>
                      {o.label === 'Disabled' ? 'Off' : o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{HINTS.power_line_frequency}</p>
            </div>
          )}
          {more.some(Boolean) && (
            <div className="space-y-4 border-t pt-4">
              <Caption>More</Caption>
              {more}
            </div>
          )}
          <p className="mt-auto text-xs text-muted-foreground">Saved on this PC. Webcams forget their settings when unplugged, so Hubless puts them back.</p>
        </SidePanel>
        <Canvas className="flex-col gap-3 px-6">
          {device.demo ? (
            <div className="flex aspect-video w-full max-w-[880px] items-center justify-center rounded-xl border bg-black">
              <p className="max-w-sm px-6 text-center text-sm text-muted-foreground">The live preview shows here with a real webcam. This one is simulated.</p>
            </div>
          ) : (
            <Preview label={state.label} />
          )}
        </Canvas>
      </>
    )
  })()

  return (
    <Shell name={device.name} rail={RAIL} section={section} onSection={setSection} onBack={onBack} loading={!state && !error} right={<SaveState status={status} />}>
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

/** Live picture from the camera, so changes can be seen as they're made. Off while another app has the camera. */
function Preview({ label }: { label: string }) {
  const video = useRef<HTMLVideoElement>(null)
  const [on, setOn] = useState(true)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    if (!on) return
    let stream: MediaStream | null = null
    let stopped = false
    void (async () => {
      try {
        // Labels only appear once a camera has been opened, so open any first if the list has none.
        let cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
        if (cams.length && !cams.some((d) => d.label)) {
          const probe = await navigator.mediaDevices.getUserMedia({ video: true })
          probe.getTracks().forEach((t) => t.stop())
          cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
        }
        const cam = cams.find((d) => d.label.includes(label)) ?? cams.find((d) => label.includes(d.label.replace(/\s*\(.*\)$/, '')))
        if (!cam) throw new Error('not found')
        stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: cam.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } })
        if (stopped) return stream.getTracks().forEach((t) => t.stop())
        if (video.current) video.current.srcObject = stream
        setProblem(null)
      } catch (e) {
        const name = (e as DOMException).name
        setProblem(name === 'NotReadableError' || name === 'AbortError' ? 'Another app is using the camera, so there’s no preview. Settings still work.' : 'No preview for this camera. Settings still work.')
      }
    })()
    return () => {
      stopped = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [on, label])
  return (
    <>
      <div className="relative flex aspect-video w-full max-w-[880px] items-center justify-center overflow-hidden rounded-xl border bg-black">
        {on && !problem ? (
          <video ref={video} autoPlay muted playsInline className="h-full w-full object-contain" />
        ) : (
          <p className="max-w-sm px-6 text-center text-sm text-muted-foreground">{problem ?? 'Preview is off.'}</p>
        )}
      </div>
      <Button variant="secondary" size="sm" onClick={() => setOn((v) => !v)}>
        {on ? <CameraOff className="size-4" /> : <Camera className="size-4" />} {on ? 'Turn preview off' : 'Turn preview on'}
      </Button>
    </>
  )
}
