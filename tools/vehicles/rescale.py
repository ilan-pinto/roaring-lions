"""Bring an imported, post-export-rescaled vehicle back to its authored frame.

`pnpm rescale:meshes` (`tools/src/meshes/rescale-pass.ts`, factors in
`rescale-contract.ts`) scales a vehicle GLB AFTER its Blender export and marks
the scene `extras.rl_rescale = {factor}`. Every Blender script that imports a
SHIPPED vehicle and places literal metres on it -- `export_vehicle_kit.py`
(via `kit_vehicles.py`), `kit_blockout.py`, `export_officer_armour.py` -- was
measured in the export's own frame (the Lavi's 6.32 m), so it calls
`unscale_imported()` straight after the import: the meshes and the object
locations are divided by the factor and the mark is dropped, so nothing it
writes carries a stale mark. Its output is then in the authored frame again,
and goes back through `pnpm rescale:meshes` before the rest of the pipeline.

A file with no mark is left alone (factor 1), so every other vehicle is
unaffected.
"""
import bpy
from mathutils import Matrix

EXTRAS_KEY = "rl_rescale"


def unscale_imported(log=print):
    """Divide the scene by its `rl_rescale` factor and drop the mark. Returns
    the factor (1.0 when the import carried none)."""
    factor = None
    for scene in bpy.data.scenes:
        if EXTRAS_KEY in scene:
            f = float(scene[EXTRAS_KEY]["factor"])
            if factor is not None and f != factor:
                raise SystemExit(f"two scenes disagree on {EXTRAS_KEY}: {factor} vs {f}")
            factor = f
            del scene[EXTRAS_KEY]
    if factor is None:
        return 1.0
    s = 1.0 / factor
    m = Matrix.Scale(s, 4)
    done = set()
    for ob in bpy.data.objects:
        if ob.type == "MESH" and ob.data.name not in done:
            ob.data.transform(m)
            ob.data.update()
            done.add(ob.data.name)
        ob.location = ob.location * s
    bpy.context.view_layer.update()
    log(f"[rescale] imported file was rescaled x{factor}: divided back to its authored frame")
    return factor


#: The scene marker and the material extras key `pnpm mark:meshes` writes (`tools/src/meshes/mark-contract.ts`).
MARK_SCENE_KEY = "rl_team_mark_pass"
MARK_MATERIAL_KEY = "rl_team_mark"


def drop_imported_mark(log=print):
    """Drop a team mark the imported SHIPPED Lavi carries (L3, GH-943).

    The command Lavi and the Ambush Tank are cut from the shipped `mbt_lavi.glb`, which now carries the Lavi's own
    mark (`rl_team_mark` on its material, `rl_team_mark_pass` on its scene). Each variant gets its own boxes from
    `pnpm mark:meshes` AFTER this export; carried through Blender, the Lavi's boxes would ride in on the variant's
    material (placed for a hull this one does not have) and the pass would refuse the file as already marked.
    Returns how many entries it dropped.
    """
    n = 0
    for scene in bpy.data.scenes:
        if MARK_SCENE_KEY in scene:
            del scene[MARK_SCENE_KEY]
            n += 1
    for mat in bpy.data.materials:
        if MARK_MATERIAL_KEY in mat:
            del mat[MARK_MATERIAL_KEY]
            n += 1
    if n:
        log(f"[mark] dropped {n} imported team-mark entr{'y' if n == 1 else 'ies'}: the variant is marked by its own pass")
    return n
