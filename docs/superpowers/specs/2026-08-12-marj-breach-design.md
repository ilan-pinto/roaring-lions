# First Light — the Marj breach

Design for issue #65's Mission 1: the campaign opens with the player being overrun.

## Scope

This spec covers **one mission plus the two capabilities it needs**:

1. A sixth phase, `breach`, in the mission schema and GDD §4.
2. The `evacuate_before` objective type in the sim (closes #3).
3. A new map, `marj_perimeter`.
4. The mission `beit_sahwan_breach` — "First Light".
5. Recon starts drawing its force from the ledger, so the breach's cost carries.

Issue #65 also sketches missions 2–8. Those are **out of scope** and stay with #19
(Khan Rafid and Deir Amun) and #22 (campaign progression). Three of them —
recon, foothold, clearance — already exist.

## Why the phase question is cheap

`mission.phase` is validated by the schema, described in the GDD, and **read by no
code**: a grep across `sim`, `data`, `render` and `app` finds only the renderer's
unrelated animation phase. Adding a phase therefore costs one enum entry plus a
canon edit, not an engineering change. GDD §4's "Five phases." and "one system
expressed five ways" both become six.

`breach` rather than `defense`: the phase names a *place in the campaign arc*, the
way the other five do, not a mission genre. Any doctrine can open on the back foot.

## The evacuation problem

Civilians today move for exactly one reason (`stepCivilians`): suppression above
`CIV_FLEE_AT` makes them break for the refuge, once, in fear. An evacuation
objective built on that mechanic would reward **shooting near civilians to herd
them** — the precise inversion of what the ROE system exists to teach.

So `evacuate_before` needs a second, player-driven cause for civilians to move.

### Shepherding

A civilian within `SHEPHERD_RADIUS` (4 tiles) of a living player unit is ordered to
the refuge — the same one-shot move `stepCivilians` already issues, with a different
cause and the same `civFled` latch so it cannot re-issue every tick. Arriving inside
the refuge zone marks the civilian evacuated.

The player's movement is the tool. No new command kind, no new input affordance, no
control over civilians as units — they remain untargetable and uncommandable, which
is what `civilians.json` and the GDD both promise.

Fleeing and shepherding share the latch deliberately: a civilian already running
from fire cannot be re-shepherded, and one being walked out cannot be re-panicked
into a second order. Both are "this person is now heading for the refuge".

### The objective

```json
{
  "id": "evac_settlements",
  "type": "evacuate_before",
  "primary": false,
  "target": "refuge",
  "count": 6,
  "seconds": 480,
  "text": "Get six civilian groups clear of the settlements before the corridor closes"
}
```

- **Complete** when `count` civilians have reached the refuge zone.
- **Failed** when `seconds` elapses with fewer than `count` arrived.
- Arrival is **latched**: a civilian who reaches the refuge stays counted.

`count` counts **civilian entities**, matching every other `count` in the schema. One
entity is a group of six people (`civilians.json` has `crew: 6`), so `count: 6` is six
household groups, not six individuals. Objective text says "groups" so the HUD number
and the fiction agree.

`target` is a map **zone** (arrival needs an area, not a point). The mission's
`civilians.refuge` marker sits inside that zone so fleeing and shepherding agree on
where "out" is.

### The `failed` status

Objectives are `active | complete` today. `evacuate_before` is the first type that
can *expire*, so the status union, the `objective` mission event, and the HUD's
objective list all gain `failed`. GDD §5.8 requires the model be shown, not hidden:
a deadline the player cannot see expire is a hidden model.

### Failing the evacuation does not lose the mission

`evacuate_before` here is **secondary**. `checkEnd` is untouched — defeat remains
"wiped out" or "ROE collapse". The evacuation's price is the ROE rating and the
carry-over, both of which make the reconquest harder without making it unwinnable.

This is deliberate. Issue #65 names the risk directly: an opening mission the player
is *meant* to nearly lose is the easiest thing in the campaign to over-punish, and it
sits immediately behind the tutorial. Losing the whole mission because six families
were slow is where a new player quits.

## The map — `data/maps/marj_perimeter.json`

48×48, matching `beit_sahwan_outskirts` so the engine and the pacing stay familiar.

West to east, because the Marj lies west of Kedem on the campaign map:

| Band | x | Contents |
|---|---|---|
| Ashwar staging | 0–8 | Assembly markers (`ashwar_north`, `ashwar_centre`, `ashwar_south`) and two tunnel exits inside the settlements |
| The perimeter | 14–18 | The KDF forward line: berms and cover, deliberately too long for the force holding it |
| Border settlements | 22–30 | Two dense Kedem villages — buildings, a flagged clinic, the civilians |
| The strongpoint | 32–36 | A walled compound: the `hold_for` zone |
| The refuge | 40–47 | The evacuation zone and its marker |

The civilians are **Kedem's own border villagers**, not the Marj's. That falls out of
the geography rather than being asserted: the enemy breaks eastward out of the Marj,
so everything behind the KDF line is Kedem. It also makes the evacuation personal
without any new fiction.

Per the decision recorded with this spec, the tactical map is **dense** while the
campaign map's Marj stays sparse — different scales of the same place, not a
contradiction to resolve. GDD §2 is unchanged.

## The mission — `beit_sahwan_breach`

Id without a numeral, on purpose. Renaming `beit_sahwan_1_recon` and its siblings
would invalidate `campaign.completed_missions` in every saved ledger and break Sur's
`unlock.after_mission` gate. Campaign order lives in `world.json`'s `missions` array,
so the breach goes first there and the existing ids stay untouched. Display name is
"Beit Sahwan — First Light", with no numeral to collide with I/II/III.

### Losing ground without a script

**The perimeter is not an objective.** The player starts spread along it; it is
longer than the force can hold; and abandoning it costs nothing mechanically. The
mission's geometry does the storytelling that a script would otherwise have to fake.
Nothing in the JSON says "now retreat" — GDD §6 forbids that, and it is not needed.

No reinforcements: `resources.supply_corridor: false`, a small `logistics_start`, and
no `logistics_rate_per_min`. The corridor is cut; what you have is what you get.

### Objectives

| id | type | primary | shape |
|---|---|---|---|
| `hold_strongpoint` | `hold_for` | yes | 300s accumulated in the compound |
| `survive_relief` | `survive_until` | yes | 780s — the relief clock |
| `evac_settlements` | `evacuate_before` | no | 6 civilian groups by 480s |

`target_minutes: 14`. The relief clock is the binding one: the hold banks its 300s
well before it, so the mission ends when `survive_until` fires at 13 minutes, inside
GDD §6's 12–20 window with a minute of slack for the end screen. The evacuation
deadline lands at 8 minutes — early enough that the last third is pure defence, so
the two pressures do not compete for the whole mission.

`survive_until` is a pure clock, and defeat is only wipe-or-ROE, so "survive" already
means exactly what the premise wants: outlast, at whatever cost.

### Enemy

Five enemy types exist (`militia_cell`, `rpg_team`, `technical`, `atgm_cell`,
`mortar_crew`); mass comes from counts and frontage, not new units.

- **Garrison:** `ambush`-stance cells already inside the settlements — the
  infiltration is *there when the mission starts*, which is what makes the opening
  read as a breach rather than an attack.
- **Waves:** wide-front, from all three assembly markers plus the tunnel exits, on
  `at_seconds` through the mission.
- **Triggers:** `first_contact` → `commit` the settlement cells; `casualties_pct` →
  the final push. Two triggers, inside GDD §6's budget.

### ROE

Enabled, clinic zone flagged, **no `fail_below`**. Mission 1 must not be lost on the
rating. The rating still scores, still writes to `roe.mission_ratings`, and still
feeds the campaign mean that region unlocks can gate on — the consequence is
carry-over, not failure.

## Ledger — the campaign's origin

```json
"ledger": {
  "requires": [],
  "produces": [
    "roster.surviving_units",
    "roe.mission_ratings",
    "campaign.completed_missions",
    "civ.settlements_evacuated"
  ]
}
```

`civ.settlements_evacuated` records how many civilians got out, for #19's later
missions to read.

**Consumed downstream now:** `beit_sahwan_1_recon` changes `requires` from `[]` to
`["roster.surviving_units"]` and marks its scout placements `from_ledger: true`. A
costly breach fields a thinner recon patrol.

That degrades correctly **by construction**, not by new code: `spawnPlacement`
already treats an absent `roster.surviving_units` as a fresh start at full strength,
a sparse roster as fewer units, and a gutted one as a single fresh remnant. Playing
recon standalone is unchanged.

## Testing

- **Unit tests** (`packages/sim/src/mission.test.ts`): shepherding moves a civilian
  near a player unit and not one far away; the latch prevents re-issue; arrival in
  the refuge zone counts once; `count` reached completes; the clock expiring marks
  `failed`; a failed secondary does not end the mission.
- **`walk_mission`** on the authored mission: markers, zones, groups and wave timings
  resolve in the real world. This is the tool that caught three content bugs in the
  Beit Sahwan II delivery that every unit test passed.
- **`playtest.ts`**: a scripted plan proving First Light winnable inside 14 minutes —
  the issue's "difficulty honesty" requirement. Not tuned against the normal
  cost-curve expectations; being outnumbered is the point.
- **`pnpm test:determinism`**: the sim changes, so the golden hash moves. Updated in
  the same commit, with the reason stated.
- **Gates:** `pnpm validate:data`, `pnpm lint`, `pnpm test`.

## Risks, recorded

**`hold_for` accumulates.** It banks ticks rather than requiring continuous holding,
so a player can accumulate 300s early and lose the compound before relief arrives.
That is forgiving in the direction this mission needs, but it is not literally
"holding when relief arrives". Accepted as-is; tightening it would mean a new
objective type.

**Tutorial adjacency.** First Light sits directly behind the tutorial, so a player
arrives having just learned control groups. The ordering needs playtesting, and the
tutorial may need to become non-skippable ahead of it. Out of scope here; flagged for
#22.

**Difficulty is a playtest question, not a design one.** The spec fixes the shape;
the wave counts and the clock will move during the playtest pass.
