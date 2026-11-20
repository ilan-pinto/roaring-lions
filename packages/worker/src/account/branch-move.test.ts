/**
 * GH-1384 §4.2, §4.3, the member's one-time Switch and Return, with the branch switch FLIPPED OPEN (`vi.mock` of the one module that
 * holds it). Every oracle is a literal: the Lavi's firepower forks at tier 3 and costs 950 credits, `coinPrice(950)` is 95 coins.
 * `branch-move-closed.test.ts` holds the switch as shipped: the routes do not exist.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../data/src/branches-open', () => ({ BRANCHES_OPEN: true }));

const { BRANCHES_OPEN } = await import('@lions/data/branches-open');
const { accountHarness, seedWalletMember } = await import('./test-kit');
const { handleAccount } = await import('./routes');
import type { D1Like, D1Stmt } from '../d1';

const DAY = 86_400_000;
const T0 = 20_000 * DAY + 3_600_000;
let seq = 1;
const op = (): string => `${String(seq++).padStart(8, '0')}-6666-4666-8666-666666666666`;
type H = ReturnType<typeof accountHarness>;

const COIN_LEGACY = { tier: 3, paidTiers: 0 };
const GRANTS = [{ source: 'earned', amount: 2000, missionId: 'beit_sahwan_1_outskirts', at: 1 }];

/** A member whose wallet holds `coin` as the Lavi's firepower entitlement and whose campaign holds the account at `tier` (null: no campaign row). */
async function seed(o: { coin?: object | null; account?: { tier: number; extra?: object } | null; receiptFree?: number; beforeFirstBatch?: (db: D1Like) => Promise<void> } = {}) {
  const hook = o.beforeFirstBatch;
  const h = accountHarness({
    now: T0,
    handler: (req, env, at) => {
      let db: D1Like = env.ACCOUNTS;
      if (hook !== undefined) {
        const inner = db;
        let fired = false;
        db = { ...inner, prepare: (q: string) => inner.prepare(q), batch: async (ss: D1Stmt[]) => { if (!fired && ss.length > 1) { fired = true; await hook(inner); } return inner.batch(ss); } };
      }
      return handleAccount(req, { ...env, ACCOUNTS: db }, at, { fetch: async () => new Response('no', { status: 500 }) });
    },
  });
  const { cookie } = await seedWalletMember(h.db, 'm1', T0, { free: 200 });
  if (o.coin !== null) {
    const ent = { units: { mbt_lavi: { free: true } }, upgrades: { mbt_lavi: { firepower: o.coin ?? COIN_LEGACY } } };
    await h.db.prepare('UPDATE wallet SET entitlements = ?1 WHERE member_id = ?2').bind(JSON.stringify(ent), 'm1').run();
  }
  if (o.receiptFree !== undefined) {
    const receipt = { kind: 'tier', id: '1-1', at: 1, coins: { free: o.receiptFree, paid: 0 }, unitId: 'mbt_lavi', track: 'firepower', tier: 3, credits: 950 };
    await h.db.prepare("INSERT INTO coin_journal (member_id, at, kind, free_delta, detail, op_id) VALUES ('m1', 1, 'tier', 0, ?1, 'old-buy')").bind(JSON.stringify({ receipt })).run();
  }
  if (o.account !== null) {
    const a = o.account ?? { tier: 3 };
    const brigade = { balance: 0, earned_total: 2000, grants: GRANTS, upgrades: { mbt_lavi: { firepower: a.tier } }, ...(a.extra ?? {}) };
    await h.db.prepare("INSERT INTO campaign_state (member_id, ledger, brigade, bytes, revision, updated_at) VALUES ('m1', '{}', ?1, 10, 1, 1)").bind(JSON.stringify(brigade)).run();
  }
  return { h, cookie };
}
const post = (h: H, cookie: string | undefined, which: 'switch' | 'return', body: object = { unitId: 'mbt_lavi', track: 'firepower' }, id = op()) =>
  h.call('POST', `/api/account/branch/${which}`, { ...(cookie === undefined ? {} : { cookie }), body: { op_id: id, ...body } });
