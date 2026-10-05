"""Build `art/meshes/moto_rpg.glb` from a Meshy motorcycle and B3's rpg_team
figure re-posed seated, on rig.py's own moto topology.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/units/import_meshy_moto_rpg.py

WP-A3.1 (GH-179) batch B6, 2026-10-01 -- `docs/art/meshy-prompts-units.md`
§17, style bible §6 B6 ("the bike is a 25-credit vehicle part; its riders are
B3's rigged figures re-posed seated"). Owner of the file in
`rig.TEAM_MESH_OWNER`, so `export_mesh_team.py -- all` skips it.

SOURCES

  the bike     A3.1 stage 2 (GH-179, 2026-10-05): the TEXTURED re-make --
               preview 01a10c31-ea45-70f1-bef0-b06f3d51d4e2, refine (8k)
               01a10c65-0225-775d-8dfd-e5f11040b216, REMESH 01a10c69-8fc1-740c-acb1-1e25cd415d57
               at 1,500 (arrived 1,440 tris, 8k base colour), found through
               the ledger's last `kind: remesh` named `moto_rpg` (`_bike_source`),
               not a glob over a hand-typed id. It replaces B6's palette bike
               (preview 01a0f62f, remesh 01a0f631, no uv, no material), whose
               source dir stays in the tree as history.
  the riders   B3's rpg_team remesh (01a0f313-bf75-727d-8573-8fb7f04c2453,
               1.76 m, its own 2k bake, the rose head wrap remapped to dusty
               tan) -- `import_meshy_crew_team.SOURCES["moto_rpg"]`, loaded
               and cut by that module, 0 credits.

AI-generated (Meshy), disclosed per CONTRIBUTING.md.

## The topology is rig.py's, unchanged

`rig._moto_bone_table` / `rig.build_moto_clips`: a rigid machine on `m_root`,
two spinning wheel bones, `m_launcher` pitching on its own bone, each rider
ONE rigid unit on `rid_seat`/`pas_seat` (breathing sway only), and three
wreck bones (`mw`, `mw_a`, `mw_b`). This file keeps every bone NAME and every
clip and only moves the heads to what it measured on the Meshy bike: the two
axles, the saddle. `rig.build_clips(arm, "moto_rpg")` is called as is.

## The bike, measured rather than assumed

The remesh's long axis is X and its FRONT is at -X (the bars are the widest
end -- |y| 0.519 against 0.294 at the rear in the first and last 40% of the
length -- and the preview's side view agrees), so it takes one 180-degree Z
turn, as the gun truck did. Scaled so its length is `BIKE_LENGTH`
(teams._motorcycle's 2.2 m, x1.169), tyres on z = 0.

**What the 5 Oct remesh did that the 1 Oct one did not**, found by dumping the
remesh's connected pieces (`_islands`: 6 vertex-connected pieces, vertices merged
by position because Meshy splits them along uv seams -- 12 when only edges
connect) and plotting their centroids, and every number below read off that,
never guessed:

  * a SECOND wheel stands across the front -- a 116-face hoop with a mudguard
    and hub (four pieces, 155 faces), 0.34 m right of the centre line, which is
    not in the prompt and not on a bike. Deleted.
  * the FRONT wheel is welded to the fork inside the big island and is yawed
    about 14-27 degrees (a steered wheel, hub 0.16 m off the centre line). Its
    faces are cut by a disc about the measured front hub, and a straight kit
    wheel goes on the centre line.
  * the rear wheel is a clean 183-face island, which gives the axle (x -0.761),
    the wheel radius (0.337) and the centre line (its y mid, +0.119 -- the old
    importer centred the bbox and the stray wheel dragged the whole bike 0.12 m
    sideways). Deleted; the kit wheel replaces it.
  * the bedroll "behind the saddle" landed ON the saddle at 1.03 m, which would
    seat both riders a hand above the real seat (0.90 m). 45 faces deleted.
  * the bars are three small islands above z 1.0 (half width 0.40 m, z 1.06):
    kept, and read for the grips.

All of it in `_prune_bike`; the front axle is the big island's max x less the
radius (+0.763), so the wheelbase reads 1.52 m, a dirt bike's.

**The wheels are kit tubes again** -- a 14-segment solid cylinder on each
measured axle bound to the wheel bones, a spinning disc reading as a wheel at
25 px where a spinning hoop is a flicker -- but now TEXTURED: each takes one uv,
the bike bake's own tyre texel (`_bike_borrow_uv`, the twin of
`crew._borrow_uv`, which can only point at the riders' material).

## THE BIKE'S BAKE: a second material, not a share of the riders' atlas

The B8 part precedent (`import_meshy_crew_team.MESHY_PARTS`) composes a part's
bake BESIDE the figure's in one 2 x 1 atlas so the whole file keeps one
material. That is NOT done here, for three reasons. (1) The bike's bake is an
8k image shipped at 2,048 -- the vehicles' `textured.TEXTURE_PX`, "dont drop
resolution" -- against the riders' 1,024; an atlas would scale one of them to
the other's density or grow to 3 x 1. (2) Another change is replacing the
launcher with a Meshy part through exactly that atlas, in the riders' half of
`import_meshy_crew_team.py`; a bike composed into the same atlas would fight it
for the right-hand half. (3) A role only splits into `_1`/`_2` primitives when
ITS faces sit on two materials, and the bike can be given roles the riders do
not use. So: the bike has its own material, `bike_material`, its own image,
`bike_color` (never `base_color`, which is the figure's), and ONE role, `metal`
(frame and both wheels, living and wrecked), which no rider part uses -- the
palette bike's `webbing` and `weapon` pieces are gone, `weapon` being the one
role the bike must not touch, since the launcher is a `weapon` part.
`_one_material_per_role` fails the build if that ever stops being true. It is
also one skinned draw call where the palette bike was three.

Triangle budget: the crew importer at `HEAD` cuts the riders larger than the
file B6 shipped from (2 x 2,720 faces), so the same file with this bike read
8,955 against the 8,000 cap; the thrown corpses (0.35 -> 0.25) and the tipped
bike (0.45 -> 0.30) are decimated harder to land at 7,903 -- as close to the cap
as the ratio steps allow (the lead's rule: maximum detail, simplified only to the
measured cap; 0.16 read 7,423 and left 577 triangles unspent).

## The riders, re-posed in code

`import_meshy_crew_team.cut_figure` cuts the standing rpg_team figure into
rig.py parts with hung arms; this file re-arranges those parts RIGIDLY into a
seat (the same move `_kneel` makes for a kneel): the upper body is lifted so
the crotch sits on the saddle, each thigh is swung forward about its own hip
to `THIGH_FWD_DEG`, each shin back about the moved knee so the boot reaches
the peg line, the rider's upper body is leaned `RIDER_LEAN_DEG` about the
crotch and both arms are posed to the bars (upper arm to an elbow target,
forearm from there to the grip); the pillion sits upright with his hands on
his knees. Every part of a rider is then force-bound to its seat bone -- one
rigid unit, as `teams._rider` was. No hand-posing, no weights.

The corpses are `import_meshy_crew_team._death_parts_posed` at
`teams.moto_rpg`'s own (0.30, -0.42) / (-0.32, 0.46); the wrecked bike is the
same frame tipped through `teams._tip_over` (the identical call rig.py makes
for the kit bike) and decimated once, on `mw_death_root`.

After this: `pnpm gait:meshes -- --id=moto_rpg` (declares nothing -- no
walker), `pnpm validate:meshes`, `pnpm encode:meshes`.
"""
import glob
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

