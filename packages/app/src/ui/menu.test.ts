// @vitest-environment jsdom
//
// `showEndScreen`'s `debrief` (GDD §11, outcome-aware since G11): the one
// field this file's own `EndScreenOptions` carried beyond plain navigation,
// until a victory's `aftermath` joined it (the final review's second
// correction to ruling 9, tested below with the value the moment is handed).
// The victory/defeat PICK itself happens in `main.ts` (it is the one place
// `mission.debrief` and `me.result` are both in scope) -- what this screen
// owns, and what these tests hold it to, is rendering whatever single
// resolved line it was handed, or nothing at all when it was handed none.
// Everything else about the end screen (the campaign map, the sandbox
// picker) is pure navigation with nothing to assert beyond "the link
// exists", which is not what changed here.

import { describe, expect, it } from 'vitest';
import { applyMissionLocale, missions } from '@lions/data';
import type { MissionJson } from '@lions/sim';
import { showEndScreen, showMenu } from './menu';
import { outcomeMomentOptions } from './outcome-moment';
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
    // panel body, ahead of the `Conduct 94 · 11 units walking out` line.
    // The catalogue's `menu.end.summary` is a real plural now, not the old
    // `unit(s)` shorthand.
    const body = host.querySelector('.rl-panel__body')!;
    expect(body.firstElementChild).toBe(host.querySelector('.rl-enddebrief__head'));
    expect(body.textContent).toContain('Conduct 94 · 11 units walking out');
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

  // Final review, the second correction to ruling 9. The outcome moment
  // previews a victory's `aftermath` for its 2.6 s hold, and about 45 words
  // do not read in that -- the old HUD banner stayed up. So this screen, the
  // one that stays, carries it too, and from the SAME value the moment is
  // handed: `outcomeMomentOptions` over the locale-applied mission, which is
  // what `main.ts` passes both surfaces. `wadi_halam_5_depot` closes the Wadi
  // Halam arc. Victory only, as the banner drew it; text, never markup.
  it('carries a won finale\'s aftermath from the value the moment is handed, and a lost one\'s not', () => {
    const raw = (missions as Record<string, MissionJson | undefined>).wadi_halam_5_depot;
    if (raw === undefined) throw new Error('fixture: wadi_halam_5_depot is gone');
    const mission = applyMissionLocale(raw, null);
    expect(mission.aftermath, 'premise: the finale authors an aftermath').toMatch(/^The corridor is cut\./);

    const end = (result: 'victory' | 'defeat', aftermath: string | undefined): HTMLElement => {
      const host = document.createElement('div');
      showEndScreen(host, {
        result,
        roe: 90,
        survivors: 5,
        missionId: mission.id,
        debrief: { plate: 'CPT. HAMMAI', text: 'Nineteen points.' },
        aftermath,
      });
      return host;
    };

    const won = end('victory', outcomeMomentOptions('victory', mission).aftermath);
    const after = won.querySelector('.rl-endaftermath');
    expect(after?.textContent).toBe(mission.aftermath);
    // Under the speaker's line, above the rating.
    expect(won.querySelector('.rl-enddebrief')?.nextElementSibling).toBe(after);

    const lost = end('defeat', outcomeMomentOptions('defeat', mission).aftermath);
    expect(lost.querySelector('.rl-endaftermath')).toBeNull();

    // Mission data, so text: an authored tag shows as the characters it is.
    const tagged = end('victory', 'The corridor is <b>cut</b>.');
    expect(tagged.querySelector('.rl-endaftermath b')).toBeNull();
    expect(tagged.querySelector('.rl-endaftermath')?.textContent).toBe('The corridor is <b>cut</b>.');
  });

  it('offers the debrief when a caller wires one', () => {
    const host = document.createElement('div');
    let opened = 0;
    showEndScreen(host, { result: 'victory', roe: 94, survivors: 11, missionId: 'x', onDebrief: () => opened++ });
    host.querySelector<HTMLButtonElement>('button.rl-endnav__debrief')!.click();
    expect(opened).toBe(1);
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
