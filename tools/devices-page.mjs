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
  ['WLmouse', 'Ying', 'Mouse', '`36a7:a875` (USB cable)', 'Up to 6 DPI stages (50–30,000), polling 125–1000 Hz on the cable, lift-off 0.7 / 1 / 2 mm, angle snapping, motion sync, ripple control, click debounce, backups. Not yet: button remapping, the wireless receiver'],
  ['Wooting', '60HE', 'Keyboard', '`31e3:1312`', 'Actuation, rapid trigger, Tachyon mode, per-key actuation and rapid trigger, live key travel, key mapping (3 layers), Mod-Tap / Toggle / Snap Tap, lighting, rename'],
  ['Fractal Design', 'Scape', 'Headset', '`36bc:0001` (dongle)', 'Battery, EQ presets and custom EQ, EQ codes, noise cancelling, sidetone and its volume, lighting on/off'],
  ['Logitech', 'C922 Pro Stream', 'Webcam', '`046d:085c`', 'Exposure (auto or manual time, low-light compensation, gain, backlight), white balance, focus, zoom / pan / tilt, brightness, contrast, saturation, sharpness, anti-flicker, live preview. Settings are kept on this PC and put back after an unplug or when another app changes them'],
]
const workingNames = new Set(working.map(([v, n]) => `${v}|${n}`.toLowerCase()))

// Logitech HID++ 2.0 mice are driven by the Logitech driver (DPI, polling, buttons, onboard profiles).
const logitech = catalog.filter((m) => m.protocol === 'logitech-hidpp20' && m.kind === 'mouse' && !workingNames.has(`${m.vendor}|${m.name}`.toLowerCase()))
// Razer mice the Razer driver handles (same filter as src/main/razer/razer.ts MODELS).
const razerData = JSON.parse(readFileSync(new URL('../data/razer.json', import.meta.url), 'utf8')).models.filter((m) => m.dpi?.[0] === 'get_dpi_xy' && m.poll)
const razerPids = new Map(razerData.map((m) => [m.pid, m]))
const ZONE = { logo: 'logo', scroll: 'scroll wheel', backlight: 'backlight', left: 'left side', right: 'right side', all: 'whole mouse' }
const razer = catalog.filter((m) => m.vendor === 'Razer' && m.ids.some((i) => i.vid === 0x1532 && razerPids.has(i.pid)))
const vendors = new Map()
for (const m of catalog) {
  if (workingNames.has(`${m.vendor}|${m.name}`.toLowerCase()) || logitech.includes(m) || razer.includes(m)) continue
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

### Logitech

Logitech G mice that use HID++ 2.0 (${logitech.length} models), wired or through their LIGHTSPEED receiver: **DPI, polling rate,
buttons, onboard profiles and RGB lighting** (on mice with RGB, such as the G502, G203 and G Pro; the mouse tells
Hubless which lights it has). The PRO X2 SUPERSTRIKE's trigger settings are specific to that mouse.

<details><summary>${logitech.length} Logitech mice · including ${logitech.filter((m) => m.popular).slice(0, 4).map((m) => m.name).join(', ')}</summary>

| Model | Max DPI | USB ids |
|---|---|---|
${logitech.sort((a, b) => Number(b.popular) - Number(a.popular) || a.name.localeCompare(b.name)).map((m) => `| ${m.name}${m.popular ? ' ⭐' : ''} | ${dpi(m)} | ${ids(m)} |`).join('\n')}

</details>

If you try one of these, please [report how it went](https://github.com/Ynnad242/hubless/issues/new), good or bad.

### Razer

${razer.length} Razer mice, wired or through their HyperSpeed receiver: **DPI stages (or DPI on older models), polling
rate (up to 8000 Hz on 8K models), battery level and RGB lighting** (per zone where the mouse has lights). Built from OpenRazer's protocol notes and tested against a
simulated mouse; not yet on real hardware. Hubless reads everything first, changes nothing if the mouse answers
unexpectedly, and reads every change back.

<details><summary>${razer.length} Razer mice · including ${razer.filter((m) => m.popular).slice(0, 4).map((m) => m.name).join(', ')}</summary>

| Model | Max DPI | DPI stages | Polling up to | Lighting | USB ids |
|---|---|---|---|---|---|
${razer
  .sort((a, b) => Number(b.popular) - Number(a.popular) || a.name.localeCompare(b.name))
  .map((m) => {
    const rs = m.ids.map((i) => razerPids.get(i.pid)).filter(Boolean)
    const stages = rs.some((r) => r.stages) ? 'yes' : 'one DPI'
    const fast = rs.some((r) => r.poll[0] === 'get_polling_rate2') ? '8000 Hz' : '1000 Hz'
    const zones = [...new Set(rs.flatMap((r) => (r.lighting ?? []).map((z) => ZONE[z.zone])))]
    return `| ${m.name}${m.popular ? ' ⭐' : ''} | ${dpi(m)} | ${stages} | ${fast} | ${zones.join(', ') || '—'} | ${ids(m)} |`
  })
  .join('\n')}

</details>

If you own one of these, open it in Hubless and use **Device settings → Copy device report**, then paste it into an
issue. Once a model checks out it moves to ✅ Works.

### Logitech G headsets and keyboards

Logitech G headsets and keyboards that speak HID++ 2.0, wired, through a LIGHTSPEED receiver or a headset dongle. Hubless
shows what each one offers: **sidetone, equalizer, battery and auto power-off** on headsets (G733, G535, G435, PRO X
Wireless, G935 and others), **backlight brightness, game mode (lock the Windows key, Caps Lock, Num Lock, Scroll Lock or
Insert) and battery** on keyboards (G915, G915 TKL, G915 X, G815, G515, PRO X TKL and others). Tested on simulated
devices, not yet on real ones. Not yet: keyboard lighting effects, G-keys, and newer headsets on Logitech's newer
protocol (PRO X 2, Astro A50 X, G522).

### Razer keyboards

61 Razer keyboards (BlackWidow, Huntsman, Ornata, DeathStalker, Cynosa and Joro, wired and HyperSpeed): **whole-keyboard
lighting (off, one colour, breathing, colour cycle), brightness and game mode**, using the command variant OpenRazer
uses for each model. Tested on a simulated keyboard, not yet on a real one. Not yet: per-key colours, macros.

### SteelSeries and HyperX headsets

**SteelSeries Arctis Nova 7** (Nova 7, 7X, 7P, Gen 2 and special editions): battery, sidetone, auto power-off and a
10-band EQ. **SteelSeries Arctis 7, Arctis 7 2019, Arctis Pro 2019 and Pro GameDAC**: battery, sidetone, auto power-off.
**HyperX Cloud Alpha Wireless**: battery, sidetone, auto power-off, voice prompts. Commands follow HeadsetControl. These
headsets can't report their settings, so Hubless shows the ones it last set. Tested on simulated headsets, not yet on
real ones. Not yet: Corsair, Razer and other SteelSeries / HyperX headsets.

### Webcams

Every standard USB webcam (UVC): Logitech C920, C920S, Brio, MX Brio, StreamCam, C270, Razer Kiyo, Kiyo Pro, Kiyo V2,
Elgato Facecam and the rest, including most built-in laptop cameras on USB. **Hubless shows whichever settings the
camera offers** (exposure, white balance, focus, zoom, picture), with a live preview. Webcams forget their settings when
unplugged, so Hubless saves them on this PC and puts them back. Needs \`v4l-utils\` (the packages install it).

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
