/**
 * Vehicles bend the vegetation (GH-984 N2): a uniform array of DISTURBERS the foliage and trunk
 * vertex shader loops over, and the pure, three-free maths that fills and reads it.
 *
 * OPTION A of the design (the lead's pick, 3 Nov): a small array of capsules, +0 draw calls, +0
 * programs (the chunk rides the wind's). Not a render target: a wake lasts 1.5 s, not 10.
 *
 * WHAT A DISTURBER IS. `a = (ax, az, bx, bz)` and `b = (radius, strength, kind)`. A moving hull is a
 * CAPSULE from where it is now (`a.xy`, the sim's interpolated position `lerp(prev, cur, alpha)`,
 * never the drawn hull, whose weight lag is per-frame) back to where it was `DISTURB_WAKE_TICKS`
 * (1.5 s) ago (`a.zw`, from a per-entity ring of TICK positions). A parked hull is the same
 * capsule with no length: a disc of its `RADIUS_BY_TYPE`. Infantry (high only) are discs at a
 * fraction of the strength.
 *
 * THE CLOCK. Everything here is a function of (the ticks the sim has run, alpha): the ring is
 * written by `ThreeRenderer.snapshot()`, once per sim tick, never by a frame, so two frame
 * cadences that reach the same tick hold the same ring and draw the same wake
 * (`ThreeRenderer.disturb-clock.test.ts`). No frame delta, `performance.now` or `Date.now`
 * anywhere in this file (`disturb.test.ts` scans it).
 *
 * THE BEND. For one vertex of one instance (origin `o`, the instance's world position):
 *  - each disturber pushes the instance away from the nearest point of its capsule, by
 *    `strength x falloff(distance) x profile(t)`, `t` in [0, 1] from the head to the tail;
 *  - the pushes add as vectors (so two hulls either side cancel, and a spring overshoot pulls
 *    toward the track), their length clamped to 1;
 *  - the vertex is ROTATED about the instance's foot, away from the push, by
 *    `amount x (height in the family's box)^stiffness x thetaMax(class)`, where `thetaMax`
 *    flattens the tip to at most `cap` of its height (`acos(1 - cap)`): a grass blade lies down
 *    to 0.8 of its height, a shrub bends 0.35 of its own.
 * The profile is a damped spring released at the head (springs back in the wake, with a small
 * overshoot), or, under reduced motion, a monotone fall: a static displacement with no spring.
 *
 * THE WASH (GH-984 N3). A helicopter takes a slot of its own kind (`b.z` 1): a disc, never a wake, whose radius is
 * `R0 x (1.5 + hNorm)` (R0 2 tiles, `hNorm` 0 on the ground to 1 at the wash's none-height) and whose strength IS the
 * rotor wash (`units/rotor-wash.ts`, from the drawn lift and the tick-exact speed). The push is the same radial one, so
 * grass and reeds flatten outward; and the strength a slot adds is also summed on its own, as the THRASH: shrubs and
 * crowns oscillate about their lean at `DISTURB_THRASH_PERIOD_S` (0.4 s) on the SIM clock (`uSwayTime`), each
 * instance at its own phase. Reduced motion (`uDisturbSpring` 0) keeps the flatten and drops the thrash.
 *
 * A uniform bounding box of every disturber lets most vertices skip the loop. The shadow and AO
 * passes keep the rest pose, as for the wind. Nothing here reads or writes sim state.
 */
import { QUALITY_PRESETS, type NatureQuality, type RenderQuality } from '../../quality';
import { ROTOR_WASH_MIN_STRENGTH, rotorWashHeightNorm, rotorWashStrength } from '../units/rotor-wash';
import { WIND_CLASS_GRASS, WIND_CLASS_REED, WIND_CLASS_SHRUB, WIND_CLASS_TREE } from './wind';

// --- the budget -----------------------------------------------------------------------------------

/** The most disturbers any preset loops over: the uniform arrays are this long. */
export const DISTURB_MAX = 24;
/** The ladder the cost run steps a preset down when it is over budget. */
export const DISTURB_LADDER: readonly (0 | 8 | 16 | 24)[] = [24, 16, 8, 0];

/** A preset's disturber budget (`RenderQuality.nature`); a caller with no opinion reads `high`'s. */
export function natureQualityOf(quality: RenderQuality | undefined): NatureQuality {
  return quality?.nature ?? QUALITY_PRESETS.high.nature ?? { slots: 24, wakes: true, foot: true };
}

