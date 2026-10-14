# Garrison overhaul (#280, #34, #588). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Men inside a building fight from its windows: they keep their nerve under fire, are hard to
spot, see and shoot from the footprint tile nearest the target, see further from upper floors, reach a
little further, and fill and free the building's slots correctly. Mortars do not fire from inside.

**Architecture:** Everything is in `@lions/sim` plus data. Two per-type structure fields
(`garrison_cover`, default 3; `floors`, default 1), one weapon field (`fires_from_building`, default
true) and one tuning constant (`GARRISON_RANGE_BONUS`). One new private helper, `eyePoint(i, tx, ty)`,
answers "where does unit `i` look and shoot from toward this point": its own position, or for a
garrisoned unit the centre of its building's footprint tile nearest the point. Every range, sight-line
and hit-factor site that today reads a garrisoned shooter's centroid reads `eyePoint` instead, and
`losRay`/`raySmoke` take two eye lifts so a floor adds height the way elevation does. The garrisoned
unit's POSITION does not move: it stays the centroid, where the renderer draws it and where incoming
near misses are measured to. No new hashed column.

**Tech stack:** TypeScript strict, vitest, Q16.16 (`@lions/sim/fixed`). No new dependencies.

**Spec:** none separate. This plan argues from (1) the lead's rulings of 2026-10-14, copied verbatim
below; (2) the garrison audit of 2026-10-14 (probe scripts `exp1`–`exp11`, `census.mts`,
`centroid.mts` in the session scratchpad `garrison-audit/`); (3) GH-280, GH-34 and GH-588; and (4) a
throwaway prototype of every ruling, measured stage by stage on 2026-10-14 (section "Measured"). The
prototype is not committed; its numbers are.

## Global Constraints

