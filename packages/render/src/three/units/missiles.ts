/**
 * The ATGM/RPG/HEAT flight model (GH-250 T2). Pure, three-free: everything
 * here is arithmetic over plain numbers, so it is testable under plain
 * vitest and has no import of `three`. Task 3 (a `three.Points`/line renderer)
 * and Tasks 5-6 (spawn/impact wiring) consume this module's exports; nothing
 * in `packages/sim` changes for this plan.
 *
 * Four design decisions, referenced by the letter used in the plan doc:
 *
 * D1 -- the flight TIME is copied from the sim's own resolution, not read
 * from it at runtime. `packages/sim/src/tuning.ts`'s `PROJ_SPEED` and
 * `sim.ts`'s `stepProjectiles` decide, in fixed-point ticks, exactly which
 * tick a round resolves on; the renderer must not re-decide that, or a
 * missile's flight and its impact event drift apart. But invariant 4 (data
 * flows sim -> events out, nothing outside mutates or re-derives it) does not
 * forbid a *presentation* layer computing an ANIMATION duration from the same
 * numbers the sim used to decide timing -- the render package already imports
 * `@lions/sim` read-only for types and constants elsewhere in this tree, and
 * `WEAPON_CLASS`/`PROJ_SPEED` are exactly that: read-only constants. Copying
 * the speed table (`SIM_PROJ_SPEED_TILES_S`) rather than importing
 * `PROJ_SPEED` directly keeps this module's units in tiles/second (Fx would
 * leak a sim-internal representation into a presentation module for no
 * reason); the tuning-pin test below re-derives the same numbers from
 * `tuning.ts`'s own source text, so the copy cannot silently drift.
 * `missileDurationS` mirrors `stepProjectiles`'s own quantisation: a round's
 * flight is `ceil(distTiles / (speed * TICK_S))` whole ticks, and it resolves
 * on the tick *after* it was fired (see the comment on the duration test in
 * missiles.test.ts, and the two measured examples from 9e9b0640) -- so the
 * animation plays for `(n - 1)` ticks, never zero, capped at
 * `MISSILE_MAX_DURATION_S` so a wildly out-of-range capture can't hang a
 * flight forever.
 *
 * D2 -- variant selection is a whitelist (`TOP_ATTACK_WEAPON_IDS`), not a
 * property read off the weapon's own JSON. The sim's `WeaponStats` carries no
 * "is top-attack" flag today, and inventing one there would be a sim change
 * this plan does not make. A named set, pinned by a test that walks every
 * shipped unit and asserts every top-attack id actually exists as an `atgm`
 * weapon somewhere, is the safer place for this fact to live until (if ever)
 * it earns a schema field.
 *
 * D3 -- the path is a pure function of `u` (progress, 0..1), not of elapsed
 * time. `stepMissiles` advances `t` and calls `missilePointAt(m, t/duration)`
 * only to decide where to draw and when to land; Task 3's renderer can also
 * call `missilePointAt` directly (e.g. to draw a trail a few `u` back) without
 * re-deriving the arc. Two curve families: `parabola` (symmetric hump,
 * `apexU` fixed at 0.5, used for `guided`/`unguided`/`warhead`) and
 * `climb_dive` (asymmetric, used for `top_attack`: a sine ease-in climb to
 * the apex at N4's authored `apexU = 0.4`, then a `1 - q^TOP_ATTACK_DIVE_EXPONENT`
 * dive that is intentionally steeper than the climb -- level at the apex,
 * steepest at the hull, which is the whole point of a top-attack profile).
 * The guided weave is a perpendicular sine that itself decays by `(1 - p)`,
 * so the missile settles exactly onto the launch-target line by u = 1
 * (`missiles.test.ts`'s "settles onto the line by impact").
 *
 * D4 -- an APS intercept (`interceptMissiles`) detonates a missile exactly
 * where its flight has it *right now* (`missilePointAt(m, progress)`), not at
 * the target's hull and not at the tube. A missile shot down mid-flight blows
 * up mid-flight; `INTERCEPT_SCALE` shrinks the resulting impact FX since an
 * airburst is a smaller event than a hull hit.
 */

import { WEAPON_CLASS } from '@lions/sim';
import { AIR_LIFT_PX } from './frame-state';

