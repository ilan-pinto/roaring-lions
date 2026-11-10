/**
 * GH-1197 P2: the debris a landing throws -- terrain clods and chunks -- as a
 * CLOSED-FORM flight, so a chunk's every pose is a function of its plan and
 * the time, never of the frames that came before it.
 *
 * A chunk leaves the burst on a parabola, touches down once, bounces at
 * restitution 0.3 (its horizontal speed halved), touches down again, and
 * slides to rest with a constant deceleration. All of that is solved HERE,
 * once, at spawn: the touchdown points sit on the ground the renderer draws
 * (the caller's `groundAt`, `ground-height.ts`), and the rest pose is final
 * from the first frame. The vertex shader (`debris-pool.ts`) evaluates the same
 * three segments from the plan; `debrisPositionAt` is its TypeScript mirror,
 * and the tests hold the two to the same numbers.
 *
 * Everything random is a presentation HASH of the landing point and the
 * chunk's index, never a running PRNG, so two captures of the same landing put
 * every chunk at the same rest pose, bit for bit, whatever was thrown before
 * it. Presentation only: the sim reads none of this.
 *
 * Units: tiles for distance (the world's x/z are tiles, y is world units at
 * the same scale), seconds for time. Gravity is the flipbook dirt's 9.8 a
 * second squared (`flipbook-fx.ts`), so a 155's clods fly 2.4 t in about
 * 1.5 s, the design's figure.
 */

/** The flipbook dirt's gravity, tiles/s^2: debris and dirt billows fall together. */
export const DEBRIS_GRAVITY = 9.8;
/** Vertical restitution of the one bounce (the design's 0.3). */
export const DEBRIS_RESTITUTION = 0.3;
/** The horizontal speed a touchdown keeps. */
export const DEBRIS_BOUNCE_KEEP = 0.5;
/** The slide's deceleration, tiles/s^2. */
export const DEBRIS_SLIDE_DECEL = 4;
/** The largest chunk, tiles (the design's 0.35 t cap: 16 px at zoom 1). */
export const DEBRIS_MAX_SIZE = 0.35;
/** A chunk's sizes: a clod is a lump of soil, a chunk a piece of the surface (the approved mock v2). */
export const CLOD_SIZE: readonly [number, number] = [0.1, 0.22];
export const CHUNK_SIZE: readonly [number, number] = [0.14, DEBRIS_MAX_SIZE];
/** The shapes' height as a fraction of their size: at rest they lie on their thin axis, so a 0.35 t chunk
 *  stands 0.119 t, under the design's 0.12 t settled-rubble cap (an infantryman's knee). */
export const DEBRIS_REST_HEIGHT_FRACTION = 0.34;
/** Settled debris fades into the ground after this long, on the SIM clock (the lead's ruling 4, 9 Nov). */
export const DEBRIS_FADE_START_MS = 90_000;
export const DEBRIS_FADE_MS = 1_500;
/** Spin while airborne, radians a second. */
const SPIN_RATE: readonly [number, number] = [4, 14];

/** One chunk's whole life, solved at spawn. Times are ms from the spawn; points are world (x, y, z). */
export interface DebrisPlan {
  /** Launch point and velocity. */
  readonly p0: readonly [number, number, number];
  readonly v0: readonly [number, number, number];
  /** First touchdown, ms, and where. */
  readonly t1: number;
  readonly p1: readonly [number, number, number];
  /** The bounce's velocity, and its touchdown. */
  readonly v1: readonly [number, number, number];
  readonly t2: number;
  readonly p2: readonly [number, number, number];
  /** The slide ends at rest, ms. */
  readonly t3: number;
  /** The rest pose: centre (on the ground plus half its rest height), yaw, size. */
  readonly rest: readonly [number, number, number];
  readonly yaw: number;
  readonly size: number;
  /** Spin while airborne: a unit axis and a rate (rad/s); it unwinds to the rest orientation at `t2`. */
  readonly spinAxis: readonly [number, number, number];
  readonly spinRate: number;
  /** True for a clod (soil), false for a chunk (the surface). */
  readonly clod: boolean;
}

/** How one class throws, at the landing's own reach (`munitions.json`'s debris block, already scaled). */
export interface DebrisThrow {
  readonly clods: number;
  readonly chunks: number;
  /** The farthest a piece lands, tiles. */
  readonly throwTiles: number;
  /** The highest a piece climbs, tiles. */
  readonly apexTiles: number;
}

