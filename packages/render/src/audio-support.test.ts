// @vitest-environment jsdom
//
// GH-782: the fire-support sounds on a recording stand-in for WebAudio, against
// the SHIPPED `sets` and `support_air` of data/audio.json. Three things are
// proved here: a `strike` event is voiced by the set that claims its profile
// (and FIRST in its tick); the jet, the Peten's rotor and the barrage's
// whistles follow a `SupportAirPlan` on the sim clock; and mute, pause and
// teardown hold all of it. The schedule's arithmetic is checked against
// literals (the sim's FIRE_SUPPORT numbers: first round 3000 / 6000 ms, rounds
// 1800 ms apart, the jet over the aim point 400 ms before the bomb).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sim, SimEvent } from '@lions/sim';
import { BLAST_WEIGHT, BattleAudio, blastEnergy, placement, type AudioManifest, type AudioSet } from './audio';
import { jetStartMs, planEndMs, roundCount, roundImpactMs, whistleStartMs } from './support-voices';
import { makeSupportAirPlan, planSpanMs, supportAirPose } from './three/support-air';
import audioManifest from '../../../data/audio.json';

const SHIPPED = audioManifest as unknown as AudioManifest;
const SETS = SHIPPED.sets ?? {};
/** The decoded length of each shipped file, by the set it is in: measured with ffprobe at landing. */
const DURATION: [RegExp, number][] = [
  [/barrage_impact/, 2.5],
  [/strike_impact/, 5.0],
  [/jet_flyby/, 5.0],
  [/incoming_whistle_01/, 3.37],
  [/incoming_whistle_02/, 3.88],
  [/rotor_loop/, 5.805],
];
const durationOf = (file: string): number => DURATION.find(([re]) => re.test(file))?.[1] ?? 1;

const manifestWith = (sets: Record<string, AudioSet>, support = true): AudioManifest => ({
  master_gain: 0.9,
  sets,
  ...(support && SHIPPED.support_air ? { support_air: SHIPPED.support_air } : {}),
});
const pick = (...names: string[]): Record<string, AudioSet> => Object.fromEntries(names.map((n) => [n, SETS[n] as AudioSet]));
const ALL_SUPPORT = pick('barrage_impact', 'strike_impact', 'jet_flyby', 'incoming_whistle');

