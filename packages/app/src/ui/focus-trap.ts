// packages/app/src/ui/focus-trap.ts
/**
 * One focus trap for every full-screen/modal overlay in the shell: the pause
 * menu, the confirm dialog, F1's key-bindings overlay, and the in-mission
 * objective tracker (`main.ts`'s `openObjectives`/`closeObjectives`). Before
 * this, all four let a bare `Tab` (and `Shift+Tab`) fall straight through
 * their own capture-phase key guard uncaught -- each guard's own comment said
 * so, in words -- so a keyboard-only player could Tab out of an open dialog
 * onto the page behind it, with no way back except the mouse or Escape.
 *
 * `focusTrap(root)` installs one capture-phase `keydown` listener on `window`
 * that answers exactly `Tab`/`Shift+Tab` and nothing else: it queries `root`
 * for its own focusable descendants AT KEYPRESS TIME, not once at install,
 * because every caller here rebuilds its own body after mount (the tracker
 * repaints from a thunk on `refresh()`; the keys overlay repaints on a
 * rebind) and a list captured up front would go stale silently. It walks
 * that list circularly -- Tab from the last wraps to the first, Shift+Tab
 * from the first wraps to the last -- and, because a plain Tab press from a
 * focusable element already INSIDE `root` and a Tab press whose focus has
 * escaped to the page are both resolved by the same "next/previous index, or
 * none found means start of the cycle" rule, pulling escaped focus back in
 * costs no separate branch.
 *
 * A focusable element inside a `[hidden]` subtree of `root` (a pause-menu tab
 * that is not the active one, for instance) is excluded from the query the
 * same way the browser's own tab order excludes it, so switching tabs inside
 * a trapped panel can never land focus somewhere invisible.
 *
 * `preventDefault()` is called only when the trap actually moves focus (i.e.
 * whenever `root` has at least one focusable descendant) -- an empty root is
 * a no-op, not a throw, and nothing here ever calls `stopPropagation()`: the
 * trap's whole job is cycling focus, and every other key (and every OTHER
 * effect of Tab, such as a caller's own capture guard or the game's bubble
 * listener) is left exactly as untouched as it was before this existed.
 */
import type { Disposer } from '../shell/router';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** `root`'s own focusable descendants, in DOM order, skipping anything inside
 *  a `[hidden]` subtree of `root` -- the CSS selector above matches a hidden
 *  element just as happily as a visible one, since `hidden` only takes effect
 *  through a stylesheet rule (`display: none`) that jsdom's tests do not
 *  render, so the exclusion has to be explicit rather than left to layout. */
function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    const hiddenAncestor = el.closest('[hidden]');
    return hiddenAncestor === null || !root.contains(hiddenAncestor);
  });
}

/**
 * Installs the trap on `root` and returns its disposer. The disposer takes
 * the `window` listener off and is safe to call more than once.
 */
export function focusTrap(root: HTMLElement): Disposer {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    const list = focusablesIn(root);
    if (list.length === 0) return;
    const active = document.activeElement;
    const at = active instanceof HTMLElement ? list.indexOf(active) : -1;
    const step = e.shiftKey ? -1 : 1;
    // `at === -1` covers both "nothing in root is focused" and "focus has
    // escaped to the page" -- in either case the cycle simply starts fresh,
    // forward from the first or backward from the last.
    const next = at === -1 ? (e.shiftKey ? list.length - 1 : 0) : (at + step + list.length) % list.length;
    e.preventDefault();
    list[next]?.focus();
  };
  window.addEventListener('keydown', onKey, true);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('keydown', onKey, true);
  };
}
