"""Export the Meshy-generated RPG-7 launcher as a TEXTURED crew-weapon part.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/units/export_meshy_rpg.py [-- OUT.glb]

Writes `art/parts/rpg7.glb` by default: one mesh, one material, one
base-colour image (`TEXTURE_PX`, JPEG), `TARGET_TRIS` triangles, in real
metres, muzzle `+X`, the bore on the X axis. It is a PART, not a unit -- no
rig, no role table, drawn by nothing on its own. `import_meshy_crew_team.py`
loads it (`PART_SPECS["rpg_launcher"]`) and composes its bake into the team
atlas exactly as it does a Meshy refine+remesh part (B8's mortar and rifle),
for `rpg_team`'s firer and, through `import_meshy_moto_rpg.py`, the
`moto_rpg` pillion. `art/parts/` and not `art/meshes/props/`: the mesh gate
globs `art/meshes/**/*.glb` and has no `props` kind, so a part written there
turns `pnpm validate:meshes` red for every session in the tree (the
September note, still true).

AI-generated (Meshy image-to-3D, supplied 3 Sep), disclosed per CONTRIBUTING.md.

SOURCES (both under the main checkout's gitignored `art/blend/enemy/wepons/`)

  Meshy_AI_RPG_7_launcher_0903143528_image-to-3d-texture.blend
      one welded object `mesh_node`, 977,326 verts / 1,954,697 tris, ONE
      material with three packed images (base_color 4096, metallic_roughness
      2048, normal 4096). USED since 2026-10-05.

  Meshy_AI_RPG_7_launcher_parts_0903143621_part-segmentation.blend
      eight objects, 985,427 verts, zero materials. Used in September; not now.

WHY THE TEXTURED FILE NOW (the lead's ruling, 5 Oct, WP-A3.1 stage 2). In
September this script chose the segmentation file for the zero-materials
rule: "every unit in this tree ships zero materials" and infantry had no
textured exemption. That rule no longer binds infantry -- every infantry team
is in `TEXTURED_INFANTRY_TYPES` (PR #307 and B7) and ships its own bake, and
the max-detail rule of 2 Oct asks for the bake wherever there is one. The
segmentation file's whole advantage was "zero materials at the source", which
is now the thing we do NOT want: a palette RPG beside a textured gunner reads
as a grey kit tube, the very complaint A3.1 exists to fix. The two files are
the same model at a uniform 3.5768x (measured below), so choosing the bake
costs no shape. The 2048 metallic-roughness and the 4096 normal are dropped:
the figures ship base colour only (`import_meshy_crew_team.py`, TEXTURED).

DECIMATION. 1,954,697 tris to `TARGET_TRIS` (bible §3: a crew-weapon part
remeshes at 400 and ships under 600). One COLLAPSE pass, in two steps (0.05,
then to target), welded first; Blender's collapse keeps the UV seams, so the
4096 bake still lands on the right faces at ~560 tris (photographed). The
brief allowed decimating the tube and the warhead SEPARATELY if one pass
collapsed the stem between them; measured, one pass does not, and
`_assert_continuous` is what says so -- every 2 % slice of the length must be
crossed by at least one triangle, so a stem that collapsed to nothing leaves
an empty slice and the export refuses.

SCALE. `OVERALL_M` = 1.27 m, warhead tip to bell mouth -- the overall length
of `import_meshy_crew_team.LAUNCHERS["rpg_team"]` (a 0.96 m tube plus flare,
stem and warhead), which is the envelope the firer's seat was measured
against. A real loaded RPG-7 is about 1.34 m. The September export used
1.40 to match the old kit tube's envelope; the procedural RPG that replaced
the kit tube (PR #325) is the thing this part replaces now.

ORIENTATION. The textured source's muzzle is at -X, exactly as the
segmentation file's (the trap recorded below: a bell flares wider than a
warhead, so "widest end leads" is backwards). `_assert_muzzle` reads the
radius profile on the welded mesh -- the front quarter must bulge and taper
(the PG-7 warhead), the last slice must be the widest of the rear quarter
(the bell) -- so it fails in both directions. Then a 180 degree Z turn puts
the muzzle at +X. The optic is NOT moved here: it sits on the weapon's own
left (+Y once the muzzle is +X), and which side of the tube faces the gunner
is the importer's call, not the part's.

ORIGIN. On the bore axis (y = z = 0 through the centreline of the tube,
measured from the plain tube between the heat shield and the bell, which the
optic and grips cannot drag), x = 0 at the model's own X midpoint.

---------------------------------------------------------------------------
September (2026-09-03), kept for the measurements, which still hold:

THE TWO FILES ARE THE SAME MODEL AT TWO UNIFORM SCALES:

    textured        1.90314 x 0.19601 x 0.42922
    segmentation    0.53208 x 0.05480 x 0.12000
    ratio             3.5768    3.5769    3.5768

and the textured file is centred on its own vertical midpoint (z -0.2144 to
+0.2148) where the segmentation file rests on z = 0.

THE FIRST IDENTIFICATION OF THE SEGMENTATION PARTS WAS WRONG IN TWO PAIRS:
extents alone said "the widest part on a loaded RPG is the warhead", which put
the muzzle at +X. It is false: an RPG-7's blast bell flares WIDER than its
warhead. The radius profile settled it (warhead: 0.006 -> 0.017 -> 0.011, a
teardrop; bell: monotone to 0.028 at the far end), so the source's muzzle is
at -X, and the forward grip is the one nearer the muzzle, the pistol grip
(with the trigger guard) the one behind it.
"""
import os
import sys

