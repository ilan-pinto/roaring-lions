import { canonicalCampaign, canonicalSlot, claimEvidence, coinPrice, migrateRoar, emptyAccount, parseWorld, SAVE_VERSION, sha256Hex, storeInputFor, storeItems, worldMissionIds, type SaveSlot } from '@lions/economy';
import { coupons, units, world } from '@lions/data';
import { describe, expect, it } from 'vitest';
import type { D1Like, D1Stmt } from '../d1';
import { digestOf } from './campaign';
import { CLAIM_COUPON_COINS_CAP } from './config';
import { handleAccount } from './routes';
import { accountHarness, memberTablesInMigration, racingD1, seedWalletMember, swappableHarness } from './test-kit';

const DAY = 86_400_000;
const T0 = 20_000 * DAY + 3_600_000;
const ids = worldMissionIds(parseWorld(world));
const [M1 = '', M2 = '', M3 = ''] = ids;
let seq = 1;
const op = (): string => `${String(seq++).padStart(8, '0')}-7777-4777-8777-777777777777`;
const dev = (n: number): string => `dddddddd-${String(n).padStart(4, '0')}-4ddd-8ddd-dddddddddddd`;
const CODE = 'TEST-CODE';
const TABLE = coupons.map((c) => ({ ...c, sha256: sha256Hex(CODE) }));
const COIN_ID = 'lead_roar_coins_100k';
const CREDIT_ID = 'lead_special_units_10k';
const RICH = { coins: { free: 1_000_000, paid: 0 } };

/** A ledger that has won each `[mission, stars]`. */
const ledgerOf = (wins: [string, number][]): Record<string, unknown> => ({
  'campaign.completed_missions': wins.map(([id]) => id),
  'campaign.mission_results': Object.fromEntries(wins.map(([id, stars]) => [id, { stars, roe: 0, ticks: 0, lost: 0 }])),
});
const campaignOf = (wins: [string, number][], brigade: object = emptyAccount()) => ({ ledger: ledgerOf(wins), brigade, tutorialDone: false });
const slotOf = (id: string, savedAt: number, wins: [string, number][] = []) => ({
  version: SAVE_VERSION, id, name: `slot ${id}`, savedAt, build: 'b1', ledger: ledgerOf(wins), account: emptyAccount(), tutorialDone: false,
});

interface Opts { race?: number; hook?: (db: D1Like) => Promise<void>; free?: number; claimCountBarrier?: boolean }
function setup(opts: Opts = {}) {
  let racing: ReturnType<typeof racingD1> | undefined;
  const clock = { t: 0 };
  // Holds every `acct-claim` count read until two have been made, so both requests see the same count before either bumps.
  let arrived = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => { release = r; });
  const barrier = (inner: D1Like): D1Like => {
    const wrap = (st: D1Stmt, sql: string, bound: unknown[]): D1Stmt => ({
      ...st,
      bind: (...v) => wrap(st.bind(...v), sql, v),
      first: async <R>() => {
        const row = await st.first<R>();
        if (/^SELECT n FROM rate_day/.test(sql) && bound[0] === 'acct-claim') {
          if (++arrived >= 2) release();
          await gate;
        }
        return row;
      },
    });
    return { ...inner, prepare: (q: string) => wrap(inner.prepare(q), q, []) };
  };
  const h = accountHarness({
    now: T0,
    handler: (req, env, at) => {
      if (opts.race !== undefined) racing ??= racingD1(env.ACCOUNTS, opts.race, { arrivals: true });
      let db: D1Like = racing ?? env.ACCOUNTS;
      if (opts.claimCountBarrier === true) db = barrier(db);
      const hook = opts.hook;
      if (hook !== undefined) {
        const inner = db;
        let fired = false;
        db = { ...inner, prepare: (q: string) => inner.prepare(q), batch: async (ss: D1Stmt[]) => { if (!fired && ss.length > 1) { fired = true; await hook(inner); } return inner.batch(ss); } };
      }
      return handleAccount(req, { ...env, ACCOUNTS: db }, clock.t || at, { fetch: async () => new Response('no', { status: 500 }), coupons: TABLE });
    },
  });
  return { h, clock, racing: () => racing };
}
type S = ReturnType<typeof setup>;

