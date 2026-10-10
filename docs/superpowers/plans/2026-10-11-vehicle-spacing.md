# Vehicle spacing: vehicles in a group stop driving through each other (GH-421, PA-10). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two ground vehicles never stand inside each other, and a group of vehicles does not drive
through itself. Movement stays on flow fields (no per-unit A*).

**Why (lead, 6 Oct; GH-421).** The polish audit's PA-10: Lavi, Namer and Eitan meshes clip through
each other in a fight (`docs/polish/before/play-33-vehicles-interpenetrate.jpg`,
`play-36-vehicle-kill-2s.jpg`). The audit rates it "the most visible prototype tell in combat", P1.
The sim has no unit-to-unit collision at all: `stepMovement` clips each unit against the blocked mask
and nothing else. Group formations (`formation.ts`, 2026-09-15) give vehicles distinct destination
slots `VEHICLE_SPACING` (2) tiles apart, but the units share one flow field on the way, and the
closing rule (`stepSweep`) sends every closer to its target's own position. They meet on the route
and at the end.

**Architecture:**
- **One new system, `stepSeparation`, right after `stepMovement` in `tick()`.** For every pair of
  living ground vehicles closer than the sum of their radii, both are pushed apart along the line
  between their centres, half the overlap each, capped per tick. A push is clipped against the vehicle
  mask with `stepMovement`'s own axis slide. Pairs are visited in id order, once per tick.
- **One new authored number per vehicle: `mobility.radius_tiles`.** Data, not engine: a new vehicle
  adds a JSON line. It is pinned to the measured hull width the selection ring is generated from, and
  bounded so separation can never contest a formation slot.
- **No new hashed column.** Positions are already hashed. The sim pins move **because behaviour
  moved**: this is a behaviour re-pin, like #402's, not a column re-pin like Hold's.
- **`pnpm balance` and `pnpm playtest` are re-measured, not expected byte-identical.** Their lines move
  in their own commits, each with its reason.
- **No UI half.** The renderer already interpolates whatever positions the sim writes.

**Tech stack:** TypeScript strict, vitest. No new dependencies.

**Refs:**
- GH-421; `docs/polish/commercial-polish-audit.md` PA-10.
- `docs/superpowers/specs/2026-09-15-group-formation-design.md` and `packages/sim/src/formation.ts`
  (`VEHICLE_SPACING`, `MAX_LATERAL`).
- `packages/render/src/three/units/readability.ts` `ELLIPSE_BY_TYPE` (generated) and
  `tools/src/perf/unit-footprints.ts` (the measured hull half-extents it is generated from).
- `docs/PERFORMANCE.md`, "Sim tick cost" (`tools/src/perf/sim-scaling.ts`).
- `docs/superpowers/plans/2026-10-04-stage4-order.md`: where this lands.

**Base:**
- Written 11 Oct against `main` `f2d5d9e8`.
- Branch `feat/vehicle-spacing`, cut from `main` at its slot in the Stage 4 order (For the lead,
  item 1).
- Worktree under `/Users/ilpinto/dev/roaring-lions-ep/`; run `pnpm install` once.
- Locate code by symbol; line numbers drift (`stepMovement` ~L5288, `tick()` ~L1846 in `sim.ts` at
  `f2d5d9e8`).
- Nothing here is measured. Every (R) is reasoned, and its task says how to measure it.

---

## Decisions

Taken defaults, for the lead to confirm (For the lead, item 2):

- **V-D1. Ground vehicles only.** A unit takes part when its move domain is `DOMAIN_VEHICLE` and it is
  not air (`UnitType.wheeled && !isAir`, the same derivation `stepMovement` clips with). Infantry,
  civilians and aircraft are neither pushed nor push. Infantry stacking is a formation concern, out of
  scope here. **#247 lands first** (3 Nov): it makes `manpad_team` foot, so it is not swept in as a
  vehicle by this rule.
- **V-D2. A circle per vehicle, radius `mobility.radius_tiles`.** The radius is the measured hull
  half-width (across), not the half-length. Two consequences, both deliberate: side-by-side and
  head-on contact is resolved exactly, and nose-to-tail can still overlap by up to
  `half-length − half-width` (about 0.4 tile on a Lavi, R). A capsule (a segment along the hull with
  that radius) closes the nose-to-tail case at roughly twice the arithmetic; it is For the lead,
  item 3.
