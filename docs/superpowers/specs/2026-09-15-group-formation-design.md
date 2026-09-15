# Group formations and destination slots — design

**Date:** 2026-09-15 · **Status:** approved by the lead in conversation, section by
section; this document is the record. **Downstream:** `writing-plans`, then `sim-guard` /
a sim implementer (the slot function, the command branch, the harness re-pins),
`playtest` (the sandbox walk and the screenshot sheet).

## 1. The problem

Units ordered to the same point stop on the same point. Measured on `main` @ v0.63.0:

- A multi-unit order is one command with one point. `packages/app/src/input/intents.ts`
  turns the `order` intent into a single `{ kind: 'move' | 'attackMove', ids, x, y }`
  (`intents.ts:49-59`), whatever the selection size.
- The sim gives every selected unit in the same movement domain the identical continuous
  goal and the same cached flow field: `applyCommands`' move branch
  (`packages/sim/src/sim.ts:1886-1953`) computes one `(ux, uy, uf)` per domain — foot,
  vehicle (snapped to the nearest open vehicle tile), air — and writes it to
  `goalX/goalY/fieldRef` for every id.
- Arrival is exact equality with the goal (`sim.ts:4813`), and nothing on open ground tracks
  occupancy: `stOccupants` / `tnOccupants` gate structures and tunnels only. So the units
  really are at one coordinate, and both renderers draw `posX/posY` verbatim
  (`ThreeRenderer.ts:2383-2389`; `renderer.ts:736-746`). The overlap is a sim fact.
- Roads carry no width signal: `r` is decor-only in `packages/data/src/map.ts:212`,
  mechanically open ground. "Street" has to come from the blocked mask.
- GDD §7 says one flow field per destination group, shared by all members. The shared field
  is not the defect; the missing piece is per-unit destinations.

The same shape produces the second complaint: a selection has no order of battle, so a
mixed group arrives as a heap with the tank wherever the field put it.

## 2. Decisions taken by the lead (2026-09-15)

| # | decision | consequence |
|---|---|---|
| D1 | **Destination only.** Units never stop on the same spot; they may still pass through each other en route. | No local avoidance in the movement loop. En-route separation is a separate, later project if wanted. |
| D2 | **Vehicles spaced, infantry tight.** Vehicles and aircraft keep an empty tile between them; infantry one team per tile. | Slot spacing 2 for the vehicle ranks, 1 for infantry. |
| D3 | **Front rank on the click.** The vehicles stop on the row that was clicked, facing the way they travelled; infantry ranks form behind, back toward where the group came from. | The click is where the lead stops; the formation extends away from the click, not around it. |
| D4 | **Approach A: the sim assigns slots at command time.** | The command stays one point; the app, the renderer and the replay format are untouched; scripted waves and playtest plans get formations for free. B (the app splits the order) and C (spread on arrival) rejected — §7. |

## 3. Scope

In: the slot function, the per-side goal reservation map, the move / attack-move branch of
`applyCommands` and the waypoint queue, a bound on the flow-field cache, the golden hash
re-pin, the playtest and balance re-runs, the sandbox world-state walk, a screenshot sheet.

Out: separation while moving (D1); a street detector — the blocked mask is the detector;
formation facing for combat or any change to targeting, engagement, cover or detection;
garrison, board, dig, charge and demolish orders, which target a structure or a route;
Pixi and `&nomesh`, which draw whatever positions the sim produces exactly as `three`
does; any renderer change at all.

## 4. Design

### 4.1 Slot geometry

A formation is a grid of tiles behind the click. Its frame:

- **Approach direction** `D`: the vector from the group's centroid to the click point,
  quantised to the nearest of the four axes by comparing `|dx|` and `|dy|` (ties: the x
  axis). Ranks run perpendicular to `D`; depth runs back along `-D`. A diagonal approach
  therefore forms an axis-aligned block; diagonal ranks are a later refinement (§7).
- **Front rank**: the tile row through the click tile, perpendicular to `D`. The click tile
  is lateral offset 0.
- **Lateral fill order**: 0, +1, −1, +2, −2, +3, −3 (the positive side is `D` rotated a
  quarter turn clockwise in map space, fixed so the result is deterministic).
- **Ranks**: vehicles and aircraft take the front ranks, infantry the ranks behind. Within a
  class, units are placed in ascending entity id, so the same order with ids shuffled gives
  the same assignment.

The numbers, all named constants in `formation.ts` with this table's reason beside them:

