<div align="center">

<img src="build/icon.png" width="96" alt="Hubless icon">

# Hubless

**Settings for gaming mice, keyboards and headsets on Linux.**
One app for the things G HUB, Synapse, Wootility and Adjust usually do, talking to the devices directly and saving
into their own memory.

</div>

<img src="docs/screenshots/0-home.png" alt="Hubless home screen listing a connected mouse">

| Sensor & DPI | Buttons |
|---|---|
| <img src="docs/screenshots/mouse-2-sensor.png" alt="DPI stages, quick picks and polling rate"> | <img src="docs/screenshots/mouse-3-buttons.png" alt="Button assignments on a picture of the mouse"> |

<div align="center">

**[⬇ Download the latest release](https://github.com/Ynnad242/hubless/releases/latest)** · [Report a problem](https://github.com/Ynnad242/hubless/issues) · Free and open source, forever

</div>

## Download and install

1. Open the **[latest release](https://github.com/Ynnad242/hubless/releases/latest)** and download the file for your Linux:

   | Your Linux | Download | Install it with |
   |---|---|---|
   | Arch, Manjaro, EndeavourOS, CachyOS, Omarchy | `hubless-<version>.pacman` | `sudo pacman -U ~/Downloads/hubless-*.pacman` |
   | Ubuntu, Debian, Linux Mint, Pop!_OS, Zorin | `hubless_<version>_amd64.deb` | `sudo apt install ~/Downloads/hubless_*_amd64.deb` |
   | Fedora, Nobara, Bazzite (layered), RHEL | `hubless-<version>.x86_64.rpm` | `sudo dnf install ~/Downloads/hubless-*.x86_64.rpm` |
   | openSUSE | `hubless-<version>.x86_64.rpm` | `sudo zypper install ~/Downloads/hubless-*.x86_64.rpm` |
   | Anything else | `Hubless-<version>.AppImage` | see [AppImage](#appimage) below |

   Not sure which one you have? Run `cat /etc/os-release` in a terminal and look at the `NAME` line.

2. **Open Hubless** from your app launcher (or type `hubless` in a terminal).

3. **Plug in your mouse, keyboard or headset.** It shows up on the home screen within a few seconds. Click the
   settings button on its card to configure it. Wireless Logitech mice may say "Asleep": move the mouse to wake it.

That's it. The packages above also install a small system rule
(`/usr/lib/udev/rules.d/70-hubless.rules`) that lets your user talk to supported devices without root, so you never
have to run Hubless with `sudo`.

### AppImage

The AppImage runs without installing, on any distribution:

```sh
chmod +x ~/Downloads/Hubless-*.AppImage
~/Downloads/Hubless-*.AppImage
```

It needs FUSE 2: `sudo pacman -S fuse2` (Arch), `sudo apt install libfuse2t64` (Ubuntu 24.04+) or
`sudo apt install libfuse2` (older Ubuntu / Debian). On first start Hubless shows **“Allow Hubless to talk to your
devices”**: click the button and enter your password once. Unplug and replug the device afterwards if it doesn't show
up straight away.

### Updating

Hubless updates itself. When it starts (and every few hours while it runs) it checks GitHub for a new release and
downloads it in the background, verified against the release's checksums. Then:

- **AppImage:** the update is installed when you quit Hubless, or right away with **Restart to update**.
- **Arch, Ubuntu/Debian, Fedora/openSUSE packages:** press **Restart to update** in the banner or in ⚙ Settings →
  Updates. Your system asks for your password, as for any package update.

Your settings, device list, photos and backups are kept, and so are the settings stored in your devices. Turn
**Update automatically** off in ⚙ Settings if you'd rather update by hand: download the new release and install it the
same way as the first time.

### Uninstalling

`sudo pacman -R hubless`, `sudo apt remove hubless` or `sudo dnf remove hubless` (AppImage: delete the file). This
removes the app and its system rule. Your settings and device backups stay in your home folder until you delete them
in **⚙ Settings → Delete all Hubless data**, or by hand (see [PRIVACY.md](PRIVACY.md)). Settings saved inside your
devices stay on the devices.

### Troubleshooting

- **My device isn't listed.** Check [Supported devices](#supported-devices). Devices marked "support coming soon"
  are recognised but can't be configured yet. Otherwise unplug and replug it, and if it still doesn't appear,
  [open an issue](https://github.com/Ynnad242/hubless/issues) with the output of `lsusb`.
- **The “Allow Hubless” banner keeps coming back.** Log out and back in once, or press ⚙ Settings → Grant access again.
- **Changes don't stick.** Close other tools that talk to the same device (Solaar, Piper, OpenRazer's daemon,
  Wootility in a browser) while you use Hubless.
- **Something went wrong.** Every device page has *Restore a backup…*; a backup is made before the first change of
  every session.

## Supported devices

| Device | What works | Status |
|---|---|---|
| Logitech PRO X2 SUPERSTRIKE | HITS triggers (actuation, rapid trigger, haptics, live press depth), DPI stages, polling, buttons, 5 onboard profiles, backups | Tested on hardware |
| Other Logitech G mice with onboard profiles | DPI, polling, buttons, profiles (common G-series format) | Untested — a backup is made first |
| Wooting 60HE | Actuation, rapid trigger, Tachyon, per-key actuation and RT, live key travel, key mapping (3 layers), Mod-Tap / Toggle / Snap Tap, lighting, rename | Tested on hardware |
| Fractal Design Scape | Battery, EQ presets and custom EQ, EQ codes, noise cancelling, sidetone and its volume, lighting on/off | Tested on hardware |
| Endgame Gear OP1 8k (`3367:1964`) | DPI levels, polling up to 8 kHz, lift-off, angle snapping, motion sync, ripple control, click filters, debounce, buttons | Tested on hardware |

Hubless also recognises about 200 more mice (Razer, SteelSeries, ASUS, Glorious, Roccat, Endgame Gear and more) by
their USB id and shows them by name, marked "support coming soon". They can't be configured yet.

## What to expect

- **Settings live in the device.** Changes are saved into the device's onboard memory as you make them, so they keep
  working in games, on other computers and without Hubless running.
- **Backups first.** The device memory is backed up before the first change of every session, writes are read back
  and compared, and backups can be restored from the device page.
- **Use at your own risk.** Hubless writes to device memory using protocols worked out from public research and from
  testing on the devices listed above. That has worked reliably on the tested hardware, but it is not the
  manufacturers' software and comes without warranty (see LICENSE).
- **Keeps running in the tray** if you want it to (for low-battery warnings). This can be turned off in Settings.

## Privacy

Hubless has no accounts, analytics or telemetry. Its only network use is checking GitHub for new versions, which you can
turn off in Settings. Everything it stores is in your home folder and can be deleted from Settings. Details: [PRIVACY.md](PRIVACY.md).

## Build from source

You need Node.js 22+ and npm.

```sh
git clone https://github.com/Ynnad242/hubless.git && cd hubless
npm install
npx electron-vite build
npx electron-builder --linux pacman     # or AppImage, deb, rpm → dist/
```

Try it without hardware: `hubless --demo` (or `npx electron . --demo` from the source folder).

## Development

```sh
npm run dev                                   # app with hot reload
npx tsc --noEmit -p tsconfig.json             # typecheck
npx vitest run                                # unit tests (no hardware)
HUBLESS_HW=1 npx vitest run test/hardware.test.ts       # real Logitech mouse, restores memory afterwards
HUBLESS_HW=1 npx vitest run test/peripherals.test.ts    # real Wooting + Scape, restores afterwards
HUBLESS_SHOTS=docs/screenshots npx electron . --demo    # screenshots (after a build)
node tools/third-party-notices.mjs            # refresh THIRD_PARTY_NOTICES.md after dependency changes
```

Protocol notes: [docs/PROTOCOL.md](docs/PROTOCOL.md). The mouse catalog is generated by `tools/build-catalog.py`.

## Credits and legal

Protocol knowledge builds on Solaar, libratbag, OpenRazer, egctl, scapectl, Wooting protocol notes and the
SUPERSTRIKE research by kazehana99k and SuperStrike Studio; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for
those credits and the licenses of bundled libraries.

Hubless is not affiliated with, endorsed by or sponsored by Logitech, Razer, Wooting, Fractal Design, Endgame Gear or
any other manufacturer. Product names and brands belong to their owners and are used only to identify compatible
hardware. Product photos in `data/devices/` belong to and are credited to their manufacturers (Logitech, Wooting, Fractal
Design, Endgame Gear). They are not covered by the MIT license, are used only to show which hardware is supported, and
will be removed on request through an [issue](https://github.com/Ynnad242/hubless/issues).

Hubless is free and always will be. It is MIT licensed.
