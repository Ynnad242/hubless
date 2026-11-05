"""Custom-drawn widgets: level meters, the trigger gauge, the mouse diagram and the click test pad."""
from __future__ import annotations

import math
import time

import cairo
from gi.repository import Adw, Gdk, GLib, GObject, Gtk

CYAN = (0.204, 0.827, 1.0)
VIOLET = (0.486, 0.424, 1.0)
STAGE_COLORS = ["#34d3ff", "#7c6cff", "#ff5ca8", "#ffb340", "#3ddc97"]


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def fg(widget) -> tuple[float, float, float]:
    c = widget.get_color()
    return c.red, c.green, c.blue


def is_dark() -> bool:
    return Adw.StyleManager.get_default().get_dark()


def rounded_rect(cr, x, y, w, h, r):
    r = max(0, min(r, w / 2, h / 2))
    cr.new_sub_path()
    cr.arc(x + w - r, y + r, r, -math.pi / 2, 0)
    cr.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
    cr.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
    cr.arc(x + r, y + r, r, math.pi, 3 * math.pi / 2)
    cr.close_path()


def brand_gradient(x0, y0, x1, y1):
    g = cairo.LinearGradient(x0, y0, x1, y1)
    g.add_color_stop_rgb(0, *CYAN)
    g.add_color_stop_rgb(1, *VIOLET)
    return g


def text(cr, s, x, y, size, weight=cairo.FONT_WEIGHT_NORMAL, align=0.0):
    cr.select_font_face("Sans", cairo.FONT_SLANT_NORMAL, weight)
    cr.set_font_size(size)
    ext = cr.text_extents(s)
    cr.move_to(x - ext.x_advance * align, y)
    cr.show_text(s)
    return ext


# --------------------------------------------------------------------------- level meter

