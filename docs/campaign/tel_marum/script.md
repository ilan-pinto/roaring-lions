# Tel Marum and Umm Zeitoun — Level Script

**Date:** 2026-09-03 · Written against `docs/campaign/tel_marum/design.md` (Option C,
the recommended plot — Tel Marum re-integrated, Umm Zeitoun in four) and
`docs/campaign/tel_marum/narrative.md`, both read in full this session, plus
`docs/campaign/beit_sahwan/script.md` for the shape this document follows.
Verified directly against `data/schemas/mission.schema.json`,
`packages/sim/src/mission.ts` and `tools/validate_narrative.mjs` — every shape
below is grepped, not quoted from a summary. **`data/maps/umm_zeitoun.json`
exists in this worktree** (landed concurrently by another agent this session);
it was read read-only and its markers/zones are byte-identical to
`design.md` §4.4's draft — every name, every coordinate. There is nothing to
reconcile; every table below cites the map file, not the design draft.

**This document assumes Option C** (the design's own recommendation, and the
only option under which a four-mission Umm Zeitoun exists to script). Nothing
here is canon until the lead signs design §8 — in particular **O-A** (which
plot) and **O-C** (whether Tel Marum gains a failable primary, explicitly
deferred, not touched here).

**Status vocabulary**, unchanged from Act I: `live` — the mechanism exists in
the schema and the runtime today. `schema` — needs a new field, no runtime
change. `engine` — needs new runtime logic. Applies to the **mechanism** in
each ECA row; the narrative cue's own surface status (`radio`/`eva`/etc.) is
carried in that cell because the two can differ — a trigger can be `live`
while its line waits on the unbuilt radio overlay. One thing is different from
Act I and is why almost nothing here reads `schema`: the 2026-09-03 engine
slice landed `say` on triggers and objectives, `say_on_fail`, `remove`,
`starting_force[].group`, and `dispatch`/`aftermath`/`debrief` — verified in
`mission.schema.json` and `mission.ts:1365,1391,1411,1559` this session. What
was the largest `engine` block in Act I (every mid-mission line) is `live`
here.

Nothing here is written into `data/missions/`, `data/maps/`, or
`packages/sim/`. Every fragment in §§3–4 is copy-ready JSON for
`mission-author` to assemble and validate. **The four Umm Zeitoun skeletons and
the three Tel Marum patches were assembled into a scratch directory outside
this repository and validated with `ajv` against `mission.schema.json`, plus
`tools/validate_narrative.mjs`'s three exported guards, plus a hand-written
semantic pass (groups/zones/markers/`eliminate_hvt` tags/refuge-in-zone)
against the real shipped `tel_marum.json` and `umm_zeitoun.json` — all seven
files PASS every check.** §5 has the method and the one real defect it found
before hand-off.

---

# PART ONE — Tel Marum I–III (re-integration only)

Three missions exist, ship `"triggers": []` in all three, and design §3
changes nothing mechanical in any of them — the whole of Part One is new
top-level story fields (`dispatch`, `debrief`) and `say`/`say_on_fail` added to
**existing** objectives. No new trigger, no new placement, no new wave. That is
why "nothing mechanical should move" is a claim I can make rather than a hope:
a `say`/`say_on_fail` field is read only by `stepTriggers`/`stepObjectives` to
push a `MissionEvent`, never by anything that changes sim state, so the three
shipped scripted plans and the three passive controls are byte-identical in
outcome, time and ROE before and after this patch.

## 1. `tel_marum_1_recon` — Tel Marum I — The Gateway

`recon` · Major · `tel_marum` · requires `roster.surviving_units` · produces
`roster.surviving_units, roe.mission_ratings, campaign.completed_missions,
intel.marked_positions`.

### 1.1 Flags

| flag | kind | fiction |
|---|---|---|
| `find_spotter` (existing objective id) | primary, `locate(tm_spotter_west)` — gains `say` | the moment a contact becomes a person: the whole act rests on this |
| `find_battery` (existing objective id) | primary, `locate(tm_hvt_battery)` — gains `say` | the tube is real, and it has never seen what it fires at |
| `find_pocket_east` / `find_pocket_west` | primary, `locate` — **no `say`, deliberately** | a weapon found is a toast; only a person found is a line (narrative.md §1.6) |
| `screen_out` | secondary, `survive_until(240)` — **cannot fail**, no `say_on_fail` authorable | `survive_until` is not one of the three types `checkEnd` can fail |
| — (no trigger ids; this mission ships none) | | |

### 1.2 ECA rows

| Event Name | IF | THEN | narrative cue bound | status |
|---|---|---|---|---|
| The act opens | mission start | `dispatch` string set (see §3) | narrative.md §1.2 — the settlement, the week, no name, no method | live |
| The eastern pocket is found | `objective(find_pocket_east, complete)` | toast only | `OBJECTIVE COMPLETE — Identify the eastern ATGM pocket` (shipped) | live |
| The western pocket is found | `objective(find_pocket_west, complete)` | toast only | same, west (shipped) | live |
| The spotter is found | `objective(find_spotter, complete)` | `objectives[].say` added | idit: *"That one is not a picket. He is lying still on the west lip with the whole valley in front of him, and everything that has fallen on the north fell because a man was doing that."* | live |
| The battery is found | `objective(find_battery, complete)` | `objectives[].say` added | idit: *"The tube is behind the wall, thirty-eight tiles from your start line. Sight six — it has never once seen the thing it was firing at."* | live |
| Four minutes in the field | `objective(screen_out, complete)` @240s | toast only | shipped, unchanged | live |
| Mission ends | `missionEnd(any)` | `debrief` string set (see §3) | narrative.md §1.5 — honest on a win and a loss | live |

**Row count this mission: 7 live, 0 schema, 0 engine.** (Ambient-lore radio
lines and the win/lose `debrief` split narrative.md also proposes for this
mission are `engine` — G-C/G-D/G-E below — and are not part of the required
patch; they are recorded in the shared gap report, §2.4.)

### 1.3 Effect on the shipped plan

`tools/src/backtest/playtest.ts`'s plan for this mission resolves at **0.9
minutes**, before the first wave (150s) ever spawns — it flies the drone
directly to the answer. Every field this patch touches is read only when an
objective completes or the mission ends; nothing in the plan's own order
sequence, nothing in `enemy.garrison`/`enemy.waves`, nothing in `roe`, is
touched. **The plan's time, ROE and survivor count cannot move.** The passive
control (`ONGOING` at the 20-minute ceiling, per design §3.1's recorded
defect) is equally untouched — it is not part of this patch to fix (design's
**O-C**, explicitly deferred to the lead).

---

## 2. `tel_marum_2_foothold` — Tel Marum II — The Start Line

`foothold` · Major · `tel_marum` · requires `roster.surviving_units,
intel.marked_positions` · produces `roster.surviving_units,
roe.mission_ratings, campaign.completed_missions`. **Briefing unchanged** —
design §3.2 marks this mission *re-brief: no*, and there is no `dispatch` (one
per act, and it belongs to mission I).

### 2.1 Flags

| flag | kind | fiction |
|---|---|---|
| `kill_spotter` | primary, `eliminate_hvt(tm_spotter_west)` — gains `say` | **T7**: the shelling eases, it does not stop — delivered by this line with zero mechanism, because the wave clock already produces the effect |
| `hold_approach` | primary, `hold_for(approach, 240)` — gains `say` | the start line the engineers mark behind the hold |

### 2.2 ECA rows

| Event Name | IF | THEN | narrative cue bound | status |
|---|---|---|---|---|
| The observer dies | `objective(kill_spotter, complete)` | `objectives[].say` added | shai: *"Eyes off that lip. Count the next thirty seconds — anything that still lands is being called by somebody else."* | live |
| The approach is held | `objective(hold_approach, complete)` @240s | `objectives[].say` added | net: *"Approach held. Start line is marked and the engineers are off the ground."* | live |
| Mission ends | `missionEnd(any)` | `debrief` string set | narrative.md §2.5 — *"The shelling was never weather. It is a man on a hill, and there is more than one of him."* | live |

**Row count this mission: 3 live, 0 schema, 0 engine.**

### 2.3 Effect on the shipped plan

