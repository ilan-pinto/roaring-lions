import { describe, expect, it, vi } from 'vitest';
import type { D1Like, D1Stmt } from '../d1';
import { TOMB_TTL_S } from './config';
import { sha256Hex } from './crypto';
import { handleAccount } from './routes';
import { openTestD1 } from '../test-d1';
import { memoryKV, type KVLike } from './kv';
import { createSession } from './session';
import { MEMBER_IDLE_DAYS, RECONCILE_PER_RUN, accountCron, reconcileTombstones } from './sweep';
import { accountHarness, instantSleep, memberTablesInMigration, seedFullMember, SEED_PUBLIC_ID, type AccountTestEnv } from './test-kit';
import worker from '../index';
import { SESSION_COOKIE } from './config';
import { DUE_MEMBERS_MAX, deleteDueStatements, deleteMember, deleteTelemetryFor } from './delete';

const DAY = 86_400_000;
const NOW = 20_000 * DAY + 3_600_000;
const P = '11111111-1111-4111-8111-111111111111';
const Q = '22222222-2222-4222-8222-222222222222';

const n = async (db: D1Like, sql: string, ...v: unknown[]): Promise<number> =>
  (await db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).bind(...v).first<{ n: number }>())?.n ?? -1;

/** `db.batch` throws once, after `after` calls have gone through; every statement is untouched otherwise. */
function failingBatch<T extends D1Like>(db: T, after = 0): T {
  let calls = 0;
  return { ...db, batch: async (ss: D1Stmt[]) => { if (calls++ === after) throw new Error('batch failed'); return db.batch(ss); } };
}

describe('POST delete', () => {
  it.each([false, true])('leaves zero rows (A1-9, foreignKeys %s)', async (foreignKeys) => {
    const h = accountHarness({ now: NOW, foreignKeys });
    const { cookie, idHash } = await seedFullMember(h.db, NOW);
    for (const t of memberTablesInMigration()) expect(await n(h.db, `SELECT 1 FROM ${t} WHERE ${t === 'member' ? 'id' : 'member_id'} = 'm1'`), t).toBeGreaterThan(0);
    const res = await h.call('POST', '/api/account/delete', { cookie, body: {} });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    for (const t of memberTablesInMigration()) expect(await n(h.db, `SELECT 1 FROM ${t} WHERE ${t === 'member' ? 'id' : 'member_id'} = 'm1'`), t).toBe(0);
    const shared = await h.db.prepare("SELECT seat, member_id, kind FROM match_seat WHERE code = 'SHARED' ORDER BY seat").all();
    expect(shared.results).toEqual([
      { seat: 0, member_id: null, kind: 'deleted' },
      { seat: 1, member_id: 'n1', kind: 'member' },
    ]);
    expect(await n(h.db, "SELECT 1 FROM match_record WHERE code = 'SHARED'")).toBe(1);
    expect(await n(h.db, "SELECT 1 FROM match_record WHERE code = 'SOLO'")).toBe(0);
    expect(await n(h.db, "SELECT 1 FROM match_seat WHERE code = 'SOLO' AND kind = 'member'")).toBe(0);
    expect(await n(h.db, "SELECT 1 FROM rate_day WHERE key = 'm1'")).toBe(0);
    expect(await n(h.db, "SELECT 1 FROM rate_day WHERE scope = 'acct-claim' AND key = 'm1'")).toBe(0);
    expect(await n(h.db, "SELECT 1 FROM rate_day WHERE key = 'n1'")).toBe(2);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'n1'")).toBe(1);
    expect(await n(h.db, "SELECT 1 FROM profile WHERE member_id = 'n1'")).toBe(1);
    const keys = (await h.kv.list({ prefix: '' })).keys.map((k) => k.name);
    expect(keys).toEqual(['tomb:' + idHash]);
    expect(h.kv.ttl('tomb:' + idHash)).toBe(7_776_000);
    expect(h.kv.ttl('tomb:' + idHash)).toBe(TOMB_TTL_S);
  });

  it('needs a fresh session', async () => {
    const h = accountHarness({ now: NOW + 600_000 });
    const { cookie } = await seedFullMember(h.db, NOW);
    const res = await h.call('POST', '/api/account/delete', { cookie, body: {} });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'reauth' });
    expect(await n(h.db, 'SELECT 1 FROM member')).toBe(2);
  });

  it('works while closed (A4-3, A1 half)', async () => {
    const h = accountHarness({ now: NOW });
    const { cookie } = await seedFullMember(h.db, NOW);
    expect(await n(h.db, 'SELECT 1 FROM flags')).toBe(0);
    expect((await h.call('POST', '/api/account/delete', { cookie, body: {} })).status).toBe(200);
  });

  it('refuses a malformed telemetry player', async () => {
    const h = accountHarness({ now: NOW });
    const { cookie } = await seedFullMember(h.db, NOW);
    expect((await h.call('POST', '/api/account/delete', { cookie, body: { telemetryPlayer: 'not-an-id' } })).status).toBe(400);
    expect(await n(h.db, 'SELECT 1 FROM member')).toBe(2);
  });
});

