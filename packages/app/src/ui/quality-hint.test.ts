// @vitest-environment jsdom
// The slow-frames suggestion (GH-1413). Every spec here was seen red under a one-line mutation of `quality-hint.ts` or
// `frame-probe.ts` (listed in the commit that landed it). Nothing here opens a browser: the frame source is a fake.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Quality, type Settings } from '../settings';
import { isDialogOpen } from './confirm';
import { PROBE_SAMPLE_FRAMES, PROBE_WARMUP_FRAMES } from './frame-probe';
import { QUALITY_HINT_ANSWERED_KEY, SUGGESTED_QUALITY, qualityHintAllowed, watchQualityHint, type QualityHintDeps } from './quality-hint';
import type { NoGpuEnv } from './no-gpu';

const SWIFT = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)';
const METAL = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)';
const prodEnv: NoGpuEnv = { prod: true, hostname: 'roaring-lions.example.workers.dev', query: new URLSearchParams() };

const card = (): HTMLElement | null => document.querySelector('.rl-quality-hint');
const buttons = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('.rl-quality-hint button')];
const key = (k: string): KeyboardEvent => new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });

/** A fake frame source. `play(n, dt)` delivers `n` frames `dt` ms apart, to whoever asked for the next one. */
function frameSource() {
  let cb: ((ts: number) => void) | null = null;
  let ts = 0;
  let wall = 0;
  let visible = true;
  const raf = vi.fn((f: (t: number) => void) => {
    cb = f;
    return 1;
  });
  const cancel = vi.fn(() => {
    cb = null;
  });
  return {
    frames: { raf, cancel, now: () => wall, visible: () => visible },
    play(n: number, dt: number): void {
      for (let i = 0; i < n && cb !== null; i++) {
        ts += dt;
        wall = ts;
        const f = cb;
        f(ts);
      }
    },
    /** A full probe's worth of frames: warmup, the sample, and the frame that sets the clock. */
    fullSample(dt: number): void {
      this.play(1 + PROBE_WARMUP_FRAMES + PROBE_SAMPLE_FRAMES, dt);
    },
    hide(): void {
      visible = false;
    },
    raf,
    cancel,
  };
}

function memoryStore(refuse = false) {
  const m = new Map<string, string>();
  return {
    m,
    store: {
      getItem: (k: string) => {
        if (refuse) throw new Error('blocked');
        return m.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (refuse) throw new Error('blocked');
        m.set(k, v);
      },
      removeItem: (k: string) => void m.delete(k),
    },
  };
}

/** A settings dependency over one in-memory object; `setQuality` records each preset a write carries. */
function settingsAt(quality: Quality, setQuality: (q: Quality) => void = () => {}): QualityHintDeps['settings'] & { current: () => Settings } {
  let s: Settings = { ...structuredClone(DEFAULT_SETTINGS), video: { ...DEFAULT_SETTINGS.video, quality } };
  return {
    get: () => s,
    set: (next) => {
      setQuality(next.video.quality);
      s = next;
    },
    current: () => s,
  };
}

function setup(over: Partial<QualityHintDeps> = {}, quality: Quality = 'high') {
  const src = frameSource();
  const mem = memoryStore();
  const setQuality = vi.fn<(q: Quality) => void>();
  const renderer = vi.fn<() => string | null>(() => METAL);
  const deps: QualityHintDeps = {
    env: prodEnv,
    renderer,
    probeRenderer: () => null,
    settings: settingsAt(quality, setQuality),
    inShell: () => true,
    frames: src.frames,
    store: mem.store,
    ...over,
  };
  const stop = watchQualityHint(deps);
  return { src, mem, setQuality, renderer, stop };
}

beforeEach(() => document.body.replaceChildren());
afterEach(() => document.body.replaceChildren());