import kit  # noqa: E402
import rig  # noqa: E402
import teams  # noqa: E402
import import_meshy_crew_team as crew  # noqa: E402

REPO = os.path.dirname(TOOLS)
TEAM = "moto_rpg"
OUT_PATH = os.path.join(REPO, "art", "meshes", "moto_rpg.glb")   # literal: mesh_ownership.test.ts reads it
BIKE_NAME = "moto_rpg"            # the ledger `name` of the bike's text -> refine -> remesh chain
BIKE_TEXTURE_PX = 2048            # the bike's own bake, at `tools/vehicles/textured.py`'s TEXTURE_PX
BIKE_IMAGE = "bike_color"         # NOT `base_color`: that is the riders' figure bake (crew._keep_base_color)
#: The lead's ruling (5 Oct, PR #396): the bike's safety-orange paint
#: (and its yellow-orange trim) reads as a marker colour at 25 px; it ships
#: a muted dusty tan instead. Every bike texel at hue BIKE_TAN_HUE_IN with
#: saturation > BIKE_TAN_SAT and value > BIKE_TAN_VAL is moved to hue
#: BIKE_TAN_HUE, saturation x BIKE_TAN_SAT_GAIN (capped BIKE_TAN_SAT_CAP),
#: value x BIKE_TAN_VAL_GAIN -- the variant photographed in
#: docs/art/sheets/a31-parts/moto_rpg-muted.png (24 % of the 2048 image).
#: Black, gunmetal and chrome are untouched. `_retexel_bike_tan` refuses to
#: run if it finds no orange, as `crew._retexel_orange` does.
BIKE_TAN_HUE_IN = (12.0, 58.0)    # degrees
BIKE_TAN_SAT = 0.30
BIKE_TAN_VAL = 0.15
BIKE_TAN_HUE = 38.0
BIKE_TAN_SAT_GAIN = 0.40
BIKE_TAN_SAT_CAP = 0.32
BIKE_TAN_VAL_GAIN = 0.74

BIKE_LENGTH = 2.2                 # teams._motorcycle: "The machine: 2.2 m long"
WHEEL_WIDTH = 0.10
WHEEL_CUT_MARGIN = 0.03          # m past the measured tyre radius that a wheel-disc face is cut
WHEEL_CUT_HALF_WIDTH = 0.40      # m: the front hoop is welded to a fork yawed ~20 deg, so it spans y 0.03-0.28 about the centre line; the stray wheel is already gone
WHEEL_SIDES = 14                  # teams._motorcycle's own wheel
WRECK_BIKE_DECIMATE = 0.30
#: The two thrown riders' corpses, decimated harder than the crew teams' 0.5.
#: B6 shipped 0.35 at 7,872 tris against the 8,000 team cap; the crew importer
#: at `HEAD` cuts the same figure larger than the file B6 was built from (the
#: living riders are 2 x 2,720 faces now), so the same file read 8,955 with a
#: 1,057-face textured bike. 0.25 -- and the tipped bike at 0.30 -- is what puts
#: the file back under the cap, at 7,903 (0.16 read 7,423: detail left unspent);
#: both are the wreck pose, at 25 px.
CORPSE_DECIMATE = 0.25

#: Where each rider's crotch sits along the bike (metres, +X forward, after
#: the turn). The kit put them at +0.18 / -0.42 on a 1.50 m wheelbase; this
#: bike's saddle runs from about -0.05 to -0.45 and its rear bag starts at
#: -0.45, so both move forward and the pillion's back rests on the bag.
RIDER_X = {"rid": 0.02, "pas": -0.32}
SEAT_LIFT = 0.03                  # crotch above the saddle top
THIGH_FWD_DEG = 75.0              # thigh swung forward from vertical, about the hip
SHIN_BACK_DEG = 70.0              # shin swung back about the moved knee (net 5 deg forward)
RIDER_LEAN_DEG = 12.0             # the rider's upper body, about the crotch; the pillion is upright
GRIP_Y = 0.28                     # half the bar width the hands reach
RIDER_ELBOW = Vector((0.10, 0.04, -0.22))     # elbow target from the shoulder, rider (y outward)
PAS_ELBOW = Vector((0.06, 0.03, -0.26))       # elbow target from the shoulder, pillion
PAS_HAND_ON_KNEE = Vector((0.0, 0.0, 0.04))   # above the knee joint

