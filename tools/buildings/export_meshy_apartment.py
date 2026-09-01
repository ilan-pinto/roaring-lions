"""Export the supplied Meshy four-storey Levantine block as the `apartment`
building pair, mesh contract v2's BUILDINGS section.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/export_meshy_apartment.py

Writes `art/meshes/buildings/apartment.glb` (standing) and
`art/meshes/buildings/apartment_wreck.glb` (destroyed), REPLACING the
kit-built pair `tools/buildings/author_apartment.py`/`export_mesh_building.py`
currently ship. Not a new type: `data/structures.json` already carries
`apartment` (`limestone.4` wall colour, resolved at runtime, not by this
script), `packages/app/src/main.ts`'s `MESH_BUILDINGS` already lists it, and
`building-mesh-role.ts` already knows every role emitted below. The one
wiring change this file needs is `render_building.py`'s `APARTMENT.mesh_owner`
flipping off `MESH_KIT_OWNED` and naming this script, so
`export_mesh_building.py` stops regenerating over it -- the same flip
`2b72047` had to make for the house.

SOURCES (both AI-generated, Meshy, image-to-3D-texture mode -- disclosed per
CONTRIBUTING.md):

    art/blend/enemy/enemy building 2 /Meshy_AI_levantine_house_4stor_0830170357_image-to-3d-texture.blend
    art/blend/enemy/enemy building 2 /Meshy_AI_levantine_house_4stor_0830172141_image-to-3d-texture.blend

Each is a single mesh object `mesh_node`, one material, baked 4096/2048
textures (discarded -- zero materials ship, per contract). Neither FILENAME
says which is which: unlike "enemy building 1", both slugs read `4stor` and
the only difference is the timestamp. Which is which was settled by
inspection, not by filename order -- see WHICH IS WHICH below.

WHY THIS IS ITS OWN SCRIPT rather than a new `BuildingMeshSpec` entry in
`export_mesh_building.py`: identical to `export_meshy_house.py`'s own reason.
That module's `_join_by_role` groups by an `rl_role` a KIT AUTHOR set per
object; this source is ONE welded mesh with no per-part name to key on, so
the role split has to be geometric.

WHICH IS WHICH, and the connectivity census. Both files are ONE connected
component at every weld threshold tried, so the house's cleanest move --
isolating the satellite dish as its own component and tagging it `metal`
wholesale -- is NOT available here. Measured, decimated (ratio 0.01):

  A = ..._0830170357_...  994,972 v / 1,990,302 t raw, bbox 1.2085 x 1.2007 x 1.9027
      z-decile occupancy 10.4 9.6 11.2 10.7 9.5 11.7 9.5 8.9 12.1 6.4 %
      13.7% upward faces -- INTACT.
  B = ..._0830172141_...  955,094 v / 1,913,730 t raw, bbox 1.7371 x 1.7061 x 1.9050
      z-decile occupancy 24.4 2.8 4.0 3.4 6.6 4.1 12.0 10.7 30.1 1.9 %
      29.9% upward faces -- DESTROYED.

A's cross-section is constant at every height (a flat histogram); B's is
bimodal, with a quarter of its vertices in the bottom decile spread across
the full 1.737 width -- a ground debris apron, which is also why B's
FOOTPRINT is 44% wider than A's while its HEIGHT is the same to 0.1%. They
are the same building: same water tank (knocked flat in B), same satellite
dish, same external stair, same 2x4 window grid, same rebar stubs, same
four string-courses; B's roof and top-floor corner have collapsed.

THE WRECK IS ROTATED 180 DEGREES ABOUT Z RELATIVE TO THE INTACT MODEL, and
this script bakes the correction. Established by RENDER, not by reasoning:
five axis-aligned textured orthographic stills per file (Workbench TEXTURE,
the same instrument `export_meshy_house.py` used) show the sole ground-floor
door on A's +X facade and on B's -X facade, and the external stair on A's +Y
side and B's -Y side. Two independent features, both flipped. Exported
as-is, the building would spin 180 degrees at the moment it dies.

Two things that do NOT establish this and were tried first, recorded so
nobody re-runs them expecting an answer:

  * OCCUPANCY OVERLAP between the two meshes, with a translation search,
    scores 0 degrees and 180 degrees within 9% of each other (429 vs 392
    cells) and cannot separate them. The block is very nearly two-fold
    symmetric -- a rectangular shell with the same window band on all four
    facades -- so no bulk-geometry metric can tell the front from the back.
    90/270 ARE cleanly rejected (218/230), so the search is working; it is
    the question that is under-determined, not the method.
  * The `export_meshy_house.py`-style OUTER-SLAB vertex census reads A's
    +X and -X slabs at 12.3% each and both Y slabs under 4.1%, because this
    block's X wall planes sit exactly at its bounding box and its Y wall
    planes sit inboard of balconies that reach it. It measures where the
    bounding box is, not where the stair is.

ORIENTATION OF THE INTACT MODEL: its door facade is ALREADY +X, so this is
the first supplied Meshy asset needing NO rotation bake at all. HARD-WON
FACT 1 ("a still cannot answer forward") is about assets whose forward is
defined by MOTION -- the jeep, the soldier. A building has no travel
direction and its front is definitionally its door facade, which an
axis-aligned textured still does answer, and which is the same instrument
and the same reasoning `export_meshy_house.py` recorded for its own -Y
front.

THE BUILD GATE that keeps this true is `_assert_stair_corner`, in the
CLIP_SEMANTICS spirit: after every transform is baked, the vertex mass in
the (-X,+Y) stair corner must outweigh the opposite (+X,-Y) corner. Measured
on the raw decimated sources: A 4,221 vs 1,070 (ratio 3.94), B after the 180
bake 1,751 vs 354 (ratio 4.95), and B WITHOUT the bake 354 vs 1,751 (ratio
0.20). On the shipped, role-split, baked geometry it reads 4.10 (standing)
and 3.29 (wreck). The opposite corner is the control, and a dropped rotation
fails the gate by an order of magnitude rather than shipping silently.

DO NOT TRY TO CONFIRM THE STAIR'S CORNER BY EYE FROM A DIMETRIC RENDER. It
was tried, and it read the stair onto the -Y facade -- the wrong one -- twice,
because at azimuth 225 the stair sits within a few pixels of the silhouette's
own vertical corner line and there is nothing in the image to say which of the
two visible faces it belongs to. What settles it is rendering the `metal` role
ALONE with a labelled cube on each of +X/-X/+Y/-Y, which puts the stair
unmistakably against the +Y and -X markers and agrees with the numeric gate.

WHICH FACADE THE PLAYER ACTUALLY SEES -- settled by measurement, because
leaving it open is what makes a "consistent" orientation worth nothing. Three
facts compose:

  * `packages/render/src/three/camera.ts`'s `VIEW_DIRECTION` (target ->
    camera) is positive in BOTH ground components, and `ThreeRenderer` places
    a building at `(cx, worldY, cy)` -- three X is sim x, three Z is sim y. So
    the camera is fixed on the (+x,+y) side and the facades it sees are +x
    and +y. There is no camera rotation in this game.
  * `export_yup=True` maps Blender +X -> three +X and Blender +Y -> three -Z.
    Verified against this script's own output rather than assumed: the
    exported `metal` mesh (stair plus rooftop clutter, and the only strongly
    asymmetric role) has glTF Z spanning -7.062..+5.845, skewed to -Z, which
    is the Blender +Y corner the gate above puts the stair in.
  * The door is on Blender +X.

So the door facade lands on sim +x and IS the facade the player sees, and no
rotation is what puts it there. The stair lands on sim -y and is hidden. A
-90-degree bake would show both (door -> sim +y, stair -> sim +x) and is the
only strictly better option; it is NOT taken, because it would move this
building's front off the +X that `export_meshy_house.py` deliberately baked
its own house onto, and a set-wide change to where a building's front points
is not this asset's call to make alone.

REGISTRATION -- the step the house pipeline did not need and this one does.
After the 180 bake the wreck's core still sits about 0.09 source units off
the intact's in X (about 1.1 m at the scale below, a third of a tile), so it
would slide sideways on death.

The correction is MEASURED on each run's own geometry, not transcribed. It
was hard-coded first, at the +0.078 a probe pass read off the sources
decimated to 0.02 -- and the export, which decimates to 0.01, then landed
0.013 source units off. The same measurement on differently-decimated
geometry is a different number, and a constant cannot follow DECIMATE_RATIO
when someone changes it. `_measure_registration_dx` therefore reads the
wreck's own wall planes against the intact's, between the rotation bake and
the shift, and applies what it finds. `WRECK_DX_EXPECTED` is only a sanity
rail around the result.

The method is wall planes by DENSITY MODE per axis -- threshold-free, so a
debris apron adds mass without moving the peak -- over five z-fraction bands,
median of the survivors. Bands whose wreck X span falls under BAND_SPAN_MIN
of the intact's are rejected, which is how the one bad band is caught by
measurement rather than by being named here: 0.30-0.70's upper mode lands on
the collapsed corner and reads a span of 8.35 m against the intact's 14.48,
and it alone would have contributed dx +0.309 against the other four bands'
+0.081..+0.095. Observed on the shipped export: four bands kept, median
dx +0.0930 source units, spread 0.0138, residual after the shift +0.0017
source units (0.021 m, a fortieth of a tile).

Two other things were tried and are recorded so they are not re-run: raw
bbox and plain percentiles both LIE here, because the wreck's bbox is a
debris apron 44% wider than the standing block; and a 3-D occupancy overlap
with a translation search agrees on X (+0.080) but is a much heavier way to
get the same number.

X is applied. Y is NOT: the mode method disagrees with itself across bands
(-0.075, -0.175, -0.015, +0.015, -0.050) because the wreck's Y span is 18%
wider than the intact's from debris packed against the walls, and the
occupancy search -- the one method here that uses full 3-D geometry and no
threshold -- says dy is zero. An unreliable correction is worse than none.

WHAT THE APRON COSTS, since the registration deliberately does not chase it.
The wreck's own extent is 21.20 x 20.73 m against the standing block's
14.75 x 14.66, and the apartment footprint in `data/maps/` is 5x4 tiles
(beit_sahwan_outskirts rows 16-19) or 6x3 (rows 36-38), i.e. 15 x 12 m. So
the wreck's debris reaches about 1.4 tiles past the footprint on +x, 0.6 on
-x, and 1.4 on both y sides. That is rubble in the street, which is correct
for a collapsed block and is what the kit wrecks do in miniature
(`apartment_wreck.glb` is 12.65 m deep against the standing 12.50). It is
recorded rather than corrected because the alternative -- scaling the wreck
by its own extent so the apron fits -- would shrink its standing walls
relative to the standing building, and the building would visibly contract
at the moment it dies.

SCALE. `REAL_METRES_APARTMENT` was DERIVED by measuring the pre-replacement,
kit-built `apartment.glb` (`_measure_existing_extent`, kept for provenance
and not called by `export()`) rather than hand-typed, then FROZEN -- see the
constant's own comment for the self-reference that avoids.

The house's docstring says "the intact source's own longest axis-aligned
extent" and its code takes `max()` over all three axes. COPYING THAT
LITERALLY HERE IS WRONG and fails silently: this source's longest axis is Z
(1.903), not X, so `max()` would yield mpu 7.755 and a 9.4 m-wide building
standing on a 15 m footprint -- a 37% under-fill that reads as a broken
feature rather than a mis-set constant. The house's PROSE intent is
width-to-width (its own comment: "this IS the footprint width, not an
arbitrary axis"), and its code and prose only agreed because that asset's
longest axis happened to be its width. This script divides by the source
extent along the axis that becomes world X, explicitly.

  width-match  14.7600 / 1.2085 = 12.2135 m/unit -> 14.760 x 14.664 x 23.235
  depth-match  12.5000 / 1.2007 = 10.4106        -> 12.582 x 12.500 x 19.808
  area-match   sqrt of the two   = 11.2740       -> 13.628 x 13.538 x 21.452

Width-match is taken. It reproduces the shipped `apartment.glb`'s own X
extent to the digit, so the footprint this type covers in X does not change
at all; and 5 tiles x `dimetric.UNITS_PER_TILE` (3 m) = 15.0 m, which the
declared `footprint_tiles=5` independently corroborates to within 1.6%. The
SAME mpu is applied to BOTH files -- the wreck's own extent is a collapsed,
not a ground-truth, measurement, and recalibrating from it would let the two
states drift out of scale with each other.

DECIMATION. Measured rather than inherited. Each ratio was rendered at the
locked dimetric angle (azimuth 225, elevation 30 -- `tools/dimetric.py`, and
the only angle this game ever draws a building from) and its silhouette
compared against the undecimated render's:

  ratio    intact verts/tris   IoU      wreck verts/tris   IoU
  1.0      994,972 / 1,990,302 --       955,094 / 1,913,730 --
  0.02      19,724 /    39,806 0.9993    17,365 /    38,273 0.9973
  0.01       9,772 /    19,902 0.9992     7,797 /    19,137 0.9939
  0.005      4,796 /     9,950 0.9978     3,693 /    10,929 0.9270
  0.0025     2,308 /     4,974 0.9946     3,693 /    10,929 0.9270

0.01 is taken: it is half the house pair's own shipped density and the
silhouette is still within 0.7% of the source on both files. 0.005 is where
the WRECK falls off a cliff -- its debris apron is thousands of small
independent chunks rather than one shell, so collapse decimation deletes
them outright rather than simplifying them, and 7% of the silhouette goes
with them. (The wreck also floors at 3,693 verts: 0.0025 returns the same
mesh as 0.005.) Every threshold in the role split below is measured on the
ALREADY-DECIMATED mesh, the Namer/house rule, for the same reason.

CUSTOM SPLIT NORMALS -- decided explicitly, and the decision is to KEEP
them. Both sources are ~100% smooth-shaded WITH custom split normals, which
is how a smooth-shaded bake keeps its wall creases: the split normals ARE
the hard edges. Clearing them and shading flat was tried first, on the
argument that a runtime ramp indexed BY NORMAL (`palette-material.ts`)
wants one flat tone per facet. It was MEASURED and reverted: flat shading
makes every vertex unshared, so 19,899 triangles exported 59,659 vertices
(exactly 3 per triangle) and the standing GLB came to 2.03 MB. Keeping the
split normals splits a vertex only at a real crease -- the same trade the
shipped `house.glb` already makes at 0.84 verts per triangle -- and that is
the `export_meshy_jeep.py` "flat-shaded, unshared-vertex explosion" trap,
re-created here from the other direction. There is no vertex-colour layer,
so nothing else of `_strip_split_normals_and_colour`'s job applies.

UVs ARE DROPPED (`export_texcoords=False`). Zero materials ship, so
TEXCOORD_0 is 8 bytes per vertex that nothing can ever read. The shipped
`house.glb` carries it -- 32,925 vertices' worth, about a quarter of that
file -- which is dead weight rather than a convention worth matching.

ROLE SPLIT -- geometric, from `tools/buildings/kit.py`'s ROLES, and honestly
fewer than the kit's six. Every threshold below was read off this asset's
own upward-component census at ratio 0.01, not carried over from the house.

  INTACT (source frame; the intact model is never rotated, so source frame
  IS world frame here):

  - `roof`: the LARGEST connected component among upward-facing
    (normal.z > NZ_THRESH) faces -- the flat roof deck. Unambiguous: 511
    faces at z 0.635..0.654 spanning 1.168 x 0.900, against 72 for its
    nearest rival, a 7x clear winner.
  - `trim`: the parapet coping. Every other upward component whose centroid
    sits in the narrow band just ABOVE the deck (PARAPET_Z_MIN..MAX, i.e.
    0.655..0.675 -- the cap is a distinct z level, 0.659..0.669, not a
    continuum with the 0.635..0.654 deck), that spans at least TRIM_SPAN,
    and whose own bbox TOUCHES the footprint perimeter. Five such strips are
    found, one or two per facade. The perimeter test is what keeps the
    stair-head roof (a 0.300 x 0.361 patch at the same height but inboard,
    centred -0.271,+0.297) out of `trim`.
    NOTE what `trim` is NOT here. This block has FOUR string-courses banding
    all four facades -- visually its strongest horizontal feature, and the
    obvious `trim` candidate, matching `kit.py`'s own `trim_band()`. They do
    not survive decimation as upward components: at 0.01 nothing at mid
    height has a span over 0.3, and the fragments that remain are 1-3 faces
    each, indistinguishable from noise. Shipping them would mean inventing a
    boundary the geometry does not carry, so the coping takes the role
    instead -- which is also what `render_building.py`'s own WALL spec calls
    `trim`-flagged.
  - `metal`: rooftop clutter and the external stair. Two seed sources, both
    position-filtered upward components, grown by a small bounded BFS over a
    vertex KDTree (`GROW_RADIUS`, `GROW_ROUNDS`) so a tank's cylindrical
    wall and a tread's riser come along with their flat tops:
      (a) anything ABOVE the parapet cap (cz > FIXTURE_Z) -- the two water
          drums (clusters at z 0.716/0.782/0.875), the satellite dish, the
          rebar stubs.
      (b) anything in the STAIR CORNER (cx < STAIR_X_MAX and cy >
          STAIR_Y_MIN) -- the external stair's landings and treads, which
          appear as a regular stack of 15-40-face components at the same
          (x,y) at every storey height, from z -0.93 to +0.52.
    A tight seed anywhere else -- window sills, and the balcony ledges at
    y ~ -0.55 and y ~ +0.52 with x ~ 0 -- reverts to `wall`. That is the
    same window-sill-versus-fixture confusion the house hit, and the same
    resolution: a fixture here is either above the roof or on the stair, and
    nothing else is claimed.
  - `wall`: everything else -- base masonry, every window and door opening,
    the string-courses, the balconies. Coloured from this building's own
    `wallColorKey` at runtime (`data/structures.json` `apartment.color` =
    `limestone.4`), unchanged by this script.

  DESTROYED:

  - `roof`: the UNION of every upward-facing component at or above a small
    noise floor (`WRECK_SIZE_FLOOR` faces). Post-collapse there is no single
    dominant plane -- but there are FIVE, one per pancaked floor slab, at
    z +0.712, +0.289, -0.136, -0.529 and -0.920, each spanning about
    1.07 x 0.90, plus a ring of ground-level debris patches. Tagging every
    non-trivial upward patch as one `roof` is the honest read, exactly as
    the house wreck ships.
  - `wall`: everything else. No `trim`, no `metal`: neither the coping nor
    the tank/dish/stair survives collapse as a separable geometric signal.

  NEITHER pass ships `glass`, `wood`, `dome` or `rust`, all four of which
  the kit-built apartment currently does. Nothing in this source separates
  a shutter from its opening at this resolution, and inventing the boundary
  would be worse than losing the role.

GROUND ALIGNMENT. Each file is shifted up by its OWN lowest vertex, after
scale + rotation + registration, so each file's own world origin lands at
z=0 -- the contract's "the model's own world origin at z ~ 0" anchor, on the
standing and the collapsed geometry separately. The two grades already agree
to 0.001 source units before the shift (-0.9523 against -0.9538), and
`_assert_grades_agree` fails if a future re-run ever finds otherwise, since
a divergence there means the debris apron has dipped below the intact
model's grade. No X/Y shift beyond the registration correction above: the
source's own origin is trusted as the anchor rather than recomputed from a
bounding box, deliberately -- an overhang or an asymmetric collapse should
be able to drag the bbox off the anchor without the anchor chasing it, and
on this asset it does exactly that (the wreck's debris apron is 44% wider
than the standing block, so its bbox centre and its anchor genuinely differ).
"""
import json
import math
import os
import sys
from collections import defaultdict

