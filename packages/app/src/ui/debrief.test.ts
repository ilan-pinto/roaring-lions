// @vitest-environment jsdom
//
// The after-action report (GH-417, H4 + H5). Its WORDS are `after-action.ts`'s
// and tested there; these hold the screen to drawing them -- the verdict, the
// ladder, the three columns in order, the closing word, the pins -- and to the
// end panel's framing (`end-panel.test.ts` holds the foot and the keys).

import { afterEach, describe, expect, it } from 'vitest';
import { applyMissionLocale, missions } from '@lions/data';
import type { MissionJson } from '@lions/sim';
import { showDebrief, type DebriefOptions } from './debrief';
import type { AfterAction } from './after-action';
import { outcomeMomentOptions } from './outcome-moment';

afterEach(() => {
  document.body.innerHTML = '';
});

const REPORT: AfterAction = {
  reason: ['Raze the depot inside five minutes · 4:12', '7:03 on the clock, of about 7:00'],
  ladder: [
    { stars: 1, met: true, text: 'Won the mission' },
    { stars: 2, met: true, text: 'Conduct 84, needed 60' },
    { stars: 3, met: false, text: 'Optional objectives that carry forward: 0 of 1' },
  ],
  well: [{ mark: '4:12', tone: 'good', text: 'Raze the depot inside five minutes' }],
  poor: [{ mark: '', tone: 'bad', text: 'Barzel · Rifle Squad', sub: 'Lost at 5:40', person: { type: 'inf_squad', lost: true } }],
  changed: [{ mark: '+220', tone: 'commend', text: 'Credits paid · brigade now 1460' }],
  pins: [{ kind: 'loss', x: 2, y: 2, label: 'Barzel · 5:40' }],
};

const opts = (over: Partial<DebriefOptions> = {}): DebriefOptions => ({ result: 'victory', stars: 2, report: REPORT, missionId: 'a', ...over });

function mount(o: DebriefOptions): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  showDebrief(host, o);
  return host;
}

