/**
 * The running-gear pass: tag a vehicle's wheels and tracks in its shipped GLB
 * so the renderer can spin and scroll them, while keeping every existing
 * vertex as it is.
 *
 *     pnpm running-gear:meshes                  # every vehicle with a recipe
 *     pnpm running-gear:meshes -- --id=jeep_shoded
 *
 * Design: `docs/superpowers/specs/2026-10-12-wheels-and-tracks-design.md` §2.
 * Contract: `2026-08-28-mesh-unit-contract.md`, "v7 (vehicles) -- running
 * gear". Pipeline order for a vehicle:
 *
 *     export -> running-gear:meshes -> kit:meshes -> wreck:meshes -> encode:meshes
 *
 * What it writes, per vehicle with a recipe (`running-gear-recipes.ts`):
 *
 * - `_RL_WHEEL` (UNSIGNED_BYTE) and `_RL_TRACK` (FLOAT), BOTH, on every live
 *   `hull_*` primitive that has at least one wheel or track face. A mesh that
 *   carries one carries the other, because the shader reads both and a
 *   missing attribute in WebGL reads whatever generic value was last set,
 *   not a reliable zero.
 * - The same two attributes, zero-filled (`0` / `-1`), on every kit part whose
 *   host now carries them. The kit contract makes a part carry exactly its
 *   host's attribute set, and `mergeGeometries` refuses anything else.
 * - Scene `extras.rl_running_gear` (`RgExtras`): the axles, radii, steering
 *   limits and track loop lengths the runtime reads.
 *
 * Four things worth knowing before touching it:
 *
 * **The existing vertices are a PREFIX of the new ones.** A vertex shared by
 * a wheel face and a static face (a tyre welded to its arch, a road wheel to
 * its track) cannot belong to both: rotated with the wheel, it would drag the
 * arch round with it. So it is DUPLICATED, the copy is APPENDED and the wheel
 * faces are re-pointed at it. Nothing is reordered or removed. The wreck
 * pass's measurements (bounds, lowest vertex, clearance) therefore cannot
 * move, and the kit graft's hosts are not re-cut.
 *
 * **A face is classified whole.** It turns with a wheel only when ALL three
 * vertices lie inside the wheel's cut disc (side view) and its sideways slab.
 * It is track only when all three lie within the band of that side's loop.
 * A face straddling a boundary stays static, so the boundary is the set of
 * vertices on a circle about the axle, and rotation opens no crack wider than
 * the scan's own deviation from round.
 *
 * **The track seam is invisible by construction.** Each side's loop length is
 * divided into a whole number of tread pitches (`pitch` in the extras). A face
 * spanning the point where the loop coordinate wraps from `L` to `0` gets its
 * low corners lifted by `L`, through the same duplication. The bar pattern is
 * periodic in `pitch`, so `u` and `u + L` draw identically.
 *
 * **Idempotent.** A second run finds every boundary already split, so it
 * creates no vertex. It writes the same `_RL_*` arrays into the accessors it
 * wrote the first time, and the same extras, so the file's bytes come out the
 * same. `running-gear-pass.test.ts` pins this.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Accessor, type Document, type Node, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { isKitName } from './kit-contract';
import {
  RG_EXTRAS_KEY,
  RG_MAX_STEER_RAD,
  RG_MAX_WHEELS,
  RG_NOT_TRACK,
  RG_TRACK_ATTR,
  RG_TREAD_PITCH_M,
  RG_VERSION,
  RG_WHEEL_ATTR,
  type RgExtras,
  type RgSide,
  type RgTrack,
  type RgWheel,
} from './running-gear-contract';
import { RUNNING_GEAR_RECIPES, SLAB_MARGIN_M, type RunningGearRecipe, type WheelSeed } from './running-gear-recipes';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const VEHICLES = path.join(REPO, 'art', 'meshes', 'vehicles');

const DEATH_ROOT = 'death_root';
const WRECK_PREFIX = 'WRECK_';
const HULL_PREFIX = 'hull_';
const RUBBER = 'hull_rubber';
/** Welding tolerance for the rubber connected-component pass (UV seams split
 *  vertices that are one point in space). */
const WELD_M = 1e-4;
/** A hull mesh must sit at the identity: the extras' axles are in its space. */
const IDENTITY_EPS = 1e-6;

const sideSign = (side: RgSide): number => (side === 'r' ? 1 : -1);

// ---------------------------------------------------------------------------
// The track loop: a 2-D outline in side view, walked clockwise
// ---------------------------------------------------------------------------