import bpy
import bmesh
from mathutils import kdtree

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import kit as building_kit  # noqa: E402 -- tools/buildings/kit.py, ROLES

REPO = os.path.dirname(TOOLS)
# `art/blend/` is gitignored (blanket rule, too large for git) and therefore
# does not exist inside a worktree checkout at all -- these sources live only
# in the main repo's own local, untracked working directory, the exact
# absolute path this task was given. NOT derived from REPO for that reason.
# The trailing space in the directory name is in the source tree, not a typo.
SRC_DIR = "/Users/ilpinto/dev/roaring-lions/art/blend/enemy/enemy building 2 "
SRC_INTACT = os.path.join(SRC_DIR, "Meshy_AI_levantine_house_4stor_0830170357_image-to-3d-texture.blend")
SRC_WRECK = os.path.join(SRC_DIR, "Meshy_AI_levantine_house_4stor_0830172141_image-to-3d-texture.blend")

#: The file THIS script replaces. Measured ONCE
#: (`_measure_existing_extent`, run against the pre-replacement kit-built
#: apartment.glb: 14.7600 x 12.5000 x 13.1960, 3,102 verts, six roles)
#: rather than hand-typed -- but frozen here as a constant rather than
#: re-measured on every run, because this script OVERWRITES that same path:
#: a second run after the first successful replacement would measure ITS OWN
#: prior output instead of the kit-built ground truth, drifting the scale a
#: little further on every re-run. 14.7600 is the number every run of this
#: script has measured against and should keep measuring against. Independent
#: corroboration: `render_building.py`'s APARTMENT declares
#: `footprint_tiles=5` and `dimetric.UNITS_PER_TILE` is 3.0, so the declared
#: footprint is 15.0 m -- 1.6% from the measured extent.
REAL_METRES_APARTMENT = 14.7600

