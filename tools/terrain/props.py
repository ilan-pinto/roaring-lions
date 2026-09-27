"""Build the seven small props from ART_PIPELINE §6 / the ground design's
§3.4 ("Props: jersey barrier, water tank, satellite dish, laundry line, tyre
pile, rebar and wrecked car") entirely in code -- no Meshy, no source .blend
files at all. Ground plan 2, Task 3 (D7: "Props: Blender now, Meshy only on a
failed review", approved 2026-09-27).

**Superseded as the source of the CURRENTLY SHIPPED `art/meshes/props/*.glb`
by Task 3b (2026-09-27): the lead reviewed Meshy base models for all seven
kinds and approved them ("Use all 7"), so the committed GLBs now come from
`export_meshy_props.py` (same directory) instead of this file. This module
is kept, unmodified and still runnable, as the documented fallback if a
future review sends any kind back to Blender-only -- see D7's own "Meshy
only on a failed review" and `export_meshy_props.py`'s own module docstring.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/terrain/props.py

    # --only <kind>[,<kind>...] restricts export() to a subset, the same
    # convention export_meshy_decor.py already uses:
    #     ... --python tools/terrain/props.py -- --only wrecked_car

Writes 7 GLBs to `art/meshes/props/<kind>.glb` for `kind` in `PROP_KINDS`
(`packages/render/src/three/terrain/prop-role.ts`). Every part is a plain
primitive -- a box, a straight or bent tube swept along a small polyline, or a
torus (a closed tube swept around a circle) -- built directly with `bmesh`,
never downloaded, never hand-posed. Zero materials: every mesh node carries
`extras.rl_role` from the closed set `PROP_ROLES` below, coloured at runtime
by `prop-role.ts`'s ramp table, mirroring the mesh unit contract's own rule.

## Reusing `_finalize_and_export`, not copying it

`_finalize_and_export` in `export_meshy_decor.py` (same directory) is the
project's one existing "join role objects, strip extras, export a role-tagged
GLB with these exact glTF settings" routine, and this file imports it rather
than forking a second copy of the export call. Its role check reads a module
GLOBAL (`DECOR_ROLES`), not a parameter, so this file swaps that global to its
own closed prop vocabulary before ever calling it -- see `import
export_meshy_decor` below. Nothing else about that module runs: it is only
ever driven from its own `if __name__ == "__main__"` guard, so importing it
here costs nothing beyond the one function (and the `DECOR_ROLES` name) this
file actually uses.

## Determinism -- no `mathutils.noise`, ever

Blender 5.2 reseeds `mathutils.noise` per process, so any prop irregularity
built from it would shape-shift between runs and the gate's own re-export
comparison (Task 3's falsification step) could never pass. Every irregular
touch here -- the tyre pile's stacking jitter, each rebar rod's bend, the
wrecked car's single dented body panel -- reads from `_hash01`, a plain
FNV-1a-style integer hash (the same shape `render_building.py`'s own
`_hash01` and `render_campaign_world.py`'s `_hash01` already use in this
tree, reimplemented here rather than imported across two unrelated render
pipelines) seeded from small integers this file already knows: a prop's index
in `PROP_KINDS` and a part's index within it. Same inputs, same floats, every
run, on any machine, forever -- which is what makes the export-twice-and-md5
check in this file's own report meaningful at all.

## Scale and orientation

Every kind is built directly in metres -- no Meshy source to convert, so
`dimetric.metres_per_unit` (a *conversion* between a downloaded model's own
arbitrary units and real size) has nothing to do here. This follows the SAME
downstream convention `export_meshy_decor.py`'s own "SCALE" section fixes for
decor: the GLB ships in real metres, and it is the *loader*
(`prop-place.ts`/`prop-mesh.ts`, Task 4) that applies `MESH_SCALE = 1/3` to
bring a 3-metre tile down to a 1-world-unit tile, exactly as every other mesh
loader in the pipeline already does. This script does not touch that loader.

Every prop's origin is its ground footprint centre at Z=0 -- nothing in any
builder below places geometry below Z=0 -- and every long or directional
prop (the barrier, the laundry line's rope, the wrecked car's chassis) runs
along +X, so a placement yaw of 0 turns reads as "along the road" when the
road itself runs along +X, the same convention Task 3's brief states for the
jersey barrier and applied here to every kind that has a long axis at all.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

# `_finalize_and_export`'s glTF export settings, reused rather than
# duplicated -- see module docstring. Importing this module does not run its
# `export()`: that only fires from its own `__main__` guard.
import export_meshy_decor as _decor  # noqa: E402

REPO = os.path.dirname(TOOLS)

_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--out-dir" in _argv:
    OUT_DIR = _argv[_argv.index("--out-dir") + 1]
else:
    OUT_DIR = os.path.join(REPO, "art", "meshes", "props")

if "--only" in _argv:
    ONLY_KINDS = set(_argv[_argv.index("--only") + 1].split(","))
else:
    ONLY_KINDS = None

CREDIT = (
    "Small ground props (jersey barrier, water tank, satellite dish, "
    "laundry line, tyre pile, rebar, wrecked car) -- code-authored geometry, "
    "no AI generation, no source .blend files; role-tagged for Roaring Lions"
)

# Mirrors `PROP_MESH_ROLES` in `packages/render/src/three/terrain/prop-role.ts`
# and `PROP_ROLES` in `tools/validate_mesh_assets.py`. Not imported (those are
# TypeScript/a sibling gate script respectively); kept in sync by hand, the
# same way `export_meshy_decor.py`'s own `DECOR_ROLES` tracks its TypeScript
# counterpart.
PROP_ROLES = {"concrete", "metal", "rust", "rubber", "cloth"}

# `_finalize_and_export`'s role check reads `export_meshy_decor.DECOR_ROLES`
# as a module global rather than taking one as a parameter. Swapped once,
# here, rather than forking the function to add a parameter it does not
# otherwise need -- see module docstring.
_decor.DECOR_ROLES = frozenset(PROP_ROLES)

# Mirrors `PROP_KINDS` in prop-role.ts. Order matters only for `--only` and
# the printed summary; the seven GLBs are independent.
PROP_KINDS = [
    "jersey_barrier",
    "water_tank",
    "satellite_dish",
    "laundry_line",
    "tyre_pile",
    "rebar",
    "wrecked_car",
]


def _hash01(*ints):
    """Deterministic 0..1 from integers -- never `mathutils.noise`, see module
    docstring. Same FNV-1a-style mix `render_building.py`'s own `_hash01`
    uses; reimplemented here rather than imported across two unrelated
    Blender pipelines."""
    h = 2166136261
    for v in ints:
        h ^= (int(v) & 0xFFFFFFFF)
        h = (h * 16777619) & 0xFFFFFFFF
        h ^= h >> 13
    return (h & 0xFFFFFFFF) / 4294967295.0


def _clear_scene():
    """Every builder below runs in the SAME Blender session (there is no
    per-kind source .blend to re-open, unlike export_meshy_decor.py), and
    `_finalize_and_export` exports with `use_selection=False` -- so a leftover
    object from the previous kind would ship inside the next kind's GLB
    unless the scene is emptied first."""
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)


def _new_object(name, bm):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    return ob


def _box(name, size, center=(0.0, 0.0, 0.0), dent=None):
    """An axis-aligned box, `size` = (x, y, z) full dimensions, centred at
    `center`. `dent=(seed, depth)` pushes one corner vertex inward along its
    own outward diagonal by `depth` (world units), chosen by `_hash01(seed)`
    -- the box's one irregular-damage lever (the wrecked car's hood)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.translate(bm, vec=center, verts=bm.verts)
    if dent is not None:
        seed, depth = dent
        bm.verts.ensure_lookup_table()
        idx = int(_hash01(seed) * len(bm.verts)) % len(bm.verts)
        v = bm.verts[idx]
        inward = (Vector(center) - v.co).normalized()
        v.co += inward * depth
    return _new_object(name, bm)


