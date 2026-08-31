"""Export the Meshy-generated KDF field camp as the `camp` building pair,
mesh contract v2's BUILDINGS section.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python tools/buildings/export_meshy_camp.py

Writes `art/meshes/buildings/camp.glb` (standing) and
`art/meshes/buildings/camp_wreck.glb` (destroyed). Unlike
`export_meshy_house.py`, this is a NEW building TYPE, not a replacement: all
seven shipped types are civilian Levantine buildings (shanty, house,
apartment, warehouse, concrete, wall, mosque) and none is KDF. It therefore
needs a `data/structures.json` entry and a `MESH_BUILDINGS` line before it
draws -- neither of which this script writes; see this task's report for the
exact wiring, and `WALL_COLOUR_NOTE` below for the one field that changes
what this mesh looks like.

SOURCES (both AI-generated, Meshy, `part-segmentation` mode -- disclosed per
CONTRIBUTING.md; see this task's report for the full licensing note):

    art/blend/KDF/KDF camp/Meshy_AI_intact_field_camp_spl_0830174309_part-segmentation.blend
    art/blend/KDF/KDF camp/Meshy_AI_destroyed_field_camp__0830174654_part-segmentation.blend

Intact: 375 objects / 371 meshes, 3,388 verts, 5,247 tris. Destroyed: 337 /
336, 2,907 verts, 4,410 tris. Zero materials, zero images, zero UV layers, no
armature, no actions -- confirmed by inspection on both files.

## THIS ASSET ARRIVES UNDER BUDGET -- IT IS NOT DECIMATED

Every prior Meshy source in this pipeline needed aggressive decimation (the
house 975,406 verts, the supplied jeep 942,257, the Namer ~992k). This one is
3,388 verts, ~17% of the already-decimated `house.glb`. `export_meshy_house.py`'s
`_decimate` has NO counterpart here on purpose: at 5-10 verts per sandbag
block there is nothing to collapse that is not silhouette. What this source
needs instead is the JOIN: 371 separate objects exported naively is 371 draw
calls, and folding them to three role meshes is the whole optimisation.

## ROLE SPLIT -- by the Color attribute, verified by isolation render

`part-segmentation` mode ships one object per part with a flat per-part vertex
colour, and NO semantic names: every object is `model_partN`, so unlike a
kit-built building (`tools/buildings/kit.py`, "Every part declares `rl_role`")
there is no name to key on. The colour is the only part signal -- but it is
NOT a clean part id either: 371 objects carry 139 distinct exact colours,
because the per-part colour is jittered. Rounding to 24 hue buckets recovers
the real segmentation (20 families on the intact, 14 on the wreck), and each
family below was IDENTIFIED BY RENDERING IT IN ISOLATION, not inferred from
its hue -- a Meshy segmentation colour is arbitrary and carries no material
meaning whatsoever.

Because those hue indices are arbitrary, `_assert_census` re-checks each
family's object and vertex count on every run and fails loudly on any
mismatch: a regenerated source would otherwise silently paint the tents in
gunmetal and nothing would notice.

  INTACT -- three roles of the eight in `tools/buildings/kit.py`'s ROLES:

  - `wall`  <- hue 0 (253 objects, 2,262 verts): the sandbag/HESCO perimeter
    ring, the corner revetment pile, the ladder frame. Two thirds of the whole
    model and the entire silhouette.
    Plus hue 4 (27, 315): the command tent, the cots and the sacks -- canvas.
    Plus hue 21 (16, 143): the two-high shipping-container stack -- see
    `CONTAINERS_ARE_WALL`, which records why this is NOT `metal`.
    Plus the compact remainder of the tail (crates, sandbags, jerry cans).
    `wall` is the ONLY per-type-coloured building role
    (`rampForBuildingRole(role, wallColorKey)` reads `data/structures.json`'s
    own `color`), so everything that must read KDF olive lands here. See
    `WALL_COLOUR_NOTE`.
  - `metal` <- hue 14 (26, 265): the comms mast, its dish, its guy wires, the
    generator and the drums beside it. `sliceFrom('gunmetal', 2)` -- dark
    steel, right for thin hardware that should read as line-work.
  - `wood`  <- every tail object whose horizontal aspect ratio is >= LONG_AR:
    the cot frames, benches, tent battens, stakes and guy lines.
    `sliceFrom('dust', 4)` -- weathered timber.

  `roof`, `trim`, `dome`, `glass`, `rust` are deliberately UNUSED. `roof` is a
  dark sand step and would turn the olive canopies sand-coloured; `trim` is
  fired tile; `dome` is mosque limestone; `glass` is shadow. `rust` was in the
  inspection's plan for "the oil drums" -- there is no separable oil-drum
  family: the drum-shaped objects sit inside the hue-14 comms/equipment group
  and cannot be cut from it without inventing a boundary. Shipping three
  honest roles rather than five invented ones is `export_meshy_house.py`'s own
  judgement call, already on record for `technical.glb` too.

  DESTROYED -- two roles:

  - `wall`  <- hue 0 (216, 1,833) the collapsed sandbag ring; hue 23 (43, 436)
    the two flattened tent canopies and the rubble around them; hue 4 (3, 100)
    the collapsed command tent; hue 21 (25, 171) the wrecked container stack;
    plus the compact tail.
  - `metal` <- hues 18/17/12 (14+12+9, 117+82+60) the broken mast, tent poles
    and spars.
  - `wood`  <- the long-thin tail, same LONG_AR rule.

## THE GROUND PAD IS DELETED, BY MEASUREMENT NOT BY NAME

The intact source carries a flat plane spanning almost the whole compound
(2.04 x 1.88 ring-radii, 0.009 thick, at z=0.004). The terrain already draws
the ground; left in, it would z-fight across all 25 tiles. It is found by the
measured rule in `_drop_ground_pad` rather than by its `model_part359` name,
because a name is not stable across a regenerated source -- and the count it
removes is asserted, so the rule silently matching nothing (or matching a
tent) fails the run.

## SCALE -- and the one place the house precedent must NOT be followed

`export_meshy_house.py` applies ONE mpu to both siblings, on the stated
grounds that "the wreck's own extent is a collapsed, not a ground-truth,
measurement, so recalibrating from it independently would let the two states
drift out of scale". THAT RULE'S PREMISE FAILS HERE, and following it by rote
is the single worst thing anyone can do to this asset.

Both files have zmax of exactly 0.1200 and zmin of exactly 0.0000. Meshy
normalised each to a fixed HEIGHT -- and the intact's height is set by a
standing comms mast while the wreck's is set by a leaning pole, so the wreck
comes out 1.68x oversized (its own extent is 0.50361 against the intact's
0.29971). One shared mpu would put a 25.2 m wreck under a 15.0 m footprint,
spilling 5.1 m -- 1.7 tiles -- past every edge onto neighbouring structures.
That failure is silent and reads as a placement bug, not a scale bug.

INTACT mpu. `MESH_UNITS_PER_TILE` is 3.0 and `REAL_METRES_HOUSE` (12.79 GLB
units for a kit house `render_building.py` calls "four columns" wide) fixes a
tile at ~3.2 m, so a GLB unit is a metre and a 5x5-tile footprint is 15.0
units across. mpu = 15.0 / 0.29971 = 50.05, and the proportions that falls out
of are independently corroborating rather than assumed:

    sandbag wall crest   0.02707 -> 1.355 m   (HESCO Bastion Mk1 is 1.37 m)
    command tent         0.0796  -> 3.98 m wide, 3.73 m at the peak
    mast tip             0.1200  -> 6.01 m
    compound footprint   0.29971 -> 15.00 m x 14.77 m

4x4 (mpu 40) drops the revetment to 1.08 m and 6x6 (mpu 60) raises it to
1.63 m; 5x5 is the one that lands on the real HESCO height.

WRECK mpu -- DERIVED FROM A ROTATION-INVARIANT INVARIANT, then corroborated
against three landmarks the derivation never saw. This is the part the
inspection could not settle ("genuine outward blast and independent
normalisation are confounded and cannot be separated from geometry alone").
They can be.

  1. The invariant is the RING'S OWN GROUND PLAN, measured as the median
     Chebyshev radius of the perimeter objects' centroids -- rotation-invariant,
     unlike the axis-aligned block thickness/length the inspection tried, which
     is meaningless on a toppled block and is why its four candidate factors
     disagreed by 1.35x to 1.90x.

         intact ring line   0.13749      wreck ring line   0.22855
         intact ring outer  0.14985      wreck ring outer  0.25180

     ratio 0.60158 (line) and 0.59511 (outer edge) -- two measurements of the
     same plan agreeing to 1.1%.

  2. It is NOT blast spread. If the wreck's ring were the intact's ring at the
     same scale plus outward displacement, that displacement would be additive
     and the ring's RELATIVE scatter would be much wider. It is not:
     max/median is 1.079 on the intact and 1.066 on the wreck -- the wreck's
     ring is marginally TIGHTER in relative terms. The whole 1.66x is scale.

  3. Corroboration from landmarks the ring measurement never touched. At
     WRECK_RATIO, every identifiable interior feature lands on its intact
     counterpart within ~0.06 ring-radii (~0.4 m):

         command tent      intact (+0.677, -0.214) R   wreck (+0.621, -0.270) R
         container seg A   intact (+0.211, +0.700) R   wreck (+0.211, +0.755) R
         container seg B   intact (-0.042, +0.701) R   wreck (-0.053, +0.755) R
         mast corner       intact (+0.756, +0.364) R   wreck (+0.745, +0.465) R

     A landmark-only best-fit ratio is 0.581; the ring value 0.60158 sits
     inside that spread. The rejected block-diameter ratio (0.736, from the
     rotation-invariant median object diameter -- 0.02966 intact vs 0.04030
     wreck) would displace every one of those landmarks by 22% and is ruled
     out. The wreck's rubble chunks really are chunkier relative to its ring:
     it is a separately GENERATED collapse, not a simulated one, so its debris
     size is the model's own invention and not a measurement of the same
     physical block.

  Consequence, stated so nobody has to rediscover it: at WRECK_RATIO the
  wreck's own rubble comes out 1.21 m against the intact's 1.48 m blocks
  (~18% smaller), which is what breaking up looks like, and its full extent is
  15.16 m against the 15.00 m footprint -- 8 cm of debris past each edge.

## ORIENTATION -- the first supplied asset in this pipeline needing no bake

Five of five prior Meshy sources needed a baked rotation, so this claim is
made by measurement:

  - Z-up is already correct and the model already sits at grade: the mast is
    the global +Z maximum and zmin is exactly -0.00000 on BOTH files. Every
    prior source sat at its own vertical midpoint. `_bake_scale_and_ground`
    still measures and applies the shift, and prints it, so "no shift needed"
    is re-verified per run rather than assumed.
  - The XY origin is already the footprint centre: offset 0.0000, 0.0000.
  - THERE IS NO FRONT. The perimeter is continuous -- no gate, no entrance,
    no break -- so the compound has no facing to get wrong, and the runtime
    leaves a building's rotation at identity anyway
    (`ThreeRenderer.updateBuildingMeshes`: "a building never turns").
  - The question that DOES exist for this pair is whether the wreck's interior
    aligns with the intact's, since a mismatch would visibly spin the compound
    on the death swap. Measured: at 0 degrees the interior landmarks above sit
    on top of each other. An 8x8 interior-mass correlation over the four yaws
    also peaks at 0 (r=+0.27, against +0.06/+0.11/+0.09 for 90/180/270).
    So: no rotation is baked into either file.

## SHADING -- stripped, but NOT shade-smoothed

`export_meshy_jeep.py`'s `_strip_split_normals_and_colour` exists for a
`part-segmentation` defect that is present here in KIND (both files report
`has_custom_split_normals: True`, 5,058 flat faces against 189 smooth) but not
in SEVERITY: at 10 verts per box the vertices are already shared, so there is
no 3x position explosion to undo. The Color layer is removed regardless --
colour is the palette's job at runtime, never the source's, and it must not
ship.

The deliberate departure: that helper finishes with `ob.data.shade_smooth()`,
and this script does NOT. The jeep is a dense organic-ish hull where smooth
shading is right; this is a hard-surface low-poly camp of boxes and taut
canvas, and smoothing a 10-vert sandbag block turns it into a blob. Clearing
the custom split normals reverts each face to its own `use_smooth`, which is
flat for 96% of them -- the faceted read the source was built with, and the
one a toon ramp wants.

## PROCESS

`art/blend/` is gitignored and does not exist inside a worktree checkout, so
`SRC_DIR` is the absolute path in the main repo rather than being derived from
`REPO` -- `export_meshy_house.py` documents exactly this and its comment is
the pattern copied here.
"""
import json
import os
import sys
import colorsys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

