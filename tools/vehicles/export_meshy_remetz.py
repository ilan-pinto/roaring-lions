"""Export `aa_remetz` -- the Remetz Laser Carrier (E6, GH-274 chunk A2) -- as a TEXTURED
hull carrying a PALETTE beam turret, mesh contract v2.

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python tools/vehicles/export_meshy_remetz.py [-- --out <path>]

Writes `art/meshes/vehicles/aa_remetz.glb` and the export session
`art/src/vehicles/aa_remetz.blend`. After it, in the CLAUDE.md order:
`pnpm running-gear:meshes -- --id=aa_remetz`, `pnpm wreck:meshes -- --id=aa_remetz`,
`pnpm damage:meshes -- --id=aa_remetz`, `pnpm encode:meshes`.

NAME. The id is `aa_remetz` (the lead's ruling of 25 Oct: "Remetz Laser Carrier"). The
Meshy folders keep their `aa-gachelet-*` names and the ledger its `aa_gachelet` name: those
are the CLI's own records, and `LEDGER_NAME` below is how this script finds them. "Gachelet"
failed the rule-3 name screen and appears in no player-facing text.

SOURCE. AI-generated (Meshy text-to-3D preview + 8k refine + 8,000-triangle remesh),
disclosed per CONTRIBUTING.md; task ids in `docs/ASSET_PROVENANCE.md`:

  preview 01a16f82-1c48-7713-a22e-3654d3d95cb0
  refine  01a16f83-4a7f-75ed-be37-ee4bbbfc6553   (8k base colour)
  remesh  01a16f86-73a3-77a7-be4b-bdc749446789   (7,693 faces, the 8k bake kept)

`art/meshy/aa-gachelet-20261024-01a16f86/model.glb` (65 MB) is too large to track: it is
gitignored beside the other 8k sources, and only its task.json and thumbnail are tracked.

WHAT MESHY DELIVERED, AND WHAT IT DID NOT. The HULL passed: a six-wheeled armoured truck
with its olive bake, no markings (IoU 0.813 at the gate camera against the Eitan, the
highest). The TURRET failed: the prompt's squat octagonal beam turret with one round
aperture came back as a small octagonal roof hatch box in a shallow circular flange. So
**the turret is a Blender part, built here in code on the textured Meshy hull** -- the
Eitan's and the Tzav's pattern (a kit weapon station on a baked hull), at 0 extra credits,
which the lead accepted before this was built. The hull's own geometry and bake are the
Meshy asset; every node whose name starts `turret_`, plus `hull_metal` (the turret's column
and the exhaust stack), is generated geometry carrying NO material, so the runtime draws it
through `VEHICLE_ROLE_PALETTE["aa_remetz"]` per mesh, exactly as the Eitan's RWS draws.

ORIENTATION, measured: the long axis is X; the source's nose is -X (one front axle at -X, a
tandem at +X, and the radiator grille plus grab rails at +X are the REAR), so the whole
model takes one 180-degree rotation about Z and the cab faces +X.

THE CUTS AND SPLITS (all constants are SOURCE-frame, read off probes of this remesh):

  hatch    the roof hatch box (an octagonal box with two handle ears, top 3.96 m and ears
           4.34 m above the ground at the final scale, in a thin circular flange at 3.78 m)
           is FLATTENED to the flange: every vertex above `HATCH_Z_MIN` within `HATCH_R` of
           the hatch centre drops to the flange height. That cuts the box away with the
           mesh left closed and every UV in place (a delete-and-fill leaves a loop that the
           remesh's UV seams stop closing; the Eitan's gun cut learned this). The zero-area
           wall faces are then dissolved. The turret's column stands on the flat it leaves.
  tyres    `hull_rubber`: every face within `WHEEL_R` of one of three axles in side view,
           outboard of `WHEEL_AY` (`export_meshy_apc`'s own method, which the Eitan and the
           Kipod use). The rear tandem's two discs overlap, as the Grad's do.
  needle   one more stray in the source, found by review on 25 Oct: a roof antenna mount (a small box 1.67 m
           forward of the turret, 0.62 m to the right, its top at 3.87 m) whose whip the remesh collapsed to
           a three-triangle needle 0.43 m tall and a few centimetres wide: one source vertex at 4.298 m. It
           is a decimation artefact, not geometry anyone drew: invisible at gameplay size, and a hair-thin
           spike over the roof. `_clip_needles` drops every vertex above `ROOF_MAX_M` (3.90 m: the roof's
           own highest point is 3.872, and the hatch box above it is already flattened) onto the mount's
           top, `NEEDLE_TO_M`, the same flatten-in-place as the hatch (the mesh stays closed, every UV
           stays), and the export refuses to run unless what it finds is ONE needle.
  windows  NOT split. They are painted into the bake: no pane is modelled, so there is no
           `hull_glass` to cut (the gate cannot judge it, the wreck cannot blow it out).
  hull     `hull_hull`: the rest, texture and all.

THE TURRET (palette parts, FINAL frame, origin of the pivot at the column's top centre):

  hull_metal    an octagonal column on a flange, and the exhaust stack (which the damage pass bends
                40 degrees aft). It does not turn.
  turret_pivot  an empty with `extras.rl_pivot = "turret"` at the column top
  turret_hull   the octagonal head, 1.55 x 1.45 x 1.15 m, stepped skirt, bevelled roof, two
                flank access panels (the LEFT, -Z, rear one is what the damage pass swings open),
                a roof hatch
  turret_metal  the thick armoured ring round the aperture (aperture radius 0.45 m), a roof
                sensor box and lens, side cooling fins, panel bolts
  turret_glass  the aperture: one shallow dished disc, its own mesh, so the beam knows where
                it starts and the wreck can blow it out
  rl_fire       scene extras `{ muzzle: [x, y, z] }`: the aperture centre measured on the `turret_glass`
                vertices (the middle of the disc across, the rim's plane along X), in the GLB frame `fire-points.ts` reads (+X forward, +Y up, +Z the
                vehicle's right), **TURRET-LOCAL: relative to `turret_pivot`**, so the beam
                origin follows traverse. (`parseFireExtras` reads it for rigged teams today;
                a vehicle reader adds the pivot position and the turret yaw.)

SCALE AND HEIGHT, a measured disagreement. The brief fixes 7.6 m LONG and a turret roof at
3.7 m. This hull's own roof stands at 3.71 m at 7.6 m long (it is a tall MRAP-class box: the
Kipod is 7.20 m by 3.45 m), so the two cannot both hold. The length is the explicit scale
instruction and the turret numbers say "about", so `REAL_METRES` stays 7.6 and the head sits
on a short column ABOVE the hull: turret roof near 5.1 m. If the lead wants the turret at
3.7 m the only lever is the hull's scale (`REAL_METRES`, about 5.4 m long for a 4.2 m roof).

TEXTURE. The remesh arrives with its images named `texture_0`/`..._metallic_roughness`; the
base colour is renamed `base_color` after checking it is the image wired to the Principled
BSDF (`export_meshy_apc._rename_textures`), and all three images ship at
`textured.TEXTURE_PX` (2048) -- the lead: "dont drop resolution". No band shift: the bake's
paint band (hue 63.5, sat 0.354, val 0.313) is within the Kipod's family and the lead asked
for the bake as it is.

DETERMINISM. No `mathutils.noise`; every number is a constant or measured off the source's
own vertex data. Primitives are built vertex by vertex with explicit trigonometry.
"""
import glob
import math
import os
import sys
from types import SimpleNamespace

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import textured as vehicle_textured  # noqa: E402
import export_meshy_apc as apc  # noqa: E402  same vehicle class: tyre split, texture rename