describe('the tombstone is written first (A1-20)', () => {
  it('a failed KV put deletes nothing', async () => {
    const h = accountHarness({ now: NOW, failPut: true });
    const { cookie } = await seedFullMember(h.db, NOW);
    const res = await h.call('POST', '/api/account/delete', { cookie, body: {} });
    expect(res.status).toBe(503);
    for (const t of memberTablesInMigration()) expect(await n(h.db, `SELECT 1 FROM ${t} WHERE ${t === 'member' ? 'id' : 'member_id'} = 'm1'`), t).toBeGreaterThan(0);
    expect((await h.call('GET', '/api/account/me', { cookie })).status).toBe(200);
  });

  it('a failed batch is finished by the reconciler; gone answers 410 once the rows are gone', async () => {
    const h = accountHarness({
      now: NOW,
      handler: (req, e, now) => handleAccount(req, { ...e, ACCOUNTS: failingBatch(e.ACCOUNTS) }, now),
    });
    const { cookie, idHash } = await seedFullMember(h.db, NOW);
    const res = await h.call('POST', '/api/account/delete', { cookie, body: {} });
    expect(res.status).toBe(503);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'm1'")).toBe(1);
    expect(await h.kv.get('tomb:' + idHash)).not.toBeNull();
    expect(await reconcileTombstones(h.db, h.kv)).toBe(1);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'm1'")).toBe(0);
    expect(await reconcileTombstones(h.db, h.kv)).toBe(0);
    expect((await h.call('POST', '/api/account/gone', { body: { idHash } })).status).toBe(410);
  });
});

describe('gone (A1-16)', () => {
  it('410 for a deleted member with the switch closed, 404 for an unknown hash', async () => {
    expect(await sha256Hex('K7Q2ABCD')).toBe('e0249e888a859c074fbe1c61a81ef5d3baeff97ce3f511131aae405207093420');
    const h = accountHarness({ now: NOW });
    const { cookie } = await seedFullMember(h.db, NOW);
    expect((await h.call('POST', '/api/account/delete', { cookie, body: {} })).status).toBe(200);
    const hit = await h.call('POST', '/api/account/gone', { body: { idHash: await sha256Hex(SEED_PUBLIC_ID) } });
    expect(hit.status).toBe(410);
    expect(await hit.json()).toEqual({ deleted: true });
    expect((await h.call('POST', '/api/account/gone', { body: { idHash: await sha256Hex('NOBODY00') } })).status).toBe(404);
    expect((await h.call('POST', '/api/account/gone', { body: { idHash: 'ABC' } })).status).toBe(400);
    expect((await h.call('POST', '/api/account/gone', { body: { idHash: 'E'.repeat(64) } })).status).toBe(400);
    expect((await h.call('POST', '/api/account/gone', { body: {} })).status).toBe(400);
  });
});

async function seedTelemetry(db: D1Like, player: string): Promise<void> {
  const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  await run("INSERT INTO events (type, player, session, build, t, received_at, payload) VALUES ('x', ?1, ?1, 'b', 1, 1, '{}')", player);
  await run("INSERT INTO event_batch (received_at, player, events) VALUES (1, ?1, '[]')", player);
  await run("INSERT INTO players (player, first_seen, last_seen) VALUES (?1, 1, 1)", player);
  await run("INSERT INTO accounts (player, t, credits, earned, unlocks, tiers) VALUES (?1, 1, 0, 0, '[]', '{}')", player);
  await run("INSERT INTO feedback (received_at, t, player, session, build, source, category, context, updated_at) VALUES (1, 1, ?1, ?1, 'b', 'menu', 'bug', '{}', 1)", player);
}

const TELEMETRY_TABLES = ['events', 'event_batch', 'players', 'accounts', 'feedback'];
const rowsFor = async (db: D1Like, player: string): Promise<number> => {
  let total = 0;
  for (const t of TELEMETRY_TABLES) total += await n(db, `SELECT 1 FROM ${t} WHERE player = ?1`, player);
  return total;
};

/** A telemetry D1 whose batch throws the first time it carries a DELETE. */
function failFirstDelete<T extends D1Like>(db: T): T {
  let thrown = false;
  const sqlOf = new WeakMap<D1Stmt, string>();
  const wrap = (s: D1Stmt, sql: string): D1Stmt => {
    const out: D1Stmt = { ...s, bind: (...v) => wrap(s.bind(...v), sql) };
    sqlOf.set(out, sql);
    return out;
  };
  return {
    ...db,
    prepare: (sql: string) => wrap(db.prepare(sql), sql),
    batch: async (ss: D1Stmt[]) => {
      if (!thrown && ss.some((s) => /^DELETE/.test(sqlOf.get(s) ?? ''))) { thrown = true; throw new Error('telemetry delete failed'); }
      return db.batch(ss);
    },
  };
}

