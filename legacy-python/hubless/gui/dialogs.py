"""Dialogs: choosing a button action (with key recording) and restoring a backup."""
from __future__ import annotations

import time

from gi.repository import Adw, Gdk, GLib, Gtk

from .. import profile as P
from .. import storage

# evdev key code -> HID usage, for recording keyboard shortcuts.
EVDEV_TO_HID = {1: 0x29, 14: 0x2A, 15: 0x2B, 28: 0x28, 57: 0x2C, 12: 0x2D, 13: 0x2E, 26: 0x2F, 27: 0x30,
                43: 0x31, 39: 0x33, 40: 0x34, 41: 0x35, 51: 0x36, 52: 0x37, 53: 0x38, 58: 0x39, 99: 0x46,
                70: 0x47, 119: 0x48, 110: 0x49, 102: 0x4A, 104: 0x4B, 111: 0x4C, 107: 0x4D, 109: 0x4E,
                106: 0x4F, 105: 0x50, 108: 0x51, 103: 0x52, 87: 0x44, 88: 0x45}
for _i, _c in enumerate("qwertyuiop"):
    EVDEV_TO_HID[16 + _i] = 0x04 + ord(_c) - 97
for _i, _c in enumerate("asdfghjkl"):
    EVDEV_TO_HID[30 + _i] = 0x04 + ord(_c) - 97
for _i, _c in enumerate("zxcvbnm"):
    EVDEV_TO_HID[44 + _i] = 0x04 + ord(_c) - 97
for _i in range(9):
    EVDEV_TO_HID[2 + _i] = 0x1E + _i
EVDEV_TO_HID[11] = 0x27
for _i in range(10):
    EVDEV_TO_HID[59 + _i] = 0x3A + _i
for _i in range(12):
    EVDEV_TO_HID[183 + _i] = 0x68 + _i
MODIFIER_KEYS = {29, 42, 56, 125, 97, 54, 100, 126}


class ActionDialog(Adw.Dialog):
    def __init__(self, button_name: str, current: P.Action, on_pick):
        super().__init__(title=button_name, content_width=480, content_height=640)
        self.on_pick = on_pick
        self.current = current
        view = Adw.ToolbarView()
        header = Adw.HeaderBar()
        view.add_top_bar(header)
        stack = Adw.ViewStack()
        switcher = Adw.ViewSwitcher(stack=stack, policy=Adw.ViewSwitcherPolicy.WIDE)
        bar = Adw.Clamp(maximum_size=460, child=switcher, margin_start=12, margin_end=12, margin_bottom=6)
        view.add_top_bar(bar)

        stack.add_titled_with_icon(self._list([(n, P.Action.mouse(c)) for c, n in P.MOUSE_BUTTONS.items()],
                                              "Mouse buttons"), "mouse", "Mouse", "hubless-mouse-symbolic")
        stack.add_titled_with_icon(self._keyboard(), "keyboard", "Keyboard", "input-keyboard-symbolic")
        stack.add_titled_with_icon(self._list([(n, P.Action.media(c)) for c, n in P.MEDIA.items()],
                                              "Media and apps"), "media", "Media", "audio-volume-high-symbolic")
        funcs = [(n, P.Action.function(c)) for c, n in P.FUNCTIONS.items()]
        funcs.append(("Do nothing", P.Action.disabled()))
        stack.add_titled_with_icon(self._list(funcs, "Mouse functions"), "functions", "Functions",
                                   "hubless-dpi-symbolic")
        stack.set_visible_child_name({P.Action.KEY: "keyboard", P.Action.MEDIA: "media",
                                      P.Action.FUNCTION: "functions", P.Action.DISABLED: "functions"}
                                     .get(current.kind, "mouse"))
        view.set_content(stack)
        self.set_child(view)

    def _list(self, items, title):
        page = Adw.PreferencesPage()
        g = Adw.PreferencesGroup(title=title)
        for name, action in items:
            row = Adw.ActionRow(title=name, activatable=True)
            if action.raw == self.current.raw:
                row.add_suffix(Gtk.Image(icon_name="hubless-check-symbolic", css_classes=["accent"]))
            row.connect("activated", lambda _r, a=action: self._pick(a))
            g.add(row)
        page.add(g)
        return page

    def _keyboard(self):
        page = Adw.PreferencesPage()
        g = Adw.PreferencesGroup(title="Keyboard shortcut",
                                 description="The mouse will press this key, with any modifiers you hold.")
        self.key_label = Gtk.Label(css_classes=["title-2", "key-capture"], margin_top=24, margin_bottom=8,
                                   label=self.current.describe() if self.current.kind == P.Action.KEY
                                   else "Press a key…")
        self.capture = Gtk.Button(child=self.key_label, css_classes=["card", "key-card"], height_request=110)
        self.capture.update_property([Gtk.AccessibleProperty.LABEL], ["Record a keyboard shortcut"])
        g.add(self.capture)
        hint = Gtk.Label(label="Click the box, then press the key combination. Esc cancels.",
                         css_classes=["caption", "dim-label"], margin_top=8, wrap=True)
        g.add(hint)
        self.use_key = Gtk.Button(label="Use This Shortcut", css_classes=["pill", "suggested-action"],
                                  halign=Gtk.Align.CENTER, margin_top=18, sensitive=False)
        self.use_key.connect("clicked", lambda *_: self._pick(self.recorded))
        g.add(self.use_key)
        page.add(g)
        self.recorded = None
        keys = Gtk.EventControllerKey(propagation_phase=Gtk.PropagationPhase.CAPTURE)
        keys.connect("key-pressed", self._key)
        self.capture.add_controller(keys)
        self.capture.connect("clicked", lambda b: (b.grab_focus(), self.key_label.set_label("Press a key…")))
        return page

    def _key(self, _c, keyval, keycode, state):
        code = keycode - 8
        if keyval == Gdk.KEY_Escape and not state & Gdk.ModifierType.MODIFIER_MASK:
            return False
        if code in MODIFIER_KEYS:
            return True
        usage = EVDEV_TO_HID.get(code)
        if usage is None:
            self.key_label.set_label("That key can't be assigned")
            return True
        mods = 0
        if state & Gdk.ModifierType.CONTROL_MASK:
            mods |= 0x01
        if state & Gdk.ModifierType.SHIFT_MASK:
            mods |= 0x02
        if state & Gdk.ModifierType.ALT_MASK:
            mods |= 0x04
        if state & Gdk.ModifierType.SUPER_MASK:
            mods |= 0x08
        self.recorded = P.Action.key(usage, mods)
        self.key_label.set_label(self.recorded.describe())
        self.use_key.set_sensitive(True)
        return True

    def _pick(self, action):
        if action is None:
            return
        self.on_pick(action)
        self.close()