class LevelMeter(Gtk.DrawingArea):
    """A row of glowing segments. Click or drag to pick a level; arrow keys work too.

    With lo == 0 the first segment is an "Off" pill.
    """

    __gsignals__ = {"changed": (GObject.SignalFlags.RUN_FIRST, None, (int,))}

    def __init__(self, lo: int, hi: int, label: str):
        super().__init__(accessible_role=Gtk.AccessibleRole.SLIDER, focusable=True, hexpand=True)
        self.lo, self.hi, self.value, self.hover = lo, hi, lo, None
        self.set_content_height(40)
        self.set_cursor_from_name("pointer")
        self.update_property([Gtk.AccessibleProperty.LABEL], [label])
        self.set_draw_func(self._draw)
        click = Gtk.GestureClick()
        click.connect("pressed", lambda _g, _n, x, _y: self._pick(x))
        self.add_controller(click)
        drag = Gtk.GestureDrag()
        drag.connect("drag-update", self._drag)
        self.add_controller(drag)
        motion = Gtk.EventControllerMotion()
        motion.connect("motion", lambda _c, x, _y: self._hover(self._value_at(x)))
        motion.connect("leave", lambda *_: self._hover(None))
        self.add_controller(motion)
        keys = Gtk.EventControllerKey()
        keys.connect("key-pressed", self._key)
        self.add_controller(keys)
        self._drag_start = 0
        self.connect("state-flags-changed", lambda *_: self.queue_draw())

    def set_range(self, lo, hi):
        self.lo, self.hi = lo, hi
        self.value = max(lo, min(hi, self.value))
        self.queue_draw()

    def set_value(self, v, emit=False):
        v = max(self.lo, min(self.hi, int(v)))
        changed = v != self.value
        self.value = v
        self.update_property([Gtk.AccessibleProperty.VALUE_NOW, Gtk.AccessibleProperty.VALUE_MIN,
                              Gtk.AccessibleProperty.VALUE_MAX], [float(v), float(self.lo), float(self.hi)])
        self.queue_draw()
        if emit and changed:
            self.emit("changed", v)

    def _segments(self, w):
        n = self.hi - self.lo + 1
        gap = 5
        off_w = 46 if self.lo == 0 else 0
        rest = w - off_w - (gap if off_w else 0)
        count = n - (1 if off_w else 0)
        seg = (rest - gap * (count - 1)) / count
        out = []
        x = 0
        if off_w:
            out.append((0, x, off_w))
            x += off_w + gap
        for i in range(count):
            out.append((self.lo + i + (1 if off_w else 0), x, seg))
            x += seg + gap
        return out

    def _value_at(self, x):
        for v, sx, sw in self._segments(self.get_width()):
            if x < sx + sw + 2.5:
                return v
        return self.hi

    def _pick(self, x):
        self.grab_focus()
        self._drag_start = x
        self.set_value(self._value_at(x), emit=True)

    def _drag(self, _g, dx, _dy):
        self.set_value(self._value_at(self._drag_start + dx), emit=True)

    def _hover(self, v):
        if v != self.hover:
            self.hover = v
            self.queue_draw()

    def _key(self, _c, keyval, _code, _state):
        step = {Gdk.KEY_Left: -1, Gdk.KEY_Down: -1, Gdk.KEY_Right: 1, Gdk.KEY_Up: 1}.get(keyval)
        if keyval == Gdk.KEY_Home:
            self.set_value(self.lo, emit=True)
        elif keyval == Gdk.KEY_End:
            self.set_value(self.hi, emit=True)
        elif step:
            self.set_value(self.value + step, emit=True)
        else:
            return False
        return True

    def _draw(self, _a, cr, w, h):
        ink = fg(self)
        sens = self.is_sensitive()
        segs = self._segments(w)
        top, bh = 6, h - 12
        n = len(segs)
        for k, (v, x, sw) in enumerate(segs):
            off_pill = self.lo == 0 and v == 0
            filled = (v <= self.value and v > 0) if self.lo == 0 else v <= self.value
            col = mix(CYAN, VIOLET, k / max(1, n - 1))
            if off_pill:
                rounded_rect(cr, x + 0.5, top + 0.5, sw - 1, bh - 1, 8)
                active = self.value == 0
                cr.set_source_rgba(*(VIOLET if active else ink), 0.9 if active else 0.25)
                cr.set_line_width(1.5)
                cr.stroke()
                cr.set_source_rgba(*ink, 0.9 if active else 0.45)
                text(cr, "Off", x + sw / 2, top + bh / 2 + 4, 11, cairo.FONT_WEIGHT_BOLD, 0.5)
                continue
            if filled and sens:
                rounded_rect(cr, x - 2, top - 2, sw + 4, bh + 4, 9)
                cr.set_source_rgba(*col, 0.18)
                cr.fill()
                rounded_rect(cr, x, top, sw, bh, 7)
                g = cairo.LinearGradient(0, top, 0, top + bh)
                g.add_color_stop_rgba(0, *mix(col, (1, 1, 1), 0.25), 1)
                g.add_color_stop_rgba(1, *col, 1)
                cr.set_source(g)
                cr.fill()
            else:
                rounded_rect(cr, x, top, sw, bh, 7)
                cr.set_source_rgba(*ink, 0.09 if sens else 0.05)
                cr.fill()
            if v == self.hover and sens:
                rounded_rect(cr, x + 0.5, top + 0.5, sw - 1, bh - 1, 7)
                cr.set_source_rgba(*ink, 0.5)
                cr.set_line_width(1)
                cr.stroke()
            if v == self.value and sens:
                cr.set_source_rgba(1, 1, 1, 0.95)
                text(cr, str(v), x + sw / 2, top + bh / 2 + 4.5, 12, cairo.FONT_WEIGHT_BOLD, 0.5)
        if self.has_focus() and self.get_focus_visible():
            rounded_rect(cr, 1, 1, w - 2, h - 2, 10)
            cr.set_source_rgba(*VIOLET, 0.8)
            cr.set_line_width(2)
            cr.stroke()


# --------------------------------------------------------------------------- trigger gauge

