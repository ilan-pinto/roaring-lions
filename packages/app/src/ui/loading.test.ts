// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { missions } from '@lions/data';
import type { LedgerRosterEntry } from '@lions/sim';
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';
import { setCatalogue } from '../i18n/t';
import { deployRosterView, type DeployRosterView } from './deploy-roster';
import type { DeploySelection } from './deploy-select';
import { briefingBeats, briefingHoldsDeployment, broughtFor, showLoading, type BroughtPanel } from './loading';
import type { PreviewMap, PreviewTones } from './map-preview';
import type { ObjectiveRow } from './objectives';

// Whether the deploying screen waits for the player is the whole of #82, and it
// is decidable without a DOM: a screen that tears itself down the instant the
// art gate settles is why ten missions' worth of briefings were never read.
//
// The blank cases are the trap. `undefined` and `""` are both falsy and both
// mean "nothing to read", but a briefing of spaces is truthy and means the same
// thing -- and holding the game on an empty box would read as a hang.
describe('briefingHoldsDeployment', () => {
  it('waits when there is something to read', () => {
    expect(briefingHoldsDeployment('Seven structures inside the walled depot.')).toBe(true);
  });

  it('does not wait when the mission declares no briefing', () => {
    expect(briefingHoldsDeployment(undefined)).toBe(false);
  });

  it('does not wait on an empty briefing', () => {
    expect(briefingHoldsDeployment('')).toBe(false);
  });

  it('does not wait on a briefing that is only whitespace', () => {
    expect(briefingHoldsDeployment('   \n  ')).toBe(false);
  });
});

