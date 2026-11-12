## What's new in 0.19.0

- **Razer mice** (74 models, wired and HyperSpeed wireless: Viper, DeathAdder, Basilisk, Cobra, Naga and more): DPI
  stages, polling rate up to 8000 Hz on 8K models, and battery level. Built from OpenRazer's protocol notes and tested
  against a simulated mouse, not yet on real hardware, so they're marked untested. Hubless checks every reply before
  writing anything, reads every change back and makes a backup first.
- **Copy device report**: a read-only report for GitHub issues (Device settings, or a card's ⋯ menu), so owners can
  help confirm untested devices. No serial numbers or personal data, and nothing is sent to the device.
- `hubless --demo` now includes a simulated Razer Viper V3 Pro.

Full list: [supported devices](https://github.com/Ynnad242/hubless/blob/main/DEVICES.md). Installed 0.18.0? This
update installs itself the next time you open Hubless.

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
