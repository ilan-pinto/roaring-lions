/**
 * The ATGM/RPG/HEAT smoke trail, the motor glow, and the buffer writers that
 * feed both into a `three.Points`-style instanced draw (GH-250 T3). Pure and
 * three-free, in the same spirit as `./missiles.ts`: `TrailPool` is a plain
 * struct-of-arrays ring buffer, `emitAlongFlight`/`glowScale`/
 * `writeMissileSprites` are functions over plain numbers, and `trailLookFrom`
 * reads the shipped `data/vfx/missile_trail.json` emitter (or an equivalent
 * fixture) into a small resolved-colour record so no hex leaks past this
 * file (palette rule).
 *
 * Three roles, found by what an emitter layer IS rather than where it sits
 * in the JSON array, so re-ordering the authored layers never changes the
 * result: `additive: true` is the hot core, `sprite: 'smoke_puff'` is the
 * smoke, and whichever particle layer is neither is the halo. That is also
 * why `trailLookFrom`'s own doc test flips the array and asserts the same
 * output -- position was never the contract.
 *
 * `emitAlongFlight` spaces puffs by GROUND DISTANCE travelled
 * (`TRAIL_SPACING_TILES`), not by time, so a slower missile does not lay a
 * denser trail -- and it never re-emits a stretch of ground it has already
 * covered: `MissileModel.trailTiles` (from Task 2) remembers the last
 * distance a puff was actually placed at, and a call that emits nothing
 * (because the missile has not moved a further 0.2 tiles, or an RPG has not
 * yet reached `ignitionTiles`) leaves it untouched. That second case is what
 * lets an unlit RPG's first LIT puff start exactly at its ignition point
 * rather than backfilling the unlit stretch behind it.
 */

