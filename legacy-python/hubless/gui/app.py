"""Main window: connection states, the I/O worker, auto-save and page switching."""
from __future__ import annotations

import os
import queue
import threading
import traceback
from pathlib import Path

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, Gdk, Gio, GLib, GObject, Gtk  # noqa: E402

from .. import __version__, storage  # noqa: E402
from ..device import Device, find_devices  # noqa: E402
from ..hidpp import Offline, Timeout  # noqa: E402
from ..session import Session  # noqa: E402

APP_ID = "io.github.hubless.Hubless"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SAVE_DELAY_MS = 450


class Worker:
    """One background thread for all HID++ I/O; results come back on the GTK main loop."""

    def __init__(self):
        self.q: queue.Queue = queue.Queue()
        threading.Thread(target=self._run, daemon=True, name="hidpp").start()

    def _run(self):
        while True:
            fn, ok, err = self.q.get()
            try:
                res = fn()
            except Exception as e:  # noqa: BLE001 — every failure is reported to the UI
                if not isinstance(e, (Offline, Timeout, PermissionError, ValueError, IOError)):
                    traceback.print_exc()
                if err:
                    GLib.idle_add(err, e)
                continue
            if ok:
                GLib.idle_add(ok, res)

    def run(self, fn, ok=None, err=None):
        self.q.put((fn, ok, err))

    @property
    def busy(self) -> bool:
        return not self.q.empty()


