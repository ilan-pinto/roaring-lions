// @vitest-environment jsdom
// Named briefing sections and the image slot on the deploy screen (GH-119).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { missions } from '@lions/data';
import type { MissionJson } from '@lions/sim';
import en from '../i18n/en.json';
import { setCatalogue } from '../i18n/t';
import { briefingSections, pickBriefingImage, SECTION_IDS } from './briefing-sections';
import { showLoading } from './loading';

const BRIEF = 'Idit has the picture. It is thin. Take the ridge. Hold it till dark. Bring them home.';
const SECTIONS = [
  { id: 'situation', text: 'Idit has the picture. It is thin.', image: 'ui/portraits/idit_zohar.png' },
  { id: 'mission', text: 'Take the ridge.' },
  { id: 'execution', text: 'Hold it till dark.' },
  { id: 'notes', text: 'Bring them home.' },
];

describe('briefingSections', () => {
  it('turns authored sections into beats, keeping order and images', () => {
    const out = briefingSections(BRIEF, SECTIONS);
    expect(out?.map((s) => s.id)).toEqual(['situation', 'mission', 'execution', 'notes']);
    expect(out?.[0]).toEqual({ id: 'situation', beats: ['Idit has the picture. It is thin.'], image: 'ui/portraits/idit_zohar.png' });
    expect(out?.[1]).toEqual({ id: 'mission', beats: ['Take the ridge.'] });
  });

  it('draws the plain beats when there are no sections', () => {
    expect(briefingSections(BRIEF, undefined)).toBeNull();
    expect(briefingSections(BRIEF, [])).toBeNull();
    expect(briefingSections(undefined, SECTIONS)).toBeNull();
  });

  it('draws the plain beats once the sections no longer spell the briefing (a translated overlay)', () => {
    expect(briefingSections('Idit a la carte. Prenez la crête.', SECTIONS)).toBeNull();
    // One word of drift is enough.
    expect(briefingSections(BRIEF.replace('dark', 'dawn'), SECTIONS)).toBeNull();
  });

  it('tolerates whitespace differences between the sections and the briefing', () => {
    expect(briefingSections(`  ${BRIEF.replace(/ /g, '  ')}\n`, SECTIONS)).not.toBeNull();
  });

  it('refuses an id outside the closed set', () => {
    expect(briefingSections(BRIEF, [{ ...SECTIONS[0], id: 'enemy' }, ...SECTIONS.slice(1)])).toBeNull();
  });

  it('every id has a heading in the catalogue', () => {
    for (const id of SECTION_IDS) expect((en as Record<string, string>)[`briefing.section.${id}`]).toBeTruthy();
  });

  it('the shipped exemplars are sectioned, and still spell their briefings', () => {
    for (const id of ['beit_sahwan_1_recon', 'beit_sahwan_0_tutorial']) {
      const m = missions[id as keyof typeof missions] as MissionJson;
      expect(briefingSections(m.briefing, m.briefing_sections), id).not.toBeNull();
    }
  });
});

describe('pickBriefingImage', () => {
  it('passes a single image through and nothing as nothing', () => {
    expect(pickBriefingImage('ui/a.png', () => 0.99)).toBe('ui/a.png');
    expect(pickBriefingImage(undefined)).toBeUndefined();
    expect(pickBriefingImage([])).toBeUndefined();
  });

  it('picks from a pool by the random source, never past either end', () => {
    const pool = ['a', 'b', 'c'];
    expect(pickBriefingImage(pool, () => 0)).toBe('a');
    expect(pickBriefingImage(pool, () => 0.5)).toBe('b');
    expect(pickBriefingImage(pool, () => 0.9999)).toBe('c');
    expect(pickBriefingImage(pool, () => 1)).toBe('c');
    expect(pickBriefingImage(pool, () => -1)).toBe('a');
  });
});

