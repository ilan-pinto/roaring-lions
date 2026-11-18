// GH-1390: the commander coverage probe. Report-only tooling, but its table is quoted as evidence, so its own parts are held here: the cell
// enumeration (a literal census of the open cells), the config a cell mints, the stall detectors (a silent commander must read as a stall,
// the shipped one must not read as an idle-unit stall), and that a passive baseline orders nothing.
import { describe, expect, it } from 'vitest';
import { BASELINES, STALL_TICKS, cellsOf, commanderFaction, configOf, playGame, rowsOf, seedOf, tableOf, type Cell } from './commander-probe';

const cell = (o: Partial<Cell> = {}): Cell => ({ map: 'tel_marum', matchup: 'mirror', winMode: null, commanderSeat: 0, baseline: 'passive', ...o });

describe('the open cells', () => {
  it('are 124 (map x matchup x win mode x commander seat x baseline), by pairing and mode as the lobby tables list them today', () => {
    const cells = cellsOf();
    expect(cells.length).toBe(124);
    const by: Record<string, number> = {};
    for (const c of cells) by[`${c.matchup}/${c.winMode ?? 'annihilation'}`] = (by[`${c.matchup}/${c.winMode ?? 'annihilation'}`] ?? 0) + 1;
    // Each is 2 seats x 2 baselines per (map, matchup, mode). Re-pin on purpose when VERSUS_FAIR_MAPS, FACTION_MATCHUP_MAPS or the win-mode tables change.
    expect(by).toEqual({
      'mirror/annihilation': 28, 'mirror/points': 28, 'mirror/camp': 12, 'mirror/flag': 16,
      'kdf/annihilation': 12, 'sarim/annihilation': 12, 'kdf/camp': 8, 'sarim/camp': 8,
    });
    expect(new Set(cells.map((c) => c.map)).size).toBe(7);
    expect(new Set(cells.map((c) => c.baseline))).toEqual(new Set(BASELINES));
  });

  it('the Sarim commander exists only in faction cells, and the commander plays the seat the cell names', () => {
    expect(commanderFaction(cell({ matchup: 'kdf', commanderSeat: 1 }))).toBe('sarim');
    expect(commanderFaction(cell({ matchup: 'sarim', commanderSeat: 0 }))).toBe('sarim');
    expect(commanderFaction(cell({ matchup: 'mirror', commanderSeat: 1 }))).toBe('kdf');
    const sarim = cellsOf().filter((c) => commanderFaction(c) === 'sarim');
    expect(sarim.length).toBeGreaterThan(0);
    expect(sarim.every((c) => c.matchup !== 'mirror')).toBe(true);
  });
});

describe('the config a cell mints', () => {
  it('carries the win mode, and the flag set-up rules only for a flag room on a set-up map', () => {
    expect(configOf(cell({ map: 'wadi_tarfan', winMode: 'flag' }), 1).flagSetup).toBe(true);
    expect(configOf(cell({ map: 'wadi_tarfan', winMode: 'flag' }), 1).winMode).toBe('flag');
    expect(configOf(cell({ map: 'wadi_tarfan', winMode: 'points' }), 1).flagSetup).toBeUndefined();
    expect(configOf(cell(), 1).winMode).toBeUndefined();
  });
  it('seats the factions as the matchup says, the host first, and both seats are bots', () => {
    const c = configOf(cell({ matchup: 'sarim' }), seedOf(3));
    expect(c.seats.map((s) => s.faction)).toEqual(['sarim', 'kdf']);
    expect(c.seats.map((s) => s.side)).toEqual([1, 0]);
    expect(c.seats.every((s) => s.kind === 'bot')).toBe(true);
    expect(c.seed).toBe(1000 + 3 * 7919);
  });
  it('every open cell mints a valid config', () => {
    for (const c of cellsOf({ baselines: ['passive'] })) expect(() => configOf(c, 1000), JSON.stringify(c)).not.toThrow();
  });
});

describe('the stall detectors', () => {
  it('a commander that never orders reads as a literal stall AND an idle-unit stall (self-check: the detectors detect)', () => {
    const r = playGame(cell(), 1000, { capTicks: 3000, commander: 'silent' });
    expect(r.status).toBe('played');
    expect(r.commanderOrders).toBe(0);
    expect(r.firstOrderTick).toBeNull();
    expect(r.stallLiteral).toBe(true);
    expect(r.stallIdle).toBe(true);
    expect(r.maxIdleSilentTicks).toBeGreaterThanOrEqual(STALL_TICKS);
  });

  it('a passive baseline orders nothing: two silent seats never fight, and the game runs to the cap undecided', () => {
    const r = playGame(cell(), 1000, { capTicks: 2500, commander: 'silent' });
    expect(r.winner).toBe('undecided');
    expect(r.ticks).toBeGreaterThanOrEqual(2500);
  });

  it('the shipped commander on a mirror cell issues its first order at its first decision (tick 100), wins the passive baseline, and never stalls with an idle unit', () => {
    const r = playGame(cell(), 1000);
    expect(r.status).toBe('played');
    expect(r.firstOrderTick).toBe(100);
    expect(r.winner).toBe('commander');
    expect(r.by).toBe('annihilation');
    expect(r.stallIdle).toBe(false);
    expect(r.maxIdleSilentTicks).toBeLessThan(STALL_TICKS);
  }, 120_000);
});

describe('the idle-unit detector counts what the seat could order', () => {
  it("a man down is a casualty, not an idle unit: tel_marum mirror, seed 40595, seat 1 against rush: one order, then a fight it lost, and no 60 s of idle silence", () => {
    // Found by the first full run: the detector counted downed (wounded) men as idle and read 1460 idle-silent ticks in a game whose seat had no unit left to order.
    const r = playGame(cell({ commanderSeat: 1, baseline: 'rush' }), 40595);
    expect(r.commanderOrders).toBe(1);
    expect(r.winner).toBe('baseline');
    expect(r.maxIdleSilentTicks).toBe(100);
    expect(r.stallIdle).toBe(false);
  }, 120_000);
});

describe('the table', () => {
  it('groups by cell, counts stalls and outcomes, and words an unsupported cell without playing it', () => {
    const played = playGame(cell(), 1000);
    const unsupported = { ...played, seed: 1001, status: 'unsupported' as const, note: 'no valid config' };
    const rows = rowsOf([played, unsupported]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ games: 1, unsupported: 1, win: 1, loss: 0 });
    expect(tableOf(rows)).toContain('(+1 unsupported)');
  }, 120_000);
});
