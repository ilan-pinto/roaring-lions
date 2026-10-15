/**
 * The versus scoreboard on screen (2026-10-14): a small table under the HUD
 * strip while the match runs -- each side's destroyed and lost, with their
 * value -- and the full table on the match-over panel, which adds the force
 * each side has left. The numbers are `net/scoreboard.ts`'s, read from sim
 * state alone, so both seats show the same board; each reads its own line
 * first. Built with `textContent` throughout: the other seat's callsign is
 * text a player typed.
 *
 * Under the running table, a chip for each seat an advisor sits beside
 * (decision D1: both seats see each seat's advisor in the HUD, not only in the
 * lobby), fed by the room's `advisors` through `advisorPresenceHook`.
 *
 * Versus rooms only. Mounted on `document.body` by the battlefield that makes
 * it, which removes it in its own disposer.
 */
import type { AdvisorScope } from '@lions/net';
import { currentLocale, t } from '../i18n/t';
import { scoreFor, type MatchScore, type SideScore } from '../net/scoreboard';

/** Each seat's advisor, as the room names them (`advisors`): seat 0, seat 1. */
export type AdvisorsPresent = readonly [AdvisorScope | null, AdvisorScope | null];
/** The same, as this seat reads it. Keyed by SEAT, never by side: a seat may
 *  play either side, and the board itself is laid out by side. */
export interface AdvisorPair { readonly mine: AdvisorScope | null; readonly theirs: AdvisorScope | null }

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
  private readonly board: HTMLDivElement;
  private readonly advisorLine: HTMLDivElement;
  private painted = '';

  constructor(host: HTMLElement, private readonly viewer: 0 | 1, private readonly names: ScoreNames) {
    this.el = document.createElement('div');
    this.el.className = 'rl-net-score';
    this.el.setAttribute('aria-label', t('versus.score.title'));
    this.board = document.createElement('div');
    this.advisorLine = document.createElement('div');
    this.advisorLine.className = 'rl-net-score__advisors';
    this.advisorLine.hidden = true;
    this.el.append(this.board, this.advisorLine);
    host.appendChild(this.el);
  }

  update(score: MatchScore): void {
    const key = JSON.stringify(score);
    if (key === this.painted) return;
    this.painted = key;
    this.board.replaceChildren(scoreTable(score, this.viewer, this.names, { remaining: false }));
  }

  /** Who has an advisor: a chip per seat with one, this seat's first. The
   *  other seat's callsign is text a player typed, set as text. */
  advisors(present: AdvisorPair): void {
    const chips: HTMLElement[] = [];
    const chip = (row: 'mine' | 'theirs', who: string, scope: AdvisorScope | null): void => {
      if (scope === null) return;
      const el = document.createElement('span');
      el.className = 'rl-net-score__advisor';
      el.dataset.row = row;
      const name = document.createElement('span');
      name.className = 'rl-net-score__who';
      name.textContent = who;
      const badge = document.createElement('span');
      badge.className = 'rl-net-score__badge';
      badge.textContent = t('net.advisor.badge', { scope });
      el.append(name, badge);
      chips.push(el);
    };
    chip('mine', t('versus.score.you'), present.mine);
    chip('theirs', this.names.theirs, present.theirs);
    this.advisorLine.replaceChildren(...chips);
    this.advisorLine.hidden = chips.length === 0;
  }

  /** Hidden under the match-over panel, which carries the full table. */
  hide(): void {
    this.el.hidden = true;
  }

  dispose(): void {
    this.el.remove();
  }
}

/** The room's `onAdvisors` for a battlefield: this seat's advisor to its own
 *  panel (shown while one sits beside it), both seats' to the HUD board, and
 *  nothing once the match-over panel is up (`live` false). Either may be
 *  absent. */
export function advisorPresenceHook(
  seat: 0 | 1,
  to: { panel: { onPresence(scope: AdvisorScope | null): void } | null; board: { advisors(present: AdvisorPair): void } | null },
  live: () => boolean,
): (present: AdvisorsPresent) => void {
  return (present) => {
    if (!live()) return;
    to.panel?.onPresence(present[seat]);
    to.board?.advisors({ mine: present[seat], theirs: present[seat === 0 ? 1 : 0] });
  };
}
