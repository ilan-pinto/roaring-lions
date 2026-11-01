/**
 * How much of a hand's palm still lies on the weapon when the hand is turned off its station (GH-826).
 *
 * The hold turns a hand off the station's own orientation when its wrist would otherwise bend past its anatomy, and a
 * turned hand lifts off the grip: the contact the gate holds at 25% (palm-side surface within 8 mm of the weapon, by
 * area) falls about 1.5 points a degree. The hand's contact depends on nothing but that turn (it is a rigid hand on a
 * rigid weapon), so it is tabulated once from the two library parts and looked up as the solver searches, and the
 * turn is priced by what it costs in contact instead of by a guess.
 *
 * A turn is a roll about the hand's channel axis, then a tilt of that axis about two axes across it, all in the
 * hand's own frame and about the station's reference point. This module and `placeHand` share the parametrisation.
 */
import { readAccessor, readGlb } from '../../mesh_gait';
import { fileURLToPath } from 'node:url';
import { cross, dot, norm, qaxis, qmul, qrot, sub, type Q, type V3 } from './math';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const CONTACT_RADIUS = 0.008;

/** Roll grid (degrees) and tilt grid (degrees, either axis). */
const ROLLS = [-40, -30, -20, -10, 0, 10, 20, 30, 40];
const TILTS = [-15, -7.5, 0, 7.5, 15];

export interface ContactTable {
  /** Contact fraction (0..1) for a roll about the channel axis and a tilt of it, radians. */
  at(roll: number, tilt1: number, tilt2: number, trigger?: number): number;
  /** The deepest the weapon's surface sits inside the turned hand, metres, for the same turn. */
  depth(roll: number, tilt1: number, tilt2: number, trigger?: number): number;
}

/** A trigger finger that turns on its own bone: the library part, its knuckle line, and how far it flexes at full aim. */
export interface FingerSpec { readonly part: string; readonly pivot: readonly number[]; readonly axis: readonly number[]; readonly deg: number }

function rotVec(o: V3): Q {
  const a = Math.hypot(o[0], o[1], o[2]);
  if (a < 1e-12) return [0, 0, 0, 1];
  const k = Math.sin(a / 2) / a;
  return [o[0] * k, o[1] * k, o[2] * k, Math.cos(a / 2)];
}

