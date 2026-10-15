// Vehicle engine loops (GH-35). Every living vehicle near the camera hums:
// an idle loop when it stands, a moving loop when it drives, crossfaded by its
// own speed; a track clank on top for the tracked ones, a rotor for the
// helicopters. Data in `data/audio.json`'s `engines` section; the candidates
// themselves, and the numbers below, are PR #597's (docs/polish/audio/engines/).
//
// Presentation only (invariant 4). The sim is READ, once a tick, for where its
// vehicles are -- speed is the tick-to-tick distance, ramped here -- and
// nothing is ever written back. Per-voice randomness (the start offset into a
// loop, a small detune) draws from the mixer's own presentation PRNG, never
// from `rng(entityId)`.
//
// Split in two on purpose. The top half is pure arithmetic -- the family a
// type gets, the crossfade, the voice cap -- so each rule is tested without an
// AudioContext. `EngineVoices` below is the WebAudio half, and it is handed
// what it needs from `BattleAudio` (`EngineHost`) rather than importing it, so
// the two modules do not import each other.

import type { Sim } from '@lions/sim';

/** One encoded candidate of one loop: provenance plus what
 *  `pnpm validate:audio` re-measures. Written by tools/encode_engine_loops.py. */
export interface EngineLoopVariant {
  file: string;
  alt?: string;
  candidate?: string;
  loop_s?: number;
  channels?: number;
  license?: string;
  source?: string;
  credit?: string;
}

/** One loop (`tracked_idle`, `rotor`...): its level, which candidate a mission
 *  plays, and the candidates. */
export interface EngineLoopSpec {
  /** Level on the sfx bus at the camera centre, 0..1, before the speed mix. */
  gain?: number;
  /** `a` or `b`: the candidate a mission plays. PROVISIONAL `a` until the lead
   *  picks -- the pick is this one line. */
  pick?: string;
  a?: EngineLoopVariant;
  b?: EngineLoopVariant;
}

/** The layers a family can carry, each naming a loop id. */
export type EngineLayer = 'idle' | 'move' | 'clank' | 'rotor';
export const ENGINE_LAYERS: readonly EngineLayer[] = ['idle', 'move', 'clank', 'rotor'];

/** `data/audio.json`'s `engines` section. */
export interface EngineSpec {
  /** Beyond this many tiles from the camera an engine is not heard. */
  radius_tiles?: number;
  /** At most this many vehicles sound at once, nearest first. */
  voice_cap?: number;
  /** A sounding vehicle keeps its voice until a rival is this many tiles nearer. */
  hysteresis_tiles?: number;
  loops?: Record<string, EngineLoopSpec>;
  /** Family name -> layer -> loop id. */
  families?: Record<string, Partial<Record<EngineLayer, string>>>;
  /** Unit id -> family name, or `none`. Overrides the flags. */
  by_type?: Record<string, string>;
}

/** `&engines=a|b`: every loop plays this candidate. */
export type EngineVariantId = 'a' | 'b';
export const ENGINE_VARIANTS: readonly EngineVariantId[] = ['a', 'b'];
export function isEngineVariant(v: unknown): v is EngineVariantId {
  return v === 'a' || v === 'b';
}

/** PR #597's numbers sheet. */
export const ENGINE_RADIUS_TILES = 14;
export const ENGINE_VOICE_CAP = 4;
export const ENGINE_HYSTERESIS_TILES = 2;
/** Idle -> moving crossfades over this band of speed share. A constant-rate
 *  ramp feeds it, so it cannot flap. */
export const ENGINE_XFADE = { lo: 0.05, hi: 0.35 } as const;
/** Seconds the speed share takes to ramp 0 -> 1 (and back): a vehicle's engine
 *  note climbs as it pulls away rather than jumping with the sim's step. */
export const ENGINE_RAMP_S = 0.8;
/** A tick-to-tick distance above this multiple of the type's own step is a
 *  discontinuity -- a spawn, a dismount -- not motion. vehicle-weight.ts's
 *  OVERSPEED_CEILING, for the same reason. */
