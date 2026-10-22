"""Export `heli_yanshuf` -- the UH-60 Yanshuf air-assault transport (GH-698;
design `docs/campaign/.../blackhawk/spec.md` section 6, prompt and numbers in
`docs/art/meshy-prompts-units.md` section 27) -- from its Meshy text-to-3D
remesh as a TEXTURED hull + rotor glTF, mesh contract v2 with the Peten's
rotor graph.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/export_meshy_yanshuf.py -- [--probe]
    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/export_meshy_yanshuf.py -- --preview <model.glb> --out <scratch.glb>

Writes `art/meshes/vehicles/heli_yanshuf.glb` and its `.blend`
(`art/src/aircraft/heli_yanshuf.blend`, the export session saved with the bake
packed). `--preview` runs the SAME cut, orientation and scale on a Meshy
PREVIEW download (untextured) and writes a palette-style GLB to `--out` and
nowhere else: it is how the preview's silhouette was judged against
`heli_peten` through `render_mesh_gate.py` BEFORE the refine was paid for
(the lead's rule for this unit). `--probe` prints the source's own numbers
and writes nothing.

THE METHOD. `export_meshy_apc.py`'s shape (one remesh in, roles out) with
the one thing a helicopter adds -- a spinning disc -- done the way
`export_meshy_apache.py` does it, and one thing it could not do: the Peten's
rotor was CUT ON MESHY'S OWN PART-SEGMENTATION SEAM, because that supplied
asset came with a part-segmentation twin. A text-to-3D remesh comes as ONE
welded shell with no twin, so the rotor is found geometrically:

  1. Import the ledger's LAST `kind: remesh` task named `heli_yanshuf` (a
     remesh of a REFINED task keeps its bake -- B0a's measurement); rename
     the base colour to `base_color` so `textured.prepare_vehicle_textures`
     finds it.
  2. Orient: the longest horizontal axis becomes X; the NOSE is the end whose
     outer quarter is WIDER in plan (a cabin against a tail boom) -- both
     widths are printed, and `nose_sign` in the spec overrides the read.
  3. The rotor: the vertices furthest out in plan (|y| beyond `tip_frac` of
     the half-span) can only be blade tips on this airframe -- the stabilator
     spans 4.4 m on a real UH-60 against a 16.4 m disc, 0.27 of it. Their
     lowest z, less a margin, is a horizontal cut just under the drooping
     tips. Every face above the cut is grouped into CONNECTED COMPONENTS and
     the component holding those tip vertices is the rotor (hub, mast top and
     blades); anything else above the cut -- a fin or tail-rotor top -- stays
     on the hull. The cut opens one loop on each side; ONLY the edges that
     became boundary are filled (`_cut_gun`'s rule: the remesh's UV seams
     already split vertices, so a blanket `holes_fill` would try to fill
     every seam).
  4. Hub and disc normal as the Peten's: hub = mean of the rotor's vertices
     within `hub_radius_frac` of its plan centre; normal = PCA over every
     vertex beyond `blade_detect_frac` of the tip radius. A disc at rest
     cones and may tilt; `rotor_tilt` (local Z = the normal) carries
     `rotor_pivot` (identity, `extras.rl_pivot = "rotor"`), which carries
     `rotor_metal` with its parent-inverse so nothing moves at export, and
     the renderer's `rotation.y` spin is about the disc's own axis.
  5. Scale the longest axis to `real_metres`, ground at z = 0 (the wheels),
     footprint centred on the origin.
  6. Two textured meshes: `hull_hull` and `rotor_metal`, both referencing the
     one baked material (the Peten ships its rotor the same way). Textures at
     `textured.TEXTURE_PX`; export through `textured.gltf_kwargs`.
     Re-run `pnpm wreck:meshes -- --id=heli_yanshuf`, then
     `pnpm damage:meshes -- --id=heli_yanshuf`, then `pnpm encode:meshes`.

THE DRAWN SIZE IS DECLARED, NOT READ, and derived from the Peten's shipped
bytes. The game draws helicopters far under real scale (a real disc is five
tiles across): `heli_peten.glb`'s live geometry measures 4.769 m along X
(rotor tip to rotor tip, read off the GLB 2026-10-18). A UH-60 is 19.76 m
overall against the AH-64's 17.73 m (rotors turning), x1.114; 16.36 m of
disc against 14.63 m, x1.118. 4.769 x 1.114 = 5.31 m, declared as 5.3 m so
the two airframes stand in the ratio the real ones do.

Ownership: this script owns `art/meshes/vehicles/heli_yanshuf.glb`. The
unit is deliberately NOT in `export_mesh_vehicle.py`'s `SPECS`, so nothing
in the kit can regenerate it (`tools/mesh_ownership.py`).

AI-generated source (Meshy text-to-3D preview + 2k refine + remesh),
disclosed per CONTRIBUTING.md; task ids in `docs/ASSET_PROVENANCE.md`.
DETERMINISM: no `mathutils.noise`; every threshold is a constant applied to
the source's own vertex data.
"""
import math
import os
import sys
from dataclasses import dataclass
from typing import Optional

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import textured as vehicle_textured  # noqa: E402
import bake_fix  # noqa: E402
from export_meshy_ramp import _remesh_source, _rename_textures, _fix_bake, _bake, _bounds  # noqa: E402

