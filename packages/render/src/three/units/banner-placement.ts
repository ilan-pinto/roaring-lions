/**
 * Where a held building hangs its banner (lead ruling 2026-10-14, option B
 * of the held-building mock), read off the building's own mesh.
 *
 * The mock hung the cloth on "the commonest wall depth across the facade's
 * middle band" of the sunlit face, and fell back to the shaded one. That
 * found the right wall on the house and the apartment and the wrong one on
 * the civic hall: its sunlit face is a portico, so the commonest depth was
 * the recessed wall BEHIND the piers, under the portico roof, and the cloth
 * ended up on the shaded face, read at 4 px changed at zoom 1. A rule about
 * which depth is common cannot tell a wall from the back of a porch.
 *
 * This one asks the questions the cloth itself would: is there a flat run
 * of wall to hang from, does anything stand proud of it below, is there wall
 * behind, can the camera see every part of it, and does the sun reach it.
 * The building is rasterised three ways, each an orthographic z-buffer:
 *
 * - along each camera-facing face normal (`+z`, `+x`; `camera.ts`'s
 *   `VIEW_DIRECTION` is +x +y +z), giving the front-most surface and how
 *   square-on to the face it is, per cell;
 * - along the view direction, so a candidate that a porch roof, a stair or
 *   a fire escape would hide from the camera is refused;
 * - along the sun, so a sunlit spot outranks a shaded one -- the hall's
 *   failure was a cloth in shade as much as a cloth in the wrong place.
 *
 * Among the rectangles that pass, it takes the largest cloth, weighted
 * toward the sunlit face and a solid wall behind, tall rather than wide, and
 * from the highest hang line in its column. Measured on the ten garrisonable
 * types this lands every one on its sunlit `+z` face except the clinic,
 * whose `+z` face is a porch with no wall to hang from and whose `+x` wall
 * takes it (`garrison-banner.test.ts` pins the per-type answer).
 *
 * Pure and three-free: it takes the template's triangles in TEMPLATE space
 * (world units at unit fit, `MESH_SCALE` applied, origin on the footprint
 * centre, y up), so it runs under node against the shipped GLBs. It is run
 * once per building TYPE when its standing template loads, never per frame.
 */

/** The two faces the camera sees. */
export type BannerFace = '+z' | '+x';

export interface BannerSpot {
  readonly face: BannerFace;
  /** Template-space point on the hang plane the rod's centre is fixed to. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The cloth's width along the face and its drop, template world units. */
  readonly width: number;
  readonly drop: number;
  /** Share of the cloth the sun reaches past the building's own mass. */
  readonly lit: number;
  /** Share of the cloth with flat wall behind it (the rest hangs over an
   *  opening or a recess). */
  readonly solid: number;
}

/** The cloth's limits, template world units (one tile = 3 m): at most
 *  1.8 m wide and 4.5 m long, and never shorter than 0.6 m. */
export const BANNER_MAX_WIDTH = 0.6;
export const BANNER_MAX_DROP = 1.5;
export const BANNER_MIN_DROP = 0.2;
/** Width over drop, the tall end and the wide end: a tall banner on a wall,
 *  a wide one along a wall too low for a tall one (the field camp's
 *  barriers). */
export const BANNER_TALL = 0.4;
export const BANNER_WIDE = 2.4;
/** A wide cloth reads as a banner less than a tall one. */
const WIDE_PENALTY = 0.8;
/** The hem stays this share of the hang height clear of the ground, and at
 *  least `HEM_CLEAR` above it: a banner that sweeps the street reads as a
 *  curtain. */
const MAX_DROP_SHARE = 0.75;
const HEM_CLEAR = 0.1;

/** Search grid, world units. */
const RES = 0.04;
/** Front-depth tolerance for "one flat plane". */
const FLAT = 0.03;
/** A cell is wall when the front surface is this square-on to the face. */
const WALL_NORMAL = 0.85;
/** Nothing may stand proud of the hang plane by more than this. */
const PROUD = 0.02;
/** The cloth sits this far in front of the plane it hangs from. Shared
 *  with the geometry (`garrison-banner.ts`), which builds its rod here. */
export const BANNER_STANDOFF = 0.035;
/** Share of the hang line that must be wall. */
const HANG_WALL = 0.8;
/** Under half a cell of flat wall behind the cloth and it is hanging across
 *  an opening, not on a wall. */
const MIN_SOLID = 0.5;

type V3 = readonly [number, number, number];

interface Raster {
  readonly cols: number;
  readonly rows: number;
  readonly u0: number;
  readonly v0: number;
  readonly res: number;
  /** Front-most `p . d` per cell, -Infinity where nothing is. */
  readonly depth: Float32Array;
  /** `|n . d|` of the front-most triangle per cell. */
  readonly square: Float32Array;
}

