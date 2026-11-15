// GH-1360 S3a: the starting layout (design 2026-11-15-unit-spacing-design.md, section 3.2). A pure function over
// `assignTemplate`: it takes a starting force at its authored positions and returns where each body stands and which
// way it faces, in the same order, on the same ids. It spawns nothing, writes no sim state, never registers a
// formation and draws no random number, so ids, spawn order and every per-entity RNG stream are untouched. Nothing
// calls it yet (S3b wires `start()`).
//
// The compiled template is an ARGUMENT: the sim imports nothing, so the layout file (`data/layouts/assembly.json`,
// loaded by `@lions/data`) is compiled by the caller with `compileFormation`.
//
// Q16.16 only. Tiles are integers; a position is the tile centre. No `Math.*`, no `Date.*`.
import { fx, HALF, type Fx } from './fixed';
import { assignTemplate, eighthToward, templateOffsets, type CompiledFormation, type TemplateUnit } from './formation-template';

export type StartFront = 'N' | 'E' | 'S' | 'W';

/** The domain numbers `assignTemplate` indexes `masks` by. An aircraft takes the foot one. */
const DOMAIN_FOOT = 0;
const DOMAIN_VEHICLE = 1;

/** Authored bodies within this many tiles of each other (single link) form one assembly. */
const ASSEMBLY_LINK_TILES = 6;
/** The rear row stands at least this many tiles inside the map edge. */
const EDGE_MARGIN = 1;
/** How far `freeSpot` is asked to look for an overflowing member (the spec's start reach is 12 tiles). */
export const START_FREE_SPOT_REACH = 12;

export interface StartBody extends TemplateUnit {
  /** The authored position, Q16.16 tiles. */
  x: Fx;
  y: Fx;
}

export interface StartPlacement {
  id: number;
  /** Q16.16 tiles. */
  x: Fx;
  y: Fx;
  /** An eighth-turn in sim angle units: the front axis. Never `FM_FACING_NONE`. */
  face: number;
  /** `slot`: a template slot. `free`: the free spot from the anchor. `authored`: nothing was found, so the authored position stands. */
  how: 'slot' | 'free' | 'authored';
}

export interface StartLayoutInput {
  width: number;
  height: number;
  /** Passability per domain, 0 = open: `[foot, vehicle]`. */
  masks: readonly [Uint8Array, Uint8Array];
  cover: Uint8Array;
  front: StartFront;
  /** The force in spawn order. The result is index-aligned with it. */
  bodies: readonly StartBody[];
  /**
   * The free spot (`Sim.freeSpotNear`) for a body the template had no slot for, and for a lone body's authored
   * position. `others` is every body already laid out by this call, because the caller's sim does not hold them yet.
   * Return null for "no spot": the body keeps its authored position. Absent: nothing is de-overlapped.
   */
  freeSpot?: (id: number, x: Fx, y: Fx, others: readonly StartPlacement[]) => readonly [Fx, Fx] | null;
}

/** The front a force at (fromX, fromY) faces to look at (toX, toY): `assignTemplate`'s own quantisation (an axis, ties to x). */
export function frontToward(fromX: number, fromY: number, toX: number, toY: number): StartFront {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  if (ax >= ay) return dx < 0 ? 'W' : 'E';
  return dy < 0 ? 'N' : 'S';
}

function frontVector(front: StartFront): [number, number] {
  if (front === 'N') return [0, -1];
  if (front === 'S') return [0, 1];
  if (front === 'W') return [-1, 0];
  return [1, 0];
}

/** `Sim.snapOpenTile`'s search: the nearest open tile by Chebyshev ring, row-major within a ring. */
function snapOpen(mask: Uint8Array, w: number, h: number, gx: number, gy: number): [number, number] {
  if (gx < 0 || gy < 0 || gx >= w || gy >= h || mask[gy * w + gx] === 0) return [gx, gy];
  const maxR = w > h ? w : h;
  for (let r = 1; r <= maxR; r++) {
    const x0 = gx - r < 0 ? 0 : gx - r;
    const x1 = gx + r >= w ? w - 1 : gx + r;
    const y0 = gy - r < 0 ? 0 : gy - r;
    const y1 = gy + r >= h ? h - 1 : gy + r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ddx = x - gx < 0 ? gx - x : x - gx;
        const ddy = y - gy < 0 ? gy - y : y - gy;
        if ((ddx > ddy ? ddx : ddy) !== r) continue;
        if (mask[y * w + x] === 0) return [x, y];
      }
    }
  }
  return [gx, gy];
}