import bmesh
import bpy
import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(
    REPO, "art", "blend", "enemy", "wepons",
    "Meshy_AI_RPG_7_launcher_0903143528_image-to-3d-texture.blend",
)
#: The main checkout carries `art/blend/` (gitignored); a worktree usually
#: does not, so the main checkout's copy is the fallback.
SRC_FALLBACK = os.path.join(os.path.expanduser("~"), "dev", "roaring-lions", "art", "blend", "enemy", "wepons",
                            os.path.basename(SRC))
DEFAULT_OUT = os.path.join(REPO, "art", "parts", "rpg7.glb")

TAG = "rpg7"
OVERALL_M = 1.27                 # warhead tip to bell mouth (module docstring, SCALE)
TARGET_TRIS = 560                # bible §3: crew weapon part, remesh 400, cap 600
TRI_RANGE = (400, 600)
TEXTURE_PX = 1024                # the atlas slot it is composed into
JPEG_QUALITY = 85
SLICES = 50                      # `_assert_continuous`: 2 % of the length each


def _coords(ob):
    co = np.empty(len(ob.data.vertices) * 3, dtype=np.float64)
    ob.data.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def _bore_yz(co):
    """y, z of the bore axis: the centre of the plain tube between the heat
    shield and the bell (62-80 % of the length from the -X end), where
    nothing but the round tube is."""
    x = co[:, 0]
    lo, hi = x.min(), x.max()
    band = co[(x > lo + 0.62 * (hi - lo)) & (x < lo + 0.80 * (hi - lo))]
    return (band[:, 1].min() + band[:, 1].max()) / 2.0, (band[:, 2].min() + band[:, 2].max()) / 2.0


def _profile(co, by, bz, x0, x1, bins):
    """Max radius about the bore axis in each of `bins` slices of [x0, x1]."""
    out = []
    for b in range(bins):
        a, c = x0 + (x1 - x0) * b / bins, x0 + (x1 - x0) * (b + 1) / bins
        s = co[(co[:, 0] >= a) & (co[:, 0] <= c)]
        out.append(float(np.sqrt((s[:, 1] - by) ** 2 + (s[:, 2] - bz) ** 2).max()) if len(s) else 0.0)
    return out


def _assert_muzzle(co):
    """Muzzle at -X in the source: the front quarter bulges mid-span and tapers
    at its tip (the warhead), and the rearmost slice is the widest of the rear
    quarter (the bell). Fails if the model arrives mirrored, or if either end
    stops being what it is."""
    by, bz = _bore_yz(co)
    lo, hi = co[:, 0].min(), co[:, 0].max()
    q = (hi - lo) / 4.0
    head = _profile(co, by, bz, lo, lo + q, 10)
    bell = _profile(co, by, bz, hi - q, hi, 10)
    peak = head.index(max(head))
    if not (0 < peak < len(head) - 1 and head[0] < 0.6 * max(head)):
        raise SystemExit(f"[{TAG}] FAIL: the -X quarter does not read as a warhead -- profile "
                         f"{['%.3f' % r for r in head]}. Re-measure before re-orienting.")
    if not (bell[-1] == max(bell) and bell[-1] > 1.4 * min(bell)):
        raise SystemExit(f"[{TAG}] FAIL: the +X quarter does not open to a bell -- profile "
                         f"{['%.3f' % r for r in bell]}. Re-measure before re-orienting.")
    print(f"[{TAG}] muzzle check: warhead {head[0]:.3f}->{max(head):.3f}->{head[-1]:.3f} (peak bin {peak}); "
          f"bell {min(bell):.3f}->{bell[-1]:.3f}. Source muzzle at -X.")


def _assert_continuous(ob):
    """Every 1/SLICES of the length is crossed by at least one triangle -- a
    stem that the decimate collapsed away leaves an empty slice."""
    co = _coords(ob)
    lo, hi = co[:, 0].min(), co[:, 0].max()
    spans = np.array([(co[list(p.vertices), 0].min(), co[list(p.vertices), 0].max()) for p in ob.data.polygons])
    empty = []
    for b in range(SLICES):
        a, c = lo + (hi - lo) * b / SLICES, lo + (hi - lo) * (b + 1) / SLICES
        if not ((spans[:, 0] <= c) & (spans[:, 1] >= a)).any():
            empty.append(b)
    if empty:
        raise SystemExit(f"[{TAG}] FAIL: {len(empty)} of {SLICES} length slices hold no triangle "
                         f"(slices {empty}) -- the decimate cut the weapon in two. Decimate the tube "
                         f"and the warhead separately (the brief's fallback) before shipping this.")
    print(f"[{TAG}] continuity: all {SLICES} length slices crossed")


