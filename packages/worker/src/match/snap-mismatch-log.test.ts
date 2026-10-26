import { describe, it, expect } from 'vitest';
import { openTestD1 } from '../test-d1';
import { SNAP_MISMATCH_BUDGET, SNAP_MISMATCH_PER_ROOM, purgeSnapMismatches, writeSnapMismatch, type SnapMismatchRecord } from './snap-mismatch-log';
import worker from '../index';
import type { Env } from '../d1';

const NOW = 1_790_000_000_000;
const DAY = 86_400_000;
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const rec = (over: Partial<SnapMismatchRecord> = {}): SnapMismatchRecord => ({ code: 'ABCDEF', tick: 1199, kind: 'sha', shaA: SHA_A, shaB: SHA_B, digest: 3735928559, createdAt: NOW, ...over });
const count = (db: ReturnType<typeof openTestD1>) => (db.raw.prepare('SELECT COUNT(*) AS n FROM match_snap_mismatch').get() as { n: number }).n;

describe('writeSnapMismatch', () => {
  it('writes one row with its fields', async () => {
    const db = openTestD1();
    expect(await writeSnapMismatch(db, rec())).toBe(true);
    expect(db.raw.prepare('SELECT code, tick, kind, sha_a, sha_b, digest, created_at FROM match_snap_mismatch').all()).toEqual([
      { code: 'ABCDEF', tick: 1199, kind: 'sha', sha_a: SHA_A, sha_b: SHA_B, digest: 3735928559, created_at: NOW },
    ]);
  });

  it('a second write for the same (code, tick) is ignored and does not throw', async () => {
    const db = openTestD1();
    await writeSnapMismatch(db, rec());
    await writeSnapMismatch(db, rec({ kind: 'digest', digest: 7 }));
    expect(count(db)).toBe(1);
    expect((db.raw.prepare('SELECT kind FROM match_snap_mismatch').get() as { kind: string }).kind).toBe('sha');
  });

  it('keeps the per-room cap a literal 3 and the daily budget a literal 100', () => {
    expect(SNAP_MISMATCH_PER_ROOM).toBe(3);
    expect(SNAP_MISMATCH_BUDGET.rowsPerDay).toBe(100);
  });

  it('writes 100 rows in 24 hours, refuses the 101st and writes nothing for it, and writes again the next day', async () => {
    const db = openTestD1();
    for (let i = 0; i < 100; i++) expect(await writeSnapMismatch(db, rec({ code: `R${i}`.padEnd(6, 'X') }))).toBe(true);
    expect(count(db)).toBe(100);
    expect(await writeSnapMismatch(db, rec({ code: 'OVERFL' }))).toBe(false);
    expect(count(db)).toBe(100);
    expect(await writeSnapMismatch(db, rec({ code: 'NEXTDY', createdAt: NOW + DAY + 1 }))).toBe(true);
    expect(count(db)).toBe(101);
  });
});

describe('purgeSnapMismatches', () => {
  const RETENTION = 180 * DAY;   // spec §7's 180 days, a literal on purpose
  const codes = (db: ReturnType<typeof openTestD1>) => (db.raw.prepare('SELECT code FROM match_snap_mismatch ORDER BY code').all() as { code: string }[]).map((r) => r.code);

  it('deletes a row older than 180 days and keeps one at exactly 180 days, or younger', async () => {
    const db = openTestD1();
    await writeSnapMismatch(db, rec({ code: 'OLDOLD', createdAt: NOW - RETENTION - 1 }));
    await writeSnapMismatch(db, rec({ code: 'EDGEDG', createdAt: NOW - RETENTION }));
    await writeSnapMismatch(db, rec({ code: 'FRESHH', createdAt: NOW - DAY }));
    expect(await purgeSnapMismatches(db, NOW)).toBe(1);
    expect(codes(db)).toEqual(['EDGEDG', 'FRESHH']);
    expect(await purgeSnapMismatches(db, NOW)).toBe(0);
  });

  it('runs on the Worker\'s daily cron', async () => {
    const db = openTestD1();
    await writeSnapMismatch(db, rec({ code: 'OLDOLD', createdAt: Date.now() - RETENTION - DAY }));
    await writeSnapMismatch(db, rec({ code: 'FRESHH', createdAt: Date.now() - DAY }));
    const env = { DB: db, ASSETS: { fetch: async () => new Response('') } } as unknown as Env;
    await worker.scheduled(null, env);
    expect(codes(db)).toEqual(['FRESHH']);
  });
});
