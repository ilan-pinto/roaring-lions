"""Parts every Roaring Lions vehicle is assembled from.

Same bargain as tools/buildings/kit.py and tools/units/kit.py: consistency is
structural because every wheel in the game is one function call, and
distinctness stays authored per type in the author_*.py scripts.

Why a kit at all, for vehicles. The four downloaded hulls have no shared
vocabulary -- a tank, a truck standing in for an APC, a jeep and an IFV, each
carrying its own modelling conventions, none reproducible (art/src/*.blend is
gitignored, so the sprites ship with no source). Authoring them means the
silhouettes can be designed against each other instead of discovered after the
fact, which is what the art gate's pairwise IoU limit actually asks for.

Two rules carried over from the other kits, both easy to get wrong:

  * **Real vertex coordinates, object scale always 1.** Parts build geometry
    with `from_pydata` at final size; nothing touches `obj.scale`. The
    render-side material can then project from Object coordinates without
    getting stretched by a parent transform.

  * **Every part declares `rl_role`.** The renderer assigns materials from it.
    A part with no role falls back to a name heuristic meant for hand-modelled
    sources, which is not what a kit part wants.

World scale is `dimetric.UNITS_PER_TILE` -- 3.0 units per map tile, about a
metre per unit, so a 8.5 m hull is 8.5 units long.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dimetric import UNITS_PER_TILE  # noqa: E402,F401

#: Vehicle part roles. `hull` is the painted body, `plate` the bolt-on armour
#: and hatches that break it up, `rubber` tyres, `metal` barrels, rails and the
#: weapon station, `glass` vision blocks, `recess` the shadowed gaps a flat
#: olive box does not have.
ROLES = ("hull", "plate", "rubber", "metal", "glass", "recess")


def new_scene():
    """An empty file. Author scripts start from nothing, every time."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def save(path):
    """Write the .blend. Authored vehicle sources are tracked in plain git --
    unlike art/src/*.blend, which .gitignore excludes, leaving the downloaded
    hulls unreproducible."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=path)
    print(f"saved {path} ({len(bpy.data.objects)} objects)")


def _mesh(name, verts, faces, role):
    if role not in ROLES:
        raise ValueError(f"{name}: unknown role {role!r}, expected one of {ROLES}")
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    ob["rl_role"] = role
    bpy.context.collection.objects.link(ob)
    return ob


def box(name, size, at, role="hull"):
    """A cuboid. `size` is (sx, sy, sz); `at` is its centre."""
    sx, sy, sz = (s / 2.0 for s in size)
    cx, cy, cz = at
    v = [
        (cx - sx, cy - sy, cz - sz), (cx + sx, cy - sy, cz - sz),
        (cx + sx, cy + sy, cz - sz), (cx - sx, cy + sy, cz - sz),
        (cx - sx, cy - sy, cz + sz), (cx + sx, cy - sy, cz + sz),
        (cx + sx, cy + sy, cz + sz), (cx - sx, cy + sy, cz + sz),
    ]
    f = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return _mesh(name, v, f, role)


def hull_box(name, length, width, height, at, slope_deg=12.0, nose_deg=0.0, role="hull"):
    """The body: a box whose sides lean outward toward the roof.

    `slope_deg` is what separates an armoured hull from a shipping container in
    a 64px silhouette. The sun sits at 55 degrees altitude, so a vertical flank
    and a horizontal roof return two flat tones and the join between them is a
    hard line; leaning the flank puts a third tone between them and the roll of
    the vehicle reads. 12 degrees is the smallest angle that still produces a
    distinct band at gameplay zoom.

    `nose_deg` rakes the front plate back by the same trick, so the vehicle has
    a recognisable front from every facing rather than only in profile.
    `at` is the centre of the floor.
    """
    cx, cy, cz = at
    hl, hw = length / 2.0, width / 2.0
    inset = math.tan(math.radians(slope_deg)) * height
    rake = math.tan(math.radians(nose_deg)) * height
    # floor, then roof narrowed by the slope and shortened at the nose
    v = [
        (cx - hl, cy - hw, cz), (cx + hl, cy - hw, cz),
        (cx + hl, cy + hw, cz), (cx - hl, cy + hw, cz),
        (cx - hl + inset, cy - hw + inset, cz + height),
        (cx + hl - inset - rake, cy - hw + inset, cz + height),
        (cx + hl - inset - rake, cy + hw - inset, cz + height),
        (cx - hl + inset, cy + hw - inset, cz + height),
    ]
    f = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return _mesh(name, v, f, role)


def wheel(name, radius, width, at, role="rubber", segments=12):
    """A road wheel: a cylinder lying on its side, axis along y.

    Twelve segments, not sixteen. A wheel is about six pixels at gameplay zoom
    and the extra facets cost geometry nothing can see, but the count matters
    for the quantizer: fewer, larger facets hold a flat palette tone instead of
    dithering along the curve.
    """
    cx, cy, cz = at
    hw = width / 2.0
    v, f = [], []
    for side, y in ((0, cy - hw), (1, cy + hw)):
        for i in range(segments):
            a = 2 * math.pi * i / segments
            v.append((cx + radius * math.cos(a), y, cz + radius * math.sin(a)))
    for i in range(segments):
        j = (i + 1) % segments
        f.append((i, j, segments + j, segments + i))
    f.append(tuple(range(segments - 1, -1, -1)))
    f.append(tuple(range(segments, 2 * segments)))
    return _mesh(name, v, f, role)


def wheels_in_pairs(prefix, pairs_x, y_offset, radius, width, z, role="rubber"):
    """One wheel each side at every x in `pairs_x`.

    Wheel *count* is the cheapest silhouette cue a wheeled hull has against a
    tracked one, and it survives being 100px wide -- which a tread pattern does
    not.
    """
    out = []
    for i, x in enumerate(pairs_x):
        out.append(wheel(f"{prefix}_l{i}", radius, width, (x, -y_offset, z), role))
        out.append(wheel(f"{prefix}_r{i}", radius, width, (x, y_offset, z), role))
    return out


def rws(prefix, size, at, barrel_len, barrel_r=0.06):
    """A remote weapon station: a small boxy mount with a barrel along +x.

    Deliberately small. `rws_50` in the unit data is a remote .50, not a manned
    turret, and drawing a turret the crew could sit in misreads the unit -- an
    APC with an IFV's profile is exactly the confusion the silhouette gate
    exists to prevent.
    """
    sx, sy, sz = size
    cx, cy, cz = at
    out = [box(f"{prefix}_mount", (sx, sy, sz), (cx, cy, cz + sz / 2.0), role="metal")]
    out.append(box(f"{prefix}_shield", (sx * 0.35, sy * 1.15, sz * 0.8),
                   (cx - sx * 0.2, cy, cz + sz * 0.6), role="plate"))
    out.append(wheel(f"{prefix}_barrel", barrel_r, barrel_len,
                     (cx + sx * 0.5 + barrel_len * 0.0, cy, cz + sz * 0.62), role="metal"))
    return out


def barrel(name, radius, length, at, role="metal", segments=8):
    """A gun barrel: a cylinder along +x, `at` is the centre of its breech end."""
    cx, cy, cz = at
    v, f = [], []
    for end, x in ((0, cx), (1, cx + length)):
        for i in range(segments):
            a = 2 * math.pi * i / segments
            v.append((x, cy + radius * math.cos(a), cz + radius * math.sin(a)))
    for i in range(segments):
        j = (i + 1) % segments
        f.append((i, j, segments + j, segments + i))
    f.append(tuple(range(segments - 1, -1, -1)))
    f.append(tuple(range(segments, 2 * segments)))
    return _mesh(name, v, f, role)
