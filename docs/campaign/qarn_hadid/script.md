# Qarn Hadid — Level Script

**Date:** 2026-09-07 · **Status:** ECA rows, AI director, twist classification,
copy-ready fragments, capability gap report and doctrine-test assertion table
for `mission-author` and `sim-guard`. **Nothing in this pass was applied to any
file** — no schema edit, no `world.json` edit, no map edit, no `data/missions/`
file. This document is the bridge from `design.md` + `narrative.md` to
`data/missions/qarn_hadid_*.json`; `mission-author` owns the actual files, the
`town` enum value (C1), the `world.json` entry (C2) and the `clinic_yard`
marker (C4), and must run `pnpm validate:data`, `walk_placements.ts` and
`walk_mission.ts` on the assembled JSON before it ships (§7, §9).

**Read against:** `docs/campaign/README.md` (the contract — a trigger's `id`
is shown to the player verbatim as `enemy reacts (<id>)`); `data/schemas/
mission.schema.json` and `packages/sim/src/mission.ts`, both grepped this
session, not recalled (§9 cites the exact lines); `docs/campaign/qarn_hadid/
design.md` (Option A "The Two Gates", §0 decisions, §3 map, §4 ladder, §5 per
mission, §7 gaps C1–C8/G1–G10, §8 open decisions); `docs/campaign/qarn_hadid/
narrative.md` (every `say`/`say_on_fail`/`dispatch`/`debrief` text, the seven
proposed trigger ids in §8, the twist table in §7, the gap list G-A…G-M);
`docs/campaign/tel_marum/script.md` and `script-losable.md` for shape and the
passive-loss convention; `data/campaign/map-variants-design.md` §3 (an
obstacle bends nothing unless it sits on the measured route — Option A's three
obstacles, per §3 of the design doc, each sit exactly on a route the mission
forces).

**Map:** `data/maps/qarn_hadid.json`, read directly this session. Route and
sight numbers in §3.2/§3.3 of `design.md` are quoted from `tools/src/
qarn_hadid_relief.test.ts` (the pinned relief facts) or from `design.md`'s own
"measured this session" tables (the sight facts and the two armour-road
figures, not yet pinned in any test — that gap is exactly what §8's doctrine
table closes). Every tile cited below as a placement coordinate was read
against the map's `rows`/`elevation` arrays this session; one campaign-design
coordinate does not resolve as written and is corrected in place, flagged in
§10.

---

## 0. What this document adds on top of `design.md` / `narrative.md`

Both upstream documents are unusually complete — `design.md` already gives
per-mission enemy stance tables with stances and tags, and `narrative.md`
already gives every `say`/`say_on_fail` string with its exact character count.
What neither one does, and what a mission file needs before `mission-author`
can run `ajv` against it, is:

1. **The `on`/`do` shapes as the schema actually spells them** — `enemy.
   garrison` (not `enemy.garrisons`), `enemy.waves[].at_seconds` (not `at_s`),
   `triggers[].on.zone` / `do.to` / `do.group`, exactly as `mission.schema.
   json` requires and `additionalProperties: false` refuses anything else.
2. **The seven trigger ids ratified** as the mission's own, verbatim strings a
   player will read as `enemy reacts (<id>)` — `narrative.md` §8 proposes
   them and explicitly hands ownership to this document.
3. **One placement coordinate corrected.** `design.md` §5.3 places the
   warehouse-compound `recoilless_team` at `[34,9]` — that tile is `w`
   (warehouse), a blocked structure tile, and this placement is `ambush`, not
   `garrison`, so it is **not** exempt from `assertGroundClear` and would
   throw `blocked` at mission load. The walled yard *in front of* the
   warehouse is `[34,7]`–`[36,7]` (cover 2, open, elevation 1, inside the same
   `=…=` compound). Corrected to `[34,7]` throughout this document. This is a
   new finding, not one of `design.md`'s ten (§10 **G-N**).
4. **Actual JSON**, field-name-checked against the grep in §9, ready to paste.

Nothing below invents a mechanic `design.md` did not already specify. Every
`on`/`do` pair, every stance, every `say` and every objective type is
transcribed from the two upstream documents; where a number is quoted rather
than re-derived, its source line is cited.

---

## 1. `qarn_hadid_1_recon` — Qarn Hadid I — Both Gates

`recon` · Major · `qarn_hadid` · `target_minutes` 6 · no economy · requires
`roster.surviving_units` · produces `roster.surviving_units,
roe.mission_ratings, campaign.completed_missions, intel.marked_positions,
civ.settlements_evacuated`.

### 1.1 Flags

| flag | kind | fiction |
|---|---|---|
| `find_the_high_gate_post` | primary, `locate(qh_watch_shoulder)` | the drone's first buy: the post watching the shoulder |
| `find_the_low_gate_post` | primary, `locate(qh_watch_notch)` | the drone's second buy in the same sortie: the post watching the saddle |
| `get_the_road_party_clear` | primary, `evacuate_before(south_staging, count 2, 240s)` — **the one objective on this map that can fail** | two of four families off the pass road before somebody else moves them |
| `find_the_tube` | secondary, `locate(qh_hvt_tube)` | the Grad in the Hollow, on the player's own side of the wall |
| `find_the_bench_post` | secondary, `locate(qh_watch_bench)` | the tube's forward eye on the scree bench |
| `find_the_ditch_gun` | secondary, `locate(qh_atgm_ditch)` | the Kornet over the west end of the second ditch — the carry-over tag III spends |
| `screen_out` | secondary, `survive_until(300)` — **cannot fail**; `survive_until` is not one of the three types `checkEnd` drives to `failed`, so no `say_on_fail` may be authored on it | patrol-endurance, same shape as Tel Marum I and Umm Zeitoun I |
| `something_is_living_in_the_scree` (trigger) | `zone_entered(scree)` → `spawn` 1 `sarim_rifles` at `scree_north` | the pocket was held before anybody arrived |
| `he_will_not_leave_the_tube` (trigger) | `casualties_pct(40)` → `withdraw_to village_square`, group `tube` | he does not leave the Grad on a floor that can be walked onto |
| `they_move_the_road_party_off` (trigger) | `timer_s(250)` → `remove`, group `road_party` | T-QH3: the road party is taken, not fought over — the arc's nearest thing to an atrocity, and it is a removal |

### 1.2 ECA rows

| Event Name | IF (`on`) | THEN (`do` / objective / wave) | narrative cue bound | status |
|---|---|---|---|---|
| Mission start | — | `dispatch` shown, title card, `briefing` beats 1–6 | `narrative.md` §1.2/§1.3, verbatim | live |
| High gate post found | `objectives[].type: "locate"`, `target: "qh_watch_shoulder"` completes | toast `OBJECTIVE COMPLETE — Identify the post over the high gate` + `say` | idit: *"The post over the shoulder holds eight of that gate's twenty tiles and not one tile of the other. From where he is standing the low gate does not exist."* | live |
| Low gate post found | `locate(qh_watch_notch)` completes | toast + `say` | idit: *"The one over the notch is in heavy cover and has the whole of it, twenty tiles out of twenty. Anything that crosses low crosses in front of him."* | live |
| Tube found | `locate(qh_hvt_tube)` completes | toast + `say` | idit: *"The battery is on the floor of the bowl behind you, on your own side of the wall. Nothing here can see into that hollow and it does not need to: its eyes are eight tiles forward, on the boulder bench."* (T-QH1) | live |
| Bench post found | `locate(qh_watch_bench)` completes | toast + `say` | idit: *"That is the tube's eye. Take him off the bench and the battery is firing at the last place somebody told it about."* | live |
| Ditch gun found | `locate(qh_atgm_ditch)` completes | toast + `say` | idit: *"ATGM cell seventeen tiles past the notch, laid on the west end of a second ditch nobody has been close enough to draw. That gun is on the board now."* — carry-over into III | live |
| Two families clear | `evacuate_before(south_staging, 2, 240s)` completes | toast + `say` | shai: *"Two into the staging ground. Whatever is still on that road is not worth a second run east."* | live |
| Road party clock runs out | `evacuate_before(south_staging, 2, 240s)` fails @240s | toast `OBJECTIVE FAILED —…` + `say_on_fail` — **the only way to lose this mission** | shai: *"Four minutes, and nothing of ours got within four tiles of that road. They will be moved by somebody else now."* | live |
| Five minutes screened | `survive_until(300)` completes | toast | shipped shape, no `say` authored | live |
| Reinforcement to the notch | wave `at_seconds: 150`, `from: "north_junction"`, `to: "saddle_gate"`, 1 `sarim_rifles` | toast (hard-coded) + `say` | idit: *"One section walking down to the notch from the junction. They are reinforcing the low gate while you are still photographing it."* | live |
| Reinforcement to the shoulder | wave `at_seconds: 260`, `from: "north_junction"`, `to: "shoulder_gate"`, 1 `sarim_rifles` | toast only, **no `say`** — deliberate, per `narrative.md`: a second gate reinforced while the first was is the beat, and narrating both makes it a pattern instead of a discovery | — | live |
| Something is living in the scree | `on: { kind: "zone_entered", zone: "scree" }` | `do: { kind: "spawn", units: [{ unit: "sarim_rifles", count: 1, marker: "scree_north" }] }` + `say` | idit: *"There is a section in the boulders and it did not walk in behind you. That pocket has been held since before anybody came up this road."* | live |
| He will not leave the tube | `on: { kind: "casualties_pct", value: 40 }` | `do: { kind: "withdraw_to", group: "tube", to: "village_square" }` + `say` | idit: *"The tube is out of the hollow and driving for the high gate. He does not leave one standing on a floor he can be walked onto."* | live |
| They move the road party off | `on: { kind: "timer_s", value: 250 }` | `do: { kind: "remove", group: "road_party" }` + `say` | idit: *"The road is empty. Nobody fought over it — they were walked off it while the drone was over the wall."* (T-QH3) | live |
| A civilian reaches the staging ground | `evacuated` MissionEvent | **nothing** — `describeMissionEvent` has no `evacuated` case | narrative.md **G-H** | engine |
| Drone destroyed | `SimEvent destroyed` on `recon_drone` | needs a trigger that watches a `SimEvent` | idit's proposed line exists in prose only | engine |
| Tube fires on the road party | `SimEvent fire` from `qh_hvt_tube` | needs a trigger that watches a `SimEvent` | shai's proposed line exists in prose only | engine |
| Mission ends | victory / defeat | `debrief` | idit (victory) / shai (defeat), §1.6 below | live |

**Row count: 15 live, 0 schema, 3 engine.**

### 1.3 AI director

**Placements** (all coordinates checked against `data/maps/qarn_hadid.json`
this session; none is blocked):

