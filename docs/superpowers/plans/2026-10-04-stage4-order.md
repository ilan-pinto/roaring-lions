# Stage 4 order: Lane C, 2–27 November 2026

One page that orders every Stage 4 plan in Lane C, so that each re-pin has exactly one reason and
lands in its own commit. Stage 4 runs **Mon 2 Nov – Fri 27 Nov** (M2, "an economy with decisions in
it", 27 Nov). The **week of 23 Nov is the buffer** and is not free for new scope (execution plan,
"Buffers"). Since the 11 Oct pre-flight it shrinks to Thu 26 – Fri 27 Nov because the lead took the
recommended slots for targeted fire and vehicle spacing (ruled 11 Oct, below).

## Pre-flight 2 (2026-10-11), evening, against `main` `49715ff9`

Docs only; nothing re-measured. Every plan in this order carries its own "Pre-flight 2 (2026-10-11)"
block. Six PRs landed after the morning pre-flight (#513) and touch what these plans build on:

- **#537 (sim): halt holds, and a player's attack-move stops where it was sent.** The lead lifted the
  October sim freeze for these two fixes only. `Command`'s `attackMove` gained `sweep?: boolean`,
  stored per unit (`sweepOrder`) and per queued leg (`wpSweep`). `stepSweep` now walks on **only** an
  attack-mover whose order asked to sweep: mission waves and trigger `commit`s (`mission.ts`) and the
  balance backtest's commanders (`targets.ts`). Player orders (`input/intents.ts`) and the scripted
  playtest plans never set it. The halt branch now also clears `attackMove`, `sweepOrder` and
  `boardGoal`; `demolishOrder` and `chargeOrder` were measured not to restart a unit. **The
  "closing rule" every plan below cites no longer touches a player's unit.** What Hold position was
  for (6 Oct: "`halt` does not stop the closing rule") is now what `halt` and an arrived
  attack-move already do. Hold's sim command is retired (ruling 1 below).
- **#535 (app): N then click is a plain `move` ("L1 reopened", lead 11 Oct).** The "L1 is not open"
  bullet below is reversed. The N key, a Move chip in the order row and a `moveOnly` cursor are on
  `main`; X and V are still free.
- **#534 (render/app): `Renderer.unitAtScreen(px, py)`** picks the unit whose body is under the pixel.
  The left click uses it; the hover/right-click enemy lookup (`input/pointer.ts` `hostileUnder`) is
  still the old feet-nearest-ground rule. Targeted fire's right-click must name its target the new way.
- **#539 and #542 (tools): `pnpm playtest` holds every no-orders control, every winning plan and every
  unlock gate on 30 seeds** (424242, then 1..29). `run()` moved to `tools/src/backtest/playtest-run.ts`;
  new `passive-sweep.ts`, `plan-sweep.ts`, `player-picture.ts`. A full run is **~57 s locally** (8+8
  workers; ~85–110 s expected on CI's 4 vCPU, not measured there). `PT_PLAN_SWEEP=0` skips the plan
  sweep for an inner loop, but **a re-pin commit runs the full harness.** "Every plan still wins" now
  means 30/30 seeds, so a G-F change that costs one plan one seed is red.
- **#541 (app): a feed stall hint** after 60 s of no progress with a primary open; the interim for #540.
- **#540 (issue, `stage:4`): a mission time limit** (`time_limit_s`; a stalled mission ends as
  "withdrawn", a defeat). Lands Wed 4 Nov (ruling 4 below).

**The numbers to rebase on (replace the morning's).**
- **Three sim pins, not two:** flat `1202444260` (was 922714084), relief `3354895120` (was 3200430224),
  and a new third replay, "determinism of an order once it is done", `2737216487`
  (`determinism.test.ts` ~L438, ~L736, ~L845). A column-only re-pin (#291, Hold, targeted fire) moves
  **all three**, and its "remove the `hashArray` line" proof must bring back all three.
- **`LADDER_CREDITS` = `CAMPAIGN_CREDITS` = 5917** (#529, GH-90/93: 5870 → 5850; #537: 5850 → 5947;
  #542: 5947 → 5917). **`ROSTER_MAX` = 30** (#537: 31 → 32; #542: 32 → 30). `GATES` unchanged
  (12/30/44 stars, open after missions 5/13/19).
- `playtest.ts` line refs: `LADDER_CREDITS` ~L3096, `ROSTER_MAX` ~L3228, `GATES` ~L2820,
  `CONDUCT_GATES` ~L2887; `unitInfo` and `PT_SEED` are in `playtest-run.ts` (~L285, ~L228).
  `main.ts`'s `unitInfo` is at ~L2382.
- **"`packages/sim` stays closed until 2 Nov"** is now false twice (#431, #537). Every Lane C plan
  rebases onto #537's `applyCommands`, `startRout` and `stepSweep`.

**Corrections to this page:** the L1 bullet (reversed), the calendar (Hold's row retired, #540 on
Wed 4 Nov), "What must happen first" items 2 and 3 (pins; Hold), the re-pin list (three sim pins;
Hold retired; #540), Lane A's Hold and targeted-fire rows. Each is marked "Pre-flight 2" where it
stands, and the four decisions are ruled (below).

### Rulings (lead, 2026-10-11), on the four Pre-flight 2 decisions

Each took the recommendation. The options as they were put are in PR #544's first commit (`fb25a54f`).

1. **Ruling (lead, 2026-10-11): Hold's sim command is retired.** No `hold` command, no `holdPos`, no
   sim re-pin, no H/X key swap; H stays `halt`. The only work left is app-side: H skips garrisoned
   units, so it never empties a building. `2026-10-06-hold-position.md` is reduced to that one Lane A
   task. Lane C loses its Wed 4 Nov Hold day; Lane A loses the key move, the button, the "on hold"
   words, the voice keys, the telemetry verb and the tutorial edits.
2. **Ruling (lead, 2026-10-11): F4's rally is a plain attack-move without `sweep`**, for the player's
   rally and for the enemy's bought units: they fight on the way, hold on arrival, and need no arrival
   hook. A trigger `commit` (which sweeps) still sends the enemy's on.
3. **Ruling (lead, 2026-10-11): targeted fire drops T-D8 and keeps T-D3** (a lost focus walks to its
   last-seen tile for up to 5 s, then ends).
4. **Ruling (lead, 2026-10-11): #540 lands right before F1, on Wed 4 Nov**, in the day Hold's sim half
   left. It moves no sim pin; "withdrawn" is a defeat reason, not a new `result` value; each mission's
   limit clears its slowest 30-seed win (Wadi Halam IV: 10.9 min against a 7-minute target, #542) and
   every control's deadline (4–5 min, #539). The stall hint (#541) stays as the warning before it.

**What the rulings do to the calendar.** #540 takes exactly the day Hold vacated, so **no Lane C date
moves**: sim fixes Mon 2 – Tue 3, #540 Wed 4, targeted fire Thu 5, F1 Fri 6 – Tue 10, F3 Wed 11 – Thu 12,
F2 Fri 13 – Tue 17, F4 Wed 18 – Mon 23, vehicle spacing Tue 24 – Wed 25, buffer Thu 26 – Fri 27 Nov.
The buffer is **not** restored to the whole week of 23 Nov: it shrank for targeted fire and vehicle
spacing (ruled this morning), not for Hold. What the rulings do free: one sim re-pin (Hold's), Hold's
Lane A work, and targeted fire's dependency on Hold (it is cut after #291 and #540 now). If the lead
wants buffer back, the one lever left is vehicle spacing, which is already the first item to slip to
Stage 5.

## Pre-flight, 11 Oct (against `main` `f2d5d9e8`)

Docs only; nothing re-measured. Every plan in this order now carries its own "Pre-flight, 11 Oct"
section with its corrections and its questions. This section covers what the order itself must know.

**The numbers to rebase on.**
- Sim pins **unchanged** since #402: flat `922714084`, relief `3200430224`.
- **`LADDER_CREDITS` and `CAMPAIGN_CREDITS` are 5870, not 5830.** #431 (7 Oct, razing a raze
  objective's own structures costs no Conduct) took them to 5868, #444 (8 Oct, buildings drawn to
  their footprints; Qarn Hadid III ROE 94 → 96) to 5870. `ROSTER_MAX` is still 31. Every plan's
  "5830" is corrected.
- **"`packages/sim` stays closed until 2 Nov" was not literal.** #431 edited
  `packages/sim/src/mission.ts` (`MissionRuntime.start()` builds `razeExempt`, `stepRoe` skips it).
  It is hash-neutral (no golden replay builds a `MissionRuntime`), but F1, F3 and F4 all edit the same
  `start()`/`stepRoe` neighbourhood: rebase, do not copy line numbers.

**Two plans added (lead, 6 Oct, moved into Stage 4).**
- **Targeted fire, GH-420:** `2026-10-11-targeted-fire.md`. One hashed column (`focusTarget`), a
  column-only re-pin like Hold's; balance and playtest byte-identical (R).
- **Vehicle spacing, GH-421:** `2026-10-11-vehicle-spacing.md`. A behaviour re-pin: positions move,
  so balance and playtest are re-measured and `LADDER_CREDITS` may move, and the golden `vehicle`/
  `kitted` frames are expected to move (bless after merge, from CI).
- Hold position already had a plan (`2026-10-06-hold-position.md`), refreshed in this pass.

**Cross-plan conventions to fix before F1 starts** (each plan found the same seams):
1. **A new `MissionEvent` kind touches four places in `packages/app`**: `MISSION_EVENT_KINDS`
   (exported by `@lions/sim`, read by tests), `ui/cues.ts`'s exhaustive `MISSION_EVENT_SOUND` (a cue
   or a stated silence, #426), the `alerts.test.ts` `sample`, and an `Alert.kind` if it speaks in the
   feed. `typecheck` goes red otherwise. F1 adds `intelEarned`; F2 adds `zoneHolder` and `corridor`;
   F3 and F4 add none (F4 derives "production paused" in the app). **F1 lands the pattern; F2 copies
   it.** The 6 Oct allowance of "forced `packages/app` edits in a Lane C plan" grows from two files to
   four (F2's P2-9).
2. **Every economy feed line picks a #428 tier and tone and says where.** The plans' recommendations
   agree: income and intel are `minor` (good/info), losses and cuts `important`/`warn`, nothing in
   the economy is `major`, and no economy line takes the Space jump unless it is `important`.
3. **#454 colours:** credits `--commend`; this mission's logistics and intel `--info`; `--on` (lime)
   only for an armed button or a live speed state, never a countdown or a stamp.
4. **New player intents** need `data/schemas/telemetry_event.schema.json`'s `orderVerb` enum,
   `packages/data/src/telemetry.ts` and the Worker's `/stats` rows extended together (~~Hold's `hold`~~ retired by ruling (lead, 2026-10-11),
   targeted fire's `attack`, F1's support kinds, F4's `rally`).
5. **The memory gate** (`memory` CI job, #474) walks `qarn_hadid_3_clearance`,
   `umm_zeitoun_4_clearance` and `khan_rafid_3_clearance`. Only F2 touches one of them (UZ IV, no
   GLB added); F4's queued items must stay listed in `runtime.production` so `warmUnitMesh` decodes
   them in time (#479). No plan is expected to move a budget; each PR's `memory` job is the check.
6. **The dock and the chip are shared furniture.** F3 (the `capped` tile state, the deny cue on a
   refused build, the "on loan" stamp) and F4 (a dock per camp, the rally arm) edit the same
   `requestBuild`/`buildBlockedReason`/`ui/production.ts`/`ui/dock-model.ts`; F4 is cut after F3 and
   keeps F3's queue-time population reservation. F1 and F3 both extend `unitInfo` (`main.ts` ~L2332
   and `playtest.ts` ~L259); F1 Task 1 creates `economyHash`/`ECONOMY_PIN*`, F3 re-pins on top.

**What must happen first on Mon 2 Nov** (before the first Lane C branch is cut):
1. `main` green, including the `memory` job and `audio:mix` in `gates`; no open PR touching
   `packages/sim`, `packages/sim/src/mission.ts` included.
2. Re-read the pins on `main` and write them into the sim-fixes branch's first commit message.
   **Pre-flight 2 (2026-10-11):** they are now three sim pins, flat 1202444260 / relief 3354895120 /
   orders 2737216487, `LADDER_CREDITS` 5917 and `ROSTER_MAX` 30 (were 922714084 / 3200430224, 5870, 31). If any differs, find the commit
   that moved it before cutting.
3. The lead's answers to "For the lead (11 Oct)" items 1–3 below are on #183. Items 1 and 2 decide
   the calendar; item 3 decides Hold's Lane A half, which trails Hold from Thu 5 Nov. *(Ruling (lead,
   2026-10-11): Hold's sim half is retired; its Lane A half is one app task, and item 3's tutorial
   rewrite is not needed: H stays `halt`, and the beats already work.)*
4. The four October G-NUM halts (F1 Task 2, F2 Task 2, F3 Task 7 Step 1, F4 Task 1) are posted on
   #183, read on the new maps under halt to fire.

### For the lead (11 Oct)
1. **Where targeted fire lands.** **RULED 11 Oct (lead): as recommended.** **Recommended:** Thu 5 Nov, right after Hold. It is a column-only
   re-pin and a day's work, its UI shares the key change and the order row with Hold's, and it shifts
   every G-F plan by one working day (calendar below).
2. **Where vehicle spacing lands.** **RULED 11 Oct (lead): as recommended**, slipping to Stage 5 if the
   economy runs over. **Recommended:** Tue 24 – Wed 25 Nov, after F4, in the buffer
   week, so the economy lands on its planned days and spacing is the item that slips to Stage 5 if F2
   or F4 overruns. The alternative (Fri 6 – Mon 9 Nov, before F1) measures every G-F re-proof on the
   final movement model but consumes the buffer.
3. **The tutorial says "press H" and awaits a `halt`** (ruled 11 Oct: the tutorial accepts either
   `hold` or `halt`) (`data/tutorial/beit_sahwan_0.json`, beats 3,
   6 and 9). When Hold takes H, those beats should teach Hold (stand still and fire), which is what
   they mean. **Recommended:** Hold's Task 3 rewrites them and moves the await to the `hold` intent in
   the same PR; targeted fire's Task 4 then edits beat 6 once more. No beat may name a key that does
   something else.
- **Also ruled 11 Oct (lead):** fire support resolves a click on a building wall to that building (F1
  F-Q10); a unit on Hold given targeted fire stays on Hold, fires only on a target already in range,
  and otherwise refuses with "On hold — target out of range" (targeted fire T-D8, reversing the
  recommendation).
- ~~**L1 is not open.** The lead ruled "no move-only order" in the early-October polish calls, alongside
  moving #420 and #421 into Stage 4. Disengaging stays via Hold, `halt` and orders; no V key.~~
  **Pre-flight 2 (2026-10-11): reversed.** The lead reopened L1 on 11 Oct and #535 shipped it: N, then
  a click, issues the sim's plain `move` (a Move chip in the order row, `moveOnly` cursor). V and X are
  still free.

## Changed since 4 Oct

Refreshed 6 Oct against `main` `b44df7aa`. Each plan below carries its own "Changed since 4 Oct"
section; this one covers the schedule.

**What landed:**
- **#402, halt and kneel to fire (6 Oct), a sim change outside this order.**
  - It moved both sim pins: flat 2109596329 → **922714084**, relief 1425295494 → **3200430224**.
    #291 therefore re-pins from those values.
  - It moved `LADDER_CREDITS` 5844 → **5830** (with `CAMPAIGN_CREDITS`) and `ROSTER_MAX` 33 → **31**.
  - It added `mobility.halts_to_fire` to the schema, with an explicit override on `manpad_team`:
    the unit #247 is about.
  - Its kneel is **0.2 s, final**: the lead chose it on 6 Oct after 0.3 s failed the smoke gate.
    It adds no further re-pin.
  - The lead approved it as a one-off. `packages/sim` stays closed until 2 Nov.
- **GH-382 (5 Oct) re-grounded every mission II and later, and Tel Marum I.** It moved
  `LADDER_CREDITS` seven times, from 5736 to 5844, before #402. **#330 moved nothing**: it landed
  as `packages/app/src/campaign-pay.ts`.
- **Every October G-NUM probe now runs on new maps under halt to fire.** The four plans quote G3
  numbers (M at `751b6742`) that predate both changes.

**New interactions:**
- Every plan's G-F rule now meets kneeling infantry and the closing rule: an arrived attack-mover
  walks toward an identified enemy it cannot reach, and the player's right-click is always an
  attack-move. Each plan's own section names the cases:
  - F1: high ground held 10 s;
  - F2: a zone holder walking off its zone, and patrols that halt on contact;
  - F3: `halts_to_fire` follows the type fielded;
  - F4: a rally `move` holds fire on the way.
- **#247 and #402 edit the same file,** `data/units/enemy/manpad_team.json`.
  `tools/src/halt_to_fire_roster.test.ts` pins manpad's `halts_to_fire: true` and says the
  derivation "calls it wheeled". #247's `wheeled: false` makes the override redundant and that
  comment false, though the test stays green.

### For the lead
1. **An offer, not an assumption: an earlier landing.** #402 was a lead-approved one-off sim
   change. The rest of `packages/sim` stays closed until Stage 4 opens on 2 Nov, so the calendar
   below is unchanged: #291 and #279 stay on 2–3 Nov. If the lead wants either in October instead,
   the sim-fix plan is ready. Tasks 1–3 are hash-neutral and Task 4 is its only re-pin.
   **Ruled 6 Oct:** #291 and #279 stay on 2–3 Nov.
2. **#247 and the manpad override.** #402's spec §7.3 leaves manpad's wheeled quirk to the lead.
   When #247 lands `wheeled: false`, should it also drop the now-redundant `halts_to_fire: true`
   override (and re-word the roster test), or keep it?
   **Ruled 6 Oct:** #247 drops the redundant override and re-words the test.
3. **The shared root of four plan questions** (F1 item 5, F2 item 11, F4 items 19 and 20): the
   player has no order that keeps a unit in place against the closing rule.
   **Ruled 6 Oct (lead): add a "Hold position" order.**
   - The player issues it with hotkey H or a HUD button.
   - Units stay put and kneel, fire at anything in range, and never advance, chase or close.
   - It is a sim command with a new flag, landing in Stage 4.
   - The rally point and the enemy's bought units issue Hold on arrival, and F2's held zones are
     kept by Hold.

   Plan: `2026-10-06-hold-position.md`, scheduled Wed 4 Nov below. *(Ruling (lead, 2026-10-11):
   after #537 the sim command is retired; H stays `halt` and skips garrisoned units. F4's rally and
   the enemy's bought units use a no-sweep attack-move; F2's zones are kept by stopping where sent.)*

**Rules that make the order matter:**
- Lane C is one lane: one plan in flight in `packages/sim` at a time, landed through a PR with `gates`
  and `determinism` green before the next branch is cut from `main`.
- Each pin moves at most once per plan, in its own commit, with the reason in the message: the two
  sim pins (`determinism.test.ts`, flat and relief; `922714084` and `3200430224` since #402), the
  economy pins F1 creates (`ECONOMY_PIN`, `ECONOMY_PIN_RELIEF`), and `LADDER_CREDITS` (5830 on 6 Oct; **5870** since #431 and #444),
  `ROSTER_MAX` (31) and `GATES` in `playtest.ts`. `ROSTER_MAX` was not named on 4 Oct. It is a pin
  in the same idiom: #402 moved it 33 → 31, and F3's L-1 is the G-F change most likely to move it.
- The agreed order (lead, 30 Sep, #183): **#291 → the G-F plans → (Stage 5) FW Task 2 → E6 →
  officers.** #330 goes between #291 and F1, as the G3 sheet requires ("first or last in the Stage 4
  order, never folded into a G-F plan").
- Hold position (lead, 6 Oct) goes between #291 and F1, on the day #330 freed. F2 and F4 consume
  it, and F1's high-ground test uses it. *(Ruling (lead, 2026-10-11): retired from Lane C; #540 takes
  the day. No G-F plan consumes a Hold command.)*

## The calendar

| dates | plan | what lands | pins it moves |
|---|---|---|---|
| **before 2 Nov** (October, no sim code) | the four G-NUM halts: F1 Task 2, F2 Task 2, F3 L-1 (Task 7 Step 1's request), F4 Task 1 | read-only probes on scratch copies, posted on #183 for the lead | none |
| **Mon 2 – Tue 3 Nov** | Stage 4 sim fixes (`2026-09-29-stage4-sim-fixes.md`, #296) | Task 1 (Tel Marum I shepherd), Tasks 2–3 (#279 sim half), **Task 4 (#291)** | **sim pins, once** (#291's three hashed columns) |
| Tue 3 Nov | FW Task 1 (#280, `2026-09-29-field-works.md`), and #247 (`manpad_team` wheeled) | garrison suppression cover (opt-in field); the `mobility.wheeled: false` data line in `data/units/enemy/manpad_team.json` (the issue names `data/units/manpad_team.json`) and its pin test, beside `tools/src/boulders.test.ts`'s `rocket_battery` pin. The same file has carried #402's `halts_to_fire: true` override since 6 Oct (For the lead, item 2) | none expected for the sim pins (no golden unit is a manpad), but **measure, do not assume**: `wheeled` also sets the move domain and `manpad_team` is fielded in 8 missions on maps with `b` tiles, so `playtest`, `balance` and `LADDER_CREDITS` can move (11 Oct pre-flight). #247 moves pathing: if it moves the sim pins it is a **separate** re-pin with its own commit, after #291's, never folded in |
| ~~Wed 4 Nov~~ **retired** | ~~**Hold position**~~ (`2026-10-06-hold-position.md`). **Ruling (lead, 2026-10-11): Hold's sim command is retired**; the plan is one Lane A task (Lane A table) | ~~the `hold` command and its `holdPos` column~~ | **none** |
| **Wed 4 Nov** (ruling (lead, 2026-10-11)) | **#540, the mission time limit** (no plan yet; the issue is the scope) | `time_limit_s` in `mission.schema.json`, `checkEnd` ends a stalled mission as a "withdrawn" defeat, the debrief line, a `validate:data` rule, a measured per-mission value | **no sim pin** (R: no golden replay builds a `MissionRuntime`); `playtest` gains lines, and every plan must still win on 30/30 seeds inside its limit; `LADDER_CREDITS` only if an outcome moves (it must not) |
| ~~Wed 4 Nov~~ **landed in October** | #330 (a fresh campaign pays again) | moved out of Lane C by the lead on 5 Oct: it edits `packages/app` and the harness, never `packages/sim` or `credits.ts` (`2026-10-04-credits-reachability.md`); shipped as `packages/app/src/campaign-pay.ts` | **none**: #330 moved no pin. `LADDER_CREDITS` read 5736 when it landed and is **5830** on 6 Oct, moved by GH-382 and #402 (**5870** on 11 Oct, moved by #431 and #444). The harness's two-campaign walk is relative to it |
| **Thu 5 Nov** (ruled 11 Oct) | **Targeted fire** (`2026-10-11-targeted-fire.md`, GH-420) | the `attack` command and its `focusTarget` column (Task 1), then the behaviour (Task 2, hash-neutral) | **sim pins, once** (one hashed per-unit column), after Hold's *(Pre-flight 2: after #291's and #247's; Hold re-pins nothing now)* |
| **Fri 6 – Tue 10 Nov** (was Thu 5 – Mon 9) | **F1** fire support and intel by doing (`2026-10-04-gf1-fire-support-intel.md`) | the economy pins born; the trickle deleted; high ground; barrage and smoke screen; the four-item menu; the intel gates | economy pins born, then **re-pinned once**; `LADDER_CREDITS` (5870; **5917**, Pre-flight 2) only if Task 9's spending plan moves |
| **Wed 11 – Thu 12 Nov** (was Tue 10 – Wed 11) | **F3** population cap and "on loan" (`2026-10-04-gf3-population-cap-on-loan.md`) | the cap (off in the campaign); the loan predicate; the "on loan" mark (on the in-mission unit card and selection chip since the 6 Oct ruling, not the deploy screen); L-1 if confirmed | economy pins once; roster lines and possibly `LADDER_CREDITS` through L-1 |
| **Fri 13 – Tue 17 Nov** (was Thu 12 – Mon 16) | **F2** held-ground income and corridors (`2026-10-04-gf2-held-ground-income.md`) | the integer purse; zones; corridors; four missions authored (BS II left D7, ruled 6 Oct); holders kept by Hold (*ruling 2026-10-11: by stopping where sent; no Hold command*); banking gates | economy pins once; the four D7 missions' playtest lines; `LADDER_CREDITS` only through a moved grade |
| **Wed 18 – Mon 23 Nov** (was Tue 17 – Fri 20) | **F4** production at the camp (`2026-10-04-gf4-camp-production.md`) | serial lines; the contested pause; rally points that ~~issue Hold on arrival~~ send a no-sweep attack-move (ruling (lead, 2026-10-11)); the enemy's spender; plan re-proofs | economy pins once; the three (five since #542) building plans' lines; `LADDER_CREDITS` only through a moved grade |
| **Tue 24 – Wed 25 Nov** (ruled 11 Oct) | **Vehicle spacing** (`2026-10-11-vehicle-spacing.md`, GH-421) | `mobility.radius_tiles` on every ground vehicle (Task 1, hash-neutral); `stepSeparation` (Task 2) | **sim pins, once** (behaviour: vehicles no longer overlap); balance and playtest **re-measured**; `LADDER_CREDITS` only if it moves; golden `vehicle`/`kitted` expected to move (bless after merge). Slips to Stage 5 first if F2/F4 overrun |
| **Thu 26 – Fri 27 Nov** | **buffer** (was the whole week of 23 Nov) | overflow from F2/F4 only; WP-S-F's last landings and their bless; R2 at M2 on Fri 27 Nov | — |

**Why F3 sits before F2 and F4.** It is the smallest, it moves no campaign outcome unless L-1 does,
and F4's queue reservation is written against it. **Why F2 sits before F4.** F4's enemy spender reads
side 1's purse, and F2 is what fills it from held ground; the G3 sheet also asks that the two land
together, so they are adjacent and F4 is the plan the buffer protects. **Why targeted fire sits
right after Hold (11 Oct).** Both are column-only re-pins in the same command loop (H-D2's release
list gains `attack`), and their Lane A halves share the order row, the H/X keys and the tutorial
beats. *(Ruling (lead, 2026-10-11): Hold's sim half is retired; targeted fire now follows #540 and is the
first column re-pin after #291's. Its slot did not move.)* **Why vehicle spacing sits after F4 (11 Oct, recommended).** It is the one behaviour re-pin
outside the G-F plans, and M2's exit does not need it; placed last, it is what slips if the economy
overruns.

## Lane A beside it (WP-S-F #184)

S-F trails Lane C by one landing and never edits `packages/sim`:

| after | S-F lands |
|---|---|
| Hold position (from Thu 5 Nov; needs nothing from Lane C, may land earlier) | **Ruling (lead, 2026-10-11):** ~~Hold on H, `halt` moved to X, the HUD button, the "holding" mark~~. Only: H (and the Halt button) skips garrisoned units, so it never empties a building (`2026-10-06-hold-position.md`, reduced to that one task) |
| Targeted fire (from Fri 6 Nov) | right-click on an identified enemy issues `attack`, the enemy named by `Renderer.unitAtScreen` (#534), and with Move armed (N, #535) the click stays a plain `move` (Pre-flight 2, 2026-10-11); the `attack-*` cursor name returns; `hud.fire.clickTargets`; "Ordered: …" on the unit card; `attack` in the telemetry `orderVerb` enum; tutorial beat 6 (`2026-10-11-targeted-fire.md`, Tasks 3–4) |
| F1 (from Wed 11 Nov) | the four-item fire-support menu, charge timer and announcement (GH-113), the intel counter (GH-77) and the earn feed line, at `minor`/`info` with a place (#428); the countdown in `--info`, never `--on`; armed support through `pointerPoint` (F-Q10 ruled yes, 11 Oct); the telemetry enum and `onStrike` profile mapping; the four stale chrome strings F1's pre-flight lists |
| F3 (from Fri 13 Nov) | used/cap (hidden in the campaign) in `--info`; the dock's `capped` tile state and the deny cue on every refused build (F3 Q8); "on loan" on the unit card and selection chip **after its mock is approved** (F3 Q5), and on the deploy screen's "from brigade" card if the lead rules F3 Q4 yes |
| F2 (from Wed 18 Nov) | zone holders on the minimap through #461's four states (`incomeZonesFor`, F2 P2-1, mock first); the strip's `+N/min` fed from `incomePerMin`; corridor alerts at the tiers P2-4 lists; the supply-line overlay **after its mock is approved** (P2-3); a first-use `income` hint in place of a tutorial step (P2-6) |
| F4 (from Tue 24 Nov) | the dock per camp, "contested: production paused" (`important`/`warn`, app-derived, F4 Q5), the rally order and its marker **after its mock is approved** (F4 Q4: reuse the move order's route line); the tutorial's economy beats only if the lead rules F4 Q7 yes |

One visual bless per landing, one in flight at a time, from CI numbers.

## The re-pin order, as a list

0. (Landed 6 Oct, before Stage 4.) #402: both sim pins, `LADDER_CREDITS`/`CAMPAIGN_CREDITS` and
   `ROSTER_MAX`. Everything below rebases onto it.
1. #291: sim pins.
2. (#247, only if it moves them: sim pins again, its own reason.)
2a. ~~Hold position (Wed 4 Nov): sim pins, for its one hashed column.~~ **Ruling (lead, 2026-10-11):
    retired; no re-pin.**
2a'. **#540, the mission time limit (Wed 4 Nov; ruling (lead, 2026-10-11)):** no sim pin; playtest
    lines added, none moved.
2b. Targeted fire (Thu 5 Nov, added 11 Oct): sim pins, for its one hashed column (`focusTarget`).
    Balance and playtest byte-identical (R).
    *(Pre-flight 2, 2026-10-11: from #537 on, "sim pins" means **three** (flat, relief, orders), and
    every column-only re-pin in this list moves all three in one commit.)*
3. ~~#330: `LADDER_CREDITS`.~~ Landed in October and moved no pin. From here on, each `LADDER_CREDITS`
   re-pin also moves `CAMPAIGN_CREDITS` (`packages/app/src/ui/stores-model.ts`), which
   `tools/src/campaign_credits.test.ts` holds equal to it. GH-382 and #402 did exactly that (both
   read 5830 on 6 Oct), and so did #431 and #444 (both read **5870** on 11 Oct).
4. F1: economy pins born, then re-pinned; ladder only via one spending plan.
5. F3: economy pins; roster and ladder via L-1.
6. F2: economy pins; playtest; ladder via grades.
7. F4: economy pins; playtest; ladder via grades.
7a. Vehicle spacing (Tue 24 Nov, added 11 Oct): sim pins, for behaviour; then balance, playtest and,
    only if they move, `LADDER_CREDITS`/`CAMPAIGN_CREDITS`, `ROSTER_MAX`, `GATES` and the economy
    pins, each in its own commit. It is not a G-F plan: the sim-pin rule below does not apply to it.
8. Stage 5: FW Task 2 (sim pins, every FW array at once), E6, officers.

No G-F plan is expected to move the sim pins (G3 sheet, "one correction": every G-F change lives in
`MissionRuntime`, which no golden replay constructs). A G-F commit that moves them is a defect to
find, not a re-pin to take.

## Exit (execution plan, Stage 4)

Sweep and strike affordable where they are designed to be (F1's `INTEL_WINNERS_ONE_SWEEP`), every
passive control still loses, every plan still wins (on all 30 seeds since #539/#542; Pre-flight 2,
2026-10-11), the §5.7 targets pass, and the ladder is
re-pinned with one reason per commit. Added 11 Oct: Hold, targeted fire (PA-08) and, unless it
slipped to Stage 5, vehicle spacing (PA-10) are on `main`. Added by Pre-flight 2 (2026-10-11): #540, the mission time limit, is
on `main`; "Hold" means H halts without emptying a building (ruling (lead, 2026-10-11)).
