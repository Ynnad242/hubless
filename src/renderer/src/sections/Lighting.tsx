import { useState } from 'react'
import type { DeviceSummary, LightEffect, LightSetting } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { MouseArt } from '@/components/DeviceArt'
import { Canvas, Caption, PanelTabs, SidePanel } from '@/components/kit'
import type { MouseCtl } from '@/hooks/useMouse'
import { cn } from '@/lib/utils'

const SWATCHES = ['#ffffff', '#2b8cff', '#00e5ff', '#34c77b', '#f5d524', '#f5a524', '#ff5a5f', '#ff5ca8', '#a78bfa']
const EFFECT_LABEL: Record<LightEffect, string> = { off: 'Off', static: 'Colour', breathing: 'Breathing', cycle: 'Colour cycle', other: 'Other effect' }
const DEFAULT_SPEED: Partial<Record<LightEffect, number>> = { breathing: 5000, cycle: 10000 }

/** Lighting zones of a mouse with RGB: effect, colour, brightness and speed for each. */
export function Lighting({ mouse, device, photo }: { mouse: MouseCtl; device: DeviceSummary; photo?: string }) {
  const { state, draft, update } = mouse
  const [zone, setZone] = useState(0)
  const zones = state?.lighting ?? []
  const lights = draft?.lighting ?? []
  if (!state || !draft || !zones.length || !lights.length) return null
  const z = Math.min(zone, zones.length - 1)
  const info = zones[z]
  const cur = lights[z]
  const set = (patch: Partial<LightSetting>, all = false) =>
    update((d) => {
      d.lighting = d.lighting!.map((l, i) =>
        i === z ? { ...l, ...patch } : all && zones[i]?.effects.includes(cur.effect) ? { ...cur, ...patch } : l
      )
    })
  // Each animated effect starts at its usual speed (a breath is quicker than a full colour cycle).
  const pick = (effect: LightEffect) => effect !== cur.effect && set({ effect, ...(DEFAULT_SPEED[effect] && { speedMs: DEFAULT_SPEED[effect] }) })
  const usesColor = cur.effect === 'static' || cur.effect === 'breathing'
  const isRazer = device.vendor === 'Razer'
  const multiProfile = state.profiles.length > 1 && !state.limits

  return (
    <>
      <SidePanel title="Lighting">
        {zones.length > 1 && <PanelTabs value={String(z)} onChange={(v) => setZone(Number(v))} items={zones.map((x, i) => [String(i), x.label])} />}
        <div className="space-y-3">
          <Caption>Effect</Caption>
          <div className="grid grid-cols-2 gap-2">
            {info.effects.map((e) => (
              <Button key={e} size="sm" variant={cur.effect === e ? 'default' : 'secondary'} onClick={() => pick(e)}>
                {EFFECT_LABEL[e]}
              </Button>
            ))}
          </div>
          {cur.effect === 'other' && (
            <p className="text-xs text-muted-foreground">
              {isRazer
                ? 'Razer mice can’t report which effect they’re showing, so Hubless doesn’t know yet. Pick one to set it.'
                : 'This zone runs an effect Hubless can’t edit (set by another app). It stays until you pick another effect.'}
            </p>
          )}
        </div>

        {usesColor && (
          <div className="space-y-3 border-t pt-4">
            <Caption>Colour</Caption>
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => set({ color: c })}
                  className={cn('size-7 rounded-full border-2', cur.color.toLowerCase() === c ? 'border-primary' : 'border-white/10')}
                  style={{ background: c }}
                />
              ))}
              <input
                type="color"
                value={cur.color}
                onChange={(e) => set({ color: e.target.value })}
                className="size-7 cursor-pointer overflow-hidden rounded-full border-2 border-white/10 bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
                aria-label="Custom colour"
              />
            </div>
          </div>
        )}

        {info.brightness.includes(cur.effect) && (
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-baseline justify-between">
              <Caption>Brightness</Caption>
              <span className="text-sm font-semibold tabular-nums">{cur.brightness}%</span>
            </div>
            <Slider min={isRazer ? 0 : 1} max={100} step={1} value={[cur.brightness]} onValueChange={([v]) => set({ brightness: v })} aria-label="Brightness" />
          </div>
        )}

        {info.speed.includes(cur.effect) && (
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-baseline justify-between">
              <Caption>Speed</Caption>
              <span className="text-sm font-semibold tabular-nums">{(cur.speedMs / 1000).toFixed(1)} s</span>
            </div>
            {/* Faster to the right: the slider runs over the negated period. */}
            <Slider min={-20000} max={-1000} step={500} value={[-cur.speedMs]} onValueChange={([v]) => set({ speedMs: -v })} aria-label="Speed" />
            <p className="text-xs text-muted-foreground">{cur.effect === 'breathing' ? 'One breath' : 'One full cycle'} every {(cur.speedMs / 1000).toFixed(1)} seconds.</p>
          </div>
        )}

        {zones.length > 1 && cur.effect !== 'other' && (
          <Button variant="secondary" size="sm" className="w-full" onClick={() => set({}, true)}>
            Use on all zones
          </Button>
        )}

        <p className="mt-auto text-xs text-muted-foreground">
          {multiProfile
            ? 'Saved on the mouse in the profile chosen at the top right; each profile keeps its own lighting.'
            : 'Saved on the mouse, so it stays when Hubless is closed.'}
        </p>
      </SidePanel>

      <Canvas className="flex-col gap-8">
        <div className="relative flex h-[360px] items-center justify-center">
          <Glow setting={cur} />
          {photo ? (
            <img src={photo} alt={`${device.vendor} ${device.name}`} draggable={false} className="relative max-h-full max-w-[420px] object-contain" />
          ) : (
            <MouseArt className="relative" />
          )}
        </div>
        {zones.length > 1 && (
          <div className="flex flex-wrap justify-center gap-2">
            {zones.map((x, i) => (
              <button
                key={x.label}
                type="button"
                onClick={() => setZone(i)}
                className={cn('flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm', i === z ? 'border-primary' : 'border-transparent bg-surface-2')}
              >
                <Dot setting={lights[i]} />
                {x.label}
                <span className="text-muted-foreground">{lights[i].effect === 'other' && isRazer ? 'Not set yet' : EFFECT_LABEL[lights[i].effect]}</span>
              </button>
            ))}
          </div>
        )}
      </Canvas>
    </>
  )
}

