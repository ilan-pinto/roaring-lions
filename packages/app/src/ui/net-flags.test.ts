// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';
import { missingKeys, setCatalogue } from '../i18n/t';
import type { FlagView } from '../net/flag-view';
import { NetFlags, holdPercent } from './net-flags';

afterEach(() => { setCatalogue('en', en); document.body.replaceChildren(); });

const VIEW: FlagView = {
  holdSeconds: 30,
  theirs: { at: [37, 13, 5, 5], state: 'raiding', held: 12 },
  mine: { at: [6, 30, 5, 5], state: 'open', held: 0 },
};
const text = (el: ParentNode, sel: string): string => el.querySelector(sel)!.textContent!;

describe('NetFlags (GH-976 P3)', () => {
  it('shows how long each flag has been held against the hold, and its state', () => {
    const p = new NetFlags(document.body);
    p.update(VIEW);
    const el = document.querySelector<HTMLElement>('.rl-net-flags')!;
    expect(text(el, '.rl-net-points__title')).toBe('Capture the flag: hold their ground alone for 30 s');
    expect(text(el, '[data-row=theirs] .rl-net-points__who')).toBe('Their flag');
    expect(text(el, '[data-row=theirs] .rl-net-points__n')).toBe('12 / 30 s');
    expect(text(el, '[data-row=theirs] .rl-net-points__rate')).toBe('being raided');
    expect(el.querySelector<HTMLElement>('[data-row=theirs] .rl-net-points__fill')!.style.width).toBe('40%');
    expect(text(el, '[data-row=mine] .rl-net-points__who')).toBe('Your flag');
    expect(text(el, '[data-row=mine] .rl-net-points__n')).toBe('0 / 30 s');
    expect(text(el, '[data-row=mine] .rl-net-points__rate')).toBe('open');
    expect(el.getAttribute('aria-label')).toBe('Capture the flag');
    expect(missingKeys()).toEqual([]);
  });

  it('says contested and captured in words, and a captured flag is a full bar', () => {
    const p = new NetFlags(document.body);
    p.update({ ...VIEW, theirs: { ...VIEW.theirs, state: 'contested', held: 0 }, mine: { ...VIEW.mine, state: 'captured', held: 30 } });
    expect(text(document.body, '[data-row=theirs] .rl-net-points__rate')).toBe('contested');
    expect(text(document.body, '[data-row=mine] .rl-net-points__rate')).toBe('captured');
    expect(document.querySelector<HTMLElement>('[data-row=mine] .rl-net-points__fill')!.style.width).toBe('100%');
    expect(text(document.body, '[data-row=mine] .rl-net-points__n')).toBe('30 / 30 s');
  });

  it('holdPercent is whole percent of the hold, 0-100', () => {
    expect(holdPercent({ held: 12, state: 'raiding' }, 30)).toBe(40);
    expect(holdPercent({ held: 29, state: 'raiding' }, 30)).toBe(96);
    expect(holdPercent({ held: 0, state: 'contested' }, 30)).toBe(0);
    expect(holdPercent({ held: 0, state: 'captured' }, 30)).toBe(100);
    expect(holdPercent({ held: 99, state: 'raiding' }, 30)).toBe(100);
    expect(holdPercent({ held: 5, state: 'raiding' }, 0)).toBe(0);
  });

  it('repaints only when something moved, hides under the end panel, and takes itself out on dispose', () => {
    const p = new NetFlags(document.body);
    p.update(VIEW);
    const n = document.querySelector('[data-row=theirs] .rl-net-points__n')!;
    const before = n.firstChild;
    p.update({ ...VIEW });
    expect(n.firstChild).toBe(before);
    p.update({ ...VIEW, theirs: { ...VIEW.theirs, held: 13 } });
    expect(n.textContent).toBe('13 / 30 s');
    p.hide();
    expect(document.querySelector<HTMLElement>('.rl-net-flags')!.hidden).toBe(true);
    p.dispose();
    expect(document.querySelector('.rl-net-flags')).toBeNull();
  });

  it('?pseudo=1: every string it draws is bracketed, so none bypassed t()', () => {
    setCatalogue('pseudo', en, pseudo);
    const p = new NetFlags(document.body);
    p.update(VIEW);
    const el = document.querySelector<HTMLElement>('.rl-net-flags')!;
    const shown = [...el.querySelectorAll('.rl-net-points__title, .rl-net-points__who, .rl-net-points__n, .rl-net-points__rate')].map((e) => e.textContent!);
    expect(shown).toHaveLength(7);
    for (const s of shown) expect(s, s).toMatch(/^⟦[\s\S]*⟧$/);
    expect(el.getAttribute('aria-label')).toMatch(/^⟦/);
    expect(missingKeys()).toEqual([]);
  });
});
