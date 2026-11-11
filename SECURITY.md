# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue:
**[Report a vulnerability](https://github.com/Ynnad242/hubless/security/advisories/new)** (GitHub private reporting).
Include what you found, how to reproduce it and the Hubless version (Menu → About). You'll get a reply as soon as
possible, and a fix will be released before details are made public.

## How Hubless is built to be safe

- **No network.** Hubless has no server, accounts, telemetry or update checks, and never sends data anywhere.
- **No root at runtime.** Device access comes from a udev rule with `TAG+="uaccess"`, which grants only the user logged
  in at the computer (not every user, not remote sessions). Root is used once, through the system password prompt,
  to install that rule.
- **Locked-down window.** The interface runs sandboxed with context isolation, no Node.js access, a strict Content
  Security Policy, no navigation away from the app, no web permissions, and links open only if they are `https://`.
- **Checked calls.** The interface can only call a fixed list of functions in the main process, only from the app's
  own page; arguments are validated (settings keys and types, backup files must be in the device's backup folder).
- **Safe device writes.** Device memory is backed up before the first change of every session, and writes are read
  back and compared.
- **Hardened binary.** Electron fuses disable "run as Node", `--inspect` and `NODE_OPTIONS` in released builds;
  DevTools and the reload shortcuts are off.
- **Supply chain.** Releases are built by GitHub Actions from the tagged source with `npm ci` (locked versions), and
  actions are pinned to exact commits. Dependabot watches dependencies weekly.

## Supported versions

Only the latest release gets security fixes.
