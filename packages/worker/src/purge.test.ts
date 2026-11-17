/**
 * GH-1410, the lead's ruling of 15 Nov: everything held about an ID is deleted about 180 days after it was last seen, and the daily purge keeps
 * up with ingest. The old purge deleted at most 2,000 batch rows a day against an ingest cap of 5,000, so raw events outlived their 180 days
 * under load, and the per-player summaries were never aged out at all.
 */
import { describe, expect, it } from 'vitest';
import worker from './index';
import { EVENTS_RETENTION_MS, INGEST_DAY, PURGE_BATCH_SLICE, PURGE_BATCH_SLICES, handleIngest, purgeEvents, purgePlayers } from './ingest';
import { openTestD1 } from './test-d1';
import type { D1Like, Env } from './d1';

const NOW = 1_790_000_000_000;
const DAY = 86_400_000;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function setup() {
  const db = openTestD1();
  const n = (sql: string) => (db.raw.prepare(sql).get() as { n: number }).n;
  const player = (p: number, lastSeen: number) =>
    db.raw.prepare('INSERT INTO players (player, first_seen, last_seen, seconds_played, missions_won, tester, dev) VALUES (?, ?, ?, 60, 1, NULL, 0)').run(id(p), lastSeen - DAY, lastSeen);
  const account = (p: number, t: number) =>
    db.raw.prepare("INSERT INTO accounts (player, t, credits, earned, unlocks, tiers, dev) VALUES (?, ?, 100, 200, '[]', '[]', 0)").run(id(p), t);
  const batches = (count: number, receivedAt: number) => {
    db.raw.exec('BEGIN');
    const ins = db.raw.prepare("INSERT INTO event_batch (received_at, player, events) VALUES (?, 'p', '[]')");
    for (let i = 0; i < count; i++) ins.run(receivedAt);
    db.raw.exec('COMMIT');
  };
  const has = (table: 'players' | 'accounts', p: number) => n(`SELECT COUNT(*) AS n FROM ${table} WHERE player = '${id(p)}'`) === 1;
  return { db, n, player, account, batches, has };
}

describe('the summaries are aged out 180 days after the ID was last seen', () => {
  it('a row at EXACTLY 180 days is kept, one a millisecond older is gone, and a day-plus margin is gone', async () => {
    const h = setup();
    h.player(1, NOW - EVENTS_RETENTION_MS); // exactly 180 days: kept
    h.account(1, NOW - EVENTS_RETENTION_MS);
    h.player(2, NOW - EVENTS_RETENTION_MS - 1); // one ms over
    h.account(2, NOW - EVENTS_RETENTION_MS - 1);
    h.player(3, NOW - EVENTS_RETENTION_MS - 3 * DAY); // a margin over
    h.account(3, NOW - EVENTS_RETENTION_MS - 3 * DAY);
    h.player(4, NOW - DAY); // active
    h.account(4, NOW - DAY);
    expect(await purgePlayers(h.db, NOW)).toBe(2);
    expect(h.has('players', 1) && h.has('accounts', 1)).toBe(true);
    expect(h.has('players', 2) || h.has('accounts', 2)).toBe(false);
    expect(h.has('players', 3) || h.has('accounts', 3)).toBe(false);
    expect(h.has('players', 4) && h.has('accounts', 4)).toBe(true);
  });

  it('the account row goes with its player even when its own snapshot time is newer than the last_seen that aged the ID out', async () => {
    const h = setup();
    h.player(1, NOW - EVENTS_RETENTION_MS - DAY);
    h.account(1, NOW - DAY);
    await purgePlayers(h.db, NOW);
    expect(h.has('players', 1) || h.has('accounts', 1)).toBe(false);
  });

  it('an account row with no player row is an orphan: gone when its own time is 180 days old, kept before', async () => {
    const h = setup();
    h.account(7, NOW - EVENTS_RETENTION_MS - DAY);
    h.account(8, NOW - EVENTS_RETENTION_MS);
    h.account(9, NOW - DAY);
    await purgePlayers(h.db, NOW);
    expect([h.has('accounts', 7), h.has('accounts', 8), h.has('accounts', 9)]).toEqual([false, true, true]);
  });

  it('a stale player row without an account row is simply deleted', async () => {
    const h = setup();
    h.player(1, NOW - EVENTS_RETENTION_MS - DAY);
    expect(await purgePlayers(h.db, NOW)).toBe(1);
    expect(h.n('SELECT COUNT(*) AS n FROM players')).toBe(0);
  });

  it('a run is bounded: it deletes at most its slices, oldest first, and the next run finishes', async () => {
    const h = setup();
    const total = 2 * 5000 + 7;
    h.db.raw.exec('BEGIN');
    const ins = h.db.raw.prepare('INSERT INTO players (player, first_seen, last_seen) VALUES (?, 0, ?)');
    // 10,007 is prime and 7,919 is coprime to it, so `(i * 7919) % total` visits every age 0..10,006 exactly once, in an order unrelated to the id.
    for (let i = 0; i < total; i++) ins.run(id(i), NOW - EVENTS_RETENTION_MS - 1000 - ((i * 7919) % total));
    h.db.raw.exec('COMMIT');
    expect(await purgePlayers(h.db, NOW)).toBe(10_000);
    expect(h.n('SELECT COUNT(*) AS n FROM players')).toBe(7);
    // The oldest went first: the 7 left are the 7 NEWEST of the stale rows (ages 0..6 past the cutoff by 1,000 ms).
    expect(h.n('SELECT MIN(last_seen) AS n FROM players')).toBe(NOW - EVENTS_RETENTION_MS - 1000 - 6);
    expect(h.n('SELECT MAX(last_seen) AS n FROM players')).toBe(NOW - EVENTS_RETENTION_MS - 1000);
    expect(await purgePlayers(h.db, NOW)).toBe(7);
    expect(h.n('SELECT COUNT(*) AS n FROM players')).toBe(0);
  });
});

