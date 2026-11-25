## What's new in 0.21.0

Hubless now does more than mice and Wooting keyboards:

- **Webcams.** Any USB webcam: brightness, contrast, focus, exposure, white balance, zoom and the rest, with a live
  preview. Settings are kept per camera and put back when you plug it in again or another app changes them. Photos
  for popular Logitech and Razer webcams.
- **Logitech G headsets** (G733, G535, PRO X Wireless and others): sidetone, equalizer, battery and auto power-off.
- **Logitech G keyboards** (G915, G815, G515, PRO X TKL and others): backlight brightness, battery and game mode
  (lock the Windows key and others).
- **Razer keyboards**, 61 models (BlackWidow, Huntsman, Ornata, DeathStalker, Cynosa, Joro): lighting effect and
  colour, brightness and game mode.
- **SteelSeries Arctis Nova 7** (all versions), **Arctis 7 / Pro** and **HyperX Cloud Alpha Wireless**: battery,
  sidetone, auto power-off, and a 10-band EQ on the Nova 7.

Webcams were tested on real hardware. The headsets and keyboards follow the protocols documented by Solaar,
OpenRazer and HeadsetControl but haven't been tried on every model yet: if something doesn't work on yours, use
**report a problem** in Hubless's settings and it'll get fixed.

Webcam controls need `v4l-utils`; the packages install it for you.

Full list: [supported devices](https://github.com/Ynnad242/hubless/blob/main/DEVICES.md). Installed 0.18.0 or later?
This update installs itself the next time you open Hubless. Headsets and SteelSeries devices need the new device
access rule, which the update installs.

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
