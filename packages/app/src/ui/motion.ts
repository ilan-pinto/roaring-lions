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

/**
 * Mission start punctuation: the name of the operation, held long enough to
 * read, then out of the way.
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
  holdMs = 900
): () => void {
  const card = document.createElement('div');
  card.className = 'rl-titlecard rl-enter';
  card.innerHTML =
    `<div class="rl-titlecard__title"></div><div class="rl-titlecard__sub"></div>`;
  (card.firstChild as HTMLElement).textContent = title;
  (card.lastChild as HTMLElement).textContent = subtitle;
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
  const timer = window.setTimeout(dismiss, holdMs + 250);
  window.addEventListener('pointerdown', dismiss);
  window.addEventListener('keydown', dismiss);
  return dismiss;
}
