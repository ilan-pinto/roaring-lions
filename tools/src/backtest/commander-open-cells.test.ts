import { describe, expect, it } from 'vitest';
import { openCellsOf, type GameRecord } from './commander-probe';

const rec = (o: { map?: string; matchup?: 'mirror' | 'kdf' | 'sarim'; winMode?: 'points' | null; seat?: 0 | 1; idle?: boolean; away?: boolean; literal?: boolean; status?: 'played' | 'error'; first?: number | null; by?: string }): GameRecord => ({
  cell: { map: o.map ?? 'tel_marum', matchup: o.matchup ?? 'kdf', winMode: o.winMode ?? null, commanderSeat: o.seat ?? 1, baseline: 'passive' },
  seed: 1, commanderFaction: 'kdf', status: o.status ?? 'played', ticks: 100, capTicks: 1000, winner: 'commander', by: o.by ?? 'annihilation',
  commanderOrders: 3, buildOrders: 0, ownUnitsEnd: 5, enemyUnitsEnd: 0, zoneSamplesHeld: 0, ordersPerMin: 1,
  firstOrderTick: o.first === undefined ? 100 : o.first, maxSilentTicks: 0, maxIdleSilentTicks: 0, maxAwaySilentTicks: 0,
  stallLiteral: o.literal ?? false, stallIdle: o.idle ?? false, stallAway: o.away ?? false, wallMs: 1,
  builtKinds: { anti: 0, inf: 0, other: 0 }, enemyPeak: { armour: 0, soft: 0 }, seenPeak: { armour: 0, soft: 0 }, firstContactTick: null, moveOrders: 0,
});

describe('which cells the lobby may seat the computer in (GH-1390)', () => {
  it('a cell whose games all played, ordered and never stopped is open', () => {
    const [row] = openCellsOf([rec({}), rec({}), rec({})]);
    expect(row).toMatchObject({ games: 3, idleStalls: 0, awayStalls: 0, open: true, why: '' });
  });

  it('one game that stopped playing (60 s, no order, an idle unit standing by AWAY from home) closes the cell, and says how many', () => {
    const [row] = openCellsOf([rec({}), rec({ idle: true, away: true }), rec({})]);
    expect(row?.open).toBe(false);
    expect(row?.why).toMatch(/1 of 3 games stopped playing .* away from home/);
  });

  it('an idle unit AT HOME is the commander\'s guard, not a stall (the lead\'s ruling, 20 Nov 2026): it is counted, and does not close the cell', () => {
    const [row] = openCellsOf([rec({ idle: true }), rec({ idle: true }), rec({})]);
    expect(row).toMatchObject({ games: 3, idleStalls: 2, awayStalls: 0, open: true, why: '' });
  });

  it('the literal 60 s of silence is counted but does not close a cell (a seat in a firefight is silent)', () => {
    const [row] = openCellsOf([rec({ literal: true }), rec({ literal: true })]);
    expect(row).toMatchObject({ literalStalls: 2, open: true });
  });

  it('a game that was not played, or in which the seat never gave an order, closes the cell', () => {
    expect(openCellsOf([rec({ status: 'error' })])[0]?.open).toBe(false);
    expect(openCellsOf([rec({ first: null })])[0]?.open).toBe(false);
  });

  it('only the games with the commander at seat 1 count: the lobby seats the computer there', () => {
    const rows = openCellsOf([rec({ seat: 0, idle: true, away: true }), rec({ seat: 1 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ games: 1, open: true });
    // and a cell with only seat 0 games has no row at all: it can never be read open by default
    expect(openCellsOf([rec({ seat: 0 })])).toEqual([]);
  });

  it('cells are told apart by ground, pairing and mode, and sorted', () => {
    const rows = openCellsOf([rec({ map: 'wadi_tarfan', idle: true, away: true }), rec({ map: 'tel_marum' }), rec({ map: 'tel_marum', winMode: 'points', matchup: 'mirror' })]);
    expect(rows.map((r) => `${r.map} ${r.matchup} ${r.winMode} ${r.open}`)).toEqual(['tel_marum kdf null true', 'tel_marum mirror points true', 'wadi_tarfan kdf null false']);
  });
});
