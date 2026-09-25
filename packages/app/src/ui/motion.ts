// Motion helpers. Everything here is short, interruptible, and reports state —
// there is no motion in this UI whose only job is to be seen moving.
//
// The animations themselves live in theme.css so they cost nothing at runtime
// and cannot stall the 20 Hz tick. These functions only start and stop them.

/** `settings.ts` writes `data-motion` on the root; the OS preference is the
 *  media query. Either one means reduced motion. The same two checks
 *  `scene-host.ts`'s own (private) `defaultReducedMotion` makes -- kept here
 *  too, rather than importing that module, so a caller that only wants
 *  "should this scroll smoothly" never pulls in the renderer-selection code
 *  that lives beside it. */
export function prefersReducedMotion(): boolean {
  if (document.documentElement.dataset.motion === 'reduce') return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Restart a one-shot animation class.
 *
 * Re-adding a class the element already carries does nothing — the browser
 * sees no change. An objective completing twice, or ROE dropping twice in a
 * second, has to flash twice, so the class comes off and a forced reflow makes
 * the re-add a real change.
 *
 * Returns the timeout that takes the class off again, so a screen that can be
 * left mid-flash (the garage, WP-S3g T10) can clear it on the way out rather
 * than leave a timer holding a node it no longer owns.
 */
export function flash(el: HTMLElement, className: string, ms: number): number {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  return window.setTimeout(() => el.classList.remove(className), ms);
}

/** Mark children for the staggered menu entrance. */
export function stagger(container: HTMLElement): void {
  Array.from(container.children).forEach((child, i) => {
    (child as HTMLElement).style.setProperty('--i', String(i));
  });
  container.classList.add('rl-stagger');
}

/** Fade out, then remove from the document. */
export function leave(el: HTMLElement, ms = 120): void {
  el.classList.add('rl-leave');
  window.setTimeout(() => el.remove(), ms);
}

/** The mechanical default: long enough to read a name and an objective
 *  count, nothing more -- unchanged from before `dispatch` existed. */
const DEFAULT_HOLD_MS = 900;

/** Held for a full read when the mission declares `dispatch` (GDD §11): a
 *  sentence or two of story prose needs more than the mechanical default
 *  affords. Any input still skips regardless (below) -- this only changes
 *  how long a player who does nothing keeps looking at it. */
const DISPATCH_HOLD_MS = 5000;

/**
 * Mission start punctuation: the name of the operation, held long enough to
 * read, then out of the way. `dispatch` -- the story voice, GDD §11 -- prints
 * under the name when the mission declares one; without it this draws
 * exactly what it always has.
 *
 * Skippable by any click or key — a player replaying a mission for a better
 * ROE score should not have to watch it a fourth time. The hold is driven from
 * JS rather than CSS so that under `prefers-reduced-motion` the card still
 * stays up for its full read; only the movement is dropped, never the words.
 *
 * Returns the card AND its dismisser, not just the dismisser. `dismiss` fades
 * over 250 ms before removing the node, which is right for a skip and wrong
 * for a teardown that has to finish before the next screen mounts -- so a
 * caller being torn down needs the element itself. Handing it back beats every
 * way of finding it again: `Hud.destroy()` used to sweep `.rl-titlecard` off
 * the shared `document.body`, which is a query that can match a card this HUD
 * did not create.
 */
export function titleCard(
  host: HTMLElement,
  title: string,
  subtitle: string,
  dispatch?: string,
  holdMs?: number
): { el: HTMLElement; dismiss: () => void } {
  const card = document.createElement('div');
  card.className = 'rl-titlecard rl-enter';
  const titleEl = document.createElement('div');
  // Each line is its own plate now (the card has no panel behind it and
  // measured close to 1.3:1 over sand) -- .rl-titlecard's grid gives each
  // plated line its own row rather than one plate spanning the whole card.
  titleEl.className = 'rl-titlecard__title rl-plate';
  titleEl.textContent = title;
  card.appendChild(titleEl);
  // Present only with `dispatch` -- without it the card is exactly what it
  // was before this field existed.
  if (dispatch) {
    const dispatchEl = document.createElement('div');
    dispatchEl.className = 'rl-titlecard__dispatch rl-plate';
    dispatchEl.textContent = dispatch;
    card.appendChild(dispatchEl);
  }
  const subEl = document.createElement('div');
  subEl.className = 'rl-titlecard__sub rl-plate';
  subEl.textContent = subtitle;
  card.appendChild(subEl);
  host.appendChild(card);

  let done = false;
  const dismiss = (): void => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    window.removeEventListener('pointerdown', dismiss);
    window.removeEventListener('keydown', dismiss);
    leave(card, 250);
  };
  const hold = holdMs ?? (dispatch ? DISPATCH_HOLD_MS : DEFAULT_HOLD_MS);
  const timer = window.setTimeout(dismiss, hold + 250);
  window.addEventListener('pointerdown', dismiss);
  window.addEventListener('keydown', dismiss);
  return { el: card, dismiss };
}