interface Body { device?: string; campaign?: unknown; slots?: { id: string; slot: unknown }[]; wallet?: unknown; coupons?: string[]; op?: string }
const claimBody = (b: Body, n = 1) => ({ op_id: b.op ?? op(), device_id: b.device ?? dev(n), campaign: b.campaign ?? null, slots: b.slots ?? [], wallet: b.wallet ?? RICH, coupons: b.coupons ?? [] });
const claim = (s: S, cookie: string, b: Body, n = 1) => s.h.call('POST', '/api/account/claim', { cookie, body: claimBody(b, n) });
interface Result {
  coins: number; earned: number; coupons: { id: string; credited: number; capped: boolean }[]; carried: unknown[]; notCarried: { ask: unknown; reason: string }[];
  campaign: { status: string; serverId?: string; digest?: string; reason?: string } | null; slots: { deviceId: string; status: string; serverId?: string; reason?: string }[];
  state: { wallet: { free: number; paid: number; entitlements: unknown; earn: { missions: Record<string, unknown> }; receipts: { kind: string; id: string; coins: { free: number; paid: number }; source?: string }[] }; slots: { id: string; origin: string }[]; campaign: unknown };
}
const ok = async (r: Response): Promise<Result> => { expect(r.status).toBe(200); return (await r.json()) as Result; };

const one = async <R>(s: S, sql: string): Promise<R> => (await s.h.db.prepare(sql).first<R>()) as R;
const freeOf = async (s: S) => (await one<{ free: number }>(s, 'SELECT free FROM wallet')).free;
const sumOf = async (s: S) => (await one<{ s: number }>(s, 'SELECT COALESCE(SUM(free_delta), 0) AS s FROM coin_journal')).s;
const count = async (s: S, table: string) => (await one<{ n: number }>(s, `SELECT COUNT(*) AS n FROM ${table}`)).n;
const record = async (s: S, col: 'earn' | 'earn_lifetime') => JSON.parse((await one<Record<string, string>>(s, `SELECT ${col} AS c FROM wallet`)).c ?? '{}') as { missions: Record<string, unknown> };
const memberRows = async (s: S): Promise<Record<string, number>> => {
  const out: Record<string, number> = {};
  for (const t of memberTablesInMigration()) out[t] = await count(s, t);
  return out;
};
const reset = (s: S, cookie: string) => s.h.call('POST', '/api/account/reset-free', { cookie, body: { op_id: op() } });
const member = async (s: S, free = 0) => (await seedWalletMember(s.h.db, 'm1', T0, { free })).cookie;

