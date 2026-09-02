// @vitest-environment jsdom
import type { LedgerData } from '@lions/sim';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import worldJson from '../../../../data/campaign/world.json';
import countriesJson from '../../../../data/campaign/countries.json';
import { parseCountries, parseWorld } from '../campaign';
import { RENDERER_STORAGE_KEY } from '../renderer-choice';
import { showCampaign } from './menu';
import {
  campaignBoard,
  worldMap3d,
  type MountWorldView,
  type MountedView,
  type TownPin,
} from './worldmap3d';

const world = parseWorld(worldJson);
const countries = parseCountries(countriesJson);

/** A stand-in for the real three.js view. Captures what the screen handed it
 *  and lets a test drive `onPick`/`onFrame` the way a pointer would. */
interface FakeView extends MountedView {
  pick: (regionId: string | null) => void;
  frame: (towns: readonly TownPin[], bearing: number) => void;
  statuses: Record<string, string>;
  clickable: ReadonlySet<string>;
  meshUrl: string;
  nudges: number[];
  resets: number;
  disposed: number;
}

const fakeMount = (): { mount: MountWorldView; view: () => FakeView } => {
  let made: FakeView | null = null;
  const mount: MountWorldView = (_host, opts) => {
    const v: FakeView = {
      pick: opts.onPick,
      frame: opts.onFrame,
      statuses: { ...opts.statuses },
      clickable: opts.clickable,
      meshUrl: opts.meshUrl,
      nudges: [],
      resets: 0,
      disposed: 0,
      nudge: (d) => v.nudges.push(d),
      reset: () => {
        v.resets++;
      },
      dispose: () => {
        v.disposed++;
      },
    };
    made = v;
    return Promise.resolve(v);
  };
  return {
    mount,
    view: () => {
      if (!made) throw new Error('mount was never called');
      return made;
    },
  };
};

interface Screen {
  el: HTMLElement;
  ready: Promise<'diorama' | 'flat'>;
  view: () => FakeView;
  went: string[];
}

const mountScreen = (
  ledger: LedgerData,
  over: { webgl?: () => boolean; mount?: MountWorldView } = {}
): Screen => {
  const fake = fakeMount();
  const went: string[] = [];
  const { el, ready } = worldMap3d({
    world,
    ledger,
    href: (id) => `?mission=${id}`,
    meshUrl: '/art/sahar_basin.glb',
    fallback: () => {
      const f = document.createElement('div');
      f.className = 'rl-world__flatstub';
      return f;
    },
    mount: over.mount ?? fake.mount,
    webgl: over.webgl ?? (() => true),
    navigate: (href) => went.push(href),
  });
  document.body.appendChild(el);
  return { el, ready, view: fake.view, went };
};

/**
 * A real Storage API on `window`.
 *
 * This vitest jsdom configuration supplies `window.localStorage` as a bare
 * `{}` -- no `getItem`, no `setItem`, no `length`. Two things follow.
 * `showCampaign` must survive that (it does, see `storedRenderer` in
 * `menu.ts`), and a test that wants to steer the renderer choice has to
 * provide storage itself. Map-backed rather than a spy: the shape a browser
 * really hands over, so nothing here passes against an API the app could
 * never meet.
 */
const installStorage = (): void => {
  const box = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => box.get(k) ?? null,
      setItem: (k: string, v: string) => void box.set(k, v),
      removeItem: (k: string) => void box.delete(k),
      clear: () => box.clear(),
      get length() {
        return box.size;
      },
    },
  });
};

const say = (el: HTMLElement): string => el.querySelector('.rl-world__say')?.textContent ?? '';
const tone = (el: HTMLElement): string =>
  (el.querySelector('.rl-world__say') as HTMLElement | null)?.dataset.tone ?? '';

beforeEach(installStorage);
afterEach(() => {
  document.body.innerHTML = '';
});

describe('campaignBoard', () => {
  // The whole reason the flat board stays. A Pixi player who got 'diorama'
  // here gets a blank rectangle: that backend has no mesh path at all.
  it('gives a Pixi player the flat board', () => {
    expect(campaignBoard('pixi')).toBe('flat');
  });
  it('gives a three player the diorama', () => {
    expect(campaignBoard('three')).toBe('diorama');
  });
});

