import { emptyAccount, parseWorld, sha256Hex, worldMissionIds } from '@lions/economy';
import { coupons, world } from '@lions/data';
import { describe, expect, it } from 'vitest';
import { handleAccount } from './routes';
import { accountHarness, racingD1, seedClaimCoupons, seedWalletMember } from './test-kit';

const DAY = 86_400_000;
const T0 = 20_000 * DAY + 3_600_000;
const [M1 = ''] = worldMissionIds(parseWorld(world));
const op = (n: number): string => `${String(n).padStart(8, '0')}-5555-4555-8555-555555555555`;
const CODE = 'TEST-CODE';
// The real table's ids and grants under a hash we know the code for: the real code is not in the repository.
const TABLE = coupons.map((c) => ({ ...c, sha256: sha256Hex(CODE) }));
const COIN_ID = 'lead_roar_coins_100k';
const CREDIT_ID = 'lead_special_units_10k';

function setup(opts: { race?: number } = {}) {
  let racing: ReturnType<typeof racingD1> | undefined;
  const h = accountHarness({
    now: T0,
    handler: (req, env) => {
      if (opts.race !== undefined) racing ??= racingD1(env.ACCOUNTS, opts.race, { match: /FROM wallet/ });
      return handleAccount(req, racing === undefined ? env : { ...env, ACCOUNTS: racing }, T0, {
        fetch: async () => new Response('no', { status: 500 }),
        coupons: TABLE,
      });
    },
  });
  return { h, racing: () => racing };
}
type S = ReturnType<typeof setup>;

const post = (s: S, cookie: string, route: string, body: unknown) => s.h.call('POST', `/api/account/${route}`, { cookie, body });
const buy = (s: S, cookie: string, n: number, unitId: string, extra: object = {}) => post(s, cookie, 'spend', { op_id: op(n), item: 'unit', unitId, ...extra });
const redeem = (s: S, cookie: string, n: number, code = CODE) => post(s, cookie, 'coupon', { op_id: op(n), code });
const reset = (s: S, cookie: string, n: number) => post(s, cookie, 'reset-free', { op_id: op(n) });

const one = async <R>(s: S, sql: string): Promise<R> => (await s.h.db.prepare(sql).first<R>()) as R;
const freeOf = async (s: S) => (await one<{ free: number }>(s, 'SELECT free FROM wallet')).free;
const sumOf = async (s: S) => (await one<{ s: number }>(s, 'SELECT COALESCE(SUM(free_delta), 0) AS s FROM coin_journal')).s;
const journal = async (s: S) => (await s.h.db.prepare('SELECT kind, free_delta AS d, detail FROM coin_journal ORDER BY id').all<{ kind: string; d: number; detail: string }>()).results;
const brigadeOf = async (s: S) => JSON.parse((await one<{ brigade: string }>(s, 'SELECT brigade FROM campaign_state')).brigade) as { balance: number; coupons: string[] };
const seedCampaign = (s: S, brigade: object = emptyAccount(), ledger: object = {}) =>
  s.h.db.prepare("INSERT INTO campaign_state (member_id, ledger, brigade, bytes, updated_at) VALUES ('m1', ?1, ?2, 10, ?3)").bind(JSON.stringify(ledger), JSON.stringify(brigade), T0).run();

