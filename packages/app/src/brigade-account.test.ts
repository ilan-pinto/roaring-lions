import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_KEY,
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

  it('drops a granted entry it did not write, and no client path writes one', () => {
    // The paid path's shape (spec §4.6) is data this module carries but never creates:
    // a save that contains one was edited by hand, and the balance it implies is not
    // honoured.
    const raw = { ...emptyAccount(), balance: 900, grants: [{ source: 'granted', amount: 900, at: 1 }] };
    const migrated = migrateAccount(raw);
    expect(migrated.grants).toEqual([]);
    expect(migrated.balance).toBe(0);
    const paid = payMission(emptyAccount(), 'm1', 10, 1).account;
    expect(paid.grants.every((g) => g.source === 'earned')).toBe(true);
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
});