REPO = os.path.dirname(TOOLS)
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_PATH = os.path.join(OUT_DIR, "heli_yanshuf.glb")
BLEND_DIR = os.path.join(REPO, "art", "src", "aircraft")
BLEND_PATH = os.path.join(BLEND_DIR, "heli_yanshuf.blend")
TAU = 2.0 * math.pi


@dataclass(frozen=True)
class YanshufSpec:
    unit_id: str
    credit: str
    real_metres: float            # longest axis, metres -- see the docstring
    tri_cap: int
    tip_frac: float               # |y| beyond this fraction of the half-span is a blade tip
    cut_margin_frac: float        # of the model height, below the lowest tip
    hub_radius_frac: float        # of the rotor's plan span, around its centre
    blade_detect_frac: float      # of the tip radius, for the plane fit
    nose_sign: Optional[int] = None   # +1 nose at +X after the long-axis turn, -1 at -X, None = read it
    band_shift: Optional[dict] = None
    # `export_meshy_ramp._fix_bake`'s three switches, by name (it reads them off the spec).
    scrub_white: bool = False
    olive_shift: bool = False
    sand_olive: bool = False


SPEC = YanshufSpec(
    unit_id="heli_yanshuf",
    credit=(
        "UH-60 Yanshuf utility transport helicopter -- AI-generated (Meshy text-to-3D preview + "
        "2k refine + remesh), disclosed per CONTRIBUTING.md; re-oriented, re-scaled and cut into "
        "hull_hull / rotor_metal under rotor_tilt -> rotor_pivot for Roaring Lions (GH-698)"
    ),
    real_metres=5.3,
    tri_cap=45000,
    tip_frac=0.6,
    cut_margin_frac=0.015,
    hub_radius_frac=0.10,
    blade_detect_frac=0.35,
    # The refine painted a pale star and a stripe on each flank although the
    # prompt and the negative prompt both forbade insignia. The D9's
    # `scrub_white` (every channel above 0.55 linear, spread under 0.12, grown
    # 6 texels, filled from the neighbours; the normal and metallic-roughness
    # maps flattened under the same mask) covers 0.051% of this bake's
    # texels, measured 2026-10-18; a lighter grey under that threshold is
    # left as paint, since 0.3 would also take glazing highlights.
    scrub_white=True,
)


# ---------------------------------------------------------------------------
# measurements
# ---------------------------------------------------------------------------

def _coords(ob):
    return np.array([[v.co.x, v.co.y, v.co.z] for v in ob.data.vertices], dtype=np.float64)


def _turn_long_axis_to_x(ob):
    """Rz(90) when the longer HORIZONTAL extent is Y. Returns the degrees applied."""
    mn, mx = _bounds([ob])
    if (mx.y - mn.y) > (mx.x - mn.x):
        _bake([ob], Matrix.Rotation(math.radians(90.0), 4, "Z"))
        return 90.0
    return 0.0


