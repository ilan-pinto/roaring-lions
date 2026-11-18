// GH-1391 slice 1: each commander behaviour has a scripted scenario, a real room played to a fixed tick on a fixed seed, in which REMOVING the behaviour
// changes the result. The cells are the probe's (`commander-probe.ts`); every number below was read off the run and every comparison seen red with the
// behaviour's switch the other way (the commit lists the mutations). Deterministic: same seed, same game.
import { describe, expect, it } from 'vitest';
import { playGame, seedOf, type Cell } from './commander-probe';

const CAP = 9000; // 7.5 sim-minutes: long enough for production to matter, short enough for a test
const sarimEconomy: Cell = { map: 'tel_marum', matchup: 'sarim', winMode: null, commanderSeat: 0, baseline: 'passive' };
const kdfEconomy: Cell = { map: 'tel_marum', matchup: 'kdf', winMode: null, commanderSeat: 0, baseline: 'passive' };
const underAttack: Cell = { map: 'wadi_tarfan', matchup: 'sarim', winMode: null, commanderSeat: 0, baseline: 'rush' };

describe('production: the seat queues units from its camp\'s line', () => {
  it('with it, a Sarim commander in an economy room issues build orders and stands with more units than without it', () => {
    const on = playGame(sarimEconomy, seedOf(0), { commander: 'slice1', capTicks: CAP });
    const off = playGame(sarimEconomy, seedOf(0), { commander: 'slice1', capTicks: CAP, options: { produce: false } });
    expect(off.buildOrders).toBe(0);
    expect(on.buildOrders).toBeGreaterThanOrEqual(8);
    expect(on.ownUnitsEnd).toBeGreaterThan(off.ownUnitsEnd + 8);
  }, 120_000);

  it('the shipped seat (no commander) never builds, in the same room', () => {
    const rush = playGame(sarimEconomy, seedOf(0), { commander: 'rush', capTicks: CAP });
    expect(rush.buildOrders).toBe(0);
  }, 120_000);
});

describe('zones: the seat takes and holds income zones', () => {
  it('with it, the seat holds zones for far more of the game than without it (zone-board samples held, every 5 s)', () => {
    const on = playGame(kdfEconomy, seedOf(0), { commander: 'slice1', capTicks: CAP });
    const off = playGame(kdfEconomy, seedOf(0), { commander: 'slice1', capTicks: CAP, options: { zones: false } });
    expect(on.zoneSamplesHeld).toBeGreaterThan(off.zoneSamplesHeld * 2);
  }, 120_000);
});

describe('zones: taking, apart from holding', () => {
  it('with the idle units sent to take them, the seat holds zones for more of the game than if they only held what they happened to stand in', () => {
    const on = playGame(kdfEconomy, seedOf(0), { commander: 'slice1', capTicks: CAP });
    const off = playGame(kdfEconomy, seedOf(0), { commander: 'slice1', capTicks: CAP, options: { takeZones: false } });
    expect(on.zoneSamplesHeld).toBeGreaterThan(off.zoneSamplesHeld);
  }, 120_000);
});

describe('defend: a threat at the camp is met at the camp', () => {
  it('with it, the commander stands with more units against a rushing opponent, on two seeds, than without it', () => {
    for (const n of [0, 1]) {
      const on = playGame(underAttack, seedOf(n), { commander: 'slice1', capTicks: CAP });
      const off = playGame(underAttack, seedOf(n), { commander: 'slice1', capTicks: CAP, options: { defend: false } });
      expect(on.ownUnitsEnd, `seed ${n}`).toBeGreaterThan(off.ownUnitsEnd);
    }
  }, 240_000);
});

describe('the guard: what was built stays to defend', () => {
  it('with it, the commander stands with more units against a rushing opponent than with the built units marched out at once', () => {
    const on = playGame(underAttack, seedOf(0), { commander: 'slice1', capTicks: CAP });
    const off = playGame(underAttack, seedOf(0), { commander: 'slice1', capTicks: CAP, options: { guard: false } });
    expect(on.ownUnitsEnd).toBeGreaterThan(off.ownUnitsEnd);
  }, 120_000);
});

describe('what the commander does not change', () => {
  it('in a mirror room (no economy, no zones) it plays the shipped script move for move: the same game, to the tick and the outcome', () => {
    const cell: Cell = { map: 'tel_marum', matchup: 'mirror', winMode: null, commanderSeat: 0, baseline: 'rush' };
    const a = playGame(cell, seedOf(0), { commander: 'rush' });
    const b = playGame(cell, seedOf(0), { commander: 'slice1' });
    expect([b.ticks, b.winner, b.by, b.commanderOrders]).toEqual([a.ticks, a.winner, a.by, a.commanderOrders]);
  }, 120_000);
});

// ---- slice 2 (GH-1391): the scout and the counter are opt-in; each changes a real game when switched on -------------------------------

const mirrorRush: Cell = { map: 'beit_sahwan_outskirts', matchup: 'mirror', winMode: null, commanderSeat: 0, baseline: 'rush' };

describe('slice 2: the scout', () => {
  it('with it on the commander sends a unit ahead with a move order (one), and with it off it sends none, on two seeds', () => {
    for (const n of [0, 1]) {
      const on = playGame(mirrorRush, seedOf(n), { commander: 'slice2', options: { counter: false } });
      const off = playGame(mirrorRush, seedOf(n), { commander: 'slice1' });
      expect(off.moveOrders, `seed ${n}`).toBe(0);
      expect(on.moveOrders, `seed ${n}`).toBeGreaterThanOrEqual(1);
    }
  }, 240_000);
});

describe('slice 2: the counter', () => {
  it('against a rushing KDF force a Sarim commander builds more infantry with it than without it', () => {
    const cell: Cell = { ...sarimEconomy, baseline: 'rush' };
    const on = playGame(cell, seedOf(0), { commander: 'slice2', capTicks: CAP, options: { scout: false } });
    const off = playGame(cell, seedOf(0), { commander: 'slice1', capTicks: CAP });
    expect(on.builtKinds.inf).toBeGreaterThan(off.builtKinds.inf);
  }, 240_000);
});

describe('slice 3: retreat', () => {
  it('with it on, a commander that is losing sends units home with move orders in a real room; with it off it sends none, on two seeds', () => {
    for (const n of [0, 1]) {
      const on = playGame(underAttack, seedOf(n), { commander: 'slice3', capTicks: CAP });
      const off = playGame(underAttack, seedOf(n), { commander: 'slice1', capTicks: CAP });
      expect(off.moveOrders, `seed ${n}`).toBe(0);
      expect(on.moveOrders, `seed ${n}`).toBeGreaterThanOrEqual(1);
    }
  }, 240_000);
});

describe('slice 4: mass, then commit', () => {
  it('in an economy room against a passive foe the massing seat leaves the enemy untouched for the first minute, where the slice 1 seat is already killing it', () => {
    const at = 1200; // 60 s
    const on = playGame(kdfEconomy, seedOf(0), { commander: 'slice4', capTicks: at });
    const off = playGame(kdfEconomy, seedOf(0), { commander: 'slice1', capTicks: at });
    expect(on.enemyUnitsEnd).toBeGreaterThan(off.enemyUnitsEnd);
  }, 240_000);
});
