# WP-G-F plan F1: fire support, and intel earned by doing (GH-183, G3 Q1). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Changed since 4 Oct

Refreshed against `main` `b44df7aa` (6 Oct, v0.121.4); first read against `067fab9a`. Everything F1 reads is unchanged in kind: the trickle (`mission.ts` ~L420, ~L1056), `requestSweep`/`requestStrike` (150/250), `callStrike`/`pendingStrikes`/`stepStrikes` and the `STRIKE_*`/`SMOKE_*` constants, `CONTEST_RADIUS_SQ`, both `creditContribution` call sites, `creditInputFrom` (reads no intel).

- **#402 infantry halt and kneel to fire** (`7962b6ea`, a lead-approved one-off sim change; spec `docs/superpowers/specs/2026-10-05-infantry-halt-to-fire.md`). Sim pins flat 2109596329 -> **922714084**, relief 1425295494 -> **3200430224**; `LADDER_CREDITS` 5844 -> **5830**. Kneel 0.2 s (`KNEEL_DROP_TICKS` = `KNEEL_RISE_TICKS` = 4), the lead's final choice.
- **GH-382** (5 Oct): 19 campaign maps re-grounded, every arc's II+ (and `tel_marum_1_recon`) on new ground with new plan coordinates; `LADDER_CREDITS` 5736 -> 5844. 33 maps: **21 relief, 12 flat** (were 10/16). **16 of 18 economy missions are on relief**; only `beit_sahwan_3_clearance` and `khan_rafid_3_clearance` are flat.
- **GH-119** (`f5c41d77`): `briefing_sections` must spell `briefing` exactly. **#330** landed (`packages/app/src/campaign-pay.ts`), no pin moved. **#291 has not landed.**
- Unchanged: `playtest.ts` still has 26 winning plans and 23 passive/no-orders controls (as at `751b6742`); no plan, ladder or balance target spends intel; the golden replays call no strike.

New interactions, each also noted at its task:
- **Fire support vs kneelers (Task 6).** A pin freezes the brace machine. Kneeling changes no hit, exposure or cover factor, so barrage and strike damage against a kneeler is unchanged. A soft unit pinned `ROUT_AFTER_TICKS` (200) routs: it gets up (pays `KNEEL_RISE_TICKS`) and runs.
- **Smoke (Task 7).** Not cover for `coverLevelOf` (tile cover and parapet only), so a band target in thin smoke is still bounded against, not closed on. A line through >= `SMOKE_BLOCKS_AT` (320) of smoke is blocked, so a screened target is simply not selected.
- **The closing rule (`stepSweep`; Tasks 2, 5, 9).** An arrived attack-mover with nothing inside effective range walks toward any identified enemy it cannot reach. Every player right-click is an attack-move, and `halt` clears `moving` but not `attackMove`, so the player has no order that holds a unit against that. Attack-movers now advance on what they identify (more "first identified" pay); a unit on a rise, which sees further, walks off it (D4).
- **Drone sweep (Tasks 3, 8, 9).** `reveal` identifies through `sim.identifyTo`, so since #402 it pulls every arrived, idle side-0 attack-mover toward the nearest revealed enemy at once (before, only after the contact decayed). `identifyTo` emits `contact` `identified` with `observer: -1`, for a sweep and for a pre-marked carry-over spawn, and the earn rule as written pays both (true at `067fab9a` too).
- **Passive controls (Task 9).** Side-1 waves are attack-movers and close on a passive force they have identified; a patrol that meets contact halts and fights there (`stepPatrols`). Both raise what a passive force identifies.
- **Fixtures (Tasks 1, 3, 5).** A plain `move` holds a foot unit's fire; shipped `inf_squad` halts to fire; an in-test type with no `role` derives wheeled and never braces (`mission.test.ts`'s `m_squad`).
- **Balance smoke step (Task 7).** The stamp Task 7 extracts is the one `urbanSmokeStep` lays; its max-tier 2:1 + smoke cell reads 97% on the gate's seeds against a 90% floor (spec §6).

### For the lead

1. **High ground (G3 Q1 "earned by doing"; D4).** An arrived attack-mover now walks toward any identified enemy it cannot reach, and the player has no order that stops it. Does D4 stand as written, or does the rise term wait for a hold order the closing rule respects?
   **Ruled 6 Oct (lead):** add a "Hold position" order (`2026-10-06-hold-position.md`, Wed 4 Nov, before F1). A held unit stays put, kneels and fires at anything in range, and never advances, chases or closes. D4 stands: Hold is how the player keeps a unit on a rise, and Task 5 pins both cases.
2. **D4 and passivity.** With 16 of 18 economy missions on relief, a starting force placed on a rise is paid 30 after 10 s uncontested without moving. Should a rise the starting force spawns on pay?
   **Ruled 6 Oct:** a spawn rise pays only after a move onto it. Standing still from t=0 earns nothing.
3. **D1.** 10 + 25 was the cheapest passing row at `751b6742`, before GH-382 and #402. If Task 2's re-run says it no longer passes, does Task 2 propose the new cheapest passing row, or bring the table back un-picked?
   **Ruled 6 Oct:** propose the cheapest passing row, flagged for the lead's confirmation.
4. **D3 (not a landing).** Should an identification with no observer (`observer: -1`: a bought sweep, a pre-marked carry-over spawn) pay? As written, at D1's 10, a sweep that reveals 15 enemies refunds its 150.
   **Ruled 6 Oct:** no observer, no pay. This closes the refund exploit.
5. **The drone sweep (four-item menu).** Since #402 a sweep also pulls idle attack-movers toward what it reveals. Is that the drone sweep you want, or should Task 8 pin it either way?
   **Ruled 6 Oct:** accept it, and pin it in Task 8. Hold position is the player's counter.
6. **D2.** #402 took base urban 2:1 from 63% to 37% (accepted 6 Oct). Are 60/120 still the starting points, or should Task 2 measure the barrage and smoke screen on `urbanAssault` before G-NUM?
   **Ruled 6 Oct:** measure the prices on `urbanAssault` first.

**Goal:** Intel stops paying the player for standing still and starts paying for what a commander
does: finding the enemy, taking high ground, completing objectives. It stays the **fire-support
currency**, and it buys a menu of four, not two.

