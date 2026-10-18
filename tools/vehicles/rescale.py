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
