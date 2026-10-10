"""Photograph a TEXTURED mesh unit through the game's own dimetric camera, with
its own bake -- the look `tools/render_clip_pose.py` cannot give it.

    blender -b -P tools/render_baked_pose.py -- \\
        --glb art/meshes/vehicles/recon_drone.glb --out docs/art/sheets/a31-parts/recon_drone-idle.png \\
        [--clip idle] [--frame 0] [--size 1400] [--samples 128]

Why a second tool. `render_clip_pose.py` repaints every mesh from the palette
table (`render_team.apply_materials`) and refuses a file with no armature, so on
a textured vehicle it either raises (`no palette key for role 'glass'`) or paints
a stand-in for the photograph, and on a textured rider it flattens the bake into
the role colours -- the thing the lead is being asked to judge. This one keeps
the material the GLB ships (Blender's importer builds the Principled BSDF from
the glTF's base colour), and is otherwise the same instrument: `render_rig.py`'s
own camera and sun (the object rotates, the camera does not), the mesh gate's
`cull_unroled_meshes` / `hide_death_root`, and the infantry gate's ambient (a
standing figure is mostly vertical surface and renders near-black under the bare
key+fill alone). A rigged file is posed from the named clip (default `idle`);
an unrigged one (a vehicle) is photographed as imported.

Read-only with respect to everything it imports; writes exactly one PNG.
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
    for required in ("glb", "out"):
        if required not in args:
            raise SystemExit("usage: blender -b -P tools/render_baked_pose.py -- --glb <path> --out <path.png> "
                             "[--clip idle] [--frame N] [--size N] [--samples N]")
    return args


def main():
    args = parse_args()
    size = int(args.get("size", 1400))
    frame = int(args.get("frame", 0))
    clip = args.get("clip", "idle")

    wipe_scene()
    bpy.ops.import_scene.gltf(filepath=args["glb"], import_scene_extras=True)
    gate.cull_unroled_meshes()
    mesh_objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not mesh_objs:
        raise SystemExit(f"{args['glb']}: no mesh geometry after import")
    baked = [o.name for o in mesh_objs if any(m is not None and m.use_nodes and
             any(n.type == "TEX_IMAGE" and n.image for n in m.node_tree.nodes) for m in o.data.materials)]
    if not baked:
        raise SystemExit(f"{args['glb']}: no mesh carries a baked material -- "
                         "this tool photographs the bake; use render_clip_pose.py for a palette mesh")

    # A mesh that ships NO bake (moto_rpg's `weapon` launcher beside its baked
    # riders and bike) is palette-painted in the game (`buildMeshUnitTemplate`
    # decides per mesh), so it is painted here the same way rather than drawn
    # in the importer's default white.
    unbaked = [o for o in mesh_objs if o.name not in baked]
    if unbaked:
        faction, _sheet = gate.team_registry_entry(os.path.splitext(os.path.basename(args["glb"]))[0])
        render_team.apply_materials(unbaked, faction or "kdf", casualty=False)

    armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if armatures:
        action = bpy.data.actions.get(clip)
        if action is None:
            raise SystemExit(f"{args['glb']}: no clip named {clip!r} -- have {[a.name for a in bpy.data.actions]}")
        for obj in armatures:
            if obj.animation_data is None:
                obj.animation_data_create()
            obj.animation_data.action = action
            obj.animation_data.action_slot = action.slots[0] if action.slots else None
        bpy.context.scene.frame_set(int(action.frame_range[0]) + frame)
        bpy.context.view_layer.update()
        # A rigged file keeps its death pose under a root scaled to 0 by the live
        # clip, which still stretches `world_bounds`; unlink it as the portrait
        # tool does.
        for root in [o for o in bpy.context.scene.objects if o.name.endswith("death_root")]:
            for o in [root] + list(root.children_recursive):
                for c in list(o.users_collection):
                    c.objects.unlink(o)
    else:
        # A vehicle's kit (`kit_*`, contract v5) is not the shipped pose either.
        mesh_objs, _kit = gate.hide_kit_parts(mesh_objs)
        mesh_objs, _stashed = gate.hide_death_root(mesh_objs, args["glb"])

    cam = build_rig(size)
    bpy.context.scene.cycles.samples = int(args.get("samples", 128))
    bg = bpy.context.scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = render_team.AMBIENT_COLOR
    bg.inputs[1].default_value = render_team.AMBIENT
    lo, hi = world_bounds()
    frame_camera(cam, lo, hi)

    out = os.path.abspath(args["out"])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.context.scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print(f"rendered {os.path.basename(args['glb'])} clip={clip if armatures else '(unrigged)'} "
          f"size={size} baked meshes={len(baked)} -> {out}")


if __name__ == "__main__":
    main()