| | today (`main` `067fab9a`; unchanged at `b44df7aa`) | after F1 |
|---|---|---|
| earned by | 8/min per living drone, 5/min per **stationary** `mark_target` unit (every `inf_squad`) | **10** per enemy first identified, **25** per objective completed, **30** per high-ground rise first held. No per-minute term at all |
| spends on | satellite sweep 150, precision strike 250 | **smoke screen**, **mortar barrage**, **drone sweep** (today's sweep, renamed), **air strike** (today's strike) |
| what the G3 probe read | passive out-earned the winner in **22 of 23** pairs (M at `751b6742`, G3 sheet; before GH-382 and #402) | the probe becomes a gate: passive out-earns the winner in **0** pairs |

**Architecture:**
- **Earning is `MissionRuntime` only.** It reads three things the sim already emits or holds: the
  `contact` event at level `identified` for side 0, the runtime's own objective completions, and
  the integer `sim.elevation` grid. No new sim state, no new hashed array.
- **The two new strikes are sim commands.** `callStrike` already queues a `pendingStrikes` entry
  with scatter drawn from the caller's own stream. F1 gives that entry a `profile` index into a
  `FIRE_SUPPORT` table in `tuning.ts` (`air_strike`, `mortar_barrage`, `smoke_screen`). A barrage is
  N entries at staggered `readyTick`s. A smoke round lays the existing smoke grid at its impact point
  instead of doing damage. Same command path, same ROE attribution, same RNG rule.
- **A new determinism pin for the economy** (Task 1). `determinism.test.ts` never constructs a
  `MissionRuntime` (M, G3 sheet "one correction"; still true at `b44df7aa`), so no economy change in Stage 4 can move the two
  sim pins, and nothing guards the economy against non-determinism at all. F1 adds the guard; every
  G-F plan after it re-pins it once.

**Tech stack:** TypeScript strict, vitest. No new dependencies.

**Refs:**
- GH-183 (WP-G-F), F1 and F5.
- GH-167 (G3), answered in full by the lead on 4 Oct. Q1: *intel stays the fire-support currency,
  with a richer menu (mortar barrage, smoke screen, drone sweep, air strike)*; *earned by doing
  (spotting, high ground, objectives), no trickle*. The lead rejected intel as an information
  currency.
- The G3 decision sheet, PR #369, `docs/superpowers/specs/2026-10-04-g3-decision-sheet.md`, Q1: the
  probe, the calibration table, and the 10 + 25 starting row.
- GH-113 (presentation weight for the intel abilities) and GH-77 (counters), both carried by WP-S-F
  #184.
- `docs/GDD.md` §3 (the economy) and §5.5a.

**Base:**
- Read against `main` `067fab9a`; refreshed against `main` `b44df7aa` (6 Oct, see "Changed since
  4 Oct"). Locate code by symbol; line numbers drift.
- Branch `feat/gf1-intel`, cut from `main` **after #291 and #330 have landed** (see
  `2026-10-04-stage4-order.md`). At `b44df7aa`, #330 has landed (October,
  `packages/app/src/campaign-pay.ts`, no pin moved) and #291 has not. Worktree under
  `/Users/ilpinto/dev/roaring-lions-ep/`, `pnpm install` once.
- **Nothing in this plan is measured yet.** Every number marked (M) is quoted from the G3 sheet's
  probe at `751b6742`, **before GH-382 re-grounded 19 maps and #402 changed who fires when**; its
  inputs have moved, so every (M) is a prior to re-measure, not a prediction. Every (R) is reasoned,
  and its task says how to measure it. A plan executor who finds a measured number different from an
  (R) here records both, and does not fit the code to the plan.

---

## Decisions

