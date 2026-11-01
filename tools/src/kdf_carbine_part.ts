/**
 * The `kdf_carbine` part's grip, measured off its bytes (GH-826 F4, spec 1.6).
 *
 * The instrument is independent of the generator (`tools/units/kdf_carbine_grip.py`): it reads
 * the GLB's triangles, finds the pistol grip as the rearmost protrusion below the bore (the
 * review's own definition), fits its axis, and slices it. The limits in `GRIP_LIMITS` are the
 * spec's numbers as literals; nothing is imported from the exporter.
 *
 * Part frame (what the exporter writes, after the glTF y-up conversion is undone): x forward
 * along the bore, y across, z up, the bore on z = 0, the butt plate at x = -0.425.
 */
import { readAccessor, readGlb } from './mesh_gait';

type V3 = [number, number, number];

export const BUTT_X = -0.425;


export const GRIP_LIMITS = {
  triangles: 380,
  /** Section 0.030 wide x 0.050 deep at mid-height, raked 20 degrees (bottom back). */
  widthM: [0.027, 0.033],
  depthM: [0.046, 0.054],
  rakeDeg: [17, 23],
  gripBottomZ: [-0.155, -0.125],
  /** A trigger guard: the bar's lowest run is at least this long, and 0.015 clear of the magazine. */
  guardRunM: 0.045,
  magClearM: [0.010, 0.025],
  /** Butt plate to the trigger's rear face. */
  lengthOfPullM: [0.33, 0.38],
  /** A hand station must lie within this of the surface it names. */
  stationTolM: 0.003,
} as const;

export interface GripReading {
  readonly triangles: number;
  readonly lengthM: number;
  readonly rakeDeg: number;
  /** Lowest z of the grip: the spec's 0.105 long grip, top at the belly, ends here. */
  readonly gripBottomZ: number;
  readonly widthM: number;
  readonly depthM: number;
  /** Length of the lowest bar run found in the guard window, 0 when there is no guard. */
  readonly guardRunM: number;
  readonly magClearM: number | null;
  readonly lengthOfPullM: number | null;
  /** The grip, guard and trigger were found as loose pieces behind the magazine. */
  readonly found: boolean;
  /** When there is no loose grip: the size of what hangs behind the magazine instead (x, y, z extents of the Meshy block). */
  readonly blockM: V3 | null;
  /** The grip's axis: a point on it and its unit direction (top to bottom). */
  readonly axisPoint: V3 | null;
  readonly axisDir: V3 | null;
}

function load(path: string): { pts: V3[]; tris: [number, number, number][] } {
  const glb = readGlb(path);
  const prim = glb.json.meshes?.[0]?.primitives?.[0];
  if (!prim || prim.indices === undefined) throw new Error(`${path}: no indexed primitive`);
  const p = readAccessor(glb, prim.attributes.POSITION);
  const idx = readAccessor(glb, prim.indices).data;
  const pts: V3[] = [];
  for (let i = 0; i < p.count; i++) pts.push([p.data[i * 3], -p.data[i * 3 + 2], p.data[i * 3 + 1]]);
  const tris: [number, number, number][] = [];
  for (let i = 0; i + 2 < idx.length; i += 3) tris.push([idx[i], idx[i + 1], idx[i + 2]]);
  return { pts, tris };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Points where triangle edges cross the plane through `o` with normal `n`. */
function slice(pts: readonly V3[], tris: readonly [number, number, number][], o: V3, n: V3): V3[] {
  const out: V3[] = [];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const a = pts[t[k]], b = pts[t[(k + 1) % 3]];
      const da = dot(sub(a, o), n), db = dot(sub(b, o), n);
      if (da * db < 0) {
        const s = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s]);
      }
    }
  }
  return out;
}

/** Principal axis (unit) of a point cloud by power iteration on its covariance. */
function principal(pts: readonly V3[]): V3 {
  const n = pts.length;
  const m: V3 = [0, 0, 0];
  for (const p of pts) { m[0] += p[0] / n; m[1] += p[1] / n; m[2] += p[2] / n; }
  const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) { const d = sub(p, m); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i][j] += d[i] * d[j];
  }
  let v: V3 = [0.3, 0.2, 1];
  for (let it = 0; it < 80; it++) {
    const w: V3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) w[i] = c[i][0] * v[0] + c[i][1] * v[1] + c[i][2] * v[2];
    const l = Math.hypot(w[0], w[1], w[2]) || 1;
    v = [w[0] / l, w[1] / l, w[2] / l];
  }
  return v;
}

