import { describe, expect, it } from 'vitest';
import type { D1Like, D1Stmt } from '../d1';
import { dayOf } from '../rate-day';
import { OP_TTL_MS, PENDING_TTL_MS, SESSION_COOKIE, STEAM_OP, preCookieName } from './config';
import { deleteMember } from './delete';
import { memoryKV } from './kv';
import { MEMBER_IDLE_DAYS, RECONCILE_CURSOR_KEY, accountCron, reconcileTombstones, sweepAccounts } from './sweep';
import { accountHarness, steamStub } from './test-kit';

const DAY = 86_400_000;
const NOW = 20_000 * DAY + 3_600_000;
const CUTOFF = dayOf(NOW) - MEMBER_IDLE_DAYS - 1;
const ORIGIN = 'https://roaring-lions.pint12.workers.dev';
const STEAM = '76561197960287930';

type H = ReturnType<typeof accountHarness>;
const n = async (db: D1Like, sql: string): Promise<number> =>
  (await db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).first<{ n: number }>())?.n ?? -1;

async function member(h: H, id: string, lastSeen: number, steam?: string): Promise<void> {
  await h.db.prepare('INSERT INTO member VALUES (?1, ?2, ?3, ?4, 1, ?5)').bind(id, 'PUB' + id, 'hash' + id, 'uh' + id, lastSeen).run();
  await h.db.prepare("INSERT INTO profile (member_id, display_name, show_record, updated_at) VALUES (?1, 'Name', 0, 1)").bind(id).run();
  if (steam !== undefined) {
    await h.db.prepare("INSERT INTO member_identity (id, member_id, provider, subject, created_at, last_used_day) VALUES (?1, ?2, 'steam', ?3, 1, 0)").bind('i' + id, id, steam).run();
  }
}

