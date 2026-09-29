/**
 * GH-262 final fix wave: `id => sim.state.pinned[id] === 1` was written out
 * three times in `main.ts` (voice look ~2757, the feed's `pinnedOrderNote`
 * world binding ~3193, the cursor's whole-order check ~4562) — the review on
 * Task 3 parked hoisting it into one shared helper for this wave.
 *
 * Pure, like `pinned-order.ts` beside it: no DOM, no sim import, just the
 * one array read against a narrow structural shape so a test can pass a bare
 * `{ pinned: Uint8Array }` rather than building a whole `Sim`.
 */

/** The narrow slice of sim state the pinned check needs. */
export interface PinnedState {
  readonly pinned: Uint8Array;
}

export function isPinned(state: PinnedState, id: number): boolean {
  return state.pinned[id] === 1;
}

/**
 * The cursor's "every, not some" rule (GH-262 Task 6): a whole order reads
 * as pinned only when EVERY id in it is pinned, not merely one. An order
 * with a mix of pinned and free units still goes — the free units carry it —
 * so the cursor must not show "can't go" for that case.
 *
 * Deliberately returns `false` on an empty id list: no ids means no order to
 * speak for, and `[].every(...)` is vacuously `true`, which would be the
 * wrong sense of "pinned" for zero units.
 */
export function wholeOrderPinned(state: PinnedState, ids: readonly number[]): boolean {
  return ids.length > 0 && ids.every((id) => isPinned(state, id));
}
