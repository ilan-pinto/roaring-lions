"""Build the three-man Shmamit Deep Recon Team (`recon_zikit`) from ONE Meshy
A-pose figure WITH ITS BAKE, through rig.py -- E5 part 2 (GH-181).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/units/import_meshy_zikit_team.py

Writes `art/meshes/recon_zikit.glb`. The file is HELD (`HELD_MESH_FILES` in
`packages/app/src/mesh-catalogue.ts`) until E5 Task 9 lands the staged unit
JSON and wires `RIGGED_UNIT_MESHES`; this script owns it either way.

SOURCE (`art/meshy/recon-zikit-20260930-01a0f346/model.glb`): Meshy
text-to-3d preview in `--pose a-pose` (01a0f343-6390-741c-adee-20c9a3ec409e),
refined with a 2k bake (01a0f344-3a27-7653-9d91-9e0db0ddef5b), REMESHED at
1,500 tris (01a0f346-7ff9-772a-aa3c-f0cae827210c; arrived at 1,541 with the
bake kept). Prompt and numbers: `docs/art/meshy-prompts-e5.md` section 2.
AI-generated (Meshy), disclosed per CONTRIBUTING.md.

## Method: B0b's importer, three times

Everything about cutting a figure, hanging its arms, kneeling it, laying its
corpse and pinning a blob's UVs to the bake is `tools/units/import_meshy_kdf_team.py`
(GH-286 B0b), imported here as a module and NOT copied -- `cut_figure`,
`_kneel`, `standing_bones`, `_death_parts`, `_place`, `_prepare_texture`,
`export_glb_textured` are its functions. What this file adds is the team:

  zk_rifle  standing at (+0.10, -0.70): the rifleman, `rig._weapon_parts`'s
            rifle held LEVEL at his hung right hand (B0b's `demo_b` method),
            the only gun in the team.
  zk_radio  standing at (-0.30, +0.05): the radio operator. The Meshy figure
            already carries the boxy radio pack on every man (measured: the
            back reaches 0.20 H behind the centreline against 0.11 H for the
            chest); what makes HIM the operator is the whip -- a `kit.tube`
            0.90 m long at 80 degrees from horizontal rising from the pack,
            bound to his spine so it leans with him.
  zk_spot   kneeling at (+0.25, +0.65) behind a tripod spotting scope on the
            team's static `prop` bone at (+0.74, +0.65): three `kit.tube`
            legs meeting under a `kit.box` scope at his kneeling eye height,
            the way `at_team`'s tube sits at its gunner's measured shoulder.
            He kneels through `move` like `at_fire` (no D6 walker: the B0b
            importer refuses one, and the deployed spotter is the read).

Clips are `rig.py`'s own builders called directly with THIS team's figure
specs -- `build_idle_clip`, `build_move_clip`, `build_fire_clip`, and the two
death clips as `build_death_clip` writes them -- rather than through
`rig.build_clips(team_id)`, which reads `rig.TEAM_FIGURES`/`teams.TEAMS` and
the unit's JSON under `data/units/` (this unit's JSON is STAGED in
`docs/campaign/special_units/e5/` until Task 9). The gait is sized from that
staged file's own `mobility.speed_tiles_s` through `rig.gait_amplitudes`,
the same arithmetic `rig.gait_for_team` does, so nothing is restated. No
hand-posing, no weight painting, rigid one-part-one-bone. No
`mathutils.noise`.

Every figure carries a prone corpse for `down`/`wreck`.

Silhouette levers against `inf_squad` (three standing rifles in a line),
`at_team` (kneel + stand, level tube) and `sniper_team` (prone): one rifle
among three, a whip at 80 degrees, and a kneeling man behind a low tripod.

After this: `pnpm validate:meshes`, `pnpm encode:meshes`. The `rl_gait`
extra is applied at landing (`pnpm gait:meshes` is scoped to
`RIGGED_UNIT_MESHES`).
"""
import glob
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

import kit  # noqa: E402
import rig  # noqa: E402
import import_meshy_kdf_team as kdf  # noqa: E402

REPO = os.path.dirname(TOOLS)
TEAM = "recon_zikit"
OUT_PATH = os.path.join(REPO, "art", "meshes", f"{TEAM}.glb")
SOURCE = os.path.join(REPO, "art", "meshy", "recon-zikit-*-01a0f346", "model.glb")
STAGED_JSON = os.path.join(REPO, "docs", "campaign", "special_units", "e5", f"{TEAM}.json")
HEIGHT = 1.78