import type { EmitterSpec, ParticleSpec, Range } from '../../vfx';
import { sampleLerp, sampleStep } from '../../vfx/particles';
import { hexToLinear } from '../terrain/shared';
import { WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import {
  MISSILE_PROFILES,
  missileGroundDist,
  missilePointAt,
  missileProgress,
  type MissileModel,
  type MissilePoint,
} from './missiles';

export const TRAIL_SPACING_TILES = 0.2;
export const TRAIL_RISE_PX_S = 5;
export const TRAIL_DRIFT_TILES_S = 0.15;
/** Toward screen upper-right; one map-wide presentation wind (N10). */
export const TRAIL_DRIFT_TURNS = 0.875;
export const TRAIL_CAPACITY = 768;
export const GLOW_FLICKER = 0.15;
export const GLOW_FLICKER_HZ = 23;
export const MISSILE_BODY_TILES = 0.3;
export const MISSILE_BODY_WIDTH_PX = 2.5;
export const MISSILE_BODY_COLOR_KEY = 'gunmetal.1';

export interface TrailLook {
  lifeS: number;
  radiusPx: number;
  sizeCurve: number[];
  alphaCurve: number[];
  colors: string[];
  coreRadiusPx: number;
  coreColor: string;
  haloRadiusPx: number;
  haloColor: string;
  haloAlpha: number;
}

function rangeToNumber(r: Range | undefined, fallback: number): number {
  if (r === undefined) return fallback;
  if (typeof r === 'number') return r;
  return (r[0] + r[1]) / 2;
}

/**
 * Caches `hexToLinear`'s per-call array allocation, mirroring `fx.ts`'s own
 * `cachedHexToLinear` exactly (same shape, same reasoning): a trail's
 * colour set is a handful of palette keys (`haloColor`, `coreColor`, and
 * `TrailLook.colors`' few steps), reused by every ignited missile and every
 * live puff, every frame. Without this, `writeMissileSprites` -- called
 * once per frame -- would allocate one new `[number, number, number]` per
 * sprite written, which is exactly the per-frame-writer regression the
 * global constraint forbids.
 */
const hexToLinearCache = new Map<string, readonly [number, number, number]>();
function cachedHexToLinear(hex: string): readonly [number, number, number] {
  let rgb = hexToLinearCache.get(hex);
  if (!rgb) {
    rgb = hexToLinear(hex);
    hexToLinearCache.set(hex, rgb);
  }
  return rgb;
}

/**
 * Reads the three layers of a missile-trail emitter by role (see the file
 * doc comment), resolving every palette key up front so nothing downstream
 * ever sees a raw key or a hex literal. Null with no emitter at all (no
 * `data/vfx` entry yet); throws naming the missing role otherwise, since a
 * partially-authored emitter is an authoring bug, not a fallback case.
 */
export function trailLookFrom(em: EmitterSpec | null, resolve: (key: string) => string): TrailLook | null {
  if (em === null) return null;
  const core = em.particles.find((p: ParticleSpec) => p.additive === true);
  if (core === undefined) throw new Error('missile_trail: no additive layer');
  const smoke = em.particles.find((p: ParticleSpec) => p.sprite === 'smoke_puff');
  if (smoke === undefined) throw new Error('missile_trail: no smoke_puff layer');
  const halo = em.particles.find((p: ParticleSpec) => p !== core && p !== smoke);
  if (halo === undefined) throw new Error('missile_trail: no halo layer');

  return {
    lifeS: rangeToNumber(smoke.lifetime_ms, 0) / 1000,
    radiusPx: rangeToNumber(smoke.size_px, 0),
    sizeCurve: smoke.size_over_life ?? [1],
    alphaCurve: smoke.alpha_over_life ?? [1],
    colors: smoke.color_over_life.map(resolve),
    coreRadiusPx: rangeToNumber(core.size_px, 0),
    coreColor: resolve(core.color_over_life[0]),
    haloRadiusPx: rangeToNumber(halo.size_px, 0),
    haloColor: resolve(halo.color_over_life[0]),
    haloAlpha: halo.alpha_over_life?.[0] ?? 1,
  };
}

/**
 * Fixed-capacity ring buffer of smoke puffs, struct-of-arrays, allocating
 * nothing per puff per frame. `emit` always writes at `head` and advances
 * it, so past `capacity` puffs the OLDEST is silently overwritten -- there
 * is no separate free-list, because a trail puff has no priority to
 * preserve over another (unlike `ParticleSystem`, which recycles by
 * `budget_priority`).
 */
export class TrailPool {
  readonly capacity: number;
  // Read-only outside this class: `writeMissileSprites` walks them directly
  // rather than through `forEachLive`, whose callback would be a fresh
  // closure every frame (final fix wave). Only `emit`/`step` write them.
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pWorldY: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly alive: Uint8Array;
  private head = 0;
  private liveCount = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.px = new Float32Array(capacity);
    this.py = new Float32Array(capacity);
    this.pWorldY = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.alive = new Uint8Array(capacity);
  }

  get live(): number {
    return this.liveCount;
  }

  emit(x: number, y: number, worldY: number, life: number): void {
    const i = this.head;
    if (this.alive[i] === 0) this.liveCount++;
    this.px[i] = x;
    this.py[i] = y;
    this.pWorldY[i] = worldY;
    this.age[i] = 0;
    this.life[i] = life;
    this.alive[i] = 1;
    this.head = (this.head + 1) % this.capacity;
  }

  step(dt: number): void {
    const angle = TRAIL_DRIFT_TURNS * 2 * Math.PI;
    const dx = Math.cos(angle) * TRAIL_DRIFT_TILES_S * dt;
    const dy = Math.sin(angle) * TRAIL_DRIFT_TILES_S * dt;
    const dWorldY = TRAIL_RISE_PX_S * dt * WORLD_Y_PER_LIFT_PIXEL;
    for (let i = 0; i < this.capacity; i++) {
      if (this.alive[i] === 0) continue;
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.alive[i] = 0;
        this.liveCount--;
        continue;
      }
      this.px[i] += dx;
      this.py[i] += dy;
      this.pWorldY[i] += dWorldY;
    }
  }

  forEachLive(fn: (x: number, y: number, worldY: number, ageFrac: number) => void): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.alive[i] === 0) continue;
      fn(this.px[i], this.py[i], this.pWorldY[i], this.age[i] / this.life[i]);
    }
  }
}

