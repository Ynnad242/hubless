#!/bin/bash
# Runs on upgrades too (rpm passes 1, deb passes "upgrade"); only clean up when Hubless is really removed, or an upgrade
# would delete the files the new version just installed.
case "${1:-}" in 1 | upgrade | failed-upgrade) exit 0 ;; esac
rm -f '/usr/bin/hubless' /usr/lib/udev/rules.d/70-hubless.rules \
  /usr/lib/hubless/hubless-update /usr/share/polkit-1/actions/io.github.hubless.update.policy
rmdir /usr/lib/hubless 2>/dev/null || true
udevadm control --reload-rules || true
