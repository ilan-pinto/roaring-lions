"""Export the six scattered-decor families -- grass, sand, bush, rock, slab,
tree -- as the `packages/render/src/three/terrain/decor-role.ts` mesh
contract: zero materials, zero images, every mesh node carrying
`extras.rl_role` from exactly `{foliage, trunk, rock, sand}`.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/terrain/export_meshy_decor.py

Writes 18 GLBs to `art/meshes/decor/<family>_<variant>.glb`, variant 0..2,
for `family` in `{grass, sand, bush, rock, slab, tree}` --
`docs/superpowers/plans/2026-09-01-terrain-c-mesh-decor.md`, Task 4.

SOURCES (all AI-generated, Meshy, disclosed per CONTRIBUTING.md), flat in

    /Users/ilpinto/dev/roaring-lions/art/blend/terrain object/

except the pre-existing `olive tree/` subdirectory (`stone/` also pre-exists
there but supplies nothing this task uses -- its `limestone_boulder_cluster`
is the large vehicle-blocking boulder for a different, not-yet-symbol-bearing
subsystem, the same reason this script does not touch the three
`Meshy_AI_rock_boulder_varN` files sitting flat alongside the families below).
`art/blend/` is gitignored and does not exist inside a worktree checkout, so
SRC_DIR is an absolute path into the main repo's own untracked working
directory, exactly as `tools/buildings/export_meshy_camp.py`'s own SRC_DIR is.

## THE FAMILY MAP -- not derivable from filenames, so recorded once here

    family  source prefix                              variants  role(s)
    grass   Meshy_AI_foliage_grass_tuft_va               4 -> 3   foliage
    sand    Meshy_AI_sand_gravel_patch_var                3      sand
    bush    Meshy_AI_shrub_desert_varN (+ _spl_ company)  3      trunk + foliage
    rock    Meshy_AI_rock_cluster_varN                    3      rock
    slab    Meshy_AI_rock_outcrop_varN                    3      rock
    tree    olive tree/ (2 sources)                       2 -> 3 trunk + foliage

Every one of the 15 grass/sand/rock/slab source files was opened and
inspected: each is a single object named `mesh_node`, zero materials, zero
images, zero UV layers, zero modifiers -- a plain low-poly primitive with
nothing to strip. `rock`/`slab` share ONE role (`rock`) on purpose: they are
both bare stone at different scales, and `decor-role.ts`'s ramp table has no
`slab`-specific entry -- the family name is a placement/silhouette distinction
(`decor-place.ts` puts `rock` on knoll tiles, `slab` on ridges), not a colour
one.

## TWO DECISIONS THE PLAN LEFT OPEN, SETTLED HERE

**Grass: 4 sources, ship 3.** `VARIANTS_PER_FAMILY` stays 3 (ruled, not
revisited -- raising it would reshuffle every existing placement's variant on
every shipped map for no visual gain). The four grass sources are
interchangeable procedural tuft variations with no material or role
difference between them, so which three ship is not an aesthetic question --
`GRASS_SRC` below takes the first three by generation timestamp and drops the
last (`..._0901053011_generate.blend`), a deterministic, arbitrary-but-fixed
choice rather than a judged one.

**Tree: 2 sources, ship 3.** `TREE_SRC` exports `tree_0` from the first
source and `tree_1` from the second. `tree_2` is a SECOND export of the
second source (`0831112418`), not a fresh decimation of the same cached
result -- picked over the first by side-by-side render (see the report for
both preview PNGs): its canopy is fuller and more rounded, reading better as
a small silhouette at gameplay zoom, where the first source's crown is more
triangular/upward-funnelled. This ships all three `tree_N` keys with real
geometry rather than leaving `tree_2` to the loader's silent-drop-on-missing-
key behaviour, which the plan explicitly warns would punch holes in groves.

## BUSH -- why the part-segmentation companion, and how the split is read

The plain `Meshy_AI_shrub_desert_varN_..._generate.blend` source is ONE
object with no signal to split trunk from foliage -- exactly the "single-
object export gives one flat colour" problem the plan's own note names. Its
`_spl_..._part-segmentation` companion instead ships 12 objects, each with a
flat per-object `Color` attribute (Meshy's part-segmentation convention, the
same one `export_meshy_camp.py` reads). Unlike the camp's 20-plus hue
families, all three shrub sources reduce to exactly TWO hue clusters: ~5 deg
(red-orange, the woody trunk/stem/twig objects) and ~55 deg (yellow-olive,
the leaf clusters) -- verified per source by rendering the classification
back as vertex colour (see report's four preview renders) rather than
assumed from the hue numbers alone. `HUE_TRUNK_MAX` below is the threshold
(30 deg, roughly equidistant between the two observed clusters on every one
of the three sources). How MANY objects land on the trunk side varies by
source -- var1 and var2 each model one clean central stem (1 trunk object,
11 and 18 foliage objects respectively), var3 additionally tags six thin
twig/branch-extension objects reaching up into the canopy with the same
woody hue (8 trunk objects, 9 foliage) -- so the code asserts "at least one
trunk object", not exactly one, and joins whichever count it finds. The gate
that DOES fail loudly is an empty trunk or foliage set, which would mean a
regenerated source no longer splits on this hue threshold at all.

## TREE -- decimation, and a GEOMETRIC (not colour) trunk/foliage split

Both tree sources are `image-to-3d-texture` mode: ONE ~950k-975k-vertex
object carrying a real PBR material (base_color/metallic_roughness/normal,
4096x4096) and no vertex colours, no part segmentation -- the opposite
problem from the bush. Sampling `base_color` through the UV
(`tools/export_meshy_sniper.py`'s own `sample_vertex_colours` precedent) was
tried first and rejected: the texture's hue runs a continuous 20-70 deg band
with no clean bark/leaf split, and worse, a light-coloured root-flare region
at the very base would misclassify as `foliage` under any lightness
threshold that also catches the canopy -- both trees show a genuinely lighter
root flare, not a texture artefact (see report).

The signal that DOES separate them cleanly, checked on both sources
independently and confirmed by re-rendering the classification as vertex
colour (see report's four preview renders): raw Z height. Below
`TREE_TRUNK_Z` (-0.20, in the source's own centred, unscaled frame) is
gnarled trunk and root flare -- narrow radius, no leaves; above it the canopy
spreads out. This is applied to the mesh AFTER decimation (order matters: a
977 vert = 0 float will move slightly and it must not cross the seam it was
measured against; decimation was checked to leave the split visually
identical -- see report) and is a geometric rule about *shape*, not colour,
so it survives the material strip that removes the only signal an image-
based split would have used anyway.

Decimated to `TREE_TARGET_VERTS` (3500) total, not the building pipeline's
`DECIMATE_RATIO = 0.02` (~19.5k on an asset this size): a tree is scattered
across every grove tile, and `decor-mesh.ts`'s `BatchedMesh` uploads vertex
data ONCE per distinct `family_variant` geometry, not once per placement
instance (real GPU instancing -- confirmed by reading that module), so
3500 verts is not "3500 per tree drawn": it is the one-time cost of the
`tree_N` entry the batch shares across every placed tree. Sized instead
against this project's existing low-poly decor budget (rock ~120-230 verts,
shrub ~250) with headroom for a much larger, more detailed hero silhouette.

## SCALE -- the "3 GLB units per tile" convention, deliberately NOT MESH_SCALE

Every decor GLB here is baked to the SAME convention
`tools/buildings/export_meshy_camp.py` and every vehicle/building export use:
`MESH_UNITS_PER_TILE = 3.0`, calibrated so 1 GLB unit is ~1 real metre (the
camp's own convention: `REAL_METRES_CAMP = FOOTPRINT_TILES * 3.0` exactly).
This is deliberate, NOT an oversight of the runtime's `MESH_SCALE = 1/3`
(`packages/render/src/three/units/mesh-anim.ts`): every other loader in this
pipeline (units, buildings, vehicles) divides by 3 at LOAD time to bring a
"3 units per tile" GLB down into the "1 world unit per tile" scene space
`decor-place.ts`'s placements are computed in (its own doc comment: "game
tile (x, y) -> (x, height, y)", no build-time-to-world conversion applied).
Exporting decor pre-divided by 3 here would make it the one mesh class in the
whole pipeline built to a different convention than its own siblings, which
is a worse trap than a documented seam: it would be invisible until someone
"fixed" the loader to match every other GLB and tripled every decor object's
size again. **The seam stays exactly where the plan's Task 6 notes already
put it**: `ThreeRenderer.loadDecorMeshes` (or `buildDecorMesh`) must apply
`MESH_SCALE = 1/3` when it turns these GLBs into placed geometry, the same as
every other mesh loader in the file already does. This script does not touch
that loader -- Task 4 is the asset, Task 6 is the wiring -- but ships nothing
that could be loaded correctly without it.

Per-family target sizes (in GLB build-units, ~metres at this convention),
each a judged real-world size for the object, NOT derived from the source's
own arbitrary Meshy normalisation:

    family  target  calibration axis   why
    grass   0.40    longest axis       a low tuft/clump, ~40 cm
    sand    1.20    longest axis       a modest gravel patch, ~1.2 m across
    bush    0.90    Z (height)         a desert shrub, ~90 cm tall
    rock    0.75    longest axis       a small rock cluster, ~75 cm across
    slab    1.50    longest axis       a flatter, wider outcrop, ~1.5 m
    tree    3.40    Z (height)         a small olive tree, a little over 1 tile tall

`bush` and `tree` calibrate on Z (height) rather than "longest axis of any
kind", the same principle `dimetric.metres_per_unit`'s own docstring gives
for a standing figure ("declared by height"): both are mostly-vertical forms,
and the bush's own three segmentation sources make this concrete -- their
X-extents range 0.05 to 0.24 units (var2 is much bushier/wider than var1/3)
while their Z-extents are IDENTICAL to five decimal places (0.12 on all
three). Calibrating on the longest axis would have made the wide var2 come
out visibly SHORTER than the narrow var1/3 to hit the same target -- the
opposite of the intended "same-height, different-silhouette" family. `tree`
inherits the same reasoning: a canopy that droops wide on one source and
narrow on the other should still stand the same height.

## PROCESS

Every export bakes scale then a ground shift so the LOWEST vertex across
every role object in that variant lands at Z=0 (`_bake_scale_and_ground`,
adapted from `export_meshy_camp.py`'s own helper of the same name -- for
`bush`/`tree` this is computed ONCE across both the trunk and foliage
objects together, so their relative height is preserved rather than each
independently re-grounded to its own lowest point, which would sink a
canopy's dangling leaf-tips to Z=0 instead of the trunk's true base).
"""
import json
import os
import sys

