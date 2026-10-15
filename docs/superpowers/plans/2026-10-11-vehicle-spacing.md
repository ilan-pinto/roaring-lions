# Vehicle spacing: vehicles in a group stop driving through each other (GH-421, PA-10). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Refreshed 15 Oct: capsules, a slide and a stall valve, footprints by opt-in; re-read against main `6a3408a1`, F2's branch, N2's and F4's plans

Docs only. Nothing was run except one scratch script that reproduces `fxMul`, `fxDiv` and `fxSqrt`
by hand to derive the fixed-point literals; it lives in the scratchpad and is not committed.

Sources read:
- `origin/main` `6a3408a1` (#658 merged);
- F2's branch `feat/gf2-held-ground` at its tip, **`53282f8f`** (`79f35206` plus `627f970b` and
  `53282f8f`; no pin or constant cited here moved). Task 11 (C-R20) is on the branch and its review is
  still open;
- N2's plan, `docs/superpowers/plans/2026-10-16-net-n2-sim.md`, on `main`;
- F4's refreshed plan, `origin/docs/f4-plan-refresh` (PR #660).

Lane C's order is F1 → F3 → F2 → N2 → F4 → **spacing**. This plan is cut from `main` after F4
merges, so every value those three plans move is marked "re-read at pre-flight".

What changed, and why:
1. **The 11 Oct design had four defects.** Each was found from the code and arithmetic, not from
   taste.
   - **A circle cannot fix the case this plan exists for.** "Why" names the shared flow field as the
     place vehicles still meet, and a column on a shared route meets nose to tail. A circle the size
     of the hull's half-width leaves `(half-length − half-width)` of each hull uncovered. For a pair
     of the same type that is **0.78 tile** of Lavi inside Lavi, **1.06** for two Namers and **1.36**
     for two Eitans. (Half-extents are inverted from `ELLIPSE_BY_TYPE`; the table is in V-R3.) The
     plan said "about 0.4 tile on a Lavi", which is one hull, not a pair. **Ruled: a capsule**
     (V-R2).
   - **Two vehicles meeting head-on along one line never pass.** Pure symmetric separation pushes
     each one straight back along the line between their centres. Flow fields put units on
     tile-centre lines, so a collinear head-on meeting is the common case, not a corner case. The old
     Task 2 test, "two vehicles driving head-on pass without overlapping", would have failed against
     the old Task 2 implementation. **Ruled: the vehicle being pushed back slides to its own right**
     (V-D9, V-R6).
   - **A corridor narrower than two hulls, or a disabled hull in a street, deadlocks permanently.**
     The 11 Oct rule made a `mobilityKilled` hull immovable, and flow fields route straight through
     it, so a column behind it presses forever. `pnpm playtest` now needs 30/30 seeds, and a stuck
     plan fails that. **Ruled: a stall valve** (V-D10, V-R7). A vehicle that has been pushed back for
     3 s ghosts until it is clear: it neither pushes nor is pushed, which is exactly today's
     behaviour, used as a backstop. The valve is state, so it needs **one new hashed column,
     `sepStall`** (Task 2a). The old "no new hashed column" line is withdrawn.
   - **The participation rule would have swept in every role-less test fixture.** V-D1 derived
     "ground vehicle" from the move domain. A role-less in-test type derives as wheeled: that covers
     `determinism.test.ts`'s `TANK`, the economy replays' `ECO_*` and most sim fixtures. Meanwhile
     the D9 is on the foot domain (`FOOT_ROLES` contains `engineer`, `sim.ts` L232), although it is
     the second-widest hull. **Ruled: a unit takes part only if it declares
     `mobility.footprint`** (V-R1), so no fixture moves unless a test gives it a footprint.
2. **Interactions.** A new section below covers formations, targeted fire, garrisons, versus
   determinism, flow fields, breach detours, transport and wrecks. Four of them change tasks, and
   those rows are in bold.
3. **Every name, line hint and pin was re-read** at `6a3408a1`:
   - The sim pins are now **935671699 / 2842924511 / 3272041047**. On 11 Oct they were
     `1202444260 / 3354895120 / 2737216487`.
   - `LADDER_CREDITS` = `CAMPAIGN_CREDITS` = **5940** (was 5917), and `ROSTER_MAX` is **29** (was
     30).
   - #247 has landed, so `manpad_team` is `wheeled: false`.
   - Ten unit types move on the vehicle domain. `moto_rpg` is one of them (V-R4); the D9 is not.
4. **The versus pins move.** The 11 Oct plan did not know they existed. The KDF mirror force spawns
   a Lavi one tile in front of the D9 and another Lavi one tile behind the jeep. On
   `beit_sahwan_outskirts` both pairs overlap at tick 0; on `tel_marum` they stand side by side and
   only the Lavi/D9 pair touches. The re-pin table names these pins, together with the two-client and two-engine
   tests that guard them.
5. **A pre-flight scan** now follows the interactions. It has rows for pairs of tasks, each task on
   its own, and rows against F2, N2 and F4, with a ruling beside each conflict.
6. **Size.** Four tasks became six. Task 1b (the pure geometry) and Task 2a (the column) are new.
   The Tue 24 – Wed 25 Nov slot now probably needs three days, not two. Spacing is still the first
   item to slip to Stage 5 (stage4-order, ruled 11 Oct).
7. **Found, but not this plan's to fix:**
   - The D9 paths on the foot mask, because `FOOT_ROLES` contains `engineer`. So it drives through
     boulder fields (`b`, on 23 of 35 maps) and anti-tank ditches (`d`, on 6 maps) that stop every
     other vehicle. `wadi_halam_5` carries `b`, and Wadi Halam V's `raze` primary uses the D9.
   - It is also slotted as foot: `assignFormation` puts it in a rear rank at `INFANTRY_SPACING` 1,
     inside the vehicle ranks (see Interactions, formations).
   - This is already tracked as **#598** (HANDOVER L24/L30): `wheeled: true` on `dozer_d9`. It moves
     formation fronts and paths, so it carries its own re-pin and playtest reading. It is not folded in
     here, and it should land before spacing.

**Goal:** Two ground vehicles never stand inside each other, and a group of vehicles does not drive
through itself. Movement stays on flow fields (no per-unit A*).

**Why (lead, 6 Oct; GH-421).** This is the polish audit's PA-10. Lavi, Namer and Eitan meshes clip
through each other in a fight (`docs/polish/before/play-33-vehicles-interpenetrate.jpg`,
`play-36-vehicle-kill-2s.jpg`). The audit rates it P1, "the most visible prototype tell in combat",
and deferred it to Stage 4 as #421.

The sim has no unit-to-unit collision at all: `stepMovement` clips each unit against the blocked mask
and nothing else. Group formations (`formation.ts`, 2026-09-15) give vehicles distinct destination
slots `VEHICLE_SPACING` (2) tiles apart. But each unit follows its own slot's field, the fields
converge at every gap, and the closing rule (`stepSweep`) sends every sweeping closer to its target's
own position. So vehicles meet on the route and again at the end.
- *(Pre-flight 2, 2026-10-11:)* since #537 the meeting at the end applies only to orders that `sweep`:
  AI waves, `commit`s and the balance backtest. A player's group stops in its slots.
- *(15 Oct:)* the meeting on the route is mostly nose to tail, which is why the shape is a capsule.
  Formation ranks are themselves only 2 tiles deep, while pairs of hulls are up to 2.44 tiles long
  (see V-D3).

**Architecture:**
- **One new system, `stepSeparation`, in `tick()` right after `stepMovement` and before
  `stepTransport`.**
  - Every living ground vehicle with a footprint is a capsule: a segment along its hull of
    half-length `half_length − half_width`, with radius `half_width`, centred `centre_along` ahead of
    its position.
  - Pushes are **summed, then applied** (Jacobi). Every capsule is read from the positions
    `stepMovement` left. Every pair's push is added into integer sums kept per vehicle. Only then
    does each vehicle apply its own sum, capped at `SEPARATION_MAX_STEP` and clipped against its own
    move mask.
  - Integer addition commutes, so the order in which pairs are visited cannot change any result.
- **A mover that is pushed back slides to its own right** (V-D9). **A mover pushed back for 3 s
  ghosts until it is clear** (V-D10, the valve). The valve's state is one hashed `Uint8Array` column,
  `sepStall`.
- **One new authored block per vehicle: `mobility.footprint`**, with `half_length_tiles`,
  `half_width_tiles` and an optional `centre_along_tiles`.
  - This is data, not engine: a new vehicle adds JSON lines.
  - The values are pinned to the measured hull that the selection ellipse is generated from.
- **Pins move in two steps.**
  - Task 2a adds **one hashed column** (`sepStall`). That is a column re-pin, with the no-behaviour
    proof.
  - Task 2 adds the **behaviour**. The golden replays do not move, because no fixture declares a
    footprint. A new separation replay is born and pinned. The versus pins, `balance` and `playtest`
    move, and each move is named.
- **No UI half.** The renderer already interpolates whatever positions the sim writes.

**Tech stack:** TypeScript strict, vitest. No new dependencies.

**Refs:**
- GH-421; `docs/polish/commercial-polish-audit.md` PA-10 (table row ~L264).
- `docs/superpowers/specs/2026-09-15-group-formation-design.md`, and `packages/sim/src/formation.ts`:
  `VEHICLE_SPACING` L22, `MAX_LATERAL` L20, `assignFormation` and its overflow phase.
- `packages/render/src/three/units/readability.ts`: `ELLIPSE_BY_TYPE` (L177, generated) and
  `ELLIPSE_PAD_TILES` (L153).
- `tools/src/perf/unit-footprints.ts`: `ellipseFor` and `vehicleHalfExtent`, the measured hull
  half-extents that `ELLIPSE_BY_TYPE` is generated from.
- `docs/PERFORMANCE.md`, "Sim tick cost" (~L307; `tools/src/perf/sim-scaling.ts`).
- `docs/superpowers/plans/2026-10-04-stage4-order.md`: where this lands (row ~L263).
- N2: `docs/superpowers/plans/2026-10-16-net-n2-sim.md`.
- F4: `2026-10-04-gf4-camp-production.md`, as refreshed in PR #660.
- F2: `_coord/s4-f2-progress.md` (rulings C-R1..C-R20).

**Base:**
- Written 11 Oct against `main` `f2d5d9e8`. Pre-flight 2 was against `49715ff9`. **Refreshed 15 Oct
  against `6a3408a1`.**
- Branch `feat/vehicle-spacing`, cut from `main` **after F4 merges** (stage4-order, For the lead
  item 1).
- Worktree under `/Users/ilpinto/dev/roaring-lions-ep/`; run `pnpm install` once.
- Locate code by symbol; line numbers drift, and N2 and F4 both shift `sim.ts` before this plan runs.
  Hints at `6a3408a1`:
  - `sim.ts` types:
    - `UnitTypeJson.mobility.wheeled` ~L205, `FOOT_ROLES` L232;
    - `UnitType.isAir` L409, `wheeled` L425, `moveDomain` L447, `stepPerTick` L504;
    - `unitTypeFromJson` ~L575–645.
  - `sim.ts` state:
    - fields: `blockedVehicleMask` L934, `mobilityKilled` L1004, `displaced` L1015,
      `demoTicks` L1062;
    - `readonly state` L1203; constructor allocations ~L1327–1345.
  - `sim.ts` setup and debug hooks: `addUnitType` L1460, `spawn` L1874, `teleport` L1960,
    `debugDisableFirepower` L1972.
  - `sim.ts` tick:
    - `tick()` L1986, `selectBreachTarget` L3782, `stepTransport` L5188;
    - `stepFocus` L5789, `stepSweep` L5986, `stepMovement` L6189 (its arrival block ~L6312–6335);
    - `hash()` L6424.
  - `tuning.ts`: `FOCUS_REACH_SLACK` L40, `AIM_OFF_HEADING_MAX` L219, `PIN_SPEED_SHIFT` L262,
    `ROUT_SPEED_SHIFT` L266.
- Nothing here is measured. Every (R) is reasoned, and its task says how to measure it.
- The fixed-point literals in Tasks 1b and 2 are derived by hand from `fixed.ts`'s floor semantics,
  using a scratch script that reproduces `fxMul`, `fxDiv` and `fxSqrt`. They were not read off a run.

---

## Rulings (15 Oct)

Each is **Ruled 15 Oct (coordinator, lead-delegated window)**. A ruling stands until the controller's
pre-flight overturns it.

- **V-R1. A unit takes part if and only if its type declares `mobility.footprint` and it is not
  air.** This supersedes V-D1's derivation from the move domain.
  - *Why:* role-less in-test types derive as wheeled (`determinism.test.ts` L14 says so of its own
    riflemen). A domain rule would sweep in `TANK`, `ECO_TRUCK` and most sim fixtures, and move
    pins for no reason of their own. The D9, a 2.3-tile hull, is on the foot domain.
  - *Cost if wrong:* a new vehicle without a footprint drives through others. The tools test fails on
    any vehicle-domain type without one (apart from the named exemption), so it cannot ship that way.