export interface Loop {
  /** Clockwise (x right, y up) from the topmost point, closed implicitly. */
  readonly pts: readonly (readonly [number, number])[];
  /** Per edge `i` (from `pts[i]` to the next): false for an edge that is a cut
   *  line rather than track (`TrackSeed.openTop`), which no face may be near. */
  readonly solid: readonly boolean[];
  /** Cumulative arc length at each point; `cum[n]` is the perimeter. */
  readonly cum: readonly number[];
  readonly length: number;
}

/** Andrew's monotone chain, returned CLOCKWISE starting at the topmost point
 *  (ties: the frontmost). Clockwise is what makes the loop coordinate grow
 *  REARWARD along the bottom run, which is the way the ground runs past a hull
 *  moving forward -- so the runtime adds to the phase for forward motion. */
export function loopFromPoints(points: readonly (readonly [number, number])[], openTop = false): Loop {
  const uniq = new Map<string, [number, number]>();
  for (const [x, y] of points) uniq.set(`${Math.round(x * 1e5)},${Math.round(y * 1e5)}`, [x, y]);
  const p = [...uniq.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) throw new Error(`a track loop needs at least 3 distinct points, got ${p.length}`);
  const cross = (o: number[], a: number[], b: number[]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  const ccw = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  const cw = ccw.slice().reverse();
  let start = 0;
  for (let i = 1; i < cw.length; i++) {
    if (cw[i][1] > cw[start][1] || (cw[i][1] === cw[start][1] && cw[i][0] > cw[start][0])) start = i;
  }
  const pts = [...cw.slice(start), ...cw.slice(0, start)];
  const cum = [0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const top = Math.max(...pts.map((q) => q[1]));
  const solid = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    return !(openTop && a[1] >= top - OPEN_TOP_EPS_M && b[1] >= top - OPEN_TOP_EPS_M);
  });
  return { pts, solid, cum, length: cum[pts.length] };
}

/** How close to the top an edge's two ends must be to count as the cut line. */
const OPEN_TOP_EPS_M = 0.05;

/** Distance from `(x, y)` to the loop outline, and the arc length of the
 *  nearest point on it. */
export function nearestOnLoop(loop: Loop, x: number, y: number): { dist: number; u: number } {
  let best = Infinity;
  let bestU = 0;
  const n = loop.pts.length;
  for (let i = 0; i < n; i++) {
    if (!loop.solid[i]) continue;
    const a = loop.pts[i];
    const b = loop.pts[(i + 1) % n];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len2 = ex * ex + ey * ey;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - a[0]) * ex + (y - a[1]) * ey) / len2)) : 0;
    const qx = a[0] + t * ex;
    const qy = a[1] + t * ey;
    const d = Math.hypot(x - qx, y - qy);
    if (d < best) {
      best = d;
      bestU = loop.cum[i] + t * Math.sqrt(len2);
    }
  }
  return { dist: best, u: bestU };
}

/** The real pitch: the nominal one rounded so a whole number of bars fits. */
export function pitchFor(loopLength: number, nominal: number = RG_TREAD_PITCH_M): number {
  return loopLength / Math.max(1, Math.round(loopLength / nominal));
}

// ---------------------------------------------------------------------------
// Reading the document
// ---------------------------------------------------------------------------

export interface HullMesh {
  readonly node: Node;
  readonly prim: Primitive;
  readonly pos: Float32Array;
  readonly idx: Uint32Array;
}

function underDeathRoot(node: Node): boolean {
  for (let walk: Node | null = node; walk; walk = walk.getParentNode()) {
    if (walk.getName() === DEATH_ROOT) return true;
  }
  return false;
}

function isIdentity(m: readonly number[]): boolean {
  for (let i = 0; i < 16; i++) {
    if (Math.abs(m[i] - (i % 5 === 0 ? 1 : 0)) > IDENTITY_EPS) return false;
  }
  return true;
}

function floatArray(a: Accessor, what: string): Float32Array {
  const arr = a.getArray();
  if (!(arr instanceof Float32Array)) throw new Error(`${what} is not FLOAT`);
  return arr;
}

/** The live `hull_*` meshes: not a kit part, not a wreck twin, not under the
 *  death root or a pivot. */
