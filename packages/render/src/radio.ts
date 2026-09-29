// The radio net's sound (WP-AU1 N13, N17-N20; GH-282).
//
// Every UNPLACED voice line -- an order answered, a KDF death called in -- is
// the radio in the player's ear, and passes through the band (N13). With the
// walkie-talkie colour on (N17, the default) it also picks up a small
// speaker's crunch, heavy compression, a key-up click, a burst of static as
// the squelch opens, a faint noise bed under the words and a squelch tail
// that cuts off when the sender lets go of the key. All of it is applied at
// PLAYBACK: the voice files stay clean (`tools/voice_prep.py` only trims and
// levels them), so the same take can play clean the day a placed line or a
// cutscene wants it.
//
// This file imports nothing, on purpose: `tools/src/audio/radio-clips.ts`
// loads it into a bare headless page and renders the before/after clips
// through an OfflineAudioContext, so what the lead listens to is this code
// and not an approximation of it.
//
// Presentation only (invariant 4). The static is built from a seeded
// generator rather than Math.random so tests and clips are stable; which
// stretch of it a line plays is chosen by the caller's presentation PRNG.

/** The radio band every unplaced line passes through, in Hz (N13). */
export const RADIO_BAND_HZ = { low: 300, high: 3400 } as const;

/**
 * The walkie-talkie colour's numbers (N17-N20). Every level is a linear gain
 * MEASURED, not guessed: rendered by `tools/src/audio/radio-clips.ts` in
 * headless Chromium through this file, with `he/infantry/move_01a` at the
 * manifest's line gain 0.8 and master 0.9, loudness by ffmpeg's ebur128
 * (2026-09-29). RMS figures below are over the words (0.33-0.95 s of that
 * clip), not over the silence round them.
 */
export const RADIO_FX = {
  /** Soft-clip steepness: the curve is tanh(k x) / tanh(k) (N18). k = 2 is
   *  a light crunch: about 2.4 dB off a 0.5 peak, +6 dB at small signal. */
  drive: 2,
  /** Points in the shaper's curve; one table, built once per context. */
  curvePoints: 2048,
  /** After the band and the shaper: fast attack, high ratio (N18). */
  compressor: { threshold: -30, knee: 6, ratio: 12, attack: 0.002, release: 0.1 },
  /** Output trim after the compressor, so the coloured line lands at the
   *  clean band's loudness and N10/N11's mix does not move (N18): the band
   *  alone reads -21.9 LUFS, the chain at 0.81 -21.9 LUFS (at 0.5, -26.1).
   *  Chromium's compressor adds its own makeup, which this trim includes. */
  makeup: 0.81,
  /** The key-up click; the line itself starts when it ends (N19). */
  clickS: 0.012,
  /** The static burst as the squelch opens, decaying into the bed (N19). */
  burstS: 0.1,
  /** The share of the burst held at full level before it decays. */
  burstHold: 0.6,
  /** The squelch tail after the last word, then a hard cut (N19). */
  tailS: 0.2,
  /** The tail's cut-off: short enough to read as a cut, long enough not
   *  to be a digital click of its own. */
  tailCutS: 0.004,
  /** The noise path's own band, narrower than the voice's: radio hiss has
   *  no bottom octave (N20). */
  noiseBand: { low: 500, high: 3000 },
  /** Linear gains on the band-limited static (unity reads -11.2 LUFS).
   *  Measured against the words' RMS (-19.6 dBFS): `bed` -34.0 dB (N20
   *  asks -30..-36), `burst` -9.4 dB, `tail` -10.4 dB (N19); `click` scales
   *  the key-up transient, peaking at -14.5 dBFS against the words' -9.5. */
  levels: { click: 0.25, burst: 0.15, bed: 0.0085, tail: 0.13 },
  /** Seconds of static in the shared buffer: longer than any line plus its
   *  squelch (N9 caps a line at 1.8 s). The source loops and starts at a
   *  random offset, so a line can still wrap past the end mid-line; that is
   *  harmless, because white noise has no seam to hear. */
  noiseSeconds: 2.5,
  /** The static's seed. Any fixed value; fixed so a test or clip is stable. */
  seed: 0x2f6b_a3c1,
} as const;

export type RadioLevels = { click: number; burst: number; bed: number; tail: number };

/** tanh(k x) / tanh(k) over [-1, 1]: a gentle soft clip that leaves full
 *  scale at full scale. Odd, monotone and bounded by 1. */
export function softClipCurve(points: number, k: number): Float32Array<ArrayBuffer> {
  const c = new Float32Array(points);
  const norm = Math.tanh(k);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

/** Uniform white noise in [-1, 1) from xorshift32: the same seed, the same
 *  samples, on every machine. */
export function seededNoise(n: number, seed: number): Float32Array<ArrayBuffer> {
  const d = new Float32Array(n);
  let x = seed | 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    d[i] = (x >>> 0) / 0x8000_0000 - 1;
  }
  return d;
}

/** The key-up click: a sharp edge ringing briefly near 1.8 kHz with a little
 *  grit, gone in `RADIO_FX.clickS`. Deterministic. */
export function clickSamples(sampleRate: number): Float32Array<ArrayBuffer> {
  const n = Math.max(1, Math.round(sampleRate * RADIO_FX.clickS));
  const grit = seededNoise(n, RADIO_FX.seed ^ 0x5a5a_5a5a);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t / 0.0018);
    d[i] = env * (0.7 * Math.sin(2 * Math.PI * 1800 * t + Math.PI / 2) + 0.3 * grit[i]);
  }
  return d;
}

