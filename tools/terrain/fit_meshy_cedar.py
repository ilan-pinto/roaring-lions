"""Fit the Meshy Lebanon cedar to the decor contract and derive three heights
(GH-322, the Sur highland).

    /Applications/Blender.app/Contents/MacOS/Blender --background \\
        --factory-startup --python tools/terrain/fit_meshy_cedar.py
    pnpm encode:meshes

SOURCE (AI-generated, Meshy, disclosed per CONTRIBUTING.md): the remesh
`art/meshy/cedar-libani-20261001-01a0f63b/model.glb` (task
01a0f63b-65fb-74f9-a672-098b61015362, `--polycount 1500` -> 1,523 tris) of the
text-to-3D preview 01a0f636-1df3-70c1-b014-5cd62fc58c7e (meshy-6, lowpoly,
20,963 tris). 25 credits, both tasks in `art/meshy/ledger.jsonl`; the prompt
is recorded there. No texture was ever requested: decor is a palette ramp
slice, zero materials by contract.

OUTPUT: `art/meshes/decor/cedar_{0,1,2}.glb`, 5.4 / 4.4 / 3.3 m -- a uniform
scale of the one base. A real cedar is 20-35 m; the game's trees are read at
the size of the man beside them (olive 3.4 m, desert tree 2.9 m), and a first
cut at 6.6 m dwarfed a Lavi. 5.4 m is 1.6x the olive and still under two
storeys.

ROLES, split without hand work:
  * trunk  -- faces whose centre lies within 1.35x the narrowest horizontal
              slice between 10 % and 45 % of the height (the bare trunk
              between the plates) AND below 86 % of the height, plus the root
              flare below 8 %;
  * foliage -- everything else.
The 86 % cap is load-bearing: without it the flat table top, which sits on
the axis, fell into the trunk role and drew as a tan patch on the crown.
Measured on the shipped remesh: 250 trunk / 1,273 foliage faces.

CONTRACT (`tools/validate_mesh_assets.py` `check_decor_meshes`): zero
materials, zero images, zero textures; every mesh node carries
`extras.rl_role` in {foliage, trunk}. UVs are stripped (nothing samples
them). Y-up, metres, origin at the trunk base, centred on the trunk axis.
Deterministic: no noise, no randomness; same model in, same bytes out.
"""
import math
import os

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(REPO, "art", "meshy", "cedar-libani-20261001-01a0f63b", "model.glb")
OUT_DIR = os.path.join(REPO, "art", "meshes", "decor")
HEIGHTS = [5.4, 4.4, 3.3]
TRUNK_SLICE_LO, TRUNK_SLICE_HI = 10, 45  # percent of height
TRUNK_RADIUS_FACTOR = 1.35
TRUNK_TOP = 0.86
ROOT_FLARE = 0.08
CREDIT = (
    "Lebanon cedar (Cedrus libani) decor -- AI-generated (Meshy, tasks "
    "01a0f636-1df3-70c1-b014-5cd62fc58c7e / 01a0f63b-65fb-74f9-a672-098b61015362), "
    "disclosed per CONTRIBUTING.md; role-tagged, re-scaled and grounded for Roaring Lions"
)


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.active_object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.data.materials.clear()
    for uv in list(ob.data.uv_layers):
        ob.data.uv_layers.remove(uv)

    vs = [v.co.copy() for v in ob.data.vertices]
    zmin = min(v.z for v in vs)
    zmax = max(v.z for v in vs)
    xs = [v.x for v in vs]
    ys = [v.y for v in vs]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    h = zmax - zmin
    print(f"IMPORT: {len(ob.data.polygons)} faces, height {h:.3f}, footprint {max(xs) - min(xs):.3f} x {max(ys) - min(ys):.3f}")

    slices = []
    for k in range(TRUNK_SLICE_LO, TRUNK_SLICE_HI):
        z0 = zmin + h * k / 100
        z1 = z0 + h * 0.01
        ring = [math.hypot(v.x - cx, v.y - cy) for v in vs if z0 <= v.z < z1]
        if ring:
            slices.append(max(ring))
    if not slices:
        raise SystemExit("no vertices between 10% and 45% of the height -- not the cedar remesh")
    trunk_r = min(slices) * TRUNK_RADIUS_FACTOR
    print(f"trunk radius {min(slices):.3f} -> split radius {trunk_r:.3f}")

    def is_trunk(c: Vector) -> bool:
        on_axis = math.hypot(c.x - cx, c.y - cy) < trunk_r and c.z < zmin + TRUNK_TOP * h
        return on_axis or c.z < zmin + ROOT_FLARE * h

    bm = bmesh.new()
    bm.from_mesh(ob.data)
    n_trunk = 0
    for f in bm.faces:
        f.select = is_trunk(f.calc_center_median())
        n_trunk += int(f.select)
    bm.to_mesh(ob.data)
    bm.free()
    print(f"trunk faces {n_trunk} of {len(ob.data.polygons)}")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    trunk = [o for o in bpy.data.objects if o.type == "MESH" and o is not ob][0]
    fol = ob
    for role, o in (("trunk", trunk), ("foliage", fol)):
        o.name = role
        o.data.name = role
        for k in list(o.keys()):
            if k != "_RNA_UI":
                del o[k]
        o["rl_role"] = role

    scale0 = HEIGHTS[0] / h
    for o in (trunk, fol):
        for v in o.data.vertices:
            v.co = Vector(((v.co.x - cx) * scale0, (v.co.y - cy) * scale0, (v.co.z - zmin) * scale0))

    os.makedirs(OUT_DIR, exist_ok=True)
    prev = 1.0
    for i, height in enumerate(HEIGHTS):
        factor = (height / HEIGHTS[0]) / prev
        prev = height / HEIGHTS[0]
        for o in (trunk, fol):
            o.scale = (factor, factor, factor)
            o.select_set(True)
        bpy.context.view_layer.objects.active = fol
        bpy.ops.object.transform_apply(scale=True)
        path = os.path.join(OUT_DIR, f"cedar_{i}.glb")
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_format="GLB",
            use_selection=False,
            export_apply=True,
            export_yup=True,
            export_skins=False,
            export_animations=False,
            export_extras=True,  # off by default, and it drops rl_role silently
            export_materials="NONE",
            export_copyright=CREDIT,
        )
        tris = sum(len(p.vertices) - 2 for o in (trunk, fol) for p in o.data.polygons)
        top = max(v.co.z for o in (trunk, fol) for v in o.data.vertices)
        print(f"CEDAR {i}: height {top:.2f} m, {tris} tris -> {os.path.relpath(path, REPO)} ({os.path.getsize(path)} bytes)")


main()