// --- the wake -------------------------------------------------------------------------------------

/** Ring samples per entity, and the ticks between two: 8 x 5 ticks = 1.75 s of history at 20 Hz. */
export const DISTURB_RING_SAMPLES = 8;
export const DISTURB_RING_SPACING_TICKS = 5;
/** The tail of a wake: 1.5 s (30 ticks) before the head. */
export const DISTURB_WAKE_TICKS = 30;
export const DISTURB_WAKE_S = 1.5;
/** A wake shorter than this (tiles) is a disc: the profile blends to 1 (a hull that has just stopped is not a streak). */
export const DISTURB_WAKE_MIN_LEN = 0.3;

/** A hull's push is full inside `CORE x radius` of its capsule and gone at `REACH x radius`. */
export const DISTURB_CORE = 0.55;
export const DISTURB_REACH = 1.25;
/** What an infantryman pushes with, against a hull's 1 (design decision 5: weakly). */
export const DISTURB_FOOT_STRENGTH = 0.25;

/** The rotor wash's radius is `R0 x (1.5 + hNorm)` tiles (R0 2, was the design's 1.2: "make it stronger", 5 Nov); it is the OUTER reach, where the push is gone. */
export const DISTURB_WASH_R0_TILES = 2;
export const DISTURB_WASH_RADIUS_BASE = 1.5;
/** The thrash of a shrub or a crown under the wash: this period, on the sim clock. */
export const DISTURB_THRASH_PERIOD_S = 0.4;
/**
 * A wash slot's push counts this many times over a hull's (the lean AND the thrash sum). The lean clamps at 1, so the gain widens the
 * disc that lies fully down (a strength 0.76 hover reaches the cap out to where the falloff has dropped to 1/1.7) and drives
 * the shrubs and crowns harder; a hull's push is untouched. (5 Nov, "make it stronger".)
 */
export const DISTURB_WASH_PUSH_GAIN = 1.7;
/** What a slot is, in `b.z`: the ground (a hull or a man) or a rotor wash (which also thrashes). */
export const DISTURB_SLOT_GROUND = 0;
export const DISTURB_SLOT_WASH = 1;
/** Floats per slot in `b`: radius, strength, slot kind. */
export const DISTURB_B_STRIDE = 3;

/** The wash's outer radius in tiles at a height-norm `hNorm` (0 on the ground, 1 at the wash's none-height). */
export function disturbWashRadius(hNorm: number): number {
  return DISTURB_WASH_R0_TILES * (DISTURB_WASH_RADIUS_BASE + hNorm);
}

/**
 * The spring a blade is released on as the hull passes: natural frequency 1.1 Hz, damping ratio 0.45,
 * so it overshoots by 20% and has settled by the tail's 1.5 s (envelope 0.9%). `FLOOR` bounds the
 * overshoot, a safety value the curve never reaches.
 */
export const DISTURB_SPRING_HZ = 1.1;
export const DISTURB_SPRING_ZETA = 0.45;
export const DISTURB_SPRING_FLOOR = -0.3;

// --- the classes ----------------------------------------------------------------------------------

export interface DisturbClass {
  readonly name: 'grass' | 'reed' | 'shrub' | 'tree';
  /** The share of its height the tip is flattened by at full push: 0.8 grass and 0.35 shrub are the lead's. */
  readonly cap: number;
  /** `weight = (height in the family's box) ^ stiffness`: bigger bends later and harder at the tip. */
  readonly stiffness: number;
  /** The share of its height the tip swings by, each way, under a full wash (the thrash): 0 for what only flattens. */
  readonly thrash: number;
}

/** Indexed by the wind's class id (`rlNature.y`). Reed and tree values are mine, for the mock to judge. */
export const DISTURB_CLASSES: readonly DisturbClass[] = [
  { name: 'grass', cap: 0.8, stiffness: 1.2, thrash: 0 },
  { name: 'reed', cap: 0.7, stiffness: 1.2, thrash: 0 },
  { name: 'shrub', cap: 0.35, stiffness: 1.5, thrash: 0.16 },
  { name: 'tree', cap: 0.01, stiffness: 2, thrash: 0.07 },
];

