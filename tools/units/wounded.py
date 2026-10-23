"""The wounded (GH-707 P2): `wounded_kdf` and `wounded_sarim`, one man each.

A casualty lies on his front, head toward +x, and has no weapon. The geometry is
`kit.casualty` (the same proportions, headgear and loadout vocabulary as every
other kit figure, with a joint where a limb bends); this module is the armature
and the four clips, authored as tables in code like every other team in
`rig.py` -- no hand-posing in a .blend, no weights, one part to one bone.

    down         lying, a slow breath (3 s loop)
    idleWounded  lying, the right hand pressed to the flank, a slow breath
                 (4 s loop)
    crawl        on the elbows, one knee drawn up (1.5 s loop)
    wreck        still; a dead man

**The crawl is authored at the ground speed the unit declares, because nothing
at runtime will rate-match it.** `LOCOMOTION_CLIPS` is `move`/`moveFire`, so a
`crawl` plays at timeScale 1; the clip must therefore already cover the ground
at `mobility.speed_tiles_s` x 3 m = 0.36 m/s. A hand on the ground is planted
for half the cycle and slides back along the body in that time, so with a 1.5 s
cycle it is carried back 0.36 x 0.75 = 0.27 m (`CRAWL_PULL_M`), and the
contact phase is a straight line at exactly that rate. `crawl_probe` in this
module measures it back off the evaluated mesh (see `main`'s printout).

**Nothing goes under the ground.** A torso rolled onto its side, a knee driven
down, a head turned: any of them can sink a few millimetres. After the keys are
set, every frame of every clip is evaluated and the `root` bone is lifted so the
lowest vertex sits `SEAT_M` (1 mm) above z = 0 (`_lift_to_ground`), keyed per
frame, so the figure is seated on the ground in every pose rather than hoped to
be. `tools/src/mesh_wounded.test.ts` re-reads the shipped bytes to hold it.
"""
import math

import bpy
from mathutils import Vector

import kit

#: Bone prefix of the single figure in each file. `rl_figures` names it.
PREFIX = "w0"

#: team id -> (headgear, loadout), the same two switches `kit.figure` takes.
WOUNDED_TEAMS = {
    "wounded_kdf": ("helmet", "regular"),
    "wounded_sarim": ("keffiyeh", "irregular"),
}

#: unit speed (data/units/*/wounded_*.json `mobility.speed_tiles_s`) x 3 m a tile.
SPEED_TILES_S = 0.12
TILE_M = 3.0
CRAWL_SPEED_MS = SPEED_TILES_S * TILE_M

FPS = 24
DOWN_FRAMES = 72          # 3.0 s
WOUNDED_FRAMES = 96       # 4.0 s
CRAWL_FRAMES = 36         # 1.5 s
CRAWL_CYCLE_S = CRAWL_FRAMES / FPS
#: How far a planted hand travels back along the body in the half cycle it is on the ground.
CRAWL_PULL_M = CRAWL_SPEED_MS * CRAWL_CYCLE_S / 2.0

#: Rest geometry of the arms, from `kit.casualty` (shoulder, elbow, wrist; metres). The y of
#: the elbow and wrist, and of the legs, is per side (`kit.CASUALTY_POSE`); `_use_pose` sets
#: it for the team being built.
SHOULDER_X, SHOULDER_Y = 0.52, 0.190
ELBOW_X = 0.30
WRIST_X = 0.58
ELBOW_Y = WRIST_Y = 0.0
LEGS = {}


def _use_pose(team_id):
    global ELBOW_Y, WRIST_Y, LEGS
    pose = kit.CASUALTY_POSE[WOUNDED_TEAMS[team_id][1]]
    ELBOW_Y, WRIST_Y, LEGS = pose["elbow_y"], pose["wrist_y"], pose["legs"]

#: The lowest vertex of any clip sits at least this far above z = 0: 1 mm of
#: cushion, so the glTF's float32 quantisation and a reader's own skinning
#: arithmetic cannot put a vertex a hair under the ground.
SEAT_M = 0.001