export const ENGINE_OVERSPEED = 1.5;
/** A voice fades in and out over this when it gains or loses its slot. */
export const ENGINE_SLOT_FADE_S = 0.25;
/** ...and this when its vehicle dies: the engine stops with it. */
export const ENGINE_DEATH_FADE_S = 0.08;
/** Time constant every per-tick parameter move takes (20 Hz updates). */
export const ENGINE_PARAM_TAU_S = 0.06;
/** +-this playback-rate detune per vehicle, so two of one type a few
 *  milliseconds apart do not comb-filter into a whine of the mixer's making. */
export const ENGINE_DETUNE = 0.03;
/** The sim's tick, seconds (invariant 1: 20 Hz). */
const TICK_S = 1 / 20;

const clamp01 = (v: number): number => (v > 1 ? 1 : v > 0 ? v : 0);

/** What `engineFamilyOf` needs of a unit type. */
export interface EngineTypeFacts {
  readonly id: string;
  readonly isAir: boolean;
  /** `UnitType.wheeled`: rides on wheels OR tracks (sim.ts). */
  readonly wheeled: boolean;
}

/**
 * The family a unit type's engine belongs to, or null for silence.
 *
 * `by_type` first: it names every tracked type and every rotor, and `none`
 * silences a vehicle. The flags cannot do that on their own, which is the
 * finding PR #597 recorded: `wheeled` is "wheels or tracks", true for a tank
 * and a jeep alike, and FALSE for the D9 (its role `engineer` is a foot role),
 * so a tracked/wheeled split, and the D9 itself, have to be named. Otherwise:
 * an air unit is silent (the drones and the paramotor -- a propeller is the
 * whine the candidates were built to avoid), any other vehicle is `wheeled`,
 * and a foot unit is silent.
 */
export function engineFamilyOf(spec: EngineSpec | null | undefined, type: EngineTypeFacts): string | null {
  const families = spec?.families ?? {};
  const named = spec?.by_type?.[type.id];
  if (named !== undefined) return Object.hasOwn(families, named) ? named : null;
  if (type.isAir || !type.wheeled) return null;
  return Object.hasOwn(families, 'wheeled') ? 'wheeled' : null;
}

/** The candidate a loop plays: the sandbox's override, else the loop's own
 *  `pick`, else `a`. Null when that candidate is not declared. */
export function engineVariantFor(loop: EngineLoopSpec | undefined, override?: EngineVariantId | null): EngineLoopVariant | null {
  if (!loop) return null;
  const which: EngineVariantId = override ?? (isEngineVariant(loop.pick) ? loop.pick : 'a');
  return loop[which] ?? null;
}

/** Equal-power idle/moving weights for a speed share. */
export function engineCrossfade(share: number): { idle: number; move: number } {
  const x = clamp01((share - ENGINE_XFADE.lo) / (ENGINE_XFADE.hi - ENGINE_XFADE.lo));
  return { idle: Math.cos((x * Math.PI) / 2), move: Math.sin((x * Math.PI) / 2) };
}

/** One layer's gain multiplier (times its loop's `gain`) and playback rate. */
export interface LayerMix {
  gain: number;
  rate: number;
}

/**
 * A layer's mix at a speed share (0 standing, 1 at the type's top speed),
 * PR #597's numbers sheet: the moving loop climbs 0.9x -> 1.2x (the whine
 * check ran at 1.2x) and gains a quarter as it opens up; the idle holds 1x;
 * the clank is silent at rest and its link rate follows the speed; a rotor is
 * always turning and lifts a little with speed.
 */
