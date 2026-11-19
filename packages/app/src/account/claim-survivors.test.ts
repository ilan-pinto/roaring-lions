import { describe, expect, it } from 'vitest';
import { emptyAccount, emptyRoar } from '@lions/economy';
import type { StorageLike } from '../brigade-account';
import { ACCOUNT_KEY } from '../brigade-account';
import { memoryLedgerStore } from '../ledger-store';
import { LEDGER_KEY, TUTORIAL_DONE_KEY } from '../main-keys';
import { SAVES_KEY } from '../profile';
import { ROAR_KEY } from '../roar-wallet';
import { ACCOUNT_BINDING_KEY, CLAIMING_KEY, readBinding } from './binding';
import { ACCOUNT_CACHE_KEY } from './cache';
import type { AccountClient, CallResult } from './client';
import {
  CLAIM_BODY_MAX,
  CLAIM_COUPONS_MAX,
  CLAIM_SLOTS_MAX,
  buildClaim,
  claimQuietly,
  dropOrphanClaiming,
  finishInterruptedClaim,
  hasGuestProgress,
  runClaim,
} from './claim';
import { cacheOf, confirmedState, memStorage, slotOf, unusedA2Client } from './fixtures';
import { provisionalLine } from './spend-flow';

// GH-1385 F8: the money-moving half of the claim code that the existing specs ran through but never read: the caps it
// sends under, what counts as guest progress, which coupons and which wallet go up, and the rules that decide whether a
// leftover marker is an orphan. Every expected value is a literal.

const CTX = { publicId: 'pub1', at: 9 };
const DEV = 'dddddddd-0001-4ddd-8ddd-dddddddddddd';

describe('the numbers a claim is built under', () => {
  it('are the Worker\'s: 32 slots, 16 coupon ids, one mebibyte', () => {
    expect(CLAIM_SLOTS_MAX).toBe(32);
    expect(CLAIM_COUPONS_MAX).toBe(16);
    expect(CLAIM_BODY_MAX).toBe(1_048_576);
  });
});

describe('what counts as guest progress and as a campaign to send', () => {
  const keys: [string, string][] = [
    [LEDGER_KEY, '{}'],
    [ACCOUNT_KEY, JSON.stringify(emptyAccount())],
    [TUTORIAL_DONE_KEY, '1'],
  ];

  it('an empty device holds none, and sends no campaign', () => {
    const g = memoryLedgerStore();
    expect(hasGuestProgress(g)).toBe(false);
    expect(buildClaim(g, DEV, CTX).body.campaign).toBeNull();
  });

  it('each campaign key alone is progress and makes a campaign', () => {
    for (const [k, v] of keys) {
      const g = memoryLedgerStore({ [k]: v });
      expect(hasGuestProgress(g)).toBe(true);
      expect(buildClaim(g, DEV, CTX).body.campaign).not.toBeNull();
    }
  });

  it('save slots alone are progress but not a campaign', () => {
    const g = memoryLedgerStore({ [SAVES_KEY]: '{}' });
    expect(hasGuestProgress(g)).toBe(true);
    expect(buildClaim(g, DEV, CTX).body.campaign).toBeNull();
  });
});

describe('the wallet and the coupons a claim sends', () => {
  const wallet = (receipts: unknown[]) => JSON.stringify({ ...emptyRoar(), receipts });

  it('sends the stored wallet as it is, and the empty wallet when none or an unreadable one is stored', () => {
    expect(buildClaim(memoryLedgerStore({ [ROAR_KEY]: '{"note":"w"}' }), DEV, CTX).body.wallet).toEqual({ note: 'w' });
    expect(buildClaim(memoryLedgerStore(), DEV, CTX).body.wallet).toEqual(emptyRoar());
    expect(buildClaim(memoryLedgerStore({ [ROAR_KEY]: '{not json' }), DEV, CTX).body.wallet).toEqual(emptyRoar());
  });

  it('collects the account\'s redeemed coupons and the coupon receipts\' ids, once each, strings only', () => {
    const g = memoryLedgerStore({
      [ACCOUNT_KEY]: JSON.stringify({ ...emptyAccount(), coupons: ['a', 'b'] }),
      [ROAR_KEY]: wallet([
        { kind: 'coupon', id: 'r1', at: 1, coins: { free: 5, paid: 0 }, couponIds: ['b', 'c', 7, null] },
        { kind: 'unit', id: 'r2', at: 2, coins: { free: 5, paid: 0 }, unitId: 'x', credits: 1, couponIds: ['not-a-coupon'] },
        null,
        { kind: 'coupon', id: 'r3', at: 3, coins: { free: 0, paid: 0 }, couponIds: 'nope' },
      ]),
    });
    expect(buildClaim(g, DEV, CTX).body.coupons).toEqual(['a', 'b', 'c']);
  });

  it('sends the first 16 coupon ids and no more', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `c${i}`);
    const g = memoryLedgerStore({ [ACCOUNT_KEY]: JSON.stringify({ ...emptyAccount(), coupons: ids }) });
    expect(buildClaim(g, DEV, CTX).body.coupons).toEqual(ids.slice(0, 16));
  });
});

