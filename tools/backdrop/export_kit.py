"""Export the Wadi Halam backdrop kit from its game-res .blend to one GLB.

    blender -b art/src/backdrop/wadi_halam_kit.blend -P tools/backdrop/export_kit.py -- \
        --out art/meshes/backdrop/wadi_halam_kit.glb

Lane B (GH-161). The .blend is what `build_kit.py` wrote (LOD0 and LOD1 game meshes, one material,
one 2048x2048 atlas, anchor empties). The GLB carries LOD0 and LOD1 (`rl_lod` 1; the olive and the house have none): the
minimum-zoom cost run missed its budget, so LOD1 ships, swapped in below zoom 0.6 (kit-spec section 1a).
One material, one image, one texture; every mesh node is `rl_textured` and names its piece in `rl_piece`; the terrace nodes
carry their olive positions (`rl_olives`) and the anchors (`rl_anchors`) as JSON strings, in GLB-local
metres (x, up, z), so a placement needs no sidecar.

The exporter REFUSES (exit 1, nothing written) a piece over its triangle cap, a second material or
image, an atlas that is not 2048x2048, a mesh with no `rl_piece` or one outside the closed piece
list, an LOD1 over 40% of its LOD0 or a piece without one, a piece with a texture-less material, and
a GLB that comes back with other than 1 material / 1 image / 1 texture. `tools/validate_mesh_assets.py`'s
`check_backdrop_meshes` re-checks the contract from the GLB bytes in CI.
"""
import argparse
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402

import kitlib as K  # noqa: E402
import pieces as P  # noqa: E402

JPEG_QUALITY = 90
OLIVE_CAP = 64
#: an LOD1 may carry at most this share of its LOD0's triangles (kit-spec section 3)
LOD1_MAX = 0.40
#: The closed piece list: every kit piece plus the olive. Must match `KIT_PIECES` in
#: packages/render/src/three/terrain/textured-backdrop.ts (a test parses this).
PIECE_CAPS = {p.name: p.cap for p in P.all_pieces()}
PIECE_CAPS["bd_olive"] = OLIVE_CAP
HOUSE_CAP = 16
PIECE_CAPS["bd_house"] = HOUSE_CAP
#: pieces with no LOD1 twin: the instanced olive and the placeholder house
NO_LOD1 = ("bd_olive", "bd_house")


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    return ap.parse_args(argv)


def refuse(msg):
    print("EXPORT REFUSED: " + msg)
    sys.exit(1)


def tri_count(ob):
    me = ob.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def check_blend():
    """The pre-export refusals. Returns the LOD0 mesh objects."""
    if len(bpy.data.materials) != 1:
        refuse("%d materials in the .blend, the kit has exactly one" % len(bpy.data.materials))
    imgs = [i for i in bpy.data.images if i.name != "Render Result"]
    if len(imgs) != 1:
        refuse("%d images in the .blend, the kit has exactly one" % len(imgs))
    if tuple(imgs[0].size) != (K.ATLAS_PX, K.ATLAS_PX):
        refuse("atlas is %s, expected %dx%d" % (tuple(imgs[0].size), K.ATLAS_PX, K.ATLAS_PX))
    out = []
    seen = set()
    lod1 = {}
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        piece = ob.get("rl_piece")
        if piece is None:
            refuse("mesh node %r has no rl_piece" % ob.name)
        if piece not in PIECE_CAPS:
            refuse("mesh node %r names rl_piece %r, outside the closed list %s" % (ob.name, piece, sorted(PIECE_CAPS)))
        if ob.get("rl_textured") is not True:
            refuse("mesh node %r does not declare rl_textured" % ob.name)
        if ob.name.endswith("_lod1"):
            if ob.get("rl_lod") != 1:
                refuse("%s is an LOD1 node without rl_lod = 1" % ob.name)
            lod1[piece] = ob
            continue
        if ob.name != piece:
            refuse("LOD0 node %r is named differently from its rl_piece %r" % (ob.name, piece))
        if len(ob.data.materials) != 1 or ob.data.materials[0] is None:
            refuse("%s carries %d material slot(s), expected exactly 1" % (ob.name, len(ob.data.materials)))
        if not ob.data.uv_layers:
            refuse("%s has no UV layer: the atlas is addressed by it" % ob.name)
        n = tri_count(ob)
        if n > PIECE_CAPS[piece]:
            refuse("%s has %d triangles, over its cap of %d" % (ob.name, n, PIECE_CAPS[piece]))
        seen.add(piece)
        out.append(ob)
    missing = sorted(set(PIECE_CAPS) - seen)
    if missing:
        refuse("pieces missing from the .blend: %s" % missing)
    by_name = {o.name: o for o in out}
    for piece in sorted(seen - set(NO_LOD1)):
        if piece not in lod1:
            refuse("%s has no LOD1" % piece)
        n0, n1 = tri_count(by_name[piece]), tri_count(lod1[piece])
        if n1 > LOD1_MAX * n0:
            refuse("%s: LOD1 has %d triangles, over %d%% of its LOD0's %d" % (piece, n1, round(LOD1_MAX * 100), n0))
    for p in NO_LOD1:
        if p in lod1:
            refuse("%s has no LOD1 (%d triangles)" % (p, PIECE_CAPS[p]))
    return out + [lod1[p] for p in sorted(lod1)]


