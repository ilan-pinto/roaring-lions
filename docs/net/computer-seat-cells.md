# Where the lobby seats the computer (GH-1390)

**Status (20 Nov 2026):** the lobby offers "Play a basic computer opponent" on **all 31** cells a versus room can play (it was 7, then 25: the lead ruled on 20 Nov that a
guard held at home is not a stall, which opened the last six; see "The 20 Nov re-read"). Until that ruling six were closed, and the table below keeps the 18 Nov reading. The table is `packages/app/src/net/computer/open-cells.ts`; the evidence is `pnpm commander:probe` (method and the earlier matrix:
`commander-coverage.md`). No `tuning.ts`, no unit data, no sim change.

## The rule

A **cell** is a ground, the human's pairing (`mirror`, `kdf` or `sarim`; the computer plays the other faction) and a win mode (annihilation or a mode read fair there).
The lobby seats the computer at **seat 1** (the human is the host end), so only the probe's games with the commander at seat 1 decide a cell. A cell is **open** when
every one of those games was played, the seat gave an order, and **no game had the away-from-home stall** (60 s with no order while an able, idle unit stood by BEYOND the home radius, `RUSH_HOME_TILES`, of the camp; units standing in an income zone the seat holds are not idle). Before 20 Nov any idle unit counted, at home or away. A cell the
table does not list is closed, so a new ground or mode stays closed until the probe has read it (`open-cells.test.ts` fails on a cell that is in neither list).

Two judgements, for the lead to overrule:

1. **"No order for 60 s" is read as the idle-unit stall, not the literal one.** The literal reading fires in about 83% of games (845 of 992 in the first matrix) including every mirror cell (a seat in a firefight is
   silent by design), so under it nothing could open. The idle-unit reading is the one that means the seat stopped playing. The literal count is in the table.
2. **One stalled game closes a cell.** Tel Marum KDF and Sarim annihilation each had 1 of 48 and are closed on that; they are also the cells where the clock decides most
   games (`time` 38 and 31 of 48). The other four economy cells stalled in 28 to 39 of 48.

## The table (commander at seat 1, slice 1, vs `passive` and `rush`; 8 seeds a baseline on the four mirror-only grounds, 24 on Tel Marum, Wadi Tarfan and Wadi Tarfan (large))

