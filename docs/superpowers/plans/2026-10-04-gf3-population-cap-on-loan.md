# WP-G-F plan F3: the population cap, and units "on loan" (GH-183, G3 Q4 and Q5). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Changed since 4 Oct (refreshed 14 Oct)

A quick staleness pass, read and grepped against `main` `f4b3ea2b` (14 Oct) and the garrison
overhaul's branch (`origin/feat/garrison-overhaul` at `fb3174c8`). Docs only; nothing run. It governs
where it disagrees with the older dated sections below. F3 is cut **after F1 lands**, and F1 after
the garrison overhaul; Stage 4 started early (13 Oct), so the November dates are history.

**Pins: named, never copied.** Global Constraints and Re-pins now say "main's current pins": the
three sim pins (`determinism.test.ts` ~L488 flat, ~L857 relief, ~L977 orders on `f4b3ea2b`),
`LADDER_CREDITS` (`playtest.ts` ~L3431) with `CAMPAIGN_CREDITS` (`stores-model.ts` L63),
`ROSTER_MAX` (~L3566), `GATES` (~L3121), and F1's `ECONOMY_PIN`/`ECONOMY_PIN_RELIEF` (still not in
the tree; F1 Tasks 1 and 5 create them). Targeted fire (#591) moved the sim pins; the garrison
overhaul moves them again and moves `LADDER_CREDITS`/`CAMPAIGN_CREDITS` and `ROSTER_MAX`
(`e8cdab88`, `53b020ba`). Read every one on the branch base.

**What landed and what it does to F3.**
- **#585, the mission time limit (#540).** Every mission declares `time_limit_s`; a stall ends as a
  `'withdrawn'` defeat in `checkEnd` (~L1925-1947). Task 7's roster skip sits in the same `checkEnd`
  and is unaffected. Task 7 Step 1's measurement must also keep every `time limit` headroom line
  clear (`tools/src/backtest/time-limit.ts`). `tools/validate_time_limit.mjs` and its spec are a
  second precedent for Task 2's pure validator module.
- **#580 (#291, #279, #247), #584, #570, #572.** Routs, civilian flight, `manpad_team` on foot,
  working splash suppression, anti-armour target choice. They change who survives, so Task 7's L-1
  footprint (R) is a fresh reading, not the 11 Oct one.
- **The garrison overhaul (not merged).** D1 already counts a garrisoned unit; the overhaul adds two
  states D1 must keep counting: an overflow unit **waiting at the door** of a full building (B3:
  alive, `moving` 0, not garrisoned) and a slot freed on `removeFromPlay` or death (B5). Neither
  changes the count (a waiting unit is alive; a removed one is not). `sarim_rifles` gains the
  `garrison` ability. It re-scripts five plans, including `umm_zeitoun_4_clearance`, where
  `ROSTER_MAX` is measured: Task 7 Step 1 reads L-1's footprint on the post-merge plans only.
- **#591 targeted fire, #577 H skips a garrison.** No F3 interaction: population counts units, not
  orders.
- **Versus (N0/N1a/N1b).** A room runs Free Play only and builds no `MissionRuntime`
  (`main.ts` ~L1458), and has no production. `MissionContext.popCaps`, the door the plan names for
  "on in skirmish and co-op", therefore cannot reach a versus room. Nothing to build in F3: a versus
  cap would be a `MatchConfig` field once versus has production (Q10, below, taken default).
- **F1 (not landed; F3 waits on it).** F3 Task 4 re-pins **both** economy pins once: folding
  population into `economyHash` moves the flat pin and the relief pin alike, so Task 4's commit names
  both, and the relief fixture needs the same coverage check (a cap that really refuses a build).

**Stale items fixed in place.**

| where | was | now (`f4b3ea2b`) |
|---|---|---|
| Global Constraints, Re-pins | sim pin, ladder and roster values | named pins, "main's current pins" |
| File structure, Task 3 | harness `unitInfo` at `playtest.ts` ~L259; `main.ts` ~L2332 | `tools/src/backtest/playtest-run.ts` ~L303; `main.ts` ~L2557 |
| Task 1 | `UnitTypeJson` ~L158, `unitTypeFromJson` ~L494, `addUnitType` ~L1327, `haltsToFire` parse ~L540 | ~L162, ~L519, ~L1413, ~L565 (`UnitTypeJson` still has no `cost` field) |
| Task 2 | `resources` ~L280-302; `validate_briefing.mjs` wired ~L1080 | `resources` ~L286; imported L24, used ~L1083 |
| Task 3 | `buildBlockedReason` ~L609, camp return ~L619, `requestBuild` ~L679, `buildQueue` ~L525 | ~L620, ~L630, ~L690, ~L531 |
| D5 | fresh remnant `drawn = [null]` ~L1295 | ~L1317 |
| Task 6 | `resolvedMission` built at `main.ts` ~L1746-1754 | ~L1952 (`startMission` ~L2547) |
| Task 7 | `checkEnd` ~L1897, survivor loop ~L1920-1939, unfielded append ~L1942; `main.ts` survivor count ~L516; `CONDUCT_GATES` ~L3007, `conductLedgerAfter` ~L2886 | `checkEnd` ~L1925; `survivors.push` ~L1958, `roster.push` ~L1972, unfielded append ~L1977; `main.ts` ~L534; `CONDUCT_GATES` ~L3188, `conductLedgerAfter` ~L3063 |
| Task 8 | `chipArtHtml` ~L213; `broughtFor` ~L136; `deploySpread` ~L240; `FieldOrder.attached` ~L2143 | ~L219; ~L139; ~L243; ~L2365 |
| Lane A | `getMission` ~L2462; deny cue wired at the order sink ~L3483 and support ~L3625 | `getMission` ~L2674; order sink `deny` ~L3939, support refusal ~L4089 (and a room's paused-order note ~L3163); `ui/production.ts` still plays none |
| D5 | the harness's gate copy `playtest.ts` ~L119/~L238 | `kdfUnlockGate` `playtest-run.ts` ~L112, `withBought` ~L282 |
| Census | 34 of 35 unit JSONs declare `cost.population`; `wadi_halam_5_depot` placements 4 (`dozer_d9`, Conduct 87) and 5 (`demo_squad`, 77) | re-verified, unchanged |

**Pre-flight decisions still open.** Q4-Q9 (11 Oct) carry no ruling in this file or in
`2026-10-04-stage4-order.md`; they still go to the lead before Task 8 and the Lane A rows. One more,
found here:

10. **A population cap in versus.** Taken default: none in F3. Versus has no production yet, and a
    room has no `MissionRuntime`; when it gains production, the cap is a `MatchConfig` field checked
    the same on both machines, in its own plan. Overrule only if the lead wants F3 to ship that door.

## Changed since 4 Oct (refreshed 6 Oct)

Refreshed against `main` `b44df7aa` (v0.121.4, 6 Oct). F1 has not landed (`economyHash` and the
`ECONOMY_PIN*` constants are not in the tree), so Task 4 still waits on it.

Landed, touching F3:
- **#402**, infantry halt to fire (`7962b6ea`, 6 Oct, a lead-approved one-off sim change): `UnitType.haltsToFire`,
  parsed in `unitTypeFromJson` (sim.ts ~L540), where Task 1's `population` goes. Sim pins 2109596329 /
  1425295494 → 922714084 / 3200430224; `LADDER_CREDITS` 5844 → 5830; `ROSTER_MAX` 33 → 31. Its
  `tools/src/halt_to_fire_roster.test.ts` is the precedent for pinning a parsed field on the shipped roster.
- **GH-382** (5 Oct): every arc's II+ missions on new maps. For F3, coordinates only: units, counts,
  `from_ledger`, `upgrades_to`, `resources` and `target_minutes` are unchanged against `751b6742` (my
  diff), so both G3 censuses recount identically. Ladder 5736 → 5844; `ROSTER_MAX` 30 → 33.
- **GH-330** (`44e5874a`, after `067fab9a`): `CAMPAIGN_CREDITS` (`stores-model.ts` L63) is held equal to
  `LADDER_CREDITS` by `tools/src/campaign_credits.test.ts`, so a Task 7 ladder re-pin moves both.
- **GH-119**: `briefing_sections` must spell `briefing` exactly. F3 edits no briefing.

Interactions:
- **Loan and halt to fire never meet in code.** The flag is per TYPE and follows the type fielded after
  `resolveUpgrades`: a loaned `demo_squad`, `yahalom_squad` or `sniper_team` kneels to fire; a loaned Lavi,
  Namer, drone or D9 never braces. No app code reads `haltsToFire`, `LedgerRosterEntry` holds no brace
  state, and a kneeling, carried or garrisoned unit is alive and counts under D1.
- **Fixture trap** (Tasks 1, 3, 7): a test unit type with no `role` derives as wheeled, so it never braces
  and cannot embark. Infantry fixtures declare `role: 'infantry'`.
- **The `(bought)` probes** are built, so never on loan. L-1 reaches them only through pools: `ledUZ3`
  descends from Tel Marum III, which the harness runs on `{}`; `led4In` (the Zikit whose post #402
  re-fitted) from the breach's rating (R, Task 7 Step 1).

### For the lead
No 4 Oct ruling (G3 Q4: cap off in the campaign, on in skirmish/co-op, used/cap on the HUD when on; Q5:
missions may lend, marked "on loan") conflicts with what landed. Three questions:
1. Since GH-330, an L-1 move of `LADDER_CREDITS` also moves `CAMPAIGN_CREDITS`, the figure the store
   quotes per campaign. Is that inside the L-1 confirmation Task 7 asks for, or does it need its own word?
   **Ruled 6 Oct:** inside L-1.
2. (Found in the refresh, not a landing.) Task 8 has no row to mark: both deploy surfaces list only
   `from_ledger` draws, and D5 never lends one, so no loaned unit appears on the deploy screen today.
   Where should "on loan" sit: a new list of issued placements beside "What you brought", or elsewhere?
   **Ruled 6 Oct:** on the in-mission unit card and the selection chip, and on the dock tile if a
   loaned type appears there. It is not on the deploy screen. Task 8 is rewritten to match.
   **Premise changed 8 Oct (#442): see Pre-flight Q4.**
3. (Found in the refresh, not a landing.) A `from_ledger` draw that finds no survivor spawns a fresh
   remnant (mission.ts ~L1295, `drawn = [null]`). Should D5 still call that body never on loan when its type is gated?
   9 of the 68 gated lines are `from_ledger`.
   **Ruled 6 Oct:** yes. A `from_ledger` placement is never on loan, even when it spawns a fresh
   remnant.

## Pre-flight 2 (2026-10-11), evening, against main 49715ff9

Read and grepped, not run. F3 reads no movement rule, so #537's sweep flag, #535's N move and #534's
body pick change none of its logic. What moved is numbers and the harness F3's Task 7 measures with.

| where | correction | |
|---|---|---|
| Global, Re-pins | Sim pins are **three**: flat `1202444260`, relief `3354895120`, orders `2737216487` (`determinism.test.ts` ~L438, ~L736, ~L845). All unmoved by F3 (R) | fixed in place |
| Task 7, Re-pins | `ROSTER_MAX` is **30** (#537 31 → 32, #542 32 → 30), still at `umm_zeitoun_4_clearance`. #542 moved it because UZ IV's plan now sends its escort after Adhal once the yard is razed, so two more bodies die | fixed in place |
| Task 7, Re-pins | `LADDER_CREDITS` = `CAMPAIGN_CREDITS` = **5917** (5870 → 5850 #529 → 5947 #537 → 5917 #542) | fixed in place |
| Task 7 line refs | `playtest.ts` at `49715ff9`: `LADDER_CREDITS` ~L3096, `ROSTER_MAX` ~L3228, `GATES` ~L2820, `CONDUCT_GATES` ~L2887. `run()` and the harness's `unitInfo` moved to `playtest-run.ts` (~L285); `main.ts`'s `unitInfo` is ~L2382 | noted (locate by symbol) |
| Task 7, Step 1 | **The measurement is 30 seeds now.** `plan-sweep.ts` runs every winning plan down **each seed's own chained ledger**, so L-1's smaller pools reach 29 more ledgers than the 424242 one the pins read. L-1 must keep every plan at 30/30 seeds and every gate on time on 30/30, not only the 424242 line. `ROSTER_MAX`, `LADDER_CREDITS` and `GATES` are still read from 424242 (#542). A full run is ~57 s locally | fixed in place |
| Task 7, Step 1 | The ten plain winning runs it names: #542 re-scripted **Khan Rafid I and II** (KR I: the Eitan and jeep go to the alley post's foot when the drone is lost; KR II: an Eitan takes the east ring road for the family). Both start from `{}`; re-read what they field before predicting L-1's footprint | noted |

No new lead decision. Q9 (pre-L-1 saves) is unchanged.

---

## Pre-flight, 11 Oct (against main f2d5d9e8)

Checked every path, symbol, line reference and pin this plan names against `main` `f2d5d9e8`. Docs only.
Sim pins unchanged (flat 922714084, relief 3200430224). `economyHash` and `ECONOMY_PIN*` are still absent
(F1 Task 1 creates them).

Landed since `b44df7aa`, touching F3:
- **#442 Field order** (8 Oct, `cf96b5b9`): the deploy screen now lists every **non-`from_ledger`
  placement** as a fixed card, noted "from brigade" (`deploy.attached`). `main.ts` builds `FieldOrder.attached`
  from `resolvedMission.starting_force`, so a loaned unit **does** have a row on the deploy screen. The 6 Oct
  ruling ("no row exists, so the mark is not on the deploy screen") rested on a premise that is no longer
  true. See Q4.
- **#441 roster R-2 + cap** (7 Oct): `roster-carryover.ts` (`applyRosterCarryover`, `isReplayed`),
  `ROSTER_CAP = 150` (`roster-cap.ts`), `roster.reserve`. It runs in the APP on top of `checkEnd`'s output, and
  `ROSTER_MAX` (31) is still measured on `checkEnd`'s raw roster in `playtest.ts`, so the pin is unaffected.
  R-2 does not make L-1 redundant (see the L-1 decision below).
- **#454 one chrome register, #426 audio cues, #428/#461 tiered alerts, #448 type register, #501 one footer**:
  rules for any new chrome. Applied in the Lane A rows below.
- **#431 / #444**: `LADDER_CREDITS` and `CAMPAIGN_CREDITS` are **5870** (were 5830 on `b44df7aa`). #431 also
  edited `mission.ts` (`razeExempt`), so "packages/sim closed until 2 Nov" was not literal. F3's Tasks 3, 6 and 7
  edit the same file in other places (`buildBlockedReason`, `spawnPlacement`, `checkEnd`); no overlap with
  `razeExempt`.
- **#402 / #474 / #479**: unchanged for F3. F3 adds no unit, structure or GLB, so the `memory` job's three
  missions do not move. F3 adds no hotkey, so the H/X/V keymap rulings are untouched.

| task | what changed | fixed in place / question |
|---|---|---|
| Changed-since, Task 3, File structure | `main.ts` runtime `unitInfo` builder is now ~L2332 (was ~L2102); it still returns `{ logistics, buildTimeS, unlock }` | fixed in place |
| Task 6 | `main.ts` builds `resolvedMission` (`resolveUpgrades`) at ~L1746-1754 (was ~L1614); `startMission(sim, resolvedMission, …)` ~L2322 | fixed in place |
| Task 3 | `mission.ts`: `buildBlockedReason` ~L609, camp early return ~L619, `requestBuild` ~L679, `buildQueue` ~L525 (were ~L601, ~L611, ~L671, ~L517) | fixed in place |
| D5, Changed-since | fresh remnant `drawn = [null]` at `mission.ts` ~L1295 (was ~L1276-1289) | fixed in place |
| Task 7 | `checkEnd` ~L1897; survivor loop ~L1920-1939; unfielded-pool append ~L1942 (were ~L1884, ~L1929) | fixed in place |
| L-1, Task 7, Re-pins | `LADDER_CREDITS` 5830 → **5870** (`playtest.ts` ~L3195, was ~L3181); `ROSTER_MAX` 31 at ~L3322 (was ~L3308); `GATES` ~L2944 and `CONDUCT_GATES` ~L3007 unchanged | fixed in place |
| Task 9 | the `starting_force` paragraph in CLAUDE.md is ~L2205 on this tree (plan said ~L2079); Conduct floors 87/77/70/85 re-verified in `data/units/kdf/*.json` | fixed in place |
| Task 8 | `chipArtHtml` is `hud.ts` ~L213 (was ~L165); `broughtFor` `loading.ts` ~L136 (was ~L130); `deploySpread` ~L240 (was ~L252) | fixed in place |
| Task 2 | `mission.schema.json` `resources` block is ~L280-302 (was ~L270-291); `town` still required (L7-14); `validate_data.mjs` still wires `validate_briefing.mjs` at ~L1079 | fixed in place |
| Task 8 | **#442**: the deploy screen has a row per non-ledger placement | **Q4** |
| Task 8 | the mark's free slots are fewer than the plan assumes: chip art top-right = kit sign, bottom-left = status mark (broken/pinned/gun out/immobilised); card frame top-left = role badge; chip status line = combat state with a tone class (`chip-status-cascade.test.ts`) | fixed in place (constraints added to Task 8); Q5 |
| Task 8 | chips group by TYPE (`selection-model.ts` `groupChips`; a chip click selects that type), so one chip can hold a loaned and a non-loaned unit of one type | fixed in place (taken default); Q6 |
| Task 8 | the dock tile is a build option, not a unit; a locked tile carrying "on loan" would say two things | Q7 |
| Lane A, Task 3 | `dock-model.ts` `tileState` turns **any** non-null `buildBlockedReason` into a `lock` with short label `locked` and sets `data-locked`; the cap would read "locked", wear the permanent campaign-gate treatment, and say "locked" for a state that lifts when a unit dies | fixed in place (Task 3 adds `popCapped`; Lane A row rewritten); Q8 |
| Lane A | `production.ts` plays **no** deny cue on a locked or refused build (`CRITICAL_CUES.uiDeny` is wired only at `main.ts` ~L3483 order sink and ~L3625 support) | fixed in place (Lane A row); Q8 |
| Lane A | `dock.note.cannotBuild` says "insufficient logistics"; a cap refusal needs its own note | fixed in place (Lane A row) |
| Lane A | the sim's reason string is English and shown raw for non-gate reasons; a cap string would ship un-localised | fixed in place (app renders it through `t()` from `populationView()`) |
| Lane A | used/cap on the strip: #454 VR-25 makes this mission's logistics/intel `--info`; VR-27 one disabled treatment; no new glyph (G1 sheet, `validate:ui` dingbat gate) | fixed in place (Lane A row) |
| Task 7 | `MissionEvent` `missionEnd.survivors` feeds `main.ts` ~L516 ("n survivors"); skipping the whole loop body would also drop loaned survivors from that count and from `promotedValue` | fixed in place (Task 7 Step 3 skips only the `roster.push`) |
| Task 7 | `fillVacancies` (`roster-lost.ts`) hands a vacated slot to any slotless body of the same type, so today a lent survivor can take a dead veteran's place ("X took Y's place") | fixed in place (added to L-1's reasoning and Task 7 Step 2) |
| L-1 | pre-L-1 saves already hold lent bodies that earlier wins enlisted | Q9 |
| Task 3 | no new `MissionEvent` kind, so no `cues.ts` row; a build refused for the cap is a `hud.note` (tone `warn`), not a feed alert, so no tier or place | fixed in place (stated in Task 3) |
| Task 1, 3 | references to `brace.test.ts` ~L133, `facing.test.ts` ~L147, `halt_to_fire_roster.test.ts`, `unlock.ts` L7/L48/L150, `credits.ts` L59, `stores-model.ts` L63, `campaign_credits.test.ts`, `determinism.test.ts` L427/L721, the 68/26/9 census and `wadi_halam_5_depot` indices 4/5 | verified, no change |

### For the lead (continuing the numbering above)

4. **Does the deploy screen mark a lent unit after all?** #442 put a "from brigade" card on it for every
   non-ledger placement, loaned or not. That note is also wrong for a lent unit (it is not the brigade's).
   The 6 Oct ruling put the mark on the unit card and chip only, because no row existed. **Recommend:** keep
   the unit card and chip as ruled, and also swap that card's note from "from brigade" to "on loan" for a
   loaned placement (one string `deploy.onLoan`, read from `loanedPlacements` over the RESOLVED mission, the
   same array `FieldOrder.attached` is built from). It is what G3 Q5 originally asked for and it is
   additive. Task 8 gets a Step 2c, marked "(only if Q4 is yes)".
5. **Mock the mark before building it.** The lead rejected the kit badge on the world on sight, and a chip
   has two of its four art corners taken. **Recommend:** Task 8 starts with a card-and-chip mock for the
   lead, then builds. Proposed: a dim text stamp "On loan" (display capitals by CSS, VR-20) after the name on
   the card and after `×count` on the chip, neutral `--ink-dim` outline. Not `--on` (live state), not
   `--selected`, not `--info` (logistics/intel), not `--commend` (credits). It must not ride the chip's
   combat-state status line.
6. **Mixed chips.** One chip groups every selected unit of a type. **Recommend:** the stamp shows when ANY
   unit in the chip is loaned, and the tooltip says "N of M on loan"; no splitting chips (a chip click selects
   the type). Taken default; overrule if the lead wants it all-or-nothing.
7. **Dock tile "on loan"?** The ruling says "if a loaned type appears there". The dock lists build options; a
   locked D9 tile already says why it is locked. **Recommend:** never mark the tile. Taken default.
8. **Cap on the dock.** **Recommend:** a capped tile is its own state (`data-capped`, `--disabled-opacity` and
   `not-allowed`, short label "pop full", full line "Population 12/12. A unit must fall first." from
   `populationView()`), below a campaign lock in precedence, and a click on a locked, capped or refused tile
   plays `ui.deny` through a new `ProductionOptions.deny` wired to `CRITICAL_CUES.uiDeny` in `main.ts`
   (today none of the three refusals sounds). The deny cue on the two existing refusals is a behaviour
   change, so it is named here. Used/cap on the strip shares the `logistics` HUD-element visibility, `--info`,
   a dim word, no glyph; at the cap it takes the warn tone.
9. **Saves from before L-1.** Lent bodies that earlier wins already enlisted stay in the brigade, the way R-2
   left pre-R-2 duplicates. **Recommend:** yes, no migration. Otherwise Task 7 needs a ledger migration,
   which is a bigger change.

**Goal:** Two small rulings, made real.

| ruling (lead, 4 Oct) | today (`main` `067fab9a`, re-checked on `b44df7aa`) | after F3 |
|---|---|---|
| **Q4.** A population cap, available per mission and doctrine: **off in the campaign, on in skirmish and co-op**. The HUD shows used/cap when it is on | 34 of the 35 unit JSONs declare `cost.population` (drones 0, most teams 1, APCs 2, Lavi 3); `civilians.json` takes the schema default 1 (`unit.schema.json` L82-86) and stands on side 2; **nothing reads it** (M, G3 sheet; still true on `b44df7aa`, grep) | the runtime counts it; a cap, when set, refuses builds past it; the validator refuses a cap on any campaign mission |
| **Q5.** Missions may **lend** locked units, and the deploy screen marks them **"on loan"** | `starting_force` never consults `unlock`; 68 gated placement lines in 26 of 27 missions (M at `751b6742`; my recount on `b44df7aa` is unchanged: 68 in 26, 9 of them `from_ledger`, only `beit_sahwan_breach` has none); CLAUDE.md calls it "undecided" | a documented feature; one pure predicate names the loaned placements; the unit card and selection chip mark them (ruled 6 Oct on the premise that the deploy screen lists no loaned unit; #442 now does, see Pre-flight Q4); a loaned survivor goes back to the lender (L-1, the one decision here that can move a pin) |

**Architecture:**
- **The cap is `MissionRuntime`.** Population is read from `UnitType.population` (new, parsed in
  `unitTypeFromJson` from the JSON the sim already loads, not hashed, read by no sim system), summed
  over a side's living units plus its queued builds. The cap comes from the mission (`resources.pop_cap`) or from the
  runtime context (`MissionContext.popCaps`), which is the door G-G's doctrine loader and G-H's co-op
  setup will use. No campaign mission sets one, so no campaign outcome can move.
- **"On loan" is one pure predicate in `unlock.ts`**, beside `unlockReason` and `resolveUpgrades`,
  so the runtime and the HUD's mark read the same answer (the `missionShepherds` pattern from the
  Stage 4 sim-fix plan, `docs/superpowers/plans/2026-09-29-stage4-sim-fixes.md`).

**Tech stack:** TypeScript strict, vitest (jsdom for the HUD).

**Refs:**
- GH-183 F3 and F4's "a ruling on `starting_force` never consulting `unlock`". GH-167 (G3) Q4 and Q5,
  the lead on 4 Oct.
- The G3 decision sheet (PR #369, `docs/superpowers/specs/2026-10-04-g3-decision-sheet.md`), Q4 (the
  population census: KDF starting 6–20, Sarim ×1/×2 at 20/27 pop against the KDF's 10, so an equal cap
  would undo Q7) and Q5 (the 68-line census, Wadi Halam V's two demolishers, `upgrades_to`/`gate_only`
  as the sanctioned restraint path). All M at `751b6742`, before GH-382 and #402. The JSON half
  recounts identically on `b44df7aa` (my count: authored starting population 6–20 bar the tutorial's 1,
  `umm_zeitoun_4_clearance` 20; still 6 `upgrades_to` sites, `gate_only` on `qarn_hadid_3_clearance`'s
  jeep only). The Sarim figures come from the skirmish spike and are not in the tree.
- CLAUDE.md, "Known scaling debts", the `starting_force` paragraph (rewritten in Task 9).
- `packages/app/src/ui/deploy-roster.ts`, `ui/loading.ts` (`broughtFor`): the deploy surfaces, which
  list no loaned unit. `packages/app/src/ui/hud.ts` (the unit card and the selection chips) and
  `ui/kit-sign.ts` (`kitIconSignHtml`, the DOM sign the mark sits beside): where the mark goes since
  the 6 Oct ruling.

**Base:** read against `main` `067fab9a`, refreshed against `b44df7aa` (6 Oct), pre-flighted against `f2d5d9e8` (11 Oct) and `f4b3ea2b` (14 Oct). Branch `feat/gf3-popcap`,
cut from `main` after F1 lands (F1 is cut after the garrison overhaul merges). Nothing measured yet: (M) is quoted from the G3 sheet, (R) is reasoned.

---

## Decisions

- **By the lead, 4 Oct:** Q4 and Q5 as in the table.
- **Taken defaults (confirm or overrule):**
  - **D1. Population counts every living unit of the side**: garrisoned, carried, buried. A carried
    squad is still a squad. Dead units free their population on death; a unit evacuated off the map
    is dead (`alive = 0`) and frees it too.
  - **D2. A queued build reserves its population at queue time**, as it pays its logistics at queue
    time today. Otherwise five builds queued against a cap of one free slot all succeed.
  - **D3. A cap never removes anything.** A starting force, a trigger spawn or a wave above the cap
    stands; builds are refused until the side is back under. Authored spawns ignore the cap (they are
    the mission's, not the side's purse). F4's enemy production is a build and **does** obey it.
  - **D4. "Off in the campaign" is enforced by `validate:data`**: `resources.pop_cap` is refused on
    every mission in `data/missions/` that declares a `town`. A future build-up mission that wants
    one needs the lead to lift the rule, which is the point. (`town` is a required field,
    `mission.schema.json` L7-14, so on today's tree the rule refuses `pop_cap` in every mission file,
    the tutorial included.)
  - **D5. A placement is on loan** when its unit's unlock gate, as resolved for this ledger (bought
    included, through `kdfUnlockGate`: `packages/app/src/kdf-gate.ts` in the app, the harness's own
    copy plus `withBought` at playtest.ts ~L119/~L238), is closed, **after** `resolveUpgrades`: a
    placement upgraded to an open unit is not on loan; a `gate_only` placement dropped by a closed
    gate is not on the field at all; a `from_ledger` placement is never on loan (it is the brigade's
    own body). (On a fresh or gutted roster a `from_ledger` draw spawns a fresh remnant instead,
    mission.ts ~L1295. Ruled 6 Oct: that remnant is never on loan either.) Halt to fire follows the fielded type, loan or not
    (#402).
  - **L-1. A loaned survivor goes back to the lender.** "For that mission" (the lead's Q5 wording)
    means the unit does not join `roster.surviving_units` at mission end. Today every starting-force
    survivor without `from_ledger` appends a new roster entry, so a lent Lavi would become the
    brigade's permanently, gate or no gate. **This can move the playtest roster lines (`ROSTER_MAX`)
    and, through later `from_ledger` draws, outcomes and `LADDER_CREDITS`, and with it
    `CAMPAIGN_CREDITS` (GH-330), each from main's current pin (14 Oct: never from a number in this
    plan).**
    It halts at Task 7 for the lead's confirmation. **R-2 (#441) does not make L-1 redundant.**
    R-2 only replaces a mission's OWN unfielded fresh bodies on a replay (`isReplayed`: `enlisted` stamp,
    `missions <= 1`, unfielded). The first win of a lending mission still enlists the lent Lavi for good, and
    `fillVacancies` (`roster-lost.ts`) would hand a dead veteran's vacated slot to that slotless body ("X took
    Y's place" on the debrief). With L-1 a loaned body never reaches `roster.surviving_units`, so it is never
    stamped `enlisted`, never slotted, never named, never counted by `ROSTER_CAP` and never in `roster.reserve`.
    Its death writes no `roster.lost` memorial (no `entityRoster` entry, so `lostRecordFor` is null) and reads in
    the after-action as a plain `aar.poor.lostFresh` loss. The credit formula is untouched either way:
    `creditInputFrom` (`packages/sim/src/credits.ts` L59) reads `startingCount`/`startingHome`, and a
    loaned unit that comes home still counts as home.

---

## Global Constraints

- **The four invariants hold.** Population sums are integers. No `rng`. The sim gains one parsed,
  unhashed, unread field (`UnitType.population`); no sim system reads it.
- **The three sim pins stay unmoved** by every task: main's current flat, relief and orders pins
  (`determinism.test.ts` ~L488, ~L857, ~L977 on `f4b3ea2b`), read on the branch base, never copied
  from this plan. A move is a defect.
- **The economy pins move once**, in Task 4, with the reason: both `ECONOMY_PIN` and
  `ECONOMY_PIN_RELIEF` (F1 births them).
- **`pnpm balance`** byte-identical (R).
- **`pnpm playtest`** byte-identical through Task 6 (R: no campaign mission sets a cap, and the
  predicate changes nothing it does not mark). Task 7 (L-1) moves roster lines by design; anything
  downstream is measured and named. *(Pre-flight 2, 2026-10-11: on all 30 seeds; every plan still wins
  30/30, #539/#542.)* *(14 Oct: and every `time limit` headroom line stays clear, #540.)*
- **Every check seen red**, by a one-line mutation, quoted in the commit.
- **Gates before every commit**: as F1, plus `pnpm validate:ui` for Task 8.
- **Git, TypeScript:** as F1. Task 8 is **Lane A** (`packages/app`), done by the lane A agent and
  landed in F3's PR when lane A is free; otherwise it moves to WP-S-F #184 unchanged.

---

## File structure

| File | Role | Task |
|---|---|---|
| `packages/sim/src/sim.ts` (+ `sim.test.ts`) | `UnitTypeJson.cost`, `UnitType.population`, parsed in `unitTypeFromJson` (which `addUnitType` calls) | 1 |
| `tools/src/` (a shipped-roster spec, beside `halt_to_fire_roster.test.ts`) | The shipped-JSON assertions of Tasks 1 and 6 | 1, 6 |
| `data/schemas/mission.schema.json`, `tools/validate_data.mjs` + a new pure rule module and its `tools/src/*.test.ts` | `resources.pop_cap`; the campaign refusal | 2 |
| `packages/sim/src/mission.ts` (+ test) | `population(side)`, `popCap(side)`, `populationView()`, the build refusal | 3, 4, 7 |
| `packages/app/src/main.ts` (~L2557 on `f4b3ea2b`), `tools/src/backtest/playtest-run.ts` (~L303) | The two runtime `unitInfo` builders gain `population` | 3 |
| `packages/sim/src/determinism.test.ts` | The economy re-pin | 4 |
| `tools/src/backtest/playtest.ts` | The population census line; Task 7's pins | 5, 7 |
| `packages/app/src/ui/stores-model.ts` (`CAMPAIGN_CREDITS`) | Moves with `LADDER_CREDITS` if Task 7 moves it (GH-330) | 7 |
| `packages/sim/src/unlock.ts` (+ test), `index.ts` | `loanedPlacements` | 6 |
| `packages/app/src/ui/hud.ts`, `ui/selection-model.ts` (`UnitFacts`/`ChipView`), `ui/kit-sign.ts`, `ui/theme.css`, `i18n/en.json` (+ tests); `ui/force-bar.ts` only if Q4 is yes | The "on loan" mark, on the unit card and selection chip (ruled 6 Oct) | 8 |
| `packages/app/src/ui/dock-model.ts`, `ui/production.ts`, `ui/hud.ts` (strip), `main.ts`, `i18n/en.json`, `ui/theme.css` (+ tests) | Lane A: used/cap on the strip, the `capped` tile state, the deny cue | 3 (sim half), Lane A |
| `docs/GDD.md`, `data/schemas/mission.schema.json` (`starting_force` description), `CLAUDE.md`, `docs/campaign/README.md`, `docs/HANDOVER.md` | The documented feature | 9 |

---

## Task 1: the sim carries population, and reads none of it

**Model:** haiku. **Agent:** `sim-guard`.

**Files:** `packages/sim/src/sim.ts`, `packages/sim/src/sim.test.ts`; the shipped-roster assertion in
`tools/src/` (see Step 1).

On `b44df7aa`: `UnitTypeJson` (sim.ts ~L158) has no `cost` field yet and gains
`cost?: { population?: number }`; the parse goes in `unitTypeFromJson` (~L494, called by `addUnitType`
~L1327), in the same return object as #402's `haltsToFire` (~L540). The house test for a parsed field
calls `unitTypeFromJson` directly (`brace.test.ts` ~L133, `facing.test.ts` ~L147). Fixture trap from
#402: a fixture with no `role` derives as wheeled. Population does not depend on it, but say which
role a fixture stands for.

- [ ] **Step 1: Write the failing tests:** `unitTypeFromJson` of a JSON with `cost.population: 3` gives
  `population === 3`; absent gives 1 (the schema default); `recon_drone`'s shipped JSON gives 0.
  Assert from literals, not by re-reading the JSON under test. The `recon_drone` case reads shipped
  data, which no `packages/sim` test does, so it goes in `tools/src/`, the way
  `tools/src/halt_to_fire_roster.test.ts` pins `haltsToFire` over `@lions/data`'s `units`.
- [ ] **Step 2: Implement.** Integer, validated ≥ 0.
- [ ] **Step 3: Measure.** Both sim pins unmoved (unit types are not hashed; if `hash()` ever folds
  type tables, stop and raise it).
- [ ] **Step 4: See it red.** Default to 0: the "absent gives 1" test fails.

---

## Task 2: the field, and "off in the campaign"

**Model:** sonnet. **Agent:** `mission-author`.

**Files:** `data/schemas/mission.schema.json` (`resources`, ~L280-302), `tools/validate_data.mjs` and a
new pure module beside it, with its spec in `tools/src/`. `validate_data.mjs` runs its whole sweep at
import time and has no spec of its own, so a rule that needs tests lives in a pure module it imports:
`validate_briefing.mjs` (wired at validate_data.mjs ~L1080, spec `tools/src/validate_briefing.test.ts`)
is the pattern.

**Interfaces (schema):** `resources.pop_cap: { "type": "integer", "minimum": 1, "description":
"Player-side population cap. Off in the campaign (lead, G3 Q4, 4 Oct): refused on any mission with a
town. Skirmish and co-op set it through the doctrine." }`

- [ ] **Step 1: Write the failing validator tests:** `pop_cap: 18` on a mission with `town` is refused
  by name and cites G3 Q4; the same on a fixture with no `town` passes; `pop_cap: 0` is refused by the
  schema. (`town` is schema-required, L7-14, so the town-less fixture exercises the pure rule
  function directly; the full gate would refuse it for the missing `town` first.)
- [ ] **Step 2: Implement.** `pnpm validate:data` passes on the shipped tree (no mission sets one).
- [ ] **Step 3: See it red.** Remove the town check: the campaign test passes a capped campaign
  mission.

---

## Task 3: counting, and refusing past the cap

**Model:** sonnet. **Agent:** `sim-guard`. **Depends:** Task 1.

**Files:** `packages/sim/src/mission.ts` and its test.

**Interfaces:**

```ts
export interface MissionContext { /* … */
  /** Doctrine or co-op caps, by side; overrides `resources.pop_cap`. null = uncapped. */
  popCaps?: readonly [number | null, number | null];
}
population(side: 0 | 1): number;            // living units (D1) + queued reservations (D2)
popCap(side: 0 | 1): number | null;
populationView(): { used: number; cap: number } | null;   // side 0; null when uncapped (HUD hides)
// buildBlockedReason gains, after the unlock and camp checks:
//   `population cap reached (${used}/${cap})`
// unitInfo(id) gains `population: number`
popCapped(unitId: string): boolean;         // true only when the cap is the FIRST refusal, in buildBlockedReason's own order
```

`popCapped` exists because `dock-model.ts`'s `tileState` turns any non-null `buildBlockedReason` into a `lock` (see Lane A). It is a pure read, and the order test names both directions: a gated unit on a full side reads `false` (the gate speaks), an ungated one reads `true`. No new `MissionEvent` kind: a refused build is a return value and a `hud.note`, so `cues.ts` needs no row (its exhaustive record goes red only on a new kind).

On `f2d5d9e8`, `buildBlockedReason` (mission.ts ~L609) checks, in order: no `unitInfo` →
`'not available in the field'`; `unlockReason(...)`; then the camp, which **returns `null` early when a
camp stands** (~L619) before `'field camp destroyed — no production'` and
`'no field camp — production needs one standing'`. The population check must not sit behind that early
return. `requestBuild` (~L679) pays and pushes onto `buildQueue` (~L525); queued entries carry no side
(player only). Two runtime `unitInfo` builders return `{ logistics, buildTimeS, unlock }` today and both
need `population`: `main.ts` ~L2332 and `playtest.ts` ~L259. The dock's own unit list (`main.ts` ~L3277) does not call `unitInfo`; it reads `u.cost` and `kdfUnlockGate` itself, so a `DockUnit.population` (for the tile's tooltip) would be a third reader of `cost.population`. D1's states are `sim.state.carriedBy`,
`garrisonedIn` and `tunnelIn`.

- [ ] **Step 1: Write the failing tests** (fixtures with a cap through `ctx.popCaps`, since the
  schema refuses one on a campaign mission):
  - uncapped: `populationView()` is null and every build behaves as on `main`;
  - cap 6 with 5 used: a 1-pop build succeeds, a 2-pop build is refused with the reason string and
    costs nothing;
  - two queued 1-pop builds at 5/7: the second reserves the last slot; a third is refused (D2);
  - a unit dies: its population frees on the same tick;
  - a carried squad, a garrisoned squad and a buried squad all count (D1); each fixture squad declares
    `role: 'infantry'` (with no role it derives as wheeled and cannot board, #402's fixture trap), and
    the test asserts `carriedBy`/`garrisonedIn`/`tunnelIn` before it counts;
  - drones (population 0) are never refused by the cap;
  - a starting force of 8 under a cap of 6 stands, and every build is refused until two die (D3);
  - a trigger spawn above the cap spawns (D3).
  - `popCapped`: true for an ungated 2-pop build at 11/12; false for a gated, still-locked unit on the same side
    (the gate speaks first); false when a camp is destroyed (the camp reason speaks first); false for a drone.
- [ ] **Step 2: Implement.** One pass over the side's ids per query; called on build requests and once
  a tick for the HUD view, not per unit.
- [ ] **Step 3: See it red.** Skip the reservation: the "third is refused" test fails. Count only
  units not carried: the D1 test fails.

---

## Task 4: the economy pin learns population

**Model:** haiku. **Agent:** `sim-guard`. **Depends:** Task 3, F1 Task 1.

**Files:** `mission.ts` (`economyHash`), `determinism.test.ts`. Neither `economyHash` nor the
`ECONOMY_PIN*` constants exist on `b44df7aa`: F1 Task 1 creates them.

- [ ] **Step 1:** `economyHash` folds `population(0)`, `population(1)`, and each cap (null as a
  sentinel). The F1 fixture gains a `ctx.popCaps` of `[12, null]` and one build the cap refuses.
- [ ] **Step 2: Re-pin once.** Commit: *"economy pins re-pinned: population and the cap are economy
  state (G3 Q4, lead 4 Oct); the fixture gained a cap of 12 and a refused build; was N / M"*.
  Coverage: assert the fixture really refuses one build for the cap (`buildBlockedReason` read back),
  so the pin is not over a cap that never binds.
- [ ] **Step 3: See it red.** Drop the cap from the hash: a fixture variant with cap 13 hashes the same
  as 12, and the coverage test written for that pair fails.

---

## Task 5: the census in the harness

**Model:** haiku. **Agent:** `playtest`. **Depends:** Task 3.

**Files:** `tools/src/backtest/playtest.ts`.

- [ ] **Step 1:** Print per mission, from the winning plan: starting population, peak population, and
  end population for side 0 and side 1. No gate: no campaign mission has a cap, and a pinned peak
  would be a fitted number. The numbers exist for G-G's doctrine caps and for any build-up mission the
  lead later allows a cap (G3 sheet: KDF starting 6–20, ceiling ~26, M at `751b6742`; the authored
  starting figure recounts identically on `b44df7aa`, and the ceiling's inputs, `resources` and
  `target_minutes`, are unchanged; peak and end population have never been measured, and #402 changed
  who survives, `ROSTER_MAX` 33 → 31).
- [ ] **Step 2: Measure.** Every existing line byte-identical; the new lines are additions.
- [ ] **Step 3: See it red** (that the line reads the runtime, not the JSON): spawn a trigger unit in a
  scratch fixture mid-mission; peak moves, starting does not.

---

## Task 6: which placements are on loan

**Model:** sonnet. **Agent:** `sim-guard`.

**Files:** `packages/sim/src/unlock.ts` and its test, `packages/sim/src/index.ts`; the shipped census
case in `tools/src/` (see Step 1).

On `b44df7aa`: `UnlockGate` (unlock.ts L7) is `{ roeMin?, starsMin?, afterMission?, price?, bought? }`;
`unlockReason` is L48, `resolveUpgrades` L150. `resolveUpgrades` takes a whole `MissionJson`, not a
`Pick`, so the signature below widens or spreads into one. It also `filter`s a dropped `gate_only`
entry out, so authored and resolved indices differ after one: say which array the answer indexes. Both
consumers already hold the RESOLVED mission (`main.ts` ~L1746-1754 builds it once for the runtime, `broughtFor` and, since #442, `FieldOrder.attached`). **The answer indexes the RESOLVED `starting_force`** (the array those three read), not the authored one; the census indices 4 and 5 below are the same in both for `wadi_halam_5_depot`, which has no `gate_only` entry.

**Interfaces:**

```ts
/** D5. Indices into `mission.starting_force` of placements that field a unit whose
 *  gate is closed for this ledger, after `resolveUpgrades`. Pure; the runtime and
 *  the app call it with the same `gateOf`. */
export function loanedPlacements(
  mission: Pick<MissionJson, 'starting_force'>,
  ledger: LedgerData | undefined,
  gateOf: (unitId: string) => UnlockGate | undefined,
): readonly number[];
```

- [ ] **Step 1: Write the failing tests:**
  - a `mbt_lavi` placement with `roeMin: 90` and a ledger at Conduct 80 → on loan; at 95 → not;
  - the same gate with `bought: true` → not;
  - an `upgrades_to` placement whose upgrade is open → not (the upgraded unit is fielded, and it is
    open); whose upgrade is closed → the base unit's own gate decides;
  - a `gate_only` placement with a closed gate → absent from the answer (nothing is fielded);
  - a `from_ledger` placement of a gated type → never;
  - **the shipped census**: on an empty ledger, `wadi_halam_5_depot` reports the `dozer_d9` and the
    `demo_squad` placements as on loan (Conduct 87 and 77: `data/units/kdf/dozer_d9.json` L8,
    `demo_squad.json` L73 on `b44df7aa`; authored indices 4 and 5, still fielded fresh after GH-382 moved
    the mission to `wadi_halam_5`). Its `ifv_namer` (Conduct 85) is `from_ledger` and its
    `jeep_shoded` → `apc_kipod` (44 stars) resolves to the ungated jeep, so neither is on loan. This is
    the feature's own canonical case, as a test, in `tools/src/` (packages/sim tests read no shipped
    JSON; `halt_to_fire_roster.test.ts` is the precedent).
- [ ] **Step 2: Implement** by calling `resolveUpgrades` and `unlockReason`, never re-deriving either.
- [ ] **Step 2b: The runtime remembers who is on loan** (since the 6 Oct ruling put the mark in the
  mission itself). The runtime never sees a gate (`resolveUpgrades`' own comment), so the indices
  reach it through `MissionContext`. It records the loaned entity ids at spawn and answers
  `isOnLoan(id): boolean`. Task 7's roster skip and Task 8's mark both read this one record, so this
  step does not wait for L-1. Test: on `wadi_halam_5_depot` with an empty ledger, the D9 and the
  demolition squad answer true, and the `ifv_namer` answers false.
- [ ] **Step 3: See it red.** Skip `resolveUpgrades`: the `upgrades_to` test fails. Ignore `bought`:
  the bought test fails. Record ids from the authored placements instead of the resolved ones: the
  Step 2b test fails.

---

## Task 7: a loaned survivor goes back (L-1; halts for the lead)

**Model:** sonnet. **Agent:** `sim-guard`, then `playtest`. **Depends:** Task 6. **Halts until the lead
confirms L-1 on #183.** If the lead overrules, this task is skipped and the plan records that a lent
unit is kept.

**Files:** `packages/sim/src/mission.ts` and its test, `tools/src/backtest/playtest.ts` (comments and
pins), `packages/app/src/ui/stores-model.ts` (`CAMPAIGN_CREDITS`, only if `LADDER_CREDITS` moves;
ruled 6 Oct: inside the L-1 confirmation, no separate word needed).

- [ ] **Step 1: Measure first, on a scratch copy.** Run `pnpm playtest` with the change. *(Pre-flight
  2, 2026-10-11: the full 30-seed run, ~57 s; the plan sweep walks each seed's own ledger, so report
  per-seed misses as well as the 424242 lines.)* Report which
  roster lines move, whether any later `from_ledger` draw fields a different force, and whether any
  outcome, grade or credit moves. On the optimal ladder every Conduct gate is open after mission 1
  (M, G3 sheet Q5; on `b44df7aa` asserted by `CONDUCT_GATES`, playtest.ts ~L3007, all nine
  `opensAfter: 1`). That is the SYNTHETIC `conductLedgerAfter` ladder (~L2886), though, and L-1's
  footprint is decided by the harness's own runs. Read from their `run(` calls on `b44df7aa` (the same
  threading as on 4 Oct), ten plain winning runs that field a gated fresh placement start from `{}`,
  every Conduct gate closed: Wadi Halam I, Khan Rafid I–III, Deir Amun I–III and Tel Marum I–III.
  Wadi Halam I's ledger feeds Wadi Halam II–V, and Tel Marum III's feeds both Qarn Hadid I–III and Umm
  Zeitoun I–IV, where `ROSTER_MAX` (31; 30 since #542, Pre-flight 2) is measured. Beit Sahwan threads from the breach's rating. The
  two feeders lend a drone (Wadi Halam I) and two Lavis, a Namer and a drone (Tel Marum III), and no
  `from_ledger` draw downstream of them asks for a drone, or for a Lavi or a Namer on the Qarn Hadid and
  Umm Zeitoun side. So the expected footprint (R) is the ten runs' own roster lines, the pool sizes
  downstream of Wadi Halam I and Tel Marum III, and `ROSTER_MAX`.
  A chained mission whose inherited rating sits below a floor would lend as well; not read here. Of the
  `(bought)` probes, `led4In` (the Zikit, whose post #402 re-fitted on 6 Oct) descends from the breach,
  and `ledUZ3` (the Gunship) from Tel Marum III. Report both probes' use lines. Post the numbers with the
  request for confirmation.
- [ ] **Step 2: Write the failing tests:** a mission with one loaned and one open placement, both
  surviving: the produced `roster.surviving_units` contains the open one only; `startingHome` counts
  both (credits unchanged); a loaned unit killed in the mission is a loss in the debrief like any
  other. A third test, through `applyRosterCarryover` (`packages/app/src/roster-carryover.ts`): a loaned survivor
  of type T and a vacant slot of type T in `roster.lost` leave the slot vacant (no `replacements` row), and a
  replay of the lending mission replaces nothing it did not enlist. (An armed fixture with `role: 'infantry'` now kneels when idle, #402; it stands still and
  survives the same, and its roster entry carries no brace state.)
- [ ] **Step 3: Implement.** Using Task 6 Step 2b's record (`isOnLoan`), the runtime skips loaned
  ids in `checkEnd`'s roster write (mission.ts ~L1920-1939: the survivor loop over `playerIds`, before
  ~L1942's unfielded-pool append). Skip only the `roster.push(entry)`: leave `survivors.push` (it feeds
  `missionEnd.survivors`, which `main.ts` ~L516 prints as the survivor count) and the veterancy/`promotedValue`
  lines alone, and `startingHome` is untouched (credits). A loaned unit that earned a stripe loses it on return.
- [ ] **Step 4: Re-pin, if Step 1 said so.** Each moved `LADDER_CREDITS` (~L3431 on `f4b3ea2b`) /
  `GATES` (~L3121) / `ROSTER_MAX` (~L3566) pin, starting from main's current value, gets the
  house-style comment: the term, per mission,
  before and after, summing to the delta. A moved `LADDER_CREDITS` moves `CAMPAIGN_CREDITS` in the same
  commit, or `tools/src/campaign_credits.test.ts` goes red (GH-330).
- [ ] **Step 5: See it red.** Remove the skip: the roster test fails, listing the loaned unit.

---

## Task 8: "on loan" on the unit card and selection chip (Lane A)

**Model:** sonnet. **Agent:** lane A (`render-vfx` for styling questions). **Depends:** Task 6 (Step 2b's
`isOnLoan`).

**Ruled 6 Oct:** the mark goes on the in-mission unit card and the selection chip, and on the dock
tile if a loaned type appears there.

**Why not the deploy screen (6 Oct), and what #442 changed.** The lead's Q5 wording put the mark on the
deploy screen. On `b44df7aa` neither deploy surface had a row for a loaned unit, and `broughtFor`
(loading.ts ~L136) and `deploySpread` (~L240) still do not: they name only `from_ledger` draws and pool
entries. **Since #442 the Field order's `forceBar` (`ui/force-bar.ts`) draws a fixed card per non-ledger
placement** (`FieldOrder.attached`, built in `main.ts` ~L2143 from `resolvedMission`), noted "from brigade"
(`deploy.attached`). A loaned unit is on that card today. Whether to mark it there is Pre-flight Q4; until the
lead answers, this task builds the unit card and chip only, as ruled.

**Files:** `packages/app/src/ui/hud.ts` (the selection chips in `renderChips`, `chipArtHtml` ~L213, and the
single-unit card in `renderCard`); `ui/selection-model.ts` (`UnitFacts` and `ChipView` gain `onLoan`);
`ui/kit-sign.ts` only if the mark shares its host; `packages/app/src/i18n/en.json`;
`packages/app/src/ui/theme.css`. Tests: `hud.test.ts`, `kit-sign.test.ts`, `selection-model` spec. `HudDeps`
gains an optional `isOnLoan?: (id: number) => boolean` (the "no dep, no change" rule every optional dep
follows), fed from `MissionRuntime.isOnLoan` in `main.ts`. Side 0 only, as the kit sign is.

**The slots are mostly taken** (read off `hud.ts` and `theme.css` on `f2d5d9e8`): chip art top-right is the
kit sign (`.rl-chip__art + .rl-kit-icon`), chip art bottom-left is the status mark (`statusMarkHtml`: broken,
pinned, gun out, immobilised), the card frame's top-left is the role badge and its bottom-left the same status
mark. The chip's status line carries ONE combat state with a tone class, and `chip-status-cascade.test.ts`
guards that cascade: **the mark does not go on `.rl-chip__status`.** Start with the card-and-chip mock (Pre-flight Q5), then build.
Rules from #454 and #448: the stamp is a display-face element, so capitals come from CSS (VR-20) while the
catalogue string stays "On loan"; colour is neutral (`--ink-dim` on the panel), never `--on`, `--selected`,
`--info` or `--commend` (VR-25, VR-26); any padding or duration is a token (VR-29); `type-register.test.ts`
and `chrome-register.test.ts` read `theme.css` back off disk, so a raw size or colour fails them.

A chip groups by type: it carries the mark when ANY of its units is loaned (Pre-flight Q6), and the tooltip
says "N of M on loan" (a `{n}` plural key). en.json is flat dotted keys, so `hud.onLoan`, `hud.onLoan.tip`
and `hud.onLoan.some` coexist. The dock tile is never marked (Pre-flight Q7).

- [ ] **Step 1: Write the failing tests** (jsdom). On `wadi_halam_5_depot` with an empty ledger:
  - the D9's and the demolition squad's chips and unit cards carry the mark;
  - with a ledger that opens both gates, neither does;
  - the mark's text comes from `t('hud.onLoan')`, which the pseudo-locale renders bracketed;
  - a chip of two units of one type, one loaned, carries the mark and the "1 of 2" tooltip; a chip of
    enemy units never does;
  - a kitted, pinned, loaned unit's chip keeps all three marks (kit sign, status mark, loan stamp).
- [ ] **Step 2: Implement.**
  - A mark beside the unit name, with a tooltip.
  - The tooltip is `t('hud.onLoan.tip')` = "Issued for this mission. Returns to its unit
    afterwards." If L-1 is overruled, it is "Issued for this mission."
  - Semantic tokens only (`pnpm validate:ui`).
  - The mark is on the HUD and nowhere in the world (memory: no status marks in the world).
  - The mark is static (a fact about the unit, not a mission state), so it takes no `--dur-*` and no
    `data-motion` branch.
- [ ] **Step 3: Measure.** `pnpm validate:ui` is clean, and a pseudo capture of a mission with a
  loaned unit selected shows no unbracketed word.
- [ ] **Step 2c (only if Pre-flight Q4 is yes): the Field order card.** `forceBar`'s `fixedCard` note becomes
  `t('deploy.onLoan')` ("on loan") for a loaned placement and stays `deploy.attached` otherwise. The new
  `FieldOrder.attached` entry gains `onLoan: boolean`, computed in `main.ts` from `loanedPlacements` over the
  same `resolvedMission` the list is built from. Test: `wadi_halam_5_depot`, empty ledger: the D9 and the
  demolition squad cards say "on loan"; the `jeep_shoded` card (it resolves to the ungated jeep, Task 6's census)
  says "from brigade". Pseudo capture of the briefing.
- [ ] **Step 4: See it red.** Read the gate before `resolveUpgrades` in the view: the upgraded-unit
  test fails. Give `groupChips` an `all` instead of `any` rule: the mixed-chip test fails.

---

## Task 9: the feature, documented

**Model:** haiku. **Depends:** Tasks 6, 7.

**Files:** `docs/GDD.md` §6, `data/schemas/mission.schema.json` (`starting_force` description),
`CLAUDE.md` ("Known scaling debts", the `starting_force` paragraph), `docs/campaign/README.md`,
`docs/HANDOVER.md`.

- [ ] **Step 1:** The sentence in all four places: *"The issued force is the brigade's to lend. A
  placement may field a unit whose gate is closed; it is on loan for that mission, marked so on its
  unit card and selection chip, and returns afterwards. Gates govern what you build and what you upgrade to.
  Restraint shapes the issued force through `upgrades_to` and `gate_only` (lead, G3 Q5, 4 Oct)."*
  CLAUDE.md's "Whether that is a feature or a hole is undecided" becomes "decided 4 Oct: a feature".
  That paragraph (CLAUDE.md ~L2205 on `f2d5d9e8`) also quotes pre-WP-G-E1 floors, `dozer_d9` (ROE 60),
  `demo_squad` (ROE 50), `recon_drone` (35), `ifv_namer` (40); the unit JSON on `b44df7aa` reads 87, 77,
  70 and 85 (`data/units/kdf/*.json`, the `CONDUCT_GATES` table at playtest.ts ~L3007). Correct them in
  the same rewrite.
- [ ] **Step 2:** The population cap in GDD §3 and the campaign README: off in the campaign, on in
  skirmish and co-op through the doctrine, never equal across doctrines (G3 Q4/Q7).
- [ ] **Step 3:** `docs/HANDOVER.md` §1, §3 (D1–D5, L-1 as answered), §4.

---

## Re-pins (F5)

| pin | expected | the reason, for the commit |
|---|---|---|
| sim pins, flat, relief and orders (`determinism.test.ts` ~L488, ~L857, ~L977 on `f4b3ea2b`) | **unmoved** (R): main's current pins, read on the branch base | — |
| `ECONOMY_PIN`, `ECONOMY_PIN_RELIEF` | **re-pinned once**, Task 4 (born in F1; not in the tree on `b44df7aa`) | population and the cap are economy state (G3 Q4) |
| `pnpm balance` | byte-identical (R) | — |
| `pnpm playtest` | byte-identical through Task 6; Task 7 moves roster lines (L-1) | new census lines (Task 5) |
| `ROSTER_MAX` (`playtest.ts` ~L3566 on `f4b3ea2b`) | main's current pin, measured at `umm_zeitoun_4_clearance` (the garrison overhaul re-scripts that plan and re-pins it); may move in Task 7 (R) | "a loaned survivor returns to the lender (G3 Q5, L-1)" |
| `LADDER_CREDITS` (`playtest.ts` ~L3431) | main's current pin, whatever the garrison overhaul leaves it at; unchanged unless L-1's smaller pools change a later outcome (R: small, measured in Task 7 Step 1) | "a loaned survivor returns to the lender (G3 Q5, L-1)", per mission |
| `CAMPAIGN_CREDITS` (`stores-model.ts` L63) | equal to `LADDER_CREDITS` (GH-330, `campaign_credits.test.ts`); moves with it, same commit | as `LADDER_CREDITS` |

## Lane A needs (WP-S-F #184)

All of it in `packages/app`, none of it before Task 3's sim half. Every string through `t()`, every colour a
token, every new class pinned by the register specs (`chrome-register.test.ts`, `type-register.test.ts`);
`pnpm validate:ui` and a `?pseudo=1` capture are the gates.

- **Used/cap** beside the logistics counter in `hud.ts`'s strip, shown only when `populationView()` is not
  null (Q4: the HUD shows it when the cap is on). In the campaign it never appears. `MissionView` gains
  `population?: { used, cap }` (`main.ts` `getMission`, ~L2462). Same `--info` as logistics and intel (VR-25),
  a dim word (`hud.strip.population.word`), no new glyph, the `logistics` HUD-element visibility (no new
  `HudElement`, so tutorial JSON is untouched), a `data-tip="population"` case in the strip tooltip switch
  (~L1630). At the cap it takes the warn tone (`rl-warn`).
- **The refusal on the dock tile**: not a lock. `tileState` returns `lock` for any non-null
  `buildBlockedReason`, labelled `locked` and permanent-looking, so it gains a `capped` field from
  `popCapped(unit.id)` (Task 3), checked AFTER the lock (a campaign gate outranks the cap). A capped tile
  wears the one disabled treatment (`--disabled-opacity`, `not-allowed`, VR-27), a short label `dock.cap.short`,
  and a `title`/`aria-label` from `populationView()` through `t('dock.cap', { used, cap })`. The sim's English
  reason string is never shown. `refresh()` sets `data-capped`; `focusFirst` skips capped tiles as it skips
  locked and poor ones. A click on a capped tile notes `dock.note.capped` (tone `warn`), not
  `dock.note.cannotBuild` ("insufficient logistics").
- **A deny cue on the three dock refusals** (locked, capped, refused): `ProductionOptions.deny?: () => void`,
  wired in `main.ts` to `audio.playCue(CRITICAL_CUES.uiDeny)` as the order sink (~L3483) and the support
  refusal (~L3625) already are. Today none of the three sounds. Behaviour change, named in Pre-flight Q8.
- **No feed alert, no tier, no `cues.ts` row**: F3 adds no `MissionEvent` kind. A refused build is a
  `hud.note`.
- **"On loan"** on the unit card and selection chip (ruled 6 Oct): Task 8, if lane A was busy when F3
  landed. The deploy card and the dock tile follow Pre-flight Q4 and Q7.
