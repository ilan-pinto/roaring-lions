# Tel Marum — the three missions

**Date:** 2026-08-26
**Issue:** [#20](https://github.com/ilan-pinto/roaring-lions/issues/20) (Tel Marum and Umm Zeitoun missions)
**Slice:** 3 of the Sur front (`2026-08-22-sur-front-design.md`). Slice 1 (rock terrain) and slice 2 (the Sarim roster) are shipped.
**Status:** approved design. Implementation plan follows.

## The problem

Tel Marum has a map and no missions. `data/campaign/world.json` lists the town with
`"missions": []`, and `validate_data.mjs:704` is satisfied because the check runs the
other way — it refuses a mission file no town lists, not a town with nothing in it. So
the gateway to Sur is authored ground that cannot be played.

The front spec calls for three missions on the ascending-phase pattern: recon (find the
firing positions before committing), foothold (hold a start line under rockets),
clearance (take the pass). Opening at phase 2 like Wadi Halam, *"because you are never
surprised again after First Light — but for the first time the enemy holds ground
properly instead of melting."*

There is a second problem underneath the first, and it is the one that shapes the design.

## The saddle that costs nothing

Tel Marum's premise is two unequal ways through the mountain wall: the narrow saddle
costs time, the wide one costs vehicles. Driving the real `Sim` from all eighteen
overwatch tiles found that the narrow saddle costs **neither**. A
hollow → west flank → narrow saddle → battery route is +9 tiles (38 vs 47) and never
crosses a tile either overwatch pocket can both see and reach at the `atgm_cell`'s
10-tile Kornet range.

The grid says why, and it is structural rather than a near miss:

```
y=12..14   ^^^^^^^^^^..^^^^^^^^^^.....^^^^^^^^^^^^^^^^^^^^^
y=15..17   ^^^^^^^^^^..^^^^^^^...........^^^^^^^^^^^^^^^^^^
                     ↑↑              ↑         ↑
              narrow x10-11    overwatch_west  overwatch_east
```

`overwatch_west` sits at [20,16]. `saddle_narrow` is at [10,14] — 10.2 tiles away, just
past the Kornet's reach — and `x=12..18` at `y=15..17` is solid `^` between them. The
pocket cannot see the saddle and could not range it if it could.

**Decision: the terrain stays exactly as authored.** The ground is correct; what is
missing is a mission that charges for the flank. This is the debt bullet's own
prescription, it keeps the map stable for Umm Zeitoun, and it treats the gap as a
mission problem rather than a terrain bug.

## What makes the charge possible

`rocket` is in `INDIRECT_MASK` (`sim.ts:223`): *"Classes that fire indirect — no line of
sight needed, only a side contact."* Two consequences, both verified in the code:

- `sim.ts:2087` skips the `losRay` check for indirect weapons, so the battery shoots
  through the mountain wall.
- `sim.ts:2073` gates every shot on `contact[sSide * cap + target] < IDENTIFIED_AT` —
  identification is **per side**, not per unit. The battery fires at whatever *any* Sarim
  unit has identified.

So the Grad section's eyes are a killable thing. That is the mechanic the whole arc
teaches, and it is what prices the narrow saddle.

Measuring `grad_122` (range 20, effective 15, min range 4, splash 3.0, damage 240,
accuracy 0.4, 2 rpm) from `battery_position` [25,6]:

| Marker | Distance | In envelope |
|---|---|---|
| `pass` [24,12] | 6.1 | yes |
| `saddle_wide` [24,14] | 8.1 | yes |
| **`saddle_narrow` [10,14]** | **17.0** | **yes** |
| `approach` [24,24] | 18.0 | yes, at the edge |
| `hollow` [24,29] | 23.0 | no |
| `start_line` [24,44] | 38.0 | no |

The battery reaches the narrow saddle even though the Kornet pockets do not. The free
flank prices itself in rocket exposure, using terrain and roster exactly as shipped. The
hollow and start line fall outside the envelope, so the southern valley floor reads as
*form up here* — which is what the front spec's dead-ground note asks the map to say.

## Measured, not assumed

Range is arithmetic; sight is not. Every sight line this design rests on was driven
through the real `Sim` with `debugDetection`, not sketched on the grid. Three results
changed the design, and the first killed the version of mission II that was approved:

- **Nothing north of the wall can see the hollow.** 841 open tiles see [24,29]; **zero**
  of them sit at y ≤ 17. The wall denies the hollow to every possible Sarim observer, so
  a spotter could never give the battery eyes on it. The first draft of mission II held
  the hollow under rocket fire, which is not merely misplaced — it is impossible.
- **`overwatch_west` cannot see the hollow** (13.6 tiles) but **can see the approach**
  (8.9 tiles). Mission II therefore holds the approach. The hollow keeps its role as
  dead ground: out of range at 23 tiles *and* unobservable, which is a stronger claim
  than the design originally made for it.
- **A spotter at the narrow saddle's mouth [8,9] cannot see into the corridor** (false at
  5.4 tiles). The corridor is observed from the northern valley instead; [12,4] sees
  y13, y15 and y17.