| tag / group | unit | count | at / marker | stance |
|---|---|---|---|---|
| `qh_watch_shoulder` | `sarim_rifles` | 1 | `[24,12]` | `hold_position` |
| `qh_watch_notch` | `sarim_rifles` | 1 | `[32,15]` (cover 3) | `hold_position` |
| `qh_watch_bench` | `recoilless_team` | 1 | `[33,26]` | `ambush(4)` |
| `qh_atgm_ditch` | `atgm_cell` | 1 | `[14,12]` | `hold_position` |
| `qh_hvt_tube`, group `tube` | `rocket_battery` | 1 | marker `hollow_floor` | `hold_position` |
| `qh_manpad_scree` | `manpad_team` | 1 | `[40,30]` (open ground, **not** the `b` field — G2) | `hold_position` |
| — | `sarim_rifles` | 1 | `[30,16]`→`[30,22]` (both `r`, road) | `patrol` |
| group `road_party` | `civilians` | 2+2 | `[34,31]`, `[36,32]` (open) | shelter-in-place (civilian rule) |

**Cadence table:**

| t (s) | mechanism | size | from | to | group |
|---|---|---|---|---|---|
| 0 | garrison ×6 + patrol ×1 | 1 each | (see above) | — | — |
| 0 | civilians | 2+2 | `[34,31]`,`[36,32]` | — | `road_party` |
| 150 | wave | 1 `sarim_rifles` | `north_junction` | `saddle_gate` | — |
| ≤240 (deadline) | objective clock | — | — | — | `get_the_road_party_clear` |
| 250 | trigger `remove` | up to 4 (living, unfound) | `road_party` | (removed) | — |
| 260 | wave | 1 `sarim_rifles` | `north_junction` | `shoulder_gate` | — |
| any tick, `zone_entered(scree)` | trigger `spawn` | 1 `sarim_rifles` | — | `scree_north` (spawn point) | — |
| any tick, 40% enemy casualties | trigger `withdraw_to` | group `tube` (1) | `hollow_floor` | `village_square` | `tube` |
| 300 | objective clock | — | — | — | `screen_out` |

**Pressure curve.** Sarim doctrine here is pure standoff-and-clock: nothing at
t=0 does anything but watch, and the only thing that moves without an order is
the road party once suppressed or approached, and the two reinforcement
sections at 150s/260s (3 bodies total, nowhere near a stand-up fight). The
entire mission is a resource-and-clock puzzle exactly as `design.md` frames it:
one drone sortie through the saddle buys both primary `locate`s cheaply; the
three secondary tags (`qh_hvt_tube`, `qh_watch_bench`, `qh_atgm_ditch`) all sit
under the MANPAD's 13-tile envelope or 17 tiles past the notch, so buying them
costs the same men who are the only ones who can reach the road party at all
(§1.4's decision). The 250s `remove` is the actual clock most players will
race — 10 seconds after the evacuation deadline, so a plan that just misses the
rescue also loses the fiction of it.

### 1.4 Map requirements

| kind | id | rough tile | purpose | exists? |
|---|---|---|---|---|
| coordinate | `map.player_start` | `[24,42]` | deploy point, inside `south_staging` | n/a (raw coordinate) |
| marker | `kdf_start` | `[24,39]` | civilian refuge | **EXISTS** |
| zone | `south_staging` | `[16,34,17,12]` | `evacuate_before` target; contains `kdf_start` | **EXISTS** |
| zone | `scree` | `[33,23,15,6]` | `zone_entered` trigger | **EXISTS** |
| marker | `scree_north` | `[40,23]` | trigger `spawn` point | **EXISTS** |
| marker | `north_junction` | `[24,12]` | wave source ×2 | **EXISTS** |
| marker | `saddle_gate` | `[30,22]` | wave target | **EXISTS** |
| marker | `shoulder_gate` | `[20,20]` | wave target | **EXISTS** |
| marker | `village_square` | `[28,5]` | `withdraw_to` target for the tube | **EXISTS** |
| marker | `hollow_floor` | `[38,38]` | `qh_hvt_tube`'s spawn marker | **EXISTS** |

**No new map content for this mission.**

### 1.5 Twists

| id | twist | classification | ECA row implementing it |
|---|---|---|---|
| T-QH1 "The tube is behind you." | placement (Grad in the Hollow) + `objectives[].say` on `find_the_tube` | **expressible today** — the placement and the `say` are both shipped fields; the firing itself is the engine's existing per-side identification rule doing its own work | §1.2 row "Tube found" |
| T-QH2 "Two gates, one drone." | the two primary `locate` `say`s each state their own gate's blindness to the other | **expressible today** — no separate mechanism; two objective `say`s cover it | §1.2 rows "High/Low gate post found" |
| T-QH3 "They are on the road, not in a house." | `timer_s(250)` → `remove` group `road_party` | **expressible today** — `do.kind: "remove"` shipped and already used by `umm_zeitoun_1_recon` | §1.2 row "They move the road party off" |

**All three of I's twists are expressible today; none needs a schema field or
engine work.**

### 1.6 `debrief`

> **victory** · idit — *"This is the first ground where the map was the
> intelligence. I could tell you which gate your vehicles could use before
> anybody had seen a man on it."* (149 chars)

> **defeat** · shai — *"We had four minutes and two vehicles and we spent them
> on the wall. The road party was eleven tiles away the whole time."* (120
> chars — measured, `design.md` §5.1: the party is 11 tiles from
> `player_start` for both a rifleman and a jeep)

### 1.7 Passive-player loss

**Primary `get_the_road_party_clear` (`evacuate_before`) reaches `failed` at
240s.** A passive force parked at `[24,42]` (`player_start`) is seen by
nothing: `design.md` §3.3.6 measures that nothing in the scree sees
`kdf_start` at sight 8, 9 or 12, so the tube never gets a target on the start
line, `CivilianFlight` never latches a suppression-triggered flee, no rifleman
ever comes within `SHEPHERD_RADIUS_SQ` (4 tiles) of the road party, the
evacuated count stays 0, and the primary fails on the clock at 240s. `checkEnd`
reads the failed primary and returns **DEFEAT** — no wipe required. The three
`locate` primaries also stay incomplete on a passive run (nothing at sight
9–16 parked at `player_start` sees a post 12–25 tiles away), which is
consistent but not what ends the mission first.

**`playtest`'s passive control must read DEFEAT.** If it instead reads
`ongoing`, the finding (per `design.md` §5.5.1) is that something IS seeing
the start line and suppressing the road party into fleeing on its own — a
ground fact to fix by moving the road party's spawn (to the scree's southern
apron, per `design.md`'s own contingency), never by widening the 240s
deadline.

**What the scripted plan must do to win:** identify both gate posts with one
drone sortie through the saddle notch (cheap), then commit the jeep and the
Eitan east to the road party inside the four-minute window — both vehicles
carry 2 seats each, so one round trip each clears the primary with men to
spare for the three secondary tags if time allows. `design.md` §5.5.2 notes
this mission's clock is a *deadline*, not an endure-floor, so its
plan-to-target ratio is not informative under GH-84's split; only "does the
plan complete the primaries before 240s" matters here.

### 1.8 Copy-ready fragments

```json
{
  "starting_force": [
    { "unit": "recon_drone", "count": 1, "at": [24, 41] },
    { "unit": "jeep_shoded", "count": 1, "at": [22, 43] },
    { "unit": "inf_squad", "count": 2, "at": [24, 43], "from_ledger": true },
    { "unit": "at_team", "count": 1, "at": [26, 43], "from_ledger": true },
    { "unit": "apc_eitan", "count": 1, "at": [25, 44] }
  ],
  "objectives": [
    { "id": "find_the_high_gate_post", "type": "locate", "primary": true, "target": "qh_watch_shoulder",
      "text": "Identify the post over the high gate",
      "say": { "speaker": "idit", "text": "The post over the shoulder holds eight of that gate's twenty tiles and not one tile of the other. From where he is standing the low gate does not exist." } },
    { "id": "find_the_low_gate_post", "type": "locate", "primary": true, "target": "qh_watch_notch",
      "text": "Identify the post over the low gate",
      "say": { "speaker": "idit", "text": "The one over the notch is in heavy cover and has the whole of it, twenty tiles out of twenty. Anything that crosses low crosses in front of him." } },
    { "id": "get_the_road_party_clear", "type": "evacuate_before", "primary": true, "target": "south_staging", "count": 2, "seconds": 240,
      "text": "Get two families off the pass road inside four minutes",
      "say": { "speaker": "shai", "text": "Two into the staging ground. Whatever is still on that road is not worth a second run east." },
      "say_on_fail": { "speaker": "shai", "text": "Four minutes, and nothing of ours got within four tiles of that road. They will be moved by somebody else now." } },
    { "id": "find_the_tube", "type": "locate", "primary": false, "target": "qh_hvt_tube",
      "text": "Find the rocket battery in the hollow behind the start line",
      "say": { "speaker": "idit", "text": "The battery is on the floor of the bowl behind you, on your own side of the wall. Nothing here can see into that hollow and it does not need to: its eyes are eight tiles forward, on the boulder bench." } },
    { "id": "find_the_bench_post", "type": "locate", "primary": false, "target": "qh_watch_bench",
      "text": "Identify the observer on the boulder bench",
      "say": { "speaker": "idit", "text": "That is the tube's eye. Take him off the bench and the battery is firing at the last place somebody told it about." } },
    { "id": "find_the_ditch_gun", "type": "locate", "primary": false, "target": "qh_atgm_ditch",
      "text": "Identify the ATGM cell over the west ditch end",
      "say": { "speaker": "idit", "text": "ATGM cell seventeen tiles past the notch, laid on the west end of a second ditch nobody has been close enough to draw. That gun is on the board now." } },
    { "id": "screen_out", "type": "survive_until", "primary": false, "seconds": 300,
      "text": "Stay in the field for five minutes" }
  ],
  "roe": { "enabled": true },
  "civilians": {
    "refuge": "kdf_start",
    "groups": [
      { "unit": "civilians", "count": 2, "at": [34, 31], "group": "road_party" },
      { "unit": "civilians", "count": 2, "at": [36, 32], "group": "road_party" }
    ]
  },
  "enemy": {
    "faction": "sarim",
    "doctrine_profile": "standoff overwatch",
    "garrison": [
      { "unit": "sarim_rifles", "count": 1, "at": [24, 12], "tag": "qh_watch_shoulder" },
      { "unit": "sarim_rifles", "count": 1, "at": [32, 15], "tag": "qh_watch_notch" },
      { "unit": "recoilless_team", "count": 1, "at": [33, 26], "tag": "qh_watch_bench", "stance": { "kind": "ambush", "tiles": 4 } },
      { "unit": "atgm_cell", "count": 1, "at": [14, 12], "tag": "qh_atgm_ditch" },
      { "unit": "rocket_battery", "count": 1, "marker": "hollow_floor", "group": "tube", "tag": "qh_hvt_tube" },
      { "unit": "manpad_team", "count": 1, "at": [40, 30], "tag": "qh_manpad_scree" },
      { "unit": "sarim_rifles", "count": 1, "at": [30, 16],
        "stance": { "kind": "patrol", "waypoints": [[30, 16], [30, 22]] } }
    ],
    "waves": [
      { "at_seconds": 150, "to": "saddle_gate",
        "units": [ { "unit": "sarim_rifles", "count": 1, "from": "north_junction" } ],
        "say": { "speaker": "idit", "text": "One section walking down to the notch from the junction. They are reinforcing the low gate while you are still photographing it." } },
      { "at_seconds": 260, "to": "shoulder_gate",
        "units": [ { "unit": "sarim_rifles", "count": 1, "from": "north_junction" } ] }
    ]
  },
  "triggers": [
    { "id": "something_is_living_in_the_scree",
      "on": { "kind": "zone_entered", "zone": "scree" },
      "do": { "kind": "spawn", "units": [ { "unit": "sarim_rifles", "count": 1, "marker": "scree_north" } ] },
      "say": { "speaker": "idit", "text": "There is a section in the boulders and it did not walk in behind you. That pocket has been held since before anybody came up this road." } },
    { "id": "he_will_not_leave_the_tube",
      "on": { "kind": "casualties_pct", "value": 40 },
      "do": { "kind": "withdraw_to", "group": "tube", "to": "village_square" },
      "say": { "speaker": "idit", "text": "The tube is out of the hollow and driving for the high gate. He does not leave one standing on a floor he can be walked onto." } },
    { "id": "they_move_the_road_party_off",
      "on": { "kind": "timer_s", "value": 250 },
      "do": { "kind": "remove", "group": "road_party" },
      "say": { "speaker": "idit", "text": "The road is empty. Nobody fought over it — they were walked off it while the drone was over the wall." } }
  ],
  "dispatch": "Twelve kilometres of pass road join Tel Marum to the basin, and for two weeks the brigade has driven round them. Nobody ever fought over that road. Somebody came through it with a machine, priced it, and went on.",
  "debrief": {
    "victory": { "speaker": "idit", "text": "This is the first ground where the map was the intelligence. I could tell you which gate your vehicles could use before anybody had seen a man on it." },
    "defeat": { "speaker": "shai", "text": "We had four minutes and two vehicles and we spent them on the wall. The road party was eleven tiles away the whole time." }
  }
}
```

