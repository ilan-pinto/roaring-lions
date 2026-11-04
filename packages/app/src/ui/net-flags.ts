/**
 * The flag raid on screen (GH-976 P3): how long you have held their flag and how long they have held yours, against the hold
 * time. A small panel in the points race's place while a capture-the-flag match runs (it takes that panel's classes: same
 * corner, same bar); the end panel names the winner.
 *
 * What it shows is `net/flag-view.ts`'s, the same board the AI harness's `observe` shows: both flags' state is public by
 * design (see that file), and no unit appears here. Built with `textContent` throughout. Mounted on `document.body` by the
 * battlefield that makes it, which removes it in its own disposer. Versus rooms with a flag raid only, never a spectator.
 */
import { t } from '../i18n/t';
import type { FlagLine, FlagView } from '../net/flag-view';

/** The share of the hold a raid has served, in whole percent, 0-100. */
export function holdPercent(line: Pick<FlagLine, 'held' | 'state'>, holdSeconds: number): number {
  if (line.state === 'captured') return 100;
  return holdSeconds <= 0 ? 0 : Math.max(0, Math.min(100, Math.floor((line.held * 100) / holdSeconds)));
}

export class NetFlags {
  private readonly el: HTMLDivElement;
  private readonly title: HTMLParagraphElement;
  private readonly rows: Record<'theirs' | 'mine', { who: HTMLSpanElement; fill: HTMLSpanElement; n: HTMLSpanElement; state: HTMLSpanElement }>;
  private painted = '';

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'rl-net-points rl-net-flags';
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', t('versus.flag.label'));
    this.title = document.createElement('p');
    this.title.className = 'rl-net-points__title';
    this.el.appendChild(this.title);
    const row = (which: 'theirs' | 'mine') => {
      const el = document.createElement('div');
      el.className = 'rl-net-points__row';
      el.dataset.row = which;
      const who = document.createElement('span');
      who.className = 'rl-net-points__who';
      const bar = document.createElement('span');
      bar.className = 'rl-net-points__bar';
      bar.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('span');
      fill.className = 'rl-net-points__fill';
      bar.appendChild(fill);
      const n = document.createElement('span');
      n.className = 'rl-net-points__n';
      const state = document.createElement('span');
      state.className = 'rl-net-points__rate';
      el.append(who, bar, n, state);
      this.el.appendChild(el);
      return { who, fill, n, state };
    };
    this.rows = { theirs: row('theirs'), mine: row('mine') };
    host.appendChild(this.el);
  }

  /** Repaints only when something moved, so the per-frame caller costs nothing in a quiet minute. */
  update(view: FlagView): void {
    const key = JSON.stringify(view);
    if (key === this.painted) return;
    this.painted = key;
    this.title.textContent = t('versus.flag.title', { hold: view.holdSeconds });
    const paint = (which: 'theirs' | 'mine', line: FlagLine): void => {
      const r = this.rows[which];
      r.who.textContent = t(`versus.flag.${which}`);
      r.fill.style.width = `${holdPercent(line, view.holdSeconds)}%`;
      r.n.textContent = t('versus.flag.held', { held: line.state === 'captured' ? view.holdSeconds : line.held, hold: view.holdSeconds });
      r.state.textContent = t('versus.flag.state', { state: line.state });
    };
    paint('theirs', view.theirs);
    paint('mine', view.mine);
  }

  /** Hidden under the match-over panel. */
  hide(): void {
    this.el.hidden = true;
  }

  dispose(): void {
    this.el.remove();
  }
}
