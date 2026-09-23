// packages/app/src/ui/focus-trap.test.ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { focusTrap } from './focus-trap';

const build = (): HTMLElement => {
  const outside = document.createElement('button');
  outside.textContent = 'outside';
  const box = document.createElement('div');
  box.innerHTML =
    '<button id="a">a</button><button id="b" disabled>b</button>' +
    '<a id="c" href="#x">c</a><input id="d">';
  document.body.append(outside, box);
  return box;
};
afterEach(() => document.body.replaceChildren());

const tab = (shift = false): void => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, cancelable: true }));
};

describe('focusTrap', () => {
  it('wraps from the last focusable to the first', () => {
    const box = build();
    const off = focusTrap(box);
    box.querySelector<HTMLElement>('#d')?.focus();
    tab();
    expect(document.activeElement?.id).toBe('a');
    off();
  });

  it('wraps backwards from the first to the last', () => {
    const box = build();
    const off = focusTrap(box);
    box.querySelector<HTMLElement>('#a')?.focus();
    tab(true);
    expect(document.activeElement?.id).toBe('d');
    off();
  });

  it('skips a disabled control rather than parking focus on it', () => {
    const box = build();
    const off = focusTrap(box);
    box.querySelector<HTMLElement>('#a')?.focus();
    tab();
    expect(document.activeElement?.id).toBe('c');
    off();
  });

  // The bug this exists for: Tab from inside an open dialog reaching the
  // page behind it.
  it('pulls focus back in when it has escaped to the page', () => {
    const box = build();
    const off = focusTrap(box);
    document.querySelector<HTMLElement>('button')?.focus();
    tab();
    expect(box.contains(document.activeElement)).toBe(true);
    off();
  });

  // Fix round 1 (binding scan): dispatched on `document.body` with
  // `{ bubbles: true }`, with the counting listener on `window` in the
  // BUBBLE phase -- the same idiom `confirm.test.ts`'s own capture-vs-bubble
  // tests use. Dispatching directly on `window` (as this test used to)
  // makes window both the target and the only node in the path, which
  // collapses capture and bubble into plain registration order and cannot
  // observe a `stopPropagation()` bug at all: window has no ancestor to
  // propagate away from, so every listener on it fires regardless. Routing
  // through `document.body` gives the event a real path (window ->
  // document -> ... -> body), so a capture-phase `stopPropagation()` on
  // `window` genuinely stops the event from ever reaching the target and
  // bubbling back to window's own bubble-phase listener -- which is exactly
  // what this test needs to be able to see. Falsified by hand: adding
  // `e.stopPropagation()` to the trap's `onKey` turns this red (`seen`
  // stays 0), confirming the dispatch shape actually exercises the guard
  // it is named for.
  it('leaves every other key alone', () => {
    const box = build();
    const off = focusTrap(box);
    let seen = 0;
    const listener = (): void => {
      seen++;
    };
    window.addEventListener('keydown', listener);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(seen).toBe(1);
    window.removeEventListener('keydown', listener);
    off();
  });

  it('a root with nothing focusable is a no-op, not a throw', () => {
    const empty = document.createElement('div');
    document.body.appendChild(empty);
    const off = focusTrap(empty);
    expect(() => tab()).not.toThrow();
    off();
  });

  it('the disposer takes the listener off and is idempotent', () => {
    const box = build();
    const off = focusTrap(box);
    off();
    off();
    document.querySelector<HTMLElement>('button')?.focus();
    tab();
    expect(box.contains(document.activeElement)).toBe(false);
  });

  // M9/P19 falsification: querying the focusables ONCE at install time
  // instead of at every keypress is the mutation this test exists to catch --
  // every caller here rebuilds its own body after mount (the tracker
  // repaints from a thunk, the keys overlay repaints on a rebind), so a list
  // captured up front goes stale silently. Proved red by hand: replacing the
  // trap's `focusablesIn(root)` call with a list captured once before the
  // event listener is installed leaves this test failing, because `#e` (added
  // after `focusTrap` runs) is invisible to it.
  it('re-reads the focusable list on every keypress, not once at install', () => {
    const box = build();
    const off = focusTrap(box);
    const e = document.createElement('button');
    e.id = 'e';
    box.appendChild(e); // a body rebuild after install, exactly like a refresh()
    box.querySelector<HTMLElement>('#d')?.focus();
    tab();
    // An install-time list would still be [a, c, d] and wrap straight to
    // 'a'; the live list is [a, c, d, e], so the next stop is the
    // newly-added 'e'.
    expect(document.activeElement?.id).toBe('e');
    tab();
    expect(document.activeElement?.id).toBe('a'); // now wraps past 'e' too
    off();
  });

  // A `[hidden]` subtree (a pause-menu tab that is not the active one, for
  // instance) must not offer up focus that CSS would never let the player
  // reach -- the selector alone cannot see `hidden`, since jsdom applies no
  // stylesheet, so the trap has to filter it explicitly.
  it('skips a focusable element inside a hidden subtree of root', () => {
    const box = build();
    const hiddenPane = document.createElement('div');
    hiddenPane.hidden = true;
    const e = document.createElement('button');
    e.id = 'e';
    hiddenPane.appendChild(e);
    box.appendChild(hiddenPane);
    const off = focusTrap(box);
    box.querySelector<HTMLElement>('#d')?.focus();
    tab();
    expect(document.activeElement?.id).toBe('a'); // #e was skipped, not landed on
    off();
  });
});

