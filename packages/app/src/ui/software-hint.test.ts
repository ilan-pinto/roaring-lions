// @vitest-environment jsdom
// The software-rendering line (GH-1413 G1). Every spec here was seen red under a one-line mutation of `software-hint.ts`,
// `quality-hint.ts` or `settings.ts` (listed in the commit that landed it). The classifier's own table is `no-gpu.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Quality, type Settings, type StorageLike } from '../settings';
import { watchQualityHint, type QualityHintDeps } from './quality-hint';
import type { NoGpuEnv } from './no-gpu';
import { SHELL_POLL_MS, rendererName, resolveRenderer, softwareHintWanted, type GlLike } from './software-hint';

const SWIFT = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)';
const METAL = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)';
const prodEnv: NoGpuEnv = { prod: true, hostname: 'roaring-lions.example.workers.dev', query: new URLSearchParams() };

const line = (): HTMLElement | null => document.querySelector('.rl-software-hint');
const lowButton = (): HTMLButtonElement | null => document.querySelector('.rl-software-hint__low');
const dismissButton = (): HTMLButtonElement | null => document.querySelector('.rl-software-hint__dismiss');

/** The settings dependency as main.ts builds it: `settings.ts`'s own loader and writer over a store. */
function settingsOver(store: StorageLike | null) {
  let s: Settings = loadSettings(store);
  const set = vi.fn((next: Settings) => {
    s = next;
    saveSettings(store, next);
  });
  return { get: () => s, set };
}

function memStore(): StorageLike & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