describe('the telemetry option (A1-22)', () => {
  it('removes the named player from all five tables and nobody else', async () => {
    const h = accountHarness({ now: NOW });
    const { cookie } = await seedFullMember(h.db, NOW);
    await seedTelemetry(h.env.DB, P);
    await seedTelemetry(h.env.DB, Q);
    expect(await rowsFor(h.env.DB, P)).toBe(5);
    const res = await h.call('POST', '/api/account/delete', { cookie, body: { telemetryPlayer: P } });
    expect(res.status).toBe(200);
    expect(await rowsFor(h.env.DB, P)).toBe(0);
    expect(await rowsFor(h.env.DB, Q)).toBe(5);
  });

  it('removes a feedback note\'s picture and replay with it', async () => {
    // foreign keys OFF, so only the explicit deletes can remove an attachment (with them ON the cascade would hide a dropped one)
    const db = openTestD1({ foreignKeys: false });
    await seedTelemetry(db, P);
    await seedTelemetry(db, Q);
    await db.prepare("INSERT INTO feedback_picture SELECT id, x'00' FROM feedback").run();
    await db.prepare("INSERT INTO feedback_replay SELECT id, '{}' FROM feedback").run();
    await deleteTelemetryFor(db, P);
    expect(await n(db, 'SELECT 1 FROM feedback_picture')).toBe(1);
    expect(await n(db, 'SELECT 1 FROM feedback_replay')).toBe(1);
  });

  it('refuses a player id that is not one', async () => {
    await expect(deleteTelemetryFor(accountHarness().env.DB, "x' OR 1=1")).rejects.toThrow();
  });
});

describe('a failed telemetry step is retryable (A1-22b)', () => {
  it('503, no tombstone, every row present, the session lives; the retry finishes both', async () => {
    let flaky: D1Like | undefined;
    const h = accountHarness({
      now: NOW,
      handler: (req, e, now) => {
        flaky ??= failFirstDelete(e.DB);
        return handleAccount(req, { ...e, DB: flaky }, now, { fetch: noFetch, sleep: instantSleep });
      },
    });
    const { cookie, idHash } = await seedFullMember(h.db, NOW);
    await seedTelemetry(h.env.DB, P);
    const res = await h.call('POST', '/api/account/delete', { cookie, body: { telemetryPlayer: P } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'retry' });
    expect(await h.kv.get('tomb:' + idHash)).toBeNull();
    for (const t of memberTablesInMigration()) expect(await n(h.db, `SELECT 1 FROM ${t} WHERE ${t === 'member' ? 'id' : 'member_id'} = 'm1'`), t).toBeGreaterThan(0);
    expect(await rowsFor(h.env.DB, P)).toBe(5);
    expect((await h.call('GET', '/api/account/me', { cookie })).status).toBe(200);
    const retry = await h.call('POST', '/api/account/delete', { cookie, body: { telemetryPlayer: P } });
    expect(retry.status).toBe(200);
    expect(await rowsFor(h.env.DB, P)).toBe(0);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'm1'")).toBe(0);
  });
});

describe('the guard (serialisation with sign-in)', () => {
  it('deleteMember deletes nothing for a member seen after the guard day', async () => {
    const h = accountHarness({ now: NOW, foreignKeys: true });
    await seedFullMember(h.db, NOW);
    const seen = (await h.db.prepare("SELECT last_seen_day AS d FROM member WHERE id = 'm1'").first<{ d: number }>())?.d ?? 0;
    expect(await deleteMember(h.db, 'm1', { lastSeenAtMost: seen - 1 })).toBe(false);
    for (const t of memberTablesInMigration()) expect(await n(h.db, `SELECT 1 FROM ${t} WHERE ${t === 'member' ? 'id' : 'member_id'} = 'm1'`), t).toBeGreaterThan(0);
    expect(await n(h.db, "SELECT 1 FROM match_record WHERE code = 'SOLO'")).toBe(1);
    expect(await deleteMember(h.db, 'm1', { lastSeenAtMost: seen })).toBe(true);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'm1'")).toBe(0);
  });

  it('a stale tombstone spares a later sign-in', async () => {
    const h = accountHarness({ now: NOW });
    const { idHash } = await seedFullMember(h.db, NOW);
    const d = (await h.db.prepare("SELECT last_seen_day AS d FROM member WHERE id = 'm1'").first<{ d: number }>())?.d ?? 0;
    await h.kv.put('tomb:' + idHash, JSON.stringify({ deletedAt: NOW, lastSeenDay: d - 1 }));
    expect(await reconcileTombstones(h.db, h.kv)).toBe(0);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'm1'")).toBe(1);
    expect(await n(h.db, "SELECT 1 FROM wallet WHERE member_id = 'm1'")).toBe(1);
    expect(await h.kv.get('tomb:' + idHash)).toBeNull(); // pruned: the deletion was cancelled
    expect((await h.call('POST', '/api/account/gone', { body: { idHash } })).status).toBe(404);
    await h.kv.put('tomb:' + idHash, JSON.stringify({ deletedAt: NOW, lastSeenDay: d }));
    await h.kv.put('tomb:' + idHash, JSON.stringify({ deletedAt: NOW, lastSeenDay: d }));
    expect(await reconcileTombstones(h.db, h.kv)).toBe(1);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'm1'")).toBe(0);
  });
});

