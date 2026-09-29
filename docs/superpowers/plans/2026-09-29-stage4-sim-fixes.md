# Stage 4 sim fixes (GH-279 sim half, GH-291; GH-280 by reference). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two sim fixes that can start on day one of Stage 4, when the sim unfreezes.

| issue | what changes | owner | golden hash |
|---|---|---|---|
| **#279, sim half** | Only GROUND units walk families out. In a mission with no `evacuate_before`, families flee only under fire. | this plan, Tasks 1–3 | **unmoved** (measured) |
| **#291** | A routed unit with no known threat flees away from the last HOSTILE fire, or holds. The −x default goes. | this plan, Task 4 | **moves once**, both pins, for new hashed arrays only |
| **#280** | Garrison suppression cover, as an opt-in `aura.garrison.supp_cover` field. | **Field works plan, Task 1** (lead ruling, 29 Sep) | unmoved |

**Architecture:**
- **#279 is one flag and one type test in `CivilianFlight.step`.** The rule object takes a
  `shepherd` option, which `MissionRuntime` sets from its own objectives. The sandbox sets it to
  `true`, because `&civ` synthesises an evacuation. Air units are skipped in the shepherd loop. The
  app's flee notice (`ui/civ-flight.ts`, #281) reads the same predicate, so its cause-by-elimination
  stays true.
- **#291 adds three per-unit columns** (`suppFromX`, `suppFromY`, `suppFromSet`). `applySuppression`
  writes them when the source is hostile. `startRout` reads them only in the branch that today falls
  back to −x.
- **Neither fix draws a random number.** No `rng(entityId)` stream moves, and each fix is Q16.16 end
  to end.

**Tech stack:** TypeScript strict, vitest. No new dependencies.

**Refs:**
- #279, with the lead's rulings of 29 Sep: (a) only ground units move families; (b) with no
  evacuation objective, families flee only under fire.
