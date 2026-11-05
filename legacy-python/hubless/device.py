"""A connected Logitech HID++ 2.0 device and the features hubless uses."""
from __future__ import annotations

import struct
import time
from dataclasses import dataclass

from . import profile as P
from .hidpp import HidppError, Offline, Timeout, Transport, endpoints

F_ROOT, F_FEATURE_SET, F_FW, F_NAME = 0x0000, 0x0001, 0x0003, 0x0005
F_BATTERY_UNIFIED, F_BATTERY_STATUS = 0x1004, 0x1000
F_DPI, F_DPI_EXT = 0x2201, 0x2202
F_RATE, F_RATE_EXT = 0x8060, 0x8061
F_ONBOARD, F_HITS = 0x8100, 0x1B0C

ONBOARD, HOST = 1, 2
EXT_RATES = [125, 250, 500, 1000, 2000, 4000, 8000]
CHARGING = {0: "Discharging", 1: "Charging", 2: "Charging", 3: "Fully charged", 4: "Charging error"}


@dataclass
class Battery:
    percent: int
    status: str

    @property
    def charging(self) -> bool:
        return self.status.startswith("Charging") and self.status != "Charging error"


class DpiGrid:
    """Sensor DPI list: plain values, or `value, 0xE000|step, end` ranges."""

    def __init__(self, words: list[int]):
        self.values: list[int] = []
        self.ranges: list[tuple[int, int, int]] = []
        prev = None
        i = 0
        while i < len(words) and words[i]:
            w = words[i]
            if w >> 13 == 0b111 and prev is not None and i + 1 < len(words):
                step, end = w & 0x1FFF, words[i + 1]
                if step:
                    self.ranges.append((prev, end, step))
                prev = end
                i += 2
                continue
            self.values.append(w)
            prev = w
            i += 1
        if not self.values and not self.ranges:
            self.ranges = [(100, 25600, 50)]

    @property
    def min(self) -> int:
        return min([r[0] for r in self.ranges] + self.values)

    @property
    def max(self) -> int:
        return max([r[1] for r in self.ranges] + self.values)

    def snap(self, dpi: int) -> int:
        dpi = max(self.min, min(self.max, int(dpi)))
        best = None
        for lo, hi, step in self.ranges:
            if lo <= dpi <= hi:
                best = lo + round((dpi - lo) / step) * step
                break
        cands = self.values + ([best] if best is not None else [])
        if not cands:
            cands = [r[0] for r in self.ranges] + [r[1] for r in self.ranges]
        return min(cands, key=lambda v: abs(v - dpi))


@dataclass
class OnboardInfo:
    fmt: int
    profiles: int
    buttons: int
    sector_size: int