def read_glb_json(path):
    with open(path, "rb") as fh:
        data = fh.read()
    _magic, _ver, length = struct.unpack("<III", data[:12])
    off = 12
    while off < length:
        clen, ctype = struct.unpack("<II", data[off:off + 8])
        if ctype == 0x4E4F534A:
            return json.loads(data[off + 8:off + 8 + clen])
        off += 8 + clen
    raise ValueError("no JSON chunk")


def main():
    args = parse()
    meshes = check_blend()
    mat = bpy.data.materials[0]
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    # The mock rendered at specular 0; glTF emits KHR_materials_specular for anything but the default,
    # an extension this material does not need (the runtime sets roughness and metalness itself).
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.5
    # Every surface is an upward-facing height field seen from above: cull the back (the runtime draws FrontSide,
    # and a mirrored placement flips its winding, so a wrong winding shows as a hole, never as a lit back face).
    mat.use_backface_culling = True

    bpy.ops.object.select_all(action="DESELECT")
    for ob in meshes:
        ob.hide_set(False)
        ob.hide_viewport = False
        ob.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=args.out,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_extras=True,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_jpeg_quality=JPEG_QUALITY,
        export_draco_mesh_compression_enable=False,
    )
    j = read_glb_json(args.out)
    n_mat, n_img, n_tex = len(j.get("materials", [])), len(j.get("images", [])), len(j.get("textures", []))
    if (n_mat, n_img, n_tex) != (1, 1, 1):
        os.remove(args.out)
        refuse("the GLB came back with %d/%d/%d material/image/texture, expected 1/1/1" % (n_mat, n_img, n_tex))
    nodes = [n for n in j["nodes"] if "mesh" in n]
    bad = [n.get("name") for n in nodes if (n.get("extras") or {}).get("rl_textured") is not True or "rl_piece" not in (n.get("extras") or {})]
    want = 2 * len(PIECE_CAPS) - len(NO_LOD1)   # every piece twice (LOD0, LOD1) except the olive and the house
    if bad or len(nodes) != want:
        os.remove(args.out)
        refuse("the GLB has %d mesh nodes (expected %d); without rl_textured/rl_piece: %s" % (len(nodes), want, bad))
    print("EXPORT OK %s %d bytes, %d nodes, %d LOD0 triangles" % (args.out, os.path.getsize(args.out), len(nodes),
                                                               sum(tri_count(o) for o in meshes if not o.name.endswith("_lod1"))))


if __name__ == "__main__":
    main()
