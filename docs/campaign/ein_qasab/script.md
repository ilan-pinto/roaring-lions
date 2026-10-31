# Ein Qasab — Level Script

**Act III · Naharin · "The Flood Week" (Plot B, GH-912).** Three missions: `ein_qasab_1_recon` (map `ein_qasab`),
`ein_qasab_2_foothold` (map `jebel_matar`, new) and `ein_qasab_3_buildup` (map `ein_qasab_3`, new).

**Date:** 2026-10-31. **Status:** design, ready for `mission-author`. No file under `data/` or `packages/` was edited.
**Written against** branch `content/ein-qasab-town` at `94266f9f1`, in `/Users/ilpinto/dev/roaring-lions-ep/wh-rain-build`.

**Read in full this session:** `docs/campaign/wadi_halam_rain/mdd.md` (the ruled design), `docs/campaign/ein_qasab/narrative.md`
(the Narrative Trigger Sheet), `docs/campaign/README.md`, `data/schemas/mission.schema.json`,
`docs/agent-notes/mission-findings.md`, `docs/agent-notes/maps-and-terrain-design.md`, and `docs/campaign/wadi_halam/script.md`
(the shape this document follows).

**Read in the source, not quoted from a summary:**
- `packages/sim/src/mission.ts`: `stepTriggers` (3834–3959), `stepWaves` (3961–3992), `stepObjectives` (4007–4110),
  `spawnPlacement` (3217–3380), `start` (2370–2480), the contact digest (2518–2560);
- `packages/sim/src/civilians.ts`, the wall-breach path in `packages/sim/src/sim.ts` (7362–7510);
- `packages/app/src/campaign.ts`, `gate-sentence.ts`, `ui/worldmap.ts`, `ui/worldmap3d.ts`, `ui/pin-hover.ts`,
  `ui/after-action.ts`;
- `tools/validate_data.mjs`, `validate_works.mjs`, `tools/src/backtest/playtest.ts`, `playtest-run.ts`;
- the precedent mission `data/missions/wadi_halam_3_counterraid.json`.

**Precedents cited per fragment:**
- WH III (`wadi_halam_3_counterraid`): the HVT-in-a-technical shape, the `casualties_pct` → `withdraw_to` run, the camp
  `structures[]` entry, and the swarm wave;
- BS III (`beit_sahwan_3_clearance`) and WH IV (`wadi_halam_4_village`): the `garrison` stance shape;
- UZ II (`umm_zeitoun_2_buildup`): the `supply_corridor` / `income_zones` / `intel_start` block;
- BS I (`beit_sahwan_1_recon`) and BS III: a `civilians.refuge` declared with no `evacuate_before`.

**Status vocabulary**, as in Act I to III:

| status | means |
|---|---|
| `live` | in the schema and the runtime today |
| `schema` | needs a new field, no runtime change |
| `engine` | needs new runtime logic |

### The controller's decisions, as applied here

| decision | where it lands |
|---|---|
| G-P: stand the EQ I causeway carriers at the shipped `causeway_s` marker (22, 34) | §1.7 `civilians.groups[1]` is `"marker": "causeway_s"`. T-A2 was then **measured** (§1.5) |
| Adopt T-A1, T-A2, T-C3 | §1.5 and §3.5 |
| T-B1 only as a `drone_swarm` entering at `rif_n`, measured or held | §2.5: **adopted, one swarm, at 215 s, as a wave.** The probe numbers are in §2.5, and the `playtest` ladder still gates it |
| Hold T-C4. Do not adopt T-A3, T-B2, T-B3, T-C1 | §1.5, §2.5, §3.5 |
| T-C2 not built: the stop works either way, and the failure mode is stated | §3.5 and §4.1 G5. G5 also turned out **smaller than the MDD says** |
| EQ II keeps `requires: roster, intel.marked_positions` (G-U) | §2.7 `ledger` |
| One `kdf_outpost`. If the planner can't build it, say so | §2.5 and §4.5: **the planner can build it** (measured). The fragment keeps it |
| Unenforced play order. No dependency on WH IV/V not having been played | Every tag carries the `eq_` prefix, and no `eq_` tag exists in a shipped mission (grep). WH IV/V marks reach EQ harmlessly, and EQ marks reach them harmlessly |
| Mission ids `ein_qasab_1_recon`, `_2_foothold`, `_3_buildup`, and titles from the sheet | §1–§3 fragments: *The Causeways*, *Dead Ground*, *One Road* |

### §0 — What this script changed from the MDD and the sheet, and why

Every change below was forced by a measurement or a source read made this session. None of them is taste.

