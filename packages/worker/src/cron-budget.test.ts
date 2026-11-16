/**
 * GH-1432: one `scheduled()` run stays under the Workers Free plan's 50 D1 queries per invocation, whatever the backlogs.
 *
 * COUNTED PER STATEMENT, AS A POLICY. This is a deliberate conservative rule of this repository, not a statement of how the platform
 * counts: whether Cloudflare's D1 limits page (https://developers.cloudflare.com/d1/platform/limits/, "Queries per Worker invocation")
 * charges a `batch()` as one query or one per statement is open for the lead's reading (PR 1518, HOLD FOR LEAD item 1). Until then the
 * meter charges every statement of a batch as a query, and every `run`/`all`/`first` as one. Calls are tallied too (`calls`, a batch as
 * one), which is the looser reading. Both databases are metered into ONE count (the telemetry D1 and the accounts D1 share the
 * invocation's 50), and the 51st statement THROWS, so a run past the policy cannot pass quietly. If the lead rules that a batch is one
 * query, the limit moves onto `calls` in one line and the statement total stays pinned on its own.
 *
 * The seeds are the worst case each sweep can face: more expired feedback than a run clears, more raw events and stale players than the
 * slices clear, idle members past the member cap, a KV listing of dead tombstones that costs a query a page and finds nothing, live
 * tombstones past the reconciler's room, and a sign-in race that makes the member delete cost its dearest path. A run that cannot clear
 * the backlog must still make progress: the same seeds are run again until nothing is left, every run under the limit, so "bounded"
 * cannot mean "stuck".
 */
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import worker from './index';
import { PURGE_BATCH_SLICE, PURGE_BATCH_SLICES, PURGE_PLAYER_SLICE, PURGE_PLAYER_SLICES } from './ingest';
import { PURGE_EXPIRED_BATCHES, PURGE_EXPIRED_SLICE, PURGE_EXPIRED_STATEMENTS, RETENTION_MS } from './feedback-triage';
import { ACCOUNT_CRON_STATEMENTS, MEMBER_IDLE_DAYS, SWEEP_MEMBERS_PER_RUN } from './account/sweep';
import { DUE_MEMBERS_MAX } from './account/delete';
import { accountHarness } from './account/test-kit';
import { dayOf } from './rate-day';
import type { D1Like, D1Stmt, Env } from './d1';

const DAY = 86_400_000;
const NOW = 20_000 * DAY + 3_600_000;
const OLD = NOW - RETENTION_MS - DAY;
/** The Free plan's queries per Worker invocation. */
const LIMIT = 50;
const CUTOFF = dayOf(NOW) - MEMBER_IDLE_DAYS - 1;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Meter { n: number; calls: number; over: number; log: string[] }

/** Counts a query per `run`/`all`/`first` and one per STATEMENT of a `batch` (the batch's statements are unwrapped so they are not
 *  counted twice). The query that takes the count past `LIMIT` throws, and `over` records it even where a sweep swallows the error.
 *  `beforeBatch` runs ahead of a batch's statements (the sign-in race). */
function metered(db: D1Like, meter: Meter, beforeBatch?: (n: number) => void): D1Like {
  type W = D1Stmt & { inner: D1Stmt; sql: string };
  const spend = (k: number, what: string): void => {
    meter.calls++;
    meter.n += k;
    meter.log.push(`${meter.n} ${what}`);
    if (meter.n > LIMIT) {
      meter.over++;
      throw new Error(`D1 query ${meter.n} in one invocation, past the ${LIMIT} allowed: ${what}`);
    }
  };
  const wrap = (inner: D1Stmt, sql: string): W => ({
    inner,
    sql,
    bind: (...v) => wrap(inner.bind(...v), sql),
    run: async () => { spend(1, sql.slice(0, 60)); return inner.run(); },
    all: async <T>() => { spend(1, sql.slice(0, 60)); return inner.all<T>(); },
    first: async <T>() => { spend(1, sql.slice(0, 60)); return inner.first<T>(); },
  });
  return {
    prepare: (sql) => wrap(db.prepare(sql), sql),
    batch: async (ss) => {
      spend(ss.length, `batch(${ss.length}) ${(ss[0] as W).sql.slice(0, 40)}`);
      beforeBatch?.(ss.length);
      return db.batch(ss.map((s) => (s as W).inner));
    },
  };
}

interface Seeds { feedback: number; eventBatches: number; legacyEvents: number; players: number; idleMembers: number; deadTombstones: number; liveTombstones: number }
/** Past what one run clears, for every sweep. */
const WORST: Seeds = {
  feedback: PURGE_EXPIRED_BATCHES * PURGE_EXPIRED_SLICE * 4 + 50,
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
  const meter: Meter = { n: 0, calls: 0, over: 0, log: [] };
  // The race: a sign-in lands just before the member delete batch (more than the sweep's five expiry statements), so every guard holds.
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
  const tombs = async (prefix: string) => (await h.kv.list({ prefix })).keys.length;
  return { env, meter, left, kv: h.kv, tombs };
}

async function run(w: Awaited<ReturnType<typeof world>>): Promise<number> {
  w.meter.n = 0;
  w.meter.calls = 0;
  w.meter.log = [];
  await worker.scheduled(undefined, w.env);
  expect(w.meter.over, w.meter.log.join('\n')).toBe(0);
  return w.meter.n;
}

const memberDeletes = (log: string[]) => log.filter((s) => / batch\(17\) /.test(s)).length;

