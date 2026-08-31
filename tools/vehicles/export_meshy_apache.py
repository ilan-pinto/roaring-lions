"""Export the Meshy-generated AH-64 Peten as a hull+rotor glTF, mesh contract v2.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/vehicles/export_meshy_apache.py

Writes `art/meshes/vehicles/heli_peten.glb`.

SOURCE: art/blend/KDF/AH-64 attack helicopter/
Meshy_AI_attack_helicopter_spl_0830150207_part-segmentation.blend -- AI-generated
(Meshy), **part-segmentation** export, disclosed per CONTRIBUTING.md. Like
`export_meshy_jeep.py`'s source and unlike the welded single-shell sources
(`export_meshy_tank.py`, `export_meshy_truck.py`, `export_meshy_namer.py`),
Meshy has already split this one: seven mesh objects, zero materials, no
modifiers. A second, `image-to-3d-texture` export of the same airframe also
ships alongside this one; it was not needed here -- the part-segmentation file
already isolates the one thing this task actually needed isolated (the rotor)
without a welded-shell fight, exactly the reason the jeep started there too.

  model_part2  536,733 verts / 1,073,683 polys -- the whole airframe body:
               fuselage, tail boom, canopy, landing gear, all one connected
               shell. Meshy's part-segmentation split off the rotor, the
               chin gun and a handful of small greebles as their own
               objects, but never split the canopy or the gear from the
               body they are welded to -- the same "one big welded
               remainder" shape every source in this pipeline has had.
  model_part0  197,106 verts / 394,275 polys -- the MAIN ROTOR. Already its
               own object, no cut needed -- see ORIENTATION and ROTOR PIVOT
               below for how this task actually used that.
  model_part6   37,396 verts /  74,788 polys -- the tail fin/pylon, WITH the
               tail rotor blades fused into the same shell (see TAIL ROTOR
               below for why this ships as one static piece).
  model_part1   10,176 verts /  20,364 polys -- the chin gun: mount, cradle,
               barrel (M230-pattern), at the extreme nose.
  model_part3    2,018 verts /   4,036 polys -- a small fin/sensor blade
               beside the chin gun mount.
  model_part5    1,958 verts /   3,912 polys -- one of a small mirrored
               greeble pair near the tail-rotor gearbox.
  model_part4    1,697 verts /   3,390 polys -- the other half of that pair.

Total 787,084 verts across seven objects, none welded to each other (a
`mesh.separate(type='LOOSE')`-equivalent read is unnecessary here the way it
was for the jeep's `model_part0`: every part-segmentation object here is
ALREADY the unit this export wants -- there is no hull+wheels situation to
split further, only ONE genuine cut, see THE CUT below).

IDENTIFICATION. Verified visually, not assumed from vertex counts alone: a
colour-coded Workbench render (object-colour, no lights, near-instant even at
~800k verts) from TOP, SIDE and isolated per-object views. `model_part0`
reads unambiguously as a multi-blade rotor. COUNTED rather than eyeballed,
by `_rotor_blade_axes` (which the BLADE WIDTH work below needed anyway):
**five** blades at 70.1/71.1/71.0/74.8/73.1 degrees -- not the six an earlier
read of that colour-coded render reported, and not the four a real AH-64 has.
Tip radii 2.10-2.25 m, a 7% spread, so the same earlier read's "one visibly
shorter" is not an outlier either. Neither fact troubles the pivot, which
spins the mesh as one rigid body regardless of blade count or spacing; the
blade COUNT is argued under BLADE WIDTH. `model_part1`+
`model_part3` isolated together read as a barrel-and-mount assembly with a
small fin beside it, positioned at one extreme of the model's long axis, low
down -- the chin gun. `model_part6` isolated alone reads as a canted fin
panel (the real AH-64's own tail-rotor pylon leans outward at an angle, which
is exactly what an isolated top-down render of just this object shows: a
shape at a diagonal to the world axes, not a camera-setup bug) with thin
blade-like protrusions crossing through it -- the tail fin AND tail rotor,
fused. `model_part4`/`model_part5` isolated together read as a small
mirrored bracket pair near that same end.

ORIENTATION -- established by measurement, not eyeballed, per this task's own
brief ("the tail boom is unambiguous and much longer than the nose"). Two
independent readings agree:

  1. Shape. The pooled top-down silhouette shows model_part2 tapering to a
     SHORT, moderate point at one end (with model_part1's gun and
     model_part3's small fin attached right at that tip, both low on the
     Z axis) and narrowing into a LONG, thin, much shallower taper at the
     OTHER end before reaching model_part6's tail-rotor cluster -- the
     asymmetry the brief names: a short blunt nose versus a long thin boom.
  2. Position cross-check. `model_part1`/`model_part3` (the gun, unambiguous
     nose hardware on a real AH-64) sit at this source's own NEGATIVE-X
     extreme (x=[-0.195,-0.144]); `model_part6` (the tail-rotor cluster) sits
     at the POSITIVE-X extreme (x=[0.147,0.216]). The long thin boom
     (model_part2's own remaining span between the two) confirms which
     extreme is which, rather than the other way around.

Both signals agree: the nose (short taper, chin gun) is this source's own
-X; the tail (long boom, tail rotor) is +X. The contract wants forward at
+X, so this is a 180-degree Z rotation -- baked at the same point in the
pipeline (after cut, scale bake; before ground alignment) every other Meshy
source in this repository bakes its own equivalent flip. That makes this the
FIFTH of five supplied Meshy assets needing this exact correction, not a new
finding -- see `export_meshy_jeep.py`'s own docstring for the pattern
restated as a fact about the pipeline rather than re-derived per asset.

This reading was NOT re-verified with the jeep's own "drive it and read a
trail decal" method before export, because that method exists to settle a
case a still render cannot: telling a hood from a cargo bed on a low-poly
wheeled hull. A tail boom's own length asymmetry is not that kind of
ambiguous signal -- there is no plausible reading of "short blunt taper with
a gun on it" as a tail, or "long thin boom into a tail-rotor gearbox" as a
nose. The in-game check this task's own brief separately requires ("confirm
... the nose leads when it moves") is the empirical confirmation of this
read, performed after export -- see this task's own report for what was
driven and observed.

ROTOR PIVOT. The mesh contract's only prior pivot is `turret_pivot`
(`rl_pivot="turret"`), and a helicopter has no turret here (see NO TURRET
PIVOT below). This export adds a SECOND pivot kind, `rotor_pivot`
(`rl_pivot="rotor"`), parenting `model_part0` alone -- extending the
convention exactly as this task's brief describes, rather than baking spin
phases into geometry the way `render_apache.py`'s sprite rig had to
(`BLADE_BARS`/`SPIN_DEG`, four `idle` phases exploiting the rotor's own 90-
degree rotational symmetry, and no `fire` clip at all because a fixed pose
"would freeze the rotor the instant it fires" -- that file's own docstring).
None of that applies to a mesh: a pivot spun by the renderer at a constant
rate turns independently of clip or firing state, so this export only has to
locate the hub once.

The hub is found geometrically, not eyeballed: `_rotor_pivot` takes the mean
position of every vertex within 10% of the (already-decimated) rotor mesh's
own bounding-box diagonal from its horizontal (X,Y) centre. A plain bbox
centre was rejected because the five blades are not perfectly symmetric --
spaced 70.1 to 74.8 degrees apart with tip radii from 2.10 to 2.25 m -- which
would bias a bbox-centre reading toward whichever blades are longest. (An
earlier version of this paragraph said "one reads visibly shorter than the
rest in the colour-coded render". Measured, that is a 7% spread with no
outlier; the asymmetry that justifies this method is the SPACING.)
`export_mesh_vehicle.py`'s own `_turret_pivot` (a turret's LOWEST CONTACT
LAYER, where it meets the hull roof) was also rejected, because a rotor hub
has no such relationship to height -- it is where every blade converges,
which the radius-from-centre method finds directly regardless of any
per-blade Z droop or coning angle a turret's own heuristic has no equivalent
of. Checked across six radii (3% to 20% of span): the result is stable to
within 0.001 model units in X and negligibly in Y/Z at every one, so the
exact radius chosen (10%) is not load-bearing.

BLADE WIDTH -- Meshy's own blade chord is 0.156 m and the mesh gate rejects
the result for it:

    heli_peten: silhouette fills 5.7% of frame (min 6%)

The fix is to widen the blades (`BLADE_WIDEN`, `_widen_rotor_blades`), NOT to
move the threshold. `validate_assets.MIN_FILL` is imported rather than
redeclared by `validate_mesh_assets.py` precisely so nobody can, and the
sprite this mesh replaces already made this exact call in the other
direction: `render_apache.py` draws the rotor as `BLADE_BARS = 2`, "two
full-diameter bars = four blades", solid bars chosen over thin blades so the
rotor reads at gameplay zoom. The Meshy model abandoned that device. Widening
the chord restores it.

WHAT THE NUMBER WAS SIZED AGAINST. Not the sprite's raw 11.72% fill -- that
is not a like-for-like target, and chasing it produces a solid disc. The two
rigs frame differently, and by a measured amount:

  * `render_mesh_gate.py` frames through `render_rig.frame_camera`, which
    fits the 3D BOUNDING SPHERE (`ortho_scale = radius * 2 * MARGIN`).
  * `render_vehicle.py` frames through `dimetric.ortho_scale_for_turning`,
    which solves the smallest square frame holding the model at every facing.
    That function's own docstring says why it exists: "`render_vehicle.py`
    used a bounding sphere, which is rotation-invariant by construction but
    wastes most of the frame."

Measured on `art/src/aircraft/apache.blend` itself: 4.684 x 3.804 x 1.569 m,
so `ortho_scale_for_turning` gives it the 5.657 m frame its manifest records,
where the bounding sphere would give it 6.984 m -- 1.52x the area. The same
silhouette therefore scores 11.72% in one rig and ~7.7% in the other, for
reasons that have nothing to do with the art.

So the target used here is ABSOLUTE INK at the same declared size, which is
what a player actually sees when the mesh stands where the sprite stood:

    sprite APACHE_HULL   11.719% of a 5.657 m frame  =  3.750 m^2
    mesh   BLADE_WIDEN=1  5.737% of a 7.137 m frame  =  2.922 m^2   (78%)
    mesh   BLADE_WIDEN=3  7.397% of a 7.215 m frame  =  3.850 m^2  (103%)

3.0 is the smallest round factor that carries at least as much silhouette as
the art it replaces, and it clears the 6% floor by 23% rather than scraping
it. The swept alternatives: 1.8 -> 6.49%, 2.2 -> 6.79%, 2.6 -> 7.01%,
3.4 -> 7.76%, 4.5 -> 8.67%, 9.0 -> 11.69% (a solid disc, and the only way to
reach the sprite's raw percentage). Above 3.0 buys headroom nobody needs at
the cost of a stubbier blade.

NOT A DISC. Five blades of chord `c` first touch each other at radius
`5c/2pi`; at c=0.468 that is 0.372 m of a 2.15 m blade, so the inner 17% of
the disc is solid and the outer 83% is five distinct blades separated by
visible gaps -- 29% of the disc area filled, 71% open.

BLADE COUNT LEFT AT FIVE, deliberately. A real AH-64 has four and so does the
sprite, so five is a genuine Meshy inaccuracy, and correcting it was
considered. Three things argued against, and none of them is time: (1) at a
FIXED total ink the disc-solidity is identical either way (`N * c` is what
sets it), so dropping to four blades buys no readability -- it only makes each
surviving blade 25% wider, i.e. stubbier, to hold the same fill; (2) the ink
lost by deleting a blade has to be bought back by widening the rest, moving
the aspect ratio further from a real blade, not closer; (3) the geometry:
these five blade roots overlap inside one hub blob with no boundary loop to
cut on, so removing one means deleting faces in an angular sector, capping the
hole, and then ROTATING the survivors about the hub axis to re-space them --
which shears every remaining root, on an already-decimated mesh, for an
accuracy nobody can see at 64 px and NOBODY AT ALL can see while the rotor is
spinning (`ThreeRenderer` turns it a full revolution per second). The
inaccuracy is real and is recorded here rather than fixed; a future task that
wants it should rebuild the rotor from one blade rather than edit this one.

TAIL ROTOR -- not given its own pivot, and this is a deliberate scope
decision, not an oversight. `model_part6` fuses the tail rotor's blades
into the SAME shell as the stationary fin/pylon panel, with no boundary
signal comparable to any cut this pipeline has made before: the fin panel
dominates the object's own surface area, the blade protrusions are thin
appendages crossing through it at irregular angles, and (unlike every
Z-height or X-position cut in this pipeline) the whole assembly is CANTED --
tilted at an angle to the world axes, matching a real AH-64's own angled
tail-rotor pylon -- so there is no simple axis-aligned threshold to cut
along, only a genuinely freeform 3D radial-appendage-vs-panel separation this
task's time budget does not justify for what is, at gameplay zoom, a barely-
visible secondary rotor. `model_part6` ships as ordinary static `hull_hull`
geometry (see ROLES below for why `hull`, not `metal`). If a future task
wants a spinning tail rotor, the geometry to build a real cut on is already
sitting in this source -- flagged here and in this task's own report for
whoever picks it up, the same way `export_meshy_jeep.py` flags its own
NO TURRET PIVOT gun mount for a future traverse feature.

AIR LIFT is a runtime concern, not an export one -- `heli_peten` is this
pipeline's first `isAir` mesh vehicle, and the ground-relative lift that
implies is handled in `ThreeRenderer.updateVehicleMeshes`
(`packages/render/src/three/ThreeRenderer.ts`), not here. This export places
every mesh on its own local ground plane (z=0 after the GROUND step below)
exactly like every ground vehicle; the renderer is what stands it in the air.

DECIMATION. Every part decimated ONCE, at its own ratio, before any further
processing -- same reasoning as every prior script in this pipeline for an
oversized source. `model_part0` (the rotor) got its own visual check before
the ratio below was accepted: a colour-coded isolated top-down render at
ratio 0.03 is indistinguishable from the undecimated original at this
resolution -- no blade thinned to a gap, no tip lost -- which matters here
specifically because a rotor disc is exactly the kind of thin geometry
COLLAPSE decimation can break (this task's own brief names the risk).
`model_part2`'s own ratio (0.02) matches this pipeline's established value
for "the one big welded remainder" (`export_meshy_namer.py`,
`export_meshy_jeep.py`'s own `model_part0`); the CANOPY cut below was
re-verified against the DECIMATED result, not assumed to survive from a
raw-mesh measurement, matching `export_meshy_namer.py`'s own "thresholds
measured against the ALREADY-DECIMATED mesh" rule.

  model_part0  ratio 0.03  197,106 -> ~5,882 verts   (rotor; see above)
  model_part2  ratio 0.02  536,733 -> ~10,628 verts  (fuselage/boom/gear)
  model_part6  ratio 0.05   37,396 -> ~1,870 verts   (tail fin, fused rotor)
  model_part1  ratio 0.08   10,176 -> ~814 verts     (chin gun)
  model_part3  ratio 0.15    2,018 -> ~303 verts     (nose fin/sensor)
  model_part5  ratio 0.15    1,958 -> ~294 verts     (tail bracket)
  model_part4  ratio 0.15    1,697 -> ~255 verts     (tail bracket)

THE CUT: CANOPY (`hull` vs `glass`), inside `model_part2`, on the DECIMATED
mesh. A Z-histogram plus a per-candidate-cut XY-footprint sweep (0.070
through 0.100, in the decimated mesh's own source-frame Z) is decisive: the
footprint's Y-width holds near +-0.03 through z=0.080, then narrows sharply
to +-0.017-0.020 by z=0.082 and keeps narrowing smoothly above that (a
canopy bubble tapering as it domes up) -- the same "stragglers drop out"
shape `export_meshy_namer.py`'s own Z_CUT sweep used to place its hull/turret
line. Z_CANOPY_CUT=0.082 sits exactly at that transition. The resulting
region (1,179 of 10,628 decimated verts, x=[-0.086,0.009], y=[-0.020,0.016])
sits toward the FORWARD half of the fuselage and nowhere near the tail --
consistent with a tandem canopy, not a stray hull-roof greeble.

Not attempted: a landing-gear (`rubber`) cut. Unlike the jeep's own wheels
(each sitting in its own narrow per-axle X-band against an otherwise-empty
low-Z belly), a first look at this mesh's low-Z vertex distribution shows the
belly SKIN itself dominates every low-Z band the gear also occupies -- the
same "no comparable signal" conclusion `export_meshy_namer.py`/
`export_meshy_jeep.py` already reached for their own hull remainders, and a
low-value one to chase further here: this airframe's own gear is a small
tailwheel-type undercarriage, a handful of pixels at gameplay zoom.

ROLES. `model_part0` -> `metal` (`render_apache.py`'s own `ROLE_PALETTE`:
"metal -- rotor, mast, gun, gear legs" -- the sourced authority for this
airframe, see that file's own docstring). `model_part1`+`model_part3`
(joined into one mesh -- see JOINS below) -> `metal`, matching the same
entry (gun) and this pipeline's own convention for a weapon mount+barrel
(`tools/vehicles/kit.py`'s `rws()`). `model_part4`+`model_part5` (joined) ->
`metal` -- small, ambiguous greebles, ceded to `metal` rather than guessed
at, the same conservative call `export_meshy_namer.py`'s own glass/metal
boundary made. The canopy cut from `model_part2` -> `glass`
("tandem canopy" per `render_apache.py`'s own table). `model_part2`'s hull
remainder, joined with `model_part6` -> `hull`, NOT `metal`: in
`author_apache.py` (the authored primitive this replaces), the tail fin and
pylon are BOTH built with role="hull" (`taper("fin", ..., "hull")`) --
only the tail rotor's own blade/hub geometry is `metal`
(`trotor_h`/`trotor_v`/`trotor_hub`). Since `model_part6` fuses fin and
blades with no clean cut (see TAIL ROTOR above), `hull` is the more
representative single role for the fused piece as a whole: the fin panel is
the dominant surface area, and a real Apache's tail fin is painted the same
olive drab as the rest of the airframe, not bare gunmetal. `plate` and
`recess` are not present in this source -- no comparable bolt-on-panel or
shadowed-gap signal was found on the hull remainder, the same conclusion
`export_meshy_namer.py`/`export_meshy_jeep.py` reached for theirs.
`packages/render/src/three/units/vehicle-mesh-role.ts` still declares a
COMPLETE six-role `heli_peten` table regardless (see that file's own top
comment for why: a partial table turns a future role into a boot-time crash,
not a load-time gap) -- and unlike `mbt_lavi`/`ifv_namer`/`jeep_shoded`,
this vehicle has its OWN sourced `ROLE_PALETTE` (`render_apache.py` IS this
airframe's current shipped art), so its ramp table is derived from that
directly rather than borrowed from `apc_eitan`.

JOINS. Two of this export's four final meshes are `bpy.ops.object.join()`
results, not single source objects renamed in place -- new in this pipeline,
because no prior source had two ORIGINALLY SEPARATE objects destined for the
identical `{part}_{role}` name. `model_part6` (tail fin, `hull` role) is
joined into `model_part2`'s own hull remainder (also `hull`) AFTER that
remainder's own canopy cut and hole-fill are complete, so the join never has
to reconcile a fresh boundary loop with an already-closed one. Safe because
`join()` concatenates mesh data without moving any vertex: the two pieces
were already correctly positioned relative to each other in the source file
(Meshy's own part-segmentation split them at a touching seam, the same way
the jeep's three parts already sat correctly together as separate objects),
so nothing about their fit changes by merging them into one mesh instead of
two. `model_part1`+`model_part3`+`model_part4`+`model_part5` (all `metal`)
are joined the same way into one `hull_metal` mesh, despite sitting at
opposite ends of the airframe -- a single mesh with multiple disjoint
islands is ordinary here, the same shape `export_mesh_vehicle.py`'s own
`_join_by_part_role` already produces whenever a vehicle's same-role parts
are not spatially contiguous.

GROUND. Computed from the actual combined minimum across all four final
pieces, not assumed zero -- same defensive convention as every prior script,
even though this source (like the jeep's) turns out to already sit close to
z=0 at its own lowest vertex.

SCALE. `real_metres` read from the CURRENTLY SHIPPED `APACHE_HULL/manifest.json`
(4.684 m) -- never hand-typed, matching this pipeline's standing rule. This
number is a DERIVED artefact of that sprite rig's own `target_scale=2.00`
(`render_apache.py`'s own `SPEC` passes `real_metres=None`, i.e. the manifest
value was back-computed from a chosen screen scale, not measured from a real
AH-64), not a literal fuselage length -- but reusing it is still correct for
this pipeline's actual goal, stated outright in `export_mesh_vehicle.py`'s
own docstring: "the mesh and the sprite it stands beside agree on size."
Matching the manifest keeps this mesh's on-screen footprint consistent with
the sprite it replaces, which is what a swap needs; inventing an
independently "more accurate" real-world figure would UN-match it instead.
"""
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import kit as vehicle_kit  # noqa: E402 -- ROLES, the closed vehicle role vocabulary

