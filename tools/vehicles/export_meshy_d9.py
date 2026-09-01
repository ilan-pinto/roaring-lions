"""Export the Meshy-generated armoured bulldozer as a glTF, mesh contract v2.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/vehicles/export_meshy_d9.py

Writes `art/meshes/vehicles/dozer_d9.glb`.

The unit is `dozer_d9` (`data/units/kdf/dozer_d9.json` -- `role: engineer`,
unarmed, `demolition_time_s`). It is the one KDF vehicle whose GLB was NOT
built from a supplied source: until this script existed,
`art/meshes/vehicles/dozer_d9.glb` came from `tools/vehicles/author_d9.py`
by way of `tools/export_mesh_vehicle.py`, i.e. from primitives. Every other
Meshy vehicle in this directory has an `export_meshy_*.py`; this closes the
gap.

SOURCE (one .blend supplied, used)

  art/blend/KDF/d9/
      Meshy_AI_armoured_bulldozer_pa_0830195051_part-segmentation.blend
          184 objects `model_part0`..`model_part183`, 2,167 verts and 3,610
          polys in TOTAL, ZERO materials and ZERO images.

AI-generated (Meshy), disclosed per CONTRIBUTING.md.

Unlike every other part-segmentation source in this tree this one is
**low-poly**: 2,167 verts against the Grad's 983,597. Two consequences run
through the whole script.

  * **No decimation, anywhere.** `export_meshy_rocket_battery.py` needs a
    per-part collapse ratio because its source is ~16x the heaviest thing
    this pipeline ships; this source is a fifth of the LIGHTEST
    (`heli_peten`), and 2.3x the 930-vert procedural D9 it replaces. There is
    nothing to collapse, and collapsing a 8-vert bracket destroys it.

  * **Flat shading is kept, not smoothed.** The Grad's exporter shade-smooths
    after clearing split normals, because on 983k verts the glTF exporter
    would otherwise split a vertex at nearly every loop. That reasoning does
    not transfer: this source is 94-100% flat-shaded per part BY DESIGN --
    it is faceted hard-surface low-poly, which is exactly what
    `tools/vehicles/kit.py` produces for every hand-authored vehicle in this
    set (`kit.py` never calls `shade_smooth`, so `mbt_lavi`, `apc_eitan` and
    the procedural D9 are all flat). Smoothing it would smear the facet
    edges that ARE the art style, to save perhaps 8,000 verts on a model
    that has 2,167. The custom-split-normal layer and the vertex-colour
    layer are still cleared (the layer is redundant once the polygons carry
    their own flat normals, and colour is the palette's job at runtime), and
    `shade_flat()` then makes the 0-6% of stray smooth polygons agree with
    the other 94-100%.

ROLES. The palette for this vehicle was already decided and is NOT touched
here: `tools/render_d9.py`'s own `ROLE_PALETTE` (hull olive.1, plate olive.2,
metal gunmetal.1, rubber shadow.0, glass gunmetal.3, recess shadow.1),
restated in `tools/render_mesh_gate.py`'s `VEHICLE_ROLE_PALETTES` and in
`packages/render/src/three/units/vehicle-mesh-role.ts`. All three already
agreed before this script was written and still do. This script only decides
which SEGMENTED PART carries which role, from measured geometry.

`author_d9.py` -- the procedural D9, whose sprite sheet this mesh stands in
for -- is the tie-breaker wherever a part could take two roles, because the
two must read as the same machine. Its own assignments are: tracks `rubber`;
sprocket/idler/roller `metal`; fenders and bonnet and cab roof `plate`;
frame, deck and cab `hull`; blade, push arms, stack and ripper beam `metal`.
Every group below follows it.

  hull   (2 parts, 79v, 24.1% of source surface area)
      model_part23  the chassis: dx 0.1381 -- 58% of the model's whole
          length, the single largest area in the file, spanning blade mount
          to ripper mount at deck height.
      model_part18  the armoured cab shell: dy 0.0728, dz 0.0524, standing
          at z 0.053-0.105 over the chassis. See "NO GLASS" below for what
          this part does and does not contain.

  plate  (6 parts, 79v, 18.2%)
      model_part69  the fender/deck plate: dx 0.1195 x dy 0.0788 x dz 0.0052
          -- a full-length horizontal sheet WIDER than the chassis (0.0516),
          overhanging both tracks. `author_d9.py`'s `fender_{side}` is
          `plate`, and this is that part.
      model_part14  the rear engine hood (dy 0.0735, z 0.050-0.080), i.e.
          this model's `bonnet`, which `author_d9.py` also makes `plate`.
      model_part149, model_part17  two thin full-width cross plates ahead of
          the cab (dz 0.0094 and 0.0086), the front deck.
      model_part160  the rear deck plate behind the hood.
      model_part10   the box on the cab's rear face.

  metal  (107 parts, 1,372v, 45.1%)  -- five sub-assemblies, listed in
      ROLE_PARTS below with their own comments: the blade assembly, the
      ripper assembly, the rear grille and its box, the exhaust stack, the
      cab window grille, the roof greebles, and the running gear
      (sprockets, idlers, rollers, track-frame rails).

  rubber (58 parts, 448v, 10.6%)
      The track shoes -- 29 per side, EXACTLY symmetric, which is the check
      that they are track links and not miscellaneous outboard greebles.
      Identified by rule, not by eye: outboard (|centroid y| > 0.030) and
      one shoe wide (0.016 < dy < 0.022, against the 0.010 of the rollers
      that run inside the same loop). They wrap the loop continuously, from
      z = 0.001 on the ground run to z = 0.041 on the top run.

  recess (7 parts, 106v, 1.9%)
      The cab interior, seen THROUGH the open window apertures: seat back
      and base, console, and the small pedals and fittings around them.
      `recess` is `shadow.1`, the darkest tone in this vehicle's table, and
      `render_d9.py`'s own comment on the role is "the gaps a flat box does
      not have" -- a modelled interior behind a hole in the armour is
      literally that, and it is the one thing in this source that must NOT
      read as lit olive. `author_d9.py` fakes the same effect with a single
      `cab_sill` box; here it is real geometry.

NO `glass`. Looked for, not skipped. The cab (`model_part18`) was rendered
in isolation: its window openings are **holes**, not panes -- an open
armoured ROPS cage, with a modelled seat and levers visible through them and
a grille of horizontal bars bolted outside. There is no pane geometry to
give the role to, and inventing one would be inventing art. This matches
what the source is: the bars ARE the glazing's replacement on an armoured
dozer. `jeep_shoded`, `heli_peten` and `rocket_battery` all already ship
with roles their sources had no geometry for, and
`packages/render/src/three/units/vehicle-mesh-role.ts` holds each vehicle's
table COMPLETE regardless -- so `dozer_d9`'s `glass` entry stays, unused,
and a later re-export that does model a pane needs no renderer change.

NO TURRET PIVOT. The D9 is unarmed. `render_d9.py` says so in its own
docstring ("Hull sheet only: the D9 is unarmed, so `turret_meshes` stays
empty") and the sprite it stands in for is hull-only across all sixteen
facings. `rl_part` is "hull" on every node.

ORIENTATION. The pipeline's forward is +X -- `mesh-anim.ts`'s
`meshYawFromFacing` requires it ("The contract builds a mesh unit's rest pose
facing LOCAL +X"), and the shipped procedural `dozer_d9.glb` already obeys
it: binning its vertices along X, the two +X-most bins carry the model's
widest half-span (2.01 m against 1.76-1.84 m elsewhere) at low height, which
is a dozer blade and nothing else, and `author_d9.py` builds that blade at
x = +3.08..+3.56.

**This source faces the other way.** Two independent measurements, agreeing:

  1. THE MOLDBOARD IS AT -X. `model_part0` sits at x[-0.1191, -0.0879] --
     the extreme -X end -- and spans dy 0.1147, which is the ENTIRE width of
     the model (bbox y-extent 0.1147). It is 0.0312 thick in x and 0.0538
     tall, and carries the second-largest surface area in the file. A
     full-width, low, thin-in-x plate at an extreme end is a blade; nothing
     else in a bulldozer has that shape.

  2. THE RIPPER IS AT +X. Four thin shanks (`model_part72/21/11/84`, dy
     0.0051-0.0058 each) stand at x = +0.109 with dz 0.048, hung off a
     cross-beam (`model_part37/163`) at x = +0.112. Four shanks on a beam at
     the opposite end from the blade is a ripper.

So a baked 180-degree Z rotation is required -- the same correction
`export_meshy_rocket_battery.py`, `export_meshy_tank.py`,
`export_meshy_truck.py`, `export_meshy_namer.py` and `export_meshy_jeep.py`
each make in their own frames.

CHECKED AFTER THE FACT, not assumed, and twice. `_assert_forward` runs on
the individual parts immediately after the rotation is applied and raises
unless the moldboard's centroid is at +X, the ripper shanks' at -X, and the
moldboard still spans the model's full width (so a future source whose
`model_part0` is something else fails loudly rather than rotating the wrong
way silently). Then `_report_x_profile` re-runs the SHIPPED GLB's own
14-bin measurement on the final joined geometry and raises unless the widest
half-span bin lies at x > 0. A sign error in the rotation is invisible to
every other check this script runs and would ship a dozer that drives
backwards; a render would not catch it either, because a planform check
cannot tell a leading edge from a trailing one.

SCALE. `assets/sprites/D9_HULL/manifest.json`'s own `realMetres`, 6.832 m,
read at runtime -- the same source `export_meshy_rocket_battery.py`,
`export_meshy_tank.py` and `export_meshy_truck.py` read for their vehicles,
and for the same reason: the game already draws this unit at that size, and
a mesh replacing a billboard must not change how big the unit is. That
figure is the sprite pipeline's own DERIVED size (`render_d9.py` declares
`target_scale=2.05` rather than `real_metres`, because 7.8 m over blade and
ripper would derive past the main battle tank), not a D9R's real 8.1 m.
Matching the sprite is the point, so the derived figure is the right one --
and the shipped procedural GLB measures 6.832 m on X exactly, so this
export lands on the same length as the thing it replaces.
"""
import json
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import kit as vehicle_kit  # noqa: E402 -- ROLES, the closed vehicle role vocabulary