describe('one scheduled() run stays under 50 D1 queries with worst-case backlogs, counted per statement (GH-1432)', () => {
  it('the static worst case of every sweep sums under the limit', () => {
    // expired (slices x 3) + events (3 slices + legacy) + players (heal 2 + slices x 2 + orphans) + desync + snap + rate_day (telemetry)
    // + admin views + the account cron (expiry 5 + idle select + pages + ONE member delete of 17 + the survivor select).
    const worst = PURGE_EXPIRED_BATCHES * PURGE_EXPIRED_STATEMENTS + (PURGE_BATCH_SLICES + 1) + (2 + 2 * PURGE_PLAYER_SLICES + 1) + 3 + 1 + ACCOUNT_CRON_STATEMENTS;
    expect(worst).toBe(48);
    expect(worst).toBeLessThan(LIMIT);
  });

  it('the meter is not blind: a run with the limit lowered under its cost throws, and the throw is recorded', async () => {
    const w = await world(WORST);
    w.meter.n = LIMIT - 5; // as if 45 queries were already spent in this invocation
    await expect(worker.scheduled(undefined, w.env)).rejects.toThrow(/past the 50 allowed/);
    expect(w.meter.over).toBeGreaterThan(0);
  });

  it('a run against every worst-case backlog at once, then the same backlogs run down: no run reaches 50, and none is stuck', async () => {
    const w = await world(WORST);
    const first = await run(w);
    // Not vacuous: the first run really did spend most of the budget, and left backlog behind for every sweep.
    expect(first, w.meter.log.join('\n')).toBeGreaterThanOrEqual(45);
    expect(memberDeletes(w.meter.log)).toBe(1);
    const after = w.left();
    expect(after.feedback).toBeGreaterThan(0);
    expect(after.eventBatches).toBeGreaterThan(0);
    expect(after.players).toBeGreaterThan(0);
    expect(after.members).toBe(WORST.idleMembers - SWEEP_MEMBERS_PER_RUN + WORST.liveTombstones);
    expect(first, w.meter.log.join('\n')).toBeLessThan(LIMIT);
    const counts = [first];
    for (let i = 0; i < 60 && Object.values(w.left()).some((v) => v > 0); i++) counts.push(await run(w));
    expect(w.left()).toEqual({ feedback: 0, pictures: 0, eventBatches: 0, legacyEvents: 0, players: 0, members: 0 });
    expect(Math.max(...counts), counts.join(',')).toBeLessThan(LIMIT);
    // `members: 0` is also the proof the cursor works: the 30 live members' tombstones sort after 1,500 dead ones, which no single run reads.
  });

  it('a backlog of live tombstones fills the delete batch to its 40 members, in one batch, and drains', async () => {
    const w = await world({ ...WORST, deadTombstones: 0, liveTombstones: 100 });
    const first = await run(w);
    expect(first, w.meter.log.join('\n')).toBeLessThan(LIMIT);
    expect(memberDeletes(w.meter.log)).toBe(1);
    expect(w.left().members).toBe(WORST.idleMembers + 100 - DUE_MEMBERS_MAX);
    const counts = [first];
    for (let i = 0; i < 20 && w.left().members > 0; i++) counts.push(await run(w));
    expect(w.left().members).toBe(0);
    expect(Math.max(...counts), counts.join(',')).toBeLessThan(LIMIT);
  });

  it('with a sign-in racing the member delete (the dearest path: the batch, then the survivor select), still under 50', async () => {
    // 200 dead tombstones first, so the scan reads all three pages before it finds the live ones: every share at its worst.
    const w = await world({ ...WORST, deadTombstones: 200 }, true);
    const first = await run(w);
    expect(first, w.meter.log.join('\n')).toBeLessThan(LIMIT);
    // Every guard held: one delete batch, one survivor select, nobody deleted, and the cancelled tombstones pruned.
    expect(memberDeletes(w.meter.log)).toBe(1);
    expect(w.meter.log.filter((s) => / SELECT id, last_seen_day FROM member WHERE id IN/.test(s)).length).toBe(1);
    expect(w.left().members).toBe(WORST.idleMembers + WORST.liveTombstones);
    expect(await w.tombs('tomb:hidle')).toBe(0);
    expect(first).toBe(48);
  });

  it('a realistic day (a day of ingest ageing out, a few members, 90 days of tombstones) costs well under the limit and clears it', async () => {
    const w = await world({ feedback: 300, eventBatches: 5000, legacyEvents: 0, players: 2000, idleMembers: 2, deadTombstones: 200, liveTombstones: 1 });
    const n = await run(w);
    expect(n, w.meter.log.join('\n')).toBeLessThan(LIMIT);
    expect(w.left()).toEqual({ feedback: 0, pictures: 0, eventBatches: 0, legacyEvents: 0, players: 0, members: 0 });
    // Telemetry 14 (one partial feedback slice 3, events 2 + legacy 1, players 5, desync, snap, rate_day), admin views 1, accounts 26
    // (expiry 5, idle select 1, three pages over 203 tombstones, one delete batch of 17 for the two idle members and the live one).
    expect(n).toBe(41);
  });

  it('a quiet day costs exactly 20 statements in 12 calls: each sweep\'s fixed statements, and nothing a bound should have removed', async () => {
    const w = await world({ feedback: 0, eventBatches: 0, legacyEvents: 0, players: 0, idleMembers: 0, deadTombstones: 0, liveTombstones: 0 });
    // Telemetry: expired 3 (one empty slice), desync 1, snap 1, events 2, players 5 (heal 2, one slice 2, orphans 1), rate_day 1 = 13.
    // Accounts: expiry batch 5, idle select 1, admin views 1 = 7. A tombstone listing of nothing, and no one due, cost no D1 query.
    expect(await run(w), w.meter.log.join('\n')).toBe(20);
    expect(w.meter.calls).toBe(12);
  });
});