// The wiring, in a DOM. worldmap.test.ts's precedent: this UI is provable
// without a browser, and the browser was not available when this was written.
describe('showLoading with a briefing video', () => {
  it('mounts the cinematic above the beats, with controls and an inline hint, and keeps Deploy', () => {
    const host = document.createElement('div');
    showLoading(host, 'Tel Marum II', 'Orders. More orders.', undefined, '/video/tel_marum_2_briefing.mp4');
    const video = host.querySelector<HTMLVideoElement>('video.rl-loading__video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('/video/tel_marum_2_briefing.mp4');
    expect(video?.controls).toBe(true);
    expect(host.querySelector('.rl-loading__box--video')).not.toBeNull();
    const box = host.querySelector('.rl-loading__box') as HTMLElement;
    const order = [...box.children].map((c) => c.className.split(' ')[0]);
    expect(order.indexOf('rl-loading__video')).toBeLessThan(order.indexOf('rl-loading__brief'));
    expect(host.querySelector('.rl-loading__deploy')).not.toBeNull();
  });

  it('mounts nothing when the mission declares no video', () => {
    const host = document.createElement('div');
    showLoading(host, 'Beit Sahwan I', 'Orders.');
    expect(host.querySelector('video')).toBeNull();
    expect(host.querySelector('.rl-loading__box--video')).toBeNull();
  });

  it('still offers Deploy for a cinematic with no orders at all', () => {
    const host = document.createElement('div');
    showLoading(host, 'Sandbox', undefined, undefined, '/video/x.mp4');
    expect(host.querySelector('video')).not.toBeNull();
    expect(host.querySelector('.rl-loading__deploy')).not.toBeNull();
  });
});

describe('showLoading with orders to read', () => {
  const host = (): HTMLElement => document.createElement('div');

  it('puts the briefing on the screen', () => {
    const el = host();
    showLoading(el, 'Break the Depot', 'Seven structures inside the walled depot.');
    expect(el.textContent).toContain('Seven structures inside the walled depot.');
  });

  it('offers a deploy control, because the player decides when they have read it', () => {
    const el = host();
    showLoading(el, 'Break the Depot', 'Seven structures inside the walled depot.');
    expect(el.querySelector('.rl-loading__deploy')).not.toBeNull();
  });

  it('holds the field until the player deploys', async () => {
    const el = host();
    const screen = showLoading(el, 'Break the Depot', 'Seven structures.');
    let handed = false;
    const done = screen.done().then(() => {
      handed = true;
    });
    // A tick of the microtask queue: an unguarded promise would have resolved.
    await Promise.resolve();
    expect(handed).toBe(false);
    expect(el.querySelector('.rl-loading')).not.toBeNull();

    el.querySelector<HTMLButtonElement>('.rl-loading__deploy')?.click();
    await done;
    expect(handed).toBe(true);
    expect(el.querySelector('.rl-loading')).toBeNull();
  });

  it('hands over at once when there are no orders, so a sandbox is not gated', async () => {
    const el = host();
    const screen = showLoading(el, 'M0 sandbox');
    await screen.done();
    expect(el.querySelector('.rl-loading')).toBeNull();
  });

  it('shows the same rank and plate the in-mission commander bar does, once there are orders to read', () => {
    const el = host();
    showLoading(el, 'Break the Depot', 'Seven structures inside the walled depot.', {
      rank: 'Captain',
      plate: 'Hammai',
    });
    expect(el.textContent).toContain('Captain');
    expect(el.textContent).toContain('Hammai');
  });

  it('shows no commander line for a sandbox, which has no briefing to attribute', () => {
    const el = host();
    showLoading(el, 'M0 sandbox', undefined, { rank: 'Captain', plate: 'Hammai' });
    expect(el.textContent).not.toContain('Hammai');
  });

  it('shows the commander portrait beside the rank/plate line when one resolves', () => {
    const el = host();
    showLoading(el, 'Break the Depot', 'Seven structures inside the walled depot.', {
      rank: 'Captain',
      plate: 'Hammai',
      portrait: '/ui/portraits/shai_hammai.png',
    });
    const img = el.querySelector<HTMLImageElement>('.rl-loading__face-img')!;
    expect(img.hidden).toBe(false);
    expect(img.src).toContain('shai_hammai.png');
  });

  it('falls back to the hatch -- no image -- when the commander has no portrait', () => {
    const el = host();
    showLoading(el, 'Break the Depot', 'Seven structures inside the walled depot.', {
      rank: 'Captain',
      plate: 'Hammai',
    });
    expect(el.querySelector<HTMLImageElement>('.rl-loading__face-img')!.hidden).toBe(true);
  });

  it('falls back to the hatch when a resolved portrait URL fails to load', () => {
    const el = host();
    showLoading(el, 'Break the Depot', 'Seven structures inside the walled depot.', {
      rank: 'Captain',
      plate: 'Hammai',
      portrait: '/ui/portraits/shai_hammai.png',
    });
    const img = el.querySelector<HTMLImageElement>('.rl-loading__face-img')!;
    expect(img.hidden).toBe(false);
    img.dispatchEvent(new Event('error'));
    expect(img.hidden).toBe(true);
    expect(img.getAttribute('src')).toBeNull();
  });
});

// A briefing long enough to scroll is a briefing the player scrolls, and the
// keys they scroll with must not deploy them into the mission mid-sentence.
// Wadi Halam V's is 1,225 characters; this is not hypothetical.
describe('reading a long briefing', () => {
  it('does not deploy when the player presses a key to scroll', async () => {
    const el = document.createElement('div');
    const screen = showLoading(el, 'Break the Depot', 'Seven structures. '.repeat(80));
    let handed = false;
    void screen.done().then(() => {
      handed = true;
    });
    for (const key of ['ArrowDown', 'PageDown', 'ArrowUp', 'Home', 'End']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    await Promise.resolve();
    expect(handed).toBe(false);
    expect(el.querySelector('.rl-loading')).not.toBeNull();
  });

  it('a click on the briefing text does not deploy', async () => {
    const el = document.createElement('div');
    const screen = showLoading(el, 'Break the Depot', 'Seven structures.');
    let handed = false;
    void screen.done().then(() => {
      handed = true;
    });
    el.querySelector('.rl-loading__brief')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    expect(handed).toBe(false);
    expect(el.querySelector('.rl-loading')).not.toBeNull();
  });

  it('goes back on Escape when the briefing has somewhere to go back to, and never deploys', async () => {
    const el = document.createElement('div');
    let backCalls = 0;
    const screen = showLoading(
      el,
      'Break the Depot',
      'Seven structures.',
      undefined,
      undefined,
      undefined,
      () => {
        backCalls++;
      }
    );
    let handed = false;
    void screen.done().then(() => {
      handed = true;
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // A macrotask, not just a microtask: this proves the promise is not merely
    // slow to settle, it is never going to -- the mission did not start.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(backCalls).toBe(1);
    expect(handed).toBe(false);
    expect(el.querySelector('.rl-loading')).toBeNull();
  });

  it('does nothing on Escape when there is nowhere to go back to (a sandbox)', async () => {
    const el = document.createElement('div');
    const screen = showLoading(el, 'Break the Depot', 'Seven structures.');
    let handed = false;
    void screen.done().then(() => {
      handed = true;
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handed).toBe(false);
    expect(el.querySelector('.rl-loading')).not.toBeNull();
  });

  it('renders a back link under Deploy only when onBack is supplied', () => {
    const withBack = document.createElement('div');
    showLoading(withBack, 'Break the Depot', 'Seven structures.', undefined, undefined, undefined, () => undefined);
    expect(withBack.querySelector('.rl-loading__back')).not.toBeNull();

    const withoutBack = document.createElement('div');
    showLoading(withoutBack, 'Break the Depot', 'Seven structures.');
    expect(withoutBack.querySelector('.rl-loading__back')).toBeNull();
  });

  // fix round 1: the back link used to call `onBack()` directly, skipping the
  // `cleanup()` Escape routes through -- the keydown listener, `wrap` and the
  // pending promise were all left dangling. Same shape as the Escape test
  // above: clicking back must tear the screen down the same way.
  it('clicking the back link goes through the same cleanup as Escape -- calls onBack, removes the wrap, and leaves the deploy promise pending', async () => {
    const el = document.createElement('div');
    let backCalls = 0;
    const screen = showLoading(
      el,
      'Break the Depot',
      'Seven structures.',
      undefined,
      undefined,
      undefined,
      () => {
        backCalls++;
      }
    );
    let handed = false;
    void screen.done().then(() => {
      handed = true;
    });
    el.querySelector<HTMLButtonElement>('.rl-loading__back')!.click();
    // A macrotask, not just a microtask -- proves the promise is not merely
    // slow to settle, it is never going to.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(backCalls).toBe(1);
    expect(handed).toBe(false);
    expect(el.querySelector('.rl-loading')).toBeNull();
  });
});

/**
 * Task 2 (fix round 1): tearing the screen down from OUTSIDE.
 *
 * `done()` parks on the player's click for as long as they care to read, and a
 * router navigation that supersedes a half-booted mission has to unpark it --
 * otherwise `bootBattlefield` hangs on that await forever, holding a renderer
 * and a WebGL context, and the disposer that would release them is a value it
 * has not returned yet. `dispose()` is the one lever that reaches in; these are
 * the four things it has to get right.
 */
describe('disposing the deploy screen from outside', () => {
  /** A briefing long enough to hold deployment, with a back edge, so both the
   *  pending promise and the keydown listener exist to be torn down. */
  function held(): { el: HTMLElement; screen: ReturnType<typeof showLoading>; backCalls: () => number } {
    const el = document.createElement('div');
    let calls = 0;
    const screen = showLoading(
      el,
      'Break the Depot',
      'Seven structures inside the walled depot.',
      undefined,
      undefined,
      undefined,
      () => {
        calls++;
      }
    );
    return { el, screen, backCalls: () => calls };
  }

  const isAbort = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError';

  it('rejects a pending done() with an AbortError, removes the wrap, and takes the keydown listener with it', async () => {
    const { el, screen, backCalls } = held();
    let rejected: unknown = null;
    let handed = false;
    const pending = screen
      .done()
      .then(() => {
        handed = true;
      })
      .catch((err: unknown) => {
        rejected = err;
      });

    expect(el.querySelector('.rl-loading')).not.toBeNull();
    screen.dispose();
    await pending;

    expect(handed).toBe(false);
    expect(isAbort(rejected)).toBe(true);
    expect(el.querySelector('.rl-loading')).toBeNull();

    // The listener went with it. Escape after a dispose must reach nothing:
    // `wrap` being gone is not evidence on its own, because `onKey` is
    // registered on `window` and would survive the element's removal.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(backCalls()).toBe(0);
  });

  it('is a no-op the second time', async () => {
    const { el, screen } = held();
    let rejections = 0;
    const pending = screen.done().catch(() => {
      rejections++;
    });
    screen.dispose();
    await pending;
    expect(rejections).toBe(1);
    // The battlefield disposer can run after the teardown that aborted it
    // (a stale mount resolving onto an aborted route), so this really happens.
    expect(() => {
      screen.dispose();
    }).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rejections).toBe(1);
    expect(el.querySelector('.rl-loading')).toBeNull();
  });

  it('rejects a done() called after the dispose, rather than putting a dead screen back', async () => {
    const { screen } = held();
    screen.dispose();
    let rejected: unknown = null;
    await screen.done().catch((err: unknown) => {
      rejected = err;
    });
    expect(isAbort(rejected)).toBe(true);
  });

  it('leaves the ordinary deploy path alone -- the click still resolves, and a later dispose does not reject it', async () => {
    const { el, screen } = held();
    let handed = false;
    let rejections = 0;
    const pending = screen
      .done()
      .then(() => {
        handed = true;
      })
      .catch(() => {
        rejections++;
      });
    el.querySelector<HTMLButtonElement>('.rl-loading__deploy')!.click();
    await pending;
    expect(handed).toBe(true);
    expect(rejections).toBe(0);

    // The ordinary battlefield teardown runs `loading.dispose()` minutes into
    // a mission the player deployed into. It must not reject a promise that
    // was already answered.
    screen.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rejections).toBe(0);
  });

  it('removes a screen that was never awaited at all', () => {
    // The mission was superseded while its sheets were still loading, so the
    // screen is up and no promise is outstanding.
    const { el, screen } = held();
    expect(el.querySelector('.rl-loading')).not.toBeNull();
    screen.dispose();
    expect(el.querySelector('.rl-loading')).toBeNull();
  });
});

// A brief is delivered a beat at a time, so the prose has to come apart into
// beats. Sentence boundaries are the natural seam, and the eleven authored
// briefings contain no decimals and no abbreviations to trip on — checked, not
// assumed — so a plain end-of-sentence split is safe here.
describe('briefingBeats', () => {
  it('keeps a short brief in one beat', () => {
    expect(briefingBeats('Hold the compound. Relief is four minutes out.')).toEqual([
      'Hold the compound. Relief is four minutes out.',
    ]);
  });

  it('breaks a longer brief into beats, keeping the punctuation', () => {
    expect(briefingBeats('One. Two. Three. Four.')).toEqual(['One. Two.', 'Three. Four.']);
  });

  it('gives a brief with no sentence end exactly one beat, not none', () => {
    expect(briefingBeats('no full stop anywhere in this line')).toEqual([
      'no full stop anywhere in this line',
    ]);
  });

  it('has no beats for nothing to say', () => {
    expect(briefingBeats('   ')).toEqual([]);
  });

  it('splits on a character budget, so two long sentences are not one wall', () => {
    const long = `${'a'.repeat(200)}. ${'b'.repeat(200)}.`;
    expect(briefingBeats(long)).toHaveLength(2);
  });

  it('never emits an empty beat', () => {
    for (const beat of briefingBeats('One.  Two.   Three.    Four. Five.')) {
      expect(beat.trim().length).toBeGreaterThan(0);
    }
  });
});

// GH-162: the deploy screen used to land the whole briefing as one paragraph
// in the plate-style body size. It now lays out one <p class="rl-loading__beat">
// per beat, fades them in on a stagger CSS reads off `--i` (the same
// per-child property `motion.ts`'s `stagger()` sets for the menu entrance),
// and fires a hook a future music cue can attach to. jsdom does not run CSS
// animations at all, so what is provable here is the DOM structure and the
// attributes the stylesheet keys on -- not the opacity a frame would show.
describe('deploy screen beat layout (GH-162)', () => {
  const firstLight = missions.beit_sahwan_breach;
  // `briefing` is optional on the JSON type (a sandbox mission has none); First
  // Light authors one, and the guard narrows it to `string` for every test
  // below without an assertion.
  const firstLightBriefing = firstLight.briefing;
  if (firstLightBriefing === undefined) {
    throw new Error('beit_sahwan_breach (First Light) has no briefing -- test fixture is stale');
  }

  it('renders one paragraph per beat for a shipped briefing', () => {
    const el = document.createElement('div');
    showLoading(el, firstLight.name, firstLightBriefing);
    const expected = briefingBeats(firstLightBriefing);
    expect(expected.length).toBe(8); // First Light's own count -- see the issue text.
    const rendered = [...el.querySelectorAll<HTMLParagraphElement>('.rl-loading__beat')];
    expect(rendered).toHaveLength(expected.length);
    expect(rendered.map((p) => p.textContent)).toEqual(expected);
  });

  it('stamps each beat with a 0-based index sequence, for the CSS stagger', () => {
    const el = document.createElement('div');
    showLoading(el, firstLight.name, firstLightBriefing);
    const rendered = [...el.querySelectorAll<HTMLParagraphElement>('.rl-loading__beat')];
    rendered.forEach((p, i) => {
      expect(p.dataset.index).toBe(String(i));
      expect(p.style.getPropertyValue('--i')).toBe(String(i));
    });
  });

  it('renders no beats at all when there is no briefing to hold deployment', () => {
    const el = document.createElement('div');
    showLoading(el, 'M0 sandbox');
    expect(el.querySelectorAll('.rl-loading__beat')).toHaveLength(0);
  });

  it('fires the music hook once, naming the mission, the moment the screen mounts (GH-133)', () => {
    const seen: CustomEvent[] = [];
    const onCue = (e: Event): void => {
      seen.push(e as CustomEvent);
    };
    document.addEventListener('rl:cue', onCue);
    try {
      const el = document.createElement('div');
      showLoading(el, firstLight.name, firstLightBriefing);
      expect(seen).toHaveLength(1);
      expect(seen[0].detail).toEqual({ cue: 'briefing', mission: firstLight.name });
    } finally {
      document.removeEventListener('rl:cue', onCue);
    }
  });

  it('offers an enabled deploy button immediately, before any beat animation could have finished', () => {
    const el = document.createElement('div');
    showLoading(el, firstLight.name, firstLightBriefing);
    // Deliberately not calling `.done()` first: that is where the click and key
    // listeners attach, and the button must already exist and be usable before
    // that -- nothing about the beat stagger may hold up the field being handed
    // over.
    const deploy = el.querySelector<HTMLButtonElement>('.rl-loading__deploy');
    expect(deploy).not.toBeNull();
    expect(deploy?.disabled).toBe(false);
  });
});
describe('what you brought', () => {
  // Six in the pool, five of them rifle squads, the first three named.
  // Deliberately larger than anything below fields: the roster is cumulative
  // (spec §4.7), so the pool and what a mission actually puts on the map are
  // different numbers, and this panel is about the second one.
  const ledger = {
    'roster.surviving_units': [
      { type: 'inf_squad', veterancy: 2, name: 'Sela' },
      { type: 'inf_squad', veterancy: 0, name: 'Barzel' },
      { type: 'inf_squad', veterancy: 3, name: 'Tzur' },
      { type: 'inf_squad', veterancy: 0 },
      { type: 'inf_squad', veterancy: 1 },
      { type: 'mbt_lavi', veterancy: 1 },
    ],
    'intel.marked_positions': ['bs_hvt_atgm', 'bs_track_north'],
    'roe.mission_ratings': { a: 80 },
  };
  const name = (id: string): string => (id === 'inf_squad' ? 'Rifle Squad' : 'Lavi');
  const requires = ['roster.surviving_units', 'intel.marked_positions'];

  it('is nothing for a mission that requires nothing', () => {
    expect(broughtFor({ ledger: { requires: [] } }, ledger, name)).toBeNull();
  });

  it('names only what this mission fields, and counts the rest as reserve', () => {
    // The draw rule is the sim's own (`spawnPlacement`): each `from_ledger`
    // placement takes up to `count` entries of its type in pool order, each
    // entry drawn once. Two of five squads come; the tank is not asked for.
    const b = broughtFor(
      {
        ledger: { requires },
        starting_force: [
          { unit: 'inf_squad', count: 2, from_ledger: true },
          { unit: 'apc_eitan', count: 1 },
        ],
      },
      ledger,
      name
    )!;
    expect(b.roster).toEqual([{ type: 'Rifle Squad', count: 2, stripes: 2, names: ['Sela', 'Barzel'] }]);
    // Tzur's three stripes are in the pool, not on the map, so the group's best
    // stripe is Sela's two -- the whole point of scoping to the draw.
    expect(b.reserve).toBe(4);
    expect(b.marked).toBe(2);
    expect(b.conduct).toBe(80);
    // The catalogue's `loading.marked` spells the count with `#` (digits), not a
    // word numeral -- the seam's plural form replaced `num()`'s spelled-out "Two".
    expect(b.sentences).toContain('2 positions your recon marked are on your map before a shot is fired.');
  });

  it('draws across placements in order, each entry once', () => {
    const b = broughtFor(
      {
        ledger: { requires },
        starting_force: [
          { unit: 'mbt_lavi', count: 1, from_ledger: true },
          { unit: 'inf_squad', count: 3, from_ledger: true },
        ],
      },
      ledger,
      name
    )!;
    expect(b.roster).toEqual([
      { type: 'Lavi', count: 1, stripes: 1, names: [] },
      { type: 'Rifle Squad', count: 3, stripes: 3, names: ['Sela', 'Barzel', 'Tzur'] },
    ]);
    expect(b.reserve).toBe(2);
  });

  // Pins that the draw now going through `drawFromPool` (deploy-roster.ts)
  // still takes the FIRST matching entry in pool order, not some other one --
  // the case a wrong index mapping (e.g. searching from the end) would break.
  // Barzel sits before Sela in the pool, so a correct draw fields Barzel;
  // fielding Sela here would mean the shared replay stopped agreeing with
  // `spawnPlacement`'s own order.
  it('fields the first matching entry in pool order when two of a type exist', () => {
    const twoOfAType = {
      'roster.surviving_units': [
        { type: 'inf_squad', veterancy: 0, name: 'Barzel' },
        { type: 'inf_squad', veterancy: 2, name: 'Sela' },
      ],
    };
    const b = broughtFor(
      { ledger: { requires }, starting_force: [{ unit: 'inf_squad', count: 1, from_ledger: true }] },
      twoOfAType,
      name
    )!;
    expect(b.roster).toEqual([{ type: 'Rifle Squad', count: 1, stripes: 0, names: ['Barzel'] }]);
    expect(b.reserve).toBe(1);
  });

  it('asks for more than the pool holds and fields what there is', () => {
    const b = broughtFor(
      { ledger: { requires }, starting_force: [{ unit: 'mbt_lavi', count: 3, from_ledger: true }] },
      ledger,
      name
    )!;
    expect(b.roster).toEqual([{ type: 'Lavi', count: 1, stripes: 1, names: [] }]);
    expect(b.reserve).toBe(5);
    expect(b.sentences).not.toContain(
      'No survivors carried forward. The brigade fields a fresh remnant for each slot.'
    );
  });

  it('fields nothing from the ledger when no placement draws, and does not call that an empty pool', () => {
    const b = broughtFor({ ledger: { requires }, starting_force: [{ unit: 'apc_eitan', count: 1 }] }, ledger, name)!;
    expect(b.roster).toEqual([]);
    expect(b.reserve).toBe(6);
    expect(b.sentences).not.toContain(
      'No survivors carried forward. The brigade fields a fresh remnant for each slot.'
    );
  });

  it('says so when a placement draws and the pool has nobody of that type', () => {
    const b = broughtFor(
      { ledger: { requires }, starting_force: [{ unit: 'inf_squad', count: 2, from_ledger: true }] },
      {},
      name
    )!;
    expect(b.roster).toEqual([]);
    expect(b.reserve).toBe(0);
    expect(b.sentences).toContain('No survivors carried forward. The brigade fields a fresh remnant for each slot.');
  });

  it('says so when the ledger is thin', () => {
    const b = broughtFor({ ledger: { requires } }, {}, name)!;
    expect(b.roster).toEqual([]);
    expect(b.sentences).toContain('Nothing marked. Whatever is out there, you find under fire.');
  });

  it('scopes a shipped mission to its own from_ledger placements', () => {
    // Beit Sahwan III draws a Lavi, two Namers, three squads, an AT team and a
    // mortar team; the Eitan, the drone and the demo squad are fresh. Against a
    // pool of five squads and one Lavi it fields four bodies and keeps two.
    const b = broughtFor(missions.beit_sahwan_3_clearance, ledger, name)!;
    expect(b.roster).toEqual([
      { type: 'Lavi', count: 1, stripes: 1, names: [] },
      { type: 'Rifle Squad', count: 3, stripes: 3, names: ['Sela', 'Barzel', 'Tzur'] },
    ]);
    expect(b.reserve).toBe(2);
  });

  it('renders beside the orders without becoming a beat', () => {
    const host = document.createElement('div');
    showLoading(host, 'X', 'Orders. More orders.', undefined, undefined, {
      roster: [{ type: 'Rifle Squad', count: 2, stripes: 2, names: ['Sela', 'Barzel'] }],
      reserve: 4,
      marked: 2,
      conduct: 80,
      sentences: ['Two positions your recon marked are on your map before a shot is fired.'],
    });
    expect(host.querySelectorAll('.rl-loading__beat').length).toBe(1);
    expect(host.querySelector('.rl-loading__brought')?.textContent).toContain('Rifle Squad ×2 ★★ (Sela, Barzel)');
    expect(host.querySelector('.rl-loading__brought')?.textContent).toContain('Conduct 80');
  });

  it('draws the reserve as its own line, and draws none when the pool is spent', () => {
    const panel = {
      roster: [{ type: 'Rifle Squad', count: 2, stripes: 0, names: [] }],
      marked: 0,
      conduct: null,
      sentences: [],
    };
    const withReserve = document.createElement('div');
    showLoading(withReserve, 'X', 'Orders. More orders.', undefined, undefined, { ...panel, reserve: 4 });
    expect(withReserve.querySelector('.rl-loading__reserve')?.textContent).toBe('4 in reserve');

    const spent = document.createElement('div');
    showLoading(spent, 'X', 'Orders. More orders.', undefined, undefined, { ...panel, reserve: 0 });
    expect(spent.querySelector('.rl-loading__reserve')).toBeNull();
  });

  it('gives the stripe the same commendation colour the card gives it', () => {
    // One stripe, one colour, wherever it is drawn -- the deploy panel and the
    // single-unit card are the two places a player sees it.
    const host = document.createElement('div');
    showLoading(host, 'X', 'Orders. More orders.', undefined, undefined, {
      roster: [
        { type: 'Rifle Squad', count: 2, stripes: 2, names: [] },
        { type: 'Lavi', count: 1, stripes: 0, names: [] },
      ],
      reserve: 0,
      marked: 0,
      conduct: null,
      sentences: [],
    });
    const stripes = host.querySelectorAll('.rl-loading__brought .rl-commend');
    expect(stripes).toHaveLength(1);
    expect(stripes[0].textContent).toBe('★★');
  });
});

// Task 5 (R-7: one component, three mounts): the same `objectivesPanel` the
// pause menu and the strip's `+N` will mount (task 6), shown once here on the
// screen the player reads before committing. A sibling of the beats, never a
// beat itself -- `describe('deploy screen beat layout (GH-162)')` above pins
// the beat count off the SAME briefing text, so this only has to prove the
// panel does not move that number.
describe('the objective panel on the briefing (task 5)', () => {
  const rows: ObjectiveRow[] = [
    { id: 'raze_the_stockpile', text: 'Raze the stockpile inside five minutes', primary: true, carries: false, status: 'active' },
    { id: 'kill_adhal', text: 'Kill Karim Adhal on the northern crest', primary: true, carries: false, status: 'active' },
    { id: 'kill_the_battery', text: 'Destroy the rocket battery north of the depot', primary: false, carries: false, status: 'active' },
    { id: 'get_the_porters_clear', text: 'Get three porters off the depot ground to the northern shelf', primary: false, carries: true, status: 'active' },
    { id: 'bring_the_relay_down', text: 'Bring the relay tower down', primary: false, carries: false, status: 'active' },
  ];
  const briefing = 'Orders. More orders.';

  it('shows all five declared objectives without changing the beat count', () => {
    const el = document.createElement('div');
    showLoading(el, 'Umm Zeitoun IV', briefing, undefined, undefined, undefined, undefined, rows, true);
    expect(el.querySelectorAll('.rl-obj')).toHaveLength(5);
    expect(el.querySelectorAll('.rl-loading__beat')).toHaveLength(briefingBeats(briefing).length);
  });

  it('shows no objectives for a sandbox, which declares none', () => {
    const el = document.createElement('div');
    showLoading(el, 'M0 sandbox');
    expect(el.querySelectorAll('.rl-obj')).toHaveLength(0);
  });

  it('is gated on holds exactly like the orders paragraph -- no objectives panel with nothing to brief', () => {
    const el = document.createElement('div');
    // A video-only screen with no briefing text: `holds` is false even though
    // `objectives` is supplied, and the panel must not appear anyway.
    showLoading(el, 'Cinematic only', undefined, undefined, '/video/x.mp4', undefined, undefined, rows, true);
    expect(el.querySelectorAll('.rl-obj')).toHaveLength(0);
  });
});

// --- the deploy spread (shell-upgrade Phase 3, Task 3) ----------------------
//
// Decision 4: "the briefing as a two-column spread -- portrait and orders
// left, the roster's force and a map preview right -- with the force chosen,
// not merely shown." The force is Task 1's `DeployRosterView`, built here
// through the REAL adapter from beit_sahwan_2_foothold's own draw shape (two
// ledger-drawn inf_squad, one ledger-drawn at_team, an Eitan that draws
// nothing) rather than written out by hand, so no fixture can describe a view
// the adapter would never produce. The choice itself is Task 2's selection
// API; this screen renders it and reports it, and decides nothing.

const SPREAD_POOL: LedgerRosterEntry[] = [
  { type: 'inf_squad', veterancy: 2, name: '1-1 Erez', missions: 4, kills: 7 },
  { type: 'inf_squad', veterancy: 0, missions: 1, kills: 0 },
  { type: 'inf_squad', veterancy: 3, name: '1-3 Nachshon', missions: 9, kills: 21 },
  { type: 'at_team', veterancy: 1, name: '2-1 Gachelet', missions: 3, kills: 5 },
  { type: 'recon_drone', veterancy: 0 },
];
const SPREAD_MISSION = {
  ledger: { requires: ['roster.surviving_units'] },
  starting_force: [
    { unit: 'apc_eitan', count: 1 },
    { unit: 'inf_squad', count: 2, from_ledger: true },
    { unit: 'at_team', count: 1, from_ledger: true },
  ],
};
const UNIT_NAMES: Readonly<Record<string, string>> = {
  inf_squad: 'Rifle Squad',
  at_team: 'AT Team',
  recon_drone: 'Recon Drone',
};
const unitName = (id: string): string => UNIT_NAMES[id] ?? id;

function viewOf(pool: LedgerRosterEntry[] = SPREAD_POOL): DeployRosterView {
  const v = deployRosterView(SPREAD_MISSION, { 'roster.surviving_units': pool }, unitName);
  if (v === null) throw new Error('fixture: this mission reads no roster');
  return v;
}

const SPREAD_BRIEFING = 'Take the foothold. Hold it until the column is through. Then push east.';

/** 3x2 of open ground -- what the preview draws is `map-preview.test.ts`'s
 *  business; here only whether and where it mounts. Tag-string tones. */
const PREVIEW: { map: PreviewMap; tones: PreviewTones } = {
  map: { width: 3, height: 2, blocked: new Uint8Array(6), boulder: new Uint8Array(6), cover: new Uint8Array(6) },
  tones: { open: 'open', blocked: 'blocked', rock: 'rock', cover: ['c1', 'c2', 'c3'] },
};

/** jsdom has no canvas backend, so `getContext` answers null and the preview
 *  degrades to nothing -- which would let every "no preview here" assertion
 *  below pass for the wrong reason. A test that asks about the preview
 *  installs this, the least context `paintMapTerrain` can paint into, and
 *  `afterEach` puts jsdom's own back. */
const realGetContext = HTMLCanvasElement.prototype.getContext;
/** jsdom's own answer -- no context -- without the "Not implemented" line it
 *  prints to stderr every time it gives it. */
function leaveCanvasWithoutAContext(): void {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
}
function giveCanvasAContext(): void {
  const ctx = { fillStyle: '', fillRect: (): void => undefined };
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
}

function spread(
  el: HTMLElement,
  onChange: (sel: DeploySelection) => void = () => undefined,
  over: { view?: DeployRosterView; brought?: BroughtPanel; onBack?: () => void } = {}
): ReturnType<typeof showLoading> {
  return showLoading(
    el,
    'Foothold',
    SPREAD_BRIEFING,
    undefined,
    undefined,
    over.brought,
    over.onBack ?? (() => undefined),
    [],
    false,
    { view: over.view ?? viewOf(), onChange },
    PREVIEW
  );
}

const rowsOf = (el: HTMLElement): HTMLButtonElement[] => [...el.querySelectorAll<HTMLButtonElement>('.rl-deploy__row')];

describe('the deploy spread (Task 3)', () => {
  beforeEach(leaveCanvasWithoutAContext);
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
    setCatalogue('en', en);
  });

  it('draws one selectable row per eligible body and marks the default force', () => {
    const el = document.createElement('div');
    const s = spread(el);
    const rows = rowsOf(el);
    expect(rows).toHaveLength(4);
    // Buttons, so the keyboard reaches every row with no code of its own.
    expect(rows.map((b) => `${b.tagName}:${b.type}`)).toEqual(rows.map(() => 'BUTTON:button'));
    expect(rows.map((b) => b.dataset.poolIndex)).toEqual(['0', '1', '2', '3']);
    // The default is the draw the mission makes with no screen at all: the
    // first two squads in pool order and the AT team. Nachshon, the third
    // squad, stays behind -- and the drone, which no placement draws, has no
    // row at all.
    expect(rows.map((b) => b.dataset.chosen)).toEqual(['1', '1', '0', '1']);
    expect(rows.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'false', 'true']);
    s.dispose();
  });

  it('names each body, then its type, its stripes and its record -- and a nameless one by its type alone', () => {
    const el = document.createElement('div');
    const s = spread(el);
    const [erez, anon] = rowsOf(el);
    expect(erez.querySelector('.rl-deploy__name')?.textContent).toBe('1-1 Erez');
    expect(erez.querySelector('.rl-deploy__type')?.textContent).toBe('Rifle Squad');
    expect(erez.querySelector('.rl-commend')?.textContent).toBe('★★');
    expect(erez.querySelector('.rl-deploy__record')?.textContent).toBe('4 missions · 7 kills');
    expect(anon.querySelector('.rl-deploy__name')?.textContent).toBe('Rifle Squad');
    expect(anon.querySelector('.rl-deploy__type')).toBeNull();
    // No stripe, no star element -- an empty `.rl-commend` would still be a
    // site for the symbol family's dingbat list to count.
    expect(anon.querySelector('.rl-commend')).toBeNull();
    expect(anon.querySelector('.rl-deploy__record')?.textContent).toBe('1 mission · 0 kills');
    s.dispose();
  });

  it('a click benches one and frees a slot, and the count says so', () => {
    const el = document.createElement('div');
    const seen: number[] = [];
    const s = spread(el, (sel) => seen.push(sel.chosen.size));
    expect(el.querySelector('.rl-deploy__slots')?.textContent).toBe('Force assigned');
    rowsOf(el)[0].click();
    expect(seen).toEqual([2]);
    expect(rowsOf(el)[0].dataset.chosen).toBe('0');
    expect(el.querySelector('.rl-deploy__slots')?.textContent).toBe('1 left to assign');
    s.dispose();
  });

  it('refuses a third body while its type is full, reports no change, and takes it once a slot opens', () => {
    const el = document.createElement('div');
    const seen: number[] = [];
    const s = spread(el, (sel) => seen.push(sel.chosen.size));
    const nachshon = rowsOf(el)[2];
    expect(nachshon.getAttribute('aria-disabled')).toBe('true');
    nachshon.click();
    expect(seen).toEqual([]);
    expect(nachshon.dataset.chosen).toBe('0');

    rowsOf(el)[0].click();
    expect(nachshon.hasAttribute('aria-disabled')).toBe(false);
    nachshon.click();
    expect(nachshon.dataset.chosen).toBe('1');
    expect(seen).toEqual([2, 3]);
    s.dispose();
  });

  // Final review, ruling 8. The whole screen used to be the live region
  // (`role=status`, `aria-live=polite`, on `.rl-loading`), and `status` is
  // atomic: every row toggle -- `aria-pressed`, the slot line, the reserve
  // line -- changed text inside it, so a screen reader re-read the region
  // on each click. The loading COUNT is the one thing on this screen that
  // changes without the player doing anything, so it is the only thing that
  // should announce. `politeness` is the nearest explicit `aria-live`, or an
  // implicit one from a live role, walking up from the node itself.
  it('announces the loading count and not the deploy rows', () => {
    const politeness = (node: Element | null): string => {
      for (let e = node; e !== null; e = e.parentElement) {
        const live = e.getAttribute('aria-live');
        if (live !== null) return live;
        const role = e.getAttribute('role');
        if (role === 'status' || role === 'log') return 'polite';
        if (role === 'alert') return 'assertive';
      }
      return 'off';
    };
    const el = document.createElement('div');
    const s = spread(el);
    const quiet = [...rowsOf(el), el.querySelector('.rl-deploy__slots'), el.querySelector('.rl-deploy__reserve')];
    expect(quiet).toHaveLength(6);
    for (const node of quiet) expect(politeness(node), node?.className).toBe('off');
    const count = el.querySelector('.rl-loading__count');
    expect(politeness(count)).toBe('polite');
    // ...and it still changes as the sheets land, which is what it announces.
    s.total(4);
    const before = count?.textContent;
    s.step();
    expect(count?.textContent).not.toBe(before);
    s.dispose();
  });

  it('Deploy is disabled while a slot is empty, and enabled again when it is filled', () => {
    const el = document.createElement('div');
    const s = spread(el);
    const deploy = el.querySelector<HTMLButtonElement>('.rl-loading__deploy');
    expect(deploy?.disabled).toBe(false);
    el.querySelector<HTMLElement>('.rl-deploy__row[data-chosen="1"]')?.click();
    expect(deploy?.disabled).toBe(true);
    el.querySelector<HTMLElement>('.rl-deploy__row[data-chosen="0"]')?.click();
    expect(deploy?.disabled).toBe(false);
    s.dispose();
  });

  it('does not hold Deploy hostage to a pool too thin to fill a slot, and the slot line agrees', () => {
    // One squad for a mission that asks for two: the spawner substitutes a
    // fresh remnant for the missing body (mission.ts:1264), so there is
    // nobody left to choose and nothing to wait for.
    const thin = viewOf([
      { type: 'inf_squad', veterancy: 1, name: 'Sela' },
      { type: 'at_team', veterancy: 0 },
    ]);
    const el = document.createElement('div');
    const s = spread(el, undefined, { view: thin });
    expect(el.querySelector<HTMLButtonElement>('.rl-loading__deploy')?.disabled).toBe(false);
    expect(el.querySelector('.rl-deploy__slots')?.textContent).toBe('Force assigned');
    s.dispose();
  });

  it('draws no spread when there is nobody to choose, and the brought panel keeps its own lines', () => {
    // The pool holds two drones and the mission draws squads and an AT team:
    // a "Confirm your force" over an empty list would be a question with no
    // answers, so the panel stays whole -- its reserve line included, and
    // still the only one.
    const drones: LedgerRosterEntry[] = [
      { type: 'recon_drone', veterancy: 0 },
      { type: 'recon_drone', veterancy: 1 },
    ];
    const brought = broughtFor(SPREAD_MISSION, { 'roster.surviving_units': drones }, unitName);
    if (brought === null) throw new Error('fixture: this mission brings nothing');
    const el = document.createElement('div');
    const s = spread(el, undefined, { view: viewOf(drones), brought });
    expect(el.querySelector('.rl-deploy')).toBeNull();
    expect(el.querySelector('.rl-loading__reserve')?.textContent).toBe('2 in reserve');
    expect(el.textContent?.match(/in reserve/g)).toHaveLength(1);
    expect(el.querySelector<HTMLButtonElement>('.rl-loading__deploy')?.disabled).toBe(false);
    s.dispose();
  });

  // Pre-flight P2/E2: two "in reserve" lines from two keys, with different
  // numbers, was what the plan's own text would have shipped. The spread
  // takes over the brought panel's roster and reserve lines, and the one
  // count it shows is `loading.brought.reserve` -- pool entries this mission
  // does not draw -- never a second key and never `roster.reserve`.
  it('keeps ONE reserve count on the screen: the spread takes over the brought panel roster and reserve', () => {
    const ledger = { 'roster.surviving_units': SPREAD_POOL, 'roe.mission_ratings': { a: 80 } };
    const brought = broughtFor(SPREAD_MISSION, ledger, unitName);
    if (brought === null) throw new Error('fixture: this mission brings nothing');
    const el = document.createElement('div');
    const s = spread(el, undefined, { brought });
    expect(el.querySelector('.rl-loading__reserve')).toBeNull();
    expect(el.querySelector('.rl-loading__brought')?.textContent).not.toContain('×');
    // What the panel says that the spread does not, it still says.
    expect(el.querySelector('.rl-loading__brought')?.textContent).toContain('Conduct 80');
    expect(el.querySelector('.rl-deploy__reserve')?.textContent).toBe('2 in reserve');
    expect(el.textContent?.match(/in reserve/g)).toHaveLength(1);
    expect(Object.keys(en).filter((k) => k.startsWith('deploy.') && k.includes('reserve'))).toEqual([]);

    // And the one count moves with the choice.
    rowsOf(el)[0].click();
    expect(el.querySelector('.rl-deploy__reserve')?.textContent).toBe('3 in reserve');
    s.dispose();
  });

  // A sandbox and a no-briefing mission keep the bare progress screen they
  // have always had: `holds` gates the spread exactly as it gates the orders
  // paragraph and the commander line. The context is installed so that "no
  // preview" is `holds` talking, not jsdom's missing canvas.
  it('a screen that does not hold shows no spread and no preview', () => {
    giveCanvasAContext();
    const el = document.createElement('div');
    const s = showLoading(
      el,
      'M0 sandbox',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      { view: viewOf(), onChange: () => undefined },
      PREVIEW
    );
    expect(el.querySelector('.rl-deploy')).toBeNull();
    expect(el.querySelector('.rl-deploy__map')).toBeNull();
    s.dispose();
  });

  it('draws the ground beside the force, one pixel per tile, and the orders in the other column', () => {
    giveCanvasAContext();
    const el = document.createElement('div');
    const s = spread(el);
    const canvas = el.querySelector<HTMLCanvasElement>('.rl-deploy__map canvas');
    expect([canvas?.width, canvas?.height]).toEqual([3, 2]);
    expect(el.querySelector('.rl-loading__box--spread')).not.toBeNull();
    const force = el.querySelector('.rl-loading__force');
    expect(force?.querySelector('.rl-deploy')).not.toBeNull();
    expect(force?.querySelector('.rl-deploy__map')).not.toBeNull();
    expect(el.querySelector('.rl-loading__orders .rl-loading__brief')).not.toBeNull();
    s.dispose();
  });

  it('goes without the preview, and keeps everything else, when there is no 2D context', () => {
    // No context: `beforeEach`'s stand-in for jsdom, which answers null.
    const el = document.createElement('div');
    const s = spread(el);
    expect(el.querySelector('.rl-deploy__map')).toBeNull();
    expect(el.querySelector('.rl-deploy')).not.toBeNull();
    expect(el.querySelector('.rl-loading__deploy')).not.toBeNull();
    s.dispose();
  });

  it('the beat count is unchanged by the spread -- it is a sibling, never a beat', () => {
    const without = document.createElement('div');
    showLoading(without, 'Foothold', SPREAD_BRIEFING).dispose();
    const n = briefingBeats(SPREAD_BRIEFING).length;
    const el = document.createElement('div');
    const s = spread(el);
    expect(n).toBeGreaterThan(1);
    expect(el.querySelectorAll('.rl-loading__beat')).toHaveLength(n);
    s.dispose();
  });

  it('leaves a briefing with nothing to spread exactly as it was', () => {
    const el = document.createElement('div');
    const s = showLoading(el, 'Foothold', SPREAD_BRIEFING);
    expect(el.querySelector('.rl-loading__box--spread')).toBeNull();
    const box = el.querySelector('.rl-loading__box');
    expect([...(box?.children ?? [])].map((c) => c.className.split(' ')[0])).toEqual([
      'rl-loading__label',
      'rl-loading__name',
      'rl-loading__track',
      'rl-loading__count',
      'rl-loading__brief',
      'rl-loading__deploy',
    ]);
    s.dispose();
  });

  // Pre-flight M2: the plan's version of this test never pressed Escape. Here
  // Deploy settles one screen and Escape, pressed on a focused ROW of a
  // second screen and bubbling to `window` the way a real key does, takes
  // that one back -- the rows are buttons, and a button with focus must not
  // have swallowed the one key that leaves.
  it('Escape still goes back, and Deploy still settles done()', async () => {
    let back = 0;
    const onBack = (): void => {
      back++;
    };
    const first = document.createElement('div');
    const a = spread(first, undefined, { onBack });
    const done = a.done();
    first.querySelector<HTMLButtonElement>('.rl-loading__deploy')?.click();
    await expect(done).resolves.toBeUndefined();
    expect(back).toBe(0);

    const second = document.createElement('div');
    document.body.append(second);
    const b = spread(second, undefined, { onBack });
    let handed = false;
    const pending = b
      .done()
      .then(() => {
        handed = true;
      })
      .catch(() => undefined);
    const row = rowsOf(second)[0];
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(back).toBe(1);
    expect(handed).toBe(false);
    expect(second.querySelector('.rl-loading')).toBeNull();
    b.dispose();
    await pending;
    second.remove();
  });

  it('puts every chrome string of the spread through the catalogue', () => {
    setCatalogue('pseudo', en, pseudo);
    giveCanvasAContext();
    const el = document.createElement('div');
    const s = spread(el);
    for (const sel of [
      '.rl-deploy__title',
      '.rl-deploy__slots',
      '.rl-deploy__reserve',
      '.rl-deploy__record',
      '.rl-deploy__map figcaption',
    ]) {
      expect(el.querySelector(sel)?.textContent ?? '', sel).toMatch(/^⟦[\s\S]*⟧$/);
    }
    s.dispose();
  });
});
