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
import olive as O

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


def mesh_from_grid(bpy, name, pos, tris, uv_corner):
    """`uv_corner` is [ntri * 3, 2]: one UV per triangle corner (a vertex on a chart break has two)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata(pos.tolist(), [], tris.tolist())
    me.update()
    layer = me.uv_layers.new(name="UVMap")
    layer.data.foreach_set("uv", uv_corner.ravel())
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.update()
    return me


def surface_z(M, H, s, t):
    r = (np.array([t]) - M.t[0]) / M.h
    c = (np.array([s]) - M.s[0]) / M.h
    return float(K.bilinear(H, r, c)[0, 0])


def build_olive(bpy, atlas_chart):
    """The 62-triangle olive of `olive.py`: a forked trunk and an open crown of small clumps,
    sized to the in-map olive (`decor/tree_0.glb`: 3.4 m tall, a crown about 3 m across)."""
    verts, tris, tag = O.build()
    me = bpy.data.meshes.new("bd_olive")
    me.from_pydata(verts.tolist(), [], tris.tolist())
    me.update()
    zs = verts[:, 2]
    print("olive height %.2f, tris %d" % (zs.max(), len(tris)))
    ox, oy, ow, oh = atlas_chart
    layer = me.uv_layers.new(name="UVMap")
    uv = np.empty((len(tris), 3, 2))
    for k, tri in enumerate(tris):
        for c, vi in enumerate(tri):
            z = verts[vi, 2]
            if tag[k] == O.TRUNK:
                px, py = ox + 36, oy + 24
            else:
                px, py = ox + 10, oy + 4 + 40 * min(1.0, max(0.0, (z - 1.6) / 1.9))
            uv[k, c] = (px / K.ATLAS_PX, 1.0 - py / K.ATLAS_PX)
    layer.data.foreach_set("uv", uv.reshape(-1, 2).ravel())
    # the trunk is smooth, the crown is faceted: each clump reads as a clump of leaves
    me.polygons.foreach_set("use_smooth", [bool(g == O.TRUNK) for g in tag])
    me.update()
    return me, {"tris": len(tris), "source_tris": {"foliage": 2634, "trunk": 364}, "height_m": float(zs.max()),
                "width_m": [float(np.ptp(verts[:, 0])), float(np.ptp(verts[:, 1]))]}


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
        me0 = mesh_from_grid(bpy, p.name, p.gm.pos, p.gm.tris, K.corner_uv(p.gm, p.charts))
        me0.materials.append(mat)
        ob0 = bpy.data.objects.new(p.name, me0)
        ob0["rl_piece"] = p.name
        ob0["rl_textured"] = True
        col.objects.link(ob0)
        # LOD1: ~35% of LOD0 over the same parameter plane, chart breaks and seams kept as vertices
        gm1 = p.lod1()
        me1 = mesh_from_grid(bpy, p.name + "_lod1", gm1.pos, gm1.tris, K.corner_uv(gm1, p.charts))
        me1.materials.append(mat)
        ob1 = bpy.data.objects.new(p.name + "_lod1", me1)
        ob1["rl_piece"] = p.name
        ob1["rl_textured"] = True
        ob1["rl_lod"] = 1
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
            ws, wt = (s, t)
            if p.world is not None:
                a_, b_ = p.world(np.array([[s]]), np.array([[t]]))
                ws, wt = float(a_[0, 0]), float(b_[0, 0])
            e = bpy.data.objects.new(an, None)
            e.empty_display_type = "ARROWS"
            e.empty_display_size = 1.5
            e.location = (-wt, ws, z)
            e.parent = ob0
            col.objects.link(e)
            out_anchors.append({"name": an, "s": s, "t": t, "local": [-wt, ws, z]})
        # The anchors and the olives travel in the GLB as node extras, in GLB-local metres (x, up, z = -y):
        # the runtime reads them back with the geometry, so a placement needs no sidecar.
        ob0["rl_anchors"] = json.dumps([{"name": a["name"], "p": [round(a["local"][0], 3), round(a["local"][2], 3), round(-a["local"][1], 3)]}
                                        for a in out_anchors])
        pos = p.gm.pos
        rec = {
            "side": p.side, "desc": p.desc,
            "tris_lod0": int(p.gm.tri_count), "tris_lod1": int(gm1.tri_count), "cap": p.cap,
            "master_tris": int(p.M.tri_count), "master_cell_m": p.M.h,
            "bbox_local_m": [pos.min(axis=0).round(2).tolist(), pos.max(axis=0).round(2).tolist()],
            "footprint_nominal": None,
            "charts": [{"name": c.name, "s": [round(float(c.s0), 2), round(float(c.s1), 2)], "v": [round(float(c.v0), 2), round(float(c.v1), 2)],
                        "px": [int(c.w), int(c.h)], "rotated": bool(c.rot), "texels_per_tile": round(c.k * 3.0, 1)} for c in p.charts],
            "texels_per_tile": [round(min(c.k for c in p.charts) * 3.0, 1), round(max(c.k for c in p.charts) * 3.0, 1)],
            "texels_per_tile_main": round(max(p.charts, key=lambda c: (c.cs[-1] * c.ct[-1] * c.dens * c.dens)).k * 3.0, 1),
            "anchors": out_anchors,
            "height_max_m": round(float(p.f["H"].max()), 2),
        }
        if p.name.startswith(("bd_slope_near", "bd_slope_corner")):
            T = np.maximum(np.maximum(p.M.T, p.M.S), 1e-6) if "corner" in p.name else p.M.T
            ratio = np.where(T > 3.0, p.f["H"] / np.maximum(T, 1e-6), 0.0)
            rec["near_envelope_max_h_over_t"] = round(float(ratio.max()), 4)
        if p.name.startswith("bd_terrace"):
            rec["olives"] = P.olive_positions(p, 45, 3.6, 1.25)
            ob0["rl_olives"] = json.dumps([[round(q[0], 3), round(q[2], 3), round(-q[1], 3)] for q in rec["olives"]])
        stats["pieces"][p.name] = rec
        print("%-18s LOD0 %5d / cap %5d   LOD1 %5d (%2.0f%%)  master %.2f M tris   %s tex/tile"
              % (p.name, p.gm.tri_count, p.cap, gm1.tri_count, 100.0 * gm1.tri_count / p.gm.tri_count, p.M.tri_count / 1e6,
                 "/".join("%.0f" % (c.k * 3.0) for c in p.charts)))

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
        stats["pieces"]["bd_olive"] = {"tris_lod0": oinfo["tris"], "cap": 64, "height_m": round(oinfo["height_m"], 2), "width_m": oinfo["width_m"], "source_tris": oinfo["source_tris"]}
        print("bd_olive           tris %d / cap 64  (source %s)" % (oinfo["tris"], oinfo["source_tris"]))

    pr = P.PROFILE
    dd = np.arange(0.0, 130.0 + 1e-9, 1.0)
    stats["profile"] = {"d": dd.tolist(), "y": np.interp(dd, pr.d, pr.y).round(3).tolist()}
    stats["total_tris_lod0"] = int(sum(r["tris_lod0"] for r in stats["pieces"].values()))
    bpy.context.preferences.filepaths.save_version = 0   # no .blend1 backup beside a committed source
    bpy.ops.wm.save_as_mainfile(filepath=args.out, compress=True)
    if args.stats:
        with open(args.stats, "w") as f:
            json.dump(stats, f, indent=1)
    print("saved", args.out, "in %.1fs" % (time.time() - t0))


if __name__ == "__main__":
    main()
