// @vitest-environment jsdom
//
// The main menu. (The end screen these tests also covered was folded into
// the after-action report, GH-417 L-7: `debrief.test.ts`.)

import { describe, expect, it } from 'vitest';
import { showMenu } from './menu';
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
    // `[aria-pressed]` picks out the audio toggle specifically: task 6 gave
    // the ledger reset a `<button>` too (same `rl-menu__item` look), so a bare
    // `button.rl-menu__item` selector is no longer unique to the mixer.
    const b = stage.querySelector<HTMLButtonElement>('button.rl-menu__item[aria-pressed]')!;
    // GH-261: the APP-6 signals bolt, struck through for radio silence.
    expect(b.textContent?.trim()).toBe('audio off');
    expect(b.querySelector('svg')?.getAttribute('data-symbol')).toBe('audioOff');
    expect(b.getAttribute('aria-pressed')).toBe('false');
    b.click();
    expect(muted).toBe(false);
    expect(b.textContent?.trim()).toBe('audio on');
    expect(b.querySelector('svg')?.getAttribute('data-symbol')).toBe('audioOn');
    expect(b.getAttribute('aria-pressed')).toBe('true');
  });

  it('draws no toggle when the shell passes no mixer', () => {
    const stage = document.createElement('div');
    showMenu(stage, { base: '/', version: '0.0.0', world, tutorial });
    expect(stage.querySelector('button.rl-menu__item[aria-pressed]')).toBeNull();
  });
});

describe('showMenu new campaign', () => {
  it('is a button, confirmed before it navigates -- not a plain link', async () => {
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    let reset = 0;
    showMenu(stage, { base: '/', version: '0.0.0', world, tutorial, newCampaign: () => reset++ });
    const btn = [...stage.querySelectorAll<HTMLButtonElement>('button.rl-menu__item')].find(
      (b) => b.textContent === 'New campaign'
    )!;
    expect(btn).toBeDefined();
    btn.click();
    expect(reset).toBe(0);
    const dialog = document.querySelector<HTMLElement>('.rl-confirm')!;
    expect(dialog).not.toBeNull();
    // Names what survives ("stays"), not what is erased -- the brigade
    // account deliberately outlives a new campaign (spec 2026-09-15 §4.1).
    expect(dialog.textContent).toContain('Your brigade — its credits, unlocks and upgrades — stays.');
    dialog.querySelector<HTMLButtonElement>('.rl-confirm__yes')!.click();
    await Promise.resolve();
    expect(reset).toBe(1);
  });
});

describe('showMenu continue/start', () => {
  it('names "Start" and the tutorial mission when nothing has been played, and drops the plain tutorial item', () => {
    const stage = document.createElement('div');
    showMenu(stage, {
      base: '/',
      version: '0.0.0',
      world,
      tutorial: { ...tutorial, done: false },
      continue: { missionId: 'beit_sahwan_0_tutorial', name: 'Working Up', kind: 'tutorial' },
    });
    const items = [...stage.querySelectorAll<HTMLAnchorElement>('a.rl-menu__item')];
    expect(items[0]!.textContent).toBe('Start — Working Up');
    expect(items[0]!.getAttribute('href')).toBe('/mission/beit_sahwan_0_tutorial');
    expect(items[0]!.dataset.kind).toBe('primary');
    // Not a second, plain "Tutorial" item beside it -- the item above already
    // names the same mission.
    expect(items.filter((a) => a.dataset.kind === 'tutorial')).toHaveLength(0);
  });

  it('names "Continue" and the next mission once the tutorial is done', () => {
    const stage = document.createElement('div');
    showMenu(stage, {
      base: '/',
      version: '0.0.0',
      world,
      tutorial,
      continue: { missionId: 'beit_sahwan_1_recon', name: 'First Contact', kind: 'next' },
    });
    const first = stage.querySelector<HTMLAnchorElement>('a.rl-menu__item')!;
    expect(first.textContent).toBe('Continue — First Contact');
    expect(first.getAttribute('href')).toBe('/mission/beit_sahwan_1_recon');
  });

  it('leads with "Campaign" when the whole campaign is complete and nothing to continue', () => {
    const stage = document.createElement('div');
    showMenu(stage, { base: '/', version: '0.0.0', world, tutorial });
    const first = stage.querySelector<HTMLAnchorElement>('a.rl-menu__item')!;
    expect(first.textContent).toBe('Campaign');
  });
});

describe('showMenu aside', () => {
  it('lists Credits last, after every other aside item including the audio toggle', () => {
    const stage = document.createElement('div');
    const audio = { isMuted: () => true, toggle: () => false };
    showMenu(stage, { base: '/', version: '0.0.0', world, tutorial, audio, newCampaign: () => {} });
    const [, aside] = stage.querySelectorAll('nav.rl-menu__nav');
    const items = [...aside!.children] as HTMLElement[];
    const last = items[items.length - 1]!;
    expect(last.tagName).toBe('A');
    expect(last.textContent).toBe('Credits');
    expect(last.getAttribute('href')).toBe('/credits');
  });
});

describe('showMenu backdrop (the scene host)', () => {
  it('mounts the backdrop after the column is in the stage, handing it the column', () => {
    const stage = document.createElement('div');
    // A holder rather than two `let`s: tsc narrows a `let` assigned only in a
    // callback to its initialiser at the read below.
    const seen: { column: HTMLElement | null; inStage: boolean } = { column: null, inStage: false };
    showMenu(stage, {
      base: '/', version: '0.0.0', world, tutorial,
      backdrop: (s, column) => {
        seen.column = column;
        seen.inStage = column.parentElement === s;
        return () => {};
      },
    });
    expect(seen.inStage).toBe(true);
    expect(seen.column?.classList.contains('rl-menu')).toBe(true);
  });
  it('its disposer runs the backdrop’s disposer and removes the column', () => {
    const stage = document.createElement('div');
    let disposed = 0;
    const off = showMenu(stage, { base: '/', version: '0.0.0', world, tutorial, backdrop: () => () => void disposed++ });
    off();
    expect(disposed).toBe(1);
    expect(stage.querySelector('.rl-menu')).toBeNull();
  });
  // Spec Q1's default: with the world behind the column, a second photograph
  // of it inside the column is the same picture twice.
  it('no longer carries the key-art banner inside the column', () => {
    const stage = document.createElement('div');
    showMenu(stage, { base: '/', version: '0.0.0', world, tutorial });
    expect(stage.querySelector('img.rl-menu__banner')).toBeNull();
  });
});
