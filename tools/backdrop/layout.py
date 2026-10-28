"""Slot grammar for a Wadi Halam map's backdrop ring (kit-spec section 2).

Pure python, no bpy. `layout_ns(w, h, rim=...)` returns the explicit `pieces` list a map's
`backdrop` block would carry (`id`, `at` in map tiles, `rot`, `mirror`, `ys`, and, with a
`rim` function, `y`), for a valley that runs north-south (`ns`): the far sides are WEST
(x < 0) and NORTH (z < 0), the near sides EAST and SOUTH.

Conventions (pinned by the mock, to be pinned by a unit test with the loader):
`at` is the midpoint of a piece's map-facing edge, in tiles; `rot` 0/90/180/270
puts the piece on the west/north/east/south side (the piece extends AWAY from the
map); the piece's along-edge axis `s` then points north / east / south / west.
`mirror` flips `s`. The outer-corner piece is the exception: its `at` is the point of its
inner edge where it meets the taper (local s = 0), and it extends from there.

`y` (second pass): the BASE HEIGHT of the piece at its two ends along the edge, `[y(s_lo),
y(s_hi)]` in metres, read from the rim under each end (`piece_ends`). One base per family
buried the north wall's foot (rim 3 m) and floated the south-west (rim 0 m); a base per end
follows the ground and, because two neighbours share the rim point at their seam, is
continuous across it. The mock tilts the piece linearly between the two (a z-shear in the
along-edge direction); the loader would do the same to the positions at load.

The grammar: each side is cut into 16-tile slots. Far sides get a corner, then
walls with a seeded variant per slot (never the same variant twice in a row), then
a taper and an outer corner at each far/near corner. The north side is closed by the
head wall (32 tiles) with the dark slot in its middle. Near sides get slopes and the near
corner. Terraces run along the far-wall feet, scree goes at the gully anchors, and crests
are staggered half a module behind the walls, leaving the head wall's slot open.
"""
import math

from kitlib import tile_hash, CREST_M

TILE = 3.0

#: local s extent (metres) over which a piece's `y` pair is given, by piece id prefix
S_EXTENT = {
    "bd_wall_far": (-24.0, 24.0), "bd_taper": (-24.0, 24.0), "bd_crest": (-24.0, 24.0), "bd_slope_near": (-24.0, 24.0),
    "bd_head_wall": (-48.0, 48.0), "bd_terrace": (-12.0, 12.0), "bd_outer_corner": (0.0, 90.0),
}
#: how far above the rim under its inner edge a piece's local z = 0 sits
BASE_OFFSET = {"bd_crest": CREST_M - 0.4}
FOOT_BURY = 0.06     # the foot starts a hair under the floor, so no gap shows at the rim


def s_extent(pid):
    for k, v in S_EXTENT.items():
        if pid.startswith(k):
            return v
    return None


def along_dir(rot, mirror):
    """Unit (dx, dz) in map tiles-per-metre-of-s: where local +s points on the map."""
    d = {0: (0.0, -1.0), 90: (1.0, 0.0), 180: (0.0, 1.0), 270: (-1.0, 0.0)}[rot % 360]
    k = -1.0 if mirror else 1.0
    return d[0] * k / TILE, d[1] * k / TILE


def edge_point(pl, s_m):
    """Map position (tiles) of the point at local `s_m` metres along a piece's inner edge."""
    dx, dz = along_dir(pl["rot"], pl["mirror"])
    return pl["at"][0] + dx * s_m, pl["at"][1] + dz * s_m


def piece_ends(pl, rim):
    """`[y(s_lo), y(s_hi)]` for a placement, from the rim under its two ends (None if it has no extent)."""
    ext = s_extent(pl["id"])
    if ext is None:
        return None
    off = next((v for k, v in BASE_OFFSET.items() if pl["id"].startswith(k)), 0.0)
    return [float(rim(*edge_point(pl, s)) - FOOT_BURY + off) for s in ext]


