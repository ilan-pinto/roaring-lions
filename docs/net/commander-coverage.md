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

Two more tasks in `createCommander`, both **off unless `CommanderOptions` turns them on** (`scout`, `counter`): the probe below shows no gain it can stand behind (section "Reading it").
They are plain heuristics in the app layer, commands only, over the same fog-honest `SideView`: no vision, no sim read, no `tuning.ts`, no unit-data change.

- **Scout.** At its first decision (and only then) the seat sends the fastest of the cheaper half of its free units (cost at or under the median, from the unit data; never its only unit; nobody when the camps are
  no further apart than the standoff) with a `move` to a point `RUSH_HOME_TILES` short of the enemy camp, the anchor a human reads off the map. The cheapest unit was tried first and is the artillery piece
  (a mortar crew, a rocket battery), the slowest in the force: the reviewer caught that. The scout is kept out of the march, the zone shares, the zone-holder pick and the sweep; one scout, never replaced; not re-sent from a tile it was already sent from.
- **Counter.** The seat remembers, per enemy type, the most of it ever in sight at once (`view.contacts`). `composition.ts` classes a type from the unit data alone:
  *armour* is a hull whose front plate is above `SOFT_PENETRATION_CEILING` (120, derived: the best round any non-anti-armour, non-demolition weapon has), so only an
  anti-armour weapon (`atgm`, `apfsds`, `heat`, `rpg`, able to hit the ground) can hurt it; *air* is the authored air domain; any other armed unit is *soft*; an unarmed unit is *none*.
  More armour than soft seen: the answer is the menu unit whose round beats the strongest plate seen (if the menu has none, those with the strongest anti-armour round it has), bought when affordable, until the seat holds one that clears the same bar for every armoured hull
  seen at once; if the answer is not affordable yet the slice 1 rule builds something else meanwhile. More soft than armour: an infantry-role unit, until it has as many as soft units seen at once. Equal, nothing seen, parity met or nothing in the menu to answer: the slice 1 rule.

### What was measured

The same 992 games as section 1 (8 seeds a cell). `--commander=slice1` is the slice 1 commander (it reproduces the earlier gate run: 992 of 992 games identical, to the tick and the outcome). `--commander=slice2` adds both tasks;
`--options='{"counter":false}'` and `--options='{"scout":false}'` give each alone (on `tel_marum`, `wadi_tarfan`, `wadi_tarfan_l`: 640 games, of which the 320 economy-room games are the rows below). Commander W / L of 80 games a row:

| commander | vs | variant | games | enemy at once (armour / soft, median) | commander saw (armour / soft, median) | first contact (median) | built a game (anti-armour / infantry / other) | W / L |
|---|---|---|---|---|---|---|---|---|
| kdf | rush | slice 1 (before) | 80 | 0 / 26 | 0 / 20 | 15 s | 0.7 / 0.5 / 3.9 | 15 / 65 |
| kdf | rush | scout only | 80 | 0 / 26 | 0 / 19 | 10 s | 0.6 / 0.3 / 4.5 | 24 / 56 |
| kdf | rush | counter only | 80 | 0 / 26 | 0 / 20 | 15 s | 0.4 / 1.2 / 3.8 | 15 / 65 |
| kdf | rush | scout + counter (after) | 80 | 0 / 26 | 0 / 19 | 10 s | 0.2 / 1.8 / 3.3 | 23 / 57 |
| kdf | passive | slice 1 (before) | 80 | 0 / 26 | 0 / 14 | 15 s | 0.8 / 0.4 / 9.8 | 80 / 0 |
| kdf | passive | scout only | 80 | 0 / 26 | 0 / 12 | 15 s | 0.8 / 0.4 / 10.6 | 80 / 0 |
| kdf | passive | counter only | 80 | 0 / 26 | 0 / 14 | 15 s | 0.6 / 1.2 / 9.7 | 80 / 0 |
| kdf | passive | scout + counter (after) | 80 | 0 / 26 | 0 / 12 | 15 s | 0.4 / 1.6 / 10.4 | 80 / 0 |
| sarim | rush | slice 1 (before) | 80 | 5 / 7 | 5 / 3 | 10 s | 3.6 / 1.1 / 5.4 | 59 / 21 |
| sarim | rush | scout only | 80 | 5 / 7 | 5 / 3 | 10 s | 3.6 / 1.2 / 5.9 | 53 / 27 |
| sarim | rush | counter only | 80 | 5 / 7 | 5 / 3 | 10 s | 2.9 / 2.0 / 4.8 | 55 / 25 |
| sarim | rush | scout + counter (after) | 80 | 5 / 7 | 5 / 3 | 10 s | 2.7 / 2.4 / 4.9 | 52 / 28 |
| sarim | passive | slice 1 (before) | 80 | 5 / 7 | 3 / 3 | 20 s | 4.1 / 0.8 / 10.1 | 80 / 0 |
| sarim | passive | scout only | 80 | 5 / 7 | 3 / 4 | 22 s | 3.9 / 0.8 / 10.2 | 79 / 1 |
| sarim | passive | counter only | 80 | 5 / 7 | 3 / 3 | 20 s | 3.4 / 1.8 / 9.3 | 80 / 0 |
| sarim | passive | scout + counter (after) | 80 | 5 / 7 | 3 / 4 | 22 s | 2.9 / 2.3 / 8.7 | 79 / 1 |

