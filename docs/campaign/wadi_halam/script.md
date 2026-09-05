# Wadi Halam — Level Script

**Date:** 2026-09-06 · Written against `docs/campaign/wadi_halam/design.md` (Option
C, the recommended plot — one failable primary added to each of I–IV, IV's
`evac_families` flipped to primary, V unchanged) and
`docs/campaign/wadi_halam/narrative.md`, both read in full this session, plus
`docs/campaign/tel_marum/script.md` for the shape this document follows.
Verified directly against `data/schemas/mission.schema.json`,
`packages/sim/src/mission.ts` and `tools/validate_narrative.mjs` — every shape
below is grepped, not quoted from a summary — and against the five shipped
files, `data/maps/wadi_halam_basin.json`, and the Wadi Halam plans in
`tools/src/backtest/playtest.ts`.

**This document assumes Option C** (the design's own recommendation). **The lead
has not chosen** (design §10 O-A; narrative §0.6). Every row that depends on it
is marked **[C]**. If the lead takes Option A instead, drop every **[C]** row —
the `say`/`say_on_fail` lines on shipped objectives and triggers, the trigger-id
renames, `dispatch` on I, `aftermath`/`debrief` on V and the three already-applied
Hallaq-naming edits (§0 below) are all independent of it and the sheet still
reads.

**Status vocabulary**, unchanged from Act I and II: `live` — the mechanism
exists in the schema and the runtime today. `schema` — needs a new field, no
runtime change. `engine` — needs new runtime logic. One reason almost nothing
here reads `schema`: the 2026-09-03 engine slice landed `say` on triggers and
objectives, `say_on_fail`, `remove`, `starting_force[].group`, and
`dispatch`/`aftermath`/`debrief` — verified in `mission.schema.json` and
`packages/sim/src/mission.ts` this session. **Option C needs none of it: every
mechanism it uses (`evacuate_before`, `raze`, `civilians`, `structures`, a
`stance: garrison`) already ships.** The town's `engine` rows are entirely
narrative surface (a wave that cannot speak, a trigger that cannot watch an
objective or a `SimEvent`, a `debrief` that cannot tell a win from a loss, a
villain portrait with no branch to draw it) — nothing here blocks Option C
shipping.

Nothing here is written into `data/missions/`, `data/maps/`, or
`packages/sim/`. Every fragment in §8 is copy-ready JSON for `mission-author`
to assemble and validate. **The five patched missions were assembled into a
scratch directory outside this repository and validated with `ajv` against
`mission.schema.json`, plus a hand-written semantic pass (unit-id resolution,
group/marker/zone references, refuge-in-zone, unique trigger ids, legal
speakers, the 240-character `say` ceiling) against the real shipped map and
unit catalogue — all five files PASS every check.** §8 records the method.

### §0 — What is already shipped and must not be re-proposed

`narrative.md` §13 records three edits **already applied** to the JSON on this
branch, verified by reading the shipped files directly this session — they are
not part of this document's copy-ready fragments because there is nothing left
to copy:

| file | field | already reads |
|---|---|---|
| `wadi_halam_3_counterraid.json` | `briefing` | *"...Jubran Hallaq's man on this ground..."* — first live naming of the villain |
| `wadi_halam_3_counterraid.json` | `objectives[kill_amir].text` | *"Kill or capture Hallaq's local commander"* |
| `wadi_halam_4_village.json` | `objectives[kill_cache_guard].text` | *"Kill or capture the quartermaster holding Hallaq's cache"* |
| `wadi_halam_5_depot.json` | `briefing` | *"...Hallaq's depot..."* |

---

## 1. Flags and ECA rows

### 1.0 Trigger-id renames

**Nine trigger ids ship, not eight** (`narrative.md` §9: *"The brief that
commissioned this sheet said eight; the five mission files declare nine
triggers between them... and every one of them is a debug identifier on
screen today."*) — verified by reading all five files: I has 1, II has 5
(`wave_1..4` plus `picket_withdraws` — II's reinforcements are `spawn`
**triggers**, not `waves[]` items, so they already print `enemy reacts
(wave_1)` rather than `enemy reinforcements`), III has 1, IV has 1, V has 1.

A trigger's `id` carries no schema pattern (`mission.schema.json`:
`triggers[].id` is a bare `{"type":"string"}`), and `describeMissionEvent`
(`main.ts:265`) interpolates it verbatim: `` `enemy reacts (${e.id})` ``. The
campaign's own shipped convention (`they_take_the_south_village`,
`the_tube_moves_north`, all grepped from `data/missions/*.json` this session)
is prose joined by underscores, not literal spaces — so the renames below
render as, e.g., `enemy reacts (the_bank_patrol_turns_for_the_ford)`, matching
the shipped house style rather than introducing a new one.

| # | mission | old id | new id | why |
|---|---|---|---|---|
| 1 | I | `bank_reacts` | `the_bank_patrol_turns_for_the_ford` | names the thing the player is about to watch, and the direction, so he can act on it |
| 2 | II | `wave_1` | `riders_out_of_the_north` | II's four reinforcements are `spawn` triggers, so this is the mission where the raw ids cost the most |
| 3 | II | `wave_2` | `riders_out_of_the_south` | |
| 4 | II | `wave_3` | `technicals_off_the_east_track` | names the vehicle — the third wave is the one that changes what the player needs |
| 5 | II | `wave_4` | `the_last_of_the_motorcycles` | *the last of* is a promise the mission keeps: there is no fifth |
| 6 | II | `picket_withdraws` | `the_raiders_break_off_east` | *break off*, not *withdraw* or *retreat* — Rif doctrine is disengagement, not a rout |
| 7 | III | `amir_runs` | `the_commander_runs_for_the_east_track` | the id the brief asks about; a sentence about a person doing something, register-matched to the briefing's *"a mobility problem, not a firepower one"* |
| 8 | IV | `reserve_commits` | `the_technicals_at_the_south_hide_run_for_the_village` | the longest of the nine and worth it — names where they came from, which the player has not looked at yet |
| 9 | V | `harass_commits` | `the_motorcycles_come_down_on_the_column` | verbatim what briefing beat 6 already promises, so the toast confirms a warning instead of printing an identifier |