from dimetric import metres_per_unit  # noqa: E402
import kit as building_kit  # noqa: E402 -- tools/buildings/kit.py, ROLES

REPO = os.path.dirname(TOOLS)

# `art/blend/` is gitignored (blanket rule, too large for git) and therefore
# does not exist inside a worktree checkout at all -- these sources live only
# in the main repo's own local, untracked working directory. NOT derived from
# REPO for that reason. Same note as export_meshy_house.py's own SRC_DIR.
SRC_DIR = "/Users/ilpinto/dev/roaring-lions/art/blend/KDF/KDF camp"
SRC_INTACT = os.path.join(SRC_DIR, "Meshy_AI_intact_field_camp_spl_0830174309_part-segmentation.blend")
SRC_DESTR = os.path.join(SRC_DIR, "Meshy_AI_destroyed_field_camp__0830174654_part-segmentation.blend")

#: Footprint this mesh is cut to, in tiles. `MESH_UNITS_PER_TILE` is 3.0, so
#: the intact model is scaled until its longest axis is FOOTPRINT_TILES * 3.0
#: GLB units. See module docstring "SCALE" for why 5 and not 4 or 6 -- the
#: sandbag crest lands on HESCO Bastion's real 1.37 m only at this value.
#: A mission author laying down a `k` block should lay down 5x5.
FOOTPRINT_TILES = 5.0
MESH_UNITS_PER_TILE = 3.0
REAL_METRES_CAMP = FOOTPRINT_TILES * MESH_UNITS_PER_TILE  # 15.0

