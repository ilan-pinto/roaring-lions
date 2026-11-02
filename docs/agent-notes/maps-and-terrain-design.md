# Qarn Hadid and relief authoring

Moved verbatim from `CLAUDE.md` (origin/main `f946bb16`, 2026-10-25) when that file was slimmed to its rules.
The rules distilled from these passages stay in `CLAUDE.md`; this file keeps the measurements, history,
reasoning and superseded statements behind them, unedited. Nothing here has been pruned yet.

<!-- CLAUDE.md lines 506-531, section "Dev instruments" -->

- **`qarn_hadid` is the terrain map** — the one that authors every terrain
  symbol legal on its theme (corrected 2026-10-30: it is NOT the only place `3` or `d` appears;
  by tile count `b` is on 24 shipped maps, `d` on 6, `3` on 4, and `~` on one, `ein_qasab`;
  when it was first authored, `3` (cover 3) and `d` (the anti-tank ditch) had ZERO tiles anywhere). Sandbox-only until 2026-09-07; it now carries the three Qarn Hadid missions
  (Act II's interlude between Tel Marum and Umm Zeitoun, `docs/campaign/qarn_hadid/`),
  with the arc's own sight and route facts pinned in
  `tools/src/qarn_hadid_doctrine.test.ts` beside the relief test. Its shape is one idea: a rock wall across the middle with TWO ways
  through — a HIGH shoulder gate (crest 6) near the axis and a LOW saddle notch
  (plain level) eight tiles further out — because a climb telescopes and slope
  can only reorder a route over ground that rises above its destination and
  comes back down. Measured through the real `FlowField`: on foot the relief map
  goes through the saddle (332) and the same rows flattened go through the
  shoulder (304 vs 320), and the two routes share only their endpoints. The
  relief route is two tiles LONGER, which is what makes it a reordering rather
  than a price. Tel Marum's ridge cannot show this — its relief is walls, and a
  wall is a mask, not a cost. Also carries the elevation range 0–7 (every other
  map tops out at 4), a bowl with a raised rim, and the two vehicle-only
  obstacles doing different jobs: the ditch seals the cheap gate to armour, the
  scree splits the eastern flank (foot 8 tiles, vehicle 20). All of it is pinned
  in `tools/src/qarn_hadid_relief.test.ts`, every claim against a control built
  from the same map with one thing removed. Two measured negatives recorded
  there and worth knowing before authoring relief: **a bowl 16 tiles across
  prices the ground and reorders nothing** (the detour costs more than the 50 it
  charges to climb out), and **cover 2 and cover 3 are not separable in a duel**
  — `COVER_HIT` goes 1 / .375 / .1375 / .09, so the big rung is 0→1, and over
  ten seeds a squad on cover 3 loses 40 hp where the same tile at cover 0 loses
  386 and dies in nine runs of ten.

## Wadi Halam I: the east-bank crest (GH-161, 25 Oct 2026)

`wadi_halam_basin` (Wadi Halam I, The Fords) carries ONE elevation feature, kept small and self-contained so the
valley's look can be built on it: a low crest one tile outside the poplar gallery, **level 2 along x = 14 from y 9
to 38, with 1-level skirts at x = 13 and x = 15** (and a 1-level cap at y 8 and y 39). Everything else on the grid is 0.
The gallery (x 7-12) is the wadi bed; the crest is its east bank. The two ford tracks climb over it with no cutting
(measured: a cutting on the riders' own line handed the warning straight back).

What it decides: from the bed you see the bank and nothing of the pasture behind it; from the crest you see the whole
pasture. Holding the ford watch (in the bed) and seeing the riders (on the crest) are now two places. Measured on the
ford watch's posts at sight 8: the first sight of a rider moves from 8 tiles out to 4. The wave routes are the same tiles
(+20 cost, the climb): descending is free and the bank sits on the riders' axis, so relief changes WHEN you see them,
not where they go. One rise (the 30-tile crest, 30 intel once). Ground hides no standing man at 2 levels on the camera.

Rules this relief follows (read before adding more around it): a crest hides a unit only if it stands ABOVE the line
between two eyes, so a 1-level step is inert for sight and a hiding crest needs 2 levels; a unit's eye is its ground
plus one, the drone's included, so the drone does not see over the crest from the bed. Every draft kept each building on
one level and every open step at most 1 level per tile. A grid that is 98% zeros reads as "alike" to the old
`map_distinctness` elevation clause, which now counts only tiles where either grid is raised.

## The marsh symbol `~` and Ein Qasab (GH-871 P2, 29 Oct 2026)

**`~` is the eleventh legend symbol** (`TERRAIN_LEGEND['~']` in `packages/data/src/map.ts`):
`{ blocked: 0, boulder: 1, cover: 1, decor: DECOR.marsh }`. It composes two mechanics the sim already had and adds no
sim code: the second blocked mask `b` and `d` use (vehicles bog, infantry wade; "vehicle" is still `mobility.wheeled`),
plus cover 1, the same as an `o` grove (reeds hide a man, not a tank). So `~` is `d` plus cover 1, mechanically, and
`pnpm test:determinism`, the golden hashes and `pnpm balance` cannot move. `tools/src/boulders.test.ts` pins it (a
vehicle routes around, foot wades, the foot mask is open, cover is 1).

- **It is legal on a `wetland` map only, and that is a data-gate rule, not a parser rule.** `parseMap` stays
  theme-agnostic (as it is for `b` and `d`), so unit fixtures can use `~` freely. `THEME_SYMBOLS` in `map.ts`
  (`{ '~': 'wetland' }`) is the table; `tools/validate_data.mjs` keeps a twin literal and refuses a `~` on any other
  theme, naming the file, the symbol, the first tile and the theme; `tools/src/terrain_symbols.test.ts` holds the twin
  equal to `map.ts`. The pass direction (a `~` on `wetland` is accepted) is witnessed by `validate:data` being green on
  `ein_qasab`. `THEME_SYMBOLS` is also re-exported from `@lions/data` because tools tests import it there.
- **`qarn_hadid` authors every symbol legal on its theme**, not "all ten": `map.test.ts` counts eleven legend symbols,
  and `qarn_hadid_relief.test.ts` is re-scoped to "every symbol legal on its theme, legend 11, one theme-restricted".
- **Draw side** (`docs/agent-notes/terrain-rendering.md`, "The wetland theme"): the marsh branch precedes the boulder
  branch everywhere, because a `~` tile sets the boulder mask.

**`ein_qasab` (Ein Qasab, "Reed Spring"), the greybox.** 48x48, `terrain: wetland`, Free Play only (no mission, no
versus file; held out of the picker, see `UNLISTED_MAP_IDS`). Authored by hand at spec 5.3's bands:

| Band | x | Content (as built) |
|---|---|---|
| West ridge | 0-11 | `^` crags in broken runs along the crest (60 tiles), oak copses `o` on the east face, a boulder skirt `b` at the foot (40 tiles; spec said about 50) |
| Valley floor | 12-33 | a `~` marsh meandering the full height (311 tiles, 5-8 wide; spec said 6-9 and about 300) and TWO causeways |
| East downs | 34-47 | a 2-level crest, hedges `1`/`2` along field bunds (156 tiles; spec about 170), the hamlet (four 2x2 `h` houses, a walled yard) on a knoll `n` at (42, 22) |

- **Markers:** `kdf_start` (4, 44), `causeway_n` (22, 12), `causeway_s` (22, 34), `hamlet` (42, 22), `east_crest` (39, 10).
  Zones: `west_ridge`, `marsh`, `east_downs`, `hamlet`. The west track runs past `kdf_start`, so the sandbox force
  stands on a verge (R-12).
- **Two causeways, x 13-37, continuous `r` at level 1**, at y 12 and y 34. The marsh spans every row so a vehicle
  cannot go round its ends. Water inside the marsh: share **0.3119** (S-4 band 0.25-0.35), measured on this
  realisation and untuned. Any edit to the marsh rows can move it; `tools/src/ein_qasab_marsh.test.ts` is the guard.
- **Built share 1.7%** (4 houses of 2x2 = 16 tiles, plus 23 wall tiles = 39 of 2304; each wall is its own structure,
  27 in all). Every building stands on one level and every open step is at most 1 level a tile. Relief count 24 -> 25
  in `high_ground_maps.test.ts` (`RISES.ein_qasab = 1`); flat maps stay 11.
- **Routes, measured through the real `FlowField` (a one-off print)** from `kdf_start` to the hamlet: vehicle 40 steps
  over the SOUTH causeway; south cut, it moves to the north causeway (56 steps); north cut, unchanged; both cut, NO
  route (foot still wades, 38 steps and 6 marsh tiles). The both-cut check proves the symbol assertion; the null
  route is the print.
- **Two facts for P5, both found while authoring.**
  - **The sandbox hostile anchor lands on `causeway_n` (22, 12), not the hamlet and crest** spec 5.3 names. The
    contact-range heuristic picks the marker nearest 0.6 x 48 = 28.8 tiles from `kdf_start`: `causeway_n` is 36.8 (err
    7.96), `causeway_s` 20.6 (8.21), the hamlet 43.9 (15.1). It is pinned honestly in
    `packages/app/src/sandbox-anchors.pinned.json` (friendly (4, 44), hostile (22, 12)). Fixing it takes a heuristic
    change or named seats; the recommendation is named seats, in P5.
  - **Any foot route from the south-west to the hamlet crosses a causeway `r` tile**, because the causeways run
    continuous across x 13-37. So a P5 doctrine pin of the form "a foot field may not pass a causeway tile" would
    fail on this layout. **Key the pin on marsh wading instead** (foot baseline wades 6 tiles, vehicle 0), or end the
    causeway a couple of tiles past the marsh edge.
- Also: `buildMatchWorld` throws "no versus rules file" if a room names `ein_qasab`, as for `milh_flats` and `tile_*`
  (pre-existing class). `shippedContentDigest()` changed value, as it does for any map added, and nothing pins a
  literal.

## Large maps: the generator library and Wadi Tarfan (large) (GH-920 B1-B3, 2 Nov 2026)

A large map is a NEW map id beside its 48x48 original, drawn by a generator, never by hand
(`_coord/bigger-maps/design.md`). The shared pieces are `tools/maps/lib/`: `common.mjs` (hash, half-turn,
`serialise`, the `--check` CLI), `shapes.mjs` (Rujm Sawda's tile-stage helpers, lifted unchanged) and
`upscale.mjs` (the 2x stages). `tools/maps/rujm_sawda/build.mjs --check` stays byte-identical on the library,
and `tools/src/map_lib_mutations.test.ts` breaks each helper it uses by one line and requires that to go red.
`tools/maps/wadi_tarfan_l/build.mjs` reads `data/maps/wadi_tarfan.json` as its 48-cell sketch.
`tools/src/large_map_verify.ts` is the generic verifier (`npx tsx tools/src/large_map_verify.ts <id>`).

What each stage does, and what measuring it found:
- **Areas copy as 2x2 blocks; every LINE feature is redrawn.** Roads and walls are one-tile chains between
  cells' ANCHORS (`anchorOf`: the tile of the cell's 2x2 block nearer the map centre, which is its own half-turn
  image, so a road across the centre line stays joined). A diagonal edge is dropped when a cell beside it is also
  road, or the chain closes a 2x2 block.
- **The 9/3/3/1 elevation rule does not straighten a diagonal contour.** A cell contour `x + y >= 3` upsamples
  to the very 2x2 staircase the nearest copy makes: every tile stays on its own cell's side of 1/2 (7/16 and
  9/16 at the corners). A 3x3 majority filter and a blur-and-threshold are fixed points of that staircase too.
  `straightenStairs` is the rule that does it: three 2-tall steps two columns apart become one tile a step. On
  Wadi Tarfan the interpolation alone left 48 staircases (the naive copy 66); with the rule, none.
- **`relief_census.ts`'s `fatStairs` is the census check ("no 2x2 diagonal steps"), and `contourWander` is report
  only.** The wander (scallop.py generalised) reads 0.13 on a per-tile 45 degree bank and 1.08 on a 2x2 one, but
  0.42 on a per-tile 2:1 bank and 0.76 on 3:1, and 0.85 on the 48x48 Wadi Tarfan's own hand-drawn relief, so it
  measures how irregular a relief is, not whether it scallops. Rujm Sawda's two mesa discs, drawn on 2x2 cells
  and left by the look pass, read 1.18 and carry 26 staircases (its spec names them as the one exemption).
- **A ditch is thinned on the SKETCH, not on the 2x2 copy.** Thinning the copy erodes a two-tile stub to
  nothing and the ford beside it grows by as much (the cut sprang a leak). `thinSimple` deletes simple points
  (Bertrand, 8-connected foreground, 4-connected background), the grid's edge counts as foreground, and a ditch
  within a cell of a ford is `keep`-protected. A diagonal-only chain still seals: a diagonal step needs both
  companion tiles open.
- **Markers: the top-half member of a twin pair is drawn at twice its tile and its twin is the half-turn image**
  (2(47 - x) + 1 = 95 - 2x), never twice its own tile. The seats come out at (20,20) and (75,75), 77.8 apart.
- **Zones keep their landmark size** (7x7 stays 7x7 about twice its centre); the two camp grounds double.

Wadi Tarfan (large) is registered and NOT offered: `RULES_ONLY_MAPS` (`tools/validate_versus_rules.mjs`),
`UNLISTED_MAP_IDS`, `VERSUS_FORMATIONS_CLOSED_MAPS`, in neither `@lions/net` list. B4 (fairness) and B5 (render and
memory) come before B7 opens it.

### Wadi Tarfan (large): what made it fair (GH-920 B4, 2 Nov 2026)

The plain upscale led KDF on every faction cell (KDF-friendly 69.3% placed, 59-65% on the economy, tunnels cell 3
at 96%) with a fair mirror. Each cause was found by toggling ONE difference between the real map and a naive 2x copy
(`tools/src/backtest/scratch/b4run.ts`, not committed; features swapped one at a time, per-seed reads, 192 seeds)
and fixed in the generator's data, with no sim or tuning change:
- **Cover, ditch, walls, roads, zones, camps, income: no effect.** Rate-scale 1 or 130 moves the purse and not the
  win rate; income does not decide a 5-minute fight. Do not tune those.
- **The two pump houses at the centre ford** (native 1 tile; the sketch draws 2x2): KDF 69.3 -> 51.6 placed when the
  2x2 is restored. Of the twelve buildings only that pair matters. Restoring it as COVER, knoll or boulder does
  nothing (65-75), shifting the pair by 1-2 tiles does nothing, a partial plinth is chaotic (52-66): only a
  full 2x2 of sight-blocking mass works, so the generator stands each on a `^` plinth (3 tiles of its cell block).
  The building keeps its native footprint, so the B2 census is untouched.
- **Two-level cliffs.** 9/3/3/1 turns every source step into a one-level ramp, which loses the 2-level cliffs of the
  centre hill (two levels hide ground troops). `keepCliffs`: economy KDF 59 -> 54%. It needs `straightenStairs`
  again after it, or the verifier refuses 18 fat diagonal steps.
- **Tunnel vents.** Relaid at 2x distance they sit 15-20 tiles from the fight: 4,700 raid-seconds in 96 games
  against the 48x48 map's 23,600, and cell 3 KDF 92-97% at every capacity (3, 5) and at 0.5 of the doubled offset.
  `VENT_CENTRE_SHARE` 3/10 of the doubled offset from the centre brings the raids to 17,000 and cell 3 to 51-56%.
  Neighbouring shares (7/20, 2/5) read KDF 65-69%: the response is DISCRETE, so the share is a measured value
  and any other must be read again, on seeds that did not choose it.
- **The landscape is chaotic per tile** (a one-tile move of a pump house swings a cell 10 points). Every number in
  the PR is on seeds the choice did not see (2000-2191 and 4000+), the PR 947 method.
