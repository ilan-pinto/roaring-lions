# UH-60 Yanshuf (`heli_yanshuf`, GH-698): sim lane. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An air carrier must land to load and to unload, is a ground target while landed, and takes everyone aboard with it when shot down in the air. No shipped unit uses any of it yet.

**Spec:** `/Users/ilpinto/dev/roaring-lions-ep/_coord/blackhawk/spec.md` (read-only coordination copy; GH-698). The **LEAD RULINGS** at its top (18 Oct) are binding:
- 6 seats; cost 405, no seat term in the cost curve; role `apc` + air domain.
- Must land to load and unload, as hashed land/lift state.
- **Shot down in the air: all aboard die.**
- Off the versus menu until the landing-zone probe reads.

§2.2 R1–R8 and §2.3 items 1–11 are this plan's scope; §8 step 1 is this plan.

**Out of scope, each its own later plan:**
- **Data:** staged `docs/campaign/special_units/yanshuf/` JSON, the `validate_balance` runs, `tools/src/backtest/air-assault-probe.ts` (spec §3, §4, §8 step 2).
- **Art:** Meshy, exporter, wreck/damage recipes, portrait, plate (§6).
- **App and render:** catalogue, readability, symbol frame, unit card, LZ cursor, feed line, landed descent, i18n (§7).

**Architecture:**
- **State.** Three hashed per-entity columns on `Sim`: `airState` (the R1 machine), `airTimer`, `airWant` (what the carrier was last asked to do: nothing, land to load, land to unload, depart).
- **A new system.** `stepAirCarriers()` runs before `stepMovement`. It pins position outside `AIRBORNE`, advances the timers, and unloads on landing.
- **Commands unchanged in shape.** `load`, `unload`, `move` and `halt` keep their `Command` variants. `applyCommands` branches on `isAirCarrier`. `mission.ts`'s `dismount` already queues `unload`, so it needs no code.
- **One predicate.** `isAirborne(t)` replaces the TYPE test `isAir` at the five targeting readers. Movement, formation, snapping and `civilians.ts` keep the TYPE test.
- **Nothing hashed changes for a ground carrier.**

**Tech stack:** TypeScript strict, vitest. No data, schema or app change.