/** A deterministic hash of three integers to [0, 1): presentation only, never the sim. */
export function debrisHash(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x632be5ab, 0x85ebca77) ^ Math.imul((c | 0) + 0x27d4eb2f, 0xc2b2ae3d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** The landing point's seed: its position to a sixteenth of a tile. */
export function debrisSeed(x: number, z: number): [number, number] {
  return [Math.floor(x * 16), Math.floor(z * 16)];
}

/** The positive time a parabola from height `y0` at vertical speed `vy` reaches height `h`; the apex time when it
 *  never comes down to `h` (a landing on ground higher than it climbed). */
function fallTime(y0: number, vy: number, h: number): number {
  const a = DEBRIS_GRAVITY / 2;
  const disc = vy * vy - 4 * a * (h - y0);
  if (disc < 0) return vy / DEBRIS_GRAVITY;
  return (vy + Math.sqrt(disc)) / DEBRIS_GRAVITY;
}

/** A directed throw (GH-1197 P3, a building hit): headings within `spreadRad` either side of `dirRad`. */
export interface DebrisAim {
  readonly dirRad: number;
  readonly spreadRad: number;
}

/**
 * Plans one piece: index `k` of a landing at (x, z) whose launch base stands at `y0` (the ground, or a point on a
 * wall), thrown by `t`. `clod` picks the size band. Everything else is hashed from the point and `k`. `groundAt(x,
 * z)` is the drawn ground's world Y. With `aim`, the heading is inside the aim's cone rather than all round.
 */
export function planDebris(
  x: number, y0: number, z: number, k: number, clod: boolean, t: DebrisThrow,
  groundAt: (x: number, z: number) => number,
  aim?: DebrisAim
): DebrisPlan {
  const [sx, sz] = debrisSeed(x, z);
  const h = (salt: number): number => debrisHash(sx + salt * 7919, sz, k);
  const g = DEBRIS_GRAVITY;
  // Bulk lands close (explosion-physics: "mostly steep, bulk lands close"): range is skewed toward the burst.
  const range = t.throwTiles * (0.25 + 0.75 * Math.pow(h(1), 1.5));
  const apex = Math.max(0.05, t.apexTiles * (0.35 + 0.65 * h(2)));
  const heading = aim ? aim.dirRad + (h(3) * 2 - 1) * aim.spreadRad : h(3) * Math.PI * 2;
  const vy = Math.sqrt(2 * g * apex);
  // The horizontal speed whose WHOLE travel on flat ground -- the flight back to the burst's own height, the bounce
  // and the slide -- is `range`, so a piece comes to rest inside the class's throw (the design: "54 pieces at rest
  // within 2.4 t" for the 155). The flight and the bounce cover vh x flatT x (1 + KEEP x RESTITUTION); the slide
  // vs^2 / 2a with vs = vh x KEEP^2. Solved for vh.
  const flatT = (2 * vy) / g;
  const qa = (DEBRIS_BOUNCE_KEEP ** 4) / (2 * DEBRIS_SLIDE_DECEL);
  const qb = flatT * (1 + DEBRIS_BOUNCE_KEEP * DEBRIS_RESTITUTION);
  const vh = (-qb + Math.sqrt(qb * qb + 4 * qa * range)) / (2 * qa);
  const dx = Math.cos(heading);
  const dz = Math.sin(heading);
  const size = (clod ? CLOD_SIZE : CHUNK_SIZE)[0] + ((clod ? CLOD_SIZE : CHUNK_SIZE)[1] - (clod ? CLOD_SIZE : CHUNK_SIZE)[0]) * h(4);
  const half = (size * DEBRIS_REST_HEIGHT_FRACTION) / 2;
  const p0: [number, number, number] = [x, y0 + half, z];
  const v0: [number, number, number] = [dx * vh, vy, dz * vh];
  // First touchdown: from the flat-ground landing point, refined a few times onto the ground under the arc
  // (a fixed count, so the plan stays a pure function of its inputs).
  let t1 = flatT;
  let g1 = p0[1];
  for (let i = 0; i < 4; i++) {
    g1 = groundAt(x + v0[0] * t1, z + v0[2] * t1) + half;
    t1 = fallTime(p0[1], vy, g1);
  }
  const p1: [number, number, number] = [x + v0[0] * t1, g1, z + v0[2] * t1];
  // The bounce.
  const vyIn = vy - g * t1;
  const v1: [number, number, number] = [v0[0] * DEBRIS_BOUNCE_KEEP, Math.abs(vyIn) * DEBRIS_RESTITUTION, v0[2] * DEBRIS_BOUNCE_KEEP];
  const tb = (2 * v1[1]) / g;
  const p2xz: [number, number] = [p1[0] + v1[0] * tb, p1[2] + v1[2] * tb];
  const p2: [number, number, number] = [p2xz[0], groundAt(p2xz[0], p2xz[1]) + half, p2xz[1]];
  // The slide: the bounce's horizontal speed, halved again at the second touchdown, decelerated to rest.
  const vs = Math.hypot(v1[0], v1[2]) * DEBRIS_BOUNCE_KEEP;
  const ts = vs / DEBRIS_SLIDE_DECEL;
  const slide = (vs * vs) / (2 * DEBRIS_SLIDE_DECEL);
  const rx = p2[0] + dx * slide;
  const rz = p2[2] + dz * slide;
  const rest: [number, number, number] = [rx, groundAt(rx, rz) + half, rz];
  // A random spin axis (uniform on the sphere).
  const u = h(5) * 2 - 1;
  const phi = h(6) * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return {
    p0, v0, t1: t1 * 1000, p1, v1, t2: (t1 + tb) * 1000, p2, t3: (t1 + tb + ts) * 1000,
    rest, yaw: h(7) * Math.PI * 2, size,
    spinAxis: [r * Math.cos(phi), u, r * Math.sin(phi)],
    spinRate: SPIN_RATE[0] + (SPIN_RATE[1] - SPIN_RATE[0]) * h(8),
    clod,
  };
}

/** A plan already at rest: what `setQuiet` places (no flight). */
export function restingPlan(p: DebrisPlan): DebrisPlan {
  return { ...p, t1: 0, t2: 0, t3: 0 };
}

/**
 * The centre of a planned piece at `ms` after its spawn: the vertex shader's three segments, in TypeScript.
 * Segment A is the launch parabola to `t1`; B the bounce, its height corrected linearly from `p1` to `p2`; C the
 * slide, eased out to rest at `t3`; then rest.
 */
export function debrisPositionAt(p: DebrisPlan, ms: number): [number, number, number] {
  const g = DEBRIS_GRAVITY;
  if (ms >= p.t3) return [p.rest[0], p.rest[1], p.rest[2]];
  if (ms < p.t1) {
    const t = Math.max(0, ms) / 1000;
    return [p.p0[0] + p.v0[0] * t, p.p0[1] + p.v0[1] * t - (g / 2) * t * t, p.p0[2] + p.v0[2] * t];
  }
  if (ms < p.t2) {
    const tb = (p.t2 - p.t1) / 1000;
    const t = (ms - p.t1) / 1000;
    const f = tb > 0 ? t / tb : 1;
    return [
      p.p1[0] + p.v1[0] * t,
      p.p1[1] + p.v1[1] * t - (g / 2) * t * t + (p.p2[1] - p.p1[1]) * f,
      p.p1[2] + p.v1[2] * t,
    ];
  }
  const ts = p.t3 - p.t2;
  const f = ts > 0 ? (ms - p.t2) / ts : 1;
  const e = 1 - (1 - f) * (1 - f);
  return [p.p2[0] + (p.rest[0] - p.p2[0]) * e, p.p2[1] + (p.rest[1] - p.p2[1]) * f, p.p2[2] + (p.rest[2] - p.p2[2]) * e];
}

/** The spin still to unwind at `ms`, radians (0 from the second touchdown on). */
export function debrisSpinAt(p: DebrisPlan, ms: number): number {
  return ms >= p.t2 ? 0 : (p.spinRate * (p.t2 - Math.max(0, ms))) / 1000;
}

/** The size factor of a settled piece at `simAgeMs` since its spawn: 1, then shrinking into the ground over
 *  `DEBRIS_FADE_MS` from `DEBRIS_FADE_START_MS`. On the SIM clock. */
export function debrisFadeAt(simAgeMs: number): number {
  const f = (simAgeMs - DEBRIS_FADE_START_MS) / DEBRIS_FADE_MS;
  return f <= 0 ? 1 : f >= 1 ? 0 : 1 - f * f * (3 - 2 * f);
}

/** A class's debris at a landing's reach: counts by (S / ref)^2, throw by S / ref, apex as authored. */
export function debrisThrowFor(
  debris: { clods: number; chunks: number; throw_tiles: number; apex_tiles: number },
  splash: number,
  referenceSplash: number
): DebrisThrow {
  const r = referenceSplash > 0 && splash > 0 ? splash / referenceSplash : 0;
  return {
    clods: Math.round(debris.clods * r * r),
    chunks: Math.round(debris.chunks * r * r),
    throwTiles: debris.throw_tiles * r,
    apexTiles: debris.apex_tiles,
  };
}
