# Where the lobby seats the computer (GH-1390)

**Status:** the lobby offers "Play a basic computer opponent" on **25 of the 31** cells a versus room can play (it was 7: the mirror annihilation on each ground). The other
six are closed, listed below. The table is `packages/app/src/net/computer/open-cells.ts`; the evidence is `pnpm commander:probe` (method and the earlier matrix:
`commander-coverage.md`). No `tuning.ts`, no unit data, no sim change.

## The rule

A **cell** is a ground, the human's pairing (`mirror`, `kdf` or `sarim`; the computer plays the other faction) and a win mode (annihilation or a mode read fair there).
The lobby seats the computer at **seat 1** (the human is the host end), so only the probe's games with the commander at seat 1 decide a cell. A cell is **open** when
every one of those games was played, the seat gave an order, and **no game had the idle-unit stall** (60 s with no order while an able, idle unit stood by). A cell the
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
| tel_marum | kdf | annihilation | 48 | 1 | 23 | time 38, annihilation 10 | CLOSED: 1 of 48 games stopped playing (60 s with no order while an idle unit stood by) |
| tel_marum | mirror | annihilation | 48 | 0 | 37 | annihilation 47, time 1 | open |
| tel_marum | mirror | points | 48 | 0 | 44 | objective/points 25, annihilation 23 | open |
| tel_marum | sarim | annihilation | 48 | 1 | 33 | time 31, annihilation 17 | CLOSED: 1 of 48 games stopped playing (60 s with no order while an idle unit stood by) |
| wadi_tarfan_l | kdf | annihilation | 48 | 39 | 45 | time 48 | CLOSED: 39 of 48 games stopped playing (60 s with no order while an idle unit stood by) |
| wadi_tarfan_l | kdf | camp | 48 | 0 | 22 | objective/camp 47, time 1 | open |
| wadi_tarfan_l | mirror | annihilation | 48 | 0 | 48 | annihilation 48 | open |
| wadi_tarfan_l | mirror | camp | 48 | 0 | 47 | objective/camp 48 | open |
| wadi_tarfan_l | mirror | flag | 48 | 0 | 48 | annihilation 47, time 1 | open |
| wadi_tarfan_l | mirror | points | 48 | 0 | 48 | objective/points 46, annihilation 2 | open |
| wadi_tarfan_l | sarim | annihilation | 48 | 29 | 48 | time 48 | CLOSED: 29 of 48 games stopped playing (60 s with no order while an idle unit stood by) |
| wadi_tarfan_l | sarim | camp | 48 | 0 | 44 | objective/camp 47, time 1 | open |
| wadi_tarfan | kdf | annihilation | 48 | 28 | 29 | time 46, annihilation 2 | CLOSED: 28 of 48 games stopped playing (60 s with no order while an idle unit stood by) |
| wadi_tarfan | kdf | camp | 48 | 0 | 16 | objective/camp 48 | open |
| wadi_tarfan | mirror | annihilation | 48 | 0 | 39 | annihilation 48 | open |
| wadi_tarfan | mirror | camp | 48 | 0 | 35 | objective/camp 48 | open |
| wadi_tarfan | mirror | flag | 48 | 0 | 48 | annihilation 47, time 1 | open |
| wadi_tarfan | mirror | points | 48 | 0 | 48 | objective/points 39, annihilation 4, time 5 | open |
| wadi_tarfan | sarim | annihilation | 48 | 36 | 44 | time 42, annihilation 6 | CLOSED: 36 of 48 games stopped playing (60 s with no order while an idle unit stood by) |
| wadi_tarfan | sarim | camp | 48 | 0 | 34 | objective/camp 48 | open |

## What it means

- **Open: every mirror cell, and the camp race on both Wadi Tarfans for either human side.** What the data supports is narrower than "both commanders play": in these cells the seat never sat idle while able to act. The forces are placed (a mode on a faction pairing is the placed forces), so there is no purse and the seat plays as the shipped script does: it attack-moves once and fights, a median of 1 order a game against `rush`, and loses to `rush` in most Wadi Tarfan camp games as Sarim (17 of 24 and 20 of 24). And the verdict is partly structural: 58 of the 1136 seat-1 games in the open cells end before a 60 s stall is possible (24 of 48 in each KDF camp race). What the lobby changes is that the cells can be reached; how well the seat plays them is the commander's, not this table's.
- **Closed: the skirmish-economy pairings in annihilation (KDF and Sarim humans, on Tel Marum, Wadi Tarfan and Wadi Tarfan (large)).** The idle units were at home (the away-from-home reading is 0 in every game), so they may be the commander's own guard and zone holders and not a seat that gave up; the probe cannot tell the two apart. That is the guard question (slice 1, HOLD FOR LEAD), not something this change can settle without a number.
- **Offered but unmeasured: nothing.** All 31 cells are in the table; points and flag on the faction pairings are not offered by `winModesOffered` today.
- The seat the lobby arms is now `createCommander()` (slice 1) rather than the bare `rush` script. In a mirror room the two are move-for-move identical (measured in the GH-1389 ladder: 1890 of 1890 games, tick for tick; the comment is on GH-1389), so the mirror annihilation plays exactly as before.

## Falsification

`commander-open-cells.test.ts` (the rule): five one-line mutations, four red (idle stall not counted, seat 0 games counted, the literal stall closing a cell, a game with no order not counted); the fifth (dropping a `games > 0` guard) was an equivalent mutant, because a row exists only with a game, and the guard was removed instead. `open-cells.test.ts`, `computer-seat.test.ts` and `versus.test.ts` (the wiring): seven mutations, all red (rush seat instead of the commander, win mode dropped from the config, win mode dropped from the lobby call, the predicate always true, the lobby never hiding the seat, the click guard removed, a cell closed in the table).

## HOLD FOR LEAD (copy and numbers)

- The lobby copy. `versus.cpu.note` still says the opponent "builds nothing", and `versus.cpu.start` still says "basic"; both are unchanged here. No string says why a cell has no computer seat (the section is hidden, as it was on an economy pairing).
- Reopening the six closed cells: the guard (what slice 1 leaves at home) and whether a held unit at home is a stall.
- Whether one stalled game of 48 should close a cell.
