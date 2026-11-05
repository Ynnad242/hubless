"""A simulated PRO X2 SUPERSTRIKE for `hubless --demo`: answers HID++ like the real one."""
from __future__ import annotations

import struct

from . import profile as P
from .hidpp import HidppError, Offline

# Factory profile as read from a real PRO X2 SUPERSTRIKE (ROM sector 0x0101).
FACTORY = bytes.fromhex(
    "030300002003200302b004b0040240064006026009600902800c800c02000000"
    "00ff00ffffff14080c14080c3c002c0180010001800100028001000480010008"
    "80010010ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    "ffffffffffffffffffffffffffffffff0300000000001f400000000300000000"
    "001f400000000300000000001f403200000300000000001f40320000032a38"
)

FEATURES = [0x0000, 0x0001, 0x0003, 0x0005, 0x1D4B, 0x0020, 0x1004, 0x2250, 0x2251, 0x2202, 0x8090,
            0x80E0, 0x1B0C, 0x8061, 0x8100, 0x8110]
DPI_WORDS = [100, 0xE001, 200, 0xE002, 500, 0xE005, 1000, 0xE00A, 2000, 0xE014, 5000, 0xE032, 10000,
             0xE064, 20000, 0xE07D, 32000, 0xE0C8, 44000, 0]


class SimTransport:
    path = "demo"

    def __init__(self):
        self.notifications = []
        self.sectors = {0: P.with_crc(bytes([0, 1, 1, 0xFF, 0, 2, 0, 0xFF, 0, 3, 0, 0xFF, 0, 4, 0, 0xFF,
                                             0, 5, 0, 0xFF]).ljust(253, b"\xff") + b"\0\0")}
        for s in range(1, 6):
            self.sectors[s] = FACTORY
        self.sectors[0x100] = bytes([1, 1, 1, 0xFF]).ljust(255, b"\xff")
        self.sectors[0x101] = FACTORY
        self.hits = {0: bytes([0x14, 0x08, 0x0C]), 1: bytes([0x14, 0x08, 0x0C])}
        self.mode, self.current, self.stage, self.rate = 1, 1, 0, 3
        self.battery = 76
        self._write: tuple[int, bytearray] | None = None
        self.asleep = False

    def close(self):
        pass

    def take_notifications(self):
        return []

    def ping(self, index, timeout=0.4):
        return (4, 2)

    def request(self, index, feature, function, params=b"", timeout=1.0, busy_retries=3) -> bytes:
        if self.asleep:
            raise Offline("demo mouse is asleep")
        p = bytes(params).ljust(16, b"\0")
        fid = FEATURES[feature] if feature < len(FEATURES) else None
        out = self._handle(fid, function, p)
        if out is None:
            raise HidppError(7, feature, function)
        return bytes(out).ljust(16, b"\0")

    def _handle(self, fid, fn, p):
        if fid == 0x0000:
            if fn == 0:
                want = p[0] << 8 | p[1]
                return [FEATURES.index(want) if want in FEATURES else 0, 0, 0]
            if fn == 1:
                return [4, 2, p[2]]
        if fid == 0x0001:
            if fn == 0:
                return [len(FEATURES) - 1]
            if fn == 1:
                f = FEATURES[p[0]]
                return [f >> 8, f & 0xFF, 0, 0]
        if fid == 0x0003:
            if fn == 0:
                return [1, 0xDE, 0x40, 0x00, 0x01]
            if fn == 1:
                return [0, *b"MPM", 0x42, 0x00, 0x00, 0x11]
        if fid == 0x0005:
            name = b"PRO X2 SUPERSTRIKE"
            if fn == 0:
                return [len(name)]
            if fn == 1:
                return list(name[p[0]:p[0] + 16])
        if fid == 0x1004 and fn == 1:
            return [self.battery, 4, 0, 0]
        if fid == 0x2202 and fn == 2:
            stream = b"".join(struct.pack(">H", w) for w in DPI_WORDS)
            return [0, 0, p[2], *stream[p[2] * 13:p[2] * 13 + 13].ljust(13, b"\0")]
        if fid == 0x8061:
            if fn == 1:
                return [0x00, 0x7F]
            if fn == 2:
                return [self.rate]
        if fid == 0x1B0C:
            if fn == 0:
                return [0, 3, 0x28, 0x14, 0x14, 1]
            if fn == 2:
                if p[0] not in self.hits:
                    raise HidppError(2)
                return [p[0], *self.hits[p[0]]]
            if fn == 1:
                if p[1] & 3 or p[3] & 3 or p[2] & 2 or not 4 <= p[1] <= 0x28 or p[3] > 0x14:
                    raise HidppError(2)
                self.hits[p[0]] = bytes(p[1:4])
                return list(p[:4])
        if fid == 0x8100:
            return self._onboard(fn, p)
        return None

    def _onboard(self, fn, p):
        if fn == 0:
            return [1, 8, 1, 5, 1, 5, 0x10, 0, 0xFF, 0x0A, 4]
        if fn == 1:
            self.mode = p[0]
            return []
        if fn == 2:
            return [self.mode]
        if fn == 3:
            self.current = p[0] << 8 | p[1]
            prof = self.sectors[self.current]
            self.stage = prof[2]
            self.hits = {0: prof[0x26:0x29], 1: prof[0x29:0x2C]}
            return []
        if fn == 4:
            return [self.current >> 8, self.current & 0xFF]
        if fn == 11:
            return [self.stage]
        if fn == 12:
            prof = self.sectors[self.current]
            count = 0
            while count < 5 and prof[4 + 5 * count] | prof[5 + 5 * count]:
                count += 1
            if p[0] >= count:          # like the real firmware: only leading switched-on stages count
                raise HidppError(2)
            self.stage = p[0]
            return []
        if fn == 5:
            sec, off = p[0] << 8 | p[1], p[2] << 8 | p[3]
            if sec not in self.sectors or off + 16 > 255:
                raise HidppError(2)
            return list(self.sectors[sec][off:off + 16])
        if fn == 6:
            self._write = (p[0] << 8 | p[1], bytearray())
            return []
        if fn == 7:
            self._write[1].extend(p[:16])
            return []
        if fn == 8:
            sec, data = self._write
            self.sectors[sec] = bytes(data[:255])
            self._write = None
            if sec == self.current:
                count = 0
                while count < 5 and data[4 + 5 * count] | data[5 + 5 * count]:
                    count += 1
                if self.stage >= count:
                    self.stage = 0xFF
            return []
        return None