mirror rush 336 slice1 W 197 scout+counter W 193
mirror passive 336 slice1 W 234 scout+counter W 240

Mirror rooms (no economy, so the scout is the only change), the full matrix, 336 games each: vs rush 197 -> 193 wins; vs passive 234 -> 240. (Scout alone on the 160 mirror games of the ablation maps: vs rush 92 -> 82; vs passive 111 -> 116.)
The slice 2 games are identical to slice 1 in 303 of 992 (the rest differ in at least the tick or the outcome).

Paired by seed, scout + counter against slice 1, wins gained / lost, two-sided sign test: KDF economy vs rush 14 / 6 (p = 0.12); Sarim economy vs rush 7 / 14 (p = 0.19); mirror vs rush 46 / 50 (p = 0.76); mirror vs passive 19 / 13 (p = 0.38).

### Reading it

- **Nothing here is a gain or a loss the probe can stand behind.** KDF economy vs rush goes 15 -> 23 of 80 (scout alone 24), Sarim 59 -> 52 (scout alone 53, counter alone 55), and no paired test reaches p < 0.1. The one direction that repeats is the scout helping the KDF seat and costing the Sarim seat a few games; with 80 games a row that is a lead, not a result.
- **The scout reveals little early.** First contact moves in 66 of 976 paired games (earlier in 40, later in 26), by decision boundaries of 5 s, the probe's resolution: on these maps the armies are in sight of each other within ~15 s. The sight is mostly the army's own.
- **The counter does what it says.** Against the soft-heavy Sarim force a KDF commander builds 1.2 infantry a game instead of 0.5 (counter alone) and fewer of the rest; a Sarim commander against KDF armour (5 hulls, 7 soft, at once) sees 5 / 3 and its anti-armour builds fall 3.6 -> 2.9 a game while the infantry builds rise, because the slice 1 mix rule already built the anti-armour units and parity is reached sooner. Wins: 15 -> 15 (KDF), 59 -> 55 (Sarim).
- **Why the counter cannot be judged here.** The heuristics are right in shape, but whether an infantry squad is a better answer to a squad than a mortar team, or an ATGM team a better answer to an APC than a rifle squad, is a balance question: `pnpm balance` and `tuning.ts` decide it, and the issue holds armour counters until sim balance is unparked. HOLD FOR LEAD.
- **Instrument limits.** `classOf` rests on thin margins: `scout_shachaf` (front 130) is armour only because the ceiling is 120, set by the Namer's and the Peten's autocannon alike; a unit with a heavier non-anti-armour round moves the class line with no code change. First contact is read at 100-tick decision boundaries.

## 5. Slice 3 of the commander: retreat (GH-1391)

The commander already DEFENDS (slice 1: a contact within `DEFEND_TILES` of the camp sends the idle units at home out on it, and a guard of built units stays to meet it). Slice 3 adds the other half, **RETREAT**, **off unless `CommanderOptions.retreat` is set**: the probe below says it loses games.