/** The two unit axes across a channel axis, in the hand's own frame. */
export function across(channel: V3): [V3, V3] {
  const c = norm(channel);
  const e1 = norm(cross(c, Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  return [e1, cross(c, e1)];
}

/** The hand-local rotation of a turn: the tilt of the channel axis after a roll about it. */
export function turnOf(channel: V3, roll: number, tilt1: number, tilt2: number): Q {
  const [e1, e2] = across(channel);
  return qmul(rotVec([e1[0] * tilt1 + e2[0] * tilt2, e1[1] * tilt1 + e2[1] * tilt2, e1[2] * tilt1 + e2[2] * tilt2]), qaxis(norm(channel), roll));
}

type Tri = readonly [V3, V3, V3];

function partTris(path: string, nodeName: string | null): Tri[] {
  const glb = readGlb(path);
  const nodes = glb.json.nodes ?? [];
  const node = nodeName === null ? nodes.find((n) => n.mesh !== undefined) : nodes.find((n) => n.name === nodeName);
  if (!node || node.mesh === undefined) throw new Error(`${path}: no mesh ${nodeName ?? ''}`);
  const prim = glb.json.meshes![node.mesh].primitives[0];
  const pos = readAccessor(glb, prim.attributes.POSITION).data;
  const idx = readAccessor(glb, prim.indices!).data;
  const at = (i: number): V3 => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const out: Tri[] = [];
  for (let f = 0; f + 2 < idx.length; f += 3) out.push([at(idx[f]), at(idx[f + 1]), at(idx[f + 2])]);
  return out;
}

function pointTriDist(p: V3, a: V3, b: V3, c: V3): number {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return Math.hypot(ap[0], ap[1], ap[2]);
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return Math.hypot(bp[0], bp[1], bp[2]);
  const vc = d1 * d4 - d3 * d2;
  const L = (q: V3): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return L([a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]); }
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return Math.hypot(cp[0], cp[1], cp[2]);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return L([a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return L([b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]); }
  const den = 1 / (va + vb + vc);
  const v = vb * den, w = vc * den;
  return L([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}

/** Connected closed pieces of a mesh (welded by position), each a triangle list with its bounding box. */
function pieces(tris: readonly Tri[]): { tris: Tri[]; lo: V3; hi: V3 }[] {
  const weld = new Map<string, number>();
  const id = (v: V3): number => {
    const k = `${Math.round(v[0] * 1e5)},${Math.round(v[1] * 1e5)},${Math.round(v[2] * 1e5)}`;
    let w = weld.get(k);
    if (w === undefined) { w = weld.size; weld.set(k, w); }
    return w;
  };
  const par: number[] = [];
  const find = (a: number): number => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const ids = tris.map((t) => t.map(id));
  for (let i = 0; i < weld.size; i++) par[i] = i;
  for (const t of ids) { par[find(t[0])] = find(t[1]); par[find(t[1])] = find(t[2]); }
  const groups = new Map<number, Tri[]>();
  tris.forEach((t, i) => { const r = find(ids[i][0]); (groups.get(r) ?? groups.set(r, []).get(r)!).push(t); });
  return [...groups.values()].map((g) => {
    const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const t of g) for (const v of t) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
    return { tris: g, lo, hi };
  });
}

function rayHits(o: V3, d: V3, a: V3, b: V3, c: V3): boolean {
  const e1 = sub(b, a), e2 = sub(c, a);
  const h = cross(d, e2);
  const det = dot(e1, h);
  if (Math.abs(det) < 1e-14) return false;
  const f = 1 / det;
  const sv = sub(o, a);
  const u = f * dot(sv, h);
  if (u < 0 || u > 1) return false;
  const q = cross(sv, e1);
  const v = f * dot(d, q);
  if (v < 0 || u + v > 1) return false;
  return f * dot(e2, q) > 1e-9;
}
const RAYS: V3[] = [[0.5773, 0.5774, 0.5775], [-0.3714, 0.5571, 0.7428], [0.2673, -0.5345, 0.8018]];

const CACHE = new Map<string, ContactTable>();

/**
 * The table for one hand. `station` takes the hand's frame to the carbine part's (glTF axes), `ref` is the hand-local
 * point the turn is about, `channel` the hand-local axis it rolls about, `parts` the hand-library meshes that make up
 * the hand (palm-side triangles of each are counted).
 */
export function contactTable(
  station: { R: number[][]; t: number[] }, ref: V3, channel: V3, parts: readonly string[], finger: FingerSpec | null = null,
  handsLib = `${REPO}art/parts/hands/hands_lib.glb`, carbine = `${REPO}art/parts/kdf_carbine/kdf_carbine.glb`,
): ContactTable {
  const key = JSON.stringify([station, ref, channel, parts, finger, handsLib, carbine]);
  const hit = CACHE.get(key);
  if (hit) return hit;
  const weapon = partTris(carbine, null);
  const R = station.R;
  const toPart = (p: V3): V3 => [
    R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2] + station.t[0],
    R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] + station.t[1],
    R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + station.t[2],
  ];
  const samples: V3[] = [];
  for (const w of weapon) samples.push(w[0], [(w[0][0] + w[1][0] + w[2][0]) / 3, (w[0][1] + w[1][1] + w[2][1]) / 3, (w[0][2] + w[1][2] + w[2][2]) / 3]);
  // The hand's triangles with the trigger finger turned `fingerDeg` toward the palm (0: as the library has it).
  const handTris = (fingerDeg: number): Tri[] => parts.flatMap((nm) => {
    const tris = partTris(handsLib, nm);
    if (!finger || nm !== finger.part || fingerDeg === 0) return tris;
    const pivot = finger.pivot as unknown as V3;
    const q = qaxis(norm(finger.axis as unknown as V3), (-fingerDeg * Math.PI) / 180);
    return tris.map((t) => t.map((v) => {
      const d = qrot(q, sub(v, pivot));
      return [pivot[0] + d[0], pivot[1] + d[1], pivot[2] + d[2]] as V3;
    }) as unknown as Tri);
  });
  const grids = (fingerDeg: number): { grid: Float64Array; dgrid: Float64Array } => {
    const all = handTris(fingerDeg);
    // palm-side triangles: the normal faces the palm (hand z < -0.3) and the triangle is past the wrist plane (y > 0)
    const palm: { c: V3; area: number }[] = [];
    for (const [a, b, c] of all) {
      const n = cross(sub(b, a), sub(c, a));
      const nl = Math.hypot(n[0], n[1], n[2]);
      if (nl < 1e-12 || n[2] / nl > -0.3) continue;
      const cen: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      if (cen[1] <= 0) continue;
      palm.push({ c: cen, area: nl / 2 });
    }
    const total = palm.reduce((sum, p) => sum + p.area, 0);
    const handPieces = pieces(all);
    const grid = new Float64Array(ROLLS.length * TILTS.length * TILTS.length);
    const dgrid = new Float64Array(grid.length);
    ROLLS.forEach((rd, i) => {
      TILTS.forEach((t1d, j) => {
        TILTS.forEach((t2d, k) => {
          const q = turnOf(channel, (rd * Math.PI) / 180, (t1d * Math.PI) / 180, (t2d * Math.PI) / 180);
          let near = 0;
          for (const p of palm) {
            const d = qrot(q, sub(p.c, ref));
            const x = toPart([ref[0] + d[0], ref[1] + d[1], ref[2] + d[2]]);
            let best = Infinity;
            for (const w of weapon) {
              if (x[0] < Math.min(w[0][0], w[1][0], w[2][0]) - CONTACT_RADIUS || x[0] > Math.max(w[0][0], w[1][0], w[2][0]) + CONTACT_RADIUS) continue;
              if (x[1] < Math.min(w[0][1], w[1][1], w[2][1]) - CONTACT_RADIUS || x[1] > Math.max(w[0][1], w[1][1], w[2][1]) + CONTACT_RADIUS) continue;
              if (x[2] < Math.min(w[0][2], w[1][2], w[2][2]) - CONTACT_RADIUS || x[2] > Math.max(w[0][2], w[1][2], w[2][2]) + CONTACT_RADIUS) continue;
              best = Math.min(best, pointTriDist(x, w[0], w[1], w[2]));
              if (best < CONTACT_RADIUS) break;
            }
            if (best < CONTACT_RADIUS) near += p.area;
          }
          const at = (i * TILTS.length + j) * TILTS.length + k;
          grid[at] = total > 0 ? near / total : 0;
          // depth: the weapon's points carried into the hand's own (unturned) frame, then tested against its closed pieces
          const qi: Q = [-q[0], -q[1], -q[2], q[3]];
          let deepest = 0;
          for (const x of samples) {
            const rel = sub(x, [station.t[0], station.t[1], station.t[2]]);
            const loc: V3 = [
              R[0][0] * rel[0] + R[1][0] * rel[1] + R[2][0] * rel[2],
              R[0][1] * rel[0] + R[1][1] * rel[1] + R[2][1] * rel[2],
              R[0][2] * rel[0] + R[1][2] * rel[1] + R[2][2] * rel[2],
            ];
            const d = qrot(qi, sub(loc, ref));
            const p: V3 = [ref[0] + d[0], ref[1] + d[1], ref[2] + d[2]];
            for (const pc of handPieces) {
              if (p[0] < pc.lo[0] || p[1] < pc.lo[1] || p[2] < pc.lo[2] || p[0] > pc.hi[0] || p[1] > pc.hi[1] || p[2] > pc.hi[2]) continue;
              let votes = 0;
              for (const ray of RAYS) {
                let hits = 0;
                for (const t of pc.tris) if (rayHits(p, ray, t[0], t[1], t[2])) hits++;
                if (hits % 2 === 1) votes++;
              }
              if (votes < 2) continue;
              let best2 = Infinity;
              for (const t of pc.tris) best2 = Math.min(best2, pointTriDist(p, t[0], t[1], t[2]));
              deepest = Math.max(deepest, best2);
            }
          }
          dgrid[at] = deepest;
        });
      });
    });
    return { grid, dgrid };
  };
  const rest = grids(0);
  const trig = finger ? grids(finger.deg) : rest;
  const lerpIndex = (axis: readonly number[], x: number): [number, number, number] => {
    const xd = (x * 180) / Math.PI;
    const c = Math.max(axis[0], Math.min(axis[axis.length - 1], xd));
    let i = 0;
    while (i < axis.length - 2 && c > axis[i + 1]) i++;
    return [i, i + 1, (c - axis[i]) / (axis[i + 1] - axis[i])];
  };
  const interp = (g: Float64Array, roll: number, tilt1: number, tilt2: number): number => {
    const [r0, r1, rf] = lerpIndex(ROLLS, roll);
    const [a0, a1, af] = lerpIndex(TILTS, tilt1);
    const [b0, b1, bf] = lerpIndex(TILTS, tilt2);
    const at = (i: number, j: number, k: number): number => g[(i * TILTS.length + j) * TILTS.length + k];
    let acc = 0;
    for (const [ri, rw] of [[r0, 1 - rf], [r1, rf]] as const) {
      for (const [ai, aw] of [[a0, 1 - af], [a1, af]] as const) {
        for (const [bi, bw] of [[b0, 1 - bf], [b1, bf]] as const) acc += rw * aw * bw * at(ri, ai, bi);
      }
    }
    return acc;
  };
  const mix = (w: number, a: number, b: number): number => a + (b - a) * Math.max(0, Math.min(1, w));
  const table: ContactTable = {
    at: (roll, tilt1, tilt2, trigger = 0) => mix(trigger, interp(rest.grid, roll, tilt1, tilt2), interp(trig.grid, roll, tilt1, tilt2)),
    depth: (roll, tilt1, tilt2, trigger = 0) => mix(trigger, interp(rest.dgrid, roll, tilt1, tilt2), interp(trig.dgrid, roll, tilt1, tilt2)),
  };
  CACHE.set(key, table);
  return table;
}