#: Output directory -- overridable via `-- --out-dir <path>` so a
#: verification pass can write to a scratch location without touching the
#: shipped pair until it is confirmed drawing in the browser.
_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--out-dir" in _argv:
    OUT_DIR = _argv[_argv.index("--out-dir") + 1]
else:
    OUT_DIR = os.path.join(REPO, "art", "meshes", "buildings")
OUT_IDLE = os.path.join(OUT_DIR, "apartment.glb")
OUT_WRECK = os.path.join(OUT_DIR, "apartment_wreck.glb")

#: Decimate ratio, both sources. Measured against the undecimated silhouette
#: at the locked dimetric angle -- see module docstring "DECIMATION" for the
#: full table and for why 0.005 is not taken.
DECIMATE_RATIO = 0.01

#: Upward-facing threshold (normal.z), seeding every role split below.
NZ_THRESH = 0.7

#: The parapet coping's own z band, source frame -- distinct from the roof
#: deck's 0.635..0.654, not a continuum with it. See docstring "trim".
PARAPET_Z_MIN = 0.655
PARAPET_Z_MAX = 0.675

#: A parapet strip must span at least this much along one axis, and its own
#: bbox must reach PERIMETER, or it is an inboard rooftop patch rather than
#: coping. See docstring "trim".
TRIM_SPAN = 0.20
PERIMETER = 0.50