| map | human plays | win mode | games | stopped playing (idle) | literal 60 s | decided by | verdict |
|---|---|---|---|---|---|---|---|
| beit_sahwan_outskirts | mirror | annihilation | 16 | 0 | 11 | annihilation 16 | open |
| beit_sahwan_outskirts | mirror | points | 16 | 0 | 14 | objective/points 9, annihilation 7 | open |
| milh_flats_l | mirror | annihilation | 16 | 0 | 16 | annihilation 15, time 1 | open |
| milh_flats_l | mirror | flag | 16 | 0 | 16 | annihilation 16 | open |
| milh_flats_l | mirror | points | 16 | 0 | 15 | objective/points 13, annihilation 3 | open |
| milh_flats | mirror | annihilation | 16 | 0 | 14 | annihilation 16 | open |
| milh_flats | mirror | camp | 16 | 0 | 15 | objective/camp 15, time 1 | open |
| milh_flats | mirror | points | 16 | 0 | 16 | objective/points 10, annihilation 6 | open |
| rujm_sawda | mirror | annihilation | 16 | 0 | 15 | annihilation 16 | open |
| rujm_sawda | mirror | flag | 16 | 0 | 16 | annihilation 15, time 1 | open |
| rujm_sawda | mirror | points | 16 | 0 | 8 | objective/points 16 | open |
| tel_marum | kdf | annihilation | 48 | 1 | 23 | time 38, annihilation 10 | was CLOSED on the 18 Nov reading (1 of 48 games with an idle unit); open since 20 Nov |
| tel_marum | mirror | annihilation | 48 | 0 | 37 | annihilation 47, time 1 | open |
| tel_marum | mirror | points | 48 | 0 | 44 | objective/points 25, annihilation 23 | open |
| tel_marum | sarim | annihilation | 48 | 1 | 33 | time 31, annihilation 17 | was CLOSED on the 18 Nov reading (1 of 48 games with an idle unit); open since 20 Nov |
| wadi_tarfan_l | kdf | annihilation | 48 | 39 | 45 | time 48 | was CLOSED on the 18 Nov reading (39 of 48 games with an idle unit); open since 20 Nov |
| wadi_tarfan_l | kdf | camp | 48 | 0 | 22 | objective/camp 47, time 1 | open |
| wadi_tarfan_l | mirror | annihilation | 48 | 0 | 48 | annihilation 48 | open |
| wadi_tarfan_l | mirror | camp | 48 | 0 | 47 | objective/camp 48 | open |
| wadi_tarfan_l | mirror | flag | 48 | 0 | 48 | annihilation 47, time 1 | open |
| wadi_tarfan_l | mirror | points | 48 | 0 | 48 | objective/points 46, annihilation 2 | open |
| wadi_tarfan_l | sarim | annihilation | 48 | 29 | 48 | time 48 | was CLOSED on the 18 Nov reading (29 of 48 games with an idle unit); open since 20 Nov |
| wadi_tarfan_l | sarim | camp | 48 | 0 | 44 | objective/camp 47, time 1 | open |
| wadi_tarfan | kdf | annihilation | 48 | 28 | 29 | time 46, annihilation 2 | was CLOSED on the 18 Nov reading (28 of 48 games with an idle unit); open since 20 Nov |
| wadi_tarfan | kdf | camp | 48 | 0 | 16 | objective/camp 48 | open |
| wadi_tarfan | mirror | annihilation | 48 | 0 | 39 | annihilation 48 | open |
| wadi_tarfan | mirror | camp | 48 | 0 | 35 | objective/camp 48 | open |
| wadi_tarfan | mirror | flag | 48 | 0 | 48 | annihilation 47, time 1 | open |
| wadi_tarfan | mirror | points | 48 | 0 | 48 | objective/points 39, annihilation 4, time 5 | open |
| wadi_tarfan | sarim | annihilation | 48 | 36 | 44 | time 42, annihilation 6 | was CLOSED on the 18 Nov reading (36 of 48 games with an idle unit); open since 20 Nov |
| wadi_tarfan | sarim | camp | 48 | 0 | 34 | objective/camp 48 | open |

## What it means