if (
  DISTURB_CLASSES[WIND_CLASS_GRASS].name !== 'grass' ||
  DISTURB_CLASSES[WIND_CLASS_REED].name !== 'reed' ||
  DISTURB_CLASSES[WIND_CLASS_SHRUB].name !== 'shrub' ||
  DISTURB_CLASSES[WIND_CLASS_TREE].name !== 'tree'
) {
  throw new Error('DISTURB_CLASSES is out of step with the wind classes');
}

/** The tip's rotation at full push, radians: it ends `cap` of its height lower. */
export function disturbThetaMax(cls: number): number {
  return Math.acos(1 - DISTURB_CLASSES[cls].cap);
}

/** The thrash's swing each way at a full wash, radians (0 for a class that only flattens). */
export function disturbThrashMax(cls: number): number {
  return Math.acos(1 - DISTURB_CLASSES[cls].thrash);
}

// --- the maths (the shader's mirror) --------------------------------------------------------------

function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** `t` in [0, 1]: where along the capsule from the head (0) to the tail (1) the point `o` is nearest. */
export function disturbT(ox: number, oz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-8) return 0;
  return Math.min(1, Math.max(0, ((ox - ax) * dx + (oz - az) * dz) / len2));
}

/** The release curve at `t` along the wake: the spring (`spring` 1) or the monotone fall (`spring` 0). */
export function disturbProfile(t: number, spring: number): number {
  const w = 2 * Math.PI * DISTURB_SPRING_HZ;
  const z = DISTURB_SPRING_ZETA;
  const wd = w * Math.sqrt(1 - z * z);
  const tau = t * DISTURB_WAKE_S;
  const osc = Math.exp(-z * w * tau) * (Math.cos(wd * tau) + ((z * w) / wd) * Math.sin(wd * tau));
  const calm = 1 - smoothstep(0, 1, t);
  const springy = Math.max(osc, DISTURB_SPRING_FLOOR);
  return calm + (springy - calm) * spring;
}

/**
 * One disturber's signed push on an instance at distance `d` from its capsule, `t` along it, the
 * capsule `len` tiles long. A wake shorter than `DISTURB_WAKE_MIN_LEN` blends to the disc's flat 1.
 */
export function disturbAmount(d: number, t: number, len: number, radius: number, strength: number, spring: number): number {
  const falloff = 1 - smoothstep(DISTURB_CORE * radius, DISTURB_REACH * radius, d);
  const wake = smoothstep(0, DISTURB_WAKE_MIN_LEN, len);
  const profile = 1 + (disturbProfile(t, spring) - 1) * wake;
  return strength * falloff * profile;
}

/** The rotation of a vertex whose family-box height is `hN`, for a push of length `mag`. */
export function disturbAngle(cls: number, hN: number, mag: number): number {
  const c = DISTURB_CLASSES[cls];
  const weight = Math.pow(Math.min(1, Math.max(0, hN)), c.stiffness);
  return Math.min(1, mag) * weight * disturbThetaMax(cls);
}

/** Where in its cycle an instance at world `(ox, oz)` is: neighbours differ, so a stand of crowns does not beat in unison. 0..1. */
export function disturbPhase(ox: number, oz: number): number {
  const p = ox * 0.7361 + oz * 0.4219;
  return p - Math.floor(p);
}

/**
 * The thrash: a swing about the lean, `sin` of the SIM clock at the period, scaled by the wash a vertex stands in
 * (`wash`, the sum of the wash slots' pushes there, capped at 1) and the same height weight as the lean.
 * Signed: it swings back toward the hull as well as away.
 */
export function disturbThrash(cls: number, hN: number, wash: number, tSec: number, phase: number): number {
  const c = DISTURB_CLASSES[cls];
  const weight = Math.pow(Math.min(1, Math.max(0, hN)), c.stiffness);
  return Math.min(1, wash) * weight * disturbThrashMax(cls) * Math.sin(2 * Math.PI * (tSec / DISTURB_THRASH_PERIOD_S + phase));
}

/** A vertex at `along` the push direction and `h` above the foot, rotated by `theta` about the foot. */
export function disturbAlong(along: number, h: number, theta: number): number {
  return along * Math.cos(theta) + h * Math.sin(theta);
}
export function disturbUp(along: number, h: number, theta: number): number {
  return h * Math.cos(theta) - along * Math.sin(theta);
}

