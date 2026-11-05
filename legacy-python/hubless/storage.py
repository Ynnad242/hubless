"""Backups, profile import/export and the one-time udev permission fix."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path

DATA = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "hubless"
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "hubless"

UDEV_RULE_PATH = "/etc/udev/rules.d/70-hubless.rules"
# Vendors whose peripherals Hubless talks to: Logitech, Wooting, Fractal Design.
VENDORS = {"046d": "Logitech", "31e3": "Wooting", "36bc": "Fractal Design"}
UDEV_RULE = "# hubless: let the logged-in user configure their mice, keyboards and headsets\n" + "".join(
    f'KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{{idVendor}}=="{vid}", TAG+="uaccess"  # {name}\n'
    for vid, name in VENDORS.items())


def backup_dir(serial: str) -> Path:
    d = DATA / "backups" / (serial or "unknown")
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_backup(serial: str, name: str, fmt: int, sectors: dict[int, bytes], label: str = "auto") -> Path:
    path = backup_dir(serial) / f"{time.strftime('%Y-%m-%d_%H-%M-%S')}_{label}.json"
    path.write_text(json.dumps({
        "hubless_backup": 1, "device": name, "serial": serial, "format": fmt, "created": time.time(),
        "label": label, "sectors": {f"{k:#06x}": v.hex() for k, v in sectors.items()},
    }, indent=1))
    return path


def list_backups(serial: str) -> list[dict]:
    out = []
    for p in sorted(backup_dir(serial).glob("*.json"), reverse=True):
        try:
            data = json.loads(p.read_text())
            data["path"] = str(p)
            out.append(data)
        except (OSError, ValueError):
            continue
    return out


def load_backup(path: str) -> dict[int, bytes]:
    data = json.loads(Path(path).read_text())
    if data.get("hubless_backup") != 1:
        raise ValueError("Not a hubless backup file.")
    return {int(k, 16): bytes.fromhex(v) for k, v in data["sectors"].items()}


def export_profile(path: str, device_name: str, fmt: int, raw: bytes, name: str):
    Path(path).write_text(json.dumps({
        "hubless_profile": 1, "device": device_name, "format": fmt, "name": name, "sector": raw.hex(),
    }, indent=1))


def import_profile(path: str, fmt: int, size: int) -> bytes:
    data = json.loads(Path(path).read_text())
    if data.get("hubless_profile") != 1:
        raise ValueError("Not a hubless profile file.")
    if data.get("format") != fmt:
        raise ValueError("That profile was made for a different kind of mouse.")
    raw = bytes.fromhex(data["sector"])
    if len(raw) != size:
        raise ValueError("That profile file is damaged.")
    return raw


def install_udev_rule() -> tuple[bool, str]:
    """Install the uaccess rule with a polkit password prompt. Returns (ok, message)."""
    pkexec = shutil.which("pkexec")
    if not pkexec:
        return False, ("Your system has no polkit (pkexec). Install the rule from data/70-hubless.rules with:\n"
                       f"sudo cp data/70-hubless.rules {UDEV_RULE_PATH}")
    script = (
        'printf "%s" "$1" > "$2" && chmod 644 "$2" && udevadm control --reload-rules '
        "&& udevadm trigger --action=add --subsystem-match=hidraw && udevadm settle"
    )
    try:
        r = subprocess.run([pkexec, "/bin/sh", "-c", script, "hubless", UDEV_RULE, UDEV_RULE_PATH],
                           capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return False, "The permission prompt timed out."
    if r.returncode == 0:
        return True, "Access granted."
    if r.returncode in (126, 127):
        return False, "Permission was not granted."
    return False, (r.stderr or r.stdout or "Could not install the rule.").strip()


def load_settings() -> dict:
    try:
        return json.loads((CONFIG / "settings.json").read_text())
    except (OSError, ValueError):
        return {}


def save_settings(s: dict):
    CONFIG.mkdir(parents=True, exist_ok=True)
    (CONFIG / "settings.json").write_text(json.dumps(s, indent=1))
