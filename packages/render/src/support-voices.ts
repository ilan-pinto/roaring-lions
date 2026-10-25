// Fire-support aircraft and incoming rounds, as sound (GH-782).
//
// Three voices belong to a call, and none of them is a sim entity, so none can
// be an engine voice: they play from the `SupportAirPlan` the renderer built
// for the call (`Renderer.supportCalled` returns it, the app hands it to
// `BattleAudio.supportPlan`). The renderer's `reanchor` mutates that very
// object, so the sound and the picture read one clock and cannot drift.
//
//  * the JET of an air strike: one `flyby` clip, started so its loudness peak
//    (`crest_s` into the clip) lands on the tick the jet crosses the aim point.
//    Its LEVEL comes from the aim point's placement and stays put (the clip
//    already carries the swell; reading it off the moving jet would count the
//    swell twice). Its PAN follows the jet's real track, through
//    `supportAirPose`, a tick at a time;
//  * the PETEN's rotor over a mortar barrage: a loop that sounds exactly while
//    `supportAirPose` says the gunship is over the map, level, pan and
//    low-pass following it, fading over `ROTOR_FADE_S` at the span's edges;
//  * a WHISTLE before every round of a barrage: round k lands at
//    `anchor + first + k * spacing` (the sim's `FIRE_SUPPORT` row), and each
//    whistle is started so that it ENDS there. The explosion itself is the
//    sim's `strike` event, voiced by `BattleAudio.onEvents`, not here.
//
// Time is the sim's: `sim.tickCount * 50` ms, one `update` per tick, so a
// paused game holds the voices and a resume re-derives them at the right
// offset (a clip started late, or after a pause, starts INSIDE the buffer
// where the clock says it should be, never from zero).
//
// Presentation only (invariant 4): the sim is never touched, and the variant and
// pitch draws come from the mixer's own presentation PRNG (`host.rand`).
//
// Three-free on purpose, like the plan maths it imports: this file reaches
// `./three/support-air`, which imports nothing from three.js.

import { FIRE_SUPPORT } from '@lions/sim';
import { ENGINE_PARAM_TAU_S } from './engines';
import {
  JET_LEAD_MS,
  impactWindowMs,
  planSpanMs,
  profileOf,
  supportAirPose,
  type SupportAirPlan,
} from './three/support-air';

/** One sim tick, ms (20 Hz, invariant 1). */
export const SUPPORT_TICK_MS = 50;
/** The rotor fades in and out over this at the span's edges. */
export const ROTOR_FADE_S = 0.25;
/** A plan is dropped this long after its span, so a jet clip that outlasts the
 *  jet's exit (the pass ends 2 s after the bomb, the clip a little later) plays out. */
export const PLAN_TAIL_MS = 2000;
/** A rotor with no `radius_tiles` of its own is heard this far. */
export const ROTOR_DEFAULT_RADIUS_TILES = 30;

/** `data/audio.json`'s `support_air.rotor`: the loop the Peten plays. */
export interface SupportRotorSpec {
  file: string;
  alt?: string;
  license?: string;
  source?: string;
  credit?: string;
  /** The loop's length in seconds (whole AAC frames); `pnpm validate:audio` re-measures it. */
  loop_s?: number;
  channels?: number;
  /** 0..1, on the sfx bus, before placement. Heard at -30 LUFS or under on station. */
  gain?: number;
  /** Audible range in tiles. The Peten holds station 4 tiles out. */
  radius_tiles?: number;
}

/** `data/audio.json`'s `support_air` section. No `rotor` (a commercial build
 *  leaves it out) is no rotor. */
export interface SupportAirSpec {
  rotor?: SupportRotorSpec;
}

/** A set as the support voices see it: decoded takes and the set's own numbers. */
export interface SupportSetView {
  gain: number;
  jitter: number;
  radius: number;
  /** Seconds into a clip where a `flyby` set's pass peaks; null for other sets. */
  crest: number | null;
  buffers: AudioBuffer[];
}

export interface SupportPlacement {
  audible: boolean;
  gain: number;
  pan: number;
  lowpassHz: number;
}

/** What `SupportVoices` borrows from `BattleAudio`. */
export interface SupportHost {
  ctx(): AudioContext | null;
  /** The sfx bus: under the Effects slider and the duck stage. */
  bus(): AudioNode | null;
  /** Presentation randomness, [0, 1). */
  rand(): number;
  /** `placement()` with the given radius. */
  place(dx: number, dy: number, radius: number): SupportPlacement;
  /** Fetch and decode a file (the primary encoding, then `alt`). */
  decode(v: { file: string; alt?: string }): Promise<AudioBuffer | null>;
  /** The decoded set that voices `event` for a sim profile index, or null. */
  setFor(event: 'flyby' | 'incoming', profile: number): SupportSetView | null;
}

