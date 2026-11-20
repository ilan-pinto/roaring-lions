// packages/app/src/ui/scroll-focus.ts
/**
 * A scrolling region a keyboard can reach (GH-1408, KS-14).
 *
 * The after-action report's body scrolls inside its panel (`.rl-aar > .rl-panel__body { overflow-y: auto }`) and the action row
 * sits outside it. On a short window the body overflows. A mouse player wheels it; a keyboard player has focus on the action row,
 * which is not inside the scroller, so no arrow key or Page Down moves it, and the report's last lines are unreachable. The
 * report traps Tab (`focus-trap.ts`), and the trap's selector lists only controls and an explicit `tabindex`, so a scroller the
 * browser would make focusable by itself is never visited either.
 *
 * `scrollerFocusable(el, label)` gives the element `tabindex="0"`, `role="region"` and an `aria-label` ONLY while it overflows,
 * and takes all three off again when it does not. A guessed `tabindex` on every report would add a tab stop to a report that
 * fits, which is why the old note said to measure first. The state is re-read whenever the element or one of its children
 * changes size (the window resized, a line was added). Without `ResizeObserver` (jsdom) it reads once.
 *
 * Presentation only: it touches three attributes and reads two sizes. Returns a disposer (the router's contract); idempotent.
 */
import type { Disposer } from '../shell/router';

/** A scroller overflows when its content is taller than its box by more than a sub-pixel rounding. */
const SLACK_PX = 1;

export function scrollerFocusable(el: HTMLElement, label: string): Disposer {
  let disposed = false;
  const apply = (): void => {
    if (disposed) return;
    if (el.scrollHeight > el.clientHeight + SLACK_PX) {
      el.tabIndex = 0;
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', label);
    } else {
      el.removeAttribute('tabindex');
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
    }
  };
  apply();
  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(apply);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
  }
  return () => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    el.removeAttribute('tabindex');
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
  };
}