---

## 2. `qarn_hadid_2_foothold` — Qarn Hadid II — The Shoulder

`foothold` · Major · `qarn_hadid` · `target_minutes` 7 · economy: `logistics_
start` 500, `logistics_rate_per_min` 130 · requires `roster.surviving_units,
intel.marked_positions` · produces `roster.surviving_units,
roe.mission_ratings, campaign.completed_missions`.

### 2.1 Flags

| flag | kind | fiction |
|---|---|---|
| `open_the_shoulder` | primary, `raze(the_gates, 300s)` — **the one objective on this map that can fail** | demolish the poured revetment before five minutes |
| `hold_the_gates` | primary, `hold_for(the_gates, 180s)` | hold both gates for three minutes |
| `take_the_hollow` | secondary, `capture(hollow, 15s)` | the bowl the tube abandoned |
| `kill_the_bench_post` | secondary, `eliminate_hvt(qh_watch_bench)` | the same tag I could have found, pre-marked and disarmed if it was |
| `the_shoulder_garrison_walks_to_the_notch` (trigger) | `zone_entered(the_gates)` → `commit` group `gate` → `saddle_gate` | T-QH5: the player spends five minutes opening a gate the enemy has already abandoned |
| `he_takes_the_tube_into_the_village` (trigger) | `casualties_pct(40)` → `withdraw_to village_square`, group `tube` | T-QH6: the displacement told by the hollow being empty |

### 2.2 ECA rows

| Event Name | IF (`on`) | THEN (`do` / objective / wave) | narrative cue bound | status |
|---|---|---|---|---|
| Mission start | — | title, `briefing` beats 1–6 | `narrative.md` §2.2, verbatim | live |
| Revetment razed | `raze(the_gates, seconds:300)` completes — `razeTargets` snapshot is the one mission-placed `concrete` structure | toast + `say` | shai: *"Revetment is down and the crest is a road. Nothing on tracks has had one since we got to this pass."* | live |
| Five minutes, revetment standing | `raze(the_gates)` fails @300s | toast `OBJECTIVE FAILED —…` + `say_on_fail` — **the only way to lose this mission** | shai: *"Five minutes. The concrete is standing, the armour has not moved a tile north, and the men who crossed low are still over there."* | live |
| Both gates held 3 minutes | `hold_for(the_gates, 180s)` completes | toast + `say` | net: *"Both gates held. Nothing crossed this wall tonight that we did not put through it."* | live |
| Hollow taken | `capture(hollow, 15s)` completes | toast + `say` | idit: *"The bowl is empty. He took the tube north through a gate you have not opened yet, and while you stand in this one he cannot bring it back."* (T-QH6) | live |
| Bench post killed | `eliminate_hvt(qh_watch_bench)` completes | toast + `say` | idit: *"Bench is clear. The battery still has its range card and nobody left to read it out."* | live |
| Wave to the shoulder | wave `at_seconds:120`, `from:"north_junction"`, `to:"shoulder_gate"`, 2 `sarim_rifles` | toast only, no `say` | — | live |
| Wave to the notch | wave `at_seconds:240`, `from:"village_square"`, `to:"saddle_gate"`, 1 `recoilless_team` | toast only, no `say` | — | live |
| Wave to the notch again | wave `at_seconds:330`, `from:"village_square"`, `to:"saddle_gate"`, 2 `sarim_rifles` | toast + `say` | idit: *"Two more sections off the square, and they are going to the notch rather than to the shoulder. He is fighting for the gate you did not choose."* | live |
| The shoulder garrison walks to the notch | `on: { kind: "zone_entered", zone: "the_gates" }` | `do: { kind: "commit", group: "gate", to: "saddle_gate" }` + `say` | idit: *"The section in the revetment has left it and gone east to the notch. You are five minutes into opening a gate they have stopped defending."* (T-QH5) | live |
| He takes the tube into the village | `on: { kind: "casualties_pct", value: 40 }` | `do: { kind: "withdraw_to", group: "tube", to: "village_square" }` + `say` | net: *"Battery is displacing onto the village square. It will not be where the drone last had it and it still reaches both gates."* | live |
| Garrisoned revetment takes structure fire | automatic structure-fire path (a hostile is inside), no trigger | hard-coded structure-damage copy only | — deliberately no authored line, per `narrative.md`: the second road to the primary should be discovered, not announced | live |
| A squad is bought at the camp | `built` MissionEvent | `reinforcement deployed — inf_squad` — raw unit id | narrative.md **G-I** | engine |
| Demo squad destroyed | `SimEvent destroyed` | needs a trigger that watches a `SimEvent` | shai's proposed line exists in prose only | engine |
| Mission ends | victory / defeat | `debrief` | shai (victory) / idit (defeat), §2.4 | live |

**Row count: 11 live, 0 schema, 2 engine.**

### 2.3 AI director

**Placements:**

| tag / group | unit | count | at / marker | stance |
|---|---|---|---|---|
| group `gate` | `sarim_rifles` | 1 | `[19,19]` — garrisons the revetment itself | `garrison`, `building: [19,19]` |
| group `gate` | `sarim_rifles` | 1 | `[21,17]` | `hold_position` |
| group `gate` | `atgm_cell` | 1 | `[19,16]` | `hold_position` |
| `qh_watch_notch` | `sarim_rifles` | 1 | `[32,15]` | `hold_position` |
| `qh_atgm_saddle` | `atgm_cell` | 1 | `[33,16]` | `ambush(6)` |
| `qh_watch_bench` | `recoilless_team` | 1 | `[33,26]` | `ambush(4)` — pre-identified and ambush-forfeited at runtime if `qh_watch_bench` is in `intel.marked_positions` from I |
| `qh_manpad_scree` | `manpad_team` | 1 | `[40,30]` | `hold_position` |
| — | `sarim_rifles` | 1 | `[38,38]` (`hollow_floor`) | `hold_position` — the stay-behind that makes `capture hollow` a fight |
| `qh_hvt_tube`, group `tube` | `rocket_battery` | 1 | `[26,13]` (displaced north of the wall) | `hold_position` |

**Structures:**

| type | at | size | purpose |
|---|---|---|---|
| `concrete` | `[18,19]` | `[4,1]` | the revetment sealing the shoulder — the `raze(the_gates)` target |
| `camp` | `[25,34]` | `[2,2]` | the field structure the economy builds from |

**Cadence table:**

| t (s) | mechanism | size | from | to | group |
|---|---|---|---|---|---|
| 0 | garrison ×9 | 1 each | (see above) | — | — |
| 0 | structures ×2 | — | — | `[18,19]`, `[25,34]` | — |
| ≤300 (deadline) | objective clock | — | — | — | `open_the_shoulder` |
| 120 | wave | 2 `sarim_rifles` | `north_junction` | `shoulder_gate` | — |
| any tick, `zone_entered(the_gates)` | trigger `commit` | group `gate` (up to 3) | `[19,19]` area | `saddle_gate` | `gate` |
| 180 (from first uncontested hold) | objective clock | — | — | — | `hold_the_gates` |
| 240 | wave | 1 `recoilless_team` | `village_square` | `saddle_gate` | — |
| any tick, 40% enemy casualties | trigger `withdraw_to` | group `tube` (1) | `[26,13]` | `village_square` | `tube` |
| 330 | wave | 2 `sarim_rifles` | `village_square` | `saddle_gate` | — |

**Pressure curve.** One push per gate, alternating (120s shoulder, 240s notch,
330s notch again) so neither half of the split force gets a quiet mission,
exactly as `design.md` §5.2 states. The economy (500 start, 130/min) buys
roughly one `ifv_namer` or three rifle sections across the mission, and
because the shoulder is physically sealed until `open_the_shoulder` completes,
anything bought that needs that road sits idle until the demolition lands —
`design.md` calls this "the only mission in the game where what you buy is
constrained by which obstacle it can cross." The `zone_entered(the_gates)`
trigger is the sharpest beat: it fires the instant ANY player unit enters the
zone (likely early, while the infantry crosses the open saddle), which means
the gate garrison is very probably already walking east while the player is
still five minutes from opening the shoulder — the player cannot see this
happen from where the armour is stalled.