describe('sweepAccounts', () => {
  it('deletes the expired and keeps the live', async () => {
    const h = accountHarness({ now: NOW });
    await member(h, 'a', dayOf(NOW));
    const run = (sql: string, ...v: unknown[]) => h.db.prepare(sql).bind(...v).run();
    const sess = (hash: string, expires: number, absolute: number) =>
      run("INSERT INTO session VALUES (?1, 'a', 1, ?2, ?3, 0, 0)", hash, expires, absolute);
    await sess('dead-idle', NOW - 1, NOW + DAY);
    await sess('dead-abs', NOW + DAY, NOW - 1);
    await sess('live', NOW + DAY, NOW + DAY);
    await run("INSERT INTO auth_challenge VALUES ('c-old', 'steam-login', NULL, NULL, ?1)", NOW - 1);
    await run("INSERT INTO auth_challenge VALUES ('c-live', 'steam-login', NULL, NULL, ?1)", NOW + 1000);
    const rec = (id: string, state: string, age: number) =>
      run("INSERT INTO member_identity (id, member_id, provider, subject, state, created_at) VALUES (?1,'a','recovery',?1,?2,?3)", id, state, NOW - age);
    await rec('p-old', 'pending', PENDING_TTL_MS + DAY);
    await run("INSERT INTO member_identity (id, member_id, provider, subject, state, created_at) VALUES ('p-live','a','passkey','p-live','active',?1)", NOW - PENDING_TTL_MS - DAY);
    await run("INSERT INTO account_op VALUES ('a','op-old','k',?1,'{}')", NOW - OP_TTL_MS - DAY);
    await run("INSERT INTO account_op VALUES ('a','op-live','k',?1,'{}')", NOW - DAY);
    await run('INSERT INTO rate_day VALUES (?1, ?2, ?3, 1)', 'old', 'k', dayOf(NOW) - 5);
    await sweepAccounts(h.db, NOW, h.kv);
    const left = async (sql: string): Promise<string[]> => (await h.db.prepare(sql).all<{ x: string }>()).results.map((r) => r.x).sort();
    expect(await left('SELECT token_hash AS x FROM session')).toEqual(['live']);
    expect(await left('SELECT challenge_hash AS x FROM auth_challenge')).toEqual(['c-live']);
    expect(await left('SELECT id AS x FROM member_identity')).toEqual(['p-live']);
    expect(await left('SELECT op_id AS x FROM account_op')).toEqual(['op-live']);
    expect(await n(h.db, "SELECT 1 FROM rate_day WHERE scope = 'old'")).toBe(0);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'a'")).toBe(1);
  });

  it('the expiry instant itself is expired, as resolveSession reads it: swept at ==, kept a millisecond short (A1 follow-up 4)', async () => {
    const h = accountHarness({ now: NOW });
    await member(h, 'a', dayOf(NOW));
    const run = (sql: string, ...v: unknown[]) => h.db.prepare(sql).bind(...v).run();
    await run("INSERT INTO session VALUES ('idle-at', 'a', 1, ?1, ?2, 0, 0)", NOW, NOW + DAY);
    await run("INSERT INTO session VALUES ('abs-at', 'a', 1, ?2, ?1, 0, 0)", NOW, NOW + DAY);
    await run("INSERT INTO session VALUES ('short', 'a', 1, ?1, ?1, 0, 0)", NOW + 1);
    await run("INSERT INTO auth_challenge VALUES ('c-at', 'steam-login', NULL, NULL, ?1)", NOW);
    await run("INSERT INTO auth_challenge VALUES ('c-short', 'steam-login', NULL, NULL, ?1)", NOW + 1);
    await sweepAccounts(h.db, NOW, h.kv);
    const left = async (sql: string): Promise<string[]> => (await h.db.prepare(sql).all<{ x: string }>()).results.map((r) => r.x).sort();
    expect(await left('SELECT token_hash AS x FROM session')).toEqual(['short']);
    expect(await left('SELECT challenge_hash AS x FROM auth_challenge')).toEqual(['c-short']);
  });

  it('keeps a pending code a day short of its TTL, drops one a day past', async () => {
    const h = accountHarness({ now: NOW });
    await member(h, 'a', dayOf(NOW));
    const ins = (id: string, age: number) =>
      h.db.prepare("INSERT INTO member_identity (id, member_id, provider, subject, state, created_at) VALUES (?1,'a','recovery',?1,'pending',?2)").bind(id, NOW - age).run();
    await ins('p-8d', PENDING_TTL_MS + DAY);
    await sweepAccounts(h.db, NOW, h.kv);
    expect(await n(h.db, 'SELECT 1 FROM member_identity')).toBe(0);
    await ins('p-6d', PENDING_TTL_MS - DAY);
    await sweepAccounts(h.db, NOW, h.kv);
    expect(await n(h.db, 'SELECT 1 FROM member_identity')).toBe(1);
  });

  it('deletes a member idle 1095 days and one day, keeps one idle exactly 1095 days', async () => {
    const h = accountHarness({ now: NOW, foreignKeys: true });
    await member(h, 'old', CUTOFF);
    await member(h, 'edge', CUTOFF + 1);
    await member(h, 'new', dayOf(NOW));
    expect(dayOf(NOW) - CUTOFF).toBe(1096);
    await sweepAccounts(h.db, NOW, h.kv);
    expect((await h.db.prepare('SELECT id AS x FROM member ORDER BY id').all<{ x: string }>()).results.map((r) => r.x)).toEqual(['edge', 'new']);
    expect(await n(h.db, "SELECT 1 FROM profile WHERE member_id = 'old'")).toBe(0);
    expect((await h.kv.list({ prefix: 'tomb:' })).keys.map((k) => k.name)).toEqual(['tomb:hashold']);
    expect(JSON.parse((await h.kv.get('tomb:hashold')) ?? '{}')).toEqual({ deletedAt: NOW, lastSeenDay: CUTOFF });
  });

  it('writes the tombstone before deleting: a failed put deletes nobody', async () => {
    const h = accountHarness({ now: NOW, failPut: true });
    await member(h, 'old', CUTOFF);
    await expect(sweepAccounts(h.db, NOW, h.kv)).rejects.toThrow('kv put failed');
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'old'")).toBe(1);
  });

  // The sign-in lands just before the MEMBER DELETE batch (17 statements), after the sweep has selected and tombstoned m1. It used to
  // fire on the first batch, the expiry batch, before the idle select: m1 was then never queued or tombstoned, so the final "tombstone
  // pruned" assertion held whatever the survivor step did (PR 1518 delta review, finding 3).
  it('a sign-in after the sweep selected and tombstoned the member wins, and the survivor step prunes its tombstone', async () => {
    const stub = steamStub();
    const h = accountHarness({ now: NOW, deps: stub });
    await h.db.prepare(`INSERT INTO flags VALUES ('steam','open',0)`).run();
    await member(h, 'm1', CUTOFF, STEAM);
    const start = await h.call('POST', '/api/account/steam/start', { body: { purpose: 'steam-login' } });
    expect(start.status).toBe(200);
    const url = ((await start.json()) as { url: string }).url;
    const c = new URL(new URL(url).searchParams.get('openid.return_to') ?? '').searchParams.get('c') ?? '';
    const pre = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(url.startsWith(STEAM_OP)).toBe(true);
    expect(pre.startsWith(preCookieName(c))).toBe(true);
    const claimed = `https://steamcommunity.com/openid/id/${STEAM}`;
    const q = new URLSearchParams({
      c, 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': STEAM_OP,
      'openid.claimed_id': claimed, 'openid.identity': claimed, 'openid.return_to': `${ORIGIN}/api/account/steam/return?c=${c}`,
      'openid.response_nonce': '2026-11-08T00:00:00ZabcDEF', 'openid.assoc_handle': '1234567890',
      'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle', 'openid.sig': 'c2ln',
    });
    let cookie = '';
    let raced = 0;
    const racing = beforeMemberDelete(h.db, async () => {
      raced++;
      // the sweep has queued m1 and written its tombstone: the prune asserted below has something to prune
      expect(JSON.parse((await h.kv.get('tomb:hashm1')) ?? '{}')).toEqual({ deletedAt: NOW, lastSeenDay: CUTOFF });
      const res = await h.call('GET', `/api/account/steam/return?${q.toString()}`, { cookie: pre });
      expect(new URL(res.headers.get('location') ?? '', ORIGIN).searchParams.get('r')).toBe('ok');
      cookie = res.headers.getSetCookie().map((s) => s.split(';')[0] ?? '').find((s) => s.startsWith(SESSION_COOKIE + '=')) ?? '';
    });
    await sweepAccounts(racing, NOW, h.kv);
    expect(raced).toBe(1);
    expect(await n(h.db, "SELECT last_seen_day AS d FROM member WHERE id = 'm1' AND last_seen_day > " + String(CUTOFF))).toBe(1);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'm1'")).toBe(1);
    expect(await n(h.db, "SELECT 1 FROM member_identity WHERE member_id = 'm1'")).toBe(1);
    expect(await n(h.db, "SELECT 1 FROM session WHERE member_id = 'm1'")).toBe(1);
    expect((await h.call('GET', '/api/account/me', { cookie })).status).toBe(200);
    // the cancelled deletion's tombstone is pruned, so `gone` does not call a live account deleted
    expect(await h.kv.get('tomb:hashm1')).toBeNull();
    expect(await reconcileTombstones(h.db, h.kv)).toBe(0);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'm1'")).toBe(1);
  });
});

