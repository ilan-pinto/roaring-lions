import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import type { LedgerData } from '@lions/sim';
import { emptyAccount } from './brigade';
import { buildCoinHalf, kdfUnlockGate, storeInputFor } from './store-input';
import { storeItems, type StoreInput } from './stores';
import { emptyRoar, singlePlayerView } from './wallet';

const brigade = { ...emptyAccount(), balance: 3000, unlocks: ['mbt_lavi'] };
const roar = (() => {
  const w = emptyRoar();
  w.entitlements.units['ifv_namer'] = { free: true };
  w.entitlements.upgrades['mbt_lavi'] = { armour: { tier: units.mbt_lavi.upgrades.armour.tiers.length, paidTiers: 0 } };
  return w;
})();
const ledger: LedgerData = {};

// main.ts's construction before A2, copied as a literal function.
function oldWay(): StoreInput {
  const view = singlePlayerView(brigade, roar);
  const garage = (bought: ReadonlySet<string>) =>
    Object.values(units)
      .filter((u) => u.faction === 'kdf' && u.role !== 'wounded')
      .map((u) => ({ id: u.id, name: u.name, role: u.role, unlock: kdfUnlockGate(u, bought), upgrades: 'upgrades' in u ? u.upgrades : undefined }));
  const kdfUnits = garage(view.boughtUnits);
  return { units: garage(view.boughtUnits), ledger, credits: brigade.balance, owned: view.ownedTiers, coin: buildCoinHalf(kdfUnits, brigade, roar) };
}

describe('storeInputFor', () => {
  it('equals the main.ts construction', () => {
    const made = storeInputFor({ ledger, brigade, roar });
    const old = oldWay();
    // Field by field, wounded filter, names, gates and upgrade shapes included.
    expect(made.units.map((u) => [u.id, u.name, u.unlock, u.upgrades])).toEqual(old.units.map((u) => [u.id, u.name, u.unlock, u.upgrades]));
    expect(made.units.some((u) => u.id.includes('wounded'))).toBe(false);
    expect(made.credits).toBe(old.credits);
    expect(made.owned).toEqual(old.owned);
    expect(made.coin).toEqual(old.coin);
    const items = storeItems(made);
    expect(items).toEqual(storeItems(oldWay()));
    // The fixture is not vacuous: the credit unit, the coin unit and the coin tier all show.
    expect(items.units.length).toBeGreaterThan(0);
    expect(items.units.some((u) => u.state === 'coins')).toBe(true);
    expect(items.tiers.some((t) => t.state === 'coins')).toBe(true);
    expect(items.units.some((u) => u.state === 'earned')).toBe(true);
  });

  // F1 (GH-1385 C1): the test above compares storeInputFor with a copy that calls the same
  // buildCoinHalf and kdfUnlockGate, so a changed default moves both sides. These read literals.
  it('literal tables: the unlock gate, the explicit 0 earned tier and a held upgrade', () => {
    const held = { ...brigade, upgrades: { mbt_lavi: { armour: 2 } } };
    const made = storeInputFor({ ledger, brigade: held, roar });
    const lavi = units.mbt_lavi.unlock as { roe_rating_min: number; price: number };
    const namer = units.ifv_namer.unlock as { roe_rating_min: number; price: number };
    const drone = units.recon_drone.unlock as { roe_rating_min: number; price: number };
    const gate = (id: string) => made.units.find((u) => u.id === id)?.unlock;
    // Authored names mapped to UnlockGate, `bought` resolved from the account's unlocks.
    expect(gate('mbt_lavi')).toEqual({ roeMin: lavi.roe_rating_min, starsMin: undefined, afterMission: undefined, price: lavi.price, bought: true });
    // The Namer is held on coins (the fixture's `roar`): the single-player view counts that as bought.
    expect(gate('ifv_namer')).toEqual({ roeMin: namer.roe_rating_min, starsMin: undefined, afterMission: undefined, price: namer.price, bought: true });
    expect(gate('recon_drone')).toEqual({ roeMin: drone.roe_rating_min, starsMin: undefined, afterMission: undefined, price: drone.price, bought: false });
    // A track the account holds keeps its value; every other track of an unbought unit is an
    // EXPLICIT 0 (an absent entry would fall back to `owned` and read a coin tier as earned).
    expect(made.coin.earnedTiers['mbt_lavi']).toEqual({ armour: 2, sensors: 0, firepower: 0 });
    expect(made.coin.earnedTiers['ifv_namer']).toEqual({ armour: 0, sensors: 0, firepower: 0 });
    expect(made.coin.earnedTiers['aa_remetz']).toEqual({});
    expect(made.coin.earnedTiers['recon_drone']).toEqual({ armour: 0, sensors: 0 });
    // A unit the account holds that the roster does not list keeps its stored tracks.
    const ghost = storeInputFor({ ledger, brigade: { ...brigade, upgrades: { not_a_unit: { armour: 1 } } }, roar });
    expect(ghost.coin.earnedTiers['not_a_unit']).toEqual({ armour: 1 });
  });
});
