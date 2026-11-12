# Privacy

Hubless runs entirely on your computer. It has no accounts, no analytics, no telemetry, no ads and no cookies. It never
sends your data anywhere. It goes online for one thing only: checking GitHub for a new version (see below). Otherwise the only network activity is when you click a link, which
opens in your own browser.

## What Hubless stores, and where

Everything stays in your home folder:

| What | Where | Why |
|---|---|---|
| App settings (tray, start on login, battery warning) | `~/.config/hubless/settings.json` | Remember your choices |
| Devices seen before (name, model, serial number) | `~/.config/hubless/devices.json` | Show unplugged devices on the home screen |
| Photos you picked for your devices | `~/.config/hubless/images/` | Show your own picture on the device card |
| Backups of your devices' memory | `~/.local/share/hubless/backups/` | Undo changes; made before the first change of every session |
| The app window's own browser-engine data (cache, window state) | `~/.config/Hubless/` | Electron/Chromium keeps this for the user interface |
| Downloaded updates waiting to be installed | `~/.cache/hubless-updater/` | Install the next version |
| Start-on-login entry (only if you turn it on) | `~/.config/autostart/io.github.hubless.Hubless.desktop` | Start in the tray when you log in |

Your device settings themselves (DPI, buttons, lighting, EQ, …) are written into the devices' own memory, not to
your computer.

The installer also adds three system files, none with personal data: `/usr/lib/udev/rules.d/70-hubless.rules`, which
lets the logged-in user talk to supported mice, keyboards and headsets without root, and the update helper
`/usr/lib/hubless/hubless-update` with its polkit rule `/usr/share/polkit-1/actions/io.github.hubless.update.policy`,
which let Hubless install its own updates without a password.

## Update checks

With **Update automatically** on (the default; ⚙ Settings → Updates), Hubless asks GitHub whether a newer release of
Hubless exists when it starts and every six hours while it runs, and downloads and installs it if so. The update
helper asks GitHub once more for the release's checksums before it installs anything. These requests go to
`github.com` / `api.github.com` (and GitHub's download servers) and contain nothing about you or your devices: like any
web request they reveal your IP address, and they say which Hubless version is asking. GitHub's own privacy policy
applies to them. Turn the switch off and Hubless makes no network requests at all; you can still press **Check now**
whenever you like.

Downloaded updates are kept in `~/.cache/hubless-updater/` until they are installed.

## Deleting your data

In the app: **⚙ Settings → Delete all Hubless data**. This removes everything in the table above, including
backups, and restarts Hubless as if it were freshly installed. Settings already written into your devices stay on
the devices; use each device's restore or reset options to change those.

By hand:

```sh
rm -rf ~/.config/hubless ~/.config/Hubless ~/.local/share/hubless ~/.cache/hubless-updater ~/.config/autostart/io.github.hubless.Hubless.desktop
```

Uninstalling the package removes the udev rule, the update helper and its polkit rule.

## Children

Hubless collects no personal data from anyone, so it collects none from children either.

## Contact

Questions or concerns: open an issue at https://github.com/Ynnad242/hubless/issues.
