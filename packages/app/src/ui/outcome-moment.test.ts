// packages/app/src/ui/outcome-moment.test.ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDialogOpen } from './confirm';
import { OUTCOME_HOLD_MS, outcomeMoment } from './outcome-moment';

let host: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  delete document.documentElement.dataset.motion;
});

describe('outcomeMoment', () => {
  it('covers the viewport and names the outcome in the DOM, not in a colour alone', () => {
    const m = outcomeMoment(host, { outcome: 'victory', title: 'Foothold taken' });
    expect(m.el.dataset.outcome).toBe('victory');
    expect(m.el.classList.contains('rl-outcome')).toBe(true);
    expect(m.el.getAttribute('role')).toBe('dialog');
    expect(m.el.getAttribute('aria-modal')).toBe('true');
    m.dismiss();
  });

  it('is a dialog to the game’s own handler-wide guard', () => {
    expect(isDialogOpen()).toBe(false);
    const m = outcomeMoment(host, { outcome: 'defeat', title: 'Position lost' });
    expect(isDialogOpen()).toBe(true);
    m.dismiss();
    expect(isDialogOpen()).toBe(false);
  });

  it('holds, then resolves on its own', async () => {
    const m = outcomeMoment(host, { outcome: 'victory', title: 'x' });
    let settled = false;
    void m.done.then(() => {
      settled = true;
    });
    vi.advanceTimersByTime(OUTCOME_HOLD_MS - 1);
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(2);
    await Promise.resolve();
    expect(settled).toBe(true);
  });

  // titleCard's rule (motion.ts:106-107): a held card the player cannot skip
  // is a held card the player resents.
  //
  // Binding scan (preflight-scan.md, T5 row / M5): dispatched on
  // `document.body` with `{ bubbles: true }`, exactly like
  // `confirm.test.ts`'s own capture-vs-bubble tests, rather than directly on
  // `window`. A direct `window.dispatchEvent` makes window both the event's
  // target and the only node in its path, which collapses capture- and
  // bubble-registered listeners into plain registration order and proves
  // nothing about the skip guard's phase -- see the next test, which needs
  // the real path to see a `stopPropagation()` bug at all.
  it('any key skips it, at once, regardless of the hold', async () => {
    const m = outcomeMoment(host, { outcome: 'victory', title: 'x' });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
    await expect(m.done).resolves.toBeUndefined();
  });

  // Final review, ruling 3. A player holding a pan key when the mission ends
  // is already sending keydowns, and the browser repeats a held key about
  // thirty times a second: without this, the first REPEAT ended the moment
  // before it was ever seen. An autorepeat is not a decision to skip, so it
  // is swallowed -- it still must not reach the game -- and the moment holds.
  // The game listener is registered before the moment opens, the way the
  // "stops a key from reaching the game" test below registers its own.
  it('a held key’s autorepeat neither ends it nor reaches the game', async () => {
    const seen: string[] = [];
    const game = (e: KeyboardEvent): void => {
      seen.push(e.key);
    };
    window.addEventListener('keydown', game);
    const m = outcomeMoment(host, { outcome: 'victory', title: 'x' });
    try {
      let settled = false;
      void m.done.then(() => {
        settled = true;
      });
      for (let i = 0; i < 5; i++) {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', repeat: true, bubbles: true }));
      }
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(m.el.isConnected).toBe(true);
      expect(seen).toEqual([]);
      // A fresh press is still a skip.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
      await expect(m.done).resolves.toBeUndefined();
    } finally {
      m.dismiss();
      window.removeEventListener('keydown', game);
    }
  });

  it('a click skips it too', async () => {
    const m = outcomeMoment(host, { outcome: 'defeat', title: 'x' });
    window.dispatchEvent(new PointerEvent('pointerdown'));
    await expect(m.done).resolves.toBeUndefined();
  });

  // The game's Escape opens the pause menu. While this is up it must not.
  //
  // Binding scan (T5 row): dispatched on `document.body` with
  // `{ bubbles: true }`, with the counting listener registered on `window`
  // BEFORE the moment opens -- the same idiom `confirm.test.ts`'s
  // "stops a game-verb key from reaching a bubble-phase window listener
  // while open" uses. Falsified by hand: dispatching directly on `window`
  // instead (as this test's brief draft did) stays green even for a BROKEN
  // bubble-phase-only skip listener, because window has no ancestor to
  // propagate away from and every same-target listener fires regardless of
  // phase or registration order -- it is this shape, not that one, that can
  // tell a capture-phase `stopPropagation()` guard from one that only looks
  // like it.
  it('stops a key from reaching the game at all', () => {
    const seen: string[] = [];
    window.addEventListener('keydown', (e) => seen.push(e.key));
    const m = outcomeMoment(host, { outcome: 'victory', title: 'x' });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(seen).toEqual([]);
    m.dismiss();
  });

  it('dismiss is idempotent, takes the node off, and settles done()', async () => {
    const m = outcomeMoment(host, { outcome: 'victory', title: 'x' });
    m.dismiss();
    m.dismiss();
    await expect(m.done).resolves.toBeUndefined();
    expect(host.childElementCount).toBe(0);
  });

  // A teardown mid-hold must not leave a pending promise that nothing settles
  // -- the failure `loading.ts`'s own `dispose()` doc comment describes.
  it('a teardown during the hold settles rather than hangs', async () => {
    const m = outcomeMoment(host, { outcome: 'defeat', title: 'x' });
    vi.advanceTimersByTime(OUTCOME_HOLD_MS / 2);
    m.dismiss();
    await expect(m.done).resolves.toBeUndefined();
  });

  // prefers-reduced-motion drops the animation and keeps the duration
  // (motion.ts:104-105) -- the hold is a JS timer, so it cannot be a
  // CSS transition that a media query switches off.
  //
  // Binding scan (M5): the brief's own draft never actually turned reduced
  // motion on and never asserted the eventual settle, so it stayed green
  // even for an implementation that ignored `holdMs` outright. This sets
  // `data-motion='reduce'` the way `settings.ts`'s `applySettings` does, and
  // asserts BOTH ends of the window: not settled one tick early, settled one
  // tick late -- the exact boundary a reduced-motion-shortens-the-hold
  // mutation would move.
  it('holds for the same time with reduced motion', async () => {
    document.documentElement.dataset.motion = 'reduce';
    const m = outcomeMoment(host, { outcome: 'victory', title: 'x', holdMs: 1000 });
    let settled = false;
    void m.done.then(() => {
      settled = true;
    });
    vi.advanceTimersByTime(999);
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(2);
    await Promise.resolve();
    expect(settled).toBe(true);
  });

  it('shows the mission’s own line when there is one, and nothing when there is not', () => {
    const a = outcomeMoment(host, { outcome: 'victory', title: 'x', line: 'The town is ours.' });
    expect(a.el.querySelector('.rl-outcome__line')?.textContent).toBe('The town is ours.');
    a.dismiss();
    const b = outcomeMoment(host, { outcome: 'victory', title: 'x' });
    expect(b.el.querySelector('.rl-outcome__line')).toBeNull();
    b.dismiss();
  });

  // Binding scan (M4): the brief's own draft focuses the ONE focusable
  // element already inside the root and presses Tab -- since jsdom never
  // moves focus on a synthetic Tab by itself, `el.contains(activeElement)`
  // stays true whether or not a trap exists at all, so that test cannot
  // fail. With only one focusable element in this moment (the skip button,
  // by design -- see the file header), the "wrap from last to first"
  // construction `focus-trap.test.ts` uses degenerates the same way (last
  // and first are the same element). The construction that IS falsifiable
  // with a single focusable is `focus-trap.test.ts`'s other one: focus
  // something OUTSIDE the root, press Tab, and require the trap to pull
  // focus back in. Falsified by hand: commenting out the `focusTrap(p.el)`
  // call in outcome-moment.ts turns this red -- `document.activeElement`
  // stays on `outside`, because jsdom does not move it by itself.
  it('traps Tab inside itself', () => {
    const m = outcomeMoment(host, { outcome: 'victory', title: 'x' });
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(m.el.contains(document.activeElement)).toBe(true);
    m.dismiss();
  });
});
