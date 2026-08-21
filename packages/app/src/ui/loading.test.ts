// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { briefingHoldsDeployment, showLoading } from './loading';

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
});