from export_mesh_vehicle import _bake_scale, _extent  # noqa: E402 -- shared helpers

REPO = os.path.dirname(TOOLS)
SRC = os.path.join(
    REPO, "art", "blend", "AH-64 attack helicopter",
    "Meshy_AI_attack_helicopter_spl_0830150207_part-segmentation.blend",
)
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_PATH = os.path.join(OUT_DIR, "heli_peten.glb")

#: heli_peten's own declared real-world size -- read from the sprite sheet it
#: currently ships with (APACHE_HULL), never hand-typed. See module
#: docstring "SCALE".
APACHE_HULL_MANIFEST = os.path.join(REPO, "assets", "sprites", "APACHE_HULL", "manifest.json")

#: Decimate ratios, each measured against its own part -- see module
#: docstring "DECIMATION".
DECIMATE_RATIO_ROTOR = 0.03
DECIMATE_RATIO_HULL = 0.02
DECIMATE_RATIO_TAIL = 0.05
DECIMATE_RATIO_GUN = 0.08
DECIMATE_RATIO_SMALL = 0.15

#: Canopy cut (source frame, on the DECIMATED model_part2) -- see module
#: docstring "THE CUT" for the sweep this was measured against.
Z_CANOPY_CUT = 0.082

#: Rotor hub search radius, as a fraction of the (decimated) rotor mesh's own
#: bounding-box diagonal from its horizontal centre -- see module docstring
#: "ROTOR PIVOT" for why this replaces a bbox-centre or a `_turret_pivot`-style
#: lowest-layer read, and for the stability sweep (3%-20%) that found the
#: result insensitive to this exact value.
ROTOR_HUB_RADIUS_FRAC = 0.10

