// @vitest-environment jsdom
//
// GH-35: BattleAudio's engine voices on a recording stand-in for WebAudio,
// driven by a stand-in sim, against the shipped `engines` section of
// data/audio.json. The rules themselves (family, crossfade, cap) are
// engines.test.ts; this file proves the wiring: the sfx bus, the cap, death,
// distance, fog, mute, pause and the &engines override.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sim } from '@lions/sim';
import { BattleAudio, placement, type AudioManifest } from './audio';
import { ENGINE_DEATH_FADE_S, type EngineSpec } from './engines';
import audioManifest from '../../../data/audio.json';

const SPEC = (audioManifest as { engines?: EngineSpec }).engines;
const MANIFEST: AudioManifest = { master_gain: 0.9, engines: SPEC };

interface FakeParam {
  value: number;
  /** The last value `setTargetAtTime` aimed at. */
  target: number | null;
  readonly events: [string, number, number][];
  setValueAtTime(v: number, t: number): void;
  linearRampToValueAtTime(v: number, t: number): void;
  setTargetAtTime(v: number, t: number, tau: number): void;
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
  readonly Q = param(1);
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
    return Object.assign(new FakeNode(), {
      threshold: param(0), knee: param(0), ratio: param(0), attack: param(0), release: param(0),
    });
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
  /** The buffer remembers which file it was decoded from, so a test can tell
   *  candidate A's loop from candidate B's. */
  decodeAudioData(ab: ArrayBuffer & { file?: string }): Promise<{ duration: number; file?: string }> {
    return Promise.resolve({ duration: 8.011, file: ab.file });
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

/** A stand-in sim: `n` entity slots, each a unit type below, positions in tiles. */
interface Unit {
  type: 'tank' | 'jeep' | 'heli' | 'rifles' | 'drone';
  x: number;
  y: number;
  side?: number;
}
const TYPES = [
  { id: 'mbt_lavi', isAir: false, wheeled: true, stepPerTick: Math.round(0.055 * 65536) },
  { id: 'jeep_shoded', isAir: false, wheeled: true, stepPerTick: Math.round(0.145 * 65536) },
  { id: 'heli_peten', isAir: true, wheeled: true, stepPerTick: Math.round(0.17 * 65536) },
  { id: 'inf_squad', isAir: false, wheeled: false, stepPerTick: Math.round(0.045 * 65536) },
  { id: 'recon_drone', isAir: true, wheeled: true, stepPerTick: Math.round(0.11 * 65536) },
];
const TYPE_IDX = { tank: 0, jeep: 1, heli: 2, rifles: 3, drone: 4 } as const;
function fakeSim(units: Unit[]): Sim & { move(id: number, dx: number, dy: number): void; kill(id: number): void } {
  const n = units.length;
  const state = {
    alive: new Uint8Array(n).fill(1),
    removed: new Uint8Array(n),
    side: Uint8Array.from(units.map((u) => u.side ?? 0)),
    typeIdx: Uint16Array.from(units.map((u) => TYPE_IDX[u.type])),
    posX: Int32Array.from(units.map((u) => Math.round(u.x * 65536))),
    posY: Int32Array.from(units.map((u) => Math.round(u.y * 65536))),
    carriedBy: new Int32Array(n).fill(-1),
    tunnelIn: new Int32Array(n).fill(-1),
  };
  return {
    state,
    unitTypes: TYPES,
    entityCount: n,
    move(id: number, dx: number, dy: number) {
      state.posX[id] += Math.round(dx * 65536);
      state.posY[id] += Math.round(dy * 65536);
    },
    kill(id: number) {
      state.alive[id] = 0;
    },
  } as unknown as Sim & { move(id: number, dx: number, dy: number): void; kill(id: number): void };
}

const realAudioContext = globalThis.AudioContext;
const live: { audio: BattleAudio; added: [string, EventListenerOrEventListenerObject][] }[] = [];

/** An attached BattleAudio on the fake context, the engines manifest, every
 *  fetch answered with a buffer that remembers its URL. */
function attached(): { audio: BattleAudio; ctx: FakeContext; fetched: string[] } {
  FakeContext.made.length = 0;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  const fetched: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    return { ok: true, arrayBuffer: async () => Object.assign(new ArrayBuffer(4), { file: url }) };
  });
  const audio = new BattleAudio();
  audio.useManifest(MANIFEST, '/audio/');
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
  return { audio, ctx, fetched };
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const ALL_VISIBLE = (): boolean => true;

/** Start the engines, let the loops decode, and tick once. */
async function running(units: Unit[], override: 'a' | 'b' | null = null) {
  const r = attached();
  const sim = fakeSim(units);
  r.audio.setListener({ x: 0, y: 0 });
  r.audio.startEngines(override);
  r.audio.updateEngines(sim, ALL_VISIBLE);
  await flush();
  r.audio.updateEngines(sim, ALL_VISIBLE);
  return { ...r, sim };
}

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

describe('placement with a radius (GH-35: one law, R a parameter)', () => {
  it('a one-shot keeps its 26 tiles; an engine is heard to its own radius and no further', () => {
    expect(placement(10, 0)).toEqual(placement(10, 0, 26));
    expect(placement(10, 0, 14).gain).toBeCloseTo((1 - 10 / 14) ** 2, 12);
    expect(placement(14.01, 0, 14).audible).toBe(false);
    expect(placement(20, 0, 14)).toEqual({ audible: false, gain: 0, pan: 0, lowpassHz: 0 });
    expect(placement(0, 0, 0).audible).toBe(false);
  });
});

describe('engine voices (GH-35)', () => {
  it('a tank near the camera hums: idle, moving and clank, every loop into the sfx bus', async () => {
    const { audio, ctx } = await running([{ type: 'tank', x: 2, y: 0 }]);
    const st = audio.engineState();
    expect(st.voices).toHaveLength(1);
    expect(st.voices[0]).toMatchObject({ id: 0, family: 'tracked' });
    expect(st.voices[0]?.layers).toEqual(['idle', 'move', 'clank']);
    // The sfx bus is the gain the master's duck stage reads from: attach's
    // third gain (master, sfx, sfxDuck...). Every loop must reach it.
    const sfx = ctx.gains[1];
    const loops = ctx.sources.filter((s) => s.loop);
    expect(loops).toHaveLength(3);
    for (const s of loops) expect(chain(s)).toContain(sfx);
  });

  it('SILENT_AUDIO (sfx 0) silences them: the bus they ride is the Effects slider', async () => {
    const { audio, ctx } = await running([{ type: 'tank', x: 2, y: 0 }]);
    audio.setGains({ master: 1, music: 0, sfx: 0, voice: 0 });
    const sfx = ctx.gains[1];
    expect(sfx?.gain.value).toBe(0);
    for (const s of ctx.sources.filter((x) => x.loop)) expect(chain(s)).toContain(sfx);
  });

  it('a wheeled vehicle has no clank; a helicopter plays its rotor alone; foot and drones are silent', async () => {
    const { audio } = await running([
      { type: 'jeep', x: 1, y: 0 },
      { type: 'heli', x: 0, y: 1 },
      { type: 'rifles', x: 1, y: 1 },
      { type: 'drone', x: 0, y: 2 },
    ]);
    const byId = new Map(audio.engineState().voices.map((v) => [v.id, v]));
    expect(byId.get(0)?.layers).toEqual(['idle', 'move']);
    expect(byId.get(1)?.layers).toEqual(['rotor']);
    expect(byId.has(2)).toBe(false);
    expect(byId.has(3)).toBe(false);
  });

  it('at most voice_cap vehicles sound, the nearest', async () => {
    const units: Unit[] = [7, 1, 5, 3, 2, 6].map((x) => ({ type: 'tank', x, y: 0 }));
    const { audio } = await running(units);
    const ids = audio.engineState().voices.map((v) => v.id).sort();
    expect(SPEC?.voice_cap).toBe(4);
    // x = 1, 2, 3, 5 are entities 1, 4, 3, 2.
    expect(ids).toEqual([1, 2, 3, 4]);
  });

  it('beyond radius_tiles nothing sounds, and a nearer engine is louder', async () => {
    const r = SPEC?.radius_tiles ?? 0;
    const { audio, ctx } = await running([
      { type: 'tank', x: 1, y: 0 },
      { type: 'tank', x: r * 0.6, y: 0 },
      { type: 'tank', x: r + 0.5, y: 0 },
    ]);
    expect(audio.engineState().voices.map((v) => v.id).sort()).toEqual([0, 1]);
    // Each voice's out gain is the third gain it made after its layers... read
    // it as the gain the loops' chain passes just before the sfx bus.
    const sfx = ctx.gains[1];
    const outOf = (srcIdx: number): FakeGain => {
      const c = chain(ctx.sources.filter((s) => s.loop)[srcIdx]);
      return c[c.indexOf(sfx) - 1] as FakeGain;
    };
    const near = outOf(0).gain.target ?? 0;
    const far = outOf(3).gain.target ?? 0;
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    // The one-shots' law with R = radius_tiles: (1 - d/R)^2, so 0.16 at 0.6 R.
    expect(far).toBeCloseTo(0.16, 6);
    expect(near).toBeCloseTo((1 - 1 / r) ** 2, 6);
  });

  it('a vehicle that dies falls silent at once, and its wreck never sounds', async () => {
    const { audio, ctx, sim } = await running([{ type: 'tank', x: 2, y: 0 }]);
    const loops = ctx.sources.filter((s) => s.loop);
    ctx.currentTime = 10;
    (sim as unknown as { kill(id: number): void }).kill(0);
    audio.updateEngines(sim, ALL_VISIBLE);
    expect(audio.engineState().voices).toEqual([]);
    for (const s of loops) expect(s.stoppedAt).toBeCloseTo(10 + ENGINE_DEATH_FADE_S, 9);
    // Ticks later the wreck is still there in the sim's arrays: no new voice.
    for (let i = 0; i < 5; i++) audio.updateEngines(sim, ALL_VISIBLE);
    expect(audio.engineState().voices).toEqual([]);
    expect(ctx.sources.filter((s) => s.loop)).toHaveLength(loops.length);
  });

  it('idle at rest, moving at speed: the crossfade follows the vehicle', async () => {
    const { audio, ctx, sim } = await running([{ type: 'jeep', x: 2, y: 0 }]);
    const [idle, move] = ctx.sources.filter((s) => s.loop).map((s) => s.to as FakeGain);
    const gain = (l: string): number => SPEC?.loops?.[l]?.gain ?? 0;
    expect(idle?.gain.target).toBeCloseTo(gain('wheeled_idle'), 9);
    expect(move?.gain.target).toBeCloseTo(0, 9);
    // Drive at the type's own step for a second: the ramp tops out.
    const step = TYPES[1].stepPerTick / 65536;
    for (let i = 0; i < 20; i++) {
      (sim as unknown as { move(id: number, dx: number, dy: number): void }).move(0, step, 0);
      audio.updateEngines(sim, ALL_VISIBLE);
    }
    expect(audio.engineState().voices[0]?.share).toBeCloseTo(1, 9);
    expect(idle?.gain.target).toBeCloseTo(0, 9);
    expect(move?.gain.target).toBeCloseTo(gain('wheeled_move'), 9);
  });

  it('an enemy in the fog is not heard; one the fog shows is; our own always', async () => {
    const r = attached();
    const sim = fakeSim([
      { type: 'tank', x: 1, y: 0, side: 1 },
      { type: 'tank', x: 2, y: 0, side: 1 },
      { type: 'tank', x: 3, y: 0, side: 0 },
    ]);
    r.audio.setListener({ x: 0, y: 0 });
    r.audio.startEngines();
    const fog = (wx: number): boolean => wx > 1.5 && wx < 2.5; // only entity 1's tile is in sight
    r.audio.updateEngines(sim, fog);
    await flush();
    r.audio.updateEngines(sim, fog);
    expect(r.audio.engineState().voices.map((v) => v.id).sort()).toEqual([1, 2]);
  });

  it('mute silences them, and they come back on unmute', async () => {
    const { audio, sim } = await running([{ type: 'tank', x: 2, y: 0 }]);
    audio.toggle();
    expect(audio.engineState().voices).toEqual([]);
    audio.updateEngines(sim, ALL_VISIBLE);
    expect(audio.engineState().voices).toEqual([]);
    audio.toggle();
    audio.updateEngines(sim, ALL_VISIBLE);
    expect(audio.engineState().voices).toHaveLength(1);
  });

  it('the pause menu stops them; leaving the mission turns them off', async () => {
    const { audio, sim } = await running([{ type: 'tank', x: 2, y: 0 }]);
    audio.setPaused(true);
    expect(audio.engineState().voices).toEqual([]);
    audio.setPaused(false);
    audio.updateEngines(sim, ALL_VISIBLE);
    expect(audio.engineState().voices).toHaveLength(1);
    audio.leaveMission();
    audio.updateEngines(sim, ALL_VISIBLE);
    expect(audio.engineState()).toMatchObject({ on: false, voices: [] });
  });

  it('a mission plays the data pick (a); &engines=b plays every loop’s b candidate', async () => {
    const a = await running([{ type: 'tank', x: 2, y: 0 }]);
    const aFiles = a.ctx.sources.filter((s) => s.loop).map((s) => s.buffer?.file ?? '');
    expect(aFiles).toHaveLength(3);
    for (const f of aFiles) expect(f).toMatch(/_a\.ogg$/);
    const b = await running([{ type: 'tank', x: 2, y: 0 }], 'b');
    const bFiles = b.ctx.sources.filter((s) => s.loop).map((s) => s.buffer?.file ?? '');
    expect(bFiles).toHaveLength(3);
    for (const f of bFiles) expect(f).toMatch(/_b\.ogg$/);
    expect(b.audio.engineState().override).toBe('b');
  });
});