export interface DisturberSlot {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly radius: number;
  readonly strength: number;
  /** `DISTURB_SLOT_WASH` for a rotor wash (default `DISTURB_SLOT_GROUND`). */
  readonly kind?: number;
}

/**
 * The world-space displacement of one vertex under `slots`: the shader's loop and rotation, whole.
 * `rel` is the vertex relative to the instance's foot (`x`, `h` up, `z`); the instance's foot is `(ox, oz)`.
 */
export function disturbDisplacement(
  slots: readonly DisturberSlot[],
  cls: number,
  hN: number,
  ox: number,
  oz: number,
  rel: { x: number; h: number; z: number },
  spring: number,
  tSec = 0
): { dx: number; dy: number; dz: number } {
  let px = 0;
  let pz = 0;
  let wash = 0;
  for (const s of slots) {
    const t = disturbT(ox, oz, s.ax, s.az, s.bx, s.bz);
    let awayX = ox - (s.ax + (s.bx - s.ax) * t);
    let awayZ = oz - (s.az + (s.bz - s.az) * t);
    const d = Math.hypot(awayX, awayZ);
    if (d > 1e-4) {
      awayX /= d;
      awayZ /= d;
    } else {
      awayX = 1;
      awayZ = 0;
    }
    const amount = disturbAmount(d, t, Math.hypot(s.bx - s.ax, s.bz - s.az), s.radius, s.strength, spring);
    const isWash = s.kind === DISTURB_SLOT_WASH;
    const pushed = isWash ? amount * DISTURB_WASH_PUSH_GAIN : amount;
    px += awayX * pushed;
    pz += awayZ * pushed;
    if (isWash) wash += pushed;
  }
  const mag = Math.hypot(px, pz);
  if (mag <= 1e-5) return { dx: 0, dy: 0, dz: 0 };
  const dirX = px / mag;
  const dirZ = pz / mag;
  const theta = disturbAngle(cls, hN, mag) + disturbThrash(cls, hN, wash, tSec, disturbPhase(ox, oz)) * spring;
  const along = rel.x * dirX + rel.z * dirZ;
  const dAlong = disturbAlong(along, rel.h, theta) - along;
  return { dx: dirX * dAlong, dy: disturbUp(along, rel.h, theta) - rel.h, dz: dirZ * dAlong };
}

// --- the tick ring --------------------------------------------------------------------------------

/**
 * Per-entity positions at ticks that are multiples of `DISTURB_RING_SPACING_TICKS`, the last
 * `DISTURB_RING_SAMPLES` of them. Written by `record`/`seed` from the renderer's per-tick
 * `snapshot()` and by nothing else; `at` reads a position at a fractional tick between two samples.
 */
export class WakeRing {
  private readonly xs: Float64Array;
  private readonly zs: Float64Array;
  /** The newest sample's tick per entity; -1 for an entity never seeded. */
  private readonly newest: Int32Array;

  constructor(capacity: number) {
    this.xs = new Float64Array(capacity * DISTURB_RING_SAMPLES);
    this.zs = new Float64Array(capacity * DISTURB_RING_SAMPLES);
    this.newest = new Int32Array(capacity).fill(-1);
  }

  /** True once `entity` has a ring (a newcomer, or one that teleported, is `seed`ed first). */
  seeded(entity: number): boolean {
    return this.newest[entity] >= 0;
  }

  /**
   * Fills every sample of `entity` with one position: its history is "here". The aligned ticks run back
   * from `tick`, so the ring is exactly the one `record` would have built had it stood here all along.
   */
  seed(entity: number, tick: number, x: number, z: number): void {
    const aligned = tick - (tick % DISTURB_RING_SPACING_TICKS);
    for (let k = 0; k < DISTURB_RING_SAMPLES; k++) {
      const t = aligned - k * DISTURB_RING_SPACING_TICKS;
      const slot = this.slotOf(entity, t);
      this.xs[slot] = x;
      this.zs[slot] = z;
    }
    this.newest[entity] = aligned;
  }

  /** Records `tick`'s position. Only ticks that are multiples of the spacing are samples; others are ignored. */
  record(entity: number, tick: number, x: number, z: number): void {
    if (tick % DISTURB_RING_SPACING_TICKS !== 0) return;
    const slot = this.slotOf(entity, tick);
    this.xs[slot] = x;
    this.zs[slot] = z;
    this.newest[entity] = tick;
  }

