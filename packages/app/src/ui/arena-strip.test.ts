// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';
import { missingKeys, setCatalogue } from '../i18n/t';
import type { MatchScore } from '../net/scoreboard';
import { stripText, type StripInput, type WatchPhase } from '../net/spectator';
import { mountArenaStrip } from './arena-strip';

afterEach(() => { setCatalogue('en', en); });

const SCORE: MatchScore = [
  { lost: 2, lostValue: 20, destroyed: 5, destroyedValue: 50, remaining: 800 },
  { lost: 5, lostValue: 50, destroyed: 2, destroyedValue: 20, remaining: 650 },
];
const input = (phase: WatchPhase, over: Partial<StripInput> = {}): StripInput => ({
  phase, n: 3, of: 4, labels: ['rush', 'passive'], score: SCORE, sides: [0, 1], tick: 560, roundTicks: 40, waiting: true,
  verdict: { outcome: 'seat0', by: 'cap' }, view: 'a', ...over,
});
const PHASES: WatchPhase[] = ['connecting', 'playing', 'finished', 'between', 'done', 'no-run', 'refused'];

/** Every piece of chrome text the strip puts in the DOM: text nodes, aria-labels, titles. */
function chrome(root: HTMLElement): string[] {
  const out: string[] = [];
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    for (const a of ['aria-label', 'title', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v !== null && v !== '') out.push(v);
    }
    if (el.hidden) continue;
    for (const n of el.childNodes) if (n.nodeType === 3 && (n.textContent ?? '').trim() !== '') out.push((n.textContent ?? '').trim());
  }
  return out;
}

describe('the arena strip (GH-954 W1)', () => {
  it('paints the game, the players, the score, the round and tick, the wait, the toggle, and nothing else', () => {
    const strip = mountArenaStrip(document.body, { onView: () => {}, onStop: () => {} });
    strip.update(stripText(input('playing')));
    const el = document.querySelector<HTMLElement>('.rl-arena-strip')!;
    const text = (cls: string): string => el.querySelector<HTMLElement>(`.rl-arena-strip__${cls}`)!.textContent ?? '';
    expect(text('game')).toBe('Game 3 of 4');
    expect(text('players')).toBe('rush vs passive');
    expect(text('score')).toBe('Destroyed 5 : 2');
    expect(text('clock')).toBe('Round 15 · 0:28 · tick 560');
    expect(text('status')).toBe('Round 15: waiting on the players');
    expect([...el.querySelectorAll<HTMLElement>('.rl-arena-strip__view')].map((b) => [b.dataset.view, b.textContent, b.getAttribute('aria-checked')])).toEqual([
      ['all', 'Both sides', 'false'], ['a', 'Side A', 'true'], ['b', 'Side B', 'false'],
    ]);
    strip.dispose();
    expect(document.querySelector('.rl-arena-strip')).toBeNull();
  });

  it('the toggle and Stop call back; nothing else on the strip is a control', () => {
    const views: string[] = [];
    let stopped = 0;
    const strip = mountArenaStrip(document.body, { onView: (c) => views.push(c), onStop: () => { stopped++; } });
    strip.update(stripText(input('playing')));
    for (const b of document.querySelectorAll<HTMLButtonElement>('.rl-arena-strip__view')) b.click();
    document.querySelector<HTMLButtonElement>('.rl-arena-strip__stop')!.click();
    expect(views).toEqual(['all', 'a', 'b']);
    expect(stopped).toBe(1);
    expect(document.querySelectorAll('.rl-arena-strip button, .rl-arena-strip input, .rl-arena-strip a').length).toBe(4);
    strip.dispose();
  });

  it('repaints only when the text changed (a 4 Hz caller costs nothing)', () => {
    const strip = mountArenaStrip(document.body, { onView: () => {}, onStop: () => {} });
    strip.update(stripText(input('playing')));
    const game = document.querySelector('.rl-arena-strip__game')!;
    const sets = vi.fn();
    new MutationObserver(sets).observe(game, { childList: true, characterData: true, subtree: true });
    strip.update(stripText(input('playing')));
    expect(sets).not.toHaveBeenCalled();
    strip.dispose();
  });

  // The pseudo-locale brackets every string that went through t(): a bare word in the strip never did.
  // Checked here, on every phase, instead of by a browser capture.
  it('under ?pseudo=1 every string the strip shows, in every phase, is bracketed (none bypassed t())', () => {
    setCatalogue('pseudo', en, pseudo);
    const shown: string[] = [];
    for (const phase of PHASES) {
      const strip = mountArenaStrip(document.body, { onView: () => {}, onStop: () => {} });
      strip.update(stripText(input(phase, { waiting: phase === 'playing' })));
      const el = document.querySelector<HTMLElement>('.rl-arena-strip')!;
      for (const s of chrome(el)) {
        shown.push(s);
        expect(s, `${phase}: ${s}`).toMatch(/^⟦[\s\S]*⟧$/);
      }
      strip.dispose();
    }
    // Not vacuous: the strip said something in each phase, including the controls.
    expect(shown.length).toBeGreaterThan(30);
    expect(shown.some((s) => s.includes('Ƀ') || s.includes('ƀ'))).toBe(true);
    expect(missingKeys().filter((k) => k.startsWith('arena.'))).toEqual([]);
  });

  it('every arena.* key the strip reads exists in en.json', () => {
    const strip = mountArenaStrip(document.body, { onView: () => {}, onStop: () => {} });
    for (const phase of PHASES) strip.update(stripText(input(phase)));
    strip.dispose();
    expect(missingKeys().filter((k) => k.startsWith('arena.'))).toEqual([]);
  });
});
