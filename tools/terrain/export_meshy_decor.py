"""Export the scattered-decor families -- grass, sand, bush, rock, slab, tree,
boulder -- as the `packages/render/src/three/terrain/decor-role.ts` mesh
contract: zero materials, zero images, every mesh node carrying
`extras.rl_role` from exactly `{foliage, trunk, rock, sand}`.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/terrain/export_meshy_decor.py

    # Add --only <family>[,<family>...] to export a subset without touching
    # every already-shipped GLB -- e.g. the boulder family alone:
    #     ... --python tools/terrain/export_meshy_decor.py -- --only boulder

Writes 21 GLBs to `art/meshes/decor/<family>_<variant>.glb`, variant 0..2, for
`family` in `{grass, sand, bush, rock, slab, tree, boulder}` -- the first six
from `docs/superpowers/plans/2026-09-01-terrain-c-mesh-decor.md` Task 4;
`boulder` from the T1-C follow-up that draws the `b` map symbol (T1-B) as an
actual obstacle instead of bare ground.

SOURCES (all AI-generated, Meshy, disclosed per CONTRIBUTING.md), flat in

    /Users/ilpinto/dev/roaring-lions/art/blend/terrain object/

except the pre-existing `olive tree/` subdirectory (`stone/` also pre-exists
there but supplies nothing this script uses -- its `limestone_boulder_cluster`
is a large vehicle-blocking boulder for a DIFFERENT source; `boulder` below
exports the three `Meshy_AI_rock_boulder_varN` files that sit flat alongside
the other families instead). `art/blend/` is gitignored and does not exist
inside a worktree checkout, so SRC_DIR is an absolute path into the main
repo's own untracked working directory, exactly as `tools/buildings/
export_meshy_camp.py`'s own SRC_DIR is.

## THE FAMILY MAP -- not derivable from filenames, so recorded once here

    family       source prefix                                  variants  role(s)
    grass        Meshy_AI_foliage_grass_tuft_va                   4 -> 3   foliage
    sand         Meshy_AI_sand_gravel_patch_var                    3      sand
    bush         Meshy_AI_shrub_desert_varN (+ _spl_ company)      3      trunk + foliage
    rock         Meshy_AI_rock_cluster_varN                        3      rock
    slab         Meshy_AI_rock_outcrop_varN                        3      rock
    tree         olive tree/ (2 sources)                          2 -> 3  trunk + foliage
    boulder      Meshy_AI_rock_boulder_varN                        3      rock
    desert_tree  bush's own var1/var3 _spl_ files (var2 excluded)  2 -> 3  trunk + foliage

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
second source (`0831112418`), picked over the first by side-by-side render
(see the report for both preview PNGs): its canopy is fuller and more
rounded, reading better as a small silhouette at gameplay zoom, where the
first source's crown is more triangular/upward-funnelled. This ships all
three `tree_N` keys with real geometry rather than leaving `tree_2` to the
loader's silent-drop-on-missing-key behaviour, which the plan explicitly
warns would punch holes in groves.

**CORRECTION, 2026-09-07.** The paragraph above used to end "not a fresh
decimation of the same cached result", which reads as a claim that `tree_2`
differs from `tree_1`. It does not: `TREE_SRC[1] is TREE_SRC[2]` literally,
the pipeline is deterministic, and the two shipped files are BYTE-IDENTICAL
(md5 `c9b22c2165d69da590c42f9cdab0e708`, both 826,504 bytes -- verified from
disk, not inferred). So the olive grove has always drawn TWO silhouettes
across three variant slots, and a third of every olive tile is a repeat of
another third. It is recorded rather than fixed because the fix is a
judgement about the olive's own art, not a bug in this script -- and because
`desert_tree` below, which faced the identical "three from two" situation,
answers it a different way (a procedural crown that differs per variant,
`DESERT_CROWN` -- see docstring "DESERT CROWN"; retired its own earlier
foliage-thinning answer to the same question, `DESERT_TREE_THIN_STRIDE`, on
2026-09-27) that a future olive pass could copy.

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
spreads out. It is a geometric rule about *shape*, not colour, so it
survives the material strip that removes the only signal an image-based
split would have used anyway.

**FIX ROUND 2 correction, 2026-09-27 ("split trunk and leaves").** This used
to say the split is "applied to the mesh AFTER decimation (order matters: ...
it must not cross the seam it was measured against)". That was Fix round 1's
design and it is retired: splitting on ALREADY-decimated geometry let one
shared merge-by-distance pass relocate vertices near `TREE_TRUNK_Z` across
the threshold, which measurably moved the trunk/foliage colour boundary (a
limb that read trunk-brown before that merge read foliage-green after it --
see `.superpowers/ground2/trees-preview/compare-full.png`) and skewed the
whole-tree p1-p99 depth check by 15.7% (`task-6-report.md`, fix round 1, item
1). The split now runs FIRST, on the untouched source, and decimation runs
per-part afterward (`_export_tree_variant`'s own docstring) -- classification
by construction cannot drift, because decimating an object already on one
side of the split can never move a vertex to the other object.

**Decimated by TRIANGLE count, not vertex count (D8, R-9, approved by the
lead 2026-09-27).** `TREE_TARGET_TRIS` (3000) replaces the earlier
`TREE_TARGET_VERTS` (3500): a face-count target is what `decimate_type =
"COLLAPSE"`'s own `ratio` actually consumes (`ratio = target /
len(mesh.polygons)`, not `/ len(mesh.vertices)`), and the two numbers are
close for the roughly-triangulated raw scan but stop agreeing once the mesh
is triangulated first (a quad-heavy region halves its face count without
halving its vertex count). Triangulating BEFORE measuring `faces` makes the
ratio exact rather than approximate, and the exporter always triangulates
implicitly (glTF ships triangles only), so nothing downstream changes by
doing it explicitly one step earlier. The source .blend is untouched --
this only changes what the EXPORT script decimates to.

The 3500-vert budget undershot in practice (the two live sources decimate to
roughly 13,000+ triangles at that vertex ratio, because COLLAPSE's ratio is
read against face count while the target was a vertex count -- a unit
mismatch baked into the original constant). `TREE_TARGET_TRIS = 3000` is a
genuine quarter of that: still scattered across every grove tile with
`decor-mesh.ts`'s `BatchedMesh` uploading vertex data ONCE per distinct
`family_variant` geometry (real GPU instancing, not per-instance cost), so
the number is the one-time shared cost of the `tree_N` entry, not "3000
triangles per tree drawn" -- and still comfortably above this project's
existing low-poly decor budget (rock ~120-230 verts, shrub ~250) for a
larger, more detailed hero silhouette, just a quarter the size it used to
ship at.

## DESERT TREE -- reusing bush's own sources, and correcting a claim about precedent

The project lead: "using olive tree does not fit the desert terrain. you
should use other trees from the blend folder." Censused before touching
anything: the only tree geometry in the whole blend library is `olive tree/`
(already `tree_N` above), and `map.schema.json` defaults `terrain` to `arid`,
so every non-`green` map (everything shipped but Wadi Halam) currently stands
Mediterranean olives on desert ground. The desert-appropriate foliage that
DOES exist is `bush`'s own `Meshy_AI_shrub_desert_varN` part-segmentation
set, rendered orthographically for this task: `var1` and `var3` are upright,
thin-stemmed, open-crowned shrubs that read as an acacia or tamarisk at tree
height, while `var2` is low and spreading -- a ground shrub, not a tree
candidate, and deliberately excluded here exactly as `bush` already keeps it
distinct from the other two.

`DESERT_TREE_SRC` therefore reads `BUSH_SRC[0]` and `BUSH_SRC[2]` -- the same
files, not new sources -- through `_export_desert_tree_variant`, which keeps
only `_export_bush_variant`'s trunk half: it opens the same source, hue-
classifies it the same way (`HUE_TRUNK_MAX` unchanged -- same sources, same
measured split, nothing new to derive), keeps the trunk objects, and
calibrates to `DESERT_TREE_TARGET_HEIGHT` (2.90, not `BUSH_TARGET_HEIGHT`'s
0.90). What used to happen to the foliage half is superseded -- see "DESERT
CROWN" below.

**CORRECTION, 2026-09-27 (D8, N-13, N-14, approved by the lead).** Every
paragraph below this point used to describe keeping the bush's own foliage
(the Mediterranean leaf-cluster blobs, thinned by `DESERT_TREE_THIN_STRIDE`
on the third variant to avoid a byte-identical repeat of `desert_tree_1`).
That shipped a genuinely desert-appropriate TRUNK standing under a foliage
silhouette copied wholesale from the same asset used to grow the bush
family's own low ground shrubs -- workable, but not what N-13/N-14 asked
for: a crown shaped and sized for this task, per variant, with a footprint
band the lead signed off on (`DESERT_CROWN`). The thinning lever
(`DESERT_TREE_THIN_STRIDE`) is retired along with it -- `desert_tree_1` and
`desert_tree_2` now differ by their crown (8 clumps in a 1.15-1.5 m band
against 5 in a 1.0-1.3 m band), not by which trunk twig objects survived, so
the "third variant from two sources" question this section used to answer no
longer has the shape it once did: the SOURCE `.blend` for `desert_tree_1`
and `desert_tree_2` is still the identical file (`BUSH_SRC[2]`, i.e. `var3`,
per `DESERT_TREE_SRC` above -- untouched, exactly as every other family's
source stays untouched here), but the two shipped GLBs are not byte-identical
because the procedural crown differs.

## DESERT CROWN -- N-13/N-14, a procedural crown replacing the bush's own foliage

`_build_crown(variant, trunk_objs)` deletes nothing the caller has not
already decided to discard (the bush-hued foliage objects, removed outright
via `bpy.data.objects.remove`, not merely left unselected -- `_finalize_and
_export` exports with `use_selection=False`, so an unselected-but-present
object would still ship) and grows `DESERT_CROWN[variant][0]` leafy clumps
in its place: one centred on the trunk's own top, the rest spaced around a
ring at 0.72-0.95 of the trunk's height (fraction and angle both from
`_crown_hash01`, never `mathutils.noise` -- see "Determinism" below).

Each clump starts as an icosphere at `DESERT_CROWN_ICOSPHERE_SUBDIV` = 3 (320
faces -- FIX ROUND 1: this was wrongly documented as 2 here. Blender's own
`create_icosphere(subdivisions=N)` starts N=1 at the bare 20-face icosahedron
and quadruples per level, so N=2 gives only 80 faces -- already BELOW every
`DESERT_CROWN_TRIS_PER_CLUMP` target, and `_crown_clump`'s decimate step only
ever reduces, so 2 would leave it nothing to do. See that constant's own
comment), decimated by TRIANGLE count (same reasoning as `_decimate` above:
triangulate first, then `DECIMATE`/`COLLAPSE` against the triangulated face
count) to a per-clump target SOLVED from the trunk's own measured triangle
count and `DESERT_CROWN_TRIS`'s midpoint, clamped into
`DESERT_CROWN_TRIS_PER_CLUMP` (150-220) -- FIX ROUND 1: this was wrongly
documented as merely "hashed into" that range; see `_build_crown`'s own
docstring for why a fixed per-clump range alone can miss the WHOLE-TREE band
this is actually gated on -- then scaled to an ellipsoid --
`DESERT_CROWN_CLUMP_RADIUS_M` (0.32, inside the approved 0.28-0.45 m band) in
X/Y, flattened to `DESERT_CROWN_CLUMP_FLATTEN_Z` (0.7) in Z -- and finally
every vertex is pushed outward along its own (unit-sphere) normal by
hand-rolled value noise for a ragged, leafy edge rather than a smooth ball.

**Solving the ring radius in closed form, not by guess-and-check.** The
clumps are built in the SAME raw (pre-`_bake_scale_and_ground`), arbitrary
Meshy-source unit frame the trunk already lives in -- exactly like every
other family's trunk/foliage pair -- so the two combine under one shared
`mpu` (metres-per-unit) once the crown is attached. But `mpu` is not known
UNTIL the crown is attached (it depends on the crown's own height
contribution above the trunk), so building the crown "the right size" would
otherwise need a build-measure-rebuild loop. It does not, because the crown's
only height contribution beyond the trunk's own raw extent is the single top
clump's own half-height, so

    mpu = (DESERT_TREE_TARGET_HEIGHT - DESERT_CROWN_CLUMP_FLATTEN_Z * DESERT_CROWN_CLUMP_RADIUS_M) / trunk_height_raw

is exact for an idealised sphere (and close enough after the ragged-edge
noise push, given `DESERT_CROWN`'s wide bands, to land inside them --
verified against the shipped bytes, see the task report). From that closed-
form `mpu`, the metric clump radius and the metric ring radius (solved so
`2 * (ring_radius_m + DESERT_CROWN_CLUMP_RADIUS_M)` lands at the midpoint of
`DESERT_CROWN[variant]`'s footprint band) both convert directly to the raw
units the clumps are actually built in. The REAL `mpu` used at export time is
still the one `_export_desert_tree_variant` measures from the finished
mesh's actual extent, same as every other family -- this closed form is only
how the crown's OWN geometry is sized before that measurement happens, not a
substitute for it.

**Determinism.** `_crown_hash01` is the same FNV-1a-style integer hash
`tools/terrain/props.py`'s own `_hash01` and `render_building.py`'s
`_hash01` already use in this tree -- reimplemented here rather than
imported across three otherwise-independent builders, per that file's own
precedent. Every clump's face-count target, ring placement fraction, ring
angle jitter and per-vertex ragged-edge push reads from it, seeded from small
integers this file already knows (variant, clump index, vertex index): same
inputs, same floats, every run, on any machine, forever -- which is what
makes Step 4's export-twice-and-md5 check meaningful at all. `mathutils.noise`
is never called anywhere in this function.

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

    family       target  calibration axis   why
    grass        0.40    longest axis       a low tuft/clump, ~40 cm
    sand         1.20    longest axis       a modest gravel patch, ~1.2 m across
    bush         0.90    Z (height)         a desert shrub, ~90 cm tall
    rock         0.75    longest axis       a small rock cluster, ~75 cm across
    slab         1.50    longest axis       a flatter, wider outcrop, ~1.5 m
    tree         3.40    Z (height)         a small olive tree, a little over 1 tile tall
    boulder      2.50    longest axis       vehicle-blocking, against a 3 m tile
    desert_tree  2.90    Z (height)         a small acacia/tamarisk, shorter and
                                             airier than the olive's 3.40 -- right
                                             for this setting, still under a tile-
                                             and-a-bit

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

## BOULDER -- why "longest axis", not "2.5 wide x 2.0 tall" literally

The generation prompt for these three sources asked Meshy for "~2.5 m across
and 2.0 m tall against a ~3 m tile", but the returned geometry is NOT a fixed
2.5:2.0 aspect ratio -- var1 is near-cubic and slightly TALLER than wide
(measured extent 0.857 x 0.914 x 1.000, Z the longest axis), var2 is close to
cubic the other way (0.996 x 1.000 x 0.863), and var3 is a flat, wide slab
(1.000 x 0.395 x 0.365, X the longest axis by nearly 3x). `_bake_scale_and_ground`
only ever applies one ISOTROPIC scalar (`ob.scale = (mpu, mpu, mpu)`, shared
by every family in this file) -- there is no independent width-vs-height
target the way `bush`/`tree` get by calibrating on Z alone, because these
three sources do not share a common "mostly-vertical" shape the way bush and
tree do. Forcing var3 up to a literal 2.0 m tall would need a ~5.5x Z-only
stretch that no other family in this file does and that visibly warps a
naturally flat rock into an artificial slab. `longest axis = 2.5` (the SAME
convention `rock`/`slab` already use) is the safer, precedented choice: it
reproduces the ~2.5 m footprint on all three variants and lands close to
2.0 m tall on the two cubic ones (var1 2.50 m, var2 2.16 m) while var3 comes
out a genuinely flatter, wider obstacle (2.50 m x 0.99 m x 0.91 m) -- shape
variety a real boulder field would have anyway, not a defect. Measured
against `art/meshes/vehicles/mbt_lavi.glb` (a Merkava-style MBT, exported at
the same 3-units-per-tile convention): the tank is 2.11 tile-widths long,
0.96 wide, 1.05 tall in WORLD units after the loader's own /3 `MESH_SCALE`.
A `longest axis = 2.5` boulder is 2.5/3 = 0.83 tile-widths across after the
same division -- comparably wide to the tank's own hull, and (on the two
taller variants) roughly two-thirds its height.

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
import math
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

# `--only grass,boulder` restricts export() to those families -- so adding a
# new family later (as this file's own boulder addendum just did) can ship
# its GLBs without re-exporting the other, already-shipped ones. None means
# "every family", the original (and still default) behaviour.
if "--only" in _argv:
    ONLY_FAMILIES = set(_argv[_argv.index("--only") + 1].split(","))
else:
    ONLY_FAMILIES = None

CREDIT = (
    "Scattered terrain decor (grass/sand/bush/rock/slab/tree/boulder) -- "
    "AI-generated (Meshy), disclosed per CONTRIBUTING.md; role-tagged, "
    "re-scaled and grounded for Roaring Lions"
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
BOULDER_SRC = [
    os.path.join(SRC_DIR, "Meshy_AI_rock_boulder_var1_0901052936_generate.blend"),
    os.path.join(SRC_DIR, "Meshy_AI_rock_boulder_var2_0901052738_generate.blend"),
    os.path.join(SRC_DIR, "Meshy_AI_rock_boulder_var3_0901052728_generate.blend"),
]
# desert_tree reuses BUSH_SRC's own var1/var3 files -- NOT new sources; var2
# (the low, spreading one) stays excluded, same as `bush` treats it as one of
# three shrub variants rather than promoting it. desert_tree_2 re-exports
# var3 (the same file as desert_tree_1) but is thinned in
# _export_desert_tree_variant, not a literal duplicate -- see docstring
# "DESERT TREE".
DESERT_TREE_SRC = [
    BUSH_SRC[0],  # var1 -- upright, thin-stemmed, open crown
    BUSH_SRC[2],  # var3 -- upright, thin-stemmed, open crown
    BUSH_SRC[2],  # var3 again, thinned below -- not a byte-identical repeat
]

# Per-family target size (GLB build-units, ~metres) and calibration axis.
# See module docstring "SCALE" (and "BOULDER" for why that one is "longest"
# rather than a literal width/height pair) for the reasoning behind each.
FAMILY_TARGET = {
    "grass": (0.40, "longest"),
    "sand": (1.20, "longest"),
    "rock": (0.75, "longest"),
    "slab": (1.50, "longest"),
    "boulder": (2.50, "longest"),
}
BUSH_TARGET_HEIGHT = 0.90
TREE_TARGET_HEIGHT = 3.40
TREE_TARGET_TRIS = 3000  # by TRIANGLE count, not vertex count -- see docstring "TREE" (D8, R-9)
# Merge-by-distance threshold, as a FRACTION of the mesh's own bounding-box
# diagonal (never a fixed absolute unit distance), escalated until the merge
# alone gets within reach of TREE_TARGET_TRIS -- see `_decimate`'s own
# docstring for why COLLAPSE cannot close the whole gap from one fixed pass.
TREE_MERGE_DIAG_FRAC_INITIAL = 0.010
TREE_MERGE_GROWTH = 1.15
TREE_MERGE_OVERSHOOT = 1.3   # merge target: within 30% of TREE_TARGET_TRIS, then COLLAPSE finishes it
TREE_MERGE_MAX_ITERS = 20
# Fix round 1: `_decimate` raises rather than ships silently off target. A
# result above TREE_TARGET_TRIS is always an error; a result below this
# fraction of it means TREE_TARGET_TRIS was set above what the merge
# escalation alone naturally settles at on this source -- see `_decimate`'s
# own docstring, "honesty correction".
TREE_UNDERSHOOT_FLOOR = 0.8
# Fix round 2 (lead decision 2026-09-27, "split trunk and leaves"): the
# trunk's own decimation target is `TREE_TARGET_TRIS * (trunk's share of the
# RAW, pre-decimation triangle count)`, clamped into this band -- never a
# fixed absolute number (today's two sources would need different ones,
# ~330-390, and a THIRD source's own proportions would silently go stale)
# and never a fixed fraction of TREE_TARGET_TRIS (that would bake in today's
# sources' own ~11-13% raw share as if it meant something universal). See
# `_export_tree_variant`'s own docstring.
TREE_TRUNK_TARGET_MIN = 100
TREE_TRUNK_TARGET_MAX = 600
DESERT_TREE_TARGET_HEIGHT = 2.90  # shorter/airier than the olive -- see docstring "SCALE"

# Desert crown (N-13, N-14, approved by the lead 2026-09-27): per variant,
# (clump count, min footprint diameter m, max footprint diameter m). Replaces
# the bush foliage entirely on desert_tree -- see docstring "DESERT CROWN".
DESERT_CROWN = {
    0: (7, 2.0, 2.6),
    1: (8, 1.15, 1.5),
    2: (5, 1.0, 1.3),
}
DESERT_CROWN_TRIS = (1200, 1800)  # whole-tree triangle band, trunk + crown together

# Per-clump triangle band (D8/N-14): a leafy blob, not a smooth ball. See
# docstring "DESERT CROWN".
DESERT_CROWN_TRIS_PER_CLUMP = (150, 220)
# Blender's own `create_icosphere(subdivisions=N)` starts N=1 at the bare
# icosahedron (20 faces) and quadruples per level -- 2 gives 80, BELOW every
# `DESERT_CROWN_TRIS_PER_CLUMP` target, so `_crown_clump`'s decimate step
# (which only ever reduces) would have nothing to do. 3 (320 faces) is the
# lowest subdivision that starts above the band on every clump, leaving
# DECIMATE COLLAPSE a real trim to make rather than a no-op.
DESERT_CROWN_ICOSPHERE_SUBDIV = 3
DESERT_CROWN_CLUMP_RADIUS_M = 0.32   # inside the approved 0.28-0.45 m band
DESERT_CROWN_CLUMP_FLATTEN_Z = 0.7   # ellipsoid, flattened in Z
DESERT_CROWN_NOISE_AMP_M = 0.06      # ragged-edge push, at DESERT_CROWN_CLUMP_RADIUS_M
DESERT_CROWN_NOISE_FRAC = DESERT_CROWN_NOISE_AMP_M / DESERT_CROWN_CLUMP_RADIUS_M

# Bush: hue (degrees, HLS) at or below this is the trunk/stem; above it is a
# leaf cluster. See module docstring "BUSH". desert_tree reuses this
# threshold unchanged -- same sources, same measured split.
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
# desert_tree -- bush's own trunk, a procedural desert crown (D8, N-13/N-14).
# See module docstring "DESERT TREE" and "DESERT CROWN".
# ---------------------------------------------------------------------------
def _crown_hash01(*ints):
    """Deterministic 0..1 from integers -- never `mathutils.noise`, see
    module docstring "DESERT CROWN". Same FNV-1a-style mix
    `tools/terrain/props.py`'s own `_hash01` uses; reimplemented here rather
    than imported across two otherwise-independent builders."""
    h = 2166136261
    for v in ints:
        h ^= (int(v) & 0xFFFFFFFF)
        h = (h * 16777619) & 0xFFFFFFFF
        h ^= h >> 13
    return (h & 0xFFFFFFFF) / 4294967295.0


def _crown_clump(name, radius_raw, seed, target_tris):
    """One leafy clump: an icosphere, decimated by TRIANGLE count to
    `target_tris` (already clamped into `DESERT_CROWN_TRIS_PER_CLUMP` by the
    caller), scaled to an ellipsoid, then every vertex pushed outward along
    its own (unit-sphere) normal by hand-rolled value noise for a ragged
    edge. Never `mathutils.noise`. `seed` is a tuple of small ints, unpacked
    into `_crown_hash01` alongside each call's own salt."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=DESERT_CROWN_ICOSPHERE_SUBDIV, radius=1.0)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)

    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    tri_mod = ob.modifiers.new("crown_triangulate", type="TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier=tri_mod.name)

    before_t = len(ob.data.polygons)
    ratio = min(1.0, target_tris / before_t) if before_t else 1.0
    if ratio < 1.0:
        dec = ob.modifiers.new("crown_decimate", type="DECIMATE")
        dec.decimate_type = "COLLAPSE"
        dec.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=dec.name)

    for i, v in enumerate(ob.data.vertices):
        n = v.co.normalized()
        push = (_crown_hash01(*seed, i, 7) * 2.0 - 1.0) * DESERT_CROWN_NOISE_FRAC
        v.co += n * push

    ob.scale = (radius_raw, radius_raw, radius_raw * DESERT_CROWN_CLUMP_FLATTEN_Z)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return ob