describe('the after-action report (GH-417)', () => {
  // The end of the war (campaign-close.ts): the closing exchange is drawn,
  // in order and with its plates, only when main.ts hands it over.
  it('draws the closing exchange when given one, and nothing in its place otherwise', () => {
    const closing = [
      { plate: 'Zohar', text: 'one' },
      { plate: 'Hammai', text: 'two' },
    ];
    const host = mount(opts({ closing }));
    const lines = [...host.querySelectorAll('.rl-aar__closing blockquote')];
    expect(lines.map((q) => q.querySelector('cite')?.textContent)).toEqual(['Zohar', 'Hammai']);
    expect(lines[0].textContent).toContain('one');
    document.body.innerHTML = '';
    expect(mount(opts()).querySelector('.rl-aar__closing')).toBeNull();
  });

  it('draws the verdict, the reason, the ladder and the three columns in order', () => {
    const host = mount(opts());
    expect(host.querySelector('.rl-aar__tier')?.textContent).toBe('Named in brigade orders');
    expect(host.querySelector('.rl-aar__star-on')?.textContent).toBe('★★');
    expect(host.querySelector('.rl-aar__star-off')?.textContent).toBe('★');
    expect([...host.querySelectorAll('.rl-aar__reason li')].map((l) => l.textContent)).toEqual(REPORT.reason);
    expect([...host.querySelectorAll('.rl-aar__rung')].map((r) => r.className.includes('--met'))).toEqual([true, true, false]);
    expect([...host.querySelectorAll('.rl-aar__col-title')].map((h) => h.textContent)).toEqual(['Done well', 'Cost you', 'What changed']);
    expect(host.querySelector('.rl-aar__col--poor .rl-aar__mark--lost')).not.toBeNull();
  });

  it('a defeat: no ladder, no grade, and the middle column is what went wrong', () => {
    const host = mount(opts({ result: 'defeat', stars: 0, report: { ...REPORT, ladder: [] } }));
    expect(host.querySelector('.rl-aar__ladder')).toBeNull();
    expect(host.querySelector('.rl-aar__tier')).toBeNull();
    expect(host.querySelectorAll('.rl-aar__col-title')[1].textContent).toBe('What went wrong');
    // VR-24: the debrief is a document you read, so it wears the mission
    // rank after a defeat too; defeat is told by the column and the grade.
    expect(host.querySelector('.rl-panel')?.getAttribute('data-rank')).toBe('mission');
  });

  // PA-21: the live HUD must not show through. Falsified: no backdrop.
  it('sits on an opaque backdrop, and its disposer takes both away', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = showDebrief(host, opts());
    expect(host.querySelector('.rl-aar-backdrop')).not.toBeNull();
    dispose();
    expect(host.childElementCount).toBe(0);
  });

  it('draws the ground with the battle’s pins when it is given the ground', () => {
    const ctx = { fillStyle: '', fillRect: (): void => undefined, putImageData: (): void => undefined };
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
    try {
      const map = { width: 4, height: 4, blocked: new Uint8Array(16), boulder: new Uint8Array(16), cover: new Uint8Array(16) };
      const tones = { open: 'a', blocked: 'b', rock: 'c', cover: ['d', 'e', 'f'] as [string, string, string] };
      const host = mount(opts({ ground: { map, tones, marks: [] } }));
      expect(host.querySelector('.rl-aar__ground .rl-ground__pin--loss')).not.toBeNull();
    } finally {
      HTMLCanvasElement.prototype.getContext = orig;
    }
  });

  describe('the closing word (moved here from the end screen, L-7)', () => {
    it('shows the speaker’s line and plate, uncut at any length', () => {
      const long = 'a'.repeat(240);
      const host = mount(opts({ speaker: { plate: 'CPT. HAMMAI', text: long, speaker: 'shai', portrait: '/p.png' } }));
      expect(host.querySelector('.rl-aar__quote')?.firstChild?.textContent).toBe(`“${long}”`);
      expect(host.querySelector('.rl-aar__cite')?.textContent).toBe('CPT. HAMMAI');
      expect(host.querySelector<HTMLImageElement>('.rl-enddebrief__face-img')?.hidden).toBe(false);
    });

    it('paints the brigade mark, not a face, for the net', () => {
      const host = mount(opts({ speaker: { plate: 'NET', text: 'Twelve minutes out.', speaker: 'net' } }));
      expect(host.querySelector('.rl-enddebrief__face')?.classList.contains('rl-enddebrief__face--net')).toBe(true);
      expect(host.querySelector<HTMLImageElement>('.rl-enddebrief__face-img')?.hidden).toBe(true);
    });

    it('shows nothing when the outcome has no line and no aftermath', () => {
      expect(mount(opts()).querySelector('.rl-aar__word')).toBeNull();
    });

    // From the value the moment is handed (`outcomeMomentOptions` over the
    // locale-applied mission), victory only; text, never markup.
    it('carries a won finale’s aftermath, and a lost one’s not', () => {
      const raw = (missions as Record<string, MissionJson | undefined>).wadi_halam_5_depot;
      if (raw === undefined) throw new Error('fixture: wadi_halam_5_depot is gone');
      const mission = applyMissionLocale(raw, null);
      expect(mission.aftermath, 'premise: the finale authors an aftermath').toMatch(/^The corridor is cut\./);
      const won = mount(opts({ aftermath: outcomeMomentOptions('victory', mission).aftermath }));
      expect(won.querySelector('.rl-aar__aftermath')?.textContent).toBe(mission.aftermath);
      document.body.innerHTML = '';
      const lost = mount(opts({ result: 'defeat', aftermath: outcomeMomentOptions('defeat', mission).aftermath }));
      expect(lost.querySelector('.rl-aar__aftermath')).toBeNull();
      document.body.innerHTML = '';
      const tagged = mount(opts({ aftermath: 'The corridor is <b>cut</b>.' }));
      expect(tagged.querySelector('.rl-aar__aftermath b')).toBeNull();
    });
  });
});