- **V-D3. The radius cannot contest a formation slot.** Every vehicle's `2 × radius_tiles ≤
  VEHICLE_SPACING` (2). A test holds it, so two vehicles parked in neighbouring slots never push each
  other.
- **V-D4. The push.** For a pair at distance `d < rA + rB`: each moves `(rA + rB − d) / 2` along the
  centre line, capped at `SEPARATION_MAX_STEP` per tick (tuning.ts, proposed 0.1 tile = 2 tiles/s, R).
  A partner that cannot move (`mobilityKilled`) takes nothing and the other takes the whole push.
  Coincident centres (`d = 0`) split along the x axis, the lower id to −x. No `rng`.
- **V-D5. A goal held by another vehicle is reached at contact.** On the final leg, a mover whose goal
  lies within `rA + rB` of a stationary vehicle counts as arrived (`moving = 0`, or its next waypoint),
  so two vehicles sent to one point stop touching rather than shoving forever.
- **V-D6. A push never turns a hull.** `facing` is untouched; only `posX`/`posY` move. A pushed vehicle
  sets `displaced = 1` (it did move this tick), which is honest for every reader of that flag.
- **V-D7. Both sides, all vehicles.** Separation is physical, not tactical: a KDF tank and a Sarim
  technical push each other as two KDF tanks do. A closing vehicle stops at contact with its target
  (V-D5) if the `engaging` latch has not already stopped it at effective range.
- **V-D8. Cost.** One scratch list of vehicle ids per tick (preallocated `Int32Array`, no per-tick
  allocation), then `V(V − 1) / 2` distance checks. At V = 60 that is 1,770 integer distance checks
  a tick, small next to detection's O(N²) (R; Task 3 measures it).

---

## Global Constraints

- **The four invariants hold.** Fixed-point only (`fx.sqrt`, `fx.mul`, `fx.div`); no `Math.*`; no
  `rng`; deterministic visiting order (ids ascending). `radius_tiles` becomes Q16.16 at load
  (`addUnitType`), never read as a float in the sim.
- **The sim pins move once**, in Task 2, with the reason "vehicles no longer overlap (GH-421)". At
  `f2d5d9e8` they read flat `922714084` and relief `3200430224`; #291, Hold and targeted fire move them
  first. A golden replay with no vehicle in contact would not move (R): Task 2 says which replay moved
  and why.
- **`pnpm balance`** must still pass every §5.7 target; its printed win rates are quoted before and
  after. A target that fails stops the plan and goes to `balance-analyst` (For the lead, item 4).
- **`pnpm playtest`**: every plan keeps its outcome class; `LADDER_CREDITS` (5870), `CAMPAIGN_CREDITS`
  (5870), `ROSTER_MAX` (31) and `GATES` re-pin **only if they move**, each in its own commit with the
  per-mission line that moved.
- **The golden baseline is expected to move** (R): the sandbox force spawns vehicles one per tile
  (`Placements spread across tiles`), closer than two radii, so `vehicle`, `kitted` and possibly
  `quiet`/`open-ground` move as they separate before their capture tick. Bless from CI numbers after
  merge (`visual-baseline-bless` opens a review PR); never from the branch.
- **Every check is seen red** by a one-line mutation, quoted in the commit.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test:determinism && pnpm test`,
  `pnpm validate:data`, then `pnpm balance` and `pnpm playtest`.
- **Never run `pnpm ui:routes`, `golden-baseline` or `ui:shots` locally**; CI runs them. Browsers start
  with music off; never port 5177; never `pkill`.
- **Git:** `/usr/bin/git commit -s -F <msg> -- <paths>`. Never `-A`, never `git checkout -- <file>`.
  Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The lead merges.

---

## File structure

| File | Role | Task |
|---|---|---|
| `data/schemas/unit.schema.json` | `mobility.radius_tiles` (number, 0.3–1.0) | 1 |
| `data/units/**/*.json` (every ground vehicle) | the authored radius | 1 |
| `packages/sim/src/sim.ts` | `UnitTypeJson.mobility.radius_tiles`; `UnitType.radius` (Fx); `stepSeparation`; V-D5 in `stepMovement`'s arrival | 1, 2 |
| `packages/sim/src/tuning.ts` | `SEPARATION_MAX_STEP` | 2 |
| `packages/sim/src/separation.test.ts` | **New.** The sim tests | 2 |
| `packages/sim/src/determinism.test.ts` | The re-pin | 2 |
| `tools/src/vehicle_radius.test.ts` | **New.** Every vehicle has a radius, it agrees with the measured hull, and it respects V-D3 | 1 |
| `tools/src/backtest/playtest.ts`, `packages/app/src/ui/stores-model.ts` | Only if a line moves | 2 |
| `docs/PERFORMANCE.md` | The tick-cost reading | 3 |
| `docs/HANDOVER.md`, `CLAUDE.md`, `docs/polish/commercial-polish-audit.md` | Ledger; PA-10 to DONE | 4 |