#: The wreck's own mpu, as a fraction of the intact's. NOT 1.0 -- see the
#: module docstring's "SCALE" section, which is the longest one in this file
#: for a reason. Derived as intact_ring_line / wreck_ring_line, both measured
#: as the median Chebyshev radius of the perimeter family's centroids.
WRECK_RATIO = 0.13749 / 0.22855  # 0.601575

#: Horizontal aspect ratio at or above which a tail object is a plank, a
#: batten, a stake or a guy line rather than a crate or a sack -- the one
#: measured parameter separating `wood` from `wall` in the un-named remainder.
LONG_AR = 4.0

#: Ground-pad detection (module docstring "THE GROUND PAD IS DELETED"). A pad
#: spans most of the compound and is essentially flat; nothing else in either
#: source comes near -- the next largest interior object is 0.58 ring-radii.
PAD_MIN_SPAN_R = 1.5
PAD_MAX_THICK_R = 0.03

#: Perimeter test: an object whose centroid sits at or beyond this fraction of
#: the ring line is part of the ring rather than the interior.
RING_BAND = 0.88

#: Hue bucket -> role, per file. EVERY entry was identified by rendering that
#: family in isolation (see module docstring "ROLE SPLIT"); a hue index carries
#: no material meaning on its own, which is what `_assert_census` guards.
INTACT_FAMILY_ROLES = {
    0: "wall",    # sandbag/HESCO ring, corner revetment, ladder frame
    4: "wall",    # command tent, cots, sacks -- canvas
    21: "wall",   # shipping-container stack -- see CONTAINERS_ARE_WALL
    14: "metal",  # comms mast, dish, guy wires, generator, drums
}
WRECK_FAMILY_ROLES = {
    0: "wall",    # collapsed sandbag ring
    23: "wall",   # flattened tent canopies + rubble
    4: "wall",    # collapsed command tent
    21: "wall",   # wrecked container stack -- see CONTAINERS_ARE_WALL
    18: "metal",  # broken mast pieces and poles
    17: "metal",  # broken poles
    12: "metal",  # broken spars / guy lines
}