#: `teams.moto_rpg`'s launcher: (-0.50, -0.17, 1.44) with the pillion at
#: -0.42 -- 0.08 behind him, on his left, at his shoulder. Kept relative.
LAUNCHER_BACK, LAUNCHER_Y, LAUNCHER_ABOVE_SHOULDER = 0.08, -0.17, 0.06
WRECK_RIDERS = (("mw_a", 0.30, -0.42), ("mw_b", -0.32, 0.46))

UPPER_PARTS = ("torso", "hips", "cranium", "face", "neck", "carbine",
               "upperarm0", "upperarm1", "forearm0", "forearm1",
               "deltoid0", "deltoid1", "elbow0", "elbow1", "hip0", "hip1", "kef0", "kef1", "kef2")


def log(msg):
    print(f"[moto] {msg}")


def _coords(ob):
    co = np.empty(len(ob.data.vertices) * 3, dtype=np.float64)
    ob.data.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def _face_centroids(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    cent = np.array([tuple(f.calc_center_median()) for f in bm.faces], dtype=np.float64)
    bm.free()
    return cent


def _transform(ob, mat):
    for v in ob.data.vertices:
        v.co = mat @ v.co


def _rot_about(point, axis, deg):
    p = Vector(point)
    return Matrix.Translation(p) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-p)


# ---------------------------------------------------------------------------
# the bike
# ---------------------------------------------------------------------------

#: Where the saddle top is read (after the turn, +X forward): between the tank
#: and the rear bag.
SADDLE_X = (-0.45, -0.05)
#: The remesh's stray pieces, measured 2026-10-05 on remesh 01a10c69 (see
#: `_prune_bike`): a rear-wheel island whose centroid lies behind this x, and any
#: island whose centroid sits this far to the right of the centre line.
REAR_WHEEL_MAX_X = -0.40
STRAY_DY = 0.15
BARS_MIN_Z = 1.0
#: The bedroll the prompt put "behind the empty saddle" landed ON the saddle
#: (a 1.03 m blob over x -0.55..-0.25, where the pillion sits), so the riders
#: would sit a hand above the seat. Its faces -- the box below, in the turned
#: frame, above the seat line -- are deleted. (x0, x1, |y| max, z min)
BEDROLL_BOX = (-0.62, -0.18, 0.22, 0.90)