// --- the schedule, as pure arithmetic ------------------------------------------
/** How many rounds a plan lands (6 for a barrage, 1 for an air strike). */
export function roundCount(plan: SupportAirPlan): number {
  return FIRE_SUPPORT[profileOf(plan.kind)]?.rounds ?? 0;
}

/** Sim ms at which round `k` of a plan lands: `anchor + first + k * spacing`. */
export function roundImpactMs(plan: SupportAirPlan, k: number): number {
  const row = FIRE_SUPPORT[profileOf(plan.kind)];
  return plan.anchorMs + (row?.delayTicks ?? 0) * SUPPORT_TICK_MS + k * (row?.spacingTicks ?? 0) * SUPPORT_TICK_MS;
}

/**
 * Sim ms at which an air strike's jet clip starts so that the clip's loudness
 * peak (`crestS` into it, played at `rate`) lands when the jet crosses the aim
 * point, `JET_LEAD_MS` before the round: `anchor + first - JET_LEAD_MS -
 * crest_s * 1000 / rate`. At rate 1 that is the plain formula.
 */
export function jetStartMs(plan: SupportAirPlan, crestS: number, rate = 1): number {
  return plan.anchorMs + impactWindowMs('strike').first - JET_LEAD_MS - (crestS * 1000) / rate;
}

/** Sim ms at which a whistle of `durationS` (played at `rate`) must start so that it ends on `impactMs`. */
export function whistleStartMs(impactMs: number, durationS: number, rate = 1): number {
  return impactMs - (durationS * 1000) / rate;
}

/** Sim ms after which a plan has nothing left to schedule and is dropped. */
export function planEndMs(plan: SupportAirPlan): number {
  return plan.anchorMs + planSpanMs(plan.kind).end + PLAN_TAIL_MS;
}

// --- the voices -----------------------------------------------------------------
interface Clip {
  src: AudioBufferSourceNode;
  lp: BiquadFilterNode;
  pan: StereoPannerNode;
  /** The clip's level: placement times set gain, steered each tick. */
  level: GainNode;
  /** The rotor's fade stage; null for a one-shot. */
  fade: GainNode | null;
  nodes: AudioNode[];
  /** The source ended on its own (not released). */
  ended: boolean;
}

interface Choice {
  buffer: AudioBuffer;
  rate: number;
}

interface WhistleState {
  choice: Choice | null;
  clip: Clip | null;
  /** Started and finished, or its impact has passed: never started again. */
  done: boolean;
}

interface PlanState {
  plan: SupportAirPlan;
  jetChoice: Choice | null;
  jet: Clip | null;
  jetDone: boolean;
  whistles: WhistleState[];
  rotor: Clip | null;
}

/** A readback for tests and the sandbox. */
export interface SupportState {
  plans: number;
  jets: number;
  whistles: number;
  rotors: number;
  rotorLoaded: boolean;
}

export class SupportVoices {
  private spec: SupportAirSpec | null = null;
  /** The rotor loop: undefined = not asked for, null = in flight or failed. */
  private rotorBuffer: AudioBuffer | null | undefined = undefined;
  private rotorFile = '';
  private plans: PlanState[] = [];

  // A plain field, not a parameter property: `pnpm audio:mix` serves this
  // file type-stripped (node's strip-only mode), which cannot erase one.
  private readonly host: SupportHost;

  constructor(host: SupportHost) {
    this.host = host;
  }

  useSpec(spec: SupportAirSpec | undefined): void {
    this.spec = spec ?? null;
    this.rotorBuffer = undefined;
    this.rotorFile = '';
  }

  /** A fire-support call was accepted: its plan, from `Renderer.supportCalled`. */
  add(plan: SupportAirPlan): void {
    const rounds = plan.kind === 'barrage' ? roundCount(plan) : 0;
    this.plans.push({
      plan,
      jetChoice: null,
      jet: null,
      jetDone: false,
      whistles: Array.from({ length: rounds }, () => ({ choice: null, clip: null, done: false })),
      rotor: null,
    });
    this.warm();
  }

  /** Decode the rotor loop if a plan wants one and a context exists. Idempotent. */
  warm(): void {
    const rotor = this.spec?.rotor;
    if (!rotor || !this.host.ctx()) return;
    if (this.rotorBuffer !== undefined && this.rotorFile === rotor.file) return;
    this.rotorBuffer = null;
    this.rotorFile = rotor.file;
    const file = rotor.file;
    void this.host.decode(rotor).then((b) => {
      // A different manifest (or a reset) arrived while this decoded: drop it.
      if (this.rotorFile !== file) return;
      this.rotorBuffer = b;
    });
  }

