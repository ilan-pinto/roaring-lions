#!/usr/bin/env python3
"""
Roaring Lions -- Phase G mesh art gate.

`validate_assets.py`'s own docstring explains the four checks it runs on
rendered sprites: PALETTE, RESERVED, ALPHA and SILHOUETTE. That gate never
looks at `art/meshes/` -- it walks PNGs, and a mesh produces none. This
script is the missing half: it renders every mesh headlessly at the locked
dimetric angle (`tools/render_mesh_gate.py`, run inside Blender, which see
for how and why), then runs the SAME checks against the result by importing
`validate_assets.py` and calling its own functions -- not a second
implementation of palette or IoU maths that could quietly disagree with the
sprite gate's.

    python3 tools/validate_mesh_assets.py
    python3 tools/validate_mesh_assets.py --out /tmp/mesh-renders   # keep the renders
    python3 tools/validate_mesh_assets.py --blender /path/to/blender

## What is compared against what, and why

Two comparisons, run separately, because they answer different questions:

1. **Palette / reserved-band / alpha-binary / framing**, per rendered mesh,
   exactly as `validate_assets.check_image` and `check_framing` already
   define them. A raw Cycles render is continuous, not quantized -- every
   other Blender output in this pipeline
   (`render_team.py`, `render_eitan.py`, `render_vehicle.py`) goes through
   `quantize_sprites.py` before the art gate ever sees it, and this script
   does the same rather than inventing a looser rule for meshes.

2. **Silhouette IoU**, at gameplay zoom, comparing a mesh's representative
   pose against:
     - every OTHER mesh's representative pose, and
     - every OTHER unit's shipped billboard sprite (`assets/sprites/`),

   deliberately EXCLUDING one pairing: a mesh against the billboard sprite of
   the SAME unit id. The whole point of the IoU gate is to stop two
   DIFFERENT units reading as the same thing in a fight -- a unit and its own
   art, mid-migration from sprite to mesh, are not two units, and are
   *supposed* to read alike; comparing them would fail the gate for doing
   its job correctly. Two different units drawing as a mesh and a sprite
   respectively can absolutely appear on screen together (only `inf_squad`
   currently ships as a mesh in-game -- CLAUDE.md, "The three.js backend" --
   and Phase F migrates one type at a time), so that cross-comparison is the
   one this gate actually exists to add; sprite-vs-sprite is already
   `validate:assets`'s job and is not repeated here.

   "Own sprite" is resolved two ways: for an infantry team, from
   `tools/units/teams.py`'s own `TEAMS` registry (`team_id -> (.., faction,
   sheet)`), read at runtime rather than copied, so a team rename there is
   picked up here automatically -- but read on the BLENDER side
   (`render_mesh_gate.py`, inside the same process that already needs it for
   faction), not here: `teams.py` imports `tools/units/kit.py`, which imports
   `bpy` at module scope, so `import teams` raises `ModuleNotFoundError` in
   this script's own plain-`python3` process. (This was tried and silently
   returned nothing for every team, defeating the exclusion entirely, before
   being caught -- see the report.) `render_mesh_gate.py` prints one
   `MESH_GATE_SHEET: <unit_id> <sheet>` line per team instead, and
   `render_meshes()` below parses it. A vehicle mesh has no equivalent
   registry to read at all (`tools/export_mesh_vehicle.py`'s own per-vehicle
   spec is not importable here either -- see `render_mesh_gate.py`'s
   docstring for why), so `VEHICLE_OWN_SPRITES` below is a small hand-kept
   table, covering the vehicle meshes that ship today. A new vehicle mesh
   with no entry here does not go unchecked -- it still gets every check
   above, including mesh-vs-sprite IoU -- it only loses the courtesy
   exclusion against its own sprite, which would read as a spurious
   "collision" against itself until an entry is added.

Never adjusts `IOU_LIMIT` or `MIN_FILL` to make a result pass -- both are
imported from `validate_assets.py`, not redeclared, so there is nowhere here
to move them even by accident.

## Decor is checked a THIRD way, and never rendered by this gate at all

## Buildings are checked a FOURTH way, also against the raw bytes

`tools/building_facing.py` (GH-142) answers a question no render this gate
makes could: of a building's four elevations, is the one carrying its
facade among the two the game's fixed dimetric camera can SEE. The rendered
PNG above is one locked pose, and a building's whole orientation problem is
which side that pose is of. A building never turns at runtime
(`mesh-building.ts`: "leaves rotation at identity"), so the answer is baked
at export and, until this, was checked by nothing at all -- house and
apartment were correct because two export scripts measured it by hand and
said so in prose. That was harmless while buildings were palette-painted
boxes with no picture on any face, and stopped being harmless at `d63cd36`,
when three of them started shipping a photographed facade. See that
module's docstring for what it measures, what it deliberately does not, and
why the shipped `warehouse` is allowed to have no front.

## Vehicles are checked a FIFTH way, also against the raw bytes

Every `art/meshes/vehicles/*.glb` carries a WRECK -- a `death_root` node of
static `WRECK_*` children sharing their live twins' meshes, plus the two
clips `idle` and `wreck` that scale one half to zero and the other to one
(`docs/superpowers/specs/2026-09-14-vehicle-wreck-design.md` §4.1, written
by `pnpm wreck:meshes`). `check_vehicle_wrecks` below reads that contract
straight out of the glTF JSON, for the same reason the decor and facing
checks read bytes: the render this gate makes cannot see it. The live render
deliberately HIDES the death root (`render_mesh_gate.py`'s
`hide_death_root`, so the palette/framing/silhouette checks keep judging the
live vehicle), so a file that lost its wreck would render identically and
pass every pixel check here while a destroyed vehicle drew nothing in the
game.

The failure this exists to catch is quiet in both directions. A re-export
that skips the pass produces a GLB that LOADS fine -- `buildVehicleMeshTemplate`
is happy with zero animations, `instantiateVehicleMesh` allocates no mixer,
and the only symptom is a vehicle that vanishes at t=0, which is exactly the
bug the wreck was built to fix. And a half-applied pass (a death root whose
children reference their own COPIES of the geometry rather than the live
meshes) costs 1.6-3.4 MiB per file with nothing on screen to show for it.
Both are invisible to a picture; both are one `!=` away in the JSON.

Both trees are read, not one: `art/meshes/vehicles/` and the Draco mirror
`assets/meshes/vehicles/`. The mirror is the artefact a browser downloads,
no other gate parses its node graph, and `pnpm encode:meshes -- --check`
compares hashes -- it proves the mirror matches the source it was made from,
which is not the same as proving the encoder carried the contract across.

## And a SIXTH way: the wreck is rendered and judged, not only parsed

`render_mesh_gate.render_vehicle_wreck` takes a second photograph of every
vehicle -- the death root alone, through the camera the LIVE pose was framed
with -- and `load_mesh_masks` reads it back beside the live mask. Two checks
run on it, `check_wreck_distinct` and `check_wreck_collisions`, and they
answer the one question the bytes cannot: the contract above is entirely
satisfied by a recipe that displaced NOTHING, which ships a vehicle that
explodes into an identical copy of itself. Holding the two masks to one
camera is what makes that measurable, and the floor (`WRECK_MIN_DISTINCT`)
is taken from the eleven shipped results rather than guessed -- the
derivation and all eleven numbers are written beside the constant, and it is
RE-DERIVED whenever the recipe is tuned, because a floor calibrated against
poses that no longer ship is measuring nothing in particular.

A third check runs first and is easy to miss the point of:
`check_wreck_census` compares the wreck renders that EXIST against the
vehicle directory. Both checks above iterate `wreck_masks`, so a vehicle
whose wreck render never happened is checked zero times by either of them
and the only trace is a smaller count on the passing line.

Charring is NOT checked by any of it and cannot be: it is a runtime
treatment of anything marked `rl_wreck` (spec §4.3), applied by the
renderer's material path, and this gate repaints every vehicle from the
palette tables before rendering -- the wreck children carry their live
twins' `rl_role`, so they come out in the LIVING colours. What is judged is
the wreck's SHAPE. The passing path says both halves out loud, the way the
`NOT palette-checked` lines do for textured buildings.

`art/meshes/decor/*.glb` (scattered terrain props -- `docs/superpowers/plans/
2026-09-01-terrain-c-mesh-decor.md`, Task 4) skips `render_mesh_gate.py`
entirely: that script's own `render_one` returns early for `mesh_kind() ==
'decor'`, the same early-return `vfx` already gets, and for the same reason
given there -- a rock or a grass tuft is not a unit, has no faction, and the
"does this collide in silhouette with some OTHER unit" question this gate's
whole IoU apparatus exists to answer has no meaning for it. So there is no
rendered PNG to run `check_image`/`silhouette` against, and `check_decor_meshes`
below checks the one thing that DOES apply to decor -- the mesh contract
itself (zero materials, zero images, zero textures, every mesh node's
`extras.rl_role` inside the closed `{foliage, trunk, rock, sand}` set from
`packages/render/src/three/terrain/decor-role.ts`) -- directly against the
raw GLB bytes, the same minimal JSON-chunk parse `render_mesh_gate.py`'s own
`read_glb_json` uses, copied rather than imported because that module opens
with `import bpy` and cannot load in this plain-`python3` process. An empty
`art/meshes/decor/` (the state before Task 4 lands any asset) is not a
failure -- `glob` returning nothing means zero iterations, zero failures.
"""
import argparse
from collections import Counter
import glob
import itertools
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# Building types that ship their OWN baked material instead of being
# repainted from the palette -- the project lead's explicit override of the
# mesh contract's "a GLB carries zero materials" rule:
#
#     "i have provided a very detailed blender files and i want them to be
#      used as is unless ill provide other instruction."
#
# Must stay in step with `TEXTURED_BUILDING_TYPES` in
# `packages/render/src/three/units/textured-building.ts`. The two are pinned
# against each other by `textured-building.test.ts`, which parses THIS set
# out of THIS file -- so adding a type on one side and not the other fails
# `pnpm test` rather than silently un-gating a check.
#
# WHY AN EXEMPTION IS NEEDED AT ALL, given the gate passes without one. It
# passes for the wrong reason: `render_mesh_gate.py`'s `apply_building_
# materials` REPAINTS every building mesh from the palette before rendering
# it, so a textured GLB is checked as a palette-painted stand-in for itself
# and `check_image` can only ever agree. Left alone, this gate would go on
# reporting these three as palette-conformant while the game draws a
# photograph -- a green check on a thing it is not looking at. Skipping the
# check and SAYING SO is the honest state; weakening the check for every
# building to accommodate three would be the dishonest one.
#
# What is skipped: the palette-conformance, framing and minimum-fill checks
# (`check_image`, `check_framing`, `MIN_FILL`). What still runs: the
# silhouette IoU comparison against every other mesh and sprite -- a textured
# building must still not read as some other building.
TEXTURED_BUILDING_EXEMPT = {"house", "apartment", "warehouse", "clinic", "hall", "fence"}

