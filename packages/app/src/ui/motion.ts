// Motion helpers. Everything here is short, interruptible, and reports state —
// there is no motion in this UI whose only job is to be seen moving.
//
// The animations themselves live in theme.css so they cost nothing at runtime
// and cannot stall the 20 Hz tick. These functions only start and stop them.

/**
 * Restart a one-shot animation class.
 *
 * Re-adding a class the element already carries does nothing — the browser
 * sees no change. An objective completing twice, or ROE dropping twice in a
 * second, has to flash twice, so the class comes off and a forced reflow makes
 * the re-add a real change.
 */
export function flash(el: HTMLElement, className: string, ms: number): void {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  window.setTimeout(() => el.classList.remove(className), ms);
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
 */
export function titleCard(
  host: HTMLElement,
  title: string,
  subtitle: string,
  dispatch?: string,
  holdMs?: number
): () => void {
  const card = document.createElement('div');
  card.className = 'rl-titlecard rl-enter';
  const titleEl = document.createElement('div');
  titleEl.className = 'rl-titlecard__title';
  titleEl.textContent = title;
  card.appendChild(titleEl);
  // Present only with `dispatch` -- without it the card is exactly what it
  // was before this field existed.
  if (dispatch) {
    const dispatchEl = document.createElement('div');
    dispatchEl.className = 'rl-titlecard__dispatch';
    dispatchEl.textContent = dispatch;
    card.appendChild(dispatchEl);
  }
  const subEl = document.createElement('div');
  subEl.className = 'rl-titlecard__sub';
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
  return dismiss;
}