def _nose_sign(spec, ob):
    """+1 if the nose is at +X, -1 at -X: the outer quarter at each end, by
    its plan WIDTH (max |y| extent of the slice). The cabin is wide, the
    boom is not. Both numbers are printed so an override is argued from
    them, never from a picture alone."""
    pts = _coords(ob)
    x0, x1 = pts[:, 0].min(), pts[:, 0].max()
    L = x1 - x0
    lo = pts[pts[:, 0] < x0 + 0.25 * L]
    hi = pts[pts[:, 0] > x1 - 0.25 * L]
    w_lo = lo[:, 1].max() - lo[:, 1].min()
    w_hi = hi[:, 1].max() - hi[:, 1].min()
    sign = 1 if w_hi > w_lo else -1
    print(f"[{spec.unit_id}] end widths: -X quarter {w_lo:.3f}, +X quarter {w_hi:.3f} "
          f"-> nose at {'+X' if sign > 0 else '-X'}" + (f" (spec override {spec.nose_sign:+d})" if spec.nose_sign else ""))
    return spec.nose_sign if spec.nose_sign else sign


def _rotor_faces(spec, ob):
    """Indices of the rotor's faces: the connected component above the tip
    cut that holds the blade-tip vertices. Also returns the cut height."""
    pts = _coords(ob)
    half_span = max(abs(pts[:, 1].min()), abs(pts[:, 1].max()))
    tips = pts[np.abs(pts[:, 1]) > spec.tip_frac * half_span]
    if len(tips) < 20:
        raise SystemExit(f"[{spec.unit_id}] only {len(tips)} blade-tip verts beyond {spec.tip_frac} of the half-span")
    H = pts[:, 2].max() - pts[:, 2].min()
    z_cut = tips[:, 2].min() - spec.cut_margin_frac * H
    print(f"[{spec.unit_id}] blade tips: {len(tips)} verts, z [{tips[:, 2].min():.4f}, {tips[:, 2].max():.4f}] "
          f"-> rotor cut at z {z_cut:.4f} (model top {pts[:, 2].max():.4f})")

    # Connected components over shared vertex POSITIONS, restricted to the
    # faces above the cut. Positions, not vertex indices: the remesh's UV
    # seams split its vertices, so by index every UV island is its own
    # component (measured on the shipped remesh: 1,489 components above the
    # cut and a 7-face "rotor"; by position, 1).
    me = ob.data
    key = lambda co: (round(co.x, 5), round(co.y, 5), round(co.z, 5))
    above = [p.index for p in me.polygons if p.center.z > z_cut]
    above_set = set(above)
    by_key = {}
    for fi in above:
        for vi in me.polygons[fi].vertices:
            by_key.setdefault(key(me.vertices[vi].co), []).append(fi)
    seen = set()
    comps = []
    for fi in above:
        if fi in seen:
            continue
        comp = []
        stack = [fi]
        seen.add(fi)
        while stack:
            g = stack.pop()
            comp.append(g)
            for vi in me.polygons[g].vertices:
                for h in by_key[key(me.vertices[vi].co)]:
                    if h not in seen:
                        seen.add(h)
                        stack.append(h)
        comps.append(comp)
    # The rotor is the component holding the furthest-out vertex in plan.
    tip_i = int(np.argmax(np.abs(pts[:, 1])))
    tip_faces = set(by_key.get(key(me.vertices[tip_i].co), []))
    rotor = next((c for c in comps if tip_faces & set(c)), None)
    if rotor is None:
        raise SystemExit(f"[{spec.unit_id}] the widest vertex is not above the rotor cut -- not a rotor disc")
    sizes = sorted((len(c) for c in comps), reverse=True)
    print(f"[{spec.unit_id}] {len(above)} faces above the cut in {len(comps)} component(s) {sizes[:6]}; "
          f"rotor = {len(rotor)} faces")
    return set(rotor), z_cut