function dot(x: number, y: number, z: number, a: V3): number {
  return x * a[0] + y * a[1] + z * a[2];
}

/** An orthographic z-buffer along `d`, cells `res` apart in the `u`/`v`
 *  plane: per cell, the largest `p . d` (the surface nearest an eye far out
 *  along +d) and how square-on that triangle is to `d`. */
function rasterize(tris: Float32Array, u: V3, v: V3, d: V3, res: number): Raster {
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    const pu = dot(tris[i], tris[i + 1], tris[i + 2], u);
    const pv = dot(tris[i], tris[i + 1], tris[i + 2], v);
    if (pu < u0) u0 = pu;
    if (pu > u1) u1 = pu;
    if (pv < v0) v0 = pv;
    if (pv > v1) v1 = pv;
  }
  if (!(u1 >= u0)) return { cols: 0, rows: 0, u0: 0, v0: 0, res, depth: new Float32Array(0), square: new Float32Array(0) };
  const cols = Math.ceil((u1 - u0) / res) + 1;
  const rows = Math.ceil((v1 - v0) / res) + 1;
  const depth = new Float32Array(cols * rows).fill(-Infinity);
  const square = new Float32Array(cols * rows);
  const P = new Float64Array(9);
  for (let i = 0; i + 8 < tris.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const x = tris[i + k * 3];
      const y = tris[i + k * 3 + 1];
      const z = tris[i + k * 3 + 2];
      P[k * 3] = (dot(x, y, z, u) - u0) / res;
      P[k * 3 + 1] = (dot(x, y, z, v) - v0) / res;
      P[k * 3 + 2] = dot(x, y, z, d);
    }
    const ax = tris[i + 3] - tris[i];
    const ay = tris[i + 4] - tris[i + 1];
    const az = tris[i + 5] - tris[i + 2];
    const bx = tris[i + 6] - tris[i];
    const by = tris[i + 7] - tris[i + 1];
    const bz = tris[i + 8] - tris[i + 2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl === 0) continue;
    const sq = Math.abs(dot(nx, ny, nz, d)) / nl;
    const x0 = P[0];
    const y0 = P[1];
    const z0 = P[2];
    const x1 = P[3];
    const y1 = P[4];
    const z1 = P[5];
    const x2 = P[6];
    const y2 = P[7];
    const z2 = P[8];
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(den) < 1e-12) continue;
    const minc = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxc = Math.min(cols - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minr = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxr = Math.min(rows - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let r = minr; r <= maxr; r++) {
      const py = r + 0.5;
      for (let c = minc; c <= maxc; c++) {
        const px = c + 0.5;
        const w0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / den;
        const w1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const dd = w0 * z0 + w1 * z1 + w2 * z2;
        const k = r * cols + c;
        if (dd > depth[k]) {
          depth[k] = dd;
          square[k] = sq;
        }
      }
    }
  }
  return { cols, rows, u0, v0, res, depth, square };
}