describe('POST spend', () => {
  it('the_server_prices_a_spend (A2-7)', async () => {
    const s = setup();
    const { cookie } = await seedWalletMember(s.h.db, 'm1', T0, { free: 1000 });
    // dozer_d9's unlock.price is 560 credits: coinPrice(560) = 60. The body claims coins 1 and price 1.
    const r = await buy(s, cookie, 1, 'dozer_d9', { coins: 1, price: 1, amount: 1 });
    expect(r.status).toBe(200);
    expect(await freeOf(s)).toBe(940);
    expect(((await r.json()) as { wallet: { free: number } }).wallet.free).toBe(940);
    expect((await journal(s)).slice(1)).toEqual([expect.objectContaining({ kind: 'unit', d: -60 })]);
    expect(await sumOf(s)).toBe(940);
    // A tier: dozer_d9 armour tier 1 costs 235 credits = 25 coins, kind 'tier'.
    const t = await post(s, cookie, 'spend', { op_id: op(2), item: 'tier', unitId: 'dozer_d9', track: 'armour', tier: 1 });
    expect(t.status).toBe(200);
    expect(await freeOf(s)).toBe(915);
    expect((await journal(s)).at(-1)).toEqual(expect.objectContaining({ kind: 'tier', d: -25 }));
    expect(await sumOf(s)).toBe(915);
  });

  it('no_double_spend (A2-24)', async () => {
    const s = setup({ race: 4 });
    // demo_squad (360 credits) and sniper_team (380) both cost 40 coins; the member holds exactly 40.
    const { cookie } = await seedWalletMember(s.h.db, 'm1', T0, { free: 40 });
    const [a, b] = await Promise.all([buy(s, cookie, 1, 'demo_squad'), buy(s, cookie, 2, 'sniper_team')]);
    expect(s.racing()?.opened()).toBe(true);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = (a.status === 409 ? a : b);
    expect(['refused', 'busy']).toContain(((await loser.json()) as { error: string }).error);
    expect(await freeOf(s)).toBe(0);
    expect(await sumOf(s)).toBe(0);
    expect((await journal(s)).filter((j) => j.kind === 'unit')).toHaveLength(1);
  });

  it('refused_spend_writes_nothing', async () => {
    const s = setup();
    const { cookie } = await seedWalletMember(s.h.db, 'm1', T0, { free: 10 });
    const before = await journal(s);
    // inf_squad is the starting roster: nothing to sell. dozer_d9 is for sale, but 60 coins is more than 10.
    const closed = await buy(s, cookie, 1, 'inf_squad');
    expect([closed.status, await closed.json()]).toEqual([409, expect.objectContaining({ error: 'refused', reason: 'closed' })]);
    const nope = await buy(s, cookie, 2, 'no_such_unit');
    expect([nope.status, ((await nope.json()) as { reason: string }).reason]).toEqual([409, 'closed']);
    const short = await buy(s, cookie, 3, 'dozer_d9');
    expect([short.status, await short.json()]).toEqual([409, expect.objectContaining({ error: 'refused', reason: 'coins', wallet: expect.objectContaining({ free: 10 }) })]);
    expect(await journal(s)).toEqual(before);
    expect(await freeOf(s)).toBe(10);
    expect((await one<{ n: number }>(s, 'SELECT COUNT(*) AS n FROM account_op')).n).toBe(0);
  });

  it('a spend for a unit already bought is closed, and a malformed ask is a 400', async () => {
    const s = setup();
    const { cookie } = await seedWalletMember(s.h.db, 'm1', T0, { free: 1000 });
    expect((await buy(s, cookie, 1, 'dozer_d9')).status).toBe(200);
    const again = await buy(s, cookie, 2, 'dozer_d9');
    expect([again.status, ((await again.json()) as { reason: string }).reason]).toEqual([409, 'closed']);
    expect((await post(s, cookie, 'spend', { op_id: op(3), item: 'tier', unitId: 'dozer_d9', track: 'armour' })).status).toBe(400);
    expect((await post(s, cookie, 'spend', { op_id: op(4), item: 'gift', unitId: 'dozer_d9' })).status).toBe(400);
    expect(await sumOf(s)).toBe(940);
  });

  it('a retried spend answers the first answer and charges once', async () => {
    const s = setup();
    const { cookie } = await seedWalletMember(s.h.db, 'm1', T0, { free: 1000 });
    const a = await buy(s, cookie, 1, 'dozer_d9');
    const b = await buy(s, cookie, 1, 'dozer_d9');
    expect([b.status, await b.json()]).toEqual([200, await a.json()]);
    expect(await freeOf(s)).toBe(940);
  });
});

