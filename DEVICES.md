# Supported devices

This page lists what Hubless can do with each device. It's generated from the same device list the app uses
(`data/mice.json`), so it's always current for the newest release.

- **✅ Works:** tested on real hardware. Every setting listed can be changed and is saved into the device.
- **🧪 Should work:** uses a protocol Hubless supports, but nobody has tested this exact model yet. A backup of the device
  memory is made before the first change.
- **🔜 Recognised, support coming soon:** Hubless shows the device by name, but can't change its settings yet.

Don't see your device, or it doesn't show up? [Open an issue](https://github.com/Ynnad242/hubless/issues/new) with the
device name and the output of `lsusb`. Devices people ask for get supported first.

## ✅ Works

| Device | Type | USB id | What you can change |
|---|---|---|---|
| **Logitech PRO X2 SUPERSTRIKE** | Mouse | `046d:40bd` (LIGHTSPEED receiver) | HITS triggers (actuation, rapid trigger, haptics, live press depth), DPI stages, polling rate, buttons, 5 onboard profiles, backups |
| **Endgame Gear OP1 8k** | Mouse | `3367:1964` | DPI levels, polling up to 8 kHz, lift-off distance, angle snapping, motion sync, ripple control, click filters, debounce, buttons, backups |
| **WLmouse Ying** | Mouse | `36a7:a875` (USB cable) | Up to 6 DPI stages (50–30,000), polling 125–1000 Hz on the cable, lift-off 0.7 / 1 / 2 mm, angle snapping, motion sync, ripple control, click debounce, backups. Not yet: button remapping, the wireless receiver |
| **Wooting 60HE** | Keyboard | `31e3:1312` | Actuation, rapid trigger, Tachyon mode, per-key actuation and rapid trigger, live key travel, key mapping (3 layers), Mod-Tap / Toggle / Snap Tap, lighting, rename |
| **Fractal Design Scape** | Headset | `36bc:0001` (dongle) | Battery, EQ presets and custom EQ, EQ codes, noise cancelling, sidetone and its volume, lighting on/off |

## 🧪 Should work

### Logitech

Logitech G mice that use HID++ 2.0 (52 models), wired or through their LIGHTSPEED receiver: **DPI, polling rate,
buttons and onboard profiles**. The PRO X2 SUPERSTRIKE's trigger settings are specific to that mouse.

<details><summary>52 Logitech mice · including G Pro Wireless, G Pro X Wireless Superlight, G502 Hero, G502 X</summary>

| Model | Max DPI | USB ids |
|---|---|---|
| G Pro Wireless ⭐ | — | `046d:4079`, `046d:c088` |
| G Pro X Wireless Superlight ⭐ | — | `046d:4093`, `046d:c094` |
| G502 Hero ⭐ | — | `046d:c08b` |
| G502 X ⭐ | — | `046d:c099` |
| G703 Hero ⭐ | — | `046d:4086`, `046d:c090` |
| Gaming Mouse G102/G103/G203 ⭐ | — | `046d:c084`, `046d:c092`, `046d:c09d` |
| Gaming Mouse G305 ⭐ | — | `046d:4074` |
| G303 Shroud Edition | — | `046d:c097` |
| G402 Gaming Mouse | — | `046d:c07e` |
| G403 | — | `046d:c083` |
| G403 Hero | — | `046d:c08f` |
| G403 Wireless | — | `046d:405d`, `046d:c082` |
| G502 Hero Wireless | — | `046d:407f`, `046d:c08d` |
| G502 Proteus Core | — | `046d:c07d` |
| G502 Proteus Spectrum | — | `046d:c332` |
| G502 X PLUS | — | `046d:4099`, `046d:c095` |
| G502 X Wireless | — | `046d:c098`, `046d:409f` |
| G602 | — | `046d:402c` |
| G603 | — | `046d:406c`, `046d:b01c` bluetooth |
| G604 | — | `046d:4085`, `046d:b024` bluetooth |
| G635 | — | `046d:0a89` |
| G703 | — | `046d:c087`, `046d:4070` |
| G705 | — | `046d:c096`, `046d:409d`, `046d:b02e` bluetooth |
| G733 Gaming Headset | — | `046d:0ab5`, `046d:0afe` |
| G900 | — | `046d:c081`, `046d:4053` |
| G903 | — | `046d:c086`, `046d:4067` |
| G903 Hero | — | `046d:c091`, `046d:4087` |
| Gaming Mouse G Pro | — | `046d:c085`, `046d:c08c` |
| Gaming Mouse G302 | — | `046d:c07f` |
| Gaming Mouse G303 | — | `046d:c080` |
| M325 | — | `046d:400a` |
| M500s | — | `046d:c093` |
| M545 | — | `046d:4052` |
| M585/M590 | — | `046d:406b`, `046d:b01b` bluetooth |
| M720 | — | `046d:405e`, `046d:b015` bluetooth |
| Marathon M705 | — | `046d:406d` |
| MX Anywhere 2 | — | `046d:404a`, `046d:4072`, `046d:4063`, `046d:b013` bluetooth, `046d:b018` bluetooth, `046d:b01f` bluetooth |
| MX Anywhere 2S | — | `046d:b01a` bluetooth, `046d:406a` |
| MX Anywhere 3 | — | `046d:b025` bluetooth, `046d:4090` |
| MX Anywhere 3B | — | `046d:b02d` bluetooth |
| MX Anywhere 3S | — | `046d:b037` bluetooth |
| MX Ergo | — | `046d:b01d` bluetooth, `046d:406f` |
| MX Master | — | `046d:4041`, `046d:b012` bluetooth, `046d:4060`, `046d:b017` bluetooth, `046d:b01e` bluetooth, `046d:4071` |
| MX Master 2S | — | `046d:b019` bluetooth, `046d:4069` |
| MX Master 3 | — | `046d:b023` bluetooth, `046d:4082` |
| MX Master 3S | — | `046d:b034` bluetooth |
| MX Master 3S for Business | — | `046d:b035` bluetooth |
| MX Master 4 | — | `046d:b042` bluetooth |
| MX Vertical | — | `046d:b020` bluetooth, `046d:407b`, `046d:c08a`, `046d:c077` |
| MX518 | — | `046d:c08e` |
| T650 | — | `046d:4101` |
| Wireless Touchpad | — | `046d:4011` |

</details>

If you try one of these, please [report how it went](https://github.com/Ynnad242/hubless/issues/new), good or bad.

### Razer

74 Razer mice, wired or through their HyperSpeed receiver: **DPI stages (or DPI on older models), polling
rate (up to 8000 Hz on 8K models) and battery level**. Built from OpenRazer's protocol notes and tested against a
simulated mouse; not yet on real hardware. Hubless reads everything first, changes nothing if the mouse answers
unexpectedly, and reads every change back.

<details><summary>74 Razer mice · including Basilisk V3, Basilisk V3 Pro, Cobra Pro, DeathAdder V3</summary>

| Model | Max DPI | DPI stages | Polling up to | USB ids |
|---|---|---|---|---|
| Basilisk V3 ⭐ | 26,000 | yes | 1000 Hz | `1532:0099` |
| Basilisk V3 Pro ⭐ | 30,000 | yes | 1000 Hz | `1532:00aa` wired, `1532:00ab` wireless |
| Cobra Pro ⭐ | 30,000 | yes | 1000 Hz | `1532:00af` wired, `1532:00b0` wireless |
| DeathAdder V3 ⭐ | 30,000 | yes | 8000 Hz | `1532:00b2` |
| DeathAdder V3 Pro ⭐ | 35,000 | yes | 1000 Hz | `1532:00b6` wired, `1532:00b7` wireless, `1532:00c2` wired, `1532:00c3` wireless |
| DeathAdder V4 Pro ⭐ | 45,000 | yes | 8000 Hz | `1532:00be` wired, `1532:00bf` wireless |
| Orochi V2 ⭐ | 18,000 | yes | 1000 Hz | `1532:0094` wireless, `1532:0095` bluetooth |
| Viper Mini ⭐ | 8,500 | yes | 1000 Hz | `1532:008a` |
| Viper V2 Pro ⭐ | 30,000 | yes | 1000 Hz | `1532:00a5` wired, `1532:00a6` wireless |
| Viper V3 Pro ⭐ | 35,000 | yes | 8000 Hz | `1532:00c0` wired, `1532:00c1` wireless |
|  | 20,000 | one DPI | 1000 Hz | `1532:0088` |
| Abyssus 2000 | 2,000 | one DPI | 1000 Hz | `1532:005e` |
| Abyssus Elite (D.Va Edition) | 7,200 | one DPI | 1000 Hz | `1532:006a` |
| Abyssus Essential | 7,200 | one DPI | 1000 Hz | `1532:006b` |
| Abyssus V2 | 5,000 | one DPI | 1000 Hz | `1532:005b` |
| Atheris | 7,200 | yes | 1000 Hz | `1532:0062` wireless |
| Basilisk | 16,000 | one DPI | 1000 Hz | `1532:0064` |
| Basilisk Essential | 6,400 | yes | 1000 Hz | `1532:0065` |
| Basilisk Mobile | 18,000 | yes | 1000 Hz | `1532:00d3` wired, `1532:00d4` wireless |
| Basilisk Ultimate | 20,000 | one DPI | 1000 Hz | `1532:0086` |
| Basilisk V2 | 20,000 | one DPI | 1000 Hz | `1532:0085` |
| Basilisk V3 35K | 35,000 | yes | 1000 Hz | `1532:00cb` |
| Basilisk V3 Pro 35K | 35,000 | yes | 1000 Hz | `1532:00cc` wired, `1532:00cd` wireless |
| Basilisk V3 Pro 35K Phantom Green Edition | 35,000 | yes | 1000 Hz | `1532:00d6` wired, `1532:00d7` wireless |
| Basilisk V3 X HyperSpeed | 18,000 | yes | 1000 Hz | `1532:00b9` |
| Basilisk X HyperSpeed | 16,000 | yes | 1000 Hz | `1532:0083` |
| Cobra | 8,500 | yes | 1000 Hz | `1532:00a3` |
| Cobra HyperSpeed | 26,000 | yes | 1000 Hz | `1532:00da`, `1532:00db` wireless |
| DeathAdder 2000 | 2,000 | one DPI | 1000 Hz | `1532:004f` |
| DeathAdder 3500 | 3,500 | one DPI | 1000 Hz | `1532:0054` |
| DeathAdder Chroma | 10,000 | one DPI | 1000 Hz | `1532:0043` |
| DeathAdder Elite | 16,000 | one DPI | 1000 Hz | `1532:005c` |
| DeathAdder Essential | 6,400 | one DPI | 1000 Hz | `1532:006e` |
| DeathAdder Essential (2021) | 6,400 | one DPI | 1000 Hz | `1532:0098` |
| DeathAdder Essential (White Edition) | 6,400 | one DPI | 1000 Hz | `1532:0071` |
| DeathAdder V2 | 20,000 | one DPI | 1000 Hz | `1532:0084` |
| DeathAdder V2 Lite | 8,500 | yes | 1000 Hz | `1532:00a1` |
| DeathAdder V2 Mini | 8,500 | yes | 1000 Hz | `1532:008c` |
| DeathAdder V2 Pro | 20,000 | yes | 1000 Hz | `1532:007c` wired, `1532:007d` wireless |
| DeathAdder V2 X HyperSpeed | 14,000 | yes | 1000 Hz | `1532:009c` |
| DeathAdder V3 HyperSpeed | 26,000 | yes | 1000 Hz | `1532:00c4` wired, `1532:00c5` wireless |
| HyperPolling Wireless | 30,000 | yes | 8000 Hz | `1532:00b3` wireless |
| Imperator 2012 | 6,400 | one DPI | 1000 Hz | `1532:002f` |
| Lancehead | 16,000 | yes | 1000 Hz | `1532:0059` wired, `1532:005a` wireless |
| Lancehead Tournament Edition | 16,000 | yes | 1000 Hz | `1532:0060` |
| Lancehead Wireless | 16,000 | yes | 1000 Hz | `1532:0070` wired, `1532:006f` wireless |
| Mamba 2012 | 6,400 | one DPI | 1000 Hz | `1532:0025` wireless, `1532:0024` wired |
| Mamba Chroma | 16,000 | one DPI | 1000 Hz | `1532:0045` wireless, `1532:0044` wired |
| Mamba Elite | 16,000 | one DPI | 1000 Hz | `1532:006c` |
| Mamba Wireless | 16,000 | one DPI | 1000 Hz | `1532:0073` wired, `1532:0072` wireless |
| Naga 2014 | 8,200 | one DPI | 1000 Hz | `1532:0040` |
| Naga Chroma | 16,000 | one DPI | 1000 Hz | `1532:0053` |
| Naga Epic Chroma | 8,200 | one DPI | 1000 Hz | `1532:003e` wired, `1532:003f` wireless |
| Naga Hex V2 | 16,000 | one DPI | 1000 Hz | `1532:0050` |
| Naga Left Handed Edition 2020 | 20,000 | one DPI | 1000 Hz | `1532:008d` |
| Naga Pro | 20,000 | yes | 1000 Hz | `1532:008f` wired, `1532:0090` wireless |
| Naga Trinity | 16,000 | one DPI | 1000 Hz | `1532:0067` |
| Naga V2 HyperSpeed | 30,000 | yes | 1000 Hz | `1532:00b4` wireless |
| Naga V2 Pro | 30,000 | yes | 1000 Hz | `1532:00a7` wired, `1532:00a8` wireless |
| Naga X | 18,000 | yes | 1000 Hz | `1532:0096` |
| Orochi | 8,200 | one DPI | 1000 Hz | `1532:0048` wired |
| Orochi 2013 | 6,400 | one DPI | 1000 Hz | `1532:0039` |
| Ouroboros | 8,200 | one DPI | 1000 Hz | `1532:0032` |
| Pro Click | 16,000 | yes | 1000 Hz | `1532:0077` wireless, `1532:0080` wired |
| Pro Click Mini | 12,000 | yes | 1000 Hz | `1532:009a` wireless |
| Pro Click V2 | 30,000 | yes | 1000 Hz | `1532:00d0` wired, `1532:00d1` wireless |
| Pro Click V2 Vertical Edition | 30,000 | yes | 1000 Hz | `1532:00c7` wired, `1532:00c8` wireless |
| Taipan | 8,200 | one DPI | 1000 Hz | `1532:0034` |
| Viper | 16,000 | yes | 1000 Hz | `1532:0078` |
| Viper 8KHz | 20,000 | yes | 8000 Hz | `1532:0091` |
| Viper Mini SE | 30,000 | yes | 8000 Hz | `1532:009e` wired, `1532:009f` wireless |
| Viper Ultimate | 20,000 | yes | 1000 Hz | `1532:007a` wired, `1532:007b` wireless |
| Viper V3 HyperSpeed | 30,000 | yes | 1000 Hz | `1532:00b8` |
| Viper V3 Pro SE | 35,000 | yes | 1000 Hz | `1532:00de` wired, `1532:00df` wireless |

</details>

If you own one of these, open it in Hubless and use **Device settings → Copy device report**, then paste it into an
issue. Once a model checks out it moves to ✅ Works.

## 🔜 Recognised, support coming soon

86 devices (mostly mice) from 11 brands. Hubless shows them on the home screen with their name and
maximum DPI, marked "support coming soon".

### ASUS

<details><summary>23 devices</summary>

| Model | Max DPI | USB ids |
|---|---|---|
| ASUSTeK TUF GAMING M3 GEN II | 8,000 | `0b05:1a9b` |
| ROG Chakram | 16,000 | `0b05:18e3`, `0b05:18e5` |
| ROG Chakram Core | 16,000 | `0b05:1958` |
| ROG Chakram X | 36,000 | `0b05:1a18`, `0b05:1a1a` |
| ROG Gladius II | 12,000 | `0b05:1845` |
| ROG Gladius II Origin | 12,000 | `0b05:1877` |
| ROG Gladius II Origin PNK LTD | 12,000 | `0b05:18cd` |
| ROG GX860 Buzzard Mouse | 8,200 | `0b05:1816` |
| ROG Harpe Wireless | 36,000 | `0b05:1a92` |
| ROG Keris | 16,000 | `0b05:195c` |
| ROG Keris Wireless | 16,000 | `0b05:195e`, `0b05:1960` |
| ROG Keris Wireless AimPoint | 36,000 | `0b05:1a66`, `0b05:1a68` |
| ROG Omni | — | `0b05:1ace` wireless |
| ROG Pugio | 7,200 | `0b05:1846` |
| ROG Spatha X | 19,000 | `0b05:1979`, `0b05:1977` |
| ROG Strix Carry | 7,200 | `0b05:18b4` |
| ROG Strix Impact | 5,000 | `0b05:1847` |
| ROG Strix Impact II | 6,200 | `0b05:18e1` |
| ROG Strix Impact II Wireless | 16,000 | `0b05:1947`, `0b05:1949` |
| ROG Strix Impact III | 12,000 | `0b05:1a88` |
| ROG Strix Impact III Wireless | 36,000 | `0b05:1ad7` |
| TUF GAMING M4 AIR | 16,000 | `0b05:1a03` |
| TUF GAMING MINI WL MOUSE MIKU | 12,000 | `0b05:1c56`, `0b05:1c57` |

</details>

### Endgame Gear

<details><summary>1 device</summary>

| Model | Max DPI | USB ids |
|---|---|---|
| OP1 8k v2 | 26,000 | `3367:1978` wired |

</details>

### Etekcity

<details><summary>1 device</summary>

| Model | Max DPI | USB ids |
|---|---|---|
| Scroll Alpha | — | `1ea7:4011` |

</details>

### G.Skill

<details><summary>1 device</summary>

| Model | Max DPI | USB ids |
|---|---|---|
| MX-780 | — | `28da:3101` |

</details>

### Glorious

<details><summary>8 devices · including Model O/O-</summary>

| Model | Max DPI | USB ids |
|---|---|---|
| Model O/O- ⭐ | — | `258a:0036` |
| Model D | — | `258a:0033` |
| Model O Eternal | — | `3794:a000` |
| Nubwo x7 spectrum | — | `258a:0012` |
| SinoWealth Generic Mouse (0027) | — | `258a:0027` |
| SinoWealth Generic Mouse (0029) | — | `258a:0029` |
| Sinowealth Generic Mouse (0051) | — | `258a:0051` |
| SinoWealth Generic Mouse (1007) | — | `258a:1007` |

</details>

### Holtek

<details><summary>1 device</summary>

| Model | Max DPI | USB ids |
|---|---|---|
| Mars Gaming MM4 | — | `04d9:fa58` |

</details>

### Logitech

<details><summary>22 devices</summary>

| Model | Max DPI | USB ids |
|---|---|---|
| G Powerplay | — | `046d:405f` |
| G PRO Keyboard | — | `046d:c339` |
| G300 | — | `046d:c246` |
| G413 | — | `046d:c33a` |
| G5 | — | `046d:c049`, `046d:c041` |
| G500 | 5,700 | `046d:c068` |
| G500s | 8,200 | `046d:c24e` |
| G513 | — | `046d:c33c` |
| G600 | — | `046d:c24a` |
| G7 | — | `046d:c51a` |
| G700 | 5,700 | `046d:c531`, `046d:c06b` |
| G700s | 8,200 | `046d:c07c` |
| G815 | — | `046d:c33f` |
| G9 | — | `046d:c048` |
| G910 | — | `046d:c335` |
| G915 | — | `046d:c33e` |
| G915 TKL | — | `046d:c343`, `046d:b35f` bluetooth |
| G935 | — | `046d:0a87` |
| G9x [Call of Duty MW3 Edition] | 5,700 | `046d:c249` |
| G9x [Original] | 5,700 | `046d:c066` |
| M570 | — | `046d:1028` |
| M705 | — | `046d:101b` |

</details>

### openinput

<details><summary>1 device</summary>

| Model | Max DPI | USB ids |
|---|---|---|
| openinput | — | `1d50:616a` |

</details>

### Razer

<details><summary>15 devices · including Viper V4 Pro</summary>

| Model | Max DPI | USB ids |
|---|---|---|
| Viper V4 Pro ⭐ | — | `1532:00e5`, `1532:00e6` |
| Abyssus | — | `1532:0042` |
| Abyssus 1800 | 1,800 | `1532:0020` |
| DeathAdder 1800 | 1,800 | `1532:0038` |
| DeathAdder 2013 | 6,400 | `1532:0037` |
| DeathAdder 3.5G | 3,500 | `1532:0016` |
| DeathAdder 3.5G Black | 3,500 | `1532:0029` |
| Diamondback Chroma | 16,000 | `1532:004c` |
| Mamba Tournament Edition | 16,000 | `1532:0046` |
| Naga | 5,600 | `1532:0015` |
| Naga 2012 | 5,600 | `1532:002e` |
| Naga Epic | 5,600 | `1532:001f` |
| Naga Hex | 5,600 | `1532:0041` |
| Naga Hex (Red) | 5,600 | `1532:0036` |
| Orochi 2011 | 4,000 | `1532:0013` |

</details>

### Roccat

<details><summary>3 devices</summary>

| Model | Max DPI | USB ids |
|---|---|---|
| Kone EMP | — | `1e7d:2e24` |
| Kone Pure | — | `1e7d:2dc2`, `1e7d:2dbe`, `1e7d:2dcb` |
| Kone XTD | — | `1e7d:2e22` |

</details>

### SteelSeries

<details><summary>10 devices</summary>

| Model | Max DPI | USB ids |
|---|---|---|
| Kinzu V2 | — | `1038:1378` |
| Kinzu V2 Pro Edition | — | `1038:1366` |
| Kinzu V3 | — | `1038:1388` |
| Rival | 6,500 | `1038:1384`, `1038:1392`, `1038:1710`, `1038:1712`, `1038:171c`, `1038:1394`, `1038:171a`, `1038:1716`, `1038:1714`, `1038:1718` |
| Rival 100/105 | — | `1038:1702`, `1038:170a`, `1038:170b`, `1038:170c`, `1038:1814` |
| Rival 310 | 12,000 | `1038:1720` |
| Rival 600 | 12,000 | `1038:1724` |
| Rival 650 Wireless | 12,000 | `1038:172b`, `1038:1726` |
| Sensei 310 | 12,000 | `1038:1722` |
| Sensei Raw | 5,670 | `1038:1369` |

</details>

⭐ = among the most used mice by pro players.

Device names and USB ids come from [OpenRazer](https://github.com/openrazer/openrazer) and
[libratbag](https://github.com/libratbag/libratbag) (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)), plus
devices seen by Hubless itself.
