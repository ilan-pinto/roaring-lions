"""Export one of the three supplied Meshy fence segments as the new `fence`
building pair, mesh contract v2's BUILDINGS section, matching the pattern
`export_meshy_clinic.py`/`_hall.py` already ship for a TEXTURED building --
with one structural difference this docstring's WRECK section explains: this
type has no destroyed source at all, so the wreck is derived here rather than
imported.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/export_meshy_fence.py

Writes `art/meshes/buildings/fence.glb` (standing) and
`art/meshes/buildings/fence_wreck.glb` (destroyed). This is a NEW type --
`data/structures.json` needs a `fence` entry (this script does not write
JSON; see the task report for the entry actually added), `packages/app/src/
mesh-catalogue.ts`'s `BUILDING_MESHES` needs a `fence` row, `packages/render/
src/three/units/building-mesh-role.ts`'s `WALL_SURFACE` needs a `fence` entry,
and both `TEXTURED_BUILDING_TYPES` (textured-building.ts) and
`TEXTURED_MESH_EXEMPT` (tools/validate_mesh_assets.py) need `fence` added, in
lockstep, per `textured-building.test.ts`.

SOURCE (AI-generated, Meshy, image-to-3D-texture mode -- disclosed per
CONTRIBUTING.md), three candidates, all in
`art/blend/terrain object/fences/`:

    Meshy_AI_fence_segment_v1_3d_0901144739_image-to-3d-texture.blend
    Meshy_AI_fence_segment_v2_3d_0901144931_image-to-3d-texture.blend
    Meshy_AI_fence_segment_v3_3d_0901145002_image-to-3d-texture.blend

CENSUS (this session, fresh per-file Blender process, raw un-decimated).
Every one of the three is a single mesh object `mesh_node`, zero modifiers,
one material (`base_color` 4096, `metallic_roughness` 2048, `normal` 4096 --
the latter two dropped at export, see `tools/buildings/textured.py`), one UV
map (`UVMap`) -- structurally identical to the clinic/hall pattern, unlike
what `docs/art/meshy-prompts-buildings.md` Prompt 3 predicted ("no texture
requested from Meshy for this one"): all three carry a real photographed
bake. World-space extent (x = post-to-post run, y = fence thickness,
z = height, including the coil wire on top):

    v1  979,315 verts / 1,961,622 polys   x=1.9034 y=0.2997 z=1.1505
    v2  974,863 verts / 1,953,134 polys   x=1.9212 y=0.2559 z=0.9187
    v3  977,836 verts / 1,958,452 polys   x=1.9031 y=0.1900 z=0.6849

All three are visually the same design at different proportions: a chain-
link panel between two square steel end-posts on base plates, with a coil
of concertina/razor wire along the top rail -- confirmed by rendering all
three through four dimetric Workbench-TEXTURE previews each (az45/135/225/
315, `dimetric.ELEVATION`, identity rotation -- the same technique
`export_meshy_clinic.py`/`_hall.py` use to measure orientation), which is
also how ORIENTATION was checked: at every one of the twelve renders the
panel and both end posts read identically from all four camera corners --
chain-link has no front, so there is nothing to get backwards, and
`ROT_Z = 0.0` needs no further justification.

WHICH ONE SHIPS, AND WHY: v1. Scaling each candidate's own long (X) axis to
one exact map tile (see SCALE below) and re-rendering all three at an
identical small field of view (the "how does a one-tile run actually read"
comparison, not a full-resolution beauty shot) gives real heights of 1.813 m
(v1), 1.435 m (v2) and 1.080 m (v3). v1 reads as a genuine security-camp
perimeter fence -- tall enough that the concertina on top registers as an
obstacle rather than decoration, matching the ~2.0 m the design doc's own
fallback prompt asks for. v2 is a waist-to-chest fence and v3 is knee-to-
waist; both still tile cleanly and are recorded here as the swap candidates
the lead can pick between (change `SRC` and `REAL_METRES_FENCE`'s divisor
source below -- the scale derivation is the same for all three). v1's coil
is also visibly coarser (fewer, larger turns over the same run) than v2/v3's
tighter coil, which reads better at the small sizes a one-tile structure
actually occupies on screen; v2/v3's tighter weave is the more likely of the
three to alias.

TILING MEASUREMENT. Three copies of v1, each scaled so its own X extent
equals exactly one tile (see SCALE), placed end to end along +X at exact
3.0 m spacing with NO gap and NO overlap, rendered from the real game
camera: the three end posts land exactly on the tile boundaries and read as
a single continuous run with one post per shared edge -- the same "posts
meet, panels butt" result `author_wall.py` gets by being SQUARE in plan.
This source is not square (thin along Y, long along X), which is the
difference that matters for the next paragraph.

AXIS READING -- MEASURED, and it is NOT symmetric, unlike `wall`.
`author_wall.py`'s own docstring gives the reason a compound-wall segment is
authored SQUARE in plan: "In dimetric an east-west wall and a north-south
wall are different shapes, so a single sprite can only serve both if the
segment has no long axis." This fence source has a long axis (X) by
construction, and `mesh-building.ts` never rotates a structure instance
("a building never turns; the sim tracks no orientation for one"). Rendering
the identical 3-copy test along world +Z instead of +X (still zero rotation,
exactly what `ThreeRenderer.updateBuildingMeshes` would place) confirms the
predictable failure: three separate short panels standing side on to the
run, each showing its THIN edge along the direction of travel, with visible
gaps of open ground between them -- not a fence, a row of gates. **This
fence type therefore reads correctly for a run along one map axis only**
(a horizontal run, i.e. a row of consecutive `f` tiles at the same y across
increasing x) **and reads wrong for a vertical run** (consecutive `f` tiles
down a column). This is reported plainly per this task's brief and is NOT
fixed here: fixing it means either a per-instance rotation `ThreeRenderer`/
`mesh-building.ts` does not have today for any building type (out of scope,
and `ThreeRenderer.ts` is a concurrent agent's file this session may not
touch), or a squared-off source geometry the lead would need to commission
or re-author. Placement is explicitly a later, measured pass -- see this
file's own task brief -- so this is recorded as an open decision, not
patched around.

WRECK -- DERIVED, not imported: none of the three sources ships a destroyed
pass (unlike clinic/hall, which both got an independent Meshy "_destroyed"
blend). Derived here, honestly and plainly, from the intact mesh after
decimation, by two purely geometric bmesh operations at source scale (before
the mpu/rotation bake, so both are scale-invariant):

  1. CUT THE MIDDLE THIRD. Every face whose centroid X falls in the middle
     third of the mesh's own X range is deleted, then any vertex left with
     no linked face (loose geometry the cut produces) is deleted too. This
     opens a breach exactly one tile-third wide in the panel, the coil wire
     included -- thematically apt for a type whose own design brief calls it
     "a delay and a gap-maker, not a fortification": a destroyed fence tile
     is a fence you can now walk through, not a flattened field of debris.
  2. LEAN THE TWO REMAINING STUBS outward. Each remaining half is rotated
     `WRECK_LEAN_DEG` about the world Y axis, hinged at its own base (lowest
     Z) at the cut edge nearest the gap, tipping its top AWAY from the
     breach -- as if whatever opened the gap forced the two stumps apart
     rather than simply erasing geometry. Because the middle third is
     already gone, the two stubs share no geometry across the gap and can
     rotate independently with no tearing.

No hand-posing in a .blend and no weight painting either way: both steps are
plain code-driven bmesh transforms on a rigid, unskinned mesh, run inside
this script, and are exactly as reproducible as the decimation step next to
them.

DECIMATION. `DECIMATE_RATIO = 0.01`, matching `house`/`apartment`/
`warehouse`/`clinic` at a comparable raw density (v1's 979k verts against
clinic's 961k) -- not re-swept from scratch, for the identical reason
`export_meshy_clinic.py` gives (four prior assets at this density already
measured 0.01 safe). Verified after the fact by `pnpm validate:meshes`
rather than a fresh per-ratio silhouette sweep.

ROLE. The whole mesh ships as ONE role, `wall`: it is one connected surface
with one material and no separable named parts (no roof, trim, dome, wood,
glass, metal or rust component the way a multi-material building has), and
`wall` is the correct member of `tools/buildings/kit.py`'s closed ROLES
set for "the wall material, whatever it is made of" -- exactly what
`render_mesh_gate.py`'s `apply_building_materials` expects for its own
repaint-for-silhouette render (`key = wall_key if role == "wall" else
BUILDING_ROLE_PALETTE.get(role)`), and what `WALL_SURFACE['fence']` (see
`building-mesh-role.ts`) governs for the (unused, since this ships textured)
palette/coursing fallback path. At runtime the role is inert for colour
either way -- `buildBuildingMeshTemplate` takes the textured branch before
ever consulting a role's ramp -- but the GLB still carries one on every part,
per the contract's own rule for every asset class.

GROUND ALIGNMENT / SCALE-INVARIANT REGISTRATION. Unlike clinic/hall, whose
wreck comes from an INDEPENDENT source file that could be mis-registered
against the intact one, this wreck is derived in-process from the same
source mesh with no XY translation at any step (the cut and lean are both
centred on the source's own geometry) -- so `dx = dy = 0.0` by construction,
and there is no cross-file registration to measure or reject. Both states
are still independently ground-shifted so each one's OWN lowest vertex lands
at z=0 (`export_meshy_clinic.py`'s own convention), which is enough: the
lean pivots at each stub's own base, so the lowest vertex does not move
during that step and grounding is unaffected by it.

SCALE. `REAL_METRES_FENCE = 3.0000` -- one full map tile, not an area-match
compromise the way a compact building's footprint is. This is the identical
design principle `author_wall.py` states for the kit-built `wall`: "Authored
a full tile across (3.0 units) so consecutive tiles abut with no seam."
A per-tile linear structure has exactly one axis that must hit a fixed
number (the run direction, so neighbouring tiles butt with no gap or
overlap); the other two axes (thickness, height) are whatever they are once
that one axis is fixed, which is why width-match on X -- not clinic/hall's
area-match compromise between two competing footprint axes -- is the correct
rule here.

HEIGHT_PX. Presentation-only fallback (`structure.schema.json`'s own words)
for the billboard/procedural-extrusion path, not consulted once this type's
mesh is loaded (`ThreeRenderer.ts`'s own comment on `buildingMeshBounds`:
"`heightPx` is the BILLBOARD's drawn wall height and is the right number for
that path and no other" -- the mosque's own 34 lift-px sits 3.8x off its
real mesh height for exactly this reason, and is shipped anyway). The
closest existing precedent for a low per-tile perimeter feature is `wall`
itself: 1.75 m of coping'd masonry (`author_wall.py`: BODY 1.55 + COPING_H
0.20) at `height_px = 7`, i.e. ~4.0 px per real metre on that same
billboard-era scale. Applied to this type's own real height (1.813 m,
v1's scaled Z extent): `round(1.813 * 4.0) = 7` -- unchanged from `wall`'s
own value, which is a coincidence of rounding rather than a claim that a
chain-link fence and a masonry wall present identically; it is recorded here
as measured-by-precedent rather than picked.

CREDIT / CUSTOM SPLIT NORMALS / UVs SHIP: identical to `export_meshy_clinic
.py`'s own conventions -- this is a textured building, per `tools/buildings/
textured.py`, the project lead's override of the mesh contract's "zero
materials" rule for supplied, photo-textured Meshy sources.
"""
import json
import math
import os
import sys

