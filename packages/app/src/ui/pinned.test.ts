import { describe, expect, it } from 'vitest';
import { isPinned, wholeOrderPinned, type PinnedState } from './pinned';

function stateFrom(pinnedIds: number[], size = 4): PinnedState {
  const pinned = new Uint8Array(size);
  for (const id of pinnedIds) pinned[id] = 1;
  return { pinned };
}

describe('isPinned', () => {
  it('reads the pinned array at the given id', () => {
    const state = stateFrom([1]);
    expect(isPinned(state, 0)).toBe(false);
    expect(isPinned(state, 1)).toBe(true);
  });
});

describe('wholeOrderPinned (GH-262 Task 6, "every, not some")', () => {
  it('is true when every id in the order is pinned', () => {
    const state = stateFrom([0, 1, 2]);
    expect(wholeOrderPinned(state, [0, 1, 2])).toBe(true);
  });

  // The cursor's whole point: an order that is PART pinned still goes (the
  // free units carry it), so it must not read as pinned. `.some` instead of
  // `.every` would show "can't go" for an order that will, in fact, go.
  //
  // Falsified by hand: changing `wholeOrderPinned`'s implementation from
  // `ids.every(...)` to `ids.some(...)` turns this red -- it then returns
  // `true` for a mixed 1-of-3 order.
  it('is false when only some ids in the order are pinned', () => {
    const state = stateFrom([0]);
    expect(wholeOrderPinned(state, [0, 1, 2])).toBe(false);
  });

  it('is false for an empty order (vacuous truth is the wrong sense here)', () => {
    const state = stateFrom([]);
    expect(wholeOrderPinned(state, [])).toBe(false);
  });

  it('is false when no id in the order is pinned', () => {
    const state = stateFrom([]);
    expect(wholeOrderPinned(state, [0, 1, 2])).toBe(false);
  });
});