def _islands(ob):
    """The connected pieces of the mesh, as lists of polygon indices, largest
    first. Meshy's remesh splits vertices along its UV seams, so connectivity is
    read from vertices merged by position (1e-4), not from vertex indices."""
    me = ob.data
    co = _coords(ob)
    key = {}
    vid = np.empty(len(co), dtype=np.int64)
    for i, p in enumerate(np.round(co / 1e-4).astype(np.int64)):
        vid[i] = key.setdefault(tuple(p), len(key))
    parent = list(range(len(key)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for p in me.polygons:
        r0 = find(int(vid[p.vertices[0]]))
        for i in p.vertices[1:]:
            ri = find(int(vid[i]))
            if ri != r0:
                parent[ri] = r0
    groups = {}
    for p in me.polygons:
        groups.setdefault(find(int(vid[p.vertices[0]])), []).append(p.index)
    return sorted(groups.values(), key=lambda g: -len(g))


def _prune_bike(ob):
    """Clean the textured remesh of what it grew that a bike does not have.

    MEASURED, 2026-10-05, on remesh 01a10c69 (1,440 tris, 12 connected pieces):
    the preview came with a SECOND wheel standing across the front -- a 116-face
    hoop with a mudguard and hub, 0.34 m to the right of the centre line --
    which the 1 Oct bike did not have; the rear wheel is a clean island of its
    own; the handlebar ends are three small islands above z 1.0. So:

      * the largest island is the bike (frame, tank, saddle, panniers, engine,
        exhaust, fork, bars centre and the FRONT wheel, which the remesh welded
        to the fork);
      * the island behind `REAR_WHEEL_MAX_X` and under 0.7 m is the rear wheel:
        it gives the axle, the wheel radius and the centre line (its y mid), and
        is deleted -- the kit wheel replaces it, as it replaced the hoop;
      * every island whose centroid sits `STRAY_DY` right of that centre line is
        the stray wheel assembly, deleted;
      * the whole bike is then shifted so the centre line is y = 0 (the bbox
        centre the old importer used was dragged 0.12 m sideways by the stray
        wheel).

    The front wheel stays in the big island and is cut by `_bike_parts`.
    Returns the info dict (`axles`, `r_wheel`, `bars`)."""
    me = ob.data
    isl = _islands(ob)
    co = _coords(ob)
    cent = _face_centroids(ob)
    main = isl[0]
    rear = [g for g in isl[1:] if cent[g, 0].mean() < REAR_WHEEL_MAX_X and cent[g, 2].mean() < 0.7 and len(g) >= 100]
    if len(rear) != 1:
        raise SystemExit(f"bike: expected one rear-wheel island behind x {REAR_WHEEL_MAX_X}, found {[len(g) for g in rear]} "
                         f"-- re-measure with the island dump")
    rear = rear[0]
    rv = np.unique(np.array([i for p in rear for i in me.polygons[p].vertices]))
    rmn, rmx = co[rv].min(axis=0), co[rv].max(axis=0)
    y0 = float((rmn[1] + rmx[1]) / 2.0)
    r = float((rmx[2] - rmn[2]) / 2.0)
    rear_x = float((rmn[0] + rmx[0]) / 2.0)
    stray = [g for g in isl[1:] if g is not rear and cent[g, 1].mean() < y0 - STRAY_DY]
    doomed = set(rear) | {p for g in stray for p in g}
    bx0, bx1, by, bz = BEDROLL_BOX
    bedroll = {int(i) for i in np.nonzero((cent[:, 0] > bx0) & (cent[:, 0] < bx1) & (np.abs(cent[:, 1] - y0) < by)
                                           & (cent[:, 2] > bz))[0]} - doomed
    doomed |= bedroll
    bars_isl = [g for g in isl[1:] if g is not rear and g not in stray and cent[g, 2].mean() > BARS_MIN_Z]
    bar_c = np.concatenate([cent[g] for g in bars_isl]) if bars_isl else cent[main][cent[main][:, 2] > BARS_MIN_Z]
    mv = np.unique(np.array([i for p in main for i in me.polygons[p].vertices]))
    front_x = float(co[mv, 0].max()) - r
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in doomed], context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    _transform(ob, Matrix.Translation((0.0, -y0, 0.0)))
    log(f"bike: {len(isl)} islands; rear wheel {len(rear)} faces (axle x {rear_x:+.3f}, r {r:.3f}) and "
        f"{len(stray)} stray island(s) ({sum(len(g) for g in stray)} faces) and the bedroll ({len(bedroll)} faces) deleted; "
        f"centre line y0 {y0:+.3f} -> 0; "
        f"front axle x {front_x:+.3f}; {len(ob.data.polygons)} tris left")
    bar_x = float(bar_c[:, 0].mean())
    bar_half = float(max(abs(bar_c[:, 1].max() - y0), abs(bar_c[:, 1].min() - y0)))
    bar_z = float(bar_c[:, 2].mean())
    return {"axles": [(front_x, r), (rear_x, r)], "r_wheel": r, "bars": (bar_x, bar_half, bar_z), "y0": y0}


def _bike_source():
    """`art/meshy/moto-rpg-<yyyymmdd>-<id8>/model.glb` of the LEDGER's last
    `kind: remesh` task named `moto_rpg` -- the same lookup the drone and
    vehicle exporters use, because the bike has two chains in the ledger
    (B6's palette preview + remesh, 1 Oct, and this textured one, 5 Oct) and
    only the ledger says which is current. Slug AND id prefix, since the
    moto-rpg preview and the atgm-post preview of 5 Oct share `01a10c31`."""
    import json
    ledger = os.path.join(REPO, "art", "meshy", "ledger.jsonl")
    task_id = None
    with open(ledger) as fh:
        for line in fh:
            line = line.strip()
            if line:
                entry = json.loads(line)
                if entry.get("kind") == "remesh" and entry.get("name") == BIKE_NAME:
                    task_id = entry["id"]
    if task_id is None:
        raise SystemExit(f"no kind=remesh entry named {BIKE_NAME!r} in {ledger}")
    hits = glob.glob(os.path.join(REPO, "art", "meshy", f"{BIKE_NAME.replace('_', '-')}-*-{task_id.split('-')[0]}",
                                  "model.glb"))
    if len(hits) != 1:
        raise SystemExit(f"expected one download dir for remesh task {task_id}, found {hits}")
    return hits[0], task_id


#: The bike's own material, set by `_load_bike`. A SECOND material in the file,
#: beside the riders' figure atlas -- see "THE BIKE'S BAKE" in the module doc.
_BIKE = {"material": None}


def _retexel_bike_tan(img):
    """Repaint the bike bake's orange texels dusty tan, in place, by the
    BIKE_TAN_* rule (HSV, numpy, deterministic). Refuses if none match."""
    w, h, ch = img.size[0], img.size[1], img.channels
    px = np.empty(w * h * ch, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, ch)
    rgb = px[:, :3]
    mx, mn = rgb.max(axis=1), rgb.min(axis=1)
    c = mx - mn
    d = np.where(c > 1e-6, c, 1.0)
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    hue = np.where(mx == r, ((g - b) / d) % 6.0, np.where(mx == g, (b - r) / d + 2.0, (r - g) / d + 4.0)) * 60.0
    hue = np.where(c > 1e-6, hue, 0.0)
    sat = np.where(mx > 1e-6, c / np.where(mx > 1e-6, mx, 1.0), 0.0)
    m = (hue >= BIKE_TAN_HUE_IN[0]) & (hue <= BIKE_TAN_HUE_IN[1]) & (sat > BIKE_TAN_SAT) & (mx > BIKE_TAN_VAL)
    n = int(m.sum())
    if not n:
        raise SystemExit(f"{TEAM}: no orange texels on {img.name} to repaint tan -- the bike's bake changed; look at it")
    v2 = mx[m] * BIKE_TAN_VAL_GAIN
    s2 = np.minimum(sat[m] * BIKE_TAN_SAT_GAIN, BIKE_TAN_SAT_CAP)
    hh = BIKE_TAN_HUE / 60.0
    f = hh - math.floor(hh)
    i = int(math.floor(hh)) % 6
    p_, q_, t_ = v2 * (1.0 - s2), v2 * (1.0 - s2 * f), v2 * (1.0 - s2 * (1.0 - f))
    rgb_out = [(v2, t_, p_), (q_, v2, p_), (p_, v2, t_), (p_, q_, v2), (t_, p_, v2), (v2, p_, q_)][i]
    rgb[m] = np.stack(rgb_out, axis=1)
    px[:, :3] = rgb
    img.pixels.foreach_set(px.ravel())
    img.update()
    log(f"{img.name}: {n} orange texel(s) of {w * h} ({100.0 * n / (w * h):.1f} %) repainted dusty tan "
        f"(hue {BIKE_TAN_HUE:.0f}, sat x{BIKE_TAN_SAT_GAIN} cap {BIKE_TAN_SAT_CAP}, value x{BIKE_TAN_VAL_GAIN})")


def _load_bike():
    path, task_id = _bike_source()
    before = {o.name for o in bpy.data.objects}
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o.name not in before and o.type == "MESH"]
    if len(new) != 1:
        raise SystemExit(f"bike: expected one mesh object, found {[o.name for o in new]}")
    ob = new[0]
    for o in list(bpy.data.objects):
        if o.name not in before and o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    ob.parent = None
    mats = [m for m in ob.data.materials if m is not None]
    if len(mats) != 1 or not mats[0].use_nodes:
        raise SystemExit(f"bike: expected one node material on the remesh, found {[m.name for m in mats]}")
    tree = mats[0].node_tree
    bsdf = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    link = next((l for l in tree.links if bsdf is not None and l.to_node == bsdf and l.to_socket.name == "Base Color"), None)
    if link is None or link.from_node.type != "TEX_IMAGE" or link.from_node.image is None:
        raise SystemExit("bike: Base Color is not an image -- no bake to ship")
    base = link.from_node.image
    # Keep exactly the base colour, as `crew._keep_base_color` does for a figure:
    # drop every other texture node and its image.
    for node in list(tree.nodes):
        if node.type == "TEX_IMAGE" and node.image is not base:
            img = node.image
            tree.nodes.remove(node)
            if img is not None and img.users == 0:
                bpy.data.images.remove(img)
    for other in list(bpy.data.images):
        if other is not base and other.users == 0:
            bpy.data.images.remove(other)
    base.name = BIKE_IMAGE
    mats[0].name = "bike_material"
    _BIKE["material"] = mats[0]
    if not ob.data.uv_layers:
        raise SystemExit("bike: the remesh carries no UV layer")
    log(f"bike: {os.path.relpath(path, REPO)} (remesh {task_id}); {BIKE_IMAGE} {base.size[0]}x{base.size[1]}")
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for k in list(ob.keys()):
        if k != "_RNA_UI":
            del ob[k]
    co = _coords(ob)
    mn, mx = co.min(axis=0), co.max(axis=0)
    size = mx - mn
    if size[0] < size[1]:
        raise SystemExit(f"bike: long axis is Y ({size}), this file measured X -- look before turning")
    L = size[0]
    # The front is the wider end (bars): compare |y| in the first and last 40%.
    y_lo = np.abs(co[co[:, 0] < mn[0] + 0.4 * L, 1]).max()
    y_hi = np.abs(co[co[:, 0] > mx[0] - 0.4 * L, 1]).max()
    front_at_min_x = y_lo > y_hi
    log(f"bike: {len(ob.data.polygons)} tris, length {L:.3f} units, |y| front-end {y_lo:.3f} vs rear-end {y_hi:.3f} "
        f"-> front at {'-X (turning 180)' if front_at_min_x else '+X'}")
    k = BIKE_LENGTH / L
    rot = Matrix.Rotation(math.pi, 4, "Z") if front_at_min_x else Matrix.Identity(4)
    centre = Vector(((mn[0] + mx[0]) / 2.0, (mn[1] + mx[1]) / 2.0, mn[2]))
    m = Matrix.Scale(k, 4) @ rot @ Matrix.Translation(-centre)
    _transform(ob, m)
    info = _prune_bike(ob)
    co = _coords(ob)
    r = info["r_wheel"]
    # The saddle top: the highest point in the band between the axles, behind the tank.
    sad = (co[:, 0] < SADDLE_X[1]) & (co[:, 0] > SADDLE_X[0]) & (np.abs(co[:, 1]) < 0.15)
    info["saddle_z"] = float(co[sad, 2].max()) if sad.sum() else 0.85
    log(f"bike: saddle band holds {int(sad.sum())} verts, top z {info['saddle_z']:.3f}")
    log(f"bike: scaled x{k:.3f}; axles {[(round(a, 3), round(z, 3)) for a, z in info['axles']]} r {r:.3f}; "
        f"saddle top z {info['saddle_z']:.3f}; bars at x {info['bars'][0]:.2f} |y| {info['bars'][1]:.2f} z {info['bars'][2]:.2f}")
    ob.name = "bike_src"
    return ob, info