| # | change | why (measured or read) |
|---|---|---|
| D1 | **Edge markers moved off x = 47:** `rif_ne` (47,5)→(45,5) and `rif_se` (47,40)→(45,40) on `ein_qasab`; `rif_e` (47,35)→(45,35) on `jebel_matar`; `reed_e` (47,23)→(45,23) on `ein_qasab_3` | A placement spreads its bodies 1.25 tiles apart (`SPREAD`, `mission.ts:705`), and `start()` checks every wave's spawn tiles at load (`assertGroundClear`, 2420–2427). A count-2 wave at x = 47 puts body 2 at x = 48. **Falsified on the scratch mission:** with `rif_ne` back at (47,5), `start()` throws `moto_rpg body 2 of 2 spawns at (48,5), off the 48x48 map`. Shipped edge markers sit at x 44–46 for this reason (`wadi_halam_3` `rif_east` (46,5), `rif_south` (44,40)) |
| D2 | **T-A1 acts on a new group `south_road`** (the 150 s and 300 s waves bound for `causeway_s`), not on the east-track patrol `track` | Routes were measured through the real `FlowField` on `ein_qasab`. From the east track (39,20) to `rif_se`, a wheeled withdrawal is 20 steps and **0 of them on either causeway**: the east downs are open to wheels. From `causeway_s` it is 23 steps, 12 on the south causeway. From the west bank (10,20) it is 47 steps, 21 on it. The MDD's trigger would never have put anything on the causeway. The sheet's label ("Riders pull back along the south causeway") and its `say` are true only of `south_road` |
| D3 | **EQ II `riders_come_through_the_dyke_gap`: `first_contact` → `timer_s` 90** | `first_contact` latches on **any** `fire` event and on **any side's** `contact … identified` (`mission.ts:2525–2527`). On all three maps an idle enemy beside a neutral wall shoots that wall from tick 1 or 2 (the breach path, `sim.ts` 7439–7505, "Standing still is not a reason to stop"). Measured on EQ II: the trigger fired at **0.0 s with no orders given**. The same defect fires shipped triggers at mission start (§4.2 G-FC) |
| D4 | **T-B1 is a wave, not a `spawn` trigger** (215 s, `from: rif_n`, `to: farm`, one `drone_swarm`, with Idit's `say`) | A `spawn` places units with no order (`stepTriggers` 3895–3896). The swarm would hang at the map edge: its weapon reaches 1.5 tiles, and nothing moves it. The two-trigger form (`spawn` plus `commit` on the same tick) prints two feed lines at once. The sheet's label `Drone swarm lifts off the north downs` therefore has no field to sit in. The wave's shipped toast plus the `say` carry the beat. 215 s rather than 200 s keeps it clear of the 195 s wave |
| D5 | **HVT as WH III ships it:** a `technical` in group `ferry` carrying one `militia_cell` tagged **`eq_hvt_winter_road`**. It stands at (25.5,14.5), not (24.5,13.5) | **Precedent:** `wadi_halam_3_counterraid` `amir` / `wh_hvt_amir`. *"Kill or capture Hallaq's man"* is a man, not a truck. **Tag rename** per the sheet's §9 (*ferryman* collides with FERRY). Tag ids reach no player. **The move:** at (24.5,13.5) the HVT stood within 2.5 tiles of the yard wall, and the breach path (D3) had it shooting the wall from tick 1. At (25.5,14.5) it doesn't |
| D6 | **EQ III's 2-civilian hamlet group moved** from (29.5,9.5) to (25.5,9.5) | Body 2 at (30.75, 9.5) lands on a house tile (`h` at x 30–31, row 9 of the MDD §3.3 sketch), and `assertGroundClear` throws |
| D7 | **A `civ_refuge` marker on `jebel_matar` (16,44) and on `ein_qasab_3` (3,1)** | The MDD says the families there "move under fire only". But `stepCivilians` returns at once when `civilians.refuge` is absent (`mission.ts:3587–3588`), so without a refuge they **never move at all**. **Precedent:** BS I and BS III declare a refuge with no `evacuate_before`. Every shipped mission with civilians declares one (`jq` census, 18 of 18) |
| D8 | **New marker `camp_door` (10,41) on `ein_qasab_3`** | The MDD's 200 s wave goes to "the camp exit", which is not a marker. A wave's `to` must name one (`markerPos`) |
| D9 | **EQ II gap rider's first waypoint** (30.5,24.5) → (30.5,27.5) | At (30.5,24.5) it stood 2 tiles from the yard wall at (28,23) and fired an RPG into it at tick 0 (D3). (30,27) is on the north track |
| D10 | **EQ III `income_zones: [{ zone: mill_islet, rate_per_min: 80 }]`** | `docs/campaign/economy/income-numbers.md`: a full hold pays 40% of the phase anchor. A build-up is 200, so 80. UZ II, the one shipped build-up with zones, pays 50 + 30 = 80 |

---

## 1. `ein_qasab_1_recon` — Ein Qasab I — The Causeways

`recon` · 6 min · `time_limit_s` 720 · map `ein_qasab` (shipped, additive markers) · requires **R** · produces **R M C X I E**.

### 1.1 Flags

| flag | kind | means in the fiction |
|---|---|---|
| `picture` | objective (primary, `locate` count 4) | Idit has four positions on the causeways. **Read the rule**: `identified.size >= 4` counts **any** four distinct enemies identified, wave riders included (`mission.ts` 4059–4066), exactly as WH I's picture does. Riders on a causeway in the open will often make the count |
| `get_the_carriers_home` | objective (primary, `evacuate_before`, failable) | three carriers are off the causeways. **Its failure is the mission's loss** |
| `find_the_reed_cell` | objective (secondary, `carries: true`) | `eq_reed_cell` is on the board. It is the **third star**, and it spawns identified with its ambush forfeited in EQ III |
| `eq_causeway_rpg` marked | ledger tag (no objective) | identified here, it reaches `intel.marked_positions` automatically (`mission.ts` 2551–2558), and in EQ III it spawns identified with no ambush |
| `the_track_patrol_turns_for_the_hamlet` fired | trigger | the player stood in the hamlet. The east-track technical is coming |
| `the_riders_pull_back_along_the_south_causeway` fired | trigger | the start-of-mission garrison is half dead. The riders on the south causeway drive out the one way wheels can |

### 1.2 ECA rows

| Event Name | IF | THEN | narrative cue (sheet §2.7) | status |
|---|---|---|---|---|
| mission_start | tick 0 | `starting_force`, `enemy.garrison`, `civilians` spawn. The `title`, `dispatch` and `briefing` show | dispatch §2.2; briefing §2.3 | live |
| the_reed_cell_holds_fire (T-A2) | stance `ambush`, `tiles: 3`, on `eq_reed_cell` at (21.5,35.5), with the carriers at `causeway_s` (22.5,34.5)/(23.75,34.5) | the cell holds fire until a KDF unit closes to 3 tiles **with a line**; then it springs (`checkAmbushSpring`) | Shai's `ambushSprung` line is `engine` (G-E). Briefing beat 6 carries the beat | live |
| wave_100 | `at_seconds: 100` | `moto_rpg` ×2 `from: rif_ne` → `to: causeway_n` | Idit: "Two riders off the north-east…" | live |
| wave_150 | `at_seconds: 150` | `technical` ×1 `from: rif_se`, `group: south_road` → `to: causeway_s` | none, deliberately | live |
| wave_200 | `at_seconds: 200` | `moto_rpg` ×2 `from: rif_se` → `to: hamlet` | Idit: "Two more off the south-east…" | live |
| wave_250 | `at_seconds: 250` | `moto_rpg` ×1 + `technical` ×1 `from: rif_ne` → `to: causeway_n` | none | live |
| wave_300 | `at_seconds: 300` | `moto_rpg` ×2 `from: rif_se`, `group: south_road` → `to: causeway_s` | none (it lands on the carriers' failure tick) | live |
| the_track_patrol_turns_for_the_hamlet | `on: { kind: zone_entered, zone: hamlet }` | `do: { kind: commit, group: track, to: hamlet }` | label `Track patrol turns for the hamlet`; Idit's `say` | live |
| the_riders_pull_back_along_the_south_causeway (T-A1) | `on: { kind: casualties_pct, value: 50 }`, i.e. 3 of the 6 start-of-mission enemies dead | `do: { kind: withdraw_to, group: south_road, to: rif_se }` | label `Riders pull back along the south causeway`; Idit's `say` | live |
| picture complete | `locate`, any 4 identified | objective complete, +40 Intel; Idit's `say` | sheet §2.7 | live |
| find_the_reed_cell complete | `locate` `eq_reed_cell` | complete; the tag joins `intel.marked_positions` | Idit's `say`, the carry said when bought | live |
| carrier reaches refuge | a civilian inside zone `refuge` | `evacuated` (toast `clear (n)`) | shipped notice | live |
| get_the_carriers_home complete | 3 evacuated by 300 s | complete; Shai's `say` | | live |
| get_the_carriers_home failed | `tick >= 300 s` and fewer than 3 evacuated | **failed → defeat** (`defeatCause: objective`); Idit's `say_on_fail` | | live |
| victory | `picture` and `get_the_carriers_home` complete | `missionEnd`; debrief victory (Idit) | §2.5 | live |
| time-out | 720 s with `picture` open | defeat (`withdrawn`, an internal id; the frame is `outcome.failed.timeUp`) | | live |
| drone down | `SimEvent destroyed` of `recon_drone` | radio line | Idit, sheet §2.7 | engine (G-E) |
| reed cell sprang | `SimEvent ambushSprung` (`eq_reed_cell`) | radio line | Shai, sheet §2.7 | engine (G-E) |

### 1.3 AI director

| t (s) | wave | size | `from` | `to` | group |
|---|---|---|---|---|---|
| 100 | riders | `moto_rpg` ×2 | `rif_ne` (45,5) | `causeway_n` | — |
| 150 | truck | `technical` ×1 | `rif_se` (45,40) | `causeway_s` | `south_road` |
| 200 | riders | `moto_rpg` ×2 | `rif_se` | `hamlet` | — |
| 250 | mixed | `moto_rpg` + `technical` | `rif_ne` | `causeway_n` | — |
| 300 | riders | `moto_rpg` ×2 | `rif_se` | `causeway_s` | `south_road` |

**Stances:**

| tag | unit | at | stance | group |
|---|---|---|---|---|
| `eq_reed_cell` | `militia_cell` | (21.5,35.5) `~` | `ambush`, tiles 3 | — |
| `eq_causeway_rpg` | `rpg_team` | (24.5,13.5) `~` | `ambush`, tiles 4 | — |
| `eq_crest_truck` | `gun_truck` | (39.5,9.5), level 2 | `hold_position` | `crest` |
| `eq_track_patrol` | `technical` | (39.5,14.5) | `patrol` (39.5,14.5)↔(39.5,32.5) | `track` |
| `eq_hamlet_cell` | `militia_cell` | (42.5,22.5) | `garrison`, building (42,20) | — |
| `eq_copse_watch` | `militia_cell` | (10.5,16.5) | `hold_position` | — |

Measured wheel routes: `rif_ne`→`causeway_n` 23 steps (16 on the north causeway); `rif_se`→`causeway_s` 23 steps (16 on the south).

**Pressure curve.** The first 100 s are the player's: the copse watch is the only contact on the brigade's own bank, so the
sniper and the drone can build the picture unhurried. From 100 s a pair of wheels comes onto a causeway every 50 s. Each
one is forced onto one of two predictable lines, so the pressure is legible rather than heavy. At 150 s the south road
gets its first truck, and the carriers' causeway stops being quiet. 200 s is the face of the deadline: riders bound for
the hamlet yard, said aloud by Idit. 300 s lands on the deadline itself. The casualty trigger (T-A1) is the release
valve the player earns: kill half the positions and the south-road wheels leave, along the one road they came by.

### 1.4 Map requirements — `ein_qasab` (shipped; additive markers and zones only, `rows` and `elevation` untouched)

| name | kind | purpose | tile | status |
|---|---|---|---|---|
| `kdf_start` | marker | `map.player_start` | (4,44) | PRESENT |
| `causeway_n` | marker | wave `to` (100 s, 250 s) | (22,12) | PRESENT |
| `causeway_s` | marker | wave `to`; **the carriers' placement** (G-P) | (22,34) | PRESENT |
| `hamlet` | marker | wave `to` (200 s); trigger `to` | (42,22) | PRESENT |
| `east_crest` | marker | not referenced; a plan anchor | (39,10) | PRESENT |
| `hamlet` | zone | `zone_entered`; `roe.flagged_zones` | [41,19,7,7] | PRESENT |
| `wounded_evac` | marker | the loaned medic's evacuation point (`medic_every_mission.test.ts`) | (2,46) | **NEW** |
| `civ_refuge` | marker | `civilians.refuge`, inside zone `refuge` (`start()` refuses one outside it) | (5,46) | **NEW** |
| `rif_ne` | marker | wave `from` | **(45,5)** (MDD said 47,5: D1) | **NEW** |
| `rif_se` | marker | wave `from`; T-A1 `to` | **(45,40)** (MDD said 47,40: D1) | **NEW** |
| `refuge` | zone | `evacuate_before` target | [0,44,10,4] | **NEW** |

Guards that must stay green after the additions:
- `tools/src/ein_qasab_marsh.test.ts` (it pins 27 structures and the rows; markers are additive);
- `high_ground_maps.test.ts` `RISES.ein_qasab = 1`;
- `packages/app/src/sandbox-anchors.pinned.json`. The hostile anchor is the marker nearest 28.8 tiles from `kdf_start`.
  `causeway_n` (error 7.96) still beats `rif_se` (41.2 tiles, error 12.4), so the pin should not move. Re-run to confirm.

### 1.5 Twists

| # | twist | class | what was measured or decided |
|---|---|---|---|
| **T-A1** | *They cannot run.* At 50% casualties the south-road wheels withdraw east, and the only road east is the causeway the carriers stand on | **expressible today**, adopted | D2. **Failure mode:** `casualties_pct` counts only the six start-of-mission enemies. If three of them die **before the 150 s wave spawns**, the trigger fires with `south_road` empty. It is then consumed, and its label and `say` play over nothing. **`playtest` must print the fire tick and the group size.** If the plan fires it before 150 s, raise `value` to 67 (4 of 6) |
| **T-A2** | *The carriers are the cover.* The reed cell holds fire until something of ours is within 3 tiles, and the carriers stand inside that ring | **expressible today**, adopted (after G-P) | Measured on the scratch mission (§5): a squad that stops at (18.5,34.5), 4.0 tiles from the near carrier and 3.2 from the cell, walks one carrier out **with no spring** by 140 s. A squad that goes on to (20.5,34.5) springs it at 20.9 s, 2.93 tiles away, and walks two out. The jeep driving to the carriers springs it at 7.0 s, 2.81 tiles away. That is a readable decision: shepherd from the edge of the ring (the shepherd radius is 4 tiles, `SHEPHERD_RADIUS_SQ`), or close in and take the shot |
| T-A3 | *The north causeway goes under* | engine (G6) | not adopted (controller) |

### 1.6 Gap report (this mission)

| gap | needed by | smallest proposal | owner | status |
|---|---|---|---|---|
| G-E: a trigger cannot fire on `SimEvent destroyed` / `ambushSprung` | the drone-down and reed-cell radio lines | two `on.kind`s, `sim` and `objective` (Act III G-E) | `sim-guard` | engine |
| G-T: the after-action report names EQ II for the reed-cell carry | the "Carries into" row | §4.4 | app | engine |

### 1.7 Copy-ready fragments — `ein_qasab_1_recon.json`

Field names were checked against `mission.schema.json` by `ajv` (§5). `name`, `briefing`, `dispatch`, `debrief`, every
`text`, every `say` and every `label` are the sheet's strings, **checked verbatim by script**. The briefing, dispatch and
debrief strings are not repeated here: paste them whole from `narrative.md` §2.2, §2.3 and §2.5. The assembled file is at
the scratch path in §5.

```json
"id": "ein_qasab_1_recon", "name": "Ein Qasab I — The Causeways", "town": "ein_qasab", "phase": "recon",
"target_minutes": 6, "time_limit_s": 720, "briefing_image": "ui/plates/units/sniper_team.jpg",
"map": {"file": "ein_qasab", "player_start": [4, 44]},
"ledger": {"requires": ["roster.surviving_units"], "produces": ["roster.surviving_units", "roe.mission_ratings", "campaign.completed_missions", "campaign.mission_results", "intel.marked_positions", "civ.settlements_evacuated"]},
"starting_force": [
  {"unit": "recon_drone", "count": 1, "at": [4, 42]},
  {"unit": "sniper_team", "count": 1, "at": [3, 43]},
  {"unit": "jeep_shoded", "count": 1, "at": [6, 43]},
  {"unit": "inf_squad", "count": 2, "at": [5, 45], "from_ledger": true},
  {"unit": "at_team", "count": 1, "at": [3, 45], "from_ledger": true},
  {"unit": "apc_eitan", "count": 1, "at": [7, 44], "from_ledger": true},
  {"unit": "inf_medic_squad", "count": 1, "at": [2, 44]}
],
"objectives": [
  {"id": "picture", "type": "locate", "primary": true, "count": 4, "text": "Identify four positions covering the causeways", "say": {"speaker": "idit", "text": "Four, and every one of them is tied to the two causeways one way or another. A Rif cell with nowhere to drive to is a position, for once."}},
  {"id": "get_the_carriers_home", "type": "evacuate_before", "primary": true, "target": "refuge", "count": 3, "seconds": 300, "text": "Get three carriers to the refuge before the next load moves", "say": {"speaker": "shai", "text": "Three at the refuge. Whatever goes onto that causeway next, it goes without them."}, "say_on_fail": {"speaker": "idit", "text": "The next load is moving and they are under it. We were the width of a marsh away."}},
  {"id": "find_the_reed_cell", "type": "locate", "primary": false, "carries": true, "target": "eq_reed_cell", "text": "Find the cell lying up in the reeds by the south causeway", "say": {"speaker": "idit", "text": "That is the reed cell, lying up in the reeds beside the carriers' causeway. It is on the board now, and wherever it lies up later this week it does not get the first shot."}}
],
"roe": {"enabled": true, "flagged_zones": ["hamlet"]},
"civilians": {
  "refuge": "civ_refuge",
  "groups": [
    {"unit": "civilians", "count": 2, "at": [44.5, 22.5]},
    {"unit": "civilians", "count": 2, "marker": "causeway_s"}
  ]
},
"enemy": {
  "faction": "rif", "doctrine_profile": "pinned to the causeways",
  "garrison": [
    {"unit": "militia_cell", "count": 1, "at": [21.5, 35.5], "facing_deg": 0, "tag": "eq_reed_cell", "stance": {"kind": "ambush", "tiles": 3}},
    {"unit": "rpg_team", "count": 1, "at": [24.5, 13.5], "facing_deg": 270, "tag": "eq_causeway_rpg", "stance": {"kind": "ambush", "tiles": 4}},
    {"unit": "gun_truck", "count": 1, "at": [39.5, 9.5], "facing_deg": 270, "group": "crest", "tag": "eq_crest_truck", "stance": {"kind": "hold_position"}},
    {"unit": "technical", "count": 1, "at": [39.5, 14.5], "facing_deg": 180, "group": "track", "tag": "eq_track_patrol", "stance": {"kind": "patrol", "waypoints": [[39.5, 14.5], [39.5, 32.5]]}},
    {"unit": "militia_cell", "count": 1, "at": [42.5, 22.5], "tag": "eq_hamlet_cell", "stance": {"kind": "garrison", "building": [42, 20]}},
    {"unit": "militia_cell", "count": 1, "at": [10.5, 16.5], "facing_deg": 90, "tag": "eq_copse_watch", "stance": {"kind": "hold_position"}}
  ],
  "waves": [
    {"at_seconds": 100, "to": "causeway_n", "units": [{"unit": "moto_rpg", "count": 2, "from": "rif_ne"}], "say": {"speaker": "idit", "text": "Two riders off the north-east, and both have come down onto the north causeway. There is nowhere else here for a wheel to go, and every rider after them will do the same."}},
    {"at_seconds": 150, "to": "causeway_s", "units": [{"unit": "technical", "count": 1, "from": "rif_se", "group": "south_road"}]},
    {"at_seconds": 200, "to": "hamlet", "units": [{"unit": "moto_rpg", "count": 2, "from": "rif_se"}], "say": {"speaker": "idit", "text": "Two more off the south-east, and they are going to the hamlet, not to you. They are coming to load the yard."}},
    {"at_seconds": 250, "to": "causeway_n", "units": [{"unit": "moto_rpg", "count": 1, "from": "rif_ne"}, {"unit": "technical", "count": 1, "from": "rif_ne"}]},
    {"at_seconds": 300, "to": "causeway_s", "units": [{"unit": "moto_rpg", "count": 2, "from": "rif_se", "group": "south_road"}]}
  ]
},
"triggers": [
  {"id": "the_track_patrol_turns_for_the_hamlet", "label": "Track patrol turns for the hamlet", "on": {"kind": "zone_entered", "zone": "hamlet"}, "do": {"kind": "commit", "group": "track", "to": "hamlet"}, "say": {"speaker": "idit", "text": "The east track patrol has turned for the hamlet. It is a technical on a track, so it comes the one way it can, and you can see which."}},
  {"id": "the_riders_pull_back_along_the_south_causeway", "label": "Riders pull back along the south causeway", "on": {"kind": "casualties_pct", "value": 50}, "do": {"kind": "withdraw_to", "group": "south_road", "to": "rif_se"}, "say": {"speaker": "idit", "text": "They are pulling out the only way wheels can here, back along the south causeway. Whatever is still standing on it is in their road."}}
],
```

---

## 2. `ein_qasab_2_foothold` — Ein Qasab II — Dead Ground

`foothold` · 7 min · `time_limit_s` 840 · map `jebel_matar` (new) · requires **R I** · produces **R M C X I** · field works:
one outpost.

### 2.1 Flags

| flag | kind | means |
|---|---|---|
| `hold_the_hollow` | objective (primary, `hold_for` `hollow` 300 s, accumulating) | the farm is the brigade's. **The barn cell inside the barn (26,21) stands inside `hollow`, so the zone reads contested and the clock does not run until that cell is dead or the barn is down.** The hold and the raze are coupled by placement, deliberately |
| `burn_the_barn` | objective (primary, `raze` `barn_yard` 300 s, failable) | Hallaq's crates are ash. The target set is the warehouse only (`barn_yard` [26,21,2,2]). `razeExempt` bills nothing for it |
| `mark_the_saddle_truck` | objective (secondary, `carries: true`) | `eq_saddle_truck` is on the board. It is the **third star**, and in EQ III the truck spawns identified |
| `the_saddle_truck_comes_down_to_the_farm` fired | trigger | the brigade stood in the hollow |
| `riders_come_through_the_dyke_gap` fired | trigger | 90 s have passed (D3) |
| outpost raised | runtime (`structureComplete`) | not addressable from a mission; Shai's line is `engine` |

**Note on the carry's price.** The saddle truck commits to the farm on the player's first step into the hollow, so it
comes to the player and is usually identified there. The carry is therefore cheap in II and pays in III. This is the
MDD's own combination of trigger and secondary, kept as designed. `playtest` reports how often the plan completes it.

### 2.2 ECA rows

| Event Name | IF | THEN | cue (sheet §3.7) | status |
|---|---|---|---|---|
| mission_start | tick 0 | spawns; title and briefing; **no dispatch** | §3.3 | live |
| wave_60 | `at_seconds: 60` | `moto_rpg` ×2 `rif_n` → `farm` | none | live |
| riders_come_through_the_dyke_gap | `on: { kind: timer_s, value: 90 }` | `do: { kind: commit, group: gap, to: farm }` | label `Riders come through the dyke gap`; Idit's `say` | live |
| wave_105 | `at_seconds: 105` | `militia_cell` ×2 `rif_nw` (on foot, over the crest) → `farm` | Idit: "Two cells walking over the north crest…" | live |
| wave_150 | `at_seconds: 150` | `technical` + `moto_rpg` `rif_e` → `farm`, through the dyke gap | none | live |
| wave_195 | `at_seconds: 195` | `militia_cell` + `rpg_team` `rif_nw` → `farm` | none | live |
| wave_215 (T-B1) | `at_seconds: 215` | `drone_swarm` ×1 `rif_n`, `group: crates`, `tag: eq_crates_swarm` → `farm` | Idit: "A swarm off the north downs. Not every crate on this road was in that barn." | live |
| wave_240 | `at_seconds: 240` | `technical` ×2 `rif_n` → `farm` | none | live |
| wave_285 | `at_seconds: 285` | `moto_rpg` ×2 `rif_e` → `farm` | none | live |
| the_saddle_truck_comes_down_to_the_farm | `on: { kind: zone_entered, zone: hollow }` | `do: { kind: commit, group: saddle, to: farm }` | label `Saddle truck comes down to the farm`; Idit's `say` | live |
| hold_the_hollow complete | 300 s held uncontested (accumulated) | complete; net `say` | | live |
| burn_the_barn complete | the warehouse in `barn_yard` destroyed | complete; Idit's `say` (Hallaq's presence as an object) | | live |
| burn_the_barn failed | 300 s with the barn standing | **failed → defeat**; Shai's `say_on_fail` | | live |
| mark_the_saddle_truck complete | `eq_saddle_truck` identified | complete; the tag carries | Idit's `say` | live |
| Conduct breach | Conduct < 40 | defeat (`roe`) | | live |
| outpost complete | `structureComplete` | radio line | Shai, sheet §3.7 | engine (G-E) |
| pocket RPG sprang | `ambushSprung` `eq_pocket_rpg` | radio line | Idit | engine (G-E) |

### 2.3 AI director

| t (s) | wave | size | `from` | `to` | group |
|---|---|---|---|---|---|
| 60 | riders | `moto_rpg` ×2 | `rif_n` (34,0) | `farm` | — |
| 90 | *(trigger)* gap rider commits | `moto_rpg` ×1 (garrison) | patrol | `farm` | `gap` |
| 105 | foot | `militia_cell` ×2 | `rif_nw` (20,0) | `farm` | — |
| 150 | mixed | `technical` + `moto_rpg` | `rif_e` (45,35) | `farm` | — |
| 195 | foot | `militia_cell` + `rpg_team` | `rif_nw` | `farm` | — |
| 215 | **swarm (T-B1)** | `drone_swarm` ×1 | `rif_n` | `farm` | `crates` |
| 240 | trucks | `technical` ×2 | `rif_n` | `farm` | — |
| 285 | riders | `moto_rpg` ×2 | `rif_e` | `farm` | — |

**Stances:**

| tag | unit | at | stance | group |
|---|---|---|---|---|
| `eq_barn_cell` | `militia_cell` | (25.5,21.5) | `garrison`, building (26,21) | — |
| `eq_pocket_rpg` | `rpg_team` | (12.5,22.5) `~` | `ambush`, tiles 4 | — |
| `eq_saddle_truck` | `technical` | (34.5,11.5), the saddle, level 2 | `hold_position` | `saddle` |
| `eq_gap_rider` | `moto_rpg` | (30.5,27.5) | `patrol` (30.5,27.5)↔(37.5,35.5), 8 steps by wheel through the gap | `gap` |

Measured on the sketch's grid: `rif_e`→`farm` 21 by wheel (through the gap); `rif_n` 25; `rif_nw` 33 by wheel and 25 on
foot. That is the boulder band's +8, as the MDD measured.

**Pressure curve.** The waves alternate doors every 45 s: the north (wheels through the saddle, feet over the crest) and
the east (wheels through the one gap). That is the mission's decision made audible: the hollow sees neither door until the
raider is on the skyline. The 90 s gap trigger teaches the east door early, before the first real east raid at 150 s.
195–240 s is the peak, and it sits inside the barn's last 100 s: foot over the crest, the swarm off the north downs, then
two trucks. The 285 s riders arrive as the barn deadline closes. A player still burning it then is doing it under fire.

### 2.4 Map requirements — `jebel_matar` (new; grid and elevation are MDD §3.2)

| name | kind | purpose | tile / rect | status |
|---|---|---|---|---|
| `kdf_start` | marker | `map.player_start` | (24,45) | NEW (MDD) |
| `wounded_evac` | marker | medic evacuation point | (20,45) | NEW (MDD) |
| `civ_refuge` | marker | `civilians.refuge` (D7) | (16,44) | **NEW (this script)** |
| `farm` | marker | every wave and trigger `to` | (24,25) | NEW (MDD) |
| `rif_n` | marker | wave `from` | (34,0) | NEW (MDD) |
| `rif_nw` | marker | wave `from` | (20,0) | NEW (MDD) |
| `rif_e` | marker | wave `from` | **(45,35)** (MDD said 47,35: D1) | NEW |
| `north_summit`, `shoulder`, `north_saddle`, `south_saddle`, `dyke_gap` | markers | not referenced by the mission. Plan anchors and doctrine-test points | (8,8), (22,13), (34,11), (24,32), (37,35) | NEW (MDD), optional |
| `hollow` | zone | `hold_for`; `zone_entered` | [17,18,15,10] | NEW (MDD) |
| `barn_yard` | zone | `raze`: the warehouse only, never the yard walls | [26,21,2,2] | NEW (MDD) |
| `farmhouse` | zone | `roe.flagged_zones` | [20,20,5,4] | NEW (MDD) |
| `north_saddle`, `north_crest` | zones | not referenced; the doctrine LOS test | [31,9,7,5], [4,9,40,4] | NEW (MDD), optional |

**Field-works sites, measured:**
- the hollow at (18,24) is accepted;
- the crest at (28,9) is accepted. On the sketch, a flat, open level-4 2×2 has its origin at x 0–16, 28–29 or 38–46, on rows 9–11;
- **the shoulder at (22,12) is refused `not_level`**, because rows 12 and 13 stand at 5 and 4.

The briefing's "put it on the crest" is buildable. "The high shoulder" is not.

### 2.5 Twists

| # | twist | class | measurement |
|---|---|---|---|
| **T-B1** | *The crates fly.* One `drone_swarm` off the north downs at 215 s | **expressible today** (a wave), **adopted at one swarm, gated on `playtest`** | `pnpm --filter @lions/tools e6:swarm-probe`, 20 seeds, run this session at `hit_mult` 0.08 (shipped). One swarm diving on a **halted 2 `inf_squad` + `apc_eitan`** with ordinary fire: the swarm dies in **20/20**, before spending half its members in 20/20, after a mean 3.5 dives; group hp lost 77 (of three units); **units lost 0.00**. The same group with weapons cold loses 0.25 units and 284 hp to 12 dives. EQ II's force is a superset of that group (plus a Namer, an AT team, a mortar, engineers, and a medic). **The case the probe does not cover is a lone detached team**: the AT team holding the gap, the mortar, or the engineers at the barn, caught alone by the sweep. The N11 column says one rifle squad alone takes 67 s to kill a stationary swarm. **So:** adopt, and `playtest` runs the ladder with and without the 215 s wave. If the plan's win rate drops out of band, drop the wave (T-B1 *hold*) |
| T-B2 | *The family is the cell's cover* | schema field (a stance condition on civilians) | not adopted |
| T-B3 | *The saddle truck was a decoy* | expressible today | not adopted (it would put a second trigger on `saddle`) |

**Field works (G8), measured.** `rt.requestConstruct('kdf_outpost', 18, 24)` at t = 1 s, with the escort attack-moved to
(21,26): **staked at 24.1 s, complete at 55.5 s**, and the engineers alive at 199 s. The same call at the crest (28,9),
escorted to (28,12): accepted, but the engineers died before staking (one seed). **The planner can build the outpost; the
fragment keeps `field_works`.** That the crest kills the builder is the decision working as designed: the crest sees, and
it costs.

### 2.6 Gap report (this mission)

| gap | smallest proposal | owner | status |
|---|---|---|---|
| G-FC: `first_contact` fires on a wall shot at tick 0, so `first_contact` was avoided (D3) | §4.1 G-FC, §4.2 | `sim-guard` | engine |
| G-E: outpost and ambush radio lines | Act III G-E | `sim-guard` | engine |
| The sheet's T-B1 label has no field on a wave | none. The wave's `say` carries the line, and the toast is the shipped `alert.wave` | — | — |

### 2.7 Copy-ready fragments — `ein_qasab_2_foothold.json`

Briefing and debrief: paste from `narrative.md` §3.3 and §3.5. There is no `dispatch` (sheet §3.2).

```json
"id": "ein_qasab_2_foothold", "name": "Ein Qasab II — Dead Ground", "town": "ein_qasab", "phase": "foothold",
"target_minutes": 7, "time_limit_s": 840, "briefing_image": "ui/plates/units/demo_squad.jpg",
"map": {"file": "jebel_matar", "player_start": [24, 45]},
"ledger": {"requires": ["roster.surviving_units", "intel.marked_positions"], "produces": ["roster.surviving_units", "roe.mission_ratings", "campaign.completed_missions", "campaign.mission_results", "intel.marked_positions"]},
"starting_force": [
  {"unit": "apc_eitan", "count": 1, "at": [23, 44], "from_ledger": true},
  {"unit": "ifv_namer", "count": 1, "at": [25, 46], "from_ledger": true},
  {"unit": "inf_squad", "count": 2, "at": [22, 45], "from_ledger": true},
  {"unit": "at_team", "count": 1, "at": [26, 44], "from_ledger": true},
  {"unit": "mortar_team", "count": 1, "at": [21, 46]},
  {"unit": "demo_squad", "count": 1, "at": [22, 46]},
  {"unit": "inf_medic_squad", "count": 1, "at": [20, 44]}
],
"field_works": {"kdf_outpost": 1},
"resources": {"logistics_start": 400},
"objectives": [
  {"id": "hold_the_hollow", "type": "hold_for", "primary": true, "target": "hollow", "seconds": 300, "text": "Hold the farm hollow for five minutes", "say": {"speaker": "net", "text": "Five minutes in the hollow, uncontested. The farm is the brigade's for the rest of the week."}},
  {"id": "burn_the_barn", "type": "raze", "primary": true, "target": "barn_yard", "seconds": 300, "text": "Burn the barn and the crates inside five minutes", "say": {"speaker": "idit", "text": "Crates, fuel and launch rails, under the hay. The swarms over the cattle track came out of barns like this one, and this one was waiting for the rain to stop."}, "say_on_fail": {"speaker": "shai", "text": "Five minutes, and the barn is standing with the crates in it. When the rain stops, they fly."}},
  {"id": "mark_the_saddle_truck", "type": "locate", "primary": false, "carries": true, "target": "eq_saddle_truck", "text": "Identify the truck in the north saddle", "say": {"speaker": "idit", "text": "That is the saddle crew. Wherever it is parked when we reach the causeway head, it is on the board now."}}
],
"roe": {"enabled": true, "flagged_zones": ["farmhouse"], "fail_below": 40},
"civilians": {
  "refuge": "civ_refuge",
  "groups": [
    {"unit": "civilians", "count": 1, "at": [23.5, 21.5]},
    {"unit": "civilians", "count": 1, "at": [24.5, 22.5]}
  ]
},
"enemy": {
  "faction": "rif", "doctrine_profile": "raids from two doors",
  "garrison": [
    {"unit": "militia_cell", "count": 1, "at": [25.5, 21.5], "tag": "eq_barn_cell", "stance": {"kind": "garrison", "building": [26, 21]}},
    {"unit": "rpg_team", "count": 1, "at": [12.5, 22.5], "facing_deg": 90, "tag": "eq_pocket_rpg", "stance": {"kind": "ambush", "tiles": 4}},
    {"unit": "technical", "count": 1, "at": [34.5, 11.5], "facing_deg": 180, "group": "saddle", "tag": "eq_saddle_truck", "stance": {"kind": "hold_position"}},
    {"unit": "moto_rpg", "count": 1, "at": [30.5, 27.5], "facing_deg": 135, "group": "gap", "tag": "eq_gap_rider", "stance": {"kind": "patrol", "waypoints": [[30.5, 27.5], [37.5, 35.5]]}}
  ],
  "waves": [
    {"at_seconds": 60, "to": "farm", "units": [{"unit": "moto_rpg", "count": 2, "from": "rif_n"}]},
    {"at_seconds": 105, "to": "farm", "units": [{"unit": "militia_cell", "count": 2, "from": "rif_nw"}], "say": {"speaker": "idit", "text": "Two cells walking over the north crest on foot. From the farm they are not there until they are on the skyline."}},
    {"at_seconds": 150, "to": "farm", "units": [{"unit": "technical", "count": 1, "from": "rif_e"}, {"unit": "moto_rpg", "count": 1, "from": "rif_e"}]},
    {"at_seconds": 195, "to": "farm", "units": [{"unit": "militia_cell", "count": 1, "from": "rif_nw"}, {"unit": "rpg_team", "count": 1, "from": "rif_nw"}]},
    {"at_seconds": 215, "to": "farm", "units": [{"unit": "drone_swarm", "count": 1, "from": "rif_n", "group": "crates", "tag": "eq_crates_swarm"}], "say": {"speaker": "idit", "text": "A swarm off the north downs. Not every crate on this road was in that barn."}},
    {"at_seconds": 240, "to": "farm", "units": [{"unit": "technical", "count": 2, "from": "rif_n"}]},
    {"at_seconds": 285, "to": "farm", "units": [{"unit": "moto_rpg", "count": 2, "from": "rif_e"}]}
  ]
},
"triggers": [
  {"id": "the_saddle_truck_comes_down_to_the_farm", "label": "Saddle truck comes down to the farm", "on": {"kind": "zone_entered", "zone": "hollow"}, "do": {"kind": "commit", "group": "saddle", "to": "farm"}, "say": {"speaker": "idit", "text": "The truck in the saddle has started down the north track for the farm. If it is going to be identified on this ground, it is now."}},
  {"id": "riders_come_through_the_dyke_gap", "label": "Riders come through the dyke gap", "on": {"kind": "timer_s", "value": 90}, "do": {"kind": "commit", "group": "gap", "to": "farm"}, "say": {"speaker": "idit", "text": "Riders through the dyke gap, one at a time, because that is all it is wide. It is the only door on that side."}}
],
```

---

## 3. `ein_qasab_3_buildup` — Ein Qasab III — One Road

`buildup` · 7 min · `time_limit_s` 840 · map `ein_qasab_3` (new) · requires **R I** · produces **R M C X** · camp,
production, supply corridor, one income zone, `intel_start` 100.

### 3.1 Flags

| flag | kind | means |
|---|---|---|
| `kill_hallaqs_man` | objective (primary, `eliminate_hvt` `eq_hvt_winter_road`) | Hallaq's man is dead (*"kill or capture"* is a kill until GH-18). **It can fail** if the target is `remove`d (`mission.ts` 4044–4058, GH-815), but nothing here removes him, so in this script it cannot |
| `hold_the_head` | objective (primary, `hold_for` `causeway_head` 240 s) | the road is ours to the terrace. **The stock guard (garrisoned in the barn) and the HVT's truck stand inside the zone**, so the clock runs only once both are out. The HVT leaves by dying or by running (T-C2 note, §3.5) |
| `burn_the_stock` | objective (primary, `raze` `stock_yard` 330 s, failable) | the winter's freight is ash. **The failure is the mission's loss** |
| `take_the_mill` | objective (secondary, `capture` `mill_islet` 15 s) | the islet is ours. The income zone pays 80 a minute to whoever holds it |
| `the_reserve_comes_over_the_lip` fired | trigger | the brigade stood at the causeway head |
| `hallaqs_man_runs_for_the_north_road` fired | trigger | 40% of the start-of-mission enemy is dead: 4 of 8 bodies, the truck and its passenger included |
| `eq_reed_cell`, `eq_causeway_rpg`, `eq_saddle_truck` in the ledger | carried tags | each spawns identified, and the two ambushers spawn **without** their ambush (`spawnPlacement` 3328–3366) |

### 3.2 ECA rows

| Event Name | IF | THEN | cue (sheet §4.7) | status |
|---|---|---|---|---|
| mission_start | tick 0 | the camp structure is raised first, then the spawns. **Marked tags spawn identified, the ambushers in `hold_position`** | sheet §4.2 beat 5 states the rule | live |
| wave_45 | `at_seconds: 45` | `technical` `rif_nw` → `causeway_head` | none | live |
| wave_100 | `at_seconds: 100` | `militia_cell` ×2 `reed_e` → `south_landing`, wading (21 steps) | Idit: "Two cells wading out of the east reeds…" | live |
| wave_150 | `at_seconds: 150` | `moto_rpg` ×2 `rif_n` → `causeway_head` | none | live |
| wave_200 | `at_seconds: 200` | `rpg_team` + `militia_cell` `reed_w` → `camp_door`, wading (17 steps). **Production pauses** while a ground enemy contests the exit (`production.ts`) | Idit: "A cell and an RPG team out of the west reeds…" | live |
| wave_250 | `at_seconds: 250` | `technical` + `moto_rpg` `rif_nw` → `causeway_head` | none | live |
| wave_300 (T-C3) | `at_seconds: 300` | `militia_cell` ×2 `reed_e` → `mill` | Idit: "Two cells wading for the mill. If the families are still inside it…" | live |
| the_reserve_comes_over_the_lip | `on: { kind: zone_entered, zone: causeway_head }` | `do: { kind: commit, group: reserve, to: causeway_head }` | label `Reserve comes down over the lip`; Idit's `say` | live |
| hallaqs_man_runs_for_the_north_road | `on: { kind: casualties_pct, value: 40 }` | `do: { kind: withdraw_to, group: ferry, to: north_exit }`: 14 steps by wheel, **4 of them inside the flagged `hamlet` zone** (measured) | label `Hallaq's man runs for the north road`; Shai's `say` | live |
| burn_the_stock complete / failed @330 s | warehouse in `stock_yard` destroyed / not | complete with Idit's `say` (the hook to WH IV and V) / **failed → defeat** with Shai's `say_on_fail` | | live |
| kill_hallaqs_man complete | every `eq_hvt_winter_road` body dead (not removed) | complete; Idit's `say` | | live |
| hold_the_head complete | 240 s held uncontested | complete; net `say` | | live |
| take_the_mill complete | 15 s uncontested in `mill_islet` | complete; **Idit's T-C3 line**, which replaces the net's | | live |
| income / supply / production alerts | runtime | shipped `alert.*` toasts | | live |
| lead vehicle hit by an unmarked RPG | `SimEvent destroyed` | radio line | Idit, sheet §4.7 | engine (G-E) |

### 3.3 AI director

| t (s) | wave | size | `from` | `to` | group |
|---|---|---|---|---|---|
| 45 | truck | `technical` | `rif_nw` (10,0) | `causeway_head` | — |
| 100 | waders | `militia_cell` ×2 | `reed_e` (45,23) | `south_landing` | — |
| 150 | riders | `moto_rpg` ×2 | `rif_n` (30,0) | `causeway_head` | — |
| 200 | door raid | `rpg_team` + `militia_cell` | `reed_w` (0,24) | `camp_door` | — |
| 250 | mixed | `technical` + `moto_rpg` | `rif_nw` | `causeway_head` | — |
| 300 | waders (T-C3) | `militia_cell` ×2 | `reed_e` | `mill` | — |

**Stances:**

| tag / group | unit | at | stance |
|---|---|---|---|
| group `ferry`; passenger tag `eq_hvt_winter_road` | `technical` carrying a `militia_cell` | (25.5,14.5), the head yard | `hold_position` |
| `eq_stock_guard` | `militia_cell` | (22.5,14.5) | `garrison`, building (20,13) |
| `eq_causeway_rpg` | `rpg_team` | (23.5,16.5), the causeway mouth | `ambush`, tiles 4 (**`hold_position` if marked**) |
| `eq_reed_cell` | `militia_cell` | (26.5,18.5) `~`, the north channel | `ambush`, tiles 3 (**`hold_position` if marked**) |
| `eq_saddle_truck` | `gun_truck` | (30.5,12.5), lower terrace, level 2 | `hold_position` (identified if marked) |
| group `reserve` | `militia_cell` + `rpg_team` | (36.5,3.5), (38.5,3.5), behind the lip | `hold_position` |

Measured routes on the sketch:
- by wheel: `camp_door`→`causeway_head` 33; `supply_entry`→`camp_door` 10; `camp_door`→mill islet 22;
  `rif_nw`→`causeway_head` 15; `rif_n`→`causeway_head` 22;
- `camp_door`→the west island: **no route by wheel**, 16 on foot;
- on foot: `kdf_start`→`north_exit` 44; `reed_e`→`south_landing` 21; `reed_w`→`camp_door` 17.

**Pressure curve.** Two fronts on one clock. North of the fen, wheels feed the causeway head every 50–100 s, down the only
road, through the protected hamlet. South of it, the reeds go for the brigade's rear: the south landing at 100 s, the
camp's door at 200 s (production stops), the mill at 300 s. The stock deadline (330 s) sits after the last wave, so the
peak (200–300 s) is the player's choice between guarding the door and pushing the column north. The lieutenant's run
(T-C2's ground) comes whenever the player has killed four of the eight. On a fast push that is early, which is what makes
sending the AT team across the west island before the shooting starts the sharp play.

### 3.4 Map requirements — `ein_qasab_3` (new; grid and elevation are MDD §3.3)

| name | kind | purpose | tile / rect | status |
|---|---|---|---|---|
| `kdf_start` | marker | `map.player_start` | (8,44) | NEW (MDD) |
| `wounded_evac` | marker | medic evacuation point | (4,41) | NEW (MDD) |
| `camp_door` | marker | 200 s wave `to` (D8) | (10,41) | **NEW (this script)** |
| `civ_refuge` | marker | `civilians.refuge` (D7) | (3,1) | **NEW (this script)** |
| `supply_entry` | marker | `resources.supply_entry` | (0,40) | NEW (MDD) |
| `causeway_head` | marker | wave and trigger `to` | (24,13) | NEW (MDD) |
| `south_landing` | marker | wave `to` | (24,36) | NEW (MDD) |
| `mill` | marker | wave `to` (T-C3) | (23,25) | NEW (MDD) |
| `north_exit` | marker | `withdraw_to` | (18,0) | NEW (MDD) |
| `rif_n`, `rif_nw` | markers | wave `from` | (30,0), (10,0) | NEW (MDD) |
| `reed_w` | marker | wave `from` | (0,24) | NEW (MDD) |
| `reed_e` | marker | wave `from` | **(45,23)** (MDD said 47,23: D1) | NEW |
| `causeway_foot`, `stock`, `hamlet`, `lip_w` | markers | not referenced; plan anchors (`lip_w` is the stop's walk) | (24,34), (22,13), (31,12), (14,6) | NEW (MDD), optional |
| `causeway_head` | zone | `hold_for`; `zone_entered` | [19,11,10,6] | NEW (MDD) |
| `stock_yard` | zone | `raze`: the warehouse only | [20,13,2,2] | NEW (MDD) |
| `hamlet` | zone | `roe.flagged_zones` | [8,8,30,4] | NEW (MDD) |
| `mill_islet` | zone | `capture`; income zone | [19,20,11,9] | NEW (MDD) |
| `south_landing`, `lip` | zones | not referenced; doctrine and LOS tests | [20,32,9,6], [4,4,38,4] | NEW (MDD), optional |

`camp` is a mission `structures[]` entry at (8,40) 2×2, never a map tile (WH III precedent). The supply road's gap at
x 8–9 is where it stands.

### 3.5 Twists

| # | twist | class | decision and failure mode |
|---|---|---|---|
| **T-C3** | *The mill is full of people.* Two civilians at (19.5,24.5) on the islet, the income zone; Idit's lines on `take_the_mill` and on the 300 s wave | **expressible today**, adopted | It turns the one purchase of ground into a Conduct decision: any civilian casualty is billed 8, wherever it happens, and danger-close ordnance is billed too. **Measure in `playtest`**: Conduct at the win, against the floor of 40 |
| **T-C2** | *He gets off the map* | **engine, but smaller than the MDD says** (§4.1 G5). Not built (controller) | **What happens today, either way the stop goes:** at 4 of 8 dead he drives 14 steps to `north_exit` (18,0), on the reverse slope **north of the flagged zone**, and parks: a `move` order with no stance behind it. **He can still be killed there**, so "stop him beyond the houses" stays literally true. **Failure mode:** nothing ever removes him. A player who never goes after him leaves `kill_hallaqs_man` open until 840 s and loses on the clock (`outcome.failed.timeUp`), never to an escape. The urgency is real; the escape is not. The briefing (sheet §4.2) promises no escape, and must not |
| T-C4 | *The crates fly again* | expressible today | **held** (controller): at most one swarm in the town, and T-B1 tells it first |
| T-C1 | *The wreck closes the road* | engine (G6) | not adopted |

### 3.6 Gap report (this mission)

| gap | smallest proposal | owner | status |
|---|---|---|---|
| G5 (T-C2) | §4.1 G5: one `on.kind`. The action and the objective failure already ship | `sim-guard` | engine |
| G4: capture is a kill | none until GH-18 | `sim-guard` | — |
| G7: decor triangle budget on 370 marsh tiles | `decorPlacements` against 0.9 M; narrow the channels if over | `render-vfx`, `mission-author` | — |

### 3.7 Copy-ready fragments — `ein_qasab_3_buildup.json`

Briefing and debrief: paste from `narrative.md` §4.2 and §4.5. There is no `dispatch` and no `aftermath` (sheet §4.5).

```json
"id": "ein_qasab_3_buildup", "name": "Ein Qasab III — One Road", "town": "ein_qasab", "phase": "buildup",
"target_minutes": 7, "time_limit_s": 840, "briefing_image": "ui/plates/units/at_team.jpg",
"map": {"file": "ein_qasab_3", "player_start": [8, 44]},
"ledger": {"requires": ["roster.surviving_units", "intel.marked_positions"], "produces": ["roster.surviving_units", "roe.mission_ratings", "campaign.completed_missions", "campaign.mission_results"]},
"starting_force": [
  {"unit": "apc_eitan", "count": 1, "at": [11, 43], "from_ledger": true},
  {"unit": "ifv_namer", "count": 1, "at": [13, 43], "from_ledger": true},
  {"unit": "inf_squad", "count": 2, "at": [9, 44], "from_ledger": true},
  {"unit": "at_team", "count": 1, "at": [7, 45], "from_ledger": true},
  {"unit": "jeep_shoded", "count": 1, "at": [12, 45]},
  {"unit": "demo_squad", "count": 1, "at": [10, 45]},
  {"unit": "inf_medic_squad", "count": 1, "at": [6, 44]}
],
"resources": {"logistics_start": 400, "logistics_rate_per_min": 150, "intel_start": 100, "supply_corridor": true, "supply_entry": "supply_entry", "income_zones": [{"zone": "mill_islet", "rate_per_min": 80}]},
"structures": [
  {"type": "camp", "at": [8, 40], "size": [2, 2]}
],
"objectives": [
  {"id": "kill_hallaqs_man", "type": "eliminate_hvt", "primary": true, "target": "eq_hvt_winter_road", "text": "Kill or capture Hallaq's man on the winter road", "say": {"speaker": "idit", "text": "That is Hallaq's man on the winter road. He knew which causeway would carry a truck on which night, and nobody else on that bank does."}},
  {"id": "hold_the_head", "type": "hold_for", "primary": true, "target": "causeway_head", "seconds": 240, "text": "Hold the causeway head for four minutes", "say": {"speaker": "net", "text": "Causeway head held, four minutes. The road is ours as far as the terrace."}},
  {"id": "burn_the_stock", "type": "raze", "primary": true, "target": "stock_yard", "seconds": 330, "text": "Burn the stock barn inside five and a half minutes", "say": {"speaker": "idit", "text": "The stock is burning and the manifests are not. Every load in that barn was addressed to one yard, east of the village at Wadi Halam, and that is where this winter's freight was going."}, "say_on_fail": {"speaker": "shai", "text": "Five and a half minutes, and the stock is standing. When the fords open, it goes east full."}},
  {"id": "take_the_mill", "type": "capture", "primary": false, "target": "mill_islet", "seconds": 15, "text": "Take the mill islet and hold it for 15 seconds", "say": {"speaker": "idit", "text": "There are families in the mill. The hamlet sent them down to the one building on the fen with a floor above the water, and every vehicle you own stops beside it."}}
],
"roe": {"enabled": true, "flagged_zones": ["hamlet"], "fail_below": 40, "structure_penalty_mult": 1},
"civilians": {
  "refuge": "civ_refuge",
  "groups": [
    {"unit": "civilians", "count": 2, "at": [25.5, 9.5]},
    {"unit": "civilians", "count": 1, "at": [33.5, 10.5]},
    {"unit": "civilians", "count": 2, "at": [19.5, 24.5]}
  ]
},
"enemy": {
  "faction": "rif", "doctrine_profile": "one road, held from the terrace",
  "garrison": [
    {"unit": "technical", "count": 1, "at": [25.5, 14.5], "facing_deg": 180, "group": "ferry", "stance": {"kind": "hold_position"}, "passengers": [{"unit": "militia_cell", "count": 1, "tag": "eq_hvt_winter_road"}]},
    {"unit": "militia_cell", "count": 1, "at": [22.5, 14.5], "tag": "eq_stock_guard", "stance": {"kind": "garrison", "building": [20, 13]}},
    {"unit": "rpg_team", "count": 1, "at": [23.5, 16.5], "facing_deg": 180, "tag": "eq_causeway_rpg", "stance": {"kind": "ambush", "tiles": 4}},
    {"unit": "militia_cell", "count": 1, "at": [26.5, 18.5], "facing_deg": 180, "tag": "eq_reed_cell", "stance": {"kind": "ambush", "tiles": 3}},
    {"unit": "gun_truck", "count": 1, "at": [30.5, 12.5], "facing_deg": 225, "tag": "eq_saddle_truck", "stance": {"kind": "hold_position"}},
    {"unit": "militia_cell", "count": 1, "at": [36.5, 3.5], "facing_deg": 180, "group": "reserve", "stance": {"kind": "hold_position"}},
    {"unit": "rpg_team", "count": 1, "at": [38.5, 3.5], "facing_deg": 180, "group": "reserve", "stance": {"kind": "hold_position"}}
  ],
  "waves": [
    {"at_seconds": 45, "to": "causeway_head", "units": [{"unit": "technical", "count": 1, "from": "rif_nw"}]},
    {"at_seconds": 100, "to": "south_landing", "units": [{"unit": "militia_cell", "count": 2, "from": "reed_e"}], "say": {"speaker": "idit", "text": "Two cells wading out of the east reeds for the south landing. They are not after the head; they are after your road."}},
    {"at_seconds": 150, "to": "causeway_head", "units": [{"unit": "moto_rpg", "count": 2, "from": "rif_n"}]},
    {"at_seconds": 200, "to": "camp_door", "units": [{"unit": "rpg_team", "count": 1, "from": "reed_w"}, {"unit": "militia_cell", "count": 1, "from": "reed_w"}], "say": {"speaker": "idit", "text": "A cell and an RPG team out of the west reeds, walking to the camp's door. While anything of theirs stands at it, the camp builds nothing."}},
    {"at_seconds": 250, "to": "causeway_head", "units": [{"unit": "technical", "count": 1, "from": "rif_nw"}, {"unit": "moto_rpg", "count": 1, "from": "rif_nw"}]},
    {"at_seconds": 300, "to": "mill", "units": [{"unit": "militia_cell", "count": 2, "from": "reed_e"}], "say": {"speaker": "idit", "text": "Two cells wading for the mill. If the families are still inside it, that is where this fight is now."}}
  ]
},
"triggers": [
  {"id": "the_reserve_comes_over_the_lip", "label": "Reserve comes down over the lip", "on": {"kind": "zone_entered", "zone": "causeway_head"}, "do": {"kind": "commit", "group": "reserve", "to": "causeway_head"}, "say": {"speaker": "idit", "text": "There was a reserve behind the lip, in ground nothing south of the houses can see. It is coming down to the head."}},
  {"id": "hallaqs_man_runs_for_the_north_road", "label": "Hallaq's man runs for the north road", "on": {"kind": "casualties_pct", "value": 40}, "do": {"kind": "withdraw_to", "group": "ferry", "to": "north_exit"}, "say": {"speaker": "shai", "text": "He is running for the north road, and it goes up through the hamlet. Stop him beyond the houses if you can get there; in them, every shot is billed."}}
],
```

---

## 4. Town-level gap report

### 4.1 Capability-gap table

Sizes are lines of code plus lines of tests, measured against the files named.

| # | gap | needed by | smallest proposal | size | owner | status |
|---|---|---|---|---|---|---|
| **G1** | No town-level unlock | the town opening after WH III; **also the board**, because `ein_qasab` is listed first | §4.3 spec | ~90 code + ~150 test | app (`campaign.ts`, boards), `content-validator` (validator) | engine (app) |
| **G2** | `town` enum, `world.json` town | every mission | `"ein_qasab"` in `mission.schema.json` `town` (one line, between `umm_zeitoun` and `wadi_halam` or appended); a `world.json` town listed **first** in Naharin: `{ "id": "ein_qasab", "name": "Ein Qasab", "at": [804.0, 461.7], "unlock": { "after_mission": "wadi_halam_3_counterraid" }, "missions": [the three ids] }`. (804.0, 461.7) is inside the Naharin outline (point-in-polygon on `countries.json`) and sits "downstream", south of Wadi Halam's (804.0, 401.7). `validate_data.mjs` checks containment | 2 + 9 lines | `mission-author` | schema |
| G3 | rank by position | Lt Col on the HUD | list `ein_qasab` first (G2). **Without G1, listing it first breaks the board** (§4.3, the first bullet) | 0 | `mission-author` | live after G1 |
| **G-Q** | Naharin's villain card falls back to the region's last mission | robustness | `"ends_at": "wadi_halam_5_depot"` in `data/campaign/commander.json` `villains.naharin` (the schema already has the field; Marj uses it) | 1 data + ~12 test | `mission-author` | live |
| **G-T** | after-action "Carries into {next}" names the town's next mission, not the one that reads the tag. **Pre-existing**: also wrong today for BS I `hvt_seen` (read by BS III), BS I `find_the_column` (BS IV) and QH I `find_the_ditch_gun` (QH III), measured by walking every shipped `carries: true` objective against the later missions' tags | the reed-cell carry (I→III) | §4.4 spec | ~40 code + ~45 test, plus 2 strings | app (`ui/after-action.ts`, `campaign.ts`, `main.ts`); `narrative-designer` for the two strings | engine (app) |
| **G5** | an enemy-side arrival condition (T-C2) | held | **Smaller than the MDD says.** `do.kind: remove` already takes a `zone` (`stepTriggers` 3922–3957) and takes riders with their carrier (GH-815). `eliminate_hvt` already **fails** on a removed target (4044–4058). Only the condition is missing: `on: { kind: "group_in_zone", group, zone }`, true when any living member of a declared group stands in the zone. Schema: one enum value and an `on.group` property. Runtime: one branch in `stepTriggers` beside `zone_entered` (`this.groups` + `zoneContains`). `validate_data.mjs`: the group must be declared and the zone must exist. T-C2 then reads `{ on: { kind: group_in_zone, group: ferry, zone: north_road }, do: { kind: remove, group: ferry, zone: north_road } }` and needs a new zone `north_road` | ~15 code + ~40 test | `sim-guard` | engine |
| **G-FC** | **`first_contact` fires at mission start.** It latches on any `fire` (wall shots included) and on any side's identification, civilians included (`mission.ts` 2525–2527) | EQ II (worked round, D3); **shipped**: measured with no orders on this branch, `wadi_halam_5_depot` `the_motorcycles_come_down_on_the_column` fires at **0.0 s** (a gun truck shooting a wall at tick 0), and that trigger carries the act's one Hallaq line; `khan_rafid_3_clearance` 0.1 s (a cell shooting its wall); `wadi_halam_4_village` 0.6 s and `beit_sahwan_1_recon` 0.3 s (an enemy identifying a **civilian**) | count `fire` only when `target >= 0` and the target's side is the other combatant side; count `contact identified` only between sides 0 and 1. Re-pin those four missions' `playtest` lines | ~4 code + ~25 test | `sim-guard` | engine |
| G-WALL | an idle enemy within 2.5 tiles of a neutral wall shoots it from tick 1, garrisons included (`selectBreachTarget`'s "Standing still is not a reason to stop", `sim.ts` 7469–7475). Measured: EQ I's hamlet cell fires 600 rounds at its yard wall in 90 s; in EQ II the barn cell does, and 4 yard walls are down by 90 s. Shipped too: UZ III, KR III, BS III, WH V | observation, not blocking. It is why D3, D5 and D9 exist | either exempt a garrisoned or `hold_position` unit from the at-rest breach, or accept it as doctrine | — | `sim-guard` (a lead call) | engine |
| G-E | trigger on a `SimEvent` / objective | 5 radio lines | Act III G-E, unchanged | — | `sim-guard` | engine |
| G4, G6, G7, G9, G10, G11 | as MDD §7 | | unchanged | — | as MDD | — |
| **G8** | field works' first campaign use | EQ II | **resolved as plannable**: a plan raises it with `rt.requestConstruct('kdf_outpost', 18, 24)` (measured §2.5). No shipped plan does yet | ~3 plan lines | `playtest` | live |

**MDD §7 in the light of this.**
- **G1** grows one consequence: listing first.
- **G2** gains the `at` and the `unlock` on the town.
- **G5** shrinks to a condition.
- **G8** is answered: the outpost is plannable.
- **New:** G-FC, G-WALL and G-T. G-T is pre-existing, and so is G-FC, which already fires Hallaq's one Act III line at
  0.0 s in WH V.

### 4.2 (detail) — G-FC's falsification, for `sim-guard`

The probe is a passive run (no orders) of each shipped mission that authors a `first_contact` trigger. It prints the
trigger's tick and the first event that latched it.

**Today it reads:**

| mission | fires at | latched by |
|---|---|---|
| WH V | 0.0 s | `gun_truck` at (39,9) → wall #49, `zu23_twin` |
| KR III | 0.1 s | `militia_cell` → wall #7 |
| WH IV | 0.6 s | `contact`, side 1 identifies `civilians` #19 |
| BS I | 0.3 s | `contact`, side 1 identifies `civilians` #23 |

**The fix's own test:** a passive WH V run must not fire `the_motorcycles_come_down_on_the_column` in its first 5 s.
**Falsify it:** restore line 2525 and watch that test go red.

### 4.3 G1 — implementation spec (for a separate implementer; this agent is read-only on code)

**The shape.** A town takes the same `unlock` object a region already takes:
- authoring spelling `{ "after_mission": "<id>" }` (and `roe_rating_min`, for parity, unauthored here);
- parsed to the runtime `UnlockGate` the region path already uses;
- rendered **only** through `gateSentence`, never through `@lions/sim`'s `unlockReason`, which prints the raw id
  (`requires clearing wadi_halam_3_counterraid`).

**Why it is not optional once `ein_qasab` is listed first.** Every "first town with something to play" walk returns
**Ein Qasab I before Wadi Halam I** on a ledger that has just cleared Umm Zeitoun IV. Those walks are:
- `nextMissionOfRegion` (`ui/worldmap.ts:106`);
- `nextOf` (`ui/worldmap3d.ts:219`);
- `continueTarget` / `nextOperation` (`campaign.ts:652, 677`);
- `nextMissionAfter`'s fallback (`campaign.ts:243`).

So the board click, the menu's Continue and the board's Next would all open the flood week before the act's first mission.

**Files and edits:**

1. **`data/schemas/world.schema.json`**, town item `properties` (lines 90–114). Add, after `missions`:
   ```json
   "unlock": {
     "type": "object",
     "additionalProperties": false,
     "description": "A town-level gate (GH-912 G1): the town's missions stay closed until the gate opens. Same shape and same reader as a region's unlock.",
     "properties": {
       "after_mission": { "type": "string" },
       "roe_rating_min": { "type": "integer", "minimum": 0, "maximum": 100 }
     }
   }
   ```
   +11 lines.
2. **`packages/app/src/campaign.ts`**:
   - `interface WorldTown` (17–23): add `/** Town-level gate (G1); absent = open whenever its region is. */ unlock?: UnlockGate;`
     (+2).
   - `interface TownJson` (88–93): add `unlock?: { after_mission?: string; roe_rating_min?: number };` (+1).
   - `parseWorld` (116–150): lift lines 124–126 into a local `const gateOf = (u?: { after_mission?: string;
     roe_rating_min?: number }): UnlockGate | undefined => { …same three lines…; return Object.keys(g).length > 0 ? g :
     undefined; }`. Use it for the region (line 140) and in the town map (132–137): `const town: WorldTown = {…}; const g =
     gateOf(t.unlock); if (g) town.unlock = g; return town;` (+8, −3).
   - `nextMissionOf` (203–208): **this is the one predicate**. First line of the body: `if (gateRequirement(town.unlock,
     ledger) !== null) return null;` Import `gateRequirement` from `./gate-sentence`, which is already imported for
     `gateSentence`. Update the doc comment: "Null when the town is finished, has nothing authored, or its own gate is
     closed" (+2). Every walk listed above inherits it with no edit: `missionOpen` (219), `nextMissionAfter` (243),
     `continueTarget` (652), `nextOperation` (677), `campaign-pay.ts` (via `missionOpen`), and the two boards' region
     walks. `townProgress` (167) is **not** gated: done/total still counts the town.
   - New export after `nextMissionOf`: `export function townLockedBecause(town: WorldTown, ledger: LedgerData |
     undefined, missionName: (id: string) => string | undefined = () => undefined): string | null { return
     gateSentence(town.unlock, ledger, missionName); }` with a doc line naming G1 (+7).
3. **`packages/app/src/ui/worldmap.ts`**, the town loop (172–215):
   - after `const tp = …` (178): `const townGate = p.status === 'locked' ? null : townLockedBecause(town, opts.ledger,
     missionName);`
   - status (186–187): `tp.total > 0 && tp.done === tp.total ? 'done' : tp.total === 0 ? 'empty' : townGate !== null ?
     'locked' : p.status`
   - `if (townGate !== null) marker.title = townGate;`

   The link condition (205) needs no edit: `next` is already null (+5).
4. **`packages/app/src/ui/worldmap3d.ts`**, the pin loop (354–432):
   - the same `townGate` line after 359;
   - `pinStatus` (366–367) gains the same `townGate !== null ? 'locked' :` arm;
   - `previewThisPin` (406): `lockedBecause: townGate ?? p.lockedBecause ?? undefined`.

   **No new i18n key.** `hoverLine` already renders `world3d.hover.locked` (`{region} — locked: {reason}`) with
   `regionName: town.name`, so the pin reads *"Ein Qasab — locked: Clear Wadi Halam III — The Cattle Track first"*,
   exactly the sheet's §1 line. The sheet's proposed `world3d.say.townLocked` / `world3d.hover.townLocked` keys are
   therefore **not needed** (+5).
5. **`tools/validate_world.mjs`** (new; its own module because `validate_data.mjs` runs at import):
   `export function townGateFailures(world, missionIds)`. For each town with `unlock.after_mission`, it refuses:
   - (a) a mission no town lists. Unlike a region's gate, this is refused even if a file exists: a town gated on an
     unlisted mission is locked forever;
   - (b) a mission of the **same** town;
   - (c) a mission in a **later** region;
   - (d) a cycle: walk gating mission → its town → that town's gate; if this town comes back, refuse.

   Wire it into `validate_data.mjs` after the region-gate loop (1229–1240): `failures.push(...townGateFailures(world,
   new Set(listed.keys())));` (+40 module, +3 wiring).

**Tests to add, each with the input that makes it fail** (CLAUDE.md: constructed and run):

| test | file | input and assertion | the mutation that turns it red |
|---|---|---|---|
| T1 parse | `packages/app/src/campaign.test.ts` | a fixture world whose town has `unlock: { after_mission: 'x' }` → `parseWorld(...).regions[0].towns[0].unlock` equals `{ afterMission: 'x' }`; a town with none has `unlock === undefined` | drop the town `gateOf` line |
| T2 the predicate | same | fixture: one region, town A `[a1]`, town B `[b1]` gated on `a1`. `nextMissionOf(B, {})` → `null`; with `completed: ['a1']` → `'b1'`; `missionOpen(world, 'b1', {})` → `false` | delete the gate line in `nextMissionOf` |
| T3 the listing-first walk, on the **real** `world.json` | same | ledger = every Marj and Sur mission completed. `nextOperation(world, L)` → `'wadi_halam_1_fords'`; `continueTarget(world, L, {id:'t', done:true})?.missionId` → `'wadi_halam_1_fords'`; `missionOpen(world, 'ein_qasab_1_recon', L)` → `false`. Then L + WH I–III: `missionOpen(world, 'ein_qasab_1_recon', L')` → `true` | delete the gate line: `nextOperation` answers `'ein_qasab_1_recon'` |
| T4 the tutorial fallback | same | `nextMissionAfter(world, 'beit_sahwan_0_tutorial', L)` → `'wadi_halam_1_fords'` | same mutation |
| T5 the sentence, never the id | same | `townLockedBecause(einQasab, {}, (id) => missions[id]?.name)` → `'Clear Wadi Halam III — The Cattle Track first'`, and `.not.toContain('wadi_halam_3_counterraid')`; without a catalogue → `t('gate.clearUnknown')` | call `unlockReason` instead of `gateSentence` |
| T6 3D pin | `packages/app/src/ui/worldmap3d.test.ts` | ledger L (T3): the `[data-town="ein_qasab"]` pin has `data-status="locked"` and no `a.rl-world__townlink`; `mouseenter` makes the say line equal `t('world3d.hover.locked', { region: 'Ein Qasab', reason: 'Clear Wadi Halam III — The Cattle Track first' })` | drop the `townGate` arm of `pinStatus` |
| T7 flat pin | `packages/app/src/ui/worldmap.test.ts` | ledger L: the Ein Qasab marker has `data-status="locked"`, a `title` equal to the T5 sentence, and no link; the Wadi Halam marker has a link to `wadi_halam_1_fords` | the same mutation in `worldmap.ts` |
| T8 validator | `tools/src/validate_world.test.ts` (new) | four fixtures, each giving exactly one failure: same-town gate, later-region gate, unknown mission, a two-town cycle. The real `world.json` gives `[]` | comment out each rule in turn; its fixture passes |

**Size:** ~90 lines of code (schema 11, `campaign.ts` ~22, boards ~10, validator ~43, wiring 3) and ~150 lines of tests.
`player-wording.test.ts` needs no change: no catalogue string is added, and the sentence is `gate.clearMission`, which it
already reads. A locked town's missions still boot by URL (`/mission/<id>`), like any locked mission; `campaign-pay.ts`
then pays against the lifetime record because `missionOpen` is false. That is the existing rule, unchanged.

**One edge, stated:** a region whose only unfinished towns are locked reads `live` and has nothing to click, so the 3D
click outcome is `cleared`. That cannot happen in Naharin, because Ein Qasab unlocks on a Wadi Halam mission, but the
first future town gated across regions will meet it.

### 4.4 G-T — the after-action carry (spec)

- **`packages/app/src/campaign.ts`**, new export: `carryReaderOf(world, missions, fromId, tag): string | undefined`.
  It walks the flattened `world.json` order after `fromId` and returns the first mission that both
  `ledger.requires.includes('intel.marked_positions')` and carries `tag` on any placement. The placement walk is
  `enemy.garrison`, `enemy.waves[].units`, `triggers[].do.units` and `passengers`, recursively, the same walk as
  `validate_data.mjs`'s `walkPlacements` (~30 lines).
- **`packages/app/src/ui/after-action.ts`**:
  - `AfterActionObjective` (25–31) gains `carriesInto?: { name: string }`;
  - line 265 reads `o.carriesInto ?? i.next`;
  - a carrying objective with a tag and no reader falls back to `aar.changed.carries` (*"Carries forward: …"*);
  - objectives with no tag (BS III's count picture, TM III's `eliminate_hvt`) keep today's `i.next`.
- **`packages/app/src/main.ts`**, the `afterAction({…})` call (5890–5915): build `objectives` with `carriesInto`
  resolved from `mission.objectives[k].target` through `carryReaderOf` (~8 lines).
- **Strings** (`narrative-designer`): `aar.carries` (*"Carries into the next mission"*) and `glance.matters.carries` (*"…it
  carries into the next mission"*) are false for EQ I and for the three shipped cases above. Recommend *"a later
  mission"*.
- **Test** (`after-action.test.ts` + `campaign.test.ts`): on the real catalogue,
  `carryReaderOf(world, missions, 'ein_qasab_1_recon', 'eq_reed_cell')` → `'ein_qasab_3_buildup'`, and
  `carryReaderOf(..., 'beit_sahwan_1_recon', 'bs_hvt_atgm')` → `'beit_sahwan_3_clearance'`. **Falsified by today's
  behaviour**, which names `beit_sahwan_2_foothold`.

### 4.5 What the playtest planner needs

| mission | what the plan must do | APIs it uses | expected | probes to add |
|---|---|---|---|---|
| EQ I | Sniper onto the west ridge for the picture and the reed cell (the carry: a 3-star plan). Drone kept clear of the crest truck's 11 tiles. Two carriers walked from `causeway_s`: stand a squad at the ring's edge (18.5,34.5) to shepherd without springing, or close in and fight. Two from the hamlet yard (the 39-step walk home, or the Eitan). **3 at the refuge by 300 s** | `sim.queueCommand` `move`/`attackMove`; shepherding is proximity (4 tiles, ground units only; `CivilianFlight` queues `load` for a carrier) | victory, ★★★ | T-A1 fire tick and `south_road` size; the passive control (`passiveAcrossSeeds`, defeat: measured 5/5 seeds, at 299.9 s on the carriers) |
| EQ II | Escort into the hollow. **Raise the outpost at t = 1**: `rt.requestConstruct('kdf_outpost', 18, 24)` (measured: complete 55.5 s). Then the engineers or the mortar and Namer on the barn by 300 s. AT team at the gap from 140 s. Hold 300 s accumulated once the barn cell is out. Identify the saddle truck (it comes to the farm on entry) | `rt.requestConstruct` (first plan ever to call it); `rt.objectiveStatus` | victory, ★★★ | the ladder **with and without the 215 s swarm wave** (T-B1's gate); the crest site (28,9) as a second report-only plan; the passive control (defeat 5/5, the barn at 299.9 s) |
| EQ III | Buy feet: `rt.requestBuild('inf_squad')`, `'at_team'`, `'mortar_team'`. Engineers across the causeway to the stock by 330 s. Hold the head 240 s once the stock guard and the HVT are out. The AT team early via the west island to the lip for the stop (44 steps on foot). Guard `camp_door` at 200 s or accept the pause. Optionally the smoke (`rt.requestSupport('smoke_screen', x, y)`, 100 Intel) | `requestBuild`, `requestSupport`, `objectiveStatus` | victory, ★★ (no carrying secondary) | **the carry probe** (the BS III precedent): EQ III on (a) the plan's own EQ II ledger and (b) a ledger with none of the three tags marked. **Both must win**, or the carry makes III unwinnable either way; T-C3 Conduct at the win; the passive control (defeat 5/5, the stock at 329.9 s) |
| chain | `const eq1 = run('ein_qasab_1_recon', plan, wh3)`, then `run(…2…, plan, eq1)`, then `run(…3…, plan, eq2)`. EQ II produces the union of I's marks and its own (`mission.ts` 4263–4268), so the chain carries without a merged ledger. G-U's `requires` is kept as the contract | | | a report-only second chain from `wh5`'s ledger, so the "after WH V" order is exercised (the controller's unenforced order) |
| pins | `LADDER_CREDITS` and `packages/app/src/ui/stores-model.ts` `CAMPAIGN_CREDITS` (`campaign_credits.test.ts` holds them equal) re-pin; check `ROSTER_MAX`. **The star gates are untouched**: they open after missions 5, 13 and 19 of the flattened order, and Ein Qasab sits at 22–24 (`GATES`, `playtest.ts` 3162–3166); the Conduct gates all open at 1 | | | |

---

## 5. Verification record (this session)

**Assembled scratch missions and maps, outside `data/missions/`:**
`/private/tmp/claude-501/-Users-ilpinto-dev-roaring-lions/5d1f74e7-c36f-4120-a675-5c63c714fcf1/scratchpad/eq/`, holding:
- `ein_qasab_1_recon.json`, `ein_qasab_2_foothold.json`, `ein_qasab_3_buildup.json`;
- `ein_qasab.json` (the shipped map with this script's additive markers);
- `jebel_matar.json` and `ein_qasab_3.json` (the MDD §3.2 and §3.3 sketches parsed from the MDD's own grids, with this
  script's markers and zones);
- `build.py`, the source of every fragment above.

| check | result |
|---|---|
| `ajv` (2020) of the three missions against `data/schemas/mission.schema.json` | **one error each, and only the expected one:** `/town` is not in the enum (G2). Every other field name and value validates |
| `ajv` of the three maps against `map.schema.json` | pass |
| The shipped validator functions run on the scratch missions: `incomeFailures`, `garrisonStanceFailures`, `timeLimitFailures`, `removeTriggerFailures`, `triggerLabelFailures`, `narrativeTextFailures`, `briefingFailures`, `fieldWorksKeyFailures`, `fieldWorksCarrierReport`, `tunnelSensorFailures`, plus a reference pass (unit ids under `data/units/`, every `from`/`to`/`refuge`/`supply_entry` a marker, every objective zone a zone, every locate/HVT target a declared tag, every addressed group declared) | **all pass**. **Falsified:** a trigger `to` set to the zone `lip`, a label ending in a full stop, and a wave `from: reed_x` each went red, then green again on rebuild |
| Every string verbatim from the sheet | script check of every `text`, `label`, `briefing`, `dispatch`: 0 mismatches |
| Runtime boot (`MissionRuntime.start()` on the real `Sim`, `applyTerrain`, the real unit and structure catalogues, built as `playtest-run.ts` does) | all three boot. Every wave spawns at its time. **Falsified:** `rif_ne` at (47,5) throws at load (D1) |
| Spawn ground (every body, spread 1.25, of every placement, wave, civilian and waypoint) | 28 / 28 / 30 bodies: none on a blocked tile, and no wheeled body on `~` or `b` |
| Passive control (no orders), seeds 424242 and 1–5 | defeat on every seed: EQ I at 299.9 s (carriers); EQ II at 299.9 s (barn); EQ III at 329.9 s (stock). Conduct 100 |
| T-A2 spring distances; T-A1 withdrawal routes; field-works sites; the swarm probe | as quoted in §1.5, §2.4, §2.5 |
| `first_contact` and wall-shot census (EQ I–III and shipped WH V, KR III, WH IV, BS I, UZ III, BS III) | as quoted in D3 and §4.1 |

**Not run, by design.** For `mission-author`, in this order:
1. `pnpm validate:data`;
2. `npx tsx tools/src/walk_placements.ts`;
3. `npx tsx tools/src/walk_mission.ts <id> 0 60 180`;
4. `map_distinctness`, `map_visibility --draw=<id>`, `decorPlacements` (G7);
5. then `pnpm playtest`.

The sketch maps here are the MDD's; any edit to the committed grids voids the route numbers.

## 6. Registration checklist

Every place the new town or its two new maps must be registered. Found by grepping every shipped town id (`khan_rafid`,
`qarn_hadid`, `wadi_halam`, `umm_zeitoun`, `deir_amun`) and every map id (`wadi_halam_5`, `ein_qasab`) as a key, across
`tools/`, `packages/` and `data/`.

| file | what to add | why it would go red otherwise |
|---|---|---|
| `data/schemas/mission.schema.json` `town` enum | `"ein_qasab"` | `ajv` (measured) |
| `data/campaign/world.json` Naharin `towns` | the Ein Qasab town, **first**, with `at` and `unlock` (G2) | the missions are unreachable (`validate_data.mjs`, "no town lists it") |
| `data/schemas/world.schema.json` + `campaign.ts` + boards + `tools/validate_world.mjs` | G1 (§4.3) | schema: `unlock` on a town is an additional property |
| `data/campaign/commander.json` `villains.naharin` | `"ends_at": "wadi_halam_5_depot"` (G-Q) | robustness only |
| `data/missions/` | the three files (§1.7, §2.7, §3.7) | |
| `data/maps/ein_qasab.json` | 4 markers, 1 zone (§1.4) | `medic_every_mission.test.ts` (`wounded_evac`); `start()` throws without them |
| `data/maps/jebel_matar.json`, `data/maps/ein_qasab_3.json` | new (MDD §3.2, §3.3 plus §2.4 and §3.4 here). Display names from the sheet §1: *Ein Qasab — The Hill Farm*, *Ein Qasab — The Lower Causeway* | |
| `packages/data/src/index.ts` | 2 map imports plus `maps` entries; 3 mission imports plus `missions` entries | nothing can load them |
| `packages/worker/src/match/map-ids.ts` `SHIPPED_MAP_IDS` | `'ein_qasab_3'`, `'jebel_matar'` (sorted) | `map-ids.test.ts` pins it to `@lions/data` both ways |
| `packages/worker/src/campaign-order.ts` `MISSION_TARGET_MINUTES` | `ein_qasab_1_recon: 6`, `ein_qasab_2_foothold: 7`, `ein_qasab_3_buildup: 7` | `campaign-order.test.ts` pins it to `data/missions/` |
| `tools/src/validate_time_limit.test.ts` `EXPECTED` | `ein_qasab_1_recon: 720`, `ein_qasab_2_foothold: 840`, `ein_qasab_3_buildup: 840` | "every shipped mission is in the table" |
| `tools/src/medic_every_mission.test.ts` | counts 27 / 26 / 26 → **30 / 29 / 29**, and the `it(...)` title | hard-coded counts |
| `tools/src/map_visibility.test.ts` | `maps.size` 26 → **29** (Ein Qasab becomes a campaign map too) and the comment; each new map ≥ 84% or a named exemption | hard-coded count |
| `tools/src/high_ground_maps.test.ts` `RISES` | `jebel_matar`, `ein_qasab_3` (read on first run), and the header's relief-map and rise totals | every relief map must be listed |
| `packages/app/src/ambience.test.ts` `EXPECTED` | `jebel_matar: 'open'`, `ein_qasab_3: 'open'` (built 1.2% and 1.3%, under `TOWN_BUILT_SHARE`) | typed `Record<keyof typeof maps, …>`: `tsc` and the `toEqual` |
| `packages/app/src/sandbox-anchors.pinned.json` | entries for the two maps (regenerate), and re-check `ein_qasab`'s after its new markers | `sandbox-anchors.test.ts:197` keys equal `maps` |
| `packages/app/src/mesh-catalogue.test.ts:667` | skip by `terrain === 'wetland'`, not by the literal `'ein_qasab'` | the new wetland maps fetch the bale and the culvert (`propKindsFor`), and the "every other map keeps the plain seven" loop goes red |
| `packages/app/src/terrain-defaults.test.ts` | no change. Wetland maps are excluded and `shipped` stays 35. Optionally assert the two new ids are in `wetland` | — |
| `packages/app/src/ui/menu.ts` `UNLISTED_MAP_IDS` + `ui/sandbox-menu.test.ts:86` | add both new maps while their art is incomplete (MDD §0.1 point 9), and update the pin `toEqual(['ein_qasab', …])` | Q5 |
| `packages/app/src/i18n/en.json` | `freePlay.map.jebel_matar`, `freePlay.map.ein_qasab_3`; rewrite `freePlay.map.ein_qasab` without *"Terrain study:"* (sheet §1, strings given there) | the menu spec needs a key per map |
| `tools/src/backtest/playtest.ts` (+ `plans/ein_qasab.ts`, side-effect-free like `plans/wadi_halam.ts`) | three plans, three passive controls, the chain from `wh3`, a report-only chain from `wh5`, the T-B1 with/without probe; re-pin `LADDER_CREDITS` (and `ROSTER_MAX` if it moves) | the gate ladder prints "no recorded winning plan … contributes 0 stars" |
| `packages/app/src/ui/stores-model.ts` `CAMPAIGN_CREDITS` (+ its "26 missions" comment) | equal to the new `LADDER_CREDITS` | `tools/src/campaign_credits.test.ts` |
| new doctrine tests (MDD §3.2, §3.3) | `jebel_matar_doctrine.test.ts`, `ein_qasab_3_doctrine.test.ts`, plus a water-share guard for `ein_qasab_3`; optionally an `ein_qasab_ground.test.ts` on the WH model (`wadi_halam_ground.test.ts:62–75`: every wave route reaches its `to`) | MDD's pins |
| `tools/src/map_distinctness.ts` | nothing to register (it reads `world.json`); **run it**: the margins are 3–4 points | |
| `docs/GDD.md` §2 / §11 | the sheet's §11 text, in the commit that lands G2 | |
| **no change needed** | `tools/validate_biome.mjs` (Naharin has no `REGION_BIOME`); `tools/src/video/storyboard.test.ts:33` (its seven-town set is the approved cinematic scope, not a town registry: adding Ein Qasab there would claim a video nobody approved); `terrain-defaults.fixture.json` (wetland excluded); `tools/validate_narrative.mjs` rank order (the ranks name WH missions only); the `playtest.ts` star and Conduct `GATES` (they open after missions 5, 13 and 19, and after 1); `campaign-close.test.ts` (the flattened last mission stays `wadi_halam_5_depot` because Ein Qasab is listed first) | |

## 7. Questions for the lead (recommendation first)

1. **G-FC (shipped, found here).** **Recommend a `sim-guard` issue now, independent of this town.**
   - WH V's Hallaq line (`the_motorcycles_come_down_on_the_column`) plays at 0.0 s, and three other shipped
     `first_contact` triggers fire before 1 s with no orders.
   - The fix is ~4 lines plus a test.
   - It moves those four missions' `playtest` lines.
   - Ein Qasab avoids `first_contact` meanwhile (D3), so it does not wait on it.
2. **T-B1 at one swarm.** **Recommend adopt, gated on the `playtest` ladder with and without the 215 s wave.** The probe
   (20 seeds, `hit_mult` 0.08) loses no unit when one swarm meets a halted 2-squad and Eitan group. It does not cover a
   lone detached team. If the ladder drops out of band, it goes back to *hold*.
3. **The two after-action strings (G-T).** **Recommend "a later mission"** in `aar.carries` and `glance.matters.carries`,
   with the reader resolution in §4.4. Today they misname three shipped carries and would misname Ein Qasab I's.
4. **G-WALL.** **Recommend leaving it as doctrine for now**, and asking `sim-guard` whether a garrisoned or
   `hold_position` unit should breach its own yard wall at rest. Today every garrison beside a wall shoots it from tick 1,
   on shipped maps too. It reads like a bug to a player, but it is the combat model's call, not this town's.
5. **The two new maps in Free Play.** **Recommend both unlisted (`UNLISTED_MAP_IDS`) until their art is complete**, as
   Ein Qasab is.
6. **Ein Qasab's board pin.** **Recommend (804.0, 461.7)**: inside Naharin, and south of Wadi Halam, which reads
   "downstream". `mission-author` confirms the label does not collide on either board.
7. **EQ III's saddle truck as a `gun_truck`** (the MDD's footnote). **Recommend `gun_truck`.** Its 11-tile reach is what
   makes it "a known gun over the causeway head", and the tag carries regardless.
8. **The end screen after WH III offers WH IV, while Continue offers Ein Qasab I** (because the town is listed first).
   **Recommend no change**: the order is unenforced by ruling, and both are open.
