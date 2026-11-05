"""Onboard profile sectors: decoding, encoding, button actions and HITS codes.

Two layouts are known:
  * format 8 (PRO X2 / X3 SUPERSTRIKE), verified byte-for-byte on a PRO X2;
  * formats 1-6 (older LIGHTSPEED G mice), the layout libratbag and Solaar use.
Encoding always starts from the original sector so unknown bytes survive a round trip.
"""
from __future__ import annotations

import base64
import copy
import struct
from dataclasses import dataclass, field


def crc16(data: bytes) -> int:
    """CRC-16/CCITT-FALSE, as used for onboard memory sectors."""
    crc = 0xFFFF
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def crc_ok(sector: bytes) -> bool:
    return crc16(sector[:-2]) == struct.unpack(">H", sector[-2:])[0]


def with_crc(sector: bytes) -> bytes:
    return bytes(sector[:-2]) + struct.pack(">H", crc16(sector[:-2]))


# --------------------------------------------------------------------------- actions

MOUSE_BUTTONS = {
    0x0001: "Left click", 0x0002: "Right click", 0x0004: "Middle click", 0x0008: "Back",
    0x0010: "Forward", 0x0020: "Button 6", 0x0040: "Button 7", 0x0080: "Button 8",
}
FUNCTIONS = {
    0x01: "Tilt left", 0x02: "Tilt right", 0x03: "Next DPI", 0x04: "Previous DPI", 0x05: "Cycle DPI",
    0x06: "Default DPI", 0x07: "DPI shift (hold)", 0x08: "Next profile", 0x09: "Previous profile",
    0x0A: "Cycle profile", 0x0B: "G-Shift (hold)", 0x0C: "Show battery", 0x10: "Scroll down", 0x11: "Scroll up",
}
MEDIA = {
    0x00CD: "Play / Pause", 0x00B5: "Next track", 0x00B6: "Previous track", 0x00B7: "Stop",
    0x00E2: "Mute", 0x00E9: "Volume up", 0x00EA: "Volume down", 0x006F: "Brightness up",
    0x0070: "Brightness down", 0x0192: "Calculator", 0x0194: "File manager", 0x018A: "Mail",
    0x0223: "Browser home", 0x0224: "Browser back", 0x0225: "Browser forward", 0x0227: "Browser refresh",
}
MODIFIERS = {0x01: "Ctrl", 0x02: "Shift", 0x04: "Alt", 0x08: "Super",
             0x10: "Right Ctrl", 0x20: "Right Shift", 0x40: "Right Alt", 0x80: "Right Super"}


def _keys() -> dict[int, str]:
    k = {0x04 + i: chr(ord("A") + i) for i in range(26)}
    k.update({0x1E + i: str((i + 1) % 10) for i in range(10)})
    k.update({0x28: "Enter", 0x29: "Esc", 0x2A: "Backspace", 0x2B: "Tab", 0x2C: "Space", 0x2D: "-",
              0x2E: "=", 0x2F: "[", 0x30: "]", 0x31: "\\", 0x33: ";", 0x34: "'", 0x35: "`", 0x36: ",",
              0x37: ".", 0x38: "/", 0x39: "Caps Lock", 0x46: "Print Screen", 0x47: "Scroll Lock",
              0x48: "Pause", 0x49: "Insert", 0x4A: "Home", 0x4B: "Page Up", 0x4C: "Delete", 0x4D: "End",
              0x4E: "Page Down", 0x4F: "Right", 0x50: "Left", 0x51: "Down", 0x52: "Up"})
    k.update({0x3A + i: f"F{i + 1}" for i in range(12)})
    k.update({0x68 + i: f"F{i + 13}" for i in range(12)})
    return k


KEYS = _keys()