def _split(spec, ob, rotor_faces):
    """Two copies, each with the other's faces deleted and ONLY the edges
    that became boundary filled."""
    parts = {}
    for name, keep_rotor in (("rotor_metal", True), ("hull_hull", False)):
        copy = ob.copy()
        copy.data = ob.data.copy()
        copy.name = copy.data.name = name
        bpy.context.collection.objects.link(copy)
        bm = bmesh.new()
        bm.from_mesh(copy.data)
        bm.faces.ensure_lookup_table()
        for e in bm.edges:
            e.tag = e.is_boundary
        doomed = [f for f in bm.faces if (f.index in rotor_faces) != keep_rotor]
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        opened = [e for e in bm.edges if e.is_boundary and not e.tag]
        filled = 0
        if opened:
            # The cut ring crosses the remesh's UV seams, where the vertices
            # are doubled, so the ring is several open chains until those
            # doubles are welded -- the ring's own vertices only, nothing else
            # on the mesh moves. The survivors keep the tag.
            ring = list({v for e in opened for v in e.verts})
            for v in ring:
                v.tag = True
            bmesh.ops.remove_doubles(bm, verts=ring, dist=1e-5)
            opened = [e for e in bm.edges if e.is_boundary and e.verts[0].tag and e.verts[1].tag]
            res = bmesh.ops.holes_fill(bm, edges=opened, sides=0)
            filled = len(res.get("faces", []))
        bm.to_mesh(copy.data)
        bm.free()
        copy.data.update()
        print(f"[{spec.unit_id}] {name}: {len(copy.data.polygons)} faces ({len(opened)} cut edges, {filled} fill faces)")
        parts[name] = copy
    bpy.data.objects.remove(ob, do_unlink=True)
    return parts


def _hub(spec, rotor):
    pts = _coords(rotor)
    cx = (pts[:, 0].min() + pts[:, 0].max()) / 2.0
    cy = (pts[:, 1].min() + pts[:, 1].max()) / 2.0
    span = max(pts[:, 0].max() - pts[:, 0].min(), pts[:, 1].max() - pts[:, 1].min())
    r = span * spec.hub_radius_frac
    near = pts[np.hypot(pts[:, 0] - cx, pts[:, 1] - cy) <= r]
    if len(near) == 0:
        raise SystemExit(f"[{spec.unit_id}] rotor hub: no vertices within {r:.4f} of the plan centre")
    hub = near.mean(axis=0)
    print(f"[{spec.unit_id}] rotor hub: {len(near)} verts within r={r:.4f} -> ({hub[0]:.4f},{hub[1]:.4f},{hub[2]:.4f}), span {span:.4f}")
    return hub, span / 2.0


def _disc_normal(spec, rotor, hub, radius):
    pts = _coords(rotor)
    r = np.hypot(pts[:, 0] - hub[0], pts[:, 1] - hub[1])
    blade = pts[r >= spec.blade_detect_frac * radius]
    if len(blade) < 50:
        raise SystemExit(f"[{spec.unit_id}] rotor plane: only {len(blade)} blade verts beyond {spec.blade_detect_frac} R")
    centred = blade - blade.mean(axis=0)
    _, _, vt = np.linalg.svd(centred, full_matrices=False)
    n = vt[2]
    if n[2] < 0:
        n = -n
    tilt = math.degrees(math.acos(max(-1.0, min(1.0, n[2]))))
    print(f"[{spec.unit_id}] rotor disc plane: normal ({n[0]:.4f},{n[1]:.4f},{n[2]:.4f}) tilt {tilt:.2f} deg "
          f"over {len(blade)} blade verts, residual sd {(centred @ n).std():.4f}")
    return Vector((float(n[0]), float(n[1]), float(n[2]))), tilt


def _blade_census(spec, rotor, hub, radius):
    """Angular occupancy beyond 0.35 R in 72 bins: how many blades the disc
    carries, for the damage recipe's `snapRotor` (which needs gaps between
    blades) and for the record."""
    pts = _coords(rotor)
    r = np.hypot(pts[:, 0] - hub[0], pts[:, 1] - hub[1])
    far = pts[r >= 0.35 * radius]
    ang = (np.degrees(np.arctan2(far[:, 1] - hub[1], far[:, 0] - hub[0])) + 360.0) % 360.0
    bins = np.zeros(72, dtype=bool)
    bins[(ang / 5.0).astype(int) % 72] = True
    runs = 0
    for i in range(72):
        if bins[i] and not bins[i - 1]:
            runs += 1
    print(f"[{spec.unit_id}] blade census: {runs} blade(s), {int(bins.sum())}/72 five-degree sectors occupied")
    return runs