/** Single-link groups of bodies within `ASSEMBLY_LINK_TILES`; each group's indices ascend, and groups are ordered by first index. */
function assemblies(bodies: readonly StartBody[]): number[][] {
  const n = bodies.length;
  const parent: number[] = [];
  for (let i = 0; i < n; i++) parent.push(i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    return r;
  };
  const link = fx.fromInt(ASSEMBLY_LINK_TILES);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = fx.sub(bodies[i].x, bodies[j].x);
      const dy = fx.sub(bodies[i].y, bodies[j].y);
      if (dx > link || dx < -link || dy > link || dy < -link) continue;
      if (fx.add(fx.mul(dx, dx), fx.mul(dy, dy)) > fx.mul(link, link)) continue;
      const a = find(i);
      const b = find(j);
      if (a !== b) {
        if (a < b) parent[b] = a;
        else parent[a] = b;
      }
    }
  }
  const byRoot = new Map<number, number[]>();
  const order: number[][] = [];
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let g = byRoot.get(r);
    if (g === undefined) {
      g = [];
      byRoot.set(r, g);
      order.push(g);
    }
    g.push(i);
  }
  return order;
}

const centreOf = (t: number): Fx => fx.add(fx.fromInt(t), HALF);

/**
 * Lay a starting force out in `tpl`'s shape, facing `front`.
 *
 * Per assembly of two or more bodies: the anchor is the authored centroid, summed in Fx and floored ONCE (a floored
 * sum of floored tiles is chiral, the P1c lesson), then moved forward by half the layout's depth so the shape is centred
 * on where the author put the force, then slid inward until the rear row is `EDGE_MARGIN` inside the map. The anchor snaps
 * to open ground per domain, as a click does. A body the template has no slot for takes `freeSpot` from the anchor outward,
 * and only if that finds nothing keeps its authored position. A one-body assembly keeps its authored position (de-overlapped by
 * `freeSpot`) and only turns to the front.
 */