const first = async <R>(h: H, sql: string) => (await h.db.prepare(sql).first<R>()) as R;
const wallet = async (h: H) => {
  const w = await first<{ free: number; entitlements: string; revision: number }>(h, 'SELECT free, entitlements, revision FROM wallet');
  return { free: w.free, revision: w.revision, firepower: (JSON.parse(w.entitlements) as { upgrades: { mbt_lavi: { firepower: Record<string, unknown> } } }).upgrades.mbt_lavi.firepower };
};
const brigade = async (h: H) => JSON.parse((await first<{ brigade: string }>(h, 'SELECT brigade FROM campaign_state')).brigade) as { balance: number; upgrades: { mbt_lavi: { firepower: number } }; picks?: Record<string, Record<string, number>>; legacy?: object; earned_total: number };
const campRevision = async (h: H) => (await first<{ revision: number }>(h, 'SELECT revision FROM campaign_state')).revision;
const journal = async (h: H) => (await h.db.prepare('SELECT kind, free_delta AS d, detail FROM coin_journal ORDER BY id').all<{ kind: string; d: number; detail: string }>()).results.map((r) => ({ kind: r.kind, d: r.d, detail: JSON.parse(r.detail) as Record<string, unknown> }));
const sum = async (h: H) => (await first<{ s: number }>(h, 'SELECT COALESCE(SUM(free_delta), 0) AS s FROM coin_journal')).s;

describe('Return, both stores holding the legacy tier 3', () => {
  it('the flip reached the Worker', () => {
    expect(BRANCHES_OPEN).toBe(true);
  });

  it('refunds 950 credits and, with no receipt to read, coinPrice(950) = 95 coins; both stores drop to tier 2; one refund row, and the journal still sums to the wallet', async () => {
    const { h, cookie } = await seed();
    const r = await post(h, cookie, 'return');
    expect(r.status).toBe(200);
    const w = await wallet(h);
    expect([w.free, w.firepower]).toEqual([295, { tier: 2, paidTiers: 0 }]);
    const b = await brigade(h);
    expect([b.balance, b.earned_total, b.upgrades.mbt_lavi.firepower, b.picks, b.legacy]).toEqual([950, 2000, 2, {}, {}]);
    const rows = (await journal(h)).filter((x) => x.kind === 'tier');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ d: 95, detail: { unitId: 'mbt_lavi', track: 'firepower', tier: 3, refund: true, receipt: { kind: 'tier', refund: true, tier: 3, coins: { free: 95, paid: 0 } } } });
    expect(await sum(h)).toBe(w.free);
    expect(await campRevision(h)).toBe(2);
    expect(await r.json()).toMatchObject({ refund: { credits: 950, coins: { free: 95, paid: 0 } }, wallet: { free: 295 }, campaign: { revision: 2 } });
  });

  it('prices the coins from the SERVER\'s journal when it holds the purchase: an 80-coin buy refunds 80, not 95', async () => {
    const { h, cookie } = await seed({ receiptFree: 80 });
    expect((await post(h, cookie, 'return')).status).toBe(200);
    expect((await wallet(h)).free).toBe(280);
    expect((await journal(h)).filter((x) => x.kind === 'tier' && x.detail.refund === true)).toMatchObject([{ d: 80 }]);
  });

  it('a second Return is refused (the marker is gone) and changes nothing', async () => {
    const { h, cookie } = await seed();
    await post(h, cookie, 'return');
    const before = [await wallet(h), await brigade(h), (await journal(h)).length];
    const r = await post(h, cookie, 'return');
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toBe('refused');
    expect([await wallet(h), await brigade(h), (await journal(h)).length]).toEqual(before);
  });

  it('a retry of the same op replays the stored answer: one refund, not two', async () => {
    const { h, cookie } = await seed();
    const id = op();
    const a = await post(h, cookie, 'return', undefined, id);
    const b = await post(h, cookie, 'return', undefined, id);
    expect([a.status, b.status]).toEqual([200, 200]);
    // The stored answer keeps the campaign by its revision and digest, as every op's replay does.
    const [x, y] = [(await a.json()) as { wallet: unknown; refund: unknown; campaign: { revision: number; digest: string } }, (await b.json()) as { wallet: unknown; refund: unknown; campaign: { revision: number; digest: string } }];
    expect([y.wallet, y.refund, y.campaign.revision, y.campaign.digest]).toEqual([x.wallet, x.refund, x.campaign.revision, x.campaign.digest]);
    expect([(await wallet(h)).free, (await brigade(h)).balance, (await journal(h)).filter((x) => x.kind === 'tier').length]).toEqual([295, 950, 1]);
  });
});

