// @vitest-environment jsdom
//
// `showEndScreen`'s `debrief` (GDD §11, outcome-aware since G11): the one
// field this file's own `EndScreenOptions` carries beyond plain navigation.
// The victory/defeat PICK itself happens in `main.ts` (it is the one place
// `mission.debrief` and `me.result` are both in scope) -- what this screen
// owns, and what these tests hold it to, is rendering whatever single
// resolved line it was handed, or nothing at all when it was handed none.
// Everything else about the end screen (the campaign map, the sandbox
// picker) is pure navigation with nothing to assert beyond "the link
// exists", which is not what changed here.

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
  // Already resolved the way `main.ts` resolves them, off `speakerPlate`/
  // `speakerPortrait` -- this file has no `HudCommanderInfo` to look one up
  // against, on purpose (see the file-header comment).
  const shaiVictory = {
    plate: 'CPT. HAMMAI',
    text: 'That is the district on a board for the first time.',
    portrait: '/portraits/shai_hammai.png',
  };
  const iditDefeat = { plate: 'LT. ZOHAR', text: 'The line held. Nine did not come in.' };

  it('shows the victory line and plate on a win', () => {
    const host = document.createElement('div');
    showEndScreen(host, {
      result: 'victory',
      roe: 94,
      survivors: 11,
      missionId: 'beit_sahwan_breach',
      debrief: shaiVictory,
    });
    const debrief = host.querySelector('.rl-enddebrief');
    expect(debrief?.textContent).toBe(`“${shaiVictory.text}”`);
    expect(host.querySelector('.rl-enddebrief__who')?.textContent).toBe(shaiVictory.plate);
    // "above the rating" -- the face+plate head is the FIRST thing in the
    // panel body, ahead of the `ROE 94 · 11 unit(s) walking out` line.
    const body = host.querySelector('.rl-panel__body')!;
    expect(body.firstElementChild).toBe(host.querySelector('.rl-enddebrief__head'));
  });

  it('shows the defeat line and plate on a loss', () => {
    const host = document.createElement('div');
    showEndScreen(host, { result: 'defeat', roe: 40, survivors: 2, missionId: 'x', debrief: iditDefeat });
    expect(host.querySelector('.rl-enddebrief')?.textContent).toBe(`“${iditDefeat.text}”`);
    expect(host.querySelector('.rl-enddebrief__who')?.textContent).toBe(iditDefeat.plate);
  });

  it('shows nothing at all when this outcome has no line -- e.g. a mission with only a victory debrief, lost', () => {
    const host = document.createElement('div');
    // `main.ts` would resolve `mission.debrief?.defeat` to `undefined` here
    // and pass no `debrief` at all -- it never falls back to the victory line.
    showEndScreen(host, { result: 'defeat', roe: 40, survivors: 2, missionId: 'x' });
    expect(host.querySelector('.rl-enddebrief')).toBeNull();
    expect(host.querySelector('.rl-enddebrief__head')).toBeNull();
  });

  it('shows the portrait image when the speaker has one resolved', () => {
    const host = document.createElement('div');
    showEndScreen(host, { result: 'victory', roe: 94, survivors: 11, missionId: 'x', debrief: shaiVictory });
    const img = host.querySelector<HTMLImageElement>('.rl-enddebrief__face-img')!;
    expect(img.hidden).toBe(false);
    expect(img.getAttribute('src')).toBe(shaiVictory.portrait);
  });

  it('falls back to the hatch when the speaker has no portrait resolved', () => {
    const host = document.createElement('div');
    showEndScreen(host, { result: 'defeat', roe: 40, survivors: 2, missionId: 'x', debrief: iditDefeat });
    const img = host.querySelector<HTMLImageElement>('.rl-enddebrief__face-img')!;
    expect(img.hidden).toBe(true);
    expect(img.hasAttribute('src')).toBe(false);
    expect(host.querySelector('.rl-enddebrief__face')!.classList.contains('rl-enddebrief__face--net')).toBe(
      false
    );
  });

  it('shows the brigade mark, not the hatch, for a net debrief speaker', () => {
    const host = document.createElement('div');
    showEndScreen(host, {
      result: 'defeat',
      roe: 40,
      survivors: 2,
      missionId: 'x',
      debrief: { plate: 'NET', text: 'Reinforcements are twelve minutes out.', speaker: 'net' },
    });
    const face = host.querySelector('.rl-enddebrief__face')!;
    expect(face.classList.contains('rl-enddebrief__face--net')).toBe(true);
    const img = host.querySelector<HTMLImageElement>('.rl-enddebrief__face-img')!;
    expect(img.hidden).toBe(true);
    expect(img.hasAttribute('src')).toBe(false);
    expect(face.querySelector('.rl-enddebrief__face-mark svg')).not.toBeNull();
  });

  it('does not truncate a debrief at any length -- character limits are the schema\'s, not this screen\'s', () => {
    const host = document.createElement('div');
    const long = 'a'.repeat(240);
    showEndScreen(host, {
      result: 'victory',
      roe: 100,
      survivors: 5,
      missionId: 'x',
      debrief: { plate: 'CPT. HAMMAI', text: long },
    });
    expect(host.querySelector('.rl-enddebrief')!.textContent).toBe(`“${long}”`);
  });
});