describe('the body size bound', () => {
  /** One slot, its name padded by `pad` characters. */
  const one = (pad: number) => {
    const slot = { ...slotOf('s1', 'x'.repeat(pad), 1), build: 'b' };
    return buildClaim(memoryLedgerStore({ [SAVES_KEY]: JSON.stringify({ s1: slot }) }), DEV, CTX);
  };
  const bytes = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;

  it('packs a slot up to the byte, never over the Worker\'s limit, and moves the next one out for size', () => {
    let lo = 0;
    let hi = CLAIM_BODY_MAX;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (one(mid).body.slots.length === 1) lo = mid;
      else hi = mid - 1;
    }
    const fits = one(lo);
    const over = one(lo + 1);
    expect(fits.body.slots).toHaveLength(1);
    expect(over.body.slots).toHaveLength(0);
    expect(over.damaged.map((d) => d.reason)).toEqual(['size']);
    // The accepted body is under the limit, and by no more than one byte. A single slot puts no separator into `slots`, so the
    // estimate's `+ 1` is a spare byte here: this test pins `- 1` and `+ 2` but cannot see the `+ 1` removed (the estimate is
    // then exact for one slot). The two-slot test below is what pins the separator byte.
    const real = bytes(fits.body);
    expect(real).toBeLessThanOrEqual(CLAIM_BODY_MAX);
    expect(CLAIM_BODY_MAX - real).toBeLessThanOrEqual(1);
  });

  /** Two slots: `s1`, newer and so packed first, with a fixed short name; `s2`, older, its name padded by `pad` characters. */
  const two = (pad: number) => {
    const s1 = { ...slotOf('s1', 'first', 2), build: 'b' };
    const s2 = { ...slotOf('s2', 'x'.repeat(pad), 1), build: 'b' };
    return buildClaim(memoryLedgerStore({ [SAVES_KEY]: JSON.stringify({ s1, s2 }) }), DEV, CTX);
  };

  it('packs a second slot up to the byte, counting the separator between them: never over the Worker\'s limit', () => {
    let lo = 0;
    let hi = CLAIM_BODY_MAX;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (two(mid).body.slots.length === 2) lo = mid;
      else hi = mid - 1;
    }
    const fits = two(lo);
    const over = two(lo + 1);
    expect(fits.body.slots.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(over.body.slots.map((s) => s.id)).toEqual(['s1']);
    expect(over.damaged.map((d) => [d.id, d.reason])).toEqual([['claim:slot:s2', 'size']]);
    // Two slots put one comma into `slots`. An estimate without the per-slot `+ 1` packs this body one byte OVER the limit; with
    // it the body is one byte under (the first slot's `+ 1` is spare), so the range is exactly [MAX - 1, MAX].
    const real = bytes(fits.body);
    expect(real).toBeLessThanOrEqual(CLAIM_BODY_MAX);
    expect(CLAIM_BODY_MAX - real).toBeLessThanOrEqual(1);
  });
});

