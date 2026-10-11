import { describe, it, expect } from 'vitest';
import { LockstepClock } from './lockstep';
import { canonicalOrder, type Frame, type Stamped } from './frames';

const halt = (seat: 0 | 1, seq: number): Stamped => ({ seat, seq, cmd: { kind: 'halt', ids: [1] } });
const frame = (tick: number, cmds: Stamped[] = []): Frame => ({ tick, cmds });

describe('LockstepClock', () => {
  it('yields a frame only once it is bufferTicks behind the newest', () => {
    const c = new LockstepClock(2);
    expect(c.push(frame(0))).toBe('ok');
    expect(c.take(10)).toEqual([]);
    c.push(frame(1));
    expect(c.take(10)).toEqual([]);
    c.push(frame(2));
    expect(c.take(10)).toEqual([frame(0)]);
    expect(c.nextTick).toBe(1);
  });
  it('refuses a gap and ignores a duplicate, and never yields across either', () => {
    const c = new LockstepClock(0);
    expect(c.push(frame(0))).toBe('ok');
    expect(c.push(frame(2))).toBe('gap');
    expect(c.push(frame(0))).toBe('duplicate');
    expect(c.take(10)).toEqual([frame(0)]);
    expect(c.push(frame(1))).toBe('ok');
    expect(c.push(frame(2))).toBe('ok');
    expect(c.take(10).map((f) => f.tick)).toEqual([1, 2]);
  });
  it('caps a catch-up at maxTicks and reports how far behind it is', () => {
    const c = new LockstepClock(0);
    for (let t = 0; t < 10; t++) c.push(frame(t));
    expect(c.behind()).toBe(10);
    expect(c.take(4).map((f) => f.tick)).toEqual([0, 1, 2, 3]);
    expect(c.behind()).toBe(6);
  });
});

describe('canonicalOrder', () => {
  it('orders by seat then seq whatever the arrival order', () => {
    const got = canonicalOrder([halt(1, 0), halt(0, 2), halt(1, 1), halt(0, 1)]);
    expect(got.map((s) => [s.seat, s.seq])).toEqual([[0, 1], [0, 2], [1, 0], [1, 1]]);
  });
});
