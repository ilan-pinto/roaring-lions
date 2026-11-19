# Bir Tarsha: Level Script

**Act I · The Marj Strip · *The Long Ground*, town 2 of 4 new. Five missions, Option B *Gate and Strip*.**

**Date:** 2026-11-15 · **Author:** `level-scripter` · **Status:** proposal for `mission-author`. Nothing here was written into `data/`. The lead approved the arc (PR 1438) and this town's design with all seven rulings (PR 1453) on 15 Nov 2026. **The narrative sheet (PR 1456) has no lead approval yet**; this script is written against it as a proposal. The escort rows lean on the proposal in PR 1454 (GH-1439), which is **not built**: every row that depends on its two fields says `engine: GH-1439`.

**Stacked on** PR 1456's branch (`claude/bir-tarsha-narrative`), which sits on PR 1453's. **Format model:** the Qasr Liwan level script (PR 1450, `docs/campaign/qasr_liwan/level-script.md`).

**Read, in this order:** `docs/campaign/README.md`; `data/schemas/mission.schema.json` and `packages/sim/src/mission.ts` (every shape below was grepped, see §0.2); `docs/campaign/bir_tarsha/design.md`; `narrative.md`; `docs/superpowers/specs/2026-11-15-escort-through-work-design.md` (PR 1454). The grids, markers, zones and tunnels are the design's, **re-checked here by script** (§11), and the placements are this document's: the design gave unit counts, not coordinates.

