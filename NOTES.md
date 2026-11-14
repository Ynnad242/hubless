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
Wooting live travel: cmd 20 GetAnalogValues → 6×21 bytes (0..255 = 0.1..4.0 mm), 6 ms; polled ~55 Hz on Actuation page.
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
- Product photos ship with the app: data/devices/<vendor>-<model>.webp (modelKey in src/shared/devices.ts), packaged as
  resources/devices. User photos (~/.config/hubless/images/<device id>) still override. They are vendor product shots:
  publishing them publicly carries copyright risk — the user chose to ship them (2026-11-11).
Next: Razer driver (OpenRazer protocol: 90-byte feature reports) would light up 89 catalog models; OP1 v2 layout check.

## v0.16.1 (2026-11-11): OP1 verified by input capture, OP1 photo, release hygiene
- OP1 8k checked with the user's hands: at divider 4 the busiest second had 2002 reports (2 kHz); Back remapped to
  F13 arrived as keyboard usage 0x68 on interface 1. DPI-button cycling can't be seen over USB (handled on the mouse).
- data/devices/endgame-gear-op1-8k.webp (user's photo, cable cropped). PhotoMouse now also handles light mice: main
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

## v0.16.2 (2026-11-11): security pass
Renderer sandbox on, nodeIntegration off, devTools off when packaged, default menu removed when packaged, strict CSP
(object/frame/base/form locked), https-only external links, will-navigate blocked, all web permissions denied. IPC:
own-property method whitelist, sender must be the app page, args array ≤4; settings patch whitelisted; restoreBackup
path must be inside the device's backup dir (storage.backupPathFor). HUBLESS_SHOTS ignored when packaged. Electron fuses
(package.json electronFuses): RunAsNode/NODE_OPTIONS/--inspect off, OnlyLoadAppFromAsar on (verified with
@electron/fuses read). Deps updated (Electron 45.3.0); npm audit: 6 moderate, all minimatch inside electron-builder
(build-time only). Removed legacy-python/ and 9 unused shadcn components. GitHub: secret scanning + push protection,
Dependabot alerts/security fixes + .github/dependabot.yml, private vulnerability reporting, SECURITY.md, Actions pinned
to SHAs (checkout v7.0.1, setup-node v7.1.0). Tested on the packaged build in demo mode with throwaway XDG dirs.

## v0.16.3 (2026-11-11): performance
- HID.devices() costs ~13 ms and blocks the main thread. Was called 1×/2 s + 6× per scan (every 6 s); now once per poll
  tick, passed to scan() and every *Endpoint(list) finder and watchButtons (manager.hid).
- Receiver pairing (pairedDevices: 3 register reads × 6 slots = 18 HID++ round trips) was re-read every scan; now cached
  60 s per transport.
- manager.changed() emits only when the snapshot (minus lastSeen) differs, so the UI doesn't re-render every refresh.
- Photos: shipped as WebP q90 + lossless alpha (945 KB → 158 KB PNG→WebP, PSNR 44–50 dB). deviceImages(devices) returns
  only photos for the listed devices (renderer asks when the device list changes), data URLs cached per file mtime;
  photos picked by the user are downscaled to ≤1200 px with nativeImage.

## v0.16.4 (2026-11-11)
Home: Connected / Not connected tabs (lastSeen recorded on unplug and on quit). Card order no longer depends on
status: snapshot sorts plugged-in devices by kind then name (asleep/ready flips while AFK made cards jump);
test/manager.test.ts covers it.

## v0.17.0 (2026-11-11): self-update, gear icon
- src/main/updater.ts wraps electron-updater 6.8 (external in electron.vite.config: bundling it lost the lazy
  `autoUpdater` getter → undefined). Feed = GitHub releases (app-update.yml from package.json repository); the release
  workflow must upload dist/latest-linux.yml (lists AppImage/deb/rpm/pacman + sha512). Setting autoUpdate (default on):
  check at start + every 6 h, autoDownload. AppImage installs on quit (Updater.installOnQuit, called from
  window-all-closed because app.exit skips the 'quit' hook) or via "Restart to update"; pacman/deb/rpm need pkexec, so
  only on "Restart to update" (banner + notification + Settings). PacmanUpdater.installWithCommandRunner overridden to
  never run `pacman -Sy` (partial upgrade). Cache ~/.cache/hubless-updater (removed by Delete all data).
- Tested end to end with throwaway 0.90.0 → 0.90.1 builds on a local generic feed (-c.publish.provider=generic):
  AppImage found/downloaded/verified, replaced byte-identically, relaunched as 0.90.1, settings kept; pacman build
  downloaded the .pacman and reached ready (needsPassword) — install itself not run (needs the user's password).
- Header "Menu" → gear icon opening Settings; Grant access and About moved into Settings. PRIVACY/SECURITY/README updated
  for the update check (only network use).
- Gotcha: `npx asar extract-file` writes into the cwd — never run it from the project root (it overwrote package.json).

## v0.18.0 (2026-11-11): seamless updates
- Startup: the update found by the first check installs right away. The renderer covers the app with "Updating Hubless
  to X" (UpdateScreen in App.tsx, shown while status.startup) and the app restarts into the new version; "Not now"
  (deferUpdate) turns it into the banner. No update → nothing shown, the app just opens.
- Later updates (6 h check in the tray): install as soon as they're downloaded if the window is hidden, when the
  window is closed to the tray, or on quit (installOnQuit). While the window is open: banner "Restart to update".
- Package installs no longer use electron-updater's pkexec path: it needs a polkit authentication agent, and Omarchy /
  plain Hyprland run none, so it failed there. Instead build/hubless-update (root helper, installed by after-install.sh
  to /usr/lib/hubless/) + build/io.github.hubless.update.policy (allow_active=yes, exec.path = helper) → pkexec works
  without an agent or password. The helper re-downloads latest-linux.yml itself and installs only a file whose sha512
  matches the latest release's package (copy first, then hash, so no swap). Without the helper (pre-0.18 installs)
  the old quitAndInstall + password path is the fallback.
- AppImage restart: relaunch process.env.APPIMAGE (or the renamed file), not process.execPath: that lives in the
  AppImage's temporary mount, which is gone once the old process exits (first test didn't reopen because of this).
- after-remove.sh: skip on upgrades (rpm passes 1, deb "upgrade"), or rpm's old %postun deletes the files the new
  %post just installed.
- Tested: helper checks against the real v0.17.0 .pacman (accepted) and tampered / wrong-type / unreadable files
  (refused), with the install line stubbed (needs root). AppImage 0.90.0 → 0.90.1 on a throttled local feed: update
  screen with progress → replaced → reopened as 0.90.1 → settings kept → no screen when already up to date; "Not now"
  → banner, file untouched while open, installed on quit. Not tested: close-to-tray install (demo mode has no tray),
  and the real pacman install through the helper (needs this package installed as root first).

## v0.18.0 (2026-11-11): WLmouse Ying
- src/main/wlmouse/ying.ts: transport + codec (decode/plan, unit-tested in test/wlmouse.test.ts) + session. Protocol
  facts from OpenMouse's mouse-protocol (AGPL, code not copied); details in docs/PROTOCOL.md.
- Gotcha: the config report is on interface 2. Interface 1 also has a usage-page-0xFFFF collection and just echoes the
  request back (status 00), which looks like "no answer".
- On the cable only 125–1000 Hz are accepted (2K–8K → a2 unsupported). 1000 Hz reads as 01 or 10; 01 is written.
- Backup = the read payloads keyed (page << 8 | read cmd); restore writes them with the write cmd (cmd & 0x7f).
- Hardware: test/wlmouse-hw.test.ts (HUBLESS_HW=1) changes 11 settings with read-back, restores, compares byte for byte;
  passed twice on firmware 2.18. Also checked through the app UI (preset 800 → mouse → back to 1600, backup made).
  Original settings of the user's Ying: ~/.local/share/hubless/backups/3F311937/*_original.json.
- Close the installed Hubless while running hardware tests: two processes talking to the same report collide.
- No button remapping (protocol not known yet); no wireless receiver (36a7:a874) support yet. Photo: data/devices/wlmouse-ying.webp.
- Shared UI: MouseLimits gained buttons/liftOff/debounceMax/filters/motionSync/rippleControl; debounce shows on the Sensor
  page when a mouse has no Buttons page.

## v0.19.0 (2026-11-12): Razer, device reports
- data/razer.json from tools/extract-razer.py (parses OpenRazer's razermouse_driver.c switch blocks: per-pid transaction
  id, polling command v1/v2 + send-twice, DPI stages or not, interface, wait). 103 pids claimed (get_dpi_xy + polling);
  byte-DPI ancients (Naga Hex etc.) and models without DPI are left as "coming soon".
- src/main/razer/razer.ts: HidLink (node-hid feature report 0, 91 bytes with the id) → RazerTransport (checks class/cmd,
  status) → RazerSession (readAll validates before any write, plan/restorePlan pure + tested, read-back after save,
  backup before first change). Battery % = byte*100/255. No hardware tested: summary.verified = false.
- src/main/razer/sim.ts: strict simulator used by tests and --demo (simulated Viper V3 Pro wireless).
- Gotcha: the v2 polling read declares data size 1 but returns the code in byte 1; the transport returns all 80 args.
- A Razer whose answers don't validate is put in manager.refused (card shows why, no retries, nothing written).
- "Copy device report" (Device settings, and the home card's ⋯ menu): manager.report() — version, kernel, USB ids,
  interfaces + HID report descriptors from sysfs, firmware, raw readings. No serials or paths; main writes the clipboard
  (the renderer has no clipboard permission). Nothing is sent to the device.

## v0.20.0 (2026-11-14): preloaded device photos, mouse lighting, firmware updates

### Preloaded device photos (2026-11-13)
- data/devices now holds 29 transparent PNGs (≤1600 px, ~13 MB) for every fully supported device, every popular catalog
  mouse and a few current Razer/Logitech models. Old WebPs removed. All from manufacturer sites, background removed,
  cable cropped (PhotoMouse needs the body to start at the top). test/photos.test.ts checks format, size, that each
  file names a real model, and that every `popular` catalog mouse has one.
- Sources: Logitech resource.logitechg.com originals (2000–3600 px, already transparent, *top-angle-gallery-1*);
  Razer only publishes ~500–600 px cutouts publicly (store 500x500 PNGs, dl.razerzone.com support images; press kits
  sit behind a Razer SharePoint login), so Razer photos are ~370–560 px: 2x the 176 px home card, and Razer has no
  button page. Wooting 60he-prebuilt-ANSI (2560), Fractal Scape 3/4 shot (2560, holes in headband removed), WLmouse
  Ying MG black (2000, receiver cropped), Endgame OP1 8k top-down (Endgame no longer lists v1; also used for v2),
  Glorious Model O Eternal top (same shell as Model O/O-).
- Logitech mice report their own name ("G203 LIGHTSYNC Gaming Mouse"), not the catalog's, so manager sets
  DeviceSummary.photo = modelKey of the catalog model looked up by USB id (wpid on a receiver, pid wired);
  photoKey()/photoFor() use it before the name.
- New photo: tools/device-photo.py <source> data/devices/<modelKey>.png [crop] [seed=x,y] [holes] [nocable]
  (corner-colour flood fill, soft edge, edge colours un-mixed from the background), then the photos test.

### Mouse lighting (2026-11-13)
- Lighting page for every mouse with RGB (capability 'lighting'; src/renderer/src/sections/Lighting.tsx). Per zone:
  Off / Colour / Breathing / Colour cycle, colour, brightness, speed (where the zone supports it), "Use on all zones".
  Shared types: LightSetting (in ProfileData.lighting) and LightZone (MouseState.lighting), so it saves through the
  normal saveProfile path.
- Logitech (src/main/logitech/lighting.ts): zones from 0x8070 (fn0 count, fn1 location) or 0x8071 (fn0 [ff ff 00] /
  [c ff 00]); settings live in the onboard profile (formats 1-6, 255-byte sectors): LEDs at 0xD0/0xDB, power-saving
  copies at 0xE6/0xF1 (kept equal, like libratbag). Modes 00 off, 01 fixed rgb, 03 cycle (period BE @6, intensity @8),
  0A breathing (rgb, period BE @4, waveform, intensity @7); intensity 0 = 100 %. Other modes kept byte for byte.
  Writing the active profile re-selects it so the light changes at once (only when lighting changed: re-selecting
  resets the DPI stage). Static has no brightness in the profile. SUPERSTRIKE (format 8) has no RGB.
- Razer: tools/extract-razer.py now records per model the zones (logo 0x04, scroll 0x01, backlight 0x05, left 0x11,
  right 0x10, whole mouse 0x00) that use the extended-matrix commands (class 0x0F: 02 effect, 04/84 brightness) with
  their transaction id; 53 models. Older Chroma mice (classic 0x03 commands) get no lighting page. Effects can't be
  read back, so Hubless remembers what it set (~/.config/hubless/lighting.json, storage.savedLighting) and shows
  "Not set yet" before that; brightness is read from the mouse and checked after writes.
- Demo mode adds a simulated G502 HERO (SimTransport('g502'), format 2 with 0x8070) and Basilisk V3 Pro.
- Not tested on hardware: the user owns no RGB mouse. OP1 8k DPI-indicator colours (config bytes 31..50) not exposed.

### Firmware updates (2026-11-13)
- src/main/firmware.ts. Only official routes; Hubless never writes firmware itself.
  - fwupd: `fwupdmgr refresh` (once a day, no password), `get-devices --json` + `get-updates --json`, matched to our
    device by USB id (USB\VID_x&PID_y, and HIDRAW\VEN_x&DEV_wpid for mice behind a Unifying receiver; Bolt peripherals
    use MOD_ ids and only match through the receiver). Install: `fwupdmgr update <DeviceId> --assume-yes
    --no-reboot-check --no-unreported-check`, % parsed from output. Mice are backed up first.
  - Wooting: no public "latest firmware" API (changelog said 2.14.1 while the user's 60HE runs 2.14.2), so no
    "update available" guess: "Update with Wootility" launches the installed app (PATH, *.AppImage in ~/Applications,
    ~/.local/bin, ~/Downloads, /opt, or a .desktop via gio) or opens wootility.io; "Reconnect keyboard" takes it back.
  - Others: note naming the maker's app (VENDOR_APP).
- manager.hold(id, note) closes Hubless's connection and ignores the device's USB ids (and, for the unsupported list,
  the maker's other ids: a Wooting in update mode has another pid) until release(id); a receiver is shared, so all its
  mice go quiet. Card/page show the note with a spinner (Shell busy). Demo parks and restores the simulated devices.
- On this PC (2026-11-13) fwupd 2.1.8 sees none of the user's peripherals (only BIOS/SSD/UEFI keys), so the real
  fwupd install path is untested on hardware; the demo G502 has a pretend update to try the flow.

## v0.20.1 (2026-11-14): key travel graphic, HITS fill
- Wooting Actuation: KeyTravel rebuilt (fixed legend, sticks to last key). Pressed state from src/shared/keytravel.ts
  (Wooting RT model: release at peak − release, re-press at valley + press, leaves RT above actuation unless
  continuous). Verified on the 60HE by recording ~170 state changes against per-key settings. Analog polled ~55 Hz.
- HITS (SUPERSTRIKE): the depth stream is sampled, so a quick click could fire between samples; a click from the input
  report now fills the button at least to its actuation point.

## v0.20.2 (2026-11-14): self-update after a restart ("pkexec must be setuid root")
- Electron's app.relaunch() starts the new copy with no_new_privs (verified: relaunched child NoNewPrivs=1, plain
  child_process spawn from a clean parent NoNewPrivs=0). pkexec refuses to run there, so every update after an
  update-restart failed. lifecycle.relaunch() now uses /bin/sh waiting on our pid, then exec (keeps the single-instance
  lock working). The updater detects no_new_privs and says "Quit Hubless and open it again"; a launcher start is clean.
