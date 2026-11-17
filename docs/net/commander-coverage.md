# The commander coverage probe: can the computer take either seat on every versus map and win mode? (GH-1390)

**Date:** 2026-11-17. **Status:** a report. Nothing here changes the game: no `tuning.ts`, no sim code, no balance number. The probe is report-only
tooling (`pnpm commander:probe`, `tools/src/backtest/commander-probe.ts`); it exits 0 whatever the table says.

## 0. The answers up front

1. **The probe ran every open cell: 124 cells (map x pairing x win mode x commander seat x baseline) x 8 seeds = 992 games, all played, none
   refused, none errored, none left undecided** (about 19 minutes of game time on one core; 4 workers).
2. **The brief's STALL ("no order for 60 s") fires on 845 of 992 games (85%).** It cannot be the measure of "stopped playing": the shipped
   commander is the arena's `rush` script, which attack-moves what it has at home once and then fights. Median **2 orders a game**; **654 games
   (66%) gave 3 or fewer**. A seat in a firefight is silent by design. The diagnostic that means "it stopped playing" is the second one, **60 s
   of silence while an idle, able unit stood by: 0 of 992 games** (the longest such stretch is 100 ticks, 5 s), because the straggler sweep
   of GH-1388 re-orders every able idle unit at each 5 s decision.
3. **There is no "commander" in the sense of GH-188.** The only computer opponent is the `ComputerSeat` (GH-1388): `rush` plus a straggler sweep.
   It builds nothing, takes no zone, holds no flag. GH-188's doctrine commander is not in the tree (`network-next.md` row 5 says the same:
   "the real commander is GH-188's, at cost L"). There is also no "sensible" baseline for versus (the campaign's ladders are mission
   plans), so the baselines are the arena's two scripted controls, `passive` and `rush`. Neither is invented here.
4. **The lobby seats the computer only in the mirror, annihilation (`offlineConfig`).** The probe builds the room's own config instead (as
   `versus-probe.ts` does), so it plays all 124 cells; no player can reach 100 of them today.
5. **The real gaps, in order of size (section 3):** (A) in an **economy** cell (KDF v Sarim, annihilation) the commander never builds, so the match
   cannot end by itself: **180 of 192 games (94%) were decided by the clock** (25 minutes, 35 on the large maps); (B) the **points and flag goals are
   never played**: points ended on its goal in 5 of 224 mirror games and flag in **0 of 128** (everything else ended by annihilation first); (C) the
   commander **loses to a passive opponent in 223 of 496 games (45%)**, 25 of 62 passive cells at 4 or more of 8, worst on `wadi_tarfan_l`
   (8 of 8 in every cell but the camp mode).

## 1. What was measured

```bash
pnpm commander:probe -- --seeds=8 --jobs=4 --out=/tmp/commander-probe          # the whole matrix
pnpm commander:probe -- --maps=tel_marum --modes=annihilation --baselines=passive --seeds=2
```

- **Cells** are read from `@lions/net`'s own tables, not copied: `VERSUS_FAIR_MAPS` (7 maps), `matchupAllowed` (the mirror anywhere; KDF v Sarim on
  `tel_marum`, `wadi_tarfan`, `wadi_tarfan_l`), `winModesOffered(map, matchup)` plus annihilation. The commander plays seat 0 and seat 1;
  its faction follows the pairing (so a Sarim commander exists only in the faction cells).
- **A game** is the room's own world (`buildMatchWorld`, `matchTick`), two seats down the battlefield's own frame path (`runFrames`), decided by
  the real outcome rule (`decideOnHashTick`) at the room's own cap (`matchCapTicksOf`). Seeds are `1000 + 7919 n`, as `versus-probe` has them.
  The flag rooms carry the set-up rules (`flagSetupFor`) as the Worker mints them.
- **The commander** is `ComputerSeat` with its default policy, unchanged. **Baselines:** `passive` orders nothing (a plain `ComputerSeat` with a null
  policy would still sweep its idle units, so the probe has its own silent seat); `rush` is the same `ComputerSeat` on the other seat.
- **Stall, two readings.** *Literal:* the commander's longest stretch with no order, from tick 0 to the end of the game, is 60 s or more.
  *Idle:* the same, but only counting a stretch in which an idle, able unit (not disarmed, immobile, routed or down) stood by at every 5 s
  boundary, read off the sim with the app's own `isIdle`, independent of the seat's view.
