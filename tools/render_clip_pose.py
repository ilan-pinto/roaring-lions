"""Render one CLIP of one mesh unit, at one frame, through the game's own
camera -- a high-resolution look at a pose that `pnpm validate:meshes`
photographs only at 256 px and only for `idle`.

    blender -b -P tools/render_clip_pose.py -- \\
        --glb art/meshes/meshy_soldier.glb \\
        --clip fire --frame 0 --size 1400 \\
        --out .superpowers/sdd/.../fire_after.png

Why this exists. `tools/render_mesh_gate.py` renders every GLB, but always
`idle` and always at `SIZE = 256`, because its job is a silhouette IoU and a
palette check rather than a look at a pose. Twice now a facing question on
this asset ("is 33 degrees of barrel offset actually visible?") could not be
settled by eye, because the browser draws a soldier at about 25 px and canvas
readback is black by design (`preserveDrawingBuffer` stays off in shipping
code). A still, at a size a person can actually look at, from the SAME rig
the sprite pipeline uses, is the instrument for that.

Deliberately reuses `render_mesh_gate.py`'s own imports rather than
re-deriving them: `render_rig.build_rig`/`frame_camera`/`world_bounds`/
`wipe_scene` (the dimetric camera at the rig's own azimuth -- the object
rotates, the camera does not) and `render_team.apply_materials` with its
AMBIENT tuning, which the gate records as necessary because a standing figure
is mostly vertical surface and renders near-black under the bare key+fill rig
alone.

Read-only with respect to everything it imports, and it writes exactly one
PNG, to a path the caller names.
"""
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "units"))

from render_rig import build_rig, frame_camera, wipe_scene, world_bounds  # noqa: E402
import render_mesh_gate as gate  # noqa: E402
import render_team  # noqa: E402


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = {}
    for i in range(0, len(argv) - 1, 2):
        args[argv[i].lstrip("-")] = argv[i + 1]
    for required in ("glb", "clip", "out"):
        if required not in args:
            raise SystemExit(
                "usage: blender -b -P tools/render_clip_pose.py -- "
                "--glb <path> --clip <name> --out <path.png> [--frame N] [--size N] [--samples N]"
            )
    return args


def main():
    args = parse_args()
    size = int(args.get("size", 1400))
    frame = int(args.get("frame", 0))

    wipe_scene()
    bpy.ops.import_scene.gltf(filepath=args["glb"], import_scene_extras=True)
    gate.cull_unroled_meshes()

    mesh_objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not mesh_objs:
        raise SystemExit(f"{args['glb']}: no mesh geometry after import")

    unit_id = os.path.splitext(os.path.basename(args["glb"]))[0]
    faction, _sheet = gate.team_registry_entry(unit_id)
    render_team.apply_materials(mesh_objs, faction or "kdf", casualty=False)

    action = bpy.data.actions.get(args["clip"])
    if action is None:
        raise SystemExit(
            f"{args['glb']}: no clip named {args['clip']!r} -- "
            f"have {[a.name for a in bpy.data.actions]}"
        )
    posed = False
    for obj in bpy.context.scene.objects:
        if obj.type != "ARMATURE":
            continue
        if obj.animation_data is None:
            obj.animation_data_create()
        obj.animation_data.action = action
        # Blender 4.4+ slotted actions: `.action` alone can leave a stale slot
        # bound, and every reader of this file has been bitten by it once.
        obj.animation_data.action_slot = action.slots[0] if action.slots else None
        posed = True
    if not posed:
        raise SystemExit(f"{args['glb']}: no armature -- nothing to pose")
    bpy.context.scene.frame_set(int(action.frame_range[0]) + frame)
    bpy.context.view_layer.update()

    cam = build_rig(size)
    bpy.context.scene.cycles.samples = int(args.get("samples", 256))
    bg = bpy.context.scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = render_team.AMBIENT_COLOR
    bg.inputs[1].default_value = render_team.AMBIENT

    lo, hi = world_bounds()
    frame_camera(cam, lo, hi)

    out = os.path.abspath(args["out"])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.context.scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print(f"rendered {unit_id} clip={args['clip']} frame={frame} size={size} -> {out}")


if __name__ == "__main__":
    main()
