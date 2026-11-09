import { parseWorld, worldMissionIds } from '@lions/economy';
import { world } from '@lions/data';
import { describe, expect, it } from 'vitest';
import { handleAccount } from './routes';
import { accountHarness, failingD1, seedWalletMember } from './test-kit';

const DAY = 86_400_000;
const T0 = 20_000 * DAY + 3_600_000;
const [M1 = '', M2 = ''] = worldMissionIds(parseWorld(world));
const op = (n: number): string => `${String(n).padStart(8, '0')}-4444-4444-8444-444444444444`;
const BODY = { ledger: {}, brigade: {}, tutorialDone: false };

/** A harness whose clock the test moves, and whose win floors it may set (R4). */
function setup(opts: { floors?: Record<string, number>; failWallet?: boolean } = {}) {
  const clock = { now: T0 };
  const h = accountHarness({
    now: T0,
    handler: (req, env, now) =>
      handleAccount(req, opts.failWallet === true ? { ...env, ACCOUNTS: failingD1(env.ACCOUNTS, /UPDATE wallet/) } : env, clock.now || now, {
        fetch: async () => new Response('no', { status: 500 }),
        ...(opts.floors !== undefined ? { minWinSeconds: opts.floors } : {}),
      }),
  });
  return { h, clock };
}
type S = ReturnType<typeof setup>;

const start = (s: S, cookie: string, n: number, mission = M1) => s.h.call('POST', '/api/account/mission/start', { cookie, body: { op_id: op(n), missionId: mission } });
const win = (s: S, cookie: string, n: number, o: { start?: number | null; stars?: number; base?: number; campaign?: unknown; mission?: string } = {}) =>
  s.h.call('POST', '/api/account/victory', {
    cookie,
    body: {
      op_id: op(n),
      missionId: o.mission ?? M1,
      stars: o.stars ?? 2,
      start: o.start === null ? null : op(o.start ?? n - 1),
      base: o.base ?? 0,
      campaign: o.campaign === undefined ? null : o.campaign,
    },
  });
const seedCampaign = (s: S, revision: number) =>
  s.h.db.prepare("INSERT INTO campaign_state (member_id, ledger, brigade, bytes, revision, updated_at) VALUES ('m1','{}','{}',4,?1,1)").bind(revision).run();

async function snapshot(s: S) {
  const q = async (sql: string) => (await s.h.db.prepare(sql).all()).results;
  return {
    campaign: await q('SELECT * FROM campaign_state'),
    wallet: await q('SELECT * FROM wallet'),
    journal: await q('SELECT * FROM coin_journal'),
    ops: await q('SELECT member_id, op_id, kind FROM account_op'),
  };
}
const freeOf = async (s: S): Promise<number> => (await s.h.db.prepare('SELECT free FROM wallet').first<{ free: number }>())?.free ?? -1;
const lifetimeOf = async (s: S) => JSON.parse((await s.h.db.prepare('SELECT earn_lifetime AS e FROM wallet').first<{ e: string }>())?.e ?? '{}') as { missions: Record<string, { won: boolean; stars: number }> };
const journalSum = async (s: S): Promise<number> => (await s.h.db.prepare('SELECT COALESCE(SUM(free_delta),0) AS n FROM coin_journal').first<{ n: number }>())?.n ?? -1;

async function member(s: S) {
  return (await seedWalletMember(s.h.db, 'm1', T0)).cookie;
}
const MIN = 120_000;

describe('mission/start', () => {
  it('refuses a mission off the world with 400 mission', async () => {
    const s = setup();
    const cookie = await member(s);
    const r = await start(s, cookie, 1, 'not_a_mission');
    expect([r.status, await r.json()]).toEqual([400, { error: 'mission' }]);
    expect((await snapshot(s)).ops).toEqual([]);
  });

  it('answers { start, missionId, at } and a replay answers the same after the nonce is used', async () => {
    const s = setup();
    const cookie = await member(s);
    const a = await start(s, cookie, 1);
    expect([a.status, await a.json()]).toEqual([200, { start: op(1), missionId: M1, at: T0 }]);
    s.clock.now = T0 + MIN;
    expect((await win(s, cookie, 2, { start: 1 })).status).toBe(200);
    const again = await start(s, cookie, 1);
    expect([again.status, await again.json()]).toEqual([200, { start: op(1), missionId: M1, at: T0 }]);
  });
});

