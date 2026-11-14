## What's new in 0.20.0

- **Mouse lighting**: a new Lighting page for mice with RGB lights. Pick off, a fixed colour, breathing or colour
  cycle per zone (logo, scroll wheel, sides), with brightness and speed, or use one setting on all zones. Works on
  Logitech G mice with onboard memory (saved to the mouse) and 53 Razer models. Not yet tested on real RGB hardware.
- **Firmware updates where the maker allows them**: Device settings now shows the firmware version. Devices whose
  maker publishes firmware for Linux (through fwupd and the Linux Vendor Firmware Service) can be updated from
  Hubless, with a backup of your mouse settings first. Wooting keyboards hand over to Wootility. For makers that only
  release firmware through their own Windows/macOS app, Hubless says which app you need. Hubless never writes firmware
  itself.
- **Sharper device photos**: 29 devices now ship with crisp transparent photos, no download needed.
- `hubless --demo` now includes a simulated G502 HERO and Basilisk V3 Pro to try the lighting page.

Full list: [supported devices](https://github.com/Ynnad242/hubless/blob/main/DEVICES.md). Installed 0.18.0 or later?
This update installs itself the next time you open Hubless.

## Install

Download the file for your Linux below, then:

| Your Linux | File | Command |
|---|---|---|
| Arch, Manjaro, EndeavourOS, CachyOS, Omarchy | `hubless-*.pacman` | `sudo pacman -U ~/Downloads/hubless-*.pacman` |
| Ubuntu, Debian, Mint, Pop!_OS | `hubless_*_amd64.deb` | `sudo apt install ~/Downloads/hubless_*_amd64.deb` |
| Fedora, Nobara, RHEL | `hubless-*.x86_64.rpm` | `sudo dnf install ~/Downloads/hubless-*.x86_64.rpm` |
| openSUSE | `hubless-*.x86_64.rpm` | `sudo zypper install ~/Downloads/hubless-*.x86_64.rpm` |
| Anything else | `Hubless-*.AppImage` | `chmod +x Hubless-*.AppImage` and run it (needs FUSE 2) |

Then open Hubless from your app launcher and plug in your device. Full guide, supported devices and troubleshooting:
see the [README](https://github.com/Ynnad242/hubless#download-and-install).

Hubless is free, has no accounts or telemetry, and is not affiliated with any device manufacturer.
