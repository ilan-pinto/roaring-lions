# Bir Tarsha: the `mission-author` hand-off checklist

**Status: HAND-OFF CHECKLIST. Docs only.** 16 Nov 2026. The design (`design.md`, PR 1453), the narrative sheet (`narrative.md`,
PR 1456) and the level script (`level-script.md`, PR 1458) are merged on `main`; **the level script is the authority where the
design disagrees** (its §9.0). This file does not restate them. It is the **list of work and of what moves** when the five
missions are authored: per mission, the maps, the data, the tests and the pins, in the order the level script gives (§9.1), updated
for what has changed since it was written.

**What changed since the script (16 Nov):**

| change | effect on this hand-off |
|---|---|
| **GH-1439 has merged** (PR 1480): `escort` takes `fail_after_losses` and `until`, with R1 to R7 checked in the runtime and `tools/validate_objectives.mjs` | **BT IV is no longer blocked on the engine.** The level script's scratch variant (keys removed, outside `data/missions/`) is not needed: IV's `blades` row can be authored as written. What still waits on IV is the harness (section 4) |
| the passengers-only tag fix for the validator (a separate small PR) | no effect here: the four D9s are **directly** tagged placements |
| GH-1387 (the purse binds) and GH-1386 (held-ground income) | **II and IV are economy missions**, so they add winning plans to the banking gate. Section 3 says what that does to a pin, and what to author so it does not |
| the i18n work (GH-1406): the English mission catalogue is generated | five new missions mean `pnpm locales:en -- --write`, and the generated file is checked by `validate:data` (section 2) |
| `data/chat` and the chat work | none |

---

## 1. Global steps, once, before any mission

Run in this order (level script §9.1 steps 1 and 2, with the files named):

1. **Schema.** `data/schemas/mission.schema.json`: add `bir_tarsha` to the `town` enum (G-10).
2. **World.** `data/campaign/world.json`: the town in the `marj` region after `deir_amun`, with the five mission ids; the
   `sur` region's `unlock.after_mission` moves from `deir_amun_3_subterranean` to `bir_tarsha_5_subterranean`. **Two different
   edits, do not confuse them** (level script §9.2). `at` is a placeholder: place the pin against `campaign/world_map.png` so it
   clears Deir Amun's (281.4, 480.9). `world.taken` (19) grows by **5** (four in III, one in V).
3. **Commander.** `data/campaign/commander.json`: `ranks[0].until_mission` moves to `bir_tarsha_5_subterranean`.
4. **Deir Amun III.** `data/missions/deir_amun_3_subterranean.json` `aftermath`: replace with the narrative sheet's new line (level
   script §9.2, 185 characters, under the 240 cap).
5. **GDD §2:** the town list gains Bir Tarsha (G-10).
6. **Maps.** Five maps from two bases: `bir_tarsha` with the variants `bir_tarsha_2` and `bir_tarsha_3`, and `bir_tarsha_4` with the
   variant `bir_tarsha_5`, from the grids in `design.md` §3 (flat, `arid`), with the markers, zones and tunnels of the script's §3.4
   to §7.4 (the script's version of each wins).
7. **Registration.** `packages/data/src/index.ts`: the five maps (the `maps` table, line pattern `deir_amun_3: deirAmun3Map`) and
   the five missions (the `missions` table, `deir_amun_3_subterranean: deirAmun3Subterranean`), each with its `import`.
   Run the suite after: the data package's census tests and the campaign tests are what show a missing registration (I did not confirm
   which one names maps and missions).