describe('limits', () => {
  it('gone takes the sign-in limiter and answers 429 before any KV read', async () => {
    const h = accountHarness({ now: NOW, denyLimiter: ['ACCOUNT_LIMIT'] });
    await h.kv.put('tomb:' + 'a'.repeat(64), '{}');
    const res = await h.call('POST', '/api/account/gone', { body: { idHash: 'a'.repeat(64) } });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'limit' });
    const ok = accountHarness({ now: NOW });
    expect((await ok.call('POST', '/api/account/gone', { body: { idHash: 'a'.repeat(64) } })).status).toBe(404);
  });

  it('the signed-in class and open take ACCOUNT_OP_LIMIT; the sign-in class does not', async () => {
    const h = accountHarness({ now: NOW, denyLimiter: ['ACCOUNT_OP_LIMIT'] });
    const { cookie } = await seedFullMember(h.db, NOW);
    for (const [m, p] of [['GET', 'me'], ['GET', 'export'], ['POST', 'delete'], ['POST', 'logout'], ['PATCH', 'profile']] as const) {
      expect((await h.call(m, '/api/account/' + p, { cookie, body: {} })).status, p).toBe(429);
    }
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'm1'")).toBe(1);
    expect((await h.call('GET', '/api/account/open')).status).toBe(429); // GH-1131 M1: open takes the signed-in limiter now
    expect((await h.call('POST', '/api/account/gone', { body: { idHash: 'a'.repeat(64) } })).status).toBe(404);
  });
});

describe('cancelled deletions and malformed bodies', () => {
  it('a guard-blocked delete answers 503 and leaves no tombstone behind', async () => {
    let first = true;
    const h = accountHarness({
      now: NOW,
      handler: (req, e, now) => {
        const racing: D1Like = {
          ...e.ACCOUNTS,
          batch: async (ss: D1Stmt[]) => {
            if (first) { first = false; await e.ACCOUNTS.prepare("UPDATE member SET last_seen_day = last_seen_day + 1 WHERE id = 'm1'").run(); }
            return e.ACCOUNTS.batch(ss);
          },
        };
        return handleAccount(req, { ...e, ACCOUNTS: racing }, now);
      },
    });
    const { cookie, idHash } = await seedFullMember(h.db, NOW);
    const res = await h.call('POST', '/api/account/delete', { cookie, body: {} });
    expect(res.status).toBe(503);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'm1'")).toBe(1);
    expect(await h.kv.get('tomb:' + idHash)).toBeNull();
    expect((await h.call('POST', '/api/account/gone', { body: { idHash } })).status).toBe(404);
  });

  it('a non-empty body that is not JSON is a 400 and deletes nothing', async () => {
    const h = accountHarness({ now: NOW });
    const { cookie } = await seedFullMember(h.db, NOW);
    expect((await h.call('POST', '/api/account/delete', { cookie, rawBody: '{"telemetryPlayer":' })).status).toBe(400);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'm1'")).toBe(1);
    expect((await h.call('POST', '/api/account/delete', { cookie, rawBody: '' })).status).toBe(200);
  });
});

describe('reconcileTombstones at scale', () => {
  async function many(count: number, pageSize = 2) {
    const h = accountHarness({ now: NOW });
    const kv = memoryKV({ pageSize });
    for (let i = 0; i < count; i++) {
      await h.db.prepare('INSERT INTO member VALUES (?1, ?2, ?3, ?4, 1, 5)').bind('x' + i, 'PUB' + i, 'hash' + i, 'uh' + i).run();
      await kv.put('tomb:hash' + i, JSON.stringify({ deletedAt: 1, lastSeenDay: 5 }));
    }
    return { h, kv };
  }

  it('walks every page of the listing', async () => {
    const { h, kv } = await many(5);
    expect((await kv.list({ prefix: 'tomb:' })).list_complete).toBe(false);
    expect(await reconcileTombstones(h.db, kv)).toBe(5);
    expect(await n(h.db, 'SELECT 1 FROM member')).toBe(0);
  });

  it('a failed delete batch is rethrown, keeps the cursor, and the next run deletes everyone it held (GH-1432: one batch for all)', async () => {
    const { h, kv } = await many(4);
    await expect(reconcileTombstones(failingBatch(h.db), kv)).rejects.toThrow('batch failed');
    expect(await n(h.db, 'SELECT 1 FROM member')).toBe(4);
    expect(await reconcileTombstones(h.db, kv)).toBe(4);
    expect(await n(h.db, 'SELECT 1 FROM member')).toBe(0);
  });

  it('stops after RECONCILE_PER_RUN tombstones acted on: pruning costs no D1 query, so only that cap bounds it', async () => {
    const { h, kv } = await many(RECONCILE_PER_RUN + 3, 1000);
    await h.db.prepare('UPDATE member SET last_seen_day = 9').run(); // every sign-in came after its tombstone: all cancelled
    expect(await reconcileTombstones(h.db, kv)).toBe(0);
    expect((await kv.list({ prefix: 'tomb:' })).keys.length).toBe(3);
  });

  it('deletes at most DUE_MEMBERS_MAX members a run, in ONE batch (GH-1432), and the next run finishes what is left', async () => {
    const { h, kv } = await many(DUE_MEMBERS_MAX + 3, 1000);
    let batches = 0;
    const counting: D1Like = { ...h.db, batch: async (ss: D1Stmt[]) => { batches++; return h.db.batch(ss); } };
    expect(await reconcileTombstones(counting, kv)).toBe(DUE_MEMBERS_MAX);
    expect(batches).toBe(1);
    expect(await n(h.db, 'SELECT 1 FROM member')).toBe(3);
    expect(await reconcileTombstones(h.db, kv)).toBe(3);
    expect(await n(h.db, 'SELECT 1 FROM member')).toBe(0);
  });
});