def _build_crown(variant, trunk_objs):
    """Grow `DESERT_CROWN[variant][0]` leafy clumps around `trunk_objs`' own
    top -- one centred on the apex, the rest on a ring at 0.72-0.95 of the
    trunk's height. Returns the (unjoined) clump objects; the caller joins
    them into one `foliage` object exactly like every other family here. See
    module docstring "DESERT CROWN" for the closed-form radius solve.

    Per-clump triangle target is SOLVED, not merely hashed within
    `DESERT_CROWN_TRIS_PER_CLUMP`: the trunk's own triangle count varies by
    source (`var1`'s single clean stem against `var3`'s eight trunk/twig
    objects), and `DESERT_CROWN[variant][0]` (clump count) varies too, so a
    fixed per-clump range can land the WHOLE-TREE total (`DESERT_CROWN_TRIS`,
    the gated quantity) outside its band even while every individual clump
    stays inside its own -- measured happening on `desert_tree_2` (5 clumps,
    more trunk geometry inherited from `var3`) before this fix. Solving for
    the total first and dividing across the clump count keeps the WHOLE-TREE
    number in-band regardless of which trunk source or clump count a variant
    uses; the individual clump still varies by a small per-clump hashed
    jitter around that solved value, clamped back into
    `DESERT_CROWN_TRIS_PER_CLUMP` so no single clump becomes degenerate."""
    n_clumps, lo_m, hi_m = DESERT_CROWN[variant]
    target_diam_m = (lo_m + hi_m) / 2.0

    trunk_tris = sum(len(ob.data.polygons) for ob in trunk_objs)
    lo_clump, hi_clump = DESERT_CROWN_TRIS_PER_CLUMP
    total_mid = sum(DESERT_CROWN_TRIS) / 2.0
    base_per_clump = max(lo_clump, min(hi_clump, (total_mid - trunk_tris) / n_clumps))

    pts = [p for ob in trunk_objs for p in _world_verts(ob)]
    trunk_bottom_z = min(p.z for p in pts)
    trunk_top_z = max(p.z for p in pts)
    trunk_height_raw = trunk_top_z - trunk_bottom_z
    if trunk_height_raw <= 0.0:
        raise SystemExit(f"[desert_tree_{variant}] trunk has zero raw height "
                          f"-- cannot place a crown")

    mpu = ((DESERT_TREE_TARGET_HEIGHT - DESERT_CROWN_CLUMP_FLATTEN_Z * DESERT_CROWN_CLUMP_RADIUS_M)
           / trunk_height_raw)
    if mpu <= 0.0:
        raise SystemExit(f"[desert_tree_{variant}] closed-form mpu={mpu:.5f} is not "
                          f"positive -- DESERT_CROWN_CLUMP_RADIUS_M is too large for "
                          f"this trunk's raw height")
    clump_radius_raw = DESERT_CROWN_CLUMP_RADIUS_M / mpu
    ring_radius_m = max(0.05, target_diam_m / 2.0 - DESERT_CROWN_CLUMP_RADIUS_M)
    ring_radius_raw = ring_radius_m / mpu

    def _clump_target(salt):
        jitter = 0.85 + 0.3 * _crown_hash01(variant, salt, 999)  # +-15% around base
        return max(lo_clump, min(hi_clump, base_per_clump * jitter))

    def _place(ob, loc):
        """Bakes `loc` into the clump's own mesh data and resets
        object.location to identity. Every other helper in this file
        (`_bake_scale_and_ground` in particular) reads a mesh's GROUND
        position from its LOCAL vertex data, not its object transform, since
        every other family here never moves an object before that point --
        a clump left at a non-zero `.location` would silently corrupt both
        the ground shift and the height/extent calibration once joined."""
        ob.location = loc
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    n_ring = n_clumps - 1
    clumps = [_crown_clump(f"desert_crown_{variant}_top", clump_radius_raw,
                            seed=(variant, 0), target_tris=_clump_target(0))]
    _place(clumps[0], (0.0, 0.0, trunk_top_z))

    for i in range(n_ring):
        frac = 0.72 + _crown_hash01(variant, i, 1) * (0.95 - 0.72)
        z = trunk_bottom_z + frac * trunk_height_raw
        jitter = (_crown_hash01(variant, i, 2) * 2.0 - 1.0) * (math.pi / n_ring)
        angle = (2.0 * math.pi * i / n_ring) + jitter
        x = ring_radius_raw * math.cos(angle)
        y = ring_radius_raw * math.sin(angle)
        ob = _crown_clump(f"desert_crown_{variant}_ring{i}", clump_radius_raw,
                           seed=(variant, i + 1), target_tris=_clump_target(i + 1))
        _place(ob, (x, y, z))
        clumps.append(ob)

    print(f"[desert_tree_{variant}] crown: {len(clumps)} clump(s) (1 top + {n_ring} ring), "
          f"trunk={trunk_tris} tris, per-clump base={base_per_clump:.1f} tris, "
          f"ring radius {ring_radius_m:.3f} m, target footprint {target_diam_m:.2f} m "
          f"({lo_m}-{hi_m} m band)")
    return clumps