---

## Task 1: the radius, as data (hash-neutral)

**Model:** haiku for the JSON, sonnet for the test. **Agent:** `sim-guard` (schema and `addUnitType`).

- [ ] **Step 1: Write the failing test** `tools/src/vehicle_radius.test.ts`:
  - **"every ground vehicle declares mobility.radius_tiles"**: reads `data/units/**`, derives "ground
    vehicle" the sim's way (authored `wheeled`, else `!FOOT_ROLES.has(role)`, and not air), and requires
    the field. A foot or air unit that declares it fails too.
  - **"the radius agrees with the measured hull"**: within ±0.1 tile of the hull half-extent across
    that `tools/src/perf/unit-footprints.ts` measures (read its committed output or the
    `ELLIPSE_BY_TYPE` source numbers before their pad; take the literals into the test, never import
    them from the code under test). Every type in `ELLIPSE_BY_TYPE` has a radius, and every radius has
    an ellipse entry.
  - **"no radius contests a formation slot"** (V-D3): `2 × radius_tiles ≤ VEHICLE_SPACING`, read from
    `formation.ts`.
- [ ] **Step 2: Implement.** Add the schema field; author the radius on every ground vehicle (KDF and
  Sarim, `rocket_battery` included); read it in `addUnitType` into `UnitType.radius` (Fx). Nothing
  reads it yet.
- [ ] **Step 3: Gates.** `validate:data`; both sim pins unchanged (no behaviour); `balance` and
  `playtest` byte-identical.
- [ ] **Step 4: See it red.** Delete one vehicle's radius: the first test fails. Set the Namer's to
  1.2: the formation test fails. Point the hull literal at the wrong type: the agreement test fails.

---

## Task 2: `stepSeparation` (**a behaviour re-pin**)

**Model:** sonnet. **Agent:** `sim-guard`, with `balance-analyst` for Step 6. **Depends:** Task 1.

- [ ] **Step 1: Write the failing tests** in `separation.test.ts` (vehicle fixtures with an authored
  `radius_tiles`; one infantry fixture with `role: 'infantry'`):
  - **"two vehicles sent to one point end apart and still"** (V-D4, V-D5): `exact` orders to the same
    tile. After 200 ticks, `d ≥ rA + rB − 1/64 tile`, and neither position changes over the last 40
    ticks (no shoving loop).
  - **"two vehicles driving head-on pass without overlapping"**: open ground, opposite goals on one
    line. The minimum `d` over the run is `≥ rA + rB − SEPARATION_MAX_STEP`.
  - **"a six-vehicle group order leaves no pair overlapping"**: one group `move`; after arrival every
    pair is apart. The same order with separation disabled is the control and overlaps en route.
  - **"a pushed vehicle never enters a blocked tile"**: a vehicle against a wall is pushed toward it;
    its tile stays open in `blockedVehicleMask`.
  - **"an immobile vehicle is not pushed"** (V-D4): a `mobilityKilled` hull stays put; its partner moves
    the whole overlap.
  - **"coincident vehicles split by id"** (V-D4): spawned on one point, after one tick the lower id has
    the smaller x.
  - **"infantry and aircraft are untouched"** (V-D1): a squad and a drone standing inside a vehicle's
    radius are not moved by it, and do not move it.
  - **"a push does not turn the hull"** (V-D6).
  - **"two runs agree"**: same seed, same hash.
- [ ] **Step 2: Implement.** `stepSeparation` after `stepMovement` in `tick()`; the vehicle-id scratch
  list (V-D8); the push with `stepMovement`'s axis slide against `blockedVehicleMask`; V-D5 in
  `stepMovement`'s final-leg arrival (one check against the vehicles list); `SEPARATION_MAX_STEP` in
  `tuning.ts` with its source.
