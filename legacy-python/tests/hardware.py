#!/usr/bin/env python3
"""Hardware verification on a real PRO X SUPERSTRIKE. Restores the mouse memory at the end.

Move the mouse in circles while it runs: the polling-rate check times real input reports.
"""
import glob
import os
import select
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from hubless import profile as P, storage  # noqa: E402
from hubless.device import Device, find_devices  # noqa: E402
from hubless.session import Session  # noqa: E402

results = []


def ok(name, cond, extra=""):
    results.append(bool(cond))
    print(("PASS " if cond else "FAIL ") + name + (f"  ({extra})" if extra else ""), flush=True)


def mouse_input_node():
    for n in glob.glob("/sys/class/hidraw/hidraw*"):
        if os.path.realpath(n + "/device").count(":046D:") > 1:
            return "/dev/" + os.path.basename(n)


def measure_rate(expected, seconds=1.5, tries=4):
    """Polling rate from input-report timing. Reports only arrive while the mouse moves, so a window only
    counts if the mouse moved fast enough to report almost every cycle. Returns (Hz, ok) or (None, False)."""
    node = mouse_input_node()
    best = None
    for _ in range(tries):
        fd = os.open(node, os.O_RDONLY | os.O_NONBLOCK)
        stamps = []
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if select.select([fd], [], [], 0.05)[0]:
                for _ in range(64):
                    try:
                        d = os.read(fd, 64)
                    except BlockingIOError:
                        break
                    if d and d[0] not in (0x10, 0x11, 0x20, 0x21):
                        stamps.append(time.monotonic_ns())
        os.close(fd)
        gaps = sorted(b - a for a, b in zip(stamps, stamps[1:]) if b > a)
        if len(stamps) < 0.6 * expected * seconds or len(gaps) < 50:
            print("  …move the mouse faster", flush=True)
            continue
        hz = round(1e9 / gaps[len(gaps) // 2])
        best = hz if best is None else max(best, hz)
        if abs(hz - expected) / expected < 0.15:
            return hz, True
    return best, False


print("Waiting for the mouse to wake up (move it)…", flush=True)
deadline = time.time() + 600
while True:
    found, _, asleep = find_devices()
    if found:
        break
    if time.time() > deadline:
        sys.exit("Mouse never woke up.")
    time.sleep(1)
s = Session(Device(*found[0][:2]).connect())
s.load()
orig = s.dev.dump_memory()
stage0 = s.stage
storage.save_backup(s.serial, s.name, 8, orig, "hardware-test")
print(f"Connected: {s.name}, battery {s.battery.percent}%", flush=True)

try:
    p = s.active.copy()
    p.stages[1] = P.Stage(s.grid.snap(1777), s.grid.snap(1777), 2)
    p.buttons[3] = P.Action.key(0x06, 0x01)
    p.hits = [P.Hits(3, 2, True, 4), P.Hits(6, 1, False, 2)]
    p.name = "Hubless test"
    saved = s.save_profile(p)
    rb = s.dev.read_profile(s.active_sector)
    ok("profile written and verified", rb.raw == saved.raw)
    ok("DPI stage 2 snapped to 1780", rb.stages[1].x == 1780)
    ok("back button remapped to Ctrl+C", rb.buttons[3].describe() == "Ctrl+C")
    ok("profile name stored", rb.name == "Hubless test")
    ok("HITS left applied live", s.dev.hits_get(0) == P.Hits(3, 2, True, 4))
    ok("HITS right applied live", s.dev.hits_get(1) == P.Hits(6, 1, False, 2))
    s.set_enabled(1, True)
    ok("profile 2 switched on", s.dev.profile_table()[1][1])
    s.activate(2)
    ok("switched to profile 2", s.dev.current_profile_sector() == 2)
    ok("HITS follow profile 2", s.dev.hits_get(0) == P.Hits(5, 2, False, 3))
    s.activate(1)
    ok("back to profile 1", s.dev.current_profile_sector() == 1)
    ok("HITS back to profile 1 values", s.dev.hits_get(0) == P.Hits(3, 2, True, 4))

    print("Measuring polling rate — keep moving the mouse…", flush=True)
    for hz in (500, 1000, 2000, 4000):
        p = s.active.copy()
        p.rate_hz = hz
        s.save_profile(p)
        time.sleep(0.3)
        got, good = measure_rate(hz)
        ok(f"polling {hz} Hz", good, f"measured {got} Hz" if got else "mouse wasn't moving fast enough")
finally:
    s.restore_backup(orig)
    s.dev.set_current_stage(stage0)
    ok("mouse memory fully restored", s.dev.dump_memory() == orig)
    ok("HITS restored live", s.dev.hits_get(0) == P.Hits.from_wire(orig[1][0x26:0x29]))

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
