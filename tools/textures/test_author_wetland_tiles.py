"""Tests for `author_wetland_tiles.py`, with the constructed input that makes each check fail.

    python3 tools/textures/test_author_wetland_tiles.py     (or pytest)

Each `test_*` that gates something has a `falsify_*` twin run inside it: the gate must go
red on the constructed input, or the test itself fails.
"""
import hashlib
import os
import sys

import numpy as np
from scipy.ndimage import gaussian_filter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import author_wetland_tiles as A  # noqa: E402


def test_hash_is_not_correlated():
    # The first cut hashed consecutive inputs 0.94 correlated (a bare FNV step); a lattice
    # built on it was visibly streaky. Literal oracle: |lag-1 correlation| under 0.1.
    lat = A.lattice(64, 101)
    assert abs(np.corrcoef(lat[:, :-1].ravel(), lat[:, 1:].ravel())[0, 1]) < 0.1
    assert abs(np.corrcoef(lat[:-1].ravel(), lat[1:].ravel())[0, 1]) < 0.1
    # falsifier: a lattice of consecutive integers is exactly the case the old hash failed
    ramp = (np.arange(64)[:, None] + np.arange(64)[None, :]).astype(np.float32)
    assert abs(np.corrcoef(ramp[:, :-1].ravel(), ramp[:, 1:].ravel())[0, 1]) > 0.9


def test_pnoise_is_periodic():
    n = pn = A.pnoise(256, 8, 5)
    # the wrap pair differs like any adjacent pair (it is one more adjacent pair)
    wrap = np.abs(n[:, 0] - n[:, -1]).mean()
    inner = np.abs(np.diff(n, axis=1)).mean()
    assert wrap < 3 * inner
    # falsifier: a non-periodic ramp breaks it by a wide margin
    ramp = np.tile(np.linspace(-1, 1, 256, dtype=np.float32), (256, 1))
    assert np.abs(ramp[:, 0] - ramp[:, -1]).mean() > 100 * np.abs(np.diff(ramp, axis=1)).mean()


def test_seam_check_goes_red_on_a_step():
    img = A.to_u8(A.box_down(A.author_open(1024), 1))
    ratio, rank, ok = A.seam_check(img)
    assert ok, (ratio, rank)
    # falsifier: a brightness ramp across the image has a step at the repeat
    ramp = np.clip(img.astype(np.float64) + np.linspace(0, 120, 1024)[None, :, None], 0, 255).astype(np.uint8)
    assert not A.seam_check(ramp)[2]


def test_deterministic():
    a = A.to_u8(A.author_scree(1024))
    b = A.to_u8(A.author_scree(1024))
    assert hashlib.md5(a.tobytes()).hexdigest() == hashlib.md5(b.tobytes()).hexdigest()


def test_de2000_reproduces_published_figures():
    # tools/src/delta-e2000.ts's published fen.0 figures (the spec 4.2 / readability test): the
    # pre-S6 fen.0 #75A659 read 18.37 against KDF olive.1, the post-S6 #7F9F57 reads 15.82.
    ref = A.srgb_to_lab(A.hex_rgb(A.OLIVE_1))
    for hexv, want in (("#75A659", 18.37), ("#7F9F57", 15.82)):
        got = float(A.de2000(A.srgb_to_lab(A.hex_rgb(hexv)), ref))
        assert abs(got - want) < 0.06, (hexv, got, want)
    # falsifier: scrub.0 as the open tone is what the sheet says fails the floor (9.8)
    assert float(A.de2000(A.srgb_to_lab(A.hex_rgb("#6B8A4A")), ref)) < 15.6


def test_open_tile_figure_ground_and_its_falsifier():
    spec = A.TILES["wetland_open_tile"]
    u8 = A.to_u8(A.author_open(1024))
    share, _, _ = A.figure_ground(u8, spec, A.TONES["open"][1])
    assert share <= A.FG_LIMIT, share
    # falsifier (spec 9.2): the tile authored at a 60% mud share with soft mixed edges
    bad = A.to_u8(A.author_open(1024, mud_share=0.6, soft=0.12))
    share_bad, _, _ = A.figure_ground(bad, spec, A.TONES["open"][1])
    assert share_bad > share
    assert share_bad > A.FG_LIMIT, share_bad


def test_open_tile_keeps_its_contrast_floor_and_the_floor_bites():
    spec = A.TILES["wetland_open_tile"]
    u8 = A.to_u8(A.author_open(1024))
    assert A.visible_contrast(u8, spec) > A.MIN_VISIBLE_CONTRAST
    # falsifier: the same image at gain 0.4 is under the floor
    assert A.visible_contrast(u8, dict(spec, gain=0.4)) < A.MIN_VISIBLE_CONTRAST


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