def _tube(name, points, radius, sides, closed=False):
    """A tube of circular cross-section (`radius`, `sides`) swept along
    `points` (world-space `Vector`s, at least 2). `closed=True` wraps the
    last point back to the first with no end caps -- a torus's major loop, at
    `sides x len(points)` tri count exactly `len(points) * sides * 2`
    (see module docstring's "10 x 6" tyre and this file's own per-kind tri
    accounting). Otherwise the two open ends are triangle-fan capped -- a
    straight or bent rod, at `(len(points) - 1) * sides * 2 + 2 * sides`
    triangles.
    """
    bm = bmesh.new()
    n = len(points)
    up_axis = Vector((0.0, 0.0, 1.0))
    rings = []
    for i in range(n):
        if closed:
            prev_p, next_p = points[(i - 1) % n], points[(i + 1) % n]
        else:
            prev_p, next_p = points[max(i - 1, 0)], points[min(i + 1, n - 1)]
        tangent = next_p - prev_p
        tangent = tangent.normalized() if tangent.length > 1e-9 else Vector((1.0, 0.0, 0.0))
        up = up_axis if abs(tangent.dot(up_axis)) < 0.99 else Vector((0.0, 1.0, 0.0))
        u = tangent.cross(up).normalized()
        v = tangent.cross(u).normalized()
        ring = []
        for s in range(sides):
            ang = 2.0 * math.pi * s / sides
            offset = u * math.cos(ang) * radius + v * math.sin(ang) * radius
            ring.append(bm.verts.new(points[i] + offset))
        rings.append(ring)
    span = n if closed else n - 1
    for i in range(span):
        r0, r1 = rings[i], rings[(i + 1) % n]
        for s in range(sides):
            a, b = r0[s], r0[(s + 1) % sides]
            c, d = r1[(s + 1) % sides], r1[s]
            bm.faces.new((a, b, c, d))
    if not closed:
        for ring, flip in ((rings[0], True), (rings[-1], False)):
            center = sum((v.co for v in ring), Vector()) / len(ring)
            cvert = bm.verts.new(center)
            for s in range(sides):
                a, b = ring[s], ring[(s + 1) % sides]
                bm.faces.new((cvert, b, a) if flip else (cvert, a, b))
    return _new_object(name, bm)