import bpy
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)

from dimetric import metres_per_unit  # noqa: E402

REPO = os.path.dirname(TOOLS)

# `art/blend/` is gitignored and does not exist inside a worktree checkout --
# see module docstring. Same pattern as export_meshy_camp.py's own SRC_DIR.
SRC_DIR = "/Users/ilpinto/dev/roaring-lions/art/blend/terrain object"
TREE_DIR = os.path.join(SRC_DIR, "olive tree")

_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--out-dir" in _argv:
    OUT_DIR = _argv[_argv.index("--out-dir") + 1]
else:
    OUT_DIR = os.path.join(REPO, "art", "meshes", "decor")

CREDIT = (
    "Scattered terrain decor (grass/sand/bush/rock/slab/tree) -- AI-generated "
    "(Meshy), disclosed per CONTRIBUTING.md; role-tagged, re-scaled and grounded "
    "for Roaring Lions"
)

DECOR_ROLES = {"foliage", "trunk", "rock", "sand"}

MESH_UNITS_PER_TILE = 3.0  # matches every other export script's own constant.

# ---------------------------------------------------------------------------
# Source lists. See module docstring "THE FAMILY MAP" for the mapping and
# "TWO DECISIONS" for why grass drops one source and tree ships three from two.
# ---------------------------------------------------------------------------
GRASS_SRC = [
    os.path.join(SRC_DIR, "Meshy_AI_foliage_grass_tuft_va_0901052505_generate.blend"),
    os.path.join(SRC_DIR, "Meshy_AI_foliage_grass_tuft_va_0901052710_generate.blend"),
    os.path.join(SRC_DIR, "Meshy_AI_foliage_grass_tuft_va_0901052954_generate.blend"),
    # 0901053011_generate.blend deliberately DROPPED -- 4th of 4, see docstring.
]
SAND_SRC = [
    os.path.join(SRC_DIR, "Meshy_AI_sand_gravel_patch_var_0901052549_generate.blend"),
    os.path.join(SRC_DIR, "Meshy_AI_sand_gravel_patch_var_0901052640_generate.blend"),
    os.path.join(SRC_DIR, "Meshy_AI_sand_gravel_patch_var_0901053000_generate.blend"),
]
ROCK_SRC = [
    os.path.join(SRC_DIR, "Meshy_AI_rock_cluster_var1_0901052542_generate.blend"),
    os.path.join(SRC_DIR, "Meshy_AI_rock_cluster_var2_0901052557_generate.blend"),
    os.path.join(SRC_DIR, "Meshy_AI_rock_cluster_var3_0901052657_generate.blend"),
]
SLAB_SRC = [
    os.path.join(SRC_DIR, "Meshy_AI_rock_outcrop_var1_0901052721_generate.blend"),
    os.path.join(SRC_DIR, "Meshy_AI_rock_outcrop_var2_0901052930_generate.blend"),
    # var3 is duplicated as "... (1).blend" -- byte-identical (md5 checked),
    # the base filename used, the copy skipped.
    os.path.join(SRC_DIR, "Meshy_AI_rock_outcrop_var3_0901052744_generate.blend"),
]
BUSH_SRC = [
    os.path.join(SRC_DIR, "Meshy_AI_shrub_desert_var1_spl_0901053026_part-segmentation.blend"),
    os.path.join(SRC_DIR, "Meshy_AI_shrub_desert_var2_spl_0901053035_part-segmentation.blend"),
    os.path.join(SRC_DIR, "Meshy_AI_shrub_desert_var3_spl_0901053016_part-segmentation.blend"),
]
# tree_2 re-exports TREE_SRC[1] -- see docstring "TWO DECISIONS".
TREE_SRC = [
    os.path.join(TREE_DIR, "Meshy_AI_lowpoly_olive_tree_0831111939_image-to-3d-texture.blend"),
    os.path.join(TREE_DIR, "Meshy_AI_lowpoly_olive_tree_0831112418_image-to-3d-texture.blend"),
    os.path.join(TREE_DIR, "Meshy_AI_lowpoly_olive_tree_0831112418_image-to-3d-texture.blend"),
]

