## Device data and protocol research

Hubless contains no code from the projects below. It uses facts they published (USB ids, model names, maximum DPI,
protocol layouts), which Hubless then checked against real hardware wherever possible.

- **libratbag** — device list (names, USB ids, protocol family, DPI ranges) in `data/mice.json`.
  https://github.com/libratbag/libratbag — MIT License:

  > Copyright © 2015-2017 Red Hat, Inc.
  > Copyright © 2015 David Herrmann <dh.herrmann@gmail.com>
  >
  > Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
  > documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
  > rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
  > permit persons to whom the Software is furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice (including the next paragraph) shall be included in all
  > copies or substantial portions of the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
  > WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
  > COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  > OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

- **OpenRazer** (GPL-2.0-or-later) — Razer model names, USB ids and maximum DPI in `data/mice.json`, and the Razer
  protocol facts in `data/razer.json` (report layout, command ids, per-model transaction ids and polling command),
  extracted by `tools/extract-razer.py`. Hubless's Razer driver is its own code.
  https://github.com/openrazer/openrazer
- **Solaar** (GPL-2.0) and **libratbag** — Logitech HID++ background. https://github.com/pwr-Solaar/Solaar
- **egctl** (AGPL-3.0-or-later) — Endgame Gear OP1 8k v2 config offsets, used as a reference for the OP1 8k layout.
  https://github.com/Creationsss/egctl
- **OpenMouse mouse-protocol** (AGPL-3.0) — WLmouse / CompX feature-report commands (page, command and payload
  formats), used as a reference for the WLmouse Ying driver, which is Hubless's own code.
  https://github.com/OpenMouse-Project/openmouse
- **scapectl** (GPL) — Fractal Scape command overview. Fractal Design's own Adjust web app — EQ write format.
- **Wooting protocol notes** by eng1n88r (MIT) — Wooting 60HE configuration protocol.
- **SUPERSTRIKE research** by kazehana99k and SuperStrike Studio — HITS trigger commands.
- **prosettings.net** — pro-player usage ranking used to mark popular mice (November 2026).

## Trademarks and product photos

Hubless is an independent project. It is not affiliated with, endorsed by or sponsored by Logitech, Razer, Wooting,
Fractal Design, Endgame Gear, WLmouse or any other manufacturer named in it. All product names, logos and brands are the
property of their respective owners and are used only to identify compatible hardware.

The product photos in `data/devices/` show hardware made by those manufacturers. They remain the property of their
owners and are not covered by Hubless's MIT license; they are credited to those companies and used only to show
which hardware is supported. Hubless is free and will never be sold. If you own one of these images and want it
removed, open an issue at https://github.com/Ynnad242/hubless/issues and it will be taken out.
