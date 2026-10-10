"""Captured motion, retargeted onto rig.py's rigid-part figures.

The B7 regression (GH-179 B7, #335/#337, 2 Oct; found 5 Oct): `inf_squad`,
`sarim_rifles` and `yahalom_squad` replaced three supplied Meshy bipeds whose
clips were motion capture -- `meshy_soldier.glb`, the old `sarim_rifles.glb`
and `yahalom_engineer.glb` -- with textured Meshy figures cut into rigid parts
and driven by this directory's procedural `rig.py` clips. The walk became
rig.py's locked-torso pendulum (torso lean range 0.1 deg against 4-5 deg
before) and the two files that carried `moveFire` lost it. The lead's ruling
(5 Oct): bring the captured motion back onto the new bodies.

## The approach: bake the capture's rotations onto rig.py's bones

Two were on the table: (a) put the textured parts onto the OLD skeleton, or
(b) drive rig.py's own armature with the capture's bone rotations. This is
(b), for three reasons that were each checked rather than assumed:

* **The joints are the new body's own.** rig.py's bones sit at the cut
  points `import_meshy_crew_team.py` measured on each Meshy figure (its
  `standing_bones`). The supplied skeleton's joints were placed for a
  different body: binding a rigid part to the nearest supplied bone rotates
  it about a pivot that is not its joint, which opens the knee and elbow
  seams the importer's blobs are sized to cover.
* **Everything rig.py hangs off its bones keeps working.** The corpse on
  `death_root`, `yahalom_squad`'s kneeling `work` body, the weapon seats, the
  scale-keyed visibility contract (`rig._key_death_visibility`) -- all of it
  is bone-name driven and untouched.
* **Textures and weapons do not move.** The parts, their atlas and their
  weapon binding are exactly what the importer built; only keyframes change.

## The retarget, in one line

For every mapped bone, the capture's WORLD rotation change is applied to the
target bone's own rest:

    target_world(t) = mirror(source_world(t) * source_base^-1) * target_rest

which keyed as a pose-bone basis is `L^-1 (D_parent^-1 D) L` (`_basis`).
World rather than local because the chains do not match bone for bone (the
capture has three spine joints and clavicles; rig.py has one spine and none).

* **`base` is the source's REST for the body and legs** -- both skeletons
  stand upright with straight legs at rest, so a delta from rest is the same
  motion on both -- **and the source's `idle` frame 0 for the ARMS**, because
  the arms' rests differ: the capture's arms hang (or, on the soldier, hold a
  low ready), where every target carrier's forearms are bent forward onto a
  rifle (`import_meshy_crew_team.FORE_BEND`). Referenced to `idle`, the arms
  hold the target's own carry at idle and swing about it in the run.
* **`mirror`** (reflection through the figure's own sagittal plane) because
  the capture is a right-handed shooter (`RightHand` grips, measured) and
  every target holds its weapon on `forearm_R` at +Y, the figure's LEFT. The
  map is by NAME (`Left*` -> `*_L`), which crosses sides; mirroring the whole
  performance keeps legs and arms contralateral.
* **The feet are planted, not the hips scaled.** Each frame's root height is
  solved so the lowest boot vertex sits where it sits at rest (`_ground_z`);
  horizontally the hips' own sway is kept, scaled by leg length, with any
  net drift over a looping clip removed (the soldier's `moveFire` carried
  1.56 m of root motion).
* **A shooter's arms in `fire`/`moveFire` are rig.py's**, not the capture's:
  the old `sarim_rifles` fired with its arms hanging (measured: 0 deg of arm
  motion over the clip), and the target's weapon seat is rig.py's, which
  `FIRE_SHOULDER`/`FIRE_ELBOW` are calibrated against (mesh_gait.test.ts's
  elevation gates). They ride the captured torso, its twist removed so the
  aim holds the facing.

`yahalom_engineer.glb` carried no `fire` or `moveFire`: yahalom's `fire` is
the captured `idle` pose with rig.py's shot on `yah_b`, and its `moveFire` is
the captured `move` with the same.
"""
import json
import math
import os

import bpy
from mathutils import Matrix, Quaternion, Vector

import rig