# 2026-09-07: the identical override, extended by the project lead to six
# supplied Meshy VEHICLES -- `mbt_lavi`, `ifv_namer`, `technical`,
# `rocket_battery`, `paramotor`, `heli_peten`. Kept as its OWN set, pinned
# against `TEXTURED_VEHICLE_TYPES` in
# `packages/render/src/three/units/textured-vehicle.ts` by
# `textured-vehicle.test.ts`, exactly as `TEXTURED_BUILDING_EXEMPT` is pinned
# against `TEXTURED_BUILDING_TYPES` by `textured-building.test.ts` -- kept
# SEPARATE from that set (rather than one shared list) so neither pinning
# test has to filter the other asset class's names out of its own exact-match
# assertion. `jeep_shoded` joined on 2026-09-07 (evening) when its textured
# pass was supplied. Two vehicle sources ship no base_color bake at all
# (`dozer_d9`, the `KDF camp` prop) and are deliberately absent here -- there
# is no photograph to ship for those, and they still take
# `apply_vehicle_materials`'s/`rampForVehicleRole`'s palette path unchanged.
TEXTURED_VEHICLE_EXEMPT = {
    "mbt_lavi", "ifv_namer", "technical", "rocket_battery", "paramotor", "heli_peten",
    "jeep_shoded",
}

# The union `textured_exempt` below actually checks against -- a mesh's
# palette exemption does not care which asset class it is.
TEXTURED_MESH_EXEMPT = TEXTURED_BUILDING_EXEMPT | TEXTURED_VEHICLE_EXEMPT


def textured_exempt(unit_id):
    """True if `unit_id` (or its living form, for a `_wreck` variant) ships
    its own material. Mirrors `own_sprite_dirs`' own `_wreck` stripping."""
    base = unit_id[:-len("_wreck")] if unit_id.endswith("_wreck") else unit_id
    return base in TEXTURED_MESH_EXEMPT
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "units"))

import validate_assets as va  # noqa: E402
import quantize_sprites as qs  # noqa: E402
import building_facing as bf  # noqa: E402

DEFAULT_BLENDER_CANDIDATES = (
    os.environ.get("BLENDER_BIN", ""),
    "blender",
    "/Applications/Blender.app/Contents/MacOS/Blender",
)

# unit_id -> the assets/sprites/ directory (or directories) that are this
# vehicle mesh's own retired art, excluded from the IoU comparison for the
# same reason a team's own sprite is -- see this module's docstring.
# tools/export_mesh_vehicle.py owns the real mapping; not imported here
# (see render_mesh_gate.py's docstring for why), so this is kept by hand.
# Extend it when a new vehicle mesh ships.
#
# Every vehicle mesh under art/meshes/vehicles/ is listed. The pairs are taken
# from `SPRITE_MAP` in packages/app/src/main.ts -- the RUNTIME authority for
# which sheet a unit type draws with, so a mesh and the billboard it stands in
# for cannot disagree here -- and each one also matches the `out_hull` /
# `out_turr` its own tools/render_*.py writes. Sheets those scripts name but
# never write (`*_TURR_UNUSED`, for a vehicle whose weapon station is not
# separately modelled) are correctly absent.
#
# `apc_kipod` and `scout_shachaf` joined on 2026-09-15. Both shipped a mesh
# before they shipped a sheet, so neither had an entry to make; the sprite
# halves (`KIPOD_HULL`, `SHACHAF_HULL`) landed on 2026-09-14 with the
# special-unit sheets and nothing went back to close the exclusion. Until
# this they were comparing against their own retired art -- which is the one
# pairing this gate is documented not to make.
VEHICLE_OWN_SPRITES = {
    "apc_eitan": ("EITAN_HULL", "EITAN_TURR"),
    "apc_kipod": ("KIPOD_HULL",),
    "dozer_d9": ("D9_HULL",),
    "heli_peten": ("APACHE_HULL",),
    "ifv_namer": ("NAMER_HULL", "NAMER_TURR"),
    "jeep_shoded": ("JEEP_HULL",),
    "mbt_lavi": ("TNK_HULL", "TNK_TURR"),
    "paramotor": ("PARA_MOTOR",),
    "rocket_battery": ("ROCKETBATTERY_HULL",),
    "scout_shachaf": ("SHACHAF_HULL",),
    "technical": ("TECH_HULL", "TECH_TURR"),
}


def find_blender(explicit):
    candidates = (explicit,) + DEFAULT_BLENDER_CANDIDATES if explicit else DEFAULT_BLENDER_CANDIDATES
    for candidate in candidates:
        if not candidate:
            continue
        path = shutil.which(candidate) or (candidate if os.path.exists(candidate) else None)
        if path:
            return path
    return None


def render_meshes(blender_bin, out_dir):
    script = os.path.join(HERE, "render_mesh_gate.py")
    cmd = [blender_bin, "-b", "-P", script, "--", "--out", out_dir]
    proc = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, check=False)
    ok, warn, fail, sheets = [], [], [], {}
    for line in proc.stdout.splitlines():
        if line.startswith("MESH_GATE_OK: "):
            ok.append(line[len("MESH_GATE_OK: "):])
        elif line.startswith("MESH_GATE_WARN: "):
            warn.append(line[len("MESH_GATE_WARN: "):])
        elif line.startswith("MESH_GATE_FAIL: "):
            fail.append(line[len("MESH_GATE_FAIL: "):])
        elif line.startswith("MESH_GATE_SHEET: "):
            unit_id, sheet = line[len("MESH_GATE_SHEET: "):].rsplit(" ", 1)
            sheets[unit_id] = sheet
    return proc, ok, warn, fail, sheets


_STRUCTURE_IDS = None


def structure_ids():
    """Every building type id in data/structures.json -- pure data, safe to
    read from this plain-python process (unlike tools/units/teams.py, which
    is only importable inside Blender -- see own_sprite_dirs below)."""
    global _STRUCTURE_IDS
    if _STRUCTURE_IDS is None:
        with open(os.path.join(REPO, "data", "structures.json")) as fh:
            _STRUCTURE_IDS = set(json.load(fh)["types"])
    return _STRUCTURE_IDS


def own_sprite_dirs(unit_id, sheets):
    if unit_id in sheets:
        return (sheets[unit_id],)
    if unit_id in VEHICLE_OWN_SPRITES:
        return VEHICLE_OWN_SPRITES[unit_id]
    # A building mesh id is a data/structures.json type id, `_wreck` variants
    # included; its own sprite is assets/sprites/BLD_<ID>, uppercased --
    # tools/render_building.py's own out_dir convention. No separate wreck
    # sprite sheet exists in the current billboard roster, so a `_wreck` mesh
    # is excluded against the SAME BLD_<ID> its living form is.
    base_id = unit_id[:-len("_wreck")] if unit_id.endswith("_wreck") else unit_id
    if base_id in structure_ids():
        return (f"BLD_{base_id.upper()}",)
    return ()


