# WP-G-F plan F1: fire support, and intel earned by doing (GH-183, G3 Q1). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Changed since 4 Oct (refreshed 14 Oct)

Read and grepped against `main` `f4b3ea2b` (14 Oct, after #601), and against the garrison overhaul's
branch `origin/feat/garrison-overhaul` at `fb3174c8` (`git show <ref>:<path>`). Docs only; nothing
run. **This section governs where it disagrees with the older dated sections below**, which stay as
the record. Stage 4 started early, on 13 Oct (the lead); the November calendar in the older sections
and in `2026-10-04-stage4-order.md` is history. F1 starts **when the garrison overhaul merges**.

**Pins: name them, never copy them.** Every pin value this plan quoted as a target is gone from
Global Constraints and Re-pins. The executor re-reads **main's current pins** on the branch base and
writes them into Task 1's commit message:
- the three sim pins in `packages/sim/src/determinism.test.ts`: **flat** (`determinism (1000-tick
  replay)`, ~L488), **relief** (`determinism over relief`, ~L857) and **orders** (`determinism of an
  order once it is done`, ~L977). Targeted fire (#591) moved all three; the garrison overhaul
  re-pins them again (`b378833e`, its G1);
- `LADDER_CREDITS` (`tools/src/backtest/playtest.ts` ~L3431), held equal to `CAMPAIGN_CREDITS`
  (`packages/app/src/ui/stores-model.ts` L63) by `tools/src/campaign_credits.test.ts`;
- `ROSTER_MAX` (`playtest.ts` ~L3566) and `GATES` (~L3121);
- `ECONOMY_PIN` and `ECONOMY_PIN_RELIEF`: **not in the tree** (grep, 14 Oct). F1 Task 1 and Task 5
  create them.

The garrison overhaul moves `LADDER_CREDITS`/`CAMPAIGN_CREDITS` and `ROSTER_MAX` in its own two
commits (`e8cdab88`, `53b020ba`). Those commits' values differ from the figures quoted when this
refresh was asked for, which were a mid-branch reading (`bc0a559a`'s message). Carry neither into
F1: read both off `main` after the merge.

### What landed since the 11 Oct pre-flights (each checked against F1)

| landed | what it changes for F1 | where it bites |
|---|---|---|
| **#580** sim fixes (#291, #279, #247), 13 Oct | Routed units, civilian flight, `manpad_team` on foot. #279 ruling (a) is **on `main`**: an aircraft walks no civilian out (`civilians.ts` ~L145, ~L166, the `isAir` skip). Task 5's "drone over a rise" test cites it as landed now. | Task 5 |
| **#584** splash suppression applies (`BOUNCE_SUPP_MULT` was ×2/65536) | A unit mortar's splash now suppresses for real. The barrage's suppression is calibrated against a working mortar round, not a broken one. | Task 2 Step 2 |
| **#570**, **#572** anti-armour target choice; ATGM range | Fights resolve differently: every (M) census in Task 2 is a fresh reading. | Task 2 |
| **#577** H never empties a building (the Hold ruling) | App only (`input/intents.ts` `haltTargets`): H dispatches `halt` to the units outside; a unit inside is already holding. The sim's `halt` is unchanged. | Task 5, Task 8 (vocabulary) |
| **#585** the mission time limit (#540) | `time_limit_s` on all 27 missions, `checkEnd` ends a stalled mission as a `'withdrawn'` defeat (`mission.ts` ~L1925-1947), `timeLimitTicksLeft`. The harness prints `time limit` headroom lines (`tools/src/backtest/time-limit.ts`, `HEADROOM_S` 120, `HEADROOM_RATIO` 1.2) and fails a win that crowds its limit. Two new controls, Beit Sahwan I and III, expect `withdrawn`. | Tasks 1, 2, 8, 9 |
| **#591** targeted fire (GH-420) | An `attack` command sets a hashed `focusTarget`; any order that names a unit releases it; `reveal` and `callStrike` name no unit, so they release nothing (`sim.ts` ~L2174-2196). `stepFocus` (~L5576) walks a focused unit toward a target out of reach and, while the target is lost, to its last-seen tile for `FOCUS_LOST_TICKS` (100, 5 s). `canFocus` refuses a target not identified, and `focusStillTargetable` refuses a garrisoned one. | Tasks 5, 7, 8 |
| **#525** GH-113 intel moments (S-F's half of the old Lane A list, landed) | `packages/app/src/ui/intel-moments.ts`: the READY/CALL/RESULT lines, the announcer's `sweep_ready`/`strike_ready`/`sweep_inbound`/`strike_inbound`, and an **intel rate** (`IntelRate`) that feeds the strip's `+N/min`, the tile's charge clock and the telemetry field `intelRate`. Its spec copies `SWEEP_RADIUS_SQ`, `STRIKE_SPLASH` and `STRIKE_DELAY_TICKS` and **reads `tuning.ts` as text** (`intel-moments.test.ts` ~L27-38). `tools/src/intel_moments_world.test.ts` **pins the trickle by literals** (8/min a drone, 5/min a holding scout, on `umm_zeitoun_4_clearance`). | Tasks 3, 6; Lane A |
| **N0/N1a/N1b** versus (#554 … #600) | `packages/net`. Rooms run Free Play only (`main.ts` ~L1458) and build no `MissionRuntime`. `validateCommand` drops `callStrike` and `reveal` in a versus room (`packages/net/src/ownership.ts` ~L53-56, #559 F1). `cleanCommand` (`protocol.ts` ~L154) rebuilds a `callStrike` as `{ kind, caller, x, y }`. #600 adds two maps, `milh_flats` and `wadi_tarfan`, both with an `elevation` grid. | Tasks 4, 6 |
| **#599** three r186, **#601/#603** unit polish, **#592** garrison banner | Render and art only. Nothing F1 reads. | none |
| the garrison overhaul (`feat/garrison-overhaul`, not merged) | See "Interactions" below. Its pins move first; F1 rebases onto them. | Tasks 2, 5, 6, 7, 9 |

### Stale items fixed in place (14 Oct)

| where | was | now |
|---|---|---|
| Base | cut after #291, #330, #540 and targeted fire | all four are on `main`; **cut after the garrison overhaul merges** |
| Global Constraints, Re-pins | pin values quoted as expected numbers | named pins only ("main's current pins"), as above |
| Global Constraints, Lane C | the only `packages/app` edits are `cues.ts` and `alerts.test.ts` | plus `tools/src/intel_moments_world.test.ts` (Task 3) and one `packages/net` edit (Task 6, ruling F-R5) |
| File structure | `mission.ts` tasks 1, 3, 5, 6, 8; `determinism.test.ts` 1, 3; `tuning.ts` 2, 3, 6, 7 | `mission.ts` 1, 3, 5, 8; `determinism.test.ts` 1, 3, 5; `tuning.ts` 3, 5, 6, 7 (Task 2 writes docs only; Task 5 adds `INTEL_PER_RISE`/`HIGH_GROUND_*` and the relief fixture); two new rows |
| D4 | `EYE_HEIGHT` `sim.ts` ~L792 | ~L834 |
| Task 1 Step 1 | "a `destroy` secondary" | `destroy_all` (`SUPPORTED`, `mission.ts` ~L399, has no `destroy`) |
| Task 3 Step 2 | `MISSION_EVENT_KINDS` ~L379; trickle ~L420, ~L1066 | ~L384; `INTEL_PER_MIN_*` ~L427-428, accrual loop ~L1086-1100 |
| Task 3 | the trickle's only pinning test is in `mission.test.ts` | also `tools/src/intel_moments_world.test.ts` claim 1; rewritten in Task 3 (F-R9) |
| Task 4 | 21 relief maps, 12 flat | **23 relief, 12 flat** (`milh_flats`, `wadi_tarfan` added, #600). Economy missions on relief: still 16 of 18 |
| Task 5 | #279 ruling (a)'s sim half "not on `main`" | landed in #580 |
| Task 6 Step 2 | `hash()` ~L5587 | ~L6198; the `pendingStrikes` loop ~L6267-6273 (hashes `x`, `y`, `readyTick`; `by` is not hashed) |
| Task 7 Step 2 | the `smoke` command branch | `sim.ts` ~L2444-2468; the stamp is the `SMOKE_RADIUS` disc loop, `smokeLaid` pushed per carrier |
| Task 8 interfaces | `sweepCost`/`strikeCost` as wrappers | they are **getters** (`get sweepCost()`, `mission.ts` ~L652), read as properties by `main.ts` ~L3677, `ui/production.ts` ~L221 and `IntelMoments`; they stay getters, and `supportCost(kind)` is the new method |
| Task 8 | app call site `main.ts` ~L3612 | `requestSweep`/`requestStrike` at `main.ts` ~L4068-4069; `armedSupport` ~L3669 |
| Task 8 pin | "a drone sweep moves no player unit" | "no player unit **without a focus**" (F-R6) |
| Task 9 | 26 winning plans, 23 controls | **36 winning plans** (#539/#542) and **25 controls** (`passiveAcrossSeeds`, 19 `defeat` + 2 `withdrawn` + 4 chained `defeat`), each on 30 seeds |
| Task 9 Step 2 | `LADDER_CREDITS` quoted as a number | named pin; the spending plan must also clear its `time limit` headroom on every seed |
| Task 10 Step 1 | census over `briefing` and objectives | missions now also carry `debrief` text (`qarn_hadid_1_recon`'s "the map was the intelligence": narrative, true) |
| Task 10 Step 3 | GDD §3 L80 only | also GDD L70 ("generated by drones, scout teams, informants, and SIGINT structures"); README L45-46 unchanged |
| Lane A | charge timer and announcement still to build | GH-113 landed for sweep and strike (#525); S-F extends it to four kinds and decides the rate and clock (F-Q11) |

### Interactions

**Hold position (#577).** No sim command; H is `halt` for the units outside a building and nothing
for a garrison. F1's tests say "a halted unit" (sim `halt`), never "held". A garrisoned unit never
counts as holding a rise (F-R7), so H and the rise never meet. Nothing else.

**Targeted fire (#591).**
- *Calling support releases no focus.* All four kinds go through `reveal` or `callStrike`, which
  carry no ids. Task 8 pins it: "calling support leaves every focus standing".
- *A drone sweep can move a focused unit.* `identifyTo` re-identifies a lost focus target, so
  `stepFocus` resets `focusLost` and the unit keeps chasing instead of giving up at 5 s. Task 8's
  "a sweep moves no player unit" is therefore true only of units **without a focus**; the focused case
  is pinned as its own decision (F-R6).
- *The player's own smoke screen can walk his focused unit.* A screen between a focused unit and its
  target drops the contact below identified; T-D3 walks the unit to the last-seen tile for up to 5 s,
  then ends the focus. Task 7 pins this as measured behaviour, not as a defect.
- *A focus chase leaves a rise.* A focused unit whose target is out of reach walks to it, so its rise
  count resets. Task 5 pins it.
- *Garrisons cannot be focused* (`focusStillTargetable`). A barrage is the player's answer to a
  defended building, which is the design's point.
- *Earn rule.* `attack` needs an identified target, so it creates no "first identified" pay itself.

**The mission time limit (#540).**
- `requestSupport` refuses once `ended`, and a withdrawal is an end. No new rule.
- Task 1's inline fixture declares no `time_limit_s` (it is required only of shipped missions,
  `validate_time_limit.mjs`), or one above `ECONOMY_TICKS`. `economyHash` does not fold the limit:
  `timeLimitTicksLeft` is derived from `tickCount` and holds no runtime state (F-R11).
- Task 9's spending plan must still win on 30/30 seeds **and** clear `limitHeadroom` (the larger of
  120 s and 1.2× the slowest win). Task 2 reports each plan's 150th-intel arrival against its limit.
- The two `withdrawn` controls run to their limit (2× target), several times longer than the
  winning plan. With the trickle gone, a passive force still earns what walks into its sight, for
  longer. Whether the passive-versus-winner gate compares end totals or totals at the same tick is
  F-Q12.

**The garrison overhaul (branch, read at `fb3174c8`).** Rulings 1-7 of 14 Oct; no new hashed
column; new fields `garrison_cover` (default 3) and `floors` (default 1),
`fires_from_building` (default true), `GARRISON_RANGE_BONUS` (1 tile, `tuning.ts`).
- *Strikes and garrisons.* `applyDamage` returns at once for a garrisoned unit (the building takes the
  hit), unchanged. `stepStrikes` applies suppression with `coverProtects = false`, and `garrison_cover`
  is read **only** under `coverProtects` (branch `applySuppression`, ruling 1). So an air strike, and a
  barrage if it copies the strike path, pins a garrison at full value, while a mortar team's own round
  is muffled by `garrison_cover`. F-Q13.
- *Identification from and of a garrison.* A garrisoned unit is spotted as if in cover 3 (G2), so
  enemy garrisons are identified later and pay "first identified" later. A side-0 garrison sees from
  its window and from upper floors (G1, G3 `eyeLift`), so it identifies further and is paid for it,
  with `observer >= 0`. A starting force garrisoned at t=0 can therefore earn without moving. F-Q14.
- *High ground.* A garrisoned unit's position stays its building's centroid, and B6 found centroids
  **outside** their own footprint (the two `khan_rafid_3` shanties), so "a blocked tile is never on a
  rise" does not exclude every garrison. Task 5 skips `garrisonedIn >= 0` (and `carriedBy >= 0`)
  explicitly (F-R7).
- *Smoke.* On the branch `raySmoke` takes both eye lifts. A two-floor garrison's eye sits at the
  plume's top and a three-floor one's above it, so a smoke screen may not blind an upper floor.
  Task 7 pins what the code does over a 3-floor `apartment`, measured.
- *Plans and probes.* Five plans were re-scripted to fight garrisons that shoot back (UZ I, UZ III,
  UZ IV, WH IV, DA II), with `GARRISON_RANGE_BONUS` reach. Task 2's census and Task 9's choice of a
  spending mission read the post-merge plans. `sarim_rifles` can garrison now, and a `garrison`
  stance needs the ability (`validate_garrison.mjs`), so Task 1's fixture enemy uses a stance its unit
  supports.
- *A garrisoned caller.* `requestStrike` picks the first living surface side-0 unit, which may be in
  a building or be a mortar team that cannot fire from one (`fires_from_building: false`, G4). A call
  is not a weapon: ruled allowed, unchanged.

**Versus and the network (N0/N1a/N1b).** F1 does **not** move any versus hash, and there is none to
re-pin: `tools/src/net/two-client.test.ts` and `pnpm net:engines` compare two clients or three
engines with each other, never with a stored number, and the versus probe pins only its constants.
Rooms build no `MissionRuntime`, so no intel, no earn rule and no `requestSupport` run in them, and
`validateCommand` drops `callStrike`/`reveal` in versus, so `pendingStrikes` is empty there and the
new `hashWord(h, s.profile)` (inside that loop) adds nothing. One real gap: `cleanCommand` rebuilds a
`callStrike` without `profile`. In a non-versus room a barrage would arrive as an air strike on every
machine: deterministic, silent, and invisible to `tsc` because `profile` is optional. No room can send
one today; G-H co-op will. Task 6 carries `profile` through `cleanCommand`, with a protocol test
(F-R5). Task 4's map sweep includes the two versus maps; they get rise counts like any other map,
and nothing reads them in a room.

### Pre-flight conflict scan (superpowers, 14 Oct)

**Shared files and interfaces, by task pair.**

| tasks | shared | produced / consumed | found | ruling |
|---|---|---|---|---|
| 1 × 3 | `economyHash`, `determinism.test.ts` | 1 births `ECONOMY_PIN`; 3 re-pins it once | 3 adds `paidIdentified`, which no hash covers as written | **F-R3**: Task 3 folds `paidIdentified` (its size, then its ids ascending) into `economyHash` inside its one re-pin |
| 1 × 5 | `economyHash`, `determinism.test.ts` | 5 folds rise counters and the paid set; claims `ECONOMY_PIN` does not move | any `hashWord` of a length (even 0) moves the flat pin, so "does not move" is false as written | **F-R2**: fold per-rise state in a loop over `count` with **no length word**; a flat map has `count` 0 and adds nothing. `ECONOMY_PIN_RELIEF` is born in the same commit |
| 3 × 5 | `mission.ts` `step`, `mission.test.ts` | 3 replaces the income block's intel half; 5 adds the rise pass | both edit the same block; order matters for the hash | 5 adds its pass after 3's, one pass over `playerIds`; no conflict |
| 3 × 8 | `mission.ts`, the earn rule | 8's sweep emits `observer: -1` | 3 pays only `observer >= 0` | consistent (D3) |
| 4 × 5 | `intel-earn.ts` | 4 produces `highGroundRises(elevation, blocked, w, h)`; 5 calls it with `sim.elevation`, `sim.blocked` (public, `sim.ts` ~L876, ~L896) | rises are open tiles only, but a garrison can stand on an open tile (B6) | **F-R7**: 5 skips garrisoned and carried units itself |
| 6 × 7 | `sim.ts` `stepStrikes`, `tuning.ts` `FIRE_SUPPORT`, `fire-support.test.ts` | 6 adds `profile` and `payload`; 7 fills the `'smoke'` branch | consistent; 7 depends on 6 | none |
| 6 × 8 | `callStrike.profile` | 8's `requestSupport` queues it | consistent | none |
| 6 × app | `tuning.ts` as text | `intel-moments.test.ts` regexes `export const STRIKE_SPLASH = (\d+);` etc. | folding the `STRIKE_*` literals into the table throws "not found in tuning.ts" | **F-R4**: keep `SWEEP_RADIUS_SQ`, `STRIKE_SPLASH`, `STRIKE_DELAY_TICKS` (and the other `STRIKE_*`) as literal `export const` lines; `FIRE_SUPPORT[0]` references them |
| 6 × net | `Command`'s `callStrike` | `cleanCommand` rebuilds it | drops `profile` silently | **F-R5**: Task 6 adds `profile` (optional, integer, inside `FIRE_SUPPORT`'s range) to `cleanCommand` and a round-trip test in `protocol.test.ts`; one `packages/net` file |
| 3 × tools | the trickle | `intel_moments_world.test.ts` claim 1 pins 8/5 per minute by literals | goes red at Task 3, unplanned | **F-R9**: Task 3 rewrites claim 1 to the new rule (standing still: intel unchanged, `IntelRate.perMin()` 0, `ticksTo` `Infinity`) in the same commit; claim 2 (the sweep readout, `intel_start` 250) stays |
| 3 × app | `MISSION_EVENT_KINDS` | `cues.ts`, `alerts.test.ts` | as planned (Step 2b) | none |
| 7 × targeted fire | the `smoke` branch | the focus release sits in the command pre-pass, not in the branch | extracting the stamp must not move it; a support round names no unit and releases nothing | **F-R12**: extract only the disc write; pin "a smoke-screen round releases no focus" |
| 8 × targeted fire | `reveal` | re-identifies a lost focus | the sweep pin is false for focused units | **F-R6**: pin "a drone sweep moves no player unit without a focus" and "a focused unit whose lost target a sweep re-identifies keeps its chase" |
| 8 × app | `sweepCost`/`strikeCost` | getters, read as properties | an interface written as methods breaks `typecheck` in `app` | **F-R10**: getters stay; `supportCost(kind)` is a method |
| 9 × 3, 5, 8 | `playtest.ts` | 9 reads intel and calls `requestSupport` | consistent | none |
| 9 × #540 | `plan-sweep.ts`, `time-limit.ts` | the spending plan's wins | must clear `limitHeadroom` | stated at Task 9 |
| 2, 9 × garrison overhaul | plans, census | five plans re-scripted on the branch | a census taken before the merge measures plans that no longer exist | **F-R13**: Task 2 and Task 9 read only the post-merge base |
| 10 × 2 | numbers | 10 writes 2's approved table into GDD and README | consistent | none |

**Each task against itself.**

| task | finding | ruling |
|---|---|---|
| 1 | Fixture names a `destroy` secondary; the type is `destroy_all`. A `garrison` stance needs the ability | **F-R8**: `destroy_all`; fixture enemy uses a stance its unit supports |
| 2 | Docs only, yet the file table listed `tuning.ts` | table fixed |
| 3 | Files list omits the two `app` rows Step 2b adds, and the tools test F-R9 adds | Files list fixed |
| 4 | Map list stale (21/12) | 23/12, read from the directory as the task already says |
| 5 | Step 3 adds a fixture to `determinism.test.ts`, which its Files list omits; the "unmoved" claim needs F-R2 | Files list fixed; F-R2 |
| 6 | Files lists `determinism.test.ts` but Step 3 only measures there; the raze test needs a `MissionRuntime` | fine: `fire-support.test.ts` may build a runtime; `determinism.test.ts` is read, not edited |
| 7 | consistent | none |
| 8 | interface vs getters (F-R10); the sweep pin (F-R6) | fixed in place |
| 9 | denominators 26/23 | 36/25, recounted on the base |
| 10 | census misses `debrief`; GDD L70 | fixed in place |

**Rulings I could make (F-R1 … F-R13)** are above, each beside its row, plus two that have no row:
**F-R1**, F1 is cut from `main` after the garrison overhaul merges and every count is read there; and
**F-R11**, `economyHash` does not fold the time limit. **What only the lead can decide** is "For the lead (14 Oct)" below.

### For the lead (14 Oct)

11. **F-Q11. The intel rate and clock after the trickle.** GH-113 (#525) shows `+N/min` on the strip
    and a charge clock on each support tile, from `IntelRate` measuring a steady trickle. After Task 3
    intel arrives in lumps (10, 25, 30), so the rate reads 0 at rest and a guess after a lump, and the
    telemetry field `intelRate` turns to noise. F1 only rewrites the tools test that pins the trickle
    (F-R9). **Recommended:** S-F retires the intel `+N/min` and the tile clock (logistics keeps its
    own) and shows the last earn instead ("+30 high ground"), which F-Q7's feed line already carries.
12. **F-Q12. What the passive gate compares.** `INTEL_PASSIVE_BEATS_WINNER` compares each control's
    total with its winning plan's. Two controls now run to their time limit (`withdrawn`), and a
    control usually runs longer than the plan it pairs with. **Recommended:** compare intel **at the earlier
    of the two end ticks**, and print both end totals beside it. Comparing end totals would charge a
    passive force for the extra minutes it lost in.
13. **F-Q13. Does a barrage respect cover?** The air strike suppresses with `coverProtects = false`,
    so after the overhaul it ignores `garrison_cover`. A mortar team's own round honours it (ruling 1).
    **Recommended:** a `coverProtects` field per profile: `false` for `air_strike` (byte for byte as
    today), `true` for `mortar_barrage`, so a barrage on a building suppresses its garrison exactly
    as a mortar team's round does. The alternative, a barrage that pins any garrison, makes it the
    standard answer to every building.
14. **F-Q14. A garrison as an observation post.** Since the overhaul a side-0 unit at an upper window
    sees further and is paid for what it identifies, even if it was placed there at t=0. The 6 Oct
    ruling denied pay to a spawn rise, not to spotting. **Recommended:** keep it (spotting is the
    act), and let Task 9's passive gate catch it if it turns into a trickle.

Still standing from earlier passes: the six 6 Oct questions, F-Q10 and the four Pre-flight 2
questions are ruled. F-Q7 (the earn feed line) and F-Q9 (fire support on a `raze` target) are taken
defaults that need the lead only if he wants the rise to chime, or if Task 2's barrage timing
collapses a mission's length. F-Q8 is S-F's.

## Changed since 4 Oct (refreshed 6 Oct)

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

## Pre-flight 2 (2026-10-11), evening, against main 49715ff9

Read and grepped, not run. Two of F1's #402-era premises were changed by #537 (lead ruling, 11 Oct):

- **"The closing rule walks a unit off a rise" (D4, Task 5) is no longer true of a player's unit.**
  `stepSweep` (~L5215) walks on only an attack-mover whose order set `sweep: true`: mission waves,
  trigger `commit`s and `targets.ts`. A player's right-click and every playtest plan stop where sent.
  Task 5's two pins are rewritten in place: a plain attack-mover stays on the rise and is paid; a
  `sweep: true` attack-mover (the AI's kind) walks off and is not. The held-unit case follows the
  ruling (lead, 2026-10-11) retiring Hold's sim command: use `halt`.
- **"A drone sweep sets the player's idle attack-movers walking" (Task 8, ruled "accept and pin" on
  6 Oct) is no longer true.** `reveal`/`identifyTo` still identify, but an arrived player attack-mover
  has `sweepOrder` 0 and `stepSweep` skips it. The 6 Oct ruling accepted a side effect the 11 Oct
  ruling removed; Task 8's pin is inverted in place (a sweep moves **no** player unit; a `sweep: true`
  attack-mover does walk, the control). No new question: the lead's later ruling governs.
- **Task 2's earn census will read lower than the #402-era prior.** "Attack-movers now advance on what
  they identify (more 'first identified' pay)" was the closing rule; player plans no longer advance on
  their own. Task 2 measures it anyway; read its numbers fresh, not against the G3 priors.
- **Task 9's denominators.** #539/#542 count **36 winning plans** (gate-open and bought probes
  included) and **23 controls**, each on 30 seeds. Recount on the branch base and say which runs the
  gates count. `INTEL_PASSIVE_BEATS_WINNER` and `INTEL_WINNERS_ONE_SWEEP` are read from the 424242
  ledger, as `LADDER_CREDITS` and `GATES` are (#542); the plan Task 9 makes spend must still win on
  30/30 seeds (`plan-sweep.ts`).

| where | correction | |
|---|---|---|
| Global, Re-pins | Sim pins are **three**: flat `1202444260`, relief `3354895120`, orders `2737216487` (`determinism.test.ts` ~L438, ~L736, ~L845). The orders replay builds no `MissionRuntime` and calls no strike or `reveal` either, so all three stay unmoved (R) | fixed in place |
| Global, Task 9, Re-pins | `LADDER_CREDITS` = `CAMPAIGN_CREDITS` = **5917** (`playtest.ts` ~L3096; 5870 → 5850 #529 → 5947 #537 → 5917 #542) | fixed in place |
| Global | `pnpm playtest` is ~57 s locally (30-seed plan and control sweeps). "Byte-identical" compares the whole output, sweep lines included | noted |
| Task 5 | The two closing-rule pins and the 11 Oct note ("L1 is decided: no move-only order") | fixed in place; L1 reopened (#535) |
| Task 8 | "a drone sweep sets idle attack-movers walking" → "a drone sweep moves no player unit", control "a `sweep: true` attack-mover walks toward what it reveals" | fixed in place |
| Task 9, Step 2 | "A drone sweep here also sets the plan's idle attack-movers walking" is false since #537 | fixed in place |
| Order of landing | #540 (the mission time limit) lands Wed 4 Nov, just before F1 (ruling (lead, 2026-10-11)). Task 9's spending plan must then win inside its mission's limit too | noted |

---

## Pre-flight, 11 Oct (against main f2d5d9e8)

Read against `main` `f2d5d9e8` (11 Oct). The plan's sim and runtime half is unchanged in kind. The
app half it leans on moved a lot (≈70 PRs since `b44df7aa`), and three corrections are structural,
not renames: the new event kind needs app rows to typecheck, the app's support kinds are in seven
files and not one, and a barrage and a smoke round both reuse a sim event the renderer draws as an
air-strike blast.

What landed that touches F1:
- **#431 and #444 (pin).** `LADDER_CREDITS` and `CAMPAIGN_CREDITS` are **5870** (#431: 5830 -> 5868,
  `MissionRuntime.stepRoe` skips a structure any `raze` objective names, `razeExempt`; #444: 5868 ->
  5870). #431 edited `packages/sim/src/mission.ts`. The runtime code F1 edits is otherwise unchanged
  (`git diff b44df7aa f2d5d9e8 -- packages/sim` is #431 plus one test). Sim pins unchanged: flat
  `922714084` (`determinism.test.ts` ~L427), relief `3200430224` (~L721).
- **#426 audio cues.** `packages/app/src/ui/cues.ts` `MISSION_EVENT_SOUND` is a `Record` over
  `MissionEvent['kind']`, so a new kind with no row is a `tsc` error in `app`, and `cues.test.ts`
  fails on it. `alerts.test.ts` also holds a `Record<MissionEvent['kind'], MissionEvent>` sample.
- **#428 and #461 tiered feed.** Every alert carries a tier (`minor`/`important`/`major`), a tone
  (good/info/warn/bad) and a place; repeats merge within 8 s with a count; Space jumps to the latest
  important or major alert (`ui/alerts.ts`, `ui/feed-model.ts`).
- **#454 one chrome register.** Intel and logistics are `--info`, credits `--commend`, an armed
  button `--live`, disabled `--disabled-opacity`. The support tiles already follow it
  (`theme.css` `.rl-tile--support`); `chrome-register.test.ts` pins `.rl-tile__cost` to `--info`.
- **#427 pointer.** An enemy under the cursor reads `advance`; a wall click resolves to its building
  through `pointerPoint`/`structureAtScreen`. The armed-support click in `main.ts` does **not** use
  it (it calls `renderer.screenToWorld`), the open lead question on ground-point aiming.
- **Hold position** is still planned (`2026-10-06-hold-position.md`, Wed 4 Nov, before F1); the
  keymap still has `halt` on H at `f2d5d9e8`. Not landed.
- Nothing else F1 reads moved: `INTEL_PER_MIN_*`, `requestSweep`/`requestStrike`, `callStrike`,
  `pendingStrikes`, `stepStrikes`, `STRIKE_*`/`SMOKE_*`, `CONTEST_RADIUS_SQ`, `creditContribution`
  (both call sites), `EYE_HEIGHT`, `creditInputFrom`. 21 relief / 12 flat maps, re-counted from
  `data/maps/*.json`; the seven maps edited since `b44df7aa` changed no `elevation`. `playtest.ts`
  denominators unchanged (26 winning plans, 23 controls). Locale overlays: none ship, so Task 10's
  mission text needs none. No mission text names a sweep or a strike (unchanged).

| task | what changed | fixed in place / question |
|---|---|---|
| Global, Task 9, Re-pins | `LADDER_CREDITS` 5830 -> **5870** (`playtest.ts` ~L3195, was "~L3181"; `stores-model.ts` `CAMPAIGN_CREDITS` L63) | fixed in place |
| Global, Base | Hold position re-pins both sim pins once (its own plan) before F1, as does #291 | fixed in place: the pin line and Base say "whatever #291 and Hold re-pin them to" |
| Task 3 | A new `intelEarned` kind breaks `app` `typecheck`: `cues.ts` `MISSION_EVENT_SOUND` and `alerts.test.ts` `sample` need a row each (#426, #428) | fixed in place: Step 2 and the file table name both rows; sound is a stated silence (F-Q7) |
| Task 3 | #428: an earn line must name where. `IntelEarnedEvent.ref` alone cannot (a rise id has no position outside the sim) | fixed in place: the event carries `at` (integer tile); tier and tone in F-Q7 |
| Task 6 | `stepStrikes` pushes a `strike` SimEvent per round; `ThreeRenderer.onStrike` draws 18 blast puffs and `overlay.ts` logs "PRECISION STRIKE". A smoke round would blast; a barrage round would look like an air strike | fixed in place: a smoke round emits `smokeLaid`, not `strike`; a barrage round's `strike` carries `profile`; render/audio dressing is S-F's (F-Q8) |
| Task 6 | #431: a structure a `raze` objective names costs no Conduct, whoever levels it, so a barrage on a raze target is free of ROE and cheap to complete | fixed in place: a test pins both sides; Task 2 measures the raze missions with a barrage (F-Q9) |
| Task 8 | The plan says the one `app` edit is a call-site rename `typecheck` forces. False: the app's `'sweep' \| 'strike'` literals live in `main.ts` (`armedSupport`, ~L3263 and the `pointerup` branch ~L3612, not "~L3204"), `input/intents.ts`, `input/pointer.ts`, `input/keymap.ts` (`anyArmed`), `input/cursor.ts`, `ui/order-sight.ts` (`SightOrderId`), `ui/symbol.ts` (`ORDER_IDS`), `ui/production.ts`, plus telemetry (`orderVerb` enum). The sim's `SupportKind` is a different type; keeping `requestSweep`/`requestStrike` wrappers means nothing forces a rename | fixed in place: Task 8 touches **no** `app` file; the app keeps its two literals until S-F |
| Task 10, Lane A | Chrome now false after F1 also includes `hud.strip.intel.tip` ("sweep and precision-strike"), `hud.hint.first.intel` (`data/hints/first_use.json` -> `en.json`), `main.note.supportRefused` ("not enough intel": a refused call can also be "no caller") | fixed in place: Lane A list |
| Lane A | Charge timer, announcement, earn line and counter now have a register to follow (tier, tone, place, `--info`, cue table, voice) | fixed in place: Lane A list rewritten; open points are F-Q7, F-Q10 |
| Task 5 | `hold` command and `holdPos` are the Hold plan's; a plain `move` (no move-only order will exist: L1 decided (early Oct, lead): no move-only order; disengage stays via Hold/halt and orders) also leaves `attackMove` clear, so it holds a unit on a rise without Hold | no change needed; noted at Task 5 |
| (checked, no change) | memory budgets (#474: F1 adds no structure, no GLB), roster R-2 and `ROSTER_CAP` (F1 writes no roster), keymap H/X (F1 binds no key), footers (#501), i18n catalogue (no string in F1's own code), locale overlays | none |

### For the lead (11 Oct)

7. **F-Q7. The earn feed line and the counter (GH-77).** Recommended: each cause is a **`minor`
   alert, tone `info`** (intel is `--info`), worded "+10 intel: <enemy name> identified, <place>",
   "+30 intel: high ground, <place>", merged within 8 s with a count ("+30 intel: 3 enemies
   identified"). An objective's +25 gets no line of its own: the objective alert already says it,
   and the strip's counter pulses. Never `important`: that tier takes the Space jump key, which
   must keep going to threats. **Silent** in `MISSION_EVENT_SOUND` (reason: "the strip's counter
   and the feed carry it; a chime per kill would nag"). No world mark (standing ruling). Needs the
   lead only if he wants the rise to chime.
8. **F-Q8. What a barrage and a smoke round look and sound like.** Recommended: the sim emits
   `smokeLaid` for a smoke round and `strike` (with `profile`) for each barrage round; S-F maps
   `profile` to the existing `shell_impact` emitter for the barrage and to the smoke plume for the
   screen, and `onStrike` keeps the air-strike look only for profile 0. Presentation, so S-F's
   call; recorded here so Tasks 6 and 7 do not ship the blast.
9. **F-Q9. Fire support on a `raze` objective.** After #431 a barrage that levels a raze target
   costs no Conduct. Recommended: allow it (that is what artillery is for), and have Task 2 time
   `wadi_halam_5_depot` and `tel_marum_2_foothold` with one barrage so it cannot trivialise them. If
   it does, the fix is the mission's `seconds` floor, not the rule. Needs the lead only if the
   measurement shows a collapse of the mission's length.
10. **F-Q10. Armed support aims at the ground point, not the building (the #427 open question).**
    The armed click calls `screenToWorld`, so a barrage at a tall building's upper facade lands on
    the ground behind it. Recommended: **all armed support** (strike, barrage, smoke screen, sweep)
    resolves through `pointerPoint`, so the point marked is the point hit and a wall click aims at
    the building. The smoke key and armed smoke follow whatever the lead rules.
    **RULED 11 Oct (lead): a click on a building wall resolves to THAT building** for fire support.
    S-F routes every armed support click through `pointerPoint`, with a test per kind.

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
  4 Oct (refreshed 6 Oct)"), checked against `f2d5d9e8` (11 Oct, see "Pre-flight") and against
  `f4b3ea2b` (14 Oct, see "Changed since 4 Oct (refreshed 14 Oct)"). Locate code by symbol; line
  numbers drift.
- Branch `feat/gf1-intel`, cut from `main` **after the garrison overhaul
  (`2026-10-14-garrison-overhaul.md`, `feat/garrison-overhaul`) has merged**. Everything this plan
  used to wait on is on `main` as of 14 Oct: #330 (October), #291/#279/#247 (#580), #540 (#585),
  targeted fire (#591) and the Hold ruling's app half (#577). Stage 4 started early, on 13 Oct, so
  there is no November slot to wait for. Worktree under `/Users/ilpinto/dev/roaring-lions-ep/`,
  `pnpm install` once. Task 1's commit message records main's current pins (the three sim pins,
  `LADDER_CREDITS`, `CAMPAIGN_CREDITS`, `ROSTER_MAX`, `GATES`), read on the branch base.
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
    `packages/sim/src/sim.ts` ~L834 on 14 Oct.)* *(14 Oct: a garrisoned or carried unit never holds a
    rise, whatever tile its position sits on (F-R7), and a unit chasing a focus leaves one.)*
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
- **The three sim pins stay UNMOVED by every task**: main's current flat, relief and orders pins
  (`determinism.test.ts`, the `expect(...hash()).toBe(...)` lines at ~L488, ~L857 and ~L977 on
  `f4b3ea2b`; read them on the branch base, after the garrison overhaul has re-pinned them, and
  never copy a number from this plan). The golden replays never call a strike (grep, 14 Oct:
  `determinism.test.ts` has no `callStrike`, `reveal` or `MissionRuntime`; grep again in Task 6,
  Step 3; if one does, stop and raise it). The new `profile` field is hashed inside the
  `pendingStrikes` loop, which is empty in all three replays and in every versus room (rooms build
  no runtime, and versus drops `callStrike`), so no number moves. A move is a defect, never a re-pin.
- **The economy pin (born in Task 1) moves exactly once in this plan**, in Task 3, with the reason in
  the commit message and a dated comment above the number.
- **`pnpm balance`**: exit 0, every §5.7 target passes, byte-identical (R): `targets.ts`
  (`tools/src/backtest/targets.ts`, run by `tools/src/balance/cli.ts`) builds no `MissionRuntime`
  and spends no intel.
- **`pnpm playtest`**: exit 0, every plan, control and gate on all 30 seeds, every `time limit`
  headroom line clear. Outcomes, durations, ROE, stars and credits byte-identical (R): no plan
  spends intel today, and `creditInputFrom` (`packages/sim/src/credits.ts` ~L59) reads no intel (M,
  G3 sheet; still true at `f4b3ea2b`). `LADDER_CREDITS` (`tools/src/backtest/playtest.ts` ~L3431 on
  `f4b3ea2b`), held equal to `CAMPAIGN_CREDITS` (`packages/app/src/ui/stores-model.ts` L63) by
  `tools/src/campaign_credits.test.ts`, stays at main's current value, whatever the garrison
  overhaul leaves it at; so do `ROSTER_MAX` and `GATES`. Task 9 adds new printed lines; the existing
  lines do not move.
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
  `tools/src/backtest/`. The only `packages/app` edits are Task 3's two exhaustiveness rows (`cues.ts`, `alerts.test.ts`);
  the menu UI is WP-S-F's. *(14 Oct: plus Task 3's rewrite of `tools/src/intel_moments_world.test.ts`
  claim 1 (F-R9), and one `packages/net` edit in Task 6, `cleanCommand` carrying `profile` (F-R5).
  No dev server, no browser, no `pkill`.)*

---

## File structure

| File | Role | Task |
|---|---|---|
| `packages/sim/src/mission.ts` | `economyHash()`; the earn rule; the per-minute terms deleted (~L427-428, ~L1086-1100 on `f4b3ea2b`); the four-item `requestSupport` | 1, 3, 5, 8 (6's raze test builds a runtime, edits none) |
| `packages/sim/src/determinism.test.ts` | The economy replay and its pins (`ECONOMY_PIN`, Task 5's `ECONOMY_PIN_RELIEF`) | 1, 3, 5 |
| `packages/sim/src/intel-earn.ts` (+ test) | **New.** Pure: `highGroundRises(elevation, blocked, w, h)` and the median | 4 |
| `packages/sim/src/tuning.ts` | `INTEL_EARN`, `FIRE_SUPPORT` profiles, `HIGH_GROUND_*`; the `STRIKE_*`/`SWEEP_RADIUS_SQ` literal lines stay (F-R4) | 3, 5, 6, 7 (2 only proposes numbers) |
| `docs/campaign/economy/fire-support-numbers.md` | **New.** The G-NUM table | 2 |
| `packages/sim/src/sim.ts` | `pendingStrikes[].profile`; the smoke payload; `hash()` | 6, 7 |
| `packages/sim/src/fire-support.test.ts` | **New.** Barrage and smoke-screen sim tests | 6, 7 |
| `packages/sim/src/mission.test.ts` | Earn and spend tests | 3, 5, 8 |
| `packages/sim/src/index.ts` | Exports `SupportKind`, `FIRE_SUPPORT_KINDS` | 8 |
| `packages/app/src/ui/cues.ts`, `ui/alerts.test.ts` | One `intelEarned` row each (`MISSION_EVENT_SOUND` and the `sample` record are exhaustive over `MissionEvent['kind']`, so `typecheck` fails without them) | 3 |
| `tools/src/intel_moments_world.test.ts` | **(14 Oct)** Claim 1 pins the trickle by literals; rewritten to the new rule (F-R9) | 3 |
| `packages/net/src/protocol.ts` (+ `protocol.test.ts`) | **(14 Oct)** `cleanCommand` carries `callStrike.profile` (F-R5) | 6 |
| `packages/app/src` (support literals) | **No edit in F1.** The app keeps `'sweep' \| 'strike'` (`main.ts`, `input/*`, `ui/production.ts`, `ui/order-sight.ts`, `ui/symbol.ts`, telemetry) behind the `requestSweep`/`requestStrike` wrappers; S-F renames them | 8 |
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
  garrison, a `hold_for` primary and a `destroy_all` secondary. *(14 Oct: `destroy_all`; there is no
  `destroy` type (`SUPPORTED`, `mission.ts` ~L399). After the garrison overhaul a `garrison` stance
  needs the unit's `garrison` ability (`validate_garrison.mjs`), so give the enemy a stance its unit
  supports. Declare no `time_limit_s`, or one above `ECONOMY_TICKS`: the fixture must not withdraw.)* Step it `ECONOMY_TICKS` (2400, two
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
  *(14 Oct: 36 winning plans and 25 controls on `f4b3ea2b`, on the post-garrison-overhaul plans
  only (F-R13). Report the 150th point's arrival beside each plan's `time_limit_s` as well as its
  victory tick. A garrisoned side-0 unit identifies from its window and upper floors and is paid for
  it (F-Q14): count those identifications in their own column.)*
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
  *(14 Oct: #584 made a unit mortar's splash suppression real (it was ×2/65536), so compare the
  barrage's 0.6 with a `mortar_team` round as it lands today. Measure the barrage on a garrisoned
  building both ways F-Q13 offers, cover honoured and cover ignored, and put both rows on the table.)*
  *(11 Oct, #431: a `raze` target costs no Conduct whoever levels it. Also time one barrage on
  `wadi_halam_5_depot` and `tel_marum_2_foothold` and record how much of each mission's length it
  removes; F-Q9.)*
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
`packages/sim/src/determinism.test.ts`; `packages/app/src/ui/cues.ts` and `ui/alerts.test.ts`
(Step 2b); `tools/src/intel_moments_world.test.ts` (Step 2c, 14 Oct).

**Interfaces:**

```ts
// tuning.ts (values from Task 2's approved table)
export const INTEL_PER_IDENTIFIED = 10;
export const INTEL_PER_OBJECTIVE = 25;
// mission.ts
/** Side-0 first identifications already paid for (D3). Runtime-only. */
private readonly paidIdentified = new Set<number>();
/** Why intel moved this tick, for the HUD's feed (S-F). `at` is the integer tile the line
 *  names (#428: a feed line says where): the identified enemy's tile, the objective's zone
 *  centre, the rise's tile the unit stands on. */
export interface IntelEarnedEvent { kind: 'intelEarned'; tick: number; amount: number;
  cause: 'identified' | 'objective' | 'highGround'; ref: number | string;
  at: { x: number; y: number } }
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
  the rule also requires `observer >= 0`. `intelEarned` must join `MISSION_EVENT_KINDS` (`mission.ts` ~L384 on `f4b3ea2b`), or the
  `MissionEventKindsAreExhaustive` check fails `typecheck`. 14 Oct: that branch already keeps
  `this.identified` (every side-1 entity identified, `observer: -1` included) and `identifiedBy`
  (`observer >= 0` only). `paidIdentified` is its own set, because a sweep's identification must
  stay unpaid even if a real observer sees the same enemy later: decide that case in a test.)*
  *(11 Oct, #426/#428: that is not the only exhaustive list. `app`'s `MISSION_EVENT_SOUND`
  (`ui/cues.ts`) is a `Record` over `MissionEvent['kind']`, and `ui/alerts.test.ts`'s `sample` is a
  `Record<MissionEvent['kind'], MissionEvent>`: add a row to each in this commit, or `pnpm
  typecheck` fails in `app`. The `cues.ts` row is `{ silent: '<reason>' }` (F-Q7: the counter and
  the feed carry it); `cues.test.ts` requires a reason over 10 characters, and the alerts test
  then requires `alertsForTick` to raise no cue for that kind, so the row is a decision, not a
  gap. `describeMissionEvent` (`main.ts`) and `missionEventTier` (`alerts.ts`) already end in
  `default`, so the kind draws no line until S-F words it, as intended. The tutorial's
  `steps.test.ts` reads `MISSION_EVENT_KINDS` and needs no row.)*
- [ ] **Step 2b: The two `app` rows** (above), and `pnpm typecheck` green at this commit.
- [ ] **Step 2c (14 Oct): the trickle's other pin.** `tools/src/intel_moments_world.test.ts` claim 1
  holds GH-113's tile clock against the trickle, by literals (8/min a drone, 5/min a holding scout,
  on `umm_zeitoun_4_clearance`), and goes red at Step 2. Rewrite it to the new rule, in this commit
  (F-R9): stepped a minute with no contact, `runtime.intel` does not move, `IntelRate.perMin()` reads
  0 and `ticksTo(cost, intel)` reads `Infinity` (the tile shows no clock). Claim 2 (the sweep readout,
  on `intel_start` 250) stays as it is. What the strip and tile show instead is F-Q11, S-F's.
- [ ] **Step 3: Re-pin the economy pin, once.** The commit message says: *"economy pin re-pinned:
  intel now accrues from first identification and objective completion instead of per minute
  (G3 Q1, lead 4 Oct); was N"*. Dated comment above the number. *(14 Oct, F-R3: `economyHash`
  folds `paidIdentified` in this commit, its size and then its ids ascending, so the one re-pin
  covers the new state.)*
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
    reports 0. *(14 Oct, `f4b3ea2b`: **23 relief, 12 flat**. #600 added the versus maps `milh_flats`
    and `wadi_tarfan`, both with an `elevation` grid; nothing reads their rises, because a room runs
    no runtime, but the sweep covers them.)* On `main` at `b44df7aa` that was **21 relief maps** (`beit_sahwan_2`, `beit_sahwan_4`,
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
`HIGH_GROUND_LEVELS`, `HIGH_GROUND_HOLD_TICKS`), `packages/sim/src/determinism.test.ts` (Step 3's
relief fixture and `ECONOMY_PIN_RELIEF`).

- [ ] **Step 1: Write the failing tests:**
  - **"a unit standing 10 s on a rise pays 30 once"**;
  - **"leaving at 9.95 s pays nothing; returning restarts the count"**;
  - **"an enemy inside the contest radius stops the count"** (reuse `CONTEST_RADIUS_SQ`, the hold
    rule's own number);
  - **"a buried unit earns nothing on a rise"** (the `tunnelIn` guard the old loop had);
  - **"a drone over a rise earns nothing"**: holding ground is a ground act (`isAir` skip), the same
    rule #279 ruling (a) gives shepherding (ruled 29 Sep; its sim half landed in #580,
    `civilians.ts` ~L145 and ~L166);
  - **"a garrisoned unit earns nothing on a rise"** and **"a carried unit earns nothing on a rise"**
    (14 Oct, F-R7): skip `garrisonedIn >= 0` and `carriedBy >= 0` by name. A garrison's position stays
    its building's centroid, and the overhaul's B6 found centroids outside their own footprint, so
    the blocked mask alone does not exclude it. Fixture: a building whose centroid tile is open and
    on a rise;
  - **"a unit chasing a focus off a rise is not paid, and its count resets"** (14 Oct, #591): an
    `attack` on an identified target out of reach walks the unit (`stepFocus`);
  - **"a second unit on a paid rise pays nothing"**.
  - *(6 Oct, #402, ruled 6 Oct.) Put the test's unit on the rise with a move, then `hold` (Hold
    position, `2026-10-06-hold-position.md`, which lands before F1). An `attackMove` leaves
    `attackMove` set, and an arrived attack-mover with nothing inside effective range walks toward
    any identified enemy it cannot reach (`stepSweep`). So the contest test's enemy, if identified
    and out of reach, would walk an attack-moved holder off the rise, and the test would measure the
    closing rule instead. Pin both sides of that as decisions:*
    - ~~**"an attack-mover that identifies an enemy out of reach leaves the rise and is not paid"**~~;
    - **"a held unit stays on the rise and is paid"**.
    - *(Pre-flight 2, 2026-10-11, #537: a player's attack-move now stops where sent, so the first pin
      is false. Replace it with **"a plain attack-mover that identifies an enemy out of reach stays
      on the rise and is paid"** and **"an attack-mover ordered with `sweep: true` walks off and is
      not paid"** (the AI's kind). The held case uses `halt`: **ruling (lead, 2026-10-11)**, Hold's
      sim command is retired, so "a held unit" reads "a halted unit". Seen red: set `sweep: true` on
      the plain case's order.)*
  - *(11 Oct: a plain `move` also leaves `attackMove` clear, so a unit that moved onto the rise
    and was never attack-moved stays too. L1 is decided: no move-only order for the player (lead,
    early Oct). Hold is still the order the rise test should use, because it is the one the
    closing rule is documented to respect.)* *(Pre-flight 2, 2026-10-11: L1 was reopened and shipped
    as the N move, #535; and since #537 the closing rule no longer touches a player's order at all.)*
  - **"a unit that spawned on a rise earns nothing standing there"**: the ruling of 6 Oct, D4. It
    pays only after it leaves and moves back on. Track per unit, runtime-only, whether it has
    stepped onto the rise since spawning.
- [ ] **Step 2: Implement.** Rises computed once in the constructor from `sim.elevation` and the
  blocked mask. Per tick, one pass over `playerIds`: tile → rise id → a per-rise hold counter
  (`Int32Array(count)`), reset when no qualifying unit stands on it. The economy hash covers the
  counters and the paid set. *(14 Oct, F-R2: fold them in a loop over `count` with **no** length
  word, so a flat map, `count` 0, adds nothing to `ECONOMY_PIN`. A `hashWord` of the length, even of
  0, would move it, and this plan moves that pin only in Task 3.)*
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
  - **"a barrage round that levels a structure a `raze` objective names charges nothing, and one
    that levels any other structure still does"** (11 Oct, #431: `razeExempt` is the union of the
    raze objectives' structure sets, and `stepRoe` skips them for any `by` on side 0, a strike
    included). Fixture: a mission with a `raze` objective and one unnamed shed in splash.
  - **"each barrage round emits a `strike` event carrying its profile; a smoke round emits none"**
    (11 Oct: `ThreeRenderer.onStrike` draws an air-strike burst for every `strike` event and
    `overlay.ts` logs "PRECISION STRIKE", so a smoke round must not emit one).
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
  `hashWord(h, s.profile)` inside the existing loop (`hash()` ~L6198, the `pendingStrikes` loop
  ~L6267-6273 on `f4b3ea2b`, which hashes `x`, `y` and `readyTick` today; `by` is not hashed,
  unchanged). The `strike` event gains `profile: number` (additive; `SIM_EVENT_KINDS` needs no entry).
  *(14 Oct, three more things.)*
  - *F-R4: keep `STRIKE_DAMAGE`, `STRIKE_SPLASH`, `STRIKE_SUPPRESSION`, `STRIKE_DELAY_TICKS`,
    `STRIKE_SCATTER` and `SWEEP_RADIUS_SQ` as literal `export const NAME = <int>;` lines, and have
    `FIRE_SUPPORT[0]` reference them. `packages/app/src/ui/intel-moments.test.ts` reads `tuning.ts` as
    text by that regex, and fails on a missing line.*
  - *F-R5: `packages/net/src/protocol.ts` `cleanCommand` rebuilds a `callStrike` as
    `{ kind, caller, x, y }` and would drop `profile` without a type error. Carry it (optional,
    integer, `0 <= profile < FIRE_SUPPORT.length`, refused otherwise) and add a round-trip test to
    `protocol.test.ts`. `ownership.ts` needs nothing: versus still drops `callStrike`.*
  - *F-Q13: whether a barrage's suppression honours cover (and the overhaul's `garrison_cover`) is
    the lead's. Build `coverProtects` as a profile field so either answer is one table entry;
    `air_strike` keeps `false`, byte for byte.*
- [ ] **Step 3: Hash coverage.** **"the strike profile is hashed"**: two sims identical but for one
  pending entry's profile hash differently. Then measure both sim pins: **unmoved** (the loop is empty
  in both replays). If either moves, a replay fires a strike and the pins move for that reason only;
  stop and raise it, because that would make this the plan's sim re-pin and the commit must say so.
- [ ] **Step 3b (14 Oct): a garrison under a barrage.** On the post-overhaul base: a barrage round
  centred on a garrisoned building damages the building and not the men inside (`applyDamage`'s
  garrison return), and suppresses them by whatever F-Q13 rules. Pin both, with the ruling's date.
- [ ] **Step 4: See it red.**
  - Hash `s.x` twice instead of `s.profile`: "the strike profile is hashed" fails.
  - Drop `profile` from `cleanCommand`: the protocol round-trip test fails (14 Oct).
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
  - **"a smoke round emits `smokeLaid` and no `strike`"** (11 Oct: the renderer draws a blast for
    `strike`; `smokeLaid` is the event the unit ability already raises, `by` the caller).
  - *(6 Oct, #402: a smoke round is not cover. `coverLevelOf` reads tile cover and parapet only, so
    a band target standing in thin smoke still counts as in the open: attack-movers bound against
    it rather than close on it. Smoke works through sight instead: a line through
    `SMOKE_BLOCKS_AT` (320) of density is blocked (`losRay`), and below that each smoky tile only
    multiplies hit chance by `SMOKE_HIT_MULT` (0.55). A screened target is not selected, and an
    arrived attack-mover with no target then walks toward it if it is still identified.)*
  - *(14 Oct, #591.) **"a smoke-screen round releases no focus"**: the focus release runs in the
    command pre-pass for every order that names a unit (`sim.ts` ~L2174-2196), and a support round
    names none. And, as measured behaviour: a screen laid between a focused unit and its target drops
    the contact, so the unit walks to the last-seen tile for up to `FOCUS_LOST_TICKS` (100, 5 s), then
    the focus ends (T-D3).*
  - *(14 Oct, the garrison overhaul.) `raySmoke` takes both eye lifts on the branch. Pin, as measured,
    whether a screen blinds a garrison on the top floor of a 3-floor `apartment` (`floors` 3,
    `eyeLift` 2) looking at a ground target through it. Do not fit the screen to either answer.*
- [ ] **Step 2: Implement.** Extract the grid stamp from the `smoke` command branch (`sim.ts`
  ~L2444-2468 on `f4b3ea2b`) into a private method; the payload `'smoke'` in `stepStrikes` calls it, pushes `smokeLaid` (not `strike`) and skips
  damage. The ability branch stays `smokeCooldown` and `SMOKE_RANGE_SQ` gated; the extracted stamp
  is only the `SMOKE_RADIUS` disc write at `SMOKE_MAX`.
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

**Files:** `packages/sim/src/mission.ts` and its test, `packages/sim/src/index.ts`. **No `app`
file** (11 Oct: the plan named `main.ts` and `ui/production.ts`/`production.test.ts` for a rename;
`requestSweep`/`requestStrike` are called at `main.ts` ~L4068-4069 on `f4b3ea2b`, and the wrappers
below keep that call, and the app's `SupportKind = 'sweep' | 'strike'` (`ui/production.ts` ~L29 and
`ui/intel-moments.ts`), compiling unchanged).

**Interfaces:**

```ts
export type SupportKind = 'smoke_screen' | 'mortar_barrage' | 'drone_sweep' | 'air_strike';
export const FIRE_SUPPORT_KINDS: readonly SupportKind[];
/** One entry for all four. Same rules as today's two: not ended, affordable, and
 *  (for the three that fire) a living surface caller who owns the ROE bill. */
requestSupport(kind: SupportKind, x: Fx, y: Fx): boolean;
supportCost(kind: SupportKind): number;
// requestSweep / requestStrike stay as one-line wrappers until S-F removes the callers.
// sweepCost / strikeCost stay GETTERS (`get sweepCost()`, mission.ts ~L652): main.ts ~L3677,
// ui/production.ts ~L221 and IntelMoments read them as properties (14 Oct, F-R10).
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
    *(Pre-flight 2, 2026-10-11, #537: inverted. An arrived player attack-mover has `sweepOrder` 0 and
    is never swept. Pin **"a drone sweep moves no player unit"** (a plain arrived attack-mover and a
    halted unit, positions unchanged 10 s after the reveal), with its control **"an attack-mover
    ordered with `sweep: true` walks toward what the sweep reveals"**. Seen red: drop the
    `sweepOrder` check in `stepSweep` on a scratch copy. "A held unit" in the 6 Oct control reads "a
    halted unit": ruling (lead, 2026-10-11), no Hold command.)*
    *(14 Oct, #591, F-R6: true only of a unit **without a focus**. A sweep that re-identifies a
    focused unit's lost target resets `focusLost`, and `stepFocus` keeps the chase going. Name the
    pin **"a drone sweep moves no player unit without a focus"** and add **"a focused unit whose
    lost target a sweep re-identifies keeps its chase"** as a decision. Also pin **"calling support
    leaves every focus standing"**: `reveal` and `callStrike` name no unit.)*
- [ ] **Step 2: Implement.** `requestSupport`/`supportCost` are added; `requestSweep`,
  `requestStrike`, `sweepCost` and `strikeCost` stay as wrappers over them. The app is not edited:
  its `SupportKind` (`ui/production.ts`, `'sweep' | 'strike'`) is a different type from the sim's,
  and its literals run through `main.ts`, `input/{intents,pointer,keymap,cursor}.ts`,
  `ui/{order-sight,symbol}.ts` and the telemetry `orderVerb` enum, which S-F renames together with
  the menu. The dock keeps two buttons until then. `typecheck` must pass at this commit with `app`
  untouched (that is the check that the wrappers are enough).
- [ ] **Step 3: Measure.** Economy pins unmoved (no fixture calls support). `pnpm validate:ui` clean
  (no new strings yet). `pnpm typecheck` green with `app` and `net` untouched by this task.
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
  - *(14 Oct: on `f4b3ea2b` the harness runs **36 winning plans** (#539/#542, gate-open and bought
    probes included) and **25 controls** (`passiveAcrossSeeds`: Beit Sahwan I and III joined with
    #540 and expect `withdrawn`), each on 30 seeds; recount on the branch base and name which runs
    each gate counts. The garrison overhaul re-scripts five plans (UZ I, III, IV; WH IV; DA II), so
    read every numerator after it (F-R13). What "passive out-earned the winner" compares, end totals
    or totals at the earlier end tick, is F-Q12; build the gate to the ruling.)*
- [ ] **Step 2: One plan spends.** Pick the mission Task 2's arrival-time column says reaches 150
  earliest without `intel_start` (R: a clearance). Add one `requestSupport('mortar_barrage', …)` or
  `'drone_sweep'` call to its plan where the briefing promises one. The plan must still win. Its line
  may move (duration, ROE); `LADDER_CREDITS` moves only if its grade or credits move. If it does, the
  re-pin is part of this plan's ladder re-pin and named in its comment.
  *(6 Oct: no mission's text names a sweep or a strike, at `b44df7aa` or at `067fab9a` (census of
  every string in `data/missions/*.json`), so "where the briefing promises one" has no answer in
  the data: place the call by the plan's own geometry and say why in a comment. A drone sweep here
  also sets the plan's idle attack-movers walking toward what it reveals (#402), which can move
  more of the line than duration and ROE.)*
  *(Pre-flight 2, 2026-10-11: since #537 a sweep moves no plan unit, so it moves only what it
  reveals to the plan's fire. The spending plan must still win on 30/30 seeds.)* *(14 Oct: and
  clear its mission's `time limit` headroom on every seed (`limitHeadroom`, the larger of 120 s and
  1.2× the slowest win). A sweep can still move a plan unit that holds a focus (F-R6); no shipped plan
  issues `attack` today, so say so in the comment if that changes. `LADDER_CREDITS` is main's
  current pin, read on the base.)*
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
  whether it is still true. *(14 Oct: missions also carry `debrief` text now; walk every string, not
  only briefings and objectives. On `f4b3ea2b` the only player-facing hits are Wadi Halam III's
  "Intel puts the local commander…" and Qarn Hadid I's debrief "the map was the intelligence": both
  narrative, both still true.)* *(6 Oct: that grep hits 22 files on `b44df7aa`, almost all on the
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
  is the one that becomes false. *14 Oct: so does GDD L70, "generated by drones, scout teams,
  informants, and SIGINT structures. Spends on airstrikes, satellite sweeps, precision strikes, and
  revealing subterranean networks".*) `docs/campaign/README.md`: the same, in the contract the design
  agents write against; its "drones and stationary markers earn it" paragraph also says "Only 6 of
  14 shipped missions declare any economy", which is stale too (18 of 27 declare `resources` at
  `b44df7aa`).
- [ ] **Step 4: The ledger.** `docs/HANDOVER.md` §1, §3 (the dropped `intel_rate_per_min`, D1–D7), §4.

---

## Re-pins (F5)

| pin | expected | the reason, for the commit |
|---|---|---|
| sim pins, flat, relief and orders (`determinism.test.ts` ~L488, ~L857, ~L977 on `f4b3ea2b`) | **unmoved** (R): main's current pins, read on the branch base after the garrison overhaul re-pins them. A move is a defect | — |
| `ECONOMY_PIN` | **born** in Task 1, **re-pinned once** in Task 3 | intel accrues by first identification and objective completion, not per minute (G3 Q1) |
| `ECONOMY_PIN_RELIEF` | **born** in Task 5 | a new guard for the rise term; not a re-pin |
| `pnpm balance` | byte-identical (R) | — |
| `pnpm playtest` | every existing line byte-identical (R), except the one plan Task 9 makes spend | new printed intel lines and two new gates |
| `LADDER_CREDITS` (`playtest.ts` ~L3431 on `f4b3ea2b`) | unchanged (R) at main's current pin, whatever the garrison overhaul leaves it at; re-pinned in Task 9 only if the spending plan's credits move, with the term named, and `CAMPAIGN_CREDITS` (`packages/app/src/ui/stores-model.ts` L63) with it, which `tools/src/campaign_credits.test.ts` holds equal | the spending plan's term, per mission |
| `ROSTER_MAX`, `GATES` (`playtest.ts` ~L3566, ~L3121) | unchanged (R) at main's current pins | — |
| versus | **no pin exists**: `two-client.test.ts` and `pnpm net:engines` compare clients and engines with each other. Unaffected (no runtime in a room; versus drops `callStrike`) | — |

## Lane A needs (WP-S-F #184)

F1 lands sim and runtime only. The player cannot use the new menu until S-F builds it:
- **The four-item fire-support menu** in place of the dock's two buttons, prices from
  `supportCost`, armed and cancelled like today's (Escape disarms, #264). Chrome register (#454):
  tile and cost `--info`, armed `--live`, short of intel `--disabled-opacity` and not-allowed;
  display capitals on the tile. `theme.css` starts the support row at `data-support='sweep'`
  (`grid-column-start: 1`), so four tiles need that rule keyed to the first of them. The two new
  kinds need an order-row symbol (`ui/symbol.ts` `ORDER_IDS`, `ui/order-sight.ts` `SightOrderId`) and
  cursor names (`input/cursor.ts`), and the app's `'sweep' | 'strike'` literals renamed together
  (see Task 8). "Smoke screen" must read differently from the unit order "smoke" (`f`): name the
  call so the two never share a tile word. Where armed support aims: F-Q10.
- *(14 Oct: GH-113 landed for the two existing calls in #525 (`ui/intel-moments.ts`: READY, CALL,
  RESULT lines, four announcer ids, the strike footprint, the sweep's per-contact rings). S-F extends
  it to four kinds rather than building it. Two of its parts read the trickle: `IntelRate`'s strip
  `+N/min` and tile clock, and the telemetry field `intelRate`. F-Q11. Its strike RESULT keys on
  `strike` events, so a barrage's rounds need `profile` there too (F-Q8). `intel.note.*` strings name
  "Satellite sweep" and "Precision strike".)*
- **Charge timer and announcement** for each call (GH-113): "barrage inbound, 6 s". No fireworks.
  Register: a **`minor` alert, tone `info`**, naming the place (target tile, "in view" or a
  screen-compass bearing, `ui/alert-place.ts`); no alert ring above `minor`. The cue is silent
  (the dock and the announcer carry it); an announcer line is `voice/announce.ts` work (a new
  `AnnounceEventId`, he/ar lines, captions regardless, A5), or it ships "silent until recorded".
  Support calls take no unit voice ack (`voice/director.test.ts` pins that). A countdown reads
  `--info`, never `--on` (lime is for a live mission state).
- **The intel counter at a legible size** (GH-77), and the earn feed line from `intelEarned`
  events (F-Q7: `minor`, `info`, merged, with `at`). Feed and HUD only: **no world mark** for a
  paid rise (lead, "no status marks in the world").
- **Strings through `t()`** for every new label, and the pseudo capture pass to find the ones that
  slip (CLAUDE.md, i18n). Label tables use getters, never a module-load constant.
- **Telemetry:** `orderVerbOf` counts an accepted support call under its `call` name, and
  `tallyVerb` refuses a verb outside `data/schemas/telemetry_event.schema.json`'s `orderVerb` enum
  (`strike`, `sweep` today). A renamed or new kind needs the enum, `packages/data/src/telemetry.ts`
  and the Worker's `stats` rows extended in one change.
- **Presentation of the new rounds** (F-Q8): `strike` carries `profile`; `onStrike` keeps the air-strike
  look for profile 0 only; a smoke round draws as the existing smoke plume. A barrage's 1.5-tile
  scatter wants a ring on the armed cursor, and a Conduct bill from one reads "Strike on <place>"
  (`conduct.cause.strike`).
- **Chrome that F1 makes false** (found in the 6 Oct refresh and re-checked 11 Oct):
  `packages/app/src/i18n/en.json`'s `hud.card.cap.markTarget` ("earns intel while stationary"),
  `hud.hint.first.sniper` ("earns intel while it sits still"), and `dock.note.noIntel` ("watch
  longer") after Task 3; `dock.support.sweep.name` ("Satellite sweep"), `hud.strip.intel.tip` and
  `hud.hint.first.intel` (both name only "sweep and precision-strike") after Task 8's menu;
  `main.note.supportRefused` ("not enough intel") once a call can also be refused for want of a
  caller. They read wrong from the day F1 lands until S-F replaces them.
- **The tutorial's economy step** (execution plan dependency 5) against this earn rule. The
  shipped tutorial (`data/tutorial/beit_sahwan_0.json`) names no intel, sweep or strike.
