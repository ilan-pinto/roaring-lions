// @vitest-environment jsdom
//
// The debug overlay's teardown. The instrument mounts on `document.body` in
// `main.ts`, not on the stage the router clears, so a battlefield that is left
// softly has to take it off itself -- and it puts TWO panes there, not one, so
// a teardown that remembered a single root would leave the roll feed behind.
//
// The sim here is empty on purpose, and carries no unit types: the constructor
// only stores it, and `@lions/render` may not import `@lions/data` to fetch a
// real one (the one-way dependency rule, CLAUDE.md).

import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { DebugOverlay } from './overlay';

const emptySim = (): Sim => new Sim({ seed: 1, width: 8, height: 8, capacity: 8 });

describe('DebugOverlay.destroy', () => {
  it('removes both panes from the body, and can be called twice', () => {
    const before = document.body.children.length;
    const overlay = new DebugOverlay(document.body, emptySim(), () => [], '0.1');
    expect(document.body.children.length).toBe(before + 2);
    overlay.destroy();
    expect(document.body.children.length).toBe(before);
    // Idempotent: a stale battlefield mount resolving onto an already-aborted
    // route runs its disposer after the teardown that aborted it.
    overlay.destroy();
    expect(document.body.children.length).toBe(before);
  });

  it('stays gone after being opened first', () => {
    const before = document.body.children.length;
    const overlay = new DebugOverlay(document.body, emptySim(), () => [], '0.1');
    overlay.toggle();
    overlay.destroy();
    expect(document.body.children.length).toBe(before);
  });
});