@dataclass(frozen=True)
class Action:
    """One 4-byte button slot."""
    raw: bytes = b"\xff\xff\xff\xff"

    DEFAULT, DISABLED, MOUSE, KEY, MEDIA, FUNCTION, OTHER = "default disabled mouse key media function other".split()

    @property
    def kind(self) -> str:
        r = self.raw
        if r == b"\xff\xff\xff\xff":
            return self.DEFAULT
        if r[0] >> 4 == 0x8:
            return {0: self.DISABLED, 1: self.MOUSE, 2: self.KEY, 3: self.MEDIA}.get(r[1], self.OTHER)
        if r[0] >> 4 == 0x9:
            return self.FUNCTION
        return self.OTHER

    @property
    def code(self) -> int:
        k, r = self.kind, self.raw
        if k in (self.MOUSE, self.MEDIA):
            return r[2] << 8 | r[3]
        if k == self.KEY:
            return r[3]
        if k == self.FUNCTION:
            return r[1]
        return 0

    @property
    def mods(self) -> int:
        return self.raw[2] if self.kind == self.KEY else 0

    @classmethod
    def mouse(cls, mask: int) -> "Action":
        return cls(bytes([0x80, 0x01, mask >> 8, mask & 0xFF]))

    @classmethod
    def key(cls, usage: int, mods: int = 0) -> "Action":
        return cls(bytes([0x80, 0x02, mods, usage]))

    @classmethod
    def media(cls, usage: int) -> "Action":
        return cls(bytes([0x80, 0x03, usage >> 8, usage & 0xFF]))

    @classmethod
    def function(cls, fid: int) -> "Action":
        return cls(bytes([0x90, fid, 0xFF, 0x00]))

    @classmethod
    def disabled(cls) -> "Action":
        return cls(b"\x80\x00\xff\xff")

    def describe(self) -> str:
        k = self.kind
        if k == self.MOUSE:
            return MOUSE_BUTTONS.get(self.code, f"Mouse buttons {self.code:#06x}")
        if k == self.KEY:
            mods = "".join(n + "+" for b, n in MODIFIERS.items() if self.mods & b)
            return mods + KEYS.get(self.code, f"Key {self.code:#04x}")
        if k == self.MEDIA:
            return MEDIA.get(self.code, f"Media key {self.code:#06x}")
        if k == self.FUNCTION:
            return FUNCTIONS.get(self.code, f"Function {self.code:#04x}")
        if k == self.DISABLED:
            return "Disabled"
        if k == self.DEFAULT:
            return "Default"
        return "Custom (" + self.raw.hex(" ") + ")"

    def to_json(self) -> str:
        return self.raw.hex()

    @classmethod
    def from_json(cls, s: str) -> "Action":
        raw = bytes.fromhex(s)
        if len(raw) != 4:
            raise ValueError("button action must be 4 bytes")
        return cls(raw)


# --------------------------------------------------------------------------- HITS

@dataclass
class Hits:
    """Analog main-button tuning. Levels are the logical values G HUB shows."""
    actuation: int = 5       # 1 (shallow) .. 10 (deep)
    rt_level: int = 3        # rapid-trigger reset distance 1..5
    rt_on: bool = False
    haptics: int = 3         # 0 (off) .. 5

    def to_wire(self) -> bytes:
        return bytes([(self.actuation << 2) & 0xFC, ((self.rt_level << 2) & 0xFC) | int(self.rt_on),
                      (self.haptics << 2) & 0xFC])

    @classmethod
    def from_wire(cls, b: bytes) -> "Hits":
        return cls(b[0] >> 2, b[1] >> 2, bool(b[1] & 1), b[2] >> 2)


def hits_code(left: Hits, right: Hits) -> str:
    """G HUB "HITS code": base64 of 16 digits: 00, act L/R, rt L/R, rt-on L/R (1 digit), haptics L/R."""
    s = (f"00{left.actuation:02d}{right.actuation:02d}{left.rt_level:02d}{right.rt_level:02d}"
         f"{int(left.rt_on)}{int(right.rt_on)}{left.haptics:02d}{right.haptics:02d}")
    return base64.b64encode(s.encode()).decode()


def parse_hits_code(code: str) -> tuple[Hits, Hits]:
    try:
        s = base64.b64decode(code.strip(), validate=True).decode("ascii")
    except Exception:
        raise ValueError("That is not a HITS code.") from None
    if len(s) != 16 or not s.isdigit() or s[:2] != "00":
        raise ValueError("Unknown HITS code version.")
    n = lambda i: int(s[i:i + 2])
    left = Hits(n(2), n(6), s[10] == "1", n(12))
    right = Hits(n(4), n(8), s[11] == "1", n(14))
    for h in (left, right):
        if not (1 <= h.actuation <= 10 and 1 <= h.rt_level <= 5 and 0 <= h.haptics <= 5):
            raise ValueError("A value in that HITS code is out of range.")
    return left, right