// Fix round 1: two traps stacked, as a confirm opened from the pause menu's
// own Restart/Quit does over pause's own trap. `named()` stands in for each
// dialog's own root -- two focusable buttons, ids prefixed so two roots can
// coexist in the same test without collision.
const named = (prefix: string): HTMLElement => {
  const box = document.createElement('div');
  box.innerHTML = `<button id="${prefix}-1">1</button><button id="${prefix}-2">2</button>`;
  document.body.appendChild(box);
  return box;
};

describe('focusTrap stacking (fix round 1)', () => {
  // The bug this exists for: without arbitration, the OUTER (pause) trap
  // sees focus land inside the INNER (confirm) root and pulls it back into
  // its own panel, then the inner trap sees focus outside ITS root and
  // resets it again -- Tab can never actually move between confirm's own
  // two buttons. Falsified by hand: removing the `stack[stack.length - 1]
  // !== token` check (every trap acts on every Tab) turns this red --
  // `document.activeElement` ends up back on Cancel instead of Yes.
  it('only the innermost trap acts: Tab from Cancel lands on Yes, Shift+Tab from Yes lands on Cancel', () => {
    const outer = named('outer-a'); // stands in for pause's own panel
    const offOuter = focusTrap(outer);
    const inner = named('inner-a'); // stands in for confirm, opened on top
    const offInner = focusTrap(inner);

    const cancel = inner.querySelector<HTMLElement>('#inner-a-1')!;
    const yes = inner.querySelector<HTMLElement>('#inner-a-2')!;
    cancel.focus();
    tab();
    expect(document.activeElement).toBe(yes);

    tab(true);
    expect(document.activeElement).toBe(cancel);

    offInner();
    offOuter();
  });

  // Falsified by hand: a disposer that removes its window listener but
  // never touches `stack` (forgets to pop/splice its own token at all)
  // turns this red -- confirm's stale token is left on top forever, pause's
  // own trap keeps reading itself as "not innermost", and Tab does nothing
  // inside pause even though confirm's listener is long gone.
  it('after the inner trap disposes, Tab wraps inside the outer trap again', () => {
    const outer = named('outer-b');
    const offOuter = focusTrap(outer);
    const inner = named('inner-b');
    const offInner = focusTrap(inner);
    offInner(); // confirm closes

    const first = outer.querySelector<HTMLElement>('#outer-b-1')!;
    const last = outer.querySelector<HTMLElement>('#outer-b-2')!;
    last.focus();
    tab();
    expect(document.activeElement).toBe(first);

    offOuter();
  });

  // Falsified by hand: a disposer that does `stack.pop()` unconditionally
  // (instead of removing ITS OWN token via `indexOf`/`splice`) turns this
  // red -- disposing the outer trap first pops the INNER trap's token off
  // the top by mistake, so the still-open inner trap reads itself as no
  // longer innermost and stops responding to Tab at all, even though its
  // own listener was never removed.
  it('disposing the OUTER trap first leaves the inner one working', () => {
    const outer = named('outer-c');
    const offOuter = focusTrap(outer);
    const inner = named('inner-c');
    const offInner = focusTrap(inner);

    offOuter(); // out of order: the outer trap closes while the inner one is still open

    const first = inner.querySelector<HTMLElement>('#inner-c-1')!;
    const last = inner.querySelector<HTMLElement>('#inner-c-2')!;
    last.focus();
    tab();
    expect(document.activeElement).toBe(first);

    offInner();
  });
});