def _cone(name, radius1, radius2, depth, segments, matrix=None):
    """A capped cone/frustum -- the satellite dish's shallow bowl.
    `radius1`/`radius2` at the -Z/+Z ends of `depth`, before `matrix`. Tri
    count: `segments * 2` side + `segments` per cap = `segments * 4`."""
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=True, segments=segments,
        radius1=radius1, radius2=radius2, depth=depth,
        matrix=matrix or Matrix.Identity(4),
    )
    return _new_object(name, bm)


def _group_and_join(parts):
    """`parts`: list of `(role, object)`. Groups by role and joins a
    multi-part group into one object -- `_finalize_and_export` expects
    exactly one object per role. Returns `{role: object}`."""
    groups = {}
    for role, ob in parts:
        groups.setdefault(role, []).append(ob)
    joined = {}
    for role, objs in groups.items():
        if len(objs) > 1:
            bpy.ops.object.select_all(action="DESELECT")
            for o in objs:
                o.select_set(True)
            bpy.context.view_layer.objects.active = objs[0]
            bpy.ops.object.join()
            ob = bpy.context.view_layer.objects.active
        else:
            ob = objs[0]
        joined[role] = ob
    return joined


# ---------------------------------------------------------------------------
# jersey_barrier -- a two-stage tapered concrete prism, +X the long axis.
# Real barriers are cast identically, so no per-index irregularity applies.
# Tris: two boxes, 12 + 12 = 24 (cap 120).
# ---------------------------------------------------------------------------
def build_jersey_barrier(kind_index):
    length = 1.80
    base = _box("base", (length, 0.60, 0.15), center=(0, 0, 0.075))
    top = _box("top", (length, 0.30, 0.65), center=(0, 0, 0.15 + 0.325))
    return _group_and_join([("concrete", base), ("concrete", top)])


# ---------------------------------------------------------------------------
# water_tank -- a cylindrical tank on 4 thin legs plus a small hatch cap.
# Every part is metal. Legs get a small hash-driven length jitter (a stand
# welded up from stock rather than machined identical).
# Tris: tank 40 + hatch 24 + 4 legs x20 = 144 (cap 220).
# ---------------------------------------------------------------------------
def build_water_tank(kind_index):
    leg_r, leg_top, tank_bottom, tank_top, hatch_top = 0.03, 0.65, 0.65, 1.55, 1.65
    parts = []
    leg_positions = [(0.35, 0.35), (-0.35, 0.35), (0.35, -0.35), (-0.35, -0.35)]
    for i, (lx, ly) in enumerate(leg_positions):
        jitter = (_hash01(kind_index, i) - 0.5) * 0.04
        top_z = leg_top + jitter
        leg = _tube(f"leg_{i}", [Vector((lx, ly, 0.0)), Vector((lx, ly, top_z))], leg_r, 5)
        parts.append(("metal", leg))
    tank = _tube("tank", [Vector((0, 0, tank_bottom)), Vector((0, 0, tank_top))], 0.55, 10)
    parts.append(("metal", tank))
    hatch = _tube("hatch", [Vector((0, 0, tank_top)), Vector((0, 0, hatch_top))], 0.10, 6)
    parts.append(("metal", hatch))
    return _group_and_join(parts)


