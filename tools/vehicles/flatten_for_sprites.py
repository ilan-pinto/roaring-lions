"""Flatten the APC hero asset into a sprite-renderable source.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/flatten_for_sprites.py

Why this step exists. `tools/render_vehicle.py:setup()` re-parents only the mesh
*roots* onto its own PIVOT, on the correct assumption that a child follows its
root. But the hero asset's wheel and turret meshes have their geometry expressed
**relative to their animation pivots** -- that was the fix for the origins-at-zero
trap, and it is what lets the wheels spin. Handing that file straight to
render_vehicle would strip the pivots' transforms and stack all eight wheels on
the origin.

So: bake every world transform into vertex data, drop the rig, and write a plain
world-space model. The hero file keeps its animation; the sprite source is a
separate, flattened derivative of it.

Output:
    art/src/vehicles/eitan_apc.blend
plus the measured extent, which is what `real_metres` is declared against, and the
turret mesh names. render_eitan.py resolves those by prefix rather than pasting
the list -- at 1,763 parts a hand-typed set rots on the first rename -- so the
printed block is for reading, not for copying.
"""
import os
import sys

import bpy
from mathutils import Matrix

SRC = os.path.abspath("art/showcase/apc_detail.blend")
OUT = os.path.abspath("art/src/vehicles/eitan_apc.blend")

#: Meshes that traverse with the weapon station rather than the hull.
TURRET_PREFIXES = ("turret_", "mgun_coax", "aps_radar_")
#: Scene furniture that is not the vehicle.
DROP_PREFIXES = ("Ground", "APC_Path")


def main():
    bpy.ops.wm.open_mainfile(filepath=SRC)
    sc = bpy.context.scene

    # The Follow Path constraint would bake the vehicle's position on the curve
    # into every vertex. Clear the rig's animation and constraints first, and
    # evaluate at frame 1 so the turret and wheels are at rest.
    sc.frame_set(1)
    for ob in bpy.data.objects:
        for c in list(ob.constraints):
            ob.constraints.remove(c)
        if ob.animation_data:
            ob.animation_data_clear()
        ob.location = (0.0, 0.0, 0.0) if ob.type == "EMPTY" and ob.name == "APC_Root" else ob.location
    for ob in bpy.data.objects:
        if ob.type == "EMPTY" and ob.name.startswith("pivot_"):
            ob.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()

    turret_names, baked = [], 0
    for ob in list(bpy.data.objects):
        if ob.type != "MESH":
            continue
        if ob.name.startswith(DROP_PREFIXES):
            bpy.data.objects.remove(ob, do_unlink=True)
            continue
        # Bake the full world matrix into the vertices, then clear the transform
        # and the parent. After this the mesh is in world space and carries no
        # dependence on the rig above it.
        # Order matters, and getting it wrong is silent. Assigning `matrix_world`
        # while the object is still parented makes Blender solve for a *local*
        # matrix; clearing the parent afterwards then promotes that local matrix to
        # world, displacing the part by the inverse of its pivot -- exactly
        # cancelling the position just baked into its vertices. Unparented parts are
        # unaffected, so the hull looked right while all eight wheels and the entire
        # turret collapsed onto the origin, buried inside the hull. That shipped for
        # every Eitan sprite until now, and sent me chasing wheel colour, wheel
        # track, fenders, arches and cage geometry for a fault that was in the export.
        #
        # So: bake, then unparent, then zero the *basis* -- at which point local and
        # world are the same thing and there is nothing left to cancel.
        mw = ob.matrix_world.copy()
        ob.data.transform(mw)
        ob.parent = None
        ob.matrix_parent_inverse = Matrix.Identity(4)
        ob.matrix_basis = Matrix.Identity(4)
        ob.data.update()
        baked += 1
        if ob.name.startswith(TURRET_PREFIXES):
            turret_names.append(ob.name)

    # The rig, cameras and lights are all render_vehicle's job now.
    for ob in list(bpy.data.objects):
        if ob.type in {"EMPTY", "CAMERA", "LIGHT"}:
            bpy.data.objects.remove(ob, do_unlink=True)
    for cu in list(bpy.data.curves):
        if cu.users == 0:
            bpy.data.curves.remove(cu)

    # Drop the showcase's video output settings. render_vehicle.py guards against
    # them now, but a sprite source that claims to render an mp4 to art/showcase/
    # is misleading on its face, and every consumer would have to know to reset it.
    r = sc.render
    if hasattr(r.image_settings, "media_type"):
        r.image_settings.media_type = "IMAGE"
    r.image_settings.file_format = "PNG"
    r.filepath = "/tmp/"
    sc.frame_start = sc.frame_end = 1

    # Measure what came out, so the spec's real_metres is set against a number.
    xs, ys, zs = [], [], []
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        for v in ob.data.vertices:
            xs.append(v.co.x); ys.append(v.co.y); zs.append(v.co.z)
    L, W, H = max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT)

    print(f"baked {baked} meshes into world space; rig removed")
    print(f"extent  L {L:.3f}  W {W:.3f}  H {H:.3f}  (model units)")
    print(f"longest dimension: {max(L, W, H):.3f} units -> declare real_metres against this")
    print(f"turret meshes ({len(turret_names)}):")
    print("TURRET_MESHES = frozenset({")
    for n in sorted(turret_names):
        print(f'    "{n}",')
    print("})")
    print(f"saved {OUT}")


if __name__ == "__main__":
    main()
