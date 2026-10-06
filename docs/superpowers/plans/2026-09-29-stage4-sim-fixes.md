# Stage 4 sim fixes (GH-279 sim half, GH-291; GH-280 by reference). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Changed since 4 Oct

Refreshed 6 Oct against `main` `b44df7aa`. This plan's base is `e3bf7484` (29 Sep), so this list
also covers 29 Sep to 4 Oct. **No number here was re-measured.** Each "measured" figure comes from a
probe copy of `e3bf7484`. Those copies are now empty directories in session `5d1f74e7`'s scratchpad,
and `detect-report.md`, `fix-sim2.mts` and `patch291.py` are gone.

**What landed:**
- **#402, halt and kneel to fire (6 Oct).**
  - The golden pins moved: flat **922714084**, relief **3200430224**. `hash()` now folds `brace`,
    `braceTicks` and `braceClock`, and the replay's `d_rifles` brace.
  - `LADDER_CREDITS` is **5830**: 5849 at this plan's base, 5736 after GH-345, then GH-382 and #402.
  - Base urban 2:1 reads **37%**; Task 4's measured "63% → 62%" is stale.
  - The kneel is **0.2 s, final**: the lead chose it on 6 Oct after 0.3 s failed the smoke gate
    (`KNEEL_DROP_TICKS` and `KNEEL_RISE_TICKS` are both 4).
- **GH-382 (5 Oct): every mission II and later, and Tel Marum I, are on new maps.**
  - On `tel_marum_1`, the herders `[21, 24]` and the drone's first waypoint `[24, 25]` survived.
  - `tm_spotter_west` and `tm_pocket_west` moved, and the drone now holds 30 s before its sweep.
  - Umm Zeitoun IV's porters are at (32.5, 7.5). Its escort is ordered beside them at t=1, and
    the drone no longer goes at t=1 (it follows at t=50).
- **Before 4 Oct:**
  - GH-345: First Light has no dock and no drone.
  - E5: a sixth air type, `heli_peten_gunship`.
  - e1e6e2f6: balance's smoke step.
  - GH-119: every briefing carries `briefing_sections`, which must spell `briefing` exactly.

**New interactions:**
- **#291 × #402: a routed bracer gets up before it runs.** It loses 4 ticks if it was kneeling. In
  the hold branch it stands upright. An in-test type with no `role` derives as wheeled and never
  braces, so the rout fixtures need `role: 'infantry'` (Task 4, Step 1).
- **#279 × GH-382: thirteen missions pair an evacuation with a drone, and eight were re-planned.**
  Tel Marum I may not be the only plan whose evacuation the drone carries (Task 1, Step 3).
- **Tel Marum I's shepherd point `(22, 27)` is now exposed.** It is 9.9 tiles from
  `tm_pocket_west`'s new post, inside its sight and Kornet range 10 (Task 1, Step 1).
- **#280 × #402: no meeting.** Garrisoned units are held at `BRACE_NONE` and fire as before.

### For the lead
1. **An offer, not an assumption: an earlier landing.** #402 was a lead-approved one-off. The rest
   of `packages/sim` stays closed until Stage 4 opens on 2 Nov, so this plan keeps #279 and #291
   there. If the lead wants either earlier, Tasks 1–3 are hash-neutral and Task 4 is the only
   re-pin; nothing in the plan depends on the date.
2. **A holding routed unit stands.** The 6 Oct ruling is that idle infantry kneel everywhere. A
   routed unit in #291's hold branch is idle, but `stepBrace` keeps routed units up. Intended?
3. **L-B and D4 assumed the old Umm Zeitoun IV plan,** where the drone moved the porters at t=1. On
   `main` the escort is the first unit sent to them, so `c → a` may not recur. Re-confirm L-B after
   Task 2's re-measure.

---

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
  Neither file is on disk any more (checked 6 Oct). This plan's text carries everything Task 4 needs.
- #280, with the lead's ruling of 29 Sep: field works only.
- `docs/superpowers/plans/2026-09-29-field-works.md`, on `main` since #277: Task 1 (#280) and
  Task 2 (the FW hash re-pin).