- **V-R2. A capsule, not a circle.** This supersedes V-D2's default and closes For the lead item 3.
  - *Why:* a circle leaves 0.70–1.36 tile of overlap per same-type pair when they meet nose to tail,
    which is how they meet on the route this plan exists for. A capsule is exact along a hull's long
    axis. It costs one pure segment-to-segment function, run only after an integer broad phase.
  - *Cost if wrong:* about one more day of implementation. Long hulls in consecutive formation ranks
    stop at contact, up to 0.44 tile short of the rear slot (V-D3, lead Q2).
- **V-R3. The footprint numbers** are the hull half-extents behind `ELLIPSE_BY_TYPE`. They were
  inverted by hand from `ellipseFor`, rounded to 0.01, and are re-measured in Task 1 Step 0.
  - An unscaled row is `semi-axis − 0.3`.
  - A scaled row solves `(u − 0.3/a)² + (u − 0.3/b)² = 1` for `u = 1/scale`.

  | unit | half_length | half_width | centre_along | how |
  |---|---|---|---|---|
  | `mbt_lavi` | 0.87 | 0.48 | −0.18 | unscaled; matches `unit-footprints.test.ts` L156 exactly |
  | `ifv_namer` | 1.22 | 0.69 | 0 | scaled 1.062 |
  | `apc_eitan` | 1.19 | 0.51 | 0 | scaled 1.019 |
  | `apc_kipod` | 1.20 | 0.63 | 0 | scaled 1.047 |
  | `dozer_d9` | 1.14 | 0.73 | 0 | scaled 1.063 |
  | `jeep_shoded` | 0.80 | 0.39 | 0 | unscaled |
  | `scout_shachaf` | 0.77 | 0.42 | 0 | unscaled |
  | `technical` | 0.83 | 0.30 | 0 | unscaled (`offsetAlong` 0.01, dropped) |
  | `gun_truck` | 0.90 | 0.47 | 0 | unscaled |
  | `rocket_battery` | 0.95 | 0.34 | 0 | unscaled (`offsetAlong` 0.01, dropped) |

  *Cost if wrong:* a footprint up to 0.05 tile off its hull, which is the test's tolerance.
- **V-R4. `moto_rpg` is exempt, by name, with a demotion assertion.**
  - It is on the vehicle domain (role `technical`), but it is a motorcycle drawn as a rigged team. It
    has no vehicle GLB and no ellipse. At 3.4 tiles/s (0.17 tile a tick) it is the fastest ground
    unit.
  - *Why:* PA-10 is about hulls, and a rider is not a hull.
  - *Cost if wrong:* a tank clips a bike. Giving the bike a footprint later is one JSON line plus
    deleting the exemption, which its demotion test then demands.
- **V-R5. Who takes what share of a push.** This rewrites V-D4.
  - An **anchor** takes no share. An anchor is a `mobilityKilled` unit, or a demolisher with
    `demoTicks > 0`. A pair of two anchors is skipped.
  - A **mover** is a vehicle whose `displaced` flag `stepMovement` set this tick. When a mover meets
    a **stationary** vehicle that is not an anchor, the mover takes the whole push.
  - Two movers, or two stationary vehicles, split the push (`ov >> 1` and `ov − (ov >> 1)`).
  - *Why:* a halted, firing tank should not be bulldozed toward the enemy by the tank behind it. And
    a D9 cutting a wall should not be reset by a passer-by: a push sets `displaced`, and
    `stepDemolition` (~L5452) resets `demoTicks` when `displaced` is set.
  - *Cost if wrong:* one condition.
- **V-R6. The slide** (V-D9).
  - When a mover's summed push points against its own facing (`dot < 0`), a second component of the
    same size is added, pointing to the mover's right: `(−sin f, cos f)` on this y-down grid.
  - *Why:* a collinear head-on meeting, and a column behind a stopped vehicle, are the common cases.
    Without a sideways term neither ever resolves.
  - *Cost if wrong:* passing on the left instead is a sign change.
- **V-R7. The valve** (V-D10).
  - `sepStall[i]` counts the consecutive ticks in which a mover that is not a ghost was pushed against
    its own facing.
  - At `SEPARATION_STALL_TICKS` (60, which is 3 s) the vehicle becomes a **ghost**. Its pairs are
    skipped, so it neither pushes nor is pushed. It stays a ghost until a tick in which it overlaps
    nobody; then the count returns to 0.
  - *Why:* without it, a corridor narrower than two hulls, or a hulk in a two-tile street,
    deadlocks permanently, and a stuck plan fails the 30/30 playtest. The fallback is exactly today's
    behaviour.
  - *Cost if wrong:* one hashed column. If the lead prefers vehicles to wait forever, deleting the
    valve means accepting stuck plans.
- **V-R8. `SEPARATION_MAX_STEP` is 0.25 tile (16384), not 0.1.** It sits after `ROUT_SPEED_SHIFT` in
  `tuning.ts`.
  - *Why:* a mover that meets a stationary hull takes the whole push plus an equal slide. To resolve
    that in one tick, the cap must exceed `√2 ×` the fastest step among participating vehicles. The
    jeep steps 0.145 tile a tick, which gives 0.205. At a cap of 0.1, a jeep would gain 0.045 tile of
    overlap per tick against a parked hull.
  - *Placement:* F2 appended its block at the end of the file. This one sits in the movement block,
    so the two never touch the same hunk.
  - *Cost if wrong:* a visibly quick shove when vehicles spawn overlapping (up to 5 tiles/s for a
    tick or two).
- **V-R9. V-D5 lives in `stepSeparation`, behind one helper, `goalHeldByVehicle(i, gx, gy)`, which
  `stepFocus` also calls.** The arrival writes move out of `stepMovement` into `finishLeg(i)`, a
  byte-identical refactor.
  - *Why:* a focus chase can end at a lost target's last-seen tile while a parked vehicle stands on
    it. Without the shared helper, V-D5 would end that leg and `stepFocus` would re-issue it every
    other tick (see Interactions, targeted fire).
  - *Cost if wrong:* the focus flicker, which a test catches.
- **V-R10. A push clips against the unit's own move mask, plus FlowField's corner rule.**
  - The mask is `moveDomain === DOMAIN_VEHICLE ? blockedVehicleMask : blocked`, the same expression
    `stepMovement` uses.
  - Corner rule: a diagonal change of tile needs both orthogonal tiles open. Otherwise the push slides
    along whichever axis is open, and if neither is, the vehicle stays put.
  - *Why:* `stepMovement`'s clip checks only the destination tile. A sideways shove through a wall
    corner could put a hull on ground its field never reaches.
  - *Cost if wrong:* none in kind; the rule is only stricter.
- **V-R11. The golden replays keep their fixtures, and a new separation replay is born** (Task 2),
  instead of giving `TANK` a footprint.
  - *Why:* in the flat replay the two `d_tank`s never meet (its own comment, L449), and the relief and
    orders replays field one tank a side or none. A footprint there would move no pin, so the canary
    would stay blind to separation; and bringing tanks together in those replays would move pins that
    guard something else. Each golden replay keeps its own job.
  - *Cost if wrong:* one more `describe` to maintain.
- **V-R12. The column lands first and the behaviour second** (Task 2a, then Task 2).
  - *Why:* "one pin, one reason". The column moves every `sim.hash()` pin, with a provable
    no-behaviour reason. The behaviour moves only the versus pins and the new replay.
  - *Cost if wrong:* the versus pins move twice. That is accepted: two reasons, two commits, each with
    its own proof.
