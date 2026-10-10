// The one footer row (GH-498, the lead's direction A, 9 Oct 2026).
//
// Every screen that ends in a row of actions builds it here -- the garage, the
// after-action report, the campaign board, Saves, Settings, Credits and the
// Free Play picker -- so they cannot drift apart again. Before this the garage
// borrowed the old end panel's centred `.rl-endnav`, the report had its own
// right-aligned `.rl-aar__nav`, and the board, Saves, Settings, Credits and the
// picker each put a bare back link wherever their body ended; three different
// rows, two of them with a short `.rl-btn` stretched beside a tall stamp and
// its label left at the top of the box.
//
// The shape, which `theme.css`'s `.rl-foot` block draws:
//   * `start` -- the way back, FIRST ("Campaign map" or "Main menu", behind the
//     back mark), then any other way out;
//   * `end` -- whatever goes forward or acts on this screen, pinned to the far
//     edge: the report's Replay and its stamp, the board's next mission, or
//     the garage's reset on its own.
// One height for every control in the row, labels centred in it.
//
// `sticky` keeps the row on screen while the screen's own scroller moves
// (Settings, Saves, Credits, Free Play), so the way back is never below the
// fold on a 720-pixel window.

import { symbolLabel } from './symbol';

export interface Foot {
  /** The row itself; the caller places it. */
  readonly el: HTMLElement;
  /** The way back and the other ways out, first in reading and tab order. */
  readonly start: HTMLElement;
  /** Forward actions, at the far edge. */
  readonly end: HTMLElement;
}

export function screenFoot(opts: { sticky?: boolean } = {}): Foot {
  const el = document.createElement('nav');
  el.className = opts.sticky ? 'rl-foot rl-foot--sticky' : 'rl-foot';
  const start = document.createElement('div');
  start.className = 'rl-foot__start';
  const end = document.createElement('div');
  end.className = 'rl-foot__end';
  el.append(start, end);
  return { el, start, end };
}

/** A plain action link in the row: `.rl-btn`, body face, sentence case. */
export function footLink(label: string, href: string, className = 'rl-btn'): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = className;
  a.href = href;
  a.textContent = label;
  return a;
}

/** The way back: a `.rl-btn` with the back mark before its words, tagged
 *  `data-kind="back"` (the hook every screen test and harness reads). */
export function footBack(label: string, href: string, className = 'rl-btn'): HTMLAnchorElement {
  const a = footLink(label, href, className);
  a.innerHTML = symbolLabel('back', label);
  a.dataset.kind = 'back';
  return a;
}