# Per-family target size (GLB build-units, ~metres) and calibration axis.
# See module docstring "SCALE" for the reasoning behind each number and axis.
FAMILY_TARGET = {
    "grass": (0.40, "longest"),
    "sand": (1.20, "longest"),
    "rock": (0.75, "longest"),
    "slab": (1.50, "longest"),
}
BUSH_TARGET_HEIGHT = 0.90
TREE_TARGET_HEIGHT = 3.40
TREE_TARGET_VERTS = 3500

# Bush: hue (degrees, HLS) at or below this is the trunk/stem; above it is a
# leaf cluster. See module docstring "BUSH".
HUE_TRUNK_MAX = 30.0

# Tree: raw (unscaled, source-frame) Z below this is trunk/root; at or above
# it is canopy. See module docstring "TREE".
TREE_TRUNK_Z = -0.20


def _meshes():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def _world_verts(ob):
    return [ob.matrix_world @ v.co for v in ob.data.vertices]


def _extent(objs, axis=None):
    """Combined bounding-box extent across every object in `objs`, in world
    space. `axis` picks one of 'x'/'y'/'z'; None (default) returns the
    longest of the three."""
    pts = [p for ob in objs for p in _world_verts(ob)]
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    zs = [p.z for p in pts]
    ex, ey, ez = max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)
    if axis == "x":
        return ex
    if axis == "y":
        return ey
    if axis == "z":
        return ez
    return max(ex, ey, ez)


