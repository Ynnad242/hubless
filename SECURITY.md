# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue:
**[Report a vulnerability](https://github.com/Ynnad242/hubless/security/advisories/new)** (GitHub private reporting).
Include what you found, how to reproduce it and the Hubless version (⚙ Settings → About Hubless). You'll get a reply as soon as
possible, and a fix will be released before details are made public.

## How Hubless is built to be safe

- **No data leaves the computer.** Hubless has no server, accounts or telemetry. Its only network traffic is the update
  check against this repository's GitHub releases (can be turned off).
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
- **Verified updates.** Updates come over HTTPS from this repository's releases and are checked against the SHA-512
  checksums in the release's `latest-linux.yml` before anything is installed. Prereleases and downgrades are ignored.
  Package installs use a root-owned helper, `/usr/lib/hubless/hubless-update`, that the logged-in user (active local
  session only) may run through pkexec without a password, via the polkit action `io.github.hubless.update`. The
  helper takes no options: it copies the given file into a root-owned folder, downloads `latest-linux.yml` from GitHub
  itself over HTTPS, and installs the copy only if its SHA-512 matches the latest release's package. Anything else is
  refused, so the rule can't be used to install other software or older versions.
- **Supply chain.** Releases are built by GitHub Actions from the tagged source with `npm ci` (locked versions), and
  actions are pinned to exact commits. Dependabot watches dependencies weekly.

## Supported versions

Only the latest release gets security fixes.