  private pick(set: SupportSetView): Choice | null {
    if (set.buffers.length === 0) return null;
    const buffer = set.buffers[Math.min(set.buffers.length - 1, Math.floor(this.host.rand() * set.buffers.length))];
    if (!buffer) return null;
    const rate = set.jitter > 0 ? 1 + (this.host.rand() * 2 - 1) * set.jitter : 1;
    return { buffer, rate };
  }

  /**
   * One sim tick. `nowMs` is `sim.tickCount * 50`; `listener` is the camera's
   * focus, tiles. `canSound` false (muted, paused, no running context) releases
   * every voice but keeps the plans, so the next tick that may sound re-derives
   * each voice at the offset the clock says.
   */
  update(nowMs: number, listener: { x: number; y: number }, canSound: boolean): void {
    for (let i = this.plans.length - 1; i >= 0; i--) {
      const ps = this.plans[i];
      if (ps && nowMs > planEndMs(ps.plan)) {
        this.releasePlan(ps, ROTOR_FADE_S);
        this.plans.splice(i, 1);
      }
    }
    const ctx = this.host.ctx();
    const bus = this.host.bus();
    if (!canSound || !ctx || !bus) {
      this.stopAll(ROTOR_FADE_S);
      return;
    }
    for (const ps of this.plans) {
      if (ps.plan.kind === 'strike') this.updateJet(ctx, bus, ps, nowMs, listener);
      else {
        this.updateWhistles(ctx, bus, ps, nowMs, listener);
        this.updateRotor(ctx, bus, ps, nowMs, listener);
      }
    }
  }

  /** The chain every clip shares: source -> low-pass -> pan -> level (-> fade) -> bus. */
  private build(ctx: AudioContext, bus: AudioNode, buffer: AudioBuffer, rate: number, loop: boolean): Clip {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    src.playbackRate.value = rate;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const pan = ctx.createStereoPanner();
    const level = ctx.createGain();
    level.gain.value = 0;
    const fade = loop ? ctx.createGain() : null;
    src.connect(lp).connect(pan).connect(level);
    if (fade) level.connect(fade).connect(bus);
    else level.connect(bus);
    const nodes: AudioNode[] = fade ? [src, lp, pan, level, fade] : [src, lp, pan, level];
    const clip: Clip = { src, lp, pan, level, fade, nodes, ended: false };
    src.onended = () => {
      clip.ended = true;
      for (const n of nodes) n.disconnect();
    };
    return clip;
  }

  /** Move a clip's level, pan and low-pass to this tick's placement. */
  private steer(ctx: AudioContext, clip: Clip, p: SupportPlacement, panPlacement: SupportPlacement, gain: number): void {
    const t = ctx.currentTime;
    clip.level.gain.setTargetAtTime(p.audible ? gain * p.gain : 0, t, ENGINE_PARAM_TAU_S);
    clip.pan.pan.setTargetAtTime(panPlacement.pan, t, ENGINE_PARAM_TAU_S);
    clip.lp.frequency.setTargetAtTime(p.lowpassHz || 1200, t, ENGINE_PARAM_TAU_S);
  }

  /** Start a one-shot clip so it is `offsetS` into its buffer (in buffer time) `delayS` from now. */
  private begin(ctx: AudioContext, clip: Clip, delayS: number, offsetS: number): void {
    const t = ctx.currentTime;
    clip.src.start(t + Math.max(0, delayS), Math.max(0, offsetS));
  }

  private updateJet(ctx: AudioContext, bus: AudioNode, ps: PlanState, nowMs: number, l: { x: number; y: number }): void {
    if (ps.jetDone) return;
    const set = this.host.setFor('flyby', profileOf('strike'));
    if (!set || set.crest === null || set.buffers.length === 0) return;
    ps.jetChoice ??= this.pick(set);
    const choice = ps.jetChoice;
    if (!choice) return;
    const startMs = jetStartMs(ps.plan, set.crest, choice.rate);
    const endMs = startMs + (choice.buffer.duration * 1000) / choice.rate;
    if (ps.jet?.ended) {
      ps.jet = null;
      ps.jetDone = true;
      return;
    }
    if (nowMs >= endMs) {
      ps.jetDone = true;
      return;
    }
    if (!ps.jet) {
      // Not yet: the tick before the start schedules it, so a 50 ms tick does not quantise the crest.
      if (startMs > nowMs + SUPPORT_TICK_MS) return;
      const clip = this.build(ctx, bus, choice.buffer, choice.rate, false);
      this.begin(ctx, clip, (startMs - nowMs) / 1000, ((nowMs - startMs) / 1000) * choice.rate);
      ps.jet = clip;
    }
    // Level: the AIM POINT's placement, constant as the jet moves. Pan: the jet's real track.
    const plan = ps.plan;
    const aim = this.host.place(plan.ax - l.x, plan.ay - l.y, set.radius);
    const span = planSpanMs('strike');
    const pose = supportAirPose(plan, Math.max(nowMs, plan.anchorMs + span.start));
    const panFrom = pose ? this.host.place(pose.x - l.x, pose.y - l.y, set.radius) : aim;
    this.steer(ctx, ps.jet, aim, panFrom, set.gain);
  }

