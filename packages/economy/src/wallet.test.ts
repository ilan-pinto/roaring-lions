import { describe, expect, it } from 'vitest';
import { MAX_COINS, emptyRoar, grantFree, migrateRoar } from './wallet';

// Oracles take literals: the app's tests import MAX_COINS from the code under test,
// so a changed cap passed them all (found by the A0 move's falsification, GH-1075).
describe('the coin cap, pinned to a literal', () => {
  it('is one million', () => {
    expect(MAX_COINS).toBe(1_000_000);
  });
  it('clamps a migrated balance and a grant at one million', () => {
    expect(migrateRoar({ coins: { free: 5_000_000 } }).coins.free).toBe(1_000_000);
    const w = grantFree({ ...emptyRoar(), coins: { free: 999_990, paid: 0 } }, 100, (id, coins) => ({ kind: 'earn', id, at: 1, coins, source: 'welcome' }), 1);
    expect(w.coins.free).toBe(1_000_000);
  });
});