describe('Return on a mix of legacy and fresh (R12)', () => {
  it('refunds the legacy account store and leaves the fresh coin branch exactly as it was', async () => {
    const { h, cookie } = await seed({ coin: { tier: 3, paidTiers: 0, branch: 2 } });
    expect((await post(h, cookie, 'return')).status).toBe(200);
    expect(await wallet(h)).toMatchObject({ free: 200, firepower: { tier: 3, paidTiers: 0, branch: 2 } });
    expect((await brigade(h)).balance).toBe(950);
    expect((await journal(h)).filter((x) => x.kind === 'tier')).toEqual([]);
  });

  it('a FRESH store alone has nothing to return: refused, nothing changes', async () => {
    const { h, cookie } = await seed({ coin: { tier: 3, paidTiers: 0, branch: 2 }, account: { tier: 3, extra: { picks: { mbt_lavi: { firepower: 2 } } } } });
    const before = [await wallet(h), await brigade(h)];
    expect((await post(h, cookie, 'return')).status).toBe(409);
    expect([await wallet(h), await brigade(h)]).toEqual(before);
  });
});

describe('Switch', () => {
  it('moves both legacy stores to the other branch, clears both markers, and writes no journal row', async () => {
    const { h, cookie } = await seed();
    const rows = (await journal(h)).length;
    expect((await post(h, cookie, 'switch')).status).toBe(200);
    expect((await wallet(h)).firepower).toEqual({ tier: 3, paidTiers: 0, branch: 2 });
    const b = await brigade(h);
    expect([b.picks, b.legacy, b.upgrades.mbt_lavi.firepower, b.balance]).toEqual([{ mbt_lavi: { firepower: 2 } }, {}, 3, 0]);
    expect((await journal(h)).length).toBe(rows);
    expect(await sum(h)).toBe(200);
  });

  it('is withheld on a mix of legacy and fresh (it would split the picks)', async () => {
    const { h, cookie } = await seed({ coin: { tier: 3, paidTiers: 0, branch: 2 } });
    const before = [await wallet(h), await brigade(h)];
    expect((await post(h, cookie, 'switch')).status).toBe(409);
    expect([await wallet(h), await brigade(h)]).toEqual(before);
  });

  it('a Switch clears the markers, so a Return after it is refused: one choice, once', async () => {
    const { h, cookie } = await seed();
    await post(h, cookie, 'switch');
    expect((await post(h, cookie, 'return')).status).toBe(409);
  });

  it('works for a coin-only member (no campaign row): the wallet moves, no campaign row appears', async () => {
    const { h, cookie } = await seed({ account: null });
    expect((await post(h, cookie, 'switch')).status).toBe(200);
    expect((await wallet(h)).firepower).toEqual({ tier: 3, paidTiers: 0, branch: 2 });
    expect(await first<{ n: number }>(h, 'SELECT COUNT(*) AS n FROM campaign_state')).toEqual({ n: 0 });
  });
});