from export_mesh_vehicle import _bake_scale  # noqa: E402 -- shared bake-scale-into-verts helper

REPO = os.path.dirname(TOOLS)
REL = os.path.join(
    "art", "blend", "KDF", "d9",
    "Meshy_AI_armoured_bulldozer_pa_0830195051_part-segmentation.blend",
)
SRC = os.path.join(REPO, REL)
#: The .blend files are gitignored and live in the MAIN checkout, not in a
#: worktree. Fall back to it so this script runs from either.
SRC_FALLBACK = os.path.join("/Users/ilpinto/dev/roaring-lions", REL)
OUT_DIR = os.path.join(REPO, "art", "meshes", "vehicles")
OUT_PATH = os.path.join(OUT_DIR, "dozer_d9.glb")
MANIFEST = os.path.join(REPO, "assets", "sprites", "D9_HULL", "manifest.json")

TAG = "dozer_d9"

#: rl_role -> the source parts that carry it. See the module docstring for
#: how each group was identified (measured extents and symmetry, never the
#: part numbering, which is arbitrary) and why each role is what it is.
#:
#: Grouped rather than one flat 184-entry dict because the groups are the
#: argument: a reviewer checks "are these 22 parts the ripper?", not "is
#: model_part148 metal?".
ROLE_PARTS = {
    "hull": [
        "model_part23",   # chassis, dx 0.1381 -- the longest mass in the file
        "model_part18",   # armoured cab shell, z 0.053-0.105
    ],
    "plate": [
        "model_part69",   # fender/deck sheet, dx 0.1195 x dy 0.0788 x dz 0.0052
        "model_part14",   # rear engine hood (this model's bonnet)
        "model_part149",  # front deck plate, dy 0.0548
        "model_part17",   # front cross plate, dy 0.0533
        "model_part160",  # rear deck plate
        "model_part10",   # box on the cab's rear face
    ],
    "metal": [
        # -- blade assembly, x <= -0.049 -------------------------------------
        "model_part0",    # THE MOLDBOARD: dy 0.1147 = the model's full width
        "model_part88",   # blade top edge / spill guard, dy 0.1060
        "model_part52", "model_part109",    # blade brackets, dz 0.046
        "model_part141", "model_part153",   # push arms
        "model_part77", "model_part35",     # lift rams, dz 0.041
        "model_part30", "model_part78",     # push-arm links
        "model_part131", "model_part94",    # pivot pins, upper
        "model_part42", "model_part101",    # pivot pins, lower
        "model_part145", "model_part146",   # 2 mm pins on the +y ram
        "model_part7", "model_part8",       # 3 mm pins on the +y arm
        "model_part16", "model_part115",    # small boxes at the deck front
        # -- ripper assembly, x >= +0.064 ------------------------------------
        "model_part72", "model_part21", "model_part11", "model_part84",
        #     the four shanks, dz 0.048, at x = +0.109
        "model_part37", "model_part163",    # ripper cross-beam, x = +0.112
        "model_part114", "model_part86",    # ripper arms, dx 0.0414
        "model_part173", "model_part45",    # outer arm rails
        "model_part118", "model_part148",   # inner arm rails
        "model_part25", "model_part5",      # lift brackets, dz 0.031
        "model_part59", "model_part123",    # lift pivots
        "model_part176", "model_part48", "model_part132", "model_part170",
        "model_part102", "model_part44",    # hydraulics and mounts
        # -- rear grille and box ---------------------------------------------
        "model_part120",  # rear radiator grille frame, dy 0.0714
        "model_part98", "model_part28", "model_part40", "model_part178",
        "model_part75",   # grille bars, dz 0.0197
        "model_part67",   # rear box
        # -- exhaust stack ----------------------------------------------------
        "model_part125",  # the stack: z 0.088-0.120, the model's own maximum
        "model_part56",   # stack base collar
        # -- cab window grille -------------------------------------------------
        "model_part55", "model_part3", "model_part32", "model_part95",
        "model_part139",  # 5 front bars, z 0.061 -> 0.093
        "model_part119", "model_part63", "model_part49", "model_part43",
        "model_part171", "model_part105", "model_part116", "model_part174",
        #     4 side bars per side, z 0.054 -> 0.091
        "model_part71", "model_part147", "model_part47",   # 3 rear bars
        "model_part150", "model_part112",  # side-window mullions, dz 0.0387
        "model_part39", "model_part12",    # cab-side brackets, forward pair
        "model_part24", "model_part79",    # cab-side brackets, rear pair
        # -- roof greebles -----------------------------------------------------
        "model_part65", "model_part26", "model_part81", "model_part85",
        "model_part57", "model_part53", "model_part89", "model_part38",
        # -- running gear (author_d9.py makes sprocket/idler/roller `metal`) ---
        "model_part13", "model_part133",   # forward sprocket/idler, dz 0.0274
        "model_part2", "model_part22",     # rear sprocket/idler, dz 0.0280
        "model_part87", "model_part74",    # track-frame rails, dx 0.0774
        "model_part68", "model_part54",    # rear hub covers
        "model_part9", "model_part111",    # outboard guards, forward
        "model_part80", "model_part138",   # outboard guards, rear
        "model_part113", "model_part36", "model_part27", "model_part166",
        "model_part168", "model_part151", "model_part156", "model_part82",
        "model_part172", "model_part129", "model_part51", "model_part108",
        "model_part99", "model_part60", "model_part34", "model_part127",
        "model_part6", "model_part46",     # 18 rollers, 9 per side, dy 0.010
    ],
    "rubber": [
        # 58 track shoes, 29 per side. Rule, not eye: |centroid y| > 0.030 and
        # 0.016 < dy < 0.022. The exact left/right symmetry is asserted below.
        "model_part4", "model_part15", "model_part19", "model_part20",
        "model_part29", "model_part31", "model_part33", "model_part41",
        "model_part50", "model_part61", "model_part62", "model_part64",
        "model_part66", "model_part70", "model_part76", "model_part83",
        "model_part90", "model_part91", "model_part92", "model_part93",
        "model_part96", "model_part97", "model_part100", "model_part103",
        "model_part104", "model_part106", "model_part107", "model_part121",
        "model_part122", "model_part124", "model_part126", "model_part128",
        "model_part130", "model_part134", "model_part135", "model_part136",
        "model_part140", "model_part142", "model_part143", "model_part144",
        "model_part152", "model_part154", "model_part155", "model_part157",
        "model_part158", "model_part159", "model_part161", "model_part162",
        "model_part164", "model_part165", "model_part167", "model_part169",
        "model_part175", "model_part177", "model_part179", "model_part180",
        "model_part181", "model_part182",
    ],
    "recess": [
        "model_part1",    # seat back
        "model_part110",  # seat base
        "model_part58",   # console / steering column
        "model_part73", "model_part117",   # pedals
        "model_part137", "model_part183",  # dash fittings
    ],
}

