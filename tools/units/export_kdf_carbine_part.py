"""Re-cut the shipped KDF carbine hand part out of `inf_squad.glb`'s own bytes.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/units/export_kdf_carbine_part.py [-- OUT_DIR]

Writes `art/parts/kdf_carbine/kdf_carbine.glb` (and its `.blend`): one mesh,
one material, one 1024 px base-colour image, the carbine in the frame
`import_meshy_crew_team._normalise_part` leaves a rifle part in (long axis on
+X, butt at -X, up +Z, bbox-centred in x and y, body centreline on z = 0,
0.85 m), so `PART_SPECS["kdf_carbine_shipped"]` can lay it in a leader's hand
exactly as `kdf_carbine` is laid in inf_squad's.

WHY THIS EXISTS. `kdf_carbine` is a Meshy remesh (ledger: task 01a10c6f, 5 Oct
2026, 315 triangles, its 8k source `art/meshy/kdf-carbine-20261005-01a10c6f/
model.glb`). That download is gitignored ("kept on disk, never committed") and
is on no disk this branch can reach, and Meshy keeps files three days. The part
itself still ships, inside `art/meshes/inf_squad.glb`: the three carbines are
the `weapon` mesh's vertices on `f0/f1/f2_forearm_R`. This takes `f1`'s, from
the PRE-motion-pass bytes (the rev `extras.rl_motion.base` records, 13f667ff,
i.e. the importer's own output: the motion pass rebinds vertices), undoes the
importer's yaw about z (`RIFLE_YAW_DEG`), centres it, and crops its slot out of
the team's 2 x 1 atlas (the right half) into an image of its own.

AI-generated (Meshy), disclosed per CONTRIBUTING.md; nothing new is generated.
"""
import math
import os
import subprocess
import sys
import tempfile

import bmesh
import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import import_meshy_crew_team as crew  # noqa: E402  (its helpers: _coords, _body_centreline)

REPO = os.path.dirname(os.path.dirname(HERE))
DEFAULT_OUT = os.path.join(REPO, "art", "parts", "kdf_carbine")
BASE_REV = "13f667ff"            # inf_squad.glb's `rl_motion.base`
FIGURE = "f1"                    # the leader's carbine
LENGTH = 0.85                    # PART_SPECS["kdf_carbine"].length_m


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out_dir = argv[0] if argv else DEFAULT_OUT
    os.makedirs(out_dir, exist_ok=True)
    tmp = os.path.join(tempfile.mkdtemp(prefix="kdfcarbine-"), "inf_squad_pre.glb")
    with open(tmp, "wb") as fh:
        subprocess.run(["/usr/bin/git", "-C", REPO, "show", f"{BASE_REV}:art/meshes/inf_squad.glb"],
                       stdout=fh, check=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=tmp)
    weapon = next(o for o in bpy.data.objects if o.type == "MESH" and o.get("rl_role") == "weapon")
    gi = weapon.vertex_groups[f"{FIGURE}_forearm_R"].index
    on = np.zeros(len(weapon.data.vertices), dtype=bool)
    for v in weapon.data.vertices:
        if any(g.group == gi and g.weight > 0.5 for g in v.groups):
            on[v.index] = True
    drop = [p.index for p in weapon.data.polygons if not all(on[i] for i in p.vertices)]
    bm = bmesh.new()
    bm.from_mesh(weapon.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in drop], context="FACES")
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    bm.to_mesh(weapon.data)
    bm.free()
    weapon.vertex_groups.clear()
    weapon.parent = None
    for o in [o for o in bpy.data.objects if o is not weapon]:
        bpy.data.objects.remove(o, do_unlink=True)
    weapon.name = weapon.data.name = "kdf_carbine"
    bpy.context.view_layer.objects.active = weapon
    weapon.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Undo the importer's yaw about z, then centre as `_normalise_part` does.
    co = crew._coords(weapon)
    yaw = math.radians(-crew.RIFLE_YAW_DEG)       # the placement was Rz(RIFLE_YAW_DEG)
    c, s = math.cos(yaw), math.sin(yaw)
    rot = np.array(((c, -s, 0.0), (s, c, 0.0), (0.0, 0.0, 1.0)))
    co = co @ rot.T
    ext = float(np.ptp(co[:, 0]))
    if abs(ext - LENGTH) > 0.02:
        raise SystemExit(f"[kdf_carbine] long axis {ext:.3f} m after the yaw undo, expected {LENGTH} -- look at it")
    co[:, 0] -= (co[:, 0].min() + co[:, 0].max()) / 2.0
    co[:, 1] -= (co[:, 1].min() + co[:, 1].max()) / 2.0
    co[:, 2] -= crew._body_centreline(co)
    crew._apply_np(weapon, co)
    # Butt at -X: the stock end is the TALLER one (RIFLE_BUTT_RATIO's own rule).
    x0, x1 = co[:, 0].min(), co[:, 0].max()
    end = 0.05 * (x1 - x0)
    h_lo = float(np.ptp(co[co[:, 0] < x0 + end][:, 2]))
    h_hi = float(np.ptp(co[co[:, 0] > x1 - end][:, 2]))
    if h_hi > h_lo:
        raise SystemExit(f"[kdf_carbine] butt at +X (end heights {h_lo:.3f}/{h_hi:.3f}) -- the yaw undo went the wrong way")
    print(f"[kdf_carbine] {len(weapon.data.polygons)} tris, {ext:.3f} m, x {x0:+.3f}..{x1:+.3f} "
          f"y {co[:, 1].min():+.3f}..{co[:, 1].max():+.3f} z {co[:, 2].min():+.3f}..{co[:, 2].max():+.3f}; "
          f"end heights {h_lo:.3f}/{h_hi:.3f}")

    # The slot: the right half of the team atlas, u -> (u - 0.5) * 2.
    layer = weapon.data.uv_layers.active
    uv = np.empty(len(weapon.data.loops) * 2, dtype=np.float32)
    layer.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    if uv[:, 0].min() < 0.5 - 1e-3:
        raise SystemExit(f"[kdf_carbine] uv u reaches {uv[:, 0].min():.3f}: not in the right half of the atlas")
    uv[:, 0] = (uv[:, 0] - 0.5) * 2.0
    layer.data.foreach_set("uv", uv.ravel())
    mat = weapon.data.materials[0]
    tex = next(n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE")
    atlas = tex.image
    w, h = atlas.size
    px = np.array(atlas.pixels[:], dtype=np.float32).reshape(h, w, atlas.channels)
    half = px[:, w // 2:, :]
    img = bpy.data.images.new("kdf_carbine_color", w // 2, h, alpha=False)
    rgba = np.ones((h, w // 2, 4), dtype=np.float32)
    rgba[..., :3] = half[..., :3]
    img.pixels = rgba.ravel().tolist()
    img.update()
    img.colorspace_settings.name = "sRGB"
    tex.image = img
    img.pack()
    blend = os.path.join(out_dir, "kdf_carbine.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    bpy.ops.object.select_all(action="DESELECT")
    weapon.select_set(True)
    bpy.context.view_layer.objects.active = weapon
    glb = os.path.join(out_dir, "kdf_carbine.glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True,
                              export_image_format="JPEG", export_jpeg_quality=90,
                              export_materials="EXPORT", export_apply=True)
    print(f"[kdf_carbine] wrote {glb} ({os.path.getsize(glb)} bytes) and {blend}")


if __name__ == "__main__":
    main()
