// The TEST-coin purchase end to end, through the real pieces main.ts wires:
// the store model decides, the TEST wallet records, `accountView` (main.ts's
// `accountState()`) joins it, and `kdfUnlockGate` hands every surface the
// gate -- the garage, the reinforcement dock (`unitInfo`) and
// `resolveUpgrades` alike.
import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { unlockReason } from '@lions/sim';
import { accountView } from './account-view';
import { ACCOUNT_KEY } from './brigade-account';
import { gateSentence } from './gate-sentence';
import { kdfUnlockGate } from './kdf-gate';
import { memoryLedgerStore } from './ledger-store';
import { ROAR_TEST_KEY, coinTiers, emptyRoarTest, type RoarTestAccount } from './roar-test';
import { buyWithTestCoins, coinPrice, type CoinAsk, type StoreInput } from './ui/stores-model';

const kdf = Object.values(units).filter((u) => u.faction === 'kdf');

function seeded(coins: number, credits = 0) {
  const store = memoryLedgerStore({
    [ROAR_TEST_KEY]: JSON.stringify({ ...emptyRoarTest(), coins, seeded: true }),
    [ACCOUNT_KEY]: JSON.stringify({ version: 1, balance: credits, earned_total: credits, paid: {}, unlocks: [], upgrades: {}, grants: credits > 0 ? [{ source: 'granted', amount: credits, at: 1 }] : [] }),
  });
  return store;
}

/** What main.ts's `onBuy` builds before it asks the model. */
function inputOf(store: ReturnType<typeof memoryLedgerStore>): StoreInput {
  const view = accountView(store);
  const account = store.readAccount();
  const roar = store.readRoarTest();
  return {
    units: kdf.map((u) => ({
      id: u.id,
      name: u.name,
      unlock: kdfUnlockGate(u, view.boughtUnits),
      upgrades: 'upgrades' in u ? u.upgrades : undefined,
    })),
    ledger: store.readLedger(),
    credits: view.balance,
    owned: view.ownedTiers,
    coin: {
      earnedUnits: new Set(account.unlocks),
      coinUnits: new Set(Object.keys(roar.entitlements.units)),
      earnedTiers: account.upgrades,
      coinTiers: coinTiers(roar),
    },
  };
}

function buy(store: ReturnType<typeof memoryLedgerStore>, ask: CoinAsk): { ok: boolean; after: RoarTestAccount } {
  const { account, ok } = buyWithTestCoins(inputOf(store), store.readRoarTest(), ask, 1000);
  if (ok) store.writeRoarTest(account);
  return { ok, after: store.readRoarTest() };
}

describe('buying with TEST coins', () => {
  it('spends the derived coin price, marks the unit coin-bought, and leaves credits alone', () => {
    const store = seeded(1000, 1240);
    const before = store.raw(ACCOUNT_KEY);
    const { ok, after } = buy(store, { kind: 'unit', unitId: 'apc_kipod' });
    expect(ok).toBe(true);
    expect(after.coins).toBe(1000 - coinPrice(3200));
    expect(after.coins).toBe(680);
    expect(after.entitlements.units.apc_kipod).toEqual({ coins: true });
    expect(after.receipts.at(-1)).toMatchObject({ kind: 'unit', unitId: 'apc_kipod', coins: 320, credits: 3200 });
    // Coins replace credits: the brigade account -- balance, unlocks, all of
    // it -- is byte-for-byte what it was.
    expect(store.raw(ACCOUNT_KEY)).toBe(before);
    expect(accountView(store).balance).toBe(1240);
  });

  it('the garage and the mission see the unit open; network play would not', () => {
    const store = seeded(1000);
    const kipod = kdf.find((u) => u.id === 'apc_kipod');
    if (kipod === undefined) throw new Error('apc_kipod missing');
    const closed = kdfUnlockGate(kipod, accountView(store).boughtUnits);
    expect(unlockReason(closed, {})).not.toBeNull();
    buy(store, { kind: 'unit', unitId: 'apc_kipod' });
    const open = kdfUnlockGate(kipod, accountView(store).boughtUnits);
    // The runtime's own check (what the dock's Build obeys) and the dock
    // tile's sentence both read it open.
    expect(unlockReason(open, {})).toBeNull();
    expect(gateSentence(open ?? {}, {}, () => undefined)).toBeNull();
    // ...and the earned half still says nothing was bought.
    expect(store.readAccount().unlocks).toEqual([]);
  });

  it('a tier lands on the single-player kit the boot prepass reads', () => {
    const store = seeded(1000);
    buy(store, { kind: 'unit', unitId: 'apc_kipod' });
    const { ok, after } = buy(store, { kind: 'tier', unitId: 'apc_kipod', track: 'armour', tier: 1 });
    expect(ok).toBe(true);
    expect(after.coins).toBe(1000 - 320 - coinPrice(225));
    expect(accountView(store).ownedTiers).toEqual({ apc_kipod: { armour: 1 } });
  });

  it('refuses what the screen would not offer: off sale, short, earned, out of order, unopened', () => {
    const store = seeded(100000);
    expect(buy(store, { kind: 'unit', unitId: 'heli_peten_gunship' }).ok).toBe(false); // G1
    expect(buy(store, { kind: 'unit', unitId: 'inf_squad' }).ok).toBe(false); // no price: starting roster
    expect(buy(store, { kind: 'tier', unitId: 'apc_kipod', track: 'armour', tier: 1 }).ok).toBe(false); // unit not open
    expect(buy(store, { kind: 'tier', unitId: 'inf_squad', track: 'armour', tier: 2 }).ok).toBe(false); // skips tier 1
    const short = seeded(10);
    expect(buy(short, { kind: 'unit', unitId: 'apc_kipod' }).ok).toBe(false);
    expect(short.readRoarTest().coins).toBe(10);
    buy(store, { kind: 'unit', unitId: 'apc_kipod' });
    expect(buy(store, { kind: 'unit', unitId: 'apc_kipod' }).ok).toBe(false); // already coin-bought
  });
});