8. **Per-map tables.** A new map is named in several fixtures and tests; run the suite and add each (the existing entry for
   `qarn_hadid_3` shows the shape). Known sites: `packages/app/src/ambience.test.ts` (an ambience class per map),
   `crown-summit.test.ts`, `height-blend-field.test.ts` (a heights pair per map), `tools/src/high_ground_maps.test.ts`,
   `tools/src/validate_biome.test.ts`, `packages/app/src/sandbox-anchors.pinned.json` and `terrain-defaults.fixture.json`
   (generated or hand-pinned, per their headers), the free-play picker blurb `freePlay.map.<id>` in `packages/app/src/i18n/en.json`,
   and `packages/worker/src/match/map-ids.ts` only if a map is to be versus-capable (a campaign-only map may not need it: check
   `map-ids.test.ts`). **I read these by searching for where `qarn_hadid_3` is named; the suite is the authority and may find more.**
9. **Text.** The five names, briefings, sections, objective texts, labels and radio lines come from the narrative sheet with the
   script's eight deltas (N-1 to N-8, already carried in the script's fragments). Then `pnpm locales:en -- --write` so
   `data/locales/en/missions.json` carries the new missions (checked by `validate:data`), and two `hostages_place` values
   (`the north of the camp quarter`, `the Fence Road`).
10. **Briefing images.** Five, one per mission. **This is art and waits on the lead's approval of the numbers** (the house rule: no
    render or Meshy call before the lead approves the art numbers). Until then a mission may ship with the schema's allowed absence of
    an image; check `validate_narrative.mjs`.
11. **The doctrine test.** `tools/src/bir_tarsha_doctrine.test.ts` with the script's §8 pins (BT-A1 to BT-A14), each a literal
    from the script's own run and each with its named mutation.

## 2. Per mission

"Script §" is the level script; "Pins" are the §8 doctrine pins. Every mission needs, in addition to its own row: a passive control
that loses (`passiveAcrossSeeds` in `playtest.ts`), a winning plan in `tools/src/backtest/plans/` registered with `run(...)`, a
30-seed slowest win with the **120 s and 20% margin** to `time_limit_s`, and `walk_placements.ts` and `walk_mission.ts` clean.

| | BT I `bir_tarsha_1_recon` | BT II `bir_tarsha_2_foothold` | BT III `bir_tarsha_3_clearance` | BT IV `bir_tarsha_4_clearance` | BT V `bir_tarsha_5_subterranean` |
|---|---|---|---|---|---|
| script | §3 | §4 | §5 | §6 | §7 |
| map | `bir_tarsha` (gate base) | `bir_tarsha_2` (variant) | `bir_tarsha_3` (variant) | `bir_tarsha_4` (strip base) | `bir_tarsha_5` (variant of the strip) |
| phase, limit | recon, 6 min, 720 s | foothold, 7 min, 840 s | clearance, 6 min, 720 s | clearance, 7 min, 840 s | subterranean, 7 min, 840 s |
| economy | no | **yes**: camp, 400 + 120/min, income zone `the_gate` 28 | no | **yes**: camp, 300 + 90/min, no zone | no |
| primaries | locate the gate garrison; evacuate 6 of 8 | hold `the_gate` 240 s; evacuate 7 of 10 (fails at 300 s) | one evacuate (count 3, 360 s, hostages); two `eliminate_hvt`; ceiling 15 | `escort blades`; `raze` and `collapse` `fence_works` 390 s; ceiling 12 | `collapse fence_road` 390 s; ceiling 10 |
| requires, produces | R I, R M C X I E | R I, R M C X E | R I, R M C X H | R I, R M C X | R I, (see design 4) |
| doctrine pins | A1, A13 | A2, A3, A13 | A4, A13 | A5 to A10, A12, A13 | A10, A11, A13 |
| engine or harness | none | none | none | **harness**: section 4 | none |
| ledger keys | the seven shipped keys only; **none new** | same | same | same | same |
| tests that name it | `medic_every_mission` (section 3) | **banking** (section 3), D7 zone-pin | none beyond the global ones | **banking** (section 3) | none beyond the global ones |

Facts to carry from the script into each file, so they are not lost:

- **III:** one `evacuate_before` objective, count 3, **no residents placed** (G-8: with `hostages: true` it counts every civilian,
  not only the tagged ones); the two taken per block are the civilians. Place **no other civilian** on this map.