- #291, and its report `detect-report.md` (session scratchpad) with the runtime patch `fix-sim2.mts`.
- #280, with the lead's ruling of 29 Sep: field works only.
- `docs/superpowers/plans/2026-09-29-field-works.md` (branch `docs/fw-plan`): Task 1 (#280) and
  Task 2 (the FW hash re-pin).

**Base:**
- Measured against `main` `e3bf7484`.
- Branch `fix/stage4-sim`, cut from `main` at Stage 4 kickoff. Use a worktree under
  `/Users/ilpinto/dev/roaring-lions-ep/`, and run `pnpm install` once in it.
- Locate code by symbol. The line numbers below are at `e3bf7484` and will drift.

**Probe copies.** Every number below was measured headless on patched copies of `e3bf7484`, never
on tracked files. They live in the session scratchpad under `s4probes/`: `base`, `f2ab` (#279),
`f291` (#291), `f2pD` (#279 + #291 + the Tel Marum I plan edit), `all3`, and the `playtest-*.txt`,
`balance-*.txt`, `flights-*.txt` and `e5-*.txt` outputs.

**Order and the gates:**
1. **Task 1** (the Tel Marum I plan edit) lands first. It is byte-identical on today's sim
   (measured), so it is green on its own.
2. **Task 2** (#279 sim) lands next, and **Task 3** (the app notice) follows or joins it in one PR.
3. **Task 4** (#291) is independent of Tasks 1–3. It is the **first** golden re-pin of Stage 4; see
   "Re-pin order across streams".
4. **Task 5** is the ledger.

---

## Decisions

- **By the lead, 29 Sep:**
  - #279 (a) and (b) as above.
  - #280 is field works only, and FW owns it.
  - The sim keeps running behind the end card.
- **Taken defaults (confirm or overrule):**
  - **D1. Rule (b) is static per mission.** Shepherding is on when the mission declares any
    `evacuate_before`, primary or secondary. It stays on after that objective completes or fails.
    That matches the ruling's wording, "missions with NO evacuation objective".
  - **D2. The sandbox shepherds.** `&civ` counts evacuations into a synthesised refuge zone, and it
    exists to walk the whole civilian loop.
  - **D3. Boarding also skips air units.** This is hash-neutral today: none of the five air types
    (`recon_drone`, `attack_drone`, `heli_peten`, `loiter_drone`, `paramotor`) declares
    `transport_slots`. It keeps "only ground units move families" to one rule.
  - **D4. `umm_zeitoun_4_clearance` keeps its plan.** See Task 1, Step 3.

---

## Global Constraints

- **The four invariants hold.**
  - No floating point in `packages/sim/src`, and no `eslint-disable` there.
  - Tests may use `Math` as an oracle.
  - Neither fix adds an `rng` call.
  - The sim imports nothing. The app may import the new `missionShepherds` from `@lions/sim`
    (`app → sim`).
- **Golden hash (`packages/sim/src/determinism.test.ts`, flat `2109596329` and relief
  `1425295494`):**
  - Tasks 1–3 leave both pins **unmoved**. This was measured on `f2ab`: 11 of 11 pass. A move
    there is a bug to find, never a re-pin.
  - Task 4 moves **both** pins **once**, in its own commit, with a dated comment. The only reason is
    the three new hashed columns. Removing their three `hashArray` lines must give back both old
    values (measured on `f291nh`: 11 of 11 pass).
- **`pnpm balance`** stays exit 0 with every target passing.
  - Tasks 1–3 cannot move it: `targets.ts` spawns no civilians and no mission.
  - Task 4 moves exactly one printed number: base urban 2:1, **63% → 62%**. Max tier is unchanged
    (measured on `f291` and `all3`).
- **`pnpm playtest`** stays exit 0.
  - **`LADDER_CREDITS` 5849 and every `GATES` line are unchanged by every task** (measured on
    `f2pD`).
  - The only printed lines that move are two `umm_zeitoun_4_clearance` lines, where
    `get_the_porters_clear` goes from `c` to `a` (Task 2).
  - Task 4 is byte-identical (measured on `f291`).
- **Every check is seen red.** Each task names the mutation that must turn a named test red, and
  the commit message quotes the red line.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test:determinism && pnpm test`,
  then `pnpm balance` and `pnpm playtest`. Add `pnpm validate:ui` when the app changes (Task 3).
  Report what the commands printed.
- **Strict TypeScript.** No `any`, and no non-null assertions in sim code. Tests are colocated as
  `*.test.ts`.
- **Git.**
  - Stage explicit paths only: `/usr/bin/git commit -s -F <msg> -- <paths>`. Never `-A`, and never
    `git checkout -- <file>`.
  - Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - The lead merges. Never `pkill` vite.

---

## File structure

| File | Role | Task |
|---|---|---|
| `tools/src/backtest/playtest.ts` | The Tel Marum I plan gains a ground shepherd; the Umm Zeitoun IV plan's comment is corrected | 1, 2 |
| `docs/campaign/tel_marum/script-losable.md` | §2's "the drone's first waypoint starts them walking" corrected | 1 |
| `packages/sim/src/civilians.ts` (+ `civilians.test.ts`) | `CivilianFlightOptions`, `missionShepherds`, the ground-only and fire-only rules | 2 |
| `packages/sim/src/mission.ts` (+ `mission.test.ts`) | `civFlight` built in the constructor from `missionShepherds` | 2 |
| `packages/sim/src/index.ts` | Exports `missionShepherds` and `CivilianFlightOptions` | 2 |
| `packages/app/src/main.ts` | The sandbox's `new CivilianFlight({ shepherd: true })` (Task 2, for `typecheck`); `new CivFlightWatch({ shepherds })` (Task 3) | 2, 3 |
| `packages/app/src/ui/civ-flight.ts` (+ test) | `CivFlightWatchOptions`: a mission that does not shepherd has only one cause | 3 |
| `packages/sim/src/sim.ts` | `suppFrom*` columns, `applySuppression` source, `startRout` order, `state` view, `hash()` | 4 |
| `packages/sim/src/rout.test.ts` | **New.** The #291 tests | 4 |
| `packages/sim/src/determinism.test.ts` | The re-pin, and three hash-coverage tests | 4 |
| `docs/campaign/special_units/e5/numbers.md` | The 8-tile non-claim row, and the "not investigated" finding resolved | 4 |
| `docs/HANDOVER.md` | The ledger | 5 |

---

## Task 1: Tel Marum I gets a ground shepherd (lands first)

**Model:** sonnet. **Agent:** `playtest`.

**Why.** `tel_marum_1_recon` wins its primary `clear_the_valley_floor` (evacuate 2 by 300 s) by a
drone flyby. At t=4 s the drone is ordered to `[24, 25]`, which is within 4 tiles of the herders
at `[21, 24]`. `script-losable.md` §2 records this as the mechanism. Under ruling (a), the
shipped plan goes **DEFEAT in 5.0 min, 0 stars, credits 0**. That costs the ladder 200 credits
(5849 → 5649) and fails the `scout_shachaf` and `apc_kipod` gates, at 28 and 42 stars (measured
on `f2ab`).

**Files:** `tools/src/backtest/playtest.ts` (the `tel_marum_1_recon` plan and its comment);
`docs/campaign/tel_marum/script-losable.md` (§1's table row for I, and §2's order table row for
t=4).

- [ ] **Step 1: The edit.** In the `at(4, …)` block, split the foot:

```ts
// was: sim.queueCommand({ kind: 'move', ids: foot, ...M(23, 31) });
sim.queueCommand({ kind: 'move', ids: foot.slice(1), ...M(23, 31) });
// One squad walks the herders out. (22, 27) is 3.0-3.4 tiles from all three
// herders (SHEPHERD_RADIUS_SQ is 4 tiles), and outside tm_spotter_west's sight 9.
sim.queueCommand({ kind: 'move', ids: [foot[0]], ...M(22, 27) });
```

  Rewrite the comment above it. The drone no longer moves anyone, and a ground unit must shepherd.
- [ ] **Step 2: Measure on today's sim.** `pnpm playtest` must be **byte-identical** to `main`.
  Measured on `basepD`: it is. The drone already starts the herders walking at t≈4–16 s, so the
  squad arrives after them and changes nothing.
- [ ] **Step 3: Measure on the Task 2 sim**, a local stash, never committed. Expect
  `tel_marum_1_recon: VICTORY in 0.9 min, ROE 100, stars 2 … clear_the_valley_floor=c`, with
  credits 200, the max-tier line unchanged, the ladder 5849 and every gate green (measured on
  `f2pD`). Record the shepherd variants tried, so the next author does not repeat them:
  - `M(22, 27.5)` passes, at 3.5–3.8 tiles.
  - `M(21.5, 28)` **fails**: 4.03 tiles to the nearest herder, just outside the radius.
  - The `jeep_shoded` at `M(22, 27.5)` **fails**. Two herders board it (2 slots) and ride nowhere,
    because nothing drives the jeep home, and only 1 reaches `muster_ground`. A transport shepherd
    must be ordered to the refuge.
- [ ] **Step 4: The doc.** In `script-losable.md`, the row for I and the t=4 order row say the drone
  starts the herders walking. Change both to "the `inf_squad` sent to `[22, 27]` walks them out".
  Cite #279 ruling (a).
- [ ] **Step 5: See it red.** Revert Step 1 on the Task 2 sim. Expect
  `tel_marum_1_recon: FAILED — expected VICTORY, got DEFEAT`.

---

## Task 2: #279, the sim half

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Task 1 on `main`.

**Files:** `packages/sim/src/civilians.ts` and its test, `mission.ts` and its test, `index.ts`,
`packages/app/src/main.ts` (the one sandbox constructor line), and `tools/src/backtest/playtest.ts`
(the `uz4Plan` comment only).

**Interfaces (produced):**

```ts
// civilians.ts
export interface CivilianFlightOptions {
  /** A GROUND player unit within SHEPHERD_RADIUS_SQ walks a family out.
   *  False: families move only under fire (GH-279 ruling b). */
  shepherd: boolean;
}
/** Whether a mission shepherds: it declares at least one `evacuate_before`,
 *  primary or secondary. The one predicate the runtime and the app read. */
export function missionShepherds(objectives: readonly { type: string }[]): boolean;
export class CivilianFlight {
  constructor(opts: CivilianFlightOptions);   // required: every caller decides
  readonly shepherds: boolean;
  // step / collect: signatures unchanged
}
// index.ts
export { CivilianFlight, CIV_FLEE_AT, SHEPHERD_RADIUS_SQ, missionShepherds,
         type CivilianFlightOptions } from './civilians';
```

**The change in `step`** (the first-break branch only; the dead-transport re-order branch is
untouched):

```ts
let leaving = st.suppression[civ] > CIV_FLEE_AT;
if (!leaving && this.shepherds) {
  for (const p of playerIds) {
    if (st.alive[p] === 0 || st.tunnelIn[p] >= 0) continue;
    // An aircraft overhead walks nobody out (GH-279 ruling a).
    if (sim.unitTypes[st.typeIdx[p]].isAir) continue;
    // … distance test unchanged
  }
}
// boarding loop: the same isAir skip (D3)
```

**`mission.ts`.** `private readonly civFlight: CivilianFlight;` is no longer a field initialiser.
The constructor sets it, after `this.mission` is assigned:
`this.civFlight = new CivilianFlight({ shepherd: missionShepherds(mission.objectives) });`.

**`main.ts`.** `const civFlight = civRefuge ? new CivilianFlight({ shepherd: true }) : null;` (D2).
It is in this commit because the argument is required, and `typecheck` must pass at every commit.

- [ ] **Step 1: Write the failing tests.**
  - `civilians.test.ts`:
    - Every existing `new CivilianFlight()` becomes `new CivilianFlight({ shepherd: true })`.
    - Add an `AIR` fixture (`mobility: { speed_tiles_s: 3, domain: 'air' }`, side 0).
    - Add:
      - **"a drone beside a family does not move it"**: the drone is at 1 tile. After `step`,
        `hasFled` is false and after 40 ticks `moving` is 0.
      - **"a soldier beside the same drone still does"**: the control.
      - **"without shepherding, a soldier beside a family does not move it"**.
      - **"without shepherding, fire still does"**: suppression is `CIV_FLEE_AT + 1`.
      - **`missionShepherds`**: `[]` → false; `[{ type: 'hold_for' }]` → false; any list with
        `evacuate_before` → true.
  - `mission.test.ts` ("civilians and ROE"):
    - **"a civilian walks out when a soldier comes within shepherding range"** and **"shepherding
      is issued once…"** have no evacuation objective, so ruling (b) turns them red. Measured on
      `all3`: `expected 786432 to be less than 786432`. Give each world an `evacuate_before`
      secondary on `refuge_zone` plus the `survive_until` primary, with `REFUGE_CTX`, as the
      evacuation tests below them already do. This restores what they test rather than weakening
      it.
    - Add **"with no evacuation objective, a soldier beside a family does not move it"**: the same
      world with no objective. After 40 ticks, `posX` is unchanged.
    - **"spooked civilians flee to the refuge"** has no evacuation and stays as is. It is the fire
      half, and it passes under the change (measured).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Correct the `uz4Plan` comment** in `playtest.ts`, at `at(1, …)`. The comment reads
  "The drone's own presence is enough to start the porters fleeing (CivilianFlight does not filter
  by domain)", and that is now false. Say that the drone no longer moves them, and that
  `get_the_porters_clear` (a secondary) is still active at the 1.7-minute victory. No order
  changes (D4).
- [ ] **Step 4: Measure.** Expect, as measured on `f2pD`:
  - `test:determinism`: both pins **unmoved**.
  - `balance`: identical to `main`.
  - `playtest`: exit 0. Two lines move: `umm_zeitoun_4_clearance` and
    `umm_zeitoun_4_clearance (bought)`, where `get_the_porters_clear=c` becomes `=a`. ROE 92,
    stars 2, credits 237 and the 1.7 minutes do not move. The ladder stays 5849, and every gate is
    unchanged.
  - The re-measures the lead asked for:
    - **`beit_sahwan_3_clearance`**: result, ROE, stars and credits are identical to `main`. Its
      families no longer move at all. On `main` they broke 2 times by drone (base plan), and
      2 by drone plus 3 by ground at max tier. Now there are 0 breaks: the mission has no
      evacuation, and nothing fires on them.
    - **`umm_zeitoun_4_clearance`**: as above. Its porter breaks go from 4 by drone to 1 by fire
      and 3 by ground; max tier goes from 4 by drone to 3 by fire and 1 by ground.
  - Across the whole `playtest` run, breaks go from **201 (154 ground, 25 fire, 22 drone)** to
    **194 (164 ground, 30 fire, 0 drone)**, Task 1's edit included.
- [ ] **Step 5: See it red.**
  - Delete the `isAir` skip: "a drone beside a family does not move it" fails.
  - Drop `this.shepherds &&`: both "without shepherding" tests and the new mission test fail.
  - Make `missionShepherds` return `true`: the new mission test fails.
  - Make `missionShepherds` return `false`: the two re-authored mission tests fail.

---

## Task 3: #279, the app half. The flee notice follows the rule

**Model:** sonnet. **Depends:** Task 2 (`missionShepherds`).

**Why.** `CivFlightWatch` (#281) decides the cause by elimination: "the rule has exactly two
triggers, so not-suppressed means a soldier was close". After Task 2, a mission with no evacuation
has only one trigger. The watch must know that, or a misread tick would say "your troops are
close" where troops can move nobody.

**Files:** `packages/app/src/ui/civ-flight.ts` and its test, and `packages/app/src/main.ts`.

**Interfaces:**

```ts
export interface CivFlightWatchOptions {
  /** `missionShepherds(mission.objectives)`, or true in the sandbox (D2).
   *  False: the only cause the rule has is fire. */
  shepherds: boolean;
}
export class CivFlightWatch { constructor(opts: CivFlightWatchOptions) /* … */ }
// observe(): const cause: FlightCause =
//   this.shepherds && !this.suppressedLast.has(c.id) ? 'troops' : 'fire';
// main.ts
const civWatch = refugeAt
  ? new CivFlightWatch({ shepherds: mission ? missionShepherds(mission.objectives) : true })
  : null;
```

- [ ] **Step 1: Write the failing tests** in `civ-flight.test.ts`.
  - Existing cases construct `{ shepherds: true }`, and their expectations are unchanged.
  - Add **"in a mission that does not shepherd, an unsuppressed break is fire"**: it yields
    `alert.civFlight.fire`, tone `warn`.
  - Add **"…and never the troops line"**: a batch of 3 unsuppressed breaks yields one `fire` line.
- [ ] **Step 2: Implement.** Rewrite the header comment's trigger sentence:
  - suppression above `CIV_FLEE_AT`, always;
  - or a living, surface, **ground** player unit within four tiles, and only in a mission that
    declares an `evacuate_before` (`missionShepherds`).

  Keep the one-observation-back rule and its reasoning as they are.
- [ ] **Step 3: Strings.** No change. "your troops are close" stays true, because only ground
  troops move a family now.
  - First Light's briefing says "a family runs for the compound once one of ours is within four
    tiles, or under fire". It stays true: `beit_sahwan_breach` fields no air unit. Leave it: the
    narrative band test pins its length.
  - The Khan Rafid "a soldier is within four tiles" lines stay true as well.
- [ ] **Step 4: See it red.** Ignore `opts.shepherds`: the two new tests fail.
- [ ] **Step 5: Gates.** Common gates plus `pnpm validate:ui`. The visual gate cannot move: the
  golden captures include no flight line.
