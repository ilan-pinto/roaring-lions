# The building set — five types, a parts kit, and a camera correction

**Date:** 2026-08-07
**Issue:** [#38](https://github.com/ilan-pinto/roaring-lions/issues/38)
**Status:** approved, ready for implementation planning
**Supersedes parts of:** `2026-08-06-building-sprites-design.md`

The mosque shipped alone. This designs the other five types — `shanty`, `house`,
`warehouse`, `apartment`, `concrete` — as original work built from a shared
parts kit, in the architectural language of the reference the project is aiming
at.

Three measurements taken while designing it changed the shape of the work, and
two of them are bugs that predate this feature.

## What the reference is, and is not

The visual target is a commercial Arabian-desert-city asset pack. **No geometry,
texture, or file from it can enter this repository** — the same trap
`ART_PIPELINE.md §7` records for Synty. It is reference only. Every building
here ships as `Original work for Roaring Lions (CC BY-SA 4.0)`, matching the
mosque.

What is being taken from it is a vocabulary: flat roofs behind parapets, merlons
square and triangular, a trim band under the coping, zigzag friezes, pointed-arch
openings, external stairs, balconies on stilts, mashrabiya bays, domes on drums.

## Correction: buildings do not display at 64px

`2026-08-06-building-sprites-design.md` says the pipeline "discards almost
everything… the sprite displays at 64px", and concludes that detail is not worth
modelling. **That is a unit number, and it is wrong for buildings.**

`drawStructureSprite` (`renderer.ts:851`) draws a structure at
`manifest.scale × TILE_W` pixels. The mosque's scale is 3.6, so it displays at
**230px** — from a 256px render. Buildings are near 1:1 with their source, and
the apartment will want ~350px, which 256 cannot supply without upscaling.

Detail survives. That is what makes the full architectural language worth
building, and it is why `SIZE` rises to 512.

It also shows in the current mosque, measured on the shipped sprite:

| symptom | measurement |
|---|---|
| roof blown to bare white | `limestone.0` is 16.2% of all opaque pixels |
| coursing reads as grit, not masonry | brick scale 6.0 against a 230px draw |
| no parapet — three merlons on one edge | — |
| clears its own frame by 2px | opaque rows 2–212 of 256 |

## Bug 1: the camera elevation is 10% too shallow

Every render script sets `DIMETRIC_ELEVATION = math.atan(0.5)`, and
`render_rig.py:19` calls it "the exact" 2:1 elevation.

It is not. For an orthographic camera at azimuth 225°, a ground square projects
with height/width = **sin θ**. The renderer draws with `isoX = (x−y)·32` and
`isoY = (x+y)·16` (`renderer.ts:96`), so the grid needs 32/64 = 0.5, which means
**sin θ = 0.5, θ = 30°**. `atan(0.5)` gives 0.447.

Measured, by rendering a unit ground square at both angles:

```
atan(0.5) = 26.565°   ground square renders 360×162 px   height/width = 0.4500
            30.000°   ground square renders 360×180 px   height/width = 0.5000
renderer requires                            32/64      =              0.5000
```

For units this is invisible — they are small and not grid-aligned. For buildings
it is not: a building's base *is* a tile diamond, and a 5×4 apartment would sit
10% shallower than the twenty tiles it covers.

**Decision: fix it everywhere and re-render all 353 sprites.** The alternative —
30° for buildings, 26.565° for units — leaves two camera angles in one scene.
Every source `.blend` still exists (`render_rig.py`'s missing `mbt_lavi.blend`
is dead legacy; the live tank sheets come from `tiger_tank_rigged.blend`), so
nothing blocks it.

**The risk this carries, stated plainly:** every unit silhouette changes, so the
pairwise IoU gate must be re-cleared for pairs that pass today. If a pair newly
fails, that is a real finding about two units being too alike and must be fixed
on its merits — not by relaxing `IOU_LIMIT`.

## Bug 2: integrity bars and garrison pips are placed from the wrong height

`renderer.ts:1239` positions a structure's status badge at
`by - stype.heightPx - 12`. `heightPx` is the *extrusion fallback's* height —
34 for the mosque — while the sprite draws far taller.

Measured on the shipped mosque: the art's top edge is 113px above the anchor and
the badge sits at 46px, so the badge is **67px inside the sprite**, behind the
dome. Garrison pips are how a player reads "is this house held", so on a
three-storey apartment the mechanic stops working entirely.

Fix: `render_building.py` measures the opaque bounding box and writes
`badgeTopPx` — display pixels from the sprite anchor to the top of the art. The
renderer uses it whenever a structure has a sprite, and falls back to `heightPx`
otherwise. `structures.json` is not touched; `heightPx` still drives the
extrusion path correctly.

## Geometry foundation

**One tile = 3.0 world units ≈ 3 m; a storey is 3.0.** This is not invented — the
mosque's `Hall` is 9.0 units across its 3-tile footprint. Authoring every
building to the same constant is what makes a 4×3 house and a 5×4 apartment
comparable, and it is the thing `render_vehicle.py`'s fit-to-radius destroys.

**`scale` becomes derived, not hand-tuned.** With the camera at azimuth 225°, a
footprint spanning `W × H` world units projects to `(W+H)/√2` units across the
camera's horizontal axis. Requiring that to land on `(w+h)/2` tiles of screen
width, with `w = W/3`:

```
scale = ortho_scale × √2 / (2 × 3) = extent × FRAME_MARGIN × √2 / 6
```

This is simply "3 world units = 1 tile" solved for the manifest field. It has a
useful property: raising `FRAME_MARGIN` no longer changes on-screen size, because
`scale` rises with it.

Measured against the shipped mosque: its render extent is 10.800 units, so at the
current 1.30 margin the formula gives **3.309** against the hand-tuned **3.6**.
The mosque therefore draws about 9% larger than one tile per three units today,
and re-rendering corrects it.

**`FRAME_SHIFT_Y` goes to 0.** It is currently a fitted 0.16 whose sign and
magnitude cannot be derived from the code. At zero, the camera's aim point — the
footprint's ground centre — lands exactly on the canvas centre, which is where
`drawStructureSprite` anchors the sprite. Defined correct rather than tuned, and
it is also what makes `badgeTopPx` meaningful.

**`FRAME_MARGIN` 1.30 → 1.45**, and the render script asserts the opaque box
clears every edge by ≥4px. `check_framing` catches a cropped sprite at the gate;
the render script should catch it at the render, and the mosque's 2px clearance
shows the current margin is not enough for anything taller.

**`SIZE` 256 → 512**, so the apartment's ~350px draw is not upscaled.

## Material roles

`render_building.py` currently chooses brick-or-stone from name fragments —
`"dome" in o.name`. Seven materials need something better, so each object carries
a custom property `obj["rl_role"]`. Objects with no role fall through to the
existing heuristic, so an untouched `.blend` renders exactly as it does today.

Every role names a **palette entry**. None is derived arithmetically: an earlier
attempt computed a second brick course as `base × 1.16`, which is not a palette
colour and drifted 23% of the mosque into moss-green.

| role | palette | purpose |
|---|---|---|
| `wall` | coursed `limestone.2` / `dust.0`, mortar `limestone.3` | masonry, unchanged |
| `roof` | `limestone.5` | a **separate roof deck object**, dark enough that the key light does not blow it white |
| `trim` | `terracotta.1` | the band under every parapet in the reference |
| `dome` | `limestone.1` | curved masonry, no coursing |
| `wood` | `dust.6` | balconies, doors, ladders, stair treads |
| `glass` | `shadow.0` | openings read as depth |
| `metal` | `gunmetal.2` | corrugated iron, roller doors, roof tanks |

The roof deck is the direct fix for the 16% bare white: the roof is currently the
top face of a wall cube, so it takes the wall material and the 55° key hits it
hardest. A separate object on a darker tone can be lit correctly.

## Palette: a terracotta ramp

The reference's trim is terracotta red. The palette has no red-orange outside
`vfx.ember`, which is reserved. Rather than settle for a brown stripe, the
palette gains a three-step `terracotta` ramp — the same move that fixed the
mosque when `limestone` and `dust` were widened.

Muted brick red, dark enough to read as a band against `limestone` and far enough
from `dust` that the quantizer does not start stealing sand pixels — candidates
`#C1663F`, `#9E4F30`, `#7A3B24`, to be confirmed by measuring what the quantizer
does to the existing sheets.

`total_colors` 39 → 42. `validate_data.mjs` checks that count and nothing else
about ramps; `vite-plugin-palette.ts` publishes `--rl-terracotta-*` automatically
by iterating `Object.entries`, so `theme.css` needs no change and `validate:ui`
is unaffected.

Existing sprites stay valid without re-quantization: the gate asserts every pixel
*is* a palette colour, and adding colours cannot break that. (They are being
re-rendered anyway, for the elevation fix.)

## The parts kit

`tools/buildings/kit.py`, imported by each authoring script:

`parapet`, `merlon_row` (square and triangular), `trim_band`, `zigzag_frieze`,
`arch_opening`, `roof_deck`, `external_stair`, `stilted_balcony`, `mashrabiya`,
`dome`, `roller_door`, `roof_tank`, `lean_to`.

Each returns objects already tagged with `rl_role`. Consistency is structural —
every parapet in the game is one function — while distinctness stays authored per
type. That is exactly the split the discarded generator got backwards: it bought
consistency free and distinctness not at all.

One script per type, `tools/buildings/author_<type>.py`, composing parts and
saving `art/src/buildings/<type>.blend`. The `.blend` is the committed source,
per CLAUDE.md's rule against sprites without sources; the script is the record of
how it was made, and makes a later variant an argument change rather than new
design work.

## The five buildings

Footprints are taken from `data/maps/beit_sahwan_outskirts.json`, not invented.

| type | footprint | world plan | height | signature that breaks the outline |
|---|---|---|---|---|
| `shanty` | 3×3 | 9×9 | 2.6 | mono-pitch corrugated lean-to, no parapet, oil drums, irregular plan |
| `house` | 4×3 | 12×9 | 6.7 | external stair to the roof, stilted mashrabiya bay, square merlons, zigzag frieze |
| `warehouse` | 4×4 | 12×12 | 6.5 at ridge | long metal ridge, roller door, ridge ventilators, loading dock, **no parapet** |
| `apartment` | 5×4 | 15×12 | 9.7 | stepped setback, triangular merlons, two roof tanks, stair tower above the roofline |
| `concrete` | 3×3 | 9×9 | 6.1 | blank unwindowed walls, heavy overhanging cornice, roof vents, sandbag revetment |

`concrete` is included although no map places it yet. It is otherwise the only
type left falling back to the extrusion.

### Distinctness is the requirement, and it is measured

The gate fits its camera to horizontal extent, so relative height survives as a
silhouette lever — but proportion alone will not carry this. Height-to-width:

```
shanty     0.29
warehouse  0.54  ┐ risky pair
house      0.56  ┘
apartment  0.65  ┐ risky pair
concrete   0.68  ┘
```

Both risky pairs are separated by roof form and attachments rather than
proportion, and that is the bet the whole approach rests on. So:

- Author in **increasing risk order** — shanty, warehouse, house, apartment,
  concrete — measuring each against every already-accepted building *and* the
  mosque before moving on.
- Work to a **0.85 ceiling**, under the gate's 0.88, so there is headroom.
- Named fallbacks, decided now rather than under pressure: lengthen and raise the
  warehouse ridge; deepen the apartment setback and raise its stair tower; lower
  the concrete block and widen its cornice overhang.

This matters past the gate. Flattening a mosque costs 30 ROE points and an
apartment 14, against 3 for a warehouse. A player who cannot tell them apart
cannot make that decision.

## Out of scope

- **Sprite variants per type.** One sprite per type. The two houses on the only
  existing map are 20 tiles apart and rarely co-visible, and supporting variants
  means a manifest variant axis, a renderer change, and teaching the gate not to
  compare a type against itself. The kit already parameterises stair side and
  window rhythm, so adding them later is re-running a script.
- **The reference's props** — stalls, fountains, crates, produce. Not structures
  in the data model.
- **Changing `validate_assets.py`.** Buildings keep being compared against units.
  The mosque passes today; the claim that the others will is a measurement to
  take, not a reason to change the gate in advance.
- **Changing `structures.json`.** `height_px` still drives the extrusion path and
  is correct there.

## Staging

This is one coherent piece of work but a large diff, and two parts of it are
independently verifiable. The implementation plan should stage them so a failure
is attributable:

1. **Palette** — terracotta ramp, `validate:data` and `validate:ui` green.
2. **Elevation** — 30° everywhere, re-render all 353 existing sprites,
   `validate:assets` green with silhouettes that all changed. Nothing about
   buildings is involved, so a newly-failing unit pair is unambiguously this.
3. **Render pipeline** — `SIZE`, margins, derived `scale`, roles, framing
   assertion, `badgeTopPx`; re-render the mosque alone and confirm it improves.
4. **Kit and the five buildings**, one at a time in risk order, with the IoU
   table growing as each is accepted.
5. **Wiring and the badge fix**, verified by driving the app.

## Verification

Nothing here touches `@lions/sim`, so the determinism hash must not move — that
is itself a check, not an assumption.

- `pnpm validate:assets` — palette conformance, ≥6% fill, framing, pairwise IoU.
  Must pass with **358 sprites across 15 sheets**, 12 of which the gate compares
  pairwise (the three turret layers are excluded as composites), against 353 / 10
  / 7 today.
- The building-vs-building IoU table, printed and recorded, with every pair under
  0.85.
- `pnpm validate:data` — `total_colors` 42.
- `pnpm validate:ui`, `pnpm test`, `pnpm test:determinism`.
- **Drive the app in the browser** and look at all six buildings on the map: that
  each sits on its footprint, that units occlude correctly front and back, and
  that integrity bars and garrison pips sit above the art. Console pokes do not
  count — they skip the code that breaks.

The Blender MCP, if connected, gives viewport screenshots during authoring so
each building can be looked at before it is rendered. It is an inspection aid,
not the authoring route: the scripts remain the source of truth.
