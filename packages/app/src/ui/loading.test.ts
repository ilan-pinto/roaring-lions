// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { missions } from '@lions/data';
import { briefingBeats, briefingHoldsDeployment, showLoading } from './loading';

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

  it('still deploys on Escape, for a player who wants out of the text', async () => {
    const el = document.createElement('div');
    const screen = showLoading(el, 'Break the Depot', 'Seven structures.');
    const done = screen.done();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await done;
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
