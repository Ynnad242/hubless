# hubless — Logitech G mouse configurator for Linux (working notes)

Goal: a standalone Linux app (GTK4 + libadwaita, Python/PyGObject) that beats the existing
Superstrike tools and acts as a "G HUB for Linux". Name is a placeholder.

## Hardware (verified 2026-11-04, read-only)
- PRO X2 SUPERSTRIKE, wpid 0x40BD, HID++ 4.2, LIGHTSPEED receiver 046d:c54d, HID++ iface = /dev/hidraw10
  (number not stable — discover by VID + report descriptor), device index 0x01.
- udev rule installed: /etc/udev/rules.d/70-logitech-hidpp.rules (copy in research/).
- Features: 0x2202 DPI, 0x8061 rate (mask 0x7f = 125..8000), 0x8100 onboard, 0x1B0C HITS,
  0x1004 battery, 0x8090 ModeStatus, 0x80E0/0x1500/0x1602 unknown. Hidden/engineering ones: never touch.
- Onboard: info `01 08 01 05 01 05 10 00 ff` → format 8, 5 profiles, sector size 255.
  Mode 01 (onboard), current profile sector 1, current stage (fn 0xB) 0.
- Backup of profile sector 1 (all 5 identical): research/sector1.bin.

## Profile format 8 (confirmed on this X2)
0x00 rate wireless (Hz = 125<<n), 0x01 rate wired, 0x02 default stage, 0x03 shift stage,
0x04 + 5n stage n [X LE16][Y LE16][LOD] (X=0 → off), 0x22 angle snap, 0x25 scroll filter,
0x26 HITS L, 0x29 HITS R: [act<<2][rt<<2 | rt_on][hap<<2], 0x2C sleep s LE16, 0x2E off s LE16,
0x30 buttons 16×4, 0x70 shift buttons, 0xA0 name UTF-16LE, 0xD0.. unknown (keep), last 2 = CRC-16/CCITT-FALSE BE.
Formats 1–5 (older G mice): Solaar generic layout (rate in ms, DPI words at 3, buttons 32, name 160).

