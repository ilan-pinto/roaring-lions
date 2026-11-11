/**
 * GH-1197 P4: real holes in buildings -- the bookkeeping and the edge maths (design section 3a).
 *
 * A hole is a cylinder in WORLD space (a standing building is frozen in place, `freezeStatic`, so its world frame IS its
 * object frame scaled and moved once): a centre on the wall or roof, a radius, an axis (the facade's outward normal for
 * a wall hit, UP for a round that lands on the roof) and a depth along it. The building's own material clone discards
 * every fragment inside it (`holed-material.ts`); this module decides where the holes are and what their edge looks
 * like, and is the TypeScript mirror the GLSL is held to.
 *
 * - **At most 6 holes a building** (`HOLE_CAP`). A hit within `HOLE_GROW_WITHIN` (1.2) of a hole's radius from its
 *   centre grows that hole by 25%, capped at 1.6x its class radius, instead of taking a slot; a seventh distinct hit
 *   grows the nearest hole. A battered building reads as more and bigger breaches, never a sieve.
 * - **The edge** is broken masonry, not a shape: the radius is `r x (0.85 + 0.30 x e(theta))` with `e` a hand-rolled
 *   value-noise fbm in [0, 1], 4 octaves, sampled ON THE CIRCLE so it wraps exactly at 2 pi, seeded by the hole. The
 *   lattice hash is `tileHash` (`../../tile-hash.ts`), the same integer hash the decal shader carries as `rlHash`.
 * - **Cracks:** six thin dark wedges a hole at hashed angles, 0.05-0.1 t out from the edge, +-2.6 degrees at the root
 *   tapering to a point.
 *
 * Pure and three-free. Presentation only.
 */
import { tileHash } from '../../tile-hash';

export const HOLE_CAP = 6;
export const HOLE_GROW_WITHIN = 1.2;
export const HOLE_GROW_FACTOR = 1.25;
export const HOLE_MAX_GROWTH = 1.6;
/** How far along its axis a hole cuts, either side of its centre: the near wall, never the far one. */
export const HOLE_DEPTH_TILES = 0.6;
/** The edge's swing: `0.85 + 0.30 e`, so +-15% of the radius. */
export const HOLE_EDGE_BASE = 0.85;
export const HOLE_EDGE_AMP = 0.3;
export const HOLE_EDGE_OCTAVES = 4;
/** Lattice cells around the circle at the first octave; each octave doubles them. */
export const HOLE_EDGE_CELLS = 4;
export const HOLE_CRACKS = 6;
export const HOLE_CRACK_LEN: readonly [number, number] = [0.05, 0.1];
export const HOLE_CRACK_ROOT_RAD = (2.6 * Math.PI) / 180;
export const HOLE_CRACK_ALPHA = 0.9;
/** The broken wall's thickness: a band one ramp key darker, just outside the cut (mock v2). */
export const HOLE_LIP_TILES = 0.03;
/** The char halo beyond the lip, `gunmetal.3` at 0.7 at its inner edge, fading out. */
export const HOLE_HALO_TILES = 0.15;
export const HOLE_HALO_ALPHA = 0.7;
/** The interior through a hole: the darkest key of the wall's ramp, this far toward `gunmetal.2`. */
export const HOLE_INTERIOR_TOWARD_CHAR = 0.6;
/** A hole's seed stays under this, so `seed x 128 + row` stays under 2^22, where `tileHash`'s double products are exact
 *  and match the GLSL's `uint` arithmetic bit for bit (`../../tile-hash.ts`). */
export const HOLE_SEED_LIMIT = 4096;
/** Hash rows: a hole's edge octaves, its crack angles and its crack lengths. */
export const HOLE_SALT_CRACK_ANGLE = 64;
export const HOLE_SALT_CRACK_LEN = 80;

export interface Hole {
  /** Centre, world. */
  readonly c: readonly [number, number, number];
  readonly radius: number;
  /** Unit axis, world: the wall's outward normal, or up. */
  readonly axis: readonly [number, number, number];
  /** Seeds the edge and the cracks; a non-negative integer under `HOLE_SEED_LIMIT`. */
  readonly seed: number;
  /** The class radius it was cut at: growth caps at `HOLE_MAX_GROWTH` of this. */
  readonly classRadius: number;
}

/** A new hit: where, which way and how big (its class radius). */
export interface HoleHit {
  readonly c: readonly [number, number, number];
  readonly axis: readonly [number, number, number];
  readonly radius: number;
  readonly seed: number;
}

function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function grown(h: Hole): Hole {
  return { ...h, radius: Math.min(h.radius * HOLE_GROW_FACTOR, h.classRadius * HOLE_MAX_GROWTH) };
}

/**
 * The holes after `hit`: the nearest hole within `HOLE_GROW_WITHIN` of its own radius grows; otherwise a new hole while
 * there is a slot; otherwise the nearest grows. Pure: a new array, the old one untouched.
 */