import bmesh
import bpy
import mathutils

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import kit as building_kit  # noqa: E402 -- tools/buildings/kit.py, ROLES
import textured  # noqa: E402 -- tools/buildings/textured.py, the shipped-material path

REPO = os.path.dirname(TOOLS)
# `art/blend/` is gitignored and local-only, same as every prior Meshy
# source in this pipeline. See docstring WHICH ONE SHIPS for why v1 --
# swap this one line (and nothing else) to try v2/v3 instead.
SRC_DIR = "/Users/ilpinto/dev/roaring-lions/art/blend/terrain object/fences"
SRC = os.path.join(SRC_DIR, "Meshy_AI_fence_segment_v1_3d_0901144739_image-to-3d-texture.blend")

#: See docstring SCALE.
REAL_METRES_FENCE = 3.0000

_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--out-dir" in _argv:
    OUT_DIR = _argv[_argv.index("--out-dir") + 1]
else:
    OUT_DIR = os.path.join(REPO, "art", "meshes", "buildings")
OUT_IDLE = os.path.join(OUT_DIR, "fence.glb")
OUT_WRECK = os.path.join(OUT_DIR, "fence_wreck.glb")

#: See docstring DECIMATION.
DECIMATE_RATIO = 0.01

#: See docstring ORIENTATION -- measured identical from all four dimetric
#: camera corners, so no rotation bake is needed either way.
ROT_Z = 0.0