# --------------------------------------------------------------------------- profiles

@dataclass
class Stage:
    x: int
    y: int
    lod: int = 2             # lift-off distance: 1 low, 2 medium, 3 high (format 8 only)

    @property
    def enabled(self) -> bool:
        return 0 < self.x < 0xFFFF


@dataclass
class Profile:
    sector: int
    raw: bytes
    fmt: int
    rate_hz: int = 1000
    rate_wired_hz: int | None = None
    stages: list[Stage] = field(default_factory=list)
    default_stage: int = 0
    shift_stage: int = 0
    hits: list[Hits] | None = None
    buttons: list[Action] = field(default_factory=list)
    shift_buttons: list[Action] = field(default_factory=list)
    name: str = ""
    angle_snap: bool = False
    sleep_s: int | None = None
    off_s: int | None = None
    enabled: bool = True

    def copy(self) -> "Profile":
        return copy.deepcopy(self)

    @property
    def stage_count(self) -> int:
        return sum(1 for s in self.stages if s.enabled)

    def pack_stages(self):
        """Move switched-on DPI stages to the front, keeping their order.

        The firmware counts stages from the first entry up to the first switched-off one, so a gap (say stage 1
        off, stage 3 on) leaves it with no usable stage: the live stage becomes 0xFF and the sensor keeps
        whatever DPI it had. Verified on a PRO X2 SUPERSTRIKE.
        """
        on = [i for i, s in enumerate(self.stages) if s.enabled]
        off = [i for i, s in enumerate(self.stages) if not s.enabled]
        order = on + off
        remap = {old: new for new, old in enumerate(order)}
        self.stages = [self.stages[i] if self.stages[i].enabled else Stage(0, 0, self.stages[i].lod or 2)
                       for i in order]
        count = len(on)
        self.default_stage = remap.get(self.default_stage, 0) if count else 0
        if self.default_stage >= count:
            self.default_stage = 0
        self.shift_stage = remap.get(self.shift_stage, 0)
        if self.shift_stage >= count:
            self.shift_stage = self.default_stage

    def encode(self) -> bytes:
        p = self.copy()
        p.pack_stages()
        return (encode_fmt8 if p.fmt == 8 else encode_generic)(p)


def _name(raw: bytes) -> str:
    if raw[:2] == b"\xff\xff":
        return ""
    return raw.decode("utf-16le", "replace").split("\x00")[0].rstrip("￿")