Z = Vector((0.0, 0.0, 1.0))
X = Vector((1.0, 0.0, 0.0))
Y = Vector((0.0, 1.0, 0.0))


def _bone_table():
    """name, parent, head, tail -- all along the ground, +x forward. Index 0 is
    the left side (-y), 1 the right, as `kit.casualty` builds them."""
    p = PREFIX
    t = [
        (f"{p}_root", None, (0.0, 0.0, 0.0), (0.0, 0.0, 0.15)),
        (f"{p}_pelvis", f"{p}_root", (-0.08, 0.0, 0.10), (0.04, 0.0, 0.10)),
        (f"{p}_spine", f"{p}_pelvis", (0.04, 0.0, 0.11), (0.56, 0.0, 0.11)),
        (f"{p}_neck", f"{p}_spine", (0.56, 0.0, 0.11), (0.68, 0.0, 0.112)),
        (f"{p}_head", f"{p}_neck", (0.68, 0.0, 0.112), (0.90, 0.0, 0.112)),
    ]
    for side, sgn in (("L", -1.0), ("R", 1.0)):
        t += [
            (f"{p}_upperarm_{side}", f"{p}_spine",
             (SHOULDER_X, sgn * SHOULDER_Y, 0.100), (ELBOW_X, sgn * ELBOW_Y, 0.072)),
            (f"{p}_forearm_{side}", f"{p}_upperarm_{side}",
             (ELBOW_X, sgn * ELBOW_Y, 0.072), (WRIST_X + 0.05, sgn * WRIST_Y, 0.056)),
        ]
    for side in ("L", "R"):
        y0, y1, y2 = LEGS[side]
        t += [
            (f"{p}_thigh_{side}", f"{p}_pelvis", (-0.06, y0, 0.088), (-0.50, y1, 0.068)),
            (f"{p}_shin_{side}", f"{p}_thigh_{side}", (-0.50, y1, 0.068), (-0.99, y2, 0.056)),
        ]
    return t


def rest(team_id):
    """parts, bone_table, forced_bone for `rig.build_team_rest`."""
    headgear, loadout = WOUNDED_TEAMS[team_id]
    _use_pose(team_id)
    kit.new_scene()
    parts = kit.casualty(PREFIX, headgear=headgear, loadout=loadout)
    return parts, _bone_table(), {}


# --- posing -------------------------------------------------------------------

def _rig():
    import rig
    return rig


def _bone(arm_obj, name):
    return arm_obj.data.bones[f"{PREFIX}_{name}"], arm_obj.pose.bones[f"{PREFIX}_{name}"]


def _pose(arm_obj, frame, **named):
    """Key one or more bones at `frame`. Each value is a list of (axis, angle)
    composed into ONE quaternion (a second bare key on a bone/frame would
    replace, not compose -- rig.py's own warning)."""
    rig = _rig()
    for name, axis_angles in named.items():
        b, pb = _bone(arm_obj, name)
        rig.key_axes(pb, b, axis_angles, frame)