  private slotOf(entity: number, tick: number): number {
    const k = tick / DISTURB_RING_SPACING_TICKS;
    return entity * DISTURB_RING_SAMPLES + (((k % DISTURB_RING_SAMPLES) + DISTURB_RING_SAMPLES) % DISTURB_RING_SAMPLES);
  }

  /** The position at tick-time `time` (fractional ticks), clamped to the span the ring holds. */
  at(entity: number, time: number, out: { x: number; z: number }): void {
    const newest = this.newest[entity];
    const oldest = newest - (DISTURB_RING_SAMPLES - 1) * DISTURB_RING_SPACING_TICKS;
    const t = Math.min(newest, Math.max(oldest, time));
    const k0 = Math.floor(t / DISTURB_RING_SPACING_TICKS);
    const f = t / DISTURB_RING_SPACING_TICKS - k0;
    const s0 = this.slotOf(entity, k0 * DISTURB_RING_SPACING_TICKS);
    const s1 = this.slotOf(entity, (k0 + 1) * DISTURB_RING_SPACING_TICKS);
    // `f` is 0 at the newest sample, which has no successor: read it alone.
    if (f === 0) {
      out.x = this.xs[s0];
      out.z = this.zs[s0];
      return;
    }
    out.x = this.xs[s0] + (this.xs[s1] - this.xs[s0]) * f;
    out.z = this.zs[s0] + (this.zs[s1] - this.zs[s0]) * f;
  }
}

// --- choosing and building the disturbers ---------------------------------------------------------

/** What a unit TYPE does to vegetation: nothing (a drone, or anything soft in the air: it throws no wash), a hull (`mobility.wheeled`,
 *  tracked included), anything else on foot, which bends grass weakly at `high` whether it walks or stands (a parked crew included:
 *  a man standing in grass presses it too), or a rotorcraft, whose wash flattens and thrashes (GH-984 N3). */
export const DISTURB_KIND_NONE = 0;
export const DISTURB_KIND_HULL = 1;
export const DISTURB_KIND_FOOT = 2;
export const DISTURB_KIND_AIR = 3;

export interface DisturbSource {
  readonly alive: ArrayLike<number>;
  readonly typeIdx: ArrayLike<number>;
  readonly prevX: ArrayLike<number>;
  readonly prevZ: ArrayLike<number>;
  readonly curX: ArrayLike<number>;
  readonly curZ: ArrayLike<number>;
  /** By type index: `DISTURB_KIND_*`. */
  readonly kindOfType: ArrayLike<number>;
  /** By type index: the disc radius, tiles (`RADIUS_BY_TYPE`). */
  readonly radiusOfType: ArrayLike<number>;
  /** Per entity: the last tick's speed, tiles/s (tick-exact, so the wash is a function of the tick). */
  readonly speed: ArrayLike<number>;
  /** An air entity's lift above the ground at `alpha`, world units (a function of the sim's air state and `alpha`, never of the drawn hull). */
  airHeight(entity: number, alpha: number): number;
  /** An entity the viewer cannot see, or that is underground, garrisoned or otherwise not on the ground. */
  skip(entity: number): boolean;
}

export interface DisturbFrame {
  /** Entities `0..count-1` are readable (the renderer's `snapshottedCount`). */
  count: number;
  /** The sim's tick count, and the fraction of the way to the next one this frame presents. */
  tick: number;
  alpha: number;
  /** The camera's ground focus, tiles; disturbers are ranked by distance to it. */
  focusX: number;
  focusZ: number;
  /** Beyond this (tiles) from the focus a disturber cannot touch what is on screen. */
  viewRadius: number;
  /** The preset's budget (`NatureQuality`). */
  slots: number;
  wakes: boolean;
  foot: boolean;
  /** False while the `wash` debug layer is hidden: helicopters take no slot. */
  air: boolean;
}

/**
 * The array the shader reads, and the machinery that fills it. One per renderer; `build` allocates
 * nothing. `a`, `b` and `box` are the uniform values themselves (`disturb-uniforms.ts` binds them).
 */