- **Open: every mirror cell, and the camp race on both Wadi Tarfans for either human side.** What the data supports is narrower than "both commanders play": in these cells the seat never sat idle while able to act. The forces are placed (a mode on a faction pairing is the placed forces), so there is no purse and the seat plays as the shipped script does: it attack-moves once and fights, a median of 1 order a game against `rush`, and loses to `rush` in most Wadi Tarfan camp games as Sarim (17 of 24 and 20 of 24). And the verdict is partly structural: 58 of the 1136 seat-1 games in the open cells end before a 60 s stall is possible (24 of 48 in each KDF camp race). What the lobby changes is that the cells can be reached; how well the seat plays them is the commander's, not this table's.
- **Was closed until 20 Nov: the skirmish-economy pairings in annihilation (KDF and Sarim humans, on Tel Marum, Wadi Tarfan and Wadi Tarfan (large)).** (Open since the lead's ruling, below.) The idle units were at home (the away-from-home reading is 0 in every game), so they may be the commander's own guard and zone holders and not a seat that gave up; the probe cannot tell the two apart. That is the guard question (slice 1, HOLD FOR LEAD), not something this change can settle without a number.
- **Offered but unmeasured: nothing.** All 31 cells are in the table; points and flag on the faction pairings are not offered by `winModesOffered` today.
- The seat the lobby arms is now `createCommander()` (slice 1) rather than the bare `rush` script. In a mirror room the two are move-for-move identical (measured in the GH-1389 ladder: 1890 of 1890 games, tick for tick; the comment is on GH-1389), so the mirror annihilation plays exactly as before.

## Falsification

`commander-open-cells.test.ts` (the rule): five one-line mutations, four red (idle stall not counted, seat 0 games counted, the literal stall closing a cell, a game with no order not counted); the fifth (dropping a `games > 0` guard) was an equivalent mutant, because a row exists only with a game, and the guard was removed instead. `open-cells.test.ts`, `computer-seat.test.ts` and `versus.test.ts` (the wiring): seven mutations, all red (rush seat instead of the commander, win mode dropped from the config, win mode dropped from the lobby call, the predicate always true, the lobby never hiding the seat, the click guard removed, a cell closed in the table).

## Lead rulings (18 Nov 2026, relayed by the PM): APPROVED

The computer seat on 25 of 31 cells, the six stalled cells staying closed, the 1-in-48 stall rule, and the `versus.cpu.note` / `versus.cpu.start` copy (unchanged text) are approved. The three items once held here, for the record:

- The lobby copy. `versus.cpu.note` still says the opponent "builds nothing", and `versus.cpu.start` still says "basic"; both are unchanged here. No string says why a cell has no computer seat (the section is hidden, as it was on an economy pairing).
- Reopening the six closed cells: the guard (what slice 1 leaves at home) and whether a held unit at home is a stall.
- Whether one stalled game of 48 should close a cell.


## Lead ruling (20 Nov 2026, relayed by the PM): a held guard AT HOME is not a stall

The stall rule now counts an idle, able unit only when it stands beyond the commander's home radius (`RUSH_HOME_TILES`, which is also `DEFEND_TILES`, the guard radius) of its camp; units holding an income zone were already excluded. No behaviour of the commander changed: only the stall definition and the cell list. The probe still reports the broader any-idle count, in its own column. The 18 Nov items (the lobby copy, the one-game-in-48 rule) are unchanged, except that the `versus.cpu.note` copy was reworded the same day (it no longer says the computer builds nothing).

### The 20 Nov re-read

`pnpm commander:probe -- --commander=slice1 --seeds=24 --seats=1 --maps=tel_marum,wadi_tarfan,wadi_tarfan_l --modes=annihilation --open-cells`: the commander the lobby arms (`createCommander()`), at seat 1, 24 seeds against each of the two baselines, **432 games, 432 played, 0 errors.** The idle column reproduces the 18 Nov table to the game (1, 1, 39, 29, 28, 36 for the six cells); the away-from-home column, which is the rule now, is **0 in every game of every cell**, so all six open. The other 22 cells cannot change: an away-from-home stall is a subset of an any-idle stall, and none of them had either, so they stay open without a re-run.

| map | human plays | win mode | games | stopped playing (idle, away from home) | idle at home or away | literal 60 s | decided by | verdict |
|---|---|---|---|---|---|---|---|---|
| tel_marum | kdf | annihilation | 48 | 0 | 1 | 23 | time 38, annihilation 10 | open |
| tel_marum | mirror | annihilation | 48 | 0 | 0 | 37 | annihilation 47, time 1 | open |
| tel_marum | sarim | annihilation | 48 | 0 | 1 | 33 | time 31, annihilation 17 | open |
| wadi_tarfan_l | kdf | annihilation | 48 | 0 | 39 | 45 | time 48 | open |
| wadi_tarfan_l | mirror | annihilation | 48 | 0 | 0 | 48 | annihilation 48 | open |
| wadi_tarfan_l | sarim | annihilation | 48 | 0 | 29 | 48 | time 48 | open |
| wadi_tarfan | kdf | annihilation | 48 | 0 | 28 | 29 | time 46, annihilation 2 | open |
| wadi_tarfan | mirror | annihilation | 48 | 0 | 0 | 39 | annihilation 48 | open |
| wadi_tarfan | sarim | annihilation | 48 | 0 | 36 | 44 | time 42, annihilation 6 | open |

What the table does not say, and the 18 Nov doc already did: in all six newly opened cells the match mostly runs to the clock (`time` decided 38 of 48 on Tel Marum KDF, 48 of 48 on Wadi Tarfan (large) KDF and Sarim, 46 and 42 on Wadi Tarfan). The seat does not stall there; it also does not win the economy on its own. The table opens the cells, it does not say the seat plays them well.

Falsification of the rule (`commander-open-cells.test.ts`): the old any-idle rule restored (1 red), away stalls not counted (2), seat 0 games counted (1), games not played ignored (1). Of the table (`open-cells.test.ts`): a cell dropped (2), a mode removed (2), a bogus mode listed (2), a closed cell listed (3).