describe('the cron\'s one delete batch for many members (GH-1432)', () => {
  const rowsOf = async (db: D1Like, member: string): Promise<Record<string, number>> => {
    const out: Record<string, number> = {};
    for (const t of [...memberTablesInMigration()].sort()) out[t] = await n(db, `SELECT 1 FROM ${t} WHERE ${t === 'member' ? 'id' : 'member_id'} = ?1`, member);
    out.rate_day = await n(db, 'SELECT 1 FROM rate_day WHERE key = ?1', member);
    return out;
  };

  it.each([false, true])('deletes an eligible member whole and leaves one its guard holds whole (foreignKeys %s)', async (foreignKeys) => {
    const h = accountHarness({ now: NOW, foreignKeys });
    await seedFullMember(h.db, NOW);
    const kept = await rowsOf(h.db, 'n1');
    expect(Object.values(kept).filter((v) => v > 0).length).toBeGreaterThan(3);
    // m1's guard day is its own last sign-in, so it is admitted; n1 (last seen on day 0) is held by day -1, as a sign-in after its
    // tombstone would hold it.
    const seen = (await h.db.prepare("SELECT last_seen_day AS d FROM member WHERE id = 'm1'").first<{ d: number }>())?.d ?? -9;
    const statements = deleteDueStatements(h.db, [{ id: 'm1', day: seen }, { id: 'n1', day: -1 }]);
    expect(statements.length).toBe(17); // a literal: `deleteDueStatements` maps `deleteStatements()`, so its length is no oracle
    await h.db.batch(statements);
    const gone = await rowsOf(h.db, 'm1');
    expect(gone).toEqual(Object.fromEntries(Object.keys(gone).map((k) => [k, 0])));
    expect(await rowsOf(h.db, 'n1')).toEqual(kept);
    expect(await n(h.db, "SELECT 1 FROM match_record WHERE code = 'SOLO'")).toBe(0);
    expect(await n(h.db, "SELECT 1 FROM match_record WHERE code = 'SHARED'")).toBe(1);
  });

  it('refuses an empty set and one past the bound-variable limit', () => {
    const h = accountHarness({ now: NOW });
    expect(() => deleteDueStatements(h.db, [])).toThrow();
    expect(() => deleteDueStatements(h.db, Array.from({ length: DUE_MEMBERS_MAX + 1 }, (_, i) => ({ id: 'x' + i, day: 1 })))).toThrow();
    expect(deleteDueStatements(h.db, Array.from({ length: DUE_MEMBERS_MAX }, (_, i) => ({ id: 'x' + i, day: 1 }))).length).toBe(17);
  });
});

const noFetch = async (): Promise<Response> => new Response('no', { status: 500 });

/** A KV seen from another location: a read returns what was written THROUGH this view, not a write made elsewhere since (KV is eventually
 *  consistent), and falls back to the store for a key this view never wrote. Every write and delete reaches the one store, last one wins. */
function laggingView(kv: KVLike, onDelete: (key: string) => void): KVLike {
  const own = new Map<string, string | null>();
  return {
    ...kv,
    get: async (k) => (own.has(k) ? own.get(k) ?? null : kv.get(k)),
    put: async (k, v, o) => { await kv.put(k, v, o); own.set(k, v); },
    delete: async (k) => { await kv.delete(k); own.set(k, null); onDelete(k); },
  };
}

