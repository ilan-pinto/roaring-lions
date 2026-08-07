# The unit rig contract

**Date:** 2026-08-07
**Status:** approved, ready for implementation
**Scope:** Spec C of three. Spec D authors a unit parts kit and splits the seven
infantry types that currently share one sprite. Spec E replaces the vehicles.

The buildings read as one set. The units do not, and the cause is mechanical
rather than aesthetic. This spec fixes the mechanism before any new art is
authored against it.

## What is actually wrong, measured

**Seven unit types are the same sprite file.** `inf_squad`, `at_team`,
`mortar_team`, `militia_cell`, `rpg_team`, `atgm_cell` and `mortar_crew` all
resolve to `assets/sprites/INF/` in `packages/app/src/main.ts`. A KDF rifle squad
and an enemy militia cell are pixel-identical. The silhouette gate —
`ART_PIPELINE.md` §4 calls it the check that matters most — never fires on them,
because they are not separate sheets to compare.

**Four units have no art at all**: `attack_drone`, `demo_squad`, `sniper_team`,
`technical` fall back to procedural shapes.

**`mbt_lavi` is drawn by a WWII German Tiger** (BlendSwap, 2013). `apc_eitan` is
drawn by `LPMAC_military_truck.blend`.

**Five hands, three unverified licences.** Of six unit sheets only `NAMER`
(Mutte, CC-BY 3.0) and `DRONE_RECON` (authored here) have clean provenance.
`INF`, `EITAN` and `JEEP` each carry `LICENCE UNVERIFIED — downloaded without
licence, readme or attribution` in their own render scripts, against
CONTRIBUTING.md's rule that an asset without demonstrable redistribution rights
cannot enter the repository. Spec E resolves this by replacing them; it is
recorded here because it is the strongest reason the replacement is not
optional.

**No shared scale.** `render_vehicle.py:240` sets
`ortho_scale = radius * 2.0 * 1.15`, fitting each model to its own bounding
radius, and then a hand-typed manifest `scale` tries to put it back:

```
INF          0.63      NAMER_HULL   1.70
JEEP_HULL    1.10      TNK_HULL     1.80
EITAN_HULL   1.60      DRONE_RECON  0.50
```

Nothing relates those numbers. There is no answer in the pipeline to how big a
soldier is next to a tank.

**The sun is triplicated as literals** across `render_rig.py`,
`render_vehicle.py` and `render_soldier.py` — azimuth 135°, altitude 55°, key
4.0, fill 0.35, fill colour `(0.66, 0.77, 0.82)`. The values match today. That
is precisely the state `DIMETRIC_ELEVATION = atan(0.5)` was in before it turned
out to be wrong in six files at once.

**`ART_PIPELINE.md` is stale in three places.** §1 states the elevation as
26.565° and contains a paragraph arguing specifically against 30°, which is
backwards; §2 says 32 colours, and the palette now holds 42; §3's worked example
says `--size 256`, and buildings render at 512.

The buildings cohere because every one descends from `tools/buildings/kit.py` —
one kit, one hand. That is `ART_PIPELINE.md` §7's "hero assets plus kitbash",
and it is the pattern the units need.

## Why literal real-world scale is the wrong target

`UNITS_PER_TILE = 3.0` and `footprint_tiles` mean the buildings have already
fixed one tile at three metres. Applied literally to units that gives an MBT a
2.5-tile footprint, drawing wider than the mosque, and a 0.5 m quadcopter about
fifteen pixels across.

The two ends of a 15× size range cannot both be readable under one linear scale.
Every RTS compresses; `render_drone.py` already admits its own fudge in a
comment — *"Literal scale would be about 0.37"*.

Worth naming why the scales disagree: the buildings say a tile is three metres,
while a rifle with `range_tiles: 8` implies nearer thirty. Those are different
abstractions serving different jobs, and units sit between them. A derivation
that ignored this would be principled and wrong.