#: Why the container stack is `wall` and not `metal`, recorded because the
#: opposite is the intuitive choice and was in fact built first.
#:
#: `metal` is `sliceFrom('gunmetal', 2)` = #5C625F -> #363B39, a two-step dark
#: steel. On the mast, the dish and the guy wires that is exactly right: thin
#: geometry reading as dark line-work against the olive. On the two-high
#: container stack -- the second-largest mass in the compound -- it is not. A
#: palette preview at the locked dimetric angle (elevation 30, azimuth 225)
#: showed the stack as a black void punched through the middle of the camp,
#: and the collapsed stack in the wreck worse still, because the rubble around
#: it is olive and the block is not. The value separation gained was not worth
#: the hole.
#:
#: `wall` costs the container its material distinction from canvas and
#: sandbag -- all three now share the one olive ramp, which is the flat read
#: this task's inspection warned about. That trade is accepted deliberately:
#: an olive CONEX in a KDF camp is honest, the box's hard silhouette still
#: separates it from the peaked tent behind it at equal value, and KDF olive
#: is what this asset is FOR. The real fix for the flat read is a per-type
#: role palette in `building-mesh-role.ts` mirroring what vehicles already do
#: per-vehicle; that is a `packages/render` change and out of scope for an art
#: drop.
CONTAINERS_ARE_WALL = True

