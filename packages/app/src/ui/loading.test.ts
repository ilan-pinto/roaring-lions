// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
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