## HITS 0x1B0C
fn0 caps `00 03 28 14 14 01` (act max 10, rt max 5, hap max 5); fn2 get [btn]; fn1 set [btn act rt hap].
Live now: L/R = `14 08 0c` → act 5, RT level 2, **bit0=0**, haptics 3.
Hypothesis to verify: rt byte bit0 = rapid-trigger ON (Solaar treats it as a "flag to preserve" → its open RT bug #3287).

## Onboard functions
fn0 info, fn1 setMode, fn2 getMode, fn3 setCurrentProfile, fn4 getCurrentProfile, fn5 read 16B,
fn6 begin write [sec, 0,0, len], fn7 write 16B, fn8 end, fn11 get stage, fn12 set stage. ROM factory sectors at 0x0100+.

## Competitor weaknesses (what we beat)
- mclol0/oddvalue linux-superstrike (Go): wrong DPI layout (words from byte 3) → DPI never changed; fixes in
  unmerged PRs #5/#6. Profile write never reloads. Doc has name offset overlapping G-shift table.
- Solaar: HITS RT on/off bit mishandled; host-mode-centric; generic tool, no HITS profile storage.
- superstrike-studio (C++/GTK, best one): layout correct but verified only on X3, not X2; 0 stars;
  manual udev terminal step; single device family.
- xatuke (C/GTK): live-only, nothing saved to the mouse (resets on reconnect).
- kazehana99k: CLI only, HITS only.
## Our plan / differentiators
1. Verified on a real X2. 2. One-click permission fix (pkexec installs udev rule) instead of terminal.
3. Auto-save to onboard memory + full-memory backup before first write + byte-for-byte verify + undo-session.
4. Feature-table-driven UI → works for other Logitech G mice (formats 1–5), not just Superstrike.
5. Demo/simulated device for testing. 6. Hot-plug + sleeping-mouse handling.
Next: write hubless/ package (hidpp transport, device, profile codec, GUI), then verify writes on the mouse
(HITS live set + RT bit test, DPI stage write, button remap) with backups.

## Status 2026-11-04 (evening)
App written: hubless/ (hidpp, device, profile, session, storage, sim, gui/), installed via ./install.sh to ~/.local.
Tests: tests/test_protocol.py (7 ok), tests/gui_flow.py (15/15 vs simulator), tests/hardware.py (real mouse,
restores memory; needs the user moving the mouse for the polling-rate measurement).
Verified on hardware: HITS live set incl. RT on bit + low values; flash write+verify on slot 2; writing the
active profile applies HITS live without reload; ROM 0x101 = factory profile; receiver register 0xB5 gives
paired device names (asleep detection). Pending: hardware.py full run + polling-rate measurement, physical
feel check of DPI/RT by the user.

Hardware run: all functional checks PASS; polling verified 500/1000/2000 Hz (4000/8000 not measured). 0x8061 fn3 rejected in onboard mode -> removed from session.

## 2026-11-04 late: DPI stage gap bug (user-reported) + UI redesign
Firmware counts DPI stages from entry 0 up to the first X=0 entry. A gap (stage 1 off, stage 3 on) leaves the
live stage at 0xFF, sets are rejected (INVALID_ARGUMENT) and the sensor keeps its old DPI. Fix: Profile.encode
packs enabled stages to the front (pack_stages), session repairs live stage; sim enforces the same rule.
Verified on hardware via 0x2202 fn5 (live DPI follows profile edits immediately).
UI redesigned: sidebar (device card/nav/profile), brand cyan→violet, LevelMeters, trigger gauge cards, DPI stage
tiles, profile cards. tools/screenshots.py renders full pages (window non-resizable so Hyprland floats it).

## 2026-11-04 night: Electron rewrite (user chose Electron + shadcn)
Python app moved to legacy-python/ (reference only). New app: electron-vite + React 19 + Tailwind 4 + shadcn (new-york, zinc,
dark-first, cyan→violet brand). Main process: src/main/logitech/{hidpp,device,profile,session,sim}.ts over node-hid
(hidraw, HIDAsync), manager.ts (discovery/sleep/hot-plug), storage.ts (backups, pkexec udev rule incl. Logitech/Wooting/
Fractal/Razer/Endgame VIDs). Renderer: src/renderer/src (App sidebar + pages). Tests: `npx vitest run` (9 protocol tests),
`HUBLESS_HW=1 npx vitest run test/hardware.test.ts` (5 on the real mouse, restores memory). Screenshots:
`HUBLESS_SHOTS=dir electron . --demo` (offscreen). Packages: `npm run dist` → dist/*.AppImage + .pacman.
AppImage needs libfuse2 on Arch (or APPIMAGE_EXTRACT_AND_RUN=1). Endgame Gear VID 0x3367 is unverified.
Next: Wooting 60HE (research/eng1n88r_wooting protocol, MIT), Fractal Scape (scapectl facts only, GPL), Razer (OpenRazer),
Endgame Gear, Astro. User owns Endgame Gear + Razer devices (models not yet known, not plugged in).

## 2026-11-04 late night: G HUB-style overhaul (v0.11.0)
Home grid of devices (registry ~/.config/hubless/devices.json; inactive = seen before, greyed; unsupported = detected
Wooting/Fractal/Razer/Endgame without driver yet; Logitech ids are logitech-<serial>, serial read from receiver
register 0xB5 0x30+slot even while asleep). Device view: top bar (back, name, profile select), icon rail, 340px panel,
canvas with own SVG art (src/renderer/src/components/DeviceArt.tsx — no vendor images; users may set their own photo,
stored in ~/.config/hubless/images). Tokens: neutral greys + single blue #2b8cff (index.css).
BUG FIXED: udev rules must not have trailing "# comment" on rule lines — the whole line is ignored. Package now ships the
rule via pacman post_install/post_upgrade (build/after-install.sh) into /usr/lib/udev/rules.d and deletes the old
/etc copy.

## 2026-11-04: Wooting + Scape drivers (v0.12.0)
src/main/wooting/wooting.ts: config iface usage page 0xFF55; cmd = feature report [1,D1,DA,cmd,slot,0,0,0], reply input
report [id,D1,DA,echo,status(0x88),lenLo,lenHi,data]; KeyboardProfile(0x11) writes preceded by RtKeys(0x1D) raw, flags 0 = RAM,
(slot<<1)|1 = flash; reads return flash. Verified write/restore on user's 60HE (fw 2.14.2, 1 profile "Optimum").
src/main/fractal/scape.ts: report id 2, 63-byte output; 11xx dongle, F1xx headset (timeout when off), A707 select EQ slot,
F136 MNC, A404 lighting, F134 sidetone (needs F121 poll after). Verified toggles + restore (dongle 3.33, headset 3.48).
test/peripherals.test.ts (HUBLESS_HW=1).

## 2026-11-04 night: in progress (usage limit hit)
DONE (backend, hardware-verified, restore exact): Wooting per-key actuation (0x15 packed (code<<16)|mid), per-key RT groups
(0x1D: repeated {1: packed mids, 2:{press,release,1}}), mapping layers (0x14 hdr [type,flags,layer,0,0,len]), advanced keys
(0x18 + cmd 53), lighting (rows 0x0E/0x0F RGB565 packed + core 0x16 + cmd 8), rename (0x1A), full restore. API: keyboardAction.
Scape EQ: coefficients = RBJ biquads, stored [b0,b1,b2,a1,a2] normalized float32 at reply offset 6 (a7 05 slot drv band);
driver 1 = 44000 Hz, 2 = 48000, 4 = 96000 (verified to 1e-7 on presets). a7 01 / a7 03 write layout still UNKNOWN:
next step = read Adjust Pro bundle (adjust.fractal-design.com main.*.js) for setEqSettings/commitEq.
TODO UI: Wooting keyboard map (per-key, remap, advanced keys, lighting, rename, restore); Scape EQ editor + EQ codes,
sidetone volume (f1 34 02/03 steps + f1 21 between), lighting colours (a4/a5); EQ preset names; tray + low-battery
notifications + autostart + settings page; mouse wired-mode test. Then bump version + rebuild pacman.

## 2026-11-04 22:xx: v0.13.0
Wooting UI done (KeyMap component; sections actuation/per-key, keymap layers, advanced keys, lighting, device+rename+restore).
Scape EQ write DONE, from Adjust Pro bundle (adjust.fractal-design.com main.*.js): SetEqSettings [A7 01 slot<<4|7] + 5×[en,type,
freq u16,gain f32,Q f32] (unused = [0,0,32,0,0,0.5]; flat = one enabled peak 22000/0/0.5); SetEqCoef [A7 02 slot driver band
b0 b1 b2 a1 a2] for drivers 1/2/4 (44000/48000/96000 Hz); CommitEq [A7 03 slot mode f32(0) len uuid] mode 1 live/2 save/3 erase.
Hardware-verified (slot 3 write + coef readback < 1e-6 + restore). EQ codes (Adjust Pro format) import/export. Sidetone level via
relative F1 34 02/03 steps. Tray + low-battery notifications + autostart (--hidden) + settings dialog (~/.config/hubless/settings.json).
User's own product photos live in ~/.config/hubless/images (not bundled: vendor copyright).
Still open: Scape lighting colours (A4 01-03 theme upload format not decoded yet), mouse wired test (needs cable), Razer/Endgame.

## v0.14.0
Wooting live travel: cmd 20 GetAnalogValues → 6×21 bytes (0..255 = 0.1..4.0 mm), 6 ms; polled 20 Hz on Actuation page.
Wootility sync: keyboard re-read (`reload` action) on window focus + every 15 s when no edit pending.
Scape: headsetState refreshes status each call; page polls every 2 s. Mute byte 4 = 0 while user unmuted (confirmed once);
toggling not yet observed. Mouse: physical button state streamed from the mouse's input report (id 0x02) on the dj child node;
PhotoMouse finds dark button areas in the user's photo and draws selection / actuation lines.
OPEN: SUPERSTRIKE live analog press depth. 0x1B0C fn3 [01 3c] (G HUB's command) acks "3b 01 3c" but produced no events in two
40–90 s captures — the user wasn't pressing; redo the capture with the user pressing, also watching report 0x12 and other
feature indexes. Mute toggle capture likewise.

## v0.15.x (2026-11-05)
0.15.0 SUPERSTRIKE live press depth works (HITS 0x1B0C fn3 [01 3c] start / [00 3c] stop → fn0 events [left, right] 0..10).
0.15.1 Sensor page: canvas DPI track is the editor (drag dots, click track, arrows). 0.15.2: DPI quick picks; SIGTERM/
SIGINT/SIGHUP really quit (before-quit sets `quitting`); packaged app polls app.asar + execPath (src/main/lifecycle.ts) and
relaunches into a freshly installed version (keeps --hidden). sudo is blocked inside Claude's sandbox and the app's
Terminal panel (no_new_privs): the user installs packages from their own terminal.

## v0.16.0 (2026-11-11): Endgame Gear OP1 8k, mouse catalog, shipped photos
- OP1 8k (3367:1964) driver: src/main/endgame/{config,op1}.ts, layout in docs/PROTOCOL.md. Shown to the UI as a
  one-profile mouse (MouseState.limits, ProfileData.extras for LOD/motion sync/ripple/filters/debounce). Verified on the
  user's mouse via the app: DPI levels, polling, button remap, debounce all read back exactly; original config restored
  byte-for-byte (backup in ~/.local/share/hubless/backups/endgame-1964). NOT yet confirmed by feel/capture: the user was
  away for the input capture (polling rate measured from hidraw reports, Back→F13 key, DPI button cycling).
  egctl (AGPL, OP1 8k v2) used as a fact reference only; v1 differs (button table at 71, debounce last).
- data/mice.json: 214 models / 309 USB ids from OpenRazer + libratbag (tools/build-catalog.py, tools/extract-mice.py)
  plus verified entries; `popular` from prosettings.net (Nov 2026). Unclaimed catalog mice show on Home by name with
  max DPI ("support coming soon"). Viper V4 Pro ids 00e5/00e6 come from a driver database, unverified.
- Product photos ship with the app: data/devices/<vendor>-<model>.png (modelKey in src/shared/devices.ts), packaged as
  resources/devices. User photos (~/.config/hubless/images/<device id>) still override. They are vendor product shots:
  publishing them publicly carries copyright risk — the user chose to ship them (2026-11-11).
Next: Razer driver (OpenRazer protocol: 90-byte feature reports) would light up 89 catalog models; OP1 v2 layout check.

## v0.16.1 (2026-11-11): OP1 verified by input capture, OP1 photo, release hygiene
- OP1 8k checked with the user's hands: at divider 4 the busiest second had 2002 reports (2 kHz); Back remapped to
  F13 arrived as keyboard usage 0x68 on interface 1. DPI-button cycling can't be seen over USB (handled on the mouse).
- data/devices/endgame-gear-op1-8k.png (user's photo, cable cropped). PhotoMouse now also handles light mice: main
  buttons = body above the horizontal seam (findLightButtons).
- Release checklist pass: README rewritten for the Electron app (old GTK text/screenshots removed, claims toned down),
  PRIVACY.md, THIRD_PARTY_NOTICES.md (tools/third-party-notices.mjs; all bundled packages MIT/ISC/Apache-2.0/0BSD),
  docs/notices/sources.md (data/research credits, trademark + product-photo notice). In-app: About dialog (version,
  license, disclaimer, Privacy, Open-source licenses), Settings → Your data → Delete all Hubless data (config, data,
  autostart, and Electron's ~/.config/Hubless on exit; tested against sandboxed XDG dirs). Accessibility: alt text on
  device photos, keyboard-visible hover buttons, --primary-solid #1b6fe0 for white-on-blue (4.8:1).
- Still the user's call before publishing: vendor product photos (copyright), a real repo URL/contact in package.json.

## Published (2026-11-11)
Public repo https://github.com/Ynnad242/hubless (commits use 128772780+Ynnad242@users.noreply.github.com; history was
rewritten before the first push to drop the personal email). Releasing: bump package.json version, commit, push, then
`git tag -a vX.Y.Z -m "Hubless X.Y.Z" && git push origin vX.Y.Z`; .github/workflows/release.yml checks the tag matches
package.json, runs tsc + vitest, builds AppImage/deb/rpm/pacman on ubuntu-24.04 (needs libusb-1.0-0-dev, libudev-dev,
rpm, libarchive-tools) and publishes the release. First release: v0.16.1.
