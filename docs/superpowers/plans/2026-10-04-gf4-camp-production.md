# WP-G-F plan F4: production at the field camp, rally points, and an AI that spends (GH-183, GH-136, G3 Q3). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Refreshed 16 Oct: per-side keys and the line verbs as `Command`s (LD6), re-read against main `199065f1`, F2's branch and N2's plan

Docs only; nothing run. Read against `origin/main` `199065f1` (F1 #625 + #640, F3 #629, the garrison
overhaul #606, the N2 prerequisites #644, #619, #632, #649 and #650 merged; #658, the doctrines, is
**not** merged), F2's branch `feat/gf2-held-ground`, read at `61f2f04a`; its tip is now `3e7530bf` (Tasks 1–7, 2, 9
and 10 done; the coordinator's Task 11, C-R20, is pending and rewrites `rearOf`, the zone-state pass
and the recheck's field reuse; ledger `_coord/s4-f2-progress.md`), and N2's plan on `main`
(`docs/superpowers/plans/2026-10-16-net-n2-sim.md`, #653). Lane C's order is F1 → F3 → F2 → N2 →
**F4**, one sim plan in flight, so F4 is cut from `main` **after N2 merges**.

What changed, and why:
1. **LD6 (ruled 16 Oct, lead) is folded in.** F4 keys its production API by side and lands
   line, cancel and rally as `Command`s, with the net whitelist in the same commit. The ten asks
   (`_coord/f4-per-side-asks.md`, the N3 prep note §5, PR #655) are placed task by task in the table
   below. Two tasks are new: **Task 2b** (the per-side start purse and base rate, ask 7) and
   **Task 5b** (the line verbs as `Command`s, asks 1, 4 and 5). F4 still never opens side 1 to a
   human: `applyQueued` keeps N2's `side !== 0` skip and `validateCommand` keeps the versus drop for
   every runtime kind. N3 lifts both.
2. **Four open points ruled** ("Rulings (15 Oct)" below): `built` carries `side` and fires for side 1;
   the context field is `MissionContext.economy`; `productionOf(side)` is F4's; the bounds are
   `MAX_PRODUCTION_LINES` 4 and `MAX_LINE_QUEUE` 16.
3. **Every name and line hint re-read.** The purse is F2's `Int32Array(2)` in 1/2400ths
   (`PURSE_UNITS`, `logisticsOf(side)`), not `logisticsValue`. `CONTEST_RADIUS_SQ` lives in
   `tuning.ts` (F2 C-R7). The contest test reuses F2's `HoldView` (air skip, `tunnelIn` guard), so
   D1's air skip is no longer new code. `requestBuild`, `canBuild` and `applyQueued` are N2's shapes,
   widened. Line hints in the tasks are F2's tip (`61f2f04a`); N2 shifts `mission.ts` again, so
   locate by symbol. The dated sections below ("Changed since 4 Oct", both pre-flights) are history;
   their line hints are stale and are not corrected in place.
4. **Pins re-read.** Sim pins on `main` and F2: **935671699 / 2842924511 / 3272041047** (moved by
   #591, not by F2). `ECONOMY_PIN` / `_RELIEF`: **3794140228 / 2682592505** on `main`, F2 re-pins to
   **275731552 / 145368021** (`9f4fd7d7`); re-read at pre-flight, F2's final wave is open.
   `RUNTIME_DIGEST_PIN` / `_RELIEF` are born in N2 Task 6 (values unknown: re-read). `LADDER_CREDITS` =
   `CAMPAIGN_CREDITS` = **5940** on `main` (F2 predicts no move).
5. **The economy pins still move once, in Task 6.** Tasks 2b–5b keep `economyHash`'s build-queue fold
   byte-identical (the projected start and ready ticks of side 0's items), so the per-side keying
   moves no pin by itself (scan row S-6). Task 6 moves `ECONOMY_PIN`/`_RELIEF` and N2's
   `RUNTIME_DIGEST_PIN`/`_RELIEF` together, for one reason.
6. **A pre-flight scan** (one row per shared file or interface, one per task, and rows against F2
   and N2) is below, with a ruling beside each conflict.
7. **Smaller corrections:** `ctx.unitInfo` answers KDF units only, so a side-1 build needs a side on
   the lookup (R-F4-5); `enemy.production.tag` becomes `group` because `commit` addresses groups
   (R-F4-7); `built` now has five readers to filter (R-F4-1); F2's banking gates
   (`BANKING_OVER_30_WINNERS`, `ZONE_PASSIVE_INCOME`) join Task 10's re-reads.

### Where the ten LD6 asks landed

| ask | what | task |
|---|---|---|
| 1 | `requestBuild(unitId, line?, side = 0)`, `canBuild(unitId, line?, side = 0)`; `build.line?` on the wire | 3 (runtime); 5b (`Command`, `cleanCommand`, `applyQueued`) |
| 2 | One private `spend(side, …)` / `refund(side, …)` on `purse[side]`; side-1 intel cost refused | 3 (build, cancel, D4 refund); 9 (`spendDown` through it) |
| 3 | `firstRefusal`/`buildBlockedReason`/`popCapped`/`populationView` by side; camp clause per side, no `player_start` fallback for side 1; `population(side)` counts that side's lines | 3 |
| 4 | `cancelBuild(line, index, side = 0)`; `cancelBuild` `Command` | 3 (runtime); 5b (`Command`) |
| 5 | `setRally`/`clearRally`/`canSetRally` with `side = 0`; `setRally`/`clearRally` `Command`s, drained before `sim.tick()` | 5 (runtime); 5b (`Command`) |
| 6 | `productionLines(side)` index order stable and the same index the commands carry; `productionOf(side)` | 3 (ruling R-F4-3) |
| 7 | `MissionContext.economy`, whole logistics, per-side start and base rate | 2b (context, accrual); 9 (`enemy.production` as side 1's absent-context source) |
| 8 | `built` carries `side`; the app's readers filter `side === 0` | 3 (event, app filters); 9 (the side-1 case) |
| 9 | The contested pause per line, by `1 - line.side`, air skip, `tunnelIn` guard; objectives' `contestedIn` untouched | 4 |
| 10 | Side-1 AI production through the same request path and `spend(1, …)` | 9 |

## Rulings (15 Oct, coordinator, lead-delegated window): the four open points

- **R-F4-1. `built` fires for side-1 purchases and carries `side: 0 | 1`; the app filters
  `side === 0`.** *Ruled 15 Oct (coordinator, lead-delegated window).* This supersedes the 11 Oct
  wording of Task 9 and Q6 ("a side-1 buy emits no `built`"), and keeps Q6's outcome: no alert, no
  announcer line and no cue for an enemy buy. Why: events are unhashed, so no pin moves; N3 needs
  the signal to switch the filter to `viewerSide`, and the probe (Task 9) counts bought units from
  it rather than from a second channel. The readers on `main` are five, each filtered and tested in
  Task 3: `ui/alerts.ts` (~L285, `alert.arrived`), `voice/announce.ts` (~L138, "reinforcements"),
  `tutorial/runtime.ts` (~L135, a `mission` await on `built`), `main.ts`'s `describeMissionEvent`
  (~L526, returns null already: no change, a test pins it), and `ui/cues.ts` (`MISSION_EVENT_SOUND`,
  keyed by kind, `silent`: no change). `tools/src/audio/mix-scenes.ts` (~L291) builds a literal and
  gains `side: 0` (typecheck forces it). *Cost if wrong:* a reader missed announces enemy units as
  ours; the per-reader tests are the guard. If the lead wants no event at all, one `if` in the
  deploy path and Task 9's test flips back.
- **R-F4-2. The context field is `MissionContext.economy`, with
  `{ logisticsStart: readonly [number, number]; logisticsRatePerMin: readonly [number, number] }`.**
  *Ruled 15 Oct (coordinator, lead-delegated window).* `economy` as the ask proposed; the two
  members are named after the JSON keys they override (`resources.logistics_start`,
  `logistics_rate_per_min`, `enemy.production.logistics_start`) and after the doctrine's
  `budget.logistics_start`, so one grep finds every source. Whole logistics, scaled by
  `PURSE_UNITS` in the sim. Optional, beside `popCaps`/`roadMask`/`loaned`; a construction constant,
  not hashed (the purse it feeds is). *Cost if wrong:* a rename in Task 2b and in N3's rules-file
  loader, nothing else.
- **R-F4-3. `productionOf(side)` is F4's.** *Ruled 15 Oct (coordinator, lead-delegated window).*
  Task 3 rewrites the flattened getter anyway; writing it once keyed by side and making
  `get production()` return `productionOf(0)` keeps one flattening rule and one set of tests. N3
  only changes the caller (the dock reads `productionOf(viewerSide)`). *Cost if wrong:* one unused
  public method until N3.
- **R-F4-4. `MAX_PRODUCTION_LINES = 4` per side and `MAX_LINE_QUEUE = 16` waiting items per line,
  both in `tuning.ts`, enforced by the runtime as well as the wire.** *Ruled 15 Oct (coordinator,
  lead-delegated window).* No mission has more than one camp per side, and the versus maps name
  one camp zone a side (`wadi_tarfan`'s `camp_0`/`camp_1`), so 4 is headroom, not a fitted number.
  `validate:data` refuses a mission whose structures (map grid and `structures` alike) give one
  side more than 4 production structures, and `start()` throws the same as a load-time wiring
  fault, so the wire bound can never refuse a real line. A line holds one item in progress plus at
  most 16 waiting; the 17th waiting build is refused (`'production queue full (16)'`, the last
  clause of `firstRefusal`, so `canBuild` agrees). The wire takes `line` as an int
  `0 <= line < MAX_PRODUCTION_LINES` and `index` as an int `-1 <= index < MAX_LINE_QUEUE` (-1 is the
  item in progress). Why a runtime cap at all: the cheapest unit costs 186 logistics and a
  doctrine start may be 894784 (the Int32 ceiling), so without a cap a queue can reach ~4,800
  entries and every cancel index would be legal. The same ceiling bounds every start purse:
  `enemy.production.logistics_start` carries `"maximum": 894784` (Task 7), and the runtime throws at
  construction on an `economy.logisticsStart` above it (Task 2b). The five building plans never queue more than 2
  (R: their schedules against their purses, Task 1 measures), and Task 10 prints the largest queue
  each reaches. *Cost if wrong:* a constant, and one refusal string the dock shows.

## Pre-flight scan (refreshed 16 Oct)

Per superpowers:subagent-driven-development: one row per pair of tasks sharing a file or an
interface, one row per task on self-consistency, and rows against F2's branch and N2's plan.
Read, not run. A ruling (R-F4-n) stands until the controller's pre-flight overturns it.

**Pairs of tasks**

| # | tasks | shared | produces vs consumes | found | ruling |
|---|---|---|---|---|---|
| S-1 | 2 × 3 | `production.ts`: `ProductionLine`, `LineItem`, `advance`, `enqueue`, `cancel` | 2 defines; 3 builds one line per anchor per side and drives it | Task 2's interface had no queue bound (R-F4-4) and no rule for when an item enqueued on an idle line starts | **R-F4-6:** `enqueue` returns `false` at `MAX_LINE_QUEUE` waiting items; an item enqueued on an idle line becomes `current` at once with `ticksLeft = buildTicks`, and one that finishes on tick t promotes the next with its full `buildTicks`, counted from t + 1. Both pinned in Task 2 |
| S-2 | 2 × 8 | `LineItem` as the menu entry | 8's `spendDown` reads `logistics` and `population` | `spendDown`'s `purse` unit was unstated against F2's 1/2400ths | `spendDown` takes whole logistics, `logisticsOf(1)`. For an integer cost `floor(units / 2400) >= cost` ⇔ `units >= cost * 2400`, so the floored read is exact. No conflict |
| S-3 | 2b × 3 | `MissionContext.economy`, `purse` | 2b seeds both sides' purses; 3's side-1 tests need a funded side 1 | none once 2b lands first | order 2b before 3 |
| S-4 | 3 × 4 | `ProductionLine`, `productionLines(side).contested` | 3 calls `advance(line, false)`; 4 supplies the flag | consistent | — |
| S-5 | 3 × 5 | line `rally`, `spawnPlacement`'s ids | 3 deploys at the exit; 5 queues the rally order for the ids | consistent | — |
| S-6 | 3 × 6 | `economyHash` | 3 deletes `buildQueue`, which `economyHash` folds (count, then unit chars, start and ready tick per item); 6 re-pins | **Conflict:** deleting the fold in Task 3 moves `ECONOMY_PIN` three tasks early | **R-F4-8:** Tasks 3–5b fold side 0's items exactly as `buildQueue` did: in flattened line order (current, then queued), count, unit chars, `startTick = readyTick - buildTicks`, `readyTick = now + ticks ahead + own`. On the flat fixture no two builds overlap (400→700, 800→1100, 2300→2600 still in progress at tick 2400) and the relief fixture builds nothing, so the words are byte-identical (R). Task 6 replaces the fold. A pin that moves before Task 6 is a stop |
| S-7 | 3 × 7 | which structures are lines; `productionAnchor`; `declaresProduction` | 3 reads the TYPE's `producesFor`; 7 adds a per-placement `side` | **Conflict:** five readers of the type field (lines, `productionAnchor`, `declaresProduction`, `stepDemolition`'s own-camp skip at `sim.ts` ~L5499, and the render side's `ThreeRenderer.structureIsOwn`, `packages/render/src/three/ThreeRenderer.ts` ~L5857) plus F2's `rearOf` through `productionAnchor` | **R-F4-9:** Task 7 adds `Sim.structureProducesFor(s)` (the override, else the type's) and switches all five readers in the same commit; `declaresProduction` reads `spec.side ?? type.produces_for`. A test per reader |
| S-8 | 3 × 9 | `requestBuild(unit, line, 1)`, `spend(1, …)` | 3 builds the side-1 path; 9's spender calls it | consistent (ask 10: no second spend path) | — |
| S-9 | 3 × 10 | `requestBuild(unitId)` | the five plans and `boughtProbe` call it with no line or side | consistent: trailing defaults | — |
| S-10 | 4 × 9 | the per-line contest | 4 implements `1 - line.side`; 9 needs a KDF squad to freeze side 1's line | consistent; the mirror is pinned in Task 4 | — |
| S-11 | 5 × 5b | `setRally`/`clearRally`/`canSetRally` | 5 defines; 5b carries them as commands | consistent | — |
| S-12 | 5b × 6 | the command path | 6's fixtures cancel and rally through commands, so N2's `economyReplay(…, 'command')` reproduces the new pin | consistent once 5b precedes 6 | order 5b before 6 |
| S-13 | 6 × 9 | `economyHash`'s line fold | 6 folds every line with its side; 9 adds side-1 lines | consistent: 6 folds side 1's lines though no pinned fixture has one (Task 9's tests cover them) | — |
| S-14 | 7 × 9 | `enemy.production` | 7 types and validates it; 9 reads it | **Conflict:** the 11 Oct note found `tag` cannot be `commit`ted (a trigger addresses a placement's `group`) | **R-F4-7:** the field is `group`, given to every built unit; `tag` is dropped from the schema. Task 9's commit test addresses it |
| S-15 | 7 × 4 | a side-1 camp | 7 makes one; 4's mirror test needs one before 7 lands | consistent: Task 4's fixture uses a structure TYPE with `produces_for: 1` | — |
| S-16 | 8 × 9 | `spendDown(menu, last, purse, popRoom, lineIdle)` | 8 defines; 9 calls it once a tick per idle side-1 line | consistent | — |
| S-17 | 1 × 10 | serial timings | 1 measures; 10 re-times | five plans, not three (#542); UZ III queues an `inf_squad` at 160 s while its 150 s `mortar_team` (18 s) is building, so it is the one plan whose serial timing moves (R) | Task 1 measures all five plus the two `boughtProbe`s |
| S-18 | 11 × all | docs | — | the network spec and the N3 prep note's gap rows should say which asks landed | Task 11 Step 4 added |

**Each task, on itself**

| task | self-consistent? | found |
|---|---|---|
| 1 | yes | must measure on F2 + N2's tree; five plans, two probes; D9/D10 are ruled already (R-F4-4) |
| 2 | fixed | queue bound and start rule added (R-F4-6); tests cover both |
| 2b | yes | absent context must be byte-identical; its falsification is the ask's own (feed side 1 side 0's rate, `ECONOMY_PIN` red: `logisticsOf(1)` is hashed) |
| 3 | fixed | the hash fold (R-F4-8); `ctx.unitInfo` is KDF-only, so side-1 builds need the side on the lookup (R-F4-5); `firstRefusal` needs the line for "queue full" |
| 4 | yes | reuses F2's `holdView`; `contestedIn`/`enemyNear` untouched (ask 9) |
| 5 | yes | rally per side; `canSetRally` is the click-time pre-check |
| 5b | yes | five kinds through one set-aside list; `COMMAND_KINDS`/`cleanCommand`/`validateCommand` in the same commit (P1 pin) |
| 6 | yes | moves four pins for one reason; the command-path equivalence extends to the cancel and the rally |
| 7 | fixed | `group` not `tag` (R-F4-7); the five readers, one render-side (R-F4-9); the line bound per side (R-F4-4) |
| 8 | yes | whole-logistics purse (S-2) |
| 9 | fixed | "no `built` for side 1" became "`built` side 1, app silent" (R-F4-1); side 1's start/rate source when `ctx.economy` is absent is `enemy.production` |
| 10 | yes | F2's banking gates re-read; largest queue printed (R-F4-4) |
| 11 | yes | LD6 closure recorded |

**R-F4-5 (from row 3).** `MissionContext.unitInfo` takes the side:
`(unitId: string, side: 0 | 1) => { … } | null`, and the runtime always passes it. Every shipped
site (`main.ts` ~L2617, `playtest-run.ts` ~L329, the harness sites) is a one-parameter lambda that
answers `faction === 'kdf'` only; it still type-checks, so side 1 is refused "not available in the
field" everywhere until a caller answers for it. Task 9's probe and the sim tests do; N3's
rules-file loader answers from the doctrine menu. *Cost if wrong:* a second context member
(`enemyUnitInfo`) instead, in Tasks 3 and 9.

**Against F2's branch (`feat/gf2-held-ground` `61f2f04a`)**

| # | shared | F2 has | F4 needs | found | ruling |
|---|---|---|---|---|---|
| F-1 | `mission.ts` purse | `private readonly purse = new Int32Array(2)`, `PURSE_UNITS` 2400 (module-private, ~L536), `logisticsOf(side)`, `requestBuild` spends `purse[0]` (~L1217) | `spend`/`refund` on `purse[side]` | consistent; `PURSE_UNITS` stays private (both live in `mission.ts`) | — |
| F-2 | base accrual | `baseUnitsPerTick()` side 0 only, halved while the convoy is cut (C-R17); `stepIncome` adds it to `purse[0]` | ask 7: a base rate per side, the convoy halving side 0's only | consistent extension | Task 2b: `baseUnitsPerTick(side)`; side 1's ignores the convoy |
| F-3 | step order | `stepIncome` runs before the deploy loop (~L1652 then ~L1657) | the line advance takes the deploy loop's place | consistent: a purse paid this tick can be spent next tick, as today | keep the advance after `stepIncome` |
| F-4 | `rearOf(side)` (C-R17) | `structureExit(productionAnchor(side))`, else `player_start` for side 0 | lines per camp; Task 7's override | consistent: `rearOf` stays "first living anchor"; with the override a side-1 camp becomes side 1's rear, as C-R17 intends ("once side 1 has a camp") | R-F4-9 routes `productionAnchor` through the override |
| F-5 | contest | `CONTEST_RADIUS_SQ` in `tuning.ts` (C-R7); `holdView: HoldView & VentView` (~L726, `isAir`, `tunnelIn`) | D1 per line | consistent | Task 4 reuses `holdView` and imports the constant |
| F-6 | `economyHash` | appends `logisticsOf(1)`, zone states and cut codes after F3's words (C-R17, C-R18) | Task 6's line fold | consistent: Task 6 replaces the build-queue fold IN PLACE (after intel, before the identifications) and appends nothing after F2's words | — |
| F-7 | `MissionContext` | `roadMask` filled at eight non-test sites (F2 tip; C-R4 listed seven) | `economy`, optional | consistent: absent at every site, so no site changes | — |
| F-8 | `population(side)` (F3) | side 0 counts `buildQueue` only (F3 D2) | per-side line reservation | consistent; replaced in Task 3 | — |
| F-9 | `MISSION_EVENT_KINDS`, `cues.ts`, `alerts.test.ts` | F2 adds `zoneHolder`, `corridor` (silent rows) | F4 adds no kind; `built` gains a field | consistent | R-F4-1 |
| F-10 | playtest | F2's 36 banking lines, `BANKING_OVER_30_WINNERS` 15, `ZONE_PASSIVE_INCOME` 0; F2 Task 8 data **held for the lead** (C-R1) | Task 10 re-proves | serial timing can move a plan's purse at the end, so the banking line can move | Task 10 re-reads both gates; if F2's Task 8 data lands before F4, re-read the baselines |
| F-11 | `determinism.test.ts` | the flat fixture already stands a camp (`ECO_CAMP` at (6,30)), two income zones and a convoy | Task 6 adds a second camp, a cancel, a rally and a contest | consistent | place the second camp clear of `depot`/`crossroads` and the convoy route so F2's zone words do not move for a second reason; Task 6 Step 1 says so |

**Against N2's plan (`2026-10-16-net-n2-sim.md`, on `main`)**

| # | shared file | N2 produces | F4 consumes | found | ruling |
|---|---|---|---|---|---|
| N-1 | `sim.ts` `Command`, `RuntimeCommand`, `queueCommand`, `takeRuntimeCommands`, R-3 discard | `build`, `support`, `setStance`; `RuntimeCommand = Extract<…'build' \| 'support'>` | three more runtime kinds, `build.line?` | consistent: widen the `Extract`, one set-aside list, the R-3 discard covers all five | Task 5b |
| N-2 | `mission.ts` `canBuild`, `canSupport`, `applyQueued` | `canBuild(unitId)`; `applyQueued` skips `side !== 0` and calls `requestBuild(c.unit)` | per-side `canBuild`; three more kinds | consistent: trailing parameters; `applyQueued` becomes a `switch` with the skip first | Tasks 3 and 5b |
| N-3 | `protocol.ts` `COMMAND_KINDS`, `cleanCommand`; `ownership.ts` `validateCommand` | the `build`/`support` cases; the versus drop | three cases, `build.line` | consistent; net imports the two bounds from `@lions/sim`, as N2 imports `FIRE_SUPPORT_KINDS` | Task 5b updates `packages/net/package.json`'s description |
| N-4 | `tools/src/net/mcp-tools.ts` `ORDER_VERBS` | excludes `setStance`, `build`, `support` | excludes `cancelBuild`, `setRally`, `clearRally` | consistent | Task 5b |
| N-5 | `ui/advisor.ts` `describeCommand` | first line `'ids' in cmd ? … : 0`; two keys | three cases, three keys | consistent | Task 5b |
| N-6 | `determinism.test.ts` | `economyReplay(…, via)`, `reliefEconomyReplay(…, via)`, the equivalence test; `RUNTIME_DIGEST_PIN`/`_RELIEF` born | Task 6's fixtures and re-pin | consistent; the digest pins fold `economyHash()` first, so they move with Task 6 | named in Task 6's commit |
| N-7 | `ui/production.ts` (N2 Task 5) | dispatches `{ kind: 'build', side: 0, unit }` after `canBuild(unit.id)` | nothing (the dock per line is Lane A's) | consistent | — |
| N-8 | N2 Task 5's falsification M2 | reads `rt.production[0].startTick` | — | **N2 defect, not F4's:** the `production` getter has `doneTicks`/`totalTicks`/`ticksLeft` and no `startTick`, on `main` and on F2 | report to N2's controller (read `doneTicks`); F4 does not depend on it |
| N-9 | `digest()` (N2 Task 6) | folds `economyHash()` first; R-5 lists what it skips | lines, rally and contest live in `economyHash` from Task 6 | consistent: no digest edit in F4 | — |
| N-10 | N2 Task 8 (N3's) | `humanHeld` skips | nothing | out of F4 | — |

## Global pins that keep single-player and side 0 byte-identical

Read back unchanged after every task, and quoted in each commit:
- the sim pins (flat, relief, orders): **935671699 / 2842924511 / 3272041047** (re-read at
  pre-flight): every task;
- `ECONOMY_PIN` / `_RELIEF` and `RUNTIME_DIGEST_PIN` / `_RELIEF`: every task **except Task 6**, which
  moves all four once;
- N2's command-path equivalence (`economyReplay(…, 'command')`): every task;
- the versus pins (`versus-force.test.ts`, `match-world.test.ts`, `per-seat-types.test.ts`,
  `versus-breach.test.ts`'s `pinWindow`, `two-client.test.ts`) and `shippedContentDigest()`: every
  task (a room runs no runtime until N3; F4 changes no unit, structure or map JSON);
- `pnpm balance`: byte-identical at every commit;
- `pnpm playtest`: byte-identical at every commit except the lines named in Task 10.


---

## History: the dated refreshes before 16 Oct (line hints stale; kept as the record)

### Changed since 4 Oct

Refreshed against `main` `b44df7aa` (v0.121.4, 6 Oct). What F4 replaces is unchanged: the flat `buildQueue` (`mission.ts` ~L525), `productionAnchor` (~L601), `buildBlockedReason` and its "field camp destroyed — no production" (~L609–628), `requestBuild` (~L679), the deploy loop (~L1079–1095), `CONTEST_RADIUS_SQ` (~L416) and `contestedIn` (~L1575). *(Line refs re-read on `f2d5d9e8`, 11 Oct; they moved +8 to +13. Locate by symbol.)*

- **#402 infantry halt and kneel to fire** (`7962b6ea`, a lead-approved one-off sim change; `packages/sim` otherwise stays closed until Stage 4). 15 foot types fire only while kneeling; a stopped unit kneels; a plain `move` runs through holding fire; an arrived attack-mover is walked on by `stepSweep`; a foot patroller halts on contact (`stepPatrols`, `mission.ts` ~L1536). Kneel 0.2 s (`KNEEL_DROP_TICKS` = `KNEEL_RISE_TICKS` = 4), final. Sim pins 2109596329 / 1425295494 (4 Oct) → **922714084 / 3200430224**.
- **GH-382** re-grounded 19 maps. `deir_amun_2_foothold`'s camp moved (26,34) → (21,35); `deirAmun2Plan`'s gate `M(15, 27)` → `M(15, 31)`; `wadi_halam_2_laager`'s anchor (18,21) → (21,25). Task 1's serial predictions were never measured; measure them on this ground. `bs_ladder.ts:97` (report-only, not CI) also buys one `inf_squad` at 120 s in Beit Sahwan II.
- **Camp census, corrected:** no map has ever carried a `c` tile (not at `751b6742`, `067fab9a` or `b44df7aa`). Six missions stand **one** camp each, all through `structures`: `beit_sahwan_2_foothold` (2,20), `deir_amun_2_foothold` (21,35), `khan_rafid_2_foothold` (20,38), `qarn_hadid_2_foothold` (25,34), `umm_zeitoun_2_buildup` (20,43), `wadi_halam_3_counterraid` (3,20). No mission has two.
- **GH-330:** `CAMPAIGN_CREDITS` (`packages/app/src/ui/stores-model.ts` ~L63) must equal `LADDER_CREDITS` (`tools/src/campaign_credits.test.ts`). Both read **5870** on `f2d5d9e8` (5830 on `b44df7aa`, 5736 on 4 Oct; #431 and #444 moved it). A ladder re-pin moves both in one commit.
- **#374 Pixi retired:** the rally marker is drawn by three only. The dock shows a "deploying" chip for a bought type whose GLB has not landed (`meshPending`, `ui/production.ts`).

**Interactions (R, read from source; none measured):**
- **D5 rally `move` under #402.** *(Pre-flight 2, 2026-10-11: the attack-move half of this bullet is
  stale; since #537 a no-sweep attack-move holds at its goal. Ruling (lead, 2026-10-11): the rally is a no-sweep attack-move.)* A rallied foot unit runs to the point holding fire the whole way, even under fire (`sim.ts` ~L3828). It kneels on arrival and stays there (`stepSweep` skips `attackMove` 0, `sim.ts` ~L5177). An attack-move would fight its way there, but on arrival `stepSweep` would walk it on: toward a current target in cover, or else to the nearest enemy position its side has recorded, which since #402 includes an identified enemy out of reach. So it would not hold the rally point. The player's right-click is always an attack-move (`input/intents.ts` ~L285/324/337), and there is no plain-move button. Task 9's bought enemy units walking to `rally` behave the same way. A trigger `commit` re-orders them as an attack-move (`mission.ts` ~L1701).
- **At the exit.** `spawn` resets the unit to `BRACE_NONE` (`sim.ts` ~L1757). `runtime.step` runs after `sim.tick`, so a rally `move` queued on the deploy tick is applied before the next tick's `stepBrace`: the unit never drops, and starts 0 ticks late. With no rally the unit kneels at the exit (4 ticks), and a rally set later costs it a 4-tick rise. Successive units still deploy onto the one exit tile (`structureExit`, `sim.ts` ~L4526), as today.
- **D1 contested.** The rule is unchanged by #402. A foot patroller that makes contact now stays where it met the player and can hold a camp contested. No shipped camp mission has a foot patroller near its camp (they are `moto_rpg` and `technical`, vehicles, which #402 leaves alone). The building plans' camps sit near what the enemy is sent to:
  - Beit Sahwan II: all three waves go to `kdf_assembly`, 5.0 tiles from the exit (1.5,19.5). Unchanged since 4 Oct.
  - Deir Amun II: the 110 s wave and the `pump_yard` commit go to `pump_gate`, 5.4 tiles from the exit (20.5,34.5); it was 11.2 tiles before GH-382. The 340 s wave goes to `ford_centre`, 5.1 tiles away.
  - Khan Rafid II: its technical patrols y = 34, about 3.5 tiles from the exit (19.5,37.5).

#### For the lead
1. **D5 vs #402.** Should the rally order stay a plain `move`? It holds the point, but the unit does not shoot back on the way, and it is an order the player cannot otherwise give. Or should it be an attack-move, which fights on the way but is walked off the point by the closing rule? Or a third rule, such as an attack-move that halts on arrival (new sim behaviour)?
   **Ruled 6 Oct (lead):** add a "Hold position" order (`2026-10-06-hold-position.md`, on `main` Wed 4 Nov, before F4). The rally point issues Hold on arrival. A held unit stays put, kneels, fires at anything in range, and never advances, chases or closes. The walk to the point stays D5's `move`.
2. **Task 9 / D7–D8.** The same question for the enemy's bought units walking to their `rally` marker. By `move` they walk past KDF troops holding fire, and #402's halt-on-contact covers patrollers only.
   **Ruled 6 Oct (lead):** likewise. The enemy's bought units issue Hold on arrival at their `rally` marker. A trigger's `commit` (an attack-move) releases them.
   *(Pre-flight 2, 2026-10-11: items 1 and 2 were reopened by #537. Ruling (lead, 2026-10-11): the rally and the enemy's bought units use a no-sweep attack-move; no Hold.)*
3. **D1 vs GH-382.** Deir Amun II's gate fight now falls inside the camp's 6-tile radius, as Beit Sahwan II's wave target already did. Under D1 both lines would pause whenever a wave arrives. Is that the intended "no production while contested", or should contest be measured another way (a smaller radius, or the camp footprint rather than the exit)?
   **Ruled 6 Oct:** intended. A contested camp pauses; D1 stands as written.

### Pre-flight 2 (2026-10-11), evening, against main 49715ff9

Read and grepped, not run.

- **#537 removed the reason for D5's shape.** D5 (and its 6 Oct ruling) made the rally a `move`
  followed by Hold on arrival because "an attack-move would fight its way there, but on arrival
  `stepSweep` would walk it on". Since #537 `stepSweep` walks on only an attack-move that set
  `sweep: true` (waves, `commit`s, `targets.ts`). A no-sweep attack-move fights its way to the point
  and holds there with no arrival hook. The same is true of Task 9's bought enemy units walking to
  `rally`. A trigger `commit` still sweeps, so it still sends them on. See the decision below.
- **Hold has no sim command** (ruling (lead, 2026-10-11)). Task 5's "a rallied unit holds on arrival"
  and Task 9's "hold there on arrival" are re-written below for a no-sweep attack-move.
- **Five plans build now, not three.** #542 added buying to **Wadi Halam IV** (`wadiHalam4Plan`,
  `inf_squad` as logistics allow, ~L612) and **Umm Zeitoun III** (`ummZeitoun3Plan`, a mortar then
  rifles, ~L2314), beside BS II, DA II and WH II. Neither stands a camp (they deploy at the start
  marker, as WH II does). Task 10 re-proves all five, and "Lines that move" in Global Constraints is
  their five lines.
- **Task 9's probe seeds.** `main` now has a 30-seed harness (#539, #542): seeds 424242 then 1..29,
  `passive-sweep.ts` and `plan-sweep.ts` with a worker pool. The G3 sheet's list on
  `spike/skirmish-g0` is a different set. Recommended (default, not a question): run the probe over
  `main`'s set and reuse its worker pattern, and say in the probe that it is not the G3 set. `PT_SEED`
  is read in `playtest-run.ts` (~L228), not `playtest.ts` ~L201; the passive controls are
  `passiveAcrossSeeds` calls.

| where | correction | |
|---|---|---|
| Changed since 4 Oct (D5 under #402), D5, For the lead 1 and 2 | The closing rule no longer walks a no-sweep attack-mover off its goal (#537) | dated notes in place; **ruled** below |
| Task 5 Step 1, Step 3; Task 9 Step 1 | The "holds on arrival" test and its control ("where an attack-mover would be walked off") rest on the old closing rule. Under the recommended answer the control becomes a `sweep: true` attack-move, which is walked off | dated notes in place |
| Global, Re-pins | Sim pins are **three**: flat `1202444260`, relief `3354895120`, orders `2737216487`. Unmoved (R) | fixed in place |
| Global, Re-pins, Task 10 | `LADDER_CREDITS` = `CAMPAIGN_CREDITS` = **5917** (`playtest.ts` ~L3096; `GATES` ~L2820) | fixed in place |
| Global, Task 10 | Playtest holds every plan, control and gate on 30 seeds (~57 s locally). Serial lines and the contested pause must keep all five building plans at 30/30 | fixed in place |
| Task 10 Step 2 | `deirAmun2Plan` is at ~L1413 (its `M(15, 31)` orders ~L1423-1437); unchanged by #542 | noted |
| Order of landing | #540 (time limit) lands Wed 4 Nov, before F1 (ruling (lead, 2026-10-11)). The five building plans' slowest 30-seed wins must stay inside their limits after the serial lines slow them | noted |

#### Ruling (lead, 2026-10-11): the rally order

**The rally order is a plain attack-move without `sweep`**, for the player's rally and for the enemy's
bought units alike: they fight on the way (a foot unit halts to fire under #402) and hold on arrival,
with no arrival hook, no Hold command (retired the same day) and no runtime list of rallied ids. A
trigger `commit`, which sweeps, still sends the enemy's units on. The options as they were put are in
PR #544's first commit (`fb25a54f`).

---

### Pre-flight, 11 Oct (against main f2d5d9e8)

Read against `main` `f2d5d9e8` (11 Oct). Docs only; nothing measured. Sim pins still **922714084 / 3200430224**
(unchanged since #402). The camp census holds: six missions, one camp each, all through `structures`, none with
`side`, no `c` tile on any map. The three `playtest` plans that build are at the lines the plan names.

**Landed since `b44df7aa` that touches this plan:**
- **#431, #444:** `LADDER_CREDITS` and `CAMPAIGN_CREDITS` are **5870** (5830 → 5868 → 5870). #431 also edited `MissionRuntime` (`razeExempt`, built in `start()`); F4's Task 3 builds its lines in the same place, so merge carefully. It does not touch production.
- **#428/#461 alert language:** tier, tone and place on every feed line; Space jumps to the latest important/major alert; the alert ring flashes the minimap.
- **#454 chrome register:** credits `--commend`, this mission's logistics/intel `--info`, selected `--selected`, `--on` for a live state only, `--disabled-opacity`, button-case rule; pinned by `ui/chrome-register.test.ts`.
- **#426 cue table (`ui/cues.ts`):** every `MissionEvent` kind needs a row. F4 adds no kind (see Q5/Q6).
- **#474/#479 memory gate:** deferred buildables are decoded only when `runtime.production` lists them (`warmUnitMesh`, `main.ts`). Serial lines change who is listed when (Task 3).
- **#427, #457:** armed orders take the ground point; the move cursor and the marker a move leaves share `ORDER_GROUND_COLOR_KEY` (lime, `vfx.tracer`).
- **#488 tutorial:** `data/tutorial/beit_sahwan_0.json` has **9 steps and no economy beat**; the tutorial mission has no `resources`, no camp, no dock reveal.
- **Hold position (`2026-10-06-hold-position.md`):** still a plan on `main`; `hold`/`holdPos` do not exist yet. F4's rally arrival depends on it, as the 6 Oct ruling says.

| task | what changed | fixed in place / question |
|---|---|---|
| all | `mission.ts` moved +8 to +13 lines (e.g. `buildQueue` L517 → ~L525, `contestedIn` L1562 → ~L1575, `production` getter L791 → ~L799, `spawnPlacement` L1250 → ~L1259, commit L1688 → ~L1701); `sim.ts` `structureExit` 4530 → ~4526, brace line 3829 → ~3828 | fixed in place (all refs now "~L", locate by symbol) |
| all | `input/intents.ts` attack-move sites 270/292/305 → ~285/324/337; `main.ts` unit lookup 2102–2110 → `unitInfo` ~L2332 | fixed in place |
| 10, re-pins | `LADDER_CREDITS` 5830 → **5870** (`playtest.ts` ~L3195, was ~L3181); `CAMPAIGN_CREDITS` 5830 → 5870; `stores-model.ts` comment still says 5,736 (not ours) | fixed in place |
| 3 | `main.ts` calls `three.warmUnitMesh(p.unit)` for every item in `runtime.production` each tick (GH-469). A serial line that lists only its current item would decode the second type's textures late | fixed in place: the flattened getter lists queued items (`doneTicks` 0); new test in Task 3 |
| 3, Global | Memory gate: `DEFAULT_MISSIONS` are three `resources` missions with no camp and no builds in the walk | fixed in place (Global Constraints note); F4 moves no reading unless a task adds a build or `enemy.production` to a walked mission |
| 7 | `missionUnitTypes` already walks the whole mission JSON, so `enemy.production.menu` units load at boot, not cold | fixed in place (note under Task 7); adds `bitmapsMiB` only to a mission that uses it (none, D7) |
| 9 | `built` is the player's arrival signal (`alert.arrived`, announcer "reinforcements", `cues.ts` row). An enemy purchase on the same event would announce enemy units as ours | fixed in place: side-1 purchases emit no `built`; test added *(superseded 16 Oct by R-F4-1)* |
| Lane A: dock | #454 register; the dock head already carries a static `--commend` credits chip; `--info` for logistics | fixed in place (Lane A bullet) |
| Lane A: paused | #428/#461: tier/tone/place, cooldown, minimap flash through `at` | fixed in place (important, warn, app-derived from the `contested` edge, no new `MissionEvent`); Q5 |
| Lane A: rally | Armed rally is a fourth arming source (`anyArmed`, Escape); armed orders take the ground point; deny cue on a refused point; move-cursor colour | fixed in place; marker is Q4 |
| Lane A: marker | `addOrderMarker` is transient; a persistent marker is a new `Renderer` method; colour is `ORDER_GROUND_COLOR_KEY` | fixed in place (note); the mock gate stays, Q4 |
| Lane A: tutorial | Tutorial mission has no economy at all; step vocabulary has no rally intent (`INTENT_KINDS`) | not fixed; Q7 |
| Task 5 / Task 9 | Hold position still unlanded; F4 stays blocked on it (order plan already says it lands 4 Nov) | no change |
| Task 5, #402 | Brace claims re-checked: `spawn` resets `BRACE_NONE`; `stepBrace` plain-move branch "runs through"; `stepSweep` skips `attackMove` 0 | still true, no change |
| Task 4, D1 | `contestedIn` unchanged (no air skip, `tunnelIn` guard) | still true, no change |

#### For the lead (continuing the numbering above)

4. **The rally marker's mock.** The plan already gates the marker on an approved mock (no status marks in the world). Recommended mock: not a new mark, but the move order's own route line and marker (lime, `ORDER_GROUND_COLOR_KEY`) from the camp exit to the rally point, shown only while that camp's dock is open, and gone when it closes. Show the mock at 2 zoom levels on `beit_sahwan_2_foothold` before Task 5's Lane A half starts. If it is rejected, the rally point has no world mark and the dock row names it ("Rally: set" or "not set") and nothing else shows it.
5. **How "production paused" speaks.** Recommended: an `important`, `warn` feed alert on the first pause of a line (debounced), placed at the camp exit; the dock line shows "Contested: production paused"; no new `MissionEvent` kind, no minimap zone state, no world outline for a camp. Alternative: also mark the camp on the minimap like a contested zone (`--bad` dashed, pulsing).
6. **Enemy purchases are silent.** Recommended: a side-1 buy emits no `built`, no alert and no cue in Stage 4 (D7: no shipped mission buys). G-G adds an "enemy reinforcing" alert and cue when it needs one. Applied in place; overrule if you want a "hostile reinforcements" alert now. *(16 Oct: superseded by R-F4-1: a side-1 buy emits `built` with `side: 1`, and the app stays silent for it; the outcome, no alert and no cue, holds.)*
7. **The tutorial's economy step.** The 9-step tutorial has no logistics, no dock and no camp, and its step vocabulary can already await the `built` MissionEvent but has no rally intent (`INTENT_KINDS` in `input/intents.ts` lacks one, and the tutorial schema cross-checks it). Recommended: add two beats only, "build one unit" (await `mission` event `built`) and "set a rally point" (await a new `rally` intent), by giving the tutorial mission a `resources` block and revealing `dock`/`logistics`; teach the pause with the live alert on the first camp mission, not with a scripted enemy in the tutorial. This is a scope call on the tutorial (and on `beit_sahwan_0`'s length), not only a Lane A string.
8. **A first-use hint for the rally point.** Recommended: no in F4 (the dock button and the tutorial beat carry it); revisit in the polish lane if testers miss it. A hint would need a new rule field in `hint-rules.ts`.

---

**Goal:** Production gets a place, a pace and a destination, and the enemy buys the same way the
player does. Every production verb is keyed by side and travels as a `Command` (LD6), so N3 opens
side 1 to a human without a second pass.

| | today (`main` `199065f1`; F2's branch adds the per-side purse) | after F4 |
|---|---|---|
| where | beside the first living camp, else `player_start` (`productionAnchor`, `firstRefusal`) | **one production line per camp, per side**; a mission with no camp keeps one side-0 line at `player_start` |
| pace | **parallel**: five orders in one tick deploy together after one build time (M, G3 sheet) | **serial**: each line builds one unit at a time, at the `build_time_s` every unit already authors |
| contested | not a concept | **no production while the camp is contested**: the line's clock stops and nothing deploys until the ground is clear |
| destination | the unit stands at the camp exit | **a player-set rally point** per line; a finished unit attack-moves there with no sweep and holds |
| the enemy | campaign enemies are authored placements; nothing buys | a mission may give side 1 a camp, a purse and a menu; a **spend-down rule** buys through the **same request path** (serial, contested pause, F3's cap, one `spend`) |
| the wire | `build`/`support` are N2's `Command`s, side 0 only | `build` takes a line; `cancelBuild`, `setRally`, `clearRally` are `Command`s; still side 0 only and dropped in versus until N3 |

**Architecture:**
- **A production line is a small pure state machine** (`production.ts`): a queue, the item in
  progress, ticks remaining, a rally point. `MissionRuntime` owns one per production anchor per side,
  advances it once a tick with a `contested` flag, and spawns through the existing `spawnPlacement`
  path. It replaces the flat `buildQueue` array.
- **Every production verb takes a side**, defaulting to 0, and every spend and refund goes through
  one private `spend`/`refund` on F2's `purse[side]`. The human path, cancel, a camp's death and the
  AI spender share it.
- **The line verbs are `Command`s** beside N2's `build`: `queueCommand` sets them aside, the runtime
  drains them in queue order in `applyQueued` before `sim.tick()`, and a tick that starts with any
  still set aside discards them (N2's R-3). `applyQueued` skips `side !== 0` and `validateCommand`
  drops them in versus, exactly as N2 does for `build`; N3 lifts both.
- **The rally order is a sim command**, a no-sweep `attackMove` queued for the spawned ids on the
  deploy tick (ruling (lead, 2026-10-11)). Nothing new crosses the boundary, and invariant 4 holds
  (the runtime issues commands, it does not write positions).
- **The enemy's spender is a pure function** (`spendDown`) over its menu, its purse, its population
  room and its line state, so its behaviour is unit-tested before any mission authors an enemy camp.
  **No shipped campaign mission authors one in Stage 4** (D7); G-G's commander (Stage 5) and N3's
  rules file are the first real customers, and a harness probe is the witness until then.

**Tech stack:** TypeScript strict, vitest, `@lions/sim`, `@lions/net`, `packages/app` (call sites
and the advisor's command text only), `tools/`. No new dependencies.

**Spec:** the G3 decision sheet (`docs/superpowers/specs/2026-10-04-g3-decision-sheet.md`, Q3, lead
4 Oct) for the game rules; the network spec (`docs/superpowers/specs/2026-10-10-network-game-design.md`
§7.1, §11b.4) and the N3 prep note §5 (`2026-10-16-net-n3-prep.md`, PR #655; LD6) for the per-side
and `Command` shape; N2's plan for the command path F4 extends.

**Refs:**
- GH-183 F4 and F5; GH-136 (the field camp as the production site).
- GH-167 (G3) Q3, the lead on 4 Oct: *production at the field camp (one queue per camp, build time,
  no production while the camp is contested, AI spends its budget the same way). Addition: the
  player sets a rally point, where a unit goes when it is ready.*
- The G3 decision sheet (PR #369), Q3: the parallel queue, the camp missions (the sheet says 8; the
  tree has **six**, one camp each, all via `structures`, re-counted on `199065f1`), the spike's AI
  banking (3,816 unspent against a passive player; M on `spike/skirmish-g0` at `2cd77e4a`, whose sim
  does not carry #402), the officers' "never charged" prices (officers stay a deploy slot), and
  GH-115/GH-109's limits (no construction yard, no power, no sell, no mirrored tech trees).
- F2 (`2026-10-04-gf2-held-ground-income.md`, ledger `_coord/s4-f2-progress.md`): the per-side
  integer purse (C-R3), side 1's purse hashed (C-R18), the rear (C-R17), `CONTEST_RADIUS_SQ` in
  `tuning.ts` (C-R7). F3 (`2026-10-04-gf3-population-cap-on-loan.md`): the cap and the queue
  reservation.
- N2 (`2026-10-16-net-n2-sim.md`): Task 4's `build`/`support` `Command`s, `applyQueued`, `canBuild`,
  R-3; Task 6's `digest()`; D1–D4 (16 Oct, lead).
- LD6 (16 Oct, lead), `_coord/f4-per-side-asks.md`: the ten asks.
- Field works plan (`2026-09-29-field-works.md`, Stage 5): a work that produces would be a second
  line; F4 does not add any.

**Base:** `main` after **N2** has merged (which is after F2). Branch `feat/gf4-production`. Read
against `main` `199065f1`, F2's `61f2f04a` and N2's plan (refresh of 16 Oct). Nothing measured yet:
(M) is quoted from the G3 sheet (measured before GH-382 and #402), (R) is reasoned.

---

## Decisions

- **By the lead, 4 Oct (G3 Q3):** as in the table and Refs.
- **By the lead, 16 Oct (LD6):** F4 keys `requestBuild`, `cancelBuild`, `setRally`/`clearRally`,
  `firstRefusal`, the spend and `built` by side, and lands line, cancel and rally as `Command`
  fields with the net whitelist in the same PR. F4 does not open side 1 to a human.
- **Recorded from G3 (no new ruling needed):** officers stay a deploy slot and are never built from a
  line; no camp is built by the player in Stage 4 (a buildable camp is a field-works question for
  Stage 5, inside GH-115's limit).
- **Taken defaults (D1–D8 go to the lead in Task 1; D1 and D5 are already ruled):**
  - **D1. Contested** means a living, surface, ground unit of side `1 - line.side` within
    `CONTEST_RADIUS_SQ` (6 tiles, `tuning.ts`, 2359296 = (6 × 256)², compared on `>> 8` deltas) of
    the line's exit point. Aircraft do not contest a camp (#279 ruling (a), as in F1 and F2). F2's
    `HoldView` already carries the air skip and the `tunnelIn` guard, so the line test reuses it.
    The objectives' `contestedIn` (side 1 against side 0) is left alone: zone contest by seat is
    N3's (N2 D1). *Ruled 6 Oct: GH-382's Deir Amun II gate fight inside the radius is intended.*
  - **D2. A mission with no camp keeps one side-0 line at `player_start`**, and the contested rule
    applies to that point too (#183 F4). A mission with neither builds nothing, as today. **Side 1
    never falls back to `player_start`** (LD6 ask 3): a side with no camp of its own has no line.
  - **D3. Pay at queue time, as today.** Cancelling a queued item refunds it in full; cancelling the
    item in progress refunds it in full too (the unit never existed). The F3 population reservation
    is released with it. The refund goes to the line's own side's purse.
  - **D4. A camp that dies loses its line**: the item in progress is lost, queued items are refunded,
    and the rally point goes with it. Today's "field camp destroyed — no production" stands once the
    side's last camp is gone.
  - **D5. The rally order is a no-sweep `attackMove` (ruling (lead, 2026-10-11)).** A rally point on
    a blocked tile is refused (the set call returns false), never snapped. A rally point is per line
    and survives until cleared or the camp dies. No rally point: the unit stays at the exit.
  - **D6. Which line a build goes to**: the line the caller names (an index into
    `productionLines(side)`); with none named, that side's line with the fewest items, ties to the
    lowest index. Index order is structure index order and stable for the mission (LD6 ask 6).
  - **D7. No shipped campaign mission gives side 1 a camp in Stage 4.** The enemy half is proved on
    fixtures and a harness probe (Task 9).
  - **D8. The spend-down rule**: whenever side 1's line is idle and its purse covers the cheapest
    menu item that fits its population room, it buys the next affordable item in menu order
    (round-robin from the last item bought). It never banks for a dearer item. Deterministic, no
    `rng`, and it spends to zero.
- **Ruled 15 Oct (coordinator, lead-delegated window):** R-F4-1 to R-F4-4 above (`built` side,
  `MissionContext.economy`, `productionOf(side)`, the two bounds). **Refresh rulings, 16 Oct:**
  R-F4-5 to R-F4-9 in the pre-flight scan.

---

## Global Constraints

- **The four invariants hold.** Line clocks are integer ticks. No `rng` (D8 is deterministic by
  construction). The runtime issues no-sweep `attackMove` commands through `sim.queueCommand`; it
  never writes a position. No floating point added; the purse stays F2's integer 1/2400ths.
- **One sim plan in flight:** F4 starts after N2 merges. `pnpm test:determinism`, `pnpm typecheck`
  and `pnpm lint` pass before every commit touching `packages/sim`.
- **`COMMAND_KINDS`, `cleanCommand` and `validateCommand` change in the same commit as the
  `Command` union** (N2 P1's compile-time pin), with `describeCommand`, its `en.json` keys and
  `ORDER_VERBS`' filter in `tools/src/net/mcp-tools.ts`.
- **F4 keeps the side-0 skip and the versus drop.** `applyQueued` skips `side !== 0` for all five
  runtime kinds and `validateCommand` drops all five in versus. Side 1 is reached only by a direct
  call (sim tests) and the AI spender.
- **Pins** (re-read every value at pre-flight; the tree is the reference):
  - sim pins flat / relief / orders **935671699 / 2842924511 / 3272041047** on `main` and F2:
    unmoved by every task (R: the golden replays build no `MissionRuntime`). A move is a defect.
  - `ECONOMY_PIN` / `ECONOMY_PIN_RELIEF`: F2's **275731552 / 145368021** (`9f4fd7d7`; F2's final wave
    is open, re-read). **Move once, in Task 6.**
  - `RUNTIME_DIGEST_PIN` / `_RELIEF`: born in N2 Task 6 (value: re-read). **Move with the economy
    pins, in Task 6 only**, since `digest()` folds `economyHash()` first.
  - The guards in "Global pins that keep single-player and side 0 byte-identical" above.
- **`pnpm balance`** byte-identical (R).
- **`pnpm playtest`**: exit 0 at every commit, every plan and gate on 30 seeds. Lines that may move
  are the plans that build (`beit_sahwan_2_foothold`, `deir_amun_2_foothold`, `wadi_halam_2_laager`,
  `wadi_halam_4_village`, `umm_zeitoun_3_clearance`) and the two `boughtProbe` lines
  (`beit_sahwan_4_subterranean`, `umm_zeitoun_4_clearance`: one build each at `player_start`, so
  only D2's contest can move them, R). Every plan still wins; every passive control still loses;
  every win stays inside its `time_limit_s` (#540). `maxTierProbes` replays the building plans at
  max tier too.
- **The memory gate is untouched** (#474/#479). `DEFAULT_MISSIONS` (`tools/src/perf/memory.ts`) are
  three `resources` missions with no camp and no builds in the walk. If a task adds a build order or
  `enemy.production` to a walked mission, re-read `bitmapsMiB` and `memory-budgets.ts`.
- **Every check seen red**, by a one-line mutation, quoted in the commit. A survivor is disclosed.
- **Gates before every commit:** as F1, plus `pnpm validate:data` for Task 7 and
  `pnpm validate:ui` for Tasks 3 and 5b (new `en.json` keys).
- **Git:** `/usr/bin/git` by absolute path, one plain command per call; commit with
  `/usr/bin/git commit -s -F <msgfile> -- <paths>`; never `git add -A`, `git stash`,
  `git checkout -- <file>`, a rebase or a force-push; messages end with a blank line and
  `Co-Authored-By: Claude <model name> <noreply@anthropic.com>`. Never start or kill a dev server;
  never `pkill`; `pnpm ui:routes` and `pnpm golden-baseline` run on CI only.
- **Lane:** the dock, the rally input and its marker are WP-S-F's (Lane A). F4 edits the app only
  where `typecheck` forces it, the `built` filters (R-F4-1) and `describeCommand` (Task 5b).

## Review Focus

1. **A build and a cancel for the same line in one frame**, in either order. Expected: they run in
   the order sent (one set-aside list, drained in queue order): build-then-cancel refunds in full and
   leaves the line empty; cancel-then-build refuses the cancel (nothing there yet) and queues the
   build. Pinned in Task 5b.
2. **A cancel naming an index past the queue's end, a line the side does not own, or a line on a
   camp that died this tick.** Expected: refused, no refund, no state change. Pinned in Task 3.
3. **The camp dies on the tick its item would finish.** Expected: D4, the item is lost and not
   deployed (the death is read before the advance), the queue refunded. Pinned in Task 3.
4. **A rally set on the tick its item finishes, through the command path.** Expected: `applyQueued`
   runs before `sim.tick()`, so the item that finishes on that tick walks to the new point. Pinned
   in Task 5b.
5. **A side-0 line next to a side-1 drone, and a side-1 line next to a side-1 squad.** Expected:
   neither is contested (aircraft; own side). Pinned in Task 4.

---

## File structure

| File | Role | Task |
|---|---|---|
| `docs/campaign/economy/production-numbers.md` | **New.** G-NUM and the D-list for the lead | 1 |
| `packages/sim/src/production.ts` (+ test) | **New.** Pure: `ProductionLine`, `advance`, `enqueue`, `cancel`, `lineContested`; `spendDown` | 2, 4, 8 |
| `packages/sim/src/tuning.ts` | `MAX_PRODUCTION_LINES`, `MAX_LINE_QUEUE` (R-F4-4) | 2 |
| `packages/sim/src/mission.ts` (+ `mission.test.ts`, new `production-runtime.test.ts`) | `MissionContext.economy`; per-side base accrual; lines per anchor per side; `spend`/`refund`; per-side refusals; contested; rally; `productionOf`; `built.side`; the enemy purse and spender; `applyQueued`'s five kinds | 2b, 3, 4, 5, 5b, 9 |
| `packages/sim/src/sim.ts` | `Command` gains `cancelBuild`, `setRally`, `clearRally` and `build.line?`; `RuntimeCommand`; `queueCommand`; `structureProducesFor` (R-F4-9) | 5b, 7 |
| `packages/sim/src/structures.ts`, `data/schemas/mission.schema.json` | `structures[].side`; `enemy.production` | 7 |
| `packages/render/src/three/ThreeRenderer.ts` (+ test) | `structureIsOwn` reads `sim.structureProducesFor(s)` (R-F4-9) | 7 |
| `tools/validate_production.mjs` (+ `.d.mts`), `tools/src/validate_production.test.ts`, `tools/validate_data.mjs` | the `enemy.production` and line-count rules | 7 |
| `packages/sim/src/determinism.test.ts` | The economy and runtime-digest re-pin | 6 |
| `packages/sim/src/index.ts` | exports `productionOf`'s row type, `lineContested`, the two bounds | 2, 3, 4 |
| `packages/net/src/protocol.ts`, `ownership.ts` (+ tests), `packages/net/package.json` | three kinds and `build.line` on the wire | 5b |
| `packages/app/src/ui/advisor.ts` (+ test), `packages/app/src/i18n/en.json` | `describeCommand` for the three kinds | 5b |
| `packages/app/src/ui/alerts.ts`, `voice/announce.ts`, `tutorial/runtime.ts` (+ tests), `main.ts` | `built` filtered to side 0 (R-F4-1); call sites `typecheck` forces (`production` stays the same shape) | 3 |
| `tools/src/audio/mix-scenes.ts` | a `built` literal gains `side: 0` | 3 |
| `tools/src/net/mcp-tools.ts` (+ test) | `ORDER_VERBS` excludes the three kinds | 5b |
| `tools/src/backtest/playtest.ts` | Plan re-proofs | 10 |
| `tools/src/backtest/enemy-production-probe.ts` | **New.** The witness for D7/D8 | 9 |
| `docs/GDD.md` §3, `docs/campaign/README.md`, `CLAUDE.md`, `docs/HANDOVER.md`, the network spec | Contract and ledger | 11 |

---

## Task 1: the numbers and the D-list (G-NUM; halts for the lead)

**Model:** opus. **Agent:** `balance-analyst`.

- [ ] **Step 1: Serial timing on today's plans.** On a scratch copy of the runtime with a serial
  queue and D1's contest (never a tracked edit), on the F2 + N2 tree, run the five building plans and
  the two `boughtProbe` lines over the 30-seed set (`SWEEP_SEEDS`, 424242 then 1..29) and report,
  per build: queue tick, deploy tick parallel vs serial, ticks frozen by contest, the largest queue
  reached, and the outcome line. The plans are on `playtest.ts` (`main` hints; F2 adds ~59 lines):
  BS II one `inf_squad` at 120 s (`led2`, ~L204); WH II every 60 s from 90 to 700 (`wh2`, ~L575);
  `wadiHalam4Plan` every 10 s from 1 to 400 (~L725); `deirAmun2Plan` every 40 s from 60 to 420
  (~L1653, camp (21,35)); `ummZeitoun3Plan` a `mortar_team` then rifles every 10 s from 150 s
  (~L2679). Reasoned: UZ III is the one whose serial timing moves (a 160 s `inf_squad` waits on the
  150 s mortar's 18 s); BS II and DA II can move by contest (their wave targets lie within 6 tiles of
  the camp exit); WH II, WH IV and UZ III have no camp, so D2's contest applies at their
  `player_start`. `boughtProbe` is ~L2966.
- [ ] **Step 2: Build times.** Tabulate `cost.build_time_s` (read as `unitInfo(...).buildTimeS`,
  `main.ts` ~L2617) for every buildable KDF unit (12 s `recon_drone` to 50 s `heli_peten_gunship`
  on `199065f1`), and for the Sarim menu units N3 will sell (`sarim_rifles` 26 s, `atgm_cell` 20,
  `manpad_team` 18, `rocket_battery` 40, `gun_truck` 13, `recoilless_team` 16). At 7 minutes a 30 s
  unit is 14 a line at most. Flag any time that makes a five-to-seven-minute mission's dock
  pointless or instant.
- [ ] **Step 3: The D-list.** D1–D8 go to the lead in one comment on #183, each with its alternative
  (D1 and D5 are ruled; R-F4-1 to R-F4-4 are listed as ruled in the lead-delegated window, for
  overrule). Record the answer and the date. Tasks 3–9 read only the answered rules.

---

## Task 2: the production line, as a pure state machine

**Model:** sonnet. **Agent:** `sim-guard`.

**Files:** `packages/sim/src/production.ts` (new), `production.test.ts` (new),
`packages/sim/src/tuning.ts`, `packages/sim/src/index.ts`.

**Interfaces:**

```ts
// tuning.ts (R-F4-4)
export const MAX_PRODUCTION_LINES = 4; // per side; validate:data and start() refuse more
export const MAX_LINE_QUEUE = 16;      // waiting items per line, not counting the one in progress

// production.ts
export interface LineItem { unit: string; logistics: number; intel: number; population: number; buildTicks: number }
export interface ProductionLine {
  readonly side: 0 | 1; readonly anchor: number;   // structure index, or -1 = player_start (D2, side 0 only)
  queue: LineItem[]; current: LineItem | null; ticksLeft: number;
  rally: { x: Fx; y: Fx } | null;
}
/** One tick. Returns the item that finished this tick, or null. A contested line
 *  does not count down and does not finish (G3 Q3). When an item finishes, the next
 *  queued item becomes current with its full buildTicks, counted from the next tick. */
export function advance(line: ProductionLine, contested: boolean): LineItem | null;
/** R-F4-6. False (and no change) when MAX_LINE_QUEUE items already wait. On an idle
 *  line the item becomes current at once, ticksLeft = buildTicks. */
export function enqueue(line: ProductionLine, item: LineItem): boolean;
/** D3. Removes queue index i (-1 = the item in progress) and returns it for the refund;
 *  null for an index with nothing there. */
export function cancel(line: ProductionLine, i: number): LineItem | null;
```

- [ ] **Step 1: Write the failing tests** (an item `{ unit: 'a', logistics: 300, intel: 0,
  population: 1, buildTicks: 40 }`):
  - two items enqueued on one idle line: `advance` returns the first on call 40 and the second on
    call 80, not both on call 40 (the defect G3 named);
  - 10 contested calls in the middle (calls 11–20 with `true`) move the first finish to call 50;
  - an item whose 40th count would fall on a contested call finishes on the first clear call after;
  - cancelling the item in progress (`cancel(line, -1)`) returns it; the next becomes current with
    `ticksLeft` 40, not the cancelled item's remainder;
  - cancelling queue index 0 returns that item and leaves `current` and `ticksLeft` untouched;
    `cancel(line, 1)` on a one-item queue returns null and changes nothing;
  - an empty line returns null for 100 calls and `current` stays null;
  - `enqueue` accepts 1 current + 16 waiting and returns false for the 18th item, queue length 16.
- [ ] **Step 2: Implement.** No allocation per tick on the idle path.
- [ ] **Step 3: See it red.** Decrement while contested: the contested test fails. Carry `ticksLeft`
  over from the cancelled item: the cancel test fails. Bound at `>` instead of `>=`: the 18th item is
  accepted and the bound test fails.

---

## Task 2b: the per-side start purse and base rate (LD6 ask 7)

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** F2 (merged).

**Files:** `packages/sim/src/mission.ts`, `packages/sim/src/mission.test.ts`.

**Interfaces:**

```ts
// MissionContext (R-F4-2). Whole logistics, the unit of cost.logistics and
// resources.logistics_start; the sim scales by PURSE_UNITS. A construction constant,
// not hashed (the purse it feeds is). Absent = today's sources: side 0 from `resources`,
// side 1 0 (Task 9 adds `enemy.production` as side 1's absent-context source).
economy?: {
  logisticsStart: readonly [number, number];
  logisticsRatePerMin: readonly [number, number];
};
// private, replacing F2's baseUnitsPerTick(): purse units a tick for `side`:
// 2 * rate, or rate while side 0's live convoy is cut (C-R17: the halving is side 0's only).
private baseUnitsPerTick(side: 0 | 1): number;
```

- [ ] **Step 1: Write the failing tests** (`mission.test.ts`, a fixture with no camp, no zones):
  - with `economy: { logisticsStart: [400, 640], logisticsRatePerMin: [120, 60] }`, at start
    `[logisticsOf(0), logisticsOf(1)]` is `[400, 640]`; after 1200 steps it is `[520, 700]`;
  - with no `economy`, `resources: { logistics_start: 400, logistics_rate_per_min: 120 }`: after
    1200 steps `[520, 0]` (today's behaviour);
  - with `economy` and a mission `resources` block that says otherwise, the context wins:
    `logistics_start: 50` and `logisticsStart: [400, 0]` reads 400;
  - side 1's base rate is not halved by a cut convoy: on F2's convoy fixture with the convoy cut,
    after 1200 steps side 0 earned 60 and side 1 earned 60 with rates `[120, 60]`;
  - `logisticsStart: [0, 894785]` throws at construction, `'mission <id>: economy.logisticsStart[1]
    894785 is above 894784, the largest start an Int32 purse in 1/2400ths holds'`; `[0, 894784]`
    constructs and reads `logisticsOf(1)` 894784 (R-F4-4).
- [ ] **Step 2: Implement.** The constructor seeds `purse[s] = start[s] * PURSE_UNITS`;
  `stepIncome` adds `baseUnitsPerTick(0)` to `purse[0]` and `baseUnitsPerTick(1)` to `purse[1]`
  (and to `earnedUnits[s]`), in that order, where F2 adds side 0's today.
- [ ] **Step 3: Measure.** Every pin in "Global pins" reads back unchanged: no fixture passes
  `economy`. `pnpm playtest` and `pnpm balance` byte-identical.
- [ ] **Step 4: See it red.** Feed side 1 side 0's base rate (`baseUnitsPerTick(0)` into
  `purse[1]`): `ECONOMY_PIN` goes red, because `logisticsOf(1)` is hashed (C-R18). Apply the convoy
  halving to side 1: the cut-convoy test fails. Compare the ceiling with `>=`: the 894784 case throws.

---

## Task 3: lines in the runtime, serial, keyed by side

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Tasks 1, 2, 2b, N2.

**Files:** `packages/sim/src/mission.ts`, `packages/sim/src/production-runtime.test.ts` (new; builds
its runtime from its own literals, as N2's `runtime-commands.test.ts` does), `mission.test.ts`
(only where a `built` literal or a signature forces it), `packages/sim/src/index.ts`; app:
`ui/alerts.ts`, `voice/announce.ts`, `tutorial/runtime.ts` and their tests; `tools/src/audio/mix-scenes.ts`.

**Interfaces:**

```ts
// MissionContext (R-F4-5): the lookup is asked with the side; KDF-only callers still type-check.
unitInfo?: (unitId: string, side: 0 | 1) => { logistics: number; intel?: number; buildTimeS: number;
  unlock?: …; population: number } | null;

// MissionEvent (R-F4-1, LD6 ask 8)
| { kind: 'built'; tick: number; unit: string; side: 0 | 1 }

/** D6 / LD6 ask 1. `line` indexes `productionLines(side)`; omitted = that side's shortest queue. */
requestBuild(unitId: string, line?: number, side: 0 | 1 = 0): boolean;
/** N2's predicate, widened: true when requestBuild(unitId, line, side) would accept now. */
canBuild(unitId: string, line?: number, side: 0 | 1 = 0): boolean;
/** D3, LD6 ask 4. index -1 = the item in progress. Refunds `purse[side]` (and intel, side 0). */
cancelBuild(line: number, index: number, side: 0 | 1 = 0): boolean;
/** LD6 ask 3. The camp clause per side; side 1 never falls back to player_start. */
buildBlockedReason(unitId: string, side: 0 | 1 = 0): string | null;
popCapped(unitId: string, side: 0 | 1 = 0): boolean;
populationView(side: 0 | 1 = 0): { used: number; cap: number } | null;
/** LD6 ask 6: index order is structure index order, stable for the mission, and is the
 *  `line` every command carries. */
productionLines(side: 0 | 1): readonly { anchor: number; exit: [Fx, Fx]; queued: number;
  current: string | null; progress: number /* 0..1000, integer */; contested: boolean;
  rally: [Fx, Fx] | null }[];
/** R-F4-3. Flattened per line in line order (current, then queued). A queued item reads
 *  doneTicks 0, totalTicks = its buildTicks, ticksLeft = the ticks ahead of it plus its own. */
productionOf(side: 0 | 1): { unit: string; doneTicks: number; totalTicks: number; ticksLeft: number }[];
get production(): ReturnType<MissionRuntime['productionOf']>; // = productionOf(0); dock and warmUnitMesh
// private:
private firstRefusal(unitId: string, side: 0 | 1, line?: number): string | null;
private spend(side: 0 | 1, item: LineItem): void;   // purse[side] -= logistics * PURSE_UNITS; side 0 also intel
private refund(side: 0 | 1, item: LineItem): void;  // the exact inverse
```

`firstRefusal`'s clauses, in order: no catalogue entry (`unitInfo(unitId, side)` null); the unlock
gate; **side 1 and `intel > 0`** → `'not available in the field'` (LD6 ask 2: intel is side 0's);
the camp (side 0: today's two strings; side 1 with no living side-1 line: `'no field camp —
production needs one standing'`); the population cap (`popCap(side)`, `population(side)`); last,
**the queue bound** (R-F4-4): with `line` named, that line holds `MAX_LINE_QUEUE` waiting items; with
none named, every line of the side does → `'production queue full (16)'`.

**A dead camp's line keeps its index for the mission** (*Ruled 15 Oct (coordinator, lead-delegated
window)*): every verb naming it refuses (`requestBuild`, `canBuild`, `cancelBuild`, `setRally`,
`clearRally`), D6's shortest-queue choice and building skip it, `productionLines(side)` still lists it
(so the indices commands carry never shift) with `current` null and `queued` 0, and the other lines
keep their indices. Why: a command stamped on one machine's tick must name the same line on the
other, and an index that renumbers when a camp falls would retarget an in-flight cancel. *Cost if
wrong:* the dock filters dead lines itself.

- [ ] **Step 1: Audit, before any edit.** List every existing test and harness that relies on
  parallel deployment or on the old `buildQueue`, and say how each changes: `mission.test.ts`
  ~L5097–5105 (two builds delivered together), `population-census.test.ts` (the reservation),
  `packages/app/src/ui/production.test.ts`'s runtime mocks (the `production` shape), and the
  report-only `tools/src/backtest/bs_ladder.ts` and `wh_pacing.ts`. A test that asserted parallel
  delivery is rewritten to the serial expectation in this task, never deleted.
- [ ] **Step 2: Write the failing tests** (`production-runtime.test.ts`; a 40 × 12 map; unit
  `n2_squad` costing 300, `buildTimeS` 2 = 40 ticks, population 1, answered for both sides by a
  side-aware `unitInfo`; `economy: { logisticsStart: [1200, 1200], logisticsRatePerMin: [0, 0] }`;
  a `camp` type with `produces_for: 0` and a `camp_s1` type with `produces_for: 1`):
  - **"two builds queued in one tick deploy one build time apart"**: two builds at tick 10 give
    `built` events at ticks **[50, 90]** (red on `main`: [50, 50]);
  - **"two camps are two lines"**: one build on each of two side-0 camps at tick 10 gives two `built`
    at tick 50, each spawned at its own camp's `sim.structureExit(s)`, and the two exits differ;
  - **D6**: three builds with no line named on two lines go to lines `[0, 1, 0]`
    (`productionLines(0)[i].queued + (current ? 1 : 0)` reads `[2, 1]`);
  - **"a mission with no camp builds at `player_start`, serially"** (D2): `[50, 90]`, both at
    `player_start`;
  - **D4**: with one item in progress and one queued, `sim.debugDestroyStructure(camp)` at tick 30:
    no `built` ever fires, `logisticsOf(0)` reads 1200 − 600 + 300 = **900**, `production` is `[]`,
    and `buildBlockedReason('n2_squad')` reads `'field camp destroyed — no production'`;
  - **the camp dies on its item's finishing tick** (Review Focus 3): destroyed at tick 50 before
    `rt.step`: no `built` at 50;
  - **a dead camp's line keeps its index**: two side-0 camps, one build on each at tick 10, camp 0
    destroyed at tick 30: line 1 delivers at tick 50, `productionLines(0).length` stays 2,
    `productionLines(0)[0]` reads `current: null, queued: 0`, a build with no line named goes to line
    1, and `requestBuild('n2_squad', 0)`, `canBuild('n2_squad', 0)`, `cancelBuild(0, -1)` and
    `setRally(0, fx.from(20), fx.from(5))` all return false;
  - **Review Focus 2, the camp that died this tick**: one item in progress and one queued on camp 0
    (purse 1200 − 600), camp 0 destroyed at tick 30, then `cancelBuild(0, 0)` in the same step
    returns false and `logisticsOf(0)` reads the D4 refund once (900), not twice (1200);
  - **a side-1 camp death refunds `purse[1]`**: a side-1 item in progress and one queued, the
    `camp_s1` destroyed: `[logisticsOf(0), logisticsOf(1)]` reads `[1200, 900]`;
  - **per side (LD6 asks 1–3)**: `requestBuild('n2_squad', undefined, 1)` on the `camp_s1` line is
    accepted, `[logisticsOf(0), logisticsOf(1)]` reads `[1200, 900]`, and at tick 50 the event is
    `{ kind: 'built', tick: 50, unit: 'n2_squad', side: 1 }`; `unitInfo` was asked
    `('n2_squad', 1)`;
  - a side-1 build with no side-1 camp is refused with `'no field camp — production needs one
    standing'`, even with `player_start` authored, and `logisticsOf(1)` stays 1200;
  - a side-1 item with `intel: 10` is refused `'not available in the field'`, purse unchanged;
  - `popCaps: [null, 1]`, with a side-0 build queued FIRST: a second side-1 build is refused,
    `buildBlockedReason('n2_squad', 1)` reads `'population cap reached (1/1)'`, `popCapped('n2_squad',
    1)` is true, `populationView(1)` reads `{ used: 1, cap: 1 }`, and side 0 is unaffected (the queued
    side-0 build is what turns the "count every line regardless of side" mutation red);
  - `canBuild('n2_squad', undefined, 1)` agrees with `requestBuild` on side 1 for each of: funded
    (`[true, true]`), unfunded (`[false, false]`), capped (`[false, false]`); `canBuild('n2_squad', 1,
    1)` with one side-1 line reads false;
  - the F3 cap and reservation bind across lines: `popCaps: [2, null]`, two lines, three builds: the
    third is refused (one reservation pool per side);
  - `cancelBuild` refunds exactly: side 0 `[1200 → 900 → 1200]`, side 1 likewise on `purse[1]`;
    `cancelBuild(0, 5)` on a two-item line and `cancelBuild(3, -1)` with one line return false and
    change nothing (Review Focus 2);
  - **the queue bound**: `economy` start `[100000, 0]`, one line: 17 builds accepted (1 + 16), the 18th
    refused `'production queue full (16)'`, and `canBuild` agrees on all 18;
  - `start()` with five side-0 camps throws `'mission <id>: 5 production structures for side 0, at
    most 4'`;
  - **"a queued item is in `production` from the tick it is queued"** (11 Oct, GH-469): the second
    serial item reads `{ doneTicks: 0, totalTicks: 40, ticksLeft: 80 }` at tick 10;
    `production` equals `productionOf(0)`, and `productionOf(1)` lists side 1's items only;
  - **the app's readers (R-F4-1)**: `alertsForTick` given `{ kind: 'built', tick: 50, unit:
    'sarim_rifles', side: 1 }` produces no `arrival`; `announce` produces no `reinforcements`; a
    tutorial `mission` await on `built` is not satisfied by a side-1 event and is by a side-0 one;
    `describeMissionEvent` still returns null for both.
- [ ] **Step 3: Implement.** Lines are built in `start()` after `raiseMissionStructures` (which
  runs before any force spawns; defined ~L1943, called from `start()` ~L1446 on F2), from the structures whose producer side
  is the line's side, in structure index order (map and mission alike); a side-0 mission with none
  gets one `player_start` line (D2). More than `MAX_PRODUCTION_LINES` for a side throws.
  `productionAnchor(side)` stays for `firstRefusal`'s camp clause and F2's `rearOf`. The flat
  `buildQueue` goes. The advance replaces the deploy loop where it is (after `stepIncome`, before
  `stepRoe`; F2 ~L1657): per line in line order, side 0's lines then side 1's, a dead anchor first
  loses its line (D4, refund through `refund`), then `advance(line, false)` (Task 4 supplies the
  flag), then the finished item spawns at the line's exit and pushes `built` with the line's side.
  **The hash fold (R-F4-8):** `economyHash`'s `buildQueue` words are replaced in place by the same
  words over `productionOf(0)`'s items in order: the count, then per item its unit chars,
  `startTick = readyTick - buildTicks` and `readyTick = tick + ticksLeft`. App: `alerts.ts`,
  `announce.ts` and `tutorial/runtime.ts` read `built` only when `e.side === 0`; `mix-scenes.ts`'s
  literal gains `side: 0`.
- [ ] **Step 4: Measure.** Every pin in "Global pins" reads back unchanged, including both economy
  pins and both runtime-digest pins, and N2's command-path equivalence. `playtest`: only the lines
  Task 1 predicted move; nothing else. Do not edit plans here; Task 10 owns that. If a building plan
  now **fails**, stop: Task 10 must land before this task's commit can be green, so reorder within
  the branch and say so.
- [ ] **Step 5: See it red.** Put every build on line 0 whatever D6 says: "two camps are two lines"
  and the D6 test fail. Keep the old parallel push beside the line: the first test fails. Spend from
  `purse[0]` whatever the side: the per-side test reads `[900, 1200]`. Count every line in
  `population(side)` regardless of side: the cap test fails. Let side 1 fall back to `player_start`:
  the no-camp test fails. Fold `ticksLeft` in place of `readyTick`: `ECONOMY_PIN` goes red (the flat
  fixture's 2300 build is still in progress at tick 2400). Drop the alerts filter: the app test fails.
  Drop dead lines from `productionLines`: line 1 becomes line 0 and the dead-index test fails. Skip
  the dead-line check in `cancelBuild`: the same-tick cancel refunds twice (1200). Drop `side` from
  `canBuild`'s refusal: the side-1 agreement test reads `[true, false]` when capped.

---

## Task 4: no production while the camp is contested

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Task 3.

**Files:** `packages/sim/src/production.ts` and its test, `packages/sim/src/mission.ts`,
`production-runtime.test.ts`.

**Interfaces:**

```ts
/** D1, LD6 ask 9. A line is contested when a living, surface (tunnelIn < 0), ground
 *  (!isAir) unit of side 1 - side stands within CONTEST_RADIUS_SQ of (x, y), compared on
 *  `>> 8` deltas as the hold rule does. Civilians (side 2) contest nothing. */
export function lineContested(view: HoldView, x: Fx, y: Fx, side: 0 | 1): boolean;
```

- [ ] **Step 1: Write the failing tests** (`production.test.ts` on a literal `HoldView`; the runtime
  cases in `production-runtime.test.ts`):
  - a side-1 squad 5 tiles from a side-0 line's exit contests it; at 7 tiles it does not;
  - the same squad with `tunnelIn` 0 does not contest (and with `tunnelIn` -1 it does: the `>= 0`
    guard, so `>` cannot survive);
  - a side-1 drone over the exit does not contest;
  - **the mirror (ask 9)**: a side-1 squad 5 tiles from a side-1 line's exit does not contest it; a
    side-0 squad there does; a side-2 civilian contests neither;
  - a line frozen for 15 s (300 ticks) finishes 300 ticks late, and the `built` event carries the
    real tick;
  - the `player_start` line (D2) is contested by the same rule;
  - `productionLines(0)[i].contested` reads true on exactly the frozen ticks (the HUD's flag);
  - the objectives' `contestedIn` is unchanged: a `hold_for` fixture reads the same `paused`
    sequence before and after this task.
- [ ] **Step 2: Implement.** `lineContested` over F2's `this.holdView` (`HoldView & VentView`,
  `mission.ts` ~L726 on F2; it already carries `isAir` and `tunnelIn`), importing
  `CONTEST_RADIUS_SQ` from `tuning.ts`. One test per line per tick, before `advance`. Leave
  `contestedIn`/`enemyNear` (~L2299/~L2318 on F2) alone: zone contest by seat is N3's. *(6 Oct,
  still true: a foot patroller that holds a target is halted by `stepPatrols` (~L2260 on F2) and
  stays put, so a patrol that meets the player beside a camp freezes the line while it holds the
  target (R). Every patroller in the six shipped camp missions is a vehicle.)*
- [ ] **Step 3: Measure.** Every guard pin unchanged (no fixture's camp is within 6 tiles of an
  enemy: the flat fixture's militia stand at (20,22) and (20,26), its camp at (6,30)).
- [ ] **Step 4: See it red.** Compare against `CONTEST_RADIUS_SQ * 2`: the 7-tile case freezes.
  Drop the `isAir` check: the drone test fails. Test `side[i] !== side` in place of
  `side[i] === 1 - side`: the civilian case fails.

---

## Task 5: the rally point

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Task 3.

**Files:** `packages/sim/src/mission.ts`, `production-runtime.test.ts`, `packages/sim/src/index.ts`.

**Interfaces:**

```ts
/** D5, LD6 ask 5. False on a blocked tile, an off-map point, an unknown line for `side`,
 *  or after the mission ended. */
setRally(line: number, x: Fx, y: Fx, side: 0 | 1 = 0): boolean;
clearRally(line: number, side: 0 | 1 = 0): boolean;
/** The click-time pre-check (N2's D3 pattern): true when setRally would accept now. No state change. */
canSetRally(line: number, x: Fx, y: Fx, side: 0 | 1 = 0): boolean;
```

- [ ] **Step 1: Write the failing tests:**
  - with a rally point, a finished unit receives one no-sweep `attackMove` to it on its deploy tick
    (ruling (lead, 2026-10-11)), and arrives;
  - with none, it stands at the exit (byte-identical to Task 3's behaviour);
  - a rally point on a `#` tile is refused and the previous one is kept; `canSetRally` agrees;
  - a rally point set while an item is in progress applies to that item;
  - **side 1**: `setRally(0, x, y, 1)` on a side-1 line sends its finished unit there; `setRally(0,
    x, y, 1)` on a mission with no side-1 line returns false;
  - two items rallied one build time apart land on two tiles, not one (`assignFormation`'s
    `reservedTilesFor`, `sim.ts` ~L2178), and a fixture placement with `count: 3` lands in formation;
  - *(#402)* a foot unit with a rally point never drops at the exit (`spawn` resets `BRACE_NONE`,
    `sim.ts` ~L1895; the order queued in `runtime.step` is applied before the next tick's
    `stepBrace`, ~L4221); on the way it halts to fire at what comes into range, as any attack-mover
    does, then walks on;
  - **"a rallied unit holds on arrival"**: still on the point 10 s after arriving with an identified
    enemy out of reach; the control is the same order with `sweep: true`, which walks off
    (`stepSweep`, ~L5986, skips `sweepOrder` 0, #537);
  - the rally order reaches the sim through `queueCommand` and nowhere else: a spy on the command
    queue sees one `attackMove` with the spawned ids and no `sweep`;
  - `clearRally` after `setRally`: the next finished unit stays at the exit (no `attackMove` queued
    for it), and `productionLines(0)[0].rally` reads null.
- [ ] **Step 2: Implement.** `spawnPlacement` returns the spawned ids (`number[]`, ~L1983 on F2);
  queue `{ kind: 'attackMove', ids, x, y }` with no `sweep` for them in the same tick. The blocked
  check is the runtime's (the sim's own goal-setters snap a blocked goal, `nearestOpenTile`, `sim.ts`
  ~L2120).
- [ ] **Step 3: See it red.** Set `sweep: true` on the rally order: "holds on arrival" fails. Write
  `goalX/goalY` directly instead of queueing a command (both private, `sim.ts` ~L983; the mutation
  needs a cast): the spy test fails, and invariant 4 says why it must. Accept blocked tiles: the `#`
  test fails. Ignore `side` and look the line up in side 0's list: the side-1 test fails. Make
  `clearRally` a no-op that returns true: the clear test sees an `attackMove` queued.

---

## Task 5b: the line verbs as `Command`s, on the wire in the same commit (LD6 asks 1, 4, 5)

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Tasks 3, 5; N2 Task 4.

**Files:**
- `packages/sim/src/sim.ts`: the `Command` union, `RuntimeCommand`, `queueCommand`.
- `packages/sim/src/mission.ts`: `applyQueued`.
- `packages/sim/src/index.ts`: export the two bounds (if Task 2 did not).
- `packages/net/src/protocol.ts`: `COMMAND_KINDS`, `cleanCommand`; `packages/net/src/ownership.ts`:
  `validateCommand`; `packages/net/package.json`: the `description` names the two new `@lions/sim`
  imports (`MAX_PRODUCTION_LINES`, `MAX_LINE_QUEUE`), beside N2's `FIRE_SUPPORT_KINDS`; check
  `pnpm --filter @lions/worker` still typechecks and builds.
- `packages/app/src/ui/advisor.ts`, `packages/app/src/i18n/en.json`.
- `tools/src/net/mcp-tools.ts`.
- Tests: N2's `packages/sim/src/runtime-commands.test.ts` (extended), `protocol.test.ts`,
  `ownership.test.ts`, `advisor.test.ts`, `tools/src/net/mcp-tools.test.ts`.

**Interfaces:**

```ts
// sim.ts, on Command (N2's `build` gains `line`; three new kinds; all plain ints or Fx):
| { kind: 'build'; side: number; unit: string; line?: number }
| { kind: 'cancelBuild'; side: number; line: number; index: number }
| { kind: 'setRally'; side: number; line: number; x: Fx; y: Fx }
| { kind: 'clearRally'; side: number; line: number }
export type RuntimeCommand = Extract<Command, { kind: 'build' | 'support' | 'cancelBuild' | 'setRally' | 'clearRally' }>;
// mission.ts: applyQueued() drains all five in queue order; `side !== 0` is skipped first
// (N2, C-R3; N3 lifts it); then build → requestBuild(c.unit, c.line), cancelBuild →
// cancelBuild(c.line, c.index), setRally → setRally(c.line, c.x, c.y), clearRally →
// clearRally(c.line), support as N2. Returns how many were accepted.
```
Wire (`cleanCommand`, unknown keys stripped): `line` absent (build only) or an int
`0 <= line < MAX_PRODUCTION_LINES`; `index` an int `-1 <= index < MAX_LINE_QUEUE`; `x`, `y` ints;
`side` an int. `validateCommand`: all three `!world.versus && cmd.side === side`, and `setRally`
adds `onMap(cmd.x, cmd.y)`; the blocked-tile refusal stays the runtime's (`SeatWorld` has no mask).
`build`'s case is N2's, unchanged; the runtime refuses a line out of range for the side.

- [ ] **Step 1: Write the failing sim tests** (`runtime-commands.test.ts`, N2's `world()` fixture
  with a camp added):
  - `takeRuntimeCommands` returns `[build, cancelBuild, setRally, clearRally]` in queue order, then
    `[]`; a tick with them still set aside discards them and the sim hash equals a twin's (R-3);
  - **build then cancel in one frame** (Review Focus 1): `applyQueued()` returns 2, `production` is
    `[]` and `logistics` is back to 600; **cancel then build**: returns 1 (the cancel found nothing),
    `production.length` 1, `logistics` 300;
  - `{ kind: 'build', side: 0, unit: 'n2_squad', line: 1 }` on a one-line mission: returns 0,
    nothing spent;
  - `setRally` through the command leaves `productionLines(0)[0].rally` equal to the direct call's,
    and a rally set by command on the tick an item finishes sends that item there (Review Focus 4);
  - a side-1 `cancelBuild` and `setRally` are skipped: `applyQueued()` returns 0, `logisticsOf(1)` and
    `productionLines(1)` unchanged (N2's skip).
- [ ] **Step 2: Write the failing net, app and tools tests:**
  - `protocol.test.ts`: the clean shapes for all three kinds and `build` with `line: 0`; refusals:
    `line: -1`, `line: 4`, `line: 1.5`, `line: '0'`, `index: -2`, `index: 16`, `x: 1.5`, a missing
    `line` on `cancelBuild`/`setRally`/`clearRally`; accepted: `index: -1` and `index: 15`; a `pad`
    key stripped from each;
  - `ownership.test.ts`: single-player seat 0: side 0 passes and side 1 drops for each kind;
    `setRally` off the map drops; **versus: all three drop for every side**;
  - `advisor.test.ts`: `describeCommand({ kind: 'cancelBuild', side: 0, line: 0, index: -1 })` is
    `'Cancel the item in progress on line 0'`, and with `index: 2` it is `'Cancel line 0, item 2'`; `setRally` at `fx.from(2), fx.from(3)` on line 0 is
    `'Rally line 0 at (2, 3)'`; `clearRally` on line 0 is `'Clear rally on line 0'`; `build` with
    `line: 1` is still `'Build inf_squad'`;
  - `mcp-tools.test.ts`: `unknown verb` for `cancelBuild`, `setRally` and `clearRally`.
- [ ] **Step 3: Run red.** Expected: type errors on the new kinds, then P1's
  `missingFromCOMMAND_KINDS: "cancelBuild" | "setRally" | "clearRally"`.
- [ ] **Step 4: Implement.** `queueCommand` sets the five aside through one `isRuntimeCommand`
  switch with a `never` end; the R-3 discard is unchanged (it empties the one list). `applyQueued`
  becomes a `switch (c.kind)` with the skip first. `COMMAND_KINDS` gains the three; `cleanCommand`
  the three cases and `build`'s `line`; `validateCommand` the three cases. `describeCommand` the three
  cases; `en.json`: `"net.advisor.cmd.cancelBuild": "Cancel line {line}, item {index}"`,
  `"net.advisor.cmd.cancelCurrent": "Cancel the item in progress on line {line}"` (index -1),
  `"net.advisor.cmd.setRally": "Rally line {line} at ({x}, {y})"`,
  `"net.advisor.cmd.clearRally": "Clear rally on line {line}"`. `ORDER_VERBS`' filter drops the
  three (a model verb is an N3/N4 follow-up).
- [ ] **Step 5: Run green.** `pnpm test:determinism`, `pnpm vitest run packages tools/src/net`,
  `pnpm typecheck`, `pnpm lint`, `pnpm validate:ui`, `pnpm playtest`, `pnpm balance`. Every guard pin
  unchanged.
- [ ] **Step 6: Falsify.** Push `cancelBuild` to the sim queue in `queueCommand`: the order test
  fails and the exhaustive end in `applyCommands` fails `tsc`. Drop the `side !== 0` skip for
  `cancelBuild`: the side-1 test fails. Bound `line` with `<=`: `line: 4` is accepted. Bound `index`
  with `>= 0`: `index: -1` is refused. Drop `!world.versus` from `setRally`: the versus test fails.
  Drop `'setRally'` from `ORDER_VERBS`' filter: `tsc` fails in `buildOrder`.
- [ ] **Step 7: Commit.** `sim+net: F4 Task 5b -- cancelBuild, setRally, clearRally and build.line as Commands; side 0 only and dropped in versus until N3 (LD6)`.

---

## Task 6: the economy pin learns production

**Model:** haiku. **Agent:** `sim-guard`. **Depends:** Tasks 3–5b.

**Files:** `mission.ts` (`economyHash`), `determinism.test.ts`.

- [ ] **Step 1:** `economyHash` replaces R-F4-8's interim fold, in place (after intel, before the
  identifications), with every line in line order (side 0's, then side 1's): side, anchor, current
  (unit chars, or a 0 word), `ticksLeft`, the queue (count, then unit chars and logistics per item),
  rally (`x`, `y`, or `-1, -1`). F2's words stay appended after. The flat fixture gains a second camp
  (clear of `depot`, `crossroads` and the convoy route, so F2's zone and cut words do not move for a
  second reason), a rally point, a cancel, and an enemy squad that contests one camp for 10 s; the
  cancel and the rally go through `cancelBuild`/`setRally` in the direct path and through commands in
  N2's `'command'` path. Two pair tests sit beside the pins: **(a)** the flat fixture run twice,
  differing only in the rally point (`(14, 30)` against `(15, 30)`): `expect(a.rt.economyHash()).not.toBe(b.rt.economyHash())`;
  **(b)** two one-line fixtures differing only in the line's side (a `camp` against a `camp_s1`,
  each with one item in progress): the hashes differ.
- [ ] **Step 2: Re-pin once.** Commit: *"economy pins re-pinned: serial production lines per camp,
  the contested pause and rally points (G3 Q3, lead 4 Oct); the fixtures gained a second camp, a
  rally point, a cancel and a contested window; ECONOMY_PIN was N, ECONOMY_PIN_RELIEF was M;
  RUNTIME_DIGEST_PIN and _RELIEF move with them, because digest() folds economyHash() first (N2
  Task 6), was P / Q"*. Coverage: assert the replay passes through a frozen line, a refund and a
  rally arrival. N2's equivalence test reproduces the new `ECONOMY_PIN` and `_RELIEF` exactly.
- [ ] **Step 3: See it red.** Hash `ticksLeft` but not `rally`: pair test (a) reads equal hashes and
  fails. Drop the line's `side` word: pair test (b) reads equal hashes and fails.

---

## Task 7: an enemy camp and its menu, in the schema

**Model:** sonnet. **Agent:** `mission-author`. **Depends:** Tasks 1 and 3.

**Files:** `data/schemas/mission.schema.json`, `packages/sim/src/structures.ts`,
`packages/sim/src/sim.ts` (the per-structure override), `packages/sim/src/mission.ts` (types and four
of the five readers), `packages/render/src/three/ThreeRenderer.ts` (`structureIsOwn`, the fifth, ~L5857)
and its test, `tools/validate_production.mjs` (+ `.d.mts`), `tools/src/validate_production.test.ts`,
`tools/validate_data.mjs` (wiring, as F2 wired `validate_income.mjs`).
*`produces_for` is a TYPE field (`structures.ts` ~L68/L102, `StructureType.producesFor`), so a
per-placement `side` is new per-structure state in `Sim`, fixed at `start()` and left out of
`hash()`, which keeps the sim pins unmoved (R).* `Sim.setStructureProducesFor` is setup-only state,
written at `start()` and omitted from `hash()`; that is acceptable because Task 6 folds every line's
side into `economyHash`, so a client built with a different override diverges on the economy hash.

**Interfaces:**

```json
"structures[].side": { "type": "integer", "enum": [0, 1],
  "description": "Overrides the structure type's produces_for for this placement. A camp placed for side 1 is the enemy's production site." },
"enemy.production": { "type": "object", "additionalProperties": false,
  "required": ["menu"],
  "properties": {
    "logistics_start": { "type": "integer", "minimum": 0, "maximum": 894784 },
    "logistics_rate_per_min": { "type": "integer", "minimum": 0 },
    "menu": { "type": "array", "minItems": 1, "items": { "type": "string" } },
    "rally": { "type": "string", "description": "Map marker built units walk to." },
    "group": { "type": "string", "description": "Group given to built units, so a trigger's commit can send them on (R-F4-7)." } } }
```

```ts
// sim.ts (R-F4-9)
setStructureProducesFor(s: number, side: 0 | 1): void;   // start() only
structureProducesFor(s: number): number;                  // the override, else the type's producesFor
```

*(11 Oct, verified: `missionUnitTypes` (`packages/app/src/mesh-catalogue.ts` ~L624) walks the whole
mission JSON for any unit id, so `enemy.production.menu` is loaded at boot. None does in Stage 4.)*

- [ ] **Step 1: Write the failing validator tests:** a menu unit that is not an enemy unit
  (`data/units/enemy/`) is refused (no mirrored tech trees, GH-109); a menu unit whose
  `cost.intel` is above 0 is refused (LD6 ask 2); an unknown rally marker is refused;
  `enemy.production` with no side-1 camp in `structures` is refused; a mission whose map grid and
  `structures` give one side more than 4 production structures is refused (R-F4-4).
- [ ] **Step 2: Write the failing sim tests** (one per reader, R-F4-9): a `camp` placed with
  `side: 1` is a side-1 line (`productionLines(1).length` 1, `productionLines(0).length` 0 bar D2's
  `player_start` line); `buildBlockedReason('n2_squad', 1)` reads null and side 0's camp clause reads
  as for a mission with no camp; side 1's own demolisher does not set charges on it (the
  `stepDemolition` skip, `sim.ts` ~L5499) while a side-0 one does; F2's rear for side 1 is that
  camp's exit (an income zone held by side 1 gets a route); `ThreeRenderer.structureIsOwn` reads a
  `camp` placed with `side: 1` as not own for a side-0 viewer and as own for a side-1 viewer.
- [ ] **Step 3: Implement.** The five readers go through `structureProducesFor` (the render side's
  `structureIsOwn` replaces `stype.producesFor` with `this.sim.structureProducesFor(s)`); `declaresProduction`
  reads `spec.side ?? type.produces_for`. `validate:data` passes on the shipped tree (no mission uses
  either field, D7).
- [ ] **Step 4: See it red.** Remove the side-1 camp check: a menu with nowhere to build passes.
  Leave `stepDemolition` on the type field: side 1's demolisher sets charges on its own camp. Leave
  `structureIsOwn` on the type field: the render test reads the side-1 camp as own for side 0.

---

## Task 8: the spend-down rule, as a pure function

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Task 2.

**Files:** `production.ts` and its test.

**Interfaces:**

```ts
/** D8. The next menu index to buy, or null. `last` is the menu index bought last (-1 at
 *  start). `purse` is whole logistics (`logisticsOf(1)`: exact for integer costs, S-2). */
export function spendDown(menu: readonly LineItem[], last: number, purse: number,
  popRoom: number | null, lineIdle: boolean): number | null;
```

- [ ] **Step 1: Write the failing tests** (literal menus and purses):
  - menu `[{ logistics: 340, population: 2 }, { logistics: 235, population: 1 }]`, idle, purse 700,
    `last` -1: returns 0; with `last` 0: returns 1;
  - a busy line (`lineIdle` false) returns null at any purse;
  - purse 300, `last` -1: item 0 (340) is skipped for item 1 (235); it never waits to save up;
  - `popRoom` 0 returns null; `popRoom` 1 skips the 2-pop item;
  - **the property**: over a fixed table of 50 literal purses from 0 to 2000, with the spender
    applied until it returns null each time, the remainder is always below the cheapest item that
    fits (it spends down).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: See it red.** Return the dearest affordable item instead of round-robin: the order
  test fails. Wait for the next item when unaffordable: the property test fails.

---

## Task 9: the enemy buys through the same line

**Model:** sonnet. **Agent:** `sim-guard`, then `playtest`. **Depends:** Tasks 2b–8, F2.

**Files:** `packages/sim/src/mission.ts`, `production-runtime.test.ts`,
`tools/src/backtest/enemy-production-probe.ts` (new).

- [ ] **Step 1: Write the failing tests** (a fixture with `enemy.production`, a side-1 camp
  placed with `side: 1`, and a side-aware `unitInfo`):
  - **side 1's purse sources (LD6 ask 7):** with no `ctx.economy`, side 1 starts at
    `enemy.production.logistics_start` and earns `logistics_rate_per_min` (start 640, rate 60, and a
    one-item menu priced 1000 so nothing is bought: after 1200 steps `logisticsOf(1)` reads 700), plus F2's held-zone income for side 1
    in the same accumulator; with `ctx.economy` the context wins;
  - it buys through `spendDown` and **the same request path** (ask 10): one unit at a time,
    `requestBuild(unit, line, 1)` and `spend(1, …)`; a spy on `requestBuild` sees every purchase, and
    there is no other write to `purse[1]` but `refund` and income;
  - its line freezes when a KDF squad contests its camp (Task 4's rule); the mirror (a side-1 squad
    beside it) does not freeze it;
  - built units get the authored `group` and attack-move to the `rally` marker with no sweep, and
    hold there (ruling (lead, 2026-10-11));
  - a trigger that `commit`s that group sends them on (`commit` issues `attackMove` with
    `sweep: true`, ~L2537 on F2), which is how authored content and bought units meet;
  - with no `enemy.production` block, side 1 never buys, even with a purse from zones (D7);
  - **R-F4-1:** a side-1 purchase emits `{ kind: 'built', …, side: 1 }`, and the app's readers stay
    silent for it (Task 3's tests, re-run on this fixture's event list).
- [ ] **Step 2: Implement.** Once a tick, after the lines advance, for each idle side-1 line:
  `spendDown(menu, last, logisticsOf(1), popRoom(1), true)`, then `requestBuild(menu[i].unit, line, 1)`.
- [ ] **Step 3: The witness.** `enemy-production-probe.ts` loads `tel_marum_3_clearance` and, in
  memory only, gives side 1 a camp on open ground beside `battery_position` (25,6) (not on it: the HVT
  `rocket_battery` stands at (25.5,6.5), and `raiseMissionStructures` runs before spawns, so
  `assertGroundClear` would refuse the load; name the tile in the probe), a purse of 640 (1.6× the
  KDF's 400, Q7's ratio, a probe number only), and a menu of `sarim_rifles` and `atgm_cell`. It runs
  the shipped plan and a passive control over `main`'s 30-seed set (`SWEEP_SEEDS`, 424242 then 1..29,
  #539/#542; not the G3 sheet's set, and the probe says so), reusing `plan-sweep.ts`'s worker
  pattern, and prints per run: units bought (counted from `built` events with `side: 1`), unspent at
  the end (as a share), outcome, length. Report-only, no gate (C5 is report-only at G4). Expected:
  unspent near 0% (R, D8), against the spike's banked thousands.
- [ ] **Step 4: See it red.** Let side 1 build in parallel (skip the line): the "one unit at a time"
  test fails, and the probe's bought count jumps. Write `purse[1] -= …` directly in the spender: the
  spy test fails.

---

## Task 10: the plans re-proved

**Model:** sonnet. **Agent:** `playtest`. **Depends:** Tasks 3–5b.

**Files:** `tools/src/backtest/playtest.ts`.

- [ ] **Step 1:** Re-run every plan on 30 seeds. For each of the five building plans, if the serial
  line or the contest changed its outcome, re-time its `requestBuild` calls to the same intent (the
  same units, queued earlier) rather than changing what it buys. Comment each change with Task 1's
  parallel-vs-serial ticks. No shipped mission has two camps.
- [ ] **Step 2: One plan uses a rally point.** `deir_amun_2_foothold` sets its camp's rally point at
  the pump gate the hold force takes, `M(15, 31)` in `deirAmun2Plan` (~L1618 on `main`), beside the
  `pump_gate` marker (15,32), 6.5 tiles from the camp exit (20.5,34.5). Under the no-sweep
  attack-move its bought squads fight their way into the gate and hold there. The camp's 6-tile
  radius covers `pump_gate`, so D1 pauses the line during that fight (ruled 6 Oct: intended).
  Measure both before re-timing. It must still win.
- [ ] **Step 3: Measure.** Every plan wins; every passive control loses; every win inside its
  `time_limit_s`; print the largest queue each building plan reached (R-F4-4: expected ≤ 2). F2's
  banking lines printed, and `BANKING_OVER_30_WINNERS` (15 on F2's branch) and `ZONE_PASSIVE_INCOME`
  (0) re-read: re-pin the first only with the per-plan reason. `LADDER_CREDITS` and `GATES` re-pinned
  only where a grade or `unitHome` moved, with the per-mission terms in the comment (5940 on `main`,
  `playtest.ts` ~L3634; `GATES` ~L3312; re-read at pre-flight). Since GH-330, `CAMPAIGN_CREDITS`
  (`packages/app/src/ui/stores-model.ts` ~L66) moves in the same commit, or
  `tools/src/campaign_credits.test.ts` goes red.
- [ ] **Step 4: See it red.** Remove the rally call: Step 2's plan line returns to its no-rally
  timing, proving the gate sees the rally (state the moved figure in the commit).

---

## Task 11: contract and ledger

**Model:** haiku.

**Files:** `docs/GDD.md` §3, `docs/campaign/README.md`, `CLAUDE.md` (the production lines under
"Dev instruments" if the dock's behaviour is described there; the GH-136 status), `docs/HANDOVER.md`,
`docs/superpowers/specs/2026-10-10-network-game-design.md`.

- [ ] **Step 1:** GDD §3: one line per camp, build time as the pace, the contested pause, the rally
  point, the enemy buying the same way, officers outside the line. GH-115/GH-109's limits restated.
- [ ] **Step 2:** `docs/campaign/README.md`: `structures[].side` and `enemy.production` (with `group`)
  in the schema digest, with D7 (no campaign enemy buys in Stage 4).
- [ ] **Step 3:** `docs/HANDOVER.md` §1, §3 (D1–D8 as answered, R-F4-1 to R-F4-4), §4. Close GH-136
  in the PR body.
- [ ] **Step 4:** The network spec §7.1 and §11b.4: which LD6 asks landed and where (this plan's
  table), that side 1 is still skipped by `applyQueued` and dropped in versus (N3 lifts both), and
  that `built.side` is filtered to 0 in the app (N3 switches to `viewerSide`). Name the commits. The
  N3 prep note (`2026-10-16-net-n3-prep.md`, #655) §5 ask 7 reads the ruled names,
  `MissionContext.economy = { logisticsStart, logisticsRatePerMin }` (whole logistics, by side).

---

## Re-pins (F5)

| pin | expected | the reason, for the commit |
|---|---|---|
| sim pins, flat / relief / orders | **unmoved** (R): 935671699 / 2842924511 / 3272041047 on `main` `199065f1` and F2 (re-read at pre-flight) | — |
| `ECONOMY_PIN`, `ECONOMY_PIN_RELIEF` | **re-pinned once**, Task 6, from F2's 275731552 / 145368021 (re-read: F2's final wave is open). Read back unchanged by Tasks 2, 2b, 3, 4, 5, 5b (R-F4-8) | serial lines per camp, the contested pause, rally points (G3 Q3) |
| `RUNTIME_DIGEST_PIN`, `_RELIEF` (born in N2 Task 6) | **move with the economy pins, Task 6 only** (values re-read at pre-flight) | `digest()` folds `economyHash()` first |
| N2's command-path equivalence | holds at every commit; reproduces the new economy pins in Task 6 | — |
| versus pins (`versus-force`, `match-world`, `per-seat-types`, `versus-breach` `pinWindow`, `two-client`), `shippedContentDigest()` | **unmoved** (R): a room runs no runtime until N3; F4 changes no unit, structure or map JSON | — |
| `pnpm balance` | byte-identical (R) | — |
| `pnpm playtest` | the five building plans' lines and possibly the two `boughtProbe` lines move (serial timing, the contest, one rally); everything else byte-identical | Task 10's plan edits, each commented |
| `BANKING_OVER_30_WINNERS` (F2) | 15 on F2's branch; re-read in Task 10 | named per plan |
| `LADDER_CREDITS` | **5940** on `main` (re-read at pre-flight); moves only if a building plan's grade or `unitHome` moves (R) | named per mission |
| `CAMPAIGN_CREDITS` | **5940** on `main`; moves with `LADDER_CREDITS`, same commit (GH-330) | as `LADDER_CREDITS` |

## Pre-flight (before Task 1; record the results in the task report)

- [ ] **1. The base.** `main` contains F2's and N2's merges (`grep -n "logisticsOf\|applyQueued\|takeRuntimeCommands" packages/sim/src/mission.ts packages/sim/src/sim.ts`); cut `feat/gf4-production` from it. If N2 has not merged, stop.
- [ ] **2. Re-read at pre-flight** (named because they depend on work not merged on 16 Oct):
  - F2's final names: `purse`, `PURSE_UNITS`, `logisticsOf`, `baseUnitsPerTick`, `stepIncome`'s
    place before the deploy loop, `holdView`, `rearOf`, `CONTEST_RADIUS_SQ` in `tuning.ts`;
  - C-R20's final shapes of `rearOf`, `holdView` and `stepIncome` (F2 Task 11, the coordinator's,
    pending at `3e7530bf`);
  - F2's final `ECONOMY_PIN` / `_RELIEF` (275731552 / 145368021 at `9f4fd7d7`; the final wave may
    move them) and `BANKING_OVER_30_WINNERS`;
  - whether F2's Task 8 data (zones on four missions, C-R1) landed: if so, re-take the playtest
    baseline;
  - N2 as merged: `RuntimeCommand`, `takeRuntimeCommands`, `applyQueued`'s skip, `canBuild`'s
    signature, `economyReplay`'s `via` parameter, `ORDER_VERBS`' filter, `describeCommand`'s first
    line, and the born `RUNTIME_DIGEST_PIN` / `_RELIEF` values;
  - the sim pins, `LADDER_CREDITS`/`CAMPAIGN_CREDITS` (5940), `GATES`;
  - the camp census (six missions, one camp each, all via `structures`, none with `side`; no `c`
    tile on any map: re-counted on `199065f1`);
  - whether #658 (doctrines) merged: F4 does not read doctrines (N3 does), so nothing changes.
- [ ] **3. Baselines.** `pnpm test:determinism`, `pnpm test`, `pnpm typecheck`, `pnpm lint` green;
  `pnpm balance` and `pnpm playtest` written to the scratchpad, both exit 0.

## Lane A needs (WP-S-F #184)

- **The dock per camp** (`ui/dock-model.ts`, `ui/production.ts`; the `b` key stays `production` and
  `focusFirst()`): a camp switcher where a mission has two; each line's queue, the item in progress
  with its progress bar (`progress`, 0–1000), and cancel per item with the refund shown. **Every dock
  action is a `Command`** through N2's command sink (N2 Task 5's `dispatch`), after a click-time
  pre-check: `canBuild(unit, line)` then `{ kind: 'build', side: 0, unit, line }`; a cancel is
  `{ kind: 'cancelBuild', side: 0, line, index }`; "Set rally" is `canSetRally(line, x, y)` then
  `{ kind: 'setRally', side: 0, line, x, y }`; "Clear rally" `{ kind: 'clearRally', side: 0, line }`.
  The dock reads `productionLines(0)` (N3 switches it to `viewerSide`). Chrome register (#454,
  `ui/chrome-register.test.ts`): the refund and the line's logistics/intel figures wear `--info`,
  credits stay `--commend`, a paused line is `--disabled-opacity` with `not-allowed` only on the
  controls it disables (cancel stays live), `--on` (lime) only for the armed "Set rally" button. The
  camp switcher is a tab (display capitals); "Set rally" and "Clear rally" are `.rl-btn` actions
  (sentence case). Durations from `--dur-*`. A full queue reads the runtime's refusal
  (`'production queue full (16)'`, R-F4-4) through `t()`.
- **"Contested: production paused"** on the line, from `contested`, and a feed alert when it starts.
  *(11 Oct, #428/#461.)* The alert is derived in the app from the edge of
  `productionLines(0)[i].contested`, not from a new `MissionEvent` kind: tier `important`, tone
  `warn`, place = the camp exit through `world.placeOf`, `at` = the exit so the minimap flashes it,
  its cue the tier's own (`ALERT_CUE.important`). It needs a new `Alert.kind` (`'production'`) in
  `ui/alerts.ts`, an `alert.productionPaused` line in `en.json`, and a cooldown like
  `PINNED_COOLDOWN_TICKS` (80, `ui/alerts.ts` ~L198). Resuming is the dock line clearing, with no
  alert. The minimap's zone states are not extended.
- *(Ruling (lead, 2026-10-11): Hold position retired. A rallied unit reads the chip's existing idle
  "holding" word.)*
- **Setting a rally point**: an armed order from the dock ("Set rally", then a ground click), the same
  arming model as fire support. Armed rally is a fourth source for `anyArmed` (`input/keymap.ts`;
  `escapeTarget` takes one boolean). It takes the GROUND point under the pointer, a refused point
  (`canSetRally` false) gets the deny cue (`sink.deny`, `ui.deny`), and a successful set gets no cue.
  The cursor reuses `move` in `input/cursor.ts` (`cursorFor`), in `ORDER_GROUND_COLOR_KEY` (#457).
  Pointer-only, like smoke. **The rally marker is drawn in the world, so it is mocked and shown to the
  lead before it is built** (no status marks in the world): an order indicator shown while the
  camp's dock is open, never a permanent mark; if approved, a new `Renderer` method in
  `packages/render/src/api.ts`, drawn by `ThreeRenderer`, its `renderOrder` from
  `units/render-order.ts`. No gated golden scenario opens a dock, so no baseline moves.
- **`built` is side-tagged** (R-F4-1): any new reader in the shell filters `side === 0` (N3:
  `viewerSide`).
- **The tutorial's economy step** *(11 Oct: lead question 7; `beit_sahwan_0_tutorial` has no
  `resources` block, no camp and no logistics today; `data/tutorial/beit_sahwan_0.json` has 9
  steps)*: build, see it pause under fire, set a rally point.
- Strings through `t()`.
