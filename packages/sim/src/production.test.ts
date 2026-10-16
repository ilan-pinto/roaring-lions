import { describe, expect, it } from 'vitest';
import { advance, cancel, enqueue, lineContested, spendDown, type LineItem, type ProductionLine } from './production';
import { fx } from './fixed';
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

describe('lineContested on a literal HoldView (F4 Task 4)', () => {
  it('radius edge, tunnel, air, own side and civilians', () => {
    const view = (px: number, tun = -1, air = false, side = 1) => ({
      entityCount: 1, alive: [1], side: [side], posX: [fx.from(px)], posY: [0], tunnelIn: [tun], isAir: () => air,
    });
    expect(lineContested(view(6), 0, 0, 0)).toBe(true);
    expect(lineContested(view(6.5), 0, 0, 0)).toBe(false);
    expect(lineContested(view(1, 0), 0, 0, 0)).toBe(false);
    expect(lineContested(view(1, -1, true), 0, 0, 0)).toBe(false);
    expect(lineContested(view(1, -1, false, 0), 0, 0, 0)).toBe(false);
    expect(lineContested(view(1, -1, false, 2), 0, 0, 1)).toBe(false);
  });
});

describe('spendDown (F4 Task 8, D8)', () => {
  const MENU: LineItem[] = [
    { unit: 'a', logistics: 340, intel: 0, population: 2, buildTicks: 40 },
    { unit: 'b', logistics: 235, intel: 0, population: 1, buildTicks: 40 },
  ];
  it('round-robins: item 0 first, then item 1', () => {
    expect(spendDown(MENU, -1, 700, null, true)).toBe(0);
    expect(spendDown(MENU, 0, 700, null, true)).toBe(1);
    expect(spendDown(MENU, 1, 700, null, true)).toBe(0);
  });
  it('a busy line buys nothing at any purse', () => {
    expect(spendDown(MENU, -1, 100000, null, false)).toBeNull();
  });
  it('never waits to save up: 340 is skipped for 235 at purse 300', () => {
    expect(spendDown(MENU, -1, 300, null, true)).toBe(1);
    expect(spendDown(MENU, -1, 234, null, true)).toBeNull();
  });
  it('population room: 0 buys nothing, 1 skips the 2-pop item', () => {
    expect(spendDown(MENU, -1, 700, 0, true)).toBeNull(); // every item here has population > 0
    expect(spendDown(MENU, -1, 700, 1, true)).toBe(1);
    expect(spendDown(MENU, -1, 700, 2, true)).toBe(0);
  });
  it('C-R7: a full cap still buys a population-0 item, and skips the others', () => {
    const free: LineItem[] = [...MENU, { unit: 'z', logistics: 100, intel: 0, population: 0, buildTicks: 40 }];
    expect(spendDown(free, -1, 700, 0, true)).toBe(2);
    expect(spendDown(free, -1, 700, -1, true)).toBe(2);
    expect(spendDown(free, -1, 50, 0, true)).toBeNull();
  });
  it('the property: spent down until the remainder is below the cheapest item', () => {
    const purses = Array.from({ length: 50 }, (_, k) => k * 41 - (k % 3)).map((p) => Math.max(0, Math.min(2000, p)));
    expect(purses[49]).toBe(2000);
    const menu: LineItem[] = [
      { unit: 'a', logistics: 340, intel: 0, population: 1, buildTicks: 40 },
      { unit: 'b', logistics: 235, intel: 0, population: 1, buildTicks: 40 },
      { unit: 'c', logistics: 90, intel: 0, population: 1, buildTicks: 40 },
    ];
    for (const start of purses) {
      let purse = start;
      let last = -1;
      for (let i = spendDown(menu, last, purse, null, true); i !== null; i = spendDown(menu, last, purse, null, true)) {
        purse -= menu[i].logistics;
        last = i;
        expect(purse).toBeGreaterThanOrEqual(0);
      }
      expect(purse).toBeLessThan(90);
    }
  });
});
