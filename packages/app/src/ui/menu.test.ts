// @vitest-environment jsdom
//
// `showEndScreen`'s `debrief` (GDD §11): the one new field this file's own
// `EndScreenOptions` gained. Everything else about the end screen (the
// campaign map, the sandbox picker) is pure navigation with nothing to
// assert beyond "the link exists", which is not what changed here.

import { describe, expect, it } from 'vitest';
import { showEndScreen, showMenu } from './menu';
import type { ParsedWorld } from '../campaign';

const world = { name: 'The Sahar Basin' } as unknown as ParsedWorld;
const tutorial = { id: 'beit_sahwan_0_tutorial', name: 'Tutorial', done: true };

describe('showMenu audio toggle', () => {
  it('renders the mixer state and flips it on click, through the mixer and not a local copy', () => {
    let muted = true;
    const audio = {
      isMuted: () => muted,
      toggle: () => {
        muted = !muted;
        return muted;
      },
    };
    const stage = document.createElement('div');
    showMenu(stage, { base: '/', version: '0.0.0', world, tutorial, audio });
    const b = stage.querySelector<HTMLButtonElement>('button.rl-menu__item')!;
    expect(b.textContent).toBe('♪ audio off');
    expect(b.getAttribute('aria-pressed')).toBe('false');
    b.click();
    expect(muted).toBe(false);
    expect(b.textContent).toBe('♪ audio on');
    expect(b.getAttribute('aria-pressed')).toBe('true');
  });

  it('draws no toggle when the shell passes no mixer', () => {
    const stage = document.createElement('div');
    showMenu(stage, { base: '/', version: '0.0.0', world, tutorial });
    expect(stage.querySelector('button.rl-menu__item')).toBeNull();
  });
});

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