class TriggerGauge(Gtk.DrawingArea):
    """Vertical button travel: fill to the actuation point, rapid-trigger reset band, haptic ripples."""

    def __init__(self):
        super().__init__()
        self.set_content_width(120)
        self.set_content_height(170)
        self.act, self.rt, self.rt_on, self.hap = 5, 2, False, 3
        self.max_act, self.max_rt, self.max_hap = 10, 5, 5
        self.anim_from = 5.0
        self.anim_t0 = 0.0
        self.set_draw_func(self._draw)

    def update(self, hits, max_act=10, max_rt=5, max_hap=5):
        if hits.actuation != self.act:
            self.anim_from = self._shown_act()
            self.anim_t0 = time.monotonic()
            self.add_tick_callback(self._tick)
        self.act, self.rt, self.rt_on, self.hap = hits.actuation, hits.rt_level, hits.rt_on, hits.haptics
        self.max_act, self.max_rt, self.max_hap = max_act, max_rt, max_hap
        self.queue_draw()

    def _shown_act(self):
        t = min(1.0, (time.monotonic() - self.anim_t0) / 0.25)
        e = 1 - (1 - t) ** 3
        return self.anim_from + (self.act - self.anim_from) * e

    def _tick(self, *_):
        self.queue_draw()
        return GLib.SOURCE_CONTINUE if time.monotonic() - self.anim_t0 < 0.25 else GLib.SOURCE_REMOVE

    def _draw(self, _a, cr, w, h):
        ink = fg(self)
        tw = 34
        tx = w / 2 - tw / 2
        top, bot = 14, h - 14
        th = bot - top
        level_y = lambda lv: top + th * lv / (self.max_act + 1)
        # keycap track
        rounded_rect(cr, tx, top, tw, th, 12)
        cr.set_source_rgba(*ink, 0.08)
        cr.fill()
        ay = level_y(self._shown_act())
        # pressed portion
        rounded_rect(cr, tx, top, tw, ay - top, 12)
        cr.set_source(brand_gradient(0, top, 0, bot))
        cr.fill()
        # rapid trigger reset zone (the button only has to rise this far to re-arm)
        if self.rt_on:
            zone = th * self.rt / (2 * (self.max_act + 1))
            cr.rectangle(tx - 8, ay - zone, tw + 16, zone)
            cr.set_source_rgba(*CYAN, 0.16)
            cr.fill()
            cr.set_source_rgba(*CYAN, 0.9)
            cr.set_line_width(1.5)
            cr.set_dash([3, 3])
            cr.move_to(tx - 10, ay - zone)
            cr.line_to(tx + tw + 10, ay - zone)
            cr.stroke()
            cr.set_dash([])
        # actuation line
        cr.set_source_rgba(1, 1, 1, 0.95)
        cr.set_line_width(3)
        cr.move_to(tx - 12, ay)
        cr.line_to(tx + tw + 12, ay)
        cr.stroke()
        cr.arc(tx + tw + 12, ay, 4, 0, 2 * math.pi)
        cr.fill()
        # haptic ripples on the left
        for i in range(self.max_hap):
            on = i < self.hap
            r = 8 + i * 6
            cr.arc(tx - 6, top + th / 2, r, math.pi * 0.72, math.pi * 1.28)
            cr.set_source_rgba(*(VIOLET if on else ink), 0.85 - i * 0.1 if on else 0.08)
            cr.set_line_width(2)
            cr.stroke()


# --------------------------------------------------------------------------- mouse diagram

BUTTON_NAMES = ["Left button", "Right button", "Wheel click", "Back", "Forward"]
GTK_BUTTON = {1: 0, 3: 1, 2: 2, 8: 3, 9: 4}