def _keep_only(ob, keep_idx):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep_idx], context="FACES")
    bm.to_mesh(ob.data)
    bm.free()


def _piece(src, name, role, faces):
    bpy.ops.object.select_all(action="DESELECT")
    src.select_set(True)
    bpy.context.view_layer.objects.active = src
    bpy.ops.object.duplicate()
    ob = bpy.context.object
    ob.name = name
    ob.data.name = name
    _keep_only(ob, faces)
    ob.data.validate(verbose=False)
    for k in list(ob.keys()):
        if k != "_RNA_UI":
            del ob[k]
    ob["rl_role"] = role
    return ob


def _bike_borrow_uv(ob, src, near):
    """Give a UV-less kit wheel the bike's material and ONE uv -- the centroid
    uv of the bike face nearest `near` (the tyre tread) -- so it takes the
    tyre's own rubber texel. The bike-bake twin of `crew._borrow_uv`, which
    reads the riders' figure material and cannot be pointed at this one."""
    me_s = src.data
    uv_s = me_s.uv_layers.active.data
    cent = _face_centroids(src)
    i = int(np.argmin(((cent - np.array(near, dtype=np.float64)) ** 2).sum(axis=1)))
    poly = me_s.polygons[i]
    uv = np.mean([uv_s[l].uv[:] for l in poly.loop_indices], axis=0)
    me = ob.data
    layer = me.uv_layers.active if me.uv_layers else me.uv_layers.new(name="UVMap")
    for loop in layer.data:
        loop.uv = uv
    me.materials.clear()
    me.materials.append(_BIKE["material"])
    return tuple(round(float(c), 3) for c in uv)