# ---------------------------------------------------------------------------
# satellite_dish -- a mount pole, a small bracket box, a shallow tilted cone.
# All metal. Uniform: nothing about this prop is naturally irregular.
# Tris: pole 24 + bracket 12 + dish 40 = 76 (cap 180).
# ---------------------------------------------------------------------------
def build_satellite_dish(kind_index):
    pole = _tube("pole", [Vector((0, 0, 0)), Vector((0, 0, 0.9))], 0.04, 6)
    bracket = _box("bracket", (0.10, 0.10, 0.10), center=(0, 0, 0.9))
    dish_matrix = Matrix.Translation((0.0, 0.0, 1.05)) @ Matrix.Rotation(math.radians(50.0), 4, "Y")
    dish = _cone("dish", radius1=0.45, radius2=0.03, depth=0.15, segments=10, matrix=dish_matrix)
    return _group_and_join([("metal", pole), ("metal", bracket), ("metal", dish)])


# ---------------------------------------------------------------------------
# laundry_line -- two metal poles, a metal rope, cloth panels hung along it.
# Cloth panel spacing/sag is hash-jittered -- washing does not hang in a
# perfectly even row.
# Tris: 2 poles x20 + rope 16 + 4 cloth x12 = 104 (cap 160).
# ---------------------------------------------------------------------------
def build_laundry_line(kind_index):
    span = 2.2
    pole_h = 1.6
    poles = []
    for i, x in enumerate((-span / 2, span / 2)):
        pole = _tube(f"pole_{i}", [Vector((x, 0, 0)), Vector((x, 0, pole_h))], 0.03, 5)
        poles.append(("metal", pole))
    rope = _tube("rope", [Vector((-span / 2, 0, pole_h)), Vector((span / 2, 0, pole_h))], 0.01, 4)
    cloth_parts = []
    n_cloth = 4
    for i in range(n_cloth):
        t = (i + 0.5) / n_cloth
        x = -span / 2 + t * span + (_hash01(kind_index, i) - 0.5) * 0.12
        sag = 0.15 + _hash01(kind_index, i, 1) * 0.10
        cloth = _box(f"cloth_{i}", (0.35, 0.02, 0.45), center=(x, 0, pole_h - sag - 0.225))
        cloth_parts.append(("cloth", cloth))
    return _group_and_join(poles + [("metal", rope)] + cloth_parts)


# ---------------------------------------------------------------------------
# tyre_pile -- 4 stacked tori (rubber), each nudged off-centre and rotated
# by a hash so the stack reads as thrown together rather than machine-neat.
# Tris: 4 x (8 major x 4 minor x 2) = 4 x 64 = 256 (cap 260).
# ---------------------------------------------------------------------------
def build_tyre_pile(kind_index):
    major_r, minor_r, major_segs, minor_segs = 0.35, 0.12, 8, 4
    rise = 0.19
    parts = []
    for i in range(4):
        jx = (_hash01(kind_index, i) - 0.5) * 0.10
        jy = (_hash01(kind_index, i, 1) - 0.5) * 0.10
        cz = minor_r + i * rise
        ring = [
            Vector((major_r * math.cos(2 * math.pi * s / major_segs) + jx,
                     major_r * math.sin(2 * math.pi * s / major_segs) + jy,
                     cz))
            for s in range(major_segs)
        ]
        tyre = _tube(f"tyre_{i}", ring, minor_r, minor_segs, closed=True)
        parts.append(("rubber", tyre))
    return _group_and_join(parts)


