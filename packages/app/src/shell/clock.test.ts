import { describe, expect, it } from 'vitest';
import { MAX_ACC_MS, advance, type Clock } from './clock';

describe('advance', () => {
  it('runs one tick per 50 ms of wall time at speed 1', () => {
    const c: Clock = { acc: 0, last: 0 };
    expect(advance(c, 16, 1, false, 50)).toEqual({ ticks: 0, frameMs: 16 });
    expect(advance(c, 50, 1, false, 50).ticks).toBe(1);
    expect(c.acc).toBeCloseTo(0);
  });
  it('doubles at speed 2 and runs none at speed 0', () => {
    const c: Clock = { acc: 0, last: 0 };
    expect(advance(c, 100, 2, false, 50).ticks).toBe(4);
    expect(advance(c, 200, 0, false, 50).ticks).toBe(0);
  });
  it('paused: no ticks, no accumulation, whatever the speed', () => {
    const c: Clock = { acc: 0, last: 0 };
    expect(advance(c, 1000, 2, true, 50).ticks).toBe(0);
    expect(c.acc).toBe(0);
    expect(c.last).toBe(1000);
    expect(advance(c, 1050, 1, false, 50).ticks).toBe(1); // resuming does not replay the pause
  });
  it('clamps a background-tab gap to MAX_ACC_MS so it never spirals', () => {
    const c: Clock = { acc: 0, last: 0 };
    expect(advance(c, 10_000, 1, false, 50).ticks).toBe(MAX_ACC_MS / 50);
  });
});
