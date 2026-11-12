# PRO X2 SUPERSTRIKE: HID++ notes

Everything here was verified on a PRO X2 SUPERSTRIKE (wireless PID `0x40BD`, firmware MPM 42.00 build 0011,
LIGHTSPEED receiver `046d:c54d`) by reading the device, writing, and reading back. Where other projects
disagree, the reason is noted.

## Transport

- HID++ 2.0 (protocol 4.2) on the receiver's vendor interface (usage page `0xFF00`, report IDs `0x10`/`0x11`).
  Device index `1` through the receiver, `0xFF` over the cable.
- A sleeping mouse and an empty receiver slot give the same reply to a ping: HID++ 1.0 error `0x8F`, code
  `0x08`. To tell them apart, read the receiver's pairing register: short request
  `10 FF 83 B5 <0x20+slot>` returns the wireless PID at bytes 3-4, and `0x40+slot` returns the name.
- Waking from power-save can take more than 0.4 s for the first reply, so use at least 1.5 s for that request.

## Feature table (36 entries)

`0x0000` Root, `0x0001` FeatureSet, `0x0003` firmware, `0x0005` name, `0x1D4B` wireless status, `0x0020` config change,
`0x1004` unified battery, `0x2250`/`0x2251` motion/wheel stats, `0x2202` extended DPI, `0x8090` mode status,
`0x80E0` (unknown), `0x1B0C` **HITS analog buttons**, `0x8061` extended report rate, `0x8100` onboard profiles,
`0x8110` button spy, `0x1500`, `0x1602` (unknown), and 18 hidden/engineering features (DFU, GPIO, RF test,
…) that a configuration tool must never touch.

## HITS: feature `0x1B0C`

| fn | request | reply |
|---|---|---|
| 0 | — | `00 03 28 14 14 01`: 3 buttons (only 0=left, 1=right can be set), max actuation 10, max rapid trigger 5, max haptics 5 (each `<<2`) |
| 1 set | `btn act rt hap` | echo |
| 2 get | `btn` | `btn act rt hap` |

