"""Kitted-vehicle BLOCKOUT -- the mock behind GH-238 plan 3's design
(`docs/superpowers/specs/2026-10-06-kitted-vehicles.md`).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/vehicles/kit_blockout.py -- --out <dir> [--only id,id] \
        [--skip-mock] [--skip-masks] [--skip-gate] [--coverage] [--colour-study] \
        [--export]

A design instrument, not an exporter: every kit part here is a box, a
cylinder or a bar frame at its proposed size and place, so the lead can judge
the IDEA before any part is modelled at detail. Nothing it writes ships.

For each of the eight KDF vehicles of garage uplift §8 it opens the SHIPPED
GLB (`art/meshes/vehicles/<id>.glb`, live nodes only), builds the parts in
`PARTS` against the hull's own measured surfaces (BVH ray casts, never typed
from a real vehicle), and writes:

  * mock/   the mock-sheet stills: kit level 0/1/2/3 (every track at tier L),
            two headings, at the game's own pixel scale for camera zoom 1.0
            and 2.5 (Cycles, CPU, the GAME's sun at azimuth 135 / altitude 55
            rather than `build_lights`' rig lamp, whose convention bug puts it
            at 45 -- CLAUDE.md, "The colour pipeline"). Kit parts draw in the
            kit steel, `gunmetal.0`, so they can be told from the bake.
  * masks/  binary silhouettes (Workbench, 8x AA, alpha) of every variant --
            base, each track at tiers 1-3 alone, and the three even levels --
            at 8 headings and both zooms, for `kit_blockout_measure.py`.
  * gate/   256 px renders framed to each variant's OWN bounds at heading 0,
            the way `tools/render_mesh_gate.py` frames a unit, so the
            measurer can run `validate_assets.silhouette`/`iou` -- the
            mesh gate's IoU -- against every shipped vehicle.
  * coverage/ (--coverage) the same variants with the base drawn black and the
            kit white, so the measurer can count the kit a player SEES,
            inside the outline as well as outside it.
  * colour/ (--colour-study, needs the mock pass) level 3 in three tones --
            the hull's median paint texel, its 25th-percentile texel, and
            `gunmetal.0` -- as one pinned texel would draw them.
  * glb/    (--export) one GLB per vehicle: the live nodes plus every kit part
            as its own `kit_*` node carrying `extras.rl_kit`, UV-pinned to the
            host's bake like `export_officer_armour.py` does, for the
            browser draw-call measurement.

The camera is `dimetric.py`'s: orthographic, azimuth 225, elevation 30.
Pixels per metre at camera zoom z are `TILE_W * sqrt(2) / 2 * z / 3`
(`silhouette.ts`'s SILHOUETTE_PX_PER_WORLD_UNIT over UNITS_PER_TILE): 15.085
at zoom 1.0, 37.712 at zoom 2.5, at DPR 1.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
REPO = os.path.dirname(TOOLS)
sys.path.insert(0, TOOLS)
from dimetric import ELEVATION, UNITS_PER_TILE, palette_linear  # noqa: E402

TILE_W = 64
PX_PER_M = {z: TILE_W * math.sqrt(2) / 2 * z / UNITS_PER_TILE for z in (1.0, 2.5)}
HEADINGS_MASK = [0, 45, 90, 135, 180, 225, 270, 315]
HEADINGS_MOCK = [240, 60]
TRACKS = ("armour", "sensors", "firepower")
VEHICLES = ["mbt_lavi", "ifv_namer", "apc_eitan", "apc_kipod",
            "jeep_shoded", "scout_shachaf", "dozer_d9", "heli_peten"]
NO_FIREPOWER = {"dozer_d9"}


# ---------------------------------------------------------------------------
# geometry primitives -- real vertex coordinates, object transform identity
# ---------------------------------------------------------------------------

def _obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def box(name, size, at, rot=(0.0, 0.0, 0.0)):
    """A cuboid of `size` (x, y, z) centred on `at`, rotated by Euler XYZ
    degrees about its own centre."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    m = (Matrix.Translation(Vector(at))
         @ Matrix.Rotation(math.radians(rot[2]), 4, "Z")
         @ Matrix.Rotation(math.radians(rot[1]), 4, "Y")
         @ Matrix.Rotation(math.radians(rot[0]), 4, "X")
         @ Matrix.Diagonal((size[0], size[1], size[2], 1.0)))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return _obj(name, bm)