def _olive_probe(spec, img):
    """The bake's paint band in HSV, printed beside the fleet olive the A3.2
    phase-2 ruling matched the Eitan to (Kipod hue 70.2 / sat 0.427 / val
    0.361), so a `band_shift` is argued from numbers if one is needed."""
    w, h = img.size
    px = np.empty(w * h * img.channels, dtype=np.float32)
    img.pixels.foreach_get(px)
    rgb = px.reshape(h, w, img.channels)[..., :3]
    hue, sat, val = bake_fix._hsv(rgb)
    band = (sat > 0.22) & (hue > 40.0) & (hue < 165.0)
    n = int(band.sum())
    if n:
        print(f"[{spec.unit_id}] bake paint band (sat>0.22, hue 40..165): {100.0 * n / (w * h):.1f}% of texels, "
              f"hue {float(hue[band].mean()):.1f} / sat {float(sat[band].mean()):.3f} / val {float(val[band].mean()):.3f} "
              f"(fleet olive: Kipod 70.2 / 0.427 / 0.361)")
    else:
        print(f"[{spec.unit_id}] bake paint band: no texels in the green band")


# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------

def _palette_gltf_kwargs(out_path, credit):
    """A preview has no bake: export zero materials, like a palette vehicle."""
    return dict(
        filepath=out_path, export_format="GLB", use_selection=False, export_apply=True,
        export_yup=True, export_skins=False, export_animations=False, export_texcoords=False,
        export_extras=True, export_materials="NONE", export_copyright=credit,
    )


