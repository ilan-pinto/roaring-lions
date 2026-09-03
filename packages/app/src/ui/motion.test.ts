// @vitest-environment jsdom
//
// `titleCard`'s hold, with and without `dispatch` (GDD §11). The hold is
// driven entirely from JS timers (`window.setTimeout`), never from a CSS
// animation's own duration -- that is what lets it survive
// `prefers-reduced-motion` unchanged: this file's own top comment says the
// words still hold for their full read there, only the MOVEMENT drops, and
// since nothing here ever reads a CSS duration to know when to dismiss, there
// is no separate "reduced motion" code path to exercise -- every assertion
// below already proves the hold survives independently of what CSS would or
// would not have animated.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { titleCard } from './motion';

describe('titleCard', () => {
  let host: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('draws the title and subtitle with no dispatch line when the mission declares none', () => {
    titleCard(host, 'Beit Sahwan I', '2 primary objective(s)');
    expect(host.querySelector('.rl-titlecard__title')!.textContent).toBe('Beit Sahwan I');
    expect(host.querySelector('.rl-titlecard__sub')!.textContent).toBe('2 primary objective(s)');
    expect(host.querySelector('.rl-titlecard__dispatch')).toBeNull();
  });

  it('draws the dispatch line under the name when the mission has one', () => {
    titleCard(host, 'Beit Sahwan I', '2 primary objective(s)', 'Command sends you in at first light.');
    const title = host.querySelector('.rl-titlecard__title')!;
    const dispatch = host.querySelector('.rl-titlecard__dispatch')!;
    expect(dispatch.textContent).toBe('Command sends you in at first light.');
    // "under the name" -- the dispatch node follows the title node, ahead of
    // the mechanical "N primary objective(s)" line.
    expect(title.nextElementSibling).toBe(dispatch);
  });

  it('holds the mechanical default (~900ms) with no dispatch, then leaves on its own', () => {
    titleCard(host, 'X', 'Y');
    // Total time to DOM removal is hold + 250 (the dismiss timer) + 250
    // (leave()'s own fade-out delay) -- one ms short of that, still on screen.
    vi.advanceTimersByTime(900 + 250 + 250 - 1);
    expect(host.querySelector('.rl-titlecard')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(host.querySelector('.rl-titlecard')).toBeNull();
  });

  it('holds about 5s with a dispatch line -- comfortably past where the plain default would have gone', () => {
    titleCard(host, 'X', 'Y', 'A sentence or two of story prose.');
    // 1400ms is exactly where the undispatched card above disappears. This
    // card must still be up here, or dispatch is not actually extending the
    // hold, merely adding a line under an unchanged timer.
    vi.advanceTimersByTime(1400);
    expect(host.querySelector('.rl-titlecard')).not.toBeNull();
    vi.advanceTimersByTime(5000 + 250 + 250 - 1400 - 1);
    expect(host.querySelector('.rl-titlecard')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(host.querySelector('.rl-titlecard')).toBeNull();
  });

  it('any input still skips the hold, dispatch or not', () => {
    titleCard(host, 'X', 'Y', 'A dispatch line long enough that skipping it actually matters.');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    // dismiss() already ran, synchronously, off that event -- only leave()'s
    // own 250ms fade-out stands between here and the element actually
    // leaving the DOM, five seconds early.
    vi.advanceTimersByTime(249);
    expect(host.querySelector('.rl-titlecard')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(host.querySelector('.rl-titlecard')).toBeNull();
  });

  it('a pointerdown skips it exactly the same way a key does', () => {
    titleCard(host, 'X', 'Y', 'Dispatch text.');
    window.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(250);
    expect(host.querySelector('.rl-titlecard')).toBeNull();
  });
});
