// @vitest-environment jsdom
//
// The match-over panel (N1b task 10): the result from THIS seat's side, its
// reason, and two ways out. It writes nothing -- no ledger, no account, no
// credits, no save -- which the storage spy below holds.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { showNetEnd } from './net-end';

afterEach(() => {
  document.body.innerHTML = '';
});

const deps = () => ({ again: vi.fn(), menu: vi.fn() });
const title = (): string => (document.querySelector('.rl-net-end .rl-panel__title')?.textContent ?? '').trim();
const reason = (): string => (document.querySelector('.rl-net-end__reason')?.textContent ?? '').trim();
const button = (act: string): HTMLButtonElement | null => document.querySelector(`.rl-net-end button[data-act="${act}"]`);

describe('showNetEnd', () => {
  it('viewer 0 with side 0 winning reads Victory, with the reason', () => {
    showNetEnd(document.body, { kind: 'won', side: 0, by: 'annihilation' }, 0, deps());
    expect(title()).toBe('Victory');
    expect(reason()).toBe('Their force is destroyed');
  });

  it('viewer 1 on the same result reads Defeat', () => {
    showNetEnd(document.body, { kind: 'won', side: 0, by: 'annihilation' }, 1, deps());
    expect(title()).toBe('Defeat');
    expect(reason()).toBe('Your force is destroyed');
  });

  it('names a surrender and a leave from the winner\'s side', () => {
    showNetEnd(document.body, { kind: 'won', side: 1, by: 'surrender' }, 1, deps());
    expect([title(), reason()]).toEqual(['Victory', 'They surrendered']);
    document.body.innerHTML = '';
    showNetEnd(document.body, { kind: 'won', side: 1, by: 'surrender' }, 0, deps());
    expect([title(), reason()]).toEqual(['Defeat', 'You surrendered']);
    document.body.innerHTML = '';
    showNetEnd(document.body, { kind: 'won', side: 0, by: 'left' }, 0, deps());
    expect([title(), reason()]).toEqual(['Victory', 'They left the match']);
  });

  it('a forfeit names the reason on the winner\'s panel, and the dropper reads its own side of it', () => {
    showNetEnd(document.body, { kind: 'won', side: 0, by: 'forfeit' }, 0, deps());
    expect([title(), reason()]).toEqual(['Victory', 'They disconnected']);
    document.body.innerHTML = '';
    showNetEnd(document.body, { kind: 'won', side: 0, by: 'forfeit' }, 1, deps());
    expect([title(), reason()]).toEqual(['Defeat', 'You disconnected']);
  });

  it('a draw reads Draw, mutual or on equal forces at the time limit, for either viewer', () => {
    showNetEnd(document.body, { kind: 'draw', by: 'mutual' }, 1, deps());
    expect([title(), reason()]).toEqual(['Draw', 'Both forces destroyed']);
    document.body.innerHTML = '';
    showNetEnd(document.body, { kind: 'draw', by: 'time', forces: [1900, 1900] }, 0, deps());
    expect([title(), reason()]).toEqual(['Draw', 'Time — equal forces (1,900 vs 1,900)']);
  });

  it('a result on surviving value names the cause and both totals, this seat\'s first (2026-10-13)', () => {
    showNetEnd(document.body, { kind: 'won', side: 0, by: 'stalemate', forces: [2450, 1900] }, 0, deps());
    expect([title(), reason()]).toEqual(['Victory', 'Stalemate — won on remaining forces (2,450 vs 1,900)']);
    document.body.innerHTML = '';
    showNetEnd(document.body, { kind: 'won', side: 0, by: 'stalemate', forces: [2450, 1900] }, 1, deps());
    expect([title(), reason()]).toEqual(['Defeat', 'Stalemate — lost on remaining forces (1,900 vs 2,450)']);
    document.body.innerHTML = '';
    showNetEnd(document.body, { kind: 'won', side: 1, by: 'time', forces: [800, 3100] }, 1, deps());
    expect([title(), reason()]).toEqual(['Victory', 'Time — won on remaining forces (3,100 vs 800)']);
    document.body.innerHTML = '';
    showNetEnd(document.body, { kind: 'draw', by: 'stalemate', forces: [600, 600] }, 1, deps());
    expect([title(), reason()]).toEqual(['Draw', 'Stalemate — equal forces (600 vs 600)']);
  });

  it('"Play again" calls again, "Main menu" calls menu, and Play again has focus', () => {
    const d = deps();
    showNetEnd(document.body, { kind: 'draw', by: 'time', forces: [1, 1] }, 0, d);
    const again = button('again');
    const menu = button('menu');
    expect(again?.textContent?.trim()).toBe('Play again');
    expect(menu?.textContent?.trim()).toBe('Main menu');
    expect(document.activeElement).toBe(again);
    again?.click();
    expect(d.again).toHaveBeenCalledTimes(1);
    expect(d.menu).not.toHaveBeenCalled();
    menu?.click();
    expect(d.menu).toHaveBeenCalledTimes(1);
  });

  it('its disposer removes everything it mounted', () => {
    const before = document.body.childElementCount;
    const dispose = showNetEnd(document.body, { kind: 'draw', by: 'time', forces: [1, 1] }, 0, deps());
    expect(document.body.childElementCount).toBeGreaterThan(before);
    dispose();
    expect(document.body.childElementCount).toBe(before);
    expect(document.querySelector('.rl-net-end')).toBeNull();
  });

  it('writes nothing to storage: no ledger, account, credits or save', () => {
    // jsdom's own localStorage is a bare {} on some Node versions and a real
    // Storage on others, so the test installs the shape it counts on: a
    // store per area that records every write.
    const writes: string[] = [];
    const store = (area: string): Storage => {
      const m = new Map<string, string>();
      return {
        get length() { return m.size; },
        key: (i: number) => [...m.keys()][i] ?? null,
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => { writes.push(`${area}.setItem ${k}`); m.set(k, v); },
        removeItem: (k: string) => { writes.push(`${area}.removeItem ${k}`); m.delete(k); },
        clear: () => { writes.push(`${area}.clear`); m.clear(); },
      };
    };
    const saved = { local: Object.getOwnPropertyDescriptor(window, 'localStorage'), session: Object.getOwnPropertyDescriptor(window, 'sessionStorage') };
    Object.defineProperty(window, 'localStorage', { value: store('local'), configurable: true });
    Object.defineProperty(window, 'sessionStorage', { value: store('session'), configurable: true });
    try {
      const d = deps();
      const dispose = showNetEnd(document.body, { kind: 'won', side: 0, by: 'surrender' }, 0, d);
      button('again')?.click();
      button('menu')?.click();
      dispose();
      expect(writes).toEqual([]);
    } finally {
      // jsdom keeps both on the prototype: an own property here only shadows it.
      if (saved.local) Object.defineProperty(window, 'localStorage', saved.local);
      else Reflect.deleteProperty(window, 'localStorage');
      if (saved.session) Object.defineProperty(window, 'sessionStorage', saved.session);
      else Reflect.deleteProperty(window, 'sessionStorage');
    }
  });
});
