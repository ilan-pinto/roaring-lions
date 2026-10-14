/**
 * The versus scoreboard on screen (2026-10-14): a small table under the HUD
 * strip while the match runs -- each side's destroyed and lost, with their
 * value -- and the full table on the match-over panel, which adds the force
 * each side has left. The numbers are `net/scoreboard.ts`'s, read from sim
 * state alone, so both seats show the same board; each reads its own line
 * first. Built with `textContent` throughout: the other seat's callsign is
 * text a player typed.
 *
 * Versus rooms only. Mounted on `document.body` by the battlefield that makes
 * it, which removes it in its own disposer.
 */
import { currentLocale, t } from '../i18n/t';
import { scoreFor, type MatchScore, type SideScore } from '../net/scoreboard';

/** A value as the player's locale writes a number (2,450). */
export function amount(n: number): string {
  try {
    return new Intl.NumberFormat(currentLocale()).format(n);
  } catch {
    return String(n);
  }
}

/** The two row names: this seat's, then the other seat's callsign. */
export interface ScoreNames {
  readonly theirs: string;
}

type Column = 'destroyed' | 'lost' | 'remaining';

function cellText(line: SideScore, col: Column): string {
  if (col === 'remaining') return amount(line.remaining);
  const n = col === 'destroyed' ? line.destroyed : line.lost;
  const value = col === 'destroyed' ? line.destroyedValue : line.lostValue;
  return t('versus.score.cell', { n, value: amount(value) });
}

/** The board as a table, this seat's line first. `remaining` adds the force
 *  each side has left (the end panel's full table). */
export function scoreTable(score: MatchScore, viewer: 0 | 1, names: ScoreNames, opts: { remaining: boolean }): HTMLTableElement {
  const { mine, theirs } = scoreFor(score, viewer);
  const cols: Column[] = opts.remaining ? ['destroyed', 'lost', 'remaining'] : ['destroyed', 'lost'];
  const table = document.createElement('table');
  table.className = 'rl-net-board';
  const head = table.createTHead().insertRow();
  head.appendChild(document.createElement('th'));
  for (const col of cols) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.dataset.col = col;
    th.textContent = t(`versus.score.${col}`);
    head.appendChild(th);
  }
  const body = table.createTBody();
  const row = (who: 'mine' | 'theirs', name: string, line: SideScore): void => {
    const tr = body.insertRow();
    tr.dataset.row = who;
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = name;
    tr.appendChild(th);
    for (const col of cols) {
      const td = tr.insertCell();
      td.dataset.col = col;
      td.textContent = cellText(line, col);
    }
  };
  row('mine', t('versus.score.you'), mine);
  row('theirs', names.theirs, theirs);
  return table;
}

/** The running board under the strip. `update` repaints only when a number
 *  moved, so the 4 Hz caller costs nothing in a quiet minute. */
export class NetScoreboard {
  private readonly el: HTMLDivElement;
  private painted = '';

  constructor(host: HTMLElement, private readonly viewer: 0 | 1, private readonly names: ScoreNames) {
    this.el = document.createElement('div');
    this.el.className = 'rl-net-score';
    this.el.setAttribute('aria-label', t('versus.score.title'));
    host.appendChild(this.el);
  }

  update(score: MatchScore): void {
    const key = JSON.stringify(score);
    if (key === this.painted) return;
    this.painted = key;
    this.el.replaceChildren(scoreTable(score, this.viewer, this.names, { remaining: false }));
  }

  /** Hidden under the match-over panel, which carries the full table. */
  hide(): void {
    this.el.hidden = true;
  }

  dispose(): void {
    this.el.remove();
  }
}
