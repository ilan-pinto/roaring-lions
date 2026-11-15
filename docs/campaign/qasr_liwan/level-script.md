# Qasr Liwan: Level Script

**Act I · The Marj Strip · *The Long Ground*, town 1 of 4 new. Five missions, Option A *Five Doors*.**

**Date:** 2026-11-15 · **Author:** `level-scripter` · **Status:** proposal for `mission-author`. Nothing here was
written into `data/`. The lead approved the arc (GH-1438), this town's design (GH-1445, every O-QL default) and the
narrative sheet (GH-1448 branch) on 15 Nov 2026.

**File name.** The brief names this file `level-script.md`. `docs/campaign/README.md`'s pipeline diagram and the
older towns say `script.md`. This file follows the brief. Rename on merge if the lead prefers the README.

**Read, in this order:** `docs/campaign/README.md`; `data/schemas/mission.schema.json` and
`packages/sim/src/mission.ts` (every shape below was grepped, see §0.2); `design.md`; `narrative.md`;
`the_long_ground/arc-outline.md` (the Qasr Liwan rows only). `dossier.md` was **not** read. The lead's GH-1440 ruling
(real equipment and unit names allowed; real places, people, operations and faiths still banned) was applied: unit
ids below are the shipped ids, and no other proper noun is coined.

**Downstream.**
- `mission-author`: §3 to §7 are the mission bodies, §8 the map and doctrine-test pins, §9 the handoff.
- `sim-guard`: §10, the gap report.
- `narrative-designer`: the text deltas the findings and twists need (F-1, T-QL1a, T-QL1d, T-QL2b).
- `playtest`: the questions in each mission's "Playtest asks".

---

## 0. How to read this script

### 0.1 Status vocabulary

| status | means |
|---|---|
| `live` | every field named in the row exists in `mission.schema.json` and the runtime acts on it today |
| `schema` | the runtime would act, the schema refuses the field |
| `engine` | neither: `sim-guard` work in `stepTriggers` or the runtime |

A row that rides a runtime path no shipped mission has exercised says so in its note (the trigger-keyed waves of QL V).
`world-walk` means `mission-author` must walk it with `walk_mission.ts` once the map exists.

### 0.2 What I checked against the code, and where the brief or the sheets were stale

| # | claim | source | result |
|---|---|---|---|
| 1 | the enemy list is `enemy.garrison`, **singular** | schema `properties.enemy.properties.garrison` | the brief and the design say "garrisons". Fragments use `garrison` |
| 2 | five `on.kind`, six `do.kind` | schema `triggers`; `mission.ts` `stepTriggers` | `first_contact casualties_pct timer_s zone_entered group_in_zone` and `commit withdraw_to spawn reinforce dismount remove` |
| 3 | `say` rides the trigger itself, not `do` | schema `triggers.items.properties.say`; `stepTriggers` pushes it right after the trigger event | speakers `shai idit net enemy`, 240 characters |
| 4 | `ground_only` | `mission.ts` reads `d.ground_only` for `capture` only; the schema lists no such key on an objective or an `on` | **unusable** from JSON. `hold_for` and `zone_entered` count aircraft (G-QL5) |
| 5 | a trigger with no effect | `do: { "kind": "spawn" }` with no `units` passes the schema and `validate_narrative.mjs`'s label rule; the runtime loops `t.do.units ?? []` | a say-only trigger **is expressible today** as an idiom, at the cost of a label (the narrative sheet's G-N1 said it was not). Run in §11 |
| 6 | `commit` / `withdraw_to` on a garrisoned unit | `sim.ts` `move` and `attackMove` call `leaveStructure` | a garrisoned group does leave its post. QL IV's `firing_line` order is real |
| 7 | what `casualties_pct` divides by | `mission.ts` `enemyAtStart` is every side-1 body spawned from `enemy.garrison`, **buried stock and the digger included**; waves and trigger spawns are excluded; a body is dead when `alive` is 0 and `removed` is not 1 | the counts are in F-2 |
| 8 | what contests a hold | `enemyNear`: a living, **surfaced** enemy **inside the zone** within 6 tiles (`CONTEST_RADIUS_SQ` 36) of a player unit inside it | an enemy 1.5 tiles outside `ring_north` does not contest it |
| 9 | spawn spread | `spawnPlacement` offsets body k by `(k mod 3) * 1.25` east and `floor(k / 3) * 1.25` south; `assertGroundClear` throws on a blocked body of any non-garrison, non-buried placement and of every wave marker | checked for every placement here (§11); three design positions would have thrown and two more were re-seated (F-3) |
| 10 | the shepherd rule | `civilians.ts`: a **ground** player unit within 4.0 tiles (`SHEPHERD_RADIUS_SQ`), only in a mission with an `evacuate_before`; suppression above 0.3 also sends a civilian; a free-slot transport boards them | an `apc_eitan` beside the people can carry them |
| 11 | when a stray bills | `mission.ts` `nearMiss`: `collateralRisk >= STRUCTURAL_COLLATERAL` (19661). `sim.ts` stores `fx.from(collateral_risk)`, and 0.3 × 65536 = 19660.8 rounds to 19661 (arithmetic checked; `fx.from` read, not executed, because the worktree has no `node_modules`) | **`at_team`'s Spike (0.30) bills.** It is a knife-edge: pinned as a literal in §8 |
| 12 | trigger-keyed waves | `stepWaves` reads `w.trigger` against a completed objective; the schema still requires `at_seconds` | no shipped wave uses `trigger`. QL V is the first. `world-walk` |
| 13 | `town` enum | schema `properties.town` | has no `qasr_liwan`: G-10, `sim-guard`. The scratch run in §11 uses a stand-in |
| 14 | range | `sim.ts` `rangeSq` is plain centre to centre | no tolerance. A 0.3 margin is a margin of 0.3 |
| 15 | carried tags | `spawnPlacement`: a tag in `intel.marked_positions` spawns **every** placement carrying it identified, and a `locate` on it is complete at t=0 | see F-8 |

---

## 1. The five findings from narrative §11, resolved

| # | finding | resolution | lands in |
|---|---|---|---|
| **D-1** | QL III's three line groups would need nine labelled triggers | **One group, `pause_lines`**, declared on four placements (west, centre rifles, centre RPG, east). A group may span placements (`spawnPlacement` appends to `groups`). The enemy mortar is **not** in it: it is its own group `pause_mortar` and is never committed, because an `attackMove` would walk a mortar crew into the forward ground. The handover party is its own group too (it has its own order at 90 s). **Consequence: T-QL3b "They stood closer" cannot be done as designed.** One `withdraw_to` sends every line to one marker. Doing it per line needs three more groups and three more triggers per break condition, nine in all. Rejected (§5.5) | QL III `enemy.garrison`, `triggers` |
| **D-2** | `casualties_pct(5)` is one-shot and fires on the first enemy death, normally after 240 s | Kept, **with no `say`**, as the sheet recommends. Counted in bodies: QL III starts with **11** side-1 bodies, so `ceil(5 * 11 / 100)` is **1 death**, and the death can be any of the 11 (the handover party, a line, the mortar crew or the yard watch). It fires once; after 240 s it re-issues an order the lines already hold. Re-issuing is not harmless in general (see D-3) but here it is the same marker | QL III `triggers[3]` |
| **D-3** | QL I's two street triggers can both fire | They can. **The second `commit` is not a no-op**: `stepTriggers` queues a fresh `attackMove` with `sweep: true`, so a `street` that has already reached the house and is hunting what its side remembers is pulled back to `the_house` (18,9). That is the intended pressure at 180 s: the street converges on the house, and the player who is fighting it in the lane meets it there. The labels differ (narrative §1.6) because both can print. **T-QL1c** (commit to `house_gate`, so the street stops in the lane and the walk becomes the fight) is the same two triggers with a different `to`. **Not adopted**: it puts the fight on the extraction route and removes the courtyard-as-chokepoint reading. `playtest` A/B (§3.5) | QL I `triggers` |
| **D-4** | QL I's mortar reach: the north road outside the gate is in range, and the extract's west column may be | **Measured.** From the design's (10.5,15.5) the extract zone's nearest edge is **15.7** tiles, inside range 16: a soldier standing on the zone's south-west corner can be shelled. The refuge marker (18.4) was the wrong measure. **`ql_mortar` moves to (8.5,15.5)** (marker `mortar_lot` to (8,15)): the courtyard centre is 11.7, the gate 12.8, the gate lane 13.5, the north road is in range up to tile x=18 (15.6) and out of range from x=19 (16.3), and the extract zone's nearest edge is **17.0**, one full tile clear. Pinned as QL-A8 (§8). Walking the shortest path from the person to the extract, the first 6 of its 9 tiles are under the tube and the last 3 are not | QL I `enemy.garrison`, §8 |
| **D-5** | QL II's AT missile billing | **Confirmed, and it is a knife-edge.** `at_team`'s `spike_atgm` is `collateral_risk` 0.3. `sim.ts` stores `fx.from(0.3)`, which is 19661, and `mission.ts` bills when `collateralRisk >= 19661`, so a Spike stray bills. Rounding the other way would silently unbill it. QL II's briefing is right to name it. Pinned as a literal: `fx.from(0.3) === 19661`, and the weapon list in §8 | §8 |

---

## 2. Findings this pass added (F-1 to F-11)

| # | finding | evidence | what I did |
|---|---|---|---|
| **F-1** | **QL III's `hold_for staging` banks during the pause.** The sheet and design say only "the 150 s before the pause ends are free". `hold_for` accumulates from the first uncontested tick, `staging` is 15 tiles from the start line, and no enemy is within 12 tiles of it until 240 s. A force on it from about 20 s has about 220 s banked when the pause ends and needs about 80 more, so the objective is spent mostly on the quiet, not under the waves | `stepObjectivePass` `hold_for`: `holdTicks` only increments; QL-A7 distances | **Not changed.** The 300 s and its text ("five minutes") are approved, and difficulty is measured, not estimated. The one-field fix is `seconds: 360` with the objective text `Hold the forward ground for six minutes` (39 characters; `narrative-designer` owns it). `playtest` decides (§5.3, ask 1) |
| **F-2** | **`casualties_pct` denominators** include buried stock | finding 7 above | bodies at start: **QL I 8, QL II 14, QL III 11, QL IV 12, QL V 13**. QL II's 50% is **7** deaths of 14; QL IV's is **6** of 12; QL III's 5% is **1** of 11. A collapse that kills a buried stock counts (QL IV: `ql4_yard` holds 3 bodies, so bringing the shaft down is 3 of the 6) |
| **F-3** | **Three positions would have thrown at load, and two more were re-seated** | finding 9, run on the design's grids | QL III `city_west` (6,20) to **(5,21)** (the second body of a count-2 lands on the wall at (7,20)); QL V `vent_shallow_n` (6,24) to **(3,24)** (bodies at 6, 7, 9 hit the wall at (7,24)); QL IV forecourt groups (32,26) and (33,27) to **(30,26) and (30,27)** (a count-3 at 32 puts a body on the east wall at (35,26)); QL III's four taken from (12,37) to **(11,37)** so no body stands in `water_point` at x=15 (no throw, a cosmetic re-seat). QL II's residents move one row north, y 38 to **37**, so they stand inside the flagged `south_quarter` (its rows are 34 to 37); their step walks stay 13, 11 and 12 |
| **F-4** | **A drone can hold QL V's `pump_yard` alone** once the two `pump_guard` are dead (`hold_for` calls `livingIn(zone, 0)` with no ground filter) | `mission.ts` `stepObjectivePass` | the hold completes, the flush waves spawn, and nobody is at the yard for them. Fragments are unchanged. design §5.7 item 6 measures it. **Fallback, expressible today:** delete the `recon_drone` placement from QL V's `starting_force`. The `ugv_recon_dog` (sight 12) and the two `yahalom_squad` (`mark_tunnel`) still map. Proper fix: `ground_only` on `hold_for` (G-QL5) |
| **F-5** | **QL II's last two waves fire only if the holds are delayed.** Both holds can finish by about 300 s, which also ends the evacuation clock | holds accumulate; 120 + 180 + 270 s waves come first | kept as insurance for a force that is contested, not as pressure on a good run. Said so in §4.3 |
| **F-6** | **T-QL3a as designed does nothing.** The fourth of the taken at (10,36) is within 4 tiles of anyone standing within 4 of the other three, so one soldier shepherds all four | `SHEPHERD_RADIUS_SQ` | the working form puts the fourth at least 8.1 tiles away from the three: §5.5 |
| **F-7** | **QL I's `zone_entered(ql_house_yard)` fires on the rescue itself**, and also on a drone | G-QL5 | the quiet route is the gate lane: a soldier at (18,5) is 4.0 tiles from the person at (18.5,9.5) and shepherds without entering the zone. The briefing's "from the lane" is mechanically right |
| **F-8** | **A carried tag completes its `locate` at t=0.** `ql_post_seam`, `ql_yard_watch` are `locate` secondaries in I and III, and are placed in II and IV, but a replay of I or III with the tags already in the ledger spawns them identified and the objective is done on the first tick | finding 15 | inherent to every carrying `locate` (Beit Sahwan I behaves the same). Not fixed. `playtest` reads the replay case |
| **F-9** | **QL-A3's "14 tiles or fewer" is a step count** (8-connected moves), not a length. Weighted lengths run 15% to 20% longer: 16.3 for QL II's far resident | `grids.py` in §11 | the table in §8 gives both. `mission-author` pins the FlowField length and the ≤ 14 holds as steps |
| **F-10** | **First shipped objective-keyed wave** (QL V) | finding 12 | `at_seconds` is set to the objective's own 180 so a tool that sorts by clock sees a sane value. `world-walk` |
| **F-11** | **QL V's flush crews arrive after the hold is already complete.** The `hold_for` is a latch, so the crews do not affect it; they threaten whoever is still standing at the pump yard | `stepObjectivePass` | as designed (design §5.5). Said plainly in §7.3 so no row claims the flush "interrupts" the hold |

---

## 3. QL I: `qasr_liwan_1_recon` · One House

`recon` · night · 6 min (`time_limit_s` 720) · map `qasr_liwan` · no economy · Intel by doing only. Requires **R**,
produces **R M C X I H**. **How much of the edge to look at before going in, against a clock.**

### 3.1 Flags

There are no variables. A flag is an objective id (a wave can key on it), a trigger that has fired, or a ledger tag.