export function addHole(holes: readonly Hole[], hit: HoleHit): Hole[] {
  let nearest = -1;
  let nearestD = Infinity;
  for (let i = 0; i < holes.length; i++) {
    const d = dist(holes[i].c, hit.c);
    if (d < nearestD) {
      nearestD = d;
      nearest = i;
    }
  }
  const out = holes.slice();
  if (nearest >= 0 && nearestD < HOLE_GROW_WITHIN * holes[nearest].radius) {
    out[nearest] = grown(holes[nearest]);
    return out;
  }
  if (holes.length < HOLE_CAP) {
    out.push({ c: hit.c, radius: hit.radius, axis: hit.axis, seed: hit.seed, classRadius: hit.radius });
    return out;
  }
  out[nearest] = grown(holes[nearest]);
  return out;
}

/** `tileHash` on a hole's lattice row: `row` picks the octave or the crack, `i` the cell. */
export function holeHash(seed: number, row: number, i: number): number {
  return tileHash(i, seed * 128 + row);
}

/** The edge noise e(theta) in [0, 1]: periodic value-noise fbm over `HOLE_EDGE_OCTAVES` octaves, exact at 2 pi. */
export function holeEdgeNoise(theta: number, seed: number): number {
  const turn = ((theta / (Math.PI * 2)) % 1 + 1) % 1;
  let sum = 0;
  let norm = 0;
  let amp = 1;
  for (let o = 0; o < HOLE_EDGE_OCTAVES; o++) {
    const cells = HOLE_EDGE_CELLS << o;
    const u = turn * cells;
    const i0 = Math.floor(u) % cells;
    const i1 = (i0 + 1) % cells;
    const f = u - Math.floor(u);
    const s = f * f * (3 - 2 * f);
    const a = holeHash(seed, o, i0);
    const b = holeHash(seed, o, i1);
    sum += amp * (a + (b - a) * s);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/** The cut's radius at `theta`: `r x (0.85 + 0.30 e)`. */
export function holeEdgeRadius(radius: number, theta: number, seed: number): number {
  return radius * (HOLE_EDGE_BASE + HOLE_EDGE_AMP * holeEdgeNoise(theta, seed));
}

/** Crack `k` of a hole: its angle and its length. */
export function holeCrack(seed: number, k: number): { angle: number; length: number } {
  return {
    angle: holeHash(seed, HOLE_SALT_CRACK_ANGLE, k) * Math.PI * 2,
    length: HOLE_CRACK_LEN[0] + (HOLE_CRACK_LEN[1] - HOLE_CRACK_LEN[0]) * holeHash(seed, HOLE_SALT_CRACK_LEN, k),
  };
}

/** The tangent basis a hole measures theta in (the GLSL's `rlHoleBasis`): any unit `t` perpendicular to the axis, and
 *  `b = axis x t`. The helper is world up, or world x for an up axis. */
export function holeBasis(axis: readonly [number, number, number]): { t: [number, number, number]; b: [number, number, number] } {
  const h: [number, number, number] = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  // t = normalize(h x axis)
  let t: [number, number, number] = [h[1] * axis[2] - h[2] * axis[1], h[2] * axis[0] - h[0] * axis[2], h[0] * axis[1] - h[1] * axis[0]];
  const tl = Math.hypot(t[0], t[1], t[2]);
  t = [t[0] / tl, t[1] / tl, t[2] / tl];
  const b: [number, number, number] = [axis[1] * t[2] - axis[2] * t[1], axis[2] * t[0] - axis[0] * t[2], axis[0] * t[1] - axis[1] * t[0]];
  return { t, b };
}

/** What a fragment at world `p` is, against one hole: cut, or its edge treatment (`tint` 0 none). The GLSL's
 *  `rlHoleAt`, in TypeScript. */
export function holeAt(h: Hole, p: readonly [number, number, number]): { cut: boolean; lip: boolean; crack: boolean; halo: number } {
  const d = [p[0] - h.c[0], p[1] - h.c[1], p[2] - h.c[2]];
  const ax = d[0] * h.axis[0] + d[1] * h.axis[1] + d[2] * h.axis[2];
  const none = { cut: false, lip: false, crack: false, halo: 0 };
  if (Math.abs(ax) >= HOLE_DEPTH_TILES) return none;
  const { t, b } = holeBasis(h.axis);
  const x = d[0] * t[0] + d[1] * t[1] + d[2] * t[2];
  const y = d[0] * b[0] + d[1] * b[1] + d[2] * b[2];
  const rho = Math.hypot(x, y);
  const theta = Math.atan2(y, x);
  const rr = holeEdgeRadius(h.radius, theta, h.seed);
  if (rho < rr) return { ...none, cut: true };
  const out = rho - rr;
  let crack = false;
  for (let k = 0; k < HOLE_CRACKS; k++) {
    const c = holeCrack(h.seed, k);
    const s = out / c.length;
    if (s > 1) continue;
    let dth = Math.abs(theta - c.angle) % (Math.PI * 2);
    if (dth > Math.PI) dth = Math.PI * 2 - dth;
    if (dth < HOLE_CRACK_ROOT_RAD * (1 - s)) crack = true;
  }
  const lip = out < HOLE_LIP_TILES;
  const hOut = out - HOLE_LIP_TILES;
  const halo = hOut >= 0 && hOut < HOLE_HALO_TILES ? HOLE_HALO_ALPHA * (1 - hOut / HOLE_HALO_TILES) : 0;
  return { cut: false, lip, crack, halo };
}
