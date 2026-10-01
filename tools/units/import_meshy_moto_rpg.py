"""Build `art/meshes/moto_rpg.glb` from a Meshy motorcycle and B3's rpg_team
figure re-posed seated, on rig.py's own moto topology.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/units/import_meshy_moto_rpg.py

WP-A3.1 (GH-179) batch B6, 2026-10-01 -- `docs/art/meshy-prompts-units.md`
§17, style bible §6 B6 ("the bike is a 25-credit vehicle part; its riders are
B3's rigged figures re-posed seated"). Owner of the file in
`rig.TEAM_MESH_OWNER`, so `export_mesh_team.py -- all` skips it.

SOURCES

  the bike     art/meshy/moto-rpg-20261001-01a0f631/model.glb -- Meshy
               text-to-3d preview 01a0f62f-c542-709f-a687-4c7c07808be6 (no
               pose, no refine: a palette part), REMESH
               01a0f631-... at 1,500 tris. Zero materials ship: the remesh's
               normal map is dropped and the bike takes the enemy ramp.
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
end -- |y| 0.18 L at 0.35-0.40 of the length against 0.11 L for the rear
bag; the thumbnail agrees), so it takes one 180-degree Z turn, as the gun
truck did. Scaled so its length is `BIKE_LENGTH` (teams._motorcycle's 2.2 m),
tyres on z = 0, origin at the bbox centre on the ground. Measured on the
preview (969k tris) and re-measured on the remesh: wheel centres at 0.27 and
0.70 of the length, z 0.19 L; wheel top 0.30 L, so the radius is 0.15 L; the
saddle top ~0.40 L between 0.50 and 0.65 of the length; the bars at 0.35-0.40
of the length, z 0.54 L.

**The remesh's wheels are hoops** -- 1,500 tris cannot keep spokes -- so the
faces inside each wheel disc are deleted and `kit.tube` wheels (14-segment
solid cylinders, the kit bike's own wheel, `weapon` role as kit's tyres are)
are stood on the measured axles and bound to the wheel bones. A spinning
hoop reads as a flicker at 25 px; a spinning cylinder reads as a wheel.

Roles on the bike: `weapon` the kit tyres; `webbing` the saddle and the rear
bag (face centroids in the measured boxes); `metal` the rest. No UVs, no
material: the loader paints these from the faction ramp beside the textured
riders (`buildMeshUnitTemplate` decides per mesh -- B0b).

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
BIKE_SRC = os.path.join(REPO, "art", "meshy", "moto-rpg-*-01a0f631", "model.glb")

BIKE_LENGTH = 2.2                 # teams._motorcycle: "The machine: 2.2 m long"
WHEEL_WIDTH = 0.10
WHEEL_SIDES = 14                  # teams._motorcycle's own wheel
WRECK_BIKE_DECIMATE = 0.45
#: The two thrown riders' corpses, decimated harder than the crew teams'
#: 0.5: a file carrying a bike, a tipped bike, two seated 2,000-tri men and
#: two corpses read 8,110 tris at 0.5 against the 8,000 team cap.
CORPSE_DECIMATE = 0.35

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

def _load_bike():
    hits = sorted(glob.glob(BIKE_SRC))
    if len(hits) != 1:
        raise SystemExit(f"expected exactly one bike source at {BIKE_SRC}, found {hits}")
    before = {o.name for o in bpy.data.objects}
    bpy.ops.import_scene.gltf(filepath=hits[0])
    new = [o for o in bpy.data.objects if o.name not in before and o.type == "MESH"]
    if len(new) != 1:
        raise SystemExit(f"bike: expected one mesh object, found {[o.name for o in new]}")
    ob = new[0]
    ob.data.materials.clear()
    for img in list(bpy.data.images):
        if img.users == 0 and img.name != "base_color":
            bpy.data.images.remove(img)
    for uv in list(ob.data.uv_layers):
        ob.data.uv_layers.remove(uv)
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
    co = _coords(ob)
    # Axles from the GROUND CONTACT: the tyre bottoms are the only points
    # under z = 0.04 and sit directly below the axles (a low-band centroid
    # was dragged 0.26 m inward by the engine -- measured, 2026-10-01). The
    # radius is half the tyre's top in the column above that x (the
    # mudguards sit above 0.80 on this bike); the axle is one radius up.
    ground = co[co[:, 2] < 0.04]
    info = {"axles": []}
    r = 0.0
    for sel in (ground[:, 0] > 0, ground[:, 0] < 0):
        ax = float(ground[sel, 0].mean())
        col = co[(np.abs(co[:, 0] - ax) < 0.05) & (np.abs(co[:, 1]) < 0.10) & (co[:, 2] < 0.80)]
        r = max(r, float(col[:, 2].max()) / 2.0)
        info["axles"].append(ax)
    info["axles"] = [(ax, r) for ax in info["axles"]]
    info["r_wheel"] = r
    # The saddle top: the highest point in the band between the axles, behind the tank.
    sad = (co[:, 0] < -0.05) & (co[:, 0] > -0.45) & (np.abs(co[:, 1]) < 0.15)
    info["saddle_z"] = float(co[sad, 2].max()) if sad.sum() else 0.85
    # The bars: the widest band in the front half, its grip height and reach.
    front = co[:, 0] > 0.1
    yi = int(np.argmax(np.abs(co[front, 1])))
    bar = co[front][yi]
    info["bars"] = (float(bar[0]), float(abs(bar[1])), float(bar[2]))
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


def _bike_parts(src, info, prefix):
    """The remesh split by role with the hoop wheels cut out, plus kit
    cylinder wheels on the measured axles. Returns (frame parts, wheel parts)."""
    cent = _face_centroids(src)
    r_cut = info["r_wheel"] + 0.03      # just past the ring's own outer edge
    in_wheel = np.zeros(len(cent), dtype=bool)
    for ax, az in info["axles"]:
        in_wheel |= ((cent[:, 0] - ax) ** 2 + (cent[:, 2] - az) ** 2 < r_cut ** 2) & (np.abs(cent[:, 1]) < 0.14)
    saddle = ((cent[:, 0] < -0.02) & (cent[:, 0] > -0.46) & (np.abs(cent[:, 1]) < 0.16)
              & (cent[:, 2] > info["saddle_z"] - 0.10))
    bag = (cent[:, 0] < -0.46) & (cent[:, 2] > 0.70) & (np.abs(cent[:, 1]) < 0.25)
    soft = (saddle | bag) & ~in_wheel
    hard = ~soft & ~in_wheel
    parts = [_piece(src, f"{prefix}_frame", "metal", set(np.nonzero(hard)[0]))]
    if soft.sum():
        parts.append(_piece(src, f"{prefix}_soft", "webbing", set(np.nonzero(soft)[0])))
    log(f"{prefix}: frame {int(hard.sum())} faces metal, saddle+bag {int(soft.sum())} webbing, "
        f"{int(in_wheel.sum())} hoop-wheel faces cut")
    wheels = []
    for i, (ax, az) in enumerate(info["axles"]):
        wheels.append(kit.tube(f"{prefix}_wheel{i}", WHEEL_WIDTH, info["r_wheel"], (ax, 0.0, az),
                              yaw=math.radians(90.0), sides=WHEEL_SIDES, role="weapon"))
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


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    crew._TEX["material"] = None
    crew._TEAM["id"] = TEAM
    crew._BLOB_KW_ACTIVE.clear()
    crew._BLOB_KW_ACTIVE.update(crew.BLOB_KW.get(TEAM, {}))
    fig, height = crew._load_figure(TEAM)          # the rider figure, textured
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
    launcher = kit.launcher("pas_rpg", launcher_at, yaw=math.pi, pitch=rig.MOTO_LAUNCH_PITCH,
                            length=1.18, radius=0.075)
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
    rig.build_clips(arm_obj, TEAM)
    img = bpy.data.images["base_color"]
    before = tuple(img.size)
    if img.size[0] > crew.TEXTURE_PX or img.size[1] > crew.TEXTURE_PX:
        img.scale(min(img.size[0], crew.TEXTURE_PX), min(img.size[1], crew.TEXTURE_PX))
    log(f"base_color {before} -> {tuple(img.size)}; images {[i.name for i in bpy.data.images]}")
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