describe('POST claim', () => {
  it('same_device_returns_the_first_result (A2-1)', async () => {
    const s = setup();
    const cookie = await member(s);
    const first = await ok(await claim(s, cookie, { campaign: campaignOf([[M1, 1]]) }));
    expect(first.coins).toBe(115);
    expect(first.state.wallet.free).toBe(115);
    const counts = [await freeOf(s), await count(s, 'coin_journal')];
    const again = await ok(await claim(s, cookie, { campaign: campaignOf([[M1, 3], [M2, 3]]) }));
    expect(again.coins).toBe(115);
    expect(again.campaign).toEqual(first.campaign);
    expect(again.state.wallet.free).toBe(115);
    expect([await freeOf(s), await count(s, 'coin_journal')]).toEqual(counts);
    expect(await sumOf(s)).toBe(115);
  });

  it('a replayed op id answers the first result with a fresh state', async () => {
    const s = setup();
    const cookie = await member(s);
    const o = op();
    const first = await ok(await claim(s, cookie, { op: o, campaign: campaignOf([[M1, 1]]) }));
    const again = await ok(await claim(s, cookie, { op: o, campaign: campaignOf([[M1, 1]]) }));
    expect(again).toEqual(first);
    expect(again.state.wallet.free).toBe(115);
  });

  it('no_double_pay_across_devices (A2-2)', async () => {
    const s = setup();
    const cookie = await member(s);
    const led = campaignOf([[M1, 1], [M2, 2]]);
    expect((await ok(await claim(s, cookie, { campaign: led }, 1))).coins).toBe(135);
    const b = await ok(await claim(s, cookie, { campaign: led }, 2));
    expect([b.coins, b.earned]).toEqual([0, 0]);
    expect(await freeOf(s)).toBe(135);
    expect(await sumOf(s)).toBe(135);
  });

  it('a_forged_balance_is_a_ceiling (A2-3)', async () => {
    const s = setup();
    const cookie = await member(s);
    const r = await ok(await claim(s, cookie, { wallet: { coins: { free: 1_000_000 } }, campaign: campaignOf([[M1, 1], [M2, 2]]) }));
    expect(r.coins).toBe(135);
    expect(await freeOf(s)).toBe(135);
    // And a LOW balance cuts the credit: the device's own coins are the ceiling.
    const s2 = setup();
    const c2 = await member(s2);
    expect((await ok(await claim(s2, c2, { wallet: { coins: { free: 20 } }, campaign: campaignOf([[M1, 1], [M2, 2]]) }))).coins).toBe(20);
    expect(await sumOf(s2)).toBe(20);
  });

  it('a_forged_record_is_bounded (A2-4)', async () => {
    expect(ids.length).toBe(29);
    const s = setup();
    const cookie = await member(s);
    const all = ids.map((id) => [id, 99] as [string, number]);
    const earn = { welcomed: true, campaignDone: true, backfilled: false, missions: Object.fromEntries(ids.map((id) => [id, { won: true, stars: 99 }])) };
    const r = await ok(await claim(s, cookie, { wallet: { ...RICH, earn }, campaign: campaignOf(all), slots: [{ id: 'x', slot: slotOf('x', 1, all) }] }));
    expect(r.coins).toBeLessThanOrEqual(925);
    expect(r.earned).toBe(925);
    expect(await freeOf(s)).toBeLessThanOrEqual(925);
    const lifetime = await record(s, 'earn_lifetime');
    expect(Object.values(lifetime.missions).every((m) => (m as { stars: number }).stars <= 3)).toBe(true);
  });

  it('claimEvidence itself clamps stars 0 to 3 and ignores non-world missions (the clamp the route also relies on)', () => {
    const forged = migrateRoar({ earn: { missions: { [M1]: { won: true, stars: 99 }, off_world: { won: true, stars: 3 } } } });
    const ev = claimEvidence({ wallet: { ...forged, earn: { ...forged.earn, missions: { [M1]: { won: true, stars: 99 }, off_world: { won: true, stars: 3 } } } }, ledgers: [ledgerOf([[M2, -7]]) as never], world: parseWorld(world) });
    expect(ev.missions[M1]).toEqual({ won: true, stars: 3 });
    expect(ev.missions[M2]).toEqual({ won: true, stars: 0 });
    expect(Object.keys(ev.missions).sort()).toEqual([M1, M2].sort());
  });

  it('paid_stays_zero (A2-5)', async () => {
    const s = setup();
    const cookie = await member(s);
    const r = await ok(await claim(s, cookie, { wallet: { coins: { free: 50, paid: 500 } }, campaign: campaignOf([[M1, 1]]) }));
    expect(r.coins).toBe(50);
    expect(r.state.wallet.paid).toBe(0);
    expect((await one<{ paid: number }>(s, 'SELECT paid FROM wallet')).paid).toBe(0);
  });

  it('a_claim_at_the_slot_cap (A2-19 server half)', async () => {
    const s = setup();
    const cookie = await member(s);
    const slots = Array.from({ length: 14 }, (_, i) => ({ id: `d${i + 1}`, slot: slotOf(`d${i + 1}`, i + 1) }));
    const r = await ok(await claim(s, cookie, { slots: [...slots].reverse() }));
    expect(r.slots.map((x) => x.deviceId).sort()).toEqual(slots.map((x) => x.id).sort());
    expect(r.slots.filter((x) => x.status === 'stored')).toHaveLength(12);
    expect(r.slots.filter((x) => x.status === 'rejected').map((x) => [x.deviceId, x.reason]).sort()).toEqual([['d1', 'cap'], ['d2', 'cap']]);
    expect(await count(s, "save_slot WHERE origin = 'player'")).toBe(12);
    // The server's ids are new: a stored item names a row that exists.
    for (const x of r.slots.filter((y) => y.status === 'stored')) expect(r.state.slots.some((m) => m.id === x.serverId && m.origin === 'player')).toBe(true);
    // A slot the member already holds is never evicted: a later device finds the room used.
    const more = await ok(await claim(s, cookie, { slots: [{ id: 'late', slot: slotOf('late', 99) }] }, 2));
    expect(more.slots).toEqual([{ deviceId: 'late', status: 'rejected', reason: 'cap' }]);
    expect(await count(s, "save_slot WHERE origin = 'player'")).toBe(12);
  });

  it('a stored slot is canonical, with the body savedAt and build, digest of exactly what is stored', async () => {
    const s = setup();
    const cookie = await member(s);
    const r = await ok(await claim(s, cookie, { slots: [{ id: 'a', slot: slotOf('a', 77) }, { id: 'bad', slot: { nope: 1 } }, { id: 'huge', slot: { ...slotOf('huge', 5), name: 'x', ledger: { 'campaign.completed_missions': Array.from({ length: 30_000 }, (_, i) => `mission_${i}_padding`) } } }] }));
    const a = r.slots[0];
    expect(a?.status).toBe('stored');
    const row = await one<{ body: string; saved_at: number }>(s, `SELECT body, saved_at FROM save_slot WHERE slot_id = '${a?.serverId}'`);
    const stored = JSON.parse(row.body) as SaveSlot;
    expect([stored.savedAt, stored.build, stored.id]).toEqual([77, 'b1', a?.serverId]);
    expect(row.saved_at).toBe(T0);
    expect((r.slots[0] as { digest?: string }).digest).toBe(await digestOf(canonicalSlot(stored)));
    expect(r.slots[1]).toEqual({ deviceId: 'bad', status: 'rejected', reason: 'invalid' });
    expect(r.slots[2]).toEqual({ deviceId: 'huge', status: 'rejected', reason: 'size' });
  });

  it('no_repay_after_a_reset (A2-20)', async () => {
    const s = setup();
    const cookie = await member(s);
    expect((await ok(await claim(s, cookie, { campaign: campaignOf([[M1, 1], [M2, 2]]) }, 1))).coins).toBe(135);
    expect((await reset(s, cookie)).status).toBe(200);
    expect(await freeOf(s)).toBe(0);
    expect(Object.keys((await record(s, 'earn')).missions)).toEqual([]);
    const b = await ok(await claim(s, cookie, { campaign: campaignOf([[M1, 1], [M2, 2]]) }, 2));
    expect(b.coins).toBe(0);
    expect(Object.keys((await record(s, 'earn')).missions)).toEqual([]);
    const c = await ok(await claim(s, cookie, { campaign: campaignOf([[M1, 1], [M2, 2], [M3, 1]]) }, 3));
    expect(c.coins).toBe(15);
    expect(Object.keys((await record(s, 'earn')).missions)).toEqual([M3]);
    expect(await sumOf(s)).toBe(await freeOf(s));
  });

  it('a_coupon_claim_is_capped_per_member (A2-22)', async () => {
    const s = setup();
    const cookie = await member(s);
    const a = await ok(await claim(s, cookie, { wallet: RICH, coupons: [COIN_ID] }, 1));
    expect(a.coins).toBe(800);
    expect(a.coupons).toEqual([{ id: COIN_ID, credited: 800, capped: true }]);
    const b = await ok(await claim(s, cookie, { wallet: RICH, coupons: [COIN_ID] }, 2));
    expect(b.coins).toBe(0);
    expect(b.coupons).toEqual([{ id: COIN_ID, credited: 0, capped: true }]);
    expect(await freeOf(s)).toBe(800);
    // The real code tops up the rest.
    const red = await s.h.call('POST', '/api/account/coupon', { cookie, body: { op_id: op(), code: CODE } });
    expect(red.status).toBe(200);
    expect(((await red.json()) as { coins: number }).coins).toBe(99_200);
    expect(await freeOf(s)).toBe(100_000);
    expect(await sumOf(s)).toBe(100_000);
  });

  it('coupons_with_no_coins_and_used_ones (A2-23)', async () => {
    const s = setup();
    const cookie = await member(s);
    const r = await ok(await claim(s, cookie, { coupons: [CREDIT_ID, COIN_ID, COIN_ID, 'not_a_real_coupon'] }));
    expect(r.coins).toBe(800);
    expect(r.coupons).toEqual([{ id: CREDIT_ID, credited: 0, capped: false }, { id: COIN_ID, credited: 800, capped: true }]);
    expect(Number.isInteger(await freeOf(s))).toBe(true);
    expect(Number.isInteger(r.state.wallet.free)).toBe(true);
    expect(JSON.stringify(r)).not.toContain('not_a_real_coupon');
    const j = await one<{ detail: string }>(s, "SELECT detail FROM coin_journal WHERE kind = 'backfill'");
    expect(Number.isInteger((JSON.parse(j.detail) as { couponCoins: number }).couponCoins)).toBe(true);
    // A member whose real redeem paid 100,000 first: the claim's id credits 0 and the balance stays put.
    const s2 = setup();
    const c2 = await member(s2);
    const red = await s2.h.call('POST', '/api/account/coupon', { cookie: c2, body: { op_id: op(), code: CODE } });
    expect(red.status).toBe(200);
    expect(await freeOf(s2)).toBe(100_000);
    const used = await ok(await claim(s2, c2, { coupons: [COIN_ID, CREDIT_ID] }));
    expect(used.coins).toBe(0);
    expect(used.coupons).toEqual([{ id: COIN_ID, credited: 0, capped: false }, { id: CREDIT_ID, credited: 0, capped: false }]);
    expect(await freeOf(s2)).toBe(100_000);
  });

  it('the_coupon_cap_is_the_dearest_unit', () => {
    expect(CLAIM_COUPON_COINS_CAP).toBe(800);
    const dearest = Math.max(...Object.values(units).filter((u) => u.faction === 'kdf').map((u) => ('unlock' in u && typeof u.unlock?.price === 'number' ? coinPrice(u.unlock.price) : 0)));
    expect(dearest).toBe(800);
  });

  it('claim_spends_only_its_own_coins (§0.26)', async () => {
    const s = setup();
    const cookie = await member(s, 1000);
    const wallet = { ...RICH, entitlements: { units: { dozer_d9: { free: true } }, upgrades: {} } };
    const r = await ok(await claim(s, cookie, { wallet }, 2));
    expect(r.carried).toEqual([]);
    expect(r.notCarried).toEqual([{ ask: { item: 'unit', unitId: 'dozer_d9' }, reason: 'coins' }]);
    expect(await freeOf(s)).toBe(1000);
    expect(r.state.wallet.entitlements).toEqual({ units: {}, upgrades: {} });
  });

  it('a_claim_carries_what_it_can', async () => {
    const s = setup();
    const cookie = await member(s);
    // 135 earned; dozer_d9 is 60 coins and breach_team 85. The receipts name dozer FIRST (not alphabetical), so the
    // dozer is carried (75 left) and the breach team (85) is not. The device balance, 300, is above what is left.
    const receipt = (id: string, unitId: string, credits: number) => ({ kind: 'unit', id, at: 1, coins: { free: 0, paid: 0 }, unitId, credits });
    const wallet = {
      coins: { free: 300, paid: 0 },
      entitlements: { units: { dozer_d9: { free: true }, breach_team: { free: true } }, upgrades: {} },
      receipts: [receipt('r1', 'dozer_d9', 560), receipt('r2', 'breach_team', 850)],
    };
    const r = await ok(await claim(s, cookie, { wallet, campaign: campaignOf([[M1, 1], [M2, 2]]) }));
    expect(r.carried).toEqual([{ item: 'unit', unitId: 'dozer_d9' }]);
    expect(r.notCarried).toEqual([{ ask: { item: 'unit', unitId: 'breach_team' }, reason: 'coins' }]);
    expect(r.coins).toBe(75);
    expect(await freeOf(s)).toBe(75);
    expect(r.state.wallet.entitlements).toEqual({ units: { dozer_d9: { free: true } }, upgrades: {} });
    const rows = (await s.h.db.prepare('SELECT kind, free_delta AS d FROM coin_journal ORDER BY id').all<{ kind: string; d: number }>()).results;
    expect(rows.slice(-2)).toEqual([{ kind: 'backfill', d: 75 + 60 }, { kind: 'unit', d: -60 }]);
    expect(await sumOf(s)).toBe(75);
    // R23: the claim's own coins are on the Receipts shelf, before the carried unit's receipt.
    expect(r.state.wallet.receipts.map((x) => [x.kind, x.coins.free, x.source ?? null])).toEqual([['earn', 135, 'backfill'], ['unit', 60, null]]);
    // A server-held unit is `owned`, and a unit off the Stores is not asked at all.
    const again = await ok(await claim(s, cookie, { wallet: { ...wallet, entitlements: { units: { dozer_d9: { free: true }, nonsense: { free: true } }, upgrades: {} } } }, 2));
    expect(again.notCarried).toEqual([{ ask: { item: 'unit', unitId: 'dozer_d9' }, reason: 'owned' }]);
  });

  it('a claim with no coins credited writes no receipt', async () => {
    const s = setup();
    const cookie = await member(s);
    const r = await ok(await claim(s, cookie, {}));
    expect([r.coins, r.state.wallet.receipts]).toEqual([0, []]);
  });

  it('every entitlement is carried or not carried: none is dropped past 48 asks', async () => {
    const s = setup();
    const cookie = await member(s);
    const items = storeItems(storeInputFor({ ledger: {}, brigade: emptyAccount(), roar: migrateRoar({}) }));
    const upgrades: Record<string, Record<string, { tier: number; paidTiers: number }>> = {};
    for (const t of items.tiers) (upgrades[t.unitId] ??= {})[t.track] = { tier: t.length, paidTiers: 0 };
    const unitsHeld = Object.fromEntries(items.units.map((u) => [u.id, { free: true }]));
    const asks = items.units.length + items.tiers.reduce((n, t) => n + t.length, 0);
    expect(asks).toBeGreaterThan(48);
    const r = await ok(await claim(s, cookie, { wallet: { ...RICH, entitlements: { units: unitsHeld, upgrades } }, campaign: campaignOf([[M1, 1]]) }));
    expect(r.carried.length + r.notCarried.length).toBe(asks);
  });

  it('second_device_campaign_becomes_a_slot', async () => {
    const s = setup();
    const cookie = await member(s);
    const first = await ok(await claim(s, cookie, { campaign: campaignOf([[M1, 1]]) }, 1));
    expect(first.campaign?.serverId).toBe('campaign');
    const rev = (await one<{ revision: number }>(s, 'SELECT revision FROM campaign_state')).revision;
    const before = (await one<{ ledger: string }>(s, 'SELECT ledger FROM campaign_state')).ledger;
    const body = campaignOf([[M2, 2]]);
    const second = await ok(await claim(s, cookie, { campaign: body }, 2));
    expect(second.campaign?.status).toBe('stored');
    expect(second.campaign?.serverId).not.toBe('campaign');
    expect(second.campaign?.digest).toBe(await digestOf(canonicalCampaign(body as never)));
    const row = await one<{ origin: string }>(s, `SELECT origin FROM save_slot WHERE slot_id = '${second.campaign?.serverId}'`);
    expect(row.origin).toBe('claim');
    expect([(await one<{ revision: number }>(s, 'SELECT revision FROM campaign_state')).revision, (await one<{ ledger: string }>(s, 'SELECT ledger FROM campaign_state')).ledger]).toEqual([rev, before]);
    // With four system slots taken the campaign is rejected, not evicting anything.
    for (let i = 0; i < 3; i++) {
      s.clock.t = T0 + (i + 1) * DAY;
      await claim(s, cookie, { campaign: campaignOf([[M3, i + 1]]) }, 3 + i);
    }
    s.clock.t = T0 + 4 * DAY;
    const held = await ok(await claim(s, cookie, { campaign: campaignOf([[M3, 3]]) }, 9));
    expect(held.campaign).toEqual({ deviceId: 'campaign', status: 'rejected', reason: 'cap' });
    expect(await count(s, "save_slot WHERE origin <> 'player'")).toBe(4);
  });

  it('claim_budget', async () => {
    const s = setup();
    const cookie = await member(s);
    for (let i = 1; i <= 5; i++) expect((await claim(s, cookie, {}, i)).status).toBe(200);
    const six = await claim(s, cookie, {}, 6);
    expect(six.status).toBe(429);
    expect((await one<{ n: number }>(s, "SELECT n FROM rate_day WHERE scope = 'acct-claim'")).n).toBe(5);
    expect(await count(s, 'device_claim')).toBe(5);
  });

  it('the 21st device ever answers claim_cap', async () => {
    const clock = { t: 0 };
    const w = swappableHarness(T0, clock);
    const { cookie } = await seedWalletMember(w.h.db, 'm1', T0);
    clock.t = T0;
    const go = (n: number) => w.h.call('POST', '/api/account/claim', { cookie, body: claimBody({}, n) });
    for (let i = 1; i <= 20; i++) {
      expect((await go(i)).status, `device ${i}`).toBe(200);
      if (i % 5 === 0) clock.t += DAY;
    }
    const r = await go(21);
    expect([r.status, await r.json()]).toEqual([409, { error: 'claim_cap' }]);
    expect((await w.h.db.prepare('SELECT COUNT(*) AS n FROM device_claim').first<{ n: number }>())?.n).toBe(20);
    // A device already on the list still answers its stored result.
    expect((await go(3)).status).toBe(200);
  });

  it('claim_input_is_bounded', async () => {
    const s = setup();
    const cookie = await member(s);
    const before = await memberRows(s);
    const slots = Array.from({ length: 33 }, (_, i) => ({ id: `s${i}`, slot: slotOf(`s${i}`, i) }));
    const bad = [
      claimBody({ slots }),
      claimBody({ coupons: Array.from({ length: 17 }, (_, i) => `c${i}`) }),
      claimBody({ device: 'd'.repeat(200) }),
      claimBody({ device: 'not a uuid' }),
      { ...claimBody({}), slots: 'no' },
      { ...claimBody({}), coupons: [1] },
    ];
    for (const b of bad) {
      const r = await s.h.call('POST', '/api/account/claim', { cookie, body: b });
      expect([r.status, await r.json()]).toEqual([400, { error: 'body' }]);
    }
    expect(await memberRows(s)).toEqual(before);
    // 32 slots and 16 coupon ids pass; an unknown coupon id is absent from the answer.
    const okBody = claimBody({ slots: slots.slice(0, 32), coupons: [...Array.from({ length: 15 }, (_, i) => `unknown${i}`), COIN_ID] });
    const r = await ok(await s.h.call('POST', '/api/account/claim', { cookie, body: okBody }));
    expect(r.coupons.map((c) => c.id)).toEqual([COIN_ID]);
  });

  it('claimed_credit_coupon_is_used', async () => {
    const s = setup();
    const cookie = await member(s);
    const brigade = { ...emptyAccount(), coupons: [CREDIT_ID] };
    const r = await ok(await claim(s, cookie, { campaign: campaignOf([], brigade), coupons: [CREDIT_ID, COIN_ID] }));
    expect(r.coins).toBe(800);
    const usedIds = (await s.h.db.prepare('SELECT coupon_id FROM coupon_use').all<{ coupon_id: string }>()).results.map((x) => x.coupon_id);
    expect(usedIds).toEqual([CREDIT_ID]);
    const red = await s.h.call('POST', '/api/account/coupon', { cookie, body: { op_id: op(), code: CODE } });
    const j = (await red.json()) as { result: string; coins: number; credits: number };
    expect([j.result, j.coins, j.credits]).toEqual(['ok', 99_200, 0]);
  });

  it('a claim whose campaign is malformed or oversized is rejected, and still never pays beyond the table', async () => {
    const s = setup();
    const cookie = await member(s);
    const a = await ok(await claim(s, cookie, { campaign: { ledger: 5 } }, 1));
    expect(a.campaign).toEqual({ deviceId: 'campaign', status: 'rejected', reason: 'invalid' });
    const big = await ok(await claim(s, cookie, { campaign: { ledger: { 'campaign.completed_missions': Array.from({ length: 30_000 }, (_, i) => `mission_${i}_padding`) }, brigade: emptyAccount(), tutorialDone: false } }, 2));
    expect(big.campaign).toEqual({ deviceId: 'campaign', status: 'rejected', reason: 'size' });
    expect(await count(s, 'campaign_state')).toBe(0);
  });

  describe('races and guards', () => {
    const seedDevices = async (s: S, n: number) => {
      for (let i = 0; i < n; i++) await s.h.db.prepare("INSERT INTO device_claim (member_id, device_id, at, result) VALUES ('m1', ?1, 1, '{}')").bind(`seed-${i}`).run();
    };

    it('the device-cap race: two new devices at 19 rows, one wins', async () => {
      const s = setup({ race: 2 });
      const cookie = await member(s);
      await seedDevices(s, 19);
      const [a, b] = await Promise.all([claim(s, cookie, {}, 1), claim(s, cookie, {}, 2)]);
      expect(s.racing()?.opened()).toBe(true);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(await (a.status === 409 ? a : b).json()).toEqual({ error: 'claim_cap' });
      expect(await count(s, 'device_claim')).toBe(20);
    });

    it('the device guard alone stops a 21st row that raced past the count read', async () => {
      // The 20th row lands AFTER the claim read 19 (no wallet change, so the wallet guard cannot catch it).
      const s = setup({ hook: async (db) => { await db.prepare("INSERT INTO device_claim (member_id, device_id, at, result) VALUES ('m1', 'sneak', 1, '{}')").run(); } });
      const cookie = await member(s);
      await seedDevices(s, 19);
      const r = await claim(s, cookie, {}, 1);
      expect([r.status, await r.json()]).toEqual([409, { error: 'claim_cap' }]);
      expect(await count(s, 'device_claim')).toBe(20);
      expect(await freeOf(s)).toBe(0);
    });

    it('a racing slot guard re-reads: the overflow is rejected cap and the claim answers 200 (R24)', async () => {
      // Six player slots land after the claim read none: 8 + 6 > 12.
      const s = setup({
        hook: async (db) => {
          for (let i = 0; i < 6; i++) await db.prepare("INSERT INTO save_slot (member_id, slot_id, name, saved_at, build, origin, body, bytes) VALUES ('m1', ?1, 'x', 1, 'b', 'player', '{}', 2)").bind(`p${i}`).run();
        },
      });
      const cookie = await member(s);
      const slots = Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, slot: slotOf(`d${i}`, i + 1) }));
      const r = await ok(await claim(s, cookie, { slots, campaign: campaignOf([[M1, 1]]) }));
      // Six rooms are left: the newest six are stored, the two oldest are rejected cap.
      expect(r.slots.filter((x) => x.status === 'stored')).toHaveLength(6);
      expect(r.slots.filter((x) => x.status === 'rejected').map((x) => [x.deviceId, x.reason]).sort()).toEqual([['d0', 'cap'], ['d1', 'cap']]);
      expect(await count(s, "save_slot WHERE origin = 'player'")).toBe(12);
      expect(await count(s, 'device_claim')).toBe(1);
      expect(await freeOf(s)).toBe(115);
      // The claim budget was charged once, not once per attempt.
      expect((await one<{ n: number }>(s, "SELECT n FROM rate_day WHERE scope = 'acct-claim'")).n).toBe(1);
    });

    it('two claims racing at acct-claim 4: one takes the last unit, the other is 429 (the bump is a guard)', async () => {
      const s = setup({ claimCountBarrier: true });
      const cookie = await member(s);
      await s.h.db.prepare("INSERT INTO rate_day (scope, key, day, n) VALUES ('acct-claim', 'm1', ?1, 4)").bind(Math.floor(T0 / DAY)).run();
      const [a, b] = await Promise.all([claim(s, cookie, {}, 1), claim(s, cookie, {}, 2)]);
      expect([a.status, b.status].sort()).toEqual([200, 429]);
      expect((await one<{ n: number }>(s, "SELECT n FROM rate_day WHERE scope = 'acct-claim'")).n).toBe(5);
      expect(await count(s, 'device_claim')).toBe(1);
    });

    it('acct-claim is bumped only after the member budget passes', async () => {
      const s = setup();
      const cookie = await member(s);
      await s.h.db.prepare("INSERT INTO rate_day (scope, key, day, n) VALUES ('acct-ops', 'm1', ?1, 100000)").bind(Math.floor(T0 / DAY)).run();
      const r = await claim(s, cookie, {});
      expect(r.status).toBe(429);
      expect(await count(s, "rate_day WHERE scope = 'acct-claim'")).toBe(0);
      expect(await count(s, 'device_claim')).toBe(0);
    });

    it('two claims of one member from two devices pay the earn once (the wallet guard serialises them)', async () => {
      const s = setup({ race: 2 });
      const cookie = await member(s);
      const led = campaignOf([[M1, 1], [M2, 2]]);
      const [a, b] = await Promise.all([claim(s, cookie, { campaign: led }, 1), claim(s, cookie, { campaign: led }, 2)]);
      expect(s.racing()?.opened()).toBe(true);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(await freeOf(s)).toBe(135);
      expect(await sumOf(s)).toBe(135);
      expect(await count(s, 'device_claim')).toBe(2);
    });
  });
});
