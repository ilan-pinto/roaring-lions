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

## 8. Deviations

Six, each with the ledger ruling it came from (`.superpowers/sdd/2026-09-15-group-formation/progress.md`).

1. **The reservation "map" is derived per order, not persistent state.** §4.3 describes
   "one reservation map per side" as if it were kept; it is instead built fresh by a scan
   of every living same-side unit outside the order (`Sim.reservedTilesFor`), O(units) per
   order. A scan needs no bookkeeping at any of the sites that set `goalX`/`goalY`, and
   orders are rare next to ticks — the alternative was a persistent structure that every
   boarding, garrisoning, burial and death would have to keep honest.
2. **The clicked unit's slot keeps the exact click point; every other slot is a tile
   centre.** §4.2's "moves by up to half a tile" is retracted: snapping every slot to a
   tile centre, including the one under the cursor, broke `umm_zeitoun_1_recon` and the
   unlock-gate probes (both depend on a single-unit order landing on the exact point
   clicked, which is the pre-formation behaviour for that one case). The unit whose slot
   IS the click tile has no reason to move off it — the tile is its alone either way — so
   it keeps the fraction; a unit the formation displaced has no clicked point of its own
   to keep, so it takes its slot's centre.
3. **`move`/`attackMove` gained `exact?: boolean`.** For orders the sim issues to itself to
   shepherd a unit to a point a rule already chose — `CivilianFlight`'s two move commands
   are the sole intended caller — rather than a point a player clicked. An exact order
   keeps its point verbatim and is assigned no slot (the formation machinery is skipped
   outright), but it still reserves its goal tile against everyone else's slots: it opts
   out of being placed, not out of being avoided. A patrol leg (`mission.ts`'s
   `stepPatrols`) is deliberately NOT exact — it is an ordinary order, because a patroller
   whose waypoint tile is held by an idle friend should stop beside it rather than
   displace it (§4.3).