#: See docstring WRECK. Fraction of the source's own X range removed as the
#: breach, and how far (degrees, about world Y) each remaining stub leans
#: away from it, hinged at its own base.
WRECK_GAP_FRAC = 1.0 / 3.0
WRECK_LEAN_DEG = 12.0

CREDIT = (
    "Perimeter fence segment (standing; destroyed derived) -- AI-generated "
    "(Meshy), disclosed per CONTRIBUTING.md; single wall-role mesh, wreck cut "
    "and leaned procedurally, re-scaled for Roaring Lions"
)


def _open_source(path, label):
    bpy.ops.wm.open_mainfile(filepath=path)
    ob = bpy.data.objects["mesh_node"]
    if ob.modifiers:
        raise SystemExit(f"fence {label}: mesh_node carries {len(ob.modifiers)} modifier(s)")
    return ob


def _extent(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    eo = ob.evaluated_get(dg)
    m = eo.to_mesh()
    xs = [(eo.matrix_world @ v.co).x for v in m.vertices]
    ys = [(eo.matrix_world @ v.co).y for v in m.vertices]
    zs = [(eo.matrix_world @ v.co).z for v in m.vertices]
    eo.to_mesh_clear()
    return (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)), min(zs)


def _decimate(ob, ratio, label):
    before_v, before_p = len(ob.data.vertices), len(ob.data.polygons)
    mod = ob.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after_v, after_p = len(ob.data.vertices), len(ob.data.polygons)
    print(
        f"[fence] {label} decimate ratio={ratio}: {before_v} -> {after_v} verts, "
        f"{before_p} -> {after_p} polys"
    )