export function engineLayerMix(layer: EngineLayer, share: number): LayerMix {
  const s = clamp01(share);
  const xf = engineCrossfade(s);
  switch (layer) {
    case 'idle':
      return { gain: xf.idle, rate: 1 };
    case 'move':
      return { gain: xf.move * (0.75 + 0.25 * s), rate: 0.9 + 0.3 * s };
    case 'clank':
      return { gain: s, rate: 0.75 + 0.45 * s };
    case 'rotor':
      return { gain: 0.85 + 0.15 * s, rate: 0.95 + 0.1 * s };
  }
}

/** One vehicle that could sound: its entity id and distance from the camera. */
export interface EngineCandidate {
  id: number;
  dist: number;
}

/**
 * Who gets an engine voice: the `cap` nearest, where a vehicle already
 * sounding counts `hysteresis` tiles nearer than it is -- so a rival must be at
 * least that much nearer to take its slot, and a column driving past the
 * camera does not swap voices every tick. Ties go to the newcomer (">= 2
 * tiles nearer" wins), then to the lower id, so the answer is deterministic.
 */
export function selectEngineVoices(
  candidates: readonly EngineCandidate[],
  incumbents: ReadonlySet<number>,
  cap: number,
  hysteresis: number
): number[] {
  const n = Math.max(0, Math.floor(cap));
  if (n === 0) return [];
  return candidates
    .map((c) => ({ id: c.id, key: c.dist - (incumbents.has(c.id) ? hysteresis : 0), inc: incumbents.has(c.id) }))
    .sort((a, b) => a.key - b.key || Number(a.inc) - Number(b.inc) || a.id - b.id)
    .slice(0, n)
    .map((c) => c.id);
}

/** A tick's speed share from the distance moved, against the type's own step
 *  per tick. Null for a discontinuity (a jump no vehicle can drive). */
export function speedShare(dx: number, dy: number, stepTiles: number): number | null {
  if (!(stepTiles > 0)) return 0;
  const share = Math.hypot(dx, dy) / stepTiles;
  if (!Number.isFinite(share) || share > ENGINE_OVERSPEED) return null;
  return clamp01(share);
}

/** A constant-rate ramp from `cur` toward `target`, `dtS` seconds of it. */
export function rampToward(cur: number, target: number, dtS: number, rampS = ENGINE_RAMP_S): number {
  const step = rampS > 0 ? dtS / rampS : 1;
  return cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
}

// --- the WebAudio half --------------------------------------------------------

/** Where a placed sound sits relative to the listener (audio.ts's `Placement`). */
export interface EnginePlacement {
  audible: boolean;
  gain: number;
  pan: number;
  lowpassHz: number;
}

/** What `EngineVoices` borrows from `BattleAudio`. */
export interface EngineHost {
  ctx(): AudioContext | null;
  /** The sfx bus: under the Effects slider and the duck stage. */
  bus(): AudioNode | null;
  /** Fetch and decode a file (the primary encoding, then `alt`). */
  decode(v: EngineLoopVariant): Promise<AudioBuffer | null>;
  /** Presentation randomness, [0, 1). */
  rand(): number;
  /** `placement()` with the engine radius. */
  place(dx: number, dy: number, radius: number): EnginePlacement;
}

/** One loop sounding inside a voice. */
interface LayerNode {
  layer: EngineLayer;
  loop: string;
  src: AudioBufferSourceNode;
  gain: GainNode;
}

/** One vehicle's engine. */
interface EngineVoice {
  id: number;
  family: string;
  layers: LayerNode[];
  lp: BiquadFilterNode;
  pan: StereoPannerNode;
  /** The voice's own level: placement times its fade. */
  out: GainNode;
  detune: number;
}

/** What a test or the sandbox can read back. */
export interface EngineState {
  on: boolean;
  override: EngineVariantId | null;
  /** Loops decoded, and how many the current choice needs. */
  decoded: number;
  wanted: number;
  voices: { id: number; family: string; share: number; layers: EngineLayer[] }[];
}

/** The listener: the camera's focus, in tiles. */
export interface EngineListener {
  x: number;
  y: number;
}