export function hullMeshes(doc: Document, id: string): HullMesh[] {
  const out: HullMesh[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    const mesh = node.getMesh();
    if (!mesh || !name.startsWith(HULL_PREFIX) || isKitName(name) || name.startsWith(WRECK_PREFIX)) continue;
    if (underDeathRoot(node) || node.getParentNode() !== null) continue;
    if (!isIdentity(node.getWorldMatrix() as unknown as number[])) {
      throw new Error(`${id}: ${name} is not at the identity, so its wheels cannot be described in the scene's space`);
    }
    const prims = mesh.listPrimitives();
    if (prims.length !== 1) throw new Error(`${id}: ${name} has ${prims.length} primitives; a hull mesh has one`);
    const prim = prims[0];
    const posA = prim.getAttribute('POSITION');
    const idxA = prim.getIndices();
    if (!posA) throw new Error(`${id}: ${name} has no POSITION`);
    if (!idxA) throw new Error(`${id}: ${name} is not indexed`);
    const raw = idxA.getArray();
    if (!raw) throw new Error(`${id}: ${name}'s indices have no data`);
    out.push({ node, prim, pos: floatArray(posA, `${id}: ${name} POSITION`), idx: Uint32Array.from(raw) });
  }
  if (out.length === 0) throw new Error(`${id}: no live hull_* mesh`);
  return out;
}

