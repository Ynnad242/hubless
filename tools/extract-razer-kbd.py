"""Extract per-model Razer keyboard protocol facts from OpenRazer's kernel driver into data/razer-keyboards.json.

Like tools/extract-razer.py (mice): OpenRazer (GPL-2.0) picks a command variant and transaction id per USB product id in
`switch (device->usb_pid)` blocks. This records only those facts (which builder, its LED / storage arguments, the
transaction id, the interface), so Hubless's own keyboard driver (src/main/razer/keyboard.ts) can look them up.
No OpenRazer code is copied.

Usage: python3 -I tools/extract-razer-kbd.py <openrazer checkout>/driver data/razer-keyboards.json
"""
import json, re, sys

src_dir, out = sys.argv[1:3]
c = open(f'{src_dir}/razerkbd_driver.c').read()
h = open(f'{src_dir}/razerkbd_driver.h').read()

pids = {m[1]: int(m[2], 16) for m in re.finditer(r'#define\s+(USB_DEVICE_ID_RAZER_\w+)\s+0x([0-9A-Fa-f]+)', h)}
table = c[c.index('static const struct hid_device_id razer_devices'):]
supported = [m[1] for m in re.finditer(r'HID_USB_DEVICE\(USB_VENDOR_ID_RAZER,\s*(USB_DEVICE_ID_RAZER_\w+)\)', table[:table.index('};')])]
CONST = {'VARSTORE': 1, 'NOSTORE': 0, 'ZERO_LED': 0, 'SCROLL_WHEEL_LED': 1, 'BATTERY_LED': 3, 'LOGO_LED': 4,
         'BACKLIGHT_LED': 5, 'MACRO_LED': 7, 'GAME_LED': 8, 'RED_PROFILE_LED': 0x0C, 'GREEN_PROFILE_LED': 0x0D,
         'BLUE_PROFILE_LED': 0x0E}


def body(name):
    i = c.index(f'{name}(struct device')
    depth, j = 0, c.index('{', i)
    for k in range(j, len(c)):
        depth += {'{': 1, '}': -1}.get(c[k], 0)
        if depth == 0:
            return c[j:k + 1]
    raise ValueError(name)


def outer_switch(fn):
    """The first `switch (device->usb_pid)` of a function as [(case names, statements)], fall-throughs joined."""
    m = re.search(r'switch\s*\(\s*(?:device->usb_pid|usb_dev->descriptor\.idProduct)\s*\)\s*\{', fn)
    if not m:
        return []
    depth, k = 1, m.end()
    while depth:
        depth += {'{': 1, '}': -1}.get(fn[k], 0)
        k += 1
    groups, names, stmts, nest = [], [], [], 0
    for line in fn[m.end():k - 1].split('\n'):
        s = line.strip()
        cm = re.match(r'case\s+(USB_DEVICE_ID_RAZER_\w+)\s*:', s)
        if nest == 0 and (cm or s.startswith('default:')):
            if stmts:
                groups.append((names, '\n'.join(stmts)))
                names, stmts = [], []
            names.append(cm[1] if cm else 'default')
            continue
        nest += s.count('{') - s.count('}')
        stmts.append(s)
    if names:
        groups.append((names, '\n'.join(stmts)))
    return groups


BUILDER = re.compile(r'razer_chroma_(standard|extended)_(\w+?)\(([^)]*)\)')


def per_pid(fn_name, want):
    """pid name -> {variant, args, tx} when its case builds one of the `want` requests, else None."""
    try:
        fn = body(fn_name)
    except ValueError:
        return lambda n: None
    res, default = {}, None
    for names, stmts in outer_switch(fn):
        b = BUILDER.search(stmts)
        val = None
        if b and b[2] in want:
            tx = re.search(r'transaction_id\.id\s*=\s*(0x[0-9A-Fa-f]+)', stmts)
            args = [a.strip() for a in b[3].split(',') if a.strip()]
            val = {'variant': b[1], 'tx': int(tx[1], 16) if tx else 0xFF,
                   'args': [CONST[a] for a in args if a in CONST]}
        for n in names:
            if n == 'default':
                default = val
            else:
                res[n] = val
    return lambda n: res[n] if n in res else default


