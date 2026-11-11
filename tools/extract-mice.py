"""Turn OpenRazer's mouse classes and libratbag's .device files into one JSON list (facts only: names, USB ids,
max DPI, supported features). Parses source with ast; never imports or executes it."""
import ast, configparser, json, re, sys, pathlib

razer_py, ratbag_dir, out = sys.argv[1], sys.argv[2], sys.argv[3]
tree = ast.parse(pathlib.Path(razer_py).read_text())
classes = {}
for node in tree.body:
    if not isinstance(node, ast.ClassDef):
        continue
    c = {'bases': [b.id for b in node.bases if isinstance(b, ast.Name)], 'doc': ast.get_docstring(node) or '', 'attrs': {}}
    for st in node.body:
        if isinstance(st, ast.Assign) and len(st.targets) == 1 and isinstance(st.targets[0], ast.Name):
            c['attrs'][st.targets[0].id] = st.value
    classes[node.name] = c

def attr(name, key, seen=()):
    c = classes.get(name)
    if not c or name in seen:
        return None
    if key in c['attrs']:
        return resolve(name, key, c['attrs'][key], seen + (name,))
    for b in c['bases']:
        v = attr(b, key, seen + (name,))
        if v is not None:
            return v
    return None

def resolve(cls, key, v, seen):
    if isinstance(v, ast.Constant):
        return v.value
    if isinstance(v, ast.List):
        return [resolve(cls, key, e, seen) for e in v.elts]
    if isinstance(v, ast.BinOp) and isinstance(v.op, ast.Add):
        l, r = resolve(cls, key, v.left, seen), resolve(cls, key, v.right, seen)
        return (l or []) + (r or [])
    if isinstance(v, ast.Attribute) and isinstance(v.value, ast.Name):
        return attr(v.value.id, v.attr, seen)
    return None

razer = []
for name, c in classes.items():
    pid = attr(name, 'USB_PID')
    if not isinstance(pid, int):
        continue
    doc = re.sub(r'^Class for (the )?', '', c['doc'].split('\n')[0]).strip().rstrip('.')
    methods = attr(name, 'METHODS') or []
    conn = 'wireless' if re.search(r'Wireless|Receiver|Dongle', doc) and not re.search(r'\(Wired\)', doc) else 'wired'
    feats = sorted({f for m, f in [('set_dpi_stages', 'dpiStages'), ('set_dpi_xy', 'dpi'), ('set_poll_rate', 'polling'),
                                    ('get_battery', 'battery'), ('set_idle_time', 'sleep'), ('max_dpi', 'dpi')] if m in methods})
    if 'set_hyperpolling_wireless_dongle_indicator_led_mode' in methods or 'set_poll_rate' in methods and attr(name, 'POLL_RATES'):
        pass
    razer.append({'vendor': 'Razer', 'name': re.sub(r'^Razer\s+', '', doc), 'vid': 0x1532, 'pid': pid,
                  'maxDpi': attr(name, 'DPI_MAX'), 'connection': conn, 'protocol': 'razer', 'features': feats,
                  'source': 'openrazer'})

DRIVER_PROTOCOL = {'hidpp20': 'logitech-hidpp20', 'hidpp10': 'logitech-hidpp10', 'logitech_g300': 'logitech-g300',
                   'logitech_g600': 'logitech-g600', 'steelseries': 'steelseries', 'sinowealth': 'sinowealth',
                   'sinowealth_nubwo': 'sinowealth', 'asus': 'asus', 'roccat': 'roccat', 'roccat-kone-pure': 'roccat',
                   'roccat-kone-emp': 'roccat', 'gskill': 'gskill', 'marsgaming': 'marsgaming', 'openinput': 'openinput'}
VENDOR_BY_VID = {0x046d: 'Logitech', 0x1038: 'SteelSeries', 0x258a: 'Glorious', 0x0b05: 'ASUS', 0x1e7d: 'Roccat',
                 0x28da: 'G.Skill', 0x0e8f: 'Mars Gaming', 0x1d57: 'Xenta', 0x093a: 'PixArt', 0x2ea8: 'Etekcity',
                 0x1532: 'Razer', 0x04d9: 'Holtek', 0x3299: 'Glorious', 0x320f: 'Glorious', 0x22d4: 'Laview'}
ratbag = []
for f in sorted(pathlib.Path(ratbag_dir).glob('*.device')):
    cp = configparser.ConfigParser(strict=False, interpolation=None)
    cp.optionxform = str
    try:
        cp.read_string(f.read_text())
    except Exception:
        continue
    d = cp['Device']
    driver = d.get('Driver', '')
    name = d.get('Name', f.stem)
    dpi_range = None
    for sec in cp.sections():
        if sec.startswith('Driver/') and cp[sec].get('DpiRange'):
            m = re.match(r'(\d+):(\d+)@([\d.]+)', cp[sec]['DpiRange'])
            if m:
                dpi_range = [int(m[1]), int(m[2]), float(m[3])]
    for match in d.get('DeviceMatch', '').split(';'):
        m = re.match(r'(usb|bluetooth):([0-9a-fA-F]{4}):([0-9a-fA-F]{4})', match.strip())
        if not m:
            continue
        vid, pid = int(m[2], 16), int(m[3], 16)
        vendor = VENDOR_BY_VID.get(vid) or name.split()[0]
        ratbag.append({'vendor': vendor, 'name': re.sub(r'^' + re.escape(vendor) + r'\s+', '', name), 'vid': vid, 'pid': pid,
                       'connection': 'bluetooth' if m[1] == 'bluetooth' else None, 'protocol': DRIVER_PROTOCOL.get(driver, driver),
                       'maxDpi': dpi_range[1] if dpi_range else None, 'kind': d.get('DeviceType', 'mouse'), 'source': 'libratbag'})

json.dump({'razer': razer, 'ratbag': ratbag}, open(out, 'w'), indent=1)
print(len(razer), 'razer entries,', len(ratbag), 'libratbag entries')
