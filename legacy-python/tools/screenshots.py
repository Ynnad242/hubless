#!/usr/bin/env python3
"""Render every page of the demo app to PNG at full height.

Usage: tools/screenshots.py OUTDIR [WIDTH] [dark|light]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import gi  # noqa: E402

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
gi.require_version("Graphene", "1.0")
from gi.repository import Adw, Gdk, GLib, Graphene, Gtk  # noqa: E402

from hubless.gui.app import App  # noqa: E402

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
width = int(sys.argv[2]) if len(sys.argv) > 2 else 1000
scheme = sys.argv[3] if len(sys.argv) > 3 else "dark"
app = App(demo=True)


def render(widget, path):
    w, h = widget.get_width(), widget.get_height()
    bg = Gdk.RGBA()
    bg.parse("#222226" if scheme == "dark" else "#fafafb")
    snap = Gtk.Snapshot()
    snap.append_color(bg, Graphene.Rect().init(0, 0, w, h))
    Gtk.WidgetPaintable(widget=widget).snapshot(snap, w, h)
    tex = widget.get_native().get_renderer().render_texture(snap.to_node(), None)
    tex.save_to_png(str(path))


def go():
    win = app.props.active_window
    if not win or not win.session:
        return True
    pages = list(win.pages)

    def shoot(i=0):
        if i >= len(pages):
            render(win.get_content(), out / "window.png")
            app.quit()
            return False
        key = pages[i]
        win.stack.set_visible_child_name(key)

        def later():
            render(win.pages[key].get_child().get_child(), out / f"{i + 1}-{key}.png")
            render(win.get_content(), out / f"window-{i + 1}-{key}.png")
            GLib.idle_add(shoot, i + 1)
            return False
        GLib.timeout_add(400, later)
        return False

    GLib.timeout_add(600, shoot)
    return False


def startup(*_):
    Adw.StyleManager.get_default().set_color_scheme(
        Adw.ColorScheme.FORCE_DARK if scheme == "dark" else Adw.ColorScheme.FORCE_LIGHT)
    win = app.props.active_window
    if win:
        win.set_default_size(width, 820)
        win.set_resizable(False)  # tiling compositors float fixed-size windows, so the size sticks
    GLib.timeout_add(300, go)


app.connect("activate", startup)
app.run([sys.argv[0]])
