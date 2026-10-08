// @vitest-environment jsdom
//
// The end-of-mission panel (the after-action report, which absorbed the end
// screen under GH-417 L-7) keeps its
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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { showDebrief, type DebriefOptions } from './debrief';

afterEach(() => {
  document.body.innerHTML = '';
});

const debriefOpts = (over: Partial<DebriefOptions> = {}): DebriefOptions => ({
  result: 'victory',
  stars: 2,
  report: { reason: [], ladder: [], well: [], poor: [], changed: [], pins: [] },
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

describe('debrief: actions always reachable', () => {
  it('keeps the action row in a foot and focuses the next mission', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    showDebrief(host, debriefOpts({ next: { id: 'b', name: 'Tel Marum I' } }));
    expectFootLayout(host);
    expect(label(document.activeElement)).toBe('Next: Tel Marum I');
  });

  it('focuses the campaign map after a victory with nothing to follow', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    showDebrief(host, debriefOpts());
    expect(label(document.activeElement)).toBe('campaign map');
  });

  // A click that skips the outcome moment lands its mousedown on the report's
  // backdrop and drops focus to <body>. Falsified: no deferred re-focus.
  it('takes focus back from <body> a task after mounting', () => {
    vi.useFakeTimers();
    try {
      const host = document.createElement('div');
      document.body.appendChild(host);
      showDebrief(host, debriefOpts({ next: { id: 'b', name: 'Tel Marum I' } }));
      (document.activeElement as HTMLElement).blur();
      expect(document.activeElement).toBe(document.body);
      vi.runAllTimers();
      expect(label(document.activeElement)).toBe('Next: Tel Marum I');
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a fresh Enter through and swallows a held one', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    showDebrief(host, debriefOpts({ next: { id: 'b', name: 'Tel Marum I' } }));
    const primary = document.activeElement!;
    const fresh = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    primary.dispatchEvent(fresh);
    expect(fresh.defaultPrevented).toBe(false);
    const held = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true });
    primary.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
  });

  it('carries no inline position, so the class decides where it sits', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    showDebrief(host, debriefOpts());
    const panel = host.querySelector<HTMLElement>('.rl-panel')!;
    expect(panel.style.top).toBe('');
    expect(panel.style.transform).toBe('');
  });

  it('focuses try again after a defeat', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    showDebrief(host, debriefOpts({ result: 'defeat' }));
    expect(label(document.activeElement)).toBe('Try again');
  });
});
