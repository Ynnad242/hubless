#!/bin/bash
rm -f '/usr/bin/hubless' /usr/lib/udev/rules.d/70-hubless.rules
udevadm control --reload-rules || true