describe('qualityHintAllowed: the same gate as telemetry, feedback and the no-graphics notice', () => {
  it('a production build on a real host', () => expect(qualityHintAllowed(prodEnv)).toBe(true));
  it('never in dev (pnpm dev, ui:routes, ui:shots, the golden gate)', () => expect(qualityHintAllowed({ ...prodEnv, prod: false })).toBe(false));
  it.each(['localhost', '127.0.0.1', '[::1]', 'mac.local', 'app.localhost', 'game.test'])('never on %s, even in a production build', (hostname) =>
    expect(qualityHintAllowed({ ...prodEnv, hostname })).toBe(false),
  );
  it('?qualityhint asks to see it anywhere', () =>
    expect(qualityHintAllowed({ prod: false, hostname: 'localhost', query: new URLSearchParams('qualityhint') })).toBe(true));
});

describe('watchQualityHint: the card, and who answers it', () => {
  it('a slow sample shows the card as a modal dialog with the accept button focused, and changes nothing yet', () => {
    const { src, setQuality, stop } = setup();
    src.fullSample(60);
    const c = card();
    expect(c).not.toBeNull();
    expect(c?.getAttribute('role')).toBe('dialog');
    expect(c?.getAttribute('aria-modal')).toBe('true');
    expect(c?.querySelector('h2')?.textContent).toBe('The game is running slowly');
    expect(c?.textContent).toMatch(/Low quality setting draws fewer effects/);
    expect(c?.textContent).toMatch(/takes effect from the next mission/);
    expect(buttons().map((b) => b.textContent)).toEqual(['Switch to Low quality', 'Keep my setting']);
    expect(document.activeElement).toBe(buttons()[0]);
    expect(isDialogOpen()).toBe(true);
    expect(setQuality).not.toHaveBeenCalled(); // nothing automatic: showing the card changes no setting
    stop();
  });

  it('Switch to Low quality saves Low, once, remembers the answer and takes the card away', () => {
    const { src, setQuality, mem } = setup();
    src.fullSample(60);
    buttons()[0].click();
    expect(setQuality).toHaveBeenCalledTimes(1);
    expect(setQuality).toHaveBeenCalledWith('low');
    expect(SUGGESTED_QUALITY).toBe('low');
    expect(mem.m.get(QUALITY_HINT_ANSWERED_KEY)).toBe('1');
    expect(card()).toBeNull();
    expect(isDialogOpen()).toBe(false);
  });

  it('Keep my setting changes nothing, remembers the answer and takes the card away', () => {
    const { src, setQuality, mem } = setup();
    src.fullSample(60);
    buttons()[1].click();
    expect(setQuality).not.toHaveBeenCalled();
    expect(mem.m.get(QUALITY_HINT_ANSWERED_KEY)).toBe('1');
    expect(card()).toBeNull();
  });

  it('Escape is "keep my setting", never "switch"', () => {
    const { src, setQuality, mem } = setup();
    src.fullSample(60);
    document.dispatchEvent(key('Escape'));
    window.dispatchEvent(key('Escape'));
    expect(setQuality).not.toHaveBeenCalled();
    expect(mem.m.get(QUALITY_HINT_ANSWERED_KEY)).toBe('1');
    expect(card()).toBeNull();
  });

  it('a blocked store does not stop the card or the answer (it is just asked again next load)', () => {
    const blocked = memoryStore(true);
    const { src, setQuality } = setup({ store: blocked.store });
    src.fullSample(60);
    expect(card()).not.toBeNull();
    buttons()[0].click();
    expect(setQuality).toHaveBeenCalledWith('low');
    expect(card()).toBeNull();
  });
});

