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
});
