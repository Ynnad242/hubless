"""The five main pages: Triggers (HITS), Sensor, Buttons, Profiles and Device."""
from __future__ import annotations

import math

import cairo
from gi.repository import Adw, Gio, GLib, Gtk

from .. import profile as P
from .. import storage
from ..device import F_HITS
from .widgets import BUTTON_NAMES, LevelMeter, MouseView, TestPad, TriggerGauge, brand_gradient, fg, text


# --------------------------------------------------------------------------- building blocks

def page_shell(title, subtitle, width=920):
    """Scrollable page with a big heading. Returns (clamp, content box)."""
    content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=28)
    hero = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6, css_classes=["page-hero"])
    hero.append(Gtk.Label(label=title, xalign=0, css_classes=["page-title"]))
    hero.append(Gtk.Label(label=subtitle, xalign=0, wrap=True, css_classes=["page-subtitle"]))
    content.append(hero)
    c = Adw.Clamp(maximum_size=width, tightening_threshold=640, child=content)
    c.set_margin_top(8)
    c.set_margin_bottom(40)
    c.set_margin_start(20)
    c.set_margin_end(20)
    return c, content


def panel(title=None, subtitle=None, suffix=None):
    """A titled card. Returns (outer box, inner body box)."""
    outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
    if title:
        head = Gtk.Box(spacing=12)
        titles = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, hexpand=True, valign=Gtk.Align.CENTER)
        titles.append(Gtk.Label(label=title, xalign=0, css_classes=["section-title"]))
        if subtitle:
            titles.append(Gtk.Label(label=subtitle, xalign=0, wrap=True, css_classes=["section-subtitle"]))
        head.append(titles)
        if suffix:
            suffix.set_valign(Gtk.Align.CENTER)
            head.append(suffix)
        outer.append(head)
    body = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12, css_classes=["panel"])
    outer.append(body)
    return outer, body


def meter_row(meter, left, right):
    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
    box.append(meter)
    ends = Gtk.Box()
    ends.append(Gtk.Label(label=left, xalign=0, hexpand=True, css_classes=["meter-end"]))
    ends.append(Gtk.Label(label=right, xalign=1, css_classes=["meter-end"]))
    box.append(ends)
    return box


def value_badge():
    return Gtk.Label(css_classes=["value-badge", "numeric"], valign=Gtk.Align.CENTER)


def clickable(widget, cb):
    g = Gtk.GestureClick()
    g.connect("released", lambda *_: cb())
    widget.add_controller(g)
    widget.set_cursor_from_name("pointer")


class Page(Gtk.ScrolledWindow):
    def __init__(self, win):
        super().__init__(hscrollbar_policy=Gtk.PolicyType.NEVER)
        self.win = win
        self._loading = False

    def load(self, session):
        pass

    def saved(self, session):
        pass

    def status_changed(self, session):
        pass

    @property
    def draft(self) -> P.Profile:
        return self.win.draft


# --------------------------------------------------------------------------- Triggers

PRESETS = [
    ("Balanced", "Factory feel", P.Hits(5, 3, False, 3)),
    ("Fast tap", "Shallow, rapid trigger", P.Hits(2, 1, True, 3)),
    ("Spam click", "Shallowest, quickest reset", P.Hits(1, 1, True, 2)),
    ("Deliberate", "Deep, no misclicks", P.Hits(8, 3, False, 4)),
    ("Silent", "No haptic click", P.Hits(5, 3, False, 0)),
]


class TriggerCard(Gtk.Box):
    def __init__(self, title, on_click):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=10, css_classes=["trigger-card"],
                         hexpand=True)
        head = Gtk.Box()
        head.append(Gtk.Label(label=title, xalign=0, hexpand=True, css_classes=["trigger-title"]))
        self.state = Gtk.Label(label="EDITING", css_classes=["chip", "live"])
        head.append(self.state)
        self.append(head)
        self.gauge = TriggerGauge()
        self.append(self.gauge)
        stats = Gtk.Box(homogeneous=True, css_classes=["stats"])
        self.stats = []
        for cap in ("Actuation", "Rapid", "Haptic"):
            b = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
            v = Gtk.Label(css_classes=["stat-value", "numeric"])
            b.append(v)
            b.append(Gtk.Label(label=cap.upper(), css_classes=["stat-caption"]))
            stats.append(b)
            self.stats.append(v)
        self.append(stats)
        clickable(self, on_click)

    def show(self, h, caps, selected):
        self.gauge.update(h, caps["actuation"], caps["rt"], caps["haptics"])
        self.stats[0].set_label(str(h.actuation))
        self.stats[1].set_label(str(h.rt_level) if h.rt_on else "Off")
        self.stats[2].set_label(str(h.haptics) if h.haptics else "Off")
        self.state.set_visible(selected)
        if selected:
            self.add_css_class("selected")
        else:
            self.remove_css_class("selected")