class MouseView(Gtk.DrawingArea):
    """Top-down mouse with numbered buttons. Click one to edit it; real presses light it up."""

    def __init__(self, on_select=None):
        super().__init__()
        self.set_content_width(240)
        self.set_content_height(360)
        self.selected = -1
        self.hover = -1
        self.pressed: set[int] = set()
        self.on_select = on_select
        self.set_draw_func(self._draw)
        motion = Gtk.EventControllerMotion()
        motion.connect("motion", lambda _c, x, y: self._set_hover(self._hit(x, y)))
        motion.connect("leave", lambda *_: self._set_hover(-1))
        self.add_controller(motion)
        click = Gtk.GestureClick(button=0)
        click.connect("pressed", self._pressed)
        click.connect("released", self._released)
        self.add_controller(click)
        self.set_cursor_from_name("pointer")
        self.update_property([Gtk.AccessibleProperty.LABEL], ["Mouse buttons"])

    def _transform(self, cr, w, h):
        s = min(w / 220, h / 330)
        cr.translate((w - 220 * s) / 2, (h - 330 * s) / 2)
        cr.scale(s, s)

    def _body(self, cr):
        cr.move_to(110, 14)
        cr.curve_to(165, 14, 192, 52, 194, 118)
        cr.curve_to(196, 190, 192, 262, 170, 296)
        cr.curve_to(152, 320, 68, 320, 50, 296)
        cr.curve_to(28, 262, 24, 190, 26, 118)
        cr.curve_to(28, 52, 55, 14, 110, 14)
        cr.close_path()

    def _half(self, cr, left):
        cr.save()
        if not left:
            cr.translate(220, 0)
            cr.scale(-1, 1)
        cr.move_to(106, 17)
        cr.curve_to(60, 19, 32, 56, 30, 118)
        cr.line_to(30, 132)
        cr.curve_to(60, 140, 90, 142, 106, 142)
        cr.close_path()
        cr.restore()

    def _region(self, cr, key):
        if key == 0:
            self._half(cr, True)
        elif key == 1:
            self._half(cr, False)
        elif key == 2:
            rounded_rect(cr, 100, 52, 20, 56, 10)
        elif key == 3:
            rounded_rect(cr, 20, 150, 13, 44, 6)
        elif key == 4:
            rounded_rect(cr, 20, 98, 13, 44, 6)

    BADGES = {0: (68, 82), 1: (152, 82), 2: (110, 128), 3: (54, 172), 4: (54, 120)}

    def _hit(self, x, y):
        surf = cairo.ImageSurface(cairo.FORMAT_A8, 1, 1)
        cr = cairo.Context(surf)
        self._transform(cr, self.get_width(), self.get_height())
        ux, uy = cr.device_to_user(x, y)
        for key in (2, 3, 4, 0, 1):
            cr.new_path()
            self._region(cr, key)
            if cr.in_fill(ux, uy):
                return key
        return -1

    def _set_hover(self, i):
        if i != self.hover:
            self.hover = i
            self.queue_draw()

    def _pressed(self, gesture, _n, x, y):
        b = GTK_BUTTON.get(gesture.get_current_button())
        if b is not None:
            self.pressed.add(b)
        i = self._hit(x, y)
        if i >= 0 and gesture.get_current_button() == 1 and self.on_select:
            self.on_select(i)
        self.queue_draw()

    def _released(self, gesture, *_):
        self.pressed.discard(GTK_BUTTON.get(gesture.get_current_button()))
        self.queue_draw()

    def select(self, i):
        self.selected = i
        self.queue_draw()

    def _draw(self, _a, cr, w, h):
        ink = fg(self)
        dark = is_dark()
        self._transform(cr, w, h)
        # soft floor glow
        cr.save()
        cr.translate(110, 302)
        cr.scale(1, 0.18)
        g = cairo.RadialGradient(0, 0, 4, 0, 0, 100)
        g.add_color_stop_rgba(0, *VIOLET, 0.45)
        g.add_color_stop_rgba(1, *VIOLET, 0)
        cr.set_source(g)
        cr.arc(0, 0, 100, 0, 2 * math.pi)
        cr.fill()
        cr.restore()
        cr.new_path()
        self._body(cr)
        body = cairo.LinearGradient(0, 14, 0, 320)
        if dark:
            body.add_color_stop_rgb(0, 0.20, 0.20, 0.24)
            body.add_color_stop_rgb(1, 0.11, 0.11, 0.14)
        else:
            body.add_color_stop_rgb(0, 0.98, 0.98, 0.99)
            body.add_color_stop_rgb(1, 0.86, 0.87, 0.90)
        cr.set_source(body)
        cr.fill_preserve()
        cr.set_source_rgba(*ink, 0.22)
        cr.set_line_width(1.5)
        cr.stroke()
        # light strip
        cr.move_to(70, 252)
        cr.curve_to(95, 264, 125, 264, 150, 252)
        cr.set_source(brand_gradient(70, 0, 150, 0))
        cr.set_line_width(3)
        cr.stroke()
        for key in range(5):
            cr.new_path()
            self._region(cr, key)
            sel, hot, down = key == self.selected, key == self.hover, key in self.pressed
            if down:
                cr.set_source(brand_gradient(0, 0, 220, 330))
            elif sel:
                cr.set_source_rgba(*VIOLET, 0.35)
            elif hot:
                cr.set_source_rgba(*VIOLET, 0.16)
            else:
                cr.set_source_rgba(*ink, 0.05 if key < 2 else 0.14)
            cr.fill_preserve()
            cr.set_source_rgba(*(VIOLET if sel else ink), 1 if sel else 0.22)
            cr.set_line_width(2 if sel else 1)
            cr.stroke()
        cr.set_source_rgba(*ink, 0.3)
        cr.set_line_width(1)
        for yy in range(60, 104, 6):
            cr.move_to(104, yy)
            cr.line_to(116, yy)
        cr.stroke()
        for key, (bx, by) in self.BADGES.items():
            sel = key == self.selected
            cr.new_path()
            cr.arc(bx, by, 9, 0, 2 * math.pi)
            if sel:
                cr.set_source(brand_gradient(bx - 9, by - 9, bx + 9, by + 9))
            else:
                cr.set_source_rgba(*(0.16, 0.16, 0.2) if dark else (1, 1, 1), 0.95)
            cr.fill_preserve()
            cr.set_source_rgba(*(VIOLET if sel else ink), 0.9 if sel else 0.35)
            cr.set_line_width(1.2)
            cr.stroke()
            cr.set_source_rgba(*((1, 1, 1) if sel else ink), 1)
            text(cr, str(key + 1), bx, by + 4, 11, cairo.FONT_WEIGHT_BOLD, 0.5)


