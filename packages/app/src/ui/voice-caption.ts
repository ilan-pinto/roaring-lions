// The caption slot for unit voices (WP-AU1, D8): one line, under the notice
// feed, never inside it. The feed (`.rl-feed` in hud.ts) is punctuation for
// what happened in the mission; a caption only repeats what a unit just said,
// in text, for a player who has `accessibility.captions` on (T6, default
// off). `Hud.caption` is the one way anything reaches this element -- the
// voice runtime (T9) calls it only when a line actually played, handing over
// the manifest line's own `en` text.
//
// A DOM builder whose timer dies with it (R-18): `dispose` clears the pending
// `setTimeout` and removes the element, so a caption armed the instant before
// a mission ends never fires against a node nobody holds any more.

import { t } from '../i18n/t';

/** However long the line itself runs, the caption stays up one more second
 *  past it -- long enough for a player to finish reading a short line rather
 *  than having it vanish the instant the audio (or the estimate standing in
 *  for it) ends. */
export const CAPTION_EXTRA_MS = 1000;

/** `seconds` is a voice line's own duration -- always >= 0 from anything that
 *  actually plays, but never trusted to be: a negative or missing estimate
 *  floors at 0 rather than shortening the hold below `CAPTION_EXTRA_MS`. */
export function captionHoldMs(seconds: number): number {
  return Math.max(0, Math.round(seconds * 1000)) + CAPTION_EXTRA_MS;
}

/**
 * One slot, not a log. `show` replaces whatever is showing and restarts the
 * hold -- a second line arriving mid-caption is a newer thing to say, not a
 * second thing to queue behind the first.
 *
 * A polite live region (`role="status"`, `aria-live="polite"`) so a screen
 * reader announces a caption without interrupting whatever it is already
 * reading, labelled `t('hud.caption.label')` -- the ONLY string here that
 * goes through `t()`; the caption's own text is a manifest line's already-
 * resolved `en` string, set with `textContent`, never `innerHTML` (the
 * controller rule: nothing shown here is markup). `pointer-events: none`
 * (theme.css) keeps it, like `.rl-hint` beside it, from ever catching a click
 * meant for the map underneath.
 */
export class VoiceCaption {
  readonly el: HTMLElement;
  private timer = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'rl-caption rl-plate';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.setAttribute('aria-label', t('hud.caption.label'));
    this.el.hidden = true;
  }

  show(text: string, seconds: number): void {
    window.clearTimeout(this.timer);
    this.el.textContent = text;
    this.el.hidden = false;
    this.timer = window.setTimeout(() => this.clear(), captionHoldMs(seconds));
  }

  clear(): void {
    window.clearTimeout(this.timer);
    this.el.textContent = '';
    this.el.hidden = true;
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    this.el.remove();
  }
}