class TriggersPage(Page):
    def __init__(self, win):
        super().__init__(win)
        self.target = "both"
        self.caps = {"actuation": 10, "rt": 5, "haptics": 5}
        self._preview_pending = None
        self._preview_busy = False
        clamp, content = page_shell(
            "Triggers", "Your main buttons are analog. Choose how deep a click registers, how fast it re-arms "
                        "and how the click feels. You feel every change instantly.")

        cards = Gtk.Box(css_classes=["trigger-row"])
        self.left = TriggerCard("LEFT", lambda: self.set_target("left"))
        self.right = TriggerCard("RIGHT", lambda: self.set_target("right"))
        mid = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, valign=Gtk.Align.CENTER, margin_start=12,
                      margin_end=12)
        self.link = Gtk.ToggleButton(icon_name="hubless-link-symbolic", active=True,
                                     css_classes=["link-btn", "circular"], tooltip_text="Edit both buttons together")
        self.link.connect("toggled", self._on_link)
        mid.append(self.link)
        cards.append(self.left)
        cards.append(mid)
        cards.append(self.right)
        self.hint = Gtk.Label(css_classes=["caption", "dim-label"])
        top = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        top.append(cards)
        top.append(self.hint)
        content.append(top)

        self.act_badge = value_badge()
        box, body = panel("Actuation point", "How far you press before the click registers", self.act_badge)
        self.act = LevelMeter(1, 10, "Actuation point")
        self.act.connect("changed", lambda _m, v: self._set("actuation", v))
        body.append(meter_row(self.act, "Light touch", "Deep press"))
        content.append(box)

        self.rt_switch = Gtk.Switch(tooltip_text="Rapid Trigger")
        self.rt_switch.connect("notify::active", lambda sw, _p: self._set("rt_on", sw.get_active()))
        box, body = panel("Rapid Trigger", "Releases the click the moment the button starts rising, so the "
                                           "next click can land sooner", self.rt_switch)
        self.rt = LevelMeter(1, 5, "Rapid trigger reset distance")
        self.rt.connect("changed", lambda _m, v: self._set("rt_level", v))
        self.rt_box = meter_row(self.rt, "Instant reset", "Longer reset")
        body.append(self.rt_box)
        content.append(box)

        self.hap_badge = value_badge()
        box, body = panel("Haptic click", "Strength of the vibration that simulates a mechanical click",
                          self.hap_badge)
        self.hap = LevelMeter(0, 5, "Haptic strength")
        self.hap.connect("changed", lambda _m, v: self._set("haptics", v))
        body.append(meter_row(self.hap, "", "Strong"))
        content.append(box)

        reset = Gtk.Button(icon_name="edit-undo-symbolic", tooltip_text="Reset counters", css_classes=["flat"])
        box, body = panel("Try it", "Click inside with your left or right button", reset)
        self.pad = TestPad()
        reset.connect("clicked", lambda *_: self.pad.reset())
        body.append(self.pad)
        body.add_css_class("panel-flush")
        content.append(box)

        box, body = panel("Presets")
        body.remove_css_class("panel")
        flow = Gtk.FlowBox(selection_mode=Gtk.SelectionMode.NONE, column_spacing=10, row_spacing=10,
                           max_children_per_line=5, min_children_per_line=2, homogeneous=True)
        for name, desc, h in PRESETS:
            b = Gtk.Button(css_classes=["preset"])
            bx = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
            bx.append(Gtk.Label(label=name, css_classes=["heading"], xalign=0))
            bx.append(Gtk.Label(label=desc, css_classes=["caption", "dim-label"], xalign=0, wrap=True))
            b.set_child(bx)
            b.connect("clicked", lambda *_a, h=h: self._apply(h, h))
            flow.append(b)
        body.append(flow)
        content.append(box)

        g = Adw.PreferencesGroup(title="HITS code", description="Share settings with G HUB users and teammates.")
        self.code_row = Adw.EntryRow(title="Paste a HITS code", show_apply_button=True)
        self.code_row.connect("apply", self._apply_code)
        g.add(self.code_row)
        self.copy_row = Adw.ActionRow(title="Your code", subtitle_selectable=True, css_classes=["property"])
        copy = Gtk.Button(icon_name="edit-copy-symbolic", tooltip_text="Copy code", valign=Gtk.Align.CENTER,
                          css_classes=["flat"])
        copy.connect("clicked", self._copy_code)
        self.copy_row.add_suffix(copy)
        g.add(self.copy_row)
        content.append(g)
        self.set_child(clamp)

    def _buttons(self):
        return {"both": [0, 1], "left": [0], "right": [1]}[self.target]

    def _on_link(self, b):
        if not self._loading:
            self.set_target("both" if b.get_active() else ("right" if self.target == "right" else "left"))

    def set_target(self, target):
        self.target = target
        self._loading = True
        self.link.set_active(target == "both")
        self._loading = False
        self._show()

    def load(self, session):
        if not self.draft or not self.draft.hits:
            return
        self.caps = session.hits_caps or self.caps
        self.act.set_range(1, self.caps["actuation"])
        self.rt.set_range(1, self.caps["rt"])
        self.hap.set_range(0, self.caps["haptics"])
        self._show()

    def saved(self, session):
        self._update_code()

    def _show(self):
        if not self.draft or not self.draft.hits:
            return
        self._loading = True
        targets = self._buttons()
        h = self.draft.hits[targets[0]]
        self.act.set_value(h.actuation)
        self.rt_switch.set_active(h.rt_on)
        self.rt.set_value(h.rt_level)
        self.rt_box.set_sensitive(h.rt_on)
        self.hap.set_value(h.haptics)
        self._loading = False
        self.act_badge.set_label(str(h.actuation))
        self.hap_badge.set_label(str(h.haptics) if h.haptics else "Off")
        self.left.show(self.draft.hits[0], self.caps, 0 in targets)
        self.right.show(self.draft.hits[1], self.caps, 1 in targets)
        if self.target == "both":
            same = self.draft.hits[0] == self.draft.hits[1]
            self.hint.set_label("Editing both buttons" + ("" if same else " · they differ, changes apply to both"))
        else:
            self.hint.set_label(f"Editing the {self.target} button only · press the link to edit both")
        self._update_code()

    def _update_code(self):
        if self.draft and self.draft.hits:
            self.copy_row.set_subtitle(P.hits_code(*self.draft.hits))

    def _set(self, field, value):
        if self._loading or not self.draft or not self.draft.hits:
            return
        for b in self._buttons():
            setattr(self.draft.hits[b], field, value)
        self._show()
        self._preview()
        self.win.changed()

    def _apply(self, left, right):
        if not self.draft or not self.draft.hits:
            return
        if 0 in self._buttons():
            self.draft.hits[0] = P.Hits(**vars(left))
        if 1 in self._buttons():
            self.draft.hits[1] = P.Hits(**vars(right))
        self._show()
        self._preview()
        self.win.changed()

    def _apply_code(self, row):
        try:
            left, right = P.parse_hits_code(row.get_text())
        except ValueError as e:
            self.win.toast(str(e))
            return
        self.set_target("both")
        self._apply(left, right)
        row.set_text("")
        self.win.toast("HITS code applied")

    def _copy_code(self, *_):
        self.get_clipboard().set(self.copy_row.get_subtitle())
        self.win.toast("Code copied")

    def _preview(self):
        """Push HITS straight to the mouse while editing, coalescing to the latest value."""
        if not self.win.editing_active:
            return
        self._preview_pending = [P.Hits(**vars(h)) for h in self.draft.hits]
        if self._preview_busy:
            return
        self._preview_busy = True
        s = self.win.session

        def job():
            while self._preview_pending:
                hits, self._preview_pending = self._preview_pending, None
                for b, h in enumerate(hits):
                    s.preview_hits(b, h)

        def done(*_):
            self._preview_busy = False

        self.win.worker.run(job, done, done)


