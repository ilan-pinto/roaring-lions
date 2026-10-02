// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { livingHostiles, withdrewLine } from './withdrew';
import { showEndScreen } from './menu';
import { showDebrief, type DebriefOptions } from './debrief';

const debrief = (over: Partial<DebriefOptions>): DebriefOptions => ({
  result: 'victory', stars: 2, roe: 80, roeFloor: 60, invoice: [], ticks: 1200, lost: [],
  secondaries: [], marked: 0, promoted: 0, unlocked: [], missionId: 'm', ...over,
});

describe('livingHostiles', () => {
  it('counts living side-1 units only, not our own, civilians or the dead', () => {
    const state = { side: [0, 1, 1, 2, 1], alive: [1, 1, 0, 1, 1] };
    expect(livingHostiles(state, 5)).toBe(2);
    expect(livingHostiles(state, 2)).toBe(1); // bounded by the count it is given
  });
});

describe('the withdrew line', () => {
  it('is gated to a victory with survivors', () => {
    expect(withdrewLine('victory', 3)).toBe('Remaining enemy forces withdrew (3)');
    expect(withdrewLine('victory', 0)).toBeNull();
    expect(withdrewLine('victory', undefined)).toBeNull();
    expect(withdrewLine('defeat', 3)).toBeNull();
  });

  it('shows on the end screen and debrief of a victory with survivors, and not otherwise', () => {
    const end = (result: 'victory' | 'defeat', withdrew: number): HTMLElement => {
      const h = document.createElement('div');
      showEndScreen(h, { result, roe: 90, survivors: 4, missionId: 'm', withdrew });
      return h;
    };
    expect(end('victory', 2).querySelector('.rl-endwithdrew')?.textContent).toBe('Remaining enemy forces withdrew (2)');
    expect(end('victory', 0).querySelector('.rl-endwithdrew')).toBeNull();
    expect(end('defeat', 2).querySelector('.rl-endwithdrew')).toBeNull();

    const deb = (o: Partial<DebriefOptions>): HTMLElement => {
      const h = document.createElement('div');
      showDebrief(h, debrief(o));
      return h;
    };
    expect(deb({ withdrew: 2 }).querySelector('.rl-debrief__withdrew')?.textContent).toBe('Remaining enemy forces withdrew (2)');
    expect(deb({ withdrew: 0 }).querySelector('.rl-debrief__withdrew')).toBeNull();
    expect(deb({ result: 'defeat', withdrew: 2 }).querySelector('.rl-debrief__withdrew')).toBeNull();
  });
});