REPO = os.path.dirname(TOOLS)
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_AA_REMETZ = os.path.join(OUT_DIR, "aa_remetz.glb")
SRC_DIR = os.path.join(REPO, "art", "src", "vehicles")
OUT_BLEND = os.path.join(SRC_DIR, "aa_remetz.blend")
TURRET_PIVOT_NODE = "turret_pivot"

UNIT_ID = "aa_remetz"
LEDGER_NAME = "aa_gachelet"      # the Meshy CLI's record name for this unit's tasks
REAL_METRES = 7.6                # brief and spec 2.2: the hull's declared length
TRI_CAP = 10000                  # the shipped cap, checked again after the running-gear pass
CREDIT = (
    "Remetz Laser Carrier -- AI-generated hull (Meshy text-to-3D preview + 8k refine + remesh), "
    "disclosed per CONTRIBUTING.md; re-oriented, re-scaled, tyre split, roof hatch cut away and "
    "fitted with a beam turret built in Blender for Roaring Lions"
)

# --- the hull's own measurements, SOURCE frame (model units, nose -X, z up) -------------------
SPEC = SimpleNamespace(
    unit_id=UNIT_ID,
    wheel_r=0.18,                       # tyre radius: front disc z extent 0.357 (probe)
    wheel_ay=0.27,                      # inboard limit of a tyre (front discs |y| 0.277-0.408)
    tyre_ay=0.28,
    axle_seeds_x=(-0.52, 0.327, 0.618),  # contact-patch clusters (probe), front first
    tyre_z_band=0.08,
    axle_half_window=0.13,
    axle_min_verts=40,
)
HATCH_CENTRE_XY = (0.3447, 0.0018)   # bbox centre of the box above 3.9 m (probe)
HATCH_R = 0.21                       # the box and its ears; the flange lies at 0.20-0.25
HATCH_Z_MIN_M = 3.795                # metres above the ground at the final scale: the flange top, 3.78
HATCH_FLAT_M = 3.80                  # where the flattened box comes to rest: the flange top
SRC_MPU = REAL_METRES / 1.8976       # the source's length is 1.8976 units: only used for the above
ROOF_MAX_M = 3.90                    # nothing of the hull proper stands above this: the roof tops out at 3.872 (probe)
NEEDLE_TO_M = 3.87                   # where a collapsed antenna whip's apex comes to rest: its mount's top
NEEDLE_CLUSTER_M = 0.05              # the apex's split copies (one per UV/normal island) all sit within this

