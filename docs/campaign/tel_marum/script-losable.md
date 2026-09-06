# Tel Marum I–III — one failable primary each (design decision O-C)

**Date:** 2026-09-06 · Written against `docs/campaign/tel_marum/design.md` §3.1/§3.5/§8
(row **O-C**), `docs/campaign/wadi_halam/script.md` §2 (the pattern this document
matches: one new failable primary per mission, minimal footprint, the passive
control's expected loss stated, the plan's own cost stated in orders or "none"),
`docs/campaign/tel_marum/narrative.md` (Tel Marum I–III ship
`"triggers": []` and carry no existing line for a civilian or a cache — this
document invents the fiction fresh, as design's own O-C entry authorizes, and
flags every new line for the narrative pass rather than treating it as final
copy), `data/schemas/mission.schema.json`, `packages/sim/src/mission.ts`, the
three shipped `data/missions/tel_marum_*.json`, and `data/maps/tel_marum.json`.

**The defect this closes**, verbatim from design §3.1: *"All three passive
controls are `ongoing`, not `defeat`... He is stuck, not lost."* Only `raze`,
`collapse` and `evacuate_before` can ever reach `failed` (`mission.ts`'s
`checkEnd`); Tel Marum has no tunnels, so `collapse` is unavailable for the
whole town, leaving `raze` and `evacuate_before` — the same two shapes Wadi
Halam's script used for the identical reason (its own §2 preamble). Two
missions get `evacuate_before` and one gets `raze`, matching design §8's O-H
rule for the front generally: *"They alternate... and the alternative is a
fourth objective type, which is engine work nobody has asked for."*

**Method.** Every number below (victory time, ROE, objective status, exact tick
a shepherd or a demolition lands) comes from actually stepping the real `Sim`
and `MissionRuntime` against the exact patched JSON in §4, in a scratch
harness outside this repository
(`/private/tmp/.../scratchpad/telm/`), seed `424242` — the same seed
`tools/src/backtest/playtest.ts` uses. This is not `pnpm playtest` itself
(that is `playtest`'s instrument to run against the real shipped files once
`mission-author` lands them) but it drives the identical `Sim` /
`MissionRuntime` / `parseMap` / `applyTerrain` code path the harness does, so
every claim of "the plan still wins" or "the control still loses" below is
measured, not read off the shipped orders and hoped.

---

## 1. The three primaries

### I — `tel_marum_1_recon` — `clear_the_valley_floor` (`evacuate_before`)

**The fiction.** Herders are caught on the valley floor, inside the Grad's
reach — the mission's own briefing already draws this line ("the valley floor
south of [the hollow] is out of the battery's reach, and everything north of
it is not"). They have to be off the floor before the guns find the range,
exactly the way the recon patrol itself has to stay out of the envelope.

**Schema shape.**

```json
{
  "id": "clear_the_valley_floor",
  "type": "evacuate_before",
  "primary": true,
  "target": "refuge",
  "count": 2,
  "seconds": 300,
  "text": "Get the herders off the valley floor before the battery finds the range"
}
```