# --------------------------------------------------------------------------- Sensor

SLEEP_CHOICES = [(30, "30 seconds"), (60, "1 minute"), (120, "2 minutes"), (300, "5 minutes"),
                 (600, "10 minutes"), (900, "15 minutes")]
LOD = ["Low (1 mm)", "Medium (2 mm)", "High (3 mm)"]
QUICK_DPI = [400, 800, 1200, 1600, 3200, 6400]


def short_hz(hz):
    return f"{hz // 1000}K" if hz >= 1000 and hz % 1000 == 0 else str(hz)


def spaced(n):
    return f"{n:,}".replace(",", " ")


class StageTile(Gtk.Button):
    def __init__(self, i, on_click):
        super().__init__(css_classes=["stage-tile", f"stage-{i + 1}"], hexpand=True)
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
        top = Gtk.Box(spacing=6)
        top.append(Gtk.Box(css_classes=["stage-dot"], valign=Gtk.Align.CENTER))
        top.append(Gtk.Label(label=f"STAGE {i + 1}", xalign=0, hexpand=True, css_classes=["stage-name"]))
        box.append(top)
        self.value = Gtk.Label(xalign=0, css_classes=["stage-value", "numeric"])
        box.append(self.value)
        self.sub = Gtk.Label(xalign=0, css_classes=["stage-sub"])
        box.append(self.sub)
        self.set_child(box)
        self.connect("clicked", lambda *_: on_click(i))

    def show(self, stage: P.Stage, default, in_use, selected):
        self.value.set_label(spaced(stage.x) if stage.enabled else "—")
        tags = ["DPI"] if stage.enabled else ["OFF · TAP TO ADD"]
        if stage.enabled and default:
            tags.append("START")
        if stage.enabled and in_use:
            tags.append("● LIVE")
        self.sub.set_label(" · ".join(tags))
        for cls, on in (("selected", selected), ("off", not stage.enabled)):
            if on:
                self.add_css_class(cls)
            else:
                self.remove_css_class(cls)