4. **A front unit anchors its grid at its own domain's snapped origin; infantry anchors at
   the click.** Reconciles §4.1 ("infantry behind vehicles") with §4.2 ("infantry inside
   the corridor, vehicles at its mouth"): a vehicle or air unit ranks from the tile its OWN
   mask snaps the click to, while infantry ranks from the click tile itself; infantry starts
   behind the last front rank only when that rank shares the click's own anchor, else from
   rank 0. Overflow — more units than the grid inside `SEARCH_RADIUS` holds — is
   behind-first: a candidate tile ahead of the front rank (positive projection onto the
   approach direction) is taken only once no tile at or behind it is free. This is how a
   click inside the Tel Marum boulder corridor puts the infantry inside the field (anchored
   at the click, which the foot mask accepts) and the vehicles at its mouth (anchored at
   the nearest vehicle-open tile, which the boulder mask pushes back to the entrance).
5. **The `FlowField` compute-heap scratch is shared module-wide, and the pool is bounded.**
   `compute`'s heap arrays (`heapTile`/`heapCost`, 8×4 B/cell each) moved from per-instance
   fields to a module-level scratch grown once to the largest map seen and reused by every
   field's `compute` call — safe because `compute` always resets `heapSize = 0` and writes
   from index 0, so nothing reads stale contents across calls. On a 48×48 map (2304 cells)
   that took a `FlowField` instance from 158,976 B (dirs + cost + its own heap) to 11,520 B
   (dirs + cost only); the shared scratch itself costs 147,456 B once, not per field —
   "147 KB of a 160 KB field." The pool (`this.fields`) is bounded at `MAX_FLOW_FIELDS = 128`
   with live-safe least-recently-issued reuse (`Sim.evictableField`), which additionally
   never evicts a field issued earlier in the SAME tick — without that guard, a mixed-domain
   order (an air or vehicle id ahead of a plain ground id in one command) could recompute
   the ground unit's own just-created field for the earlier id's goal before the ground
   unit's loop iteration had stamped it into `fieldRef`, corrupting which field the ground
   unit ends up following. At the cap, the pool costs ~1.41 MiB (128 × 11,520 B) plus the
   one-time ~144 KiB scratch.
6. **Scripted enemy groups forming up moved the fire geometry of two missions; their
   contracts were re-sited by content, the engine untouched.** §4.4 says scripted waves send
   the same command and so stop stacking too — true, and its consequence was not scoped in
   §4: `beit_sahwan_breach`'s passive-control contract (must DEFEAT with no player orders)
   and `qarn_hadid_3_clearance`'s gate-open contract (must VICTORY with one extra fielded
   unit) both flipped, because an enemy `commit`/`reinforce` group that used to converge on
   one point now spreads into a formation whose slots land on or near civilian spawn tiles
   and rally markers. Diagnosed to the mechanism (not tuned around): First Light's NE family
   pair now sits inside a formed-up militia cell's suppression footprint from the first
   minute and self-evacuates before the player can act; Qarn Hadid's families used to sit
   beyond the reach of anything but a walking escort and now the nearest body — after
   formation puts vehicles in the front ranks — is an IFV nobody drives to the clinic. Both
   were re-sited (First Light's two civilian groups moved off the fire; Qarn Hadid's moved
   off `village_square`, the enemy's own rally tile) rather than the engine changed; see
   `.superpowers/sdd/2026-09-15-group-formation/task-5-report.md`.

**Measured costs.**

*Fields per order.* One cache miss per unit ordered, at most — measured on
`tel_marum_2_foothold`'s 9-unit `starting_force` ordered as a whole into the open basin:
`sim.flowFieldCount` went from 0 to 9 (`tools/src/formation_walk.test.ts`). The pool bound
(Deviation 5) only becomes visible once a mission's distinct goal tiles exceed 128 in a
single tick, which no shipped mission has been measured to reach.

*`pnpm playtest`* (Task 4, re-run at `a809aaf`, seed 424242; the two lines Deviation 6
restored, against the `75461bc` baseline before enemy formations landed, from Task 3's
report):

| line | `75461bc` (before formations) | current (after Task 5's re-siting, `a809aaf`) |
|---|---|---|
| `beit_sahwan_breach (passive control)` | DEFEAT, 4.5 min, ROE 97, `evac_settlements=f` | DEFEAT, 4.5 min, ROE 97, `evac_settlements=f`, roster 10 |
| `qarn_hadid_3_clearance (gate open)` | VICTORY, 2.8 min, ROE 86, `get_the_families_clear=c` | VICTORY, 3.6 min, ROE 80, `get_the_families_clear=c`, 2 stars, roster 24 |
| `gate breach_team` / `scout_shachaf` / `apc_kipod` | OPEN at 12 / 31 / 45 | OPEN at 12 / 31 / 45 |

Qarn Hadid III's own time and ROE moved from the pre-formation baseline (2.8 min, ROE 86 →
3.6 min, ROE 80) because Task 5 re-sited its village families off `village_square` to keep
them clear of the enemy's own rally tile (Deviation 6) — the contract (VICTORY, 2 stars)
holds; the minutes and ROE are the price of that placement, not a regression left open here.

The whole chain is green (exit 0, no `FAILED` lines) at HEAD. Full output in
`.superpowers/sdd/2026-09-15-group-formation/task-4-report.md`.

*`pnpm balance`* — **a target left its band, and per §4.6 this stops the work for the
lead's decision rather than being retuned silently.** Before (`main` @ `65cc56d`, the
commit this branch started from) all five §5.7 targets passed, including "Urban assault
force ratio" at win rates `1:1=0% 2:1=15% 3:1=95% 4:1=100%`. After (this branch, HEAD
`a809aaf`), the same measurement reads `1:1=0% 2:1=70% 3:1=100% 4:1=100%` — the other four
targets unchanged and passing, but the 2:1 rate now fails the target's own `<=60%` cap
(target: "1:1 fails, 3:1 reliable (>=65%)"). The urban-assault backtest orders each of its
three assault groups with one `attackMove` per group (`tools/src/backtest/targets.ts`), so
it is exactly the kind of group order this spec changes: those groups now land in
formation instead of converging on one point, which is engagement geometry, and formation
spacing changing engagement geometry is what §4.6 predicted this backtest would be
sensitive to. Nothing under `packages/sim/src/tuning.ts` was touched to produce or fix this —
retuning is out of this task's scope by the rule quoted above. Recorded here as a STOP for
the lead, not resolved.


