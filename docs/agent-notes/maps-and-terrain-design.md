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