Each value is the logical level shifted left by two. **Bit 0 of the rapid-trigger byte is rapid trigger
on/off**: setting it is accepted and reads back, and G HUB HITS codes carry a separate on/off digit
per button that maps onto it. (Solaar treats the bit as a firmware flag to preserve, which is why rapid trigger
can't be switched on there.) Values as low as actuation 1, rapid trigger 1 and haptics 0 are accepted.

Changes made with fn 1 apply immediately but are **not** stored. The stored values live in the profile
(offset `0x26`). Writing the active profile applies them immediately too.

G HUB "HITS code": base64 of 16 ASCII digits, `00` + actuation L, R (2 digits each) + rapid-trigger level
L, R + rapid-trigger on L, R (1 digit each) + haptics L, R.

## Onboard profiles: feature `0x8100`

`fn0` info `01 08 01 05 01 05 10 00 FF …`: memory model 1, **format 8**, 5 profiles, 5 buttons, 255-byte sectors.
`fn1`/`fn2` set/get mode (1 onboard, 2 host), `fn3`/`fn4` set/get current profile, `fn5` read 16 bytes at
`[sector, offset]` (the last read of a 255-byte sector must start at 239), `fn6` begin write `[sector, 0, len]`,
`fn7` write 16 bytes, `fn8` commit, `fn11`/`fn12` get/set current DPI stage.

- Sector `0x0000`: profile table `[sector_hi, sector_lo, enabled, 0xFF]` × n, ending with `FFFF`.
- Sectors `0x0001`–`0x0005`: profiles.
- ROM `0x0100`: factory table. ROM `0x0101`: factory profile, byte-identical to an untouched profile except the CRC.
- CRC-16/CCITT-FALSE over `sector[0:253]`, big-endian in the last two bytes.

Writing the active profile takes effect immediately. A profile switch is not needed.

### Format 8 profile layout

| Offset | Size | Field |
|---|---|---|
| `0x00` | 1 | wireless report rate, Hz = 125 << n |
| `0x01` | 1 | wired report rate |
| `0x02` | 1 | starting DPI stage |
| `0x03` | 1 | DPI-shift stage |
| `0x04` | 5×5 | DPI stages `[X lo, X hi, Y lo, Y hi, lift-off]`, X = 0 means off |
| `0x22` | 1 | angle snapping |
| `0x25` | 1 | scroll filter (`FF` = off) |
| `0x26` | 3 | HITS left `[act, rt\|on, hap]` |
| `0x29` | 3 | HITS right |
| `0x2C` | 2 | sleep after (s, LE) |
| `0x2E` | 2 | power off after (s, LE) |
| `0x30` | 16×4 | button actions |
| `0x70` | 12×4 | DPI-shift layer actions |
| `0xA0` | 48 | name, UTF-16LE (`FF…` = unnamed) |
| `0xD0` | 45 | unknown, preserved |
| `0xFD` | 2 | CRC |

Some other tools' docs describe DPI as 16-bit words starting at byte 3, which overlaps the entries
above. Edits made that way read back fine but never change the sensor.

### Button actions (4 bytes)

`80 01 hi lo` mouse-button mask · `80 02 mods key` keyboard (HID usage) · `80 03 hi lo` consumer usage ·
`90 fn FF 00` function (3 next DPI, 4 previous, 5 cycle, 7 DPI shift, 8/9/10 profile next/prev/cycle, 12
battery) · `80 00 FF FF` disabled · `FF FF FF FF` default.

## DPI list: `0x2202` fn 2

Paged, 13 bytes per page starting at reply byte 3, big-endian words: a plain value, or `0xE000|step`
followed by the end of a range. On this sensor: 100 (+1) 200 (+2) 500 (+5) 1000 (+10) 2000 (+20) 5000 (+50)
10000 (+100) 20000 (+125) 32000 (+200) 44000.

## Report rate: `0x8061`

`fn1` supported mask (`0x7F`: 125 Hz to 8000 Hz). In onboard mode the `fn3` live setter is rejected with
INVALID_ARGUMENT and the `fn2` getter keeps returning the old index. The rate that counts is profile byte
`0x00`. Writing it to the active profile takes effect at once, which was measured at 500, 1000 and 2000 Hz
from input-report timing. The mouse only reports while it moves, so any measurement needs fast, continuous
motion.

# Endgame Gear OP1 8k (USB `3367:1964`, firmware 1.24)

Wired only. Interface 1, usage page `0xFF01`: feature report `0xA1` (commands, 63 bytes) and `0xA0` (config write,
1040 bytes). Every command is a 64-byte feature report `[op lo, op hi, 0…]`; wait ~80 ms, then read feature report
`0xA1` (retry up to 5× until the answer is plausible).

| op | meaning |
|---|---|
| `a1 02` | firmware: reply byte 17 = minor (hex digits), 18 = major → `1.24`; bytes 20–23 = VID/PID |
| `a1 12` | read config: reply is the 1040-byte block (byte 0 = `a1`, byte 1 = status `01`) |
| `a0 11` + block | write config: send the whole block as report `0xA0` (bytes 2.. = config). No checksum. Applies at once. |
| `a1 13` | factory reset (from egctl, not used by Hubless) |

Config block (offsets from the report id byte):

| off | size | meaning |
|---|---|---|
| 21 | 1 | polling divider of 8 kHz: 1 = 8000, 2 = 4000, 4 = 2000, 8 = 1000 |
| 22 | 1 | filters: `0x01` slam-click, `0x10` jitter |
| 25 | 1 | lift-off distance, 1 or 2 mm |
| 26 / 27 / 28 | 1 | angle snapping / ripple control / motion sync |
| 29 | 1 | unknown (`02`), kept |
| 30 | 1 | active DPI levels, 1..4 |
| 31 | 4×5 | DPI LED colours `[r, g, b, on, level n]` (yellow, blue, red, green) |
| 51 | 4×5 | DPI levels `[split, x LE16, y LE16]`, 50..26000 step 50 |
| 71 | 8×7 | buttons `[type, value×5, debounce ms]`: left, right, middle, forward, back, DPI button, wheel up, wheel down |

Button types: `00` mouse (value = HID button bit 1/2/4/8 back/16 forward), `01` scroll (`01` up, `ff` down), `02` key
`[modifiers, usage]`, `09` DPI cycle (value `f1`), `0c` fixed DPI `[split, x, y]`, `20` consumer usage (8-bit),
`ff` disabled. The OP1 8k v2 (`3367:1978`, per egctl) keeps offsets 21–70 but its button table starts at 77 with
the debounce byte first, so Hubless does not claim the v2 until it is checked on hardware.

# WLmouse Ying (USB `36a7:a875` on the cable, firmware 2.18)

Config goes over **interface 2** (usage page `0xFFFF`, 64-byte feature report, no report id). Interface 1 also has a
`0xFFFF` collection (report 5) that only echoes requests back.

Request (feature report 0, 64 bytes): `00 00 target len page cmd args…` with target `02` = the mouse (`00` = a
receiver). The answer comes back in the same report: `status 00 target len page cmd payload…`, status `a1` ok, `a2`
unsupported, `a0`/`a3` busy (ask again). Reads set bit 7 of the command; the write is the same command without it and
takes exactly the payload the read returns, `[profile, values…]`. Active profile: page 0 cmd `85` → `[profile]`.

| Setting | Page | Read | Payload |
|---|---|---|---|
| Firmware | 0 | `81` (len 0x10) | `01 00 major minor pid_hi pid_lo` (2.18, `a875`) |
| DPI stages | 1 | `81` args `[profile, 6]` | `[profile, count, (x BE16, y BE16) × count]`, 50–30000 step 50, up to 6 |
| Active stage | 1 | `82` | `[profile, stage 1-based]` |
| Polling | 1 | `80` | `08` 125, `04` 250, `02` 500, `01`/`10` 1000, `20` 2000, `40` 4000, `80` 8000 |
| Angle snapping | 1 | `84` | 0/1 |
| Lift-off | 1 | `88` | `87` 0.7 mm, `01` 1 mm, `02` 2 mm |
| Motion sync | 1 | `89` | 0/1 |
| Ripple control | 1 | `8a` | 0/1 |
| Debounce | 0 | `88` | ms, 0–15 |

Checked on hardware: every write above reads back as written, and a backup (the read payloads) restores byte for byte.
On the cable the Ying answers `a2` (unsupported) to 2000/4000/8000 Hz; those rates are presumably for its wireless 8K
receiver (`36a7:a874`), which Hubless doesn't claim yet.
