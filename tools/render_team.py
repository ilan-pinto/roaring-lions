"""Render an infantry team as a sprite sheet, from tools/units/teams.py.

Usage:

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_team.py -- inf_squad at_team
    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/render_team.py -- --probe        # one facing per team
    python3 tools/quantize_sprites.py --sprites assets/sprites
    pnpm validate:assets

`--probe` is the sequencing that matters. Nine human figures have to stay under
the art gate's 0.88 pairwise limit, and rendering 1152 sprites before finding out
wastes an hour and creates pressure to move the limit instead of the massing. A
probe renders one facing of one clip per team, which is enough to measure the
whole IoU matrix.

Three ways this differs from render_vehicle.py, all forced by the source being
generated rather than loaded:

  * **Metres per unit is exactly 1.0**, not derived. kit.py builds at metres by
    construction, so there is nothing to normalise. Deriving it would be actively
    wrong: a three-figure team's longest extent is its *spread*, so declaring
    real_metres as a soldier's 1.8 would shrink the team until the whole group
    was 1.8 m across and each soldier about 0.7 m tall.
  * **The frame is measured over every clip and frame**, then reused for all of
    them. A clip that reframes itself makes the unit jump the moment it changes
    clip, which is the bug the soldier sheet's "frame once, on the idle pose"
    comment already guards against. Here `down` is much wider than `idle`, so the
    union is not optional.
  * **The scene is rebuilt per frame.** With no armature a clip is different
    geometry, so there is nothing to pose.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "units"))

import teams  # noqa: E402
from dimetric import (  # noqa: E402
    AZIMUTH,
    ELEVATION as DIMETRIC_ELEVATION,
    SIZE_CLASS,
    build_lights,
    ortho_scale_for_turning,
    tiles_across,
    unit_scale,
)

SIZE = 256
SAMPLES = 48
FACINGS = 16
FRAME_MARGIN = 1.06
SIZE_CLASS_NAME = "infantry"

#: Role -> palette key, per faction ramp. `uniform` and `webbing` are the only
#: two that differ; a rifle is a rifle on either side.
#:
#: No team-band colour anywhere: the art gate rejects reserved bands in static
#: art by name, and saturated colour is reserved for VFX and markers.
#:
#: Both bases sit at the *lightest* end of their ramp because **a figure renders at
#: roughly half its base value.** Measured: a dust.3 (#AC8248) uniform came out
#: lit at #563F22, which sits 28 away from dust.6 and 30 from limestone.8 -- close
#: enough that it scattered across both ramps and read as neither. Aiming a base
#: directly at the tone wanted is the mistake, and it is not visible from the
#: palette.
#:
#: Both were lifted a further step once the figure gained its personal kit. Every
#: pouch, pad, cuff, strap and boot is the `webbing` tone, and there are now
#: fourteen of them, so at olive.1/olive.2 nearly half the figure went dark:
#:
#:   olive.1 / olive.2   olive 47%, shadow 46%   <- half the soldier in shadow
#:   olive.0 / olive.1   olive 61%, gunmetal 31%, shadow 7%   <- chosen
#:
#: and for the enemy, dust 49% / limestone 36%. The gunmetal share is grey-green
#: and reads as shading at this size; the shadow share was reading as holes.
#:
#: There is no `skin` anywhere on the figure. It was a bare face and bare hands,
#: and it quantized into *terracotta* -- orange-red specks that read as blood
#: spatter, worst on the dust-ramp enemy. The reference figure is fully covered, so
#: a balaclava and gloves are both more accurate and the fix.
#: Gear leaves the uniform's ramp entirely. A second step of the same green read
#: as shading rather than as equipment, so KDF carry grey nylon webbing against
#: olive, and the militia wear *olive* gear over tan clothes -- scavenged and
#: mismatched, which is what an irregular cell should look like and which keeps
#: the two factions' dominant tones apart regardless.
ROLE_PALETTE = {
    "kdf": {"uniform": "olive.0", "webbing": "gunmetal.2"},
    "enemy": {"uniform": "dust.0", "webbing": "olive.1"},
}

#: Boots and faces are the same on both sides, so they live here rather than in
#: the faction table. Boots are `gunmetal.3` (#363B39) rather than a shadow entry:
#: a figure renders at roughly half its base, so this lights *down* to shadow and
#: comes out actually black, where a shadow base would go to pure black and read
#: as a hole punched in the sprite.
#:
#: The palette has no skin tone -- ART_PIPELINE.md section 1 makes desaturation a
#: mechanical decision, not an aesthetic one -- so a face is the light end of
#: `dust`, which at this size is the correct read anyway: a warm dot under the
#: helmet. `dust.2` was the earlier mistake, lighting into terracotta.
BODY_PALETTE = {"boot": "gunmetal.3", "face": "dust.1"}

#: Ambient, and why a figure needs it when a vehicle does not.
#:
#: render_building.py already recorded this: the vehicle rig is a 55-degree key
#: against a black world, which works because a vehicle is mostly horizontal
#: surface. A building is mostly vertical wall and comes out near-black without
#: ambient. **A standing soldier is also mostly vertical surface**, and the first
#: pass here used the vehicle rig and rendered nine teams as near-black blobs.
#:
#: Swept, measuring which palette band the quantizer actually chose for the KDF
#: uniform, since that is the thing that was failing:
#:
#:   amb 0.00 -> shadow 91%, olive  6%   (the bug: figures read as holes)
#:   amb 0.28 -> olive  59%, shadow 39%
#:   amb 0.35 -> olive  68%, shadow 29%  <- chosen
#:   amb 0.42 -> olive  44%, gunmetal 41%
#:   amb 0.55 -> gunmetal 51%, olive 39%
#:   amb 0.75 -> olive  62%, gunmetal 34%
#:
#: **The response is not monotonic**, which is the part worth recording. Past 0.4
#: the lit mid-tone lands between olive.1 and olive.2 and snaps to gunmetal, so
#: the soldiers turn grey; by 0.75 it has climbed back out. Brighter is not safer,
#: and 0.35 is a peak rather than a floor.
#:
#: The ambient colour is warm, copied from render_building.py. An earlier
#: green-grey (0.52, 0.53, 0.46) tinted everything toward olive regardless of base
#: colour, which put the *enemy* at 81% olive and collapsed the faction channel
#: this table exists to provide.
AMBIENT = float(os.environ.get("RL_TEAM_AMBIENT", "0.35"))
AMBIENT_COLOR = (0.55, 0.50, 0.42, 1.0)
SHARED_PALETTE = {
    "weapon": "gunmetal.3",
    "metal": "gunmetal.2",
    "wood": "dust.4",
    "charge": "gunmetal.1",
}
#: A casualty. Dark enough to read as down at 25 px without leaving the palette.
CASUALTY_KEY = "shadow.1"


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def palette_linear(key):
    """A palette colour as linear RGB, ready for a Blender base colour.

    Same shape as render_building.palette_linear. Duplicated rather than imported
    because that module runs a full building render at import time; splitting it
    out is worth doing when a third caller appears.
    """
    with open(os.path.join(REPO, "data", "palette.json")) as fh:
        pal = json.load(fh)
    band, name = key.split(".", 1)
    if band in pal["ramps"]:
        hexv = pal["ramps"][band]["colors"][int(name)]
    else:
        hexv = pal["reserved"][band]["colors"][name]
    r, g, b = (int(hexv[i:i + 2], 16) / 255.0 for i in (1, 3, 5))
    return (_srgb_to_linear(r), _srgb_to_linear(g), _srgb_to_linear(b), 1.0)


def _shader(name, colour, roughness=0.88):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = colour
    bsdf.inputs["Roughness"].default_value = roughness
    out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def apply_materials(parts, faction, casualty=False):
    """Assign one material per role. A part with no `rl_role` is a bug in the kit,
    not something to guess at, so it raises."""
    cache = {}
    for ob in parts:
        role = ob.get("rl_role")
        if role is None:
            raise SystemExit(f"{ob.name} carries no rl_role -- kit.py must set one")
        key = CASUALTY_KEY if casualty else (
            ROLE_PALETTE[faction].get(role)
            or BODY_PALETTE.get(role)
            or SHARED_PALETTE.get(role)
        )
        if key is None:
            raise SystemExit(f"no palette key for role {role!r} (faction {faction})")
        if key not in cache:
            cache[key] = _shader(f"Team_{key.replace('.', '_')}", palette_linear(key))
        ob.data.materials.clear()
        ob.data.materials.append(cache[key])


def frame_points(team_id):
    """Every vertex the sheet will ever show, so one frame fits all clips.

    Rebuilds each clip to measure it. That costs a few scene builds and buys the
    guarantee that a unit does not resize when it goes to ground.
    """
    pts = []
    for clip, spec in teams.CLIPS.items():
        for f in range(spec["frames"]):
            parts, _ = teams.build(team_id, clip, f)
            bpy.context.view_layer.update()
            for ob in parts:
                for v in ob.data.vertices:
                    pts.append(ob.matrix_world @ v.co)
    return pts


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.render.resolution_x = SIZE
    sc.render.resolution_y = SIZE
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = AMBIENT_COLOR
    bg.inputs[1].default_value = AMBIENT
    sc.world = world
    build_lights(bpy.context.collection)
    return sc


def place_camera(sc, ortho_units, centre):
    cam_data = bpy.data.cameras.new("CAM")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("CAM", cam_data)
    bpy.context.collection.objects.link(cam)
    sc.camera = cam
    dist = max(ortho_units * 6.0, 12.0)
    horiz = math.cos(DIMETRIC_ELEVATION) * dist
    cam.location = (
        centre.x + horiz * math.cos(AZIMUTH),
        centre.y + horiz * math.sin(AZIMUTH),
        centre.z + math.sin(DIMETRIC_ELEVATION) * dist,
    )
    cam.rotation_euler = (math.pi / 2 - DIMETRIC_ELEVATION, 0.0, AZIMUTH + math.pi / 2)
    cam_data.ortho_scale = ortho_units
    return cam


def render_team(team_id, probe=False):
    _, faction, sheet = teams.TEAMS[team_id]
    out_dir = os.path.join(REPO, "assets", "sprites", sheet)

    # Frame from the union over every clip, in the team's own metres.
    pts = frame_points(team_id)
    xs = sorted(p.x for p in pts)
    ys = sorted(p.y for p in pts)
    # Ground contact is z=0 by kit construction, and the sprite anchors on the
    # team's footprint centre, so aim at ground level between the figures rather
    # than at the vertical middle of the mass.
    centre = Vector(((xs[0] + xs[-1]) / 2.0, (ys[0] + ys[-1]) / 2.0, 0.0))
    ortho_units = ortho_scale_for_turning(
        [(p.x, p.y, p.z) for p in pts], FRAME_MARGIN, aim=tuple(centre)
    )
    # Exactly 1.0: kit.py builds at metres. See this module's docstring.
    mpu = 1.0
    derived = tiles_across(ortho_units * mpu)
    scale = unit_scale(ortho_units * mpu, SIZE_CLASS_NAME)
    real_m = max(xs[-1] - xs[0], ys[-1] - ys[0], max(p.z for p in pts))
    print(
        f"[{team_id}] frame {ortho_units:.3f} m, longest extent {real_m:.2f} m, "
        f"derived {derived:.4f} -> scale {scale:.4f} ({scale * 64:.0f}px canvas)"
    )

    clips = {"idle": teams.CLIPS["idle"]} if probe else teams.CLIPS
    facings = 1 if probe else FACINGS
    os.makedirs(out_dir, exist_ok=True)
    files = []
    for clip, spec in clips.items():
        for frame in range(spec["frames"]):
            parts, faction = teams.build(team_id, clip, frame)
            apply_materials(parts, faction, casualty=(clip == "wreck"))
            sc = setup_render()
            pivot = bpy.data.objects.new("PIVOT", None)
            pivot.location = centre
            bpy.context.collection.objects.link(pivot)
            for ob in parts:
                ob.parent = pivot
                ob.matrix_parent_inverse = Matrix.Translation(-centre)
            place_camera(sc, ortho_units, centre)
            step = 2.0 * math.pi / FACINGS
            for f in range(facings):
                pivot.rotation_euler.z = f * step
                name = f"{clip}_f{f:02d}_{frame:03d}.png"
                sc.render.filepath = os.path.join(out_dir, name)
                bpy.ops.render.render(write_still=True)
                files.append({"clip": clip, "facing": f, "frame": frame, "file": name})

    manifest = {
        "unit": team_id,
        "credit": "Composed from tools/units/kit.py for this repository, CC BY-SA 4.0",
        "facings": FACINGS,
        "size": SIZE,
        # The kit builds each team facing +x, so sprite 0 already looks along +x.
        "facingOffset": 0,
        "facingReverse": True,
        "scale": round(scale, 4),
        "derivedScale": round(derived, 4),
        "sizeClass": SIZE_CLASS_NAME,
        "classMultiplier": SIZE_CLASS[SIZE_CLASS_NAME],
        "realMetres": round(real_m, 3),
        "metresPerModelUnit": mpu,
        "frameMetres": round(ortho_units * mpu, 3),
        "clips": {k: v for k, v in clips.items()},
        "files": files,
    }
    with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"[{team_id}] DONE {len(files)} frames -> {out_dir}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    probe = "--probe" in argv
    names = [a for a in argv if not a.startswith("--")] or list(teams.TEAMS)
    for name in names:
        if name not in teams.TEAMS:
            raise SystemExit(f"unknown team {name!r}; have {sorted(teams.TEAMS)}")
        render_team(name, probe=probe)


if __name__ == "__main__":
    main()