describe('the route writes its tombstone again once its batch has committed (GH-1534)', () => {
  /** `dayOf(NOW)`, a literal: the day the seeded sessions stamp on their member. */
  const TODAY = 20_000;

  it('a normal delete writes the same tombstone as before, twice: before the batch, and again after it, once the gap has passed', async () => {
    const log: string[] = [];
    const h = accountHarness({
      now: NOW,
      handler: (req, e, now) => {
        const kv: KVLike = { ...e.ACCOUNT_TOMBSTONES, put: async (k, v, o) => { log.push(`put ${k} ${v} ${String(o?.expirationTtl)}`); await e.ACCOUNT_TOMBSTONES.put(k, v, o); } };
        const db: D1Like = { ...e.ACCOUNTS, batch: async (ss: D1Stmt[]) => { const out = await e.ACCOUNTS.batch(ss); log.push(`batch ${ss.length}`); return out; } };
        return handleAccount(req, { ...e, ACCOUNTS: db, ACCOUNT_TOMBSTONES: kv }, now, { fetch: noFetch, sleep: async (ms) => { log.push(`sleep ${ms}`); } });
      },
    });
    const { cookie, idHash } = await seedFullMember(h.db, NOW);
    expect((await h.call('POST', '/api/account/delete', { cookie, body: {} })).status).toBe(200);
    // Today's shape, as literals: the deletion instant and the member's own last sign-in day, for 90 days.
    const tomb = `{"deletedAt":${NOW},"lastSeenDay":${TODAY}}`;
    const put = `put tomb:${idHash} ${tomb} 7776000`;
    expect(log).toEqual([put, 'batch 17', 'sleep 1100', put]);
    expect((await h.kv.list({ prefix: '' })).keys.map((k) => k.name)).toEqual(['tomb:' + idHash]);
    expect(await h.kv.get('tomb:' + idHash)).toBe(tomb);
    expect(h.kv.ttl('tomb:' + idHash)).toBe(7_776_000);
  });

  it('a rewrite KV refuses (one write a second to a key) is tried once more after another gap; two refusals still answer 200', async () => {
    for (const refusals of [1, 2]) {
      // Two refusals leave the account with only the first write: the log line is the one evidence, so it is an ERROR, by name alone.
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const log: string[] = [];
      let puts = 0;
      const h = accountHarness({
        now: NOW,
        handler: (req, e, now) => {
          const kv: KVLike = {
            ...e.ACCOUNT_TOMBSTONES,
            put: async (k, v, o) => {
              // the first put (before the batch) goes through; the next `refusals` are refused, as KV answers 429
              if (puts++ >= 1 && puts <= 1 + refusals) { log.push('refused'); throw new Error('429'); }
              log.push('put');
              await e.ACCOUNT_TOMBSTONES.put(k, v, o);
            },
          };
          return handleAccount(req, { ...e, ACCOUNT_TOMBSTONES: kv }, now, { fetch: noFetch, sleep: async (ms) => { log.push(`sleep ${ms}`); } });
        },
      });
      const { cookie, idHash } = await seedFullMember(h.db, NOW);
      const res = await h.call('POST', '/api/account/delete', { cookie, body: {} });
      expect(res.status, String(refusals)).toBe(200);
      expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'm1'")).toBe(0);
      expect(log, String(refusals)).toEqual(refusals === 1
        ? ['put', 'sleep 1100', 'refused', 'sleep 1100', 'put']
        : ['put', 'sleep 1100', 'refused', 'sleep 1100', 'refused']);
      expect(await h.kv.get('tomb:' + idHash)).toBe(`{"deletedAt":${NOW},"lastSeenDay":${TODAY}}`); // the first write stands
      expect(error.mock.calls, String(refusals)).toEqual(refusals === 1 ? [] : [['account: tombstone rewrite failed', { error: 'Error' }]]);
      expect(warn.mock.calls, String(refusals)).toEqual([]);
      error.mockRestore();
      warn.mockRestore();
    }
  });

  it('the cron queues the member, the member signs in and deletes, and the cron prunes from a stale read: the tombstone holds', async () => {
    const cutoff = TODAY - MEMBER_IDLE_DAYS - 1;
    const timeline: string[] = [];
    // the route's pause before its rewrite: it waits there until the cron's prune has landed
    const pause = routePause(timeline);
    const h = accountHarness({ now: NOW, foreignKeys: true, handler: (req, e, now) => handleAccount(req, loggedRoute(e, timeline), now, { fetch: noFetch, sleep: pause.sleep }) });
    const hx = await sha256Hex('PUBXXXXX');
    const key = 'tomb:' + hx;
    await h.db.prepare('INSERT INTO member VALUES (?1, ?2, ?3, ?4, 1, ?5)').bind('X', 'PUBXXXXX', hx, 'uhX', cutoff - 5).run();
    let pruned = false;
    const cronKV = laggingView(h.kv, (k) => { if (k === key) { pruned = true; timeline.push('cron delete'); pause.release(); } });
    let cookie = '';
    let route: Promise<Response> | undefined;
    let signedIn = false;
    // 3. between the cron's survivor select and its prune, the member asks to delete: the route writes its tombstone and its batch
    // commits (the route then pauses before the rewrite, or returns if it has none)
    const paused = pausingAfterRead(h.db, 'SELECT id, last_seen_day FROM member WHERE id IN', async () => {
      route = h.call('POST', '/api/account/delete', { cookie, body: {} });
      await Promise.race([pause.slept, route]);
    });
    const db: D1Like = {
      ...paused,
      batch: async (ss: D1Stmt[]) => {
        if (ss.length === 17 && !signedIn) {
          // 2. the cron has queued X and written its own tombstone; X signs in just before the cron's delete batch, so its guard holds
          signedIn = true;
          expect(JSON.parse((await h.kv.get(key)) ?? '{}')).toEqual({ deletedAt: NOW, lastSeenDay: cutoff });
          const s = await createSession(h.db, 'X', NOW);
          await h.db.batch(s.statements);
          cookie = `${SESSION_COOKIE}=${s.token}`;
        }
        return h.db.batch(ss);
      },
    };
    // 1. the cron runs; 4. its survivor step reads its OWN older tombstone (the route's write is not visible here yet) and deletes the key
    expect(await accountCron(db, NOW, cronKV)).toBe(0);
    pause.release();
    expect(signedIn).toBe(true);
    expect(pruned).toBe(true); // the race happened: the cron deleted the key after the route had written it
    expect(route).toBeDefined();
    const res = await (route ?? Promise.reject(new Error('the route never ran')));
    expect(res.status).toBe(200);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'X'")).toBe(0);
    // The order that closes the race: the rewrite lands AFTER the route's batch has committed (and here after the cron's delete). A
    // rewrite moved before the batch could still be the last write in this test, but not in general: it would not outlast a prune that
    // judged the member by a read made before the batch.
    expect(timeline).toEqual([`route put ${key}`, 'route batch 17', 'route sleep 1100', 'cron delete', `route put ${key}`]);
    // the deleted account still has its tombstone, in today's shape: `gone` and a Time Travel restore both learn it was deleted
    expect(await h.kv.get(key)).toBe(`{"deletedAt":${NOW},"lastSeenDay":${TODAY}}`);
    expect(h.kv.ttl(key)).toBe(7_776_000);
    expect((await h.call('POST', '/api/account/gone', { body: { idHash: hx } })).status).toBe(410);
  });

  it('the scan: the cron reads a live member under an older tombstone, the member deletes, the cron prunes from a stale read: the tombstone holds', async () => {
    const timeline: string[] = [];
    const pause = routePause(timeline);
    const h = accountHarness({ now: NOW, handler: (req, e, now) => handleAccount(req, loggedRoute(e, timeline), now, { fetch: noFetch, sleep: pause.sleep }) });
    const { cookie, idHash } = await seedFullMember(h.db, NOW);
    const key = 'tomb:' + idHash;
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'm1' AND last_seen_day = ?1", TODAY)).toBe(1);
    let pruned = false;
    const cronKV = laggingView(h.kv, (k) => { if (k === key) { pruned = true; timeline.push('cron delete'); pause.release(); } });
    // 1. a cancelled deletion: a tombstone older than the member's sign-in today, as this cron location last read it (a stale cached read)
    await cronKV.put(key, JSON.stringify({ deletedAt: NOW - 10 * DAY, lastSeenDay: TODAY - 10 }), { expirationTtl: TOMB_TTL_S });
    let route: Promise<Response> | undefined;
    // 2. the scan reads the member, live today; 3. before its KV read of the tombstone, the member deletes: the route's put and batch land
    const db = pausingAfterRead(h.db, 'SELECT id, id_hash, last_seen_day FROM member WHERE id_hash IN', async () => {
      route = h.call('POST', '/api/account/delete', { cookie, body: {} });
      await Promise.race([pause.slept, route]);
    });
    // 4. the scan reads the older tombstone, judges it cancelled by its stale D1 row, and deletes the key
    expect(await reconcileTombstones(db, cronKV)).toBe(0);
    pause.release();
    expect(pruned).toBe(true); // the race happened: not vacuous
    const res = await (route ?? Promise.reject(new Error('the route never ran')));
    expect(res.status).toBe(200);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'm1'")).toBe(0);
    expect(timeline).toEqual([`route put ${key}`, 'route batch 17', 'route sleep 1100', 'cron delete', `route put ${key}`]);
    expect(await h.kv.get(key)).toBe(`{"deletedAt":${NOW},"lastSeenDay":${TODAY}}`);
    expect(h.kv.ttl(key)).toBe(7_776_000);
    expect((await h.call('POST', '/api/account/gone', { body: { idHash } })).status).toBe(410);
  });
});

