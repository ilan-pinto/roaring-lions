"""Export the Meshy-generated tandem powered parachute as a glTF, mesh contract v2.

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python tools/vehicles/export_meshy_paramotor.py

Writes `art/meshes/vehicles/paramotor.glb` -- the mesh for the EXISTING enemy
unit `paramotor` (`data/units/enemy/paramotor.json`: `mobility.domain = "air"`,
speed 2.8, crew 2, one PKM, sight 14), replacing the `PARA_MOTOR` billboard
sheet `tools/render_paramotor.py` renders.

SOURCES -- two separate files, two halves of one aircraft, both AI-generated
(Meshy), `image-to-3d-texture` exports, disclosed per CONTRIBUTING.md:

  art/blend/enemy/paramotor/
      Meshy_AI_paramotor_canopy_3d_0831095518_image-to-3d-texture.blend
          one mesh object `mesh_node`, 938,255 verts / 1,876,742 polys, one
          material, no modifiers. Bounds X[-0.952,+0.951] Y[-0.220,+0.211]
          Z[-0.667,+0.665]. **It is not just the wing** -- the fabric canopy
          AND its full suspension-line cascade, converging to a single riser
          point at the bottom, are one welded shell. That matters more than
          anything else in this file: the vertical offset this task exists to
          get right is not a free parameter, it is MEASURED off this model's
          own lines (see THE OFFSET below).

      Meshy_AI_paramotor_trike_3d_0831095609_image-to-3d-texture.blend
          one mesh object `mesh_node`, 980,418 verts / 1,962,710 polys, one
          material, no modifiers. Bounds X[-0.952,+0.951] Y[-0.735,+0.726]
          Z[-0.493,+0.498]. A tandem powered-parachute cart: tubular space
          frame, two seated crew figures (the unit's `crew: 2`), a caged
          pusher propeller, a nose wheel and two main wheels, and a
          side-mounted machine gun (the unit's PKM).

Each source is ONE connected component -- `bmesh` loose-part analysis returns
exactly one group per file, so there is no free object-level split here of the
kind `export_meshy_apache.py`'s part-segmentation source enjoyed. Every role
boundary below is a measured geometric cut, `export_meshy_jeep.py`'s situation
rather than the apache's.

IDENTIFICATION. Verified visually as well as numerically: colour-coded
Workbench ortho renders from all three axes for each source, plus a 900px
top-down and a below-front view of the canopy. The trike render reads
unambiguously as a tandem PPC cart (two seated figures, caged pusher prop,
three wheels, a gun); the canopy render reads unambiguously as a parafoil
with a two-cascade line set converging on one riser.

ORIENTATION -- established by MEASUREMENT against already-shipped vehicle
GLBs, not from a render of this asset.

  What the convention IS, measured on shipped art (`art/meshes/vehicles/*.glb`,
  imported and measured; the glTF importer converts Y-up back to Blender Z-up,
  so X is unchanged and Z is up in every figure below):

    * `mbt_lavi.glb` -- `turret_metal` (the gun barrel) runs X[-2.446,+3.160]
      while `turret_hull` runs only X[-2.174,+0.746] and `turret_pivot` sits
      at X=-0.117. The barrel therefore projects 3.28 m to +X past its own
      pivot and 0.75 m to -X. A tank's gun points forward => **forward = +X**.
    * `technical.glb` -- `turret_hull` (the pintle DShK on the cargo bed)
      occupies X[-2.276,-0.475], i.e. the whole armed bed is at -X, so the
      cab is at +X. Same answer.
    * `heli_peten.glb` -- `hull_metal` (the chin gun) has centroid X=+0.681
      against the airframe's own +0.054, and the pooled X-band profile runs
      from a 0.296 m Y-span at the -X extreme (the tail boom) to 2.817 m at
      +X. Nose at +X. Same answer.

  Three shipped vehicles, three independent unambiguous features (gun barrel,
  armed bed, chin gun + tail boom taper), one answer: **+X is forward.**

  Where THIS asset's forward is, measured in each source's own frame:

    * TRIKE. A powered-parachute cart is a tricycle with ONE steerable nose
      wheel forward and TWO main wheels aft under the engine, with the
      propeller a pusher behind them. Measured on the decimated mesh, in the
      bottom slab (z < -0.16, i.e. below the frame, where only running gear
      lives): the -X end holds a SINGLE wheel cluster on the centreline
      (x[-0.952,-0.620], y[-0.061,+0.305]); the +X end holds TWO clusters
      symmetric about the track centre (x[+0.627,+0.951] y[+0.550,+0.726]
      and x[+0.590,+0.942] y[-0.427,-0.251]). The caged propeller is at the
      same +X end. Nose = -X, so the trike needs a 180-degree Z rotation.
      Cross-check on mass: the per-X-band vertex counts run 442 at the -X
      extreme up to 6,013/5,163/2,907 at +X -- the engine/prop/main-axle mass
      is at +X, the thin nose boom at -X.

    * CANOPY. The wing's own long axis is SPAN, not chord, so its rotation is
      a quarter turn, not a half: span must end up across the direction of
      travel (Y) and the leading edge must end up at +X. Which chordwise edge
      is the LEADING edge was settled by four independent readings, three of
      which agree and one of which is measurement noise:
        1. Cell openings. The 900px top-down render shows the -Y edge as a
           row of discrete tabs with dark gaps between them, and the +Y edge
           as one continuous smooth hem. Open cell intakes are a paraglider's
           LEADING edge. => LE = -Y.
        2. Line attachment stations. The two line cascades meet the wing at
           y = -0.17 and y = +0.05 in a chord spanning y[-0.220,+0.211]: that
           is 12% and 63% of chord measured from the -Y edge -- textbook A-row
           and C-row positions -- versus 88% and 37% measured from +Y.
           => LE = -Y.
        3. Riser position. The riser point sits at y = -0.095, i.e. 29% of
           chord aft of the -Y edge and 71% aft of the +Y edge. A pilot hangs
           under roughly a third of chord, not under two thirds. => LE = -Y.
        4. Planform sweep. The +Y edge is dead straight across the whole span
           (Ymax +0.205..+0.211 in every X band, tip to tip) while the -Y edge
           moves from -0.220 at centre to -0.098 at the tip -- the entire
           chord taper comes off the -Y edge. A paraglider's leading edge is
           the strongly swept one. => LE = -Y.
        The one dissenting reading is raw shell thickness at mid-span, which
        rises monotonically from 0.075 at the -Y edge to 0.114 at +Y and would
        argue LE = +Y. It is discounted deliberately: at the LEADING edge this
        shell is OPEN (finding 1), so a Zmax-minus-Zmin measure there samples
        the tab tips rather than a closed aerofoil, and 0.075 vs 0.114 on a
        0.43-deep chord is inside Meshy's own surface noise either way.
      So the canopy gets a +90-degree Z rotation: (0,-1) -> (+1,0) puts the
      leading edge at +X and the span onto Y.

  The trike's flip is the SIXTH time a supplied Meshy source in this
  repository has needed exactly a 180-degree Z correction -- see
  `export_meshy_jeep.py`'s docstring for that stated as a property of the
  pipeline rather than re-derived per asset. The canopy's quarter turn is new,
  and only because this is the first source whose long axis is a wingspan.

  NOT corrected: the machine gun. Measured in the trike source it points along
  -Y (a thin protrusion reaching y=-0.735, past the -Y main wheel's own
  -0.427, at x~+0.21), i.e. out of the aircraft's side; after the 180-degree
  flip it points +Y, the vehicle's left. That is left exactly as Meshy built
  it: rotating the gun to align with the hull's facing would mean cutting it
  free of the frame it is welded to and re-seating it, and a side gunner is
  what a real armed paramotor actually is. Nothing in the sim reads mesh
  geometry to aim, so this is cosmetic -- but it means the muzzle will not
  line up with the unit's facing, which is a thing to know before it reads as
  a bug.

THE OFFSET -- the geometric problem this task names, and it is not a free
parameter. The canopy source ships its own suspension lines, converging to a
single riser point; the correct assembly is to hang the trike from that point,
not to invent a gap. Two measurements do it:

  * RISER POINT, in the canopy's own frame: the horizontal centroid of the
    lowest vertex layer, the same "lowest contact layer" idiom
    `export_mesh_vehicle.py`'s `_turret_pivot` and `export_meshy_truck.py`'s
    `_turret_pivot_local` already use. Measured (-0.029, -0.095, -0.667) and
    STABLE: sweeping the layer thickness across 0.005 / 0.010 / 0.020 / 0.040
    / 0.080 moves it by 0.0012 in x and 0.0007 in y. The exact epsilon is not
    load-bearing.
  * HANG POINT, in the trike's own frame: (vertex centroid x, vertex centroid
    y, zmax) = (+0.242, +0.103, +0.498). A hanging aircraft's riser must sit
    ABOVE its centre of mass or the assembly reads as tipping, and on a single
    welded shell the vertex centroid is the available mass proxy; zmax puts
    the line cone above every part of the frame instead of through it. (The
    alternative reading, the horizontal centroid of the trike's TOPMOST layer,
    lands at x=+0.61 -- between the crew and the prop cage, which is where a
    real PPC's hang posts are. The two bracket the choice; the centroid is the
    one with a physical argument behind it and is what this script uses.)

  What that produces, in metres, at the real-world scales below, printed by
  this script on every run: the trike stands 1.35 m tall, and the wing's own
  lower surface at mid-span ends up 5.0 m above it, with the highest point of
  the canopy 8.0 m off the ground. Real tandem paraglider line length is
  ~7-8 m riser-to-wing, so Meshy's own cascade is short of a real one by
  roughly a third -- and it is used anyway, unchanged, because it is the one
  offset the two files actually agree on. Inventing a longer one would push
  the canopy's own line geometry out of proportion with the cone Meshy drew.

RELATIVE SCALE -- the second half of the geometric problem. Both files are
independently Meshy-normalised to the same 1.903-unit longest axis (canopy
1.9033, trike 1.9034), which is an export-normalisation coincidence and not a
size relationship, exactly as `export_meshy_truck.py` found for its truck and
its pintle mount. So this script derives TWO independent metres-per-unit
factors:

  * CANOPY: 9.5 m span. Sourced, not invented -- `tools/render_paramotor.py`'s
    own docstring states this unit's canopy span outright ("The canopy really
    spans 9.5 m"), and that module is this unit's current shipped art. The
    canopy's own longest axis IS its span, so this is a like-for-like
    declaration. => 4.99133 m/unit.
  * TRIKE: 2.6 m, nose wheel to prop cage, its own longest axis. This one is a
    DECLARED editorial figure, not a sourced one -- the same kind of call
    `export_meshy_truck.py` makes for `REAL_METRES_TURRET` and flags rather
    than hides. It is cross-checked three independent ways against proportions
    measured on the model, and all three land inside a real tandem PPC cart's
    range: overall height 0.9898 units -> 1.352 m (ground to a seated crew
    member's head, on a ~0.45 m seat); wheel track 1.153 units -> 1.575 m
    (real PPC 1.4-1.7 m); main-wheel diameter 0.312 units -> 0.426 m (a
    15x6.00-6 pneumatic is 0.38 m). => 1.36597 m/unit.

  The canopy is therefore 3.654x the trike's scale. **Only that RATIO survives
  into the export.** The absolute declarations cancel: after assembly the whole
  model is uniformly renormalised to the size the shipped sprite declares (see
  SCALE below), so 9.5/2.6 is the only number here that changes a vertex.

SCALE. `real_metres` read from the CURRENTLY SHIPPED `PARA_MOTOR/manifest.json`
(2.976 m), never hand-typed -- this pipeline's standing rule, and the reason
`export_mesh_vehicle.py`'s own docstring gives for it: "the mesh and the sprite
it stands beside agree on size." That 2.976 m is a DERIVED artefact of
`render_paramotor.py`'s own `target_scale=1.5` (its `SPEC` passes
`real_metres=None`), and that module's docstring says so in as many words --
"The manifest's realMetres is therefore a drawing decision, not a physical
claim", because the honest 9.5 m span would derive a 296 px unit, "larger than
a mosque and 2.4x a tank, for one soldier under a wing". So the final GLB is a
2.976 m-longest-axis object standing in for a ~9.5 m aircraft, on purpose,
because that is the size the sprite it replaces was signed off at. The
assembled model's longest axis is its SPAN (9.500 m before renormalisation),
so the uniform factor is 2.976/9.500 = 0.3133.

DECIMATION. Both sources are Meshy's refined output at ~1M verts, ~100x this
pipeline's authored vehicles, and both are decimated ONCE (COLLAPSE) before any
cut -- same order every prior script in this pipeline uses, and the cut
thresholds below were all measured against the ALREADY-DECIMATED mesh, per
`export_meshy_namer.py`'s own rule.

  canopy  ratio 0.020   938,255 -> ~18.7k verts
  trike   ratio 0.015   980,418 -> ~14.7k verts

  The canopy ratio got its own check before being accepted, because the
  suspension lines are exactly the thin-tube geometry COLLAPSE decimation can
  erase: rendered at 0.02, all ~40 lines survive as continuous strands with
  the two cascades and the riser knot intact. This is the same risk (and the
  same check) `export_meshy_apache.py` ran on its rotor disc.

THE CUTS. Two, both on the decimated meshes, both `_delete_faces` +
`_fill_holes`, the pattern `export_meshy_namer.py`/`_jeep.py`/`_apache.py`
already use.

  1. CANOPY: fabric (`hull`) vs rigging (`metal`), a flat Z plane at
     Z_RIGGING_CUT. Measured by sweep: everything below z=0.14 has an X-span
     of 1.030 (the line cone, still narrower than the wing), and at z=0.15 the
     X-span jumps to 1.816 as the wing's own lowest tip geometry enters. 0.14
     is the last plane that is pure cone. RESIDUAL, stated rather than hidden:
     the lines do not stop at the wing's lowest tip -- near mid-span they run
     on up to z~0.41 to reach their attachment points, and those upper
     segments stay in the `hull` group and will shade as fabric. They are
     tube geometry a few centimetres across at final scale; at the gameplay
     zoom this asset is checked at they are sub-pixel. An X-dependent cut
     following the wing's own arc was tried and rejected: the per-X-band
     "first z where the Y-span exceeds a quarter chord" profile is too noisy
     on a thin decimated shell (0.20 / 0.24 / 0.33 / 0.29 / 0.24 across five
     adjacent bands) to beat a flat plane.

  2. TRIKE: tyres (`rubber`) vs everything else (`metal`). Same problem
     `export_meshy_jeep.py` names for a wheeled hull -- a plain |y| threshold
     cannot separate wheel from frame-at-wheel-height -- and the same
     solution: a per-cluster box, measured. All wheel geometry sits below
     Z_TYRE_CUT (above it the model's Y-span collapses from 1.15 to 0.82) and
     inside exactly two X-clusters:
       main axle  x > +0.55, and |y - Y_TRACK_CENTRE| > 0.40. The track
                  centre is measured, not assumed zero: this source is biased
                  +0.15 in Y, and (0.726 + -0.427)/2 = +0.1495. The two
                  measured inner tyre faces land at y=+0.550 and y=-0.251,
                  which that one symmetric threshold reproduces to 0.0005.
       nose wheel x < -0.62, |y - 0.10| < 0.12 -- the fork legs sit outside
                  that band and stay `metal`, which is what they are.
     Each main tyre measures 0.324 x 0.176 x 0.301 units, a disc, which is
     the confirmation that the box is cutting a wheel and not a bracket.

ROLES -- chosen from `tools/vehicles/kit.py`'s closed six (`hull`, `plate`,
`rubber`, `metal`, `glass`, `recess`) and sourced, not guessed. This vehicle
has its OWN sprite-rig `ROLE_PALETTE` (`tools/render_paramotor.py`), the same
happy situation `heli_peten` is in and unlike `mbt_lavi`/`ifv_namer`/
`jeep_shoded`, so every choice below is read off that table rather than
borrowed from an analogue:

  hull_hull    the fabric canopy. `render_paramotor.py`: `"hull": "dust.0"`,
               commented `# canopy`. Explicit, and it is also the dominant
               silhouette -- 90% of what a player sees of this unit.
  hull_metal   the suspension lines JOINED with the whole trike remainder
               (space frame, prop cage, propeller, seats, engine, both crew
               figures, the gun). `render_paramotor.py`: `"metal":
               "gunmetal.2"`, commented `# cage, frame tubes, rigging` -- the
               lines are rigging by that table's own word, and a PPC cart
               visibly IS cage and frame tubes. It also keeps the cart reading
               DARK against a `dust.0` wing, which is how the sprite reads and
               is the only thing separating the two halves at 96 px.
  hull_rubber  the three tyres. `render_paramotor.py`: `"rubber": "shadow.0"`,
               commented `# tyres`.

  NOT USED, and why, so a future reader does not read absence as oversight:
  `plate` ("seats, prop blades, cart panels" in the sourced table) and
  `recess` ("engine cylinder, exhaust") both name parts that exist in this
  model and are welded into the middle of one shell with no boundary signal
  comparable to the two cuts above -- the same conclusion
  `export_meshy_namer.py`/`_jeep.py`/`_apache.py` each reached for their own
  hull remainders. `glass` names nothing on a paramotor at all: there is no
  windscreen, no vision block, no canopy in the aircraft sense (the "canopy"
  here is fabric, and the sourced table puts it on `hull`). Giving the crew
  `plate` was considered and rejected on the same grounds plus one more:
  `plate` is `dust.1`, one step from the wing's own `dust.0`, so the cart
  would dissolve into the wing.
  `packages/render/src/three/units/vehicle-mesh-role.ts` still wants a
  COMPLETE six-role `paramotor` table for the reason that file's own top
  comment gives -- a partial table turns a future role into a boot-time crash
  rather than a load-time gap. That entry is NOT added by this script; see
  this task's report for the exact block to add.

NO PIVOT. Neither `turret_pivot` nor `rotor_pivot`, deliberately. There is no
turret (the gun is fused into the frame and does not traverse). And although
this aircraft has a propeller, a `rotor_pivot` would be WRONG here, not merely
unimplemented: `ThreeRenderer.updateVehicleMeshes` spins a rotor pivot with
`rotorPivot.rotation.y = phase` -- rotation about the world up axis, which is
a helicopter main rotor. A pusher propeller turns about the THRUST axis, which
after this export's orientation is X. Wiring one up would spin the prop disc
flat like a helicopter rotor, visibly wrong. A propeller pivot needs a third
pivot kind with its own axis on the renderer side first; the geometry to hang
it on is in this source (the caged prop is the +X cluster) and is flagged here
for whoever adds it, the same way `export_meshy_apache.py` flags its own tail
rotor.

AIR LIFT is a runtime concern, not an export one, exactly as it is for
`heli_peten`: this script grounds the model at z=0 like every wheeled vehicle
(a PPC cart does sit on its wheels), and `ThreeRenderer` lifts `isAir` types.

GROUND. Computed from the actual combined minimum across all three final
pieces, not assumed -- same defensive convention as every prior script.

THE GATE. `pnpm validate:meshes` passes with this asset in: "mesh gate passed:
42 mesh unit(s) rendered and checked against 36 sprite unit(s)". Measured on
its own rendered representative pose rather than assumed from a pass:

  * FILL 8.081% of frame, against `validate_assets.MIN_FILL` = 6% -- 35%
    of headroom, not a scrape. Worth stating because a paramotor is mostly
    air: the wing is a thin arched band and the trike hangs a long way below
    it, so a low fill was the plausible failure here and would have wanted
    the `export_meshy_apache.py` answer (change the art, never the limit).
    It did not arise.
  * SILHOUETTE IoU peaks at 0.3355, against `validate_assets.IOU_LIMIT` =
    0.88. The nearest neighbour is the `INF_DIGGER` sprite, then `INF_DEMO`
    (0.3215) and `INF_AT` (0.3204). Nothing is close: a wide arched wing over
    a small cart is not shaped like anything else on the roster.

Two gate-side tables were extended by the same task that wrote this script,
because a new vehicle mesh does not reach either automatically:
`tools/render_mesh_gate.py`'s `VEHICLE_ROLE_PALETTES` (this unit's own
`render_paramotor.py` tones, so the gate does not colour a fabric canopy in
KDF olive from the generic fallback) and `tools/validate_mesh_assets.py`'s
`VEHICLE_OWN_SPRITES` (`paramotor -> PARA_MOTOR`, the courtesy exclusion that
stops a mesh being failed for resembling the sprite it replaces).
`packages/render/src/three/units/vehicle-mesh-role.ts` still needs a
`paramotor` entry before this GLB can be loaded at runtime -- that is a
renderer-side change and is deliberately NOT made here; see this task's report.
"""
import json
import math
import os
import sys
from collections import defaultdict

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import kit as vehicle_kit  # noqa: E402 -- ROLES, the closed vehicle role vocabulary

