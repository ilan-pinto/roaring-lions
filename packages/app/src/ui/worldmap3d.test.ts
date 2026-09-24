// @vitest-environment jsdom
import type { LedgerData } from '@lions/sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worldJson from '../../../../data/campaign/world.json';
import countriesJson from '../../../../data/campaign/countries.json';
import { parseCountries, parseWorld } from '../campaign';
import { t } from '../i18n/t';
import { RENDERER_STORAGE_KEY } from '../renderer-choice';
import { showCampaign } from './menu';
import {
  campaignBoard,
  worldMap3d,
  type MountWorldView,
  type MountedView,
  type TownPin,
} from './worldmap3d';
import { webgl2Available } from './webgl-probe';

const world = parseWorld(worldJson);
const countries = parseCountries(countriesJson);
const HINT = t('world3d.hint');

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
  /** What this screen handed the renderer for the Draco decoder. Recorded
   *  because it once handed it nothing -- see the test at the bottom. */
  dracoDecoderPath: string | undefined;
  /** Mutable so a test can set what the cursor is "over" before calling
   *  `frame()` -- the real view's own `hovered` getter (Task 9), stood in
   *  as a plain field rather than an accessor because `MountedView` only
   *  cares about the read, and a test never needs to observe a write. */
  hovered: string | null;
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
      dracoDecoderPath: opts.dracoDecoderPath,
      nudges: [],
      resets: 0,
      disposed: 0,
      hovered: null,
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
  over: {
    webgl?: () => boolean;
    mount?: MountWorldView;
    world?: typeof world;
    missionOf?: (id: string) => { objectives: readonly { type: string; primary: boolean }[]; name?: string } | undefined;
  } = {}
): Screen => {
  const fake = fakeMount();
  const went: string[] = [];
  const { el, ready } = worldMap3d({
    world: over.world ?? world,
    ledger,
    href: (id) => `/mission/${id}`,
    meshUrl: '/art/sahar_basin.glb',
    dracoDecoderPath: '/draco/',
    fallback: () => {
      const f = document.createElement('div');
      f.className = 'rl-world__flatstub';
      return f;
    },
    mount: over.mount ?? fake.mount,
    webgl: over.webgl ?? (() => true),
    navigate: (href) => went.push(href),
    missionOf: over.missionOf,
  });
  document.body.appendChild(el);
  return { el, ready, view: fake.view, went };
};