/**
 * Drops puffs for the ground the missile has crossed since the last call,
 * one every `TRAIL_SPACING_TILES`, and returns how many were placed. Reads
 * `m.trailTiles` (Task 2's own field) as the low-water mark and advances it
 * to the last distance actually emitted -- untouched when nothing was, so a
 * not-yet-ignited RPG's own `ignitionTiles` floor is preserved across calls
 * that emit zero puffs. `worldYAt` receives the puff's ground-track (x, y),
 * the flight model's own `liftPx` at that point (so a top-attack trail
 * follows the climb, not a flat ground track), and `u` for a caller that
 * wants to sample terrain height itself.
 *
 * `groundDist === 0` needs no explicit guard: `travelled = progress *
 * groundDist` is then 0 too, and `kStart >= 1` (so `kStart *
 * TRAIL_SPACING_TILES >= 0.2`) always fails the loop's own `<= travelled +
 * 1e-9` bound -- the loop body, and the division by `groundDist`, simply
 * never run. An `if (groundDist > 0)` around the emit used to sit inside
 * the loop as a belt-and-braces check; it was unreachable dead code (the
 * loop cannot enter with `groundDist === 0`) and, worse, was a LATENT
 * desync: had it ever been reachable, `emitted` would still have counted a
 * stretch for which no puff was placed. Removed so `emitted` can never
 * disagree with the number of `pool.emit` calls actually made.
 *
 * GH-250 T5 fix: `worldYAt` takes the MISSILE, not its ground-track (x, y) --
 * matching `writeMissileSprites`'s own `worldYAt` below. The ground-track
 * point was never actually needed by the one real caller (`MissileFx.step`,
 * `./missile-fx.ts`): its own world-Y is a pure function of the missile's
 * launch/impact tiles, `u` and `liftPx`, none of which need `(x, y)`. Passing
 * `m` instead lets a caller compute its launch/impact ground height ONCE per
 * missile per step and read it back through a single, preallocated callback
 * bound once (not a fresh closure built fresh for every missile, every
 * frame, capturing that missile's own ground height) -- see `MissileFx`'s own
 * `trailWorldYAt` field and `lerpMissileWorldY` for the shape this now
 * enables.
 */
/** The one point every per-frame sample in this file is written into. */
const scratchPoint: MissilePoint = { x: 0, y: 0, liftPx: 0 };

export function emitAlongFlight(
  pool: TrailPool,
  m: MissileModel,
  look: TrailLook,
  worldYAt: (m: MissileModel, liftPx: number, u: number) => number
): number {
  const prof = MISSILE_PROFILES[m.variant];
  if (!prof.drawn) return 0;
  const groundDist = missileGroundDist(m);
  const travelled = missileProgress(m) * groundDist;
  const from = Math.max(m.trailTiles, prof.ignitionTiles);
  const life = look.lifeS * prof.trailLifeScale;
  const kStart = Math.floor(from / TRAIL_SPACING_TILES + 1e-9) + 1;

  let emitted = 0;
  let last = from;
  for (let k = kStart; k * TRAIL_SPACING_TILES <= travelled + 1e-9; k++) {
    const d = k * TRAIL_SPACING_TILES;
    const u = d / groundDist;
    const pt = missilePointAt(m, u, scratchPoint);
    const px = pt.x;
    const py = pt.y;
    const worldY = worldYAt(m, pt.liftPx, u);
    pool.emit(px, py, worldY, life);
    last = d;
    emitted++;
  }
  if (emitted > 0) m.trailTiles = last;
  return emitted;
}

/** True when a missile is both drawn at all and past its own ignition
 *  point (0 for anything but an RPG) -- the gate for both the trail and the
 *  motor glow: nothing lights before the motor does. */
export function missileIgnited(m: MissileModel): boolean {
  const prof = MISSILE_PROFILES[m.variant];
  return prof.drawn && missileProgress(m) * missileGroundDist(m) >= prof.ignitionTiles;
}

/** `1 + GLOW_FLICKER * sin(2*pi*(GLOW_FLICKER_HZ*t + seed))`: a pure
 *  function of (t, seed) so two calls at the same tick and the same missile
 *  always agree, with no per-frame RNG state to keep. */
export function glowScale(t: number, seed: number): number {
  return 1 + GLOW_FLICKER * Math.sin(2 * Math.PI * (GLOW_FLICKER_HZ * t + seed));
}