#: Order the joined role nodes are built in, so the export is byte-stable
#: across runs regardless of dict iteration.
ROLE_ORDER = ("hull", "plate", "metal", "rubber", "recess")

#: The moldboard, and the four ripper shanks -- the two ends the orientation
#: argument rests on, named here so `_assert_forward` measures the same parts
#: the docstring reasons about.
BLADE = "model_part0"
RIPPER_SHANKS = ("model_part72", "model_part21", "model_part11", "model_part84")


def _src_path():
    for path in (SRC, SRC_FALLBACK):
        if os.path.exists(path):
            return path
    raise SystemExit(f"neither source path exists:\n  {SRC}\n  {SRC_FALLBACK}")


def _read_real_metres():
    with open(MANIFEST) as fh:
        return json.load(fh)["realMetres"]


def _world_extent(objs):
    """Longest axis of the combined bounding box, in the objects' own units."""
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for ob in objs:
        for v in ob.data.vertices:
            w = ob.matrix_world @ v.co
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    return max(hi[i] - lo[i] for i in range(3)), lo, hi


def _strip_split_normals_and_colour(ob):
    """Clear this source's baked custom split normals and vertex-colour
    layer, and shade the result FLAT.

    Not the Grad's treatment. `export_meshy_rocket_battery.py` and
    `export_meshy_jeep.py` shade_smooth() after this clear, because on a
    ~1M-vert source the glTF exporter must otherwise split a vertex at
    nearly every loop. This source has 2,167 verts in total, so that cost
    does not exist -- and it is faceted hard-surface low-poly whose 94-100%
    flat polygons ARE the art style, matching `tools/vehicles/kit.py`, which
    never smooths anything it builds. The custom-normal layer still goes
    (redundant once the polygons carry their own face normals, and it is
    what forces per-loop splits), the `Color` layer goes for the same reason
    the contract forbids materials, and shade_flat() makes the stray 0-6% of
    smooth polygons agree with the rest."""
    while ob.data.color_attributes:
        ob.data.color_attributes.remove(ob.data.color_attributes[0])
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.mode_set(mode="OBJECT")
    ob.data.shade_flat()


