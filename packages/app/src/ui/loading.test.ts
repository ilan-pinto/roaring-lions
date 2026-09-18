// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { missions } from '@lions/data';
import { briefingBeats, briefingHoldsDeployment, broughtFor, showLoading } from './loading';

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