export interface SpriteBuffers {
  positions: Float32Array;
  colors: Float32Array;
  alphas: Float32Array;
  scales: Float32Array;
  softs: Float32Array;
}

/** What `writeMissileSprites` returns: ONE object, rewritten each call. */
export interface SpriteCounts {
  soft: number;
  core: number;
}
const spriteCounts: SpriteCounts = { soft: 0, core: 0 };

/**
 * Writes every ignited missile's halo + core, then every live trail puff,
 * into the two caller-supplied buffers -- `soft` (halo + puffs, blended,
 * depth-tested like the rest of the below-tier particle tier) and `core`
 * (the hot additive glow). Stops at each buffer's own capacity rather than
 * the other's, and never allocates: this runs every frame the same as
 * `writeParticleInstances` does. The counts come back in one module-owned
 * object, **valid until the next call** (the landings buffers' contract).
 */
export function writeMissileSprites(
  missiles: readonly MissileModel[],
  pool: TrailPool,
  look: TrailLook,
  worldYAt: (m: MissileModel, u: number) => number,
  soft: SpriteBuffers,
  core: SpriteBuffers
): Readonly<SpriteCounts> {
  const softCap = soft.alphas.length;
  const coreCap = core.alphas.length;
  let softCount = 0;
  let coreCount = 0;

  for (const m of missiles) {
    if (!missileIgnited(m)) continue;
    const progress = missileProgress(m);
    // Read x/y before `worldYAt`, which may sample a point of its own.
    const pt = missilePointAt(m, progress, scratchPoint);
    const px = pt.x;
    const py = pt.y;
    const worldY = worldYAt(m, progress);
    const glow = glowScale(m.t, m.seed);

    if (softCount < softCap) {
      const i = softCount;
      const [r, g, b] = cachedHexToLinear(look.haloColor);
      soft.positions[i * 3] = px;
      soft.positions[i * 3 + 1] = worldY;
      soft.positions[i * 3 + 2] = py;
      soft.colors[i * 3] = r;
      soft.colors[i * 3 + 1] = g;
      soft.colors[i * 3 + 2] = b;
      soft.alphas[i] = look.haloAlpha;
      soft.scales[i] = look.haloRadiusPx * glow;
      soft.softs[i] = 1;
      softCount++;
    }

    if (coreCount < coreCap) {
      const i = coreCount;
      const [r, g, b] = cachedHexToLinear(look.coreColor);
      core.positions[i * 3] = px;
      core.positions[i * 3 + 1] = worldY;
      core.positions[i * 3 + 2] = py;
      core.colors[i * 3] = r;
      core.colors[i * 3 + 1] = g;
      core.colors[i * 3 + 2] = b;
      core.alphas[i] = 1;
      core.scales[i] = look.coreRadiusPx * glow;
      core.softs[i] = 0;
      coreCount++;
    }
  }

  // `forEachLive`'s own walk, inline: a callback here would be a fresh
  // closure every frame.
  for (let p = 0; p < pool.capacity && softCount < softCap; p++) {
    if (pool.alive[p] === 0) continue;
    const x = pool.px[p];
    const y = pool.py[p];
    const worldY = pool.pWorldY[p];
    const ageFrac = pool.age[p] / pool.life[p];
    const i = softCount;
    const radius = look.radiusPx * sampleLerp(look.sizeCurve, ageFrac, 1);
    const alpha = sampleLerp(look.alphaCurve, ageFrac, 1);
    const color = sampleStep(look.colors, ageFrac, '#000000');
    const [r, g, b] = cachedHexToLinear(color);
    soft.positions[i * 3] = x;
    soft.positions[i * 3 + 1] = worldY;
    soft.positions[i * 3 + 2] = y;
    soft.colors[i * 3] = r;
    soft.colors[i * 3 + 1] = g;
    soft.colors[i * 3 + 2] = b;
    soft.alphas[i] = alpha;
    soft.scales[i] = radius;
    soft.softs[i] = 1;
    softCount++;
  }

  spriteCounts.soft = softCount;
  spriteCounts.core = coreCount;
  return spriteCounts;
}