describe('watchQualityHint: when it stays quiet', () => {
  it('fast frames show nothing', () => {
    const { src, setQuality } = setup();
    src.fullSample(16.7);
    expect(card()).toBeNull();
    expect(setQuality).not.toHaveBeenCalled();
  });

  it('frames on the reference machine (a slow interval in six) show nothing', () => {
    const { src } = setup();
    // 1 in 6 intervals is 60 ms: 17% slow, the Retina M3 Pro reading the declined rule fired on.
    let n = 0;
    for (let i = 0; i < 1 + PROBE_WARMUP_FRAMES + PROBE_SAMPLE_FRAMES; i++) src.play(1, n++ % 6 === 0 ? 60 : 16.7);
    expect(card()).toBeNull();
  });

  it.each([
    ['dev', { ...prodEnv, prod: false }],
    ['localhost', { ...prodEnv, hostname: 'localhost' }],
    ['127.0.0.1', { ...prodEnv, hostname: '127.0.0.1' }],
  ])('never in %s: no renderer read, no frame asked for, no card', (_n, env) => {
    const { src, renderer } = setup({ env });
    expect(renderer).not.toHaveBeenCalled();
    expect(src.raf).not.toHaveBeenCalled();
    src.fullSample(60);
    expect(card()).toBeNull();
  });

  it('?qualityhint shows it on localhost', () => {
    const env = { prod: false, hostname: 'localhost', query: new URLSearchParams('qualityhint') };
    const { src } = setup({ env });
    src.fullSample(60);
    expect(card()).not.toBeNull();
  });

  it('a software renderer is left to the no-graphics notice: no probe, no card', () => {
    const { src } = setup({ renderer: () => SWIFT });
    expect(src.raf).not.toHaveBeenCalled();
    src.fullSample(60);
    expect(card()).toBeNull();
  });

  it('a renderer read that throws is not a software renderer: the probe runs', () => {
    const { src } = setup({
      renderer: () => {
        throw new Error('no context');
      },
    });
    src.fullSample(60);
    expect(card()).not.toBeNull();
  });

  it('a saved Low preset has nothing lower to offer: no probe, no card', () => {
    const { src } = setup({}, 'low');
    expect(src.raf).not.toHaveBeenCalled();
    src.fullSample(60);
    expect(card()).toBeNull();
  });

  it('a player who has already answered is not asked again', () => {
    const mem = memoryStore();
    mem.m.set(QUALITY_HINT_ANSWERED_KEY, '1');
    const { src } = setup({ store: mem.store });
    expect(src.raf).not.toHaveBeenCalled();
    src.fullSample(60);
    expect(card()).toBeNull();
  });

  it('a player who is in a mission when the sample ends is not interrupted', () => {
    let shell = true;
    const { src } = setup({ inShell: () => shell });
    src.play(50, 60);
    shell = false;
    src.play(200, 60);
    expect(card()).toBeNull();
  });

  it('a hidden tab voids the sample: no card', () => {
    const { src } = setup();
    src.play(20, 60);
    src.hide();
    src.play(200, 60);
    expect(card()).toBeNull();
  });

  it('another dialog on screen keeps the card away, and changes nothing', () => {
    const { src, setQuality } = setup();
    const other = document.createElement('div');
    other.className = 'rl-no-gpu';
    document.body.append(other);
    src.fullSample(60);
    expect(card()).toBeNull();
    expect(setQuality).not.toHaveBeenCalled();
  });

  it('the preset can have been changed under the probe: a saved Low at verdict time shows nothing', () => {
    const settings = settingsAt('high');
    const { src } = setup({ settings });
    src.play(60, 60);
    settings.set({ ...settings.get(), video: { ...settings.get().video, quality: 'low' } });
    src.play(200, 60);
    expect(card()).toBeNull();
  });
});

describe('watchQualityHint: the disposer', () => {
  it('stops a probe in flight', () => {
    const { src, stop } = setup();
    src.play(10, 60);
    stop();
    expect(src.cancel).toHaveBeenCalled();
    src.play(300, 60);
    expect(card()).toBeNull();
  });
  it('takes the card away if it is up, and is idempotent', () => {
    const { src, stop, setQuality } = setup();
    src.fullSample(60);
    expect(card()).not.toBeNull();
    stop();
    stop();
    expect(card()).toBeNull();
    expect(setQuality).not.toHaveBeenCalled();
  });
});
