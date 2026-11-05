"""Protocol/codec tests that need no hardware. Run: python3 -m pytest tests  (or python3 tests/test_protocol.py)"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from hubless import profile as P  # noqa: E402
from hubless.device import Device, DpiGrid  # noqa: E402
from hubless.session import Session  # noqa: E402
from hubless.sim import DPI_WORDS, FACTORY, SimTransport  # noqa: E402


def test_factory_sector_roundtrip():
    p = P.decode(1, FACTORY, 8)
    assert P.crc_ok(FACTORY)
    assert p.encode() == FACTORY
    assert [s.x for s in p.stages] == [800, 1200, 1600, 2400, 3200]
    assert p.rate_hz == 1000 and p.rate_wired_hz == 1000
    assert p.hits == [P.Hits(5, 2, False, 3), P.Hits(5, 2, False, 3)]
    assert [b.describe() for b in p.buttons[:5]] == ["Left click", "Right click", "Middle click", "Back", "Forward"]
    assert p.sleep_s == 60 and p.off_s == 300


def test_hits_wire_encoding():
    h = P.Hits(10, 5, True, 5)
    assert h.to_wire() == bytes([0x28, 0x15, 0x14])
    assert P.Hits.from_wire(bytes([0x14, 0x08, 0x0C])) == P.Hits(5, 2, False, 3)


def test_hits_code_matches_ghub_format():
    # Published G HUB code: actuation 4/5, rapid trigger 3/5 (right off), haptics 4/3
    left, right = P.parse_hits_code("MDAwNDA1MDMwNTEwMDQwMw==")
    assert left == P.Hits(4, 3, True, 4) and right == P.Hits(5, 5, False, 3)
    assert P.hits_code(left, right) == "MDAwNDA1MDMwNTEwMDQwMw=="


def test_rate_encoding():
    p = P.decode(1, FACTORY, 8)
    for hz in (125, 250, 500, 1000, 2000, 4000, 8000):
        p.rate_hz = hz
        assert P.decode(1, p.encode(), 8).rate_hz == hz


def test_name_and_unknown_bytes_survive():
    p = P.decode(1, FACTORY, 8)
    p.name = "Aim ✓"
    raw = p.encode()
    assert P.decode(1, raw, 8).name == "Aim ✓"
    assert raw[0xD0:0xFD] == FACTORY[0xD0:0xFD]


def test_dpi_grid_from_real_device_list():
    g = DpiGrid(DPI_WORDS)
    assert (g.min, g.max) == (100, 44000)
    assert [g.snap(v) for v in (150, 1234, 7777, 26000, 43950, 99999, 1)] == [150, 1230, 7800, 26000, 44000, 44000, 100]


def test_session_save_on_simulator():
    s = Session(Device(SimTransport(), 1).connect())
    s.backed_up = True  # don't write backup files from tests
    s.load()
    p = s.active.copy()
    p.stages[0] = P.Stage(1600, 1600, 2)
    p.hits[0] = P.Hits(2, 1, True, 0)
    s.save_profile(p)
    assert s.dev.read_profile(1).stages[0].x == 1600
    assert s.dev.hits_get(0) == P.Hits(2, 1, True, 0)


def test_stage_gaps_are_packed():
    # The user's case: stages 1, 2, 4 and 5 switched off, stage 3 (1600) kept and set as the start stage.
    p = P.decode(1, FACTORY, 8)
    for i in (0, 1, 3, 4):
        p.stages[i] = P.Stage(0, 0, 2)
    p.default_stage = 2
    q = P.decode(1, p.encode(), 8)
    assert [s.x for s in q.stages] == [1600, 0, 0, 0, 0] and q.default_stage == 0


def test_session_repairs_live_stage_after_gap():
    t = SimTransport()
    s = Session(Device(t, 1).connect())
    s.backed_up = True
    s.load()
    p = s.active.copy()
    for i in (0, 1, 3, 4):
        p.stages[i] = P.Stage(0, 0, 2)
    p.default_stage = 2
    s.save_profile(p)
    assert t.stage == 0 and s.dev.read_profile(1).stages[0].x == 1600


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