#: (objects, verts) each mapped family MUST still have. A regenerated source
#: would keep the hue indices meaningful-looking while meaning something else
#: entirely; this is what makes that fail loudly instead of silently painting
#: the tents in gunmetal. See module docstring "ROLE SPLIT".
INTACT_CENSUS = {0: (253, 2262), 4: (27, 315), 14: (26, 265), 21: (16, 143)}
WRECK_CENSUS = {0: (216, 1833), 23: (43, 436), 4: (3, 100), 21: (25, 171),
                18: (14, 117), 17: (12, 82), 12: (9, 60)}

#: The ring line each file's WRECK_RATIO/landmark maths was measured against,
#: re-derived per run and checked against these. If a source is swapped these
#: move, and every scale number in the docstring is void.
INTACT_RING_LINE = 0.13749
WRECK_RING_LINE = 0.22855
RING_TOL = 0.002

#: The `wall` role is the ONLY building role whose colour comes from the
#: structure type rather than from `BUILDING_ROLE_PALETTE`
#: (`packages/render/src/three/units/building-mesh-role.ts`). For the KDF
#: olive this asset is FOR, `data/structures.json`'s `camp.color` must be
#: `"olive.0"` -- with no entry the mesh gate falls back to a limestone key and
#: the camp renders as a civilian building. This script cannot set it; the
#: report carries the entry.
WALL_COLOUR_NOTE = "camp.color must be olive.0 in data/structures.json"

CREDIT = (
    "KDF field camp (standing + destroyed) -- AI-generated (Meshy), disclosed "
    "per CONTRIBUTING.md; role-split, re-scaled and joined for Roaring Lions"
)

_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--out-dir" in _argv:
    OUT_DIR = _argv[_argv.index("--out-dir") + 1]
else:
    OUT_DIR = os.path.join(REPO, "art", "meshes", "buildings")
OUT_IDLE = os.path.join(OUT_DIR, "camp.glb")
OUT_WRECK = os.path.join(OUT_DIR, "camp_wreck.glb")


def _meshes():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def _world_verts(ob):
    return [ob.matrix_world @ v.co for v in ob.data.vertices]


def _object_colour(ob):
    """This object's flat part-segmentation colour, averaged over its own
    corner colours. Uniform per object on both sources (measured spread 0.0),
    so the average IS the part colour rather than a summary of a gradient."""
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


def _hue_family(ob):
    """24 hue buckets. Meshy jitters the per-part colour -- 371 objects carry
    139 distinct exact colours -- so exact colour over-segments and hue
    buckets recover the real part grouping. See module docstring."""
    colour = _object_colour(ob)
    if colour is None:
        return None
    hue, _light, _sat = colorsys.rgb_to_hls(*colour)
    return round(hue * 24) % 24


