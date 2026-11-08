import { describe, expect, it } from 'vitest';
import type { D1Like, D1Stmt } from '../d1';
import { TOMB_TTL_S } from './config';
import { sha256Hex } from './crypto';
import { handleAccount } from './routes';
import { reconcileTombstones } from './sweep';
import { accountHarness, memberTablesInMigration, seedFullMember, SEED_PUBLIC_ID } from './test-kit';
import { deleteMember, deleteTelemetryFor } from './delete';

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
    const db = accountHarness().env.DB;
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
        return handleAccount(req, { ...e, DB: flaky }, now);
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
    await h.kv.put('tomb:' + idHash, JSON.stringify({ deletedAt: NOW, lastSeenDay: d }));
    expect(await reconcileTombstones(h.db, h.kv)).toBe(1);
    expect(await n(h.db, "SELECT 1 FROM member WHERE id = 'm1'")).toBe(0);
  });
});