/** Connected components of the triangle set, by shared vertex index: lists of vertex indices. */
function components(pts: readonly V3[], tris: readonly [number, number, number][]): number[][] {
  const n = pts.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  // a hard edge splits a vertex in the file (one per normal): weld them by position first
  const seen = new Map<string, number>();
  pts.forEach((p, i) => {
    const key = `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)},${Math.round(p[2] * 1e5)}`;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, i); else parent[i] = first;
  });
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (const [a, b, c] of tris) { parent[find(a)] = find(b); parent[find(b)] = find(c); }
  const groups = new Map<number, number[]>();
  const used = new Set<number>();
  for (const t of tris) for (const v of t) used.add(v);
  for (const v of used) { const r = find(v); const g = groups.get(r); if (g) g.push(v); else groups.set(r, [v]); }
  return [...groups.values()];
}

const bbox = (ps: readonly V3[]) => ({
  lo: [0, 1, 2].map((k) => Math.min(...ps.map((p) => p[k]))) as V3,
  hi: [0, 1, 2].map((k) => Math.max(...ps.map((p) => p[k]))) as V3,
});

/** The Meshy block's extents: what hangs below the receiver (z < -0.045) between the stock and the magazine. */
function blockExtents(pts: readonly V3[]): V3 | null {
  const b = pts.filter((p) => p[0] > -0.2 && p[0] < -0.04 && p[2] < -0.045);
  if (b.length < 4) return null;
  const k = bbox(b);
  return [k.hi[0] - k.lo[0], k.hi[1] - k.lo[1], k.hi[2] - k.lo[2]];
}

/**
 * Reads the grip, the guard and the trigger. The reshaped grip, guard bar and trigger are loose
 * pieces of the part (the exporter welds none of them to the Meshy body), so the three are the
 * small connected components behind the magazine: the biggest is the grip, the next the guard,
 * the smallest the trigger. A part whose grip is still part of the body (the Meshy block) has no
 * such piece and reads as 'grip not found'.
 */
export function measureGrip(path: string): GripReading {
  const { pts, tris } = load(path);
  const lengthM = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
  const small = components(pts, tris)
    .filter((c) => c.length <= 80)
    .map((c) => ({ c, v: c.map((i) => pts[i]) }))
    .filter(({ v }) => { const b = bbox(v); return b.lo[0] > -0.25 && b.hi[0] < 0.0 && b.hi[2] < 0.0; })
    .sort((a, b) => b.c.length - a.c.length);
  const NONE: GripReading = { triangles: tris.length, lengthM, rakeDeg: 0, gripBottomZ: 0, widthM: 0, depthM: 0, guardRunM: 0, magClearM: null,
    lengthOfPullM: null, found: false, blockM: blockExtents(pts), axisPoint: null, axisDir: null };
  if (small.length < 3) return NONE;
  const gripV = small[0].v, barV = small[1].v, trigV = small[2].v;
  // grip: axis by power iteration over its own vertices, slice through its centroid, in-plane extents
  let ax = principal(gripV);
  if (ax[2] > 0) ax = [-ax[0], -ax[1], -ax[2]];
  const rakeDeg = (Math.atan2(-ax[0], -ax[2]) * 180) / Math.PI;            // positive: the bottom is back
  const cen: V3 = [0, 0, 0];
  for (const p of gripV) { cen[0] += p[0] / gripV.length; cen[1] += p[1] / gripV.length; cen[2] += p[2] / gripV.length; }
  const gtris = tris.filter((t) => t.every((i) => gripV.includes(pts[i])));
  const sl = slice(pts, gtris, cen, ax);
  const lat: V3 = [0, 1, 0];
  const fw: V3 = [ax[1] * lat[2] - ax[2] * lat[1], ax[2] * lat[0] - ax[0] * lat[2], ax[0] * lat[1] - ax[1] * lat[0]];
  const yy = sl.map((p) => dot(p, lat)), ff = sl.map((p) => dot(p, fw));
  const widthM = sl.length >= 3 ? Math.max(...yy) - Math.min(...yy) : 0;
  const depthM = sl.length >= 3 ? Math.max(...ff) - Math.min(...ff) : 0;
  const gripBottomZ = Math.min(...gripV.map((p) => p[2]));
  // guard: the loose bar. Its lowest run, and its front end against the magazine
  const bb = bbox(barV);
  const run = barV.filter((p) => p[2] < bb.lo[2] + 0.005);
  const guardRunM = Math.max(...run.map((p) => p[0])) - Math.min(...run.map((p) => p[0]));
  const front = barV.reduce((b, p) => (p[0] > b[0] ? p : b), barV[0]);
  const inSmall = new Set(small.flatMap((s) => s.c));
  const mag = pts.filter((p, i) => !inSmall.has(i) && p[0] > front[0] + 0.003 && p[0] < front[0] + 0.12 && p[2] < -0.065 && p[2] > -0.16);
  const magClearM = mag.length ? Math.min(...mag.map((p) => Math.hypot(p[0] - front[0], p[2] - front[2]))) : null;
  const lengthOfPullM = Math.min(...trigV.map((p) => p[0])) - BUTT_X;
  return { triangles: tris.length, lengthM, rakeDeg, gripBottomZ, widthM, depthM, guardRunM, magClearM, lengthOfPullM, found: true, blockM: null, axisPoint: cen, axisDir: ax };
}

