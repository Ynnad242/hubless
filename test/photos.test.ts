// Shipped device photos (data/devices): every file is a transparent PNG named after a real model, and every
// popular mouse has one, so a supported device shows its photo the moment it's plugged in.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { modelKey, photoFor, photoKey } from '../src/shared/devices'

const dir = new URL('../data/devices/', import.meta.url)
const files = readdirSync(dir)
const catalog: { vendor: string; name: string; popular?: boolean }[] = JSON.parse(readFileSync(new URL('../data/mice.json', import.meta.url), 'utf8')).models
// Devices Hubless supports that aren't mice, so aren't in the mouse catalog.
const others = [modelKey('Wooting', '60HE'), modelKey('Fractal Design', 'Scape')]
const known = new Set([...catalog.map((m) => modelKey(m.vendor, m.name)), ...others])

describe('shipped device photos', () => {
  it.each(files)('%s is a transparent, sharp PNG for a known model', (f) => {
    expect(f).toMatch(/^[a-z0-9-]+\.png$/)
    expect(known).toContain(f.slice(0, -4))
    const png = readFileSync(new URL(f, dir))
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    expect(png[25]).toBe(6) // colour type 6: RGB with alpha
    expect(Math.max(width, height)).toBeGreaterThanOrEqual(370) // at least 2x the 176 px home card
    expect(Math.max(width, height)).toBeLessThanOrEqual(1600)
  })

  it('covers every popular mouse and every fully supported device', () => {
    const missing = catalog.filter((m) => m.popular && !files.includes(`${modelKey(m.vendor, m.name)}.png`)).map((m) => m.name)
    expect(missing).toEqual([])
    for (const k of [...others, 'wlmouse-ying', 'endgame-gear-op1-8k', 'logitech-pro-x2-superstrike']) expect(files).toContain(`${k}.png`)
  })
})

describe('photo lookup', () => {
  it('uses the catalog model when the device reports a different name', () => {
    const d = { id: 'logitech-1', vendor: 'Logitech', name: 'G203 LIGHTSYNC Gaming Mouse', photo: 'logitech-gaming-mouse-g102-g103-g203' }
    expect(photoKey(d)).toBe('logitech-gaming-mouse-g102-g103-g203')
    expect(photoFor({ 'model:logitech-gaming-mouse-g102-g103-g203': 'url' }, d)).toBe('url')
    expect(photoFor({ 'model:logitech-gaming-mouse-g102-g103-g203': 'url', 'logitech-1': 'own' }, d)).toBe('own')
  })

  it('falls back to the name, and ignores a malformed key', () => {
    expect(photoKey({ vendor: 'Razer', name: 'Viper V3 Pro' })).toBe('razer-viper-v3-pro')
    expect(photoKey({ vendor: 'Razer', name: 'Viper V3 Pro', photo: '../../etc/passwd' })).toBe('razer-viper-v3-pro')
  })
})
