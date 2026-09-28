import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handleIngest } from './ingest';
import { openTestD1 } from './test-d1';
import type { Env } from './d1';

const QUERIES_SQL = readFileSync(fileURLToPath(new URL('../QUERIES.sql', import.meta.url)), 'utf8');

/** Pulls the rebuild statement out of QUERIES.sql by its GH-254 marker, so the
 *  query this test runs is the exact one the doc tells the lead to paste. */
function rebuildAccountsQuery(): string {
  const marker = '-- GH-254: rebuild the accounts summary from raw events.';
  const start = QUERIES_SQL.indexOf(marker);
  if (start === -1) throw new Error('GH-254 rebuild query marker not found in QUERIES.sql');
  const stmtStart = QUERIES_SQL.indexOf('INSERT OR REPLACE INTO accounts', start);
  const stmtEnd = QUERIES_SQL.indexOf(';', stmtStart) + 1;
  return QUERIES_SQL.slice(stmtStart, stmtEnd);
}

const P = '0f8fad5b-d9cb-469f-a165-70867728950e';
const S = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const env0 = { v: 1, player: P, session: S, build: '0.78.0' };
const acct = (t: number, credits: number, tiers: string[] = [], extra: Record<string, unknown> = {}) =>
  ({ ...env0, t, type: 'account', reason: 'purchase', credits, earned: 900, unlocks: ['mbt_lavi'], tiers, ...extra });
const hb = (t: number) => ({ ...env0, t, type: 'heartbeat', mission: 'm1', tick: 1 });

function setup() {
  const db = openTestD1();
  const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('') } };
  const post = (events: unknown[]) =>
    handleIngest(new Request('https://g.dev/api/events', { method: 'POST', body: JSON.stringify({ events }) }), env, 1_790_000_001_000);
  const rows = <T>(sql: string) => db.raw.prepare(sql).all() as T[];
  return { db, post, rows };
}

describe('accounts summary (GH-254)', () => {
  it('keeps the newest snapshot per player, with its lists as JSON', async () => {
    const h = setup();
    await h.post([acct(10, 500), acct(30, 60, ['inf_squad.armour.1'], { tester: 'dani' }), acct(20, 300)]);
    expect(h.rows('SELECT player, t, credits, earned, unlocks, tiers, tester FROM accounts')).toEqual([
      { player: P, t: 30, credits: 60, earned: 900, unlocks: '["mbt_lavi"]', tiers: '["inf_squad.armour.1"]', tester: 'dani' },
    ]);
  });

  it('a late, older snapshot in a later request cannot roll the balance back', async () => {
    const h = setup();
    await h.post([acct(30, 60)]);
    await h.post([acct(10, 500)]);
    expect(h.rows<{ credits: number }>('SELECT credits FROM accounts')[0]?.credits).toBe(60);
  });

  it('writes one accounts statement per player per request, not one per event', async () => {
    const h = setup();
    const statements: string[] = [];
    const spy = { ...h.db, batch: async (ss: Parameters<typeof h.db.batch>[0]) => { statements.push(`batch:${ss.length}`); return h.db.batch(ss); } };
    await handleIngest(
      new Request('https://g.dev/api/events', { method: 'POST', body: JSON.stringify({ events: [acct(1, 1), acct(2, 2), acct(3, 3)] }) }),
      { DB: spy, ASSETS: { fetch: async () => new Response('') } }, 1
    );
    // events batch: 3 inserts + 1 players upsert; accounts batch: 1 upsert
    expect(statements).toEqual(['batch:4', 'batch:1']);
  });

  it('R-6: with the accounts table missing, the events still land', async () => {
    const h = setup();
    h.db.raw.exec('DROP TABLE accounts');
    const res = await h.post([acct(1, 1), hb(2)]);
    expect(res.status).toBe(204);
    expect(h.rows<{ n: number }>('SELECT COUNT(*) AS n FROM events')[0]?.n).toBe(2);
  });

  it('a request with no account event writes no accounts row', async () => {
    const h = setup();
    await h.post([hb(1)]);
    expect(h.rows('SELECT * FROM accounts')).toEqual([]);
  });

  it('QUERIES.sql rebuilds accounts from events byte-for-byte (GH-254)', async () => {
    const h = setup();
    await h.post([acct(10, 500), acct(30, 60, ['inf_squad.armour.1'], { tester: 'dani' }), acct(20, 300)]);
    const before = h.rows('SELECT * FROM accounts ORDER BY player');
    h.db.raw.exec('DELETE FROM accounts');
    expect(h.rows('SELECT * FROM accounts')).toEqual([]);
    h.db.raw.exec(rebuildAccountsQuery());
    expect(h.rows('SELECT * FROM accounts ORDER BY player')).toEqual(before);
  });
});