/** Rubber triangles' connected-part sizes, after welding by position. */
function componentSizes(h: HullMesh): Int32Array {
  const n = h.pos.length / 3;
  const rep = new Int32Array(n);
  const seen = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(h.pos[i * 3] / WELD_M)},${Math.round(h.pos[i * 3 + 1] / WELD_M)},${Math.round(h.pos[i * 3 + 2] / WELD_M)}`;
    const hit = seen.get(k);
    if (hit === undefined) seen.set(k, i);
    rep[i] = hit ?? i;
  }
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const tris = h.idx.length / 3;
  for (let t = 0; t < tris; t++) {
    const a = find(rep[h.idx[t * 3]]);
    const b = find(rep[h.idx[t * 3 + 1]]);
    const c = find(rep[h.idx[t * 3 + 2]]);
    parent[a] = b;
    parent[find(c)] = find(b);
  }
  const size = new Map<number, number>();
  const rootOf = new Int32Array(tris);
  for (let t = 0; t < tris; t++) {
    const r = find(rep[h.idx[t * 3]]);
    rootOf[t] = r;
    size.set(r, (size.get(r) ?? 0) + 1);
  }
  const out = new Int32Array(tris);
  for (let t = 0; t < tris; t++) out[t] = size.get(rootOf[t]) ?? 0;
  return out;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** What each corner of each face wants: a wheel id (0 static) and a track
 *  coordinate (-1 not track). Indexed by `face * 3 + corner`. */
interface Tags {
  readonly wheel: Uint8Array;
  readonly track: Float64Array;
}

export interface Classified {
  readonly perMesh: Map<HullMesh, Tags>;
  readonly loops: Map<RgSide, Loop>;
  readonly wheelFaces: number[];
  readonly trackFaces: Map<RgSide, number>;
}

function wheelOf(recipe: RunningGearRecipe, pos: Float32Array, idx: Uint32Array, t: number): number {
  let best = 0;
  let bestD = Infinity;
  recipe.wheels.forEach((w, k) => {
    const s = sideSign(w.side);
    const rc = w.r * recipe.cut;
    let cx = 0;
    let cy = 0;
    for (let c = 0; c < 3; c++) {
      const v = idx[t * 3 + c];
      const x = pos[v * 3];
      const y = pos[v * 3 + 1];
      const z = pos[v * 3 + 2] * s;
      // On its own side, always: the Grad's slab starts at the centreline, and
      // a face crossing it belongs to neither wheel.
      if (z <= 0 || z < w.zIn - SLAB_MARGIN_M || z > w.zOut + SLAB_MARGIN_M) return;
      if (Math.hypot(x - w.x, y - w.y) >= rc) return;
      cx += x / 3;
      cy += y / 3;
    }
    const d = Math.hypot(cx - w.x, cy - w.y);
    if (d < bestD) {
      bestD = d;
      best = k + 1;
    }
  });
  return best;
}

function sideOfFace(pos: Float32Array, idx: Uint32Array, t: number): RgSide | null {
  let pos_ = 0;
  let neg = 0;
  for (let c = 0; c < 3; c++) {
    const z = pos[idx[t * 3 + c] * 3 + 2];
    if (z > 0) pos_++;
    else if (z < 0) neg++;
  }
  return pos_ === 3 ? 'r' : neg === 3 ? 'l' : null;
}

export function classify(id: string, recipe: RunningGearRecipe, meshes: readonly HullMesh[]): Classified {
  const perMesh = new Map<HullMesh, Tags>();
  const wheelFaces = new Array<number>(recipe.wheels.length).fill(0);
  const trackFaces = new Map<RgSide, number>();
  const loops = new Map<RgSide, Loop>();

  const rubber = meshes.find((m) => m.node.getName() === RUBBER);
  const track = recipe.track;
  let comp: Int32Array | null = null;
  if (track) {
    if (!rubber) throw new Error(`${id}: a tracked recipe and no ${RUBBER}`);
    comp = componentSizes(rubber);
    for (const side of ['r', 'l'] as const) {
      const s = sideSign(side);
      const pts: [number, number][] = [];
      const tris = rubber.idx.length / 3;
      for (let t = 0; t < tris; t++) {
        if (comp[t] < track.minComponentTris) continue;
        for (let c = 0; c < 3; c++) {
          const v = rubber.idx[t * 3 + c];
          const z = rubber.pos[v * 3 + 2] * s;
          const y = rubber.pos[v * 3 + 1];
          const x = rubber.pos[v * 3];
          if (z >= track.zIn && z <= track.zOut && y <= track.loopMaxY && x <= (track.loopMaxX ?? Infinity)) pts.push([x, y]);
        }
      }
      loops.set(side, loopFromPoints(pts, track.openTop === true));
    }
  }

  for (const m of meshes) {
    const tris = m.idx.length / 3;
    const wheel = new Uint8Array(tris * 3);
    const trk = new Float64Array(tris * 3).fill(RG_NOT_TRACK);
    for (let t = 0; t < tris; t++) {
      const k = recipe.wheels.length > 0 ? wheelOf(recipe, m.pos, m.idx, t) : 0;
      if (k > 0) {
        wheel.fill(k, t * 3, t * 3 + 3);
        wheelFaces[k - 1]++;
        continue;
      }
      if (!track || m !== rubber || !comp || comp[t] < track.minComponentTris) continue;
      const side = sideOfFace(m.pos, m.idx, t);
      if (side === null) continue;
      const s = sideSign(side);
      const loop = loops.get(side);
      if (!loop) continue;
      let ok = true;
      const us: number[] = [];
      let cx = 0;
      let cy = 0;
      for (let c = 0; c < 3 && ok; c++) {
        const v = m.idx[t * 3 + c];
        const x = m.pos[v * 3];
        const y = m.pos[v * 3 + 1];
        const z = m.pos[v * 3 + 2] * s;
        if (z < track.zIn || z > track.zOut) ok = false;
        const near = nearestOnLoop(loop, x, y);
        if (near.dist > track.band) ok = false;
        us.push(near.u);
        cx += x / 3;
        cy += y / 3;
      }
      if (!ok) continue;
      if (track.excludeDiscs.some((d) => d.side === side && Math.hypot(cx - d.x, cy - d.y) < d.r)) continue;
      // The seam: a face spanning u = L -> 0 lifts its low corners by L.
      const lo = Math.min(...us);
      const hi = Math.max(...us);
      for (let c = 0; c < 3; c++) {
        trk[t * 3 + c] = hi - lo > loop.length / 2 && us[c] < loop.length / 2 ? us[c] + loop.length : us[c];
      }
      trackFaces.set(side, (trackFaces.get(side) ?? 0) + 1);
    }
    perMesh.set(m, { wheel, track: trk });
  }
  return { perMesh, loops, wheelFaces, trackFaces };
}

// ---------------------------------------------------------------------------
// Splitting and writing
// ---------------------------------------------------------------------------

/** The new index list and, for each new vertex, the source vertex it copies and
 *  its tags. Vertices `0..n-1` keep their own index. A vertex whose corners
 *  disagree keeps the STATIC tuple when any corner wants it (else the first
 *  face's), and each other tuple gets one appended copy. */
export function splitVertices(
  nVerts: number,
  idx: Uint32Array,
  tags: Tags
): {
  idx: Uint32Array<ArrayBuffer>;
  source: Int32Array<ArrayBuffer>;
  wheel: Uint8Array<ArrayBuffer>;
  track: Float32Array<ArrayBuffer>;
} {
  const tris = idx.length / 3;
  const keeper = new Array<string | undefined>(nVerts);
  const keeperTag = new Array<[number, number] | undefined>(nVerts);
  const key = (w: number, u: number): string => `${w}|${u}`;
  for (let i = 0; i < tris * 3; i++) {
    const v = idx[i];
    const w = tags.wheel[i];
    const u = tags.track[i];
    if (w === 0 && u === RG_NOT_TRACK) {
      keeper[v] = key(0, RG_NOT_TRACK);
      keeperTag[v] = [0, RG_NOT_TRACK];
    }
  }
  for (let i = 0; i < tris * 3; i++) {
    const v = idx[i];
    if (keeper[v] === undefined) {
      keeper[v] = key(tags.wheel[i], tags.track[i]);
      keeperTag[v] = [tags.wheel[i], tags.track[i]];
    }
  }
  const copies = new Map<string, number>();
  const extraSource: number[] = [];
  const extraTag: [number, number][] = [];
  const out = new Uint32Array(idx.length);
  for (let i = 0; i < tris * 3; i++) {
    const v = idx[i];
    const k = key(tags.wheel[i], tags.track[i]);
    if (k === keeper[v]) {
      out[i] = v;
      continue;
    }
    const ck = `${v}#${k}`;
    let nv = copies.get(ck);
    if (nv === undefined) {
      nv = nVerts + extraSource.length;
      copies.set(ck, nv);
      extraSource.push(v);
      extraTag.push([tags.wheel[i], tags.track[i]]);
    }
    out[i] = nv;
  }
  const total = nVerts + extraSource.length;
  const source = new Int32Array(total);
  const wheel = new Uint8Array(total);
  const track = new Float32Array(total).fill(RG_NOT_TRACK);
  for (let v = 0; v < nVerts; v++) {
    source[v] = v;
    const t = keeperTag[v];
    if (t) {
      wheel[v] = t[0];
      track[v] = t[1];
    }
  }
  extraSource.forEach((s, j) => {
    source[nVerts + j] = s;
    wheel[nVerts + j] = extraTag[j][0];
    track[nVerts + j] = extraTag[j][1];
  });
  return { idx: out, source, wheel, track };
}