export type MissileVariant = 'top_attack' | 'guided' | 'unguided' | 'warhead';
export type MissileClass = 'atgm' | 'rpg' | 'heat';

export interface MissileProfile {
  shape: 'parabola' | 'climb_dive';
  apexPxPerTile: number;
  apexMinPx: number;
  apexMaxPx: number;
  apexU: number; // where the apex sits, 0..1 (climb_dive only; parabola is 0.5)
  weaveTiles: number;
  weaveCycles: number;
  ignitionTiles: number; // no body glow or trail before this much ground distance
  tracks: boolean; // follows the live target
  drawn: boolean; // false: nothing in flight, impact only
  impactPower: number;
  trailLifeScale: number; // x missile_trail's smoke lifetime
}

export const MISSILE_PROFILES: Record<MissileVariant, MissileProfile> = {
  top_attack: {
    shape: 'climb_dive', apexPxPerTile: 6, apexMinPx: 30, apexMaxPx: 60, apexU: 0.4,
    weaveTiles: 0, weaveCycles: 0, ignitionTiles: 0, tracks: true, drawn: true,
    impactPower: 0.25, trailLifeScale: 1,
  },
  guided: {
    shape: 'parabola', apexPxPerTile: 2.2, apexMinPx: 8, apexMaxPx: 26, apexU: 0.5,
    weaveTiles: 0.12, weaveCycles: 1.5, ignitionTiles: 0, tracks: true, drawn: true,
    impactPower: 0.25, trailLifeScale: 1,
  },
  unguided: {
    shape: 'parabola', apexPxPerTile: 1.0, apexMinPx: 2, apexMaxPx: 8, apexU: 0.5,
    weaveTiles: 0, weaveCycles: 0, ignitionTiles: 0.3, tracks: false, drawn: true,
    impactPower: 0.2, trailLifeScale: 0.5625,
  },
  warhead: {
    shape: 'parabola', apexPxPerTile: 0, apexMinPx: 0, apexMaxPx: 0, apexU: 0.5,
    weaveTiles: 0, weaveCycles: 0, ignitionTiles: 0, tracks: false, drawn: false,
    impactPower: 0.3, trailLifeScale: 0,
  },
};

/** The one shipped weapon id that flies top-attack. See D2 above. */
export const TOP_ATTACK_WEAPON_IDS: ReadonlySet<string> = new Set(['spike_atgm']);

/** Copied from `packages/sim/src/tuning.ts`'s `PROJ_SPEED` (Q16.16, /65536). See D1. */
export const SIM_PROJ_SPEED_TILES_S: Readonly<Record<MissileClass, number>> = {
  atgm: 4,
  rpg: 6,
  heat: 10,
};

export const SIM_TICK_S = 0.05;
export const MISSILE_GROUND_LIFT_PX = 6;
export const MISSILE_AIR_LIFT_PX: number = AIR_LIFT_PX;
export const MISS_OVERSHOOT_TILES = 0.8;
export const MISS_LATERAL_TILES = 0.4;
export const INTERCEPT_SCALE = 0.5;
export const MISSILE_MAX_DURATION_S = 6;
export const MISSILE_CAPACITY = 64;
/** 1 - q^4: level at the apex, steepest at the hull (N4). */
export const TOP_ATTACK_DIVE_EXPONENT = 4;

export interface MissileLaunch {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  simDistTiles: number;
  side: number;
  cls: number;
  weaponId: string;
  target: number;
  willHit: boolean;
  shooterAir: boolean;
  targetAir: boolean;
  tick: number;
  shooter: number;
}

export interface MissileModel {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  side: number;
  variant: MissileVariant;
  mclass: MissileClass;
  target: number;
  tracking: boolean;
  miss: boolean;
  launchLiftPx: number;
  impactLiftPx: number;
  apexPx: number;
  duration: number;
  t: number;
  seed: number;
  trailTiles: number;
}

export interface TargetTrack {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  alive: ArrayLike<number>;
}

export interface MissileLanding {
  x: number;
  y: number;
  liftPx: number;
  headingTurns: number;
  power: number;
  scale: number;
  miss: boolean;
  variant: MissileVariant;
  side: number;
}

