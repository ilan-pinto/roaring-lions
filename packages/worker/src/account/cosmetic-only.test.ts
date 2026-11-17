// E13 (GH-1415): the Worker's half of "coins buy cosmetics only". The switch is injected through `deps`, so both arms run
// on one database: today's spend, the flipped refusal (`cosmetic_only`), what coins bought before the flip kept, and a
// claim that still carries a device's coin-bought items. Prices are literals read off the unit JSON.
import { COINS_COSMETIC_ONLY, emptyAccount, parseWorld, worldMissionIds } from '@lions/economy';
import { world } from '@lions/data';
import { describe, expect, it } from 'vitest';
import { handleAccount } from './routes';
import { accountHarness, seedWalletMember } from './test-kit';

const DAY = 86_400_000;
const T0 = 20_000 * DAY + 3_600_000;
const [M1 = '', M2 = ''] = worldMissionIds(parseWorld(world));
let seq = 1;
const op = (): string => `${String(seq++).padStart(8, '0')}-1313-4131-8131-131313131313`;

/** `flag.on` is read per request, so a test can flip the switch between two calls on the same member. */
function setup(flag: { on: boolean | undefined }) {
  return accountHarness({
    now: T0,
    handler: (req, env) =>
      handleAccount(req, env, T0, { fetch: async () => new Response('no', { status: 500 }), ...(flag.on === undefined ? {} : { coinsCosmeticOnly: flag.on }) }),
  });
}
type H = ReturnType<typeof setup>;

const spend = (h: H, cookie: string, body: object) => h.call('POST', '/api/account/spend', { cookie, body: { op_id: op(), ...body } });
const freeOf = async (h: H) => (await h.db.prepare('SELECT free FROM wallet').first<{ free: number }>())?.free;
const entitlementsOf = async (h: H) => JSON.parse((await h.db.prepare('SELECT entitlements AS e FROM wallet').first<{ e: string }>())?.e ?? '{}') as unknown;
const kinds = async (h: H) => (await h.db.prepare('SELECT kind FROM coin_journal ORDER BY id').all<{ kind: string }>()).results.map((r) => r.kind);

// dozer_d9: unlock.price 560 credits = 60 coins. inf_squad armour tier 1: 115 credits = 15 coins.
const UNIT = { item: 'unit', unitId: 'dozer_d9' };
const TIER = { item: 'tier', unitId: 'inf_squad', track: 'armour', tier: 1 };

describe('POST spend, switch OFF: today', () => {
  it('sells a unit and a tier for coins', async () => {
    const h = setup({ on: false });
    const { cookie } = await seedWalletMember(h.db, 'm1', T0, { free: 1000 });
    expect((await spend(h, cookie, UNIT)).status).toBe(200);
    expect((await spend(h, cookie, TIER)).status).toBe(200);
    expect(await freeOf(h)).toBe(1000 - 60 - 15);
    expect(await kinds(h)).toEqual(['claim', 'unit', 'tier']);
  });
});

describe('POST spend, no switch in deps: the Worker reads COINS_COSMETIC_ONLY', () => {
  it('answers a unit and a tier ask as the constant\'s arm does', async () => {
    const h = setup({ on: undefined });
    const { cookie } = await seedWalletMember(h.db, 'm1', T0, { free: 1000 });
    const want = COINS_COSMETIC_ONLY ? 409 : 200;
    expect((await spend(h, cookie, UNIT)).status).toBe(want);
    expect((await spend(h, cookie, TIER)).status).toBe(want);
    expect(await freeOf(h)).toBe(COINS_COSMETIC_ONLY ? 1000 : 1000 - 60 - 15);
    expect(await kinds(h)).toEqual(COINS_COSMETIC_ONLY ? ['claim'] : ['claim', 'unit', 'tier']);
  });
});

