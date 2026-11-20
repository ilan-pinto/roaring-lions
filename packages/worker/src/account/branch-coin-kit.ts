/**
 * The shared harness of `branch-coin.test.ts` (the branch switch flipped open) and `branch-coin-closed.test.ts` (as shipped), so
 * both read one fixture: a member holding coins, a Lavi bought on coins to firepower tier 2, and the two ways onto the branched
 * tier 3 (the spend route, and a claim carrying a device wallet).
 */
import { handleAccount } from './routes';
import { accountHarness, seedWalletMember, testCouponTable, TEST_COUPON_COIN_ID } from './test-kit';

export const DAY = 86_400_000;
export const T0 = 20_000 * DAY + 3_600_000;
export const CODE = 'TEST-CODE';
export const COIN_ID = TEST_COUPON_COIN_ID;
let seq = 1;
export const op = (): string => `${String(seq++).padStart(8, '0')}-8888-4888-8888-888888888888`;
export const dev = (n: number): string => `dddddddd-${String(n).padStart(4, '0')}-4ddd-8ddd-dddddddddddd`;

export function setup() {
  return accountHarness({
    now: T0,
    handler: (req, env, at) => handleAccount(req, env, at, { fetch: async () => new Response('no', { status: 500 }), coupons: testCouponTable(CODE) }),
  });
}
export type H = ReturnType<typeof setup>;

export const member = async (h: H, free = 5000): Promise<string> => (await seedWalletMember(h.db, 'm1', T0, { free })).cookie;
export const spend = (h: H, cookie: string, body: object) => h.call('POST', '/api/account/spend', { cookie, body: { op_id: op(), ...body } });
export const tier = (unitId: string, track: string, n: number, extra: object = {}) => ({ item: 'tier', unitId, track, tier: n, ...extra });

/** The Lavi bought on coins up to firepower tier 2: the next tier is the branched one. */
export async function lavi(h: H, cookie: string): Promise<void> {
  for (const body of [{ item: 'unit', unitId: 'mbt_lavi' }, tier('mbt_lavi', 'firepower', 1), tier('mbt_lavi', 'firepower', 2)]) {
    const r = await spend(h, cookie, body);
    if (r.status !== 200) throw new Error(`fixture: ${JSON.stringify(body)} answered ${r.status} ${await r.text()}`);
  }
}

export const claimBody = (wallet: unknown, n = 1) => ({ op_id: op(), device_id: dev(n), campaign: null, slots: [], wallet, coupons: [COIN_ID] });
export const claim = (h: H, cookie: string, wallet: unknown, n = 1) => h.call('POST', '/api/account/claim', { cookie, body: claimBody(wallet, n) });
/** A device wallet holding the Lavi at firepower tier 3 (with the entitlement's own `branch` when given). */
export const deviceLavi = (branch?: 1 | 2) => ({
  coins: { free: 1_000_000, paid: 0 },
  entitlements: { units: { mbt_lavi: { free: true } }, upgrades: { mbt_lavi: { firepower: { tier: 3, paidTiers: 0, ...(branch !== undefined ? { branch } : {}) } } } },
});

export const rows = async (h: H) =>
  (await h.db.prepare('SELECT kind, free_delta AS d, detail FROM coin_journal ORDER BY id').all<{ kind: string; d: number; detail: string }>()).results.map((r) => ({ kind: r.kind, d: r.d, detail: JSON.parse(r.detail) as Record<string, unknown> }));
export const walletEntitlements = async (h: H): Promise<{ upgrades: Record<string, Record<string, Record<string, unknown>>> }> =>
  JSON.parse(((await h.db.prepare('SELECT entitlements AS e FROM wallet').first<{ e: string }>()) as { e: string }).e) as { upgrades: Record<string, Record<string, Record<string, unknown>>> };
export const free = async (h: H) => ((await h.db.prepare('SELECT free FROM wallet').first<{ free: number }>()) as { free: number }).free;
export const sum = async (h: H) => ((await h.db.prepare('SELECT COALESCE(SUM(free_delta), 0) AS s FROM coin_journal').first<{ s: number }>()) as { s: number }).s;