So the target is not physical truth. It is that **the compression is declared
once, in one table, instead of hidden in five unrelated hand-typed constants.**

## The contract

`tools/dimetric.py` gains a size-class table and a scale function. Each render
script declares two facts about its unit and derives the rest.

```python
SIZE_CLASS = {
    "infantry":      1.00,
    "light_vehicle": 0.80,
    "heavy_vehicle": 0.62,
    "air":           2.00,
}
```

Per unit, in order:

1. Declare `real_metres` — the unit's longest dimension **on any axis**, so a
   standing figure is declared by height (1.8) and a tank by length (7.6) — and
   its `size_class`.
2. **Uniformly rescale the object** so its measured longest extent equals
   `real_metres`. This step is new and load-bearing: nothing in the
   current pipeline normalises a model, so downloaded geometry is in arbitrary
   units. After it, model units are metres and everything downstream is the
   buildings' existing arithmetic unchanged.
3. Frame with `ortho_scale_for(points, FRAME_MARGIN)` over every pose the clip
   will show, replacing `radius * 2.0 * 1.15`. Both axes, so a raised barrel or
   a mast cannot clip.
4. `derivedScale = tiles_across(ortho_scale)`.
5. `scale = derivedScale * SIZE_CLASS[size_class]`.
6. The manifest records `realMetres`, `sizeClass`, `classMultiplier`,
   `derivedScale` and the final `scale`.

The renderer needs no change: it already reads `scale` as the canvas width in
tiles at `renderer.ts:708`. The audit fields sit beside it, so the compression is
reviewable in the manifest rather than inferred from a bare number.

### Why the margin does not affect on-screen size

Worth recording, because it is counter-intuitive and was got wrong once while
designing this. `manifest.scale` is the width of the whole canvas in tiles, not
of the object. A taller unit gets a taller frame, a larger `ortho_scale` and
therefore a larger `scale` — but it also occupies proportionally fewer pixels
within the texture, and the two cancel exactly:

```
object px on screen = scale · TILE_W · (2·reach_u / ortho_scale)
                    = tiles_across(2·reach_u) · TILE_W          (margin cancels)
```

So a 4 m object lands at the same on-screen width whether or not it carries a
4 m mast, and `FRAME_MARGIN` costs empty canvas and nothing else — the same
property `render_building.py` already documents.

### The multipliers are provisional

The values above were calibrated against `real_metres · √2 / UNITS_PER_TILE`,
which approximates an object's tile width but is not what the pipeline computes.
The real figure is `tiles_across(2·reach_u)`, which needs each model's measured
projected extent and therefore needs Blender.

**Implementation measures the true extents first, prints the table, and tunes the
four multipliers once against real numbers before re-rendering anything.**

The calibration target differs by class, because the dimension that reads
differs. A vehicle is judged on its plan length against the tile grid — a tank
covering a third of a house is a legible statement about scale. A standing figure
is judged on apparent *height*, and its projected width is only about 0.5 m, so
framing derived from horizontal extent alone would report a number that has
little to do with how big the soldier looks. Infantry and air therefore calibrate
on apparent height, vehicles on plan length. This makes the infantry row of the
prediction below the roughest of the six.

The approximate prediction, recorded so the calibration can be compared against
an expectation rather than eyeballed:

```
sheet         class          metres  approx scale   approx px   now px
INF           infantry          1.8          0.85          54       40
JEEP_HULL     light_vehicle     4.8          1.81         116       70
EITAN_HULL    heavy_vehicle     8.4          2.46         157      102
NAMER_HULL    heavy_vehicle     7.5          2.19         140      109
TNK_HULL      heavy_vehicle     7.6          2.22         142      115
DRONE_RECON   air               0.5          0.47          30       32
```

Two things in that table are the useful signals. The drone lands within two
pixels of its current hand-fudged value, so the class table is making an
existing judgement explicit rather than inventing a new look. Everything else
grows 23–66%, consistent with units having been collectively small against 64px
tiles and 300px buildings.