def load_mesh_masks(out_dir, palette_path):
    """Quantize each render onto the palette (mirroring every other Blender
    output in this pipeline -- see module docstring), then run the same
    per-image checks `validate_assets.py` runs on a sprite.

    Returns (failures, masks, exempt, wreck_masks).

    `wreck_masks` is the second render `render_mesh_gate.render_vehicle_wreck`
    makes for every vehicle: the death root alone, through the camera the
    LIVE pose was framed with. It is loaded here so both masks come off the
    same `va.silhouette` at the same gameplay zoom, but it deliberately
    takes NEITHER `check_image` NOR `check_framing`, and the reasons are
    different for each:

      * `check_image` would be a tautology. The gate paints the wreck from
        the same `VEHICLE_ROLE_PALETTES` row as its live twin -- the wreck
        children carry their twins' `rl_role` -- so a wreck render is
        on-palette by construction exactly when the live render is, and the
        live render is already checked. The charring that WOULD make the two
        differ is a runtime material treatment this gate cannot see at all.

      * `check_framing` would be wrong, not merely redundant. It fails an
        image whose opaque pixels touch the frame edge, on the reasoning
        that the render camera cropped the subject -- true for a pose framed
        on its own bounds, false here by design. The camera is fitted to the
        LIVE vehicle and held, which is the only way `IoU(live, wreck)`
        means anything; a turret thrown ACROSS the hull (`TURRET_SHIFT`
        0.45 of its length, at right angles to the axis it runs along) or a
        collapsed canopy (`CANOPY_SHIFT` 0.6) is SUPPOSED to be able to
        leave that square. Cropping is what makes the two masks
        comparable here, so a check that forbids it would be reporting the
        method as a defect.

    What the wreck mask IS held to is the three checks below --
    `check_wreck_census`, `check_wreck_distinct` and
    `check_wreck_collisions` -- plus the `WRECK_MIN_FILL_RATIO` floor inside
    the second of them, which is a fraction of the unit's OWN live mask
    rather than of the frame. See that function for why an unfilled wreck is
    the one failure the distinctness check cannot see on its own, and
    `WRECK_MIN_FILL_RATIO` itself for why an absolute share of the frame was
    measuring the unit instead of the wreck.
    """
    failures = []
    masks = {}
    wreck_masks = {}
    exempt = []
    targets, _ = qs.load_targets(palette_path)
    allowed, reserved = va.load_palette(palette_path)

    paths = sorted(glob.glob(os.path.join(out_dir, "*", "idle_f00_000.png")))
    for path in paths:
        unit_id = os.path.basename(os.path.dirname(path))
        qs.quantize(path, targets, check_only=False)

        # See TEXTURED_MESH_EXEMPT above. The silhouette below still runs --
        # only the colour-facing checks are skipped, and they are skipped
        # rather than silently satisfied by the gate's own repaint.
        if textured_exempt(unit_id):
            exempt.append(unit_id)
        else:
            for e in va.check_image(path, allowed, reserved):
                failures.append(f"{unit_id}: {e}")
            for e in va.check_framing(path):
                failures.append(f"{unit_id}: {e}")

            mask = va.silhouette(path)
            fill = mask.sum() / float(mask.size)
            if fill < va.MIN_FILL:
                failures.append(
                    f"{unit_id}: silhouette fills {fill:.1%} of frame "
                    f"(min {va.MIN_FILL:.0%}) -- unreadable at gameplay zoom"
                )
            masks[unit_id] = mask
            continue

        masks[unit_id] = va.silhouette(path)

    for path in sorted(glob.glob(os.path.join(out_dir, "*", "wreck_f00_000.png"))):
        unit_id = os.path.basename(os.path.dirname(path))
        qs.quantize(path, targets, check_only=False)
        wreck_masks[unit_id] = va.silhouette(path)

    return failures, masks, exempt, wreck_masks


def load_sprite_masks(sprites_root):
    paths = va.sprite_paths(sprites_root)
    if not paths:
        return {}
    reps = va.representative(paths)
    reps = {u: p for u, p in reps.items() if not va.is_layer(p)}
    return {u: va.silhouette(p) for u, p in reps.items()}


def check_collisions(mesh_masks, sprite_masks, sheets):
    failures = []
    for (ua, ma), (ub, mb) in itertools.combinations(mesh_masks.items(), 2):
        score = va.iou(ma, mb)
        if score > va.IOU_LIMIT:
            failures.append(
                f"silhouette collision: {ua} (mesh) vs {ub} (mesh) IoU={score:.3f} "
                f"(limit {va.IOU_LIMIT:.2f}) -- these read as the same unit"
            )
    for mesh_id, ma in mesh_masks.items():
        own = set(own_sprite_dirs(mesh_id, sheets))
        for sprite_id, mb in sprite_masks.items():
            if sprite_id in own:
                continue
            score = va.iou(ma, mb)
            if score > va.IOU_LIMIT:
                failures.append(
                    f"silhouette collision: {mesh_id} (mesh) vs {sprite_id} (sprite) "
                    f"IoU={score:.3f} (limit {va.IOU_LIMIT:.2f}) -- these read as the same unit"
                )
    return failures


# How far a wreck's silhouette must move away from its own live pose, as a
# fraction: the check is `IoU(live, wreck) <= 1 - WRECK_MIN_DISTINCT`, so
# this is the floor on 1 - IoU. A recipe that displaced nothing scores an IoU
# of 1.000 and fails; the question this answers is where between there and
# the shipped results the line goes.
#
# MEASURED, not guessed, from the eleven shipped wrecks (this gate's own
# renders at GAMEPLAY_ZOOM, live and wreck through one camera). RE-DERIVED
# 2026-09-15 after the recipe was tuned against the screenshot sheet, by the
# same rule as the first derivation -- the numbers all moved, so re-using the
# old floor would have been keeping a threshold calibrated against poses that
# no longer ship:
#
#     rocket_battery 0.7710      scout_shachaf  0.6983
#     ifv_namer      0.7613      dozer_d9       0.6955
#     apc_kipod      0.7583      technical      0.6874
#     apc_eitan      0.7149      mbt_lavi       0.6479
#     jeep_shoded    0.7126      heli_peten     0.6010
#                                paramotor      0.0737
#
# (Before tuning: ifv_namer 0.8601, apc_kipod 0.8040, jeep_shoded 0.7777,
# apc_eitan 0.7775, dozer_d9 0.7580, technical 0.7528, rocket_battery 0.7407,
# mbt_lavi 0.7354, scout_shachaf 0.7276, heli_peten 0.5083, paramotor 0.0169.)
#
# The LARGEST is what the floor has to clear, because it is the least-changed
# wreck in the tree and therefore the one that decides whether anything
# shipped is too close to call: `rocket_battery` at 0.7710, whose distance
# from a no-op is 1 - 0.7710 = 0.2290. Allowing it a third of that as margin
# puts the threshold at 0.7710 + 0.2290/3 = 0.8473, so the floor is
# 1 - 0.8473 = 0.1527, rounded DOWN to 0.152 (threshold 0.848, margin 0.0770
# against the 0.0763 the rule asks for).
#
# Two things the spread is worth reading for before anyone retunes it again.
# Which vehicle is tightest CHANGED with the tuning, from `ifv_namer` to
# `rocket_battery`, so "measure the tightest one first" means re-measuring
# which one that is rather than reaching for the name written down last time.
# And the two outliers are not better wrecks, they are different ones:
# `heli_peten` leans and cannot do more (`BODY_ROLL_DEG`'s own comment has the
# geometry) and `paramotor` throws its canopy 0.6 of the vehicle's length
# clear, which is why its wreck barely overlaps its live pose at all.
WRECK_MIN_DISTINCT = 0.152