describe('the rewrite runs under the request\'s waitUntil (GH-1534)', () => {
  /** `dayOf(NOW)`, a literal. */
  const TODAY = 20_000;
  const T = `{"deletedAt":${NOW},"lastSeenDay":${TODAY}}`;

  it('the answer comes back before the rewrite, which then waits out its gap and restores a tombstone pruned meanwhile', async () => {
    const work: Promise<unknown>[] = [];
    const timeline: string[] = [];
    const pause = routePause(timeline);
    const h = accountHarness({
      now: NOW,
      handler: (req, e, now) => handleAccount(req, loggedRoute(e, timeline), now, { fetch: noFetch, sleep: pause.sleep, waitUntil: (p) => { work.push(p); } }),
    });
    const { cookie, idHash } = await seedFullMember(h.db, NOW);
    const key = 'tomb:' + idHash;
    try {
      // The gap is held shut: an answer that waited for the rewrite would not come back in time.
      const held = new Promise<'held'>((r) => { setTimeout(() => r('held'), 250); });
      const res = await Promise.race([h.call('POST', '/api/account/delete', { cookie, body: {} }), held]);
      expect(res === 'held' ? 'held' : res.status).toBe(200);
      expect(work).toHaveLength(1);
      expect(timeline).toEqual([`route put ${key}`, 'route batch 17', 'route sleep 1100']); // answered; the rewrite has not written yet
      await h.kv.delete(key); // the cron's racing prune
      pause.release();
      await expect(work[0]).resolves.toBeUndefined();
      expect(timeline).toEqual([`route put ${key}`, 'route batch 17', 'route sleep 1100', `route put ${key}`]);
      expect(await h.kv.get(key)).toBe(T);
      expect(h.kv.ttl(key)).toBe(7_776_000);
    } finally {
      pause.release();
    }
  });

  it('the work handed to waitUntil resolves, never rejects, when both rewrites are refused, and logs one error by name', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const work: Promise<unknown>[] = [];
    let puts = 0;
    const h = accountHarness({
      now: NOW,
      handler: (req, e, now) => {
        const kv: KVLike = { ...e.ACCOUNT_TOMBSTONES, put: async (k, v, o) => { if (puts++ >= 1) throw new TypeError('429 secret detail'); await e.ACCOUNT_TOMBSTONES.put(k, v, o); } };
        return handleAccount(req, { ...e, ACCOUNT_TOMBSTONES: kv }, now, { fetch: noFetch, sleep: instantSleep, waitUntil: (p) => { work.push(p); } });
      },
    });
    const { cookie } = await seedFullMember(h.db, NOW);
    try {
      expect((await h.call('POST', '/api/account/delete', { cookie, body: {} })).status).toBe(200);
      expect(work).toHaveLength(1);
      await expect(work[0]).resolves.toBeUndefined();
      expect(puts).toBe(3);
      expect(error.mock.calls).toEqual([['account: tombstone rewrite failed', { error: 'TypeError' }]]);
    } finally {
      error.mockRestore();
    }
  });

  it('the Worker\'s fetch hands its ExecutionContext\'s waitUntil to the route, called on the context; the default gap is a 1.1 s timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    vi.setSystemTime(NOW);
    try {
      const work: Promise<unknown>[] = [];
      const ctx = {
        waitUntil(this: unknown, p: Promise<unknown>): void {
          if (this !== ctx) throw new TypeError('Illegal invocation');
          work.push(p);
        },
      };
      const h = accountHarness({ now: NOW, handler: (req, e) => worker.fetch(req, e, ctx) });
      const { cookie, idHash } = await seedFullMember(h.db, NOW);
      const key = 'tomb:' + idHash;
      expect((await h.call('POST', '/api/account/delete', { cookie, body: {} })).status).toBe(200);
      expect(work).toHaveLength(1);
      await h.kv.delete(key); // the cron's racing prune
      await vi.advanceTimersByTimeAsync(1_099);
      expect(await h.kv.get(key)).toBeNull(); // still inside the gap
      await vi.advanceTimersByTimeAsync(1);
      await work[0];
      expect(await h.kv.get(key)).toBe(T);
      expect(h.kv.ttl(key)).toBe(7_776_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** The route's pause before its rewrite: `sleep` logs its gap, says it has started (`slept`), and holds until `release()`. */
function routePause(timeline: string[]): { sleep: (ms: number) => Promise<void>; slept: Promise<void>; release: () => void } {
  let started: () => void = () => undefined;
  const slept = new Promise<void>((r) => { started = r; });
  let open: () => void = () => undefined;
  const released = new Promise<void>((r) => { open = r; });
  return { sleep: async (ms) => { timeline.push(`route sleep ${ms}`); started(); await released; }, slept, release: () => open() };
}

/** The route's env, with each tombstone put and each ACCOUNTS batch written to `timeline` once it has landed. */
function loggedRoute(e: AccountTestEnv, timeline: string[]): AccountTestEnv {
  const kv: KVLike = { ...e.ACCOUNT_TOMBSTONES, put: async (k, v, o) => { await e.ACCOUNT_TOMBSTONES.put(k, v, o); timeline.push(`route put ${k}`); } };
  const db: D1Like = { ...e.ACCOUNTS, batch: async (ss: D1Stmt[]) => { const out = await e.ACCOUNTS.batch(ss); timeline.push(`route batch ${ss.length}`); return out; } };
  return { ...e, ACCOUNTS: db, ACCOUNT_TOMBSTONES: kv };
}

/** `db`, but a statement whose SQL starts with `prefix` runs `during()` after its `all()` has read and before the caller sees the rows. */
function pausingAfterRead(db: D1Like, prefix: string, during: () => Promise<void>): D1Like {
  const wrap = (s: D1Stmt): D1Stmt => ({
    ...s,
    bind: (...v: unknown[]) => wrap(s.bind(...v)),
    all: async <T>() => {
      const rows = await s.all<T>();
      await during();
      return rows;
    },
  });
  return { ...db, prepare: (sql: string) => (sql.startsWith(prefix) ? wrap(db.prepare(sql)) : db.prepare(sql)) };
}