- **`civilians`** (new to this mission): three herders, one group, placed at
  `[21, 24]` — north of the hollow (inside the battery's reach, per the
  briefing's own line), on open ground (`.` the whole way from x15–29,
  y18–30, checked against the map's own grid this session), and close to the
  drone's own first waypoint `[24, 25]` (§2 explains why that matters).
- **Refuge**: no new marker needed. `civilians.refuge` names the map's own
  existing `start_line` marker (`[24, 44]`) — the safe ground the briefing
  already calls out. The **zone** does not exist yet and is additive: `refuge
  [22, 42, 5, 4]` (x22–26, y42–45), open ground the whole rectangle, containing
  `start_line` (`22 ≤ 24 < 27`, `42 ≤ 44 < 46`), which is what `MissionRuntime.start()`'s
  refuge-in-zone guard requires.

  **Implementation note (`mission-author`, 2026-09-06): this fragment's zone
  name proved wrong and shipped renamed.** `data/maps/tel_marum.json` names it
  `muster_ground`, not `refuge`, and `clear_the_valley_floor`'s `target` names
  it the same way. Cause, measured: `packages/app/src/sandbox-extras.ts`'s
  `sandboxFlaggedZones` (the `&roe` sandbox flag) matches any map zone whose
  NAME contains `clinic|mosque|refuge|hospital|school` and prefers a matching
  declared zone over synthesising its own 4×4 — a rule this document never
  crossed with, since Tel Marum previously declared no such zone at all and
  CLAUDE.md's own account of `&roe` on Tel Marum describes the synthesised
  path. Landing a zone literally named `refuge` made Tel Marum's `&roe` ground
  jump from a synthesised 4×4 near the map's contact-range midpoint to this
  evacuation rectangle down at the player's own start line — nowhere near
  where `&roe` is meant to put flagged ground — and broke
  `packages/app/src/sandbox-extras.test.ts`'s own pinned expectation
  (`gives Tel Marum a synthesised zone, since it declares no protected one`,
  width 4 vs the declared zone's width 5). Neither that source file nor its
  test were in `mission-author`'s edit scope for this task, so the fix is the
  zone's name, not the regex or the test. `muster_ground` matches none of
  `sandboxFlaggedZones`' or `sandboxRefuge`'s name patterns; the geometry,
  the marker it contains, and every other fact in this section are unchanged.
- **Objective `text`** is in the orders voice and names the ground, not a
  person. `say`/`say_on_fail` below are drafted in Idit/Shai's register for
  `narrative-designer` to accept, adjust, or replace — this document is not
  the narrative pass.

### II — `tel_marum_2_foothold` — `burn_the_ammo_point` (`raze`)

**The fiction.** A forward ammunition cache staged in the draw below the wall,
feeding the pockets that shell the approach — burn it before the position
re-arms itself.

**Schema shape.**

```json
{
  "id": "burn_the_ammo_point",
  "type": "raze",
  "primary": true,
  "target": "ammo_draw",
  "seconds": 300,
  "text": "Burn the ammunition cache in the draw below the wall"
}
```

- **`structures`** (new — raised by `MissionRuntime.start()` before any
  placement spawns): one `shanty` at `[22, 27]`, default `size: [2, 2]`,
  footprint `(22,27)(23,27)(22,28)(23,28)` — verified open on the grid, clear
  of every existing placement, and clear of the `approach` zone (`[21,22,7,5]`
  ends at y26) so it reads as forward of the hold, not inside it.
- **The defender**: one `sarim_rifles` at `[22.5, 26.5]` (one tile north of the
  footprint), `hold_position` — **not** `garrison`. `validate_data.mjs`'s
  garrison-stance check reads a `garrison` placement's `building` tile off the
  map's own static grid, never off a mission's own `structures[]`, so a
  `garrison` stance pointed at a mission-raised building can never pass it —
  the same finding `wadi_halam/script.md` §2.2 recorded and corrected for its
  own shed. Following that precedent rather than repeating the mistake.
- **A finding worth recording, because it decided the whole shape of this
  primary.** A freestanding, non-garrisoned structure in this sim cannot be
  destroyed by ordinary weapon fire at all — verified by direct measurement,
  not inferred. `fireAtStructure` only ever fires through
  `selectStructureTarget`, which requires `stOccupants[s] > 0` and an
  identified hostile inside (`sim.ts:2967`); splash from a miss
  (`splashAt`/`splashDirect`) only ever touches `isSoft` units, never a
  structure (`sim.ts:3826-3858`); and `selectBreachTarget`'s detour path never
  fired in five tried placements of the shed directly on the shipped plan's
  own move/attack-move destinations, because open ground around a 2-tile shed
  is cheap enough that the flow field always routes around it rather than
  taking a costly-enough detour to count as "blocked." The schema's own raze
  comment says as much (`mission.schema.json`): *"no command aims gunfire at a
  structure, the automatic structure-fire path needs a hostile inside it...
  the only way a player levels an unoccupied building is the `demolish`
  order."* Mission II's shipped roster has no `canDemolish` unit
  (`inf_squad`, `at_team`, `apc_eitan`, `mbt_lavi`, `mortar_team` — none), so
  this primary needs one, and adding one is the smallest content change,
  matching CLAUDE.md's own recorded precedent that `starting_force` fields a
  demolisher unconditionally elsewhere in the campaign (`wadi_halam_5_depot`'s
  `dozer_d9`/`demo_squad`, ROE-gated units placed with no unlock check because
  `starting_force` never consults one).
- **`starting_force`** gains one line: `{ "unit": "demo_squad", "count": 1,
  "at": [21, 44] }` — open ground beside the existing roster, unoccupied,
  confirmed by the same simulation run completing without a spawn-collision
  throw.

### III — `tel_marum_3_clearance` — `get_the_block_out` (`evacuate_before`)

**The fiction.** Design's own O-C recommendation (§8): *"a civilian group in
the pass town-block with an `evacuate_before` primary in III... makes the ROE
bait and the loss condition the same object."* `town_block [24,3,3,2]` is
already the mission's `roe.flagged_zones` entry, sitting two tiles from the
Grad — the same six tiles of housing the briefing calls out (*"Mind the town
block behind the pass"*). This primary puts people in it.

**Schema shape.**

```json
{
  "id": "get_the_block_out",
  "type": "evacuate_before",
  "primary": true,
  "target": "approach",
  "count": 2,
  "seconds": 300,
  "text": "Get three families out of the town block before the fighting reaches it"
}
```

- **`civilians`** (new to this mission): three families, one group, at
  `[27.5, 5.5]` — the open ground immediately east of the block (`town_block`
  itself is the three `#` tiles at x24–26, a family cannot stand inside a
  building footprint), outside `town_block`'s own rect so they do not
  double-count against the flagged zone, and outside the Grad's own tile.
  **Deliberately one group, on the east side, not two groups split east and
  west** — §2 explains the measured reason.
- **Refuge**: no new marker or zone. `civilians.refuge` names the map's own
  existing `approach` marker (`[24, 24]`), and `target` names the map's own
  existing `approach` zone (`[21, 22, 7, 5]`), which already contains that
  marker — the same zone `tel_marum_2_foothold`'s `hold_approach` uses,
  reused here in a different mission file with no interaction between the
  two. **Mission III needs zero map edits.**

---

## 2. Passive control loss, and what the shipped plan needs

| mission | passive control today | passive control with this patch | shipped plan, patched |
|---|---|---|---|
| I | `ONGOING`, 20.0 min cap | **`DEFEAT`, 5.00 min** — `clear_the_valley_floor=failed`; every `locate` never starts, `screen_out` still completes (it cannot fail) | **`VICTORY`, 0.85 min, ROE 100 — unchanged from shipped, zero order changes.** The drone's own first waypoint (`[24, 25]`, t=4s) already sits within 4 tiles of the herders at `[21, 24]` (`SHEPHERD_RADIUS_SQ`, `packages/sim/src/civilians.ts`), so they break for `start_line` at t≈4–16s and arrive on foot (0.8 tiles/s, ~18 tiles) well inside the 300s deadline, before the plan's next order even fires |
| II | `ONGOING`, 20.0 min cap | **`DEFEAT`, 5.00 min** — `burn_the_ammo_point=failed`; `hold_approach`/`kill_spotter` never start (force never leaves the start line) | **`VICTORY`, 4.24 min, ROE 98** (shipped baseline: 4.2 min, ROE 100 — design §3.1). **One added order**: the new `demo_squad` moves with the mortar's own t=3s order to `[23, 28]`, within `demolish`'s 2-tile range of the cache; it self-targets and burns it with no explicit `demolish` order needed (`stepDemolition`'s automatic branch, `sim.ts:4335`). The 2-point ROE cost is the demolition charge's own `collateral_risk` |
| III | `ONGOING`, 20.0 min cap | **`DEFEAT`, 5.00 min** — `get_the_block_out=failed`; `take_pass`/`kill_battery` never start | **`VICTORY`, 4.46 min, ROE 95** (shipped baseline: 3.5 min, ROE 100 — design §3.1). **Zero order changes**, but the mission now runs about a minute longer: `kill_battery` completes at t≈154s and `take_pass` at t≈212s exactly as shipped, but victory now waits on the evacuation too — the families are shepherded by the same forces already pushing toward the battery in the plan's own second half, and walk the ~19 tiles to `approach` on foot, arriving at t≈265–268s, comfortably inside the 300s deadline |

**Does the shipped briefing's fiction need a clause?** Yes, for all three —
`narrative-designer`'s to write, not this document's:

> **Closed 2026-09-06.** All three clauses below are in the shipped briefings
> now, each naming the thing and the five minutes, and the three objective
> texts carry "— five minutes". It took a lost mission to close them: the lead
> held Tel Marum II's approach to completion and was defeated on the cache's
> 300 s deadline, which no surface had ever shown — the briefing said nothing,
> the strip shows one primary, and `objectiveList` computed no `ticksLeft` for
> a `raze` at all. The engine half is closed in the same commit: `raze` and
> `collapse` deadlines have a clock, and the strip gives the most urgent
> failable primary its own line when it is not the one being shown.

- **I** — the briefing already says the valley floor north of the hollow is in
  reach; it does not yet say anyone is standing on it. One clause naming the
  herders belongs beside that line.
- **II** — the briefing describes the west pocket and the observer; it says
  nothing about a cache. One clause, and it is also where T10's twist
  (`wadi_halam`-style "the position is worth taking because of what it
  holds") could land if the lead wants it, though that is not this document's
  ask.
- **III** — the briefing already names `town_block` as ROE bait; it does not
  say anyone lives there. This is the one that most needs the clause, because
  the mission can now be lost over it.

**A measured caution for `playtest`, not a gap to fix here.** Mission III's
shepherding depends on *which* player unit reaches the families first. A
transport-capable unit (`ifv_namer`, `apc_eitan`) that reaches them mid-combat
boards them (`CivilianFlight.step` prefers a nearby carrier with free slots)
and then carries them wherever *that vehicle's own orders* take it next — not
toward the refuge. Measured directly: a first placement split the families
into two groups, one west of the block; the `ifv_namer`'s own attack-move
order swept through that side chasing the `tm_manpad` post, boarded two of
them, and dragged them further north and away from `approach`, stranding
them. The single east-side group in the shape above was chosen because the
unit that reaches it there (measured this session) is on foot or otherwise
not carrying them off — but a real player, free to route an IFV differently,
could reproduce the failure mode the first placement hit. This is not a bug
in `evacuate_before` (the schema's own words: *"they shelter in place until
fire lands close, then flee to the refuge"* — boarding a moving vehicle is
the documented fast path, not a special case) and it is not this document's
to fix; it is `playtest`'s to walk with more than one approach vector before
this ships, exactly as design §3.5 already requires for any failable-primary
addition ("the full ladder re-run, both plan and control").

---

## 3. ECA rows

| Event Name | IF | THEN | narrative cue bound | status |
|---|---|---|---|---|
| Herders reach the refuge | `objective(clear_the_valley_floor, complete)` @≤300s | `objectives[].say` | net: *"Herders are off the floor. Whatever the battery ranges onto tonight, it will not be them."* | live |
| Herders caught on the floor | `objective(clear_the_valley_floor, failed)` @300s | `objectives[].say_on_fail`; **loses the mission** | shai: *"The battery walked its fire onto the floor before the herders were clear of it. That ground was never ours to spend."* | live |
| Ammunition point burns | `objective(burn_the_ammo_point, complete)` @≤300s | `objectives[].say` | idit: *"That cache was feeding the pockets on the wall. They fight on what is left in their pouches now."* | live |
| Ammunition point survives | `objective(burn_the_ammo_point, failed)` @300s | `objectives[].say_on_fail`; **loses the mission** | shai: *"The cache is still standing and so is everything it was feeding. We bought them another night of fire."* | live |
| Town block cleared | `objective(get_the_block_out, complete)` @≤300s | `objectives[].say` | net: *"Block is clear. Three families in the approach and out of the line of it."* | live |
| Town block not cleared | `objective(get_the_block_out, failed)` @300s | `objectives[].say_on_fail`; **loses the mission** | idit: *"The block came down around people who were still inside it. LANTERN's gun was never the only thing we were fighting there."* | live |
| A herder/family reaches the refuge (mid-mission) | `evacuated` event | nothing spoken | `describeMissionEvent` has no `evacuated` case — Act I's **G-B**, still open, unrelated to this patch | engine |
| Mission ends, either result | `missionEnd(any)` | `debrief` string | needs the win/lose split another agent's schema change is already landing (`debrief` becoming an object) — **not touched by this document** | engine |

Every row's mechanism is `live`: `evacuate_before`, `raze`, `civilians`,
`structures`, `say`, `say_on_fail` all ship today (`mission.schema.json`,
verified by grep this session). Nothing here needs a schema field or engine
work to fire; the two `engine` rows are pre-existing, unrelated gaps carried
for completeness, not blockers.

---

## 4. Map additions

| kind | id | tile / rect | purpose | exists today |
|---|---|---|---|---|
| marker | `start_line` | `[24, 44]` | Mission I `civilians.refuge` (reused, no edit) | **EXISTS** |
| zone | `muster_ground` (shipped; this section originally spec'd `refuge` — see the implementation note in §1) | `[22, 42, 5, 4]` | Mission I `evacuate_before` target; contains `start_line` | **NEW — additive.** Character grid untouched; a zone nothing names is inert, so Missions II and III are unaffected |
| zone | `ammo_draw` | `[22, 27, 2, 2]` | Mission II `raze` target; matches the raised `shanty`'s own footprint | **NEW — additive**, same reasoning |
| marker | `approach` | `[24, 24]` | Mission III `civilians.refuge` (reused, no edit) | **EXISTS** |
| zone | `approach` | `[21, 22, 7, 5]` | Mission III `evacuate_before` target (reused from Mission II's own `hold_approach`, a different mission file — no interaction) | **EXISTS** |
| marker | `hollow` | `[24, 29]` | reference point only, for Mission II's added demo-squad order | **EXISTS** |

Both new zones were checked tile-by-tile against `tel_marum.json`'s own
`rows` this session and confirmed open (`.`), clear of every existing
placement and of the `^`/`b` terrain the map carries elsewhere.

---

## 5. Gap report

Nothing here needs a schema field or engine work to ship — every mechanism is
already live (§3). Two items are worth a name for whoever picks this up next:

| # | gap | cites | smallest proposal | owner |
|---|---|---|---|---|
| **(new)** | A freestanding, non-garrisoned `raze` structure cannot be damaged by ordinary weapon fire at all — only `demolish`, a called `strike`, or (in principle) `selectBreachTarget`'s detour path, which did not fire in five measured placements on open ground. This is implied by the schema's own raze comment but was not previously measured end-to-end; §1's Mission II write-up is the measurement | this document, §1 (Mission II) | Nothing to fix — it is a correct, if under-documented, mechanic. Worth a line in `mission.schema.json`'s raze description or in CLAUDE.md's known-debts section so the next author does not re-discover it the slow way | `mission-author` / whoever writes CLAUDE.md's next content-authoring note |
| **G-B** (pre-existing) | A civilian reaching the refuge is silent (`describeMissionEvent` has no `evacuated` case) | Act I, restated here | `render-vfx`; not part of this patch | `render-vfx` |
| **(new, caution not gap)** | A civilian shepherded onto a moving transport rides wherever that vehicle's own combat orders take it next, which can be away from the refuge — measured on Mission III's west flank (§2) | this document, §2 | Not a schema change; a content-authoring rule (place evacuation groups off the routes a transport-capable unit is likely to fight through) and a `playtest` instruction to walk more than one approach vector before Mission III's patch ships | `playtest` |

---

## 6. Copy-ready fragments

All field names below are grepped against `mission.schema.json` this session.
Every `say`/`say_on_fail` is ≤ 240 characters (longest: III's `say_on_fail` at
122) and every speaker is one of `shai | idit | net`. **Assembled into a
scratch copy of the three shipped files plus `tel_marum.json`, outside this
repository, and validated: `ajv` (draft 2020-12, the schema's own
`$schema`) against `mission.schema.json` for all three mission files and
against `map.schema.json` for the map — all four **PASS**. The same scratch
files were then stepped through the real `Sim`/`MissionRuntime` with both a
no-orders control and the shipped plan (patched only where §2 says a plan
needs it); results are §2's table.

### `tel_marum_1_recon.json`

`civilians` (new):

```json
{
  "civilians": {
    "refuge": "start_line",
    "groups": [{ "unit": "civilians", "count": 3, "at": [21, 24] }]
  }
}
```

`objectives[]` (appended). Shipped with `"target": "muster_ground"` — see the
§1 implementation note; `refuge` below is this fragment's original spec, kept
for the record:

```json
{
  "id": "clear_the_valley_floor",
  "type": "evacuate_before",
  "primary": true,
  "target": "refuge",
  "count": 2,
  "seconds": 300,
  "text": "Get the herders off the valley floor before the battery finds the range",
  "say": {
    "speaker": "net",
    "text": "Herders are off the floor. Whatever the battery ranges onto tonight, it will not be them."
  },
  "say_on_fail": {
    "speaker": "shai",
    "text": "The battery walked its fire onto the floor before the herders were clear of it. That ground was never ours to spend."
  }
}
```

### `tel_marum_2_foothold.json`

`starting_force[]` (appended):

```json
{ "unit": "demo_squad", "count": 1, "at": [21, 44] }
```

`structures` (new to this mission):

```json
{ "structures": [{ "type": "shanty", "at": [22, 27], "size": [2, 2] }] }
```

`enemy.garrison[]` (appended):

```json
{
  "unit": "sarim_rifles",
  "count": 1,
  "at": [22.5, 26.5],
  "facing_deg": 180,
  "tag": "tm_ammo_guard",
  "stance": { "kind": "hold_position" }
}
```

`objectives[]` (appended):

```json
{
  "id": "burn_the_ammo_point",
  "type": "raze",
  "primary": true,
  "target": "ammo_draw",
  "seconds": 300,
  "text": "Burn the ammunition cache in the draw below the wall",
  "say": {
    "speaker": "idit",
    "text": "That cache was feeding the pockets on the wall. They fight on what is left in their pouches now."
  },
  "say_on_fail": {
    "speaker": "shai",
    "text": "The cache is still standing and so is everything it was feeding. We bought them another night of fire."
  }
}
```

### `tel_marum_3_clearance.json`

`civilians` (new to this mission):

```json
{
  "civilians": {
    "refuge": "approach",
    "groups": [{ "unit": "civilians", "count": 3, "at": [27.5, 5.5] }]
  }
}
```

`objectives[]` (appended):

```json
{
  "id": "get_the_block_out",
  "type": "evacuate_before",
  "primary": true,
  "target": "approach",
  "count": 2,
  "seconds": 300,
  "text": "Get three families out of the town block before the fighting reaches it",
  "say": {
    "speaker": "net",
    "text": "Block is clear. Three families in the approach and out of the line of it."
  },
  "say_on_fail": {
    "speaker": "idit",
    "text": "The block came down around people who were still inside it. LANTERN's gun was never the only thing we were fighting there."
  }
}
```

### `tel_marum.json` (map — additive only, character grid and elevation untouched)

Shipped with the first zone named `muster_ground`, not `refuge` — see the §1
implementation note:

```json
{
  "zones": {
    "muster_ground": [22, 42, 5, 4],
    "ammo_draw": [22, 27, 2, 2]
  }
}
```

### `tools/src/backtest/playtest.ts` — the three control-expectation flips

Not this document's file to edit (constraint on this task; also outside this
agent's mandate — `playtest` owns the ladder). The change needed, once
`mission-author` lands the JSON above:

```diff
- run('tel_marum_1_recon', () => {}, {}, 'ongoing', 'tel_marum_1_recon (passive control)');
+ run('tel_marum_1_recon', () => {}, {}, 'defeat', 'tel_marum_1_recon (passive control)');
```
```diff
- run('tel_marum_2_foothold', () => {}, {}, 'ongoing', 'tel_marum_2_foothold (passive control)');
+ run('tel_marum_2_foothold', () => {}, {}, 'defeat', 'tel_marum_2_foothold (passive control)');
```
```diff
- run('tel_marum_3_clearance', () => {}, {}, 'ongoing', 'tel_marum_3_clearance (passive control)');
+ run('tel_marum_3_clearance', () => {}, {}, 'defeat', 'tel_marum_3_clearance (passive control)');
```

The comments above each of those three lines (the "bounded fallback,"
"no wave-volume wipe was attempted" reasoning) describe the *old* ruling and
should be replaced with a line pointing at this document's §1/§2, rather than
left to read as if the mission still cannot be lost.

**Plan order outlines** (tables only, matching this agent's own constraint
against TypeScript/pseudocode — `mission-author`/`playtest` translate to
`sim.queueCommand` calls):

Mission I — **no change.** The shipped plan's existing order at t=4s already
does the work:

| t (s) | unit | order kind | target | note |
|---|---|---|---|---|
| 4 | `recon_drone` | move | `[24, 25]` | unchanged from shipped — this waypoint alone sits within 4 tiles of the herders at `[21, 24]` and starts them walking |

Mission II — **one order added**, grouped with the mortar's own existing
order:

| t (s) | unit | order kind | target | note |
|---|---|---|---|---|
| 3 | `mortar_team` | move | `[24, 29]` | unchanged from shipped |
| 3 | `demo_squad` | move | `[23, 28]` | **new** — within 2 tiles of the cache footprint; the squad self-targets and burns it on arrival, no `demolish` order needed |

Mission III — **no change.** The shipped plan's existing second-half push
(t=85–240s) already carries a unit within shepherd range of the families;
see §2 for the measured arrival time.

---

## Verification record

- Every field name above (`evacuate_before`, `raze`, `civilians`, `refuge`,
  `groups`, `structures`, `at`, `size`, `stance`, `hold_position`,
  `facing_deg`, `tag`, `say`, `say_on_fail`, `speaker`, `text`) is grepped
  against `data/schemas/mission.schema.json` this session.
- Every unit id resolves: `civilians` (`data/units/civilians.json`),
  `demo_squad` (`data/units/kdf/demo_squad.json`), `sarim_rifles`
  (`data/units/enemy/sarim_rifles.json`). Every structure type resolves:
  `shanty` (`data/structures.json`).
- Every marker/zone named either exists on `data/maps/tel_marum.json` today
  (`start_line`, `approach`, `hollow`) or is listed in §4 as new
  (`refuge`, `ammo_draw`), with tiles checked against the map's own `rows`.
- No `to`/`from` is used here at all (no waves, no triggers added) — only
  `target` (a zone) and `refuge` (a marker), matching the schema's own
  distinction.
- No trigger is added, so the "no trigger depends on firing twice" rule is
  vacuous here by construction.
- ajv (draft 2020-12) against `mission.schema.json` for all three patched
  mission files, and against `map.schema.json` for the patched map: **PASS**,
  run this session in a scratch directory outside this repository.
- The same scratch files were stepped through the real `Sim`/`MissionRuntime`
  (seed 424242) for a no-orders control and the shipped plan, per mission —
  results in §2. This is a heavier bar than the agent's own minimum
  (assemble + ajv); it was done because a failable primary changes what
  "the plan still wins" means, and design's own O-C entry warns that this
  exact change "invalidates all six [`playtest`] lines" — better to know
  before handing it off than to assert it.
