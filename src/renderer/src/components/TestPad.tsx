import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Ripple {
  id: number
  x: number
  y: number
}

/** Click here to feel the settings: clicks per second, best burst and hold time per button. */
export function TestPad() {
  const [ripples, setRipples] = useState<Ripple[]>([])
  const [, force] = useState(0)
  const clicks = useRef<[number[], number[]]>([[], []])
  const best = useRef([0, 0])
  const hold = useRef<[number | null, number | null]>([null, null])
  const down = useRef<[number | null, number | null]>([null, null])
  const seq = useRef(0)

  useEffect(() => {
    const t = setInterval(() => {
      const now = performance.now()
      clicks.current = clicks.current.map((c) => c.filter((x) => now - x < 1000)) as [number[], number[]]
      force((n) => n + 1)
    }, 100)
    return () => clearInterval(t)
  }, [])

  const side = (b: number) => (b === 0 ? 0 : b === 2 ? 1 : null)

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={(e) => {
        const s = side(e.button)
        if (s === null) return
        const now = performance.now()
        clicks.current[s].push(now)
        down.current[s] = now
        best.current[s] = Math.max(best.current[s], clicks.current[s].filter((x) => now - x < 1000).length)
        const r = e.currentTarget.getBoundingClientRect()
        const id = ++seq.current
        setRipples((rs) => [...rs, { id, x: e.clientX - r.left, y: e.clientY - r.top }])
        setTimeout(() => setRipples((rs) => rs.filter((x) => x.id !== id)), 600)
      }}
      onMouseUp={(e) => {
        const s = side(e.button)
        if (s !== null && down.current[s] !== null) {
          hold.current[s] = performance.now() - down.current[s]!
          down.current[s] = null
        }
      }}
      className="relative grid h-28 w-full max-w-md grid-cols-2 overflow-hidden rounded-xl border bg-surface"
    >
      {ripples.map((r) => (
        <span
          key={r.id}
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 animate-[ripple_600ms_ease-out_forwards] rounded-full border-2 border-primary"
          style={{ left: r.x, top: r.y }}
        />
      ))}
      {(['Left', 'Right'] as const).map((title, s) => {
        const cps = clicks.current[s].length
        const h = hold.current[s]
        return (
          <div key={title} className="pointer-events-none flex flex-col items-center justify-center first:border-r">
            <span className="caption">{title}</span>
            <span className={cps ? 'text-3xl font-bold text-primary tabular-nums' : 'text-3xl font-bold text-foreground/25 tabular-nums'}>{cps}</span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              clicks/s · best {best.current[s]}
              {h !== null && ` · ${Math.round(h)} ms`}
            </span>
          </div>
        )
      })}
      <Button
        size="icon"
        variant="ghost"
        className="absolute top-1 right-1 size-7 text-muted-foreground"
        aria-label="Reset counters"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => {
          best.current = [0, 0]
          hold.current = [null, null]
          force((n) => n + 1)
        }}
      >
        <RotateCcw className="size-3.5" />
      </Button>
    </div>
  )
}