**A rename touches nothing but the JSON `id` string and the player's `enemy
reacts (<id>)` line.** Verified before proposing it:

- **No wave anywhere in the town uses `trigger` at all.** Grepped all five
  files for `"trigger":` inside `enemy.waves[]` — zero hits. The schema's wave
  `trigger` field names an **objective** id, not a trigger id, so a trigger
  rename could not break one regardless; there simply is none to break here.
- **No plan in `tools/src/backtest/playtest.ts` references a trigger id by
  string.** The five Wadi Halam plans (`wh1`–`wh4`, plus V's inline plan)
  drive `sim.queueCommand` directly by unit id and coordinate; they never call
  by trigger id, objective id, or group name as a string literal that would
  need to match a renamed value.
- **`stepTriggers`'s own `firedTriggers` latch is indexed per trigger object**
  (`packages/sim/src/mission.ts`), not by id string, so renaming an id changes
  no runtime behaviour, only the text a `trigger` `MissionEvent` carries.

### 1.1 Mission I — `wadi_halam_1_fords` — flags

| flag | kind | fiction |
|---|---|---|
| `picture` | primary, `locate`, `count: 4` | the picture Idit is building of a road, not a garrison |
| `take_ford` | primary, `hold_for(ford_watch, 240)` | the column crossing behind the screen |
| `screen_out` | secondary, `survive_until(200)` — cannot fail | patrol-endurance floor |
| **[C]** `get_the_carriers_out` | primary, `evacuate_before(refuge, 3, 300)` | the atrocity `dispatch` told, made physical: four carriers alive at the south ford |
| `the_bank_patrol_turns_for_the_ford` (trigger, was `bank_reacts`) | `zone_entered(ford_watch)` → `commit bank → ford_north` | Rif mobility used as a decision, the first time the player sees it |

### 1.2 Mission I — ECA rows

| Event Name | IF | THEN | narrative cue bound | status |
|---|---|---|---|---|
| The act opens | mission start | `dispatch` string set (§8a) | narrative §1.2 — the corridor, the hamlet, no name, no method | live |
| The brief plays | mission start | `briefing` (unchanged; **[C]** gains one clause, §8a, applied only with the objective) | narrative §1.3 / §1.5 | live |
| Fourth site identified | `objective(picture, complete)` | `objectives[].say` | idit: *"Four sites and not one of them is a position... this is a haulage route with guns parked along it."* | live |
| Ford watch held | `objective(take_ford, complete)` @240s | `objectives[].say` | net: *"Ford watch held. The column is across the wadi."* | live |
| Screened three-twenty | `objective(screen_out, complete)` @200s | toast only | shipped, unchanged; `survive_until` cannot fail, no `say_on_fail` authorable | live |
| **[C]** Three carriers reach the refuge | `objective(get_the_carriers_out, complete)` @≤300s | `objectives[].say` | shai: *"Four of them off the ford and out of the corridor... tonight they are not."* | live |
| **[C]** Deadline runs out short | `objective(get_the_carriers_out, failed)` @300s | `objectives[].say_on_fail`; **loses the mission** | shai: *"The crossing shut with them still on it. We were eight tiles away and looking the other way."* | live |
| A carrier reaches the refuge | `evacuated` event | nothing spoken | `describeMissionEvent` has no `evacuated` case (Act I's G-B, still open) | engine |
| Bank patrol turns | `zone_entered(ford_watch)` → renamed trigger | `commit bank → ford_north`; `triggers[].say` | idit: *"Both bank patrols have turned for the north ford. They did not wait to be told..."* | live |
| Wave @90s (2 `moto_rpg` from `rif_south` → `ford_south`) | clock | toast (hard-coded) | proposed radio line — a wave cannot speak | live (wave) / engine (line) |
| Wave @210s (2 `moto_rpg` from `rif_east` → `ford_north`) | clock | toast | none proposed | live |
| Wave @225s (1 `technical` + 1 `moto_rpg` from `rif_south` → `ford_south`) | clock | toast | proposed radio line — same limit | live (wave) / engine (line) |
| Mission ends | `missionEnd(any)` | `debrief` string set (§8a) | narrative §1.6 — honest on a win and a loss | live |
| Mission ends (victory) | `missionEnd(victory)` | `debrief`-split line proposed | needs the win/lose split (G-C) | engine |

**Row count this mission: 12 live, 0 schema, 2 engine.**

### 1.3 Mission II — `wadi_halam_2_laager` — flags

| flag | kind | fiction |
|---|---|---|
| `hold_pasture` | primary, `hold_for(pasture, 300)` | the corridor opens once the ground is held five minutes uncontested |
| `keep_ford` | secondary, `capture(ford_watch, 15)` | the crossing stays clear behind the advance |
| **[C]** `burn_store` | primary, `raze(pasture, 300)` | T10 given an object: his forward store, on the same clock as the hold |
| `riders_out_of_the_north` (was `wave_1`) | `timer_s(60)` → `spawn` | first compass point |
| `riders_out_of_the_south` (was `wave_2`) | `timer_s(150)` → `spawn` | second |
| `technicals_off_the_east_track` (was `wave_3`) | `timer_s(240)` → `spawn` | third — no direction is safe |
| `the_last_of_the_motorcycles` (was `wave_4`) | `timer_s(330)` → `spawn` | fourth, and the last |
| `the_raiders_break_off_east` (was `picket_withdraws`) | `casualties_pct(60)` → `withdraw_to raiders → rif_east` | mobility as armour, stated |

### 1.4 Mission II — ECA rows

II has **no `enemy.waves` at all** — every reinforcement is a `spawn` trigger,
which is exactly why the id rewrites matter more here than anywhere else in
the town.

| Event Name | IF | THEN | narrative cue bound | status |
|---|---|---|---|---|
| The brief plays | mission start | `briefing` (unchanged; **[C]** gains one clause, §8a) | narrative §2.2 / §2.3 — no Idit beat, deliberately | live |
| No dispatch | mission start | none, and there must not be one | the act's dispatch belongs to I | live (as an absence) |
| Pasture held 5 min | `objective(hold_pasture, complete)` @300s | `objectives[].say` | net: *"Five minutes of pasture, uncontested. The crossing is laid..."* | live |
| Ford watch kept | `objective(keep_ford, complete)` | toast only; goes `active → complete` under **[C]** because the extra fight around the shed holds a unit on the ford watch long enough | shipped, unchanged | live |
| **[C]** Store burned in time | `objective(burn_store, complete)` @≤300s | `objectives[].say` | idit: *"The shed was a forward store... this ground is not the end of his road; it is the middle of it."* — T10 delivered as an object | live |
| **[C]** Store NOT burned | `objective(burn_store, failed)` @300s | `objectives[].say_on_fail`; **loses the mission** | shai: *"The shed is standing and the pasture is ours. One of those was the mission."* | live |
| Riders out of the north @60s | renamed trigger `spawn` | toast | none proposed | live |
| Riders out of the south @150s | renamed trigger `spawn` | toast | none proposed | live |
| Technicals off the east track @240s | renamed trigger `spawn` | `triggers[].say` | idit: *"Third compass point in four minutes... they gave you a field and not a hill."* | live |
| The last of the motorcycles @330s | renamed trigger `spawn` | toast | none proposed | live |
| The raiders break off east | `casualties_pct(60)` → renamed trigger | `triggers[].say` | idit: *"Sixty per cent and they are breaking off east. That is not a rout..."* — the line that stops the player reading a withdrawal as a win | live |
| A purchased squad arrives | `built` event | toast (hard-coded, prints raw unit id) | Act I's G-D, still open | engine |
| Mission ends | `missionEnd(any)` | `debrief` string set | narrative §2.5 — *"A laager is a place that can be found..."* | live |

**Row count this mission: 12 live, 0 schema, 1 engine.**

### 1.5 Mission III — `wadi_halam_3_counterraid` — flags

| flag | kind | fiction |
|---|---|---|
| `kill_amir` | primary, `eliminate_hvt(wh_hvt_amir)` | Hallaq's local commander, already named in the shipped briefing this pass |
| `hold_bunds` | primary, `hold_for(pasture, 300)` | held against the two-wave counter-raid |
| `mark_hides` | secondary, `locate(wh_hide_south)` | the one mark in the act that is actually spent (III's own herd, IV's carry-over path) |
| **[C]** `get_the_herders_out` | primary, `evacuate_before(refuge, 3, 300)` | the raid the player chose to run has people living on its ground |
| `the_commander_runs_for_the_east_track` (was `amir_runs`) | `casualties_pct(40)` → `withdraw_to amir → rif_east` | *"Do not chase what runs"* charged a second time |

### 1.6 Mission III — ECA rows

| Event Name | IF | THEN | narrative cue bound | status |
|---|---|---|---|---|
| The brief plays | mission start | `briefing` — **already carries** the Hallaq clause and the 289-char beat fix (§0) | narrative §3.2 | live |
| Commander killed/taken | `objective(kill_amir, complete)` | `objectives[].say` | idit: *"That is Hallaq's man on this ground. He does not know where the rockets went..."* | live |
| Bunds held 5 min | `objective(hold_bunds, complete)` @300s | `objectives[].say` | net: *"Bunds held. Both counter-raids are off the pasture."* | live |
| Southern hide identified | `objective(mark_hides, complete)` | `objectives[].say` | idit: *"That is the hide, and I am not asking for a second one... the herd on the track cannot wait for me to be sure."* — Idit declining to ask, stated once | live |
| **[C]** Three herders reach the refuge | `objective(get_the_herders_out, complete)` @≤300s | `objectives[].say` | net: *"Herd and herders are off the track and inside the refuge line."* — flat; nobody's fault | live |
| **[C]** Deadline runs out short | `objective(get_the_herders_out, failed)` @300s | `objectives[].say_on_fail`; **loses the mission** | shai: *"The track is shut with them still on it. We chose to raid this ground; they only live on it."* | live |
| A herder reaches the refuge | `evacuated` event | nothing spoken | Act I's G-B, still open | engine |
| Commander runs for the east track | `casualties_pct(40)` → renamed trigger | `withdraw_to amir → rif_east`; `triggers[].say` | shai: *"He is running for the east track and he will not stop... do not take the bunds off the map to chase him."* | live |
| Wave @90s (2 `technical` from `rif_east` → `pump_house`) | clock | toast | none proposed | live |
| Wave @200s (2 `moto_rpg` + 1 `technical` from `rif_south` → `pump_house`) | clock | toast | proposed radio line — a wave cannot speak | live (wave) / engine (line) |
| South hide contacted unmarked | `SimEvent contact` on `wh_hide_south` | proposed radio line | needs a sim-watching trigger (G8/G-E) — the carry-over said aloud | engine |
| Mission ends | `missionEnd(any)` | `debrief` string set | narrative §3.4 — *"The only breathing room the brigade gets in this war, and it was spent going forward."* | live |

**Row count this mission: 10 live, 0 schema, 2 engine.**

### 1.7 Mission IV — `wadi_halam_4_village` — flags

| flag | kind | fiction |
|---|---|---|
| `take_village` | primary, `capture(village, 20)` | the smaller half of the mission |
| `kill_cache_guard` | primary, `eliminate_hvt(wh_hvt_cache)` | Hallaq's quartermaster, already named in the shipped text this pass |
| **[C]** `evac_families` | **primary** (was secondary), `evacuate_before(refuge, 3, 300)` | the atrocity shown: four families, one word |
| `the_technicals_at_the_south_hide_run_for_the_village` (was `reserve_commits`) | `first_contact` → `commit reserve → village_center` | IV's only trigger, and IV has no waves at all |

### 1.8 Mission IV — ECA rows

IV has **no `enemy.waves`** — a fixed problem with a deadline, and the
deadline is the families.

| Event Name | IF | THEN | narrative cue bound | status |
|---|---|---|---|---|
| The brief plays | mission start | `briefing` (unchanged; *re-brief n*) | narrative §4.2 | live |
| Village held 20s | `objective(take_village, complete)` | `objectives[].say` | net: *"Village is held. Four houses, four cells, and none of them left it."* — flat, because this is the smaller half | live |
| Cache guard killed/taken | `objective(kill_cache_guard, complete)` | `objectives[].say` | idit: *"That is not a fighter, that is a book-keeper with a launcher... names the depot east of here..."* | live |
| **[C]** Families out in time | `objective(evac_families, complete)` @≤300s | `objectives[].say`; **now a primary**, so completing it is required for victory | shai: *"Every one of them is at the refuge."* — thirty-four characters, the most important line in the game | live |
| **[C]** Families NOT out in time | `objective(evac_families, failed)` @300s | `objectives[].say_on_fail`; **now loses the mission** (already reached `failed` today, but `primary: false` meant `checkEnd` never read it) | idit: *"Nine did not come in at First Light. Somebody has to keep saying the number, and it is not going to be you."* | live |
| A family reaches the refuge | `evacuated` event | nothing spoken | Act I's G-B, still open — and this is the mission it costs the most | engine |
| ROE deduction — fire into `mosque_block` | `nearMiss`/`fire`, `collateral_risk ≥ 0.3`, player shooter | ROE −5 per hit (5 of IV's 23 lost points) | hard-coded `roeNotice`; proposed radio line needs a sim-watching trigger | live (mechanism) / engine (line) |
| Reserve commits | `first_contact` → renamed trigger | `commit reserve → village_center`; `triggers[].say` | net: *"Two technicals off the south hide, running for the village centre."* | live |
| Last garrisoned house falls | `SimEvent destroyed` on the last cell | proposed radio line | needs a sim-watching trigger (G8/G-E) | engine |
| Mission ends | `missionEnd(any)` | `debrief` string set | narrative §4.4 — *"A garrisoned house comes down or it stays garrisoned... What it was for is on the order."* | live |

**Row count this mission: 8 live, 0 schema, 2 engine.**

### 1.9 Mission V — `wadi_halam_5_depot` — flags

| flag | kind | fiction |
|---|---|---|
| `raze_depot` | primary, `raze(depot, 300)` | **already fails and already loses** — the model the other four should copy |
| `kill_gate_rpg` | primary, `eliminate_hvt(wh_gate_rpg)` | Jubran Hallaq, unnamed in the objective list on purpose |
| `hold_depot` | primary, `hold_for(depot, 240)` | the rubble held once it is down |
| `no_bleed` | secondary, `survive_until(300)` — cannot fail | patrol-endurance floor |
| `the_motorcycles_come_down_on_the_column` (was `harass_commits`) | `first_contact` → `commit harass → depot_gate` | Hallaq's one line in the whole act rides on this trigger |

### 1.10 Mission V — ECA rows

| Event Name | IF | THEN | narrative cue bound | status |
|---|---|---|---|---|
| The brief plays | mission start | `briefing` — **already carries** "Hallaq's depot" (§0) | narrative §5.2 | live |
| No dispatch | mission start | none | the act's dispatch belongs to I | live (as an absence) |
| Depot razed in time | `objective(raze_depot, complete)` @≤300s | `objectives[].say` | idit: *"Seven buildings... The charges under Beit Sahwan came up this road. So did the rockets that fell on the north..."* — the line that closes all three acts | live |
| Depot NOT razed | `objective(raze_depot, failed)` @300s | `objectives[].say_on_fail`; **already loses the mission today** | shai: *"Five minutes, and the depot is standing..."* | live |
| Gate held by Hallaq killed/taken | `objective(kill_gate_rpg, complete)` | `objectives[].say` | shai: *"That is Jubran Hallaq, in his own gateway... he would not walk twenty tiles east to leave it."* — the villain's end, flat | live |
| Rubble held 4 min | `objective(hold_depot, complete)` @240s | `objectives[].say` | net: *"Depot ground held, four minutes. Nothing came back onto it."* | live |
| Screened 5 min | `objective(no_bleed, complete)` @300s | toast only, deliberately no `say` — a fourth voice in the busiest mission in the act is chatter | shipped, unchanged | live |
| Motorcycles come down on the column | `first_contact` → renamed trigger | `commit harass → depot_gate`; `triggers[].say` | **enemy** (Hallaq's one line): *"Everything that ever crossed this basin crossed it on that road..."* | live |
| Hallaq's portrait, on his one line | same trigger | `.rl-cmd__face` shows `jubran_hallaq.png` | `speakerPortrait` resolves only `shai`/`idit`; `speakerPlate` returns the literal `ENEMY` (G18/G-F) | engine |
| Wave @45s (1 `technical` + 1 `moto_rpg` from `rif_south`) | clock | toast | none proposed | live |
| Wave @100s (1 `technical` + 2 `moto_rpg` from `rif_east`) | clock | toast | none proposed | live |
| Wave @160s (1 `technical` + 3 `moto_rpg` from `rif_south`) | clock | toast | proposed radio line — a wave cannot speak | live (wave) / engine (line) |
| Wave @220s (1 `technical` + 2 `moto_rpg` from `rif_south`) | clock | toast | none proposed | live |
| A house comes down beside the D9, unordered | `stepDemolition`'s auto-search | hard-coded `roe` copy; nothing names the building or the D9 | proposed radio line needs a sim-watching trigger | live (mechanism) / engine (line) |
| Mission ends | `missionEnd(any)` | `debrief` string set (§8a) | narrative §5.5 — *"Nineteen points of this depot is the order itself..."* | live |
| Mission ends (victory) | `missionEnd(victory)` | `aftermath` string set (§8a, **both variants**) | narrative §5.6 — the campaign's closing line | live |

**Row count this mission: 15 live, 0 schema, 1 engine.**

**Row counts by status, §1's five ECA tables (counted by script, not by eye —
a row whose status reads `live (wave) / engine (line)` or `live (mechanism) /
engine (line)` is tallied under `live`, since the mechanism itself already
ships and only its proposed spoken line is blocked; the parenthetical says
which):**

| mission | live | schema | engine | total |
|---|---|---|---|---|
| I (§1.2) | 12 | 0 | 2 | 14 |
| II (§1.4) | 12 | 0 | 1 | 13 |
| III (§1.6) | 10 | 0 | 2 | 12 |
| IV (§1.8) | 8 | 0 | 2 | 10 |
| V (§1.10) | 15 | 0 | 1 | 16 |
| **total** | **57** | **0** | **8** | **65** |

Zero `schema`-status rows anywhere in the town's ECA tables: every mechanism
Option C uses is already live, and every `engine` row is blocked on narrative
surface (§7), never on a missing field.

---

## 2. The new failable primaries (Option C)

Only `raze`, `collapse` and `evacuate_before` can reach `failed`
(`packages/sim/src/mission.ts`: `checkEnd`'s `failedPrimary` reads exactly
these three types). `wadi_halam_basin` declares no `tunnels` key at all
(verified by parsing the map this session), so `collapse` is unavailable for
the whole town — the two shapes available are `raze` and `evacuate_before`,
and that is why three of the four new primaries are the same type
(design §10 O-H's escalation of *whose fault it is*: at the fords they are
Hallaq's victims, on the cattle track they are in the way of a raid the
player chose to run, in the village they are in houses he is clearing).

### 2.1 I — `get_the_carriers_out`

```json
{
  "id": "get_the_carriers_out",
  "type": "evacuate_before",
  "primary": true,
  "target": "refuge",
  "count": 3,
  "seconds": 300,
  "text": "Get three carriers off the south ford to the refuge"
}
```

- **Zone:** `refuge [19,34,8,6]` — already declared on `wadi_halam_basin.json`
  and already used by IV. **Refuge marker:** `civ_refuge [22,36]` — already
  inside that rect (verified: `19 ≤ 22 < 27` and `34 ≤ 36 < 40`), so the
  `MissionRuntime.start()` refuge-in-zone guard passes with no map edit.
- **The `civilians` group** (new to this mission — I ships none today): four
  carriers, two groups of two, `[13.5,30.5]` and `[16.5,33.5]` — chosen so the
  spread-out bodies (`SPREAD` = 1.25 tiles) land on tiles `(13,30)`/`(14,30)`
  and `(16,33)`/`(17,33)`, all verified open (`.`) on the shipped grid, and so
  a screen unit standing near the design's own amended waypoints (`[15,31]`,
  `[17,34]`) sits within the 4-tile `SHEPHERD_RADIUS_SQ` of both groups at
  once.
- **Passive control's loss:** measured by the design (§7): the shipped
  mission returns **ONGOING at the 20-minute cap** with `picture` **and**
  `screen_out` already complete — three waves attack-move into the player's
  screen and identify themselves for him. With this objective added, nothing
  else on the map can end a passive run: it returns **DEFEAT at 5.0 min**,
  `get_the_carriers_out=failed`.
- **What the shipped plan needs:** the only mission whose plan changes.
  Design's own measurement: **+0.6 min, 0 survivors lost** — see §9 for the
  exact order delta. Confirmed by this document's own reading of the plan
  (`tools/src/backtest/playtest.ts`'s `wh1`): its screen orders never come
  within four tiles of either carrier group, so the unamended plan fails this
  objective exactly as the design measured.

### 2.2 II — `burn_store`

```json
{
  "id": "burn_store",
  "type": "raze",
  "primary": true,
  "target": "pasture",
  "seconds": 300,
  "text": "Burn the forward store at the pump house inside five minutes"
}
```

- **Zone:** `pasture [13,14,11,20]` — already declared and already used by
  `hold_pasture`. Verified against the map's own character grid: zero
  pre-existing structure symbols inside that rect, so the one structure this
  mission raises is the entire snapshot `raze` takes at `start()` — no risk
  of an accidental second target or an empty-set throw.
- **The structure** (new to II — `structures[]`, raised by
  `MissionRuntime.start()` before any placement spawns): one `shanty` at
  `[16,19]`, default `size: [2,2]`, footprint tiles `(16,19) (17,19) (16,20)
  (17,20)` — all verified open on the grid and clear of every existing
  structure. Its south-east corner tile `(17,20)` coincides with the
  `pump_house` marker, which is deliberate and not a collision: `pump_house`
  is a bare coordinate with no building behind it today, and T10 is exactly
  *"the pump house is the cache"* — the shed gives that marker a body for the
  first time.
- **The garrison:** one `militia_cell` at `[16.5,18.5]` (open ground one tile
  north of the footprint), `facing_deg: 180`, `stance: {"kind": "garrison",
  "building": [16,19]}` — the unit spawns outside and walks in on the first
  ticks, exactly as `stance: garrison` already works in IV.
- **Passive control's loss:** design measured **ONGOING at 20.0 min** —
  `hold_pasture` never even starts (the force spawns at x2–4, `pasture`
  begins at x13). With `burn_store` added: **DEFEAT at 5.0 min**,
  `burn_store=failed`.
- **What the shipped plan needs: nothing.** Design's measurement:
  **VICTORY 5.7 min, ROE 98, roster out 8** against 5.6/100/8 shipped — the
  two ROE points are the shanty. The shipped plan's own anchor order
  (`attackMove` the whole force to `[18,21]` on a 45-second repeat) already
  keeps a firing line on the pump-house corner, which brings the new shed's
  HP down over the course of the mission with no amendment.

### 2.3 III — `get_the_herders_out`

```json
{
  "id": "get_the_herders_out",
  "type": "evacuate_before",
  "primary": true,
  "target": "refuge",
  "count": 3,
  "seconds": 300,
  "text": "Get three herders off the cattle track to the refuge"
}
```

- **Zone/marker:** the same `refuge`/`civ_refuge` pair I reuses — no new map
  content.
- **The `civilians` group:** four herders, two groups of two, at the design's
  own measured coordinates `[20.5,32.5]` and `[23.5,33.5]` — verified open
  (`1` bund and `n` terrace respectively, neither blocking) and deliberately
  sitting beside the second `moto_rpg` patrol's own waypoint pair
  (`[20.5,29.5]`→`[20.5,32.5]`), which is the point: the cattle track is
  patrolled ground.
- **The design considered and rejected a `raze(north_hide, 300)` alternative**
  (a raised garrisoned shanty at `[23,10]`): it measured VICTORY at the same
  5.6 min and ROE 98, but the chase pair (jeep + APC, the same pair that runs
  the commander down) has to linger at the north hide while the counter-raid
  lands, costing **four of the mission's six survivors**, and III's survivors
  price IV and V through `from_ledger`. The herd variant costs none. This
  document follows the design's recommendation and does not carry the raze
  variant into §8's fragments.
- **Passive control's loss:** design measured **ONGOING at 20.0 min** —
  `hold_bunds` never starts (start line x7–9, `pasture` begins x13);
  `kill_amir` cannot fail on its own. With `get_the_herders_out` added:
  **DEFEAT at 5.0 min**, `get_the_herders_out=failed`.
- **What the shipped plan needs: nothing.** Design's measurement:
  **VICTORY 5.9 min, ROE 100, roster out 6** (thin recon — no
  `intel.marked_positions` carried in) or **5.2 min** with `wh_hide_south`
  marked in I, because a pre-marked ambusher spawns identified and forfeits
  its ambush. §9 records this as the town's one real carry-over test, not as
  a plan change.

### 2.4 IV — `evac_families` → `"primary": true`

**One word.** The objective, its target, its `count: 3`, its `seconds: 300`
and its `civilians` block all ship today; only the boolean moves.

```json
{ "id": "evac_families", "primary": true }
```

- **No new zone, marker, civilian, or structure.** Everything else about the
  objective is byte-identical to the shipped file.
- **Passive control's loss:** design measured **ONGOING at 20.0 min**, and
  `evac_families` **already reaches `failed` at 300s today** — `checkEnd`
  simply never reads a non-primary objective's status. Flipping the boolean
  alone: **DEFEAT at 5.0 min**.
- **What the shipped plan needs: nothing.** Design's measurement: shipped
  plan **VICTORY 6.1 min, ROE 77, roster out 7 — byte-identical** to the
  unpatched baseline, because the shipped plan already evacuates all four
  families inside the clock (its IFV shepherd circuit visits every civilian
  group before the 300s deadline). This is the cheapest correct change
  anywhere in Act III and is independent of whether the lead takes the rest
  of Option C (design §10 O-C).

**Confirming the design's own summary claim** (§4.1): of the four new/changed
primaries, **only I's plan needs amending**, and by one order (a jeep
detour), for **+0.6 minutes and 0 survivors**. This document's own reading of
the shipped orders in `playtest.ts` agrees: II, III and IV's shipped attack
patterns already pass within the new objectives' geometry and clock without
any change.

---

## 3. Ledger fixes

Three `requires`/`produces` lines, matching the design's own "~12 strings, 3
ledger lines" cost estimate for Option C (design §1):

| # | mission | line | why |
|---|---|---|---|
| 1 | II | add `intel.marked_positions` to **both** `ledger.requires` and `ledger.produces` | design §5.2 / §10 G-B: the green-basin spec says II should declare this and the shipped file does not, and the omission is not cosmetic — `tools/src/backtest/playtest.ts` chains each mission on the *produced* ledger of the one before, so II silently drops I's tags today and every III measurement in the harness has been running against an empty marked list since the town shipped. `main.ts`'s `{...ledger, ...me.ledger}` merge means the **shipped game does not have this bug** — only the harness does — so declaring the key makes the two agree. The existing `wh_aa_east` tag on II's `gun_truck` garrison already satisfies `validate_data.mjs`'s "declares intel but tags nothing" rule; no new tag is needed. |
| 2 | I | add `civ.settlements_evacuated` to `ledger.produces` | Option C gives I a civilian evacuation for the first time; the design's own mission-ladder table (§4) marks I's produces column `R M C I` **+ E** under C. |
| 3 | III | add `civ.settlements_evacuated` to `ledger.produces` | same reason — III's ladder entry is `R M C I` **+ E** under C. |

**IV and V are deliberately left alone**, per design §10 O-F: IV's `requires`
could aspirationally add `intel.marked_positions`, but no tag in IV or V is
produced by any earlier mission, so the declaration would be aspiration
rather than a contract. IV already produces `civ.settlements_evacuated`
today (shipped), so nothing changes there.

---

## 4. AI director

The Rif doctrine as authored, town-wide: **mobility as armour.** Two placed
patterns recur and both are already live in the shipped files —

- **II's four waves come from three different compass markers** (`rif_north`,
  `rif_south` ×2, `rif_east`) on a 60/150/240/330-second clock, all into one
  `raiders` group, and **break off together at 60% casualties**
  (`casualties_pct(60)` → `withdraw_to rif_east`).
- **III's lieutenant runs at 40% casualties** (`casualties_pct(40)` →
  `withdraw_to rif_east`, group `amir`) — the same doctrine applied to a
  single named body rather than a raiding party.

### 4.1 I — `wadi_halam_1_fords`

| tag/group | unit | count | at/marker | stance |
|---|---|---|---|---|
| `wh_gallery_north` | `moto_rpg` | 1 | `[9.5,13.5]` | `ambush(4)` |
| `wh_gallery_south` | `moto_rpg` | 1 | `[9.5,31.5]` | `ambush(4)` |
| `wh_bank_patrol`, group `bank` | `technical` ×2 (separate placements) | 1 each | `[20.5,16.5]`, `[20.5,26.5]` | `patrol`, short north–south legs |
| `wh_bund_cell` | `militia_cell` | 1 | `[18.5,20.5]` | — |
| `wh_hide_south` | `militia_cell` | 1 | `[21.5,35.5]` | `ambush(3)` |
| **[C]** carrier group A | `civilians` | 2 | `[13.5,30.5]` | shelter-in-place |
| **[C]** carrier group B | `civilians` | 2 | `[16.5,33.5]` | shelter-in-place |

**Cadence:**

| t (s) | mechanism | size | from | to | group |
|---|---|---|---|---|---|
| 0 | garrison ×6 | 1 each | (see above) | — | — |
| 0 | **[C]** civilians ×2 groups | 2 each | — | — | — |
| — | trigger (`zone_entered(ford_watch)`) | — | `bank` | `ford_north` | `bank` |
| 90 | wave | 2 `moto_rpg` | `rif_south` | `ford_south` | — |
| 210 | wave | 2 `moto_rpg` | `rif_east` | `ford_north` | — |
| 225 | wave | 1 `technical` + 1 `moto_rpg` | `rif_south` | `ford_south` | — |

**Pressure curve.** Nothing comes for a minute and a half, then something
comes every fifteen seconds for the last two — the shipped cadence is a slow
build to a compressed finish, timed against `take_ford`'s own 240-second
clock so the hold is hardest exactly as it completes. **[C]** overlays a
second, independent clock underneath it: the carriers' 300-second deadline
runs from t=0 regardless of contact, so a plan that spends its first two
minutes purely on the picture and the screen is racing a clock it cannot see
the enemy trigger.

### 4.2 II — `wadi_halam_2_laager`

| tag/group | unit | count | at/marker | stance |
|---|---|---|---|---|
| `wh_aa_east`, group `raiders` (initial) | `gun_truck` | 1 | `[44.5,20.5]` | `hold_position` |
| **[C]** shed garrison | `militia_cell` | 1 | `[16.5,18.5]` | `garrison`, building `[16,19]` |

**Structure:** **[C]** one `shanty`, `at [16,19] size [2,2]`.

**Cadence:**

| t (s) | mechanism | size | from | to | group |
|---|---|---|---|---|---|
| 0 | garrison ×1 (+**[C]** ×1) | 1 each | (see above) | — | `raiders` (gun truck only) |
| 0 | **[C]** structure | — | — | `shanty` at `[16,19]` | — |
| 60 | trigger `spawn` | 2 `technical` | `rif_north` | patrol → `[17.5,20.5]` | `raiders` |
| 150 | trigger `spawn` | 2 `moto_rpg` + 1 `technical` | `rif_south` | patrol → `[17.5,20.5]` | `raiders` |
| 240 | trigger `spawn` | 2 `technical` | `rif_east` | patrol → `[17.5,20.5]` | `raiders` |
| 330 | trigger `spawn` | 3 `moto_rpg` | `rif_south` | patrol → `[17.5,20.5]` | `raiders` |
| ~ (60% dead) | trigger `withdraw_to` | — | `raiders` | `rif_east` | `raiders` |

**Pressure curve.** A wave every ninety seconds from a different compass
point, and at 60% losses they all break off at once — the Rif thesis stated
in one mission. **[C]** does not change the cadence at all: the shed sits
inside the same ground the raiders are already patrolling toward, so
`burn_store`'s clock is paid for by the fight the mission already schedules,
not by a new one.

### 4.3 III — `wadi_halam_3_counterraid`

| tag/group | unit | count | at/marker | stance |
|---|---|---|---|---|
| `wh_hvt_amir`, group `amir` | `technical` carrying `militia_cell` (passenger) | 1 | `hide_north` | `hold_position` |
| `wh_hide_south` | `militia_cell` | 1 | `[21.5,38.5]` | `ambush(3)` |
| `wh_hide_south` | `rpg_team` | 1 | `[23.5,38.5]` | `ambush(3)` |
| — | `moto_rpg` ×2 (separate placements) | 1 each | `[20.5,16.5]`, `[20.5,29.5]` | `patrol`, short legs toward `[20.5,19.5]`/`[20.5,32.5]` |
| **[C]** herder group A | `civilians` | 2 | `[20.5,32.5]` | shelter-in-place |
| **[C]** herder group B | `civilians` | 2 | `[23.5,33.5]` | shelter-in-place |

**Cadence:**

| t (s) | mechanism | size | from | to | group |
|---|---|---|---|---|---|
| 0 | garrison ×4 | 1 each | (see above) | — | — |
| 0 | **[C]** civilians ×2 groups | 2 each | — | — | — |
| 90 | wave | 2 `technical` | `rif_east` | `pump_house` | — |
| 200 | wave | 2 `moto_rpg` + 1 `technical` | `rif_south` | `pump_house` | — |
| ~ (40% dead) | trigger `withdraw_to` | — | `amir` | `rif_east` | `amir` |

**Pressure curve.** Speed against mass: the commander has to be reached
before 40% of the garrison is dead, and the bunds have to hold five minutes
against two counter-raid waves landing on the pump house at the same time.
**[C]**'s herd sits directly on the second `moto_rpg`'s patrol leg, so the
evacuation and the counter-raid pressure the same ground rather than
competing for the player's attention on two fronts.

### 4.4 IV — `wadi_halam_4_village`

| tag/group | unit | count | at/marker | stance |
|---|---|---|---|---|
| `wh_cell_nw` | `militia_cell` | 1 | `[26.5,19.5]` | `garrison`, building `[26,17]` |
| `wh_cell_ne` | `militia_cell` | 1 | `[31.5,19.5]` | `garrison`, building `[31,17]` |
| `wh_cell_sw` | `militia_cell` | 1 | `[26.5,30.5]` | `garrison`, building `[26,28]` |
| `wh_hvt_cache` | `rpg_team` | 1 | `[31.5,30.5]` | `garrison`, building `[31,28]` |
| `wh_village_reserve`, group `reserve` | `technical` | 2 | `hide_south` | `hold_position` |
| civilians (unchanged) | `civilians` | 2+1+1 | `[28.5,20.5]`, `[29.5,28.5]`, `[25.5,23.5]` | shelter-in-place |

**Cadence:** IV is the only Wadi Halam mission with **no reinforcement
clock**. One trigger only: `first_contact` → `commit reserve →
village_center`.

**Pressure curve.** A fixed problem with a deadline, and the deadline is the
families: four garrisoned houses, each of which must come down by gunfire
(a garrisoned unit cannot be shot directly), against a single 300-second
evacuation clock and a protected block sitting between the north and south
clusters. Option C's one-word change adds no pressure at all — it only makes
the clock the mission already runs able to end the mission on its own.

### 4.5 V — `wadi_halam_5_depot`

| tag/group | unit | count | at/marker | stance |
|---|---|---|---|---|
| `wh_gate_rpg` | `rpg_team` | 1 | `depot_gate` | `ambush(3)` |
| `wh_depot_gun_truck` | `gun_truck` | 1 | `[39,20]` | `hold_position` |
| `wh_depot_interior_ne` | `gun_truck` | 1 | `[41,20]` | `hold_position` |
| `wh_depot_interior_se` | `gun_truck` | 1 | `[41,27]` | `hold_position` |
| `wh_depot_interior_center` | `rpg_team` | 1 | `[38,24]` | `ambush(3)` |
| `wh_harass_east`, group `harass` | `moto_rpg` | 3 | `[44,20]` | `hold_position` |

**Cadence:**

| t (s) | mechanism | size | from | to | group |
|---|---|---|---|---|---|
| 0 | garrison ×6 | 1/1/1/1/1/3 | (see above) | — | — |
| — | trigger `first_contact` | — | `harass` | `depot_gate` | `harass` |
| 45 | wave | 1 `technical` + 1 `moto_rpg` | `rif_south` | `depot_gate` | — |
| 100 | wave | 1 `technical` + 2 `moto_rpg` | `rif_east` | `depot_gate` | — |
| 160 | wave | 1 `technical` + 3 `moto_rpg` | `rif_south` | `depot_gate` | — |
| 220 | wave | 1 `technical` + 2 `moto_rpg` | `rif_south` | `depot_gate` | — |

**Pressure curve.** Something arrives at the gate every minute for the first
four minutes, escalating 1+1 → 1+2 → 1+3 → 1+2, and then the player holds the
rubble for four more — unchanged by anything in this document. The one
addition (`roe.flagged_zones: ["mosque_block"]`, §5.5 below) does not touch
troop movement, targeting, or timing; design measured its effect on the
shipped plan as **none** (the southern route never fires into that block).

---

## 5. Map requirements

**`wadi_halam_basin.json` needs no new marker or zone for Option C.** Every
placement, objective and wave above resolves against the map's own twelve
markers and seven zones, checked directly against the shipped grid this
session (48×48, no `elevation`, no `tunnels`):

| kind | id | tile / rect | purpose | exists today |
|---|---|---|---|---|
| marker | `kdf_crossing` | `[3,24]` | player start reference | **EXISTS** |
| marker | `ford_north` | `[10,15]` | I wave `to` | **EXISTS** |
| marker | `ford_south` | `[10,32]` | I wave `to` | **EXISTS** |
| marker | `pump_house` | `[17,20]` | III wave `to`; now sits inside **[C]**'s raised shanty footprint | **EXISTS** |
| marker | `hide_north` | `[22,9]` | III `amir` placement marker | **EXISTS** |
| marker | `hide_south` | `[22,38]` | IV reserve placement marker | **EXISTS** |
| marker | `village_center` | `[29,26]` | IV `commit` destination | **EXISTS** |
| marker | `depot_gate` | `[34,24]` | V garrison marker and every V wave `to` | **EXISTS** |
| marker | `rif_north` | `[44,9]` | II wave `from` | **EXISTS** |
| marker | `rif_east` | `[44,24]` | I/II/III/V wave `from`; II/III `withdraw_to` | **EXISTS** |
| marker | `rif_south` | `[44,39]` | I/II/III/V wave `from` | **EXISTS** |
| marker | `civ_refuge` | `[22,36]` | **[C]** I/III `civilians.refuge`; IV (shipped) | **EXISTS**, verified inside `refuge` |
| zone | `ford_watch` | `[7,12,6,24]` | I `hold_for` + `zone_entered`, II `capture` | **EXISTS** |
| zone | `pasture` | `[13,14,11,20]` | II `hold_for` + **[C]** `raze`; III `hold_for`; contains **[C]**'s shanty at `(16,19)` | **EXISTS** |
| zone | `village` | `[25,15,9,18]` | IV `capture` | **EXISTS** |
| zone | `mosque_block` | `[28,22,4,4]` | IV `roe.flagged_zones`; **[C]/§5.5** V `roe.flagged_zones` | **EXISTS** |
| zone | `depot` | `[35,17,7,14]` | V `raze`, V `hold_for` | **EXISTS** |
| zone | `refuge` | `[19,34,8,6]` | **[C]** I/III `evacuate_before`; IV (shipped); contains `civ_refuge` | **EXISTS** |
| zone | `east_road` | `[42,22,6,4]` | authored, used by no mission today | **EXISTS**, see T13 §6 |

**Nothing here is off-grid or on a building.** Every placement coordinate
introduced by this document (§4's civilian groups, §2.2's shanty and its
garrison) was checked tile-by-tile against the map's own `rows` this session
and confirmed open (`.`, `1` hedgerow, `n` terrace — none blocking, none an
existing structure).

---

## 6. Twists — T9 to T13

Carried forward from `narrative.md` §8 and re-classified here against the
live vocabulary; the lines are the narrative sheet's, the classification and
mechanism are this document's to confirm.

| # | mission | twist | classification | mechanism / fallback |
|---|---|---|---|---|
| **T9** | I | *The riders are carrying.* One dispersing `moto_rpg` carries civilians, not fighters; killing it is the mission's ROE cliff | **engine (G16/G-I)** | `embarkPassengers(id, p.passengers, side)` gives a passenger the **carrier's** side — a civilian riding an enemy `moto_rpg` spawns on side 1, never enters `civIds`, and costs nothing to kill. `passengers` is otherwise live and schema-legal (`civilians`' role `support` is in `FOOT_ROLES`), so this is the one twist where the schema shape exists and the runtime silently defeats the fiction. Smallest fix: a `side` override on a nested passenger placement, or `civilians.groups[].mounted_in: <tag>`. No civilian-side fallback exists for this one — the twist is entirely about who dies, and there is no way to author a civilian who dies *inside an enemy vehicle* without this |
| **T10** | II | *The pump house is the cache.* What the player holds is what Hallaq wants back, and he says so | **expressible today, and Option C already builds it** | Under Option C: the shed is a `structures[]` entry inside the shipped `pasture` zone and `raze(pasture, 300)` (as `burn_store`) is a primary — a garrisoned house, not a line. Under Option A it degrades to a `say` on `hold_pasture` alone and stays true, just weaker |
| **T11** | III | *He is worth more talking.* `wh_hvt_amir` routs rather than dies and can be taken | **expressible today, with a caveat — do not build the literal version** | `capture` is live and does not require its target alive (`mission.ts`'s `capture` branch reads only `livingIn(z,0)` and `contestedIn(z)`), so a `capture` zone at `rif_east` would complete whether the commander is standing in it or lying dead in it — the "taken alive" reading would be entirely cosmetic. **Recommendation, followed in §8: keep the shipped `eliminate_hvt` and let the objective label do the work** (*"Kill or capture Hallaq's local commander"*, already applied). Real "must be captured alive" needs G6 |
| **T12** | IV | *The cache guard is one of ours.* A KDF soldier taken at First Light, left holding Hallaq's cache | **engine (G6/G-J) for its real form; a civilian fallback is expressible today, measured working, and NOT part of this document's Option C fragments** | **What the fallback would be, precisely** (design §1 Option B, re-stated here because the task asks): swap `wh_hvt_cache` from an `rpg_team` to an ordinary `militia_cell` garrison; add a `civilians` group of **one** at `[33.5,30.5]` carrying a tag; add an additive zone `cache_house [30,27,4,4]` (new — not in §5's table, because it is not part of the Option C baseline); replace `kill_cache_guard` (`eliminate_hvt`) with `capture(cache_house, 15)`; raise `evac_families` to `count: 4`. Design measured this end-to-end: shipped plan **VICTORY 6.3 min, ROE 77, roster out 7**; no-orders control **DEFEAT 5.0 min**. **What it cannot do**: a civilian is untargetable by either side and hurt only by ordnance, so the player *cannot shoot him* — the cruelty becomes "the autocannon that clears the house kills him," which is Beit Sahwan III's lesson repeated rather than a new one; and `evacuate_before` cannot name a group (G17/G-K), so the objective can only require a *count*, never *that one person specifically* — the tag rides along and is read by nothing. **Sequencing**: take Option C now; T12's real form is Option B, to be added *after* G6 lands, and it slots into IV without touching anything Option C did (Option C's IV change is one word; T12's fallback changes three fields) |
| **T13** | V | *The corridor runs both ways.* A wave arrives from the west, out of ground the player already took | **expressible today, and the map is already set up for it — not part of Option C, a level-scripter proposal** | `zone_entered(east_road)` → `spawn` at `ford_south` or `pump_house` (never `kdf_crossing`, which is occupied at `start()` and must clear `assertGroundClear`). `east_road [42,22,6,4]` is authored and used by no mission today (§5) — the free condition. Fragment sketched in §8b; **not adopted without a `playtest` re-run**, since it adds a wave to the town's tightest-paced mission |

---

## 7. Gap report

Narrowed to what Act III's ending and its busiest narrative surfaces need —
the full inventories are `design.md` §9 and `narrative.md` §10 and are not
repeated here.

| # | gap | cites | smallest proposal | owner | Act III impact |
|---|---|---|---|---|---|
| **G11 / G-C** | **`debrief` is one string on every mission end**, where `aftermath` shows on victory only (`ui/hud.ts:555`) — so the campaign's closing screen cannot tell a win from a loss. Verified: `ui/menu.ts:387` prints one `debrief` regardless of `missionEnd.result` | design §9, narrative §10 | `debrief_victory` / `debrief_defeat` (or `debrief: {victory, defeat}`), read by `showEndScreen` off `missionEnd.result` | `sim-guard` (schema) + `render-vfx` (`ui/menu.ts`) | **The ending itself, §5.6/§8a.** Both `aftermath` variants close the war, but the `debrief` beneath them — the one that has to read honestly on a defeat too — cannot yet be two sentences. Ten paired win/lose lines across the five missions' ECA tables above are `engine` for this reason alone |
| **G18 / G-F** | **A villain portrait has no surface.** `assets/ui/portraits/jubran_hallaq.png` ships (58.2 KiB, verified present); `speakerPortrait` (`ui/hud-model.ts:221`) resolves only `shai`/`idit`, and `speakerPlate` returns the literal string `ENEMY` | design §9, narrative §10 | a `villains` map in `commander.json` keyed by front or mission, and one branch each in `speakerPlate`/`speakerPortrait`. The `enemy` speaker enum value already exists in `$defs.say` | `mission-author` (data) + `render-vfx` (`hud-model.ts`) | Hallaq's one line in the whole act (`the_motorcycles_come_down_on_the_column.say`, V) lands as `— <text>` beside a hatch labelled `ENEMY` instead of his face. Cheapest unrealised story surface in the tree |
| **G12 / G-D** | **A wave cannot speak.** The wave item is `{at_seconds, trigger, to, units}` (schema, grepped this session) — `say` landed on `triggers[]` and `objectives[]` in the 2026-09-03 slice and not on waves | design §9, narrative §10 | `say?: {speaker, text}` on the wave item, emitted with the existing `wave` `MissionEvent` | `sim-guard` | Wadi Halam is **the wave town** — nine `enemy.waves` entries across I, III and V, plus four `spawn` triggers in II that already carry `say` (only one of which this document uses, §1.4). Six rows across §1's ECA tables are `engine` for this reason alone, and reinforcements arriving is the single most legible thing that happens in three of the five missions |
| **G8 / G-E** | **A trigger cannot fire on an objective or on a `SimEvent`.** `on.kind` is exactly `first_contact \| casualties_pct \| timer_s \| zone_entered` (grepped from `mission.ts`'s `stepTriggers`) | design §9, narrative §10 | two new `on.kind`s: `objective` (an objective id) and `sim` (one of the 24 `SimEvent` kinds); the tutorial's `await` predicate already gates on every `SimEvent`, so the pattern is proven elsewhere in the tree | `sim-guard` | Every reaction in the town is on a clock or a casualty percentage because there is no "the depot is down," "the families are out," or "the drone just died" condition. Five rows across §1 are `engine` for it — the bait line in V ("that house came down beside him and nobody ordered it") is the one this blocks hardest, because it needs to fire at the moment of a specific unordered demolition, which only a `SimEvent`-watching trigger can see |

---

## 8. Copy-ready fragments

### 8a. Expressible today — for `mission-author` to assemble

All field names below are grepped against `mission.schema.json` this session.
Every `say`/`say_on_fail`/`dispatch`/`aftermath`/`debrief` string is ≤ 240
characters (measured; longest is V's `raze_depot.say` at 203 and Option 1's
`aftermath` at 234). Every speaker is one of `shai | idit | net | enemy`.

#### Mission I — `wadi_halam_1_fords.json`

Top-level additions:

```json
{
  "dispatch": "The corridor into Naharin has carried somebody else's war for four years, and the people who live on it carry it by hand. One hamlet stopped hauling for Jubran Hallaq last spring. Nobody on that road has stopped since.",
  "debrief": "The fords are the only two crossings in forty tiles. Whatever happened tonight, the corridor still runs through them."
}
```

`civilians` block (new to this mission):

```json
{
  "civilians": {
    "refuge": "civ_refuge",
    "groups": [
      { "unit": "civilians", "count": 2, "at": [13.5, 30.5] },
      { "unit": "civilians", "count": 2, "at": [16.5, 33.5] }
    ]
  }
}
```

`objectives[]` — `say` added to two shipped entries, one new entry appended:

```json
{ "id": "picture", "say": { "speaker": "idit", "text": "Four sites and not one of them is a position. Nobody digs in on a road he means to keep using — this is a haulage route with guns parked along it." } }
```
```json
{ "id": "take_ford", "say": { "speaker": "net", "text": "Ford watch held. The column is across the wadi." } }
```
```json
{
  "id": "get_the_carriers_out",
  "type": "evacuate_before",
  "primary": true,
  "target": "refuge",
  "count": 3,
  "seconds": 300,
  "text": "Get three carriers off the south ford to the refuge",
  "say": { "speaker": "shai", "text": "Four of them off the ford and out of the corridor. They were on his road because somebody put them on it; tonight they are not." },
  "say_on_fail": { "speaker": "shai", "text": "The crossing shut with them still on it. We were eight tiles away and looking the other way." }
}
```

`triggers[]` — rename and `say` (the object's `id`/`on`/`do` are unchanged
from the shipped file):

```json
{
  "id": "the_bank_patrol_turns_for_the_ford",
  "on": { "kind": "zone_entered", "zone": "ford_watch" },
  "do": { "kind": "commit", "group": "bank", "to": "ford_north" },
  "say": { "speaker": "idit", "text": "Both bank patrols have turned for the north ford. They did not wait to be told and they will not stay to be fought." }
}
```

**Conditional — apply only in the same commit as `get_the_carriers_out`**
(the design's own rule, narrative §1.5): the amended `briefing`, 402 → 498
characters, beats 158/219/119:

```json
{ "briefing": "Naharin opens at the wadi. Two fords cross it, and the Rif who work this corridor disperse the moment they are seen — so the job tonight is to see them first. Push a screen across the tree line, build the picture, and hold the ford watch for four minutes while the column crosses behind you — riders will keep coming at the crossing out of the east the whole time you sit on it. Four of them are carrying for him at the south ford tonight and cannot get off it on their own. Do not chase what runs." }
```

Ledger fix (§3, item 2):

```json
{ "ledger": { "produces": ["roster.surviving_units", "roe.mission_ratings", "campaign.completed_missions", "intel.marked_positions", "civ.settlements_evacuated"] } }
```

#### Mission II — `wadi_halam_2_laager.json`

```json
{ "debrief": "A laager is a place that can be found. That is the trade — they know where you are, and you know they are coming." }
```

`structures[]` (new to this mission):

```json
{ "structures": [ { "type": "shanty", "at": [16, 19], "size": [2, 2] } ] }
```

`enemy.garrison[]` — one appended entry:

```json
{
  "unit": "militia_cell",
  "count": 1,
  "at": [16.5, 18.5],
  "facing_deg": 180,
  "stance": { "kind": "garrison", "building": [16, 19] }
}
```

`objectives[]`:

```json
{ "id": "hold_pasture", "say": { "speaker": "net", "text": "Five minutes of pasture, uncontested. The crossing is laid and the corridor is open behind you." } }
```
```json
{
  "id": "burn_store",
  "type": "raze",
  "primary": true,
  "target": "pasture",
  "seconds": 300,
  "text": "Burn the forward store at the pump house inside five minutes",
  "say": { "speaker": "idit", "text": "The shed was a forward store — fuel, crates, a manifest. Half of what was in it was routed on to Sur. This ground is not the end of his road; it is the middle of it." },
  "say_on_fail": { "speaker": "shai", "text": "The shed is standing and the pasture is ours. One of those was the mission." }
}
```

`triggers[]` — five renames, `say` on two:

```json
{ "id": "riders_out_of_the_north" }
```
```json
{ "id": "riders_out_of_the_south" }
```
```json
{ "id": "technicals_off_the_east_track", "say": { "speaker": "idit", "text": "Third compass point in four minutes. There is no direction this pasture is safe from, which is why they gave you a field and not a hill." } }
```
```json
{ "id": "the_last_of_the_motorcycles" }
```
```json
{ "id": "the_raiders_break_off_east", "say": { "speaker": "idit", "text": "Sixty per cent and they are breaking off east. That is not a rout — mobility is their armour, and they will be back on the same trucks inside a week." } }
```

**Conditional — same commit as `burn_store` only:** amended `briefing`, 385 →
505 characters, beats 225/159/119:

```json
{ "briefing": "Push through to the pasture and dig in while the engineers lay the crossing behind you. The ground is terraced — bunds run across the pasture in bands, real cover if you hold it, and the Rif know the ground as well as you do. Technicals and motorcycles will come at the pump house from every direction in waves. Accumulate five minutes of uncontested pasture and the corridor is yours. There is a shed on the pasture's western edge and it is his forward store — it comes down inside the same five minutes." }
```

Ledger fix (§3, item 1):

```json
{ "ledger": { "requires": ["roster.surviving_units", "intel.marked_positions"], "produces": ["roster.surviving_units", "roe.mission_ratings", "campaign.completed_missions", "intel.marked_positions"] } }
```

#### Mission III — `wadi_halam_3_counterraid.json`

```json
{ "debrief": "The only breathing room the brigade gets in this war, and it was spent going forward." }
```

`civilians` block (new to this mission):

```json
{
  "civilians": {
    "refuge": "civ_refuge",
    "groups": [
      { "unit": "civilians", "count": 2, "at": [20.5, 32.5] },
      { "unit": "civilians", "count": 2, "at": [23.5, 33.5] }
    ]
  }
}
```

`objectives[]`:

```json
{ "id": "kill_amir", "say": { "speaker": "idit", "text": "That is Hallaq's man on this ground. He does not know where the rockets went; he knows which nights the fords were clear, and that is what puts us at the depot." } }
```
```json
{ "id": "hold_bunds", "say": { "speaker": "net", "text": "Bunds held. Both counter-raids are off the pasture." } }
```
```json
{ "id": "mark_hides", "say": { "speaker": "idit", "text": "That is the hide, and I am not asking for a second one. What is left in those bunds we can read off the ground afterwards; the herd on the track cannot wait for me to be sure." } }
```
```json
{
  "id": "get_the_herders_out",
  "type": "evacuate_before",
  "primary": true,
  "target": "refuge",
  "count": 3,
  "seconds": 300,
  "text": "Get three herders off the cattle track to the refuge",
  "say": { "speaker": "net", "text": "Herd and herders are off the track and inside the refuge line." },
  "say_on_fail": { "speaker": "shai", "text": "The track is shut with them still on it. We chose to raid this ground; they only live on it." }
}
```

`triggers[]`:

```json
{ "id": "the_commander_runs_for_the_east_track", "say": { "speaker": "shai", "text": "He is running for the east track and he will not stop. Take him if the shot is there — do not take the bunds off the map to chase him." } }
```

Ledger fix (§3, item 3):

```json
{ "ledger": { "produces": ["roster.surviving_units", "roe.mission_ratings", "campaign.completed_missions", "intel.marked_positions", "civ.settlements_evacuated"] } }
```

#### Mission IV — `wadi_halam_4_village.json`

```json
{ "debrief": "A garrisoned house comes down or it stays garrisoned; there is no third way to clear one. What that costs is on the rating. What it was for is on the order." }
```

`objectives[]` — `say` on two shipped entries; `evac_families` gains `say`,
`say_on_fail`, **and the one word**:

```json
{ "id": "take_village", "say": { "speaker": "net", "text": "Village is held. Four houses, four cells, and none of them left it." } }
```
```json
{ "id": "kill_cache_guard", "say": { "speaker": "idit", "text": "That is not a fighter, that is a book-keeper with a launcher. What he was holding names the depot east of here and says how much of it is still full." } }
```
```json
{
  "id": "evac_families",
  "primary": true,
  "say": { "speaker": "shai", "text": "Every one of them is at the refuge." },
  "say_on_fail": { "speaker": "idit", "text": "The road is shut and there are still families inside it. Nine did not come in at First Light. Somebody has to keep saying the number, and it is not going to be you." }
}
```

`triggers[]`:

```json
{ "id": "the_technicals_at_the_south_hide_run_for_the_village", "say": { "speaker": "net", "text": "Two technicals off the south hide, running for the village centre." } }
```

**No ledger change** (§3 — IV is deliberately left as shipped).

#### Mission V — `wadi_halam_5_depot.json`

```json
{ "debrief": "Nineteen points of this depot is the order itself. Whatever the number below says, part of it was decided before the column moved." }
```

**`aftermath` — both variants, the recommended one first.**

Option 1 — *"Ari Actual"* (recommended by design §6.4 and narrative §5.6):

```json
{ "aftermath": "The corridor is cut. Brigade signed the file at first light, the same hour of the same day it started. They are giving you the Ari'im — all of it, not a company in a yard. Idit brings the callsign down herself: Ari Actual. Five stars." }
```

Option 2 — *"The Quiet Ground"* (take only if Naharin is the last content
anyone authors):

```json
{ "aftermath": "They took the wire down at Beit Sahwan this morning. Nobody fired a shot to make that happen; you spent a year not firing them. The slip came in the post — five stars, no ceremony — and a road you can drive at night." }
```

ROE fix (§4.5 / design §5.5 — one line, measured to cost the shipped plan
nothing):

```json
{ "roe": { "flagged_zones": ["mosque_block"] } }
```

`objectives[]`:

```json
{ "id": "raze_depot", "say": { "speaker": "idit", "text": "Seven buildings, and everything in them came through here first. The charges under Beit Sahwan came up this road. So did the rockets that fell on the north for a week before anybody could say from where." }, "say_on_fail": { "speaker": "shai", "text": "Five minutes, and the depot is standing. Whatever we brought to bring it down is not going to bring it down now." } }
```
```json
{ "id": "kill_gate_rpg", "say": { "speaker": "shai", "text": "That is Jubran Hallaq, in his own gateway. Everything that ever came up this road came up it for him, and he would not walk twenty tiles east to leave it." } }
```
```json
{ "id": "hold_depot", "say": { "speaker": "net", "text": "Depot ground held, four minutes. Nothing came back onto it." } }
```

`triggers[]`:

```json
{ "id": "the_motorcycles_come_down_on_the_column", "say": { "speaker": "enemy", "text": "Everything that ever crossed this basin crossed it on that road. The yard can be rebuilt in a season. The road was here before the yard and it will be here after it." } }
```

**No ledger change, no map edit.**

### 8b. Engine-gated — illustrative, not for assembly

Neither fragment below is part of Option C. Both are held here so
`sim-guard`'s eventual work has a concrete target rather than a description.

**If `waves[].say` existed (G12/G-D)** — V's 160s wave, the one narrative.md
proposes a line for:

```json
{
  "at_seconds": 160,
  "to": "depot_gate",
  "units": [
    { "unit": "technical", "count": 1, "from": "rif_south" },
    { "unit": "moto_rpg", "count": 3, "from": "rif_south" }
  ],
  "say": { "speaker": "idit", "text": "Escalating each time and always at the gate. Four minutes of this and then they stop counting and start arriving." }
}
```

**T13, "the corridor runs both ways" (V)** — expressible **today** without
any new `on.kind`, sketched here because §6 classifies it as a proposal, not
part of the baseline, and it needs a `playtest` re-run before adoption:

```json
{
  "id": "something_crossed_behind_the_column",
  "on": { "kind": "zone_entered", "zone": "east_road" },
  "do": { "kind": "spawn", "units": [
    { "unit": "moto_rpg", "count": 2, "marker": "ford_south", "stance": { "kind": "hold_position" } }
  ] },
  "say": { "speaker": "net", "text": "Something came across the ford behind you. That crossing has been ours since the first night and it was never ours at night." }
}
```

`ford_south` is chosen over `kdf_crossing` per §6's own caution: the player's
own start line is occupied at `start()` and `assertGroundClear` would throw
on any wave spawning there. `ford_south` and `pump_house` are both clear by
the time a V column reaches the gate.

---

## 9. Plan outlines for `mission-author`

Order tables only — no TypeScript, matching this agent's own constraint.
`tools/src/backtest/playtest.ts`'s existing plans (`wh1`–`wh4`, plus V's
inline plan) are the base; the deltas below are what `mission-author` and
`playtest` apply on top.

### 9.1 Mission I — the one plan that changes

Design's own measurement: **+0.6 min, 0 survivors**, confirmed against the
shipped plan's actual orders this session (the jeep's shipped route never
comes within four tiles of either carrier group). The delta is a three-leg
detour for the jeep alone; every other unit's order is untouched.

| t (s) | unit | order kind | target | replaces / adds |
|---|---|---|---|---|
| 0 | `jeep_shoded` | move | `[15,31]` | **replaces** the shipped `move [9,20]` — approaches carrier group A |
| 45 | `recon_drone` | move | `[20,30]` | unchanged (shipped) |
| ~60 | `jeep_shoded` | move | `[17,34]` | **new** — closes on carrier group B, within `SHEPHERD_RADIUS_SQ` (4 tiles) of both groups across the two legs |
| ~90 | `recon_drone` | move | `[21,35]` | **new** — marks `wh_hide_south`, the carry-over III spends (§2.3's 5.9→5.2 min swing) |
| 120 | `jeep_shoded` | attackMove | `[10,24]` | **new** — rejoins the ford-watch anchor loop the shipped plan already re-issues every 45s from t=130 |
| unchanged | screen (`apc_eitan`, `inf_squad`×2, `at_team`) | attackMove | `[9,15]` → `[9,31]` → `[10,24]`, re-anchored every 45s, t=130–320 | shipped, untouched |

### 9.2 Missions II, III, IV — no order changes

Confirmed by design's own measurement and by this document's reading of the
shipped plans: II's `wh2` anchor loop, III's `wh3` chase-and-hold split, and
IV's `wh4` north-to-south clearance-and-shepherd sequence all satisfy the new
primaries without amendment. **`mission-author` applies the data changes in
§8a only; `playtest` re-runs the existing plans unmodified to confirm the
victory figures in §2.**

### 9.3 Mission V — no order change

The `roe.flagged_zones` addition (§8a) and the `say`/`aftermath`/`debrief`
strings touch no sim state a plan's orders can see. The existing plan and its
existing no-orders control are both unaffected.

### 9.4 Four new `(no orders)` controls for `playtest.ts`

Design's own finding (§7): **Wadi Halam has four missions with no control in
the harness at all** — only `wadi_halam_5_depot (no orders)` exists today.
Adding the other four is what turns the passive-player defect from a claim
into a falsifiable test, mirroring the existing V control's own shape (empty
ledger, per the design's Appendix caveat 1: `from_ledger` falls back to full
authored strength regardless, so an empty ledger still proves the mission
loses).

| mission | plan | ledger | expect | label | why it must lose |
|---|---|---|---|---|---|
| `wadi_halam_1_fords` | none (no orders queued) | `{}` | `'defeat'` | `wadi_halam_1_fords (no orders)` | `get_the_carriers_out` reaches `failed` at 300s. Nothing else on the map ends a passive run — `picture` and `screen_out` both complete on their own (three waves attack-move into the idle screen), so without this objective the mission would sit `ONGOING` at the 20-minute cap |
| `wadi_halam_2_laager` | none | `{}` | `'defeat'` | `wadi_halam_2_laager (no orders)` | `burn_store` reaches `failed` at 300s. `hold_pasture` never starts (spawn at x2–4, zone begins x13), so nothing else can end it either |
| `wadi_halam_3_counterraid` | none | `{}` | `'defeat'` | `wadi_halam_3_counterraid (no orders)` | `get_the_herders_out` reaches `failed` at 300s. `hold_bunds` never starts for the same structural reason as II; `kill_amir` cannot fail on its own |
| `wadi_halam_4_village` | none | `{}` | `'defeat'` | `wadi_halam_4_village (no orders)` | `evac_families` already reaches `failed` at 300s today — the only change is that it is now a **primary**, so `checkEnd` finally reads it |

**A fifth check, not a new control:** re-run `wh3`'s existing plan twice —
once with `intel.marked_positions: ["wh_hide_south"]` in its ledger and once
with an empty list — and confirm the **5.2 vs 5.9 minute** gap design
measured. This is the town's one real carry-over test (§2.3), and if that gap
ever closes it means the two `ambush(3)` placements at the south hide have
stopped forfeiting their ambush on a pre-mark, which is a runtime regression
worth catching on its own.

---

## Verification record

- **Ajv, this session, against `mission.schema.json`** (scratch directory
  outside this repository, five files built by patching the real shipped
  JSON with exactly the deltas in §8a and §2):

  ```
  schema: wadi_halam_1_fords       PASS
  checks: wadi_halam_1_fords       PASS
  schema: wadi_halam_2_laager      PASS
  checks: wadi_halam_2_laager      PASS
  schema: wadi_halam_3_counterraid PASS
  checks: wadi_halam_3_counterraid PASS
  schema: wadi_halam_4_village     PASS
  checks: wadi_halam_4_village     PASS
  schema: wadi_halam_5_depot       PASS
  checks: wadi_halam_5_depot       PASS
  === OVERALL: PASS ===
  ```

  "checks" is a hand-written semantic pass covering: every `unit` id
  resolves under `data/units/kdf`, `data/units/enemy` or
  `data/units/civilians.json`; every trigger `zone_entered.zone`,
  `commit`/`withdraw_to`/`dismount` `group`, and `commit`/`withdraw_to` `to`
  resolves against the real map (`to` always a marker, never a zone); every
  wave `to`/`from` resolves against a marker; every `hold_for`/`capture`/
  `evacuate_before`/`raze` `target` resolves against a real zone; every
  `evacuate_before`'s refuge marker sits inside its own zone; every
  structure `type` resolves in `data/structures.json`; every trigger id is
  unique within its mission; every `say`/`say_on_fail` speaker is one of
  `shai | idit | net | enemy`; every `dispatch`/`aftermath`/`debrief`/`say`
  text is ≤ 240 characters.
- **No trigger depends on firing twice.** Every trigger above fires on
  `first_contact`, a `casualties_pct` threshold, a `timer_s` value, or
  `zone_entered` — each a one-shot condition by construction (`stepTriggers`
  latches per trigger object).
- **No wave depends on a tunnel `from`.** `wadi_halam_basin.json` declares no
  `tunnels` key at all; every wave `from`/`to` above is a map marker.
- **Every `to`/`from` names a marker, never a zone** — checked programmatically
  against the map's own marker/zone sets, not by inspection.
- **Every `group` addressed by a trigger is declared on some placement** —
  `bank` (I), `raiders` (II), `amir` (III), `reserve` (IV), `harass` (V), all
  pre-existing and unchanged by this document.