def _strip(ob):
    """Clear materials and any custom split normals. No vertex-colour layer
    survives past the classification step that reads it (bush), so this is
    the one shared cleanup every family needs."""
    ob.data.materials.clear()
    while ob.data.color_attributes:
        ob.data.color_attributes.remove(ob.data.color_attributes[0])
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.mode_set(mode="OBJECT")
    # Repairs in place (returns True if it found and fixed something) --
    # the tree's `mesh.separate` at an aggressive decimation ratio produced
    # one duplicate face on two of the three tree exports (a decimate/
    # separate interaction, not a source-file defect: the plain single-object
    # families never trip this). A leftover duplicate face is invisible
    # (an exact double-draw of one triangle) but is still an invalid mesh the
    # glTF exporter would warn about on every future run -- fixed here so
    # every shipped GLB is clean, not merely "warned about and shipped anyway".
    if ob.data.validate(verbose=True):
        print(f"[{ob.name}] mesh.validate() found and fixed invalid geometry -- see the "
              f"'geom.mesh' lines just above this one for what")


def _bake_scale_and_ground(objs, mpu, label):
    """Scale every object in `objs` by `mpu`, then shift them ALL by the same
    amount so the lowest vertex across the whole group lands at Z=0. Shared
    across the group (not per-object) so a multi-part variant's relative
    height survives -- see module docstring "PROCESS"."""
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
        ob.scale = (mpu, mpu, mpu)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    zmin = min(min(v.co.z for v in ob.data.vertices) for ob in objs)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.location.z = -zmin
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    ex = _extent(objs)
    print(f"[{label}] mpu={mpu:.4f} ground shift {-zmin:+.6f} (post-scale units), "
          f"final longest-axis extent {ex:.3f}")