function normalize(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** "Does anything of the building stand between this point and an eye far
 *  out along `dir`?", answered from one z-buffer along `dir`. */
function sightline(tris: Float32Array, dir: V3): (x: number, y: number, z: number) => boolean {
  const d = normalize(dir);
  const up: V3 = Math.abs(d[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(up, d));
  const v = cross(d, u);
  const buf = rasterize(tris, u, v, d, 0.02);
  return (x, y, z) => {
    const c = Math.floor((dot(x, y, z, u) - buf.u0) / buf.res);
    const r = Math.floor((dot(x, y, z, v) - buf.v0) / buf.res);
    if (c < 0 || r < 0 || c >= buf.cols || r >= buf.rows) return true;
    return buf.depth[r * buf.cols + c] <= dot(x, y, z, d) + 0.01;
  };
}

export interface PlaceOptions {
  /** Unit vector from the scene toward the camera (`VIEW_DIRECTION`). */
  readonly view: V3;
  /** Unit vector from the scene toward the sun (`sunDirectionFor`). */
  readonly sun: V3;
}

const FACES: readonly { readonly face: BannerFace; readonly n: V3; readonly a: V3 }[] = [
  // `a` runs along the face, left to right as the camera sees it.
  { face: '+z', n: [0, 0, 1], a: [1, 0, 0] },
  { face: '+x', n: [1, 0, 0], a: [0, 0, -1] },
];

/**
 * The best spot for a banner on either camera-facing face of the building
 * whose template-space triangles are `tris` (a flat xyz list, three vertices
 * a triangle). Null when neither face has a flat run of wall to hang the
 * smallest cloth from.
 */
export function placeBanner(tris: Float32Array, opts: PlaceOptions): BannerSpot | null {
  const seen = sightline(tris, opts.view);
  const sunlit = sightline(tris, opts.sun);
  let top = 0;
  for (let i = 1; i < tris.length; i += 3) top = Math.max(top, tris[i]);
  let best: (BannerSpot & { score: number }) | null = null;
  for (const f of FACES) {
    const r = rasterize(tris, f.a, [0, 1, 0], f.n, RES);
    if (r.cols === 0) continue;
    const sunward = dot(f.n[0], f.n[1], f.n[2], opts.sun) > 0;
    const at = (c: number, w: number): number => r.depth[w * r.cols + c];
    const wallAt = (c: number, w: number): boolean => r.square[w * r.cols + c] >= WALL_NORMAL;
    const hemRow = Math.ceil((Math.max(HEM_CLEAR, 0.08 * top) - r.v0) / RES);
    const minRows = Math.round(BANNER_MIN_DROP / RES);
    for (let wc = Math.round(BANNER_MAX_WIDTH / RES); wc >= 3; wc--) {
      const width = wc * RES;
      // The most this width can score; narrower only gets smaller.
      if (best && best.score >= width * Math.min(BANNER_MAX_DROP, width / BANNER_TALL)) break;
      const floorRows = Math.max(minRows, Math.ceil(width / BANNER_WIDE / RES));
      for (let c0 = 1; c0 + wc < r.cols; c0++) {
        for (let hang = r.rows - 1; hang >= hemRow + floorRows; hang--) {
          // The hang line: a flat run of wall across the width and one cell
          // past each end, so the cloth never sits on a corner. Both end
          // cells must be wall (the rod is fixed there); in between, a
          // narrow gap -- the joint between two barrier cages -- is spanned.
          if (!wallAt(c0 - 1, hang) || !wallAt(c0 + wc, hang)) continue;
          let d0 = -Infinity;
          let walls = 0;
          let ok = true;
          for (let c = c0 - 1; c <= c0 + wc && ok; c++) {
            const d = at(c, hang);
            if (d === -Infinity) ok = false;
            else if (wallAt(c, hang)) {
              walls++;
              d0 = Math.max(d0, d);
            }
          }
          if (!ok || walls < HANG_WALL * (wc + 2)) continue;
          for (let c = c0 - 1; c <= c0 + wc && ok; c++) {
            const d = at(c, hang);
            if (d > d0 + PROUD || (wallAt(c, hang) && d < d0 - FLAT)) ok = false;
          }
          if (!ok) continue;
          const hangY = r.v0 + (hang + 1) * RES;
          const capRows = Math.min(
            Math.round(BANNER_MAX_DROP / RES),
            Math.floor(width / BANNER_TALL / RES),
            Math.floor((MAX_DROP_SHARE * hangY) / RES)
          );
          // Down from it a row at a time, while nothing stands proud of the
          // plane, something is behind it, and the camera sees the cloth.
          const depth = d0 + BANNER_STANDOFF;
          let rows = 0;
          let solid = 0;
          let lit = 0;
          for (let w = hang; w > hang - capRows && w >= hemRow; w--) {
            let rowOk = true;
            let rowSolid = 0;
            let rowLit = 0;
            const y = r.v0 + (w + 0.5) * RES;
            for (let c = c0; c < c0 + wc; c++) {
              const d = at(c, w);
              if (d === -Infinity || d > d0 + PROUD) {
                rowOk = false;
                break;
              }
              const lat = r.u0 + (c + 0.5) * RES;
              const x = f.a[0] * lat + f.n[0] * depth;
              const z = f.a[2] * lat + f.n[2] * depth;
              if (!seen(x, y, z)) {
                rowOk = false;
                break;
              }
              if (d >= d0 - FLAT && wallAt(c, w)) rowSolid++;
              if (sunward && sunlit(x, y, z)) rowLit++;
            }
            if (!rowOk) break;
            rows++;
            solid += rowSolid;
            lit += rowLit;
          }
          if (rows < floorRows) continue;
          const cells = rows * wc;
          const solidShare = solid / cells;
          if (solidShare < MIN_SOLID) continue;
          const drop = rows * RES;
          const litShare = lit / cells;
          const shape = width > drop ? WIDE_PENALTY : 1;
          const score = width * drop * shape * (0.5 + 0.5 * litShare) * (0.85 + 0.15 * solidShare);
          if (!best || score > best.score + 1e-9) {
            const lat = r.u0 + (c0 + wc / 2) * RES;
            best = {
              face: f.face,
              x: f.a[0] * lat + f.n[0] * d0,
              y: hangY,
              z: f.a[2] * lat + f.n[2] * d0,
              width,
              drop,
              lit: litShare,
              solid: solidShare,
              score,
            };
          }
          break; // the highest hang line in this column is the one
        }
      }
    }
  }
  if (!best) return null;
  return {
    face: best.face,
    x: best.x,
    y: best.y,
    z: best.z,
    width: best.width,
    drop: best.drop,
    lit: best.lit,
    solid: best.solid,
  };
}