def cyl(name, r, length, at, axis="Z", segs=12, rot_z=0.0, tilt=0.0):
    """A capped cylinder centred on `at` along `axis`, then turned `rot_z`
    degrees about Z (and tilted `tilt` degrees about its local Y first)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=length)
    pre = {"Z": Matrix.Identity(4),
           "X": Matrix.Rotation(math.radians(90), 4, "Y"),
           "Y": Matrix.Rotation(math.radians(90), 4, "X")}[axis]
    m = (Matrix.Translation(Vector(at))
         @ Matrix.Rotation(math.radians(rot_z), 4, "Z")
         @ Matrix.Rotation(math.radians(tilt), 4, "Y")
         @ pre)
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return _obj(name, bm)


def sphere(name, r, at):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
    bmesh.ops.translate(bm, vec=Vector(at), verts=bm.verts)
    return _obj(name, bm)


def bar(name, a, b, t):
    """A square-section bar of side `t` from point `a` to point `b`."""
    a, b = Vector(a), Vector(b)
    d = b - a
    q = d.to_track_quat("Z", "Y")
    m = Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4() @ Matrix.Diagonal((t, t, d.length, 1.0))
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return _obj(name, bm)


def slat_panel(name, p0, p1, z0, z1, pitch=0.12, t=0.03, post_every=1.0):
    """Bar (slat) armour between ground-plan points p0 and p1, from z0 to z1:
    a frame of posts and rails, horizontal slats at `pitch`. Returns a list."""
    p0, p1 = Vector((p0[0], p0[1], 0)), Vector((p1[0], p1[1], 0))
    out = []
    span = (p1 - p0).length
    n_posts = max(2, int(math.ceil(span / post_every)) + 1)
    for i in range(n_posts):
        p = p0.lerp(p1, i / (n_posts - 1))
        out.append(bar(f"{name}_post{i}", (p.x, p.y, z0), (p.x, p.y, z1), t * 1.6))
    for z in (z0, z1):
        out.append(bar(f"{name}_rail{z:.2f}", (p0.x, p0.y, z), (p1.x, p1.y, z), t * 1.6))
    n = int((z1 - z0) / pitch)
    for k in range(1, n):
        z = z0 + k * pitch
        out.append(bar(f"{name}_slat{k}", (p0.x, p0.y, z), (p1.x, p1.y, z), t))
    return out


def brick_row(name, x0, x1, n, y, zc, size, rot=(0, 0, 0)):
    """`n` ERA bricks / armour modules evenly spaced along x at side `y`."""
    out = []
    step = (x1 - x0) / n
    for i in range(n):
        xc = x0 + step * (i + 0.5)
        out.append(box(f"{name}{i}", (min(size[0], step * 0.94), size[1], size[2]), (xc, y, zc), rot))
    return out


def mast(name, base, h, r, head=None, head_sphere=None, sections=3):
    """A telescoping mast: `sections` stepped tubes from `base` up by `h`,
    with an optional box head (size) or a ball head (radius) on top."""
    x, y, z = base
    out = []
    seg = h / sections
    for i in range(sections):
        rr = r * (1.0 - 0.22 * i)
        out.append(cyl(f"{name}_t{i}", rr, seg, (x, y, z + seg * (i + 0.5)), segs=10))
    top = z + h
    if head:
        out.append(box(f"{name}_head", head, (x, y, top + head[2] / 2)))
    if head_sphere:
        out.append(sphere(f"{name}_ball", head_sphere, (x, y, top + head_sphere)))
    return out


def mg(name, at, length=1.1, heading=0.0, recv=(0.45, 0.13, 0.16), r=0.028):
    """A machine gun: receiver box at `at`, barrel forward along `heading`."""
    x, y, z = at
    h = math.radians(heading)
    out = [box(f"{name}_recv", recv, at, (0, 0, heading))]
    cx = x + math.cos(h) * (recv[0] / 2 + length / 2)
    cy = y + math.sin(h) * (recv[0] / 2 + length / 2)
    out.append(cyl(f"{name}_brl", r, length, (cx, cy, z + 0.02), axis="X", segs=8, rot_z=heading))
    out.append(box(f"{name}_ammo", (0.22, 0.12, 0.16), (x - math.sin(h) * 0.13, y + math.cos(h) * 0.13, z - 0.04),
                   (0, 0, heading)))
    return out


def launcher(name, at, n=2, r=0.11, length=1.25, heading=0.0, gap=0.02, stack="y"):
    """`n` ATGM canisters side by side (stack 'y') or stacked ('z')."""
    x, y, z = at
    out = []
    h = math.radians(heading)
    for i in range(n):
        o = (i - (n - 1) / 2) * (2 * r + gap)
        if stack == "y":
            c = (x - math.sin(h) * o, y + math.cos(h) * o, z)
        else:
            c = (x, y, z + o)
        out.append(cyl(f"{name}_c{i}", r, length, c, axis="X", segs=14, rot_z=heading))
    out.append(box(f"{name}_brk", (0.3, 0.1 + n * r, 0.12), (x, y, z - r - 0.05), (0, 0, heading)))
    return out


def chains(name, p0, p1, z_top, n, drop, r=0.022, ball=0.055):
    """A ball-and-chain curtain: `n` hanging chains with a ball at each end."""
    out = []
    p0, p1 = Vector(p0), Vector(p1)
    for i in range(n):
        p = p0.lerp(p1, i / max(n - 1, 1))
        out.append(cyl(f"{name}_ch{i}", r, drop, (p.x, p.y, z_top - drop / 2), segs=6))
        out.append(sphere(f"{name}_b{i}", ball, (p.x, p.y, z_top - drop)))
    return out


def whip(name, base, length, r=0.012):
    x, y, z = base
    return [cyl(name, r, length, (x, y, z + length / 2), segs=6)]


# ---------------------------------------------------------------------------
# the measured hull: BVH ray casts against the live meshes
# ---------------------------------------------------------------------------

class Hull:
    def __init__(self, live):
        def tree(objs):
            bm = bmesh.new()
            for o in objs:
                me = o.data.copy()
                me.transform(o.matrix_world)
                bm.from_mesh(me)
                bpy.data.meshes.remove(me)
            return BVHTree.FromBMesh(bm)
        self.all = tree(live)
        self.hull = tree([o for o in live if o.name.startswith("hull_")] or live)
        self.objs = {o.name: o for o in live}

    def side(self, x, z, sign=1, default=None):
        hit = self.hull.ray_cast(Vector((x, sign * 20.0, z)), Vector((0, -sign, 0)))
        return abs(hit[0].y) if hit[0] else default

    def top(self, x, y, default=None, tree=None):
        hit = (tree or self.all).ray_cast(Vector((x, y, 20.0)), Vector((0, 0, -1)))
        return hit[0].z if hit[0] else default

    def bounds(self, name):
        o = self.objs[name]
        cs = [o.matrix_world @ v.co for v in o.data.vertices]
        return (Vector([min(c[i] for c in cs) for i in range(3)]),
                Vector([max(c[i] for c in cs) for i in range(3)]))

    def verts(self, name, pred):
        o = self.objs[name]
        return [o.matrix_world @ v.co for v in o.data.vertices if pred(o.matrix_world @ v.co)]


def barrel(H, node, length_from_tip):
    """The weapon's own barrel axis, read off the node: the tip's x, and the
    mean y/z of the vertices within half a metre of it."""
    cs = H.verts(node, lambda c: True)
    xmax = max(c.x for c in cs)
    tip = [c for c in cs if c.x > xmax - 0.5]
    y = sum(c.y for c in tip) / len(tip)
    z = sum(c.z for c in tip) / len(tip)
    return xmax - length_from_tip, xmax, y, z


def shroud(name, b, r, frac=(0.15, 0.85)):
    """A heat shroud over the part of barrel `b` = (x0, x1, y, z) between the
    two fractions of its length, with a clamp band at each end."""
    x0, x1, y, z = b
    a, c = x0 + (x1 - x0) * frac[0], x0 + (x1 - x0) * frac[1]
    return [cyl(f"{name}_sh", r, c - a, ((a + c) / 2, y, z), axis="X", segs=12),
            cyl(f"{name}_b0", r * 1.25, 0.05, (a, y, z), axis="X", segs=12),
            cyl(f"{name}_b1", r * 1.25, 0.05, (c, y, z), axis="X", segs=12)]


def cowl(name, at, w, l, h, t=0.05):
    """An armoured cowl round a weapon station: a front plate and two cheeks."""
    x, y, z = at
    return [box(f"{name}_f", (t, w, h), (x + l / 2, y, z)),
            box(f"{name}_l", (l, t, h), (x, y + w / 2, z)),
            box(f"{name}_r", (l, t, h), (x, y - w / 2, z))]


# ---------------------------------------------------------------------------
# the parts table: (track, tier, host, label, builder) per vehicle.
#
# One rule per track, on every vehicle, and every part shows what its tier
# BUYS (`UPGRADE_PATHS`: hp, armour, suppression resistance, optics, sight,
# a weapon's accuracy and penetration) and nothing the sim does not model --
# so no new weapon, no APS where the sim has none, no smoke, no jerrycans:
#   armour     mass on the faces that take fire: the front first (1), then
#              the flanks (2), then a stand-off cage that changes the outline (3)
#   sensors    things that look out from on top: a sight head (1), a camera or
#              radar array (2), a raised head on a mast or pedestal (3)
#   firepower  at the main weapon, which is what the track patches: its sight
#              (1), its barrel and ammunition (2), its housing or magazine (3)
# `host` is the live node a part merges into at load (+0 draw calls).
# ---------------------------------------------------------------------------

def parts_mbt_lavi(H):
    tlo, thi = H.bounds("turret_hull")
    roof = thi.z
    gun = barrel(H, "turret_metal", 2.3)
    sy = H.side(-0.5, 0.9, 1, 1.44)
    return [
        ("armour", 1, "turret_hull", "turret cheek wedge modules",
         lambda: [box("a1_cheekL", (0.95, 0.42, 0.40), (0.40, 0.70, 1.86), (0, 0, -22)),
                  box("a1_cheekR", (0.95, 0.42, 0.40), (0.40, -0.70, 1.86), (0, 0, 22))]),
        ("armour", 2, "hull_hull", "hull side skirt modules, 5 a side",
         lambda: brick_row("a2_skL", -2.75, 1.25, 5, sy + 0.11, 0.86, (0.80, 0.10, 0.56))
         + brick_row("a2_skR", -2.75, 1.25, 5, -(sy + 0.11), 0.86, (0.80, 0.10, 0.56))),
        ("armour", 3, "hull_hull", "rear slat cage + turret-bustle ball-and-chain curtain",
         lambda: slat_panel("a3_slR", (-3.58, 1.62), (-3.58, -1.62), 0.42, 1.42)
         + slat_panel("a3_slSL", (-3.58, 1.62), (-2.30, 1.62), 0.42, 1.42)
         + slat_panel("a3_slSR", (-3.58, -1.62), (-2.30, -1.62), 0.42, 1.42)
         + chains("a3_ch", (tlo.x + 0.02, 0.85, 0), (tlo.x + 0.02, -0.85, 0), tlo.z + 0.02, 13, 0.30)),
        ("sensors", 1, "turret_metal", "commander's panoramic sight",
         lambda: [cyl("s1_ped", 0.12, 0.20, (-0.55, 0.42, roof + 0.10)),
                  box("s1_head", (0.40, 0.32, 0.28), (-0.52, 0.42, roof + 0.34))]),
        ("sensors", 2, "turret_hull", "four panoramic camera heads on the turret faces",
         lambda: [box(f"s2_cam{i}", (0.46, 0.08, 0.38), (x, s * (H.side(x, 1.9, s, 1.0) + 0.06), 1.90), (0, 0, s * a))
                  for i, (x, s, a) in enumerate([(0.15, 1, -20), (0.15, -1, 20), (-1.45, 1, 20), (-1.45, -1, -20)])]),
        ("sensors", 3, "turret_metal", "raised 360-degree EO/IR drum + four hull-corner cameras",
         lambda: mast("s3_ped", (-1.15, 0.72, roof), 0.55, 0.08, sections=1)
         + [cyl("s3_drum", 0.25, 0.22, (-1.15, 0.72, roof + 0.66), segs=16)]
         + [box(f"s3_cam{i}", (0.16, 0.16, 0.14), (x, y, H.top(x, y, 1.4, H.hull) + 0.07))
            for i, (x, y) in enumerate([(1.85, 1.25), (1.85, -1.25), (-2.95, 1.25), (-2.95, -1.25)])]),
        ("firepower", 1, "turret_metal", "barrel thermal sleeve + muzzle reference sensor",
         lambda: shroud("f1", gun, 0.105, (0.05, 0.92))
         + [box("f1_mrs", (0.14, 0.10, 0.10), (gun[1] - 0.12, gun[2], gun[3] + 0.15))]),
        ("firepower", 2, "turret_metal", "enlarged gunner's primary sight + crosswind sensor",
         lambda: [box("f2_gps", (0.55, 0.40, 0.36), (0.50, -0.52, roof + 0.16)),
                  cyl("f2_xw", 0.025, 0.55, (-1.55, -0.78, roof + 0.27)),
                  box("f2_xwh", (0.06, 0.30, 0.05), (-1.55, -0.78, roof + 0.56))]),
        ("firepower", 3, "turret_hull", "armoured ready-round container on the turret bustle",
         lambda: [box("f3_bustle", (0.80, 1.40, 0.42), (-1.85, 0.0, roof + 0.21)),
                  box("f3_lid", (0.84, 1.44, 0.05), (-1.85, 0.0, roof + 0.44))]),
    ]


def parts_ifv_namer(H):
    sy2 = H.side(0, 2.1, 1, 1.70)
    roof = 3.06
    gun = barrel(H, "turret_metal", 1.55)
    return [
        ("armour", 1, "hull_hull", "glacis applique wedges",
         lambda: [box("a1_glL", (1.30, 1.40, 0.14), (2.75, 0.78, 2.66), (0, 31, 0)),
                  box("a1_glR", (1.30, 1.40, 0.14), (2.75, -0.78, 2.66), (0, 31, 0))]),
        ("armour", 2, "hull_hull", "ERA brick row along each upper side, 7 a side",
         lambda: brick_row("a2_eraL", -3.0, 2.4, 7, sy2 + 0.12, 2.15, (0.74, 0.18, 0.46), (-12, 0, 0))
         + brick_row("a2_eraR", -3.0, 2.4, 7, -(sy2 + 0.12), 2.15, (0.74, 0.18, 0.46), (12, 0, 0))),
        ("armour", 3, "hull_hull", "rear slat cage around the ramp and rear quarters",
         lambda: slat_panel("a3_slR", (-4.10, 2.05), (-4.10, -2.05), 0.95, 2.65)
         + slat_panel("a3_slSL", (-4.10, 2.05), (-2.30, 2.05), 0.95, 2.65)
         + slat_panel("a3_slSR", (-4.10, -2.05), (-2.30, -2.05), 0.95, 2.65)),
        ("sensors", 1, "hull_hull", "commander's sight head beside the RWS",
         lambda: [cyl("s1_ped", 0.12, 0.22, (0.05, 0.95, 3.24 + 0.11)),
                  box("s1_head", (0.40, 0.32, 0.30), (0.08, 0.95, 3.24 + 0.37))]),
        ("sensors", 2, "hull_hull", "four panoramic camera heads at the roof corners",
         lambda: [box(f"s2_cam{i}", (0.50, 0.10, 0.40), (x, y, roof + 0.22), (0, 0, a))
                  for i, (x, y, a) in enumerate([(2.0, 1.45, 45), (2.0, -1.45, -45), (-2.7, 1.45, -45), (-2.7, -1.45, 45)])]),
        ("sensors", 3, "hull_hull", "folding EO mast with sensor ball at the rear roof",
         lambda: mast("s3_mast", (-2.9, -0.95, roof), 1.15, 0.07, head_sphere=0.21)),
        ("firepower", 1, "turret_metal", "gunner's thermal sight block on the RWS",
         lambda: [box("f1_th", (0.40, 0.28, 0.28), (0.72, -0.30, 3.88))]),
        ("firepower", 2, "turret_metal", "30 mm barrel thermal shroud + muzzle-velocity radar",
         lambda: shroud("f2", gun, 0.085) + [box("f2_mvr", (0.20, 0.16, 0.14), (1.15, 0.0, gun[3] + 0.17))]),
        ("firepower", 3, "turret_metal", "armoured dual-feed ammunition magazine on the RWS",
         lambda: [box("f3_mag", (0.95, 0.42, 0.50), (0.72, 0.64, 3.50)),
                  box("f3_chute", (0.30, 0.20, 0.12), (0.92, 0.36, 3.62))]),
    ]


def parts_apc_eitan(H):
    roof = 2.62
    tlo, thi = H.bounds("turret_metal")
    gun = barrel(H, "turret_metal", 1.05)
    return [
        ("armour", 1, "hull_hull", "nose applique plates",
         lambda: [box("a1_noseL", (0.95, 1.05, 0.09), (2.55, 0.62, 2.00), (0, 13, 0)),
                  box("a1_noseR", (0.95, 1.05, 0.09), (2.55, -0.62, 2.00), (0, 13, 0)),
                  box("a1_bow", (0.10, 2.30, 0.50), (3.62, 0, 1.25))]),
        ("armour", 2, "hull_hull", "upper-side armour modules between the arches, 4 a side",
         lambda: [box(f"a2_m{i}{s}", (1.05, 0.12, 0.50), (x, sg * 1.56, 1.72), (sg * -8, 0, 0))
                  for i, x in enumerate((-2.05, -0.95, 0.75, 2.45)) for s, sg in (("L", 1), ("R", -1))]),
        ("armour", 3, "hull_hull", "slat cage over the sides and rear",
         lambda: slat_panel("a3_sL", (-3.25, 2.00), (3.05, 2.00), 0.95, 2.05, post_every=1.05)
         + slat_panel("a3_sR", (-3.25, -2.00), (3.05, -2.00), 0.95, 2.05, post_every=1.05)
         + slat_panel("a3_rr", (-3.95, 2.00), (-3.95, -2.00), 0.65, 2.25)),
        ("sensors", 1, "hull_hull", "commander's sight head, roof front-left",
         lambda: [cyl("s1_ped", 0.11, 0.20, (1.25, 0.62, roof + 0.10)),
                  box("s1_head", (0.38, 0.30, 0.28), (1.28, 0.62, roof + 0.34))]),
        ("sensors", 2, "hull_hull", "four panoramic camera heads at the roof corners",
         lambda: [box(f"s2_cam{i}", (0.46, 0.10, 0.38), (x, y, H.top(x, y, roof, H.hull) + 0.20), (0, 0, a))
                  for i, (x, y, a) in enumerate([(1.95, 1.05, 45), (1.95, -1.05, -45), (-2.95, 1.0, -45), (-2.95, -1.0, 45)])]),
        ("sensors", 3, "hull_hull", "telescopic sensor mast, rear right",
         lambda: mast("s3_mast", (-3.05, -0.80, roof), 2.0, 0.075, head=(0.50, 0.38, 0.30))),
        # The sight hangs on the station's OUTBOARD side, below its top: on top
        # it raised the bounds by 0.24 m, the gate's own-bounds framing moved,
        # and IoU against gun_truck read 0.8804 against the 0.88 limit (0.8353
        # at base). Measured, not guessed -- see the spec's section 4.
        ("firepower", 1, "turret_metal", "thermal sight block on the RWS",
         lambda: [box("f1_th", (0.32, 0.24, 0.24), (-0.60, 0.88, thi.z - 0.14))]),
        ("firepower", 2, "turret_metal", ".50 barrel heat shroud + big ammunition box with feed chute",
         lambda: shroud("f2", gun, 0.05) + [box("f2_box", (0.52, 0.24, 0.36), (-0.85, 0.90, 3.06)),
                                            box("f2_chute", (0.24, 0.14, 0.10), (-0.62, 0.75, 3.16))]),
        ("firepower", 3, "turret_metal", "armoured cowl round the weapon station",
         lambda: cowl("f3_cowl", (-0.55, 0.40, 3.08), 0.95, 1.05, 0.46)),
    ]


def parts_apc_kipod(H):
    roof = 2.96
    tlo, thi = H.bounds("turret_metal")
    gun = barrel(H, "turret_metal", 1.05)
    return [
        ("armour", 1, "hull_hull", "ERA bank on the nose slope, 2 rows of 4",
         lambda: [box(f"a1_era{r}{c}", (0.55, 0.62, 0.13), (2.35 + 0.55 * r, -0.99 + 0.66 * c, 2.42 - 0.30 * r), (0, 25, 0))
                  for r in range(2) for c in range(4)]),
        ("armour", 2, "hull_hull", "second ERA row along each side, 6 a side",
         lambda: brick_row("a2_eraL", -2.7, 2.4, 6, 1.64, 1.82, (0.78, 0.16, 0.42))
         + brick_row("a2_eraR", -2.7, 2.4, 6, -1.64, 1.82, (0.78, 0.16, 0.42))),
        ("armour", 3, "hull_hull", "rear slat cage and rear quarters",
         lambda: slat_panel("a3_slR", (-4.00, 2.05), (-4.00, -2.05), 0.70, 2.55)
         + slat_panel("a3_slSL", (-4.00, 2.05), (-2.40, 2.05), 0.70, 2.55)
         + slat_panel("a3_slSR", (-4.00, -2.05), (-2.40, -2.05), 0.70, 2.55)),
        ("sensors", 1, "hull_hull", "commander's sight head, roof front",
         lambda: [cyl("s1_ped", 0.11, 0.20, (1.55, 0.70, roof + 0.10)),
                  box("s1_head", (0.38, 0.30, 0.28), (1.58, 0.70, roof + 0.34))]),
        ("sensors", 2, "hull_hull", "ground-surveillance radar on a roof pedestal",
         lambda: [cyl("s2_ped", 0.09, 0.40, (1.85, -0.70, roof + 0.20)),
                  box("s2_ant", (0.10, 0.92, 0.44), (1.85, -0.70, roof + 0.62), (0, -12, 0))]),
        ("sensors", 3, "hull_hull", "telescopic mast with an EO drum, rear",
         lambda: mast("s3_mast", (-2.95, 0.55, roof), 1.7, 0.07, sections=3)
         + [cyl("s3_drum", 0.22, 0.26, (-2.95, 0.55, roof + 1.83), segs=16)]),
        ("firepower", 1, "turret_metal", "thermal sight block on the RWS",
         lambda: [box("f1_th", (0.32, 0.24, 0.24), (-1.25, -0.24, thi.z + 0.12))]),
        ("firepower", 2, "turret_metal", "barrel heat shroud + big ammunition box with feed chute",
         lambda: shroud("f2", gun, 0.045) + [box("f2_box", (0.50, 0.24, 0.34), (-1.45, 0.48, 3.62)),
                                             box("f2_chute", (0.22, 0.14, 0.10), (-1.20, 0.30, 3.72))]),
        ("firepower", 3, "turret_metal", "armoured cowl round the weapon station",
         lambda: cowl("f3_cowl", (-1.10, 0.0, 3.66), 0.95, 1.05, 0.44)),
    ]


def parts_jeep_shoded(H):
    cab = 1.73
    gun = barrel(H, "hull_metal", 1.0)
    return [
        ("armour", 1, "hull_hull", "door armour kits, 2 a side",
         lambda: [box(f"a1_d{i}{s}", (0.78, 0.06, 0.58), (x, sg * 1.04, 1.22))
                  for i, x in enumerate((-0.55, 0.30)) for s, sg in (("L", 1), ("R", -1))]),
        ("armour", 2, "hull_metal", "gunner's shield around the roof MG",
         lambda: [box("a2_shF", (0.05, 0.95, 0.55), (0.80, 0.0, 2.06)),
                  box("a2_shL", (0.05, 0.48, 0.50), (0.62, 0.63, 2.04), (0, 0, 40)),
                  box("a2_shR", (0.05, 0.48, 0.50), (0.62, -0.63, 2.04), (0, 0, -40))]),
        ("armour", 3, "hull_hull", "bull-bar grille, bed armour, windscreen louvres",
         lambda: slat_panel("a3_bb", (2.48, 0.95), (2.48, -0.95), 0.45, 1.02, pitch=0.11)
         + [box("a3_bedL", (0.92, 0.05, 0.46), (-1.55, 1.02, 1.02)),
            box("a3_bedR", (0.92, 0.05, 0.46), (-1.55, -1.02, 1.02)),
            box("a3_ws", (0.08, 1.70, 0.40), (0.78, 0, 1.52), (0, -30, 0))]),
        ("sensors", 1, "hull_hull", "roof EO ball on a post",
         lambda: [cyl("s1_post", 0.04, 0.24, (-0.62, -0.62, cab + 0.12)),
                  sphere("s1_ball", 0.14, (-0.62, -0.62, cab + 0.37))]),
        ("sensors", 2, "hull_hull", "surveillance pod on a roof rack",
         lambda: [box("s2_rack", (0.90, 0.90, 0.05), (-0.45, -0.25, cab + 0.08)),
                  box("s2_pod", (0.55, 0.36, 0.32), (-0.45, -0.45, cab + 0.27))]),
        ("sensors", 3, "hull_hull", "telescopic mast with radar head in the bed",
         lambda: mast("s3_mast", (-1.55, -0.55, 0.80), 2.3, 0.06, head=(0.42, 0.30, 0.26))),
        ("firepower", 1, "hull_metal", "optical/thermal sight on the MG + two ready ammunition cans",
         lambda: [box("f1_sight", (0.26, 0.14, 0.16), (0.10, 0.13, gun[3] + 0.13)),
                  box("f1_c0", (0.30, 0.13, 0.20), (-0.15, 0.62, 1.88)),
                  box("f1_c1", (0.30, 0.13, 0.20), (0.20, 0.62, 1.88))]),
        ("firepower", 2, "hull_metal", "barrel shroud + 400-round box with feed chute",
         lambda: shroud("f2", gun, 0.04) + [box("f2_box", (0.40, 0.22, 0.30), (-0.05, -0.30, 2.10))]),
        ("firepower", 3, "hull_metal", "heavy-barrel conversion: long heavy barrel and receiver shroud",
         lambda: [cyl("f3_hb", 0.05, 1.35, (gun[1] + 0.45, gun[2], gun[3]), axis="X", segs=12),
                  box("f3_rcv", (0.65, 0.26, 0.26), (gun[0] + 0.15, gun[2], gun[3] - 0.02))]),
    ]


def parts_scout_shachaf(H):
    hv = H.verts("hull_hull", lambda c: c.z > 2.75)
    mx = sum(c.x for c in hv) / len(hv)
    my = sum(c.y for c in hv) / len(hv)
    mtop = max(c.z for c in hv)
    gun = barrel(H, "turret_metal", 0.75)
    return [
        ("armour", 1, "hull_hull", "nose plate + door plates",
         lambda: [box("a1_nose", (1.00, 1.10, 0.08), (1.25, 0, 1.78), (0, 20, 0)),
                  box("a1_dL", (0.82, 0.06, 0.58), (0.20, 0.74, 1.60)),
                  box("a1_dR", (0.82, 0.06, 0.58), (0.20, -0.74, 1.60))]),
        ("armour", 2, "hull_hull", "side armour panels between the wheels + arch guards",
         lambda: [box("a2_sL", (1.90, 0.08, 0.66), (-0.05, 0.80, 1.12)),
                  box("a2_sR", (1.90, 0.08, 0.66), (-0.05, -0.80, 1.12))]
         + [box(f"a2_ag{i}", (0.80, 0.30, 0.06), (x, sg * 1.10, 1.24), (sg * -10, 0, 0))
            for i, (x, sg) in enumerate([(1.62, 1), (1.62, -1), (-1.70, 1), (-1.70, -1)])]),
        ("armour", 3, "hull_hull", "grille cage along the body sides + front grille",
         lambda: slat_panel("a3_gL", (-1.85, 0.98), (1.05, 0.98), 1.35, 2.15, pitch=0.13)
         + slat_panel("a3_gR", (-1.85, -0.98), (1.05, -0.98), 1.35, 2.15, pitch=0.13)
         + slat_panel("a3_gF", (2.40, 0.65), (2.40, -0.65), 0.55, 1.15, pitch=0.13)),
        ("sensors", 1, "hull_hull", "laser-rangefinder/thermal box beside the mast head",
         lambda: [box("s1_lrf", (0.32, 0.22, 0.20), (mx + 0.05, my - 0.24, mtop - 0.12))]),
        ("sensors", 2, "hull_hull", "ground-surveillance radar under the mast head",
         lambda: [box("s2_rad", (0.10, 0.78, 0.34), (mx + 0.12, my, mtop - 0.50))]),
        ("sensors", 3, "hull_hull", "second mast stage with a stacked sensor head",
         lambda: mast("s3_ext", (mx, my, mtop), 1.0, 0.05, head=(0.46, 0.32, 0.30), sections=2)),
        ("firepower", 1, "turret_metal", "thermal sight block on the RWS",
         lambda: [box("f1_th", (0.28, 0.20, 0.20), (-0.95, -0.20, 2.62))]),
        ("firepower", 2, "turret_metal", "barrel heat shroud + ammunition box with feed chute",
         lambda: shroud("f2", gun, 0.04) + [box("f2_box", (0.44, 0.22, 0.30), (-1.05, 0.36, 2.40))]),
        ("firepower", 3, "turret_metal", "armoured cowl round the weapon station",
         lambda: cowl("f3_cowl", (-0.85, 0.0, 2.36), 0.80, 0.85, 0.40)),
    ]


def parts_dozer_d9(H):
    croof = 3.09
    return [
        ("armour", 1, "hull_hull", "cab window grilles",
         lambda: slat_panel("a1_gL", (-1.62, 1.30), (-0.38, 1.30), 2.05, 2.85, pitch=0.10, t=0.025)
         + slat_panel("a1_gR", (-1.62, -1.30), (-0.38, -1.30), 2.05, 2.85, pitch=0.10, t=0.025)),
        ("armour", 2, "hull_hull", "slat cage around the cab",
         lambda: slat_panel("a2_cL", (-1.95, 1.62), (-0.20, 1.62), 1.90, 3.00)
         + slat_panel("a2_cR", (-1.95, -1.62), (-0.20, -1.62), 1.90, 3.00)
         + slat_panel("a2_cB", (-1.95, 1.62), (-1.95, -1.62), 1.90, 3.00)),
        ("armour", 3, "hull_hull", "track-top skirt plates + rear slat around the ripper",
         lambda: brick_row("a3_skL", -2.6, 2.0, 5, 2.24, 1.55, (0.90, 0.08, 0.60))
         + brick_row("a3_skR", -2.6, 2.0, 5, -2.24, 1.55, (0.90, 0.08, 0.60))
         + slat_panel("a3_rr", (-3.25, 1.40), (-3.25, -1.40), 1.10, 2.20)),
        ("sensors", 1, "hull_hull", "roof work-light bar with IR cameras",
         lambda: [box("s1_bar", (0.22, 1.80, 0.12), (-0.55, 0, croof + 0.08))]
         + [box(f"s1_l{i}", (0.14, 0.22, 0.16), (-0.45, -0.75 + 0.5 * i, croof + 0.20)) for i in range(4)]),
        ("sensors", 2, "hull_hull", "remote-operation camera mast",
         lambda: mast("s2_mast", (-1.45, 0.75, croof), 0.80, 0.06, head_sphere=0.16, sections=2)),
        ("sensors", 3, "hull_hull", "forward obstacle radar + a second, taller camera mast",
         lambda: [box("s3_rad", (0.10, 0.85, 0.36), (-0.30, 0.0, croof + 0.24), (0, -10, 0))]
         + mast("s3_mast", (-1.45, -0.75, croof), 1.30, 0.06, sections=3)
         + [cyl("s3_drum", 0.18, 0.22, (-1.45, -0.75, croof + 1.41), segs=14)]),
    ]


def parts_heli_peten(H):
    gun = barrel(H, "hull_metal", 0.55)
    return [
        ("armour", 1, "hull_hull", "cockpit side armour panels",
         lambda: [box("a1_pL", (0.55, 0.03, 0.22), (0.42, 0.25, 0.74)),
                  box("a1_pR", (0.55, 0.03, 0.22), (0.42, -0.25, 0.74))]),
        ("armour", 2, "hull_hull", "engine-bay armour panels",
         lambda: [box("a2_irL", (0.55, 0.18, 0.16), (-0.30, 0.35, 0.95), (0, -10, 0)),
                  box("a2_irR", (0.55, 0.18, 0.16), (-0.30, -0.35, 0.95), (0, -10, 0))]),
        ("armour", 3, "hull_hull", "armoured sponson fairings + floor plate",
         lambda: [box("a3_spL", (0.90, 0.12, 0.20), (0.95, 0.31, 0.42)),
                  box("a3_spR", (0.90, 0.12, 0.20), (0.95, -0.31, 0.42)),
                  box("a3_fl", (1.30, 0.42, 0.05), (0.60, 0, 0.12))]),
        ("sensors", 1, "hull_glass", "enlarged nose sensor turret",
         lambda: [cyl("s1_tads", 0.14, 0.30, (1.98, 0, 0.42), axis="Y", segs=14)]),
        ("sensors", 2, "hull_hull", "four warning sensors + two sensor pods",
         lambda: [box(f"s2_maw{i}", (0.10, 0.10, 0.10), (x, y, 0.80)) for i, (x, y) in
                  enumerate([(1.30, 0.20), (1.30, -0.20), (-1.40, 0.14), (-1.40, -0.14)])]
         + [box("s2_ewL", (0.36, 0.08, 0.08), (0.30, 0.46, 0.50)),
            box("s2_ewR", (0.36, 0.08, 0.08), (0.30, -0.46, 0.50))]),
        ("sensors", 3, "hull_hull", "turret sensor ball on the boom + roof sensor fairing",
         lambda: [sphere("s3_ball", 0.12, (-1.05, 0, 0.88)),
                  box("s3_fair", (0.36, 0.20, 0.10), (-0.40, 0, 1.13))]),
        ("firepower", 1, "hull_metal", "chin gun: longer barrel with a shroud",
         lambda: [cyl("f1_brl", 0.03, 0.55, (gun[1] + 0.22, gun[2], gun[3]), axis="X", segs=8)]
         + shroud("f1", gun, 0.045)),
        ("firepower", 2, "hull_metal", "ammunition magazine pod + feed chute under the fuselage",
         lambda: [box("f2_mag", (0.70, 0.24, 0.17), (0.45, 0, 0.16)),
                  box("f2_chute", (0.50, 0.08, 0.06), (1.10, 0, 0.20))]),
        ("firepower", 3, "hull_metal", "enlarged chin-turret housing",
         lambda: [cyl("f3_turret", 0.17, 0.26, (gun[0] - 0.05, gun[2], gun[3] + 0.02), axis="Z", segs=16)]),
    ]


PARTS = {
    "mbt_lavi": parts_mbt_lavi, "ifv_namer": parts_ifv_namer, "apc_eitan": parts_apc_eitan,
    "apc_kipod": parts_apc_kipod, "jeep_shoded": parts_jeep_shoded,
    "scout_shachaf": parts_scout_shachaf, "dozer_d9": parts_dozer_d9, "heli_peten": parts_heli_peten,
}


# ---------------------------------------------------------------------------
# scene
# ---------------------------------------------------------------------------

def load_vehicle(vid):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(REPO, "art", "meshes", "vehicles", f"{vid}.glb"),
                              import_scene_extras=True)
    for o in list(bpy.data.objects):
        if o.name == "death_root" or o.name.startswith("WRECK_"):
            bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    live = [o for o in bpy.data.objects if o.type == "MESH"]
    return live


def build_kit(vid, H):
    """Every part of every tier, each tagged; returns [(track, tier, host, label, [objs])]."""
    out = []
    if vid not in PARTS:  # a neighbour rendered for the gate's IoU only
        return out
    for track, tier, host, label, fn in PARTS[vid](H):
        objs = fn()
        for o in objs:
            o["rl_kit_track"] = track
            o["rl_kit_tier"] = tier
            o["rl_kit_host"] = host
        out.append((track, tier, host, label, objs))
    return out


def tris_of(objs):
    return sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)


def set_variant(kit, tiers):
    """Show the kit parts a tier map owns: cumulative within a track."""
    for track, tier, _host, _label, objs in kit:
        on = tier <= tiers.get(track, 0)
        for o in objs:
            o.hide_render = not on
            o.hide_viewport = not on


def variants_for(vid):
    tracks = [t for t in TRACKS if not (t == "firepower" and vid in NO_FIREPOWER)]
    v = [("L0", {})]
    if vid not in PARTS:
        return v
    for t in tracks:
        for k in (1, 2, 3):
            v.append((f"{t[0].upper()}{k}", {t: k}))
    for L in (1, 2, 3):
        v.append((f"L{L}", {t: L for t in tracks}))
    return v


def parent_all(pivot, objs):
    for o in objs:
        if o.parent is None:
            mw = o.matrix_world.copy()
            o.parent = pivot
            o.matrix_world = mw


def world_bounds(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return lo, hi


def place_camera(cam, center, ortho):
    az = math.radians(225.0)
    dist = 60.0
    horiz = math.cos(ELEVATION) * dist
    cam.location = (center.x + horiz * math.cos(az), center.y + horiz * math.sin(az),
                    center.z + math.sin(ELEVATION) * dist)
    cam.rotation_euler = (math.pi / 2 - ELEVATION, 0.0, az + math.pi / 2)
    cam.data.ortho_scale = ortho
    cam.data.clip_end = 500.0


def game_sun(scene):
    ld = bpy.data.lights.new("SUN", "SUN")
    ld.energy = 4.0
    ld.angle = math.radians(1.5)
    sun = bpy.data.objects.new("SUN", ld)
    scene.collection.objects.link(sun)
    alt, az = math.radians(55.0), math.radians(135.0)
    d = Vector((math.cos(alt) * math.cos(az), math.cos(alt) * math.sin(az), math.sin(alt)))
    sun.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    w = bpy.data.worlds.new("sky")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.62, 0.68, 0.74, 1.0)
    bg.inputs[1].default_value = 0.55
    scene.world = w


def kit_material(name, key):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = palette_linear(key)
    bsdf.inputs["Roughness"].default_value = 0.55
    bsdf.inputs["Metallic"].default_value = 0.0
    return m


def flat_material(name, rgb_linear):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb_linear, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.55
    return m


PALETTE_FALLBACK = {"turret_metal": "gunmetal.2", "turret_plate": "olive.1"}


def paint_palette_nodes(live):
    """The palette RWS nodes carry no material in the GLB (the runtime ramps
    them); give the mock the ramp's own lit step so they do not draw white."""
    for o in live:
        if not o.data.materials or o.data.materials[0] is None:
            key = PALETTE_FALLBACK.get(o.name, "gunmetal.2")
            o.data.materials.clear()
            o.data.materials.append(kit_material(f"pal_{o.name}", key))


