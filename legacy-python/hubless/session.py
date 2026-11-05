"""Everything the app knows about one connected mouse, and the safe ways to change it.

All methods block on HID++ I/O; the GUI calls them from its worker thread.
"""
from __future__ import annotations

from . import profile as P
from . import storage
from .device import F_ONBOARD, Device, ONBOARD
from .hidpp import HidppError, Timeout


class Session:
    def __init__(self, device: Device):
        self.dev = device
        self.backed_up = False
        self.profiles: list[P.Profile] = []
        self.active_sector = 0
        self.stage = 0
        self.battery = None
        self.rates: list[int] = []
        self.grid = None
        self.hits_caps = None
        self.factory: bytes | None = None
        self.notice = ""

    @property
    def name(self) -> str:
        return self.dev.name

    @property
    def serial(self) -> str:
        return self.dev.serial

    @property
    def editable(self) -> bool:
        return self.dev.onboard is not None and self.dev.onboard.fmt in (1, 2, 3, 4, 5, 6, 8)

    @property
    def verified(self) -> bool:
        """True for hardware hubless has been verified on; other G mice are best effort."""
        return self.dev.is_superstrike

    def load(self):
        d = self.dev
        self.battery = d.battery()
        self.rates = d.report_rates()
        self.grid = d.dpi_grid()
        if d.is_superstrike:
            self.hits_caps = d.hits_caps()
        if not self.editable:
            return
        if d.onboard_mode() != ONBOARD:
            # Another tool left the mouse in host mode, where the stored profiles are ignored.
            d.set_onboard_mode(ONBOARD)
            self.notice = "Switched the mouse back to its onboard profiles."
        self.profiles = [d.read_profile(sec, en) for sec, en in d.profile_table()]
        self.active_sector = d.current_profile_sector()
        self.stage = d.current_stage()
        self.factory = d.factory_sector()

    def refresh_status(self):
        self.battery = self.dev.battery()
        if self.editable:
            self.active_sector = self.dev.current_profile_sector()
            self.stage = self.dev.current_stage()

    @property
    def active(self) -> P.Profile | None:
        return next((p for p in self.profiles if p.sector == self.active_sector), None)

    def slot_of(self, sector: int) -> int:
        return next(i for i, p in enumerate(self.profiles) if p.sector == sector)

    def ensure_backup(self):
        if self.backed_up:
            return
        storage.save_backup(self.serial, self.name, self.dev.onboard.fmt, self.dev.dump_memory(), "before-changes")
        self.backed_up = True

    # ------------------------------------------------------------------ changes
    def save_profile(self, new: P.Profile):
        """Write a profile and make it take effect if it is the one in use.

        Writing the active profile applies it immediately (DPI, polling rate, buttons, HITS). The live
        report-rate setter is rejected in onboard mode, so it isn't used.
        """
        self.ensure_backup()
        slot = self.slot_of(new.sector)
        old = self.profiles[slot]
        data = new.encode()
        if data != old.raw:
            self.dev.write_sector(new.sector, data)
        saved = P.decode(new.sector, data, new.fmt, old.enabled)
        self.profiles[slot] = saved
        if new.sector != self.active_sector:
            return saved
        if self.dev.has(F_ONBOARD):
            self.stage = self.dev.current_stage()
        if saved.default_stage != old.default_stage or self.stage >= saved.stage_count:
            # Also repairs a live stage the firmware dropped to 0xFF after its stage was switched off.
            self._try(self.dev.set_current_stage, saved.default_stage)
            self.stage = saved.default_stage
        if new.hits:
            for b, h in enumerate(new.hits):
                if old.hits is None or h != old.hits[b]:
                    self._try(self.dev.hits_set, b, h)
        return saved

    def preview_hits(self, button: int, h: P.Hits):
        """Live-only change, used while a slider is being dragged."""
        self.dev.hits_set(button, h)

    def set_stage(self, stage: int):
        self.dev.set_current_stage(stage)
        self.stage = stage

    def activate(self, sector: int):
        slot = self.slot_of(sector)
        if not self.profiles[slot].enabled:
            self.set_enabled(slot, True)
        self.dev.set_current_profile(sector)
        self.active_sector = sector
        self.stage = self.dev.current_stage()

    def set_enabled(self, slot: int, enabled: bool):
        if not enabled and self.profiles[slot].sector == self.active_sector:
            raise ValueError("The profile in use can't be turned off. Switch to another profile first.")
        self.ensure_backup()
        self.dev.set_profile_enabled(slot, enabled)
        self.profiles[slot].enabled = enabled

    def replace_sector(self, sector: int, raw: bytes):
        """Overwrite a whole profile (import, copy, factory reset)."""
        slot = self.slot_of(sector)
        p = P.decode(sector, P.with_crc(raw), self.dev.onboard.fmt, self.profiles[slot].enabled)
        return self.save_profile(p)

    def restore_backup(self, sectors: dict[int, bytes]):
        self.ensure_backup()
        size = self.dev.onboard.sector_size
        for sec, raw in sorted(sectors.items()):
            if len(raw) != size:
                raise ValueError("That backup is from a different kind of mouse.")
        for sec, raw in sorted(sectors.items()):
            if self.dev.read_sector(sec) != raw:
                self.dev.write_sector(sec, raw)
        self.load()
        self.dev.set_current_profile(self.active_sector)

    @staticmethod
    def _try(fn, *args):
        try:
            fn(*args)
        except (HidppError, Timeout):
            pass
