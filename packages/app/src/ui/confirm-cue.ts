/**
 * UI confirm (polish pass F, A8): a primary action -- Deploy, Save, Continue,
 * the next mission -- answers its click with the restrained `ui.confirm`
 * tick. Primary actions ONLY: never a hover, a tab, a checkbox or a
 * secondary link, or the cue stops meaning "that registered" and becomes
 * noise. Buy is not here either: the garage already answers a purchase with
 * its own cue, and two sounds for one click would be one too many.
 *
 * One helper, not one call per screen: a screen marks its primary control
 * with `markConfirm`, and ONE capture-phase click listener on the document
 * plays the cue for anything marked. A screen never touches the mixer, and a
 * new primary button needs one line.
 */

/** Mark `el` as a primary action whose click plays the confirm cue. */
export function markConfirm(el: HTMLElement): void {
  el.dataset.cue = 'confirm';
}

/** Does a click on `target` land on a live primary action? A disabled or
 *  locked control is not one: the click did nothing. */
export function confirmCueTarget(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  const el = target.closest<HTMLElement>('[data-cue="confirm"]');
  if (el === null) return false;
  if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true' || el.dataset.locked === '1') return false;
  return true;
}

/** Install the one listener; returns its remover. Capture phase, so a
 *  handler that stops propagation (a modal's own guard) cannot swallow it. */
export function installConfirmCue(doc: Document, play: () => void): () => void {
  const on = (ev: Event): void => {
    if (confirmCueTarget(ev.target)) play();
  };
  doc.addEventListener('click', on, true);
  return () => doc.removeEventListener('click', on, true);
}