# --- the turret, FINAL frame, metres ------------------------------------------------------
COLUMN_H = 0.30                      # the short armoured column, above the flattened hatch
COLUMN_R = 0.60                      # octagonal, circumradius
FLANGE_R = 0.72
FLANGE_H = 0.07
HEAD_L, HEAD_W, HEAD_H = 1.55, 1.45, 1.15
APERTURE_R = 0.45                    # aperture radius (brief: about 0.46)
RING_OUT_R = 0.57                    # thick armoured ring
RING_DEPTH = 0.20
STACK_XY = (-2.85, 0.80)             # exhaust stack: rear-left of the roof (final frame; roof is +/-1.1 wide here)
STACK_R = 0.11
STACK_H = 1.30


# ================================================================================================
# generated-geometry helpers
# ================================================================================================
def _ring_pts(r, n, z, x0=0.0, y0=0.0, phase=0.0):
    return [(x0 + r * math.cos(phase + 2 * math.pi * i / n), y0 + r * math.sin(phase + 2 * math.pi * i / n), z)
            for i in range(n)]


def _loft(bm, rings, cap_first=True, cap_last=True):
    """Close a stack of same-length rings with quads, optionally cap both ends."""
    vs = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(vs[0])
    for a, b in zip(vs, vs[1:]):
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    if cap_first:
        bm.faces.new(vs[0])
    if cap_last:
        bm.faces.new(list(reversed(vs[-1])))
    return vs


def _oct_ring(l, w, c, z, dz=None):
    """A chamfered rectangle, 8 points CCW from above, front face = points 0-1 (x = +l/2)."""
    pts = [(l / 2, -(w / 2 - c)), (l / 2, w / 2 - c), (l / 2 - c, w / 2), (-(l / 2 - c), w / 2),
           (-l / 2, w / 2 - c), (-l / 2, -(w / 2 - c)), (-(l / 2 - c), -w / 2), (l / 2 - c, -w / 2)]
    return [(x, y, z + (dz[i] if dz else 0.0)) for i, (x, y) in enumerate(pts)]