from export_mesh_vehicle import _bake_scale, _extent  # noqa: E402 -- shared helpers

REPO = os.path.dirname(TOOLS)

#: The two source halves. They live in the MAIN checkout's gitignored art tree
#: (`art/blend/**` is not tracked), reached by absolute path from this file's
#: own repo root -- which resolves correctly from a worktree too, because the
#: worktree carries the same `art/blend` path when one is present. If it is
#: not, this script says so by name rather than failing obscurely inside
#: Blender's library loader.
SRC_CANOPY = os.path.join(
    REPO, "art", "blend", "enemy", "paramotor",
    "Meshy_AI_paramotor_canopy_3d_0831095518_image-to-3d-texture.blend",
)
SRC_TRIKE = os.path.join(
    REPO, "art", "blend", "enemy", "paramotor",
    "Meshy_AI_paramotor_trike_3d_0831095609_image-to-3d-texture.blend",
)
#: Fallback: the sources are gitignored and live only in the main checkout, so
#: a worktree run reaches them there. Tried in order.
SRC_FALLBACK_ROOTS = (
    REPO,
    "/Users/ilpinto/dev/roaring-lions",
)

OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_PATH = os.path.join(OUT_DIR, "paramotor.glb")

#: paramotor's own declared on-screen size -- read from the sprite sheet it
#: currently ships with (PARA_MOTOR), never hand-typed. See module docstring
#: "SCALE" for why this 2.976 m is a drawing decision rather than a physical
#: claim, and why matching it anyway is correct.
PARA_MOTOR_MANIFEST = os.path.join(REPO, "assets", "sprites", "PARA_MOTOR", "manifest.json")