# --------------------------------------------------------------------------- click test pad

class TestPad(Gtk.DrawingArea):
    """Click here to feel the settings: clicks per second, hold time, ripples."""

    def __init__(self):
        super().__init__(hexpand=True, focusable=True)
        self.set_content_height(150)
        self.ripples: list[tuple[float, float, float, int]] = []
        self.clicks = {0: [], 1: []}
        self.down = {}
        self.hold_ms = {0: None, 1: None}
        self.best = {0: 0, 1: 0}
        click = Gtk.GestureClick(button=0)
        click.connect("pressed", self._press)
        click.connect("released", self._release)
        self.add_controller(click)
        self.set_draw_func(self._draw)
        self._tick = None

    def _btn(self, g):
        return {1: 0, 3: 1}.get(g.get_current_button())

    def _press(self, g, _n, x, y):
        b = self._btn(g)
        if b is None:
            return
        now = time.monotonic()
        self.down[b] = now
        self.clicks[b].append(now)
        self.ripples.append((x, y, now, b))
        if self._tick is None:
            self._tick = self.add_tick_callback(self._on_tick)

    def _release(self, g, *_):
        b = self._btn(g)
        if b in self.down:
            self.hold_ms[b] = (time.monotonic() - self.down.pop(b)) * 1000
            self.queue_draw()

    def _on_tick(self, *_):
        now = time.monotonic()
        self.ripples = [r for r in self.ripples if now - r[2] < 0.6]
        for b in (0, 1):
            self.clicks[b] = [t for t in self.clicks[b] if now - t < 1.0]
            self.best[b] = max(self.best[b], len(self.clicks[b]))
        self.queue_draw()
        if not self.ripples and not any(self.clicks.values()):
            self._tick = None
            return GLib.SOURCE_REMOVE
        return GLib.SOURCE_CONTINUE

    def reset(self):
        self.best = {0: 0, 1: 0}
        self.hold_ms = {0: None, 1: None}
        self.queue_draw()

    def _draw(self, _a, cr, w, h):
        ink = fg(self)
        rounded_rect(cr, 1, 1, w - 2, h - 2, 14)
        cr.set_source_rgba(*ink, 0.035)
        cr.fill_preserve()
        cr.set_source_rgba(*VIOLET, 0.35)
        cr.set_dash([6, 5])
        cr.set_line_width(1.2)
        cr.stroke()
        cr.set_dash([])
        cr.move_to(w / 2, 22)
        cr.line_to(w / 2, h - 36)
        cr.set_source_rgba(*ink, 0.08)
        cr.stroke()
        now = time.monotonic()
        for x, y, t0, b in self.ripples:
            k = (now - t0) / 0.6
            cr.arc(x, y, 8 + 55 * k, 0, 2 * math.pi)
            cr.set_source_rgba(*(CYAN if b == 0 else VIOLET), 0.7 * (1 - k))
            cr.set_line_width(2.5)
            cr.stroke()
        for b, cx, title in ((0, w * 0.25, "LEFT"), (1, w * 0.75, "RIGHT")):
            cps = len(self.clicks[b])
            cr.set_source_rgba(*ink, 0.5)
            text(cr, title, cx, h / 2 - 36, 11, cairo.FONT_WEIGHT_BOLD, 0.5)
            if cps:
                cr.set_source(brand_gradient(cx - 30, 0, cx + 30, 0))
            else:
                cr.set_source_rgba(*ink, 0.3)
            text(cr, str(cps), cx, h / 2 + 8, 40, cairo.FONT_WEIGHT_BOLD, 0.5)
            cr.set_source_rgba(*ink, 0.55)
            hold = self.hold_ms[b]
            sub = f"clicks/s · best {self.best[b]}" + (f" · held {hold:.0f} ms" if hold is not None else "")
            text(cr, sub, cx, h / 2 + 30, 11, align=0.5)
        if not any(self.best.values()):
            cr.set_source_rgba(*ink, 0.45)
            text(cr, "Click here with either button to feel your settings", w / 2, h - 14, 12, align=0.5)
