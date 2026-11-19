/**
 * Where the lobby seats the computer (GH-1390). A CELL is a ground, the human's pairing (`mirror`, `kdf` or `sarim`: the computer plays the other
 * faction, always at seat 1) and a win mode (`null` is annihilation). A cell is OPEN only if `OPEN_COMPUTER_CELLS` lists it; `CLOSED_COMPUTER_CELLS` lists the ones the probe read as a seat that stopped playing, and a cell in neither is closed.
 *
 * The list is read off the coverage probe (`pnpm commander:probe -- --open-cells`, `docs/net/commander-coverage.md` section 6), not chosen: a cell is closed
 * when, in the probe's games with the commander at seat 1, the seat STOPPED PLAYING in any of them. "Stopped playing" is the idle-unit stall reading: 60 s
 * with no order while an able, idle unit stood by (the literal "no order for 60 s" fires in a firefight, in 85% of games, and cannot tell a seat in a fight
 * from a seat that gave up). The table is data about the probe's last run, so a re-run that changes a verdict changes this list and nothing else.
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

/** The OPEN cells: the probe's games with the commander at seat 1 all played, ordered, and never stopped. 25 of the 31 cells. */
export const OPEN_COMPUTER_CELLS: readonly OpenComputerCells[] = [
  { map: 'beit_sahwan_outskirts', matchup: 'mirror', winModes: [null, 'points'] },
  { map: 'milh_flats_l', matchup: 'mirror', winModes: [null, 'flag', 'points'] },
  { map: 'milh_flats', matchup: 'mirror', winModes: [null, 'camp', 'points'] },
  { map: 'rujm_sawda', matchup: 'mirror', winModes: [null, 'flag', 'points'] },
  { map: 'tel_marum', matchup: 'mirror', winModes: [null, 'points'] },
  { map: 'wadi_tarfan_l', matchup: 'kdf', winModes: ['camp'] },
  { map: 'wadi_tarfan_l', matchup: 'mirror', winModes: [null, 'camp', 'flag', 'points'] },
  { map: 'wadi_tarfan_l', matchup: 'sarim', winModes: ['camp'] },
  { map: 'wadi_tarfan', matchup: 'kdf', winModes: ['camp'] },
  { map: 'wadi_tarfan', matchup: 'mirror', winModes: [null, 'camp', 'flag', 'points'] },
  { map: 'wadi_tarfan', matchup: 'sarim', winModes: ['camp'] },
];

/**
 * The CLOSED cells, with the probe's reading (games stopped / games played, commander at seat 1, the idle-unit stall). All six are the skirmish-economy
 * pairings in annihilation, and the match there runs to the clock (`time` decided 38 of 48 games on Tel Marum KDF, 46 of 48 on Wadi Tarfan KDF). What stood
 * idle was at home: the probe's away-from-home reading is 0 in every one of these games, so the units may be the commander's own guard and zone holders
 * (slice 1) and not a seat that gave up; the reading cannot tell, so the cells stay closed. Reopening them is that question (HOLD FOR LEAD), not a number here.
 */
export const CLOSED_COMPUTER_CELLS: readonly ClosedComputerCell[] = [
  { map: 'tel_marum', matchup: 'kdf', winMode: null, why: '1 of 48 games stopped playing' },
  { map: 'tel_marum', matchup: 'sarim', winMode: null, why: '1 of 48 games stopped playing' },
  { map: 'wadi_tarfan_l', matchup: 'kdf', winMode: null, why: '39 of 48 games stopped playing' },
  { map: 'wadi_tarfan_l', matchup: 'sarim', winMode: null, why: '29 of 48 games stopped playing' },
  { map: 'wadi_tarfan', matchup: 'kdf', winMode: null, why: '28 of 48 games stopped playing' },
  { map: 'wadi_tarfan', matchup: 'sarim', winMode: null, why: '36 of 48 games stopped playing' },
];

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
