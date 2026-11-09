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
});
