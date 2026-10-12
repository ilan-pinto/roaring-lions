import { describe, it, expect } from 'vitest';
import { openTestD1 } from '../test-d1';
import { compactLog, writeDesync, MAX_FRAMES_JSON_CHARS } from './desync-log';

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