def _name_bytes(name: str, size: int) -> bytes:
    if not name:
        return b"\xff" * size
    return name[: size // 2].encode("utf-16le").ljust(size, b"\0")


# Format 8: rate index (Hz = 125 << n), 5-byte stages, HITS block, buttons at 0x30.
F8_RATE, F8_RATE_WIRED, F8_DEFAULT, F8_SHIFT, F8_STAGES = 0x00, 0x01, 0x02, 0x03, 0x04
F8_ANGLE, F8_HITS, F8_SLEEP, F8_OFF, F8_BUTTONS, F8_SHIFT_BUTTONS, F8_NAME = 0x22, 0x26, 0x2C, 0x2E, 0x30, 0x70, 0xA0


def _hz_from_index(i: int) -> int:
    return 125 << i if i <= 6 else 1000


def _index_from_hz(hz: int) -> int:
    return max(0, min(6, (hz // 125).bit_length() - 1))


def decode(sector: int, raw: bytes, fmt: int, enabled: bool = True) -> Profile:
    return (decode_fmt8 if fmt == 8 else decode_generic)(sector, raw, fmt, enabled)


def decode_fmt8(sector, raw, fmt, enabled):
    stages = []
    for i in range(5):
        x, y, lod = struct.unpack_from("<HHB", raw, F8_STAGES + 5 * i)
        stages.append(Stage(x, y, lod))
    return Profile(
        sector=sector, raw=bytes(raw), fmt=fmt, enabled=enabled,
        rate_hz=_hz_from_index(raw[F8_RATE]), rate_wired_hz=_hz_from_index(raw[F8_RATE_WIRED]),
        stages=stages, default_stage=raw[F8_DEFAULT] % 5, shift_stage=raw[F8_SHIFT] % 5,
        hits=[Hits.from_wire(raw[F8_HITS:F8_HITS + 3]), Hits.from_wire(raw[F8_HITS + 3:F8_HITS + 6])],
        buttons=[Action(raw[F8_BUTTONS + 4 * i:F8_BUTTONS + 4 * i + 4]) for i in range(16)],
        shift_buttons=[Action(raw[F8_SHIFT_BUTTONS + 4 * i:F8_SHIFT_BUTTONS + 4 * i + 4]) for i in range(12)],
        name=_name(raw[F8_NAME:F8_NAME + 48]),
        angle_snap=raw[F8_ANGLE] == 1,
        sleep_s=struct.unpack_from("<H", raw, F8_SLEEP)[0],
        off_s=struct.unpack_from("<H", raw, F8_OFF)[0],
    )


def encode_fmt8(p: Profile) -> bytes:
    b = bytearray(p.raw)
    b[F8_RATE] = _index_from_hz(p.rate_hz)
    if p.rate_wired_hz:
        b[F8_RATE_WIRED] = _index_from_hz(min(p.rate_wired_hz, 1000))
    b[F8_DEFAULT], b[F8_SHIFT] = p.default_stage, p.shift_stage
    for i, s in enumerate(p.stages[:5]):
        struct.pack_into("<HHB", b, F8_STAGES + 5 * i, s.x, s.y, s.lod)
    b[F8_ANGLE] = int(p.angle_snap)
    if p.hits:
        b[F8_HITS:F8_HITS + 6] = p.hits[0].to_wire() + p.hits[1].to_wire()
    if p.sleep_s is not None:
        struct.pack_into("<H", b, F8_SLEEP, p.sleep_s)
    if p.off_s is not None:
        struct.pack_into("<H", b, F8_OFF, p.off_s)
    for i, a in enumerate(p.buttons[:16]):
        b[F8_BUTTONS + 4 * i:F8_BUTTONS + 4 * i + 4] = a.raw
    for i, a in enumerate(p.shift_buttons[:12]):
        b[F8_SHIFT_BUTTONS + 4 * i:F8_SHIFT_BUTTONS + 4 * i + 4] = a.raw
    b[F8_NAME:F8_NAME + 48] = _name_bytes(p.name, 48)
    return with_crc(bytes(b))


# Formats 1-6: rate in ms, 16-bit DPI words, buttons at 32, G-Shift at 96, name at 160.
def decode_generic(sector, raw, fmt, enabled):
    words = [struct.unpack_from("<H", raw, 3 + 2 * i)[0] for i in range(5)]
    rate_ms = raw[0] or 1
    return Profile(
        sector=sector, raw=bytes(raw), fmt=fmt, enabled=enabled,
        rate_hz=1000 // rate_ms if rate_ms != 0xFF else 1000,
        stages=[Stage(w, w, 0) for w in words],
        default_stage=raw[1] % 5, shift_stage=raw[2] % 5,
        buttons=[Action(raw[32 + 4 * i:36 + 4 * i]) for i in range(16)],
        shift_buttons=[Action(raw[96 + 4 * i:100 + 4 * i]) for i in range(16)],
        name=_name(raw[160:208]) if len(raw) >= 208 else "",
        angle_snap=raw[17] == 1,
    )


def encode_generic(p: Profile) -> bytes:
    b = bytearray(p.raw)
    b[0] = max(1, min(8, round(1000 / p.rate_hz)))
    b[1], b[2] = p.default_stage, p.shift_stage
    for i, s in enumerate(p.stages[:5]):
        struct.pack_into("<H", b, 3 + 2 * i, s.x if s.enabled else 0)
    b[17] = int(p.angle_snap)
    for i, a in enumerate(p.buttons[:16]):
        b[32 + 4 * i:36 + 4 * i] = a.raw
    for i, a in enumerate(p.shift_buttons[:16]):
        b[96 + 4 * i:100 + 4 * i] = a.raw
    if len(b) >= 210:
        b[160:208] = _name_bytes(p.name, 48)
    return with_crc(bytes(b))
