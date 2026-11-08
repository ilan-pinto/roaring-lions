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

Wadi Tarfan (large) is OFFERED since the opening commit of GH-920 B7 (the lead's ruling, after B4's fairness, B5's render and memory
and B6's census): in `VERSUS_FAIR_MAPS` and `FACTION_MATCHUP_MAPS` (the mirror and both KDF-v-Sarim cells, at seats (20,20) and
(75,75), the one-tile neighbourhood a report only), out of `UNLISTED_MAP_IDS` (a Free Play card), in `MATCHUP_MAPS` of
`tools/validate_versus_rules.mjs` (`RULES_ONLY_MAPS` is empty, kept for the next large map). Formations stay closed on it:
`VERSUS_FORMATIONS_CLOSED_MAPS`, after its own S4 run of 3 Nov (seeds 30000-30383, shipped Attack, 21 cells) tripped one: placed, Attack on both ends,
Sarim friendly, the KDF end leads 60.4% pooled (232 of 384) against a 56.5% base and the 60% pooled bar. The base already leans KDF in the placed cells
(56.8 / 56.5) and the formation adds 1.6 and 3.9 points, the GH-945 shape; it re-opens by levelling the base and re-running S4 on fresh seeds, not by widening the bar. Opening a map touches a catalogue string too: `versus.host.side.note`
names the faction maps in `en.json`, and `versus.test.ts` holds it to `FACTION_MATCHUP_MAPS`.

### Wadi Tarfan (large): the network budget (GH-920 B7, 2 Nov 2026)

`pnpm net:budget -- --map=wadi_tarfan_l --play=<heavy|idle|rush>`: the full 35-minute cap (42,000 ticks) through the local
relay, both seats `human`. The tool refuses an unlisted map (the room route answers 400), so the three runs were made
BEFORE the opening commit with a scratch wrapper that pushed the id into `VERSUS_FAIR_MAPS` in its own process only
(not committed); after the opening commit the stock command works. Judged against design 4.5 and section 4:

| Play | Rows, real-time pacing (bound 2,555 idle .. 4,655 busy) | Command-log characters (cap 2,800,000) | Snapshot held / largest upload (cap 64 KiB) | End world raw / gzip (caps 1 MiB / 64 KiB) | Result |
|---|---|---|---|---|---|
| idle | 2,562 (measured 2,163) | 0 | 6,665 B / 6,667 B | 398,652 B (389 KiB) / 6,596 B | draw on time at 42,000 |
| heavy (120 orders a minute a seat, 30 ids) | 2,646 (measured 2,251) | 291,624 (10.4%), 3,352 commands | 7,901 B / 8,012 B | 404,684 B (395 KiB) / 7,841 B | draw on time at 42,000 |
| rush (a real battle, not judged against the cap) | 146 (ends at 1.9 minutes) | 212 | 8,976 B / 8,976 B | 400,170 B / 9,144 B | side 0 by annihilation |

Idle rows are exactly Rujm's 2,562 (PR 937); heavy is 2,646 against Rujm's 2,796 (this map's heavy play sends the same orders to
fewer live moves). The idle world is 389 KiB raw against design 4.5's 390 at capacity 512. Every figure is inside the bars; the
log is at 10% of its cap, so the map needs no Worker change. The snapshot figures are the default 15-unit force, not the
150-a-side stress of 4.5 (404 KiB raw, 23.2 KiB gzip): that bound is read from the design, not re-measured here.

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

## Wadi Tarfan (large), REDONE (GH-974, 4 Nov 2026): STAGED, not offered

The third map built on `_coord/versus-maps-design/design.md` (Milh Flats (large) and Rujm Sawda first), and the one the design singles
out: here the income makes a town pay, and it had the most fairness to lose. **It is STAGED, not shipped.** `data/maps/wadi_tarfan_l.json`
and `data/versus/wadi_tarfan_l.json` are byte for byte main's. The redo is in `docs/campaign/staged_maps/wadi_tarfan_l_redo/{map,versus}.json`,
written by `tools/maps/wadi_tarfan_l_redo/build.mjs` (`--check` exits 0; `--print` and `--print-elev` draw it). Its JSON carries the id
`wadi_tarfan_l`, so opening it is a file copy plus the pins below. Map sha256 `7767c720e7a9...` (after the fix round; B4 read `048ace8e3ad0...`),
rules `c1343ec653c2...` (unchanged).

Unlike the shipped map (a 2x upscale of the 48x48, `tools/maps/wadi_tarfan_l/build.mjs`) the redo is drawn on the 96x96 grid, in the
Rujm redo's mould. It keeps the skeleton: the seats (20,20) and (75,75), the camps, the wadi along `x + y = 95` with a centre ford and two
outer fords (`x - y` at 0 and +-42), the bluffs and farms of each bank, eleven income zones paying 300 a minute, and the shipped tunnel
routes and vents to the tile (two an end, capacity 3).

**It is drawn to a triangle budget** (`tools/src/map_triangles.ts`; `cd tools && ./node_modules/.bin/tsx src/map_triangles.ts
staged:wadi_tarfan_l_redo wadi_tarfan_l milh_flats`). The shipped map's 104 ditch tiles are 3.98 M of its 4.29 M triangles a pass; the redo
has no ditch, no concrete, two houses in the whole map, one-floor sheds in the farms:

| Structure triangles a pass | Whole map | Centre 48x48 | Densest 48x48 | Predicted frame cost against the control (x3 passes x 0.65 ns) |
|---|---|---|---|---|
| 48x48 control (`milh_flats`) | 694,926 | 694,926 | 694,926 | 0 |
| Wadi Tarfan (large), shipped | 4,289,938 | 2,515,458 | 2,783,138 (25,16) | +3.5 ms centre, +4.1 ms densest |
| **Wadi Tarfan (large), redone** | **693,788** | **506,602** | **525,124 (35,18)** | **-0.37 ms centre, -0.33 ms densest** |

`LargeMapSpec.triangles` holds "no 48-tile window over the control" and goes red with eight houses added in the centre. The structure
count is 188 (176 walls, 12 buildings) against the sim's 256. The same four mesh types as the shipped map, so no GPU growth is expected.
As on the Rujm redo, a large map shows more ground than the control (the first Milh build read +0.45 to +0.75 ms with an equal bill), so
the structure term is -0.37 and the large-map term is the budget step's measurement. **No browser has run on it.**