#: Above the coping is rooftop clutter: tank, dish, rebar. See "metal" (a).
FIXTURE_Z = 0.675

#: The external stair's own corner, source frame. Every stair component
#: measured on this asset sits at cx about -0.47 and cy about +0.51; the
#: bounds are loose enough to take the treads that step inboard (down to
#: cx -0.17) and tight enough to leave the +Y facade's own mid-wall ledges
#: (cx about 0.0) as `wall`. See "metal" (b).
STAIR_X_MAX = -0.15
STAIR_Y_MIN = 0.42

#: Local growth for a `metal` seed -- source frame, same shape and the same
#: order of magnitude as export_meshy_house.py's own pass.
GROW_RADIUS = 0.020
GROW_ROUNDS = 2

#: Destroyed-pass `roof` union floor, in faces. Half the house's own 15,
#: because this pass decimates twice as hard (0.01 against 0.02) and a
#: component is correspondingly half the size. Filters 1-3 face noise and
#: keeps every real debris facet.
WRECK_SIZE_FLOOR = 8

#: Baked onto the WRECK only. See docstring "THE WRECK IS ROTATED 180
#: DEGREES"; `_assert_stair_corner` is what keeps it honest.
WRECK_ROT_Z = math.pi

#: The wreck's X registration correction is MEASURED on this run's own
#: decimated geometry (`_measure_registration_dx`), not transcribed. It was
#: hard-coded at 0.078 first, from a probe run at decimate 0.02, and the
#: export at 0.01 then landed 0.013 source units off -- the same number
#: measured on differently-decimated geometry is a different number, and a
#: constant cannot follow `DECIMATE_RATIO` when someone changes it. These
#: are the z-fraction bands it measures over; the median of the survivors is
#: applied.
REGISTRATION_BANDS = ((0.15, 0.45), (0.25, 0.55), (0.30, 0.70), (0.40, 0.80), (0.25, 0.75))

#: A band whose wreck X wall-plane span falls under this fraction of the
#: intact's own span for the same band is not measuring walls -- its upper
#: mode has landed on the collapsed corner. Measured: the 0.30-0.70 band
#: reads 0.68 against the intact's 1.17 (0.58) while every other band reads
#: above 0.95.
BAND_SPAN_MIN = 0.75

#: Y is deliberately NOT corrected -- see the docstring for why the Y figure
#: is not trusted.
WRECK_DY = 0.0

#: What this asset has always measured, in source units, and the band the
#: measured value must stay inside. Not the applied value: it is the sanity
#: rail around it, wide enough for decimation jitter (0.013 observed between
#: ratios 0.02 and 0.01) and far tighter than a dropped 180-degree bake,
#: which would read about 1.2.
WRECK_DX_EXPECTED = 0.093
REGISTRATION_TOL = 0.030

