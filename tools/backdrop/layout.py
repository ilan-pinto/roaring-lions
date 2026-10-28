"""Slot grammar for a Wadi Halam map's backdrop ring (kit-spec section 2).

Pure python, no bpy. `layout_ns(w, h)` returns the explicit `pieces` list a map's
`backdrop` block would carry (`id`, `at` in map tiles, `rot`, `mirror`), for a
valley that runs north-south (`ns`): the far sides are WEST (x < 0) and NORTH
(z < 0), the near sides EAST and SOUTH.

Conventions (pinned by the mock, to be pinned by a unit test with the loader):
`at` is the midpoint of a piece's map-facing edge, in tiles; `rot` 0/90/180/270
puts the piece on the west/north/east/south side (the piece extends AWAY from the
map); the piece's along-edge axis `s` then points north / east / south / west.
`mirror` flips `s`.

The grammar: each side is cut into 16-tile slots. Far sides get a corner, then
walls with a seeded variant per slot (never the same variant twice in a row), then
a taper at each far/near corner. The north side is closed by the head wall (32
tiles) with the dark slot in its middle. Near sides get slopes and the near corner.
Terraces run along the far-wall feet, scree goes at the gully anchors, and crests
are staggered half a module behind the walls, leaving the head wall's slot open.
"""
from kitlib import tile_hash


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


def layout_ns(w=48, h=48, seed=7):
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
    # the outer corners beyond the tapers (SW and NE): the far side's rolling foreground continues
    for z, v in ((h + 24, "a"), (h + 40, "b")):
        add("bd_slope_near_" + v, (0, z), 0)
    for x, v in ((w + 24, "b"), (w + 40, "a")):
        add("bd_slope_near_" + v, (x, 0), 90)
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
    return P