#: Blade-chord multiplier -- see module docstring "BLADE WIDTH" for the
#: readability decision this implements and the measurement it was sized
#: against. 1.0 exports Meshy's own chord unchanged.
BLADE_WIDEN = 3.0

#: The radius band, as a fraction of the rotor's own tip radius, over which
#: the widening ramps in (smoothstep). Below R0 nothing moves at all: that is
#: the hub blob, where every blade root overlaps and a per-blade lateral
#: scale would tear the mesh along the sector boundaries. Measured, not
#: guessed -- an angular-occupancy sweep of the decimated rotor in 2.5%-of-R
#: bands shows 95% of all bearings occupied out to r/R=0.05, still 67% at
#: 0.10, then 31% at 0.125 and ~20% (five blades x ~4% each) from 0.15
#: outward: the blades are angularly distinct from r/R=0.125 on, so the ramp
#: starts at the hub's own edge and is complete before the blades could
#: possibly overlap each other.
BLADE_WIDEN_R0 = 0.10
BLADE_WIDEN_R1 = 0.18

#: Blade detection (`_rotor_blade_axes`). Vertices beyond DETECT_FRAC of the
#: tip radius are unambiguously blade rather than hub; their bearings are
#: histogrammed into ANGLE_BINS bins and contiguous runs -- tolerating a
#: hole of up to ANGLE_GAP empty bins inside one blade -- are the blades.
BLADE_DETECT_FRAC = 0.35
BLADE_ANGLE_BINS = 720
BLADE_ANGLE_GAP = 2