#: The surviving bands must agree with each other to this, in source units,
#: or the measurement is not trustworthy enough to apply.
REGISTRATION_SPREAD_MAX = 0.040

#: `_assert_stair_corner`'s own corner, as fractions of the INTACT model's
#: final half-extent (the intact's, for BOTH files, so the gate looks at the
#: same physical corner of the same building rather than at a corner the
#: wreck's own debris apron has enlarged by 44%). These reproduce the
#: source-frame box the corner was measured in -- x < -0.151, y > +0.420
#: source units, z from -0.80 to +0.60 -- which excludes the ground debris
#: below and the rooftop clutter above, both of which are present on both
#: sides and would only dilute the signal.
#:
#: Getting this normalisation wrong is not hypothetical: the first version
#: of this gate used 0.15/0.42 as fractions of the half-extent rather than
#: as source units, which is a corner nearly three times too large in Y, and
#: it diluted the wreck's ratio from 4.95 to 1.65 -- a false failure on a
#: correctly-rotated file.
STAIR_X_FRAC = 0.25
STAIR_Y_FRAC = 0.70
STAIR_Z_LO_FRAC = 0.08
STAIR_Z_HI_FRAC = 0.82

#: `_assert_stair_corner` floor. Measured: 3.94 (intact), 4.95 (wreck, after
#: the bake), 0.20 (wreck, bake dropped). 2.0 sits an order of magnitude
#: clear of the failure and well under both passes.
STAIR_RATIO_MIN = 2.0

#: `_assert_grades_agree` tolerance, source units. Measured difference
#: between the two files' own lowest vertices: 0.0015.
GRADE_TOL = 0.01

CREDIT = (
    "Levantine four-storey block (standing + destroyed) -- AI-generated "
    "(Meshy), disclosed per CONTRIBUTING.md; role-split and re-scaled for "
    "Roaring Lions"
)