def _export_desert_tree_variant(label, src, out_path, variant):
    """Bush's own hue-classified trunk split (see `_export_bush_variant`),
    calibrated to `DESERT_TREE_TARGET_HEIGHT` instead of `BUSH_TARGET_HEIGHT`
    -- but the bush's own foliage is discarded outright (removed, not merely
    unselected -- `_finalize_and_export` exports with `use_selection=False`)
    and replaced by `_build_crown`'s procedural desert crown. See module
    docstring "DESERT CROWN"."""
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

    print(f"[{label}] trunk={len(trunk_objs)} object(s), source foliage="
          f"{len(foliage_objs)} object(s) (discarded -- replaced by a "
          f"procedural crown, N-13/N-14)")
    for ob in foliage_objs:
        bpy.data.objects.remove(ob, do_unlink=True)

    # fix round 1: `_build_crown` used to take a separate `seed` parameter
    # here, always called as `seed=variant` -- a second name for the same
    # value it already receives as `variant`, and never read as anything
    # else inside the function (every hash call used `variant` directly).
    # Removed rather than wired up to something real, since there was
    # nothing for a second seed to distinguish.
    crown_objs = _build_crown(variant, trunk_objs)

    joined = {}
    for role, objs in (("trunk", trunk_objs), ("foliage", crown_objs)):
        bpy.ops.object.select_all(action="DESELECT")
        for ob in objs:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        target_ob = bpy.context.view_layer.objects.active
        _strip(target_ob)
        joined[role] = target_ob

    # Fix round 1: assert DESERT_CROWN_TRIS on the JOINED whole tree -- this
    # is the number the vitest gate actually reads off the shipped GLB
    # (`glbTris`, trunk + foliage together), and `_build_crown`'s own
    # per-clump solve is only an ESTIMATE toward it (it works from the
    # trunk's PRE-join polygon count and a jittered per-clump target, not the
    # final triangulated whole-tree count). A polygon is not always a
    # triangle at this point (`trunk_objs` come straight from the bush
    # source's own quads/ngons, never triangulated by this function), so
    # this counts by `len(vertices) - 2` per polygon -- the same triangle
    # count glTF's own implicit triangulation ships -- rather than trusting
    # `len(polygons)`, which would undercount a mesh with any quad in it.
    def _tris(ob):
        return sum(len(p.vertices) - 2 for p in ob.data.polygons)
    total_tris = _tris(joined["trunk"]) + _tris(joined["foliage"])
    lo_tris, hi_tris = DESERT_CROWN_TRIS
    if not (lo_tris <= total_tris <= hi_tris):
        raise SystemExit(
            f"[{label}] whole tree is {total_tris} tris, outside "
            f"DESERT_CROWN_TRIS={DESERT_CROWN_TRIS} -- adjust `_build_crown`'s "
            f"per-clump solve or DESERT_CROWN's clump count, do not ship this mesh")

    extent = _extent(list(joined.values()), axis="z")
    mpu = metres_per_unit(extent, DESERT_TREE_TARGET_HEIGHT)
    _bake_scale_and_ground(list(joined.values()), mpu, label)

    # MEASURED footprint (post-bake, real metres) -- printed rather than only
    # the pre-build TARGET `_build_crown` already prints, so the export log
    # states what the crown actually came out at, not just what it aimed for.
    # `export_yup=True` swaps Blender's Z-up frame for glTF's Y-up on export
    # (Blender Z, height -> glTF Y; Blender Y -> glTF Z), so the horizontal
    # footprint the vitest gate reads as glTF (X, Z) is Blender (X, Y) here,
    # NOT (X, Z) -- Blender Z at this point is still height.
    foliage_extent = _extent([joined["foliage"]])
    foliage_pts = _world_verts(joined["foliage"])
    fw = max(p.x for p in foliage_pts) - min(p.x for p in foliage_pts)
    fd = max(p.y for p in foliage_pts) - min(p.y for p in foliage_pts)
    print(f"[{label}] MEASURED whole tree: {total_tris} tris (band {lo_tris}-{hi_tris}); "
          f"MEASURED crown footprint: {fw:.3f} x {fd:.3f} m (longest axis {foliage_extent:.3f} m)")

    return _finalize_and_export(joined, out_path, label)


