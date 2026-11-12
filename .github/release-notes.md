## What's new in 0.18.0

- **Updates install themselves.** Every time Hubless starts it checks for a new version. If there is one, it shows
  "Updating Hubless", installs it and reopens; if not, it just opens. No password needed: the packages include a small
  helper that only installs the verified latest Hubless release. Your settings and devices are kept.
- **Version and updates in ⚙ Settings**, with "Check now" and "Update now".
- **WLmouse Ying support** (on the cable): DPI stages, polling rate, lift-off distance, angle snapping, motion sync,
  ripple control and click debounce, with automatic backups.
- **[Supported devices page](https://github.com/Ynnad242/hubless/blob/main/DEVICES.md)** listing what works with each
  device.

Coming from 0.17.0 or older: install this version by hand once (below). From then on updates are automatic.

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