def _box(bm, centre, size, bevel=0.0):
    cx, cy, cz = centre
    sx, sy, sz = size
    b = bevel
    if b <= 0:
        pts = [(cx + sx / 2 * ex, cy + sy / 2 * ey, cz + sz / 2 * ez)
               for ez in (-1, 1) for (ex, ey) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        v = [bm.verts.new(p) for p in pts]
        for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            bm.faces.new([v[i] for i in f])
        return
    rings = []
    for dz, k in ((-sz / 2, 1.0 - 2 * b / min(sx, sy)), (-sz / 2 + b, 1.0), (sz / 2 - b, 1.0), (sz / 2, 1.0 - 2 * b / min(sx, sy))):
        rings.append([(cx + (sx / 2) * k * ex, cy + (sy / 2) * k * ey, cz + dz)
                      for (ex, ey) in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    _loft(bm, rings)


def _cylinder_x(bm, cx, cy, cz, r, x0, x1, n=12):
    """A cylinder along X from x0 to x1."""
    rings = []
    for x in (x0, x1):
        rings.append([(x, cy + r * math.cos(2 * math.pi * i / n), cz + r * math.sin(2 * math.pi * i / n)) for i in range(n)])
    _loft(bm, rings)


def _prism_z(bm, cx, cy, z0, z1, r, n=6, phase=0.0):
    _loft(bm, [_ring_pts(r, n, z0, cx, cy, phase), _ring_pts(r, n, z1, cx, cy, phase)])


def _object(name, role, bm, flat=True):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if flat:
        for p in me.polygons:
            p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob["rl_role"] = role
    return ob


def _translate(ob, v):
    for vert in ob.data.vertices:
        vert.co += Vector(v)
    ob.data.update()


# ================================================================================================
# the turret and the stack (built around the pivot at the origin, then moved to it)
# ================================================================================================
def build_column():
    """`hull_metal`: the octagonal column on its flange, plus the exhaust stack. Pivot-local z:
    the column's top is z = 0, the flattened hatch is at z = -COLUMN_H."""
    bm = bmesh.new()
    zb = -COLUMN_H
    # flange: a low octagonal plate, then the column, then a top collar
    _loft(bm, [_ring_pts(FLANGE_R, 8, zb - 0.02, phase=math.pi / 8), _ring_pts(FLANGE_R, 8, zb + FLANGE_H, phase=math.pi / 8)])
    _loft(bm, [_ring_pts(COLUMN_R, 8, zb + FLANGE_H, phase=math.pi / 8), _ring_pts(COLUMN_R * 0.96, 8, -0.04, phase=math.pi / 8),
               _ring_pts(COLUMN_R * 1.04, 8, -0.04, phase=math.pi / 8), _ring_pts(COLUMN_R * 1.04, 8, 0.0, phase=math.pi / 8)],
          cap_first=False)
    # eight flange bolts
    for i in range(8):
        a = 2 * math.pi * i / 8
        _prism_z(bm, (FLANGE_R - 0.06) * math.cos(a), (FLANGE_R - 0.06) * math.sin(a), zb + FLANGE_H, zb + FLANGE_H + 0.03, 0.03, 6)
    return bm


def build_stack(roof_z):
    """The exhaust stack, in FINAL-frame coordinates: a bracketed pipe up the rear-left corner with a
    rain cap. Ten rings, so the damage pass can bend it without kinking."""
    bm = bmesh.new()
    sx, sy = STACK_XY
    n = 12
    rings = []
    z0 = roof_z - 0.10
    nrings = 11
    for i in range(nrings):
        t = i / (nrings - 1)
        r = STACK_R * (1.0 + 0.10 * math.sin(math.pi * t) * 0.0)
        rings.append(_ring_pts(r, n, z0 + (STACK_H + 0.10) * t, sx, sy))
    _loft(bm, rings)
    # rain cap: a short wider cone over the mouth
    top = z0 + STACK_H + 0.10
    _loft(bm, [_ring_pts(STACK_R * 1.55, n, top + 0.03, sx, sy), _ring_pts(STACK_R * 1.15, n, top + 0.14, sx, sy)],
          cap_first=False)
    # two clamp bands and a base collar
    for zc in (z0 + 0.35, z0 + 0.85):
        _loft(bm, [_ring_pts(STACK_R * 1.35, n, zc, sx, sy), _ring_pts(STACK_R * 1.35, n, zc + 0.07, sx, sy)])
    _loft(bm, [_ring_pts(STACK_R * 1.9, n, z0, sx, sy), _ring_pts(STACK_R * 1.9, n, z0 + 0.06, sx, sy)])
    return bm


def build_head():
    """`turret_hull`: the octagonal head, pivot-local: bottom at z = 0, aperture on +X."""
    bm = bmesh.new()
    rings = [
        _oct_ring(1.40, 1.30, 0.18, 0.00),
        _oct_ring(1.40, 1.30, 0.18, 0.14),
        _oct_ring(HEAD_L, HEAD_W, 0.22, 0.14),
        _oct_ring(HEAD_L - 0.03, HEAD_W - 0.03, 0.22, 0.95),
        _oct_ring(HEAD_L - 0.13, HEAD_W - 0.13, 0.20, HEAD_H - 0.07),
        _oct_ring(HEAD_L - 0.21, HEAD_W - 0.21, 0.19, HEAD_H),
    ]
    _loft(bm, rings)
    # roof hatch: a low 16-gon disc, set a little aft of centre
    _loft(bm, [_ring_pts(0.26, 16, HEAD_H - 0.001, -0.22, 0.0), _ring_pts(0.24, 16, HEAD_H + 0.04, -0.22, 0.0)])
    # flank access panels: a raised plate on each flank (+Y left, -Y right = the vehicle's +Z side)
    wall = (HEAD_W - 0.03) / 2 + 0.0
    for side in (1, -1):
        for (xc, w) in ((-0.40, 0.56), (0.28, 0.50)):
            _box(bm, (xc, side * (wall - 0.005 + 0.014), 0.54), (w, 0.034, 0.46), bevel=0.012)
    # rear service hatch
    _box(bm, (-(HEAD_L - 0.03) / 2 - 0.011, 0.0, 0.52), (0.034, 0.60, 0.46), bevel=0.012)
    return bm


def build_turret_metal():
    """`turret_metal`: the armoured aperture ring, roof sensor box, flank cooling fins, panel bolts."""
    bm = bmesh.new()
    fx = HEAD_L / 2 - 0.03 / 2 + 0.0   # the head's front face at the wall's mid taper
    zc = 0.575
    # armoured ring: a tube with a bevelled front edge, on the front face
    n = 24
    x0, x1 = fx - 0.01, fx - 0.01 + RING_DEPTH
    def circ(r, x):
        return [(x, r * math.cos(2 * math.pi * i / n), zc + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    vo0, vo1, vo2 = [bm.verts.new(p) for p in circ(RING_OUT_R, x0)], [bm.verts.new(p) for p in circ(RING_OUT_R, x1 - 0.04)], \
        [bm.verts.new(p) for p in circ(RING_OUT_R - 0.04, x1)]
    vi1 = [bm.verts.new(p) for p in circ(APERTURE_R, x1)]
    vi0 = [bm.verts.new(p) for p in circ(APERTURE_R, x0)]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((vo0[i], vo0[j], vo1[j], vo1[i]))        # outer wall
        bm.faces.new((vo1[i], vo1[j], vo2[j], vo2[i]))        # bevel
        bm.faces.new((vo2[i], vo2[j], vi1[j], vi1[i]))        # front annulus
        bm.faces.new((vi1[i], vi1[j], vi0[j], vi0[i]))        # bore
    # roof sensor box with its lens, left rear of the roof
    _box(bm, (-0.38, 0.36, HEAD_H + 0.04 + 0.08), (0.52, 0.40, 0.16), bevel=0.025)
    _cylinder_x(bm, 0, 0.36, HEAD_H + 0.12, 0.065, -0.38 + 0.26 - 0.001, -0.38 + 0.26 + 0.04, 12)
    _box(bm, (0.12, -0.34, HEAD_H + 0.04 + 0.05), (0.20, 0.16, 0.10), bevel=0.012)
    # flank cooling fins in a shallow frame (rear half of the flank is the panel, the fins sit forward)
    wall = (HEAD_W - 0.03) / 2
    for side in (1, -1):
        for k in range(5):
            _box(bm, (-0.05 + k * 0.125, side * (wall + 0.040), 0.54), (0.045, 0.07, 0.52), bevel=0.008)
        # frame bars top and bottom
        _box(bm, (0.19, side * (wall + 0.020), 0.54 + 0.285), (0.74, 0.03, 0.04))
        _box(bm, (0.19, side * (wall + 0.020), 0.54 - 0.285), (0.74, 0.03, 0.04))
    # access-panel bolts (hex prisms) on every flank panel corner
    for side in (1, -1):
        for (xc, w) in ((-0.40, 0.56), (0.28, 0.50)):
            for ex in (-1, 1):
                for ez in (-1, 1):
                    px, pz = xc + ex * (w / 2 - 0.05), 0.54 + ez * (0.23 - 0.05)
                    y = side * (wall + 0.014 + 0.017)
                    _prism_y(bm, px, y, pz, 0.028, side)
    return bm


def _prism_y(bm, cx, y, cz, r, side, depth=0.02):
    rings = [[(cx + r * math.cos(2 * math.pi * i / 6), y + side * d, cz + r * math.sin(2 * math.pi * i / 6)) for i in range(6)]
             for d in (0.0, depth)]
    _loft(bm, rings)


def build_glass():
    """`turret_glass`: the aperture, a shallow dished disc inside the ring (24 rim points, one hub)."""
    bm = bmesh.new()
    fx = HEAD_L / 2 - 0.03 / 2
    zc = 0.575
    xr = fx + 0.07                 # the rim: 0.07 proud of the face, 0.13 behind the ring's front

    n = 24
    rim = [bm.verts.new((xr, APERTURE_R * math.cos(2 * math.pi * i / n), zc + APERTURE_R * math.sin(2 * math.pi * i / n))) for i in range(n)]
    hub = bm.verts.new((xr - 0.05, 0.0, zc))      # a shallow dish, its hub still 0.02 proud of the face
    for i in range(n):
        bm.faces.new((rim[i], rim[(i + 1) % n], hub))
    return bm


# ================================================================================================
# the hull
# ================================================================================================
def _flatten_hatch(ob, zmin_src, mpu):
    """Cut the roof hatch box away by dropping everything above the flange onto it. SOURCE frame."""
    cx, cy = HATCH_CENTRE_XY
    z_lo = zmin_src + HATCH_Z_MIN_M / mpu
    z_fl = zmin_src + HATCH_FLAT_M / mpu
    moved = 0
    for v in ob.data.vertices:
        if v.co.z > z_lo and math.hypot(v.co.x - cx, v.co.y - cy) < HATCH_R:
            v.co.z = z_fl
            moved += 1
    ob.data.update()
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    before = len(bm.faces)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
    # faces that collapsed to a sliver: zero area after the flatten
    dead = [f for f in bm.faces if f.calc_area() < 1e-9]
    if dead:
        bmesh.ops.delete(bm, geom=dead, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    print(f"[{UNIT_ID}] hatch flattened: {moved} verts dropped to {HATCH_FLAT_M} m, {before} -> {len(ob.data.polygons)} faces")


def _clip_needles(ob, zmin_src, mpu):
    """Drop a collapsed antenna whip's apex onto its mount. SOURCE frame (z up, `mpu` metres a unit).

    A needle is any vertex above `ROOF_MAX_M` once the hatch box has been flattened: the roof's own highest
    point is 3.872 m and nothing else of the hull stands over 3.90 (a first cut that asked for "a vertex over
    its neighbours" caught 173 points of ordinary arch and rail detail; a height above the hull's own roof
    asks only about what is not hull). Moving the vertex rather than deleting its faces keeps the mesh closed
    and every UV in place, as `_flatten_hatch` does. Returns the apexes found as (index, x, y, metres).
    The glTF import splits a vertex per UV island, so one whip's apex may arrive as several copies at one
    point: they are counted as one needle, and a second needle elsewhere is a different count."""
    z_hi = zmin_src + ROOF_MAX_M / mpu
    z_to = zmin_src + NEEDLE_TO_M / mpu
    found = [(v.index, v.co.x, v.co.y, (v.co.z - zmin_src) * mpu) for v in ob.data.vertices if v.co.z > z_hi]
    for idx, *_ in found:
        ob.data.vertices[idx].co.z = z_to
    ob.data.update()
    for idx, x, y, h in found:
        print(f"[{UNIT_ID}] needle clipped: source vertex {idx} at ({x:+.4f}, {y:+.4f}), {h:.3f} m up, "
              f"dropped to {NEEDLE_TO_M} m")
    return found


def _needle_clusters(found, mpu):
    """How many distinct needles `found` is: copies within `NEEDLE_CLUSTER_M` of one another are one."""
    centres = []
    for _idx, x, y, _h in found:
        if not any(math.hypot(x - cx, y - cy) * mpu < NEEDLE_CLUSTER_M for cx, cy in centres):
            centres.append((x, y))
    return len(centres)


def _tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def export(out_path=None):
    src, task_id = apc._remesh_source(LEDGER_NAME)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1 or len(meshes[0].data.materials) != 1:
        raise SystemExit(f"[{UNIT_ID}] expected one textured mesh in {src}, found "
                         f"{[(o.name, len(o.data.materials)) for o in meshes]}")
    ob = meshes[0]
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    ob.parent = None
    apc._bake([ob], ob.matrix_world.copy())
    ob.matrix_world = Matrix.Identity(4)
    print(f"[{UNIT_ID}] source {os.path.relpath(src, REPO)} (remesh task {task_id}): {len(ob.data.polygons)} faces")
    apc._rename_textures(SPEC, ob)

    zmin_src = min(v.co.z for v in ob.data.vertices)
    _flatten_hatch(ob, zmin_src, SRC_MPU)
    # the flange height and the hatch centre in the source frame, to carry through the same transforms
    needles = _clip_needles(ob, zmin_src, SRC_MPU)
    if _needle_clusters(needles, SRC_MPU) != 1:
        raise SystemExit(f"[{UNIT_ID}] found {_needle_clusters(needles, SRC_MPU)} needle(s) over {ROOF_MAX_M} m, "
                         f"expected exactly 1 (the roof antenna whip): the source or the rule changed")
    hatch_src = Vector((HATCH_CENTRE_XY[0], HATCH_CENTRE_XY[1], zmin_src + HATCH_FLAT_M / SRC_MPU))

    axles = apc._axles(SPEC, ob)
    parts = apc._split_wheels(SPEC, ob, axles)
    objs = list(parts.values())

    # orientation, scale, ground: carried as one matrix so the hatch centre follows the hull
    M = Matrix.Rotation(math.pi, 4, "Z")
    apc._bake(objs, M)
    mn, mx = apc._bounds(objs)
    mpu = metres_per_unit(mx.x - mn.x, REAL_METRES)
    S = Matrix.Scale(mpu, 4)
    apc._bake(objs, S)
    M = S @ M
    mn, mx = apc._bounds(objs)
    T = Matrix.Translation(-Vector(((mn.x + mx.x) / 2.0, (mn.y + mx.y) / 2.0, mn.z)))
    apc._bake(objs, T)
    M = T @ M
    mn, mx = apc._bounds(objs)
    print(f"[{UNIT_ID}] {REAL_METRES:.3f} m long, mpu {mpu:.5f} (probe estimated {SRC_MPU:.5f}); hull "
          f"x[{mn.x:+.3f},{mx.x:+.3f}] y[{mn.y:+.3f},{mx.y:+.3f}] z[{mn.z:+.3f},{mx.z:+.3f}]")
    hatch = M @ hatch_src
    print(f"[{UNIT_ID}] hatch / turret centre at ({hatch.x:+.3f}, {hatch.y:+.3f}), flange top z {hatch.z:+.3f}")

    # ---- the turret, in the final frame -----------------------------------------------------
    pivot = Vector((hatch.x, hatch.y, hatch.z + COLUMN_H))
    column = _object("hull_metal", "metal", build_column())
    stack = _object("hull_metal_stack", "metal", build_stack(hatch.z))
    _translate(column, pivot)
    head = _object("turret_hull", "hull", build_head())
    metal = _object("turret_metal", "metal", build_turret_metal())
    glass = _object("turret_glass", "glass", build_glass())
    for t in (head, metal, glass):
        _translate(t, pivot)
    # `hull_metal` is ONE node: the column and the stack joined
    bpy.ops.object.select_all(action="DESELECT")
    column.select_set(True)
    stack.select_set(True)
    bpy.context.view_layer.objects.active = column
    bpy.ops.object.join()
    hull_metal = bpy.context.view_layer.objects.active
    hull_metal.name = hull_metal.data.name = "hull_metal"
    hull_metal["rl_role"] = "metal"

    pivot_obj = bpy.data.objects.new(TURRET_PIVOT_NODE, None)
    pivot_obj.empty_display_size = 0.05
    pivot_obj["rl_pivot"] = "turret"
    bpy.context.collection.objects.link(pivot_obj)
    pivot_obj.location = pivot
    inv = Matrix.Translation(-pivot)
    for t in (head, metal, glass):
        t.parent = pivot_obj
        t.matrix_parent_inverse = inv

    # rl_fire: the aperture centre measured on the turret_glass vertices, turret-local, in the GLB (glTF) frame
    # the aperture centre: the middle of the disc across (y, z) and the rim's plane along x (the front of the glass),
    # which is robust to the exporter splitting vertices for flat shading
    gv = [v.co - pivot for v in glass.data.vertices]
    cy = (min(v.y for v in gv) + max(v.y for v in gv)) / 2
    cz = (min(v.z for v in gv) + max(v.z for v in gv)) / 2
    muzzle = [round(float(max(v.x for v in gv)), 4), round(float(cz), 4), round(float(-cy), 4)]
    bpy.context.scene["rl_fire"] = {"muzzle": muzzle}
    print(f"[{UNIT_ID}] rl_fire.muzzle (turret-local, GLB frame x fwd / y up / z right): {muzzle}; "
          f"pivot at ({pivot.x:+.3f}, {pivot.y:+.3f}, {pivot.z:+.3f}) m")

    every = objs + [hull_metal, head, metal, glass]
    per_node = {o.name: _tris(o) for o in every}
    tris = sum(per_node.values())
    print(f"[{UNIT_ID}] triangles per node: {per_node} = {tris} (cap {TRI_CAP})")
    if tris > TRI_CAP:
        raise SystemExit(f"[{UNIT_ID}] {tris} triangles over the cap {TRI_CAP}")
    mn, mx = apc._bounds(every)

    kept, _dropped = vehicle_textured.prepare_vehicle_textures()
    for name, before, after in kept:
        print(f"[{UNIT_ID}] image {name}: {before} -> {after}")
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(SRC_DIR, exist_ok=True)
    out = out_path or OUT_AA_REMETZ
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(**vehicle_textured.gltf_kwargs(out, CREDIT))
    print(f"[{UNIT_ID}] wrote {out} ({os.path.getsize(out)} bytes, {tris} tris, "
          f"bounds {tuple(round(c, 3) for c in (mx - mn))}, nodes {sorted(o.name for o in every)} + {TURRET_PIVOT_NODE})")
    if out_path is None:
        # The three images were scaled to TEXTURE_PX above and are dirty in memory: pack THOSE
        # (a plain `pack_all` re-reads the 8k files from disk and writes a 68 MB .blend).
        for img in bpy.data.images:
            if img.packed_file:
                img.unpack(method="REMOVE")
            img.pack()
            print(f"[{UNIT_ID}] packed {img.name} {tuple(img.size)}: {img.packed_file.size} bytes")
        bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, compress=True)
        print(f"[{UNIT_ID}] saved {OUT_BLEND} ({os.path.getsize(OUT_BLEND)} bytes)")
    return out


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    export(out_path=argv[argv.index("--out") + 1] if "--out" in argv else None)