describe('POST coupon', () => {
  it('pays coins and credits in one batch, once, with the use rows', async () => {
    const s = setup();
    const { cookie } = await seedWalletMember(s.h.db, 'm1', T0, { free: 5 });
    const r = await post(s, cookie, 'coupon', { op_id: op(1), code: `  ${CODE} `, coins: 7, credits: 7 });
    const body = (await r.json()) as { result: string; ids: string[]; coins: number; credits: number; wallet: { free: number }; campaign: { brigade: { balance: number; coupons: string[] }; revision: number } };
    expect([r.status, body.result, body.coins, body.credits, body.wallet.free]).toEqual([200, 'ok', 100_000, 10_000, 100_005]);
    expect([...body.ids].sort()).toEqual([COIN_ID, CREDIT_ID].sort());
    expect(body.campaign.brigade.balance).toBe(10_000);
    expect([...body.campaign.brigade.coupons].sort()).toEqual([COIN_ID, CREDIT_ID].sort());
    expect(body.campaign.revision).toBe(1);
    expect(await freeOf(s)).toBe(100_005);
    expect(await sumOf(s)).toBe(100_005);
    expect((await journal(s)).at(-1)).toEqual(expect.objectContaining({ kind: 'coupon', d: 100_000 }));
    expect((await s.h.db.prepare('SELECT coupon_id FROM coupon_use ORDER BY coupon_id').all<{ coupon_id: string }>()).results.map((x) => x.coupon_id)).toEqual([COIN_ID, CREDIT_ID].sort());
  });

  it('an unknown code and a wrong-case code write no coins, no use rows and no campaign', async () => {
    const s = setup();
    const { cookie } = await seedWalletMember(s.h.db, 'm1', T0, { free: 5 });
    for (const [n, code] of [[1, 'nope'], [2, CODE.toLowerCase()]] as const) {
      const r = await redeem(s, cookie, n, code);
      expect([r.status, await r.json()]).toEqual([200, expect.objectContaining({ result: 'unknown', ids: [], coins: 0, credits: 0, campaign: null })]);
    }
    expect((await post(s, cookie, 'coupon', { op_id: op(3), code: 5 })).status).toBe(400);
    expect(await freeOf(s)).toBe(5);
    expect((await one<{ n: number }>(s, 'SELECT COUNT(*) AS n FROM coupon_use')).n).toBe(0);
    expect((await one<{ n: number }>(s, 'SELECT COUNT(*) AS n FROM campaign_state')).n).toBe(0);
  });

  it('a_coupon_is_once_per_member (A2-11)', async () => {
    const s = setup();
    const { cookie } = await seedWalletMember(s.h.db, 'm1', T0);
    expect(((await (await redeem(s, cookie, 1)).json()) as { result: string }).result).toBe('ok');
    expect((await brigadeOf(s)).balance).toBe(10_000);
    const r = await reset(s, cookie, 2);
    expect(r.status).toBe(200);
    expect(await freeOf(s)).toBe(0);
    expect((await brigadeOf(s)).balance).toBe(0);
    const again = await redeem(s, cookie, 3);
    expect([again.status, await again.json()]).toEqual([200, expect.objectContaining({ result: 'used', coins: 0, credits: 0 })]);
    expect(await freeOf(s)).toBe(0);
    expect((await brigadeOf(s)).balance).toBe(0);
    expect(await sumOf(s)).toBe(0);
  });

  it('a claim that credited 800 leaves a top-up of 99,200 (A2-22)', async () => {
    const s = setup();
    const { cookie } = await seedWalletMember(s.h.db, 'm1', T0);
    await seedClaimCoupons(s.h.db, 'm1', T0, [{ id: COIN_ID, credited: 800, capped: true }]);
    const r = await redeem(s, cookie, 1);
    const body = (await r.json()) as { result: string; coins: number; wallet: { free: number } };
    expect([body.result, body.coins, body.wallet.free]).toEqual(['ok', 99_200, 100_000]);
    expect(await freeOf(s)).toBe(100_000);
    expect(await sumOf(s)).toBe(100_000);
  });

  it('a claim row has no effect once the real code paid (A2-23, used half)', async () => {
    const s = setup();
    const { cookie } = await seedWalletMember(s.h.db, 'm1', T0);
    expect(((await (await redeem(s, cookie, 1)).json()) as { coins: number }).coins).toBe(100_000);
    await seedClaimCoupons(s.h.db, 'm1', T0 + 1, [{ id: COIN_ID, credited: 800, capped: true }], 'backfill');
    const again = await redeem(s, cookie, 2);
    expect(((await again.json()) as { result: string }).result).toBe('used');
    expect(await freeOf(s)).toBe(100_800);
    expect(await sumOf(s)).toBe(100_800);
  });

  it('claimed coins never go below zero: a claim that credited more than the grant tops up nothing', async () => {
    const s = setup();
    const { cookie } = await seedWalletMember(s.h.db, 'm1', T0);
    await seedClaimCoupons(s.h.db, 'm1', T0, [{ id: COIN_ID, credited: 100_000, capped: false }]);
    await seedClaimCoupons(s.h.db, 'm1', T0 + 1, [{ id: COIN_ID, credited: 50, capped: false }], 'backfill');
    const r = await redeem(s, cookie, 1);
    const body = (await r.json()) as { result: string; coins: number; credits: number };
    expect([body.result, body.coins, body.credits]).toEqual(['ok', 0, 10_000]);
    expect(await freeOf(s)).toBe(100_050);
    expect(await sumOf(s)).toBe(100_050);
  });

  it('keeps an existing campaign and its ledger, and caps coins at MAX_COINS', async () => {
    const s = setup();
    const { cookie } = await seedWalletMember(s.h.db, 'm1', T0, { free: 950_000 });
    await seedCampaign(s, emptyAccount(), { 'campaign.flag': 1 });
    await s.h.db.prepare("UPDATE campaign_state SET revision = 4").run();
    const r = await redeem(s, cookie, 1);
    const body = (await r.json()) as { coins: number; wallet: { free: number }; campaign: { revision: number; ledger: object; brigade: { balance: number } } };
    expect([body.coins, body.wallet.free, body.campaign.revision, body.campaign.brigade.balance]).toEqual([50_000, 1_000_000, 5, 10_000]);
    expect(body.campaign.ledger).toEqual({ 'campaign.flag': 1 });
    expect(await sumOf(s)).toBe(1_000_000);
  });
});

