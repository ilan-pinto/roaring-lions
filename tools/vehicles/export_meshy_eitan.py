"""Export the Meshy-generated Eitan APC as a textured hull + kit RWS glTF,
mesh contract v2 -- batch B0a of GH-286 (`docs/art/style-bible.md` section 6,
`docs/art/meshy-prompts-units.md` section 5).

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/export_meshy_eitan.py

Writes `art/meshes/vehicles/apc_eitan.glb`, replacing the kit-built hull
(`tools/export_mesh_vehicle.py`, 63,492 tris) with a 7,951-tri Meshy remesh
carrying its own base_color bake. `SPECS["apc_eitan"].mesh_owner` in
`export_mesh_vehicle.py` names this script, so `export_mesh_vehicle.py -- all`
refuses to regenerate the kit hull over it (the `dozer_d9` incident recorded
in `tools/mesh_ownership.py`). Re-run `pnpm wreck:meshes -- --id=apc_eitan`
after this script: the export carries no `death_root`.

SOURCE. One Meshy text-to-3D preview (meshy-6), refined with a 2k texture,
then remeshed by Meshy at 8,000 triangles -- the numbers table's proposal for
a wheeled APC (`style-bible.md` section 3 has no heavy-vehicle row; eight
wheels need more than the light 5,000, and `mbt_lavi` ships at 8,346). Looked
up from `art/meshy/ledger.jsonl` by name, as `export_meshy_props.py` does.
AI-generated (Meshy), disclosed per CONTRIBUTING.md; task ids in
`docs/ASSET_PROVENANCE.md`.

  preview 01a0f26e-3308-73bd-96b5-3cc85edcadfd
  refine  01a0f26f-63b4-77e3-88b8-cfc19c47b0d5   (2k)
  remesh  01a0f272-a1ff-72dd-b418-2d1f4c099595   (7,951 tris, textured)

THE BIBLE'S OPEN QUESTION IS ANSWERED HERE: a remesh of a REFINED task keeps
its texture. Measured 2026-09-30 on this remesh's own bytes -- one
`BakedMaterial` with `baseColorTexture` (2048), `normalTexture` (2048) and
`metallicRoughnessTexture` (4096), re-baked onto the remesh's fresh
`TEXCOORD_0`. So the step order in section 4 (refine, THEN remesh) stands and
no `retexture` fallback was needed; the Eitan cost the planned 35 credits.

SCALE. `EITAN_HULL/manifest.json`'s `realMetres` (7.129) over the remesh's
longest axis, read at export time so the mesh and the sprite it stands beside
cannot drift -- the same rule `export_mesh_vehicle.py` applies. Size class
`heavy_vehicle` is x1.0, so nothing else is applied.

ORIENTATION, measured (2026-09-30, on the remesh): long axis X; the roof
profile is LOW at -X (the raked glacis, z max 0.03 over the first 0.2 units)
and steps up toward +X (0.21-0.23 over the rear two thirds), so the nose is
-X and the hull takes a 180-degree Z rotation. Origin at the ground centre of
the footprint (contract v2), wheels on z = 0.

TWO CUTS, both recorded rather than hidden. The prompt asked for "a small
empty round mounting ring on the roof with no weapon fitted"; the preview
delivered the ring AND a small cannon on the front deck (a thin tube along the
centreline, x -0.72..-0.50, z 0.11..0.16, |y| < 0.03, on a mount at
x -0.49) and a whip antenna at the rear. The 8,000-tri remesh dropped the
antenna on its own (z max 0.538 -> 0.232). The cannon is removed here -- the
RWS below is this unit's weapon (`rws_50`), and a second gun on the glacis
would read as an IFV -- by deleting every face whose centroid sits in that
box and filling only the loop those deletions opened (`_cut_gun`). The
remesh's UV seams split vertices, so a blanket `holes_fill` would try to fill
every seam; `_cut_gun` passes it only the edges that BECAME boundary.

ROLES. Two textured hull meshes and two palette RWS meshes:

  hull_rubber   the eight tyres -- every face whose centroid lies within
                `WHEEL_R` of an axle in the XZ plane and outboard of
                `WHEEL_AY`. The axles are found from the tyre verts
                themselves (`_axles`: the four clusters of |y| > 0.28,
                z < zmin + 0.24 verts along x); the radius comes from the
                radial histogram around them (tread mass at r 0.14-0.20,
                an EMPTY band at 0.20-0.22 -- the wheel-arch clearance -- then
                the skirt), the same signal `export_meshy_truck.py` used.
                `rubber` matters for the wreck pass: `DROP_ROLES` settles
                everything but the wheels.
  hull_hull     the rest of the remesh, texture and all.
  turret_metal  `kit.rws`'s mount and barrel, joined by role
  turret_plate  `kit.rws`'s gun shield

  turret_pivot  an empty carrying `extras.rl_pivot = "turret"` at the RING --
                the octagonal lip at (-0.67, +0.48) m on the roof, ~0.78 m
                across, read off a top-down grid render and refined to the
                lip's own centroid and top by `_ring_centre` (which refuses
                if the lip is not where the seed says). The lead's ruling
                (PR #290) is `kit.rws` on the empty ring and `turret_pivot`
                only -- no wheel pivots.

TEXTURE. The remesh's images arrive named `texture_0` / `normal` /
`texture_0_metallic_roughness`; `textured.prepare_vehicle_textures` looks for
`base_color` by prefix, so the base colour is renamed after checking it is
the image wired to the Principled BSDF's Base Color socket (not renamed by
position in a list). All three ship at `textured.TEXTURE_PX` (2048) -- the
lead: "dont drop resolution". The RWS parts carry no material: the runtime's
textured branch is per MESH, so they draw through `VEHICLE_ROLE_PALETTE
["apc_eitan"]`'s `metal`/`plate` slices, and `pnpm validate:meshes` repaints
the whole vehicle from the palette anyway.

DETERMINISM. No `mathutils.noise`; every threshold is a constant applied to
the source's own vertex data.
"""

The method lives in `export_meshy_apc.py` (spec-driven, shared with the
Kipod since the lead's 2026-09-30 follow-up); this file keeps the Eitan's
own record above and its `SPECS["apc_eitan"]` numbers are in that module.
Re-exporting through the shared module reproduced this vehicle's GLB
byte-for-byte when the code moved.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from export_meshy_apc import export  # noqa: E402

if __name__ == "__main__":
    export("apc_eitan")