function disposeIfOrphan(accessor: Accessor | null): void {
  if (!accessor) return;
  const held = accessor.listParents().filter((p) => p.propertyType !== 'Root');
  if (held.length === 0) accessor.dispose();
}

/** Copy an attribute's elements by `source`, keeping its type: the first
 *  `n` are the originals, the rest are copies. */
function extended(a: Accessor, source: Int32Array): Float32Array<ArrayBuffer> {
  const size = a.getElementSize();
  const src = floatArray(a, `attribute ${a.getName()}`);
  const out = new Float32Array(source.length * size);
  for (let v = 0; v < source.length; v++) {
    for (let c = 0; c < size; c++) out[v * size + c] = src[source[v] * size + c];
  }
  return out;
}

function writeMesh(doc: Document, h: HullMesh, tags: Tags): { added: number; tagged: boolean } {
  const nVerts = h.pos.length / 3;
  const split = splitVertices(nVerts, h.idx, tags);
  const tagged = split.wheel.some((w) => w !== 0) || split.track.some((u) => u !== RG_NOT_TRACK);
  const added = split.source.length - nVerts;
  const prim = h.prim;
  const buffer = doc.getRoot().listBuffers()[0];

  if (added > 0) {
    for (const sem of prim.listSemantics()) {
      if (sem === RG_WHEEL_ATTR || sem === RG_TRACK_ATTR) continue;
      const old = prim.getAttribute(sem);
      if (!old) continue;
      const next = doc
        .createAccessor(old.getName(), buffer)
        .setType(old.getType())
        .setArray(extended(old, split.source));
      prim.setAttribute(sem, next);
      disposeIfOrphan(old);
    }
    const oldIdx = prim.getIndices();
    const big = split.source.length > 65535;
    const idxArr = big ? split.idx : Uint16Array.from(split.idx);
    prim.setIndices(doc.createAccessor(oldIdx?.getName() ?? '', buffer).setType('SCALAR').setArray(idxArr));
    disposeIfOrphan(oldIdx);
  }

  const hadWheel = prim.getAttribute(RG_WHEEL_ATTR);
  const hadTrack = prim.getAttribute(RG_TRACK_ATTR);
  if (!tagged) {
    // A mesh that lost every tag (a recipe change): drop both attributes.
    if (hadWheel || hadTrack) {
      prim.setAttribute(RG_WHEEL_ATTR, null);
      prim.setAttribute(RG_TRACK_ATTR, null);
      disposeIfOrphan(hadWheel);
      disposeIfOrphan(hadTrack);
    }
    return { added, tagged };
  }
  const wheelAcc =
    hadWheel && added === 0 ? hadWheel : doc.createAccessor(`${h.node.getName()}${RG_WHEEL_ATTR}`, buffer).setType('SCALAR');
  wheelAcc.setArray(split.wheel);
  const trackAcc =
    hadTrack && added === 0 ? hadTrack : doc.createAccessor(`${h.node.getName()}${RG_TRACK_ATTR}`, buffer).setType('SCALAR');
  trackAcc.setArray(split.track);
  if (wheelAcc !== hadWheel) {
    prim.setAttribute(RG_WHEEL_ATTR, wheelAcc);
    disposeIfOrphan(hadWheel);
  }
  if (trackAcc !== hadTrack) {
    prim.setAttribute(RG_TRACK_ATTR, trackAcc);
    disposeIfOrphan(hadTrack);
  }
  return { added, tagged };
}

/** Zero-fill both attributes on a kit part (a primitive with a host that now
 *  carries them). Exported for the kit pass, which grafts parts the same way. */