- **IV:** `fail_after_losses: 2`, `until: ["clear_works", "drop_shafts"]`, `target: "blades"`, four D9s **all directly tagged**
  `blades` (`dozer_d9` is gated at Conduct 87 and `starting_force` ignores gates, so the loan holds, design open decision 4).
  R3: the limit (2) is at most the 4 tagged bodies (pin A12). R4 to R6: both `until` ids are **primaries** and neither is an escort,
  a ceiling or a score (the ceiling is a primary but is not named). R7 does not apply (the blades start outside the zone).
  13 `low_profile` tiles need one `demolish` order each (BT-G1, a design cost, not a defect).
- **V:** the chamber is split into `chamber_reach` and `rescue_refuge` (F-9); five routes (`bt5_d` added, F-8); the captive is a
  surface stand-in (G-5).

## 3. Pins and tests that will move

A first draft from searching the repository for the literals; **the suite finds the real list, and each row is to be re-pinned in
the PR that causes it, never silently.**

| what | where | today | after five missions |
|---|---|---|---|
| the ladder's mission count | `packages/app/src/roar-earn.test.ts` (`LADDER_MISSIONS`) | 29 | **34** |
| `LADDER_STARS` | `tools/src/backtest/playtest.ts` | 68 | **68 plus the five plans' stars** (about 78 at two each; the test derives "the first N at 3, the rest at 2" from it) |
| the lifetime coin total | `roar-earn.test.ts` ("100 + 10 a mission + 5 a star + 100") | 830 | **100 + 340 + 5 x stars + 100**, so about **930** at 78 stars. Hand-compute it; do not let the code recompute it (the casebook's "right-hand side the check recomputed itself" shape) |
| `LADDER_CREDITS` | `playtest.ts` | 6,923 | plus what the five winning plans pay (each win: 100, plus 10 per starting unit home, plus Conduct over the floor, plus 40 per carrying secondary). Measure; do not estimate |
| `ROSTER_MAX` | `playtest.ts` | 26 | read the five missions' rosters; may not move |
| the medic census | `tools/src/medic_every_mission.test.ts` | "29 campaign missions: 29 field the team" | **34**; each new mission fields `inf_medic_squad` or is listed as measured and left out |
| the map census | `tools/src/map_visibility.test.ts` | 29 maps carry the 29 missions; an **84%** visibility gate | 34; each new map must clear 84% (measure; the design's draft numbers do not count) |
| the banking gate | `playtest.ts` `BANKING_OVER_30_MAX` | 15 (of 20 winners) | **II and IV add two winning plans.** If either banks over 30% the count is 16 or 17 and the gate fails. **Author them bound** (below), or re-pin knowingly. The GH-1387 design (the purse binds) needs II and IV to be among the missions whose plan spends |
| the D7 zone pin | `playtest.ts` `ZONE_PASSIVE_INCOME` | 0 | **II's `the_gate` income zone must hold no starting placement**, or the passive control earns from it and the pin fails (a force that never moves must earn nothing from ground). Check `walk_placements.ts` |
| the campaign gates | `packages/app/src/campaign.test.ts` (the `sur` unlock and the commander's `untilMission`), `campaign-close.test.ts` (`gateMission`), `campaign-pay.test.ts` (the mission list) | `deir_amun_3_subterranean` | `bir_tarsha_5_subterranean` for the gate and the rank; the mission lists gain five |
| the generated English catalogue | `data/locales/en/missions.json` | 30 missions | 35 (regenerate; `validate:data` checks it) |
| `world.taken` | `data/campaign/world.json` | 19 | **24** |
| the per-map tables | section 1, step 8 | 29 maps | 34 |

**What "bound" means for II and IV** (so the banking gate holds without a re-pin): the winning plan spends at least 70% of
`logistics_start` plus what it earns, and **the plan that spends nothing does not win**. The shipped campaign shows the pattern is
not automatic: every one of the 20 existing economy plans won with every build and support spend refused on the first seed (measured for the GH-1387 design, a docs PR of 16 Nov). For II
(`400 + 120/min`, a camp) and IV (`300 + 90/min`) the required buy is, by that design's rule, **one of the five ungated units**
(`inf_squad`, `at_team`, `mortar_team`, `apc_eitan`, `jeep_shoded`), never a gated one (a campaign can stand at a Conduct that has not
opened it). The script's II and IV flags do not yet create a required buy; **adding one is authoring work for the mission, and the
oracle is the harness**: the plan with every spend refused must not win.

## 4. What waits on GH-1439 and the harness: BT IV

The engine is done. What remains on IV, in order:

1. **`MissionRuntime.taggedIds(tag)`** (G-16): a read-only getter returning a copy of the `tags` map entry, so a plan can move the
   four tagged blades among other `dozer_d9` units. It reads, never writes (invariant 4). Without it a plan finds units by unit
   type (`ids('dozer_d9')`), which is enough only while the four tagged D9s are the only D9s on the map. **Decide whether the map has
   any other D9** before building the getter; if it has none, the getter is not needed for IV and G-16 can wait.
2. **A plan for IV** with the verbs the script names: one `demolish` per `low_profile` tile (13), `move` for the lane, `chargeTunnel`
   for the shafts. All exist as commands.
3. **Three harness asks** (design §5.7): a **passive** IV must lose to the clock, not stall; a **naive attack-move** must lose a
   blade; the **sensible** plan wins with the ceiling intact and the 120 s and 20% margin. Plus the two probes for the tolerance: one
   plan that deliberately loses two blades and asserts the defeat cause is the escort; one that loses one blade and still wins.
4. **BT-G2** (the group must not stall on the unreachable `far_gate_point` before the T-wall falls): a `walk_mission.ts` check.
5. **Author IV last** (script §9.1 step 4), after I, II, III and V are green, so a harness stall in IV cannot hold the rest.

## 5. Order and gate, per mission

1. Global steps 1 to 5 and 7 (the schema, world, commander, Deir Amun III line, GDD, registration) in one PR; the maps in the next.
2. BT I, II, III, then V, then IV (script §9.1). Each is its own PR, each with: its map, its mission JSON, its plan, its passive
   control, its doctrine pins, the pins that move (section 3) with the new literal and the reason in the commit.
3. Per PR: `pnpm validate:data`, `pnpm test`, `pnpm test:determinism` (must not move: no sim file changes), `pnpm playtest`, the
   per-map tables, `pnpm locales:en -- --write`, `walk_placements.ts` and `walk_mission.ts`. `ui:routes`, `golden-baseline` and
   `ui:shots` are CI's.
4. Each mission's PR body states which pins moved and why, and that **no balance constant changed** (the lead's park).

## 6. What I did not verify

- **No file was written into `data/`, and nothing was run.** Every count is read from the three merged documents and from searching
  the repository for the literals named; `validate:data`, the suite and the harness are the real authority.
- **Section 1 step 8 and section 3 are a first list.** I found the per-map sites by searching for `qarn_hadid_3`; a test that
  enumerates maps without naming one would not show up. The coin total and the star count are formulas, not measurements: the five
  winning plans decide the real numbers.
- **Whether II and IV can be bound** without changing the script's flags is an open authoring question; the GH-1387 design says how
  to test it. If the lead leaves the banking pin to move instead, the re-pin is a named lead decision.
- **The map count after Qasr Liwan.** The arc authors Qasr Liwan first (L-15); if it lands before Bir Tarsha, every "29" and "34"
  here shifts by its five missions.
- **Art.** No image exists for any of the five; the lead's art-number approval gates them.

---

*Written by Claude Code from the merged Bir Tarsha design, narrative sheet and level script. Nothing here is implemented.*