/** Runs `hook` just before the member delete batch (17 statements) reaches the database; every other batch passes untouched. */
function beforeMemberDelete(db: D1Like, hook: () => Promise<void>): D1Like {
  return { ...db, batch: async (ss: D1Stmt[]) => { if (ss.length === 17) await hook(); return db.batch(ss); } };
}

describe('accountCron: a delete request racing the cron keeps its tombstone (PR 1518 review, finding 1)', () => {
  const today = dayOf(NOW);
  /** The route's own tombstone, as `deleteAccount` writes it for a member who signed in today. */
  const routeTomb = JSON.stringify({ deletedAt: NOW, lastSeenDay: today });

  it('race 1: a replacement delete request rewrites the tombstone with a newer day and its own batch fails; the newer tombstone survives', async () => {
    const h = accountHarness({ now: NOW, foreignKeys: true });
    await member(h, 'X', CUTOFF - 5);
    let raced = false;
    const db = beforeMemberDelete(h.db, async () => {
      raced = true;
      // the member signs in and asks to delete: the route writes its tombstone, and its own batch then fails (a 503), so nothing else
      await h.db.prepare("UPDATE member SET last_seen_day = ?1 WHERE id = 'X'").bind(today).run();
      await h.kv.put('tomb:hashX', routeTomb);
    });
    expect(await accountCron(db, NOW, h.kv)).toBe(0); // the cron's guard holds X, as it should
    expect(raced).toBe(true);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'X'")).toBe(1);
    expect(await h.kv.get('tomb:hashX')).toBe(routeTomb); // the deletion the member asked for is still on record
  });

  it('race 2: the delete request commits between the cron\'s survivor select and its tombstone delete; the deleted account keeps its tombstone', async () => {
    const h = accountHarness({ now: NOW, foreignKeys: true });
    await member(h, 'Y', CUTOFF - 5);
    const inner = beforeMemberDelete(h.db, async () => {
      await h.db.prepare("UPDATE member SET last_seen_day = ?1 WHERE id = 'Y'").bind(today).run();
      await h.kv.put('tomb:hashY', routeTomb);
    });
    let committed = false;
    const wrap = (s: D1Stmt): D1Stmt => ({
      ...s,
      bind: (...v: unknown[]) => wrap(s.bind(...v)),
      all: async <T>() => {
        const r = await s.all<T>();
        committed = await deleteMember(h.db, 'Y', { lastSeenAtMost: today }); // the route's batch commits now
        return r;
      },
    });
    const db: D1Like = {
      ...inner,
      prepare: (sql: string) => (sql.startsWith('SELECT id, last_seen_day FROM member WHERE id IN') ? wrap(inner.prepare(sql)) : inner.prepare(sql)),
    };
    expect(await accountCron(db, NOW, h.kv)).toBe(0);
    expect(committed).toBe(true);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'Y'")).toBe(0);
    expect(await h.kv.get('tomb:hashY')).toBe(routeTomb); // `gone` and a Time Travel restore still learn the account was deleted
  });
});