/**
 * A real Storage API on `window`.
 *
 * This vitest jsdom configuration supplies `window.localStorage` as a bare
 * `{}` -- no `getItem`, no `setItem`, no `length`. Two things follow.
 * `showCampaign` must survive that (it does, see `readStoredRenderer` in
 * `renderer-choice.ts`), and a test that wants to steer the renderer choice has to
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
    // Sur and naharin used to share one gate (beit_sahwan_3_clearance), so
    // clearing it opened both at once. They now gate on different missions --
    // sur on deir_amun_3_subterranean (moved with the Marj's completion,
    // design.md C3 / O-KR1), naharin on umm_zeitoun_4_clearance, a mission
    // inside sur's own progression -- so meeting sur's gate alone no longer
    // opens naharin too.
    const s = mountScreen({ 'campaign.completed_missions': ['deir_amun_3_subterranean'] });
    await s.ready;
    expect(s.view().statuses.sur).toBe('live');
    expect([...s.view().clickable].sort()).toEqual(['marj', 'sur']);
  });
});

describe('clicking the ground', () => {
  it('launches the region’s next mission', async () => {
    const s = mountScreen({});
    await s.ready;
    s.view().pick('marj');
    expect(s.went).toEqual(['/mission/beit_sahwan_breach']);
  });

  it('says the region alone, never the mission id, when it has no mission catalogue', async () => {
    const s = mountScreen({});
    await s.ready;
    s.view().pick('marj');
    expect(say(s.el)).toBe('The Marj Strip');
    expect(say(s.el)).not.toContain('beit_sahwan_breach');
  });

  it('names the mission it is opening, once it has a catalogue to ask', async () => {
    const s = mountScreen(
      {},
      {
        missionOf: (id) =>
          id === 'beit_sahwan_breach' ? { objectives: [], name: 'Beit Sahwan — First Light' } : undefined,
      }
    );
    await s.ready;
    s.view().pick('marj');
    expect(say(s.el)).toBe('The Marj Strip — opening Beit Sahwan — First Light');
    expect(say(s.el)).not.toContain('beit_sahwan_breach');
  });

  it('launches the next UNFINISHED mission, not the first', async () => {
    const s = mountScreen({
      'campaign.completed_missions': ['beit_sahwan_breach', 'beit_sahwan_1_recon'],
    });
    await s.ready;
    s.view().pick('marj');
    expect(s.went).toEqual(['/mission/beit_sahwan_2_foothold']);
  });

  /**
   * The defect this screen could most easily have: the ground is ONE canvas,
   * so a click on locked ground that printed nothing would be
   * indistinguishable from a broken screen. It has to say why, and it must
   * not launch anything.
   */
  it('refuses a locked region and says a neutral sentence when it has no mission catalogue', async () => {
    const s = mountScreen({});
    await s.ready;
    s.view().pick('sur');
    expect(s.went).toEqual([]);
    expect(say(s.el)).toBe('Sur — Clear an earlier mission first');
    expect(tone(s.el)).toBe('bad');
  });

  it('names the gating mission rather than its id, once it has a catalogue to ask', async () => {
    const s = mountScreen(
      {},
      {
        missionOf: (id) =>
          id === 'deir_amun_3_subterranean' ? { objectives: [], name: 'Deir Amun III — All Four' } : undefined,
      }
    );
    await s.ready;
    s.view().pick('sur');
    expect(s.went).toEqual([]);
    expect(say(s.el)).toBe('Sur — Clear Deir Amun III — All Four first');
    expect(say(s.el)).not.toContain('deir_amun_3_subterranean');
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
    // naharin's own gate moved from beit_sahwan_3_clearance to
    // umm_zeitoun_4_clearance, so that is the mission that now has to be in
    // `done` to unlock it before checking it reads as cleared.
    const done = [
      'umm_zeitoun_4_clearance',
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
    expect(a.getAttribute('href')).toBe('/mission/beit_sahwan_1_recon');
    expect(a.textContent).toBe('Beit Sahwan 1/5');
  });

  it('shows the town’s stars beside its progress, as the flat board does', async () => {
    // The two boards are one screen with two renderers behind it, so a
    // motivation surface that reaches only one of them is a bug the player
    // meets by switching backends. `worldmap.test.ts` pins the same fact for
    // the flat board; this is its twin.
    const town = world.regions[0]!.towns[0]!;
    const s = mountScreen({
      'campaign.completed_missions': ['beit_sahwan_breach'],
      'campaign.mission_results': { [town.missions[0]!]: { stars: 2, roe: 90, ticks: 1, lost: 0 } },
    });
    await s.ready;
    const pin = s.el.querySelector('[data-town="beit_sahwan"]') as HTMLElement;
    expect(pin.textContent).toContain(`2/${town.missions.length * 3}★`);
  });

  it('gives a locked region’s town no link', async () => {
    const s = mountScreen({});
    await s.ready;
    const pin = s.el.querySelector('[data-town="tel_marum"]') as HTMLElement;
    expect(pin.querySelector('a')).toBe(null);
    expect(pin.dataset.status).toBe('locked');
  });

  it('marks a town with nothing authored empty, not the region status', async () => {
    // Every real town in world.json now carries missions -- Khan Rafid and
    // Deir Amun landed theirs -- so this needs a synthetic world with an
    // unauthored town standing in for the case.
    const worldWithEmptyTown = {
      ...world,
      regions: [
        { ...world.regions[0]!, towns: [...world.regions[0]!.towns, { id: 'empty_town', name: 'Empty Town', at: [500, 500] as [number, number], missions: [] }] },
        ...world.regions.slice(1),
      ],
    };
    const s = mountScreen({}, { world: worldWithEmptyTown });
    await s.ready;
    expect((s.el.querySelector('[data-town="empty_town"]') as HTMLElement).dataset.status).toBe(
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

/**
 * Task 9 -- R-8. The flat board has had `mouseenter`/`mouseleave`/
 * `focusin`/`focusout` toggling `data-hover` since Phase 1; the diorama's
 * pins had no pointer listener at all and `speak()` fired only on click. A
 * hover previews the sentence a click would say without doing what the
 * click does -- `point()` and, above all, `navigate()`: a hover that
 * navigated would make the board unusable.
 *
 * `tel_marum` is used throughout because it is already pinned locked with
 * no link ("gives a locked region's town no link", above) -- exactly the
 * pin whose hover preview is the most useful there is, and the one a real
 * Tab could never have reached before this task gave it `tabindex="0"`.
 */
describe('a hovered pin previews, and never navigates', () => {
  it('marks itself and previews the reason, without navigating', async () => {
    const s = mountScreen({});
    await s.ready;
    const pin = s.el.querySelector<HTMLElement>('[data-town="tel_marum"]');
    expect(pin?.querySelector('a')).toBe(null); // locked: no link to hover-test against
    pin?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(pin?.dataset.hover).toBe('1');
    expect(say(s.el)).toBe('Tel Marum — locked: Clear an earlier mission first');
    expect(tone(s.el)).toBe('bad');
    expect(s.went).toEqual([]);
    pin?.dispatchEvent(new MouseEvent('mouseleave'));
    expect(pin?.dataset.hover).toBeUndefined();
  });

  // Leaving a pin no longer restores the hint SYNCHRONOUSLY -- it takes the
  // next `onFrame` to. That's deliberate, not a regression: the view's own
  // `hovered` reads stale (still `null` from the moment the pin overlay
  // became topmost) at the exact instant `mouseleave` fires, so speaking it
  // synchronously would show a live region under the cursor as bare ground
  // for one frame every time a pin is left onto one. See `forceGroundSpeak`
  // in `worldmap3d.ts`. A real browser repaints every ~16ms, so the delay
  // this test now drives with an explicit `frame()` is not one a player
  // notices.
  it('leaving a pin puts the hint back on the next frame, rather than leaving the last preview up', async () => {
    const s = mountScreen({});
    await s.ready;
    const pin = s.el.querySelector<HTMLElement>('[data-town="tel_marum"]');
    pin?.dispatchEvent(new MouseEvent('mouseenter'));
    pin?.dispatchEvent(new MouseEvent('mouseleave'));
    s.view().frame([], 0); // the view's own hover has caught up by now: still null
    expect(say(s.el)).toBe(HINT);
  });

  // Keyboard parity, the rule Phase 4 depends on: no hover-only affordance.
  // Reachable for real now -- the locked pin's `<span>` carries
  // `tabindex="0"` precisely so a Tab lands here at all.
  it('focus previews exactly as hover does', async () => {
    const s = mountScreen({});
    await s.ready;
    const pin = s.el.querySelector<HTMLElement>('[data-town="tel_marum"]');
    const span = pin?.querySelector('span.rl-world__townname');
    expect(span?.getAttribute('tabindex')).toBe('0');
    pin?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(pin?.dataset.hover).toBe('1');
    expect(say(s.el)).toBe('Tel Marum — locked: Clear an earlier mission first');
    pin?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(pin?.dataset.hover).toBeUndefined();
    s.view().frame([], 0); // see the mouse version of this above
    expect(say(s.el)).toBe(HINT);
  });

  // A click's own sentence is a commitment and must survive a hover that
  // happened moments earlier -- and must not be re-said with the hover's
  // OWN wording ("opens"/"locked:") in place of the click's ("opening"/the
  // bare reason).
  it('a click still says the click sentence, not the preview', async () => {
    const s = mountScreen({});
    await s.ready;
    const pin = s.el.querySelector<HTMLElement>('[data-town="tel_marum"]');
    pin?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(say(s.el)).toBe('Tel Marum — locked: Clear an earlier mission first');
    s.view().pick('sur');
    expect(say(s.el)).toBe('Sur — Clear an earlier mission first');
    expect(say(s.el)).not.toContain('locked:');
  });
});

/**
 * The ground half of Task 9: the view's own `hovered` getter, read inside
 * `onFrame` -- the only place this screen learns what is under the cursor,
 * since the canvas has no per-region DOM node of its own.
 */
describe('the ground previews what a click there would say', () => {
  it('previews the region under the cursor as it turns', async () => {
    const s = mountScreen({});
    await s.ready;
    s.view().hovered = 'sur';
    s.view().frame([], 0);
    expect(say(s.el)).toBe('Sur — locked: Clear an earlier mission first');
    expect(tone(s.el)).toBe('bad');
  });

  // A click's own sentence must survive the very next frame, even though
  // `onFrame` runs every frame and the cursor is still over the same ground
  // it was before the click -- the debounce is what makes that true, not
  // luck. Without it this test is indistinguishable from the previous
  // describe block's "a click still says the click sentence" -- this one
  // exercises the GROUND path (`onFrame`/`hovered`), not the pin path.
  it('does not re-speak on a frame where the hovered region has not changed', async () => {
    const s = mountScreen({});
    await s.ready;
    s.view().hovered = 'sur';
    s.view().frame([], 0);
    s.view().pick('marj'); // a click's own sentence, region-level
    s.view().hovered = 'sur'; // unchanged from the last frame
    s.view().frame([], 1);
    // The click sentence with no mission catalogue is the region name alone.
    expect(say(s.el)).toBe('The Marj Strip');
  });

  it('leaving the ground entirely restores the hint', async () => {
    const s = mountScreen({});
    await s.ready;
    s.view().hovered = 'sur';
    s.view().frame([], 0);
    s.view().hovered = null;
    s.view().frame([], 0);
    expect(say(s.el)).toBe(HINT);
  });

  it('says so for ground the GLB carries and world.json does not', async () => {
    const s = mountScreen({});
    await s.ready;
    s.view().hovered = 'nowhere';
    s.view().frame([], 0);
    expect(say(s.el)).toBe('nowhere — no campaign here');
    expect(tone(s.el)).toBe('info');
  });
});

/**
 * The bug found driving a real mouse on 2026-09-24 (report Part 2): a
 * realistic multi-step move onto a pin crosses bare board first, so ground
 * hover has already spoken by the time the cursor reaches the pin.
 * `mouseenter` speaks the pin's own sentence -- but the DOM pin overlay is
 * now topmost, so the very next `onFrame` reads the view's own `hovered` as
 * `null`, and the ground-hover debounce used to treat that as a CHANGE
 * (`null !== 'sur'`, the region spoken a moment before) and re-speak the
 * hint over the pin's sentence, ~25ms after it appeared in a real browser.
 * Keyboard focus was unaffected because it never touches `onFrame` at all.
 */
describe('a pin owns the line while it is hovered, and ground hover must not clobber it', () => {
  it('keeps the pin sentence on the frame where the ground hover reads null', async () => {
    const s = mountScreen({});
    await s.ready;
    // Ground hover speaks first -- the cursor crossed bare board on the way
    // to the pin, exactly as a real mouse move does.
    s.view().hovered = 'sur';
    s.view().frame([], 0);
    expect(say(s.el)).toBe('Sur — locked: Clear an earlier mission first');

    const pin = s.el.querySelector<HTMLElement>('[data-town="tel_marum"]');
    pin?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(say(s.el)).toBe('Tel Marum — locked: Clear an earlier mission first');

    // The frame that used to clobber it: the DOM overlay is topmost now, so
    // the view's own hit test reports nothing under the cursor.
    s.view().hovered = null;
    s.view().frame([], 1);
    expect(say(s.el)).toBe('Tel Marum — locked: Clear an earlier mission first');
  });

  // The real ordering, not the convenient one: at the exact instant a pin's
  // `mouseleave` fires, the view's own `hovered` has NOT yet recomputed for
  // wherever the cursor actually lands next -- `world-view.ts`'s canvas
  // `pointerleave` zeroed it to `null` the moment the pin overlay became
  // topmost (entering the pin), and the canvas only gets a `pointermove` of
  // its own, recomputing it, on the frame AFTER this one. A synchronous
  // read of `hovered` right here (as `resumeGroundHover` did through
  // cdbfebb5) reads that stale `null` and speaks the generic hint
  // immediately -- wrong for one frame, even though the cursor is really
  // back over a live region the whole time.
  it('does not flash the hint before the frame that actually catches up, once the pin is left', async () => {
    const s = mountScreen({});
    await s.ready;
    s.view().hovered = 'sur';
    s.view().frame([], 0);
    const pin = s.el.querySelector<HTMLElement>('[data-town="tel_marum"]');
    pin?.dispatchEvent(new MouseEvent('mouseenter'));
    s.view().hovered = null;
    s.view().frame([], 1); // the frame that used to clobber it, from the test above

    // `mouseleave` fires with the mock's `hovered` still `null` -- the real
    // ordering. No frame has run yet.
    pin?.dispatchEvent(new MouseEvent('mouseleave'));
    expect(say(s.el)).not.toBe(HINT);
    expect(say(s.el)).toBe('Tel Marum — locked: Clear an earlier mission first');

    // The view's own hover catches up on the NEXT frame: the cursor is
    // really back over Sur, and only now does the line say so.
    s.view().hovered = 'sur';
    s.view().frame([], 2);
    expect(say(s.el)).toBe('Sur — locked: Clear an earlier mission first');
  });

  // Two different pins can own the line at once -- a mouse hovering one
  // while a different one keeps keyboard focus. Letting go of ONE must not
  // hand the line to the ground (the other still owns it) or leave the
  // departing pin's now-stale sentence up; it must show the REMAINING
  // owner's own sentence again.
  it('keeps the remaining owner’s sentence when only one of two simultaneous owners lets go', async () => {
    const s = mountScreen({});
    await s.ready;
    const a = s.el.querySelector<HTMLElement>('[data-town="beit_sahwan"]');
    const b = s.el.querySelector<HTMLElement>('[data-town="tel_marum"]');

    // B takes the line first, by keyboard focus.
    b?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(say(s.el)).toBe('Tel Marum — locked: Clear an earlier mission first');

    // A takes it over, by mouse -- both now own the line at the same time.
    // (No mission catalogue is supplied to this harness, so the fallback is
    // the town's own name, not a mission title -- see "says the region
    // alone" above for the same fallback on the click path.)
    a?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(say(s.el)).toBe('Beit Sahwan — opens Beit Sahwan');

    // A lets go. B still holds the line (it is still focused): the line
    // must return to B's own sentence, not stay on A's stale one.
    a?.dispatchEvent(new MouseEvent('mouseleave'));
    expect(say(s.el)).toBe('Tel Marum — locked: Clear an earlier mission first');
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
      expect(back.getAttribute('href'), choice).toBe('/');
      expect(stage.querySelector('[data-town="beit_sahwan"]'), choice).not.toBe(null);
    }
  });
});

/**
 * The regression this screen shipped with on 2026-09-08, and the one thing
 * about it that made it expensive: it failed SOFTLY.
 *
 * Every shipped GLB carries `KHR_draco_mesh_compression` since level load
 * time step 4, and a `GLTFLoader` with no `DRACOLoader` attached does not
 * degrade on one -- it throws. The decoder path was set in exactly one place,
 * `ThreeRenderer`'s constructor, and this board constructs no `ThreeRenderer`
 * at all. So `?campaign` fetched `sahar_basin.glb` (HTTP 200), threw
 * `No DRACOLoader instance provided`, and this screen's own fallback caught
 * it and drew the flat PNG board -- which is exactly what it is supposed to
 * do for a browser with no WebGL2, so the screen looked like it was working
 * as designed. The only evidence was one console warning.
 *
 * `World3dOptions.dracoDecoderPath` is REQUIRED rather than optional so the
 * compiler is the thing that catches the next caller; this pins that the
 * value actually reaches the renderer, which the type alone cannot.
 */
describe('the Draco decoder path', () => {
  it('is handed to the renderer, or the diorama cannot parse a compressed GLB', () => {
    const s = mountScreen({});
    return s.ready.then(() => {
      expect(s.view().dracoDecoderPath).toBe('/draco/');
    });
  });
});

/**
 * Leaving the campaign screen while the diorama is still downloading. Before
 * this, the view finished mounting into the detached board, made a WebGL
 * context and started its frame loop, and the disconnect observer -- attached
 * only AFTER the mount -- heard of the leave at the next body mutation, which
 * an idle menu may never make. Measured on the real screen: the context was
 * still alive 7 s after the leave and through a forced GC.
 */
describe('a board left before its view mounts holds no WebGL context', () => {
  const board = (over: { mount: MountWorldView; signal?: AbortSignal; webgl?: () => boolean }) => {
    const { el, ready } = worldMap3d({
      world,
      ledger: {},
      href: (id) => `/mission/${id}`,
      meshUrl: '/art/sahar_basin.glb',
      dracoDecoderPath: '/draco/',
      fallback: () => {
        const f = document.createElement('div');
        f.className = 'rl-world__flatstub';
        return f;
      },
      mount: over.mount,
      webgl: over.webgl ?? (() => true),
      navigate: () => {},
      signal: over.signal,
    });
    document.body.appendChild(el);
    return { el, ready };
  };

  it('disposes a view that finishes mounting after the board was left', async () => {
    const fake = fakeMount();
    let release = (): void => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const mount: MountWorldView = async (host, o) => {
      await gate;
      return fake.mount(host, o);
    };
    const { el, ready } = board({ mount });

    el.remove(); // the player leaves while the diorama downloads
    release();

    expect(await ready).toBe('diorama');
    expect(fake.view().disposed).toBe(1);
  });

  it('hands the screen signal to the view, which is what lets it make no context at all', async () => {
    let seen: AbortSignal | undefined;
    const fake = fakeMount();
    const mount: MountWorldView = (host, o) => {
      seen = o.signal;
      return fake.mount(host, o);
    };
    const leave = new AbortController();
    const { ready } = board({ mount, signal: leave.signal });
    await ready;
    expect(seen).toBe(leave.signal);
  });

  it('a view that gave up because the screen was left draws no flat board and warns nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const leave = new AbortController();
      const mount: MountWorldView = () => {
        leave.abort();
        return Promise.reject(new DOMException('left', 'AbortError'));
      };
      const { el, ready } = board({ mount, signal: leave.signal });

      expect(await ready).toBe('diorama');
      expect(el.querySelector('.rl-world__flatstub')).toBe(null);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  // The probe lives in `./webgl-probe` since the scene host began sharing it
  // (scene-host plan, Task 6), and this is still its guard: the module's own
  // function is asked directly, then the board is asked to run it -- so a
  // board that stopped using the shared probe fails here too.
  it('the WebGL2 probe gives its own context back', async () => {
    const loseContext = vi.fn();
    // `getContext` is overloaded per context type; the stand-in answers the
    // one call the probe makes, so it is typed as the method rather than as
    // any one overload.
    const fakeGl = { getExtension: () => ({ loseContext }) };
    const probe = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation((() => fakeGl) as unknown as HTMLCanvasElement['getContext']);
    try {
      expect(webgl2Available()).toBe(true);
      expect(loseContext).toHaveBeenCalledTimes(1);
      const fake = fakeMount();
      // No `webgl` override: the real probe runs.
      const { el, ready } = worldMap3d({
        world,
        ledger: {},
        href: (id) => `/mission/${id}`,
        meshUrl: '/art/sahar_basin.glb',
        dracoDecoderPath: '/draco/',
        fallback: () => document.createElement('div'),
        mount: fake.mount,
        navigate: () => {},
      });
      document.body.appendChild(el);
      expect(await ready).toBe('diorama');
      expect(loseContext).toHaveBeenCalledTimes(2);
    } finally {
      probe.mockRestore();
    }
  });
});
