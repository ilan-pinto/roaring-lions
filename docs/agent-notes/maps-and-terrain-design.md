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
Design decision 7 says to instance the per-tile structures above +1 ms; that is renderer work, and with walls instanced the
centre reads about +1.1, the first build's own figure. The extra JS (+2.3 MiB) and building textures (+64 MiB of GPU: a house, a
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

The swap is a file copy of the staged map and rules over `data/maps/milh_flats_l.json` and `data/versus/milh_flats_l.json`, plus
every pin the new data moves, each re-read independently of the code: `high_ground_maps.test.ts` `milh_flats_l: 2` (and the
relief total, 154), `presentation_census.test.ts` (160 slope tiles a seat, lit 0/160 and 160/0, twin mismatches 160, x-flip
285/135), the Free Play card line in `en.json`, the generator (`tools/maps/milh_flats_l/build.mjs` becomes the redo's) and
`milh_flats_l.test.ts`. `_coord/milh-l-redo/swap.patch` holds that commit, tested.