/** The radio's shared nodes, built once per context (N13, N17). */
export interface RadioChain {
  /** Today's band alone: HP -> LP -> out. The effect-off path. */
  clean: AudioNode;
  /** The walkie-talkie path: HP -> LP -> shaper -> compressor -> makeup -> out. */
  fx: AudioNode;
  /** The static's own band: HP -> LP -> out, after the compressor on purpose,
   *  so the voice cannot pump the bed and its level stays where it was set. */
  noise: AudioNode;
  noiseBuffer: AudioBuffer;
  clickBuffer: AudioBuffer;
}

function band(ctx: BaseAudioContext, low: number, high: number): [BiquadFilterNode, BiquadFilterNode] {
  // Two filters, not one bandpass, because a single biquad is not flat
  // across 300-3400.
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = low;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = high;
  hp.connect(lp);
  return [hp, lp];
}

/** Build the three radio paths into `out` (the voice bus). One set per
 *  context: no line ever makes a filter, shaper or compressor of its own. */
export function buildRadioChain(ctx: BaseAudioContext, out: AudioNode): RadioChain {
  const [cleanIn, cleanLp] = band(ctx, RADIO_BAND_HZ.low, RADIO_BAND_HZ.high);
  cleanLp.connect(out);

  const [fxIn, fxLp] = band(ctx, RADIO_BAND_HZ.low, RADIO_BAND_HZ.high);
  const shaper = ctx.createWaveShaper();
  shaper.curve = softClipCurve(RADIO_FX.curvePoints, RADIO_FX.drive);
  shaper.oversample = '2x';
  const comp = ctx.createDynamicsCompressor();
  const c = RADIO_FX.compressor;
  comp.threshold.value = c.threshold;
  comp.knee.value = c.knee;
  comp.ratio.value = c.ratio;
  comp.attack.value = c.attack;
  comp.release.value = c.release;
  const makeup = ctx.createGain();
  makeup.gain.value = RADIO_FX.makeup;
  fxLp.connect(shaper).connect(comp).connect(makeup).connect(out);

  const [noiseIn, noiseLp] = band(ctx, RADIO_FX.noiseBand.low, RADIO_FX.noiseBand.high);
  noiseLp.connect(out);

  const sr = ctx.sampleRate;
  const n = Math.round(sr * RADIO_FX.noiseSeconds);
  const noiseBuffer = ctx.createBuffer(1, n, sr);
  noiseBuffer.getChannelData(0).set(seededNoise(n, RADIO_FX.seed));
  const click = clickSamples(sr);
  const clickBuffer = ctx.createBuffer(1, click.length, sr);
  clickBuffer.getChannelData(0).set(click);

  return { clean: cleanIn, fx: fxIn, noise: noiseIn, noiseBuffer, clickBuffer };
}

/** One line's squelch: the per-line one-shots, and when the line starts. */
export interface Squelch {
  /** When the line itself should start: the click's end (N19). */
  lineAt: number;
  /** When the last of the squelch has sounded (the tail's cut). */
  endsAt: number;
  /** The click and the static, each disconnecting itself when it ends. */
  sources: AudioBufferSourceNode[];
  /** The static's envelope: burst -> bed -> tail -> cut. */
  env: GainNode;
  /** Cut the squelch short: fade over `fadeS` from `t` and stop. A cut line
   *  gets no tail -- the line replacing it keys up with its own click. */
  cut(t: number, fadeS: number): void;
}

/**
 * Schedule one line's click, burst, bed and tail into `chain.noise`, starting
 * at `t`, for a line `seconds` long. `offset` (0..1) picks where in the
 * shared static this line's stretch begins. Every node made here is a
 * one-shot that disconnects itself when it ends: nothing outlives the line.
 */
export function scheduleSquelch(
  ctx: BaseAudioContext,
  chain: RadioChain,
  t: number,
  seconds: number,
  offset: number,
  levels: RadioLevels = RADIO_FX.levels
): Squelch {
  const fx = RADIO_FX;
  const lineAt = t + fx.clickS;
  // A line shorter than the burst still hears the whole burst.
  const tailAt = lineAt + Math.max(seconds, fx.burstS);
  const endsAt = tailAt + fx.tailS;

  const click = ctx.createBufferSource();
  click.buffer = chain.clickBuffer;
  // The click's level: a one-shot gain that disconnects with the click.
  const cg = ctx.createGain();
  cg.gain.value = levels.click;
  click.connect(cg).connect(chain.noise);
  click.onended = () => {
    click.disconnect();
    cg.disconnect();
  };
  click.start(t);

  const noise = ctx.createBufferSource();
  noise.buffer = chain.noiseBuffer;
  noise.loop = true;
  const env = ctx.createGain();
  const g = env.gain;
  g.value = 0;
  g.setValueAtTime(levels.burst, lineAt);
  g.setValueAtTime(levels.burst, lineAt + fx.burstS * fx.burstHold);
  g.exponentialRampToValueAtTime(Math.max(levels.bed, 1e-4), lineAt + fx.burstS);
  g.setValueAtTime(Math.max(levels.bed, 1e-4), tailAt);
  g.linearRampToValueAtTime(levels.tail, tailAt + 0.01);
  g.setValueAtTime(levels.tail, endsAt - fx.tailCutS);
  g.linearRampToValueAtTime(0, endsAt);
  noise.connect(env).connect(chain.noise);
  noise.onended = () => {
    noise.disconnect();
    env.disconnect();
  };
  const dur = chain.noiseBuffer.duration;
  noise.start(lineAt, Math.max(0, Math.min(1, offset)) * dur);
  noise.stop(endsAt);

  return {
    lineAt,
    endsAt,
    sources: [click, noise],
    env,
    cut(at, fadeS) {
      g.cancelScheduledValues(at);
      g.setValueAtTime(g.value, at);
      g.linearRampToValueAtTime(0, at + fadeS);
      noise.stop(at + fadeS);
      click.stop(at + fadeS);
    },
  };
}
