// @vitest-environment jsdom
//
// jsdom for the mute test below and nothing else: `attach()` registers the
// gesture listeners on `window`, and the AudioContext this file stands in for
// is only ever built from inside one of them.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BattleAudio, busGain, decodeOrder, musicVolume, uiSetGain, type AudioSet } from './audio';

describe('audio gains', () => {
  it('music is the manifest gain times the track gain times the user master and music', () => {
    expect(musicVolume(0.9, 0.4, { master: 1, music: 1, sfx: 1 })).toBeCloseTo(0.36);
    expect(musicVolume(0.9, 0.4, { master: 0.5, music: 0.5, sfx: 1 })).toBeCloseTo(0.09);
    expect(musicVolume(0.9, 0.4, { master: 1, music: 0, sfx: 1 })).toBe(0);
  });
  it('clamps to [0, 1] whatever the manifest says', () => {
    expect(musicVolume(2, 2, { master: 1, music: 1, sfx: 1 })).toBe(1);
    expect(musicVolume(0.9, -1, { master: 1, music: 1, sfx: 1 })).toBe(0);
  });
  it('the master bus carries the manifest master times the user master; the sfx bus the user sfx', () => {
    expect(busGain(0.9, { master: 0.5, music: 1, sfx: 0.25 })).toEqual({ master: 0.45, sfx: 0.25 });
  });
});

/**
 * A recording stand-in for the WebAudio context.
 *
 * The seam is `createOscillator`: with no manifest registered there are no
 * decoded buffers, so `playUi` takes its synth fallback and every cue it
 * plays is one or two oscillators. Counting them is the only attach-free
 * observation this class offers -- `muted` is private, the gain nodes are
 * driven by the volume sliders and never by the mute flag, and a cue that
 * was suppressed and a cue that was played are otherwise identical from
 * outside.
 */