- [ ] **Step 3: Determinism.** `pnpm test:determinism` twice, same result.
- [ ] **Step 4: Re-pin both sim pins** in this commit, each with a dated comment: "Vehicle spacing
  (GH-421, lead 6 Oct): ground vehicles no longer overlap. Behaviour moved: <which replay, which
  vehicles were in contact>. Was N."
- [ ] **Step 5: See it red.** Return early from `stepSeparation`: the head-on and group tests fail.
  Drop the axis slide: the wall test fails. Drop V-D5: "end apart and still" fails on its last-40-ticks
  check. Push both members of an immobile pair: the immobile test fails.
- [ ] **Step 6: Re-measure, one commit per moved line.**
  - `pnpm balance`: quote the §5.7 lines before and after. All must pass.
  - `pnpm playtest`: every outcome class holds. If `LADDER_CREDITS` moves, re-pin it with
    `CAMPAIGN_CREDITS` (`campaign_credits.test.ts` holds them equal), quoting the per-mission credits
    that moved. Same for `ROSTER_MAX` and `GATES`.
  - Say in the PR which golden scenarios are expected to move (Global Constraints) and that the bless
    follows merge, from CI numbers.

---

## Task 3: the cost

**Model:** haiku. **Depends:** Task 2.

- [ ] Run `npx tsx tools/src/perf/sim-scaling.ts` (see `docs/PERFORMANCE.md`, "Sim tick cost") at
  300 and 600 living units, before and after, on the same machine. Record tick p50/p95 and the share
  `stepSeparation` takes, with the conditions. Expected: under 2% of the tick at 300 (R).
- [ ] If it is not, stop and report; the remedy (a grid bucket by tile) is a design change, not a tweak.

---

## Task 4: the ledger

**Model:** haiku.

- [ ] `docs/HANDOVER.md` §1 and §4: GH-421 landed, the new pins, any ladder move.
- [ ] `docs/polish/commercial-polish-audit.md`: PA-10 to DONE.
- [ ] `CLAUDE.md`: one line under the flow-field debt bullet ("vehicles separate by radius, V-D1–V-D8;
  infantry still stack by design") and the `mobility.radius_tiles` rule under "Adding content: A unit".

---

## Re-pins

| pin | expected | reason |
|---|---|---|
| sim pins, flat and relief | **moved once**, Task 2 | behaviour: vehicles no longer overlap |
| `pnpm balance` | **re-measured**; every §5.7 target passes | vehicles in contact are pushed apart |
| `pnpm playtest` | **re-measured**; outcome classes hold | as above |
| `LADDER_CREDITS` / `CAMPAIGN_CREDITS` (5870) / `ROSTER_MAX` (31) / `GATES` | only if moved, one commit each | as above |
| golden baseline | **expected to move** (`vehicle`, `kitted`, maybe `quiet`/`open-ground`) | the parked sandbox vehicles separate before the capture tick; bless after merge from CI |
| `memory` CI job | unchanged (R) | no asset, no texture |

## For the lead

1. **Where it lands.** Lane C's calendar had no day for it. Two orders, both legal under "one pin, one
   reason":
   - **(a, recommended)** after F4, in the buffer week (Tue 24 – Wed 25 Nov). The economy lands on its
     planned days, and if F2 or F4 overruns, spacing is the item that slips to Stage 5 without touching
     M2's exit. Cost: F2's and F4's playtest lines are re-measured once more, here, with this reason.
   - **(b)** before F1 (Fri 6 – Mon 9 Nov). Every G-F re-proof is measured on the final movement model,
     but the buffer week is consumed by the shift.
2. **Confirm V-D1–V-D8**, chiefly V-D1 (vehicles only, infantry still stack) and V-D5 (a goal held by
   another vehicle is reached at contact). **Recommended:** as written.
3. **Circle or capsule (V-D2).** The circle leaves up to ~0.4 tile of nose-to-tail overlap on the
   longest hulls (R); a capsule closes it at about twice the per-pair arithmetic. **Recommended:**
   circle first, judged on screen at zoom 1 against the PA-10 captures; capsule only if the lead still
   sees overlap.
4. **If a §5.7 target fails.** Separation changes who reaches a firing position first in an armoured
   fight. **Recommended:** stop, hand the reading to `balance-analyst`, and treat any `tuning.ts` change
   as a separate commit with its own reason inside this plan, never folded into the re-pin.