/** Tombstone values the code must read without acting on: unparsable, `null` (parses, then has no field), and days that are not numbers. */
const BAD_TOMBS = ['not json', 'null', '{"lastSeenDay":null}', '{"lastSeenDay":"5"}', '7', '{}'];

describe('accountCron: a tombstone that does not parse to a numeric day is left alone (PR 1518 delta review, finding 2)', () => {
  const today = dayOf(NOW);

  it.each(BAD_TOMBS)('survivor step, %s: the bad tombstone stays, the run does not throw, and the next survivor is still pruned', async (bad) => {
    const h = accountHarness({ now: NOW, foreignKeys: true });
    await member(h, 'a', CUTOFF - 5); // 'a' sorts first: its bad tombstone is read before b's
    await member(h, 'b', CUTOFF - 5);
    let raced = false;
    const db = beforeMemberDelete(h.db, async () => {
      raced = true;
      // both sign in; a's tombstone is replaced by one the survivor step cannot read, b's stays the sweep's own (`cutoff`)
      await h.db.prepare("UPDATE member SET last_seen_day = ?1 WHERE id IN ('a', 'b')").bind(today).run();
      await h.kv.put('tomb:hasha', bad);
    });
    expect(await accountCron(db, NOW, h.kv)).toBe(0);
    expect(raced).toBe(true);
    expect(await n(h.db, 'SELECT 1 FROM member')).toBe(2);
    expect(await h.kv.get('tomb:hasha')).toBe(bad);
    expect(await h.kv.get('tomb:hashb')).toBeNull();
  });

  it.each(BAD_TOMBS.filter((b) => !['not json', 'null'].includes(b)))('scan, %s: skipped quietly; the member and the tombstone stay, and the next tombstone on the page is still acted on', async (bad) => {
    const h = accountHarness({ now: NOW });
    await member(h, 'a', today); // signed in today, not idle: found through the tombstone alone
    await member(h, 'b', today);
    await h.kv.put('tomb:hasha', bad); // 'hasha' sorts first on the page
    await h.kv.put('tomb:hashb', JSON.stringify({ deletedAt: NOW, lastSeenDay: today }));
    expect(await accountCron(h.db, NOW, h.kv)).toBe(1);
    expect((await h.db.prepare('SELECT id AS x FROM member').all<{ x: string }>()).results.map((r) => r.x)).toEqual(['a']);
    expect(await h.kv.get('tomb:hasha')).toBe(bad);
  });

  it.each(['not json', 'null'])('scan, %s: a tombstone that will not parse is reported (the run rethrows), and does not stop the rest of the page', async (bad) => {
    const h = accountHarness({ now: NOW });
    await member(h, 'a', today);
    await member(h, 'b', today);
    await h.kv.put('tomb:hasha', bad);
    await h.kv.put('tomb:hashb', JSON.stringify({ deletedAt: NOW, lastSeenDay: today }));
    await expect(accountCron(h.db, NOW, h.kv)).rejects.toThrow();
    expect((await h.db.prepare('SELECT id AS x FROM member').all<{ x: string }>()).results.map((r) => r.x)).toEqual(['a']);
    expect(await h.kv.get('tomb:hasha')).toBe(bad);
  });

  it('scan: a listed tombstone whose read comes back empty (expired since the listing, or not yet visible) is skipped quietly', async () => {
    const h = accountHarness({ now: NOW });
    await member(h, 'a', today);
    await member(h, 'b', today);
    const tomb = JSON.stringify({ deletedAt: NOW, lastSeenDay: today });
    await h.kv.put('tomb:hasha', tomb);
    await h.kv.put('tomb:hashb', tomb);
    const kv = { ...h.kv, get: async (k: string) => (k === 'tomb:hasha' ? null : h.kv.get(k)) };
    expect(await accountCron(h.db, NOW, kv)).toBe(1);
    expect((await h.db.prepare('SELECT id AS x FROM member').all<{ x: string }>()).results.map((r) => r.x)).toEqual(['a']);
  });
});