export class EngineVoices {
  private spec: EngineSpec | null = null;
  private on = false;
  private override: EngineVariantId | null = null;
  /** loop id -> decoded buffer for the current choice; `null` = in flight or failed. */
  private readonly buffers = new Map<string, AudioBuffer | null>();
  /** Which file each decoded buffer is, so a changed choice re-decodes. */
  private readonly bufferFile = new Map<string, string>();
  private readonly voices = new Map<number, EngineVoice>();
  /** Per entity id: last position (tiles), ramped share, seen flag. */
  private prevX: Float64Array<ArrayBuffer> = new Float64Array(0);
  private prevY: Float64Array<ArrayBuffer> = new Float64Array(0);
  private share: Float64Array<ArrayBuffer> = new Float64Array(0);
  private seen = new Uint8Array(0);
  /** typeIdx -> family (or null), resolved once per spec. */
  private readonly familyByType = new Map<number, string | null>();

  // A plain field, not a parameter property: `pnpm audio:mix` serves this
  // file type-stripped (node's strip-only mode), which cannot erase one.
  private readonly host: EngineHost;

  constructor(host: EngineHost) {
    this.host = host;
  }

  useSpec(spec: EngineSpec | undefined): void {
    this.spec = spec ?? null;
    this.familyByType.clear();
    this.dropBuffers();
  }

  /**
   * A mission (or a sandbox) starts: engines on, every loop on its data
   * `pick` unless `override` names one candidate for all of them. Idempotent;
   * a changed override re-decodes what changed.
   */
  start(override: EngineVariantId | null = null): void {
    if (this.override !== override) {
      this.override = override;
      this.stopAll(ENGINE_SLOT_FADE_S);
      this.dropBuffers();
    }
    this.on = true;
    this.ensureBuffers();
  }

  /** Leaving the mission: every voice out and every vehicle forgotten. */
  stop(): void {
    this.on = false;
    this.stopAll(ENGINE_SLOT_FADE_S);
    this.seen = new Uint8Array(0);
    this.prevX = new Float64Array(0);
    this.prevY = new Float64Array(0);
    this.share = new Float64Array(0);
  }

  /** Every voice fades out (mute, pause). Speeds are kept; the next `update`
   *  that may sound brings the voices back. */
  stopAll(fadeS: number): void {
    for (const id of [...this.voices.keys()]) this.release(id, fadeS);
  }

  /** The loops the current choice plays, by id, with the candidate for each. */
  private wantedLoops(): Map<string, EngineLoopVariant> {
    const out = new Map<string, EngineLoopVariant>();
    const loops = this.spec?.loops ?? {};
    for (const family of Object.values(this.spec?.families ?? {})) {
      for (const layer of ENGINE_LAYERS) {
        const id = family[layer];
        if (!id || out.has(id)) continue;
        const v = engineVariantFor(loops[id], this.override);
        if (v) out.set(id, v);
      }
    }
    return out;
  }

  private dropBuffers(): void {
    this.buffers.clear();
    this.bufferFile.clear();
  }

  /** Decode whatever the choice wants and is not loaded. Safe before a
   *  context exists: `update` asks again once one does. */
  private ensureBuffers(): void {
    if (!this.on || !this.host.ctx()) return;
    for (const [id, v] of this.wantedLoops()) {
      if (this.bufferFile.get(id) === v.file) continue;
      this.bufferFile.set(id, v.file);
      this.buffers.set(id, null);
      void this.host.decode(v).then((b) => {
        // A choice changed while this decoded: drop it.
        if (this.bufferFile.get(id) !== v.file) return;
        this.buffers.set(id, b);
      });
    }
  }

  private familyOf(sim: Sim, ti: number): string | null {
    const cached = this.familyByType.get(ti);
    if (cached !== undefined) return cached;
    const type = sim.unitTypes[ti];
    const family = type ? engineFamilyOf(this.spec, type) : null;
    this.familyByType.set(ti, family);
    return family;
  }