describe('a client clock cannot keep an ID past its retention (final privacy review)', () => {
  const TEN_YEARS = 10 * 365 * DAY;
  const base = { v: 1, player: id(7), session: id(8), build: '0.78.0' };
  const post = (h: ReturnType<typeof setup>, events: unknown[]) =>
    handleIngest(
      new Request('https://game.example.workers.dev/api/events', {
        method: 'POST',
        body: JSON.stringify({ events }),
        headers: { origin: 'https://game.example.workers.dev', 'cf-connecting-ip': '203.0.113.9' },
      }),
      { DB: h.db, ASSETS: { fetch: async () => new Response('') } } as Env,
      NOW
    );
  const fast = NOW + TEN_YEARS;
  const events = [
    { ...base, t: fast, type: 'heartbeat', mission: 'm1', tick: 1 },
    { ...base, t: fast, type: 'account', reason: 'purchase', credits: 1, earned: 1, unlocks: [], tiers: [] },
  ];

  it('a heartbeat and an account snapshot from a clock ten years fast are stored at the server time, and the ID ages out 181 days later', async () => {
    const h = setup();
    expect((await post(h, events)).status).toBe(204);
    expect(h.db.raw.prepare('SELECT first_seen, last_seen FROM players').get()).toEqual({ first_seen: NOW, last_seen: NOW });
    expect(h.db.raw.prepare('SELECT t FROM accounts').get()).toEqual({ t: NOW });
    expect(await purgePlayers(h.db, NOW + 181 * DAY)).toBe(1);
    expect(h.n('SELECT COUNT(*) AS n FROM players')).toBe(0);
    expect(h.n('SELECT COUNT(*) AS n FROM accounts')).toBe(0);
  });

  it('a later honest report cannot be held back by an earlier future one: last_seen stays at the server time', async () => {
    const h = setup();
    await post(h, events);
    await post(h, [{ ...base, t: NOW - 5_000, type: 'heartbeat', mission: 'm1', tick: 2 }]);
    expect(h.db.raw.prepare('SELECT last_seen FROM players').get()).toEqual({ last_seen: NOW });
  });

  it('rows already written with a future time are healed by the purge, then age out', async () => {
    const h = setup();
    h.player(1, NOW + TEN_YEARS);
    h.account(1, NOW + TEN_YEARS);
    expect(await purgePlayers(h.db, NOW)).toBe(0);
    expect(h.db.raw.prepare('SELECT last_seen FROM players').get()).toEqual({ last_seen: NOW });
    expect(h.db.raw.prepare('SELECT t FROM accounts').get()).toEqual({ t: NOW });
    expect(await purgePlayers(h.db, NOW + 181 * DAY)).toBe(1);
    expect(h.has('accounts', 1)).toBe(false);
  });

  it('an orphan account with a future time is healed too and then goes on its own clock', async () => {
    const h = setup();
    h.account(2, NOW + TEN_YEARS);
    await purgePlayers(h.db, NOW);
    expect(h.db.raw.prepare('SELECT t FROM accounts').get()).toEqual({ t: NOW });
    await purgePlayers(h.db, NOW + 181 * DAY);
    expect(h.has('accounts', 2)).toBe(false);
  });
});