describe('a write that lands between the read and the batch', () => {
  const ACCOUNT_LEGACY = JSON.stringify({ balance: 0, earned_total: 2000, grants: GRANTS, upgrades: { mbt_lavi: { firepower: 3 } } });

  it('a campaign row that appears (a coin-only member signs in on a second device) trips the guard: the route re-reads and switches BOTH stores', async () => {
    const { h, cookie } = await seed({
      account: null,
      beforeFirstBatch: async (db) => { await db.prepare("INSERT INTO campaign_state (member_id, ledger, brigade, bytes, revision, updated_at) VALUES ('m1', '{}', ?1, 10, 1, 1)").bind(ACCOUNT_LEGACY).run(); },
    });
    expect((await post(h, cookie, 'switch')).status).toBe(200);
    expect((await wallet(h)).firepower).toEqual({ tier: 3, paidTiers: 0, branch: 2 });
    expect((await brigade(h)).picks).toEqual({ mbt_lavi: { firepower: 2 } });
  });

  it('a campaign write that lands after the read (another device Returned the account\'s tier 3) trips the guard and the route re-decides', async () => {
    const { h, cookie } = await seed({
      beforeFirstBatch: async (db) => {
        // Another device Returned the account's tier 3 first.
        await db.prepare("UPDATE campaign_state SET brigade = ?1, revision = revision + 1").bind(JSON.stringify({ balance: 950, earned_total: 2000, grants: GRANTS, upgrades: { mbt_lavi: { firepower: 2 } } })).run();
      },
    });
    // The re-read sees the coin store alone holding a legacy tier 3: Switch is offered and moves only that store; the account is not touched.
    expect((await post(h, cookie, 'switch')).status).toBe(200);
    expect((await wallet(h)).firepower).toEqual({ tier: 3, paidTiers: 0, branch: 2 });
    const b = await brigade(h);
    expect([b.balance, b.upgrades.mbt_lavi.firepower, b.picks]).toEqual([950, 2, undefined]);
    expect(await campRevision(h)).toBe(2);
  });
});

describe('what the route refuses', () => {
  it('no session is 401; a body with no unit or track is 400; an unbranched track, an unknown unit and an unheld tier are 409', async () => {
    const { h, cookie } = await seed();
    expect((await post(h, undefined, 'return')).status).toBe(401);
    expect((await post(h, cookie, 'return', { track: 'firepower' })).status).toBe(400);
    expect((await post(h, cookie, 'return', { unitId: 'mbt_lavi', track: 'a b' })).status).toBe(400);
    for (const body of [{ unitId: 'mbt_lavi', track: 'armour' }, { unitId: 'no_such_unit', track: 'firepower' }]) {
      expect((await post(h, cookie, 'switch', body)).status).toBe(409);
      expect((await post(h, cookie, 'return', body)).status).toBe(409);
    }
    const { h: h2, cookie: c2 } = await seed({ coin: { tier: 2, paidTiers: 0 }, account: { tier: 2 } });
    expect((await post(h2, c2, 'return')).status).toBe(409);
  });
});

describe('the member\'s coin history reads the refund row', () => {
  it('a Return is a `tier` row marked `refund: true` with a positive amount; a purchase row carries no such key', async () => {
    const { h, cookie } = await seed();
    await h.db.prepare("INSERT INTO coin_journal (member_id, at, kind, free_delta, detail, op_id) VALUES ('m1', 2, 'tier', -45, ?1, 'older-buy')").bind(JSON.stringify({ unitId: 'mbt_lavi', track: 'firepower', tier: 2 })).run();
    await post(h, cookie, 'return');
    const r = (await (await h.call('GET', '/api/account/coins', { cookie })).json()) as { rows: { delta: number; what: Record<string, unknown> }[] };
    const tiers = r.rows.filter((x) => x.what.kind === 'tier');
    expect(tiers).toEqual([
      { at: expect.any(Number), delta: 95, what: { kind: 'tier', unitId: 'mbt_lavi', track: 'firepower', tier: 3, moved: false, refund: true } },
      { at: 2, delta: -45, what: { kind: 'tier', unitId: 'mbt_lavi', track: 'firepower', tier: 2, moved: false } },
    ]);
  });
});