def _two_link(shoulder, l1, l2, target, outward):
    """Planar two-link IK. Returns (angle of upper segment, angle of forearm),
    each the direction angle in the ground plane (atan2 of y over x). `outward`
    is the sign of y the elbow should bulge toward."""
    sx, sy = shoulder
    tx, ty = target
    dx, dy = tx - sx, ty - sy
    d = math.hypot(dx, dy)
    d = min(max(d, abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4)
    phi = math.atan2(dy, dx)
    cos_a = (l1 * l1 + d * d - l2 * l2) / (2.0 * l1 * d)
    a = math.acos(max(-1.0, min(1.0, cos_a)))
    best = None
    for s in (+1.0, -1.0):
        a1 = phi + s * a
        ex, ey = sx + l1 * math.cos(a1), sy + l1 * math.sin(a1)
        score = ey * outward
        if best is None or score > best[0]:
            best = (score, a1, ex, ey)
    _, a1, ex, ey = best
    # forearm points at the target from the elbow (recomputed so the pair closes)
    a2 = math.atan2(ty - ey, tx - ex)
    return a1, a2


def _arm_geometry(sgn):
    sh = (SHOULDER_X, sgn * SHOULDER_Y)
    el = (ELBOW_X, sgn * ELBOW_Y)
    wr = (WRIST_X + 0.05, sgn * WRIST_Y)   # the bone tail: the forearm reaches the hand
    l1 = math.hypot(el[0] - sh[0], el[1] - sh[1])
    l2 = math.hypot(wr[0] - el[0], wr[1] - el[1])
    a1 = math.atan2(el[1] - sh[1], el[0] - sh[0])
    a2 = math.atan2(wr[1] - el[1], wr[0] - el[0])
    return sh, l1, l2, a1, a2


def _arm_to(arm_obj, frame, side, target, extra_upper=()):
    """Pose one arm so its hand (the forearm tail) reaches `target` (x, y)."""
    sgn = -1.0 if side == "L" else 1.0
    sh, l1, l2, r1, r2 = _arm_geometry(sgn)
    a1, a2 = _two_link(sh, l1, l2, target, sgn)
    d1 = _wrap(a1 - r1)
    d2 = _wrap((a2 - r2) - d1)
    _pose(arm_obj, frame, **{
        f"upperarm_{side}": [(Z, d1)] + list(extra_upper),
        f"forearm_{side}": [(Z, d2)],
    })


def _wrap(a):
    while a > math.pi:
        a -= 2.0 * math.pi
    while a < -math.pi:
        a += 2.0 * math.pi
    return a


def _hand_rest(side):
    sgn = -1.0 if side == "L" else 1.0
    return (WRIST_X + 0.05, sgn * WRIST_Y)


# --- clips ---------------------------------------------------------------------

def _build_down(arm_obj):
    rig = _rig()
    rig._new_action(arm_obj, "down")
    n = DOWN_FRAMES
    for f in range(0, n + 1):
        t = 2.0 * math.pi * f / n
        b = 0.022 * math.sin(t)
        _pose(
            arm_obj, f,
            spine=[(Y, -b)],
            neck=[(Y, -0.4 * b), (Z, 0.05 * math.sin(t * 0.5))],
            head=[(Z, 0.10 + 0.02 * math.sin(t + 0.6))],
            upperarm_L=[(Z, 0.02 * math.sin(t + 1.0))],
            upperarm_R=[(Z, -0.02 * math.sin(t + 1.0))],
        )


def _build_idle_wounded(arm_obj):
    rig = _rig()
    rig._new_action(arm_obj, "idleWounded")
    n = WOUNDED_FRAMES
    for f in range(0, n + 1):
        t = 2.0 * math.pi * f / n
        b = 0.026 * math.sin(t)
        # Left hand open beside the head; right hand pressed to the flank, with a
        # small press-and-ease on the breath so it is not a held mannequin pose.
        press = 0.012 * math.sin(t)
        _arm_to(arm_obj, f, "R", (0.150 + press, 0.205))
        _arm_to(arm_obj, f, "L", (0.74, -(WRIST_Y + 0.04) + 0.01 * math.sin(t + 1.3)))
        _pose(
            arm_obj, f,
            spine=[(Y, -b), (X, 0.10 + 0.012 * math.sin(t))],
            pelvis=[(Z, -0.05)],
            neck=[(Z, 0.20 + 0.03 * math.sin(t * 0.5 + 0.4))],
            head=[(Z, 0.22 + 0.04 * math.sin(t + 0.2))],
            thigh_L=[(Z, 0.05)],
            thigh_R=[(Z, -0.10 + 0.012 * math.sin(t + 0.8))],
            shin_R=[(Z, 0.06)],
        )
        # the arm poses above key upperarm/forearm; spine roll carries them with it


def _smooth(p):
    """0 -> 1 ease over p in [0, 1]."""
    return 0.5 - 0.5 * math.cos(math.pi * min(max(p, 0.0), 1.0))


def _hand_target(phase):
    """Where the planted hand is, ahead of / behind the body, for a cycle phase
    in [0, 1): 0..0.5 is contact, pulled back at exactly the ground speed;
    0.5..1 is the recovery, reaching forward on an ease."""
    far = 0.86
    near = far - CRAWL_PULL_M
    p = phase % 1.0
    if p < 0.5:
        return far - CRAWL_PULL_M * (p / 0.5), 0.0
    q = (p - 0.5) / 0.5
    return near + CRAWL_PULL_M * _smooth(q), math.sin(math.pi * q)


def _build_crawl(arm_obj):
    rig = _rig()
    rig._new_action(arm_obj, "crawl")
    n = CRAWL_FRAMES
    for f in range(0, n + 1):
        p = f / n
        s = math.sin(2.0 * math.pi * p)
        c = math.cos(2.0 * math.pi * p)
        xl, _ = _hand_target(p)
        xr, _ = _hand_target(p + 0.5)
        _arm_to(arm_obj, f, "L", (xl, -(WRIST_Y + 0.045)))
        _arm_to(arm_obj, f, "R", (xr, WRIST_Y + 0.045))
        # One knee does the work: drawn up forward and out as its opposite arm
        # reaches, driven back as that arm pulls. The other leg trails.
        draw = _smooth(1.0 - abs(2.0 * ((p + 0.5) % 1.0) - 1.0))   # 0 -> 1 -> 0 over the cycle
        phi = 0.52 * draw
        _pose(
            arm_obj, f,
            spine=[(Z, 0.075 * s)],
            pelvis=[(Z, -0.060 * s)],
            neck=[(Z, -0.030 * s)],
            head=[(Z, 0.12 - 0.045 * s)],
            thigh_R=[(Z, -phi)],
            shin_R=[(Z, 1.35 * phi)],
            thigh_L=[(Z, 0.05 + 0.04 * c)],
            shin_L=[(Z, -0.03 * c)],
        )


def _build_wreck(arm_obj):
    rig = _rig()
    rig._new_action(arm_obj, "wreck")
    # A dead man: arms thrown forward, head dropped to one side, legs apart.
    for f in (0, 1):
        _arm_to(arm_obj, f, "L", (0.80, -0.44))
        _arm_to(arm_obj, f, "R", (0.50, 0.36))
        _pose(
            arm_obj, f,
            spine=[(Z, -0.06)],
            neck=[(Z, -0.18)],
            head=[(Z, -0.38)],
            thigh_L=[(Z, 0.14)],
            thigh_R=[(Z, -0.20)],
            shin_R=[(Z, 0.10)],
        )


CLIP_BUILDERS = (
    ("down", _build_down, range(0, DOWN_FRAMES + 1)),
    ("idleWounded", _build_idle_wounded, range(0, WOUNDED_FRAMES + 1)),
    ("crawl", _build_crawl, range(0, CRAWL_FRAMES + 1)),
    ("wreck", _build_wreck, (0, 1)),
)


CLIP_FRAMES = tuple((n, f) for n, _b, f in CLIP_BUILDERS)


# --- seating on the ground -----------------------------------------------------

def _skinned_meshes(arm_obj):
    return [ob for ob in bpy.data.objects if ob.type == "MESH" and ob.parent == arm_obj]


def _lowest_z(meshes):
    dg = bpy.context.evaluated_depsgraph_get()
    lo = float("inf")
    for ob in meshes:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        m = ev.matrix_world
        for v in me.vertices:
            z = (m @ v.co).z
            if z < lo:
                lo = z
        ev.to_mesh_clear()
    return lo


def _lift_to_ground(arm_obj, clip, frames):
    """Key `root` up by whatever the lowest vertex is below z = 0, every frame.

    Returns the worst (most negative) lowest-z BEFORE the lift and the lift
    applied at that frame, for the printout: the number a reader can check."""
    rig = _rig()
    meshes = _skinned_meshes(arm_obj)
    bone, pb = _bone(arm_obj, "root")
    up = rig.local_offset_for_world_axis(bone, Z)
    arm_obj.animation_data.action = bpy.data.actions[clip]
    worst = 0.0
    # Two passes, and the order is the point: a key inserted at frame f is
    # extrapolated to frame f + 1, so measuring and keying in one loop reads
    # the previous frame's lift as part of the pose and keys the difference
    # (it alternated 9.1 mm / 0 mm down the clip). Measure all, then key all.
    lifts = {}
    for f in frames:
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        lo = _lowest_z(meshes)
        lifts[f] = max(0.0, SEAT_M - lo)
        worst = min(worst, lo)
    for f, lift in lifts.items():
        pb.location = up * lift
        pb.keyframe_insert(data_path="location", frame=f)
    return worst


def build_clips(arm_obj, team_id):
    """The four clips, then each one seated on the ground."""
    bpy.context.scene.render.fps = FPS
    report = []
    for name, builder, frames in CLIP_BUILDERS:
        builder(arm_obj)
        # `root` identity keys from `_new_action` are at frame 0 only; the lift
        # keys land on every frame of the clip.
        worst = _lift_to_ground(arm_obj, name, frames)
        report.append((name, worst))
    meshes = _skinned_meshes(arm_obj)
    for name, worst in report:
        # Read the seated clip back through the same evaluation: the number that
        # matters is this one, not the one before the lift.
        arm_obj.animation_data.action = bpy.data.actions[name]
        lows = []
        for f in dict(CLIP_FRAMES)[name]:
            bpy.context.scene.frame_set(f)
            bpy.context.view_layer.update()
            lows.append(_lowest_z(meshes))
        print(f"[{team_id}] clip {name}: lowest vertex before seating {worst * 1000.0:+.1f} mm, "
              f"after {min(lows) * 1000.0:+.2f} mm (seated at {SEAT_M * 1000.0:.0f})")


# --- probes (printed on every export; the numbers a reviewer re-checks) ---------

def crawl_probe(arm_obj, team_id):
    """Planted-hand speed in the crawl, read off the evaluated mesh: the speed at
    which the lowest-x vertex cluster of the `hand` role... the hand blobs are
    skin_shadow; track their centroid in the body frame over the contact half."""
    action = bpy.data.actions["crawl"]
    arm_obj.animation_data.action = action
    meshes = [ob for ob in _skinned_meshes(arm_obj) if ob.get("rl_role") == "skin_shadow"]
    pts = {}
    for f in range(0, CRAWL_FRAMES + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        for ob in meshes:
            ev = ob.evaluated_get(dg)
            me = ev.to_mesh()
            m = ev.matrix_world
            # the neck sweep is also skin_shadow; the hands are the verts at |y| > 0.2
            for sgn in (-1.0, 1.0):
                sel = [(m @ v.co) for v in me.vertices if (m @ v.co).y * sgn > 0.22 and (m @ v.co).x > 0.45]
                if sel:
                    pts.setdefault(sgn, {})[f] = sum(p.x for p in sel) / len(sel)
            ev.to_mesh_clear()
    out = []
    for sgn, series in pts.items():
        # contact half = the longest run of falling x
        speeds = []
        for f in range(1, CRAWL_FRAMES + 1):
            # a frame whose hand selection came up empty has no reading: skip it, never KeyError
            prev, cur = series.get(f - 1), series.get(f)
            if prev is None or cur is None:
                continue
            dx = cur - prev
            if dx < 0:
                speeds.append(-dx * FPS)
        out.append((sgn, max(speeds) if speeds else 0.0, sum(speeds) / max(1, len(speeds))))
    for sgn, vmax, vmean in out:
        print(f"[{team_id}] crawl hand {'R' if sgn > 0 else 'L'}: contact slide mean {vmean:.3f} m/s, peak {vmax:.3f} "
              f"(declared ground speed {CRAWL_SPEED_MS:.3f} m/s)")


def set_extras(team_id):
    bpy.context.scene["rl_figures"] = [{"prefix": PREFIX, "squad": False}]


def save_source(team_id):
    """The .blend beside the GLB: `art/src/units/<team>.blend`, the file the
    contract asks every shipped mesh to travel with. It is a RESULT, not a source
    of truth: `kit.casualty` + this module rebuild it, and nobody poses it by hand."""
    import os
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                        "art", "src", "units", f"{team_id}.blend")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    print(f"[{team_id}] source {path} ({os.path.getsize(path)} bytes)")