| constant | value | what it does |
|---|---|---|
| `MAX_LATERAL` | 3 tiles | a rank is at most 7 tiles wide: 7 infantry or 3 vehicles (offsets 0, ±2) |
| `VEHICLE_SPACING` | 2 tiles | between vehicles sideways and between vehicle ranks |
| `INFANTRY_SPACING` | 1 tile | one team per tile, infantry ranks one tile apart |
| `VEHICLE_TO_INFANTRY_GAP` | 1 tile | the first infantry rank sits one tile behind the last vehicle rank |
| `SEARCH_RADIUS` | 8 tiles | how far from the click a slot may be before overflow |

So a 15-unit group with four vehicles in the open: three vehicles on the front row at
offsets 0, +2, −2; one vehicle on the row two behind; seven infantry on the next row; four
on the row after. Depth five tiles. A single unit is the same function with one id: the
click tile if free, else the nearest free connected tile (§4.3) — the smallest behaviour
change in the feature, and it is the bug fix.

### 4.2 Passability and connectivity: the width rule

A slot is valid only if its tile is passable for the unit's domain AND connected to the
click tile through passable tiles of that domain within `SEARCH_RADIUS` (a breadth-first
walk from the click tile over `maskFor(domain)`, neighbours visited N, E, S, W). Both
halves matter: a tile on the far side of a wall is passable but not a slot.

That is the whole width rule. In a two-tile street the lateral offsets beyond the walls
fail the passability test, so ranks fill backward and the group forms a column with the
vehicles at its head. In open ground the lateral offsets exist and the group forms a wide
block. Vehicles cannot take boulder (`b`) or ditch (`d`) tiles and infantry can, so the
same order into the Tel Marum corridor puts the infantry inside the field and the vehicles
at its mouth — the vehicle mask is already `blocked | boulder` (`Sim.maskFor`).

Air units use the foot passability set for their slot, as they use the foot flow field
today (`sim.ts:1893`); en route they ignore terrain as before.

**Overflow.** When the grid inside `MAX_LATERAL` and `SEARCH_RADIUS` runs out — walled
off, or more units than it holds — the remaining units take the nearest free connected
tiles by walk distance from the click, vehicle spacing dropped if nothing spaced is left.
A unit that finds no free tile at all keeps the click as its goal, as today. That is the
only path that can still stack, and it needs a group larger than the free ground within
eight tiles of the click.

**Snapping.** A click on a blocked tile snaps to the nearest open tile per domain first,
exactly as the move branch does now (`nearestOpenTile`); the search starts from the
snapped tile. The click tile's own centre is used for offset 0 rather than the raw click
point, so every slot is a tile centre; the single-unit case moves from "the exact click
point" to "the click tile's centre", at most half a tile.

### 4.3 Reservation

The sim keeps one **reservation map per side**: tile → the id of the living unit whose goal
tile it is, with the inverse (`goalTile[id]`) beside it. A unit's goal tile is reserved from
the moment its order lands until it is re-ordered, boards, garrisons, is buried or dies. An
idle unit's goal is its standing tile (spawn sets goal = position), so idle units reserve
where they stand.

Slot assignment releases the current order's own units first, then skips tiles reserved by
any other same-side unit. That one map covers every stacking case: a group on one click,
two groups on the same click at different times, and a single unit sent onto an idle friend,
which now stops on an adjacent free tile.

Enemies are not reservations. An attack-move still closes on the position; combat resolves
it. A unit passing through a tile does not reserve it — only goals do — so a column moving
through a square does not fence the square off.

### 4.4 The command branch

The command is unchanged: one point, one list of ids. In `applyCommands`' move /
attack-move branch the per-domain `(ux, uy, uf)` is replaced by a call to

```
assignFormation(ids, clickTile, centroid, masks, reservations) -> Map<id, tile>
```

in `packages/sim/src/formation.ts`, a pure function with no access to `Sim`. The branch then
sets `goalX/goalY` to each slot's tile centre, `fieldRef` to `fieldFor(slot, domain)`, and
the reservation. Everything else the branch does — cancelling demolition and charge orders,
leaving a structure, clearing the stance — is untouched.

**Queued orders (shift).** The waypoint arrays are already per unit (`wpX/wpY`). Slots for a
queued point are computed when the order is *issued*, with the approach direction taken
from the previous point in the queue (the group's centroid is unknowable for a future
point, and the previous click is where it will be coming from), and stored per unit as its
waypoint. Every point in a route therefore has its own formation, re-oriented at every
turn, and activation on arrival stays what it is today.

**Attack-move** uses identical slot assignment for the destination; engagement en route is
untouched. **Scripted enemy waves and playtest plans** send the same command, so enemy
groups stop stacking too.

### 4.5 Determinism and cost