  private updateWhistles(ctx: AudioContext, bus: AudioNode, ps: PlanState, nowMs: number, l: { x: number; y: number }): void {
    const set = this.host.setFor('incoming', profileOf('barrage'));
    if (!set || set.buffers.length === 0) return;
    const plan = ps.plan;
    const aim = this.host.place(plan.ax - l.x, plan.ay - l.y, set.radius);
    for (let k = 0; k < ps.whistles.length; k++) {
      const w = ps.whistles[k];
      if (!w || w.done) continue;
      const impactMs = roundImpactMs(plan, k);
      if (w.clip?.ended) {
        w.clip = null;
        w.done = true;
        continue;
      }
      // A round whose impact has passed never gets a whistle (a late decode,
      // a long pause): the explosion is already the sim's.
      if (nowMs >= impactMs) {
        w.done = true;
        continue;
      }
      w.choice ??= this.pick(set);
      if (!w.choice) continue;
      const startMs = whistleStartMs(impactMs, w.choice.buffer.duration, w.choice.rate);
      if (!w.clip) {
        if (startMs > nowMs + SUPPORT_TICK_MS) continue;
        const clip = this.build(ctx, bus, w.choice.buffer, w.choice.rate, false);
        this.begin(ctx, clip, (startMs - nowMs) / 1000, ((nowMs - startMs) / 1000) * w.choice.rate);
        w.clip = clip;
      }
      this.steer(ctx, w.clip, aim, aim, set.gain);
    }
  }

  private updateRotor(ctx: AudioContext, bus: AudioNode, ps: PlanState, nowMs: number, l: { x: number; y: number }): void {
    const spec = this.spec?.rotor;
    if (!spec) return;
    const pose = supportAirPose(ps.plan, nowMs);
    if (pose === null) {
      // Outside the span the gunship is not over the map: no rotor.
      if (ps.rotor) {
        this.release(ps.rotor, ROTOR_FADE_S);
        ps.rotor = null;
      }
      return;
    }
    this.warm();
    const buffer = this.rotorBuffer;
    if (!buffer) return;
    if (ps.rotor?.ended) ps.rotor = null;
    if (!ps.rotor) {
      const clip = this.build(ctx, bus, buffer, 1, true);
      const t = ctx.currentTime;
      clip.fade?.gain.setValueAtTime(0, t);
      clip.fade?.gain.linearRampToValueAtTime(1, t + ROTOR_FADE_S);
      clip.src.start(t, this.host.rand() * buffer.duration);
      ps.rotor = clip;
    }
    const radius = spec.radius_tiles ?? ROTOR_DEFAULT_RADIUS_TILES;
    const p = this.host.place(pose.x - l.x, pose.y - l.y, radius);
    this.steer(ctx, ps.rotor, p, p, spec.gain ?? 1);
  }

  /** Fade a clip out over `fadeS` and stop it there. */
  private release(clip: Clip, fadeS: number): void {
    const ctx = this.host.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const stage = clip.fade ?? clip.level;
    stage.gain.cancelScheduledValues(t);
    stage.gain.setValueAtTime(stage.gain.value, t);
    stage.gain.linearRampToValueAtTime(0, t + fadeS);
    clip.src.stop(t + fadeS);
  }

  private releasePlan(ps: PlanState, fadeS: number): void {
    if (ps.jet) this.release(ps.jet, fadeS);
    ps.jet = null;
    for (const w of ps.whistles) {
      if (w.clip) this.release(w.clip, fadeS);
      w.clip = null;
    }
    if (ps.rotor) this.release(ps.rotor, fadeS);
    ps.rotor = null;
  }

  /** Every voice fades out (mute, pause, no context). The plans are kept, and
   *  the next `update` that may sound brings back what the clock says should be sounding. */
  stopAll(fadeS: number): void {
    for (const ps of this.plans) this.releasePlan(ps, fadeS);
  }

  /** Leaving the mission: every voice out and every plan forgotten. */
  stop(): void {
    this.stopAll(ROTOR_FADE_S);
    this.plans = [];
  }

  state(): SupportState {
    let jets = 0;
    let whistles = 0;
    let rotors = 0;
    for (const ps of this.plans) {
      if (ps.jet) jets++;
      for (const w of ps.whistles) if (w.clip) whistles++;
      if (ps.rotor) rotors++;
    }
    return { plans: this.plans.length, jets, whistles, rotors, rotorLoaded: !!this.rotorBuffer };
  }
}