- **Engaged group.** Every able unit away from home (beyond `RUSH_HOME_TILES` of the camp) with a contact within `RUSH_HOME_TILES` of it. The scout is never in it.
- **Losing.** Each side is valued as the sum of `cost x hp` (unit-data cost; hp is the view's percent; a contact at the hp it shows); the foe is the contacts within that radius of any engaged unit. Strictly more foe than group is losing (a tie is not).
- **Worth walking home** (version 2) only if the group could win once joined: `own + joins > foe`, where `joins` is every other able unit plus whatever the camps are queuing or building (valued at full hp). A group with nothing to join fights on.
- **Retreat.** The whole engaged group gets a `move` (not an attack-move) to the camp and is kept out of every other task, the straggler sweep included. One that stops idle short of home is given back to the march.
- **Regroup and re-engage.** At home they are released to the other tasks (so the march sends them out again) when what stands at home is worth at least the foe that beat them, when a contact comes within `DEFEND_TILES` (they defend), or when nothing is queued or building that could add to them (a room with no economy).
- No new tuned number: the two radii are the script's own `RUSH_HOME_TILES` and slice 1's `DEFEND_TILES`; the rest are strict whole-number comparisons.

### What was measured (the same 992 games; slice 1 is the baseline, the commander with only `retreat` added)

| version | wins / losses | retreat orders (`move`) | notes |
|---|---|---|---|
| slice 1 | 665 / 327 | 0 | |
| retreat, version 1 (no join test) | 598 / 394 | 8787 in 913 games | a walk-back-and-return loop: the group leaves its shots and comes back |
| retreat, version 2 (must be able to win once joined) | 620 / 372 | 7162 in 848 games | a unit that could not reach home held its whole group; a stale idle flag released it the same decision |
| retreat, version 3 (reviewed: stuck, crippled, carried, garrisoned and idle-away units are let go; a close contact ends the retreat at once) | **613 / 379** | 7847 in 848 games (9.3 per retreating game) | the code this PR ships |

Version 3 by group, wins slice 1 -> retreat (gained / lost, two-sided sign test on the paired seeds):

| group | vs | games | wins | gained / lost | p |
|---|---|---|---|---|---|
| mirror | passive | 336 | 234 -> 203 | 19 / 50 | < 0.01 |
| mirror | rush | 336 | 197 -> 180 | 39 / 56 | 0.10 |
| economy, KDF | rush | 80 | 15 -> 23 | 13 / 5 | 0.10 |
| economy, Sarim | rush | 80 | 59 -> 55 | 16 / 20 | 0.62 |
| economy, KDF | passive | 80 | 80 -> 80 | 0 / 0 | 1.0 |
| economy, Sarim | passive | 80 | 80 -> 72 | 0 / 8 | 0.01 |

Six cells, none corrected for it: one p below 0.05 in six is what chance alone gives about a quarter of the time, so only the two losing cells (mirror vs passive, Sarim economy vs passive) are worth reading, and both lose.

Of the 992 games, those that show the literal 60 s stall reading fall 842 -> 668 (a seat that retreats issues orders), those that show the idle-unit reading rise 109 -> 179 (retreated units standing at home), and idle-away stays 0. Orders a minute, **median of the per-game figure**: 1.06 -> 2.61 (the retreat is not quiet: 9.3 `move` orders per retreating game, which is a lot of commands for a policy that wins less). 299 of the 992 games are identical to slice 1.

### Reading it

- **As a heuristic over this view it does not pay.** Net -52 wins of 992 (665 -> 613). The loss is concentrated in the mirror rooms against a passive opponent (-31) and in the Sarim economy room against a passive opponent (-8): a group that backs away from a defender's guns gives up its shots and the clock decides (median game 301 s -> 387 s in the mirror vs passive rooms). The KDF economy cell against a rushing Sarim moves the other way (15 -> 23, 13 / 5, p = 0.10, not distinguishable from noise), and the matching Sarim economy cell against the same rush does not (59 -> 55), so "there is something to regroup with" does not explain it: both seats have an economy there.
- **What the heuristic cannot see** from a `SideView`: the terrain between the group and home, the foe's reach and speed (a group on foot cannot outrun a wheeled foe by walking), whether the contacts are the whole of the foe, and which of its own units are the dangerous ones. Whether a retreat should be a stand at a cover tile, a fall back to a garrison, or nothing, is HOLD FOR LEAD together with any retreat-radius or "how long to regroup" number; none is written here.
- Three versions are reported because the first was measured, found to loop, and changed, and the second was reviewed and changed; none is tuned to a result. The option stays off.

## 6. Slice 4 of the commander: mass, then commit (GH-1391)

Slices 1 to 3 never decide WHEN the army goes: the march sends what is idle at home at once. Slice 4 adds the timing, **off unless `CommanderOptions.mass` is set**: the probe below says it loses games.

- **Strength.** The sum of `cost x hp` over the seat's able units. The foe's is the largest sum over the contacts in sight at ONE decision, remembered after they leave sight (fog-visible units only; nothing it cannot see is read), and **never less than the seat's own first force** (a matched room: a snapshot of the fog under-counts).
- **Massing.** Until the seat's strength is strictly greater than the foe's, the units the march would send (idle at home) are held where they stand, and kept from the straggler sweep. A room with no economy and nothing yet seen has nothing to wait for or to learn by waiting, so the seat goes at once, as `rush` does.
- **Committing.** The first decision its strength is strictly greater, the march runs as before.
- **Re-planning.** After a lost engagement (the retreat's reading: the units away from home with a contact in reach are worth strictly less than the contacts around them; an exact tie is not a loss) it masses again, unless its strength is still strictly greater than the same foe it commits on: the largest force it has now seen, never below its own first force (PR 1596 re-massed against the seen snapshot alone, so a seat that would not have committed could stay committed; the follow-up uses one floor for both). Units already out are never recalled (that is `retreat`).
- **Only the idle units AT HOME are held while massing.** A zone share still leaves (task 2 takes its units before the march), and its spare members idle away from home (those not holding the zone) still go forward through the straggler sweep (`sweepStragglers`; `rush` itself sends only what is at home).
- With it on, the slice 1 guard is off: the army massed at home is the defending group, and a guard that never marches could never add to the edge the seat waits for.
- No new tuned number; every comparison is whole-number and strict.

### What was measured (the same 992 games; slice 1 is the baseline, the commander with only `mass` added)

| version | wins / losses | games that differ from slice 1 |
|---|---|---|
| slice 1 | 665 / 327 | |
| mass, version 1 (foe = the largest snapshot seen, else its own first force) | 607 / 385 | 157 |
| **mass, version 2 (foe never below its own first force)** | **616 / 376** | 147 |

Version 2 by group, wins slice 1 -> mass (gained / lost, two-sided sign test on paired seeds, six economy and mirror cells uncorrected):

| group | vs | games | wins | gained / lost | p |
|---|---|---|---|---|---|
| mirror | passive | 336 | 234 -> 234 | 0 / 0 | 1.0 |
| mirror | rush | 336 | 197 -> 193 | 2 / 6 | 0.29 |
| economy, KDF | passive | 80 | 80 -> 44 | 0 / 36 | < 0.01 |
| economy, KDF | rush | 80 | 15 -> 12 | 3 / 6 | 0.51 |
| economy, Sarim | passive | 80 | 80 -> 75 | 0 / 5 | 0.06 |
| economy, Sarim | rush | 80 | 59 -> 58 | 9 / 10 | 1.0 |

The literal 60 s stall reading falls 842 -> 760 and the idle-unit reading 109 -> 26 (held units are kept, and the seat is not idle while it waits); orders a minute (median) 1.06 -> 1.07.

**Version 3 (the 1596 follow-up: re-mass against the same floor it commits on).** Re-measured on the two headline cells only, the 320 games of `pnpm commander:probe -- --maps=tel_marum,wadi_tarfan,wadi_tarfan_l --baselines=passive --commander=slice4 --seeds=8 --jobs=4` (the 160 games of the two passive economy rows above, plus the 160 mirror-room games of the same three maps). Version 2 reproduces exactly (44 and 75 of 80) before the change. After it, wins version 2 -> 3, gained / lost on paired seeds:

| group | vs | games | wins v2 -> v3 | gained / lost | games that differ | wins slice 1 -> v3 (gained / lost) |
|---|---|---|---|---|---|---|
| economy, KDF | passive | 80 | 44 -> 46 | 2 / 0 | 8 | 80 -> 46 (0 / 34) |
| economy, Sarim | passive | 80 | 75 -> 77 | 3 / 1 | 40 | 80 -> 77 (0 / 3) |
| mirror (these three maps) | passive | 160 | 111 -> 111 | 0 / 0 | 8 | |

The numbers move, a little and the right way, and the reading does not: every one of the 37 economy games it still loses against a passive foe (41 before) is decided by the clock, with the same median end of 14 units to the foe's 26. A mirror room cannot outgrow its own first force, so there a lost engagement now holds what stands at home for the rest of the game (defend still meets a contact at the camp): 8 of the 160 mirror games play differently and none changes its result. The rush rows and the other four maps were not re-run; the 992-game rows above are version 2's.

### Reading it

- **It changes nothing in the mirror rooms and loses in the economy rooms against a passive foe.** A mirror room has no economy, so the seat commits at once (the same game as slice 1: 845 of 992 games identical). The loss is KDF economy against passive, 80 -> 44, and all 41 of the games it loses against a passive foe in the economy rooms are decided by the clock: slice 1 "wins" there by standing with more units than the foe (a median of 31 to 26, hoarding its guard), while the massing seat commits as soon as it is strictly stronger, attacks a foe that is dug in, and ends with a median of 14 units to the foe's 26, which it never dented. **The clock win of slice 1 is not a plan; the attack is not better.**
- **Version 1 vs 2.** Version 1 took the foe to be the largest snapshot seen and committed on a few units seen of a matched force; version 2 never lets a snapshot lower the foe below the seat's own first force. It recovered 9 wins and no cell changed sign. Neither is tuned to a result.
- **What would make it pay is a margin, which is a number.** "Strictly greater" is the only edge a plain comparison gives, and an attacker needs more than a tie-breaker against a defender in cover. The margin, and what counts as strength (cost, hp, speed, reach), are HOLD FOR LEAD together with whether the clock score should reward hoarding.
- **The ladder (PR 1549's three levels, mirror pairing only) does not move:** the levels stay strictly ordered (gate PASS, worst per-cell inversion 0), pooled computer win rate easy / medium / hard 1.0 / 13.2 / 47.3% against the shipped seat's 1.0 / 14.0 / 47.8%; only rush on medium and hard moves (13.3 -> 11.0, 54.3 -> 52.9). 1773 of 1890 games are identical to the shipped seat.