**Downstream.**
- `mission-author`: §3 to §7 are the mission bodies, §8 the doctrine-test pins, §9 the hand-off list (including the Deir Amun III `aftermath` and the `commander.json` move from the narrative sheet's §8).
- `narrative-designer`: eight text deltas in §9.3 (four Idit lines that give an order, a trigger row that is a wave, one that names the wrong action, a zone rename, and the crew trigger's condition).
- `sim-guard`: §10, the gap report (GH-1439 first).
- `playtest`: the questions at the end of each mission.

---

## 0. How to read this script

### 0.1 Status vocabulary

| status | means |
|---|---|
| `live` | every field named in the row exists in `mission.schema.json` and the runtime acts on it today |
| `schema` | the runtime would act, the schema refuses the field |
| `engine` | neither: `sim-guard` work in `stepTriggers`, the runtime, or the two escort fields. Rows that wait on GH-1439 say `engine: GH-1439` |

A row that rides a path no shipped mission has exercised says so. `world-walk` means `mission-author` walks it with `walk_mission.ts` once the map exists.

### 0.2 What I checked against the code, and where the brief or the sheets were stale

| # | claim | source | result |
|---|---|---|---|
| 1 | the enemy list is `enemy.garrison` (singular) | schema `properties.enemy.properties.garrison` | fragments use `garrison` |
| 2 | five `on.kind`, six `do.kind` | schema `triggers`; `mission.ts` `stepTriggers` | `first_contact casualties_pct timer_s zone_entered group_in_zone` and `commit withdraw_to spawn reinforce dismount remove` |
| 3 | `first_contact` is **global** | `stepTriggers`: `fire = this.firstContact`, one boolean for the mission | the design's “only if the gate garrison is engaged” cannot be said. F-1 |
| 4 | a trigger has no delay field | schema `triggers.items.properties`: `id label on do say` | “after 20 s” (narrative III) is not expressible. F-2 |
| 5 | `say` rides the trigger, not `do` | schema; `stepTriggers` pushes it after the trigger event | all fragments |
| 6 | `commit` and `withdraw_to` skip buried bodies | `stepTriggers`: `alive === 1 && tunnelIn < 0` | `in_tunnel` stock cannot be committed. Stock surfaces by the tunnel AI (`docs/agent-notes/mission-findings.md`, “stocked fighters surface at the vent”). F-4 |
| 7 | `dismount` unloads carriers | `stepTriggers`: queues `unload` on carriers in `group` | not a way to open a shaft. F-4 |
| 8 | a `spawn` has no order | `stepTriggers`: `spawnPlacement` only; waves carry `to` | a spawned body holds or fights where it stands |
| 9 | spawn spread | `spawnPlacement`: body k at `(k mod 3) * 1.25` east, `floor(k / 3) * 1.25` south; `SPREAD` 81920 = 1.25 tiles; `assertGroundClear` throws on a blocked body of a non-garrison, non-buried placement, with the `blocked | boulder` mask for a vehicle | every placement checked on the grids in §11 |
| 10 | a flagged zone bills a **near miss** | `stepRoe`: a `nearMiss` from a side-0 weapon with `collateralRisk >= STRUCTURAL_COLLATERAL` inside a flagged zone deducts `flagged_structure_penalty` (default 5), once per zone per cooldown | **it stacks on a structure kill's `roe_penalty`.** F-6 |
| 11 | `starting_force` carries `group` and `tag` | schema `properties.starting_force.items.properties` | stale in `.claude/agents/level-scripter.md`, which says it cannot. The escort's tag works from `starting_force`. F-10 |
| 12 | `civilians` speed | `data/units/civilians.json`: 0.8 tiles/s | all evacuation walks in §11 |
| 13 | `town` enum | schema `properties.town` | eight towns, no `bir_tarsha`: G-10 |
| 14 | `time_of_day` | schema `map.time_of_day` enum `dawn day dusk night` | `dawn` and `dusk` are legal |
| 15 | escort evaluation | `stepObjectivePass` escort branch | today: `failed = ids.some(dead)`, `complete = ids.every(standsIn)`; **neither new field exists** |

---

## 1. The two defects I left in my own design, resolved

| # | defect | resolution | why |
|---|---|---|---|
| **D-BN1** | MDD §5.2 put II's ten residents in `safe_quarter` and also required seven to get out of it | **The zone stays; the residents start on the cross road, rows 19 and 20, x 21 to 29** (three groups: 3, 3, 4). `seven_in` is `evacuate_before` with `target` `safe_quarter`, count 7, 300 s, and the refuge marker `safe_point` (10,26) is inside it | an evacuation needs the people to start **outside** its destination. The cross road is also where the enemy mortar is laid, and the numbers make that pressure real: the mortar at (31.5,31.5) has range 16 and reaches all three groups (15.0, 14.9, 13.0 tiles) and does **not** reach the refuge (21.6) or the start (22.8). The walk to `safe_point` is 13, 12 and 16 steps (§11), 16 to 20 s. Moving the zone instead would have cost the flagged-quarter reading the briefing and the sheet both use |
| **D-BN2** | MDD §4 listed III's `evacuate_before` twice | **One objective**: `bring_three_out`, `evacuate_before`, `target` `bt3_extract`, `hostages: true`, count 3, **360 s** | G-8: `evacuate_before` counts every civilian in the mission, so a second identical objective completes on the same tick as the first and adds nothing. III has no other civilian (the four taken only). 360 s is the mission's own six minutes; the design gave none |

---

## 2. Findings this pass added (F-1 to F-12)

| # | finding | evidence | what I did |
|---|---|---|---|
| **F-1** | **`first_contact` is global.** The design (§5.1) and the sheet commit the works crew “only if the gate garrison is engaged”. One boolean covers every contact | `stepTriggers` | I uses `zone_entered(gate_approach)`, which fires when a player unit reaches the gate's ground (rows 28 to 33, 70 open tiles). **Consequence stated plainly:** a crew pulled to the gate is not “unlocated”. It arrives, is seen, and the `locate` is done by being fought. A rushed recon gets a harder gate fight, not a lost carry. The design's wording does not hold; the brief did not ask for it |
| **F-2** | **No trigger delay.** III's “the other block hears it after 20 s” is not a field | schema | `zone_entered(bt3_block_w)` commits the east block **at once** to the west yard. The 20 s comes from the walk: the two doors are 10 steps apart (§11), about 11 s at the militia's 0.95 tiles/s, 14 s counting the lane. The briefing's “inside twenty seconds” is true |
| **F-3** | **A wave has no `label`; a trigger that only spawns has no order.** The sheet gives II's two pushes as labelled `timer_s` triggers | schema `waves.items` vs `triggers.items` | II uses **waves** (they carry `to` and `say`), and the feed prints the alert layer's `enemy reinforcements — N units inbound` line. The two labels are struck. Narrative delta N-5 |
| **F-4** | **IV's shaft row names the wrong action.** The sheet binds `bt4_vent_opens` to `dismount`; `dismount` unloads carriers | `stepTriggers` | `timer_s` 240 → `spawn` two `militia_cell` at the marker `vent_w` (14,15). The buried stock surfaces on the tunnel AI's schedule, not on this trigger. Narrative delta N-6 |
| **F-5** | **A flat map has no dead ground.** The design (§3.4, §3.5) puts the missile teams “in the hamlet's dead ground” and the vents there. The houses stand *behind* the bait, not between it and the lane | grid; §11 | the bait works by **overshoot and by who can see it**. The team at (20.5,13.5) is 13.6 from the lane's centre (Kornet range 14), out of range of both lane ends (15.3 and 18.4), and **out of the Lavi's sight** (13.0 against 12) while inside the sniper's (16) and the `recon_zikit`'s (14). The player who answers fires toward the houses two rows behind it |
| **F-6** | **A flagged zone and a ceiling stack.** A stray round in a flagged zone bills `flagged_structure_penalty` (default 5) *in addition to* a house's `roe_penalty` | §0.2 row 10 | III carries **no** `flagged_zones` (apartments cost 14 against a ceiling of 15, so one near miss would already end it); IV and V flag `hamlet` at **3**. “Two houses are twelve” (the briefing) is the arithmetic of kills alone: a stray adds 3. `playtest` decides whether the beat reads true; the briefing line is not wrong, it is the best case |
| **F-7** | **Neutral works need no owner.** The design says hesco, sandbag and T-wall are “placed `owner: 1`” | `data/structures.json` (no `owner` on `hesco`, `sandbag_wall`, `t_wall`); `raze` counts every structure in the zone; `stepDemolition` skips only its own side's works (read in the design's §3.3) | the map letters carry them; `structures[]` is not needed. The “placed owner 1” wording is struck. Nothing else in the design depends on it |
| **F-8** | **V has four route rows, not five.** MDD §3.4 lists `bt5_a`, `bt5_b`, `bt5_c`, `bt5_wide` and a fifth row that is the chamber, which is not a route. §5.5 and the sheet both say five routes | §3.4 table | `bt5_d` added: mouth (34,24), vent (34,17). All five mouths lie in `fence_road` (§11) |
| **F-9** | **V's destination zone was beside the captive.** `chamber_refuge` [40,18,8,6] sits one row from the captive at (44,24) | grid | split: **`chamber_reach`** [40,18,8,6] fires the “in reach” trigger; **`rescue_refuge`** [2,14,10,6] is the destination, with the marker `rescue_point` (6,17) at the corral. The walk out is 38 steps, about 48 s at the person's 0.8 tiles/s. Narrative delta N-7 |
| **F-10** | `starting_force` already carries `group` and `tag` | §0.2 row 11 | the dozers' tag `blades` is a legal `starting_force` field today. Only `fail_after_losses` and `until` are missing |
| **F-11** | **Four of the sheet's Idit lines give an order**, and the sheet's own rule is that she never does | the narrative sheet §0.2 and its trigger tables | the fragments carry the replacements. Narrative deltas N-1 to N-4 |
| **F-12** | **A `locate` on a garrisoned body may never complete.** Whether detection identifies a unit inside a building by its window fire is not something I measured | none | I tagged only the outdoor placements of the gate garrison (`bt_gate_garrison`: a militia cell, an `atgm_cell` and an `rpg_team` on the road). The two garrisoned cells in the terminal blocks carry no tag. `world-walk` checks `identify_the_gate` is reachable |

---

## 3. BT I: `bir_tarsha_1_recon` · The Gate Road

Phase `recon`, dawn, **Captain**, requires **R**, produces **R M C X I E**, `target_minutes` 6, no economy. **How long to spend on the gate before the residents are out.**

### 3.1 Flags

| flag | meaning in the fiction |
|---|---|
| `identify_the_gate` | the three outdoor bodies of the gate garrison are identified |
| `six_out` | six residents have reached `gate_refuge`; fails at 300 s |
| `find_the_crew` | the works crew, three bodies, is identified; the carry into IV |
| `bt1_works_stir` | a player unit has reached the gate's ground and the crew has been committed to it |

### 3.2 ECA rows

| event | IF | THEN | cue bound | status |
|---|---|---|---|---|
| Start | mission start | title, dispatch, briefing | `title`, `dispatch`, `brief` | live |
| The crew stirs | `zone_entered gate_approach` (any living player unit, aircraft included) | `commit` group `crew` → marker `gate_road_south` | toast `The east works are stirring`; radio Idit | live |
| Garrison identified | `identify_the_gate` complete | objective `say` | radio Idit | live |
| Crew identified | `find_the_crew` complete | objective `say`; the tag enters `intel.marked_positions` at the end | radio Idit | live |
| A resident arrives | `evacuated` event | `six_out` counts | toast `clear (1)` | live |
| Six out | `six_out` complete | objective `say` | radio Shai | live |
| Residents lost | `six_out` fails at 300 s | `failObjective`; the mission is lost | radio Idit (`say_on_fail`) | live |
| A post identified | an east-works body is identified | — | radio Idit | engine |
| End | `missionEnd` | — | `toast`, `debrief` | live |

### 3.3 AI director

No waves. The cadence is stances and one trigger.

| t | group | units | where | stance |
|---|---|---|---|---|
| 0 | `terminal` (garrison) | 2 `militia_cell` | the west terminal block, building (20,36) | garrison |
| 0 | `terminal`, tag `bt_gate_garrison` | `militia_cell` (21.5,33.5), `atgm_cell` (26.5,32.5), `rpg_team` (22.5,32.5) | the gate road | hold; hold; ambush 4 |
| 0 | `crew`, tag `bt_works_crew` | `digger_crew` (41.5,34.5); 2 `militia_cell` (40.5,33.5) | the east end of the Fence Road | hold; patrol (37.5,33.5) to (45.5,33.5) |
| first player unit in `gate_approach` | `crew` | all three | → `gate_road_south` (24,34) | commit |

**Pressure curve.** The first two minutes are the quiet half: the residents (8, three groups at x 6 to 12) are 21 to 25 steps from the refuge and walk once a ground unit is within four tiles. The gate is 28 steps from the start. The player who goes to the gate first loses the quiet: the crew has about 17 tiles to cover from (41,34), 18 s for a militia cell at 0.95 tiles/s and 34 s for the digger at 0.5. The player who shepherds first can have the residents walking inside a minute (estimated, not simulated) and meets the gate with the crew still on its posts. There is no second clock: the pressure is the player's own ordering.

### 3.4 Map requirements (`bir_tarsha`)

Grid: the design's §3 (flat, `arid`, 48 × 48). Markers and zones below are new to the map; open-tile counts and walks are from §11.

| marker | tile | purpose |
|---|---|---|
| `gate_road_south` | (24,34) | the crew's commit destination (I) |
| `gate_refuge_point` | (7,5) | residents' refuge (I); inside `gate_refuge` |
| `works_mark` | (41,33) | where the crew is marked from (I, dressing) |

| zone | rect [x,y,w,h] | open tiles | used by |
|---|---|---|---|
| `gate_approach` | [19, 28, 12, 6] | 70 | trigger (I) |
| `gate_refuge` | [3, 3, 9, 5] | 45 | `six_out` destination (I) |
| `west_quarter` | [3, 22, 17, 12] | 170 | flagged (I) |
| `works_east` | [36, 29, 12, 6] | 63 | dressing (I) |
| `badlands_edge` | [0, 39, 48, 6] | 288 | flagged (I, II) |

### 3.5 Twists

| id | proposal | class |
|---|---|---|
| T-BT1a | The crew stirs when the gate's ground is entered (adopted, `bt1_works_stir`). | expressible today |
| T-BT1b | The gate garrison changes watch at 240 s, leaving a 40 s window: `timer_s` 240 → `withdraw_to` `terminal` → a marker, then `timer_s` 280 → `commit` back. Two labelled triggers; **not in the fragments** so the first playtest reads the mission without it. | expressible today |
| T-BT1c | One resident will not leave without the medic. No condition reads a unit type near a civilian. | engine |

### 3.6 Gap report and playtest asks

| gap | smallest proposal | owner | status |
|---|---|---|---|
| `first_contact` is global | a trigger that watches a group's contact | `sim-guard` | F-1; worked around |

**Playtest asks.**
- A passive plan must lose to the 300 s residents' clock, not stall.
- Does the crew's arrival at the gate (F-1) make the gate unwinnable for a sensible plan, or only dearer?
- Does `identify_the_gate` complete? (F-12)

### 3.7 Copy-ready fragments

Field names are the schema's. `at` values are tile centres. The `town` and the map are `mission-author`'s.

**`starting_force`**

```json bt1.starting_force
[
  {"unit": "recon_zikit", "count": 1, "at": [22.5, 2.5]},
  {"unit": "sniper_team", "count": 1, "at": [21.5, 3.5]},
  {"unit": "ugv_recon_dog", "count": 1, "at": [26.5, 2.5]},
  {"unit": "inf_squad", "count": 2, "at": [24.5, 1.5], "from_ledger": true},
  {"unit": "inf_medic_squad", "count": 1, "at": [23.5, 3.5]}
]
```

**`roe`**

```json bt1.roe
{
  "enabled": true,
  "flagged_zones": [
    "west_quarter",
    "badlands_edge"
  ],
  "flagged_structure_penalty": 12,
  "fail_below": 55
}
```

**`civilians`**

```json bt1.civilians
{
  "refuge": "gate_refuge_point",
  "groups": [
    {
      "unit": "civilians",
      "count": 3,
      "at": [
        6.5,
        26.5
      ]
    },
    {
      "unit": "civilians",
      "count": 3,
      "at": [
        12.5,
        26.5
      ]
    },
    {
      "unit": "civilians",
      "count": 2,
      "at": [
        10.5,
        30.5
      ]
    }
  ]
}
```

**`objectives`**

```json bt1.objectives
[
  {"id": "identify_the_gate", "type": "locate", "primary": true, "target": "bt_gate_garrison", "text": "Identify the garrison at the gate", "say": {"speaker": "idit", "text": "That is the garrison on the road: a rifle cell, a missile team and a rocket team. The blocks behind them hold more, and I cannot read what."}},
  {"id": "six_out", "type": "evacuate_before", "primary": true, "target": "gate_refuge", "count": 6, "seconds": 300, "text": "Walk six residents out to the refuge", "say": {"speaker": "shai", "text": "Six out. The west quarter is quiet, and it has one less reason to be a target."}, "say_on_fail": {"speaker": "idit", "text": "The quarter is closed to us now. There is no second morning for a walk like that, and the people in it know it."}},
  {"id": "find_the_crew", "type": "locate", "primary": false, "target": "bt_works_crew", "carries": true, "text": "Identify the crew on the east works", "say": {"speaker": "idit", "text": "Marked. That is the crew on the east works, and the next time we come down this road I can tell you which posts are theirs."}}
]
```

**`enemy.garrison`**

```json bt1.garrison
[
  {"unit": "militia_cell", "count": 2, "at": [20.5, 36.5], "stance": {"kind": "garrison", "building": [20, 36]}, "group": "terminal"},
  {"unit": "militia_cell", "count": 1, "at": [21.5, 33.5], "stance": {"kind": "hold_position"}, "tag": "bt_gate_garrison", "group": "terminal"},
  {"unit": "atgm_cell", "count": 1, "at": [26.5, 32.5], "stance": {"kind": "hold_position"}, "tag": "bt_gate_garrison", "group": "terminal"},
  {"unit": "rpg_team", "count": 1, "at": [22.5, 32.5], "stance": {"kind": "ambush", "tiles": 4}, "tag": "bt_gate_garrison", "group": "terminal"},
  {"unit": "digger_crew", "count": 1, "at": [41.5, 34.5], "stance": {"kind": "hold_position"}, "tag": "bt_works_crew", "group": "crew"},
  {"unit": "militia_cell", "count": 2, "at": [40.5, 33.5], "stance": {"kind": "patrol", "waypoints": [[37.5, 33.5], [45.5, 33.5]]}, "tag": "bt_works_crew", "group": "crew"}
]
```

**`triggers`**

```json bt1.triggers
[
  {"id": "bt1_works_stir", "label": "The east works are stirring", "on": {"kind": "zone_entered", "zone": "gate_approach"}, "do": {"kind": "commit", "group": "crew", "to": "gate_road_south"}, "say": {"speaker": "idit", "text": "Movement on the east works. Whoever is on them has heard the gate, and from here on they are looking west."}}
]
```

Not in the fragments, from the sheets: `name`, `dispatch`, `briefing`, `debrief`, `aftermath`, `hostages_place`; `time_limit_s` 720, `target_minutes` 6, `map.time_of_day` `dawn`, `ledger` `requires` ['roster.surviving_units'] / `produces` ['roster.surviving_units', 'roe.mission_ratings', 'campaign.completed_missions', 'campaign.mission_results', 'intel.marked_positions', 'civ.settlements_evacuated'].


---

## 4. BT II: `bir_tarsha_2_foothold` · The Gate

Phase `foothold`, day, **Captain**, requires **R I**, produces **R M C X E**, `target_minutes` 7, economy: a camp, 400 + 120/min, income `the_gate` 28. **What to buy, and whether to meet the second push forward.**

### 4.1 Flags

| flag | meaning in the fiction |
|---|---|
| `hold_the_gate` | a player unit holds `the_gate` uncontested for 240 s (accumulates) |
| `seven_in` | seven residents have reached `safe_quarter`; fails at 300 s |
| `take_the_roof` | 15 s held on `terminal_roof`, resets on contest |
| wave 1, wave 2 | the two pushes (150 s, 270 s); no flag reads them |

### 4.2 ECA rows

| event | IF | THEN | cue bound | status |
|---|---|---|---|---|
| Start | mission start | title, briefing | `title`, `brief` | live |
| First push | wave 1 at 150 s | `spawn` 2 `militia_cell`, `rpg_team`, `charge_squad` at `fence_east`, attack-move to `gate_point` | radio Idit (`waves[].say`); alert layer | live |
| Second push | wave 2 at 270 s | same mix, attack-move to `terminal_point` | radio Idit; alert layer | live |
| The roof | `take_the_roof` complete | objective `say` | radio Shai | live |
| A resident arrives | `evacuated` event | `seven_in` counts | toast `clear (1)` | live |
| Residents lost | `seven_in` fails at 300 s | the mission is lost | radio Idit (`say_on_fail`) | live |
| The tube | a round from the mortar lands on the cross road | — | radio Idit | engine |
| End | `missionEnd` | — | `toast`, `debrief` | live |

### 4.3 AI director

| t | wave | size | `from` | `to` | group |
|---|---|---|---|---|---|
| 150 s | 1 | 2 `militia_cell`, `rpg_team`, `charge_squad` | `fence_east` (42,34) | `gate_point` (24,33) | `push_1` |
| 270 s | 2 | 2 `militia_cell`, `rpg_team`, `charge_squad` | `fence_east` | `terminal_point` (24,36) | `push_2` |

Standing stances (the garrison and both missile teams stand inside the `the_gate` zone, so they contest the hold until they are dead): 3 `militia_cell` garrison the terminal blocks (buildings (20,36) and (26,36)); an `atgm_cell` holds beside each observation post, (17.5,33.5) and (31.5,33.5); the `mortar_crew` holds at (31.5,31.5), laid on the cross road.

**Pressure curve.** A quiet minute while the camp pays and the residents start to walk. The mortar bites the cross road at once (the three groups are 13.0 to 15.0 tiles from it). The first push lands at 150 s at the terminal's east side from 18 tiles away and is the lighter. The second at 270 s walks at the terminal itself and carries a charge squad. The player who has taken the roof sees the push from above. The holds can finish near 300 s, which also ends the evacuation clock; the second wave is insurance for a force that is contested, not pressure on a clean run.

### 4.4 Map requirements (`bir_tarsha_2`)

Grid: the design's §3 (flat, `arid`, 48 × 48). Markers and zones below are new to the map; open-tile counts and walks are from §11.

| marker | tile | purpose |
|---|---|---|
| `gate_point` | (24,33) | wave 1 destination (II) |
| `safe_point` | (10,26) | residents' refuge (II); inside `safe_quarter` |
| `fence_east` | (42,34) | wave spawn, east end of the Fence Road (II) |
| `terminal_point` | (24,36) | wave 2 destination, the terminal (II) |

| zone | rect [x,y,w,h] | open tiles | used by |
|---|---|---|---|
| `the_gate` | [17, 30, 14, 7] | 68 | `hold_the_gate`; income |
| `safe_quarter` | [3, 22, 17, 12] | 168 | `seven_in` destination; flagged (II) |
| `terminal_roof` | [24, 33, 6, 6] | 18 | `take_the_roof` |
| `crossroads` | [19, 17, 11, 6] | 66 | dressing: where the mortar is laid |
| `badlands_edge` | [0, 39, 48, 6] | 288 | flagged (I, II) |

### 4.5 Twists

| id | proposal | class |
|---|---|---|
| T-BT2a | The second push aims at the terminal, not the player (adopted, wave 2 `to` `terminal_point`). | expressible today |
| T-BT2b | The mortar is a decoy at 300 s: `timer_s` 300 → `remove` group `mortar`, plus a `spawn` of a second tube elsewhere. Two triggers. | expressible today |
| T-BT2c | A truck appears on the Badlands side and cannot enter (a `spawn` south of the Fence). It tempts a round across the Fence, which the fiction and the flagged zone both forbid. **Needs the lead**: a hostile unit that cannot be reached without breaking the rule. | expressible today, lead's call |

### 4.6 Gap report and playtest asks

| gap | smallest proposal | owner | status |
|---|---|---|---|
| a wave cannot be labelled | an optional `label` on a wave | `sim-guard` | F-3; the alert layer prints it |

**Playtest asks.**
- Does the mortar kill enough residents on a naive plan to make `seven_in` fail, and on a sensible plan not?
- Are the two pushes ever the binding pressure, or does the hold finish first (F-5 in Qasr's script, same shape)?
- A drone must not hold the gate: II fields none (`hold_for` counts aircraft).

### 4.7 Copy-ready fragments

Field names are the schema's. `at` values are tile centres. The `town` and the map are `mission-author`'s.

**`starting_force`**

```json bt2.starting_force
[
  {"unit": "inf_squad", "count": 2, "at": [22.5, 9.5], "from_ledger": true},
  {"unit": "mbt_lavi", "count": 1, "at": [26.5, 10.5]},
  {"unit": "mortar_team", "count": 1, "at": [21.5, 11.5]},
  {"unit": "inf_medic_squad", "count": 1, "at": [22.5, 12.5]},
  {"unit": "sniper_team", "count": 1, "at": [25.5, 12.5]}
]
```

**`roe`**

```json bt2.roe
{
  "enabled": true,
  "flagged_zones": [
    "safe_quarter",
    "badlands_edge"
  ],
  "fail_below": 55
}
```

**`resources`** and **`structures`**

```json bt2.resources
{
  "logistics_start": 400,
  "logistics_rate_per_min": 120,
  "income_zones": [
    {
      "zone": "the_gate",
      "rate_per_min": 28
    }
  ]
}
```

```json bt2.structures
[
  {"type": "camp", "at": [27, 6], "size": [2, 2]}
]
```

**`civilians`**

```json bt2.civilians
{
  "refuge": "safe_point",
  "groups": [
    {
      "unit": "civilians",
      "count": 3,
      "at": [
        22.5,
        19.5
      ]
    },
    {
      "unit": "civilians",
      "count": 3,
      "at": [
        21.5,
        20.5
      ]
    },
    {
      "unit": "civilians",
      "count": 4,
      "at": [
        26.5,
        19.5
      ]
    }
  ]
}
```

**`objectives`**

```json bt2.objectives
[
  {"id": "hold_the_gate", "type": "hold_for", "primary": true, "target": "the_gate", "seconds": 240, "text": "Hold the gate for four minutes"},
  {"id": "seven_in", "type": "evacuate_before", "primary": true, "target": "safe_quarter", "count": 7, "seconds": 300, "text": "Walk seven residents into the safe quarter", "say_on_fail": {"speaker": "idit", "text": "The quarter is not open. A gate with nobody behind it is a wall, and there is nothing left in this town for us to hold it for."}},
  {"id": "take_the_roof", "type": "capture", "primary": false, "target": "terminal_roof", "seconds": 15, "text": "Hold the terminal's roof for fifteen seconds", "say": {"speaker": "shai", "text": "The roof is ours. Every window on the Fence Road is now looking at us from our own side."}}
]
```

**`enemy.garrison`**

```json bt2.garrison
[
  {"unit": "militia_cell", "count": 2, "at": [20.5, 36.5], "stance": {"kind": "garrison", "building": [20, 36]}, "group": "gate"},
  {"unit": "militia_cell", "count": 1, "at": [26.5, 36.5], "stance": {"kind": "garrison", "building": [26, 36]}, "group": "gate"},
  {"unit": "atgm_cell", "count": 1, "at": [17.5, 33.5], "stance": {"kind": "hold_position"}, "group": "posts"},
  {"unit": "atgm_cell", "count": 1, "at": [31.5, 33.5], "stance": {"kind": "hold_position"}, "group": "posts"},
  {"unit": "mortar_crew", "count": 1, "at": [31.5, 31.5], "stance": {"kind": "hold_position"}, "group": "mortar"}
]
```

**`enemy.waves`**

```json bt2.waves
[
  {"at_seconds": 150, "to": "gate_point", "units": [{"unit": "militia_cell", "count": 2, "from": "fence_east", "group": "push_1"}, {"unit": "rpg_team", "count": 1, "from": "fence_east", "group": "push_1"}, {"unit": "charge_squad", "count": 1, "from": "fence_east", "group": "push_1"}], "say": {"speaker": "idit", "text": "First push, from the east end of the Fence Road. It is the lighter of two, and it is meant to show us where the weight goes."}},
  {"at_seconds": 270, "to": "terminal_point", "units": [{"unit": "militia_cell", "count": 2, "from": "fence_east", "group": "push_2"}, {"unit": "rpg_team", "count": 1, "from": "fence_east", "group": "push_2"}, {"unit": "charge_squad", "count": 1, "from": "fence_east", "group": "push_2"}], "say": {"speaker": "idit", "text": "Second push. A charge squad is walking with it, and it is walking at the terminal, not at you."}}
]
```

Not in the fragments, from the sheets: `name`, `dispatch`, `briefing`, `debrief`, `aftermath`, `hostages_place`; `time_limit_s` 840, `target_minutes` 7, `map.time_of_day` `day`, `ledger` `requires` ['roster.surviving_units', 'intel.marked_positions'] / `produces` ['roster.surviving_units', 'roe.mission_ratings', 'campaign.completed_missions', 'campaign.mission_results', 'civ.settlements_evacuated'].


---

## 5. BT III: `bir_tarsha_3_clearance` · Two Houses

Phase `clearance` (ruling 6), day, **Captain**, requires **R I**, produces **R M C X H**, `target_minutes` 6, no economy. **Split and go in together, or take one and fight for the second.**

### 5.1 Flags

| flag | meaning in the fiction |
|---|---|
| `bring_three_out` | three of the four taken have reached `bt3_extract`; fails at 360 s |
| `guard_west`, `guard_east` | the tagged guard of each block is dead |
| `keep_the_blocks` | Conduct lost has not passed 15 |
| `bt3_west_warns_east`, `bt3_east_warns_west` | a player unit has entered a block's zone and the other block has been committed to it |

### 5.2 ECA rows

| event | IF | THEN | cue bound | status |
|---|---|---|---|---|
| Start | mission start | title, briefing | `title`, `brief` | live |
| The west block is entered | `zone_entered bt3_block_w` | `commit` group `east_block` → `yard_w_point` | toast `The east block has been warned`; radio Idit | live |
| The east block is entered | `zone_entered bt3_block_e` | `commit` group `west_block` → `yard_e_point` | toast `The west block has been warned`; radio Idit | live |
| A guard falls | `guard_west` / `guard_east` complete | objective `say` | radio Shai | live |
| A taken person arrives | `evacuated` event | `bring_three_out` counts | toast `clear (1)` | live |
| Three out | `bring_three_out` complete | objective `say` | radio Idit | live |
| Count lost | `bring_three_out` fails at 360 s | the mission is lost | radio Idit (`say_on_fail`) | live |
| Ceiling crossed | `keep_the_blocks` fails | the mission is lost | radio Shai (`say_on_fail`) | live |
| A roof team identified | a roof `atgm_cell` is identified | — | radio Idit | engine |
| End | `missionEnd` | — | `toast`, `debrief`, `aftermath` (held) | live |

### 5.3 AI director

No waves. Stances and two zone triggers.

| group | units | where | stance |
|---|---|---|---|
| `west_block`, tag `bt3_guard_west` | 2 `militia_cell`; 1 `atgm_cell` | apartment, building (32,14) and (33,14) | garrison |
| `east_block`, tag `bt3_guard_east` | 2 `militia_cell`; 1 `atgm_cell` | apartment, building (42,23) and (43,23) | garrison |
| `lane` | 2 `militia_cell` | the firing positions (36,19) and (46,25) | garrison |

| trigger | on | do |
|---|---|---|
| `bt3_west_warns_east` | a player unit in `bt3_block_w` | `commit` `east_block` → `yard_w_point` (33,18) |
| `bt3_east_warns_west` | a player unit in `bt3_block_e` | `commit` `west_block` → `yard_e_point` (43,20) |

**Pressure curve.** The lane is covered from the first step: the firing positions at (36,19) and (46,25) look down the cross road and the east block's rear. The player who enters one block triggers the other's guard, which crosses a 10-step lane and arrives in about 11 s. A **committed garrison leaves its post** (`sim.ts`: a move or attack-move calls `leaveStructure`), so the second block is thinner the moment the first is entered: the split-force player meets the guards in the lane, the one-block player meets them in the yard. The extraction (17 and 19 steps from the taken) is the last quiet stretch and the loudest one.

### 5.4 Map requirements (`bir_tarsha_3`)

Grid: the design's §3 (flat, `arid`, 48 × 48). Markers and zones below are new to the map; open-tile counts and walks are from §11.

| marker | tile | purpose |
|---|---|---|
| `bt3_extract_point` | (24,2) | the taken's refuge (III); inside `bt3_extract` |
| `yard_w_point` | (33,18) | the east block's commit target (III) |
| `yard_e_point` | (43,20) | the west block's commit target (III) |

| zone | rect [x,y,w,h] | open tiles | used by |
|---|---|---|---|
| `bt3_block_w` | [29, 12, 8, 7] | 39 | trigger (III) |
| `bt3_block_e` | [39, 20, 8, 8] | 46 | trigger (III) |
| `bt3_extract` | [21, 0, 8, 4] | 32 | `bring_three_out` destination |

### 5.5 Twists

| id | proposal | class |
|---|---|---|
| T-BT3a | A guard walks a person to the window. No script moves a civilian. | engine |
| T-BT3b | The east guard runs north when the west block falls: `casualties_pct` is global, so the form is `casualties_pct` 50 → `withdraw_to` `east_block`, which reads “when half the stock is dead”, not “when the west block falls”. | expressible today, weaker |
| T-BT3c | The Namer rams the yard sandbags at the cost of its crew's cover. Player choice; no content. | none needed |

### 5.6 Gap report and playtest asks

| gap | smallest proposal | owner | status |
|---|---|---|---|
| no trigger delay | `do.delay_s` | `sim-guard` | F-2; the walk supplies it |
| no per-block condition | `casualties_pct` on a group | `sim-guard` | T-BT3b |

**Playtest asks.**
- Split against single entry: the win rate of each, measured over 30 seeds.
- Does a cannon round into either block end the mission, and does a stray near miss (F-6) when `flagged_zones` is empty?
- Does the count of 3 of 4 leave a way to lose one and still win?

### 5.7 Copy-ready fragments

Field names are the schema's. `at` values are tile centres. The `town` and the map are `mission-author`'s.

**`starting_force`**

```json bt3.starting_force
[
  {"unit": "inf_squad", "count": 3, "at": [21.5, 1.5], "from_ledger": true},
  {"unit": "breach_team", "count": 1, "at": [26.5, 1.5]},
  {"unit": "yahalom_squad", "count": 1, "at": [27.5, 2.5]},
  {"unit": "sniper_team", "count": 1, "at": [20.5, 3.5]},
  {"unit": "inf_medic_squad", "count": 1, "at": [22.5, 3.5]},
  {"unit": "ifv_namer", "count": 1, "at": [25.5, 3.5]}
]
```

**`roe`**

```json bt3.roe
{
  "enabled": true,
  "fail_below": 55
}
```

**`civilians`**

```json bt3.civilians
{
  "refuge": "bt3_extract_point",
  "groups": [
    {
      "unit": "civilians",
      "count": 2,
      "at": [
        32.5,
        16.5
      ]
    },
    {
      "unit": "civilians",
      "count": 2,
      "at": [
        42.5,
        21.5
      ]
    }
  ]
}
```

**`objectives`**

```json bt3.objectives
[
  {"id": "bring_three_out", "type": "evacuate_before", "primary": true, "target": "bt3_extract", "count": 3, "seconds": 360, "hostages": true, "text": "Bring three of the four taken out to the extraction", "say": {"speaker": "idit", "text": "Three on the north edge. I will count them again when you are clear of the lane."}, "say_on_fail": {"speaker": "idit", "text": "There are not three to bring any more. Whatever this was, it was not a count we could afford to be wrong about."}},
  {"id": "guard_west", "type": "eliminate_hvt", "primary": true, "target": "bt3_guard_west", "text": "Take out the guard on the west block", "say": {"speaker": "shai", "text": "West door is open. Do not stop in the yard."}},
  {"id": "guard_east", "type": "eliminate_hvt", "primary": true, "target": "bt3_guard_east", "text": "Take out the guard on the east block", "say": {"speaker": "shai", "text": "East door is open. The lane is the dangerous half."}},
  {"id": "keep_the_blocks", "type": "no_collateral_above", "primary": true, "threshold": 15, "text": "Lose no more than 15 Conduct", "say_on_fail": {"speaker": "shai", "text": "That is past fifteen. A block with a cannon round in it is not the thing we came to carry out."}}
]
```

**`enemy.garrison`**

```json bt3.garrison
[
  {"unit": "militia_cell", "count": 2, "at": [32.5, 16.5], "stance": {"kind": "garrison", "building": [32, 14]}, "tag": "bt3_guard_west", "group": "west_block"},
  {"unit": "atgm_cell", "count": 1, "at": [33.5, 16.5], "stance": {"kind": "garrison", "building": [33, 14]}, "group": "west_block"},
  {"unit": "militia_cell", "count": 2, "at": [42.5, 21.5], "stance": {"kind": "garrison", "building": [42, 23]}, "tag": "bt3_guard_east", "group": "east_block"},
  {"unit": "atgm_cell", "count": 1, "at": [43.5, 21.5], "stance": {"kind": "garrison", "building": [43, 23]}, "group": "east_block"},
  {"unit": "militia_cell", "count": 1, "at": [36.5, 18.5], "stance": {"kind": "garrison", "building": [36, 19]}, "group": "lane"},
  {"unit": "militia_cell", "count": 1, "at": [46.5, 24.5], "stance": {"kind": "garrison", "building": [46, 25]}, "group": "lane"}
]
```

**`triggers`**

```json bt3.triggers
[
  {"id": "bt3_west_warns_east", "label": "The east block has been warned", "on": {"kind": "zone_entered", "zone": "bt3_block_w"}, "do": {"kind": "commit", "group": "east_block", "to": "yard_w_point"}, "say": {"speaker": "idit", "text": "Shots at the west block. The east block heard them, and it is moving a team to its yard."}},
  {"id": "bt3_east_warns_west", "label": "The west block has been warned", "on": {"kind": "zone_entered", "zone": "bt3_block_e"}, "do": {"kind": "commit", "group": "west_block", "to": "yard_e_point"}, "say": {"speaker": "idit", "text": "The west block heard that. Twenty seconds is what the lane gives them to cross it."}}
]
```

Not in the fragments, from the sheets: `name`, `dispatch`, `briefing`, `debrief`, `aftermath`, `hostages_place` (`the north of the camp quarter`); `time_limit_s` 720, `target_minutes` 6, `map.time_of_day` `day`, `ledger` `requires` ['roster.surviving_units', 'intel.marked_positions'] / `produces` ['roster.surviving_units', 'roe.mission_ratings', 'campaign.completed_missions', 'campaign.mission_results', 'civ.hostages_recovered'].


---

## 6. BT IV: `bir_tarsha_4_clearance` · The Blade Line

Phase `clearance`, day, **Captain**, requires **R I**, produces **R M C X**, `target_minutes` 7, economy: a camp, 300 + 90/min, no income zone. **Which end of the belt, what to do about the berms, and where to answer the fire from the lee.**

### 6.1 Flags

| flag | meaning in the fiction |
|---|---|
| `clear_works` | every structure in `fence_works` is destroyed (31, snapshotted at start); fails at 390 s |
| `drop_shafts` | the three routes with a mouth in `fence_works` are down; fails at 390 s |
| `blades` | **engine: GH-1439.** fails when 2 of the 4 tagged D9s are dead or taken; completes when both work objectives are complete and every surviving blade stands in `far_gate` |
| `keep_the_hamlet` | Conduct lost has not passed 12 |
| `bt4_lee_opens`, `bt4_vent_opens` | the missile teams have appeared in the lee; the shaft crew has appeared behind the escort |

### 6.2 ECA rows

| event | IF | THEN | cue bound | status |
|---|---|---|---|---|
| Start | mission start | title, briefing | `title`, `brief` | live |
| The lee opens | `zone_entered fence_works` (the first player unit in the band) | `spawn` 2 `atgm_cell` at `bait_lee`, holding | toast `Fire is coming from the hamlet's lee`; radio Idit | live |
| A shaft opens | `timer_s` 240 | `spawn` 2 `militia_cell` at `vent_w`, holding | toast `A shaft has opened behind the escort`; radio Idit | live |
| Works level | `clear_works` complete | objective `say` | radio Shai | live |
| Shafts down | `drop_shafts` complete | objective `say` | radio Idit | live |
| Blades through | `blades` complete | objective `say` | radio Shai | **engine: GH-1439** |
| Two blades gone | `blades` fails | objective `say_on_fail`; the mission is lost | radio Idit | **engine: GH-1439** (today: fails on the first) |
| Ceiling crossed | `keep_the_hamlet` fails | the mission is lost | radio Shai (`say_on_fail`) | live |
| One blade down | a tagged D9 dies | — | radio Shai | engine |
| End | `missionEnd` | — | `toast`, `debrief` | live |

### 6.3 AI director

| t | event | what appears | where | stance |
|---|---|---|---|---|
| 0 | stock | 6 `militia_cell` (one in each firing position, three tagged `bt_works_crew`); `digger_crew` (tagged) | `fence_works` | garrison; hold |
| 0 | stock | `atgm_cell` (39.5,23.5), `atgm_cell` (34.5,23.5), `rpg_team` (35.5,26.5) | either side of the barrier | hold; hold; ambush 4 |
| 0 | stock | `mortar_crew` (40.5,14.5) | east of the ridge | hold |
| 0 | stock | 3 `militia_cell` | `in_tunnel` at the three vents | hold (buried) |
| first player unit in `fence_works` | `bt4_lee_opens` | 2 `atgm_cell` | `bait_lee` (20,13) | hold |
| 240 s | `bt4_vent_opens` | 2 `militia_cell` | `vent_w` (14,15) | hold |

**Pressure curve.** The blades are 10 steps from the lane's west end and 29 from the barrier face (48 s at 0.6 tiles/s). The first minute is travel under no fire. The moment any unit enters the band the lee opens: two Kornet teams at 13.6 tiles from the lane's centre, out of range of both ends and out of the Lavi's sight (§11), so they are answered by the sniper or the `recon_zikit` or not at all. The mortar (range 16) covers the lane's east end (13.9) and the **far gate itself** (12.2), so arrival is not shelter. At 240 s a section appears at the west vent, behind a force that has moved east. The barrier's two missile teams and the RPG cover the wall the blades must cut. There are no waves; the clock is the 390 s on both work objectives.

### 6.4 Map requirements (`bir_tarsha_4`)

Grid: the design's §3 (flat, `arid`, 48 × 48). Markers and zones below are new to the map; open-tile counts and walks are from §11.

| marker | tile | purpose |
|---|---|---|
| `corral` | (6,16) | player start and the dozers' park (IV, V) |
| `lane_w` | (12,26) | dressing: west lane reference (IV) |
| `lane_c` | (24,26) | dressing: centre lane reference (IV) |
| `lane_e` | (33,26) | dressing: east lane reference (IV) |
| `bait_lee` | (20,13) | the missile teams' spawn (IV) |
| `vent_w` | (14,15) | the shaft crew's spawn (IV) |
| `far_gate_point` | (42,26) | dressing: the escort's destination (IV) |

| zone | rect [x,y,w,h] | open tiles | used by |
|---|---|---|---|
| `fence_works` | [10, 20, 27, 10] | 213 | `clear_works`, `drop_shafts`; trigger |
| `hamlet` | [11, 5, 19, 8] | 121 | flagged |
| `far_gate` | [38, 22, 9, 8] | 72 | `blades` destination |

| tunnel | mouth | waypoints | vent | `pre_dug` |
|---|---|---|---|---|
| `bt4_w` | [14, 24] | [[14, 20]] | [14, 15] | yes |
| `bt4_c` | [24, 25] | [[24, 21]] | [24, 17] | yes |
| `bt4_e` | [31, 26] | [[32, 21]] | [33, 16] | yes |

### 6.5 Twists

| id | proposal | class |
|---|---|---|
| T-BT4a | The lee opens when the first unit enters the band (adopted). | expressible today |
| T-BT4b | A shaft vents behind the escort at 240 s (adopted). | expressible today |
| T-BT4c | The hamlet's residents shelter in the cellars: told in the briefing, never shown. | no content |

### 6.6 Gap report and playtest asks

| gap | smallest proposal | owner | status |
|---|---|---|---|
| **GH-1439**: `fail_after_losses` and `until` on `escort` | PR 1454, option A | `sim-guard` | **blocks IV** |
| BT-G1: 13 `low_profile` tiles need one `demolish` each | none; the design cost | — | player orders |
| BT-G2: a `move` to an unreachable goal for a wheeled unit behind `T` | check `walk_mission.ts` that the group does not stall | `mission-author` | world-walk |
| the design's “Logistics buys replacement infantry only” is intent, not data: a camp's menu is the whole unlocked menu (`lineTakes`: only a production work's line is restricted by role) | none needed; `playtest` reads what a player buys | `playtest` | IV |

**Playtest asks.**
- **Cannot run until GH-1439 lands.** With today's escort (fails on the first loss, completes at arrival) the mission can be scratch-played only.
- A passive plan must lose to the 390 s clock on `clear_works`, not stall; a naive attack-move must lose a blade.
- Is the 390 s enough? The lane is 27 steps (45 s), the 13 berm tiles are 13 explicit orders, the T-wall falls to a halted D9 in 2 s.
- Do the two work objectives finish in an order the player can choose?

### 6.7 Copy-ready fragments

Field names are the schema's. `at` values are tile centres. The `town` and the map are `mission-author`'s.

> **`blades` is `engine: GH-1439`.** `fail_after_losses` and `until` do not exist in the schema yet. Until they land, `mission-author` must not ship this file; a scratch variant for the harness is the same row with those two keys removed (today's escort: fails on the first loss, completes at arrival).

**`starting_force`**

```json bt4.starting_force
[
  {"unit": "dozer_d9", "count": 4, "at": [4.5, 15.5], "tag": "blades"},
  {"unit": "ifv_namer", "count": 2, "at": [8.5, 18.5]},
  {"unit": "mbt_lavi", "count": 2, "at": [8.5, 21.5]},
  {"unit": "inf_squad", "count": 4, "at": [10.5, 15.5], "from_ledger": true},
  {"unit": "yahalom_squad", "count": 2, "at": [13.5, 17.5]},
  {"unit": "sniper_team", "count": 1, "at": [14.5, 15.5]},
  {"unit": "mortar_team", "count": 1, "at": [12.5, 19.5]},
  {"unit": "ugv_recon_dog", "count": 1, "at": [15.5, 19.5]}
]
```

**`roe`**

```json bt4.roe
{
  "enabled": true,
  "flagged_zones": [
    "hamlet"
  ],
  "flagged_structure_penalty": 3,
  "fail_below": 55
}
```

**`resources`** and **`structures`**

```json bt4.resources
{
  "logistics_start": 300,
  "logistics_rate_per_min": 90
}
```

```json bt4.structures
[
  {"type": "camp", "at": [3, 18], "size": [2, 2]}
]
```

**`objectives`**

```json bt4.objectives
[
  {"id": "blades", "type": "escort", "primary": true, "target": "blades", "zone": "far_gate", "fail_after_losses": 2, "until": ["clear_works", "drop_shafts"], "text": "Bring the four blades through to the far gate", "say": {"speaker": "shai", "text": "Blades through the fence line. Count them on the far side."}, "say_on_fail": {"speaker": "idit", "text": "That is two blades gone. With half the line left, the work cannot be finished from the near side."}},
  {"id": "clear_works", "type": "raze", "primary": true, "target": "fence_works", "seconds": 390, "text": "Level the works along the Fence Road in six and a half minutes", "say": {"speaker": "shai", "text": "The belt is level. Everything on that strip is flat except the wall."}},
  {"id": "drop_shafts", "type": "collapse", "primary": true, "target": "fence_works", "seconds": 390, "text": "Bring down the three shafts in the works", "say": {"speaker": "idit", "text": "Three shafts down. Nothing in the belt runs under the road any more."}},
  {"id": "keep_the_hamlet", "type": "no_collateral_above", "primary": true, "threshold": 12, "text": "Lose no more than 12 Conduct", "say_on_fail": {"speaker": "shai", "text": "That is past twelve. There is a house in the count that should not be in it."}}
]
```

**`enemy.garrison`**

```json bt4.garrison
[
  {"unit": "militia_cell", "count": 1, "at": [11.5, 21.5], "stance": {"kind": "garrison", "building": [11, 21]}, "group": "works"},
  {"unit": "militia_cell", "count": 1, "at": [20.5, 22.5], "stance": {"kind": "garrison", "building": [20, 22]}, "group": "works"},
  {"unit": "militia_cell", "count": 1, "at": [29.5, 21.5], "stance": {"kind": "garrison", "building": [29, 21]}, "group": "works"},
  {"unit": "militia_cell", "count": 1, "at": [15.5, 28.5], "stance": {"kind": "garrison", "building": [15, 28]}, "group": "works", "tag": "bt_works_crew"},
  {"unit": "militia_cell", "count": 1, "at": [24.5, 28.5], "stance": {"kind": "garrison", "building": [24, 28]}, "group": "works", "tag": "bt_works_crew"},
  {"unit": "militia_cell", "count": 1, "at": [32.5, 28.5], "stance": {"kind": "garrison", "building": [32, 28]}, "group": "works", "tag": "bt_works_crew"},
  {"unit": "digger_crew", "count": 1, "at": [23.5, 24.5], "stance": {"kind": "hold_position"}, "group": "works", "tag": "bt_works_crew"},
  {"unit": "atgm_cell", "count": 1, "at": [39.5, 23.5], "stance": {"kind": "hold_position"}, "group": "barrier"},
  {"unit": "atgm_cell", "count": 1, "at": [34.5, 23.5], "stance": {"kind": "hold_position"}, "group": "barrier"},
  {"unit": "rpg_team", "count": 1, "at": [35.5, 26.5], "stance": {"kind": "ambush", "tiles": 4}, "group": "barrier"},
  {"unit": "mortar_crew", "count": 1, "at": [40.5, 14.5], "stance": {"kind": "hold_position"}, "group": "bait"},
  {"unit": "militia_cell", "count": 1, "at": [14.5, 15.5], "stance": {"kind": "hold_position"}, "in_tunnel": "bt4_w", "group": "shafts"},
  {"unit": "militia_cell", "count": 1, "at": [24.5, 17.5], "stance": {"kind": "hold_position"}, "in_tunnel": "bt4_c", "group": "shafts"},
  {"unit": "militia_cell", "count": 1, "at": [33.5, 16.5], "stance": {"kind": "hold_position"}, "in_tunnel": "bt4_e", "group": "shafts"}
]
```

**`triggers`**

```json bt4.triggers
[
  {"id": "bt4_lee_opens", "label": "Fire is coming from the hamlet's lee", "on": {"kind": "zone_entered", "zone": "fence_works"}, "do": {"kind": "spawn", "units": [{"unit": "atgm_cell", "count": 2, "at": [20.5, 13.5], "stance": {"kind": "hold_position"}, "group": "lee"}]}, "say": {"speaker": "idit", "text": "Missile teams out of the hamlet's lee, on the lane. The houses stand behind them, and that is where they want the answer to go."}},
  {"id": "bt4_vent_opens", "label": "A shaft has opened behind the escort", "on": {"kind": "timer_s", "value": 240}, "do": {"kind": "spawn", "units": [{"unit": "militia_cell", "count": 2, "at": [14.5, 15.5], "stance": {"kind": "hold_position"}, "group": "vent"}]}, "say": {"speaker": "idit", "text": "A shaft vented behind you, south of the hamlet. It has been waiting for the blades to pass."}}
]
```

Not in the fragments, from the sheets: `name`, `dispatch`, `briefing`, `debrief`, `aftermath`, `hostages_place`; `time_limit_s` 840, `target_minutes` 7, `map.time_of_day` `day`, `ledger` `requires` ['roster.surviving_units', 'intel.marked_positions'] / `produces` ['roster.surviving_units', 'roe.mission_ratings', 'campaign.completed_missions', 'campaign.mission_results'].


---

## 7. BT V: `bir_tarsha_5_subterranean` · Under the Fence

Phase `subterranean`, dusk, **Captain**, requires **R I**, produces **R M C X I H**, `target_minutes` 7, no economy. **The order of the charges, and whether the person and the commander come before the last one.**

### 7.1 Flags

| flag | meaning in the fiction |
|---|---|
| `all_five` | the five routes with a mouth in `fence_road` are down; fails at 390 s |
| `walk_the_person_out` | the one person has reached `rescue_refuge`; fails at 330 s; secondary, `carries` |
| `take_the_commander` | `bt5_block_commander` is dead (not removed); secondary |
| `bt5_commander_moves` | a third of the stock is dead and the post has been ordered north |
| `bt5_chamber_reached` | a player unit is within reach of the chamber |

### 7.2 ECA rows

| event | IF | THEN | cue bound | status |
|---|---|---|---|---|
| Start | mission start | title, briefing | `title`, `brief` | live |
| The post empties | `casualties_pct` 33 (3 of 9 bodies) | `withdraw_to` group `post` → `north_exit` | toast `The block commander is pulling north`; radio Idit | live |
| The chamber is in reach | `zone_entered chamber_reach` | `spawn` with no units (a label and a line) | toast `The chamber is in reach`; radio Shai | live |
| The person arrives | `evacuated` event | `walk_the_person_out` counts | toast `clear (1)` | live |
| The person is out | `walk_the_person_out` complete | objective `say` | radio Idit | live |
| The post is taken | `take_the_commander` complete | objective `say` | radio Shai | live |
| All five down | `all_five` complete | objective `say`; the mission ends the same tick | radio Idit | live |
| Clock out | `all_five` fails at 390 s | the mission is lost | radio Shai (`say_on_fail`) | live |
| Ceiling crossed | `keep_the_surface` fails | the mission is lost | radio Shai (`say_on_fail`) | live |
| The wide route is opened | the wide route is identified | — | radio Idit | engine |
| End | `missionEnd` | — | `toast`, `debrief`, `aftermath` | live |

### 7.3 AI director

| t | event | what | where | stance |
|---|---|---|---|---|
| 0 | stock | `militia_cell` commander (tag `bt5_block_commander`) and 2 `militia_cell` | the command post, building (38,16) | garrison (group `post`) |
| 0 | stock | 2 `charge_squad`; `digger_crew` | (19.5,23.5), (29.5,24.5); (33.5,22.5) | ambush 5; ambush 5; hold (group `mouths`) |
| 0 | stock | 3 `militia_cell` | `in_tunnel` at the vents of `bt5_a`, `bt5_b`, `bt5_c` | hold (buried) |
| `casualties_pct` 33 | `bt5_commander_moves` | `post` | → `north_exit` (40,2) | withdraw |

**Pressure curve.** The strip is IV's, razed, so nothing stands between the corral and the mouths. The charge squads are the first contact (an ambush at 5 tiles on the two nearest mouths), and the buried stock vents behind the engineers. Three deaths of nine send the post north, which is also the cue that the commander is leaving: the player who wants him must press the post early. The person in the chamber (44.5,24.5) is 38 steps from the corral and 38 from the refuge, so the walk out costs about 90 s of the 390 s that the charges also need. The dusk is a rendering fact, not a mechanic.

### 7.4 Map requirements (`bir_tarsha_5`)

Grid: the design's §3 (flat, `arid`, 48 × 48). Markers and zones below are new to the map; open-tile counts and walks are from §11.

| marker | tile | purpose |
|---|---|---|
| `corral` | (6,16) | player start and the dozers' park (IV, V) |
| `rescue_point` | (6,17) | the person's refuge (V); inside `rescue_refuge` |
| `north_exit` | (40,2) | where the post withdraws to (V) |

| zone | rect [x,y,w,h] | open tiles | used by |
|---|---|---|---|
| `fence_road` | [0, 24, 48, 6] | 288 | `all_five` |
| `chamber_reach` | [40, 18, 8, 6] | 42 | trigger (V) |
| `rescue_refuge` | [2, 14, 10, 6] | 60 | `walk_the_person_out` destination (V) |
| `hamlet` | [11, 5, 19, 8] | 121 | flagged |

| tunnel | mouth | waypoints | vent | `pre_dug` |
|---|---|---|---|---|
| `bt5_a` | [8, 27] | [[8, 20]] | [8, 14] | yes |
| `bt5_b` | [19, 25] | [[19, 20]] | [19, 16] | yes |
| `bt5_c` | [29, 27] | [[30, 22]] | [30, 18] | yes |
| `bt5_d` | [34, 24] | [[34, 20]] | [34, 17] | yes |
| `bt5_wide` | [40, 26] | [[40, 20]] | [45, 12] | yes |

### 7.5 Twists

| id | proposal | class |
|---|---|---|
| T-BT5a | The wide route is told, never shown (G-13): the sim does not change. | no content |
| T-BT5b | The commander's withdrawal reveals a sixth route. No trigger identifies a route. | engine |
| T-BT5c | The captive's answer changes Sur's re-brief: a briefing that branches on a ledger key. | engine |

### 7.6 Gap report and playtest asks

| gap | smallest proposal | owner | status |
|---|---|---|---|
| a trigger-keyed wave is unused here; none needed | — | — | — |
| a `spawn` with no units as a label-only trigger | an optional `do.kind: none` | `sim-guard` | Qasr's script F-5 idiom |

**Playtest asks.**
- The rescue must be possible before the last charge: the person is 38 steps from the corral and 38 from the refuge.
- Does the commander withdraw before a sensible plan reaches the post?
- A passive plan must lose to the 390 s clock.

### 7.7 Copy-ready fragments

Field names are the schema's. `at` values are tile centres. The `town` and the map are `mission-author`'s.

**`starting_force`**

```json bt5.starting_force
[
  {"unit": "yahalom_squad", "count": 2, "at": [4.5, 15.5], "from_ledger": true},
  {"unit": "inf_squad", "count": 2, "at": [7.5, 14.5], "from_ledger": true},
  {"unit": "recon_zikit", "count": 1, "at": [4.5, 18.5]},
  {"unit": "ugv_recon_dog", "count": 1, "at": [8.5, 18.5]},
  {"unit": "sniper_team", "count": 1, "at": [10.5, 16.5]},
  {"unit": "inf_medic_squad", "count": 1, "at": [6.5, 19.5]},
  {"unit": "mbt_lavi", "count": 1, "at": [10.5, 20.5]}
]
```

**`roe`**

```json bt5.roe
{
  "enabled": true,
  "flagged_zones": [
    "hamlet"
  ],
  "flagged_structure_penalty": 3,
  "fail_below": 55
}
```

**`civilians`**

```json bt5.civilians
{
  "refuge": "rescue_point",
  "groups": [
    {
      "unit": "civilians",
      "count": 1,
      "at": [
        44.5,
        24.5
      ]
    }
  ]
}
```

**`objectives`**

```json bt5.objectives
[
  {"id": "all_five", "type": "collapse", "primary": true, "target": "fence_road", "seconds": 390, "text": "Bring down the five routes under the Fence Road in six and a half minutes", "say": {"speaker": "idit", "text": "All five down. The Fence Road runs over nothing."}, "say_on_fail": {"speaker": "shai", "text": "The clock is out. Whatever is still open under the Fence is open to anyone."}},
  {"id": "keep_the_surface", "type": "no_collateral_above", "primary": true, "threshold": 10, "text": "Lose no more than 10 Conduct", "say_on_fail": {"speaker": "shai", "text": "That is past ten. The houses above the routes are the count now."}},
  {"id": "walk_the_person_out", "type": "evacuate_before", "primary": false, "target": "rescue_refuge", "count": 1, "seconds": 330, "hostages": true, "carries": true, "text": "Walk the person in the chamber out to the refuge", "say": {"speaker": "idit", "text": "One out and walking, with time still on the clock. That is the one that counts."}},
  {"id": "take_the_commander", "type": "eliminate_hvt", "primary": false, "target": "bt5_block_commander", "text": "Take the block commander", "say": {"speaker": "shai", "text": "The post is ours. The routes under it can be taken in any order now."}}
]
```

**`enemy.garrison`**

```json bt5.garrison
[
  {"unit": "militia_cell", "count": 1, "at": [38.5, 18.5], "stance": {"kind": "garrison", "building": [38, 16]}, "tag": "bt5_block_commander", "group": "post"},
  {"unit": "militia_cell", "count": 2, "at": [39.5, 18.5], "stance": {"kind": "garrison", "building": [38, 16]}, "group": "post"},
  {"unit": "charge_squad", "count": 1, "at": [19.5, 23.5], "stance": {"kind": "ambush", "tiles": 5}, "group": "mouths"},
  {"unit": "charge_squad", "count": 1, "at": [29.5, 24.5], "stance": {"kind": "ambush", "tiles": 5}, "group": "mouths"},
  {"unit": "digger_crew", "count": 1, "at": [33.5, 22.5], "stance": {"kind": "hold_position"}, "group": "mouths"},
  {"unit": "militia_cell", "count": 1, "at": [8.5, 14.5], "stance": {"kind": "hold_position"}, "in_tunnel": "bt5_a", "group": "shafts"},
  {"unit": "militia_cell", "count": 1, "at": [19.5, 16.5], "stance": {"kind": "hold_position"}, "in_tunnel": "bt5_b", "group": "shafts"},
  {"unit": "militia_cell", "count": 1, "at": [30.5, 18.5], "stance": {"kind": "hold_position"}, "in_tunnel": "bt5_c", "group": "shafts"}
]
```

**`triggers`**

```json bt5.triggers
[
  {"id": "bt5_commander_moves", "label": "The block commander is pulling north", "on": {"kind": "casualties_pct", "value": 33}, "do": {"kind": "withdraw_to", "group": "post", "to": "north_exit"}, "say": {"speaker": "idit", "text": "The post east of the ridge is emptying north. Whoever left it carries the remnant with him, and he is not coming back."}},
  {"id": "bt5_chamber_reached", "label": "The chamber is in reach", "on": {"kind": "zone_entered", "zone": "chamber_reach"}, "do": {"kind": "spawn"}, "say": {"speaker": "shai", "text": "You are at the chamber. Walk that one person out before you touch the last route."}}
]
```

Not in the fragments, from the sheets: `name`, `dispatch`, `briefing`, `debrief`, `aftermath`, `hostages_place` (`the Fence Road`); `time_limit_s` 840, `target_minutes` 7, `map.time_of_day` `dusk`, `ledger` `requires` ['roster.surviving_units', 'intel.marked_positions'] / `produces` ['roster.surviving_units', 'roe.mission_ratings', 'campaign.completed_missions', 'campaign.mission_results', 'intel.marked_positions', 'civ.hostages_recovered'].


---
## 8. Doctrine pins for `tools/src/bir_tarsha_doctrine.test.ts`

Every literal is from the script run in §11, on the design's grids. Each pin is a hand-written number, never imported from the code under test (CLAUDE.md, the falsification rule), and each arrives with the mutation that turns it red. Steps are 8-connected, corner-cutting refused; lengths in tiles are Euclidean.

| # | pin | literal | falsify by |
|---|---|---|---|
| **BT-A1** | I: the three resident groups walk to `gate_refuge_point` in 21, 21 and 25 steps, and none starts inside `gate_refuge` | 21 / 21 / 25 | move a group to (6.5,10.5) |
| **BT-A2** | II: the three resident groups start outside `safe_quarter` and walk 13, 12 and 16 steps to `safe_point` | 13 / 12 / 16 | put a group at (10.5,26.5) |
| **BT-A3** | II: the mortar at (31.5,31.5) reaches all three resident groups and does not reach `safe_point` or the start | 15.0, 14.9, 13.0 ≤ 16; 21.6 and 22.8 > 16 | move the mortar to (31.5,38.5) |
| **BT-A4** | III: the two doors are 10 steps apart; the taken are 17 and 19 steps from the extraction | 10; 17; 19 | wall the lane at (36,17) |
| **BT-A5** | IV: `far_gate_point` is unreachable for a wheeled body from the corral while every `T` tile stands, and 36 steps away once they fall; on foot it is 36 steps through the `b` gap | none; 36; 36 | open (36,24) to `.` |
| **BT-A6** | IV: no house, shanty or clinic within 8 open tiles of `fence_works` (Chebyshev distance 9) | 9 | add an `h` at (20,16) |
| **BT-A7** | IV: `fence_works` holds 6 firing positions, 3 posts, 2 workshops (18 non-low-profile with the 7 `T`) and 13 `low_profile` tiles (8 hesco, 5 sandbag) | 6 / 3 / 2 / 7 / 8 / 5 | add one `g` tile |
| **BT-A8** | IV: the Kornet team at (20.5,13.5) is 13.6 from the lane's centre (range 14), 15.3 and 18.4 from its ends; the Lavi's sight (12) does not reach it from the lane (13.0) | 13.6 ≤ 14; 15.3, 18.4 > 14; 13.0 > 12 | move the team to (20.5,15.5) |
| **BT-A9** | IV: the mortar at (40.5,14.5) is 13.9 from the lane's east end and 12.2 from `far_gate_point` (range 16), 20.0 from its centre | 13.9, 12.2 ≤ 16; 20.0 > 16 | move the mortar to (44.5,14.5) |
| **BT-A10** | IV: the three routes' mouths lie in `fence_works`; V: the five routes' mouths lie in `fence_road`; every mouth, waypoint and vent is open ground | 3; 5 | move a mouth to row 30 |
| **BT-A11** | V: the person is 38 steps from `rescue_point` and the corral is 38 steps from the person | 38; 38 | wall the lane |
| **BT-A12** | the escort tag `blades` names 4 bodies and `fail_after_losses` (2) ≤ 4 | 4 | set 5 |
| **BT-A13** | the body counts the `casualties_pct` triggers divide by | I 8, II 6, III 8, IV 14 (3 buried), V 9 (3 buried); V's 33% is 3 deaths | add one body to V's post |
| **BT-A14** | `time_limit_s` is exactly twice `target_minutes` | 720 / 840 / 720 / 840 / 840 | set 700 |

---

## 9. Order of work and hand-off for `mission-author`

### 9.0 Precedence: where the design and this script disagree, this script wins

The MDD (PR 1453) was written before the engine reads in this script. Where a statement below conflicts with one in the MDD, **this script is the one `mission-author` builds from**. The superseded MDD statements:

| MDD statement | superseded by | why |
|---|---|---|
| §3.4, §3.5: the vents and the missile teams sit in the hamlet's **dead ground** | F-5 | a flat map has no dead ground; the bait works by overshoot and by sight range |
| §3.3: hesco, sandbag and T-wall are **placed `owner: 1`** | F-7 | neutral works need no owner; the map letters carry them |
| §3.4: four route rows and a fifth row that is the chamber | F-8 | five routes: `bt5_d` added |
| §3.4, §5.5: the zone `chamber_refuge` | F-9 | split into `chamber_reach` and `rescue_refuge` |
| §5.2: II's residents are **in** `safe_quarter` | D-BN1 | they start on the cross road |
| §4: III's `evacuate_before` ×2 | D-BN2 | one objective, count 3, 360 s |
| §4: the id `bir_tarsha_3_buildup` | lead ruling 6 | the id is `bir_tarsha_3_clearance` |
| §5.1: the crew commits "only if the gate garrison is engaged" | F-1 | `first_contact` is global; a zone trigger instead |
| §5.3: the warning comes after 20 s | F-2 | no trigger delay; the walk supplies it |

### 9.1 Order

1. **Schema and world.** `mission.schema.json` `town` enum gains `bir_tarsha` (G-10). `data/campaign/world.json`: the town in the `marj` region, and `sur`'s `unlock.after_mission` moves from `deir_amun_3_subterranean` to `bir_tarsha_5_subterranean`. `data/campaign/commander.json`: `ranks[0].until_mission` moves from `deir_amun_3_subterranean` to `bir_tarsha_5_subterranean` (the Major promotion then fires on the first Sur mission, ruling 5).
2. **Five maps from two bases:** `bir_tarsha` (the gate base) with its variants `bir_tarsha_2` and `bir_tarsha_3`, and `bir_tarsha_4` (the strip base) with its variant `bir_tarsha_5`. From the design's grids, flat, `arid`, with the markers, zones and tunnels of §3 to §7. Run `map_visibility.test.ts` (84%); a map that fails goes back to `campaign-designer`, not to this document.
3. **BT I, II, III**, then **BT V**, assembling §3 to §7. Each is complete without GH-1439.
4. **BT IV last, and only when GH-1439 has landed.** Its objective list needs the two escort fields. Until then author it as a scratch file outside `data/missions/` with the keys removed.
5. **`tools/src/bir_tarsha_doctrine.test.ts`** with the §8 pins.
6. **`walk_placements.ts` and `walk_mission.ts`** on each; check F-12 (`identify_the_gate`), BT-G2 (the dozers' group does not stall on the unreachable `far_gate_point` before the T-wall falls) and the §3.7 civilians' routes.
7. **`playtest`** the ladder with the asks in each section. IV waits for the harness's `taggedIds` (PR 1454 §8).

### 9.2 The hand-off list carried from the narrative sheet (§8.1)

Not mine to edit (`mission-author`'s fields); the exact text is here so it is not lost.

**`data/missions/deir_amun_3_subterranean.json` `aftermath`**, replacing the shipped line, which promotes Shai a town early and says the Marj is quiet:

> Old (173): *Six routes under the junction, and by morning none of them went anywhere. Brigade put a third star on the slip and said nothing else about it. The Marj is quiet. Sur is not.*
>
> New (185): *Six routes under the junction, and by morning none of them went anywhere. The brigades went home in the spring, and one battalion stayed on the Cut. The Marj was quiet until the autumn.*

**`data/campaign/commander.json`**: `ranks[0].until_mission` → `bir_tarsha_5_subterranean` (step 1 above). Its Major `promotion_line` is already in the file and needs no edit.

**`data/campaign/world.json`, spelled out.** A new town in the `marj` region, after `deir_amun`:

```json bt.world.town
{"id": "bir_tarsha", "name": "Bir Tarsha", "at": [345.0, 470.0], "unlock": {"after_mission": "deir_amun_3_subterranean"},
 "missions": ["bir_tarsha_1_recon", "bir_tarsha_2_foothold", "bir_tarsha_3_clearance", "bir_tarsha_4_clearance", "bir_tarsha_5_subterranean"]}
```

- `at` is a **placeholder**: `mission-author` places it against `campaign/world_map.png` so the marker clears Deir Amun's (281.4,480.9) and the `sur` region's edge.
- The town's own `unlock` is `deir_amun_3_subterranean`, as Ein Qasab's is `wadi_halam_3_counterraid`: it opens when the Marj's fourth town is done.
- **Separate edit:** the `sur` region's `unlock.after_mission` moves from `deir_amun_3_subterranean` to `bir_tarsha_5_subterranean`. Do not confuse the two.
- **`world.taken`** (19) is the board's total of the taken, read against `civ.hostages_recovered` (`campaign.ts`, the function that returns `{ taken, recovered }`). This town adds **5** (four in III, one in V); Qasr Liwan adds its own. Not read further than that function's head.
- **`commander.json`:** only `ranks[0].until_mission` moves, to `bir_tarsha_5_subterranean`. The Major rank's own `until_mission` (`umm_zeitoun_4_clearance`) and its `promotion_line` stay untouched.

**Also for this town:** two `hostages_place` values (`the north of the camp quarter`, `the Fence Road`); a locale overlay under `data/locales/<lang>/missions.json` for the five missions; briefing images; the five `name`s, briefings and objective texts from the narrative sheet.

### 9.3 Narrative deltas this script needs (`narrative-designer`)

| # | where in `narrative.md` | change | why |
|---|---|---|---|
| **N-1** | III trigger table, `bt3_west_warns_east` radio | *“The west block is up. Count twenty seconds from that last shot.”* → *“The west block heard that. Twenty seconds is what the lane gives them to cross it.”* | Idit gives no order (F-11) |
| **N-2** | III, `objective(bring_three_out, complete)` radio | *“Count them again when you are clear of the lane.”* → *“I will count them again when you are clear of the lane.”* | same |
| **N-3** | IV, `bt4_lee_opens` radio | drop *“Do not answer toward the houses. Put the escort between the blades and them.”*; use *“The houses stand behind them, and that is where they want the answer to go.”* | same; Shai's beat 4 already gives the order |
| **N-4** | II, the `SimEvent` mortar row (`engine`) | *“Count the seconds between rounds and move the residents inside them.”* → *“The gaps between rounds are the only safe time on it.”* | same |
| **N-5** | II, the two `timer_s` trigger rows and their labels | become **wave** rows (`enemy.waves[].say`) with no `label`; strike `bt2_first_push` and `bt2_second_push` from the label table | F-3 |
| **N-6** | IV, `bt4_vent_opens` | action is `spawn` at `vent_w`, not `dismount`; the radio drops *“dead ground”* | F-4, F-5 |
| **N-7** | V, `bt5_chamber_reached` and the objective table | the trigger's zone is `chamber_reach`; the destination zone is `rescue_refuge` (was `chamber_refuge`) | F-9 |
| **N-8** | I, the crew trigger | the event is `zone_entered(gate_approach)`, not `first_contact` | F-1 |

All eight lines are carried in the fragments above as the replacement text. None changes a beat, an objective text, a label or a character count in a briefing.

---

## 10. Gap report

| id | gap | smallest proposal | owner | blocks |
|---|---|---|---|---|
| **GH-1439** | `escort` fails on the first loss and completes at arrival | PR 1454 option A: `fail_after_losses`, `until` | `sim-guard` | **BT IV** |
| G-10 | `town` enum has eight towns | add `bir_tarsha`; `world.json`; GDD §2 | `mission-author` | all five |
| G-16 | the playtest harness finds units by type, not tag | `MissionRuntime.taggedIds` (PR 1454 §8) | `playtest` | IV's ladder |
| BT-G1 | 13 `low_profile` tiles need one `demolish` each | none; the design cost | — | — |
| BT-G2 | a `move` to an unreachable goal for a wheeled unit behind `T` | `walk_mission.ts` check | `mission-author` | IV |
| N-G1 | `first_contact` is global | a group-scoped contact trigger | `sim-guard` | — (F-1) |
| N-G2 | a wave has no label | optional `label` on `waves[]` | `sim-guard` | — (F-3) |
| N-G3 | a trigger has no delay | `do.delay_s` | `sim-guard` | — (F-2) |
| N-G4 | `casualties_pct` is global | per-group form | `sim-guard` | T-BT3b |
| N-G5 | no label-only trigger | `do.kind: none` | `sim-guard` | — (V's `bt5_chamber_reached` uses the `spawn`-with-no-units idiom) |
| N-G6 | `hold_for` and `zone_entered` count aircraft | `ground_only` on both (Qasr's G-QL5) | `sim-guard` | II (no aircraft fielded) |

---

## 11. Verification record

All run in this session on the design's grids (`base1`, `g2`, `g3`, `strip`, `strip5` rendered from `docs/campaign/bir_tarsha/design.md` §3), with Python. The checker has the same rules as the runtime's: bodies spread 1.25 tiles (`k mod 3` east, `k div 3` south), a vehicle refused a boulder, a garrison or a buried placement exempt, a camp footprint blocked before any force spawns.

**1. Spawn clearance.** 81 placements checked (14, 13, 14, 24, 16), **0 would throw**. The checker was falsified with five constructed faults and went red on all five: a body moved onto a firing position; a count-3 group at the map edge (off the map at (49,26)); a dozer on a boulder at (36,25); a garrison stance on open ground at (32,10); a squad on the camp footprint at (27,6).

**2. References.** Every unit id resolves under `data/units/`; every trigger `to`, `from`, `zone` and `group` resolves to a marker, zone or placement; every objective target to a zone or a tag; every `until` to a primary; every key in every fragment is in the schema (`fail_after_losses` and `until` excepted, labelled `engine`); every destination zone holds its refuge marker and no civilian body starts inside it. **0 errors.** Falsified with six constructed faults, all red: a trigger group no placement declares; a zone the map lacks; an `until` that names a secondary; a resident inside the destination; an invented placement key (`delay_s`); a flagged zone that does not exist.

**3. Measurements** (the literals of §8): zones' open tiles — I 70, 45, 170, 63, 288; II 68, 168, 18, 66, 288; III 39, 46, 32; IV 213, 121, 72; V 288, 42, 60. Walks, ranges and counts as in §8. IV's `fence_works` structure census: 6 F, 3 P, 2 X, 8 H tiles, 5 g tiles, 7 T tiles.

**4. Not run, and why.** `pnpm validate:data`, `walk_placements.ts` and `walk_mission.ts`: none of the five maps or missions exists. No JSON was written into `data/`. The fragments are checked against the schema's key lists, not against `validate_data.mjs`. The pressure curves in §3 to §7 are arithmetic on distances and speeds, **not simulation**; difficulty is `playtest`'s.

**5. What the checks cannot see.** Detection (F-12), whether the wheeled `far_gate_point` stall of BT-G2 occurs, the contested-hold interaction of the terminal garrison with `hold_the_gate`, and the real order of the two work objectives.