describe('deploy screen sections and image', () => {
  let host: HTMLElement;
  beforeEach(() => {
    setCatalogue('en', en);
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => host.remove());

  const realGetContext = HTMLCanvasElement.prototype.getContext;
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
  });
  /** The least context `paintMapTerrain` can paint into (loading.test.ts's
   *  `giveCanvasAContext`): jsdom has none, and without one the spread is never
   *  drawn and the right-column assertion could not fail. */
  const giveCanvasAContext = (): void => {
    const ctx = { fillStyle: '', fillRect: (): void => undefined };
    HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
  };
  const PREVIEW = {
    map: { width: 3, height: 2, blocked: new Uint8Array(6), boulder: new Uint8Array(6), cover: new Uint8Array(6) },
    tones: { open: 'open', blocked: 'blocked', rock: 'rock', cover: ['c1', 'c2', 'c3'] },
  } as unknown as Parameters<typeof showLoading>[10];

  const mount = (layout?: Parameters<typeof showLoading>[11], briefing = BRIEF, preview = false) =>
    showLoading(
      host,
      'Ridge',
      briefing,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      preview ? PREVIEW : undefined,
      layout
    );

  it('an unsectioned briefing renders exactly as before: beats straight under the brief, no headings', () => {
    mount(undefined);
    const brief = host.querySelector('.rl-loading__brief');
    expect(brief?.querySelector('.rl-loading__section')).toBeNull();
    expect([...(brief?.children ?? [])].every((c) => c.classList.contains('rl-loading__beat'))).toBe(true);
    expect(host.querySelector('.rl-loading__image')).toBeNull();
  });

  it('draws one labelled, focusable section per block, headed through t()', () => {
    mount({ sections: briefingSections(BRIEF, SECTIONS) });
    const els = [...host.querySelectorAll<HTMLElement>('.rl-loading__section')];
    expect(els.map((e) => e.dataset.section)).toEqual(['situation', 'mission', 'execution', 'notes']);
    expect(els.map((e) => e.querySelector('h3')?.textContent)).toEqual(['Situation', 'Mission', 'Execution', 'Notes']);
    for (const el of els) {
      expect(el.tabIndex).toBe(0);
      const head = el.querySelector('h3');
      expect(head?.id).toBeTruthy();
      expect(el.getAttribute('aria-labelledby')).toBe(head?.id);
    }
  });

  it('keeps the beats as beats, indexed across sections', () => {
    mount({ sections: briefingSections(BRIEF, SECTIONS) });
    const beats = [...host.querySelectorAll<HTMLElement>('.rl-loading__beat')];
    expect(beats.map((b) => b.dataset.index)).toEqual(['0', '1', '2', '3']);
    expect(beats.every((b) => b.closest('.rl-loading__section') !== null)).toBe(true);
  });

  it('a section image is decorative, and one that fails to load takes itself out', () => {
    mount({ sections: briefingSections(BRIEF, SECTIONS) });
    const img = host.querySelector<HTMLImageElement>('.rl-loading__section-img');
    expect(img?.getAttribute('src')).toBe('ui/portraits/idit_zohar.png');
    expect(img?.alt).toBe('');
    expect(host.querySelectorAll('.rl-loading__section-img')).toHaveLength(1);
    img?.dispatchEvent(new Event('error'));
    expect(host.querySelector('.rl-loading__section-img')).toBeNull();
  });

  it('the mission image sits above the orders without a spread, and leaves on error', () => {
    mount({ sections: null, image: '/ui/plates/units/inf_squad.jpg' });
    const fig = host.querySelector('.rl-loading__image');
    expect(fig?.querySelector('img')?.getAttribute('src')).toBe('/ui/plates/units/inf_squad.jpg');
    expect(fig?.nextElementSibling?.classList.contains('rl-loading__brief')).toBe(true);
    fig?.querySelector('img')?.dispatchEvent(new Event('error'));
    expect(host.querySelector('.rl-loading__image')).toBeNull();
  });

  it('the mission image heads the right-hand column when the spread is drawn', () => {
    giveCanvasAContext();
    mount({ sections: null, image: '/ui/plates/units/inf_squad.jpg' }, BRIEF, true);
    const right = host.querySelector('.rl-loading__force');
    expect(right?.querySelector('.rl-deploy__map')).not.toBeNull();
    expect(right?.firstElementChild?.classList.contains('rl-loading__image')).toBe(true);
    expect(host.querySelector('.rl-loading__orders .rl-loading__image')).toBeNull();
  });

  it('a sandbox (no briefing) shows neither sections nor image', () => {
    mount({ sections: briefingSections(BRIEF, SECTIONS), image: '/x.jpg' }, '');
    expect(host.querySelector('.rl-loading__section')).toBeNull();
    expect(host.querySelector('.rl-loading__image')).toBeNull();
  });

  it('dispose takes the sections and the image down with the screen', () => {
    const screen = mount({ sections: briefingSections(BRIEF, SECTIONS), image: '/x.jpg' });
    screen.dispose();
    expect(host.querySelector('.rl-loading__section')).toBeNull();
    expect(host.querySelector('.rl-loading__image')).toBeNull();
    expect(host.childElementCount).toBe(0);
  });
});