def _bike_parts(src, info, prefix):
    """The remesh as ONE `metal` piece with the hoop wheels cut out, plus kit
    cylinder wheels on the measured axles, also `metal`, textured through the
    bike's own bake. Returns (frame parts, wheel parts).

    ONE role, not three. The palette bike split `metal` / `webbing` / `weapon`
    (frame / saddle and bag / tyres) so the faction ramp could colour them; the
    bake carries every colour now, and `weapon` is the one role a bike piece
    may NOT sit in: the launcher is a `weapon` part too, and a role whose
    pieces sit on two materials exports as `weapon_1`/`weapon_2`, which the
    loader maps to nothing (`import_meshy_crew_team.py`, "WHY AN ATLAS"). The
    riders use boot/face/keffiyeh/uniform only, so `metal` is the bike's alone.
    A single role is also one skinned draw call where the palette bike was
    three -- the bottleneck `CLAUDE.md` names for rigged units."""
    cent = _face_centroids(src)
    r_cut = info["r_wheel"] + WHEEL_CUT_MARGIN      # just past the ring's own outer edge
    in_wheel = np.zeros(len(cent), dtype=bool)
    for ax, az in info["axles"]:
        in_wheel |= ((cent[:, 0] - ax) ** 2 + (cent[:, 2] - az) ** 2 < r_cut ** 2) & (np.abs(cent[:, 1]) < WHEEL_CUT_HALF_WIDTH)
    keep = ~in_wheel
    parts = [_piece(src, f"{prefix}_frame", "metal", set(np.nonzero(keep)[0]))]
    log(f"{prefix}: frame {int(keep.sum())} faces metal, {int(in_wheel.sum())} wheel-disc faces cut")
    wheels = []
    for i, (ax, az) in enumerate(info["axles"]):
        w = kit.tube(f"{prefix}_wheel{i}", WHEEL_WIDTH, info["r_wheel"], (ax, 0.0, az),
                     yaw=math.radians(90.0), sides=WHEEL_SIDES, role="metal")
        uv = _bike_borrow_uv(w, src, (ax, 0.0, az - info["r_wheel"] * 0.9))
        if prefix == "m":
            log(f"{prefix}: wheel{i} takes the bike's tyre texel uv {uv}")
        wheels.append(w)
    return parts, wheels


# ---------------------------------------------------------------------------
# a rider
# ---------------------------------------------------------------------------

def _aim_segment(parts, names, pivot, tip, target):
    """Rotate the parts rigidly about `pivot` so the direction pivot->tip
    becomes pivot->target. Returns the moved tip."""
    d0 = (Vector(tip) - Vector(pivot)).normalized()
    d1 = (Vector(target) - Vector(pivot)).normalized()
    q = d0.rotation_difference(d1)
    m = Matrix.Translation(Vector(pivot)) @ q.to_matrix().to_4x4() @ Matrix.Translation(-Vector(pivot))
    for n in names:
        if n in parts:
            _transform(parts[n], m)
    return m @ Vector(tip)


def _rider(src, height, prefix, x, info, lean_deg, hands):
    """One seated rider at x along the bike. `hands` is "bars" or "knees"."""
    parts, joints = crew.cut_figure(src, height, prefix)
    zc = joints["crotch"]
    seat_z = info["saddle_z"] + SEAT_LIFT
    dz = seat_z - zc
    up = Matrix.Translation((0.0, 0.0, dz))
    for n in list(parts):
        if n in UPPER_PARTS or n.startswith("kef"):
            _transform(parts[n], up)
    knees, boots = {}, {}
    for side in (0, 1):
        lx, ly = joints["leg"][side]
        hip = Vector((lx, ly, zc))
        m_thigh = up @ _rot_about(hip, "Y", -THIGH_FWD_DEG)
        knee = m_thigh @ Vector((lx, ly, joints["knee"]))
        m_shin = _rot_about(knee, "Y", SHIN_BACK_DEG) @ m_thigh
        for n in (f"thigh{side}", f"hip{side}", f"knee{side}"):
            _transform(parts[n], m_thigh)
        for n in (f"calf{side}", f"boot{side}"):
            _transform(parts[n], m_shin)
        knees[side] = knee
        boots[side] = m_shin @ Vector((lx, ly, joints["ankle"]))
    # Upper body lean about the crotch (now at seat_z), the legs stay.
    if lean_deg:
        lean = _rot_about((0.0, 0.0, seat_z), "Y", -lean_deg)
        for n in list(parts):
            if n in UPPER_PARTS or n.startswith("kef"):
                _transform(parts[n], lean)
    else:
        lean = Matrix.Identity(4)
    # Arms: the hung upper arm swung to an elbow target, the forearm from
    # there to the hand target (the grip or the knee).
    for side in (0, 1):
        sgn = -1.0 if side == 0 else 1.0
        a = joints["arm"][side]
        sh = lean @ up @ Vector(a["shoulder"])
        el = lean @ up @ Vector(a["elbow"])
        wr = lean @ up @ Vector(a["wrist"])
        if hands == "bars":
            bx, by, bz = info["bars"]
            grip = Vector((bx - x - 0.02, sgn * min(by, GRIP_Y), bz))
            e_target = sh + Vector((RIDER_ELBOW.x, sgn * RIDER_ELBOW.y, RIDER_ELBOW.z))
        else:
            grip = knees[side] + PAS_HAND_ON_KNEE
            e_target = sh + Vector((PAS_ELBOW.x, sgn * PAS_ELBOW.y, PAS_ELBOW.z))
        el2 = _aim_segment(parts, [f"upperarm{side}", f"elbow{side}"], sh, el, e_target)
        # the forearm moved with the upper arm's rotation first (it is attached at the elbow)
        d0 = (el - sh).normalized()
        d1 = (e_target - sh).normalized()
        q = d0.rotation_difference(d1)
        m_up = Matrix.Translation(sh) @ q.to_matrix().to_4x4() @ Matrix.Translation(-sh)
        _transform(parts[f"forearm{side}"], m_up)
        wr2 = m_up @ wr
        _aim_segment(parts, [f"forearm{side}"], el2, wr2, grip)
        log(f"{prefix}: arm{side} shoulder z {sh.z:.2f} elbow -> ({e_target.x:+.2f}, {e_target.y:+.2f}, {e_target.z:.2f}) "
            f"hand -> ({grip.x:+.2f}, {grip.y:+.2f}, {grip.z:.2f})")
    shoulder_z = max(joints["arm"][s]["shoulder"][2] for s in (0, 1)) + dz
    place = Matrix.Translation((x, 0.0, 0.0))
    for ob in parts.values():
        _transform(ob, place)
    allco = np.concatenate([_coords(o) for o in parts.values()])
    log(f"{prefix}: seated at x {x:+.2f}, crotch z {seat_z:.2f}, boots z {min(b.z for b in boots.values()):.2f}, "
        f"top z {allco[:, 2].max():.2f}, {sum(len(o.data.polygons) for o in parts.values())} faces")
    return list(parts.values()), shoulder_z


