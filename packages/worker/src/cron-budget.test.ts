/**
 * GH-1432: one `scheduled()` run stays under the Workers Free plan's 50 D1 queries per invocation, whatever the backlogs.
 * A `batch()` is ONE query however many statements it carries; everything else (`run`, `all`, `first`) is one each. The wrapper below counts
 * exactly that, on BOTH databases (the telemetry D1 and the accounts D1 share the invocation's 50).
 *
 * The seeds are the worst case each sweep can face: more expired feedback than a run clears, more raw events and stale players than the
 * slices clear, idle members past the member cap, a KV listing of dead tombstones that costs a query a page and finds nothing, and a sign-in
 * race that makes every guarded delete cost its dearest path. A run that cannot clear the backlog must still make progress: the same
 * seeds are run again until nothing is left, every run under the limit, so "bounded" cannot mean "stuck".
 */
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import worker from './index';
import { PURGE_BATCH_SLICE, PURGE_BATCH_SLICES, PURGE_PLAYER_SLICE, PURGE_PLAYER_SLICES } from './ingest';
import { PURGE_EXPIRED_BATCHES, RETENTION_MS } from './feedback-triage';
import { MEMBER_IDLE_DAYS, RECONCILE_D1_QUERIES, SWEEP_MEMBER_QUERIES } from './account/sweep';
import { accountHarness } from './account/test-kit';
import { dayOf } from './rate-day';
import type { D1Like, D1Stmt, Env } from './d1';

const DAY = 86_400_000;
const NOW = 20_000 * DAY + 3_600_000;
const OLD = NOW - RETENTION_MS - DAY;
const LIMIT = 50;
const CUTOFF = dayOf(NOW) - MEMBER_IDLE_DAYS - 1;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Meter { n: number; log: string[] }

/** Counts a query per `run`/`all`/`first` and one per `batch`; a batch's own statements are unwrapped so they are not counted again.
 *  `beforeBatch` runs ahead of a batch's statements (the sign-in race). */
function metered(db: D1Like, meter: Meter, beforeBatch?: (n: number) => void): D1Like {
  type W = D1Stmt & { inner: D1Stmt; sql: string };
  const wrap = (inner: D1Stmt, sql: string): W => ({
    inner,
    sql,
    bind: (...v) => wrap(inner.bind(...v), sql),
    run: () => { meter.n++; meter.log.push(sql.slice(0, 60)); return inner.run(); },
    all: <T>() => { meter.n++; meter.log.push(sql.slice(0, 60)); return inner.all<T>(); },
    first: <T>() => { meter.n++; meter.log.push(sql.slice(0, 60)); return inner.first<T>(); },
  });
  return {
    prepare: (sql) => wrap(db.prepare(sql), sql),
    batch: (ss) => {
      meter.n++;
      meter.log.push(`batch(${ss.length}) ${(ss[0] as W).sql.slice(0, 40)}`);
      beforeBatch?.(ss.length);
      return db.batch(ss.map((s) => (s as W).inner));
    },
  };
}

interface Seeds { feedback: number; eventBatches: number; legacyEvents: number; players: number; idleMembers: number; deadTombstones: number; liveTombstones: number }
/** Past what one run clears, for every sweep. */
const WORST: Seeds = {
  feedback: PURGE_EXPIRED_BATCHES * 100 * 4 + 50,
  eventBatches: PURGE_BATCH_SLICES * PURGE_BATCH_SLICE + 10,
  legacyEvents: 3100,
  players: PURGE_PLAYER_SLICES * PURGE_PLAYER_SLICE + 7,
  idleMembers: 60,
  deadTombstones: 1500,
  liveTombstones: 30,
};