export function zeroFillRunningGear(doc: Document, prim: Primitive, name: string): void {
  const pos = prim.getAttribute('POSITION');
  if (!pos) throw new Error(`${name}: no POSITION`);
  const n = pos.getCount();
  const buffer = doc.getRoot().listBuffers()[0];
  let w = prim.getAttribute(RG_WHEEL_ATTR);
  if (!w) {
    w = doc.createAccessor(`${name}${RG_WHEEL_ATTR}`, buffer).setType('SCALAR');
    prim.setAttribute(RG_WHEEL_ATTR, w);
  }
  w.setArray(new Uint8Array(n));
  let t = prim.getAttribute(RG_TRACK_ATTR);
  if (!t) {
    t = doc.createAccessor(`${name}${RG_TRACK_ATTR}`, buffer).setType('SCALAR');
    prim.setAttribute(RG_TRACK_ATTR, t);
  }
  t.setArray(new Float32Array(n).fill(RG_NOT_TRACK));
}

// ---------------------------------------------------------------------------
// Steering clearance
// ---------------------------------------------------------------------------

/** Voxel edge for the steering clash test, metres. */
const STEER_VOXEL_M = 0.04;
/** Static-surface sample spacing, metres. */
const STEER_SAMPLE_M = 0.025;
/** Allowed new intrusions, as a fraction of the tyre's vertex count. Measured
 *  on the four steered vehicles at main@d4823128: a tyre yawed 4 degrees
 *  already lands 0.1-2.3% of its vertices in a neighbouring 4 cm cell of the
 *  arch or wing it sits close to, and that figure plateaus rather than grows
 *  out to 20 degrees (jeep 1.2%, Shachaf 1.3%, technical 2.3%, gun truck
 *  2.7% at worst) -- grazing, not a clash. 3% sits above that plateau. A tyre
 *  driven into a wall reaches it within a few degrees
 *  (`running-gear-pass.test.ts`). */
const STEER_INTRUSION_FRACTION = 0.03;
const STEER_STEP_RAD = Math.PI / 180;

/**
 * The largest yaw (<= `RG_MAX_STEER_RAD`, in 1-degree steps, the same both
 * ways) at which the steered tyre enters no body surface it did not already
 * touch at rest. The body is sampled densely from every STATIC face of every
 * hull mesh near the wheel, into `STEER_VOXEL_M` cells. The tyre is its tagged
 * vertices yawed about the vertical axis through the axle. A scan whose tyre
 * already touches its arch at rest is not penalised for that contact, only for
 * new contact (`at rest` is the baseline).
 */
export function steerIntrusions(
  w: WheelSeed,
  k: number,
  meshes: readonly HullMesh[],
  classified: Classified,
  deltas: readonly number[]
): { tyreVerts: number; hits: number[] } {
  const s = sideSign(w.side);
  const zc = (s * (w.zIn + w.zOut)) / 2;
  const reach = w.r * 1.6;
  const cells = new Set<string>();
  const cell = (x: number, y: number, z: number): string =>
    `${Math.floor(x / STEER_VOXEL_M)},${Math.floor(y / STEER_VOXEL_M)},${Math.floor(z / STEER_VOXEL_M)}`;
  const tyre: [number, number, number][] = [];
  for (const m of meshes) {
    const tags = classified.perMesh.get(m);
    if (!tags) continue;
    const tris = m.idx.length / 3;
    for (let t = 0; t < tris; t++) {
      const id = tags.wheel[t * 3];
      const P = [0, 1, 2].map((c) => {
        const v = m.idx[t * 3 + c];
        return [m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]] as [number, number, number];
      });
      if (id === k) {
        tyre.push(...P);
        continue;
      }
      if (id !== 0) continue;
      if (P.every((p) => Math.hypot(p[0] - w.x, p[1] - w.y, p[2] - zc) > reach)) continue;
      // Static faces inside the wheel's own disc (the hub, the brake, the
      // knuckle the scans fill in behind the tyre) steer with it in life.
      // The body it can clash with is outside the disc: the arch, the wing,
      // the bumper and the chassis rails.
      const fx = (P[0][0] + P[1][0] + P[2][0]) / 3;
      const fy = (P[0][1] + P[1][1] + P[2][1]) / 3;
      if (Math.hypot(fx - w.x, fy - w.y) < w.r) continue;
      const e1 = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]);
      const e2 = Math.hypot(P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]);
      const n1 = Math.max(1, Math.ceil(e1 / STEER_SAMPLE_M));
      const n2 = Math.max(1, Math.ceil(e2 / STEER_SAMPLE_M));
      for (let i = 0; i <= n1; i++) {
        for (let j = 0; j <= n2; j++) {
          const u = i / n1;
          const v = j / n2;
          if (u + v > 1 + 1e-9) continue;
          cells.add(
            cell(
              P[0][0] + u * (P[1][0] - P[0][0]) + v * (P[2][0] - P[0][0]),
              P[0][1] + u * (P[1][1] - P[0][1]) + v * (P[2][1] - P[0][1]),
              P[0][2] + u * (P[1][2] - P[0][2]) + v * (P[2][2] - P[0][2])
            )
          );
        }
      }
    }
  }
  // A cell the tyre already fills at rest is not body it can newly enter: the
  // scans weld the tyre to its arch and hub, and that contact is not a clash.
  for (const [x, y, z] of tyre) cells.delete(cell(x, y, z));
  const hits = deltas.map((delta) => {
    const c = Math.cos(delta);
    const sn = Math.sin(delta);
    let n = 0;
    for (const [x, y, z] of tyre) {
      const dx = x - w.x;
      const dz = z - zc;
      if (cells.has(cell(w.x + c * dx + sn * dz, y, zc - sn * dx + c * dz))) n++;
    }
    return n;
  });
  return { tyreVerts: tyre.length, hits };
}