### 2.4 Map requirements

| kind | id | rough tile | purpose | exists? |
|---|---|---|---|---|
| coordinate | `map.player_start` | `[24,42]` | deploy point | n/a |
| zone | `the_gates` | `[17,16,17,9]` | `raze` + `hold_for` target; `zone_entered` trigger zone. Contains zero pre-existing structures (`design.md` §3.3.8) — only the mission-placed `concrete` is razeable here | **EXISTS** |
| zone | `hollow` | `[31,31,15,15]` | `capture` secondary target | **EXISTS** |
| marker | `north_junction` | `[24,12]` | wave source | **EXISTS** |
| marker | `shoulder_gate` | `[20,20]` | wave target | **EXISTS** |
| marker | `village_square` | `[28,5]` | wave source ×2; `withdraw_to` target for the tube | **EXISTS** |
| marker | `saddle_gate` | `[30,22]` | wave target ×2 | **EXISTS** |
| marker | `hollow_floor` | `[38,38]` | the stay-behind's tile | **EXISTS** |

**No new map content for this mission** — the revetment and camp are
mission-placed `structures[]`, not map edits.

### 2.5 Twists

| id | twist | classification | ECA row implementing it |
|---|---|---|---|
| T-QH4 "The high gate was closed after the picture was taken." | briefing beat 1 states the limit of `intel.marked_positions` directly | **expressible today** — no `do` kind reveals terrain or a structure (`design.md` §7 G6), so the surprise is structural; the line is a `briefing` sentence, no mechanism needed | briefing text (§2's copy-ready `briefing` string, §9) |
| T-QH5 "The gate you opened is not the gate they defend." | `zone_entered(the_gates)` → `commit` group `gate` → `saddle_gate` | **expressible today** | §2.2 row "The shoulder garrison walks to the notch" |
| T-QH6 "The tube went north." | placement (`[26,13]`) + `objectives[].say` on `take_the_hollow` | **expressible today** — the displacement is told by the bowl's emptiness, no mechanism beyond the placement and one `say` | §2.2 row "Hollow taken" |

**All three of II's twists are expressible today.**

### 2.6 `debrief`

> **victory** · shai — *"The crest is a road. It took five minutes of standing
> still under fire to make it one, and he poured it in an afternoon a year
> before we came."* (142 chars)

> **defeat** · idit — *"The concrete is still across the shoulder. Everything
> we sent through the low gate is on the wrong side of a wall we never
> opened."* (130 chars)

### 2.7 Passive-player loss

**Primary `open_the_shoulder` (`raze`) reaches `failed` at 300s.** The only
ways anything levels an unoccupied structure are the `demo_squad`'s charges or
the automatic structure-fire path (which needs a hostile inside it — the
revetment's garrisoned `sarim_rifles` satisfies this, but only under player
fire); a passive player issues no command at all, so neither path triggers,
the concrete stands, and the primary fails on the clock. `checkEnd` returns
**DEFEAT**. `hold_the_gates` also never starts on a passive run (`livingIn`
requires a player unit physically present in `the_gates`), but it is the raze
deadline that ends the mission first — the losable objective is deliberately
the one the player must *act* on, per `design.md` §4's own framing.

**`playtest`'s passive control must read DEFEAT.**

**What the scripted plan must do to win:** commit the `demo_squad` to the
revetment at `[19,20]` (or bring the Lavi's `gun_120` to bear on the
garrisoned structure) well inside the 300s deadline, hold both gates
uncontested for a continuous 180s (this is the mission's one *endure* clock —
`design.md` §5.5.2 says its plan-to-target ratio IS informative, unlike I and
III), and spend whatever logistics remain on units the now-open shoulder can
actually use. `design.md`'s own recommendation (§5.5.4): re-run `playtest`
once the garrisoned-vs-empty revetment decision (§8 O-QH3-adjacent) is
settled, since a garrisoned revetment is a second route to the primary and
changes the plan's shape.

### 2.8 Copy-ready fragments

```json
{
  "starting_force": [
    { "unit": "inf_squad", "count": 3, "at": [24, 43], "from_ledger": true },
    { "unit": "at_team", "count": 1, "at": [26, 43], "from_ledger": true },
    { "unit": "mortar_team", "count": 1, "at": [23, 44], "from_ledger": true },
    { "unit": "demo_squad", "count": 1, "at": [22, 43] },
    { "unit": "mbt_lavi", "count": 1, "at": [26, 44] },
    { "unit": "ifv_namer", "count": 1, "at": [20, 44] },
    { "unit": "apc_eitan", "count": 2, "at": [25, 44] },
    { "unit": "recon_drone", "count": 1, "at": [24, 41] }
  ],
  "resources": { "logistics_start": 500, "logistics_rate_per_min": 130 },
  "structures": [
    { "type": "concrete", "at": [18, 19], "size": [4, 1] },
    { "type": "camp", "at": [25, 34], "size": [2, 2] }
  ],
  "objectives": [
    { "id": "open_the_shoulder", "type": "raze", "primary": true, "target": "the_gates", "seconds": 300,
      "text": "Raze the revetment on the high gate inside five minutes",
      "say": { "speaker": "shai", "text": "Revetment is down and the crest is a road. Nothing on tracks has had one since we got to this pass." },
      "say_on_fail": { "speaker": "shai", "text": "Five minutes. The concrete is standing, the armour has not moved a tile north, and the men who crossed low are still over there." } },
    { "id": "hold_the_gates", "type": "hold_for", "primary": true, "target": "the_gates", "seconds": 180,
      "text": "Hold both gates for three minutes",
      "say": { "speaker": "net", "text": "Both gates held. Nothing crossed this wall tonight that we did not put through it." } },
    { "id": "take_the_hollow", "type": "capture", "primary": false, "target": "hollow", "seconds": 15,
      "text": "Take the hollow behind the start line and hold it for 15 seconds",
      "say": { "speaker": "idit", "text": "The bowl is empty. He took the tube north through a gate you have not opened yet, and while you stand in this one he cannot bring it back." } },
    { "id": "kill_the_bench_post", "type": "eliminate_hvt", "primary": false, "target": "qh_watch_bench",
      "text": "Kill the observer on the boulder bench",
      "say": { "speaker": "idit", "text": "Bench is clear. The battery still has its range card and nobody left to read it out." } }
  ],
  "roe": { "enabled": true },
  "enemy": {
    "faction": "sarim",
    "doctrine_profile": "standoff overwatch",
    "garrison": [
      { "unit": "sarim_rifles", "count": 1, "at": [19, 19], "group": "gate",
        "stance": { "kind": "garrison", "building": [19, 19] } },
      { "unit": "sarim_rifles", "count": 1, "at": [21, 17], "group": "gate" },
      { "unit": "atgm_cell", "count": 1, "at": [19, 16], "group": "gate" },
      { "unit": "sarim_rifles", "count": 1, "at": [32, 15], "tag": "qh_watch_notch" },
      { "unit": "atgm_cell", "count": 1, "at": [33, 16], "tag": "qh_atgm_saddle", "stance": { "kind": "ambush", "tiles": 6 } },
      { "unit": "recoilless_team", "count": 1, "at": [33, 26], "tag": "qh_watch_bench", "stance": { "kind": "ambush", "tiles": 4 } },
      { "unit": "manpad_team", "count": 1, "at": [40, 30], "tag": "qh_manpad_scree" },
      { "unit": "sarim_rifles", "count": 1, "at": [38, 38] },
      { "unit": "rocket_battery", "count": 1, "at": [26, 13], "group": "tube", "tag": "qh_hvt_tube" }
    ],
    "waves": [
      { "at_seconds": 120, "to": "shoulder_gate",
        "units": [ { "unit": "sarim_rifles", "count": 2, "from": "north_junction" } ] },
      { "at_seconds": 240, "to": "saddle_gate",
        "units": [ { "unit": "recoilless_team", "count": 1, "from": "village_square" } ] },
      { "at_seconds": 330, "to": "saddle_gate",
        "units": [ { "unit": "sarim_rifles", "count": 2, "from": "village_square" } ],
        "say": { "speaker": "idit", "text": "Two more sections off the square, and they are going to the notch rather than to the shoulder. He is fighting for the gate you did not choose." } }
    ]
  },
  "triggers": [
    { "id": "the_shoulder_garrison_walks_to_the_notch",
      "on": { "kind": "zone_entered", "zone": "the_gates" },
      "do": { "kind": "commit", "group": "gate", "to": "saddle_gate" },
      "say": { "speaker": "idit", "text": "The section in the revetment has left it and gone east to the notch. You are five minutes into opening a gate they have stopped defending." } },
    { "id": "he_takes_the_tube_into_the_village",
      "on": { "kind": "casualties_pct", "value": 40 },
      "do": { "kind": "withdraw_to", "group": "tube", "to": "village_square" },
      "say": { "speaker": "net", "text": "Battery is displacing onto the village square. It will not be where the drone last had it and it still reaches both gates." } }
  ],
  "debrief": {
    "victory": { "speaker": "shai", "text": "The crest is a road. It took five minutes of standing still under fire to make it one, and he poured it in an afternoon a year before we came." },
    "defeat": { "speaker": "idit", "text": "The concrete is still across the shoulder. Everything we sent through the low gate is on the wrong side of a wall we never opened." }
  }
}
```

---

## 3. `qarn_hadid_3_clearance` — Qarn Hadid III — The Village Road

`clearance` · Major · `qarn_hadid` · `target_minutes` 7 · economy: `logistics_
start` 400, `logistics_rate_per_min` 80 · requires `roster.surviving_units,
intel.marked_positions` · produces `roster.surviving_units,
roe.mission_ratings, campaign.completed_missions, intel.marked_positions,
civ.settlements_evacuated`.

### 3.1 Flags

| flag | kind | fiction |
|---|---|---|
| `take_the_village` | primary, `capture(village, 20s)` | clear and hold the town |
| `kill_the_relay` | primary, `eliminate_hvt(qh_hvt_relay)` | the mast party on the terraced knoll — T-QH7's hand-off |
| `get_the_families_clear` | primary, `evacuate_before(clinic, count 3, 300s)` — **the one objective on this map that can fail** | three families to the clinic yard, inside the flagged zone |
| `take_the_terraces` | secondary, `capture(the_terraces, 15s)` | the climb that unwatches the west ditch crossing |
| `find_the_grove_post` | secondary, `locate(qh_watch_grove)` | the eye over the east ditch end — the tag Umm Zeitoun inherits |
| `they_come_out_of_the_square` (trigger) | `zone_entered(village)` → `commit` group `village` → `village_square` | the town garrison forms up rather than fighting from the houses |
| `the_town_falls_back_onto_the_hill` (trigger) | `casualties_pct(45)` → `withdraw_to knoll_top`, group `village` | T-QH9: he gives the town back and keeps the hill |

### 3.2 ECA rows

| Event Name | IF (`on`) | THEN (`do` / objective / wave) | narrative cue bound | status |
|---|---|---|---|---|
| Mission start | — | title, `briefing` beats 1–7 | `narrative.md` §3.2, verbatim | live |
| Village held | `capture(village, 20s)` completes | toast + `say` | net: *"Village is held. The pass road runs from the staging ground into the basin without stopping now."* | live |
| Relay crew killed | `eliminate_hvt(qh_hvt_relay)` completes | toast + `say` | idit: *"The mast is down. It never saw one thing on this map but the high gate — it was the wire, and from tonight the basin's guns are slower to be told."* (T-QH7, measured, not paraphrased) | live |
| Three families clear | `evacuate_before(clinic, 3, 300s)` completes | toast + `say` | shai: *"Three in the clinic yard. Nothing heavier than a rifle goes into that yard while they are standing in it."* | live |
| Five minutes, families short | `evacuate_before(clinic)` fails @300s | toast `OBJECTIVE FAILED —…` + `say_on_fail` — **the only way to lose this mission on a clock** | shai: *"Five minutes. They are still in the village and the village is still being fought over, and that is on the plan, not on them."* | live |
| Terraces held 15s | `capture(the_terraces, 15s)` completes | toast + `say` | net: *"Terraces are ours. The armour's road out of the west ditch end is unwatched for the first time."* | live |
| Grove post found | `locate(qh_watch_grove)` completes | toast + `say` | idit: *"One post in the thorn grove, over the east ditch end. He goes into the file for the basin — the same idea is waiting for us there."* | live |
| Wave toward the junction | wave `at_seconds:120`, `from:"village_square"`, `to:"north_junction"`, 2 `sarim_rifles` | toast only, no `say` | — | live |
| Wave to the shoulder | wave `at_seconds:240`, `from:"knoll_top"`, `to:"shoulder_gate"`, 1 `recoilless_team` | toast only, no `say` | — | live |
| Wave to the clinic yard | wave `at_seconds:330`, `from:"village_square"`, `to:"clinic_yard"`, 2 `sarim_rifles` | toast + `say` | idit: *"Two sections off the square and they are going to the clinic, not to you. He knows which yard we told those families to walk to."* (T-QH8, cheap half) | live |
| They come out of the square | `on: { kind: "zone_entered", zone: "village" }` | `do: { kind: "commit", group: "village", to: "village_square" }` + `say` | net: *"The garrison is out of the buildings and forming on the square."* | live |
| The town falls back onto the hill | `on: { kind: "casualties_pct", value: 45 }` | `do: { kind: "withdraw_to", group: "village", to: "knoll_top" }` + `say` | idit: *"They have left the houses and gone up onto the terraces. He is giving you the town and keeping the hill you have to climb."* (T-QH9) | live |
| A civilian reaches the clinic yard | `evacuated` MissionEvent | **nothing** | narrative.md **G-H** | engine |
| First ROE deduction inside `clinic` | `roe` MissionEvent, `reason` inside flagged zone | hard-coded `roeNotice` copy only | shai's proposed line exists in prose only | engine |
| Mission ends | victory / defeat | `debrief` | shai (victory) / idit (defeat), §3.5 | live |

**Row count: 12 live, 0 schema, 2 engine.**

### 3.3 AI director

**Placements:**

| tag / group | unit | count | at | stance |
|---|---|---|---|---|
| `qh_hvt_relay`, group `relay` | `sarim_rifles` | 1 | `[10,9]` | `ambush(2)` |
| `qh_hvt_relay`, group `relay` | `sarim_rifles` | 1 | `[11,10]` | `ambush(2)` |
| — | `sarim_rifles` | 1 | `[15,8]` | `hold_position` |
| `qh_atgm_ditch` | `atgm_cell` | 1 | `[14,12]` | `ambush(6)` — pre-identified and ambush-forfeited at runtime if found in I |
| group `village` | `sarim_rifles` | 1 | garrison the apartment, `[22,3]` | `garrison`, `building: [22,3]` |
| group `village` | `sarim_rifles` | 1 | garrison the house, `[27,3]` | `garrison`, `building: [27,3]` |
| group `village` | `recoilless_team` | 1 | `[34,7]` — **corrected from `design.md`'s `[34,9]`, which is inside the warehouse's own `w` tile and blocked; `[34,7]` is the open cover-2 yard between the compound's `=` walls** | `ambush(5)` |
| `qh_watch_grove` | `sarim_rifles` | 1 | `[39,13]` | `hold_position` |
| `qh_watch_notch` | `sarim_rifles` | 1 | `[32,15]` | `hold_position` |
| `qh_manpad_north` | `manpad_team` | 1 | `[36,12]` | `hold_position` |

**Civilians:**

| group | count | at | refuge |
|---|---|---|---|
| — | 3 | `[29,3]` | `clinic_yard` |
| — | 2 | `[22,5]` | `clinic_yard` |

**Cadence table:**

| t (s) | mechanism | size | from | to | group |
|---|---|---|---|---|---|
| 0 | garrison ×10 | 1 each | (see above) | — | — |
| 0 | civilians | 3+2 | `[29,3]`,`[22,5]` | — | — |
| 120 | wave | 2 `sarim_rifles` | `village_square` | `north_junction` | — |
| any tick, `zone_entered(village)` | trigger `commit` | group `village` (up to 4) | (see above) | `village_square` | `village` |
| 240 | wave | 1 `recoilless_team` | `knoll_top` | `shoulder_gate` | — |
| ≤300 (deadline) | objective clock | — | — | — | `get_the_families_clear` |
| 330 | wave | 2 `sarim_rifles` | `village_square` | `clinic_yard` | — |
| any tick, 45% enemy casualties | trigger `withdraw_to` | group `village` (survivors) | `village_square` | `knoll_top` | `village` |

**Pressure curve.** The mission's real fight is a fork, not a ramp: the west
armour road (17 tiles, crossing the second ditch at x=19) runs directly under
the terraced knoll, where `[15,8]` sees 8 of its 10 tiles at sight 8 and the
carried-over Kornet (`qh_atgm_ditch`) sits at `[14,12]`, 7 of 10; the east
armour road (23 tiles, through the thorn grove, crossing at x=37) runs under
`qh_watch_grove` instead. Neither road is free.

> **Both numbers above were measured false at authoring** (2026-09-07) and the
> shipped briefing carries the measured ones instead: the western leg is a
> **7**-tile sample, not 10; `[15,8]` sees **4 of 7**, `[14,12]` **7 of 7**, and
> `knoll_top` sees **4 of 7** of its own road rather than none of it. See
> `tools/src/qarn_hadid_doctrine.test.ts` S8c–S11, which pins them.
 The village garrison
(2 garrisoned + 1 ambush) is a modest fight that displaces to the square on
first contact and falls back to the hill at 45% losses, concentrating the
mission's last engagement on the ground the player has to climb regardless.
The 330s wave sending rifles specifically to `clinic_yard` — the evacuation
target and the flagged zone at once — is the mission's sharpest pressure
point and lands with 150s left on the families' own 300s clock.

### 3.4 Map requirements

| kind | id | rough tile | purpose | exists? |
|---|---|---|---|---|
| coordinate | `map.player_start` | `[24,42]` | deploy point | n/a |
| zone | `village` | `[20,1,18,10]` | `capture` primary target; `zone_entered` trigger zone | **EXISTS** |
| zone | `clinic` | `[42,6,5,5]` | `evacuate_before` target; `roe.flagged_zones` | **EXISTS** |
| **marker** | **`clinic_yard`** | **`[44,10]`** | **civilian refuge; wave target t=330s** | **NEW — `design.md` C4. Cover-2 open ground inside zone `clinic`, verified this session: tile `(44,10)` reads `'2'`/elevation 2, and the marker's tile lies inside `clinic`'s bounds (`tx∈[42,47)`, `ty∈[6,11)`), so `MissionRuntime.start()`'s refuge-inside-zone check (mission.ts ~745) does not throw** |
| zone | `the_terraces` | `[8,5,7,7]` | `capture` secondary target | **EXISTS** |
| marker | `village_square` | `[28,5]` | wave source ×2; `commit` target | **EXISTS** |
| marker | `north_junction` | `[24,12]` | wave target | **EXISTS** |
| marker | `knoll_top` | `[10,9]` | wave source | **EXISTS** |

**One new marker: `clinic_yard [44,10]`.** No row, zone or elevation change —
purely additive, so `tools/src/qarn_hadid_relief.test.ts` (which reads only
`rows`/`elevation`) is undisturbed.

### 3.5 Twists

| id | twist | classification | ECA row implementing it |
|---|---|---|---|
| T-QH7 "The mast is not an eye." | `objectives[].say` on `kill_the_relay` | **expressible today** — measured fact, no mechanism beyond the `say` | §3.2 row "Relay crew killed" |
| T-QH8 "The clinic fills up." | wave `to: clinic_yard` at 330s + `say`; the garrison variant (`zone_entered(clinic) → spawn` with `stance: garrison`) is a second, equally-expressible shape | **expressible today**, both variants — `zone_entered`→`spawn` and a `stance.kind:"garrison"` are both shipped fields. Which one ships is `playtest`'s call (`design.md` O-QH3), not an engine question | §3.2 row "Wave to the clinic yard" (shipped); the garrison variant is NOT authored here, per O-QH3 |
| T-QH9 "He gives the town back." | `casualties_pct(45)` → `withdraw_to knoll_top`, group `village` | **expressible today** — re-run `playtest` after this lands, since a `withdraw_to` can walk a fight out of a scripted plan's reach (`tel_marum/design.md`'s T-C1 finding) | §3.2 row "The town falls back onto the hill" |
| T-QH10 "His fire kills them and your score does not move." | as a **placement** (families on the axis of the enemy's own indirect fire) it is live and authored; as a **line bound to a specific round landing** it needs a trigger that watches a `SimEvent` (G-B) and a way to choose where an enemy round lands (G-C), neither of which exists | **split** — placement half expressible today (already authored: the civilian groups at `[29,3]`/`[22,5]` sit inside the corridor the village garrison's own indirect assets can range); the bound `say` is **engine work** | placement only; no ECA row for the bound line |