/** A cheap, deterministic 32-bit hash mixing two integers into [0, 1). */
export function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function missileClassOf(cls: number): MissileClass | null {
  if (cls === WEAPON_CLASS.atgm) return 'atgm';
  if (cls === WEAPON_CLASS.rpg) return 'rpg';
  if (cls === WEAPON_CLASS.heat) return 'heat';
  return null;
}

export function missileVariantFor(cls: number, weaponId: string): MissileVariant | null {
  if (cls === WEAPON_CLASS.atgm) return TOP_ATTACK_WEAPON_IDS.has(weaponId) ? 'top_attack' : 'guided';
  if (cls === WEAPON_CLASS.rpg) return 'unguided';
  if (cls === WEAPON_CLASS.heat) return 'warhead';
  return null;
}

export function missileDurationS(cls: number, distTiles: number): number {
  const mc = missileClassOf(cls);
  if (mc === null) return SIM_TICK_S;
  const perTick = SIM_PROJ_SPEED_TILES_S[mc] * SIM_TICK_S;
  // The epsilon guards a real boundary, though not the one this comment used
  // to name (6 / 0.2 does not land above 30 on this Node -- verified in
  // missiles.test.ts). perTick itself is not exactly representable in binary
  // (0.2 for atgm), so a ground distance that is an EXACT whole number of
  // ticks can still divide back a hair above that integer: perTick * 3 reads
  // as 3.0000000000000004 when divided by perTick again, which without this
  // epsilon would ceil() to 4 ticks instead of the correct 3. The sim's own
  // Q16.16 division does not carry this particular error, so the epsilon
  // only corrects a float-precision artefact this presentation-layer copy
  // introduces, not a difference in what the sim actually resolved.
  const n = Math.max(1, Math.ceil(distTiles / perTick - 1e-9));
  // The sim resolves n - 1 ticks after the fire tick (projectiles step in the
  // tick they are fired); a same-tick round still draws for one.
  return Math.min(Math.max(1, n - 1) * SIM_TICK_S, MISSILE_MAX_DURATION_S);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function spawnMissile(l: MissileLaunch): MissileModel | null {
  const mclass = missileClassOf(l.cls);
  if (mclass === null) return null;
  const variant = missileVariantFor(l.cls, l.weaponId);
  if (variant === null) return null;
  const prof = MISSILE_PROFILES[variant];

  const seed = hash01(l.tick, l.shooter);
  const dx0 = l.tx - l.sx;
  const dy0 = l.ty - l.sy;
  const dist = Math.hypot(dx0, dy0);
  const apexPx = prof.apexPxPerTile === 0 ? 0 : clamp(dist * prof.apexPxPerTile, prof.apexMinPx, prof.apexMaxPx);
  const duration = missileDurationS(l.cls, l.simDistTiles);
  const launchLiftPx = l.shooterAir ? MISSILE_AIR_LIFT_PX : MISSILE_GROUND_LIFT_PX;
  const impactLiftPx = l.targetAir ? MISSILE_AIR_LIFT_PX : MISSILE_GROUND_LIFT_PX;
  const tracking = prof.tracks && l.willHit && l.target >= 0;
  const miss = !l.willHit;

  let tx = l.tx;
  let ty = l.ty;
  if (miss) {
    const len = dist > 0 ? dist : 1;
    const ux = dx0 / len;
    const uy = dy0 / len;
    const lateralSeed = hash01(l.tick + 7919, l.shooter);
    const lateral = (lateralSeed - 0.5) * 2 * MISS_LATERAL_TILES;
    tx = l.tx + ux * MISS_OVERSHOOT_TILES + -uy * lateral;
    ty = l.ty + uy * MISS_OVERSHOOT_TILES + ux * lateral;
  }

  return {
    sx: l.sx, sy: l.sy, tx, ty,
    side: l.side, variant, mclass, target: l.target,
    tracking, miss,
    launchLiftPx, impactLiftPx, apexPx,
    duration, t: 0, seed, trailTiles: 0,
  };
}

export function missilePointAt(m: MissileModel, u: number): { x: number; y: number; liftPx: number } {
  const p = clamp(u, 0, 1);
  const prof = MISSILE_PROFILES[m.variant];
  const dx = m.tx - m.sx;
  const dy = m.ty - m.sy;
  let x = m.sx + dx * p;
  let y = m.sy + dy * p;
  if (prof.weaveTiles > 0) {
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const w = prof.weaveTiles * Math.sin(2 * Math.PI * prof.weaveCycles * p) * (1 - p);
      x += (-dy / len) * w;
      y += (dx / len) * w;
    }
  }
  let arc: number;
  if (prof.shape === 'climb_dive') {
    arc = p < prof.apexU
      ? m.apexPx * Math.sin((Math.PI / 2) * (p / prof.apexU))
      : m.apexPx * (1 - ((p - prof.apexU) / (1 - prof.apexU)) ** TOP_ATTACK_DIVE_EXPONENT);
  } else {
    arc = m.apexPx * 4 * p * (1 - p);
  }
  return { x, y, liftPx: m.launchLiftPx + (m.impactLiftPx - m.launchLiftPx) * p + arc };
}