async function world(seeds: Seeds, race = false) {
  const h = accountHarness({ now: NOW });
  const tel = (h.env.DB as unknown as { raw: DatabaseSync }).raw;
  const acc = (h.db as unknown as { raw: DatabaseSync }).raw;
  const many = (db: DatabaseSync, sql: string, count: number, row: (i: number) => unknown[]) => {
    db.exec('BEGIN');
    const ins = db.prepare(sql);
    for (let i = 0; i < count; i++) ins.run(...(row(i) as never[]));
    db.exec('COMMIT');
  };
  many(tel, `INSERT INTO feedback (id, received_at, t, player, build, source, category, text, context, shot_bytes, updated_at) VALUES (?1, ?2, 1, 'p', 'b', 'pause', 'bug', 'x', '{}', 1, 1)`, seeds.feedback, (i) => [i + 1, OLD]);
  many(tel, 'INSERT INTO feedback_picture (feedback_id, bytes) VALUES (?1, x\'00\')', seeds.feedback, (i) => [i + 1]);
  many(tel, "INSERT INTO event_batch (received_at, player, events) VALUES (?1, 'p', '[]')", seeds.eventBatches, () => [OLD]);
  many(tel, "INSERT INTO events (type, player, session, build, t, received_at, payload) VALUES ('x', 'p', 's', 'b', 1, ?1, '{}')", seeds.legacyEvents, () => [OLD]);
  many(tel, 'INSERT INTO players (player, first_seen, last_seen) VALUES (?1, 0, ?2)', seeds.players, (i) => [id(i), OLD - i]);
  many(tel, "INSERT INTO accounts (player, t, credits, earned, unlocks, tiers, dev) VALUES (?1, ?2, 1, 1, '[]', '[]', 0)", seeds.players, (i) => [id(i), OLD]);
  tel.prepare("INSERT INTO match_desync (code, tick, hash_a, hash_b, config, frames, frame_count, created_at) VALUES ('c', 1, 1, 2, '{}', '[]', 0, ?1)").run(OLD);
  tel.prepare("INSERT INTO match_snap_mismatch (code, tick, kind, sha_a, sha_b, digest, created_at) VALUES ('c', 1, 'k', 'a', 'b', 1, ?1)").run(OLD);
  tel.prepare("INSERT INTO rate_day VALUES ('s', 'k', ?1, 1)").run(dayOf(NOW) - 9);
  acc.prepare("INSERT INTO rate_day VALUES ('s', 'k', ?1, 1)").run(dayOf(NOW) - 9);
  // Idle members: the sweep tombstones and deletes them, oldest first.
  many(acc, 'INSERT INTO member VALUES (?1, ?2, ?3, ?4, 1, ?5)', seeds.idleMembers, (i) => ['idle' + i, 'PI' + i, 'hidle' + i, 'uidle' + i, CUTOFF - 100 + i]);
  // Tombstones whose members are long gone sort BEFORE the live ones, so only a scan that resumes ever reaches them.
  const dead = (i: number) => 'tomb:a' + String(i).padStart(6, '0');
  for (let i = 0; i < seeds.deadTombstones; i++) await h.kv.put(dead(i), JSON.stringify({ deletedAt: 1, lastSeenDay: 5 }));
  many(acc, 'INSERT INTO member VALUES (?1, ?2, ?3, ?4, 1, ?5)', seeds.liveTombstones, (i) => ['live' + i, 'PL' + i, 'zlive' + i, 'ulive' + i, dayOf(NOW) - 10]);
  for (let i = 0; i < seeds.liveTombstones; i++) await h.kv.put('tomb:zlive' + i, JSON.stringify({ deletedAt: 1, lastSeenDay: dayOf(NOW) - 10 }));
  const meter: Meter = { n: 0, log: [] };
  // The race: a sign-in lands just before each member delete batch (more than the sweep's five expiry statements), so every guard holds.
  const bump = (count: number) => { if (race && count > 5) acc.prepare('UPDATE member SET last_seen_day = ?1').run(dayOf(NOW)); };
  const env: Env = { ...h.env, DB: metered(h.env.DB, meter), ACCOUNTS: metered(h.db, meter, bump) };
  const count = (db: DatabaseSync, table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const left = () => ({
    feedback: (tel.prepare('SELECT COUNT(*) AS n FROM feedback WHERE shot_bytes IS NOT NULL').get() as { n: number }).n,
    pictures: count(tel, 'feedback_picture'),
    eventBatches: count(tel, 'event_batch'),
    legacyEvents: count(tel, 'events'),
    players: count(tel, 'players'),
    members: count(acc, 'member'),
  });
  return { env, meter, left, kv: h.kv };
}

async function run(w: Awaited<ReturnType<typeof world>>): Promise<number> {
  w.meter.n = 0;
  w.meter.log = [];
  await worker.scheduled(undefined, w.env);
  return w.meter.n;
}

describe('one scheduled() run stays under 50 D1 queries with worst-case backlogs (GH-1432)', () => {
  it('the static worst case of every sweep sums under the limit', () => {
    // expired + events (3 slices + legacy) + players (heal + slices + orphans) + desync + snap + rate_day (telemetry)
    // + admin views + sweep (expiry batch + idle select + member budget) + reconcile (its budget).
    const worst = PURGE_EXPIRED_BATCHES + (PURGE_BATCH_SLICES + 1) + (PURGE_PLAYER_SLICES + 2) + 3 + 1 + (2 + SWEEP_MEMBER_QUERIES) + RECONCILE_D1_QUERIES;
    expect(worst).toBeLessThan(LIMIT);
  });

  it('a run against every worst-case backlog at once, then the same backlogs run down: no run reaches 50, and none is stuck', async () => {
    const w = await world(WORST);
    const first = await run(w);
    // Not vacuous: the first run really did spend most of the budget, and left backlog behind for every sweep.
    expect(first).toBeGreaterThanOrEqual(40);
    const after = w.left();
    expect(after.feedback).toBeGreaterThan(0);
    expect(after.eventBatches).toBeGreaterThan(0);
    expect(after.players).toBeGreaterThan(0);
    expect(after.members).toBeGreaterThan(WORST.liveTombstones);
    expect(first, w.meter.log.join('\n')).toBeLessThan(LIMIT);
    const counts = [first];
    for (let i = 0; i < 60 && Object.values(w.left()).some((v) => v > 0); i++) counts.push(await run(w));
    expect(w.left()).toEqual({ feedback: 0, pictures: 0, eventBatches: 0, legacyEvents: 0, players: 0, members: 0 });
    expect(Math.max(...counts), counts.join(',')).toBeLessThan(LIMIT);
    // `members: 0` is also the proof the cursor works: the 30 live members' tombstones sort after 1,500 dead ones, which no single run reads.
  });

  it('with a sign-in racing every member delete (the dearest path: batch, check, then the cancelled tombstone), still under 50', async () => {
    const w = await world({ ...WORST, deadTombstones: 200 }, true);
    const first = await run(w);
    expect(first, w.meter.log.join('\n')).toBeLessThan(LIMIT);
    // Every sweep guard held, so the sweep spent its member budget on the dearest path and nobody was deleted.
    expect(w.meter.log.filter((s) => s.startsWith('SELECT 1 AS one FROM member')).length).toBeGreaterThanOrEqual(3);
    expect(first).toBeGreaterThanOrEqual(30);
  });

  it('a quiet day costs exactly 12: each sweep\'s fixed statements, and nothing a bound should have removed', async () => {
    const w = await world({ feedback: 0, eventBatches: 0, legacyEvents: 0, players: 0, idleMembers: 0, deadTombstones: 0, liveTombstones: 0 });
    // Telemetry: expired 1, desync 1, snap 1, events 2, players 3 (heal batch, one slice batch, orphans), rate_day 1 = 9.
    // Accounts: expiry batch 1, idle select 1, admin views 1 = 3. A tombstone listing of nothing costs no D1 query.
    // The five expiry deletes are ONE batch: un-batched, this reads 16, as the issue measured a normal day.
    expect(await run(w), w.meter.log.join('\n')).toBe(12);
  });
});
