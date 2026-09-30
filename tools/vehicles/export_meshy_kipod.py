"""Export the Meshy-generated Kipod screen carrier as a textured hull + kit
RWS glTF, mesh contract v2 -- the lead's follow-up to batch B0a (GH-286,
2026-09-30: "the kipod looks terrible" beside the Meshy Eitan).

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/export_meshy_kipod.py

Writes `art/meshes/vehicles/apc_kipod.glb`, replacing the kit build from
`author_apc_kipod.py` (808 tris, palette-painted, no pivot). `SPECS
["apc_kipod"].mesh_owner` in `export_mesh_vehicle.py` names this script, so
`export_mesh_vehicle.py -- all` refuses to regenerate the kit hull over it.
Re-run `pnpm wreck:meshes -- --id=apc_kipod` after this script.

SOURCE. One Meshy text-to-3D preview (meshy-6), refined with a 2k texture,
remeshed at 8,000 triangles; prompt and numbers table in
`docs/art/meshy-prompts-units.md` section 6, task ids in
`docs/ASSET_PROVENANCE.md`. AI-generated (Meshy), disclosed per CONTRIBUTING.md.

  preview 01a0f2ac-f465-7172-aef7-0fcdb64f3f7a
  refine  01a0f2ae-970b-779d-9b4d-e55d2802ad95   (2k)
  remesh  01a0f2b4-c107-72f6-9e22-87fd1836afcf

What the preview delivered against the prompt: six wheels on three evenly
spaced axles, a tall boxy compartment with a flat roof over the full length,
a large empty roof ring, and -- as on the Eitan -- a small gun on the front
roof and a whip antenna, both of which the 8,000-tri remesh dropped by
itself, so nothing is collapsed here. The proud slab screens the prompt
asked for read as flank plating rather than standoff slabs.

The method and this vehicle's measured numbers (axles, tyre radius, ring
seed) are `export_meshy_apc.py`'s `SPECS["apc_kipod"]`; the ring seed was
read off a top-down metre-grid render of the `--no-rws` pass.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from export_meshy_apc import export  # noqa: E402

if __name__ == "__main__":
    export("apc_kipod")