def _finalize_and_export(role_objs, out_path, label):
    """role_objs: {rl_role: bpy.types.Object}. Tags, clears every custom
    prop but rl_role, exports one GLB. Returns (bytes, verts, polys, roles)."""
    for role, ob in role_objs.items():
        if role not in DECOR_ROLES:
            raise SystemExit(f"[{label}] role {role!r} outside the closed decor "
                              f"vocabulary {sorted(DECOR_ROLES)}")
        ob.name = role
        ob.data.name = role
        ob.data.materials.clear()
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        ob["rl_role"] = role

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_extras=True,          # off by default and drops rl_role silently
        export_materials="NONE",
        export_copyright=CREDIT,
    )
    size = os.path.getsize(out_path)
    verts = sum(len(ob.data.vertices) for ob in role_objs.values())
    polys = sum(len(ob.data.polygons) for ob in role_objs.values())
    print(f"[{label}] wrote {out_path} ({size} bytes, {verts} verts, {polys} polys, "
          f"roles={sorted(role_objs)})")
    return size, verts, polys, sorted(role_objs)


# ---------------------------------------------------------------------------
# grass / sand / rock / slab -- single mesh_node, one role, no split needed.
# ---------------------------------------------------------------------------
def _export_single_role(label, src, role, target, axis, out_path):
    bpy.ops.wm.open_mainfile(filepath=src)
    meshes = _meshes()
    if len(meshes) != 1 or meshes[0].name != "mesh_node":
        raise SystemExit(f"[{label}] expected exactly one 'mesh_node' object, "
                          f"found {[o.name for o in meshes]}")
    ob = meshes[0]
    if ob.data.materials or ob.data.color_attributes:
        raise SystemExit(f"[{label}] source unexpectedly carries a material or "
                          f"vertex colour -- inspection found none; re-check the source")
    _strip(ob)
    extent = _extent([ob], axis=None if axis == "longest" else axis)
    mpu = metres_per_unit(extent, target)
    _bake_scale_and_ground([ob], mpu, label)
    return _finalize_and_export({role: ob}, out_path, label)


# ---------------------------------------------------------------------------
# bush -- part-segmentation source, hue-classified into trunk + foliage.
# ---------------------------------------------------------------------------
def _object_colour(ob):
    mesh = ob.data
    if not mesh.color_attributes:
        return None
    layer = mesh.color_attributes[0]
    n = len(layer.data)
    if not n:
        return None
    return (
        sum(d.color[0] for d in layer.data) / n,
        sum(d.color[1] for d in layer.data) / n,
        sum(d.color[2] for d in layer.data) / n,
    )