/**
 * The largest yaw (<= `RG_MAX_STEER_RAD`, in 1-degree steps, the same both
 * ways) at which no more than `STEER_INTRUSION_FRACTION` of the steered
 * tyre's vertices land in body the tyre did not already fill at rest. The body
 * is every STATIC face of every hull mesh near the wheel, sampled every
 * `STEER_SAMPLE_M` into `STEER_VOXEL_M` cells, minus the cells the tyre itself
 * fills at rest (the scans weld tyre to arch and hub, and that contact is not
 * a clash). The tyre is its tagged vertices, yawed about the vertical axis
 * through the axle. Reported per wheel, and the runtime clamps an axle to the
 * smaller of its two.
 */
export function steerClearance(w: WheelSeed, k: number, meshes: readonly HullMesh[], classified: Classified): number {
  const steps: number[] = [0];
  for (let d = STEER_STEP_RAD; d <= RG_MAX_STEER_RAD + 1e-9; d += STEER_STEP_RAD) steps.push(d, -d);
  const { tyreVerts, hits } = steerIntrusions(w, k, meshes, classified, steps);
  if (tyreVerts === 0) return 0;
  const allowed = Math.ceil(tyreVerts * STEER_INTRUSION_FRACTION);
  let best = 0;
  for (let i = 1; i < steps.length; i += 2) {
    if (hits[i] > allowed || hits[i + 1] > allowed) break;
    best = steps[i];
  }
  return best;
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export interface RunningGearReport {
  readonly id: string;
  readonly wheels: readonly { readonly side: RgSide; readonly index: number; readonly faces: number; readonly maxSteerDeg: number }[];
  readonly tracks: readonly { readonly side: RgSide; readonly faces: number; readonly loopLength: number; readonly pitch: number }[];
  readonly addedVertices: number;
  readonly taggedMeshes: readonly string[];
  readonly kitPartsFilled: number;
}

export function applyRunningGear(doc: Document, id: string, recipe: RunningGearRecipe): RunningGearReport {
  if (recipe.wheels.length > RG_MAX_WHEELS) {
    throw new Error(`${id}: ${recipe.wheels.length} wheels, the runtime holds ${RG_MAX_WHEELS}`);
  }
  // Discs on one side must not overlap at the cut, unless the recipe says so.
  if (!recipe.overlapOk) {
    for (let i = 0; i < recipe.wheels.length; i++) {
      for (let j = i + 1; j < recipe.wheels.length; j++) {
        const a = recipe.wheels[i];
        const b = recipe.wheels[j];
        if (a.side !== b.side) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * recipe.cut) {
          throw new Error(`${id}: wheels ${i} and ${j} overlap at cut ${recipe.cut}; set overlapOk only where measured`);
        }
      }
    }
  }
  const meshes = hullMeshes(doc, id);
  const classified = classify(id, recipe, meshes);
  classified.wheelFaces.forEach((n, k) => {
    if (n === 0) throw new Error(`${id}: wheel ${k} (${JSON.stringify(recipe.wheels[k])}) has no face inside its disc`);
  });
  if (recipe.track) {
    for (const side of ['r', 'l'] as const) {
      if ((classified.trackFaces.get(side) ?? 0) === 0) throw new Error(`${id}: no track face on side ${side}`);
    }
  }

  // Steering, measured BEFORE the split (the split moves no vertex).
  const indexOnSide = new Map<RgSide, number>();
  const wheels: RgWheel[] = recipe.wheels.map((w, k) => {
    const index = indexOnSide.get(w.side) ?? 0;
    indexOnSide.set(w.side, index + 1);
    const s = sideSign(w.side);
    return {
      side: w.side,
      index,
      centre: [w.x, w.y, (s * (w.zIn + w.zOut)) / 2],
      radius: w.r,
      cutRadius: w.r * recipe.cut,
      steer: w.steer === true,
      maxSteerRad: w.steer === true ? steerClearance(w, k + 1, meshes, classified) : 0,
    };
  });

  let added = 0;
  const taggedMeshes: string[] = [];
  const taggedNames = new Set<string>();
  for (const m of meshes) {
    const tags = classified.perMesh.get(m);
    if (!tags) continue;
    const r = writeMesh(doc, m, tags);
    added += r.added;
    if (r.tagged) {
      taggedMeshes.push(m.node.getName());
      taggedNames.add(m.node.getName());
    }
  }

  // Kit parts hosted on a tagged mesh: zero-filled to match their host.
  let kitPartsFilled = 0;
  for (const node of doc.getRoot().listNodes()) {
    const kit = (node.getExtras() as { rl_kit?: { host?: unknown } }).rl_kit;
    if (!kit || typeof kit.host !== 'string' || !taggedNames.has(kit.host)) continue;
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      zeroFillRunningGear(doc, prim, node.getName());
      kitPartsFilled++;
    }
  }

  const tracks: RgTrack[] = [];
  for (const [side, loop] of classified.loops) {
    const t = recipe.track;
    tracks.push({
      side,
      loopLength: round6(loop.length),
      pitch: round6(pitchFor(loop.length)),
      gauge: round6(t ? (t.zIn + t.zOut) / 2 : 0),
    });
  }
  const extras: RgExtras = {
    version: RG_VERSION,
    wheels: wheels.map((w) => ({
      ...w,
      centre: [round6(w.centre[0]), round6(w.centre[1]), round6(w.centre[2])],
      radius: round6(w.radius),
      cutRadius: round6(w.cutRadius),
      maxSteerRad: round6(w.maxSteerRad),
    })),
    tracks,
  };
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) throw new Error(`${id}: no scene`);
  scene.setExtras({ ...scene.getExtras(), [RG_EXTRAS_KEY]: extras });

  return {
    id,
    wheels: wheels.map((w, k) => ({
      side: w.side,
      index: w.index,
      faces: classified.wheelFaces[k],
      maxSteerDeg: Math.round((w.maxSteerRad * 180) / Math.PI),
    })),
    tracks: tracks.map((t) => ({ ...t, faces: classified.trackFaces.get(t.side) ?? 0 })),
    addedVertices: added,
    taggedMeshes,
    kitPartsFilled,
  };
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