def _variants(n, seed, names):
    out, prev = [], None
    for i in range(n):
        k = int(tile_hash(i + seed, 7 + seed) * len(names))
        v = names[k % len(names)]
        if v == prev:
            v = names[(k + 1) % len(names)]
        out.append(v)
        prev = v
    return out


def layout_ns(w=48, h=48, seed=7, rim=None, profile=None):
    P = []

    def add(pid, at, rot, mirror=False, ys=1.0):
        P.append({"id": pid, "at": [float(at[0]), float(at[1])], "rot": rot, "mirror": mirror, "ys": ys})

    nslots = h // 16
    # far, west: the corner, then walls, then the taper at the near end
    add("bd_wall_corner", (0, 0), 0)
    for k, v in enumerate(_variants(nslots, seed, ["a", "b", "c"])):
        add("bd_wall_far_" + v, (0, 8 + 16 * k), 0)
    add("bd_taper", (0, h + 8), 0, mirror=True)
    # far, north: the head wall, a wall, the taper
    add("bd_head_wall", (16, 0), 90)
    add("bd_wall_far_" + _variants(1, seed + 3, ["a", "c"])[0], (40, 0), 90)
    add("bd_taper", (w + 8, 0), 90)
    # the two outer corners (SW and NE), where a far wall's taper meets a near side: one piece each,
    # starting at the taper's free end and continuing the spur round into the near foreground
    add("bd_outer_corner", (0, h + 16), 0, mirror=True)
    add("bd_outer_corner", (w + 16, 0), 90)
    # near: east and south slopes, the near corner
    for k, v in enumerate(_variants(nslots, seed + 5, ["a", "b"])):
        add("bd_slope_near_" + v, (w, 8 + 16 * k), 180)
    for k, v in enumerate(_variants(w // 16, seed + 9, ["a", "b"])):
        add("bd_slope_near_" + v, (8 + 16 * k, h), 270)
    add("bd_slope_corner", (w, h), 180)
    # terraces at the foot of the far walls
    for k in range(h // 8):
        add("bd_terrace_" + ("a", "b")[k % 2], (0, 4 + 8 * k), 0)
    add("bd_terrace_a", (4, 0), 90)
    add("bd_terrace_end", (12, 0), 90)                    # closes against the slot (bank on +s)
    add("bd_terrace_end", (20, 0), 90, mirror=True)       # and from the other side
    for k, x in enumerate((28, 36, 44)):
        add("bd_terrace_" + ("b", "a", "b")[k], (x, 0), 90)
    # scree over the foot of the cliff band
    add("bd_scree_a", (-7, 20), 0)
    add("bd_scree_c", (-7, 42), 0)
    add("bd_scree_b", (30, -8), 90)
    # crests, staggered half a module behind the walls (no crest behind the slot)
    for k, z in enumerate((0, 16, 32, 48)):
        add("bd_crest_" + "ab"[k % 2], (-28, z), 0)
    add("bd_crest_b", (-28, -16), 0)
    for k, x in enumerate((0, 32, 48)):
        add("bd_crest_" + "ab"[(k + 1) % 2], (x, -24), 90)
    if rim is not None:
        for pl in P:
            pid = pl["id"]
            if pid.startswith("bd_scree"):
                # free-placed over a wall's foot: it stands on the wall surface at its distance out
                d = abs(pl["at"][0]) * TILE if pl["rot"] in (0, 180) else abs(pl["at"][1]) * TILE
                base = float(rim(*edge_point(pl, 0.0))) - FOOT_BURY
                pl["y"] = [base + float(profile(d))] * 2 if profile else [base] * 2
            elif pid in ("bd_wall_corner",):
                pl["y"] = [float(rim(0.0, 0.0)) - FOOT_BURY] * 2
            elif pid == "bd_slope_corner":
                pl["y"] = [float(rim(w, h)) - FOOT_BURY] * 2
            else:
                pl["y"] = piece_ends(pl, rim)
    return P
