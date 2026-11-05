#!/usr/bin/env python3
"""Drive the real GUI code against the simulated mouse and check what lands in its memory."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import gi  # noqa: E402

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import GLib  # noqa: E402

from hubless import profile as P  # noqa: E402
from hubless.gui.app import App  # noqa: E402

app = App(demo=True)
results = []


def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)


def mem(win, sector=1):
    return P.decode(sector, win.session.dev.t.sectors[sector], 8)


def steps(win):
    t = win.pages["triggers"]
    s = win.pages["sensor"]
    b = win.pages["buttons"]
    pr = win.pages["profiles"]
    sim = win.session.dev.t
    yield lambda: t.act.set_value(2, emit=True)
    yield lambda: t.rt_switch.set_active(True)
    yield lambda: t.rt.set_value(4, emit=True)
    yield lambda: check("HITS live preview reached the mouse", sim.hits[0] == bytes([0x08, 0x11, 0x0C]))
    yield lambda: None
    yield lambda: check("HITS saved to profile (both buttons)",
                        mem(win).hits == [P.Hits(2, 4, True, 3), P.Hits(2, 4, True, 3)])
    yield lambda: t.set_target("right")
    yield lambda: t.hap.set_value(0, emit=True)
    yield lambda: None
    yield lambda: check("right-only haptics change", mem(win).hits[1].haptics == 0 and mem(win).hits[0].haptics == 3)
    yield lambda: (s.select_stage(0), s.set_dpi(1234))
    yield lambda: None
    yield lambda: check("DPI snapped to sensor grid and saved", mem(win).stages[0].x == 1230 and s.dpi_spin.get_value() == 1230)
    yield lambda: (s.select_stage(2), s._make_default())
    yield lambda: None
    yield lambda: check("start stage saved and applied live", mem(win).default_stage == 2 and sim.stage == 2)
    yield lambda: (s.select_stage(0), s.include.set_active(False))
    yield lambda: None
    yield lambda: check("stage removed: others packed to the front, live stage still valid",
                        [st.x for st in mem(win).stages] == [1200, 1600, 2400, 3200, 0]
                        and mem(win).default_stage == 1 and sim.stage == 1)
    yield lambda: s.rate_group.set_active_name("8000")
    yield lambda: None
    yield lambda: check("polling rate 8000 Hz saved", mem(win).rate_hz == 8000)
    yield lambda: b._set(3, P.Action.key(0x06, 0x01))
    yield lambda: None
    yield lambda: check("back button -> Ctrl+C", mem(win).buttons[3].describe() == "Ctrl+C")
    yield lambda: b._set(0, P.Action.media(0xCD))
    yield lambda: check("left-click lockout guarded", win.draft.buttons[0].describe() == "Left click")
    yield lambda: pr._enabled(1, True)
    yield lambda: None
    yield lambda: check("profile 2 switched on in control sector", sim.sectors[0][6] == 1)
    yield lambda: pr._use(2)
    yield lambda: None
    yield lambda: check("profile 2 in use and being edited", sim.current == 2 and win.edit_sector == 2)
    yield lambda: pr._reset(win.session.profiles[0])  # opens dialog; we call the work directly below
    yield lambda: win.run(lambda: win.session.replace_sector(1, win.session.factory), lambda _: win.reload_all())
    yield lambda: None
    yield lambda: check("profile 1 reset to factory", sim.sectors[1] == win.session.factory)
    yield lambda: check("backup written before first change", win.session.backed_up)
    yield lambda: setattr(sim, "asleep", True)
    yield lambda: (s.select_stage(0), s.set_dpi(3000))
    yield lambda: None
    yield lambda: check("asleep: editor stays, banner shown, editing locked",
                        win.asleep and win.banner.get_revealed() and not win.stack.get_sensitive()
                        and win.state_stack.get_visible_child_name() == "main")
    yield lambda: setattr(sim, "asleep", False)
    yield lambda: None
    yield lambda: None
    yield lambda: None
    yield lambda: None
    yield lambda: None
    yield lambda: None
    yield lambda: check("woke up: pending change saved", not win.asleep and mem(win, win.edit_sector).stages[0].x == 3000)


def run():
    win = app.props.active_window
    if not win or not win.session:
        return True
    it = steps(win)

    def tick():
        try:
            next(it)()
        except StopIteration:
            fails = [n for n, ok in results if not ok]
            print(f"\n{len(results) - len(fails)}/{len(results)} passed")
            app.quit()
            sys.exit(1 if fails else 0)
        return True
    GLib.timeout_add(700, tick)
    return False


app.connect("activate", lambda *_: GLib.timeout_add(300, run))
app.run([sys.argv[0]])
