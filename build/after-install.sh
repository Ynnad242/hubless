#!/bin/bash
# Command on the PATH
ln -sf '/opt/Hubless/hubless' '/usr/bin/hubless'
chmod 4755 '/opt/Hubless/chrome-sandbox' || true
# Let the logged-in user talk to supported peripherals (no root needed at runtime)
cat > /usr/lib/udev/rules.d/70-hubless.rules <<'RULES'
# hubless: let the logged-in user configure their mice, keyboards and headsets
# Logitech
KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="046d", TAG+="uaccess"
# Wooting
KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31e3", TAG+="uaccess"
# Fractal Design
KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="36bc", TAG+="uaccess"
# Razer
KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", TAG+="uaccess"
# Endgame Gear
KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="3367", TAG+="uaccess"
RULES
# An older, broken copy of the rule may have been installed by the app itself.
rm -f /etc/udev/rules.d/70-hubless.rules
udevadm control --reload-rules || true
udevadm trigger --action=add --subsystem-match=hidraw || true
update-desktop-database /usr/share/applications 2>/dev/null || true