def _measure_existing_extent(glb_path):
    """Fresh-imports a building glb into an empty scene and measures its own
    per-axis extent -- how `REAL_METRES_APARTMENT` above was produced
    (against the pre-replacement, kit-built apartment.glb) and how it can be
    re-verified from a git-history checkout of that same file
    (`git show <rev-before-this-change>:art/meshes/buildings/apartment.glb`).
    NOT called by `export()` -- see `REAL_METRES_APARTMENT`'s own comment for
    why re-measuring from the live path on every run is wrong once this
    script has already overwritten it once. Returns (dx, dy, dz); the
    docstring's SCALE section uses dx, the footprint width."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    dg = bpy.context.evaluated_depsgraph_get()
    xs, ys, zs = [], [], []
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        eo = o.evaluated_get(dg)
        m = eo.to_mesh()
        for v in m.vertices:
            wc = eo.matrix_world @ v.co
            xs.append(wc.x)
            ys.append(wc.y)
            zs.append(wc.z)
        eo.to_mesh_clear()
    extent = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return extent


def _flood_components(bm, idx_subset=None):
    """Connected components over `bm.faces`, restricted to `idx_subset` if
    given (shared-edge adjacency, restricted to the subset on both ends) --
    the one census routine every Meshy export in this pipeline re-derives;
    kept local rather than imported so this file's own thresholds stay
    checkable against its own source."""
    faces_by_idx = {f.index: f for f in bm.faces}
    pool = set(idx_subset) if idx_subset is not None else set(faces_by_idx)
    seen = set()
    comps = []
    for fi in pool:
        if fi in seen:
            continue
        stack = [fi]
        comp = []
        seen.add(fi)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            f = faces_by_idx[cur]
            for e in f.edges:
                for f2 in e.link_faces:
                    if f2.index in pool and f2.index not in seen:
                        seen.add(f2.index)
                        stack.append(f2.index)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    return comps, faces_by_idx


def _delete_faces(ob, keep_idx):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    to_delete = [f for f in bm.faces if f.index not in keep_idx]
    bmesh.ops.delete(bm, geom=to_delete, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()


def _decimate(ob, ratio, label):
    before_v, before_p = len(ob.data.vertices), len(ob.data.polygons)
    mod = ob.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after_v, after_p = len(ob.data.vertices), len(ob.data.polygons)
    print(
        f"[apartment] {label} decimate ratio={ratio}: {before_v} -> {after_v} verts, "
        f"{before_p} -> {after_p} polys"
    )


def _centroid_bbox(faces_by_idx, idx_list):
    xs, ys, zs = [], [], []
    for i in idx_list:
        c = faces_by_idx[i].calc_center_median()
        xs.append(c.x); ys.append(c.y); zs.append(c.z)
    return (
        (sum(xs) / len(xs), sum(ys) / len(ys), sum(zs) / len(zs)),
        (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)),
    )


def _grow_metal_seeds(bm, faces_by_idx, seed_comps, radius, rounds):
    """Local BFS from each seed component's own vertices, over a KDTree of
    every mesh vertex -- see module docstring "ROLE SPLIT / INTACT / metal"."""
    all_verts = list(bm.verts)
    kd = kdtree.KDTree(len(all_verts))
    for i, v in enumerate(all_verts):
        kd.insert(v.co, i)
    kd.balance()

    vert_to_faces = defaultdict(set)
    for f in bm.faces:
        for v in f.verts:
            vert_to_faces[v.index].add(f.index)

    metal_idx = set()
    for comp in seed_comps:
        grown_verts = set()
        for fi in comp:
            for v in faces_by_idx[fi].verts:
                grown_verts.add(v.index)
        frontier_pts = [all_verts[i].co for i in grown_verts]
        grown_faces = set(comp)
        for _round in range(rounds):
            new_verts = set()
            for p in frontier_pts:
                for (co, idx, dist) in kd.find_range(p, radius):
                    new_verts.add(idx)
            newly_added = False
            for vi in new_verts:
                for fi in vert_to_faces[vi]:
                    if fi not in grown_faces:
                        grown_faces.add(fi)
                        newly_added = True
            if not newly_added:
                break
            frontier_pts = [all_verts[i].co for i in new_verts if i not in grown_verts]
            grown_verts |= new_verts
        metal_idx |= grown_faces
    return metal_idx


def _split_intact_roles(main_obj):
    """Returns {role: set(face_index)} for the decimated intact shell. See
    module docstring "ROLE SPLIT / INTACT"."""
    bm = bmesh.new()
    bm.from_mesh(main_obj.data)
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    faces_by_idx = {f.index: f for f in bm.faces}

    up_idx = [f.index for f in bm.faces if f.normal.z > NZ_THRESH]
    up_comps, _ = _flood_components(bm, up_idx)
    print(
        f"[apartment] intact upward faces {len(up_idx)}/{len(faces_by_idx)}, "
        f"{len(up_comps)} components, top sizes {[len(c) for c in up_comps[:8]]}"
    )

    roof_idx = set(up_comps[0])
    trim_idx = set()
    metal_seed_comps = []
    n_fixture = n_stair = 0
    for comp in up_comps[1:]:
        centroid, bbox = _centroid_bbox(faces_by_idx, comp)
        dx, dy = bbox[1] - bbox[0], bbox[3] - bbox[2]
        cx, cy, cz = centroid
        perimeter = (
            bbox[1] >= PERIMETER or bbox[0] <= -PERIMETER
            or bbox[3] >= PERIMETER or bbox[2] <= -PERIMETER
        )
        if PARAPET_Z_MIN <= cz <= PARAPET_Z_MAX and max(dx, dy) >= TRIM_SPAN and perimeter:
            trim_idx.update(comp)
            continue
        if cz > FIXTURE_Z:
            metal_seed_comps.append(comp)
            n_fixture += 1
            continue
        if cx < STAIR_X_MAX and cy > STAIR_Y_MIN:
            metal_seed_comps.append(comp)
            n_stair += 1
            continue
        # else: mid-wall sill or balcony ledge -- reverts to wall (see docstring).

    print(f"[apartment] intact metal seeds: {n_fixture} rooftop, {n_stair} stair")
    metal_idx = _grow_metal_seeds(bm, faces_by_idx, metal_seed_comps, GROW_RADIUS, GROW_ROUNDS)
    metal_idx -= roof_idx | trim_idx
    trim_idx -= roof_idx
    wall_idx = set(faces_by_idx) - roof_idx - trim_idx - metal_idx
    print(
        f"[apartment] intact roles: roof={len(roof_idx)} trim={len(trim_idx)} "
        f"metal={len(metal_idx)} wall={len(wall_idx)}"
    )
    bm.free()
    return {"roof": roof_idx, "trim": trim_idx, "metal": metal_idx, "wall": wall_idx}


def _split_wreck_roles(wreck_obj):
    """Returns {role: set(face_index)} for the decimated wreck mesh. See
    module docstring "ROLE SPLIT / DESTROYED"."""
    bm = bmesh.new()
    bm.from_mesh(wreck_obj.data)
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    faces_by_idx = {f.index: f for f in bm.faces}

    up_idx = [f.index for f in bm.faces if f.normal.z > NZ_THRESH]
    up_comps, _ = _flood_components(bm, up_idx)
    print(
        f"[apartment_wreck] upward faces {len(up_idx)}/{len(faces_by_idx)}, "
        f"{len(up_comps)} components, top sizes {[len(c) for c in up_comps[:8]]}"
    )

    roof_idx = set()
    for comp in up_comps:
        if len(comp) >= WRECK_SIZE_FLOOR:
            roof_idx.update(comp)
    wall_idx = set(faces_by_idx) - roof_idx
    print(f"[apartment_wreck] roles: roof={len(roof_idx)} wall={len(wall_idx)}")
    bm.free()
    return {"roof": roof_idx, "wall": wall_idx}


def _tag_and_split_objects(src_obj, role_faces, prefix):
    """Duplicates `src_obj` once per non-empty role, deletes every face not
    in that role, and tags the result -- returns {role: object}."""
    result = {}
    for role, idx in role_faces.items():
        if not idx:
            continue
        if role not in building_kit.ROLES:
            raise SystemExit(
                f"{prefix}: role {role!r} outside tools/buildings/kit.py's ROLES {building_kit.ROLES}"
            )
        bpy.ops.object.select_all(action="DESELECT")
        src_obj.select_set(True)
        bpy.context.view_layer.objects.active = src_obj
        bpy.ops.object.duplicate()
        piece = bpy.context.object
        piece.name = f"{prefix}_{role}"
        _delete_faces(piece, idx)
        result[role] = piece
    return result


def _all_world_verts(objs):
    out = []
    for ob in objs:
        mw = ob.matrix_world
        for v in ob.data.vertices:
            out.append(mw @ v.co)
    return out


def _assert_stair_corner(objs, label, half_x, half_y):
    """THE orientation build gate -- see module docstring "THE BUILD GATE".
    The external stair sits in the (-X,+Y) corner of the intact model; the
    opposite (+X,-Y) corner is the control. Runs on final, baked world
    geometry, so it sees whatever every earlier step actually did rather
    than what it was asked to do."""
    pts = _all_world_verts(objs)
    zs = [p.z for p in pts]
    zlo = min(zs) + STAIR_Z_LO_FRAC * (max(zs) - min(zs))
    zhi = min(zs) + STAIR_Z_HI_FRAC * (max(zs) - min(zs))
    stair = opp = 0
    for p in pts:
        if not (zlo <= p.z <= zhi):
            continue
        if p.x < -STAIR_X_FRAC * half_x and p.y > STAIR_Y_FRAC * half_y:
            stair += 1
        elif p.x > STAIR_X_FRAC * half_x and p.y < -STAIR_Y_FRAC * half_y:
            opp += 1
    ratio = stair / max(opp, 1)
    print(f"[{label}] stair-corner gate: (-X,+Y)={stair} (+X,-Y)={opp} ratio={ratio:.2f}")
    if ratio < STAIR_RATIO_MIN:
        raise SystemExit(
            f"{label}: stair-corner gate FAILED -- (-X,+Y)={stair} against (+X,-Y)={opp}, "
            f"ratio {ratio:.2f} < {STAIR_RATIO_MIN}. The external stair is not where the "
            "intact model puts it, which means this file's Z rotation is wrong. See this "
            "module's docstring: the wreck source is 180 degrees out and WRECK_ROT_Z is "
            "what corrects it."
        )


def _wall_planes_x(objs, zf0, zf1):
    """(centre, span) of the two opposing X wall planes, by density MODE over
    a z-fraction band -- the debris-excluding registration measurement from
    the module docstring. Threshold-free: the mode of each half of the
    histogram, so a debris apron adds mass without moving the peak. The span
    comes back so the caller can reject a band whose modes did not land on
    walls at all."""
    pts = _all_world_verts(objs)
    zs = [p.z for p in pts]
    lo, hi = min(zs), max(zs)
    band = [p for p in pts if lo + zf0 * (hi - lo) <= p.z <= lo + zf1 * (hi - lo)]
    xs = [p.x for p in band]
    x0, x1 = min(xs), max(xs)
    nb = 180
    h = [0] * nb
    for x in xs:
        i = min(nb - 1, int((x - x0) / max(x1 - x0, 1e-9) * nb))
        h[i] += 1
    s = [sum(h[max(0, i - 1):i + 2]) for i in range(nb)]
    w = (x1 - x0) / nb
    mid = nb // 2
    ilo = max(range(0, mid), key=lambda i: s[i])
    ihi = max(range(mid, nb), key=lambda i: s[i])
    plo = x0 + (ilo + 0.5) * w
    phi = x0 + (ihi + 0.5) * w
    return (plo + phi) / 2.0, phi - plo


def _measure_registration_dx(idle_planes, wreck_objs, mpu):
    """How far the (already rotated and scaled) wreck must move in X to sit
    on the intact model, in metres. Measured over several z-fraction bands
    and MEDIANed rather than taken from one band, because one band's upper
    mode lands on the collapsed corner instead of a wall -- see the module
    docstring's REGISTRATION section. A band whose wreck X span falls under
    `BAND_SPAN_MIN` of the intact's for that same band is rejected outright
    for exactly that reason, which is what catches that case by measurement
    rather than by having its numbers hard-coded here."""
    deltas = []
    for (zf0, zf1), (a_centre, a_span) in zip(REGISTRATION_BANDS, idle_planes):
        b_centre, b_span = _wall_planes_x(wreck_objs, zf0, zf1)
        ok = b_span >= BAND_SPAN_MIN * a_span
        d = a_centre - b_centre
        print(
            f"[apartment] registration band {zf0:.2f}-{zf1:.2f}: intact centre {a_centre:+.4f} "
            f"span {a_span:.4f} | wreck centre {b_centre:+.4f} span {b_span:.4f} | "
            f"dx {d:+.4f} m ({d / mpu:+.4f} src) {'' if ok else '-- REJECTED, span'}"
        )
        if ok:
            deltas.append(d)
    if not deltas:
        raise SystemExit(
            "apartment: registration FAILED -- every z band's wreck wall-plane span fell "
            f"below {BAND_SPAN_MIN} of the intact's. Nothing in the wreck is reading as a wall, "
            "so no correction can be derived; see the module docstring's REGISTRATION section."
        )
    deltas.sort()
    dx = deltas[len(deltas) // 2] if len(deltas) % 2 else (deltas[len(deltas) // 2 - 1] + deltas[len(deltas) // 2]) / 2
    spread = deltas[-1] - deltas[0]
    print(
        f"[apartment] registration: {len(deltas)} band(s) kept, median dx {dx:+.4f} m "
        f"({dx / mpu:+.4f} source units), spread {spread / mpu:.4f} source units"
    )
    if spread / mpu > REGISTRATION_SPREAD_MAX:
        raise SystemExit(
            f"apartment: registration FAILED -- surviving bands disagree by {spread / mpu:.4f} "
            f"source units, over the {REGISTRATION_SPREAD_MAX} limit. The measurement is not "
            "trustworthy on this geometry; see the module docstring's REGISTRATION section."
        )
    if abs(dx / mpu - WRECK_DX_EXPECTED) > REGISTRATION_TOL:
        raise SystemExit(
            f"apartment: registration FAILED -- measured dx {dx / mpu:+.4f} source units is more "
            f"than {REGISTRATION_TOL} from the {WRECK_DX_EXPECTED} this asset has always "
            "measured. A gross change here (the 180-degree bake dropped, say, which reads about "
            "1.2) means the source pair changed, not the threshold."
        )
    return dx


def _bake_scale_rot(objs, mpu, rot_z, label):
    """Bake model-units -> metres (uniform scale), then a Z rotation. Split
    from the shift below so the wreck's registration can be MEASURED between
    the two -- it is only meaningful once the wreck is in the intact's frame,
    and only useful before it has been moved. `objs` is one file's worth of
    pieces, transformed together so they stay coincident with each other."""
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


def _bake_shift_and_ground(objs, dx, dy, label):
    """Bake the XY registration shift and then a ground shift so this
    GROUP's own lowest vertex lands at z=0 -- per file, NOT shared across
    files, since idle and wreck are each grounded by their own lowest point
    (the contract's "the model's own world origin at z ~ 0")."""
    zmin = min(min((ob.matrix_world @ v.co).z for v in ob.data.vertices) for ob in objs)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.location.x += dx
        ob.location.y += dy
        ob.location.z += -zmin
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    print(
        f"[{label}] baked XY registration ({dx:+.4f}, {dy:+.4f}) m, "
        f"ground shift +{-zmin:.4f} m -> lowest vertex at z=0"
    )
    return zmin


def _finalize_and_export(role_objs, out_path):
    """Clears custom props/materials, sets rl_role, exports one GLB. Returns
    (bytes, total_verts, total_polys, roles)."""
    for role, ob in role_objs.items():
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
        # Zero materials ship, so a UV set is bytes nothing can read -- see
        # the module docstring's "UVs ARE DROPPED".
        export_texcoords=False,
        export_extras=True,
        export_materials="NONE",
        export_copyright=CREDIT,
    )
    size = os.path.getsize(out_path)
    verts = sum(len(ob.data.vertices) for ob in role_objs.values())
    polys = sum(len(ob.data.polygons) for ob in role_objs.values())
    return size, verts, polys, sorted(role_objs)


