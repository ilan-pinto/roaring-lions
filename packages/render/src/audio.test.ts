// @vitest-environment jsdom
//
// jsdom for the mute test below and nothing else: `attach()` registers the
// gesture listeners on `window`, and the AudioContext this file stands in for
// is only ever built from inside one of them.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  admitVoice,
  BattleAudio,
  busGain,
  decodeOrder,
  DUCK,
  duckRamp,
  musicVolume,
  placement,
  PLACEHOLDER_HZ,
  PLACEHOLDER_S,
  RADIO_BAND_HZ,
  uiSetGain,
  VOICE_CUT_S,
  VOICE_DECODE_BUDGET_BYTES,
  type AudioManifest,
  type AudioSet,
  type VoiceManifest,
  type VoicePlay,
  type VoicePriority,
  type VoiceVariant,
} from './audio';

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
    expect(busGain(0.9, { master: 0.5, music: 1, sfx: 0.25 })).toEqual({ master: 0.45, sfx: 0.25, voice: 1 });
  });
});

/** One AudioParam, recording every automation call as [method, value, time]. */
interface FakeParam {
  value: number;
  readonly events: [string, number, number][];
  setValueAtTime(v: number, t: number): void;
  linearRampToValueAtTime(v: number, t: number): void;
  exponentialRampToValueAtTime(v: number, t: number): void;
  cancelScheduledValues(t: number): void;
}
function param(value: number): FakeParam {
  const events: [string, number, number][] = [];
  return {
    value,
    events,
    setValueAtTime: (v, t) => void events.push(['set', v, t]),
    linearRampToValueAtTime: (v, t) => void events.push(['linear', v, t]),
    exponentialRampToValueAtTime: (v, t) => void events.push(['exp', v, t]),
    cancelScheduledValues: (t) => void events.push(['cancel', 0, t]),
  };
}
/** Every node remembers the ONE node it feeds, so a test can walk a chain. */
class FakeNode {
  to: unknown = null;
  connect<T>(n: T): T {
    this.to = n;
    return n;
  }
  disconnect(): void {
    this.to = null;
  }
}
class FakeGain extends FakeNode {
  readonly gain = param(1);
}
class FakeFilter extends FakeNode {
  type = '';
  readonly frequency = param(350);
  readonly Q = param(1);
}
class FakePanner extends FakeNode {
  readonly pan = param(0);
}
class FakeSource extends FakeNode {
  buffer: unknown = null;
  readonly playbackRate = param(1);
  onended: (() => void) | null = null;
  stoppedAt: number | null = null;
  start(): void {}
  stop(t = 0): void {
    this.stoppedAt = t;
  }
}
class FakeOscillator extends FakeSource {
  type = '';
  readonly frequency = param(0);
  constructor(private readonly stops: number[]) {
    super();
  }
  override stop(t = 0): void {
    super.stop(t);
    this.stops.push(t);
  }
}
interface FakeBuffer {
  duration: number;
  length: number;
  numberOfChannels: number;
}
const LINE_BUFFER: FakeBuffer = { duration: 1.2, length: 57_600, numberOfChannels: 1 };
/**
 * A recording stand-in for the WebAudio context.
 *
 * The seam for the cue tests is `createOscillator`: with no manifest
 * registered there are no decoded buffers, so `playUi` takes its synth
 * fallback and every cue it plays is one or two oscillators. Counting them is
 * the only attach-free observation this class offers -- `muted` is private,
 * the gain nodes are driven by the volume sliders and never by the mute flag,
 * and a cue that was suppressed and a cue that was played are otherwise
 * identical from outside. The graph tests walk `to` from node to node.
 */