def _make_wreck_damage(ob, gap_frac, lean_deg):
    """See docstring WRECK. Mutates `ob.data` in place; returns the breach
    bounds (source-scale X) for the printed summary."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()

    xs = [v.co.x for v in bm.verts]
    zs = [v.co.z for v in bm.verts]
    xlo, xhi = min(xs), max(xs)
    zlo = min(zs)
    cx = (xlo + xhi) / 2.0
    half_gap = (xhi - xlo) * gap_frac / 2.0
    gap_lo, gap_hi = cx - half_gap, cx + half_gap

    to_delete = [f for f in bm.faces if gap_lo <= f.calc_center_median().x <= gap_hi]
    bmesh.ops.delete(bm, geom=to_delete, context="FACES")
    bm.verts.ensure_lookup_table()
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    print(f"[fence_wreck] cut middle third: removed {len(to_delete)} faces, {len(loose)} loose verts")

    bm.verts.ensure_lookup_table()
    left_verts = [v for v in bm.verts if v.co.x < gap_lo]
    right_verts = [v for v in bm.verts if v.co.x > gap_hi]

    def lean(verts, hinge_x, angle_deg):
        if not verts:
            return
        mat = mathutils.Matrix.Rotation(math.radians(angle_deg), 4, "Y")
        bmesh.ops.rotate(bm, cent=(hinge_x, 0.0, zlo), matrix=mat, verts=verts)

    # Outward: the left stub's top tips further -X (away from centre), the
    # right stub's top tips further +X. See docstring WRECK step 2 for the
    # sign derivation.
    lean(left_verts, gap_lo, -lean_deg)
    lean(right_verts, gap_hi, lean_deg)
    print(
        f"[fence_wreck] leaned {len(left_verts)} left-stub vert(s) {-lean_deg:.1f} deg "
        f"about ({gap_lo:.4f},*,{zlo:.4f}), {len(right_verts)} right-stub vert(s) "
        f"{lean_deg:+.1f} deg about ({gap_hi:.4f},*,{zlo:.4f})"
    )

    bm.to_mesh(ob.data)
    bm.free()
    return gap_lo, gap_hi


def _bake_scale_rot(objs, mpu, rot_z, label):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
        ob.scale = (mpu, mpu, mpu)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if rot_z:
        bpy.ops.object.select_all(action="DESELECT")
        for ob in objs:
            ob.select_set(True)
            ob.rotation_mode = "XYZ"
            ob.rotation_euler = (0.0, 0.0, rot_z)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
        print(f"[{label}] baked +Z rotation {math.degrees(rot_z):.1f} degrees")
    else:
        print(f"[{label}] no rotation baked (ROT_Z=0 -- see docstring ORIENTATION)")


def _bake_shift_and_ground(objs, label):
    """No dx/dy registration parameter, unlike `export_meshy_clinic.py`'s --
    see docstring GROUND ALIGNMENT for why this type needs none."""
    zmin = min(min((ob.matrix_world @ v.co).z for v in ob.data.vertices) for ob in objs)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.location.z += -zmin
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    print(f"[{label}] baked ground shift +{-zmin:.4f} m -> lowest vertex at z=0")
    return zmin


def _all_world_verts(objs):
    out = []
    for ob in objs:
        mw = ob.matrix_world
        for v in ob.data.vertices:
            out.append(mw @ v.co)
    return out


def _finalize_and_export(ob, out_path):
    ob.name = "wall"
    ob.data.name = "wall"
    for k in list(ob.keys()):
        if k != "_RNA_UI":
            del ob[k]
    ob["rl_role"] = "wall"
    role_objs = {"wall": ob}

    textured.split_textured_roles(role_objs, "fence")
    tex_px = textured.prepare_textured_images()
    print(f"[fence] shipping base_color at {tex_px[0]}x{tex_px[1]}, JPEG q{textured.JPEG_QUALITY}")

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(**textured.gltf_kwargs(out_path, CREDIT))
    size = os.path.getsize(out_path)
    verts = len(ob.data.vertices)
    polys = len(ob.data.polygons)
    return size, verts, polys


def _report_extent(label, objs):
    world = _all_world_verts(objs)
    lo = (min(p.x for p in world), min(p.y for p in world), min(p.z for p in world))
    hi = (max(p.x for p in world), max(p.y for p in world), max(p.z for p in world))
    extent = (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
    print(
        f"[{label}] BOUNDING BOX: min=({lo[0]:.3f},{lo[1]:.3f},{lo[2]:.3f}) "
        f"max=({hi[0]:.3f},{hi[1]:.3f},{hi[2]:.3f}) "
        f"extent={extent[0]:.3f} x {extent[1]:.3f} x {extent[2]:.3f} m"
    )
    return lo, hi, extent


def export():
    real_metres = REAL_METRES_FENCE

    # ---------------- shared source, decimated once ----------------
    src_obj = _open_source(SRC, "source")
    img = bpy.data.images["base_color"]
    (ex, ey, ez), grade = _extent(src_obj)
    mpu = real_metres / ex
    print(
        f"[fence] source extent {ex:.4f} x {ey:.4f} x {ez:.4f} model units; "
        f"width-match mpu={mpu:.4f} (see docstring SCALE)"
    )

    src_obj.name = "shared_main"
    _decimate(src_obj, DECIMATE_RATIO, "shared")

    # Duplicate the decimated source into two independent objects: the
    # standing state (untouched) and the wreck (damaged below). `export_scene
    # .gltf` is called with `use_selection=False` (`textured.gltf_kwargs`,
    # shared with clinic/hall) -- it walks the whole SCENE, not the current
    # selection, so having both objects linked into the scene at once would
    # ship each one's export with a stray, unrelated second node (caught by
    # inspecting the first export's raw GLB bytes: a `wreck_main` node with no
    # `rl_role` riding along inside `fence.glb`). Every other exporter in this
    # pipeline avoids this by reloading a fresh .blend per state instead --
    # not available here, since both states share one decimation pass -- so
    # this one unlinks whichever object is not currently being exported
    # instead: `bpy.context.collection.objects.unlink` removes an object from
    # the scene without deleting its data, so the duplicate keeps existing in
    # `bpy.data` and can be relinked once it is its own turn.
    bpy.ops.object.select_all(action="DESELECT")
    src_obj.select_set(True)
    bpy.context.view_layer.objects.active = src_obj
    bpy.ops.object.duplicate()
    wreck_obj = bpy.context.object
    wreck_obj.name = "wreck_main"
    wreck_obj.data = wreck_obj.data.copy()
    bpy.context.collection.objects.unlink(wreck_obj)

    idle_obj = src_obj

    # ---------------- INTACT ----------------
    _bake_scale_rot([idle_obj], mpu, ROT_Z, "fence")
    _bake_shift_and_ground([idle_obj], "fence")
    idle_size, idle_v, idle_p = _finalize_and_export(idle_obj, OUT_IDLE)
    print(f"[fence] wrote {OUT_IDLE} ({idle_size} bytes, {idle_v} verts, {idle_p} polys, roles=['wall'])")
    _report_extent("fence", [idle_obj])

    # ---------------- DESTROYED ----------------
    bpy.context.collection.objects.unlink(idle_obj)
    bpy.context.collection.objects.link(wreck_obj)
    gap_lo, gap_hi = _make_wreck_damage(wreck_obj, WRECK_GAP_FRAC, WRECK_LEAN_DEG)
    print(
        f"[fence_wreck] breach at source-scale x in [{gap_lo:.4f},{gap_hi:.4f}] "
        f"of [{-ex/2:.4f},{ex/2:.4f}] -- {WRECK_GAP_FRAC:.3f} of the run"
    )
    _bake_scale_rot([wreck_obj], mpu, ROT_Z, "fence_wreck")
    _bake_shift_and_ground([wreck_obj], "fence_wreck")
    wreck_size, wreck_v, wreck_p = _finalize_and_export(wreck_obj, OUT_WRECK)
    print(f"[fence] wrote {OUT_WRECK} ({wreck_size} bytes, {wreck_v} verts, {wreck_p} polys, roles=['wall'])")
    _report_extent("fence_wreck", [wreck_obj])

    lowest_z = min((wreck_obj.matrix_world @ v.co).z for v in wreck_obj.data.vertices)
    if lowest_z > 0.05:
        raise SystemExit(f"fence_wreck: FLOATS -- lowest vertex sits at z={lowest_z:.3f} m, more than 5cm above ground.")
    print(f"[fence] wreck grounding VERIFIED: lowest vertex z={lowest_z:.4f} m")

    summary = {
        "real_metres": real_metres,
        "mpu": mpu,
        "decimate_ratio": DECIMATE_RATIO,
        "rotation_deg": math.degrees(ROT_Z),
        "wreck_gap_frac": WRECK_GAP_FRAC,
        "wreck_lean_deg": WRECK_LEAN_DEG,
        "idle": {"path": OUT_IDLE, "bytes": idle_size, "verts": idle_v, "polys": idle_p},
        "wreck": {"path": OUT_WRECK, "bytes": wreck_size, "verts": wreck_v, "polys": wreck_p},
    }
    print("SUMMARY_JSON " + json.dumps(summary))


if __name__ == "__main__":
    export()