#: Real-world size of each half, declared against its OWN longest axis. Only
#: the RATIO of these two survives into the export (see module docstring
#: "RELATIVE SCALE") -- the assembly is renormalised to the manifest's own
#: declared size afterwards, which cancels both absolute figures.
#: The canopy's 9.5 m is SOURCED: `tools/render_paramotor.py`'s docstring.
REAL_METRES_CANOPY = 9.5
#: The trike's 2.6 m is DECLARED, and flagged as such -- see module docstring
#: for the three measured cross-checks (height 1.35 m, track 1.58 m, wheel
#: 0.43 m) that put it inside a real tandem PPC cart's range.
REAL_METRES_TRIKE = 2.6

#: Decimate ratios, measured against THESE meshes -- see module docstring
#: "DECIMATION", including the line-survival check on the canopy.
DECIMATE_RATIO_CANOPY = 0.020
DECIMATE_RATIO_TRIKE = 0.015

#: Canopy fabric/rigging plane, in the canopy's own source frame, on the
#: DECIMATED mesh -- see module docstring "THE CUTS" for the sweep.
Z_RIGGING_CUT = 0.14

#: Tyre boxes, in the trike's own source frame, on the DECIMATED mesh -- see
#: module docstring "THE CUTS" for each measurement.
Z_TYRE_CUT = -0.16
X_MAIN_AXLE_MIN = 0.55
Y_TRACK_CENTRE = 0.1495
Y_TYRE_INNER = 0.40
X_NOSE_MAX = -0.62
Y_NOSE_CENTRE = 0.10
Y_NOSE_HALF = 0.12

