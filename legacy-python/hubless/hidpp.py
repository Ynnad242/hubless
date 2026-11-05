"""HID++ 2.0 transport over Linux hidraw.

Finds Logitech HID++ endpoints (receivers and wired devices), resolves which device
indices answer, and runs request/response exchanges with software-id correlation.
"""
from __future__ import annotations

import errno
import glob
import os
import select
import threading
import time
from dataclasses import dataclass

LOGITECH = 0x046D
SHORT, LONG = 0x10, 0x11
SHORT_LEN, LONG_LEN = 7, 20
SWID = 0x0B
WIRED_INDEX = 0xFF

ERRORS = {
    1: "unknown error", 2: "invalid argument", 3: "out of range", 4: "hardware error",
    5: "internal error", 6: "invalid feature index", 7: "invalid function", 8: "device busy",
    9: "unsupported",
}


class HidppError(Exception):
    def __init__(self, code: int, feature: int = 0, function: int = 0):
        self.code = code
        super().__init__(f"{ERRORS.get(code, f'error {code:#x}')} (feature {feature:#04x}, fn {function})")


class Timeout(Exception):
    pass


class Offline(Exception):
    """The receiver answered for the device: it is asleep, switched off or out of range."""


class NoPermission(Exception):
    pass


@dataclass
class Endpoint:
    path: str
    vid: int
    pid: int
    name: str
    receiver: bool


def _uevent(node: str) -> dict:
    out = {}
    try:
        with open(f"{node}/device/uevent") as f:
            for line in f:
                k, _, v = line.strip().partition("=")
                out[k] = v
    except OSError:
        pass
    return out


def _is_hidpp(node: str) -> bool:
    try:
        with open(f"{node}/device/report_descriptor", "rb") as f:
            desc = f.read()
    except OSError:
        return False
    # Vendor usage page 0xFF00 with the HID++ long report id.
    return (b"\x06\x00\xff" in desc or b"\x06\x43\xff" in desc) and b"\x85\x11" in desc


def endpoints() -> list[Endpoint]:
    """HID++ capable hidraw nodes, excluding the per-device children hid-logitech-dj creates."""
    found = []
    for node in sorted(glob.glob("/sys/class/hidraw/hidraw*"), key=lambda p: int(p.rsplit("hidraw", 1)[1])):
        ev = _uevent(node)
        try:
            bus, vid, pid = (int(x, 16) for x in ev.get("HID_ID", "").split(":"))
        except ValueError:
            continue
        if vid != LOGITECH or bus not in (0x03, 0x05):
            continue
        real = os.path.realpath(f"{node}/device")
        if real.count(":046D:") > 1:          # dj child sitting under a receiver
            continue
        if not _is_hidpp(node):
            continue
        name = ev.get("HID_NAME", "Logitech device")
        found.append(Endpoint("/dev/" + os.path.basename(node), vid, pid, name, "Receiver" in name))
    return found


class Transport:
    """One open hidraw node. Thread-safe; one request in flight at a time."""

    def __init__(self, path: str):
        self.path = path
        self._lock = threading.Lock()
        self.notifications: list[bytes] = []
        try:
            self.fd = os.open(path, os.O_RDWR | os.O_NONBLOCK)
        except PermissionError as e:
            raise NoPermission(path) from e

    def close(self):
        try:
            os.close(self.fd)
        except OSError:
            pass

    def _drain(self):
        while select.select([self.fd], [], [], 0)[0]:
            try:
                self.notifications.append(os.read(self.fd, 64))
            except BlockingIOError:
                break

    def request(self, index: int, feature: int, function: int, params: bytes = b"",
                timeout: float = 1.0, busy_retries: int = 3) -> bytes:
        for attempt in range(busy_retries + 1):
            try:
                return self._request(index, feature, function, bytes(params), timeout)
            except HidppError as e:
                if e.code != 8 or attempt == busy_retries:
                    raise
                time.sleep(0.05 * (attempt + 1))

    def _request(self, index, feature, function, params, timeout):
        fnsw = ((function & 0x0F) << 4) | SWID
        pkt = bytes([LONG, index, feature, fnsw]) + params.ljust(LONG_LEN - 4, b"\0")[:LONG_LEN - 4]
        with self._lock:
            self._drain()
            try:
                os.write(self.fd, pkt)
            except OSError as e:
                if e.errno in (errno.ENODEV, errno.EIO):
                    raise Offline(self.path) from e
                raise
            deadline = time.monotonic() + timeout
            while True:
                left = deadline - time.monotonic()
                if left <= 0 or not select.select([self.fd], [], [], left)[0]:
                    raise Timeout(f"no reply from device {index:#x} (feature {feature:#x} fn {function})")
                try:
                    data = os.read(self.fd, 64)
                except BlockingIOError:
                    continue
                except OSError as e:
                    raise Offline(self.path) from e
                if len(data) < 4 or data[0] not in (SHORT, LONG) or data[1] != index:
                    self.notifications.append(data)
                    continue
                if data[2] == 0xFF and data[3] == feature and data[4] == fnsw:
                    raise HidppError(data[5], feature, function)
                if data[2] == 0x8F and data[3] == feature:
                    raise Offline(f"device {index:#x} not reachable (code {data[5]:#x})")
                if data[2] == feature and data[3] == fnsw:
                    return data[4:]
                self.notifications.append(data)

    def ping(self, index: int, timeout: float = 1.5) -> tuple[int, int] | None:
        """HID++ protocol version of the device at `index`, or None if nothing answers."""
        try:
            r = self.request(index, 0x00, 1, b"\0\0\x5a", timeout=timeout, busy_retries=0)
        except (Timeout, Offline, HidppError):
            return None
        return r[0], r[1]

    def read_register(self, sub_id: int, address: int, params: bytes = b"", timeout: float = 0.5) -> bytes | None:
        """HID++ 1.0 receiver register read (short request). None on error or no reply."""
        pkt = bytes([SHORT, 0xFF, sub_id, address]) + bytes(params).ljust(SHORT_LEN - 4, b"\0")
        with self._lock:
            self._drain()
            os.write(self.fd, pkt)
            deadline = time.monotonic() + timeout
            while (left := deadline - time.monotonic()) > 0:
                if not select.select([self.fd], [], [], left)[0]:
                    break
                data = os.read(self.fd, 64)
                if len(data) >= 4 and data[1] == 0xFF:
                    if data[2] == sub_id and data[3] == address:
                        return data[4:]
                    if data[2] == 0x8F and data[3] == sub_id:
                        return None
                self.notifications.append(data)
        return None

    def paired_devices(self) -> list[tuple[int, int, str]]:
        """(slot, wireless pid, name) for each device paired to this receiver, awake or not."""
        out = []
        for slot in range(1, 7):
            info = self.read_register(0x83, 0xB5, bytes([0x1F + slot]))
            if not info:
                continue
            wpid = info[3] << 8 | info[4]
            raw = self.read_register(0x83, 0xB5, bytes([0x3F + slot])) or b""
            name = raw[2:2 + raw[1]].decode("utf-8", "replace") if len(raw) > 2 else ""
            out.append((slot, wpid, name))
        return out

    def take_notifications(self) -> list[bytes]:
        with self._lock:
            self._drain()
            out, self.notifications = self.notifications, []
        return out