MOCAP_DIR = os.path.join(rig.REPO, "art", "mocap")

#: team -> the capture it plays (`art/mocap/<source>.json`, written by
#: `extract_mocap.py`) and which source figure drives each of its figures,
#: in `rig.TEAM_FIGURES` order.
CAPTURED = {
    # Motion pass (5 Oct): the soldier's own `idle` is a deep crouch (pelvis
    # at 0.83 of standing, knees bent 72-75 deg), which read as three men
    # squatting whenever the squad stood still. The Sarim capture's standing
    # idle replaces it; the run and the deaths stay the soldier's.
    "inf_squad": dict(source="meshy_soldier", figures=("f0", "f1", "f2"),
                      clips={"idle": ("sarim_rifles", ("f0", "f1", "f2"))}),
    "sarim_rifles": dict(source="sarim_rifles", figures=("f0", "f1", "f2")),
    # The engineer's own `move` is a WALK (1.04 s a cycle, 0.88 m a stride on
    # this body), which yahalom's 0.85 tiles/s would play at 3.02x -- past
    # mesh_gait.test.ts's 2.8 ceiling, and it already shipped at 2.645x, the
    # highest in the game. Its run comes from the KDF soldier's capture; its
    # `idle` stays its own.
    "yahalom_squad": dict(source="yahalom_engineer", figures=("f0", "f1"),
                          clips={"move": ("meshy_soldier", ("f0", "f1"))}),
}

#: rig.py bone suffix -> the capture's bone. The hip-fix bones (`hip_L`,
#: `hip_R`) take half the thigh's rotation, as `rig.gait_pose` keys them.
#: rig.py's ONE spine bone spans the capture's three (`Spine02` > `Spine01` >
#: `Spine`); it takes the MIDDLE one's rotation, the chord of the bend. On
#: the top one it over-leaned the soldier's low ready by 9 deg (measured
#: pelvis-to-head: 32.2 against the capture's own 22.8).
BONE_MAP = {
    "pelvis": "Hips", "spine": "Spine01", "neck": "neck", "head": "Head",
    "upperarm_L": "LeftArm", "forearm_L": "LeftForeArm",
    "upperarm_R": "RightArm", "forearm_R": "RightForeArm",
    "thigh_L": "LeftUpLeg", "shin_L": "LeftLeg",
    "thigh_R": "RightUpLeg", "shin_R": "RightLeg",
}
ARMS = ("upperarm_L", "forearm_L", "upperarm_R", "forearm_R")
LOOPED = ("idle", "move", "moveFire")
#: The capture's death clips: played once (`fall`, `fallAlt`) or held
#: (`down`, `wreck`, `wreckAlt`); their feet leave the ground, so the ground
#: solve plants the lowest point of the whole BODY instead of a boot.
DEATH = ("fall", "fallAlt", "down", "wreck", "wreckAlt")
BODY_STRIDE = 3
HELD_ROLES = ("weapon", "metal", "webbing")
#: A capture frame whose lowest foot joint is within this of the clip's own
#: lowest is a frame with a foot on the ground.
CONTACT_M = 0.03

#: How much of the capture's arm swing each side keeps, per team -- `R` is
#: the arm carrying the weapon (or yahalom's mast), `L` the support arm. The
#: capture's run swings a FREE arm through ~100 deg at the shoulder; a hand
#: on a rifle cannot, and rig.py's own gait makes the same call
#: (`A_ARM_WEAPON` 0.20 against `A_ARM_FREE` 0.52 rad). Since the motion
#: pass (5 Oct) `inf_squad` is a rifleman like the other two.
ARM_GAIN = {
    "inf_squad": {"L": 0.55, "R": 0.35},
    "sarim_rifles": {"L": 0.55, "R": 0.35},
    "yahalom_squad": {"L": 0.55, "R": 0.35},
}

_DOCS = {}


def _doc(source):
    if source not in _DOCS:
        with open(os.path.join(MOCAP_DIR, f"{source}.json"), encoding="utf-8") as fh:
            _DOCS[source] = json.load(fh)
    return _DOCS[source]