- **V-R13. Carried, garrisoned and buried units are excluded in code, not by assumption.**
  - No vehicle can be any of the three today, except `rocket_battery`, whose `canEmbark` defaults true
    (its role `artillery` is in `FOOT_ROLES`; HANDOVER #581). The code exclusion covers it.
    Otherwise `canEmbark` and `canGarrison` belong to foot roles or abilities, and no vehicle tunnels.
  - `stepSeparation` runs before `stepTransport`, so passengers ride the pushed hull in the same tick.
- **V-R14. N2's stances are not anchors.**
  - A vehicle on `hold` or `ambush` (N2 Task 3, `setStance`) is pushed like any other.
  - The 11 Oct lead ruling ("Hold has no sim column; a halted vehicle is pushed") carries over to
    `ambush`. `ambush` has a `stance` column, but it braces a vehicle no more than a halt does.
- **V-R15. Kit is not modelled.** The footprint is the hull without kit, as the ellipse is. A Lavi
  with a slat cage may overlap a neighbour by the depth of the cage (centimetres up to a decimetre).
- **V-R16. If a §5.7 target fails** (was For the lead item 4):
  - stop, and hand the reading to `balance-analyst`;
  - any `tuning.ts` change is its own commit, with its own reason, inside this plan;
  - it is never folded into a re-pin.

---

## Interactions (15 Oct)

How spacing meets each system it touches, and the code each rests on. Rows in **bold** change the
plan.

| system | code | what spacing does there | plan change |
|---|---|---|---|
| **Group formations** | `formation.ts` `assignFormation`: `VEHICLE_SPACING` 2, both sideways and between vehicle ranks; `MAX_LATERAL` 3; the phase-2 overflow drops the spacing. `tools/src/formation_walk.test.ts` | **Sideways:** slots are never contested, because `2 × half_width ≤ 1.46 < 2`. **Ranks:** contested. A rank sits 2 tiles behind the one in front, and vehicles arrive facing the approach, so four long hull pairs overlap there by `half_length_A + half_length_B − 2`: Namer–Namer 0.44 tile, Kipod 0.40, Eitan 0.38. Today they visibly overlap in formation. After spacing, the arriving rear vehicle stops at contact, up to 0.44 tile short of its slot (V-R5, V-D5). **The D9 is not in a vehicle rank at all:** it is `DOMAIN_FOOT` (role `engineer` is in `FOOT_ROLES`), so `assignFormation` gives it a rear slot at `INFANTRY_SPACING` 1 (`sim.ts` L2335, `formation.ts` L152 and L190–193), and the `2 × half_width ≤ 2` test does not cover it. Until #598 (the D9's `wheeled` data fix) lands, a D9 stands about 1.0–1.4 tile inside the front rank's last vehicle and is pushed out on arrival; **#598 should land before spacing**. **Overflow:** slots are 1 tile apart (or the origin, when nothing is free), so every pair contests them. **`formation_walk`:** the `tel_marum_2_foothold` force (2 Eitans, 1 Lavi) fills one sideways rank, so its `y === 30` and distinct-tile asserts should hold (R) | V-D3 restated. `formation_walk.test.ts` is a named gate in Task 2. A new tools walk asserts that no pair overlaps after a real group move. **Lead Q2** (rank depth) |
| **Targeted fire (GH-420)** | `stepFocus` (`focusInReach`, and the wait when "already standing on the goal tile"); `FOCUS_REACH_SLACK` 0.5 tile; `FOCUS_LOST_TICKS` 100; `Command` `attack`; `focusTarget` | **Observed target:** untouched, because a chaser stops at effective range long before contact. **Lost target:** its last-seen tile may be held by a parked vehicle. V-D5 then ends the leg at contact, but `stepFocus`'s on-goal test (own tile = goal tile) is false, so it re-issues the leg every tick and `moving` flickers. **A stopped focuser** pushed by up to 0.25 tile stays inside the 0.5-tile hysteresis band, so pushes do not make it close in again | V-R9: `stepFocus` asks `goalHeldByVehicle`, and a test pins "no flicker" |
| Garrison overhaul (#606) | `stepGarrison` (overflow units "wait at the door, stopped", ~L5398); `eyePoint` L5012; `garrisonedIn` | Garrisons and door queues are foot units; vehicles cannot garrison. A garrisoned unit is excluded (V-R13). `eyePoint` reads a structure, not a vehicle. A vehicle parked on a door tile does not block infantry, because separation is vehicle-to-vehicle only | none |
| **Versus determinism** | `stepSeparation` itself; `versusSpawns` (`packages/app/src/net/versus-force.ts`); `SANDBOX_KDF` (`sandbox-force.ts` L31); `tools/src/net/two-client.test.ts`; CI's `net:engines` (`tools/src/net/two-engine.ts`); `content-digest.ts` | **Determinism:** integer arithmetic only (`fx.mul`, `fx.div`, `fx.sqrt`, the `fx.sin`/`fx.cos` lookup table); no `rng`; Jacobi sums, so visiting order does not matter; scratch arrays preallocated; ids sorted ascending only to fill the list. The one rule that uses id order is the tie-break for coincident vehicles. Both clients share it, because ids are creation order and every per-entity column is hashed by id. **It changes every versus world.** The KDF force places a Lavi at `(0,−3)` beside the D9 at `(−1,−3)`, and a Lavi at `(0,3)` beside the jeep at `(1,3)`. On `beit_sahwan_outskirts` both pairs lie along the facing axis (facing about −2°), with capsule overlaps of about 1.17 and 0.49 tile at tick 0 (R), which resolve within 5 ticks. On `tel_marum` the pairs stand side by side, overlapping by about 0.22 and not at all. The Sarim force has no pair in contact (R): its gun trucks are 2+ tiles apart sideways, and its Grads clear the trucks by at least 0.58 tile. **`shippedContentDigest()` moves** with the unit JSON. No literal pins it, and two clients on different builds then desync on the first hash tick, which is the designed guard | Task 2a and Task 2 re-pin the five versus literal sites, each with its reason. Two-client equality and `net:engines` are named gates |
| Flow fields, boulders, `wheeled` | `FlowField` (no corner cutting, flowfield.ts L68–71); `fieldFor`; `maskFor`; `blockedVehicleMask` (an alias of `blocked` on a map with no boulders); `UnitType.wheeled` and `moveDomain` | Fields stay per goal and per domain. Separation never writes a mask, so F2's C-R20 mask cache is untouched. A push can carry a vehicle across a tile edge, and on the next tick it follows that tile's direction. **The corner rule** (V-R10) keeps a shove from crossing a wall corner that the field would not cross. The D9 clips against the foot mask, because that is the mask it paths on | V-R10. The D9's domain is a separate issue (changelog item 7) |
| Breach detours | `selectBreachTarget` L3782 (`side === 0`, which N2 changes to `isHumanHeld`); `BREACH_DETOUR_SLACK`; `FlowField.costAt` | A moving unit compares its tile's `costAt` with the straight-line distance. A push may change that tile, and both reads are integers, per tile. A vehicle stopped at contact by V-D5 now takes the stationary branch, where before it drove on into the other hull. So an AI (not human-held) vehicle may pick a breach target a little earlier. No new path; `playtest` measures it | named in Task 2 Step 6 |
| Transport | `stepTransport` L5188 (passengers copy the carrier's position; a boarder chases the carrier until within `LOAD_RANGE_SQ`); `canSeat` | Carriers are vehicles; riders are foot units and are excluded. Separation runs before `stepTransport`, so riders move with a pushed carrier in the same tick. A boarder already chases a carrier that moves | none |
| Wrecks | The sim has no wreck body: `destroy` sets `alive = 0`. The wreck is `units/mesh-vehicle-death.ts`, which is presentation | Dead vehicles are skipped, so a living vehicle can still stand on a wreck mesh. A wreck that blocks would be a sim design (a new body, a mask, or a footprint on the dead), not this plan's | **lead Q1** |
| F2 held ground | `income.ts` `zoneHolder`/`zoneState`; `corridor.ts` `corridorCut` (`CORRIDOR_INTERDICT_SQ` 2 tiles); a recheck on holder change (C-R17, C-R20) | A vehicle pressed against a zone edge can step in and out by up to 0.25 tile and flip a holder. F2 recomputes on holder change, cached since C-R20. No shipped mission pays out for a zone yet (C-R1) | Re-read F2's Task 8 data at pre-flight; `playtest` measures |
| F1 high ground | `mission.ts` `riseHold`, `spawnRise` | A vehicle pushed off a rise tile resets nothing new: the hold reads position, as it would for any move | `playtest` measures |
| F4 production | F4 Task 3 deploys at `structureExit`; Task 5's rally (`attackMove`, no sweep) and `reservedTilesFor` | Vehicles deployed one after another at one exit are coincident: V-D4 splits them by id. Two rallied vehicles land on reserved tiles 1 apart, and so in contact: V-D5 and a push. F4's own fixtures declare no footprint, so its tests do not move | none (re-read F4 as merged) |
| Renderer | `units/vehicle-weight.ts`, `running-gear*.ts` (speed from position deltas), `selection-ring.ts` | A pushed parked vehicle has a non-zero speed for a tick or two: a brief turn of the wheels and a puff of dust. Presentation only; invariant 4 holds | none |

---

## Pre-flight scan (refreshed 15 Oct)

Per superpowers:subagent-driven-development. These rows were read, not run.

**Pairs of tasks**

| # | tasks | shared | found | ruling |
|---|---|---|---|---|
| S-1 | 1 × 1b | units of the footprint | Task 1 stores tiles as Fx on `UnitType` (`sepHalfLen`, `sepHalfWid`, `sepCentre`, `sepBound`). Task 1b's `hullCapsule` takes tiles as Fx and never reads a `UnitType` | consistent |
| S-2 | 1 × 2 | who takes part | The 11 Oct domain rule sweeps in role-less fixtures (`TANK` L40, `ECO_*`) and misses the D9 | V-R1: `sepHalfWid > 0 && !isAir` |
| S-3 | 1b × 2 | `hullCapsule(…, out, o)`, `capsuleOverlap(cap, a, b, out)` | Allocating per pair would mean allocating per tick, at 60 vehicles | Out-parameters into preallocated `Int32Array`s, fixed in 1b's Interfaces |
| S-4 | 2a × 2 | `sepStall` | 2a hashes a column nothing writes yet, so its fold has no behavioural failing input until Task 2 | 2a's falsification is the house column proof: drop the `hashArray` line and every old pin reads back. Task 2's valve test is the behavioural red |
| S-5 | 2a × 2 | the versus pins | They move twice | Allowed: two reasons, two commits (V-R12) |
| S-6 | 2a × 2 | `finishLeg(i)` | A refactor and a behaviour change in one commit cannot prove the refactor | The extraction is Task 2a's first commit, read back on every pin |
| S-7 | 2 × 3 | `sim-scaling.ts`'s phase list (L96–110) | It lacks `stepSeparation`, and already lacks `stepFocus` and `stepBrace` | Task 3 adds all three |
| S-8 | 2 × 4 | stage4-order's row (~L263) | It names `mobility.radius_tiles` and "sim pins, once", which are stale against V-R2 and V-R11 | Task 4 corrects it |
| S-9 | 1 × 4 | `CLAUDE.md` "Adding content: A unit" | The footprint rule belongs there | Task 4 |

**Each task, on itself**

| task | self-consistent? | found |
|---|---|---|
| 1 | fixed | The old rule ("every type in `ELLIPSE_BY_TYPE` has a radius, and every radius has an ellipse") breaks on `moto_rpg`, which is on the vehicle domain with no ellipse. It is now a named exemption with a demotion assertion (V-R4). Task 1 still moves no hash, because nothing reads the field yet |
| 1b | yes | Pure, with literal expectations from hand arithmetic. Distance is `fx.sqrt` of `fx.mul` sums, never `distSqFx`: that rounds `(d >> 8)²` and would change every literal |
| 2a | yes | a refactor commit, then a column commit |
| 2 | fixed | Four defects in the old task. The head-on test contradicted the old push (V-R6). The wall test missed corners (V-R10). The cap lost to a jeep (V-R8). The note "the orders pin should not move" now covers all three golden replays |
| 3 | fixed | The harness had no `stepSeparation` phase to attribute time to (S-7) |
| 4 | yes | — |

**Against F2's branch (`feat/gf2-held-ground` `53282f8f`)**

| # | shared | F2 has | found | ruling |
|---|---|---|---|---|
| F-1 | `tuning.ts` | a block appended at the end of the file (`CONTEST_RADIUS_SQ`, `CORRIDOR_INTERDICT_SQ`, `CORRIDOR_VENT_SQ`, `CORRIDOR_RECHECK_TICKS`) | Appending here too would conflict on the same hunk | V-R8: put the constants after `ROUT_SPEED_SHIFT` |
| F-2 | `sim.ts` | untouched by F2 (C-R5: `tunnelVent` already existed) | no overlap | — |
| F-3 | `determinism.test.ts` | the economy fixtures, re-pinned at `9f4fd7d7`: `ECONOMY_PIN` 275731552, `_RELIEF` 145368021 | `economyHash` does not fold `sim.hash()`, and no `ECO_*` type gets a footprint | Unmoved (R). Task 2's replay is appended after F2's and F4's blocks |
| F-4 | zone holders, corridor cuts | They read positions every tick, or every 20 ticks | A push can flip a holder at a zone edge | No code change; `playtest` measures |
| F-5 | `playtest` banking | `BANKING_OVER_30_WINNERS` 15, `ZONE_PASSIVE_INCOME` 0 | Changed timing can move a plan's purse at the end | Re-read at pre-flight. Task 2 Step 6 names any move |
| F-6 | the C-R20 mask cache | copies `blockedVehicle`, and recomputes only when it changes | Separation never writes a mask | consistent |
| F-7 | F2 Task 8 data (zones on four missions, held for the lead under C-R1) | — | If it lands first, more playtest lines read positions | Re-read at pre-flight, and re-take the baseline |

**Against N2's plan**

| # | shared | N2 produces | found | ruling |
|---|---|---|---|---|
| N-1 | `sim.ts`: `Command`, `applyCommands`, `haltUnit`, `SimConfig.humanHeld` | `setStance`, `build`, `support` | No hunk overlaps `stepSeparation`, `stepFocus`, `stepMovement` or `UnitType` | — |
| N-2 | `selectBreachTarget` | `isHumanHeld(side)` replaces `side === 0` | Stops under V-D5 feed its stationary branch (see Interactions) | `playtest` measures. Versus rooms breach nothing, because both seats are held |
| N-3 | `determinism.test.ts`'s golden builders | They "take an explicit table" | The new replay must build its `Sim` the same way | **Re-read at pre-flight**, and copy N2's `new Sim({ …, humanHeld })` shape |
| N-4 | `setStance` | `hold`, `ambush` (a `stance` column) | — | V-R14: not anchors |
| N-5 | `RUNTIME_DIGEST_PIN` / `_RELIEF` (born in N2 Task 6) | The digest folds `economyHash()` first, then runtime state | `sepStall` is sim state | Unmoved (R). **Re-read at pre-flight:** if the digest folds `sim.hash()`, these move in Task 2a |
| N-6 | the versus pins | "measured" under `[true, true]` in N2 Task 2 | Spacing moves them twice | **Re-read the post-N2 values at pre-flight** |
| N-7 | `two-client.test.ts` | gains a `setStance` frame | It checks equality only | consistent |

**Against F4's refreshed plan**

| # | shared | F4 produces | found | ruling |
|---|---|---|---|---|
| R-1 | deploy | units at `structureExit` | Coincident vehicles | V-D4's split. F4's fixtures have no footprint |
| R-2 | rally | one `attackMove` with no sweep, to reserved tiles | Two rallied vehicles meet at contact | V-D5; consistent |
| R-3 | `ECONOMY_PIN`/`_RELIEF`, `RUNTIME_DIGEST_PIN`/`_RELIEF` | moved once, in F4 Task 6 | Their values are unknown on 15 Oct | **Re-read at pre-flight.** Spacing predicts they do not move |
| R-4 | `sim.ts`: `structureProducesFor`, and `stepDemolition`'s skip for the side's own camp (F4 Task 7) | — | The anchor reads `demoTicks`, not the skip | consistent |
| R-5 | `playtest` | Task 10's plan edits, on five building plans | Spacing's baseline is the tree after F4 | The pre-flight baseline |
| R-6 | the `Command` union | `cancelBuild`, `setRally`, `clearRally` | — | consistent |

---

## Questions for the lead

Only these two need the lead's taste. Every other open point is ruled above.

1. **Should wrecks block vehicles?**
   - The sim has no wreck body, so a living tank can stand on the wreck mesh of the tank it killed
     (see Interactions, wrecks).
   - Making wrecks solid needs a new sim body or a footprint on the dead, with its own pins and its
     own playtest reading.
   - **Recommended:** no, not in this plan. Raise it again if the after-captures show tanks sitting in
     wrecks.
2. **How deep should a formation rank be for long hulls?**
   - Ranks are 2 tiles deep and a Namer is 2.44 tiles long. So today, two Namers in consecutive ranks
     overlap by 0.44 tile while standing in their slots.
   - After spacing, the arriving rear vehicle stops at contact (V-R5, V-D5), up to 0.44 tile short of
     its slot.
   - The alternative is a 3-tile vehicle rank in `formation.ts`. That moves the formation pins and
     every group order.
   - **Recommended:** accept the short stop, and judge it on screen in the after-captures.

---

## Pre-flight 2 (2026-10-11), evening, against main 49715ff9

*History. Its pins and line hints are stale; the refreshed values are above and in the re-pin table.*

Read and grepped, not run.

- **#537 removed one of the two ways vehicles met.**
  - "Why" says vehicles meet on the shared flow field on the way, and through the closing rule at the
    end.
  - Since #537 a player's attack-move stops where it was sent (in formation slots, 2 tiles apart). So
    the meeting at the end survives only for orders that `sweep`: mission waves, trigger `commit`s and
    the balance backtest (`targets.ts` sets `sweep: true` on every attack-move). The meeting on the
    route is untouched.
  - PA-10's captures predate #537. **Re-take one before Task 2:** a group of five KDF vehicles ordered
    across `beit_sahwan_outskirts`, and a wave arriving. Then the PR's before/after is measured on
    today's movement.
  - If the player's case no longer reproduces at the end of a move, say so in the PR. The plan still
    stands for the route and for AI sweepers.
- **#534 found the player-side symptom too:** two Namers ending a group move on an identical position,
  so a click can never single one out ("Not changed" in #534). V-D4's coincident split is the fix for
  that; add it to the PR's evidence.
- **Pins.** Three sim pins: flat `1202444260`, relief `3354895120`, orders `2737216487`. *(15 Oct: now
  935671699 / 2842924511 / 3272041047, and none moves for behaviour, V-R11.)*
- **Playtest is 30 seeds** (#539, #542).
  - "Every outcome class holds" now means: every winning plan wins on 30/30 seeds, every control loses
    on 30/30, and every gate opens on time on 30/30.
  - A pushed hull that costs one plan one seed is red. The fix is a plan follow-up in its own commit
    (the #542 pattern), never a mission edit folded into the re-pin.
- `LADDER_CREDITS` = `CAMPAIGN_CREDITS` = 5917, `ROSTER_MAX` 30. *(15 Oct: 5940, 5940, 29.)*
- **Ruling (lead, 2026-10-11): Hold has no sim column**, so there is no held state to exempt: a halted
  vehicle is pushed like any other. *(15 Oct: carried over to N2's stances, V-R14.)*

---

## Decisions

The 11 Oct defaults, each with its 15 Oct status.

- **V-D1. Who takes part.**
  - ~~A unit takes part when its move domain is `DOMAIN_VEHICLE` and it is not air.~~ **Superseded by
    V-R1:** a unit takes part if and only if its type declares `mobility.footprint` and it is not air.
  - Ten types declare one (V-R3); `moto_rpg` is exempt by name (V-R4).
  - Infantry, civilians and aircraft are neither pushed nor push. Infantry stacking stays a formation
    concern, out of scope.
  - #247 has landed: `manpad_team` is `wheeled: false`.
- **V-D2. The shape.** ~~A circle of radius `half_width`.~~ **Superseded by V-R2: a capsule.**
  - Its segment has half-length `half_length − half_width`, runs along the facing, and is centred
    `centre_along` ahead of the position. Its radius is `half_width`.
  - Side-on, head-on and nose-to-tail contact are all resolved exactly. Corners are rounded by
    `half_width`.
- **V-D3. A footprint never contests a SIDEWAYS formation slot.**
  - `2 × half_width ≤ VEHICLE_SPACING` (2). The widest is the D9's 1.46, but the D9 is foot-domain
    today, so it takes a rear slot at `INFANTRY_SPACING` 1 and this bound does not cover it: it overlaps
    the front rank by about 1.0–1.4 tile until #598 makes it `wheeled` (see Interactions,
    formations). The widest hull this bound does cover is the Namer's 1.38.
  - Restated 15 Oct: **rank** slots (2 tiles along the approach) are contested by long hulls, because
    those hulls genuinely overlap there today (see Interactions, formations). The arriving rear vehicle
    stops at contact, up to 0.44 tile short of its slot (V-R5, V-D5; lead Q2).
  - Overflow slots, 1 tile apart, are contested by every pair.
- **V-D4. The push.** Rewritten as V-R5 (the shares) and V-R8 (the cap).
  - It applies to a pair whose capsules overlap by `ov > 0`. The normal runs from B's closest point
    toward A's.
  - The shares depend on whether each vehicle is an anchor, a mover or stationary. Each vehicle's
    summed push is capped at `SEPARATION_MAX_STEP` (0.25 tile).
  - When the closest points coincide (`d = 0`), the pair splits along x, with the lower id going to
    −x. No `rng`.
- **V-D5. A goal held by another vehicle counts as reached at contact.**
  - A mover counts as arrived when it touches a stationary or anchored vehicle whose capsule also
    covers the mover's own capsule placed at its goal. `finishLeg` then gives it its next waypoint,
    or sets `moving = 0`.
  - So two vehicles sent to one point stop when they touch, rather than shoving forever.
  - Implemented through `goalHeldByVehicle` (V-R9).
- **V-D6. A push never turns a hull.**
  - `facing` is untouched; only `posX` and `posY` move.
  - A pushed vehicle sets `displaced = 1`: it did move this tick, and that is honest for every reader
    of the flag (`stepDemolition` ~L5452, `stepTunnelCharge` ~L5592).
  - A D9 in the middle of a cut is an anchor (V-R5), so the first of those readers never sees a push
    on it.
- **V-D7. Both sides, and every participating vehicle.**
  - Separation is physical, not tactical: a KDF tank and a Sarim technical push each other just as
    two KDF tanks do.
  - A sweeping closer stops at contact with its target (V-D5), unless the `engaging` latch has already
    stopped it at effective range. A player's attack-move does not close (#537).
- **V-D8. Cost.**
  - One scratch list of participant ids per tick, in a preallocated `Int32Array`, so nothing is
    allocated per tick.
  - Then `V(V − 1) / 2` integer broad-phase checks: the distance between centres against the two
    bounding radii (`half_length + |centre_along|`). The capsule test runs only for pairs that pass.
  - At V = 60 that is 1,770 broad checks a tick, small next to detection's O(N²) (R; Task 3 measures
    it).
- **V-D9 (new). The slide:** see V-R6.
- **V-D10 (new). The valve:** see V-R7.

---

## Global Constraints

- **The four invariants hold.**
  - Fixed-point only (`fx.mul`, `fx.div`, `fx.sqrt`, `fx.sin`, `fx.cos`); no `Math.*`; no `rng`.
  - Jacobi sums, so no result depends on the order in which pairs are visited.
  - The footprint becomes Q16.16 at load, in `unitTypeFromJson`, through `fx.from` (the sanctioned
    float boundary). The sim never reads it as a float.
  - Flow fields only: no per-unit A*, no new field, no field per vehicle.
- **Nothing depends on creation order beyond what is already hashed.** The only rule that uses id
  order is the tie-break for coincident vehicles. Ids are creation order and every per-entity column is
  hashed by id, so two clients that agree on a hash also agree on the tie-break.
- **Pins move only where the re-pin table says, each in its own commit with its proof.**
  - Task 2a moves every `sim.hash()` literal for the column, with the proof "no behaviour moved: with
    the `hashArray(h, this.sepStall)` line removed, every replay reproduces the old value".
  - Task 2 moves the versus literals for behaviour and births `SEPARATION_PIN`. It reads the three
    golden replays back **unchanged**, because no fixture declares a footprint. A golden replay that
    moves in Task 2 is a defect to find, not a re-pin.
- **`pnpm balance`** must still pass every §5.7 target. Its printed win rates are quoted before and
  after (V-R16).
- **`pnpm playtest`:** every plan keeps its outcome class on 30/30 seeds.
  - These re-pin **only if they move**, each in its own commit with the per-mission line that moved:
    `LADDER_CREDITS` (5940), `CAMPAIGN_CREDITS` (5940), `ROSTER_MAX` (29), `GATES`, and F2's
    `BANKING_OVER_30_WINNERS` (15) and `ZONE_PASSIVE_INCOME` (0).
  - All of them are re-read at pre-flight, because F2, N2 and F4 land first.
- **The golden baseline is expected to move** (R).
  - The sandbox force spawns its Lavis one tile from the D9 and from the jeep, in contact. So
    `vehicle`, `kitted` and possibly `quiet` move, as those vehicles separate before the capture tick.
  - `open-ground` is scoped to a crop with no units, `relief`'s hulls stand below its frame, and
    `aftermath` frames no unit.
  - Bless from CI numbers after merge (`visual-baseline-bless` opens a review PR), never from the
    branch.
- **Every check is seen red** by a one-line mutation, quoted in the commit. A survivor is disclosed.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test:determinism && pnpm test`,
  then `pnpm validate:data`, then `pnpm balance` and `pnpm playtest`.
- **Never run `pnpm ui:routes`, `golden-baseline`, `ui:shots` or `net:engines` locally**; CI runs them.
  Browsers start with music off. Never use port 5177. Never start or kill a dev server, and never
  `pkill`.
- **Git:**
  - `/usr/bin/git` by absolute path, one plain command per call;
  - commit with `/usr/bin/git commit -s -F <msg> -- <paths>`;
  - never `-A`, `git checkout -- <file>`, `git stash`, a rebase or a force-push;
  - messages end with a blank line and `Co-Authored-By: Claude <model name> <noreply@anthropic.com>`;
  - the lead merges.

---

## Review Focus

The five uncovered conditions most likely to bite. Each is pinned by a test in the task that owns it.

1. **Collinear head-on on open ground.** Flow fields put both vehicles on one tile-centre line. They
   pass, each to its own right, without the valve firing. Task 2, "head-on: each passes on its own
   right".
2. **A corridor narrower than both hulls.** No deadlock: both arrive, and the valve is seen to fire.
   Task 2, "the valve".
3. **A disabled hull in a street with a column behind it.** The hulk never moves, and the column gets
   past. Task 2, "an anchor is never pushed".
4. **The sandbox and versus KDF spawn overlap.** Lavi/D9 and Lavi/jeep are in contact at tick 0. It
   resolves within 10 ticks, with nobody in a wall. Task 2, `tools/src/vehicle_spacing_walk.test.ts`.
5. **A lost focus target's last-seen tile held by a parked vehicle.** The chaser stops once and stays
   stopped. Task 2, "a focus chase stops at a held goal".

---

## File structure

| File | Role | Task |
|---|---|---|
| `data/schemas/unit.schema.json` | `mobility.footprint` | 1 |
| `data/units/kdf/{mbt_lavi,ifv_namer,apc_eitan,apc_kipod,dozer_d9,jeep_shoded,scout_shachaf}.json`, `data/units/enemy/{technical,gun_truck,rocket_battery}.json` | the authored footprints | 1 |
| `packages/sim/src/sim.ts` | Task 1: `UnitTypeJson.mobility.footprint`; `UnitType.sepHalfLen`, `sepHalfWid`, `sepCentre`, `sepBound`. Task 2a: `finishLeg`, the `sepStall` column, `state.sepStall`, `hash()`. Task 2: `stepSeparation`, `applySeparationPush`, `goalHeldByVehicle`, `isSepAnchor`, `debugDisableMobility`, the `tick()` line, `stepFocus`'s wait | 1, 2a, 2 |
| `packages/sim/src/separation.ts` | **New.** Pure capsule geometry: `hullCapsule`, `closestSegmentPoints`, `capsuleOverlap` | 1b |
| `packages/sim/src/separation-geometry.test.ts` | **New.** The geometry, with literal expectations | 1b |
| `packages/sim/src/tuning.ts` | `SEPARATION_MAX_STEP`, `SEPARATION_STALL_TICKS` (after `ROUT_SPEED_SHIFT`) | 2 |
| `packages/sim/src/separation.test.ts` | **New.** The sim tests | 2 |
| `packages/sim/src/determinism.test.ts` | the column re-pin (2a); `separationReplay` and `SEPARATION_PIN` (2) | 2a, 2 |
| `packages/app/src/net/versus-force.test.ts` (L112), `per-seat-types.test.ts` (L167), `match-world.test.ts` (L25, L188), `tools/src/backtest/versus-breach.test.ts` (L22–25) | the versus literals | 2a, 2 |
| `packages/sim/src/fire-support.test.ts` (L79, `HASH` 2460528690) | a `sim.hash()` literal: the column re-pin | 2a |
| `tools/src/vehicle_footprint.test.ts` | **New.** The footprint census | 1 |
| `tools/src/vehicle_spacing_walk.test.ts` | **New.** Real rosters: a group move, and the versus spawn | 2 |
| `tools/src/backtest/playtest.ts`, `packages/app/src/ui/stores-model.ts` | only if a line moves | 2 |
| `tools/src/perf/sim-scaling.ts` | the phase list | 3 |
| `docs/PERFORMANCE.md` | the tick-cost reading | 3 |
| `docs/HANDOVER.md`, `CLAUDE.md`, `docs/polish/commercial-polish-audit.md`, `docs/superpowers/plans/2026-10-04-stage4-order.md` | the ledger; PA-10 to DONE; the stage row | 4 |

---

## Pre-flight (before Task 1; record the results in the task report)

- [ ] **1. The base.** `main` must contain F2's, N2's and F4's merges: check with
  `grep -n "logisticsOf\|applyQueued\|productionLines" packages/sim/src/mission.ts`. Cut
  `feat/vehicle-spacing` from it. If F4 has not merged, stop.
- [ ] **2. Re-read at pre-flight.** Each of these depends on work not merged on 15 Oct.
  - **The sim pins:** 935671699 / 2842924511 / 3272041047 on `6a3408a1`. F2, N2 and F4 all predict
    they do not move.
  - **The economy and digest pins:**
    - `ECONOMY_PIN` / `_RELIEF`: F2 sets 275731552 / 145368021, then F4 Task 6 moves them.
    - N2's `RUNTIME_DIGEST_PIN` / `_RELIEF`: born in N2 Task 6, moved in F4 Task 6.
    - Whether N2's digest folds `sim.hash()`. If it does, those two also move in Task 2a.
  - **The versus literals:**
    - 580559085 / 1260439781 / 3043363756 on `6a3408a1`; N2 Task 2 measures them.
    - Every other `sim.hash()` literal:
      `grep -rn "hash()).toBe(\|hash).toBe(" packages tools`.
  - **N2's golden-builder shape** (`new Sim({ …, humanHeld })`), for `separationReplay`.
  - **The playtest values:** `LADDER_CREDITS` / `CAMPAIGN_CREDITS` (5940), `ROSTER_MAX` (29),
    `GATES`, `BANKING_OVER_30_WINNERS` (15) and `ZONE_PASSIVE_INCOME` (0).
  - **What else landed:** whether F2's Task 8 data (C-R1) or N3 has merged.
  - **The vehicle roster.** Run `unitTypeFromJson` over `data/units/**`. The types with
    `moveDomain === DOMAIN_VEHICLE && !isAir` must be exactly the ten of V-R3 minus the D9, plus
    `moto_rpg`. A new vehicle means a new V-R3 row.
  - **The sandbox placements behind the versus prediction**, in `sandbox-force.ts`: `mbt_lavi` at
    0,−3 and 0,3; `dozer_d9` at −1,−3; `jeep_shoded` at 1,3.
- [ ] **3. Baselines.** `pnpm test:determinism`, `pnpm test`, `pnpm typecheck` and `pnpm lint` are
  green. Write `pnpm balance` and `pnpm playtest` to the scratchpad; both exit 0.
- [ ] **4. The before-captures** (Pre-flight 2): a group of five KDF vehicles ordered across
  `beit_sahwan_outskirts`, and a wave arriving, on the branch base, at zoom 1. Take them through the
  user's own running dev server or through CI; never start a server.

---

## Task 1: the footprint, as data (hash-neutral)

**Model:** haiku for the JSON, sonnet for the test. **Agent:** `sim-guard` (schema and `unitTypeFromJson`).

**Files:** the schema; ten unit JSONs; `packages/sim/src/sim.ts`; `tools/src/vehicle_footprint.test.ts`.

**Interfaces:**
- Produces, in `UnitTypeJson.mobility`:
  ```ts
  /** Vehicle spacing (GH-421, V-R1): the hull as a capsule, in tiles. Present on exactly the
   *  vehicles that separate; absent, the unit is neither pushed nor pushes. */
  footprint?: { half_length_tiles: number; half_width_tiles: number; centre_along_tiles?: number };
  ```
- Produces, on `UnitType` (Fx; all 0 when absent):
  `sepHalfLen`, `sepHalfWid`, `sepCentre`, and `sepBound = sepHalfLen + |sepCentre|`.

- [ ] **Step 0: Re-measure V-R3.**
  - In a scratch file under the scratchpad, call `unitFootprintTable()` from
    `tools/src/perf/unit-footprints.ts`.
  - Print each row's `vehicleHalfExtent` (`along`, `across`, `centreAlong`) to 0.01.
  - A value more than 0.02 from V-R3's table replaces it, and the commit says which and why.
- [ ] **Step 1: Write the failing test** `tools/src/vehicle_footprint.test.ts`:

  ```ts
  import { describe, expect, it } from 'vitest';
  import { units } from '@lions/data';
  import { VEHICLE_SPACING } from '../../packages/sim/src/formation';
  import { DOMAIN_VEHICLE, unitTypeFromJson, type UnitTypeJson } from '../../packages/sim/src/sim';

  /** Hull half-extents in tiles: [half_length, half_width, centre_along]. LITERALS, inverted by hand
   *  from readability.ts's ELLIPSE_BY_TYPE at 6a3408a1 and re-measured in Task 1 Step 0. An oracle
   *  imported from the code under test cannot fail (CLAUDE.md). */
  const HULL: Record<string, readonly [number, number, number]> = {
    apc_eitan: [1.19, 0.51, 0],
    apc_kipod: [1.2, 0.63, 0],
    dozer_d9: [1.14, 0.73, 0],
    gun_truck: [0.9, 0.47, 0],
    ifv_namer: [1.22, 0.69, 0],
    jeep_shoded: [0.8, 0.39, 0],
    mbt_lavi: [0.87, 0.48, -0.18],
    rocket_battery: [0.95, 0.34, 0],
    scout_shachaf: [0.77, 0.42, 0],
    technical: [0.83, 0.3, 0],
  };
  /** Vehicle-domain types that do NOT separate, each with its reason (V-R4). */
  const EXEMPT: Record<string, string> = {
    moto_rpg: 'a motorcycle drawn as a rigged team: no vehicle GLB, no ellipse',
  };
  const byId = units as Record<string, UnitTypeJson>;
  const all = Object.values(byId);
  const fp = (u: UnitTypeJson) => u.mobility.footprint;

  describe('vehicle footprints (GH-421)', () => {
    it('exactly the measured hulls declare one', () => {
      expect(all.filter((u) => fp(u) !== undefined).map((u) => u.id).sort()).toEqual(Object.keys(HULL).sort());
    });
    it('every vehicle-domain ground type declares one, bar the named exemption, which still needs it', () => {
      for (const u of all) {
        const t = unitTypeFromJson(u);
        if (t.isAir || t.moveDomain !== DOMAIN_VEHICLE) continue;
        if (u.id in EXEMPT) expect(fp(u), `${u.id}: exempt, so no footprint`).toBeUndefined();
        else expect(fp(u), `${u.id} is a vehicle with no footprint`).toBeDefined();
      }
      // Demotion: an exemption whose unit stopped being a footprint-less vehicle must be deleted.
      for (const id of Object.keys(EXEMPT)) {
        expect(unitTypeFromJson(byId[id]).moveDomain, `${id}: delete its exemption`).toBe(DOMAIN_VEHICLE);
      }
    });
    it('agrees with the measured hull to 0.05 tile', () => {
      for (const [id, [len, wid, ctr]] of Object.entries(HULL)) {
        const f = fp(byId[id])!;
        expect(Math.abs(f.half_length_tiles - len), `${id} half_length`).toBeLessThanOrEqual(0.05);
        expect(Math.abs(f.half_width_tiles - wid), `${id} half_width`).toBeLessThanOrEqual(0.05);
        expect(Math.abs((f.centre_along_tiles ?? 0) - ctr), `${id} centre_along`).toBeLessThanOrEqual(0.05);
      }
    });
    it('no footprint contests a sideways formation slot (V-D3)', () => {
      for (const u of all) if (fp(u)) expect(2 * fp(u)!.half_width_tiles, u.id).toBeLessThanOrEqual(VEHICLE_SPACING);
    });
    it('no aircraft declares one', () => {
      for (const u of all) if (u.mobility.domain === 'air') expect(fp(u), u.id).toBeUndefined();
    });
  });
  ```

  Run: `pnpm vitest run tools/src/vehicle_footprint.test.ts`. Expected: FAIL on the first test,
  because no unit declares a footprint yet.
- [ ] **Step 2: Implement.**
  - **The schema.** Inside `mobility.properties`, beside `wheeled`:
    ```json
    "footprint": {
      "type": "object",
      "description": "Vehicle spacing (GH-421): the hull as a capsule, in tiles, measured from the vehicle GLB (tools/src/perf/unit-footprints.ts). Present only on vehicles that separate; the sim never pushes a unit without one. half_width is at most VEHICLE_SPACING / 2 so no sideways formation slot is contested.",
      "required": ["half_length_tiles", "half_width_tiles"],
      "additionalProperties": false,
      "properties": {
        "half_length_tiles": { "type": "number", "minimum": 0.2, "maximum": 1.5 },
        "half_width_tiles": { "type": "number", "minimum": 0.2, "maximum": 1.0 },
        "centre_along_tiles": { "type": "number", "minimum": -0.5, "maximum": 0.5 }
      }
    }
    ```
  - **The ten JSONs.** Inside `mobility`, after `turn_rate_deg_s`, add
    `"footprint": { "half_length_tiles": …, "half_width_tiles": … }` with the values from V-R3. Only
    `mbt_lavi` also gets `"centre_along_tiles": -0.18`.
  - **`sim.ts`.**
    - Add the `UnitTypeJson` field above.
    - On `UnitType`, add the four Fx fields, with a doc comment naming V-R1.
    - In `unitTypeFromJson`:
      ```ts
      const foot = json.mobility.footprint;
      const sepHalfLen = foot ? fx.from(foot.half_length_tiles) : 0;
      const sepHalfWid = foot ? fx.from(foot.half_width_tiles) : 0;
      const sepCentre = foot ? fx.from(foot.centre_along_tiles ?? 0) : 0;
      // …in the returned object:
      sepHalfLen, sepHalfWid, sepCentre,
      sepBound: fx.add(sepHalfLen, sepCentre < 0 ? -sepCentre : sepCentre),
      ```
    - Nothing reads the new fields yet.
- [ ] **Step 3: Gates.**
  - `validate:data` passes.
  - The five sim and economy pins, and every versus literal, are unchanged, because nothing reads the
    field.
  - `balance` and `playtest` are byte-identical.
  - `shippedContentDigest()` moves, because the unit JSON changed. No literal pins it; say so in the
    commit.
- [ ] **Step 4: See it red.**
  - Delete the Lavi's footprint: the first and third tests fail.
  - Set the Namer's `half_width_tiles` to 1.1: `validate:data` refuses it, and the formation test
    fails.
  - Swap `HULL.ifv_namer` for the Eitan's numbers: the agreement test fails.
  - Add a footprint to `recon_drone`: the air test fails.
  - Delete the `moto_rpg` exemption: the second test fails.
- [ ] **Step 5: Commit** `data: vehicle footprints, measured from the hull GLBs (GH-421, V-R1, V-R3)`.

---

## Task 1b: capsule geometry, pure (hash-neutral)

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** none (pure).

**Files:** Create `packages/sim/src/separation.ts`, `packages/sim/src/separation-geometry.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  /** Writes a hull's capsule into out[o..o+4]: segment ends (x0, y0, x1, y1) and radius. */
  export function hullCapsule(px: Fx, py: Fx, facing: Fx, halfLen: Fx, halfWid: Fx, centreAlong: Fx, out: Int32Array, o: number): void;
  /** Closest points of two segments (Ericson 5.1.9) into out[0..3]: P on the first, Q on the second. */
  export function closestSegmentPoints(cap: Int32Array, a: number, b: number, out: Int32Array): void;
  /** Overlap of capsules at offsets a and b (radius sum minus distance; <= 0 is apart), and the unit
   *  normal from B's closest point toward A's into out[0..1] -- (0, 0) when the points coincide. */
  export function capsuleOverlap(cap: Int32Array, a: number, b: number, out: Int32Array): Fx;
  ```
- `out` needs at least 4 entries. Nothing allocates.
- Distance is `fx.sqrt(fx.mul(dx, dx) + fx.mul(dy, dy))`, never `distSqFx`; Task 2's literals depend on
  that.

- [ ] **Step 1: Write the failing tests.**
  - The literals are derived by hand from `fixed.ts`: `fx.from` rounds to nearest, while `fx.mul` and
    `fx.sqrt` both floor.
  - The Lavi's values: `half_length` 0.87 → 57016, `half_width` 0.48 → 31457, `centre_along`
    −0.18 → −11796. Half its segment is 57016 − 31457 = 25559.

  ```ts
  import { describe, expect, it } from 'vitest';
  import { fx, ONE } from './fixed';
  import { capsuleOverlap, hullCapsule } from './separation';

  const L = 57016, W = 31457, C = -11796; // the Lavi, V-R3
  const cap = (...hulls: [number, number, number][]): Int32Array => {
    const c = new Int32Array(hulls.length * 5);
    hulls.forEach(([x, y, f], k) => hullCapsule(fx.from(x), fx.from(y), f, L, W, C, c, k * 5));
    return c;
  };
  const out = new Int32Array(4);

  describe('capsule geometry (GH-421)', () => {
    it('a hull facing east is a segment along x, centred 0.18 tile behind its origin', () => {
      expect([...cap([10, 10, 0])]).toEqual([618005, 655360, 669123, 655360, 31457]);
    });
    it('a hull facing south (a quarter turn, y-down) is the same segment along y', () => {
      expect([...cap([10, 10, ONE / 4])]).toEqual([655360, 618005, 655360, 669123, 31457]);
    });
    it('side by side 0.9 tile apart: overlap 3933 (0.96 - 0.9, less one unit of floor)', () => {
      expect(capsuleOverlap(cap([10, 10, 0], [10, 10.9, 0]), 0, 5, out)).toBe(3933);
      expect([out[0], out[1]]).toEqual([0, -65537]); // B is south of A: A is pushed north (floored sqrt: 58982 / 58981)
    });
    it('nose to tail 1.5 tiles apart: overlap 15729 -- a circle of the half-width reads apart', () => {
      expect(capsuleOverlap(cap([10, 10, 0], [11.5, 10, 0]), 0, 5, out)).toBe(15729);
      expect(fx.from(1.5)).toBeGreaterThan(2 * W); // the circle's verdict, for contrast
    });
    it('nose to tail with B BEHIND A: the same overlap, the normal along +x (the t > ONE branch)', () => {
      expect(capsuleOverlap(cap([10, 10, 0], [8.5, 10, 0]), 0, 5, out)).toBe(15729);
      expect([out[0], out[1]]).toEqual([65537, 0]);
    });
    it('coincident hulls: overlap is the radius sum and the normal is (0, 0)', () => {
      expect(capsuleOverlap(cap([10.5, 10.5, 0], [10.5, 10.5, 0]), 0, 5, out)).toBe(62914);
      expect([out[0], out[1]]).toEqual([0, 0]);
    });
    it('2.2 tiles nose to tail is apart', () => {
      expect(capsuleOverlap(cap([10, 10, 0], [12.2, 10, 0]), 0, 5, out)).toBeLessThan(0);
    });
  });
  ```

  Run: `pnpm vitest run packages/sim/src/separation-geometry.test.ts`. Expected: FAIL, because the
  module does not exist yet.
- [ ] **Step 2: Implement** `separation.ts`. It is pure and imports only `fx`, `ONE` and `Fx`:

  ```ts
  import { fx, ONE, type Fx } from './fixed';

  export function hullCapsule(px: Fx, py: Fx, facing: Fx, halfLen: Fx, halfWid: Fx, centreAlong: Fx, out: Int32Array, o: number): void {
    const c = fx.cos(facing);
    const s = fx.sin(facing);
    const cx = fx.add(px, fx.mul(c, centreAlong));
    const cy = fx.add(py, fx.mul(s, centreAlong));
    const h = halfLen > halfWid ? fx.sub(halfLen, halfWid) : 0;
    const hx = fx.mul(c, h);
    const hy = fx.mul(s, h);
    out[o] = fx.sub(cx, hx);
    out[o + 1] = fx.sub(cy, hy);
    out[o + 2] = fx.add(cx, hx);
    out[o + 3] = fx.add(cy, hy);
    out[o + 4] = halfWid;
  }

  const clamp01 = (v: Fx): Fx => (v < 0 ? 0 : v > ONE ? ONE : v);

  export function closestSegmentPoints(cap: Int32Array, a: number, b: number, out: Int32Array): void {
    const p0x = cap[a], p0y = cap[a + 1], q0x = cap[b], q0y = cap[b + 1];
    const d1x = cap[a + 2] - p0x, d1y = cap[a + 3] - p0y;
    const d2x = cap[b + 2] - q0x, d2y = cap[b + 3] - q0y;
    const rx = p0x - q0x, ry = p0y - q0y;
    const aa = fx.mul(d1x, d1x) + fx.mul(d1y, d1y);
    const e = fx.mul(d2x, d2x) + fx.mul(d2y, d2y);
    const f = fx.mul(d2x, rx) + fx.mul(d2y, ry);
    let s = 0;
    let t = 0;
    if (aa === 0 && e === 0) {
      // two points
    } else if (aa === 0) {
      t = clamp01(fx.div(f, e));
    } else {
      const c = fx.mul(d1x, rx) + fx.mul(d1y, ry);
      if (e === 0) {
        s = clamp01(fx.div(-c, aa));
      } else {
        const bb = fx.mul(d1x, d2x) + fx.mul(d1y, d2y);
        const den = fx.mul(aa, e) - fx.mul(bb, bb);
        s = den > 0 ? clamp01(fx.div(fx.mul(bb, f) - fx.mul(c, e), den)) : 0;
        t = fx.div(fx.mul(bb, s) + f, e);
        if (t < 0) {
          t = 0;
          s = clamp01(fx.div(-c, aa));
        } else if (t > ONE) {
          t = ONE;
          s = clamp01(fx.div(bb - c, aa));
        }
      }
    }
    out[0] = p0x + fx.mul(d1x, s);
    out[1] = p0y + fx.mul(d1y, s);
    out[2] = q0x + fx.mul(d2x, t);
    out[3] = q0y + fx.mul(d2y, t);
  }

  export function capsuleOverlap(cap: Int32Array, a: number, b: number, out: Int32Array): Fx {
    closestSegmentPoints(cap, a, b, out);
    const dx = out[0] - out[2];
    const dy = out[1] - out[3];
    const d = fx.sqrt(fx.mul(dx, dx) + fx.mul(dy, dy));
    out[0] = d === 0 ? 0 : fx.div(dx, d);
    out[1] = d === 0 ? 0 : fx.div(dy, d);
    return cap[a + 4] + cap[b + 4] - d;
  }
  ```
- [ ] **Step 3: Run** the test: PASS. If a literal disagrees, re-derive it by hand from `fixed.ts`,
  never from the run. If it still disagrees after that, it is a finding, and it is reported.
- [ ] **Step 4: See it red.**
  - Drop the `fx.mul(c, centreAlong)` term: the first two tests fail.
  - Use `halfLen` for the segment half instead of `halfLen − halfWid`: the nose-to-tail literal
    fails.
  - Swap `bb - c` for `bb + c` in the `t > ONE` branch: "B BEHIND A" fails. That case exists for this
    mutation: without it the mutation survives all six other tests, because none of them takes the
    `t > ONE` branch.
  - Swap `-c` for `c` in the `t < 0` branch (`s = clamp01(fx.div(c, aa))`): the first nose-to-tail
    literal (B ahead, 15729) fails, because that case takes the `t < 0` branch.
  - Return `dx` without normalising it: the side-by-side normal fails.
- [ ] **Step 5: Commit** `sim: capsule geometry for vehicle spacing, pure (GH-421, V-R2)`.

---

## Task 2a: the stall column, and the end of a leg extracted (**a column re-pin**)

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Task 1.

**Files:** `packages/sim/src/sim.ts`; `packages/sim/src/determinism.test.ts`; the five versus literal
sites (see File structure).

**Interfaces:**
- Produces `private finishLeg(i: number): void`. Its body is the body of `stepMovement`'s
  `if (arrived && nx === this.goalX[i] && ny === this.goalY[i])` block: shift to the next waypoint, or
  set `moving = 0; fieldRef = -1`.
- Produces `private readonly sepStall: Uint8Array` (sized to capacity), exposed read-only as
  `state.sepStall` and folded by `hashArray` as the LAST line of `hash()`.

- [ ] **Step 1: The refactor, on its own.**
  - Move the arrival block into `finishLeg(i)` and call it from the same place.
  - Run `pnpm test:determinism` and `pnpm test`: every pin and every test is unchanged.
  - Commit `refactor(sim): finishLeg, the end of a leg, out of stepMovement (GH-421; no pin moves)`.
  - *Red:* inside `finishLeg`, skip the waypoint shift: `movement.test.ts`'s "walks a queued path in
    order" fails.
- [ ] **Step 2: The column.** Allocate `sepStall` in the constructor beside `displaced`. Add it to
  `state` beside `focusLost`. Append `h = hashArray(h, this.sepStall);` as the last fold in `hash()`.
  Nothing writes the column yet.
- [ ] **Step 3: Re-pin every `sim.hash()` literal.** Give each a dated comment:

  > 2026-11-xx: vehicle spacing's stall column, `sepStall` (GH-421, V-D10), joins the hash. No
  > behaviour moved: with its `hashArray` line removed this replay reproduces the old value exactly.
  > Was N.

  The sites:
  - flat, relief and orders in `determinism.test.ts`;
  - `versus-force.test.ts` L112;
  - `per-seat-types.test.ts` L167;
  - `match-world.test.ts` L25 and L188 (`PINS`);
  - `versus-breach.test.ts` L22–25;
  - `packages/sim/src/fire-support.test.ts` L79 (`HASH` 2460528690);
  - any literal that pre-flight step 2 found (N2's, F4's or N3's).

  `ECONOMY_PIN` and `_RELIEF` come from `economyHash()`, so they do not move.
  `RUNTIME_DIGEST_PIN` and `_RELIEF` move only if N2's digest folds `sim.hash()`.
- [ ] **Step 4: See it red, and prove it.**
  - Remove the `hashArray` line: every new literal fails, and every old value reads back (quote
    three).
  - Fold `this.displaced` a second time instead: the literals fail, with values other than the old
    ones.
- [ ] **Step 5: Commit** `sim: sepStall joins the hash, no behaviour (GH-421); the sim and versus pins re-pinned, was …`.

---

## Task 2: `stepSeparation` (**a behaviour re-pin**)

**Model:** sonnet (opus for the review). **Agent:** `sim-guard`, with `balance-analyst` for Step 6.
**Depends:** Tasks 1, 1b, 2a.

**Files:** `packages/sim/src/sim.ts`, `packages/sim/src/tuning.ts`, `packages/sim/src/separation.test.ts`
(new), `packages/sim/src/determinism.test.ts`, `tools/src/vehicle_spacing_walk.test.ts` (new), the
versus literal sites.

**Interfaces:**
- Consumes: Task 1's `UnitType.sep*`; Task 1b's three functions; Task 2a's `finishLeg` and `sepStall`.
- Produces, in `tuning.ts` after `ROUT_SPEED_SHIFT`:
  ```ts
  /** Vehicle spacing (GH-421, V-R8): the most a separation push moves a hull in one tick, 0.25 tile.
   *  At least sqrt(2) x the fastest participating step (the jeep, 2.9 tiles/s = 0.145 a tick: its push
   *  plus an equal slide is 0.205), so a mover meeting a parked hull resolves in one tick. */
  export const SEPARATION_MAX_STEP = 16384; // 0.25 tile
  /** V-R7: consecutive ticks a mover may be shoved back before it ghosts through (3 s). */
  export const SEPARATION_STALL_TICKS = 60;
  ```
- Produces, on `Sim`: `debugDisableMobility(id)`, for tests and the sandbox only, beside
  `debugDisableFirepower`. It sets `mobilityKilled = 1; moving = 0; fieldRef = -1`.

- [ ] **Step 1: Write the failing tests** in `packages/sim/src/separation.test.ts`. Sim tests read no
  shipped JSON, so the fixtures are literals:

  ```ts
  import { describe, expect, it } from 'vitest';
  import { fx, ONE } from './fixed';
  import { Sim, type UnitTypeJson } from './sim';
  import { SEPARATION_MAX_STEP, SEPARATION_STALL_TICKS } from './tuning';
  import { capsuleOverlap, hullCapsule } from './separation';

  const hull = (id: string, speed: number, len: number, wid: number, centre = 0): UnitTypeJson => ({
    id,
    role: 'mbt',
    hull: { hp: 3000, armor: { front: 700, side: 300, rear: 150 } },
    mobility: { speed_tiles_s: speed, turn_rate_deg_s: 360, footprint: { half_length_tiles: len, half_width_tiles: wid, centre_along_tiles: centre } },
    sensors: { optics: 1, sight_tiles: 4, signature: 1 },
    weapons: [],
  });
  const LAVI = hull('s_lavi', 1.1, 0.87, 0.48, -0.18);
  const WIDE = hull('s_namer', 1.3, 1.22, 0.69);
  const JEEP = hull('s_jeep', 2.9, 0.8, 0.39);
  /** half_length == half_width: a zero-length segment, i.e. a disc. Its normal runs along the line
   *  between centres, which is what the corner test needs. */
  const PUCK = hull('s_puck', 1, 0.4, 0.4);
  const SQUAD: UnitTypeJson = { id: 's_inf', role: 'infantry', hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } }, mobility: { speed_tiles_s: 0.9 }, sensors: { optics: 1, sight_tiles: 4, signature: 0.6 }, weapons: [] };
  const DRONE: UnitTypeJson = { id: 's_drone', role: 'drone', hull: { hp: 50, armor: { front: 1, side: 1, rear: 1 } }, mobility: { speed_tiles_s: 2.2, domain: 'air' }, sensors: { optics: 1, sight_tiles: 4, signature: 0.3 }, weapons: [] };

  const world = (w = 32, h = 16) => new Sim({ seed: 421, width: w, height: h, capacity: 32 });
  const run = (sim: Sim, n: number, each?: () => void) => { for (let t = 0; t < n; t++) { sim.tick(); each?.(); } };
  /** Capsule overlap of two living units, read through the pure geometry. The oracle is Task 1b's,
   *  pinned there by literals, not stepSeparation's. */
  const overlapOf = (sim: Sim, i: number, j: number): number => {
    const c = new Int32Array(10);
    for (const [k, id] of [[0, i], [1, j]] as const) {
      const t = sim.unitTypes[sim.state.typeIdx[id]];
      hullCapsule(sim.state.posX[id], sim.state.posY[id], sim.state.facing[id], t.sepHalfLen, t.sepHalfWid, t.sepCentre, c, k * 5);
    }
    return capsuleOverlap(c, 0, 5, new Int32Array(4));
  };
  const EAST = 0, WEST = ONE / 2;
  ```

  The tests. Each asserts a literal or a named threshold; 1/64 tile is 1024.
  - **"coincident hulls split by id, the lower to −x"** (V-D4).
    - Setup: two `LAVI` spawned at (10.5, 10.5), facing east.
    - After one tick: `posX` is **671743** and **704512**. Both are stationary, so they split the
      push in half, and each half (31457) is capped to 0.25 tile through
      `fx.div(SEPARATION_MAX_STEP, 31456)`; the numbers are hand-derived.
    - `posY` is **688128** for both, and `facing` is 0 for both (V-D6).
  - **"two hulls sent to one point end apart and still"** (V-D5).
    - Setup: two `LAVI` at (5.5, 8.5) and (5.5, 10.5). Each gets
      `{ kind: 'move', ids: [id], x: fx.from(16.5), y: fx.from(9.5), exact: true }`.
    - After 400 ticks: `overlapOf ≤ 1024`, and both have `moving` 0.
    - Neither position changes over ticks 400–440.
  - **"head-on: each passes on its own right, and the valve never fires"** (V-D9).
    - Setup: `LAVI` A at (4.5, 8.5) facing east, `LAVI` B at (20.5, 8.5) facing west, each given an
      exact move to the other's start.
    - Over 600 ticks, the largest overlap after any tick is ≤ 1024.
    - At the tick where `|posX A − posX B|` is least: `posY[A] > fx.from(8.5)` and
      `posY[B] < fx.from(8.5)`. (The right of east is south on this y-down grid.)
    - The largest `sepStall` seen on either is `< SEPARATION_STALL_TICKS / 2`; print it.
    - Both arrive: `moving` 0, and `posX` within 1024 of the goal.
  - **"the valve: a corridor narrower than two hulls"** (V-D10).
    - Setup: rows 7 and 9 blocked for x 2..29 (`setBlocked`), so row 8 is a one-tile corridor.
      `WIDE` A runs from (3.5, 8.5) east to (28.5, 8.5); `WIDE` B runs from (28.5, 8.5) west to
      (3.5, 8.5); both exact.
    - Both arrive by tick 900.
    - The largest `sepStall` seen **equals `SEPARATION_STALL_TICKS`**. This names the valve firing,
      so a valve that never fires cannot pass.
    - At tick 900 both read 0, because they are clear again.
  - **"an anchor is never pushed, and the column gets past"** (V-R5).
    - Setup: `LAVI` A at (12.5, 8.5), then `debugDisableMobility(A)`. `JEEP` B at (4.5, 8.5),
      exact-moved through A to (24.5, 8.5).
    - A's `posX` and `posY` equal their spawn values on every tick.
    - B arrives by tick 400.
    - The largest overlap after any tick is ≤ `fx.from(0.15)`, one jeep step: the jeep takes the
      whole push plus the slide, under the 0.25 cap.
  - **"a mover meets a parked hull: the mover takes the push"** (V-R5).
    - Setup: `LAVI` A parked at (12.5, 8.5), not disabled; `LAVI` B driven through it as above.
    - A's position changes by at most 1024 over the run, because A is stationary on every tick that
      B moves.
  - **"a demolishing hull is an anchor"** (V-R5).
    - Setup: a `LAVI` copy with `abilities: ['demolish']`, `demolition_method: 'blade'` and
      `demolition_time_s: 4`. Use `addStructureType`/`addStructure` as `determinism.test.ts` does
      (L219) to make a 2x2 shed, and order the copy to `demolish` it.
    - On the first tick the demolisher reads `moving` 0 at the wall (it stands still to cut), spawn
      a second `LAVI` overlapping it, and park it there for the rest of the run.
    - The `structureDestroyed` event arrives on the same tick as in the control run, which has no
      second hull.
    - Mutation: with the anchor clause dropped, the second hull's push sets `displaced`, the cut
      resets, and the shed falls later.
  - **"a push never crosses a blocked tile or a blocked corner"** (V-R10).
    - Setup: tiles (9, 8) and (10, 9) blocked. `PUCK` A at (10.1, 8.9) and `PUCK` B at (10.4, 8.6).
    - The overlap is 0.8 − 0.42 = 0.38 tile; both are stationary, so they split it. A's push points
      toward tile (9, 9), a diagonal change, and both of its orthogonal neighbours are blocked.
    - After one tick, A's position equals `fx.from(10.1)`, `fx.from(8.9)` exactly.
    - Every tick, every participant's tile is open in `blockedVehicle`.
    - The control, with the corner clause dropped, moves A onto (9, 9).
  - **"infantry and aircraft are untouched"** (V-R1). A `SQUAD` and a `DRONE` spawned on a `LAVI`'s
    point: after 20 ticks the squad, the drone and the `LAVI` all stand at their spawn positions.
  - **"a role-less type with no footprint is untouched"** (V-R1). Two copies of
    `determinism.test.ts`'s `TANK` literal (no role, so it derives as wheeled; no footprint) on one
    point: positions are unchanged after 20 ticks.
  - **"a focus chase stops at a held goal, once"** (V-R9).
    - Fixtures, on a 32x16 world:
      - `GUNNER` is `LAVI` with sight 10 and one `apfsds` weapon, range 3, effective range 3.
      - Enemy `LAVI` E (side 1, unarmed) at (14.5, 8.5).
      - `GUNNER` G at (7.5, 8.5).
    - Tick 0: `{ kind: 'attack', ids: [G], target: E }`.
    - Tick 2: `teleport(E, 28.5, 14.5)` takes E out of G's sight. Then spawn a parked friendly
      `LAVI` P on (14.5, 8.5).
    - Once G is in contact with P, `moving[G]` reads 0 on every tick until the focus ends at
      `FOCUS_LOST_TICKS`. Contact should come by tick 95; if it does not, start G one tile east and
      say so.
    - The control, with `goalHeldByVehicle` removed from `stepFocus`, alternates.
  - **"two runs agree"**: the corridor test's world twice, with the same seed, gives identical
    `hash()`.

  Run: `pnpm vitest run packages/sim/src/separation.test.ts`. Expected: FAIL, because there is no
  separation yet.

  Then `tools/src/vehicle_spacing_walk.test.ts`, on real content:
  - **"the versus KDF spawn separates within 10 ticks"**.
    - Build the world with `buildWorld('beit_sahwan_outskirts')` and `versusSpawns`, as
      `versus-force.test.ts` does.
    - At tick 0, assert that the Lavi/D9 and Lavi/jeep pairs overlap by more than 1024, so the setup
      is the one predicted.
    - After 10 ticks, no pair of units with footprints overlaps by more than 1024, and every one
      stands on a tile open in `blockedVehicle` (or in `blocked`, for the D9).
  - **"a real group move leaves no pair overlapping"**.
    - Build `tel_marum_2_foothold` through `walk_world`'s `makeWorld`, and remove the enemies
      (`debugKill`).
    - Give every unit with a footprint one `move` to (24, 30).
    - After 90 s, no pair overlaps by more than 1024. Print the largest `sepStall`.
- [ ] **Step 2: Implement.**
  - In `tick()`, add `this.stepSeparation();` between `this.stepMovement();` and
    `this.stepTransport();`.
  - Allocate the scratch arrays once, in the constructor; none of them is hashed:
    - `sepIds: Int32Array(n)`, `sepCap: Int32Array(n * 5)`;
    - `sepPushX`, `sepPushY: Int32Array(n)`;
    - `sepContact`, `sepArrive: Uint8Array(n)`;
    - `sepOut: Int32Array(4)`, `sepGoalCap: Int32Array(15)`.
  - The system:

  ```ts
  /** Vehicle spacing (GH-421, V-D1..V-D10). Jacobi: every capsule is read from the positions
   *  stepMovement left, every push is summed (integer adds: no visiting order can change a sum),
   *  then each vehicle applies its own sum, capped and clipped. No rng. */
  private stepSeparation(): void {
    const ids = this.sepIds;
    const cap = this.sepCap;
    const out = this.sepOut;
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 0) continue;
      const t = this.unitTypes[this.typeIdx[i]];
      if (t.sepHalfWid === 0 || t.isAir) continue;
      if (this.carriedBy[i] >= 0 || this.garrisonedIn[i] >= 0 || this.tunnelIn[i] >= 0) continue;
      ids[n] = i;
      hullCapsule(this.posX[i], this.posY[i], this.facing[i], t.sepHalfLen, t.sepHalfWid, t.sepCentre, cap, n * 5);
      this.sepPushX[n] = 0;
      this.sepPushY[n] = 0;
      this.sepContact[n] = 0;
      this.sepArrive[n] = 0;
      n++;
    }
    for (let a = 0; a < n; a++) {
      const i = ids[a];
      const bi = this.unitTypes[this.typeIdx[i]].sepBound;
      for (let b = a + 1; b < n; b++) {
        const j = ids[b];
        const r = fx.add(bi, this.unitTypes[this.typeIdx[j]].sepBound);
        if (distSqFx(fx.sub(this.posX[i], this.posX[j]), fx.sub(this.posY[i], this.posY[j])) > fx.mul(r, r)) continue;
        const ov = capsuleOverlap(cap, a * 5, b * 5, out);
        if (ov <= 0) continue;
        this.sepContact[a] = 1;
        this.sepContact[b] = 1;
        if (this.sepStall[i] >= SEPARATION_STALL_TICKS || this.sepStall[j] >= SEPARATION_STALL_TICKS) continue;
        let nx = out[0];
        let ny = out[1];
        if (nx === 0 && ny === 0) nx = -ONE; // coincident: the lower id (a) goes -x
        const ai = this.isSepAnchor(i);
        const aj = this.isSepAnchor(j);
        if (ai && aj) continue;
        const mi = this.displaced[i] === 1;
        const mj = this.displaced[j] === 1;
        let wi: Fx;
        let wj: Fx;
        if (ai) { wi = 0; wj = ov; }
        else if (aj) { wi = ov; wj = 0; }
        else if (mi && !mj) { wi = ov; wj = 0; }
        else if (mj && !mi) { wi = 0; wj = ov; }
        else { wi = ov >> 1; wj = ov - (ov >> 1); }
        this.sepPushX[a] += fx.mul(nx, wi);
        this.sepPushY[a] += fx.mul(ny, wi);
        this.sepPushX[b] -= fx.mul(nx, wj);
        this.sepPushY[b] -= fx.mul(ny, wj);
      }
    }
    // V-D5, read before anything moves or stops, so no arrival depends on another's.
    for (let a = 0; a < n; a++) {
      const i = ids[a];
      if (this.moving[i] === 1 && this.sepContact[a] === 1 && this.goalHeldByVehicle(i, this.goalX[i], this.goalY[i])) this.sepArrive[a] = 1;
    }
    for (let a = 0; a < n; a++) {
      const i = ids[a];
      let px = this.sepPushX[a];
      let py = this.sepPushY[a];
      let opposed = false;
      if (px !== 0 || py !== 0) {
        const c = fx.cos(this.facing[i]);
        const s = fx.sin(this.facing[i]);
        if (this.displaced[i] === 1 && fx.mul(px, c) + fx.mul(py, s) < 0) {
          // V-D9: shoved back while driving -- slide to its own right, (-sin, cos) on this y-down grid.
          opposed = true;
          const m = fx.sqrt(fx.mul(px, px) + fx.mul(py, py));
          px = px - fx.mul(s, m);
          py = py + fx.mul(c, m);
        }
        const m2 = fx.sqrt(fx.mul(px, px) + fx.mul(py, py));
        if (m2 > SEPARATION_MAX_STEP) {
          const k = fx.div(SEPARATION_MAX_STEP, m2);
          px = fx.mul(px, k);
          py = fx.mul(py, k);
        }
        this.applySeparationPush(i, px, py);
      }
      // V-D10, the valve.
      const st = this.sepStall[i];
      if (st >= SEPARATION_STALL_TICKS) {
        if (this.sepContact[a] === 0) this.sepStall[i] = 0;
      } else {
        this.sepStall[i] = opposed ? st + 1 : 0;
      }
    }
    for (let a = 0; a < n; a++) if (this.sepArrive[a] === 1) this.finishLeg(ids[a]);
  }

  /** V-R5: takes no share of a push. */
  private isSepAnchor(i: number): boolean {
    return this.mobilityKilled[i] === 1 || this.demoTicks[i] > 0;
  }

  /** V-R10: stepMovement's slide on the unit's own mask, plus FlowField's corner rule. */
  private applySeparationPush(i: number, px: Fx, py: Fx): void {
    const w = this.width;
    const clip = this.unitTypes[this.typeIdx[i]].moveDomain === DOMAIN_VEHICLE ? this.blockedVehicleMask : this.blocked;
    const ox = this.posX[i];
    const oy = this.posY[i];
    let nx = this.clampX(fx.add(ox, px));
    let ny = this.clampY(fx.add(oy, py));
    const tx = ox >> 16;
    const ty = oy >> 16;
    const ntx = nx >> 16;
    const nty = ny >> 16;
    const destOpen = clip[nty * w + ntx] === 0;
    const cornerOk = ntx === tx || nty === ty || (clip[ty * w + ntx] === 0 && clip[nty * w + tx] === 0);
    if (!destOpen || !cornerOk) {
      if (clip[ty * w + ntx] === 0) ny = oy;
      else if (clip[nty * w + tx] === 0) nx = ox;
      else {
        nx = ox;
        ny = oy;
      }
    }
    if (nx !== ox || ny !== oy) {
      this.posX[i] = nx;
      this.posY[i] = ny;
      this.displaced[i] = 1;
    }
  }

  /** V-D5 / V-R9: is `i` touching a stationary (or anchored) vehicle whose capsule also covers `i`'s
   *  capsule placed at (gx, gy)? False for any unit that does not separate. */
  private goalHeldByVehicle(i: number, gx: Fx, gy: Fx): boolean {
    const ti = this.unitTypes[this.typeIdx[i]];
    if (ti.sepHalfWid === 0 || ti.isAir) return false;
    const c = this.sepGoalCap;
    hullCapsule(this.posX[i], this.posY[i], this.facing[i], ti.sepHalfLen, ti.sepHalfWid, ti.sepCentre, c, 0);
    hullCapsule(gx, gy, this.facing[i], ti.sepHalfLen, ti.sepHalfWid, ti.sepCentre, c, 5);
    for (let j = 0; j < this.count; j++) {
      if (j === i || this.alive[j] === 0) continue;
      const tj = this.unitTypes[this.typeIdx[j]];
      if (tj.sepHalfWid === 0 || tj.isAir) continue;
      if (this.carriedBy[j] >= 0 || this.garrisonedIn[j] >= 0 || this.tunnelIn[j] >= 0) continue;
      if (this.moving[j] === 1 && !this.isSepAnchor(j)) continue;
      hullCapsule(this.posX[j], this.posY[j], this.facing[j], tj.sepHalfLen, tj.sepHalfWid, tj.sepCentre, c, 10);
      if (capsuleOverlap(c, 0, 10, this.sepOut) > 0 && capsuleOverlap(c, 5, 10, this.sepOut) > 0) return true;
    }
    return false;
  }
  ```
  - In `stepFocus`, the wait for "already standing on the goal tile" becomes
    `if ((this.posX[i] >> 16 === gtx && this.posY[i] >> 16 === gty) || this.goalHeldByVehicle(i, gx, gy)) {`.
    Foot chasers are untouched, because the helper returns false for them.
  - Add `debugDisableMobility(id)` beside `debugDisableFirepower`.
- [ ] **Step 3: Determinism.**
  - Run `pnpm test:determinism` twice; the result is the same both times.
  - The flat, relief and orders replays and both economy replays read back **Task 2a's values
    unchanged**, because no fixture declares a footprint.
  - A move there is a defect, and finding it comes before anything else.
- [ ] **Step 4: Birth the separation replay, and re-pin the versus literals.**
  - **Add `separationReplay(seed)` to `determinism.test.ts`**, after every existing block (F2's and
    F4's included).
    - Build it the way pre-flight step 2 found N2's builders are built.
    - World: 48x32. Copy in Task 2's `LAVI`, `WIDE` and `JEEP` literals (sim tests read no shipped
      JSON).
    - Contents:
      - six `LAVI` given one group `move` across the map at tick 5;
      - a head-on `LAVI` pair on row 20;
      - a `WIDE` pair in a one-tile corridor on row 28 (rows 27 and 29 blocked, x 4..44);
      - a `LAVI` at (24.5, 4.5), disabled with `debugDisableMobility`, with a `JEEP` driven through
        it.
    - Run 900 ticks.
    - Two `it`s:
      - two runs agree;
      - `SEPARATION_PIN`, set to the value the first green run prints, with the comment:

        > born 2026-11-xx (GH-421): separation over a group, a head-on pair, a corridor pair and an
        > anchor. Guards: the run asserts the valve fired on the corridor pair and that no pair
        > overlaps by more than 1/64 tile at tick 900.

      Both of those asserts are in the replay's own `it`, so the pin guards something.
  - **Re-pin the versus literals** (the five sites of Task 2a), each with the comment:

    > 2026-11-xx: vehicle spacing (GH-421, lead 6 Oct). Behaviour moved: the KDF force spawns a Lavi
    > one tile from the D9 and one from the jeep, in contact (on beit_sahwan_outskirts about 1.17 and
    > 0.49 tile; on tel_marum, side by side, about 0.22 and none), and they separate in ticks 1–5. With
    > `stepSeparation` returning at once this reproduces Task 2a's value. Was N.
- [ ] **Step 5: See it red.**
  - Return early from `stepSeparation`: the head-on, group, versus-spawn and coincident tests fail.
  - Drop the slide: the head-on test fails. The vehicles stall and then ghost, and the valve assert
    names it.
  - Drop the valve (change `opposed ? st + 1 : 0` to `0`): the corridor test times out at tick 900.
  - Push an anchor (drop `if (ai) …`): the anchor test fails.
  - Drop the corner clause: the corner test fails.
  - Split evenly between a mover and a stationary vehicle: "the mover takes the push" fails.
  - Remove `goalHeldByVehicle` from `stepFocus`: the focus test alternates.
  - Drop V-D5's arrival pass: "end apart and still" fails on its last-40-ticks check.
  - Change `ov >> 1` to `ov`: the coincident literal fails.
  - Give the determinism `TANK` a footprint: no golden pin moves, because no replay brings two tanks
    together. This mutation is expected to SURVIVE. Disclose it in the commit as the reason
    `separationReplay` exists (V-R11). If a pin does move, that is a finding: some replay brings
    vehicles into contact after all.
- [ ] **Step 6: Re-measure, with one commit per moved line.**
  - **`pnpm balance`:** quote the §5.7 lines before and after. All must pass (V-R16).
  - **`pnpm playtest`:** every outcome class holds on 30/30 seeds.
    - A plan that loses a seed gets a follow-up order in its own commit, as #542 did. No mission
      edit.
    - If `LADDER_CREDITS` moves, re-pin it together with `CAMPAIGN_CREDITS`
      (`campaign_credits.test.ts` holds them equal), quoting the per-mission credits that moved. The
      same goes for `ROSTER_MAX`, `GATES`, `BANKING_OVER_30_WINNERS` and `ZONE_PASSIVE_INCOME`.
    - Print, per run, how many times any vehicle reached `SEPARATION_STALL_TICKS`. This is a report
      line, not a gate. A valve that fires often in shipped missions is a finding for the lead.
  - Where `playtest` lets you, name the cause of each move:
    - breach choices by vehicles that are not human-held, stopped at contact
      (`selectBreachTarget`'s stationary branch);
    - F1 rise holds;
    - F2 zone holders.
  - **`pnpm versus:probe`** (report-only): quote before and after. Nothing gates on it.
  - **`tools/src/formation_walk.test.ts`** stays green without edits.
  - **In the PR, say three things:**
    - which golden scenarios are expected to move (Global Constraints);
    - that the bless follows merge, from CI numbers;
    - that CI's `net:engines` is the cross-engine check: Chromium, Firefox and WebKit run the
      sandbox to tick 600, and the spawn overlap makes separation run there.

---

## Task 3: the cost

**Model:** haiku. **Depends:** Task 2.

- [ ] Add `'stepSeparation'`, `'stepFocus'` and `'stepBrace'` to `sim-scaling.ts`'s phase list
  (L96–110). The last two were already missing.
  - *Red:* misspell `'stepSeparation'`. Its row reads 0.000, and the harness's unattributed remainder
    grows by the same amount; quote both.
- [ ] Run `npx tsx tools/src/perf/sim-scaling.ts --checkpoints=150,300,600` twice: once on the branch
  base and once after Task 2, on the same machine under the same load.
  - Record tick p50/p95, `stepSeparation`'s share, the conditions, and the number of units with
    footprints alive at each checkpoint.
  - The harness's roster is the sandbox's. If it fields fewer than ten vehicles at 300, say so: the
    reading is then a floor.
  - Expected: under 2% of the tick at 300 (R).
- [ ] If it is not under 2%, stop and report. The remedy (a bucket per tile) is a design change, not a
  tweak.
- [ ] In `docs/PERFORMANCE.md`, add a "Vehicle spacing" paragraph under "Sim tick cost" with both
  readings.

---

## Task 4: the ledger

**Model:** haiku.

- [ ] `docs/HANDOVER.md` §1 and §4: GH-421 landed, the new pins, and any ladder move.
- [ ] `docs/polish/commercial-polish-audit.md`: PA-10 to DONE, with the after-captures.
- [ ] `docs/superpowers/plans/2026-10-04-stage4-order.md` (~L263):
  - the row's `mobility.radius_tiles` becomes `mobility.footprint`;
  - "sim pins, once" becomes "a column re-pin, then the versus pins for behaviour; golden replays
    unmoved".
- [ ] `CLAUDE.md`:
  - correct the stale map-format line "tel_marum is the first (and so far only) map to author any"
    boulders: `b` is on 23 of 35 maps and `d` on 6 (re-count at the time);
  - under "Known scaling debts", one line: "vehicles separate as capsules, V-D1–V-D10;
    `stepSeparation` is a V² broad phase; infantry still stack by design";
  - under "Adding content: A unit", the `mobility.footprint` rule: the footprint is the vehicle
    GLB's hull half-extents, measured by `unit-footprints.ts`, and
    `tools/src/vehicle_footprint.test.ts` fails without one.

---

## Re-pins

| pin | value at `6a3408a1` | expected | task | reason |
|---|---|---|---|---|
| `shippedContentDigest()` | computed, no literal | **moves** | 1 | The unit JSON gains `footprint`. Two clients on different builds desync on the first hash tick, as designed |
| sim pins, flat / relief / orders | 935671699 / 2842924511 / 3272041047 (re-read) | **column re-pin** in 2a; **read back unchanged** in 2 | 2a | `sepStall` joins the hash. No fixture declares a footprint (V-R11) |
| `fire-support.test.ts` `HASH` (L79) | 2460528690 (re-read) | **column re-pin** in 2a; read back unchanged in 2 (no footprint in its fixtures) | 2a | `sepStall` joins the hash |
| `ECONOMY_PIN` / `_RELIEF` | 3794140228 / 2682592505 on `main`; F2 sets 275731552 / 145368021; F4 Task 6 moves them (re-read) | **unmoved** (R) | — | `economyHash()` does not fold `sim.hash()`, and no `ECO_*` type has a footprint |
| `RUNTIME_DIGEST_PIN` / `_RELIEF` | born in N2 Task 6, moved in F4 Task 6 (re-read) | **unmoved** (R); if the digest folds `sim.hash()`, moved in 2a | 2a? | as above |
| `SEPARATION_PIN` | — | **born** | 2 | separation over a group, a head-on pair, a corridor pair and an anchor |
| versus pins (re-read after N2 Task 2): `versus-force.test.ts` 580559085 / 1260439781; `per-seat-types.test.ts` 580559085; `match-world.test.ts` 3043363756 / 1260439781; `versus-breach.test.ts` `pinWindow` | as listed | **column re-pin** in 2a, **behaviour re-pin** in 2 | 2a, 2 | First the column. Then the KDF force's spawn overlap (Lavi/D9, Lavi/jeep) separates |
| `two-client.test.ts` | equality, `matchDigest(sim, 0, content)` | **holds** | 2 | Both clients run the same integer code |
| CI `net:engines` (`two-engine.ts`, sandbox, tick 600) | engines agree | **holds**, CI only | 2 | The first cross-engine reading of separation |
| `pnpm balance` | — | **re-measured**; every §5.7 target passes | 2 | Vehicles in contact are pushed apart |
| `pnpm playtest` | 30 seeds | **re-measured**; outcome classes hold on 30/30 | 2 | As above, plus the named causes |
| `LADDER_CREDITS` / `CAMPAIGN_CREDITS` (5940) / `ROSTER_MAX` (29) / `GATES` / `BANKING_OVER_30_WINNERS` (15) / `ZONE_PASSIVE_INCOME` (0) | re-read | only if moved, one commit each | 2 | as above |
| `formation_walk.test.ts` | green | **unchanged** | 2 | Sideways slots are not contested |
| golden baseline | — | **expected to move** (`vehicle`, `kitted`, maybe `quiet`) | after merge | The sandbox spawn overlap separates before the capture tick; bless from CI |
| `memory` CI job | — | unchanged (R) | — | No asset, no texture |

## For the lead

*Kept as the record; every item is now ruled.*

1. **Where it lands.** **RULED 11 Oct (lead): (a), Tue 24 – Wed 25 Nov, slipping to Stage 5 if the
   economy runs over.** *(15 Oct: it probably needs three days now, not two; see changelog item 6.
   The order is F2 → N2 → F4 → spacing.)*
2. **Confirm V-D1–V-D8.** *Ruled 15 Oct (coordinator, lead-delegated window): V-D1, V-D2 and V-D4 are
   rewritten (V-R1, V-R2, V-R5, V-R8), V-D3 is restated, and V-D9 and V-D10 are added; the rest
   stand as written.*
3. **Circle or capsule (V-D2).** *Ruled 15 Oct: a capsule (V-R2), on the measured nose-to-tail
   overlap.*
4. **If a §5.7 target fails.** *Ruled 15 Oct: as recommended (V-R16).*
5. **New, for taste:** wrecks as obstacles, and the formation rank depth. See "Questions for the
   lead" above.