# The wreck's own minimum fill, as a fraction of its LIVE twin's -- not an
# absolute share of the frame.
#
# The failure this exists to catch is a wreck render that came back (almost)
# empty, which `check_wreck_distinct` cannot see on its own: that check gets
# EASIER as the render empties and an empty mask scores a perfect IoU of
# 0.000. It is not hypothetical -- it is exactly what this gate produced on
# its first run, before `render_vehicle_wreck` learned to undo the scale-zero
# the importer's `idle` clip leaves on the death root.
#
# It was `va.MIN_FILL` (6% of the frame, absolute) until 2026-09-15, and that
# was the wrong shape for two reasons. The wreck is framed on its LIVE twin's
# bounds, so how much of the square it fills is mostly a fact about the unit,
# not about the wreck: `paramotor` sat at 7.7% against a live pose of 8.4%,
# 1.7 points clear of the floor, so a canopy retune that pushed the wing
# further out of frame would have failed on FILL and reported "a wreck that
# renders almost nothing" when the real cause was "a wreck that left the
# square". Measured against its own twin it is a ratio, and the ratio is
# stable across the whole fleet where the absolute fill is not.
#
# MEASURED, the eleven tuned wrecks' fill as a fraction of their own live
# fill: 0.944 (rocket_battery), 0.986 (paramotor), 1.002, 1.017, 1.043,
# 1.045, 1.092, 1.128, 1.159, 1.191, 1.197 (mbt_lavi). Nine of the eleven
# come out ABOVE 1.0, which is the tuning working -- a canted hull with its
# turret thrown clear covers more of the frame than the parade pose did.
# The smallest is 0.944; a margin of a third of its distance from the 0.000
# an empty render scores puts the floor at 0.944 - 0.315 = 0.629, rounded
# DOWN to 0.60. That leaves a re-tuned canopy 37% of its mask to lose before
# it trips, and still fails an empty render by the whole width of the band.
WRECK_MIN_FILL_RATIO = 0.60


def check_wreck_census(wreck_masks, vehicles_root):
    """Every shipped vehicle must have PRODUCED a wreck render, not merely
    have passed the checks on the renders that exist.

    `load_mesh_masks` builds `wreck_masks` by globbing
    `<out>/<unit>/wreck_f00_000.png`, and both wreck checks iterate that
    dictionary -- so a vehicle whose wreck render never happened is checked
    ZERO times and the gate says nothing at all about it. Every way that can
    happen is a real failure that this file is otherwise blind to: the
    Blender side raised and its FAIL line named a different stage, the vehicle
    branch never ran because `mesh_kind` classified the file somewhere else,
    or `render_vehicle_wreck` returned early. The count printed on the passing
    path would simply have been smaller, and a smaller number reads like a
    smaller fleet.

    The census is the directory itself -- every `art/meshes/vehicles/*.glb` --
    rather than `WRECK_RECIPES`, which is TypeScript this script cannot read,
    or a list here, which would be the `SPRITE_MAP` hazard a third time.
    """
    census = {
        os.path.splitext(os.path.basename(p))[0]
        for p in glob.glob(os.path.join(vehicles_root, "*.glb"))
    }
    missing = sorted(census - set(wreck_masks))
    if not missing:
        return []
    return [
        f"{unit_id}: no wreck render was produced, so neither wreck check looked at this "
        f"vehicle at all -- {os.path.relpath(vehicles_root, REPO)}/{unit_id}.glb is in the "
        f"tree and `wreck_f00_000.png` is not; see render_mesh_gate.render_vehicle_wreck"
        for unit_id in missing
    ]


def check_wreck_distinct(mesh_masks, wreck_masks):
    """A wreck must not read as its own live vehicle.

    This is the check that makes the whole wreck pass falsifiable. The recipe
    (`tools/src/meshes/wreck-recipes.ts`) is a table of fractions, and a
    fraction set to zero -- by a bad merge, by a retune that went the wrong
    way, by a vehicle whose bounds measured wrong so every fraction of them
    is ~0 -- produces a `death_root` full of parts sitting exactly where the
    live ones are. That file still carries the death root, still carries both
    clips, still shares every mesh, and passes `check_vehicle_wrecks` clause
    for clause. What the player gets is a vehicle that explodes into an
    identical copy of itself.

    Both masks come from ONE camera (`render_vehicle_wreck` does not reframe),
    so `IoU` here is comparing two poses and not two croppings, and a no-op
    recipe scores exactly 1.000.

    The fill clause is the other half and it is not decoration: this check's
    own comparison gets EASIER as the wreck render gets emptier, and a wreck
    that rendered nothing at all scores IoU 0.000 -- a perfect pass for the
    worst possible defect. That is not hypothetical; it is exactly what this
    gate produced on its first run, before `render_vehicle_wreck` learned to
    undo the scale-zero the importer's `idle` clip leaves on the death root.
    The floor is `WRECK_MIN_FILL_RATIO` of the unit's OWN live mask rather
    than an absolute share of the frame -- see that constant for why the
    absolute form was measuring the unit and not the wreck.
    """
    failures = []
    limit = 1.0 - WRECK_MIN_DISTINCT
    for unit_id, wreck in sorted(wreck_masks.items()):
        live = mesh_masks.get(unit_id)
        if live is None:
            failures.append(
                f"{unit_id}: a wreck render exists with no live render beside it -- there is "
                f"nothing to compare it against"
            )
            continue
        live_fill = live.sum()
        ratio = (wreck.sum() / float(live_fill)) if live_fill else 0.0
        if ratio < WRECK_MIN_FILL_RATIO:
            failures.append(
                f"{unit_id}: wreck silhouette covers {ratio:.0%} of its own live mask "
                f"(min {WRECK_MIN_FILL_RATIO:.0%}; {wreck.sum():,} px against {live_fill:,}) -- a "
                f"wreck that renders (almost) nothing scores a perfect distinctness IoU, so this "
                f"floor is what stops the check below passing for the worst reason there is"
            )
        score = va.iou(live, wreck)
        if score > limit:
            failures.append(
                f"{unit_id}: wreck reads as its own live pose, IoU={score:.4f} "
                f"(limit {limit:.3f}, i.e. it must differ by at least "
                f"{WRECK_MIN_DISTINCT:.3f}) -- the recipe in "
                f"tools/src/meshes/wreck-recipes.ts displaced (almost) nothing, so a "
                f"destroyed vehicle would look exactly like a live one"
            )
    return failures


def check_wreck_collisions(wreck_masks, mesh_masks, sprite_masks, sheets):
    """A wreck must not read as some OTHER unit, against the same
    `IOU_LIMIT` every live silhouette is held to.

    The same question `check_collisions` asks, asked of the second pose the
    wreck pass added to the roster -- a wreck is on the battlefield for the
    rest of the mission (`MAX_MESH_WRECKS`, fog-gated, evicted oldest first),
    so "is that a burnt-out Namer or a live Kipod" is a real thing for a
    player to get wrong.

    Two exclusions, and each mirrors one this gate already makes:

      * its OWN live mesh, because a wreck is supposed to resemble the
        vehicle it used to be -- that pairing is judged by
        `check_wreck_distinct` above, which puts a FLOOR under the same
        number this function puts a ceiling on, and having both read the
        pair would mean two checks disagreeing about one measurement.
      * its own retired sprite (`VEHICLE_OWN_SPRITES`), for exactly the
        reason the module docstring gives for the live case: a unit and its
        own art are not two units.

    Wreck-vs-wreck is deliberately NOT compared. Eleven slumped hulls at one
    fixed camera angle are a population this gate has no opinion about --
    burnt-out vehicles resembling each other is what burnt-out vehicles do,
    and the "these read as the same unit in a fight" failure is about telling
    a live threat from another live threat. Measured rather than assumed
    before leaving it out: the closest shipped wreck pair is `apc_kipod` vs
    `ifv_namer` at **0.8143** (then `apc_kipod` vs `jeep_shoded` 0.7722),
    both inside 0.88 -- so this is a scope decision and not a suppressed red,
    and adding the comparison later would cost nothing today.

    The headroom on what IS compared is worth knowing before retuning any
    recipe. Re-measured 2026-09-15 after the recipe was tuned: the tightest
    shipped pair is `scout_shachaf`'s wreck against `rocket_battery`'s LIVE
    mesh at **0.8242**, 0.056 under the limit, then the SAME wreck against
    `apc_kipod`'s live mesh at 0.8104, then `ifv_namer`'s wreck against the
    `KIPOD_HULL` sprite at 0.8044. That `scout_shachaf` owns the two tightest
    pairs is the reading, not a coincidence: it is the smallest, plainest hull
    in the fleet, its wreck is one of the three with nothing thrown off it,
    and a canted featureless box resembles every other canted box. The tuning IMPROVED this --
    before it the tightest was `ifv_namer` vs `apc_kipod` at 0.8488, with
    0.031 of headroom -- because every wreck moved further from its own
    parade pose and therefore from everything else's. The general warning
    survives the numbers changing: a recipe change that moved LESS would walk
    this check and `check_wreck_distinct` toward their thresholds at once,
    and which vehicle is tightest is not stable across a retune (it was
    `ifv_namer` on both counts before, and is now `rocket_battery` on one and
    `scout_shachaf` on the other), so measure rather than reach for the name
    written down last time.
    """
    failures = []
    for wreck_id, wreck in sorted(wreck_masks.items()):
        own = set(own_sprite_dirs(wreck_id, sheets))
        for mesh_id, mask in sorted(mesh_masks.items()):
            if mesh_id == wreck_id:
                continue  # see the docstring: the distinctness floor owns this pair
            score = va.iou(wreck, mask)
            if score > va.IOU_LIMIT:
                failures.append(
                    f"silhouette collision: {wreck_id} (wreck) vs {mesh_id} (mesh) "
                    f"IoU={score:.3f} (limit {va.IOU_LIMIT:.2f}) -- a destroyed "
                    f"{wreck_id} reads as a live {mesh_id}"
                )
        for sprite_id, mask in sorted(sprite_masks.items()):
            if sprite_id in own:
                continue
            score = va.iou(wreck, mask)
            if score > va.IOU_LIMIT:
                failures.append(
                    f"silhouette collision: {wreck_id} (wreck) vs {sprite_id} (sprite) "
                    f"IoU={score:.3f} (limit {va.IOU_LIMIT:.2f}) -- a destroyed "
                    f"{wreck_id} reads as a live {sprite_id}"
                )
    return failures




