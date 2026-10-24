# Vehicle separation: vehicles in a group stop driving through each other (GH-421, PA-10) — design

**Date:** 2026-10-23 · **Status:** PROPOSED, for the lead. Nothing in `packages/sim` changes on this
branch. **Supersedes** the design half of `docs/superpowers/plans/2026-10-11-vehicle-spacing.md`
(the "push" design, parked on `feat/vehicle-spacing` @ `7e8371e3` by the lead's ruling of 18 Oct).
**Plan:** `docs/superpowers/plans/2026-10-23-vehicle-separation.md`. **Instrument:**
`tools/src/backtest/vehicle-overlap-probe.ts` (`pnpm --filter @lions/tools vehicle-overlap:probe`).

The 18 Oct ruling, on GH-421: "When this resumes, start from a softer design (separate only
stationary vehicles, or only movers) and re-measure." This document measures first, then
prototypes the softer designs and reads their cost through the same gates that stopped the push
design. The short answer is in §6: the softest change (hull-aware formation slots) is nearly free
and fixes the at-rest case of a group move; a movers-only avoidance rule that never moves a
stationary hull is cheap to compute and leaves `pnpm balance` byte-identical, but it only fixes
the defect when it also stops movers at contact, and **that** is what costs playtest seeds. The
lead's call is which of those two prices to pay (§8).

---

## 1. The defect, measured

### 1.1 The instrument

`vehicle-overlap-probe.ts` orders real vehicle rosters on shipped maps, headless, and counts every
tick the pairs of ground vehicles whose hulls interpenetrate by more than 0.02 tile (6 cm).

- **The hull is an oriented box, measured from the GLB**, through `unitFootprintTable()`
  (`tools/src/perf/unit-footprints.ts`), the same numbers the selection ellipse is generated
  from. A circle would hide nose-to-tail contact, which is how a column meets.
- **Each overlapping pair-tick is classed by who moved that tick:** MM (both moving), MS (a mover
  into a stationary hull), SS (both stationary). The class picks the design: a rule that only ever
  touches movers cannot reach SS, and one that only settles parked hulls cannot reach MM or MS.
- **Transit and rest are separate.** "Transit" counts pair-ticks before the group settles (no
  vehicle moved, none under orders); "at rest" counts the pairs still overlapping on the last tick.
  So a scenario's length after arrival does not inflate the transit number.
- **Report-only.** `vehicle-overlap-probe.test.ts` pins the instrument (literal geometry; a stacked
  pair counted; a separated pair not; a drive-through read as MS) and never the level. Five one-line
  mutations of the probe were each seen red (PR body).

Measured hull half-extents (tiles; 1 tile = 3 m), on `main` `cfa9b078`:

| unit | along | across | centre along |
|---|---|---|---|
| `mbt_lavi` | 1.03 | 0.57 | −0.22 |
| `ifv_namer`, `veh_ambulance` | 1.22 | 0.69 | 0 |
| `apc_eitan` | 1.19 | 0.51 | 0 |
| `apc_kipod` | 1.20 | 0.62 | 0 |
| `dozer_d9` | 1.14 | 0.73 | 0 |
| `jeep_shoded` | 0.80 | 0.39 | 0 |
| `scout_shachaf` | 0.77 | 0.42 | 0 |
| `technical` | 0.83 | 0.30 | 0 |
| `gun_truck` | 0.90 | 0.47 | 0 |
| `rocket_battery` | 0.95 | 0.34 | 0 |
| `mbt_lavi_camo` | 1.10 | 0.71 | −0.22 |
| `spg_long_range`, `spg_cluster` | 1.22 | 0.57 | −0.08 |