describe('a leftover claim marker', () => {
  const binding = (extra: object = {}) => JSON.stringify({ version: 1, publicId: 'pub1', ...extra });
  const marker = (deviceId: string) => JSON.stringify({ deviceId, digests: { campaign: null, slots: {} }, at: 1 });

  it('nothing stored: not an orphan, nothing removed', () => {
    const s = memStorage();
    expect(dropOrphanClaiming(s)).toBe(false);
    expect(s.map.size).toBe(0);
  });

  it('an unreadable marker is dropped; a storage that throws on read drops nothing and says so', () => {
    const s = memStorage();
    s.map.set(CLAIMING_KEY, '{broken');
    expect(dropOrphanClaiming(s)).toBe(true);
    expect(s.map.has(CLAIMING_KEY)).toBe(false);
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(dropOrphanClaiming(throwing)).toBe(false);
  });

  it('a marker with no binding, or another device\'s, is dropped; this device\'s own stays', () => {
    const none = memStorage();
    none.map.set(CLAIMING_KEY, marker(DEV));
    expect(dropOrphanClaiming(none)).toBe(true);
    expect(none.map.has(CLAIMING_KEY)).toBe(false);

    const other = memStorage();
    other.map.set(ACCOUNT_BINDING_KEY, binding({ deviceId: 'eeeeeeee-0001-4eee-8eee-eeeeeeeeeeee' }));
    other.map.set(CLAIMING_KEY, marker(DEV));
    expect(dropOrphanClaiming(other)).toBe(true);

    const own = memStorage();
    own.map.set(ACCOUNT_BINDING_KEY, binding({ deviceId: DEV }));
    own.map.set(CLAIMING_KEY, marker(DEV));
    expect(dropOrphanClaiming(own)).toBe(false);
    expect(own.map.has(CLAIMING_KEY)).toBe(true);
  });

  it('an interrupted claim: no binding, or a binding never claimed, removes nothing', () => {
    const none = memStorage();
    none.map.set(LEDGER_KEY, '{}');
    expect(finishInterruptedClaim(none)).toBe(false);
    expect(none.map.has(LEDGER_KEY)).toBe(true);

    const unclaimed = memStorage();
    unclaimed.map.set(ACCOUNT_BINDING_KEY, binding({ deviceId: DEV }));
    unclaimed.map.set(ACCOUNT_CACHE_KEY, JSON.stringify(cacheOf(confirmedState())));
    unclaimed.map.set(CLAIMING_KEY, marker(DEV));
    unclaimed.map.set(LEDGER_KEY, '{}');
    expect(finishInterruptedClaim(unclaimed)).toBe(false);
    expect(unclaimed.map.has(LEDGER_KEY)).toBe(true);
  });

  it('an interrupted claim whose keys cannot be removed says false', () => {
    const s = memStorage();
    s.map.set(ACCOUNT_BINDING_KEY, binding({ deviceId: DEV, claimedAt: 5 }));
    s.map.set(ACCOUNT_CACHE_KEY, JSON.stringify(cacheOf(confirmedState())));
    s.map.set(CLAIMING_KEY, marker(DEV));
    expect(readBinding(s)?.claimedAt).toBe(5);
    const stuck: StorageLike = {
      getItem: (k) => s.getItem(k),
      setItem: (k, v) => s.setItem(k, v),
      removeItem: () => {
        throw new Error('refused');
      },
    };
    expect(finishInterruptedClaim(stuck)).toBe(false);
  });
});

describe('the quiet claim and the retry rule', () => {
  const client = (state: CallResult<unknown>): AccountClient => ({ ...unusedA2Client, state: async () => state }) as unknown as AccountClient;

  it('a binding that cannot be written to is not claimed quietly', async () => {
    const none = memStorage(); // no binding: setClaimedAt refuses
    expect(await claimQuietly(client({ ok: true, status: 200, body: confirmedState() }), none)).toBe(false);
  });

  it('a 500 answer keeps the marker and is a retry; a 400 is kept and clears it', async () => {
    for (const [status, outcome, marked] of [[500, 'retry', true], [429, 'retry', true], [0, 'retry', true], [400, 'kept', false]] as const) {
      const storage = memStorage();
      storage.map.set(ACCOUNT_BINDING_KEY, JSON.stringify({ version: 1, publicId: 'pub1', deviceId: DEV }));
      const guest = memoryLedgerStore({ [LEDGER_KEY]: '{}' });
      const c = { ...unusedA2Client, claim: async () => ({ ok: false, status, error: 'x' }) } as unknown as AccountClient;
      expect(await runClaim({ client: c, guest, storage })).toBe(outcome);
      expect(storage.map.has(CLAIMING_KEY)).toBe(marked);
    }
  });
});

describe('the debrief coin line', () => {
  it('is promised only when the mission start left a nonce', () => {
    expect(provisionalLine(null, 40, 100)).toBeNull();
    expect(provisionalLine('nonce', 40, 100)).toEqual({ coins: 40, balance: 100, phase: 'provisional' });
  });
});
