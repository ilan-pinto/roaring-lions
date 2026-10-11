// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import { INTRO_VIDEO } from './cinematics-model';
import { firstLaunchIntro, introAvailable, replayIntro, type IntroDeps } from './intro';
import type { IntroOverlayDeps } from './intro-overlay';

const SHIPPED = { files: { [INTRO_VIDEO]: {} } };
const ABSENT = { files: {} };

function rig(over: Partial<{ seen: boolean; reduced: boolean; saveData: boolean; manifest: IntroDeps['manifest'] }> = {}) {
  let s: Settings = structuredClone(DEFAULT_SETTINGS);
  s.intro.seen = over.seen ?? false;
  const set = vi.fn((n: Settings) => {
    s = n;
  });
  const dispose = vi.fn();
  let last: IntroOverlayDeps | null = null;
  const play = vi.fn((d: IntroOverlayDeps) => {
    last = d;
    return dispose;
  });
  const deps: IntroDeps = {
    manifest: over.manifest ?? SHIPPED,
    base: '/',
    settings: { get: () => s, set },
    reducedMotion: () => over.reduced ?? false,
    saveData: () => over.saveData ?? false,
    play,
  };
  return { deps, set, play, dispose, settings: () => s, last: () => last };
}

describe('firstLaunchIntro', () => {
  it('plays the intro on a first launch and hands back the overlay disposer', () => {
    const r = rig();
    const d = firstLaunchIntro(r.deps);
    expect(r.play).toHaveBeenCalledTimes(1);
    expect(r.last()?.url).toBe('/video/intro.mp4');
    expect(d).toBe(r.dispose);
    // Seen only once it has been watched or skipped.
    expect(r.set).not.toHaveBeenCalled();
  });

  it('marks it seen when it ends or is skipped, and never when it failed', () => {
    for (const why of ['ended', 'skipped'] as const) {
      const r = rig();
      firstLaunchIntro(r.deps);
      r.last()?.onFinish?.(why);
      expect(r.settings().intro.seen, why).toBe(true);
    }
    const r = rig();
    firstLaunchIntro(r.deps);
    r.last()?.onFinish?.('error');
    expect(r.set).not.toHaveBeenCalled();
    expect(r.settings().intro.seen).toBe(false);
  });

  it('keeps every other setting when it marks seen', () => {
    const r = rig();
    firstLaunchIntro(r.deps);
    r.last()?.onFinish?.('skipped');
    expect({ ...r.settings(), intro: DEFAULT_SETTINGS.intro }).toEqual(DEFAULT_SETTINGS);
  });

  it('does nothing once seen', () => {
    const r = rig({ seen: true });
    firstLaunchIntro(r.deps);
    expect(r.play).not.toHaveBeenCalled();
    expect(r.set).not.toHaveBeenCalled();
  });

  it.each([
    ['reduced motion', { reduced: true }],
    ['save-data', { saveData: true }],
  ])('under %s it never plays, and marks the intro seen', (_n, o) => {
    const r = rig(o);
    firstLaunchIntro(r.deps);
    expect(r.play).not.toHaveBeenCalled();
    expect(r.settings().intro.seen).toBe(true);
  });

  it('with no intro shipped (today) it does nothing at all: no overlay, no write, even under reduced motion', () => {
    for (const o of [{}, { reduced: true }, { saveData: true }]) {
      const r = rig({ ...o, manifest: ABSENT });
      firstLaunchIntro(r.deps);
      expect(r.play).not.toHaveBeenCalled();
      expect(r.set).not.toHaveBeenCalled();
      expect(r.settings().intro.seen).toBe(false);
    }
  });

  it('the real overlay never mounts for a manifest without the intro', () => {
    const r = rig({ manifest: ABSENT });
    firstLaunchIntro({ ...r.deps, play: undefined });
    expect(document.querySelector('.rl-intro')).toBeNull();
  });
});

describe('replayIntro', () => {
  it('plays on request whatever the preferences and the seen flag say, and writes nothing', () => {
    const r = rig({ seen: true, reduced: true, saveData: true });
    const d = replayIntro(r.deps);
    expect(r.play).toHaveBeenCalledTimes(1);
    expect(r.last()?.url).toBe('/video/intro.mp4');
    expect(d).toBe(r.dispose);
    r.last()?.onFinish?.('ended');
    expect(r.set).not.toHaveBeenCalled();
  });
  it('is unavailable, and plays nothing, when the intro does not ship', () => {
    const r = rig({ manifest: ABSENT });
    expect(introAvailable(r.deps)).toBe(false);
    replayIntro(r.deps)();
    expect(r.play).not.toHaveBeenCalled();
    expect(introAvailable(rig().deps)).toBe(true);
  });
});
