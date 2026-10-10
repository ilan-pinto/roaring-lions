# Stage 4 order: Lane C, 2–27 November 2026

One page that orders every Stage 4 plan in Lane C, so that each re-pin has exactly one reason and
lands in its own commit. Stage 4 runs **Mon 2 Nov – Fri 27 Nov** (M2, "an economy with decisions in
it", 27 Nov). The **week of 23 Nov is the buffer** and is not free for new scope (execution plan,
"Buffers"). Since the 11 Oct pre-flight it shrinks to Thu 26 – Fri 27 Nov if the lead takes the
recommended slots for targeted fire and vehicle spacing (below).

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
   `packages/data/src/telemetry.ts` and the Worker's `/stats` rows extended together (Hold's `hold`,
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
2. Re-read the pins on `main` (sim 922714084 / 3200430224, `LADDER_CREDITS` 5870, `ROSTER_MAX` 31)
   and write them into the sim-fixes branch's first commit message. If any differs, find the commit
   that moved it before cutting.
3. The lead's answers to "For the lead (11 Oct)" items 1–4 below are on #183. Items 1 and 2 decide
   the calendar; items 3 and 4 decide Hold's Lane A half, which trails Hold from Thu 5 Nov.
4. The four October G-NUM halts (F1 Task 2, F2 Task 2, F3 Task 7 Step 1, F4 Task 1) are posted on
   #183, read on the new maps under halt to fire.

### For the lead (11 Oct)
1. **Where targeted fire lands.** **Recommended:** Thu 5 Nov, right after Hold. It is a column-only
   re-pin and a day's work, its UI shares the key change and the order row with Hold's, and it shifts
   every G-F plan by one working day (calendar below).
2. **Where vehicle spacing lands.** **Recommended:** Tue 24 – Wed 25 Nov, after F4, in the buffer
   week, so the economy lands on its planned days and spacing is the item that slips to Stage 5 if F2
   or F4 overruns. The alternative (Fri 6 – Mon 9 Nov, before F1) measures every G-F re-proof on the
   final movement model but consumes the buffer.
3. **The tutorial says "press H" and awaits a `halt`** (`data/tutorial/beit_sahwan_0.json`, beats 3,
   6 and 9). When Hold takes H, those beats should teach Hold (stand still and fire), which is what
   they mean. **Recommended:** Hold's Task 3 rewrites them and moves the await to the `hold` intent in
   the same PR; targeted fire's Task 4 then edits beat 6 once more. No beat may name a key that does
   something else.