def _ring_line(objs):
    """Median Chebyshev radius of the perimeter family's centroids -- the
    rotation-invariant ground-plan measurement both mpus rest on. See module
    docstring "SCALE"."""
    radii = []
    for ob in objs:
        pts = _world_verts(ob)
        cx = sum(p.x for p in pts) / len(pts)
        cy = sum(p.y for p in pts) / len(pts)
        radii.append(max(abs(cx), abs(cy)))
    radii.sort()
    return radii[len(radii) // 2]


def _drop_ground_pad(label, ring):
    """Delete the flat plane the intact source draws under the whole compound
    -- by measurement, not by name (see module docstring). Returns how many it
    removed; the caller asserts that count, so a rule that matches nothing, or
    matches a tent, fails the run rather than shipping a z-fighting pad."""
    removed = []
    for ob in list(_meshes()):
        pts = _world_verts(ob)
        if len(pts) < 3:
            continue
        dx = max(p.x for p in pts) - min(p.x for p in pts)
        dy = max(p.y for p in pts) - min(p.y for p in pts)
        dz = max(p.z for p in pts) - min(p.z for p in pts)
        if dx > PAD_MIN_SPAN_R * ring and dy > PAD_MIN_SPAN_R * ring and dz < PAD_MAX_THICK_R * ring:
            removed.append(ob.name)
            bpy.data.objects.remove(ob, do_unlink=True)
    print(f"[{label}] ground pad removed: {removed}")
    return len(removed)


def _assert_census(label, families, expected):
    for hue, (n_obj, n_vert) in sorted(expected.items()):
        objs = families.get(hue, [])
        got = (len(objs), sum(len(o.data.vertices) for o in objs))
        if got != (n_obj, n_vert):
            raise SystemExit(
                f"[{label}] hue family {hue} census changed: expected "
                f"{n_obj} objects / {n_vert} verts, found {got[0]} / {got[1]}. "
                f"The hue -> role table in this file was verified against the "
                f"named sources by isolation render and is meaningless against "
                f"a regenerated one -- re-derive it, do not adjust this number."
            )
    print(f"[{label}] census OK for {sorted(expected)}")


def _tail_role(ob):
    """`wood` for a long thin member (plank, batten, stake, guy line), `wall`
    for a compact one (crate, sack, sandbag, jerry can). The one measured
    parameter in the un-named remainder -- see LONG_AR."""
    pts = _world_verts(ob)
    dx = max(p.x for p in pts) - min(p.x for p in pts)
    dy = max(p.y for p in pts) - min(p.y for p in pts)
    lo = max(min(dx, dy), 1e-9)
    return "wood" if max(dx, dy) / lo >= LONG_AR else "wall"


def _assign_roles(label, family_roles, census, expect_ring, expect_pads):
    """Returns {role: [objects]} for the currently-open file, after deleting
    the ground pad. Reads the Color attribute BEFORE anything strips it."""
    families = {}
    for ob in _meshes():
        families.setdefault(_hue_family(ob), []).append(ob)
    _assert_census(label, families, census)

    ring_objs = families.get(0, [])
    ring = _ring_line(ring_objs)
    if abs(ring - expect_ring) > RING_TOL:
        raise SystemExit(
            f"[{label}] ring line {ring:.5f} != expected {expect_ring:.5f} "
            f"(tol {RING_TOL}) -- every scale number in this file's docstring "
            f"was measured against that ring; re-derive them."
        )
    print(f"[{label}] ring line {ring:.5f} (expected {expect_ring:.5f})")

    n_pads = _drop_ground_pad(label, ring)
    if n_pads != expect_pads:
        raise SystemExit(f"[{label}] expected {expect_pads} ground pad(s), removed {n_pads}")

    roles = {}
    for ob in _meshes():
        role = family_roles.get(_hue_family(ob)) or _tail_role(ob)
        if role not in building_kit.ROLES:
            raise SystemExit(f"[{label}] role {role!r} outside kit.py ROLES {building_kit.ROLES}")
        roles.setdefault(role, []).append(ob)
    for role, objs in sorted(roles.items()):
        print(f"[{label}] role {role}: {len(objs)} objects, "
              f"{sum(len(o.data.vertices) for o in objs)} verts")
    return roles


def _join_by_role(label, roles):
    """371 objects -> one mesh per role. THE optimisation for this asset (see
    module docstring): there is no decimation to do, only draw calls to fold."""
    joined = {}
    for role, objs in sorted(roles.items()):
        bpy.ops.object.select_all(action="DESELECT")
        for ob in objs:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        target = bpy.context.view_layer.objects.active
        target.name = role
        target.data.name = role
        joined[role] = target
        print(f"[{label}] joined {len(objs)} -> {role} "
              f"({len(target.data.vertices)} verts, {len(target.data.polygons)} polys)")
    return joined


def _strip_colour_and_split_normals(label, ob):
    """Drop the Color layer and the baked custom split normals.

    NOT followed by `shade_smooth()`, unlike export_meshy_jeep.py's own
    helper -- see module docstring "SHADING". This is a hard-surface low-poly
    model and smoothing it would round every sandbag block into a blob."""
    while ob.data.color_attributes:
        ob.data.color_attributes.remove(ob.data.color_attributes[0])
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"[{label}] {ob.name}: stripped vertex colour + custom split normals (left flat-shaded)")