A ray drawn by eye agreed with none of these. This is the reason the map is walked with
the runtime rather than read.

## The arc

The through-line is the spotter→battery relationship. Each mission teaches one more of
it, and the third mission charges for the flank using a rule the player already knows.

### I · Recon

`tel_marum_1_recon` · phase `recon` · `target_minutes: 7` · start `start_line` [24,44]

**Force.** Carried `inf_squad` ×3 and `at_team` ×1 (`from_ledger: true`); fresh
`recon_drone` ×1, `jeep_shoded` ×1, `apc_eitan` ×1.

**Objectives.**
- primary `locate`, count 4 — both Kornet pockets, the Grad section, the west spotter
- secondary `locate` → `tm_hvt_battery`
- secondary `survive_until`, 240s

**Enemy.** `atgm_cell` ×2 in the overwatch pockets; `sarim_rifles` picket at the wide
saddle mouth; `recoilless_team` on the bay lip; `rocket_battery` at [25,6] tagged
`tm_hvt_battery`; `sarim_rifles` tagged `tm_spotter_west` in `overwatch_west`.

**The lesson.** The battery is live from the first mission. Push the drone forward and
keep the metal in the hollow; cross into the approach and you are inside the envelope.
The geography of the 20-tile circle is the teaching, not a scripted silence.

### II · Foothold

`tel_marum_2_foothold` · phase `foothold` · `target_minutes: 6`

**Force.** Carried infantry and AT; fresh `apc_eitan` ×2, `mbt_lavi` ×1, `mortar_team` ×1.

**Objectives.**
- primary `hold_for` → `approach` zone, 240s
- primary `eliminate_hvt` → `tm_spotter_west`

**The lesson.** `tm_spotter_west` in `overwatch_west` [20,16] sees the approach at 8.9
tiles. The moment it identifies the player, the Grad ranges a zone the player is
*required to stand in*. Killing the spotter stops the fire. This is the mission that
teaches the rule: indirect fire is not weather, it is a person on a hill.

The zone is a gradient rather than a kill box. Of its 35 tiles, 24 are visible to the
spotter and 29 are inside the battery's envelope, but only **18 are both** — battery
distance runs 16.0 to 20.4 across the zone. Holding it is therefore a choice about which
corner to bleed in, not a flat endurance check.

### III · Clearance

`tel_marum_3_clearance` · phase `clearance` · `target_minutes: 7`

**Force.** Carried infantry and AT; fresh `mbt_lavi` ×2, `apc_eitan` ×2, `ifv_namer` ×1,
`mortar_team` ×1.

**Objectives.**
- primary `capture` → `pass` zone, 20s
- primary `eliminate_hvt` → `tm_hvt_battery`
- `roe.flagged_zones: ["town_block"]`, `fail_below: 45`

**The charge.** Two spotters now: `tm_spotter_west` in the pocket, and
`tm_spotter_narrow` — `sarim_rifles` at [12,4] in the northern valley, which sees the
whole narrow corridor (y13, y15 and y17 all visible) and sits 13.2 tiles from the
battery, so a player who takes the flank emerges on top of the thing pricing it. The wide
saddle costs vehicles to the Kornet pockets. The narrow saddle costs rockets at 17 tiles,
**but only while its spotter lives**. The +9-tile flank is priced in mission data by a
rule taught in II, and a player who kills the narrow spotter first has earned the cheap
route rather than stumbled onto it.

## The battery

The Tel Marum map carries a `battery_position` marker while the front spec reserves *"the
batteries themselves"* for Umm Zeitoun's climax. **This is a forward battery, destroyed in
clearance.** One displaced Grad section covering the pass — the picket that proves the
threat is real. Umm Zeitoun keeps the massed batteries. This gives all three missions one
legible antagonist and a clean escalation into the next town.

## Roster carry-over

Infantry and AT teams are drawn with `from_ledger: true`; vehicles are allocated fresh per
mission. Marj losses follow the player into Sur, which is the campaign ledger's whole
point, and it makes the front continuous rather than a separate war.

This cannot produce an unplayable start. `mission.ts:886-901`: a sparse roster fields
fewer units, a gutted one fields a single fresh remnant, and a campaign with no
`roster.surviving_units` key at all spawns fresh at full count — *"harder mission, never a
broken one."*

## Map changes

`data/maps/tel_marum.json`, additive only. The character grid and the elevation grid are
untouched.