describe('POST spend, switch ON: coins buy cosmetics only', () => {
  it('refuses a unit ask and a tier ask with the stable reason `cosmetic_only`, writing nothing', async () => {
    const h = setup({ on: true });
    const { cookie } = await seedWalletMember(h.db, 'm1', T0, { free: 1000 });
    for (const ask of [UNIT, TIER]) {
      const r = await spend(h, cookie, ask);
      expect(r.status).toBe(409);
      expect(await r.json()).toMatchObject({ error: 'refused', reason: 'cosmetic_only', wallet: { free: 1000 } });
    }
    expect(await freeOf(h)).toBe(1000);
    expect(await kinds(h)).toEqual(['claim']);
    expect(await entitlementsOf(h)).toEqual({ units: {}, upgrades: {} });
  });

  it('refuses even a wallet too short to pay: the reason is the switch, not the coins', async () => {
    const h = setup({ on: true });
    const { cookie } = await seedWalletMember(h.db, 'm1', T0, { free: 0 });
    expect(await (await spend(h, cookie, UNIT)).json()).toMatchObject({ reason: 'cosmetic_only' });
  });

  it('KEEPS what coins bought before the flip, and the next tier is refused', async () => {
    const flag = { on: false as boolean | undefined };
    const h = setup(flag);
    const { cookie } = await seedWalletMember(h.db, 'm1', T0, { free: 1000 });
    expect((await spend(h, cookie, UNIT)).status).toBe(200);
    expect((await spend(h, cookie, TIER)).status).toBe(200);
    flag.on = true;
    const r = await spend(h, cookie, { ...TIER, tier: 2 });
    expect(await r.json()).toMatchObject({ reason: 'cosmetic_only' });
    expect(await entitlementsOf(h)).toEqual({ units: { dozer_d9: { free: true } }, upgrades: { inf_squad: { armour: { tier: 1, paidTiers: 0 } } } });
    const state = (await (await h.call('GET', '/api/account/state', { cookie })).json()) as { wallet: { free: number; entitlements: unknown } };
    expect(state.wallet.free).toBe(1000 - 60 - 15);
    expect(state.wallet.entitlements).toEqual({ units: { dozer_d9: { free: true } }, upgrades: { inf_squad: { armour: { tier: 1, paidTiers: 0 } } } });
  });
});

describe('POST claim, switch ON: a device\'s coin-bought items are carried, never revoked', () => {
  it('carries the unit and the tier the device bought, charged against the claim\'s own coins as before', async () => {
    for (const on of [true, false]) {
      const h = setup({ on });
      const { cookie } = await seedWalletMember(h.db, 'm1', T0);
      const receipt = { kind: 'unit', id: 'r1', at: 1, coins: { free: 60, paid: 0 }, unitId: 'dozer_d9', credits: 560 };
      const tierReceipt = { kind: 'tier', id: 'r2', at: 2, coins: { free: 15, paid: 0 }, unitId: 'inf_squad', track: 'armour', tier: 1, credits: 115 };
      const wallet = {
        coins: { free: 300, paid: 0 },
        entitlements: { units: { dozer_d9: { free: true } }, upgrades: { inf_squad: { armour: { tier: 1, paidTiers: 0 } } } },
        receipts: [receipt, tierReceipt],
      };
      const ledger = {
        'campaign.completed_missions': [M1, M2],
        'campaign.mission_results': { [M1]: { stars: 1, roe: 0, ticks: 0, lost: 0 }, [M2]: { stars: 2, roe: 0, ticks: 0, lost: 0 } },
      };
      const r = await h.call('POST', '/api/account/claim', {
        cookie,
        body: { op_id: op(), device_id: 'dddddddd-1313-4ddd-8ddd-dddddddddddd', campaign: { ledger, brigade: emptyAccount(), tutorialDone: false }, slots: [], wallet, coupons: [] },
      });
      expect(r.status, `on=${on}`).toBe(200);
      const body = (await r.json()) as { carried: unknown[]; notCarried: unknown[]; coins: number };
      expect(body.carried, `on=${on}`).toEqual([{ item: 'unit', unitId: 'dozer_d9' }, { item: 'tier', unitId: 'inf_squad', track: 'armour', tier: 1 }]);
      expect(body.notCarried).toEqual([]);
      // 135 earned (the same two wins as claim.test.ts), less 60 and 15 carried.
      expect(body.coins).toBe(135 - 60 - 15);
      expect(await entitlementsOf(h)).toEqual({ units: { dozer_d9: { free: true } }, upgrades: { inf_squad: { armour: { tier: 1, paidTiers: 0 } } } });
      // Once claimed, the switch still refuses a NEW unit for coins.
      if (on) expect(await (await spend(h, cookie, { item: 'unit', unitId: 'breach_team' })).json()).toMatchObject({ reason: 'cosmetic_only' });
    }
  });
});
