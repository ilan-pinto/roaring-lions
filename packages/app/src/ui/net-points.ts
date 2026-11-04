/**
 * The points race on screen (GH-976 P2): both sides' points against the target, what each side's held zones pay a
 * minute, and a count of the ground (held by you, by them, fought over, open). A small panel at the top of the field
 * while a points match runs; the end panel carries the final points.
 *
 * What it shows is `net/points-view.ts`'s, the same board the AI harness's `observe` shows: scores and zone holders
 * are public by design (see that file), and no unit appears here. Built with `textContent` throughout: the other
 * seat's callsign is text a player typed. Versus rooms with a points race only. Mounted on `document.body` by the
 * battlefield that makes it, which removes it in its own disposer.
 */
import { currentLocale, t } from '../i18n/t';
import type { PointsView, ZoneHolder } from '../net/points-view';

/** A number as the player's locale writes it. */
function amount(n: number): string {
  try {
    return new Intl.NumberFormat(currentLocale()).format(n);
  } catch {
    return String(n);
  }
}

/** How many zones each holder has: the panel's "ground" line. */
export function zoneCounts(view: Pick<PointsView, 'zones'>): Record<ZoneHolder, number> {
  const counts: Record<ZoneHolder, number> = { mine: 0, theirs: 0, contested: 0, none: 0 };
  for (const z of view.zones) counts[z.holder]++;
  return counts;
}

/** The share of the target a score is, in whole percent, 0-100. */
export function fillPercent(points: number, target: number): number {
  return target <= 0 ? 0 : Math.max(0, Math.min(100, Math.floor((points * 100) / target)));
}

export class NetPoints {
  private readonly el: HTMLDivElement;
  private readonly title: HTMLParagraphElement;
  private readonly rows: Record<'mine' | 'theirs', { who: HTMLSpanElement; fill: HTMLSpanElement; n: HTMLSpanElement; rate: HTMLSpanElement }>;
  private readonly ground: HTMLParagraphElement;
  private painted = '';

  constructor(host: HTMLElement, private readonly names: { readonly theirs: string }) {
    this.el = document.createElement('div');
    this.el.className = 'rl-net-points';
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', t('versus.points.label'));
    this.title = document.createElement('p');
    this.title.className = 'rl-net-points__title';
    this.ground = document.createElement('p');
    this.ground.className = 'rl-net-points__ground';
    const row = (which: 'mine' | 'theirs') => {
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
      const rate = document.createElement('span');
      rate.className = 'rl-net-points__rate';
      el.append(who, bar, n, rate);
      this.el.appendChild(el);
      return { who, fill, n, rate };
    };
    this.el.appendChild(this.title);
    this.rows = { mine: row('mine'), theirs: row('theirs') };
    this.el.appendChild(this.ground);
    host.appendChild(this.el);
  }

  /** Repaints only when a number moved, so the per-frame caller costs nothing in a quiet minute. */
  update(view: PointsView): void {
    const key = JSON.stringify(view);
    if (key === this.painted) return;
    this.painted = key;
    this.title.textContent = t('versus.points.title', { target: amount(view.target) });
    const paint = (which: 'mine' | 'theirs', who: string, points: number, rate: number): void => {
      const r = this.rows[which];
      r.who.textContent = who;
      r.fill.style.width = `${fillPercent(points, view.target)}%`;
      r.n.textContent = amount(points);
      r.rate.textContent = t('versus.points.rate', { n: rate });
    };
    paint('mine', t('versus.score.you'), view.mine, view.mineRate);
    paint('theirs', this.names.theirs, view.theirs, view.theirsRate);
    const c = zoneCounts(view);
    this.ground.textContent = t('versus.points.ground', { mine: c.mine, theirs: c.theirs, contested: c.contested, open: c.none });
  }

  /** Hidden under the match-over panel, which carries the final points. */
  hide(): void {
    this.el.hidden = true;
  }

  dispose(): void {
    this.el.remove();
  }
}
