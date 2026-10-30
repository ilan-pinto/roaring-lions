"""Tests for the wetland P3 builders (plain python3, no Blender): the numbers the lead
approved, each with the input that makes it fail.

    python3 tools/terrain/test_wetland_kit.py     (or pytest)
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_reeds as BR  # noqa: E402
import build_wet_grass as BG  # noqa: E402
import build_wetland_props as BP  # noqa: E402
import wetland_kit as K  # noqa: E402

REED_H = {0: 1.25, 1: 1.10, 2: 1.00}


def _bounds(*soups):
    both = K.TriSoup()
    for s in soups:
        both.merge(s)
    return both.bounds()


def test_hash_stream_is_uncorrelated():
    s = K.Stream(7101)
    u = [s.u() for _ in range(2000)]
    m = sum(u) / len(u)
    num = sum((a - m) * (b - m) for a, b in zip(u, u[1:]))
    den = sum((a - m) ** 2 for a in u)
    assert abs(num / den) < 0.08  # the first cut read 0.94


def test_reed_caps_heights_and_footprint():
    for v, h in REED_H.items():
        f, t = BR.build(v)
        lo, hi = _bounds(f, t)
        assert f.count + t.count <= 400
        assert f.count + t.count >= 360, "max detail: the clump should spend its cap"
        assert abs(hi[2] - h) < 1e-6, (v, hi[2])
        assert lo[2] >= 0.0
        # DRAWN height after the 0.8-1.2 roll never exceeds 1.5 m
        assert hi[2] * 1.2 <= 1.5 + 1e-9
        assert max(math.hypot(x, y) for x, y, _ in f.verts + t.verts) <= 1.27  # a 2.5 m clump
        assert t.count > 0 and all(0.0 <= z for _, _, z in t.verts)


def test_reed_height_check_catches_a_taller_model():
    # falsifier: reed_0 scaled x1.3 draws above 1.5 m at the top of the roll
    f, t = BR.build(0)
    hi = _bounds(f, t)[1][2] * 1.3
    assert hi * 1.2 > 1.5


def test_grass_is_not_taller_than_the_shipped_grass():
    for v in BG.VARIANTS:
        f, t = BG.build(v)
        lo, hi = _bounds(f, t)
        assert hi[2] <= 0.40 + 1e-9
        assert hi[2] * 0.9 <= 0.36 + 1e-9  # N-4: GRASS_SCALE_MAX 0.9
        assert f.count + t.count <= 200
    # falsifier: GRASS_SCALE_MAX 1.2 breaks N-4
    assert 0.40 * 1.2 > 0.36


def test_props_caps_and_dimensions():
    for kind, cap in BP.CAPS.items():
        roles = BP.build(kind)
        assert sum(s.count for s in roles.values()) <= cap
    bale = BP.build("round_bale")["rubber"]
    lo, hi = bale.bounds()
    assert abs((hi[0] - lo[0]) - 1.10) < 0.01 and 0.99 < hi[2] < 1.05
    cul = BP.build("culvert_pipe")["concrete"]
    lo, hi = cul.bounds()
    assert abs(hi[2] - 1.0) < 0.01 and lo[2] >= 0.0
    # the headwall is 1.6 m wide (the apron adds a little each side)
    assert 1.6 <= hi[1] - lo[1] <= 1.8
    # falsifier: a cap of 300 on the culvert (the table, not the model) makes the build refuse
    old = BP.CAPS["culvert_pipe"]
    BP.CAPS["culvert_pipe"] = 100
    try:
        try:
            BP.build("culvert_pipe")
            raise RuntimeError("cap not enforced")
        except AssertionError:
            pass
    finally:
        BP.CAPS["culvert_pipe"] = old


def test_cones_face_outward():
    # every triangle of a cone faces away from its axis (so FrontSide shows it from outside)
    s = K.TriSoup()
    s.cone((0, 0, 0), (0, 0, 1), 1.0, 0.1, flat_base=True)
    for a, b, c in s.tris:
        pa, pb, pc = s.verts[a], s.verts[b], s.verts[c]
        n = K.v_cross(K.v_sub(pb, pa), K.v_sub(pc, pa))
        centre = K.v_mul(K.v_add(K.v_add(pa, pb), pc), 1 / 3)
        assert K.v_dot(n, (centre[0], centre[1], 0.0)) > 0
    # falsifier: reversing the winding flips it
    a, b, c = s.tris[0]
    pa, pb, pc = s.verts[a], s.verts[c], s.verts[b]
    n = K.v_cross(K.v_sub(pb, pa), K.v_sub(pc, pa))
    centre = K.v_mul(K.v_add(K.v_add(pa, pb), pc), 1 / 3)
    assert K.v_dot(n, (centre[0], centre[1], 0.0)) < 0


def test_ribbons_are_double_sided():
    s = K.TriSoup()
    s.ribbon((0, 0, 0), (0, 0, 1), 1.0, 0.1)
    assert s.count == 2
    normals = []
    for a, b, c in s.tris:
        pa, pb, pc = s.verts[a], s.verts[b], s.verts[c]
        normals.append(K.v_norm(K.v_cross(K.v_sub(pb, pa), K.v_sub(pc, pa))))
    assert K.v_dot(normals[0], normals[1]) < -0.999  # opposite faces: one draws from any side


def test_deterministic():
    for v in REED_H:
        a, b = BR.build(v), BR.build(v)
        assert a[0].verts == b[0].verts and a[1].tris == b[1].tris


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