# ---------------------------------------------------------------------------
# tree -- decimate, then a Z-height geometric split into trunk + foliage.
# ---------------------------------------------------------------------------
def _decimate(ob, target_tris, label):
    """Triangulate first so `faces` below is an exact triangle count (D8, R-9
    -- see module docstring "TREE"), then decimate COLLAPSE to `target_tris`.
    `ratio` is read against triangle count because that is what `DECIMATE`'s
    own ratio consumes -- against vertex count the same constant silently
    undershot by 4x+ on these sources.

    A single COLLAPSE pass measurably CANNOT reach `target_tris` on this
    source in one step, and not merely at the full 1.9M-triangle start:
    ratios of 0.005 down to 0.0001 on the raw mesh all converge to the same
    ~14,239, twelve successive 0.5-ratio passes stall at 14,483, AND (this
    is the part that ruled out a single fixed pre-pass) re-running the same
    experiment after a Merge-by-Distance pre-pass finds the SAME shape of
    floor at a SMALLER scale -- a mesh merged down to ~10,271 triangles
    still only reaches 8,850 before a second COLLAPSE pass stalls
    completely. The mesh itself is clean (one connected component, 6
    boundary edges, 7 non-manifold edges out of 2.9M) -- the floor is
    COLLAPSE's own quadric-error metric refusing to keep merging once local
    error plateaus across this mesh's dense, self-similar bark/leaf
    micro-detail, not a topology defect, and it recurs at whatever scale
    Merge-by-Distance leaves behind rather than being crossed by it once.

    So `target_tris` cannot be reached by picking ONE merge threshold and
    trusting COLLAPSE for the rest -- a fixed threshold tuned to land near
    `target_tris` also means COLLAPSE never has real work to do, which
    quietly breaks the interface: raising `target_tris` would change
    nothing, since the merge alone would still be the only thing setting
    the final count. Instead, `TREE_MERGE_DIAG_FRAC_INITIAL` (a threshold
    scaled to the mesh's own bounding-box diagonal, never a fixed absolute
    distance, so it generalises across sources of different scale) is
    escalated geometrically -- `bpy.ops.mesh.remove_doubles`, repeated with a
    LARGER threshold each time it is still needed -- until the mesh is
    merged down to within `TREE_MERGE_OVERSHOOT` of `target_tris`, a size
    COLLAPSE measurably CAN close from (a single pass reliably clears
    ~10-15% at that scale).

    FIX ROUND 1 -- honesty correction. The paragraph above used to end
    "`target_tris` is then the real final word ... changing the constant
    changes the shipped geometry end to end", which is true only when
    `target_tris` is SMALL enough that the escalation loop still has to work
    to get near it. It is measurably false the other way: set `target_tris`
    to 12000 (this file's own falsification, see the module test suite) and
    the escalation loop stops the moment the merge alone drops BELOW 12000 x
    `TREE_MERGE_OVERSHOOT`, at 7,567 tris -- `ratio = min(1.0, target_tris /
    before_t)` then clamps to 1.0 and COLLAPSE does NOTHING, so the merge's
    own settled count ships, not `target_tris`. For a `target_tris` in the
    range this file actually ships at (3000, well below the merge's own
    natural floor for either source), COLLAPSE always has genuine work left
    and the constant genuinely controls the outcome -- but that is a property
    of the CHOSEN value, not a guarantee the mechanism gives for free. Rather
    than leave that mismatch silent, this function now raises loudly instead
    of shipping a mesh that quietly missed the request: see the three
    `SystemExit` checks below."""
    pts = _world_verts(ob)
    dx = max(p.x for p in pts) - min(p.x for p in pts)
    dy = max(p.y for p in pts) - min(p.y for p in pts)
    dz = max(p.z for p in pts) - min(p.z for p in pts)
    diag = math.sqrt(dx * dx + dy * dy + dz * dz)

    frac = TREE_MERGE_DIAG_FRAC_INITIAL
    merge_iters = 0
    merged_t = len(ob.data.polygons)
    for merge_iters in range(1, TREE_MERGE_MAX_ITERS + 1):
        merge_threshold = frac * diag
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.remove_doubles(threshold=merge_threshold)
        bpy.ops.object.mode_set(mode="OBJECT")
        merged_t = len(ob.data.polygons)
        if merged_t <= target_tris * TREE_MERGE_OVERSHOOT:
            break
        frac *= TREE_MERGE_GROWTH
    else:
        # The `for` completed every iteration without ever `break`ing --
        # exhausted, not merely slow. Shipping whatever `merged_t` happened
        # to be at that point would be exactly the silent off-target mesh
        # this whole escalation exists to avoid.
        raise SystemExit(
            f"[{label}] merge escalation exhausted after {TREE_MERGE_MAX_ITERS} "
            f"iteration(s) (final frac={frac:.5f}) without reaching "
            f"{target_tris * TREE_MERGE_OVERSHOOT:.0f} tris (target_tris="
            f"{target_tris} x TREE_MERGE_OVERSHOOT={TREE_MERGE_OVERSHOOT}) -- "
            f"still at {merged_t}; raise TREE_MERGE_MAX_ITERS or TREE_MERGE_GROWTH, "
            f"do not ship this mesh silently off target")
    merged_v = len(ob.data.vertices)

    tri_mod = ob.modifiers.new("decor_triangulate", type="TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier=tri_mod.name)
    before_v = len(ob.data.vertices)
    before_t = len(ob.data.polygons)  # every face is now a triangle
    ratio = min(1.0, target_tris / before_t)
    if ratio < 1.0:
        mod = ob.modifiers.new("decor_decimate", type="DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=mod.name)

    # DECIMATE COLLAPSE leaves FACE-LESS vertices behind on this source --
    # measured 12/233 on one variant's trunk, 11/704 on its foliage, several
    # of them still edge-connected to each other (so `bpy.ops.mesh.
    # select_loose()`'s default "no edges at all" definition misses them --
    # confirmed empirically, it left the exported height unchanged the first
    # time this fix was attempted). `mesh.vertices` still counts every one
    # of them, so every Python-side extent check in this file (and the `mpu`
    # it calibrates) sees a slightly LARGER range than what actually ships:
    # glTF stores per-LOOP data, so the exporter silently drops any vertex no
    # FACE references, and the measured height came out 3.395 against a
    # declared 3.400 before this cleanup ran -- not float rounding, a real
    # ~0.15% shrink from vertices that were never going to be exported.
    # bmesh, not the operator, so "has zero linked faces" is the exact
    # predicate applied -- matching glTF's own criterion for what ships.
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    faceless = [v for v in bm.verts if len(v.link_faces) == 0]
    bmesh.ops.delete(bm, geom=faceless, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()

    after_v = len(ob.data.vertices)
    after_t = len(ob.data.polygons)

    # No silent off-target mesh (fix round 1). `after_t > target_tris` means
    # a mesh shipped ABOVE the number this whole function exists to enforce
    # -- COLLAPSE should never leave more than requested, and if it does,
    # something about this source changed and needs a fresh look, not a
    # quiet ship. `after_t < target_tris * TREE_UNDERSHOOT_FLOOR` is the
    # mirror case the module docstring's "honesty correction" describes: a
    # `target_tris` set larger than what the merge escalation naturally
    # settles at (the 12000 -> 7,567 case) ships something far below what was
    # asked for with `ratio` clamped to a no-op decimate -- this makes THAT
    # silent mismatch loud instead.
    if after_t > target_tris:
        raise SystemExit(
            f"[{label}] shipped {after_t} tris, ABOVE target_tris={target_tris} -- "
            f"COLLAPSE should never leave more than requested; do not ship this mesh")
    if after_t < target_tris * TREE_UNDERSHOOT_FLOOR:
        raise SystemExit(
            f"[{label}] shipped {after_t} tris, below the {TREE_UNDERSHOOT_FLOOR:.0%} "
            f"floor of target_tris={target_tris} ({target_tris * TREE_UNDERSHOOT_FLOOR:.0f}) "
            f"-- target_tris is likely set larger than what the merge escalation alone "
            f"settles at on this source (see this function's own docstring, 'honesty "
            f"correction'); lower target_tris or redesign the escalation, do not ship "
            f"this mesh silently off target")

    print(f"[{label}] merge-by-distance: {merge_iters} escalation(s), final threshold="
          f"{merge_threshold:.5f} (diag={diag:.4f}) -> {merged_v} verts, {merged_t} tris; "
          f"decimate ratio={ratio:.5f}: {before_v} -> {after_v} verts, "
          f"{before_t} -> {after_t} tris (loose verts removed)")


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


def _tri_count(ob):
    """Triangle count by `len(vertices) - 2` per polygon -- correct for a
    mesh that may still carry quads/ngons (both `trunk_ob` and `foliage_ob`
    are, straight off `mesh.separate`, before either is triangulated),
    unlike trusting `len(polygons)` directly."""
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def _export_tree_variant(label, src, out_path):
    """Fix round 2 (lead decision 2026-09-27, "split trunk and leaves"):
    split trunk from foliage FIRST, on the untouched source geometry, THEN
    decimate each part separately. Fix round 1's design decimated the WHOLE
    mesh (a single shared merge-by-distance pass) and split by height
    afterward -- which let that shared merge relocate vertices near
    TREE_TRUNK_Z across the threshold (the trunk/foliage colour boundary
    measurably moved: a limb that read trunk-brown before the merge read
    foliage-green after it, see `.superpowers/ground2/trees-preview/
    compare-full.png`), and skewed the trunk's share of the combined
    point cloud enough to fail the whole-tree p1-p99 depth check by 15.7%
    (task-6-report.md, fix round 1, item 1). Both defects are now
    structurally impossible: classification runs on ORIGINAL coordinates,
    and decimating an object already on one side of the split can never
    move a vertex to the other object.

    The trunk gets its OWN target, proportionate to its share of the RAW
    (pre-decimation) triangle count -- not a fixed number (today's two
    sources would need different ones) and not a fixed fraction of
    `TREE_TARGET_TRIS` (that would bake in today's sources' own ~11-13% raw
    share as if it meant something universal for a still-undiscovered third
    source). Measured (task-6-report.md, fix round 2): plain DECIMATE
    COLLAPSE, even on the trunk ALONE, hits its own version of the same
    quadric-plateau floor `_decimate`'s own docstring describes for the
    whole tree -- so the trunk gets the SAME merge-then-decimate treatment,
    just with a much smaller target, which is what makes it "a much lighter
    pass" rather than a different mechanism."""
    bpy.ops.wm.open_mainfile(filepath=src)
    meshes = _meshes()
    if len(meshes) != 1 or meshes[0].name != "mesh_node":
        raise SystemExit(f"[{label}] expected exactly one 'mesh_node' object, "
                          f"found {[o.name for o in meshes]}")
    ob = meshes[0]
    if len(ob.data.materials) != 1:
        raise SystemExit(f"[{label}] expected exactly one material to strip, "
                          f"found {len(ob.data.materials)}")

    trunk_ob, foliage_ob = _split_tree_by_height(ob, label)
    _strip(trunk_ob)
    _strip(foliage_ob)

    trunk_raw_tris = _tri_count(trunk_ob)
    foliage_raw_tris = _tri_count(foliage_ob)
    raw_total = trunk_raw_tris + foliage_raw_tris
    if raw_total <= 0:
        raise SystemExit(f"[{label}] trunk+foliage raw triangle count is {raw_total} "
                          f"-- cannot proportion a decimation budget")
    trunk_share = trunk_raw_tris / raw_total
    trunk_target = round(TREE_TARGET_TRIS * trunk_share)
    trunk_target = max(TREE_TRUNK_TARGET_MIN, min(TREE_TRUNK_TARGET_MAX, trunk_target))
    print(f"[{label}] raw trunk={trunk_raw_tris} foliage={foliage_raw_tris} tris "
          f"(trunk share {trunk_share:.1%}) -> trunk_target={trunk_target}")

    _decimate(trunk_ob, trunk_target, f"{label}_trunk")
    trunk_final_tris = _tri_count(trunk_ob)
    foliage_target = TREE_TARGET_TRIS - trunk_final_tris
    if foliage_target < TREE_TRUNK_TARGET_MIN:
        raise SystemExit(f"[{label}] trunk alone is {trunk_final_tris} tris, leaving only "
                          f"{foliage_target} for foliage out of TREE_TARGET_TRIS="
                          f"{TREE_TARGET_TRIS} -- raise TREE_TARGET_TRIS or lower "
                          f"TREE_TRUNK_TARGET_MAX")
    _decimate(foliage_ob, foliage_target, f"{label}_foliage")

    # The whole-tree total, once more at the top level -- `_decimate`'s own
    # guards already enforce this per PART, but this is the number the
    # vitest gate (and D8's own target) reads off the shipped GLB.
    total_tris = _tri_count(trunk_ob) + _tri_count(foliage_ob)
    if total_tris > TREE_TARGET_TRIS:
        raise SystemExit(f"[{label}] whole tree is {total_tris} tris, ABOVE "
                          f"TREE_TARGET_TRIS={TREE_TARGET_TRIS} -- do not ship this mesh")
    if total_tris < TREE_TARGET_TRIS * TREE_UNDERSHOOT_FLOOR:
        raise SystemExit(f"[{label}] whole tree is {total_tris} tris, below the "
                          f"{TREE_UNDERSHOOT_FLOOR:.0%} floor of TREE_TARGET_TRIS="
                          f"{TREE_TARGET_TRIS} -- do not ship this mesh")
    print(f"[{label}] whole tree: {total_tris} tris (trunk={trunk_final_tris}, "
          f"foliage={_tri_count(foliage_ob)}), target={TREE_TARGET_TRIS}")

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
        ("boulder", BOULDER_SRC, "rock"),
    ):
        if ONLY_FAMILIES is not None and family not in ONLY_FAMILIES:
            continue
        target, axis = FAMILY_TARGET[family]
        for variant, src in enumerate(srcs):
            label = f"{family}_{variant}"
            out_path = os.path.join(OUT_DIR, f"{label}.glb")
            result = _export_single_role(label, src, role, target, axis, out_path)
            summary[label] = {"path": out_path, "bytes": result[0], "verts": result[1],
                               "polys": result[2], "roles": result[3]}

    if ONLY_FAMILIES is None or "bush" in ONLY_FAMILIES:
        for variant, src in enumerate(BUSH_SRC):
            label = f"bush_{variant}"
            out_path = os.path.join(OUT_DIR, f"{label}.glb")
            result = _export_bush_variant(label, src, out_path)
            summary[label] = {"path": out_path, "bytes": result[0], "verts": result[1],
                               "polys": result[2], "roles": result[3]}

    if ONLY_FAMILIES is None or "tree" in ONLY_FAMILIES:
        for variant, src in enumerate(TREE_SRC):
            label = f"tree_{variant}"
            out_path = os.path.join(OUT_DIR, f"{label}.glb")
            result = _export_tree_variant(label, src, out_path)
            summary[label] = {"path": out_path, "bytes": result[0], "verts": result[1],
                               "polys": result[2], "roles": result[3]}

    if ONLY_FAMILIES is None or "desert_tree" in ONLY_FAMILIES:
        for variant, src in enumerate(DESERT_TREE_SRC):
            label = f"desert_tree_{variant}"
            out_path = os.path.join(OUT_DIR, f"{label}.glb")
            result = _export_desert_tree_variant(label, src, out_path, variant)
            summary[label] = {"path": out_path, "bytes": result[0], "verts": result[1],
                               "polys": result[2], "roles": result[3]}

    print("SUMMARY_JSON " + json.dumps(summary))


if __name__ == "__main__":
    export()