def _join(objs, name):
    """Join `objs` into one object called `name`. Custom properties are set
    AFTER the join, never before -- `object.join` keeps the active object's
    own properties and silently drops the others', which is exactly the kind
    of thing that produces one correctly-roled node and four dropped ones."""
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    merged = bpy.context.view_layer.objects.active
    merged.name = name
    merged.data.name = name
    # Joining many small parts can stack up degenerate geometry; `validate`
    # repairs it in place and says whether it had to, so a source that is
    # CLEAN does not quietly acquire a repair step nobody notices. (On this
    # source it reports nothing -- there is no decimate to leave slivers
    # behind, unlike the Grad's.)
    if merged.data.validate(verbose=False):
        print(f"[{TAG}] {name}: mesh.validate() repaired invalid geometry")
    merged.data.update()
    return merged


def _centroid(ob):
    vs = ob.data.vertices
    return [sum((ob.matrix_world @ v.co)[i] for v in vs) / len(vs) for i in range(3)]


def _assert_symmetric_tracks():
    """The 58 `rubber` parts must split 29/29 across y=0.

    The shoes were selected by a geometric rule, not named one by one, so
    the thing worth checking is that the rule caught a TRACK -- a continuous
    loop mirrored on both sides -- and not an arbitrary bag of outboard
    greebles. Exact left/right symmetry is the cheapest evidence of that,
    and it is evidence a render cannot give."""
    left = right = 0
    for name in ROLE_PARTS["rubber"]:
        cy = _centroid(bpy.data.objects[name])[1]
        if cy > 0:
            left += 1
        else:
            right += 1
    print(f"[{TAG}] track shoes: {left} on +y, {right} on -y")
    if left != right or left == 0:
        raise SystemExit(
            f"{TAG}: track shoes are not left/right symmetric -- {left} on +y, "
            f"{right} on -y. The shoe rule has caught something that is not a track."
        )