interface FakeParam {
  value: number;
  target: number | null;
  readonly events: [string, number, number][];
  setValueAtTime(v: number, t: number): void;
  linearRampToValueAtTime(v: number, t: number): void;
  setTargetAtTime(v: number, t: number, tau: number): void;
  exponentialRampToValueAtTime(v: number, t: number): void;
  cancelScheduledValues(t: number): void;
}
function param(value: number): FakeParam {
  const p: FakeParam = {
    value,
    target: null,
    events: [],
    setValueAtTime: (v, t) => void p.events.push(['set', v, t]),
    linearRampToValueAtTime: (v, t) => void p.events.push(['linear', v, t]),
    setTargetAtTime: (v, t) => {
      p.target = v;
      p.events.push(['target', v, t]);
    },
    exponentialRampToValueAtTime: (v, t) => void p.events.push(['exp', v, t]),
    cancelScheduledValues: (t) => void p.events.push(['cancel', 0, t]),
  };
  return p;
}
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
}
class FakePanner extends FakeNode {
  readonly pan = param(0);
}
class FakeSource extends FakeNode {
  buffer: { duration: number; file?: string } | null = null;
  loop = false;
  readonly playbackRate = param(1);
  onended: (() => void) | null = null;
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
  /** A source "ended on its own" the way WebAudio fires it. */
  end(): void {
    this.onended?.();
  }
}
class FakeContext {
  static made: FakeContext[] = [];
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
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
    return new FakeFilter();
  }
  createStereoPanner(): FakePanner {
    return new FakePanner();
  }
  createWaveShaper(): FakeNode & { curve: null; oversample: string } {
    return Object.assign(new FakeNode(), { curve: null, oversample: 'none' });
  }
  createDynamicsCompressor(): FakeNode {
    return Object.assign(new FakeNode(), { threshold: param(0), knee: param(0), ratio: param(0), attack: param(0), release: param(0) });
  }
  createOscillator(): FakeSource {
    return Object.assign(new FakeSource(), { type: '', frequency: param(0) });
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBuffer(_c: number, n: number, rate: number): { duration: number; getChannelData(): Float32Array } {
    const data = new Float32Array(n);
    return { duration: n / rate, getChannelData: () => data };
  }
  decodeAudioData(ab: ArrayBuffer & { file?: string }): Promise<{ duration: number; file?: string }> {
    return Promise.resolve({ duration: durationOf(ab.file ?? ''), file: ab.file });
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

const realAudioContext = globalThis.AudioContext;
const live: { audio: BattleAudio; added: [string, EventListenerOrEventListenerObject][] }[] = [];

function attached(manifest: AudioManifest): { audio: BattleAudio; ctx: FakeContext } {
  FakeContext.made.length = 0;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  vi.stubGlobal('fetch', async (url: string) => ({ ok: true, arrayBuffer: async () => Object.assign(new ArrayBuffer(4), { file: url }) }));
  const audio = new BattleAudio();
  audio.useManifest(manifest, '/audio/');
  const spy = vi.spyOn(window, 'addEventListener');
  try {
    audio.attach();
    window.dispatchEvent(new KeyboardEvent('keydown'));
  } finally {
    const added = spy.mock.calls.map(([type, fn]) => [type, fn] as [string, EventListenerOrEventListenerObject]);
    spy.mockRestore();
    live.push({ audio, added });
  }
  const ctx = FakeContext.made[0];
  if (!ctx) throw new Error('no context');
  return { audio, ctx };
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

/** A mixer with every support set decoded (and the rotor, when the manifest has one), the camera on the aim point. */
async function ready(manifest: AudioManifest = manifestWith(ALL_SUPPORT), listener = { x: 20, y: 20 }) {
  const r = attached(manifest);
  r.audio.setListener(listener);
  await flush();
  return r;
}

/** A stand-in sim: just the tick counter and the empty arrays `onEvents` and `updateEngines` read. */
function fakeSim(tick: number): Sim {
  return {
    tickCount: tick,
    entityCount: 0,
    unitTypes: [],
    state: { side: new Uint8Array(4), posX: new Int32Array(4), posY: new Int32Array(4), typeIdx: new Uint16Array(4), alive: new Uint8Array(4) },
  } as unknown as Sim;
}
/** One sim tick at `ms`: the context clock follows the sim clock, then the voices step. */
function tickAt(audio: BattleAudio, ctx: FakeContext, ms: number): void {
  ctx.currentTime = ms / 1000;
  audio.updateEngines(fakeSim(ms / 50), () => true);
}
/** Run ticks from `from` to `to` ms inclusive, every 50 ms. */
function run(audio: BattleAudio, ctx: FakeContext, from: number, to: number): void {
  for (let ms = from; ms <= to; ms += 50) tickAt(audio, ctx, ms);
}

const fixed = (tiles: number): number => Math.round(tiles * 65536);
const strike = (profile: number, x: number, y: number, by = 0): SimEvent => ({ kind: 'strike', tick: 1, by, x: fixed(x), y: fixed(y), profile }) as SimEvent;

/** Walk `to` from a node to wherever it leads. */
function chain(node: unknown): unknown[] {
  const out: unknown[] = [];
  let cur = node as FakeNode | null;
  while (cur && out.length < 12) {
    out.push(cur);
    cur = cur.to as FakeNode | null;
  }
  return out;
}
const clips = (ctx: FakeContext): FakeSource[] => ctx.sources.filter((s) => s.buffer?.file !== undefined);
const fileOf = (s: FakeSource): string => s.buffer?.file ?? '';
const clipsOf = (ctx: FakeContext, set: string): FakeSource[] => clips(ctx).filter((s) => fileOf(s).includes(`/${set}/`));
/** The level GainNode of a clip: source -> low-pass -> pan -> LEVEL. */
const levelOf = (s: FakeSource): FakeGain => chain(s)[3] as FakeGain;
const panOf = (s: FakeSource): FakePanner => chain(s)[2] as FakePanner;

beforeEach(() => {
  const data = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  });
});
afterEach(() => {
  for (const { audio, added } of live.splice(0)) {
    audio.dispose();
    for (const [type, fn] of added) window.removeEventListener(type, fn);
  }
  globalThis.AudioContext = realAudioContext;
  vi.unstubAllGlobals();
});

// --- the sim's schedule, as literals -------------------------------------------
describe('the schedule (the sim FIRE_SUPPORT rows, as literals)', () => {
  const barrage = makeSupportAirPlan('barrage', 0, 20, 20, 10, 30);
  const bomb = makeSupportAirPlan('strike', 0, 20, 20, 10, 30);

  it('a barrage lands six rounds, first at 6000 ms, 1800 ms apart', () => {
    expect(roundCount(barrage)).toBe(6);
    expect([0, 1, 2, 3, 4, 5].map((k) => roundImpactMs(barrage, k))).toEqual([6000, 7800, 9600, 11400, 13200, 15000]);
    expect(roundCount(bomb)).toBe(1);
    expect(roundImpactMs(bomb, 0)).toBe(3000);
  });

  it('a plan is read from its anchor, so a re-anchor moves every time with it', () => {
    const moved = makeSupportAirPlan('barrage', 0, 20, 20, 10, 30);
    moved.anchorMs += 50;
    expect(roundImpactMs(moved, 0)).toBe(6050);
    expect(jetStartMs(moved, 1.8)).toBe(jetStartMs(bomb, 1.8) + 50);
  });

  it('the jet clip starts so its crest lands when the jet crosses the aim point, 400 ms before the bomb', () => {
    expect(jetStartMs(bomb, 1.8)).toBe(3000 - 400 - 1800);
    expect(jetStartMs(bomb, 1.8) + 1800).toBe(2600);
    // At a pitch of 1.04 the crest is 1.8 / 1.04 s in, and the clip starts that much earlier than the plain formula.
    expect(jetStartMs(bomb, 1.8, 1.04) + 1800 / 1.04).toBeCloseTo(2600, 9);
  });

  it('a whistle starts its own duration (at its pitch) before the impact', () => {
    expect(whistleStartMs(6000, 3.37)).toBeCloseTo(2630, 9);
    expect(whistleStartMs(6000, 3.37, 1.05) + 3370 / 1.05).toBeCloseTo(6000, 9);
  });

  it('a plan is dropped 2 s after its span', () => {
    expect(planEndMs(bomb)).toBe(5000 + 2000);
    expect(planEndMs(barrage)).toBe(20000 + 2000);
  });
});

// --- the strike event --------------------------------------------------------------
describe('a strike event is voiced by the set that claims its profile', () => {
  it('a barrage round plays barrage_impact, an air strike plays strike_impact, each at its own gain and radius', async () => {
    const { audio, ctx } = await ready();
    audio.onEvents([strike(1, 20, 20)], fakeSim(1));
    expect(clips(ctx)).toHaveLength(1);
    const barrage = clips(ctx)[0] as FakeSource;
    expect(fileOf(barrage)).toContain('/barrage_impact/');
    expect(levelOf(barrage).gain.value).toBeCloseTo((SETS.barrage_impact?.gain ?? 0) * 1, 12);
    audio.onEvents([strike(0, 20, 20)], fakeSim(2));
    const bomb = clips(ctx)[1] as FakeSource;
    expect(fileOf(bomb)).toContain('/strike_impact/');
    expect(levelOf(bomb).gain.value).toBeCloseTo((SETS.strike_impact?.gain ?? 0) * 1, 12);
    // Pitch jitter: a bomb's +-0.06.
    expect(bomb.playbackRate.value).toBeGreaterThanOrEqual(0.94);
    expect(bomb.playbackRate.value).toBeLessThanOrEqual(1.06);
  });

  it('a bomb 30 tiles away is still heard (radius_tiles 40), a barrage round that far is not (the default 26)', async () => {
    const { audio, ctx } = await ready();
    audio.onEvents([strike(0, 50, 20)], fakeSim(1));
    const bomb = clips(ctx)[0] as FakeSource;
    expect(fileOf(bomb)).toContain('/strike_impact/');
    expect(levelOf(bomb).gain.value).toBeCloseTo((SETS.strike_impact?.gain ?? 0) * (1 - 30 / 40) ** 2, 12);
    audio.onEvents([strike(1, 50, 20)], fakeSim(2));
    expect(clips(ctx)).toHaveLength(1); // out of earshot: nothing more
  });

  it('a strike set with no profiles is the default for a profile nobody claims', async () => {
    const strikeNoProfile: AudioSet = { ...(SETS.strike_impact as AudioSet) };
    delete strikeNoProfile.profiles;
    const { audio, ctx } = await ready(manifestWith({ strike_impact: strikeNoProfile }, false));
    audio.onEvents([strike(1, 20, 20), strike(0, 20, 20)], fakeSim(1));
    expect(clips(ctx).map(fileOf).every((f) => f.includes('/strike_impact/'))).toBe(true);
    expect(clips(ctx)).toHaveLength(2);
  });

  it('...but a claimed profile beats the default', async () => {
    const strikeNoProfile: AudioSet = { ...(SETS.strike_impact as AudioSet) };
    delete strikeNoProfile.profiles;
    const { audio, ctx } = await ready(manifestWith({ ...pick('barrage_impact'), default_strike: strikeNoProfile }, false));
    audio.onEvents([strike(1, 20, 20)], fakeSim(1));
    expect(fileOf(clips(ctx)[0] as FakeSource)).toContain('/barrage_impact/');
  });

  it('a profile nothing claims and no default covers plays no clip (the synth stands in)', async () => {
    const { audio, ctx } = await ready(manifestWith(pick('barrage_impact'), false));
    audio.onEvents([strike(0, 20, 20)], fakeSim(1)); // an air strike, with only the barrage set declared
    expect(clips(ctx)).toHaveLength(0);
    expect(ctx.sources.length).toBeGreaterThan(0); // the synth boom's noise
  });

  it('a strike is voiced FIRST: under a full tick of near misses the bomb still sounds', async () => {
    const { audio, ctx } = await ready();
    const misses = Array.from({ length: 8 }, () => ({ kind: 'nearMiss', tick: 1, x: fixed(20), y: fixed(20) }) as unknown as SimEvent);
    audio.onEvents([...misses, strike(0, 20, 20)], fakeSim(1));
    expect(clipsOf(ctx, 'strike_impact')).toHaveLength(1);
    // The cap is 6 sources a tick: the bomb and five of the near misses.
    expect(ctx.sources.length).toBe(6);
  });

  it('a strike counts as a blast for the death-call hold: a bomb is a kill, a barrage round half of one', async () => {
    expect(BLAST_WEIGHT.airStrike).toBe(1);
    expect(BLAST_WEIGHT.barrageRound).toBe(0.5);
    const { audio } = await ready();
    audio.onEvents([strike(0, 20, 20), strike(1, 20, 20)], fakeSim(1));
    const blasts = (audio as unknown as { blasts: { t: number; w: number }[] }).blasts;
    expect(blasts.map((b) => b.w)).toEqual([1, 0.5]);
    expect(blastEnergy(blasts, 0)).toBeCloseTo(1.5, 12);
    // Out of earshot (a bomb's 40 tiles): not a blast this listener must wait out.
    audio.onEvents([strike(0, 80, 20)], fakeSim(2));
    expect(blasts).toHaveLength(2);
  });
});

describe('a strike by the viewer’s side is combat to the battle bed', () => {
  const BEDS: AudioManifest = {
    ...manifestWith(ALL_SUPPORT, false),
    music: {
      gain: 0.4,
      battle_gain: 0.26,
      tracks: [{ file: 'music/t.mp3' }],
      beds: { calm: { file: 'music/calm.ogg' }, battle: { file: 'music/battle.ogg' } },
    },
  };
  const sim = (): Sim => {
    const s = fakeSim(0) as unknown as { state: { side: Uint8Array } };
    s.state.side = Uint8Array.from([0, 1]);
    return s as unknown as Sim;
  };
  const drive = (audio: BattleAudio, s: Sim, by: number, ticks: number): void => {
    for (let i = 0; i < ticks; i++) {
      (s as unknown as { tickCount: number }).tickCount++;
      audio.onEvents([strike(1, 20, 20, by)], s);
      vi.advanceTimersByTime(50);
    }
  };

  it('six barrage rounds called by our side turn the bed to battle; the enemy’s do not', () => {
    vi.useFakeTimers();
    try {
      const own = attached(BEDS).audio;
      own.setMusicScene('battle');
      drive(own, sim(), 0, 8);
      expect(own.musicBedNow()).toBe('battle');

      const foe = attached(BEDS).audio;
      foe.setMusicScene('battle');
      drive(foe, sim(), 1, 8);
      expect(foe.musicBedNow()).toBe('calm');
    } finally {
      vi.useRealTimers();
    }
  });
});

// --- the jet ------------------------------------------------------------------------
describe('the jet of an air strike', () => {
  const plan = () => makeSupportAirPlan('strike', 0, 20, 20, 10, 30); // from the south-west of the aim point
  const CREST = SETS.jet_flyby?.crest_s ?? 0;

  it('is scheduled the tick before its start, so its crest lands on the aim point at 2600 ms whatever its pitch', async () => {
    const { audio, ctx } = await ready();
    audio.supportPlan(plan());
    let ms = 0;
    for (; ms <= 1200 && clipsOf(ctx, 'jet_flyby').length === 0; ms += 50) tickAt(audio, ctx, ms);
    ms -= 50; // the tick that scheduled it
    const jets = clipsOf(ctx, 'jet_flyby');
    expect(jets).toHaveLength(1);
    const jet = jets[0] as FakeSource;
    const rate = jet.playbackRate.value;
    expect(rate).toBeGreaterThanOrEqual(0.96);
    expect(rate).toBeLessThanOrEqual(1.04);
    expect(jet.offset).toBe(0);
    // The clip starts at 2600 - CREST * 1000 / rate ms (800 at pitch 1), and the tick before that schedules it...
    const startMs = 3000 - 400 - (CREST * 1000) / rate;
    expect(startMs).toBeGreaterThan(ms);
    expect(startMs).toBeLessThanOrEqual(ms + 50);
    expect(jet.startedAt).toBeCloseTo(startMs / 1000, 9);
    // ...so the crest, CREST seconds into the clip at `rate`, lands at 2.6 s.
    expect((jet.startedAt ?? 0) + CREST / rate).toBeCloseTo(2.6, 9);
    // And it is not started twice.
    run(audio, ctx, 800, 3000);
    expect(clipsOf(ctx, 'jet_flyby')).toHaveLength(1);
  });

  it('started late (a quiet tick, a late decode), it starts INSIDE the clip where the clock says', async () => {
    const { audio, ctx } = await ready();
    audio.supportPlan(plan());
    tickAt(audio, ctx, 2000);
    const jet = clipsOf(ctx, 'jet_flyby')[0] as FakeSource;
    const rate = jet.playbackRate.value;
    expect(jet.startedAt).toBe(2);
    expect(jet.offset).toBeGreaterThan(1.1);
    // Still lands its crest on 2.6 s: 2.0 s now, (CREST - offset) of buffer left at `rate`.
    expect(2 + (CREST - jet.offset) / rate).toBeCloseTo(2.6, 9);
    // Past the clip's end (at most 800 ms + 5 s / 0.96 = 6.0 s) but inside the plan (7.0 s), nothing starts.
    const late = await ready();
    late.audio.supportPlan(plan());
    tickAt(late.audio, late.ctx, 6500);
    expect(late.audio.supportState().plans).toBe(1);
    expect(clipsOf(late.ctx, 'jet_flyby')).toHaveLength(0);
  });

  it('after a pause it starts again at the offset the sim clock says', async () => {
    const { audio, ctx } = await ready();
    audio.supportPlan(plan());
    run(audio, ctx, 0, 1500);
    const first = clipsOf(ctx, 'jet_flyby')[0] as FakeSource;
    expect(audio.supportState().jets).toBe(1);
    audio.setPaused(true);
    expect(first.stoppedAt).not.toBeNull();
    expect(audio.supportState().jets).toBe(0);
    // Real time passes while the sim is frozen; the first tick after the resume is still 1500 ms.
    ctx.currentTime = 40;
    audio.setPaused(false);
    audio.updateEngines(fakeSim(1500 / 50), () => true);
    const again = clipsOf(ctx, 'jet_flyby');
    expect(again).toHaveLength(2);
    const resumed = again[1] as FakeSource;
    expect(resumed.startedAt).toBe(40);
    const rate = first.playbackRate.value;
    expect(resumed.offset).toBeCloseTo(((1500 - (3000 - 400 - (CREST * 1000) / rate)) / 1000) * rate, 9);
    // It plays out and is not started a third time.
    resumed.end();
    run(audio, ctx, 1550, 2500);
    expect(clipsOf(ctx, 'jet_flyby')).toHaveLength(2);
  });

  it('its level is the AIM POINT’s placement and does not move with the jet; its pan follows the jet', async () => {
    const { audio, ctx } = await ready(manifestWith(ALL_SUPPORT), { x: 30, y: 20 }); // 10 tiles east of the aim point
    audio.supportPlan(plan());
    const R = SETS.jet_flyby?.radius_tiles ?? 0;
    const gain = (SETS.jet_flyby?.gain ?? 0) * (1 - 10 / R) ** 2;
    const levels: number[] = [];
    const pans: number[] = [];
    let jet: FakeSource | undefined;
    for (const ms of [800, 1400, 2000, 2600, 3200, 4200]) {
      tickAt(audio, ctx, ms);
      jet ??= clipsOf(ctx, 'jet_flyby')[0];
      levels.push(levelOf(jet as FakeSource).gain.target ?? NaN);
      pans.push(panOf(jet as FakeSource).pan.target ?? NaN);
    }
    // Constant, and equal to the aim point's placement: the jet at 25 tiles and the jet overhead read alike.
    for (const l of levels) expect(l).toBeCloseTo(gain, 12);
    // The jet crosses the stereo field: left (the south-west) before the pass, level at it... and a different pan each time.
    expect(pans[1]).toBeLessThan(pans[3] as number);
    expect(pans[3]).toBeLessThan(pans[5] as number);
    expect(new Set(pans.map((p) => p.toFixed(6))).size).toBeGreaterThan(3);
    // The pan at the aim point's crossing is the placement pan of the pose then.
    const pose = supportAirPose(plan(), 2600);
    expect(pose).not.toBeNull();
    expect(pans[3]).toBeCloseTo(placement((pose?.x ?? 0) - 30, (pose?.y ?? 0) - 20, R).pan, 12);
  });
});

// --- the rotor --------------------------------------------------------------------------
describe('the Peten’s rotor over a barrage', () => {
  const plan = () => makeSupportAirPlan('barrage', 0, 20, 20, 10, 30);
  const SPAN = planSpanMs('barrage');
  const rotors = (ctx: FakeContext): FakeSource[] => ctx.sources.filter((s) => s.loop);

  it('the shipped span is 500 to 20000 ms', () => {
    expect(SPAN).toEqual({ start: 500, end: 20000 });
  });

  it('sounds exactly while the gunship is over the map, and fades over 0.25 s at the edges', async () => {
    const { audio, ctx } = await ready();
    audio.supportPlan(plan());
    run(audio, ctx, 0, 450);
    expect(audio.supportState().rotors).toBe(0);
    expect(rotors(ctx)).toHaveLength(0);
    tickAt(audio, ctx, 500);
    expect(audio.supportState().rotors).toBe(1);
    const rotor = rotors(ctx)[0] as FakeSource;
    expect(rotor.loop).toBe(true);
    expect(fileOf(rotor)).toContain('support/rotor_loop');
    const fade = chain(rotor)[4] as FakeGain;
    expect(fade.gain.events).toContainEqual(['linear', 1, 0.5 + 0.25]);
    run(audio, ctx, 550, 19950);
    expect(audio.supportState().rotors).toBe(1);
    expect(rotors(ctx)).toHaveLength(1);
    expect(rotor.stoppedAt).toBeNull();
    tickAt(audio, ctx, 20050);
    expect(audio.supportState().rotors).toBe(0);
    expect(rotor.stoppedAt).toBeCloseTo(20.05 + 0.25, 9);
  });

  it('its level is the spec gain times the placement of the gunship, and its pan follows the pose', async () => {
    const { audio, ctx } = await ready();
    audio.supportPlan(plan());
    tickAt(audio, ctx, 550);
    const rotor = rotors(ctx)[0] as FakeSource;
    const spec = audioManifest.support_air.rotor;
    // Inbound from 20 tiles out in the south-west: pan hard left, level at (1 - ~20/30)^2.
    const early = supportAirPose(plan(), 550);
    const p0 = placement((early?.x ?? 0) - 20, (early?.y ?? 0) - 20, spec.radius_tiles);
    expect(levelOf(rotor).gain.target).toBeCloseTo(spec.gain * p0.gain, 12);
    expect(panOf(rotor).pan.target).toBeCloseTo(p0.pan, 12);
    expect(p0.pan).toBeLessThan(-0.9);
    // On station 4 tiles out at 11 s: (1 - 4/30)^2 of the spec gain, and the pan has swung toward the middle.
    tickAt(audio, ctx, 11000);
    const station = supportAirPose(plan(), 11000);
    const p1 = placement((station?.x ?? 0) - 20, (station?.y ?? 0) - 20, spec.radius_tiles);
    expect(levelOf(rotor).gain.target).toBeCloseTo(spec.gain * p1.gain, 12);
    expect(panOf(rotor).pan.target).toBeCloseTo(p1.pan, 12);
    expect(p1.pan).toBeGreaterThan(-0.5);
    expect(Math.hypot((station?.x ?? 0) - 20, (station?.y ?? 0) - 20)).toBeCloseTo(4, 6);
  });

  it('an air strike has no rotor and a barrage has no jet', async () => {
    const { audio, ctx } = await ready();
    audio.supportPlan(makeSupportAirPlan('strike', 0, 20, 20, 10, 30));
    run(audio, ctx, 0, 5000);
    expect(rotors(ctx)).toHaveLength(0);
    const b = await ready();
    b.audio.supportPlan(plan());
    run(b.audio, b.ctx, 0, 20000);
    expect(clipsOf(b.ctx, 'jet_flyby')).toHaveLength(0);
  });

  it('a manifest with no rotor (a commercial build) plays none, and nothing throws', async () => {
    const { audio, ctx } = await ready(manifestWith(ALL_SUPPORT, false));
    audio.supportPlan(plan());
    run(audio, ctx, 0, 12000);
    expect(rotors(ctx)).toHaveLength(0);
    expect(audio.supportState().rotors).toBe(0);
  });
});

// --- the whistles --------------------------------------------------------------------------
describe('a whistle before every round of a barrage', () => {
  const plan = () => makeSupportAirPlan('barrage', 0, 20, 20, 10, 30);
  const whistles = (ctx: FakeContext): FakeSource[] => clipsOf(ctx, 'incoming_whistle');

  it('six whistles, each ending on its own impact to within a tick, whatever its variant and pitch', async () => {
    const { audio, ctx } = await ready();
    audio.supportPlan(plan());
    run(audio, ctx, 0, 16000);
    const ws = whistles(ctx);
    expect(ws).toHaveLength(6);
    ws.forEach((w, k) => {
      const length = durationOf(fileOf(w));
      const end = (w.startedAt ?? 0) + (length - w.offset) / w.playbackRate.value;
      expect(Math.abs(end - (6000 + 1800 * k) / 1000)).toBeLessThanOrEqual(0.05);
      expect(w.playbackRate.value).toBeGreaterThanOrEqual(0.95);
      expect(w.playbackRate.value).toBeLessThanOrEqual(1.05);
    });
  });

  it('is placed at the aim point, at the set’s gain', async () => {
    const { audio, ctx } = await ready(manifestWith(ALL_SUPPORT), { x: 20, y: 20 });
    audio.supportPlan(plan());
    run(audio, ctx, 0, 3000);
    const w = whistles(ctx)[0] as FakeSource;
    expect(levelOf(w).gain.target).toBeCloseTo(SETS.incoming_whistle?.gain ?? 0, 12);
    expect(panOf(w).pan.target).toBe(0);
  });

  it('a round whose impact has passed gets no whistle: the first tick at 8000 ms starts rounds 2 to 5 only, 2 and 3 late and inside the clip', async () => {
    const { audio, ctx } = await ready();
    audio.supportPlan(plan());
    tickAt(audio, ctx, 8000);
    // Rounds 0 (6000) and 1 (7800) are behind us. Rounds 2 (9600) and 3 (11400) are both already mid-whistle.
    const ws = whistles(ctx);
    expect(ws).toHaveLength(2);
    [9.6, 11.4].forEach((impact, i) => {
      const w = ws[i] as FakeSource;
      expect(w.offset).toBeGreaterThan(0);
      expect(w.startedAt).toBe(8);
      expect((w.startedAt ?? 0) + (durationOf(fileOf(w)) - w.offset) / w.playbackRate.value).toBeCloseTo(impact, 9);
    });
    run(audio, ctx, 8050, 16000);
    expect(whistles(ctx)).toHaveLength(4);
  });

  it('after the last impact nothing is started at all', async () => {
    const { audio, ctx } = await ready();
    audio.supportPlan(plan());
    tickAt(audio, ctx, 15100);
    expect(whistles(ctx)).toHaveLength(0);
  });

  it('a whistle that played out is not started again', async () => {
    const { audio, ctx } = await ready();
    audio.supportPlan(plan());
    run(audio, ctx, 0, 3000);
    const w = whistles(ctx)[0] as FakeSource;
    expect(whistles(ctx)).toHaveLength(1); // round 1's whistle starts no earlier than 3.7 s (3.88 s long at pitch 0.95)
    w.end();
    run(audio, ctx, 3050, 3500);
    expect(whistles(ctx)).toHaveLength(1);
  });
});

// --- mute, pause, teardown, staleness --------------------------------------------------------
describe('mute, pause, teardown and old plans', () => {
  const barrage = () => makeSupportAirPlan('barrage', 0, 20, 20, 10, 30);

  it('mute stops every support voice; unmuting brings back what the clock says', async () => {
    const { audio, ctx } = await ready();
    audio.supportPlan(barrage());
    run(audio, ctx, 0, 5000); // the rotor, and the whistles of rounds 0 and 1
    expect(audio.supportState()).toMatchObject({ rotors: 1, whistles: 2 });
    const live = ctx.sources.filter((s) => s.stoppedAt === null && s.startedAt !== null);
    audio.toggle(); // mute
    expect(audio.supportState()).toMatchObject({ rotors: 0, whistles: 0, jets: 0 });
    for (const s of live) expect(s.stoppedAt).not.toBeNull();
    const before = ctx.sources.length;
    run(audio, ctx, 5050, 5500); // muted: nothing starts
    expect(ctx.sources.length).toBe(before);
    audio.toggle(); // unmute
    tickAt(audio, ctx, 5550);
    expect(audio.supportState().rotors).toBe(1);
  });

  it('the pause menu stops them; the resume starts the rotor and the two whistles that should be sounding', async () => {
    const { audio, ctx } = await ready();
    audio.supportPlan(barrage());
    run(audio, ctx, 0, 5000);
    audio.setPaused(true);
    expect(audio.supportState()).toMatchObject({ rotors: 0, whistles: 0 });
    audio.setPaused(false);
    tickAt(audio, ctx, 5000);
    expect(audio.supportState()).toMatchObject({ rotors: 1, whistles: 2 });
  });

  it('leaving the mission silences everything and forgets the plans', async () => {
    const { audio, ctx } = await ready();
    audio.supportPlan(barrage());
    run(audio, ctx, 0, 5000);
    audio.leaveMission();
    expect(audio.supportState()).toMatchObject({ plans: 0, rotors: 0, whistles: 0, jets: 0 });
    const n = ctx.sources.length;
    run(audio, ctx, 5050, 9000);
    expect(ctx.sources.length).toBe(n);
  });

  it('a plan is dropped once its span (and the 2 s tail) has ended, and its voices with it', async () => {
    const { audio, ctx } = await ready();
    audio.supportPlan(makeSupportAirPlan('strike', 0, 20, 20, 10, 30));
    run(audio, ctx, 0, 7000);
    expect(audio.supportState().plans).toBe(1);
    tickAt(audio, ctx, 7050);
    expect(audio.supportState().plans).toBe(0);
  });

  it('a plan handed over before the first gesture waits for the context', () => {
    const audio = new BattleAudio();
    audio.useManifest(manifestWith(ALL_SUPPORT), '/audio/');
    audio.supportPlan(barrage());
    expect(audio.supportState().plans).toBe(1);
    audio.supportPlan(null);
    expect(audio.supportState().plans).toBe(1);
    audio.leaveMission();
    expect(audio.supportState().plans).toBe(0);
  });
});

// --- the bundle ----------------------------------------------------------------------------------
describe('support-air.ts stays three-free, because the mixer imports it', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  /** Every file support-voices.ts and its relative imports reach, and what they import. */
  function closure(entry: string): Map<string, string[]> {
    const seen = new Map<string, string[]>();
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      const src = readFileSync(file, 'utf8');
      const specs = [
        ...src.matchAll(/^import\b[\s\S]*?from\s+['"]([^'"]+)['"]/gm),
        ...src.matchAll(/^import\s+['"]([^'"]+)['"]/gm),
        ...src.matchAll(/^export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/gm),
      ].map((m) => m[1] as string);
      seen.set(file, specs);
      for (const spec of specs) {
        if (!spec.startsWith('.')) continue;
        const resolved = path.resolve(path.dirname(file), spec);
        for (const candidate of [`${resolved}.ts`, path.join(resolved, 'index.ts')]) {
          try {
            readFileSync(candidate);
            walk(candidate);
            break;
          } catch {
            // not this candidate
          }
        }
      }
    };
    walk(entry);
    return seen;
  }

  it('nothing it reaches imports three', () => {
    const reach = closure(path.join(here, 'support-voices.ts'));
    expect([...reach.keys()].map((f) => path.relative(here, f))).toContain(path.join('three', 'support-air.ts'));
    for (const [file, specs] of reach) {
      const bad = specs.filter((s) => s === 'three' || s.startsWith('three/') || s.startsWith('@lions/render'));
      expect(bad, path.relative(here, file)).toEqual([]);
    }
  });
});
