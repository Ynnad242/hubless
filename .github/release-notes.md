## What's new in 0.20.2

- **Fixed: updates failing with "pkexec must be setuid root"**. After Hubless restarted itself into a new version,
  the next update couldn't install. Hubless now restarts in a way that keeps updates working. If you see that
  message, quit Hubless (tray icon → Quit) and open it again: it then installs the update straight away.

0.20.1 cleaned up the Wooting key travel graphic (Rapid Trigger shown the way the keyboard decides it) and fixed the
HITS view stopping short on quick clicks. 0.20.0 added mouse lighting, firmware updates and sharper device photos.

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