describe('POST reset-free', () => {
  it('reset_keeps_the_lifetime_record', async () => {
    const s = setup();
    const { cookie } = await seedWalletMember(s.h.db, 'm1', T0, { free: 50 });
    const earn = JSON.stringify({ welcomed: true, campaignDone: false, backfilled: false, missions: { [M1]: { won: true, stars: 2 } } });
    await s.h.db.prepare("UPDATE wallet SET earn = ?1, earn_lifetime = ?1 WHERE member_id = 'm1'").bind(earn).run();
    await seedCampaign(s, { ...emptyAccount(), balance: 300 }, { 'campaign.flag': 1 });
    const r = await reset(s, cookie, 1);
    const body = (await r.json()) as { wallet: { free: number; earn: { missions: object; welcomed: boolean } }; campaign: { brigade: { balance: number }; ledger: object } };
    expect([r.status, body.wallet.free, body.wallet.earn.missions, body.wallet.earn.welcomed]).toEqual([200, 0, {}, false]);
    expect(body.campaign.brigade.balance).toBe(0);
    expect(body.campaign.ledger).toEqual({ 'campaign.flag': 1 });
    const row = await one<{ earn: string; earn_lifetime: string; free: number }>(s, 'SELECT earn, earn_lifetime, free FROM wallet');
    expect(JSON.parse(row.earn)).toEqual({ welcomed: false, campaignDone: false, backfilled: true, missions: {} });
    expect(row.earn_lifetime).toBe(earn);
    expect((await journal(s)).at(-1)).toEqual(expect.objectContaining({ kind: 'reset', d: -50 }));
    expect(await sumOf(s)).toBe(0);
    expect(await brigadeOf(s)).toEqual(emptyAccount());
  });

  it('with no campaign row it creates none and answers campaign null; coupon_use is untouched', async () => {
    const s = setup();
    const { cookie } = await seedWalletMember(s.h.db, 'm1', T0, { free: 9 });
    await s.h.db.prepare("INSERT INTO coupon_use VALUES ('m1','c1',?1)").bind(T0).run();
    const r = await reset(s, cookie, 1);
    expect([r.status, ((await r.json()) as { campaign: unknown }).campaign]).toEqual([200, null]);
    expect((await one<{ n: number }>(s, 'SELECT COUNT(*) AS n FROM campaign_state')).n).toBe(0);
    expect((await one<{ n: number }>(s, 'SELECT COUNT(*) AS n FROM coupon_use')).n).toBe(1);
    expect(await freeOf(s)).toBe(0);
    expect(await sumOf(s)).toBe(0);
  });
});