def _assert_forward(full_width):
    """Fail loudly unless the MOLDBOARD leads on +X.

    Run on the individual parts immediately after the 180-degree rotation is
    applied, and before the join erases them -- this is the only point at
    which the two ends of the orientation argument (module docstring,
    "ORIENTATION") still exist as separately measurable objects. The later
    scale bake is a positive uniform scale and the ground alignment only
    moves z, so neither can change the sign of x afterwards.

    The width check is the part that matters. Asserting only "model_part0 is
    at +X" would still rotate the wrong way, silently, for any future source
    whose `model_part0` happens to be the ripper instead -- the part
    numbering carries no meaning. Asserting that the part at +X spans the
    model's whole width is asserting that it is a BLADE."""
    blade = bpy.data.objects[BLADE]
    blade_c = _centroid(blade)
    blade_dy = (max(v.co.y for v in blade.data.vertices)
                - min(v.co.y for v in blade.data.vertices))
    shank_x = sum(_centroid(bpy.data.objects[n])[0] for n in RIPPER_SHANKS) / len(RIPPER_SHANKS)
    print(f"[{TAG}] forward check: moldboard({BLADE}) centroid x={blade_c[0]:+.5f}, "
          f"span y={blade_dy:.5f} of model width {full_width:.5f}; "
          f"ripper shanks mean x={shank_x:+.5f}")
    if not blade_c[0] > 0.0 > shank_x:
        raise SystemExit(
            f"{TAG}: orientation wrong -- expected the moldboard ahead of origin and the "
            f"ripper behind it on +X, got blade x={blade_c[0]:+.5f}, shanks x={shank_x:+.5f}"
        )
    if blade_dy < full_width * 0.98:
        raise SystemExit(
            f"{TAG}: {BLADE} spans y={blade_dy:.5f} but the model is {full_width:.5f} wide -- "
            f"it is not the full-width moldboard the orientation argument assumes. "
            f"Re-identify the blade before trusting the 180-degree rotation."
        )