**The 15 Oct plan's Lavi footprint is stale.** Its V-R3 row (0.87 × 0.48) predates the lead's
x1.18 Lavi rescale (CLAUDE.md, 2026-10-15); the measured hull is now 1.03 × 0.57. Three new types
have hulls since (`mbt_lavi_camo`, the two Te'o SPGs, `veh_ambulance`).

### 1.2 The reading (`main` `cfa9b078`, seed 424242)

| scenario | map | vehicles | transit pair-ticks (MM / MS / SS) | deep (> 0.25 tile) | max depth | pairs at rest (max depth) | settled |
|---|---|---|---|---|---|---|---|
| group move, 6 mixed | `beit_sahwan_outskirts` | 6 | 875 (613 / 227 / 35) | 772 | 1.45 | 3 (0.62) | 23.6 s |
| group move, 9 mixed | `beit_sahwan_outskirts` | 9 | 1,837 (978 / 610 / 249) | 1,275 | 1.57 | 5 (0.62) | 23.6 s |
| `exact` to one point, 6 | `beit_sahwan_outskirts` | 6 | 3,315 (1,922 / 604 / 789) | 2,759 | 1.86 | 15 (1.86) | 24.6 s |
| two groups cross (head-on) | `beit_sahwan_outskirts` | 6 | 386 (157 / 42 / 187) | 135 | 1.27 | 1 (0.12) | 19.6 s |
| sandbox KDF spawn, idle | `beit_sahwan_outskirts` | 7 | 0 | 0 | 1.30 | 2 (1.30) | 0 s |
| group up the valley through the wide saddle | `tel_marum` | 6 | 499 (220 / 158 / 121) | 260 | 1.42 | 3 (0.19) | 29.0 s |
| group to the hollow | `tel_marum` | 6 | 432 (198 / 157 / 77) | 237 | 1.48 | 3 (0.18) | 13.3 s |
| group through the gates | `qarn_hadid` | 6 | 999 (755 / 244 / 0) | 880 | 1.52 | 1 (0.19) | 25.2 s |
| sweeping attack-move into a Sarim screen (6 KDF, 3 Sarim) | `beit_sahwan_outskirts` | 9 | 17,226 (1,023 / 749 / 15,454) | 17,048 | 1.86 | 10 (1.73) | never (5 still ordered) |
| **total** | | | **25,569** | **23,366** | | **43** | |

"6 mixed" is Lavi, Namer, Eitan, jeep, Kipod, Lavi; "9 mixed" adds a Namer, an Eitan and a
Shachaf. The group starts in a block 2.5 tiles apart, so no pair touches before the order.

### 1.3 What the reading says

1. **On the route, MM dominates a group move.** Speeds run from 0.6 (D9) through 1.1 (Lavi) to
   2.9 tiles/s (jeep), every member follows its own slot's field, and the fields converge at every
   gap, so fast hulls drive through slow ones. MS is the second source: hulls already parked in
   their slots stand on the routes of the ones still arriving, and the flow field routes straight
   through them.
2. **At rest, a group move leaves 1–5 pairs overlapping, up to 0.62 tile.** Ranks are
   `VEHICLE_SPACING` (2) tiles deep, while two hulls in consecutive ranks need up to 2.54 (a Namer
   behind a camo Lavi: 1.22 + 1.10 + 0.22; behind a plain Lavi, 1.22 + 1.03 + 0.22 = 2.47). The 15 Oct plan's "up to 0.44" was computed before the Lavi
   grew. Sideways, 2 tiles clears every pair standing parallel (the widest pair is 0.73 + 0.71 =
   1.44), but a hull arrives facing its last step, not the formation's front, and a Namer turned
   45° spans 1.35 tiles to each side.
3. **Orders that converge on one point stack completely.** An `exact` move, and the sweep's closing
   rule (`stepSweep` sets the goal to the target's own position, or to a last-seen point), put every
   hull on the same spot: 15 of 15 pairs at 1.86 tile, the full length of a Namer. In the fight
   scenario the five surviving KDF hulls end on one last-seen point (30.5, 24) and stay there under
   orders; that, not the firing itself, is most of its 17,226 pair-ticks.
4. **Spawn.** The sandbox (and versus) KDF force places a Lavi one tile from the D9 and another one
   tile from the jeep: 2 pairs at 1.30 tile from tick 0.

---

## 2. What exists today

- **No unit-to-unit collision.** `stepMovement` (`sim.ts`, `private stepMovement`) walks
  `i = 0 … count − 1`, takes one step (flow-field direction, or straight at the goal on the final
  leg), clips it against the unit's own mask (`blockedVehicleMask` for the vehicle domain), turns
  the hull toward the heading, writes the position, and completes the leg when the position equals
  the goal. Nothing reads another unit's position.
- **Spacing exists only at order time.** `assignFormation` (`formation.ts`) gives each member of
  one group order a distinct tile: vehicles and aircraft in the front ranks, `VEHICLE_SPACING` (2)
  apart sideways and between ranks, infantry one per tile behind. `reservedTilesFor` keeps a new
  order's slots off tiles where same-side units outside the order stand or are bound. Slots are
  handed out in **id order**, not by where each unit stands, so paths cross. Infantry have no other
  spacing at all.
- **`stepTransport`** runs after `stepMovement`: a rider copies its carrier's position; a boarder
  chases its carrier until within `LOAD_RANGE_SQ` (1.5 tiles). Riders are foot units.
- **Wrecks have no sim body.** `destroy` sets `alive = 0`; the wreck is presentation. Ruled 15 Oct
  (Q1): wrecks do not block.
- **The D9 is a vehicle** since GH-598 (`wheeled: true`, GH-674): vehicle domain, vehicle ranks.
- **Bridges do not exist** as a map concept. A ford or a one-tile gap is just narrow open ground,
  and behaves like the saddle below.

**The hot loop and its cost.** `stepMovement` is cheap today: 0.05–0.06 ms a tick with 300 units
(100 vehicles, 200 infantry) all under orders on `qarn_hadid` (scratch stress, two runs), against a
2.08 ms tick at 300 living units in `docs/PERFORMANCE.md` ("Sim tick cost"), where
`stepDetection` and `stepCombat` own 85–95%. Any per-tick vehicle rule lands in this loop, and its
cost is per moving vehicle times its neighbours.

---

## 3. History: the push design, and why it stopped

The 15 Oct plan (`2026-10-11-vehicle-spacing.md`) built `stepSeparation`: capsules, Jacobi-summed
pushes on movers and stationary hulls alike, a right-hand slide, a stall valve, and "a goal held
by another vehicle counts as reached at contact" (V-D5). Tasks 1, 1b and 2a are parked on
`feat/vehicle-spacing` @ `7e8371e3`. Task 2 was built and measured, and the lead deferred it
(18 Oct): 9 of 36 winning plans lost a seed, three unlock gates went late, `LADDER_CREDITS` and
`ROSTER_MAX` moved, a lead-reported regression test (`hold-outside.test.ts`, Umm Zeitoun II's crest
line) went red because a pushed Eitan stopped a row outside its zone, the net arena's
"rush beats passive (seat 1)" flipped, and 5 of 12 versus-probe cells sat outside 60/40
(`_coord/s4-spacing-task2-report.md`).

What it teaches: **a push moves hulls that were standing where the player or the plan put
them** — off a zone, out of a slot, across a tile boundary that changes cover — and **stopping a
mover short of its goal** does the same at the other end. Both are what the softer designs below
try to avoid, and §5 measures how far each gets.

---

## 4. Options

All options share three rules, carried over from the 15 Oct rulings where they still hold:

- **Who takes part** (V-R1): a ground unit whose type declares `mobility.footprint` (data,
  measured, Task 1). Air never; carried, garrisoned and buried units never; `moto_rpg` exempt by
  name (V-R4: a rider, not a hull). Infantry and civilians never: infantry stacking stays a
  formation concern.
- **The hull is a capsule in the sim** (V-R2): a segment of half-length `half_length −
  half_width` along the facing, centred `centre_along` ahead of the position, radius
  `half_width`. Exact nose to tail and side on; corners rounded by `half_width`. The pure Q16.16
  geometry already exists and is tested on the parked branch (`separation.ts`, `c03fda80`:
  `hullCapsule`, `closestSegmentPoints` after Ericson 5.1.9, `capsuleOverlap`). The probe's box is
  the stricter measure on purpose: the sim may round a corner the probe still counts.
- **Flow fields stay** (no per-unit A*, no field per vehicle, no field invalidated by a vehicle
  moving). A field is per goal and per domain and cached; stamping vehicles into it would recompute
  a 2,304-cell field every time a hull parks.

### Option A — hull-aware formation slots (order time only)

**What.** Two changes inside `assignFormation`, nothing per tick:

1. **Ranks deep enough for hulls.** The step between vehicle ranks becomes `VEHICLE_RANK_DEPTH` = 3
   (was `VEHICLE_SPACING`, 2). The deepest consecutive-rank pair is 2.54 tiles (a Namer behind a camo
   Lavi, whose hull sits 0.22 behind its origin; 2.47 behind a plain Lavi), so 3 clears every shipped
   pair facing the approach with 0.46 to spare. Sideways stays 2.
2. **Slots matched to where the units stand.** Front units are ranked by their projection on the
   approach (most forward first); each rank's units and slots are both ordered along the lateral
   axis and paired. Paths stop crossing inside the group.

**Q16.16.** None: tiles are integers, projections are integer dot products of tile coordinates with
the quantised axes (±1, 0), and every sort breaks ties by id.

**Determinism.** Pure, order-time, no RNG, no new state. Ids are creation order on both clients.

**Per-tick cost.** Zero. Per order: one sort of the front members (≤ the selection).

**Edge cases.** A street still degenerates the grid into a column (the reachability walk, unchanged).
The saddle and defiles: unchanged reachability; a 3-deep rank reaches `SEARCH_RADIUS` (8) after 3
ranks of 3 instead of 5 — 9 vehicles on the grid, the rest to overflow (1 tile apart, contested, as
today). Infantry start one row behind the last vehicle rank, as today. Boulders: slots come from
each domain's own mask, unchanged. The D9 takes a vehicle rank like any vehicle. Transports and
wrecks: untouched.

**Formation arrival.** Every vehicle still ends exactly on its slot; the group is one row deeper per
vehicle rank. It does not touch route overlap except by un-crossing paths.

**Measured (prototype, §5):** at-rest pairs 43 → 35; group moves 3 → 1 (6 mixed), 5 → 3 (9 mixed),
3 → 1 (both Tel Marum rows). Transit is mixed: −51% and −41% on the two town group moves, +15% and
+8% through the saddle and the gates, where the deeper rank lengthens the column. **`pnpm playtest`:
every plan holds 30/30; `LADDER_CREDITS` 5953 → 5948.** `pnpm balance` byte-identical (read in
the A + B runs, which include A). All 63 determinism specs stayed green with A applied to every
`front` unit.

### Option B — movers-only avoidance ("a hull never pushes, it steers or waits")

**What.** Inside `stepMovement`, after the wall clip and before the position write, a participating
mover tests its candidate step against nearby hulls. **No unit is ever displaced by another; a
stationary hull never moves.** That is the 18 Oct ruling's "separate only movers".

For mover `i` at `p` with candidate `n`:

1. For each participating `j ≠ i` within the broad-phase reach: `ovNew = overlap(cap_i(n), cap_j)`.
   If `ovNew > 0` and `ovNew > overlap(cap_i(p), cap_j)`, the step is **blocked by `j`**. A step that
   reduces an existing overlap is always allowed, so hulls that spawned inside each other drift
   apart under their own orders and nothing traps them.
2. Not blocked: take the step; `sepWait[i] = 0`.
3. Blocked, and `sepWait[i] ≥ SEP_VALVE` (40 ticks, 2 s): **ghost** — take the step anyway (exactly
   today's behaviour) until the first unblocked tick.
4. Blocked by a **stationary** hull, or by a mover coming the other way (facings more than 90° apart):
   **steer** — try the step turned 45°, then 90°, to the side **away** from `j` (the sign of
   `cross(step, j − p)`, read from geometry every tick, so it needs no state and does not flip while
   `j` stays on one side). Take the first candidate that is wall-free (destination tile and both
   orthogonal tiles open on the unit's own mask, the flow field's own corner rule) and blocks on
   nobody. `sepWait[i]++` either way.
5. Blocked by a mover going the same way: **wait** (follow at its speed). `sepWait[i]++`.
6. Optionally (**B+**), **arrival at contact**: blocked by a stationary `j` whose capsule also covers
   `i`'s capsule placed at `i`'s goal, or by a mover bound for the same goal tile and nearer to it —
   the leg ends where `i` stands. This is the 15 Oct V-D5, and §5 shows it is the part that costs.

The order of `i` is index order (Gauss–Seidel): `j < i` has already moved this tick and is read
where it now stands; a moving `j > i` is read one nominal step ahead along its facing (a read, never
a write), so a follower with a lower id does not stop-start behind its leader.

**Q16.16.** Capsules and overlaps as on the parked branch: `fx.mul`, `fx.div`, one `fx.sqrt` per
narrow-phase pair, `fx.sin`/`fx.cos` (LUT) of the facing. Turned candidates by fixed constants:
`(mx·c − my·s, mx·s + my·c)` with `cos 45° = sin 45° = 46341` (0.70711 × 65536 = 46340.95,
rounded) and `(0, ±65536)` for 90°, each through `fx.mul`. The away side is the sign of
`fx.mul(mx, jy − py) − fx.mul(my, jx − px)`. Broad phase in integers: `|jx − nx|`, `|jy − ny|`
against `bound_i + bound_j + HALF`, where `bound = half_length + |centre_along|` (≤ 1.47 tile).
All magnitudes stay inside int32: positions < 48 tiles (3.15 M raw), offsets inside the reach.

**Determinism.** Integer only, no RNG, index order fixed by creation order on both clients. One new
per-unit column, `sepWait` (`Uint8Array`), which must join `hash()` (it carries state across ticks).
No scratch allocation per tick: a preallocated capsule buffer and a per-tick bucket grid.

**Per-tick cost.** The prototype scanned every entity per mover: `stepMovement` 0.05 → 0.75–0.84 ms
at 300 units with 100 vehicles moving (two runs), +0.7–0.8 ms, 1.6% of the 50 ms budget. The
implementation buckets participants into a coarse grid once per tick (`head` over 2-tile cells, at
most 24 × 24 = 576 on the largest shipped map, `next` over capacity; O(V) to build) and visits the
3 × 3 cells around the mover: O(V_moving × k) with k the hulls within ~3 tiles. Expected well under
0.1 ms at the same load; Task 7 measures it.

**Edge cases.**
- **Tel Marum's wide saddle, the Qarn Hadid gates, defiles, fords:** steering candidates must be
  wall-free under the corner rule, so in a two-wide gap a column mostly follows (rule 5) and a
  head-on meeting with no room to turn waits and then ghosts after 2 s. Measured: saddle deep
  pair-ticks 260 → 131 with A.
- **The boulder field:** vehicles path on `blockedVehicleMask` and steer on it; foot units are not
  participants, so the corridor's infantry are untouched.
- **Transports loading:** carriers are stationary while boarders (foot) close; a rider is excluded.
  A carrier driving to a pickup steers like any mover; its riders move with it in `stepTransport`,
  which still runs after movement.
- **Wrecks:** dead hulls are skipped (Q1). A **`mobilityKilled` hulk** is a stationary hull: the
  column steers round it if there is room, else ghosts after 2 s — never stuck behind it.
- **The D9 demolishing** is stationary (`moving` 0 while it cuts) and is never moved, so
  `stepDemolition`'s `displaced` reset cannot be triggered by a passer-by: the 15 Oct anchor rule
  (V-R5) is unnecessary by construction.
- **Targeted fire (GH-420):** a focuser stopped at range is stationary and never moved, so the
  0.5-tile hysteresis band is untouched; a lost-target chase is a plain mover.
- **Holds and stances (N2):** stationary hulls are never moved, so `hold`, `ambush`,
  `hold-outside`'s crest line and every authored zone keep their occupants.
- **Formation arrival:** with A, slots no longer conflict, so a mover is rarely blocked at its own
  slot. Without B+, a slot already covered by a stray hull is reached by a 2 s wait and a ghost.

**Measured (prototype, §5):** without B+ it barely moves the defect; with B+ deep pair-ticks fall
75% and at-rest pairs halve, and playtest pays for it.

### Option C — positional separation (the 15 Oct push design)

Built, measured and deferred (§3). Kept here only as the baseline the others are softer than.

### Option D — reservation of the next tile

**Rejected on geometry.** A tile is 3 m; a hull is up to 7.3 m (2.44 tiles) and covers 3–6 tiles
depending on its facing. Reserving the tile ahead cannot keep two hulls apart; reserving the whole
footprint makes every two-wide street one lane, makes a column keep a full-tile gap (stop-start at
the tile rate), and conflicts with sideways formation slots 2 tiles apart for any hull not aligned
to the grid. Cost would be cheap (an occupancy grid, O(V × 6) a tick) but the motion is coarser than
the defect.

### Option E — group speed matching

Members of one group order move at the slowest member's speed, so a mixed group keeps its shape and
fast hulls stop driving through slow ones (the MM source in §1.3.1). One per-unit speed cap column,
order time. **Not prototyped**: it is a gameplay change (a jeep ordered with a Lavi crawls at
1.1 tiles/s) that every plan's timing would feel, and the lead has not asked for it. Listed as a
question (§8, Q3).

### Option F — presentation only

A renderer-side offset would hide overlap at no sim cost, but the drawn hull would disagree with
the position the sim uses for line of sight, fire and picking, and the lead approved a sim fix.
Rejected, and noted only as a fallback for the fight case if §8 Q2 is answered "not now".

---

## 5. Prototypes, measured

Scratch only: env-gated code in `sim.ts` and `formation.ts`, never committed, reverted. The patch,
the playtest outputs and the balance outputs are kept at
`/Users/ilpinto/dev/roaring-lions-ep/_coord/veh-sep/` (outside the repo). Same seed and scenarios
as §1.2. `pnpm playtest` runs every plan over 30 seeds (83 s here).

| variant | transit pair-ticks | deep | at rest | plans that lose a seed | `LADDER_CREDITS` (5953) | `ROSTER_MAX` (29) | `balance` |
|---|---|---|---|---|---|---|---|
| main | 25,569 | 23,366 | 43 | — | 5953 | 29 | — |
| **A** (rank 3, matched slots) | 23,921 | 22,482 | 35 | **none** | 5948 | 29 | identical |
| B, brake only (no steering, 2 s valve) | no gain: a blocked mover waits 2 s and ghosts through a parked hull (two-Lavi trace) | | | not run | | | |
| B, brake only with the blocked-time valve, plain `move` only, no B+ | not run | | | KR I 28/30, WH II 29/30, BS IV 27/30 (+bought 29/30) | 5898 | — | — |
| B steer, plain `move` only, no B+ | 29,577 | 24,081 | 41 | KR I 26/30 | 5944 | — | — |
| A + B steer, plain `move` only, no B+ | 27,311 | 21,968 | 35 | KR I 26/30, KR II 29/30; gate `scout_shachaf` late | 5949 | 29 | identical |
| A + B + B+, plain `move` only | 21,681 | 18,562 | 27 | KR I 26/30, KR II 22/30, TM II 29/30, UZ IV 29/30; two gates late | 5718 | — | — |
| **A + B + B+, every mover** | **11,751** | **5,901** | **21** | WH I 29/30, KR I 26/30, **KR II 0/30**, TM II 29/30, UZ IV 28/30 (+bought 28/30); UZ III 3★ → 2★; gates `scout_shachaf`, `apc_kipod` late | **5659** | **25** | identical |
| C, the push design (18 Oct) | — | — | — | 9 of 36 winning plans | 5930 → 5936 (the base then) | 28 | identical |

Plan names: KR Khan Rafid, WH Wadi Halam, BS Beit Sahwan, TM Tel Marum, UZ Umm Zeitoun.

What the table says:

1. **A is nearly free and fixes what it can reach.** It is the only variant that keeps every plan
   on 30/30. It removes the rank-depth overlap at rest; it does nothing for convergence, spawn or
   the route.
2. **B without B+ is not a fix.** The flow field keeps routing movers through parked hulls; a
   mover that may only steer or wait either finds a way round or ghosts after 2 s, and in a
   converging order nobody is ever "parked" for the others to stop against. Its transit numbers are
   worse than `main` in the converge and saddle rows because the waiting stretches the time hulls
   spend in contact.
3. **B+ is what fixes it, and B+ is what costs.** Ending a leg at contact is the one rule that makes
   converging orders, sweeps and late arrivals stop apart, and it is also the rule that leaves a
   vehicle short of the tile a plan sent it to. Khan Rafid II, which loses 30/30 with it, fails on
   `get_four_in`, its evacuation primary; the push design's `hold-outside` failure was the same
   class (a hull outside the zone it was sent into).
4. **`pnpm balance` never moved** in any variant: the §5.7 backtest's fights do not bring two
   participating hulls into contact. So the cost is in the scripted campaign plans, not the combat
   model.
5. **Restricting the rule to plain moves does not buy safety**: the plain-move-only variants still
   lose Khan Rafid I on the same four seeds (2, 11, 14, 28). Its plan sends the jeep and the Eitan
   to the same point, (24, 22), by two plain `move` orders at t = 30 s; not yet root-caused.

---

## 6. Recommendation

**Land it in two stages, and let the lead choose the second stage's price.**

**Stage 1 — Option A, hull-aware formation slots.** Order time, pure, zero per-tick cost, no new
state. Every plan holds 30/30; `LADDER_CREDITS` moves by −5 (5953 → 5948), which is a STOP-and-
report move under the common rules, so it lands with the lead's sign-off on that one number. It
fixes the at-rest overlap of an ordinary group move — the case a player sees after every group
right-click — and makes Stage 2's job smaller.

**Stage 2 — Option B with B+ for every participating mover, never a push.** It is the variant that
actually fixes PA-10 (deep −75%, at-rest pairs halved) while keeping the property the push design
lacked: a hull that is standing still is never moved by anyone, so holds, zones, cover tiles, the D9's
cut and a focuser's band are safe by construction. Its cost is entirely stop-short arrivals in the
scripted plans. Stage 2 therefore starts with **root-causing every lost seed** (Khan Rafid II first:
0/30 is systematic, not noise) and stops at a go/no-go before any pin moves:

- **go** if every loss is a plan that relied on two vehicles sharing a point or a vehicle reaching
  a tile another vehicle holds — fixed in the plan (the GH-542 pattern, each in its own commit) or by
  a B+ refinement that does not end a leg inside an objective's zone;
- **no-go** if a mission is unwinnable by any reasonable plan with separation on, which is a
  mission-design finding for the lead, not a re-pin.

What the recommendation does **not** do: it does not move parked hulls apart (the sandbox spawn's 2
pairs stay until either hull moves, at which point rule 1 lets them drift apart), and it does not
change the fight's sweep-onto-last-seen stacking beyond what B+ does to movers (in the full variant,
17,226 → 6,834 pair-ticks, at rest 10 → 4). The spawn offsets are an app-data fix (Task 8, optional).

**Why not "separate only stationary vehicles"?** In every scenario but the spawn, SS overlap is
created by a move: two hulls that drove into each other and then stopped. Settling them afterwards
is a push on stationary hulls — precisely what moved Umm Zeitoun II's Eitan off its crest line on
18 Oct — and it leaves every MM and MS pair-tick in §1.2 untouched.

---

## 7. Pins

| pin | Stage 1 (A) | Stage 2 (B + B+) |
|---|---|---|
| Golden replays: flat 3719067886, relief 2842924511, orders 3272041047 | Expected unmoved: the prototype applied A to every `front` unit and all 63 determinism specs stayed green. Re-read in the task; a move is a finding, explained before it is re-pinned. | Column re-pin first (`sepWait` joins `hash()`), with the no-behaviour proof; then behaviour moves none of them (fixtures declare no footprint, V-R11), and a new separation replay is born. |
| `fire-support` `HASH`, `WOUNDED_WORLD_PIN` 1774950105, `ECONOMY_PIN` 904873885 / `_RELIEF` 2771311510, `RUNTIME_DIGEST_PIN` 2037118941 / `_RELIEF` 1884258391 | Only if they fold `sim.hash()` and issue group orders: re-read at pre-flight | Column re-pin for each that folds `sim.hash()` |
| Versus literals (`versus-force.test.ts`, `per-seat-types.test.ts`, `match-world.test.ts`, `tools/src/backtest/versus-breach.test.ts`) | Move if their scripted orders are group orders | Column re-pin, then behaviour (the KDF spawn pairs are in contact and the AI's attack-moves now stop at contact) |
| `formation.test.ts`, `formation_walk.test.ts` | **Move** (rank depth, slot pairing): each expectation re-derived, never loosened | — |
| `pnpm playtest` outcomes | 30/30 everywhere (measured) | **Move** (measured: §5) → STOP, root-cause, plan follow-ups |
| `LADDER_CREDITS` 5953, `CAMPAIGN_CREDITS` | → 5948 (measured) → STOP for sign-off | Moves (measured 5659 before follow-ups) |
| `ROSTER_MAX` 29 | unchanged (measured) | Moves (measured 25 before follow-ups) |
| `pnpm balance` (§5.7) | identical (measured) | identical (measured) |
| `pnpm versus:probe` (report-only, 60/40 bar) | re-read | re-read; the push design put 5 of 12 cells outside |
| Net arena (`players.test`, `arena.test`) | re-read | re-read; the push design flipped "rush beats passive (seat 1)" |
| Golden visual baseline | `vehicle`, `kitted` and maybe `quiet` move if the sandbox force is issued a group order before the capture (it is not: it is spawned) — expect none | `vehicle`, `kitted`: the spawned Lavi/D9 and Lavi/jeep pairs do not move unless ordered, so expect none; bless from CI only if one moves |
| `shippedContentDigest()` | — | Moves with the unit JSON (Task 1); no literal pins it |

---

## 8. Questions for the lead

1. **Stage 1's −5 credits.** Accept `LADDER_CREDITS` 5953 → 5948 for hull-aware formation slots?
   (Every plan holds 30/30; nothing else moves in playtest or balance.)
2. **Stage 2's price.** The only measured variant that fixes PA-10 ends a mover's leg at contact
   (B+), and that costs scripted plans seeds (Khan Rafid II 0/30 before any follow-up). Options:
   (a) go ahead, root-cause every lost seed and fix the plans in their own commits, with a no-go if a
   mission turns out unwinnable; (b) Stage 1 only for now, and Stage 2 waits for Stage 5's skirmish
   build; (c) Stage 2 without B+ — measured not to fix the defect, so not recommended.
3. **Group speed matching (Option E).** Should a mixed group order move at its slowest vehicle's
   speed? It would remove most of the on-route overlap without any per-tick rule, at the price of
   slowing fast vehicles in mixed groups. Not prototyped; recommended **no** unless the lead wants
   the behaviour for its own sake.
4. **Spawn offsets (Task 8).** The sandbox and versus KDF force spawn a Lavi one tile from the D9
   and from the jeep (1.30 tile of overlap). Move those offsets to clear the hulls? It moves the
   versus pins and possibly the golden `vehicle`/`kitted` captures.