def _bake_scale_and_ground(label, objs, mpu):
    """Bake model-units -> metres, then a ground shift so this file's own
    lowest vertex lands at z=0.

    NO rotation and NO XY shift, unlike export_meshy_house.py -- both were
    measured to be already correct on both files (module docstring
    "ORIENTATION"). The ground shift is still applied and PRINTED rather than
    skipped, so "already at grade" is re-verified per run."""
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

    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    print(f"[{label}] mpu={mpu:.4f} ground shift {-zmin:+.6f} (post-scale units)")
    print(f"[{label}] final extent x={max(xs)-min(xs):.3f} y={max(ys)-min(ys):.3f} "
          f"z={max(zs)-min(zs):.3f} units "
          f"({(max(xs)-min(xs))/MESH_UNITS_PER_TILE:.2f} x "
          f"{(max(ys)-min(ys))/MESH_UNITS_PER_TILE:.2f} tiles), "
          f"xy centre ({(max(xs)+min(xs))/2:+.4f}, {(max(ys)+min(ys))/2:+.4f}), zmin {min(zs):+.5f}")


def _finalize_and_export(label, role_objs, out_path):
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


def _drop_non_meshes(label):
    """Remove the source's empties. `export_scene.gltf` with
    `use_selection=False` exports every OBJECT in the scene, so an empty
    survives as a mesh-less glTF node -- 4 of them on the intact source, 1 on
    the wreck, caught by parsing the first export rather than assumed absent.
    Harmless to the renderer (`buildBuildingMeshTemplate` traverses and skips
    anything that is not `isMesh`) but it is noise in a file whose whole
    contract is "one node per role"."""
    dropped = [o.name for o in bpy.data.objects if o.type != "MESH"]
    for name in dropped:
        bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
    print(f"[{label}] dropped {len(dropped)} non-mesh object(s): {dropped}")


def _one(label, src, family_roles, census, expect_ring, expect_pads, mpu, out_path):
    bpy.ops.wm.open_mainfile(filepath=src)
    _drop_non_meshes(label)
    for ob in _meshes():
        if ob.modifiers:
            raise SystemExit(f"[{label}] {ob.name} carries {len(ob.modifiers)} modifier(s)")
    roles = _assign_roles(label, family_roles, census, expect_ring, expect_pads)
    joined = _join_by_role(label, roles)
    for ob in joined.values():
        _strip_colour_and_split_normals(label, ob)
    _bake_scale_and_ground(label, list(joined.values()), mpu)
    return _finalize_and_export(label, joined, out_path)


def export():
    # The intact source's own longest axis-aligned extent, matching
    # export_meshy_tank.py's `_extent_of` convention and metres_per_unit's own
    # "real_metres is the unit's longest dimension on any axis".
    bpy.ops.wm.open_mainfile(filepath=SRC_INTACT)
    pts = [o.matrix_world @ v.co for o in _meshes() for v in o.data.vertices]
    extent = max(max(p.x for p in pts) - min(p.x for p in pts),
                 max(p.y for p in pts) - min(p.y for p in pts),
                 max(p.z for p in pts) - min(p.z for p in pts))
    mpu = metres_per_unit(extent, REAL_METRES_CAMP)
    mpu_wreck = mpu * WRECK_RATIO
    print(f"[camp] intact extent {extent:.5f} model units -> {REAL_METRES_CAMP:.1f} units "
          f"({FOOTPRINT_TILES:.0f}x{FOOTPRINT_TILES:.0f} tiles), mpu {mpu:.4f}")
    print(f"[camp] wreck mpu {mpu_wreck:.4f} = mpu x {WRECK_RATIO:.6f} "
          f"-- NOT the intact's; see module docstring \"SCALE\"")
    print(f"[camp] {WALL_COLOUR_NOTE}")

    idle = _one("camp", SRC_INTACT, INTACT_FAMILY_ROLES, INTACT_CENSUS,
                INTACT_RING_LINE, 1, mpu, OUT_IDLE)
    wreck = _one("camp_wreck", SRC_DESTR, WRECK_FAMILY_ROLES, WRECK_CENSUS,
                 WRECK_RING_LINE, 0, mpu_wreck, OUT_WRECK)

    summary = {
        "footprint_tiles": FOOTPRINT_TILES,
        "mpu": mpu,
        "mpu_wreck": mpu_wreck,
        "wreck_ratio": WRECK_RATIO,
        "idle": {"path": OUT_IDLE, "bytes": idle[0], "verts": idle[1], "polys": idle[2], "roles": idle[3]},
        "wreck": {"path": OUT_WRECK, "bytes": wreck[0], "verts": wreck[1], "polys": wreck[2], "roles": wreck[3]},
    }
    print("SUMMARY_JSON " + json.dumps(summary))


if __name__ == "__main__":
    export()
