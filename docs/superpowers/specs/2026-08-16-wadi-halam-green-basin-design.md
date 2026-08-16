# The green basin — Wadi Halam

**Date:** 2026-08-16
**Status:** approved, ready for implementation planning
**Partly closes:** [#21](https://github.com/ilan-pinto/roaring-lions/issues/21)
**Scope:** Spec A of two. Spec B is the art pass — building repaint and arched
windows, a brick wall type, and the Rif in black. A is playable without B.

Naharin has a region, a faction and a town, and has never had a mission. This gives
it five, on a green open-terrain map, and it fixes the three things standing in the
way: there is no terrain theme in the engine, the region is unreachable, and "take
down all the buildings" is not an objective type.

## Scope

1. **A canon amendment.** GDD §2 makes Naharin a green river basin rather than
   eastern river desert.
2. **A `grass` ramp** in `data/palette.json` — five entries, `total_colors` 53 → 58.
3. **A map-level `terrain` theme**, carried from map JSON through `ParsedMap` into a
   resolved `terrainTones` bundle on `RendererOptions`, plus one scatter branch in
   `drawTerrain`.
4. **The `raze` objective type** — every structure in a named zone destroyed.
5. **One map**, `data/maps/wadi_halam_basin.json`.
6. **Five missions** for town `wadi_halam`, the last a D9 demolition.
7. **Retargeting** `naharin.unlock.after_mission` so the region can be entered.
8. **Two fixes to the playtest harness** that the winnability proof needs to be worth
   anything.

**Out of scope:** supply-corridor interdiction (see Risks — this leaves an #21
acceptance line unmet, deliberately); new units; new art; new decor kinds; new map
symbols; elevation; water terrain; and the §5.7 Raid (Rif) backtest target.

## Why the theme question is cheap, and where it is not

Cheap: `map.schema.json` is `additionalProperties: false` with no terrain field, so
adding one is a schema entry plus a loader field. `parseMap` already returns a struct
that `main.ts` hands piecewise to the renderer; `terrain` rides along exactly as
`decor` does.

Not cheap: `packages/render/src/renderer.ts` has **no tileset**. `drawTerrain`
(:1061–1244) paints every tile with Pixi `Graphics` and hardcodes seven palette keys
at :1079–1091 — `shadow.0`, `dust.3`, `dust.5`, `limestone.6`, `limestone.3`,
`terracotta.2`, `olive.1`. `drawOliveTree` (:1255–1316) hardcodes five more. Twelve
keys.

And hue is only half of it. **The scatter logic is desert-specific in shape, not just
colour.** The "limestone breaking through" pass at :1205–1214 draws pale rock
ellipses; the "dry bush" at :1218–1225 draws one sparse isolated blob because "the
reference is mostly bare ground". Recolouring those green produces green rocks on a
green field. The file already states the governing principle — *"Small marks at high
frequency read as ground; big ones do not"* — and grass needs a different mark, not a
different fill.

## The theme mechanism

**Chosen: a map-level field resolved into a tones bundle, plus exactly one branch.**

`MapJson.terrain?: 'arid' | 'green'`; `ParsedMap.terrain` defaults to `'arid'`;
`RendererOptions` gains `terrainTones`, a named struct holding all twelve tones
already resolved to hex plus two shape discriminators:

```ts
export interface TerrainTones {
  open: string; cover: [string, string, string]; blocked: string;
  underBuilding: string; road: string; rut: string;
  rock: string; rockLit: string; earth: string; low: string;
  trunk: string; trunkLit: string; leafDark: string; leafMid: string; leafLit: string;
  /** Crown aspect: olive is wide and squat (0.52), poplar is tall (0.95). */
  crownRatio: number;
  /** How open ground is grained. */
  scatter: 'stone' | 'sward';
}
```

`main.ts` picks the bundle from `TERRAIN_THEMES: Record<TerrainTheme, TerrainTones>`.
Typing it as a `Record` makes theme coverage a compile error rather than a test.

`terrainOpen` / `terrainCover` / `terrainBlocked` on `RendererOptions` (:35–37) fold
into this bundle and are removed. They are the same three values, and keeping both
invites divergence. That is a mechanical edit at `main.ts:288–292` and the ~15
`this.opts.terrainOpen` reads in `renderer.ts`.

**Rejected — `renderer.setTheme(theme)`.** It creates a second, mutable path for
something that never changes inside a mission, and there is nothing to defer:
`main.ts:228` parses the map *before* `new PixiRenderer` at :332. `setDecor` exists as
a setter only because the decor array is per-tile bulk data the renderer caches; a
colour set is not that.

**Rejected — branching on a theme enum throughout `drawTerrain`.** It would put
palette keys and terrain vocabulary inside `@lions/render`, which today has none:
every colour arrives pre-resolved through `opts`. It also moves "what does Naharin
look like" out of `data/` and into engine code, which is the inversion CLAUDE.md's
*"adding a unit means adding JSON, never engine code"* exists to prevent.

**One branch survives, on `scatter`.** That is the honest split: tones are data, but
*how many marks of what shape* is drawing code and belongs in the renderer. One
branch, at the one place the logic genuinely differs.

### The `sward` scatter

Replacing the three passes at :1200–1226, keyed off the same `PixiRenderer.h2` tile
hash so the ground stays stable between rebuilds:

- **Blade ticks** instead of rock ellipses. 8–14 one-pixel-wide vertical strokes,
  2–3px tall, per tile, alternating `grass.0` (lit, ~60%) and `grass.3` (shade, ~40%),
  jittered across the diamond. Higher count than the stone pass's 3–8 because grass is
  denser than gravel, and strokes rather than ellipses because that is the mark that
  reads as sward at 64×32.
- **Bare earth** stays but goes cool and rare: `dust.5` at `b > 0.90` rather than
  `terracotta.2` at `b > 0.78`. Some warm ground is what keeps a green map from
  reading as a billiard table; red laterite is not what a river basin's stock paths
  look like.
- **Tussocks** replace the dry bush: same `rnd > 0.84 && cover === 0` gate, `scrub.0`,
  drawn as three short strokes fanning from a point rather than one ellipse.

**Knolls keep `limestone.6` / `limestone.3` in both themes.** A knoll in the green
basin is a dry-stone terrace wall, and keeping it limestone ties the fields to the
buildings, which stay limestone by decision.

**Groves keep `drawOliveTree`, renamed `drawCanopy`**, taking its five leaf and trunk
tones and `crownRatio` from the bundle. Green passes `scrub.1` / `grass.4` / `grass.2`
and `crownRatio: 0.95` — a poplar is a tall narrow crown, an olive a wide squat one,
and one number gets both from the same code.

**The `arid` bundle must be byte-identical to today's hardcoded values.**
`drawTerrain` has no tests — CLAUDE.md says combat maths requires tests and rendering
does not — so the only proof that Beit Sahwan renders unchanged is that the values did
not move. Write them as a literal table and diff them against :1079–1091 during review.

### No new decor kinds

A new kind costs five coordinated edits — `DECOR` in `map.ts:53`, `TERRAIN_DECOR` in
`renderer.ts:122`, the divergence guard at `main.ts:319–331`, `TERRAIN_LEGEND`,
`TERRAIN_SYMBOLS` in `validate_data.mjs`, and the sync assertion in `map.test.ts` —
for a prop class. `road` / `grove` / `knoll` carry the basin fine once they are
theme-aware: track, poplar gallery, terrace wall. If the first rendered pass reads
monotonous, `field` and `reeds` are a clean follow-up issue; they are not needed to
prove the arc. The payoff is that the four-way guard at `main.ts:319–331` is untouched.

## The grass ramp

| key | hex | luma | role |
|---|---|---|---|
| `grass.0` | `#D9E294` | 218 | seed-head highlight — the lit blade tick |
| `grass.1` | `#C0CE7E` | 197 | sunlit sward, track verge |
| `grass.2` | `#A6BC66` | 177 | **`terrainOpen`** — the base wash |
| `grass.3` | `#8AB04E` | 161 | **`cover[0]`** — hedgerow; the shade blade tick |
| `grass.4` | `#6E9E33` | 140 | canopy mid-tone, shade under vegetation |

Intra-ramp steps are 39, 40, 39, 43 in RGB distance. The limestone ramp's own steps
are ~31, so this is appropriately coarser for five entries covering the span nine
limestone steps cover.

**Why the ramp stops at 140.** `scrub.0` (`#6B8A4A`, luma 127) and `scrub.1`
(`#3E5C2E`, 82) already occupy dark green — that is literally the ramp's declared
role, *"sparse vegetation, olive trees, palms"*. Extending grass into that band
produced candidates 8–25 away from `scrub.0`, which is a duplicate, not a step. So
vegetation is seven steps across two bands: `grass.0…grass.4` → `scrub.0` → `scrub.1`,
and the handoff is documented in the new ramp's `note`. Minimum separation is 31
(`grass.4` to `scrub.0`), against the `skin` ramp's own recorded precedent of 33.

**`terrainOpen` is `grass.2` and not `grass.1` because of luminance, not taste.**
`grass.2` sits within 5 of `limestone.3`'s 182. Every unit silhouette in the game was
tuned for figure-ground against 182; matching the luminance and changing only the hue
is the change that risks least.

```
terrainOpen     grass.2  #A6BC66                      (was limestone.3)
terrainCover    [grass.3, scrub.0, scrub.1]           (was [limestone.2, dust.1, dust.0])
terrainBlocked  limestone.4   UNCHANGED — buildings stay limestone
underBuilding   shadow.0      UNCHANGED
```

Cover *darkens* with level here where the arid set warms. That is deliberate: on
grass, denser cover is more vegetation and therefore darker, and the cover marks at
:1227–1237 have contrast against `terrainOpen` as their only legibility cue.

`total_colors` goes 53 → 58, asserted by `validate_data.mjs`. Adding a ramp changes
nothing for existing art: `validate_assets.py` gates on *"every opaque pixel is
exactly a palette entry"*, a subset test, so widening cannot invalidate a quantized
sprite. Give the new ramp a `role` string naming it procedural-terrain-only.

## The `raze` objective

**Meaning.** Complete when every structure that had at least one tile inside the named
zone at mission start is destroyed. One tile inside is enough. Full containment is the
tempting alternative and it is worse: a zone drawn to cover a compound would silently
exclude its edge buildings, and the author would have no way to see it.

**`sim.ts` is not touched.** `structureAt(x, y)` (:991) and `structures.alive` (:723)
are already public read API. The whole objective lives in `mission.ts`:

1. `'raze'` joins `SUPPORTED` (:220), or the constructor throws at :317.
2. A `razeTargets: Map<string, number[]>` field — objective id to structure indices.
3. In `start()`, alongside the existing zone gates: walk the zone rect, collect
   structure indices into a `Set`, **sort** them, store. Throw if the zone does not
   resolve. Throw if it contains no structures, with a message naming the failure —
   *"contains no structures, so it would complete on the first tick"*.
4. In `stepObjectives` (:1085), a branch beside `destroy_all`: complete when every
   snapshotted index has `alive === 0`.

**The snapshot is taken at `start()` and that is load-bearing.** `structureAt` returns
`-1` for a dead structure and `destroyStructure` clears `blocked` on its tiles, so a
per-tick rescan would find *fewer* structures each time one fell and would report "all
zero of them are destroyed" the instant the last one dropped. That happens to give the
right answer for the wrong reason — and it would silently complete at t=0 for an empty
zone, which the snapshot turns into a throw instead.

Indices are deduplicated through the `Set` and then **sorted** before storage. They
are already deterministic, assigned in `parseMap` order, but an insertion-ordered
array whose order depends on the zone scan is a latent determinism smell in a package
where that costs weeks. Sorting removes the question.

### Two authoring hazards, caught in the validator

`stepDemolition` (`sim.ts:2893–2917`) skips two classes when a demolisher works on its
own initiative rather than under an explicit order:

- **`lowProfile` types** (:2919) — the `wall`. And walls are `per_tile`, so a wall run
  inside a raze zone is N separate structures, each needing its own click.
- **types with `roe_penalty >= PROTECTED_ROE`** (:2914, threshold 20) — the `mosque`,
  at 30.

Neither is a sim bug, but either makes a raze zone containing it a mission that
demands forty clicks or feels quietly impossible. **`validate_data.mjs` gains a
cross-check**: for each `raze` objective, walk the zone rect against the map rows and
fail if any tile carries a symbol whose type is `per_tile` or whose `roe_penalty >=
20`. That block already loads `structures.json` and every map, and already does this
shape of check for markers and zones. It catches the problem at `pnpm validate:data`
rather than in playtest.

### Determinism — do not re-pin the hash

`determinism.test.ts` builds a raw `Sim` from two `UnitTypeJson` fixtures and never
constructs a `MissionRuntime`. The golden `4029834894` is a property of `Sim` alone.
`Sim.hash()` covers `stAlive`, `stHp`, `stOccupants`, `demolishOrder`, `demoTicks` and
`demoTarget`; `raze` **reads** `structures.alive` and writes nothing, and the
demolition that satisfies it runs through the existing `demolish` command, which is
already hashed.

So the acceptance criterion is that `pnpm test:determinism` passes with
`4029834894` **unchanged** on all three OSes. If it moves, something in the sim core
was changed by accident. That is a bug to investigate, not a constant to update.

## Canon and campaign wiring

**`docs/GDD.md`** — the §2 table row at :35 (`eastern river desert` → `eastern river
basin — irrigated green highland`) and the §2 layout bullet at :49–51, rewritten as a
green basin of terraced pasture and cultivation. The "smuggling corridor… last,
because cutting supply is only decisive once the fronts it feeds are contained"
framing stays, as does the closing rule that every region is defined by terrain and
doctrine, never by a people. §6's objective list gains `raze`.

**`data/campaign/world.json`** — `naharin.unlock.after_mission` goes from
`"umm_zeitoun_1"` to `"beit_sahwan_3_clearance"`, the blurb is updated, and the five
mission ids go into `wadi_halam.missions` in play order.

The dangling pointer passes today because the existing check only validates an unlock
naming a mission that *exists*. After the retarget it is genuinely checked, and
`beit_sahwan_3_clearance` lives in `marj` (region index 0) against `naharin` (index
2), so the earlier-region ordering constraint holds.

This means **Sur is no longer on Naharin's critical path.** The GDD's
proximity-then-standoff-then-source ordering was a recommendation about why the war
unfolds as it does, not a lock; both fronts now open when the Marj is done and the
player chooses. Sur stays empty.

**`packages/data/src/index.ts`** — five mission imports and one map import, plus
entries in `missions`, `maps`, and the `MapId` / `MissionId` types.

**Nothing validates this step at data-validation time**, and the failure mode is quiet
and specific: `main.ts:228` resolves an unregistered map with `?? maps.beit_sahwan_outskirts`,
so a mission whose map is missing from the `maps` object **silently loads the wrong
map** and every marker resolves to a Beit Sahwan coordinate. The only gates are the
TypeScript types and `playtest.ts`'s `keyof typeof missions` parameter — which is why
adding the playtest runs is part of the registration work, not an afterthought.

## The map — `data/maps/wadi_halam_basin.json`

48×48, matching the other two maps so pacing and camera stay familiar.
`"terrain": "green"`. West to east, because Naharin lies east of Kedem and the KDF
comes from the west.

| Band | x | Contents |
|---|---|---|
| West pasture | 0–6 | `kdf_crossing`, open grass, no cover. The player's own start line is exposed, which is the arc's thesis stated on the first screen |
| The wadi | 7–12 | The watercourse: a north–south belt of `o` poplar gallery (cover 1) with two `r` fords at y=15 and y=32. The only two vehicle crossings |
| Cultivation | 13–23 | Terraced fields: alternating `1` hedgerow bunds and `.`, with `n` dry-stone terrace walls (cover 2) on the field corners |
| The village | 25–33 | Wadi Halam: `h` houses, one `m` mosque, `s` shanties |
| Southern track | y=34 | An `r` road running x13→34 then north to the depot gate — the bypass around the village |
| The depot | 35–41 | Seven structures inside a `=` wall ring at x=34, x=42, y=16, y=31, gate gap at (34,24) |
| Rif hinterland | 42–47 | Open grass, the east track, the wave markers |

**Cover is belted, not scattered.** On open ground `COVER_HIT[0]` and `COVER_SIG[0]`
are both 1.0 (`tuning.ts:17,49`) — every shot lands at full accuracy both ways and
detection runs long, so Lanchester concentration dominates and the 3:1 urban advantage
is gone. Belts of cover give the player something to move *between*, which is what
makes mobility a decision rather than a stat. The Rif's counter is signature:
`moto_rpg` 0.55 and `militia_cell` / `rpg_team` 0.45 go in the poplar gallery and the
hedgerow bunds; the technicals live in the open where 2.6–3.4 tiles/s is worth
something.

### Markers

| marker | at | used by |
|---|---|---|
| `kdf_crossing` | [3,24] | player start reference |
| `ford_north` | [10,15] | I capture anchor |
| `ford_south` | [10,32] | I, II |
| `pump_house` | [17,20] | II wave `to` |
| `hide_north` | [22,9] | III staging, `withdraw_to` |
| `hide_south` | [22,38] | III staging, IV reserve |
| `village_center` | [29,24] | IV wave `to` |
| `depot_gate` | [34,24] | V wave `to`; the wall's gate gap |
| `rif_north` | [44,9] | wave `from` |
| `rif_east` | [44,24] | wave `from` |
| `rif_south` | [44,39] | wave `from` |
| `civ_refuge` | [22,36] | IV `civilians.refuge` |

Every marker in that table is used by at least one mission. An unused marker is not
an error, but it is a claim the map makes and nothing honours, and the next author
has to work out which.

### Zones

| zone | rect | used by |
|---|---|---|
| `ford_watch` | [7,12,6,24] | I `capture`, II `zone_entered` |
| `pasture` | [13,14,11,20] | II `hold_for`, III `capture` |
| `village` | [25,15,9,18] | IV `capture` |
| `mosque_block` | [28,22,4,4] | IV `roe.flagged_zones` |
| `depot` | [35,17,7,14] | **V `raze`** |
| `refuge` | [19,34,8,6] | IV `evacuate_before` |
| `east_road` | [42,22,6,4] | V `zone_entered` |

`civ_refuge` [22,36] sits inside `refuge` [19,34,8,6] — x19–26, y34–39. Required, or
`start()` throws.

### The seven depot structures

`raze`'s target set. Each is a contiguous run of one symbol; the gaps between runs are
what keep them separate structures rather than one flood-filled blob.

| type | symbol | footprint | tiles | hp | roe_penalty |
|---|---|---|---|---|---|
| warehouse | `w` | (36,18)–(38,19) | 6 | 2040 | 3 |
| warehouse | `w` | (36,21)–(38,22) | 6 | 2040 | 3 |
| concrete | `#` | (40,18)–(41,19) | 4 | 2800 | 3 |
| concrete | `#` | (40,21)–(41,22) | 4 | 2800 | 3 |
| shanty | `s` | (36,24)–(37,24) | 2 | 240 | 2 |
| shanty | `s` | (39,24)–(40,24) | 2 | 240 | 2 |
| warehouse | `w` | (37,27)–(39,28) | 6 | 2040 | 3 |

Total ROE cost of a clean, sanctioned demolition: **19 points.**

The `=` wall ring at x=34, x=42, y=16, y=31 sits **entirely outside** the `depot` rect
[35,17,7,14], which is what keeps the per-tile and `lowProfile` hazard out of the raze
set. The new validator check is what stops that staying true by accident.

### Placement clearance — walk the grid, do not eyeball it

`assertGroundClear` (`mission.ts:632–660`) spreads a placement's bodies `SPREAD`
= 1.25 tiles apart: body *k* lands at `x + (k % 3) × 1.25`, `y + ⌊k/3⌋ × 1.25`. A
`count: 3` therefore occupies its declared tile **plus roughly three tiles east**; a
`count: 6` adds a second row two tiles south. Its docstring records why: a civilian
group whose `at` was open street put its middle body inside a mosque, and *"it
survived a hand audit and a code review."*

Wave `from` markers are checked at `start()`, so a bad one throws at load rather than
at t=180s — but a load-time throw during playtest is still a wasted cycle.

**A new read-only tool, `tools/src/walk_placements.ts`**, built on `makeWorld` from
`walk_world.ts` — which loads mission JSON straight off disk by id and so works
*before* the mission is registered in `packages/data`. It:

1. prints the parsed 48×48 grid as characters — `#` blocked, `1`/`2`/`3` cover, `.` open;
2. overlays every `starting_force`, `enemy.garrison`, `civilians.groups`,
   `triggers[].do.units` and `enemy.waves[].units` placement, computing each body
   position with the same `(k % 3, ⌊k/3⌋) × 1.25` arithmetic and marking it `o` clear,
   `X` blocked, `!` off-map;
3. overlays markers as `+` and zone rects as a boxed outline;
4. exits non-zero on any `X` or `!`.

This answers "a clear `at` does not guarantee clear ground for a count-3 group" with a
picture rather than a promise, and it runs before registration, which is when the
answer is actually wanted.

## The five missions

Phases: `recon` → `foothold` → `buildup` → `clearance` → `clearance`. Two clearances
is correct rather than a compromise — the depot is a second clearance in fact as well
as in name. `subterranean` is unavailable because `tunnel_travel` exists in unit data
and not in the sim. `breach` is reserved for the campaign's opening shape.

All five: `target_minutes` 5–7, `enemy.faction: "rif"`, drawing `technical` /
`gun_truck` / `moto_rpg` plus `militia_cell` / `rpg_team` for anything dismounted. The
Rif roster is three vehicles and no infantry; borrowing is existing practice rather
than a bend, since `beit_sahwan_3_clearance` is `faction: ashwar` and garrisons
`technical`, `gun_truck` and `atgm_cell`.

### I — `wadi_halam_1_fords` · "The Fords" · recon · 6 min

The raid framing inverted: you are the one probing. The Rif disperse the moment they
are seen, so the mission is to *see* before pushing.

| id | type | primary | shape |
|---|---|---|---|
| `picture` | `locate` | yes | `count: 4` — four dispersal sites identified |
| `take_ford` | `capture` | yes | `ford_watch`, `seconds: 20` |
| `screen_out` | `survive_until` | no | 300s — the column's crossing window |

**Enemy:** two `moto_rpg` in `ambush(4)` in the poplar gallery, tagged
`wh_gallery_north` / `wh_gallery_south`; two `technical` on `patrol` waypoints along
the east bank, both in **group `bank`** and tagged `wh_bank_patrol`; one `militia_cell`
on the terrace walls at (18,20), tagged `wh_bund_cell`. One wave at 210s — 2 `moto_rpg`
from `rif_east` to `ford_north`. One trigger: `zone_entered(ford_watch)` → `commit`
group `bank` to `ford_north`.

That is five garrisoned units against `picture`'s `count: 4`. A `locate` with a bare
count completes when four **units** have been identified — not four tags — so the
garrison must hold at least four bodies that can be found before the wave arrives, or
the objective is unreachable. The count and the garrison are one decision, not two.

Ambush is the whole point. Hidden setup and 0.45–0.55 signature against a screen
crossing open water is exactly what makes recon quality matter — and the tags
identified here arrive pre-revealed in II and III through `intel.marked_positions`,
which marks a tag the moment any of its units is identified, so partial credit falls
out for free.

### II — `wadi_halam_2_laager` · "Grazing Ground" · foothold · 7 min

Hold the crossing site while technicals raid it. The static defender against the
mobile raider, on ground with no cover — the arc's mechanical thesis at its most naked.

| id | type | primary | shape |
|---|---|---|---|
| `hold_pasture` | `hold_for` | yes | `pasture`, `seconds: 180` accumulated |
| `keep_ford` | `capture` | no | `ford_watch`, `seconds: 15` |

**Enemy:** no garrison worth the name — one `gun_truck` at (44,20) `hold_position`,
tagged `wh_aa_east`. The pressure is four waves at 60s, 150s, 240s and 330s, from
`rif_north` / `rif_south` / `rif_east` to `pump_house` and `ford_south`. The trigger
that matters: `casualties_pct(60)` → `withdraw_to` `rif_east`. The raiders break off
rather than dying in place, which is what "engage and disengage" means.

`resources`: `logistics_start: 400`, `logistics_rate_per_min: 120` — GDD §3's Foothold
anchor. `supply_corridor` **absent**, see Risks.

### III — `wadi_halam_3_counterraid` · "The Cattle Track" · buildup · 6 min

Now you raid. Two hides, one commander, and a clock that is the enemy's reaction
rather than a timer.

| id | type | primary | shape |
|---|---|---|---|
| `kill_amir` | `eliminate_hvt` | yes | tag `wh_hvt_amir` |
| `hold_bunds` | `capture` | yes | `pasture`, `seconds: 20` |
| `mark_hides` | `locate` | no | `target: "wh_hide_south"` — that specific tag |

**Enemy:** the commander aboard a `technical` at `hide_north`, tagged `wh_hvt_amir`;
a `militia_cell` and an `rpg_team` dug in at `hide_south`, both tagged
`wh_hide_south`; two `moto_rpg` screening the bunds. A `locate` with a `target` needs
**every** unit carrying that tag identified, so `wh_hide_south` covering two bodies
makes it a two-contact objective rather than a one-glance one.

`eliminate_hvt` requires only that the tag exists at `start()` — the error text says
"garrisoned tag" but the check is tag existence, so the commander can be mounted
rather than building-bound. He rides a `technical` via the placement's `passengers`
array at `hide_north`, with a `casualties_pct(40)` → `withdraw_to` `rif_east` trigger.
The HVT runs, and catching him is a mobility problem. That is the mission.

The ledger effect is visible here: tags carried in `intel.marked_positions` from I
spawn pre-revealed and give up their ambush. A player who did I badly is hunting a
commander who, as far as they know, is not on the map.

### IV — `wadi_halam_4_village` · "Wadi Halam" · clearance · 7 min

The ROE peak. The village is inhabited, the mosque is protected, and heavy ordnance on
open ground reaches further than it does between walls.

| id | type | primary | shape |
|---|---|---|---|
| `take_village` | `capture` | yes | `village`, `seconds: 20` |
| `kill_cache_guard` | `eliminate_hvt` | yes | tag `wh_hvt_cache` |
| `evac_families` | `evacuate_before` | no | `refuge`, `count: 3`, `seconds: 300` |

**ROE:** `flagged_zones: ["mosque_block"]`, `fail_below: 40`,
`structure_penalty_mult: 1`.

`civilians.refuge` is `civ_refuge` at [22,36], twelve to fifteen tiles from the
village — a shepherding walk of roughly twenty seconds, leaving the last third of the
mission for the fight.

**Enemy:** three `militia_cell` and one `rpg_team` garrisoned in the houses via
`stance.garrison`, the cache guard among them tagged `wh_hvt_cache`; two `technical`
in reserve at `hide_south`, group `reserve`, committed on `first_contact` to
`village_center`.

### V — `wadi_halam_5_depot` · "Break the Depot" · clearance · 6 min

The D9 mission. Seven structures inside a walled compound, one unarmed bulldozer, and
a choice of route.

| id | type | primary | shape |
|---|---|---|---|
| `raze_depot` | `raze` | yes | `depot` — all seven structures down |
| `kill_gate_rpg` | `eliminate_hvt` | yes | tag `wh_gate_rpg` |
| `no_bleed` | `survive_until` | no | 300s |

`map.player_start: [13, 24]` — east of the wadi, because I–IV took the crossing.

**Enemy:** an `rpg_team` holding the gate gap at (34,24) in `ambush(3)`, tagged
`wh_gate_rpg`; a `gun_truck` inside the compound; two `moto_rpg` in group `harass`
standing off to the east. Two waves, at 90s and 200s, from `rif_east` and `rif_south`
to `depot_gate`. One trigger: `zone_entered(east_road)` → `commit` group `harass` to
`depot_gate`, so pushing east for the flanking approach is what brings the
motorcycles down on the blades.

**This is an escort mission, not a demolition mission, and the arithmetic says so.**
`demolition_time_s: 2` is 40 ticks, during which the blade drains `maxHp / 40` per tick
so the building visibly comes apart. The demolition itself is therefore **14 seconds
across all seven buildings**. Travel is the mission: 21 tiles to the gate at 0.6
tiles/s ≈ 35s clean, plus roughly 4 tiles between structures inside the compound ≈ 7s
each ≈ 45s of repositioning. A mechanical floor near 95 seconds, leaving four and a
half minutes of fight — the correct ratio for a six-minute mission.

**The D9 is unarmed.** `dozer_d9.json` has no `weapons` array at all. It cannot defend
itself, it is the slowest thing on the map, and `moto_rpg` carries 300 penetration
against its 240/170/110 armour. Escort is not flavour here.

**The route decision is the mission's actual design.** A demolisher with no explicit
order gets an automatic search: any non-protected, non-`lowProfile` structure within
two tiles is levelled after it holds station. A D9 routed straight east along y=24
passes through the village and will quietly eat houses it halts beside — 6 ROE each.
The mosque is safe, at 30 against the protected threshold of 20, which is exactly the
asymmetry that makes the mistake survivable and instructive rather than fatal. The `r`
road at y=34 is the southern bypass: longer, slower, free. The mission never says this.
The geometry does, the way the Marj breach's perimeter does.

**ROE arithmetic:** `structure_penalty_mult: 1`, `fail_below: 40`. The sanctioned
demolition costs 19. A clean run ends near 81; a run that shortcuts through the
village ends near 55. Both pass.

*Rejected — `structure_penalty_mult: 0`.* The schema documents it for missions where
the town is already rubble, and it would make the objective free. But it is
mission-global, so it would also make flattening the inhabited village free, and that
is the only ROE decision in the mission. Charging the player 19 points for doing what
they were told is slightly odd; making the village free is worse.

**The `dozer_d9` unlock, answered.** `unlock.roe_rating_min: 60` is enforced in
exactly one place — `buildBlockedReason` → `unlockReason`, called only from
`requestBuild` (:389). `start()` → `spawnPlacement` (:493) **never consults it.**

So: **one D9 in `starting_force`, replacements buildable.** A player below 60 gets
their one dozer and no second chance if it dies; a player above 60 can buy another for
586 logistics over 26s. That is the right pressure curve, and it makes the mission
always completable, which matters because `raze` is primary and victory needs every
primary complete.

Record honestly that this works by a **loophole, not a design**: `starting_force` is
unlock-blind, and nothing in the schema says so. Either `starting_force` should honour
unlocks — and then every mission needs an authored fallback — or the schema should
document that it does not. Separate issue; not fixed here.

## Ledger

`requires` is documentation — the runtime reads whatever the ledger holds regardless —
but it is the contract that lets a contributor author one mission without reading the
campaign, so it must be right.

| mission | requires | produces |
|---|---|---|
| I fords | `roster.surviving_units` | `roster.surviving_units`, `roe.mission_ratings`, `campaign.completed_missions`, `intel.marked_positions` |
| II laager | `roster.surviving_units`, `intel.marked_positions` | `roster.surviving_units`, `roe.mission_ratings`, `campaign.completed_missions` |
| III counterraid | `roster.surviving_units`, `intel.marked_positions` | as II, plus `intel.marked_positions` |
| IV village | `roster.surviving_units`, `intel.marked_positions` | as II, plus `civ.settlements_evacuated` |
| V depot | `roster.surviving_units`, `roe.mission_ratings` | as II |

Every key is one the runtime actually writes; unknown keys are silently ignored, so
declaring aspirational ones would be a lie in the save file. `intel.marked_positions`
unions across missions, so III's marks add to I's rather than replacing them.

`from_ledger: true` on the KDF armour placements in II through V. Degradation is by
construction: absent roster means a fresh start at full strength, sparse means fewer
units, gutted means one fresh remnant. **Mission I must run from an empty ledger** —
it is the entry point to the region.

## Testing

**New unit tests.** `mission.test.ts`, because this is runtime logic and CLAUDE.md
requires tests for it:

- `raze` completes when every structure in the zone is dead;
- it does not complete while one lives;
- a structure outside the zone does not block completion;
- a structure straddling the zone boundary **does** count;
- `start()` throws when the zone does not resolve;
- `start()` throws when the zone resolves but holds no structures, with the
  "would complete on the first tick" message;
- a structure destroyed by the *enemy* still counts — the objective asks whether the
  depot is down, not who dropped it.

`map.test.ts`: a map without `terrain` parses to `'arid'`; `terrain: "green"`
round-trips; `TERRAIN_LEGEND` is unchanged, asserted rather than assumed.

**Two real defects in the playtest harness, fixed as part of this work:**

1. **`unitInfo` (:40–44) omits `unlock`**, unlike `main.ts`. So `requestBuild` in a
   playtest ignores every ROE gate, and a plan that buys a D9 proves nothing about
   what the app would allow. One line, and a genuine divergence between the
   winnability proof and the game.
2. **`expect` cannot express "must not resolve"** — it is `'victory' | 'defeat'` and
   is compared directly against `rt.result`, so an unresolved run reports as a failure
   against either value. Widen it to include `'ongoing'`.

**Winnability.** Five chained `run()` calls in `tools/src/backtest/playtest.ts`,
threading each mission's produced ledger into the next exactly as the Beit Sahwan
chain does today. Run with `cd tools && npx tsx src/backtest/playtest.ts`.

**The control run: mission V with an empty plan, expecting `'ongoing'`.** A defeat
control of the kind First Light uses is wrong here — a passive force in these missions
neither wins nor is wiped, it runs out the 20-minute cap. But `ongoing` is a *better*
test than a defeat control would be: it is the direct, executable falsification of
`raze`'s worst failure mode. If `raze` ever completes on an empty target set, or the
`every()` predicate degenerates on an empty array, this run turns VICTORY and the
harness fails. It also proves the D9's automatic demolition search does not level the
depot unattended from the player's start line.

No control on I–IV. A control that could pass for the wrong reason is worse than none.

**`walk_mission` on all five** at 0/30/60/120/240/360 — the tool that catches
declarative gates whose target stopped existing, and whose header records three
content bugs it found in one sitting on Beit Sahwan II that every unit test passed.
Specifically here: that III's HVT is still alive when his `withdraw_to` fires, that
IV's civilians are within shepherding reach before the 300s deadline, and that V's
`wh_gate_rpg` has not been killed incidentally by a wave before the objective can
register it.

**`walk_placements` on all five**, before registration.

**Gates:** `pnpm lint`, `typecheck`, `test`, `validate:data`, `validate:assets`,
`validate:ui`, `validate:audio`, `python tools/validate_balance.py --units data/units`,
`pnpm balance`, `pnpm build`, and the three-OS `pnpm test:determinism` with
`4029834894` **unchanged** — an assertion of the design, not a step to perform.

**By driving the UI**, not console shortcuts: they skip the code that breaks and have
already cost two false "it works" claims on this project. `preview_start` is pinned to
the launch directory, so run it from this tree rather than a worktree.

### What cannot be automated

- **Whether the basin reads as green.** No gate renders a frame. The palette check
  proves the colours are legal, not that `#A6BC66` under an `olive.1` KDF hull has
  enough separation. This is the single largest unverifiable risk here.
- **Whether the blade-tick scatter reads as grass** rather than noise, at gameplay
  zoom.
- **Whether the arid maps are unchanged.** Byte-identical tone tables make it likely;
  only looking at Beit Sahwan makes it true.
- **Whether escorting a 0.6 tiles/s dozer for 95 seconds is tense or tedious.**
- **Whether open terrain is interesting or a shooting gallery.** `playtest.ts` proves
  winnable; nothing proves good.
- **Whether V's village-shortcut ROE beat is discoverable** or just a punishment
  nobody understands.

## Risks, recorded

**#21's supply-corridor acceptance line is not met, and this ships without it.**
`resources.supply_corridor` is inert: `mission.ts:571–573` accrues logistics by flat
rate with the comment *"interdiction (supply_corridor) is a later slice."* No mission
in this arc sets it and none creates the gameplay. GDD §3 makes corridor protection a
headline mechanic — *"protecting the corridor is the gameplay"* — and §2 currently
defines Naharin as the corridor itself, so this arc is the one place the gap is most
visible, and it is being shipped anyway. **Do not close #21 on this work.** Split the
corridor line into its own issue and say plainly in the PR that it is unmet.

**GDD §5.7's Raid (Rif) target is unimplemented, in the Rif's own arc.**
*"Technicals that engage and disengage against a slower force escape with ≥60%
survival; technicals that get caught die fast."* `tools/src/backtest/targets.ts`
exports only `atgmPk`, `apsIntercept`, `urbanRatio`, `lanchester` and `airContested`.
This design leans on that property — II's `casualties_pct` → `withdraw_to` triggers
assume it, and the whole "mobility is their armour" premise is unfalsified.
`pnpm balance` will stay green because it does not test this. Blocking for M2, not for
this PR, and said out loud rather than left implied.

**Palette widening against already-quantized sprites.** `validate_assets.py` gates on
subset membership, so no existing art breaks. The real risk is forward drift: five
saturated greens are now legal in unit and building diffuse art, and `grass.2` /
`grass.3` sit 43 and 36 from `olive.0` — close enough that a future contributor's
quantizer could pull a KDF hull highlight into the terrain ramp. Mitigation shipped: a
`role` string reading "procedural terrain only; not for sprite art." Mitigation *not*
shipped: nothing enforces it. A per-ramp `sprite_legal: false` flag checked by
`validate_assets.py` is the real fix, and a separate issue.

**Green ground under green units.** The KDF's hull and infantry colours are `olive.1`
and `olive.0` — the faction ramp is grey-green, and it is about to stand on grass.
Matching `terrainOpen`'s luminance preserves value contrast but not hue contrast, and
no gate catches a legibility failure. If it reads badly the cheapest fix is per-theme
hull colours, which makes unit palettes map-dependent — a real widening of the
renderer's contract, deliberately not decided here.

**`drawTerrain` has no tests and this rewrites its interior.** CLAUDE.md exempts
rendering from the test requirement, so the arid regression surface is covered only by
keeping the tone table byte-identical and by looking at Beit Sahwan. Accepted, with
the byte-identity requirement called out in review.

**`starting_force` ignores unit unlocks**, and mission V depends on that gap.
Recorded, not fixed.

**`raze` counts a structure with one tile in the zone.** The new validator check
catches the per-tile and protected cases; nothing catches an author drawing the rect
one tile short.

**`hold_for` accumulates rather than requiring continuous holding** — mission II's
primary. Already recorded in the Marj breach spec and inherited unchanged. Forgiving
in the direction II needs.

**Difficulty is a playtest question.** Wave counts, `hold_for` durations and the
depot's structure count will move during the playtest pass. This spec fixes the shape,
not the numerology.

## What this spec deliberately does not settle

Whether `field` and `reeds` become decor kinds; whether unit hull colours become
theme-dependent; whether `starting_force` should honour unlocks; whether the corridor
mechanic lands in Naharin or elsewhere; and the actual wave numerology in II and IV.