def _mirror_q(q):
    """Reflection through the XZ plane, conjugated onto a rotation: pitch
    (about Y) is kept, yaw and roll change sign."""
    return Quaternion((q.w, -q.x, q.y, -q.z))


def _mirror_v(v):
    return Vector((v.x, -v.y, v.z))


def _ry(angle):
    return Quaternion((0.0, 1.0, 0.0), angle)


def _without_twist(q):
    """`q` with its rotation about world Z removed (swing-twist split)."""
    t = Quaternion((q.w, 0.0, 0.0, q.z))
    if t.magnitude < 1e-9:
        return q.copy()
    t.normalize()
    return q @ t.inverted()


class _Source:
    """One capture clip for one source figure: world rotations per frame,
    loop-closed when the clip loops, plus the hips' horizontal path."""

    def __init__(self, doc, clip, fig):
        c = doc["clips"][clip]
        self.n = c["frames"]
        self.rot = {b: [Quaternion(q) for q in c["rot"][fig][b]] for b in BONE_MAP.values()}
        self.hips = [Vector(p) for p in c["hips"][fig]]
        rest = doc["rest"][fig]
        last = self.n - 1
        if clip in LOOPED and self.n > 2:
            for b, qs in self.rot.items():
                gap = qs[0] @ qs[last].inverted()   # what the last frame lacks
                for k in range(self.n):
                    qs[k] = Quaternion().slerp(gap, k / last) @ qs[k]
            # Un-wrap first: the soldier's `moveFire` carries root motion, and
            # its phase-offset figures wrap it mid-clip (f1 jumps 1.54 ->
            # -0.02 m between two frames). A step far outside the clip's
            # typical one is replaced by that typical step; then any net drift
            # is removed, so the clip is in place.
            steps = [self.hips[k + 1] - self.hips[k] for k in range(last)]
            horiz = [Vector((v.x, v.y, 0.0)).length for v in steps]
            typical = sorted(horiz)[len(horiz) // 2]
            med = steps[horiz.index(typical)]
            path = [self.hips[0].copy()]
            for v, h in zip(steps, horiz):
                path.append(path[-1] + (Vector((med.x, med.y, v.z)) if h > 3.0 * typical + 0.05 else v))
            drift = path[last] - path[0]
            drift.z = 0.0
            self.hips = [h - drift * (k / last) for k, h in enumerate(path)]
        # The capture's own feet, by forward kinematics off its rest heads:
        # which frames it had a foot on the ground (`contact`), and where its
        # ankles stood, so the hips' horizontal place is read RELATIVE TO THE
        # FEET (a root-motion clip's hips are metres from its rest).
        low, mids = [], []
        for k in range(self.n):
            zs, ankles = [], []
            for side in ("Left", "Right"):
                chain = ("Hips", f"{side}UpLeg", f"{side}Leg", f"{side}Foot", f"{side}ToeBase")
                pos = self.hips[k].copy()
                for parent, child in zip(chain, chain[1:]):
                    r = Quaternion(c["rot"][fig][parent][k]) @ Quaternion(rest[parent]["q"]).inverted()
                    pos = pos + r @ (Vector(rest[child]["head"]) - Vector(rest[parent]["head"]))
                    if child.endswith(("Foot", "ToeBase")):
                        zs.append(pos.z)
                    if child.endswith("Foot"):
                        ankles.append(pos.copy())
            low.append(min(zs))
            mids.append((ankles[0] + ankles[1]) * 0.5)
        floor = min(low)
        self.contact = [z - floor < CONTACT_M for z in low]
        #: per arm bone, the WORLD direction its segment points each frame
        #: (shoulder to elbow, elbow to wrist) -- what a dying body's arms are
        #: matched to (`_death_arms`).
        self.seg = {}
        for bone, child in (("LeftArm", "LeftForeArm"), ("LeftForeArm", "LeftHand"),
                            ("RightArm", "RightForeArm"), ("RightForeArm", "RightHand")):
            v0 = Vector(rest[child]["head"]) - Vector(rest[bone]["head"])
            r0 = Quaternion(rest[bone]["q"]).inverted()
            self.seg[bone] = [(Quaternion(c["rot"][fig][bone][k]) @ r0 @ v0).normalized() for k in range(self.n)]
        rest_hips = Vector(rest["Hips"]["head"])
        rest_mid = (Vector(rest["LeftFoot"]["head"]) + Vector(rest["RightFoot"]["head"])) * 0.5
        if clip in LOOPED:
            # A cycle: its own sway about the clip's mean, plus how far the
            # capture carries its hips ahead of its feet on average.
            anchor = sum(self.hips, Vector()) / self.n
            lead = sum((h - m for h, m in zip(self.hips, mids)), Vector()) / self.n - (rest_hips - rest_mid)
        else:
            # A one-shot (a shot, a fall, a crouch): its path from its OWN
            # first frame, which stands where the capture's feet put it -- a
            # fall that starts at the clip mean would jump on its first frame.
            anchor = self.hips[0]
            lead = (self.hips[0] - mids[0]) - (rest_hips - rest_mid)
        #: per frame: the hips' offset from where they stand at rest;
        #: vertically as captured.
        self.offset = []
        for h in self.hips:
            o = h - anchor + lead
            o.z = h.z - rest_hips.z
            self.offset.append(o)


def _basis(L, d_parent, d):
    """Pose-bone basis rotation for world delta `d` under a parent whose world
    delta is `d_parent`, for a bone whose rest (armature space) is `L`."""
    lq = L.to_quaternion()
    return lq.inverted() @ d_parent.inverted() @ d @ lq


class _Figure:
    """One target figure's bones, rest frames and boot samples."""

    def __init__(self, arm_obj, prefix):
        self.prefix = prefix
        bones = arm_obj.data.bones
        self.L = {}
        self.parent = {}
        for b in bones:
            if not b.name.startswith(prefix + "_"):
                continue
            suffix = b.name[len(prefix) + 1:]
            if suffix not in ("root", "pelvis", "hip_L", "hip_R") and suffix not in BONE_MAP:
                continue
            self.L[suffix] = b.matrix_local.copy()
            self.parent[suffix] = b.parent.name[len(prefix) + 1:] if b.parent else None
        missing = (set(BONE_MAP) | {"root", "hip_L", "hip_R"}) - set(self.L)
        if missing:
            raise RuntimeError(f"{prefix}: rig has no {sorted(missing)} -- not a standing rig.py figure")
        self.order = sorted(self.L, key=self._depth)
        # Boot vertices, armature space, per shin -- the ground solve's input.
        self.boots = {"shin_L": [], "shin_R": []}
        for ob in arm_obj.children:
            if ob.type != "MESH" or ob.get("rl_role") != "boot":
                continue
            names = {g.index: g.name for g in ob.vertex_groups}
            M = ob.matrix_world
            for v in ob.data.vertices:
                for g in v.groups:
                    name = names[g.group]
                    if g.weight > 0.5 and name in (f"{prefix}_shin_L", f"{prefix}_shin_R"):
                        self.boots[name[len(prefix) + 1:]].append(M @ v.co)
        if not all(self.boots.values()):
            raise RuntimeError(f"{prefix}: no boot vertices on a shin -- the ground solve has nothing to plant")
        # Every living vertex of the figure's BODY, per bone, thinned -- the
        # ground solve for a FALL, where what touches the ground is the body.
        # Not what it holds: yahalom's 1.45 m mast and a rifle swing below the
        # body as it goes down, and planting those held the body 0.4-0.6 m off
        # the ground (measured, pelvis at rest on the wreck).
        self.body = {}
        for ob in arm_obj.children:
            if ob.type != "MESH" or ob.get("rl_role") in HELD_ROLES:
                continue
            names = {g.index: g.name for g in ob.vertex_groups}
            M = ob.matrix_world
            for i, v in enumerate(ob.data.vertices):
                if i % BODY_STRIDE:
                    continue
                for g in v.groups:
                    name = names[g.group]
                    if g.weight > 0.5 and name.startswith(prefix + "_"):
                        suffix = name[len(prefix) + 1:]
                        if suffix in self.L:
                            self.body.setdefault(suffix, []).append(M @ v.co)
        self.rest_floor = min(v.z for vs in self.boots.values() for v in vs)
        # Leg length, for scaling the hips' horizontal sway.
        self.hip_z = self.L["thigh_L"].translation.z

    def _depth(self, suffix):
        d = 0
        while self.parent[suffix] is not None:
            suffix = self.parent[suffix]
            d += 1
        return d

    def bases(self, deltas):
        out = {}
        for s in self.order:
            p = self.parent[s]
            out[s] = _basis(self.L[s], deltas[p] if p else Quaternion(), deltas[s])
        return out

    def floor(self, bases, root_loc, body=False):
        """Lowest boot vertex z -- or, with `body`, lowest vertex of the whole
        living figure -- for these bases with the root at `root_loc`."""
        P = {}
        for s in self.order:
            B = bases[s].to_matrix().to_4x4()
            if s == "root":
                P[s] = self.L[s] @ Matrix.Translation(root_loc) @ B
            else:
                p = self.parent[s]
                P[s] = P[p] @ self.L[p].inverted() @ self.L[s] @ B
        groups = self.body if body else self.boots
        lowest = math.inf
        for s, vs in groups.items():
            M = P[s] @ self.L[s].inverted()
            lowest = min(lowest, min((M @ v).z for v in vs))
        return lowest


def _arm_deltas(src_arm, k, base, gain):
    """World deltas for the four arm bones from the capture (base: its
    `idle` frame 0), each side scaled toward identity by its gain."""
    out = {}
    for side in ("L", "R"):
        up, fore = f"upperarm_{side}", f"forearm_{side}"
        d_up = _mirror_q(src_arm.rot[BONE_MAP[up]][k] @ base[up].inverted())
        d_fore = _mirror_q(src_arm.rot[BONE_MAP[fore]][k] @ base[fore].inverted())
        g = gain[side]
        up_g = Quaternion().slerp(d_up, g)
        rel = Quaternion().slerp(d_up.inverted() @ d_fore, g)
        out[up] = up_g
        out[fore] = up_g @ rel
    return out


def _death_arms(fig, src, k):
    """A dying body's arms, matched by DIRECTION: each target segment turned
    (by the shortest arc from its own rest) to point where the capture's does,
    mirrored. Deltas from `idle` -- the living rule -- assume the two arms
    start from the same carry; in a fall they end wherever the capture flung
    them, and a forearm that had started bent onto a rifle ended pointing
    into the ground and propped the body on its hand (yah_a: pelvis 0.39 m
    up on the wreck, against 0.24 for yah_b beside him)."""
    out = {}
    for s in ARMS:
        rest_dir = fig.L[s].to_3x3().col[1].normalized()
        out[s] = rest_dir.rotation_difference(_mirror_v(src.seg[BONE_MAP[s]][k]))
    return out


def _key(pb, q, frame, prev):
    if prev is not None and prev.dot(q) < 0.0:
        q = -q
    pb.rotation_quaternion = q
    pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)
    return q


