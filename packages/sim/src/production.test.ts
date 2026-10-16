import { describe, expect, it } from 'vitest';
import { advance, cancel, enqueue, type LineItem, type ProductionLine } from './production';
import { MAX_LINE_QUEUE } from './tuning';

const item = (unit = 'a'): LineItem => ({ unit, logistics: 300, intel: 0, population: 1, buildTicks: 40 });
const line = (): ProductionLine => ({ side: 0, anchor: 0, queue: [], current: null, ticksLeft: 0, rally: null });

/** Calls (1-based) on which an item finished, over `n` calls; `contested` is the set of call numbers. */
function finishes(l: ProductionLine, n: number, contested: ReadonlySet<number> = new Set()): number[] {
  const out: number[] = [];
  for (let c = 1; c <= n; c++) if (advance(l, contested.has(c)) !== null) out.push(c);
  return out;
}

describe('production line (F4 Task 2)', () => {
  it('two items finish on calls 40 and 80, not both on 40', () => {
    const l = line();
    enqueue(l, item('a'));
    enqueue(l, item('b'));
    expect(finishes(l, 100)).toEqual([40, 80]);
  });

  it('returns the finished item itself, in order', () => {
    const l = line();
    enqueue(l, item('a'));
    enqueue(l, item('b'));
    const got: string[] = [];
    for (let c = 0; c < 80; c++) {
      const done = advance(l, false);
      if (done !== null) got.push(done.unit);
    }
    expect(got).toEqual(['a', 'b']);
  });

  it('ten contested calls in the middle push the first finish to call 50', () => {
    const l = line();
    enqueue(l, item());
    const contested = new Set<number>();
    for (let c = 11; c <= 20; c++) contested.add(c);
    expect(finishes(l, 60, contested)).toEqual([50]);
  });

  it('an item whose 40th count falls on a contested call finishes on the first clear call after', () => {
    const l = line();
    enqueue(l, item());
    const contested = new Set([40, 41, 42]);
    expect(finishes(l, 60, contested)).toEqual([43]);
  });

  it('cancelling the item in progress returns it and the next starts with its full time', () => {
    const l = line();
    enqueue(l, item('a'));
    enqueue(l, item('b'));
    for (let c = 0; c < 15; c++) advance(l, false);
    expect(l.ticksLeft).toBe(25);
    expect(cancel(l, -1)?.unit).toBe('a');
    expect(l.current?.unit).toBe('b');
    expect(l.ticksLeft).toBe(40);
    expect(l.queue).toHaveLength(0);
  });

  it('cancelling the only item idles the line', () => {
    const l = line();
    enqueue(l, item('a'));
    expect(cancel(l, -1)?.unit).toBe('a');
    expect(l.current).toBeNull();
    expect(l.ticksLeft).toBe(0);
    expect(cancel(l, -1)).toBeNull();
  });

  it('cancelling a queue index leaves current and ticksLeft alone; an empty index is null and a no-op', () => {
    const l = line();
    enqueue(l, item('a'));
    enqueue(l, item('b'));
    for (let c = 0; c < 15; c++) advance(l, false);
    expect(cancel(l, 1)).toBeNull();
    expect(l.queue.map((q) => q.unit)).toEqual(['b']);
    expect(cancel(l, -2)).toBeNull();
    expect(cancel(l, 0)?.unit).toBe('b');
    expect(l.queue).toHaveLength(0);
    expect(l.current?.unit).toBe('a');
    expect(l.ticksLeft).toBe(25);
  });

  it('an empty line returns null for 100 calls and stays idle', () => {
    const l = line();
    for (let c = 0; c < 100; c++) expect(advance(l, c % 2 === 0)).toBeNull();
    expect(l.current).toBeNull();
    expect(l.ticksLeft).toBe(0);
  });

  it('enqueue accepts one current plus MAX_LINE_QUEUE waiting and refuses the next', () => {
    const l = line();
    for (let k = 0; k < 1 + MAX_LINE_QUEUE; k++) expect(enqueue(l, item(`u${k}`))).toBe(true);
    expect(l.queue).toHaveLength(16);
    expect(enqueue(l, item('over'))).toBe(false);
    expect(l.queue).toHaveLength(16);
    expect(l.queue.some((q) => q.unit === 'over')).toBe(false);
  });

  it('an item enqueued on an idle line is current at once with its full time', () => {
    const l = line();
    enqueue(l, item('a'));
    expect(l.current?.unit).toBe('a');
    expect(l.ticksLeft).toBe(40);
    expect(l.queue).toHaveLength(0);
  });
});