export function startLayout(input: StartLayoutInput, tpl: CompiledFormation): StartPlacement[] {
  const { width: w, height: h, bodies } = input;
  const [fwdX, fwdY] = frontVector(input.front);
  const faceFront = eighthToward(fwdX, fwdY);
  const result: (StartPlacement | null)[] = bodies.map(() => null);
  const laidOut = (): StartPlacement[] => {
    const out: StartPlacement[] = [];
    for (const p of result) if (p !== null) out.push(p);
    return out;
  };
  const reserved = new Uint8Array(w * h);
  // `Sim.freeSpotNear` echoes the requested point when it finds nothing. An echo is "no spot", whatever the wrapper does.
  const askSpot = (id: number, x: Fx, y: Fx): readonly [Fx, Fx] | null => {
    if (input.freeSpot === undefined) return null;
    const spot = input.freeSpot(id, x, y, laidOut());
    return spot === null || (spot[0] === x && spot[1] === y) ? null : spot;
  };
  // A tile is open to the anchor only if it is open to foot and to wheels.
  const both = new Uint8Array(w * h);
  for (let t = 0; t < both.length; t++) both[t] = input.masks[DOMAIN_FOOT][t] | input.masks[DOMAIN_VEHICLE][t];
  const lone: number[] = [];

  for (const group of assemblies(bodies)) {
    if (group.length < 2) {
      lone.push(group[0]);
      continue;
    }
    const n = group.length;
    const units: TemplateUnit[] = group.map((i) => ({
      id: bodies[i].id,
      domain: bodies[i].vehicle ? DOMAIN_VEHICLE : DOMAIN_FOOT,
      cls: bodies[i].cls,
      vehicle: bodies[i].vehicle,
      air: bodies[i].air,
    }));
    // The depth: the front rank is forward 0 and every later rank is behind it.
    let depth = 0;
    for (const o of templateOffsets(tpl, units.map((u) => u.cls))) if (-o.forward > depth) depth = -o.forward;

    // The anchor: Fx sum, one floor.
    let sumX = 0;
    let sumY = 0;
    for (const i of group) {
      sumX += bodies[i].x;
      sumY += bodies[i].y;
    }
    let ax = fx.toInt((sumX - (sumX % n)) / n);
    let ay = fx.toInt((sumY - (sumY % n)) / n);
    // Centre the shape on the force: the click is the front rank.
    const half = (depth - (depth % 2)) / 2;
    ax += fwdX * half;
    ay += fwdY * half;
    ax = ax < 0 ? 0 : ax >= w ? w - 1 : ax;
    ay = ay < 0 ? 0 : ay >= h ? h - 1 : ay;
    // The edge pull-back: the rear row (depth behind the click) stays EDGE_MARGIN inside. Run again after the snap,
    // which can move the click back toward the edge.
    const pull = (): void => {
      if (fwdX > 0 && ax - depth < EDGE_MARGIN) ax = EDGE_MARGIN + depth;
      else if (fwdX < 0 && ax + depth > w - 1 - EDGE_MARGIN) ax = w - 1 - EDGE_MARGIN - depth;
      if (fwdY > 0 && ay - depth < EDGE_MARGIN) ay = EDGE_MARGIN + depth;
      else if (fwdY < 0 && ay + depth > h - 1 - EDGE_MARGIN) ay = h - 1 - EDGE_MARGIN - depth;
    };
    pull();

    // One anchor, open to BOTH domains. Two separate snaps would put a vehicle-only element on `assignTemplate`'s second
    // track, whose rank depth restarts at the click, and the infantry would stand level with, or ahead of, the vehicles.
    [ax, ay] = snapOpen(both, w, h, ax, ay);
    pull();
    const fox = ax;
    const foy = ay;
    const [vox, voy] = [fox, foy];
    const res = assignTemplate(
      {
        width: w,
        height: h,
        masks: input.masks,
        origins: [
          [fox, foy],
          [vox, voy],
        ],
        clickX: fox,
        clickY: foy,
        fromX: fox - fwdX,
        fromY: foy - fwdY,
        units,
        reserved,
        cover: input.cover,
      },
      tpl,
    );
    const slotOf = new Map<number, { x: number; y: number; face: number }>();
    for (const s of res.slots) slotOf.set(s.id, s);
    const over = new Set<number>(res.overflow);
    const idx = new Map<number, number>();
    for (const i of group) idx.set(bodies[i].id, i);
    // Slots first, so an overflowing body sees them.
    for (const i of group) {
      const b = bodies[i];
      const s = slotOf.get(b.id);
      if (s === undefined || over.has(b.id)) continue;
      reserved[s.y * w + s.x] = 1;
      result[i] = { id: b.id, x: centreOf(s.x), y: centreOf(s.y), face: s.face === 0xffff ? faceFront : s.face, how: 'slot' };
    }
    for (const i of group) {
      if (result[i] !== null) continue;
      const b = bodies[i];
      const [ox, oy] = b.vehicle ? [vox, voy] : [fox, foy];
      const spot = askSpot(b.id, centreOf(ox), centreOf(oy));
      if (spot !== null) {
        reserved[fx.toInt(spot[1]) * w + fx.toInt(spot[0])] = 1;
        result[i] = { id: b.id, x: spot[0], y: spot[1], face: faceFront, how: 'free' };
      } else {
        // The authored tile is taken: a later assembly must not seat a body on it.
        const ax0 = fx.toInt(b.x);
        const ay0 = fx.toInt(b.y);
        if (ax0 >= 0 && ay0 >= 0 && ax0 < w && ay0 < h) reserved[ay0 * w + ax0] = 1;
        result[i] = { id: b.id, x: b.x, y: b.y, face: faceFront, how: 'authored' };
      }
    }
  }

  // A lone body keeps where the author put it, de-overlapped, and turns to the front.
  for (const i of lone) {
    const b = bodies[i];
    const spot = askSpot(b.id, b.x, b.y);
    result[i] =
      spot === null
        ? { id: b.id, x: b.x, y: b.y, face: faceFront, how: 'authored' }
        : { id: b.id, x: spot[0], y: spot[1], face: faceFront, how: 'free' };
  }
  return result as StartPlacement[];
}