def _hue_degrees(ob):
    import colorsys
    colour = _object_colour(ob)
    if colour is None:
        return None
    h, _l, _s = colorsys.rgb_to_hls(*colour)
    return h * 360.0


def _export_bush_variant(label, src, out_path):
    bpy.ops.wm.open_mainfile(filepath=src)
    meshes = _meshes()
    trunk_objs, foliage_objs = [], []
    for ob in meshes:
        hue = _hue_degrees(ob)
        if hue is None:
            raise SystemExit(f"[{label}] {ob.name}: no per-object Color attribute "
                              f"-- expected every part-segmentation object to carry one")
        (trunk_objs if hue <= HUE_TRUNK_MAX else foliage_objs).append(ob)

    if len(trunk_objs) < 1:
        raise SystemExit(f"[{label}] found 0 trunk-hued objects -- the hue<="
                          f"{HUE_TRUNK_MAX} split matched nothing; re-derive "
                          f"HUE_TRUNK_MAX against the regenerated source")
    if len(foliage_objs) < 5:
        raise SystemExit(f"[{label}] only {len(foliage_objs)} foliage-hued objects "
                          f"found -- expected roughly a dozen leaf clusters")
    print(f"[{label}] trunk={len(trunk_objs)} object(s), foliage={len(foliage_objs)} object(s)")

    joined = {}
    for role, objs in (("trunk", trunk_objs), ("foliage", foliage_objs)):
        bpy.ops.object.select_all(action="DESELECT")
        for ob in objs:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        target_ob = bpy.context.view_layer.objects.active
        _strip(target_ob)
        joined[role] = target_ob

    extent = _extent(list(joined.values()), axis="z")
    mpu = metres_per_unit(extent, BUSH_TARGET_HEIGHT)
    _bake_scale_and_ground(list(joined.values()), mpu, label)
    return _finalize_and_export(joined, out_path, label)


