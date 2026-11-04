// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';
import { missingKeys, setCatalogue } from '../i18n/t';
import type { PointsView } from '../net/points-view';
import { NetPoints, fillPercent, zoneCounts } from './net-points';
import { showNetEnd } from './net-end';

afterEach(() => { setCatalogue('en', en); document.body.replaceChildren(); });

const VIEW: PointsView = {
  target: 600, mine: 210, theirs: 175, mineRate: 30, theirsRate: 20,
  zones: [
    { zone: 'ford', at: [20, 20, 8, 8], perMin: 30, holder: 'mine' },
    { zone: 'tell', at: [6, 6, 10, 10], perMin: 20, holder: 'theirs' },
    { zone: 'knoll', at: [9, 23, 7, 7], perMin: 10, holder: 'contested' },
    { zone: 'mill', at: [1, 1, 3, 3], perMin: 5, holder: 'none' },
  ],
};
const text = (el: ParentNode, sel: string): string => el.querySelector(sel)!.textContent!;

describe('NetPoints (GH-976 P2)', () => {
  it('shows both sides\' points, the target, what the zones pay a minute and the ground count', () => {
    const p = new NetPoints(document.body, { theirs: 'Raven' });
    p.update(VIEW);
    const el = document.querySelector<HTMLElement>('.rl-net-points')!;
    expect(text(el, '.rl-net-points__title')).toBe('Points race: first to 600');
    expect(text(el, '[data-row=mine] .rl-net-points__who')).toBe('You');
    expect(text(el, '[data-row=mine] .rl-net-points__n')).toBe('210');
    expect(text(el, '[data-row=mine] .rl-net-points__rate')).toBe('+30 a minute');
    expect(text(el, '[data-row=theirs] .rl-net-points__who')).toBe('Raven');
    expect(text(el, '[data-row=theirs] .rl-net-points__n')).toBe('175');
    expect(text(el, '[data-row=theirs] .rl-net-points__rate')).toBe('+20 a minute');
    expect(text(el, '.rl-net-points__ground')).toBe('Ground: you hold 1, they hold 1, 1 contested, 1 open');
    expect(el.querySelector<HTMLElement>('[data-row=mine] .rl-net-points__fill')!.style.width).toBe('35%');
    expect(el.getAttribute('aria-label')).toBe('Points race');
    expect(missingKeys()).toEqual([]);
  });

  it('repaints only when a number moved, hides under the end panel, and takes itself out on dispose', () => {
    const p = new NetPoints(document.body, { theirs: 'Raven' });
    p.update(VIEW);
    const n = document.querySelector('[data-row=mine] .rl-net-points__n')!;
    const before = n.firstChild;
    p.update({ ...VIEW });
    expect(n.firstChild).toBe(before);   // same text node: nothing was rewritten
    p.update({ ...VIEW, mine: 211 });
    expect(n.textContent).toBe('211');
    p.hide();
    expect(document.querySelector<HTMLElement>('.rl-net-points')!.hidden).toBe(true);
    p.dispose();
    expect(document.querySelector('.rl-net-points')).toBeNull();
  });

  it('draws the other seat\'s callsign as text, never as markup', () => {
    const p = new NetPoints(document.body, { theirs: '<img src=x onerror=alert(1)>' });
    p.update(VIEW);
    expect(document.querySelector('.rl-net-points img')).toBeNull();
    expect(text(document.body, '[data-row=theirs] .rl-net-points__who')).toBe('<img src=x onerror=alert(1)>');
  });

  it('?pseudo=1: every string it draws, bar the callsign a player typed, is bracketed (none bypassed t())', () => {
    setCatalogue('pseudo', en, pseudo);
    const p = new NetPoints(document.body, { theirs: 'Raven' });
    p.update(VIEW);
    const el = document.querySelector<HTMLElement>('.rl-net-points')!;
    const shown = [
      el.getAttribute('aria-label')!,
      text(el, '.rl-net-points__title'), text(el, '[data-row=mine] .rl-net-points__who'),
      text(el, '[data-row=mine] .rl-net-points__rate'), text(el, '[data-row=theirs] .rl-net-points__rate'), text(el, '.rl-net-points__ground'),
    ];
    for (const s of shown) expect(s, s).toMatch(/^⟦[\s\S]*⟧$/);
    expect(text(el, '[data-row=theirs] .rl-net-points__who')).toBe('Raven');   // typed text, not chrome
    expect(missingKeys()).toEqual([]);
  });

  it('the helpers: ground counts by holder, and a fill that stays inside 0-100', () => {
    expect(zoneCounts(VIEW)).toEqual({ mine: 1, theirs: 1, contested: 1, none: 1 });
    expect([fillPercent(0, 600), fillPercent(299, 600), fillPercent(600, 600), fillPercent(900, 600), fillPercent(-5, 600), fillPercent(5, 0)]).toEqual([0, 49, 100, 100, 0, 0]);
  });
});

describe('the end panel of a points race (GH-976 P2)', () => {
  const host = (): HTMLElement => { const h = document.createElement('div'); document.body.appendChild(h); return h; };
  const deps = { again: () => {}, menu: () => {} };
  it('says "won on points" to the winner, "lost on points" to the loser, and both totals', () => {
    const won = host();
    showNetEnd(won, { kind: 'won', side: 0, by: 'objective', mode: 'points' }, 0, { ...deps, points: { mine: 612, theirs: 540, target: 600 } });
    expect(text(won, '.rl-net-end__reason')).toBe('Won on points: you reached the target first');
    expect(text(won, '.rl-net-end__points')).toBe('Points: 612 to 540 (first to 600)');
    const lost = host();
    showNetEnd(lost, { kind: 'won', side: 0, by: 'objective', mode: 'points' }, 1, { ...deps, points: { mine: 540, theirs: 612, target: 600 } });
    expect(text(lost, '.rl-net-end__reason')).toBe('Lost on points: they reached the target first');
    expect(text(lost, '.rl-net-end__points')).toBe('Points: 540 to 612 (first to 600)');
  });
  it('an annihilation panel has no points line, and a camp win does not say "points"', () => {
    const a = host();
    showNetEnd(a, { kind: 'won', side: 0, by: 'annihilation' }, 0, deps);
    expect(a.querySelector('.rl-net-end__points')).toBeNull();
    const c = host();
    showNetEnd(c, { kind: 'won', side: 0, by: 'objective', mode: 'camp' }, 0, deps);
    expect(text(c, '.rl-net-end__reason')).toBe('The enemy camp is destroyed');
  });
  it('?pseudo=1: the points reason and totals are bracketed', () => {
    setCatalogue('pseudo', en, pseudo);
    const h = host();
    showNetEnd(h, { kind: 'won', side: 0, by: 'objective', mode: 'points' }, 0, { ...deps, points: { mine: 612, theirs: 540, target: 600 } });
    for (const sel of ['.rl-net-end__reason', '.rl-net-end__points']) expect(text(h, sel), sel).toMatch(/^⟦[\s\S]*⟧$/);
  });
});