#: rig._f specs -- prefix, anchor, posture, weapon. `animates=False` on the
#: kneeling spotter keeps his legs still through `move`, as `at_fire`.
FIGURES = [
    rig._f("zk_rifle", 0.10, -0.70, weapon="rifle"),
    rig._f("zk_radio", -0.30, 0.05, leader=True),
    rig._f("zk_spot", 0.25, 0.65, posture="kneeling", animates=False),
]
TRIPOD_AT = (0.74, 0.65)

#: 100 from +x is 80 degrees from horizontal LEANING BACK over the pack.
WHIP_LEN, WHIP_R, WHIP_PITCH_DEG = 0.90, 0.012, 100.0
SCOPE_SIZE = (0.32, 0.09, 0.09)
LEG_R, LEG_SPLAY = 0.012, 0.30
#: B0b's own 0.5: a corpse at 0.3 came back as spikes at zoom 2.5.
DEATH_DECIMATE = 0.5
#: `kit.blob` joints at 6 sides x 2 rings instead of 9 x 3. Three figures
#: carry 24 seam blobs; at kit's default they cost ~2,600 tris, more than a
#: whole figure, and at 25 px a 6x2 ellipsoid hides a seam just as well.
BLOB_SIDES, BLOB_RINGS = 6, 2
#: see build_team: 0.5 H makes the arm test "outboard of the arm-root ring".
ARM_CHORD_RADIUS_F = 0.5


def log(msg):
    print(f"[zikit] {msg}")


def _staged_speed():
    with open(STAGED_JSON) as fh:
        return float(json.load(fh)["mobility"]["speed_tiles_s"])


def _whip(info, x, y):
    """The radio operator's whip: from the top of the pack, 80 degrees up."""
    z_sh = max(info["joints"]["arm"][s]["shoulder"][2] for s in (0, 1))
    pitch = math.radians(WHIP_PITCH_DEG)
    base = Vector((x - 0.30, y + 0.06, z_sh - 0.05))
    centre = base + Vector((math.cos(pitch) * WHIP_LEN / 2.0, 0.0, math.sin(pitch) * WHIP_LEN / 2.0))
    ob = kit.tube("zk_whip", WHIP_LEN, WHIP_R, tuple(centre), pitch=pitch, sides=6, role="metal")
    log(f"whip base {tuple(round(c, 3) for c in base)}, tip z {base.z + math.sin(pitch) * WHIP_LEN:.3f}")
    return [ob]


def _tripod(eye_z):
    """Three legs meeting under a scope at the kneeling spotter's eye line."""
    x0, y0 = TRIPOD_AT
    z_top = eye_z - 0.06
    parts = [kit.box("zk_scope", SCOPE_SIZE, (x0, y0, z_top + SCOPE_SIZE[2] / 2.0), "metal")]
    for k in range(3):
        a = 2.0 * math.pi * k / 3.0 + math.pi / 6.0
        foot = Vector((x0 + LEG_SPLAY * math.cos(a), y0 + LEG_SPLAY * math.sin(a), 0.0))
        head = Vector((x0, y0, z_top))
        length = (head - foot).length
        pitch = math.atan2(z_top, LEG_SPLAY)
        centre = (foot + head) / 2.0
        # kit.tube runs along +x then pitches about y and yaws about z: a leg
        # from `foot` up to `head` is yaw toward the head, pitch up.
        yaw = math.atan2(head.y - foot.y, head.x - foot.x)
        parts.append(kit.tube(f"zk_leg{k}", length, LEG_R, tuple(centre), yaw=yaw, pitch=pitch, sides=6, role="metal"))
    log(f"tripod at {TRIPOD_AT}, scope z {z_top + SCOPE_SIZE[2] / 2.0:.3f}")
    return parts