class Device:
    def __init__(self, transport: Transport, index: int, endpoint_name: str = ""):
        self.t = transport
        self.index = index
        self.endpoint_name = endpoint_name
        self.features: dict[int, int] = {}
        self.feature_list: list[tuple[int, int, int, int]] = []   # (index, id, flags, version)
        self.protocol = (0, 0)
        self.name = ""
        self.firmware = ""
        self.serial = ""
        self._onboard: OnboardInfo | None = None

    # ------------------------------------------------------------------ plumbing
    def call(self, feature_id: int, function: int, *params: int | bytes, timeout: float = 1.0) -> bytes:
        idx = self.features.get(feature_id)
        if idx is None:
            raise KeyError(f"device has no feature {feature_id:#06x}")
        data = b"".join(p if isinstance(p, (bytes, bytearray)) else bytes([p]) for p in params)
        return self.t.request(self.index, idx, function, data, timeout=timeout)

    def has(self, feature_id: int) -> bool:
        return feature_id in self.features

    def connect(self):
        r = self.t.request(self.index, 0, 1, b"\0\0\x5a")
        self.protocol = (r[0], r[1])
        fs = self.t.request(self.index, 0, 0, b"\x00\x01")[0]
        count = self.t.request(self.index, fs, 0)[0]
        self.features = {F_ROOT: 0, F_FEATURE_SET: fs}
        self.feature_list = [(0, F_ROOT, 0, 0)]
        for i in range(1, count + 1):
            r = self.t.request(self.index, fs, 1, bytes([i]))
            fid = r[0] << 8 | r[1]
            self.features.setdefault(fid, i)
            self.feature_list.append((i, fid, r[2], r[3]))
        self.name = self._read_name()
        self._read_firmware()
        return self

    def _read_name(self) -> str:
        if not self.has(F_NAME):
            return self.endpoint_name
        n = self.call(F_NAME, 0)[0]
        out = b""
        while len(out) < n:
            chunk = self.call(F_NAME, 1, len(out))
            out += chunk.rstrip(b"\0") if len(out) + len(chunk) >= n else chunk
            if not chunk.strip(b"\0"):
                break
        return out[:n].decode("utf-8", "replace").strip() or self.endpoint_name

    def _read_firmware(self):
        if not self.has(F_FW):
            return
        try:
            info = self.call(F_FW, 0)
            self.serial = info[1:5].hex().upper()
            for entity in range(info[0]):
                fw = self.call(F_FW, 1, entity)
                if fw[0] == 0:              # main application firmware
                    prefix = fw[1:4].decode("ascii", "replace").strip("\0")
                    self.firmware = f"{prefix} {fw[4]:02x}.{fw[5]:02x} build {fw[6]:02x}{fw[7]:02x}"
                    break
        except (HidppError, Timeout):
            pass

    @property
    def is_superstrike(self) -> bool:
        return self.has(F_HITS)

    # ------------------------------------------------------------------ status
    def battery(self) -> Battery | None:
        if self.has(F_BATTERY_UNIFIED):
            r = self.call(F_BATTERY_UNIFIED, 1)
            return Battery(r[0], CHARGING.get(r[2], "Unknown"))
        if self.has(F_BATTERY_STATUS):
            r = self.call(F_BATTERY_STATUS, 0)
            return Battery(r[0], CHARGING.get(r[2], "Unknown"))
        return None

    def report_rates(self) -> list[int]:
        if self.has(F_RATE_EXT):
            r = self.call(F_RATE_EXT, 1)
            mask = r[0] << 8 | r[1]
            return [hz for i, hz in enumerate(EXT_RATES) if mask & (1 << i)]
        if self.has(F_RATE):
            mask = self.call(F_RATE, 0)[0]
            return sorted(1000 // (i + 1) for i in range(8) if mask & (1 << i))
        return [1000]

    def dpi_grid(self) -> "DpiGrid":
        """The DPI values the sensor accepts (piecewise ranges with their own step)."""
        if getattr(self, "_grid", None) is None:
            self._grid = DpiGrid(self._dpi_words())
        return self._grid

    def _dpi_words(self) -> list[int]:
        try:
            if self.has(F_DPI_EXT):
                raw = b""
                for page in range(8):
                    r = self.call(F_DPI_EXT, 2, 0, 0, page)
                    raw += r[3:16]
                    words = [raw[i] << 8 | raw[i + 1] for i in range(0, len(raw) - 1, 2)]
                    if 0 in words:
                        break
            elif self.has(F_DPI):
                r = self.call(F_DPI, 1, 0)
                words = [r[i] << 8 | r[i + 1] for i in range(1, len(r) - 1, 2)]
            else:
                return []
        except (HidppError, Timeout):
            return []
        return words

    # ------------------------------------------------------------------ HITS (0x1B0C)
    def hits_caps(self) -> dict:
        r = self.call(F_HITS, 0)
        return {"buttons": min(r[1], 2), "actuation": r[2] >> 2 or 10, "rt": r[3] >> 2 or 5, "haptics": r[4] >> 2 or 5}

    def hits_get(self, button: int) -> P.Hits:
        return P.Hits.from_wire(self.call(F_HITS, 2, button)[1:4])

    def hits_set(self, button: int, h: P.Hits):
        self.call(F_HITS, 1, button, h.to_wire())

    # ------------------------------------------------------------------ onboard profiles (0x8100)
    @property
    def onboard(self) -> OnboardInfo | None:
        if self._onboard is None and self.has(F_ONBOARD):
            r = self.call(F_ONBOARD, 0)
            if r[0] == 1:                   # only the G-series memory model is understood
                self._onboard = OnboardInfo(fmt=r[1], profiles=r[3], buttons=r[5], sector_size=r[7] << 8 | r[8])
        return self._onboard

    def onboard_mode(self) -> int:
        return self.call(F_ONBOARD, 2)[0]

    def set_onboard_mode(self, mode: int):
        self.call(F_ONBOARD, 1, mode)

    def current_profile_sector(self) -> int:
        r = self.call(F_ONBOARD, 4)
        return r[0] << 8 | r[1]

    def set_current_profile(self, sector: int):
        for attempt in range(4):
            try:
                self.call(F_ONBOARD, 3, sector >> 8, sector & 0xFF, timeout=1.5)
                return
            except Timeout:
                if attempt == 3:
                    raise
                time.sleep(0.15)

    def current_stage(self) -> int:
        return self.call(F_ONBOARD, 11)[0]

    def set_current_stage(self, stage: int):
        self.call(F_ONBOARD, 12, stage)

    def read_sector(self, sector: int) -> bytes:
        size = self.onboard.sector_size
        for _ in range(3):
            buf = bytearray(size)
            off = 0
            while off < size:
                o = min(off, size - 16)       # reads may not run past the end of a sector
                chunk = self.call(F_ONBOARD, 5, struct.pack(">HH", sector, o))
                buf[o:o + 16] = chunk[:16]
                off = o + 16
            if sector >= 0x100 or sector == 0 or P.crc_ok(buf):
                return bytes(buf)
        raise IOError(f"sector {sector:#06x}: CRC mismatch after 3 reads")

    def write_sector(self, sector: int, data: bytes):
        """Write a full sector (CRC already set), then verify it byte for byte."""
        size = self.onboard.sector_size
        if len(data) != size:
            raise ValueError("sector size mismatch")
        last_err = None
        for _ in range(3):
            try:
                self.call(F_ONBOARD, 6, struct.pack(">HHH", sector, 0, size), timeout=2.0)
                for off in range(0, size, 16):
                    self.call(F_ONBOARD, 7, data[off:off + 16].ljust(16, b"\0"), timeout=2.0)
                self.call(F_ONBOARD, 8, timeout=3.0)
            except (Timeout, HidppError) as e:
                last_err = e
            time.sleep(0.05)
            if self.read_sector(sector) == data:
                return
        raise IOError(f"sector {sector:#06x} did not verify after writing ({last_err or 'mismatch'})")

    def profile_table(self) -> list[tuple[int, bool]]:
        """(sector, enabled) for each profile slot, from control sector 0."""
        ctl = self.read_sector(0)
        out = []
        for i in range(self.onboard.profiles):
            sec = ctl[4 * i] << 8 | ctl[4 * i + 1]
            if sec == 0xFFFF:
                break
            out.append((sec, ctl[4 * i + 2] == 1))
        return out

    def set_profile_enabled(self, slot: int, enabled: bool):
        ctl = bytearray(self.read_sector(0))
        ctl[4 * slot + 2] = int(enabled)
        self.write_sector(0, P.with_crc(bytes(ctl)))

    def read_profile(self, sector: int, enabled: bool = True) -> P.Profile:
        return P.decode(sector, self.read_sector(sector), self.onboard.fmt, enabled)

    def factory_sector(self) -> bytes | None:
        """The factory default profile from ROM, with a valid CRC, or None if the device has none."""
        try:
            rom = self.read_sector(0x100)
            sec = rom[0] << 8 | rom[1]
            if sec == 0xFFFF or sec < 0x100:
                return None
            return P.with_crc(self.read_sector(sec))
        except (HidppError, Timeout, IOError):
            return None

    def dump_memory(self) -> dict[int, bytes]:
        out = {0: self.read_sector(0)}
        for sec, _ in self.profile_table():
            out[sec] = self.read_sector(sec)
        return out


def find_devices() -> tuple[list[tuple[Transport, int, object]], list[str], list[str]]:
    """Every HID++ 2.0 device that answers right now as (transport, index, endpoint), the hidraw
    paths we were not allowed to open, and the names of paired devices that are asleep."""
    from .hidpp import NoPermission
    found, no_perm, asleep = [], [], []
    for ep in endpoints():
        try:
            t = Transport(ep.path)
        except NoPermission:
            no_perm.append(ep.path)
            continue
        hit = False
        if ep.receiver:
            for slot, _wpid, name in t.paired_devices():
                v = t.ping(slot)
                if v and v[0] >= 2:
                    hit = True
                    found.append((t, slot, ep))
                else:
                    asleep.append(name or "mouse")
        else:
            v = t.ping(0xFF)
            if v and v[0] >= 2:
                hit = True
                found.append((t, 0xFF, ep))
        if not hit:
            t.close()
    return found, no_perm, asleep


def is_offline_error(e: Exception) -> bool:
    return isinstance(e, (Offline, Timeout, OSError)) and not isinstance(e, PermissionError)