- `docs/superpowers/specs/2026-10-05-infantry-halt-to-fire.md` (#402), for the brace machine that
  Task 4's rout now runs through.

**Base:**
- Measured against `main` `e3bf7484`. Refreshed against `b44df7aa` (6 Oct) without re-measuring:
  see "Changed since 4 Oct".
- Branch `fix/stage4-sim`, cut from `main` at Stage 4 kickoff. Use a worktree under
  `/Users/ilpinto/dev/roaring-lions-ep/`, and run `pnpm install` once in it.
- Locate code by symbol. The line numbers below are at `e3bf7484` and will drift. At `b44df7aa`,
  `startRout` is at sim.ts:3538.

**Probe copies.** Every number below was measured headless on patched copies of `e3bf7484`, never
on tracked files. They lived in the session scratchpad under `s4probes/`: `base`, `f2ab` (#279),
`f291` (#291), `f2pD` (#279 + #291 + the Tel Marum I plan edit), `all3`, and the `playtest-*.txt`,
`balance-*.txt`, `flights-*.txt` and `e5-*.txt` outputs. **Only the empty directories remain**
(session `5d1f74e7`, checked 6 Oct). Make new copies from the Stage 4 branch base to re-measure.

**Order and the gates:**
1. **Task 1** (the Tel Marum I plan edit) lands first. It is byte-identical on today's sim
   (measured at `e3bf7484`; re-measure, Task 1 Step 2), so it is green on its own.
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
  - **D3. Boarding also skips air units.** This is hash-neutral today: none of the six air types
    (`recon_drone`, `attack_drone`, `heli_peten`, `heli_peten_gunship`, `loiter_drone`, `paramotor`)
    declares `transport_slots`. The gunship landed with E5 on 1 Oct, and it does not change the rule.
    The skip keeps "only ground units move families" to one rule.
  - **D4. `umm_zeitoun_4_clearance` keeps its plan.** See Task 2, Step 3, and R3.

---

## Global Constraints

- **The four invariants hold.**
  - No floating point in `packages/sim/src`, and no `eslint-disable` there.
  - Tests may use `Math` as an oracle.
  - Neither fix adds an `rng` call.
  - The sim imports nothing. The app may import the new `missionShepherds` from `@lions/sim`
    (`app → sim`).
- **Golden hash (`packages/sim/src/determinism.test.ts`).** At `b44df7aa`, flat is `922714084`
  and relief `3200430224`. Both were moved by #402 on 6 Oct; at `e3bf7484` they were `2109596329`
  and `1425295494`.
  - Tasks 1–3 leave both pins **unmoved**. This was measured on `f2ab` at `e3bf7484`: 11 of 11
    pass. It still holds by construction, because no golden replay constructs a `MissionRuntime` or
    a `CivilianFlight`. A move there is a bug to find, never a re-pin.
  - Task 4 moves **both** pins **once**, in its own commit, with a dated comment. The only reason is
    the three new hashed columns. Removing their three `hashArray` lines must give back both old
    values: `922714084` and `3200430224` on today's `main` (measured on `f291nh` at `e3bf7484`
    against that commit's values, 11 of 11 pass).
- **`pnpm balance`** stays exit 0 with every target passing.
  - Tasks 1–3 cannot move it: `targets.ts` spawns no civilians and no mission.
  - Task 4: at `e3bf7484`, exactly one printed number moved, base urban 2:1 **63% → 62%**, with max
    tier unchanged (measured on `f291` and `all3`). **That reading is stale.** #402 took base urban
    2:1 to 37% on `main`, and `pnpm balance` has printed the `urbanSmokeStep` rows at both tiers
    since 29 Sep. Re-measure, and record whatever moves.
- **`pnpm playtest`** stays exit 0.
  - **No task may move `LADDER_CREDITS` or any `GATES` line.** `LADDER_CREDITS` is **5830** on
    `main`; it was 5849 at `e3bf7484` (measured on `f2pD`). It is also held equal to
    `CAMPAIGN_CREDITS` in `packages/app/src/ui/stores-model.ts`.
  - At `e3bf7484`, the only printed lines that moved were two `umm_zeitoun_4_clearance` lines, where
    `get_the_porters_clear` went from `c` to `a` (Task 2). GH-382 re-planned Umm Zeitoun IV and
    seven other drone-and-evacuation missions, so re-measure (Task 2, Step 4).
  - Task 4 is byte-identical (measured on `f291` at `e3bf7484`; re-measure).
- **Every check is seen red.** Each task names the mutation that must turn a named test red, and
  the commit message quotes the red line.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test:determinism && pnpm test`,
  then `pnpm balance` and `pnpm playtest`. Add `pnpm validate:ui` when the app changes (Task 3).
  The E5 probes (Task 4, Step 5) have no root script: run them with
  `pnpm --filter @lions/tools e5:probes`. Report what the commands printed.
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
| `docs/campaign/tel_marum/script-losable.md` | "the drone's first waypoint starts them walking" corrected, in three places: §1's `civilians` bullet, §2's table row for I and §6's t=4 order row | 1 |
| `packages/sim/src/civilians.ts` (+ `civilians.test.ts`) | `CivilianFlightOptions`, `missionShepherds`, the ground-only and fire-only rules | 2 |
| `packages/sim/src/mission.ts` (+ `mission.test.ts`) | `civFlight` built in the constructor from `missionShepherds` | 2 |
| `packages/sim/src/index.ts` | Exports `missionShepherds` and `CivilianFlightOptions` | 2 |
| `packages/app/src/main.ts` | The sandbox's `new CivilianFlight({ shepherd: true })` (Task 2, for `typecheck`); `new CivFlightWatch({ shepherds })` (Task 3) | 2, 3 |
| `packages/app/src/ui/civ-flight.ts` (+ test) | `CivFlightWatchOptions`: a mission that does not shepherd has only one cause | 3 |
| `packages/app/src/evacuation.test.ts` | Read only. "First Light's briefing states the flight rule" pins the briefing's two triggers and its length band (385–1225 characters) | 3 |
| `packages/sim/src/sim.ts` | `suppFrom*` columns, `applySuppression` source, `startRout` order, `state` view, `hash()` | 4 |
| `packages/sim/src/rout.test.ts` | **New.** The #291 tests | 4 |
| `packages/sim/src/determinism.test.ts` | The re-pin, and three hash-coverage tests | 4 |
| `docs/campaign/special_units/e5/numbers.md` | The 8-tile non-claim row, and the "not investigated" finding resolved | 4 |
| `docs/HANDOVER.md` | The ledger | 5 |

---

## Task 1: Tel Marum I gets a ground shepherd (lands first)

**Model:** sonnet. **Agent:** `playtest`.

**Why.** `tel_marum_1_recon` wins its primary `clear_the_valley_floor` (evacuate 2 by 300 s) by a
drone flyby. At t=4 s the drone is ordered to `[24, 25]` (marker `drone_0` since GH-382), which is
within 4 tiles of the herders at `[21, 24]`. Both points survived GH-382's re-draw of `tel_marum_1`.
`script-losable.md` §2 and §6 record this as the mechanism, and since GH-382 the plan's own `at(4)`
comment says it too ("the herders, who break for the start line when it passes, walk out behind
it"). Under ruling (a), the shipped plan went **DEFEAT in 5.0 min, 0 stars, credits 0**. That cost
the ladder 200 credits (5849 → 5649 at the time) and failed the `scout_shachaf` and `apc_kipod`
gates, at 28 and 42 stars (measured on `f2ab` at `e3bf7484`). The ladder is 5830 on `main`;
re-measure.

**Files:** `tools/src/backtest/playtest.ts` (the `tel_marum_1_recon` plan and its `at(4)`
comment); `docs/campaign/tel_marum/script-losable.md`, in three places:
- §1's `civilians` bullet ("close to the drone's own first waypoint `[24, 25]`");
- §2's table row for I ("The drone's own first waypoint … already sits within 4 tiles");
- §6's copy-ready order table row for t=4.

- [ ] **Step 1: The edit.** In the `at(4, …)` block, split the foot:

```ts
// was: sim.queueCommand({ kind: 'move', ids: foot, ...M(23, 31) });
sim.queueCommand({ kind: 'move', ids: foot.slice(1), ...M(23, 31) });
// One squad walks the herders out. (22, 27) is 3.0-3.4 tiles from all three
// herders (SHEPHERD_RADIUS_SQ is 4 tiles), and outside tm_spotter_west's sight 9.
sim.queueCommand({ kind: 'move', ids: [foot[0]], ...M(22, 27) });
```

  Rewrite the `at(4)` comment, which says the herders "break for the start line when it passes".
  The drone no longer moves anyone, and a ground unit must shepherd. The header block above the
  passive control names the herders' placement but not the drone, and can stay.

  **Re-check the point on `main` before you keep it.** It was chosen on the pre-GH-382 map.
  - Still true: `(22, 27)` is 11.4 tiles from `tm_spotter_west`'s new post at (11.5, 22.5),
    outside its sight 9.
  - New: it is **9.9 tiles from `tm_pocket_west`** at (15.5, 19.5), inside that `atgm_cell`'s
    sight 10 and Kornet range 10.
  - New: it now stands on the level-3 knoll line, two levels above the herders.

  If the squad is engaged there, find a point that is within 4 tiles of at least two herders and
  more than 10 tiles from (15.5, 19.5). Measure it, and record it with the variants below.
- [ ] **Step 2: Measure on today's sim.** `pnpm playtest` must be **byte-identical** to `main`.
  Measured on `basepD` at `e3bf7484`: it was. The drone started the herders walking at t≈4–16 s,
  so the squad arrived after them and changed nothing. The drone's first waypoint is unchanged on
  `main`, so the reasoning holds; re-measure.
- [ ] **Step 3: Measure on the Task 2 sim**, a local stash, never committed. At `e3bf7484` it read
  `tel_marum_1_recon: VICTORY in 0.9 min, ROE 100, stars 2 … clear_the_valley_floor=c`, with
  credits 200, the max-tier line unchanged, the ladder 5849 and every gate green (measured on
  `f2pD`). **On `main`, expect a later victory.** The re-planned drone holds 30 s and then sweeps to
  the battery from t=34 s, so the four `locate`s finish later than 0.9 min. Expect the ladder at
  **5830**, credits unchanged from `main`'s line, and every gate green. Record what you read.

  Record the shepherd variants tried, so the next author does not repeat them. All three were
  measured on the **old** `tel_marum_1` and are history:
  - `M(22, 27.5)` passes, at 3.5–3.8 tiles.
  - `M(21.5, 28)` **fails**: 4.03 tiles to the nearest herder, just outside the radius.
  - The `jeep_shoded` at `M(22, 27.5)` **fails**. Two herders board it (2 slots) and ride nowhere,
    because nothing drives the jeep home, and only 1 reaches `muster_ground`. A transport shepherd
    must be ordered to the refuge.

  **Wider re-measure (GH-382).** Under ruling (a), run every plan on this stash, not only Tel
  Marum I. Thirteen missions pair an `evacuate_before` with a `recon_drone` in the starting force.
  Eight were re-planned on 5 Oct: `beit_sahwan_4_subterranean`, `khan_rafid_2_foothold`,
  `khan_rafid_3_clearance`, `qarn_hadid_3_clearance`, `tel_marum_1_recon`,
  `tel_marum_3_clearance`, `umm_zeitoun_3_clearance` and `umm_zeitoun_4_clearance`. Any plan that
  loses an evacuation primary here leaned on its drone, and needs a ground shepherd of this task's
  shape. Report each one before landing.
- [ ] **Step 4: The doc.** In `script-losable.md`, three places say the drone starts the herders
  walking:
  - §1's `civilians` bullet;
  - §2's table row for I;
  - §6's t=4 order row.

  Change each to "the `inf_squad` sent to `[22, 27]` walks them out", or to the point Step 1
  settled on, and cite #279 ruling (a).
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
The line is at ~L1560 at `b44df7aa`. It is in this commit because the argument is required, and
`typecheck` must pass at every commit. Today the runtime's field is
`private readonly civFlight = new CivilianFlight();`, at ~L492 of `mission.ts`.

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
  by domain)", and that is now false. On `main` it is stale twice over: since GH-382 the drone is
  not ordered at t=1 at all (it follows the escort at t=50, after the spur is clear). Only the
  escort's attack-move to (33, 8), beside the porters at (32.5, 7.5), is issued at t=1. Say that
  the drone does not move them. Say whether `get_the_porters_clear` (a secondary) completes or is
  still active at the victory, from Step 4's measurement. No order changes (D4).
- [ ] **Step 4: Measure.** Expect, as measured on `f2pD` at `e3bf7484`:
  - `test:determinism`: both pins **unmoved**.
  - `balance`: identical to `main`.
  - `playtest`: exit 0. At `e3bf7484` two lines moved: `umm_zeitoun_4_clearance` and
    `umm_zeitoun_4_clearance (bought)`, where `get_the_porters_clear=c` became `=a`. ROE 92,
    stars 2, credits 237 and the 1.7 minutes did not move, the ladder stayed 5849, and every gate
    was unchanged. **On `main` that line differs.** GH-382 re-scripted the plan, and the
    `LADDER_CREDITS` comment gives Umm Zeitoun IV's credits as 237 → 247 (GH-382) → 227 (#402).
    On `main` the escort is ordered to the porters' yard at t=1 and the drone is not, so the
    `c → a` move may not happen at all. Re-measure. The ladder must stay **5830**, and every gate
    unchanged.
  - The re-measures the lead asked for, as read at `e3bf7484`:
    - **`beit_sahwan_3_clearance`**: result, ROE, stars and credits were identical to `main`. Its
      families no longer moved at all. On `e3bf7484` they broke 2 times by drone (base plan), and
      2 by drone plus 3 by ground at max tier; with the change there were 0 breaks, because the
      mission has no evacuation and nothing fires on them. GH-382 moved it onto `beit_sahwan_3`
      (three civilian groups, still no evacuation), so the "0 breaks" claim needs re-reading.
    - **`umm_zeitoun_4_clearance`**: as above. Its porter breaks went from 4 by drone to 1 by fire
      and 3 by ground; max tier went from 4 by drone to 3 by fire and 1 by ground. Re-measure.
  - Across the whole `playtest` run, breaks went from **201 (154 ground, 25 fire, 22 drone)** to
    **194 (164 ground, 30 fire, 0 drone)**, Task 1's edit included, at `e3bf7484`. Re-count on the
    branch base. Any plan whose evacuation primary now fails is Task 1's Step 3 case.
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
// main.ts (today, ~L1586 at b44df7aa: `const civWatch = refugeAt ? new CivFlightWatch() : null;`)
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
    tiles, or under fire". It stays true: `beit_sahwan_breach` fields no air unit (GH-345's force:
    four `inf_squad`, two `at_team`, an `apc_eitan` and a `jeep_shoded`). Leave it.
    `packages/app/src/evacuation.test.ts` ("First Light's briefing states the flight rule") pins
    both triggers and the length band, 385–1225 characters. Since GH-119 the sentence also lives in
    the `notes` entry of `briefing_sections`, which must spell `briefing` exactly.
  - The Khan Rafid I "a soldier is within four tiles" line stays true as well. Two other Khan
    Rafid I lines say "nothing of ours" was within four tiles: `get_two_in`'s `say_on_fail` and the
    defeat debrief. A drone now counts for nothing there, so those lines can be false when the
    player's drone was close. Raise this with `narrative-designer`; it is not a string change for
    this task.
- [ ] **Step 4: See it red.** Ignore `opts.shepherds`: the two new tests fail.
- [ ] **Step 5: Gates.** Common gates plus `pnpm validate:ui`. The visual gate cannot move: the
  golden captures include no flight line.

---

## Task 4: #291, routed units flee the fire, not −x (**the golden re-pin**)

**Model:** opus, for the determinism review. **Agent:** `sim-guard`. **Depends:** nothing in this
plan. Land it before FW Task 2 (see "Re-pin order across streams").

**Why.** `startRout` (sim.ts:3394 at `e3bf7484`, 3538 at `b44df7aa`; unchanged by #402) starts
from `let nx = -ONE; let ny = 0;` and changes that only when some enemy is at least `SUSPECTED_AT`.
A unit pinned by fire it cannot see therefore runs −x, and every backtest puts side 1 in the east.
The E5 probe shows the result: a `militia_cell` outranged by an `inf_squad` at 8 tiles routs west
into its own sight 7, and identifies the squad at 6.15 tiles in 20 of 20 seeds. Mirrored, that
happens in 0 of 20. Both readings predate #402, under which both units halt to fire. GDD §5.5a says
"away from fire".

**#402 meets this task in two places.**
- **Getting up.** `stepBrace` forces every routed unit up, and `stepMovement` moves nobody who is
  not at `BRACE_NONE`. A bracer that was kneeling when it routs therefore pays `KNEEL_RISE_TICKS`
  (4 ticks) before its first step.
- **The hold branch.** A routed unit in branch 4 is not moving, but the routed rule comes first,
  so it holds standing rather than kneeling. See "For the lead" item 2 at the top.

How often the fallback runs (`detect-report.md`, measured at `e3bf7484`, before #402 made the golden
riflemen bound; re-count):

| run | routs | fallback | of those, toward the nearest enemy |
|---|---|---|---|
| golden replays | 91 | 0 | 0 |
| `pnpm balance` | 9,430 | 8 | 4 |
| `pnpm playtest` | 268 | 9 | 6 |

**Interfaces (produced):**

```ts
// sim.ts, per entity (capacity). Zeroed in spawn, beside `suppression`.
private readonly suppFromX: Int32Array;   // Q16.16: where the last HOSTILE suppression came from
private readonly suppFromY: Int32Array;
private readonly suppFromSet: Uint8Array; // 1 once any hostile suppression has landed
// state view: readonly suppFromX / suppFromY / suppFromSet (read-only, like `suppression`;
// the hash-coverage tests flip them)
private applySuppression(target: number, amount: Fx, coverProtects = true,
                         srcSide = -1, srcX: Fx = 0, srcY: Fx = 0): void
// After the tunnel early-return and before the cover and veterancy maths:
//   if (srcSide >= 0 && srcSide !== this.side[target]) { suppFromX/Y[target] = src; suppFromSet[target] = 1; }
// hash(): fold suppFromX, suppFromY, suppFromSet directly after `suppression`
```

**Call sites.** `grep -n "applySuppression(" packages/sim/src/sim.ts` finds 13 lines at
`e3bf7484`, and still 13 at `b44df7aa`: the definition and 12 calls, in the same 10 methods. Each
call passes a source as follows.

| caller | source side | source point |
|---|---|---|
| `resolveHit`, soft hit | `side[prShooter]` | `prOriginX/Y[pr]` |
| `resolveHit`, non-penetrating bounce | `side[prShooter]` | `prOriginX/Y[pr]` |
| `groundImpact` | `side[prShooter[pr]]` | `prOriginX/Y[pr]` |
| `splashAt` | `side[prShooter]` | `prOriginX/Y[pr]` |
| `splashDirect` (kamikaze, tunnel collapse, `debugSplash`) | `by >= 0 ? side[by] : -1` | `posX/Y[by]`, or the blast point when `by < 0` |
| `stepKamikaze`, the bounce | `side[i]` | `posX/Y[i]` |
| `stepStrikes` | `s.by >= 0 ? side[s.by] : -1` | `s.x, s.y` |
| `destroyStructure`, collapse shock | `by >= 0 ? side[by] : -1` | `stCx/stCy[s]` |
| `rollComponent` ×2 (crew shaken), `disembark` (bail-out), `debugSuppress` | none (default −1) | leaves the last source in place |

**Same-side sources are ignored.** Without that, a unit shaken by its own side's splash flees
toward the enemy: the emulation found one playtest `gun_truck` whose "source" was its own flank.

**`startRout`, in order:**
1. **A side-0/1 unit.** Flee from the nearest enemy with `contact >= SUSPECTED_AT`. Unchanged.
2. **A civilian (side 2).** Flee from the nearest living side-0/1 unit, by ground truth. This is an
   explicit branch now. Today the same result comes from reading `contact[2 * capacity + t]`,
   past the end of the array: the read gives `undefined`, and `undefined < SUSPECTED_AT` is false.
   The explicit branch keeps that behaviour byte for byte, except when no combatant is alive at
   all (then it holds instead of running −x).
3. **A side-0/1 unit with no known threat and `suppFromSet[i] === 1`.** Flee along
   `(pos − suppFrom) / |pos − suppFrom|`, using the same `fx.sqrt(fx.max(dSq, 1))` / `fx.div`
   guard as branch 1.
4. **Otherwise, hold.** Set `moving 0`, `fieldRef -1`, `attackMove 0`, `engaging 0` and
   `stance 0`, and set no goal. The unit stays `routed` until it rallies.

`ROUT_DISTANCE`, the clamps and the wall slide are unchanged. The Q16.16 implementation was
measured on the `f291` copy. The scratchpad's `patch291.py` was the reference diff, and it is no
longer on disk: this section is the specification.

- [ ] **Step 1: Write the failing tests** in the new `rout.test.ts`. Use in-test fixtures, not
  `data/`: a shooter with sight 8 and range 8 (small arms), and a soft target with sight 7 and
  hp 6000 so it survives to rout.

  **Give both fixtures `role: 'infantry'`.** A fixture type with no `role` derives as wheeled and
  never braces (#402; the golden replay's riflemen were in exactly that state). The shipped case
  is a `militia_cell`, which does brace. With the role:
  - the target kneels while idle, and gets up (4 ticks) before it flees;
  - the shooter fires only from a knee;
  - "4 s after the rout" therefore includes the rise.

  Assert the target's `brace` reads `BRACE_NONE` once it moves. For the holding unit in "no source,
  no threat", record its `brace`. Under `main`'s rules it stands at `BRACE_NONE`; whether it should
  is "For the lead" item 2.
  - **"outranged and blind, it flees away from the fire"** (the probe layout). The shooter is side
    0 at (4.5, 8.5) and the target side 1 at (12.5, 8.5).
    - It routs within 60 s.
    - No `contact` event shows side 1 seeing the shooter before the rout.
    - 4 s after the rout, `posX > xAtRout + 1`.
    - Side 1 never identifies the shooter within 60 s. That is the E5 symptom.
  - **Its mirror.** The shooter is at (27.5, 8.5) and the target at (19.5, 8.5), and it flees −x.
    This case passes on `main` too; keep it, because it pins that the direction comes from the
    source rather than from a constant.
  - **The side mirror.** The target is side 0 and the shooter side 1, in the probe layout. It flees
    +x.
  - **"no source, no threat: it holds"**. Pin the unit with `debugSuppress` only. It routs, and
    4 s later its position is unchanged and `moving` is 0.
  - **"a same-side blast does not steer it"**. A side-1 unit is pinned by `debugSplash` with `by`
    set to another side-1 unit east of it. It holds.
  - **"a civilian flees the nearest combatant"**. A civilian is pinned by `debugSuppress`, with a
    side-0 unit 3 tiles east of it. It moves −x.
  - **The existing known-threat test** in `combat.test.ts` (`describe('rout (GDD 5.5a)')`, test
    "soft units pinned too long break, flee the kill zone, and rally when fire lifts") is unchanged, and
    must pass.
  - **`determinism.test.ts`**: add `hash covers suppFromX`, `…suppFromY` and `…suppFromSet`. Each
    flips one element through `sim.state` and expects a different `hash()`.
- [ ] **Step 2: Implement** as specified. Do not keep a `-ONE` default anywhere.
- [ ] **Step 3: Prove the re-pin is only the new columns.** Temporarily delete the three
  `hashArray` lines. Both pins must pass at their old values: `922714084` and `3200430224` on
  `b44df7aa`, or whatever the branch base holds if another sim re-pin lands first. (At
  `e3bf7484` they were `2109596329` and `1425295494`, measured on `f291nh`: 11 of 11.) Then
  restore the lines. **Undo the edit, never `git checkout` the file.**
- [ ] **Step 4: Re-pin both golden pins** in this commit. Each gets a dated comment in the file's
  style:
  - "GH-291: three per-unit columns (`suppFromX`, `suppFromY`, `suppFromSet`) join the hash."
  - "No behaviour moved: with their `hashArray` lines removed, both replays reproduce the old
    value. All N golden routs take the known-threat branch." At `e3bf7484`, N was 91. #402 changed
    the replay: `d_rifles` now kneel and bound. Count N again on the branch base, and write the
    count you read.
  - `Was 922714084.` / `Was 3200430224.` (the pins at `b44df7aa`; use the branch base's values).

  Measured on `f291` at `e3bf7484`, with the columns folded directly after `suppression` in the
  order X, Y, Set: flat `3399908693` and relief `1006889545`. **Those values cannot recur.** The
  hash has folded the three brace columns since #402. Read the real values from the failure. A
  different fold position gives different numbers and is fine, as long as Step 3 holds.
- [ ] **Step 5: E5 doc.** In `docs/campaign/special_units/e5/numbers.md`:
  - the `fire` `inf_squad` 8-tile cell `578 (526-642)` becomes `never (0/20)`;
  - the "Finding, not investigated" paragraph is resolved with "GH-291: the militia routed −x into
    its own sight; fixed in Stage 4".

  It is a non-claim row, and `tools/src/backtest/e5-probes.test.ts` does not pin 8 tiles. At
  `e3bf7484`, `pnpm --filter @lions/tools e5:probes` changed only that row and still printed "all
  claims met" (measured). The `never (0/20)` reading predates #402: both the firing `inf_squad`
  (fires only from a knee) and the militia (kneels idle, rises to rout) now brace. Re-measure, and
  write the cell you read, even if it is not `never`.
- [ ] **Step 6: Gates.** Common gates, plus:
  - `test:determinism`: **moved, re-pinned here**.
  - `balance`: exit 0. At `e3bf7484` only base urban 2:1 moved, **63% → 62%**, and max tier was
    unchanged (measured). On `main` that cell already reads 37% (#402), and the smoke step's rows
    exist. Re-measure and quote every moved line in the commit. No tuning moved, so
    `balance-analyst` has nothing to re-run.
  - `playtest`: **byte-identical** (measured at `e3bf7484`; re-measure).
- [ ] **Step 7: See it red.**
  - Restore `nx = -ONE` as the no-source default: "flees away from the fire" fails, because the
    target moves −x.
  - Drop the `srcSide !== this.side[target]` filter: "a same-side blast does not steer it" fails.
  - Delete each `hashArray` line: its coverage test fails.
  - Make civilians skip branch 2: "a civilian flees the nearest combatant" fails.

---

## Task 5: The ledger

**Model:** haiku.

- [ ] **Step 1: `docs/HANDOVER.md`.** Record:
  - the landings, with their measured lines (the flight counts, the urban 2:1 move, and the new
    golden values);
  - D1–D4 and the re-pin order.
- [ ] **Step 2: Close #291**, and #279 once Task 3 lands. The PR text quotes the gate output.

---

## #280: a reference only. The Field works plan owns it

**Ruling (29 Sep): field works only.** Protection comes from an opt-in
`aura.garrison.supp_cover` on a structure type, absent by default, so every shipped building keeps
today's rule. There is no sim-wide change.
- **Owner:** FW plan Task 1 (`docs/superpowers/plans/2026-09-29-field-works.md`, on `main` since
  #277). Its L1 is now decided as (a).
- This plan changes nothing for #280.
- **#402 does not reach it.** Garrisoned units are held at `BRACE_NONE` and fire as before
  (spec §2), so garrison suppression cover never meets the brace machine.

Three measurements FW Task 1 should carry, all taken at `e3bf7484`:
- **The golden replay is blind to garrison suppression.** Its shed is garrisoned from tick 33, and
  in 1,000 ticks nothing fires at it: 0 structure shots, and 0 of 816 near misses within 1.2 tiles
  of its centroid. No #280 change can move either pin. #402 since changed what the replay's
  riflemen do (they kneel and bound), so re-read the shot and near-miss counts. FW's
  `fw-garrison-supp` probe and the new `garrison.test.ts` that FW Task 1 creates are the only
  guards.
- **The near-miss radius is 1.2 tiles, not 1.095.** `NEAR_MISS_RADIUS_SQ` is 94372 = 1.44
  tiles². #280's text reads 1.2 as the radius squared. This matters for which footprints are
  exposed: a 3-wide building's face-centre tile (1.0 tile) and a 3×2's edge tiles (1.12 tiles) are
  inside the radius too.
- **The census, under the ruling:** 205 of the 217 garrisonable structures on shipped maps had at
  least one perimeter tile inside the radius of their centroid. Only 4×4 and 5×4 blocks escaped.
  GH-382 re-drew 19 maps on 5 Oct, so re-run the census for the count. The shapes that escaped did
  so by geometry, so expect the same shapes to escape. Every shipped building therefore keeps the
  defect until a type opts in; see R1.

---

## Re-pin order across streams

Three streams move the golden pins in Stage 4. Each moves both pins **once**, in its own commit,
with its own reason. They land in a fixed order, and each later stream rebases onto the earlier
re-pin, reads the new value from the failure, and writes `Was <previous>.`

**#402 moved both pins before Stage 4.** It landed 6 Oct, outside this order: flat `922714084`,
relief `3200430224`. #291's `Was` lines start from those values. Its kneel duration (0.2 s) is
final, by the lead's choice on 6 Oct, so it brings no further re-pin.

| order | stream | commit that moves the pins | reason | also edits |
|---|---|---|---|---|
| (landed) | #402, halt to fire | 7962b6ea, 6 Oct | the three brace columns, and the replay's riflemen now brace | `stepCombat`, `stepBrace`, `stepSweep`, `hash()` |
| 0 | this plan, Tasks 1–3 (#279) | none | hash-neutral (measured) | `civilians.ts`, `mission.ts` |
| 0 | FW Task 1 (#280 field) | none | hash-neutral: config, not state | `applySuppression`'s cover branch |
| **1** | **this plan, Task 4 (#291)** | Task 4 | 3 per-unit columns | `applySuppression`'s signature and head, `startRout`, `hash()` |
| **2** | **FW Task 2** | FW Task 2 | 14 FW arrays (per structure, the site table, per unit) | `hash()`, per-structure SoA |
| **3** | **E6 (#274), placed charge** | E6's sim commit | its per-structure columns | per-structure SoA, `splashDirect` blast |

**Why this order:**
- **#291 first.** It is the smallest and the only one ready on day one. It needs no content, no
  art and no lead gate. It also changes `applySuppression`'s signature, which FW Task 1 edits in
  the same function. Landing it first means FW Task 1 rebases onto a settled signature rather than
  the reverse. Its default parameters keep FW Task 1's call sites compiling unchanged.
- **FW Task 2 before E6.** Both extend the per-structure SoA. FW Task 2 declares every FW array up
  front, so that its Tasks 3–7 move nothing. FW's P2 leaves the FW-versus-E6 order to the lead at
  kickoff; this plan recommends FW first (decision L-A below).
- **A single combined re-pin is not proposed.** It would couple three branches that land weeks
  apart. One re-pin per stream, each saying what entered `hash()`, is the house rule.
- **The order-0 rows may land at any time.** If one moves a pin, that is a bug, not a re-pin.

---

## Risks

- **R1. #280's ruling leaves the shipped defect live.** Garrisons in 205 of the 217 garrisonable
  map buildings are still pinned by misses at cover 0, until a type opts in. No golden replay or
  playtest line will show it (see the #280 section). It is recorded as an accepted consequence,
  not a gap in this plan.
- **R2. D1 is static.** A mission whose only evacuation is a secondary (`umm_zeitoun_4`) shepherds
  for its whole length. One whose evacuation failed early still shepherds. Changing that needs an
  objective-status read in `step`, and a new ruling.
- **R3. Umm Zeitoun IV's porters secondary read `a` at victory** (at `e3bf7484`).
  - The line moved; the grade, credits and ladder did not.
  - Re-authoring it had a measured cost: sending `inf_squad[0]` to `(29.5, 11.5)` at t=1 restored
    `get_the_porters_clear=c`, but failed the `(bought)` gunship probe ("fielded and never scored a
    kill", 0 kills against 2).
  - A `sniper_team` shepherd did not restore the secondary.
  - So D4 left the plan alone.
  - **All of this was measured on the old map.** GH-382 moved the porters to (32.5, 7.5) and
    re-scripted the plan: the escort attack-moves to (33, 8) at t=1, and the gunship probe now
    attack-moves to (20, 18). `(29.5, 11.5)` names nothing on the new ground, and the ground
    escort may already shepherd the porters. Re-measure before reading R3 as a cost.
- **R4. Tel Marum I's shepherd sits on a radius edge.** On the old map, `(22, 27)` had 0.6–1.0 tiles
  of margin, while `(21.5, 28)` missed by 0.03. The herders' placement `[21, 24]` survived GH-382,
  but the point now sits 9.9 tiles from `tm_pocket_west`, inside its sight and Kornet range 10
  (Task 1, Step 1). The passive control and the plan's own VICTORY assertion catch a miss.
- **R5. A transport shepherd must be driven home.** Measured with the jeep: families board it and
  go nowhere. This is a content rule for `mission-author` and `playtest` (`script-losable.md`'s
  "caution, not gap" row about transports names the same shape).
- **R6. #291's hold branch.** A routed unit with no threat and no source now stands still instead
  of running −x. At `e3bf7484` only debug hooks reached it: in the emulation, all 8 balance
  fallbacks and all 8 side-0/1 playtest fallbacks had a source. Re-count after #402. Rally logic is
  unchanged. Under #402 a holding bracer stands upright, because the routed rule keeps it up (see
  "For the lead" item 2).
- **R7. `applySuppression` is edited by two streams** (#291 and FW Task 1), and later by E6's blast.
  The order above assigns who rebases. #402 did not touch it: its signature is still
  `(target, amount, coverProtects = true)` at `b44df7aa`.
- **R8. The `state` view gains three columns.** They are there for read-only use and hash-coverage
  tests (invariant 4). No renderer or app code may write them, as with `suppression`. Since #402,
  `state` also carries `brace` and `braceTicks`, read by the renderer on the same terms.
- **R9. Measured on probe copies, not on the final code.** Every number above came from a patched
  copy of `e3bf7484`. By 6 Oct `main` had already moved under it: #402, GH-382, GH-345 and the smoke
  step. So each task re-measures, and a different number is recorded, never re-tuned to this one.

---

## Lead decisions

- **L-A. The Stage 4 re-pin order:** #291, then FW Task 2, then E6. This plan recommends it; FW's
  P2 already asks the lead to order FW against E6. #402 has since moved the pins ahead of all three
  (6 Oct), and its 0.2 s kneel is final, so it adds no re-pin to this order.
- **L-B (optional). Umm Zeitoun IV's porters:** accept the secondary reading `a` (D4, the
  recommendation), or re-tune the plan with a ground shepherd and re-measure the `(bought)` probe
  (R3). Both options were argued from the pre-GH-382 plan; see "For the lead" item 3.
- **L-C (confirm). D1, static per-mission shepherding.**