- The four invariants (CLAUDE.md): fixed 20 Hz tick; Q16.16 in `packages/sim`, no `Math.*`, no `Date.*`, no floats; randomness only via `rng(entityId)`; commands in, state and events out.
- No per-tick allocation in the sim; struct-of-arrays; TypeScript strict; no `any`; no non-null assertions in sim code; no `eslint-disable`.
- A new tuning constant lives in `packages/sim/src/tuning.ts` with a comment saying where its number came from.
- **Re-pins:** each determinism re-pin, each credit re-pin and each roster re-pin is its own commit with one reason.
- **`pnpm playtest` holds every plan, control and gate on 30 seeds.**
- **`pnpm balance` keeps every §5.7 target at base and at max tier.** Never retune tuning, missions or plans silently: if `balance` or `playtest` moves in a way this plan does not predict, stop and bring the diff to the lead.
- **Mission time limits (#585) must still clear the slowest wins** (`pnpm playtest`'s `time limit` lines, and `tools/src/validate_time_limit.test.ts`).
- Today's `main` (7646107c, 2026-10-14): determinism pins flat 916087385, relief 373999871, orders 1736634855; `LADDER_CREDITS` = `CAMPAIGN_CREDITS` = 6025; `ROSTER_MAX` 31. **Targeted fire (GH-420) moves the pins** (its branch reads flat 4215479769, relief 2842924511, orders 3272041047 at `8793f692`). **Re-read all five values at execution time; never copy them from this plan.**
- Every new check is seen RED by a one-line mutation of the implementation, then green; the commit message quotes the mutation and its red line.
- Gates before every commit: `pnpm lint && pnpm typecheck && pnpm test:determinism && pnpm test`, then `pnpm balance` and `pnpm playtest` compared to the outputs saved at the base (everything except wall-clock lines). Data tasks add `pnpm validate:data`.
- Commits: `/usr/bin/git commit -s -F <msgfile> -- <paths>`; never `git add -A`, never `git checkout -- <file>`, never rebase or force-push. The message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never run `pnpm ui:routes`, `pnpm golden-baseline` or `pnpm ui:shots` locally; CI runs them. Never `pkill`; never use port 5177.

## Review Focus

1. **Targeted fire from a building** (GH-420's `attack` never empties a building): an ordered target the garrison can reach only from its window, and only with the range bonus, is shot; a nearer decoy is not preferred over it. Test in Task 8.
2. **Garrison against garrison**: a garrisoned rifle squad fires at an enemy-held building it reaches only from its own window (`selectStructureTarget` and `fireAtStructure` read the window, not the centroid). Test in Task 4.
3. **A building on uneven ground**: the window tile's own elevation is the eye's ground, not the centroid tile's. A long building whose east end stands two levels up sees over a block from that end and not from its west end, which stands on the ground. Test in Task 4.
4. **The overflow unit when its building falls**: a unit waiting at the door (B3) of a building that collapses is neither killed nor left with a dead order; it stands, alive, `moving` 0, and takes the next order. Test in Task 1.
5. **A mission `remove` trigger on a garrisoned unit** (`removeFromPlay`, B5) frees the slot inside the same tick, so a garrison order queued that tick for another unit is accepted. Test in Task 1.

---

## The lead's rulings (2026-10-14), verbatim

1. **Cover inside (B1, #280):** units inside a building get full building cover for suppression. Add a per-structure-type `garrison_cover` field (default 3) and read it for a garrisoned unit wherever cover is read for suppression.
2. **Window, not centroid (G1, and B6):** garrison range and line of sight are measured from the building's footprint tile nearest the target. This also fixes the two khan_rafid_3 shanties whose centroid falls outside their own footprint.
3. **Height per floor (G3):** a per-type `floors` value (data). Each floor above ground adds to eye height for line of sight, the way elevation does, so taller buildings see over obstacles. Propose the floor values per type (apartment, warehouse, hall, house, shanty, ...) for the lead to approve.
4. **Extra range from inside:** a flat bonus on top of the window rule. Propose the value (+1 or +2 tiles), MEASURED: show the urban 2:1/3:1 §5.7 targets and the playtest for each candidate. Pick the smaller value if both pass. Put the table in the plan for the lead to approve.
5. **Harder to spot (G2):** detection of a garrisoned unit reads the building's garrison cover, as cover 3 does in the open.
6. **Mortar no, Spike yes (G4):** a mortar team (indirect) cannot fire while garrisoned; a Spike can. Use a weapon or class flag in data, checked in stepCombat. Name the flag.
7. **Capacity numbers stay.** Fix bugs B3 and B5: B3: overflow units wait without firing. When the building is full and they are in range, set moving=0 and keep the goal. B5: freeing a slot on removeFromPlay or destroy.
8. **B2 (data):** 8 sarim_rifles garrison placements in 6 missions never garrison, because sarim_rifles lacks the ability. Give sarim_rifles the `garrison` ability, which matches the authors' intent, and add a validate_data rule that a garrison stance needs a unit with the ability.

| ruling | task | the name it gets in code |
|---|---|---|
| 7 (B3, B5) | Task 1 | `releaseSlot`, `stepGarrison`'s door halt |
| 1 (B1) | Task 2 | `garrison_cover` / `StructureType.garrisonCover` |
| 5 (G2) | Task 3 | `detectionPair` reads `garrisonCover` |
| 2 (G1, B6) | Task 4 | `eyePoint`, `eyeX`/`eyeY`, `engageable(shooter, w, t)` |
| 3 (G3) | Task 5 | `floors` / `StructureType.floors`, `eyeLift`, `losRay(…, lift0, lift1)` |
| 6 (G4) | Task 6 | **`fires_from_building`** (weapon) / `WeaponStats.firesFromBuilding` |
| 8 (B2) | Task 7 | `tools/validate_garrison.mjs` `garrisonStanceFailures` |
| 4 | Task 8 | `GARRISON_RANGE_BONUS`, `WeaponStats.garrisonRangeSq`/`garrisonEffRange`/`garrisonEffRangeSq` |
| all | Tasks 9–11 | the playtest carry (L-3), the re-pins, the record |

## Base

- **`main` after `feat/targeted-fire` (GH-420) has merged.** This plan edits the code that branch
  introduced (`engageable`, `selectTarget`'s focus preference, `focusInReach`, `focusHurts`,
  `couldEngage`/`canFocus`). If GH-420 has not merged, stop: do not start this on `main`.
- Branch `feat/garrison-overhaul`, worktree `/Users/ilpinto/dev/roaring-lions-ep/garrison-overhaul`,
  `pnpm install` once.
- Locate code by symbol; line numbers drift. In `sim.ts` on `feat/targeted-fire` `8793f692`:
  `removeFromPlay` L1867, `raySmoke` L2753, `losRay` L2801, `detectionPair` L2911, `projectHit`
  L3023, `engageable` L3551, `selectTarget` L3574, `selectStructureTarget` L3629, `stepCombat`
  L3934, `hitFactors` L4245, `fireAt` L4288, `fireAtStructure` L4372, `applySuppression` L4778,
  `enterStructure` L4911, `stepGarrison` L5184, `destroy` L5523, `focusInReach` L5719, `canFocus`
  L5888, `focusHurts` L5930, `couldEngage` L5947.
- **The tests in this plan were run.** Assembled from the task blocks and run on the main-based
  prototype: 25 of 25 pass with every ruling on, and 14 fail with every ruling off (the 11 that pass
  are the control arms, plus floors tests that need Task 4's window before they can fail). Two tests
  use GH-420's API (`canFocus` in Task 6, the `attack` command in Task 8) and have not run: the
  prototype predates the merge. `garrison-probes.ts` (Task 11) was run too, and reproduces the
  scratch probes' numbers to the digit on both trees.
- **Pre-flight (Task 0, before Task 1):** on the new branch run `pnpm test:determinism`, `pnpm balance`
  and `pnpm playtest`, save the outputs as `balance-base.txt` / `playtest-base.txt` in the scratch
  folder, and read the three pins, `LADDER_CREDITS` (`tools/src/backtest/playtest.ts`),
  `CAMPAIGN_CREDITS` (`packages/app/src/ui/stores-model.ts`) and `ROSTER_MAX` (`playtest.ts`). Write
  them at the top of the ledger. Every "unchanged" in this plan means "equal to those".
- **Lead decisions L-1 to L-5 were ruled on 2026-10-14** (section "The lead's rulings on PR #590"
  below). L-1 fills Task 5's data, L-2 fills Task 8's constant, and L-3 decides what Task 9 is.

---

## What the audit measured (main 7646107c, 2026-10-14)

Probe scripts: scratchpad `garrison-audit/` (`exp1`–`exp11`, `census.mts`, `centroid.mts`), run with
`TREE=<worktree>`. Every number below was re-run for this plan on `main` 7646107c.

- **B1 (#280), the near miss pins the garrison.** `exp4`: 8 `militia_cell` attack-move on two
  `inf_squad` in a 2×2 house (20 seeds × 120 s). Defenders pinned **90%** of the time, **13** shots
  fired, **0.00** militia killed. In the open on cover 3 the same squads fire 436 shots. Cause: a round
  that misses a building lands on its nearest footprint tile, 0.71 tiles from a 2×2 house's centroid,
  inside the 1.2-tile near-miss radius (`NEAR_MISS_RADIUS_SQ`; GH-280 says 1.095, an older value),
  and the garrison reads the cover of the tile under its centroid, which is 0.
- **B2, eight placements never get in.** `census.mts`: 28 garrison-stance placements, 8 by
  `sarim_rifles`, which has no `garrison` ability (qarn_hadid_2, qarn_hadid_3 ×2, umm_zeitoun_1,
  umm_zeitoun_2, umm_zeitoun_3 ×2, umm_zeitoun_4). `exp6`: 22 of 30 garrison-stance bodies inside at
  20 s; three of the eight stand on their building's own blocked tile, cover 0.
- **B3, overflow waits and never fires.** `exp5`: ordered 3 squads into a shanty (1 slot), 4 into a
  house (2), 6 into an apartment (4): every unit left outside has `moving` 1, `brace` 0, presses on
  the wall, and fires **0** shots in 20 s at a dummy in range (those inside fire 94–316).
- **B5, a dead occupant keeps its slot.** `exp5b`: after `debugKill` or `removeFromPlay` of one of two
  occupants, `occupants` stays 2 and the unit waiting at the door never enters (a `move` out frees it
  in 1 tick).
- **B6, two centroids off their own footprint.** `centroid.mts`: 531 garrisonable instances on the
  shipped maps; 2 have their centroid on open ground, both shanties on `khan_rafid_3` (17 tiles at
  (20.26, 13.56), 22 tiles at (29.95, 23.32)). Their garrison stands outside and its own walls block
  its sight (`exp11`).
- **G1, fire from the centroid.** `exp1`: a garrisoned unit fires exactly as the same unit standing at
  the centroid in the open (identical shot counts in all ten building types). Centroid to nearest
  non-footprint tile: house median 1.58 tiles, max 2.55; warehouse max 2.90.
- **G2, as visible as in the open.** `exp10`: a watcher at 7 tiles identifies a garrisoned squad in
  **99** ticks, the same as cover 0 in the open (cover 3: 284).
- **G3, height is presentation only.** `exp3`: an apartment (`height_px` 30) with a 1×1 shed on the
  line is as blind as a shanty or a man in the open; only raising its ground by 2 elevation levels
  lets it see.
- **G4, a mortar fires from inside.** `exp1`: `mortar_team` garrisoned fires its `mortar_60` exactly
  as in the open; so does `at_team`'s Spike.
- **Capacity numbers differ and are enforced** (GH-588 item 4): `garrison_slots` 1 (shanty, pump
  house), 2 (house, concrete, clinic, relay), 3 (warehouse, hall, camp), 4 (apartment); `exp5`
  confirms the cap. Ruling 7 keeps them.

## Measured: the overhaul, prototyped and run stage by stage (2026-10-14)

A throwaway worktree on `main` 7646107c carried every ruling behind a per-ruling switch, with the
range bonus at 0, 1 and 2 tiles. Each row adds one ruling to the row above (this plan's task order)
and runs `pnpm test:determinism` and `pnpm playtest` (30 seeds). It is a main-based prototype, so its
pin values are not this plan's; which task moves a pin, and which missions move, is what carries over.

| stage (cumulative) | determinism pins | playtest | credits (6025) | roster max (31) |
|---|---|---|---|---|
| main / switches off | unchanged | byte-identical | 6025 | 31 |
| + B5, B3 (Task 1) | unchanged | **byte-identical** | 6025 | 31 |
| + B1 (Task 2) | unchanged | WH4 9/30 (and gate open 9/30), DA2 29/30, DA2 gate open 10/30 (0★); `scout_shachaf` and `apc_kipod` gates miss | 5965 | 31 |
| + G2 (Task 3) | unchanged | WH4 12/30; KR3 29/30 (four variants); DA2 29/30; DA2 gate open 10/30 | 5965 | 31 |
| + G1 (Task 4) | **flat moves** (relief, orders unchanged) | WH4 2/30 (0★, max tier 0★, time limit 840 s does not clear its slowest win 800 s); DA2 gate open 7/30 | 5765 | 31 |
| + G3 (Task 5) | unchanged from the row above | WH4 4/30 (time limit, 820 s); DA2 gate open 7/30 | 5765 | 31 |
| + G4 (Task 6) | unchanged | byte-identical to the row above | 5765 | 31 |
| + B2 (Task 7) | unchanged | + UZ3 26/30 (and gate open); UZ4 11/30 (0★), UZ4 bought 10/30, UZ4 max tier 0★; `apc_kipod` gate misses | **5399** | **24** |
| + range bonus +1 (Task 8) | unchanged | WH4 1/30 (and WH4 max tier 0★); DA2 gate open 9/30; UZ4 10/30 | 5359 | 24 |

WH4 = `wadi_halam_4_village`, DA2 = `deir_amun_2_foothold`, KR3 = `khan_rafid_3_clearance`,
UZ3/UZ4 = `umm_zeitoun_3_clearance`/`umm_zeitoun_4_clearance`. Every other plan, control and gate
held 30/30. `pnpm balance` was byte-identical to main in every row (see the range table).

**What it says.** Task 1 moves nothing outside its own tests; Tasks 5 and 6 add no failing row;
Task 3 adds one (KR3, 29 of 30). Task 2 (cover inside) is the ruling that
turns the garrisons on: the scripted plans that level a garrisoned house by gunfire from two or three
tiles (WH4's own comment: "measured 17 hp/s into a 3,120 hp house") now take return fire from men
who are no longer pinned by the misses. Task 4 (the window) makes that worse for WH4. Task 7 puts
eight Sarim rifle squads inside, and UZ4's stockpile garrison then shoots the sappers its `raze`
primary needs. These are the outcomes the rulings asked for, but each one is a mission or a plan
that no longer wins, so **L-3 below decides what changes**.

### The extra range, measured (ruling 4)

Same prototype, every ruling on, `GARRISON_RANGE_BONUS` 0 / 1 / 2 tiles (applied to maximum and
effective range, not to sight, not to minimum range).

| candidate | §5.7 urban, base: 1:1 / 2:1 / 3:1 / 4:1 (2:1+smoke) | §5.7 urban, max tier | playtest rows that fail | credits | garrisoned-urban probe: rifle squads lost at 1:1 / 2:1 / 3:1 / 4:1 (wins) | #280 raid probe: militia killed by 2 squads in a 2×2 house |
|---|---|---|---|---|---|---|
| main (no overhaul) | 0 / 22 / 100 / 100 % (98 %) | 0 / 22 / 100 / 100 % (98 %) | none | 6025 | 1.4 / 1.6 / 0.0 / 0.1 (0 of 20 at every ratio) | 0.00 |
| overhaul, +0 | identical to main | identical to main | WH4 4/30 ×2, DA2 gate open 7/30, UZ3 26/30 ×2, UZ4 11/30, UZ4 bought 10/30, UZ4 max tier, WH4 time limit, `apc_kipod` gate | 5399 | 1.7 / 1.1 / 0.5 / 0.5 (0) | 0.25 |
| overhaul, **+1** | identical to main | identical to main | the +0 rows, with WH4 1/30 ×2, DA2 gate open 9/30, UZ4 10/30; **plus WH4 max tier** | 5359 | 3.0 / 2.9 / 2.5 / 2.2 (0) | 0.95 |
| overhaul, +2 | identical to main | identical to main | the +1 rows, with WH4 0/30 ×2, DA2 gate open 6/30, UZ4 5/30, UZ4 bought 6/30; **plus WH5 29/30, BS4 29/30, BS4 bought (its `recon_zikit` dies), `breach_team` and `scout_shachaf` gates** | 5369 | 3.6 / 6.2 / 7.0 / 5.5 (0) | 1.70 |

Three things to read off it.

- **The §5.7 urban target cannot see a garrison.** `urbanAssault` (`tools/src/backtest/targets.ts`)
  builds its three town blocks with `setBlocked` and puts the six militia on cover-2 tiles around
  them: there is no structure and nobody is inside anything. Its comment says "Militia garrisoned in
  heavy cover"; the code does not garrison. So `pnpm balance` is byte-identical for every candidate,
  and a pass there says nothing about this plan. It is still run (Task 11) because it guards the rest
  of the model.
- **A garrisoned version of that same town has no winning ratio, even today.** The report-only probe
  Task 11 commits (`tools/src/backtest/garrison-probes.ts`, the same 40×28 town with the three blocks
  as real 4×3 houses, two militia inside each, rifle squads plus one `demo_squad` per group) wins
  **0 of 20** at 1:1 through 4:1 on `main` and on every candidate. A garrison dies only with its
  building, and rifles do 0.01× damage to masonry. So the §5.7 "≈3:1 for reliable success" has no
  garrison doctrine to protect yet (L-4).
- **+1 against +2.** Neither candidate passes the playtest, because the overhaul at +0 already fails
  it. Of the two, +1 adds one failing row of its own (WH4 at max tier) and +2 adds six, including
  two missions (WH5, BS4) and two unlock gates the overhaul alone leaves green. **Recommendation:
  +1** (the smaller value, and the cheaper of the two by every row), conditional on L-3.

### The floors table (ruling 3), proposed

Derived, not picked: the renderer draws a structure `height_px` tall and an elevation level 10 px
(`ELEV_STEP`), so `floors = round(height_px / 10)`, at least 1. Sight and drawing then agree, which is
what the elevation milestone was for (`BLOCK_RISE`'s comment in `sim.ts`). A garrisoned unit's eye
stands `EYE_HEIGHT + (floors − 1)` levels above its window tile's ground; every blocked tile stands
`BLOCK_RISE` = 2 above its own.

| type | `height_px` | px / 10 | proposed `floors` | eye lift | instances on shipped maps | on flat ground, it sees over a building on the line… |
|---|---|---|---|---|---|---|
| shanty | 11 | 1.1 | **1** | 0 | 262 | never (as today) |
| pump_house | 11 | 1.1 | **1** | 0 | 6 | never |
| house | 16 | 1.6 | **2** | +1 | 170 | never; it sees over a one-level rise of ground |
| clinic | 16 | 1.6 | **2** | +1 | 6 | never; a one-level rise |
| concrete | 20 | 2.0 | **2** | +1 | 17 | never; a one-level rise |
| relay | 20 | 2.0 | **2** | +1 | 2 | never; a one-level rise |
| camp | 20 | 2.0 | **2** | +1 | 0 | never; a one-level rise |
| warehouse | 22 | 2.2 | **2** | +1 | 40 | never; a one-level rise (alternative: 1, a single tall storey) |
| hall | 22 | 2.2 | **2** | +1 | 9 | never; a one-level rise |
| apartment | 30 | 3.0 | **3** | +2 | 19 | in the nearer half of the line |
| wall, fence | 7 | — | not garrisonable, field omitted | — | 1,193 | — |

Why "nearer half": against a target standing in the open (eye 1), an obstacle `BLOCK_RISE` tall at
fraction `k/T` along the ray blocks when `2 > h0 − (h0 − 1)·k/T`, that is when
`k/T > (h0 − 2)/(h0 − 1)`. Two floors (h0 = 2): every obstacle blocks. Three floors (h0 = 3): only
those past halfway. Four (h0 = 4): only those past two-thirds. So an apartment sees over the
building across the street and still not into the dead ground behind a wall beside its target, and
anything it sees over, sees it (the lift is applied at whichever end of the ray is garrisoned).

## Lead decisions before Task 1

- **L-1, floors.** Approve the table above (recommended), or name other values. Warehouse 2 or 1 is
  the only one argued both ways.
- **L-2, the extra range.** +1 tile (recommended) or +2, on maximum and effective range. Sight is not
  extended: a squad with sight 8 and rifle range 8+1 uses the extra tile only on a target a friend
  has identified (option: the same bonus on `sight_tiles` for garrisoned units, unmeasured).
- **L-3, the plans and missions that stop winning.** The measured rows above (WH4, DA2 gate open,
  KR3, UZ3, UZ4, the WH4 time limit, three unlock gates downstream of stars, credits 6025 → 5359,
  roster 31 → 24). Options, cheapest first:
  - **(a) The plans change, the missions do not.** Rewrite the scripted plans in
    `tools/src/backtest/playtest.ts` for those missions to fight a garrison that shoots back: stand
    off outside its reach and use what hurts masonry from there (the IFV's autocannon, the Lavi, a
    mortar, a D9's blade, smoke on the window before the sapper goes in). This is the doctrine a
    player now needs, so the plans are where it belongs. Re-pin credits and roster after.
  - **(b) The missions change.** Where (a) cannot carry a plan inside its time limit: lighter
    garrisons (WH4's three `rpg_team` houses, UZ4's stockpile garrison), a longer `raze` deadline,
    or an extra demolisher in the starting force (mission-author work; narrative untouched).
  - **(c) The rulings soften.** For example `garrison_cover` 2 on `shanty`, `pump_house` and `house`
    (breeze block and a family house are not a bunker). Measured nothing yet; would be measured the
    same way before choosing.
  Recommendation: (a) mission by mission, (b) only where (a) fails, (c) only if (a) and (b) both fail
  for a mission. Task 9 is written for (a).
- **L-4, a garrison row for §5.7.** The urban target never garrisons anybody. Keep it as it is and
  carry the garrisoned-urban probe as a report-only line (recommended for this plan), or open a
  design task for a garrisoned §5.7 target with a doctrine that can win it (a force and a ratio for
  clearing a held block in 5 minutes).
- **L-5, the presentation.** Out of this plan (see "Out of scope"): the range ring of a selected
  garrisoned unit (GH-34 item 3) and the flag on a held building (GH-588 item 1) both need a mock
  first.

### The lead's rulings on PR #590

- **Ruling (lead, 2026-10-14), L-1:** the floors table is approved as proposed, with warehouse = 2.
  Task 5 writes exactly: shanty 1, pump_house 1, house 2, clinic 2, concrete 2, relay 2, camp 2,
  warehouse 2, hall 2, apartment 3; no `floors` on wall or fence.
- **Ruling (lead, 2026-10-14), L-2:** +1 tile, on maximum and effective range; sight unchanged.
  Task 8's `GARRISON_RANGE_BONUS` is 65536.
- **Ruling (lead, 2026-10-14), L-3:** option (a) first: rewrite the scripted plans to fight
  garrisons properly. Only where a plan cannot win inside the mission's time limit, ease that
  mission's data. Each such mission change goes to the lead for approval before it lands, so
  Task 9 stops and reports per mission. Option (c) is not on the table.
- **Ruling (lead, 2026-10-14), L-4:** keep §5.7 as it is. The garrisoned-urban probe is carried as a
  report-only line (Task 11's `garrison-probes.ts`), not a gate.
- **Ruling (lead, 2026-10-14), L-5:** the held-building flag is decided: a facade banner, built
  separately on `render/garrison-banner`. This plan does not touch it. The range ring of a selected
  garrisoned unit stays out of scope.
- **The prototype.** Its diff is saved at `/Users/ilpinto/dev/roaring-lions-ep/_coord/garrison-proto/`
  (`proto.diff`, and `untracked.tar` for its new files: the draft `garrison.test.ts`, the assembled
  `garrison-plan.test.ts` and `garrison-probes.ts`). Its worktree has been removed. The diff carries
  the per-ruling `PROTO_ON` switches, which exist only to measure; none of them belongs in the sim.

---

## File structure

| file | responsibility | tasks |
|---|---|---|
| `packages/sim/src/sim.ts` | the rulings: `releaseSlot`, door halt, garrison cover in suppression and detection, `eyePoint`/`eyeLift`, `losRay`/`raySmoke` lifts, `fires_from_building`, range bonus | 1–6, 8 |
| `packages/sim/src/structures.ts` | `garrison_cover`, `floors` on `StructureTypeJson`/`StructureType` | 2, 5 |
| `packages/sim/src/tuning.ts` | `GARRISON_RANGE_BONUS` | 8 |
| `packages/sim/src/garrison.test.ts` (new) | every ruling's behaviour test, one `describe` per ruling | 1–6, 8 |
| `packages/sim/src/determinism.test.ts` | the flat pin (Task 4's re-pin commit) | 4 |
| `data/schemas/structure.schema.json` | `garrison_cover`, `floors` | 2, 5 |
| `data/structures.json` | `floors` per type (L-1) | 5 |
| `data/schemas/unit.schema.json` | `fires_from_building` on a weapon | 6 |
| `data/units/kdf/mortar_team.json` | `mortar_60` `"fires_from_building": false` | 6 |
| `data/units/enemy/sarim_rifles.json` | `"abilities": ["garrison"]` | 7 |
| `tools/validate_garrison.mjs` (new) | `garrisonStanceFailures`, `garrisonWeaponFailures` | 6, 7 |
| `tools/validate_data.mjs` | calls the two | 6, 7 |
| `tools/src/validate_garrison.test.ts` (new) | fixture and shipped-data tests for the two | 6, 7 |
| `packages/render/src/vfx/power.test.ts` | its hand-built `WeaponStats` gains the new fields (tsc) | 6, 8 |
| `tools/src/backtest/playtest.ts` | L-3 (a) plan changes; the credit and roster pins | 9, 10 |
| `packages/app/src/ui/stores-model.ts` | `CAMPAIGN_CREDITS` (with `LADDER_CREDITS`) | 10 |
| `tools/src/backtest/garrison-probes.ts` (new) | report-only: the #280 raid table and the garrisoned-urban table | 11 |
| `CLAUDE.md` | the garrison rules, one bullet | 11 |

---

### Task 1: Capacity: a dead or removed occupant frees its slot, and overflow waits at the door and fights (B5, B3)

**Files:**
- Modify: `packages/sim/src/sim.ts` (`destroy`, `removeFromPlay`, new `releaseSlot` beside `leaveStructure`, `stepGarrison`)
- Create: `packages/sim/src/garrison.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `private releaseSlot(id: number): void`. The test file's helpers `world()`, `rect()`, `run()`, `garrison()`, and the fixtures `HOUSE`, `SHED`, `BLOCK`, `RIFLE_WEAPON`, `RIFLES`, `DUMMY`, which every later task's tests reuse.

Measured on the prototype: playtest byte-identical, all three pins unchanged.

- [ ] **Step 1: Write the failing tests**

Create `packages/sim/src/garrison.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

// The garrison overhaul (GH-280, GH-34, GH-588; lead rulings 2026-10-14).
// docs/superpowers/plans/2026-10-14-garrison-overhaul.md

const HOUSE = { id: 'g_house', name: 'House', hp_per_tile: 260, garrison_slots: 2, rubble_cover: 2 };
const SHED = { id: 'g_shed', name: 'Shed', hp_per_tile: 120, garrison_slots: 1, rubble_cover: 1 };
/** Blocks sight and movement, holds nobody: the obstacle in the sight tests. */
const BLOCK = { id: 'g_block', name: 'Block', hp_per_tile: 900, garrison_slots: 0, rubble_cover: 1 };

const RIFLE_WEAPON = {
  id: 'rifles', type: 'small_arms', range_tiles: 8, effective_range_tiles: 6.4, accuracy: 0.6,
  penetration: 8, damage: 15, suppression: 50, rof_per_min: 300,
};
const RIFLES: UnitTypeJson = {
  id: 'g_rifles', role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 10, signature: 0.6 },
  abilities: ['garrison'],
  weapons: [RIFLE_WEAPON],
};
/** Never dies in a test's length, never shoots back. */
const DUMMY: UnitTypeJson = {
  id: 'g_dummy', role: 'infantry',
  hull: { hp: 30000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 1, sight_tiles: 1, signature: 1 },
};

function rect(sim: Sim, typeIdx: number, x: number, y: number, w: number, h: number): number {
  const tiles: number[] = [];
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) tiles.push(ty * sim.width + tx);
  return sim.addStructure(typeIdx, tiles);
}

function run(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

/** Order `id` into `s` and tick until it is inside. Throws if it never gets in. */
function garrison(sim: Sim, id: number, s: number): void {
  sim.queueCommand({ kind: 'garrison', ids: [id], structure: s });
  for (let k = 0; k < 400; k++) {
    sim.tick();
    if (sim.state.garrisonedIn[id] === s) return;
  }
  throw new Error(`unit ${id} never got into structure ${s}`);
}

function world(seed = 7) {
  const sim = new Sim({ seed, width: 48, height: 32, capacity: 32 });
  const house = sim.addStructureType(HOUSE);
  const shed = sim.addStructureType(SHED);
  const block = sim.addStructureType(BLOCK);
  const rifles = sim.addUnitType(RIFLES);
  const dummy = sim.addUnitType(DUMMY);
  return { sim, t: { house, shed, block }, u: { rifles, dummy } };
}

describe('capacity (B5, B3)', () => {
  for (const how of ['debugKill', 'removeFromPlay'] as const) {
    it(`${how} frees the slot, and the unit waiting at the door walks in`, () => {
      const { sim, t, u } = world();
      const house = rect(sim, t.house, 20, 14, 2, 2);
      const ids = [0, 1, 2].map((k) => sim.spawn(u.rifles, 0, fx.from(17.5), fx.from(12.5 + k)));
      sim.queueCommand({ kind: 'garrison', ids, structure: house });
      run(sim, 200);
      const inside = ids.filter((i) => sim.state.garrisonedIn[i] === house);
      const waiter = ids.find((i) => sim.state.garrisonedIn[i] !== house) ?? -1;
      expect(inside).toHaveLength(2);
      expect(waiter).toBeGreaterThanOrEqual(0);
      if (how === 'debugKill') sim.debugKill(inside[0]);
      else sim.removeFromPlay(inside[0]);
      expect(sim.structures.occupants[house]).toBe(1);
      expect(sim.state.garrisonedIn[inside[0]]).toBe(-1);
      run(sim, 5);
      expect(sim.state.garrisonedIn[waiter]).toBe(house);
      expect(sim.structures.occupants[house]).toBe(2);
    });
  }

  it('a slot freed by a mission removal is free the same tick (Review Focus 5)', () => {
    const { sim, t, u } = world();
    const shed = rect(sim, t.shed, 20, 14, 1, 1);
    const a = sim.spawn(u.rifles, 1, fx.from(19.5), fx.from(14.5));
    garrison(sim, a, shed);
    const b = sim.spawn(u.rifles, 1, fx.from(19.5), fx.from(13.5));
    sim.removeFromPlay(a);
    expect(sim.garrisonFree(shed)).toBe(1);
    sim.queueCommand({ kind: 'garrison', ids: [b], structure: shed });
    run(sim, 3);
    expect(sim.state.garrisonedIn[b]).toBe(shed);
  });

  it('a unit that finds the building full stops at the door and fights from there', () => {
    const { sim, t, u } = world();
    const shed = rect(sim, t.shed, 20, 14, 1, 1);
    const ids = [0, 1, 2].map((k) => sim.spawn(u.rifles, 0, fx.from(17.5), fx.from(12.5 + k)));
    sim.queueCommand({ kind: 'garrison', ids, structure: shed });
    run(sim, 200);
    const out = ids.filter((i) => sim.state.garrisonedIn[i] !== shed);
    expect(out).toHaveLength(2);
    for (const i of out) expect(sim.state.moving[i]).toBe(0);
    // Due north of the door, so the shed itself is never on the line.
    const target = sim.spawn(u.dummy, 1, fx.from(19.5), fx.from(7.5));
    const events = run(sim, 20 * TICKS_PER_SECOND);
    expect(sim.state.alive[target]).toBe(1);
    for (const i of out) {
      expect(events.some((e) => e.kind === 'fire' && e.shooter === i && e.target === target)).toBe(true);
    }
  });

  it('a waiter whose building falls stays alive and takes the next order (Review Focus 4)', () => {
    const { sim, t, u } = world();
    const shed = rect(sim, t.shed, 20, 14, 1, 1);
    const ids = [0, 1].map((k) => sim.spawn(u.rifles, 0, fx.from(17.5), fx.from(12.5 + k)));
    sim.queueCommand({ kind: 'garrison', ids, structure: shed });
    run(sim, 200);
    const waiter = ids.find((i) => sim.state.garrisonedIn[i] !== shed) ?? -1;
    expect(waiter).toBeGreaterThanOrEqual(0);
    sim.debugDestroyStructure(shed);
    run(sim, 20);
    expect(sim.state.alive[waiter]).toBe(1);
    expect(sim.state.moving[waiter]).toBe(0);
    sim.queueCommand({ kind: 'move', ids: [waiter], x: fx.from(10.5), y: fx.from(10.5) });
    run(sim, 2);
    expect(sim.state.moving[waiter]).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/sim/src/garrison.test.ts`
Expected: FAIL. `debugKill …` and `removeFromPlay …` fail on `expected 2 to be 1` (occupants); the
same-tick removal fails on `garrisonFree` (expected 1, received 0); the door test fails on `moving`
(expected 0, received 1). The collapse test may already pass (the shed's collapse clears the goal);
it is a guard for Step 3.

- [ ] **Step 3: Implement**

In `sim.ts`, add beside `leaveStructure`:

```ts
  /**
   * Free the slot of a unit that dies or is removed inside a building (B5,
   * ruling 2026-10-14). `stOccupants` is the count of LIVING units with
   * `garrisonedIn === s`; before this a body kept its slot until the
   * building fell, so the man waiting at the door never got in. No exit move
   * and no `garrison` event: nobody walked out. Clearing `garrisonedIn` is
   * what destroyStructure already does for the men it kills.
   */
  private releaseSlot(id: number): void {
    const s = this.garrisonedIn[id];
    if (s < 0) return;
    this.garrisonedIn[id] = -1;
    if (this.stOccupants[s] > 0) this.stOccupants[s]--;
  }
```

In `removeFromPlay`, after `this.removed[id] = 1;`:

```ts
    this.releaseSlot(id);
```

In `destroy`, after `this.alive[target] = 0;`:

```ts
    this.releaseSlot(target);
```

In `stepGarrison`, replace

```ts
      if (this.stOccupants[s] >= type.garrisonSlots) continue; // wait outside
      if (this.structDistSq(s, this.posX[i], this.posY[i]) <= GARRISON_ENTER_RANGE_SQ) {
        this.enterStructure(i, s);
      }
```

with

```ts
      const atDoor = this.structDistSq(s, this.posX[i], this.posY[i]) <= GARRISON_ENTER_RANGE_SQ;
      if (this.stOccupants[s] >= type.garrisonSlots) {
        // Full: wait at the door, stopped, with the order kept (B3, ruling
        // 2026-10-14). A unit left `moving` pressed on the wall for good --
        // a halt-to-fire man never knelt, so never fired. Stopped, stepBrace
        // kneels him and stepCombat lets him shoot; this loop still runs
        // every tick, so he walks in the tick a slot frees.
        if (atDoor && this.moving[i] === 1) {
          this.moving[i] = 0;
          this.fieldRef[i] = -1;
        }
        continue;
      }
      if (atDoor) this.enterStructure(i, s);
```

- [ ] **Step 4: Run the tests to verify they pass, then see each go red**

Run: `npx vitest run packages/sim/src/garrison.test.ts` → PASS.
Mutations (one at a time, run, see red, undo by editing):
- delete `this.releaseSlot(target);` in `destroy` → the `debugKill` test red (`expected 2 to be 1`);
- delete `this.releaseSlot(id);` in `removeFromPlay` → the two removal tests red;
- change `if (atDoor && this.moving[i] === 1)` to `if (false)` → the door test red (`moving` 1).

- [ ] **Step 5: Run every gate**

Run: `pnpm lint && pnpm typecheck && pnpm test:determinism && pnpm test && pnpm balance && pnpm playtest`
Expected: all green; determinism pins unchanged; `balance` and `playtest` byte-identical to the base
files apart from wall-clock lines. If not, stop.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git commit -s -F <msgfile> -- packages/sim/src/sim.ts packages/sim/src/garrison.test.ts
```

Message: `sim: a dead or removed occupant frees its slot; overflow waits at the door and fights (B5, B3; #588)`, the three mutations and their red lines, and the trailer.

---

### Task 2: A garrison takes its building's cover against suppression (B1, #280)

**Files:**
- Modify: `data/schemas/structure.schema.json`, `packages/sim/src/structures.ts`, `packages/sim/src/sim.ts` (`applySuppression`)
- Test: `packages/sim/src/garrison.test.ts`

**Interfaces:**
- Consumes: Task 1's test helpers.
- Produces: `StructureTypeJson.garrison_cover?: number`; `StructureType.garrisonCover: number` (default 3).

Measured on the prototype: pins unchanged; **playtest moves** (the "+ B1" row). This task's playtest
gate is the first one L-3 governs; see Task 9 before committing.

- [ ] **Step 1: Write the failing test** (append to `garrison.test.ts`)

```ts
describe('a garrison takes full building cover against suppression (B1, GH-280)', () => {
  // Three rifle squads fire at a house holding one man. A round that misses a
  // building lands on its nearest footprint tile, 0.71 tiles from a 2x2
  // house's centroid -- inside the near-miss radius -- so every miss is a near
  // miss on the man inside. The two arms differ only in garrison_cover.
  function pinnedTicks(garrisonCover: number | undefined): number {
    const sim = new Sim({ seed: 11, width: 48, height: 32, capacity: 16 });
    const type = sim.addStructureType(
      garrisonCover === undefined ? HOUSE : { ...HOUSE, garrison_cover: garrisonCover },
    );
    const house = rect(sim, type, 20, 14, 2, 2);
    const rifles = sim.addUnitType(RIFLES);
    const holder = sim.spawn(rifles, 1, fx.from(19.5), fx.from(14.5));
    garrison(sim, holder, house);
    sim.debugDisableFirepower(holder); // he must not drive the attackers off
    for (let k = 0; k < 3; k++) sim.spawn(rifles, 0, fx.from(28.5), fx.from(13.5 + k));
    let pinned = 0;
    for (let k = 0; k < 60 * TICKS_PER_SECOND; k++) {
      sim.tick();
      if (sim.state.pinned[holder] === 1) pinned++;
    }
    expect(sim.structures.alive[house]).toBe(1);
    return pinned;
  }

  it('pins a garrison whose building gives no cover (the control arm)', () => {
    expect(pinnedTicks(0)).toBeGreaterThan(200);
  });

  it('never pins one behind the default, cover 3', () => {
    expect(pinnedTicks(undefined)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/sim/src/garrison.test.ts -t "B1"`
Expected: "never pins one behind the default" FAILS (received a pinned-tick count well above 0); the
control arm passes (it holds on `main` too: the field is ignored, cover 0 is today's behaviour).

- [ ] **Step 3: Implement**

`data/schemas/structure.schema.json`, in the per-type `properties`, after `standing_cover`:

```json
          "garrison_cover": {
            "type": "integer",
            "minimum": 0,
            "maximum": 3,
            "default": 3,
            "description": "Cover level 0-3 a unit INSIDE this building fights with: what incoming suppression is scaled by (COVER_SUPP) and what its detection signature is scaled by (COVER_SIG). Default 3, full building cover (lead ruling 2026-10-14, GH-280). Only read for a garrisoned unit."
          },
```

`packages/sim/src/structures.ts`: on `StructureTypeJson` after `per_tile?: boolean;`

```ts
  /** Cover level 0-3 a unit inside fights with, against suppression and
   *  detection. Default 3 (lead ruling 2026-10-14, GH-280). */
  garrison_cover?: number;
```

on `StructureType` after `perTile: boolean;`

```ts
  /** See StructureTypeJson.garrison_cover. */
  garrisonCover: number;
```

and in `structureTypeFromJson` after `standingCover: json.standing_cover ?? 2,`

```ts
    garrisonCover: json.garrison_cover ?? 3,
```

`sim.ts`, `applySuppression`: replace

```ts
    if (coverProtects) {
      const cov = this.cover[(this.posY[target] >> 16) * this.width + (this.posX[target] >> 16)];
      a = fx.mul(a, COVER_SUPP[cov]);
    }
```

with

```ts
    if (coverProtects) {
      // A man inside a building fights with the building's cover, not the
      // cover of the tile under its centroid -- which is a building tile, 0
      // (B1, GH-280: every near miss on a 2x2 house pinned its garrison).
      const s = this.garrisonedIn[target];
      const cov =
        s >= 0
          ? this.structureTypes[this.stTypeIdx[s]].garrisonCover
          : this.cover[(this.posY[target] >> 16) * this.width + (this.posX[target] >> 16)];
      a = fx.mul(a, COVER_SUPP[cov]);
    }
```

- [ ] **Step 4: Verify, then mutate**

Run the test: PASS. Mutation: `const s = -1;` in place of `const s = this.garrisonedIn[target];` →
"never pins…" red. Mutation: `garrisonCover: json.garrison_cover ?? 0,` → red. Undo both.

- [ ] **Step 5: Gates**

`pnpm lint && pnpm typecheck && pnpm test:determinism && pnpm test && pnpm validate:data && pnpm balance && pnpm playtest`.
Expected: pins unchanged; `balance` byte-identical; `playtest` differs from the base exactly in the
"+ B1" row's way (WH4, DA2, DA2 gate open; credits; two gates). Anything else: stop. Do not commit a
red playtest: hold this task's commit until Task 9 (L-3) carries the rows it breaks, then commit both
in the order Task 9 gives.

- [ ] **Step 6: Commit** (when Task 9 allows)

```bash
/usr/bin/git commit -s -F <msgfile> -- data/schemas/structure.schema.json packages/sim/src/structures.ts packages/sim/src/sim.ts packages/sim/src/garrison.test.ts
```

Message: `sim: a garrison takes its building's cover against suppression, garrison_cover (B1, #280)`.

---

### Task 3: A garrisoned unit is as hard to spot as a man in cover 3 (G2)

**Files:**
- Modify: `packages/sim/src/sim.ts` (`detectionPair`)
- Test: `packages/sim/src/garrison.test.ts`

**Interfaces:**
- Consumes: `StructureType.garrisonCover` (Task 2).
- Produces: nothing new.

Measured: pins unchanged; playtest adds KR3 29/30 and moves WH4 (the "+ G2" row).

- [ ] **Step 1: Write the failing test** (add `import { COVER_SIG } from './tuning';` at the top)

```ts
describe('a garrisoned unit is as hard to spot as a man in cover 3 (G2)', () => {
  function seen(garrisonCover: number | undefined) {
    const sim = new Sim({ seed: 3, width: 48, height: 32, capacity: 16 });
    const type = sim.addStructureType(
      garrisonCover === undefined ? HOUSE : { ...HOUSE, garrison_cover: garrisonCover },
    );
    const house = rect(sim, type, 20, 14, 2, 2);
    const rifles = sim.addUnitType(RIFLES);
    const holder = sim.spawn(rifles, 1, fx.from(19.5), fx.from(14.5));
    garrison(sim, holder, house);
    sim.debugDisableFirepower(holder); // no firing signature
    const obs = sim.spawn(rifles, 0, fx.from(27.5), fx.from(14.5));
    sim.debugDisableFirepower(obs);
    return sim.debugDetection(obs, holder);
  }

  it('reads the building garrison cover, not the tile under the centroid', () => {
    const d = seen(undefined);
    expect(d?.visible).toBe(true);
    expect(d?.signature).toBe(fx.mul(fx.from(0.6), COVER_SIG[3]));
  });

  it('and a building that gives no cover hides nothing (the control arm)', () => {
    expect(seen(0)?.signature).toBe(fx.from(0.6));
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `-t "G2"`: the first test FAILS (signature reads `fx.from(0.6)`).

- [ ] **Step 3: Implement.** In `detectionPair` replace

```ts
    sig = fx.mul(sig, COVER_SIG[this.cover[(this.posY[tgt] >> 16) * this.width + (this.posX[tgt] >> 16)]]);
```

with

```ts
    // A man at a window is as hard to pick out as a man in heavy cover: the
    // building's garrison cover, as for suppression (G2, ruling 2026-10-14).
    const gIn = this.garrisonedIn[tgt];
    const tCover =
      gIn >= 0
        ? this.structureTypes[this.stTypeIdx[gIn]].garrisonCover
        : this.cover[(this.posY[tgt] >> 16) * this.width + (this.posX[tgt] >> 16)];
    sig = fx.mul(sig, COVER_SIG[tCover]);
```

- [ ] **Step 4: Verify, mutate** (`const gIn = -1;` → red), undo.
- [ ] **Step 5: Gates** as Task 2; expected the "+ G2" row. Hold the commit as Task 2 does.
- [ ] **Step 6: Commit** `sim: a garrisoned unit is as hard to spot as a man in cover 3 (G2)` — `packages/sim/src/sim.ts packages/sim/src/garrison.test.ts`.

---

### Task 4: Range and sight from the window, not the centroid (G1, B6)

**Files:**
- Modify: `packages/sim/src/sim.ts`: new `eyePoint`, `eyeX`, `eyeY`; `engageable` (signature), `engageOX`/`engageOY`; `selectTarget`; `focusInReach`; `selectStructureTarget`; `projectHit`; `stepCombat`; `hitFactors`; `fireAt`; `fireAtStructure`; `detectionPair`; `focusHurts`
- Modify: `packages/sim/src/determinism.test.ts` (separate re-pin commit)
- Test: `packages/sim/src/garrison.test.ts`

**Interfaces:**
- Consumes: Task 1's helpers.
- Produces: `private eyePoint(i: number, tx: Fx, ty: Fx): void` writing `private eyeX: Fx`, `private eyeY: Fx`; `private engageable(shooter: number, w: WeaponStats, t: number): boolean` writing `engageDSq`, `engageOX`, `engageOY`. Tasks 5, 6 and 8 build on all three.

Measured: **the flat pin moves** (relief and orders do not); playtest the "+ G1" row (WH4 2/30, its
time limit, DA2 gate open 7/30).

Cost: `detectionPair` calls `eyePoint` twice per pair, and both return at once unless that end is
garrisoned; a garrisoned end walks its footprint (at most 44 tiles on the shipped maps). The scan
in `selectTarget` does the same per candidate for a garrisoned shooter only. No allocation.

- [ ] **Step 1: Write the failing tests**

```ts
describe('range and sight are measured from the window (G1, B6)', () => {
  it('a long building: the man inside reaches from the end tile nearest the target', () => {
    const { sim, u } = world();
    // 1x9 at x=10..18: centroid (14.5, 10.5), east end tile (18.5, 10.5).
    const hall = rect(sim, sim.addStructureType({ ...HOUSE, id: 'g_long' }), 10, 10, 9, 1);
    const holder = sim.spawn(u.rifles, 0, fx.from(14.5), fx.from(11.5));
    garrison(sim, holder, hall);
    // 7.5 tiles from the window, 11.5 from the centroid: out of rifle range
    // (8) from the centroid even with a range bonus of 3.
    const target = sim.spawn(u.dummy, 1, fx.from(26), fx.from(10.5));
    sim.identifyTo(0, target);
    expect(sim.projectHit(holder, target).kind).toBe('shot');
    const events = run(sim, 10 * TICKS_PER_SECOND);
    expect(events.some((e) => e.kind === 'fire' && e.shooter === holder && e.target === target)).toBe(true);
  });

  it('an outside observer measures to the window nearest it', () => {
    const { sim, u } = world();
    const hall = rect(sim, sim.addStructureType({ ...HOUSE, id: 'g_long' }), 10, 10, 9, 1);
    const holder = sim.spawn(u.rifles, 1, fx.from(14.5), fx.from(11.5));
    garrison(sim, holder, hall);
    const obs = sim.spawn(u.rifles, 0, fx.from(25.5), fx.from(10.5));
    // Window (18.5, 10.5) to (25.5, 10.5): exactly 7 tiles.
    expect(sim.debugDetection(obs, holder)?.distSq).toBe(fx.from(49));
  });

  it('a building whose centroid falls off its own footprint does not blind its garrison (B6)', () => {
    const { sim, u } = world();
    // An L: the top row x=10..13 at y=10, and the stem x=10 at y=11..13. Its
    // centroid (11.36, 11.36) is on tile (11,11), open ground -- the shape of
    // the two khan_rafid_3 shanties.
    const tiles = [10, 11, 12, 13].map((x) => 10 * sim.width + x);
    for (const y of [11, 12, 13]) tiles.push(y * sim.width + 10);
    const ell = sim.addStructure(sim.addStructureType({ ...HOUSE, id: 'g_ell' }), tiles);
    expect(sim.structureAt(fx.toInt(sim.structures.cx[ell]), fx.toInt(sim.structures.cy[ell]))).not.toBe(ell);
    const holder = sim.spawn(u.rifles, 0, fx.from(14.5), fx.from(12.5));
    garrison(sim, holder, ell);
    // Due north: from the centroid tile (11,11) the ray crosses the L's own
    // top row at (11,10); from the window (11,10) it crosses nothing.
    const target = sim.spawn(u.dummy, 1, fx.from(11.5), fx.from(4.5));
    expect(sim.debugDetection(holder, target)?.visible).toBe(true);
  });

  it('garrison against garrison: fires at an enemy-held building from its own window (Review Focus 2)', () => {
    const { sim, t, u } = world();
    const mine = rect(sim, sim.addStructureType({ ...HOUSE, id: 'g_long' }), 4, 10, 9, 1); // x=4..12
    const theirs = rect(sim, t.house, 19, 10, 2, 2); // nearest tile (19.5, 10.5)
    const holder = sim.spawn(u.rifles, 0, fx.from(8.5), fx.from(11.5));
    garrison(sim, holder, mine);
    const enemy = sim.spawn(u.rifles, 1, fx.from(21.5), fx.from(12.5));
    garrison(sim, enemy, theirs);
    sim.debugDisableFirepower(enemy);
    sim.identifyTo(0, enemy);
    // Window (12.5, 10.5) to (19.5, 10.5) is 7 tiles; the centroid (8.5, 10.5) is 11.
    let hits = 0;
    for (let k = 0; k < 10 * TICKS_PER_SECOND; k++) {
      sim.identifyTo(0, enemy);
      for (const e of sim.tick()) if (e.kind === 'fire' && e.shooter === holder && e.structure === theirs) hits++;
    }
    expect(hits).toBeGreaterThan(0);
  });

  it('the window tile is the ground the eye stands on (Review Focus 3)', () => {
    // A 1x5 building x=10..14 whose three east tiles stand two levels up; one
    // floor. A block 3 tiles off each end, a target 7 tiles out. The centroid
    // tile (12,10) is on the high ground, so an eye left there sees the west
    // target and not the east one -- the reverse of what the windows see.
    function from(east: boolean): boolean {
      const { sim, t, u } = world();
      for (const x of [12, 13, 14]) sim.setElevation(x, 10, 2);
      const long = rect(sim, sim.addStructureType({ ...HOUSE, id: 'g_plinth' }), 10, 10, 5, 1);
      const holder = sim.spawn(u.rifles, 0, fx.from(12.5), fx.from(11.5));
      garrison(sim, holder, long);
      const end = east ? 14 : 10;
      const dir = east ? 1 : -1;
      rect(sim, t.block, end + dir * 3, 10, 1, 1);
      const target = sim.spawn(u.dummy, 1, fx.from(end + dir * 7 + 0.5), fx.from(10.5));
      return sim.debugDetection(holder, target)?.visible ?? false;
    }
    expect(from(true)).toBe(true); // the high end sees over its block
    expect(from(false)).toBe(false); // the low end, on the ground, does not
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `-t "G1"`: all five FAIL on `main` behaviour (`noSolution`; distSq `fx.from(121)`; `visible` false; 0 shots at the building; the east end reads `false`).

- [ ] **Step 3: Implement `eyePoint`** (beside `structDistSq`):

```ts
  /** Scratch written by `eyePoint` and read straight after it: the hot loops
   *  allocate nothing (the `presentedArc` idiom). Never hashed. */
  private eyeX: Fx = 0;
  private eyeY: Fx = 0;

  /**
   * Where unit `i` looks and shoots from toward (tx, ty) (G1, B6; lead
   * ruling 2026-10-14). In the open: where it stands. Garrisoned: the centre
   * of its building's footprint tile nearest (tx, ty) -- the window on that
   * side. Its POSITION stays the centroid (where it is drawn, and where a
   * near miss is measured to); only range, sight and the line of fire start
   * at the window. Ties go to the first tile in footprint order. A footprint
   * tile is always inside the building, so a centroid that falls on open
   * ground (two khan_rafid_3 shanties) no longer blinds the men inside.
   */
  private eyePoint(i: number, tx: Fx, ty: Fx): void {
    const s = this.garrisonedIn[i];
    if (s < 0) {
      this.eyeX = this.posX[i];
      this.eyeY = this.posY[i];
      return;
    }
    let best = 0x7fffffff;
    let bx = this.stCx[s];
    let by = this.stCy[s];
    const w = this.width;
    for (const t of this.stTiles[s]) {
      const x = t % w;
      const y = (t - x) / w;
      const cx = fx.add(fx.fromInt(x), HALF);
      const cy = fx.add(fx.fromInt(y), HALF);
      const d = distSqFx(fx.sub(cx, tx), fx.sub(cy, ty));
      if (d < best) {
        best = d;
        bx = cx;
        by = cy;
      }
    }
    this.eyeX = bx;
    this.eyeY = by;
  }
```

- [ ] **Step 4: `engageable` takes the shooter.** Replace its signature and body with:

```ts
  /** Where the last `engageable` call measured from (the shooter, or its
   *  window), valid only when it returned true. Scratch like engageDSq. */
  private engageOX: Fx = 0;
  private engageOY: Fx = 0;

  private engageable(shooter: number, w: WeaponStats, t: number): boolean {
    const sSide = this.side[shooter];
    // Civilians (side 2) are never targets — collateral comes from
    // ordnance, not aimpoints. That asymmetry is what ROE scores.
    if (this.alive[t] === 0 || this.side[t] === sSide || this.side[t] > 1) return false;
    // Men inside a building cannot be shot at: the building is in the way,
    // and taking it down is the only way to reach them. A tunnel is the same
    // idea a third time — the earth is in the way, and Yahalom is the way in.
    if (this.garrisonedIn[t] >= 0 || this.carriedBy[t] >= 0 || this.tunnelIn[t] >= 0) return false;
    if (this.contact[sSide * this.capacity + t] < IDENTIFIED_AT) return false;
    // A weapon that cannot elevate does not get to pick a target it could
    // never hit.
    if (this.unitTypes[this.typeIdx[t]].isAir ? !w.canTargetAir : !w.canTargetGround) return false;
    // From the window, for a man inside (G1).
    this.eyePoint(shooter, this.posX[t], this.posY[t]);
    const px = this.eyeX;
    const py = this.eyeY;
    const dSq = distSqFx(fx.sub(this.posX[t], px), fx.sub(this.posY[t], py));
    if (dSq > w.rangeSq || this.minRangeBlocks(w, dSq, t)) return false;
    if ((INDIRECT_MASK & (1 << w.cls)) === 0) {
      if (this.losRay(px >> 16, py >> 16, this.posX[t] >> 16, this.posY[t] >> 16) < 0) return false;
    }
    this.engageDSq = dSq;
    this.engageOX = px;
    this.engageOY = py;
    return true;
  }
```

Update its doc comment's first line to "May weapon `w` of `shooter` take `t` as its target THIS
tick, measured from `eyePoint`?". In `selectTarget` delete `const sSide`, `const px`, `const py`, and:

```ts
    const focus = this.focusTarget[shooter];
    if (focus >= 0 && this.engageable(shooter, w, focus) && this.weaponHurts(w, focus, this.engageOX, this.engageOY)) {
      return focus;
    }
```

and in its loop:

```ts
      if (!this.engageable(shooter, w, t)) continue;
      const dSq = this.engageDSq;
      // …
      const hurts = this.weaponHurts(w, t, this.engageOX, this.engageOY);
```

In `focusInReach`, delete `const sSide = this.side[i];` and replace the call with
`if (this.engageable(i, w, t) && this.weaponHurts(w, t, this.engageOX, this.engageOY)) {` (stepFocus
skips a garrisoned unit, so `engageOX/OY` equal `posX/posY[i]` here; behaviour unchanged).

- [ ] **Step 5: The other range sites read the window.**

`selectStructureTarget`: delete `const px`/`const py` at the top; inside the loop, before
`const dSq = this.structDistSq(s, px, py);`:

```ts
      this.eyePoint(shooter, this.stCx[s], this.stCy[s]);
      const px = this.eyeX;
      const py = this.eyeY;
```

`projectHit`: replace the opening geometry

```ts
    const px = this.posX[shooter];
    const py = this.posY[shooter];
    const tx = this.posX[target];
    const ty = this.posY[target];
```

with

```ts
    const tx = this.posX[target];
    const ty = this.posY[target];
    this.eyePoint(shooter, tx, ty);
    const px = this.eyeX;
    const py = this.eyeY;
```

`stepCombat`, the unit-target loop: replace the `dSq` and the slot-0 `aimHullAt` with

```ts
        this.eyePoint(i, this.posX[target], this.posY[target]);
        const ox = this.eyeX;
        const oy = this.eyeY;
        const dSq = distSqFx(fx.sub(this.posX[target], ox), fx.sub(this.posY[target], oy));
        if (dSq <= w.effectiveRangeSq) engagedClose = true;

        if (slot === 0) {
          this.aimHullAt(i, fx.atan2(fx.sub(this.posY[target], oy), fx.sub(this.posX[target], ox)));
        }
```

and the structure-target loop's three `this.posX[i]`/`this.posY[i]` reads with a window toward the
building:

```ts
          this.eyePoint(i, this.stCx[s], this.stCy[s]);
          const sox = this.eyeX;
          const soy = this.eyeY;
          if (this.structDistSq(s, sox, soy) <= w.effectiveRangeSq) {
            engagedClose = true;
          }
          if (slot === 0) this.curStructure[i] = s;
          const [tx, ty] = this.nearestStructTile(s, sox, soy);
          if (slot === 0) {
            this.aimHullAt(i, fx.atan2(fx.sub(ty, soy), fx.sub(tx, sox)));
          }
```

`hitFactors`: replace its first four lines with

```ts
    const tx = this.posX[target];
    const ty = this.posY[target];
    this.eyePoint(shooter, tx, ty);
    const px = this.eyeX;
    const py = this.eyeY;
```

`fireAt`: the same four-line replacement (its `prOriginX/Y` then carry the window, so the facing a
round meets in `resolveHit` is the one seen from the window). `fireAtStructure`: replace
`const px = this.posX[shooter]; const py = this.posY[shooter];` with
`this.eyePoint(shooter, tx, ty); const px = this.eyeX; const py = this.eyeY;`.

`focusHurts`: replace `const px = this.posX[shooter]; const py = this.posY[shooter];` with
`this.eyePoint(shooter, this.posX[target], this.posY[target]); const px = this.eyeX; const py = this.eyeY;`.

`detectionPair`: replace the distance and ray block with both ends at their windows:

```ts
    this.eyePoint(obs, this.posX[tgt], this.posY[tgt]);
    const ox = this.eyeX;
    const oy = this.eyeY;
    this.eyePoint(tgt, ox, oy);
    const tx = this.eyeX;
    const ty = this.eyeY;
    const dSq = distSqFx(fx.sub(tx, ox), fx.sub(ty, oy));
    none.distSq = dSq;
    if (dSq > oType.sightSq) return none;
    const cov = this.losRay(ox >> 16, oy >> 16, tx >> 16, ty >> 16);
    if (cov < 0) return none;
```

(`lastSeenX/Y` in `stepDetection` keep `posX/posY[tgt]`: the memory is of the man, not the window.)

- [ ] **Step 6: Verify, then mutate.** `-t "G1"` PASS, then the whole file. Mutation: in `eyePoint`
replace `const s = this.garrisonedIn[i];` with `const s = -1;` → all five red. Undo. Mutation: in
`detectionPair` drop the second `eyePoint` (use `posX/posY[tgt]`) → the observer test red. Undo.
Mutation: in `selectStructureTarget` measure from `this.posX[shooter]`/`this.posY[shooter]` again →
the garrison-against-garrison test red. Undo.

- [ ] **Step 7: Gates.** `pnpm lint && pnpm typecheck && pnpm test` green; `pnpm test:determinism`
**red on the flat pin only** (relief and orders unchanged). Expected playtest: the "+ G1" row. Hold
the commit as Task 2 does.

- [ ] **Step 8: Commit the behaviour**, `sim: range and sight from the window nearest the target, not the centroid (G1, B6)` — `packages/sim/src/sim.ts packages/sim/src/garrison.test.ts`, with the flat pin still red in the message ("pin re-read in the next commit").

- [ ] **Step 9: Re-pin, its own commit.** Read the received value from `pnpm test:determinism`, put it
in `determinism.test.ts`'s flat `toBe(…)`, and add above it:

```ts
    // 2026-10-14: a garrisoned unit ranges, sees and fires from its window --
    // the footprint tile nearest its target -- not from the centroid (lead
    // ruling G1, garrison overhaul Task 4). This replay's shed holder fires
    // from the window. With eyePoint returning the centroid it reads <old
    // value> exactly. Was <old value>.
```

Commit `sim: re-pin the determinism hash for the window rule (G1)` — `packages/sim/src/determinism.test.ts` only.

---

### Task 5: Each floor above ground adds to eye height (G3)

**Files:**
- Modify: `data/schemas/structure.schema.json`, `packages/sim/src/structures.ts`, `data/structures.json`, `packages/sim/src/sim.ts` (`losRay`, `raySmoke`, new `eyeLift`; callers `engageable`, `selectStructureTarget`, `projectHit`, `hitFactors`, `detectionPair`)
- Test: `packages/sim/src/garrison.test.ts`

**Interfaces:**
- Consumes: `eyePoint` (Task 4).
- Produces: `StructureTypeJson.floors?: number`, `StructureType.floors: number` (default 1); `private eyeLift(i: number): number`; `losRay(x0, y0, x1, y1, lift0 = 0, lift1 = 0)`, `raySmoke(x0, y0, x1, y1, lift0 = 0, lift1 = 0)`.

Measured: pins unchanged (the determinism shed declares no floors); playtest the "+ G3" row (WH4
4/30; nothing new fails).

- [ ] **Step 1: Write the failing tests**

```ts
describe('each floor above the ground adds to eye height (G3)', () => {
  function sees(floors: number, blockX: number): boolean {
    const { sim, t, u } = world();
    const tower = rect(sim, sim.addStructureType({ ...HOUSE, id: `g_f${floors}`, floors }), 10, 10, 2, 2);
    rect(sim, t.block, blockX, 10, 1, 1);
    const holder = sim.spawn(u.rifles, 0, fx.from(9.5), fx.from(11.5));
    garrison(sim, holder, tower);
    // Window (11.5, 10.5) to the target's tile (18, 10): seven steps.
    const target = sim.spawn(u.dummy, 1, fx.from(18.5), fx.from(10.5));
    return sim.debugDetection(holder, target)?.visible ?? false;
  }

  it('one floor: a building on the line blocks the view', () => expect(sees(1, 14)).toBe(false));
  it('three floors: it sees over a building in the nearer half of the line', () => expect(sees(3, 14)).toBe(true));
  it('but not over one standing beside the target: dead ground stays dead', () => expect(sees(3, 17)).toBe(false));

  it('and it is seen as far as it sees', () => {
    const { sim, t, u } = world();
    const tower = rect(sim, sim.addStructureType({ ...HOUSE, id: 'g_f3', floors: 3 }), 10, 10, 2, 2);
    rect(sim, t.block, 14, 10, 1, 1);
    const holder = sim.spawn(u.rifles, 1, fx.from(9.5), fx.from(11.5));
    garrison(sim, holder, tower);
    const obs = sim.spawn(u.rifles, 0, fx.from(18.5), fx.from(10.5));
    expect(sim.debugDetection(obs, holder)?.visible).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify** — `-t "G3"`: "three floors…" and "and it is seen…" FAIL (no lift);
"one floor" and "dead ground" pass on Task 4's tree, as controls.

- [ ] **Step 3: Implement the data.** Schema, after `garrison_cover`:

```json
          "floors": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9,
            "default": 1,
            "description": "Storeys a garrison fights from. Each floor above the ground adds one elevation level to the eye height of a unit inside it, for line of sight, the way ground elevation does (lead ruling 2026-10-14, G3). Derived from the drawn height: round(height_px / 10), at least 1."
          },
```

`structures.ts`: `floors?: number;` on the JSON (doc: "Storeys; each above the ground lifts a
garrison's eye one elevation level. Default 1.") and `floors: number;` on the type, and
`floors: json.floors ?? 1,` in `structureTypeFromJson`. `data/structures.json`: add `"floors": N` to
each garrisonable type with the values L-1 approved (ruling, lead, 2026-10-14: shanty 1,
pump_house 1, house 2, clinic 2, concrete 2, relay 2, camp 2, warehouse 2, hall 2, apartment 3; none
on wall, fence).

- [ ] **Step 4: Implement the lift.** `raySmoke(x0, y0, x1, y1, lift0 = 0, lift1 = 0)` and
`losRay(x0, y0, x1, y1, lift0 = 0, lift1 = 0)`: in both, the endpoint heights become

```ts
    const h0 = this.elevation[y0 * w + x0] + EYE_HEIGHT + lift0;
    const h1 = this.elevation[y1 * w + x1] + EYE_HEIGHT + lift1;
```

and `losRay` passes its lifts on: `const smoke = this.raySmoke(x0, y0, x1, y1, lift0, lift1);`.
Extend both doc comments with one sentence: "`lift0`/`lift1` raise an end's eye by whole elevation
levels: a garrison's floors above the ground (eyeLift); 0 for everyone else, which is every existing
caller, so this is bit-identical where nobody is garrisoned." Add:

```ts
  /** Elevation levels a unit's eye stands above its window tile's ground:
   *  its building's floors above the ground, 0 in the open (G3). */
  private eyeLift(i: number): number {
    const s = this.garrisonedIn[i];
    return s < 0 ? 0 : this.structureTypes[this.stTypeIdx[s]].floors - 1;
  }
```

Callers: in `engageable`, `this.losRay(px >> 16, py >> 16, this.posX[t] >> 16, this.posY[t] >> 16, this.eyeLift(shooter), 0)`
(the target is never garrisoned there); the same `this.eyeLift(shooter), 0` in
`selectStructureTarget`'s ray and `projectHit`'s ray; in `hitFactors`
`this.raySmoke(px >> 16, py >> 16, tx >> 16, ty >> 16, this.eyeLift(shooter), 0)`; in `detectionPair`
`this.losRay(ox >> 16, oy >> 16, tx >> 16, ty >> 16, this.eyeLift(obs), this.eyeLift(tgt))`.

- [ ] **Step 5: Verify** — `-t "G3"` PASS, then the whole file.
- [ ] **Step 6: Mutate.** `return s < 0 ? 0 : 0;` in `eyeLift` → "three floors" and "seen" red.
Replace `+ lift1` with `+ 0` in `losRay` → "seen" red. Undo each.
- [ ] **Step 7: Gates** (+ `pnpm validate:data`). Pins unchanged; playtest the "+ G3" row. Hold as Task 2.
- [ ] **Step 8: Commit** `sim+data: each floor above the ground lifts a garrison's eye (G3)` — `data/schemas/structure.schema.json data/structures.json packages/sim/src/structures.ts packages/sim/src/sim.ts packages/sim/src/garrison.test.ts`.

---

### Task 6: A mortar does not fire from inside; a Spike does (G4): `fires_from_building`

**Files:**
- Modify: `data/schemas/unit.schema.json`, `packages/sim/src/sim.ts` (`WeaponJson`, `WeaponStats`, `weaponFromJson`, `stepCombat`, `projectHit`, `couldEngage`, `focusHurts`), `data/units/kdf/mortar_team.json`, `packages/render/src/vfx/power.test.ts`, `tools/validate_data.mjs`
- Create: `tools/validate_garrison.mjs`, `tools/src/validate_garrison.test.ts`
- Test: `packages/sim/src/garrison.test.ts`

**Interfaces:**
- Consumes: Task 4 (`eyePoint` in `projectHit`/`focusHurts`).
- Produces: `WeaponJson.fires_from_building?: boolean`; `WeaponStats.firesFromBuilding: boolean` (default true); `export function garrisonWeaponFailures(unit, file): string[]` in `tools/validate_garrison.mjs`.

**The flag is `fires_from_building`**, on the weapon, default `true`. It is data, not derived from the
class, so a future garrison-capable indirect weapon must say so; `garrisonWeaponFailures` refuses a
`mortar` or `rocket` weapon on a unit with the `garrison` ability that does not declare
`"fires_from_building": false`.

Measured: pins unchanged; playtest byte-identical to Task 5's (no shipped plan garrisons a mortar).

- [ ] **Step 1: Write the failing tests** (sim)

```ts
describe('a mortar does not fire from inside; a Spike does (G4)', () => {
  const MORTAR: UnitTypeJson = {
    id: 'g_mortar', role: 'artillery',
    hull: { hp: 300, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1 },
    sensors: { optics: 1, sight_tiles: 10, signature: 0.6 },
    abilities: ['garrison'],
    weapons: [{
      id: 'g_mortar_60', type: 'mortar', range_tiles: 18, effective_range_tiles: 14, min_range_tiles: 4,
      accuracy: 0.3, damage: 150, splash_tiles: 1.5, suppression: 90, rof_per_min: 12, fires_from_building: false,
    }],
  };
  const SPIKE: UnitTypeJson = {
    id: 'g_spike', role: 'at_team',
    hull: { hp: 300, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1 },
    sensors: { optics: 1, sight_tiles: 10, signature: 0.6 },
    abilities: ['garrison'],
    weapons: [{
      id: 'g_spike_atgm', type: 'atgm', range_tiles: 13, effective_range_tiles: 7.2, min_range_tiles: 1,
      accuracy: 0.9, penetration: 700, damage: 500, suppression: 60, rof_per_min: 3,
    }],
  };
  function setup(json: UnitTypeJson, inside: boolean) {
    const { sim, t } = world();
    const ut = sim.addUnitType(json);
    const dummy = sim.addUnitType(DUMMY);
    const house = rect(sim, t.house, 20, 14, 2, 2);
    const id = sim.spawn(ut, 0, fx.from(19.5), fx.from(14.5));
    if (inside) garrison(sim, id, house);
    const target = sim.spawn(dummy, 1, fx.from(28.5), fx.from(14.5));
    sim.identifyTo(0, target);
    return { sim, id, target };
  }
  function shots(json: UnitTypeJson, inside: boolean): number {
    const { sim, id, target } = setup(json, inside);
    let n = 0;
    for (let k = 0; k < 30 * TICKS_PER_SECOND; k++) {
      sim.identifyTo(0, target);
      for (const e of sim.tick()) if (e.kind === 'fire' && e.shooter === id) n++;
    }
    return n;
  }
  it('the mortar fires in the open (the control arm)', () => expect(shots(MORTAR, false)).toBeGreaterThan(0));
  it('and holds fire inside', () => expect(shots(MORTAR, true)).toBe(0));
  it('the Spike fires from inside', () => expect(shots(SPIKE, true)).toBeGreaterThan(0));
  it('the fire panel and the fire order agree: no shot, and no order, for the mortar inside', () => {
    const m = setup(MORTAR, true);
    expect(m.sim.projectHit(m.id, m.target).kind).toBe('noSolution');
    expect(m.sim.canFocus(m.id, m.target)).toBe(false);
    const s = setup(SPIKE, true);
    expect(s.sim.canFocus(s.id, s.target)).toBe(true);
  });
});
```

Tools test `tools/src/validate_garrison.test.ts` (Task 7 appends to it):

```ts
// The garrison rules validate_data cannot leave to runtime (garrison overhaul, 2026-10-14).
// Its own module because validate_data.mjs runs its sweep at import time and exits.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { garrisonWeaponFailures } from '../validate_garrison.mjs';

const ROOT = join(__dirname, '..', '..');
function unitsOnDisk(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const dir of ['data/units/kdf', 'data/units/enemy']) {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (f.endsWith('.json')) out.push(JSON.parse(readFileSync(join(ROOT, dir, f), 'utf8')));
    }
  }
  return out;
}

describe('garrisonWeaponFailures (G4)', () => {
  const mortar = { id: 'm', abilities: ['garrison'], weapons: [{ id: 'w', type: 'mortar' }] };
  it('refuses an indirect weapon on a garrison-capable unit that does not say it holds fire inside', () => {
    expect(garrisonWeaponFailures(mortar, 'm.json')).toHaveLength(1);
    expect(garrisonWeaponFailures({ ...mortar, weapons: [{ id: 'w', type: 'rocket' }] }, 'm.json')).toHaveLength(1);
  });
  it('passes it once it does, and ignores a unit that cannot garrison', () => {
    expect(garrisonWeaponFailures({ ...mortar, weapons: [{ id: 'w', type: 'mortar', fires_from_building: false }] }, 'm.json')).toEqual([]);
    expect(garrisonWeaponFailures({ ...mortar, abilities: [] }, 'm.json')).toEqual([]);
  });
  it('passes a direct-fire weapon either way', () => {
    expect(garrisonWeaponFailures({ ...mortar, weapons: [{ id: 'w', type: 'atgm' }] }, 'm.json')).toEqual([]);
  });
  it('every shipped unit passes, and mortar_team is the one that needed the flag', () => {
    const all = unitsOnDisk();
    expect(all.flatMap((u) => garrisonWeaponFailures(u, String(u.id)))).toEqual([]);
    const mt = all.find((u) => u.id === 'mortar_team') as { weapons: { fires_from_building?: boolean }[] };
    expect(mt.weapons[0].fires_from_building).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — sim `-t "G4"`: "holds fire inside" FAILS (it fires) and
the panel test FAILS; the tools test fails to import `../validate_garrison.mjs`.

- [ ] **Step 3: Implement the data.** `unit.schema.json`, weapon `properties`, after `collateral_risk`:

```json
          "fires_from_building": {
            "type": "boolean",
            "default": true,
            "description": "Whether this weapon fires while its unit is garrisoned. False for indirect fire (a mortar needs open sky over the tube; lead ruling 2026-10-14, G4). validate_data requires false on any mortar or rocket weapon of a unit with the garrison ability."
          }
```

`data/units/kdf/mortar_team.json`, in the `mortar_60` weapon object after `"id": "mortar_60",`:
`"fires_from_building": false,`.

- [ ] **Step 4: Implement the sim.** `WeaponJson`: `fires_from_building?: boolean;`.
`WeaponStats` (after `canTargetAir`):

```ts
  /** Fires while its unit is garrisoned. From `fires_from_building`, default
   *  true; false for indirect fire (G4, ruling 2026-10-14). */
  firesFromBuilding: boolean;
```

`weaponFromJson`: `firesFromBuilding: w.fires_from_building ?? true,`. In `stepCombat`, before the
first slot loop: `const inside = this.garrisonedIn[i] >= 0;`, and as the first lines of the unit
slot loop body:

```ts
        if (inside && !w.firesFromBuilding) {
          if (slot === 0) this.curTarget[i] = -1;
          continue;
        }
```

and in the structure-target slot loop after the `STRUCT_DAMAGE` skip:
`if (inside && !w.firesFromBuilding) continue;`. `projectHit`'s weapon loop:
`if (this.garrisonedIn[shooter] >= 0 && !w.firesFromBuilding) continue;` as its first line.
`couldEngage` (canFocus's last clause) and `focusHurts`: inside their slot loops, first line,
`if (this.garrisonedIn[i] >= 0 && !weapons[s].firesFromBuilding) continue;` (`shooter` in
`focusHurts`). Doc of `couldEngage`: add "A weapon that does not fire from a building does not count
for a garrisoned unit."

`packages/render/src/vfx/power.test.ts`'s `w()` returns a `WeaponStats`: add
`firesFromBuilding: true,` after `canTargetAir: false,`.

- [ ] **Step 5: Implement the validator.** Create `tools/validate_garrison.mjs`:

```js
// The garrison rules that validate_data.mjs checks and the runtime would otherwise swallow
// (garrison overhaul, lead rulings 2026-10-14). Its own module because validate_data.mjs runs its
// whole sweep at import time and exits, so a test cannot import it.

/** Weapon types that fire indirect (the sim's INDIRECT_MASK classes). */
const INDIRECT_TYPES = new Set(['mortar', 'rocket']);

/** G4: an indirect weapon on a unit that can garrison must say it holds fire inside. */
export function garrisonWeaponFailures(unit, file) {
  if (!(unit?.abilities ?? []).includes('garrison')) return [];
  const out = [];
  for (const w of unit.weapons ?? []) {
    if (INDIRECT_TYPES.has(w.type) && w.fires_from_building !== false) {
      out.push(
        `${file}: ${unit.id} can garrison and its ${w.type} weapon "${w.id}" does not declare ` +
          `"fires_from_building": false -- indirect fire does not go out of a window (G4)`
      );
    }
  }
  return out;
}
```

In `tools/validate_data.mjs`: `import { garrisonWeaponFailures } from './validate_garrison.mjs';` with
the other validator imports, and inside the unit-file loop (where `unitsById.set(u.id, u)` runs):
`failures.push(...garrisonWeaponFailures(u, rel(file)));`.

- [ ] **Step 6: Verify and mutate.** Both test files PASS; `pnpm validate:data` passes. Mutations:
delete `fires_from_building: false` from `mortar_team.json` → `pnpm validate:data` red with the G4
line, and the shipped-units test red. `firesFromBuilding: true,` in `weaponFromJson` → "holds fire
inside" red. Delete the `couldEngage` line → the `canFocus` assertion red. Undo each.

- [ ] **Step 7: Gates** (+ `pnpm validate:data`). Pins unchanged; playtest byte-identical to Task 5's
output. Commit when Task 2's hold is released.

- [ ] **Step 8: Commit** `sim+data: a mortar holds fire inside a building, a Spike does not: fires_from_building (G4)` — the eight files above.

---

### Task 7: Sarim rifles can garrison; a garrison stance needs the ability (B2)

**Files:**
- Modify: `data/units/enemy/sarim_rifles.json`, `tools/validate_garrison.mjs`, `tools/validate_data.mjs`
- Test: `tools/src/validate_garrison.test.ts`

**Interfaces:**
- Consumes: `tools/validate_garrison.mjs` (Task 6).
- Produces: `export function garrisonStanceFailures(mission, unitsById, file): string[]`.

Measured: pins unchanged; playtest the "+ B2" row (UZ3 26/30, UZ4 11/30, credits 5399, roster 24).
`exp6`: 30 of 30 garrison-stance bodies inside at 20 s (22 on `main`).

- [ ] **Step 1: Write the failing tests** (append to `tools/src/validate_garrison.test.ts`; add
`garrisonStanceFailures` to its import)

```ts
function missionsOnDisk(): Record<string, unknown>[] {
  return readdirSync(join(ROOT, 'data/missions'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(ROOT, 'data/missions', f), 'utf8')));
}

describe('garrisonStanceFailures (B2)', () => {
  const units = new Map<string, { abilities?: string[] }>([
    ['can', { abilities: ['garrison'] }],
    ['cannot', { abilities: [] }],
  ]);
  const at = (unit: string) => ({ unit, count: 1, at: [3, 3], stance: { kind: 'garrison', building: [3, 3] } });
  it('refuses a garrison stance on a unit without the ability, wherever the placement sits', () => {
    expect(garrisonStanceFailures({ enemy: { garrison: [at('cannot')] } }, units, 'm')).toHaveLength(1);
    expect(garrisonStanceFailures({ enemy: { waves: [{ units: [at('cannot')] }] } }, units, 'm')).toHaveLength(1);
    expect(garrisonStanceFailures({ triggers: [{ do: { kind: 'spawn', units: [at('cannot')] } }] }, units, 'm')).toHaveLength(1);
    expect(garrisonStanceFailures({ starting_force: [at('cannot')] }, units, 'm')).toHaveLength(1);
  });
  it('passes one with it, and a placement with another stance', () => {
    expect(garrisonStanceFailures({ enemy: { garrison: [at('can')] } }, units, 'm')).toEqual([]);
    expect(garrisonStanceFailures({ enemy: { garrison: [{ ...at('cannot'), stance: { kind: 'hold_position' } }] } }, units, 'm')).toEqual([]);
  });
  it('every shipped mission passes', () => {
    const byId = new Map(unitsOnDisk().map((u) => [String(u.id), u as { abilities?: string[] }]));
    expect(missionsOnDisk().flatMap((m) => garrisonStanceFailures(m, byId, String(m.id)))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify** — the import fails; once Step 3 lands, "every shipped mission passes"
fails with the eight `sarim_rifles` lines until Step 4.

- [ ] **Step 3: Implement the rule** (append to `tools/validate_garrison.mjs`):

```js
/** B2: every placement with a garrison stance, anywhere in the mission, names a unit that can
 *  garrison. The runtime's `garrison` command silently skips a unit without the ability, so the
 *  body stands where it spawned -- on the building's own blocked tile, three times in eight. */
export function garrisonStanceFailures(mission, unitsById, file) {
  const out = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
    } else if (node && typeof node === 'object') {
      if (typeof node.unit === 'string' && node.stance?.kind === 'garrison') {
        if (!(unitsById.get(node.unit)?.abilities ?? []).includes('garrison')) {
          out.push(
            `${file}: "${node.unit}" has a garrison stance and no garrison ability -- the order is ` +
              `silently refused and the unit stands where it spawned`
          );
        }
      }
      for (const v of Object.values(node)) walk(v);
    }
  };
  walk(mission);
  return out;
}
```

and in `validate_data.mjs`, next to `failures.push(...timeLimitFailures(mi, rel(file)));`:
`failures.push(...garrisonStanceFailures(mi, unitsById, rel(file)));` (extend the import).

- [ ] **Step 4: Implement the data.** `data/units/enemy/sarim_rifles.json`, after the `sensors` line:
`"abilities": ["garrison"],`.

- [ ] **Step 5: Verify and mutate.** Tests PASS, `pnpm validate:data` passes. Mutation: delete the
ability → `validate:data` red with eight lines, the shipped-missions test red. Undo.

- [ ] **Step 6: Gates.** Pins unchanged; playtest the "+ B2" row. Hold as Task 2.
- [ ] **Step 7: Commit** `data: sarim_rifles can garrison; a garrison stance needs the ability (B2)` — `data/units/enemy/sarim_rifles.json tools/validate_garrison.mjs tools/validate_data.mjs tools/src/validate_garrison.test.ts`.

---

### Task 8: Extra range from inside: `GARRISON_RANGE_BONUS` (ruling 4)

**Files:**
- Modify: `packages/sim/src/tuning.ts`, `packages/sim/src/sim.ts` (`WeaponStats`, `weaponFromJson`, new `reachSq`/`effSq`/`effRange`, `engageable`, `projectHit`, `selectStructureTarget`, `stepCombat`, `hitFactors`, `fireAtStructure`, `focusInReach`), `packages/render/src/vfx/power.test.ts`
- Test: `packages/sim/src/garrison.test.ts`

**Interfaces:**
- Consumes: `eyePoint`, `engageable(shooter, w, t)` (Task 4).
- Produces: `export const GARRISON_RANGE_BONUS` (Q16.16 tiles); `WeaponStats.garrisonRangeSq`, `garrisonEffRange`, `garrisonEffRangeSq`.

The value is L-2's (ruling, lead, 2026-10-14: +1 tile = 65536, on maximum and effective range;
sight unchanged). Measured at +1: pins unchanged; playtest the "+ range bonus +1" row.

- [ ] **Step 1: Write the failing tests** (import `GARRISON_RANGE_BONUS` from `./tuning`)

```ts
describe('extra range from inside, on top of the window rule (ruling 4)', () => {
  const BONUS = fx.toNumber(GARRISON_RANGE_BONUS);
  function shot(inside: boolean, beyond: number): string {
    const { sim, t, u } = world();
    const house = rect(sim, t.house, 20, 14, 2, 2);
    const id = sim.spawn(u.rifles, 0, fx.from(inside ? 19.5 : 21.5), fx.from(inside ? 14.5 : 17.5));
    if (inside) garrison(sim, id, house);
    // From the east window (21.5, 14.5), or from the open at (21.5, 17.5).
    const oy = inside ? 14.5 : 17.5;
    const target = sim.spawn(u.dummy, 1, fx.from(21.5 + 8 + beyond), fx.from(oy));
    sim.identifyTo(0, target);
    return sim.projectHit(id, target).kind;
  }
  it('the bonus is a whole number of tiles, and not zero', () => {
    expect(BONUS).toBeGreaterThanOrEqual(1);
    expect(GARRISON_RANGE_BONUS % 65536).toBe(0);
  });
  it('reaches range + bonus from the window', () => expect(shot(true, BONUS - 0.25)).toBe('shot'));
  it('and no further', () => expect(shot(true, BONUS + 0.25)).toBe('noSolution'));
  it('the same man in the open reaches his range only (the control arm)', () => expect(shot(false, 0.25)).toBe('noSolution'));

  it('a fire order from a building reaches with the bonus, and wins over a nearer decoy (Review Focus 1)', () => {
    const { sim, t, u } = world();
    const house = rect(sim, t.house, 20, 14, 2, 2);
    const id = sim.spawn(u.rifles, 0, fx.from(19.5), fx.from(14.5));
    garrison(sim, id, house);
    const focus = sim.spawn(u.dummy, 1, fx.from(21.5 + 8 + BONUS - 0.25), fx.from(14.5));
    const decoy = sim.spawn(u.dummy, 1, fx.from(24.5), fx.from(17.5));
    sim.identifyTo(0, focus);
    sim.identifyTo(0, decoy);
    sim.queueCommand({ kind: 'attack', ids: [id], target: focus });
    let onFocus = 0;
    let onDecoy = 0;
    for (let k = 0; k < 10 * TICKS_PER_SECOND; k++) {
      sim.identifyTo(0, focus);
      sim.identifyTo(0, decoy);
      for (const e of sim.tick()) {
        if (e.kind !== 'fire' || e.shooter !== id) continue;
        if (e.target === focus) onFocus++;
        if (e.target === decoy) onDecoy++;
      }
    }
    expect(sim.state.garrisonedIn[id]).toBe(house);
    expect(onFocus).toBeGreaterThan(0);
    expect(onDecoy).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify** — the file fails to import `GARRISON_RANGE_BONUS`; after the
constant exists with the sim untouched, "reaches range + bonus" and the fire-order test FAIL.

- [ ] **Step 3: Implement.** `tuning.ts` (with the cover constants):

```ts
/** Weapon range a unit gains from inside a building, Q16.16 tiles, on top of
 *  measuring from the window (lead ruling 2026-10-14, GH-34). Maximum and
 *  effective range both; not sight, not minimum range. +1 by the lead's ruling
 *  of 2026-10-14 (L-2), from a measured +1/+2 table
 *  (docs/superpowers/plans/2026-10-14-garrison-overhaul.md): §5.7 identical for
 *  both; +2 broke two more missions and two unlock gates. */
export const GARRISON_RANGE_BONUS = 65536; // 1 tile
```

`WeaponStats` after `firesFromBuilding`:

```ts
  /** Range, effective range and its square from inside a building:
   *  GARRISON_RANGE_BONUS longer (ruling 4, 2026-10-14). */
  garrisonRangeSq: Fx;
  garrisonEffRange: Fx;
  garrisonEffRangeSq: Fx;
```

`weaponFromJson` (import `GARRISON_RANGE_BONUS`):

```ts
  const gRange = fx.add(range, GARRISON_RANGE_BONUS);
  const gEff = fx.add(effRange, GARRISON_RANGE_BONUS);
  // …in the returned object:
    garrisonRangeSq: fx.mul(gRange, gRange),
    garrisonEffRange: gEff,
    garrisonEffRangeSq: fx.mul(gEff, gEff),
```

Three helpers beside `eyeLift`:

```ts
  /** `w`'s maximum range squared for unit `i`: longer from inside (ruling 4). */
  private reachSq(i: number, w: WeaponStats): Fx {
    return this.garrisonedIn[i] >= 0 ? w.garrisonRangeSq : w.rangeSq;
  }
  /** `w`'s effective range squared for unit `i`. */
  private effSq(i: number, w: WeaponStats): Fx {
    return this.garrisonedIn[i] >= 0 ? w.garrisonEffRangeSq : w.effectiveRangeSq;
  }
  /** `w`'s effective range for unit `i`, the hit-falloff scale. */
  private effRange(i: number, w: WeaponStats): Fx {
    return this.garrisonedIn[i] >= 0 ? w.garrisonEffRange : w.effectiveRange;
  }
```

Sites: `engageable`, `projectHit` and `selectStructureTarget` use `this.reachSq(shooter, w)` for
`w.rangeSq`; `stepCombat`'s two `w.effectiveRangeSq` reads use `this.effSq(i, w)`; `hitFactors` and
`fireAtStructure` use `this.effRange(shooter, w)` for `w.effectiveRange`; `focusInReach` uses
`this.effSq(i, w)` and `this.reachSq(i, w)` (a garrisoned unit never gets there; one rule). The
`power.test.ts` stand-in gains `garrisonRangeSq: 0, garrisonEffRange: 0, garrisonEffRangeSq: 0,`.

- [ ] **Step 4: Verify and mutate.** PASS. Mutations: `garrisonRangeSq: fx.mul(range, range),` →
"reaches range + bonus" and the fire-order test red; `return w.rangeSq;` in `reachSq` → same; set
the constant to 0 → "not zero" red. Undo each.
- [ ] **Step 5: Gates.** Pins unchanged (measured at +1); playtest the "+ range bonus" row. Hold as Task 2.
- [ ] **Step 6: Commit** `sim: a garrison reaches GARRISON_RANGE_BONUS further, measured from its window (#34)` — `packages/sim/src/tuning.ts packages/sim/src/sim.ts packages/sim/src/garrison.test.ts packages/render/src/vfx/power.test.ts`.

---

### Task 9: Carry the plans that stop winning (L-3)

**Ruling (lead, 2026-10-14), L-3:** option (a) first: the scripted plans are rewritten to fight
garrisons properly. Only where a plan cannot win inside the mission's time limit is that mission's
data eased, and **each such mission change goes to the lead for approval before it lands**. So this
task stops and reports per mission (Step 3). Option (c), softening the rulings, is not on the
table.

**Files:**
- Modify: `tools/src/backtest/playtest.ts` (the plans for WH4, DA2 with `breach_team`, KR3, UZ3, UZ4; `wadiHalam4Plan` and the others located by name)
- Modify, only with the lead's approval for that mission (L-3): `data/missions/<mission>.json`
- Test: `pnpm playtest` itself (30 seeds), which is the gate these plans live under

**Interfaces:**
- Consumes: every sim and data change above.
- Produces: plans that win on 30 of 30 seeds under the overhaul; nothing else.

**Order.** Tasks 2–8 are implemented and their unit tests committed-ready, but their commits are
held. Work mission by mission in the order the stage table first breaks them: DA2 gate open and WH4
(Task 2), KR3 (Task 3), WH4 again (Task 4), UZ3 and UZ4 (Task 7). For each mission:

- [ ] **Step 1: Read why it loses**, with the plan's own seeds: run `pnpm playtest` and copy the
mission's `missed on …` seeds; replay one through `tools/src/backtest/playtest-run.ts` and print, per
garrison, the tick it first fired, what it killed and from which window. Write the cause in one line
in the ledger (for example: "WH4: the `rpg_team` in (37,25) kills the Eitan at the 2-tile firing step
(38,28), now that the misses no longer pin it").

- [ ] **Step 2: Change only the plan.** Move the firing step out of the garrison's reach
(`range + GARRISON_RANGE_BONUS + 0.5` tiles from the nearest footprint tile, measured from the
window), bring the weapon that hurts masonry from there (`ifv_namer`'s `cannon_30`, a `mortar_team`
outside the building, the D9's blade), and screen the window with `smoke` before a demolisher walks
in. Every changed line carries a comment naming this plan and the cause line from Step 1.

- [ ] **Step 3: Measure.** `pnpm playtest`: the mission's rows 30 of 30, its time limit line clears
its slowest win by 120 s and 20 %, and no other line differs from the expected output for the tasks
committed so far. If a plan cannot be carried by plan changes alone within its time limit, **stop
for that mission and report to the lead**: the mission, the cause line from Step 1, the best seed
count and slowest win the plan changes reached, and the smallest data change proposed to carry it
(for example one `rpg_team` house fewer in WH4, a longer `raze` deadline in UZ4, one more demolisher
in the starting force). Nothing in `data/missions/` changes until the lead approves that mission's
change; the approved change then lands as its own commit (`data: <mission> eases <what> for the
garrison overhaul (lead, <date>)`) with the plan change, and the other missions carry on meanwhile.

- [ ] **Step 4: Commit each held task with the plans it needs, in task order.** For Task 2: Task 2's
files plus the plan changes for DA2 and WH4, committed as two commits (`sim: … (B1, #280)` first,
then `tools: the WH4 and DA2 plans fight a garrison that shoots back (B1)`), and the gate run on the
second. Then Task 3 with KR3's, Task 4 (and its re-pin) with WH4's, Tasks 5 and 6 alone, Task 7 with
UZ3's and UZ4's, Task 8 with whatever its row needs. Credits and roster are NOT re-pinned here
(Task 10); until then `playtest` reports exactly the credit and roster lines as failing and nothing
else.

---

### Task 10: Re-pin credits and roster, each in its own commit

**Files:**
- Modify: `tools/src/backtest/playtest.ts` (`LADDER_CREDITS`, `ROSTER_MAX`), `packages/app/src/ui/stores-model.ts` (`CAMPAIGN_CREDITS`)

- [ ] **Step 1:** `pnpm playtest`; read `credit ladder: N over 26 missions` and
`roster maximum: M at …`. If either is not what the last task's measurement led you to expect, stop.
- [ ] **Step 2: Credits.** Set `LADDER_CREDITS` and `CAMPAIGN_CREDITS` to N, each with a comment
"Was <old>: the garrison overhaul (2026-10-14) — <the missions whose pay moved and why, one line
each>". `pnpm test` (the stores-model test reads `CAMPAIGN_CREDITS`) and `pnpm playtest` green on
credits. Commit `tools+app: re-pin the credit ladder for the garrison overhaul` —
`tools/src/backtest/playtest.ts packages/app/src/ui/stores-model.ts`.
- [ ] **Step 3: Roster.** Set `ROSTER_MAX` to M with "Was 31: the garrison overhaul (2026-10-14) —
<why umm_zeitoun_4_clearance's survivors moved>". `pnpm playtest` fully green. Commit
`tools: re-pin the roster maximum for the garrison overhaul` — `tools/src/backtest/playtest.ts`.

---

### Task 11: Re-measure §5.7, commit the garrison probes, record the rules

**Files:**
- Create: `tools/src/backtest/garrison-probes.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: `pnpm balance`.** Expected byte-identical to the base at base and at max tier (the
urban target builds no structures; see "Measured"). If it is not, stop: something outside the
garrison paths moved. If a §5.7 target fails, bring it to the lead; do not retune.

- [ ] **Step 2: The probes, report-only.** Create `tools/src/backtest/garrison-probes.ts`:

```ts
// Report-only garrison measurements (garrison overhaul, 2026-10-14). Not a gate: neither has a
// passing band yet (L-4). Run: pnpm --filter @lions/tools exec tsx src/backtest/garrison-probes.ts
//
// 1. The #280 raid: 8 militia_cell attack-move on 2 inf_squad inside a 2x2 house, 20 seeds x
//    120 s. On main 7646107c the defenders were pinned 90 % of the time and killed 0.00.
// 2. The §5.7 urban town garrisoned: urbanAssault's three 4x3 blocks as real houses with two
//    militia_cell inside each, rifle squads at 1:1..4:1 plus one demo_squad per group sent at the
//    house once its group is within 10 tiles. On main it won 0 of 20 at every ratio.
import { Sim, fx, TICKS_PER_SECOND } from '@lions/sim';
import { structures } from '@lions/data';
import { units } from './harness';

const WEST = fx.from(0.5);

function raid(seed: number): { held: boolean; killed: number; defShots: number } {
  const sim = new Sim({ seed, width: 64, height: 64, capacity: 64 });
  const house = sim.addStructureType(structures.house as Parameters<typeof sim.addStructureType>[0]);
  const inf = sim.addUnitType(units.inf_squad);
  const militia = sim.addUnitType(units.militia_cell);
  const tiles = [30 * 64 + 20, 30 * 64 + 21, 31 * 64 + 20, 31 * 64 + 21];
  const s = sim.addStructure(house, tiles);
  const defs = [0, 1].map((k) => sim.spawn(inf, 0, fx.from(19.5), fx.from(30.5 + k)));
  sim.queueCommand({ kind: 'garrison', ids: defs, structure: s });
  for (let k = 0; k < 300 && defs.some((d) => sim.state.garrisonedIn[d] !== s); k++) sim.tick();
  const atts: number[] = [];
  for (let i = 0; i < 8; i++) atts.push(sim.spawn(militia, 1, fx.from(37 + (i % 2)), fx.from(28 + i), WEST));
  sim.queueCommand({ kind: 'attackMove', ids: atts, x: fx.from(22.5), y: fx.from(31) });
  let defShots = 0;
  for (let k = 0; k < 120 * TICKS_PER_SECOND; k++) {
    for (const e of sim.tick()) if (e.kind === 'fire' && defs.includes(e.shooter)) defShots++;
  }
  return {
    held: defs.some((d) => sim.state.alive[d] === 1),
    killed: atts.filter((a) => sim.state.alive[a] !== 1).length,
    defShots,
  };
}

function town(ratio: number, seed: number): { won: boolean; rifleLost: number } {
  const W = 40;
  const H = 28;
  const sim = new Sim({ seed, width: W, height: H, capacity: 64 });
  const inf = sim.addUnitType(units.inf_squad);
  const demo = sim.addUnitType(units.demo_squad);
  const militia = sim.addUnitType(units.militia_cell);
  const house = sim.addStructureType(structures.house as Parameters<typeof sim.addStructureType>[0]);
  const blocks: [number, number, number, number][] = [[28, 6, 4, 3], [30, 13, 4, 3], [28, 20, 4, 3]];
  const ids = blocks.map(([bx, by, bw, bh]) => {
    const tiles: number[] = [];
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) tiles.push(y * W + x);
    const s = sim.addStructure(house, tiles);
    for (let y = by - 1; y <= by + bh; y++) {
      for (let x = bx - 1; x <= bx + bw; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H && sim.blocked[y * W + x] === 0) sim.setCover(x, y, 2);
      }
    }
    return s;
  });
  const defs: number[] = [];
  blocks.forEach(([bx, by, bw], k) => {
    for (let j = 0; j < 2; j++) {
      const d = sim.spawn(militia, 1, fx.from(bx + bw + 0.5), fx.from(by + 0.5 + j), WEST);
      defs.push(d);
      sim.queueCommand({ kind: 'garrison', ids: [d], structure: ids[k] });
    }
  });
  for (let t = 0; t < 60; t++) sim.tick();
  const attackers = 6 * ratio;
  const groups: number[][] = [[], [], []];
  for (let a = 0; a < attackers; a++) {
    groups[a % 3].push(sim.spawn(inf, 0, fx.from(2.5 + Math.floor(a / 11) * 1.5), fx.from(3 + (a % 11) * 2)));
  }
  const objectives: [number, number][] = [[36, 7], [36, 15], [35, 24]];
  const sappers = [0, 1, 2].map((gi) => sim.spawn(demo, 0, fx.from(1.0), fx.from(6.5 + gi * 8)));
  for (let gi = 0; gi < 3; gi++) {
    const ids2 = [...groups[gi], sappers[gi]];
    sim.queueCommand({ kind: 'attackMove', ids: ids2, x: fx.fromInt(objectives[gi][0]), y: fx.fromInt(objectives[gi][1]), sweep: true });
  }
  const sent = [false, false, false];
  for (let t = 0; t < 300 * TICKS_PER_SECOND; t++) {
    if (t % 10 === 0) {
      for (let gi = 0; gi < 3; gi++) {
        if (sent[gi] || sim.state.alive[sappers[gi]] !== 1) continue;
        const [bx, by, bw, bh] = blocks[gi];
        const near = groups[gi].some(
          (a) => sim.state.alive[a] === 1 && Math.hypot(sim.state.posX[a] / 65536 - (bx + bw / 2), sim.state.posY[a] / 65536 - (by + bh / 2)) <= 10
        );
        if (near) {
          sim.queueCommand({ kind: 'demolish', ids: [sappers[gi]], structure: ids[gi] });
          sent[gi] = true;
        }
      }
    }
    sim.tick();
    if ((t & 31) === 0 && defs.every((d) => sim.state.alive[d] !== 1)) break;
  }
  const alive = groups.flat().filter((a) => sim.state.alive[a] === 1).length;
  return { won: defs.every((d) => sim.state.alive[d] !== 1) && alive >= Math.ceil(attackers * 0.25), rifleLost: attackers - alive };
}

const r = Array.from({ length: 20 }, (_, i) => raid(101 + i));
console.log(
  `#280 raid (2 inf_squad in a 2x2 house vs 8 militia, 20 seeds x 120 s): held ${r.filter((x) => x.held).length}/20, ` +
    `militia killed ${(r.reduce((a, x) => a + x.killed, 0) / 20).toFixed(2)}, defender shots ${(r.reduce((a, x) => a + x.defShots, 0) / 20).toFixed(0)}`
);
for (const ratio of [1, 2, 3, 4]) {
  const t = Array.from({ length: 20 }, (_, s) => town(ratio, 60000 + ratio * 1000 + s));
  console.log(
    `garrisoned town ${ratio}:1 (20 seeds): won ${t.filter((x) => x.won).length}/20, ` +
      `rifle squads lost ${(t.reduce((a, x) => a + x.rifleLost, 0) / 20).toFixed(1)}/${6 * ratio}`
  );
}
```

Run it on the base commit and on the branch head; paste both outputs into the PR body under
"Report-only". `Math.hypot` here is tools code, outside the sim, as in `targets.ts`.

- [ ] **Step 3: Record the rules in `CLAUDE.md`**, one bullet under "Adding content" → "A map" or a
new short "Garrisons" bullet in "Dev instruments": garrison cover (default 3) for suppression and
detection; range and sight from the window (`eyePoint`), position stays the centroid; `floors` lifts
the eye one level per floor above the ground; `fires_from_building` false on indirect weapons, held
by validate_data; `GARRISON_RANGE_BONUS`; a dead occupant frees its slot; overflow waits at the door
and fights; the §5.7 urban target builds no structures, so it cannot see any of this, and
`garrison-probes.ts` is the report-only instrument that can.

- [ ] **Step 4: Gates, commit, PR.** All gates green. Commit
`tools+docs: report-only garrison probes; CLAUDE.md records the garrison rules` —
`tools/src/backtest/garrison-probes.ts CLAUDE.md`. Open the PR (do not merge): title
`sim: the garrison overhaul (#280, #34, #588 items 2-4)`, body with the rulings table, each task's
measured playtest row against this plan's prediction, the re-pins with their reasons, and the
report-only probe outputs; it ends with "🤖 Generated with [Claude Code](https://claude.com/claude-code)".

---

## Out of scope (follow-ups, each its own issue)

- **The range ring of a selected garrisoned unit** (GH-34 acceptance item 3). The renderer draws it
  around the unit's position with `w.range`; after this plan the true envelope is the footprint grown
  by `range + GARRISON_RANGE_BONUS`. A new look: mock first.
- **The bonus in the fire breakdown** (GH-34 item 2). The bonus enters `hitFactors` as a longer
  effective range, so `rangeFalloff` already reflects it; a separate named factor is a HUD change.
- **`hud-model.ts`'s `inReach`** reads `w.range` from the unit's position; for a garrisoned unit it
  under-reports. Fix with a public sim query when the ring is redone.
- **The flag on a held building** (GH-588 item 1). Decided (ruling, lead, 2026-10-14, L-5): a facade
  banner, built separately on `render/garrison-banner`. Nothing here touches it.
- **A garrisoned mortar's card** says nothing about why it is silent. A HUD line, after this lands.
- **A garrisoned §5.7 target.** Not wanted (ruling, lead, 2026-10-14, L-4): §5.7 stays as it is and
  the garrisoned town is a report-only line.

## Execution

Subagent-driven, task by task, with the rulings ledger at
`/Users/ilpinto/dev/roaring-lions-ep/_coord/garrison-overhaul-progress.md`. L-1 to L-5 were ruled on
2026-10-14. Before Task 1: GH-420 merged and the Task 0 pre-flight written.
