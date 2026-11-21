/**
 * Where the lobby seats the computer (GH-1390). A CELL is a ground, the human's pairing (`mirror`, `kdf` or `sarim`: the computer plays the other
 * faction, always at seat 1) and a win mode (`null` is annihilation). A cell is OPEN only if `OPEN_COMPUTER_CELLS` lists it; `CLOSED_COMPUTER_CELLS` lists the ones the probe read as a seat that stopped playing, and a cell in neither is closed.
 *
 * The list is read off the coverage probe (`pnpm commander:probe -- --open-cells`, `docs/net/commander-coverage.md` section 6), not chosen: a cell is closed
 * when, in the probe's games with the commander at seat 1, the seat STOPPED PLAYING in any of them. "Stopped playing" is the away-from-home idle stall: 60 s
 * with no order while an able, idle unit stood by BEYOND the home radius (`RUSH_HOME_TILES`) of the camp. An idle unit at home is the commander's guard and does not
 * count (the lead's ruling, 20 Nov 2026); the literal "no order for 60 s" fires in a firefight, in 85% of games, and cannot tell a seat in a fight from a seat that
 * gave up. The table is data about the probe's last run, so a re-run that changes a verdict changes this list and nothing else.
 */
import { VERSUS_FAIR_MAPS, matchupAllowed, winModesOffered, type Matchup, type WinMode } from '@lions/net';

export interface ComputerCell {
  map: string;
  matchup: Matchup;
  /** `null` is annihilation. */
  winMode: WinMode | null;
}

export interface ClosedComputerCell extends ComputerCell {
  /** Why it is closed: the probe's reading, for the next person to re-run. Never shown to a player. */
  why: string;
}

/** A ground and pairing with the win modes the probe read clean there (`null` is annihilation). */
export interface OpenComputerCells {
  map: string;
  matchup: Matchup;
  winModes: readonly (WinMode | null)[];
}

/** The OPEN cells: the probe's games with the commander at seat 1 all played, ordered, and never stopped playing. ALL 31 cells (the lead's ruling of 20 Nov: a held guard at home is not a stall). */
export const OPEN_COMPUTER_CELLS: readonly OpenComputerCells[] = [
  { map: 'beit_sahwan_outskirts', matchup: 'mirror', winModes: [null, 'points'] },
  { map: 'milh_flats_l', matchup: 'mirror', winModes: [null, 'flag', 'points'] },
  { map: 'milh_flats', matchup: 'mirror', winModes: [null, 'camp', 'points'] },
  { map: 'rujm_sawda', matchup: 'mirror', winModes: [null, 'flag', 'points'] },
  { map: 'tel_marum', matchup: 'kdf', winModes: [null] },
  { map: 'tel_marum', matchup: 'mirror', winModes: [null, 'points'] },
  { map: 'tel_marum', matchup: 'sarim', winModes: [null] },
  { map: 'wadi_tarfan_l', matchup: 'kdf', winModes: [null, 'camp'] },
  { map: 'wadi_tarfan_l', matchup: 'mirror', winModes: [null, 'camp', 'flag', 'points'] },
  { map: 'wadi_tarfan_l', matchup: 'sarim', winModes: [null, 'camp'] },
  { map: 'wadi_tarfan', matchup: 'kdf', winModes: [null, 'camp'] },
  { map: 'wadi_tarfan', matchup: 'mirror', winModes: [null, 'camp', 'flag', 'points'] },
  { map: 'wadi_tarfan', matchup: 'sarim', winModes: [null, 'camp'] },
];

/**
 * The CLOSED cells, with the probe's reading. EMPTY since the lead's ruling of 20 Nov 2026 (GH-1390): the six skirmish-economy annihilation cells were closed on
 * the idle-unit stall counting a unit held at home, and the lead ruled that a guard at home is not a stall. Re-read on the away-from-home stall, none of the six
 * had one in 48 games (`docs/net/computer-seat-cells.md`). The mechanism stays: a cell this table does not list as open is closed, so a new ground or mode is
 * refused until the probe has read it.
 */
export const CLOSED_COMPUTER_CELLS: readonly ClosedComputerCell[] = [];

/** Every cell a room can play: the fair grounds, the pairings each allows, annihilation and the modes read fair for the ground and pairing. */
export function allComputerCells(): ComputerCell[] {
  const out: ComputerCell[] = [];
  for (const map of VERSUS_FAIR_MAPS) {
    for (const matchup of ['mirror', 'kdf', 'sarim'] as const) {
      if (!matchupAllowed(matchup, map)) continue;
      for (const winMode of [null, ...winModesOffered(map, matchup)]) out.push({ map, matchup, winMode });
    }
  }
  return out;
}

/** Whether the lobby seats the computer on this ground, pairing and win mode. A cell the table does not list is closed: a new ground is closed until the probe has read it. */
export function computerSeatOpen(map: string, matchup: Matchup, winMode: WinMode | null): boolean {
  return OPEN_COMPUTER_CELLS.some((o) => o.map === map && o.matchup === matchup && o.winModes.includes(winMode));
}