#: Riser-point layer thickness. Swept 0.005-0.080 with the result stable to
#: 0.0012 in x and 0.0007 in y -- see module docstring "THE OFFSET".
RISER_LAYER_EPS = 0.02

#: Same purpose as `export_meshy_apache.py`'s and `export_meshy_namer.py`'s
#: own constant of this name: a boundary loop longer than this is not a cap
#: fix, it means the cut went somewhere unintended. Both decimated meshes here
#: (~18.7k and ~14.7k verts) are the same order as those scripts' own hulls,
#: so their measured ceiling is reused rather than re-derived.
MAX_SANE_LOOP = 1200


# ---------------------------------------------------------------- helpers
# _delete_faces / _trace_boundary_loops / _fill_holes / _decimate are
# identical in behaviour to `export_meshy_apache.py`'s and
# `export_meshy_namer.py`'s own helpers of the same names, and are copied
# rather than imported for the same reason those two copy them from each
# other: importing another Meshy exporter's privates couples two unrelated
# assets' scripts together, and this pipeline has chosen duplication there.


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
    """Every closed boundary-edge loop in `bm`, flagged open/closed so
    `_fill_holes` never hands a non-loop to `triangle_fill`."""
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
    """Cap every closed boundary loop, one `triangle_fill` call per loop."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    loops = _trace_boundary_loops(bm)
    lengths = sorted((len(e) for e, _ in loops), reverse=True)[:8]
    print(f"[paramotor] {label}: {len(loops)} boundary loop(s), longest={lengths}")
    for loop_edges, closed in loops:
        if not closed or len(loop_edges) < 3:
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
        print(f"[paramotor] {label}: {remaining} boundary edge(s) remain open after fill")
    return remaining


def _decimate(ob, ratio, label):
    before_v, before_p = len(ob.data.vertices), len(ob.data.polygons)
    mod = ob.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    print(
        f"[paramotor] {label} decimate ratio={ratio}: {before_v} -> {len(ob.data.vertices)} verts, "
        f"{before_p} -> {len(ob.data.polygons)} polys"
    )


def _resolve(path):
    """The sources are gitignored and live in the main checkout, so a worktree
    run has to reach across. Fails by NAME rather than inside Blender's
    loader."""
    if os.path.exists(path):
        return path
    tail = os.path.relpath(path, REPO)
    for root in SRC_FALLBACK_ROOTS:
        alt = os.path.join(root, tail)
        if os.path.exists(alt):
            return alt
    raise SystemExit(f"source not found: {path} (also tried {SRC_FALLBACK_ROOTS})")


def _load_object(path, new_name):
    """Append `mesh_node` from `path` into the CURRENT scene, renamed so the
    two files' identically-named root objects do not collide -- identical to
    `export_meshy_truck.py`'s own helper of the same name, needed here for the
    identical reason (two independently-exported Meshy files, both containing
    exactly one object called `mesh_node`)."""
    path = _resolve(path)
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n == "mesh_node"]
    if not dst.objects or dst.objects[0] is None:
        raise SystemExit(f"{path}: no 'mesh_node' object found")
    ob = dst.objects[0]
    bpy.context.collection.objects.link(ob)
    ob.name = new_name
    ob.data.name = new_name
    if ob.modifiers:
        raise SystemExit(f"{new_name}: carries {len(ob.modifiers)} modifier(s) on load -- unexpected")
    return ob


def _strip_per_loop_data(ob, label):
    """Clear baked custom split normals, any vertex-colour layer, and every UV
    map, then shade-smooth.

    The first two are `export_meshy_jeep.py`'s own helper of the same purpose,
    and for its reason: left alone, glTF export must split a vertex everywhere
    a per-loop normal differs from its neighbour's, and the file balloons.
    Measured on THESE sources rather than assumed from that one -- both carry
    `has_custom_normals=True`, neither carries a colour layer, and the canopy
    has 29 flat polygons out of 1.88M.

    The UV maps are this script's own addition, and they are the bigger win
    here. A mesh-contract GLB carries ZERO materials, so a UV coordinate can
    never be read by anything -- but glTF still exports `TEXCOORD_0` if a mesh
    has one, and, worse, splits a vertex at every UV SEAM. These sources are
    `image-to-3d-texture` exports and are seamed all over. Measured on this
    asset: keeping the UVs exported 60,276 glTF vertices for 32,780 Blender
    vertices (1.84x) in a 2.34 MB file; dropping them exports far closer to
    1:1. Three shipped vehicles (`technical`, `mbt_lavi`, `ifv_namer`) do
    still carry a dead `TEXCOORD_0` for want of this step; four
    (`apc_eitan`, `dozer_d9`, `heli_peten`, `jeep_shoded`) do not."""
    had_colour = len(ob.data.color_attributes)
    had_normals = bool(getattr(ob.data, "has_custom_normals", False))
    had_uvs = [layer.name for layer in ob.data.uv_layers]
    flat = sum(1 for p in ob.data.polygons if not p.use_smooth)
    while ob.data.color_attributes:
        ob.data.color_attributes.remove(ob.data.color_attributes[0])
    while ob.data.uv_layers:
        ob.data.uv_layers.remove(ob.data.uv_layers[0])
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.mode_set(mode="OBJECT")
    ob.data.shade_smooth()
    print(
        f"[paramotor] {label}: custom_normals={had_normals} colour_layers={had_colour} "
        f"uv_maps={had_uvs} flat_polys={flat}/{len(ob.data.polygons)} -> stripped, shade-smoothed"
    )


def _read_real_metres():
    with open(PARA_MOTOR_MANIFEST) as fh:
        return json.load(fh)["realMetres"]


def _riser_point(ob, eps=RISER_LAYER_EPS):
    """The canopy's own riser point: the horizontal centroid of its LOWEST
    vertex layer, at that layer's z. Same "lowest contact layer" idiom
    `export_mesh_vehicle.py`'s `_turret_pivot` uses for a turret ring, and it
    means the same thing here -- the single point every suspension line
    converges on, which is where the trike hangs."""
    zmin = min(v.co.z for v in ob.data.vertices)
    layer = [v.co for v in ob.data.vertices if v.co.z <= zmin + eps]
    cx = sum(p.x for p in layer) / len(layer)
    cy = sum(p.y for p in layer) / len(layer)
    print(f"[paramotor] riser point: {len(layer)} verts in the lowest {eps} layer -> ({cx:.4f},{cy:.4f},{zmin:.4f})")
    return (cx, cy, zmin)


def _hang_point(ob):
    """The trike's own hang point: (vertex centroid x, vertex centroid y,
    zmax) -- see module docstring "THE OFFSET" for why the centroid (a mass
    proxy: the riser must sit above the centre of mass) and why zmax (the
    line cone must start above the frame, not inside it)."""
    vs = [v.co for v in ob.data.vertices]
    cx = sum(p.x for p in vs) / len(vs)
    cy = sum(p.y for p in vs) / len(vs)
    zmax = max(p.z for p in vs)
    print(f"[paramotor] hang point: centroid ({cx:.4f},{cy:.4f}) at zmax {zmax:.4f}")
    return (cx, cy, zmax)


def _is_rigging_face(f):
    return f.calc_center_median().z < Z_RIGGING_CUT


def _is_tyre_face(f):
    c = f.calc_center_median()
    if c.z >= Z_TYRE_CUT:
        return False
    if c.x > X_MAIN_AXLE_MIN:
        return abs(c.y - Y_TRACK_CENTRE) > Y_TYRE_INNER
    if c.x < X_NOSE_MAX:
        return abs(c.y - Y_NOSE_CENTRE) < Y_NOSE_HALF
    return False


def _rotate_z(objs, degrees):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
        ob.rotation_mode = "XYZ"
        ob.rotation_euler = (0.0, 0.0, math.radians(degrees))
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)


def _apply_locations(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)


def _split(ob, face_fn, keep_name, cut_name, label):
    """Duplicate `ob`, keep the `face_fn` faces on the duplicate and the rest
    on the original, then cap both. Returns (original, duplicate)."""
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.duplicate()
    cut = bpy.context.object
    cut.name = cut_name
    ob.name = keep_name
    _delete_faces(cut, face_fn, invert=False)
    _delete_faces(ob, face_fn, invert=True)
    print(
        f"[paramotor] {label} pre-fill: {cut_name} faces={len(cut.data.polygons)} "
        f"{keep_name} faces={len(ob.data.polygons)}"
    )
    if not cut.data.polygons:
        raise SystemExit(f"{label}: the cut selected zero faces -- re-measure before exporting")
    _fill_holes(cut, cut_name)
    _fill_holes(ob, keep_name)
    return ob, cut


def _join(objs, label):
    """`bpy.ops.object.join()`, active object first. Names are captured BEFORE
    the call: every non-active object in `objs` is deleted by it, and reading
    even `.name` off a deleted `bpy.types.Object` raises `ReferenceError`."""
    names = [o.name for o in objs]
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    print(f"[paramotor] joined {names} -> {label}: {len(joined.data.polygons)} polys")
    return joined


def _bbox(objs):
    xs, ys, zs = [], [], []
    for ob in objs:
        for v in ob.data.vertices:
            w = ob.matrix_world @ v.co
            xs.append(w.x)
            ys.append(w.y)
            zs.append(w.z)
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


# ---------------------------------------------------------------- export


def export():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    canopy = _load_object(SRC_CANOPY, "canopy_src")
    trike = _load_object(SRC_TRIKE, "trike_src")

    # Real-world scale, independently per source. Measured on the FULL mesh,
    # before decimation -- same order every prior script uses.
    extent_canopy = _extent([canopy])
    extent_trike = _extent([trike])
    mpu_canopy = metres_per_unit(extent_canopy, REAL_METRES_CANOPY)
    mpu_trike = metres_per_unit(extent_trike, REAL_METRES_TRIKE)
    print(
        f"[paramotor] canopy extent {extent_canopy:.4f} units -> {REAL_METRES_CANOPY:.3f} m span "
        f"({mpu_canopy:.5f} m/unit, sourced from tools/render_paramotor.py)"
    )
    print(
        f"[paramotor] trike  extent {extent_trike:.4f} units -> {REAL_METRES_TRIKE:.3f} m length "
        f"({mpu_trike:.5f} m/unit, declared -- see module docstring)"
    )
    print(f"[paramotor] relative scale canopy:trike = {mpu_canopy / mpu_trike:.4f}x")

    _strip_per_loop_data(canopy, "canopy")
    _strip_per_loop_data(trike, "trike")

    _decimate(canopy, DECIMATE_RATIO_CANOPY, "canopy")
    _decimate(trike, DECIMATE_RATIO_TRIKE, "trike")

    # Attachment geometry, measured on the DECIMATED meshes in their own
    # source frames -- rotated and scaled alongside the geometry below.
    riser_local = _riser_point(canopy)
    hang_local = _hang_point(trike)

    for role in ("hull", "metal", "rubber"):
        if role not in vehicle_kit.ROLES:
            raise SystemExit(f"role {role!r} outside tools/vehicles/kit.py's ROLES {vehicle_kit.ROLES}")

    # -- Cut 1: canopy fabric vs rigging.
    wing, rigging = _split(canopy, _is_rigging_face, "wing_cut", "rigging_cut", "canopy")
    # -- Cut 2: trike frame vs tyres.
    frame, tyres = _split(trike, _is_tyre_face, "frame_cut", "tyre_cut", "trike")

    canopy_parts = [wing, rigging]
    trike_parts = [frame, tyres]

    # Bake model-units -> metres into vertex data, independently per source
    # (object scale stays 1, the mesh contract's own convention). This is the
    # step that resolves the relative-scale problem: after it, both halves are
    # in one common metric frame for the first time.
    _bake_scale(canopy_parts, mpu_canopy)
    _bake_scale(trike_parts, mpu_trike)
    riser_scaled = tuple(c * mpu_canopy for c in riser_local)
    hang_scaled = tuple(c * mpu_trike for c in hang_local)

    # Reorient, per source, in its own local frame -- see module docstring
    # "ORIENTATION". Trike nose is -X (180 deg); canopy leading edge is -Y and
    # its span is X (+90 deg, which sends -Y to +X and X to +Y).
    _rotate_z(trike_parts, 180.0)
    # -90, not +90. The canopy's long axis is SPAN, so a quarter turn is right --
    # but the SIGN was wrong, and the check that "verified" it could not see the
    # error: re-measuring the planform (Xmin constant, Xmax swept) distinguishes
    # span from chord and says nothing about which chord END leads. Measured on
    # the shipped GLB by airfoil thickness instead: the blunt edge (a near-
    # vertical face ~0.20 tall) sat at Xmin and the knife edge at Xmax, with max
    # thickness at 2-32% of chord from the blunt end. A wing's blunt edge is its
    # LEADING edge, so at +90 the canopy flew trailing-edge-first while the
    # trike's own nose pointed +X -- the two halves disagreeing by 180 degrees.
    _rotate_z(canopy_parts, -90.0)
    hang_world = (-hang_scaled[0], -hang_scaled[1], hang_scaled[2])
    riser_world = (-riser_scaled[1], riser_scaled[0], riser_scaled[2])

    # -- The offset. Translate the canopy so its own riser point lands exactly
    # on the trike's own hang point. Nothing here is authored: both endpoints
    # were measured off the two source meshes (module docstring "THE OFFSET").
    delta = tuple(hang_world[i] - riser_world[i] for i in range(3))
    bpy.ops.object.select_all(action="DESELECT")
    for ob in canopy_parts:
        ob.location = delta
        ob.select_set(True)
    bpy.context.view_layer.objects.active = wing
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    print(
        f"[paramotor] riser {tuple(round(c, 4) for c in riser_world)} m -> hang "
        f"{tuple(round(c, 4) for c in hang_world)} m (canopy translated by "
        f"{tuple(round(c, 4) for c in delta)} m)"
    )

    all_parts = canopy_parts + trike_parts

    # Ground alignment, from the actual combined minimum across all four
    # pieces -- not assumed zero.
    zmins = [min(v.co.z for v in ob.data.vertices) for ob in all_parts]
    shift_z = -min(zmins)
    for ob in all_parts:
        ob.location.z = shift_z
    _apply_locations(all_parts)
    print(f"[paramotor] ground shift +{shift_z:.4f} m (lowest vertex -> z=0)")

    # What the assembly actually measures, in real metres, before it is
    # renormalised to the sprite's declared drawing size. These are the
    # numbers the offset decision is judged on.
    (tx0, tx1), (ty0, ty1), (tz0, tz1) = _bbox(trike_parts)
    (cx0, cx1), (cy0, cy1), (cz0, cz1) = _bbox(canopy_parts)
    (ax0, ax1), (ay0, ay1), (az0, az1) = _bbox(all_parts)
    wing_low = min(v.co.z for v in wing.data.vertices)
    print(
        f"[paramotor] REAL-METRE assembly: trike {tx1 - tx0:.2f} x {ty1 - ty0:.2f} x {tz1 - tz0:.2f} m "
        f"(top {tz1:.2f} m); canopy {cx1 - cx0:.2f} x {cy1 - cy0:.2f} x {cz1 - cz0:.2f} m "
        f"(span {cy1 - cy0:.2f} m, apex {cz1:.2f} m)"
    )
    print(
        f"[paramotor] wing lower surface {wing_low:.2f} m above ground, "
        f"{wing_low - tz1:.2f} m of clear air above the trike"
    )
    print(f"[paramotor] whole assembly {ax1 - ax0:.2f} x {ay1 - ay0:.2f} x {az1 - az0:.2f} m")

    # -- Renormalise to the size the shipped sprite declares. See module
    # docstring "SCALE": the absolute real-world declarations above cancel
    # here, and only their ratio has changed a vertex.
    extent_assembly = _extent(all_parts)
    real_metres = _read_real_metres()
    norm = metres_per_unit(extent_assembly, real_metres)
    print(
        f"[paramotor] assembly longest axis {extent_assembly:.4f} m -> {real_metres:.3f} m declared "
        f"(x{norm:.5f}, real_metres from {PARA_MOTOR_MANIFEST})"
    )
    _bake_scale(all_parts, norm)

    # Uniform scale about the world origin, and every object's origin is at
    # (0,0,0) after the location applies above, so z=0 is preserved -- assert
    # it rather than trust it.
    zmin_after = min(min(v.co.z for v in ob.data.vertices) for ob in all_parts)
    if abs(zmin_after) > 1e-5:
        raise SystemExit(f"ground plane drifted to z={zmin_after:.6f} after renormalisation")

    # -- Joins and contract naming. The rigging (canopy source) and the frame
    # (trike source) are both `metal` and both static, so they become one
    # mesh -- the same "one mesh, several disjoint islands" shape
    # `export_meshy_apache.py`'s own `hull_metal` already is. The join happens
    # AFTER both scale bakes, because until then the two halves are in
    # different unit systems.
    metal = _join([frame, rigging], "hull_metal")
    for ob, role in ((wing, "hull"), (metal, "metal"), (tyres, "rubber")):
        name = f"hull_{role}"
        ob.name = name
        ob.data.name = name
        ob.data.materials.clear()
        for k in list(ob.keys()):
            if k != "_RNA_UI":
                del ob[k]
        ob["rl_role"] = role
        ob["rl_part"] = "hull"

    final = [wing, metal, tyres]
    for ob in final:
        if ob.data.materials:
            raise SystemExit(f"{ob.name}: materials survived the clear -- contract requires zero")
        # `triangle_fill` can leave a duplicate or zero-area face behind on a
        # decimated shell, which glTF export reports as "Mesh <name> is not
        # valid, and may be exported wrongly" and then exports anyway. Fix it
        # here rather than ship it: `validate()` removes the offending
        # elements and returns whether it had to.
        if ob.data.validate(verbose=False):
            print(f"[paramotor] {ob.name}: mesh.validate() removed invalid geometry")

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
            "Tandem powered parachute -- AI-generated (Meshy), two image-to-3d-texture "
            "exports (canopy, trike), disclosed per CONTRIBUTING.md; joined and re-split "
            "into hull_hull/hull_metal/hull_rubber for this repository. Replaces the "
            "authored-primitive PARA_MOTOR sprite sheet (CC BY-SA 4.0)."
        ),
    )
    (fx0, fx1), (fy0, fy1), (fz0, fz1) = _bbox(final)
    size = os.path.getsize(OUT_PATH)
    print(
        f"[paramotor] final bbox {fx1 - fx0:.3f} x {fy1 - fy0:.3f} x {fz1 - fz0:.3f} m "
        f"X[{fx0:+.3f},{fx1:+.3f}] Y[{fy0:+.3f},{fy1:+.3f}] Z[{fz0:+.3f},{fz1:+.3f}]"
    )
    print(
        f"[paramotor] wrote {OUT_PATH} ({size} bytes) meshes: "
        f"hull_hull={len(wing.data.polygons)} polys / {len(wing.data.vertices)} verts, "
        f"hull_metal={len(metal.data.polygons)} / {len(metal.data.vertices)}, "
        f"hull_rubber={len(tyres.data.polygons)} / {len(tyres.data.vertices)}"
    )
    return OUT_PATH


if __name__ == "__main__":
    export()
