// Writes DEVICES.md (the device list on GitHub) from data/mice.json, the same catalog the app uses.
// Usage: node tools/devices-page.mjs   (run after changing data/mice.json or adding support for a device)
import { readFileSync, writeFileSync } from 'node:fs'

const catalog = JSON.parse(readFileSync(new URL('../data/mice.json', import.meta.url), 'utf8')).models
const hex = (n) => n.toString(16).padStart(4, '0')
const ids = (m) => m.ids.map((i) => `\`${hex(i.vid)}:${hex(i.pid)}\`${i.connection ? ` ${i.connection}` : ''}`).join(', ')
const dpi = (m) => (m.maxDpi ? m.maxDpi.toLocaleString('en-US') : '—')

// Fully supported devices, tested on real hardware. Keep in sync with the app (src/main/manager.ts and the protocols).
const working = [
  ['Logitech', 'PRO X2 SUPERSTRIKE', 'Mouse', '`046d:40bd` (LIGHTSPEED receiver)', 'HITS triggers (actuation, rapid trigger, haptics, live press depth), DPI stages, polling rate, buttons, 5 onboard profiles, backups'],
  ['Endgame Gear', 'OP1 8k', 'Mouse', '`3367:1964`', 'DPI levels, polling up to 8 kHz, lift-off distance, angle snapping, motion sync, ripple control, click filters, debounce, buttons, backups'],
  ['Wooting', '60HE', 'Keyboard', '`31e3:1312`', 'Actuation, rapid trigger, Tachyon mode, per-key actuation and rapid trigger, live key travel, key mapping (3 layers), Mod-Tap / Toggle / Snap Tap, lighting, rename'],
  ['Fractal Design', 'Scape', 'Headset', '`36bc:0001` (dongle)', 'Battery, EQ presets and custom EQ, EQ codes, noise cancelling, sidetone and its volume, lighting on/off'],
]
const workingNames = new Set(working.map(([v, n]) => `${v}|${n}`.toLowerCase()))

// Logitech HID++ 2.0 mice are driven by the Logitech driver (DPI, polling, buttons, onboard profiles).
const logitech = catalog.filter((m) => m.protocol === 'logitech-hidpp20' && m.kind === 'mouse' && !workingNames.has(`${m.vendor}|${m.name}`.toLowerCase()))
const vendors = new Map()
for (const m of catalog) {
  if (workingNames.has(`${m.vendor}|${m.name}`.toLowerCase()) || logitech.includes(m)) continue
  if (!vendors.has(m.vendor)) vendors.set(m.vendor, [])
  vendors.get(m.vendor).push(m)
}
const sortedVendors = [...vendors.keys()].sort((a, b) => a.localeCompare(b))
const recognised = sortedVendors.reduce((n, v) => n + vendors.get(v).length, 0)

const out = []
out.push(`# Supported devices

This page lists what Hubless can do with each device. It's generated from the same device list the app uses
(\`data/mice.json\`), so it's always current for the newest release.

- **✅ Works:** tested on real hardware. Every setting listed can be changed and is saved into the device.
- **🧪 Should work:** uses a protocol Hubless supports, but nobody has tested this exact model yet. A backup of the device
  memory is made before the first change.
- **🔜 Recognised, support coming soon:** Hubless shows the device by name, but can't change its settings yet.

Don't see your device, or it doesn't show up? [Open an issue](https://github.com/Ynnad242/hubless/issues/new) with the
device name and the output of \`lsusb\`. Devices people ask for get supported first.

## ✅ Works

| Device | Type | USB id | What you can change |
|---|---|---|---|
${working.map(([v, n, k, id, what]) => `| **${v} ${n}** | ${k} | ${id} | ${what} |`).join('\n')}

## 🧪 Should work

Logitech G mice that use HID++ 2.0 (${logitech.length} models), wired or through their LIGHTSPEED receiver: **DPI, polling rate,
buttons and onboard profiles**. The PRO X2 SUPERSTRIKE's trigger settings are specific to that mouse.

<details><summary>${logitech.length} Logitech mice · including ${logitech.filter((m) => m.popular).slice(0, 4).map((m) => m.name).join(', ')}</summary>

| Model | Max DPI | USB ids |
|---|---|---|
${logitech.sort((a, b) => Number(b.popular) - Number(a.popular) || a.name.localeCompare(b.name)).map((m) => `| ${m.name}${m.popular ? ' ⭐' : ''} | ${dpi(m)} | ${ids(m)} |`).join('\n')}

</details>

If you try one of these, please [report how it went](https://github.com/Ynnad242/hubless/issues/new), good or bad.

## 🔜 Recognised, support coming soon

${recognised} devices (mostly mice) from ${sortedVendors.length} brands. Hubless shows them on the home screen with their name and
maximum DPI, marked "support coming soon".
`)
for (const v of sortedVendors) {
  const list = vendors.get(v).sort((a, b) => Number(b.popular) - Number(a.popular) || a.name.localeCompare(b.name))
  out.push(`### ${v}

<details><summary>${list.length} ${list.length === 1 ? 'device' : 'devices'}${list.some((m) => m.popular) ? ` · including ${list.filter((m) => m.popular).slice(0, 3).map((m) => m.name).join(', ')}` : ''}</summary>

| Model | Max DPI | USB ids |
|---|---|---|
${list.map((m) => `| ${m.name}${m.popular ? ' ⭐' : ''} | ${dpi(m)} | ${ids(m)} |`).join('\n')}

</details>
`)
}
out.push(`⭐ = among the most used mice by pro players.

Device names and USB ids come from [OpenRazer](https://github.com/openrazer/openrazer) and
[libratbag](https://github.com/libratbag/libratbag) (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)), plus
devices seen by Hubless itself.
`)
writeFileSync(new URL('../DEVICES.md', import.meta.url), out.join('\n'))
console.log(`DEVICES.md: ${working.length} working, ${recognised} recognised from ${sortedVendors.length} brands`)