# ---------------------------------------------------------------------------
# the file
# ---------------------------------------------------------------------------

def _bone_table(info, seats):
    (fx, fz), (rx, rz) = info["axles"]
    return [
        ("m_root", None, (0.0, 0.0, 0.0), (0.0, 0.0, 0.30)),
        ("m_wheel0", "m_root", (fx, 0.0, fz), (fx, 0.15, fz)),
        ("m_wheel1", "m_root", (rx, 0.0, rz), (rx, 0.15, rz)),
        ("m_launcher", "m_root", seats["launcher"], (seats["launcher"][0], seats["launcher"][1], seats["launcher"][2] + 0.15)),
        ("rid_seat", "m_root", (RIDER_X["rid"], 0.0, seats["z"]), (RIDER_X["rid"] + 0.05, 0.0, seats["z"] + 0.5)),
        ("pas_seat", "m_root", (RIDER_X["pas"], 0.0, seats["z"]), (RIDER_X["pas"] + 0.05, 0.0, seats["z"] + 0.5)),
        rig._death_root_bone("mw", 0.0, 0.0),
        rig._death_root_bone("mw_a", WRECK_RIDERS[0][1], WRECK_RIDERS[0][2]),
        rig._death_root_bone("mw_b", WRECK_RIDERS[1][1], WRECK_RIDERS[1][2]),
    ]


def _decimate(ob, ratio):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(ob.data)
    bm.free()
    mod = ob.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    ob.data.validate(verbose=False)