def export(preview_src=None, out_path=None, probe=False):
    spec = SPEC
    preview = preview_src is not None
    if preview:
        src, task_id = preview_src, "preview"
    else:
        src, task_id = _remesh_source(spec.unit_id)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise SystemExit(f"[{spec.unit_id}] expected one mesh in {src}, found {[o.name for o in meshes]}")
    ob = meshes[0]
    for o in list(bpy.data.objects):
        if o is not ob and o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    ob.parent = None
    print(f"[{spec.unit_id}] source {os.path.relpath(src, REPO)} ({task_id}): {len(ob.data.polygons)} faces, "
          f"{len(ob.data.materials)} material(s), images {[i.name for i in bpy.data.images]}")
    # The importer leaves its unit conversion on the object; bake it into the vertices.
    _bake([ob], ob.matrix_world.copy())
    ob.matrix_world = Matrix.Identity(4)

    base = None
    if not preview:
        base = _rename_textures(spec, ob)
        _olive_probe(spec, base)
        if spec.scrub_white or spec.olive_shift or spec.sand_olive:
            _fix_bake(spec, base)
        if spec.band_shift is not None:
            bake_fix.band_shift_image(base, spec.unit_id, **spec.band_shift)
    else:
        ob.data.materials.clear()

    turned = _turn_long_axis_to_x(ob)
    sign = _nose_sign(spec, ob)
    if sign < 0:
        _bake([ob], Matrix.Rotation(math.radians(180.0), 4, "Z"))
    mn, mx = _bounds([ob])
    print(f"[{spec.unit_id}] oriented (turned {turned:.0f} deg{', flipped' if sign < 0 else ''}): "
          f"x[{mn.x:+.3f},{mx.x:+.3f}] y[{mn.y:+.3f},{mx.y:+.3f}] z[{mn.z:+.3f},{mx.z:+.3f}]")

    rotor_faces, z_cut = _rotor_faces(spec, ob)
    if probe:
        print(f"[{spec.unit_id}] --probe: {len(rotor_faces)} rotor faces above z {z_cut:.4f}; nothing written")
        return None
    parts = _split(spec, ob, rotor_faces)
    hull, rotor = parts["hull_hull"], parts["rotor_metal"]
    objs = [hull, rotor]

    # Scale, ground, centre -- on both pieces together.
    mn, mx = _bounds(objs)
    mpu = metres_per_unit(mx.x - mn.x, spec.real_metres)
    _bake(objs, Matrix.Scale(mpu, 4))
    mn, mx = _bounds(objs)
    _bake(objs, Matrix.Translation(-Vector(((mn.x + mx.x) / 2.0, (mn.y + mx.y) / 2.0, mn.z))))
    mn, mx = _bounds(objs)
    print(f"[{spec.unit_id}] {spec.real_metres:.3f} m long (declared), mpu {mpu:.5f}; "
          f"x[{mn.x:+.3f},{mx.x:+.3f}] y[{mn.y:+.3f},{mx.y:+.3f}] z[{mn.z:+.3f},{mx.z:+.3f}]")

    hub, radius = _hub(spec, rotor)
    normal, tilt = _disc_normal(spec, rotor, hub, radius)
    blades = _blade_census(spec, rotor, hub, radius)
    hub_v = Vector((float(hub[0]), float(hub[1]), float(hub[2])))

    for ob_, role, part in ((hull, "hull", "hull"), (rotor, "metal", "rotor")):
        for k in list(ob_.keys()):
            if k != "_RNA_UI":
                del ob_[k]
        ob_["rl_role"] = role
        ob_["rl_part"] = part

    # rotor_tilt (local Z = the disc normal) -> rotor_pivot (identity, rl_pivot) -> rotor_metal
    tilt_obj = bpy.data.objects.new("rotor_tilt", None)
    tilt_obj.empty_display_size = 0.25
    bpy.context.collection.objects.link(tilt_obj)
    tilt_obj.location = hub_v
    tilt_obj.rotation_mode = "QUATERNION"
    tilt_obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(normal)
    pivot_obj = bpy.data.objects.new("rotor_pivot", None)
    pivot_obj.empty_display_size = 0.5
    pivot_obj["rl_pivot"] = "rotor"
    bpy.context.collection.objects.link(pivot_obj)
    pivot_obj.parent = tilt_obj
    bpy.context.view_layer.update()
    rotor.parent = pivot_obj
    rotor.matrix_parent_inverse = pivot_obj.matrix_world.inverted()
    bpy.context.view_layer.update()
    drift = max(abs(c) for c in rotor.matrix_world.translation)
    if drift > 1e-5:
        raise SystemExit(f"[{spec.unit_id}] rotor re-parenting moved the mesh by {drift:.6f} m")

    tris = sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)
    if tris > spec.tri_cap and not preview:
        # A preview download is dense by nature (the remesh is what brings it
        # to the shipped count); the cap judges only what ships.
        raise SystemExit(f"[{spec.unit_id}] {tris} triangles over the cap {spec.tri_cap}")

    out = out_path or OUT_PATH
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    if preview:
        bpy.ops.export_scene.gltf(**_palette_gltf_kwargs(out, spec.credit + " [PREVIEW, untextured]"))
    else:
        kept, _dropped = vehicle_textured.prepare_vehicle_textures()
        for name, before, after in kept:
            print(f"[{spec.unit_id}] image {name}: {before} -> {after}")
        bpy.ops.export_scene.gltf(**vehicle_textured.gltf_kwargs(out, spec.credit))
        os.makedirs(BLEND_DIR, exist_ok=True)
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, compress=True)
        print(f"[{spec.unit_id}] saved {BLEND_PATH} ({os.path.getsize(BLEND_PATH)} bytes)")
    print(f"[{spec.unit_id}] wrote {out} ({os.path.getsize(out)} bytes, {tris} tris, "
          f"bounds {tuple(round(c, 3) for c in (mx - mn))}, hull_hull={len(hull.data.polygons)} "
          f"rotor_metal={len(rotor.data.polygons)}, {blades} blades, rotor_tilt {tilt:.2f} deg -> rotor_pivot -> rotor_metal, "
          f"hub ({hub_v.x:+.3f}, {hub_v.y:+.3f}, {hub_v.z:+.3f}) m)")
    return out


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    export(
        preview_src=argv[argv.index("--preview") + 1] if "--preview" in argv else None,
        out_path=argv[argv.index("--out") + 1] if "--out" in argv else None,
        probe="--probe" in argv,
    )
