# Privacy

Hubless runs entirely on your computer. It has no accounts, no analytics, no telemetry, no ads, no cookies and no
update checks. It never sends anything over the internet; the only network activity is when you click a link, which
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
| Start-on-login entry (only if you turn it on) | `~/.config/autostart/io.github.hubless.Hubless.desktop` | Start in the tray when you log in |

Your device settings themselves (DPI, buttons, lighting, EQ, …) are written into the devices' own memory, not to
your computer.

The installer also adds one system file, `/usr/lib/udev/rules.d/70-hubless.rules`, which lets the logged-in user talk
to supported mice, keyboards and headsets without root. It contains no personal data.

## Deleting your data

In the app: **Menu → Settings → Delete all Hubless data**. This removes everything in the table above, including
backups, and restarts Hubless as if it were freshly installed. Settings already written into your devices stay on
the devices; use each device's restore or reset options to change those.

By hand:

```sh
rm -rf ~/.config/hubless ~/.config/Hubless ~/.local/share/hubless ~/.config/autostart/io.github.hubless.Hubless.desktop
```

Uninstalling the package removes the udev rule.

## Children

Hubless collects no personal data from anyone, so it collects none from children either.

## Contact

Questions or concerns: open an issue at https://github.com/Ynnad242/hubless/issues.