describe('victory', () => {
  it('A2-6 earn_is_lifetime: 120, then 0 for a repeat, then 5 for a third star', async () => {
    const s = setup();
    const cookie = await member(s);
    await start(s, cookie, 1);
    s.clock.now = T0 + MIN;
    const first = await (await win(s, cookie, 2, { start: 1, stars: 2 })).json() as { coins: number };
    expect(first.coins).toBe(120);
    expect(await freeOf(s)).toBe(120);
    await start(s, cookie, 3);
    s.clock.now += MIN;
    expect(((await (await win(s, cookie, 4, { start: 3, stars: 2 })).json()) as { coins: number }).coins).toBe(0);
    await start(s, cookie, 5);
    s.clock.now += MIN;
    expect(((await (await win(s, cookie, 6, { start: 5, stars: 3 })).json()) as { coins: number }).coins).toBe(5);
    expect(await freeOf(s)).toBe(125);
    expect(await journalSum(s)).toBe(125);
    expect((await lifetimeOf(s)).missions[M1]).toEqual({ won: true, stars: 3 });
  });

  it('A2-9 victory_is_all_or_none: a failure at the wallet leaves the campaign, wallet, journal and ops as they were', async () => {
    const s = setup({ failWallet: true });
    const cookie = await member(s);
    await seedCampaign(s, 3);
    await start(s, cookie, 1);
    s.clock.now = T0 + MIN;
    const before = await snapshot(s);
    await expect(win(s, cookie, 2, { start: 1, base: 3, campaign: BODY })).rejects.toThrow(/injected failure/);
    expect(await snapshot(s)).toEqual(before);
    expect((before.campaign[0] as { revision: number }).revision).toBe(3);
  });

  it('A2-16 the_floor_withholds_coins: 59 s records the ledger and pays nothing, 60 s pays', async () => {
    const s = setup({ floors: { [M1]: 60 } });
    const cookie = await member(s);
    await seedCampaign(s, 3);
    await start(s, cookie, 1);
    s.clock.now = T0 + 59_000;
    const walletBefore = (await snapshot(s)).wallet;
    const early = await (await win(s, cookie, 2, { start: 1, base: 3, campaign: BODY })).json() as { coins: number; campaign: { revision: number } };
    expect(early.coins).toBe(0);
    expect(early.campaign.revision).toBe(4);
    expect((await s.h.db.prepare('SELECT revision FROM campaign_state').first<{ revision: number }>())?.revision).toBe(4);
    expect((await snapshot(s)).wallet).toEqual(walletBefore);
    expect(await freeOf(s)).toBe(0);
    s.clock.now = T0 + 60_000;
    const late = await (await win(s, cookie, 3, { start: 1, base: 4, campaign: BODY })).json() as { coins: number };
    expect(late.coins).toBe(120);
  });

  it('A2-33 no_nonce_defers_the_coins: start null records the ledger and pays 0; a later win pays in full', async () => {
    const s = setup();
    const cookie = await member(s);
    s.clock.now = T0 + MIN;
    const offline = await (await win(s, cookie, 1, { start: null, stars: 0, base: 0, campaign: BODY })).json() as { coins: number; campaign: { revision: number } };
    expect(offline.coins).toBe(0);
    expect(offline.campaign.revision).toBe(1);
    expect(await freeOf(s)).toBe(0);
    expect((await lifetimeOf(s)).missions[M1]).toBeUndefined();
    s.clock.now = T0 + 2 * MIN;
    await start(s, cookie, 2);
    s.clock.now = T0 + 3 * MIN;
    const online = await (await win(s, cookie, 3, { start: 2, stars: 0, base: 1, campaign: BODY })).json() as { coins: number };
    expect(online.coins).toBe(110);
  });

  it('a_nonce_is_used_once: two victories on one start pay once', async () => {
    const s = setup();
    const cookie = await member(s);
    await start(s, cookie, 1);
    s.clock.now = T0 + MIN;
    expect(((await (await win(s, cookie, 2, { start: 1 })).json()) as { coins: number }).coins).toBe(120);
    expect(((await (await win(s, cookie, 3, { start: 1, stars: 3 })).json()) as { coins: number }).coins).toBe(0);
    expect(await freeOf(s)).toBe(120);
    expect((await s.h.db.prepare("SELECT kind FROM account_op WHERE op_id = ?1").bind(op(1)).first<{ kind: string }>())?.kind).toBe('mission.start.used');
  });

  it('a_nonce_for_another_mission_pays_nothing', async () => {
    const s = setup();
    const cookie = await member(s);
    await start(s, cookie, 1, M2);
    s.clock.now = T0 + MIN;
    expect(((await (await win(s, cookie, 2, { start: 1, mission: M1 })).json()) as { coins: number }).coins).toBe(0);
    expect(await freeOf(s)).toBe(0);
  });

  it('a nonce older than the age limit pays nothing', async () => {
    const s = setup();
    const cookie = await member(s);
    await start(s, cookie, 1);
    s.clock.now = T0 + 7 * DAY + 1;
    const stale = await (await win(s, cookie, 2, { start: 1 })).json() as { coins: number };
    expect(stale.coins).toBe(0);
    s.clock.now = T0 + 7 * DAY;
    expect(((await (await win(s, cookie, 3, { start: 1 })).json()) as { coins: number }).coins).toBe(120);
  });

  it('a_stale_victory_still_pays (§0.20): coins paid, conflict slot, server campaign unchanged', async () => {
    const s = setup();
    const cookie = await member(s);
    await seedCampaign(s, 3);
    await start(s, cookie, 1);
    s.clock.now = T0 + MIN;
    const r = await win(s, cookie, 2, { start: 1, base: 2, campaign: { ...BODY, tutorialDone: true } });
    const out = await r.json() as { coins: number; conflict: { slot: { origin: string } } };
    expect([r.status, out.coins, out.conflict.slot.origin]).toEqual([200, 120, 'conflict']);
    const row = await s.h.db.prepare('SELECT revision, tutorial_done FROM campaign_state').first<{ revision: number; tutorial_done: number }>();
    expect(row).toEqual({ revision: 3, tutorial_done: 0 });
    expect((await s.h.db.prepare("SELECT COUNT(*) AS n FROM save_slot WHERE origin = 'conflict'").first<{ n: number }>())?.n).toBe(1);
  });

  it('a_retried_victory_answers_once: the same op id gives the same body and one set of journal rows', async () => {
    const s = setup();
    const cookie = await member(s);
    await start(s, cookie, 1);
    s.clock.now = T0 + MIN;
    const a = await win(s, cookie, 2, { start: 1 });
    const first = await a.json();
    const rows = (await snapshot(s)).journal.length;
    expect(rows).toBe(3);
    const b = await win(s, cookie, 2, { start: 1 });
    expect([b.status, await b.json()]).toEqual([200, first]);
    expect((await snapshot(s)).journal.length).toBe(3);
    expect(await journalSum(s)).toBe(120);
  });

  it('refuses a malformed body with 400 and writes nothing', async () => {
    const s = setup();
    const cookie = await member(s);
    const r = await s.h.call('POST', '/api/account/victory', { cookie, body: { op_id: op(1), missionId: M1, stars: 'x', start: null, base: 0, campaign: null } });
    expect([r.status, await r.json()]).toEqual([400, { error: 'body' }]);
    expect((await snapshot(s)).ops).toEqual([]);
  });
});