class RestoreDialog(Adw.Dialog):
    def __init__(self, win):
        super().__init__(title="Restore a Backup", content_width=480, content_height=520)
        self.win = win
        s = win.session
        view = Adw.ToolbarView()
        view.add_top_bar(Adw.HeaderBar())
        page = Adw.PreferencesPage()
        backups = storage.list_backups(s.serial)
        if not backups:
            page = Adw.StatusPage(icon_name="document-save-symbolic", title="No Backups Yet",
                                  description="A backup is saved automatically the first time you change "
                                              "something.")
        else:
            g = Adw.PreferencesGroup(description="Restoring writes the whole profile memory back to the mouse.")
            for b in backups:
                when = time.strftime("%A %d %B %Y, %H:%M", time.localtime(b.get("created", 0)))
                label = {"before-changes": "Before changes", "manual": "Manual backup"}.get(b.get("label"),
                                                                                           b.get("label"))
                row = Adw.ActionRow(title=when, subtitle=label, activatable=True)
                row.add_suffix(Gtk.Image(icon_name="go-next-symbolic"))
                row.connect("activated", lambda _r, path=b["path"]: self._restore(path))
                g.add(row)
            page.add(g)
        view.set_content(page)
        self.set_child(view)

    def _restore(self, path):
        s = self.win.session
        try:
            sectors = storage.load_backup(path)
        except (OSError, ValueError, KeyError) as e:
            self.win.toast(f"That backup can't be read: {e}")
            return
        dlg = Adw.AlertDialog(heading="Restore This Backup?",
                              body="All profiles on the mouse are replaced by the ones in the backup.")
        dlg.add_response("cancel", "Cancel")
        dlg.add_response("restore", "Restore")
        dlg.set_response_appearance("restore", Adw.ResponseAppearance.DESTRUCTIVE)

        def resp(_d, r):
            if r == "restore":
                self.close()
                self.win.flush_save()
                self.win.run(lambda: s.restore_backup(sectors), lambda _: self.win.reload_all(), "Backup restored")
        dlg.connect("response", resp)
        dlg.present(self)