class FakeContext {
  static made: FakeContext[] = [];
  /** What the next `decodeAudioData` resolves to. */
  static nextBuffer: FakeBuffer = { ...LINE_BUFFER };
  readonly oscillators: FakeOscillator[] = [];
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  readonly filters: FakeFilter[] = [];
  /** Every oscillator's `stop(t)` time, in context seconds. */
  readonly stops: number[] = [];
  state = 'running';
  currentTime = 0;
  sampleRate = 48_000;
  destination = new FakeNode();
  constructor() {
    FakeContext.made.push(this);
  }
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBiquadFilter(): FakeFilter {
    const f = new FakeFilter();
    this.filters.push(f);
    return f;
  }
  createStereoPanner(): FakePanner {
    return new FakePanner();
  }
  createOscillator(): FakeOscillator {
    const o = new FakeOscillator(this.stops);
    this.oscillators.push(o);
    return o;
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBuffer(_channels: number, n: number): { getChannelData(): Float32Array } {
    return { getChannelData: () => new Float32Array(n) };
  }
  decodeAudioData(): Promise<FakeBuffer> {
    return Promise.resolve({ ...FakeContext.nextBuffer });
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

const realAudioContext = globalThis.AudioContext;

/** An attached `BattleAudio` whose context is the recorder above; `setup` runs
 *  before `attach()`, which only builds the context inside its own gesture
 *  listeners, so the keydown is what brings it into being. */
function attachedWith(setup: (a: BattleAudio) => void): { audio: BattleAudio; ctx: FakeContext } {
  FakeContext.made.length = 0;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  const audio = new BattleAudio();
  setup(audio);
  // Record every window listener this instance adds, so `afterEach` can take
  // them off again: left on, the NEXT test's keydown would wake this one too.
  const spy = vi.spyOn(window, 'addEventListener');
  try {
    audio.attach();
    window.dispatchEvent(new KeyboardEvent('keydown'));
  } finally {
    const added = spy.mock.calls.map(([type, fn]) => [type, fn] as const);
    spy.mockRestore();
    live.push({ audio, added });
  }
  const ctx = FakeContext.made[0];
  if (!ctx) throw new Error('attach() built no AudioContext');
  return { audio, ctx };
}
const attached = (): { audio: BattleAudio; ctx: FakeContext } => attachedWith(() => {});

/** Every instance `attachedWith` built this test, with the listeners it added. */
const live: { audio: BattleAudio; added: (readonly [string, EventListenerOrEventListenerObject | null])[] }[] = [];

interface FakeResponse {
  ok: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
}
const OK: FakeResponse = { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
const NOT_FOUND: FakeResponse = { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };

/** Every URL `fetch` was asked for, in order; every answer is four bytes
 *  unless `answer` says otherwise. */
function stubFetch(answer: (url: string) => FakeResponse | Promise<FakeResponse> = () => OK): string[] {
  const fetched: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    return answer(url);
  });
  return fetched;
}

afterEach(async () => {
  // Drain first, while this test's fetch stub is still the global: an
  // in-flight pass must never reach the next test's stub.
  for (const { audio, added } of live.splice(0)) {
    await audio.decoded();
    for (const [type, fn] of added) if (fn) window.removeEventListener(type, fn);
  }
  globalThis.AudioContext = realAudioContext;
  vi.unstubAllGlobals();
  FakeContext.nextBuffer = { ...LINE_BUFFER };
});

const V = (file: string, en: string): VoiceVariant => ({
  file, license: 'LicenseRef-owned', source: 'test', generator: 'test', text: 't', translit: 't', en,
});
/** A manifest with one ui set, one battle set and five voice keys: three
 *  Hebrew lines, one declared-empty Hebrew key, one Arabic line. */
const MANIFEST: AudioManifest = {
  master_gain: 1,
  sets: {
    tank_gun: { event: 'fire', weapon_classes: ['apfsds'], variants: [{ file: 'battle/tank_gun_01.ogg' }] },
    ui_alert: { event: 'ui', variants: [{ file: 'ui/alert_01.ogg' }] },
  },
  voices: {
    gain: 0.8,
    languages: { kdf: 'he', sarim: 'ar' },
    lines: {
      'he.infantry.move': { variants: [V('voice/he/infantry/move_01a.ogg', 'moving')] },
      'he.infantry.death': { variants: [V('voice/he/infantry/death_01a.ogg', 'we are hit')] },
      'he.common.ack': { variants: [V('voice/he/common/ack_01a.ogg', 'copy')] },
      'he.crew.death': { variants: [] },
      'ar.infantry.death': { variants: [V('voice/ar/infantry/death_01a.ogg', 'we are hit')] },
    },
  },
};

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

describe('the voice bus (WP-AU1 §7, N11, N13, R-11)', () => {
  it('busGain carries the Voices slider, and gains without one read it as 1', () => {
    expect(busGain(0.9, { master: 0.5, music: 1, sfx: 0.25, voice: 0.4 })).toEqual({ master: 0.45, sfx: 0.25, voice: 0.4 });
    expect(busGain(0.9, { master: 1, music: 1, sfx: 1 })).toEqual({ master: 0.9, sfx: 1, voice: 1 });
    expect(busGain(1, { master: 1, music: 1, sfx: 1, voice: 7 }).voice).toBe(1);
  });

  it('attach builds master, sfx, the sfx duck and the voice bus, and the radio band feeds the voice bus', () => {
    const { ctx } = attached();
    const [master, sfx, sfxDuck, voice] = ctx.gains;
    if (!master || !sfx || !sfxDuck || !voice) throw new Error('attach() built fewer than four gains');
    expect(master.to).toBe(ctx.destination);
    expect(sfx.to).toBe(sfxDuck);
    expect(sfxDuck.to).toBe(master);
    expect(voice.to).toBe(master);
    const [hp, lp] = ctx.filters;
    if (!hp || !lp) throw new Error('attach() built no radio band');
    expect([hp.type, hp.frequency.value, hp.to]).toEqual(['highpass', RADIO_BAND_HZ.low, lp]);
    expect([lp.type, lp.frequency.value, lp.to]).toEqual(['lowpass', RADIO_BAND_HZ.high, voice]);
  });

  it('the Voices slider drives the voice bus live, and leaves sfx alone', () => {
    const { audio, ctx } = attached();
    audio.setGains({ master: 1, music: 1, sfx: 0.5, voice: 0.25 });
    expect(ctx.gains[3]?.gain.value).toBe(0.25);
    expect(ctx.gains[1]?.gain.value).toBe(0.5);
  });
});

describe('voice decoding (N16, spec §7 decode order)', () => {
  it('fetches nothing before the first gesture, whatever the roster says', () => {
    const fetched = stubFetch();
    const a = new BattleAudio();
    a.useManifest(MANIFEST, '/a/');
    a.setVoiceLanguages(['he', 'ar']);
    expect(fetched).toEqual([]);
    expect(a.voiceStats()).toMatchObject({ languages: ['ar', 'he'], keys: 0, bytes: 0 });
  });

  it('decodes ui, then the roster’s voices, then the battle library -- and no other language', async () => {
    const fetched = stubFetch();
    attachedWith((a) => {
      a.useManifest(MANIFEST, '/a/');
      a.setVoiceLanguages(['he']);
    });
    await vi.waitFor(() => expect(fetched).toHaveLength(5));
    expect(fetched).toEqual([
      '/a/ui/alert_01.ogg',
      '/a/voice/he/infantry/move_01a.ogg',
      '/a/voice/he/infantry/death_01a.ogg',
      '/a/voice/he/common/ack_01a.ogg',
      '/a/battle/tank_gun_01.ogg',
    ]);
  });

  it('a language that joins the roster later decodes then; one that leaves is freed', async () => {
    const fetched = stubFetch();
    const { audio } = attachedWith((a) => {
      a.useManifest(MANIFEST, '/a/');
      a.setVoiceLanguages(['he']);
    });
    await vi.waitFor(() => expect(audio.voiceStats().keys).toBe(3));
    audio.setVoiceLanguages(['ar', 'he']);
    await vi.waitFor(() => expect(audio.voiceStats().keys).toBe(4));
    expect(fetched.filter((u) => u.includes('/voice/ar/'))).toEqual(['/a/voice/ar/infantry/death_01a.ogg']);
    audio.setVoiceLanguages(['ar']);
    expect(audio.voiceStats()).toMatchObject({ languages: ['ar'], keys: 1, bytes: LINE_BUFFER.length * 4 });
  });

  it('stops at 16 MB of decoded PCM and says so, rather than growing without bound', async () => {
    stubFetch();
    FakeContext.nextBuffer = { duration: 50, length: 48_000 * 50, numberOfChannels: 1 }; // 9.6 MB decoded
    const { audio } = attachedWith((a) => {
      a.useManifest(MANIFEST, '/a/');
      a.setVoiceLanguages(['he']);
    });
    await vi.waitFor(() => expect(audio.voiceStats().overBudget).toBe(true));
    expect(audio.voiceStats().keys).toBe(1);
    expect(audio.voiceStats().bytes).toBeLessThanOrEqual(VOICE_DECODE_BUDGET_BYTES);
  });
});

describe('voice decoding -- the edges (N16, R-9)', () => {
  it('a language that leaves while its key is decoding is not stored', async () => {
    let release: (r: FakeResponse) => void = () => {
      throw new Error('the voice fetch was never asked for');
    };
    const held = new Promise<FakeResponse>((r) => {
      release = r;
    });
    const fetched = stubFetch((url) => (url.includes('/voice/') ? held : OK));
    const { audio } = attachedWith((a) => {
      a.useManifest(MANIFEST, '/a/');
      a.setVoiceLanguages(['he']);
    });
    await vi.waitFor(() => expect(fetched).toContain('/a/voice/he/infantry/move_01a.ogg'));
    audio.setVoiceLanguages([]); // the roster changes mid-decode
    release(OK);
    await audio.decoded();
    expect(audio.voiceStats()).toMatchObject({ languages: [], keys: 0, bytes: 0 });
  });

  it('a manifest with no voices section decodes nothing, and throws nothing', async () => {
    const fetched = stubFetch();
    const { audio } = attachedWith((a) => {
      a.useManifest({ master_gain: 1, sets: { ui_alert: { event: 'ui', variants: [{ file: 'ui/alert_01.ogg' }] } } }, '/a/');
      a.setVoiceLanguages(['he', 'ar']);
    });
    await audio.decoded();
    expect(() => audio.setVoiceLanguages(['he'])).not.toThrow();
    await audio.decoded();
    expect(fetched).toEqual(['/a/ui/alert_01.ogg']);
    expect(audio.voiceStats()).toMatchObject({ keys: 0, bytes: 0, overBudget: false });
  });

  it('a take that 404s is never fetched again this session', async () => {
    const gone = '/a/voice/he/infantry/move_01a.ogg';
    const fetched = stubFetch((url) => (url === gone ? NOT_FOUND : OK));
    const { audio } = attachedWith((a) => {
      a.useManifest(MANIFEST, '/a/');
      a.setVoiceLanguages(['he']);
    });
    await audio.decoded();
    expect(audio.voiceStats().keys).toBe(2);
    audio.setVoiceLanguages(['ar', 'he']); // a second pass over every he key
    await audio.decoded();
    expect(audio.voiceStats().keys).toBe(3);
    expect(fetched.filter((u) => u === gone)).toHaveLength(1);
  });

  it('a key kept out by the budget is not re-decoded until a language leaves, then it is', async () => {
    const fetched = stubFetch();
    FakeContext.nextBuffer = { duration: 50, length: 48_000 * 50, numberOfChannels: 1 }; // 9.6 MB decoded
    const { audio } = attachedWith((a) => {
      a.useManifest(MANIFEST, '/a/');
      a.setVoiceLanguages(['ar', 'he']);
    });
    await audio.decoded();
    expect(audio.voiceStats()).toMatchObject({ keys: 1, overBudget: true }); // he.infantry.move
    const arLine = '/a/voice/ar/infantry/death_01a.ogg';
    expect(fetched.filter((u) => u === arLine)).toHaveLength(1);
    audio.setVoiceLanguages(['ar', 'he']); // same roster, nothing freed
    await audio.decoded();
    expect(fetched.filter((u) => u === arLine)).toHaveLength(1);
    expect(audio.voiceStats().overBudget).toBe(true); // still silent for the budget
    audio.setVoiceLanguages(['ar']); // he leaves: 9.6 MB freed
    await audio.decoded();
    expect(fetched.filter((u) => u === arLine)).toHaveLength(2);
    expect(audio.voiceStats()).toMatchObject({ languages: ['ar'], keys: 1, overBudget: false });
  });

  it('a voice pass that throws stalls neither the battle library nor the next pass', async () => {
    const fetched = stubFetch();
    const voices = MANIFEST.voices;
    if (!voices?.lines) throw new Error('MANIFEST has no voice lines');
    const lines = voices.lines;
    let throws = true;
    const flaky: VoiceManifest = { gain: voices.gain, languages: voices.languages };
    Object.defineProperty(flaky, 'lines', {
      get: () => {
        if (throws) {
          throws = false;
          throw new Error('a pass that throws');
        }
        return lines;
      },
    });
    const { audio } = attachedWith((a) => {
      a.useManifest({ ...MANIFEST, voices: flaky }, '/a/');
      a.setVoiceLanguages(['he']);
    });
    await audio.decoded();
    expect(fetched).toEqual(['/a/ui/alert_01.ogg', '/a/battle/tank_gun_01.ogg']);
    audio.setVoiceLanguages(['he']);
    await audio.decoded();
    expect(audio.voiceStats().keys).toBe(3);
  });
});

describe('admitVoice (N4, N5)', () => {
  const v = (id: number, priority: VoicePriority): { id: number; priority: VoicePriority } => ({ id, priority });
  it('plays into a free slot', () => {
    expect(admitVoice([], 'enemy_death')).toEqual({ play: true, cut: [] });
    expect(admitVoice([v(1, 'order')], 'kdf_death')).toEqual({ play: true, cut: [] });
  });
  it('a new order cuts the last order, whatever else is playing (N4)', () => {
    expect(admitVoice([v(1, 'order')], 'order')).toEqual({ play: true, cut: [1] });
    expect(admitVoice([v(1, 'order'), v(2, 'kdf_death')], 'order')).toEqual({ play: true, cut: [1] });
  });
  it('full: the lowest-ranked voice goes, oldest first; a tie or a loser is dropped, not queued (N5)', () => {
    expect(admitVoice([v(1, 'kdf_death'), v(2, 'kdf_death')], 'order')).toEqual({ play: true, cut: [1] });
    expect(admitVoice([v(1, 'kdf_death'), v(2, 'enemy_death')], 'order')).toEqual({ play: true, cut: [2] });
    expect(admitVoice([v(1, 'enemy_death'), v(2, 'kdf_death')], 'kdf_death')).toEqual({ play: true, cut: [1] });
    expect(admitVoice([v(1, 'kdf_death'), v(2, 'kdf_death')], 'kdf_death')).toEqual({ play: false, cut: [] });
    expect(admitVoice([v(1, 'kdf_death'), v(2, 'kdf_death')], 'enemy_death')).toEqual({ play: false, cut: [] });
  });
});

describe('duckRamp and placement', () => {
  it('ramps linearly and holds its target once the time is up (N12)', () => {
    expect(duckRamp(1, 0.5, 0, 80)).toBe(1);
    expect(duckRamp(1, 0.5, 40, 80)).toBeCloseTo(0.75);
    expect(duckRamp(1, 0.5, 80, 80)).toBe(0.5);
    expect(duckRamp(1, 0.5, 500, 80)).toBe(0.5);
  });
  it('is playSet’s own arithmetic, unchanged: gain atten², lowpass, pan, and a hard edge at 26 tiles', () => {
    expect(placement(0, 0)).toEqual({ audible: true, gain: 1, pan: 0, lowpassHz: 13_200 });
    const half = placement(13, 0);
    expect(half.gain).toBeCloseTo(0.25);
    expect(half.lowpassHz).toBeCloseTo(4200);
    expect(half.pan).toBeCloseTo(13 / 18.2);
    expect(placement(0, 13).pan).toBeCloseTo(-13 / 18.2);
    expect(placement(27, 0).audible).toBe(false);
  });
});

describe('playVoice (WP-AU1 §7)', () => {
  /** A context whose Hebrew (and, if asked, Arabic) lines have decoded. */
  async function ready(langs: string[] = ['he'], manifest: AudioManifest = MANIFEST) {
    stubFetch();
    const r = attachedWith((a) => {
      a.useManifest(manifest, '/a/');
      a.setVoiceLanguages(langs);
    });
    await vi.waitFor(() => expect(r.audio.voiceStats().keys).toBe(langs.includes('ar') ? 4 : 3));
    const [, , sfxDuck, voice] = r.ctx.gains;
    const [hp] = r.ctx.filters;
    if (!sfxDuck || !voice || !hp) throw new Error('attach() did not build the voice graph');
    return { ...r, sfxDuck, voice, hp };
  }
  const order = (key: string): VoicePlay => ({ key, priority: 'order' });
  const last = <T>(xs: T[]): T => {
    const x = xs.at(-1);
    if (x === undefined) throw new Error('nothing was created');
    return x;
  };

  it('is safe before attach, and says why nothing played', () => {
    expect(new BattleAudio().playVoice(order('he.infantry.move')).status).toBe('no-context');
  });

  it('plays an order over the radio band at the line gain, and hands back its meaning and length', async () => {
    const { audio, ctx, hp } = await ready();
    expect(audio.playVoice(order('he.infantry.move'))).toEqual({ status: 'played', seconds: 1.2, en: 'moving', cut: 0 });
    const line = last(ctx.sources).to as FakeGain;
    expect(line.gain.value).toBeCloseTo(0.8);
    expect(line.to).toBe(hp);
  });

  it('a missing line plays nothing and is not an error: status missing, no node made (R-9)', async () => {
    const { audio, ctx } = await ready();
    const before = ctx.sources.length + ctx.oscillators.length;
    expect(audio.playVoice({ key: 'he.crew.death', priority: 'kdf_death' }).status).toBe('missing'); // declared, empty
    expect(audio.playVoice(order('he.nope.move')).status).toBe('missing'); // not declared at all
    expect(ctx.sources.length + ctx.oscillators.length).toBe(before);
  });

  it('plays nothing muted, at Voices 0 or at Master 0 -- and does not duck for a voice nobody hears', async () => {
    const { audio, ctx, sfxDuck } = await ready();
    audio.setVoicePlaceholder(true); // not even the dev tick
    expect(audio.toggle()).toBe(true);
    expect(audio.playVoice(order('he.infantry.move')).status).toBe('muted');
    expect(audio.toggle()).toBe(false);
    audio.setGains({ master: 1, music: 1, sfx: 1, voice: 0 });
    expect(audio.playVoice(order('he.infantry.move')).status).toBe('volume-zero');
    expect(audio.playVoice(order('he.crew.move')).status).toBe('volume-zero');
    audio.setGains({ master: 0, music: 1, sfx: 1, voice: 1 });
    expect(audio.playVoice(order('he.infantry.move')).status).toBe('volume-zero');
    expect(ctx.sources).toEqual([]);
    expect(ctx.oscillators).toEqual([]);
    expect(sfxDuck.gain.events.filter((e) => e[0] === 'linear')).toEqual([]);
  });

  it('ducks sfx −4 dB in 80 ms under a voice and lets go over 300 ms when the LAST one ends (N12)', async () => {
    const { audio, ctx, sfxDuck } = await ready();
    audio.playVoice(order('he.infantry.move'));
    const first = last(ctx.sources);
    audio.playVoice({ key: 'he.infantry.death', priority: 'kdf_death' });
    const second = last(ctx.sources);
    expect(sfxDuck.gain.events).toContainEqual(['linear', DUCK.sfx, DUCK.attackS]);
    first.onended?.();
    expect(sfxDuck.gain.events).not.toContainEqual(['linear', 1, DUCK.releaseS]);
    second.onended?.();
    expect(sfxDuck.gain.events).toContainEqual(['linear', 1, DUCK.releaseS]);
  });

  it('ducks the music element −3 dB and brings it back (N12, R-2)', async () => {
    const withMusic: AudioManifest = { ...MANIFEST, music: { gain: 0.4, tracks: [{ file: 'music/t.mp3' }] } };
    const { audio, ctx } = await ready(['he'], withMusic);
    const els = document.querySelectorAll('audio');
    const el = els[els.length - 1];
    if (!el) throw new Error('no music element');
    expect(el.volume).toBeCloseTo(0.4);
    vi.useFakeTimers();
    try {
      audio.playVoice(order('he.infantry.move'));
      vi.advanceTimersByTime(100);
      expect(el.volume).toBeCloseTo(0.4 * DUCK.music);
      last(ctx.sources).onended?.();
      vi.advanceTimersByTime(400);
      expect(el.volume).toBeCloseTo(0.4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a new order cuts the last order with a 40 ms fade (N4)', async () => {
    const { audio, ctx } = await ready();
    audio.playVoice(order('he.infantry.move'));
    const first = last(ctx.sources);
    expect(audio.playVoice(order('he.common.ack'))).toMatchObject({ status: 'played', cut: 1 });
    expect(first.stoppedAt).toBeCloseTo(VOICE_CUT_S);
    expect((first.to as FakeGain).gain.events).toContainEqual(['linear', 0, VOICE_CUT_S]);
  });

  it('holds two voices: a losing death is dropped, an order takes the oldest lowest slot (N5)', async () => {
    const { audio, ctx } = await ready(['he', 'ar']);
    audio.playVoice({ key: 'he.infantry.death', priority: 'kdf_death' });
    const oldest = last(ctx.sources);
    audio.playVoice({ key: 'he.infantry.death', priority: 'kdf_death' });
    const made = ctx.sources.length;
    expect(audio.playVoice({ key: 'ar.infantry.death', priority: 'enemy_death', at: { x: 1, y: 1 } }).status).toBe('dropped');
    expect(ctx.sources.length).toBe(made);
    expect(audio.playVoice(order('he.infantry.move'))).toMatchObject({ status: 'played', cut: 1 });
    expect(oldest.stoppedAt).toBeCloseTo(VOICE_CUT_S);
    expect(audio.voiceStats().active).toBe(2);
  });

  it('places an enemy death in the world, off the radio band, on the voice bus (R-14)', async () => {
    const { audio, ctx, hp, voice } = await ready(['he', 'ar']);
    expect(audio.playVoice({ key: 'ar.infantry.death', priority: 'enemy_death', at: { x: 3, y: 4 } }).status).toBe('played');
    const lp = last(ctx.sources).to as FakeFilter;
    expect(lp).not.toBe(hp);
    expect(lp.type).toBe('lowpass');
    const pan = lp.to as FakePanner;
    const g = pan.to as FakeGain;
    expect(g.to).toBe(voice);
    const made = ctx.sources.length;
    expect(audio.playVoice({ key: 'ar.infantry.death', priority: 'enemy_death', at: { x: 30, y: 0 } }).status).toBe('too-far');
    expect(ctx.sources.length).toBe(made);
  });

  it('the dev placeholder: one tick per line class through the same chain, only when asked (R-10)', async () => {
    const { audio, ctx, hp } = await ready();
    expect(audio.playVoice({ key: 'he.crew.death', priority: 'kdf_death' }).status).toBe('missing');
    expect(ctx.oscillators).toEqual([]);
    audio.setVoicePlaceholder(true);
    expect(audio.voiceStats().placeholder).toBe(true);
    expect(audio.playVoice({ key: 'he.crew.death', priority: 'kdf_death' })).toEqual({
      status: 'placeholder', seconds: PLACEHOLDER_S, en: null, cut: 0,
    });
    const tick = last(ctx.oscillators);
    expect(tick.frequency.value).toBe(PLACEHOLDER_HZ.death);
    expect((tick.to as FakeGain).to).toBe(hp);
    expect(tick.stoppedAt).toBeCloseTo(PLACEHOLDER_S);
    audio.playVoice(order('he.common.halt'));
    expect(last(ctx.oscillators).frequency.value).toBe(PLACEHOLDER_HZ.verb);
    // A recorded line always wins over the tick.
    const ticks = ctx.oscillators.length;
    expect(audio.playVoice(order('he.infantry.move')).status).toBe('played');
    expect(ctx.oscillators.length).toBe(ticks);
  });

  it('stopVoices fades everything out and lets go of the duck -- a mission leave', async () => {
    const { audio, ctx, sfxDuck } = await ready();
    audio.playVoice(order('he.infantry.move'));
    audio.playVoice({ key: 'he.infantry.death', priority: 'kdf_death' });
    audio.stopVoices();
    for (const s of ctx.sources) expect(s.stoppedAt).toBeCloseTo(VOICE_CUT_S);
    expect(audio.voiceStats().active).toBe(0);
    expect(sfxDuck.gain.events).toContainEqual(['linear', 1, DUCK.releaseS]);
  });
});

describe('voice decoding -- carried from Task 4 (R-9)', () => {
  it('a second manifest does not inherit the first one’s 404 memo', async () => {
    const take = '/a/voice/he/infantry/move_01a.ogg';
    let gone = true;
    const fetched = stubFetch((url) => (url === take && gone ? NOT_FOUND : OK));
    const { audio } = attachedWith((a) => {
      a.useManifest(MANIFEST, '/a/');
      a.setVoiceLanguages(['he']);
    });
    await audio.decoded();
    expect(audio.voiceStats().keys).toBe(2);
    gone = false; // the file is there now, under a manifest that was reloaded
    audio.useManifest(MANIFEST, '/a/');
    audio.setVoiceLanguages(['he']);
    await audio.decoded();
    expect(fetched.filter((u) => u === take)).toHaveLength(2);
    expect(audio.voiceStats().keys).toBe(3);
  });

  it('a thrown pass is one dev-only info line, never a warning or an error', async () => {
    stubFetch();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const throwing = (dev: boolean): Promise<void> => {
        const flaky: VoiceManifest = {};
        Object.defineProperty(flaky, 'lines', {
          get: () => {
            throw new Error('a pass that throws');
          },
        });
        const { audio } = attachedWith((a) => {
          a.useManifest({ ...MANIFEST, voices: flaky }, '/a/');
          a.setVoicePlaceholder(dev);
          a.setVoiceLanguages(['he']);
        });
        audio.setVoiceLanguages(['he']); // a second pass, which throws too
        return audio.decoded();
      };
      await throwing(false);
      expect(info).not.toHaveBeenCalled(); // not a dev session: silent
      await throwing(true);
      expect(info).toHaveBeenCalledTimes(1);
      expect(String(info.mock.calls[0]?.[0])).toMatch(/^\[voice\]/);
      expect(String(info.mock.calls[0]?.[0])).not.toMatch(/error|fail/i);
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