def _report_x_profile(objs, bins=14):
    """The shipped GLB's own orientation measurement, re-run on the result.

    `export_meshy_rocket_battery.py` established forward-is-+X by binning
    `dozer_d9.glb`'s vertices along X and finding the model's widest
    half-span, at low height, in the two +X-most bins -- "a wide, low,
    thin-in-X mass at the +X end, which is a dozer blade and nothing else".
    This runs the identical measurement on what this script just built, so
    the claim is made about THIS file rather than inherited from the one it
    replaces. Raises if the widest bin is not at +X."""
    pts = [(ob.matrix_world @ v.co) for ob in objs for v in ob.data.vertices]
    lo = min(p.x for p in pts)
    hi = max(p.x for p in pts)
    w = (hi - lo) / bins
    prof = [[0.0, 0.0] for _ in range(bins)]  # max |y| half-span, max z
    for p in pts:
        b = min(bins - 1, int((p.x - lo) / w))
        prof[b][0] = max(prof[b][0], abs(p.y))
        prof[b][1] = max(prof[b][1], p.z)
    print(f"[{TAG}] X-bin profile of the exported geometry (half-span, height in m):")
    for i, (hs, mz) in enumerate(prof):
        print(f"[{TAG}]   bin{i:2d} x={lo + w * (i + 0.5):+7.3f}  half-span={hs:.3f}  max-z={mz:.3f}")
    widest = max(range(bins), key=lambda i: prof[i][0])
    x_widest = lo + w * (widest + 0.5)
    print(f"[{TAG}] widest half-span {prof[widest][0]:.3f} m in bin{widest} at x={x_widest:+.3f} m, "
          f"height there {prof[widest][1]:.3f} m")
    if x_widest <= 0.0:
        raise SystemExit(
            f"{TAG}: the widest bin sits at x={x_widest:+.3f}, i.e. behind the origin. "
            f"The blade is at -X and the dozer would drive backwards."
        )