#: What that detection must find. Meshy built this rotor with FIVE blades at
#: 72 degrees (measured: 71.0/74.8/73.1/70.1/71.1 degrees between axes), not
#: the four a real AH-64 has -- see module docstring "BLADE WIDTH". Asserted
#: so that a re-export against a changed source fails loudly here rather than
#: silently widening something that is no longer a five-blade rotor.
BLADE_COUNT = 5
BLADE_SPACING_TOL_DEG = 6.0

TAU = 2.0 * math.pi

#: Same purpose as export_meshy_namer.py's own constant of this name -- the
#: decimated hull remainder here (~10,628 verts pre-cut) is a smaller but
#: comparable order of magnitude to that script's own 18,158-vert hull, so
#: its measured ceiling is reused rather than re-derived.
MAX_SANE_LOOP = 1200


def _delete_faces(ob, keep_fn, invert=False):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    to_delete = []
    for f in bm.faces:
        keep = keep_fn(f)
        if invert:
            keep = not keep
        if not keep:
            to_delete.append(f)
    bmesh.ops.delete(bm, geom=to_delete, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()


def _trace_boundary_loops(bm):
    """Identical to export_meshy_namer.py's/export_meshy_jeep.py's own helper
    of the same name -- every closed boundary-edge loop in `bm`, flagged
    open/closed so `_fill_holes` never hands a non-loop to `triangle_fill`."""
    boundary = set(e for e in bm.edges if len(e.link_faces) == 1)
    vadj = defaultdict(list)
    for e in boundary:
        v0, v1 = e.verts
        vadj[v0].append((v1, e))
        vadj[v1].append((v0, e))
    unvisited = set(boundary)
    loops = []
    while unvisited:
        e0 = next(iter(unvisited))
        unvisited.discard(e0)
        v0, v1 = e0.verts
        cur = v1
        loop_edges = [e0]
        closed = False
        while True:
            nxts = [(v, e) for (v, e) in vadj[cur] if e in unvisited]
            if not nxts:
                break
            v, e = nxts[0]
            unvisited.discard(e)
            loop_edges.append(e)
            cur = v
            if cur == v0:
                closed = True
                break
        loops.append((loop_edges, closed))
    return loops


def _fill_holes(ob, label):
    """Cap every closed boundary loop, one `triangle_fill` call per loop --
    see export_meshy_namer.py's own helper of the same name."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    loops = _trace_boundary_loops(bm)
    print(f"[{label}] {len(loops)} boundary loop(s), lengths={[len(e) for e, _ in loops]}")
    for loop_edges, closed in loops:
        if not closed or len(loop_edges) < 3:
            print(f"[{label}]   skip loop len={len(loop_edges)} closed={closed}")
            continue
        if len(loop_edges) > MAX_SANE_LOOP:
            raise SystemExit(
                f"[{label}] boundary loop of {len(loop_edges)} edges exceeds MAX_SANE_LOOP "
                f"({MAX_SANE_LOOP}) -- this is not a small cap fix, stop and re-examine the cut"
            )
        bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=loop_edges)
    remaining = sum(1 for e in bm.edges if len(e.link_faces) == 1)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    ob.data.update()
    bm.free()
    if remaining:
        print(f"[{label}] WARNING: {remaining} boundary edge(s) remain open after fill")
    return remaining


def _strip_split_normals_and_colour(ob, label):
    """Clear this source's baked custom split normals and vertex-colour
    layer, and shade-smooth the result, BEFORE any decimate or cut --
    identical to `export_meshy_jeep.py`'s own helper of the same name, and
    needed for the identical reason: this is ALSO a `part-segmentation`
    Meshy export (not `image-to-3d-texture`), and every one of its seven
    objects ships with `has_custom_normals=True` and >95% of its polygons
    `use_smooth=False` -- confirmed by inspection here too, not assumed
    from the jeep's own finding alone. Left alone, glTF export must split a
    vertex everywhere its per-loop normal (and, before this fix, its
    per-loop vertex colour) differs from its neighbour's, which is nearly
    every loop on a flat-shaded mesh: the first export attempt without this
    step landed a 3.0-to-1 vertex-to-triangle ratio (68,759 verts for
    22,969 triangles on `hull_hull` alone, "boundary edges" reported on
    every single edge of every mesh on re-import because no two triangles
    shared a vertex INDEX even where they shared a position) and a 4.28 MB
    file -- see this task's own report for the before/after comparison."""
    while ob.data.color_attributes:
        ob.data.color_attributes.remove(ob.data.color_attributes[0])
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.mode_set(mode="OBJECT")
    ob.data.shade_smooth()
    print(f"[heli_peten] {label}: stripped custom split normals + vertex colour, shade-smoothed")


def _decimate(ob, ratio, label):
    before_v, before_p = len(ob.data.vertices), len(ob.data.polygons)
    mod = ob.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after_v, after_p = len(ob.data.vertices), len(ob.data.polygons)
    print(f"[heli_peten] {label} decimate ratio={ratio}: {before_v} -> {after_v} verts, {before_p} -> {after_p} polys")


def _read_real_metres():
    with open(APACHE_HULL_MANIFEST) as fh:
        manifest = json.load(fh)
    return manifest["realMetres"]


def _is_canopy_face(f):
    return f.calc_center_median().z >= Z_CANOPY_CUT


def _rotor_pivot(rotor_obj, radius_frac=ROTOR_HUB_RADIUS_FRAC):
    """The rotor's own hub -- see module docstring "ROTOR PIVOT" for why this
    is a radius-from-horizontal-centre read rather than a bbox centre or
    `export_mesh_vehicle.py`'s own `_turret_pivot` (a LOWEST-LAYER read that
    has no equivalent meaning for a rotor)."""
    pts = [v.co.copy() for v in rotor_obj.data.vertices]
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    r = span * radius_frac
    near = [p for p in pts if (p.x - cx) ** 2 + (p.y - cy) ** 2 <= r * r]
    if not near:
        raise SystemExit(f"rotor pivot: no vertices within {r:.4f} of bbox centre ({cx:.4f},{cy:.4f})")
    hx = sum(p.x for p in near) / len(near)
    hy = sum(p.y for p in near) / len(near)
    hz = sum(p.z for p in near) / len(near)
    print(f"[heli_peten] rotor hub: {len(near)} verts within r={r:.4f} of centre -> ({hx:.4f},{hy:.4f},{hz:.4f})")
    return (hx, hy, hz)


def _rotor_radius(rotor_obj, hub):
    """The rotor's own tip radius: the furthest vertex from the hub axis,
    measured in the rotor plane (source frame, Blender Z up)."""
    return max(math.hypot(v.co.x - hub[0], v.co.y - hub[1]) for v in rotor_obj.data.vertices)


def _rotor_blade_axes(rotor_obj, hub):
    """Each blade's own outward axis, MEASURED rather than assumed from a
    blade count -- Meshy spaced these five blades at 71-75 degrees, not a
    clean 72, so a nominal `k * 2pi/N` table would mis-assign vertices near
    every sector boundary and shear the blade roots.

    Vertices beyond `BLADE_DETECT_FRAC` of the tip radius are blade, never
    hub (see `BLADE_WIDEN_R0`'s own comment for the occupancy sweep that
    fixes where the hub ends). Their bearings are histogrammed; each
    contiguous run of occupied bins is one blade, and the run's
    vertex-count-weighted circular mean is its axis. The circular mean is
    taken over cos/sin of the bin angle rather than over bin INDICES, so a
    run that wraps past bin 0 needs no special case."""
    pts = [v.co for v in rotor_obj.data.vertices]
    radius = _rotor_radius(rotor_obj, hub)
    hist = [0] * BLADE_ANGLE_BINS
    for p in pts:
        dx, dy = p.x - hub[0], p.y - hub[1]
        if math.hypot(dx, dy) < BLADE_DETECT_FRAC * radius:
            continue
        hist[int((math.atan2(dy, dx) % TAU) / TAU * BLADE_ANGLE_BINS) % BLADE_ANGLE_BINS] += 1

    occupied = [i for i in range(BLADE_ANGLE_BINS) if hist[i]]
    if not occupied:
        raise SystemExit("rotor blades: no vertices beyond the hub -- re-examine the source")
    runs = [[occupied[0]]]
    for i in occupied[1:]:
        if i - runs[-1][-1] <= BLADE_ANGLE_GAP + 1:
            runs[-1].append(i)
        else:
            runs.append([i])
    # Circular merge: a blade straddling bin 0 arrives as two runs.
    if len(runs) > 1 and (runs[0][0] + BLADE_ANGLE_BINS) - runs[-1][-1] <= BLADE_ANGLE_GAP + 1:
        runs[0] = runs.pop() + runs[0]

    axes = []
    for run in runs:
        sx = sum(hist[i] * math.cos((i + 0.5) / BLADE_ANGLE_BINS * TAU) for i in run)
        sy = sum(hist[i] * math.sin((i + 0.5) / BLADE_ANGLE_BINS * TAU) for i in run)
        axes.append(math.atan2(sy, sx) % TAU)
    axes.sort()

    if len(axes) != BLADE_COUNT:
        raise SystemExit(
            f"rotor blades: detected {len(axes)} blade(s), expected {BLADE_COUNT} "
            f"(axes at {[round(math.degrees(a), 1) for a in axes]} deg) -- the source has "
            f"changed, re-measure before widening anything"
        )
    gaps = [math.degrees((axes[(i + 1) % len(axes)] - axes[i]) % TAU) for i in range(len(axes))]
    nominal = 360.0 / BLADE_COUNT
    if max(abs(g - nominal) for g in gaps) > BLADE_SPACING_TOL_DEG:
        raise SystemExit(
            f"rotor blades: spacing {[round(g, 1) for g in gaps]} deg departs from "
            f"{nominal:.1f} by more than {BLADE_SPACING_TOL_DEG} -- re-measure before widening"
        )
    print(
        f"[heli_peten] rotor blades: {len(axes)} at "
        f"{[round(math.degrees(a), 1) for a in axes]} deg, gaps {[round(g, 1) for g in gaps]} deg"
    )
    return axes, radius


def _widen_rotor_blades(rotor_obj, hub, factor=BLADE_WIDEN):
    """Scale every blade's CHORD by `factor` about its own axis, in the rotor
    plane -- see module docstring "BLADE WIDTH".

    Span, thickness and blade count are all untouched: only the lateral
    (across-the-blade) component of each vertex is scaled, so a blade stays
    the same length and the same aerofoil thickness and simply gains chord.
    Widening about the blade's own axis rather than rotating about the hub is
    what keeps this a wider blade instead of a pie slice -- a rotation would
    scale the chord in proportion to radius and turn the disc into five
    wedges meeting at the centre.

    The scale ramps in over `BLADE_WIDEN_R0`..`R1` (smoothstep) so the hub,
    where all five blade roots overlap and a per-blade lateral scale would
    tear the mesh along the sector boundaries, is left exactly as it was.
    The side effect is a blade that broadens out of its root over the first
    fifth of its span, which is what a real rotor blade does anyway."""
    if factor == 1.0:
        return 0
    axes, radius = _rotor_blade_axes(rotor_obj, hub)
    r0, r1 = BLADE_WIDEN_R0 * radius, BLADE_WIDEN_R1 * radius
    moved = 0
    for v in rotor_obj.data.vertices:
        dx, dy = v.co.x - hub[0], v.co.y - hub[1]
        r = math.hypot(dx, dy)
        if r <= r0:
            continue
        t = min(1.0, (r - r0) / (r1 - r0))
        w = 1.0 + (factor - 1.0) * (t * t * (3.0 - 2.0 * t))
        ang = math.atan2(dy, dx)
        axis = min(axes, key=lambda a: abs((ang - a + math.pi) % TAU - math.pi))
        ca, sa = math.cos(axis), math.sin(axis)
        along = dx * ca + dy * sa
        across = (-dx * sa + dy * ca) * w
        v.co.x = hub[0] + along * ca - across * sa
        v.co.y = hub[1] + along * sa + across * ca
        moved += 1
    rotor_obj.data.update()
    print(
        f"[heli_peten] rotor blades widened x{factor} "
        f"(ramp r/R {BLADE_WIDEN_R0}-{BLADE_WIDEN_R1}, tip radius {radius:.4f}): {moved} verts moved"
    )
    return moved


def _join(objs, label):
    """`bpy.ops.object.join()`, active object first -- see module docstring
    "JOINS" for why two of this export's four final meshes need this (no
    prior source in this pipeline had two originally-separate objects
    destined for the same `{part}_{role}` name). Names are captured BEFORE
    the join call: every non-active object in `objs` is deleted by it, and a
    Python reference to a deleted `bpy.types.Object` raises `ReferenceError`
    the instant anything (even `.name`) is read back off it."""
    names = [o.name for o in objs]
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    print(f"[heli_peten] joined {names} -> {label}: {len(joined.data.polygons)} polys")
    return joined


def export():
    bpy.ops.wm.open_mainfile(filepath=SRC)
    rotor_obj = bpy.data.objects["model_part0"]
    gun_obj = bpy.data.objects["model_part1"]
    hull_obj = bpy.data.objects["model_part2"]
    fin_obj = bpy.data.objects["model_part3"]
    bracket_a_obj = bpy.data.objects["model_part4"]
    bracket_b_obj = bpy.data.objects["model_part5"]
    tail_obj = bpy.data.objects["model_part6"]
    all_src = [rotor_obj, gun_obj, hull_obj, fin_obj, bracket_a_obj, bracket_b_obj, tail_obj]
    for ob in all_src:
        if ob.modifiers:
            raise SystemExit(f"{ob.name} carries {len(ob.modifiers)} modifier(s) -- apply before cutting")

    extent_model = _extent(all_src)
    real_metres = _read_real_metres()
    mpu = metres_per_unit(extent_model, real_metres)
    print(
        f"[heli_peten] extent {extent_model:.4f} model units -> {real_metres:.3f} m declared "
        f"({mpu:.5f} m/unit, real_metres from {APACHE_HULL_MANIFEST})"
    )

    # Strip baked custom split normals + vertex colour, per part, BEFORE any
    # decimate or cut -- see _strip_split_normals_and_colour's own doc
    # comment for why this part-segmentation source needs it.
    for ob in all_src:
        _strip_split_normals_and_colour(ob, ob.name)

    # Decimate every part ONCE, before any cut -- see module docstring
    # "DECIMATION".
    _decimate(rotor_obj, DECIMATE_RATIO_ROTOR, "model_part0(rotor)")
    _decimate(hull_obj, DECIMATE_RATIO_HULL, "model_part2(hull)")
    _decimate(tail_obj, DECIMATE_RATIO_TAIL, "model_part6(tail)")
    _decimate(gun_obj, DECIMATE_RATIO_GUN, "model_part1(gun)")
    _decimate(fin_obj, DECIMATE_RATIO_SMALL, "model_part3(fin)")
    _decimate(bracket_a_obj, DECIMATE_RATIO_SMALL, "model_part4(bracket)")
    _decimate(bracket_b_obj, DECIMATE_RATIO_SMALL, "model_part5(bracket)")

    # Rotor hub, from the DECIMATED rotor mesh, in the SOURCE (pre-scale,
    # pre-rotation) frame -- rotated/scaled alongside the geometry below.
    hub_local = _rotor_pivot(rotor_obj)

    # Blade chord, widened about each blade's own axis -- see module
    # docstring "BLADE WIDTH". Done here, on the decimated rotor in the
    # source frame and BEFORE the scale bake and the Z flip, because a
    # lateral scale about an axis through the hub commutes with both: the
    # bake is uniform and the flip is a rotation in the same plane, so the
    # result is identical either side of them and this is the point at which
    # `hub_local` is known.
    _widen_rotor_blades(rotor_obj, hub_local)

    # -- Canopy cut: hull vs glass, inside model_part2 -- see module
    # docstring "THE CUT".
    for role in ("hull", "glass", "metal"):
        if role not in vehicle_kit.ROLES:
            raise SystemExit(f"role {role!r} outside tools/vehicles/kit.py's ROLES {vehicle_kit.ROLES}")

    bpy.ops.object.select_all(action="DESELECT")
    hull_obj.select_set(True)
    bpy.context.view_layer.objects.active = hull_obj
    bpy.ops.object.duplicate()
    canopy_obj = bpy.context.object
    canopy_obj.name = "canopy_cut"
    _delete_faces(canopy_obj, _is_canopy_face, invert=False)
    _delete_faces(hull_obj, _is_canopy_face, invert=True)
    print(
        f"[heli_peten] pre-fill canopy faces={len(canopy_obj.data.polygons)} "
        f"hull-remaining faces={len(hull_obj.data.polygons)}"
    )
    _fill_holes(canopy_obj, "canopy")
    _fill_holes(hull_obj, "hull-post-canopy-cut")
    print(
        f"[heli_peten] post-fill canopy faces={len(canopy_obj.data.polygons)} "
        f"hull-remaining faces={len(hull_obj.data.polygons)}"
    )

    # -- Joins: model_part6 (tail fin, hull role) into the hull remainder;
    # the four small metal greebles (gun mount, nose fin, two tail brackets)
    # into one hull_metal -- see module docstring "JOINS".
    hull_joined = _join([hull_obj, tail_obj], "hull_hull")
    metal_joined = _join([gun_obj, fin_obj, bracket_a_obj, bracket_b_obj], "hull_metal")

    # Contract naming and role tagging: {part}_{role}, extras.rl_role /
    # extras.rl_part on each. `rotor` is a NEW part category alongside
    # `hull`/`turret` -- see module docstring "ROTOR PIVOT".
    for ob, role, part in (
        (hull_joined, "hull", "hull"),
        (canopy_obj, "glass", "hull"),
        (metal_joined, "metal", "hull"),
        (rotor_obj, "metal", "rotor"),
    ):
        name = f"{part}_{role}"
        ob.name = name
        ob.data.name = name
        ob.data.materials.clear()
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        ob["rl_role"] = role
        ob["rl_part"] = part

    all_parts = [hull_joined, canopy_obj, metal_joined, rotor_obj]

    # Bake model-units -> metres into vertex data (object scale stays 1).
    _bake_scale(all_parts, mpu)
    hub_world_src = tuple(c * mpu for c in hub_local)

    # Reorient: nose is this source's own -X (chin gun, short taper), tail is
    # +X (long boom, tail-rotor cluster) -- see module docstring
    # "ORIENTATION". 180-degree Z rotation, applied and baked in AFTER the
    # cuts/joins and the scale bake, on every piece and on the rotor hub
    # alike -- same bake point as every other Meshy source in this pipeline.
    bpy.ops.object.select_all(action="DESELECT")
    for ob in all_parts:
        ob.select_set(True)
        ob.rotation_mode = "XYZ"
        ob.rotation_euler = (0.0, 0.0, 3.141592653589793)
    bpy.context.view_layer.objects.active = hull_joined
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    hub_world = (-hub_world_src[0], -hub_world_src[1], hub_world_src[2])

    # Ground alignment, from the actual combined minimum -- see module
    # docstring "GROUND".
    zmins = [min(v.co.z for v in ob.data.vertices) for ob in all_parts]
    shift_z = -min(zmins)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in all_parts:
        ob.location.z = shift_z
        ob.select_set(True)
    bpy.context.view_layer.objects.active = hull_joined
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    hub_world = (hub_world[0], hub_world[1], hub_world[2] + shift_z)
    print(f"[heli_peten] ground shift +{shift_z:.4f} m (lowest vertex -> z=0)")
    print(f"[heli_peten] rotor hub (export frame, +X forward, metres): {tuple(round(c, 4) for c in hub_world)}")

    # Rotor pivot node: parents ONLY the rotor mesh (unlike a turret pivot,
    # nothing else on this airframe traverses with it).
    pivot_obj = bpy.data.objects.new("rotor_pivot", None)
    pivot_obj.empty_display_size = 0.5
    pivot_obj["rl_pivot"] = "rotor"
    bpy.context.collection.objects.link(pivot_obj)
    pivot_obj.location = hub_world
    inv = Matrix.Translation(Vector(hub_world) * -1.0)
    rotor_obj.parent = pivot_obj
    rotor_obj.matrix_parent_inverse = inv

    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUT_PATH,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_extras=True,
        export_materials="NONE",
        export_copyright=(
            "AH-64 Peten -- AI-generated (Meshy), part-segmentation export, disclosed per "
            "CONTRIBUTING.md; re-split into hull_hull/hull_glass/hull_metal/rotor_metal for "
            "this repository. Replaces the authored-primitive APACHE_HULL sprite sheet "
            "(CC BY-SA 4.0, no licensing debt retired by this swap -- see this task's report)."
        ),
    )
    size = os.path.getsize(OUT_PATH)
    print(
        f"[heli_peten] wrote {OUT_PATH} ({size} bytes) meshes: "
        f"hull_hull={len(hull_joined.data.polygons)} hull_glass={len(canopy_obj.data.polygons)} "
        f"hull_metal={len(metal_joined.data.polygons)} rotor_metal={len(rotor_obj.data.polygons)}"
    )
    return OUT_PATH


if __name__ == "__main__":
    export()