The plan resolves at **4.2 minutes** (ratio 0.70 against `target_minutes` 6 —
the one Tel Marum mission whose ratio is informative at all, since it is the
only one carrying an endure-clock, per CLAUDE.md's GH-84 finding). It takes the
southern edge of `approach`, mortars the west pocket from the hollow, and sends
infantry to `[20,16]`. A `say` on an objective's own completion cannot touch
troop movement, targeting, or timing. **Unaffected.**

---

## 3. `tel_marum_3_clearance` — Tel Marum III — The Pass

`clearance` · Major · `tel_marum` · **requires fixed**: was
`["roster.surviving_units"]`, now `["roster.surviving_units",
"intel.marked_positions"]` · produces `roster.surviving_units,
roe.mission_ratings, campaign.completed_missions`.

### 3.1 The `requires` fix

**One line.** `roster.surviving_units` was the only declared read; Act II
spends two missions building a picture (`tm_bay_lip`'s tag is set in mission
I) and this mission does not say it reads one, even though `spawnPlacement`'s
`preMarked` behaviour already means it does — a tag marked in I spawns
pre-identified and ambush-forfeited here, silently. **Verified this session:
`requires` is read by neither `MissionRuntime` (which reads
`ctx.ledger['intel.marked_positions']` directly, unconditionally) nor
`packages/app/src/campaign.ts` (which gates only on
`campaign.completed_missions`)** — so the fix cannot move a single measurement.
It makes the contract honest, nothing else.

### 3.2 Flags

| flag | kind | fiction |
|---|---|---|
| `take_pass` | primary, `capture(pass, 20)` — gains `say` | the pass becomes a road the moment it is held |
| `kill_battery` | primary, `eliminate_hvt(tm_hvt_battery)` — gains `say` | the act's hinge: the file name LANTERN arrives here, nowhere earlier |
| `roe.flagged_zones: ["town_block"]`, `fail_below: 45` | unchanged | the counter-battery bait — the battery sits two tiles from ground the player may not shell |

### 3.3 ECA rows

| Event Name | IF | THEN | narrative cue bound | status |
|---|---|---|---|---|
| Requires the recon | mission load | `ledger.requires` gains `intel.marked_positions` | §3.1 above | live |
| The pass is held | `objective(take_pass, complete)` @20s uncontested | `objectives[].say` added | net: *"Pass is held. Nothing on wheels goes north of the wall by any other road."* | live |
| The battery dies | `objective(kill_battery, complete)` | `objectives[].say` added | idit: *"The tube is down and the north can sleep tonight. Whoever was telling it where to fire has not been on this ground once — the file calls him LANTERN."* | live |
| Mission ends | `missionEnd(any)` | `debrief` string set | narrative.md §3.5 — *"The gun was the cheap half of him. The eyes are what this front is made of."* | live |

**Row count this mission: 4 live, 0 schema, 0 engine.**

### 3.4 Effect on the shipped plan

The plan resolves at **3.5 minutes** (ratio 0.50), takes the wide saddle,
kills the west observer with mortars from the hollow, reaches the battery by
t=240. The `requires` fix is read nowhere the plan's own logic runs; the two
`say` additions fire after an objective the plan already completes.
**Unaffected.**

### 3.5 Twists proposed for this mission — NOT part of the required patch

Both are `level-scripter` proposals per narrative.md §3.6/§10, both would be
this town's **first** triggers, and **both carry a stated risk to the shipped
plan that only `playtest` can retire** — so neither is folded into the
baseline above. Presented here, fully specified, for the lead to accept as a
separate change.

| id | twist | classification | fragment | risk |
|---|---|---|---|---|
| **T-C1** "The tube moves." | `tm_hvt_battery` gets `group:"battery"`; at 40% enemy casualties it withdraws to `town_edge` | **expressible today** | `{"id":"the_tube_backs_into_the_town","on":{"kind":"casualties_pct","value":40},"do":{"kind":"withdraw_to","group":"battery","to":"town_edge"},"say":{"speaker":"idit","text":"The tube is backing into the town block. He is not hiding it from you — he is putting it where your heavy ordnance is the thing that finds it."}}` | design §3.5: *"can walk `kill_battery` out of the shipped plan's reach — `playtest` must re-run."* The plan's last order is an attack-move onto the battery's tile, so it probably still chases and kills it — *probably* is not a measurement |
| **T-C2** "The corridor was watched after all." | On entering the boulder corridor, spawn one `sarim_rifles` at `sarim_west [8,4]` | **expressible today, plus one additive map zone** | needs `narrow_corridor` — see §3.6 | design §3.5: *"4.5 tiles from the plan's last waypoint `[15,8]` — that one is a real risk and must be measured."* |

### 3.6 Map requirement for T-C2 only

| kind | id | rough tile | purpose | exists today |
|---|---|---|---|---|
| zone | `narrow_corridor` | `[10,12,2,6]` — the twelve `b` tiles at x10–11, y12–17 | `zone_entered` target for T-C2 | **missing — additive.** Character grid untouched; a zone nothing names is inert, so I and II are unaffected even if landed |

Trigger fragment for T-C2 (not adopted without a map edit and a `playtest`
re-run):

```json
{
  "id": "the_corridor_was_watched_after_all",
  "on": { "kind": "zone_entered", "zone": "narrow_corridor" },
  "do": { "kind": "spawn", "units": [
    { "unit": "sarim_rifles", "count": 1, "marker": "sarim_west", "stance": { "kind": "hold_position" } }
  ] },
  "say": { "speaker": "idit", "text": "Rifles in the corridor. Somebody was watching the one route the rock was supposed to keep quiet." }
}
```

`sarim_west [8,4]` is an existing marker on `tel_marum.json` (already used by
this mission's own shipped 150s wave) — no map edit needed for the spawn
point, only for the `zone_entered` condition's zone.

### 3.7 Copy-ready fragments — Tel Marum I–III (the required patch only)

**`tel_marum_1_recon.json`** — add `dispatch`, add `say` on two objectives, add
`debrief`:

```json
{
  "dispatch": "For a week the north woke to rockets and nobody could say from where. On the eighth morning one settlement took nine of them before the sirens stopped. No launch was seen, no line plotted. Somebody had been looking at it a long time.",
  "debrief": "Whatever the drone brought back is what the brigade plans on. Whatever it did not is a hill somebody is still sitting on."
}
```

```json
// objectives[] — only the two changed entries; find_pocket_east/west, screen_out unchanged
{ "id": "find_spotter", "type": "locate", "primary": true, "target": "tm_spotter_west",
  "text": "Identify whoever is spotting for the battery",
  "say": { "speaker": "idit", "text": "That one is not a picket. He is lying still on the west lip with the whole valley in front of him, and everything that has fallen on the north fell because a man was doing that." } }
```
```json
{ "id": "find_battery", "type": "locate", "primary": true, "target": "tm_hvt_battery",
  "text": "Find the Grad section behind the wall",
  "say": { "speaker": "idit", "text": "The tube is behind the wall, thirty-eight tiles from your start line. Sight six — it has never once seen the thing it was firing at." } }
```

**A discrepancy found and fixed, not silently.** Narrative.md's own header
claims this `dispatch` is "238 chars"; the verbatim blockquoted text is
**243** — measured by direct count and by `ajv`, 3 over `mission.schema.json`'s
240-character `maxLength`. Rewriting a narrative-designer's line is not this
agent's job, so rather than ship the over-length string as "copy-ready," I cut
the two repetitions of "ever" ("was ever seen" → "was seen", "line ever
plotted" → "line plotted") — a 10-character trim, voice and meaning
unchanged, verified at **233 characters**. Flagged for narrative-designer to
confirm or re-word; this is the version in the JSON above and the only one
that passes `ajv`.

**`tel_marum_2_foothold.json`** — add `say` on two objectives, add `debrief`:

```json
{ "debrief": "The shelling was never weather. It is a man on a hill, and there is more than one of him." }
```
```json
{ "id": "kill_spotter", "type": "eliminate_hvt", "primary": true, "target": "tm_spotter_west",
  "text": "Kill the observer in the west pocket — the shelling will ease, not stop",
  "say": { "speaker": "shai", "text": "Eyes off that lip. Count the next thirty seconds — anything that still lands is being called by somebody else." } }
```
```json
{ "id": "hold_approach", "type": "hold_for", "primary": true, "target": "approach", "seconds": 240,
  "text": "Hold the approach for four minutes",
  "say": { "speaker": "net", "text": "Approach held. Start line is marked and the engineers are off the ground." } }
```

**`tel_marum_3_clearance.json`** — the `requires` fix, `say` on two
objectives, add `debrief`:

```json
{ "ledger": { "requires": ["roster.surviving_units", "intel.marked_positions"],
              "produces": ["roster.surviving_units", "roe.mission_ratings", "campaign.completed_missions"] },
  "debrief": "The gun was the cheap half of him. The eyes are what this front is made of." }
```
```json
{ "id": "take_pass", "type": "capture", "primary": true, "target": "pass", "seconds": 20,
  "text": "Take the pass and hold it for 20 seconds",
  "say": { "speaker": "net", "text": "Pass is held. Nothing on wheels goes north of the wall by any other road." } }
```
```json
{ "id": "kill_battery", "type": "eliminate_hvt", "primary": true, "target": "tm_hvt_battery",
  "text": "Destroy the Grad section",
  "say": { "speaker": "idit", "text": "The tube is down and the north can sleep tonight. Whoever was telling it where to fire has not been on this ground once — the file calls him LANTERN." } }
```

### 3.8 Gap report — Tel Marum only

Everything else narrative.md proposes for these three missions (ambient-lore
radio lines at named terrain features, the `eva` set, the win/lose `debrief`
split, a `radio` line bound to `SimEvent fire`/`contact`/`destroyed`, a `say`
on a wave) is **not required** by this patch and is `engine` for reasons
already ranked in narrative.md §12 (G-C, G-D, G-E, G-J, G-K) — restated once,
combined with Umm Zeitoun's copy of the same gaps, in §4.7 below rather than
twice.

---

# PART TWO — Umm Zeitoun I–IV (full)

**Shared conventions, stated once.** `enemy.faction: "sarim"`,
`doctrine_profile: "standoff overwatch"` across all four (matching Tel Marum's
own flavour string — same faction, same doctrine). `facing_deg` is omitted on
every Umm Zeitoun placement: Tel Marum's shipped 180° throughout reflects a
single-axis corridor with a consistent downhill-facing convention; a basin has
no equivalent single axis, design gives no facing for any of these
placements, and the field is optional, so nothing is invented. `map.file`:
`"umm_zeitoun"`. `map.player_start: [24,45]` on all four, matching the map's
own `kdf_start` marker — design states this explicitly for mission I only;
for II–IV it is this document's own consistent choice (design leaves the
camera-focus point unstated there).

**A ledger-convention ruling, stated once, that departs slightly from a
literal reading of design's prose.** `inf_squad` and `at_team` are
`from_ledger: true` in every mission from I onward — matching design's own
text exactly. `mortar_team` is **never** `from_ledger` in any of the four,
even where design's prose bundles it alongside `inf_squad`/`at_team` in II or
IV: every shipped Tel Marum mission fields `mortar_team` fresh, with no
`from_ledger` flag, in all three missions — an unbroken campaign-wide
precedent I am following rather than breaking on a loosely-worded bundle.
`sniper_team` is fresh (no `from_ledger`) at its first fielding in III, and
`from_ledger: true` in IV — design's own explicit text for IV, and consistent
with it being a genuinely returning unit type by then. Vehicles (`apc_eitan`,
`mbt_lavi`, `ifv_namer`, `jeep_shoded`, `recon_drone`, `demo_squad`) are never
`from_ledger` anywhere in the shipped campaign; none are here either.

**A tile-arithmetic correction, found by mechanically replicating
`assertGroundClear`'s spread formula (`packages/sim/src/mission.ts:890-905`:
`ox=(k%3)*1.25, oy=floor(k/3)*1.25` tiles per body) against the real map, the
same failure class the "Placements spread across tiles" lesson describes.**
Design's own prose coordinates for the from_ledger trio in II are `at_team` at
`[26,45]` — this lands the **second** body of the SAME `inf_squad×3` placement
(base `[24,45]`) on the identical tile `(26,45)`, since `inf_squad`'s spread is
`(24,45)(25,45)(26,45)`. Not a blocked-terrain throw (the tile is open `.`),
but a cosmetic stack the shipped Tel Marum precedent avoids on purpose (there,
`inf_squad` sits at `[24,44]` and `at_team` at `[27,44]`, a clean 3-tile
gap). I moved `at_team` to **`[27,45]`** in all four missions to match that
precedent; similarly moved `mortar_team` from design's stated `[23,45]`
(UZ II only — collides with `apc_eitan×2`'s second body at `(23,45)`) to
**`[23,44]`**, and UZ IV's `demo_squad` from `[21,45]` (collides with
`apc_eitan`'s first body at `(22,45)`) to **`[19,45]`**. **One of these four is
not cosmetic.** UZ IV's `porters` civilian group at design's stated
`[31.5,8.5]` spreads its third body to tile `(34,8)`, which the map's own grid
carries a `s` (shanty) symbol — a real structure, `sim.blocked=1` — and
**would throw** `mission umm_zeitoun_4_clearance: civilians body 3 of 4 spawns
at (34,8), which is blocked` at `MissionRuntime.start()`. Moved to
**`[29.5,9.5]`**, verified clear on all four spread tiles
`(29,9)(30,9)(32,9)(29,10)` — all `.`/`r`, none blocked. All four corrections
are folded into §4's skeletons directly; none is a fiction change (the porters
are still "on the depot ground," roughly a lane west of the original point).
Verified by a second, independent script (§5) that every remaining placement
in all four missions — garrison, wave, structure — produces zero blocked-tile
spawns and zero same-tile overlaps at all.

**One wave target that names a zone, not a marker, corrected.** Design's UZ II
cadence gives the 300s wave's destination as `crest_line` — that is the
**zone** `hold_the_crest_line` targets, and it has no matching marker (unlike
Tel Marum's `approach`, which is both a marker and a zone of the same name on
`tel_marum.json`). The vocabulary is explicit: `to` names a marker, never a
zone. Substituted **`rim_crest`**, the marker the map itself places inside
that zone (`[24,41]`, within `crest_line`'s `[18,40,13,2]` bounds) — the same
substitution the map's own naming convention invites, and the only marker
inside the zone at all.

---

## 4. `umm_zeitoun_1_recon` — Umm Zeitoun I — Cold Ground

`recon` · Major · `umm_zeitoun` · requires `roster.surviving_units` ·
produces `roster.surviving_units, roe.mission_ratings,
campaign.completed_missions, intel.marked_positions,
civ.settlements_evacuated`. `target_minutes` 6. **Failable primary:
`get_the_wells_clear`.**

### 4.1 Flags

| flag | kind | fiction |
|---|---|---|
| `find_the_crest` | primary, `locate(uz_eye_crest)` | the fourth hill, unreachable by the drone without paying the MANPAD envelope |
| `find_the_west_horn` | primary, `locate(uz_eye_west)` | free from `[14,30]`, outside both MANPAD envelopes |
| `find_the_east_horn` | primary, `locate(uz_eye_east)` | the mirror of the west, across the floor |
| `find_the_stone_knoll` | primary, `locate(uz_eye_knoll)` | plants Umm Zeitoun II and III two missions early |
| `get_the_wells_clear` | **primary, `evacuate_before(refuge_wadi, 2, 240)` — the one objective on this map that can fail** | at least 2 of 3 families reach the wadi before somebody else moves them |
| `find_the_missile_team` | secondary, `locate(uz_manpad_basin)` | the drone's own tax, named |
| `screen_out` | secondary, `survive_until(240)` — cannot fail | the same patrol-endurance order as Tel Marum I |
| `they_move_the_families_off` (trigger id) | `timer_s(242)` → `remove(wells_families)` | T-U1: whoever is left at the wells is walked off, not fought over |

### 4.2 ECA rows

| Event Name | IF | THEN | narrative cue bound | status |
|---|---|---|---|---|
| Crest post identified | `objective(find_the_crest, complete)` | toast + `say` | idit: *"That is the crest post, and I have him for as long as something is looking at him. Nothing of ours can hold that from outside thirteen tiles."* — states **T-U2**'s decay rule at the moment it matters | live |
| West horn identified | `objective(find_the_west_horn, complete)` | toast + `say` | idit: *"West horn is a post, not a picket. He is lying on the shoulder with the whole western floor under him."* | live |
| East horn identified | `objective(find_the_east_horn, complete)` | toast + `say` | idit: *"East horn the same, across the basin. Between the two of them there is no line across this floor that nobody sees."* | live |
| Stone knoll identified | `objective(find_the_stone_knoll, complete)` | toast + `say` | idit: *"The near one is in the shed on the stone knoll, four tiles from the wadi road. That is the eye that matters to the families, not to us."* | live |
| Missile team identified | `objective(find_the_missile_team, complete)` | toast + `say` | idit: *"Missile team on the northern shelf. Air only, thirteen tiles — the drone crosses that line once."* | live |
| A family reaches the wadi | `evacuated` event (per `CivilianFlight.collect`) | nothing spoken | **G-B** (Act I) still open: `describeMissionEvent` has no `evacuated` case | engine |
| Two families clear | `objective(get_the_wells_clear, complete)` @≤240s | toast + `say` | shai: *"Two families in the wadi. Leave the rest of that flank alone; nothing else out there is worth the jeep."* | live |
| Four minutes run out short | `objective(get_the_wells_clear, failed)` @240s | toast + `say_on_fail` | shai: *"Four minutes. Whatever is still at the wells is not ours to move now."* — the mission's own loss line | live |
| Rifle section to the wells | wave t=150s, 1 `sarim_rifles` from `sarim_west` → `uz_wells` | toast (hard-coded) | narrative proposes a `radio` line here; **a wave cannot carry `say`** | live (wave) / engine (line, **G12/G-D**) |
| Rifles to the centre | wave t=260s, 2 `sarim_rifles` from `sarim_north` → `lane_centre` | toast | none proposed | live |
| The wells are swept | `timer_s(242)` → `they_move_the_families_off` | `do:{remove, group:wells_families}` + `say` | idit: *"The wells are empty and nobody fought over them. They walked them north between the hills while we were looking at the hills."* — **T-U1** | live |
| Drone lost | `SimEvent destroyed` on `recon_drone` | nothing authored | idit's proposed line (**T-U3**) needs a trigger that watches a `SimEvent` | engine (**G8/G-E**) |
| Four minutes screened | `objective(screen_out, complete)` @240s | toast | shipped shape, unchanged | live |
| Mission ends | `missionEnd(any)` | `debrief` | *"Four hills, and a drone that can only pay for some of them. That is the whole of Sur in one night."* | live |

**Row count this mission: 12 live, 0 schema, 2 engine** (the `evacuated`
silence and the `SimEvent`-watching lines; the wave's own spawn is `live`,
only its proposed spoken line is `engine`).

### 4.3 AI director

**Placements** (all `hold_position` unless stated — no `stance` field
authored for a plain hold, matching the shipped Tel Marum convention):

| tag/group | unit | count | at/marker | stance |
|---|---|---|---|---|
| `uz_eye_crest` | `sarim_rifles` | 1 | `[14.5,7.5]` | — |
| `uz_eye_west` | `sarim_rifles` | 1 | `[10.5,23.5]` | — |
| `uz_eye_east` | `sarim_rifles` | 1 | `[37.5,23.5]` | — |
| `uz_eye_knoll` | `sarim_rifles` | 1 | `[23.5,33.5]` | `garrison`, building `[21,33]` |
| `uz_manpad_north` | `manpad_team` | 1 | `[20.5,12.5]` | — (air-only weapon; cannot engage ground at all) |
| `uz_manpad_basin` | `manpad_team` | 1 | `[30.5,22.5]` | — |
| `uz_atgm_glacis` | `atgm_cell` | 1 | `[34.5,20.5]` | `ambush(10)` |
| `uz_battery`, group `battery` | `rocket_battery` | 1 | marker `battery_south` | — |
| group `wells_families` | `civilians` | 3 | `[14.5,35.5]` | shelter-in-place (civilian rule, not a stance) |

**Cadence table:**

| t (s) | mechanism | size | from | to | group |
|---|---|---|---|---|---|
| 0 | garrison ×8 | 1 each | (see above) | — | — |
| 0 | civilians | 3 | `[14.5,35.5]` | — | `wells_families` |
| 150 | wave | 1 | `sarim_west` | `uz_wells` | — |
| 242 | trigger (`remove`) | up to 3 | `wells_families` (player-adjacent) | — (removed) | — |
| 260 | wave | 2 | `sarim_north` | `lane_centre` | — |

**Pressure curve.** Sarim doctrine is standoff — the whole net at t=0 is
observation-only, and neither wave (3 bodies at 150s, 2 at 260s) is remotely
close to Tel Marum I's own measured stall point (24 attackers) or stand-up
fight (28). Nothing here is meant to be fought; the pressure is entirely a
resource-and-clock puzzle. One jeep can screen the drone's approach to the
MANPAD envelopes **or** ferry a family — never both — and identifying the
fourth post (the crest) is measured (design §4.4 E) to cost the drone its own
life no matter which station is chosen. The families' own four-minute clock
runs the whole time underneath the recon, independent of it, and is the one
thing in the mission that can actually end it early.

### 4.4 Map requirements

Checked directly against `data/maps/umm_zeitoun.json` this session — every
marker and zone below **already exists**, byte-identical to design §4.4.

| kind | id | rough tile | purpose | exists today |
|---|---|---|---|---|
| marker | `uz_wells` | `[14,35]` | civilian group's floor; wave target | **EXISTS** |
| marker | `lane_centre` | `[24,20]` | wave target, outside every rifle post's sight-9 | **EXISTS** |
| marker | `sarim_west`, `sarim_north` | `[3,12]`, `[24,3]` | wave spawn points | **EXISTS** |
| marker | `battery_south` | `[30,30]` | battery spawn | **EXISTS** |
| zone | `refuge_wadi` | `[21,36,5,3]` | evacuation target; **contains `civ_refuge [23,37]`, verified** | **EXISTS** |

**No new map content needed for this mission.**

### 4.5 Twists

| id | twist | classification | note |
|---|---|---|---|
| **T-U1** "They were gone before you got there." | the 242s `remove` sweep | **expressible today** — `remove` landed 2026-09-03 | authored in §4.7 below |
| **T-U2** "The fourth hill is not a hill." | the crest's identification decays back to unknown once nothing holds a sight line on it | **expressible today — already true, needs no authoring** | `revealAt` is not exempt from decay; this is a fact about the sim, stated in the crest's own `say` line, not a mechanism to build |
| **T-U3** "The drone is the mission." | losing the `recon_drone` costs nothing here and everything in III's tag-based ambush forfeiture | **engine** | needs a trigger that watches a `SimEvent` (`destroyed`), i.e. G8/G-E |

### 4.6 Loss condition (for `playtest`)

**`evacuate_before(refuge_wadi, count 2, seconds 240)` reaches `failed`.** A
passive player never comes within `SHEPHERD_RADIUS_SQ` (4 tiles,
`civilians.ts`) of the wells, `CivilianFlight` never orders anyone to flee, the
count stays 0, and the primary fails at the deadline — `checkEnd` returns
DEFEAT. All four `locate` primaries also stay incomplete on a passive run (no
sight-9-to-16 unit parked at `kdf_start` sees a post 15–40 tiles away), but the
evacuation is the objective that actually ends the mission on the clock.

### 4.7 Gap report

| gap | cites | Umm Zeitoun I impact |
|---|---|---|
| **G8/G-E** — a trigger cannot fire on an objective or a `SimEvent` | design §7, narrative §12 | blocks T-U3's line (drone lost) and the proposed wave-arrival `radio` line |
| **G12/G-D** — a wave cannot carry `say` | design §7, narrative §12 | blocks both wave rows' proposed lines; the spawn itself is unaffected |
| **G-B** (Act I) — `evacuated` produces no toast/line | narrative §4.6 | every family reaching the wadi is silent until the fourth or the deadline |

---

## 5. `umm_zeitoun_2_buildup` — Umm Zeitoun II — The Long Look

`buildup` · Major · `umm_zeitoun` · requires `roster.surviving_units,
intel.marked_positions` · produces `roster.surviving_units,
roe.mission_ratings, campaign.completed_missions`. `target_minutes` 7.
**Economy: yes.** **Failable primary: `level_the_stone_post`.**

### 5.1 Flags

| flag | kind | fiction |
|---|---|---|
| `hold_the_crest_line` | primary, `hold_for(crest_line, 240)` — **cannot fail, only stall** | the highest southern ground, seen and shelled at once |
| `level_the_stone_post` | **primary, `raze(post_stone, 300)` — the only failable objective in this mission** | the shed is not the man; the man is replaceable, the shed is the objective |
| `kill_the_knoll_eye` | secondary, `eliminate_hvt(uz_eye_knoll)` | the reward the player will not understand until III |
| `take_the_stone_knoll` | secondary, `capture(post_stone, 15)` | T-U6: the ground itself, held briefly, contested again at 300s by the last wave |
| `the_tube_moves_north` (trigger id) | `casualties_pct(30)` → `withdraw_to(battery → battery_north)` | 12.5 tiles becomes 28.2: killing a third of the garrison ends the shelling of the line |

### 5.2 ECA rows

| Event Name | IF | THEN | narrative cue bound | status |
|---|---|---|---|---|
| Crest line held 4 minutes | `objective(hold_the_crest_line, complete)` @240s cumulative | toast + `say` | net: *"Crest line held four minutes. Engineers are off it."* | live |
| Post levelled in time | `objective(level_the_stone_post, complete)` @≤300s | toast + `say` | shai: *"Post is down. Nobody replaces an observer on a heap of blocks — they replace him on the next hill."* | live |
| Post NOT levelled | `objective(level_the_stone_post, failed)` @300s | toast + `say_on_fail` | shai: *"Five minutes gone and the shed is still standing. He has watched everything we put on that line."* — the mission's own loss line | live |
| Knoll observer dies | `objective(kill_the_knoll_eye, complete)` | toast + `say` | idit: *"Knoll post is down. The wadi road is unobserved for the first time since we came into this basin."* | live |
| Knoll held 15s | `objective(take_the_stone_knoll, complete)` | toast, **no `say` deliberately** | narrative.md: *"the toast is the whole beat, and T-U6 says they come back for it"* | live |
| Battery displaces | `casualties_pct(30)` → `the_tube_moves_north` | `withdraw_to`, group `battery` → `battery_north` + `say` | idit: *"Battery is displacing north. Twenty-eight tiles to the crest line from there — that is what taking a third of them off him buys."* | live |
| Rifles reinforce the knoll | wave t=90s, 2 `sarim_rifles` from `sarim_west` → `knoll_stone` | toast | none proposed | live |
| Recoilless to the crest | wave t=180s, 1 `recoilless_team` from `sarim_north` → `rim_crest` | toast (proposed line: **T-U4**'s companion) | a wave cannot speak | live (wave) / engine (line) |
| Kamikaze at the camp | wave t=210s, 1 `loiter_drone` from `sarim_north` → `camp_ground` | toast | **T-U4**, "the camp is the target" — same wave-say limit | live (wave) / engine (line) |
| Ground retaken | wave t=300s, 2 `sarim_rifles` from `sarim_east` → `rim_crest` (marker substitution, §2 above) | toast | **T-U6**, deliberately no line | live |
| A purchased squad arrives | `built` event | toast (hard-coded, prints raw unit id) | Act I's **G-D**, still open | engine |
| Mission ends | `missionEnd(any)` | `debrief` | *"Nobody replaces an observer on a heap of blocks. They replace him on the next hill."* | live |

**Row count this mission: 9 live, 0 schema, 4 engine** (two wave-say lines,
the `built` display-name gap, and the un-authored `SimEvent fire` EVA line).

### 5.3 AI director

**Placements:**

| tag/group | unit | count | at/marker | stance |
|---|---|---|---|---|
| `uz_eye_knoll`, group `knoll` | `sarim_rifles` | 1 | `[23.5,33.5]` | `garrison`, building `[21,33]` (shed still standing at mission start) |
| `uz_eye_west` | `sarim_rifles` | 1 | `[10.5,23.5]` | — |
| `uz_eye_east` | `sarim_rifles` | 1 | `[37.5,23.5]` | — |
| `uz_manpad_basin` | `manpad_team` | 1 | `[30.5,22.5]` | — |
| `uz_rcl_south` | `recoilless_team` | 1 | `[27.5,32.5]` | `ambush(6)` |
| `uz_battery`, group `battery` | `rocket_battery` | 1 | marker `battery_south` | — |

**Structure:** one `camp`, `at [20,43] size [2,2]` (footprint verified clear
of every starting-force spawn and its spread, §5 below; includes the
`camp_ground` marker `[21,44]`).

**Cadence table:**

| t (s) | mechanism | size | from | to | group |
|---|---|---|---|---|---|
| 0 | garrison ×5 | 1 each | (see above) | — | — |
| 0 | structure | — | — | `camp` at `[20,43]` | — |
| 90 | wave | 2 | `sarim_west` | `knoll_stone` | — |
| 180 | wave | 1 | `sarim_north` | `rim_crest` | — |
| 210 | wave (kamikaze) | 1 | `sarim_north` | `camp_ground` | — |
| \~200 (30% dead, data-dependent) | trigger | — | `battery` | `battery_north` | `battery` |
| 300 | wave | 2 | `sarim_east` | `rim_crest` | — |

**Pressure curve.** This is the war's second build-up and the only phase Act
II can justify one in, and the cadence matches: light, escalating pressure
(2, then 1, then a single kamikaze, then 2 more) rather than volume, because
the real cost is the crest line standing under the Grad's fire (12.5 tiles
from `battery_south`) for as long as the player takes. The 210s loiter_drone
is the one wave that punishes inattention specifically — it goes for
`camp_ground`, not the line, so a player who commits everything forward loses
the thing he is building. The economy (500 + 150/min logistics, one satellite
sweep's worth of intel) exists so a good plan can hold the line **and** push a
demolition party at once; the raze's 300s deadline and the hold's 240s run
concurrently and pull the force in opposite directions, which is the mission's
whole argument.

### 5.4 Map requirements

| kind | id | rough tile | purpose | exists today |
|---|---|---|---|---|
| zone | `crest_line` | `[18,40,13,2]` | `hold_for` target | **EXISTS** |
| zone | `post_stone` | `[21,32,4,3]` — exactly 2 `s` tiles, verified | `raze`/`capture` target | **EXISTS** |
| marker | `camp_ground` | `[21,44]` | structure anchor | **EXISTS** |
| marker | `rim_crest` | `[24,41]`, inside `crest_line` | **substituted for design's `crest_line`** as the 300s wave's `to` (§2 above) | **EXISTS** |
| marker | `knoll_stone`, `sarim_west`, `sarim_north`, `sarim_east`, `battery_south` | (map's own coords) | wave/garrison anchors | **EXISTS** |

**No new map content needed.**

### 5.5 Twists

| id | twist | classification | note |
|---|---|---|---|
| **T-U4** "The camp is the target." | 210s loiter_drone targets `camp_ground`, not the line | **expressible today** — spawn/wave already authored | the spoken line ("Something small and low is going for the camp...") is `engine`, G12/G-D |
| **T-U5** "He watched you dig it." | the knoll post's field of view is measured to cover `crest_line` and exclude `staging` | **live — text, not a mechanism** | design §4.4 A: measured, all seven observer positions blind to the staging bowl, sighted on the rim |
| **T-U6** "They come back for the hill." | the 300s wave retakes the razed post's ground | **expressible today, already authored** — the wave itself is the twist; deliberately no line | argues for `capture(post_stone,15)` staying a secondary, which it is |

### 5.6 Loss condition (for `playtest`)

**`raze(post_stone, seconds 300)` reaches `failed`.** A passive player orders
no demolition and fires no shot at the shed; `hold_for` cannot itself fail
(only `capture` resets on contest — `hold_for` is cumulative and simply never
reaches 240s of accumulated presence if the force never occupies the zone);
the force is never wiped. The raze deadline is the whole loss condition.

### 5.7 Gap report

| gap | cites | Umm Zeitoun II impact |
|---|---|---|
| **G12/G-D** — a wave cannot speak | design §7, narrative §12 | blocks the 180s/210s waves' proposed lines |
| **G-I** (Act I) — `built` prints a raw unit id | narrative §12 | this is the one mission in the act that buys units repeatedly |
| **G10 (corrected)** — no authored intel *rate* field | design §7 | not blocking: `intel_start:150` alone funds one satellite sweep; the drone/stationary-scout accrual (8/5 per min) already exists with no schema change |

---

## 6. `umm_zeitoun_3_clearance` — Umm Zeitoun III — Blinding

`clearance` · Major · `umm_zeitoun` · requires `roster.surviving_units,
intel.marked_positions` · produces `roster.surviving_units,
roe.mission_ratings, campaign.completed_missions, intel.marked_positions,
civ.settlements_evacuated`. `target_minutes` 7. **Failable primary:
`get_the_hamlet_out`.**

### 6.1 Flags

| flag | kind | fiction |
|---|---|---|
| `kill_the_west_horn` / `kill_the_east_horn` | primary, `eliminate_hvt` — cannot fail | the two posts, measured identical at 18 tiles and mechanically opposite (scree vs. bare glacis) |
| `get_the_hamlet_out` | **primary, `evacuate_before(refuge_wadi, 4, 300)` — the only failable objective** | the act's ROE bait, made mechanical |
| `find_adhal` | secondary, `locate(uz_hvt_lantern)` | the name arrives here, 34 tiles out, unreachable; nothing follows |
| `kill_the_knoll_eye` | secondary, `eliminate_hvt(uz_eye_knoll)` | **T-U7** paid off: the eye the player may have left alive in II is why the road is watched here |
| `he_brings_the_tube_south` (trigger id) | `casualties_pct(35)` → `withdraw_to(battery → battery_south)` | the battery moves onto ground from which it CAN reach the hamlet and the wadi road |
| `the_house_was_the_section` (trigger id, corrected mechanism — see §6.3) | `zone_entered(hamlet)` → `commit(hamlet_garrison → hamlet_square)` | the two garrisoned houses come out into the street rather than fighting from cover |

### 6.2 ECA rows

| Event Name | IF | THEN | narrative cue bound | status |
|---|---|---|---|---|
| West horn dies | `objective(kill_the_west_horn, complete)` | toast + `say` | idit: *"West horn is blind. Half the floor belongs to nobody now."* | live |
| East horn dies | `objective(kill_the_east_horn, complete)` | toast + `say` | idit: *"East horn is blind. Whatever he calls from here he calls off a map, not off the ground."* | live |
| Adhal located | `objective(find_adhal, complete)` | toast + `say` | idit: *"That is Karim Adhal, on the northern crest, thirty-four tiles out. Two towns of his work and this is the first time anybody has had his ground."* — **T-U8** | live |
| Knoll eye dies | `objective(kill_the_knoll_eye, complete)` | toast + `say` | idit: *"Knoll is clear. Nothing left in this basin can put a round on the wadi road by looking at it."* | live |
| Battery displaces south | `casualties_pct(35)` → `he_brings_the_tube_south` | `withdraw_to`, group `battery` → `battery_south` + `say` | idit: *"Battery is coming south. From that position it reaches the hamlet at seven tiles and the wadi road at ten, and every round of it is his."* — **T8-U** | live |
| A civilian dies to enemy fire | `destroyed` on a civilian, `by` an enemy unit | **no ROE deduction** | `stepRoe` bills only a `destroyed` whose `by` is `side===0`; the act's ROE thesis (T8) delivered with zero engine work | live (as an absence) |
| A family reaches the wadi | `evacuated` event | nothing spoken | Act I's **G-B**, still open | engine |
| Four families out in time | `objective(get_the_hamlet_out, complete)` @≤300s | toast + `say` | shai: *"Four out of the block. Nothing else in there is worth a round from the tubes."* | live |
| Four NOT out in time | `objective(get_the_hamlet_out, failed)` @300s | toast + `say_on_fail` | shai: *"Clock is out on the hamlet. They are under his rockets now and we are not going back through them."* — the mission's own loss line | live |
| First shot lands inside the flagged hamlet | `nearMiss`/`fire` with `collateral_risk ≥ 0.3`, player shooter | ROE −5 | hard-coded `roeNotice`; proposed `radio` line needs a sim-watching trigger | live (mechanism) / engine (line, G8/G-E) |
| Garrison ordered into the street | `zone_entered(hamlet)` → `the_house_was_the_section` | `commit`, group `hamlet_garrison` → `hamlet_square` + `say` | idit: *"They are out of the houses and into the street. They will not fight you from in there — they were never going to."* — **T-U9, corrected**, see §6.3 | live |
| Rifles to the west horn | wave t=120s, 2 `sarim_rifles` from `sarim_west` → `horn_west` | toast | none proposed | live |
| Recoilless to the east horn | wave t=240s, 1 `recoilless_team` from `sarim_east` → `horn_east` | toast | none proposed | live |
| Rifles into the square | wave t=330s, 2 `sarim_rifles` from `sarim_north` → `hamlet_square` | toast (proposed line) | *"He is putting rifles into the square while the families are still walking out of it."* — a wave cannot speak | live (wave) / engine (line) |
| Mission ends | `missionEnd(any)` | `debrief` | *"A block like that is blind in both directions. That is not an accident and it is not geology."* | live |

**Row count this mission: 12 live, 0 schema, 3 engine** (the `evacuated`
silence, the flagged-zone deduction's spoken line, and the 330s wave's line).

### 6.3 T-U9, corrected — `dismount` does not mean what the twist needs

Narrative.md and design both classify T-U9 ("the house was the section — a
garrison dismounts into the street on `zone_entered(hamlet)`") as
**expressible today, because `dismount` is a live `do.kind`.** That is true of
`dismount` in isolation and **false of its application here.**
`stepTriggers`' `dismount` branch (`mission.ts:1394-1408`) does exactly one
thing: it queues an `unload` command against every living, unburied member of
`group`, i.e. it empties passenger seats out of **carrier vehicles**. It has
no effect on a `garrison`-stance infantry placement, which is not aboard
anything. **Verified this session: no Sarim unit in the roster carries
`hull.transport_slots`** (`grep -rl transport_slots data/units/enemy/` returns
exactly one file, `technical.json` — and `technical` is `faction: "rif"`,
Naharin's smuggler doctrine, wrong front entirely for a Sur mission). There is
therefore no way to build the twist as literally specified without either
importing a Rif Cells vehicle into a Sarim mission (a doctrine violation
GDD §2 and narrative.md §0.4 both forbid) or leaving `dismount` addressing an
empty/no-op group.

**The correct verb is `commit`.** `commit`/`withdraw_to`'s handler filters
only on `alive && tunnelIn<0` — it does not care what stance a unit currently
holds, and queuing an attack-move against a `garrison`-stance body walks it
out of the building exactly as a `dismount` would walk a passenger out of a
hull. This is not merely a technical substitute: it is a **better** telling of
Idit's own line — *"they will not fight you from in there"* reads as the
garrison choosing the street, which `commit` produces (an ordered move
overriding the standing stance), where `dismount` would have produced nothing
at all. Fragment in §6.6 uses `commit`; the `dismount` framing in the source
sheets should be corrected there too.

### 6.4 AI director

**Placements:**

| tag/group | unit | count | at | stance |
|---|---|---|---|---|
| `uz_eye_west` | `sarim_rifles` | 1 | `[10.5,23.5]` | — |
| `uz_eye_east` | `sarim_rifles` | 1 | `[37.5,23.5]` | — |
| `uz_eye_knoll` | `sarim_rifles` | 1 | `[23.5,33.5]` | — (no `garrison`: the shed is rubble after II's raze) |
| `uz_manpad_basin` | `manpad_team` | 1 | `[30.5,22.5]` | — |
| `uz_atgm_glacis` | `atgm_cell` | 1 | `[34.5,20.5]` | `ambush(10)` — same tag as mission I; forfeits ambush if identified there |
| `uz_atgm_lateral` | `atgm_cell` | 1 | `[17.5,19.5]` | `ambush(10)` — new tag, no carry-over |
| group `hamlet_garrison` | `sarim_rifles` ×2 (separate placements) | 1 each | `[20.5,24.5]`, `[26.5,27.5]` | `garrison`, buildings `[20,24]` and `[26,27]` |
| `uz_rcl_hamlet` | `recoilless_team` | 1 | `[25.5,27.5]` | `ambush(6)` |
| `uz_hvt_lantern`, group `lantern` | `sarim_rifles` | 1 | `[13.5,6.5]` | — (seen, not reachable this mission) |
| `uz_battery`, group `battery` | `rocket_battery` | 1 | marker `battery_west` | — |

**Civilians:** `hamlet_north` ×3 at `[22.5,26.5]`, `hamlet_south` ×3 at
`[21.5,28.5]`, refuge `civ_refuge`.

**Cadence table:**

| t (s) | mechanism | size | from | to | group |
|---|---|---|---|---|---|
| 0 | garrison ×10 | 1 each | (see above) | — | — |
| 0 | civilians ×2 groups | 3 each | — | — | `hamlet_north`/`hamlet_south` |
| 120 | wave | 2 | `sarim_west` | `horn_west` | — |
| \~ (35% dead) | trigger | — | `battery` | `battery_south` | `battery` |
| 240 | wave | 1 | `sarim_east` | `horn_east` | — |
| player enters `hamlet` | trigger | — | `hamlet_garrison` | `hamlet_square` | `hamlet_garrison` |
| 330 | wave | 2 | `sarim_north` | `hamlet_square` | — |

**Pressure curve.** Three light waves, each reinforcing exactly the ground a
normal plan is pressing at that moment — the volume punishes slowness, not
presence. The real pressure is structural: two Kornet ambushes at 10 tiles
bracket the whole floor (one a known quantity from the recon, one new), the
hamlet is simultaneously the ROE trap and the evacuation's own ground, and the
battery's displacement trigger converts "keep pressing" into "the hamlet is
now inside the Grad's envelope" — which argues for evacuating early rather
than late, before the fight itself trips the withdrawal.

### 6.5 A finding this mission's ROE bait depends on: `spike_atgm` arms the
flagged-zone penalty

Design's own briefing beat 4 lists which weapons may fire inside the flagged
`hamlet` and deliberately does not rule on `at_team`'s `spike_atgm`
(`collateral_risk: 0.3`), because it sits exactly on the 0.3 structural
threshold. **Measured this session, in Q16.16 exactly as `sim.ts` computes
it:** `fx.from(0.3) = 19661` (`Math.round(0.3×65536+0.5)` truncated), and
`STRUCTURAL_COLLATERAL` (`mission.ts:326`) is also `19661`. The zone-penalty
check (`mission.ts:1188`) is `if (weapon.collateralRisk < STRUCTURAL_COLLATERAL) continue`
— i.e. it **skips** (no penalty) only when strictly below the threshold.
`19661 < 19661` is false, so **the check does not skip; `spike_atgm` arms the
flagged-zone penalty**, exactly like `cannon_30` (0.35), `gun_120` (0.55),
`mortar_60` (0.70) and `charges` (0.60) — not like `rifles` (0.10), `coax_mg`
(0.20), `rws_50` (0.25) or `amr` (0.05), all independently confirmed against
the shipped unit JSON this session. **The AT team may not fire into the
hamlet without cost.** This is a measured fact, not a schema gap or a design
choice to make; the briefing text (§6.6) should say so rather than stay
silent on it.

### 6.6 Map requirements

| kind | id | rough tile | purpose | exists today |
|---|---|---|---|---|
| zone | `hamlet` | `[19,24,9,5]` | `roe.flagged_zones`, `zone_entered` trigger target | **EXISTS** |
| zone | `refuge_wadi` | `[21,36,5,3]` | `evacuate_before` target | **EXISTS** |
| marker | `hamlet_square` | `[24,26]`, inside `hamlet` | `commit` destination for the corrected T-U9 | **EXISTS** |
| marker | `horn_west`, `horn_east`, `battery_west`, `sarim_west`, `sarim_east`, `sarim_north` | (map's own coords) | wave/garrison anchors | **EXISTS** |

**No new map content needed.**

### 6.7 Twists

| id | twist | classification | note |
|---|---|---|---|
| **T8-U** "The battery fires into its own [ground]." | the 35%-casualties displacement onto ground that reaches the hamlet and the wadi road | **expressible today** — placement + `withdraw_to`, zero sim work | the engine version of T8 (choosing where a specific round lands) stays cut, G13/G-F |
| **T-U7** "The eye you left alive." | `uz_eye_knoll`, a secondary in II, is why the road is watched here if the player skipped it | **expressible today, already the design** | the payoff needs no new mechanism — the same tag, a secondary in each mission |
| **T-U9** "The house was the section." | corrected: `commit`, not `dismount` — see §6.3 | **expressible today, corrected mechanism** | do not author the `dismount` version; it is a silent no-op against this roster |

### 6.8 Loss condition (for `playtest`)

**`evacuate_before(refuge_wadi, count 4, seconds 300)` reaches `failed`.** A
passive player never comes within shepherd radius of either hamlet group;
both `eliminate_hvt` primaries also stay incomplete, but the evacuation is the
timed one. Design's own §5.6 additionally asks for a **deliberately careless**
plan variant (clearing the hamlet with `ifv_namer`'s `cannon_30`) to be run and
its ROE cost recorded, mirroring Beit Sahwan III's measured 55-of-61-point
loss for the same mistake — that measurement is `playtest`'s to run once the
file exists, not mine to estimate.

### 6.9 Gap report

| gap | cites | Umm Zeitoun III impact |
|---|---|---|
| **G8/G-E** — trigger cannot watch a `SimEvent` | design §7, narrative §12 | blocks the flagged-zone deduction's proposed spoken line |
| **G12/G-D** — wave cannot speak | design §7, narrative §12 | blocks the 330s wave's line |
| **G-B** (Act I) — `evacuated` silent | narrative §12 | this mission scores fatally on the mechanic that produces no feedback |
| §6.5's finding | this document | not a gap — a measured fact that should be written into the briefing, not engineered around |

---

## 7. `umm_zeitoun_4_clearance` — Umm Zeitoun IV — The Stockpile

`clearance` · Major → Lieutenant Colonel at the **act boundary**, never inside
this mission · `umm_zeitoun` · requires `roster.surviving_units,
intel.marked_positions` · produces `roster.surviving_units,
roe.mission_ratings, campaign.completed_missions`. `target_minutes` 7.
**Economy: yes. Failable primary: `raze_the_stockpile`. Act II and Karim Adhal
both end here.**

### 7.1 Flags

| flag | kind | fiction |
|---|---|---|
| `raze_the_stockpile` | **primary, `raze(stockpile, 300)` — the only failable objective** | 7,500 hp, no dozer in Sur, two demolition parties at a time |
| `kill_adhal` | primary, `eliminate_hvt(uz_hvt_lantern)` — cannot fail, no deadline | the front's whole question, ended with the front's own ordinary weapon: a `sarim_rifles` body |
| `kill_the_battery` | secondary, `eliminate_hvt(uz_battery)` | Sur's last tube |
| `get_the_porters_clear` | secondary, `evacuate_before(north_shelf, 3, 240)` — can fail, but a secondary failing does not lose the mission | a bill, not a trap |
| `bring_the_relay_down` | secondary, `raze(crest_top)` — no deadline; a secondary that never completes costs nothing | the ending is a building coming down, not a speech |
| `the_tube_goes_west` (trigger id) | `casualties_pct(40)` → `withdraw_to(battery → battery_west)` | takes the yard out of the Grad's reach entirely (22.4 tiles) |
| `he_goes_over_the_back` (trigger id) | `casualties_pct(50)` → `withdraw_to(lantern → crest_reverse)` | Adhal does not wait; a slow player climbs for him |

### 7.2 ECA rows

| Event Name | IF | THEN | narrative cue bound | status |
|---|---|---|---|---|
| Depot razed in time | `objective(raze_the_stockpile, complete)` @≤300s | toast + `say` | shai: *"Depot is down. That is what was coming over the wall at Tel Marum, and it is not coming again."* | live |
| Depot NOT razed | `objective(raze_the_stockpile, failed)` @300s | toast + `say_on_fail` | shai: *"Five minutes. The depot is standing and the parties that were going to bring it down are not."* — the mission's own loss line | live |
| Battery displaces west | `casualties_pct(40)` → `the_tube_goes_west` | `withdraw_to`, group `battery` → `battery_west` + `say` | **enemy**, `speaker:"enemy"`, no name — Adhal's one line in the whole act: *"Move it west. The tube was never what had to see — that has been on the hill since long before the first rocket, and it does not close."* | live |
| Adhal goes over the back | `casualties_pct(50)` → `he_goes_over_the_back` | `withdraw_to`, group `lantern` → `crest_reverse` + `say` | net: *"He is over the back of the crest and out of sight of the basin. Whoever wants him climbs."* | live |
| Adhal killed | `objective(kill_adhal, complete)` | toast + `say` | idit: *"Adhal is off the crest. He never fired a round in this war and he chose where every one of them landed."* — the act's last word on him | live |
| Battery destroyed | `objective(kill_the_battery, complete)` | toast + `say` | idit: *"Battery is finished. Sur has nothing left that reaches Kedem."* | live |
| A porter reaches the shelf | `evacuated` event | nothing spoken | Act I's **G-B**, still open | engine |
| Three porters clear in time | `objective(get_the_porters_clear, complete)` @≤240s | toast + `say` | shai: *"Porters are on the shelf. Nothing of ours goes north of the yard for them."* | live |
| Porters NOT clear | `objective(get_the_porters_clear, failed)` @240s — **secondary; does not lose the mission** | toast + `say_on_fail` | shai: *"They are still on the yard and the charges are already set. Work round them or work slower."* | live |
| Relay hut down | `objective(bring_the_relay_down, complete)` | toast + `say` | net: *"Relay hut is down."* — four words, deliberately, per narrative.md **T-U13** | live |
| Danger-close demolition near a porter | `charges` (collateral_risk 0.6) within 2 tiles of a civilian | ROE deduction (danger-close, or −8 if killed) | hard-coded `roeNotice`; no line proposed | live |
| Rifles into the yard | wave t=150s, 2 `sarim_rifles` from `sarim_north` → `stockpile_yard` | toast | none proposed | live |
| Reinforcing the crest, not the depot | wave t=260s, 1 `recoilless_team` + 1 `sarim_rifles` from `sarim_west` → `crest` | toast (proposed line) | *"They are reinforcing the crest, not the depot. He is worth more to them than the rockets are."* — a wave cannot speak | live (wave) / engine (line) |
| Kamikaze at the yard | wave t=360s, 1 `loiter_drone` from `sarim_north` → `stockpile_yard` | toast | none proposed | live |
| Both demolition parties lost | `SimEvent destroyed` ×2 on `demo_squad` | nothing authored | shai's proposed line needs a sim-watching trigger | engine |
| Mission ends (victory) | `missionEnd(victory)` | `aftermath` (Act II closes) | *"Nothing fell on the north that morning, or the one after it. They took Adhal off the crest with the whole basin still in front of him. Brigade put a fourth star on the slip. The tubes came up a road, and the road is not in Sur."* | live |
| Mission ends (any) | `missionEnd(any)` | `debrief` | *"Nothing in Sur comes down by driving at it. Five seconds at a time, standing still, with the hill watching."* | live |

**Row count this mission: 15 live, 0 schema, 3 engine** (the `evacuated`
silence, the 260s wave's line, and the both-demo-squads-lost line).

### 7.3 AI director

**Placements:**

| tag/group | unit | count | at/marker | stance |
|---|---|---|---|---|
| `uz_hvt_lantern`, group `lantern` | `sarim_rifles` | 1 | `[13.5,6.5]` | — |
| `uz_lantern_guard`, group `lantern` | `sarim_rifles` | 1 | `[15.5,5.5]` | — |
| `uz_eye_crest` | `sarim_rifles` | 1 | `[14.5,7.5]` | — |
| `uz_eye_depot` | `sarim_rifles` | 1 | `[31.5,12.5]` | — (measured to see `stockpile_yard` at 5.1) |
| `uz_manpad_north` | `manpad_team` | 1 | `[20.5,12.5]` | — |
| `uz_rcl_depot` | `recoilless_team` | 1 | `[33.5,10.5]` | `ambush(6)` |
| `uz_atgm_north` | `atgm_cell` | 1 | `[27.5,10.5]` | `ambush(10)` |
| `uz_wh_garrison` | `sarim_rifles` | 1 | `[30.5,6.5]` | `garrison`, building `[30,6]` (the warehouse — a hostile inside gives ordinary fire a second path to raze it) |
| `uz_battery`, group `battery` | `rocket_battery` | 1 | marker `battery_north` | — |

**Civilians:** `porters` ×4 at `[29.5,9.5]` (corrected from design's
`[31.5,8.5]`, §2 above), refuge `civ_north`.

**Cadence table:**

| t (s) | mechanism | size | from | to | group |
|---|---|---|---|---|---|
| 0 | garrison ×9 | 1 each | (see above) | — | — |
| 0 | civilians | 4 | `[29.5,9.5]` | — | `porters` |
| 150 | wave | 2 | `sarim_north` | `stockpile_yard` | — |
| \~ (40% dead) | trigger | — | `battery` | `battery_west` | `battery` |
| 260 | wave | 2 (2 unit types, 1 marker) | `sarim_west` | `crest` | — |
| \~ (50% dead) | trigger | — | `lantern` ×2 | `crest_reverse` | `lantern` |
| 360 | wave | 1 | `sarim_north` | `stockpile_yard` | — |

**Pressure curve.** The wave cadence tells the player where the enemy values
his own asset before any line does: the 260s reinforcement goes to the
**crest**, not the depot, while the yard gets only a kamikaze drone at 360s.
Underneath it sits a hard split-force decision — two `demo_squad` for 7,500 hp
on a 300s clock, a third buyable with the mission's economy, and a villain 16
tiles the other way who is gone for good past 50% casualties. The 40%
displacement is the one piece of good news on the clock: pressing hard enough
to trip it takes the yard out of Grad range entirely, which is also the
fastest way to make the rest of the demolition safe.

### 7.4 Map requirements

| kind | id | rough tile | purpose | exists today |
|---|---|---|---|---|
| zone | `stockpile` | `[29,5,7,5]` — `w`×9, `#`×6, `s`×2, 7,500 hp on the map's own grid | `raze` primary target | **EXISTS** |
| zone | `crest_top` | `[12,5,5,5]` — 2 `#` tiles, Adhal's relay | `raze` secondary target | **EXISTS** |
| zone | `north_shelf` | `[25,2,5,3]` | `evacuate_before` target; **contains `civ_north [27,3]`, verified** | **EXISTS** |
| marker | `battery_north`, `battery_west`, `crest`, `crest_reverse`, `stockpile_yard` | (map's own coords) | trigger/wave anchors | **EXISTS** |

**No new map content needed.**

### 7.5 Twists

| id | twist | classification | note |
|---|---|---|---|
| **T-U10** "He does not wait for you." | the 50%-casualties withdrawal | **expressible today, authored** | — |
| **T-U11** "The depot is a magazine." | the concrete block detonates when razed, damaging the yard | **engine** | `COLLAPSE_SHOCK` is a tuning constant, not per-structure; needs `collapse_damage`/`collapse_radius` on a `data/structures.json` type (G14/G-G) |
| **T-U12** "The last eye is not on a hill." | `uz_eye_depot` sits on a two-level spur, the only post in the basin reachable without a climb | **live — a placement, not a mechanism** | already true of the coordinate as authored |
| **T-U13** "The relay outlives him." | secondary `raze(crest_top)`, no deadline | **expressible today, authored** | the ending is a building, not a speech, by design |

### 7.6 Loss condition (for `playtest`)

**`raze(stockpile, seconds 300)` reaches `failed`.** A passive player orders
no demolition on any of the three structures; `eliminate_hvt(uz_hvt_lantern)`
also stays incomplete, but the raze deadline is what actually ends it. Design
§5.6 additionally asks what happens when **both** `demo_squad` die before the
deadline — the primary becomes permanently impossible, and the deadline is
exactly what turns that into a clean loss at 300s rather than a stall with no
end condition (the same trap `mission.ts`'s own comment on `raze` describes).

### 7.7 Gap report

| gap | cites | Umm Zeitoun IV impact |
|---|---|---|
| **G12/G-D** — wave cannot speak | design §7, narrative §12 | blocks the 260s wave's line |
| **G8/G-E** — trigger cannot watch a `SimEvent` | design §7, narrative §12 | blocks the both-demo-squads-lost line |
| **G-B** (Act I) — `evacuated` silent | narrative §12 | porters reaching the shelf are silent |
| **G14/G-G** — structure destruction carries no authored consequence | design §7, narrative §12 | cuts T-U11 cleanly |

---

# PART THREE — the four cross-mission gaps this brief named

The task naming these four together (**G8, G12, G5, the Grad's target
selection**) is worth answering as a set, since they come from two different
numbered lists and one is not a schema gap at all.

1. **G8** (design §7) / **G-E** (narrative §12) — **a trigger cannot fire on
   an objective completing or on any of the 24 `SimEvent` kinds.** Every
   displacement trigger in this document is on `casualties_pct` or a bare
   clock for exactly this reason — there is no "the drone died," "the
   demolition parties are both gone," or "that objective just completed"
   condition to fire a line on. Smallest proposal (design's own): two new
   `on.kind`s, `objective` (an objective id) and `sim` (one of the 24
   `SimEvent` kinds, reusing the tutorial's existing `await` predicate).
   Owner `sim-guard`.
2. **G12** (design §7) / **G-D** (narrative §12) — **a wave cannot carry
   `say`.** The wave item is `{at_seconds, trigger, to, units}`; `say` was
   added to triggers and objectives on 2026-09-03 and not to waves. Six rows
   across these seven missions are `engine` for exactly this reason — every
   one is otherwise a fully `live` wave, missing only its spoken line.
   Smallest proposal: `say?: {speaker, text}` on the wave item, emitted
   alongside the existing `wave` `MissionEvent`. Owner `sim-guard`.
3. **G5** — this number is ambiguous across the two source documents and I am
   answering both readings rather than guessing one:
   - **Design §7's G5 / narrative §12's G-L**: `world.schema.json` has no
     `planned` property, so a town with an empty `missions` array reads as
     100% complete rather than "not yet built." **Not needed by this
     document's own output** — §4's world.json fragment populates
     `umm_zeitoun.missions` with all four ids, so there is no empty-array town
     left in Sur for `planned` to describe. It stays relevant to Option A (a
     three-mission Act II) and to `khan_rafid`/`deir_amun` in the Marj, both
     outside this document's scope.
   - **`docs/campaign/beit_sahwan/script.md`'s own G5** (a different,
     unrelated list): `evacuate_before` cannot filter its count to a named
     civilian `group` — `CivilianFlight.evacuatedCount` is global across
     every civilian on the map. Checked against all three evacuations here:
     UZ I has exactly one civilian group (no ambiguity possible), UZ IV has
     exactly one (`porters`), and UZ III's `get_the_hamlet_out` counts 4-of-6
     across **two** groups (`hamlet_north`, `hamlet_south`) — since both
     groups are inside the same hamlet and both are the mission's whole
     civilian population, "4 of either" and "4 of the hamlet" happen to
     coincide, so the gap is real but not currently load-bearing anywhere in
     these seven missions. Recorded rather than hidden.
4. **The Grad's target-selection concern (design §5.6, item 4) — not a schema
   gap, a measurement `playtest` owns.** `selectTarget` is hurts-first-then-
   nearest (`sim.ts:2887`), and Tel Marum already proved a battery can *reach*
   ground and never *choose* to fire on it. Both displacement triggers in
   Umm Zeitoun II and III depend on the Grad actually engaging `crest_line`
   and the hamlet once in range, not preferring something nearer and softer.
   **This document cannot verify it** — it requires the mission files to exist
   in `data/missions/` and a `playtest` run tracing `fire` events, which is
   outside this agent's write scope and this agent's role. Flagged at the top
   of the plan outlines below as the single biggest open question before
   accepting any of the four missions as tuned.

---

# PART FOUR — Copy-ready fragments for `mission-author`

## 8. (a) Expressible today — the four complete Umm Zeitoun skeletons

Every field name below is a name that exists in `mission.schema.json`
(cited once per shape in §10, not repeated per file). Every unit id resolves
under `data/units/kdf/` or `data/units/enemy/`, or `data/units/civilians.json`
— confirmed by directory listing this session (§10). Every marker and zone
resolves against `data/maps/umm_zeitoun.json` as shipped in this worktree —
confirmed by direct load, not by re-reading the design draft. **All four
files below PASS `ajv` against `mission.schema.json`, `ajv` against
`world.schema.json`/`commander.schema.json` for the two campaign fragments,
`tools/validate_narrative.mjs`'s three exported checks, and a hand-written
semantic pass against the real map — see §10 for the run.**

### `umm_zeitoun_1_recon.json`

```json
{
  "id": "umm_zeitoun_1_recon",
  "name": "Umm Zeitoun I — Cold Ground",
  "town": "umm_zeitoun",
  "phase": "recon",
  "target_minutes": 6,
  "briefing": "Umm Zeitoun is a basin: no wall across it, no gate to force, crossable anywhere on its width. Idit counts four hills over the floor and each one sees a different piece of it. Identify all four posts before the brigade puts anything on this ground. Push the drone up the middle and take the cheap looks first. Two missile teams cover the northern half, air only, out to thirteen tiles. The crest cannot be identified from outside that envelope, so the drone buys you the near hills for nothing and that one for its life. Three families are at the wells on the west flank, nine tiles from the wadi on foot. You have four minutes before somebody else moves them. The jeep is the only thing you have that can screen the drone and the only thing that can carry a family off that flank. It will not do both.",
  "debrief": "Four hills, and a drone that can only pay for some of them. That is the whole of Sur in one night.",
  "map": { "file": "umm_zeitoun", "player_start": [24, 45] },
  "ledger": {
    "requires": ["roster.surviving_units"],
    "produces": ["roster.surviving_units", "roe.mission_ratings", "campaign.completed_missions", "intel.marked_positions", "civ.settlements_evacuated"]
  },
  "starting_force": [
    { "unit": "recon_drone", "count": 1, "at": [24, 43] },
    { "unit": "jeep_shoded", "count": 1, "at": [22, 44] },
    { "unit": "inf_squad", "count": 3, "at": [24, 45], "from_ledger": true },
    { "unit": "at_team", "count": 1, "at": [27, 45], "from_ledger": true },
    { "unit": "apc_eitan", "count": 1, "at": [22, 45] }
  ],
  "objectives": [
    { "id": "find_the_crest", "type": "locate", "primary": true, "target": "uz_eye_crest",
      "text": "Identify the post on the northern crest",
      "say": { "speaker": "idit", "text": "That is the crest post, and I have him for as long as something is looking at him. Nothing of ours can hold that from outside thirteen tiles." } },
    { "id": "find_the_west_horn", "type": "locate", "primary": true, "target": "uz_eye_west",
      "text": "Identify the post on the western horn",
      "say": { "speaker": "idit", "text": "West horn is a post, not a picket. He is lying on the shoulder with the whole western floor under him." } },
    { "id": "find_the_east_horn", "type": "locate", "primary": true, "target": "uz_eye_east",
      "text": "Identify the post on the eastern horn",
      "say": { "speaker": "idit", "text": "East horn the same, across the basin. Between the two of them there is no line across this floor that nobody sees." } },
    { "id": "find_the_stone_knoll", "type": "locate", "primary": true, "target": "uz_eye_knoll",
      "text": "Identify the post above the stone knoll",
      "say": { "speaker": "idit", "text": "The near one is in the shed on the stone knoll, four tiles from the wadi road. That is the eye that matters to the families, not to us." } },
    { "id": "get_the_wells_clear", "type": "evacuate_before", "primary": true, "target": "refuge_wadi", "count": 2, "seconds": 240,
      "text": "Get two families from the wells into the wadi inside four minutes",
      "say": { "speaker": "shai", "text": "Two families in the wadi. Leave the rest of that flank alone; nothing else out there is worth the jeep." },
      "say_on_fail": { "speaker": "shai", "text": "Four minutes. Whatever is still at the wells is not ours to move now." } },
    { "id": "find_the_missile_team", "type": "locate", "primary": false, "target": "uz_manpad_basin",
      "text": "Identify the missile team covering the basin",
      "say": { "speaker": "idit", "text": "Missile team on the northern shelf. Air only, thirteen tiles — the drone crosses that line once." } },
    { "id": "screen_out", "type": "survive_until", "primary": false, "seconds": 240,
      "text": "Stay in the field for four minutes" }
  ],
  "roe": { "enabled": true },
  "civilians": {
    "refuge": "civ_refuge",
    "groups": [ { "unit": "civilians", "count": 3, "at": [14.5, 35.5], "group": "wells_families" } ]
  },
  "enemy": {
    "faction": "sarim",
    "doctrine_profile": "standoff overwatch",
    "garrison": [
      { "unit": "sarim_rifles", "count": 1, "at": [14.5, 7.5], "tag": "uz_eye_crest" },
      { "unit": "sarim_rifles", "count": 1, "at": [10.5, 23.5], "tag": "uz_eye_west" },
      { "unit": "sarim_rifles", "count": 1, "at": [37.5, 23.5], "tag": "uz_eye_east" },
      { "unit": "sarim_rifles", "count": 1, "at": [23.5, 33.5], "tag": "uz_eye_knoll", "stance": { "kind": "garrison", "building": [21, 33] } },
      { "unit": "manpad_team", "count": 1, "at": [20.5, 12.5], "tag": "uz_manpad_north" },
      { "unit": "manpad_team", "count": 1, "at": [30.5, 22.5], "tag": "uz_manpad_basin" },
      { "unit": "atgm_cell", "count": 1, "at": [34.5, 20.5], "tag": "uz_atgm_glacis", "stance": { "kind": "ambush", "tiles": 10 } },
      { "unit": "rocket_battery", "count": 1, "marker": "battery_south", "group": "battery", "tag": "uz_battery" }
    ],
    "waves": [
      { "at_seconds": 150, "to": "uz_wells", "units": [ { "unit": "sarim_rifles", "count": 1, "from": "sarim_west" } ] },
      { "at_seconds": 260, "to": "lane_centre", "units": [ { "unit": "sarim_rifles", "count": 2, "from": "sarim_north" } ] }
    ]
  },
  "triggers": [
    { "id": "they_move_the_families_off", "on": { "kind": "timer_s", "value": 242 },
      "do": { "kind": "remove", "group": "wells_families" },
      "say": { "speaker": "idit", "text": "The wells are empty and nobody fought over them. They walked them north between the hills while we were looking at the hills." } }
  ]
}
```

### `umm_zeitoun_2_buildup.json`

```json
{
  "id": "umm_zeitoun_2_buildup",
  "name": "Umm Zeitoun II — The Long Look",
  "town": "umm_zeitoun",
  "phase": "buildup",
  "target_minutes": 7,
  "briefing": "Sur has more than one tube: this one is south of the basin, and from there it reaches the crest line at twelve tiles. Idit has an observer marked on the stone knoll, eight tiles off that same ground. Hold the crest line for four minutes while the engineers work behind you. It is the highest ground on this half of the basin and the one piece of it he can both see and shell. The camp ground in the bowl is dead to every position on this map — nothing up there can see what you are putting on it. What they can see is the line. Supply is coming forward and the corridor behind it is open, so spend it as it arrives. Level the post above the knoll inside five minutes, with charges or with fire while the observer is still inside the shed. Break a third of what is in front of you and the tube pulls north, out of reach of the line entirely. Everything you buy to make that happen is not standing on the crest while it happens.",
  "debrief": "Nobody replaces an observer on a heap of blocks. They replace him on the next hill.",
  "map": { "file": "umm_zeitoun", "player_start": [24, 45] },
  "ledger": {
    "requires": ["roster.surviving_units", "intel.marked_positions"],
    "produces": ["roster.surviving_units", "roe.mission_ratings", "campaign.completed_missions"]
  },
  "starting_force": [
    { "unit": "inf_squad", "count": 3, "at": [24, 45], "from_ledger": true },
    { "unit": "at_team", "count": 1, "at": [27, 45], "from_ledger": true },
    { "unit": "apc_eitan", "count": 2, "at": [22, 45] },
    { "unit": "mbt_lavi", "count": 1, "at": [26, 44] },
    { "unit": "mortar_team", "count": 1, "at": [23, 44] },
    { "unit": "demo_squad", "count": 1, "at": [21, 45] },
    { "unit": "recon_drone", "count": 1, "at": [24, 43] }
  ],
  "resources": { "logistics_start": 500, "logistics_rate_per_min": 150, "intel_start": 150, "supply_corridor": true },
  "structures": [ { "type": "camp", "at": [20, 43], "size": [2, 2] } ],
  "objectives": [
    { "id": "hold_the_crest_line", "type": "hold_for", "primary": true, "target": "crest_line", "seconds": 240,
      "text": "Hold the crest line for four minutes",
      "say": { "speaker": "net", "text": "Crest line held four minutes. Engineers are off it." } },
    { "id": "level_the_stone_post", "type": "raze", "primary": true, "target": "post_stone", "seconds": 300,
      "text": "Level the post above the stone knoll inside five minutes",
      "say": { "speaker": "shai", "text": "Post is down. Nobody replaces an observer on a heap of blocks — they replace him on the next hill." },
      "say_on_fail": { "speaker": "shai", "text": "Five minutes gone and the shed is still standing. He has watched everything we put on that line." } },
    { "id": "kill_the_knoll_eye", "type": "eliminate_hvt", "primary": false, "target": "uz_eye_knoll",
      "text": "Kill the observer in the shed on the stone knoll",
      "say": { "speaker": "idit", "text": "Knoll post is down. The wadi road is unobserved for the first time since we came into this basin." } },
    { "id": "take_the_stone_knoll", "type": "capture", "primary": false, "target": "post_stone", "seconds": 15,
      "text": "Take the stone knoll and hold it for 15 seconds" }
  ],
  "roe": { "enabled": true },
  "enemy": {
    "faction": "sarim",
    "doctrine_profile": "standoff overwatch",
    "garrison": [
      { "unit": "sarim_rifles", "count": 1, "at": [23.5, 33.5], "tag": "uz_eye_knoll", "group": "knoll", "stance": { "kind": "garrison", "building": [21, 33] } },
      { "unit": "sarim_rifles", "count": 1, "at": [10.5, 23.5], "tag": "uz_eye_west" },
      { "unit": "sarim_rifles", "count": 1, "at": [37.5, 23.5], "tag": "uz_eye_east" },
      { "unit": "manpad_team", "count": 1, "at": [30.5, 22.5], "tag": "uz_manpad_basin" },
      { "unit": "recoilless_team", "count": 1, "at": [27.5, 32.5], "tag": "uz_rcl_south", "stance": { "kind": "ambush", "tiles": 6 } },
      { "unit": "rocket_battery", "count": 1, "marker": "battery_south", "group": "battery", "tag": "uz_battery" }
    ],
    "waves": [
      { "at_seconds": 90, "to": "knoll_stone", "units": [ { "unit": "sarim_rifles", "count": 2, "from": "sarim_west" } ] },
      { "at_seconds": 180, "to": "rim_crest", "units": [ { "unit": "recoilless_team", "count": 1, "from": "sarim_north" } ] },
      { "at_seconds": 210, "to": "camp_ground", "units": [ { "unit": "loiter_drone", "count": 1, "from": "sarim_north" } ] },
      { "at_seconds": 300, "to": "rim_crest", "units": [ { "unit": "sarim_rifles", "count": 2, "from": "sarim_east" } ] }
    ]
  },
  "triggers": [
    { "id": "the_tube_moves_north", "on": { "kind": "casualties_pct", "value": 30 },
      "do": { "kind": "withdraw_to", "group": "battery", "to": "battery_north" },
      "say": { "speaker": "idit", "text": "Battery is displacing north. Twenty-eight tiles to the crest line from there — that is what taking a third of them off him buys." } }
  ]
}
```

### `umm_zeitoun_3_clearance.json`

```json
{
  "id": "umm_zeitoun_3_clearance",
  "name": "Umm Zeitoun III — Blinding",
  "town": "umm_zeitoun",
  "phase": "clearance",
  "target_minutes": 7,
  "briefing": "Both horns sit eighteen tiles from the crest and they are not the same job: the western is scree, and nothing on wheels or tracks gets up it. The eastern is a bare glacis with a Kornet team lying on it at ten tiles. Kill both posts. You have one force, it will not take the western horn in vehicles, and you decide which half of it walks before anything moves. Six families are in the hamlet on the floor between them, eleven tiles from the wadi. Nobody inside that block can see out of it and nothing outside it can see in — the houses do that in both directions. Get four of them to the wadi inside five minutes. The block is flagged: rifles, the remote gun and the sniper's rifle work in there, and autocannon, tank fire or anything from the tubes is billed against a floor of forty-five. His battery is west of the basin and reaches neither the hamlet nor the road out of it from there. Press him off that ground and it goes south, and the eye on the stone knoll can hand it both. You will not be billed for a rocket he fires. You will lose this all the same if four of them do not reach the wadi.",
  "debrief": "A block like that is blind in both directions. That is not an accident and it is not geology.",
  "map": { "file": "umm_zeitoun", "player_start": [24, 45] },
  "ledger": {
    "requires": ["roster.surviving_units", "intel.marked_positions"],
    "produces": ["roster.surviving_units", "roe.mission_ratings", "campaign.completed_missions", "intel.marked_positions", "civ.settlements_evacuated"]
  },
  "starting_force": [
    { "unit": "inf_squad", "count": 3, "at": [24, 45], "from_ledger": true },
    { "unit": "at_team", "count": 1, "at": [27, 45], "from_ledger": true },
    { "unit": "mortar_team", "count": 1, "at": [23, 44], "from_ledger": true },
    { "unit": "mbt_lavi", "count": 1, "at": [26, 44] },
    { "unit": "ifv_namer", "count": 1, "at": [20, 44] },
    { "unit": "apc_eitan", "count": 2, "at": [22, 45] },
    { "unit": "sniper_team", "count": 1, "at": [24, 44] },
    { "unit": "recon_drone", "count": 1, "at": [24, 43] }
  ],
  "objectives": [
    { "id": "kill_the_west_horn", "type": "eliminate_hvt", "primary": true, "target": "uz_eye_west",
      "text": "Kill the post on the western horn",
      "say": { "speaker": "idit", "text": "West horn is blind. Half the floor belongs to nobody now." } },
    { "id": "kill_the_east_horn", "type": "eliminate_hvt", "primary": true, "target": "uz_eye_east",
      "text": "Kill the post on the eastern horn",
      "say": { "speaker": "idit", "text": "East horn is blind. Whatever he calls from here he calls off a map, not off the ground." } },
    { "id": "get_the_hamlet_out", "type": "evacuate_before", "primary": true, "target": "refuge_wadi", "count": 4, "seconds": 300,
      "text": "Get four families out of the hamlet to the wadi inside five minutes",
      "say": { "speaker": "shai", "text": "Four out of the block. Nothing else in there is worth a round from the tubes." },
      "say_on_fail": { "speaker": "shai", "text": "Clock is out on the hamlet. They are under his rockets now and we are not going back through them." } },
    { "id": "find_adhal", "type": "locate", "primary": false, "target": "uz_hvt_lantern",
      "text": "Find the man the posts are reporting to",
      "say": { "speaker": "idit", "text": "That is Karim Adhal, on the northern crest, thirty-four tiles out. Two towns of his work and this is the first time anybody has had his ground." } },
    { "id": "kill_the_knoll_eye", "type": "eliminate_hvt", "primary": false, "target": "uz_eye_knoll",
      "text": "Kill the eye on the stone knoll that overlooks the wadi road",
      "say": { "speaker": "idit", "text": "Knoll is clear. Nothing left in this basin can put a round on the wadi road by looking at it." } }
  ],
  "roe": { "enabled": true, "flagged_zones": ["hamlet"], "fail_below": 45 },
  "civilians": {
    "refuge": "civ_refuge",
    "groups": [
      { "unit": "civilians", "count": 3, "at": [22.5, 26.5], "group": "hamlet_north" },
      { "unit": "civilians", "count": 3, "at": [21.5, 28.5], "group": "hamlet_south" }
    ]
  },
  "enemy": {
    "faction": "sarim",
    "doctrine_profile": "standoff overwatch",
    "garrison": [
      { "unit": "sarim_rifles", "count": 1, "at": [10.5, 23.5], "tag": "uz_eye_west" },
      { "unit": "sarim_rifles", "count": 1, "at": [37.5, 23.5], "tag": "uz_eye_east" },
      { "unit": "sarim_rifles", "count": 1, "at": [23.5, 33.5], "tag": "uz_eye_knoll" },
      { "unit": "manpad_team", "count": 1, "at": [30.5, 22.5], "tag": "uz_manpad_basin" },
      { "unit": "atgm_cell", "count": 1, "at": [34.5, 20.5], "tag": "uz_atgm_glacis", "stance": { "kind": "ambush", "tiles": 10 } },
      { "unit": "atgm_cell", "count": 1, "at": [17.5, 19.5], "tag": "uz_atgm_lateral", "stance": { "kind": "ambush", "tiles": 10 } },
      { "unit": "sarim_rifles", "count": 1, "at": [20.5, 24.5], "group": "hamlet_garrison", "stance": { "kind": "garrison", "building": [20, 24] } },
      { "unit": "sarim_rifles", "count": 1, "at": [26.5, 27.5], "group": "hamlet_garrison", "stance": { "kind": "garrison", "building": [26, 27] } },
      { "unit": "recoilless_team", "count": 1, "at": [25.5, 27.5], "tag": "uz_rcl_hamlet", "stance": { "kind": "ambush", "tiles": 6 } },
      { "unit": "sarim_rifles", "count": 1, "at": [13.5, 6.5], "tag": "uz_hvt_lantern", "group": "lantern" },
      { "unit": "rocket_battery", "count": 1, "marker": "battery_west", "group": "battery", "tag": "uz_battery" }
    ],
    "waves": [
      { "at_seconds": 120, "to": "horn_west", "units": [ { "unit": "sarim_rifles", "count": 2, "from": "sarim_west" } ] },
      { "at_seconds": 240, "to": "horn_east", "units": [ { "unit": "recoilless_team", "count": 1, "from": "sarim_east" } ] },
      { "at_seconds": 330, "to": "hamlet_square", "units": [ { "unit": "sarim_rifles", "count": 2, "from": "sarim_north" } ] }
    ]
  },
  "triggers": [
    { "id": "he_brings_the_tube_south", "on": { "kind": "casualties_pct", "value": 35 },
      "do": { "kind": "withdraw_to", "group": "battery", "to": "battery_south" },
      "say": { "speaker": "idit", "text": "Battery is coming south. From that position it reaches the hamlet at seven tiles and the wadi road at ten, and every round of it is his." } },
    { "id": "the_house_was_the_section", "on": { "kind": "zone_entered", "zone": "hamlet" },
      "do": { "kind": "commit", "group": "hamlet_garrison", "to": "hamlet_square" },
      "say": { "speaker": "idit", "text": "They are out of the houses and into the street. They will not fight you from in there — they were never going to." } }
  ]
}
```

### `umm_zeitoun_4_clearance.json`

```json
{
  "id": "umm_zeitoun_4_clearance",
  "name": "Umm Zeitoun IV — The Stockpile",
  "town": "umm_zeitoun",
  "phase": "clearance",
  "target_minutes": 7,
  "briefing": "The depot is three buildings on the northern shelf, seven and a half thousand between them, and there is an eye on the spur beside it that sees the yard at five tiles. What that eye sees, the tube shells. Bring all of it down inside five minutes. There is no dozer in Sur — that is two demolition parties, five seconds of charges at a time, standing still within two tiles of what they are dropping. The man every post in this basin has been reporting to is on the crest, sixteen tiles the other way. Idit has had his voice for two towns and never once his ground. You cannot do both of those slowly. Buy a third party with the logistics if you want the depot and the crest inside the same seven minutes. Four porters are on the depot ground and the shelf behind it is five tiles from them. Charges do not care who is beside the wall: set one within two tiles of them and you are billed for it, and the party will level whatever else it halts beside.",
  "aftermath": "Nothing fell on the north that morning, or the one after it. They took Adhal off the crest with the whole basin still in front of him. Brigade put a fourth star on the slip. The tubes came up a road, and the road is not in Sur.",
  "debrief": "Nothing in Sur comes down by driving at it. Five seconds at a time, standing still, with the hill watching.",
  "map": { "file": "umm_zeitoun", "player_start": [24, 45] },
  "ledger": {
    "requires": ["roster.surviving_units", "intel.marked_positions"],
    "produces": ["roster.surviving_units", "roe.mission_ratings", "campaign.completed_missions"]
  },
  "starting_force": [
    { "unit": "inf_squad", "count": 3, "at": [24, 45], "from_ledger": true },
    { "unit": "at_team", "count": 1, "at": [27, 45], "from_ledger": true },
    { "unit": "mortar_team", "count": 1, "at": [23, 44], "from_ledger": true },
    { "unit": "sniper_team", "count": 1, "at": [24, 44], "from_ledger": true },
    { "unit": "mbt_lavi", "count": 2, "at": [26, 44] },
    { "unit": "ifv_namer", "count": 1, "at": [20, 44] },
    { "unit": "apc_eitan", "count": 2, "at": [22, 45] },
    { "unit": "demo_squad", "count": 2, "at": [19, 45] },
    { "unit": "recon_drone", "count": 1, "at": [24, 43] }
  ],
  "resources": { "logistics_start": 600, "logistics_rate_per_min": 100, "intel_start": 250, "supply_corridor": true },
  "objectives": [
    { "id": "raze_the_stockpile", "type": "raze", "primary": true, "target": "stockpile", "seconds": 300,
      "text": "Raze the stockpile inside five minutes",
      "say": { "speaker": "shai", "text": "Depot is down. That is what was coming over the wall at Tel Marum, and it is not coming again." },
      "say_on_fail": { "speaker": "shai", "text": "Five minutes. The depot is standing and the parties that were going to bring it down are not." } },
    { "id": "kill_adhal", "type": "eliminate_hvt", "primary": true, "target": "uz_hvt_lantern",
      "text": "Kill Karim Adhal on the northern crest",
      "say": { "speaker": "idit", "text": "Adhal is off the crest. He never fired a round in this war and he chose where every one of them landed." } },
    { "id": "kill_the_battery", "type": "eliminate_hvt", "primary": false, "target": "uz_battery",
      "text": "Destroy the rocket battery north of the depot",
      "say": { "speaker": "idit", "text": "Battery is finished. Sur has nothing left that reaches Kedem." } },
    { "id": "get_the_porters_clear", "type": "evacuate_before", "primary": false, "target": "north_shelf", "count": 3, "seconds": 240,
      "text": "Get three porters off the depot ground to the northern shelf",
      "say": { "speaker": "shai", "text": "Porters are on the shelf. Nothing of ours goes north of the yard for them." },
      "say_on_fail": { "speaker": "shai", "text": "They are still on the yard and the charges are already set. Work round them or work slower." } },
    { "id": "bring_the_relay_down", "type": "raze", "primary": false, "target": "crest_top",
      "text": "Bring the relay hut on the crest down",
      "say": { "speaker": "net", "text": "Relay hut is down." } }
  ],
  "roe": { "enabled": true, "flagged_zones": ["hamlet"], "fail_below": 45 },
  "civilians": {
    "refuge": "civ_north",
    "groups": [ { "unit": "civilians", "count": 4, "at": [29.5, 9.5], "group": "porters" } ]
  },
  "enemy": {
    "faction": "sarim",
    "doctrine_profile": "standoff overwatch",
    "garrison": [
      { "unit": "sarim_rifles", "count": 1, "at": [13.5, 6.5], "tag": "uz_hvt_lantern", "group": "lantern" },
      { "unit": "sarim_rifles", "count": 1, "at": [15.5, 5.5], "tag": "uz_lantern_guard", "group": "lantern" },
      { "unit": "sarim_rifles", "count": 1, "at": [14.5, 7.5], "tag": "uz_eye_crest" },
      { "unit": "sarim_rifles", "count": 1, "at": [31.5, 12.5], "tag": "uz_eye_depot" },
      { "unit": "manpad_team", "count": 1, "at": [20.5, 12.5], "tag": "uz_manpad_north" },
      { "unit": "recoilless_team", "count": 1, "at": [33.5, 10.5], "tag": "uz_rcl_depot", "stance": { "kind": "ambush", "tiles": 6 } },
      { "unit": "atgm_cell", "count": 1, "at": [27.5, 10.5], "tag": "uz_atgm_north", "stance": { "kind": "ambush", "tiles": 10 } },
      { "unit": "sarim_rifles", "count": 1, "at": [30.5, 6.5], "tag": "uz_wh_garrison", "stance": { "kind": "garrison", "building": [30, 6] } },
      { "unit": "rocket_battery", "count": 1, "marker": "battery_north", "group": "battery", "tag": "uz_battery" }
    ],
    "waves": [
      { "at_seconds": 150, "to": "stockpile_yard", "units": [ { "unit": "sarim_rifles", "count": 2, "from": "sarim_north" } ] },
      { "at_seconds": 260, "to": "crest", "units": [
        { "unit": "recoilless_team", "count": 1, "from": "sarim_west" },
        { "unit": "sarim_rifles", "count": 1, "from": "sarim_west" }
      ] },
      { "at_seconds": 360, "to": "stockpile_yard", "units": [ { "unit": "loiter_drone", "count": 1, "from": "sarim_north" } ] }
    ]
  },
  "triggers": [
    { "id": "the_tube_goes_west", "on": { "kind": "casualties_pct", "value": 40 },
      "do": { "kind": "withdraw_to", "group": "battery", "to": "battery_west" },
      "say": { "speaker": "enemy", "text": "Move it west. The tube was never what had to see — that has been on the hill since long before the first rocket, and it does not close." } },
    { "id": "he_goes_over_the_back", "on": { "kind": "casualties_pct", "value": 50 },
      "do": { "kind": "withdraw_to", "group": "lantern", "to": "crest_reverse" },
      "say": { "speaker": "net", "text": "He is over the back of the crest and out of sight of the basin. Whoever wants him climbs." } }
  ]
}
```

## 9. `world.json` and `commander.json` fragments

**`world.json`** — three edits inside the `sur` and `naharin` regions
(elided: `marj` and the rest of `sur`/`naharin` are untouched):

```json
{
  "regions": [
    {
      "id": "sur",
      "unlock": { "after_mission": "beit_sahwan_4_subterranean" },
      "towns": [
        { "id": "tel_marum", "missions": ["tel_marum_1_recon", "tel_marum_2_foothold", "tel_marum_3_clearance"] },
        { "id": "umm_zeitoun", "missions": ["umm_zeitoun_1_recon", "umm_zeitoun_2_buildup", "umm_zeitoun_3_clearance", "umm_zeitoun_4_clearance"] }
      ]
    },
    {
      "id": "naharin",
      "unlock": { "after_mission": "umm_zeitoun_4_clearance" }
    }
  ]
}
```

Both `unlock.after_mission` changes are design §2's **C1**/**C2**: today both
`sur` and `naharin` unlock on `beit_sahwan_3_clearance` — verified in the
shipped `data/campaign/world.json` this session — so a player can skip Sur
entirely. **C2** moves Sur's own unlock to the true end of Act I
(`beit_sahwan_4_subterranean`); **C1** moves Naharin's unlock past the true
end of Act II (`umm_zeitoun_4_clearance`) rather than past Tel Marum alone.
`umm_zeitoun.missions` is the one array-population edit this whole act was
waiting on (narrative.md's **G-A**: without it, `commanderForMission` falls
through Umm Zeitoun's ids to a town *after* the Major's rank boundary and
promotes Shai mid-act).

**`commander.json`** — one field on the Major rank:

```json
{ "ranks": [
    { "rank": "Captain", "stars": 2, "until_mission": "beit_sahwan_4_subterranean" },
    { "rank": "Major", "stars": 3, "until_mission": "umm_zeitoun_4_clearance" },
    { "rank": "Lieutenant Colonel", "stars": 4, "until_mission": "wadi_halam_5_depot" },
    { "rank": "Colonel", "stars": 5 }
] }
```

Was `"until_mission": "tel_marum_3_clearance"`. **This one line requires the
`world.json` fragment above to land with it** — `commanderRankFailures`
resolves `until_mission` against `world.json`'s concatenated campaign order,
and `umm_zeitoun_4_clearance` is not a real entry in that order until
`umm_zeitoun.missions` is populated. Landed together, both pass; landed
`commander.json`-only, `tools/validate_narrative.mjs` reports *"names
`until_mission` 'umm_zeitoun_4_clearance', which is not a mission listed in
world.json's campaign order."* Verified both ways this session.

## 10. (b) Engine-gated — needs G8 or G12

Nothing above is engine-gated; every skeleton, every campaign fragment,
passes today. What is engine-gated is the set of **spoken lines** narrative.md
proposes that this document could not attach to a live mechanism — restated
here as the fragments they would be, so `sim-guard` can see the exact shape
needed rather than a prose description.

```json
// NOT VALID today — wave items have no "say" (G12/G-D). Six of these exist
// across the four missions (UZ I t=150s, UZ II t=180s and t=210s,
// UZ III t=330s, UZ IV t=260s), all following this exact shape.
{
  "at_seconds": 210,
  "to": "camp_ground",
  "say": { "speaker": "shai", "text": "Something small and low is going for the camp, not the line. Whatever is behind you is the thing you are building." },
  "units": [ { "unit": "loiter_drone", "count": 1, "from": "sarim_north" } ]
}
```

```json
// NOT VALID today — triggers[].on.kind has no "sim" or "objective" member
// (G8/G-E). Proposed shape, per design §7: a SimEvent-watching condition,
// reusing the tutorial's own predicate vocabulary.
{
  "id": "the_drone_is_gone",
  "on": { "kind": "sim", "event": "destroyed", "unit_tag": "recon_drone" },
  "do": { "kind": "spawn", "units": [] },
  "say": { "speaker": "idit", "text": "Drone is gone. Whatever it had not looked at yet, we go and look at on foot, next week, with people." }
}
```

Nothing else in these seven missions needed a shape the schema does not have.

---

# PART FIVE — Plan outlines for `mission-author`

**Read design §5.6 before tuning any of the four against these outlines.**
None of them has been run through `playtest` — that instrument does not exist
for a mission that is not yet in `data/missions/`, and the single largest risk
named in this whole document (the Grad's target selection, Part Three item 4)
can only be answered once it is. These are optimal-play sketches in the
Beit Sahwan/Tel Marum idiom (perfect information, no combat losses assumed),
not measurements.

## `umm_zeitoun_1_recon`

Drone: station at `[24,30]` (mid-basin) to buy `uz_eye_west`, `uz_eye_east`
and `uz_eye_knoll` in one look, accepting it now sits 10.0 tiles from
`manpad_basin` (inside its 13-tile envelope); continue toward `[18,16]` or
`[24,16]` to buy `uz_eye_crest`, which costs the drone its own life to a
MANPAD no matter which northern station is used (design §4.4 E — the crest
cannot be bought free). Identification is permanent once banked, so losing
the drone at that point costs nothing further this mission (only in III,
per T-U3). Jeep: run to the wells and shepherd two of the three families
toward `refuge_wadi` — `CivilianFlight` orders anyone within 4 tiles to flee,
so simple proximity is enough; complete before 240s. inf_squad/at_team/apc
screen the ground approach and meet the two light waves (150s at the wells,
260s at `lane_centre`) with whichever body is nearest. Total time: well under
the 6-minute target once the picture is built and the evacuation runs in
parallel with it — matching Tel Marum I's own measured pattern of resolving
in well under a minute once the answer is known.

**Passive control loss:** `get_the_wells_clear` fails at 240s — nobody comes
within shepherd radius of the wells, the count never reaches 2, `checkEnd`
returns DEFEAT on the failed primary.

## `umm_zeitoun_2_buildup`

Split from the first tick: `mbt_lavi` + `apc_eitan` (+ 1–2 purchased
`inf_squad`, ~230 logistics each out of the 500 start + 150/min income) hold
`crest_line` — `hold_for` is cumulative, so a brief contest does not reset
progress, only pause it. Simultaneously `demo_squad`, escorted, pushes to
`knoll_stone`, engages or bypasses `uz_eye_knoll`'s garrison, and sets charges
on the shed inside `post_stone` (5s within 2 tiles). The 90s/180s/300s waves
test the hold; the 210s `loiter_drone` needs a picket on `camp_ground` or the
camp — not directly scored, but "the one thing a build-up cannot replace" —
is at risk. Killing 30% of the garrison (plausible well before the 300s raze
deadline, given the knoll garrison plus wave attrition) trips
`the_tube_moves_north`, taking the Grad's reach on the crest line from 12.5
tiles to 28.2 — effectively ending the shelling of the ground being held.
Target 7 minutes; a good plan should finish with room to spare given the
economy exists specifically to let the hold and the demolition run at once.

**Passive control loss:** `level_the_stone_post` fails at 300s — nobody
orders a demolition or fires on the shed, it stands, `checkEnd` returns
DEFEAT on the failed primary (`hold_for` cannot itself fail; it simply never
starts accumulating if the force never occupies `crest_line`).

## `umm_zeitoun_3_clearance`

Split the force at the outset: infantry + `at_team` + `mortar_team` +
`sniper_team` on foot toward `horn_west` (18 tiles, scree, no vehicle route
exists at all); `mbt_lavi` + `ifv_namer` + `apc_eitan` toward `horn_east` (18
tiles, bare glacis, watched by `uz_atgm_glacis`'s 10-tile ambush). Use
`sniper_team` to kill both posts from 11–14 tiles, outside both Kornet bands
(design §4.4 F) — the campaign's own thesis, that Act I's restraint bought
the tool that wins Act II. Clear the hamlet with rifles, the Eitan's
`rws_50`, and the sniper only — **not** `ifv_namer`'s `cannon_30`,
`mbt_lavi`'s `gun_120`, or `at_team`'s `spike_atgm`, all three of which arm
the flagged-zone penalty (§6.5's measured finding). Evacuate the six hamlet
civilians early, before pressing the fight hard enough to trip the 35%
displacement — once the battery is at `battery_south` it reaches the wadi
road at 10 tiles, so the safest order is families first, horns and hamlet
after. `find_adhal` and `kill_the_knoll_eye` are free pickups along the way.
Target 7 minutes.

**Passive control loss:** `get_the_hamlet_out` fails at 300s — nobody comes
within shepherd radius of either hamlet group, `checkEnd` returns DEFEAT.
Both `eliminate_hvt` primaries also stay incomplete on a passive run, but the
evacuation is the timed one.

## `umm_zeitoun_4_clearance`

Split three ways: two `demo_squad` (escorted against `uz_eye_depot`,
`uz_rcl_depot`, `uz_atgm_north` and the warehouse garrison) work the three
stockpile structures in sequence — 7,500 hp, 5s of charges at a time within 2
tiles, on a 300s clock; a third party, bought with the 600+100/min economy,
pushes 16 tiles the other way toward the crest, backed by `sniper_team`'s
long reach, to engage `uz_hvt_lantern`/`uz_lantern_guard`/`uz_eye_crest`.
Pressing the depot fight to 40% garrison casualties trips
`the_tube_goes_west`, taking the yard out of Grad range (22.4 tiles) and
making the rest of the demolition safe from indirect fire — worth committing
hard early rather than trickling in. Adhal goes over the back of the crest at
50% casualties (`crest_reverse`, reachable only by climbing); since
`kill_adhal` carries no deadline of its own, a slower crest party can still
finish the job after the raze is secured. Porters (4, secondary, 240s) flee
north on their own if a body passes within shepherd radius of the yard.
Target 7 minutes.

**Passive control loss:** `raze_the_stockpile` fails at 300s — no demolition
is ever ordered, all three structures stand, `checkEnd` returns DEFEAT.
`kill_adhal` also stays incomplete, but the raze deadline is what actually
ends the mission — and it is the deadline, not flavour, that turns "both
`demo_squad` died" into a clean loss rather than a permanently-stuck mission.

---

# PART SIX — Verification

**Schema fields**, grepped against `mission.schema.json` this session, one
citation per shape (used throughout §§1–9):
`dispatch`/`aftermath`/`debrief` (top-level, `maxLength: 240`);
`ledger.{requires,produces}`; `map.{file,player_start}`;
`starting_force[].{unit,count,at,from_ledger,group}` (the last landed
2026-09-03; `additionalProperties: false` confirmed — no `stance`/`tag` on
this shape, none used here); `resources.{logistics_start,intel_start,
logistics_rate_per_min,supply_corridor}`; `structures[].{type,at,size}`;
`objectives[].{id,type,primary,text,target,count,seconds,say,say_on_fail}`
— `type` enum includes all nine of `locate, eliminate_hvt, capture, hold_for,
survive_until, evacuate_before, raze`(used) plus `destroy_all, collapse`
(not used here — no tunnels); `roe.{enabled,flagged_zones,fail_below}`;
`civilians.{groups,refuge}`; `enemy.{faction,doctrine_profile,garrison,
waves}`; `$defs/placement.{unit,count,at,marker,facing_deg,group,tag,stance}`
— `stance.kind` enum `hold_position|ambush|patrol|garrison`, `ambush.tiles`,
`garrison.building`, both used; `enemy.waves[].{at_seconds,trigger,to,
units[].{unit,count,from,group,tag}}`; `triggers[].{id,on{kind,value,zone},
do{kind,group,to,units,zone},say}` — `do.kind` enum confirmed to include
`remove` (landed 2026-09-03), and its `if/then` (only `group` may accompany
it, never `to`/`units`) is satisfied by every `remove` fragment here.

**Unit ids**, confirmed present by directory listing this session:
`inf_squad, at_team, mortar_team, sniper_team, demo_squad, apc_eitan,
ifv_namer, mbt_lavi, jeep_shoded, recon_drone` under `data/units/kdf/`;
`sarim_rifles, atgm_cell, rocket_battery, recoilless_team, manpad_team,
loiter_drone` under `data/units/enemy/`; `civilians` at
`data/units/civilians.json`. `data/structures.json` confirms `camp` (the one
mission-raised structure, UZ II) with `roe_penalty: 0`.

**Marker/zone discipline.** Every `to`/`from` above names a marker, never a
zone — the one place design's own prose named a zone (`crest_line` as a wave
target) is corrected to the marker inside it (`rim_crest`), stated in §2 and
§5.4. Every `hold_for`/`capture`/`evacuate_before`/`raze` target names a zone
that exists on `data/maps/umm_zeitoun.json` as shipped: `refuge_wadi`
(I, III), `crest_line`/`post_stone` (II), `hamlet` (III, `roe.flagged_zones`
too), `stockpile`/`crest_top`/`north_shelf` (IV). Every `group` a trigger
addresses is declared on a placement in the same mission (`battery` on the
`rocket_battery` in every mission that displaces it; `lantern` on both
Adhal-tagged placements in III/IV; `hamlet_garrison` on both hamlet
sarim_rifles in III; `wells_families`/`hamlet_north`/`hamlet_south`/`porters`
on their civilian groups) — checked mechanically, not by eye, in §5's script.
Every `remove` names a declared group and never covers the whole
`starting_force` (`tools/validate_narrative.mjs`'s own
`removeTriggerFailures` ran clean against all seven files). Every `evacuate_
before` zone contains its refuge marker: `refuge_wadi [21,36,5,3]` contains
`civ_refuge [23,37]`; `north_shelf [25,2,5,3]` contains `civ_north [27,3]` —
both checked by coordinate arithmetic and confirmed by `MissionRuntime.
start()`'s own throw condition, which the semantic script reproduces exactly.
Every `say.text` is ≤240 characters with a legal speaker
(`shai|idit|net|enemy`) — the one violation found (Tel Marum I's `dispatch`,
243 chars against narrative.md's own claimed 238) is fixed and flagged in
§3.7, not silently shipped.

**No trigger depends on firing twice**; every `casualties_pct`/`timer_s`/
`zone_entered` condition in these seven missions is a single, distinct
object, and the runtime's own `firedTriggers` array is indexed per trigger
object regardless. **No wave depends on a tunnel `from`** — `umm_zeitoun.json`
declares no `tunnels` at all (Sarim doctrine is standoff, not the Marj's
spade), and every wave `from` here is a map marker.

**Ajv run, this session, against the real schemas in this worktree:**

```
schema: tel_marum_1_recon      PASS
schema: tel_marum_2_foothold   PASS
schema: tel_marum_3_clearance  PASS
schema: umm_zeitoun_1_recon    PASS
schema: umm_zeitoun_2_buildup  PASS
schema: umm_zeitoun_3_clearance PASS
schema: umm_zeitoun_4_clearance PASS
schema: world.json             PASS
schema: commander.json         PASS
commanderRankFailures          PASS
removeTriggerFailures  (×7)    PASS
narrativeTextFailures  (×7)    PASS
semantic (groups/zones/markers/tags/refuge) (×7)  PASS
=== OVERALL: PASS ===
```

A second, independent script mechanically replicated `assertGroundClear`'s
exact spread formula (`(k%3)×1.25, ⌊k/3⌋×1.25` tiles per body) against the
real map grid for every `starting_force`/`enemy.garrison`/`civilians`
placement in all four Umm Zeitoun missions: **zero blocked-tile spawns, zero
same-tile overlaps**, after the four tile corrections recorded in Part Two's
shared-conventions block (three cosmetic, one — the UZ IV porters — a real
fix for a spawn that would otherwise throw on a shanty tile).

**Row counts by status**, counted from the ECA tables in §§1–2, 3.3, 4.2, 5.2,
6.2, 7.2 (AI-director cadence tables are cadence, not ECA, and not counted
twice):

| mission | live | schema | engine | total |
|---|---|---|---|---|
| Tel Marum I (§1.2) | 7 | 0 | 0 | 7 |
| Tel Marum II (§2.2) | 3 | 0 | 0 | 3 |
| Tel Marum III (§3.3) | 4 | 0 | 0 | 4 |
| Umm Zeitoun I (§4.2) | 12 | 0 | 2 | 14 |
| Umm Zeitoun II (§5.2) | 9 | 0 | 4 | 13 |
| Umm Zeitoun III (§6.2) | 12 | 0 | 3 | 15 |
| Umm Zeitoun IV (§7.2) | 15 | 0 | 3 | 18 |
| **total** | **62** | **0** | **12** | **74** |

Zero `schema`-status rows anywhere in this document: every mechanism used
across all seven missions is either already live (`say`/`say_on_fail`/
`dispatch`/`aftermath`/`debrief`/`remove`/`starting_force.group`, all landed
2026-09-03) or blocked on genuine runtime work (`engine`, ranked in Part
Three). The 12 `engine` rows are, without exception, spoken lines with no
live carrier — six blocked on G12/G-D (a wave cannot speak), four on G8/G-E
(a trigger cannot watch an objective or a `SimEvent`), two on Act I's still-
open G-B (`evacuated` produces no toast or line). No mechanism — no trigger,
no wave, no objective — was left unauthored for want of a schema field.