**Tally for III: 3 of 4 fully expressible today; T-QH10 is engine work for its
literal (bound-line) form, with an expressible placement-only fallback already
shipped in the civilian positions above.**

### 3.6 `debrief`

> **victory** · shai — *"The road is open. It was cut by a man who has never
> been here, and opening it cost a climb, a demolition and a clinic full of
> people."* (133 chars)

> **defeat** · idit — *"The ditch is still across the fields and the mast is
> still on the hill. Whatever the basin's guns are told tomorrow, they are
> told fast."* (136 chars)

**`aftermath`: none, deliberately** (`narrative.md` §0.6/§3.8 — Act II closes
at `umm_zeitoun_4_clearance`, and a victory-banner line here would make the
four missions after it read as an epilogue). A held line exists in
`narrative.md` §3.8 if the lead overrules this; it is not authored below.

### 3.7 Passive-player loss

**Primary `get_the_families_clear` (`evacuate_before`) reaches `failed` at
300s.** A passive player never comes within 4 tiles of either civilian group,
`CivilianFlight` never latches a flee order, the evacuated count stays 0, and
the primary fails on the clock. `checkEnd` returns **DEFEAT**. `take_the_
village` and `kill_the_relay` also stay incomplete on a passive run (no
player unit ever enters `village`, so it is never `capture`d; the ambushed
relay crew never takes fire), but the evacuation clock is what ends the
mission first, at 300s rather than whenever a wipe might eventually occur.