# ---------------------------------------------------------------------------
# tree -- decimate, then a Z-height geometric split into trunk + foliage.
# ---------------------------------------------------------------------------
def _decimate(ob, target_verts, label):
    before_v = len(ob.data.vertices)
    ratio = min(1.0, target_verts / before_v)
    mod = ob.modifiers.new("decor_decimate", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after_v = len(ob.data.vertices)
    print(f"[{label}] decimate ratio={ratio:.5f}: {before_v} -> {after_v} verts")


def _split_tree_by_height(ob, label):
    """Selects every vertex at raw Z < TREE_TRUNK_Z, separates it into a new
    object. Returns (trunk_ob, foliage_ob). Must run BEFORE scale/ground so
    the threshold applies in the frame it was measured in -- see docstring."""
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bm = bmesh.from_edit_mesh(ob.data)
    for v in bm.verts:
        v.select = v.co.z < TREE_TRUNK_Z
    # `separate(type='SELECTED')` moves geometry by FACE selection, and a bare
    # per-vertex flag does not propagate to edges/faces on its own. The first
    # attempt here flushed by hand (`e.select = all(v.select for v in
    # e.verts)`, same for faces) and that made things WORSE, not better:
    # assigning False to a BMesh edge/face's `.select` also deselects ITS OWN
    # vertices as a side effect (undocumented in the obvious place, confirmed
    # empirically -- see report), so the very act of marking the majority of
    # (non-trunk) faces unselected wiped every trunk vertex's flag straight
    # back to 385 -> 60 -> 0 selected. `select_flush_mode()` is BMesh's own
    # purpose-built flush -- in VERTEX select mode (the mode this file is
    # always in) it derives edge/face selection FROM the vertex flags using
    # the correct read-only direction, leaving the vertex flags exactly as
    # this loop just set them.
    bm.select_flush_mode()
    # Counted BEFORE `bmesh.update_edit_mesh` -- that call can invalidate this
    # `bm` handle for further reads (a fresh `bmesh.from_edit_mesh` would be
    # needed after it), and reading `v.select` on the stale handle afterward
    # was observed to silently report 0 selected regardless of what was just
    # set, rather than erroring -- caught by comparing against a direct
    # z-threshold count taken at the same point, see report.
    n_trunk = sum(1 for v in bm.verts if v.select)
    n_total = len(bm.verts)
    print(f"[{label}] pre-separate vertex selection: {n_trunk}/{n_total} below "
          f"TREE_TRUNK_Z={TREE_TRUNK_Z}")
    if n_trunk == 0 or n_trunk == n_total:
        bpy.ops.object.mode_set(mode="OBJECT")
        raise SystemExit(f"[{label}] TREE_TRUNK_Z={TREE_TRUNK_Z} selected {n_trunk}/"
                          f"{n_total} verts -- split produced an empty side; "
                          f"re-derive the threshold against the regenerated source")
    bmesh.update_edit_mesh(ob.data)
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    # After `separate`, `ob` keeps the UNSELECTED verts (foliage, z >= thresh)
    # and the new object gets the selected ones (trunk). Identify by name
    # rather than by list position, which `separate`'s own docs do not pin.
    new_obj = [o for o in bpy.data.objects if o.name.startswith(ob.name) and o is not ob]
    if len(new_obj) != 1:
        raise SystemExit(f"[{label}] expected exactly one new object from "
                          f"bpy.ops.mesh.separate, found {len(new_obj)}")
    trunk_ob, foliage_ob = new_obj[0], ob
    print(f"[{label}] split: trunk {len(trunk_ob.data.vertices)} verts, "
          f"foliage {len(foliage_ob.data.vertices)} verts")
    return trunk_ob, foliage_ob


def _export_tree_variant(label, src, out_path):
    bpy.ops.wm.open_mainfile(filepath=src)
    meshes = _meshes()
    if len(meshes) != 1 or meshes[0].name != "mesh_node":
        raise SystemExit(f"[{label}] expected exactly one 'mesh_node' object, "
                          f"found {[o.name for o in meshes]}")
    ob = meshes[0]
    if len(ob.data.materials) != 1:
        raise SystemExit(f"[{label}] expected exactly one material to strip, "
                          f"found {len(ob.data.materials)}")
    _decimate(ob, TREE_TARGET_VERTS, label)
    trunk_ob, foliage_ob = _split_tree_by_height(ob, label)
    _strip(trunk_ob)
    _strip(foliage_ob)

    extent = _extent([trunk_ob, foliage_ob], axis="z")
    mpu = metres_per_unit(extent, TREE_TARGET_HEIGHT)
    _bake_scale_and_ground([trunk_ob, foliage_ob], mpu, label)
    return _finalize_and_export({"trunk": trunk_ob, "foliage": foliage_ob}, out_path, label)


def export():
    summary = {}

    for family, srcs, role in (
        ("grass", GRASS_SRC, "foliage"),
        ("sand", SAND_SRC, "sand"),
        ("rock", ROCK_SRC, "rock"),
        ("slab", SLAB_SRC, "rock"),
    ):
        target, axis = FAMILY_TARGET[family]
        for variant, src in enumerate(srcs):
            label = f"{family}_{variant}"
            out_path = os.path.join(OUT_DIR, f"{label}.glb")
            result = _export_single_role(label, src, role, target, axis, out_path)
            summary[label] = {"path": out_path, "bytes": result[0], "verts": result[1],
                               "polys": result[2], "roles": result[3]}

    for variant, src in enumerate(BUSH_SRC):
        label = f"bush_{variant}"
        out_path = os.path.join(OUT_DIR, f"{label}.glb")
        result = _export_bush_variant(label, src, out_path)
        summary[label] = {"path": out_path, "bytes": result[0], "verts": result[1],
                           "polys": result[2], "roles": result[3]}

    for variant, src in enumerate(TREE_SRC):
        label = f"tree_{variant}"
        out_path = os.path.join(OUT_DIR, f"{label}.glb")
        result = _export_tree_variant(label, src, out_path)
        summary[label] = {"path": out_path, "bytes": result[0], "verts": result[1],
                           "polys": result[2], "roles": result[3]}

    print("SUMMARY_JSON " + json.dumps(summary))


if __name__ == "__main__":
    export()