# ---------------------------------------------------------------------------
# rebar -- a small broken concrete pad with 4 rust rebar rods, each bent by a
# hash-derived angle at its midpoint. Never `mathutils.noise` -- see docstring.
# Tris: pad 12 + 4 rods x24 = 108 (cap 140).
# ---------------------------------------------------------------------------
def build_rebar(kind_index):
    pad = _box("pad", (0.5, 0.5, 0.08), center=(0, 0, 0.04))
    parts = [("concrete", pad)]
    rod_xy = [(0.15, 0.15), (-0.15, 0.15), (0.15, -0.15), (-0.15, -0.15)]
    for i, (rx, ry) in enumerate((rod_xy)):
        height = 0.6 + _hash01(kind_index, i) * 0.4
        bend_ang = (_hash01(kind_index, i, 1) - 0.5) * math.radians(50.0)
        bend_r = _hash01(kind_index, i, 2) * 2.0 * math.pi
        mid_h = height * 0.6
        bend_x = rx + math.cos(bend_r) * math.sin(bend_ang) * mid_h * 0.3
        bend_y = ry + math.sin(bend_r) * math.sin(bend_ang) * mid_h * 0.3
        points = [
            Vector((rx, ry, 0.08)),
            Vector((bend_x, bend_y, mid_h)),
            Vector((rx, ry, height)),
        ]
        rod = _tube(f"rod_{i}", points, 0.012, 4)
        parts.append(("rust", rod))
    return _group_and_join(parts)


# ---------------------------------------------------------------------------
# wrecked_car -- a chassis, a crushed-down cabin, a rust hood, a door left
# ajar, and 3 of 4 wheels (one missing). The chassis carries one hash-driven
# dent -- see `_box`'s own `dent` parameter.
# Tris: chassis 12 + cabin 12 + hood 12 + door 12 + 3 wheels x64 = 240 (cap 400).
# ---------------------------------------------------------------------------
def build_wrecked_car(kind_index):
    wheel_r_outer = 0.35 + 0.12  # major + minor radius of a tyre torus, below
    chassis = _box(
        "chassis", (3.6, 1.7, 0.55), center=(-0.2, 0, wheel_r_outer + 0.275),
        dent=(kind_index * 1000 + 1, 0.10),
    )
    cabin = _box("cabin", (2.0, 1.5, 0.45), center=(-0.5, 0, wheel_r_outer + 0.55 + 0.225))
    hood = _box("hood", (1.0, 1.55, 0.20), center=(1.5, 0, wheel_r_outer + 0.10))
    door = _box("door", (0.08, 0.9, 0.55), center=(-0.9, 0.95, wheel_r_outer + 0.275))
    # Ajar: rotate the door 30 degrees about its hinge edge (its own -Y face).
    hinge = Vector((-0.9, 0.5, wheel_r_outer + 0.275))
    for v in door.data.vertices:
        rel = v.co - hinge
        rel.rotate(Matrix.Rotation(math.radians(30.0), 3, "Z"))
        v.co = hinge + rel

    wheel_positions = [(0.9, 0.85), (0.9, -0.85), (-1.3, 0.85)]  # rear-left missing
    parts = [("metal", chassis), ("metal", cabin), ("rust", hood), ("metal", door)]
    for i, (wx, wy) in enumerate(wheel_positions):
        major_r, minor_r, major_segs, minor_segs = 0.35, 0.12, 8, 4
        # The wheel's centreline circle lies in the XZ plane at fixed Y=wy --
        # an axle along Y, the car's width axis, so the disc stands upright
        # and faces sideways (the tyre-pile torus above instead keeps Z fixed
        # so its tyres lie flat, stacked).
        ring = [
            Vector((wx + major_r * math.cos(2 * math.pi * s / major_segs), wy,
                     major_r + major_r * math.sin(2 * math.pi * s / major_segs)))
            for s in range(major_segs)
        ]
        wheel = _tube(f"wheel_{i}", ring, minor_r, minor_segs, closed=True)
        parts.append(("rubber", wheel))
    return _group_and_join(parts)


BUILDERS = {
    "jersey_barrier": build_jersey_barrier,
    "water_tank": build_water_tank,
    "satellite_dish": build_satellite_dish,
    "laundry_line": build_laundry_line,
    "tyre_pile": build_tyre_pile,
    "rebar": build_rebar,
    "wrecked_car": build_wrecked_car,
}


def export():
    summary = {}
    for i, kind in enumerate(PROP_KINDS):
        if ONLY_KINDS is not None and kind not in ONLY_KINDS:
            continue
        _clear_scene()
        role_objs = BUILDERS[kind](i)
        out_path = os.path.join(OUT_DIR, f"{kind}.glb")
        size, verts, polys, roles = _decor._finalize_and_export(role_objs, out_path, kind)
        summary[kind] = {"path": out_path, "bytes": size, "verts": verts,
                          "polys": polys, "roles": roles}
        print(f"[{kind}] wrote {out_path} ({size} bytes, {verts} verts, "
              f"{polys} polys, roles={roles})")
    print("SUMMARY_JSON " + json.dumps(summary))


if __name__ == "__main__":
    export()