def build_team():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    kdf.SOURCES[TEAM] = (SOURCE, HEIGHT)
    if len(glob.glob(SOURCE)) != 1:
        raise SystemExit(f"expected one source at {SOURCE}")
    # Three figures at B0b's own settings put the file at 8,861 glTF tris
    # against the 8,000 cap (bible section 3). The corpses keep B0b's 0.5
    # (0.3 was measured as spikes); the seam blobs are where the tris go.
    kdf.DEATH_DECIMATE = DEATH_DECIMATE
    # This figure's A-pose arms are BENT with the hands forward (arm chord
    # 78-81 degrees from vertical, x +0.32 at the tip against -0.07 at the
    # shoulder), so B0b's "within 0.05 H of the shoulder-to-hand chord" test
    # left the elbows in the torso and hung only the hands (measured: torso
    # y +/-0.68, upperarm0 41 faces). Widening the chord radius makes the
    # test "outboard of the arm-root ring and above the belt", which this
    # figure needs and which no pack face reaches (the pack is |y| < 0.20
    # behind x -0.2; every face outboard of the ring sits at x -0.2..+0.34).
    kdf.R_ARM_F = ARM_CHORD_RADIUS_F
    _blob = kit.blob

    def _lean_blob(name, at, radius, squash=(1.0, 0.9, 0.85), sides=9, rings=3, wobble=0.06, role="uniform"):
        return _blob(name, at, radius, squash=squash, sides=BLOB_SIDES, rings=BLOB_RINGS, wobble=wobble, role=role)

    kit.blob = _lean_blob
    src, height, mat = kdf._load_figure(TEAM)

    parts, bones, forced, infos = [], [], {}, {}
    for spec in FIGURES:
        p, b, f, info = kdf._figure(src, height, mat, spec)
        parts += p
        bones += b
        forced.update(f)
        infos[spec["prefix"]] = info
    bpy.data.objects.remove(src, do_unlink=True)

    # --- the rifleman's rifle, level at the hung right hand (B0b, demo_b) --
    rf = FIGURES[0]
    wrist = Vector(infos["zk_rifle"]["joints"]["arm"][1]["wrist"]) + Vector((rf["x"], rf["y"], 0.0))
    anchor_kit = Vector(rig._weapon_anchor((rf["x"], rf["y"], 0.0), 0.0, "standing", False))
    anchor_want = wrist + Vector((0.03, 0.0, 0.065))
    rifle = rig._weapon_parts("zk_rifle", (rf["x"], rf["y"], 0.0), posture="standing", aim=False)
    for ob in rifle:
        kdf._transform(ob, Matrix.Translation(anchor_want - anchor_kit))
        forced[ob] = "zk_rifle_forearm_R"
    parts += rifle

    # --- the operator's whip, on his spine ---------------------------------
    rd = FIGURES[1]
    whip = _whip(infos["zk_radio"], rd["x"], rd["y"])
    forced.update({ob: "zk_radio_spine" for ob in whip})
    parts += whip

    # --- the spotter's tripod scope, on the team's static prop bone --------
    tripod = _tripod(infos["zk_spot"]["eye_z"])
    bones.append(rig._prop_bone((TRIPOD_AT[0], TRIPOD_AT[1], 0.10)))
    forced.update({ob: "prop" for ob in tripod})
    parts += tripod

    arm_obj = rig.build_armature(bones)
    rig.rig_parts(parts, arm_obj, forced, {s["prefix"] for s in FIGURES})
    merged = rig.join_by_role(parts)
    for role, ob in merged.items():
        mats = [m.name for m in ob.data.materials if m is not None]
        if len(mats) > 1:
            raise SystemExit(f"role {role} joined with {len(mats)} materials -- a blob missed _pin_uv")

    # --- clips: rig.py's own builders, with THIS team's figures ------------
    speed = _staged_speed()
    ground_m = speed * rig.move_seconds() * rig.TILE_M
    gait = rig.gait_amplitudes(ground_m / rig.BASE_BOOT_TRAVEL_M, 0.0)
    gait.update(team=TEAM, speed=speed, ground_m=ground_m)
    rig.build_idle_clip(arm_obj, FIGURES)
    rig.build_move_clip(arm_obj, FIGURES, gait)
    rig.build_fire_clip(arm_obj, FIGURES, None)
    for clip_name in ("down", "wreck"):
        rig._new_action(arm_obj, clip_name)
        rig._key_death_visibility(arm_obj.pose.bones, FIGURES, "prop" in arm_obj.pose.bones, alive=False)
    log(f"gait for speed {speed} tiles/s: ground {ground_m:.3f} m, scale {gait['scale']:.3f}")

    stray = [o.name for o in bpy.data.objects if o is not arm_obj and o not in merged.values()]
    if stray:
        raise SystemExit(f"objects in the scene that are neither the rig nor a role mesh: {stray}")
    kdf._prepare_texture(mat)
    kdf.export_glb_textured(arm_obj, OUT_PATH)
    tris = {role: len(ob.data.polygons) for role, ob in merged.items()}
    log(f"wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes), roles {sorted(merged)}, "
        f"{sum(tris.values())} tris {tris}, clips {[a.name for a in bpy.data.actions]}")
    return OUT_PATH


if __name__ == "__main__":
    build_team()