**Base:** `origin/main` @ `bfd89f756` (18 Oct). **Implementation starts after field works (#277) lands**, because both edit `sim.ts` and both move the hash (P1).

---

## Pre-flight: the spec against current main

Every cited symbol still exists. The line numbers have drifted by 100-250 lines, so **locate by symbol, never by line**.

| spec says | main today | note |
|---|---|---|
| `canSeat` `sim.ts:~5232` | `sim.ts:5350` | unchanged shape. `seat` 5366, `embarkAtSpawn` 5391 |
| `load` `~2548`, `unload` `2578` | `load` 2664, `unload` 2694 | `unload` is `for id: unloadAll(id)` |
| `disembark`, `unloadAll`, `stepTransport` | 5273, 5298, 5310 | `disembark` has no passability check (G2 confirmed: `car + HALF`, clamped only) |
| `LOAD_RANGE_SQ`, `BAILOUT_*` "in sim" | `tuning.ts:435`, `438`, `440` | imported at `sim.ts:115-117` |
| "`isAir` checks at 3655, 5317, 5945, 6159, 6180" | **`engageable` 3767, kamikaze 5437, focus reach 6065 (reads at 6073), `focusHurts` 6279, `couldEngage` 6300** | Five readers in all. The spec's "five sites **and** focusHurts/couldEngage" double-counts. Its `5317` is `disembark` inside `stepTransport`, not an `isAir` site. |
| type-only `isAir` that must stay | 2454-2455 (formation), 2534, 2566 (move), 6000 (`snapOpenTile` skip), 6392 (`stepMovement` clip); `civilians.ts:181,202` | `civilians.ts` skips air carriers (G6 confirmed) |
| formation membership `2337/2417/2449` | 2454-2455 | |
| `mission.ts` dismount `2797` | `mission.ts:3286` | queues `{ kind: 'unload', ids }`, filtered to alive and not `tunnelIn` |
| `loading.ts:134` | `packages/app/src/ui/loading.ts:~127-132` | A **comment** that `starting_force` cannot carry passengers. App file, no sim change. |
| `eyeLift` "uses 0 for air, `sim.ts:2844`" | `eyeLift` 2956 | Returns garrison `floors - 1`, 0 for anything not garrisoned (every air unit), so G7 holds. |
| `hashArray` "folds zeros too, `~6455`" | comment at ~6573 | Confirmed: **every new array moves every hash pin**, active or not. |
| `destroy` bail-out loop | `sim.ts:5857` | `disembark(i, true)` for each passenger. R5 hooks here. |
| "golden hash" (singular) | **three** golden replays plus six more pins | See P3. |
| Tunnel entry also calls `unloadAll` | `sim.ts:1734` | `unloadAll` must stay the immediate "everyone out now" primitive. R4 is a different entry. |

**Two corrections to the design text itself:**
- **`LANDING` is both ground and air in the spec.**
  - R6 defines `isAirborne = isAir && airState !== LANDED`, so `LANDING` is still targeted as air.
  - §4 calls the 2 s landing "a ground target", and R5 lets a `LANDING` kill bail out.
  - The plan follows R6's formula literally, in one function, with a pinned test. This is lead question Q-C.
- **`embarkAtSpawn` goes through `canSeat`,** which R3 makes require `LANDED`. Without a bypass, R8's "spawns airborne and loaded" is refused. Task 3 adds an `atSpawn` parameter.

## Prerequisites and lead questions

- **P1, field works (#277) and E6 (#274) land first.** Both extend the hash.
  - Rebase onto their re-pins.
  - **Re-read every pin value at Task 2**; do not trust the numbers below.
  - Pins read at `bfd89f756`: `determinism.test.ts` flat `935671699` (:497), relief `2842924511` (:866), orders `3272041047` (:993). The N2 block at :871-873 repeats them.
- **P2.** The `playtest` baseline: run `pnpm playtest` and `pnpm balance` on a clean checkout of the base commit once. Keep both outputs in the scratchpad. Every task diffs against them.
- **P3, the pin inventory** (from `grep -rn "hash()).toBe(" packages tools`, plus `pinWindow`):
  - `packages/sim/src/determinism.test.ts`: the three above.
  - `packages/sim/src/fire-support.test.ts:66` (`HASH`).
  - `packages/app/src/net/{versus-force,per-seat-types,match-world}.test.ts` (`580559085`, `1260439781`, `3043363756`).
  - `tools/src/backtest/versus-breach.test.ts:22-25`.

  Re-grep at Task 2; the list is not guaranteed complete.
- **Q-A (lead): move the hash, or fold only once live?**
  - **Spec default, and this plan's default: fold the three columns unconditionally.** Task 2 moves all nine-plus pins in one commit, with the reason.
  - **Alternative, field works' D1 precedent:** fold `airState`, `airTimer` and `airWant` only when the sim has registered an air-carrier type (`airCarrierTypes > 0`, a count taken in `addUnitType`, deterministic and hashed implicitly through the types).
    - Then **no pin moves** until the Yanshuf is registered, and the data plan moves them with the unit.
    - Cost: a conditional in `hash()`, and a coverage test that must register a carrier.
  - Task 2's last step is written for the default. The alternative changes only Step 3 and Step 5. **Do not start Task 2 before the lead answers.**
- **Q8 (lead, spec Q8): disembark snap with the Yanshuf, or as a separate bug first?**
  - Spec recommends landing it with the Yanshuf.
  - **This plan makes it Task 1: its own commit, first, with a `playtest` and golden diff,** so any movement is attributable to it alone.
  - If the diff is empty, it folds into the PR with no ceremony. If `playtest` moves, stop and put the diff in front of the lead.
- **Q-C (lead): is a `LANDING` carrier a ground target?** Literal R6 (this plan): no, only `LANDED`. The §4 prose reads yes. One-line flip in `isAirborne`.

---

## Global Constraints

- **The four invariants** (CLAUDE.md):
  1. **20 Hz.** Land and lift are tick counts: `AIR_LAND_TICKS` 40, `AIR_LIFT_TICKS` 20. Never frame time.
  2. **Q16.16, no `Math.*`/`Date.*`** (lint enforces). Timers are integer ticks. LZ positions are tile centres: `fx.add(fx.fromInt(tile), HALF)`.
  3. **No new random draw.** The disembark spread and the LZ search tie-break go by lowest tile index, then lowest entity id. Add no `rng` call anywhere in this plan.
  4. **Commands in, events out.** `Sim` stays the only writer. Render and app read `sim.state.airState` and nothing else; no new `Command` variant.
- **Hash rules:**
  - `Sim.hash()` folds `airState`, `airTimer`, `airWant` (Task 2), and every one gets a `hash covers <name>` test whose mutation is deleting its `hashArray` line.
  - **Tasks 1 and 3-6 must not move any pin after Task 2.** A move means an air path is live without air content: a bug to find, not a re-pin.
  - Task 1 moves a pin only if `playtest` or a golden replay really unloads next to a wall; read the diff.
  - Every re-pin carries a dated comment with the reason and `Was <n>.` in the file's existing style.
- **Ground carriers are bit-identical.** `tuning`, `canSeat`, `disembark`'s old position when valid, and `stepTransport` do the same thing for every non-air type.
- **`pnpm balance` is byte-identical to the P2 baseline at every task** (the §5.7 targets build no air carrier). A difference stops the task.
- **`pnpm playtest` is byte-identical at every task.** Task 1's diff is the one place it could move.
- **Strict TypeScript.** No `any`, no non-null assertions in sim code. Struct-of-arrays, no per-tick allocation: the LZ search and the spread reuse module-scratch arrays (the `snapX`/`snapY` pattern).
- **Every check is seen red.** Each task names its mutations; the commit message quotes the red line.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm test:determinism && pnpm validate:data`.
- **Git (house rules):** stage explicit paths, `git commit -F <msg> -- <paths>`. Never `-A`. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push; the lead merges.

## Review Focus

Failure modes the spec implies and no task's headline tests cover. Each has its test in the owning task.

1. **Two air carriers ordered to unload at the same LZ.** Nobody may land on a blocked tile. Stacked tiles are tolerated. (Task 3.)
2. **No vehicle-open tile near the order.** The `load` or `unload` is refused with no state change, not a carrier circling or landing on a wall. (Task 3.)
3. **A move or `halt` while the carrier is on its way to land.** `move` cancels the land plan and riders keep their seats. `halt` cancels it too and the carrier hovers. (Task 3.)
4. **A carrier removed from play (`removeFromPlay`) or entering a tunnel with riders aboard.** No dangling `carriedBy`; the tunnel path's `unloadAll` still works for ground carriers. (Task 5.)
5. **A rider still walking to the carrier when it is shot down.** It must not die and must not be stuck with a stale `boardGoal`. (Task 5.)

---

## Worktrees and lanes

One stream: **lane C, `sim-guard`.** Every task edits `packages/sim/src/sim.ts`. Tasks run strictly in order 1 → 2 → 3 → 4 → 5 → 6 → 7. Worktree `ys-sim` under `/Users/ilpinto/dev/roaring-lions-ep/`. Run `pnpm install` once.

## File structure

| File | Role | Task |
|---|---|---|
| `packages/sim/src/sim.ts` | `disembark` snap, state block, `stepAirCarriers`, command branches, `canSeat`, `isAirborne`, `destroy`, `hash()` | 1-5 |
| `packages/sim/src/tuning.ts` | `AIR_LAND_TICKS`, `AIR_LIFT_TICKS`, the four state constants | 2 |
| `packages/sim/src/disembark.test.ts` | **New.** G2 for ground and air carriers | 1 |
| `packages/sim/src/air-carrier.test.ts` | **New.** The state machine, commands, targeting, kill rules | 2-5 |
| `packages/sim/src/carriers.test.ts` | The air-carrier determinism replay and the ground-carrier digest | 6 |
| `packages/sim/src/determinism.test.ts` and the P3 pin files | The Task 2 re-pin | 2 |
| `packages/sim/src/mission.test.ts` | `dismount` and `embarkAtSpawn` on an air carrier | 6 |

---

## Task 1: Disembark lands on foot-open ground (item 7, **its own commit**)

**Agent:** `sim-guard`, sonnet. **Depends:** Q8 noted, P2.

**Files:** `sim.ts` (`disembark`), new `disembark.test.ts`.

**Interfaces:**
```ts
// sim.ts
/** Where a passenger set down at `car` stands. The old rule (car + HALF, HALF, clamped)
 *  when that tile is foot-open; otherwise the nearest foot-open tile centre by snapOpenTile
 *  on `this.blocked`. Writes posX/posY of `id`. No RNG. */
private disembark(id: number, shaken: boolean): void   // signature unchanged
```
A passenger whose old landing tile is open is **bit-identical** to today. Only a blocked or off-map result changes.

- [ ] **Step 1: Write the failing tests** in `disembark.test.ts` (fixture `JEEP` and `RIFLES` as in `carriers.test.ts`; a 20x20 map).
  - **Wall.** Block tile (6,6) only. A jeep at (5.5,5.5) carries one squad; `unload`. The squad's tile is not blocked, is within 1 tile of (6,6), and `sim.blocked[ty*w+tx] === 0`.
    - Write the literal tile after the first red run, with the tie-break named in a comment.
  - **Clear ground is unchanged.** On an empty map the squad stands at exactly `(5.5+0.5, 5.5+0.5)` in raw fixed-point (`fx.from(6)` on both axes). The oracle is a literal, not `HALF` arithmetic.
  - **Map edge.** A jeep at the last tile column unloads onto an in-map open tile.
  - **Bail-out.** A jeep killed next to the wall puts its squad on an open tile, shaken (`applySuppression` still applied; hp drops by 0.4 of max).
  - **Boulder is foot-open.** A `b` tile beside the car is a valid landing for a rifle squad (use `setBoulders` or the fixture the boulder tests use; `grep -n "boulder" packages/sim/src/*.test.ts` for the call).
- [ ] **Step 2: Run to see red.** `pnpm --filter @lions/sim exec vitest run src/disembark.test.ts` fails on the wall case (the squad stands in the blocked tile) and the edge case.
- [ ] **Step 3: Implement** in `disembark`: compute the old position; if its tile is off-map or `blocked`, call `snapOpenTile(tx, ty, this.blocked)` and use `snapX`/`snapY` tile centres. Leave the rest of the function alone.
- [ ] **Step 4: See it red.** Always snap (even when open): the clear-ground literal fails. Snap with `blockedVehicleMask`: the boulder case fails.
- [ ] **Step 5: The diff.** Run `pnpm playtest` and `pnpm balance`; diff each against P2. Run `pnpm test:determinism`.
  - **Expected: all byte-identical and all pins unmoved.** If anything moves, **stop**, paste the diff and the unload that caused it in the PR description, and ask the lead (Q8). Do not re-pin.
- [ ] **Step 6: Gates and commit** (`sim: disembark lands on foot-open ground (GH-698, item 7)`), the diff result in the message body.

## Task 2: The air state block, tuning constants and the hash (**the planned pin move**)

**Agent:** `sim-guard`, opus (determinism review). **Depends:** 1, P1, **Q-A answered**.

**Files:** `tuning.ts`, `sim.ts`, `determinism.test.ts`, the P3 pin files, new `air-carrier.test.ts`.

**Interfaces:**
```ts
// tuning.ts
export const AIR_LAND_TICKS = 40;   // 2 s, proposal (Q4), provisional until the probe reads
export const AIR_LIFT_TICKS = 20;   // 1 s
export const AIR_AIRBORNE = 0; export const AIR_LANDING = 1; export const AIR_LANDED = 2; export const AIR_LIFTING = 3;
export const AIR_WANT_NONE = 0; export const AIR_WANT_LOAD = 1; export const AIR_WANT_UNLOAD = 2; export const AIR_WANT_DEPART = 3;
// sim.ts, UnitType
isAirCarrier: boolean            // isAir && transportSlots > 0, set in the type builder
// sim.ts, per entity (capacity); spawn() initialises all three to 0
readonly airState: Uint8Array; readonly airTimer: Uint16Array; readonly airWant: Uint8Array
// exposed on Sim.state (read-only view, same pattern as alive/carriedBy)
state.airState: Uint8Array
// sim.ts, public read for render/app/tests
isAirborne(t: number): boolean   // type.isAir && airState[t] !== AIR_LANDED   (Q-C: the one place to flip)
```
`hash()` folds `airState`, `airTimer`, `airWant` after `passengers`.

- [ ] **Step 1: Write the failing tests** in `air-carrier.test.ts`:
  - `isAirCarrier` is true for an air type with `transport_slots: 6`, false for an air type with none and for a ground carrier.
  - A fresh spawn has `airState 0`, `airTimer 0`, `airWant 0`.
  - `hash covers airState`, `hash covers airTimer`, `hash covers airWant`: set one element via the test-only write the existing `hash covers` tests use, expect `hash()` to change.
  - `isAirborne` is true for an air unit at state 0, false at `AIR_LANDED`, and **false for a ground unit in every state** (it is `isAir` first).
- [ ] **Step 2: See red.** Fails to compile (`isAirCarrier`, `airState` missing).
- [ ] **Step 3: Implement.** Add the arrays, reset them in `spawn` (and in any slot-recycling path `spawn` shares), expose `airState` on `state`, add the three `hashArray` lines, add `isAirborne`. Nothing reads the columns yet.
- [ ] **Step 4: Re-pin** (default, Q-A = move). Every pin in P3, each with a dated comment: "GH-698: three per-unit columns, airState/airTimer/airWant, join the hash. No behaviour moved: with their `hashArray` lines removed, every replay reproduces the old value exactly. Was <n>."
  - Prove the comment: delete the three lines, run the pinned files, read the OLD values; restore. That is the "see it red" for this step.
  - Q-A = fold-when-live instead: gate the three lines on `this.airCarrierTypes > 0`; **no pin moves**; the coverage tests register a carrier type first.
- [ ] **Step 5: Gates.** Common gates, `test:determinism` (**moved here, re-pinned**), `balance` and `playtest` byte-identical (the hash is not an output of either). Commit.

## Task 3: Land to load, land to unload (R1-R4, items 3-6 and 10)

**Agent:** `sim-guard`, opus. **Depends:** 2.

**Files:** `sim.ts`, `air-carrier.test.ts`.

**Interfaces:**
```ts
// sim.ts
private stepAirCarriers(): void                  // called immediately BEFORE stepMovement in tick()
private lzFor(x: Fx, y: Fx): boolean             // nearestOpenTile on maskFor(DOMAIN_VEHICLE); writes snapX/snapY; false if none
private orderLand(car: number, want: number): boolean   // sets goalX/goalY to the LZ tile centre, moving=1, airWant=want; false = refused, no state touched
private unloadAir(car: number): void             // landed unload: everyone out, spread over open neighbours of the LZ
private canSeat(car: number, id: number, atSpawn?: boolean): boolean   // for an air carrier, additionally airState === AIR_LANDED unless atSpawn
```
Machine, per air carrier each tick:

| state | rule |
|---|---|
| `AIRBORNE`, `airWant` LOAD or UNLOAD, and `moving === 0` at the LZ (within 0.5 tile of the goal) | `LANDING`, `airTimer = AIR_LAND_TICKS`, `moving = 0`, wp cleared |
| `AIRBORNE`, `moving === 1`, `airWant` NONE | nothing (the carrier flies) |
| `LANDING` | `moving = 0` every tick; timer-- ; at 0 -> `LANDED` |
| `LANDED`, `airWant` UNLOAD | `unloadAir`, then `airWant = NONE` (it stays landed) |
| `LANDED`, `moving === 1` (any order was issued) and `airWant` not LOAD/UNLOAD | `LIFTING`, `airTimer = AIR_LIFT_TICKS`, `airWant = DEPART`, `moving = 0` (goal and waypoints are kept) |
| `LIFTING` | `moving = 0`; timer--; at 0 -> `AIRBORNE`, `moving = 1`, `airWant = NONE` |

- `move`/`attackMove` on an `AIRBORNE` carrier clears `airWant` (cancels a land plan). On a `LANDING` carrier it is ignored: `moving` is zeroed each tick.
- `halt` while `LANDING` completes it. Airborne, it cancels `airWant`.
- `load` naming an air carrier: `orderLand(car, LOAD)` at the LZ nearest the riders' centroid (eligible riders only, in id order), then the riders' `goalX/goalY` are that **LZ tile centre**, not the hull's current position.
  - The chase in `stepTransport` already reads `posX[goal]`, and the hull will be there on landing.
  - A refused LZ drops the whole `load`.
- `unload` naming a loaded air carrier:
  - `AIRBORNE`: `orderLand(car, UNLOAD)` at the LZ nearest its own position.
  - `LANDED`: `unloadAir` at once.
  - `LANDING`: `airWant = UNLOAD`.
  - `LIFTING`: `airWant = UNLOAD`, taken up on reaching `AIRBORNE`.
  - Empty carrier: no-op, as `unloadAll`.
- `unloadAir` places passenger *k* (id order) on the *k*-th foot-open tile of the LZ and its 8 neighbours, taken in (distance, tile index) order, wrapping when passengers outnumber tiles. Ground carriers keep `unloadAll`.

- [ ] **Step 1: Write the failing tests** (fixture `HELI`: `role: 'apc'`, `mobility.domain: 'air'`, `speed_tiles_s: 3.2`, `transport_slots: 6`, one `can_target: ['ground']` weapon; `RIFLES` from `carriers.test.ts`; 40x40 map, `run(sim, n)` ticks):
  - **Boarding refused while airborne.** A squad beside an airborne `HELI`: after 100 ticks of a `load`, it is not aboard until `airState === AIR_LANDED`; `canSeat`-via-`embarkAtSpawn` sees the same.
  - **Literal timeline.** From a `load` to landing: the carrier reaches `LANDING` at tick *t*, `LANDED` exactly `AIR_LAND_TICKS` (40) ticks later. A `move` then gives `LIFTING` for exactly 20 ticks, `posX/posY` unchanged for all 20, `AIRBORNE` after.
  - **Pinned in place.** `posX/posY` are identical across `LANDING`, `LANDED` and `LIFTING`.
  - **Six aboard.** Six squads `load`; all six end seated; a seventh stays on the ground.
  - **Unload lands on the nearest valid LZ.**
    - A loaded `HELI` hovering over a `#` tile, a `^` tile and a `b` tile in turn (one test each). `unload` -> it lands on a tile where `blockedVehicleMask` is 0, and the six squads stand on six distinct foot-open tiles.
    - The `b` case lands the heli **off** the boulder though a rifle squad could stand on it.
  - **Unload is land-then-unload.** No passenger is out while `airState` is `AIRBORNE` or `LANDING`; all are out the tick `LANDED` is reached.
  - **Order matrix.** `halt` while `LANDING` completes it; `move` while flying to land cancels the plan and nobody leaves; `unload` while `LIFTING` lands again after the lift.
  - **Review Focus 1.** Two loaded `HELI`s `unload` at one point: no passenger on a blocked tile.
  - **Review Focus 2.** Surround the carrier with `#` out to the map edge: `load` and `unload` change nothing (`hash()` equal before and after the command tick, apart from the tick counter's own effects).
  - **Ground carrier untouched.** The `carriers.test.ts` suite passes unmodified.
- [ ] **Step 2: See red** (compile errors, then behavioural).
- [ ] **Step 3: Implement** the signatures above. Reuse the air branch of the `move` handler for the flight itself; do not add a second movement path. `canSeat` adds the `LANDED` test last, so ground carriers short-circuit. Call `stepAirCarriers` before `stepMovement`. `embarkAtSpawn` passes `atSpawn = true`.
- [ ] **Step 4: See it red.**
  - Drop the `LANDED` test in `canSeat`: "boarding refused" fails.
  - Use `maskFor(DOMAIN_FOOT)` in `lzFor`: the `b` case lands on the boulder.
  - Skip the position pin in `LANDING`: the pinned-in-place test fails.
  - Unload from `AIRBORNE` immediately: "land-then-unload" fails.
  - Spread all passengers onto the first tile: the distinct-tiles assertion fails.
- [ ] **Step 5: Gates.** Common gates; `test:determinism` **unmoved after Task 2's pins**; `balance`, `playtest` byte-identical. Commit.

## Task 4: Landed means ground (R6, item 9)

**Agent:** `sim-guard`, sonnet. **Depends:** 3.

**Files:** `sim.ts`, `air-carrier.test.ts`.

**Interfaces:** `isAirborne(t)` (Task 2) now replaces `this.unitTypes[this.typeIdx[t]].isAir` at exactly five readers, found by symbol:
- `engageable` (the `canTargetAir` line);
- the kamikaze target loop in `stepKamikaze`;
- the focus-reach function holding `const air = ...isAir` (reads `canTargetAir` below it);
- `focusHurts`;
- `couldEngage`.

`stepMovement`, formation membership, `snapOpenTile`'s skip, the `move` branches and `civilians.ts` keep the type test (R6, item 9).

- [ ] **Step 1: Write the failing tests** (a landed `HELI` is made by `load`-ing a squad and running to `LANDED`; shooters are fixtures, ids declared in the test):
  - **MANPAD cannot engage a landed heli:** weapon `can_target: ['air']`; `sim.focusHurts(manpad, heli)` is `false` landed and `true` airborne.
  - **RPG can engage a landed heli:** weapon `type: 'rocket'` (or the repo's rpg fixture), `can_target: ['ground']`, penetration 60; `focusHurts` is `true` landed, `false` airborne; and over 200 ticks in range with LOS, the heli's hp falls.
  - **ZU-23 style** `can_target: ['ground','air']` hits it in both states.
  - **Rifles do not hurt it** (pen 8, front 32): `focusHurts` false landed. This pins the spec §3 table so a later armour retune is noticed.
  - **`couldEngage` agrees:** a `stepSweep` attack-mover with only a MANPAD does not chase a landed heli (position stays put).
  - **`LANDING` is air** (literal R6, Q-C): `isAirborne` true at `AIR_LANDING`, `AIR_LIFTING`. One test named for the question, so flipping it is a visible decision.
  - **A non-air unit is unaffected** for every `airState` value.
- [ ] **Step 2: See red.**
- [ ] **Step 3: Implement** the five replacements.
- [ ] **Step 4: See it red.**
  - Revert only `engageable`: the RPG engagement test fails.
  - Revert only `focusHurts`: its pair fails.
  - Revert only `couldEngage`: the sweep test fails.
  - Revert only the kamikaze loop: add a one-case test (a loitering munition drone vs a landed heli) so this site has a witness. It fails with the revert.
- [ ] **Step 5: Gates.** As Task 3. Commit.

## Task 5: Shot down in the air takes everyone (R5, item 8)

**Agent:** `sim-guard`, opus. **Depends:** 3.

**Files:** `sim.ts` (`destroy`), `air-carrier.test.ts`.

**Interfaces:** in `destroy(target, by)`, where the passenger loop is today (`disembark(i, true)`):
- if `unitTypes[typeIdx[target]].isAirCarrier` and `airState[target]` is `AIR_AIRBORNE` or `AIR_LIFTING`: for each living passenger, clear `carriedBy[i] = -1`, decrement `passengers[target]`, then `this.destroy(i, by)`.
- Otherwise (`LANDING`, `LANDED`, and every ground carrier): the existing `disembark(i, true)`, which Task 1 made safe.

Credit, ROE and veterancy go to `by` through the ordinary `destroy` path. No new event kind.

- [ ] **Step 1: Write the failing tests** (`debugKill` is the sanctioned test kill; or `applyDamage` via a shooter, one case):
  - **Airborne kill takes all six:** six squads aboard, `debugKill(heli)` -> all seven `alive === 0`, `passengers[heli] === 0`, no `carriedBy` left set.
  - **Kill credit:** the same, killed by a shooter fixture: `kills` of the shooter rises by the heli plus six, via the existing counters; compare to the literal expectation of 7.
  - **Landed kill bails out:** all six alive, each at 0.6 of max hp, on foot-open tiles.
  - **Landing and lifting:** `LANDING` bails out (R5); `LIFTING` kills.
  - **Ground carrier unchanged:** a jeep kill bails out exactly as before (the existing `carriers.test.ts` case, untouched, passes).
  - **Review Focus 5:** a squad still walking toward an airborne-then-landing heli (`boardGoal` set, not seated) when the heli is killed: alive, `boardGoal === -1` after the next `stepTransport`.
  - **Review Focus 4:** `removeFromPlay` of a landed loaded heli leaves no passenger with a dangling `carriedBy` to a dead id (read what `removeFromPlay` does with passengers first and pin whatever it already does for ground carriers); a ground carrier entering a tunnel still unloads (`unloadAll` path).
- [ ] **Step 2: See red.**
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: See it red.**
  - Branch on `isAir` instead of `airState`: the landed-kill test fails.
  - Skip clearing `carriedBy`: the "no `carriedBy` left set" assertion fails.
  - Pass `-1` instead of `by`: the credit test fails.
- [ ] **Step 5: Gates.** As Task 3. Commit.

## Task 6: Mission paths and the replays (R8, item 11 remainder)

**Agent:** `sim-guard`, sonnet. **Depends:** 3, 5.

**Files:** `mission.test.ts`, `carriers.test.ts`, `air-carrier.test.ts`. No `mission.ts` change is expected: confirm that.

- [ ] **Step 1: Write the tests.**
  - **`embarkAtSpawn` onto an airborne air carrier succeeds** (seat count 1, `airState` 0) and rides with the hull; refused past 6; still refuses a tank.
  - **`do.kind: 'dismount'`** on a group holding a loaded airborne `HELI` (a minimal mission fixture, as the existing dismount test builds) lands it first, then everyone is out: no passenger out at the trigger's tick, all out when `LANDED`. A buried carrier is still skipped by the runtime filter.
  - **Carrier replay, air.** In `carriers.test.ts`: heli, six squads, an enemy MANPAD fixture and a ground tank; `load`, `attackMove` to a far point, `unload`. `build()` twice are equal, **and** the value is pinned as a literal after the first run, with the date and "GH-698".
  - **Ground carrier bit-identical.** The existing jeep scenario's state is digested over **non-air columns only** (`posX, posY, hp, alive, carriedBy, passengers` read from `sim.state`, folded in the test). The digest is captured on the P2 base commit and pinned as a literal; it must not change at any task. (The full `hash()` cannot serve: Task 2 moved it.)
- [ ] **Step 2: Run.** Expected: the embark and dismount tests pass without a code change (they exercise Task 3); the replay and digest literals are filled from the first run, then re-run twice to prove stability.
- [ ] **Step 3: See it red.**
  - Make `embarkAtSpawn` pass `atSpawn = false`: the embark test fails.
  - Add one `rng` draw inside `stepAirCarriers`: the replay literal fails and the digest does not move (it reads no RNG column), which confirms the replay pin is the determinism witness.
- [ ] **Step 4: Gates and commit.**

## Task 7: Whole-branch review and hand-off

**Agents:** opus whole-branch review, `sim-guard` determinism review. **Depends:** 6.

- [ ] **Step 1: Review the diff.**
  - `git diff main -- packages/sim` has no `Math.` or `Date.` and no float literal outside `fx.from` load paths.
  - Every new field is initialised in `spawn` and folded in `hash()`.
  - The five `isAir` readers changed and the type-only ones did not (the pre-flight table, by symbol).
  - Exactly one planned pin move (Task 2), plus Task 1 only if the lead ruled on a real diff.
- [ ] **Step 2: Every gate.** `lint`, `typecheck`, `test`, `test:determinism`, `validate:data`, `balance` and `playtest` byte-identical to P2. `ui:routes`, `golden-baseline` and `pnpm validate:meshes` are untouched by this plan; CI runs them.
- [ ] **Step 3: Nothing ships to players.** `git diff main --stat` shows no file under `data/`, `art/` or `packages/app/`. `grep -rn "transport_slots" data/units` shows no air unit.
- [ ] **Step 4: The PR** states Q-A's outcome, Q8's outcome (with the Task 1 diff result), Q-C's outcome, and lists the later plans.

## Later plans (not written here)

- **Data** (`heli_yanshuf` staged JSON, the four `validate_balance` runs, `air-assault-probe.ts` with the §4 bar). **It decides the 40/20 tick values** (spec Q4). The probe cannot run before this plan lands.
- **Art** (spec §6; Meshy ceiling 55 credits; Peten IoU check on the preview before the refine).
- **App and render** (spec §7). Open items this plan hands them:
  - **Unload at a clicked point** needs an optional `x`/`y` on the `unload` command. That touches the network command codec (`tools/src/net/mcp-tools.ts` handles `unload`), so it is its own decision.
  - **The "N squads lost" feed line** needs a way to count riders killed by an airborne kill. Death events plus `carriedBy` at the kill tick may suffice; if not, a follow-up adds the count to the death event.
  - The render-side descent reads `state.airState`.
- **Versus menu:** off, until the probe has a bar (spec Q9).
