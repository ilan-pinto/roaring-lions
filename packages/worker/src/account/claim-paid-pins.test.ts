/**
 * GH-1385 C1 follow-up: pins two claim.ts lines no shipped data can reach. Every shipped coin amount is a multiple of 5
 * (`COIN_STEP`), so a claim's own coins never fall ONE short of a carried price, and the shipped coupon table has no
 * coin coupon under `CLAIM_COUPON_COINS_CAP`. An injected coupon of 59 coins against `dozer_d9` (560 credits, 60
 * coins) reaches both:
 *   - the scratch wallet's `paid: 0` (claim.ts, step 4): a phantom paid coin would make 59 free coins spend as 60,
 *     carrying the dozer as `{ paid: true }` with a unit receipt of `paid: 1`;
 *   - the coupon row's `capped: credited < grant` (claim.ts, step 3): at equality (59 credited of 59) it is false.
 * Expected values are literals, never recomputed from the code under test.
 */
import { sha256Hex } from '@lions/economy';
import { describe, expect, it } from 'vitest';
import { handleAccount } from './routes';
import { accountHarness, seedWalletMember } from './test-kit';

const T0 = 20_000 * 86_400_000 + 3_600_000;
const CODE = 'PIN-CODE';
const SHORT = 'pin_coins_59';
const EXACT = 'pin_coins_60';
const TABLE = [
  { id: SHORT, sha256: sha256Hex(CODE), coins: 59 },
  { id: EXACT, sha256: sha256Hex(CODE), coins: 60 },
];
/** The device holds the dozer and has a balance far above anything here, so its ceiling never cuts. */
const DEVICE = { coins: { free: 1_000_000, paid: 0 }, entitlements: { units: { dozer_d9: { free: true } }, upgrades: {} } };
const OP = (n: number): string => `${String(n).padStart(8, '0')}-5959-4595-8595-595959595959`;
const DEV = 'dddddddd-0059-4ddd-8ddd-dddddddddddd';

interface Receipt { kind: string; coins: { free: number; paid: number }; source?: string; unitId?: string }
interface Result {
  coins: number; earned: number; coupons: { id: string; credited: number; capped: boolean }[]; carried: unknown[]; notCarried: unknown[];
  state: { wallet: { free: number; paid: number; entitlements: unknown; receipts: Receipt[] } };
}

async function claimWith(coupon: string, n: number) {
  const h = accountHarness({ now: T0, handler: (req, env, at) => handleAccount(req, env, at, { fetch: async () => new Response('no', { status: 500 }), coupons: TABLE }) });
  const { cookie } = await seedWalletMember(h.db, 'm1', T0);
  const res = await h.call('POST', '/api/account/claim', { cookie, body: { op_id: OP(n), device_id: DEV, campaign: null, slots: [], wallet: DEVICE, coupons: [coupon] } });
  expect(res.status).toBe(200);
  const r = (await res.json()) as Result;
  const wallet = await h.db.prepare('SELECT free, paid, entitlements FROM wallet').first<{ free: number; paid: number; entitlements: string }>();
  const journal = (await h.db.prepare('SELECT kind, free_delta AS d, paid_delta AS p, detail FROM coin_journal ORDER BY id').all<{ kind: string; d: number; p: number; detail: string }>()).results;
  return { r, wallet, journal };
}

/** Every receipt the answer and the journal carry, with its paid coins: none may be other than 0. */
const paidOfReceipts = (r: Result, journal: { detail: string }[]): number[] => [
  ...r.state.wallet.receipts.map((x) => x.coins.paid),
  ...journal.map((j) => (JSON.parse(j.detail) as { receipt?: { coins?: { paid?: number } } }).receipt?.coins?.paid).filter((p): p is number => p !== undefined),
];

describe('POST claim: one coin short of a carried price (GH-1385 C1 follow-up)', () => {
  it('59 coupon coins do not carry the 60-coin dozer: refused for coins, no paid entitlement, no paid receipt', async () => {
    const { r, wallet, journal } = await claimWith(SHORT, 1);
    // claim.ts step 3: 59 credited of a 59 grant is not capped.
    expect(r.coupons).toEqual([{ id: SHORT, credited: 59, capped: false }]);
    // claim.ts step 4: the scratch wallet holds 59 free and 0 paid, so the dozer is refused for coins.
    expect(r.carried).toEqual([]);
    expect(r.notCarried).toEqual([{ ask: { item: 'unit', unitId: 'dozer_d9' }, reason: 'coins' }]);
    expect([r.coins, r.earned]).toEqual([59, 0]);
    expect(r.state.wallet.entitlements).toEqual({ units: {}, upgrades: {} });
    expect([r.state.wallet.free, r.state.wallet.paid]).toEqual([59, 0]);
    expect(r.state.wallet.receipts.map((x) => [x.kind, x.coins, x.source ?? null])).toEqual([['earn', { free: 59, paid: 0 }, 'backfill']]);
    // The stored row and the journal agree: no entitlement is paid, no receipt names a paid coin.
    expect(wallet).not.toBeNull();
    expect([wallet?.free, wallet?.paid]).toEqual([59, 0]);
    expect(JSON.parse(wallet?.entitlements ?? 'null')).toEqual({ units: {}, upgrades: {} });
    expect(wallet?.entitlements).not.toContain('"paid":true');
    expect(journal.map((j) => [j.kind, j.d, j.p])).toEqual([['backfill', 59, 0]]);
    expect(paidOfReceipts(r, journal)).toEqual([0, 0]);
  });

  it('60 coupon coins carry it exactly: a free entitlement, and every receipt paid 0 (the control)', async () => {
    const { r, wallet, journal } = await claimWith(EXACT, 2);
    expect(r.coupons).toEqual([{ id: EXACT, credited: 60, capped: false }]);
    expect(r.carried).toEqual([{ item: 'unit', unitId: 'dozer_d9' }]);
    expect(r.notCarried).toEqual([]);
    expect([r.coins, r.earned]).toEqual([0, 0]);
    expect(r.state.wallet.entitlements).toEqual({ units: { dozer_d9: { free: true } }, upgrades: {} });
    expect([r.state.wallet.free, r.state.wallet.paid]).toEqual([0, 0]);
    expect(r.state.wallet.receipts.map((x) => [x.kind, x.coins, x.source ?? x.unitId ?? null])).toEqual([
      ['earn', { free: 60, paid: 0 }, 'backfill'],
      ['unit', { free: 60, paid: 0 }, 'dozer_d9'],
    ]);
    expect([wallet?.free, wallet?.paid]).toEqual([0, 0]);
    expect(JSON.parse(wallet?.entitlements ?? 'null')).toEqual({ units: { dozer_d9: { free: true } }, upgrades: {} });
    expect(wallet?.entitlements).not.toContain('"paid":true');
    expect(journal.map((j) => [j.kind, j.d, j.p])).toEqual([['backfill', 60, 0], ['unit', -60, 0]]);
    expect(paidOfReceipts(r, journal)).toEqual([0, 0, 0, 0]);
  });
});
