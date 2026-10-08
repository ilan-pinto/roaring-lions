// The end-of-mission panels' shared frame: the end screen (`menu.ts`'s
// `showEndScreen`) and the debrief (`debrief.ts`).
//
// Both used to be placed inline and grow downward with their text, the action
// row last in the body -- so on the lead's WH V victory (a portrait, a quote and
// a five-line aftermath) the end screen's next-mission and replay buttons sat
// below the viewport and could not be clicked. Now `.rl-endpanel` (theme.css)
// centres the panel and caps it at the viewport less a margin; the body
// scrolls, and the action row lives in a FOOT outside the body, so no amount
// of text can carry it off screen.
//
// Deliberately small: the fuller debrief redesign (GH-417) is meant to replace
// these two panels, and this is only the frame that keeps them usable meanwhile.

import type { Panel } from './panel';

/** Mount `p` on `host` as an end-of-mission panel: `nav` (the action row)
 *  goes in a foot after the scrolling body, and `primary` -- the one action a
 *  player most likely wants -- takes focus, so Enter answers it.
 *
 *  A HELD Enter does not: the outcome moment before this panel ends on any
 *  fresh key press, and a player still holding the Enter that dismissed it
 *  would otherwise be carried straight on into the next mission by the key's
 *  auto-repeat, without ever seeing this panel. Escape is left alone: the
 *  battlefield's own handler already ignores it once the mission is over
 *  (`missionEnded`, `main.ts`), and there is nothing here for it to close. */
export function mountEndPanel(host: HTMLElement, p: Panel, nav: HTMLElement, primary: HTMLElement | null): void {
  p.el.classList.add('rl-endpanel');
  const foot = document.createElement('div');
  foot.className = 'rl-endpanel__foot';
  foot.appendChild(nav);
  p.el.appendChild(foot);
  nav.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.repeat) e.preventDefault();
  });
  host.appendChild(p.el);
  if (primary !== null) {
    primary.dataset.endPrimary = '1';
    primary.focus({ preventScroll: true });
    // Once more, a task later, if nothing else has taken focus since. The
    // outcome moment ends on POINTERDOWN, so a click that skips it mounts this
    // panel between that event and the same press's mousedown -- whose default
    // action then focuses whatever is under the pointer (the backdrop: so,
    // <body>), and Enter answered nothing (measured on a real browser, GH-417).
    window.setTimeout(() => {
      const a = document.activeElement;
      if (primary.isConnected && (a === null || a === document.body)) primary.focus({ preventScroll: true });
    }, 0);
  }
}
