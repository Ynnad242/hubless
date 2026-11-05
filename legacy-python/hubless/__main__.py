"""Entry point: the GUI by default, a small CLI for scripts."""
from __future__ import annotations

import argparse
import sys


def cli(args) -> int:
    from . import profile as P
    from .device import Device, find_devices
    from .session import Session

    found, no_perm, asleep = find_devices()
    if not found:
        if asleep:
            print(f"Your {asleep[0]} is asleep. Move it or click a button to wake it up.", file=sys.stderr)
        elif no_perm:
            print("No permission to open " + ", ".join(no_perm) + ". Open the Hubless app once and allow "
                  "access, or install the udev rule from the README.", file=sys.stderr)
        else:
            print("No Logitech HID++ mouse found.", file=sys.stderr)
        return 1
    t, idx, ep = found[0]
    s = Session(Device(t, idx, ep.name).connect())
    s.load()
    p = s.active
    if args.hits_code or args.actuation or args.haptics is not None or args.rapid_trigger:
        if not p or not p.hits:
            print("This mouse has no HITS triggers.", file=sys.stderr)
            return 1
        new = p.copy()
        if args.hits_code:
            new.hits = list(P.parse_hits_code(args.hits_code))
        for h in new.hits:
            if args.actuation:
                h.actuation = args.actuation
            if args.haptics is not None:
                h.haptics = args.haptics
            if args.rapid_trigger:
                h.rt_on = args.rapid_trigger != "off"
                if args.rapid_trigger.isdigit():
                    h.rt_level = int(args.rapid_trigger)
        p = s.save_profile(new)
    if args.dpi:
        new = p.copy()
        new.stages[new.default_stage] = P.Stage(s.grid.snap(args.dpi), s.grid.snap(args.dpi),
                                                new.stages[new.default_stage].lod)
        p = s.save_profile(new)
    b = s.battery
    print(f"{s.name}  firmware {s.dev.firmware}  battery {b.percent}% ({b.status})" if b else s.name)
    if p:
        print(f"profile {s.slot_of(p.sector) + 1}: {p.rate_hz} Hz, stages "
              + ", ".join(("*" if i == s.stage else "") + str(st.x) for i, st in enumerate(p.stages) if st.enabled))
        if p.hits:
            for name, h in zip(("left", "right"), p.hits):
                print(f"  {name:5s} actuation {h.actuation}, rapid trigger "
                      f"{('level ' + str(h.rt_level)) if h.rt_on else 'off'}, haptics {h.haptics}")
            print(f"  HITS code {P.hits_code(*p.hits)}")
        print("  buttons: " + ", ".join(a.describe() for a in p.buttons[:5]))
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="hubless", description="Configure Logitech G mice on Linux.")
    ap.add_argument("--demo", action="store_true", help="open the app with a simulated mouse")
    ap.add_argument("--status", action="store_true", help="print the mouse's settings and exit")
    ap.add_argument("--dpi", type=int, help="set the DPI of the starting stage")
    ap.add_argument("--actuation", type=int, choices=range(1, 11), metavar="1-10", help="HITS click depth")
    ap.add_argument("--rapid-trigger", metavar="off|on|1-5", help="HITS rapid trigger")
    ap.add_argument("--haptics", type=int, choices=range(0, 6), metavar="0-5", help="HITS haptic strength")
    ap.add_argument("--hits-code", metavar="CODE", help="apply a G HUB HITS code")
    ap.add_argument("--version", action="version", version=f"hubless {__import__('hubless').__version__}")
    args = ap.parse_args(argv)
    if args.rapid_trigger and args.rapid_trigger not in ("off", "on", "1", "2", "3", "4", "5"):
        ap.error("--rapid-trigger takes off, on or 1-5")
    if args.status or args.dpi or args.actuation or args.rapid_trigger or args.haptics is not None or args.hits_code:
        return cli(args)
    from .gui.app import App
    return App(demo=args.demo).run([sys.argv[0]])


if __name__ == "__main__":
    sys.exit(main())
