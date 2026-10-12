import { describe, it, expect } from 'vitest';
import { openTestD1 } from '../test-d1';
import { compactLog, writeDesync } from './desync-log';

describe('compactLog', () => {
  it('keeps only order-bearing frames and the last tick', () => {
    const frames = [{ tick: 0, cmds: [] }, { tick: 1, cmds: [{ seat: 0 as const, seq: 0, cmd: { kind: 'halt' as const, ids: [1] } }] }, { tick: 2, cmds: [] }];
    expect(compactLog(frames)).toEqual({ last: 2, orders: [frames[1]] });
  });

  it('an empty log has last -1 and no orders', () => {
    expect(compactLog([])).toEqual({ last: -1, orders: [] });
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
