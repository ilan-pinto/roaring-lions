"""Build the Wadi Halam backdrop kit: masters, game meshes, the atlas, the .blend.

    blender -b -P tools/backdrop/build_kit.py -- \
        --out /path/to/wadi_halam_kit.blend [--atlas-png /path/atlas.png] [--stats /path/stats.json]

Lane B (GH-161). Every piece is designed individually and authored offline, by
script: the runtime places finished pieces and never generates a wall. All
noise is the port of the renderer's own (`kitlib.vnoise`); NO `mathutils.noise`,
which Blender 5.2 reseeds per process. Colours are `data/palette.json` keys,
read at run time (a test greps this directory for a hex literal).

The 1-4 M triangle masters are heightfields in numpy and are regenerated, not
committed. The .blend holds the GAME meshes (LOD0 and LOD1), one material, one
2048x2048 atlas, and the anchor empties.
"""
import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np

import kitlib as K
import pieces as P
import bake as B

# house pads and the like: (name, s, t) on the local frame of each piece
ANCHORS = {
    "bd_terrace_a": [("anchor_house_0", -5.0, 14.5), ("anchor_house_1", 5.5, 8.7)],
    "bd_terrace_b": [("anchor_house_0", 0.0, 12.0)],
    "bd_terrace_end": [("anchor_house_0", -5.0, 14.0)],
    "bd_slope_near_a": [("anchor_house_0", -8.0, 40.0), ("anchor_house_1", 6.0, 62.0), ("anchor_house_2", -4.0, 88.0)],
    "bd_slope_near_b": [("anchor_house_0", 7.0, 34.0), ("anchor_house_1", -9.0, 70.0)],
}


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--atlas-png")
    ap.add_argument("--stats")
    ap.add_argument("--only", nargs="*", default=[])
    return ap.parse_args(argv)


def mesh_from_grid(bpy, name, pos, tris, uv):
    me = bpy.data.meshes.new(name)
    me.from_pydata(pos.tolist(), [], tris.tolist())
    me.update()
    layer = me.uv_layers.new(name="UVMap")
    layer.data.foreach_set("uv", uv[tris.ravel()].ravel())
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.update()
    return me


def surface_z(M, H, s, t):
    r = (np.array([t]) - M.t[0]) / M.h
    c = (np.array([s]) - M.s[0]) / M.h
    return float(K.bilinear(H, r, c)[0, 0])


def build_olive(bpy, atlas_chart):
    """The 64-triangle olive, sized to the in-map olive (`decor/tree_0.glb`: 3.4 m tall,
    a canopy about 3 m across, a 1.3 m trunk).

    The spec says "derived from the in-map olive decor, decimated in Blender". That
    was tried and measured: the in-map olive is a Meshy leaf-card cloud (2,634 + 364
    triangles) and a collapse decimate to 44 + 20 triangles leaves scattered shards.
    So the olive is hand-built here from a tapered trunk and three lumpy low-poly
    blobs, to the in-map olive's measured bounds. Nothing of the Meshy mesh is kept.
    """
    import bmesh
    import mathutils
    bm = bmesh.new()
    # trunk: a tapered six-sided prism, slightly leaning
    ring0 = [bm.verts.new((0.30 * math.cos(a), 0.30 * math.sin(a), 0.0)) for a in [i * math.pi / 3 for i in range(6)]]
    ring1 = [bm.verts.new((0.17 * math.cos(a) + 0.12, 0.17 * math.sin(a) + 0.05, 1.35)) for a in [i * math.pi / 3 + 0.2 for i in range(6)]]
    for i in range(6):
        j = (i + 1) % 6
        bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
    # canopy: three lumpy icospheres (20 triangles each) -> 60; trunk quads are 12 triangles
    blobs = [((0.1, 0.0, 2.45), (1.55, 1.45, 1.05)), ((-0.55, 0.35, 1.8), (1.0, 1.0, 0.75))]
    # a third, smaller lobe: an octahedron (8 triangles)
    c3, r3 = (0.75, -0.45, 1.85), (0.9, 0.95, 0.7)
    o = [bm.verts.new((c3[0] + dx * r3[0], c3[1] + dy * r3[1], c3[2] + dz * r3[2])) for dx, dy, dz in
         ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))]
    for a, b in ((0, 2), (2, 1), (1, 3), (3, 0)):
        bm.faces.new((o[a], o[b], o[4]))
        bm.faces.new((o[b], o[a], o[5]))
    for bi, (c, r) in enumerate(blobs):
        geom = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
        vs = [v for v in geom["verts"]]
        for k, v in enumerate(vs):
            j = 1.0 + 0.16 * (float(K.tile_hash(k + 17 * bi, 5 + bi)) - 0.5) * 2
            v.co = mathutils.Vector((c[0] + v.co.x * r[0] * j, c[1] + v.co.y * r[1] * j, c[2] + v.co.z * r[2] * j))
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new("bd_olive")
    bm.to_mesh(me)
    bm.free()
    zs = [v.co.z for v in me.vertices]
    print("olive height %.2f, tris %d" % (max(zs), len(me.polygons)))
    ox, oy, ow, oh = atlas_chart
    layer = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            if v.z < 1.4 and (v.x * v.x + v.y * v.y) < 0.2:
                px, py = ox + 36, oy + 24
            else:
                px, py = ox + 10, oy + 4 + 40 * min(1.0, max(0.0, (v.z - 0.9) / 2.5))
            layer.data[li].uv = (px / K.ATLAS_PX, 1.0 - py / K.ATLAS_PX)
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    return me, {"tris": len(me.polygons), "source_tris": {"foliage": 2634, "trunk": 364}, "height_m": max(zs)}


