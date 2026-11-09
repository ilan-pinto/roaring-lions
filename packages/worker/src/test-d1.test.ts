import { describe, expect, it } from 'vitest';
import { openTestD1 } from './test-d1';

describe('openTestD1 batches', () => {
  it('concurrent batches serialise: both commit, and a failing third rolls back only itself', async () => {
    const db = openTestD1();
    db.raw.exec('CREATE TABLE t (n INTEGER PRIMARY KEY)');
    const ins = (n: number) => db.prepare('INSERT INTO t VALUES (?1)').bind(n);
    const [a, b, c] = await Promise.allSettled([
      db.batch([ins(1), ins(2)]),
      db.batch([ins(3), ins(4)]),
      db.batch([ins(5), ins(1)]),
    ]);
    expect([a.status, b.status, c.status]).toEqual(['fulfilled', 'fulfilled', 'rejected']);
    expect((db.raw.prepare('SELECT n FROM t ORDER BY n').all() as { n: number }[]).map((r) => r.n)).toEqual([1, 2, 3, 4]);
  });

  it('a bare read and a bare write during a failing batch see no uncommitted rows and survive the rollback', async () => {
    const db = openTestD1();
    db.raw.exec('CREATE TABLE t (n INTEGER PRIMARY KEY)');
    db.raw.exec('CREATE TABLE side (n INTEGER)');
    const ins = (n: number) => db.prepare('INSERT INTO t VALUES (?1)').bind(n);
    const batch = db.batch([ins(1), ins(2), ins(3), ins(1)]).then(() => 'ok', () => 'rolled back');
    const other = (async () => {
      for (let i = 0; i < 3; i++) await Promise.resolve();
      const seen = await db.prepare('SELECT COUNT(*) AS c FROM t').first<{ c: number }>();
      await db.prepare('INSERT INTO side VALUES (7)').run();
      return seen?.c;
    })();
    expect(await batch).toBe('rolled back');
    expect(await other).toBe(0);
    expect(db.raw.prepare('SELECT COUNT(*) AS c FROM t').get()).toEqual({ c: 0 });
    expect(db.raw.prepare('SELECT COUNT(*) AS c FROM side').get()).toEqual({ c: 1 });
  });
});
