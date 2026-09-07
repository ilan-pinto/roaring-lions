# Khan Rafid and Deir Amun — Level Script

**Date:** 2026-09-08 · **Status:** ECA rows, AI director, twist classification,
copy-ready fragments, capability gap report and doctrine-test assertion tables
for `mission-author` and `sim-guard`. **Nothing in this pass was applied to any
file** — no schema edit, no `world.json` edit, no `data/campaign/commander.json`
edit, no `data/maps/` file, no `data/missions/` file. This document is the
bridge from `design.md` + `narrative.md` (Option A adopted) to
`data/maps/khan_rafid.json`, `data/maps/deir_amun.json`, and the six
`data/missions/{khan_rafid,deir_amun}_*.json` files; `mission-author` owns the
actual files and must run `pnpm validate:data`, `walk_placements.ts` and
`walk_mission.ts` on the assembled JSON before any of it ships (§11).

**Read against:** `docs/campaign/README.md` (the contract — a trigger's `id` is
shown to the player verbatim as `enemy reacts (<id>)`); `data/schemas/
mission.schema.json` and `data/schemas/map.schema.json`, both grepped this
session; `packages/sim/src/mission.ts` and the cited lines of
`packages/sim/src/sim.ts` (§0.3, §10); `docs/campaign/khan_rafid/design.md`
(Option A "What You Keep", §0 decisions and D-KR1, §3 both map drafts, §4
ladder, §5 per mission — enemy stance, waves, triggers, twists, passive-loss —
§7 changes/gaps C1–C10/G1–G9, §8 open decisions); `docs/campaign/khan_rafid/
narrative.md` (every `dispatch`/`briefing`/`say`/`say_on_fail`/`debrief`/
`aftermath` string, the seventeen proposed trigger ids in §12, the twist table
in §11, the gap list §13 G-A…G-L, §14.2's Beit Sahwan IV `aftermath` request);
`data/missions/beit_sahwan_4_subterranean.json` (the one shipped subterranean
mission — `in_tunnel`, `digs`, the tunnel-primary `collapse` shape, the
`evacuate_before` + `capture` pairing) and `data/missions/
wadi_halam_3_counterraid.json` (a `withdraw_to` trigger, `structures[]`, a
`passengers[]` HVT, `enemy.waves[].say`) for shape; `docs/campaign/qarn_hadid/
script.md` for this document's own conventions.

**Both maps are new** (`design.md` §3, `narrative.md`'s own opening line: "The
six mission JSONs do not exist; neither map exists"). §1 below is what
`mission-author` builds `data/maps/khan_rafid.json` and `data/maps/
deir_amun.json` from: the full 48×48 grids, verified this session by parsing
them through the real `parseMap`, and every route/sight/tunnel-visibility
assertion in §9 driven through the real `FlowField` and `Sim` rather than
carried as design's draft BFS numbers. Three real map findings came out of that
walk and are flagged where they belong (§0, §9, §10): none blocks either arc,
one (**DA-M1**) should be fixed before the map ships.

---

## 0. What this document adds on top of `design.md` / `narrative.md`

Both upstream documents are unusually complete. What neither one does, and what
a mission file needs before `mission-author` can run `ajv` against it, is:

1. **The `on`/`do` shapes as the schema actually spells them** — `enemy.
   garrison` (not `enemy.garrisons` — the campaign brief that opened this task
   uses the plural; the schema does not, `mission.schema.json` §"enemy"),
   `enemy.waves[].at_seconds`, `triggers[].on.zone`/`do.to`/`do.group`, and the
   six `do.kind`s (`commit withdraw_to spawn reinforce dismount remove`,
   `mission.ts:1398-1451`).
2. **`spawn` never reads `do.to`.** `stepTriggers`'s `spawn` branch is exactly
   `for (const p of t.do.units ?? []) this.spawnPlacement(p, 1)`
   (`mission.ts:1421-1422`) — no attack-move is queued. `design.md`'s "spawn 1
   `charge_squad` at `souk_alley`, **committed at the ward**" (KR II, DA II, DA
   III) is achieved by the unit's own behaviour, not by an authored `to`:
   `charge_squad` is `isKamikaze`, and `stepKamikaze` (`sim.ts:4162-4200`)
   independently steers every living kamikaze unit onto the nearest
   **identified** hostile every tick, with no order to issue and none to
   refuse. So every `spawn` fragment below omits `to`, and the ECA rows say
   "homes on its own (kamikaze)" rather than implying a scripted move.
3. **`locate` with a shared `target` tag, not a bare `count`.** The shipped
   convention for "identify N *generic* positions" (`beit_sahwan_1_recon`'s
   `picture`, `wadi_halam_1_fords`'s `picture`) is `count: N` with **no**
   `target` — it reads `this.identified.size >= count` (`mission.ts:1547-1550`)
   against every identified enemy on the map. That is **not** this arc's
   shape: `design.md` puts the *same* tag string on three separate placements
   (`kr_watch` on both Old Town posts and the Main Street ATGM; `da_diggers` on
   the digger and both of his cover) specifically so the tag can be reused for
   the pre-mark carry-over (§0.5) — which only fires per `p.tag`
   (`mission.ts:1138`, `spawnPlacement`'s `preMarked`). So `find_the_watch` and
   `find_the_crew` are authored as `target: "kr_watch"` / `target:
   "da_diggers"` with **no** `count` field, taking the `if (d.target)` branch
   (`mission.ts:1544-1546`): complete only when every id carrying that tag is
   identified. `count` is present on the schema and would be silently ignored
   here — omitted rather than authored-and-dead.
4. **The pre-mark carry-over is universal across every reused tag, not only
   the ones `design.md` calls out.** `spawnPlacement`'s `preMarked` check
   (`mission.ts:1137-1149`) applies to **any** placement whose `tag` is already
   in `intel.marked_positions`, regardless of stance — it marks the body
   `identified` at spawn and, only for an `ambush` stance, also skips
   `setAmbush`. `design.md`/`narrative.md` call this out for `kr_lane_west`,
   `kr_lane_east`, `kr_watch` and `da_watch_gap` because those are `ambush`
   placements where it changes combat behaviour. It is **also true, quietly
   and correctly, of `kr_hvt_ward` and `da_hvt_engineer`** — both tags are
   reused verbatim across all three missions of their town, so a
   `find_the_block_commander`/`find_the_chief` secondary won by mission N
   silently pre-identifies the same-tagged HVT placement in mission N+1 (no
   ambush to forfeit, since both are `hold_position`/`garrison`). Nothing needs
   authoring for this — it falls out of reusing the tag string, exactly as the
   arc's other four reused tags do — but `mission-author` should know it is
   there rather than discover it as a surprise in `playtest`.
5. **Three map findings from walking both grids through the real engine**
   (method in §9; full readouts there):
   - **KR-M1 — the ward's east and west "gates" are sight slits, not walk-through
     gates.** `FlowField` shows `[19,20]` and `[29,20]` are each reachable **only
     from the compound's own interior** (their sole open neighbour is diagonal,
     and both flanking orthogonal tiles are blocked — a corner-cut `FlowField`
     will not take). Only the north gate `[24,17]` and south gate `[24,23]`
     connect Main Street/the souk to the ward, sharing one N–S corridor at
     `x=24`. This does not touch KR-A1/A2 (both test that corridor) or any
     objective's completability — `civ_refuge` and every cited route use the
     N–S axis — but `narrative.md` §2.2 beat 1's "four gates" is fiction for two
     of them; the wall is still `low_profile` and does not block *sight* at
     either notch, which is the fact `narrative.md`'s beat actually needs.
     Recorded, not corrected here — reopening one more tile beside either notch
     (e.g. `[29,21]` or `[28,20]`→`[30,20]`) is a map-authoring call, not a
     coordinate typo.
   - **DA-M1 — the rock line's map edges are a third and fourth gap, and one of
     them is live.** `design.md` §3.2 draws three spines (`x3–14, x22–30,
     x39–45`, `y8–10`) and states "two gaps" (`x15–21`, `x31–38`). The spines
     stop three tiles short of each map edge, so `x0–2` and `x46–47` are open
     at `y8–10` too — confirmed by filling **only** the two named gaps and
     re-running `FlowField`: the foot field still finds a route from `da_start`
     to `north_road` (59 tiles, crossing at `[2,10]`), where filling the
     **whole** row returns no route at all. Substantively DA-A4 still holds (a
     route through the named gaps exists, and the drone uses it in the cheap
     case), but the *exclusivity* `map-variants-design.md`'s rule was written
     for does not — a player who notices `x0–2`/`x46–47` can walk or fly the
     drone around `da_watch_gap`'s `ambush(4)` entirely, for both DA I and DA
     II. **Fix before the map ships**: extend both flanking spines to the map
     edge, `^` at `x0–2, y8–10` and `x46–47, y8–10` (15 + 9 = 48 tiles between
     the two spans; the two named gaps are unaffected, and no marker sits in
     `y8–10` at either edge — `da_west_edge [1,19]` and `da_east_edge [46,19]`
     are both well south of it).
   - **DA-M2 — `pump_yard`'s open-tile count, corrected.** `design.md` §3.2's
     own DA-A7 prose reads "Counted on the final grid: `pump_yard` **16**". A
     direct count against the grid in §1.2 below returns **14** (row-by-row:
     `y23`→7 open, `y24`→1, `y25`→1, `y26`→1, `y27`→2, `y28`→2). Still clears
     KR-A7's own floor (≥12 tiles passable to both domains, reused by DA-A7),
     so no objective is at risk — but the grid, not the prose, is what ships,
     and 14 is what `mission-author` should expect `pnpm validate:data`'s G9
     check (§10) to report.
6. **One structural note, not a defect: `hamlet`'s "one-tile lane at `x=25`"
   is a lane in three of its eight rows.** The two house footprints at
   `[22-24,21-22]` and `[25-27,23-25]` share a contiguous `h` run at `y=23`
   (`x22-27`), which the 4-connected flood fill (`packages/data/src/
   map.ts:343-380`) merges into **one 18-tile structure** rather than the two
   separate houses `design.md`'s prose implies — so the lane at `x=25` is open
   at `y=20-22` and `y=26-27` but blocked by that merged house at `y=23-25`.
   `da_tn_yard`'s mouth at `[25,26]` sits south of the interruption and is
   unaffected (confirmed open, §9 DA-A1). Recorded for `mission-author`;
   splitting the houses is a one-tile grid edit (open `[25,23]` or `[25,24]`)
   if the lane is wanted clean top to bottom.

---

## 1. Map specifications

Both `terrain: "arid"`. Grids and every marker/zone/tunnel below were parsed
through the real `parseMap` this session (`@lions/data`): both validate with
zero errors, Khan Rafid resolves **97** structures (40 non-wall + 57 `wall`,
one tile each — matching `design.md`'s own count exactly), Deir Amun resolves
**47** (13 non-wall + 34 `wall`) and **6** tunnels.

### 1.1 `khan_rafid` — 48×48, no `elevation` key, no `tunnels` block

```
................................................
.................======...ooooooo...............
...22222.........=wwww=...ooooooo.......22222...
...22222.........=wwww=...ooooooo.......22222...
...22222.........=wwww=.................22222...
......rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr......
.............r...................r..............
.2222.hhhhsssrhhhss.sshh.hhss.hhhraaahh...22222.
.2222.hhhhsssrhhhss.sshh.hhss.hhhraaahh...22222.
.2222.hhhhsssrhhhss.sshh.hhss.hhhraaahh...22222.
......hhhhsssrhhhss.sshh.hhss.hhhraaahh.........
.............r...................r..............
......sssshhhrssshh.hhss.sshh.sssrhhhaa..11111..
......sssshhhrssshh.hhss.sshh.sssrhhhaa..11111..
......sssshhhrssshh.hhss.sshh.sssrhhhaa..11111..
......sssshhhrssshh.hhss.sshh.sssrhhhaa.........
.............r...................r..............
.22222.......rhhhss=====.=====...rhhss....22222.
.22222.......rhhhss=.kkk..mmm=...rhhss....22222.
.22222.......rhhhss=.kkk..mmm=...rhhss....22222.
.22222.......rhhhss..kkk..mmm....rhhss....22222.
.22222.......rhhhss=.kkk.....=...rhh......22222.
.............rhhh..=.........=111r1ss...........
.............r.....=====.=====111r1ss...........
.............r11111...........111r111...........
..rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr..
.........r.....222222.................r.........
.........r.....222222.................r.........
.........r.........###................r.........
.........rhhh......###................r.........
.........rhhh..aaaa###.....aaaa.......r..www....
.........rhhh..aaaa........aaaa.......r..www....
.........r.....aaaa........aaaa.......r..www....
...======r.....aaaa........aaaa....111r11.......
...=wwww=r..............2222.......111r11.......
...=wwww.r..............2222..........r..sss....
...=wwww=r....11111..hhh.ss.....hhh...r..sss....
...======r....11111..hhh.ss.....hhh...r..sss....
.........r....11111..hhh.ss.....hhh...r.........
.........r............................r.........
.........r....ooooooo.......ooooooo...r.........
.........r....ooooooo.......ooooooo...r.........
.........r....ooooooo.......ooooooo...r.........
....22222r............................r.22222...
....22222r............................r.22222...
....22222r............................r.22222...
.........r......1111111111111111......r.........
.........r............................r.........
```

**Markers** (all confirmed on open, unblocked tiles this session):

```json
{
  "kr_start": [24, 45], "main_street": [24, 25], "kr_west_edge": [2, 25],
  "kr_east_edge": [45, 25], "market_square": [32, 23], "civ_refuge": [24, 22],
  "ward_gate": [24, 24], "ward_north_gate": [24, 17], "souk_alley": [24, 11],
  "west_lane": [13, 24], "east_lane": [33, 24], "north_road": [24, 5],
  "store_gate": [19, 5]
}
```

**Zones** (open-tile counts confirmed by direct count against the grid above,
§9 KR-A7):

```json
{
  "staging": [14, 42, 21, 6], "new_quarter": [8, 28, 32, 12],
  "market": [30, 22, 7, 5], "ward": [20, 17, 9, 7],
  "old_town": [6, 6, 33, 10], "souk": [19, 6, 11, 10], "store": [16, 1, 8, 5]
}
```

| zone | open tiles | non-open (structure) tiles |
|---|---|---|
| `staging` | 126 | 0 |
| `new_quarter` | 306 | `#`9 `h`27 `a`32 `=`4 `s`6 |
| `market` | 31 | `s`4 |
| `ward` | 26 | `=`16 `k`12 `m`9 |
| `old_town` | 106 | `h`112 `s`92 `a`20 |
| `souk` | 46 | `s`32 `h`32 |
| `store` | 16 | `=`12 `w`12 |

### 1.2 `deir_amun` — 48×48, `elevation` 0–5, six `tunnels`

```
................................................
......nnnnnnn.......sss...........nnnnnnnnn.....
......nnnnnnn.......sss...........nnnnnnnnn.....
......nnnnnnn.....................nnnnnnnnn.....
....rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr...
................................................
..22222....................................2222.
..22222....................................2222.
...^^^^^^^^^^^^.......^^^^^^^^^........^^^^^^^..
...^^^^^^^^^^^^.......^^^^^^^^^........^^^^^^^..
...^^^^^^^^^^^^.......^^^^^^^^^........^^^^^^^..
...............2222222.........22222222.........
...............2222222.........22222222.........
...................................======r......
...............11111...............=wwww=r......
.......ssbbb...11111...............=wwww=r......
.......ssbbb..........nnnnnnnnnnnnn=wwww=r......
.........bbb..........nnnnnnnnnnnnn==.===r......
......111bbb..........nnnnnnnnnnnnn......r11111.
......111bbb......rrrrrrrrrrrrrrrrrrrrrrrr11111.
.........bbb......hhh.....ssr.hhh........r11111.
.........bbb......hhh.hhh.ssr.hhh.s......r......
.........bbb......hhh.hhh...r.....s......r......
.........bbb..........hhhhhhr............r......
.........bbb======.......hhhr.www........r......
.........bbb=###.=ss..##.hhhr.www..hhh...r......
.........bbb=###.=ss..##....r.www..hhh...r......
.........bbb=###.=..........r............r......
.........bbb===.==..........r............r......
222222222bbb2222222222222222r222222222222r222222
bbbbbbbbbbbbbb...bbbbbbbbbb.r.bbbbbbbbbb.r.bbbbb
bbbbbbbbbbbbbb...bbbbbbbbbb.r.bbbbbbbbbb.r.bbbbb
bbbbbbbbbbbbbb...bbbbbbbbbb.r.bbbbbbbbbb.r.bbbbb
2222222222222222222222222222r222222222222r222222
............................r............r......
...222222.........ooooooooo.r............r.2222.
...222222.........ooooooooo.r...ooooooo..r.2222.
...222222.........ooooooooo.r...ooooooo..r.2222.
..................ooooooooo.r...ooooooo..r.2222.
............................r............r......
............11111...........r....111111..r......
............11111...........r....111111..r......
............11111...........r....111111..r......
............................r............r......
............................r............r......
....................11111111r11..........r......
....................11111111r11..........r......
............................r............r......
```

**DA-M1: before this ships**, apply the fix in §0 item 5 — `^` at `x0–2` and
`x46–47`, `y8–10` — so the rows above read (only rows 8–10 change, and they are
identical to each other):

```
^^^^^^^^^^^^^^^.......^^^^^^^^^........^^^^^^^^^
```

**Elevation** (0–5; unchanged by the DA-M1 fix, which only touches `rows`):

```
444444444444444444444444444444444444444444444444
444444555555544444444444444444444455555555544444
444444555555544444444444444444444455555555544444
444444555555544444444444444444444455555555544444
444444444444444444444444444444444444444444444444
444444444444444444444444444444444444444444444444
444444444444444444444444444444444444444444444444
444444444444444444444444444444444444444444444444
444444444444444444444444444444444444444444444444
444444444444444444444444444444444444444444444444
444444444444444444444444444444444444444444444444
333333333333333333333333333333333333333333333333
333333333333333333333333333333333333333333333333
333333333333333333333333333333333333333333333333
333334444333333333333333333333333333333333333333
333334442000233333333333333333333333333333333333
333334442000233333333344444444444443333333333333
333334442000233333333344444444444443333333333333
333334442000233333333344444444444443333333333333
333334442000233333333333333333333333333333333333
333334442000233333333333333333333333333333333333
333333332000233333333333333333333333333333333333
333333332000233333333333333333333333333333333333
333333332000233333333333333333333333333333333333
333333332000233333333333333333333333333333333333
333333332000233333333333333333333333333333333333
333333332000233333333333333333333333333333333333
333333332000233333333333333333333333333333333333
333333332000233333333333333333333333333333333333
222222222000222222222222222222222222222222222222
000000000000000000000000000000000000000000000000
000000000000000000000000000000000000000000000000
000000000000000000000000000000000000000000000000
222222222222222222222222222222222222222222222222
222222222222222222222222222222222222222222222222
222222222222222222111111111222222222222222222222
222222222222222222111111111222221111111222222222
222222222222222222111111111222221111111222222222
111111111111111111111111111111111111111111111111
111111111111111111111111111111111111111111111111
111111111111111111111111111111111111111111111111
111111111111111111111111111111111111111111111111
111111111111111111111111111111111111111111111111
111111111111111111111111111111111111111111111111
111111111111111111111111111111111111111111111111
111111111111111111111111111111111111111111111111
111111111111111111111111111111111111111111111111
111111111111111111111111111111111111111111111111
```

**Markers:**

```json
{
  "da_start": [24, 44], "ford_west": [15, 31], "ford_centre": [28, 31],
  "ford_east": [41, 31], "wadi_bend": [20, 31], "tributary_lip": [12, 22],
  "pump_gate": [15, 28], "pump_yard_floor": [16, 26], "hamlet_lane": [28, 23],
  "hamlet_north": [28, 19], "spoil_field_centre": [28, 17],
  "store_gate": [37, 17], "store_road": [41, 15], "da_west_head": [7, 17],
  "gap_west": [18, 9], "gap_east": [34, 9], "north_road": [24, 4],
  "plateau_west": [9, 2], "plateau_east": [38, 2], "da_west_edge": [1, 19],
  "da_east_edge": [46, 19]
}
```

**Zones:**

```json
{
  "staging": [18, 40, 14, 8], "the_wadi": [0, 29, 48, 5],
  "pump_yard": [12, 23, 7, 6], "hamlet": [18, 20, 17, 8],
  "spoil_field": [22, 16, 13, 3], "store_yard": [35, 12, 7, 7],
  "da_west": [5, 14, 9, 7], "north_slope": [3, 8, 43, 5]
}
```

| zone | open tiles | non-open (structure) tiles |
|---|---|---|
| `staging` | 112 | 0 |
| `the_wadi` | 240 | 0 (`b` counts open — foot-passable) |
| `pump_yard` | **14** (DA-M2; design's own prose said 16) | `=`17 `#`9 `s`2 |
| `hamlet` | 80 | `h`33 `s`10 `w`9 `#`4 |
| `spoil_field` | 39 | 0 |
| `store_yard` | 20 | `=`17 `w`12 |
| `da_west` | 59 | `s`4 |
| `north_slope` | 131 | `^`84 |

**Tunnels** (`mouth`/`waypoints`/`vent` all confirmed open ground; mouth-in-zone
confirmed for every route — see §9 DA-A5):

```json
[
  { "id": "da_tn_west", "mouth": [9, 17], "waypoints": [[10, 22]], "vent": [10, 28], "dig_tiles_per_s": 0.16 },
  { "id": "da_tn_pump", "mouth": [16, 26], "waypoints": [[18, 28]], "vent": [20, 30], "dig_tiles_per_s": 0.16 },
  { "id": "da_tn_lane", "mouth": [20, 23], "waypoints": [[23, 20]], "vent": [27, 18], "pre_dug": true },
  { "id": "da_tn_yard", "mouth": [25, 26], "waypoints": [[29, 24]], "vent": [33, 21], "pre_dug": true },
  { "id": "da_tn_north", "mouth": [30, 22], "waypoints": [[32, 17]], "vent": [34, 13], "pre_dug": true },
  { "id": "da_tn_east", "mouth": [33, 25], "waypoints": [[37, 23]], "vent": [41, 19], "pre_dug": true }
]
```

---

## 2. `khan_rafid_1_recon` — Khan Rafid I — House Numbers

`recon` · Captain · `khan_rafid` · `target_minutes` 6 · no economy · requires
`roster.surviving_units` · produces `roster.surviving_units,
roe.mission_ratings, campaign.completed_missions, intel.marked_positions,
civ.settlements_evacuated`.

### 2.1 Flags

| flag | kind | fiction |
|---|---|---|
| `find_the_watch` | primary, `locate(target: kr_watch)` — 3 placements share the tag | the three posts covering the ward crossing |
| `get_two_in` | primary, `evacuate_before(ward, count 2, 240s)` — **the one objective on this mission that can fail** | two of four families off the alleys before the clock runs out |
| `find_the_west_lane` | secondary, `locate(kr_lane_west)` | the rocket team in the west lane — carries into KR II/III as an `ambush` |
| `find_the_east_lane` | secondary, `locate(kr_lane_east)` | the mirror in the east lane |
| `find_the_block_commander` | secondary, `locate(kr_hvt_ward)` | the man giving orders in this block, who receives none |
| `screen_out` | secondary, `survive_until(300)` — **cannot fail**, no `say_on_fail` | shared recon shape |
| `the_compound_was_never_empty` (trigger) | `zone_entered(ward)` → `spawn` 1 `militia_cell` at `ward_north_gate` | the compound was never a still photograph |
| `he_gives_up_the_crossing` (trigger) | `casualties_pct(35)` → `withdraw_to souk_alley`, group `ward_party` | the forward party gives up the crossing |
| `they_move_the_families_off` (trigger) | `timer_s(250)` → `remove`, group `families` | T-KR3: the two un-reached groups are taken, not fought over |

### 2.2 ECA rows

| Event Name | IF (`on`) | THEN (`do` / objective / wave) | narrative cue bound | status |
|---|---|---|---|---|
| Mission start | — | `dispatch` shown, title card, `briefing` 6 beats | `narrative.md` §1.2/§1.3, verbatim | live |
| Three posts found | `objectives[].type:"locate"`, `target:"kr_watch"` completes | toast `OBJECTIVE COMPLETE — Identify the three posts covering the ward crossing` + `say` | idit: "Three posts, and not one of them can put a round inside the ward. Every one of them can put a round on anybody crossing to it. That is not an accident of ground; it was laid that way." | live |
| West lane found | `locate(kr_lane_west)` completes | toast + `say` | idit: "Rocket team in the west lane, in a road one tile wide with houses on both sides. He is on the board now and he does not get a first shot next week." | live |
| East lane found | `locate(kr_lane_east)` completes | toast + `say` | idit: "The east lane is the mirror of it. Two lanes, two teams, and the only third way north runs through the compound we are not allowed to fight in." | live |
| Block commander found | `locate(kr_hvt_ward)` completes | toast + `say` | idit: "That is the man giving the orders in this block, and he has not been given one himself since the shaft head. He is holding a town to a plan nobody is still writing." | live |
| Two families in | `evacuate_before(ward, 2, 240s)` completes | toast + `say` | shai: "Two inside the wall. Whatever is still in that alley is not worth a second run across the street." | live |
| Clock runs out | `evacuate_before(ward, 2, 240s)` fails @240s | toast `OBJECTIVE FAILED —…` + `say_on_fail` — **the only way to lose this mission** | shai: "Four minutes, and nothing of ours got within four tiles of them. They are somebody else's problem now, and there is nobody left in this town whose problem that is." | live |
| Five minutes screened | `survive_until(300)` completes | toast | shipped shape, no `say` | live |
| Wave 1 | `at_seconds:150`, `from:"north_road"`, `to:"souk_alley"`, 2 `militia_cell` | toast + `say` | idit: "Two sections down the north road into the souk alleys. Nobody called for them — that is a standing order arriving on time, from before anybody was on this road to call it off." | live |
| Wave 2 | `at_seconds:260`, `from:"kr_east_edge"`, `to:"main_street"`, 1 `technical` | toast only, no `say` | — | live |
| The compound was never empty | `on:{kind:"zone_entered",zone:"ward"}` | `do:{kind:"spawn",units:[{unit:"militia_cell",count:1,marker:"ward_north_gate"}]}` + `say` | idit: "There is a section coming in through the north gate. The compound was never empty — he has been walking men through it since before we crossed the perimeter." | live |
| He gives up the crossing | `on:{kind:"casualties_pct",value:35}` | `do:{kind:"withdraw_to",group:"ward_party",to:"souk_alley"}` + `say` | net: "The party forward of the ward is falling back into the souk. The crossing is open." | live |
| They move the families off | `on:{kind:"timer_s",value:250}` | `do:{kind:"remove",group:"families"}` + `say` | idit: "The alley is empty. Nobody fought over them; they were walked off it while the drone was over the souk." | live |
| A civilian reaches `civ_refuge` | `evacuated` MissionEvent | **nothing** — `describeMissionEvent` has no `evacuated` case | `narrative.md` §13 **G-B** | engine |
| Drone destroyed | `SimEvent destroyed` on `recon_drone` | no `on.kind` watches a `SimEvent` | idit's line exists in prose only (§13 **G-A**) | engine |
| ATGM fires down Main Street | `SimEvent fire` from the `kr_watch` ATGM | same gap | shai's line exists in prose only | engine |
| Mission ends | victory / defeat | `debrief` | shai (victory) / idit (defeat), §2.6 | live |

**Row count: 14 live, 0 schema, 3 engine.**

### 2.3 AI director

**Placements** (all coordinates confirmed open this session against the grid
in §1.1; none is blocked):

| tag / group | unit | count | at | stance |
|---|---|---|---|---|
| `kr_watch` | `militia_cell` | 1 | `[19,11]` | `hold_position` |
| `kr_watch` | `militia_cell` | 1 | `[29,11]` | `hold_position` |
| `kr_lane_west` | `rpg_team` | 1 | `[13,20]` | `ambush(3)` |
| `kr_watch` | `atgm_cell` | 1 | `[43,25]` | `hold_position` |
| `kr_hvt_ward`, group `ward_party` | `militia_cell` | 1 | `[31,16]` | `hold_position` |
| `kr_lane_east` | `rpg_team` | 1 | `[33,20]` | `ambush(3)` |
| — | `militia_cell` | 1 | `[24,24]` | `patrol`, waypoints `[[24,24],[24,17]]` |
| — | `mortar_crew` | 1 | `[24,3]` | `hold_position` |

**Cadence table:**

| t (s) | mechanism | size | from | to | group |
|---|---|---|---|---|---|
| 0 | garrison ×6 + patrol ×1 | 1 each | (see above) | — | — |
| 0 | civilians | 2+2 | `[20,16]`, `[27,16]` | — | `families` |
| 150 | wave | 2 `militia_cell` | `north_road` | `souk_alley` | — |
| ≤240 (deadline) | objective clock | — | — | — | `get_two_in` |
| any tick, `zone_entered(ward)` | trigger `spawn` | 1 `militia_cell` | — | `ward_north_gate` | — |
| any tick, 35% enemy casualties | trigger `withdraw_to` | group `ward_party` (1) | `[31,16]` | `souk_alley` | `ward_party` |
| 250 | trigger `remove` | up to 4 (living, unfound) | `families` | (removed) | — |
| 260 | wave | 1 `technical` | `kr_east_edge` | `main_street` | — |
| 300 | objective clock | — | — | — | `screen_out` |

**Pressure curve.** Nothing moves without an order except the ATGM's own fire
discipline and the two patrol legs of the militia section walking `[24,24]
↔ [24,17]` — the compound is not a still photograph from tick zero. The
mission is a resource-and-reach puzzle exactly as `design.md` frames it: one
drone sortie up the centre buys both Old Town alley posts in a single pass
(`design.md` §3.1's own alley-sight fact, "an alley one tile wide sees along
its own axis and nothing else"), the third post is the ATGM nineteen tiles
east on a straight, coverless road, and the two civilian bodies that can
actually reach a family inside 240s are the same two carriers a cautious
player would rather keep behind the drone. `he_gives_up_the_crossing` and
`they_move_the_families_off` both land inside the same 250-second window as
the evacuation deadline, so a plan that just misses the rescue also loses the
fiction of it seconds later.

### 2.4 Map requirements

All markers/zones are **NEW** — see §1.1 for the full set and the confirmation
that every one resolves on open ground. This mission uses: `kr_start`,
`civ_refuge`, `ward` (zone), `souk_alley`, `north_road`, `kr_east_edge`,
`main_street`, `ward_north_gate`. No coordinate here needs a marker beyond
those already listed.

### 2.5 Twists

| id | twist | classification | ECA row |
|---|---|---|---|
| T-KR1 | The patrol walks through the ward on a loop | **expressible today** — one `patrol` stance; folded into the `zone_entered(ward)` `say` | "The compound was never empty" |
| T-KR2 | The ATGM covers ten tiles of a 44-tile straight, coverless road every route crosses | **expressible today** — a placement + an `objectives[].say` | "Three posts found" |
| T-KR3 | The un-reached families are walked off, not fought over | **expressible today** — `do.kind:"remove"`, shipped and used by `umm_zeitoun_1_recon` | "They move the families off" |

**All three of KR I's twists are expressible today.**

### 2.6 `debrief`

> **victory** · shai — *"Two into the ward and two still in the alley. Four
> seats, one street and thirty tiles — that arithmetic does not get better by
> being braver."* (149 chars)

> **defeat** · idit — *"Nothing of ours was within four tiles of those alleys in
> four minutes. The picture we did bring back is of a town that still has
> people living in it."* (156 chars)

### 2.7 Passive-player loss

**Primary `get_two_in` (`evacuate_before`) reaches `failed` at 240s.** A
passive force parked at `[24,45]` never crosses `SHEPHERD_RADIUS_SQ` (4 tiles,
`civilians.ts`) of either family group at `[20,16]`/`[27,16]`, so
`CivilianFlight`'s boarding path never latches and `evacuatedCount` stays 0.
`design.md` §5.1's own siting note applies: `mortar_crew` at `[24,3]` reaches
only to `y=19` (range 16) and cannot suppress either group into fleeing on its
own — so a passive run is not rescued by accident. `checkEnd` reads the failed
primary and returns **DEFEAT**, no wipe required. The three secondary
`locate`s and `screen_out` do not end the mission either way — the failable
primary is what a passive player must be caught by. **`pnpm playtest`'s
passive control for `khan_rafid_1_recon` must read DEFEAT at 240s of sim time,
not `ongoing`.**

### 2.8 Copy-ready fragments

```json
{
  "id": "khan_rafid_1_recon",
  "name": "Khan Rafid I — House Numbers",
  "town": "khan_rafid",
  "phase": "recon",
  "target_minutes": 6,
  "map": { "file": "khan_rafid", "player_start": [24, 45] },
  "ledger": {
    "requires": ["roster.surviving_units"],
    "produces": ["roster.surviving_units", "roe.mission_ratings", "campaign.completed_missions", "intel.marked_positions", "civ.settlements_evacuated"]
  },
  "dispatch": "The man who prepared the Marj has been at brigade a week, answering questions. Seven kilometres up the coast road the town he built for this is still holding, and nobody in it has had a new order since the morning he was taken.",
  "briefing": "Khan Rafid has house numbers, a market day, a clinic and a civic hall, and every one of those is why he chose it. The man who chose it is answering questions at brigade, and none of his answers say who is holding the town this week. Push the drone up the centre and identify the posts in the two Old Town alleys. It can have both in one sortie; nothing on the ground can, because an alley one tile wide sees along its own axis and nowhere else. The third post is a missile cell nineteen tiles east on Main Street, and Main Street is the only road across this town. It runs the full width, it is straight, and there is no cover on it. Four people are stopped in the Old Town alleys, thirty tiles out and past both the road and the ward. Get two of them back inside the ward inside four minutes. The jeep and the Eitan carry two each, and nothing boards until a soldier is within four tiles of it. The walk back from there is nine tiles and the walk out is thirty, which is the whole of this clock. Bring back the posts, and do not cross that street twice for a picture you already have.",
  "starting_force": [
    { "unit": "recon_drone", "count": 1, "at": [24, 44] },
    { "unit": "jeep_shoded", "count": 1, "at": [22, 45] },
    { "unit": "apc_eitan", "count": 1, "at": [26, 45] },
    { "unit": "inf_squad", "count": 2, "at": [24, 46], "from_ledger": true },
    { "unit": "at_team", "count": 1, "at": [27, 46], "from_ledger": true }
  ],
  "objectives": [
    { "id": "find_the_watch", "type": "locate", "primary": true, "target": "kr_watch",
      "text": "Identify the three posts covering the ward crossing",
      "say": { "speaker": "idit", "text": "Three posts, and not one of them can put a round inside the ward. Every one of them can put a round on anybody crossing to it. That is not an accident of ground; it was laid that way." } },
    { "id": "get_two_in", "type": "evacuate_before", "primary": true, "target": "ward", "count": 2, "seconds": 240,
      "text": "Get two families into the ward inside four minutes",
      "say": { "speaker": "shai", "text": "Two inside the wall. Whatever is still in that alley is not worth a second run across the street." },
      "say_on_fail": { "speaker": "shai", "text": "Four minutes, and nothing of ours got within four tiles of them. They are somebody else's problem now, and there is nobody left in this town whose problem that is." } },
    { "id": "find_the_west_lane", "type": "locate", "primary": false, "target": "kr_lane_west",
      "text": "Identify the rocket team in the west lane",
      "say": { "speaker": "idit", "text": "Rocket team in the west lane, in a road one tile wide with houses on both sides. He is on the board now and he does not get a first shot next week." } },
    { "id": "find_the_east_lane", "type": "locate", "primary": false, "target": "kr_lane_east",
      "text": "Identify the rocket team in the east lane",
      "say": { "speaker": "idit", "text": "The east lane is the mirror of it. Two lanes, two teams, and the only third way north runs through the compound we are not allowed to fight in." } },
    { "id": "find_the_block_commander", "type": "locate", "primary": false, "target": "kr_hvt_ward",
      "text": "Find the man giving the orders in this block",
      "say": { "speaker": "idit", "text": "That is the man giving the orders in this block, and he has not been given one himself since the shaft head. He is holding a town to a plan nobody is still writing." } },
    { "id": "screen_out", "type": "survive_until", "primary": false, "seconds": 300,
      "text": "Stay in the field for five minutes" }
  ],
  "roe": { "enabled": true },
  "civilians": {
    "refuge": "civ_refuge",
    "groups": [
      { "unit": "civilians", "count": 2, "at": [20, 16], "group": "families" },
      { "unit": "civilians", "count": 2, "at": [27, 16], "group": "families" }
    ]
  },
  "enemy": {
    "faction": "ashwar",
    "doctrine_profile": "the town he built",
    "garrison": [
      { "unit": "militia_cell", "count": 1, "at": [19, 11], "tag": "kr_watch" },
      { "unit": "militia_cell", "count": 1, "at": [29, 11], "tag": "kr_watch" },
      { "unit": "rpg_team", "count": 1, "at": [13, 20], "tag": "kr_lane_west", "stance": { "kind": "ambush", "tiles": 3 } },
      { "unit": "atgm_cell", "count": 1, "at": [43, 25], "tag": "kr_watch" },
      { "unit": "militia_cell", "count": 1, "at": [31, 16], "tag": "kr_hvt_ward", "group": "ward_party" },
      { "unit": "rpg_team", "count": 1, "at": [33, 20], "tag": "kr_lane_east", "stance": { "kind": "ambush", "tiles": 3 } },
      { "unit": "militia_cell", "count": 1, "at": [24, 24], "stance": { "kind": "patrol", "waypoints": [[24, 24], [24, 17]] } },
      { "unit": "mortar_crew", "count": 1, "at": [24, 3] }
    ],
    "waves": [
      { "at_seconds": 150, "to": "souk_alley",
        "units": [{ "unit": "militia_cell", "count": 2, "from": "north_road" }],
        "say": { "speaker": "idit", "text": "Two sections down the north road into the souk alleys. Nobody called for them — that is a standing order arriving on time, from before anybody was on this road to call it off." } },
      { "at_seconds": 260, "to": "main_street",
        "units": [{ "unit": "technical", "count": 1, "from": "kr_east_edge" }] }
    ]
  },
  "triggers": [
    { "id": "the_compound_was_never_empty",
      "on": { "kind": "zone_entered", "zone": "ward" },
      "do": { "kind": "spawn", "units": [{ "unit": "militia_cell", "count": 1, "marker": "ward_north_gate" }] },
      "say": { "speaker": "idit", "text": "There is a section coming in through the north gate. The compound was never empty — he has been walking men through it since before we crossed the perimeter." } },
    { "id": "he_gives_up_the_crossing",
      "on": { "kind": "casualties_pct", "value": 35 },
      "do": { "kind": "withdraw_to", "group": "ward_party", "to": "souk_alley" },
      "say": { "speaker": "net", "text": "The party forward of the ward is falling back into the souk. The crossing is open." } },
    { "id": "they_move_the_families_off",
      "on": { "kind": "timer_s", "value": 250 },
      "do": { "kind": "remove", "group": "families" },
      "say": { "speaker": "idit", "text": "The alley is empty. Nobody fought over them; they were walked off it while the drone was over the souk." } }
  ],
  "debrief": {
    "victory": { "speaker": "shai", "text": "Two into the ward and two still in the alley. Four seats, one street and thirty tiles — that arithmetic does not get better by being braver." },
    "defeat": { "speaker": "idit", "text": "Nothing of ours was within four tiles of those alleys in four minutes. The picture we did bring back is of a town that still has people living in it." }
  }
}
```

---

## 3. `khan_rafid_2_foothold` — Khan Rafid II — The Ward

`foothold` · Captain · `khan_rafid` · `target_minutes` 7 · economy:
`logistics_start` 400, `logistics_rate_per_min` 120 · requires
`roster.surviving_units, intel.marked_positions` · produces
`roster.surviving_units, roe.mission_ratings, campaign.completed_missions,
civ.settlements_evacuated`.

### 3.1 Flags

| flag | kind | fiction |
|---|---|---|
| `hold_the_ward` | primary, `hold_for(ward, 240s)` | hold the compound for four minutes |
| `get_four_in` | primary, `evacuate_before(ward, count 4, 300s)` — **the one objective that can fail** | four of six families into the same wall |
| `take_the_market` | secondary, `capture(market, 15s)` | the market square, east of the ward |
| `kill_the_west_lane` | secondary, `eliminate_hvt(kr_lane_west)` | the west-lane rocket team, pre-identified if KR I found it |
| `they_walk_into_the_ward` (trigger) | `zone_entered(ward)` → `commit` group `ward_push` → `civ_refuge` | T-KR4: he comes to the one place the player will not shoot |
| `the_block_pulls_back_into_the_souk` (trigger) | `casualties_pct(40)` → `withdraw_to souk_alley`, group `ward_party` | the forward party shortens |
| `a_charge_squad_comes_for_the_gate` (trigger) | `timer_s(200)` → `spawn` 1 `charge_squad` at `souk_alley` | the one unit that can splash a civilian, homing on its own (kamikaze — §0 item 2) |

### 3.2 ECA rows

| Event Name | IF (`on`) | THEN (`do` / objective / wave) | narrative cue bound | status |
|---|---|---|---|---|
| Mission start | — | title, `briefing` 6 beats | `narrative.md` §2.2, verbatim | live |
| Ward held 4 min | `hold_for(ward, 240s)` completes | toast + `say` | net: "Ward held, four minutes. Nothing came out of that compound that we did not carry out of it." | live |
| A civilian reaches `civ_refuge` | `evacuated` | **nothing** | §13 **G-B** — the worst instance: six civilians, four counted, silent | engine |
| Four families in | `evacuate_before(ward, 4, 300s)` completes | toast + `say` | idit: "Four inside the wall. There is room in there for the other two and eighty seconds of clock; that is your decision, not mine." | live |
| Clock runs out | `evacuate_before(ward, 4, 300s)` fails @300s | toast `OBJECTIVE FAILED —…` + `say_on_fail` — **the only way to lose this mission** | shai: "Five minutes. We held the compound and put nobody in it, which is the one way this was always going to be lost." | live |
| Market taken | `capture(market, 15s)` completes | toast + `say` | net: "Market square is ours. Main Street is cut east of the ward." | live |
| West lane HVT killed | `eliminate_hvt(kr_lane_west)` completes | toast + `say` | shai: "West lane is clear. That is one of the two ways north that does not go through the compound." | live |
| Wave 1 | `at_seconds:120`, `from:"north_road"`, `to:"ward_north_gate"`, 2 `militia_cell` | toast + `say` | idit: "Two sections down the north road for the gate. Every two minutes, on the clock, whether or not there is anything at the gate to fight." | live |
| Wave 2 | `at_seconds:240`, `from:"kr_west_edge"`, `to:"main_street"`, 1 `rpg_team` + 1 `moto_rpg` | toast only, no `say` | — | live |
| Wave 3 | `at_seconds:330`, `from:"north_road"`, `to:"ward_gate"`, 2 `militia_cell` | toast + `say` | idit: "Two more at the north gate, and the families are still walking to it. He is not aiming at them; he is aiming at the gate, and they are in it." | live |
| They walk into the ward | `on:{kind:"zone_entered",zone:"ward"}` | `do:{kind:"commit",group:"ward_push",to:"civ_refuge"}` + `say` | idit: "They are walking into the ward. Not round it and not at the gates — into it, because it is the one piece of ground on this map where your guns are the ones that cost you." | live |
| Block pulls back into the souk | `on:{kind:"casualties_pct",value:40}` | `do:{kind:"withdraw_to",group:"ward_party",to:"souk_alley"}` + `say` | net: "The party forward of the compound has gone back into the souk. They are not finished; they are shortening." | live |
| Charge squad for the gate | `on:{kind:"timer_s",value:200}` | `do:{kind:"spawn",units:[{unit:"charge_squad",count:1,marker:"souk_alley"}]}` + `say` | shai: "One charge squad, out of the souk, coming at the gate. That is the only thing on this map that can kill a family inside the wall, and it does not care which side of it he dies on." | live |
| Camp builds a squad | `built` MissionEvent | `reinforcement deployed — inf_squad` — raw unit id | §13 **G-C** | engine |
| A civilian is killed by an enemy round inside the ward | `SimEvent destroyed`, civilian, `by` enemy | no `on.kind` watches a `SimEvent` | idit's line exists in prose only (§13 **G-A**; T-KR9's literal form) | engine |
| First ROE deduction inside the ward | zone-flagged `nearMiss`/`strike` | hard-coded `roeNotice` copy fires; no authored line | §13 **G-A** | live (deduction) / engine (line) |
| Mission ends | victory / defeat | `debrief` | idit (victory) / shai (defeat), §3.6 | live |

**Row count: 14 live, 0 schema, 3 engine.**

### 3.3 AI director

**Placements:**

| tag / group | unit | count | at | stance |
|---|---|---|---|---|
| group `ward_push` | `militia_cell` | 1 | `[24,14]` | `hold_position` |
| group `ward_push` | `militia_cell` | 1 | `[29,14]` | `hold_position` |
| group `ward_push` | `rpg_team` | 1 | `[22,16]` | `ambush(3)` |
| `kr_lane_west` | `rpg_team` | 1 | `[13,18]` | `ambush(3)` — pre-identified/ambush-forfeited if KR I found it |
| `kr_lane_east` | `rpg_team` | 1 | `[33,18]` | `ambush(3)` — same |
| `kr_hvt_ward`, group `ward_party` | `militia_cell` | 1 | `[24,9]` | `hold_position` |
| — | `militia_cell` | 2 | `[34,8]` | `garrison`, `building:[34,8]` (apartment, `roe_penalty` 14, not protected) |
| — | `mortar_crew` | 1 | `[24,3]` | `hold_position` |
| — | `technical` | 1 | `[8,25]` | `patrol`, waypoints `[[8,25],[40,25]]` |

**Structures:** `camp`, `[2,2]`, at `[24,33]`.

**Cadence table:**

| t (s) | mechanism | size | from | to | group |
|---|---|---|---|---|---|
| 0 | garrison ×8 + patrol ×1, structures ×1 | — | (see above) | `[24,33]` | — |
| 120 | wave | 2 `militia_cell` | `north_road` | `ward_north_gate` | — |
| any tick, `zone_entered(ward)` | trigger `commit` | group `ward_push` (3) | (see above) | `civ_refuge` | `ward_push` |
| ≤240 (from first uncontested hold) | objective clock | — | — | — | `hold_the_ward` |
| any tick, 40% enemy casualties | trigger `withdraw_to` | group `ward_party` (1) | `[24,9]` | `souk_alley` | `ward_party` |
| 200 | trigger `spawn` | 1 `charge_squad` | — | `souk_alley` | — |
| 240 | wave | 1 `rpg_team` + 1 `moto_rpg` | `kr_west_edge` | `main_street` | — |
| ≤300 (deadline) | objective clock | — | — | — | `get_four_in` |
| 330 | wave | 2 `militia_cell` | `north_road` | `ward_gate` | — |

**Pressure curve.** One push at the ward every two minutes (120s/330s),
alternating with one push down Main Street (240s), so neither the hold nor the
escort ever gets a quiet stretch (`design.md` §5.2). `hold_for` is cumulative
and pauses on any contest (`CONTEST_RADIUS_SQ` 6 tiles, `mission.ts:345`), so
the moment `they_walk_into_the_ward` fires, the hold itself stalls until the
committed section is cleared — the same tick the escort is most exposed. The
economy (400/120) buys roughly three rifle sections or one Namer across the
mission; the Namer's `cannon_30` (`collateral_risk` 0.35) arms the
flagged-zone penalty inside `ward` and the Eitan's `rws_50` (0.25) and rifles
(0.10) do not, so the doctrinal answer — infantry and the Eitan clear the
compound, the Namer holds the street outside it — is priced, not merely
suggested.

### 3.4 Map requirements

All **NEW**, listed in §1.1. This mission additionally uses `market`,
`kr_west_edge`, and the mission-placed `camp` structure (not a map feature —
`structures[]`, per the schema's own rule that a structure only one mission
owns belongs there rather than in the shared grid).

### 3.5 Twists

| id | twist | classification | ECA row |
|---|---|---|---|
| T-KR4 | He comes to the one place the player will not shoot | **expressible today** — one trigger, one `say` | "They walk into the ward" |
| T-KR5 | The block above the lane — 14 ROE to level, or go the other way | **split** — expressible today as a placement; its own line lands on nothing, since the price is silent on the score (§13 **G-A**) | (placement; no ECA row fires a line on it) |
| T-KR6 | One civilian group breaks the wrong way under suppression | **split** — expressible today as a placement (`CivilianFlight`'s own `CIV_FLEE_AT` 0.3 rule, no new mechanism); its own line is engine-blocked, since `CivilianFlight` emits no `MissionEvent` an author can hear (§13 **G-A**). `playtest` should also judge whether it reads as cruel or merely unfair (`design.md` O-KR5) | (placement only) |

**1 of 3 fully expressible with a live line (T-KR4); T-KR5 and T-KR6 are both
split — the placement is live in each case and the line it would carry is
engine-blocked (§13 G-A).**

### 3.6 `debrief`

> **victory** · idit — *"Four inside the wall and the wall held. That is the
> first compound in this district we have stood in without taking it apart."*
> (134 chars)

> **defeat** · shai — *"We held a compound for four minutes and put nobody in
> it. The clock was never on the ground; it was on the families, and it always
> was."* (135 chars)

### 3.7 Passive-player loss

**Primary `get_four_in` (`evacuate_before`) reaches `failed` at 300s.** A
passive player never enters `ward` at all, so `hold_the_ward` never starts
(`livingIn(zone,0)` requires a living player unit physically inside), and the
three civilian groups at `[16,16]`, `[31,16]`, `[23,27]` never come within
`SHEPHERD_RADIUS_SQ` of a carrier. `checkEnd` returns **DEFEAT** on the failed
`evacuate_before`. This is deliberate per `design.md` §5.2: *the losable
objective is the one the player has to act on* — a mission that could be lost
on `hold_for` alone would let a passive player who happens to sit outside the
zone survive by inaction; keying the loss to `evacuate_before` closes that.
**`pnpm playtest`'s passive control for `khan_rafid_2_foothold` must read
DEFEAT at 300s.**

### 3.8 Copy-ready fragments

```json
{
  "id": "khan_rafid_2_foothold",
  "name": "Khan Rafid II — The Ward",
  "town": "khan_rafid",
  "phase": "foothold",
  "target_minutes": 7,
  "map": { "file": "khan_rafid", "player_start": [24, 45] },
  "ledger": {
    "requires": ["roster.surviving_units", "intel.marked_positions"],
    "produces": ["roster.surviving_units", "roe.mission_ratings", "campaign.completed_missions", "civ.settlements_evacuated"]
  },
  "briefing": "The ward is nine tiles by seven with four gates and a low wall, and the wall stops men and not bullets. A cell in the souk can fire into that compound over it, you can fire back, and only one of you is billed for it. There is nothing in that ward worth taking and you are going to hold it for four minutes anyway. The clock is cumulative and it stops the moment anything hostile is standing inside the wall with you. Six people in three groups: two groups north of the ward in the Old Town and one south of Main Street. Four have to be inside that wall in five minutes; the wall will hold all six. Rifles and the Eitan's fifty are free inside the compound. The Namer's cannon is not: it is billed for every ten seconds it fires in there, and this mission is lost under forty-five. So the infantry and the Eitan clear the ward and the Namer holds the street outside it. At a hundred and twenty a minute the camp buys you three rifle sections or one more gun you may not use inside the wire. He will walk into that compound the moment it is yours, because it is the one place you will not shoot.",
  "starting_force": [
    { "unit": "inf_squad", "count": 3, "at": [24, 46], "from_ledger": true },
    { "unit": "at_team", "count": 1, "at": [27, 46], "from_ledger": true },
    { "unit": "mortar_team", "count": 1, "at": [21, 46], "from_ledger": true },
    { "unit": "apc_eitan", "count": 2, "at": [26, 45] },
    { "unit": "jeep_shoded", "count": 1, "at": [22, 45] },
    { "unit": "ifv_namer", "count": 1, "at": [29, 45] },
    { "unit": "recon_drone", "count": 1, "at": [24, 44] }
  ],
  "resources": { "logistics_start": 400, "logistics_rate_per_min": 120 },
  "structures": [{ "type": "camp", "at": [24, 33], "size": [2, 2] }],
  "objectives": [
    { "id": "hold_the_ward", "type": "hold_for", "primary": true, "target": "ward", "seconds": 240,
      "text": "Hold the ward for four minutes",
      "say": { "speaker": "net", "text": "Ward held, four minutes. Nothing came out of that compound that we did not carry out of it." } },
    { "id": "get_four_in", "type": "evacuate_before", "primary": true, "target": "ward", "count": 4, "seconds": 300,
      "text": "Get four families into the ward inside five minutes",
      "say": { "speaker": "idit", "text": "Four inside the wall. There is room in there for the other two and eighty seconds of clock; that is your decision, not mine." },
      "say_on_fail": { "speaker": "shai", "text": "Five minutes. We held the compound and put nobody in it, which is the one way this was always going to be lost." } },
    { "id": "take_the_market", "type": "capture", "primary": false, "target": "market", "seconds": 15,
      "text": "Take the market and hold it for 15 seconds",
      "say": { "speaker": "net", "text": "Market square is ours. Main Street is cut east of the ward." } },
    { "id": "kill_the_west_lane", "type": "eliminate_hvt", "primary": false, "target": "kr_lane_west",
      "text": "Kill the rocket team in the west lane",
      "say": { "speaker": "shai", "text": "West lane is clear. That is one of the two ways north that does not go through the compound." } }
  ],
  "roe": { "enabled": true, "flagged_zones": ["ward"], "fail_below": 45, "structure_penalty_mult": 1 },
  "civilians": {
    "refuge": "civ_refuge",
    "groups": [
      { "unit": "civilians", "count": 2, "at": [16, 16] },
      { "unit": "civilians", "count": 2, "at": [31, 16] },
      { "unit": "civilians", "count": 2, "at": [23, 27] }
    ]
  },
  "enemy": {
    "faction": "ashwar",
    "doctrine_profile": "the town he built",
    "garrison": [
      { "unit": "militia_cell", "count": 1, "at": [24, 14], "group": "ward_push" },
      { "unit": "militia_cell", "count": 1, "at": [29, 14], "group": "ward_push" },
      { "unit": "rpg_team", "count": 1, "at": [22, 16], "group": "ward_push", "stance": { "kind": "ambush", "tiles": 3 } },
      { "unit": "rpg_team", "count": 1, "at": [13, 18], "tag": "kr_lane_west", "stance": { "kind": "ambush", "tiles": 3 } },
      { "unit": "rpg_team", "count": 1, "at": [33, 18], "tag": "kr_lane_east", "stance": { "kind": "ambush", "tiles": 3 } },
      { "unit": "militia_cell", "count": 1, "at": [24, 9], "tag": "kr_hvt_ward", "group": "ward_party" },
      { "unit": "militia_cell", "count": 2, "at": [34, 8], "stance": { "kind": "garrison", "building": [34, 8] } },
      { "unit": "mortar_crew", "count": 1, "at": [24, 3] },
      { "unit": "technical", "count": 1, "at": [8, 25], "stance": { "kind": "patrol", "waypoints": [[8, 25], [40, 25]] } }
    ],
    "waves": [
      { "at_seconds": 120, "to": "ward_north_gate",
        "units": [{ "unit": "militia_cell", "count": 2, "from": "north_road" }],
        "say": { "speaker": "idit", "text": "Two sections down the north road for the gate. Every two minutes, on the clock, whether or not there is anything at the gate to fight." } },
      { "at_seconds": 240, "to": "main_street",
        "units": [{ "unit": "rpg_team", "count": 1, "from": "kr_west_edge" }, { "unit": "moto_rpg", "count": 1, "from": "kr_west_edge" }] },
      { "at_seconds": 330, "to": "ward_gate",
        "units": [{ "unit": "militia_cell", "count": 2, "from": "north_road" }],
        "say": { "speaker": "idit", "text": "Two more at the north gate, and the families are still walking to it. He is not aiming at them; he is aiming at the gate, and they are in it." } }
    ]
  },
  "triggers": [
    { "id": "they_walk_into_the_ward",
      "on": { "kind": "zone_entered", "zone": "ward" },
      "do": { "kind": "commit", "group": "ward_push", "to": "civ_refuge" },
      "say": { "speaker": "idit", "text": "They are walking into the ward. Not round it and not at the gates — into it, because it is the one piece of ground on this map where your guns are the ones that cost you." } },
    { "id": "the_block_pulls_back_into_the_souk",
      "on": { "kind": "casualties_pct", "value": 40 },
      "do": { "kind": "withdraw_to", "group": "ward_party", "to": "souk_alley" },
      "say": { "speaker": "net", "text": "The party forward of the compound has gone back into the souk. They are not finished; they are shortening." } },
    { "id": "a_charge_squad_comes_for_the_gate",
      "on": { "kind": "timer_s", "value": 200 },
      "do": { "kind": "spawn", "units": [{ "unit": "charge_squad", "count": 1, "marker": "souk_alley" }] },
      "say": { "speaker": "shai", "text": "One charge squad, out of the souk, coming at the gate. That is the only thing on this map that can kill a family inside the wall, and it does not care which side of it he dies on." } }
  ],
  "debrief": {
    "victory": { "speaker": "idit", "text": "Four inside the wall and the wall held. That is the first compound in this district we have stood in without taking it apart." },
    "defeat": { "speaker": "shai", "text": "We held a compound for four minutes and put nobody in it. The clock was never on the ground; it was on the families, and it always was." }
  }
}
```

---

## 4. `khan_rafid_3_clearance` — Khan Rafid III — What You Keep

`clearance` · Captain · `khan_rafid` · `target_minutes` 7 · economy:
`logistics_start` 400, `logistics_rate_per_min` 80 · requires
`roster.surviving_units, intel.marked_positions` · produces
`roster.surviving_units, roe.mission_ratings, campaign.completed_missions,
intel.marked_positions, civ.settlements_evacuated`.

### 4.1 Flags

| flag | kind | fiction |
|---|---|---|
| `take_the_souk` | primary, `capture(souk, 20s)` | clear and hold the Old Town's dense half |
| `get_six_in` | primary, `evacuate_before(ward, count 6, 300s)` — **the one objective that can fail** | six of eight families into the ward |
| `kill_the_block_commander` | secondary, `eliminate_hvt(kr_hvt_ward)` — garrisoned in a `roe_penalty` 30 `hall`, protected from any engagement, breach or demolition on the sim's own initiative (`PROTECTED_ROE`, `structures.ts:135`; `sim.ts:2977,3073,4345`) | he can only be killed if he walks out |
| `take_the_store` | secondary, `capture(store, 15s)` | the warehouse on the north road |
| `the_souk_empties_into_its_own_alleys` (trigger) | `zone_entered(souk)` → `commit` group `souk` → `souk_alley` | the garrison forms up rather than standing still |
| `he_walks_out_of_the_hall` (trigger) | `casualties_pct(45)` → `withdraw_to souk_alley`, group `hall_party` | **this trigger is the mission**: patience beats a demolition, mechanically |
| `a_rocket_team_moves_into_the_east_lane` (trigger) | `first_contact` → `spawn` 1 `rpg_team` at `east_lane` | the withdrawal route is priced at the moment it closes |

### 4.2 ECA rows

| Event Name | IF (`on`) | THEN (`do` / objective / wave) | narrative cue bound | status |
|---|---|---|---|---|
| Mission start | — | title, `briefing` 7 beats | `narrative.md` §3.2, verbatim | live |
| Souk held 20s | `capture(souk, 20s)` completes | toast + `say` | net: "Souk is held. The Old Town is ours from Main Street to the north road." | live |
| A civilian reaches `civ_refuge` | `evacuated` | **nothing** | §13 **G-B** — eight civilians, six counted, all silent | engine |
| Six families in | `evacuate_before(ward, 6, 300s)` completes | toast + `say` | idit: "Six into the ward. I have kept this count since the first morning of the war and that is the best of them." | live |
| Clock runs out | `evacuate_before(ward, 6, 300s)` fails @300s | toast `OBJECTIVE FAILED —…` + `say_on_fail` — **the only way to lose this mission** | shai: "Five minutes, and six of them were not inside the wall when it ran out. We took ground today and we did not keep the thing we came for." | live |
| Block commander killed | `eliminate_hvt(kr_hvt_ward)` completes | toast + `say` | idit: "He is down in the street outside the hall. He could have stayed in that building for the rest of the war and we would have had to walk away from him." | live |
| Store taken | `capture(store, 15s)` completes | toast + `say` | net: "Store compound is clear. Nothing comes down the north road into this town without crossing us now." | live |
| Wave 1/2 | 130s `north_road`→`souk_alley` ×2 `militia_cell`; 250s `kr_west_edge`→`main_street` 1 `technical` + 1 `moto_rpg` | toast only, no `say` | the metronome has already been named twice | live |
| Wave 3 | `at_seconds:340`, `from:"north_road"`, `to:"ward_north_gate"`, 2 `militia_cell` | toast + `say` | idit: "Two sections at the north gate of the ward, and there are families inside it. He is putting rifles into the one compound on this map you cannot answer with a cannon." | live |
| Souk empties into its own alleys | `on:{kind:"zone_entered",zone:"souk"}` | `do:{kind:"commit",group:"souk",to:"souk_alley"}` + `say` | net: "The garrison is out of the blocks and forming in the alleys." | live |
| He walks out of the hall | `on:{kind:"casualties_pct",value:45}` | `do:{kind:"withdraw_to",group:"hall_party",to:"souk_alley"}` + `say` | idit: "He is out of the hall and moving into the souk. He was not going to leave for us; he left because there was nobody left in the block for him to hold it with." | live |
| Rocket team into the east lane | `on:{kind:"first_contact"}` | `do:{kind:"spawn",units:[{unit:"rpg_team",count:1,marker:"east_lane"}]}` + `say` | shai: "Rocket team into the east lane, on the road we came up. Nothing goes back down it on wheels until somebody clears that." | live |
| Garrisoned apartment takes fire | automatic structure-fire path | hard-coded structure-damage copy; **no authored line** | the price should be discovered on the score, not announced (T-KR5) | live (deduction) |
| Camp builds a squad | `built` | raw unit id | §13 **G-C** | engine |
| Mission ends | victory / defeat | `debrief` | idit (victory) / shai (defeat), §4.6 | live |
| `missionEnd(victory)` | — | `aftermath` | **none, deliberately** — the act closes at Deir Amun III (`narrative.md` §0.6, §6.5) | live |

**Row count: 14 live, 0 schema, 2 engine.**

### 4.3 AI director

**Placements:**

| tag / group | unit | count | at | stance |
|---|---|---|---|---|
| `kr_hvt_ward`, group `hall_party` | `militia_cell` | 1 | `[27,19]` | `garrison`, `building:[27,19]` (the hall, `roe_penalty` 30 — protected) |
| group `hall_party` | `rpg_team` | 1 | `[25,22]` | `ambush(3)` |
| group `souk` | `militia_cell` | 1 | `[21,8]` | `garrison`, `building:[21,8]` |
| group `souk` | `militia_cell` | 1 | `[26,13]` | `garrison`, `building:[26,13]` |
| group `souk` | `rpg_team` | 1 | `[24,11]` | `ambush(3)` |
| `kr_lane_east` | `rpg_team` | 1 | `[33,14]` | `ambush(3)` — pre-identified/forfeited if KR I found it |
| `kr_watch` | `atgm_cell` | 1 | `[41,25]` | `ambush(6)` — same |
| — | `charge_squad` | 1 | `[19,6]` | `hold_position` (kamikaze; homes on its own) |
| group `store` | `militia_cell` | 2 | `[19,3]` | `garrison`, `building:[19,3]` (warehouse) |
| — | `mortar_crew` | 1 | `[38,3]` | `hold_position` |
| — | `loiter_drone` | 1 | `[24,1]` | `hold_position` (kamikaze; homes on its own) |

**Cadence table:**

| t (s) | mechanism | size | from | to | group |
|---|---|---|---|---|---|
| 0 | garrison ×11 | — | (see above) | — | — |
| any tick, `first_contact` | trigger `spawn` | 1 `rpg_team` | — | `east_lane` | — |
| 130 | wave | 2 `militia_cell` | `north_road` | `souk_alley` | — |
| any tick, `zone_entered(souk)` | trigger `commit` | group `souk` (3) | (see above) | `souk_alley` | `souk` |
| ≤20s uninterrupted | objective clock | — | — | — | `take_the_souk` |
| any tick, 45% enemy casualties | trigger `withdraw_to` | group `hall_party` (2) | `[27,19]`/`[25,22]` | `souk_alley` | `hall_party` |
| 250 | wave | 1 `technical` + 1 `moto_rpg` | `kr_west_edge` | `main_street` | — |
| ≤300 (deadline) | objective clock | — | — | — | `get_six_in` |
| 340 | wave | 2 `militia_cell` | `north_road` | `ward_north_gate` | — |

**Pressure curve.** Two clocks compete for the same bodies: `capture(souk,
20)` needs twenty **uninterrupted** seconds against a garrison that, once the
zone is entered, forms up and attacks toward `souk_alley` — and `get_six_in`
needs six of eight families walked home inside 300s with eleven carrier seats
against eight people (`design.md` §5.3, `apc_eitan` ×2 @2 + `jeep_shoded` @2 +
`ifv_namer` @5). The block commander is the one enemy the player cannot shoot
out of his building: `he_walks_out_of_the_hall` is the only door, and it opens
only once his escort (the `rpg_team` in the forecourt) has taken 45% of the
garrison's start-of-mission casualties. `structure_penalty_mult: 2` (§4.7)
means the Lavi and the flagged-zone penalty inside `ward` are live pressure on
top of both clocks, not scenery.

### 4.4 Map requirements

All **NEW**, listed in §1.1. This mission additionally uses `souk` (zone),
`store` (zone), `store_gate`, `east_lane`. **KR-M1 applies here**: the block
commander's escort `rpg_team` at `[25,22]` sits in the ward forecourt, three
tiles from `civ_refuge`, reachable only via the N–S corridor — consistent with
the finding, not affected by it.

### 4.5 Twists

| id | twist | classification | ECA row |
|---|---|---|---|
| T-KR7 | The block commander cannot be shot in the hall (`roe_penalty` 30 ≥ `PROTECTED_ROE`) | **expressible today** — one `garrison` stance on a protected structure; the whole behaviour falls out of the sim's existing rules. **The strongest thing in the arc; one line of JSON** | placement in §4.3/§4.8 |
| T-KR8 | He gives the ward back and takes the souk | **expressible today** — `casualties_pct(45) → withdraw_to`. Carries `tel_marum/design.md`'s recorded `withdraw_to` re-run risk — re-run `pnpm playtest` after it lands | "He walks out of the hall" |
| T-KR9 | His round kills a family inside the wall and the score does not move (`stepRoe` bills only a player-attributed `destroyed`) | **split** — expressible today as a **placement** (a family on the `charge_squad`'s run, plus KR II's advance warning); the literal bound line needs a sim-watching trigger **and** a way to choose where an enemy round lands (§13 **G-A**, **G-F**) | (placement only; no bound line) |
| T-KR10 | The house numbers — the count read back | **expressible today** — `debrief.victory`, live and outcome-aware since 2026-09-06 | §4.6 |

**3 of 4 fully expressible with a live line; T-KR9 ships as a placement with
its literal form recorded as engine work.**

### 4.6 `debrief`

> **victory** · idit — *"Six of the eight into the ward, and the town is still
> standing. I will write the other two down, the same way I wrote down the
> ones at the compound."* (148 chars)

> **defeat** · shai — *"The souk is ours and the ward is empty. I would rather
> have had it the other way round, and next week somebody will ask me which I
> chose."* (137 chars)

### 4.7 The measurement gate on `structure_penalty_mult: 2`

`design.md` §5.3/O-KR4: `structure_penalty_mult: 2` (a `house` costs 12, an
`apartment` 28, levelling the whole map −456) and `fail_below: 50` are both
untested numbers, and the design's own rule is **do not ship both dials
untested at once**. `pnpm playtest` runs the scripted plan first and reads
`roeScore`:

- **≥ 65** → ship as authored (mult 2, floor 50), and the copy-ready fragment
  below is what ships.
- **< 65** → fall back to `structure_penalty_mult: 1`, `fail_below: 55`, and
  beat 6 of the briefing becomes (167 chars, verified against the 240-char
  cap):

  > *"Every structure you bring down here is on the bill and there are forty of
  > them. The floor is fifty-five, which is the highest this brigade has ever
  > been asked to hold."*

This is §11's first gate, before anything else about this mission is treated
as final.

### 4.8 Copy-ready fragments

```json
{
  "id": "khan_rafid_3_clearance",
  "name": "Khan Rafid III — What You Keep",
  "town": "khan_rafid",
  "phase": "clearance",
  "target_minutes": 7,
  "map": { "file": "khan_rafid", "player_start": [24, 45] },
  "ledger": {
    "requires": ["roster.surviving_units", "intel.marked_positions"],
    "produces": ["roster.surviving_units", "roe.mission_ratings", "campaign.completed_missions", "intel.marked_positions", "civ.settlements_evacuated"]
  },
  "briefing": "The man running this block is inside the civic hall in the ward, and the hall is the one building here that nothing of ours will fire on by itself. It is not shot at, not breached and not brought down by anybody acting on his own. You have nobody with you who can level it, and that is deliberate. Hurt his people hard enough and he leaves it on his own feet, which is the only way he comes out. The lanes and the road east are laid the way they were laid last week. Whatever you identified then comes back with its ambush spent; whatever you did not gets its first shot. Clear the souk and hold it twenty seconds without a break. Eight families are in that quarter and six of them have to be inside the ward in five minutes. The carriers hold eleven between them, so the clock is the only thing standing between you and all eight. Nothing boards until a soldier is inside four tiles of it. Every structure you bring down here is billed at twice the usual, and eight houses is this mission. The floor is fifty and there is no getting a house back. Take the souk, get them in, and be able to say what is still standing.",
  "starting_force": [
    { "unit": "inf_squad", "count": 4, "at": [24, 46], "from_ledger": true },
    { "unit": "at_team", "count": 1, "at": [27, 46], "from_ledger": true },
    { "unit": "mortar_team", "count": 1, "at": [20, 46], "from_ledger": true },
    { "unit": "apc_eitan", "count": 2, "at": [26, 45] },
    { "unit": "jeep_shoded", "count": 1, "at": [22, 45] },
    { "unit": "ifv_namer", "count": 1, "at": [29, 45] },
    { "unit": "mbt_lavi", "count": 1, "at": [24, 44] },
    { "unit": "sniper_team", "count": 1, "at": [31, 45] },
    { "unit": "recon_drone", "count": 1, "at": [24, 43] }
  ],
  "resources": { "logistics_start": 400, "logistics_rate_per_min": 80 },
  "objectives": [
    { "id": "take_the_souk", "type": "capture", "primary": true, "target": "souk", "seconds": 20,
      "text": "Clear the souk and hold it for 20 seconds",
      "say": { "speaker": "net", "text": "Souk is held. The Old Town is ours from Main Street to the north road." } },
    { "id": "get_six_in", "type": "evacuate_before", "primary": true, "target": "ward", "count": 6, "seconds": 300,
      "text": "Get six families into the ward inside five minutes",
      "say": { "speaker": "idit", "text": "Six into the ward. I have kept this count since the first morning of the war and that is the best of them." },
      "say_on_fail": { "speaker": "shai", "text": "Five minutes, and six of them were not inside the wall when it ran out. We took ground today and we did not keep the thing we came for." } },
    { "id": "kill_the_block_commander", "type": "eliminate_hvt", "primary": false, "target": "kr_hvt_ward",
      "text": "Kill the block commander if you can make him leave the hall",
      "say": { "speaker": "idit", "text": "He is down in the street outside the hall. He could have stayed in that building for the rest of the war and we would have had to walk away from him." } },
    { "id": "take_the_store", "type": "capture", "primary": false, "target": "store", "seconds": 15,
      "text": "Take the store on the north road and hold it for 15 seconds",
      "say": { "speaker": "net", "text": "Store compound is clear. Nothing comes down the north road into this town without crossing us now." } }
  ],
  "roe": { "enabled": true, "flagged_zones": ["ward"], "fail_below": 50, "structure_penalty_mult": 2 },
  "civilians": {
    "refuge": "civ_refuge",
    "groups": [
      { "unit": "civilians", "count": 2, "at": [16, 16] },
      { "unit": "civilians", "count": 2, "at": [20, 16] },
      { "unit": "civilians", "count": 2, "at": [31, 16] },
      { "unit": "civilians", "count": 2, "at": [30, 27] }
    ]
  },
  "enemy": {
    "faction": "ashwar",
    "doctrine_profile": "the town he built",
    "garrison": [
      { "unit": "militia_cell", "count": 1, "at": [27, 19], "tag": "kr_hvt_ward", "group": "hall_party", "stance": { "kind": "garrison", "building": [27, 19] } },
      { "unit": "rpg_team", "count": 1, "at": [25, 22], "group": "hall_party", "stance": { "kind": "ambush", "tiles": 3 } },
      { "unit": "militia_cell", "count": 1, "at": [21, 8], "group": "souk", "stance": { "kind": "garrison", "building": [21, 8] } },
      { "unit": "militia_cell", "count": 1, "at": [26, 13], "group": "souk", "stance": { "kind": "garrison", "building": [26, 13] } },
      { "unit": "rpg_team", "count": 1, "at": [24, 11], "group": "souk", "stance": { "kind": "ambush", "tiles": 3 } },
      { "unit": "rpg_team", "count": 1, "at": [33, 14], "tag": "kr_lane_east", "stance": { "kind": "ambush", "tiles": 3 } },
      { "unit": "atgm_cell", "count": 1, "at": [41, 25], "tag": "kr_watch", "stance": { "kind": "ambush", "tiles": 6 } },
      { "unit": "charge_squad", "count": 1, "at": [19, 6] },
      { "unit": "militia_cell", "count": 2, "at": [19, 3], "group": "store", "stance": { "kind": "garrison", "building": [19, 3] } },
      { "unit": "mortar_crew", "count": 1, "at": [38, 3] },
      { "unit": "loiter_drone", "count": 1, "at": [24, 1] }
    ],
    "waves": [
      { "at_seconds": 130, "to": "souk_alley", "units": [{ "unit": "militia_cell", "count": 2, "from": "north_road" }] },
      { "at_seconds": 250, "to": "main_street", "units": [{ "unit": "technical", "count": 1, "from": "kr_west_edge" }, { "unit": "moto_rpg", "count": 1, "from": "kr_west_edge" }] },
      { "at_seconds": 340, "to": "ward_north_gate",
        "units": [{ "unit": "militia_cell", "count": 2, "from": "north_road" }],
        "say": { "speaker": "idit", "text": "Two sections at the north gate of the ward, and there are families inside it. He is putting rifles into the one compound on this map you cannot answer with a cannon." } }
    ]
  },
  "triggers": [
    { "id": "the_souk_empties_into_its_own_alleys",
      "on": { "kind": "zone_entered", "zone": "souk" },
      "do": { "kind": "commit", "group": "souk", "to": "souk_alley" },
      "say": { "speaker": "net", "text": "The garrison is out of the blocks and forming in the alleys." } },
    { "id": "he_walks_out_of_the_hall",
      "on": { "kind": "casualties_pct", "value": 45 },
      "do": { "kind": "withdraw_to", "group": "hall_party", "to": "souk_alley" },
      "say": { "speaker": "idit", "text": "He is out of the hall and moving into the souk. He was not going to leave for us; he left because there was nobody left in the block for him to hold it with." } },
    { "id": "a_rocket_team_moves_into_the_east_lane",
      "on": { "kind": "first_contact" },
      "do": { "kind": "spawn", "units": [{ "unit": "rpg_team", "count": 1, "marker": "east_lane" }] },
      "say": { "speaker": "shai", "text": "Rocket team into the east lane, on the road we came up. Nothing goes back down it on wheels until somebody clears that." } }
  ],
  "debrief": {
    "victory": { "speaker": "idit", "text": "Six of the eight into the ward, and the town is still standing. I will write the other two down, the same way I wrote down the ones at the compound." },
    "defeat": { "speaker": "shai", "text": "The souk is ours and the ward is empty. I would rather have had it the other way round, and next week somebody will ask me which I chose." }
  }
}
```

---

## 5. `deir_amun_1_recon` — Deir Amun I — Read the Ground

`recon` · Captain · `deir_amun` · `target_minutes` 6 · no economy · requires
`roster.surviving_units, intel.marked_positions` · produces
`roster.surviving_units, roe.mission_ratings, campaign.completed_missions,
intel.marked_positions`. **No civilians on this map at all.**

### 5.1 Flags

| flag | kind | fiction |
|---|---|---|
| `find_the_crew` | primary, `locate(target: da_diggers)` — 3 placements share the tag | the crew still working the western route |
| `bring_down_the_west` | primary, `collapse(da_west, 240s)` — **the one objective that can fail** | the smallest version of the town's whole mechanic |
| `find_the_chief` | secondary, `locate(da_hvt_engineer)` | the digging chief, on his own spoil — carries into DA II/III |
| `find_the_gap_gun` | secondary, `locate(da_watch_gap)` | the rocket team over the west gap — carries into DA II as an `ambush` |
| `screen_out` | secondary, `survive_until(300)` — cannot fail | shared recon shape |
| `the_crew_stops_digging_and_turns_round` (trigger) | `zone_entered(da_west)` → `commit` group `da_diggers` → `da_west_head` | the crew defends the work, not a place |
| `the_bed_is_a_road_and_it_is_theirs` (trigger) | `first_contact` → `spawn` 1 `militia_cell` at `wadi_bend` | the dead ground cuts both ways |

### 5.2 ECA rows

| Event Name | IF (`on`) | THEN (`do` / objective / wave) | narrative cue bound | status |
|---|---|---|---|---|
| Mission start | — | `dispatch` shown, title, `briefing` 6 beats | `narrative.md` §4.2/§4.3, verbatim | live |
| Crew found | `locate(target:"da_diggers")` completes | toast + `say` | idit: "That is the crew, and they are still working. Nobody has told them to stop, and the man who would have is in a cell at brigade." | live |
| Chief found | `locate(da_hvt_engineer)` completes | toast + `say` | idit: "That is the man running the digging, standing on his own spoil. He is the only one down here who knows where all six of them go." | live |
| Gap gun found | `locate(da_watch_gap)` completes | toast + `say` | idit: "Rocket team laid on the west gap, which is one of the two ways through the rock line. He is on the board and he does not get a first shot next week." | live |
| West route collapsed | `collapse(da_west, 240s)` completes | toast + `say` | shai: "West route down. One of six, and the other five are on a piece of paper that has never been checked against the ground." | live |
| Clock runs out | `collapse(da_west, 240s)` fails @240s | toast `OBJECTIVE FAILED —…` + `say_on_fail` — **the only way to lose this mission** | idit: "Four minutes, and the route is still open and still growing. They will have another twelve tiles of it by the time anybody comes back." | live |
| Five minutes screened | `survive_until(300)` completes | toast | shipped shape, no `say` | live |
| Wave 1 | `at_seconds:140`, `from:"gap_west"`, `to:"da_west_head"`, 2 `militia_cell` | toast + `say` | idit: "Two sections down through the west gap for the gully head. They are not defending a village; there is nobody in it. They are defending the work." | live |
| Wave 2 | `at_seconds:260`, `from:"north_road"`, `to:"hamlet_lane"`, 1 `rpg_team` | toast only, no `say` | — | live |
| Crew stops digging and turns round | `on:{kind:"zone_entered",zone:"da_west"}` | `do:{kind:"commit",group:"da_diggers",to:"da_west_head"}` + `say` | net: "The crew has stopped digging. They are coming up onto the shoulder with the section that was covering them." | live |
| The bed is a road and it is theirs | `on:{kind:"first_contact"}` | `do:{kind:"spawn",units:[{unit:"militia_cell",count:1,marker:"wadi_bend"}]}` + `say` | idit: "There is a section in the bed behind you. That watercourse is not dead ground for them — it is a road, and it is theirs." | live |
| `da_tn_lane`'s `in_tunnel` cells vent at `[27,18]` | `SimEvent surfaced` | no `on.kind` watches a `SimEvent` | shai's line exists in prose only (T-DA3; §13 **G-A**) | engine |
| `tunnelContact` at `identified`/`lost` | `SimEvent tunnelContact` | same gap | `eva` lines exist in prose only (§13 **G-A**) | engine |
| Mission ends | victory / defeat | `debrief` | shai (victory) / idit (defeat), §5.6 | live |

**Row count: 12 live, 0 schema, 2 engine.**

### 5.3 AI director

**Placements:**

| tag / group | unit | count | at | stance |
|---|---|---|---|---|
| `da_diggers` (tag+group) | `digger_crew` | 1 | `[9,18]`, `digs:"da_tn_west"` | `hold_position` |
| `da_diggers` (tag+group) | `militia_cell` | 1 | `[7,19]` | `hold_position` |
| `da_diggers` (tag+group) | `militia_cell` | 1 | `[21,22]` | `hold_position` |
| `da_hvt_engineer` | `digger_crew` | 1 | `[28,17]` | `hold_position` |
| `da_watch_gap` | `rpg_team` | 1 | `[18,11]` | `ambush(4)` |
| — | `rpg_team` | 1 | `[16,29]` | `ambush(4)` |
| — (`in_tunnel`) | `militia_cell` | 2 | `in_tunnel:"da_tn_lane"` | — (vents at `[27,18]`) |
| — | `mortar_crew` | 1 | `[24,2]` | `hold_position` |

**Cadence table:**

| t (s) | mechanism | size | from | to | group |
|---|---|---|---|---|---|
| 0 | garrison ×6 + `in_tunnel` ×2 | — | (see above) | — | — |
| any tick, `first_contact` | trigger `spawn` | 1 `militia_cell` | — | `wadi_bend` | — |
| 140 | wave | 2 `militia_cell` | `gap_west` | `da_west_head` | — |
| any tick, `zone_entered(da_west)` | trigger `commit` | group `da_diggers` (3) | (see above) | `da_west_head` | `da_diggers` |
| ≤240 (deadline) | objective clock | — | — | — | `bring_down_the_west` |
| 260 | wave | 1 `rpg_team` | `north_road` | `hamlet_lane` | — |
| 300 | objective clock | — | — | — | `screen_out` |

**Pressure curve.** The mission is one route, one crew, and a route/domain
choice: the gully bed is 27 tiles on foot and dead ground the whole way
(§9 DA-A3), watched only from its two lips by the `rpg_team` at the ford
(`[16,29]`) and the `militia_cell` on the shoulder (`[7,19]`); the shoulder
route round the top is 44 tiles for a vehicle (§9 DA-A2, superseding
`design.md`'s draft 37), because the tributary is sealed to wheels and tracks
for fifteen rows. Whichever the player picks, the charge itself is 8 stationary
seconds within `CHARGE_RANGE_SQ` (2 tiles, `tunnels.ts:45`), resetting on any
movement (`sim.ts:4440`) — the longest eight seconds in the arc.

### 5.4 Map requirements

All **NEW**, listed in §1.2. This mission uses `da_start`, `da_west` (zone),
`da_west_head`, `gap_west`, `wadi_bend`, `north_road`, `hamlet_lane`, and the
`da_tn_west`/`da_tn_lane` tunnel routes (the former dug live by the placement
above, the latter stocked and vents on its own — §0 item 5's structural note
about `da_tn_yard`'s mouth does not touch `da_tn_lane`'s mouth `[20,23]`,
confirmed open, §1.2).

### 5.5 Twists

| id | twist | classification | ECA row |
|---|---|---|---|
| T-DA1 | He is still digging — a live `digs` assignment a year after the man who ordered it went into a cell | **expressible today** — `digs` ships and two Beit Sahwan missions use it | "Crew found" |
| T-DA2 | The dirt is the intelligence — two routes stamp trail, four do not | **expressible today**, and true of the map itself; the briefing states it once | (map fact; briefing beat 4) |
| T-DA3 | Behind you, out of the spoil — `in_tunnel` cells vent on ground already cleared | **expressible today** as a placement; the vent itself is silent (§13 **G-A**) | (placement only) |

**2 of 3 fully expressible with a live line; T-DA3's placement is live and its
line is engine-blocked.**

### 5.6 `debrief`

> **victory** · shai — *"One route down and the crew with it. Five more on a
> sheet of paper written by a man who has been in a cell for a week."*
> (118 chars)

> **defeat** · idit — *"The route is still open and the crew is still working
> it. Nobody has told them to stop and there is nobody left who can."*
> (120 chars)

### 5.7 Passive-player loss

**Primary `bring_down_the_west` (`collapse`) reaches `failed` at 240s.** A
passive player never sends a `yahalom_squad` within `CHARGE_RANGE_SQ` (2 tiles)
of any tile `da_tn_west` runs under, so `stepTunnelCharge` never starts a
charge and `tnAlive[route]` stays 1. `checkEnd` returns **DEFEAT** — and it
fails for a reason the player can name, per this pipeline's own standard: *not
"you were killed" but "you did not go and look"*. **`pnpm playtest`'s passive
control for `deir_amun_1_recon` must read DEFEAT at 240s.**

### 5.8 Copy-ready fragments

```json
{
  "id": "deir_amun_1_recon",
  "name": "Deir Amun I — Read the Ground",
  "town": "deir_amun",
  "phase": "recon",
  "target_minutes": 6,
  "map": { "file": "deir_amun", "player_start": [24, 44] },
  "ledger": {
    "requires": ["roster.surviving_units", "intel.marked_positions"],
    "produces": ["roster.surviving_units", "roe.mission_ratings", "campaign.completed_missions", "intel.marked_positions"]
  },
  "dispatch": "Everything that ever came into the Marj came through Deir Amun. The people left it in the first week of the war; the district's routes did not, and all six of them join the road east under nine empty houses.",
  "briefing": "Deir Amun is nine houses and a pump yard on the lip of a dry watercourse, and nobody lives in any of it now. What is left is the junction: every route in this district joins the road east under that village. A crew is working the western route this morning. Find them, find where it runs, and put it down inside four minutes. I have his routes on paper and paper is not identification. A route is on the board only while somebody with a detector is looking at it, and it goes back to a rumour the moment they stop. This one is being dug now, so it is throwing spoil along the gully floor, and disturbed earth is something any soldier can read. The ones he finished before the war throw nothing at all. Two ways west and they are not the same road. The bed is twenty-seven tiles on foot and nothing on the terrace can see into it; the shoulder is thirty-seven for anything on wheels. The engineers set a charge standing still in the open, two tiles from the route, for eight seconds. Get them there with something that can shoot, and bring the west route down.",
  "starting_force": [
    { "unit": "recon_drone", "count": 1, "at": [24, 43] },
    { "unit": "yahalom_squad", "count": 1, "at": [24, 45] },
    { "unit": "inf_squad", "count": 2, "at": [22, 45], "from_ledger": true },
    { "unit": "at_team", "count": 1, "at": [27, 45], "from_ledger": true },
    { "unit": "apc_eitan", "count": 1, "at": [28, 45] }
  ],
  "objectives": [
    { "id": "find_the_crew", "type": "locate", "primary": true, "target": "da_diggers",
      "text": "Find the crew working the western route",
      "say": { "speaker": "idit", "text": "That is the crew, and they are still working. Nobody has told them to stop, and the man who would have is in a cell at brigade." } },
    { "id": "bring_down_the_west", "type": "collapse", "primary": true, "target": "da_west", "seconds": 240,
      "text": "Collapse the western route inside four minutes",
      "say": { "speaker": "shai", "text": "West route down. One of six, and the other five are on a piece of paper that has never been checked against the ground." },
      "say_on_fail": { "speaker": "idit", "text": "Four minutes, and the route is still open and still growing. They will have another twelve tiles of it by the time anybody comes back." } },
    { "id": "find_the_chief", "type": "locate", "primary": false, "target": "da_hvt_engineer",
      "text": "Find the digging chief on the spoil field",
      "say": { "speaker": "idit", "text": "That is the man running the digging, standing on his own spoil. He is the only one down here who knows where all six of them go." } },
    { "id": "find_the_gap_gun", "type": "locate", "primary": false, "target": "da_watch_gap",
      "text": "Identify the rocket team over the west gap",
      "say": { "speaker": "idit", "text": "Rocket team laid on the west gap, which is one of the two ways through the rock line. He is on the board and he does not get a first shot next week." } },
    { "id": "screen_out", "type": "survive_until", "primary": false, "seconds": 300,
      "text": "Stay in the field for five minutes" }
  ],
  "roe": { "enabled": true },
  "enemy": {
    "faction": "ashwar",
    "doctrine_profile": "the network beneath",
    "garrison": [
      { "unit": "digger_crew", "count": 1, "at": [9, 18], "tag": "da_diggers", "group": "da_diggers", "digs": "da_tn_west" },
      { "unit": "militia_cell", "count": 1, "at": [7, 19], "tag": "da_diggers", "group": "da_diggers" },
      { "unit": "militia_cell", "count": 1, "at": [21, 22], "tag": "da_diggers", "group": "da_diggers" },
      { "unit": "digger_crew", "count": 1, "at": [28, 17], "tag": "da_hvt_engineer" },
      { "unit": "rpg_team", "count": 1, "at": [18, 11], "tag": "da_watch_gap", "stance": { "kind": "ambush", "tiles": 4 } },
      { "unit": "rpg_team", "count": 1, "at": [16, 29], "stance": { "kind": "ambush", "tiles": 4 } },
      { "unit": "militia_cell", "count": 2, "at": [27, 18], "in_tunnel": "da_tn_lane" },
      { "unit": "mortar_crew", "count": 1, "at": [24, 2] }
    ],
    "waves": [
      { "at_seconds": 140, "to": "da_west_head",
        "units": [{ "unit": "militia_cell", "count": 2, "from": "gap_west" }],
        "say": { "speaker": "idit", "text": "Two sections down through the west gap for the gully head. They are not defending a village; there is nobody in it. They are defending the work." } },
      { "at_seconds": 260, "to": "hamlet_lane",
        "units": [{ "unit": "rpg_team", "count": 1, "from": "north_road" }] }
    ]
  },
  "triggers": [
    { "id": "the_crew_stops_digging_and_turns_round",
      "on": { "kind": "zone_entered", "zone": "da_west" },
      "do": { "kind": "commit", "group": "da_diggers", "to": "da_west_head" },
      "say": { "speaker": "net", "text": "The crew has stopped digging. They are coming up onto the shoulder with the section that was covering them." } },
    { "id": "the_bed_is_a_road_and_it_is_theirs",
      "on": { "kind": "first_contact" },
      "do": { "kind": "spawn", "units": [{ "unit": "militia_cell", "count": 1, "marker": "wadi_bend" }] },
      "say": { "speaker": "idit", "text": "There is a section in the bed behind you. That watercourse is not dead ground for them — it is a road, and it is theirs." } }
  ],
  "debrief": {
    "victory": { "speaker": "shai", "text": "One route down and the crew with it. Five more on a sheet of paper written by a man who has been in a cell for a week." },
    "defeat": { "speaker": "idit", "text": "The route is still open and the crew is still working it. Nobody has told them to stop and there is nobody left who can." }
  }
}
```

**Note on the `in_tunnel` placement's `at`.** The schema does not require `at`
on an `in_tunnel` placement (the body spawns underground, not on a tile), but
`[27,18]` — the route's own vent — is given for readability and matches
`beit_sahwan_4_subterranean.json`'s own convention of giving a buried placement
a coordinate near where it will surface.

---

## 6. `deir_amun_2_foothold` — Deir Amun II — Set the Charges

`foothold` · Captain · `deir_amun` · `target_minutes` 7 · economy:
`logistics_start` 400, `logistics_rate_per_min` 120 · requires
`roster.surviving_units, intel.marked_positions` · produces
`roster.surviving_units, roe.mission_ratings, campaign.completed_missions`.

### 6.1 Flags

| flag | kind | fiction |
|---|---|---|
| `hold_the_yard` | primary, `hold_for(pump_yard, 240s)` | hold the yard for four minutes |
| `shut_the_door` | primary, `collapse(pump_yard, 240s)` — **the one objective that can fail**; `hold_for` never starts on a passive run either | the route's mouth is inside the yard being held |
| `take_the_store_yard` | secondary, `capture(store_yard, 15s)` | the compound on the east road |
| `kill_the_gap_gun` | secondary, `eliminate_hvt(da_watch_gap)` | the tag DA I could have found, pre-identified if it was |
| `the_village_comes_down_to_the_yard` (trigger) | `zone_entered(pump_yard)` → `commit` group `hamlet` → `pump_gate` | the village's own ROE inversion — every body on the street is a fighter |
| `the_yard_party_falls_back_up_the_lane` (trigger) | `casualties_pct(40)` → `withdraw_to hamlet_north`, group `yard` | the pump-house garrison shortens |
| `a_charge_squad_comes_down_the_lane` (trigger) | `timer_s(180)` → `spawn` 1 `charge_squad` at `hamlet_lane` | homes on its own (kamikaze — §0 item 2) |

### 6.2 ECA rows

| Event Name | IF (`on`) | THEN (`do` / objective / wave) | narrative cue bound | status |
|---|---|---|---|---|
| Mission start | — | title, `briefing` 6 beats | `narrative.md` §5.2, verbatim | live |
| Yard held 4 min | `hold_for(pump_yard, 240s)` completes | toast + `say` | net: "Pump yard held, four minutes. One gate, and it stayed ours." | live |
| Route under the yard collapsed | `collapse(pump_yard, 240s)` completes | toast + `say` | shai: "The route under the yard is down. Whatever was still in it is not coming up anywhere." | live |
| Clock runs out | `collapse(pump_yard, 240s)` fails @240s | toast `OBJECTIVE FAILED —…` + `say_on_fail` — **the only way to lose this mission** | shai: "Four minutes on the charge and the mouth is still open inside the wall. We are holding a yard with a door in the floor of it." | live |
| Store yard taken | `capture(store_yard, 15s)` completes | toast + `say` | net: "Store compound is clear. The east road is watched from our side of it now." | live |
| Gap gun killed | `eliminate_hvt(da_watch_gap)` completes | toast + `say` | shai: "The gap is clear. That is one of the two ways through the rock line and it is the one their reinforcements use." | live |
| Wave 1/2 | 110s `gap_west`→`pump_gate` ×2 `militia_cell`; 230s `north_road`→`hamlet_lane` 1 `rpg_team`+1 `moto_rpg` | toast only, no `say` | the push at the objective explains itself | live |
| Wave 3 | `at_seconds:340`, `from:"gap_east"`, `to:"ford_centre"`, 2 `militia_cell` | toast + `say` | idit: "Two sections across the centre ford. They are not going to the yard — they are going to the camp on the bank, and the camp is four tiles from that ford." | live |
| Village comes down to the yard | `on:{kind:"zone_entered",zone:"pump_yard"}` | `do:{kind:"commit",group:"hamlet",to:"pump_gate"}` + `say` | idit: "The village is coming down the lane at the yard. There are nine houses up there and not one person in them; every body on that street is a fighter." | live |
| Yard party falls back | `on:{kind:"casualties_pct",value:40}` | `do:{kind:"withdraw_to",group:"yard",to:"hamlet_north"}` + `say` | net: "The yard party is out of the pump house and going north up the lane." | live |
| Charge squad down the lane | `on:{kind:"timer_s",value:180}` | `do:{kind:"spawn",units:[{unit:"charge_squad",count:1,marker:"hamlet_lane"}]}` + `say` | shai: "Charge squad down the lane. Get the engineers off the mouth or get something between him and them." | live |
| `da_tn_pump`'s two `rpg_team` vent at `[20,30]` | `SimEvent surfaced` | no `on.kind` watches a `SimEvent` | shai's line exists in prose only (T-DA4's payoff; §13 **G-A**) | engine |
| Camp builds a squad | `built` | raw unit id | §13 **G-C** | engine |
| A `yahalom_squad` is destroyed | `SimEvent destroyed` | same gap | shai's line exists in prose only | engine |
| Mission ends | victory / defeat | `debrief` | idit (victory) / shai (defeat), §6.4 | live |

**Row count: 12 live, 0 schema, 3 engine.**

### 6.3 AI director

**Placements:**

| tag / group | unit | count | at | stance |
|---|---|---|---|---|
| group `yard` | `militia_cell` | 1 | `[14,26]` | `garrison`, `building:[14,26]` (pump house) |
| group `yard` | `rpg_team` | 1 | `[18,28]` | `ambush(4)` |
| `da_watch_gap` | `rpg_team` | 1 | `[18,11]` | `ambush(4)` — pre-identified/forfeited if DA I found it |
| group `hamlet` | `militia_cell` | 1 | `[19,21]` | `garrison`, `building:[19,21]` |
| group `hamlet` | `militia_cell` | 1 | `[31,20]` | `garrison`, `building:[31,20]` |
| group `hamlet` | `mortar_crew` | 1 | `[28,17]` | `hold_position` (spoil field, elevation 4) |
| `da_hvt_engineer` | `digger_crew` | 1 | `[33,22]` | `hold_position` |
| — (`in_tunnel`) | `rpg_team` | 2 | `in_tunnel:"da_tn_pump"` | — (vents at `[20,30]`, in the bed, behind the player) |
| — (`in_tunnel`) | `militia_cell` | 2 | `in_tunnel:"da_tn_yard"` | — (vents at `[33,21]`) |
| — | `technical` | 1 | `[41,20]` | `patrol`, waypoints `[[41,20],[41,32]]` |

**Structures:** `camp`, `[2,2]`, at `[26,34]`.

**Cadence table:**

| t (s) | mechanism | size | from | to | group |
|---|---|---|---|---|---|
| 0 | garrison ×7 + `in_tunnel` ×4 + patrol ×1, structures ×1 | — | (see above) | `[26,34]` | — |
| 110 | wave | 2 `militia_cell` | `gap_west` | `pump_gate` | — |
| any tick, `zone_entered(pump_yard)` | trigger `commit` | group `hamlet` (3) | (see above) | `pump_gate` | `hamlet` |
| ≤240 (from first uncontested hold) | objective clock | — | — | — | `hold_the_yard` |
| ≤240 (deadline) | objective clock | — | — | — | `shut_the_door` |
| 180 | trigger `spawn` | 1 `charge_squad` | — | `hamlet_lane` | — |
| 230 | wave | 1 `rpg_team` + 1 `moto_rpg` | `north_road` | `hamlet_lane` | — |
| any tick, 40% enemy casualties | trigger `withdraw_to` | group `yard` (2) | `[14,26]`/`[18,28]` | `hamlet_north` | `yard` |
| 340 | wave | 2 `militia_cell` | `gap_east` | `ford_centre` | — |

**Pressure curve.** Two primaries share one rectangle and pull against each
other: `hold_for(pump_yard, 240)` pauses on contest, and `collapse(pump_yard,
240)` needs a `yahalom_squad` standing still for 8 unshaken seconds **inside**
the same ground, while `da_tn_pump` is stocked with two `rpg_team` who vent
behind the player at `[20,30]` — not at the one gate he is defending. Two
`yahalom_squad` are the whole flexibility: sending both finishes the charge
fast and leaves the hold thin; sending one works the charge under contest,
which the reset-on-move rule (`sim.ts:4440`) makes equivalent to not working
it. The 340s wave routed at `ford_centre`, four tiles from the `camp`, is the
one moment the answer is behind the player rather than at the objective.

### 6.4 `debrief`

> **victory** · idit — *"The yard is ours and the door under it is shut. He
> built this place so that holding a piece of ground and standing on a door
> were the same act."* (143 chars)

> **defeat** · shai — *"We held the yard for four minutes and left the way in
> open underneath it. Everything we did today we did standing on their
> road."* (128 chars)

### 6.5 Map requirements

All **NEW**, listed in §1.2. This mission uses `da_start`, `pump_yard` (zone),
`pump_gate`, `store_yard` (zone), `gap_west`, `gap_east`, `hamlet_lane`,
`hamlet_north`, `ford_centre`, `north_road`, and the `da_tn_pump`/`da_tn_yard`
routes. **DA-M1 applies to `gap_west`/`gap_east` here** — see §0 item 5 and §9
DA-A4; fixing it before this mission ships closes the map-edge bypass around
`da_watch_gap`.

### 6.6 Twists

| id | twist | classification | ECA row |
|---|---|---|---|
| T-DA4 | The thing you are holding is a door | **expressible today** — `in_tunnel` placements on a route whose mouth is inside the `hold_for` zone, exactly as `beit_sahwan_4_subterranean` uses them | briefing beat 1 |
| T-DA5 | One gate | **expressible today** — it is the map | "Yard held" |
| T-DA6 | They are not coming for the yard — the last wave routed at the ford, not the objective | **expressible today** — a wave `to:` a marker behind the player, plus `enemy.waves[].say` | "Wave 3" |

**All three of DA II's twists are expressible today.**

### 6.7 Passive-player loss

**Primary `shut_the_door` (`collapse`) reaches `failed` at 240s.** A passive
player never charges `da_tn_pump`, so the route stays alive and the objective
fails on the clock; `hold_the_yard` never even starts (`livingIn(pump_yard,0)`
requires a living player unit physically inside the zone). `checkEnd` returns
**DEFEAT**. **`pnpm playtest`'s passive control for `deir_amun_2_foothold`
must read DEFEAT at 240s.**

### 6.8 Copy-ready fragments

```json
{
  "id": "deir_amun_2_foothold",
  "name": "Deir Amun II — Set the Charges",
  "town": "deir_amun",
  "phase": "foothold",
  "target_minutes": 7,
  "map": { "file": "deir_amun", "player_start": [24, 44] },
  "ledger": {
    "requires": ["roster.surviving_units", "intel.marked_positions"],
    "produces": ["roster.surviving_units", "roe.mission_ratings", "campaign.completed_missions"]
  },
  "briefing": "The pump yard is a walled compound with one gate, on the south side, and a route runs up into it. The mouth is inside the wall, so the ground you are being told to hold is a door. Hold the yard for four minutes and bring that route down in the same four minutes. Neither clock waits for the other. It is stocked, and whoever is in it comes up in the wadi bed behind you rather than through your gate. They will do it while your engineers are kneeling on the mouth. Two Yahalom teams, and the charge is eight seconds of standing still that resets the moment they move. Send both and the yard is thin; send one and he works under contest, which is the same as not working. The camp is on the bank four tiles from the centre ford and in plain view of their street. Not everything that comes south is coming for the yard. Hold the gate, put the route down, and keep something between them and the camp.",
  "starting_force": [
    { "unit": "yahalom_squad", "count": 2, "at": [26, 45] },
    { "unit": "yahalom_squad", "count": 1, "at": [22, 45] },
    { "unit": "inf_squad", "count": 3, "at": [24, 46], "from_ledger": true },
    { "unit": "at_team", "count": 1, "at": [28, 46], "from_ledger": true },
    { "unit": "mortar_team", "count": 1, "at": [20, 46], "from_ledger": true },
    { "unit": "apc_eitan", "count": 2, "at": [28, 44] },
    { "unit": "ifv_namer", "count": 1, "at": [30, 45] },
    { "unit": "recon_drone", "count": 1, "at": [24, 43] }
  ],
  "resources": { "logistics_start": 400, "logistics_rate_per_min": 120 },
  "structures": [{ "type": "camp", "at": [26, 34], "size": [2, 2] }],
  "objectives": [
    { "id": "hold_the_yard", "type": "hold_for", "primary": true, "target": "pump_yard", "seconds": 240,
      "text": "Hold the pump yard for four minutes",
      "say": { "speaker": "net", "text": "Pump yard held, four minutes. One gate, and it stayed ours." } },
    { "id": "shut_the_door", "type": "collapse", "primary": true, "target": "pump_yard", "seconds": 240,
      "text": "Collapse the route under the pump yard inside four minutes",
      "say": { "speaker": "shai", "text": "The route under the yard is down. Whatever was still in it is not coming up anywhere." },
      "say_on_fail": { "speaker": "shai", "text": "Four minutes on the charge and the mouth is still open inside the wall. We are holding a yard with a door in the floor of it." } },
    { "id": "take_the_store_yard", "type": "capture", "primary": false, "target": "store_yard", "seconds": 15,
      "text": "Take the store compound and hold it for 15 seconds",
      "say": { "speaker": "net", "text": "Store compound is clear. The east road is watched from our side of it now." } },
    { "id": "kill_the_gap_gun", "type": "eliminate_hvt", "primary": false, "target": "da_watch_gap",
      "text": "Kill the rocket team over the west gap",
      "say": { "speaker": "shai", "text": "The gap is clear. That is one of the two ways through the rock line and it is the one their reinforcements use." } }
  ],
  "roe": { "enabled": true, "flagged_zones": ["hamlet"], "fail_below": 40, "structure_penalty_mult": 1 },
  "enemy": {
    "faction": "ashwar",
    "doctrine_profile": "the network beneath",
    "garrison": [
      { "unit": "militia_cell", "count": 1, "at": [14, 26], "group": "yard", "stance": { "kind": "garrison", "building": [14, 26] } },
      { "unit": "rpg_team", "count": 1, "at": [18, 28], "group": "yard", "stance": { "kind": "ambush", "tiles": 4 } },
      { "unit": "rpg_team", "count": 1, "at": [18, 11], "tag": "da_watch_gap", "stance": { "kind": "ambush", "tiles": 4 } },
      { "unit": "militia_cell", "count": 1, "at": [19, 21], "group": "hamlet", "stance": { "kind": "garrison", "building": [19, 21] } },
      { "unit": "militia_cell", "count": 1, "at": [31, 20], "group": "hamlet", "stance": { "kind": "garrison", "building": [31, 20] } },
      { "unit": "mortar_crew", "count": 1, "at": [28, 17], "group": "hamlet" },
      { "unit": "digger_crew", "count": 1, "at": [33, 22], "tag": "da_hvt_engineer" },
      { "unit": "rpg_team", "count": 2, "at": [20, 30], "in_tunnel": "da_tn_pump" },
      { "unit": "militia_cell", "count": 2, "at": [33, 21], "in_tunnel": "da_tn_yard" },
      { "unit": "technical", "count": 1, "at": [41, 20], "stance": { "kind": "patrol", "waypoints": [[41, 20], [41, 32]] } }
    ],
    "waves": [
      { "at_seconds": 110, "to": "pump_gate", "units": [{ "unit": "militia_cell", "count": 2, "from": "gap_west" }] },
      { "at_seconds": 230, "to": "hamlet_lane", "units": [{ "unit": "rpg_team", "count": 1, "from": "north_road" }, { "unit": "moto_rpg", "count": 1, "from": "north_road" }] },
      { "at_seconds": 340, "to": "ford_centre",
        "units": [{ "unit": "militia_cell", "count": 2, "from": "gap_east" }],
        "say": { "speaker": "idit", "text": "Two sections across the centre ford. They are not going to the yard — they are going to the camp on the bank, and the camp is four tiles from that ford." } }
    ]
  },
  "triggers": [
    { "id": "the_village_comes_down_to_the_yard",
      "on": { "kind": "zone_entered", "zone": "pump_yard" },
      "do": { "kind": "commit", "group": "hamlet", "to": "pump_gate" },
      "say": { "speaker": "idit", "text": "The village is coming down the lane at the yard. There are nine houses up there and not one person in them; every body on that street is a fighter." } },
    { "id": "the_yard_party_falls_back_up_the_lane",
      "on": { "kind": "casualties_pct", "value": 40 },
      "do": { "kind": "withdraw_to", "group": "yard", "to": "hamlet_north" },
      "say": { "speaker": "net", "text": "The yard party is out of the pump house and going north up the lane." } },
    { "id": "a_charge_squad_comes_down_the_lane",
      "on": { "kind": "timer_s", "value": 180 },
      "do": { "kind": "spawn", "units": [{ "unit": "charge_squad", "count": 1, "marker": "hamlet_lane" }] },
      "say": { "speaker": "shai", "text": "Charge squad down the lane. Get the engineers off the mouth or get something between him and them." } }
  ],
  "debrief": {
    "victory": { "speaker": "idit", "text": "The yard is ours and the door under it is shut. He built this place so that holding a piece of ground and standing on a door were the same act." },
    "defeat": { "speaker": "shai", "text": "We held the yard for four minutes and left the way in open underneath it. Everything we did today we did standing on their road." }
  }
}
```

**One authoring slip caught and corrected in place, not shipped.** An earlier
pass of the fragment above carried `"count": 0` on the second `yahalom_squad`
row; `pnpm validate:data` would have refused it outright
(`placement.count.minimum: 1`), and the mission needs two Yahalom teams per
`design.md` §5.5 and `narrative.md` §5.1 in any case. Fixed to `"count": 1`
before this document was finished — recorded here the way `qarn_hadid/
script.md`'s own G-N records its one coordinate correction, so the fix is
traceable rather than silent.

---

## 7. `deir_amun_3_subterranean` — Deir Amun III — All Four

`subterranean` · Captain (the act's promotion lands **after** this mission —
§0.6 in `narrative.md`, §14.2 below) · `deir_amun` · `target_minutes` 7 ·
economy: `logistics_start` 500, `logistics_rate_per_min` 90 (exactly
`beit_sahwan_4_subterranean`'s) · requires `roster.surviving_units,
intel.marked_positions` · produces `roster.surviving_units,
roe.mission_ratings, campaign.completed_missions, intel.marked_positions`.

### 7.1 Flags

| flag | kind | fiction |
|---|---|---|
| `all_four` | primary, `collapse(hamlet, 300s)` — **the one primary that can fail on a clock** | the network's end: not a man, four routes |
| `kill_the_chief` | primary, `eliminate_hvt(da_hvt_engineer)` | the digging chief, on his own spoil |
| `clear_the_ground` | secondary, `destroy_all` | usually falls out of the primary — collapsing a stocked route kills its garrison |
| `screen_out` | secondary, `survive_until(300)` — cannot fail | shared recon shape, carried into this mission |
| `the_village_comes_out_of_its_houses` (trigger) | `zone_entered(hamlet)` → `commit` group `hamlet` → `hamlet_lane` | the village comes out into the lanes between the mouths |
| `he_falls_back_onto_his_own_spoil` (trigger) | `casualties_pct(50)` → `withdraw_to spoil_field_centre`, group `chief` | the last position is made of the objective |
| `a_charge_squad_comes_for_the_engineers` (trigger) | `timer_s(210)` → `spawn` 1 `charge_squad` at `hamlet_north` | homes on its own (kamikaze — §0 item 2) |

### 7.2 ECA rows

| Event Name | IF (`on`) | THEN (`do` / objective / wave) | narrative cue bound | status |
|---|---|---|---|---|
| Mission start | — | title, `briefing` 7 beats | `narrative.md` §6.2, verbatim | live |
| All four routes down | `collapse(hamlet, 300s)` completes | toast + `say` | shai: "All four down. There is nothing under this village any more, and that is the last of the district." | live |
| Clock runs out | `collapse(hamlet, 300s)` fails @300s | toast `OBJECTIVE FAILED —…` + `say_on_fail` — **the only way to lose this mission** | idit: "Five minutes. Whatever is still open under that village is open for good, and there is nobody left who has to be told where it runs." | live |
| Chief killed | `eliminate_hvt(da_hvt_engineer)` completes | toast + `say` | idit: "The chief is down on his own spoil. He was digging to a plan drawn before the war by a man who has not seen this ground in years." | live |
| Ground cleared | `destroy_all` completes | toast + `say` | net: "Nothing of theirs is standing above ground in Deir Amun." | live |
| Five minutes screened | `survive_until(300)` completes | toast | shipped shape, no `say` | live |
| Wave 1 | `at_seconds:120`, `from:"gap_east"`, `to:"hamlet_north"`, 2 `militia_cell` | toast only, no `say` | — | live |
| Wave 2 | `at_seconds:250`, `from:"gap_west"`, `to:"hamlet_lane"`, 1 `rpg_team`+1 `technical` | toast + `say` — **no third wave**, deliberately | idit: "One rocket team and a technical through the west gap. That is the last of what the plateau can send; after this he is spending what is underground." | live |
| Village comes out of its houses | `on:{kind:"zone_entered",zone:"hamlet"}` | `do:{kind:"commit",group:"hamlet",to:"hamlet_lane"}` + `say` | net: "They are out of the houses and into the lanes between the mouths." | live |
| He falls back onto his own spoil | `on:{kind:"casualties_pct",value:50}` | `do:{kind:"withdraw_to",group:"chief",to:"spoil_field_centre"}` + `say` | idit: "He has gone back onto the spoil field. It is the only high ground on this map and his own crews built it out of the routes you are here to bring down." | live |
| Charge squad for the engineers | `on:{kind:"timer_s",value:210}` | `do:{kind:"spawn",units:[{unit:"charge_squad",count:1,marker:"hamlet_north"}]}` + `say` | shai: "Charge squad in the lanes, and your engineers are the only thing on this map that has to stand still. Cover them or move them." | live |
| Any of the four stocked routes vents | `SimEvent surfaced` | no `on.kind` watches a `SimEvent` | shai's line exists in prose only — the mission's signature event, silent four separate times (T-DA3; §13 **G-A**) | engine |
| `tunnelContact` at `identified`/`lost` | `SimEvent tunnelContact` | same gap | idit's line (identified) and `eva` "Contact lost." both exist in prose only | engine |
| `tunnelCollapsed`, each of the four | `SimEvent tunnelCollapsed` | same gap | `eva` "Route collapsed." — already in the campaign's shipped set (`beit_sahwan/narrative.md` §8) but still unreachable without the trigger kind | engine |
| Camp builds a squad | `built` | raw unit id | §13 **G-C** | engine |
| Mission ends | victory / defeat | `debrief` | idit (victory) / shai (defeat), §7.4 | live |
| `missionEnd(victory)` | — | `aftermath` | §7.5 — **blocked** on §14.2 landing in the same commit | live (field), blocked (content) |

**Row count: 13 live, 0 schema, 4 engine.**

### 7.3 AI director

**Placements:**

| tag / group | unit | count | at | stance |
|---|---|---|---|---|
| `da_hvt_engineer`, group `chief` | `digger_crew` | 1 | `[28,17]` | `hold_position` (spoil field, elevation 4) |
| group `chief` | `militia_cell` | 1 | `[26,18]` | `hold_position` |
| group `chief` | `militia_cell` | 1 | `[31,18]` | `hold_position` |
| group `hamlet` | `militia_cell` | 1 | `[19,21]` | `garrison`, `building:[19,21]` |
| group `hamlet` | `militia_cell` | 1 | `[26,20]` | `garrison`, `building:[26,20]` |
| group `hamlet` | `rpg_team` | 1 | `[24,22]` | `ambush(3)` |
| group `hamlet` | `rpg_team` | 1 | `[33,24]` | `ambush(3)` |
| — (`in_tunnel`) | `rpg_team` | 2 | `in_tunnel:"da_tn_lane"` | — (vents at `[27,18]`) |
| — (`in_tunnel`) | `militia_cell` | 2 | `in_tunnel:"da_tn_yard"` | — (vents at `[33,21]`) |
| — (`in_tunnel`) | `rpg_team` | 1 | `in_tunnel:"da_tn_north"` | — (vents at `[34,13]`) |
| — (`in_tunnel`) | `militia_cell` | 1 | `in_tunnel:"da_tn_north"` | — (same route, second placement) |
| — (`in_tunnel`) | `militia_cell` | 2 | `in_tunnel:"da_tn_east"` | — (vents at `[41,19]`, on the player's own east road) |
| — | `charge_squad` | 1 | `[28,20]` | `ambush(2)` |
| — | `mortar_crew` | 1 | `[24,2]` | `hold_position` |
| — | `atgm_cell` | 1 | `[41,14]` | `ambush(6)` |

**Cadence table:**

| t (s) | mechanism | size | from | to | group |
|---|---|---|---|---|---|
| 0 | garrison ×7 + `in_tunnel` ×8 | — | (see above) | — | — |
| 120 | wave | 2 `militia_cell` | `gap_east` | `hamlet_north` | — |
| any tick, `zone_entered(hamlet)` | trigger `commit` | group `hamlet` (4) | (see above) | `hamlet_lane` | `hamlet` |
| 210 | trigger `spawn` | 1 `charge_squad` | — | `hamlet_north` | — |
| 250 | wave | 1 `rpg_team` + 1 `technical` | `gap_west` | `hamlet_lane` | — |
| any tick, 50% enemy casualties | trigger `withdraw_to` | group `chief` (3) | (see above) | `spoil_field_centre` | `chief` |
| ≤300 (deadline) | objective clock | — | — | — | `all_four` |
| 300 | objective clock | — | — | — | `screen_out` |

**Pressure curve.** Four `pre_dug` mouths (`[20,23]`, `[25,26]`, `[30,22]`,
`[33,25]`) spread across a nine-building village with one-tile lanes, against
two `yahalom_squad` and one `recon_drone` — none of the mouths stamps trail, so
a clear `losRay` from a `mark_tunnel` carrier is the only channel
(`markerSeesRoute`, `sim.ts:2809`), and contact decays back to unknown roughly
16 seconds after the last eye leaves (`design.md`'s own measurement, ~322
ticks). `collapseTunnel` kills whoever is stocked in the route it brings down
(`sim.ts:4578`), so the order the player charges them in decides which groups
get to vent behind him and which never surface — the two lane-mouth routes
(`da_tn_lane`, `da_tn_north`) are cheap to find but sit under the two
`ambush(3)` rocket teams' watch; the two yard-mouth routes (`da_tn_yard`,
`da_tn_east`) need a walk into a courtyard for a line. There is deliberately no
third wave (`design.md` §5.6): the pressure from 250s on is the four clocks and
the venting, not another attacking body.

### 7.4 `debrief`

> **victory** · idit — *"All four, and the file on this district closes
> tonight. Taking the man never stopped any of it — the ground was the thing
> he was, and there is none of it left under here now."* (174 chars)

> **defeat** · shai — *"The village is standing on four open routes and we are
> going home. This district works tomorrow exactly the way it worked
> yesterday."* (132 chars)

### 7.5 `aftermath` — Act I closes here, blocked on one paired edit

> *"Six routes under the junction, and by morning none of them went anywhere.
> Brigade put a third star on the slip and said nothing else about it. The
> Marj is quiet. Sur is not."* (173 chars)

**This string must not land until `beit_sahwan_4_subterranean.json`'s own
`aftermath` gives up its third-star sentence in the same commit** —
`narrative.md` §0.6 decision 2 and §14.2, restated here because it is the one
cross-file dependency this arc's own commit cannot resolve alone (`design.md`
C4, `narrative.md` §13 **G-G**). Landing this `aftermath` without that edit
promotes Shai to Major, plays him as a Captain for six missions, and promotes
him again — a defect the campaign board and the commander bar would both
show. The exact replacement text for `beit_sahwan_4_subterranean.json` is
quoted in full in `narrative.md` §14.2 (202 chars, verified under the cap) and
is not repeated here since this document may not edit that file.

### 7.6 Map requirements

All **NEW**, listed in §1.2. This mission uses `da_start`, `hamlet` (zone),
`hamlet_lane`, `hamlet_north`, `gap_east`, `gap_west`, `spoil_field_centre`,
and all four `pre_dug` routes (`da_tn_lane`, `da_tn_yard`, `da_tn_north`,
`da_tn_east`). §0 item 6's `x=25` lane note is adjacent to `da_tn_yard`'s
mouth but does not block it (confirmed open, §9 DA-A1).

### 7.7 Twists

| id | twist | classification | ECA row |
|---|---|---|---|
| T-DA7 | Everything you know goes cold behind you | **expressible today** only as a briefing statement — the runtime already emits `tunnelContact` at `lost`, but a mission trigger cannot fire on a `SimEvent` (§13 **G-A**), so the honest version is said once, up front | briefing beat 2 |
| T-DA8 | The last one is under your own road — `da_tn_east` vents on the east road the player's armour uses | **expressible today** — it is the map | briefing beat 4 |
| T-DA9 | He is standing on it — the chief falls back onto the one raised ground his own crews built | **expressible today** — `casualties_pct(50) → withdraw_to`. Re-run `pnpm playtest` after it lands (same `withdraw_to` caveat as T-KR8) | "He falls back onto his own spoil" |
| T-DA10 | The road east — the act's close | **expressible today** — `aftermath` is live | §7.5 |

**All four of DA III's twists are expressible today** (T-DA7's mechanical
form is engine work; its briefing form ships regardless).

### 7.8 Passive-player loss

**Primary `all_four` (`collapse`) reaches `failed` at 300s.** A passive player
never brings a `mark_tunnel` carrier within sight-and-`losRay` of any of the
four mouths, so no route is ever identified and none is ever charged;
`tnAlive` stays 1 for all four and the objective fails on the clock.
`checkEnd` returns **DEFEAT**. `kill_the_chief` also never completes on a
passive run, but the clock-failing primary is what ends the mission first.
**`pnpm playtest`'s passive control for `deir_amun_3_subterranean` must read
DEFEAT at 300s.**

### 7.9 Copy-ready fragments

```json
{
  "id": "deir_amun_3_subterranean",
  "name": "Deir Amun III — All Four",
  "town": "deir_amun",
  "phase": "subterranean",
  "target_minutes": 7,
  "map": { "file": "deir_amun", "player_start": [24, 44] },
  "ledger": {
    "requires": ["roster.surviving_units", "intel.marked_positions"],
    "produces": ["roster.surviving_units", "roe.mission_ratings", "campaign.completed_missions", "intel.marked_positions"]
  },
  "briefing": "There are four routes under this village and every one was finished before the war, so none of them throws spoil. The only thing that can find them is a man with a detector and a clear line to the ground they run under. You cannot hold all four at once. Contact goes cold about sixteen seconds after the last eye leaves it, and the drone is a pointer rather than a scout, blind behind a building exactly like a rifleman. Work them in an order and mean it. Bringing one down kills whoever is stocked in it, so what you drop first decides which of the rest comes up behind you. One of them surfaces on your own road east. Whatever you leave standing there is standing under your armour. The chief is on the spoil field north of the village, a level above everything around it, on ground his own crews raised. He does not go underground and he will not leave it. The Lavi's gun and the mortar are billed by the ten seconds in that village and there is nothing in it worth the money. Rifles and the Eitan's fifty are free. Bring all four down inside five minutes, and take the chief off that spoil.",
  "starting_force": [
    { "unit": "yahalom_squad", "count": 2, "at": [26, 45] },
    { "unit": "inf_squad", "count": 4, "at": [24, 46], "from_ledger": true },
    { "unit": "at_team", "count": 1, "at": [28, 46], "from_ledger": true },
    { "unit": "mortar_team", "count": 1, "at": [20, 46], "from_ledger": true },
    { "unit": "apc_eitan", "count": 2, "at": [28, 44] },
    { "unit": "ifv_namer", "count": 1, "at": [30, 45] },
    { "unit": "mbt_lavi", "count": 1, "at": [24, 45] },
    { "unit": "recon_drone", "count": 1, "at": [24, 43] }
  ],
  "resources": { "logistics_start": 500, "logistics_rate_per_min": 90 },
  "objectives": [
    { "id": "all_four", "type": "collapse", "primary": true, "target": "hamlet", "seconds": 300,
      "text": "Collapse all four routes under the village inside five minutes",
      "say": { "speaker": "shai", "text": "All four down. There is nothing under this village any more, and that is the last of the district." },
      "say_on_fail": { "speaker": "idit", "text": "Five minutes. Whatever is still open under that village is open for good, and there is nobody left who has to be told where it runs." } },
    { "id": "kill_the_chief", "type": "eliminate_hvt", "primary": true, "target": "da_hvt_engineer",
      "text": "Kill the digging chief on the spoil field",
      "say": { "speaker": "idit", "text": "The chief is down on his own spoil. He was digging to a plan drawn before the war by a man who has not seen this ground in years." } },
    { "id": "clear_the_ground", "type": "destroy_all", "primary": false,
      "text": "Clear everything Ashwar still has above ground here",
      "say": { "speaker": "net", "text": "Nothing of theirs is standing above ground in Deir Amun." } },
    { "id": "screen_out", "type": "survive_until", "primary": false, "seconds": 300,
      "text": "Stay in the field for five minutes" }
  ],
  "roe": { "enabled": true, "flagged_zones": ["hamlet"], "fail_below": 45, "structure_penalty_mult": 1 },
  "enemy": {
    "faction": "ashwar",
    "doctrine_profile": "the network beneath",
    "garrison": [
      { "unit": "digger_crew", "count": 1, "at": [28, 17], "tag": "da_hvt_engineer", "group": "chief" },
      { "unit": "militia_cell", "count": 1, "at": [26, 18], "group": "chief" },
      { "unit": "militia_cell", "count": 1, "at": [31, 18], "group": "chief" },
      { "unit": "militia_cell", "count": 1, "at": [19, 21], "group": "hamlet", "stance": { "kind": "garrison", "building": [19, 21] } },
      { "unit": "militia_cell", "count": 1, "at": [26, 20], "group": "hamlet", "stance": { "kind": "garrison", "building": [26, 20] } },
      { "unit": "rpg_team", "count": 1, "at": [24, 22], "group": "hamlet", "stance": { "kind": "ambush", "tiles": 3 } },
      { "unit": "rpg_team", "count": 1, "at": [33, 24], "group": "hamlet", "stance": { "kind": "ambush", "tiles": 3 } },
      { "unit": "rpg_team", "count": 2, "at": [27, 18], "in_tunnel": "da_tn_lane" },
      { "unit": "militia_cell", "count": 2, "at": [33, 21], "in_tunnel": "da_tn_yard" },
      { "unit": "rpg_team", "count": 1, "at": [34, 13], "in_tunnel": "da_tn_north" },
      { "unit": "militia_cell", "count": 1, "at": [34, 13], "in_tunnel": "da_tn_north" },
      { "unit": "militia_cell", "count": 2, "at": [41, 19], "in_tunnel": "da_tn_east" },
      { "unit": "charge_squad", "count": 1, "at": [28, 20], "stance": { "kind": "ambush", "tiles": 2 } },
      { "unit": "mortar_crew", "count": 1, "at": [24, 2] },
      { "unit": "atgm_cell", "count": 1, "at": [41, 14], "stance": { "kind": "ambush", "tiles": 6 } }
    ],
    "waves": [
      { "at_seconds": 120, "to": "hamlet_north", "units": [{ "unit": "militia_cell", "count": 2, "from": "gap_east" }] },
      { "at_seconds": 250, "to": "hamlet_lane",
        "units": [{ "unit": "rpg_team", "count": 1, "from": "gap_west" }, { "unit": "technical", "count": 1, "from": "gap_west" }],
        "say": { "speaker": "idit", "text": "One rocket team and a technical through the west gap. That is the last of what the plateau can send; after this he is spending what is underground." } }
    ]
  },
  "triggers": [
    { "id": "the_village_comes_out_of_its_houses",
      "on": { "kind": "zone_entered", "zone": "hamlet" },
      "do": { "kind": "commit", "group": "hamlet", "to": "hamlet_lane" },
      "say": { "speaker": "net", "text": "They are out of the houses and into the lanes between the mouths." } },
    { "id": "he_falls_back_onto_his_own_spoil",
      "on": { "kind": "casualties_pct", "value": 50 },
      "do": { "kind": "withdraw_to", "group": "chief", "to": "spoil_field_centre" },
      "say": { "speaker": "idit", "text": "He has gone back onto the spoil field. It is the only high ground on this map and his own crews built it out of the routes you are here to bring down." } },
    { "id": "a_charge_squad_comes_for_the_engineers",
      "on": { "kind": "timer_s", "value": 210 },
      "do": { "kind": "spawn", "units": [{ "unit": "charge_squad", "count": 1, "marker": "hamlet_north" }] },
      "say": { "speaker": "shai", "text": "Charge squad in the lanes, and your engineers are the only thing on this map that has to stand still. Cover them or move them." } }
  ],
  "debrief": {
    "victory": { "speaker": "idit", "text": "All four, and the file on this district closes tonight. Taking the man never stopped any of it — the ground was the thing he was, and there is none of it left under here now." },
    "defeat": { "speaker": "shai", "text": "The village is standing on four open routes and we are going home. This district works tomorrow exactly the way it worked yesterday." }
  },
  "aftermath": "Six routes under the junction, and by morning none of them went anywhere. Brigade put a third star on the slip and said nothing else about it. The Marj is quiet. Sur is not."
}
```

**`aftermath` is written here for completeness and must not be applied until
§7.5's paired edit lands** (`data/campaign/commander.json`'s Captain
`until_mission` → `deir_amun_3_subterranean`, and
`beit_sahwan_4_subterranean.json`'s own `aftermath` replaced per
`narrative.md` §14.2, in the same commit as these six mission files).

---

## 8. Twist tally, across all six missions

| # | mission | twist | classification |
|---|---|---|---|
| T-KR1 | KR I | The patrol walks through the ward on a loop | expressible today |
| T-KR2 | KR I | The road is the trap (ATGM on a coverless street) | expressible today |
| T-KR3 | KR I | They were never going to stay — the un-reached are walked off | expressible today |
| T-KR4 | KR II | He comes to the one place you will not shoot | expressible today |
| T-KR5 | KR II | The block above the lane | **split** — placement live; its own line is engine work |
| T-KR6 | KR II | One of them runs the wrong way | **split** — placement live; its own line is engine work (`CivilianFlight` emits no `MissionEvent`); `playtest` also judges tone |
| T-KR7 | KR III | You are not allowed to kill him | expressible today |
| T-KR8 | KR III | He gives the ward back and takes the souk | expressible today |
| T-KR9 | KR III | His round kills them and your score does not move | **split** — placement live; the bound literal line is engine work |
| T-KR10 | KR III | The house numbers, read back | expressible today |
| T-DA1 | DA I | He is still digging | expressible today |
| T-DA2 | DA I | The dirt is the intelligence | expressible today |
| T-DA3 | DA I / DA III | Behind you, out of the spoil | expressible today (placement); the vent's own line is engine work |
| T-DA4 | DA II | The thing you are holding is a door | expressible today |
| T-DA5 | DA II | One gate | expressible today |
| T-DA6 | DA II | They are not coming for the yard | expressible today |
| T-DA7 | DA III | Everything you know goes cold behind you | expressible today (briefing); the per-event form is engine work |
| T-DA8 | DA III | The last one is under your own road | expressible today |
| T-DA9 | DA III | He is standing on it | expressible today |
| T-DA10 | DA III | The road east — the act's close | expressible today |

**16 of 20 fully expressible today with zero schema or engine work.** Four
are **split** — a live placement plus an engine-blocked bound line (T-KR5,
T-KR6, T-KR9, T-DA3). One more, T-DA7, is **fully expressible today in the
form it actually ships**: the honest version is a briefing statement said
once, and that is what `narrative.md` counts as `live` for it; a stronger
per-event form is recorded alongside it as the reason it is not asked to do
more. **Zero twists in this arc need a new schema field** — matching
`narrative.md` §0.3's "`schema` is 0 in this arc" finding exactly. Every
engine gap among the four split twists traces to one thing: `sim-guard`'s
`on.kind` for a `SimEvent`/objective (§10 **G-A**); T-KR9 additionally needs
the inability to author where an enemy round lands closed (§10 **G-F**).

---

## 9. Doctrine-test assertion tables

**Method.** All numbers below were driven through the real engine this
session — `parseMap`, `Sim`, `applyTerrain`, `FlowField.compute` and
`sim.debugDetection` — on the exact grids in §1, following
`tools/src/qarn_hadid_relief.test.ts`'s own pattern: every positive is paired
against a control built from the same map with one thing removed. Two calls
needed `(sim as any)` to reach `losRay` and `tunnelUnderTile`, both private on
`Sim`; the real doctrine tests should do the same, matching how
`tel_marum_doctrine.test.ts`'s `sees()` helper already reaches private state
through `debugDetection`. **These figures supersede `design.md`'s own draft
BFS numbers wherever they differ** — a BFS counts tiles, `FlowField` prices
diagonal moves and slope, and Deir Amun's elevation grid means the two
disagree on nearly every DA route.

### 9.1 `tools/src/khan_rafid_doctrine.test.ts`

| # | claim | measured | source |
|---|---|---|---|
| KR-A1 | `kr_start[24,45]` → `souk_alley[24,11]`, foot, through the ward vs. both ward gates shut | **34** vs **40** (through-ward strictly cheaper) | measured this session; supersedes `design.md`'s draft 34/38 |
| KR-A2 | Blocking `[24,20]`, `[13,16]` or `[33,16]` individually still leaves a finite route `kr_start`→`souk_alley` | all three: **34** (unchanged — none of the three sits on the through-ward corridor) | measured |
| KR-A3 | Every authored civilian spawn walks to `civ_refuge[24,22]` in ≤14 tiles | KR I `[20,16]`→10, `[27,16]`→9; KR II `[16,16]`→14, `[31,16]`→13, `[23,27]`→5; KR III `[16,16]`→14, `[20,16]`→10, `[31,16]`→13, `[30,27]`→8 | measured; all ≤14, supersedes `design.md`'s drafts |
| KR-A4 | `civ_refuge[24,22]` lies inside zone `ward[20,17,9,7]` | **true** by tile arithmetic (`20≤24<29`, `17≤22<24`) — the same check `MissionRuntime.start()` throws on (`mission.ts:748`) | confirmed |
| KR-A5 | An observer in the souk sees into the ward over the (`low_profile`) wall | `[24,16]` sees `[24,20]` (open ward corridor): **true**; `[24,16]` sees `[22,19]` (behind the clinic building): **false** — the wall itself never blocks either ray; the clinic's own footprint does, which is the expected obstruction | measured (`sees()`, sight 9, 12s of ticks) |
| KR-A6 | Zone `ward` contains exactly 2 structures (1 `clinic`, 1 `hall`); zone `souk` contains no `hall` | confirmed: `clinic` 12 tiles (bbox `[21,18]-[23,21]`), `hall` 9 tiles (bbox `[26,18]-[28,20]`), both single 4-connected blobs; `souk[19,6,11,10]` and the hall's bbox share no rows | flood-fill this session |
| KR-A7 | Every `capture`/`hold_for` zone has ≥12 tiles passable to both domains | `ward` 26, `souk` 46, `market` 31, `store` 16 — all comfortably clear | direct count |
| **KR-M1** *(new)* | The east/west ward "gates" `[19,20]`/`[29,20]` connect to the exterior | **false** — both are reachable only from the compound's own interior (their one open neighbour is a corner-cut diagonal); confirmed by tracing `FlowField.dirs` from each back toward `[24,22]`, which routes via the south gate instead | measured; recorded in §0, does not affect any assertion above |

### 9.2 `tools/src/deir_amun_doctrine.test.ts`

| # | claim | measured | source |
|---|---|---|---|
| **DA-A1** — the one that makes the mission winnable at all | Every one of the six routes has ≥1 open tile it runs under, reachable with a clear `losRay` from some open tile within 8 | **all six** watchable: `da_tn_west` from `[9,13]`, `da_tn_pump` from `[16,25]`, `da_tn_lane` from `[22,11]`, `da_tn_yard` from `[25,16]`, `da_tn_north` from `[33,5]`, `da_tn_east` from `[42,12]` | measured this session via `tunnelUnderTile` + `losRay`, before any map file is committed, as required |
| DA-A2 | Vehicle route to `da_west_head[7,17]` is ≥8 tiles longer than the foot route; both finite | foot **27**, vehicle **44** (Δ17) | measured; supersedes `design.md`'s draft 27/37 |
| DA-A3 | Terrace `[24,26]` does not see bed `[24,31]`; lip `[24,29]` does; a flattened control sees from the terrace too | terrace→bed: **false**; lip→bed: **true**; flattened terrace→bed: **true** | measured, all three legs |
| DA-A4 | `recon_drone` (foot field) reaches `north_road[24,4]` from `da_start`; unreachable with the rock line fully closed | with the named gaps open: **40** tiles; with the **whole row** blocked: **unreachable**; with **only the two named gaps** filled and the map edges left open: **59** tiles via `[2,10]` (**DA-M1**, §0 item 5) | measured; the substantive claim holds, the exclusivity claim does not until DA-M1's fix lands |
| DA-A5 | Zone `hamlet` contains exactly 4 tunnel mouths; `pump_yard` and `da_west` exactly 1 each; the three zones disjoint | confirmed: `hamlet`→`da_tn_lane,da_tn_yard,da_tn_north,da_tn_east`; `pump_yard`→`da_tn_pump`; `da_west`→`da_tn_west`; no rectangle overlap | measured |
| DA-A6 | Blocking `ford_centre` leaves a finite vehicle route `da_start`→`hamlet_lane` | **30** tiles (via `ford_west`/`ford_east`) | measured |
| DA-A7 | `pump_yard`, `store_yard`, `hamlet` each clear KR-A7's ≥12-tile floor | `pump_yard` **14** (DA-M2, not design's stated 16), `store_yard` 20, `hamlet` 80 | measured/corrected |

### 9.3 What neither test must assert

Per `design.md` §5.5.4/§3.2's own caveat: do not pin a number that changes once
a `withdraw_to` twist (T-KR8, T-DA9) is `playtest`-tuned, or once
`structure_penalty_mult`/`fail_below` fall back per §4.7. Both doctrine tests
are scoped to **sight, route and tunnel-visibility** facts, exactly as
`design.md` names them.

---

## 10. Master gap report

`design.md`'s C1–C10 and G1–G9 and `narrative.md`'s G-A…G-L are restated here
briefly, deduplicated, with the three map findings from §0/§9 folded in.

| # | gap | owner | smallest fix | status |
|---|---|---|---|---|
| **G-A** | A trigger cannot fire on a `SimEvent` or an objective completing. Silences: every `in_tunnel` vent (5 rows across DA I/II/III), `tunnelContact` going cold (DA III's own briefing subject), the drone dying, the ATGM firing down Main Street, a `yahalom_squad` dying mid-charge, the first ROE deduction inside `ward`, T-KR5's and T-KR6's lines | `sim-guard` | new `on.kind`s (`sim`, `objective`); the tutorial's `await` already gates on every `SimEvent`, so the predicate is reused (`narrative.md` §13 G-A) | open |
| **G-B** | A civilian reaching the refuge is silent (`describeMissionEvent` has no `evacuated` case, `main.ts:267`) — bites all three KR missions, which score on 2/4/6 civilians across the same zone | `render-vfx` | one `case 'evacuated'` returning a toast | open, Act I's own recorded gap, still open |
| **G-C** | `built` prints a raw unit id (`reinforcement deployed — inf_squad`) — fires repeatedly in the four economy missions | `render-vfx` | look the display name up from the unit JSON | open |
| **G-D** | ~~radio overlay does not exist~~ — **closed since 2026-09-07.** `hud.ts` paints the `say` speaker's portrait and plate; every `say` row above reaches the player with a face. Remaining: a dedicated frame/hold and voice audio | `render-vfx` | none blocking | mostly closed |
| **G-E** | A briefing cannot branch on the ledger — KR III's picture genuinely differs by what KR I found, DA II's by what DA I found. Both use the rule-not-state fallback (KR III beat 3, matching `qarn_hadid_3_clearance`'s own shipped solution) | `sim-guard` + `render-vfx` | `briefing_variants`: `{requires_ledger, briefing}[]`, falling back to `briefing` | open, fallback already authored |
| **G-F** | No `do` kind chooses where an enemy round lands, so T-KR9's literal bound form is unbuildable; delivered as a placement (a family on the `charge_squad`'s run) plus an advance-warning trigger line | `sim-guard` | out of scope; `stepRoe` already bills only a player-attributed `destroyed`, it just cannot be pointed at | open |
| **G-G** | The third star is awarded twice unless `commander.json`'s Captain `until_mission` moves to `deir_amun_3_subterranean` **and** `beit_sahwan_4_subterranean.json`'s `aftermath` gives up its own promotion line, in the same commit as the six mission files (`design.md` C4, `narrative.md` §14.2) | `mission-author` + the lead | one line in `commander.json`, one string in `beit_sahwan_4_subterranean.json` | **must land with this arc's first commit** |
| **G-H** | `hall`, `clinic` and `camp` have no sprite sheet — this arc is the first to make an invisible building (`kill_the_block_commander`'s label names the hall) the subject of an objective on `?renderer=pixi`/`&nomesh` | `blender-art` + `render-vfx` | three sheets through `pnpm validate:assets` | open, `design.md` O-KR8 — not blocking this commit |
| **G-I** | `pnpm validate:audio`'s `KNOWN_EVENTS` cannot accept a voice file, so the arc's one EVA delta ("Contact lost.") is blocked on the gate widening first | `content-validator` | a non-weapon set kind and its events | open, GH-110 |
| **G-J** | `world.schema.json` has no `planned` property — `khan_rafid`/`deir_amun` already sit in `world.json` with empty mission arrays, which is exactly the "leads nowhere" state that gap describes until this commit lands | `sim-guard` + `app` | `planned: true`, excluded from `regionProgress`; **or**, cheaper — land the six mission files and `world.json`'s two arrays in the same commit, which resolves it without a schema edit | procedural — `mission-author`'s sequencing |
| **G-K** *(closed)* | `validate_data.mjs` did not check a `capture`/`hold_for` zone for a standable tile | — | **closed** — the check landed exactly as `design.md` §7 G9 proposed; this arc's five such zones (`souk`, `market`, `store`, `pump_yard`, `store_yard`) all clear the floor per §9 KR-A7/DA-A7 | closed, do not re-open |
| **G-L** *(recorded)* | A route collapsed in DA I/DA II stands again in DA III (every map tunnel is registered for every mission on that map). Harmless — unstocked, no digger, no objective names it. Mitigated textually: DA III's briefing says "four routes under this village" rather than "four left of six" | recorded | `map-variants-design.md` §3 forbids the zero-engine fix (a shorter `tunnels` array breaks positional indices) | leave it, per `design.md` O-KR9 |
| **KR-M1** *(new, §0/§9)* | The ward's east/west gate notches do not connect to the exterior; only sight passes through them, not movement | `mission-author` (map), or accept as fiction | open one more tile beside either notch, or read "four gates" as "two gates, two sight-slits" in `narrative.md` §2.2 beat 1 | recorded, non-blocking |
| **DA-M1** *(new, §0/§9)* | The rock line's map edges (`x0–2`, `x46–47`, `y8–10`) are an unintended third/fourth crossing, bypassing `da_watch_gap`'s `ambush(4)` entirely for both DA I and DA II | `mission-author` (map) | extend both flanking spines to the map edge — 15+9 tiles of `^`, no marker collision | **fix before the map ships** |
| **DA-M2** *(new, §0/§9)* | `design.md`'s own prose overstates `pump_yard`'s open-tile count (16 claimed, 14 on the grid) | recorded | none needed — still clears the ≥12 floor | non-blocking |

---

## 11. Verification

**Schema field names**, grepped against `data/schemas/mission.schema.json` and
`data/schemas/map.schema.json` this session: `id/name/town/phase/
target_minutes/briefing/dispatch/aftermath/debrief.{victory,defeat}/map.
{file,player_start}/ledger.{requires,produces}/starting_force[].
{unit,count,at,from_ledger}/resources.{logistics_start,
logistics_rate_per_min}/structures[].{type,at,size}/objectives[].
{id,type,primary,text,target,count,seconds,say,say_on_fail}/roe.
{enabled,flagged_zones,fail_below,structure_penalty_mult}/civilians.
{groups,refuge}/enemy.{faction,doctrine_profile,garrison,waves}` (**`garrison`,
singular — the campaign brief's "`enemy.garrisons`" does not exist**) `/
enemy.waves[].{at_seconds,to,units[].{unit,count,from},say}/triggers[].
{id,on{kind,value,zone},do{kind,group,to,units},say}/$defs/placement.
{unit,count,at,marker,group,tag,in_tunnel,digs,stance}` — `stance.kind` enum
`hold_position|ambush|patrol|garrison` all four used, `ambush.tiles`,
`patrol.waypoints`, `garrison.building` all used. `objectives[].type` used
across the arc: `locate, evacuate_before, hold_for, capture, eliminate_hvt,
collapse, destroy_all, survive_until` — **8 of the 9 live types** (`raze` is
the one not needed — Deir Amun's ROE pressure is `flagged_zones` alone, per
`design.md`'s own "there is nothing left to keep" framing); `mark`, `escort`,
`no_collateral_above` (the three the runtime throws on) are **not used
anywhere in this document**. `triggers[].on.kind` used: `zone_entered,
casualties_pct, timer_s, first_contact` — all four. `triggers[].do.kind` used:
`commit, withdraw_to, spawn, remove` (`reinforce, dismount` not needed
anywhere in this arc). `threshold` and `unlocks_phase` exist on `objectives[]`
and are **deliberately not used**, per CLAUDE.md's restriction on
`unlocks_phase`-style fields nothing reads.

**Unit ids**, confirmed present under `data/units/kdf/` and `data/units/
enemy/` this session: `inf_squad, at_team, mortar_team, yahalom_squad,
sniper_team, recon_drone, jeep_shoded, apc_eitan, ifv_namer, mbt_lavi` (KDF);
`militia_cell, rpg_team, mortar_crew, digger_crew, charge_squad, atgm_cell,
technical, moto_rpg, loiter_drone` (enemy); `civilians` at
`data/units/civilians.json`. `data/structures.json` confirms every symbol used
(`h,s,a,w,#,=,k,m`) and every cited `roe_penalty`/`garrison_slots`/
`hp_per_tile`/`low_profile` value (§0 item 5, `design.md` §3.1). No
`demo_squad` or `dozer_d9` appears anywhere in this document, per `design.md`
§5's hard rule and the `stepDemolition` automatic-branch hazard it is written
against (`sim.ts:4336`).

**Marker/zone discipline.** Every `to`/`from` above names a marker, never a
zone, checked line by line against §1.1/§1.2's marker dictionaries. Every
`capture`/`hold_for`/`evacuate_before` target names a zone from §1.1/§1.2.
Every `evacuate_before` refuge (`civ_refuge`, used in all three KR missions)
sits inside its target zone (`ward`), confirmed by tile arithmetic against
`MissionRuntime.start()`'s own throw condition (`mission.ts:745-756`). Every
`collapse` target names a zone containing at least one tunnel mouth
(`mission.ts:775-793`), confirmed for `da_west` (1), `pump_yard` (1) and
`hamlet` (4) in §9 DA-A5. Every `group` a trigger addresses is declared on a
placement in the same mission (`ward_party`, `ward_push`, `hall_party`,
`souk`, `store`, `da_diggers`, `yard`, `hamlet`, `chief` — each checked against
its own mission's `enemy.garrison`). Every `remove` (KR I's `families`) names a
declared `civilians.groups` entry, disjoint from `starting_force` entirely —
`validate_data.mjs`'s refusal of a `remove` covering the whole `starting_force`
does not apply. Every `say.text` above is ≤240 characters with a legal speaker
(`shai|idit|net`) — transcribed verbatim from `narrative.md`, which already
length-checked all 138 of its own quoted strings; **no `enemy`-spoken line is
authored anywhere in this document**, matching `narrative.md` §0.3/§8's finding
that Nadir Sahim does not speak in this arc (the one written and HELD line in
`narrative.md` §8 is not reproduced here).

**No trigger depends on firing twice** — `stepTriggers`'s `firedTriggers`
array is indexed per trigger regardless of `on.kind`, and every trigger above
has a distinct condition object. **No wave depends on a tunnel `from`** —
every wave `from` above is a map marker, and Khan Rafid's map declares no
`tunnels` block at all; Deir Amun's six routes are claimed by `collapse`
objectives and stocked by `in_tunnel` placements, never by a wave.

**One typo caught and corrected in place, not shipped**: an earlier pass of
§6.8's `deir_amun_2_foothold` `starting_force` carried `"count": 0` on the
second `yahalom_squad` row; the fragment above reads `"count": 1`, matching
`design.md`/`narrative.md`'s two-Yahalom force, and `pnpm validate:data` would
have refused the draft in any case (`placement.count.minimum: 1`).

**What this document did not do, and why.** No scratch mission JSON was
assembled and run through `pnpm validate:data`/`walk_placements.ts`/
`walk_mission.ts` in this session, because `khan_rafid`/`deir_amun` have no
map file yet (`data/maps/khan_rafid.json` and `data/maps/deir_amun.json` do
not exist — that is `mission-author`'s to create from §1) and this task's own
scope is "documents only... no map files, no JSON files under `data/`". What
**was** run through the real engine this session, on the two map objects
built directly from §1's grids (never written into `data/`): `parseMap`
(both validate cleanly, structure/tunnel counts match `design.md`'s own
figures exactly), every `FlowField.compute` route in §9, every
`sim.debugDetection` sight check in §9, and the `tunnelUnderTile`/`losRay`
scan behind DA-A1. That is a materially stronger check than a BFS-by-hand, and
it is what caught KR-M1, DA-M1 and DA-M2. `mission-author` still owns running
the three named tools on the assembled mission files before any of this ships
— this session's harness proves the terrain and the tunnel geometry, not the
mission JSON's own schema conformance.

---

## 12. Summary

| mission | starting_force | enemy.garrison | civilians.groups | structures | placements (sum) | triggers | waves | objectives (primary+secondary) |
|---|---|---|---|---|---|---|---|---|
| KR I — House Numbers | 5 | 8 | 2 | 0 | 15 | 3 | 2 | 6 (2+4) |
| KR II — The Ward | 7 | 9 | 3 | 1 | 19 | 3 | 3 | 4 (2+2) |
| KR III — What You Keep | 9 | 11 | 4 | 0 | 24 | 3 | 3 | 4 (2+2) |
| DA I — Read the Ground | 5 | 8 | 0 | 0 | 13 | 2 | 2 | 5 (2+3) |
| DA II — Set the Charges | 8 | 10 | 0 | 1 | 18 | 3 | 3 | 4 (2+2) |
| DA III — All Four | 8 | 15 | 0 | 0 | 23 | 3 | 2 | 4 (2+2) |
| **total** | **42** | **61** | **9** | **2** | **112** | **17** | **15** | **27 (12+15)** |

Both grids confirmed **48×48** by direct extraction and by `parseMap`
succeeding on both this session (Khan Rafid: 97 structures, 0 tunnels; Deir
Amun: 47 structures, 6 tunnels — every count matching `design.md`'s own
figures exactly).

**Twist tally: 16 of 20 fully expressible today (one of the sixteen, T-DA7,
ships in a lighter briefing-only form by design), 4 split
(placement-live/line-engine: T-KR5, T-KR6, T-KR9, T-DA3), 0 requiring a new
schema field** (§8).

**Doctrine-test assertion counts (§9): 7 for `khan_rafid_doctrine.test.ts`
(KR-A1…A7) + 1 new (KR-M1) = 8; 7 for `deir_amun_doctrine.test.ts`
(DA-A1…A7) + 2 new (DA-M1, DA-M2) = 9. 17 assertions total**, every one driven
through the real `FlowField`/`Sim`/`parseMap` this session rather than carried
as a draft.

**Three map findings, one blocking.** KR-M1 and DA-M2 are recorded and
non-blocking (neither touches an objective's completability). **DA-M1 should
be fixed before `data/maps/deir_amun.json` is committed** — it does not break
DA-A1 (the map is still winnable and losable), but it lets a player bypass
`da_watch_gap`'s ambush entirely via the map edges, which the design's own
"never put `^` across a recon drone's only line" rule was written to prevent
from the other direction. The fix is two short runs of `^` and does not touch
any marker, zone or tunnel.

**No design row in `design.md` §5 or twist in §11/`narrative.md` §11 could not
be expressed with the schema's real vocabulary.** Every engine gap traces to
one of the same handful of causes already on record for this pipeline
(`on.kind` cannot watch a `SimEvent`/objective; no `do` kind chooses an impact
point; two hard-coded toast paths) — §10 is the complete list, and none of it
blocks assembling and shipping the six mission files as written above, once
`commander.json`/`beit_sahwan_4_subterranean.json`'s paired edit (G-G) lands in
the same commit and DA-M1's map fix is applied.