- **By the lead, 4 Oct (G3 Q1):** the fire-support reading; the four-item menu; earned by doing;
  **no trickle**. *(6 Oct: where #402 bears on "earned by doing" (high ground) and on the drone
  sweep, see "For the lead" items 1 and 5, both ruled 6 Oct. The rulings stand as written; the lead
  added Hold position as the player's tool.)*
- **Consequence the plan takes as binding:** #183 F1's "`intel_rate_per_min` authored where a mission
  wants it" is **dropped**. An authored per-minute feed is a trickle by another name, and the lead
  ruled the trickle out. The G3 sheet's suggestion to keep one for an informant feed is not taken.
  Record it in `docs/HANDOVER.md` §3 with the date.
- **Taken defaults (confirm or overrule):**
  - **D1. Starting rates are the G3 sheet's cheapest passing row**, 10 per identified enemy and 25 per
    objective, plus 30 per high-ground rise (R, unmeasured, the one term the sheet did not probe).
    All three go to the lead as a G-NUM table in Task 2 before any code reads them. *(6 Oct: the
    row was calibrated at `751b6742`. Ruled 6 Oct: if it no longer passes, Task 2 proposes the
    cheapest passing row, flagged for the lead's confirmation.)*
  - **D2. Prices.** Smoke screen 60, mortar barrage 120, drone sweep 150, air strike 250. Sweep and
    strike keep today's prices so no briefing line that names a price is falsified. G-NUM in Task 2.
    *(6 Oct: no mission text names a price at `b44df7aa` (Task 10's census); the HUD does, via
    `sweepCost`/`strikeCost`. Ruled 6 Oct: Task 2 measures the barrage and smoke screen prices on
    `urbanAssault` before G-NUM.)*
  - **D3. "First identified" is once per enemy entity per mission.** An enemy lost and re-identified
    pays nothing the second time. Otherwise a scout that bobs in and out of a treeline farms intel,
    which is the trickle again. *(6 Oct: whether an `observer: -1` identification, from a bought
    sweep or a pre-marked carry-over spawn, pays: ruled 6 Oct, it does not. Only an identification
    with a real observer (`observer >= 0`) pays.)*
  - **D4. A high-ground rise** is a 4-connected component of open tiles whose elevation is at least
    `HIGH_GROUND_LEVELS` (2) above the map's median open-tile level. It pays once per mission, to the
    first side-0 surface unit that stands on it for `HIGH_GROUND_HOLD_TICKS` (200, 10 s) with no
    enemy inside `CONTEST_RADIUS_SQ`. Two levels because a one-level rise sits exactly at eye level
    (`EYE_HEIGHT`, CLAUDE.md "A map") and grants no sight. The median, because an absolute level
    would make every tile of a plateau map "high". Flat maps have no rise and pay nothing for height.
    *(6 Oct: 16 of 18 economy missions are on relief since GH-382, and #402's closing rule walks an
    arrived attack-mover off a rise toward what it identifies out of reach. `EYE_HEIGHT` is 1,
    `packages/sim/src/sim.ts` ~L792.)*
    *Ruled 6 Oct:*
    - *D4 stands. The lead added Hold position (`2026-10-06-hold-position.md`), which keeps a unit
      on a rise.*
    - *A rise pays only to a unit that moved onto it after spawning. A unit standing on it from
      t=0 earns nothing until it has left and come back.*
  - **D5. Objectives pay on completion, primaries and secondaries alike**, and never for a failure.
    `completeObjective` (the tutorial path) pays too: it is the same earn rule as
    `creditContribution`.
  - **D6. `intel_start` stays.** It is a grant, not a trickle. `umm_zeitoun_2_buildup` (150) and
    `umm_zeitoun_4_clearance` (250) keep theirs.
  - **D7. Fire support stays player-only in Stage 4.** The menu is `MissionRuntime` API for side 0.
    The G-G commander (Stage 5) may call the same sim commands for side 1; nothing in F1 stops it.

---

## Global Constraints

- **The four invariants hold.** No floating point added to `packages/sim/src`, no `Math.*`, no
  `eslint-disable`. The earn rule is integer lumps. The barrage draws its scatter from the
  **caller's** `rng` stream, exactly as `callStrike` does, one stream draw pair per round.
- **The two sim pins (`determinism.test.ts`, flat `922714084` and relief `3200430224` on `main` at
  `b44df7aa`, ~L427 and ~L721; they were `2109596329` and `1425295494` at `067fab9a`, and #402 moved
  both; whatever #291 re-pins them to, if it lands first) stay UNMOVED by every task.** The golden
  replays never call a strike (grep, 6 Oct: `determinism.test.ts` has no `callStrike`, `reveal` or
  `MissionRuntime` at `b44df7aa`; grep again in Task 6, Step 3; if one does, stop and raise it). The
  new `profile` field is hashed inside the `pendingStrikes` loop, which is empty in both replays, so
  neither number moves. A move is a defect, never a re-pin.
- **The economy pin (born in Task 1) moves exactly once in this plan**, in Task 3, with the reason in
  the commit message and a dated comment above the number.
- **`pnpm balance`**: exit 0, every §5.7 target passes, byte-identical (R): `targets.ts`
  (`tools/src/backtest/targets.ts`, run by `tools/src/balance/cli.ts`) builds no `MissionRuntime`
  and spends no intel.
- **`pnpm playtest`**: exit 0. Outcomes, durations, ROE, stars and credits byte-identical (R): no plan
  spends intel today, and `creditInputFrom` (`packages/sim/src/credits.ts`) reads no intel (M, G3
  sheet; still true at `b44df7aa`). `LADDER_CREDITS` (**5830** on `main` at `b44df7aa`,
  `tools/src/backtest/playtest.ts` ~L3181, held equal to `CAMPAIGN_CREDITS` in
  `packages/app/src/ui/stores-model.ts` L63; it was 5736 at `067fab9a`, GH-382 moved it to 5844 and
  #402 to 5830; #330 moved no pin) unchanged. Task 9 adds new printed lines; the existing lines do
  not move.
- **Every check is seen red.** Each task names a one-line mutation of the implementation that must
  turn a named test red, and the commit message quotes the red line (CLAUDE.md, "Every check gets an
  input that makes it fail").
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test:determinism && pnpm test`,
  then `pnpm balance`, `pnpm playtest`, and `pnpm validate:data` whenever data or a schema changes.
  Paste what they printed into the commit message (execution plan, Stage 4 constraint).
- **Strict TypeScript.** No `any`; no non-null assertions in sim code.
- **Git.** `/usr/bin/git commit -s -F <msg> -- <paths>`; never `-A`, never `git checkout -- <file>`,
  never `pkill` vite. Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  The lead merges.
- **Lane C is one lane.** F1 touches `packages/sim`, `data/schemas`, `data/missions`, `tuning.ts`,
  `tools/src/backtest/`. The one `packages/app` edit (Task 8) is the call-site rename `typecheck`
  forces; the menu UI is WP-S-F's.

---

## File structure

| File | Role | Task |
|---|---|---|
| `packages/sim/src/mission.ts` | `economyHash()`; the earn rule; the per-minute terms deleted; the four-item `requestSupport` | 1, 3, 5, 6, 8 |
| `packages/sim/src/determinism.test.ts` | The economy replay and its pin | 1, 3 |
| `packages/sim/src/intel-earn.ts` (+ test) | **New.** Pure: `highGroundRises(elevation, blocked, w, h)` and the median | 4 |
| `packages/sim/src/tuning.ts` | `INTEL_EARN`, `FIRE_SUPPORT` profiles, `HIGH_GROUND_*` | 2, 3, 6, 7 |
| `docs/campaign/economy/fire-support-numbers.md` | **New.** The G-NUM table | 2 |
| `packages/sim/src/sim.ts` | `pendingStrikes[].profile`; the smoke payload; `hash()` | 6, 7 |
| `packages/sim/src/fire-support.test.ts` | **New.** Barrage and smoke-screen sim tests | 6, 7 |
| `packages/sim/src/mission.test.ts` | Earn and spend tests | 3, 5, 8 |
| `packages/sim/src/index.ts` | Exports `SupportKind`, `FIRE_SUPPORT_KINDS` | 8 |
| `packages/app/src/main.ts`, `ui/production.ts`, `ui/production.test.ts` | The call-site rename only (the test imports `SupportKind` and uses the `'sweep'`/`'strike'` literals) | 8 |
| `tools/src/backtest/playtest.ts` | The intel probe as a gate; one plan that spends intel | 9 |
| `docs/GDD.md` §3, `docs/campaign/README.md` | The earn rule and the menu, in the contract | 10 |
| `data/missions/*.json` | Text only, if Task 10's census finds a false line (none named a sweep or strike at `b44df7aa`) | 10 |
| `docs/HANDOVER.md` | The ledger | 10 |

---

## Task 1: the economy pin (a new guard, not a re-pin)

**Model:** sonnet. **Agent:** `sim-guard`.

**Why.** Every Stage 4 economy plan changes `MissionRuntime`, and no determinism test constructs one.
The economy is today the one piece of mission state with no canary for invariant 2 or 3. It also
lives in JS number arithmetic (`rate / 1200`, `mission.ts` income block), which is legal there only
because nothing hashes it. Pin it before F1 changes it, so F1's own change is the first thing the pin
has to explain.

**Files:** `packages/sim/src/mission.ts`, `packages/sim/src/determinism.test.ts`.

**Interfaces (produced):**

```ts
// mission.ts
/** A 32-bit hash over every piece of runtime economy state: the floored purse
 *  (logistics, intel), the build queue, and, from F2/F4 on, the zone owners and
 *  production lines. Uses the sim's own hashWord, so the two hashes compose. */
economyHash(): number;
```

- [ ] **Step 1: The fixture.** In `determinism.test.ts`, a new `describe('economy replay')`: an
  inline `MissionJson` on `beit_sahwan_outskirts` (flat) with `resources` (start 400, rate 120,
  `intel_start` 0), one camp, a KDF force with a `recon_drone` and an `inf_squad`, a two-group enemy
  garrison, a `hold_for` primary and a `destroy` secondary. Step it `ECONOMY_TICKS` (2400, two
  minutes) with a scripted `requestBuild('inf_squad')` at tick 400 and 800, and moves that bring
  the force into contact.
  *(6 Oct, #402: shipped `inf_squad` halts to fire. A plain `move` runs it through holding fire; an
  `attackMove` drops it to a knee before it fires and, once arrived, walks it toward any identified
  enemy it cannot reach (`stepSweep`). Pick the order deliberately, and build the force from shipped
  unit data: an in-test type with no `role` derives wheeled and never braces.)*
- [ ] **Step 2: Two properties, then the pin.**
  - **"two runs of the economy replay agree"**: `economyHash()` identical across two constructions.
  - **"the economy replay pins its hash"**: `expect(rt.economyHash()).toBe(ECONOMY_PIN)`, the number
    read on first run, with a dated comment ("born 2026-11-xx at <sha>, F1 Task 1, before any
    economy change").
  - **"the economy hash covers the purse"**: two runtimes that differ only by one extra
    `requestBuild` hash differently.
- [ ] **Step 3: Coverage, not just existence.** Assert the replay reaches the states the hash claims
  to cover: at the end, intel > 0, at least one `built` event, at least one enemy identified, and the
  secondary complete. A hash over a replay that never earns intel would pin nothing (the
  "returned an empty array" shape in CLAUDE.md).
- [ ] **Step 4: Measure.** Both sim pins unmoved. `balance` and `playtest` byte-identical: nothing
  but a test and a read-only method changed.
- [ ] **Step 5: See it red.**
  - Drop `logistics` from `economyHash`: "covers the purse" fails.
  - Swap the drone for a second `inf_squad` in the fixture: the coverage assertion "intel > 0" still
    passes on today's trickle (the squad is stationary; R: since #402 an arrived attack-mover is
    stationary only until it identifies something out of reach), which is the point to record. Swap
    it again after Task 3 and it fails, because nobody identifies anything. Note both readings in
    the commit.

---

## Task 2: the numbers, before the code (G-NUM)

**Model:** opus. **Agent:** `balance-analyst`. **Depends:** none. **Halts the run until the lead
answers.**

**Why.** Five new numbers, three of them never probed (the high-ground term, smoke, barrage).
Numbers cost a line to approve and a re-pin to change (memory: approve art numbers before
rendering; the same holds for prices).

**Files:** `docs/campaign/economy/fire-support-numbers.md` (new).

- [ ] **Step 1: The earn table.** Re-run the G3 sheet's economy probe (a scratchpad copy of
  `playtest.ts` with the two read lines, never a tracked edit) on the branch base. Report, per
  winning plan and per passive control: enemies first identified, objectives completed, rises a
  side-0 unit stood on for 10 s, and the total under D1. Add the **arrival time** of the 150th intel
  point per winning plan. The G3 sheet warned that intel arriving at the victory banner buys nothing;
  this is the number that says whether it does.
  *(6 Oct: the denominators are unchanged at `b44df7aa`, 26 winning plans and 23 passive/no-orders
  controls in `playtest.ts` (`beit_sahwan_1_recon`, `beit_sahwan_2_foothold` and
  `beit_sahwan_3_clearance` have no control), but every count is a fresh reading: GH-382 moved the
  plans onto new ground and #402's closing rule walks attack-movers toward what they identify. The
  G3 numbers this plan quotes are M at `751b6742`. Count the rise term on relief: 16 of the 18
  economy missions now stand on it.)*
  *Ruled 6 Oct:*
  - *The probe applies the rulings: no pay without an observer (D3), and no pay for a spawn rise
    until a move onto it (D4).*
  - *If 10 + 25 no longer passes, this step proposes the cheapest row that does, flagged for the
    lead's confirmation (D1).*
- [ ] **Step 2: The menu table.** For each of the four items: price, delay from call to first impact,
  footprint, damage, suppression, ROE exposure, and the counter it answers. Proposed starting points
  (R):

  | item | price | profile |
  |---|---|---|
  | smoke screen | 60 | 3 rounds, `SMOKE_RADIUS` each, laid over 4 s, 0 damage; delay 4 s |
  | mortar barrage | 120 | 6 rounds over 9 s, scatter 1.5 tiles, 120 dmg / 1.0-tile splash each, suppression 0.6; delay 6 s |
  | drone sweep | 150 | today's `reveal`, `SWEEP_RADIUS_SQ` |
  | air strike | 250 | today's `callStrike`: 600 dmg, 2.0-tile splash, 3 s |

  The barrage is the area-denial tool the strike is not: less damage per point than the strike,
  more suppression per point, scatter wide enough that firing it near the clinic is a decision.
  *Ruled 6 Oct: measure the barrage and smoke screen on `urbanAssault`
  (`tools/src/backtest/targets.ts`) before this table goes to the lead. A scratch copy issues the
  profile against the defended town at the gate's own seeds, at each ratio, and records what each
  price buys. Base urban 2:1 has read 37% since #402.*
- [ ] **Step 3: The lead answers.** Post the two tables on #183. Record the answer and the date in
  the doc. Tasks 3, 6 and 7 read only the approved numbers.
- [ ] **Step 4: See it red** (for the doc's own claim): the probe's passive column must read 0 for
  `khan_rafid_3_clearance`, the G3 sheet's worst trickle case (189 earned standing still, M at
  `751b6742`). If it reads anything else under D1, the earn rule pays passivity and Step 3 does not go
  to the lead. *(6 Oct: `khan_rafid_3_clearance` is on new ground since GH-382 (map `khan_rafid_3`,
  flat, so no rise term), and side-1 attack-movers now close on a force they have identified, so an
  enemy walking into a passive force's sight pays 10. The rule above still binds; record the
  reading and its cause in the doc.)*

---

## Task 3: intel by doing; the trickle deleted

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Tasks 1, 2.

**Files:** `packages/sim/src/mission.ts` and its test, `packages/sim/src/tuning.ts`,
`packages/sim/src/determinism.test.ts`.

**Interfaces:**

```ts
// tuning.ts (values from Task 2's approved table)
export const INTEL_PER_IDENTIFIED = 10;
export const INTEL_PER_OBJECTIVE = 25;
// mission.ts
/** Side-0 first identifications already paid for (D3). Runtime-only. */
private readonly paidIdentified = new Set<number>();
/** Why intel moved this tick, for the HUD's feed (S-F). */
export interface IntelEarnedEvent { kind: 'intelEarned'; tick: number; amount: number;
  cause: 'identified' | 'objective' | 'highGround'; ref: number | string }
```

- [ ] **Step 1: Write the failing tests** (`mission.test.ts`, a new `describe('intel by doing')`):
  - **"a stationary scout earns nothing"**: an `inf_squad` parked 60 s with no enemy in sight; intel
    is 0. Red on `main` (it earns 5).
  - **"a drone on station earns nothing for loitering"**: same with a `recon_drone`. Red on `main`.
  - **"each enemy pays once when first identified"**: two enemies come into sight; intel is 20.
  - **"losing and re-identifying an enemy pays nothing"** (D3).
  - **"a completed objective pays 25; a failed one pays nothing"** (D5).
  - **"`completeObjective` pays like an internal completion"**.
  - **"suspected contacts pay nothing"**: only `level: 'identified'` counts.
  - **"side 1 identifying side 0 pays the player nothing"**.
  - **"an identification with no observer pays nothing"**: a drone sweep's `reveal`, and a pre-marked
    carry-over spawn, both emit `contact` `identified` with `observer: -1` (ruled 6 Oct, D3).
  - *(6 Oct: one existing test pins the trickle and goes red by design at Step 2: `mission.test.ts`'s
    "a loitering drone earns intel; a parked rifle squad earns none" in
    `describe('intel: earned by watching, spent on certainty (GDD §3)')`. Rewrite it to the new
    rule; do not delete it. "a buried drone observes nothing and earns nothing" stays green, but its
    "a surface drone would have banked 2 intel" comment becomes false. A fixture that stands for
    infantry needs `role: 'infantry'`: `m_squad` has none and never braces.)*
- [ ] **Step 2: Implement.** Delete `INTEL_PER_MIN_DRONE`, `INTEL_PER_MIN_SCOUT` and the accrual loop
  in the income block, and rewrite the comment above them. Read the `contact` events already passed
  into `step` (`simEvents`), side 0, level `identified`, target side 1, unseen in `paidIdentified`.
  Pay objectives where `creditContribution` is called, both call sites.
  *(6 Oct: the existing `identified` branch at the top of `step` filters exactly this; it is the
  place to hang the pay. `sim.identifyTo` also emits `contact` `identified`, with `observer: -1`,
  for a drone sweep's `reveal` and for a pre-marked carry-over spawn. Ruled 6 Oct: neither pays, so
  the rule also requires `observer >= 0`. `intelEarned` must join `MISSION_EVENT_KINDS` (`mission.ts` ~L379), or the
  `MissionEventKindsAreExhaustive` check fails `typecheck`.)*
- [ ] **Step 3: Re-pin the economy pin, once.** The commit message says: *"economy pin re-pinned:
  intel now accrues from first identification and objective completion instead of per minute
  (G3 Q1, lead 4 Oct); was N"*. Dated comment above the number.
- [ ] **Step 4: Measure.** Sim pins unmoved. `balance` identical. `playtest` byte-identical on every
  existing line (R, Global Constraints). If any line moves, the cause is a plan that spends intel
  somewhere nobody found; stop and report it.
- [ ] **Step 5: See it red.**
  - Re-add `intelPerMin += INTEL_PER_MIN_SCOUT` for a stationary scout: "a stationary scout earns
    nothing" fails.
  - Drop the `paidIdentified` check: "re-identifying pays nothing" fails.
  - Pay on `level !== 'lost'`: "suspected contacts pay nothing" fails.
  - Pay in the `failed` branch: "a failed one pays nothing" fails.
  - Drop the `observer >= 0` check: "an identification with no observer pays nothing" fails.

---

## Task 4: high ground, as a pure function

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** none (parallel with Task 3).

**Files:** `packages/sim/src/intel-earn.ts` (new) and `intel-earn.test.ts` (new).

**Interfaces:**

```ts
/** The median elevation of open (unblocked) tiles, lower median on an even count. Integer. */
export function medianOpenLevel(elevation: Uint8Array, blocked: Uint8Array): number;
/** One id per tile (-1 = not high ground): 4-connected components of open tiles at
 *  >= median + HIGH_GROUND_LEVELS. Deterministic order: ids assigned in row-major scan. */
export function highGroundRises(elevation: Uint8Array, blocked: Uint8Array,
  w: number, h: number): { riseOf: Int16Array; count: number };
```

- [ ] **Step 1: Write the failing tests**, each with a hand-drawn grid as literals (the oracle takes
  literals, not the code under test's own arguments: CLAUDE.md, "the independent oracle"):
  - a flat map (an all-zero `elevation`, which is what `Sim` holds for a map with no grid) has 0 rises;
  - a 3x3 plateau at median + 2 is one rise of 9 tiles;
  - a plateau at median + 1 is no rise (eye level, D4);
  - two plateaus joined only diagonally are two rises;
  - a `^` tile at the top of a hill is not part of the rise (blocked);
  - the shipped maps: every map in `data/maps/` with a non-zero `elevation` grid reports a rise
    count printed and pinned in the test, read on first run (R: unknown today), and every flat map
    reports 0. On `main` at `b44df7aa` that is **21 relief maps** (`beit_sahwan_2`, `beit_sahwan_4`,
    `deir_amun`, `deir_amun_2`, `deir_amun_3`, `khan_rafid_2`, `qarn_hadid`, `qarn_hadid_2`,
    `qarn_hadid_3`, `tel_marum`, `tel_marum_1`, `tel_marum_2`, `tel_marum_3`, `umm_zeitoun`,
    `umm_zeitoun_2`, `umm_zeitoun_3`, `umm_zeitoun_4`, `wadi_halam_2`, `wadi_halam_3`,
    `wadi_halam_4`, `wadi_halam_5`; levels reach 9 on six of them) and **12 flat**
    (`beit_sahwan_3`, `beit_sahwan_outskirts`, `khan_rafid`, `khan_rafid_3`, `marj_perimeter`,
    `tutorial_ground`, `wadi_halam_basin`, and the five `tile_*` maps). This plan first named four
    relief maps and "the five flat maps"; at `067fab9a` there were 10 and 16. Read the list from the
    directory, not from this paragraph (CLAUDE.md, "It measured one file").
- [ ] **Step 2: Implement.** Counting sort for the median (levels are 0-9). An explicit stack for the
  flood fill, no recursion.
- [ ] **Step 3: See it red.**
  - `>= median + 1` instead of `+ 2`: "median + 1 is no rise" fails.
  - 8-connected neighbours: "joined only diagonally are two rises" fails.
  - Skip the blocked test: "a `^` tile is not part of the rise" fails.

---

## Task 5: high ground pays

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Tasks 3, 4.

**Files:** `packages/sim/src/mission.ts` and its test, `tuning.ts` (`INTEL_PER_RISE`,
`HIGH_GROUND_LEVELS`, `HIGH_GROUND_HOLD_TICKS`).

- [ ] **Step 1: Write the failing tests:**
  - **"a unit standing 10 s on a rise pays 30 once"**;
  - **"leaving at 9.95 s pays nothing; returning restarts the count"**;
  - **"an enemy inside the contest radius stops the count"** (reuse `CONTEST_RADIUS_SQ`, the hold
    rule's own number);
  - **"a buried unit earns nothing on a rise"** (the `tunnelIn` guard the old loop had);
  - **"a drone over a rise earns nothing"**: holding ground is a ground act (`isAir` skip), the same
    rule #279 ruling (a) gives shepherding (ruled 29 Sep; its sim half is the Stage 4 sim-fixes
    plan's, not on `main` at `b44df7aa`);
  - **"a second unit on a paid rise pays nothing"**.
  - *(6 Oct, #402, ruled 6 Oct.) Put the test's unit on the rise with a move, then `hold` (Hold
    position, `2026-10-06-hold-position.md`, which lands before F1). An `attackMove` leaves
    `attackMove` set, and an arrived attack-mover with nothing inside effective range walks toward
    any identified enemy it cannot reach (`stepSweep`). So the contest test's enemy, if identified
    and out of reach, would walk an attack-moved holder off the rise, and the test would measure the
    closing rule instead. Pin both sides of that as decisions:*
    - **"an attack-mover that identifies an enemy out of reach leaves the rise and is not paid"**;
    - **"a held unit stays on the rise and is paid"**.
  - **"a unit that spawned on a rise earns nothing standing there"**: the ruling of 6 Oct, D4. It
    pays only after it leaves and moves back on. Track per unit, runtime-only, whether it has
    stepped onto the rise since spawning.
- [ ] **Step 2: Implement.** Rises computed once in the constructor from `sim.elevation` and the
  blocked mask. Per tick, one pass over `playerIds`: tile → rise id → a per-rise hold counter
  (`Int32Array(count)`), reset when no qualifying unit stands on it. The economy hash covers the
  counters and the paid set.
- [ ] **Step 3: Measure.** The economy pin does **not** move: the Task 1 fixture is on a flat map.
  That is correct, and it is also a blind spot. Add a second economy fixture on `tel_marum`,
  `ECONOMY_PIN_RELIEF`, born in this commit (a new pin, so not a re-pin), and its coverage assertion
  "at least one rise paid". (`tel_marum`, the sandbox map, is unchanged in kind at `b44df7aa`:
  relief 0-4. The same #402 order rule as Task 1's fixture applies.)
- [ ] **Step 4: See it red.**
  - Count a unit standing on its spawn rise: "a unit that spawned on a rise earns nothing" fails.
  - Remove the `isAir` skip: "a drone over a rise earns nothing" fails.
  - Pay on every tick of the hold instead of once: "pays 30 once" fails.
  - Drop the contest check: the contest test fails.

---

## Task 6: the mortar barrage, in the sim

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Task 2.

**Files:** `packages/sim/src/sim.ts`, `packages/sim/src/tuning.ts`,
`packages/sim/src/fire-support.test.ts` (new), `packages/sim/src/determinism.test.ts`.

**Interfaces:**

```ts
// tuning.ts
export interface FireSupportProfile { rounds: number; spacingTicks: number; delayTicks: number;
  scatter: Fx; damage: Fx; splash: Fx; suppression: Fx; payload: 'he' | 'smoke' }
export const FIRE_SUPPORT: readonly FireSupportProfile[]; // index 0 = air_strike (today's constants, byte for byte)
export const FS_AIR_STRIKE = 0, FS_MORTAR_BARRAGE = 1, FS_SMOKE_SCREEN = 2;
// sim.ts
| { kind: 'callStrike'; caller: number; x: Fx; y: Fx; profile?: number } // absent = FS_AIR_STRIKE
private pendingStrikes: { x: Fx; y: Fx; by: number; readyTick: number; profile: number }[];
```

- [ ] **Step 1: Write the failing tests:**
  - **"an air strike is unchanged"**: the same seed, caller and point, with `profile` absent and
    with `FS_AIR_STRIKE`, give identical `strike` events, damage and hash to `main`'s behaviour.
    Literal expected damage at a literal distance, not a value read from `FIRE_SUPPORT`.
  - **"a barrage lands N rounds, spaced, after the delay"**: event ticks equal literal expectations.
  - **"barrage scatter comes from the caller's stream"**: the caller's `rng` cursor advances by
    exactly 2 draws per round; a bystander's cursor does not move.
  - **"a dead caller's barrage still lands what was already queued, and queues nothing new"**:
    rounds are queued at call time, so the answer is "all of them land". State it as a test so it is
    a decision, not an accident.
  - **"a barrage round damages structures and charges ROE through `by`"**.
  - *(6 Oct, #402: what a barrage does to infantry that halts to fire, all from code on `main`.
    Kneeling changes no hit, exposure, signature or cover factor, and `applyDamage` reads no brace
    state, so round damage against a kneeler equals damage against the same man standing.
    `stepStrikes` applies suppression with `coverProtects = false`. A pin (`PIN_AT`, 0.70) freezes
    the brace machine, state and clock (`stepBrace`), so a man caught dropping or rising stays so;
    a soft unit pinned for `ROUT_AFTER_TICKS` (200, 10 s) routs, gets up (paying `KNEEL_RISE_TICKS`)
    and runs. A test fixture of in-test riflemen needs `role: 'infantry'` to see any of this.)*
- [ ] **Step 2: Implement.** `callStrike` queues `rounds` entries at
  `tickCount + delayTicks + i * spacingTicks`, each with its own scatter pair. `stepStrikes` reads
  damage, splash and suppression from the entry's profile. `hash()` adds
  `hashWord(h, s.profile)` inside the existing loop.
- [ ] **Step 3: Hash coverage.** **"the strike profile is hashed"**: two sims identical but for one
  pending entry's profile hash differently. Then measure both sim pins: **unmoved** (the loop is empty
  in both replays). If either moves, a replay fires a strike and the pins move for that reason only;
  stop and raise it, because that would make this the plan's sim re-pin and the commit must say so.
- [ ] **Step 4: See it red.**
  - Hash `s.x` twice instead of `s.profile`: "the strike profile is hashed" fails.
  - Draw scatter from `this.rng.nextU32(0)`: "comes from the caller's stream" fails.
  - Index `FIRE_SUPPORT[1]` for an absent profile: "an air strike is unchanged" fails.

---

## Task 7: the smoke screen, in the sim

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Task 6.

**Files:** `packages/sim/src/sim.ts`, `fire-support.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - **"a smoke round lays the same grid a laid screen does"**: after a `smoke_screen` round lands,
    the smoke density around the impact equals what a `smoke` command from a carrier lays at that
    point (the same code path, so one function, called twice).
  - **"a smoke round does no damage and no suppression"**.
  - **"a smoke round breaks a sight line"** (`losRay` through the screen), the reason it exists.
  - **"smoke screen needs no carrier"**: it works with no `smoke`-capable unit on the field, which is
    what separates it from the unit ability.
  - *(6 Oct, #402: a smoke round is not cover. `coverLevelOf` reads tile cover and parapet only, so
    a band target standing in thin smoke still counts as in the open: attack-movers bound against
    it rather than close on it. Smoke works through sight instead: a line through
    `SMOKE_BLOCKS_AT` (320) of density is blocked (`losRay`), and below that each smoky tile only
    multiplies hit chance by `SMOKE_HIT_MULT` (0.55). A screened target is not selected, and an
    arrived attack-mover with no target then walks toward it if it is still identified.)*
- [ ] **Step 2: Implement.** Extract the grid stamp from the `smoke` command branch into a private
  method; the payload `'smoke'` in `stepStrikes` calls it and skips damage.
- [ ] **Step 3: Measure.** Both sim pins unmoved; the extraction is behaviour-preserving, and the
  existing smoke tests (`smoke.test.ts`, `tools/src/tel_marum_smoke.test.ts`) pass unchanged.
  `pnpm balance` byte-identical too: `urbanSmokeStep` (`tools/src/backtest/targets.ts`) issues the
  `smoke` command whose stamp this extracts, and since #402 its max-tier 2:1 + smoke cell reads 97%
  on the gate's seeds against a 90% floor (spec `2026-10-05-infantry-halt-to-fire.md` §6), the
  nearest canary to a stamp that changed.
- [ ] **Step 4: See it red.** Skip the `payload === 'smoke'` branch (treat it as HE): "no damage"
  and "breaks a sight line" fail.

---

## Task 8: the runtime menu

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Tasks 6, 7.

**Files:** `packages/sim/src/mission.ts` and its test, `packages/sim/src/index.ts`,
`packages/app/src/main.ts` (`requestSweep`/`requestStrike` at ~L3204),
`packages/app/src/ui/production.ts` and `production.test.ts` (call sites only; the test imports
`SupportKind` and spells `'sweep'`/`'strike'` throughout).

**Interfaces:**

```ts
export type SupportKind = 'smoke_screen' | 'mortar_barrage' | 'drone_sweep' | 'air_strike';
export const FIRE_SUPPORT_KINDS: readonly SupportKind[];
/** One entry for all four. Same rules as today's two: not ended, affordable, and
 *  (for the three that fire) a living surface caller who owns the ROE bill. */
requestSupport(kind: SupportKind, x: Fx, y: Fx): boolean;
supportCost(kind: SupportKind): number;
// requestSweep / requestStrike stay as one-line wrappers until S-F removes the callers.
```

- [ ] **Step 1: Write the failing tests:**
  - each kind deducts its approved price and queues its command;
  - each refuses when short by 1 intel, and deducts nothing;
  - a barrage and a smoke screen refuse with no living surface caller, like the strike;
  - the drone sweep needs no caller (today's sweep does not);
  - `requestSweep`/`requestStrike` behave exactly as before (wrapper tests).
  - *(6 Oct, #402: a sweep's `reveal` identifies through `sim.identifyTo`, and since #402 an
    arrived, idle attack-mover walks toward the nearest identified enemy it cannot reach, so a
    sweep now also sets the player's idle attack-movers walking. Before #402 they waited until the
    contact decayed. Ruled 6 Oct: accepted. Pin it here as **"a drone sweep sets idle attack-movers
    walking toward what it reveals"**, with its control **"a held unit is not moved by a sweep"**.
    Hold position is the player's counter.)*
- [ ] **Step 2: Implement.** `app`'s `SupportKind` (`ui/production.ts`, `'sweep' | 'strike'`) is
  renamed to import the sim's; the dock keeps two buttons until S-F builds the menu. `typecheck` must
  pass at this commit.
- [ ] **Step 3: Measure.** Economy pins unmoved (no fixture calls support). `pnpm validate:ui` clean
  (no new strings yet).
- [ ] **Step 4: See it red.** Swap two prices in the cost table: the per-kind deduction test fails.

---

## Task 9: the probe becomes a gate, and one plan spends intel

**Model:** sonnet. **Agent:** `playtest`. **Depends:** Tasks 3, 5, 8.

**Why.** The G3 sheet measured the defect with a throwaway probe. A probe that lives in a scratchpad
cannot catch the trickle coming back. And no plan has ever called a sweep or a strike (M, G3 sheet),
so "sweep and strike affordable where they are designed to be" (the Stage 4 exit line) is
unproven by construction.

**Files:** `tools/src/backtest/playtest.ts`.

- [ ] **Step 1: The intel table.** After each run, print `intel earned` (end minus `intel_start`)
  beside the existing line, for winning plans and passive controls alike. Then two gates in the
  `LADDER_CREDITS` idiom (`!==`, `console.error`, `process.exitCode = 1`):
  - **`INTEL_PASSIVE_BEATS_WINNER = 0`**: the count of pairs where the passive control earned more
    than the winning plan.
  - **`INTEL_WINNERS_ONE_SWEEP`**: the count of winning plans earning at least one drone sweep (150),
    pinned at the number Task 2 measured (R: 24 of 26 at 10 + 25, M on the G3 probe at `751b6742`,
    before GH-382 and #402).
  - *(6 Oct: the denominators have not moved: `playtest.ts` at `b44df7aa` still runs 26 winning
    plans (label equal to the mission id) and 23 passive/no-orders controls, so the pairs gate counts
    over 23 and the sweep gate over 26. The numerators are Task 2's to read; the G3 "24" and "22"
    are priors from old ground and the pre-#402 fight.)*
- [ ] **Step 2: One plan spends.** Pick the mission Task 2's arrival-time column says reaches 150
  earliest without `intel_start` (R: a clearance). Add one `requestSupport('mortar_barrage', …)` or
  `'drone_sweep'` call to its plan where the briefing promises one. The plan must still win. Its line
  may move (duration, ROE); `LADDER_CREDITS` moves only if its grade or credits move. If it does, the
  re-pin is part of this plan's ladder re-pin and named in its comment.
  *(6 Oct: no mission's text names a sweep or a strike, at `b44df7aa` or at `067fab9a` (census of
  every string in `data/missions/*.json`), so "where the briefing promises one" has no answer in
  the data: place the call by the plan's own geometry and say why in a comment. A drone sweep here
  also sets the plan's idle attack-movers walking toward what it reveals (#402), which can move
  more of the line than duration and ROE. `LADDER_CREDITS` is 5830 on `main`.)*
- [ ] **Step 3: See it red.**
  - Restore the stationary-scout term on a scratch copy of the runtime: `INTEL_PASSIVE_BEATS_WINNER`
    fails, naming at least `khan_rafid_3_clearance` (M at `751b6742`: passive 189 vs winner 20 on the
    trickle; that mission is on new ground since GH-382, so the names the red line prints are
    today's reading, not this list).
  - Delete the support call's `requestSupport` return check and pass an unaffordable kind: the plan
    still wins but the spend line reads `refused`; assert the line says `ok`.

---

## Task 10: the contract, the briefings, the ledger

**Model:** haiku for the census, sonnet for the prose. **Depends:** Tasks 3–9.

**Files:** `docs/GDD.md` §3, `docs/campaign/README.md` (the contract the design agents write
against; the dated digest beside it, `docs/campaign/research-2026-09-03.md`, stays dated and is not
edited), every mission JSON whose briefing names "satellite sweep", "precision strike" or an intel
rate (census first; text only), `docs/HANDOVER.md`. *(6 Oct: `data/locales/` holds only
`README.md`; no `data/locales/<lang>/missions.json` overlay exists, at `b44df7aa` or at `067fab9a`.)*

- [ ] **Step 1: Census.** `grep -il "sweep\|strike\|intel" data/missions/*.json`. List each hit and
  whether it is still true. *(6 Oct: that grep hits 22 files on `b44df7aa`, almost all on the
  ledger key `intel.marked_positions` and the `intel_start` field; exclude them. Over every string in every mission, the only
  player-facing hit is `wadi_halam_3_counterraid`'s "Intel puts the local commander at the north
  hide", in `briefing` and `briefing_sections[0]`: narrative, and still true.)*
- [ ] **Step 2: Rewrite** only what is now false: "satellite sweep" becomes "drone sweep"; any line
  that says scouts "earn intel by watching" is false. Mission text only; no field changes.
  `pnpm validate:data` must pass. It runs `tools/validate_briefing.mjs` (GH-119): every mission
  carries `briefing_sections`, whose texts joined with one space must equal `briefing` exactly, so
  an edit to a briefing edits both the `briefing` string and the matching section's `text`.
- [ ] **Step 3: GDD §3.** The earn rule (three causes, no per-minute term), the four-item menu with
  the approved prices, and the lead's ruling that intel is not an information currency.
  (§3's "Intel: drone loiter ~8/min, scout team in position ~5/min, SIGINT structure ~12/min" line
  is the one that becomes false.) `docs/campaign/README.md`: the same, in the contract the design
  agents write against; its "drones and stationary markers earn it" paragraph also says "Only 6 of
  14 shipped missions declare any economy", which is stale too (18 of 27 declare `resources` at
  `b44df7aa`).
- [ ] **Step 4: The ledger.** `docs/HANDOVER.md` §1, §3 (the dropped `intel_rate_per_min`, D1–D7), §4.

---

## Re-pins (F5)

| pin | expected | the reason, for the commit |
|---|---|---|
| sim pins, flat and relief | **unmoved** (R): `922714084` / `3200430224` on `main` at `b44df7aa` (`2109596329` / `1425295494` at `067fab9a`; #402 moved both), or whatever #291 re-pins them to. A move is a defect | — |
| `ECONOMY_PIN` | **born** in Task 1, **re-pinned once** in Task 3 | intel accrues by first identification and objective completion, not per minute (G3 Q1) |
| `ECONOMY_PIN_RELIEF` | **born** in Task 5 | a new guard for the rise term; not a re-pin |
| `pnpm balance` | byte-identical (R) | — |
| `pnpm playtest` | every existing line byte-identical (R), except the one plan Task 9 makes spend | new printed intel lines and two new gates |
| `LADDER_CREDITS` | unchanged (R) at **5830** (`main` `b44df7aa`; 5736 at `067fab9a`, moved by GH-382 and #402); re-pinned in Task 9 only if the spending plan's credits move, with the term named, and `CAMPAIGN_CREDITS` (`packages/app/src/ui/stores-model.ts`) with it, which `tools/src/campaign_credits.test.ts` holds equal | |

## Lane A needs (WP-S-F #184)

F1 lands sim and runtime only. The player cannot use the new menu until S-F builds it:
- **The four-item fire-support menu** in place of the dock's two buttons, prices from
  `supportCost`, armed and cancelled like today's (Escape disarms, #264).
- **Charge timer and announcement** for each call (GH-113): "barrage inbound, 6 s". No fireworks.
- **The intel counter at a legible size** (GH-77), and a throttled feed line from `intelEarned`
  events ("+10 intel: enemy identified"; "+30 intel: high ground taken"). Feed and HUD only: **no
  world mark** for a paid rise (lead, "no status marks in the world").
- **Strings through `t()`** for every new label, and the pseudo capture pass to find the ones that
  slip (CLAUDE.md, i18n).
- **Chrome that F1 makes false** (found in the 6 Oct refresh; present at `067fab9a` too):
  `packages/app/src/i18n/en.json`'s `hud.card.cap.markTarget` ("earns intel while stationary"),
  `hud.hint.first.sniper` ("earns intel while it sits still"), and `dock.note.noIntel` ("watch
  longer") after Task 3; `dock.support.sweep.name` ("Satellite sweep") after Task 8's rename. They
  read wrong from the day F1 lands until S-F replaces them.
- **The tutorial's economy step** (execution plan dependency 5) against this earn rule.
