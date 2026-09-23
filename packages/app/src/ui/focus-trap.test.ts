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

  it('leaves every other key alone', () => {
    const box = build();
    const off = focusTrap(box);
    let seen = 0;
    window.addEventListener('keydown', () => seen++);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(seen).toBe(1);
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