- **Self-checks, each seen red:** a commander that never orders reads as both stalls (`playGame(..., { commander: 'silent' })`); a detector that
  counted men down as idle was found by the first full run (tel_marum mirror, seed 40595: 1460 "idle" ticks in a game where the seat had no
  unit left) and fixed, with that game as its regression test.

## 2. The table

Columns: stalls are games out of 8 (literal, then idle-unit); times are medians; W / L / D / undecided are the COMMANDER's.

| map | matchup | mode | commander (seat, faction) | vs | games | stalls (60 s, literal) | stalls (60 s, idle unit) | median first order | median length | W / L / D / undecided | decided by | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| beit_sahwan_outskirts | mirror | annihilation | 0, kdf | passive | 8 | 6 | 0 | 5 s | 135 s | 8 / 0 / 0 / 0 | annihilation 8 |  |
| beit_sahwan_outskirts | mirror | annihilation | 0, kdf | rush | 8 | 8 | 0 | 5 s | 138 s | 3 / 5 / 0 / 0 | annihilation 8 |  |
| beit_sahwan_outskirts | mirror | annihilation | 1, kdf | passive | 8 | 5 | 0 | 5 s | 156 s | 5 / 3 / 0 / 0 | annihilation 8 |  |
| beit_sahwan_outskirts | mirror | annihilation | 1, kdf | rush | 8 | 6 | 0 | 5 s | 138 s | 5 / 3 / 0 / 0 | annihilation 8 |  |
| beit_sahwan_outskirts | mirror | points | 0, kdf | passive | 8 | 6 | 0 | 5 s | 135 s | 8 / 0 / 0 / 0 | annihilation 8 |  |
| beit_sahwan_outskirts | mirror | points | 0, kdf | rush | 8 | 8 | 0 | 5 s | 138 s | 3 / 5 / 0 / 0 | annihilation 6, objective/points 2 |  |
| beit_sahwan_outskirts | mirror | points | 1, kdf | passive | 8 | 5 | 0 | 5 s | 156 s | 6 / 2 / 0 / 0 | annihilation 7, objective/points 1 |  |
| beit_sahwan_outskirts | mirror | points | 1, kdf | rush | 8 | 6 | 0 | 5 s | 138 s | 5 / 3 / 0 / 0 | annihilation 6, objective/points 2 |  |
| milh_flats_l | mirror | annihilation | 0, kdf | passive | 8 | 8 | 0 | 5 s | 286 s | 1 / 7 / 0 / 0 | annihilation 8 |  |
| milh_flats_l | mirror | annihilation | 0, kdf | rush | 8 | 8 | 0 | 5 s | 180 s | 4 / 4 / 0 / 0 | annihilation 8 |  |
| milh_flats_l | mirror | annihilation | 1, kdf | passive | 8 | 8 | 0 | 5 s | 296 s | 2 / 6 / 0 / 0 | annihilation 7, time 1 |  |
| milh_flats_l | mirror | annihilation | 1, kdf | rush | 8 | 8 | 0 | 5 s | 180 s | 4 / 4 / 0 / 0 | annihilation 8 |  |
| milh_flats_l | mirror | flag | 0, kdf | passive | 8 | 8 | 0 | 5 s | 423 s | 2 / 6 / 0 / 0 | annihilation 8 |  |
| milh_flats_l | mirror | flag | 0, kdf | rush | 8 | 8 | 0 | 5 s | 252 s | 4 / 4 / 0 / 0 | annihilation 8 |  |
| milh_flats_l | mirror | flag | 1, kdf | passive | 8 | 8 | 0 | 5 s | 483 s | 2 / 6 / 0 / 0 | annihilation 8 |  |
| milh_flats_l | mirror | flag | 1, kdf | rush | 8 | 8 | 0 | 5 s | 252 s | 4 / 4 / 0 / 0 | annihilation 8 |  |
| milh_flats_l | mirror | points | 0, kdf | passive | 8 | 8 | 0 | 5 s | 286 s | 1 / 7 / 0 / 0 | annihilation 8 |  |
| milh_flats_l | mirror | points | 0, kdf | rush | 8 | 8 | 0 | 5 s | 180 s | 4 / 4 / 0 / 0 | annihilation 8 |  |
| milh_flats_l | mirror | points | 1, kdf | passive | 8 | 8 | 0 | 5 s | 296 s | 2 / 6 / 0 / 0 | annihilation 7, time 1 |  |
| milh_flats_l | mirror | points | 1, kdf | rush | 8 | 8 | 0 | 5 s | 180 s | 4 / 4 / 0 / 0 | annihilation 8 |  |
| milh_flats | mirror | annihilation | 0, kdf | passive | 8 | 8 | 0 | 5 s | 229 s | 2 / 6 / 0 / 0 | annihilation 8 |  |
| milh_flats | mirror | annihilation | 0, kdf | rush | 8 | 8 | 0 | 5 s | 164 s | 1 / 7 / 0 / 0 | annihilation 8 |  |
| milh_flats | mirror | annihilation | 1, kdf | passive | 8 | 7 | 0 | 5 s | 258 s | 1 / 7 / 0 / 0 | annihilation 8 |  |
| milh_flats | mirror | annihilation | 1, kdf | rush | 8 | 7 | 0 | 5 s | 164 s | 7 / 1 / 0 / 0 | annihilation 8 |  |
| milh_flats | mirror | camp | 0, kdf | passive | 8 | 8 | 0 | 5 s | 84 s | 8 / 0 / 0 / 0 | objective/camp 8 |  |
| milh_flats | mirror | camp | 0, kdf | rush | 8 | 8 | 0 | 5 s | 198 s | 1 / 7 / 0 / 0 | objective/camp 8 |  |
| milh_flats | mirror | camp | 1, kdf | passive | 8 | 8 | 0 | 5 s | 142 s | 7 / 1 / 0 / 0 | objective/camp 7, time 1 |  |
| milh_flats | mirror | camp | 1, kdf | rush | 8 | 7 | 0 | 5 s | 198 s | 7 / 1 / 0 / 0 | objective/camp 8 |  |
| milh_flats | mirror | points | 0, kdf | passive | 8 | 8 | 0 | 5 s | 229 s | 2 / 6 / 0 / 0 | annihilation 8 |  |
| milh_flats | mirror | points | 0, kdf | rush | 8 | 8 | 0 | 5 s | 164 s | 1 / 7 / 0 / 0 | annihilation 8 |  |
| milh_flats | mirror | points | 1, kdf | passive | 8 | 7 | 0 | 5 s | 258 s | 1 / 7 / 0 / 0 | annihilation 8 |  |
| milh_flats | mirror | points | 1, kdf | rush | 8 | 7 | 0 | 5 s | 164 s | 7 / 1 / 0 / 0 | annihilation 8 |  |
| rujm_sawda | mirror | annihilation | 0, kdf | passive | 8 | 8 | 0 | 5 s | 232 s | 5 / 3 / 0 / 0 | annihilation 8 |  |
| rujm_sawda | mirror | annihilation | 0, kdf | rush | 8 | 8 | 0 | 5 s | 172 s | 2 / 6 / 0 / 0 | annihilation 8 |  |
| rujm_sawda | mirror | annihilation | 1, kdf | passive | 8 | 8 | 0 | 5 s | 265 s | 5 / 3 / 0 / 0 | annihilation 8 |  |
| rujm_sawda | mirror | annihilation | 1, kdf | rush | 8 | 7 | 0 | 5 s | 172 s | 6 / 2 / 0 / 0 | annihilation 8 |  |
| rujm_sawda | mirror | flag | 0, kdf | passive | 8 | 8 | 0 | 5 s | 361 s | 6 / 2 / 0 / 0 | annihilation 8 |  |
| rujm_sawda | mirror | flag | 0, kdf | rush | 8 | 8 | 0 | 5 s | 280 s | 6 / 2 / 0 / 0 | annihilation 8 |  |
| rujm_sawda | mirror | flag | 1, kdf | passive | 8 | 8 | 0 | 5 s | 356 s | 5 / 3 / 0 / 0 | annihilation 7, time 1 |  |
| rujm_sawda | mirror | flag | 1, kdf | rush | 8 | 8 | 0 | 5 s | 280 s | 2 / 6 / 0 / 0 | annihilation 8 |  |
| rujm_sawda | mirror | points | 0, kdf | passive | 8 | 8 | 0 | 5 s | 232 s | 5 / 3 / 0 / 0 | annihilation 8 |  |
| rujm_sawda | mirror | points | 0, kdf | rush | 8 | 8 | 0 | 5 s | 172 s | 2 / 6 / 0 / 0 | annihilation 8 |  |
| rujm_sawda | mirror | points | 1, kdf | passive | 8 | 8 | 0 | 5 s | 265 s | 5 / 3 / 0 / 0 | annihilation 8 |  |
| rujm_sawda | mirror | points | 1, kdf | rush | 8 | 7 | 0 | 5 s | 172 s | 6 / 2 / 0 / 0 | annihilation 8 |  |
| tel_marum | kdf | annihilation | 0, kdf | passive | 8 | 1 | 0 | 5 s | 143 s | 8 / 0 / 0 / 0 | annihilation 6, time 2 |  |
| tel_marum | kdf | annihilation | 0, kdf | rush | 8 | 8 | 0 | 5 s | 1500 s | 3 / 5 / 0 / 0 | time 8 |  |
| tel_marum | kdf | annihilation | 1, sarim | passive | 8 | 8 | 0 | 5 s | 1500 s | 8 / 0 / 0 / 0 | time 8 |  |
| tel_marum | kdf | annihilation | 1, sarim | rush | 8 | 4 | 0 | 5 s | 1500 s | 5 / 3 / 0 / 0 | time 8 |  |
| tel_marum | mirror | annihilation | 0, kdf | passive | 8 | 7 | 0 | 5 s | 148 s | 6 / 2 / 0 / 0 | annihilation 7, time 1 |  |
| tel_marum | mirror | annihilation | 0, kdf | rush | 8 | 4 | 0 | 5 s | 100 s | 3 / 5 / 0 / 0 | annihilation 8 |  |
| tel_marum | mirror | annihilation | 1, kdf | passive | 8 | 6 | 0 | 5 s | 155 s | 1 / 7 / 0 / 0 | annihilation 8 |  |
| tel_marum | mirror | annihilation | 1, kdf | rush | 8 | 4 | 0 | 5 s | 100 s | 5 / 3 / 0 / 0 | annihilation 8 |  |
| tel_marum | mirror | points | 0, kdf | passive | 8 | 7 | 0 | 5 s | 148 s | 6 / 2 / 0 / 0 | annihilation 7, time 1 |  |
| tel_marum | mirror | points | 0, kdf | rush | 8 | 4 | 0 | 5 s | 100 s | 3 / 5 / 0 / 0 | annihilation 8 |  |
| tel_marum | mirror | points | 1, kdf | passive | 8 | 6 | 0 | 5 s | 155 s | 1 / 7 / 0 / 0 | annihilation 8 |  |
| tel_marum | mirror | points | 1, kdf | rush | 8 | 4 | 0 | 5 s | 100 s | 5 / 3 / 0 / 0 | annihilation 8 |  |
| tel_marum | sarim | annihilation | 0, sarim | passive | 8 | 2 | 0 | 5 s | 1500 s | 7 / 1 / 0 / 0 | time 8 |  |
| tel_marum | sarim | annihilation | 0, sarim | rush | 8 | 4 | 0 | 5 s | 1500 s | 8 / 0 / 0 / 0 | time 8 |  |
| tel_marum | sarim | annihilation | 1, kdf | passive | 8 | 8 | 0 | 5 s | 1500 s | 2 / 6 / 0 / 0 | time 8 |  |
| tel_marum | sarim | annihilation | 1, kdf | rush | 8 | 8 | 0 | 5 s | 1500 s | 0 / 8 / 0 / 0 | time 8 |  |
| wadi_tarfan_l | kdf | annihilation | 0, kdf | passive | 8 | 8 | 0 | 5 s | 2100 s | 0 / 8 / 0 / 0 | time 8 |  |
| wadi_tarfan_l | kdf | annihilation | 0, kdf | rush | 8 | 8 | 0 | 5 s | 2100 s | 3 / 5 / 0 / 0 | time 6, annihilation 2 |  |
| wadi_tarfan_l | kdf | annihilation | 1, sarim | passive | 8 | 8 | 0 | 5 s | 2100 s | 0 / 8 / 0 / 0 | time 8 |  |
| wadi_tarfan_l | kdf | annihilation | 1, sarim | rush | 8 | 8 | 0 | 5 s | 2100 s | 5 / 3 / 0 / 0 | time 6, annihilation 2 |  |
| wadi_tarfan_l | kdf | camp | 0, kdf | passive | 8 | 7 | 0 | 5 s | 67 s | 8 / 0 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan_l | kdf | camp | 0, kdf | rush | 8 | 8 | 0 | 5 s | 185 s | 0 / 8 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan_l | kdf | camp | 1, sarim | passive | 8 | 0 | 0 | 5 s | 38 s | 8 / 0 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan_l | kdf | camp | 1, sarim | rush | 8 | 8 | 0 | 5 s | 185 s | 8 / 0 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan_l | mirror | annihilation | 0, kdf | passive | 8 | 8 | 0 | 5 s | 190 s | 0 / 8 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan_l | mirror | annihilation | 0, kdf | rush | 8 | 8 | 0 | 5 s | 203 s | 5 / 3 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan_l | mirror | annihilation | 1, kdf | passive | 8 | 8 | 0 | 5 s | 193 s | 0 / 8 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan_l | mirror | annihilation | 1, kdf | rush | 8 | 8 | 0 | 5 s | 203 s | 3 / 5 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan_l | mirror | camp | 0, kdf | passive | 8 | 7 | 0 | 5 s | 72 s | 8 / 0 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan_l | mirror | camp | 0, kdf | rush | 8 | 8 | 0 | 5 s | 261 s | 4 / 4 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan_l | mirror | camp | 1, kdf | passive | 8 | 8 | 0 | 5 s | 67 s | 8 / 0 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan_l | mirror | camp | 1, kdf | rush | 8 | 8 | 0 | 5 s | 261 s | 4 / 4 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan_l | mirror | flag | 0, kdf | passive | 8 | 8 | 0 | 5 s | 361 s | 0 / 8 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan_l | mirror | flag | 0, kdf | rush | 8 | 8 | 0 | 5 s | 247 s | 4 / 4 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan_l | mirror | flag | 1, kdf | passive | 8 | 8 | 0 | 5 s | 344 s | 0 / 8 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan_l | mirror | flag | 1, kdf | rush | 8 | 8 | 0 | 5 s | 247 s | 4 / 4 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan_l | mirror | points | 0, kdf | passive | 8 | 8 | 0 | 5 s | 190 s | 0 / 8 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan_l | mirror | points | 0, kdf | rush | 8 | 8 | 0 | 5 s | 203 s | 5 / 3 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan_l | mirror | points | 1, kdf | passive | 8 | 8 | 0 | 5 s | 193 s | 0 / 8 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan_l | mirror | points | 1, kdf | rush | 8 | 8 | 0 | 5 s | 203 s | 3 / 5 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan_l | sarim | annihilation | 0, sarim | passive | 8 | 8 | 0 | 5 s | 2100 s | 0 / 8 / 0 / 0 | time 8 |  |
| wadi_tarfan_l | sarim | annihilation | 0, sarim | rush | 8 | 7 | 0 | 5 s | 2100 s | 7 / 1 / 0 / 0 | time 8 |  |
| wadi_tarfan_l | sarim | annihilation | 1, kdf | passive | 8 | 8 | 0 | 5 s | 2100 s | 0 / 8 / 0 / 0 | time 8 |  |
| wadi_tarfan_l | sarim | annihilation | 1, kdf | rush | 8 | 8 | 0 | 5 s | 2100 s | 1 / 7 / 0 / 0 | time 8 |  |
| wadi_tarfan_l | sarim | camp | 0, sarim | passive | 8 | 0 | 0 | 5 s | 38 s | 8 / 0 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan_l | sarim | camp | 0, sarim | rush | 8 | 6 | 0 | 5 s | 178 s | 8 / 0 / 0 / 0 | objective/camp 7, time 1 |  |
| wadi_tarfan_l | sarim | camp | 1, kdf | passive | 8 | 7 | 0 | 5 s | 66 s | 8 / 0 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan_l | sarim | camp | 1, kdf | rush | 8 | 8 | 0 | 5 s | 178 s | 0 / 8 / 0 / 0 | objective/camp 7, time 1 |  |
| wadi_tarfan | kdf | annihilation | 0, kdf | passive | 8 | 8 | 0 | 5 s | 1500 s | 0 / 8 / 0 / 0 | time 8 |  |
| wadi_tarfan | kdf | annihilation | 0, kdf | rush | 8 | 8 | 0 | 5 s | 1500 s | 2 / 6 / 0 / 0 | time 7, annihilation 1 |  |
| wadi_tarfan | kdf | annihilation | 1, sarim | passive | 8 | 2 | 0 | 5 s | 1500 s | 7 / 1 / 0 / 0 | time 8 |  |
| wadi_tarfan | kdf | annihilation | 1, sarim | rush | 8 | 5 | 0 | 5 s | 1500 s | 6 / 2 / 0 / 0 | time 7, annihilation 1 |  |
| wadi_tarfan | kdf | camp | 0, kdf | passive | 8 | 4 | 0 | 5 s | 92 s | 8 / 0 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan | kdf | camp | 0, kdf | rush | 8 | 8 | 0 | 5 s | 175 s | 2 / 6 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan | kdf | camp | 1, sarim | passive | 8 | 0 | 0 | 5 s | 21 s | 8 / 0 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan | kdf | camp | 1, sarim | rush | 8 | 7 | 0 | 5 s | 175 s | 6 / 2 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan | mirror | annihilation | 0, kdf | passive | 8 | 7 | 0 | 5 s | 231 s | 6 / 2 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan | mirror | annihilation | 0, kdf | rush | 8 | 7 | 0 | 5 s | 129 s | 3 / 5 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan | mirror | annihilation | 1, kdf | passive | 8 | 7 | 0 | 5 s | 178 s | 5 / 3 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan | mirror | annihilation | 1, kdf | rush | 8 | 6 | 0 | 5 s | 129 s | 5 / 3 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan | mirror | camp | 0, kdf | passive | 8 | 8 | 0 | 5 s | 78 s | 8 / 0 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan | mirror | camp | 0, kdf | rush | 8 | 8 | 0 | 5 s | 150 s | 3 / 5 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan | mirror | camp | 1, kdf | passive | 8 | 4 | 0 | 5 s | 64 s | 8 / 0 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan | mirror | camp | 1, kdf | rush | 8 | 8 | 0 | 5 s | 150 s | 5 / 3 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan | mirror | flag | 0, kdf | passive | 8 | 8 | 0 | 5 s | 369 s | 6 / 2 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan | mirror | flag | 0, kdf | rush | 8 | 8 | 0 | 5 s | 257 s | 3 / 5 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan | mirror | flag | 1, kdf | passive | 8 | 8 | 0 | 5 s | 365 s | 7 / 1 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan | mirror | flag | 1, kdf | rush | 8 | 8 | 0 | 5 s | 257 s | 5 / 3 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan | mirror | points | 0, kdf | passive | 8 | 7 | 0 | 5 s | 231 s | 6 / 2 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan | mirror | points | 0, kdf | rush | 8 | 7 | 0 | 5 s | 129 s | 3 / 5 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan | mirror | points | 1, kdf | passive | 8 | 7 | 0 | 5 s | 178 s | 5 / 3 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan | mirror | points | 1, kdf | rush | 8 | 6 | 0 | 5 s | 129 s | 5 / 3 / 0 / 0 | annihilation 8 |  |
| wadi_tarfan | sarim | annihilation | 0, sarim | passive | 8 | 2 | 0 | 5 s | 1500 s | 7 / 1 / 0 / 0 | time 8 |  |
| wadi_tarfan | sarim | annihilation | 0, sarim | rush | 8 | 6 | 0 | 5 s | 1500 s | 6 / 2 / 0 / 0 | time 8 |  |
| wadi_tarfan | sarim | annihilation | 1, kdf | passive | 8 | 8 | 0 | 5 s | 1500 s | 0 / 8 / 0 / 0 | time 8 |  |
| wadi_tarfan | sarim | annihilation | 1, kdf | rush | 8 | 8 | 0 | 5 s | 1500 s | 2 / 6 / 0 / 0 | time 8 |  |
| wadi_tarfan | sarim | camp | 0, sarim | passive | 8 | 0 | 0 | 5 s | 21 s | 8 / 0 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan | sarim | camp | 0, sarim | rush | 8 | 4 | 0 | 5 s | 178 s | 6 / 2 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan | sarim | camp | 1, kdf | passive | 8 | 3 | 0 | 5 s | 102 s | 8 / 0 / 0 / 0 | objective/camp 8 |  |
| wadi_tarfan | sarim | camp | 1, kdf | rush | 8 | 8 | 0 | 5 s | 178 s | 2 / 6 / 0 / 0 | objective/camp 8 |  |

