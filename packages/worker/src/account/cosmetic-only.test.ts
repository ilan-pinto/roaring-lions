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

// F5 (the lead's ruling on PR 1565): POST reset-free with the switch on keeps every coin-bought unit and tier; off, it
// clears the free half exactly as today.
describe('POST reset-free and the switch', () => {
  async function boughtThenReset(on: boolean | undefined) {
    const flag = { on: false as boolean | undefined };
    const h = setup(flag);
    const { cookie } = await seedWalletMember(h.db, 'm1', T0, { free: 1000 });
    expect((await spend(h, cookie, UNIT)).status).toBe(200);
    expect((await spend(h, cookie, TIER)).status).toBe(200);
    flag.on = on;
    const r = await h.call('POST', '/api/account/reset-free', { cookie, body: { op_id: op() } });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { wallet: { free: number; entitlements: unknown } };
    return { h, cookie, body };
  }
  const BOUGHT = { units: { dozer_d9: { free: true } }, upgrades: { inf_squad: { armour: { tier: 1, paidTiers: 0 } } } };

  it('OFF: the free balance and the coin-bought unit and tier go, journalled as a reset', async () => {
    const { h, body } = await boughtThenReset(false);
    expect(await freeOf(h)).toBe(0);
    expect(await entitlementsOf(h)).toEqual({ units: {}, upgrades: {} });
    expect(body.wallet).toMatchObject({ free: 0, entitlements: { units: {}, upgrades: {} } });
    expect(await kinds(h)).toEqual(['claim', 'unit', 'tier', 'reset']);
  });

  // N2 (delta review): a member with a campaign row. The seeded wallet has none, so the ON arm used to take the
  // `camp === null` branch only and nothing saw `spend.ts` keep the brigade. Credits go; coins, earn and entitlements stay.
  it('ON, with a campaign row: the credit brigade is emptied; earn, the balance and the entitlements are unchanged', async () => {
    const flag = { on: false as boolean | undefined };
    const h = setup(flag);
    const { cookie } = await seedWalletMember(h.db, 'm1', T0, { free: 1000 });
    expect((await spend(h, cookie, UNIT)).status).toBe(200);
    expect((await spend(h, cookie, TIER)).status).toBe(200);
    const brigade = { ...emptyAccount(), balance: 700, earned_total: 900, grants: [{ source: 'granted', amount: 900, at: 1 }] };
    await h.db.prepare("INSERT INTO campaign_state (member_id, ledger, brigade, bytes, updated_at) VALUES ('m1', '{}', ?1, 10, ?2)").bind(JSON.stringify(brigade), T0).run();
    const earn = '{"welcomed":true,"campaignDone":false,"backfilled":false,"missions":{"x":{"won":true,"stars":2}}}';
    // Precondition: the seeded brigade survives the stored round trip, so emptying it below is the reset's doing.
    expect(JSON.parse((await h.db.prepare('SELECT brigade FROM campaign_state').first<{ brigade: string }>())?.brigade ?? '{}')).toMatchObject({ balance: 700 });
    await h.db.prepare("UPDATE wallet SET earn = ?1").bind(earn).run();
    flag.on = true;
    const r = await h.call('POST', '/api/account/reset-free', { cookie, body: { op_id: op() } });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { campaign: { brigade: unknown } };
    expect(body.campaign.brigade).toEqual(emptyAccount());
    const row = await h.db.prepare('SELECT brigade FROM campaign_state').first<{ brigade: string }>();
    expect(JSON.parse(row?.brigade ?? '{}')).toEqual(emptyAccount());
    expect((await h.db.prepare('SELECT earn FROM wallet').first<{ earn: string }>())?.earn).toBe(earn);
    expect(await freeOf(h)).toBe(1000 - 60 - 15);
    expect(await entitlementsOf(h)).toEqual(BOUGHT);
    expect(await kinds(h)).toEqual(['claim', 'unit', 'tier']);
  });

  it('ON: the coin-bought unit and tier and the balance stay; no journal row claims coins were cleared', async () => {
    const { h, cookie, body } = await boughtThenReset(true);
    expect(await freeOf(h)).toBe(1000 - 60 - 15);
    expect(await entitlementsOf(h)).toEqual(BOUGHT);
    expect(body.wallet).toMatchObject({ free: 1000 - 60 - 15, entitlements: BOUGHT });
    expect(await kinds(h)).toEqual(['claim', 'unit', 'tier']);
    const state = (await (await h.call('GET', '/api/account/state', { cookie })).json()) as { wallet: { free: number; entitlements: unknown } };
    expect(state.wallet).toMatchObject({ free: 1000 - 60 - 15, entitlements: BOUGHT });
  });

  it('no switch in deps: the reset answers as the constant\'s arm', async () => {
    const { h } = await boughtThenReset(undefined);
    expect(await entitlementsOf(h)).toEqual(COINS_COSMETIC_ONLY ? BOUGHT : { units: {}, upgrades: {} });
    expect(await freeOf(h)).toBe(COINS_COSMETIC_ONLY ? 1000 - 60 - 15 : 0);
  });
});