**`playtest`'s passive control must read DEFEAT.**

**What the scripted plan must do to win:** move a rifle element toward
`[29,3]`/`[22,5]` early enough to start the civilian walk to `clinic_yard`
well inside 300s (17–19 tiles on foot per `design.md` §3.2's measured line);
pick ONE armour road (west under the terraces, or east through the grove) and
commit to it rather than splitting the vehicles across both; take
`the_terraces` with foot before sending armour up the west road if that is the
road chosen, since the mast party will not fire until the terraces are
entered; and keep the Namer's `cannon_30` off the `clinic` zone once families
are inside it (`collateral_risk >= 0.3` arms the flagged-zone penalty per
`beit_sahwan_3_clearance`'s measured rule — rifles, `coax_mg` and the Eitan's
`rws_50` do not trip it, so infantry can still fight in the yard).
`design.md` §5.5.2: this mission's clock is a deadline (not an endure-floor),
so GH-84's split makes its plan-to-target ratio uninformative on its own —
only "does the plan clear all three primaries before the mission's own
9-minute mechanical ceiling implied by target_minutes 7" matters, and
`playtest` measures it directly.

### 3.8 Copy-ready fragments

```json
{
  "starting_force": [
    { "unit": "inf_squad", "count": 3, "at": [24, 43], "from_ledger": true },
    { "unit": "at_team", "count": 1, "at": [26, 43], "from_ledger": true },
    { "unit": "mortar_team", "count": 1, "at": [23, 44], "from_ledger": true },
    { "unit": "demo_squad", "count": 1, "at": [22, 43], "from_ledger": true },
    { "unit": "mbt_lavi", "count": 1, "at": [26, 44] },
    { "unit": "ifv_namer", "count": 1, "at": [20, 44] },
    { "unit": "apc_eitan", "count": 2, "at": [25, 44] },
    { "unit": "sniper_team", "count": 1, "at": [23, 43] },
    { "unit": "recon_drone", "count": 1, "at": [24, 41] }
  ],
  "resources": { "logistics_start": 400, "logistics_rate_per_min": 80 },
  "objectives": [
    { "id": "take_the_village", "type": "capture", "primary": true, "target": "village", "seconds": 20,
      "text": "Clear the village and hold it for 20 seconds",
      "say": { "speaker": "net", "text": "Village is held. The pass road runs from the staging ground into the basin without stopping now." } },
    { "id": "kill_the_relay", "type": "eliminate_hvt", "primary": true, "target": "qh_hvt_relay",
      "text": "Kill the relay crew on the terraced knoll",
      "say": { "speaker": "idit", "text": "The mast is down. It never saw one thing on this map but the high gate — it was the wire, and from tonight the basin's guns are slower to be told." } },
    { "id": "get_the_families_clear", "type": "evacuate_before", "primary": true, "target": "clinic", "count": 3, "seconds": 300,
      "text": "Get three families out of the village to the clinic yard inside five minutes",
      "say": { "speaker": "shai", "text": "Three in the clinic yard. Nothing heavier than a rifle goes into that yard while they are standing in it." },
      "say_on_fail": { "speaker": "shai", "text": "Five minutes. They are still in the village and the village is still being fought over, and that is on the plan, not on them." } },
    { "id": "take_the_terraces", "type": "capture", "primary": false, "target": "the_terraces", "seconds": 15,
      "text": "Take the terraces and hold them for 15 seconds",
      "say": { "speaker": "net", "text": "Terraces are ours. The armour's road out of the west ditch end is unwatched for the first time." } },
    { "id": "find_the_grove_post", "type": "locate", "primary": false, "target": "qh_watch_grove",
      "text": "Identify the post in the thorn grove",
      "say": { "speaker": "idit", "text": "One post in the thorn grove, over the east ditch end. He goes into the file for the basin — the same idea is waiting for us there." } }
  ],
  "roe": { "enabled": true, "flagged_zones": ["clinic"], "fail_below": 45 },
  "civilians": {
    "refuge": "clinic_yard",
    "groups": [
      { "unit": "civilians", "count": 3, "at": [29, 3] },
      { "unit": "civilians", "count": 2, "at": [22, 5] }
    ]
  },
  "enemy": {
    "faction": "sarim",
    "doctrine_profile": "standoff overwatch",
    "garrison": [
      { "unit": "sarim_rifles", "count": 1, "at": [10, 9], "tag": "qh_hvt_relay", "group": "relay", "stance": { "kind": "ambush", "tiles": 2 } },
      { "unit": "sarim_rifles", "count": 1, "at": [11, 10], "tag": "qh_hvt_relay", "group": "relay", "stance": { "kind": "ambush", "tiles": 2 } },
      { "unit": "sarim_rifles", "count": 1, "at": [15, 8] },
      { "unit": "atgm_cell", "count": 1, "at": [14, 12], "tag": "qh_atgm_ditch", "stance": { "kind": "ambush", "tiles": 6 } },
      { "unit": "sarim_rifles", "count": 1, "at": [22, 3], "group": "village", "stance": { "kind": "garrison", "building": [22, 3] } },
      { "unit": "sarim_rifles", "count": 1, "at": [27, 3], "group": "village", "stance": { "kind": "garrison", "building": [27, 3] } },
      { "unit": "recoilless_team", "count": 1, "at": [34, 7], "group": "village", "stance": { "kind": "ambush", "tiles": 5 } },
      { "unit": "sarim_rifles", "count": 1, "at": [39, 13], "tag": "qh_watch_grove" },
      { "unit": "sarim_rifles", "count": 1, "at": [32, 15], "tag": "qh_watch_notch" },
      { "unit": "manpad_team", "count": 1, "at": [36, 12], "tag": "qh_manpad_north" }
    ],
    "waves": [
      { "at_seconds": 120, "to": "north_junction",
        "units": [ { "unit": "sarim_rifles", "count": 2, "from": "village_square" } ] },
      { "at_seconds": 240, "to": "shoulder_gate",
        "units": [ { "unit": "recoilless_team", "count": 1, "from": "knoll_top" } ] },
      { "at_seconds": 330, "to": "clinic_yard",
        "units": [ { "unit": "sarim_rifles", "count": 2, "from": "village_square" } ],
        "say": { "speaker": "idit", "text": "Two sections off the square and they are going to the clinic, not to you. He knows which yard we told those families to walk to." } }
    ]
  },
  "triggers": [
    { "id": "they_come_out_of_the_square",
      "on": { "kind": "zone_entered", "zone": "village" },
      "do": { "kind": "commit", "group": "village", "to": "village_square" },
      "say": { "speaker": "net", "text": "The garrison is out of the buildings and forming on the square." } },
    { "id": "the_town_falls_back_onto_the_hill",
      "on": { "kind": "casualties_pct", "value": 45 },
      "do": { "kind": "withdraw_to", "group": "village", "to": "knoll_top" },
      "say": { "speaker": "idit", "text": "They have left the houses and gone up onto the terraces. He is giving you the town and keeping the hill you have to climb." } }
  ],
  "debrief": {
    "victory": { "speaker": "shai", "text": "The road is open. It was cut by a man who has never been here, and opening it cost a climb, a demolition and a clinic full of people." },
    "defeat": { "speaker": "idit", "text": "The ditch is still across the fields and the mast is still on the hill. Whatever the basin's guns are told tomorrow, they are told fast." }
  }
}
```

---

## 4. Twist tally, across all three missions

| # | mission | twist | classification |
|---|---|---|---|
| T-QH1 | I | The tube is behind you | expressible today |
| T-QH2 | I | Two gates, one drone | expressible today |
| T-QH3 | I | They are on the road, not in a house | expressible today |
| T-QH4 | II | The high gate was closed after the picture was taken | expressible today |
| T-QH5 | II | The gate you opened is not the gate they defend | expressible today |
| T-QH6 | II | The tube went north | expressible today |
| T-QH7 | III | The mast is not an eye | expressible today |
| T-QH8 | III | The clinic fills up | expressible today |
| T-QH9 | III | He gives the town back | expressible today |
| T-QH10 | III | His fire kills them and your score does not move | **split** — expressible today as a placement; **engine work** for the literal bound line |

**9 of 10 fully expressible today with zero schema or engine work; 1 (T-QH10)
is engine work in its literal form, with an expressible placement-only
fallback already authored in III's copy-ready fragment. Zero twists require a
new schema field.** This matches `narrative.md` §7's own status column exactly
— it marks the same nine `live` and the same one `engine`.

---

## 5. C8 — the doctrine-test assertion table for `tools/src/qarn_hadid_doctrine.test.ts`

Per `design.md` §5.5.3, this test sits **beside** `qarn_hadid_relief.test.ts`,
not inside it: the relief test already pins every terrain-mechanical claim
(the two-gate reordering, the ditch's domain lock, the scree's domain lock,
the Hollow's non-reordering price, cover 3's HP effect) — §5.1 below does
**not** repeat those. What is unpinned, and what every mission above depends
on, is the *sight* geometry of §3.3 and the *route* figures of §3.2's second
table and the two-armour-roads table, none of which live in any test today.

**Method** (from `design.md`'s own Appendix, reproduced so the test needs no
new derivation): sight uses the `sees()` pattern from `tools/src/tel_marum_
doctrine.test.ts` — spawn two units of a declared sight range on the real map,
`applyTerrain`, run 12s of ticks, read `sim.debugDetection(a,b).visible`. A
"N of M tiles" claim means: spawn the observer once, then for each of the M
target tiles spawn (or move) a target and read `visible`, counting true
results — exactly the loop `design.md` ran this session. Routes use the
`route()`/`cost()`/`gate()` helpers from `qarn_hadid_relief.test.ts` verbatim
(`FlowField.compute` over `sim.blocked` or `sim.blockedVehicle`).

### 5.1 Sight assertions

| # | observer | sight range(s) | target | expected | source |
|---|---|---|---|---|---|
| S1 | `[20,20]` (shoulder gate) | 9, 12, 48 | the 20 shoulder-gate tiles (`x∈[18,22), y∈[18,23)`) | 20/20 visible | `design.md` §1, §3.3.1 |
| S1b | `[20,20]` | 9, 12, 48 | the 20 saddle-gate tiles (`x∈[29,33), y∈[18,23)`) | 0/20 visible | same |
| S2 | `[30,20]` (saddle gate) | 9, 12, 48 | the 20 saddle-gate tiles | 20/20 visible | §3.3.1, mirror of S1 |
| S2b | `[30,20]` | 9, 12, 48 | the 20 shoulder-gate tiles | 0/20 visible | same |
| S3 | `[32,15]` (cover-3 block) | 9 | the 20 saddle-gate (notch) tiles | 20/20 visible | §3.3.2 — the sentence mission II is built on |
| S4 | `[33,26]` (scree bench) | 8 | the 20 saddle-gate (notch) tiles | 17/20 visible | §3.3.2 |
| S5 | `[24,12]` (`north_junction`) | 9 | the 20 shoulder-gate tiles | 8/20 visible | §3.3.3 |
| S5b | `[24,12]` | 12 | the 20 shoulder-gate tiles | 11/20 visible | §3.3.3 |
| S6 | `[18,11]` (west ditch end) | 9 | the 20 shoulder-gate tiles | 9/20 visible | §3.3.3 |
| S7 | `[14,12]` (knoll's east shoulder) | 9 | the 20 shoulder-gate tiles | 5/20 visible | §3.3.3 |
| S7b | `[14,12]` | 12 | the 20 shoulder-gate tiles | 11/20 visible | §3.3.3 |
| S8 | `knoll_top [10,9]` | 48 | `shoulder_gate` tile set | sees it (>0/20) | §3.3.4 |
| S8b | `knoll_top [10,9]` | 48 | `village_square`, `north_junction`, and the second ditch's mouth `[20,11]` | sees **none** of these three | §3.3.4 — "not the village, not the junction, not the ditch" |
| S8c | `knoll_top [10,9]` | 48 | the "armour's road" 10-tile sample (defined below) | 0/10 visible | §3.3.4 |
| S9 | `[15,8]` (knoll east shoulder) | 8 | the armour's road 10-tile sample | 8/10 visible | §3.3.4 |
| S10 | `[14,12]` | 8 | the armour's road 10-tile sample | 7/10 visible | §3.3.4 |
| S11 | `[13,10]` | 8 | the armour's road 10-tile sample | 6/10 visible | §3.3.4 |
| S12 | `hollow_floor [38,38]` | 48 | any tile outside zone `hollow` | sees **none** | §3.3.5 — "sees only its own rim" |
| S12b | `kdf_start`, `south_plain`, `saddle_gate`, `shoulder_gate`, `north_junction` (each, sight 48) | 48 | `hollow_floor [38,38]` | none of the five sees it | §3.3.5 |
| S13 | `hollow_floor [38,38]` | n/a (range, not sight) | distance to `kdf_start`, `south_plain`, `saddle_gate` | all **≤20** (`grad_122`'s `range_tiles`) and **≥4** (`min_range_tiles`) | §3.3.5; unit ranges grepped from `data/units/enemy/rocket_battery.json` this session |
| S13b | `hollow_floor [38,38]` | n/a | distance to `shoulder_gate`, `north_junction` | both **>20** | §3.3.5 |
| S14 | `scree_north [40,23]`, `[33,26]`, `scree_south [40,30]` (each) | 8, 9, 12 | `kdf_start [24,39]` | none of the three sees it, at any of the three ranges | §3.3.6 |
| S15 | `[33,26]` (scree bench) | 8 | `[28,32]`, `[30,30]` | both visible | §3.3.6 |
| S15b | `[33,26]` | 8 | `south_plain [24,33]`, `kdf_start [24,39]` | neither visible ("no further west") | §3.3.6 |
| S16 | `south_plain [24,33]` | 12 | the 20 shoulder-gate tiles | 2/20 visible | §1, "Killing my own favourite" |
| S16b | `south_plain [24,33]` | 12 | the 20 saddle-gate tiles | 0/20 visible | same |
| S16c | `south_plain [24,33]` | 12 | any tile with `y < 18` (north of the wall) | sees **none** | same |

**The "armour's road" 10-tile sample (S8c, S9–S11).** `design.md` states the
count (0/10, 8/10, 7/10, 6/10) but does not enumerate the ten tiles. Define it
reproducibly as: `route(MAP, 'vehicle', [20,17], [28,5])` — the same call
underlying R9 below, the 17-tile west armour road from the shoulder gate's
north exit to the village — restricted to the tiles with `11 ≤ y ≤ 17` (the
band between the wall's crest row and the second ditch's row, where the route
runs directly under the terraces). If reproducing this exact procedure against
`data/maps/qarn_hadid.json` does not return exactly 10 tiles, treat `design.
md`'s summary counts as provisional pending correction rather than silently
adjusting S8c–S11 to whatever a different slice returns.

### 5.2 Route/domain assertions

| # | domain | from → to | tiles | cost (tenths) | gate used | source |
|---|---|---|---|---|---|---|
| R1 | foot | `kdf_start [24,39]` → `north_junction [24,12]` | 29 | 322 | saddle | `design.md` §3.2, "measured this session" table |
| R2 | vehicle | same | 27 | 344 | shoulder | same |
| R3 | foot | `kdf_start` → `village_square [28,5]` | 34 | 374 | saddle | same |
| R4 | vehicle | same | 39 | 486 | shoulder | same |
| R5 | foot | `kdf_start` → `knoll_top [10,9]` | 31 | 442 | shoulder | same |
| R5b | vehicle | same | 31 | 442 | shoulder | same |
| R6 | foot | `kdf_start` → `scree_north [40,23]` | 16 | 244 | neither (south of wall) | same |
| R6b | vehicle | same | 22 | 280 | neither | same |
| R7 | foot | `kdf_start` → `hollow_floor [38,38]` | 14 | 164 | neither | same |
| R7b | vehicle | same | 14 | 164 | neither | same |
| R8 | foot | `kdf_start` → `civ_refuge [10,43]` | 14 | 166 | neither | same |
| R8b | vehicle | same | 14 | 166 | neither | same |
| R9 | vehicle | shoulder gate's north exit `[20,17]` → village | 17 | — | crosses the second ditch at **x=19** (west end) | `design.md` §3.2, "two armour roads" table |
| R10 | foot | same | 13 | — | — | same |
| R11 | vehicle | saddle gate's north exit `[30,17]` → village | 23 | — | crosses the second ditch at **x=37** (east end, thorn grove) | same |
| R12 | foot | same | 12 | — | — | same |
| R13 | — | zone `the_gates [17,16,17,9]` | 153 tiles total | — | 108 foot-passable, 104 vehicle-passable | `design.md` §3.3.7 |
| R14 | foot | mission I road party `[34,31]` → refuge | 10 | — | crosses into zone `south_staging` after 3 of the 10 tiles | `design.md` §5.1 |
| R15 | foot & vehicle | `[34,31]`/`[36,32]` → `player_start [24,42]` | 11 (both) | — | — | `design.md` §5.1 |
| R16 | foot | mission III civilians, `[30,3]` → `[46,9]` (proxy, 2 tiles short of `clinic_yard [44,10]`) | 17 | — | — | `design.md` §3.2/§5.3; re-measure to `[44,10]` itself when the marker lands |
| R16b | foot | `[29,8]` → `[46,9]` | 19 | — | — | same |

### 5.3 What the test must NOT assert

Per §5.5.4 of `design.md`: do not pin a number that changes once a `withdraw_
to` twist (T-QH9) or the garrisoned-vs-empty revetment decision (II) is
settled — those are gameplay outcomes for `playtest` to measure, not terrain
facts for this test to freeze. This test is scoped to **sight and route**
only, exactly as `design.md` names it.

---

## 6. Master gap report

**G4–G10 are `design.md`'s own numbering, restated briefly — not new work.**
G1 was already fixed before this session (`validate_data.mjs` now scans
mission-placed `structures[]` against a raze zone). G-A through G-M are
`narrative.md`'s numbering, restated the same way.

| # | gap | owner | smallest fix | status |
|---|---|---|---|---|
| **G-N** *(new this session)* | `design.md`'s III enemy stance places a `recoilless_team` (ambush, not garrison) at `[34,9]`, which is the warehouse's own `w` tile — blocked, so `assertGroundClear` throws at load | this document | corrected to `[34,7]` throughout §3 above (open cover-2 yard, same walled compound) | **closed in this document** |
| G2 | `manpad_team` is vehicle-domain (`mobility.wheeled` defaults true, role `aa` is not in `FOOT_ROLES`); this arc is the first map with both `b`/`d` symbols, so it is the first place this is visible. Both authored placements (`qh_manpad_scree [40,30]`, `qh_manpad_north [36,12]`) are on open ground, never on `b`/`d`, so it does not bite this arc | `sim-guard` | one line, `mobility.wheeled: false` on `manpad_team.json` — moves Tel Marum and Umm Zeitoun too, per `design.md` O-QH4; not part of this commit | open, recorded |
| G3 | `dozer_d9` is foot-domain (role `engineer`, no override), so it would walk an anti-tank ditch. No mission here fields it | `sim-guard` | same one-line shape as G2 | open, not exercised here |
| G4 | no trigger fires on an objective completing and none re-arms; every "and then" beat here is a one-shot `zone_entered`/`timer_s`/`casualties_pct` | `sim-guard` | recorded, not requested — none of this arc's beats need it | open, non-blocking |
| G5 | a wave's `from` resolves as a map marker only; schema text still promises "or tunnel id" | `sim-guard` | correct the schema text or build the feature | open, does not bite (no tunnels on this map) |
| G6 | `intel.marked_positions` reveals units by tag only, never terrain or a structure | none requested | design constraint, not a bug — underlies T-QH4 | by design |
| G7 | no `intel_rate_per_min` exists anywhere in the campaign | `mission-author`, act-wide | out of scope here; neither mission declares `intel_start` | open, non-blocking |
| G8 / G-M | the campaign board reads towns from the GLB; a `world.json` town with no marker node fails `world-scene.test.ts` and draws an invisible pin on the default renderer | `blender-art` | one line in `TOWN_SITES` (`tools/campaign/export_meshy_world.py`) + a re-export; both source `.blend` files are present in the **main** checkout, not this worktree | open — `design.md` C6/O-QH2 |
| G9 / G-J | `civ_refuge [10,43]` sits in no declared zone, so an `evacuate_before` naming it throws at load | closed by construction in this arc | mission I's refuge is `kdf_start` (inside `south_staging`); mission III's is the new `clinic_yard` (inside `clinic`) — neither mission ever names `civ_refuge` | closed here, still a latent trap map-wide |
| G10 | `starting_force` ignores unit unlocks (`spawnPlacement` has no `buildBlockedReason`-equivalent gate); II fields `demo_squad` (ROE 50, verified in `data/units/kdf/demo_squad.json`) and III fields `demo_squad` + `sniper_team` (ROE 60, verified in `data/units/kdf/sniper_team.json`) | `sim-guard`, campaign-wide | recorded, not exploited — Act I's measured plan ratings (75/100/100/94/98) mean a campaign arriving at Qarn Hadid honestly holds both | open, non-blocking here |
| G-A | a briefing cannot branch on `intel.marked_positions`; III's picture genuinely differs by what I found | `sim-guard` + `render-vfx` | `briefing_variants` (an optional `{requires_ledger, briefing}[]`, falling back to `briefing`) — the single static fallback sentence already ships in III's briefing beat 3 and is correct in both ledger states | open; fallback already authored |
| G-B / G-E | a trigger cannot watch a `SimEvent` or an objective | `sim-guard` | new `on.kind`s (`sim`, `objective`) — blocks 5 `radio` rows across the arc (drone lost and tube firing in I; demo squad destroyed in II; first ROE deduction and T-QH10's bound line in III) | open |
| G-C / G-F | no way to choose where an enemy round lands | `sim-guard` | out of scope; T-QH10 ships as a placement instead | open |
| G-D | the radio overlay does not exist; every `say` lands in the notice feed and commander bar with no portrait | `render-vfx` | not blocking — every line in this document still reaches the player as text | open |
| G-H | a civilian reaching the refuge is silent (`describeMissionEvent` has no `evacuated` case) | `render-vfx` | one `case 'evacuated'` | open — bites I and III, both of which score on civilians |
| G-I | `built` prints a raw unit id (`reinforcement deployed — inf_squad`) | `render-vfx` | look the display name up from the unit JSON | open — bites II, which buys squads across 7 minutes |
| G-K | `pnpm validate:audio`'s `KNOWN_EVENTS` cannot accept a voice file | `content-validator` | a non-weapon set kind and its events | open, non-blocking — no voice authored |
| G-L | `world.schema.json` has no `planned` property, so `qarn_hadid` in `world.json` with no mission files would be worse than not there at all | `sim-guard` + `app` | `planned: true`, excluded from `regionProgress` — **or**, cheaper: land C1 (schema enum), C2 (`world.json` entry) and the three mission files in the same commit | procedural — `mission-author`'s sequencing, not a code gap |

---

## 7. Verification

**Schema field names**, grepped against `data/schemas/mission.schema.json`
this session, one citation per shape used above: `dispatch`/`debrief`
(top-level, `maxLength: 240`, `debrief.{victory,defeat}` both `$defs/say`);
`ledger.{requires,produces}`; `map.{file,player_start}`; `starting_force[].
{unit,count,at,from_ledger,group}` (`additionalProperties:false` confirmed —
no `stance`/`tag` on this shape, none used above); `resources.
{logistics_start,logistics_rate_per_min}` (`intel_start`/`supply_corridor`
**deliberately not used** — the latter is on CLAUDE.md's list of fields this
role must not rely on); `structures[].{type,at,size}`; `objectives[].
{id,type,primary,text,target,count,seconds,say,say_on_fail}` — `type` used:
`locate, evacuate_before, survive_until, raze, hold_for, capture,
eliminate_hvt` (7 of the 9 live types; `destroy_all`/`collapse` not needed —
no tunnels on this map; `mark`/`escort`/`no_collateral_above`, the three the
runtime throws on, are **not used anywhere in this document**); `roe.
{enabled,flagged_zones,fail_below}`; `civilians.{groups,refuge}`;
`enemy.{faction,doctrine_profile,garrison,waves}` (**`garrison`, singular —
not `garrisons`**); `$defs/placement.{unit,count,at,marker,group,tag,stance}`
— `stance.kind` enum `hold_position|ambush|patrol|garrison`, `ambush.tiles`,
`patrol.waypoints`, `garrison.building`, all four used; `enemy.waves[].
{at_seconds,to,units[].{unit,count,from,group,tag},say}`; `triggers[].
{id,on{kind,value,zone},do{kind,group,to,units,zone},say}` — `on.kind` used:
`timer_s, casualties_pct, zone_entered` (`first_contact` not needed); `do.kind`
used: `commit, withdraw_to, spawn, remove` (`reinforce, dismount` not needed).
`threshold` and `unlocks_phase` exist on `objectives[]` in the schema and are
**deliberately not used anywhere in this document**, per the same CLAUDE.md
restriction.

**Unit ids**, confirmed present under `data/units/kdf/` and `data/units/
enemy/` this session: `inf_squad, at_team, mortar_team, demo_squad,
sniper_team, recon_drone, jeep_shoded, apc_eitan, ifv_namer, mbt_lavi` (KDF);
`sarim_rifles, atgm_cell, recoilless_team, manpad_team, rocket_battery`
(enemy); `civilians` at `data/units/civilians.json`. `data/structures.json`
confirms `concrete` (`hp_per_tile:700, roe_penalty:3, garrison_slots:2`, no
`per_tile`/`low_profile`) and `camp` (`hp_per_tile:300, roe_penalty:0`).

**Marker/zone discipline.** Every `to`/`from` above names a marker, never a
zone — checked line by line against §1.4/§2.4/§3.4's tables. Every `capture`/
`hold_for`/`evacuate_before`/`raze` target names a zone on `data/maps/
qarn_hadid.json` as shipped: `south_staging`, `the_gates`, `hollow`,
`village`, `clinic`, `the_terraces` — all six read directly from the map file
this session. Every `evacuate_before` refuge sits inside its target zone,
checked by tile arithmetic against `MissionRuntime.start()`'s own throw
condition (`mission.ts` ~745): I's `kdf_start [24,39]` is inside
`south_staging [16,34,17,12]` (`x∈[16,33)`,`y∈[34,46)` — `24,39` fits); III's
`clinic_yard [44,10]` is inside `clinic [42,6,5,5]` (`x∈[42,47)`,`y∈[6,11)` —
`44,10` fits). Every `group` a trigger addresses is declared on a placement in
the same mission (`tube` on the `rocket_battery` in I and II; `gate` on all
three placements it commits in II; `village` on all three placements it
commits/withdraws in III; `relay` on both `qh_hvt_relay`-tagged placements in
III; `road_party` on both civilian groups in I). Every `remove` names a
declared group and never covers the whole `starting_force` — I's `road_party`
is a `civilians.groups` entry, disjoint from `starting_force` entirely. Every
`say.text` above is ≤240 characters with a legal speaker (`shai|idit|net`) —
transcribed verbatim from `narrative.md`, which already length-checked all
thirty-seven lines this arc uses (longest: the 211-character `dispatch`); no
`enemy`-spoken line is authored anywhere in this document, matching
`narrative.md` §4's finding that Karim Adhal does not speak in this arc.

**No trigger depends on firing twice** — every `on` condition across the
seven triggers is a distinct object, and the runtime's `firedTriggers` array
(`mission.ts` `stepTriggers`) is indexed per trigger regardless. **No wave
depends on a tunnel `from`** — `qarn_hadid.json` declares no `tunnels` block
at all, and every wave `from` above is a map marker, checked against §1.4/
§2.4/§3.4.

**One placement coordinate was found not to resolve** (§10 G-N,
`[34,9]`→`[34,7]`) and is corrected in place in §3's copy-ready fragment, not
silently left for `mission-author` to discover at `pnpm validate:data` time.

**What this document did not do, and why.** No scratch mission JSON was
assembled and run through `pnpm validate:data`/`walk_placements.ts`/
`walk_mission.ts` in this session: `qarn_hadid` is not yet in `mission.schema.
json`'s `town` enum (C1) and `clinic_yard` is not yet on the map (C4), both of
which are `mission-author`'s to land per `docs/campaign/README.md`'s pipeline
and this task's own scope ("documents only... no map edits"). Every fragment
above was instead checked the way §7's citations show: field names grepped
against the live schema, unit ids against the live `data/units/` directory
listing, markers and zones against the live map file's `markers`/`zones`
objects, and every placement coordinate's tile symbol read directly from the
map's `rows`/`elevation` arrays — which is how G-N was found. `mission-author`
must run the three tools named above on the assembled files before this arc
ships; nothing in this document should be taken as having passed them.

---

## 8. Summary

| mission | starting_force | enemy.garrison | civilians.groups | structures | placements (sum) | triggers | waves | objectives (primary+secondary) |
|---|---|---|---|---|---|---|---|---|
| I — Both Gates | 5 | 7 | 2 | 0 | 14 | 3 | 2 | 7 (3+4) |
| II — The Shoulder | 8 | 9 | 0 | 2 | 19 | 2 | 3 | 4 (2+2) |
| III — The Village Road | 9 | 10 | 2 | 0 | 21 | 2 | 3 | 5 (3+2) |
| **total** | **22** | **26** | **4** | **2** | **54** | **7** | **8** | **16 (8+8)** |

Twist tally: **9 expressible today, 0 schema field, 1 engine work** (of 10
twist candidates — T-QH10 is engine-only in its literal, bound-line form and
carries an expressible placement-only fallback that ships regardless).

Doctrine-test assertion count (§5): **25 sight assertions** (S1–S16c) plus
**18 route/domain assertions** (R1–R16b) = **43 assertions**, none of them
already pinned by `qarn_hadid_relief.test.ts`.

**One design row could not be expressed with the vocabulary as it stands**:
T-QH10 in its literal form ("his fire kills them and your score does not
move," bound to the tick a specific enemy round lands) needs both a
sim-watching trigger (`on.kind: "sim"` or `"objective"`, G-B/G-E) and a way to
author where an enemy round lands (G-C/G-F) — neither exists today, and both
are recorded as `sim-guard`'s smallest-proposal territory in §6. Every other
row in `design.md` §5 and every twist in `narrative.md` §7 is expressed above
using only field names verified against the live schema.