# The closed decor role vocabulary, mirroring
# packages/render/src/three/terrain/decor-role.ts's own `DECOR_MESH_ROLES`.
# Not imported (that file is TypeScript); kept in sync by hand the same way
# `VEHICLE_ROLE_PALETTES` above tracks its own TypeScript-side counterparts.
DECOR_ROLES = {"foliage", "trunk", "rock", "sand"}

# The decor families allowed to ship their own baked material instead of being
# repainted from the palette -- the decor counterpart of TEXTURED_MESH_EXEMPT
# above, and kept in step with TEXTURED_DECOR_FAMILIES in
# packages/render/src/three/terrain/textured-decor.ts (pinned by
# textured-decor.test.ts, which parses this set).
#
# ONE family, and the reason is not preference. The anti-tank ditch's job is to
# REPLACE a patch of ground -- the terrain is an extruded heightfield with no
# way to cut a hole in it -- and the ground it brings is a flat apron: one
# normal, and therefore ONE FLAT COLOUR under a ramp indexed by normal, by
# construction. On terrain carrying its own grain that reads as a plaque with a
# ditch printed on it rather than as ground with a ditch in it. The palette
# path cannot express this asset; it is not merely worse at it.
#
# Everything else in art/meshes/decor/ still fails on a single material, image
# or texture. The gate is not weakened for all of decor to admit one family.
TEXTURED_DECOR_EXEMPT = {"ditch"}


# The closed campaign-map node vocabulary. `region` is ground a campaign
# region is played over and the runtime may tint; `scenery` is everything the
# diorama needs to look like a world and nothing may tint. Mirrors
# CAMPAIGN_MAP_ROLES in packages/render/src/three/campaign/textured-world.ts
# (pinned by textured-world.test.ts, which parses this set).
CAMPAIGN_MAP_ROLES = {"region", "scenery"}

# The campaign worlds allowed to ship their own baked material -- the campaign
# counterpart of TEXTURED_MESH_EXEMPT and TEXTURED_DECOR_EXEMPT above, kept in
# step with TEXTURED_CAMPAIGN_MAPS in
# packages/render/src/three/campaign/textured-world.ts.
#
# ONE world, and as with the ditch the reason is structural rather than
# preference. The palette path indexes a ramp BY NORMAL, and this asset's
# entire subject is BIOME -- forest, desert, snow, water, cultivation -- which
# is colour at a constant normal. A normal-indexed ramp cannot express any of
# it: the map would come out one flat colour per slope angle, and the two
# regions a player has to tell apart would be identical wherever the ground is
# flat, which is most of it. The palette path cannot express this asset.
#
# Everything else that lands in art/meshes/campaign/ still fails on a material,
# image or texture it is not listed for.
TEXTURED_CAMPAIGN_EXEMPT = {"sahar_basin"}


def decor_family_of(name):
    """`ditch_0.glb` -> `ditch`. Mirrors `decorFamilyOf` in
    textured-decor.ts: split on the LAST underscore so a future two-word
    family name survives."""
    base = os.path.splitext(os.path.basename(name))[0]
    cut = base.rfind("_")
    return base if cut == -1 else base[:cut]


def _read_glb_json(path):
    """The glTF JSON chunk, parsed without any dependency on `bpy` -- this
    script runs as plain `python3`, unlike `render_mesh_gate.py`'s own
    identical parse, which can only load inside Blender. See this module's
    own docstring, "Decor is checked a THIRD way"."""
    with open(path, "rb") as fh:
        data = fh.read()
    _magic, _version, length = struct.unpack("<III", data[0:12])
    offset = 12
    while offset < length:
        chunk_len, chunk_type = struct.unpack("<II", data[offset:offset + 8])
        chunk_data = data[offset + 8:offset + 8 + chunk_len]
        if chunk_type == 0x4E4F534A:  # 'JSON'
            return json.loads(chunk_data)
        offset += 8 + chunk_len
    raise ValueError(f"{path}: no JSON chunk found -- not a valid glb")


def check_decor_meshes(decor_root):
    """Every `art/meshes/decor/*.glb` carries zero materials/images/textures
    and every mesh-bearing node's `extras.rl_role` is inside the closed decor
    set -- checked directly against the raw GLB bytes, never rendered (see
    module docstring). An empty directory is zero iterations, not a failure.

    A family in TEXTURED_DECOR_EXEMPT takes the other contract instead: it
    SHIPS exactly one material/image/texture, and its mesh nodes carry
    `extras.rl_textured = true` rather than an `rl_role` (they draw their own
    bake, so there is no palette ramp for a role to name). Both locks are
    checked, the same pair the runtime checks -- the flag says a mesh is
    textured, the list says whether its family is allowed to be -- so a GLB
    that sets the flag from an unlisted family fails here rather than being
    silently upgraded, and a listed family that quietly lost its texture fails
    too instead of drawing an untextured slab.

    Returns (failures, textured_names) so the caller can name the exempt
    files on the PASSING path.
    """
    failures = []
    textured_names = []
    for path in sorted(glob.glob(os.path.join(decor_root, "*.glb"))):
        name = os.path.basename(path)
        family = decor_family_of(name)
        exempt = family in TEXTURED_DECOR_EXEMPT
        glb_json = _read_glb_json(path)
        n_mat = len(glb_json.get("materials", []))
        n_img = len(glb_json.get("images", []))
        n_tex = len(glb_json.get("textures", []))
        if exempt:
            if (n_mat, n_img, n_tex) != (1, 1, 1):
                failures.append(
                    f"{name}: family {family!r} is in TEXTURED_DECOR_EXEMPT and must ship "
                    f"exactly one material/image/texture, but carries {n_mat}/{n_img}/{n_tex} "
                    f"-- an exempt family with no texture draws an untextured slab, and more "
                    f"than one image means metallic_roughness or normal survived an export "
                    f"that should have dropped them"
                )
            else:
                textured_names.append(name)
        elif n_mat or n_img or n_tex:
            failures.append(
                f"{name}: carries {n_mat} material(s), {n_img} image(s), "
                f"{n_tex} texture(s) -- the decor contract is zero of each. If this is "
                f"deliberate, add {family!r} to TEXTURED_DECOR_EXEMPT (and to "
                f"TEXTURED_DECOR_FAMILIES in "
                f"packages/render/src/three/terrain/textured-decor.ts)"
            )
        nodes = glb_json.get("nodes", [])
        gltf_meshes = glb_json.get("meshes", [])
        for node in nodes:
            if "mesh" not in node:
                continue  # a camera/empty node, not a mesh-bearing one
            extras = node.get("extras") or {}
            role = extras.get("rl_role")
            node_name = node.get("name") or gltf_meshes[node["mesh"]].get("name", "?")
            if extras.get("rl_textured") is True:
                if not exempt:
                    failures.append(
                        f"{name}: mesh node {node_name!r} declares rl_textured but family "
                        f"{family!r} is not in TEXTURED_DECOR_EXEMPT {sorted(TEXTURED_DECOR_EXEMPT)}"
                    )
                continue
            if exempt:
                failures.append(
                    f"{name}: family {family!r} is in TEXTURED_DECOR_EXEMPT but mesh node "
                    f"{node_name!r} does not declare rl_textured -- the runtime reads that "
                    f"flag, so this mesh would be dropped and never drawn"
                )
            elif role is None:
                failures.append(f"{name}: mesh node {node_name!r} carries no rl_role")
            elif role not in DECOR_ROLES:
                failures.append(
                    f"{name}: mesh node {node_name!r} has rl_role {role!r}, outside "
                    f"the closed decor vocabulary {sorted(DECOR_ROLES)}"
                )
    return failures, textured_names