export function gripViolations(r: GripReading, L: typeof GRIP_LIMITS = GRIP_LIMITS): string[] {
  const out: string[] = [];
  const band = (name: string, v: number | null, [lo, hi]: readonly [number, number]) => {
    if (v === null || !(v >= lo && v <= hi)) out.push(`${name} ${v === null ? 'not found' : v.toFixed(4)} outside ${lo} to ${hi}`);
  };
  if (r.triangles > L.triangles) out.push(`${r.triangles} triangles over ${L.triangles}`);
  if (!r.found) { out.push('grip not found: no loose grip, guard and trigger behind the magazine (the Meshy block is part of the body)' + (r.blockM ? `: it hangs ${r.blockM[0].toFixed(3)} x ${r.blockM[1].toFixed(3)} x ${r.blockM[2].toFixed(3)} m` : '')); return out; }
  band('grip width', r.widthM, L.widthM);
  band('grip depth', r.depthM, L.depthM);
  band('grip rake', r.rakeDeg, L.rakeDeg);
  band('grip bottom z', r.gripBottomZ, L.gripBottomZ);
  if (!(r.guardRunM >= L.guardRunM)) out.push(`no trigger guard: lowest bar run ${r.guardRunM.toFixed(3)} under ${L.guardRunM}`);
  band('guard to magazine clearance', r.magClearM, L.magClearM);
  band('length of pull', r.lengthOfPullM, L.lengthOfPullM);
  return out;
}

/** Distance from a point to the part's surface, by the nearest triangle (the point-to-triangle distance). */
export function distanceToSurface(path: string, q: V3): number {
  const { pts, tris } = load(path);
  let best = Infinity;
  for (const t of tris) best = Math.min(best, pointTriangle(q, pts[t[0]], pts[t[1]], pts[t[2]]));
  return best;
}

function pointTriangle(p: V3, a: V3, b: V3, c: V3): number {
  // Ericson, Real-Time Collision Detection, closest point on a triangle
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  const len = (v: V3) => Math.hypot(v[0], v[1], v[2]);
  if (d1 <= 0 && d2 <= 0) return len(ap);
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return len(bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return len(sub(p, [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v])); }
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return len(cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return len(sub(p, [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w])); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + d5 - d6);
    return len(sub(p, [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return len(sub(p, [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]));
}

/** The handguard's section at x (the extents of the body's slice there), for the support station. */
export function sectionAt(path: string, x: number): { widthM: number; heightM: number; bottomZ: number; centreY: number } {
  const { pts, tris } = load(path);
  const body = components(pts, tris).sort((a, b) => b.length - a.length)[0];
  const set = new Set(body);
  const bt = tris.filter((t) => set.has(t[0]));
  const sl = slice(pts, bt, [x, 0, 0], [1, 0, 0]);
  if (sl.length < 6) throw new Error(`${path}: no section at x ${x}`);
  const y = sl.map((p) => p[1]), z = sl.map((p) => p[2]);
  return { widthM: Math.max(...y) - Math.min(...y), heightM: Math.max(...z) - Math.min(...z), bottomZ: Math.min(...z), centreY: (Math.max(...y) + Math.min(...y)) / 2 };
}

/** Distance of a point from a line (point + unit direction). */
export function distanceToLine(q: V3, o: V3, d: V3): number {
  const v = sub(q, o);
  const k = dot(v, d);
  return Math.hypot(v[0] - d[0] * k, v[1] - d[1] * k, v[2] - d[2] * k);
}

/**
 * How far the part's PRINCIPAL axis (what `measureWeaponAxis` reads off a figure's weapon cloud) rides above its bore,
 * degrees, from the part's own bytes. The bore is level in the part frame by construction; the raked grip, the
 * magazine and the optic hang below the rear and drag the first principal component off it. The mesh_gait weapon
 * gates pin this number so a re-shaped carbine cannot move the aim without someone re-deriving it.
 */
export function pcaElevationDeg(path: string): number {
  const { pts } = load(path);
  let ax = principal(pts);
  if (ax[0] < 0) ax = [-ax[0], -ax[1], -ax[2]];
  return (Math.asin(ax[2]) * 180) / Math.PI;
}