export class DisturbField {
  readonly ring: WakeRing;
  /** `(ax, az, bx, bz)` per slot. */
  readonly a = new Float32Array(DISTURB_MAX * 4);
  /** `(radius, strength, kind)` per slot (`DISTURB_B_STRIDE`). */
  readonly b = new Float32Array(DISTURB_MAX * DISTURB_B_STRIDE);
  /** `(minX, minZ, maxX, maxZ)` of every slot's reach, tiles; empty when `count` is 0. */
  readonly box = new Float32Array(4);
  count = 0;
  private readonly ids = new Int32Array(DISTURB_MAX);
  private readonly keys = new Float64Array(DISTURB_MAX);
  private chosen = 0;
  private readonly tail = { x: 0, z: 0 };

  constructor(capacity: number) {
    this.ring = new WakeRing(capacity);
  }

  /** A rotorcraft's wash this frame: its strength, or 0 when it is too high or too fast to move anything (`ROTOR_WASH_MIN_STRENGTH`). */
  private washOf(src: DisturbSource, i: number, alpha: number): number {
    const s = rotorWashStrength(src.airHeight(i, alpha), src.speed[i]);
    return s < ROTOR_WASH_MIN_STRENGTH ? 0 : s;
  }

  /** Vehicles and rotorcraft first (key 0 + d^2), then foot (key 1e9 + d^2): an insertion into a sorted list of at most `slots`. */
  private offer(entity: number, foot: boolean, d2: number, slots: number): void {
    const key = (foot ? 1e9 : 0) + d2;
    if (this.chosen >= slots && key >= this.keys[this.chosen - 1]) return;
    let k = this.chosen < slots ? this.chosen++ : this.chosen - 1;
    while (k > 0 && this.keys[k - 1] > key) {
      this.keys[k] = this.keys[k - 1];
      this.ids[k] = this.ids[k - 1];
      k--;
    }
    this.keys[k] = key;
    this.ids[k] = entity;
  }

  /** Fills `a`, `b`, `box` and `count` for this frame. */
  build(src: DisturbSource, f: DisturbFrame): void {
    const slots = Math.min(DISTURB_MAX, Math.max(0, f.slots));
    this.chosen = 0;
    if (slots > 0) {
      const r2 = f.viewRadius * f.viewRadius;
      for (let i = 0; i < f.count; i++) {
        if (src.alive[i] === 0) continue;
        const kind = src.kindOfType[src.typeIdx[i]];
        if (kind === DISTURB_KIND_NONE || (kind === DISTURB_KIND_FOOT && !f.foot) || (kind === DISTURB_KIND_AIR && !f.air)) continue;
        const x = src.prevX[i] + (src.curX[i] - src.prevX[i]) * f.alpha;
        const z = src.prevZ[i] + (src.curZ[i] - src.prevZ[i]) * f.alpha;
        const d2 = (x - f.focusX) * (x - f.focusX) + (z - f.focusZ) * (z - f.focusZ);
        if (d2 > r2 || src.skip(i)) continue;
        if (kind === DISTURB_KIND_AIR && this.washOf(src, i, f.alpha) === 0) continue;
        this.offer(i, kind === DISTURB_KIND_FOOT, d2, slots);
      }
    }
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    const time = f.tick - 1 + f.alpha - DISTURB_WAKE_TICKS;
    for (let k = 0; k < this.chosen; k++) {
      const i = this.ids[k];
      const type = src.typeIdx[i];
      const kind = src.kindOfType[type];
      const foot = kind === DISTURB_KIND_FOOT;
      const air = kind === DISTURB_KIND_AIR;
      const hx = src.prevX[i] + (src.curX[i] - src.prevX[i]) * f.alpha;
      const hz = src.prevZ[i] + (src.curZ[i] - src.prevZ[i]) * f.alpha;
      let tx = hx;
      let tz = hz;
      if (f.wakes && !foot && !air && this.ring.seeded(i)) {
        this.ring.at(i, time, this.tail);
        tx = this.tail.x;
        tz = this.tail.z;
      }
      let radius = src.radiusOfType[type];
      let strength = foot ? DISTURB_FOOT_STRENGTH : 1;
      if (air) {
        // The wash's radius is the OUTER reach (where the push is gone), so the ring radius the falloff is written in is that over `REACH`.
        radius = disturbWashRadius(rotorWashHeightNorm(src.airHeight(i, f.alpha))) / DISTURB_REACH;
        strength = this.washOf(src, i, f.alpha);
      }
      this.a[4 * k] = hx;
      this.a[4 * k + 1] = hz;
      this.a[4 * k + 2] = tx;
      this.a[4 * k + 3] = tz;
      this.b[DISTURB_B_STRIDE * k] = radius;
      this.b[DISTURB_B_STRIDE * k + 1] = strength;
      this.b[DISTURB_B_STRIDE * k + 2] = air ? DISTURB_SLOT_WASH : DISTURB_SLOT_GROUND;
      const reach = radius * DISTURB_REACH;
      minX = Math.min(minX, hx - reach, tx - reach);
      minZ = Math.min(minZ, hz - reach, tz - reach);
      maxX = Math.max(maxX, hx + reach, tx + reach);
      maxZ = Math.max(maxZ, hz + reach, tz + reach);
    }
    this.count = this.chosen;
    if (this.chosen === 0) {
      this.box.fill(0);
    } else {
      this.box[0] = minX;
      this.box[1] = minZ;
      this.box[2] = maxX;
      this.box[3] = maxZ;
    }
  }
}