const RAINBOW = 'conic-gradient(#ff5a5f, #f5d524, #34c77b, #00e5ff, #2b8cff, #a78bfa, #ff5ca8, #ff5a5f)'

function Dot({ setting }: { setting: LightSetting }) {
  const bg = setting.effect === 'cycle' ? RAINBOW : setting.effect === 'off' || setting.effect === 'other' ? 'transparent' : setting.color
  return <span className="size-3 rounded-full border border-white/20" style={{ background: bg }} />
}

/** A soft light behind the photo that previews the effect. */
function Glow({ setting }: { setting: LightSetting }) {
  if (setting.effect === 'off' || setting.effect === 'other') return null
  const alpha = 0.25 + 0.45 * (setting.brightness / 100)
  const style =
    setting.effect === 'cycle'
      ? { background: RAINBOW, opacity: alpha, animation: `hubless-spin ${setting.speedMs || 10000}ms linear infinite` }
      : {
          background: `radial-gradient(circle, ${setting.color} 0%, transparent 70%)`,
          opacity: alpha,
          animation: setting.effect === 'breathing' ? `hubless-breathe ${setting.speedMs || 5000}ms ease-in-out infinite` : undefined
        }
  return <div aria-hidden className="pointer-events-none absolute size-[300px] rounded-full blur-3xl" style={style} />
}