class SensorPage(Page):
    def __init__(self, win):
        super().__init__(win)
        self.sel = 0
        self.rates: list[int] = []
        clamp, content = page_shell("Sensor", "Set the speeds your DPI button cycles through, how often the mouse "
                                              "reports, and how it tracks.")
        box, body = panel("DPI stages", "Pick a stage to edit it")
        body.remove_css_class("panel")
        tiles = Gtk.FlowBox(selection_mode=Gtk.SelectionMode.NONE, homogeneous=True, column_spacing=10,
                            row_spacing=10, min_children_per_line=2, max_children_per_line=5)
        self.tiles = [StageTile(i, self.select_stage) for i in range(5)]
        for t in self.tiles:
            tiles.append(t)
        body.append(tiles)
        content.append(box)

        box, body = panel()
        top = Gtk.Box(spacing=12)
        self.editor_title = Gtk.Label(xalign=0, hexpand=True, css_classes=["section-title"])
        top.append(self.editor_title)
        self.start_btn = Gtk.Button(css_classes=["pill-small"], valign=Gtk.Align.CENTER)
        self.start_btn.connect("clicked", lambda *_: self._make_default())
        top.append(self.start_btn)
        self.include = Gtk.Switch(valign=Gtk.Align.CENTER, tooltip_text="Include this stage in the DPI cycle")
        self.include.connect("notify::active", self._on_include)
        top.append(self.include)
        body.append(top)
        big = Gtk.Box(spacing=14)
        self.dpi_spin = Gtk.SpinButton(adjustment=Gtk.Adjustment(lower=100, upper=44000, step_increment=50,
                                                                 page_increment=400),
                                       numeric=True, css_classes=["dpi-spin"], valign=Gtk.Align.CENTER)
        self.dpi_spin.connect("value-changed", self._on_spin)
        big.append(self.dpi_spin)
        big.append(Gtk.Label(label="DPI", css_classes=["dpi-unit"], valign=Gtk.Align.CENTER))
        self.dpi_scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 1000, 1)
        self.dpi_scale.set_draw_value(False)
        self.dpi_scale.set_hexpand(True)
        self.dpi_scale.set_valign(Gtk.Align.CENTER)
        self.dpi_scale.add_css_class("dpi-scale")
        self.dpi_scale.connect("value-changed", self._on_scale)
        big.append(self.dpi_scale)
        body.append(big)
        chips = Gtk.FlowBox(selection_mode=Gtk.SelectionMode.NONE, column_spacing=6, row_spacing=6,
                            max_children_per_line=6)
        for v in QUICK_DPI:
            b = Gtk.Button(label=str(v), css_classes=["chip-btn"])
            b.connect("clicked", lambda _b, v=v: self.set_dpi(v))
            chips.append(b)
        body.append(chips)
        xy = Gtk.Box(spacing=12)
        xy.append(Gtk.Label(label="Separate vertical DPI", xalign=0, hexpand=True))
        self.y_spin = Gtk.SpinButton(adjustment=Gtk.Adjustment(lower=100, upper=44000, step_increment=50,
                                                               page_increment=400), numeric=True, visible=False)
        self.y_spin.connect("value-changed", self._on_y)
        xy.append(self.y_spin)
        self.xy_switch = Gtk.Switch(valign=Gtk.Align.CENTER)
        self.xy_switch.connect("notify::active", self._on_xy)
        xy.append(self.xy_switch)
        body.append(xy)
        content.append(box)

        box, body = panel("Polling rate", "How often the mouse reports its position, in Hz. Higher feels smoother "
                                          "and uses more battery.")
        self.rate_group = Adw.ToggleGroup(css_classes=["rates"], homogeneous=True)
        self.rate_group.connect("notify::active-name", self._on_rate)
        body.append(self.rate_group)
        content.append(box)

        g = Adw.PreferencesGroup(title="Tracking and power")
        self.wired_row = Adw.ComboRow(title="Polling rate with cable",
                                      model=Gtk.StringList.new(["125 Hz", "250 Hz", "500 Hz", "1000 Hz"]))
        self.wired_row.connect("notify::selected", self._on_wired)
        g.add(self.wired_row)
        self.shift_row = Adw.ComboRow(title="DPI shift stage",
                                      subtitle="Used while a button set to “DPI shift (hold)” is held",
                                      model=Gtk.StringList.new([f"Stage {i + 1}" for i in range(5)]))
        self.shift_row.connect("notify::selected", self._on_shift)
        g.add(self.shift_row)
        self.lod_row = Adw.ComboRow(title="Lift-off distance",
                                    subtitle="How high you can lift the mouse before it stops tracking",
                                    model=Gtk.StringList.new(LOD))
        self.lod_row.connect("notify::selected", self._on_lod)
        g.add(self.lod_row)
        self.angle_row = Adw.SwitchRow(title="Angle snapping",
                                       subtitle="Straightens wobbly lines. Most players leave it off.")
        self.angle_row.connect("notify::active", self._on_angle)
        g.add(self.angle_row)
        self.sleep_row = Adw.ComboRow(title="Sleep after", subtitle="Idle time before the mouse dozes off",
                                      model=Gtk.StringList.new([t for _, t in SLEEP_CHOICES]))
        self.sleep_row.connect("notify::selected", self._on_sleep)
        g.add(self.sleep_row)
        content.append(g)
        self.set_child(clamp)

    # log-scale slider <-> DPI
    def _to_pos(self, dpi):
        g = self.win.session.grid
        return 1000 * math.log(max(dpi, g.min) / g.min) / math.log(g.max / g.min)

    def _from_pos(self, pos):
        g = self.win.session.grid
        return g.snap(g.min * (g.max / g.min) ** (pos / 1000))

    def load(self, session):
        p = self.draft
        if not p:
            return
        self._loading = True
        g = session.grid
        for spin in (self.dpi_spin, self.y_spin):
            spin.get_adjustment().set_lower(g.min)
            spin.get_adjustment().set_upper(g.max)
        self.sel = p.default_stage
        self.rates = sorted(session.rates)
        while (t := self.rate_group.get_toggle(0)) is not None:
            self.rate_group.remove(t)
        for hz in self.rates:
            self.rate_group.add(Adw.Toggle(name=str(hz), label=short_hz(hz), tooltip=f"{hz} Hz"))
        self.rate_group.set_active_name(str(p.rate_hz))
        fmt8 = p.fmt == 8
        self.wired_row.set_visible(fmt8 and p.rate_wired_hz is not None)
        if p.rate_wired_hz:
            self.wired_row.set_selected([125, 250, 500, 1000].index(min(p.rate_wired_hz, 1000)))
        self.shift_row.set_selected(p.shift_stage)
        self.lod_row.set_visible(fmt8)
        self.lod_row.set_selected(max(0, min(2, p.stages[p.default_stage].lod - 1)))
        self.angle_row.set_active(p.angle_snap)
        self.sleep_row.set_visible(p.sleep_s is not None)
        if p.sleep_s is not None:
            secs = [s for s, _ in SLEEP_CHOICES]
            self.sleep_row.set_selected(min(range(len(secs)), key=lambda k: abs(secs[k] - p.sleep_s)))
        self._loading = False
        self._refresh()

    def status_changed(self, session):
        self._refresh()

    def _refresh(self):
        p = self.draft
        if not p:
            return
        s = self.win.session
        for i, t in enumerate(self.tiles):
            t.show(p.stages[i], i == p.default_stage, self.win.editing_active and s.stage == i, i == self.sel)
        st = p.stages[self.sel]
        self._loading = True
        self.editor_title.set_label(f"Stage {self.sel + 1}")
        self.include.set_active(st.enabled)
        dpi = st.x if st.enabled else 800
        self.dpi_spin.set_value(dpi)
        self.dpi_scale.set_value(self._to_pos(dpi))
        self.xy_switch.set_active(st.enabled and st.y != st.x)
        self.y_spin.set_visible(self.xy_switch.get_active())
        self.y_spin.set_value(st.y if st.enabled else dpi)
        is_default = p.default_stage == self.sel
        self.start_btn.set_label("Starts here" if is_default else "Start with this stage")
        self.start_btn.set_sensitive(not is_default)
        self._loading = False

    def select_stage(self, i):
        self.sel = i
        self._refresh()

    def set_dpi(self, dpi):
        dpi = self.win.session.grid.snap(dpi)
        st = self.draft.stages[self.sel]
        y = st.y if self.xy_switch.get_active() and st.enabled else dpi
        self.draft.stages[self.sel] = P.Stage(dpi, y, st.lod or 2)
        self._refresh()
        self.win.changed()

    def _on_spin(self, spin):
        if not self._loading:
            self.set_dpi(spin.get_value())

    def _on_scale(self, scale):
        if not self._loading:
            self.set_dpi(self._from_pos(scale.get_value()))

    def _on_include(self, sw, _p):
        if self._loading:
            return
        p = self.draft
        st = p.stages[self.sel]
        if not sw.get_active():
            if p.stage_count <= 1:
                self.win.toast("At least one DPI stage has to stay on.")
                self._refresh()
                return
            p.stages[self.sel] = P.Stage(0, 0, st.lod or 2)
            self.win.toast("Stage removed. The others moved up, since the mouse cycles stages in order.")
        else:
            dpi = self.win.session.grid.snap(self.dpi_spin.get_value())
            p.stages[self.sel] = P.Stage(dpi, dpi, st.lod or 2)
        self._pack(keep=self.sel if sw.get_active() else None)
        self.win.changed()

    def _pack(self, keep=None):
        """Stages are cycled in order with no gaps; keep the UI in the same shape as the mouse."""
        p = self.draft
        before = [id(s) for s in p.stages]
        p.pack_stages()
        if keep is not None:
            self.sel = next(i for i, s in enumerate(p.stages) if id(s) == before[keep])
        else:
            self.sel = min(self.sel, max(0, p.stage_count - 1))
        self._refresh()

    def _make_default(self):
        p = self.draft
        if not p.stages[self.sel].enabled:
            dpi = self.win.session.grid.snap(self.dpi_spin.get_value())
            p.stages[self.sel] = P.Stage(dpi, dpi, p.stages[self.sel].lod or 2)
            p.default_stage = self.sel
            self._pack(keep=self.sel)
        else:
            p.default_stage = self.sel
            self._refresh()
        self.win.changed()

    def _on_xy(self, sw, _p):
        self.y_spin.set_visible(sw.get_active())
        if self._loading:
            return
        st = self.draft.stages[self.sel]
        if not sw.get_active() and st.enabled:
            self.draft.stages[self.sel] = P.Stage(st.x, st.x, st.lod)
            self.win.changed()

    def _on_y(self, spin):
        if self._loading:
            return
        st = self.draft.stages[self.sel]
        if st.enabled:
            self.draft.stages[self.sel] = P.Stage(st.x, self.win.session.grid.snap(spin.get_value()), st.lod)
            self.win.changed()

    def _on_rate(self, group, _p):
        if self._loading or not group.get_active_name():
            return
        self.draft.rate_hz = int(group.get_active_name())
        self.win.changed()

    def _on_wired(self, row, _p):
        if not self._loading:
            self.draft.rate_wired_hz = [125, 250, 500, 1000][row.get_selected()]
            self.win.changed()

    def _on_shift(self, row, _p):
        if not self._loading:
            self.draft.shift_stage = row.get_selected()
            self.win.changed()

    def _on_lod(self, row, _p):
        if not self._loading:
            lod = row.get_selected() + 1
            self.draft.stages = [P.Stage(s.x, s.y, lod) for s in self.draft.stages]
            self.win.changed()

    def _on_angle(self, row, _p):
        if not self._loading:
            self.draft.angle_snap = row.get_active()
            self.win.changed()

    def _on_sleep(self, row, _p):
        if not self._loading:
            self.draft.sleep_s = SLEEP_CHOICES[row.get_selected()][0]
            self.draft.off_s = max(self.draft.off_s or 300, self.draft.sleep_s)
            self.win.changed()