KNOWN_FLAGS = {"--skip-mock", "--skip-masks", "--skip-gate", "--coverage", "--colour-study", "--export"}
USAGE = ("usage: blender -b --factory-startup --python tools/vehicles/kit_blockout.py -- --out <dir> "
         "[--only id,id] [--skip-mock] [--skip-masks] [--skip-gate] [--coverage] [--colour-study] [--export]")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = {"out": None, "only": None}
    flags = set()
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("--out", "--only"):
            args[a[2:]] = argv[i + 1]
            i += 2
        elif a in KNOWN_FLAGS:
            flags.add(a)
            i += 1
        else:
            # An unknown flag is an error, never ignored: `--coverge` would
            # otherwise run without the pass it asked for and say nothing.
            print(f"unknown argument: {a}\n{USAGE}", file=sys.stderr)
            raise SystemExit(2)
    if not args["out"]:
        print(USAGE, file=sys.stderr)
        raise SystemExit(2)
    out = os.path.abspath(args["out"])
    ids = args["only"].split(",") if args["only"] else VEHICLES
    report = []

    for vid in ids:
        live = load_vehicle(vid)
        H = Hull(live)
        kit = build_kit(vid, H)
        scene = bpy.context.scene
        base_tris = tris_of(live)
        for track, tier, host, label, objs in kit:
            report.append(f"PART {vid} {track} {tier} {host} tris={tris_of(objs)} | {label}")
        report.append(f"BASE {vid} tris={base_tris}")

        # bounds for a fixed frame: everything on, swept through every heading
        set_variant(kit, {t: 3 for t in TRACKS})
        allobjs = [o for o in scene.objects if o.type == "MESH"]
        lo, hi = world_bounds(allobjs)
        rad = max(Vector((x, y, 0)).length for x in (lo.x, hi.x) for y in (lo.y, hi.y))
        zc = (lo.z + hi.z) / 2
        center = Vector((0.0, 0.0, zc))
        # frame width in metres: the swept footprint plus the height's projection
        frame_m = 2 * rad * 1.06 + (hi.z - lo.z) * math.cos(ELEVATION) * 0.6
        report.append(f"FRAME {vid} frame_m={frame_m:.3f} lo={tuple(round(v, 3) for v in lo)} "
                      f"hi={tuple(round(v, 3) for v in hi)}")

        pivot = bpy.data.objects.new("PIVOT", None)
        scene.collection.objects.link(pivot)
        # EVERY root, empties included: `turret_pivot` is an empty, and a
        # turret left out of the turn points its gun the wrong way.
        parent_all(pivot, [o for o in scene.objects if o is not pivot])

        cd = bpy.data.cameras.new("CAM")
        cd.type = "ORTHO"
        cam = bpy.data.objects.new("CAM", cd)
        scene.collection.objects.link(cam)
        scene.camera = cam
        scene.render.film_transparent = True
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"

        variants = variants_for(vid)

        # ---- masks (Workbench, flat) ----
        if "--skip-masks" not in flags:
            scene.render.engine = "BLENDER_WORKBENCH"
            scene.display.shading.light = "FLAT"
            scene.display.shading.color_type = "SINGLE"
            scene.display.render_aa = "8"
            scene.view_settings.view_transform = "Standard"
            for zoom, ppm in PX_PER_M.items():
                res = int(round(frame_m * ppm))
                scene.render.resolution_x = scene.render.resolution_y = res
                place_camera(cam, center, frame_m)
                for vname, tiers in variants:
                    set_variant(kit, tiers)
                    for hd in HEADINGS_MASK:
                        pivot.rotation_euler = (0, 0, math.radians(hd))
                        bpy.context.view_layer.update()
                        scene.render.filepath = os.path.join(out, "masks", vid, f"z{zoom}", f"{vname}_h{hd:03d}.png")
                        bpy.ops.render.render(write_still=True)
            pivot.rotation_euler = (0, 0, 0)

        # ---- kit coverage: base black, kit white, so the measurer can count
        # the kit surface a player SEES, including parts that sit inside the
        # outline (a plate on a glacis changes no silhouette pixel at all) ----
        if "--coverage" in flags:
            scene.render.engine = "BLENDER_WORKBENCH"
            scene.display.shading.light = "FLAT"
            scene.display.shading.color_type = "OBJECT"
            scene.display.render_aa = "8"
            scene.view_settings.view_transform = "Standard"
            kit_ids = {id(o) for _t, _k, _h, _l, objs in kit for o in objs}
            for o in scene.objects:
                if o.type == "MESH":
                    o.color = (1.0, 1.0, 1.0, 1.0) if id(o) in kit_ids else (0.0, 0.0, 0.0, 1.0)
            for zoom, ppm in PX_PER_M.items():
                res = int(round(frame_m * ppm))
                scene.render.resolution_x = scene.render.resolution_y = res
                place_camera(cam, center, frame_m)
                for vname, tiers in variants:
                    if vname == "L0":
                        continue
                    set_variant(kit, tiers)
                    for hd in HEADINGS_MASK:
                        pivot.rotation_euler = (0, 0, math.radians(hd))
                        bpy.context.view_layer.update()
                        scene.render.filepath = os.path.join(out, "coverage", vid, f"z{zoom}", f"{vname}_h{hd:03d}.png")
                        bpy.ops.render.render(write_still=True)
            pivot.rotation_euler = (0, 0, 0)
            scene.display.shading.color_type = "SINGLE"

        # ---- gate-style: own-bounds framing, heading 0, 256 px ----
        if "--skip-gate" not in flags:
            scene.render.engine = "BLENDER_WORKBENCH"
            scene.display.shading.light = "FLAT"
            scene.display.render_aa = "8"
            scene.render.resolution_x = scene.render.resolution_y = 256
            pivot.rotation_euler = (0, 0, 0)
            for vname, tiers in variants:
                set_variant(kit, tiers)
                bpy.context.view_layer.update()
                vis = [o for o in scene.objects if o.type == "MESH" and not o.hide_render]
                vlo, vhi = world_bounds(vis)
                c = (vlo + vhi) * 0.5
                r = max((vhi - vlo).length * 0.5, 1e-4)
                place_camera(cam, c, r * 2.0 * 1.12)
                scene.render.filepath = os.path.join(out, "gate", vid, f"{vname}.png")
                bpy.ops.render.render(write_still=True)

        # ---- mock stills (Cycles, the game's sun, kit in steel) ----
        if "--skip-mock" not in flags:
            scene.render.engine = "CYCLES"
            scene.cycles.device = "CPU"
            scene.cycles.samples = 24
            scene.cycles.use_denoising = True
            scene.view_settings.view_transform = "AgX"
            game_sun(scene)
            paint_palette_nodes(live)
            steel = kit_material("kit_steel", "gunmetal.0")
            for _t, _k, _h, _l, objs in kit:
                for o in objs:
                    o.data.materials.clear()
                    o.data.materials.append(steel)
            for zoom, ppm in PX_PER_M.items():
                res = int(round(frame_m * ppm))
                scene.render.resolution_x = scene.render.resolution_y = res
                place_camera(cam, center, frame_m)
                for L in (0, 1, 2, 3):
                    set_variant(kit, {t: L for t in TRACKS})
                    for hd in HEADINGS_MOCK:
                        pivot.rotation_euler = (0, 0, math.radians(hd))
                        bpy.context.view_layer.update()
                        scene.render.filepath = os.path.join(out, "mock", vid, f"z{zoom}_L{L}_h{hd:03d}.png")
                        bpy.ops.render.render(write_still=True)
            # a close-up legend at 2x the zoom-2.5 scale, kit by TRACK colour
            # legend hues are a MOCK device, not palette roles: nothing here ships
            track_mat = {"armour": kit_material("leg_a", "gunmetal.0"),
                         "sensors": flat_material("leg_s", (0.05, 0.40, 0.50)),
                         "firepower": flat_material("leg_f", (0.62, 0.12, 0.05))}
            for track, _k, _h, _l, objs in kit:
                for o in objs:
                    o.data.materials.clear()
                    o.data.materials.append(track_mat[track])
            set_variant(kit, {t: 3 for t in TRACKS})
            res = int(round(frame_m * PX_PER_M[2.5] * 2.0))
            scene.render.resolution_x = scene.render.resolution_y = res
            place_camera(cam, center, frame_m)
            for hd in HEADINGS_MOCK:
                pivot.rotation_euler = (0, 0, math.radians(hd))
                bpy.context.view_layer.update()
                scene.render.filepath = os.path.join(out, "mock", vid, f"legend_h{hd:03d}.png")
                bpy.ops.render.render(write_still=True)
            pivot.rotation_euler = (0, 0, 0)

        if "--colour-study" in flags:
            colour_study(vid, live, kit, scene, cam, pivot, center, frame_m, out)

        if "--export" in flags:
            export_kit_glb(vid, live, kit, os.path.join(out, "glb", f"{vid}_kit.glb"))

    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "parts.txt"), "w") as fh:
        fh.write("\n".join(report) + "\n")
    print("\n".join(report))


