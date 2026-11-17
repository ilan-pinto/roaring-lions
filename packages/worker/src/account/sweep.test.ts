import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { D1Like, D1Stmt } from '../d1';
import { dayOf } from '../rate-day';
import { OP_TTL_MS, PENDING_TTL_MS, SESSION_COOKIE, STEAM_OP, TOMB_TTL_S, preCookieName } from './config';
import { DUE_MEMBERS_MAX, deleteMember } from './delete';
import { memoryKV } from './kv';
import {
  BATCH_FAIL_KEY, BATCH_FAIL_THRESHOLD, FAILING_HOLD_DAYS, FAILING_KEY, MEMBER_IDLE_DAYS, RECONCILE_CURSOR_KEY, accountCron, reconcileTombstones, sweepAccounts,
} from './sweep';
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

  afterEach(() => { vi.restoreAllMocks(); });

  it.each(BAD_TOMBS)('survivor step, %s: the bad tombstone stays, is logged and counted, the run does not throw, and the next survivor is still pruned', async (bad) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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
    expect(warn).toHaveBeenCalledWith('account cron: skipped tombstones that do not parse to a day', { count: 1 });
  });

  // GH-1530: the scan used to rethrow on the two values that do not parse ('not json', 'null'), while the survivor step skipped the same
  // tombstone. Both paths now skip, log and count, for all six; the scan also fails the run (PR 1540 review), because the member it
  // belongs to is live and its deletion is owed, but the rest of the page is still acted on and the page does not pin the cursor.
  it.each(BAD_TOMBS)('scan, %s: skipped, logged and counted, and the run is RED; the member and the tombstone stay, and the next tombstone on the page is still acted on', async (bad) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = accountHarness({ now: NOW });
    await member(h, 'a', today); // signed in today, not idle: found through the tombstone alone
    await member(h, 'b', today);
    await h.kv.put('tomb:hasha', bad); // 'hasha' sorts first on the page
    await h.kv.put('tomb:hashb', JSON.stringify({ deletedAt: NOW, lastSeenDay: today }));
    await expect(accountCron(h.db, NOW, h.kv)).rejects.toThrow(/a live member's tombstone does not parse to a day \(GH-1530\)/);
    expect((await h.db.prepare('SELECT id AS x FROM member').all<{ x: string }>()).results.map((r) => r.x)).toEqual(['a']);
    expect(await h.kv.get('tomb:hasha')).toBe(bad);
    expect(warn).toHaveBeenCalledWith('account cron: skipped tombstones that do not parse to a day', { count: 1 });
    // and it moves the cursor on like any other page: the listing is finished, so the next run starts from the top (no stuck page)
    expect(await h.kv.get(RECONCILE_CURSOR_KEY)).toBeNull();
    await expect(accountCron(h.db, NOW, h.kv)).rejects.toThrow(/does not parse to a day/); // red every run that reads it
    expect(await n(h.db, 'SELECT 1 FROM member')).toBe(1);
  });

  it('a run with nothing unreadable logs nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = accountHarness({ now: NOW });
    await member(h, 'b', today);
    await h.kv.put('tomb:hashb', JSON.stringify({ deletedAt: NOW, lastSeenDay: today }));
    expect(await accountCron(h.db, NOW, h.kv)).toBe(1);
    expect(warn).not.toHaveBeenCalled();
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

const raw = (h: H): DatabaseSync => (h.db as unknown as { raw: DatabaseSync }).raw;
/** A trigger that aborts the delete of one member's row, so any batch carrying that member rolls back whole: a deterministic per-member
 *  failure of the kind GH-1530 guards against (the shipped schema has none). */
const stick = (h: H, id: string): void => raw(h).exec(`CREATE TRIGGER stuck_${id} BEFORE DELETE ON member WHEN OLD.id = '${id}' BEGIN SELECT RAISE(ABORT, 'stuck member'); END`);
const unstick = (h: H, id: string): void => raw(h).exec(`DROP TRIGGER stuck_${id}`);
const ids = async (h: H): Promise<string[]> => (await h.db.prepare('SELECT id AS x FROM member ORDER BY id').all<{ x: string }>()).results.map((r) => r.x);
/** One run: the members it deleted, or 'threw'. */
const once = (h: H, now = NOW, db: D1Like = h.db, kv = h.kv): Promise<number | 'threw'> => accountCron(db, now, kv).then((d) => d, () => 'threw' as const);

describe('accountCron: the one-member fallback after repeated failed batches (GH-1530)', () => {
  const today = dayOf(NOW);

  it('the failure counter rises when the shared batch fails, lives 7 days outside `tomb:`, and clears when the batch commits', async () => {
    expect(BATCH_FAIL_THRESHOLD).toBe(2);
    const h = accountHarness({ now: NOW });
    await member(h, 'a', CUTOFF - 1);
    stick(h, 'a');
    await expect(accountCron(h.db, NOW, h.kv)).rejects.toThrow(/stuck member/);
    expect(await h.kv.get(BATCH_FAIL_KEY)).toBe('1');
    expect(h.kv.ttl(BATCH_FAIL_KEY)).toBe(7 * 86_400);
    expect(BATCH_FAIL_KEY.startsWith('tomb:')).toBe(false);
    expect((await h.kv.list({ prefix: 'tomb:' })).keys.map((k) => k.name)).toEqual(['tomb:hasha']);
    unstick(h, 'a'); // a transient failure: the next run's shared batch commits
    expect(await accountCron(h.db, NOW, h.kv)).toBe(1);
    expect(await h.kv.get(BATCH_FAIL_KEY)).toBeNull();
    expect(await ids(h)).toEqual([]);
  });

  it('a failure that lasts two runs: the third deletes the oldest member alone, the fourth tries the shared batch again and clears the counter', async () => {
    const h = accountHarness({ now: NOW });
    for (const [i, id] of ['a', 'b', 'c'].entries()) await member(h, id, CUTOFF - 10 + i);
    let failing = 2;
    const db: D1Like = { ...h.db, batch: async (ss: D1Stmt[]) => {
      if (ss.length === 17 && failing-- > 0) throw new Error('transient');
      return h.db.batch(ss);
    } };
    expect([await once(h, NOW, db), await once(h, NOW, db)]).toEqual(['threw', 'threw']);
    expect(await h.kv.get(BATCH_FAIL_KEY)).toBe('2');
    expect(await once(h, NOW, db)).toBe(1); // alone: the oldest, 'a'
    expect(await ids(h)).toEqual(['b', 'c']);
    expect(await h.kv.get(BATCH_FAIL_KEY)).toBe('1'); // one under the threshold: the next run tries the shared batch
    expect(await once(h, NOW, db)).toBe(2);
    expect(await h.kv.get(BATCH_FAIL_KEY)).toBeNull();
    expect(await h.kv.get(FAILING_KEY)).toBeNull(); // a transient failure records nobody
    expect(await ids(h)).toEqual([]);
  });

  it('a stuck member younger than the rest: each member ahead of it goes alone, then it is recorded and left out, and every run after it fails visibly', async () => {
    const h = accountHarness({ now: NOW });
    await member(h, 'g0', CUTOFF - 30);
    await member(h, 'g1', CUTOFF - 20);
    await member(h, 'g2', CUTOFF - 10);
    await member(h, 'bad', CUTOFF - 5);
    stick(h, 'bad');
    const got: (number | 'threw')[] = [];
    for (let i = 0; i < 10; i++) got.push(await once(h));
    // shared, shared (the threshold), then alone (g0) / shared again, three times over; then the shared batch of bad alone fails,
    // the fallback records it alone, and the last run leaves it out (and throws, so the stuck deletion is seen).
    expect(got).toEqual(['threw', 'threw', 1, 'threw', 1, 'threw', 1, 'threw', 'threw', 'threw']);
    expect(await ids(h)).toEqual(['bad']);
    expect(await h.kv.get('tomb:hashbad')).not.toBeNull(); // its deletion stays on record
    expect(JSON.parse((await h.kv.get(FAILING_KEY)) ?? '{}')).toEqual({ hashbad: today });
    expect(await h.kv.get(BATCH_FAIL_KEY)).toBeNull();
    await expect(accountCron(h.db, NOW, h.kv)).rejects.toThrow(/1 member deletion\(s\) held back after failing alone \(GH-1530\)/);
  });

  it('a recorded member is left out for 7 days, then retried alone: a second failure holds it again without holding the others, and a commit deletes it and clears the record', async () => {
    const h = accountHarness({ now: NOW });
    await member(h, 'bad', CUTOFF - 50);
    await member(h, 'g', CUTOFF - 1);
    stick(h, 'bad');
    expect([await once(h), await once(h), await once(h), await once(h)]).toEqual(['threw', 'threw', 'threw', 'threw']);
    expect(await ids(h)).toEqual(['bad']); // run 3 recorded 'bad' alone; run 4's shared batch deleted 'g' and threw for 'bad'
    expect(FAILING_HOLD_DAYS).toBe(7);
    let batches = 0;
    const counting: D1Like = { ...h.db, batch: async (ss: D1Stmt[]) => { if (ss.length === 17) batches++; return h.db.batch(ss); } };
    expect(await once(h, NOW + 6 * DAY, counting)).toBe('threw');
    expect(batches).toBe(0); // still held: no batch tries it
    await member(h, 'n', CUTOFF - 1); // a newcomer, idle by day 7
    expect(await once(h, NOW + 7 * DAY, counting)).toBe('threw'); // retried ALONE, and fails again
    expect(batches).toBe(1);
    expect(await ids(h)).toEqual(['bad', 'n']); // the newcomer waited this one run, and only this one
    expect(JSON.parse((await h.kv.get(FAILING_KEY)) ?? '{}')).toEqual({ hashbad: today + 7 });
    expect(await once(h, NOW + 7 * DAY, counting)).toBe('threw'); // held again; the newcomer's shared batch goes ahead
    expect(await ids(h)).toEqual(['bad']);
    unstick(h, 'bad');
    expect(await once(h, NOW + 14 * DAY, counting)).toBe(1); // retried alone, and this time it commits
    expect(await ids(h)).toEqual([]);
    expect(await h.kv.get(FAILING_KEY)).toBeNull();
  });

  it('the cursor: a member left out of an alone run keeps its page; a recorded member does not pin it', async () => {
    const h = accountHarness({ now: NOW });
    const kv = memoryKV({ pageSize: 2 }); // 8 tombstones, 2 a page: a run reads three pages, x0..x5
    for (let i = 0; i < 8; i++) {
      await member(h, 'x' + i, today); // signed in today, not idle: found through the tombstone alone
      await kv.put('tomb:hashx' + i, JSON.stringify({ deletedAt: NOW, lastSeenDay: today }));
    }
    await kv.put(BATCH_FAIL_KEY, String(BATCH_FAIL_THRESHOLD));
    stick(h, 'x0');
    expect(await once(h, NOW, h.db, kv)).toBe('threw'); // alone: x0 fails and is recorded
    expect(await kv.get(RECONCILE_CURSOR_KEY)).toBeNull(); // x1 shares x0's page and was not tried: the page is kept
    expect(await once(h, NOW, h.db, kv)).toBe('threw'); // x0 left out (so the run throws); x1..x5 in one shared batch
    expect(await ids(h)).toEqual(['x0', 'x6', 'x7']);
    expect(await kv.get(RECONCILE_CURSOR_KEY)).toBe('tomb:hashx5'); // past x0's page: a recorded member does not pin the scan
    // x0 is not on the pages this run reads, but the run is still RED: the record, not this run's queue, says a deletion is stuck
    // (PR 1540 review). It used to resolve here, with x0 undeleted.
    expect(await once(h, NOW, h.db, kv)).toBe('threw');
    expect(await ids(h)).toEqual(['x0']); // x6 and x7 went in the shared batch all the same
  });

  it('the cursor: an alone run that commits still keeps the page of the members it did not try', async () => {
    const h = accountHarness({ now: NOW });
    const kv = memoryKV({ pageSize: 2 });
    for (let i = 0; i < 8; i++) {
      await member(h, 'y' + i, today);
      await kv.put('tomb:hashy' + i, JSON.stringify({ deletedAt: NOW, lastSeenDay: today }));
    }
    await kv.put(BATCH_FAIL_KEY, String(BATCH_FAIL_THRESHOLD));
    expect(await once(h, NOW, h.db, kv)).toBe(1); // alone: y0
    expect(await kv.get(RECONCILE_CURSOR_KEY)).toBeNull(); // y1 was not tried
    expect(await once(h, NOW, h.db, kv)).toBe(5); // y1..y5, from the top
    expect(await ids(h)).toEqual(['y6', 'y7']);
    expect(await once(h, NOW, h.db, kv)).toBe(2);
  });
});

describe('accountCron: a stuck deletion stays red until it is finished or no longer owed (PR 1540 review, finding 1)', () => {
  const today = dayOf(NOW);
  const tomb = JSON.stringify({ deletedAt: NOW, lastSeenDay: today });

  /** A tombstone-path member 'x' (signed in today, so never idle) whose delete always fails, run once in the fallback: recorded. */
  async function recordedX(tombTtl?: number): Promise<H> {
    const h = accountHarness({ now: NOW });
    await member(h, 'x', today);
    await h.kv.put('tomb:hashx', tomb, tombTtl === undefined ? undefined : { expirationTtl: tombTtl });
    await h.kv.put(BATCH_FAIL_KEY, String(BATCH_FAIL_THRESHOLD));
    stick(h, 'x');
    expect(await once(h)).toBe('threw');
    expect(JSON.parse((await h.kv.get(FAILING_KEY)) ?? '{}')).toEqual({ hashx: today });
    return h;
  }

  it('the reviewers\' probe: the tombstone expires and nothing queues the member, but the run is still red and the record keeps it', async () => {
    const h = await recordedX();
    await h.kv.delete('tomb:hashx'); // as if its TTL ran out
    await expect(accountCron(h.db, NOW + DAY, h.kv)).rejects.toThrow(/1 member deletion\(s\) held back after failing alone \(GH-1530\)/);
    expect(await ids(h)).toEqual(['x']);
    expect(JSON.parse((await h.kv.get(FAILING_KEY)) ?? '{}')).toEqual({ hashx: today }); // a missing tombstone is no way out
  });

  it('recording re-puts the tombstone with the same value and a fresh TOMB_TTL_S, and so does a re-record; the record key lives 30 days', async () => {
    const h = await recordedX(60); // a tombstone a minute from expiry
    expect(await h.kv.get('tomb:hashx')).toBe(tomb);
    expect(h.kv.ttl('tomb:hashx')).toBe(TOMB_TTL_S);
    expect(h.kv.ttl(FAILING_KEY)).toBe(30 * 86_400);
    await h.kv.put('tomb:hashx', tomb, { expirationTtl: 60 });
    expect(await once(h, NOW + FAILING_HOLD_DAYS * DAY)).toBe('threw'); // the hold is over: retried alone, fails, re-recorded
    expect(JSON.parse((await h.kv.get(FAILING_KEY)) ?? '{}')).toEqual({ hashx: today + FAILING_HOLD_DAYS });
    expect(await h.kv.get('tomb:hashx')).toBe(tomb);
    expect(h.kv.ttl('tomb:hashx')).toBe(TOMB_TTL_S);
  });

  it('an idle member\'s tombstone, which the idle path wrote this run, is not written a second time when it is recorded', async () => {
    const h = accountHarness({ now: NOW });
    await member(h, 'bad', CUTOFF - 1);
    await h.kv.put(BATCH_FAIL_KEY, String(BATCH_FAIL_THRESHOLD));
    stick(h, 'bad');
    let puts = 0;
    const kv = { ...h.kv, put: async (k: string, v: string, o?: { expirationTtl?: number }) => { if (k === 'tomb:hashbad') puts++; return h.kv.put(k, v, o); } };
    expect(await once(h, NOW, h.db, kv)).toBe('threw');
    expect(JSON.parse((await h.kv.get(FAILING_KEY)) ?? '{}')).toEqual({ hashbad: today });
    expect(puts).toBe(1);
  });

  it('a way out: the route deletes the member, and the next run is green with the record gone', async () => {
    const h = await recordedX();
    unstick(h, 'x');
    expect(await deleteMember(h.db, 'x', { lastSeenAtMost: today })).toBe(true);
    expect(await once(h)).toBe(0);
    expect(await h.kv.get(FAILING_KEY)).toBeNull();
    expect(await h.kv.get('tomb:hashx')).toBe(tomb); // a dead tombstone, kept for `gone`
  });

  it('a way out: the member signs in again, cancelling the deletion, and the next run is green with the record gone', async () => {
    const h = await recordedX();
    await h.db.prepare("UPDATE member SET last_seen_day = ?1 WHERE id = 'x'").bind(today + 1).run();
    expect(await once(h, NOW + DAY)).toBe(0);
    expect(await h.kv.get(FAILING_KEY)).toBeNull();
    expect(await ids(h)).toEqual(['x']);
    expect(await h.kv.get('tomb:hashx')).toBeNull(); // the cancelled tombstone is pruned by the scan, as ever
  });

  it('an entry lives under 30 days in what a run acts on: 29 days old it is red, 30 days old it is dropped and the run is green', async () => {
    const h = accountHarness({ now: NOW });
    await member(h, 'x', today); // exists, but nothing queues it: no tombstone
    await h.kv.put(FAILING_KEY, JSON.stringify({ hashx: today - 29 }));
    expect(await once(h)).toBe('threw');
    await h.kv.put(FAILING_KEY, JSON.stringify({ hashx: today - 30 }));
    expect(await once(h)).toBe(0);
    expect(await h.kv.get(FAILING_KEY)).toBeNull();
  });

  it('the record holds at most 40 entries, the newest', async () => {
    const h = accountHarness({ now: NOW });
    const record: Record<string, number> = {};
    for (let i = 0; i <= DUE_MEMBERS_MAX; i++) {
      await member(h, 'm' + i, today); // all exist, none queued
      record['hashm' + i] = today - i * 0.5;
    }
    await h.kv.put(FAILING_KEY, JSON.stringify(record));
    await expect(accountCron(h.db, NOW, h.kv)).rejects.toThrow(/40 member deletion\(s\) held back/);
    const kept = Object.keys(JSON.parse((await h.kv.get(FAILING_KEY)) ?? '{}') as Record<string, number>);
    expect(kept).toHaveLength(DUE_MEMBERS_MAX);
    expect(kept).not.toContain('hashm' + DUE_MEMBERS_MAX); // the oldest is the one dropped
  });

  it('a record entry whose day is not a number is ignored', async () => {
    const h = accountHarness({ now: NOW });
    await member(h, 'x', today);
    await h.kv.put(FAILING_KEY, JSON.stringify({ hashx: String(today) }));
    expect(await once(h)).toBe(0);
  });
});

describe('accountCron: the cursor never jumps a page that still has a member owed (PR 1540 review)', () => {
  const today = dayOf(NOW);
  const tomb = JSON.stringify({ deletedAt: NOW, lastSeenDay: today });
  /** Two tombstones a page, the listing longer than one run's three pages; `dead` keys have no member (kept for `gone`). */
  async function listing(h: H, live: string[], dead: string[]): Promise<ReturnType<typeof memoryKV>> {
    const kv = memoryKV({ pageSize: 2 });
    for (const id of live) {
      await member(h, id, today);
      await kv.put('tomb:hash' + id, tomb);
    }
    for (const id of dead) await kv.put('tomb:hash' + id, JSON.stringify({ deletedAt: 1, lastSeenDay: 5 }));
    await kv.put(BATCH_FAIL_KEY, String(BATCH_FAIL_THRESHOLD));
    return kv;
  }

  it('an unsettled page followed by all-dead pages keeps the cursor on the unsettled one', async () => {
    const h = accountHarness({ now: NOW });
    const kv = await listing(h, ['a', 'b'], ['z0', 'z1', 'z2', 'z3', 'z4', 'z5']); // pages [a b] [z0 z1] [z2 z3], then more
    expect(await once(h, NOW, h.db, kv)).toBe(1); // alone: a; b was not tried
    expect(await kv.get(RECONCILE_CURSOR_KEY)).toBeNull(); // not 'tomb:hashz3', past b's page
    expect(await once(h, NOW, h.db, kv)).toBe(1); // b, from the top
    expect(await ids(h)).toEqual([]);
  });

  it('an idle member found on a page, already queued, keeps that page too until it is settled', async () => {
    const h = accountHarness({ now: NOW });
    await member(h, 'i0', CUTOFF - 2);
    await member(h, 'i1', CUTOFF - 1); // the idle path writes tomb:hashi0 and tomb:hashi1: page one of the listing
    const kv = await listing(h, [], ['z0', 'z1', 'z2', 'z3', 'z4', 'z5']);
    expect(await once(h, NOW, h.db, kv)).toBe(1); // alone: i0; i1 was not tried
    expect(await kv.get(RECONCILE_CURSOR_KEY)).toBeNull();
  });

  it('a member recorded alone settles its page: the cursor moves past it, and stops at the next page owed', async () => {
    const h = accountHarness({ now: NOW });
    const kv = await listing(h, ['a', 'c'], ['b', 'd', 'e', 'f', 'g']); // pages [a b] [c d] [e f], then g
    stick(h, 'a');
    expect(await once(h, NOW, h.db, kv)).toBe('threw'); // alone: a fails and is recorded; c was not tried
    expect(await kv.get(RECONCILE_CURSOR_KEY)).toBe('tomb:hashb');
  });
});

describe('accountCron: a batch that committed is not a failed delete, whatever its tidy-up does (PR 1540 review)', () => {
  const today = dayOf(NOW);
  /** `h.kv`, except that reading `key` throws: the survivor step's tombstone read, which runs only after the batch committed. */
  const throwingGet = (h: H, key: string) => ({ ...h.kv, get: async (k: string) => { if (k === key) throw new Error('kv get failed'); return h.kv.get(k); } });

  it('shared: the batch commits, then the survivor step throws: the counter does not rise', async () => {
    const h = accountHarness({ now: NOW });
    await member(h, 'a', CUTOFF - 2);
    await member(h, 'b', CUTOFF - 1);
    const db = beforeMemberDelete(h.db, async () => { await h.db.prepare("UPDATE member SET last_seen_day = ?1 WHERE id = 'b'").bind(today).run(); });
    await expect(accountCron(db, NOW, throwingGet(h, 'tomb:hashb'))).rejects.toThrow('kv get failed');
    expect(await ids(h)).toEqual(['b']); // a deleted, b spared by its guard: the batch committed
    expect(await h.kv.get(BATCH_FAIL_KEY)).toBeNull();
  });

  it('alone: the batch commits, then the survivor step throws: the member is not recorded, and the counter drops to K-1', async () => {
    const h = accountHarness({ now: NOW });
    await member(h, 'a', CUTOFF - 2);
    await h.kv.put(BATCH_FAIL_KEY, String(BATCH_FAIL_THRESHOLD));
    const db = beforeMemberDelete(h.db, async () => { await h.db.prepare("UPDATE member SET last_seen_day = ?1 WHERE id = 'a'").bind(today).run(); });
    await expect(accountCron(db, NOW, throwingGet(h, 'tomb:hasha'))).rejects.toThrow('kv get failed');
    expect(await ids(h)).toEqual(['a']); // spared by its guard, which is a commit, not a failure
    expect(await h.kv.get(FAILING_KEY)).toBeNull();
    expect(await h.kv.get(BATCH_FAIL_KEY)).toBe(String(BATCH_FAIL_THRESHOLD - 1));
  });
});

describe('accountCron: the fallback state reads its two keys apart (PR 1540 review)', () => {
  it('a corrupt failing record does not zero the counter: the run still goes alone, and is red for the record', async () => {
    const h = accountHarness({ now: NOW });
    await member(h, 'a', CUTOFF - 2);
    await member(h, 'b', CUTOFF - 1);
    await h.kv.put(BATCH_FAIL_KEY, String(BATCH_FAIL_THRESHOLD));
    await h.kv.put(FAILING_KEY, 'not json');
    await expect(accountCron(h.db, NOW, h.kv)).rejects.toThrow(SyntaxError);
    expect(await ids(h)).toEqual(['b']); // alone: the oldest, a
    expect(await h.kv.get(BATCH_FAIL_KEY)).toBe(String(BATCH_FAIL_THRESHOLD - 1));
  });

  it('an unreadable counter does not drop the record: a recorded member is still held', async () => {
    const h = accountHarness({ now: NOW });
    await member(h, 'bad', CUTOFF - 2);
    await member(h, 'g', CUTOFF - 1);
    await h.kv.put(FAILING_KEY, JSON.stringify({ hashbad: dayOf(NOW) }));
    const kv = { ...h.kv, get: async (k: string) => { if (k === BATCH_FAIL_KEY) throw new Error('kv get failed'); return h.kv.get(k); } };
    await expect(accountCron(h.db, NOW, kv)).rejects.toThrow('kv get failed');
    expect(await ids(h)).toEqual(['bad']); // held; g in the shared batch
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