export function missileProgress(m: MissileModel): number {
  return m.duration > 0 ? clamp(m.t / m.duration, 0, 1) : 1;
}

export function missileHeadingTurns(m: MissileModel, u: number): number {
  const p = clamp(u, 0, 1);
  // At u = 0 the heading is the launch-to-target chord, not a forward sample:
  // a guided or top-attack round's weave/climb tilts a p=0.02 sample several
  // degrees off the true launch heading (measured ~7.8 deg at the shipped
  // weave), which is wrong for whatever orients the missile body at spawn.
  if (p <= 0) {
    const angle = Math.atan2(m.ty - m.sy, m.tx - m.sx) / (2 * Math.PI);
    return ((angle % 1) + 1) % 1;
  }
  const a = missilePointAt(m, Math.max(0, p - 0.02));
  const b = missilePointAt(m, p);
  const angle = Math.atan2(b.y - a.y, b.x - a.x) / (2 * Math.PI);
  return ((angle % 1) + 1) % 1;
}

export function missileGroundDist(m: MissileModel): number {
  return Math.hypot(m.tx - m.sx, m.ty - m.sy);
}

export function pushMissile(list: MissileModel[], m: MissileModel, capacity: number = MISSILE_CAPACITY): void {
  while (list.length >= capacity) list.shift();
  list.push(m);
}

function landingFor(m: MissileModel, progress: number, scale: number): MissileLanding {
  const pt = missilePointAt(m, progress);
  const prof = MISSILE_PROFILES[m.variant];
  return {
    x: pt.x, y: pt.y, liftPx: pt.liftPx,
    headingTurns: missileHeadingTurns(m, progress),
    power: prof.impactPower * scale,
    scale,
    miss: m.miss,
    variant: m.variant,
    side: m.side,
  };
}

/**
 * Ages every missile in place and drops the ones that land this `dt`,
 * returning their landings. `out` is cleared (`length = 0`) and refilled, so
 * a caller stepping every frame passes one buffer it owns and allocates no
 * array per frame (`MissileFx` does); omitted, a fresh array is returned.
 */
export function stepMissiles(
  list: MissileModel[],
  dt: number,
  track: TargetTrack,
  out: MissileLanding[] = []
): MissileLanding[] {
  const landings = out;
  landings.length = 0;
  let write = 0;
  for (let read = 0; read < list.length; read++) {
    const m = list[read];
    if (m.tracking) {
      const t = m.target;
      if (t >= 0 && t < track.alive.length && track.alive[t] === 1) {
        m.tx = track.x[t];
        m.ty = track.y[t];
      } else {
        m.tracking = false;
      }
    }
    if (m.t + dt >= m.duration) {
      landings.push(landingFor(m, 1, 1));
      // dropped: not copied forward
    } else {
      m.t += dt;
      list[write] = m;
      write++;
    }
  }
  list.length = write;
  return landings;
}

/** Detonates every in-flight missile at `target` (an APS kill). `out` is
 *  cleared and refilled, `stepMissiles`' contract. */
export function interceptMissiles(list: MissileModel[], target: number, out: MissileLanding[] = []): MissileLanding[] {
  const landings = out;
  landings.length = 0;
  let write = 0;
  for (let read = 0; read < list.length; read++) {
    const m = list[read];
    if (m.target === target && !m.miss) {
      landings.push(landingFor(m, missileProgress(m), INTERCEPT_SCALE));
    } else {
      list[write] = m;
      write++;
    }
  }
  list.length = write;
  return landings;
}