def _decimate(ob, target):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(ob.data)
    bm.free()
    bpy.context.view_layer.objects.active = ob
    before = len(ob.data.polygons)
    for ratio in (0.05, None):
        mod = ob.modifiers.new("dec", type="DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.use_collapse_triangulate = True
        mod.ratio = ratio if ratio is not None else target / len(ob.data.polygons)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    print(f"[{TAG}] decimate {before} -> {len(ob.data.polygons)} tris")


def _keep_base_color(ob):
    mats = [m for m in ob.data.materials if m is not None]
    if len(mats) != 1:
        raise SystemExit(f"[{TAG}] FAIL: expected one material, found {[m.name for m in mats]}")
    tree = mats[0].node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    link = next((l for l in tree.links if l.to_node == bsdf and l.to_socket.name == "Base Color"), None)
    if link is None or link.from_node.type != "TEX_IMAGE" or link.from_node.image is None:
        raise SystemExit(f"[{TAG}] FAIL: Base Color is not an image")
    base = link.from_node.image
    for node in list(tree.nodes):
        if node.type in ("NORMAL_MAP", "SEPARATE_COLOR", "SEPARATE_RGB") or (
                node.type == "TEX_IMAGE" and node.image is not base):
            tree.nodes.remove(node)
    for img in list(bpy.data.images):
        if img is not base:
            bpy.data.images.remove(img)
    before = tuple(base.size)
    base.scale(TEXTURE_PX, TEXTURE_PX)
    base.name = "part_color"
    mats[0].name = "rpg7"
    print(f"[{TAG}] base colour {before} -> {tuple(base.size)}; normal and metallic-roughness dropped")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out_path = os.path.abspath(argv[0]) if argv else DEFAULT_OUT
    target = int(os.environ.get("RPG7_TARGET_TRIS", TARGET_TRIS))   # falsification hook only
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    src = SRC if os.path.exists(SRC) else SRC_FALLBACK
    if not os.path.exists(src):
        raise SystemExit(f"[{TAG}] FAIL: source not found at {SRC} or {SRC_FALLBACK}")
    bpy.ops.wm.open_mainfile(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if [o.name for o in meshes] != ["mesh_node"]:
        raise SystemExit(f"[{TAG}] FAIL: expected the one welded `mesh_node`, found {[o.name for o in meshes]}")
    ob = meshes[0]
    co = _coords(ob)
    ext = co.max(axis=0) - co.min(axis=0)
    print(f"[{TAG}] source {os.path.basename(src)}: {len(ob.data.vertices)} verts, {len(ob.data.polygons)} tris, "
          f"extent {tuple(round(float(e), 5) for e in ext)}")
    _assert_muzzle(co)
    _keep_base_color(ob)
    _decimate(ob, target)
    _assert_continuous(ob)
    tris = len(ob.data.polygons)
    if not TRI_RANGE[0] <= tris <= TRI_RANGE[1]:
        raise SystemExit(f"[{TAG}] FAIL: {tris} tris outside {TRI_RANGE}")

    # Scale, muzzle to +X, origin on the bore axis at the X midpoint.
    co = _coords(ob)
    scale = OVERALL_M / float(co[:, 0].max() - co[:, 0].min())
    by, bz = _bore_yz(co)
    xm = (co[:, 0].max() + co[:, 0].min()) / 2.0
    co = (co - np.array((xm, by, bz))) * scale
    co[:, 0] *= -1.0      # the 180 degree Z turn: x -> -x, y -> -y
    co[:, 1] *= -1.0
    ob.data.vertices.foreach_set("co", co.ravel())
    ob.data.update()
    ob.name = ob.data.name = "rpg7"
    lo, hi = co.min(axis=0), co.max(axis=0)
    print(f"[{TAG}] scale {scale:.5f} m/unit; bbox x[{lo[0]:+.3f},{hi[0]:+.3f}] y[{lo[1]:+.3f},{hi[1]:+.3f}] "
          f"z[{lo[2]:+.3f},{hi[2]:+.3f}] m; {tris} tris; muzzle +X")

    for o in list(bpy.data.objects):
        if o is not ob:
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_extras=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_jpeg_quality=JPEG_QUALITY,
        export_copyright=(
            "RPG-7 launcher -- AI-generated (Meshy image-to-3D, textured bake), disclosed per "
            "CONTRIBUTING.md; decimated and re-framed for this repository as a crew-weapon part."
        ),
    )
    print(f"[{TAG}] wrote {out_path} ({os.path.getsize(out_path) / 1024:.1f} KiB)")


main()