# --------------------------------------------------------------------------- Buttons

class BindingRow(Gtk.Button):
    def __init__(self, i, on_click):
        super().__init__(css_classes=["binding"])
        box = Gtk.Box(spacing=14)
        box.append(Gtk.Label(label=str(i + 1), css_classes=["num-badge"], valign=Gtk.Align.CENTER))
        names = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, hexpand=True, valign=Gtk.Align.CENTER)
        names.append(Gtk.Label(label=BUTTON_NAMES[i].upper(), xalign=0, css_classes=["binding-name"]))
        self.action = Gtk.Label(xalign=0, css_classes=["binding-action"], ellipsize=3)
        names.append(self.action)
        box.append(names)
        box.append(Gtk.Image(icon_name="go-next-symbolic", css_classes=["dim-label"]))
        self.set_child(box)
        self.connect("clicked", lambda *_: on_click(i))


class ButtonsPage(Page):
    def __init__(self, win):
        super().__init__(win)
        clamp, content = page_shell("Buttons", "Give any button a new job: another mouse button, a keyboard "
                                               "shortcut, a media key or a DPI function. Stored in the mouse.")
        row = Gtk.Box(spacing=36)
        self.mouse = MouseView(on_select=self._edit)
        self.mouse.set_size_request(240, 360)
        left = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, valign=Gtk.Align.START)
        left.append(self.mouse)
        row.append(left)
        right = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10, hexpand=True, valign=Gtk.Align.START)
        self.rows = [BindingRow(i, self._edit) for i in range(5)]
        for r in self.rows:
            right.append(r)
        reset = Gtk.Button(label="Restore Defaults", css_classes=["flat"], halign=Gtk.Align.START, margin_top=6)
        reset.connect("clicked", self._reset)
        right.append(reset)
        row.append(right)
        content.append(row)
        tip = Gtk.Box(spacing=12, css_classes=["tip"])
        tip.append(Gtk.Image(icon_name="dialog-information-symbolic", valign=Gtk.Align.START))
        tip.append(Gtk.Label(label="Tip: set a side button to “DPI shift (hold)” for a sniper DPI while it's held. "
                                   "Choose that DPI under Sensor → DPI shift stage.", wrap=True, xalign=0,
                             hexpand=True))
        content.append(tip)
        self.set_child(clamp)

        bp = Adw.Breakpoint.new(Adw.BreakpointCondition.parse("max-width: 900sp"))
        bp.add_setter(row, "orientation", Gtk.Orientation.VERTICAL)
        bp.add_setter(left, "halign", Gtk.Align.CENTER)
        win.add_breakpoint(bp)

    def load(self, session):
        p = self.draft
        if not p:
            return
        n = min(5, session.dev.onboard.buttons if session.dev.onboard else 5)
        for i, r in enumerate(self.rows):
            r.set_visible(i < n)
            r.action.set_label(p.buttons[i].describe() if i < len(p.buttons) else "")

    def _edit(self, i):
        from .dialogs import ActionDialog
        self.mouse.select(i)
        dlg = ActionDialog(BUTTON_NAMES[i], self.draft.buttons[i], lambda a: self._set(i, a))
        dlg.connect("closed", lambda *_: self.mouse.select(-1))
        dlg.present(self.win)

    def _set(self, i, action: P.Action):
        old = list(self.draft.buttons)
        self.draft.buttons[i] = action
        if any(b.kind == P.Action.MOUSE and b.code & 1 for b in self.draft.buttons[:5]):
            self._after()
            return
        self.draft.buttons = old
        dlg = Adw.AlertDialog(heading="Keep a left click?",
                              body="No button would send a left click any more, which makes your computer hard "
                                   "to use with this mouse. Assign it anyway?")
        dlg.add_response("cancel", "Cancel")
        dlg.add_response("assign", "Assign Anyway")
        dlg.set_response_appearance("assign", Adw.ResponseAppearance.DESTRUCTIVE)

        def resp(_d, r):
            if r == "assign":
                self.draft.buttons[i] = action
                self._after()
        dlg.connect("response", resp)
        dlg.present(self.win)

    def _after(self):
        self.load(self.win.session)
        self.win.changed(immediate=True)

    def _reset(self, *_):
        defaults = [P.Action.mouse(m) for m in (0x01, 0x02, 0x04, 0x08, 0x10)]
        if self.win.session.factory:
            defaults = P.decode(0, self.win.session.factory, self.draft.fmt).buttons[:5]
        self.draft.buttons[:5] = defaults
        self._after()
        self.win.toast("Buttons restored to factory defaults")