| flag | kind | meaning in the fiction |
|---|---|---|
| `find_the_gate_guard` | objective, primary | the guard on the lane is known. Nothing keys on it |
| `walk_one_out` | objective, primary, **failable** | the person is at the extract before 300 s. On completion the ledger writes `civ.hostages_recovered` (the objective's `count`, 1) |
| `keep_the_street` | objective, primary, **failable** | Conduct lost has stayed at 10 or under |
| `find_the_seam_post` | objective, secondary, `carries` | the sandbag post is known; read by II |
| `the_street_heard_the_courtyard` | trigger, fired | a soldier **or the drone** entered `ql_house_yard` (G-QL5) |
| `the_street_wakes` | trigger, fired | 180 s have passed |
| tags `ql_post_seam` `ql_post_tower` `ql_post_coast` `ql_mortar` | ledger, `intel.marked_positions` | each is written the moment any unit carrying it is identified, objective or not. **II places all four**, so all four carry; only `ql_post_seam` has an objective. `ql_house_guard` and `ql_lane_rpg` are written and read by nobody |

### 3.2 ECA rows

| # | event | IF | THEN | cue bound | status |
|---|---|---|---|---|---|
| 1.01 | `mission_start` | tick 0 | 8 enemy bodies and 1 civilian spawn; Intel 0 | N§1.1 title, N§1.2 dispatch, N§1.3 brief | live |
| 1.02 | `the_street_heard_the_courtyard` | `on: zone_entered ql_house_yard` (any living side-0 unit, aircraft included) | `do: commit street → the_house` | toast = label; N§1.6 Idit (T-QL1b folded in) | live |
| 1.03 | `the_street_wakes` | `on: timer_s 180` | `do: commit street → the_house` (a fresh sweeping order: D-3) | toast = label; N§1.6 Idit | live |
| 1.04 | `wave_210` | `at_seconds 210` | `moto_rpg ×2` spawn at `north_road_w`, attack-move to `ql_extract_point` | N§1.6 Idit wave line | live |
| 1.05 | `find_the_gate_guard` complete | every unit tagged `ql_house_guard` identified | objective complete, +40 Intel | N§1.6 Idit | live |
| 1.06 | `find_the_seam_post` complete | every unit tagged `ql_post_seam` identified | objective complete, +40 Intel; tag already in the ledger from the sighting | N§1.6 Idit | live |
| 1.07 | `evacuated` | a civilian inside `ql_extract` | `clear (1)` toast | `notice.evacuated` | live |
| 1.08 | `walk_one_out` complete | evacuated count ≥ 1 before 300 s | objective complete; `civ.hostages_recovered` written at mission end | N§1.6 Shai | live |
| 1.09 | `walk_one_out` failed | tick ≥ 300 s and count 0 | objective failed, mission lost | N§1.6 Idit `say_on_fail` | live |
| 1.10 | `keep_the_street` failed | `100 - Conduct > 10` | objective failed, mission lost | N§1.6 Shai `say_on_fail` | live |
| 1.11 | `keep_the_street` complete | every other primary complete, same tick | objective complete | none | live |
| 1.12 | `missionEnd` | victory or defeat | debrief | N§1.5 | live |
| 1.13 | identified `ql_mortar` / `ql_post_tower` | a `SimEvent` | two Idit lines | N§1.6 | **engine**: needs `on.kind: tag_identified` (G-LS1). A non-carrying `locate` secondary with a `say` would make each live at 40 Intel apiece and one more objective on the panel; **declined** (§10, O-LS2): Intel buys the barrage the ceiling exists to tempt |

No `first_contact` trigger exists in this mission, by design: it fires on any identification by either side.

### 3.3 AI director

**Cadence.**

| t | what | size | from | to | group |
|---|---|---|---|---|---|
| 180 s | `commit` | group `street` | its post | `the_house` (18,9) | `street` |
| 210 s | wave | 2 `moto_rpg` | `north_road_w` (6,3) | `ql_extract_point` (22,1) | none |

Not on the clock: `the_street_heard_the_courtyard` (`zone_entered` `ql_house_yard` then `commit` `street` to `the_house`).

**Stances.** 8 side-1 bodies at start. Every placement:

| tag / group | unit × count | at (tile) | stance |
|---|---|---|---|
| `ql_house_guard` | `militia_cell` × 1 | (19,5) | `hold_position` |
| `ql_lane_rpg` | `rpg_team` × 1 | (14,7) | `ambush` 3 |
| group `street` | `militia_cell` × 2 | (6,11) | `hold_position` |
| `ql_post_seam` | `militia_cell` × 1 | (7,2) | `hold_position` |
| `ql_post_tower` | `militia_cell` × 1 | (32,5) | `hold_position` |
| `ql_post_coast` | `rpg_team` × 1 | (3,13) | `ambush` 4 |
| `ql_mortar` | `mortar_crew` × 1 | (8,15) | `hold_position` |

**Pressure curve.** Nothing moves until the player moves. The mortar, the lane RPG and the guard are the only things that
can hurt a force at the house, and the guard (sight 7) stands 1.4 tiles from the gate lane. The street wakes on a clock (180 s), or
earlier if anything of the player's, the drone included, enters the courtyard zone. The clock is the pressure: a player
who spends 150 s looking arrives as the street does and must hold the gate. A player who goes in at about 60 s walks the
person out before 180 s and carries one tag. The 210 s riders go straight at the extract and are the last thing on the
board. A passive force parked at (44,2) is 12.4 tiles from the nearest post; the riders spawn 38 tiles west of it and ride
to the extract, 22 tiles from it. It loses at 300 s to its own clock, not to the enemy.

**Playtest asks.** (1) Passive control ends in defeat at 300 s with `walk_one_out` as the cause and no enemy having fired.
(2) No `first_contact` trigger exists. (3) The guard locate is finishable from the lane without entering `ql_house_yard`.
(4) Conduct lost by a plan that never buys fire support is 0, and a plan that buys one barrage and drops it on `ql_lane`
loses 5 (a strike into a flagged zone) plus 6 per house, which the ceiling of 10 makes survivable once and only once.
**Whether a called barrage's structure kills bill the player was not read** (design §5.1): `playtest` or `sim-guard`
confirms `structureDestroyed`'s `by` for a strike. (5) A replay with the tags already in the ledger (F-8).

### 3.4 Map requirements (`qasr_liwan`)

All of these are new: the map does not exist (design §3.1). "Design" means defined in `design.md` §3.4.

| name | kind | where | used by | status |
|---|---|---|---|---|
| `ql_lane` | zone | [12,5,12,10] | `roe.flagged_zones` | new, design |
| `ql_house_yard` | zone | [16,8,4,3] | trigger | new, design |
| `ql_extract` | zone | [20,0,6,3] | `walk_one_out` | new, design |
| `ql_extract_point` | marker | (22,1) | `civilians.refuge`, wave `to` | new, design |
| `the_house` | marker | (18,9) | `commit` | new, design |
| `north_road_w` | marker | (6,3) | wave `from` | new, design |
| `mortar_lot` | marker | **(8,15)**, was (10,15) | informational (the mortar is placed by `at`) | **moved** by D-4 |
| `ql_start` `house_gate` `street_muster` `tower_knoll` `ql_edge` | marker, marker, marker, marker, zone | (44,2) (18,6) (6,11) (32,5) [4,4,36,12] | `map.player_start`; `house_gate` for T-QL1c, `tower_knoll` for T-QL1d; the rest are reference only | new, design |

Tile checks run on the design's grid: every marker passable, every placement body clear of walls (§11).

### 3.5 Twists

Every twist is classified. The baseline fragments adopt **none**; each delta below is exact.

| twist | what turns | class | delta | read by the player | recommendation |
|---|---|---|---|---|---|
| **T-QL1a** "The guard was relieved" | the primary `locate` is not where Idit said | **expressible today** | move the `ql_house_guard` placement from (19.5,5.5) to (12.5,6.5), 6 tiles west on the lane beside `ql_lane_rpg`; swap `find_the_gate_guard`'s `say` for N§8's. **The objective text "Identify the guard on the courtyard gate" becomes false.** It needs `Identify the guard who watches the gate` (38) from `narrative-designer` | Idit says so at the moment of identification | adopt only with the text change. Raises the cost of the approach: the guard now sees the gate from 6 tiles and sits beside the RPG |
| **T-QL1c** "The street waits at the gate" | the street stops in the lane, so the walk out is the fight | **expressible today** | `to` of both street triggers `the_house` to `house_gate` | the lane fills before the player sees it | **not adopted** (D-3) |
| **T-QL1d** "The riders come from the wrong side" | the 210 s riders spawn between the start line and the extract | **expressible today** | wave 210: `from` `tower_knoll`, `to` `ql_extract_point`; the wave `say` ("coming east along the north road") becomes false and needs a new line | Idit's radio line, which must say they come from the east | not adopted: it makes the retreat lane the fight and cannot be read from the map. Measure before use |

### 3.6 Gap report

| gap | effect here | class |
|---|---|---|
| **G-LS1** `on.kind: tag_identified` | row 1.13 (two lines) | engine, `sim-guard` |
| **G-QL5** `ground_only` on `zone_entered` | the drone wakes the street | schema + engine, `sim-guard`. Today: the briefing already says so |
| **G-N1** a say-only trigger without a label | none in QL I; the `spawn`-with-no-units idiom exists but costs a label (§0.2 row 5) | schema, `sim-guard` |
| **G-7** friendly-tagged prisoner | **not used** (L-16) | none |

### 3.7 Copy-ready fragments

Field names are the schema's. `at` values are tile centres. The `town` and the map are `mission-author`'s.

**`starting_force`**

```json ql1.starting_force
[
  {"unit": "recon_drone", "count": 1, "at": [44.5, 3.5]},
  {"unit": "sniper_team", "count": 1, "at": [43.5, 2.5]},
  {"unit": "inf_squad", "count": 2, "at": [44.5, 1.5], "from_ledger": true},
  {"unit": "jeep_shoded", "count": 1, "at": [45.5, 2.5]},
  {"unit": "apc_eitan", "count": 1, "at": [45.5, 4.5]},
  {"unit": "inf_medic_squad", "count": 1, "at": [43.5, 4.5]}
]
```

**`roe`**

```json ql1.roe
{
  "enabled": true,
  "flagged_zones": [
    "ql_lane"
  ]
}
```

**`civilians`**: one person, never characterised (L-16), no other civilian on this mission (G-8)

```json ql1.civilians
{
  "refuge": "ql_extract_point",
  "groups": [
    {"unit": "civilians", "count": 1, "at": [18.5, 9.5]}
  ]
}
```

**`objectives`**

```json ql1.objectives
[
  {"id": "find_the_gate_guard", "type": "locate", "primary": true, "target": "ql_house_guard", "text": "Identify the guard on the courtyard gate", "say": {"speaker": "idit", "text": "That is the guard, on the lane outside the only gate. One man on one gate means they do not think anybody knows about this house."}},
  {"id": "walk_one_out", "type": "evacuate_before", "primary": true, "target": "ql_extract", "count": 1, "seconds": 300, "hostages": true, "text": "Walk one person out to the north road", "say": {"speaker": "shai", "text": "One out and on the road. Get clear of the edge before it finishes waking."}, "say_on_fail": {"speaker": "idit", "text": "The house is gone from us. A picture like that one comes once, and I do not get to buy it twice."}},
  {"id": "keep_the_street", "type": "no_collateral_above", "primary": true, "threshold": 10, "text": "Lose no more than 10 Conduct", "say_on_fail": {"speaker": "shai", "text": "That is past ten on this street, and past ten is the night."}},
  {"id": "find_the_seam_post", "type": "locate", "primary": false, "target": "ql_post_seam", "carries": true, "text": "Identify the sandbag post at the coast junction", "say": {"speaker": "idit", "text": "Sandbag post where the north road meets the coast, facing the way we would come round. It goes on the board, and it will still be there when we come back for that corner."}}
]
```

**`enemy.garrison`**

```json ql1.garrison
[
  {"unit": "militia_cell", "count": 1, "at": [19.5, 5.5], "stance": {"kind": "hold_position"}, "tag": "ql_house_guard"},
  {"unit": "rpg_team", "count": 1, "at": [14.5, 7.5], "stance": {"kind": "ambush", "tiles": 3}, "tag": "ql_lane_rpg"},
  {"unit": "militia_cell", "count": 2, "at": [6.5, 11.5], "stance": {"kind": "hold_position"}, "group": "street"},
  {"unit": "militia_cell", "count": 1, "at": [7.5, 2.5], "stance": {"kind": "hold_position"}, "tag": "ql_post_seam"},
  {"unit": "militia_cell", "count": 1, "at": [32.5, 5.5], "stance": {"kind": "hold_position"}, "tag": "ql_post_tower"},
  {"unit": "rpg_team", "count": 1, "at": [3.5, 13.5], "stance": {"kind": "ambush", "tiles": 4}, "tag": "ql_post_coast"},
  {"unit": "mortar_crew", "count": 1, "at": [8.5, 15.5], "stance": {"kind": "hold_position"}, "tag": "ql_mortar"}
]
```

**`triggers`**

```json ql1.triggers
[
  {"id": "the_street_heard_the_courtyard", "label": "The street heard the courtyard", "on": {"kind": "zone_entered", "zone": "ql_house_yard"}, "do": {"kind": "commit", "group": "street", "to": "the_house"}, "say": {"speaker": "idit", "text": "The street west of you is up and moving on the house. The mortar on the edge is laid on that courtyard, and every second in it is a second under that tube."}},
  {"id": "the_street_wakes", "label": "The street west of the house is waking", "on": {"kind": "timer_s", "value": 180}, "do": {"kind": "commit", "group": "street", "to": "the_house"}, "say": {"speaker": "idit", "text": "Three minutes. The street to the west is up and walking to the house."}}
]
```

**`enemy.waves`**

```json ql1.waves
[
  {"at_seconds": 210, "to": "ql_extract_point", "units": [{"unit": "moto_rpg", "count": 2, "from": "north_road_w"}], "say": {"speaker": "idit", "text": "Two riders coming east along the north road toward the extraction. The edge is awake."}}
]
```

Not in the fragments, from the narrative sheet: `name`, `dispatch`, `briefing`, `debrief`, `hostages_place`
(`a house on the north edge`), `time_limit_s` 720, `target_minutes` 6, `ledger`, `map.time_of_day` `night`.

---

## 4. QL II: `qasr_liwan_2_foothold` · The Ring

`foothold` · 7 min (`time_limit_s` 840) · map `qasr_liwan_2` · **economy** (camp, 400 + 120/min; income `coast_road` 28,
`the_cut` 20). Requires **R I**, produces **R M C X E**. **Hold the seam or keep the checkpoint open.**

### 4.1 Flags

| flag | kind | meaning |
|---|---|---|
| `hold_the_seam` | objective, primary | 240 s of uncontested presence in `ring_north` (accumulates, never resets) |
| `hold_the_cut` | objective, primary | 240 s of uncontested presence in `the_cut` |
| `residents_through` | objective, primary, **failable** | 6 of the 9 at `cut_refuge` before 300 s; the ledger `civ.settlements_evacuated` takes the count that arrived |
| `take_the_coast_road` | objective, secondary | `coast_road` held 15 s uncontested |
| `the_seam_reserve_comes_up` | trigger, fired | a soldier or aircraft entered `ring_north` |
| `the_lanes_move_on_the_checkpoint` | trigger, fired | a soldier or aircraft entered `the_cut` |
| `the_seam_reserve_falls_back` | trigger, fired | 7 of the 14 starting enemy bodies are dead |
| tags `ql_post_seam` `ql_post_coast` `ql_post_tower` `ql_mortar` | ledger, **read** | marked in I means the placement spawns identified, and the ambusher (`ql_post_coast`) forfeits its ambush |

### 4.2 ECA rows

| # | event | IF | THEN | cue bound | status |
|---|---|---|---|---|---|
| 2.01 | `mission_start` | tick 0 | 14 enemy bodies (4 buried), 9 civilians, camp raised; logistics 400 | N§2.1 to N§2.3 | live |
| 2.02 | `wave_120` | `at_seconds 120` | `militia_cell ×2` at `north_muster` → `seam_point` | alert layer only | live |
| 2.03 | `wave_180` | 180 | `militia_cell ×2` + `rpg_team` at `lanes_muster` → `cut_gate` | alert layer only | live |
| 2.04 | `wave_270` | 270 | `technical` at `coast_north` → `coast_point` | N§2.6 Idit wave line | live |
| 2.05 | `wave_330` | 330 | `militia_cell ×3` at `north_muster` → `seam_point` | alert layer only | live |
| 2.06 | `wave_390` | 390 | `moto_rpg ×2` at `lanes_muster` → `cut_gate` | alert layer only | live |
| 2.07 | `the_seam_reserve_comes_up` | `zone_entered ring_north` | `commit seam_reserve → seam_point` | toast; N§2.6 Idit | live |
| 2.08 | `the_lanes_move_on_the_checkpoint` | `zone_entered the_cut` | `commit lanes → cut_gate` | toast; N§2.6 net | live |
| 2.09 | `the_seam_reserve_falls_back` | `casualties_pct 50` | `withdraw_to seam_reserve → north_muster` | toast, no `say` | live |
| 2.10 | `evacuated` ×N | civilian inside `cut_refuge` | `clear (1)` | `notice.evacuated` | live |
| 2.11 | `hold_the_seam` / `hold_the_cut` / `residents_through` / `take_the_coast_road` complete | their conditions | objective complete (+40 Intel each) | N§2.6 Shai, Shai, Idit, net | live |
| 2.12 | `residents_through` failed | tick ≥ 300 s, fewer than 6 out | mission lost | N§2.6 Shai | live |
| 2.13 | `missionEnd` | victory or defeat | debrief | N§2.5 | live |
| 2.14 | a surfaced vent crew inside `ring_north` | `SimEvent ventOpened` | Idit line | N§2.6 | **engine** (G-QL2: a vent opening is a route event) |

The hold pause is automatic (`contestedIn`): a vent crew that has surfaced inside a hold zone stops it counting, a buried
one does not.

### 4.3 AI director

**Cadence.**

| t | what | size | from | to | group |
|---|---|---|---|---|---|
| 120 s | wave | 2 `militia_cell` | `north_muster` (10,7) | `seam_point` (6,3) | none |
| 180 s | wave | 2 `militia_cell` + 1 `rpg_team` | `lanes_muster` (18,31) | `cut_gate` (28,41) | none |
| 270 s | wave | 1 `technical` | `coast_north` (2,0) | `coast_point` (3,40) | none |
| 330 s | wave | 3 `militia_cell` | `north_muster` (10,7) | `seam_point` (6,3) | none |
| 390 s | wave | 2 `moto_rpg` | `lanes_muster` (18,31) | `cut_gate` (28,41) | none |

Not on the clock: `the_seam_reserve_comes_up` (`zone_entered` `ring_north` then `commit` `seam_reserve` to `seam_point`); `the_lanes_move_on_the_checkpoint` (`zone_entered` `the_cut` then `commit` `lanes` to `cut_gate`); `the_seam_reserve_falls_back` (`casualties_pct` 50 then `withdraw_to` `seam_reserve` to `north_muster`).

**Stances.** 14 side-1 bodies at start (4 of them buried):

| tag / group | unit × count | at (tile) | stance |
|---|---|---|---|
| `ql_post_seam` | `militia_cell` × 1 | (7,2) | `hold_position` |
| `ql_post_coast` | `rpg_team` × 1 | (3,13) | `ambush` 4 |
| `ql_post_tower` | `militia_cell` × 1 | (32,5) | `hold_position` |
| `ql_mortar` | `mortar_crew` × 1 | (8,15) | `hold_position` |
| group `seam_reserve` | `militia_cell` × 2 | (10,7) | `hold_position` |
| group `seam_reserve` | `rpg_team` × 1 | (12,7) | `hold_position` |
| group `lanes` | `militia_cell` × 2 | (18,31) | `hold_position` |
| `ql_lanes_rpg` | `rpg_team` × 1 | (23,34) | `ambush` 3 |
| none | `militia_cell` × 2 | (12,12) | buried in `ql2_vent_north` |
| none | `militia_cell` × 1 | (14,31) | buried in `ql2_vent_south` |
| none | `rpg_team` × 1 | (14,31) | buried in `ql2_vent_south` |

**Pressure curve.** Front-loaded and two-headed. Three of the five waves (120, 180, 270) arrive while the player is still
splitting the force; they pull toward the two holds, one at each end of the map, 40 tiles apart. The zone triggers
punish the *first* arrival at either end: the seam reserve is three bodies 1.5 to 2 tiles outside `ring_north`, the lanes
group two bodies 9 tiles north of the checkpoint. The 270 s `technical` is the only vehicle and runs the length of the
coast road, so it hits the seam, then the Cut, then the coast capture: the AT team's job. **The 330 s and 390 s waves
fire only if the holds have been delayed** (F-5): a competent run finishes both holds near 300 s, which also ends the
evacuation clock, so those two are insurance against a stalled force and are not pressure on a good one. The residents
are the soft target: they walk when a soldier is within 4 tiles, and the lanes group is nearer to them than the player
is.

**Playtest asks.** (1) Passive control: defeat at 300 s by `residents_through`; **no resident flees** without a soldier
(the passive probe must read `CivilianFlight.hasFled` for all nine). (2) The swing between I-carried and uncarried:
`ql_post_coast` pre-identified forfeits its ambush; `ql_mortar` pre-identified is still a live tube 12.2 tiles from
`seam_point`. (3) Whether a vent crew inside `ring_north` pins the seam hold so the player cannot do both holds. (4) The
drone is **not** issued, deliberately (design §5.2, G-QL5): `playtest` confirms nothing else in the force can hold a zone
alone. (5) No income zone holds a starting placement (`ZONE_PASSIVE_INCOME` 0).

### 4.4 Map requirements (`qasr_liwan_2`)

| name | kind | where | used by | status |
|---|---|---|---|---|
| `ring_north` | zone | [3,0,8,6] | `hold_the_seam`, trigger | new, design |
| `the_cut` | zone | [24,39,10,5] | `hold_the_cut`, trigger, income | new, design |
| `cut_refuge` | zone | [26,44,6,3] | `residents_through` | new, design |
| `coast_road` | zone | [0,37,6,7] | capture, income | new, design |
| `south_quarter` | zone | [3,34,36,4] | `roe.flagged_zones` | new, design |
| `refuge_point` `seam_point` `cut_gate` `north_muster` `lanes_muster` `coast_north` `coast_point` | markers | (28,45) (6,3) (28,41) (10,7) (18,31) (2,0) (3,40) | refuge, `to`, `from` | new, design |
| `ql_start` `camp_exit` `west_vent_mk` | markers | (44,24) (43,27) (6,38) | player start; production exit; T-QL2b | new, design |
| `ql2_vent_north` | tunnel, `pre_dug` | mouth (12,12), waypoint (8,9), vent (6,5) | `in_tunnel` stock, 2 `militia_cell` | new, design |
| `ql2_vent_south` | tunnel, `pre_dug` | mouth (14,31), waypoint (12,36), vent (6,38) | `in_tunnel` stock, `militia_cell` + `rpg_team` | new, design |

The buried placements carry an `at` on their mouth tile because a placement needs a position; both mouths are passable.

### 4.5 Twists

| twist | class | delta | recommendation |
|---|---|---|---|
| **T-QL2a** "The seam was a decoy" | **expressible today** | delete the two `in_tunnel: ql2_vent_north` bodies (denominator 14 to 12, the 50% trigger to 6); move the three `seam_reserve` bodies to the main street at the coast road, `at` (3.5,16.5) for the two rifles and (5.5,16.5) for the RPG, 13 tiles from `seam_point` instead of 5; swap the trigger `say` for N§8's. Its claim ("The seam's vent is empty") is then true | adopt if the lead wants the seam to be a longer fight. Pre-marked tags from I show the reserve is not there before the player arrives |
| **T-QL2b** "They come through with the residents" | **expressible today** | wave 390 re-timed to **150 s**, `moto_rpg ×2` `from` `west_vent_mk` (6,38) `to` `cut_gate`. At 390 s the residents are home or the clock has ended the mission, so the sheet's timing never meets them | adopt only after `playtest` shows II is not already hard: it lands on the residents' walk |
| **T-QL2c** "The Cut is the brigade's from now on" | **expressible today** | `aftermath` only, held (N§8). Carried by the victory `debrief` | no change |

### 4.6 Gap report

| gap | effect | class |
|---|---|---|
| **G-QL5** | `hold_for` and `zone_entered` count aircraft: why no drone is issued | schema + engine |
| **G-12** | waves cannot come from a tunnel id; the `in_tunnel` stocks vent on their own | engine; the markers stand in |
| **G-QL2** | a vent opening (`route_open`) is not an `on.kind` | engine, `sim-guard` (row 2.14) |
| **G-LS3** | `casualties_pct` has no `group` scope: the reserve falls back when 7 of 14 *anyone* are dead, not when the reserve is | schema + engine, `sim-guard`. Today's stand-in is the whole-force percentage |

### 4.7 Copy-ready fragments

**`starting_force`**

```json ql2.starting_force
[
  {"unit": "inf_squad", "count": 3, "at": [44.5, 23.5], "from_ledger": true},
  {"unit": "at_team", "count": 1, "at": [45.5, 24.5], "from_ledger": true},
  {"unit": "mortar_team", "count": 1, "at": [45.5, 22.5], "from_ledger": true},
  {"unit": "apc_eitan", "count": 2, "at": [43.5, 25.5]},
  {"unit": "jeep_shoded", "count": 1, "at": [43.5, 22.5]},
  {"unit": "ifv_namer", "count": 1, "at": [45.5, 26.5]},
  {"unit": "inf_medic_squad", "count": 1, "at": [42.5, 24.5]}
]
```

**`structures`**, **`resources`**, **`roe`**

```json ql2.structures
[
  {"type": "camp", "at": [44, 27], "size": [2, 2]}
]
```

```json ql2.resources
{
  "logistics_start": 400,
  "logistics_rate_per_min": 120,
  "income_zones": [
    {"zone": "coast_road", "rate_per_min": 28},
    {"zone": "the_cut", "rate_per_min": 20}
  ]
}
```

```json ql2.roe
{
  "enabled": true,
  "flagged_zones": [
    "south_quarter"
  ]
}
```

**`civilians`**: nine residents in three groups, count 6 of 9 on the objective (G-8: no other civilian)

```json ql2.civilians
{
  "refuge": "refuge_point",
  "groups": [
    {"unit": "civilians", "count": 3, "at": [15.5, 37.5]},
    {"unit": "civilians", "count": 3, "at": [19.5, 37.5]},
    {"unit": "civilians", "count": 3, "at": [35.5, 37.5]}
  ]
}
```

**`objectives`**

```json ql2.objectives
[
  {"id": "hold_the_seam", "type": "hold_for", "primary": true, "target": "ring_north", "seconds": 240, "text": "Hold the seam for four minutes", "say": {"speaker": "shai", "text": "The seam is shut. Leave enough on it that it stays that way."}},
  {"id": "hold_the_cut", "type": "hold_for", "primary": true, "target": "the_cut", "seconds": 240, "text": "Hold the Cut checkpoint for four minutes", "say": {"speaker": "shai", "text": "The Cut is ours. From here on it does not get given back."}},
  {"id": "residents_through", "type": "evacuate_before", "primary": true, "target": "cut_refuge", "count": 6, "seconds": 300, "text": "Get six residents south of the Cut", "say": {"speaker": "idit", "text": "Six through the checkpoint and south of the Cut. The rest of the quarter has watched it be done."}, "say_on_fail": {"speaker": "shai", "text": "Five minutes, and they are still in the lanes. A checkpoint nobody can walk through is a wall."}},
  {"id": "take_the_coast_road", "type": "capture", "primary": false, "target": "coast_road", "seconds": 15, "text": "Take the coast road where it meets the Cut", "say": {"speaker": "net", "text": "Coast road junction held. Supply is running along the Cut."}}
]
```

**`enemy.garrison`**

```json ql2.garrison
[
  {"unit": "militia_cell", "count": 1, "at": [7.5, 2.5], "stance": {"kind": "hold_position"}, "tag": "ql_post_seam"},
  {"unit": "rpg_team", "count": 1, "at": [3.5, 13.5], "stance": {"kind": "ambush", "tiles": 4}, "tag": "ql_post_coast"},
  {"unit": "militia_cell", "count": 1, "at": [32.5, 5.5], "stance": {"kind": "hold_position"}, "tag": "ql_post_tower"},
  {"unit": "mortar_crew", "count": 1, "at": [8.5, 15.5], "stance": {"kind": "hold_position"}, "tag": "ql_mortar"},
  {"unit": "militia_cell", "count": 2, "at": [10.5, 7.5], "stance": {"kind": "hold_position"}, "group": "seam_reserve"},
  {"unit": "rpg_team", "count": 1, "at": [12.5, 7.5], "stance": {"kind": "hold_position"}, "group": "seam_reserve"},
  {"unit": "militia_cell", "count": 2, "at": [18.5, 31.5], "stance": {"kind": "hold_position"}, "group": "lanes"},
  {"unit": "rpg_team", "count": 1, "at": [23.5, 34.5], "stance": {"kind": "ambush", "tiles": 3}, "tag": "ql_lanes_rpg"},
  {"unit": "militia_cell", "count": 2, "at": [12.5, 12.5], "in_tunnel": "ql2_vent_north"},
  {"unit": "militia_cell", "count": 1, "at": [14.5, 31.5], "in_tunnel": "ql2_vent_south"},
  {"unit": "rpg_team", "count": 1, "at": [14.5, 31.5], "in_tunnel": "ql2_vent_south"}
]
```

**`triggers`**

```json ql2.triggers
[
  {"id": "the_seam_reserve_comes_up", "label": "The seam's reserve is coming out of the houses", "on": {"kind": "zone_entered", "zone": "ring_north"}, "do": {"kind": "commit", "group": "seam_reserve", "to": "seam_point"}, "say": {"speaker": "idit", "text": "Three more out of the houses at the seam's back. They were waiting for somebody to stand on it."}},
  {"id": "the_lanes_move_on_the_checkpoint", "label": "The lanes are moving on the checkpoint", "on": {"kind": "zone_entered", "zone": "the_cut"}, "do": {"kind": "commit", "group": "lanes", "to": "cut_gate"}, "say": {"speaker": "net", "text": "Two moving south out of the lanes onto the checkpoint."}},
  {"id": "the_seam_reserve_falls_back", "label": "What is left of the seam reserve falls back", "on": {"kind": "casualties_pct", "value": 50}, "do": {"kind": "withdraw_to", "group": "seam_reserve", "to": "north_muster"}}
]
```

**`enemy.waves`**

```json ql2.waves
[
  {"at_seconds": 120, "to": "seam_point", "units": [{"unit": "militia_cell", "count": 2, "from": "north_muster"}]},
  {"at_seconds": 180, "to": "cut_gate", "units": [{"unit": "militia_cell", "count": 2, "from": "lanes_muster"}, {"unit": "rpg_team", "count": 1, "from": "lanes_muster"}]},
  {"at_seconds": 270, "to": "coast_point", "units": [{"unit": "technical", "count": 1, "from": "coast_north"}], "say": {"speaker": "idit", "text": "A technical coming down the coast road from the north, past the seam and on to the Cut."}},
  {"at_seconds": 330, "to": "seam_point", "units": [{"unit": "militia_cell", "count": 3, "from": "north_muster"}]},
  {"at_seconds": 390, "to": "cut_gate", "units": [{"unit": "moto_rpg", "count": 2, "from": "lanes_muster"}]}
]
```

Not in the fragments: `name`, `dispatch`, `briefing`, `debrief`, `time_limit_s` 840, `target_minutes` 7, `ledger`.

---

## 5. QL III: `qasr_liwan_3_buildup` · The Pause

`buildup` · 7 min (`time_limit_s` 840) · map `qasr_liwan_3` · **economy** (camp, 500 + 150/min, Intel 0; income
`water_point` 80) · ceiling **5**. Requires **R**, produces **R M C X I H**. **What to build, and where to stand when it
ends.** The Marj's first build-up, so its commit also carries the re-briefs of narrative §9.

### 5.1 Flags

| flag | kind | meaning |
|---|---|---|
| `bring_four_across` | objective, primary, **failable** | all four of the taken at `pause_refuge` before 330 s; writes `civ.hostages_recovered` 4 |
| `hold_the_forward_ground` | objective, primary | 300 s uncontested presence in `staging`, **banked from the first tick** (F-1) |
| `keep_the_pause` | objective, primary, **failable** | Conduct lost has stayed at 5 or under |
| `take_the_water_point`, `find_the_yard_watch` | objectives, secondary (the second `carries` → IV) | the cistern held 15 s; the yard watch identified |
| `the_handover_party_steps_back` | trigger, fired | 90 s: the two rifles at the handover have gone to (17,25) |
| **"the pause is broken"** | **three triggers, no composite flag** | `the_pause_ends` (240 s), `ours_over_the_south_street` (any player unit, aircraft included, in `pause_line`), `the_first_of_theirs_down` (1 of the 11 start bodies dead). The first to fire commits `pause_lines`; the other two re-issue the same order |
| tag `ql_yard_watch` | ledger | written on the sighting; IV places it and spawns it identified, ambush forfeit |

### 5.2 ECA rows

| # | event | IF | THEN | cue bound | status |
|---|---|---|---|---|---|
| 3.01 | `mission_start` | tick 0 | 11 enemy bodies, 4 civilians, camp raised; logistics 500, Intel 0 | N§3.1 to N§3.3 | live |
| 3.02 | `the_handover_party_steps_back` | `timer_s 90` | `withdraw_to handover_party → handover_withdraw` | toast; N§3.7 Idit | live |
| 3.03 | `the_pause_ends` | `timer_s 240` | `commit pause_lines → staging_point` | toast; N§3.7 Shai | live |
| 3.04 | `ours_over_the_south_street` | `zone_entered pause_line` | `commit pause_lines → staging_point` | toast; N§3.7 Idit | live |
| 3.05 | `the_first_of_theirs_down` | `casualties_pct 5` (= 1 of 11 bodies) | `commit pause_lines → staging_point` | toast, **no `say`** (D-2) | live |
| 3.06 | `wave_240_north` | `at_seconds 240` | `militia_cell ×3` + `rpg_team` at `city_north` → `staging_point` | alert layer | live |
| 3.07 | `wave_240_west` | `at_seconds 240` | `militia_cell ×2` at `city_west` → `water_mk` | alert layer | live |
| 3.08 | `wave_300` | `at_seconds 300` | `technical` + `moto_rpg ×2` at `city_east` → `staging_point` | N§3.7 Idit wave line | live |
| 3.09 | `wave_390` | `at_seconds 390` | `militia_cell ×2` + `rpg_team` at `city_north` → `staging_point` | alert layer | live |
| 3.10 | `evacuated` ×4 | civilian inside `pause_refuge` | `clear (1)` | `notice.evacuated` | live |
| 3.11 | `bring_four_across` complete / failed | 4 out; tick ≥ 330 s | complete (+40 Intel) / mission lost | N§3.7 Shai, Shai | live |
| 3.12 | `hold_the_forward_ground` complete | 300 s banked | complete | N§3.7 net | live |
| 3.13 | `keep_the_pause` failed / complete | `100 - Conduct > 5` / every other primary complete | mission lost / complete | N§3.7 Shai | live |
| 3.14 | `take_the_water_point`, `find_the_yard_watch` complete | their conditions | complete (+40 Intel each) | N§3.7 net, Idit | live |
| 3.15 | `missionEnd` victory | all three primaries | `aftermath` + `debrief` | N§3.5, N§3.6 | live |
| 3.16 | `missionEnd` defeat | any cause | `debrief` | N§3.6 | live |
| 3.17 | a side-0 `fire` before 240 s | `SimEvent fire` in a time window | Shai line | N§3.7 | **engine**: no trigger watches a `SimEvent`, and no condition carries a window (G-6) |

### 5.3 AI director

**Cadence.** The orders (triggers) and the waves, in clock order:

| t | what | size | from | to | group |
|---|---|---|---|---|---|
| 0 | all start garrisons placed | 11 | n/a | n/a | n/a |
| 90 s | `withdraw_to` handover party | 2 | (11,34) | `handover_withdraw` (17,25) | `handover_party` |
| 240 s | `commit` (trigger, or earlier on a break) | 7 (west 2, centre 3, east 2) | their lines | `staging_point` (28,38) | `pause_lines` |
| 240 s | wave | 3 `militia_cell` + 1 `rpg_team` | `city_north` (21,18) | `staging_point` | none |
| 240 s | wave | 2 `militia_cell` | `city_west` (5,21) | `water_mk` (17,38) | none |
| 300 s | wave | `technical` + 2 `moto_rpg` | `city_east` (39,18) | `staging_point` | none |
| 390 s | wave | 2 `militia_cell` + `rpg_team` | `city_north` | `staging_point` | none |

**Stances.** Everything is `hold_position`; nothing is committed until the pause breaks. Every placement:

| tag / group | unit × count | at (tile) | stance |
|---|---|---|---|
| group `handover_party` | `militia_cell` × 2 | (11,34) | `hold_position` |
| group `pause_lines` | `militia_cell` × 2 | (5,25) | `hold_position` |
| group `pause_lines` | `militia_cell` × 2 | (22,24) | `hold_position` |
| group `pause_lines` | `rpg_team` × 1 | (22,23) | `hold_position` |
| group `pause_lines` | `militia_cell` × 2 | (39,24) | `hold_position` |
| group `pause_mortar` | `mortar_crew` × 1 | (17,24) | `hold_position` |
| `ql_yard_watch` | `rpg_team` × 1 | (27,22) | `hold_position` |

**Pressure curve.** A quiet that the player can spend and a cliff after it. For 240 s the only living enemy within 11 tiles of
any zone the player needs is the handover party (until 90 s). The distances are in §8 (QL-A7): the nearest line is 11.3
tiles from `handover` and 12.0 from `staging`, and the longest ground sight in the issued force is 10. At 240 s seven
bodies commit from the north-west, centre and east at once, two more come from the west at the water point, and 60 s later
the only wheels in the mission arrive from the east. The 390 s group is a second push for a force that is still in
`staging` and still alive. **The pressure curve is a step at 240 s, not a ramp**, and the player picks where he is
standing when it arrives. The fastest way to break the pause early is a single enemy death (1 of 11), which any player
fire can cause; the safest way to look at the yard is south of `pause_line` (y ≥ 34.0 for the drone, whose sight is 16).
**The enemy mortar is the one piece of the director that can hurt the taken after the pause breaks**: it is 12.4 tiles from
the handover, in range, and it has no `group` order, so it stays on its tile.

**Playtest asks.**
1. **F-1: how much of `staging` is banked when the pause ends**, in a plan that stands in it from 20 s. The answer decides
   `seconds: 300` against `360`.
2. **The pause holds.** A plan that receives the taken between 90 s and 240 s with the mortar and AT team on ambush sees
   no enemy fire before 240 s. If fire comes, §8's distances are wrong (they are circles, not `losRay`).
3. **Ceiling 5.** Print Conduct lost by the winning plan beside 5. One stray in the handover is 5 and passes; a second
   fails. A plan that wins at exactly 5 is a warning.
4. **The careless volley.** A mortar left on its default stance with the drone's look identified: confirm whether it
   fires. From the start tile the nearest body the drone can identify is the east line, 22 tiles away and out of the
   mortar's 18, so the design's own scenario needs the mortar moved forward first.
5. **`casualties_pct 5`**: killing `ql_yard_watch` or a handover-party rifleman at 60 s breaks the pause. The player
   reads it from the label.
6. **Passive control**: defeat at 330 s by `bring_four_across`, with `hold_the_forward_ground` open.
7. **The taken boarding the APC.** `civilians.ts` boards a free-slot transport. Confirm it does not make the walk trivial.

### 5.4 Map requirements (`qasr_liwan_3`)

| name | kind | where | used by | status |
|---|---|---|---|---|
| `staging` | zone | [24,36,10,4] | `hold_the_forward_ground` | new, design |
| `handover` | zone | [9,36,6,4] | `roe.flagged_zones` | new, design |
| `walk_south` | zone | [9,40,7,3] | `roe.flagged_zones` | new, design |
| `pause_refuge` | zone | [9,43,7,4] | `bring_four_across` | new, design |
| `water_point` | zone | [15,37,5,3] | capture, income | new, design |
| `pause_line` | zone | [3,32,37,2] | trigger | new, design. Its south edge is y = 34.0 |
| `pause_refuge_point` | marker | (12,45) | `civilians.refuge` | new, design |
| `handover_withdraw` | marker | (17,25) | `withdraw_to` | new, design |
| `staging_point` `water_mk` | markers | (28,38) (17,38) | wave and `commit` `to` | new, design |
| `city_north` `city_east` | markers | (21,18) (39,18) | wave `from` | new, design |
| `city_west` | marker | **(5,21)**, was (6,20) | wave `from` | **moved** (F-3) |
| `ql_start` `camp_exit` `handover_point` | markers | (42,45) (41,43) (12,38) | player start; production exit; reference only | new, design |

The map has the water point's cistern (rows 1, 38 to 42) and **no** seam berm (row 1), per design §3.3.

### 5.5 Twists

| twist | class | delta | recommendation |
|---|---|---|---|
| **T-QL3a (working form)** "One of them is not walking" | **expressible today** | `civilians.groups`: three at (11.5,37.5) and **one at (2.5,38.5)**, 9.1 tiles from the three (the design's (10,36) is within 4 of the same soldier: F-6). Swap the `the_handover_party_steps_back` `say` for N§8's. The fourth's walk is 10 steps (12.9 length) | **adopt**, then measure: it forces the player to split two soldiers inside the quiet, and the briefing's "bring all four" already carries it. The fourth stands 13.3 tiles from the nearest line |
| **T-QL3b** "They stood closer" | expressible today at nine times the cost | `withdraw_to` per line needs one group per line, then three triggers per break (D-1) | **rejected** |
| **T-QL3c** "The pause ends early, and nobody fired" | expressible today (a `timer_s 200` commit) | one trigger | **rejected**, on design §5.3's ground: it teaches that restraint is not rewarded |
| **T-QL3d** "The fourth arrives late" | **engine** | needs `do: spawn` on side 2 (G-QL3) so a civilian can appear at 150 s | owner `sim-guard`; not for this pass |
| **T-QL3e** "One of the taken is executed at 200 s unless reached" | **schema field** + runtime | needs `do: { kind: "execute", tag }`; the nearest thing today is `evacuate_before` failing, which ends the mission rather than turning it | **not recommended**: the clock would punish the player for obeying the pause. Recorded because the brief asks for the class |

### 5.6 Gap report

| gap | effect | class |
|---|---|---|
| **G-6** a real weapons-held window | the pause is distance, stance and three triggers; row 3.17 waits on it | engine, `sim-guard` |
| **G-QL3** `spawn` on side 2 | T-QL3d | engine, `sim-guard` |
| **G-QL5** `ground_only` | the drone breaks the pause as surely as a squad | schema + engine |
| **G-LS3** `casualties_pct` scoped to a group | the pause breaks on any of 11 deaths, including the yard watch's | schema + engine |
| **G-QL1** per-placement `roe_penalty` | none here (the ceiling is 5, not a multiplier) | n/a |

### 5.7 Copy-ready fragments

**`starting_force`**

```json ql3.starting_force
[
  {"unit": "inf_squad", "count": 3, "at": [42.5, 44.5], "from_ledger": true},
  {"unit": "at_team", "count": 1, "at": [43.5, 46.5], "from_ledger": true},
  {"unit": "mortar_team", "count": 1, "at": [41.5, 46.5], "from_ledger": true},
  {"unit": "apc_eitan", "count": 1, "at": [40.5, 45.5]},
  {"unit": "jeep_shoded", "count": 1, "at": [40.5, 44.5]},
  {"unit": "recon_drone", "count": 1, "at": [43.5, 45.5]},
  {"unit": "inf_medic_squad", "count": 1, "at": [41.5, 44.5]}
]
```

**`structures`**, **`resources`**, **`roe`**

```json ql3.structures
[
  {"type": "camp", "at": [44, 44], "size": [2, 2]}
]
```

```json ql3.resources
{
  "logistics_start": 500,
  "logistics_rate_per_min": 150,
  "intel_start": 0,
  "income_zones": [
    {"zone": "water_point", "rate_per_min": 80}
  ]
}
```

```json ql3.roe
{
  "enabled": true,
  "flagged_zones": [
    "handover",
    "walk_south"
  ]
}
```

**`civilians`**: the taken, one group of four, nobody else placed (G-8)

```json ql3.civilians
{
  "refuge": "pause_refuge_point",
  "groups": [
    {"unit": "civilians", "count": 4, "at": [11.5, 37.5]}
  ]
}
```

**`objectives`**

```json ql3.objectives
[
  {"id": "bring_four_across", "type": "evacuate_before", "primary": true, "target": "pause_refuge", "count": 4, "seconds": 330, "hostages": true, "text": "Bring all four of the taken south of the Cut", "say": {"speaker": "shai", "text": "Four across. Whatever happens on the forward ground now, that part is done."}, "say_on_fail": {"speaker": "shai", "text": "Not all four are across, and that ground will not be quiet again. There is no second handover."}},
  {"id": "hold_the_forward_ground", "type": "hold_for", "primary": true, "target": "staging", "seconds": 300, "text": "Hold the forward ground for five minutes", "say": {"speaker": "net", "text": "Forward ground held. The checkpoint has a line in front of it again."}},
  {"id": "keep_the_pause", "type": "no_collateral_above", "primary": true, "threshold": 5, "text": "Lose no more than 5 Conduct", "say_on_fail": {"speaker": "shai", "text": "That is more than five Conduct, and five was all the pause had to give."}},
  {"id": "take_the_water_point", "type": "capture", "primary": false, "target": "water_point", "seconds": 15, "text": "Take the water point west of the checkpoint", "say": {"speaker": "net", "text": "Water point held. It pays for the next fight from here."}},
  {"id": "find_the_yard_watch", "type": "locate", "primary": false, "target": "ql_yard_watch", "carries": true, "text": "Identify the watch in the clinic yard", "say": {"speaker": "idit", "text": "Rocket team standing in the clinic yard, on the open ground. He goes on the board, and he does not get the first shot when we go in there."}}
]
```

**`enemy.garrison`**

```json ql3.garrison
[
  {"unit": "militia_cell", "count": 2, "at": [11.5, 34.5], "stance": {"kind": "hold_position"}, "group": "handover_party"},
  {"unit": "militia_cell", "count": 2, "at": [5.5, 25.5], "stance": {"kind": "hold_position"}, "group": "pause_lines"},
  {"unit": "militia_cell", "count": 2, "at": [22.5, 24.5], "stance": {"kind": "hold_position"}, "group": "pause_lines"},
  {"unit": "rpg_team", "count": 1, "at": [22.5, 23.5], "stance": {"kind": "hold_position"}, "group": "pause_lines"},
  {"unit": "militia_cell", "count": 2, "at": [39.5, 24.5], "stance": {"kind": "hold_position"}, "group": "pause_lines"},
  {"unit": "mortar_crew", "count": 1, "at": [17.5, 24.5], "stance": {"kind": "hold_position"}, "group": "pause_mortar"},
  {"unit": "rpg_team", "count": 1, "at": [27.5, 22.5], "stance": {"kind": "hold_position"}, "tag": "ql_yard_watch"}
]
```

**`triggers`**

```json ql3.triggers
[
  {"id": "the_handover_party_steps_back", "label": "The party at the handover steps back", "on": {"kind": "timer_s", "value": 90}, "do": {"kind": "withdraw_to", "group": "handover_party", "to": "handover_withdraw"}, "say": {"speaker": "idit", "text": "The party with them has stepped back toward the city. Nobody is standing over the four now."}},
  {"id": "the_pause_ends", "label": "The pause is over", "on": {"kind": "timer_s", "value": 240}, "do": {"kind": "commit", "group": "pause_lines", "to": "staging_point"}, "say": {"speaker": "shai", "text": "Four minutes. Everything they kept out of sight is walking at the forward ground."}},
  {"id": "ours_over_the_south_street", "label": "Our units are over the south street", "on": {"kind": "zone_entered", "zone": "pause_line"}, "do": {"kind": "commit", "group": "pause_lines", "to": "staging_point"}, "say": {"speaker": "idit", "text": "Something of ours is over the south street, and their lines can see it. Whatever quiet was left is gone."}},
  {"id": "the_first_of_theirs_down", "label": "One of theirs is down and their lines move", "on": {"kind": "casualties_pct", "value": 5}, "do": {"kind": "commit", "group": "pause_lines", "to": "staging_point"}}
]
```

**`enemy.waves`**

```json ql3.waves
[
  {"at_seconds": 240, "to": "staging_point", "units": [{"unit": "militia_cell", "count": 3, "from": "city_north"}, {"unit": "rpg_team", "count": 1, "from": "city_north"}]},
  {"at_seconds": 240, "to": "water_mk", "units": [{"unit": "militia_cell", "count": 2, "from": "city_west"}]},
  {"at_seconds": 300, "to": "staging_point", "units": [{"unit": "technical", "count": 1, "from": "city_east"}, {"unit": "moto_rpg", "count": 2, "from": "city_east"}], "say": {"speaker": "idit", "text": "Wheels from the east end of the city, a technical and two bikes, for the forward ground."}},
  {"at_seconds": 390, "to": "staging_point", "units": [{"unit": "militia_cell", "count": 2, "from": "city_north"}, {"unit": "rpg_team", "count": 1, "from": "city_north"}]}
]
```

Not in the fragments: `name`, `dispatch`, `aftermath`, `briefing`, `debrief`, `hostages_place` (`the Cut`),
`time_limit_s` 840, `target_minutes` 7, `ledger`. The re-briefs of narrative §9.1 and §9.2 land in this mission's commit.

---

## 6. QL IV: `qasr_liwan_4_clearance` · The Clinic Yard

`clearance` · 7 min (`time_limit_s` 840) · map `qasr_liwan_4` · no economy · ceiling **10**, `structure_penalty_mult` **2**.
Requires **R I**, produces **R M C X I E**. **Which weapon you may use beside a clinic.**

### 6.1 Flags

| flag | kind | meaning |
|---|---|---|
| `take_the_yard` | objective, primary | 15 s uncontested presence in `clinic_yard`; **it gates nothing**: no objective or trigger waits on it, so "yard first" is advice the briefing gives, not a mechanic |
| `walk_the_forecourt_out` | objective, primary, **failable** | 5 of the 6 at `clinic_refuge` before 300 s (`civ.settlements_evacuated` gets the count) |
| `bring_the_shaft_down` | objective, primary, **failable** | the one route whose mouth is in `clinic_yard` is collapsed before 360 s |
| `keep_the_clinic` | objective, primary, **failable** | Conduct lost has stayed at 10 or under. The clinic alone is 6 × 2 = 12 |
| `the_yard_commander` | objective, secondary | `ql_yard_commander` killed (not removed) |
| `the_shore_lane_moves_on_the_yard`, `the_firing_line_leaves` | triggers, fired | a unit entered `compound`; 6 of the 12 start bodies are dead |
| tags `ql_yard_watch` (read), `ql_shore_watch` (written, read by V) | ledger | |

### 6.2 ECA rows

| # | event | IF | THEN | cue bound | status |
|---|---|---|---|---|---|
| 4.01 | `mission_start` | tick 0 | 12 enemy bodies (3 buried), 6 civilians | N§4.1 to N§4.2 | live |
| 4.02 | `the_shore_lane_moves_on_the_yard` | `zone_entered compound` | `commit quarter → yard_point` | toast; N§4.5 net | live |
| 4.03 | `the_firing_line_leaves` | `casualties_pct 50` (= 6 of 12) | `withdraw_to firing_line → north_muster` (garrisoned units leave their post) | toast; N§4.5 Idit | live |
| 4.04 | `wave_150` | `at_seconds 150` | `militia_cell ×2` at `north_muster` → `yard_point` | alert layer | live |
| 4.05 | `wave_270` | `at_seconds 270` | `technical` + `rpg_team` at `east_muster` → `south_gate` | N§4.5 Idit wave line | live |
| 4.06 | `evacuated` ×N | civilian inside `clinic_refuge` | `clear (1)` | `notice.evacuated` | live |
| 4.07 | `take_the_yard` complete | 15 s held | complete (+40 Intel) | N§4.5 Idit | live |
| 4.08 | `walk_the_forecourt_out` complete / failed | 5 out; tick ≥ 300 s | complete / mission lost | N§4.5 Shai, Shai | live |
| 4.09 | `bring_the_shaft_down` complete / failed | route collapsed; tick ≥ 360 s | complete / mission lost | N§4.5 Shai, Idit | live |
| 4.10 | `keep_the_clinic` failed / complete | `100 - Conduct > 10` / all other primaries complete | mission lost / complete | N§4.5 Shai | live |
| 4.11 | `the_yard_commander` complete | tag dead, not removed | complete (+40 Intel) | N§4.5 Idit | live |
| 4.12 | `missionEnd` | victory or defeat | debrief | N§4.4 | live |
| 4.13 | identified `ql_shore_watch` | `SimEvent` | Idit line | N§4.5 | **engine** (G-LS1 `tag_identified`) |
| 4.14 | a `mbt_lavi` `gun_120` impact in `clinic` | `SimEvent fire` | Shai line | N§4.5 | **engine**; low value, **declined**: the briefing already says it |

### 6.3 AI director

**Cadence.**

| t | what | size | from | to | group |
|---|---|---|---|---|---|
| 150 s | wave | 2 `militia_cell` | `north_muster` (21,8) | `yard_point` (27,24) | none |
| 270 s | wave | 1 `technical` + 1 `rpg_team` | `east_muster` (40,12) | `south_gate` (29,30) | none |

Not on the clock: `the_shore_lane_moves_on_the_yard` (`zone_entered` `compound` then `commit` `quarter` to `yard_point`); `the_firing_line_leaves` (`casualties_pct` 50 then `withdraw_to` `firing_line` to `north_muster`).

**Stances.** 12 side-1 bodies at start (3 buried). Every placement:

| tag / group | unit × count | at (tile) | stance |
|---|---|---|---|
| `ql_yard_watch` | `rpg_team` × 1 | (23,24) | `ambush` 3 |
| `ql_yard_commander` | `militia_cell` × 1 | (27,18) | `hold_position` |
| group `firing_line` | `militia_cell` × 1 | (21,18) | `garrison` F at (22,18) |
| group `firing_line` | `militia_cell` × 1 | (36,23) | `garrison` F at (37,23) |
| group `firing_line` | `rpg_team` × 1 | (36,23) | `garrison` F at (37,23) |
| group `firing_line` | `militia_cell` × 1 | (21,30) | `garrison` F at (22,30) |
| group `quarter` | `militia_cell` × 2 | (19,23) | `hold_position` |
| `ql_shore_watch` | `rpg_team` × 1 | (15,26) | `hold_position` |
| none | `militia_cell` × 2 | (26,21) | buried in `ql4_yard` |
| none | `rpg_team` × 1 | (26,21) | buried in `ql4_yard` |

**Pressure curve.** The yard is the objective and every enemy is placed to make *fire* the only way to take it. The crews
under it (3 bodies) surface to fire a volley and pause the capture whenever they are up; the commander stands outside the
zone at the north gate (1.5 tiles from its edge), where he cannot contest it and cannot be shot at without rounds landing near the
yard. The three firing positions are ordinary garrisons on `F` structures that cost nothing to level, but the east one
is 3 tiles from the clinic wall, so a missed gun round lands in zone `clinic`. At 150 s two come in through the north
gate, at 270 s a technical and an RPG team come for the south gate, the walk's exit. A player who walks the people first
meets 270 s with the walk done; a player who clears the yard first meets it with the walk unstarted, and the people in the
gate. Neither order is forced. **The 50% trigger's six deaths are counted over all 12 start bodies, buried stock included: if the stock is still below
when the route comes down, its 3 deaths are half of what the firing line needs to leave.**

**Playtest asks.**
1. **Ceilings.** The clinic alone fails the mission (12). Two strays into `clinic` (10) pass; three fail. A civilian (8)
   plus one stray (5) fails. Print the plan's loss beside 10.
2. **Weapons.** Confirm the Lavi's coax (0.20) and every rifle (0.10) cost nothing beside the east F, and the main gun
   (0.55), the Namer's cannon (0.35) and the Spike (0.30, §8) each bill a stray in `clinic`.
3. **A house costs 12 at ×2** and a shanty 4: any plan that levels one by a stray fails.
4. **Passive control**: defeat at 300 s by `walk_the_forecourt_out`, no clinic civilian having fled. Then `collapse` at
   360 s.
5. **The identify-then-charge chain** from the lane (the route runs under the west wall): `world-walk` with the dog.
6. **`take_the_yard` is winnable** with the buried crew alive: the capture only pauses while they are up.

### 6.4 Map requirements (`qasr_liwan_4`)

| name | kind | where | used by | status |
|---|---|---|---|---|
| `clinic_yard` | zone | [25,20,5,9] | `take_the_yard`, `bring_the_shaft_down` | new, design. **Open ground and sandbags only** (QL-A4) |
| `clinic` | zone | [30,21,5,8] | `roe.flagged_zones` | new, design. Holds exactly one `clinic` |
| `compound` | zone | [24,19,12,11] | trigger | new, design |
| `clinic_refuge` | zone | [25,37,8,3] | `walk_the_forecourt_out` | new, design |
| `clinic_refuge_point` `yard_point` `north_muster` `east_muster` `south_gate` | markers | (29,38) (27,24) (21,8) (40,12) (29,30) | refuge, `to`, `from` | new, design |
| `ql_start` | marker | (28,44) | `map.player_start` | new, design |
| `ql4_yard` | tunnel, `pre_dug` | mouth (26,21), waypoints (23,22) (23,27), vent (27,27) | `collapse` target, `in_tunnel` stock | new, design |

Three `F` structures (`militia_firing_position`) at [22,18], [37,23] and [22,30], 2×2 each, per design §3.3. The garrison
`building` field names a tile of each.

### 6.5 Twists

| twist | class | delta | recommendation |
|---|---|---|---|
| **T-QL4a** "The mouth moved" | **expressible today** | move `ql4_yard`'s mouth to the south end, (26,27), and add a decoy `ql4_decoy` (`pre_dug`, no stock, mouth **outside** `clinic_yard`, e.g. (22,25) with its vent at (22,21)); swap `take_the_yard`'s `say` for N§8's. The collapse still wants one route | adopt if the lead wants the mapping to matter in IV. The decoy must be outside the zone or it becomes a second primary target |
| **T-QL4b** "The commander goes to ground" | **expressible today** | give the commander's placement `group: "yard_commander"`; add `casualties_pct 30` (= 4 of 12) `withdraw_to yard_commander → shore_lane` (new marker, e.g. (17,24)); label `The yard commander runs for the shore lanes` (43) | adopt: the secondary becomes a decision. He is not `remove`d, so the objective stays reachable |
| **T-QL4c** "Nothing beneath the clinic" | not a twist | no line, no placement (L-11) | by rule |
| **T-QL4d** "The crew below speaks when the shaft opens" | **engine** | needs a trigger on a route event (G-QL2) and `speaker: enemy`, which the town forbids (narrative §0.2) | **not recommended** |

### 6.6 Gap report

| gap | effect | class |
|---|---|---|
| **G-QL1** per-placement `roe_penalty` | `structure_penalty_mult` 2 prices every house at 12 | schema + engine, `sim-guard` |
| **G-5** player units below ground | charges are worked from the surface | engine |
| **G-12** | `ql4_yard`'s crew vent on their own | engine |
| **G-LS1** `tag_identified` | row 4.13 | engine |
| **G-LS3** `casualties_pct` scoped to a group | the firing line leaves on 6 of 12 anyone | schema + engine |

### 6.7 Copy-ready fragments

**`starting_force`**

```json ql4.starting_force
[
  {"unit": "yahalom_squad", "count": 1, "at": [27.5, 45.5]},
  {"unit": "ugv_recon_dog", "count": 1, "at": [29.5, 45.5]},
  {"unit": "inf_squad", "count": 3, "at": [28.5, 43.5], "from_ledger": true},
  {"unit": "at_team", "count": 1, "at": [26.5, 44.5], "from_ledger": true},
  {"unit": "ifv_namer", "count": 1, "at": [31.5, 44.5]},
  {"unit": "mbt_lavi", "count": 1, "at": [33.5, 45.5]},
  {"unit": "apc_eitan", "count": 1, "at": [24.5, 45.5]},
  {"unit": "inf_medic_squad", "count": 1, "at": [30.5, 46.5]}
]
```

**`roe`**

```json ql4.roe
{
  "enabled": true,
  "flagged_zones": [
    "clinic"
  ],
  "structure_penalty_mult": 2
}
```

**`civilians`**: the clinic's six, in two groups of three inside zone `clinic`; no other civilian (G-8)

```json ql4.civilians
{
  "refuge": "clinic_refuge_point",
  "groups": [
    {"unit": "civilians", "count": 3, "at": [30.5, 26.5]},
    {"unit": "civilians", "count": 3, "at": [30.5, 27.5]}
  ]
}
```

**`objectives`**

```json ql4.objectives
[
  {"id": "take_the_yard", "type": "capture", "primary": true, "target": "clinic_yard", "seconds": 15, "text": "Take and hold the clinic yard", "say": {"speaker": "idit", "text": "The yard is yours. The engineers can only charge the mouth while someone is watching it."}},
  {"id": "walk_the_forecourt_out", "type": "evacuate_before", "primary": true, "target": "clinic_refuge", "count": 5, "seconds": 300, "text": "Walk five people out of the clinic forecourt", "say": {"speaker": "shai", "text": "Five out of the forecourt and at the refuge. Whatever is left in that compound is the fight."}, "say_on_fail": {"speaker": "shai", "text": "The clock is out on the forecourt. Anybody still in it is still beside the fight."}},
  {"id": "bring_the_shaft_down", "type": "collapse", "primary": true, "target": "clinic_yard", "seconds": 360, "text": "Bring down the shaft in the clinic yard", "say": {"speaker": "shai", "text": "The shaft is down and the clinic is standing. That is the job, both halves."}, "say_on_fail": {"speaker": "idit", "text": "Six minutes, and the yard is still open underneath. Whatever comes up there next comes up beside that clinic."}},
  {"id": "keep_the_clinic", "type": "no_collateral_above", "primary": true, "threshold": 10, "text": "Lose no more than 10 Conduct", "say_on_fail": {"speaker": "shai", "text": "That is past ten beside a clinic. Nothing in that yard was worth it."}},
  {"id": "the_yard_commander", "type": "eliminate_hvt", "primary": false, "target": "ql_yard_commander", "text": "Kill the commander at the yard's north gate", "say": {"speaker": "idit", "text": "The yard commander is down at the north gate. He ran that firing line from outside his own yard."}}
]
```

**`enemy.garrison`**

```json ql4.garrison
[
  {"unit": "rpg_team", "count": 1, "at": [23.5, 24.5], "stance": {"kind": "ambush", "tiles": 3}, "tag": "ql_yard_watch"},
  {"unit": "militia_cell", "count": 1, "at": [27.5, 18.5], "stance": {"kind": "hold_position"}, "tag": "ql_yard_commander"},
  {"unit": "militia_cell", "count": 1, "at": [21.5, 18.5], "stance": {"kind": "garrison", "building": [22, 18]}, "group": "firing_line"},
  {"unit": "militia_cell", "count": 1, "at": [36.5, 23.5], "stance": {"kind": "garrison", "building": [37, 23]}, "group": "firing_line"},
  {"unit": "rpg_team", "count": 1, "at": [36.5, 23.5], "stance": {"kind": "garrison", "building": [37, 23]}, "group": "firing_line"},
  {"unit": "militia_cell", "count": 1, "at": [21.5, 30.5], "stance": {"kind": "garrison", "building": [22, 30]}, "group": "firing_line"},
  {"unit": "militia_cell", "count": 2, "at": [19.5, 23.5], "stance": {"kind": "hold_position"}, "group": "quarter"},
  {"unit": "rpg_team", "count": 1, "at": [15.5, 26.5], "stance": {"kind": "hold_position"}, "tag": "ql_shore_watch"},
  {"unit": "militia_cell", "count": 2, "at": [26.5, 21.5], "in_tunnel": "ql4_yard"},
  {"unit": "rpg_team", "count": 1, "at": [26.5, 21.5], "in_tunnel": "ql4_yard"}
]
```

**`triggers`**

```json ql4.triggers
[
  {"id": "the_shore_lane_moves_on_the_yard", "label": "The shore-quarter lane moves on the yard", "on": {"kind": "zone_entered", "zone": "compound"}, "do": {"kind": "commit", "group": "quarter", "to": "yard_point"}, "say": {"speaker": "net", "text": "Two from the shore-quarter lane, moving on the yard through the west gate."}},
  {"id": "the_firing_line_leaves", "label": "Their firing line leaves the compound", "on": {"kind": "casualties_pct", "value": 50}, "do": {"kind": "withdraw_to", "group": "firing_line", "to": "north_muster"}, "say": {"speaker": "idit", "text": "The firing positions round the compound are emptying north. What is left of the fight is in the yard."}}
]
```

**`enemy.waves`**

```json ql4.waves
[
  {"at_seconds": 150, "to": "yard_point", "units": [{"unit": "militia_cell", "count": 2, "from": "north_muster"}]},
  {"at_seconds": 270, "to": "south_gate", "units": [{"unit": "technical", "count": 1, "from": "east_muster"}, {"unit": "rpg_team", "count": 1, "from": "east_muster"}], "say": {"speaker": "idit", "text": "A technical and a rocket team coming round to the south gate, the gate the walk goes through."}}
]
```

Not in the fragments: `name`, `briefing`, `debrief`, `time_limit_s` 840, `target_minutes` 7, `ledger`. There is no
`dispatch` or `aftermath` on this mission (narrative §0.4).

---

## 7. QL V: `qasr_liwan_5_subterranean` · The Pumps

`subterranean` · 7 min (`time_limit_s` 840) · map `qasr_liwan_5` · **economy** (camp, 500 + 90/min) · ceiling **10**,
`structure_penalty_mult` **4**. Requires **R I**, produces **R M C X I**. **Where the engineers stand while the water
drives the shallow crews up.**

### 7.1 Flags

| flag | kind | meaning |
|---|---|---|
| `run_the_pumps` | objective, primary, **and the key of the two flush waves** | 180 s uncontested presence in `pump_yard`. Completing it **is** "the water is in". It is a latch: nothing the flush does can un-complete it (F-11) |
| `the_deep_routes` | objective, primary, **failable** | the three routes whose mouth is in `shore_grid` are collapsed before 360 s; the two shallow mouths are outside it |
| `keep_the_depot` | objective, primary, **failable** | Conduct lost has stayed at 10 or under; the depot alone is 3 × 4 = 12 |
| `the_grid_chief`, `find_the_deep_crew` | objectives, secondary (neither carries, until O-QL3's reader exists) | the chief killed; the digger identified |
| tags `ql_shore_watch` (read, from IV), `ql_deep_crew` | ledger | the first spawns identified with its ambush forfeit if IV saw it; the second is written on the sighting and read by nobody yet |

### 7.2 ECA rows

| # | event | IF | THEN | cue bound | status |
|---|---|---|---|---|---|
| 5.01 | `mission_start` | tick 0 | 13 enemy bodies (8 buried); `ql_deep_crew` starts digging `ql5_deep_cut` (about 54 s at 0.15 tiles/s); camp raised | N§5.1 to N§5.2 | live |
| 5.02 | `run_the_pumps` complete | `hold_for pump_yard 180` | objective complete (+40 Intel), then rows 5.03 and 5.04 on the same or the next tick | **no `say`**, deliberately (N§5.6: `hud.say` replaces rather than queues) | live |
| 5.03 | `wave_flush_north` | `trigger: run_the_pumps` (`at_seconds` 180 is documentation only) | `militia_cell ×3` at `vent_shallow_n` (3,24) → `pump_point` | N§5.6 Idit wave line | live, **world-walk** (F-10) |
| 5.04 | `wave_flush_south` | `trigger: run_the_pumps` | `militia_cell ×2` + `rpg_team` at `vent_shallow_s` (6,34) → `pump_point` | alert layer only | live, **world-walk** |
| 5.05 | `wave_240` | `at_seconds 240` | `technical` at `north_muster` → `pump_point` | N§5.6 Idit wave line | live |
| 5.06 | `ql5_deep_cut` breaks through | autonomous: the dig completes and the 2 buried bodies can surface on the apron | none | N§5.6 Idit (T-QL5a) | **engine**: no `route_open` trigger (G-QL2). A `timer_s` near 54 s would lie if the digger dies first |
| 5.07 | "the water got there" | `objective_complete(run_the_pumps)` → `remove` the shallow stocks | the two shallow bodies leave play | N§5.6 Idit | **engine** (G-QL2 `objective_complete`) |
| 5.08 | `the_deep_routes` complete / failed | all 3 routes down; tick ≥ 360 s | complete / mission lost | N§5.6 Idit, Idit | live |
| 5.09 | `keep_the_depot` failed / complete | `100 - Conduct > 10` / every other primary complete | mission lost / complete | N§5.6 Shai | live |
| 5.10 | `the_grid_chief` complete, `find_the_deep_crew` complete | tag killed (not removed) / digger identified | complete (+40 Intel each) | N§5.6 Idit, Idit | live |
| 5.11 | `missionEnd` victory | all three primaries | `aftermath` + `debrief` | N§5.4, N§5.5 | live |
| 5.12 | `missionEnd` defeat | any cause | `debrief` | N§5.5 | live |

No trigger is authored in the baseline (design §5.5). Two triggers appear only in a twist.

### 7.3 AI director

**Cadence.**

| t | what | size | from | to | group |
|---|---|---|---|---|---|
| 240 s | wave | 1 `technical` | `north_muster` (6,8) | `pump_point` (3,29) | none |
| on `run_the_pumps` | wave | 3 `militia_cell` | `vent_shallow_n` (3,24) | `pump_point` (3,29) | none |
| on `run_the_pumps` | wave | 2 `militia_cell` + 1 `rpg_team` | `vent_shallow_s` (6,34) | `pump_point` (3,29) | none |

**Stances.** 13 side-1 bodies at start (8 buried, 1 digger). Every placement:

| tag / group | unit × count | at (tile) | stance |
|---|---|---|---|
| none | `militia_cell` × 1 | (15,24) | buried in `ql5_shallow_n` |
| none | `militia_cell` × 1 | (19,34) | buried in `ql5_shallow_s` |
| none | `militia_cell` × 2 | (11,29) | buried in `ql5_deep_depot` |
| none | `rpg_team` × 1 | (11,29) | buried in `ql5_deep_depot` |
| none | `militia_cell` × 1 | (9,34) | buried in `ql5_deep_quay` |
| none | `militia_cell` × 2 | (15,35) | buried in `ql5_deep_cut` |
| `ql_deep_crew` | `digger_crew` × 1 | (15,35) | digs `ql5_deep_cut` |
| `ql_grid_chief` | `militia_cell` × 1 | (14,32) | `garrison` F at (12,30) |
| `ql_shore_watch` | `rpg_team` × 1 | (6,25) | `ambush` 3 |
| group `pump_guard` | `militia_cell` × 2 | (5,29) | `hold_position` |

**Pressure curve.** Three beats. **0 to 54 s: quiet.** The buried stocks do not move; the two `pump_guard` and the chief
are the only surfaced enemies, and the chief stands inside `shore_grid`, which costs nothing (the zone counts route mouths, not men). **About 54 s: the apron.** The digger
breaks through at `ql5_deep_cut` and two bodies can surface on the apron between the start line and the city, 5 tiles from the start; this is the only autonomous pressure and no trigger announces it (row 5.06). **From completion of the
pumps: the flush.** Five bodies spawn on the shallow vent markers at the pump yard's north and south edges (2 tiles off the first, 1 off the second) and walk to
`pump_point` (3,29). Because the hold has just completed, the flush punishes whoever stays, not the hold: **run the pumps
early** and it lands while the engineers are still working a mouth; **run them late** and the deep crews have been venting
at the depot all along. The 240 s `technical` comes down the coast road on the clock whichever the player chose. The
depot is never attacked by the director: its danger is player fire at the crew that surfaces inside its walls.

**Playtest asks.**
1. **F-4: a drone-only hold.** After the two `pump_guard` die, park only the drone in `pump_yard`: does `run_the_pumps`
   complete? If yes, take the fallback (delete the drone) or land G-QL5.
2. **QL-A6.** From a tile outside `relief_depot`, can `ugv_recon_dog` (sight 12) identify `ql5_deep_depot`? `world-walk`
   with real `losRay`.
3. **The undug route.** Is `ql5_deep_cut` identifiable from its spoil while it is being dug, and is it chargeable if the
   digger dies before the dig completes? `sim.ts` charges route geometry, not spoil (`nearestRouteTileDistSq`), but
   identification of a non-`pre_dug` route needs the spoil trail. If the digger is killed at 10 s, the route may never be
   identifiable: `collapse` would then be unwinnable, and the mission with it. `mission-author` runs this.
4. **Conduct.** The depot is 12 and fails alone, a house 24, a shanty and a pump house 8, a firing position 0. Two strays
   (10) pass. Print the loss.
5. **Passive control**: defeat at 360 s by `the_deep_routes`; the apron crew arrives at about 54 s.
6. **Order of play.** Pumps-first against routes-first against mixed, measured on one seed each: the decision is only real
   if they are different plans.

### 7.4 Map requirements (`qasr_liwan_5`)

| name | kind | where | used by | status |
|---|---|---|---|---|
| `pump_yard` | zone | [0,26,7,7] | `run_the_pumps` | new, design |
| `shore_grid` | zone | [8,26,9,11] | `the_deep_routes` | new, design. Contains exactly the three deep mouths (QL-A5) |
| `relief_depot` | zone | [7,18,8,8] | `roe.flagged_zones` | new, design. A plain `warehouse` in a walled yard, **no mark** (L-12, O-QL6) |
| `shore_quarter` | zone | [3,17,18,21] | reference only | new, design. Deliberately **not** flagged |
| `pump_point` `north_muster` `vent_shallow_s` | markers | (3,29) (6,8) (6,34) | wave `to`, `from` | new, design |
| `vent_shallow_n` | marker | **(3,24)**, was (6,24) | wave `from` | **moved** (F-3): a count-3 at (6,24) puts bodies at x 6, 7, 9 and (7,24) is a wall |
| `ql_start` `camp_exit` `chief_post` | markers | (24,44) (28,44) (14,32) | player start; production exit; the chief's `at` is the same tile | new, design |

Tunnels (all `pre_dug` except the last), mouths and vents as design §3.5:

| id | mouth | waypoints | vent | stock in the fragments |
|---|---|---|---|---|
| `ql5_shallow_n` | (15,24) | (15,22) | (6,24) | 1 `militia_cell` |
| `ql5_shallow_s` | (19,34) | (14,38) | (6,34) | 1 `militia_cell` |
| `ql5_deep_depot` | (11,29) | (11,26) | (11,23), **inside `relief_depot`** | 2 `militia_cell` + `rpg_team` |
| `ql5_deep_quay` | (9,34) | (5,36) | (1,37) | 1 `militia_cell` |
| `ql5_deep_cut` | (15,35) | (18,37) | (22,39) | 2 `militia_cell`; **not `pre_dug`**, dug by `ql_deep_crew` (`digs`), about 8.1 tiles |

The chief's `garrison` building is the `F` at tile (12,30) (design §3.3, replacing a shanty).

### 7.5 Twists

| twist | class | delta | recommendation |
|---|---|---|---|
| **T-QL5a** "It comes up at the Cut" | **engine** | needs `on.kind: route_open` (G-QL2) and a `say` trigger; the `timer_s` stand-in lies if the digger dies | **hold** until G-QL2 lands. The mechanic is already in the baseline; only the announcement is missing |
| **T-QL5b** "The chief goes for the quay" | **expressible today** | give the chief placement `group: "grid_chief"`; add a trigger `casualties_pct 60` (= 8 of 13) `withdraw_to grid_chief → quay_post` (new marker, (3,36), passable); label `The grid chief runs for the beach` (33) | adopt. The chief is `withdraw_to`'d, not `remove`d, so the secondary stays reachable and cannot fail |
| **T-QL5c** "A fourth route" | **expressible today, with a text conflict** | a fourth deep route with its mouth in `shore_grid` makes `the_deep_routes` four; the briefing and `aftermath` say three | **not this pass**: it needs a new briefing sentence, and it makes the mission harder before `playtest` has measured the three |
| **T-QL5d** "The flush has a second cause" | **schema field** | a `do: { kind: "remove" }` on the shallow stocks keyed on an objective (G-QL2) would make "the water got there" true; today those two bodies keep venting | owner `sim-guard`; the baseline's wording ("those crews come up at the yard's two ends") is honest without it |

### 7.6 Gap report

| gap | effect | class |
|---|---|---|
| **G-4** flooding | the pumps are a `hold_for` plus two flush waves | engine, `sim-guard` |
| **G-12** | the flush waves cannot come from a tunnel id; the vent markers stand in | engine |
| **G-QL2** | `route_open`, `objective_complete`: rows 5.06, 5.07, T-QL5a, T-QL5d | engine |
| **G-QL5** | a drone can hold `pump_yard` (F-4) | schema + engine |
| **G-9** | `locate` targets units: `ql_deep_crew` is a tagged digger, not a route | schema |
| **G-QL1** | `structure_penalty_mult` 4 prices every house at 24 | schema + engine |
| **G-5** | charges worked from the surface | engine |

### 7.7 Copy-ready fragments

**`starting_force`**

```json ql5.starting_force
[
  {"unit": "yahalom_squad", "count": 1, "at": [23.5, 44.5]},
  {"unit": "yahalom_squad", "count": 1, "at": [25.5, 44.5]},
  {"unit": "ugv_recon_dog", "count": 1, "at": [24.5, 43.5]},
  {"unit": "recon_drone", "count": 1, "at": [22.5, 43.5]},
  {"unit": "inf_squad", "count": 3, "at": [22.5, 45.5], "from_ledger": true},
  {"unit": "at_team", "count": 1, "at": [20.5, 45.5], "from_ledger": true},
  {"unit": "ifv_namer", "count": 1, "at": [27.5, 43.5]},
  {"unit": "apc_eitan", "count": 1, "at": [19.5, 44.5]},
  {"unit": "inf_medic_squad", "count": 1, "at": [21.5, 46.5]}
]
```

**`structures`**, **`resources`**, **`roe`**

```json ql5.structures
[
  {"type": "camp", "at": [26, 45], "size": [2, 2]}
]
```

```json ql5.resources
{"logistics_start": 500, "logistics_rate_per_min": 90}
```

```json ql5.roe
{
  "enabled": true,
  "flagged_zones": [
    "relief_depot"
  ],
  "structure_penalty_mult": 4
}
```

**`civilians`**: none. The shore has been emptied.

**`objectives`**

```json ql5.objectives
[
  {"id": "run_the_pumps", "type": "hold_for", "primary": true, "target": "pump_yard", "seconds": 180, "text": "Hold the pump yard for three minutes"},
  {"id": "the_deep_routes", "type": "collapse", "primary": true, "target": "shore_grid", "seconds": 360, "text": "Collapse the deep routes under the shore", "say": {"speaker": "idit", "text": "The deep routes are down. The shore is ours above and below, as far as anything we can see."}, "say_on_fail": {"speaker": "idit", "text": "Six minutes, and there is still a deep route open under the shore. The water never reached it, and neither did we."}},
  {"id": "keep_the_depot", "type": "no_collateral_above", "primary": true, "threshold": 10, "text": "Lose no more than 10 Conduct", "say_on_fail": {"speaker": "shai", "text": "That is past ten Conduct on an empty shore. Nothing that came up there was worth it."}},
  {"id": "the_grid_chief", "type": "eliminate_hvt", "primary": false, "target": "ql_grid_chief", "text": "Kill the grid chief at the deep shaft head", "say": {"speaker": "idit", "text": "The grid chief is down at his own shaft head. He was running that grid to a plan drawn before the war."}},
  {"id": "find_the_deep_crew", "type": "locate", "primary": false, "target": "ql_deep_crew", "text": "Find the crew digging toward the Cut", "say": {"speaker": "idit", "text": "That is the crew digging toward the Cut, on the south edge of the shore. He is not on any plan I have; he is making one."}}
]
```

**`enemy.garrison`**

```json ql5.garrison
[
  {"unit": "militia_cell", "count": 1, "at": [15.5, 24.5], "in_tunnel": "ql5_shallow_n"},
  {"unit": "militia_cell", "count": 1, "at": [19.5, 34.5], "in_tunnel": "ql5_shallow_s"},
  {"unit": "militia_cell", "count": 2, "at": [11.5, 29.5], "in_tunnel": "ql5_deep_depot"},
  {"unit": "rpg_team", "count": 1, "at": [11.5, 29.5], "in_tunnel": "ql5_deep_depot"},
  {"unit": "militia_cell", "count": 1, "at": [9.5, 34.5], "in_tunnel": "ql5_deep_quay"},
  {"unit": "militia_cell", "count": 2, "at": [15.5, 35.5], "in_tunnel": "ql5_deep_cut"},
  {"unit": "digger_crew", "count": 1, "at": [15.5, 35.5], "digs": "ql5_deep_cut", "tag": "ql_deep_crew"},
  {"unit": "militia_cell", "count": 1, "at": [14.5, 32.5], "stance": {"kind": "garrison", "building": [12, 30]}, "tag": "ql_grid_chief"},
  {"unit": "rpg_team", "count": 1, "at": [6.5, 25.5], "stance": {"kind": "ambush", "tiles": 3}, "tag": "ql_shore_watch"},
  {"unit": "militia_cell", "count": 2, "at": [5.5, 29.5], "stance": {"kind": "hold_position"}, "group": "pump_guard"}
]
```

**`triggers`**: none in the baseline (`"triggers": []` or omit the key)

**`enemy.waves`**: the first two are keyed on `run_the_pumps` and are the first shipped use of `trigger`

```json ql5.waves
[
  {"at_seconds": 180, "trigger": "run_the_pumps", "to": "pump_point", "units": [{"unit": "militia_cell", "count": 3, "from": "vent_shallow_n"}], "say": {"speaker": "idit", "text": "The water is in. Crews coming up at both ends of the pump yard, north and south."}},
  {"at_seconds": 180, "trigger": "run_the_pumps", "to": "pump_point", "units": [{"unit": "militia_cell", "count": 2, "from": "vent_shallow_s"}, {"unit": "rpg_team", "count": 1, "from": "vent_shallow_s"}]},
  {"at_seconds": 240, "to": "pump_point", "units": [{"unit": "technical", "count": 1, "from": "north_muster"}], "say": {"speaker": "idit", "text": "A technical down the coast road from the north edge, for the pump yard."}}
]
```

Not in the fragments: `name`, `aftermath`, `briefing`, `debrief`, `time_limit_s` 840, `target_minutes` 7, `ledger`.

---

## 8. Doctrine pins for `tools/src/qasr_liwan_doctrine.test.ts`

These are **literals**, measured on the design's grids by the scratch rig in §11. They are circles on tile geometry,
not `losRay` and not `FlowField`. `mission-author` re-measures each through the real instrument before it becomes an
assertion, and an assertion that does not go red under a one-tile move of its subject is not an assertion.

**QL-A1.** passable tiles (both domains: the maps carry no `b`, `d` or `^`) in every zone a `capture`, `hold_for` or `collapse` names. The floor is 12.

| mission | objective | zone | passable tiles |
|---|---|---|---|
| QL 2 | `hold_the_seam` | `ring_north` | 40 |
| QL 2 | `hold_the_cut` | `the_cut` | 34 |
| QL 2 | `take_the_coast_road` | `coast_road` | 42 |
| QL 3 | `hold_the_forward_ground` | `staging` | 34 |
| QL 3 | `take_the_water_point` | `water_point` | 15 |
| QL 4 | `take_the_yard` | `clinic_yard` | 43 |
| QL 4 | `bring_the_shaft_down` | `clinic_yard` | 43 |
| QL 5 | `run_the_pumps` | `pump_yard` | 45 |
| QL 5 | `the_deep_routes` | `shore_grid` | 71 |

**QL-A2.** each refuge marker lies inside its `evacuate_before` zone (the runtime throws at load otherwise, naming the objective and not the map).

| mission | refuge marker | zone | inside |
|---|---|---|---|
| QL 1 | `ql_extract_point` (22,1) | `ql_extract` | yes |
| QL 2 | `refuge_point` (28,45) | `cut_refuge` | yes |
| QL 3 | `pause_refuge_point` (12,45) | `pause_refuge` | yes |
| QL 4 | `clinic_refuge_point` (29,38) | `clinic_refuge` | yes |

**QL-A3.** civilian walks to the refuge. **The design's "14 or fewer" is a step count** (8-connected moves, no corner-cutting); the weighted length (diagonal 1.41) is 15% to 20% longer (F-9). Every group is more than 4 tiles from `player_start` and from every player placement.

| mission | group `at` | bodies (tile) | steps to refuge, per body | length, per body | nearest player placement |
|---|---|---|---|---|---|
| QL 1 | (18,9) × 1 | (18,9) | 8 | 9.7 | 25.5 |
| QL 2 | (15,37) × 3 | (15,37), (16,37), (18,37) | 13, 12, 11 | 16.3, 15.3, 13.9 | 30.0 |
| QL 2 | (19,37) × 3 | (19,37), (20,37), (22,37) | 11, 11, 11 | 13.5, 13.1, 12.2 | 26.4 |
| QL 2 | (35,37) × 3 | (35,37), (36,37), (38,37) | 12, 12, 12 | 13.2, 13.7, 14.5 | 14.4 |
| QL 3 | (11,37) × 4 | (11,37), (12,37), (14,37), (11,38) | 8, 8, 8, 7 | 8.4, 8.0, 8.8, 7.4 | 29.8 |
| QL 4 | (30,26) × 3 | (30,26), (31,26), (33,26) | 12, 12, 14 | 13.2, 13.7, 15.7 | 17.1 |
| QL 4 | (30,27) × 3 | (30,27), (31,27), (33,27) | 11, 12, 14 | 12.2, 13.2, 15.2 | 16.1 |

**QL-A4.** structures inside the objective zones of QL IV (letters from the grid): `clinic_yard` holds no building, `clinic` holds exactly one `clinic`.

- `clinic_yard`: 2 `g` tiles (`g` is `sandbag_wall`, low profile, 0 Conduct)
- `clinic`: 12 `k` tiles (`k` is the one `clinic`, 4x3 footprint, in the 12 tiles)

**QL-A5.** QL V routes against the collapse zone and the depot.

| route | mouth | mouth in `shore_grid` | vent | vent in `relief_depot` |
|---|---|---|---|---|
| `ql5_shallow_n` | (15, 24) | no | (6, 24) | no |
| `ql5_shallow_s` | (19, 34) | no | (6, 34) | no |
| `ql5_deep_depot` | (11, 29) | yes | (11, 23) | yes |
| `ql5_deep_quay` | (9, 34) | yes | (1, 37) | no |
| `ql5_deep_cut` | (15, 35) | yes | (22, 39) | no |

**QL-A6** (QL V: `ql5_deep_depot` identifiable from every tile outside `relief_depot` by a `mark_tunnel` observer, sight 12): **not measured.** It needs the sim's `losRay` over a real map. `world-walk`.

**QL-A7.** the pause (QL III). Distance from each enemy body to the nearest tile of each zone the player needs, **tile centre | rectangle edge** (a unit can stand on an edge). The floor is 11.0 and 10.5, the longest issued ground sight (10: `apc_eitan`, `jeep_shoded`) plus a margin; the enemy's own sight is 7. `handover_party` is exempt before 90 s.

| group | unit | at | `staging` | `handover` | `water_point` |
|---|---|---|---|---|---|
| `pause_lines` | `militia_cell` | (5,25) | 22.0 \| 21.3 | 11.7 \| 11.1 | 15.6 \| 14.9 |
| `pause_lines` | `militia_cell` | (6.25,25) | 20.9 \| 20.2 | 11.3 \| 10.7 | 14.9 \| 14.2 |
| `pause_lines` | `militia_cell` | (22,24) | 12.2 \| 11.6 | 14.4 \| 13.7 | 13.3 \| 12.7 |
| `pause_lines` | `militia_cell` | (23.25,24) | 12.0 \| 11.5 | 15.2 \| 14.5 | 13.7 \| 13.1 |
| `pause_lines` | `rpg_team` | (22,23) | 13.2 \| 12.6 | 15.3 \| 14.6 | 14.3 \| 13.7 |
| `pause_lines` | `militia_cell` | (39,24) | 13.4 \| 12.7 | 27.7 \| 27.1 | 23.9 \| 23.2 |
| `pause_lines` | `militia_cell` | (40.25,24) | 14.0 \| 13.3 | 28.9 \| 28.2 | 24.9 \| 24.2 |
| `pause_mortar` | `mortar_crew` | (17,24) | 13.9 \| 13.2 | 12.4 \| 11.8 | 13.0 \| 12.5 |
| `ql_yard_watch` | `rpg_team` | (27,22) | 14.0 \| 13.5 | 19.1 \| 18.4 | 17.0 \| 16.3 |
| **minimum over the table** | | | **12.0 \| 11.5** | **11.3 \| 10.7** | **13.0 \| 12.5** |

`handover_party`: 3.0 and 3.2 tiles from the taken at (11.5,37.5), and 4.1 from the water point; it is in range of anyone who walks up before 90 s, which is the point. `handover_withdraw` (17,25) to `handover` 11.4, to `water_point` 12.0, to `staging` 13.0 (floor 11.0). `ql_yard_watch` to `staging` 14.0; the drone look at (27.5,34.5) is 12.0 from it, outside `pause_line` (south edge y = 34.0, a margin of 0.5 for the drone's position).

**QL-A8.** QL I's mortar (`mortar_82`, range 16, minimum range 4). Position (8.5,15.5) against the design's (10.5,15.5); targets by centre or nearest edge. In range is 16.0 or less.

| target | design (10.5,15.5) | **script (8.5,15.5)** |
|---|---|---|
| courtyard centre (18.5,9.5) | 10.0 (in range) | **11.7** (in range) |
| gate (18.5,7.5) | 11.3 (in range) | **12.8** (in range) |
| gate lane (18.5,6.5) | 12.0 (in range) | **13.5** (in range) |
| north-road tile x=18 | 14.4 (in range) | **15.6** (in range) |
| north-road tile x=19 | 15.0 (in range) | **16.3** (out of range) |
| north-road tile x=20 | 15.6 (in range) | **17.0** (out of range) |
| `ql_extract` nearest edge | 15.7 (in range) | **17.0** (out of range) |
| `ql_extract_point` (22.5,1.5) | 18.4 (out of range) | **19.8** (out of range) |

The rule: every `ql_mortar` position is at least 16.5 from every point of `ql_extract`. The shortest path from the person to the extract is 9 tiles, (18,9) (18,8) (18,7) (18,6) (18,5) (19,4) (20,3) (21,2) (22,1), 9 steps and 9.7 length; the first six are in range and the last three are not.

**D-5 / the billing floor.** `fx.from(0.3) === 19661` and `mission.ts` bills a stray when `collateralRisk >= 19661`, so a weapon authored at exactly 0.30 bills. KDF weapons at or above 0.3 today (`data/units/kdf/*.json`): `at_team` spike_atgm 0.3, `attack_drone` warhead 0.35, `demo_squad` charges 0.6, `heli_peten` chain_gun_30 0.5, `heli_peten_gunship` chain_gun_30 0.5, `ifv_namer` cannon_30 0.35, `inf_grenadier` gl_40 0.3, `mbt_lavi` gun_120 0.55, `mbt_lavi_camo` gun_120 0.55, `mortar_team` mortar_60 0.7, `spg_cluster` dpicm_155 0.95, `spg_long_range` howitzer_155 0.8. Heavy ordnance (0.5 and up, 3 points near a civilian) in this town's issued forces is `mortar_team` and `mbt_lavi`'s gun. A pin on this list goes red if a weapon is retuned across 0.3 or if `fx.from` rounds the other way.

---

## 9. Order of work for `mission-author`

1. Land `qasr_liwan` in the schema `town` enum and `world.json` (G-10, `sim-guard`), or nothing validates.
2. Author the five maps from design §3.1 and §3.3 with the zones and markers in §3.4, §4.4, §5.4, §6.4 and §7.4 of this
   file (four markers moved or added). Run `map_visibility.ts --draw=<id>` on each: **none of the five maps has been
   measured against the 84% gate**.
3. Paste each mission's fragments; add `name`, `briefing`, `debrief`, `hostages_place`, `dispatch`, `aftermath` from the
   narrative sheet, and the `ledger` blocks (§11 lists the ones this rig assumed).
4. Run `pnpm validate:data`, `walk_placements.ts` and `walk_mission.ts` on each. Of the things in §11, only these were
   **not run**, because they read `data/maps/`: `validate:data` in full, `walk_placements`, `walk_mission`, FlowField
   lengths, `map_visibility`, QL-A6, and the identify-then-charge chains.
5. Hand `playtest` the asks in §3.3, §4.3, §5.3, §6.3 and §7.3, in the order design §5.7 gives, with F-1 first.

---

## 10. Gap report

**Expressible today** (nothing to build): every baseline row marked `live`; T-QL1a, T-QL1c, T-QL1d, T-QL2a, T-QL2b,
T-QL3a (working form), T-QL4a, T-QL4b, T-QL5b; ambient lore through the `spawn`-with-no-units idiom (declined, below).

| # | gap | class | smallest proposal | owner | rows waiting |
|---|---|---|---|---|---|
| G-10 | `qasr_liwan` not in the `town` enum | schema | add the value | `sim-guard`, `mission-author` | all |
| G-N1 | a say-only trigger without a label | schema | allow an unlabelled trigger when `do` is absent **and** `say` is present; make `do` optional in that case | `sim-guard` | narrative §6 (11 ambient lines) |
| G-LS1 | no trigger watches an identification | engine | `on: { kind: "tag_identified", tag }`, true once any unit carrying the tag is in `identified`; a read of two existing sets in `stepTriggers`, no event plumbing | `sim-guard` | 1.13, 4.13, and narrative §1.6's two lines |
| G-QL2 | no trigger on a route opening or an objective completing | engine | `on.kind: "route_open"` with `route`, `"objective_complete"` with `objective` | `sim-guard` | 2.14, 5.06, 5.07, T-QL5a, T-QL5d |
| G-LS3 | `casualties_pct` counts the whole starting force | schema + engine | an optional `on.group`: the percentage of that group's start bodies | `sim-guard` | QL II's reserve, QL III's pause, QL IV's firing line |
| G-QL5 | `zone_entered` and `hold_for` count aircraft | schema + engine | `ground_only: true` on both, reusing `capture`'s `skipsGround` | `sim-guard` | F-4, QL I, QL III |
| G-6 | no weapons-held window | engine | reuse `Sim.beginSetup` as a mission `truce` block | `sim-guard` | 3.17; the pause is distance, stance and three triggers until then |
| G-QL1 | one building cannot be priced above its type | schema + engine | `structures[].roe_penalty` on a mission placement | `sim-guard` | QL IV, V ceilings (multipliers 2 and 4) |
| G-QL3 | nothing spawns a civilian | engine | `do: spawn` with a `side: 2` placement | `sim-guard` | T-QL3d |
| G-QL4 | no gate on passable tiles in a hold or capture zone | validator | the doctrine test's QL-A1 now; `validate_data.mjs` generally | `content-validator` | all |
| G-4, G-5, G-9, G-12 | flooding; below-ground units; `locate` of routes; tunnel-sourced waves | engine / schema | as `arc-outline.md` | `sim-guard` | QL V |

**Declined, with the reason.**
- **O-LS1.** Ambient lore through `do: { "kind": "spawn" }` with no units. It works (§0.2 row 5), but the repository
  validator demands a label on every non-`remove` trigger, so each of the 11 lines would print a second line in the
  feed that `narrative-designer` has not written, and each would spend one of the "handful" of triggers a mission is
  budgeted. Recommended instead: land G-N1, or adopt at most the three that teach a mechanic (the checkpoint lane in II,
  the apartment's 14 in II, the pump houses' 8 in V) once `narrative-designer` supplies labels.
- **O-LS2.** A non-carrying `locate` secondary with a `say` to make the mortar and tower lines live. It adds a row to the
  objective panel and 40 Intel per completion (`payObjective`), and Intel is what buys the barrage that QL I's ceiling
  exists to tempt. Land G-LS1 instead.
- **O-LS3.** A trigger on a weapon `fire` event (the Lavi's gun in QL IV): low value, the briefing says it.

**Decision for the lead (one).** F-1: keep `hold_the_forward_ground` at 300 s, or move it to 360 s with the text
`Hold the forward ground for six minutes` before `playtest` measures. Default: keep 300 and measure.

---

## 11. Verification record

Everything below was run in a scratch rig outside `data/` (the scratchpad, not committed). The rig builds the five grids
from `design.md` §3.1 and §3.3 by parsing the file, re-reads the fragments **out of this document's JSON blocks**, and
assembles five scratch missions.

| check | result |
|---|---|
| every fragment block parses as JSON, and the blocks reassemble to the same five missions the generator wrote | pass |
| each scratch mission validates against `data/schemas/mission.schema.json` (Draft 2020-12) with `town` set to a stand-in | pass; with `qasr_liwan` the only error is the `town` enum (G-10) |
| `removeTriggerFailures`, `triggerLabelFailures`, `narrativeTextFailures`, `timeLimitFailures`, `garrisonStanceFailures`, `incomeFailures`, imported from `tools/validate_narrative.mjs`, `validate_time_limit.mjs`, `validate_garrison.mjs`, `validate_income.mjs` | clean on all five |
| every unit id resolves under `data/units/` | pass |
| every `to` and `from` names a marker, never a zone; every `group` a trigger addresses is declared on a placement; every objective target is a zone or a placed tag | pass |
| every placement body, every wave marker's bodies (spread included), every civilian body stands on a passable tile of its map; garrison and buried `at` tiles are passable; each `garrison.building` is an `F` | pass, after the moves in F-3 |
| each `evacuate_before` refuge marker lies in its zone | pass |
| every `label`, `text` and `say.text` is byte-identical to a string in `narrative.md` | pass |
| mutations, each run and each watched go red | see below |

**Mutations.** Each was applied to the fragments extracted from this file, the whole rig re-run, and the result read.
**15 of 15 went red**, and the unmutated run is clean (so the checks are not vacuous). The three spread-check rows are the design's own coordinates, run through the runtime's own rule, and now guard the moves in F-3.

| mutation | caught by |
|---|---|
| a 49-character label | the rig; `triggerLabelFailures` |
| a label ending in a full stop | the rig; `triggerLabelFailures` |
| a trigger addressing a group no placement declares | the rig |
| a wave `from` naming a zone, not a marker | the rig |
| QL IV's forecourt group at the design's (32.5,26.5) (a body on the east wall at (35,26)) | the rig's spread check |
| `vent_shallow_n` back at the design's (6,24) (a body at (7,24)) | the rig's spread check |
| `city_west` back at the design's (6,20) (a body at (7,20)) | the rig's spread check |
| one `say` changed by one character | the byte-identity check against `narrative.md` |
| an unknown unit id | the rig |
| a `garrison.building` pointing at a house | the rig |
| a ceiling objective with no `threshold` | the schema |
| `enemy.garrisons` (the brief's spelling) | the schema (`additionalProperties`) |
| a trigger with its `label` deleted | the rig; `triggerLabelFailures` |
| `digger_crew` given a garrison stance | `garrisonStanceFailures` |
| an income zone the map does not declare | `incomeFailures` |

**Not run, and why.** `pnpm validate:data`, `walk_placements.ts`, `walk_mission.ts`, FlowField lengths, `map_visibility`,
`pnpm playtest`: they read `data/maps/` and `data/missions/`, which do not exist for this town. Nothing here was
estimated into a difficulty claim; every difficulty question is a `playtest` ask.