Everything runs inside the command step in fixed-point: the centroid is an integer mean of
positions, the direction a comparison of two deltas, the walk visits neighbours in a fixed
order, and ids are processed sorted. No random draw is needed, so no per-entity stream is
touched. Data flow stays commands in, state out.

The walk touches at most `(2·SEARCH_RADIUS + 1)² = 289` tiles per order. Each slot gets its
own cached flow field, so a twelve-unit order can compute up to twelve fields instead of
one, each a 2304-cell sweep on a 48×48 map. **The field cache is unbounded today**:
`fieldFor` (`sim.ts:1722-1734`) appends to `this.fields` and keys `fieldByGoal` by tile with
no eviction, so a long mission would accumulate a field for every slot tile ever used. The
plan's first task adds a cap (least-recently-issued eviction with the count as a named
constant, sized from a measured playtest run), because `fieldRef[id]` indexes `this.fields`
and eviction has to keep every index a living unit still holds valid.

This is a recorded deviation from GDD §7's "one field per destination group": one per
slot tile. The spec's own "Deviations" entry carries the measured cost once the plan has
it.

### 4.6 What moves

- **The golden determinism hash** (`packages/sim/src/determinism.test.ts`). Goals feed
  `Sim.hash()`, so it changes by design; it is re-pinned in the same commit with the reason,
  the one way CLAUDE.md allows.
- **`pnpm playtest`.** Every scripted plan sends group orders, so arrival timing shifts by
  seconds. Every mission must still return its expected verdict inside its budget; a plan
  that flips is investigated, never tuned away.
- **`pnpm balance`.** Formation spacing changes engagement geometry, so the §5.7 targets are
  re-run. A target that leaves its tolerance band is a design signal that stops the work for
  a decision; it is not retuned silently.
- **The visual gate.** The gated scenarios order at most a single unit onto free ground, so
  no baseline is expected to move; the CI numbers say whether one did, per the standing rule,
  before anything is blessed.

## 5. Testing

`packages/sim/src/formation.test.ts`, each case on a hand-built map:

- **Open ground.** 15 units, 4 vehicles: three vehicles on the front row at offsets 0, ±2,
  one on the row two behind, seven and four infantry on the two rows after, every tile
  distinct.
- **Two-tile street.** The same group forms a column: vehicles at the head, infantry behind,
  nothing on a wall tile.
- **Boulder corridor.** Infantry inside the field, vehicles at its mouth.
- **Four approach directions.** The same group from each side gives the rotated grid, front
  rank on the click.
- **Reservation.** Two groups clicked on one tile get disjoint tiles; a single unit sent onto
  an idle friend stops on an adjacent free tile; re-ordering a group releases its old tiles
  first; a dead unit's tile is free.
- **Air** joins the vehicle ranks with vehicle spacing and foot passability.
- **Overflow.** More units than the grid holds fall back to nearest free connected tiles;
  more units than free tiles keep the click.
- **Waypoints.** A two-point route gives each unit two slots, the second oriented from the
  first click to the second.
- **Determinism.** Ids shuffled give the same assignment; two runs give the same `hash()`.

Whole-system, in the same plan: the golden hash re-pinned with its reason; the playtest
chain green; the balance targets inside their bands; a sandbox world-state walk
(`tools/src/`, the `walk_*` pattern) that orders the task force into the open and into a
town street, prints every living unit's tile, and asserts no tile appears twice; and a
screenshot sheet of both at zoom 1.6 for the lead.

## 6. Sequencing for the plan

1. The field cache bound, measured and tested on its own, so the tree never holds an
   unbounded cache under a feature that multiplies fields.
2. `formation.ts` and its tests, pure, with the constants table.
3. The reservation map and the command branch, waypoints included; the golden hash
   re-pinned in the same commit with the reason.
4. Playtest and balance re-runs, the sandbox walk, the screenshot sheet, and the docs:
   CLAUDE.md's "Known scaling debts" gains the field-cache bound, GDD §7 gains the
   one-field-per-slot sentence, and the queue's entry closes.

## 7. Rejected and deferred

- **B, the app splits the order into per-unit commands.** The app would need its own copy
  of the blocked and boulder masks and the vehicle rule (a fourth cover loop), mission
  scripting and enemy waves would keep stacking, and a twelve-unit order becomes twelve
  commands in every replay.
- **C, spread on arrival.** No formation control, vehicles-first inexpressible, groups
  visibly shuffle on arrival. Its one good idea — idle units count as occupying their tile —
  is kept as the reservation map.
- **Deferred:** separation while moving (D1); diagonal ranks for diagonal approaches; a
  cover preference for infantry slots (put teams on cover tiles inside the block first);
  per-slot ghost markers in the UI instead of the single order marker.