UPPER = ("spine", "neck", "head") + ARMS


def _build(arm_obj, team_id, name, body_clip, *, moving, firing, frames=None, hold=False, upper_clip=None,
           hold_last=False):
    """One clip. `body_clip` is the capture's clip for the legs, pelvis and
    hips path; `upper_clip` (default the same) for the torso, head and -- on a
    figure that does not shoot -- the arms, resampled onto `body_clip`'s
    frames; `firing` gives each shooter rig.py's shot instead; `hold` keeps
    the body at its frame 0 for `frames` frames (yahalom's `fire`, whose
    capture has none)."""
    cfg = CAPTURED[team_id]
    source, source_figs = cfg.get("clips", {}).get(body_clip, (cfg["source"], cfg["figures"]))
    doc = _doc(source)
    figures = rig.TEAM_FIGURES[team_id]
    rig._new_action(arm_obj, name)
    pbones = arm_obj.pose.bones
    # Alive in every clip, the captured deaths included: the capture's own
    # body falls and lies (`fall` -> `wreck`), so the posed corpse on
    # `death_root` stays scaled out.
    rig._key_death_visibility(pbones, figures, "prop" in pbones, alive=True, moving=moving)
    leaners = rig.FIRE_ROOT_LEAN.get(team_id, {}) if firing else {}
    for spec, sf in zip(figures, source_figs):
        prefix = spec["prefix"]
        fig = _Figure(arm_obj, prefix)
        body = _Source(doc, body_clip, sf)
        upper = _Source(doc, upper_clip, sf) if upper_clip and upper_clip != body_clip else body
        idle = _Source(doc, "idle", sf)
        rest = {b: Quaternion(doc["rest"][sf][b]["q"]) for b in BONE_MAP.values()}
        src_hip_z = doc["rest"][sf]["LeftUpLeg"]["head"][2]
        scale = fig.hip_z / src_hip_z
        arm_base = {s: idle.rot[BONE_MAP[s]][0] for s in ARMS}
        shooter = firing and spec.get("weapon") == "rifle"
        # A figure whose weapon rides its torso (a FIRE_ROOT_LEAN team) aims
        # by facing: its torso is squared in a firing clip, as a shooter's.
        squared = shooter or prefix in leaners
        n = frames if frames is not None else body.n
        rows = []
        for f in range(n):
            k = (body.n - 1) if hold_last else 0 if hold else min(f, body.n - 1)
            ku = k if upper is body else round(k * (upper.n - 1) / max(1, body.n - 1))
            d = {}
            for s, b in BONE_MAP.items():
                if s in ARMS:
                    continue
                src = upper if s in UPPER else body
                d[s] = _mirror_q(src.rot[b][ku if s in UPPER else k] @ rest[b].inverted())
            kick = rig._recoil_curve(f / max(1, n - 1)) if firing else 0.0
            if squared and not shooter:
                d["spine"] = _without_twist(d["spine"])
            if shooter:
                # Square the torso to the target: the capture blades it 23-41
                # deg off the facing to shoulder a rifle on the other side
                # (measured: Sarim `moveFire` spine yaw -41, soldier -33..-40),
                # and rig.py's shot is a front-on shot whose arms hang off it.
                d["spine"] = _without_twist(d["spine"]) @ _ry(rig.RECOIL_SPINE * kick)
                # The arms hold the weapon where rig.py's `fire` holds it on an
                # upright torso, whatever the captured torso does: a shooter
                # running bent over (the run leans 5-8 deg, the soldier's aim
                # 21) keeps his muzzle on the target, he does not point it at
                # the ground. Only the shot's own recoil reaches the weapon.
                carry = _ry(rig.RECOIL_SPINE * kick)
                up = carry @ _ry(rig.FIRE_SHOULDER + rig.RECOIL_SHOULDER * kick)
                d.update(upperarm_L=carry, forearm_L=carry, upperarm_R=up,
                         forearm_R=up @ _ry(rig.FIRE_ELBOW + rig.RECOIL_ELBOW * kick))
            else:
                if body_clip in DEATH:
                    d.update(_death_arms(fig, upper, ku))
                else:
                    d.update(_arm_deltas(upper, ku, arm_base, ARM_GAIN[team_id]))
            d["hip_L"] = d["pelvis"].slerp(d["thigh_L"], 0.5)
            d["hip_R"] = d["pelvis"].slerp(d["thigh_R"], 0.5)
            d["root"] = _ry(leaners[prefix]) if prefix in leaners else Quaternion()
            bases = fig.bases(d)
            # The hips' own path -- sway, bob, the run's flight -- mirrored and
            # scaled to this figure's leg.
            world = _mirror_v(body.offset[k]) * scale
            dead = body_clip in DEATH
            lift = fig.rest_floor - fig.floor(bases, fig.L["root"].to_quaternion().inverted() @ world, body=dead)
            rows.append((bases, world, lift))
        # The feet: on every frame the CAPTURE had a foot down, the lowest
        # boot is put on the ground; between those (the run's flight) the
        # lift is interpolated, so the hips keep the capture's own arc and a
        # frame it had in the air stays in the air. A planted solve on every
        # frame doubled the run's bob (0.115 m against the capture's 0.055);
        # one constant per clip floated the feet 0.13-0.21 m, because a boot
        # rigid on its shin cannot point its toe the way the capture's ankle
        # does.
        ks = [(body.n - 1) if hold_last else 0 if hold else min(f, body.n - 1) for f in range(n)]
        # A death clip is always touching the ground somewhere: every frame.
        down = list(range(n)) if body_clip in DEATH else ([f for f in range(n) if body.contact[ks[f]]] or list(range(n)))
        lifts = []
        for f in range(n):
            if f in down:
                lifts.append(rows[f][2])
                continue
            a = max((g for g in down if g < f), default=None)
            b = min((g for g in down if g > f), default=None)
            if a is None or b is None:   # wrap a looping clip; clamp a one-shot
                if body_clip in LOOPED and len(down) > 1:
                    a = a if a is not None else down[-1] - (n - 1)
                    b = b if b is not None else down[0] + (n - 1)
                else:
                    lifts.append(rows[a if a is not None else b][2])
                    continue
            la, lb = rows[a % (n - 1) if a < 0 else a][2], rows[b % (n - 1) if b >= n else b][2]
            t = (f - a) / (b - a)
            lifts.append(max(rows[f][2], la + (lb - la) * t))
        float_m = max(l - r[2] for l, r in zip(lifts, rows))
        c = 0.0
        prev = {}
        for f, (bases, world, _lift) in enumerate(rows):
            world = world + Vector((0.0, 0.0, lifts[f]))
            for s in fig.order:
                pb = pbones[f"{prefix}_{s}"]
                prev[s] = _key(pb, bases[s], f, prev.get(s))
            pb = pbones[f"{prefix}_root"]
            pb.location = fig.L["root"].to_quaternion().inverted() @ world
            pb.keyframe_insert(data_path="location", frame=f)
        print(f"    {prefix} <- {sf}: {len(down)}/{n} contact frames, highest flight {float_m:.3f} m")
    print(f"  mocap[{team_id}] {name}: {source}:{body_clip}{' held' if hold else ''}, "
          f"{n} frames{' + rig.py shot' if firing else ''}")