/** A store whose every access throws, as a blocked `localStorage` does. */
const blockedStore: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('SecurityError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

function storeWith(quality: Quality): StorageLike & { m: Map<string, string> } {
  const store = memStore();
  saveSettings(store, { ...structuredClone(DEFAULT_SETTINGS), video: { ...DEFAULT_SETTINGS.video, quality } });
  return store;
}

function boot(settings: QualityHintDeps['settings'], over: Partial<QualityHintDeps> = {}) {
  const raf = vi.fn(() => 1);
  const renderer = vi.fn<() => string | null>(() => SWIFT);
  const deps: QualityHintDeps = {
    env: prodEnv,
    renderer,
    probeRenderer: () => null,
    settings,
    inShell: () => true,
    frames: { raf, cancel: () => {}, now: () => 0, visible: () => true },
    store: null,
    ...over,
  };
  return { stop: watchQualityHint(deps), raf, renderer };
}

beforeEach(() => document.body.replaceChildren());
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

/** A fake context: `unmasked` is what the extension's parameter answers (`'throw'` throws), `null` means no extension. */
function fakeGl(unmasked: string | null | 'throw', renderer: unknown = 'WebKit WebGL'): GlLike {
  return {
    RENDERER: 0x1f01,
    getExtension: () => (unmasked === null ? null : { UNMASKED_RENDERER_WEBGL: 0x9246 }),
    getParameter: (p: number) => {
      if (p === 0x9246) {
        if (unmasked === 'throw') throw new Error('blocked');
        return unmasked;
      }
      return renderer;
    },
  };
}

describe('rendererName: the unmasked renderer, and gl.RENDERER when it is masked or missing', () => {
  it('reads the unmasked renderer when the extension answers', () => expect(rendererName(fakeGl(SWIFT))).toBe(SWIFT));
  it('falls back to gl.RENDERER when the extension is missing', () => expect(rendererName(fakeGl(null, 'Mesa OffScreen'))).toBe('Mesa OffScreen'));
  it('falls back to gl.RENDERER when the extension is masked (an empty answer)', () => expect(rendererName(fakeGl('', 'llvmpipe'))).toBe('llvmpipe'));
  it('falls back to gl.RENDERER when the extension read throws', () => expect(rendererName(fakeGl('throw', 'llvmpipe'))).toBe('llvmpipe'));
  it('a whitespace-only unmasked answer is masked too: it falls back to gl.RENDERER', () =>
    expect(rendererName(fakeGl(' \t\n ', 'llvmpipe'))).toBe('llvmpipe'));
  it('says nothing when neither says anything', () => expect(rendererName(fakeGl('', ''))).toBeNull());
  it('whitespace on both is nothing, not a name', () => expect(rendererName(fakeGl('   ', '  '))).toBeNull());
  it('a non-string answer is nothing', () => expect(rendererName(fakeGl(null, 7))).toBeNull());
});

describe('resolveRenderer: the cached name first, a fresh read only when it says nothing', () => {
  it('uses the cached name and does not probe', () => {
    const probe = vi.fn(() => METAL);
    expect(resolveRenderer(() => SWIFT, probe)).toBe(SWIFT);
    expect(probe).not.toHaveBeenCalled();
  });
  it.each<[string, () => string | null]>([
    ['null', () => null],
    ['empty', () => ''],
    ['whitespace only', () => ' \t '],
    [
      'a throw',
      () => {
        throw new Error('no context');
      },
    ],
  ])('probes when the cached name is %s', (_why, cached) => expect(resolveRenderer(cached, () => SWIFT)).toBe(SWIFT));
});

describe('softwareHintWanted: the whole decision', () => {
  const base = { allowed: true, renderer: SWIFT, settings: structuredClone(DEFAULT_SETTINGS) };
  it('a software renderer, the gate open, not on Low, unanswered: yes', () => expect(softwareHintWanted(base)).toBe(true));
  it('the gate closed (dev, CI, every harness): no', () => expect(softwareHintWanted({ ...base, allowed: false })).toBe(false));
  it('a hardware renderer: no', () => expect(softwareHintWanted({ ...base, renderer: METAL })).toBe(false));
  it('no renderer at all: no', () => expect(softwareHintWanted({ ...base, renderer: null })).toBe(false));
  it('already on Low: no', () =>
    expect(softwareHintWanted({ ...base, settings: { ...base.settings, video: { ...base.settings.video, quality: 'low' } } })).toBe(false));
  it.each<Quality>(['medium', 'high'])('on %s: yes', (quality) =>
    expect(softwareHintWanted({ ...base, settings: { ...base.settings, video: { ...base.settings.video, quality } } })).toBe(true));
  it('already answered: no', () => expect(softwareHintWanted({ ...base, settings: { ...base.settings, hints: { software: true } } })).toBe(false));
});

describe('the line at boot (through watchQualityHint, as main.ts reaches it)', () => {
  it('shows one line on a software renderer, as a status and not a dialog, and changes nothing by itself', () => {
    const settings = settingsOver(memStore());
    const { raf } = boot(settings);
    expect(document.querySelectorAll('.rl-software-hint')).toHaveLength(1);
    expect(line()?.getAttribute('role')).toBe('status');
    expect(line()?.hidden).toBe(false);
    expect(line()?.textContent).toContain('without a graphics card');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(settings.set).not.toHaveBeenCalled(); // nothing automatic
    expect(raf).not.toHaveBeenCalled(); // and the slow-frames probe is not run for it
  });

  it('a hardware renderer shows no line', () => {
    boot(settingsOver(memStore()), { renderer: () => METAL });
    expect(line()).toBeNull();
  });

  it('a masked renderer is read again through gl.RENDERER: a software answer there shows the line', () => {
    boot(settingsOver(memStore()), { renderer: () => '', probeRenderer: () => 'llvmpipe (LLVM 15.0.7, 256 bits)' });
    expect(line()).not.toBeNull();
  });

  it('a device already on Low sees nothing', () => {
    boot(settingsOver(storeWith('low')));
    expect(line()).toBeNull();
  });

  it('the gate closed (a production build on localhost, as every capture tool serves) shows nothing and reads no renderer', () => {
    const { renderer } = boot(settingsOver(memStore()), { env: { ...prodEnv, hostname: 'localhost' } });
    expect(line()).toBeNull();
    expect(renderer).not.toHaveBeenCalled();
  });

  it('Dismiss remembers the answer through the settings writer, keeps the preset, and the next boot shows nothing', () => {
    const store = memStore();
    const settings = settingsOver(store);
    boot(settings);
    dismissButton()?.click();
    expect(line()).toBeNull();
    expect(settings.set).toHaveBeenCalledTimes(1);
    expect(settings.get().hints.software).toBe(true);
    expect(settings.get().video.quality).toBe('high');
    // The next boot reads the same store through settings.ts: never again.
    document.body.replaceChildren();
    boot(settingsOver(store));
    expect(line()).toBeNull();
  });

  it('Switch to Low saves Low and the answer in one write, takes the line away, and the next boot shows nothing', () => {
    const store = memStore();
    const settings = settingsOver(store);
    boot(settings);
    lowButton()?.click();
    expect(line()).toBeNull();
    expect(settings.set).toHaveBeenCalledTimes(1);
    expect(loadSettings(store).video.quality).toBe('low');
    expect(loadSettings(store).hints.software).toBe(true);
    document.body.replaceChildren();
    boot(settingsOver(store));
    expect(line()).toBeNull();
  });

  it('a blocked store cannot crash it: the line shows, the answer holds for the page, and the next boot may show it again', () => {
    const settings = settingsOver(blockedStore);
    expect(() => boot(settings)).not.toThrow();
    expect(line()).not.toBeNull();
    expect(() => dismissButton()?.click()).not.toThrow();
    expect(line()).toBeNull();
    expect(settings.get().hints.software).toBe(true);
    document.body.replaceChildren();
    boot(settingsOver(blockedStore));
    expect(line()).not.toBeNull();
  });

  it('a missing store (storage unavailable) is the same: shown, answered, no throw', () => {
    const settings = settingsOver(null);
    boot(settings);
    expect(() => lowButton()?.click()).not.toThrow();
    expect(settings.get().video.quality).toBe('low');
  });

  it('hides on a battlefield and comes back on a shell screen', () => {
    vi.useFakeTimers();
    let shell = false;
    boot(settingsOver(memStore()), { inShell: () => shell });
    expect(line()?.hidden).toBe(true);
    shell = true;
    vi.advanceTimersByTime(SHELL_POLL_MS);
    expect(line()?.hidden).toBe(false);
    shell = false;
    vi.advanceTimersByTime(SHELL_POLL_MS);
    expect(line()?.hidden).toBe(true);
  });

  it('mounted on High, the preset switched to Low elsewhere (the settings screen): the next poll takes the line down', () => {
    vi.useFakeTimers();
    const settings = settingsOver(storeWith('high'));
    const { stop } = boot(settings);
    expect(line()).not.toBeNull();
    expect(vi.getTimerCount()).toBe(1);
    const s = settings.get();
    settings.set({ ...s, video: { ...s.video, quality: 'low' } }); // through the settings deps, as the settings panel writes
    vi.advanceTimersByTime(SHELL_POLL_MS);
    expect(line()).toBeNull();
    expect(vi.getTimerCount()).toBe(0); // unmounted through the disposer, not merely hidden
    expect(settings.set).toHaveBeenCalledTimes(1); // the line wrote nothing of its own
    expect(() => stop()).not.toThrow(); // the caller's disposer is now a no-op
  });

  it('answered elsewhere (hints.software set by another route): the next poll takes the line down', () => {
    vi.useFakeTimers();
    const settings = settingsOver(memStore());
    boot(settings);
    expect(line()).not.toBeNull();
    const s = settings.get();
    settings.set({ ...s, hints: { ...s.hints, software: true } });
    vi.advanceTimersByTime(SHELL_POLL_MS);
    expect(line()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the line: the disposer', () => {
  it('takes the node, the poll and the listeners away, and is idempotent', () => {
    vi.useFakeTimers();
    const settings = settingsOver(memStore());
    const { stop } = boot(settings);
    const low = lowButton();
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(line()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    low?.click(); // a stale reference: its listener is gone
    expect(settings.set).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });
});