// The PR 1664 review: a credits-only legacy owner (the campaign holds the branched tier with its marker, the wallet holds no tier on
// the track) through the whole one-time choice, with PR 1664's rule in force behind it: a campaign PUT never moves a stored pick.
describe('a credits-only legacy owner: Switch, then Return, then a PUT with the old pick (PR 1664)', () => {
  const entitlements = async (h: H) => JSON.parse((await first<{ e: string }>(h, 'SELECT entitlements AS e FROM wallet')).e) as unknown;
  const putCampaign = (h: H, cookie: string, base: number, b: object) => h.call('PUT', '/api/account/campaign', { cookie, body: { op_id: op(), base, ...b } });

  it('Switch is 200 and moves the account to pick 2 with no marker, the wallet untouched; Return is then 409; a PUT sending pick 1 and the marker keeps pick 2', async () => {
    const { h, cookie } = await seed({ coin: null, account: { tier: 3, extra: { picks: { mbt_lavi: { firepower: 1 } }, legacy: { mbt_lavi: { firepower: true } } } } });
    const ents = await entitlements(h);
    expect(JSON.stringify(ents)).not.toContain('firepower'); // the wallet holds no tier on the track: credits only
    const rows = (await journal(h)).length;

    const s = await post(h, cookie, 'switch');
    expect(s.status).toBe(200);
    const b = await brigade(h);
    expect([b.picks, b.legacy, b.upgrades.mbt_lavi.firepower, b.balance]).toEqual([{ mbt_lavi: { firepower: 2 } }, {}, 3, 0]);
    expect(await entitlements(h)).toEqual(ents);
    expect((await first<{ free: number }>(h, 'SELECT free FROM wallet')).free).toBe(200);
    expect((await journal(h)).length).toBe(rows);
    expect(await campRevision(h)).toBe(2);

    const r = await post(h, cookie, 'return');
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toBe('refused');
    expect(await brigade(h)).toEqual(b);
    expect(await entitlements(h)).toEqual(ents);

    // An older device still holding the pre-Switch body sends pick 1 and the marker back at the current revision: written, and kept.
    const p = await putCampaign(h, cookie, 2, { ledger: {}, brigade: { ...b, picks: { mbt_lavi: { firepower: 1 } }, legacy: { mbt_lavi: { firepower: true } } }, tutorialDone: false });
    expect(p.status).toBe(200);
    const answered = ((await p.json()) as { campaign: { brigade: { picks?: unknown; legacy?: unknown } } }).campaign.brigade;
    expect([answered.picks, answered.legacy]).toEqual([{ mbt_lavi: { firepower: 2 } }, {}]);
    const after = await brigade(h);
    expect([after.picks, after.legacy]).toEqual([{ mbt_lavi: { firepower: 2 } }, {}]);
    expect(await campRevision(h)).toBe(3);
    expect((await post(h, cookie, 'switch')).status).toBe(409); // the choice was made once; the PUT did not hand it back
  });

  it('a coin and campaign owner: after the route Switch, a PUT with the old pick and marker keeps pick 2 and leaves the wallet on branch 2', async () => {
    const { h, cookie } = await seed();
    expect((await post(h, cookie, 'switch')).status).toBe(200);
    const b = await brigade(h);
    const p = await putCampaign(h, cookie, 2, { ledger: {}, brigade: { ...b, picks: { mbt_lavi: { firepower: 1 } }, legacy: { mbt_lavi: { firepower: true } } }, tutorialDone: false });
    expect(p.status).toBe(200);
    const after = await brigade(h);
    expect([after.picks, after.legacy]).toEqual([{ mbt_lavi: { firepower: 2 } }, {}]);
    expect((await wallet(h)).firepower).toEqual({ tier: 3, paidTiers: 0, branch: 2 });
  });
});
