// E13 review F2 (GH-1415): the claim under the REAL constant flipped. `claim()` reads no `deps` switch, so the injected
// arms in `cosmetic-only.test.ts` cannot see what it passes. Here the economy's own `wallet` module is mocked with
// `COINS_COSMETIC_ONLY: true` and the rest of it real, so every default inside `@lions/economy` (`buyWithCoins`,
// `buyEnabled`, `coinsMayBuy`) and every reader of the constant in the Worker sees flip day. The claim must still carry
// a device's coin-bought unit and tier: it asks `buyWithCoins` with a literal `false` (claim.ts step 4). Drop that
// literal and the carry falls back to the default, and this file goes red (`notCarried: closed`).
//
// The mock is on `wallet`, not on `@lions/economy`: a mocked index would hand the Worker `true` while `stores.ts` kept
// its own binding to the real `false`, so the defaults would never move and the mutation above would survive.
import { COINS_COSMETIC_ONLY, coinsMayBuy, emptyAccount, parseWorld, worldMissionIds } from '@lions/economy';
import { world } from '@lions/data';
import { describe, expect, it, vi } from 'vitest';
import { handleAccount } from './routes';
import { accountHarness, seedWalletMember } from './test-kit';

vi.mock('../../../economy/src/wallet', async (importOriginal) => ({ ...(await importOriginal<object>()), COINS_COSMETIC_ONLY: true }));

const DAY = 86_400_000;
const T0 = 20_000 * DAY + 3_600_000;
const [M1 = '', M2 = ''] = worldMissionIds(parseWorld(world));
let seq = 1;
const op = (): string => `${String(seq++).padStart(8, '0')}-1414-4141-8141-141414141414`;

// No `coinsCosmeticOnly` in deps: the Worker reads the (mocked) constant, as it will on flip day.
const setup = () => accountHarness({ now: T0, handler: (req, env) => handleAccount(req, env, T0, { fetch: async () => new Response('no', { status: 500 }) }) });
type H = ReturnType<typeof setup>;
const entitlementsOf = async (h: H) => JSON.parse((await h.db.prepare('SELECT entitlements AS e FROM wallet').first<{ e: string }>())?.e ?? '{}') as unknown;

describe('the mock flips the constant the economy\'s defaults read', () => {
  it('reads true through @lions/economy, and the default coinsMayBuy refuses a unit', () => {
    expect(COINS_COSMETIC_ONLY).toBe(true);
    expect([coinsMayBuy('unit'), coinsMayBuy('tier'), coinsMayBuy('cosmetic')]).toEqual([false, false, true]);
  });
});

describe('POST claim with COINS_COSMETIC_ONLY true: a device\'s coin-bought items are carried', () => {
  it('carries the unit and the tier, charged against the claim\'s own coins; a new unit for coins is refused', async () => {
    const h = setup();
    const { cookie } = await seedWalletMember(h.db, 'm1', T0);
    // dozer_d9: unlock.price 560 credits = 60 coins. inf_squad armour tier 1: 115 credits = 15 coins.
    const wallet = {
      coins: { free: 300, paid: 0 },
      entitlements: { units: { dozer_d9: { free: true } }, upgrades: { inf_squad: { armour: { tier: 1, paidTiers: 0 } } } },
      receipts: [
        { kind: 'unit', id: 'r1', at: 1, coins: { free: 60, paid: 0 }, unitId: 'dozer_d9', credits: 560 },
        { kind: 'tier', id: 'r2', at: 2, coins: { free: 15, paid: 0 }, unitId: 'inf_squad', track: 'armour', tier: 1, credits: 115 },
      ],
    };
    const ledger = {
      'campaign.completed_missions': [M1, M2],
      'campaign.mission_results': { [M1]: { stars: 1, roe: 0, ticks: 0, lost: 0 }, [M2]: { stars: 2, roe: 0, ticks: 0, lost: 0 } },
    };
    const r = await h.call('POST', '/api/account/claim', {
      cookie,
      body: { op_id: op(), device_id: 'dddddddd-1414-4ddd-8ddd-dddddddddddd', campaign: { ledger, brigade: emptyAccount(), tutorialDone: false }, slots: [], wallet, coupons: [] },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { carried: unknown[]; notCarried: unknown[]; coins: number };
    expect(body.notCarried).toEqual([]);
    expect(body.carried).toEqual([{ item: 'unit', unitId: 'dozer_d9' }, { item: 'tier', unitId: 'inf_squad', track: 'armour', tier: 1 }]);
    // 135 earned for the two wins (as claim.test.ts), less 60 and 15 carried.
    expect(body.coins).toBe(135 - 60 - 15);
    expect(await entitlementsOf(h)).toEqual({ units: { dozer_d9: { free: true } }, upgrades: { inf_squad: { armour: { tier: 1, paidTiers: 0 } } } });
    // The same constant is what makes POST spend refuse a NEW unit for coins.
    const spend = await h.call('POST', '/api/account/spend', { cookie, body: { op_id: op(), item: 'unit', unitId: 'breach_team' } });
    expect(spend.status).toBe(409);
    expect(await spend.json()).toMatchObject({ reason: 'cosmetic_only' });
  });
});