def export_kit_glb(vid, live, kit, path):
    """Live nodes + every kit part as its own `kit_<track><tier>_<n>` node,
    UV-pinned to the host's bake (or palette, no UVs, on a palette host)."""
    pivot = bpy.data.objects.get("PIVOT")
    if pivot:
        pivot.rotation_euler = (0, 0, 0)
        bpy.context.view_layer.update()
        for o in list(pivot.children):
            mw = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = mw
        # restore the turret hierarchy the import had: turret parts under turret_pivot
        tp = bpy.data.objects.get("turret_pivot")
        if tp:
            for o in live:
                if o.name.startswith("turret_") and o.type == "MESH":
                    mw = o.matrix_world.copy()
                    o.parent = tp
                    o.matrix_world = mw
    for o in bpy.data.objects:
        if o.type in ("LIGHT", "CAMERA"):
            bpy.data.objects.remove(o, do_unlink=True)
    hosts = {o.name: o for o in live}
    n = 0
    for track, tier, host, _label, objs in kit:
        h = hosts.get(host)
        hmat = h.data.materials[0] if h and h.data.materials and not h.data.materials[0].name.startswith("pal_") else None
        bm = bmesh.new()
        for o in objs:
            me = o.data.copy()
            me.transform(o.matrix_world)
            bm.from_mesh(me)
            bpy.data.meshes.remove(me)
        for o in objs:
            bpy.data.objects.remove(o, do_unlink=True)
        me = bpy.data.meshes.new(f"kit_{track[0]}{tier}_{host}")
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(me.name, me)
        bpy.context.scene.collection.objects.link(ob)
        if h and h.parent:
            ob.parent = h.parent
            ob.matrix_parent_inverse = h.parent.matrix_world.inverted()
        ob["rl_role"] = h.get("rl_role", "plate") if h else "plate"
        ob["rl_kit"] = {"track": track, "tier": tier, "host": host}
        if hmat is not None:
            me.materials.append(hmat)
            uvl = h.data.uv_layers.active
            u = tuple(uvl.data[h.data.polygons[0].loop_indices[0]].uv)
            lay = me.uv_layers.new(name=uvl.name)
            for loop in lay.data:
                loop.uv = u
        else:
            me.materials.clear()
        n += 1
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_extras=True,
                              export_yup=True, export_apply=False, use_selection=False,
                              export_image_format="AUTO", export_animations=False)
    print(f"EXPORT {vid} {path} kit_nodes={n} bytes={os.path.getsize(path)}")