def _one_material_per_role(merged):
    """Fail the build if any role mesh would export as more than one primitive.

    A role whose faces sit on two materials -- or on one material and none --
    exports as `weapon_1` / `weapon_2`, which the loader maps to nothing and
    which draws as nothing (`import_meshy_crew_team.py`, "WHY AN ATLAS"). The
    bike now brings a SECOND material beside the riders' atlas, so the hazard is
    live here: the old palette bike sat in `weapon` beside the launcher with no
    material at all, and a textured wheel left in `weapon` beside that launcher
    would split the role without any other error."""
    for role, ob in merged.items():
        mats = ob.data.materials
        used = {mats[p.material_index].name if p.material_index < len(mats) and mats[p.material_index] is not None
                else None for p in ob.data.polygons}
        if len(used) > 1:
            raise SystemExit(f"role {role!r} would export as {len(used)} primitives (materials {sorted(map(str, used))}) "
                             f"-- two materials in one role is `{role}_1`/`{role}_2`, which nothing maps")
    log("every role mesh sits on exactly one material (or none)")


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    crew._TEX["material"] = None
    crew._TEX.pop("atlas", None)
    crew._TEAM["id"] = TEAM
    crew._BLOB_KW_ACTIVE.clear()
    crew._BLOB_KW_ACTIVE.update(crew.BLOB_KW.get(TEAM, {}))
    fig, height = crew._load_figure(TEAM)          # the rider figure, textured
    # A3.1 stage 2 (the RPG): the textured Meshy RPG-7 (`export_meshy_rpg.py`,
    # `crew.PART_SPECS["rpg_launcher"]`) composed into the RIDERS' atlas --
    # figure left, RPG right, one material -- exactly as rpg_team does.
    rpg, rpg_img = crew._load_hand_part(TEAM, "rpg_launcher")
    crew._normalise_part(TEAM, "rpg_launcher", rpg)
    crew._compose_atlas(TEAM, fig, [(rpg, rpg_img)])
    crew._HAND.clear()
    crew._HAND["rpg_launcher"] = rpg
    bike, info = _load_bike()

    parts, forced = [], {}
    frame, wheels = _bike_parts(bike, info, "m")
    for ob in frame:
        forced[ob] = "m_root"
    for i, ob in enumerate(wheels):
        forced[ob] = f"m_wheel{i}"
    parts += frame + wheels

    rider, _sh = _rider(fig, height, "rid", RIDER_X["rid"], info, RIDER_LEAN_DEG, "bars")
    forced.update({ob: "rid_seat" for ob in rider})
    parts += rider
    pas, pas_shoulder_z = _rider(fig, height, "pas", RIDER_X["pas"], info, 0.0, "knees")
    forced.update({ob: "pas_seat" for ob in pas})
    parts += pas

    launcher_at = (RIDER_X["pas"] - LAUNCHER_BACK, LAUNCHER_Y, pas_shoulder_z + LAUNCHER_ABOVE_SHOULDER)
    # The Meshy RPG along the axis kit's tube drew: from the kit bell's rear
    # face (`at` - 0.5856 L-units back along the pitched bore) to its muzzle
    # (the tube centre 0.20 behind `at`, plus half its 1.18 m), bell rear on
    # the bell rear, muzzle toward the kit muzzle, the bore's up toward +z.
    p_, c_ = rig.MOTO_LAUNCH_PITCH, math.cos(math.pi)
    D = Vector((math.cos(p_) * c_, 0.0, math.sin(p_)))
    at_v = Vector(launcher_at)
    rear = at_v - D * (0.42 * 1.18 + 0.09)
    front = at_v + Vector((0.20 * c_, 0.0, 0.0)) + D * (1.18 / 2.0)
    d = (front - rear).normalized()
    w = (Vector((0.0, 0.0, 1.0)) - d * d.z).normalized()
    v = w.cross(d)
    launcher = [crew._part_copy("rpg_launcher", "pas_rpg")]
    M = Matrix(((d.x, v.x, w.x, rear.x), (d.y, v.y, w.y, rear.y), (d.z, v.z, w.z, rear.z), (0.0, 0.0, 0.0, 1.0)))
    _transform(launcher[0], M)
    bpy.data.objects.remove(rpg, do_unlink=True)
    crew._HAND.clear()
    forced.update({ob: "m_launcher" for ob in launcher})
    parts += launcher
    log(f"launcher at {tuple(round(c, 3) for c in launcher_at)} (pillion shoulder z {pas_shoulder_z:.3f})")

    # The wreck: the same bike tipped over (teams._tip_over, the kit's own
    # call), decimated once; two posed corpses.
    wframe, wwheels = _bike_parts(bike, info, "mw")
    for ob in wframe:
        _decimate(ob, WRECK_BIKE_DECIMATE)
    teams._tip_over(wframe + wwheels)
    forced.update({ob: "mw_death_root" for ob in wframe + wwheels})
    parts += wframe + wwheels
    crew.CORPSE_DECIMATE = CORPSE_DECIMATE
    for prefix, x, y in WRECK_RIDERS:
        body = crew._death_parts_posed(fig, height, prefix, x, y, add_kef=False)
        forced.update({ob: f"{prefix}_death_root" for ob in body})
        parts += body
    bpy.data.objects.remove(fig, do_unlink=True)
    bpy.data.objects.remove(bike, do_unlink=True)

    seats = {"z": info["saddle_z"], "launcher": launcher_at}
    bones = _bone_table(info, seats)
    if os.environ.get("MOTO_DEBUG"):
        for ob in sorted(parts, key=lambda o: o.name):
            c = _coords(ob)
            log(f"  part {ob.name:22s} role {ob.get('rl_role'):8s} x {c[:, 0].min():+.2f}..{c[:, 0].max():+.2f} "
                f"y {c[:, 1].min():+.2f}..{c[:, 1].max():+.2f} z {c[:, 2].min():+.2f}..{c[:, 2].max():+.2f} -> {forced.get(ob)}")
    arm_obj = rig.build_armature(bones)
    rig.rig_parts(parts, arm_obj, forced, {"m", "rid", "pas", "mw", "mw_a", "mw_b"})
    merged = rig.join_by_role(parts)
    _one_material_per_role(merged)
    rig.build_clips(arm_obj, TEAM)
    img = bpy.data.images["base_color"]
    before = tuple(img.size)
    cap_w, cap_h = crew._TEX.get("atlas") or (crew.TEXTURE_PX, crew.TEXTURE_PX)   # the riders' + RPG atlas
    if img.size[0] > cap_w or img.size[1] > cap_h:
        img.scale(min(img.size[0], cap_w), min(img.size[1], cap_h))
    bike_img = bpy.data.images[BIKE_IMAGE]
    bike_before = tuple(bike_img.size)
    if bike_img.size[0] > BIKE_TEXTURE_PX or bike_img.size[1] > BIKE_TEXTURE_PX:
        bike_img.scale(min(bike_img.size[0], BIKE_TEXTURE_PX), min(bike_img.size[1], BIKE_TEXTURE_PX))
    _retexel_bike_tan(bike_img)
    log(f"base_color {before} -> {tuple(img.size)}; {BIKE_IMAGE} {bike_before} -> {tuple(bike_img.size)}; "
        f"images {[i.name for i in bpy.data.images]}")
    for role, ob in merged.items():
        has = any(m is not None for m in ob.data.materials)
        log(f"  role {role:9s} material {'yes' if has else 'no '} uv {'yes' if ob.data.uv_layers else 'no '} "
            f"{len(ob.data.polygons)} tris")
    stray = [o.name for o in bpy.data.objects if o is not arm_obj and o not in merged.values()]
    if stray:
        raise SystemExit(f"{TEAM}: objects in the scene that are neither the rig nor a role mesh: {stray}")
    rig.export_glb(arm_obj, OUT_PATH, materials=True, jpeg_quality=crew.JPEG_QUALITY)
    tris = sum(len(ob.data.polygons) for ob in merged.values())
    log(f"{TEAM}: wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes), roles {sorted(merged)}, {tris} tris, "
        f"clips {[a.name for a in bpy.data.actions]}")


if __name__ == "__main__":
    build()
