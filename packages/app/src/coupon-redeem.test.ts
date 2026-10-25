import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_KEY, emptyAccount, loadAccount, saveAccount, type Coupon, type StorageLike } from './brigade-account';
import { redeemOnStore } from './coupon-redeem';
import { ROAR_TEST_KEY, MAX_TEST_COINS, loadRoarTest, saveRoarTest, emptyRoarTest } from './roar-test';
import type { LedgerStore } from './ledger-store';

// Test-only codes with their own hashes. The lead's code is not in the repo.
const hashOf = (s: string): string => createHash('sha256').update(s).digest('hex');
const TABLE: Coupon[] = [
  { id: 'fx_credits', sha256: hashOf('Fixture-Both'), credits: 10000 },
  { id: 'fx_coins', sha256: hashOf('Fixture-Both'), coins: 100000 },
  { id: 'fx_solo', sha256: hashOf('Fixture-Solo'), coins: 50 },
];

/** A LedgerStore's account and wallet halves over one map, like the real one. `failOn` makes
 *  the next write to that key throw, as a full or blocked store does. */
function rig(): { store: Pick<LedgerStore, 'readAccount' | 'writeAccount' | 'readRoarTest' | 'writeRoarTest'>; box: Map<string, string>; failOn: Set<string> } {
  const box = new Map<string, string>();
  const failOn = new Set<string>();
  const storage: StorageLike = {
    getItem: (k) => box.get(k) ?? null,
    setItem: (k, v) => {
      if (failOn.has(k)) throw new Error('quota');
      box.set(k, v);
    },
    removeItem: (k) => void box.delete(k),
  };
  return {
    box,
    failOn,
    store: {
      readAccount: () => loadAccount(storage),
      writeAccount: (a) => saveAccount(storage, a),
      readRoarTest: () => loadRoarTest(storage),
      writeRoarTest: (a) => saveRoarTest(storage, a),
    },
  };
}

const go = (r: ReturnType<typeof rig>, code: string) => redeemOnStore(r.store, code, TABLE, (t) => hashOf(t), 100);

describe('redeeming a coupon against the account and the TEST wallet', () => {
  it('a first-time redeemer gets the credits in the account and the coins in the wallet', () => {
    const r = rig();
    expect(go(r, 'Fixture-Both')).toEqual({ result: 'ok', credits: 10000, coins: 100000 });
    expect(r.store.readAccount().balance).toBe(10000);
    expect(r.store.readAccount().coupons).toEqual(['fx_credits', 'fx_coins']);
    expect(r.store.readRoarTest().coins).toBe(100000);
    // coins never became credits, credits never became coins
    expect(r.store.readAccount().earned_total).toBe(0);
  });

  it('an earlier redeemer (credits entry only) gets the coins only, and nothing twice', () => {
    const r = rig();
    r.store.writeAccount({ ...emptyAccount(), balance: 10000, coupons: ['fx_credits'], grants: [{ source: 'granted', amount: 10000, couponId: 'fx_credits', at: 1 }] });
    expect(go(r, 'Fixture-Both')).toEqual({ result: 'ok', credits: 0, coins: 100000 });
    expect(r.store.readAccount().balance).toBe(10000);
    expect(r.store.readRoarTest().coins).toBe(100000);
    expect(go(r, 'Fixture-Both')).toEqual({ result: 'used' });
    expect(r.store.readRoarTest().coins).toBe(100000);
    expect(r.store.readAccount().balance).toBe(10000);
  });

  it('an unknown code writes nothing', () => {
    const r = rig();
    expect(go(r, 'nope')).toEqual({ result: 'unknown' });
    expect(r.box.size).toBe(0);
  });

  it('a coins-only entry leaves the credit balance alone', () => {
    const r = rig();
    expect(go(r, 'Fixture-Solo')).toEqual({ result: 'ok', credits: 0, coins: 50 });
    expect(r.store.readAccount().balance).toBe(0);
    expect(r.store.readRoarTest().coins).toBe(50);
  });

  it('a failed wallet write undoes the account write, so the code is not spent for nothing', () => {
    const r = rig();
    r.failOn.add(ROAR_TEST_KEY);
    expect(go(r, 'Fixture-Both')).toEqual({ result: 'failed' });
    expect(r.store.readAccount()).toEqual(emptyAccount());
    r.failOn.clear();
    expect(go(r, 'Fixture-Both')).toMatchObject({ result: 'ok', coins: 100000 });
  });

  it('a failed account write grants no coins', () => {
    const r = rig();
    r.failOn.add(ACCOUNT_KEY);
    expect(go(r, 'Fixture-Both')).toEqual({ result: 'failed' });
    expect(r.store.readRoarTest().coins).toBe(0);
  });

  it('a wallet already near the cap takes what fits', () => {
    const r = rig();
    r.store.writeRoarTest({ ...emptyRoarTest(), coins: MAX_TEST_COINS - 10 });
    go(r, 'Fixture-Solo');
    expect(r.store.readRoarTest().coins).toBe(MAX_TEST_COINS);
  });
});