class Window(Adw.ApplicationWindow):
    def __init__(self, app, demo=False):
        super().__init__(application=app, title="Hubless")
        self.set_default_size(1020, 760)
        self.set_size_request(360, 500)
        self.demo = demo
        self.worker = Worker()
        self.session: Session | None = None
        self.edit_sector = 0        # profile being edited
        self.draft = None           # editable copy of that profile
        self._save_timer = 0
        self._saving = False
        self._dirty = False
        self._scan_timer = 0
        self._poll_timer = 0
        self.asleep = False
        self._banner_default = ("", None, False)
        self.settings = storage.load_settings()
        self._build()
        self.search()

    # ------------------------------------------------------------------ layout
    def _build(self):
        from .pages import ButtonsPage, DevicePage, ProfilesPage, SensorPage, TriggersPage

        self.toasts = Adw.ToastOverlay()
        self.set_content(self.toasts)
        self.state_stack = Gtk.Stack(transition_type=Gtk.StackTransitionType.CROSSFADE)
        self.toasts.set_child(self.state_stack)

        # Status pages for the not-ready states.
        self.status_view = Adw.ToolbarView()
        self.status_view.add_top_bar(self._plain_header())
        self.status = Adw.StatusPage()
        self.status_spinner = Adw.Spinner(width_request=32, height_request=32)
        self.status_button = Gtk.Button(halign=Gtk.Align.CENTER, css_classes=["pill", "suggested-action"])
        self.status_button.connect("clicked", self._status_action)
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18, halign=Gtk.Align.CENTER)
        box.append(self.status_spinner)
        box.append(self.status_button)
        self.status.set_child(box)
        self.status_view.set_content(self.status)
        self.state_stack.add_named(self.status_view, "status")

        # Main editor: sidebar (device, navigation, profile) + page content.
        self.split = Adw.OverlaySplitView(min_sidebar_width=250, max_sidebar_width=280, sidebar_width_fraction=0.26)
        self.split.set_sidebar(self._build_sidebar())

        view = Adw.ToolbarView()
        header = Adw.HeaderBar(css_classes=["flat"])
        self.page_title = Adw.WindowTitle()
        header.set_title_widget(self.page_title)
        self.sidebar_btn = Gtk.ToggleButton(icon_name="sidebar-show-symbolic", tooltip_text="Show sidebar",
                                            visible=False)
        self.split.bind_property("show-sidebar", self.sidebar_btn, "active",
                                 GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE)
        header.pack_start(self.sidebar_btn)

        menu = Gio.Menu()
        sec = Gio.Menu()
        sec.append("Back Up Mouse Memory", "win.backup")
        sec.append("Restore a Backup…", "win.restore")
        menu.append_section(None, sec)
        sec = Gio.Menu()
        sec.append("Grant Device Access…", "win.permissions")
        sec.append("About Hubless", "win.about")
        menu.append_section(None, sec)
        header.pack_end(Gtk.MenuButton(icon_name="open-menu-symbolic", menu_model=menu, tooltip_text="Main menu",
                                       primary=True))

        self.save_state = Gtk.Stack(transition_type=Gtk.StackTransitionType.CROSSFADE, hhomogeneous=False)
        saved = Gtk.Box(spacing=6, valign=Gtk.Align.CENTER, css_classes=["save-pill", "saved"])
        saved.append(Gtk.Image(icon_name="hubless-check-symbolic"))
        saved.append(Gtk.Label(label="Saved to mouse"))
        saving = Gtk.Box(spacing=6, valign=Gtk.Align.CENTER, css_classes=["save-pill"])
        saving.append(Adw.Spinner())
        saving.append(Gtk.Label(label="Saving…"))
        self.save_state.add_named(saved, "saved")
        self.save_state.add_named(saving, "saving")
        self.save_state.add_named(Gtk.Box(), "none")
        self.save_state.set_visible_child_name("none")
        header.pack_end(self.save_state)
        view.add_top_bar(header)

        self.banner = Adw.Banner()
        self.banner.connect("button-clicked", lambda *_: self.banner.set_revealed(False))
        view.add_top_bar(self.banner)

        self.pages = {
            "triggers": TriggersPage(self),
            "sensor": SensorPage(self),
            "buttons": ButtonsPage(self),
            "profiles": ProfilesPage(self),
            "device": DevicePage(self),
        }
        self.stack = Gtk.Stack(transition_type=Gtk.StackTransitionType.CROSSFADE, transition_duration=180)
        for key, page in self.pages.items():
            self.stack.add_named(page, key)
        self.stack.connect("notify::visible-child-name", self._on_page_changed)
        view.set_content(self.stack)
        self.split.set_content(view)

        bp = Adw.Breakpoint.new(Adw.BreakpointCondition.parse("max-width: 760sp"))
        bp.add_setter(self.split, "collapsed", True)
        bp.add_setter(self.sidebar_btn, "visible", True)
        self.add_breakpoint(bp)
        self.state_stack.add_named(self.split, "main")
        self._on_page_changed()

        for name, cb in (("backup", self._backup), ("restore", self._restore), ("about", self._about),
                         ("permissions", lambda *_: self._grant_access())):
            act = Gio.SimpleAction.new(name, None)
            act.connect("activate", cb)
            self.add_action(act)
        for i, key in enumerate(self.pages):
            act = Gio.SimpleAction.new(f"page-{i + 1}", None)
            act.connect("activate", lambda *_a, k=key: self.stack.set_visible_child_name(k))
            self.add_action(act)
            self.get_application().set_accels_for_action(f"win.page-{i + 1}", [f"<Alt>{i + 1}"])
        self.connect("close-request", self._on_close)

    NAV = [("triggers", "Triggers", "hubless-trigger-symbolic", "Actuation, rapid trigger and haptics"),
           ("sensor", "Sensor", "hubless-dpi-symbolic", "DPI stages, polling rate and tracking"),
           ("buttons", "Buttons", "hubless-buttons-symbolic", "What each button does"),
           ("profiles", "Profiles", "hubless-profiles-symbolic", "Onboard profiles stored in the mouse"),
           ("device", "Device", "hubless-device-symbolic", "Battery, firmware and backups")]

    def _build_sidebar(self):
        view = Adw.ToolbarView()
        head = Adw.HeaderBar(css_classes=["flat"], show_title=False)
        brand = Gtk.Box(spacing=8, css_classes=["brand"])
        brand.append(Gtk.Image(icon_name=APP_ID, pixel_size=22))
        brand.append(Gtk.Label(label="Hubless", css_classes=["brand-name"]))
        head.pack_start(brand)
        view.add_top_bar(head)

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14, margin_start=12, margin_end=12,
                      margin_bottom=12)
        card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10, css_classes=["device-card"])
        top = Gtk.Box(spacing=12)
        badge = Gtk.Box(css_classes=["device-badge"], valign=Gtk.Align.CENTER)
        badge.append(Gtk.Image(icon_name="hubless-mouse-symbolic", pixel_size=22))
        top.append(badge)
        names = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, valign=Gtk.Align.CENTER, hexpand=True)
        self.side_name = Gtk.Label(xalign=0, css_classes=["device-name"], ellipsize=3)
        self.side_conn = Gtk.Label(xalign=0, css_classes=["caption", "dim-label"])
        names.append(self.side_name)
        names.append(self.side_conn)
        top.append(names)
        card.append(top)
        self.battery = Gtk.Box(spacing=8, css_classes=["battery"])
        self.battery_icon = Gtk.Image()
        self.battery_bar = Gtk.LevelBar(min_value=0, max_value=100, hexpand=True, valign=Gtk.Align.CENTER)
        self.battery_bar.remove_offset_value("low")
        self.battery_bar.remove_offset_value("high")
        self.battery_bar.remove_offset_value("full")
        self.battery_label = Gtk.Label(css_classes=["numeric", "caption-heading"])
        self.battery.append(self.battery_icon)
        self.battery.append(self.battery_bar)
        self.battery.append(self.battery_label)
        card.append(self.battery)
        box.append(card)

        self.nav = Gtk.ListBox(css_classes=["navigation-sidebar", "nav"])
        self.nav_rows = {}
        for key, title, icon, _desc in self.NAV:
            row = Gtk.ListBoxRow()
            rb = Gtk.Box(spacing=12, margin_top=8, margin_bottom=8, margin_start=4)
            rb.append(Gtk.Image(icon_name=icon))
            rb.append(Gtk.Label(label=title, xalign=0))
            row.set_child(rb)
            row.key = key
            self.nav.append(row)
            self.nav_rows[key] = row
        self.nav.connect("row-selected", self._on_nav)
        box.append(self.nav)
        box.append(Gtk.Box(vexpand=True))

        foot = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6, css_classes=["profile-foot"])
        foot.append(Gtk.Label(label="EDITING PROFILE", xalign=0, css_classes=["caption-heading", "dim-label"]))
        self.profile_model = Gtk.StringList()
        self.profile_dd = Gtk.DropDown(model=self.profile_model, tooltip_text="Profile being edited")
        self._profile_dd_handler = self.profile_dd.connect("notify::selected", self._on_profile_pick)
        foot.append(self.profile_dd)
        box.append(foot)
        view.set_content(box)
        return view

    def _on_nav(self, _lb, row):
        if row is not None and self.stack.get_visible_child_name() != row.key:
            self.stack.set_visible_child_name(row.key)
        if row is not None and self.split.get_collapsed():
            self.split.set_show_sidebar(False)

    def _on_page_changed(self, *_):
        key = self.stack.get_visible_child_name()
        row = self.nav_rows.get(key)
        if row is not None and self.nav.get_selected_row() is not row:
            self.nav.select_row(row)

    def set_page_visible(self, key, visible):
        self.nav_rows[key].set_visible(visible)
        self.stack.get_page(self.pages[key]).set_visible(visible)

    def _plain_header(self):
        h = Adw.HeaderBar()
        h.set_title_widget(Adw.WindowTitle(title="Hubless"))
        menu = Gio.Menu()
        menu.append("Grant device access…", "win.permissions")
        menu.append("About Hubless", "win.about")
        h.pack_end(Gtk.MenuButton(icon_name="open-menu-symbolic", menu_model=menu, tooltip_text="Main menu"))
        return h

    # ------------------------------------------------------------------ connection states
    def show_status(self, icon, title, desc, button=None, spinner=False, action=None):
        self.status.set_icon_name(icon)
        self.status.set_title(title)
        self.status.set_description(desc)
        self.status_spinner.set_visible(spinner)
        self.status_button.set_visible(bool(button))
        if button:
            self.status_button.set_label(button)
        self._status_cb = action
        self.state_stack.set_visible_child_name("status")

    def _status_action(self, *_):
        if self._status_cb:
            self._status_cb()

    def search(self):
        self._stop_timers()
        self.session = None
        if self.state_stack.get_visible_child_name() != "status" or not self.status_spinner.get_visible():
            self.show_status("hubless-mouse-symbolic", "Looking for your mouse",
                             "Plug in the receiver or the cable, then switch the mouse on.", spinner=True)

        def find():
            if self.demo:
                from ..sim import SimTransport
                return Session(Device(SimTransport(), 1, "Demo mouse").connect()), [], []
            found, no_perm, asleep = find_devices()
            for t, idx, ep in found:
                try:
                    dev = Device(t, idx, ep.name).connect()
                except (Offline, Timeout):
                    continue
                if dev.onboard or dev.is_superstrike:
                    return Session(dev), no_perm, asleep
            return None, no_perm, asleep

        def load(result):
            session, no_perm, asleep = result
            if session is None:
                if asleep:
                    self.show_status("hubless-mouse-symbolic", f"Your {asleep[0]} is asleep",
                                     "Move it or click a button to wake it up.", spinner=True)
                elif no_perm:
                    self.show_status("hubless-lock-symbolic", "Hubless needs permission",
                                     "Linux keeps mouse settings locked by default. Allow access once and "
                                     "Hubless will remember it.", button="Allow Access",
                                     action=self._grant_access)
                else:
                    self.show_status("hubless-mouse-symbolic", "Looking for your mouse",
                                     "Plug in the receiver or the cable, then switch the mouse on. "
                                     "If it's already on, move it or click a button to wake it up.",
                                     spinner=True)
                self._scan_timer = GLib.timeout_add_seconds(2, self._rescan)
                return
            self.worker.run(lambda: (session.load(), session)[1], self._loaded, self._load_failed)

        self.worker.run(find, load, self._load_failed)

    def _rescan(self):
        self._scan_timer = 0
        self.search()
        return GLib.SOURCE_REMOVE

    def _load_failed(self, e):
        self._scan_timer = GLib.timeout_add_seconds(2, self._rescan)
        if isinstance(e, PermissionError):
            return self.show_status("hubless-lock-symbolic", "Hubless needs permission", str(e),
                                    button="Allow Access", action=self._grant_access)
        self.show_status("hubless-mouse-symbolic", "Looking for your mouse",
                         "The mouse stopped answering. Move it or click a button to wake it up.", spinner=True)

    def _loaded(self, session: Session):
        self.session = session
        self.edit_sector = session.active_sector
        self.draft = session.active.copy() if session.active else None
        self.set_title(f"{session.name} — Hubless")
        self._refresh_profiles()
        self._refresh_battery()
        has_hits = session.hits_caps is not None
        self.set_page_visible("triggers", has_hits)
        for key in ("sensor", "buttons", "profiles"):
            self.set_page_visible(key, session.editable)
        self.side_name.set_label(session.name)
        self.side_conn.set_label("Demo mouse" if self.demo else
                                 ("LIGHTSPEED wireless" if session.dev.index != 0xFF else "USB cable"))
        if not session.editable:
            self.stack.set_visible_child_name("device")
        elif not has_hits and self.stack.get_visible_child_name() == "triggers":
            self.stack.set_visible_child_name("sensor")
        for page in self.pages.values():
            page.load(session)
        if self.demo:
            self.banner.set_title("Demo mode: a simulated PRO X2 SUPERSTRIKE. Nothing is sent to a real mouse.")
            self.banner.set_button_label(None)
            self.banner.set_revealed(True)
        elif not session.verified:
            self.banner.set_title("This mouse hasn't been tested with Hubless yet. A backup is saved before "
                                  "every first change.")
            self.banner.set_button_label("Dismiss")
            self.banner.set_revealed(True)
        else:
            self.banner.set_revealed(False)
        self._banner_default = (self.banner.get_title(), self.banner.get_button_label(), self.banner.get_revealed())
        self.asleep = False
        self.stack.set_sensitive(True)
        self.profile_dd.set_sensitive(True)
        if session.notice:
            self.toast(session.notice)
        self.state_stack.set_visible_child_name("main")
        self._poll_timer = GLib.timeout_add_seconds(15, self._poll)

    def _stop_timers(self):
        for attr in ("_scan_timer", "_poll_timer"):
            if getattr(self, attr):
                GLib.source_remove(getattr(self, attr))
                setattr(self, attr, 0)

    def _poll(self):
        if not self.session or self._saving or self._dirty or self.asleep:
            return GLib.SOURCE_CONTINUE
        s = self.session
        before = (s.active_sector, s.stage)

        def done(_):
            self._refresh_battery()
            if (s.active_sector, s.stage) != before:
                self._refresh_profiles()
                for page in self.pages.values():
                    page.status_changed(s)

        self.worker.run(s.refresh_status, done, self.lost)
        return GLib.SOURCE_CONTINUE

    def lost(self, e=None):
        """The mouse stopped answering. Asleep: keep the editor, wait for it. Unplugged: search again."""
        s = self.session
        if s is None or self.asleep:
            return
        if not self.demo and not os.path.exists(s.dev.t.path):
            self._dirty = False
            self.search()
            return
        self.asleep = True
        self.stack.set_sensitive(False)
        self.profile_dd.set_sensitive(False)
        self.banner.set_title(f"Your {s.name} is asleep. Move it or click a button to keep editing."
                              + (" Your last change will be saved when it wakes up." if self._dirty else ""))
        self.banner.set_button_label(None)
        self.banner.set_revealed(True)
        GLib.timeout_add_seconds(2, self._wake_check)

    def _wake_check(self):
        s = self.session
        if s is None or not self.asleep:
            return GLib.SOURCE_REMOVE
        if not self.demo and not os.path.exists(s.dev.t.path):
            self.asleep = False
            self.search()
            return GLib.SOURCE_REMOVE

        def woke(_):
            self.asleep = False
            self.stack.set_sensitive(True)
            self.profile_dd.set_sensitive(True)
            title, button, revealed = self._banner_default
            self.banner.set_title(title)
            self.banner.set_button_label(button)
            self.banner.set_revealed(revealed)
            self._refresh_battery()
            self._refresh_profiles()
            for page in self.pages.values():
                page.status_changed(s)
            if self._dirty:
                self.changed(immediate=True)

        def still_asleep(_e):
            GLib.timeout_add_seconds(2, self._wake_check)

        self.worker.run(s.refresh_status, woke, still_asleep)
        return GLib.SOURCE_REMOVE

    # ------------------------------------------------------------------ header pieces
    def _refresh_battery(self):
        b = self.session.battery if self.session else None
        self.battery.set_visible(b is not None)
        if b is None:
            return
        level = min(100, max(0, round(b.percent / 10) * 10))
        self.battery_icon.set_from_icon_name(f"battery-level-{level}{'-charging' if b.charging else ''}-symbolic")
        self.battery_label.set_label(f"{b.percent}%")
        self.battery_bar.set_value(b.percent)
        self.battery.set_tooltip_text(f"Battery {b.percent}% · {b.status}")
        if b.percent <= 15 and not b.charging:
            self.battery.add_css_class("error")
        else:
            self.battery.remove_css_class("error")

    def _refresh_profiles(self):
        s = self.session
        self.profile_dd.handler_block(self._profile_dd_handler)
        names = []
        for i, p in enumerate(s.profiles):
            label = p.name or f"Profile {i + 1}"
            if p.sector == s.active_sector:
                label += "  ●"
            names.append(label)
        self.profile_model.splice(0, self.profile_model.get_n_items(), names)
        self.profile_dd.set_selected(s.slot_of(self.edit_sector))
        self.profile_dd.handler_unblock(self._profile_dd_handler)

    def _on_profile_pick(self, dd, _pspec):
        s = self.session
        if not s:
            return
        i = dd.get_selected()
        if i >= len(s.profiles):
            return
        self.flush_save()
        self.edit_profile(s.profiles[i].sector)

    def edit_profile(self, sector):
        s = self.session
        self.edit_sector = sector
        self.draft = s.profiles[s.slot_of(sector)].copy()
        self._refresh_profiles()
        for page in self.pages.values():
            page.load(s)

    @property
    def editing_active(self) -> bool:
        return self.session is not None and self.edit_sector == self.session.active_sector

    # ------------------------------------------------------------------ saving
    def changed(self, immediate=False):
        """A page edited self.draft: save it to the mouse shortly."""
        self._dirty = True
        if self._save_timer:
            GLib.source_remove(self._save_timer)
        self._save_timer = GLib.timeout_add(0 if immediate else SAVE_DELAY_MS, self._save_now)

    def flush_save(self):
        if self._save_timer:
            GLib.source_remove(self._save_timer)
            self._save_now()

    def _save_now(self):
        self._save_timer = 0
        if self._saving:
            self._save_timer = GLib.timeout_add(150, self._save_now)
            return GLib.SOURCE_REMOVE
        if not self.session or not self._dirty:
            return GLib.SOURCE_REMOVE
        self._dirty = False
        self._saving = True
        self.save_state.set_visible_child_name("saving")
        snapshot = self.draft.copy()
        s = self.session

        def ok(_):
            self._saving = False
            if not self._dirty:
                self.save_state.set_visible_child_name("saved")
            for page in self.pages.values():
                page.saved(s)

        def err(e):
            self._saving = False
            self.save_state.set_visible_child_name("none")
            if isinstance(e, (Offline, Timeout)):
                self._dirty = True
                self.lost(e)
            else:
                self.toast(f"Couldn't save: {e}")

        self.worker.run(lambda: s.save_profile(snapshot), ok, err)
        return GLib.SOURCE_REMOVE

    def run(self, fn, ok=None, message=None, fail=None):
        """Run a device job; toast on failure."""
        def done(res):
            if message:
                self.toast(message)
            if ok:
                ok(res)

        def err(e):
            if isinstance(e, (Offline, Timeout)):
                self.toast("Couldn't reach the mouse. Move it to wake it up and try again.")
                self.lost(e)
            else:
                self.toast(str(e))
            if fail:
                fail()

        self.worker.run(fn, done, err)

    def reload_all(self):
        s = self.session
        self.draft = s.profiles[s.slot_of(self.edit_sector)].copy()
        self._refresh_profiles()
        for page in self.pages.values():
            page.load(s)

    def toast(self, text, timeout=3):
        self.toasts.add_toast(Adw.Toast(title=GLib.markup_escape_text(text), timeout=timeout))

    # ------------------------------------------------------------------ actions
    def _grant_access(self):
        def done(res):
            ok, msg = res
            self.toast(msg)
            if ok:
                self.search()
        self.worker.run(storage.install_udev_rule, done)

    def _backup(self, *_):
        s = self.session
        if not s or not s.editable:
            return
        self.run(lambda: storage.save_backup(s.serial, s.name, s.dev.onboard.fmt, s.dev.dump_memory(), "manual"),
                 lambda p: self.toast(f"Backup saved to {p.parent}", timeout=5))

    def _restore(self, *_):
        from .dialogs import RestoreDialog
        if self.session and self.session.editable:
            RestoreDialog(self).present(self)

    def _about(self, *_):
        about = Adw.AboutDialog(
            application_name="Hubless", application_icon=APP_ID, version=__version__,
            developer_name="The Hubless contributors", license_type=Gtk.License.MIT_X11,
            comments="Configure Logitech G mice on Linux: DPI, polling rate, buttons, onboard profiles and "
                     "the PRO X2/X3 SUPERSTRIKE's HITS triggers. Everything is stored in the mouse, so "
                     "nothing has to keep running.\n\nNot affiliated with Logitech.",
            website="https://github.com/hubless-app/hubless",
            issue_url="https://github.com/hubless-app/hubless/issues",
        )
        about.add_acknowledgement_section("Protocol research", [
            "Solaar https://github.com/pwr-Solaar/Solaar",
            "libratbag https://github.com/libratbag/libratbag",
            "kazehana99k (HITS capture) https://github.com/kazehana99k/Logitech-PRO-X2-SUPERSTRIKE-Linux-haptics-actuation-control-",
            "SuperStrike Studio https://github.com/Adhamura/superstrike-studio",
        ])
        about.present(self)

    def _on_close(self, *_):
        if self._dirty or self._saving:
            self.flush_save()
            # Give the worker a moment to finish writing the last change.
            GLib.timeout_add(100, self._close_when_idle)
            return True
        return False

    def _close_when_idle(self):
        if self._saving or self.worker.busy:
            return GLib.SOURCE_CONTINUE
        self._dirty = False
        self.destroy()
        return GLib.SOURCE_REMOVE


class App(Adw.Application):
    def __init__(self, demo=False):
        super().__init__(application_id=APP_ID if not demo else APP_ID + ".Demo",
                         flags=Gio.ApplicationFlags.DEFAULT_FLAGS)
        self.demo = demo

    def do_startup(self):
        Adw.Application.do_startup(self)
        Adw.StyleManager.get_default().set_color_scheme(Adw.ColorScheme.PREFER_DARK)
        theme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default())
        theme.add_search_path(str(DATA_DIR / "icons"))
        css = Gtk.CssProvider()
        css.load_from_path(str(DATA_DIR / "style.css"))
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css,
                                                  Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        self.set_accels_for_action("window.close", ["<Ctrl>w"])
        quit_ = Gio.SimpleAction.new("quit", None)
        quit_.connect("activate", lambda *_: [w.close() for w in self.get_windows()])
        self.add_action(quit_)
        self.set_accels_for_action("app.quit", ["<Ctrl>q"])

    def do_activate(self):
        win = self.props.active_window or Window(self, self.demo)
        win.present()