def main():
    args = parse()
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    t0 = time.time()
    pcs = P.all_pieces()
    if args.only:
        pcs = [p for p in pcs if p.name in args.only]
    for p in pcs:
        p.build()
    atlas, binfo = B.bake(pcs)
    print("masters + bake: %.1fs" % (time.time() - t0))

    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

    # --- the atlas and the one material
    img = bpy.data.images.new("wadi_halam_atlas", K.ATLAS_PX, K.ATLAS_PX, alpha=False)
    img.colorspace_settings.name = "sRGB"
    img.alpha_mode = "NONE"
    rgba = np.ones((K.ATLAS_PX, K.ATLAS_PX, 4), dtype=np.float32)
    rgba[..., :3] = np.flipud(atlas).astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    img.update()
    chk = np.empty(K.ATLAS_PX * K.ATLAS_PX * 4, dtype=np.float32)
    img.pixels.foreach_get(chk)
    if abs(float(chk.reshape(-1, 4)[:, :3].mean()) - float(rgba[..., :3].mean())) > 1e-3:
        raise RuntimeError("atlas pixels did not take")
    if args.atlas_png:
        img.filepath_raw = args.atlas_png
        img.file_format = "PNG"
        img.save()
    img.pack()
    mat = bpy.data.materials.new("wadi_halam_kit")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Linear"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.0

    stats = {"pieces": {}, "atlas": {"px": K.ATLAS_PX, "density_scale": binfo["scale"], "rows_used": binfo["rows_used"]}}
    root = bpy.data.collections.new("wadi_halam_kit")
    scene.collection.children.link(root)

    for p in pcs:
        col = bpy.data.collections.new("piece:" + p.name)
        root.children.link(col)
        me0 = mesh_from_grid(bpy, p.name, p.gm.pos, p.gm.tris, p.uv)
        me0.materials.append(mat)
        ob0 = bpy.data.objects.new(p.name, me0)
        ob0["rl_piece"] = p.name
        ob0["rl_textured"] = True
        col.objects.link(ob0)
        # LOD1: ~35% of LOD0
        anchors_s = (-24.0, 24.0) if p.name.startswith(("bd_wall_far", "bd_taper", "bd_crest", "bd_slope_near")) else ()
        sv1, tv1 = K.lod_axes(p.M, p.f["H"], p.gm, 0.59, anchors_s)
        gm1 = K.GameMesh(p.M, p.f["H"], sv1, tv1)
        cs, ct = p.chart_axes
        u1 = np.interp(sv1, p.gm.sv, cs)
        v1 = np.interp(tv1, p.gm.tv, ct)
        UU, VV = np.meshgrid(u1, v1)
        x0, y0, w, h, rot = p.chart
        ax, ay = (VV, UU) if rot else (UU, VV)
        uv1 = np.stack([(x0 + ax.ravel()) / K.ATLAS_PX, 1.0 - (y0 + ay.ravel()) / K.ATLAS_PX], axis=1)
        me1 = mesh_from_grid(bpy, p.name + "_lod1", gm1.pos, gm1.tris, uv1)
        me1.materials.append(mat)
        ob1 = bpy.data.objects.new(p.name + "_lod1", me1)
        ob1["rl_piece"] = p.name
        ob1["rl_textured"] = True
        col.objects.link(ob1)
        ob1.hide_render = True
        ob1.hide_viewport = True
        # anchors
        anchors = list(ANCHORS.get(p.name, []))
        ag = p.f.get("anchor_gully")
        if ag is not None:
            anchors.append(("anchor_gully", float(ag[0]), float(ag[1])))
        out_anchors = []
        for (an, s, t) in anchors:
            z = surface_z(p.M, p.f["H"], s, t)
            e = bpy.data.objects.new(an, None)
            e.empty_display_type = "ARROWS"
            e.empty_display_size = 1.5
            e.location = (-t, s, z)
            e.parent = ob0
            col.objects.link(e)
            out_anchors.append({"name": an, "s": s, "t": t, "local": [-t, s, z]})
        pos = p.gm.pos
        rec = {
            "side": p.side, "desc": p.desc,
            "tris_lod0": int(p.gm.tri_count), "tris_lod1": int(gm1.tri_count), "cap": p.cap,
            "master_tris": int(p.M.tri_count), "master_cell_m": p.M.h,
            "bbox_local_m": [pos.min(axis=0).round(2).tolist(), pos.max(axis=0).round(2).tolist()],
            "footprint_nominal": None,
            "texels_per_m": round(p.texels_per_m, 2), "chart_px": [int(p.chart[2]), int(p.chart[3])], "chart_rotated": bool(p.chart[4]),
            "texels_per_tile": round(p.texels_per_m * 3.0, 1),
            "anchors": out_anchors,
            "height_max_m": round(float(p.f["H"].max()), 2),
        }
        if p.name.startswith(("bd_slope_near", "bd_slope_corner")):
            T = np.maximum(np.maximum(p.M.T, p.M.S), 1e-6) if "corner" in p.name else p.M.T
            ratio = np.where(T > 3.0, p.f["H"] / np.maximum(T, 1e-6), 0.0)
            rec["near_envelope_max_h_over_t"] = round(float(ratio.max()), 4)
        if p.name.startswith("bd_terrace"):
            rec["olives"] = P.olive_positions(p, 45, 3.6, 1.25)
        stats["pieces"][p.name] = rec
        print("%-18s LOD0 %5d / cap %5d   LOD1 %5d   master %.2f M tris   %.1f tex/tile"
              % (p.name, p.gm.tri_count, p.cap, gm1.tri_count, p.M.tri_count / 1e6, p.texels_per_m * 3.0))

    # --- the olive
    if not args.only or "bd_olive" in args.only:
        me, oinfo = build_olive(bpy, binfo["olive_chart"])
        me.materials.append(mat)
        ob = bpy.data.objects.new("bd_olive", me)
        ob["rl_piece"] = "bd_olive"
        ob["rl_textured"] = True
        col = bpy.data.collections.new("piece:bd_olive")
        root.children.link(col)
        col.objects.link(ob)
        stats["pieces"]["bd_olive"] = {"tris_lod0": oinfo["tris"], "cap": 64, "height_m": 3.4, "source_tris": oinfo["source_tris"]}
        print("bd_olive           tris %d / cap 64  (source %s)" % (oinfo["tris"], oinfo["source_tris"]))

    pr = P.PROFILE
    dd = np.arange(0.0, 130.0 + 1e-9, 1.0)
    stats["profile"] = {"d": dd.tolist(), "y": np.interp(dd, pr.d, pr.y).round(3).tolist()}
    stats["total_tris_lod0"] = int(sum(r["tris_lod0"] for r in stats["pieces"].values()))
    bpy.ops.wm.save_as_mainfile(filepath=args.out, compress=True)
    if args.stats:
        with open(args.stats, "w") as f:
            json.dump(stats, f, indent=1)
    print("saved", args.out, "in %.1fs" % (time.time() - t0))


if __name__ == "__main__":
    main()