def check_campaign_meshes(campaign_root, world_path):
    """Every `art/meshes/campaign/*.glb` against the campaign-map contract,
    read straight out of the raw GLB bytes -- never rendered, for the reason
    `render_mesh_gate.py`'s own docstring gives (a normal-indexed ramp cannot
    express a biome map, so a repainted render would be a stand-in with none
    of the asset's content in it).

    Four things are checked, and each one is a defect that has a silent
    failure mode on the other side of it:

      1. A listed world ships exactly one material/image/texture. Zero images
         means the bake was lost and the map draws untextured; more than one
         means `metallic_roughness` or `normal` survived an export that must
         drop them (there are no lights here to consume either).
      2. Every mesh node declares `rl_textured` and an `rl_map_role` inside
         CAMPAIGN_MAP_ROLES. The runtime reads that role to decide what may
         be tinted as a region; a node with none would be drawn as neither.
      3. The set of `rl_region` ids on the `region` nodes EQUALS the set of
         region ids in data/campaign/world.json. This is the join the whole
         design rests on -- rename a region in the JSON and the mesh the
         campaign screen looks up by that name simply stops being found, with
         no error anywhere.
      4. Every town in world.json has its own marker node. A missing marker
         is a town the 3D board cannot place, and it would read as a campaign
         bug rather than a missing node.

    Returns (failures, textured_names) so the caller can name the exempt
    files on the PASSING path, the same shape `check_decor_meshes` returns.
    """
    failures = []
    textured_names = []
    paths = sorted(glob.glob(os.path.join(campaign_root, "*.glb")))
    if not paths:
        return failures, textured_names
    with open(world_path) as fh:
        world = json.load(fh)
    want_regions = {r["id"] for r in world["regions"]}
    want_towns = {t["id"] for r in world["regions"] for t in r["towns"]}

    for path in paths:
        name = os.path.basename(path)
        world_id = os.path.splitext(name)[0]
        exempt = world_id in TEXTURED_CAMPAIGN_EXEMPT
        glb_json = _read_glb_json(path)
        n_mat = len(glb_json.get("materials", []))
        n_img = len(glb_json.get("images", []))
        n_tex = len(glb_json.get("textures", []))
        if exempt:
            if (n_mat, n_img, n_tex) != (1, 1, 1):
                failures.append(
                    f"{name}: {world_id!r} is in TEXTURED_CAMPAIGN_EXEMPT and must ship "
                    f"exactly one material/image/texture, but carries {n_mat}/{n_img}/{n_tex} "
                    f"-- none means the bake was lost and the world draws untextured; more "
                    f"than one means metallic_roughness or normal survived an export that "
                    f"should have dropped them"
                )
            else:
                textured_names.append(name)
        elif n_mat or n_img or n_tex:
            failures.append(
                f"{name}: carries {n_mat} material(s), {n_img} image(s), {n_tex} texture(s) "
                f"but {world_id!r} is not in TEXTURED_CAMPAIGN_EXEMPT "
                f"{sorted(TEXTURED_CAMPAIGN_EXEMPT)}. If this is deliberate, add it there "
                f"(and to TEXTURED_CAMPAIGN_MAPS in "
                f"packages/render/src/three/campaign/textured-world.ts)"
            )

        gltf_meshes = glb_json.get("meshes", [])
        got_regions = set()
        got_towns = set()
        for node in glb_json.get("nodes", []):
            node_name = node.get("name") or "?"
            extras = node.get("extras") or {}
            if "mesh" not in node:
                town = extras.get("rl_town")
                if town is not None:
                    got_towns.add(town)
                continue
            node_name = node.get("name") or gltf_meshes[node["mesh"]].get("name", "?")
            if extras.get("rl_textured") is not True:
                failures.append(
                    f"{name}: mesh node {node_name!r} does not declare rl_textured -- the "
                    f"runtime reads that flag to take the baked-material path, so this mesh "
                    f"would fall through to a palette ramp it has no role for"
                )
            elif not exempt:
                failures.append(
                    f"{name}: mesh node {node_name!r} declares rl_textured but {world_id!r} "
                    f"is not in TEXTURED_CAMPAIGN_EXEMPT "
                    f"{sorted(TEXTURED_CAMPAIGN_EXEMPT)}"
                )
            role = extras.get("rl_map_role")
            if role not in CAMPAIGN_MAP_ROLES:
                failures.append(
                    f"{name}: mesh node {node_name!r} has rl_map_role {role!r}, outside the "
                    f"closed campaign vocabulary {sorted(CAMPAIGN_MAP_ROLES)}"
                )
            elif role == "region":
                region = extras.get("rl_region")
                if region is None:
                    failures.append(
                        f"{name}: mesh node {node_name!r} is rl_map_role 'region' but names "
                        f"no rl_region -- nothing could look it up")
                else:
                    got_regions.add(region)

        if got_regions != want_regions:
            failures.append(
                f"{name}: region nodes name {sorted(got_regions)} but "
                f"{os.path.relpath(world_path, REPO)} declares {sorted(want_regions)} -- "
                f"the campaign screen finds a region's ground BY NAME, so a mismatch is a "
                f"region that silently has no mesh"
            )
        if not want_towns <= got_towns:
            failures.append(
                f"{name}: no marker node for town(s) {sorted(want_towns - got_towns)} -- "
                f"every town in {os.path.relpath(world_path, REPO)} needs one "
                f"(an empty node named <town_id>_town carrying extras.rl_town)"
            )
        extra_towns = got_towns - want_towns
        if extra_towns:
            failures.append(
                f"{name}: marker node(s) for {sorted(extra_towns)}, which "
                f"{os.path.relpath(world_path, REPO)} does not declare"
            )
    return failures, textured_names


# The wreck contract's own names, restated from `tools/src/meshes/wreck-pass.ts`
# (`DEATH_ROOT`, `WRECK_PREFIX`) and `mesh-anim.ts`'s clip vocabulary rather
# than imported -- this is a plain-`python3` process and the TypeScript side
# is not reachable from it. Written down on three sides now (the pass, this
# gate, `mesh-vehicle-shipped.test.ts`), which is what makes a rename on any
# one of them a red gate rather than a silent miss.
DEATH_ROOT_NODE = "death_root"
WRECK_NODE_PREFIX = "WRECK_"
WRECK_CLIP_NAMES = ("idle", "wreck")


def _wreck_subtree(nodes, root_index):
    """Every node index under `root_index`, the root itself excluded. A flat
    list today -- the pass writes one child per live mesh node and no deeper
    -- but walked rather than assumed, because the spec's later structural
    pass "replaces a vehicle's `WRECK_` children with real damaged geometry"
    and that geometry may well arrive nested."""
    out = []
    stack = list(nodes[root_index].get("children", []))
    while stack:
        i = stack.pop()
        out.append(i)
        stack.extend(nodes[i].get("children", []))
    return out


def check_vehicle_wrecks(vehicle_roots):
    """Every vehicle GLB against the wreck contract, read straight out of the
    raw GLB bytes -- see this module's docstring, "Vehicles are checked a
    FIFTH way", for why no render can see this.

    `vehicle_roots` is a SEQUENCE of directories and the shipped call passes
    two: `art/meshes/vehicles/` (the uncompressed source of record, which
    every other check in this file walks) and `assets/meshes/vehicles/` (the
    Draco mirror `pnpm encode:meshes` writes, which is what a browser
    actually downloads). Until 2026-09-15 only the first was read, and the
    hole that leaves is specific rather than theoretical: the mirror is the
    shipped artefact, no other gate parses its node graph at all, and
    `pnpm encode:meshes -- --check` compares HASHES -- it proves the mirror
    matches the source it was made from, which is silence rather than
    agreement if the encoder ever drops a node, a clip or an extras flag on
    the way through. Draco compresses mesh PRIMITIVES and leaves the node
    graph and the animation accessors alone, so every clause below reads the
    same on both sides, and the two counts are reported separately on the
    passing path so "11 and 11" is visible rather than assumed.

    Six clauses, each of which has a silent failure mode behind it:

      1. A node named `death_root` among the scene's ROOT nodes. Not merely
         somewhere in the file: it is a SIBLING of the live geometry, and one
         that had drifted under a hull would inherit that hull's transform
         twice while still being "present".
      2. Every node under it is named `WRECK_*` and carries
         `extras.rl_wreck = true`. The flag is what the runtime's charring
         reads (spec §4.3); the name is what a human reads in Blender.
      3. Every wreck node's `mesh` index is one a LIVE node also references
         -- the sharing that keeps this whole feature a couple of KB per
         file instead of a second copy of a 3.4 MiB buffer.
      3b. ONE wreck child per live mesh node, matched BY NAME
         (`WRECK_<live name>`, which is what `wreck-pass.ts` writes). Clause
         3 is a containment test and it passes a death root that is MISSING
         a part -- the pass's own `applyWreckPass` walks every live mesh node
         and any future re-export, filter or hand-edit that drops one leaves
         a wreck with, say, no wheels, and clauses 1-3 have nothing to say
         about it. Added 2026-09-15 after a review falsified the gap: a
         repacked `scout_shachaf` with one `WRECK_` child deleted read
         `checked=1 failures=0`. Matching by name rather than by count alone
         is what lets the failure NAME the missing twin, which is the whole
         difference between "one part is gone" and "which part is gone".
      4. Exactly the two animations `idle` and `wreck`, each keying `scale`
         on exactly the set {every top-level live node} + {death_root}. A
         clip that missed one live node leaves that part of the vehicle
         standing inside its own wreck.
      5. Every sampler is `STEP` with two keyframes, and its output is all
         ones or all zeros the right way round: `idle` shows the live half
         and hides the wreck, `wreck` is the reverse. `death_root` is
         authored at scale 1 in the file, so clause 5 on `idle` is the ONLY
         thing standing between the shipped bytes and a wreck drawn inside
         its own live vehicle.

    `bf.read_glb` and `bf._accessor` are reused, not reimplemented -- the
    same "read, never reimplemented" the module docstring argues for the
    palette and IoU maths. This is the second reader of a GLB's BIN chunk in
    this process and there is no reason for it to be a second parse.

    Returns (failures, counts), `counts` being one `(relative directory,
    n_checked)` pair per root so the caller can name BOTH on the passing
    path. An empty directory is zero iterations, not a failure.
    """
    failures = []
    counts = []
    for vehicles_root in vehicle_roots:
        counts.append((os.path.relpath(vehicles_root, REPO),
                       _check_vehicle_wreck_dir(vehicles_root, failures)))
    return failures, counts