def bake_texels(host):
    """Area-weighted base-colour texels of a textured host, sampled at each
    face's UV centroid: [(luminance, linear rgb, area)]. `image.pixels` holds
    the bake as stored (sRGB-encoded for these JPEG bakes), so it is decoded."""
    import numpy as np
    mat = host.data.materials[0] if host.data.materials else None
    img = None
    if mat and mat.use_nodes:
        for n in mat.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image is not None:
                img = n.image
                break
    if img is None:
        return []
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)
    uv = host.data.uv_layers.active.data
    out = []
    for poly in host.data.polygons:
        u = sum(uv[i].uv[0] for i in poly.loop_indices) / poly.loop_total
        v = sum(uv[i].uv[1] for i in poly.loop_indices) / poly.loop_total
        x = min(max(int((u % 1.0) * w), 0), w - 1)
        y = min(max(int((v % 1.0) * h), 0), h - 1)
        srgb = px[y, x, :3]
        lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
        lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
        out.append((lum, lin, poly.area))
    return out


def percentile_colour(texels, q):
    """The mean colour of the faces around the q-th area-weighted luminance
    percentile -- a real texel's hue, not an average across camouflage."""
    t = sorted(texels, key=lambda e: e[0])
    total = sum(a for _l, _c, a in t)
    acc, idx = 0.0, 0
    for i, (_l, _c, a) in enumerate(t):
        acc += a
        if acc >= q * total:
            idx = i
            break
    lo, hi = max(0, idx - len(t) // 100), min(len(t), idx + len(t) // 100 + 1)
    win = t[lo:hi]
    wsum = sum(a for _l, _c, a in win) or 1.0
    return tuple(sum(c[k] * a for _l, c, a in win) / wsum for k in range(3))


def colour_study(vid, live, kit, scene, cam, pivot, center, frame_m, out):
    """Kit level 3 in three candidate tones, the way UV-pinning would draw it
    (one bake texel per part = one flat albedo under the real sun): MATCH the
    hull's median paint, SHADE (the hull's 25th-percentile paint), or STEEL
    (`gunmetal.0`, the garage's kit colour). Sensors and firepower parts take
    the bake's own metal texel in the first two, as metal does on a vehicle."""
    hull = next((o for o in live if o.name == "hull_hull"), None)
    tex = bake_texels(hull) if hull else []
    if not tex:
        print(f"COLOUR {vid}: no bake texels -- skipped")
        return
    metal_host = next((o for o in live if o.name in ("turret_metal", "hull_metal") and o.data.materials
                       and o.data.materials[0] and not o.data.materials[0].name.startswith("pal_")), None)
    mtex = bake_texels(metal_host) if metal_host else []
    metal = percentile_colour(mtex, 0.5) if mtex else palette_linear("gunmetal.2")[:3]
    opts = {
        "match": (percentile_colour(tex, 0.5), metal),
        "shade": (percentile_colour(tex, 0.25), metal),
        "steel": (palette_linear("gunmetal.0")[:3], palette_linear("gunmetal.0")[:3]),
    }
    for name, (paint, met) in opts.items():
        pm, mm = flat_material(f"cs_{name}_p", paint), flat_material(f"cs_{name}_m", met)
        for track, _k, _h, _l, objs in kit:
            for o in objs:
                o.data.materials.clear()
                o.data.materials.append(pm if track == "armour" else mm)
        set_variant(kit, {t: 3 for t in TRACKS})
        for zoom, ppm in PX_PER_M.items():
            res = int(round(frame_m * ppm))
            scene.render.resolution_x = scene.render.resolution_y = res
            place_camera(cam, center, frame_m)
            pivot.rotation_euler = (0, 0, math.radians(240))
            bpy.context.view_layer.update()
            scene.render.filepath = os.path.join(out, "colour", vid, f"{name}_z{zoom}.png")
            bpy.ops.render.render(write_still=True)
        print(f"COLOUR {vid} {name} paint={tuple(round(c, 4) for c in paint)} metal={tuple(round(c, 4) for c in met)}")
    pivot.rotation_euler = (0, 0, 0)


if __name__ == "__main__":
    main()
