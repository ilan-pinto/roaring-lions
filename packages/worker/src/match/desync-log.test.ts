import { describe, it, expect } from 'vitest';
import { openTestD1 } from '../test-d1';
import { DESYNC_BUDGET, compactLog, purgeDesyncs, writeDesync, MAX_FRAMES_JSON_CHARS } from './desync-log';
import worker from '../index';
import type { Env } from '../d1';

describe('compactLog', () => {
  it('keeps only order-bearing frames and the last tick', () => {
    const frames = [{ tick: 0, cmds: [] }, { tick: 1, cmds: [{ seat: 0 as const, seq: 0, cmd: { kind: 'halt' as const, ids: [1] } }] }, { tick: 2, cmds: [] }];
    expect(compactLog(frames)).toEqual({ last: 2, orders: [frames[1]] });
  });

  it('an empty log has last -1 and no orders', () => {
    expect(compactLog([])).toEqual({ last: -1, orders: [] });
  });
});

describe('compactLog under a cap', () => {
  const frame = (tick: number) => ({ tick, cmds: [{ seat: 0 as const, seq: 0, cmd: { kind: 'halt' as const, ids: [tick] } }] });
  const frames = Array.from({ length: 50 }, (_, i) => frame(i));

  it('has a cap safely under D1\'s 2 MB limit', () => {
    expect(MAX_FRAMES_JSON_CHARS).toBeLessThanOrEqual(1_500_000);
  });

  it('under the cap nothing is dropped and no marker is added', () => {
    expect(compactLog(frames, 100_000)).toEqual({ last: 49, orders: frames });
  });

  it('over the cap keeps the NEWEST orders, says how many it dropped, and fits', () => {
    const cap = 1000;
    const out = compactLog(frames, cap);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(cap);
    expect(out.last).toBe(49);
    expect(out.dropped).toBeGreaterThan(0);
    expect(out.orders.length + (out.dropped ?? 0)).toBe(50);
    expect(out.orders).toEqual(frames.slice(50 - out.orders.length));
    expect(out.orders.at(-1)?.tick).toBe(49);
  });

  it('a cap too small for any frame keeps none but still records the last tick and the count', () => {
    expect(compactLog(frames, 10)).toEqual({ last: 49, dropped: 50, orders: [] });
  });
});

describe('writeDesync', () => {
  it('writes one row, and a second write for the same tick does not throw', async () => {
    const db = openTestD1();
    const rec = { code: 'ABCDEF', tick: 40, hashA: 1, hashB: 2, config: '{}', frames: '{"last":40,"orders":[]}', frameCount: 41, createdAt: 5 };
    await writeDesync(db, rec);
    await writeDesync(db, rec);
    const rows = db.raw.prepare('SELECT code, tick, hash_a, hash_b FROM match_desync').all();
    expect(rows).toEqual([{ code: 'ABCDEF', tick: 40, hash_a: 1, hash_b: 2 }]);
  });
});

describe('#559 M-2: the daily desync budget', () => {
  const NOW = 1_790_000_000_000;
  const rec = (tick: number, frames = '{}', createdAt = NOW) => ({ code: 'ABCDEF', tick, hashA: 1, hashB: 2, config: '{}', frames, frameCount: 1, createdAt });
  it('writes at most DESYNC_BUDGET.rowsPerDay rows in 24 hours, and again the next day', async () => {
    const db = openTestD1();
    const results: boolean[] = [];
    for (let i = 0; i < DESYNC_BUDGET.rowsPerDay + 5; i++) results.push(await writeDesync(db, rec(i)));
    expect(results.filter(Boolean)).toHaveLength(DESYNC_BUDGET.rowsPerDay);
    expect((db.raw.prepare('SELECT COUNT(*) AS n FROM match_desync').get() as { n: number }).n).toBe(DESYNC_BUDGET.rowsPerDay);
    expect(await writeDesync(db, rec(999, '{}', NOW + 86_400_001))).toBe(true);
  });
  it('refuses a row that would take the day past DESYNC_BUDGET.charsPerDay', async () => {
    const db = openTestD1();
    const big = 'x'.repeat(MAX_FRAMES_JSON_CHARS);
    let written = 0;
    for (let i = 0; i < 30; i++) if (await writeDesync(db, rec(i, big))) written++;
    expect(written).toBe(Math.floor(DESYNC_BUDGET.charsPerDay / (MAX_FRAMES_JSON_CHARS + 2)));
  });
  it('one row is at most MAX_FRAMES_JSON_CHARS of frames: a quarter megabyte', () => {
    expect(MAX_FRAMES_JSON_CHARS).toBeLessThanOrEqual(256_000);
  });
});

// N1b final fix wave (M-6): the row keeps player-typed callsigns inside
// `config`, so it goes at the feedback tables' 180 days, on the same daily cron.
describe('purgeDesyncs', () => {
  const NOW = 1_790_000_000_000;
  const DAY = 86_400_000;
  const RETENTION_MS = 180 * DAY;   // spec §7's 180 days, a literal on purpose
  const rec = (code: string, createdAt: number) => ({ code, tick: 40, hashA: 1, hashB: 2, config: '{"seats":[{"callsign":"Ari"}]}', frames: '{"last":40,"orders":[]}', frameCount: 41, createdAt });
  const codes = (db: ReturnType<typeof openTestD1>) => (db.raw.prepare('SELECT code FROM match_desync ORDER BY code').all() as { code: string }[]).map((r) => r.code);

  it('deletes a desync older than 180 days and keeps one at exactly 180 days, or younger', async () => {
    const db = openTestD1();
    await writeDesync(db, rec('OLDOLD', NOW - RETENTION_MS - 1));
    await writeDesync(db, rec('EDGEDG', NOW - RETENTION_MS));
    await writeDesync(db, rec('FRESHH', NOW - DAY));
    expect(await purgeDesyncs(db, NOW)).toBe(1);
    expect(codes(db)).toEqual(['EDGEDG', 'FRESHH']);
    expect(await purgeDesyncs(db, NOW)).toBe(0);
  });

  it('runs on the Worker\'s daily cron, beside the feedback purge', async () => {
    const db = openTestD1();
    await writeDesync(db, rec('OLDOLD', Date.now() - RETENTION_MS - DAY));
    await writeDesync(db, rec('FRESHH', Date.now() - DAY));
    const env = { DB: db, ASSETS: { fetch: async () => new Response('') } } as unknown as Env;
    await worker.scheduled(null, env);
    expect(codes(db)).toEqual(['FRESHH']);
  });
});