def _check_vehicle_wreck_dir(vehicles_root, failures):
    """One directory's worth of `check_vehicle_wrecks`, appending to
    `failures` and returning how many files were checked. Split out only so
    the loop over the two roots reads as a loop; every clause and every
    message lives here."""
    n_checked = 0
    for path in sorted(glob.glob(os.path.join(vehicles_root, "*.glb"))):
        # The RELATIVE path, not the basename: two directories are walked now
        # and `mbt_lavi.glb` alone would not say which of them failed. A root
        # outside the repo (a throwaway copy under a falsification's temp
        # directory) keeps its absolute path rather than a wall of `../`.
        name = os.path.relpath(path, REPO)
        if name.startswith(os.pardir):
            name = path
        gltf, binary = bf.read_glb(path)
        nodes = gltf.get("nodes", [])
        scene = (gltf.get("scenes") or [{}])[gltf.get("scene", 0)]
        roots = list(scene.get("nodes", []))

        death = [i for i in roots if nodes[i].get("name") == DEATH_ROOT_NODE]
        if len(death) != 1:
            failures.append(
                f"{name}: {len(death)} root node(s) named {DEATH_ROOT_NODE!r}, expected exactly "
                f"one -- run `pnpm wreck:meshes`. A re-export that skipped the pass LOADS fine "
                f"and simply has no death state: the vehicle vanishes the frame it dies, which "
                f"is the bug the wreck exists to fix"
            )
            continue
        death = death[0]
        n_checked += 1
        live_roots = [i for i in roots if i != death]

        wreck_nodes = _wreck_subtree(nodes, death)
        if not wreck_nodes:
            failures.append(
                f"{name}: {DEATH_ROOT_NODE!r} has no children -- an empty death root passes "
                f"every clip check below and draws nothing at all when the vehicle dies"
            )
        wreck_set = set(wreck_nodes)
        live_meshes = {
            node["mesh"] for i, node in enumerate(nodes)
            if "mesh" in node and i not in wreck_set
        }
        for i in wreck_nodes:
            node = nodes[i]
            node_name = node.get("name") or f"<node {i}>"
            if not node_name.startswith(WRECK_NODE_PREFIX):
                failures.append(
                    f"{name}: node {node_name!r} under {DEATH_ROOT_NODE!r} is not named "
                    f"{WRECK_NODE_PREFIX}*"
                )
            if (node.get("extras") or {}).get("rl_wreck") is not True:
                failures.append(
                    f"{name}: node {node_name!r} under {DEATH_ROOT_NODE!r} does not carry "
                    f"extras.rl_wreck = true -- the runtime's charring reads that flag, so this "
                    f"part would draw in its LIVING colours on a burnt-out hull"
                )
            if "mesh" not in node:
                continue  # a grouping empty is legitimate; it just draws nothing
            if node["mesh"] not in live_meshes:
                failures.append(
                    f"{name}: node {node_name!r} references mesh {node['mesh']}, which no live "
                    f"node references -- the wreck must SHARE its twin's mesh, not carry a copy "
                    f"(this file's buffer is {len(binary or b''):,} bytes; duplicating it is the "
                    f"cost the contract exists to avoid)"
                )

        # Clause 3b. The loop above is a CONTAINMENT test -- every wreck node
        # it sees must point at a shared mesh -- and a death root that is
        # missing a child has nothing for it to look at, so it says nothing.
        # The pass writes `WRECK_<live node name>` for every live mesh node,
        # so the two sets are comparable by name and a difference names the
        # part rather than only counting it.
        # MULTISETS, not sets, and the difference is a real hole rather than
        # a nicety: compared as sets, `len(got) != len(want)` could never
        # fire once `got != want` had been checked, so a death root carrying
        # `WRECK_hull_hull` TWICE and `WRECK_hull_metal` not at all was the
        # one shape this clause could not see -- the names present are equal
        # as sets and the counts are equal too. `Counter` makes the duplicate
        # expressible, and the subtraction still names the part.
        want_twins = Counter(
            f"{WRECK_NODE_PREFIX}{node.get('name')}" for i, node in enumerate(nodes)
            if "mesh" in node and i not in wreck_set
        )
        got_twins = Counter(
            nodes[i].get("name") for i in wreck_nodes if "mesh" in nodes[i]
        )
        if got_twins != want_twins:
            missing = sorted((want_twins - got_twins).elements())
            extra = sorted((got_twins - want_twins).elements())
            failures.append(
                f"{name}: {DEATH_ROOT_NODE!r} carries {sum(got_twins.values())} mesh-bearing "
                f"child(ren) for {sum(want_twins.values())} live mesh node(s); missing "
                f"{missing}, unexpected {extra} -- one {WRECK_NODE_PREFIX}* twin per live mesh "
                f"node, exactly once each, and a wreck short of one is a vehicle that dies "
                f"leaving that part standing"
            )

        animations = gltf.get("animations", [])
        got_clips = sorted(a.get("name") for a in animations)
        if got_clips != sorted(WRECK_CLIP_NAMES):
            failures.append(
                f"{name}: animations are {got_clips}, expected exactly {sorted(WRECK_CLIP_NAMES)}"
            )
        want_targets = set(live_roots) | {death}
        for anim in animations:
            clip = anim.get("name")
            if clip not in WRECK_CLIP_NAMES:
                continue  # already reported by the set comparison above
            samplers = anim.get("samplers", [])
            got_targets = []
            for channel in anim.get("channels", []):
                target = channel.get("target") or {}
                node_i = target.get("node")
                got_targets.append(node_i)
                node_name = nodes[node_i].get("name") if node_i is not None else "<none>"
                if target.get("path") != "scale":
                    failures.append(
                        f"{name}: clip {clip!r} keys {target.get('path')!r} on {node_name!r} -- "
                        f"the contract is scale, and only scale"
                    )
                    continue
                sampler = samplers[channel["sampler"]]
                if sampler.get("interpolation") != "STEP":
                    failures.append(
                        f"{name}: clip {clip!r}'s sampler for {node_name!r} interpolates "
                        f"{sampler.get('interpolation')!r}, not STEP -- a LINEAR ramp between "
                        f"1 and 0 makes the swap a half-second dissolve instead of a swap"
                    )
                times = bf._accessor(gltf, binary, sampler["input"])  # noqa: SLF001 -- see the docstring.
                values = bf._accessor(gltf, binary, sampler["output"])  # noqa: SLF001
                if len(times) != 2 or values.shape != (2, 3):
                    failures.append(
                        f"{name}: clip {clip!r}'s sampler for {node_name!r} has {len(times)} "
                        f"keyframe(s) of {values.shape[1] if values.ndim > 1 else '?'} "
                        f"component(s), expected 2 x VEC3"
                    )
                    continue
                # `idle` shows the live half, `wreck` shows the death root.
                shown = (node_i != death) == (clip == "idle")
                want = 1.0 if shown else 0.0
                if not (values == want).all():
                    failures.append(
                        f"{name}: clip {clip!r} scales {node_name!r} to "
                        f"{values.tolist()}, expected every component {want} -- "
                        f"{DEATH_ROOT_NODE!r} is authored at scale 1 in the file, so `idle`'s "
                        f"zero is the only thing that keeps the wreck out of the live frame"
                    )
            if set(got_targets) != want_targets or len(got_targets) != len(want_targets):
                missing = sorted(nodes[i].get("name") for i in want_targets - set(got_targets))
                extra = sorted(
                    (nodes[i].get("name") if i is not None else "<none>")
                    for i in set(got_targets) - want_targets
                )
                failures.append(
                    f"{name}: clip {clip!r} keys {len(got_targets)} channel(s) over "
                    f"{len(set(got_targets))} node(s); missing {missing}, unexpected {extra} -- "
                    f"every top-level live node plus {DEATH_ROOT_NODE!r}, exactly once each"
                )
    return n_checked


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--palette", default=os.path.join(REPO, "data", "palette.json"))
    ap.add_argument("--sprites", default=os.path.join(REPO, "assets", "sprites"))
    ap.add_argument("--blender", default="")
    ap.add_argument("--out", default="", help="keep renders here instead of a throwaway temp dir")
    args = ap.parse_args()

    blender_bin = find_blender(args.blender)
    if not blender_bin:
        print(
            "MESH GATE FAILED -- no Blender binary found. Set BLENDER_BIN or pass "
            "--blender; tried: " + ", ".join(c for c in DEFAULT_BLENDER_CANDIDATES if c)
        )
        return 1

    keep = bool(args.out)
    out_dir = args.out or tempfile.mkdtemp(prefix="rl-mesh-gate-")
    try:
        proc, ok, warn, fail, sheets = render_meshes(blender_bin, out_dir)
        for line in warn:
            print(f"  [warn] {line}")
        for line in fail:
            print(f"  [render failed] {line}")
        if not ok and not fail:
            print("MESH GATE FAILED -- Blender produced no MESH_GATE_OK/FAIL lines at all.")
            print("--- blender stdout (tail) ---")
            print("\n".join(proc.stdout.splitlines()[-40:]))
            print("--- blender stderr (tail) ---")
            print("\n".join(proc.stderr.splitlines()[-40:]))
            return 1

        failures = [f"render: {u}" for u in fail]

        image_failures, mesh_masks, textured, wreck_masks = load_mesh_masks(out_dir, args.palette)
        failures.extend(image_failures)

        sprite_masks = load_sprite_masks(args.sprites)
        failures.extend(check_collisions(mesh_masks, sprite_masks, sheets))

        # The wreck's own two checks, on the SECOND render every vehicle now
        # produces. Both use the masks above, so they cost no extra Blender
        # work beyond that render: a floor under how far the wreck moved from
        # its own live pose, and the existing 0.88 ceiling against every
        # other unit on the roster.
        # Before either wreck check, because both of them iterate the renders
        # that EXIST and neither can notice one that does not.
        failures.extend(
            check_wreck_census(wreck_masks, os.path.join(REPO, "art", "meshes", "vehicles"))
        )
        failures.extend(check_wreck_distinct(mesh_masks, wreck_masks))
        failures.extend(check_wreck_collisions(wreck_masks, mesh_masks, sprite_masks, sheets))

        decor_root = os.path.join(REPO, "art", "meshes", "decor")
        decor_failures, textured_decor = check_decor_meshes(decor_root)
        failures.extend(decor_failures)

        campaign_root = os.path.join(REPO, "art", "meshes", "campaign")
        campaign_failures, textured_campaign = check_campaign_meshes(
            campaign_root, os.path.join(REPO, "data", "campaign", "world.json"))
        failures.extend(campaign_failures)

        # A FOURTH way of checking, and like decor's it runs against the raw
        # GLB bytes rather than against a render this gate made: the rendered
        # PNG is one locked pose and says nothing about which of a building's
        # four elevations the fixed dimetric camera can see. See
        # tools/building_facing.py's own docstring for what it measures.
        buildings_root = os.path.join(REPO, "art", "meshes", "buildings")
        facing_failures, facing_notes = bf.check_building_facing(buildings_root)
        failures.extend(facing_failures)

        # A FIFTH way, raw bytes again, and the one whose defect is INVISIBLE
        # to every render above by construction: `render_mesh_gate.py` hides
        # `death_root` for the live pose, so a vehicle that lost its wreck
        # photographs identically to one that has it. See this module's
        # docstring, "Vehicles are checked a FIFTH way".
        # BOTH trees: the uncompressed source of record and the Draco mirror
        # a browser actually downloads. See `check_vehicle_wrecks`' docstring
        # for why `pnpm encode:meshes -- --check` is not a substitute.
        wreck_failures, wreck_counts = check_vehicle_wrecks((
            os.path.join(REPO, "art", "meshes", "vehicles"),
            os.path.join(REPO, "assets", "meshes", "vehicles"),
        ))
        failures.extend(wreck_failures)

        if failures:
            print(f"\nMESH GATE FAILED -- {len(failures)} issue(s):\n")
            for f in failures:
                print(f"  - {f}")
            return 1

        n_decor = len(glob.glob(os.path.join(decor_root, "*.glb")))
        n_campaign = len(glob.glob(os.path.join(campaign_root, "*.glb")))
        print(f"mesh gate passed: {len(mesh_masks)} mesh unit(s) rendered and checked "
              f"against {len(sprite_masks)} sprite unit(s); {n_decor} decor mesh(es) "
              f"and {n_campaign} campaign world(s) checked against the mesh contract "
              f"directly")
        if textured:
            # Deliberately loud, and deliberately on the PASSING path: the
            # thing worth catching is a future reader assuming these are
            # palette-checked because the gate went green. See
            # TEXTURED_MESH_EXEMPT.
            print(f"  NOT palette-checked -- {len(textured)} textured mesh(es) ship their own "
                  f"baked material by the project lead's instruction: {', '.join(sorted(textured))}")
            print("  (silhouette IoU still applied to them; see TEXTURED_MESH_EXEMPT)")
        if textured_decor:
            # Same reasoning as the building line above, and deliberately on
            # the PASSING path: the thing worth catching is a reader assuming
            # every decor GLB is palette-clean because the gate went green.
            # Decor is never rendered by this gate at all, so these are not
            # silhouette-checked either -- say so rather than let the
            # building line's "silhouette IoU still applies" be read across.
            print(f"  NOT palette-checked -- {len(textured_decor)} textured decor mesh(es) ship "
                  f"their own baked material: {', '.join(sorted(textured_decor))}")
            print("  (decor is contract-checked from the GLB bytes, never rendered, so no "
                  "silhouette IoU applies to it either; see TEXTURED_DECOR_EXEMPT)")
        if textured_campaign:
            # Third of the same kind of line, and on the PASSING path for the
            # same reason. This one carries an extra clause the other two do
            # not: a campaign world could not be palette-checked even if
            # somebody wanted to, because its subject is biome and the ramp
            # is indexed by normal. Saying only "not palette-checked" would
            # read as a gap somebody could close.
            print(f"  NOT palette-checked -- {len(textured_campaign)} campaign world(s) ship "
                  f"their own baked material: {', '.join(sorted(textured_campaign))}")
            print("  (a campaign world's subject is BIOME, which is colour at a constant "
                  "normal, and the palette ramp is indexed BY normal -- there is no palette "
                  "check to apply here, not merely one that was skipped. It is never "
                  "rendered by this gate, so no silhouette IoU applies either; its region "
                  "and town nodes ARE checked against data/campaign/world.json. See "
                  "TEXTURED_CAMPAIGN_EXEMPT)")
        if any(n for _, n in wreck_counts):
            # On the PASSING path, and the last clause is the point: a green
            # tick here must not read as "the wreck looks right". The SHAPE
            # is judged -- it has to differ from the live pose by
            # WRECK_MIN_DISTINCT and must not collide with any other unit --
            # but the COLOUR is not, and cannot be: charring is a runtime
            # treatment of anything marked `rl_wreck` (spec 4.3), the wreck
            # children carry their live twins' `rl_role`, and this gate
            # repaints from the palette tables before rendering. So it is
            # measuring a stand-in for the colour, exactly as it does for a
            # textured building, and says so rather than letting the two
            # checks below be read as covering it.
            print("  vehicle wrecks: "
                  + ", ".join(f"{n} GLB(s) in {root}" for root, n in wreck_counts)
                  + " carry the death_root contract")
            print(f"  {len(wreck_masks)} wreck(s) rendered alone through the live camera and "
                  f"judged two ways: distinct from their own live silhouette (IoU <= "
                  f"{1.0 - WRECK_MIN_DISTINCT:.3f}) and colliding with no other unit (IoU <= "
                  f"{va.IOU_LIMIT:.2f})")
            print("  (the wreck's CHARRING is a runtime material treatment and is NOT "
                  "gate-checked -- the gate repaints every vehicle from the palette tables, so "
                  "it is judging the wreck's shape against a stand-in for its colour)")
        if facing_notes:
            # Deliberately loud, and deliberately on the PASSING path, for the
            # same reason as the line above: a green tick must not read as
            # "every building's facing is guaranteed". Half of these are
            # buildings with no facade to get wrong; the other half are ones
            # this gate cannot see a facade on at all.
            print(f"  facing: {len(facing_notes)} building mesh(es) NOT facing-checked or with "
                  f"no front to get wrong --")
            for note in facing_notes:
                print(f"    {note}")
        return 0
    finally:
        if not keep:
            shutil.rmtree(out_dir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