# --------------------------------------------------------------------------- Profiles

class ProfileCard(Gtk.Box):
    def __init__(self, page, i, p, session, editing):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=10,
                         css_classes=["profile-card", f"stage-{i + 1}"])
        active = p.sector == session.active_sector
        if active:
            self.add_css_class("active")
        if not p.enabled:
            self.add_css_class("off")
        head = Gtk.Box(spacing=8)
        head.append(Gtk.Label(label=p.name or f"Profile {i + 1}", xalign=0, hexpand=True, ellipsize=3,
                              css_classes=["profile-name"]))
        chip = "IN USE" if active else ("ON" if p.enabled else "OFF")
        head.append(Gtk.Label(label=chip, css_classes=["chip", "live" if active else "plain"]))
        self.append(head)
        stages = [s.x for s in p.stages if s.enabled]
        facts = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
        facts.append(Gtk.Label(label=" · ".join(str(x) for x in stages) + " DPI", xalign=0, wrap=True,
                               css_classes=["caption"]))
        extra = f"{p.rate_hz} Hz"
        if p.hits:
            h = p.hits[0]
            extra += f" · actuation {h.actuation} · rapid {'on' if h.rt_on else 'off'}"
        facts.append(Gtk.Label(label=extra, xalign=0, css_classes=["caption", "dim-label"]))
        self.append(facts)
        foot = Gtk.Box(spacing=6)
        if not active:
            use = Gtk.Button(label="Use", css_classes=["pill-small", "suggested-action"])
            use.connect("clicked", lambda *_: page._use(p.sector))
            foot.append(use)
        edit = Gtk.Button(label="Editing" if editing else "Edit", sensitive=not editing, css_classes=["pill-small"])
        edit.connect("clicked", lambda *_: page.win.edit_profile(p.sector))
        foot.append(edit)
        foot.append(Gtk.Box(hexpand=True))
        sw = Gtk.Switch(active=p.enabled, valign=Gtk.Align.CENTER, sensitive=not active,
                        tooltip_text="The profile in use is always on" if active else "Include in profile cycling")
        sw.connect("notify::active", lambda s, _p: page._enabled(i, s.get_active()))
        foot.append(sw)
        foot.append(page._menu(i, p))
        self.append(foot)