describe('the raw purge keeps up with ingest', () => {
  it('one run can delete more than a full day of ingest (5,000 requests a day, a literal): the capacity is at least that', () => {
    expect(INGEST_DAY.global).toBe(5000);
    expect(PURGE_BATCH_SLICE * PURGE_BATCH_SLICES).toBeGreaterThanOrEqual(5000);
  });

  it(`clears a day of ingest at the cap and then some: 6,000 stale batches are gone in one run (the old 2,000 left 4,000)`, async () => {
    const h = setup();
    h.batches(6000, NOW - EVENTS_RETENTION_MS - DAY);
    h.batches(100, NOW - DAY);
    expect(await purgeEvents(h.db, NOW)).toBe(6000);
    expect(h.n('SELECT COUNT(*) AS n FROM event_batch')).toBe(100);
    expect(h.n(`SELECT COUNT(*) AS n FROM event_batch WHERE received_at < ${NOW - EVENTS_RETENTION_MS}`)).toBe(0);
  });

  it('a row at exactly 180 days is kept and one a millisecond older goes', async () => {
    const h = setup();
    h.batches(1, NOW - EVENTS_RETENTION_MS);
    h.batches(1, NOW - EVENTS_RETENTION_MS - 1);
    expect(await purgeEvents(h.db, NOW)).toBe(1);
    expect(h.n('SELECT COUNT(*) AS n FROM event_batch')).toBe(1);
  });

  it(`a run is bounded at ${PURGE_BATCH_SLICES} slices of ${PURGE_BATCH_SLICE}: more than that waits for the next day`, async () => {
    const h = setup();
    const over = PURGE_BATCH_SLICE * PURGE_BATCH_SLICES + 123;
    h.batches(over, NOW - EVENTS_RETENTION_MS - DAY);
    expect(await purgeEvents(h.db, NOW)).toBe(PURGE_BATCH_SLICE * PURGE_BATCH_SLICES);
    expect(h.n('SELECT COUNT(*) AS n FROM event_batch')).toBe(123);
  });

  it('the legacy per-event table is aged out too, within its own bound', async () => {
    const h = setup();
    h.db.raw.exec('BEGIN');
    const ins = h.db.raw.prepare("INSERT INTO events (type, player, session, build, t, received_at, payload) VALUES ('heartbeat', 'p', 's', 'b', 0, ?, '{}')");
    for (let i = 0; i < 3005; i++) ins.run(NOW - EVENTS_RETENTION_MS - DAY);
    h.db.raw.exec('COMMIT');
    // Literals, not the constant under test: the legacy slice is 3,000 rows.
    expect(await purgeEvents(h.db, NOW)).toBe(3000);
    expect(h.n('SELECT COUNT(*) AS n FROM events')).toBe(5);
  });
});

describe('the purges fit the Free plan\'s D1 query budget', () => {
  /** A D1 that counts every statement run, in a batch or not. */
  function counting(inner: D1Like): { db: D1Like; count: () => number } {
    let n = 0;
    const wrap = (sql: string) => {
      let cur = inner.prepare(sql);
      const w = {
        bind: (...v: unknown[]) => { cur = cur.bind(...v); return w; },
        run: () => { n++; return cur.run(); },
        all: <T,>() => { n++; return cur.all<T>(); },
        first: <T,>() => { n++; return cur.first<T>(); },
      };
      return w as unknown as ReturnType<D1Like['prepare']>;
    };
    // A batch's statements are counted when the batch runs them (each `run`), so the batch itself adds nothing.
    return { db: { prepare: wrap, batch: (ss) => inner.batch(ss) }, count: () => n };
  }

  it('a full-size run of both purges is a handful of statements, far under the 50 a Free invocation allows', async () => {
    const h = setup();
    h.batches(PURGE_BATCH_SLICE * PURGE_BATCH_SLICES + 10, NOW - EVENTS_RETENTION_MS - DAY);
    h.db.raw.exec('BEGIN');
    const ins = h.db.raw.prepare('INSERT INTO players (player, first_seen, last_seen) VALUES (?, 0, ?)');
    for (let i = 0; i < 10_010; i++) ins.run(id(i), NOW - EVENTS_RETENTION_MS - DAY);
    h.db.raw.exec('COMMIT');
    const c = counting(h.db);
    await purgeEvents(c.db, NOW);
    await purgePlayers(c.db, NOW);
    expect(c.count()).toBeLessThanOrEqual(12);
  });
});

describe('the cron runs them', () => {
  it('scheduled() ages out a stale player and its account and a stale batch, and leaves a fresh one', async () => {
    const h = setup();
    const now = Date.now();
    h.player(1, now - EVENTS_RETENTION_MS - 3 * DAY);
    h.account(1, now - EVENTS_RETENTION_MS - 3 * DAY);
    h.player(2, now - DAY);
    h.account(2, now - DAY);
    h.batches(1, now - EVENTS_RETENTION_MS - 3 * DAY);
    h.batches(1, now - DAY);
    const env: Env = { DB: h.db, ASSETS: { fetch: async () => new Response('') } };
    await worker.scheduled(undefined, env);
    expect([h.has('players', 1), h.has('accounts', 1)]).toEqual([false, false]);
    expect([h.has('players', 2), h.has('accounts', 2)]).toEqual([true, true]);
    expect(h.n('SELECT COUNT(*) AS n FROM event_batch')).toBe(1);
  });
});