def export():
    src = _src_path()
    bpy.ops.wm.open_mainfile(filepath=src)

    for role in ROLE_PARTS:
        if role not in vehicle_kit.ROLES:
            raise SystemExit(f"role {role!r} outside tools/vehicles/kit.py's ROLES {vehicle_kit.ROLES}")
    if set(ROLE_PARTS) != set(ROLE_ORDER):
        raise SystemExit(f"{TAG}: ROLE_ORDER {ROLE_ORDER} does not cover ROLE_PARTS {sorted(ROLE_PARTS)}")

    assigned = [n for role in ROLE_ORDER for n in ROLE_PARTS[role]]
    if len(assigned) != len(set(assigned)):
        dupes = sorted({n for n in assigned if assigned.count(n) > 1})
        raise SystemExit(f"{TAG}: parts assigned to more than one role: {dupes}")

    present = {o.name for o in bpy.data.objects if o.type == "MESH"}
    if present != set(assigned):
        missing = sorted(present - set(assigned))
        extra = sorted(set(assigned) - present)
        raise SystemExit(
            f"{TAG}: source object set changed -- {len(present)} in source, "
            f"{len(assigned)} assigned. Unassigned in source: {missing}. "
            f"Assigned but absent: {extra}."
        )
    non_mesh = [o.name for o in bpy.data.objects if o.type != "MESH"]
    if non_mesh:
        raise SystemExit(f"{TAG}: unexpected non-mesh objects in source: {non_mesh}")
    if bpy.data.materials or bpy.data.images:
        raise SystemExit(
            f"{TAG}: source carries {len(bpy.data.materials)} material(s) and "
            f"{len(bpy.data.images)} image(s) -- expected none from a part-segmentation export"
        )

    objs = [bpy.data.objects[n] for n in assigned]
    for ob in objs:
        if ob.modifiers:
            raise SystemExit(f"{ob.name}: carries {len(ob.modifiers)} modifier(s) on load -- unexpected")

    extent, lo, hi = _world_extent(objs)
    real_metres = _read_real_metres()
    mpu = metres_per_unit(extent, real_metres)
    full_width = hi[1] - lo[1]
    print(f"[{TAG}] {len(objs)} source parts, "
          f"{sum(len(o.data.vertices) for o in objs)} verts, "
          f"{sum(len(o.data.polygons) for o in objs)} polys -- no decimation (see docstring)")
    print(f"[{TAG}] source bbox lo={[round(v, 5) for v in lo]} hi={[round(v, 5) for v in hi]}")
    print(f"[{TAG}] extent {extent:.5f} model units -> {real_metres:.3f} m declared "
          f"({mpu:.5f} m/unit, realMetres from {MANIFEST})")

    _assert_symmetric_tracks()

    for ob in objs:
        _strip_split_normals_and_colour(ob)
    print(f"[{TAG}] stripped custom split normals + vertex colour on {len(objs)} parts, shade-flat")

    # Reorient FIRST, on the individual parts: this source's moldboard is at
    # -X (module docstring, "ORIENTATION"), so bake a 180-degree Z rotation
    # and then measure the two ends while they are still separate objects.
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
        ob.rotation_mode = "XYZ"
        ob.rotation_euler = (0.0, 0.0, 3.141592653589793)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    _assert_forward(full_width)

    # Join by role -- one node per role, named {part}_{role}, the shape every
    # other vehicle in art/meshes/vehicles/ already has. part is always
    # "hull": no turret pivot, see the module docstring.
    by_role = {}
    for role in ROLE_ORDER:
        members = [bpy.data.objects[n] for n in ROLE_PARTS[role]]
        merged = _join(members, f"hull_{role}")
        merged.data.materials.clear()
        for k in list(merged.keys()):
            if k != "_RNA_UI":
                del merged[k]
        merged["rl_role"] = role
        merged["rl_part"] = "hull"
        by_role[role] = merged
        print(f"[{TAG}] hull_{role}: joined {len(members)} part(s) -> "
              f"{len(merged.data.vertices)} verts, {len(merged.data.polygons)} polys")

    parts = [by_role[r] for r in ROLE_ORDER]

    # Bake model-units -> metres into vertex data; object scale stays 1.
    _bake_scale(parts, mpu)

    # Ground alignment, from the ACTUAL combined minimum. This source already
    # sits on z=0, so the shift is expected to be ~0 -- computed rather than
    # assumed, so a future re-export of a differently-normalised source is
    # not silently left floating.
    shift_z = -min(min(v.co.z for v in ob.data.vertices) for ob in parts)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in parts:
        ob.location.z = shift_z
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    print(f"[{TAG}] ground shift {shift_z:+.6f} m (lowest vertex -> z=0)")

    lo = [min(min((ob.matrix_world @ v.co)[i] for v in ob.data.vertices) for ob in parts) for i in range(3)]
    hi = [max(max((ob.matrix_world @ v.co)[i] for v in ob.data.vertices) for ob in parts) for i in range(3)]
    print(f"[{TAG}] final bbox (Blender, Z-up) lo={[round(v, 4) for v in lo]} "
          f"hi={[round(v, 4) for v in hi]} extent={[round(hi[i] - lo[i], 4) for i in range(3)]}")

    _report_x_profile(parts)

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
            "D9 armoured bulldozer -- AI-generated (Meshy), part-segmentation export, "
            "disclosed per CONTRIBUTING.md; 184 segmented parts joined into "
            "hull_hull/hull_plate/hull_metal/hull_rubber/hull_recess for this repository. "
            "Stands in for the D9_HULL billboard authored from primitives by "
            "tools/vehicles/author_d9.py (CC BY-SA 4.0), which is not retired by this "
            "script -- it remains the source of the sprite sheet and of the wreck pose."
        ),
    )
    size = os.path.getsize(OUT_PATH)
    print(f"[{TAG}] wrote {OUT_PATH} ({size} bytes) meshes: "
          + ", ".join(f"{ob.name}={len(ob.data.vertices)}v" for ob in parts))
    return OUT_PATH


if __name__ == "__main__":
    export()
