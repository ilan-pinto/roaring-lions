# The street and the landscape

**Date:** 2026-08-07
**Issue:** [#38](https://github.com/ilan-pinto/roaring-lions/issues/38) follow-on
**Status:** approved, ready for implementation planning
**Scope:** Spec A of two. Spec B adds the `market`, `school` and `hospital`
building types and their art, along the street this one lays.

Beit Sahwan is currently seven buildings scattered on a featureless plain. This
gives it a street, an olive landscape and some relief, and it fixes the reason
adding a building type needs engine edits.

## Why this is Spec A and not the whole request

The full request — three civic building types, a road, more buildings, olive
groves and hills — is larger than the entire six-building set that preceded it.
It also mixes two different risks. A map redesign either works or does not, and
you can see which in a minute. Three new buildings take the pairwise silhouette
matrix from 15 pairs to 36, and the last round proved that flat-roofed rectangles
cluster hard at the gate's limit.

The split follows the real dependency: buildings cannot front a street that does
not exist. So the street and the landscape come first, with no new buildings, and
Spec B places civic buildings on the frontage this creates.

## Hills are decoration, not elevation

The sim's entire terrain model is two arrays — `blocked` (0/1) and `cover` (0–3),
both `Uint8Array`. There is no elevation concept anywhere in `@lions/sim`.

Real elevation would be a third array reaching into detection, line of sight,
flow-field pathing and fixed-point movement — every invariant-critical system —
and would move the determinism hash. That is a combat-model feature deserving its
own spec and balance pass. It is explicitly **not** this.

So "hills" here are rocky knolls: relief that carries **cover**, not height. That
is an honest reading rather than a cheap one. GDD §5.8 says the model is shown,
not hidden, and terrain that looks like it should shelter a squad and does not is
exactly the failure that section warns about. A knoll gives cover because rocks
give cover; it grants no sight line because it has no height.

## Adding a structure type should not need engine code

CLAUDE.md is explicit: *"Adding a unit means adding JSON, never engine code. If a
new unit requires an engine change, that is a signal the data model is missing a
concept."* Structures violate this today, in three places at once:

- `data/structures.json` declares a `symbol` for every type — and **nothing reads
  it.** The field is dead.
- `packages/data/src/map.ts` hardcodes `STRUCTURE_SYMBOLS` as a duplicate of it.
- `data/schemas/map.schema.json` hardcodes the same symbols a third time, in the
  regex `^[.123#hawsm]+$`.

Spec B would have to edit all three to add three types. So this spec fixes it
first:

**`map.ts` derives the table** from `../../../data/structures.json`, imported
directly. That is the path `packages/data/src/index.ts` already uses for the same
file, and importing the JSON rather than the barrel avoids a cycle — `index.ts`
re-exports `parseMap`, so `map.ts` must not import `index.ts`. `parseMap(json)`
keeps its signature, so `main.ts` is untouched.

**The schema regex becomes `^[.0-9A-Za-z#]+$`** — still tight enough to reject
whitespace, control characters and punctuation typos, but no longer a list of
symbols that must be remembered. The real check moves to `validate_data.mjs`,
which cross-checks that every character used in every map is either a declared
terrain symbol or a declared structure symbol. That file already does exactly this
shape of check for vfx `palette_ref`s. The gain is not tidiness: a hardcoded regex
silently accepts a symbol the loader will reject, and a cross-check against the
catalogue cannot drift from it.

## Three terrain symbols

| symbol | meaning | blocked | cover | decor |
|---|---|---|---|---|
| `r` | dirt road | 0 | 0 | `road` |
| `o` | olive grove | 0 | 1 | `grove` |
| `n` | rocky knoll | 0 | 2 | `knoll` |

Letters, not punctuation, to keep them clear of regex and JSON escaping edge
cases. They are terrain, so they live in `map.ts`'s `LEGEND` beside `.` and `1`–`3`
rather than in `structures.json`.

Cover is not new machinery: `o` and `n` reuse levels 1 and 2, so the sim sees
what it always saw. What is new is that a cover tile can now say *what kind* of
cover it is.

## The decor layer, and why it never enters the sim

`ParsedMap` gains `decor: Uint8Array` with an exported enum:

```ts
export const DECOR = { none: 0, road: 1, grove: 2, knoll: 3 } as const;
```

`main.ts` already walks the parsed map to call `sim.setCover`. It will
additionally hand `decor` to the renderer directly.

**Decor must not go through the sim.** Invariant 4 makes data flow one
directional — commands in, sim, state and events out — and nothing outside the
sim may mutate sim state. Whether a tile draws a tree or a rock changes no
outcome, so putting it in `Sim` would add a field the sim never reads, widen the
state the determinism hash covers, and invite exactly the coupling the invariant
exists to prevent. The renderer already reads `sim.cover` for the mechanical
part; the cosmetic part comes from the map.

## Renderer

A `setDecor(decor: Uint8Array)` method that stores the array and marks terrain
dirty, plus three branches in `drawTerrain`'s open-ground path.

- **Road** — packed earth with wheel ruts, and the pebble scatter suppressed, so
  the street reads as swept rather than strewn.
- **Knoll** — a cluster of rock shapes over the cover fill, low enough to stay
  flat in the terrain graphics.
- **Grove** — trunk bases in the terrain graphics, and **canopies as
  depth-sorted objects in `spriteLayer`**, keyed by `depthZ` exactly as buildings
  are. A tree is tall enough that a soldier behind one must be occluded by it;
  drawing canopies flat would put every unit on top of every tree. This is the
  same per-tile display-object pattern `drawBuildingTile` already uses, cleaned up
  on rebuild the way `buildingTiles` is.

Every colour resolves from a palette key through `this.opts.resolveColor` — road
`dust.3`, canopy `scrub.0` and `olive.1`, trunk `dust.6`, rock `limestone.5` — with
no hex literals. `renderer.ts` is outside `validate:ui`'s scope and already
contains literals, so this is a convention the file does not yet hold to; new code
should not add to that.

## The map

A crossroads on the `town_center` marker at `[31, 22]`, laid concretely rather
than impressionistically so the result is checkable:

- **East–west street**, `y = 21–22`, `x = 19` to `x = 40` — the full width of the
  `town` zone `[19, 9, 22, 31]`, ending at both zone edges rather than in mid-air.
- **North–south street**, `x = 31–32`, `y = 14` to `y = 20`, meeting the east–west
  street in a **T-junction** on the `town_center` marker `[31, 22]`.
- **Southern spur**, `x = 26–27`, `y = 23` to `y = 34`, serving the southern
  blocks.

Streets are two tiles wide because one tile reads as a footpath at this zoom and
vehicles draw wider than a tile.

**These bounds are solved, not sketched.** A first pass at
`y = 22 / x = 31 (y 10–39) / x = 24–25` put six street tiles straight through two
buildings, because the shanty occupies x22–24 rather than the x21–23 a quick read
of the row suggests, and the house's last column is x31. The geometry above was
checked against the grid and yields:

```
82 street tiles
  on buildings      : 0
  outside town zone : 0
  inside clinic zone: 0
  cover cleared     : 5
  town_center on street: yes
  kdf_assembly / mortar_line / civ_refuge: all clear
```

The north–south street starts at `y = 14` rather than `y = 9` to clear the northern
house (rows 10–12) and its cover ring at row 13; the southern spur stops at
`y = 34` to clear the southern apartment (rows 36–38) and its ring at row 35. The
plan must re-run this check after editing the rows, because an off-by-one in a
character grid is invisible by eye.

**Why a T and not a crossroads.** Carrying the north–south street south of the
junction would run it through the `clinic` zone `[29, 23, 6, 6]` — tiles x29–34,
y23–28 — leaving two-tile slivers either side and nowhere to put the hospital Spec
B needs there. A T-junction leaves that block whole and fronting the street, which
is what a clinic on a main road should look like. The southern spur at `x = 24–25`
serves the south without touching it. The east–west street stops at `y = 22` for
the same reason: at `y = 23` it would clip the clinic zone's top row.
- **Olive groves**, three clusters of roughly 8–14 tiles each: west of the town
  around `x = 8–14, y = 14–20`, south around `x = 18–26, y = 40–44`, and a small
  one north-east around `x = 36–42, y = 10–14`.
- **Rocky knolls**, two clusters of roughly 6–10 tiles: east near `mortar_line`
  around `x = 40–46, y = 27–33`, and north-west around `x = 6–11, y = 30–35`.

Exact tile-by-tile placement is the plan's business; these bounds are what the
result gets checked against.

These stay clear, because missions place units on them:
`kdf_assembly [4, 23]`, `mortar_line [44, 24]`, `civ_refuge [22, 45]`, and
`player_start [4, 23]`.

No buildings are added or moved. Existing cover is only cleared where the street
crosses it, and the street is `blocked: 0` throughout, so flow-field pathing gains
no new obstruction.

## Verification, including what cannot be automated

The determinism hash cannot move: `determinism.test.ts` builds its own synthetic
cover (`sim.setCover(x, 20, 2)`) and never loads a map. `pnpm balance` never loads
a map either — it is a headless duel backtest. **So neither can detect a
mission-balance shift from added cover, and there is no mission-balance harness.**
That risk is real and unmeasured, and the honest mitigation is to quantify and
inspect rather than to claim a test covers it.

The current budget, measured, as the baseline to report against:

```
48 x 48 = 2304 tiles
  '.'  2054  89.1%      cover tiles: 154 (6.7%)
  '1'    22   1.0%      weighted cover sum: 286
  '2'   132   5.7%
```

So:

- `pnpm test` — `map.test.ts` grows from 4 tests to cover the new symbols'
  blocked/cover/decor triples, the derived symbol table agreeing with
  `structures.json`, and an unknown symbol still throwing. Data layer only:
  CLAUDE.md says combat maths requires tests and rendering does not.
- `pnpm validate:data` — the new map-symbol cross-check passes, and rejects a
  deliberately typo'd symbol when tried by hand.
- `pnpm test:determinism` — 4/4 and the hash unmoved, which is a check that decor
  really did stay out of the sim.
- `pnpm validate:assets`, `pnpm validate:ui`, `pnpm typecheck`, `pnpm lint`.
- **Report the cover budget delta** — tile counts and weighted sum, before against
  after — so the balance shift is a number rather than a shrug.
- **Drive all three missions in the browser**: each loads, the street reads as a
  street, units path along it, a soldier behind an olive canopy is occluded by it,
  and each mission's objectives remain reachable.

## Out of scope

- **Elevation.** Reasoned above. Worth its own spec if wanted.
- **Roads affecting movement speed.** That is a sim change to movement, and it
  needs a balance pass. A road that looks passable and is passable is honest;
  making it fast is a feature, not a fix.
- **New buildings.** Spec B.
- **A second map.** The three missions depend on this one's markers and zones, so
  improving it is what makes them look better.
