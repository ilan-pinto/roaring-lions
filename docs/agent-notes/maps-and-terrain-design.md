# Qarn Hadid and relief authoring

Moved verbatim from `CLAUDE.md` (origin/main `f946bb16`, 2026-10-25) when that file was slimmed to its rules.
The rules distilled from these passages stay in `CLAUDE.md`; this file keeps the measurements, history,
reasoning and superseded statements behind them, unedited. Nothing here has been pruned yet.

<!-- CLAUDE.md lines 506-531, section "Dev instruments" -->

- **`qarn_hadid` is the terrain map** — the only one carrying all ten terrain
  symbols, and the only place `3` (cover 3) and `d` (the anti-tank ditch) are
  authored at all; both had ZERO tiles anywhere before it. Sandbox-only until 2026-09-07; it now carries the three Qarn Hadid missions
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