class ProfilesPage(Page):
    def __init__(self, win):
        super().__init__(win)
        clamp, content = page_shell("Profiles", "Five complete setups live inside the mouse. Switch with a "
                                                "button set to “Next profile”, or right here.")
        self.flow = Gtk.FlowBox(selection_mode=Gtk.SelectionMode.NONE, homogeneous=True, column_spacing=14,
                                row_spacing=14, min_children_per_line=1, max_children_per_line=3)
        content.append(self.flow)
        g = Adw.PreferencesGroup(title="Share")
        exp = Adw.ButtonRow(title="Export Profile Being Edited…", start_icon_name="document-save-symbolic")
        exp.connect("activated", self._export)
        imp = Adw.ButtonRow(title="Import Into Profile Being Edited…", start_icon_name="document-open-symbolic")
        imp.connect("activated", self._import)
        g.add(exp)
        g.add(imp)
        content.append(g)
        self.set_child(clamp)

    def load(self, session):
        self.flow.remove_all()
        for i, p in enumerate(session.profiles):
            self.flow.append(ProfileCard(self, i, p, session, p.sector == self.win.edit_sector))

    def saved(self, session):
        self.load(session)

    def status_changed(self, session):
        self.load(session)

    def _menu(self, i, p):
        menu = Gio.Menu()
        actions = Gio.SimpleActionGroup()

        def add(label, name, cb, target=menu):
            a = Gio.SimpleAction.new(name, None)
            a.connect("activate", lambda *_: cb())
            actions.add_action(a)
            target.append(label, f"p.{name}")

        add("Rename…", "rename", lambda: self._rename(i, p))
        copy = Gio.Menu()
        for j, other in enumerate(self.win.session.profiles):
            if other.sector != p.sector:
                add(other.name or f"Profile {j + 1}", f"from-{j}", lambda src=other: self._copy_from(p, src), copy)
        menu.append_submenu("Copy Settings From", copy)
        if self.win.session.factory:
            add("Reset to Factory Settings", "reset", lambda: self._reset(p))
        btn = Gtk.MenuButton(icon_name="view-more-symbolic", menu_model=menu, valign=Gtk.Align.CENTER,
                             css_classes=["flat", "circular"], tooltip_text="More")
        btn.insert_action_group("p", actions)
        return btn

    def _use(self, sector):
        self.win.flush_save()
        s = self.win.session
        self.win.run(lambda: s.activate(sector), lambda _: self.win.edit_profile(sector), "Profile switched")

    def _enabled(self, i, want):
        s = self.win.session
        if s.profiles[i].enabled == want:
            return
        self.win.run(lambda: s.set_enabled(i, want), lambda _: self.load(s), fail=lambda: self.load(s))

    def _rename(self, i, p):
        dlg = Adw.AlertDialog(heading="Rename Profile")
        entry = Gtk.Entry(text=p.name or f"Profile {i + 1}", max_length=24, activates_default=True)
        dlg.set_extra_child(entry)
        dlg.add_response("cancel", "Cancel")
        dlg.add_response("rename", "Rename")
        dlg.set_response_appearance("rename", Adw.ResponseAppearance.SUGGESTED)
        dlg.set_default_response("rename")

        def resp(_d, r):
            if r != "rename":
                return
            name = entry.get_text().strip()[:24]
            s = self.win.session
            if p.sector == self.win.edit_sector:
                self.win.draft.name = name
                self.win.changed(immediate=True)
                GLib.timeout_add(600, lambda: (self.win.reload_all(), GLib.SOURCE_REMOVE)[1])
            else:
                new = p.copy()
                new.name = name
                self.win.run(lambda: s.save_profile(new), lambda _: self.win.reload_all())
        dlg.connect("response", resp)
        dlg.present(self.win)

    def _copy_from(self, dst, src):
        s = self.win.session
        raw = bytearray(src.raw)
        if dst.fmt == 8:
            raw[P.F8_NAME:P.F8_NAME + 48] = dst.raw[P.F8_NAME:P.F8_NAME + 48]
        self.win.flush_save()
        self.win.run(lambda: s.replace_sector(dst.sector, bytes(raw)), lambda _: self.win.reload_all(),
                     f"Copied settings from {src.name or 'the other profile'}")

    def _reset(self, p):
        s = self.win.session
        dlg = Adw.AlertDialog(heading="Reset to Factory Settings?",
                              body="DPI, buttons, polling rate and triggers of this profile go back to how the "
                                   "mouse came out of the box. A backup is kept.")
        dlg.add_response("cancel", "Cancel")
        dlg.add_response("reset", "Reset")
        dlg.set_response_appearance("reset", Adw.ResponseAppearance.DESTRUCTIVE)

        def resp(_d, r):
            if r == "reset":
                self.win.flush_save()
                self.win.run(lambda: s.replace_sector(p.sector, s.factory), lambda _: self.win.reload_all(),
                             "Profile reset")
        dlg.connect("response", resp)
        dlg.present(self.win)

    def _export(self, *_):
        p = self.win.draft
        s = self.win.session
        d = Gtk.FileDialog(title="Export Profile", initial_name=f"{(p.name or 'profile').replace('/', '-')}.hubless.json")

        def done(dialog, res):
            try:
                f = dialog.save_finish(res)
            except GLib.Error:
                return
            self.win.flush_save()
            storage.export_profile(f.get_path(), s.name, p.fmt, p.encode(), p.name)
            self.win.toast("Profile exported")
        d.save(self.win, None, done)

    def _import(self, *_):
        s = self.win.session
        d = Gtk.FileDialog(title="Import Profile")

        def done(dialog, res):
            try:
                f = dialog.open_finish(res)
            except GLib.Error:
                return
            try:
                raw = storage.import_profile(f.get_path(), s.dev.onboard.fmt, s.dev.onboard.sector_size)
            except (ValueError, OSError, KeyError) as e:
                self.win.toast(str(e))
                return
            self.win.run(lambda: s.replace_sector(self.win.edit_sector, raw), lambda _: self.win.reload_all(),
                         "Profile imported")
        d.open(self.win, None, done)


# --------------------------------------------------------------------------- Device