effects = {
    'none': per_pid('razer_attr_write_matrix_effect_none', {'matrix_effect_none'}),
    'static': per_pid('razer_attr_write_matrix_effect_static', {'matrix_effect_static'}),
    'breath': per_pid('razer_attr_write_matrix_effect_breath', {'matrix_effect_breathing_single'}),
    'spectrum': per_pid('razer_attr_write_matrix_effect_spectrum', {'matrix_effect_spectrum'}),
}
brightness = per_pid('razer_attr_write_matrix_brightness', {'set_led_brightness', 'matrix_brightness'})
brightness_get = per_pid('razer_attr_read_matrix_brightness', {'get_led_brightness', 'matrix_get_brightness'})
game = per_pid('razer_attr_write_game_led_state', {'set_led_state'})
game_get = per_pid('razer_attr_read_game_led_state', {'get_led_state'})

# Interface the feature reports go to, and how long to wait for an answer (razer_get_report_params).
common = open(f'{src_dir}/razercommon.h').read()
waits = {m[1]: int(m[2]) for m in re.finditer(r'#define\s+(RAZER_\w+_WAIT_US)\s+(\d+)', h + common)}
params = c[c.index('static void razer_get_report_params'):]
params = params[:params.index('\n}\n') + 3]
index_of = {}
for names, stmts in outer_switch(params):
    m = re.search(r'\*report_index\s*=\s*(0x[0-9A-Fa-f]+)', stmts)
    w = re.search(r'\*wait\s*=\s*(RAZER_\w+_WAIT_US)', stmts)
    for n in names:
        index_of[n] = (int(m[1], 16) if m else 0x01, max(1, round(waits.get(w[1], 1000) / 1000)) if w else 1)

# Attributes the driver creates per keyboard (only those are offered).
probe = c[c.index('static int razer_kbd_probe'):]
probe = probe[:probe.index('\n}\n')]
created, falling = {}, []
common_attrs = set(re.findall(r'dev_attr_(\w+)', probe[:probe.index('switch')]))  # every keyboard gets these
for names, stmts in outer_switch(probe):
    here = set(re.findall(r'dev_attr_(\w+)', stmts))
    for n in names + falling:
        created.setdefault(n, set()).update(here)
    falling = falling + names if re.search(r'\bfallthrough;', stmts) else []

models = []
for n in supported:
    if n not in pids or re.search(r'BLADE|BOOK|TARTARUS|ORBWEAVER|NOSTROMO|ANANSI', n):
        continue  # laptops and keypads: not keyboards Hubless shows
    have = created.get(n, set()) | common_attrs
    fx = {e: f(n) for e, f in effects.items() if f'matrix_effect_{e}' in have and f(n)}
    if 'static' not in fx:
        continue
    # all effects must use one variant and one transaction id, or the keyboard is left out
    if len({(v['variant'], v['tx']) for v in fx.values()}) != 1:
        fx = {'static': fx['static']}
    v = fx['static']
    b, bg = brightness(n), brightness_get(n)
    g, gg = game(n), game_get(n)
    models.append({
        'id': n.replace('USB_DEVICE_ID_RAZER_', ''),
        'pid': pids[n],
        'interface': index_of.get(n, index_of.get('default', (1, 1)))[0],
        'waitMs': index_of.get(n, index_of.get('default', (1, 1)))[1],
        'wireless': bool(re.search(r'WIRELESS|HYPERSPEED', n)) and 'WIRED' not in n,
        'variant': v['variant'],
        'tx': v['tx'],
        'effects': sorted(fx),
        # storage and LED the extended effects address (the classic ones have none)
        'led': v['args'][1] if len(v['args']) >= 2 else None,
        # only when reading uses the same command family and transaction id as writing
        'brightness': b and bg and 'matrix_brightness' in have and (b['variant'], b['tx'], b['args']) == (bg['variant'], bg['tx'], bg['args'])
        and {'variant': b['variant'], 'tx': b['tx'], 'args': b['args']} or None,
        'game': g and gg and 'game_led_state' in have and {'tx': g['tx'], 'args': g['args']} or None,
    })

json.dump({'generated': 'tools/extract-razer-kbd.py from OpenRazer driver/razerkbd_driver.c', 'models': models},
          open(out, 'w'), indent=1)
print(len(models), 'Razer keyboards with lighting;', sum(1 for m in models if m['variant'] == 'extended'), 'extended;',
      sum(1 for m in models if m['brightness']), 'with brightness;', sum(1 for m in models if m['game']), 'with game mode')
