/**
 * #559 M-3: /api/events and the D1 Free write budget. Before, one request
 * wrote a row per event (four indexes each) and a summary upsert per player
 * named, at 120 requests a minute per address: 50 events naming 50 players
 * was ~300 rows written per request.
 */
import { describe, expect, it } from 'vitest';
import { handleIngest, purgeEvents, INGEST_DAY, EVENTS_RETENTION_MS } from './ingest';
import { openTestD1 } from './test-d1';
import { dayOf, purgeRateDays } from './rate-day';
import type { Env } from './d1';

const NOW = 1_790_000_000_000;
const ORIGIN = 'https://game.example.workers.dev';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const hb = (player: number, tick: number) => ({ v: 1, player: id(player), session: S, build: '0.78.0', t: NOW, type: 'heartbeat', mission: 'm1', tick });

function setup(secret?: string) {
  const db = openTestD1();
  const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('') }, ...(secret ? { TICKET_SECRET: secret } : {}) };
  const post = (events: unknown[], ip = '198.51.100.7', now = NOW) =>
    handleIngest(new Request(`${ORIGIN}/api/events`, { method: 'POST', body: JSON.stringify({ events }), headers: { origin: ORIGIN, 'cf-connecting-ip': ip } }), env, now);
  const n = (sql: string) => (db.raw.prepare(sql).get() as { n: number }).n;
  return { db, env, post, n };
}

describe('#559 M-3: /api/events write budget', () => {
  it('one request is one batch row and one summary row, whatever it carries; events naming other players are dropped', async () => {
    const h = setup();
    await h.post(Array.from({ length: 50 }, (_, i) => hb(i % 2 === 0 ? 1 : 2 + i, i)));
    expect(h.n('SELECT COUNT(*) AS n FROM event_batch')).toBe(1);
    expect(h.n('SELECT COUNT(*) AS n FROM events')).toBe(0);
    expect(h.n('SELECT COUNT(*) AS n FROM players')).toBe(1);
    expect(h.n('SELECT COUNT(*) AS n FROM events_all')).toBe(25);   // player 1's own
    expect(h.n(`SELECT COUNT(DISTINCT player) AS n FROM events_all`)).toBe(1);
  });

  it('events_all reads a batch back column for column as the old events row', async () => {
    const h = setup();
    const e = { ...hb(1, 7), tester: 'dani', dev: true };
    await h.post([e]);
    const row = h.db.raw.prepare('SELECT type, player, session, tester, build, mission, t, received_at, dev, payload FROM events_all').get() as Record<string, unknown>;
    expect(row).toEqual({ type: 'heartbeat', player: id(1), session: S, tester: 'dani', build: '0.78.0', mission: 'm1', t: NOW, received_at: NOW, dev: 1, payload: JSON.stringify(e) });
  });

  it('a player is counted per day: past INGEST_DAY.player requests nothing more lands, until the next day', async () => {
    const h = setup();
    for (let i = 0; i < INGEST_DAY.player + 5; i++) await h.post([hb(1, i)], `203.0.113.${i % 200}`);
    expect(h.n('SELECT COUNT(*) AS n FROM event_batch')).toBe(INGEST_DAY.player);
    await h.post([hb(1, 0)], '203.0.113.1', NOW + 86_400_000);
    expect(h.n('SELECT COUNT(*) AS n FROM event_batch')).toBe(INGEST_DAY.player + 1);
  });

  // 605 requests, each keyed-hashing its address (HMAC through crypto.subtle):
  // past the day's cap IS the claim, so they are not cut. Measured single-file,
  // Apple M3 Pro, 2026-10-15: under 0.1 s in three runs at a load average of
  // 12-20 on 12 cores, 0.24-1.68 s in three at 31-78 (two other test loops
  // running), up to five times the player test above, which makes as many
  // requests unhashed. The 5 s crossing was reported from agents' full
  // parallel `pnpm test` runs on a loaded machine, not reproduced single-file
  // (1.68 s at most). The margin is for contention only.
  it('an address is counted per day under a keyed hash -- never the address itself -- whatever players it invents', async () => {
    const h = setup('ticket-secret');
    for (let i = 0; i < INGEST_DAY.ip + 5; i++) await h.post([hb(1000 + i, i)]);
    expect(h.n('SELECT COUNT(*) AS n FROM event_batch')).toBe(INGEST_DAY.ip);
    const keys = h.db.raw.prepare("SELECT key FROM rate_day WHERE scope = 'ingest-ip'").all() as { key: string }[];
    expect(keys).toHaveLength(1);
    expect(keys[0].key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(JSON.stringify(h.db.raw.prepare('SELECT * FROM rate_day').all())).not.toContain('198.51.100.7');
    // Another address still lands.
    await h.post([hb(1, 1)], '203.0.113.9');
    expect(h.n('SELECT COUNT(*) AS n FROM event_batch')).toBe(INGEST_DAY.ip + 1);
  }, 30_000);

  it('the same address hashes differently on another day', async () => {
    const h = setup('ticket-secret');
    await h.post([hb(1, 1)], '198.51.100.7', NOW);
    await h.post([hb(1, 2)], '198.51.100.7', NOW + 86_400_000);
    const keys = h.db.raw.prepare("SELECT key, day FROM rate_day WHERE scope = 'ingest-ip' ORDER BY day").all() as { key: string; day: number }[];
    expect(keys.map((k) => k.day)).toEqual([dayOf(NOW), dayOf(NOW) + 1]);
    expect(keys[0].key).not.toBe(keys[1].key);
  });

  it('a global ceiling bounds any number of addresses and players', async () => {
    const h = setup();
    h.db.raw.prepare('INSERT INTO rate_day (scope, key, day, n) VALUES (?, ?, ?, ?)').run('ingest-all', '', dayOf(NOW), INGEST_DAY.global);
    await h.post([hb(1, 1)]);
    expect(h.n('SELECT COUNT(*) AS n FROM event_batch')).toBe(0);
  });

  it('the cron ages raw events out after 180 days, in bounded slices, and old day counters with them', async () => {
    const h = setup();
    await h.post([hb(1, 1)], '1.1.1.1', NOW - EVENTS_RETENTION_MS - 1);
    await h.post([hb(2, 1)], '1.1.1.2', NOW);
    h.db.raw.prepare("INSERT INTO events (type, player, session, build, t, received_at, payload) VALUES ('heartbeat', 'p', 's', 'b', 0, ?, '{}')").run(NOW - EVENTS_RETENTION_MS - 1);
    expect(await purgeEvents(h.db, NOW)).toBe(2);
    expect(h.n('SELECT COUNT(*) AS n FROM events_all')).toBe(1);
    expect(await purgeRateDays(h.db, NOW)).toBeGreaterThan(0);
    expect(h.n(`SELECT COUNT(*) AS n FROM rate_day WHERE day < ${dayOf(NOW) - 1}`)).toBe(0);
  });
});