def _open_source(path, label):
    bpy.ops.wm.open_mainfile(filepath=path)
    ob = bpy.data.objects["mesh_node"]
    if ob.modifiers:
        raise SystemExit(f"apartment {label}: mesh_node carries {len(ob.modifiers)} modifier(s)")
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


def export():
    real_metres = REAL_METRES_APARTMENT
    print(f"[apartment] real_metres (frozen, see REAL_METRES_APARTMENT's own comment): {real_metres:.4f}")

    # ---------------- INTACT ----------------
    src_obj = _open_source(SRC_INTACT, "intact")
    (ex, ey, ez), idle_grade = _extent(src_obj)
    # NOT max(ex, ey, ez): this source's longest axis is Z, and the house's
    # literal formula would under-fill the footprint by 37%. See docstring
    # "SCALE".
    mpu = metres_per_unit(ex, real_metres)
    print(
        f"[apartment] intact source extent {ex:.4f} x {ey:.4f} x {ez:.4f} model units; "
        f"world-X axis {ex:.4f} -> {real_metres:.3f} m declared ({mpu:.5f} m/unit)"
    )
    # The two candidate scales this one was cross-checked against, recorded
    # on every run the way the house docstring records its own two. 12.5000
    # is the pre-replacement kit apartment.glb's own Y extent, the depth
    # counterpart of REAL_METRES_APARTMENT.
    depth_match = 12.5000 / ey
    area_match = math.sqrt(mpu * depth_match)
    print(
        f"[apartment] scale cross-check: width-match {mpu:.4f} (taken), "
        f"depth-match {depth_match:.4f}, area-match {area_match:.4f} m/unit -- "
        f"spread {100 * (mpu - depth_match) / area_match:.1f}% (see docstring SCALE)"
    )

    bm0 = bmesh.new()
    bm0.from_mesh(src_obj.data)
    bm0.faces.ensure_lookup_table()
    whole_comps, _ = _flood_components(bm0)
    bm0.free()
    print(f"[apartment] intact whole-mesh components: {[len(c) for c in whole_comps[:5]]}")

    src_obj.name = "intact_main"
    _decimate(src_obj, DECIMATE_RATIO, "intact")

    role_faces = _split_intact_roles(src_obj)
    role_objs = _tag_and_split_objects(src_obj, role_faces, "idle")
    # Remove the original -- not just hide it. `export_scene.gltf` with
    # `use_selection=False` exports every OBJECT in the scene regardless of
    # hide state, the trap export_meshy_house.py hit on its first attempt.
    bpy.data.objects.remove(src_obj, do_unlink=True)

    idle_objs = list(role_objs.values())
    _bake_scale_rot(idle_objs, mpu, 0.0, "apartment")
    _bake_shift_and_ground(idle_objs, 0.0, 0.0, "apartment")
    _assert_stair_corner(idle_objs, "apartment", ex * mpu / 2.0, ey * mpu / 2.0)
    idle_size, idle_v, idle_p, idle_roles = _finalize_and_export(role_objs, OUT_IDLE)
    idle_world = _all_world_verts(idle_objs)
    idle_extent = (
        max(p.x for p in idle_world) - min(p.x for p in idle_world),
        max(p.y for p in idle_world) - min(p.y for p in idle_world),
        max(p.z for p in idle_world) - min(p.z for p in idle_world),
    )
    # Captured BEFORE the scene is replaced by the wreck source: the
    # registration measurement needs the intact model's own wall planes, and
    # `open_mainfile` below frees every object these names point at.
    idle_planes = [_wall_planes_x(idle_objs, z0, z1) for (z0, z1) in REGISTRATION_BANDS]
    print(
        f"[apartment] wrote {OUT_IDLE} ({idle_size} bytes, {idle_v} verts, {idle_p} polys, "
        f"roles={idle_roles}, extent {idle_extent[0]:.3f} x {idle_extent[1]:.3f} x {idle_extent[2]:.3f} m)"
    )

    # ---------------- DESTROYED ----------------
    wreck_src = _open_source(SRC_WRECK, "destroyed")
    (wx, wy, wz), wreck_grade = _extent(wreck_src)
    print(f"[apartment_wreck] source extent {wx:.4f} x {wy:.4f} x {wz:.4f} model units")
    if abs(wreck_grade - idle_grade) > GRADE_TOL:
        raise SystemExit(
            f"apartment: grades disagree -- intact lowest vertex {idle_grade:.4f}, wreck "
            f"{wreck_grade:.4f}, difference {abs(wreck_grade - idle_grade):.4f} > {GRADE_TOL}. "
            "Each file is grounded by its own lowest vertex, so a divergence here means the "
            "debris apron dips below the intact model's own grade and the two states will not "
            "sit on the same ground."
        )
    print(
        f"[apartment] grades agree: intact {idle_grade:.4f}, wreck {wreck_grade:.4f} "
        f"(difference {abs(wreck_grade - idle_grade):.4f} source units)"
    )

    wreck_src.name = "wreck_main"
    _decimate(wreck_src, DECIMATE_RATIO, "wreck")

    wreck_role_faces = _split_wreck_roles(wreck_src)
    wreck_role_objs = _tag_and_split_objects(wreck_src, wreck_role_faces, "wreck")
    bpy.data.objects.remove(wreck_src, do_unlink=True)

    wreck_objs = list(wreck_role_objs.values())
    _bake_scale_rot(wreck_objs, mpu, WRECK_ROT_Z, "apartment_wreck")
    # Measured here, between the rotation and the shift -- see
    # `_measure_registration_dx` and the docstring's REGISTRATION section.
    dx = _measure_registration_dx(idle_planes, wreck_objs, mpu)
    _bake_shift_and_ground(wreck_objs, dx, WRECK_DY * mpu, "apartment_wreck")
    _assert_stair_corner(wreck_objs, "apartment_wreck", ex * mpu / 2.0, ey * mpu / 2.0)

    resid = _wall_planes_x(wreck_objs, 0.15, 0.45)[0] - idle_planes[0][0]
    print(
        f"[apartment] registration residual after the shift: {resid:+.4f} m "
        f"({resid / mpu:+.4f} source units) on the 0.15-0.45 band"
    )

    wreck_size, wreck_v, wreck_p, wreck_roles = _finalize_and_export(wreck_role_objs, OUT_WRECK)
    wreck_world = _all_world_verts(wreck_objs)
    wreck_extent = (
        max(p.x for p in wreck_world) - min(p.x for p in wreck_world),
        max(p.y for p in wreck_world) - min(p.y for p in wreck_world),
        max(p.z for p in wreck_world) - min(p.z for p in wreck_world),
    )
    print(
        f"[apartment] wrote {OUT_WRECK} ({wreck_size} bytes, {wreck_v} verts, {wreck_p} polys, "
        f"roles={wreck_roles}, extent {wreck_extent[0]:.3f} x {wreck_extent[1]:.3f} x "
        f"{wreck_extent[2]:.3f} m)"
    )

    summary = {
        "real_metres": real_metres,
        "mpu": mpu,
        "decimate_ratio": DECIMATE_RATIO,
        "idle": {
            "path": OUT_IDLE, "bytes": idle_size, "verts": idle_v, "polys": idle_p,
            "roles": idle_roles, "extent_m": [round(v, 4) for v in idle_extent],
        },
        "wreck": {
            "path": OUT_WRECK, "bytes": wreck_size, "verts": wreck_v, "polys": wreck_p,
            "roles": wreck_roles, "extent_m": [round(v, 4) for v in wreck_extent],
        },
    }
    print("SUMMARY_JSON " + json.dumps(summary))


if __name__ == "__main__":
    export()
