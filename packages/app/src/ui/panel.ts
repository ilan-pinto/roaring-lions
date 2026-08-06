// The panel: a stamped header band over a hairline-framed body.
//
// The band colour is the panel's rank, and rank is the point. Every panel used
// to share one style constant, so nothing on screen outranked anything else —
// the mission briefing looked exactly as important as a hover tooltip. Three
// ranks now: the briefing you read for twelve minutes, the machinery you
// inspect, and the thing that interrupts you.

import { markSvg } from './mark';

export type PanelRank = 'mission' | 'inspect' | 'alert';

export interface PanelOptions {
  rank: PanelRank;
  title: string;
  /** Right-aligned stamp in the band — mission code, unit count. */
  tag?: string;
  /** Show the brigade mark in the band. The mission panel wears it; the
   *  inspector does not, or the HUD ends up branded three times over. */
  mark?: boolean;
  /** Inline styles for placement only — never colour. */
  place?: string;
}

export interface Panel {
  readonly el: HTMLElement;
  /** Where callers write content. Distinct from `el` so the band is not
   *  destroyed by an innerHTML rebuild of the body. */
  readonly body: HTMLElement;
  setTitle(text: string): void;
  setTag(text: string): void;
  show(): void;
  hide(): void;
  readonly visible: boolean;
}

export function panel(opts: PanelOptions): Panel {
  const el = document.createElement('section');
  el.className = 'rl-panel';
  el.dataset.rank = opts.rank;
  if (opts.place) el.style.cssText = opts.place;

  const band = document.createElement('header');
  band.className = 'rl-panel__band';
  if (opts.mark) band.innerHTML = markSvg(15, 12, 'rl-panel__mark');

  const title = document.createElement('span');
  title.className = 'rl-panel__title';
  title.textContent = opts.title;
  band.appendChild(title);

  const tag = document.createElement('span');
  tag.className = 'rl-panel__tag';
  tag.textContent = opts.tag ?? '';
  band.appendChild(tag);

  const body = document.createElement('div');
  body.className = 'rl-panel__body';

  el.appendChild(band);
  el.appendChild(body);

  let visible = true;
  return {
    el,
    body,
    setTitle: (text) => {
      title.textContent = text;
    },
    setTag: (text) => {
      tag.textContent = text;
    },
    show: () => {
      if (visible) return;
      visible = true;
      el.style.display = '';
      el.classList.remove('rl-enter');
      void el.offsetWidth; // restart the animation rather than skip it
      el.classList.add('rl-enter');
    },
    hide: () => {
      visible = false;
      el.style.display = 'none';
    },
    get visible() {
      return visible;
    },
  };
}