describe('accountCron: the tombstone cursor moves on only once the delete batch has committed (PR 1518 review, finding 2)', () => {
  it('a failed delete batch leaves the cursor where it was, so the next run re-reads the same pages', async () => {
    const h = accountHarness({ now: NOW });
    const kv = memoryKV({ pageSize: 2 }); // 8 tombstones, 2 a page: the run's three pages end mid-listing
    const today = dayOf(NOW);
    for (let i = 0; i < 8; i++) {
      await member(h, 'x' + i, today); // signed in today, not idle: found through the tombstone alone
      await kv.put('tomb:hashx' + i, JSON.stringify({ deletedAt: NOW, lastSeenDay: today }));
    }
    let calls = 0;
    // call 0 is the expiry batch; call 1 is the member delete batch, which fails
    const failing: D1Like = { ...h.db, batch: async (ss: D1Stmt[]) => { if (calls++ === 1) throw new Error('batch failed'); return h.db.batch(ss); } };
    await expect(accountCron(failing, NOW, kv)).rejects.toThrow('batch failed');
    expect(calls).toBe(2);
    expect(await n(h.db, 'SELECT 1 FROM member')).toBe(8);
    expect(await kv.get(RECONCILE_CURSOR_KEY)).toBeNull(); // not moved past the pages whose deletions failed
    // the retry starts from the top: the same six members, and only now does the cursor move on
    expect(await accountCron(h.db, NOW, kv)).toBe(6);
    expect((await h.db.prepare('SELECT id AS x FROM member ORDER BY id').all<{ x: string }>()).results.map((r) => r.x)).toEqual(['x6', 'x7']);
    expect(await kv.get(RECONCILE_CURSOR_KEY)).toBe('tomb:hashx5');
    expect(await accountCron(h.db, NOW, kv)).toBe(2);
    expect(await n(h.db, 'SELECT 1 FROM member')).toBe(0);
  });
});

describe('the cron wiring', () => {
  it('scheduled sweeps and reconciles when both bindings exist, and skips them when one is missing', async () => {
    const { default: worker } = await import('../index');
    const h = accountHarness({ now: NOW });
    await member(h, 'old', CUTOFF);
    await member(h, 'gone', dayOf(NOW));
    await h.kv.put('tomb:hashgone', JSON.stringify({ deletedAt: 1, lastSeenDay: dayOf(NOW) }));
    const { ACCOUNT_TOMBSTONES: _kv, ...unbound } = h.env;
    void _kv;
    await worker.scheduled(undefined, unbound);
    expect(await n(h.db, 'SELECT 1 FROM member')).toBe(2);
    await worker.scheduled(undefined, h.env);
    expect(await n(h.db, 'SELECT 1 FROM member')).toBe(0);
  });
});
