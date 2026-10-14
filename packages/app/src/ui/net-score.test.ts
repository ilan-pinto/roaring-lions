// @vitest-environment jsdom
//
// The versus scoreboard on screen (2026-10-14): this seat's line first, the
// other seat's callsign as typed (text, never markup), and the full table on
// the match-over panel.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchScore } from '../net/scoreboard';
import { showNetEnd } from './net-end';
import { NetScoreboard, scoreTable } from './net-score';

afterEach(() => {
  document.body.innerHTML = '';
});

const SCORE: MatchScore = [
  { lost: 1, lostValue: 150, destroyed: 3, destroyedValue: 1250, remaining: 2450 },
  { lost: 3, lostValue: 1250, destroyed: 1, destroyedValue: 150, remaining: 1900 },
];

/** The table as text, row by row: [name, ...cells]. */
function rows(table: HTMLTableElement): string[][] {
  return [...table.rows].map((r) => [...r.cells].map((c) => (c.textContent ?? '').trim()));
}

describe('scoreTable', () => {
  it('seat 0 reads its own line first, each cell a count and its value', () => {
    const table = scoreTable(SCORE, 0, { theirs: 'Raven' }, { remaining: false });
    expect(rows(table)).toEqual([
      ['', 'Destroyed', 'Lost'],
      ['You', '3 (1,250)', '1 (150)'],
      ['Raven', '1 (150)', '3 (1,250)'],
    ]);
  });

  it('seat 1 on the same board reads the mirror of seat 0', () => {
    const table = scoreTable(SCORE, 1, { theirs: 'Hawk' }, { remaining: false });
    expect(rows(table)).toEqual([
      ['', 'Destroyed', 'Lost'],
      ['You', '1 (150)', '3 (1,250)'],
      ['Hawk', '3 (1,250)', '1 (150)'],
    ]);
  });

  it('the full table adds the force each side has left', () => {
    const table = scoreTable(SCORE, 0, { theirs: 'Raven' }, { remaining: true });
    expect(rows(table)[0]).toEqual(['', 'Destroyed', 'Lost', 'Force left']);
    expect(rows(table)[1][3]).toBe('2,450');
    expect(rows(table)[2][3]).toBe('1,900');
  });

  it('a callsign is text, never markup', () => {
    const table = scoreTable(SCORE, 0, { theirs: '<img src=x onerror=alert(1)>' }, { remaining: false });
    expect(table.querySelector('img')).toBeNull();
    expect(rows(table)[2][0]).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('NetScoreboard', () => {
  it('mounts under the strip, repaints only when a number moved, and goes on dispose', () => {
    const board = new NetScoreboard(document.body, 0, { theirs: 'Raven' });
    board.update(SCORE);
    const first = document.querySelector('.rl-net-score table');
    expect(first).not.toBeNull();
    board.update([{ ...SCORE[0] }, { ...SCORE[1] }]);
    expect(document.querySelector('.rl-net-score table')).toBe(first);
    board.update([{ ...SCORE[0], lost: 2 }, SCORE[1]]);
    expect(document.querySelector('.rl-net-score table')).not.toBe(first);
    board.hide();
    expect(document.querySelector<HTMLElement>('.rl-net-score')?.hidden).toBe(true);
    board.dispose();
    expect(document.querySelector('.rl-net-score')).toBeNull();
  });
});

describe('the match-over panel carries the full board', () => {
  it('both seats\' panels show the same numbers, each its own line first', () => {
    const deps = { again: vi.fn(), menu: vi.fn() };
    showNetEnd(document.body, { kind: 'won', side: 0, by: 'annihilation' }, 0, { ...deps, score: { score: SCORE, names: { theirs: 'Raven' } } });
    const a = rows(document.querySelector<HTMLTableElement>('.rl-net-end table.rl-net-board') as HTMLTableElement);
    document.body.innerHTML = '';
    showNetEnd(document.body, { kind: 'won', side: 0, by: 'annihilation' }, 1, { ...deps, score: { score: SCORE, names: { theirs: 'Hawk' } } });
    const b = rows(document.querySelector<HTMLTableElement>('.rl-net-end table.rl-net-board') as HTMLTableElement);
    expect(a[1].slice(1)).toEqual(b[2].slice(1));
    expect(a[2].slice(1)).toEqual(b[1].slice(1));
    expect(a[1]).toEqual(['You', '3 (1,250)', '1 (150)', '2,450']);
  });

  it('a panel with no board (an older caller) shows the reason alone', () => {
    showNetEnd(document.body, { kind: 'draw', by: 'mutual' }, 0, { again: vi.fn(), menu: vi.fn() });
    expect(document.querySelector('.rl-net-end table')).toBeNull();
  });
});