export function parseRunningGearArgs(argv: readonly string[]): readonly string[] | 'all' {
  const ids: string[] = [];
  for (const a of argv) {
    if (a === '--') continue;
    const m = /^--id=(.+)$/.exec(a);
    if (!m) throw new Error(`running-gear:meshes: unknown argument ${a} (use --id=<vehicle>)`);
    if (!RUNNING_GEAR_RECIPES[m[1]]) {
      throw new Error(`running-gear:meshes: no recipe for "${m[1]}" (have ${Object.keys(RUNNING_GEAR_RECIPES).join(', ')})`);
    }
    ids.push(m[1]);
  }
  return ids.length > 0 ? ids : 'all';
}

export async function runRunningGearPass(ids: readonly string[] | 'all', dir: string = VEHICLES): Promise<RunningGearReport[]> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const list = ids === 'all' ? Object.keys(RUNNING_GEAR_RECIPES).sort() : ids;
  const out: RunningGearReport[] = [];
  for (const id of list) {
    const file = path.join(dir, `${id}.glb`);
    const doc = await io.read(file);
    const report = applyRunningGear(doc, id, RUNNING_GEAR_RECIPES[id]);
    await io.write(file, doc);
    out.push(report);
    const w = report.wheels.map((x) => `${x.side}${x.index}:${x.faces}${x.maxSteerDeg ? `/steer ${x.maxSteerDeg} deg` : ''}`).join(' ');
    const t = report.tracks.map((x) => `${x.side}:${x.faces} faces, loop ${x.loopLength.toFixed(2)} m, pitch ${x.pitch.toFixed(4)}`).join('; ');
    console.log(
      `${id}: ${report.taggedMeshes.join('+') || 'nothing'} tagged, +${report.addedVertices} vertices, ` +
        `${report.kitPartsFilled} kit part(s) zero-filled${w ? `\n  wheels ${w}` : ''}${t ? `\n  tracks ${t}` : ''}`
    );
  }
  return out;
}

async function main(): Promise<number> {
  await runRunningGearPass(parseRunningGearArgs(process.argv.slice(2)));
  return 0;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  );
}
