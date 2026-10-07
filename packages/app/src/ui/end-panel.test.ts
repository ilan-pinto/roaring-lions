// @vitest-environment jsdom
//
// The end-of-mission panels (the end screen and the debrief) keep their
// actions reachable: the lead's WH V victory pushed the end screen's
// next-mission and replay buttons below the viewport, because the panel grew
// downward from `top: 62%` and the action row was the last thing in its body.
//
// jsdom has no layout, so these tests pin the STRUCTURE the CSS relies on --
// the action row sits in a foot OUTSIDE the scrolling body, so no amount of
// text can carry it away -- plus the keyboard half: focus lands on the primary
// action, and a held (auto-repeating) Enter cannot fire it. The geometry
// itself (every action inside the viewport and hit-testable, at seven sizes) is
// measured in a real browser by `tools/src/ui-review/end-panel-check.ts`.

import { afterEach, describe, expect, it } from 'vitest';
import { showEndScreen, type EndScreenOptions } from './menu';
import { showDebrief, type DebriefOptions } from './debrief';

afterEach(() => {
  document.body.innerHTML = '';
});

const end = (over: Partial<EndScreenOptions> = {}): HTMLElement => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  showEndScreen(host, { result: 'victory', roe: 94, survivors: 11, missionId: 'a', onDebrief: () => undefined, ...over });
  return host;
};

const debriefOpts = (over: Partial<DebriefOptions> = {}): DebriefOptions => ({
  result: 'victory',
  stars: 2,
  roe: 84,
  roeFloor: 60,
  invoice: [],
  ticks: 20 * 60 * 4,
  lost: [],
  secondaries: [],
  marked: 0,
  promoted: 0,
  unlocked: [],
  missionId: 'a',
  ...over,
});

const label = (el: Element | null): string => (el?.textContent ?? '').trim();

function expectFootLayout(host: HTMLElement): void {
  const panel = host.querySelector('.rl-panel')!;
  expect(panel.classList.contains('rl-endpanel')).toBe(true);
  const nav = panel.querySelector('.rl-endnav')!;
  // The action row is never inside the scroller...
  expect(nav.closest('.rl-panel__body')).toBeNull();
  // ...it is the foot, and the foot is the panel's last child, after the body.
  const foot = panel.querySelector('.rl-endpanel__foot')!;
  expect(nav.parentElement).toBe(foot);
  expect(panel.lastElementChild).toBe(foot);
  expect(foot.previousElementSibling?.classList.contains('rl-panel__body')).toBe(true);
}

describe('end screen: actions always reachable', () => {
  it('keeps the action row in a foot outside the scrolling body', () => {
    expectFootLayout(end({ nextMissionId: 'b', aftermath: 'A long closing narration.'.repeat(20) }));
  });

  it('puts focus on the next mission after a victory', () => {
    end({ nextMissionId: 'b' });
    expect(label(document.activeElement)).toBe('next mission');
    expect((document.activeElement as HTMLElement).dataset.endPrimary).toBe('1');
  });

  it('puts focus on try again after a defeat', () => {
    end({ result: 'defeat' });
    expect(label(document.activeElement)).toBe('try again');
  });

  it('puts focus on the campaign map after a victory with nothing to follow', () => {
    end({ result: 'victory' });
    expect(label(document.activeElement)).toBe('campaign map');
  });

  it('lets a fresh Enter through and swallows a held one', () => {
    end({ nextMissionId: 'b' });
    const primary = document.activeElement!;
    const fresh = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    primary.dispatchEvent(fresh);
    expect(fresh.defaultPrevented).toBe(false);
    const held = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true });
    primary.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
  });

  it('carries no inline position, so the class decides where it sits', () => {
    const panel = end().querySelector<HTMLElement>('.rl-panel')!;
    expect(panel.style.top).toBe('');
    expect(panel.style.transform).toBe('');
  });
});

describe('debrief: actions always reachable', () => {
  it('keeps the action row in a foot and focuses the next mission', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    showDebrief(host, debriefOpts({ next: { id: 'b', name: 'Tel Marum I' } }));
    expectFootLayout(host);
    expect(label(document.activeElement)).toBe('next: Tel Marum I');
  });

  it('focuses try again after a defeat', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    showDebrief(host, debriefOpts({ result: 'defeat' }));
    expect(label(document.activeElement)).toBe('try again');
  });
});