  /** Grow the per-entity arrays to `n`, keeping what is there. */
  private grow(n: number): void {
    if (n <= this.seen.length) return;
    const cap = Math.max(n, this.seen.length * 2, 64);
    const grow64 = (a: Float64Array): Float64Array<ArrayBuffer> => {
      const b = new Float64Array(cap);
      b.set(a);
      return b;
    };
    this.prevX = grow64(this.prevX);
    this.prevY = grow64(this.prevY);
    this.share = grow64(this.share);
    const s = new Uint8Array(cap);
    s.set(this.seen);
    this.seen = s;
  }

  /**
   * One sim tick: ramp every vehicle's speed share from how far it moved,
   * choose who sounds, and move every voice's levels and rates. `audible`
   * says whether the listener may hear unit `id` at all -- their own, or one
   * the fog shows -- so an engine in the fog does not give a hidden enemy
   * away. `canSound` false (muted, no running context) fades every voice out
   * but still tracks speed, so an unmute does not hear a stale note.
   */
  update(sim: Sim, listener: EngineListener, audible: (id: number) => boolean, canSound: boolean): void {
    if (!this.on || !this.spec) return;
    const st = sim.state;
    const n = sim.entityCount;
    this.grow(n);
    const radius = this.spec.radius_tiles ?? ENGINE_RADIUS_TILES;
    const candidates: EngineCandidate[] = [];
    for (let i = 0; i < n; i++) {
      if (st.alive[i] === 0 || st.removed[i] !== 0) {
        this.seen[i] = 0;
        continue;
      }
      const family = this.familyOf(sim, st.typeIdx[i]);
      if (family === null) continue;
      const x = st.posX[i] / 65536;
      const y = st.posY[i] / 65536;
      if (this.seen[i] === 0) {
        this.seen[i] = 1;
        this.share[i] = 0;
      } else {
        const type = sim.unitTypes[st.typeIdx[i]];
        const sample = speedShare(x - this.prevX[i], y - this.prevY[i], (type?.stepPerTick ?? 0) / 65536);
        if (sample !== null) this.share[i] = rampToward(this.share[i], sample, TICK_S);
      }
      this.prevX[i] = x;
      this.prevY[i] = y;
      // Riding inside something, or underground: not an engine anyone hears.
      if (st.carriedBy[i] >= 0 || st.tunnelIn[i] >= 0) continue;
      const dist = Math.hypot(x - listener.x, y - listener.y);
      if (dist > radius || !audible(i)) continue;
      candidates.push({ id: i, dist });
    }

    const ctx = this.host.ctx();
    const bus = this.host.bus();
    if (!canSound || !ctx || !bus) {
      this.stopAll(ENGINE_SLOT_FADE_S);
      return;
    }
    this.ensureBuffers();
    const ready = candidates.filter((c) => this.layersReady(sim, c.id));
    const chosen = new Set(
      selectEngineVoices(
        ready,
        new Set(this.voices.keys()),
        this.spec.voice_cap ?? ENGINE_VOICE_CAP,
        this.spec.hysteresis_tiles ?? ENGINE_HYSTERESIS_TILES
      )
    );
    for (const id of [...this.voices.keys()]) {
      if (chosen.has(id)) continue;
      // Dead now: the engine stops with it. Otherwise it lost its slot.
      this.release(id, st.alive[id] === 0 ? ENGINE_DEATH_FADE_S : ENGINE_SLOT_FADE_S);
    }
    for (const id of chosen) {
      const voice = this.voices.get(id) ?? this.begin(ctx, bus, sim, id);
      if (voice) this.steer(ctx, voice, st.posX[id] / 65536 - listener.x, st.posY[id] / 65536 - listener.y, radius);
    }
  }