4. **L1, move-only on V** (polish audit, "Lead decisions"), is the other half of PA-08 and is app-only
   (the sim's `move` exists). **Recommended:** rule it now so the polish lane ships it in October;
   with Hold on H and `halt` on X, V stays free.

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

   Plan: `2026-10-06-hold-position.md`, scheduled Wed 4 Nov below.

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
  it, and F1's high-ground test uses it.

## The calendar

| dates | plan | what lands | pins it moves |
|---|---|---|---|
| **before 2 Nov** (October, no sim code) | the four G-NUM halts: F1 Task 2, F2 Task 2, F3 L-1 (Task 7 Step 1's request), F4 Task 1 | read-only probes on scratch copies, posted on #183 for the lead | none |
| **Mon 2 – Tue 3 Nov** | Stage 4 sim fixes (`2026-09-29-stage4-sim-fixes.md`, #296) | Task 1 (Tel Marum I shepherd), Tasks 2–3 (#279 sim half), **Task 4 (#291)** | **sim pins, once** (#291's three hashed columns) |
| Tue 3 Nov | FW Task 1 (#280, `2026-09-29-field-works.md`), and #247 (`manpad_team` wheeled) | garrison suppression cover (opt-in field); the `mobility.wheeled: false` data line in `data/units/enemy/manpad_team.json` (the issue names `data/units/manpad_team.json`) and its pin test, beside `tools/src/boulders.test.ts`'s `rocket_battery` pin. The same file has carried #402's `halts_to_fire: true` override since 6 Oct (For the lead, item 2) | none expected for the sim pins (no golden unit is a manpad), but **measure, do not assume**: `wheeled` also sets the move domain and `manpad_team` is fielded in 8 missions on maps with `b` tiles, so `playtest`, `balance` and `LADDER_CREDITS` can move (11 Oct pre-flight). #247 moves pathing: if it moves the sim pins it is a **separate** re-pin with its own commit, after #291's, never folded in |
| **Wed 4 Nov** | **Hold position** (`2026-10-06-hold-position.md`, lead ruling 6 Oct) | the `hold` command and its `holdPos` column; nothing reads it yet but the closing rule's skip | **sim pins, once** (one hashed per-unit column), after #291's (and #247's, if any) |
| ~~Wed 4 Nov~~ **landed in October** | #330 (a fresh campaign pays again) | moved out of Lane C by the lead on 5 Oct: it edits `packages/app` and the harness, never `packages/sim` or `credits.ts` (`2026-10-04-credits-reachability.md`); shipped as `packages/app/src/campaign-pay.ts` | **none**: #330 moved no pin. `LADDER_CREDITS` read 5736 when it landed and is **5830** on 6 Oct, moved by GH-382 and #402 (**5870** on 11 Oct, moved by #431 and #444). The harness's two-campaign walk is relative to it |
| **Thu 5 Nov** (added 11 Oct; For the lead (11 Oct), item 1) | **Targeted fire** (`2026-10-11-targeted-fire.md`, GH-420) | the `attack` command and its `focusTarget` column (Task 1), then the behaviour (Task 2, hash-neutral) | **sim pins, once** (one hashed per-unit column), after Hold's |
| **Fri 6 – Tue 10 Nov** (was Thu 5 – Mon 9) | **F1** fire support and intel by doing (`2026-10-04-gf1-fire-support-intel.md`) | the economy pins born; the trickle deleted; high ground; barrage and smoke screen; the four-item menu; the intel gates | economy pins born, then **re-pinned once**; `LADDER_CREDITS` (5870) only if Task 9's spending plan moves |
| **Wed 11 – Thu 12 Nov** (was Tue 10 – Wed 11) | **F3** population cap and "on loan" (`2026-10-04-gf3-population-cap-on-loan.md`) | the cap (off in the campaign); the loan predicate; the "on loan" mark (on the in-mission unit card and selection chip since the 6 Oct ruling, not the deploy screen); L-1 if confirmed | economy pins once; roster lines and possibly `LADDER_CREDITS` through L-1 |
| **Fri 13 – Tue 17 Nov** (was Thu 12 – Mon 16) | **F2** held-ground income and corridors (`2026-10-04-gf2-held-ground-income.md`) | the integer purse; zones; corridors; four missions authored (BS II left D7, ruled 6 Oct); holders kept by Hold; banking gates | economy pins once; the four D7 missions' playtest lines; `LADDER_CREDITS` only through a moved grade |
| **Wed 18 – Mon 23 Nov** (was Tue 17 – Fri 20) | **F4** production at the camp (`2026-10-04-gf4-camp-production.md`) | serial lines; the contested pause; rally points that issue Hold on arrival; the enemy's spender; plan re-proofs | economy pins once; the three building plans' lines; `LADDER_CREDITS` only through a moved grade |
| **Tue 24 – Wed 25 Nov** (added 11 Oct; For the lead (11 Oct), item 2) | **Vehicle spacing** (`2026-10-11-vehicle-spacing.md`, GH-421) | `mobility.radius_tiles` on every ground vehicle (Task 1, hash-neutral); `stepSeparation` (Task 2) | **sim pins, once** (behaviour: vehicles no longer overlap); balance and playtest **re-measured**; `LADDER_CREDITS` only if it moves; golden `vehicle`/`kitted` expected to move (bless after merge). Slips to Stage 5 first if F2/F4 overrun |
| **Thu 26 – Fri 27 Nov** | **buffer** (was the whole week of 23 Nov) | overflow from F2/F4 only; WP-S-F's last landings and their bless; R2 at M2 on Fri 27 Nov | — |

**Why F3 sits before F2 and F4.** It is the smallest, it moves no campaign outcome unless L-1 does,
and F4's queue reservation is written against it. **Why F2 sits before F4.** F4's enemy spender reads
side 1's purse, and F2 is what fills it from held ground; the G3 sheet also asks that the two land
together, so they are adjacent and F4 is the plan the buffer protects. **Why targeted fire sits
right after Hold (11 Oct).** Both are column-only re-pins in the same command loop (H-D2's release
list gains `attack`), and their Lane A halves share the order row, the H/X keys and the tutorial
beats. **Why vehicle spacing sits after F4 (11 Oct, recommended).** It is the one behaviour re-pin
outside the G-F plans, and M2's exit does not need it; placed last, it is what slips if the economy
overruns.

## Lane A beside it (WP-S-F #184)

S-F trails Lane C by one landing and never edits `packages/sim`:

| after | S-F lands |
|---|---|
| Hold position (from Thu 5 Nov) | Hold on H, `halt` moved to X (ruled 6 Oct; the keymap and settings-rebind tests re-pin), the HUD button, the "holding" mark on the unit card and selection chip (`2026-10-06-hold-position.md`, Task 3) |
| Targeted fire (from Fri 6 Nov) | right-click on an identified enemy issues `attack`; the `attack-*` cursor name returns; `hud.fire.clickTargets`; "Ordered: …" on the unit card; `attack` in the telemetry `orderVerb` enum; tutorial beat 6 (`2026-10-11-targeted-fire.md`, Tasks 3–4) |
| F1 (from Wed 11 Nov) | the four-item fire-support menu, charge timer and announcement (GH-113), the intel counter (GH-77) and the earn feed line, at `minor`/`info` with a place (#428); the countdown in `--info`, never `--on`; armed support through `pointerPoint` if the lead rules F-Q10 yes; the telemetry enum and `onStrike` profile mapping; the four stale chrome strings F1's pre-flight lists |
| F3 (from Fri 13 Nov) | used/cap (hidden in the campaign) in `--info`; the dock's `capped` tile state and the deny cue on every refused build (F3 Q8); "on loan" on the unit card and selection chip **after its mock is approved** (F3 Q5), and on the deploy screen's "from brigade" card if the lead rules F3 Q4 yes |
| F2 (from Wed 18 Nov) | zone holders on the minimap through #461's four states (`incomeZonesFor`, F2 P2-1, mock first); the strip's `+N/min` fed from `incomePerMin`; corridor alerts at the tiers P2-4 lists; the supply-line overlay **after its mock is approved** (P2-3); a first-use `income` hint in place of a tutorial step (P2-6) |
| F4 (from Tue 24 Nov) | the dock per camp, "contested: production paused" (`important`/`warn`, app-derived, F4 Q5), the rally order and its marker **after its mock is approved** (F4 Q4: reuse the move order's route line); the tutorial's economy beats only if the lead rules F4 Q7 yes |

One visual bless per landing, one in flight at a time, from CI numbers.

## The re-pin order, as a list

0. (Landed 6 Oct, before Stage 4.) #402: both sim pins, `LADDER_CREDITS`/`CAMPAIGN_CREDITS` and
   `ROSTER_MAX`. Everything below rebases onto it.
1. #291: sim pins.
2. (#247, only if it moves them: sim pins again, its own reason.)
2a. Hold position (Wed 4 Nov): sim pins, for its one hashed column. It is not a G-F plan, so the
    rule below does not apply to it.
2b. Targeted fire (Thu 5 Nov, added 11 Oct): sim pins, for its one hashed column (`focusTarget`).
    Balance and playtest byte-identical (R).
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
passive control still loses, every plan still wins, the §5.7 targets pass, and the ladder is
re-pinned with one reason per commit. Added 11 Oct: Hold, targeted fire (PA-08) and, unless it
slipped to Stage 5, vehicle spacing (PA-10) are on `main`.