describe('the 3D board reads the ledger the same way the flat one does', () => {
  it('hands the view every region status', async () => {
    const s = mountScreen({});
    await s.ready;
    expect(s.view().statuses).toEqual({ marj: 'live', sur: 'locked', naharin: 'locked' });
  });

  it('makes only a region with something to play clickable', async () => {
    const s = mountScreen({});
    await s.ready;
    expect([...s.view().clickable]).toEqual(['marj']);
  });

  it('opens the next region once its gate is met', async () => {
    const s = mountScreen({ 'campaign.completed_missions': ['beit_sahwan_3_clearance'] });
    await s.ready;
    expect(s.view().statuses.sur).toBe('live');
    expect([...s.view().clickable].sort()).toEqual(['marj', 'naharin', 'sur']);
  });
});

describe('clicking the ground', () => {
  it('launches the region’s next mission', async () => {
    const s = mountScreen({});
    await s.ready;
    s.view().pick('marj');
    expect(s.went).toEqual(['?mission=beit_sahwan_breach']);
  });

  it('launches the next UNFINISHED mission, not the first', async () => {
    const s = mountScreen({
      'campaign.completed_missions': ['beit_sahwan_breach', 'beit_sahwan_1_recon'],
    });
    await s.ready;
    s.view().pick('marj');
    expect(s.went).toEqual(['?mission=beit_sahwan_2_foothold']);
  });

  /**
   * The defect this screen could most easily have: the ground is ONE canvas,
   * so a click on locked ground that printed nothing would be
   * indistinguishable from a broken screen. It has to say why, and it must
   * not launch anything.
   */
  it('refuses a locked region and says which mission opens it', async () => {
    const s = mountScreen({});
    await s.ready;
    s.view().pick('sur');
    expect(s.went).toEqual([]);
    expect(say(s.el)).toBe('Sur — requires clearing beit_sahwan_3_clearance');
    expect(tone(s.el)).toBe('bad');
  });

  it('points at the locked region’s own card, so the eye follows the sentence', async () => {
    const s = mountScreen({});
    await s.ready;
    s.view().pick('sur');
    const carded = [...s.el.querySelectorAll('[data-said="1"]')].map(
      (n) => (n as HTMLElement).dataset.regionCard
    );
    expect(carded).toEqual(['sur']);
  });

  it('says so for a region with nothing authored, rather than doing nothing', async () => {
    // `naharin` unlocked but with every mission done is the reachable shape
    // of "unlocked, nothing left"; `empty` needs a region with no missions at
    // all, which world.json does not have -- so this covers `complete`.
    const done = [
      'beit_sahwan_3_clearance',
      ...world.regions[2]!.towns.flatMap((t) => t.missions),
    ];
    const s = mountScreen({ 'campaign.completed_missions': done });
    await s.ready;
    s.view().pick('naharin');
    expect(s.went).toEqual([]);
    expect(say(s.el)).toBe('Naharin — cleared');
  });

  it('falls back to the hint when the click misses every region', async () => {
    const s = mountScreen({});
    await s.ready;
    s.view().pick('sur');
    s.view().pick(null);
    expect(say(s.el)).toMatch(/Drag the board to turn it/);
    expect(s.el.querySelectorAll('[data-said="1"]')).toHaveLength(0);
  });
});

