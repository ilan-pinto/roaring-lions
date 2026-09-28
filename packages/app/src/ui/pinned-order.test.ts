import { describe, expect, it } from 'vitest';
import { INITIAL_PINNED_NOTE, PINNED_NOTE_MS, pinnedOrderNote, type PinnedOrderWorld } from './pinned-order';

const W = (pinned: number[], routed: number[] = [], soft: number[] = []): PinnedOrderWorld => ({
  pinned: (i) => pinned.includes(i) || routed.includes(i), // the sim flags a routed unit pinned too
  routed: (i) => routed.includes(i),
  soft: (i) => soft.includes(i),
});
const move = (...ids: number[]) => ({ kind: 'order' as const, verb: 'move' as const, ids, x: 1, y: 1, append: false });

describe('an order to a pinned unit says why it waits (GH-262)', () => {
  it('says nothing when nobody is pinned', () => {
    expect(pinnedOrderNote(INITIAL_PINNED_NOTE, move(1, 2), W([]), 0).line).toBeNull();
  });
  it('counts only the pinned units, in warn', () => {
    expect(pinnedOrderNote(INITIAL_PINNED_NOTE, move(1, 2, 3), W([2, 3]), 0).line).toEqual({ key: 'order.pinned.note', params: { n: 2 }, tone: 'warn' });
  });
  it('warns that infantry may break', () => {
    expect(pinnedOrderNote(INITIAL_PINNED_NOTE, move(1), W([1], [], [1]), 0).line?.key).toBe('order.pinned.note.soft');
  });
  it('a routed unit’s dropped order outranks, in bad', () => {
    expect(pinnedOrderNote(INITIAL_PINNED_NOTE, move(1, 2), W([1], [2]), 0).line).toEqual({ key: 'order.broken.note', params: { n: 1 }, tone: 'bad' });
  });
  it('one line per burst: the same set inside PINNED_NOTE_MS is silent', () => {
    const a = pinnedOrderNote(INITIAL_PINNED_NOTE, move(1), W([1]), 0);
    expect(pinnedOrderNote(a.state, move(1), W([1]), PINNED_NOTE_MS - 1).line).toBeNull();
    expect(pinnedOrderNote(a.state, move(1), W([1]), PINNED_NOTE_MS).line).not.toBeNull();
  });
  it('throttles by the pinned subset, not the whole order (a wider order first must not reset the key)', () => {
    const a = pinnedOrderNote(INITIAL_PINNED_NOTE, move(1, 2), W([1]), 0);
    expect(pinnedOrderNote(a.state, move(1), W([1]), 1).line).toBeNull();
  });
  it('ignores every non-order intent', () => {
    expect(pinnedOrderNote(INITIAL_PINNED_NOTE, { kind: 'halt', ids: [1] }, W([1]), 0).line).toBeNull();
  });

  // Final fix wave (GH-262): the pinned line already throttled by
  // PINNED_NOTE_MS (see "one line per burst" above); the broken line did
  // not, so repeated right-clicks on a routed unit flooded the feed with
  // `order.broken.note` on every single click. Same window, same
  // same-id-set key shape as the pinned throttle.
  //
  // Falsified by hand: before this fix, the second call here (at
  // `PINNED_NOTE_MS - 1`) returned the line again instead of `null`.
  it('throttles the broken line the same 4000ms way as the pinned line', () => {
    const a = pinnedOrderNote(INITIAL_PINNED_NOTE, move(1, 2), W([1], [2]), 0);
    expect(a.line).toEqual({ key: 'order.broken.note', params: { n: 1 }, tone: 'bad' });
    const b = pinnedOrderNote(a.state, move(1, 2), W([1], [2]), PINNED_NOTE_MS - 1);
    expect(b.line).toBeNull();
    const c = pinnedOrderNote(b.state, move(1, 2), W([1], [2]), PINNED_NOTE_MS);
    expect(c.line).not.toBeNull();
  });
});