  /** Every loop the unit's family plays is decoded. */
  private layersReady(sim: Sim, id: number): boolean {
    const family = this.familyOf(sim, sim.state.typeIdx[id]);
    const layers = family ? this.spec?.families?.[family] : undefined;
    if (!layers) return false;
    let any = false;
    for (const layer of ENGINE_LAYERS) {
      const loop = layers[layer];
      if (!loop) continue;
      if (!this.buffers.get(loop)) return false;
      any = true;
    }
    return any;
  }

  /** Start a vehicle's voice: every layer looping from one random place, at
   *  silence, ramped in by `steer`. */
  private begin(ctx: AudioContext, bus: AudioNode, sim: Sim, id: number): EngineVoice | null {
    const family = this.familyOf(sim, sim.state.typeIdx[id]);
    const layers = family ? this.spec?.families?.[family] : undefined;
    if (!family || !layers) return null;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const pan = ctx.createStereoPanner();
    const out = ctx.createGain();
    const t = ctx.currentTime;
    out.gain.setValueAtTime(0, t);
    lp.connect(pan).connect(out).connect(bus);
    const detune = 1 + (this.host.rand() * 2 - 1) * ENGINE_DETUNE;
    const phase = this.host.rand();
    const voice: EngineVoice = { id, family, layers: [], lp, pan, out, detune };
    for (const layer of ENGINE_LAYERS) {
      const loop = layers[layer];
      const buffer = loop ? this.buffers.get(loop) : null;
      if (!loop || !buffer) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      src.connect(g).connect(lp);
      src.start(t, phase * buffer.duration);
      voice.layers.push({ layer, loop, src, gain: g });
    }
    this.voices.set(id, voice);
    return voice;
  }

  /** Move a voice's levels, rates, pan and filter to this tick's values. */
  private steer(ctx: AudioContext, v: EngineVoice, dx: number, dy: number, radius: number): void {
    const t = ctx.currentTime;
    const share = this.share[v.id] ?? 0;
    const p = this.host.place(dx, dy, radius);
    v.out.gain.setTargetAtTime(p.audible ? p.gain : 0, t, ENGINE_PARAM_TAU_S);
    v.pan.pan.setTargetAtTime(p.pan, t, ENGINE_PARAM_TAU_S);
    v.lp.frequency.setTargetAtTime(p.lowpassHz || 1200, t, ENGINE_PARAM_TAU_S);
    for (const l of v.layers) {
      const mix = engineLayerMix(l.layer, share);
      const level = clamp01(this.spec?.loops?.[l.loop]?.gain ?? 1) * mix.gain;
      l.gain.gain.setTargetAtTime(level, t, ENGINE_PARAM_TAU_S);
      l.src.playbackRate.setTargetAtTime(mix.rate * v.detune, t, ENGINE_PARAM_TAU_S);
    }
  }

  /** Fade a voice out over `fadeS` and stop it there. */
  private release(id: number, fadeS: number): void {
    const v = this.voices.get(id);
    if (!v) return;
    this.voices.delete(id);
    const ctx = this.host.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    v.out.gain.cancelScheduledValues(t);
    v.out.gain.setValueAtTime(v.out.gain.value, t);
    v.out.gain.linearRampToValueAtTime(0, t + fadeS);
    const nodes: AudioNode[] = [v.lp, v.pan, v.out];
    for (const l of v.layers) {
      l.src.stop(t + fadeS);
      nodes.push(l.src, l.gain);
    }
    const last = v.layers[v.layers.length - 1];
    if (last) {
      last.src.onended = () => {
        for (const node of nodes) node.disconnect();
      };
    }
  }

  state(): EngineState {
    const wanted = this.wantedLoops();
    let decoded = 0;
    for (const id of wanted.keys()) if (this.buffers.get(id)) decoded++;
    return {
      on: this.on,
      override: this.override,
      decoded,
      wanted: wanted.size,
      voices: [...this.voices.values()].map((v) => ({
        id: v.id,
        family: v.family,
        share: this.share[v.id] ?? 0,
        layers: v.layers.map((l) => l.layer),
      })),
    };
  }
}