The tank-to-soldier ratio moves from 2.86 to about 2.62, against a physical 4.22.

## One sun rig

`SUN_AZIMUTH`, `SUN_ALTITUDE`, `SUN_STRENGTH`, `SUN_ANGLE`, `FILL_STRENGTH` and
`FILL_COLOR` move into `dimetric.py` beside `ELEVATION`, with a `build_lights()`
helper that the three render scripts call.

`dimetric.py` rather than a new `tools/rig.py`: it is already imported by every
render script, already has a dependency-free test, and "the locked rig" is one
concept. Splitting six constants into a second file to keep projection and
lighting nominally separate would buy a distinction nobody needs and give the
guard two files to watch.

`test_dimetric.py` grows a guard in the same shape as its existing
`DIMETRIC_ELEVATION` regex, failing if any `render_*.py` declares its own sun
rotation or key energy. The existing guard is the reason this class of bug is
worth guarding rather than merely fixing.

Buildings keep their own lighting. `render_building.py` documents why — a
vehicle is mostly horizontal surface and a 55° key against a black world works;
a building is mostly vertical wall and comes out near-black without ambient.
That is a real difference, not drift, so `build_lights()` serves the unit rig
and the building rig keeps its ambient override.

## ART_PIPELINE.md corrections

§1's elevation becomes 30° with the derivation stated: a ground square projects
with `height/width = sin(elevation)`, so a 2:1 tile requires `asin(0.5)`. The
paragraph arguing against 30° is removed — it is confidently wrong and it is the
first thing a contributor reads. §2's colour count becomes 42. §3's example
becomes `--size 512`.

## Verification

- `tools/test_dimetric.py` — the scale derivation against hand-worked values,
  the margin-cancellation property above, and the sun guard. Dependency-free, as
  the file already is.
- `pnpm validate:assets` — 358 sprites, **with the IoU table printed and
  recorded.** The matrix will move: `silhouette()` thumbnails the whole canvas,
  so changing the frame changes the shape the gate sees. The current worst unit
  pair is 0.703 against a 0.88 limit, and a pair crossing it is a real
  possibility rather than a formality. If one does, the massing is the problem
  and Spec D is where it gets fixed — the limit does not move.
- `pnpm test:determinism` — 4/4, hash unmoved. No sim code is touched, so a
  movement here would mean something unintended happened.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm validate:ui`.
- **Report the scale delta table** — every sheet, before against after, so the
  size change is a number rather than an impression.
- **Drive the app and screenshot the same view before and after.** The honest
  test of whether a roster reads as aligned is looking at it, and no gate
  measures it.

## Risk

Every unit's on-screen size changes at once, and all of them grow. If the result
reads as too large, the lever is `UNITS_PER_TILE` or one row of the class table
— a single edit, which is the point of the change. Whether roughly 30% larger is
*right* cannot be settled from here; it needs eyes on the running game, and the
before/after screenshots exist for that decision rather than to confirm success.

## Out of scope

- **New unit art.** Specs D and E. Nothing here authors geometry; it re-renders
  what exists against a contract, so that Spec D's kit is built against a scale
  that has stopped moving.
- **Splitting the seven shared infantry sheets.** Spec D. Recorded here because
  it is the most visible symptom, but fixing it means new art.
- **Replacing the unlicensed models.** Spec E, for the same reason.
- **The unit-card UI** in the reference images. A separate deliverable, and not
  palette-gated the way sprites are.
- **Reference art.** The attached references are style reference only; no
  geometry, texture or file from them enters the repository, as with the Arabian
  Desert City pack. Their real-force insignia and faction identity do not
  transfer either — CONTRIBUTING.md's setting standard keeps factions fictional
  and defined by doctrine. Team colour stays the `#FF00FF` runtime remap the
  pipeline already has.
