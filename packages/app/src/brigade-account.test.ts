import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_KEY,
  buyUnlock,
  buyUpgrade,
  emptyAccount,
  loadAccount,
  migrateAccount,
  payMission,
  resetAccount,
  saveAccount,
  type StorageLike,
} from './brigade-account';

/** Map-backed, the shape a browser hands over -- not a spy. */
const store = (): StorageLike & { box: Map<string, string> } => {
  const box = new Map<string, string>();
  return {
    box,
    getItem: (k) => box.get(k) ?? null,
    setItem: (k, v) => void box.set(k, v),
    removeItem: (k) => void box.delete(k),
  };
};

describe('brigade account', () => {
  it('starts empty and round-trips through storage under its own key', () => {
    const s = store();
    expect(loadAccount(s)).toEqual(emptyAccount());
    const paid = payMission(emptyAccount(), 'beit_sahwan_1_recon', 160, 1000);
    saveAccount(s, paid.account);
    expect(s.box.has(ACCOUNT_KEY)).toBe(true);
    expect(loadAccount(s)).toEqual(paid.account);
  });

  it('pays a first win in full and records it', () => {
    const { account, paid } = payMission(emptyAccount(), 'm1', 160, 1000);
    expect(paid).toBe(160);
    expect(account.balance).toBe(160);
    expect(account.earned_total).toBe(160);
    expect(account.paid.m1).toBe(160);
    expect(account.grants).toEqual([{ source: 'earned', amount: 160, missionId: 'm1', at: 1000 }]);
  });

  it('pays a replay only for improvement, and moves the record up', () => {
    const first = payMission(emptyAccount(), 'm1', 160, 1000).account;
    const worse = payMission(first, 'm1', 120, 2000);
    expect(worse.paid).toBe(0);
    expect(worse.account.balance).toBe(160);
    expect(worse.account.paid.m1).toBe(160);
    expect(worse.account.grants).toHaveLength(1);
    const better = payMission(worse.account, 'm1', 190, 3000);
    expect(better.paid).toBe(30);
    expect(better.account.balance).toBe(190);
    expect(better.account.earned_total).toBe(190);
    expect(better.account.paid.m1).toBe(190);
  });

  it('never mutates the account it is given', () => {
    const before = emptyAccount();
    const snapshot = JSON.stringify(before);
    payMission(before, 'm1', 160, 1000);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('migrates junk and partial saves to a valid account', () => {
    expect(migrateAccount(null)).toEqual(emptyAccount());
    expect(migrateAccount('not json shaped')).toEqual(emptyAccount());
    expect(migrateAccount({ version: 1, balance: 50 })).toEqual({ ...emptyAccount(), balance: 50 });
    // A negative or non-integer balance is corruption, not a debt.
    expect(migrateAccount({ version: 1, balance: -5 }).balance).toBe(0);
    expect(migrateAccount({ version: 1, balance: 2.5 }).balance).toBe(0);
  });

  it('keeps a granted entry and counts it in the bound, and no client path writes one', () => {
    // The paid path's shape (spec §4.6) is data this module carries but never creates:
    // `payMission` is the only constructor of a grant and only ever writes 'earned',
    // but a save can already carry a well-formed 'granted' one (ruling R6), and this
    // module does not destroy it.
    const raw = { ...emptyAccount(), balance: 900, grants: [{ source: 'granted', amount: 900, at: 1 }] };
    const migrated = migrateAccount(raw);
    expect(migrated.grants).toEqual([{ source: 'granted', amount: 900, at: 1 }]);
    expect(migrated.balance).toBe(900);
    const paid = payMission(emptyAccount(), 'm1', 10, 1).account;
    expect(paid.grants.every((g) => g.source === 'earned')).toBe(true);
  });

  it('keeps a legitimate balance below the earned sum as is, and bounds earned_total the same way', () => {
    const raw = {
      ...emptyAccount(),
      balance: 40,
      earned_total: 40,
      grants: [{ source: 'earned', amount: 100, missionId: 'm1', at: 1 }],
    };
    const migrated = migrateAccount(raw);
    // 40 is below the 100 the log accounts for -- a legitimate spend (step 2 "Buy"),
    // not corruption, so it is kept exactly, not raised to 100.
    expect(migrated.balance).toBe(40);
    // A save claiming 500 earned_total against a log that accounts for only 100 is
    // bounded down the same way balance is.
    expect(migrateAccount({ ...raw, earned_total: 500 }).earned_total).toBe(100);
  });

  it('treats a present but non-array grants field as present, and bounds the balance to 0', () => {
    // Hand-edited to something that is not a log at all: `'grants' in r` still reads
    // true, `migrateGrants` reads it as empty, and a balance no entry explains is
    // reduced to 0 rather than trusted.
    const migrated = migrateAccount({ ...emptyAccount(), balance: 900, grants: 'not a log' });
    expect(migrated.balance).toBe(0);
    expect(migrated.grants).toEqual([]);
  });

  it('loads a corrupt key as empty rather than throwing', () => {
    const s = store();
    s.setItem(ACCOUNT_KEY, '{not json');
    expect(loadAccount(s)).toEqual(emptyAccount());
  });

  it('resets to empty and removes the key', () => {
    const s = store();
    saveAccount(s, payMission(emptyAccount(), 'm1', 160, 1000).account);
    expect(resetAccount(s)).toEqual(emptyAccount());
    expect(s.box.has(ACCOUNT_KEY)).toBe(false);
  });

  it('buys an unlock: deducts the price and records the id, without a grant', () => {
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    const { account, ok } = buyUnlock(funded, 'mbt_lavi', 600);
    expect(ok).toBe(true);
    expect(account.balance).toBe(400);
    expect(account.unlocks).toEqual(['mbt_lavi']);
    expect(account.earned_total).toBe(1000);
    expect(account.grants).toHaveLength(1);
    expect(funded.balance).toBe(1000); // input untouched
  });

  it('refuses when the balance is short, the id is already bought, or the price is not an integer', () => {
    const funded = payMission(emptyAccount(), 'm1', 500, 1).account;
    expect(buyUnlock(funded, 'mbt_lavi', 600)).toEqual({ account: funded, ok: false });
    const bought = buyUnlock(funded, 'mbt_lavi', 500).account;
    expect(buyUnlock(bought, 'mbt_lavi', 0)).toEqual({ account: bought, ok: false });
    expect(buyUnlock(funded, 'x', 2.5)).toEqual({ account: funded, ok: false });
    expect(buyUnlock(funded, 'x', -1)).toEqual({ account: funded, ok: false });
    expect(buyUnlock(funded, 'x', 0).ok).toBe(false); // schema minimum is 1; price 0 authors nothing
  });

  it('round-trips a bought unlock through storage', () => {
    const s = store();
    saveAccount(s, buyUnlock(payMission(emptyAccount(), 'm1', 700, 1).account, 'ifv_namer', 700).account);
    expect(loadAccount(s).unlocks).toEqual(['ifv_namer']);
    expect(loadAccount(s).balance).toBe(0);
  });

  it('buys tier 1 of a track: deducts the price, records the tier, without a grant', () => {
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    const { account, ok } = buyUpgrade(funded, 'inf_squad', 'armour', 1, 300);
    expect(ok).toBe(true);
    expect(account.balance).toBe(700);
    expect(account.upgrades.inf_squad?.armour).toBe(1);
    expect(account.earned_total).toBe(1000);
    expect(account.grants).toHaveLength(1);
    expect(funded.balance).toBe(1000); // input untouched
  });

  it('buys tier 2 after tier 1', () => {
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    const tier1Result = buyUpgrade(funded, 'inf_squad', 'armour', 1, 300);
    expect(tier1Result.ok).toBe(true);
    const tier2Result = buyUpgrade(tier1Result.account, 'inf_squad', 'armour', 2, 400);
    expect(tier2Result.ok).toBe(true);
    expect(tier2Result.account.balance).toBe(300);
    expect(tier2Result.account.upgrades.inf_squad?.armour).toBe(2);
  });

  it('refuses tier 2 when at 0 (not the next tier)', () => {
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    const { account, ok } = buyUpgrade(funded, 'inf_squad', 'armour', 2, 400);
    expect(ok).toBe(false);
    expect(account).toBe(funded); // same object by identity
  });

  it('refuses tier 1 when already at tier 1 (not the next tier)', () => {
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    const tier1 = buyUpgrade(funded, 'inf_squad', 'armour', 1, 300).account;
    const { account, ok } = buyUpgrade(tier1, 'inf_squad', 'armour', 1, 300);
    expect(ok).toBe(false);
    expect(account).toBe(tier1); // same object by identity
  });

  it('refuses tier 0 (not the next tier)', () => {
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    const { account, ok } = buyUpgrade(funded, 'inf_squad', 'armour', 0, 300);
    expect(ok).toBe(false);
    expect(account).toBe(funded);
  });

  it('refuses when the balance is short', () => {
    const funded = payMission(emptyAccount(), 'm1', 100, 1).account;
    const { account, ok } = buyUpgrade(funded, 'inf_squad', 'armour', 1, 300);
    expect(ok).toBe(false);
    expect(account).toBe(funded); // same object by identity
  });

  it('refuses when the price is not a positive integer', () => {
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    expect(buyUpgrade(funded, 'inf_squad', 'armour', 1, 0).ok).toBe(false);
    expect(buyUpgrade(funded, 'inf_squad', 'armour', 1, 2.5).ok).toBe(false);
    expect(buyUpgrade(funded, 'inf_squad', 'armour', 1, -1).ok).toBe(false);
  });

  it('preserves other units and tracks when upgrading one', () => {
    const funded = payMission(emptyAccount(), 'm1', 2000, 1).account;
    const step1 = buyUpgrade(funded, 'inf_squad', 'armour', 1, 300).account;
    const step2 = buyUpgrade(step1, 'mbt_lavi', 'firepower', 1, 400).account;
    expect(step2.upgrades.inf_squad?.armour).toBe(1);
    expect(step2.upgrades.mbt_lavi?.firepower).toBe(1);
  });

  it('round-trips an upgrade through storage', () => {
    const s = store();
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    saveAccount(s, buyUpgrade(funded, 'inf_squad', 'armour', 1, 300).account);
    const loaded = loadAccount(s);
    expect(loaded.upgrades.inf_squad?.armour).toBe(1);
    expect(loaded.balance).toBe(700);
  });

  it('resetAccount clears upgrades (existing behaviour)', () => {
    const s = store();
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    const upgraded = buyUpgrade(funded, 'inf_squad', 'armour', 1, 300).account;
    saveAccount(s, upgraded);
    expect(resetAccount(s).upgrades).toEqual({});
  });
});