describe('the town pins', () => {
  it('places one per town, from the projection the view reports', async () => {
    const s = mountScreen({});
    await s.ready;
    const towns = world.regions.flatMap((r) => r.towns);
    expect(s.el.querySelectorAll('[data-town]')).toHaveLength(towns.length);
    const before = s.el.querySelector('[data-town="tel_marum"]') as HTMLElement;
    expect(before.dataset.placed).toBe('0');

    s.view().frame([{ id: 'tel_marum', x: 321.4, y: 88.6 }], 47.3);
    expect(before.dataset.placed).toBe('1');
    expect(before.style.left).toBe('321.4px');
    expect(before.style.top).toBe('88.6px');
    expect((s.el.querySelector('.rl-world__bearing') as HTMLElement).textContent).toBe('047°');
  });

  it('links a playable town and labels its progress', async () => {
    const s = mountScreen({ 'campaign.completed_missions': ['beit_sahwan_breach'] });
    await s.ready;
    const pin = s.el.querySelector('[data-town="beit_sahwan"]') as HTMLElement;
    const a = pin.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('?mission=beit_sahwan_1_recon');
    expect(a.textContent).toBe('Beit Sahwan 1/5');
  });

  it('gives a locked region’s town no link', async () => {
    const s = mountScreen({});
    await s.ready;
    const pin = s.el.querySelector('[data-town="tel_marum"]') as HTMLElement;
    expect(pin.querySelector('a')).toBe(null);
    expect(pin.dataset.status).toBe('locked');
  });

  it('marks a town with nothing authored empty, not the region status', async () => {
    const s = mountScreen({});
    await s.ready;
    expect((s.el.querySelector('[data-town="khan_rafid"]') as HTMLElement).dataset.status).toBe(
      'empty'
    );
  });

  it('marks a finished town done', async () => {
    const s = mountScreen({
      'campaign.completed_missions': [...world.regions[0]!.towns[0]!.missions],
    });
    await s.ready;
    expect((s.el.querySelector('[data-town="beit_sahwan"]') as HTMLElement).dataset.status).toBe(
      'done'
    );
  });
});

describe('the rotate controls', () => {
  it('turn the board both ways and face north again', async () => {
    const s = mountScreen({});
    await s.ready;
    (s.el.querySelector('[data-spin="ccw"]') as HTMLElement).click();
    (s.el.querySelector('[data-spin="cw"]') as HTMLElement).click();
    (s.el.querySelector('[data-spin="north"]') as HTMLElement).click();
    expect(s.view().nudges).toEqual([-30, 30]);
    expect(s.view().resets).toBe(1);
  });
});

describe('nobody gets a blank screen', () => {
  it('falls back to the flat board where there is no WebGL2', async () => {
    const s = mountScreen({}, { webgl: () => false });
    expect(await s.ready).toBe('flat');
    expect(s.el.dataset.board).toBe('flat');
    expect(s.el.querySelector('.rl-world__flatstub')).not.toBe(null);
    expect(s.el.querySelector('.rl-world__stage')).toBe(null);
  });

  it('falls back when the world mesh cannot be drawn', async () => {
    const s = mountScreen({}, { mount: () => Promise.reject(new Error('GLTFLoader: 404')) });
    expect(await s.ready).toBe('flat');
    expect(s.el.querySelector('.rl-world__flatstub')).not.toBe(null);
  });

  it('takes the hint line down with the board it belonged to', async () => {
    // The sentence is the canvas's only voice. Left standing over a flat
    // board it tells a player to drag something that does not turn.
    const s = mountScreen({}, { webgl: () => false });
    await s.ready;
    expect(s.el.querySelector('.rl-world__say')).toBe(null);
  });

  it('keeps the cards and the ledger line either way', async () => {
    const flat = mountScreen({}, { webgl: () => false });
    await flat.ready;
    expect(flat.el.querySelectorAll('[data-region-card]')).toHaveLength(world.regions.length);
    expect(flat.el.querySelector('.rl-world__ledger')).not.toBe(null);
  });
});

describe('showCampaign picks the board from the renderer the player chose', () => {
  const mount = (): HTMLElement => {
    const stage = document.createElement('div');
    showCampaign(stage, { base: '/', world, countries, ledger: {} });
    document.body.appendChild(stage);
    return stage;
  };

  it('draws the flat board on Pixi', () => {
    window.localStorage.setItem(RENDERER_STORAGE_KEY, 'pixi');
    const stage = mount();
    expect(stage.querySelector('.rl-world--3d')).toBe(null);
    expect(stage.querySelector('.rl-world__board')).not.toBe(null);
  });

  it('draws the diorama on three', () => {
    window.localStorage.setItem(RENDERER_STORAGE_KEY, 'three');
    const stage = mount();
    expect(stage.querySelector('.rl-world--3d')).not.toBe(null);
  });

  it('keeps the way back to the menu on both', () => {
    for (const choice of ['pixi', 'three'] as const) {
      window.localStorage.setItem(RENDERER_STORAGE_KEY, choice);
      const stage = mount();
      const back = stage.querySelector('[data-kind="back"]') as HTMLAnchorElement;
      expect(back.getAttribute('href'), choice).toBe('?');
      expect(stage.querySelector('[data-town="beit_sahwan"]'), choice).not.toBe(null);
    }
  });
});
