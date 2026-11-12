"""Extract per-model Razer mouse protocol facts from OpenRazer's kernel driver into data/razer.json.

OpenRazer (GPL-2.0) picks, per USB product id, a transaction id and a command variant for every setting inside long
`switch (device->usb_pid)` blocks. This script reads those blocks and records only the facts (ids, which command
variant, which interface), so Hubless's own driver (src/main/razer/) can look them up. No OpenRazer code is copied.

Usage: python3 -I tools/extract-razer.py <openrazer checkout>/driver data/razer.json
"""
import json, re, sys

src_dir, out = sys.argv[1:3]
c = open(f'{src_dir}/razermouse_driver.c').read()
h = open(f'{src_dir}/razermouse_driver.h').read()

pids = {m[1]: int(m[2], 16) for m in re.finditer(r'#define\s+(USB_DEVICE_ID_RAZER_\w+)\s+0x([0-9A-Fa-f]+)', h)}
table = c[c.index('static const struct hid_device_id razer_devices'):]
supported = [m[1] for m in re.finditer(r'HID_USB_DEVICE\(USB_VENDOR_ID_RAZER,\s*(USB_DEVICE_ID_RAZER_\w+)\)', table[:table.index('};')])]


def body(name):
    """Source of one C function."""
    i = c.index(f'{name}(struct device')
    depth, j = 0, c.index('{', i)
    for k in range(j, len(c)):
        depth += {'{': 1, '}': -1}.get(c[k], 0)
        if depth == 0:
            return c[j:k + 1]
    raise ValueError(name)


def outer_switch(fn):
    """The first `switch(device->usb_pid)` of a function as [(case names or ['default'], statements)]."""
    m = re.search(r'switch\s*\(\s*(?:device->usb_pid|usb_dev->descriptor\.idProduct)\s*\)\s*\{', fn)
    if not m:
        return []
    depth, k = 1, m.end()
    while depth:
        depth += {'{': 1, '}': -1}.get(fn[k], 0)
        k += 1
    block = fn[m.end():k - 1]
    groups, names, stmts, nest = [], [], [], 0
    for line in block.split('\n'):
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


BUILDER = re.compile(r'razer_chroma_\w+?_((?:get|set)_\w+)\(([^)]*)\)')


def per_pid(fn_name):
    """pid name → [request builder, its first argument or None, transaction id] for one attribute function."""
    fn = body(fn_name)
    sw = re.search(r'switch\s*\(\s*device->usb_pid', fn)
    before = BUILDER.search(fn[:sw.start()]) if sw else None  # request built before the switch, id set per case
    res, default = {}, None
    for names, stmts in outer_switch(fn):
        b = BUILDER.search(stmts) or before
        tx = re.search(r'transaction_id\.id\s*=\s*(0x[0-9A-Fa-f]+)', stmts)
        unsupported = 'not supported' in stmts or 'return -EINVAL' in stmts or ('return' in stmts and not b)
        arg = b[2].split(',')[0].strip() if b and b[2].strip() else None
        val = None if unsupported or not b else [b[1], arg, int(tx[1], 16) if tx else 0xFF]
        for n in names:
            if n == 'default':
                default = val
            else:
                res[n] = val
    return res, default


def lookup(fn_name):
    res, default = per_pid(fn_name)
    return lambda n: res.get(n, default) if n in res or default else None


attrs = {
    'dpi': lookup('razer_attr_read_dpi'),
    'setDpi': lookup('razer_attr_write_dpi'),
    'stages': lookup('razer_attr_read_dpi_stages'),
    'setStages': lookup('razer_attr_write_dpi_stages'),
    'poll': lookup('razer_attr_read_poll_rate'),
    'setPoll': lookup('razer_attr_write_poll_rate'),
    'battery': lookup('razer_attr_read_charge_level'),
    'charging': lookup('razer_attr_read_charge_status'),
    'idle': lookup('razer_attr_read_device_idle_time'),
    'firmware': lookup('razer_attr_read_firmware_version'),
}

# Which feature-report interface the requests go to (razer_get_report: 0 unless a case sets `index = 0x0N`).
index_of = {}
for names, stmts in outer_switch(c[c.index('static int razer_get_report'):c.index('static int __must_check razer_send_payload')]):
    m = re.search(r'index\s*=\s*(0x[0-9A-Fa-f]+)', stmts)
    wait = re.search(r'(RAZER_\w+_WAIT_US)', stmts)
    for n in names:
        index_of[n] = (int(m[1], 16) if m else 0, wait[1] if wait else 'RAZER_MOUSE_WAIT_US')
waits = {m[1]: int(m[2]) for m in re.finditer(r'#define\s+(RAZER_\w+_WAIT_US)\s+(\d+)', h)}

# Devices that send the polling-rate write a second time with argument 0x01.
twice = set()
wp = body('razer_attr_write_poll_rate')
second = wp[wp.index('razer_send_payload'):]
for names, stmts in outer_switch(second):
    if 'set_polling_rate2' in stmts:
        twice.update(n for n in names if n != 'default')

models = []
for n in supported:
    if n not in pids:
        continue
    rec = {k: f(n) for k, f in attrs.items()}
    if not rec['dpi'] and not rec['stages']:
        continue  # no DPI control (docks, mats)
    iface, wait = index_of.get(n, index_of.get('default', (0, 'RAZER_MOUSE_WAIT_US')))
    name = n.replace('USB_DEVICE_ID_RAZER_', '')
    models.append({
        'id': name,
        'pid': pids[n],
        'interface': iface,
        'waitMs': max(1, round(waits.get(wait, 600) / 1000)),
        'wireless': bool(re.search(r'WIRELESS|RECEIVER|HYPERSPEED|DONGLE', name)) and 'WIRED' not in name,
        # [command, first argument, transaction id]; command names follow OpenRazer's request builders
        **rec,
        'pollTwice': n in twice,
    })

json.dump({'generated': 'tools/extract-razer.py from OpenRazer driver/razermouse_driver.c', 'models': models},
          open(out, 'w'), indent=1)
print(len(models), 'Razer mice with DPI control;',
      sum(1 for m in models if m['stages']), 'with DPI stages;',
      sum(1 for m in models if m['poll'] and m['poll'][0] == 'get_polling_rate2'), 'with the 8K polling command')
