// @vitest-environment jsdom
//
// jsdom for the mute test below and nothing else: `attach()` registers the
// gesture listeners on `window`, and the AudioContext this file stands in for
// is only ever built from inside one of them.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  admitVoice,
  BattleAudio,
  busGain,
  cueDuckRow,
  decodeOrder,
  DUCK,
  DUCK_TABLE,
  duckLevels,
  duckRamp,
  musicSceneGain,
  OUTCOME_CUE_BLOCK_S,
  SYNTH_CUES,
  trimGain,
  musicVolume,
  placement,
  PLACEHOLDER_HZ,
  PLACEHOLDER_S,
  RADIO_BAND_HZ,
  RADIO_FX,
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
import { buildRadioChain, clickSamples, scheduleSquelch, seededNoise, softClipCurve } from './radio';

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
/** Every node remembers the ONE node it feeds, so a test can walk a chain,
 *  and counts how often it was let go of. */
class FakeNode {
  to: unknown = null;
  disconnects = 0;
  connect<T>(n: T): T {
    this.to = n;
    return n;
  }
  disconnect(): void {
    this.to = null;
    this.disconnects++;
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
class FakeShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample = 'none';
}
class FakeCompressor extends FakeNode {
  readonly threshold = param(-24);
  readonly knee = param(30);
  readonly ratio = param(12);
  readonly attack = param(0.003);
  readonly release = param(0.25);
}
class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  readonly playbackRate = param(1);
  onended: (() => void) | null = null;
  /** `start(when, offset)`'s arguments, once it has been started. */
  startedAt: number | null = null;
  offset = 0;
  stoppedAt: number | null = null;
  start(t = 0, offset = 0): void {
    this.startedAt = t;
    this.offset = offset;
  }
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
/** A buffer `createBuffer` made: it keeps what was written into it. */
class FakeMadeBuffer {
  private readonly data: Float32Array;
  constructor(readonly length: number, readonly sampleRate: number) {
    this.data = new Float32Array(length);
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(): Float32Array {
    return this.data;
  }
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
  readonly shapers: FakeShaper[] = [];
  readonly compressors: FakeCompressor[] = [];
  readonly buffers: FakeMadeBuffer[] = [];
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
  createWaveShaper(): FakeShaper {
    const w = new FakeShaper();
    this.shapers.push(w);
    return w;
  }
  createDynamicsCompressor(): FakeCompressor {
    const c = new FakeCompressor();
    this.compressors.push(c);
    return c;
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
  createBuffer(_channels: number, n: number, rate: number): FakeMadeBuffer {
    const b = new FakeMadeBuffer(n, rate);
    this.buffers.push(b);
    return b;
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

/**
 * Every test gets its own empty storage, of the SHAPE a browser has.
 *
 * `BattleAudio` persists the mute flag to localStorage (`m` on one screen holds
 * on the next -- a product rule, not a leak), and reads it back in its
 * constructor. What jsdom hands this file for `window.localStorage` depends on
 * the Node underneath it: a bare `{}` on Node 25, where every write silently
 * goes nowhere, and a real Storage on Node 22, which CI runs. On the real one a
 * test that ends muted -- "muting mid-line stops it" does, on purpose -- muted
 * every `BattleAudio` built after it, and the whole walkie-talkie block read
 * `muted` on CI while passing locally. Installing a fresh store per test makes
 * the file order- and Node-independent, and it is the real shape, so the
 * persistence itself is still exercised rather than stubbed away.
 */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}
const STORES = ['localStorage', 'sessionStorage'] as const;
const ownStores = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  for (const name of STORES) {
    ownStores.set(name, Object.getOwnPropertyDescriptor(window, name));
    Object.defineProperty(window, name, { value: memoryStorage(), configurable: true });
  }
});

afterEach(async () => {
  // Drain first, while this test's fetch stub is still the global: an
  // in-flight pass must never reach the next test's stub.
  for (const { audio, added } of live.splice(0)) {
    await audio.decoded();
    for (const [type, fn] of added) if (fn) window.removeEventListener(type, fn);
  }
  globalThis.AudioContext = realAudioContext;
  vi.unstubAllGlobals();
  for (const name of STORES) {
    const own = ownStores.get(name);
    if (own) Object.defineProperty(window, name, own);
    else Reflect.deleteProperty(window, name);
  }
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

  it('useManifest clears voiceBudgetSkipped, so a re-registered manifest retries a key the budget kept out', async () => {
    const fetched = stubFetch();
    FakeContext.nextBuffer = { duration: 50, length: 48_000 * 50, numberOfChannels: 1 }; // 9.6 MB decoded
    const { audio } = attachedWith((a) => {
      a.useManifest(MANIFEST, '/a/');
      a.setVoiceLanguages(['he']);
    });
    await audio.decoded();
    expect(audio.voiceStats()).toMatchObject({ keys: 1, overBudget: true }); // he.infantry.move only
    const deathFile = '/a/voice/he/infantry/death_01a.ogg';
    expect(fetched.filter((u) => u === deathFile)).toHaveLength(1);
    // Nothing is freed and the roster does not change -- useManifest is the
    // only new thing here, and it must forget what the budget kept out (a new
    // manifest can name different files, or the same ones now present, R-9's
    // own reasoning for clearing voiceFailed alongside it).
    audio.useManifest(MANIFEST, '/a/');
    audio.setVoiceLanguages(['he']); // re-arm a pass; the roster itself is unchanged
    await audio.decoded();
    expect(fetched.filter((u) => u === deathFile)).toHaveLength(2);
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
  it('an announcement outranks every bark and is never cut by one (GH-110)', () => {
    expect(admitVoice([v(1, 'order'), v(2, 'kdf_death')], 'announce')).toEqual({ play: true, cut: [2] });
    expect(admitVoice([v(1, 'announce'), v(2, 'announce')], 'order')).toEqual({ play: false, cut: [] });
    expect(admitVoice([v(1, 'announce'), v(2, 'order')], 'kdf_death')).toEqual({ play: false, cut: [] });
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
    // The radio's three paths, in build order: the band alone, the walkie-
    // talkie chain's band, the static's band (two filters each).
    const [hp, , fxIn, , noiseIn] = r.ctx.filters;
    if (!sfxDuck || !voice || !hp || !fxIn || !noiseIn) throw new Error('attach() did not build the voice graph');
    return { ...r, sfxDuck, voice, hp, fxIn, noiseIn };
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

  it('a suspended context admits nothing: no-context, no caption, no slot, no duck (mirrors onEvents’ own gate)', async () => {
    const { audio, ctx, sfxDuck } = await ready();
    ctx.state = 'suspended';
    expect(audio.playVoice(order('he.infantry.move'))).toEqual({ status: 'no-context', seconds: 0, en: null, cut: 0 });
    expect(ctx.sources).toEqual([]);
    expect(ctx.oscillators).toEqual([]);
    expect(audio.voiceStats().active).toBe(0);
    expect(sfxDuck.gain.events.filter((e) => e[0] === 'linear')).toEqual([]);
  });

  it('plays an order over the radio band at the line gain, and hands back its meaning and length', async () => {
    const { audio, ctx, hp } = await ready();
    audio.setRadioEffect(false); // today's band alone; the colour is its own block below
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

  it('the duck tracks how many voices are live, not the order they end in: the SECOND ending first holds it, the FIRST ending after releases it', async () => {
    const { audio, ctx, sfxDuck } = await ready();
    audio.playVoice(order('he.infantry.move'));
    const first = last(ctx.sources);
    audio.playVoice({ key: 'he.infantry.death', priority: 'kdf_death' });
    const second = last(ctx.sources);
    expect(sfxDuck.gain.events).toContainEqual(['linear', DUCK.sfx, DUCK.attackS]);
    // The line started SECOND ends FIRST: one voice is still live, so the duck holds.
    second.onended?.();
    expect(sfxDuck.gain.events).not.toContainEqual(['linear', 1, DUCK.releaseS]);
    expect(audio.voiceStats().active).toBe(1);
    // Now the line started FIRST ends: nothing is left live, so the duck releases.
    first.onended?.();
    expect(sfxDuck.gain.events).toContainEqual(['linear', 1, DUCK.releaseS]);
    expect(audio.voiceStats().active).toBe(0);
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
    const { audio, ctx, hp, fxIn } = await ready();
    expect(audio.playVoice({ key: 'he.crew.death', priority: 'kdf_death' }).status).toBe('missing');
    expect(ctx.oscillators).toEqual([]);
    audio.setVoicePlaceholder(true);
    expect(audio.voiceStats().placeholder).toBe(true);
    expect(audio.playVoice({ key: 'he.crew.death', priority: 'kdf_death' })).toEqual({
      status: 'placeholder', seconds: PLACEHOLDER_S, en: null, cut: 0,
    });
    const tick = last(ctx.oscillators);
    expect(tick.frequency.value).toBe(PLACEHOLDER_HZ.death);
    // The same chain a recorded line takes: the walkie-talkie path, keyed up
    // with the same click, and a tick as long as ever once it starts.
    expect((tick.to as FakeGain).to).toBe(fxIn);
    expect(tick.startedAt).toBeCloseTo(RADIO_FX.clickS);
    expect(tick.stoppedAt).toBeCloseTo(RADIO_FX.clickS + PLACEHOLDER_S);
    audio.setRadioEffect(false);
    audio.playVoice({ key: 'he.crew.death', priority: 'kdf_death' });
    expect((last(ctx.oscillators).to as FakeGain).to).toBe(hp);
    expect(last(ctx.oscillators).stoppedAt).toBeCloseTo(PLACEHOLDER_S);
    audio.setRadioEffect(true);
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

  it('muting mid-line stops it and releases the duck (m is not merely a future gate)', async () => {
    const { audio, ctx, sfxDuck } = await ready();
    audio.playVoice(order('he.infantry.move'));
    const src = last(ctx.sources);
    expect(audio.toggle()).toBe(true);
    expect(src.stoppedAt).toBeCloseTo(VOICE_CUT_S);
    expect(audio.voiceStats().active).toBe(0);
    expect(sfxDuck.gain.events).toContainEqual(['linear', 1, DUCK.releaseS]);
  });

  describe('the walkie-talkie colour (N17-N20, GH-282)', () => {
    /** One unplaced line's three sources, in the order playVoice makes them. */
    const lineSources = (ctx: FakeContext, from: number) => {
      const [click, noise, line] = ctx.sources.slice(from, from + 3);
      if (!click || !noise || !line) throw new Error('fewer than three sources for one radio line');
      return { click, noise, line, clickGain: click.to as FakeGain, env: noise.to as FakeGain };
    };

    it('attach builds the three radio paths once: band, walkie-talkie chain, static band -- all into the voice bus', () => {
      const { ctx } = attached();
      const voice = ctx.gains[3];
      const [hp, lp, fxHp, fxLp, nHp, nLp] = ctx.filters;
      const [shaper] = ctx.shapers;
      const [comp] = ctx.compressors;
      if (!voice || !hp || !lp || !fxHp || !fxLp || !nHp || !nLp || !shaper || !comp) throw new Error('radio chain missing');
      expect(ctx.filters).toHaveLength(6);
      expect(ctx.shapers).toHaveLength(1);
      expect(ctx.compressors).toHaveLength(1);
      // The band alone is unchanged (N13).
      expect([hp.to, lp.to]).toEqual([lp, voice]);
      // Band -> shaper -> compressor -> makeup -> voice bus (N18).
      expect([fxHp.type, fxHp.frequency.value, fxHp.to]).toEqual(['highpass', RADIO_BAND_HZ.low, fxLp]);
      expect([fxLp.type, fxLp.frequency.value, fxLp.to]).toEqual(['lowpass', RADIO_BAND_HZ.high, shaper]);
      expect(shaper.to).toBe(comp);
      const makeup = comp.to as FakeGain;
      expect(makeup.gain.value).toBe(RADIO_FX.makeup);
      expect(makeup.to).toBe(voice);
      expect(shaper.oversample).toBe('2x');
      expect(Array.from(shaper.curve ?? [])).toEqual(Array.from(softClipCurve(RADIO_FX.curvePoints, RADIO_FX.drive)));
      const c = RADIO_FX.compressor;
      expect([comp.threshold.value, comp.knee.value, comp.ratio.value, comp.attack.value, comp.release.value]).toEqual([
        c.threshold, c.knee, c.ratio, c.attack, c.release,
      ]);
      // The static's own band, AFTER the compressor: the voice cannot pump it.
      expect([nHp.frequency.value, nHp.to, nLp.frequency.value, nLp.to]).toEqual([
        RADIO_FX.noiseBand.low, nLp, RADIO_FX.noiseBand.high, voice,
      ]);
      // The static is built once, from the seed.
      const noise = ctx.buffers.find((b) => b.length === Math.round(ctx.sampleRate * RADIO_FX.noiseSeconds));
      if (!noise) throw new Error('no static buffer');
      expect(Array.from(noise.getChannelData().slice(0, 64))).toEqual(Array.from(seededNoise(64, RADIO_FX.seed)));
    });

    it('an unplaced line, effect on: click, then the line and the static together, all through the shared paths', async () => {
      const { audio, ctx, fxIn, noiseIn } = await ready();
      const graph = [ctx.filters.length, ctx.shapers.length, ctx.compressors.length];
      ctx.currentTime = 5;
      expect(audio.playVoice(order('he.infantry.move')).status).toBe('played');
      const { click, noise, line, clickGain, env } = lineSources(ctx, 0);
      expect(ctx.sources).toHaveLength(3);
      // The line: its own gain into the walkie-talkie chain.
      expect((line.to as FakeGain).to).toBe(fxIn);
      // The click and the static: each through a one-shot gain into the static band.
      expect(click.buffer).toBe(ctx.buffers.find((b) => b.length === Math.round(ctx.sampleRate * RADIO_FX.clickS)));
      expect(clickGain.gain.value).toBe(RADIO_FX.levels.click);
      expect(clickGain.to).toBe(noiseIn);
      expect(noise.loop).toBe(true);
      expect(env.to).toBe(noiseIn);
      // Nothing shared was made for the line.
      expect([ctx.filters.length, ctx.shapers.length, ctx.compressors.length]).toEqual(graph);
    });

    it('the envelope: key-up click, 80-120 ms burst into the bed, a 150-250 ms tail, then a cut (N19, N20)', async () => {
      const { audio, ctx } = await ready();
      const t = 5;
      ctx.currentTime = t;
      audio.playVoice(order('he.infantry.move'));
      const { click, noise, line, env } = lineSources(ctx, 0);
      const fx = RADIO_FX;
      expect(fx.burstS).toBeGreaterThanOrEqual(0.08);
      expect(fx.burstS).toBeLessThanOrEqual(0.12);
      expect(fx.tailS).toBeGreaterThanOrEqual(0.15);
      expect(fx.tailS).toBeLessThanOrEqual(0.25);
      const lineAt = t + fx.clickS;
      const tailAt = lineAt + LINE_BUFFER.duration;
      const endsAt = tailAt + fx.tailS;
      expect(click.startedAt).toBe(t);
      // The line starts after the click, not with it.
      expect(line.startedAt).toBeCloseTo(lineAt);
      expect(noise.startedAt).toBeCloseTo(lineAt);
      expect(noise.stoppedAt).toBeCloseTo(endsAt);
      const L = fx.levels;
      const ev = env.gain.events.map(([m, v, at]) => [m, v, Number(at.toFixed(6))]);
      const r = (x: number): number => Number(x.toFixed(6));
      expect(ev).toEqual([
        ['set', L.burst, r(lineAt)],
        ['set', L.burst, r(lineAt + fx.burstS * fx.burstHold)],
        ['exp', L.bed, r(lineAt + fx.burstS)],
        ['set', L.bed, r(tailAt)],
        ['linear', L.tail, r(tailAt + 0.01)],
        ['set', L.tail, r(endsAt - fx.tailCutS)],
        ['linear', 0, r(endsAt)],
      ]);
      // The bed sits well under the burst and the tail.
      expect(L.bed).toBeLessThan(L.burst / 10);
      expect(L.bed).toBeLessThan(L.tail / 10);
    });

    it('a line shorter than the burst still hears the whole burst before its tail', () => {
      const ctx = new FakeContext();
      const chain = buildRadioChain(ctx as unknown as BaseAudioContext, new FakeNode() as unknown as AudioNode);
      const sq = scheduleSquelch(ctx as unknown as BaseAudioContext, chain, 2, 0.05, 0);
      expect(sq.lineAt).toBeCloseTo(2 + RADIO_FX.clickS);
      expect(sq.endsAt).toBeCloseTo(2 + RADIO_FX.clickS + RADIO_FX.burstS + RADIO_FX.tailS);
      const noise = sq.sources[1] as unknown as FakeSource;
      expect(noise.stoppedAt).toBeCloseTo(sq.endsAt);
      // The static's start point is the offset's share of the buffer, clamped.
      expect(noise.offset).toBe(0);
      const later = scheduleSquelch(ctx as unknown as BaseAudioContext, chain, 2, 1, 7);
      expect((later.sources[1] as unknown as FakeSource).offset).toBeCloseTo(RADIO_FX.noiseSeconds);
    });

    it('effect off: the band alone, no click, no static, no delay (N13 as it was)', async () => {
      const { audio, ctx, hp } = await ready();
      audio.setRadioEffect(false);
      expect(audio.radioEffect()).toBe(false);
      audio.playVoice(order('he.infantry.move'));
      expect(ctx.sources).toHaveLength(1);
      const line = last(ctx.sources);
      expect((line.to as FakeGain).to).toBe(hp);
      expect(line.startedAt).toBe(0);
    });

    it('a placed line stays clean whichever way the toggle is set: no band, no chain, no static (R-14)', async () => {
      for (const on of [true, false]) {
        const { audio, ctx, voice } = await ready(['he', 'ar']);
        audio.setRadioEffect(on);
        expect(audio.playVoice({ key: 'ar.infantry.death', priority: 'enemy_death', at: { x: 3, y: 4 } }).status).toBe('played');
        expect(ctx.sources).toHaveLength(1);
        const lp = last(ctx.sources).to as FakeFilter;
        expect(((lp.to as FakePanner).to as FakeGain).to).toBe(voice);
        expect(last(ctx.sources).startedAt).toBe(0);
      }
    });

    it('the toggle rebuilds nothing and touches no sounding line: it routes the NEXT one', async () => {
      const { audio, ctx, hp, fxIn } = await ready();
      audio.playVoice(order('he.infantry.move'));
      const first = lineSources(ctx, 0);
      const before = first.env.gain.events.length;
      const graph = [ctx.filters.length, ctx.shapers.length, ctx.compressors.length, ctx.gains.length];
      audio.setRadioEffect(false);
      expect([ctx.filters.length, ctx.shapers.length, ctx.compressors.length, ctx.gains.length]).toEqual(graph);
      expect(first.env.gain.events).toHaveLength(before);
      expect(first.noise.stoppedAt).toBeCloseTo(RADIO_FX.clickS + LINE_BUFFER.duration + RADIO_FX.tailS);
      expect((first.line.to as FakeGain).to).toBe(fxIn);
      // The next line -- here an interrupt (N4) -- goes out on the band alone.
      audio.playVoice(order('he.common.ack'));
      const next = last(ctx.sources);
      expect(ctx.sources).toHaveLength(4);
      expect((next.to as FakeGain).to).toBe(hp);
      audio.setRadioEffect(true);
      audio.playVoice(order('he.infantry.move'));
      expect((last(ctx.sources).to as FakeGain).to).toBe(fxIn);
    });

    it('every one-shot lets go of its nodes when it ends; the shared chain is never disconnected', async () => {
      const { audio, ctx, fxIn, noiseIn } = await ready();
      audio.playVoice(order('he.infantry.move'));
      const { click, noise, line, clickGain, env } = lineSources(ctx, 0);
      const lineGain = line.to as FakeGain;
      click.onended?.();
      expect([click.disconnects, clickGain.disconnects]).toEqual([1, 1]);
      line.onended?.();
      expect([line.disconnects, lineGain.disconnects]).toEqual([1, 1]);
      noise.onended?.();
      expect([noise.disconnects, env.disconnects]).toEqual([1, 1]);
      for (const shared of [...ctx.filters, ...ctx.shapers, ...ctx.compressors]) expect(shared.disconnects).toBe(0);
      expect([fxIn.to, noiseIn.to]).not.toContain(null);
    });

    it('a cut line takes its static with it: 40 ms fade, no tail, and the ended one-shots still disconnect (N4)', async () => {
      const { audio, ctx, sfxDuck } = await ready();
      audio.playVoice(order('he.infantry.move'));
      const first = lineSources(ctx, 0);
      ctx.currentTime = 0.5;
      audio.playVoice(order('he.common.ack'));
      expect(first.noise.stoppedAt).toBeCloseTo(0.5 + VOICE_CUT_S);
      expect(first.click.stoppedAt).toBeCloseTo(0.5 + VOICE_CUT_S);
      expect(first.env.gain.events.slice(-3).map((e) => e[0])).toEqual(['cancel', 'set', 'linear']);
      expect(first.env.gain.events.at(-1)).toEqual(['linear', 0, 0.5 + VOICE_CUT_S]);
      // Ending the cut line's sources releases their nodes, and not the duck
      // held by the line that replaced it.
      for (const s of [first.click, first.noise, first.line]) s.onended?.();
      expect([first.noise.disconnects, first.env.disconnects, first.line.disconnects]).toEqual([1, 1, 1]);
      expect(sfxDuck.gain.events).not.toContainEqual(['linear', 1, expect.any(Number)]);
      expect(audio.voiceStats().active).toBe(1);
    });

    it('mute and a mission leave silence the static too, not just the words', async () => {
      const { audio, ctx } = await ready();
      audio.playVoice(order('he.infantry.move'));
      const { noise } = lineSources(ctx, 0);
      audio.toggle();
      expect(noise.stoppedAt).toBeCloseTo(VOICE_CUT_S);
      audio.toggle();
      audio.playVoice(order('he.infantry.move'));
      const again = lineSources(ctx, 3);
      audio.stopVoices();
      expect(again.noise.stoppedAt).toBeCloseTo(VOICE_CUT_S);
    });

    it('a stop after the words end still silences the tail, until the squelch is over (N19)', async () => {
      const { audio, ctx } = await ready();
      audio.playVoice(order('he.infantry.move'));
      const { noise, click, line, env } = lineSources(ctx, 0);
      const endsAt = RADIO_FX.clickS + LINE_BUFFER.duration + RADIO_FX.tailS;
      // The words end; the tail is still sounding.
      ctx.currentTime = endsAt - 0.1;
      line.onended?.();
      expect(audio.voiceStats().active).toBe(0);
      audio.stopVoices();
      expect(noise.stoppedAt).toBeCloseTo(endsAt - 0.1 + VOICE_CUT_S);
      expect(click.stoppedAt).toBeCloseTo(endsAt - 0.1 + VOICE_CUT_S);
      expect(env.gain.events.at(-1)).toEqual(['linear', 0, endsAt - 0.1 + VOICE_CUT_S]);

      // Past its own end there is nothing left to cut: no second fade.
      audio.playVoice(order('he.infantry.move'));
      const later = lineSources(ctx, 3);
      ctx.currentTime = endsAt + 5;
      later.line.onended?.();
      const events = later.env.gain.events.length;
      audio.stopVoices();
      expect(later.env.gain.events).toHaveLength(events);
    });
  });
});

describe('the radio’s building blocks (N18-N20)', () => {
  it('the soft clip is odd, monotone, bounded by 1, full scale at the ends, and light: a 0.5 peak loses under 3 dB', () => {
    const c = softClipCurve(RADIO_FX.curvePoints, RADIO_FX.drive);
    expect(c).toHaveLength(RADIO_FX.curvePoints);
    expect(c[0]).toBeCloseTo(-1);
    expect(c[c.length - 1]).toBeCloseTo(1);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThan(c[i - 1] ?? -2);
    for (let i = 0; i < c.length; i++) expect(c[i]).toBeCloseTo(-(c[c.length - 1 - i] ?? 0), 6);
    const at = (x: number): number => Math.tanh(RADIO_FX.drive * x) / Math.tanh(RADIO_FX.drive);
    const lossDb = 20 * Math.log10((0.5 * (RADIO_FX.drive / Math.tanh(RADIO_FX.drive))) / at(0.5));
    expect(lossDb).toBeGreaterThan(0);
    expect(lossDb).toBeLessThan(3);
  });

  it('the static is seeded: the same samples every time, uniform in [-1, 1), not silent', () => {
    const a = seededNoise(4_800, RADIO_FX.seed);
    expect(Array.from(a)).toEqual(Array.from(seededNoise(4_800, RADIO_FX.seed)));
    expect(Array.from(a)).not.toEqual(Array.from(seededNoise(4_800, RADIO_FX.seed + 1)));
    let sq = 0;
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
      sq += v * v;
    }
    // Uniform white noise has an RMS of 1/sqrt(3).
    expect(Math.sqrt(sq / a.length)).toBeCloseTo(1 / Math.sqrt(3), 1);
  });

  it('the click is RADIO_FX.clickS long, starts on its edge and dies away', () => {
    const c = clickSamples(48_000);
    expect(c).toHaveLength(Math.round(48_000 * RADIO_FX.clickS));
    expect(Math.abs(c[0] ?? 0)).toBeGreaterThan(0.3);
    expect(Math.abs(c[c.length - 1] ?? 1)).toBeLessThan(0.01);
    expect(Array.from(clickSamples(48_000))).toEqual(Array.from(c));
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

  it('a dev build notes a thrown pass without asking for the tick', async () => {
    stubFetch();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const flaky: VoiceManifest = {};
      Object.defineProperty(flaky, 'lines', {
        get: () => {
          throw new Error('a pass that throws');
        },
      });
      const { audio } = attachedWith((a) => {
        a.useManifest({ ...MANIFEST, voices: flaky }, '/a/');
        a.setDev(true); // the app's own build flag; no `?voicetick`
        a.setVoiceLanguages(['he']);
      });
      await audio.decoded();
      expect(audio.voiceStats().placeholder).toBe(false);
      expect(info).toHaveBeenCalledTimes(1);
      expect(String(info.mock.calls[0]?.[0])).toMatch(/^\[voice\]/);
    } finally {
      info.mockRestore();
    }
  });
});


// --- polish pass F: cues, the cue bus, the ducking table, music scenes -----

describe('the ducking table (polish pass F, section 2.2)', () => {
  it('the deepest duck per layer wins, never a product; no rows is no duck', () => {
    expect(duckLevels([])).toEqual({ sfx: 1, music: 1 });
    expect(duckLevels([DUCK_TABLE.bark, DUCK_TABLE.major])).toEqual({ sfx: DUCK_TABLE.major.sfx, music: DUCK_TABLE.major.music });
    expect(duckLevels([DUCK_TABLE.bark, DUCK_TABLE.cue])).toEqual({ sfx: DUCK_TABLE.bark.sfx, music: DUCK_TABLE.cue.music });
    expect(duckLevels([DUCK_TABLE.pause]).sfx).toBe(1);
  });

  it('the rows say what the plan says, in dB', () => {
    const db = (g: number): number => Math.round(20 * Math.log10(g));
    expect([db(DUCK_TABLE.bark.sfx), db(DUCK_TABLE.bark.music)]).toEqual([-4, -3]);
    expect([db(DUCK_TABLE.announce.sfx), db(DUCK_TABLE.announce.music)]).toEqual([-6, -6]);
    expect([db(DUCK_TABLE.cue.sfx), db(DUCK_TABLE.cue.music)]).toEqual([-3, -3]);
    expect([db(DUCK_TABLE.major.sfx), db(DUCK_TABLE.major.music)]).toEqual([-6, -6]);
    expect([DUCK_TABLE.outcome.sfx, DUCK_TABLE.outcome.music, DUCK_TABLE.outcome.attackS]).toEqual([0, 0, 0.6]);
    expect(db(DUCK_TABLE.pause.music)).toBe(-6);
    // No pumping: every release is 250 ms or longer.
    for (const row of Object.values(DUCK_TABLE)) expect(row.releaseS).toBeGreaterThanOrEqual(0.25);
  });

  it('a cue id brings its row: objective and important alert -3, major -6, outcome the fade', () => {
    expect(cueDuckRow('objective.complete')).toBe('cue');
    expect(cueDuckRow('objective.failed')).toBe('cue');
    expect(cueDuckRow('alert.important')).toBe('cue');
    expect(cueDuckRow('alert.major')).toBe('major');
    expect(cueDuckRow('outcome.defeat')).toBe('outcome');
    expect(cueDuckRow('alert.minor')).toBeNull();
    expect(cueDuckRow('ui.confirm')).toBeNull();
  });
});

describe('music scenes (A10) and the track trim', () => {
  it('a mission plays the music at battle_gain, the menu at gain, and no battle_gain reads as gain', () => {
    expect(musicSceneGain({ gain: 0.4, battle_gain: 0.26 }, 'battle')).toBe(0.26);
    expect(musicSceneGain({ gain: 0.4, battle_gain: 0.26 }, 'menu')).toBe(0.4);
    expect(musicSceneGain({ gain: 0.4 }, 'battle')).toBe(0.4);
  });
  it('trim_db is a level in dB; absent is unity', () => {
    expect(trimGain(undefined)).toBe(1);
    expect(trimGain(-1.2)).toBeCloseTo(0.871, 3);
  });
  it('the shipped manifest asks for 0.26 in battle, 0.4 on the menu, and trims the theme to -1 dBTP', async () => {
    const shipped = (await import('../../../data/audio.json')).default as AudioManifest;
    expect(shipped.music?.gain).toBe(0.4);
    expect(shipped.music?.battle_gain).toBe(0.26);
    expect(shipped.music?.tracks?.[0]?.trim_db).toBeCloseTo(-1.2);
  });
  it('setMusicScene steps the element to the battle level over 2 s, trim included, and back', () => {
    const m: AudioManifest = { master_gain: 1, music: { gain: 0.4, battle_gain: 0.26, tracks: [{ file: 'music/t.mp3', trim_db: -6 }] } };
    const { audio } = attachedWith((a) => a.useManifest(m, '/a/'));
    const els = document.querySelectorAll('audio');
    const el = els[els.length - 1];
    if (!el) throw new Error('no music element');
    const half = trimGain(-6);
    expect(el.volume).toBeCloseTo(0.4 * half);
    vi.useFakeTimers();
    try {
      audio.setMusicScene('battle');
      vi.advanceTimersByTime(1000);
      expect(el.volume).toBeGreaterThan(0.26 * half);
      expect(el.volume).toBeLessThan(0.4 * half);
      vi.advanceTimersByTime(1100);
      expect(el.volume).toBeCloseTo(0.26 * half);
      expect(audio.musicSceneNow()).toBe('battle');
      audio.setMusicScene('menu');
      vi.advanceTimersByTime(2100);
      expect(el.volume).toBeCloseTo(0.4 * half);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('playCue (polish pass F, AU-1, AU-4)', () => {
  const CUE_MANIFEST: AudioManifest = {
    master_gain: 1,
    music: { gain: 0.4, battle_gain: 0.26, tracks: [{ file: 'music/t.mp3' }] },
    sets: {
      objective_complete: { event: 'ui', variants: [] },
      objective_failed: { event: 'ui', variants: [] },
      objective_new: { event: 'ui', variants: [] },
      alert_minor: { event: 'ui', variants: [] },
      alert_important: { event: 'ui', variants: [] },
      alert_major: { event: 'ui', variants: [] },
      victory: { event: 'ui', variants: [] },
      ui_deny: { event: 'ui', variants: [] },
    },
    cues: {
      $comment: 'ignored',
      'objective.complete': 'objective_complete',
      'objective.failed': 'objective_failed',
      'objective.active': 'objective_new',
      'alert.minor': 'alert_minor',
      'alert.important': 'alert_important',
      'alert.major': 'alert_major',
      'outcome.victory': 'victory',
      'ui.deny': 'ui_deny',
      'ui.hover': { silent: 'hover is never a sound (A8)' },
    },
  };
  const graph = (ctx: FakeContext) => {
    const [master, , sfxDuck, voice] = ctx.gains;
    const cueBus = ctx.gains.find((g) => g.to === master && g !== sfxDuck && g !== voice);
    if (!master || !sfxDuck || !cueBus) throw new Error('attach() built no cue bus');
    return { master, sfxDuck, cueBus };
  };
  const freqs = (ctx: FakeContext): number[] =>
    ctx.oscillators.map((o) => (o as { frequency: { value: number } }).frequency.value);

  it('resolves the id through the manifest, says when it is unmapped or deliberately silent, and is safe before attach', () => {
    expect(new BattleAudio().playCue('alert.minor')).toBe('unmapped');
    const { audio, ctx } = attachedWith((a) => a.useManifest(CUE_MANIFEST, '/a/'));
    expect(audio.playCue('alert.minor')).toBe('played');
    expect(ctx.oscillators.length).toBeGreaterThan(0);
    const made = ctx.oscillators.length;
    expect(audio.playCue('ui.hover')).toBe('silent');
    expect(audio.playCue('no.such.cue')).toBe('unmapped');
    expect(audio.playCue('$comment')).toBe('unmapped');
    expect(ctx.oscillators.length).toBe(made);
  });

  it('a cue sounds on the cue bus, straight into the master and never through the sfx duck', () => {
    const { audio, ctx } = attachedWith((a) => a.useManifest(CUE_MANIFEST, '/a/'));
    const { master, sfxDuck, cueBus } = graph(ctx);
    audio.playCue('alert.minor');
    const tone = ctx.oscillators[0]?.to as FakeGain;
    expect(tone.to).toBe(cueBus);
    expect(cueBus.to).toBe(master);
    expect(tone.to).not.toBe(sfxDuck);
  });

  it('the cue bus rides the SFX slider', () => {
    const { audio, ctx } = attachedWith((a) => a.useManifest(CUE_MANIFEST, '/a/'));
    const { cueBus } = graph(ctx);
    audio.setGains({ master: 1, music: 1, sfx: 0.3 });
    expect(cueBus.gain.value).toBe(0.3);
  });

  it('a recorded clip plays at its set gain on the cue bus', async () => {
    stubFetch();
    const m: AudioManifest = {
      ...CUE_MANIFEST,
      sets: { ...CUE_MANIFEST.sets, alert_minor: { event: 'ui', gain: 0.25, variants: [{ file: 'alert_minor/alert_minor_01.ogg' }] } },
    };
    const { audio, ctx } = attachedWith((a) => a.useManifest(m, '/a/'));
    await audio.decoded();
    const { cueBus } = graph(ctx);
    expect(audio.playCue('alert.minor')).toBe('played');
    const g = ctx.sources.at(-1)?.to as FakeGain;
    expect(g.gain.value).toBe(0.25);
    expect(g.to).toBe(cueBus);
  });

  it('every cue the synth stands in for keeps its shape: complete rises, failed falls, new is level; alerts are one, two, three notes', () => {
    vi.useFakeTimers();
    try {
      const { audio, ctx } = attachedWith((a) => a.useManifest(CUE_MANIFEST, '/a/'));
      const play = (id: string): number[] => {
        ctx.oscillators.length = 0;
        audio.playCue(id);
        vi.advanceTimersByTime(1000);
        return freqs(ctx);
      };
      const up = play('objective.complete');
      expect(up[1]).toBeGreaterThan(up[0] ?? Infinity);
      const down = play('objective.failed');
      expect(down[1]).toBeLessThan(down[0] ?? 0);
      const level = play('objective.active');
      expect(level[1]).toBe(level[0]);
      expect(play('alert.minor')).toHaveLength(1);
      expect(play('alert.important')).toHaveLength(2);
      expect(play('alert.major')).toHaveLength(3);
      // No two of the objective shapes are the same sound.
      expect(new Set([up.join(), down.join(), level.join()]).size).toBe(3);
      for (const name of ['ui_confirm', 'ui_deny', 'mission_start', 'victory', 'defeat', 'objective_new']) {
        expect(SYNTH_CUES[name]?.length ?? 0).toBeGreaterThan(0);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('an objective cue holds combat 3 dB down for its length, then lets go', () => {
    vi.useFakeTimers();
    try {
      const { audio, ctx } = attachedWith((a) => a.useManifest(CUE_MANIFEST, '/a/'));
      const { sfxDuck } = graph(ctx);
      audio.playCue('objective.complete');
      expect(sfxDuck.gain.events).toContainEqual(['linear', DUCK_TABLE.cue.sfx, DUCK_TABLE.cue.attackS]);
      expect(sfxDuck.gain.events).not.toContainEqual(['linear', 1, DUCK_TABLE.cue.releaseS]);
      vi.advanceTimersByTime(1000);
      expect(sfxDuck.gain.events).toContainEqual(['linear', 1, DUCK_TABLE.cue.releaseS]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a major alert ducks deeper than an important one, and a minor alert not at all', () => {
    vi.useFakeTimers();
    try {
      const { audio, ctx } = attachedWith((a) => a.useManifest(CUE_MANIFEST, '/a/'));
      const { sfxDuck } = graph(ctx);
      audio.playCue('alert.minor');
      expect(sfxDuck.gain.events.filter((e) => e[0] === 'linear')).toEqual([]);
      audio.playCue('alert.major');
      expect(sfxDuck.gain.events).toContainEqual(['linear', DUCK_TABLE.major.sfx, DUCK_TABLE.major.attackS]);
      expect(DUCK_TABLE.major.sfx).toBeLessThan(DUCK_TABLE.cue.sfx);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a voice line never ducks a cue: the duck is on the sfx path, and the cue is not on it', async () => {
    stubFetch();
    const { audio, ctx } = attachedWith((a) => {
      a.useManifest({ ...CUE_MANIFEST, voices: MANIFEST.voices }, '/a/');
      a.setVoiceLanguages(['he']);
    });
    await vi.waitFor(() => expect(audio.voiceStats().keys).toBe(3));
    const { sfxDuck, cueBus } = graph(ctx);
    audio.playVoice({ key: 'he.infantry.move', priority: 'order' });
    expect(sfxDuck.gain.events).toContainEqual(['linear', DUCK.sfx, DUCK.attackS]);
    audio.playCue('objective.complete');
    expect(cueBus.gain.events.filter((e) => e[0] === 'linear')).toEqual([]);
  });

  it('the outcome stops every voice, fades combat and music out, and holds every other cue off for 3 s', async () => {
    stubFetch();
    const { audio, ctx } = attachedWith((a) => {
      a.useManifest({ ...CUE_MANIFEST, voices: MANIFEST.voices }, '/a/');
      a.setVoiceLanguages(['he']);
    });
    await vi.waitFor(() => expect(audio.voiceStats().keys).toBe(3));
    const { sfxDuck } = graph(ctx);
    audio.playVoice({ key: 'he.infantry.move', priority: 'order' });
    expect(audio.voiceStats().active).toBe(1);
    vi.useFakeTimers();
    try {
      expect(audio.playCue('outcome.victory')).toBe('played');
      expect(audio.voiceStats().active).toBe(0);
      expect(sfxDuck.gain.events).toContainEqual(['linear', 0, DUCK_TABLE.outcome.attackS]);
      expect(audio.playCue('alert.important')).toBe('blocked');
      ctx.currentTime = OUTCOME_CUE_BLOCK_S + 0.01;
      expect(audio.playCue('alert.important')).toBe('played');
      audio.leaveMission();
      expect(sfxDuck.gain.events.at(-1)?.[1]).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaveMission lets every hold go: combat back to full, music back to the menu level', () => {
    vi.useFakeTimers();
    try {
      const { audio, ctx } = attachedWith((a) => a.useManifest(CUE_MANIFEST, '/a/'));
      const { sfxDuck } = graph(ctx);
      audio.setMusicScene('battle');
      audio.playCue('alert.major');
      audio.setPaused(true);
      audio.leaveMission();
      expect(sfxDuck.gain.events.at(-1)?.[1]).toBe(1);
      expect(audio.musicSceneNow()).toBe('menu');
    } finally {
      vi.useRealTimers();
    }
  });

  it('pause stops every voice and steps the music 6 dB down until the menu closes', async () => {
    stubFetch();
    const { audio, ctx } = attachedWith((a) => {
      a.useManifest({ ...CUE_MANIFEST, voices: MANIFEST.voices }, '/a/');
      a.setVoiceLanguages(['he']);
    });
    await vi.waitFor(() => expect(audio.voiceStats().keys).toBe(3));
    const els = document.querySelectorAll('audio');
    const el = els[els.length - 1];
    if (!el) throw new Error('no music element');
    audio.playVoice({ key: 'he.infantry.move', priority: 'order' });
    vi.useFakeTimers();
    try {
      // Let the bark's own duck settle first, so the reading below is the pause's.
      ctx.sources.at(-1)?.onended?.();
      vi.advanceTimersByTime(400);
      expect(el.volume).toBeCloseTo(0.4);
      audio.playVoice({ key: 'he.infantry.move', priority: 'order' });
      audio.setPaused(true);
      expect(audio.voiceStats().active).toBe(0);
      vi.advanceTimersByTime(400);
      expect(el.volume).toBeCloseTo(0.4 * DUCK_TABLE.pause.music);
      audio.setPaused(false);
      vi.advanceTimersByTime(400);
      expect(el.volume).toBeCloseTo(0.4);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ui:routes `voices (b)` on PR 426: the shipped ack read `placeholder` 83 s
// after the first gesture. Pass F put eleven more `ui` sets ahead of the voices,
// and `decodeAll` decoded them ONE AT A TIME before a single voice was asked
// for; under SwiftShader every await costs a frame, so thirteen sequential
// fetch+decode rounds kept every line silent for most of a mission. Here each
// fetch takes one 100 ms "frame": a roster line must be decoded within a few
// of them, however many ui cues the manifest declares.
describe('decode latency: ui cues never hold the voices back', () => {
  it('with thirteen ui sets, the first voice line decodes in a frame or two, not after all of them', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', (_url: string) => new Promise((r) => setTimeout(() => r(OK), 100)));
      const sets: Record<string, AudioSet> = {};
      for (let i = 0; i < 13; i++) sets[`cue_${i}`] = { event: 'ui', variants: [{ file: `cue_${i}/c.ogg` }] };
      const { audio } = attachedWith((a) => {
        a.useManifest({ ...MANIFEST, sets }, '/a/');
        a.setVoiceLanguages(['he']);
      });
      await vi.advanceTimersByTimeAsync(250);
      expect(audio.voiceStats().keys).toBeGreaterThanOrEqual(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(audio.voiceStats().keys).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
