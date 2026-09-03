// @vitest-environment jsdom
//
// `showEndScreen`'s `debrief` (GDD §11): the one new field this file's own
// `EndScreenOptions` gained. Everything else about the end screen (the
// campaign map, the sandbox picker) is pure navigation with nothing to
// assert beyond "the link exists", which is not what changed here.

import { describe, expect, it } from 'vitest';
import { showEndScreen } from './menu';

describe('showEndScreen', () => {
  it('shows the debrief above the rating when the mission declares one', () => {
    const host = document.createElement('div');
    showEndScreen(host, {
      result: 'victory',
      roe: 94,
      survivors: 11,
      missionId: 'beit_sahwan_breach',
      debrief: 'Shai writes the names down before he writes the report.',
    });
    const debrief = host.querySelector('.rl-enddebrief');
    expect(debrief?.textContent).toBe('Shai writes the names down before he writes the report.');
    // "above the rating" -- debrief is the FIRST thing in the panel body,
    // ahead of the `ROE 94 · 11 unit(s) walking out` line.
    const body = host.querySelector('.rl-panel__body')!;
    expect(body.firstElementChild).toBe(debrief);
  });

  it('shows nothing extra when the mission declares no debrief', () => {
    const host = document.createElement('div');
    showEndScreen(host, { result: 'defeat', roe: 40, survivors: 2, missionId: 'x' });
    expect(host.querySelector('.rl-enddebrief')).toBeNull();
  });

  it('does not truncate a debrief at any length -- character limits are the schema\'s, not this screen\'s', () => {
    const host = document.createElement('div');
    const long = 'a'.repeat(240);
    showEndScreen(host, { result: 'victory', roe: 100, survivors: 5, missionId: 'x', debrief: long });
    expect(host.querySelector('.rl-enddebrief')!.textContent).toBe(long);
  });
});
