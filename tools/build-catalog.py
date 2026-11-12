"""Build data/mice.json, the catalog of mice Hubless recognises by USB id.

Sources (facts only — names, USB ids, max DPI, protocol family):
  * OpenRazer  daemon/openrazer_daemon/hardware/mouse.py   (Razer)
  * libratbag  data/devices/*.device                         (Logitech, SteelSeries, ASUS, Glorious, Roccat, …)
  * entries verified by Hubless itself, and the pro-usage ranking from prosettings.net (Nov 2026)

Usage: python3 -I tools/build-catalog.py <openrazer checkout> <libratbag checkout> data/mice.json
"""
import json, pathlib, re, subprocess, sys

here = pathlib.Path(__file__).parent
razer_repo, ratbag_repo, out = sys.argv[1:4]
raw_path = pathlib.Path(out).with_suffix('.raw.json')
subprocess.run([sys.executable, '-I', str(here / 'extract-mice.py'), f'{razer_repo}/daemon/openrazer_daemon/hardware/mouse.py',
                f'{ratbag_repo}/data/devices', str(raw_path)], check=True)
raw = json.loads(raw_path.read_text())
raw_path.unlink()

CONN = re.compile(r'\s*\((Wired|Wireless|Receiver|Bluetooth|Alternate|USB)\)|\s+(Receiver|Dongle)$', re.I)

def clean(name):
    conn = None
    m = re.search(r'\((Wired|Wireless|Receiver|Bluetooth)\)|\b(Receiver|Dongle)$', name, re.I)
    if m:
        w = (m[1] or m[2]).lower()
        conn = 'wired' if w == 'wired' else 'bluetooth' if w == 'bluetooth' else 'wireless'
    return CONN.sub('', name).replace('  ', ' ').strip(), conn

models = {}
def add(vendor, name, vid, pid, conn, protocol, max_dpi, kind='mouse', source='', verified=False):
    name, c = clean(name)
    key = (vendor.lower(), name.lower())
    m = models.setdefault(key, {'vendor': vendor, 'name': name, 'kind': kind, 'protocol': protocol, 'maxDpi': max_dpi,
                                'ids': [], 'popular': False, 'verified': False, 'source': source})
    if max_dpi and not m['maxDpi']:
        m['maxDpi'] = max_dpi
    if not any(i['vid'] == vid and i['pid'] == pid for i in m['ids']):
        m['ids'].append({'vid': vid, 'pid': pid, 'connection': conn or c})
    m['verified'] = m['verified'] or verified

for e in raw['razer']:
    add('Razer', e['name'], e['vid'], e['pid'], None, 'razer', e['maxDpi'], source='openrazer')
for e in raw['ratbag']:
    add(e['vendor'], e['name'], e['vid'], e['pid'], e['connection'], e['protocol'], e['maxDpi'], e.get('kind', 'mouse'), 'libratbag')

# Verified on hardware by Hubless, or from other sources.
add('Logitech', 'PRO X2 SUPERSTRIKE', 0x046d, 0x40bd, 'wireless', 'logitech-hidpp20', 44000, source='hubless', verified=True)
add('Endgame Gear', 'OP1 8k', 0x3367, 0x1964, 'wired', 'endgame', 26000, source='hubless', verified=True)
add('Endgame Gear', 'OP1 8k v2', 0x3367, 0x1978, 'wired', 'endgame-v2', 26000, source='egctl')
add('WLmouse', 'Ying', 0x36a7, 0xa875, 'wired', 'wlmouse', 30000, source='hubless', verified=True)
add('WLmouse', 'Ying', 0x36a7, 0xa874, 'wireless', 'wlmouse', 30000, source='OpenMouse product list')
add('Razer', 'Viper V4 Pro', 0x1532, 0x00e5, None, 'razer', None, source='driver database (unverified ids)')
add('Razer', 'Viper V4 Pro', 0x1532, 0x00e6, None, 'razer', None, source='driver database (unverified ids)')

# Most-used mice among pro players (prosettings.net, Nov 2026) and long-time best sellers.
POPULAR = ['G Pro X Wireless Superlight', 'PRO X2 SUPERSTRIKE', 'Viper V3 Pro', 'Viper V4 Pro', 'DeathAdder V3 Pro',
           'DeathAdder V3', 'DeathAdder V4 Pro', 'Viper V2 Pro', 'Viper Mini', 'Basilisk V3', 'Basilisk V3 Pro',
           'G502 Hero', 'G502 X', 'G502 X Plus', 'G502 X Lightspeed', 'Gaming Mouse G305', 'G703 Hero', 'G Pro Wireless',
           'Gaming Mouse G102/G103/G203', 'Model O/O-', 'OP1 8k', 'Cobra Pro', 'Orochi V2']
for m in models.values():
    m['popular'] = m['name'] in POPULAR

catalog = sorted(models.values(), key=lambda m: (not m['popular'], m['vendor'], m['name']))
pathlib.Path(out).write_text(json.dumps({'generated': 'tools/build-catalog.py', 'models': catalog}, indent=1) + '\n')
print(len(catalog), 'models,', sum(len(m['ids']) for m in catalog), 'USB ids,', sum(m['popular'] for m in catalog), 'popular')