def build_captured_clips(arm_obj, team_id):
    """`idle`, `move`, `fire`, `moveFire` for a CAPTURED team. The caller
    (`rig.build_clips`) adds `down`/`wreck` (the posed corpse) and `work`."""
    cfg = CAPTURED[team_id]
    clips = _doc(cfg["source"])["clips"]
    _build(arm_obj, team_id, "idle", "idle", moving=False, firing=False)
    _build(arm_obj, team_id, "move", "move", moving=True, firing=False)
    if "fire" in clips:
        _build(arm_obj, team_id, "fire", "fire", moving=False, firing=True)
    else:
        _build(arm_obj, team_id, "fire", "idle", moving=False, firing=True, frames=rig.FIRE_FRAMES + 1, hold=True)
    # Walk-and-fire is the run's legs under an aim: the capture's `move` for
    # the legs and the hips' path, and its own `moveFire` (where it has one)
    # for the torso and head. Its legs are not used: the soldier's is a
    # WALK-and-shoot, 0.76 m a stride on this body, which inf_squad's 0.9
    # tiles/s would play at 2.38x and 7.1 steps a second (mesh_gait.test.ts:
    # 1.7 and 6.0), and the Sarim's already IS its `move` legs.
    own_move_fire = "moveFire" in clips and "move" not in cfg.get("clips", {})
    _build(arm_obj, team_id, "moveFire", "move", moving=True, firing=True,
           upper_clip="moveFire" if own_move_fire else None)
    built = {"idle", "move", "fire", "moveFire"}
    # The deaths: each fall played once, and its wreck the fall's own last
    # frame held (mesh_gait.test.ts: within 1 deg and 1 cm), so a body never
    # pops between the two. `down` (pinned, routed and stopped) is the
    # capture's own prone pose.
    for fall, wreck in (("fall", "wreck"), ("fallAlt", "wreckAlt")):
        if fall in clips:
            _build(arm_obj, team_id, fall, fall, moving=False, firing=False)
            _build(arm_obj, team_id, wreck, fall, moving=False, firing=False, frames=2, hold_last=True)
            built |= {fall, wreck}
    if "down" in clips:
        _build(arm_obj, team_id, "down", "down", moving=False, firing=False, frames=2, hold=True)
        built.add("down")
    return built
