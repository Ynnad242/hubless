## What's new in 0.20.1

- **Wooting Actuation page**: the key travel graphic is simpler and steadier. The text sits in a fixed panel instead
  of moving around, and the graphic stays on the last key you pressed. It now shows Pressed/Released exactly the way
  the keyboard decides it, Rapid Trigger included: a dashed line marks where the key will release or press again.
  Live travel is read about 3x more often, so quick taps show up.
- **Logitech HITS view**: a registered click now always fills the button to its actuation point. Before, a quick
  click could fire between two depth readings and the picture stopped short.

0.20.0 added mouse lighting, firmware updates where makers allow them, and sharper device photos.

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
