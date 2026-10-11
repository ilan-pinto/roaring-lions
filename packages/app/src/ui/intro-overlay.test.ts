// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playIntro, type IntroEnd } from './intro-overlay';

/** jsdom implements no media playback: `play`/`pause`/`load` log "not
 *  implemented". Stub them on the prototype, count the calls, and let a test
 *  decide how `play()` settles. */
let playResult: () => Promise<void>;
let plays = 0;
let pauses = 0;
beforeEach(() => {
  plays = 0;
  pauses = 0;
  playResult = () => Promise.resolve();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => {
    plays += 1;
    return playResult();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {
    pauses += 1;
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});
const live: Array<() => void> = [];
afterEach(() => {
  // A test that leaves an overlay up would leave its window listener too.
  for (const d of live.splice(0)) d();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const overlay = (): HTMLElement | null => document.querySelector('.rl-intro');
const key = (k: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
};
const mount = () => {
  const ends: IntroEnd[] = [];
  const dispose = playIntro({ url: '/video/intro.mp4', onFinish: (w) => ends.push(w) });
  live.push(dispose);
  return { ends, dispose };
};

describe('playIntro', () => {
  it('mounts a full-screen dialog on document.body with a muted, non-looping video and a Skip button', () => {
    mount();
    const el = overlay();
    expect(el).not.toBeNull();
    expect(el?.parentElement).toBe(document.body);
    expect(el?.getAttribute('role')).toBe('dialog');
    expect(el?.getAttribute('aria-modal')).toBe('true');
    const v = el?.querySelector('video');
    expect(v?.getAttribute('src')).toBe('/video/intro.mp4');
    expect(v?.muted).toBe(true);
    expect(v?.loop).toBe(false);
    expect(plays).toBe(1);
    const skip = el?.querySelector('button');
    expect(skip?.textContent).toBe('Skip');
    expect(document.activeElement).toBe(skip);
  });

  describe('skippable at any moment, four ways', () => {
    it('the Skip button', () => {
      const { ends } = mount();
      overlay()?.querySelector('button')?.click();
      expect(ends).toEqual(['skipped']);
      expect(overlay()).toBeNull();
    });
    it.each([['Escape'], [' '], ['Enter']])('the %j key', (k) => {
      const { ends } = mount();
      const e = key(k);
      expect(e.defaultPrevented).toBe(true);
      expect(ends).toEqual(['skipped']);
      expect(overlay()).toBeNull();
    });
    it('a click anywhere on the overlay', () => {
      const { ends } = mount();
      overlay()?.querySelector('video')?.click();
      expect(ends).toEqual(['skipped']);
      expect(overlay()).toBeNull();
    });
  });

  it('finishes once whichever skip comes first, and the video is released', () => {
    const { ends } = mount();
    const skip = overlay()?.querySelector('button');
    skip?.click();
    skip?.click();
    key('Escape');
    expect(ends).toEqual(['skipped']);
    expect(pauses).toBeGreaterThan(0);
  });

  it('swallows every other key while up, and lets a browser shortcut through', () => {
    mount();
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    key('a');
    key('ArrowLeft');
    expect(seen).not.toHaveBeenCalled();
    expect(overlay()).not.toBeNull();
    key('r', { ctrlKey: true });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(overlay()).not.toBeNull();
    window.removeEventListener('keydown', seen);
  });

  it('Escape does not reach a listener underneath (the shell back handler)', () => {
    mount();
    const under = vi.fn();
    window.addEventListener('keydown', under);
    key('Escape');
    expect(under).not.toHaveBeenCalled();
    window.removeEventListener('keydown', under);
  });

  it('ends by itself when the video ends', () => {
    const { ends } = mount();
    overlay()?.querySelector('video')?.dispatchEvent(new Event('ended'));
    expect(ends).toEqual(['ended']);
    expect(overlay()).toBeNull();
  });

  it('a video that errors, or a play() the browser refuses, removes the overlay quietly', async () => {
    const err = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    const a = mount();
    overlay()?.querySelector('video')?.dispatchEvent(new Event('error'));
    expect(a.ends).toEqual(['error']);
    expect(overlay()).toBeNull();

    playResult = () => Promise.reject(new Error('NotAllowedError'));
    const b = mount();
    await Promise.resolve();
    await Promise.resolve();
    expect(b.ends).toEqual(['error']);
    expect(overlay()).toBeNull();
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  describe('the disposer contract: leaving the route mid-video', () => {
    it('removes the overlay and every listener, and reports nothing', () => {
      const { ends, dispose } = mount();
      dispose();
      expect(overlay()).toBeNull();
      expect(document.body.children.length).toBe(0);
      expect(ends).toEqual([]);
      // Nothing is listening any more: a key is not swallowed.
      const seen = vi.fn();
      window.addEventListener('keydown', seen);
      key('Escape');
      expect(seen).toHaveBeenCalledTimes(1);
      window.removeEventListener('keydown', seen);
    });
    it('is idempotent, and a disposed overlay never reports a late end', () => {
      const { ends, dispose } = mount();
      const v = overlay()?.querySelector('video');
      dispose();
      dispose();
      v?.dispatchEvent(new Event('ended'));
      expect(ends).toEqual([]);
    });
    it('disposing after it ended on its own is a no-op', () => {
      const { ends, dispose } = mount();
      overlay()?.querySelector('video')?.dispatchEvent(new Event('ended'));
      expect(() => dispose()).not.toThrow();
      expect(ends).toEqual(['ended']);
    });
    it('a disposer called after the overlay already ended does not steal focus back', () => {
      const b = document.createElement('button');
      const c = document.createElement('button');
      document.body.append(b, c);
      b.focus();
      const { dispose } = mount();
      key('Escape');
      expect(document.activeElement).toBe(b);
      c.focus();
      dispose();
      expect(document.activeElement).toBe(c);
    });
    it('gives focus back to what had it', () => {
      const b = document.createElement('button');
      document.body.append(b);
      b.focus();
      const { dispose } = mount();
      expect(document.activeElement).not.toBe(b);
      dispose();
      expect(document.activeElement).toBe(b);
    });
  });
});