- new zone `approach`: `[21,22,7,5]` — x21–27, y22–26, all 35 tiles open, containing the
  `approach` marker. `hold_for` targets zones rather than markers (`ford_watch` in
  `wadi_halam_basin` is the precedent), and Tel Marum had no zone south of the wall.
- new zone `town_block`: `[24,3,3,2]` — the map's only six `#` tiles, two from the
  battery. Flagged by III so shelling the Grad is a decision rather than a formality.
- new marker `sarim_west`: `[8,4]` — open ground behind the narrow saddle, the wave
  source for III.

`pass` `[22,12,5,6]` already exists and serves III's `capture` unchanged.

## Objective types that do not exist

`mission.schema.json` lists twelve objective types. The runtime implements nine:
`locate`, `hold_for`, `capture`, `survive_until`, `eliminate_hvt`, `evacuate_before`,
`raze`, `collapse`, `destroy_all`. **`mark`, `escort` and `no_collateral_above` appear in
the enum and nowhere in `packages/` or `tools/`** — authoring one produces an objective
that validates, ships, and silently never evaluates.

The first draft of this design gave II and III a `no_collateral_above` secondary. It
would have passed `validate:data` and done nothing. ROE reaches these missions through
the shipped mechanism instead: `roe.enabled` everywhere, and in III a `flagged_zones`
entry over `town_block` with `fail_below: 45`. Without a flagged zone Tel Marum's ROE
score cannot move — the map fields no civilians — so the flag is what makes the HUD mean
anything here.

Whether to build the three missing types, or cut them from the enum, is a separate
question this slice does not answer.

## Campaign wiring

`data/campaign/world.json`: `sur.towns[tel_marum].missions` gets the three ids.

**No region-unlock changes.** Marj → Sur → Naharin re-sequencing belongs to slice 5, and
`validate_data.mjs:714` enforces an earlier-region ordering constraint that a partial
edit here would walk into.

Ledger contracts:

| Mission | requires | produces |
|---|---|---|
| I Recon | `roster.surviving_units` | roster, `roe.mission_ratings`, `campaign.completed_missions`, `intel.marked_positions` |
| II Foothold | roster, `intel.marked_positions` | roster, roe, completed |
| III Clearance | roster | roster, roe, completed |

`packages/data/src/index.ts`: three imports and three entries in the `missions` object.
`MissionId` widens from the object literal, so no type edit is needed.

## Verification

| Gate | Expectation |
|---|---|
| `pnpm validate:data` | schema, plus the `:687`/`:704` cross-checks — every mission listed by exactly one town |
| `pnpm typecheck` | CI runs it and CLAUDE.md omits it; literal-union fields in mission JSON break JSON-module call sites and nothing but `tsc` catches it |
| `pnpm test` | 863-test baseline unmoved |
| `pnpm test:determinism` | **hash unmoved.** Nothing in this slice is sim code, so any movement is a bug in the work |
| `pnpm balance` | §5.7 figures unmoved — no unit edits |
| `playtest.ts` | three scripted plans → `victory`, three no-orders controls → `defeat` |
| Duration | scripted clock against declared `target_minutes`, aiming inside the 0.51–1.00 band the other eight missions hold |
| Browser | `?sandbox=tel_marum` for terrain, then each mission driven in the real UI |

## Known limits

- **`playtest.ts` is wired into neither `pnpm test` nor CI.** It is run by hand and its
  output reported. This is the standing debt that let a crash sit unnoticed on `main` for
  two days; this slice does not pay it.
- **A scripted plan proves a mission winnable, not how long it takes.** The plans are
  optimal-play proofs. The duration figures below `target_minutes` are a floor, not a
  measurement of real play, and `beit_sahwan_1_recon` (ratio 0.07) shows how far a recon
  mission in particular can diverge.
- **Tel Marum is the first map with relief**, so these are the first missions that can
  reach the known-inert elevation gaps: `raySmoke` (`sim.ts:1771`) ignores elevation and
  is called before any height reasoning at `:1816`; VFX are not lifted to terrain height;
  and `trailG`/`fxG`/`wreckLayer` sit below `spriteLayer` unconditionally, so a wreck in
  front of a ridge is covered by it. All cosmetic, none in scope here. Anything observed
  gets reported, not fixed.
- **The `starting_force` unlock gate is not consulted** (`spawnPlacement` has no
  equivalent of `requestBuild`'s `buildBlockedReason`). All three missions hand out units
  a fresh campaign has not earned: I fields a `recon_drone` (ROE 35), II an `mbt_lavi`
  (55), III an `mbt_lavi` (55) and an `ifv_namer` (40). This matches what
  `beit_sahwan_1_recon` and Wadi Halam I–V already do, and by the time Sur unlocks — after
  `beit_sahwan_3_clearance` — a player on the intended path has cleared 55. Resolving the
  gate is not this slice's call.