class BatteryRing(Gtk.DrawingArea):
    def __init__(self):
        super().__init__()
        self.set_content_width(150)
        self.set_content_height(150)
        self.percent, self.charging = 0, False
        self.set_draw_func(self._draw)

    def update(self, percent, charging):
        self.percent, self.charging = percent, charging
        self.queue_draw()

    def _draw(self, _a, cr, w, h):
        ink = fg(self)
        cx, cy, r = w / 2, h / 2, min(w, h) / 2 - 10
        cr.set_line_width(10)
        cr.set_line_cap(cairo.LINE_CAP_ROUND)
        cr.arc(cx, cy, r, 0, 2 * math.pi)
        cr.set_source_rgba(*ink, 0.08)
        cr.stroke()
        if self.percent:
            start = -math.pi / 2
            cr.arc(cx, cy, r, start, start + 2 * math.pi * self.percent / 100)
            if self.percent <= 15 and not self.charging:
                cr.set_source_rgb(0.95, 0.33, 0.36)
            else:
                cr.set_source(brand_gradient(cx - r, cy - r, cx + r, cy + r))
            cr.stroke()
        cr.set_source_rgba(*ink, 1)
        text(cr, f"{self.percent}%", cx, cy + 8, 28, cairo.FONT_WEIGHT_BOLD, 0.5)
        cr.set_source_rgba(*ink, 0.55)
        text(cr, "CHARGING" if self.charging else "BATTERY", cx, cy + 28, 10, cairo.FONT_WEIGHT_BOLD, 0.5)


class DevicePage(Page):
    def __init__(self, win):
        super().__init__(win)
        clamp, content = page_shell("Device", "Everything about your mouse, plus backups of its memory.")
        hero = Gtk.Box(spacing=28, css_classes=["panel", "device-hero"])
        self.ring = BatteryRing()
        hero.append(self.ring)
        info = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6, valign=Gtk.Align.CENTER, hexpand=True)
        self.title = Gtk.Label(xalign=0, wrap=True, css_classes=["device-title"])
        self.subtitle = Gtk.Label(xalign=0, css_classes=["dim-label"])
        info.append(self.title)
        info.append(self.subtitle)
        self.chips = Gtk.Box(spacing=6, margin_top=8)
        info.append(self.chips)
        hero.append(info)
        content.append(hero)

        self.info = Adw.PreferencesGroup(title="Details")
        self.rows = {}
        for key, title in (("connection", "Connection"), ("firmware", "Firmware"), ("serial", "Serial number"),
                           ("protocol", "HID++ version"), ("memory", "Onboard memory")):
            r = Adw.ActionRow(title=title, css_classes=["property"], subtitle_selectable=True)
            self.info.add(r)
            self.rows[key] = r
        content.append(self.info)

        g = Adw.PreferencesGroup(title="Backups", description="Hubless saves the whole mouse memory before its "
                                                              "first change in every session, so nothing is lost.")
        for title, icon, cb in (("Back Up Now", "document-save-symbolic",
                                 lambda *_: win.activate_action("win.backup")),
                                ("Restore a Backup…", "edit-undo-symbolic",
                                 lambda *_: win.activate_action("win.restore")),
                                ("Open Backups Folder", "folder-open-symbolic", self._open_folder)):
            b = Adw.ButtonRow(title=title, start_icon_name=icon)
            b.connect("activated", cb)
            g.add(b)
        content.append(g)

        g = Adw.PreferencesGroup(title="For developers")
        self.features = Adw.ExpanderRow(title="HID++ features", subtitle="What the mouse reports it can do")
        g.add(self.features)
        content.append(g)
        self._feature_rows = []
        self.set_child(clamp)

    def load(self, session):
        d = session.dev
        self.title.set_label(d.name)
        self.subtitle.set_label("Verified with Hubless" if session.verified else "Not tested with Hubless yet")
        while (c := self.chips.get_first_child()) is not None:
            self.chips.remove(c)
        chips = []
        if d.is_superstrike:
            chips.append("HITS")
        if session.rates:
            chips.append(f"{short_hz(max(session.rates))} Hz")
        if session.grid:
            chips.append(f"{spaced(session.grid.max)} DPI")
        if d.onboard:
            chips.append(f"{d.onboard.profiles} profiles")
        for c in chips:
            self.chips.append(Gtk.Label(label=c, css_classes=["chip", "plain"]))
        self.status_changed(session)
        self.rows["connection"].set_subtitle(
            "Demo" if self.win.demo else ("LIGHTSPEED receiver" if d.index != 0xFF else "USB cable"))
        self.rows["firmware"].set_subtitle(d.firmware or "Unknown")
        self.rows["serial"].set_subtitle(d.serial or "Unknown")
        self.rows["protocol"].set_subtitle(f"{d.protocol[0]}.{d.protocol[1]}")
        ob = d.onboard
        self.rows["memory"].set_subtitle(
            f"{ob.profiles} profiles · format {ob.fmt} · {ob.sector_size}-byte sectors" if ob else "Not supported")
        for r in self._feature_rows:
            self.features.remove(r)
        self._feature_rows = []
        names = {0x0000: "Root", 0x0001: "Feature set", 0x0003: "Firmware info", 0x0005: "Device name",
                 0x1004: "Battery", 0x1D4B: "Wireless status", 0x0020: "Config change", 0x2202: "DPI",
                 0x2250: "Motion stats", 0x2251: "Wheel stats", 0x8090: "Mode status", 0x8061: "Polling rate",
                 0x8100: "Onboard profiles", 0x8110: "Button spy", F_HITS: "HITS analog buttons"}
        for idx, fid, flags, ver in d.feature_list:
            if flags & 0x60:
                continue
            r = Adw.ActionRow(title=f"{fid:#06x}  {names.get(fid, 'Unknown')}", subtitle=f"index {idx} · v{ver}",
                              css_classes=["monospace-title"])
            self.features.add_row(r)
            self._feature_rows.append(r)

    def status_changed(self, session):
        b = session.battery
        self.ring.set_visible(b is not None)
        if b:
            self.ring.update(b.percent, b.charging)

    def _open_folder(self, *_):
        s = self.win.session
        if s:
            path = storage.backup_dir(s.serial)
            Gtk.FileLauncher(file=Gio.File.new_for_path(str(path))).launch(self.win, None, None)