// --- the GLSL -------------------------------------------------------------------------------------

/** A GLSL float literal carrying enough digits that `toFixed(8)` of the same constant is the literal. */
export function disturbFloat(k: number): string {
  return k.toFixed(8);
}

function table(pick: (c: DisturbClass, i: number) => number): string {
  return `float[4](${DISTURB_CLASSES.map((c, i) => disturbFloat(pick(c, i))).join(', ')})`;
}

/**
 * The scalar GLSL functions (`disturb.test.ts` transpiles and RUNS them against the TS mirrors above,
 * so the displacement the GPU computes is compared on real numbers, not only by searching the source
 * for its constants). Written in the subset the wind's twin harness handles: float and int arguments,
 * float returns, `float[4]` tables.
 */
export function disturbMathGlsl(): string {
  const w = 2 * Math.PI * DISTURB_SPRING_HZ;
  const wd = w * Math.sqrt(1 - DISTURB_SPRING_ZETA * DISTURB_SPRING_ZETA);
  return `
const float RL_DISTURB_THETA[4] = ${table((_c, i) => disturbThetaMax(i))};
const float RL_DISTURB_STIFF[4] = ${table((c) => c.stiffness)};
const float RL_DISTURB_THRASH[4] = ${table((_c, i) => disturbThrashMax(i))};
float rlDisturbT(float ox, float oz, float ax, float az, float bx, float bz) {
  float dx = bx - ax;
  float dz = bz - az;
  float len2 = dx * dx + dz * dz;
  if (len2 < 0.00000001) return 0.0;
  return clamp(((ox - ax) * dx + (oz - az) * dz) / len2, 0.0, 1.0);
}
float rlDisturbProfile(float t, float spring) {
  float tau = t * ${disturbFloat(DISTURB_WAKE_S)};
  float osc = exp(-${disturbFloat(DISTURB_SPRING_ZETA * w)} * tau) * (cos(${disturbFloat(wd)} * tau) + ${disturbFloat((DISTURB_SPRING_ZETA * w) / wd)} * sin(${disturbFloat(wd)} * tau));
  float calm = 1.0 - smoothstep(0.0, 1.0, t);
  float springy = max(osc, ${disturbFloat(DISTURB_SPRING_FLOOR)});
  return calm + (springy - calm) * spring;
}
float rlDisturbAmount(float d, float t, float len, float radius, float strength, float spring) {
  float falloff = 1.0 - smoothstep(${disturbFloat(DISTURB_CORE)} * radius, ${disturbFloat(DISTURB_REACH)} * radius, d);
  float wake = smoothstep(0.0, ${disturbFloat(DISTURB_WAKE_MIN_LEN)}, len);
  float profile = 1.0 + (rlDisturbProfile(t, spring) - 1.0) * wake;
  return strength * falloff * profile;
}
float rlDisturbAngle(int cls, float hN, float mag) {
  float weight = pow(clamp(hN, 0.0, 1.0), RL_DISTURB_STIFF[cls]);
  return min(mag, 1.0) * weight * RL_DISTURB_THETA[cls];
}
float rlDisturbThrash(int cls, float hN, float wash, float tSec, float phase) {
  float weight = pow(clamp(hN, 0.0, 1.0), RL_DISTURB_STIFF[cls]);
  return min(wash, 1.0) * weight * RL_DISTURB_THRASH[cls] * sin(6.28318531 * (tSec / ${disturbFloat(DISTURB_THRASH_PERIOD_S)} + phase));
}
float rlDisturbAlong(float along, float h, float theta) {
  return along * cos(theta) + h * sin(theta);
}
float rlDisturbUp(float along, float h, float theta) {
  return h * cos(theta) - along * sin(theta);
}
`;
}