## 3. Findings

### A. Economy cells never end by themselves (the stall that matters)

KDF v Sarim in annihilation is an economy room: each seat has a purse and a camp, and a side with logistics left counts as standing
(`outcomeOf` with the production rule). The commander never queues a build, so once the starting forces are spent nobody can finish the other, and the
room runs to the clock: **180 of 192 games decided by `time`, median length 1500 s (2100 s on `wadi_tarfan_l`)**, with the commander's purse untouched. The
literal silence there is real (a seat with a menu and a purse that issues nothing for twenty minutes), though the idle-unit reading does not see it
because no unit is left to order. `offlineConfig` refuses these pairings for exactly this reason ("the computer builds nothing, so kdf and sarim
could never end"); the probe confirms the refusal was right and measures it. Cause: no production policy. `SideView.economy` already gives a
seat its purse, menu (with `blocked` reasons), lines and population, and `planRound` in `versus-probe.ts` is a rule that needs no new number
(rebuild toward the placed force's own mix), so the missing piece is a policy, not data.

### B. The points and flag goals are not played

Mirror `points`: 5 of 224 games ended on the points target; mirror `flag`: 0 of 128. They ended by annihilation (or the clock) because `rush`
attack-moves on the enemy camp or the contacts and never holds a zone, so a mode's goal does not constrain it. `camp` is the exception: it attacks the
camp, so the goal is reached (95 of 96 mirror games; 126 of 128 in the faction cells). The view already carries the points race and the flag zones
(`SideView`'s points and flag fields), so a goal-aware order is available to a policy; it is not in `rush`.

### C. The commander loses to doing nothing, often

Against `passive` it wins 273 of 496 (55%): 25 of 62 passive cells lost 4 or more of 8, by map: `wadi_tarfan_l` 10, `milh_flats_l` 6, `milh_flats` 4, `tel_marum` 3,
`wadi_tarfan` 2. The script's own doc says so ("a passive force waiting below the pass is the stronger side"). Not a stall: a quality gap.
Against `rush` it wins 248 of 496, seat 0 112 and seat 1 136 of 248, so the script is symmetric to within the map's seat bias. In the faction cells (which
the commander plays without building) the Sarim commander wins 126 of 160 and the KDF commander 57 of 160: a faction edge for a force that only attack-moves.

### What is and is not fixable here

- **Literal stalls (845)** are the script working as designed. No fix: the rule needs restating (the idle-unit reading is the one that can fail).
- **(A) economy** needs a production policy: a new decision layer, plus a product decision, because the lobby copy and the seat's name promise a
  computer that "builds nothing" (`computer-seat.test.ts`, "the label"). HOLD FOR THE LEAD.
- **(B) goals** need a goal-aware policy and the same copy decision. HOLD FOR THE LEAD.
- **(C)** is tactics, and where it needs a threshold or a weight it is a balance number. HOLD FOR THE LEAD.

Whatever the lead rules, the probe is the instrument for the "no stalled match" criterion of GH-1390: re-run it and read the two stall columns, the
"decided by" column and the W / L column.


## 4. Slice 2 of the commander: the scout and the counter (GH-1391)

Two more tasks in `createCommander`, both **off unless `CommanderOptions` turns them on** (`scout`, `counter`), because the probe below says neither raised the
win rate. They are plain heuristics in the app layer, commands only, over the same fog-honest `SideView`: no vision, no sim read, no `tuning.ts`, no unit-data change.

- **Scout.** At its first decision the seat sends its cheapest unit (by `cost.logistics`, then the faster, then the lower id; never its only unit) with a `move` to a
  point `RUSH_HOME_TILES` short of the enemy camp, the anchor a human reads off the map. It is kept out of the march, the zone shares and the straggler sweep; one scout, never replaced.
- **Counter.** The seat remembers, per enemy type, the most of it ever in sight at once (`view.contacts`). `composition.ts` classes a type from the unit data alone:
  *armour* is a hull whose front plate is above `SOFT_PENETRATION_CEILING` (120, derived: the best round any non-anti-armour, non-demolition weapon has), so only an
  anti-armour weapon (`atgm`, `apfsds`, `heat`, `rpg`, able to hit the ground) can hurt it; *air* is the authored air domain; any other armed unit is *soft*; an unarmed unit is *none*.
  More armour than soft seen: build an anti-armour menu unit whose round beats the strongest plate seen (else the strongest it has), until the seat has one for every armoured hull
  seen at once. More soft than armour: an infantry-role unit, until it has as many as soft units seen at once. Equal, nothing seen, parity met or nothing in the menu to answer: the slice 1 rule.

### What was measured (the same 992 games as section 1, 8 seeds a cell)

`--commander=slice1` is the slice 1 commander (it reproduces the earlier gate run: 992 of 992 games identical, to the tick and the outcome). `--commander=slice2` adds both tasks;
`--options='{"counter":false}'` and `--options='{"scout":false}'` give each alone (economy cells only, 320 games). Economy rooms, commander W / L of 80 games a row:

| commander | vs | variant | games | enemy at once (armour / soft, median) | commander saw (armour / soft, median) | first contact (median) | built a game (anti-armour / infantry / other) | W / L |
|---|---|---|---|---|---|---|---|---|
| kdf | rush | slice 1 (before) | 80 | 0 / 26 | 0 / 20 | 15 s | 0.7 / 0.5 / 3.9 | 15 / 65 |
| kdf | rush | scout only | 80 | 0 / 26 | 0 / 19 | 15 s | 0.7 / 0.4 / 3.7 | 17 / 63 |
| kdf | rush | counter only | 80 | 0 / 26 | 0 / 20 | 15 s | 0.4 / 1.2 / 3.8 | 15 / 65 |
| kdf | rush | scout + counter (after) | 80 | 0 / 26 | 0 / 19 | 15 s | 0.2 / 1.8 / 2.6 | 8 / 72 |
| kdf | passive | slice 1 (before) | 80 | 0 / 26 | 0 / 14 | 15 s | 0.8 / 0.4 / 9.8 | 80 / 0 |
| kdf | passive | scout only | 80 | 0 / 26 | 0 / 12 | 15 s | 0.6 / 0.5 / 10.5 | 80 / 0 |
| kdf | passive | counter only | 80 | 0 / 26 | 0 / 14 | 15 s | 0.6 / 1.2 / 9.7 | 80 / 0 |
| kdf | passive | scout + counter (after) | 80 | 0 / 26 | 0 / 12 | 15 s | 0.2 / 1.9 / 10.3 | 80 / 0 |
| sarim | rush | slice 1 (before) | 80 | 5 / 7 | 5 / 3 | 10 s | 3.6 / 1.1 / 5.4 | 59 / 21 |
| sarim | rush | scout only | 80 | 5 / 7 | 5 / 3 | 10 s | 3.5 / 1.1 / 5.9 | 58 / 22 |
| sarim | rush | counter only | 80 | 5 / 7 | 5 / 3 | 10 s | 2.9 / 2.0 / 4.8 | 55 / 25 |
| sarim | rush | scout + counter (after) | 80 | 5 / 7 | 5 / 3 | 10 s | 2.6 / 2.1 / 5.2 | 56 / 24 |
| sarim | passive | slice 1 (before) | 80 | 5 / 7 | 3 / 3 | 20 s | 4.1 / 0.8 / 10.1 | 80 / 0 |
| sarim | passive | scout only | 80 | 5 / 7 | 3 / 3 | 25 s | 3.9 / 0.8 / 9.6 | 80 / 0 |
| sarim | passive | counter only | 80 | 5 / 7 | 3 / 3 | 20 s | 3.4 / 1.8 / 9.3 | 80 / 0 |
| sarim | passive | scout + counter (after) | 80 | 5 / 7 | 3 / 3 | 25 s | 3.3 / 1.8 / 8.8 | 80 / 0 |

mirror rush 336 slice1 W 197 scout+counter W 178
mirror passive 336 slice1 W 234 scout+counter W 234


Mirror rooms (no economy, so the scout is the only change): vs rush 197 -> 178 of 336 wins; vs passive 234 -> 234.

### Reading it

- **The scout reveals nothing early.** The first contact tick is the same in 946 of 976 paired games (earlier in 7, later in 23): on these maps the armies are in sight of each other within ~15 s, before a
  scout has walked anywhere. It costs a unit from the march: -19 wins in the mirror rush cells, and about neutral (+2 / -1) in the economy cells.
- **The counter does what it says and does not win more.** Against the soft-heavy Sarim force a KDF commander builds 1.2 infantry a game instead of 0.5 (counter only) and fewer of the rest, and wins the same 15 of 80.
  A Sarim commander against KDF armour (5 armoured hulls, 7 soft, at once) sees 5 / 3 and builds anti-armour, but slice 1 already built 3.6 of them a game by its own mix rule, so the counter reaches parity sooner and returns to the mix: 59 -> 55 wins.
  Together the two are 15 -> 8 (KDF) and 59 -> 56 (Sarim). With 80 games a row these are not noise-free (a flip of 5 either way is within it), but nothing here is a gain.
- **Why the counter cannot be judged here.** The heuristics are right in shape and the table shows them acting, but whether an infantry squad is a better answer to a squad than a mortar team, or an ATGM team a better answer to an APC than a rifle squad, is a balance question: `pnpm balance` and `tuning.ts` decide it, and the issue holds armour counters until sim balance is unparked. HOLD FOR LEAD.