class FakeContext {
  static made: FakeContext[] = [];
  readonly oscillators: unknown[] = [];
  readonly sources: unknown[] = [];
  /** Every oscillator's `stop(t)` time, in context seconds. */
  readonly stops: number[] = [];
  state = 'running';
  currentTime = 0;
  destination = {};
  constructor() {
    FakeContext.made.push(this);
  }
  createGain(): unknown {
    return { gain: { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: (n: unknown) => n };
  }
  createOscillator(): unknown {
    const stops = this.stops;
    const o = {
      type: '',
      frequency: { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      connect: (n: unknown) => n,
      start: () => {},
      stop: (t: number) => void stops.push(t),
    };
    this.oscillators.push(o);
    return o;
  }
  createBufferSource(): unknown {
    const s = { buffer: null, connect: (n: unknown) => n, start: () => {} };
    this.sources.push(s);
    return s;
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

const realAudioContext = globalThis.AudioContext;

/** An attached `BattleAudio` whose context is the recorder above. `attach()`
 *  only builds the context from inside its own gesture listeners, so the
 *  keydown is what brings it into being. */
function attached(): { audio: BattleAudio; ctx: FakeContext } {
  FakeContext.made.length = 0;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  const audio = new BattleAudio();
  audio.attach();
  window.dispatchEvent(new KeyboardEvent('keydown'));
  const ctx = FakeContext.made[0];
  if (!ctx) throw new Error('attach() built no AudioContext');
  return { audio, ctx };
}

afterEach(() => {
  globalThis.AudioContext = realAudioContext;
});

describe('playUi', () => {
  it('is on the public surface and is safe before attach()', () => {
    const a = new BattleAudio();
    expect(() => a.playUi('ui_alert')).not.toThrow(); // no AudioContext yet
    expect(() => a.playUi('nope')).not.toThrow(); // no such set
  });

  it('clamps a manifest gain the sanity check would have let through', () => {
    expect(uiSetGain(0.6)).toBeCloseTo(0.6);
    expect(uiSetGain(1.5)).toBe(1);
    expect(uiSetGain(-1)).toBe(0);
  });

  // The control: without this, "plays nothing while muted" below would pass on
  // a `playUi` that never plays anything at all -- which is exactly what it
  // does before `attach()`, and exactly the shape of an absent answer passing
  // for a right one.
  it('plays a cue when it is not muted', () => {
    const { audio, ctx } = attached();
    audio.playUi('ui_alert');
    expect(ctx.oscillators.length).toBeGreaterThan(0);
  });

  it('plays nothing at all while muted', () => {
    const { audio, ctx } = attached();
    expect(audio.toggle()).toBe(true); // `m`: the HUD says "audio muted"
    audio.playUi('ui_alert');
    audio.playUi('ui_objective');
    expect(ctx.oscillators).toEqual([]);
    expect(ctx.sources).toEqual([]);
    // And it comes back: a mute that could not be undone would pass the
    // assertion above for the wrong reason.
    expect(audio.toggle()).toBe(false);
    audio.playUi('ui_alert');
    expect(ctx.oscillators.length).toBeGreaterThan(0);
  });
});

describe('playUi — the garage’s two cues (WP-S3g §3.5, R-2)', () => {
  const freqs = (ctx: FakeContext): number[] =>
    ctx.oscillators.map((o) => (o as { frequency: { value: number } }).frequency.value);

  it('a purchase rises, where an alert falls', () => {
    vi.useFakeTimers();
    try {
      const { audio, ctx } = attached();
      audio.playUi('ui_purchase');
      vi.advanceTimersByTime(250);
      const up = freqs(ctx);
      expect(up).toHaveLength(2);
      expect(up[1]).toBeGreaterThan(up[0]);
      ctx.oscillators.length = 0;
      audio.playUi('ui_alert');
      vi.advanceTimersByTime(250);
      const down = freqs(ctx);
      expect(down[1]).toBeLessThan(down[0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an upgrade ratchets, then lands on a note above the purchase’s', () => {
    vi.useFakeTimers();
    try {
      const { audio, ctx } = attached();
      audio.playUi('ui_upgrade');
      vi.advanceTimersByTime(250);
      const f = freqs(ctx);
      expect(f.length).toBeGreaterThanOrEqual(3);
      expect(f[f.length - 1]).toBeGreaterThan(294);
    } finally {
      vi.useRealTimers();
    }
  });

  it('both finish inside 250 ms (spec §6)', () => {
    vi.useFakeTimers();
    try {
      for (const set of ['ui_purchase', 'ui_upgrade']) {
        const { audio, ctx } = attached();
        audio.playUi(set);
        vi.advanceTimersByTime(100); // every voice has started by 100 ms...
        const started = ctx.oscillators.length;
        vi.advanceTimersByTime(400);
        expect(ctx.oscillators.length).toBe(started);
        for (const s of ctx.stops) expect(s).toBeLessThanOrEqual(0.15); // ...and none rings past 150 ms more
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('an unknown name still falls -- the one meaning a garage cue must never borrow', () => {
    vi.useFakeTimers();
    try {
      const { audio, ctx } = attached();
      audio.playUi('ui_nope');
      vi.advanceTimersByTime(250);
      const f = freqs(ctx);
      expect(f[1]).toBeLessThan(f[0]);
    } finally {
      vi.useRealTimers();
    }
  });
});

// The garage uplift's parked item (c), as the final review re-scoped it: the
// UI clips decode FIRST. A garage's first Buy is often the session's first
// gesture, which is what builds the context and starts decoding; with the
// battle library ahead of them in manifest order, the purchase cue fell back
// to its synth arm for the whole of that decode. Building a context at mount
// to decode early is not the answer -- that is a context before a gesture,
// which `ui:routes` asserts never happens.
describe('decodeOrder', () => {
  const set = (event: string): AudioSet => ({ event });
  it('puts every ui set ahead of the battle sets, each group in manifest order', () => {
    const order = decodeOrder({
      rifle: set('fire'),
      ui_alert: set('ui'),
      cannon: set('fire'),
      destroyed: set('destroyed'),
      ui_purchase: set('ui'),
      ui_upgrade: set('ui'),
    }).map(([name]) => name);
    expect(order).toEqual(['ui_alert', 'ui_purchase', 'ui_upgrade', 'rifle', 'cannon', 'destroyed']);
  });
  it('reads an absent manifest section as nothing to decode', () => {
    expect(decodeOrder(undefined)).toEqual([]);
  });
});