What the redo is (the plan, against the design's principles):

- **A wadi that is a lane.** Five tiles of scree (`b`) at level 0 on a plain at level 2, so every bank is a 2-LEVEL cliff (330 bed-bank
  pairs, each exactly two levels) and a rifleman in the bed is hidden from the plain; vehicles cannot enter it. An S-curve (amplitude
  3.8, period 124 along `x - y`), from the top edge to the bottom edge, so there is no mesa and no pocket. Each ford is a gap of five
  `x - y` values with a level-1 ramp tile on each bank. The shipped bed was a gentle dip with a ditch in it.
- **Tarfan, a town at the centre ford.** The Rujm town moved to this ford: four six-tile walled yards (16 wall tiles each, two two-tile
  gates facing the road), A north-east of the main road and B south-west of it on seat 0's bank, their half-turns on seat 1's. A holds
  the two-floor house, on the lip over the ford, and a shed; B a shed and a pump house. 24 building tiles, 3.55% of the `town` zone
  (35,35,26,26), the new zone the visibility gate holds to 85%. The main road runs between the yards, 5 or more tiles off every corner.
  The shipped tunnel vents (45,43) and (42,45) stand in its streets.
- **The town pays.** `centre_ford` (the 8x8 court of the town and the ford) pays 80 a minute, each outer ford 30 (shipped 60 / 40 / 40);
  the bluffs and farms keep 20. Eleven zones, 300 a minute: `SPECS.wadi_tarfan_l_redo.income` and the twin check hold it.
- **Bluffs with bare slopes** (the Rujm tell): a crown of 8 rock tiles at level 5, a ring of 12 knoll at level 4, then open ground at 3.
  `bluff_far_0` looks over the NE ford, `bluff_near_0` over the west flank.
- **Farms** are walled yards with one one-floor shed (the shipped farms had two houses and read 90% visible against the 92% scoring cap).
  The two far farms and their zones moved three tiles off the wadi's lip (`farm_far_*`: (13,77) to (10,74), (82,18) to (85,21)); the near
  farm's yard and zone moved up a row so it clears the town's corner.
- **Four sheepfolds**, a boulder funnel either side of the main road (the armour lane, bare of cover) and scrub belts on a jittered
  lattice on both flanks: 12.0% cover, never cover 3.
- **Four road gates** (the fix round, below): a 3x3 block of rock either side of the main road eleven tiles short of the centre ford, and their
  half-turns, which close the road to a pass three tiles wide (`OUTCROPS`); and **22 tiles of ford scrub** in the lane (`FORD_SCRUB`), cover 1,
  nine diagonals short of each bank's bed. The armour lane is bare but for that scrub.
- Seal: with the three fords plugged no vehicle crosses (`large_map_verify.ts`: centre alone 800, each outer ford 1,046, equal both ways).
  A hole in the bed turns it red.

The versus visibility gate reads it at **99.87% whole map, 100% corridor, 98.6% town, 0.35% built, houses 25%**; the four farms read 93.6% to
100% (cap 92%). Its spec (`SPECS.wadi_tarfan_l_redo`) holds `towns: ['town']`, so the exempt set stays the three offered maps.

### What B4 read on the redo (4 Nov 2026)

`versus:probe --maps=wadi_tarfan_l --cap=2100`, placed forces, the staged data copied over the data paths in a SCRATCH worktree (sha256 as
above), seeds 0-191 and the held-out 4000-4287, each read once, no lever pulled. Self-checks passed on every run. Raw files in
`_coord/wadi-l-redo/`.

| Cell | 0-191 | held-out 4000-4287 | pooled 480 |
|---|---|---|---|
| KDF v KDF (the mirror), east wins | 98 / 94: 51.0% | 153 / 135: 53.1% | 52.3% |
| Sarim v Sarim (report only), east wins | 119 / 73: **62.0%** | 150 / 138: 52.1% | 56.0% |
| Placed, KDF at the friendly seat, KDF wins | 175 / 192: **91.1%** | 247 / 288: **85.8%** | **87.9%** |
| Placed, Sarim at the friendly seat, KDF wins | 171 / 192: **89.1%** | 257 / 288: **89.2%** | **89.2%** |
| Economy, KDF friendly, KDF wins | 156 / 192: **81.3%** | 249 / 288: **86.5%** | **84.4%** |
| Economy, Sarim friendly, KDF wins | 156 / 192: **81.3%** | 234 / 288: **81.3%** | **81.3%** |
| Tunnels cell 3 (answer), KDF friendly, Sarim wins | 105 / 192: 54.7% | 145 / 288: 50.3% | 52.1% |
| Tunnels cell 3 (answer), Sarim friendly, Sarim wins | 111 / 192: 57.8% | 162 / 288: 56.3% | 56.9% |

**The mirror and the tunnel cell hold; the faction cells do not.** KDF v KDF is inside 60/40 on both reads (the offered mirror gate). KDF v
Sarim at the placed forces and in the economy room reads KDF 82-92%, at both seat orders, so it is the faction and not the seat; the shipped
map reads 55% / 55% (PR 953) and the 48x48 control about 48%. The map therefore could not open as KDF v Sarim as B4 read it. The fix round below
diagnosed it and pulled two levers. Not re-read: one-tile seat shifts, S4 formations (they stay CLOSED on this map,
`VERSUS_FORMATIONS_CLOSED_MAPS`), the lane probe of design section 4.

### The fix round (GH-974, 4 Nov 2026): the diagnosis and two levers

B4 left the KDF v Sarim cells at 82-92% KDF in both seat orders. This round diagnosed why, pulled levers in the STAGED map only (terrain, cover; no
unit stat, price or `tuning.ts`; `data/maps/wadi_tarfan_l.json` and `data/versus/wadi_tarfan_l.json` stay main's to the byte), and read every cell
again. The instruments are not committed: the in-memory variant runner, the observers and the raw outputs are in `_coord/wadi-l-redo/fix-lab/`
and `_coord/wadi-l-redo/fix-report.md` (placed forces are 0.4 s a game, so the screens were 96-384 seeds a cell; the official `versus:probe`
read only the candidates).

**Diagnosis.** The lean is the faction, not the seat, and it has two parts. (1) A bare 96x96 plain already reads KDF **75 / 71%** placed
(seeds 0-95, KDF friendly / Sarim friendly): the Lavis and Namers see and outrange Sarim's thirteen walking Kornet cells (360 hp, sight 10
against the Lavi's 12 and the KDF's drone and helicopter). (2) The redo's two signature features add to it and give Sarim nothing back: the
**yard walls** hand the first Namers a wall-corner pocket six tiles from the ford (41-43, 44-47, against yard B's east wall), where the parapet
rule gives the target cover 2 (x0.1375): 44% of the shots on a Namer met cover on the redo and none on the shipped map; and the **two-level
banks** leave the Kornet cells that cross the bed blind (a unit at level 0 sees a plain tile only as far past the lip as it stands short of it).

Redo against shipped, placed forces, seeds 0-47 (48 games a cell; the fight is at the centre ford on both maps, **100%** of ground deaths in x, y 32-63):

| | Shipped, KDF friendly / Sarim friendly | Redo (the B4 map), same |
|---|---|---|
| KDF wins | 47.9% / 64.6% | **91.7% / 91.7%** |
| First ground unit dead (time to first contact) | 14.8 s / 14.8 s (a KDF jeep) | 15.0 s / 15.0 s (the same jeep) |
| First Sarim ground unit dead | 37.8 s / 36.1 s | **29.7 s / 29.0 s** |
| Kornet cells dead, of 13 | 8.96 / 10.85 | **13.46 / 13.21** |
| Lavis dead, of 2 | 1.02 / 0.79 | **0.23 / 0.25** |
| Namers dead, of 2 | 1.75 / 1.73 | 1.25 / 1.48 |
| Rocket batteries dead, of 2 / mortar teams dead, of 1 | 0.96 / 0.52 (KDF friendly) | 1.83 / 0.08 |
| Kornet shots a game / shots on a Namer a game, share meeting cover (24 games) | 53 / 2,380, 0% | 35 / 778, **44%** |

Each feature added alone to the empty plain (placed, KDF wins, seeds 0-95, KDF friendly / Sarim friendly):

| Added to the empty 96x96 plain | KDF wins |
|---|---|
| nothing (flat, level 2) | 75.0 / 70.8 |
| the four yards' walls only | **89.6 / 91.7** |
| the two-level banks only (relief, no scree) | **83.3 / 85.4** |
| the scree bed only (the vehicle wall, no relief) | 76.0 / 67.7 |
| bed and banks | 90.6 / 91.7 |
| the town's buildings / the boulder funnel / the bluffs | 72.9 / 79.2, 72.9 / 61.5, 66.7 / 63.5 |
| cover belts, farm walls, farm sheds, roads, the home shelf | 75.0 / 70.8 each (far from the fight: not one game changes) |
| the redo itself / without its yard walls / without its banks / without both (KDF friendly) | 93.8 / 89.6, 87.5 / 79.2, 87.5 / 85.4, 70.8 |
| the shipped map (KDF friendly): + its elevation alone, + its ditch, boulders and rock | 56.3; 66.7, 64.6 (on the empty plain) |

So removing the redo's walls and banks only gets it to the empty plain's lean, and that is outside 60/40 too: the fix has to give Sarim something.

**The levers, six rounds** (placed forces, KDF friendly unless said, KDF wins; 96 seeds on 0-95 unless said):

1. *Relief*: a gentle bowl in place of the banks (1 level in 12 or 8 tiles), 92.7 with the walls and 76.0 without; banks of one level, 72.9 without
   walls. No.
2. *Cover and boulders*: 25% cover-2 tiles over the whole lane, 84.4 (78.1 with no walls and flat banks); boulder bands 3 and 6 tiles wide
   along the banks, 90.6 and 94.8. No.
3. *Rock outcrops*: 2x2 rock beside the road near the ford, (43,41) 81.3 and (46,42) 91.7 (the shipped map's plinth place, (44,40), is the yard
   wall); at **(41,37)** and its transpose and half-turns (eleven tiles short of the ford, either side of the road): **62.5 / 61.5**, 61.7 / 62.8 on
   seeds 0-383. The first lever that moves it.
4. *Neighbours and combinations of 3*: (40,36) 66.7, (41,36) 75.0, (40,37) 62.5, (42,38) 81.3, (38,34) 76.0; with 1-level banks 60.4; without
   walls 68.8; a second pair of 2x2 85.4 and 79.2. Chaotic, as PR 953 found.
5. *Size*: 3x3 at (41,37) **55.2 / 53.1** (56.3 / 57.3 on 0-383); at (40,37) the two blocks touch at a corner and seal the road, 93.8; (41,36) 80.2;
   (40,36) 64.6; (42,38) 65.6; 2x4 95.8. The official matrix on it (C1 below): every cell inside on the pooled seeds, but the placed Sarim-friendly
   cell reads 63.2% on one 288-seed set and 60.9% on the 4000 + 9000 pool.
6. *The ford scrub* on top: 22 tiles of scrub (cover 1) in the lane, nine diagonals short of each bank's bed, 25% of its open tiles. Six salts
   read the placed cells 34-56% KDF on 0-191 (a few tiles decide); salt 10 reads 54.7 / 47.9 there and 51.6 / 56.3 on 192-383, the centre of the
   six. (An early scrub screen was ASYMMETRIC, scrub on seat 0's bank only, and read 35-57: discarded, the map is a half-turn.)

**Why the gate works.** It narrows both columns to a three-tile pass, so the KDF armour files down the road instead of fanning into the yard
pockets: shots on a Namer rise from 778 to 1,800 a game and none meets cover, the Lavis are shot at (0.88 dead a game against 0.18) and the
Kornet cells that reach the ford get to fire (9.9 of 13 dead against 13.5).

**What it reads now** (the official `versus:probe`, `--cap=2100`, self-checks passed on every run; the staged data in memory or copied over the data
paths and restored, the shipped data untouched). The levers were chosen on placed forces on seeds 0-383. Every cell below is the **KDF share** (the
mirror by west end; a draw is under 0.4% of games, so a share and its complement differ by less than that; the tunnel rows of the first four ranges
are 100 minus Sarim's share). Six 288-seed ranges, none of them a pool to be called held-out: 4000-4287 and 9000-9287 were read for the gate-alone
matrix before the scrub was chosen, 12000-12287 and 15000-15287 (the reviewer's fresh range) informed the salt-11 trial, and **18000-18287 and
21000-21287 were read for both salts and no choice had seen them**:

| Cell (KDF share) | B4 before (480) | 4000 | 9000 | 12000 | 15000 | 18000 | 21000 |
|---|---|---|---|---|---|---|---|
| KDF v KDF (the mirror), west wins | 47.7 | 45.5 | 49.7 | 54.5 | 51.4 | 50.3 | 51.0 |
| Placed, KDF friendly | **87.9** | 48.6 | 49.7 | 51.0 | 50.7 | 42.0 | 51.4 |
| Placed, Sarim friendly | **89.2** | 51.7 | 53.1 | 43.4 | 47.9 | 48.3 | 49.3 |
| Economy, KDF friendly | **84.4** | 51.4 | 49.0 | 52.4 | 45.1 | 48.6 | 49.7 |
| Economy, Sarim friendly | **81.3** | 46.5 | 47.6 | 48.3 | 45.5 | 41.7 | 45.1 |
| Tunnels cell 3, KDF friendly | 47.9 | 45.5 | 43.1 | 40.6 | 41.0 | 41.3 | 42.4 |
| Tunnels cell 3, Sarim friendly | 43.1 | 42.4 | **38.9** | 41.3 | **37.8** | 43.8 | 43.8 |

Sarim v Sarim (report only), west wins, on the last two ranges: 51.7 and 52.8. The faction cells are inside 60/40 (40 to 60 either way) in 40 of
the 42 range-cells after the fix, against none before. **The two outside are the tunnel cell, Sarim friendly, on 9000-9287 (Sarim 61.1%) and 15000-15287
(62.2%)**, and that cell sits on the bar: over the six ranges Sarim wins it 57.6 / 61.1 / 58.7 / 62.2 / 56.2 / 56.2, mean 58.7%, two ranges outside. **Tunnel cell
3, Sarim friendly, is a report cell and this map does not open on it**; the probe prints the tunnel arm as report-only, and the claim that every
cell is inside is withdrawn. A lever that is a measured value moved it: the gate alone read the tunnels Sarim 52.5 / 53.4 (0-191 + 4000 + 9000) but
the placed cells 58.2 / 59.1 KDF, and the scrub trades the one for the other.

**Salt 11, tried and dropped.** The weaker scrub (20 tiles, placed 52.9 / 57.3 on 0-383) levelled the tunnel cell on 18000 and 21000 (KDF 44.4 /
46.9 Sarim friendly, 51.0 / 53.1 KDF friendly) but read **placed KDF friendly 60.8%** on 21000-21287 (49.0 on 18000), outside, with economy 53.1 /
56.6 and 48.3 / 48.3. Salt 10 on the same two ranges has every cell inside (worst: tunnels KDF friendly 41.3, Sarim 58.7; placed KDF friendly 42.0;
economy Sarim friendly 41.7), so by the rule "keep the salt with the better worst cell across the two ranges" salt 10 stays (worst 58.7 against
60.8). Raw per-seed files for both: `_coord/wadi-l-redo/fresh/`.

**What does not pass or was not read.** The seat neighbourhood (a report, per the 2 Nov ruling; PR 953 found this map's neighbours at 31-82% and
nothing here makes it less chaotic: a block of rock one tile over reads 66-94%). S4 (formations stay CLOSED on this map). The lane probe and the
tick probe for `recomputeFields('opened')`. Tunnel cells 2 and 4. The render budget run: four 3x3 rock blocks and 22 scrub tiles are terrain, not
structures, so the structure bill is unchanged (693,788 / 506,602 / 525,124 triangles a pass; `map_triangles.ts` reads the same), but no browser
has run on the map. Both levers are *measured values*: the same family of change gives 34-56% (six scrub salts) and 62-96% (the outcrop's
shape and place); a change to the seats, the road, the yards or the vents needs a new read.

### Opening it (what the swap changes)

A file copy of the staged map and rules over `data/maps/wadi_tarfan_l.json` and `data/versus/wadi_tarfan_l.json`, the redo's generator in
place of `tools/maps/wadi_tarfan_l/build.mjs`, `SPECS.wadi_tarfan_l_redo` under `wadi_tarfan_l` in `large_map_verify.ts`, and the pins the new
data moves. A full `pnpm test` on the copied data (4 Nov, scratch worktree, nothing else changed) reads 30 tests in 12 files red, and nothing
else:

- `crown-summit.test.ts` (2): the 31 summits and the `wadi_tarfan_l` pick (the four road-gate outcrops are rock clusters too: re-count them);
- `terrain-defaults.test.ts`: the `wadi_tarfan_l` digest; `wet-control-map.test.ts`: the control-C census; `high_ground_maps.test.ts`: the rise pin;
- `presentation_census.test.ts` (5): the Wadi Tarfan (large) slope and twin counts;
- `wadi_tarfan_l.test.ts` (4) and `large_map_verify.test.ts` (6): the shipped map's own landmarks, generator drift, pump-house plinths, markers and
  rules (and the shipped verifier's ditch and scallop cases), which become the redo's `wadi_tarfan_l_redo.test.ts` with its registration put back;
  `wadi_tarfan_l_redo.test.ts` itself reads five of its "shipped untouched" assertions red, as it should;
- `map_visibility.test.ts`: the report-only reading "the two far farms of seat 1 read 89.7% and 90.2%, houses 67%" is gone;
- `net/snapshot-rejoin.test.ts` (2) and `net/rejoin-catchup.test.ts`: the digest and premise seed fold in every map; `backtest/versus-probe.test.ts`:
  the economy self-check on each rules-file map (the last two are timing-sensitive under load: re-run them alone before blaming the data).

**Before opening:** the placed and economy cells and tunnel cell 3 KDF friendly read inside 60/40 on all six ranges, tunnel cell 3 Sarim friendly does not (mean Sarim 58.7%, two ranges over 60: a report cell, the map does not open on it), tunnel cells 2 and 4 are unread, the seat
neighbourhood (PR 953 found this map's neighbours at 31-82%), S4 if formations are to open (they are CLOSED now), the budget step (`perf:fx` at
the centre and a seat, `perf:memory`; no new mesh type), `pnpm net:budget` at 188 structures, the tick probe for `recomputeFields('opened')` on a
wall, and the lane probe. The Free Play line for the map ("a dry wadi crossed at three fords") still fits.

## Milh Flats (large) (GH-920 B3-B4, 2 Nov 2026)

`tools/maps/milh_flats_l/build.mjs` reads `data/maps/milh_flats.json` as its 48-cell sketch, on the same library,
and writes `data/maps/milh_flats_l.json` and `data/versus/milh_flats_l.json`. It is a MIRROR-ONLY map like its
original. It is OFFERED since the opening commit of GH-920 B7 (on the lead's ruling, after B4's mirror read, B5's render and
memory and B6's census): in `VERSUS_FAIR_MAPS` and `MIRROR_RULES_MAPS` (`tools/validate_versus_rules.mjs`; `RULES_ONLY_MAPS` is
empty again), out of `UNLISTED_MAP_IDS` (a Free Play card), in `FACTION_MATCHUP_MAPS` never (no faction cell was read), so the
`versus.host.side.note` string is unchanged. Formations are OPEN since 3 Nov (its own S4 run, mirror cell, seeds 30000-30191: 0 TRIP of 3; the east end's base lean, 56.3%, is not made worse). What differs from Wadi Tarfan (large):
- **The seats are on the ANTI-diagonal** (x + y = 95): `(20,75)` and `(75,20)`, 77.8 tiles apart. Doubling the original's
  `(9,38)` and `(38,9)` would give 82.0, so the seats are authored (`SEAT_0`/`SEAT_1`), not doubled. The verifier's
  seat rule gained `antiDiagonal` in the spec; the main-diagonal rule is unchanged for the others.
- **No rules file on the original, no tunnels on the twin.** The twin's rules file carries the capacity (512), the
  cap (35) and a camp and an income table (220 a minute over seven zones) that a mirror room never reads; it is
  there because `capacity` and `cap_minutes` live in a rules file and the schema wants a camp and an income zone.
- **The lone `centre` marker** `(23,23)` is one of the four tiles round the true centre; it goes to `(47,47)`, the same
  tile of the same four, and the verifier's spec names it as the one marker without a twin.
- **The tell rocks keep their native four tiles.** A `^` cell copied as a 2x2 block is a 16-tile rock, past
  `CROWN_MAX_TILES` (12): the renderer reads no crown, and "two crowned tells" would lose both. Each rock is
  re-placed at its native footprint on twice the source centre, on a knoll (the rest of its 4x4 block is `n`).
  `crown-summit.test.ts` pins 2 summits for the map (an independent Python flood fill reads the same).
- **Cover** `2` cells are copied as two of their four tiles (the hash picks them), `1` as three, `o` as two: cover
  reads 9.5% (Rujm's band 8.5-11%; the sketch is 11.7% and a whole-cell copy would be over). No `dress` stage: the
  sketch's own scatter is already enough.
- **`keepCliffs` is not applied**: no two neighbouring cells of this sketch differ by two levels, so it would change
  no tile (checked: 0 of 9,216).
- **Contour wander reads 1.30** (the 48x48 original 0.95; Wadi Tarfan (large) 1.31). It is report-only (see above);
  the gate is `fatStairs`, which reads 0.

### What B4 read (mirror only, 2 Nov 2026)

`pnpm versus:probe` with `--maps=milh_flats_l --arr=kdf/kdf,sarim/sarim --cap=2100` (the 35-minute cap; the probe's
self-check passes at it), placed forces. No lever was pulled: the first geometry was read once on seeds 0-191 and
again on held-out 4000-4287, and no choice was made on either.

| Cell (west share) | 0-95 | 96-191 | pooled 0-191 | held-out 4000-4287 | pooled 480 |
|---|---|---|---|---|---|
| KDF v KDF (the offered cell) | 52.1% | 49.0% | 50.5% (97/95) | 49.7% (143/145) | 50.0% |
| Sarim v Sarim (report only) | 51.0% | 65.6% | 58.3% | 53.5% | 55.4% |

The seat neighbourhood (each of the 8 one-tile shifts of seat 0, seat 1 its half-turn; seeds 4000-4287; REPORT ONLY, the
seats are fixed data): KDF v KDF west share 53.5 / 47.2 / 50.7 / 49.0 / 52.4 / 42.4 / 51.0 / 45.1 (base 49.7), so 7 of 8
within 5 points and all inside 60/40; Sarim v Sarim 58.7 / 61.5 / 55.2 / 60.4 / 53.1 / 54.2 / 22.9 / 39.2 (base 53.5),
five of eight beyond it. The Sarim mirror was read and never fitted.

### Milh Flats (large): the network budget (GH-920 B7, 2 Nov 2026)

`pnpm net:budget -- --map=milh_flats_l --play=<heavy|idle|rush>`: the full 35-minute cap (42,000 ticks) through the local
relay, both seats `human`, KDF v KDF. The tool refuses an unlisted map, so the three runs were made with a scratch wrapper
that pushed the id into `VERSUS_FAIR_MAPS` in its own process only (never committed); after the opening commit the stock
command works. Judged against design 4.5 and section 4:

| Play | Rows, real-time pacing (bound 2,555 idle .. 4,655 busy) | Command-log characters (cap 2,800,000) | Snapshot held / largest upload (cap 64 KiB) | End world raw / gzip (caps 1 MiB / 64 KiB) | Result |
|---|---|---|---|---|---|
| idle | 2,562 (measured 2,164) | 0 | 6,193 B / 6,194 B | 398,608 B (389 KiB) / 6,127 B | draw on time at 42,000 |
| heavy (120 orders a minute a seat, 30 ids) | 2,641 (measured 2,244) | 291,624 (10.4%), 3,352 commands | 7,425 B / 7,527 B | 404,640 B (395 KiB) / 7,348 B | draw on time at 42,000 |
| rush (a real battle, not judged against the cap) | 151 (ends at 2.0 minutes) | 212 | 8,430 B / 8,430 B | 399,990 B / 8,567 B | side 1 by annihilation |

Idle rows are exactly Rujm's and Wadi (large)'s 2,562 (PR 937, PR 957); heavy is 2,641 against Wadi (large)'s 2,646. The
idle world is 389 KiB raw against design 4.5's 390 at capacity 512. Every figure is inside the bars; the log is at 10% of its
cap, so the map needs no Worker change. The snapshot figures are the default 15-unit force, not the 150-a-side stress of 4.5
(404 KiB raw, 23.2 KiB gzip), which is read from the design and not re-measured here.

## Milh Flats (large), REDONE (GH-974, 3 Nov 2026): STAGED, not offered

The lead (GH-974): the maps have too few obstacles, houses, roads and cover forcing a strategy, so a match is an all-in fight.
Design: `_coord/versus-maps-design/design.md` (principles in its section 1, caps in 2, this map in 3), approved 3 Nov. This
map is the first built on it. A mirror room has NO economy and no goal (design section 0), so terrain shapes the fight and
nothing yet removes the all-in: it would be offered for the annihilation mirror only, as before; win modes are GH-976.

**It is STAGED, not shipped.** `data/maps/milh_flats_l.json` is still the first build (GH-920 B3). The redo is in
`docs/campaign/staged_maps/milh_flats_l_redo/{map,versus}.json`, written by `tools/maps/milh_flats_l_redo/build.mjs` (`--check`
exits 0), byte for byte what B4 and the budget measured; its JSON carries the id `milh_flats_l`, so opening it is a file copy
plus the pins below. It stays staged because the render and memory budget FAILED, and the rule for a failed budget is that
the PR must not change what is offered:

| Read on the redo, Apple M3 Pro, ANGLE Metal, 1440x900 @2x, music off, paired against the 48x48 | Redo | First build (PR 961) | Bar |
|---|---|---|---|
| frame, high, centre z1 (the town) | +3.85 ms (23.2 vs 19.5) | +0.75 | +0.5 |
| frame, high, centre z1.6 | +3.3 | -0.65 | +0.5 |
| frame, medium, centre z1 | +3.95 | +0.20 | +0.5 |
| frame, either preset, the seats (versus_0 z1) | +0.9 / +1.05 | +0.45 / +0.70 | +0.5 |
| draw calls / triangles, high, centre z1 | 1,106 / 8.4 M | 314 / 3.6 M (48x48: 269 / 3.2 M) | |
| perf:memory sandbox JS (1400x900 @1x) | **154.3 MiB** | 152.0 | **153** (a ratchet) |
| perf:memory sandbox GPU | 604.3 MiB | 540.0 | 1,015 |
| live versus room JS / GPU | 135.5 / 963.4 MiB | 134.6 / 952.5 | 153 / 1,015 |

Where the frame goes (high, centre z1, 8 rounds, same tool): no walls and no buildings reads -0.7 ms against the 48 (the wadis,
ditches and scrub are cheaper than the first build's), no walls 1.1, the whole redo 3.95. So the 172 wall tiles cost about 2.9 ms
(744 draw calls: a wall clone is two primitives, drawn in the colour, shadow and AO passes) and the houses, sheds and the rest 1.8.
Design decision 7 says to instance the per-tile structures above +1 ms. **Done (GH-974, `units/structure-instances.ts`) and it did
NOT deliver the predicted -2.9 ms**: draw calls fell 1,106 -> 386 but the centre z1 gap on `high` only 3.70 -> 3.40 ms (4 Nov, load
about 8, this tree's own before arm), because the walls' cost is triangles, not calls (see "Per-tile structures draw instanced" in
`renderer.md`). The centre reads about +3.4, not +1.1. The extra JS (+2.3 MiB) and building textures (+64 MiB of GPU: a house, a
shanty, a concrete block and a pump house, which the first build mostly lacked) are the town's new mesh types.

What the redo is:

- **Its own sketch.** `tools/maps/milh_flats_l_redo/sketch.mjs` keeps the 48x48 original's skeleton (the two corner boulder
  masses, the two tell hills with their rock crowns, the level-3 seat plateau, its scrub) and drops everything else; the
  offered 48x48 is untouched. Everything new is drawn by `build.mjs` at TILE level, top half only, the bottom half its half-turn.
- **Three lanes.**
  - open armour ground between the wadis and the flank roads;
  - **Bir Milh**, a 24x24 enclosure on the centre (zone `town`): a ditch belt (north, south) and wall (east, west) ring closed to
    wheels but for TWO four-tile gates, six walled yards (6 houses, 14 two-tile sheds, 2 concrete blocks, 2 pump houses, 124 wall
    tiles), a plus of four-tile streets and a khan court (zone `bir_milh`, 8x8). The east-west street ends in a two-tile FOOT gate
    (a ditch in the wall) on each side;
  - a covered infantry lane in each seat's **wadi**: a four-tile bed of scree (`b`, foot only, open to sight) at level 0 on a plain
    at level 2, so each bank is a 2-level cliff (246 bed-bank pairs, each exactly two levels). It runs from beside the seat's flag
    at the top edge, at 45 degrees (every contour one tile a row: no 2x2 staircase), then straight, to a 4x4 FORD gap with a
    level-1 ramp tile either side.
- **The seal.** wadi_1, its ford, the town's north-west corner, the town through its two gates, the south-east corner, the other
  ford and wadi_0 are one point-symmetric line from the top edge to the bottom edge. A vehicle crosses at the left ford, the
  right ford or through the town. `large_map_verify.ts` cuts it: all plugged, no route; each alone carries one at the same cost
  both ways. **The town is ONE crossing** (`marker: 'gate_1'`, a plug of radius 3 at its north gate: the interior has no other exit,
  so closing one gate closes it). Plugging the whole enclosure hides a hole in its ring (the plug covers the ring), and plugging
  only the court lets a vehicle route round it through the yards (traced through the real flow field: cost 990 against 912
  through the court).
- **Roads** are cosmetic: no road speed (the lead's ruling), and a room never sets `supply_corridor`.
- **High ground.** The tells' slopes are bare (the `n` cover-2 field is gone: 24 `n` tiles remain, the two 12-tile rings); the
  first build's mid-map hills are flat, so the map has 2 high-ground rises, not 6, and the presentation census reads 160 slope
  tiles a seat, not 422.
- **Cover** 10.4% (band 10-14%, was 8.5-11%): scrub belts on the foot routes, never cover 3.
- **The versus visibility gate** (`map_visibility.ts` `measureVersus`, `VERSUS_CAPS`): whole map visible >= 95%, seat corridor and
  every scoring zone >= 92%, a town zone >= 85%, building tiles <= 3% of the map and <= 25% of a town, no building over two floors,
  no apartment or warehouse, houses <= 40% of the building tiles. Walls and fences are per-tile, low-profile and hide nothing, so
  they are not building tiles. The redo reads 99.5% / 97.5% / 89.0% (town) / 92.0% (the court), 0.76% built, houses 34%.
  `large_map_verify.ts` runs it for a spec with `visibility`, and its CLI prints it. Read report-only on the maps that ship, it
  finds the first build of this map at houses 53% of its building tiles, Wadi Tarfan (large) at 90% in two farms and 67% houses, and
  Rujm Sawda's four walled wells at 91.7%: the caps are the bar for the maps built to the design, not a verdict on these.
- **The built-share cap is per map** (`LargeMapSpec.maxBuiltShare`, required): it was one global 1%, an upscale-fidelity check.
  The three upscaled maps keep 1%; the redo's is the gate's 3%.

### What B4 read on the redo (mirror only, 3 Nov 2026)

`pnpm versus:probe --maps=milh_flats_l --arr=kdf/kdf,sarim/sarim --cap=2100` on the staged geometry (the files' sha256 is the same
as the staged ones'), placed forces. The first geometry was read once on seeds 0-191 and on held-out 4000-4287; no lever was pulled.

| Cell (west share) | 0-191 | held-out 4000-4287 | pooled 480 |
|---|---|---|---|
| KDF v KDF (the offered cell) | 56.3% (108/84) | 53.1% (153/135) | 54.4% (261/219) |
| Sarim v Sarim (report only) | 44.3% (85/107) | 50.3% (145/143) | 47.9% (230/250) |

Inside 60/40 on both reads. The first build read KDF 50.5% / 49.7% (50.0% pooled).

### Opening it (what the swap changes)

The swap is a file copy of the staged map and rules over `data/maps/milh_flats_l.json` and `data/versus/milh_flats_l.json`, the
redo's generator and sketch in place of `tools/maps/milh_flats_l/build.mjs`, the redo spec under `milh_flats_l` in
`large_map_verify.ts`, and the pins the new data moves. A full `pnpm test` run on the copied data (3 Nov, with the budget still to
fit) reads exactly these, and nothing else, red:

- `high_ground_maps.test.ts`: `milh_flats_l: 2` (was 6; an independent Python flood fill reads 2 runs of 124 tiles at level 4 or
  above, median open level 2) and the relief total, 154;
- `presentation_census.test.ts` (Milh block): 160 slope tiles a seat (was 422), lit 0/160 and 160/0, twin mismatches 160 (still
  over the 150 bar), the x-flip mutation 285/135, the half-turn control 160/160;
- `terrain-defaults.fixture.json`: `milh_flats_l` `f79c04c8...` becomes `9a7cb199...` (one line);
- `snapshot-rejoin.test.ts`: the premise seed (2) reads a non-negative digest on the new map, so the premise needs another seed
  that reads negative, found by the test's own `play` and `digestOf`;
- `milh_flats_l.test.ts`: the first build's own landmarks (the original's markers and zones by name, the 14x14 hamlet) become the
  redo's, which is `milh_flats_l_redo.test.ts` with the registration block put back;
- `en.json`: the Free Play card line ("a gravel plain ... a hamlet") becomes "two wadis, two crowned tells and a walled town" (82
  characters; the bound is 90);
- `versus-probe.test.ts` "the economy self-check passes on each map" is a 60 s test that read red on both trees under this
  machine's load (it passes alone): not a pin.

**Formations are already OPEN on `milh_flats_l`** (above: the FIRST build's S4, mirror cell, seeds 30000-30191), and
`VERSUS_FORMATIONS_CLOSED_MAPS` is empty since 7 Nov (only the tel_marum economy room is closed, as data). The redo has had NO S4 run of its own, and a map's base must be level
before it is offered with formations (GH-945 amplifies a lean 2.5-5x). So a file-copy swap would open an unchecked geometry with
formations on: in the same commit, either re-run S4 on fresh seeds (`pnpm s4:gate` over `versus:probe --per-seed` files) or add
`milh_flats_l` to `VERSUS_FORMATIONS_CLOSED_MAPS`.

Design checks (design section 4) NOT yet run on the redo, all before opening: the lane probe (armour left, infantry right, against
the blob, equal from both seats); `pnpm net:budget` at the town's structure count (172 wall tiles and 70 building tiles in the
redo, against 32 structures today); the tick probe for `recomputeFields('opened')` when a wall tile is destroyed; the seat-shift
report. The court (`bir_milh`) reads exactly 0.92 against its 92% scoring cap: one tile of its furniture moved flips it, and
`milh_flats_l_redo.test.ts` pins it.

`crown-summit.test.ts` (2), `ambience.test.ts` ('open', 0.76% built), `terrain-chunks.test.ts` and `versus_maps.test.ts` pass
on the new data unchanged. B4 and the budget (above) are read on the same bytes. Before opening, fit the walls (instance
per-tile structures, design decision 7) and the JS ceiling, then re-read perf and memory. **4 Nov update:** the walls ARE instanced now
(`renderer.md`, "Per-tile structures draw instanced"), and the budget is still failed: centre z1 `high` +3.40 ms (bar +0.5), z1.6
+2.90, medium z1 +3.15; the seats +0.60 and +0.85; JS 153.9 MiB against 153. What is left is TRIANGLES: the redo draws 5.2 M more
than the 48x48 (walls 1.59 M of them: 3,010 a tile, three passes), at about 0.65 ns each. The levers are a wall LOD, fewer or
cheaper houses and sheds, and the 0.9 MiB of JS, in that order of size; none is done.

## Rujm Sawda, REDONE (GH-974, 4 Nov 2026): STAGED, not offered

The second map built on `_coord/versus-maps-design/design.md` (Milh Flats (large) was the first, above). The design's order puts Rujm
Sawda next: it is offered for the mirror, it was 0.8% built, and it had walled wells and a generator to build on. **It is STAGED,
not shipped.** `data/maps/rujm_sawda.json` and `data/versus/rujm_sawda.json` are byte for byte main's. The redo is in
`docs/campaign/staged_maps/rujm_sawda_redo/{map,versus}.json`, written by `tools/maps/rujm_sawda_redo/build.mjs` (`--check` exits 0; `--print`
and `--print-elev` draw it); its JSON carries the id `rujm_sawda`, so opening it is a file copy plus the pins below. Its rules file is
the shipped one to the byte (same seats, camps, three tunnel routes an end, eleven income zones paying 360 a minute), because the
redo changes the ground and leaves the economy to a KDF v Sarim room.

**It is drawn to a triangle budget.** PR 1001 found that the cost of a town is TRIANGLES, not draw calls, so the plan was drawn
counting them (`tools/src/map_triangles.ts`; `cd tools && ./node_modules/.bin/tsx src/map_triangles.ts staged:rujm_sawda_redo rujm_sawda milh_flats`):

| One structure, standing mesh (Python parse of `art/meshes/buildings`, `decor/ditch_0.glb`) | Triangles | In a frame (x3 passes) |
|---|---|---|
| wall tile | 3,087 | 9.3k |
| shanty (a shed) / concrete block / pump house | 7,157 / 7,155 / 7,594 | 21.5k / 21.5k / 22.8k |
| house (two floors) | 39,016 (12.6 walls) | 117k |
| fence tile | 19,616 (6.4 walls) | 59k |
| ditch tile (`d`) | 38,240 | 115k |

So the plan has no ditch and no concrete, one two-floor house on each bank of the town, one-floor sheds in the wells, and its walls are
the cheapest thing that blocks. The bar is the 48x48 control (`milh_flats`, the map the +0.5 ms budget is read against): in the centre
48x48 window and in the DENSEST 48x48 window anywhere, the redo's structures draw no more triangles in one pass than the control's
whole map (694,926). `LargeMapSpec.triangles` holds that and a test makes it fail with eight houses in the centre.

| Structure triangles a pass | Whole map | Centre 48x48 | Densest 48x48 | Predicted frame cost against the control (x3 passes x 0.65 ns) |
|---|---|---|---|---|
| 48x48 control (`milh_flats`) | 694,926 | 694,926 | 694,926 | 0 |
| Rujm Sawda, shipped | 659,596 | 133,092 | 351,706 (0,3) | -1.1 ms centre |
| **Rujm Sawda, redone** | **807,760** | **408,692** | **529,631 (25,4)** | **-0.56 ms centre, -0.32 ms densest** |
| Milh Flats (large), redone (measured +3.40 ms) | 2,591,000 | 2,429,000 | 2,463,000 | +3.4 ms centre (5.2 M frame triangles over the control) |

The redo adds 148k a pass over the whole map and 276k at the centre to what Rujm Sawda already draws (0.44 M and 0.83 M a frame, about
+0.54 ms at the centre by the 0.65 ns rule). It stays UNDER the control everywhere. A caveat from the first Milh build: its centre bill
was the control's within 2%, and it still read +0.45 to +0.75 ms against the 48x48 (a large map shows more ground), so the structure term
here is -0.56 and the unexplained large-map term is a measurement for the budget step, not a prediction. The redo uses the same four
mesh types the shipped map does (wall, house, shanty, pump house), so the building-texture GPU memory does not grow. **The sim holds 256
structures and every wall tile is one:** the redo stands 222 (208 walls, 14 buildings), 34 under the cap, and the test pins both numbers.

What the redo is (the plan, against the design's principles; the skeleton is the shipped map's):

- **A wadi that is a lane.** The shipped bed was a one-level dip with an open floor. The redo's is five tiles of scree (`b`) at level 0 on a
  plain at level 2, so each bank is a 2-LEVEL cliff (172 bed-bank pairs, each exactly two levels) and a rifleman in the bed is hidden from
  the plain; vehicles cannot enter it. It keeps the S-curve (amplitude 3.2, period 104 along `x - y`) and the three fords (`x - y` at 0 and
  +-27), each a gap of five `x - y` values with a level-1 ramp tile on each bank. A house on the lip has eyes (`floors - 1` levels) into it.
- **Bir Sawda, a town at the centre ford.** Four six-tile walled yards (16 wall tiles each, two two-tile gates facing the road): A north-east
  of the road and B south-west of it on seat 0's bank, their half-turns on seat 1's. A holds the two-floor house, on the lip over the ford,
  and a shed; B a shed and a pump house. 64 wall tiles, 2 houses, 4 sheds, 2 pump houses; 24 building tiles, 3.6% of the `town` zone
  (27,27,26,26), which is the new zone the visibility gate holds to 85%. The main road runs between the yards, 5 or more tiles off every corner.
- **Tells with bare slopes.** A stepped hill (one level a tile on a 45-degree line, so no 2x2 staircase), a crown of 8 rock tiles at level 5
  and a ring of 12 knoll at level 4, then open ground at 3: nothing grows on the slope. The shipped tell was a field of cover-2 knoll blocks.
- **Octagon mesas.** A crown of 8 rock tiles at level 6, a plateau at 5, a skirt at 4 and a scree ring at 3 that runs off BOTH map edges (so
  the NE corner is a closed pocket and the ring is the seal), with a west and a south ramp. The shipped mesas were discs drawn on 2x2
  cells, which is where its 26 fat stairs came from; the redo reads 0 (the exemption `maxFatStairs: 26` is not carried).
- **The funnel.** Two jagged strips of scree (`b`, level 2: a wall to wheels, open ground to a man on foot) beside the main road from the
  shelf's lip to the town, an unbroken core of two tiles and a hashed fringe. Armour on the centre road is committed; infantry walk over.
- **Cover** 10.75% (band 10-14%), scrub belts on the foot lanes and acacia along the cliff lip, never cover 3, none on the armour lanes
  (the road, the ford tracks) and none inside a yard. The wells keep their walled 8x8 yards and gates but hold a one-floor shed where the
  shipped map had a two-floor house; they now read 97.2% / 94.4% against the 92% scoring cap (the shipped wells read 91.7%).
- **The seal.** The bed, the three fords and the two mesas are one line from corner to corner. A vehicle crosses at a ford or over a mesa
  and nowhere else (`large_map_verify.ts`: all plugged, no route; the centre ford alone 800, the inner fords 966, the mesas 1,192, each
  equal both ways). A hole in the bed turns it red. A hole in a mesa's ring does not: the plug covers the whole mesa rectangle, so only the
  bed can leak (the test does not claim otherwise).

The versus visibility gate reads it at **99.75% whole map, 100% corridor, 98.6% town, 100% centre, 0.75% built, houses 17%**. The spec
(`SPECS.rujm_sawda_redo`) holds a `towns: ['town']` list, so it is OUT of the exempt set (which stays the three offered maps) and the
built-share cap is 1%.

### What B4 read on the redo (mirror only, 4 Nov 2026)

`versus:probe --maps=rujm_sawda --arr=kdf/kdf,sarim/sarim --cap=2100` on the staged geometry (copied over the data paths in a SCRATCH
worktree, sha256 `917460716f3f...` for the map, `6dd0c6826c9b...` for the rules), placed forces, on the base `d1c2c2649` (an arena commit
past the branch's: no sim change). The geometry was read once on seeds 0-191 and once on the held-out 4000-4287; no lever was pulled.

| Cell (west / east, east share) | 0-191 | held-out 4000-4287 | pooled 480 | the SHIPPED map, same seeds |
|---|---|---|---|---|
| KDF v KDF (the offered cell) | 88 / 104 (east 54.2%) | 135 / 153 (east 53.1%) | 223 / 257 (**east 53.5%**) | 241 / 239 (west 50.2%) |
| Sarim v Sarim (report only) | 85 / 107 (east 55.7%) | 136 / 152 (east 52.8%) | 221 / 259 (east 54.0%) | 240 / 240 (50.0%) |

Inside 60/40 on both reads. The redo leans east by about 3.5 points where the shipped map reads even; at 480 games the standard error is
2.3 points, so that is 1.5 sigma, a lean to watch and not a finding. Not re-read: one-tile seat shifts, S4 formations, the economy and
tunnel cells (the redo changes none of the economy, but its ground is new: a KDF v Sarim opening needs them), and the lane probe of design
section 4. **Formations are OPEN on `rujm_sawda`** (`VERSUS_FORMATIONS_CLOSED_MAPS` is empty since 7 Nov and only the tel_marum economy room is closed; the shipped geometry passed
its own S4 on 3 Nov), so a file-copy swap would open an unchecked geometry with formations on: in the same commit either re-run S4 on fresh
seeds (`pnpm s4:gate` over `versus:probe --per-seed` files) or add `rujm_sawda` to `VERSUS_FORMATIONS_CLOSED_MAPS`.

### Opening it (what the swap changes)

A file copy of the staged map over `data/maps/rujm_sawda.json` (the rules file is already identical), the redo's generator in place of
`tools/maps/rujm_sawda/build.mjs`, `SPECS.rujm_sawda_redo` under `rujm_sawda` in `large_map_verify.ts` (and its test file's registration
block), and the pins the new data moves. A full `pnpm test` on the copied data (4 Nov, scratch worktree, nothing else changed) reads
exactly these 14 tests in 7 files red, and nothing else:

- `terrain-defaults.test.ts`: the `rujm_sawda` digest in `terrain-defaults.fixture.json`;
- `high_ground_maps.test.ts`: the `rujm_sawda` rise count and the relief total;
- `presentation_census.test.ts` (Rujm block, 4 tests): the slope counts a seat, the x-flip mutation's 16.6% / 307 and the half-turn control;
- `rujm_sawda.test.ts` (5 tests) and `large_map_verify.test.ts` ("Rujm Sawda passes every check, its mesas' 26 staircases"): the shipped map's own
  landmarks, verifier and 26-step exemption become the redo's, which is `rujm_sawda_redo.test.ts` with the registration block put back;
- `map_visibility.test.ts`: the report-only reading "its four walled wells read 91.7%" is gone (they read 97.2% / 94.4%);
- `map_lib_mutations.test.ts`: the library control that rebuilds the shipped Rujm files from `tools/maps/lib`.

`snapshot-rejoin`, `versus_maps`, `ambience`, `crown-summit` and the Free Play card line did not move. The Free Play line for Rujm Sawda
should still be read against the redo's description. **Before opening:** S4 or the `VERSUS_FORMATIONS_CLOSED_MAPS` entry (above); the budget
step (`perf:fx` at the centre and a seat, `perf:memory`; no new mesh type, so no GPU growth is expected); `pnpm net:budget` at 222 structures;
the tick probe for `recomputeFields('opened')` when a wall is destroyed; the lane probe; and, for a KDF v Sarim opening, the economy and
tunnel cells on the new ground.

### What the opening checks read (GH-974, 4 Nov 2026): the redo is NOT opened

Every check "Opening it" lists was run on the staged bytes (map sha256 `917460716f3f...`, rules `6dd0c6826c9b...`), copied over the data paths in a
scratch tree and sha-checked back to main's (`74b35cbce41f...`, `6dd0c6826c9b...`) after each run. **One fails, so the map stays staged**: the render
budget (frame cost at the centre). The lane probe first read a 20-point seat gap, which was the probe's own bug (below). 

| Check | Reading | Verdict |
|---|---|---|
| S4 formations (mirror, KDF v KDF, seeds 30000-30191 = set A, shipped Attack, the arms and seeds of PR 978) | (b) both ends 51.0% [base 47.9]; (c) friendly end formed 50.5% [47.9]; (c) hostile end formed 53.1% [52.1]. Bars 55 / 60 / 60. Paired sign test p 0.55 / 0.60 / 0.90 | PASS, 3 of 3, no RERUN, 0 TRIP. `VERSUS_FORMATIONS_CLOSED_MAPS` need not name it |
| Lane probe (`tools/src/backtest/lane-probe.ts`, 35-minute cap, 192 seeds a cell; the first read, with the probe's corner bug, was +17.7 / +21.9 and pooled +19.8 points) | **Fixed probe** (PR of 4 Nov, distance to the tile centre), splitter west / east: armour left 79.2 / 87.5 (6000), 82.3 / 85.4 (24000), 82.3 / 86.5 (24192), pooled 576 81.3 / 86.5 = -5.2; armour right 73.4 / 81.3, 77.6 / 81.3, 79.7 / 80.7, pooled 76.9 / 81.1 = -4.2. Shipped map, same fixed probe (cap 600 s): 6000 +5.7 / +8.3, 24000 +4.2 / +0.5 | **PASS** (bar 10 points, six of six reads inside; the east lean of 4-5 points is unchased, see below) |
| `net:budget` at 222 structures, 42,000 ticks (35.0 min) | idle 2,562 rows at real-time pacing (measured 2,165); heavy 2,671 (measured 2,280), log 291,624 characters of 2,800,000 (10.4%), snapshot 9,851 B gzip held, 9,945 B largest, end world 378,363 B raw / 9,738 B gzip; rush (a real battle) 133 rows, ends at 1.7 minutes. Bounds 2,555-4,655 rows, 64 KiB, 1 MiB | PASS |
| Wall-fall tick probe (`tools/src/perf/wall-fall.ts`, `--live=128 --rounds=5`, the 16-followed row `--live=16 --rounds=5`, the shipped row the default `--rounds=3`): every one of the 222 structures levelled, 128 flow fields followed (the pool's worst case) | CPU time per wall: median 0.75 ms, p95 2.2, p99 3.6, max 7.5 (n=1,110, five worlds). 16 followed: median 0.07, max 2.2. The shipped map (156 structures): median 0.54, p95 1.95, max 6.1 | PASS (plan threshold: median 10 ms; a tick is 50 ms) |
| Render, `perf:fx --breakdown`, 12 cells paired with the 48x48 `milh_flats`, 12 rounds of 30 frames, dpr 2, 1440x900, ANGLE Metal on an Apple M3 Pro, one browser on :5198, music off, load average 9-13 | high centre **z1 +1.30 ms** (12 of 12 rounds slower), **z1.6 +1.20**, z2.5 -0.60; high seat z1 +0.30, z1.6 +0.05, z2.5 0.00; medium centre **z1 +1.45, z1.6 +1.00**, z2.5 -0.90; medium seat z1 +0.50 (12 of 12), z1.6 +0.20, z2.5 +0.05. Bar +0.5 | **FAIL**: 4 of 12 cells over the bar, all at the centre |
| `perf:memory` sandbox, 1400x900 at 1x, 30 s of sim time | JS 138.8 MiB (ceiling 153), GPU ledger 860.1 MiB (1,015), all processes 2,208 MiB (2,880). ImageBitmaps 176 MiB against 161 FAIL, and the 48x48 control reads 364 on the same run (the roster artefact every large map has read) | PASS on the three budgets that bind; the bitmap line is the control's too |
| Seat shifts (report only; each of the 8 one-tile shifts of seat 0, seat 1 its half-turn; seeds 4000-4287) | KDF v KDF west share, unshifted 46.9: shifts (-1,-1) 47.2, (0,-1) 50.7, (1,-1) 46.2, (-1,0) 52.4, (1,0) 50.3, (-1,1) 52.1, (0,1) 54.9, (1,1) 54.2. Sarim v Sarim, unshifted 47.2: 51.0, 50.3, 52.4, 49.0, 46.9, 47.0, 46.9, 49.3 (the (-1,1) cell has one draw) | all 16 inside 60/40; widest 54.9 |

**The render budget fails by less than the first Milh build, and by more than the triangle estimate said.** The structure triangles are the control's
(3,184k against 3,157k at the centre, z1) and the redo still reads +1.30 ms, with 237 draw calls against 203. Splitting the redo (high, centre z1, 10 rounds,
paired with the control): no walls -1.00 ms, no walls and no buildings -1.50, whole +1.30 (the whole is the head-to-head run, the two splits their own runs of 10 rounds, so the differences between them are indicative). The 208 walls are about 2.3 ms of the
cost and the 14 buildings about 0.5; with every wall and building removed the redo reads 1.5 ms UNDER the control. A wall LOD (or a cheaper wall mesh, 3,087 triangles
a tile) is the lever; the walls are instanced already (`renderer.md`).

**The lane probe read a probe bug, not a map defect (fixed 4 Nov).** The first read (armour left, infantry right: west 90.6 / 89.6, east 72.9 / 67.7, pooled gap +19.8 points; the shipped map +8.9 and +3.6) was `lane-probe.ts` measuring "reached the lane" to the marker's integer tile index, the tile's NW corner, while positions are continuous and the centre is index + 0.5. A group coming from the north-west (the west seat) needed to be within about 8.7 tiles of the centre, one from the south-east (the east seat) within about 7.3, and the 20 s order step turned 1.4 tiles into a whole step: mean tick at which the armour was marked passed, 40.9 s / 42.5 s west against 60.1 s east (48 seeds a cell); after the fix 48.0 / 49.6 against 47.1 / 52.1. The map is exactly half-turn symmetric (grid and elevation, 0 of 6,400 tiles differ), and the flow-field routes from every versus spawn tile to either ford are the exact half-turn of the other seat's (foot and vehicle masks, equal costs 490 and 452); the first hypothesis checked, a non-equivariant tie-break, was ruled out before the probe was fixed.

Fixed probe, redo, splitter west / east (gap = west minus east), seeds 6000, 24000 and 24192 (the last two fresh):

| Arm | 6000 | 24000 | 24192 | Pooled 576 |
|---|---|---|---|---|
| Armour left, infantry right | 79.2 / 87.5 (-8.3) | 82.3 / 85.4 (-3.1) | 82.3 / 86.5 (-4.2) | 81.3 / 86.5 (-5.2) |
| Armour right, infantry left | 73.4 / 81.3 (-7.8) | 77.6 / 81.3 (-3.6) | 79.7 / 80.7 (-1.0) | 76.9 / 81.1 (-4.2) |

The unfixed probe on the fresh ranges read +26.0 and +27.1 (armour left) and +1.6 and +5.7 (armour right), so the artefact repeats on new seeds. Shipped map, fixed probe: 6000 +5.7 (armour left) / +8.3 (armour right), 24000 +4.2 / +0.5; so its earlier +8.9 / +3.6 was the same bug and a west lean of about 5 points remains.

**Unchased residual.** With the fix the redo leans EAST by 4-5 points in both arms (pooled z about -2.4 in the armour-left arm) and the shipped map leans WEST by about 5. Both are inside the 10-point bar and neither was chased. Two suspects, unchecked: unit-id order (side 0 spawns first, so ties in targeting and movement go to the west) and `centroid`'s `Math.round` of raw coordinates, which is not half-turn equivariant. `lane-probe.ts` is report-only and exits 0.

What the redo needs before it opens: a wall LOD or fewer wall tiles in the centre window (+1.3 ms to under +0.5), and then a swap commit with the 14 pins listed above. S4, `net:budget`, the tick probe, `perf:memory` and the seat shifts need no further work.