/** The uniforms the disturbance reads. `uDisturbN` is the count, `uDisturbAmp` the layer toggle (1 shipped), `uDisturbSpring` 1 or, in reduced motion, 0. */
export const DISTURB_UNIFORM_DECLS = `uniform vec4 uDisturbA[${DISTURB_MAX}];
uniform vec3 uDisturbB[${DISTURB_MAX}];
uniform vec4 uDisturbBox;
uniform float uDisturbN;
uniform float uDisturbAmp;
uniform float uDisturbSpring;`;

/**
 * The GLSL spliced after the wind's chunk (`windVertexChunk`), inside the same `#include <project_vertex>` anchor.
 * It needs the instance's WORLD foot and the vertex's world position, as the wind does, and rewrites
 * `mvPosition`/`gl_Position` the same way, so a moved vertex is lit where it is drawn.
 */
export function disturbVertexChunk(): string {
  return `
{
#ifdef USE_BATCHING
  mat4 rlDModel = modelMatrix * batchingMatrix;
#else
  mat4 rlDModel = modelMatrix;
#endif
  vec3 rlDOrigin = rlDModel[3].xyz;
  if (uDisturbN * uDisturbAmp > 0.5
      && rlDOrigin.x > uDisturbBox.x && rlDOrigin.x < uDisturbBox.z
      && rlDOrigin.z > uDisturbBox.y && rlDOrigin.z < uDisturbBox.w) {
    vec2 rlDPush = vec2(0.0);
    float rlDWash = 0.0;
    for (int rlDi = 0; rlDi < ${DISTURB_MAX}; rlDi++) {
      if (float(rlDi) >= uDisturbN) break;
      vec4 rlDA = uDisturbA[rlDi];
      vec3 rlDB = uDisturbB[rlDi];
      float rlDT = rlDisturbT(rlDOrigin.x, rlDOrigin.z, rlDA.x, rlDA.y, rlDA.z, rlDA.w);
      vec2 rlDAway = rlDOrigin.xz - (rlDA.xy + (rlDA.zw - rlDA.xy) * rlDT);
      float rlDDist = length(rlDAway);
      rlDAway = rlDDist > 0.0001 ? rlDAway / rlDDist : vec2(1.0, 0.0);
      float rlDAmt = rlDisturbAmount(rlDDist, rlDT, length(rlDA.zw - rlDA.xy), rlDB.x, rlDB.y, uDisturbSpring);
      float rlDPushed = rlDAmt * (1.0 + rlDB.z * ${disturbFloat(DISTURB_WASH_PUSH_GAIN - 1)});
      rlDPush += rlDAway * rlDPushed;
      rlDWash += rlDB.z * rlDPushed;
    }
    float rlDMag = length(rlDPush);
    if (rlDMag > 0.00001) {
      vec2 rlDDir = rlDPush / rlDMag;
      float rlDPhase = fract(rlDOrigin.x * 0.7361 + rlDOrigin.z * 0.4219);
      float rlDTheta = rlDisturbAngle(int(rlNature.y + 0.5), rlNature.x, rlDMag);
      // The thrash is only evaluated where a wash reaches (no helicopter, no pow and sin: N2's cost is N2's).
      if (rlDWash > 0.0001) {
        rlDTheta += rlDisturbThrash(int(rlNature.y + 0.5), rlNature.x, rlDWash, uSwayTime, rlDPhase) * uDisturbSpring;
      }
      vec3 rlDRel = (rlDModel * vec4(transformed, 1.0)).xyz - rlDOrigin;
      float rlDAlong = dot(rlDRel.xz, rlDDir);
      float rlDMove = rlDisturbAlong(rlDAlong, rlDRel.y, rlDTheta) - rlDAlong;
      float rlDLift = rlDisturbUp(rlDAlong, rlDRel.y, rlDTheta) - rlDRel.y;
      mvPosition += viewMatrix * vec4(rlDDir.x * rlDMove, rlDLift, rlDDir.y * rlDMove, 0.0);
      gl_Position = projectionMatrix * mvPosition;
    }
  }
}
`;
}
