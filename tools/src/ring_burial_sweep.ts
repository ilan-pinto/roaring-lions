/**
 * A4 Task 5 (GH-186): a selection ring lies ON the relief, not partly under
 * it -- for every shipped unit type, on the grid the batch actually picks.
 *
 * The drive photographed a Namer's ellipse broken on tel_marum's western
 * shoulder: on the 4x4 grid, the chord between two vertices a tile and a half
 * apart cuts under a three-level slope by more than `writeDecalGrid`'s capped
 * lift can raise it. The fix is grid tiers (`ringGridFor`, thresholds in
 * `readability.ts`), and THIS file is the guard on them, in three parts:
 *
 * - **Every type** (the real guard): each `RADIUS_BY_TYPE` circle and each
 *   `ELLIPSE_BY_TYPE` ellipse, on its own tier, over every steep tile of both
 *   relief maps at sub-tile offsets, buries nothing past `BURIAL_LIMIT`.
 * - **The tier boundaries**: a ring AT each threshold and one step either
 *   side, on the grid it would get, also stays under the limit, so a future
 *   type landing near a boundary cannot bury. These rings are swept at eight
 *   headings as well, since a future ellipse there will turn.
 * - **The Namer tripwires**, which justify the tiers and fail safe.
 *
 * SPLIT ACROSS FILES (CI flake: vitest "Timeout calling onTaskUpdate"). The sweep
 * is synchronous CPU, 55-61 s in one worker on a CI runner. Vitest's worker RPC
 * call timeout is 60 s and a worker that never yields the event loop cannot
 * answer, so a slow runner tipped the single file over it and failed the whole
 * run with every test green. The sweeps live here; the specs are spread over
 * `ring_burial.test.ts`, `ring_burial_large.test.ts` and
 * `ring_burial_xl.test.ts`, one worker each, so no file nears a minute, and
 * `sweep` yields to the event loop every 250 ms so that even a starved runner
 * cannot leave the worker unreachable for the timeout's whole minute. Do not
 * put another multi-second synchronous sweep back into one file.
 *
 * Burial is measured the way the depth test sees it: the drawn height of the
 * ring's two triangles per cell (the index buffer's own a-c diagonal, as
 * `writeDecalGrid`'s chord) against the smooth ground field the ground mesh
 * is built from, sampled on the ring's core band.
 */
import { Sim } from '@lions/sim';
import { applyTerrain, maps, parseMap } from '@lions/data';
import { buildTerrainSurface } from '../../packages/render/src/three/terrain/surface';
import { decalGroundY } from '../../packages/render/src/three/ground-height';
import { SELECTION_RING } from '../../packages/render/src/three/units/readability';
import {
  ringPxPerTile,
  ringThicknessTiles,
  writeRingAttributes,
  type GridScratch,
} from '../../packages/render/src/three/units/selection-ring';

/** The most a ring's core may sit under the ground anywhere, world units. */
export const BURIAL_LIMIT = 0.02;
const EXTRA = SELECTION_RING.haloTiles + SELECTION_RING.featherTiles;
const W = ringThicknessTiles(ringPxPerTile(1));
export const HEADINGS = [0, 1, 2, 3, 4, 5, 6, 7].map((h) => (h / 8) * Math.PI);
/** A unit stands anywhere in its tile, not only at the centre: the tile
 *  centre and four quarter-tile diagonal offsets. */
const OFFSETS: readonly (readonly [number, number])[] = [[0, 0], [-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];

/** A tile is swept when the ground within two tiles of it spans this many
 *  levels: every burial measured on either map (whole-map sweeps, all open
 *  tiles, fix round 3) sat on such ground, and one level of change never
 *  produced the worst case. */
const STEEP_LEVELS = 2;

export interface Relief {
  readonly id: string;
  readonly groundY: (x: number, z: number) => number;
  /** Open tiles within two tiles of a level change: where burial can happen. */
  readonly footSteep: readonly [number, number][];
  /** The same, less the boulder field, which no vehicle can enter. */
  readonly vehicleSteep: readonly [number, number][];
}

function relief(id: 'tel_marum' | 'qarn_hadid'): Relief {
  const pm = parseMap(maps[id]);
  const sim = new Sim({ seed: 1, width: pm.width, height: pm.height, capacity: 4 });
  applyTerrain(pm, sim);
  const surface = buildTerrainSurface({
    width: pm.width,
    height: pm.height,
    decor: pm.decor,
    elevation: pm.elevation,
    blocked: sim.blocked,
    cover: sim.cover,
  });
  const lvl = (x: number, y: number): number =>
    pm.elevation[Math.min(pm.height - 1, Math.max(0, y)) * pm.width + Math.min(pm.width - 1, Math.max(0, x))];
  const footSteep: [number, number][] = [];
  const vehicleSteep: [number, number][] = [];
  for (let y = 0; y < pm.height; y++) {
    for (let x = 0; x < pm.width; x++) {
      const t = y * pm.width + x;
      if (sim.blocked[t] !== 0) continue;
      let lo = 99;
      let hi = -1;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          lo = Math.min(lo, lvl(x + dx, y + dy));
          hi = Math.max(hi, lvl(x + dx, y + dy));
        }
      }
      if (hi - lo < STEEP_LEVELS) continue;
      footSteep.push([x + 0.5, y + 0.5]);
      if (sim.boulder[t] === 0) vehicleSteep.push([x + 0.5, y + 0.5]);
    }
  }
  return { id, groundY: (x, z) => decalGroundY(surface, pm.width, pm.height, x, z), footSteep, vehicleSteep };
}

export const RELIEFS = [relief('tel_marum'), relief('qarn_hadid')];

/** Worst depth (world units) of ground above the drawn ring, over its core band. */
function worstBurial(r: Relief, n: number, cx: number, cz: number, a: number, b: number, heading: number): number {
  const pos = new Float32Array(n * n * 3);
  const grid: GridScratch = { cx: 0, cz: 0, halfLength: 0, halfWidth: 0, facingRad: 0 };
  const colors = new Float32Array(n * n * 3);
  const axes = new Float32Array(n * n * 2);
  writeRingAttributes(pos, colors, axes, 0, { x: cx, z: cz, radiusTiles: a, alongTiles: a, acrossTiles: b, headingRad: heading, color: [1, 1, 1] }, r.groundY, grid, n);
  const hl = a + EXTRA;
  const hw = b + EXTRA;
  const y = (i: number, j: number): number => pos[(j * n + i) * 3 + 1];
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  let worst = 0;
  for (let k = 0; k < 96; k++) {
    const th = (k / 96) * 2 * Math.PI;
    for (const inset of [0, W / 2, W]) {
      const lx = (a - inset) * Math.cos(th);
      const lz = (b - inset) * Math.sin(th);
      const gi = ((lx / hl + 1) * (n - 1)) / 2;
      const gj = ((lz / hw + 1) * (n - 1)) / 2;
      const i = Math.min(n - 2, Math.floor(gi));
      const j = Math.min(n - 2, Math.floor(gj));
      const u = gi - i;
      const v = gj - j;
      const ya = y(i, j);
      const yb = y(i + 1, j);
      const yc = y(i + 1, j + 1);
      const yd = y(i, j + 1);
      const chord = u >= v ? ya + u * (yb - ya) + v * (yc - yb) : ya + v * (yd - ya) + u * (yc - yd);
      worst = Math.max(worst, r.groundY(cx + lx * c - lz * s, cz + lx * s + lz * c) - chord);
    }
  }
  return worst;
}

export const CENTRE: readonly (readonly [number, number])[] = [[0, 0]];

/** Hand the event loop back to the worker's RPC channel. `await`ing a resolved
 *  promise does not do it: microtasks run to exhaustion before any I/O, so a
 *  sweep made of awaits alone still starves the IPC and vitest's 60 s call
 *  timeout ("Timeout calling onTaskUpdate") runs out against a healthy worker. */
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const YIELD_EVERY_MS = 250;

/** The worst burial of one shape on grid `n` over `sites`, every offset and heading given.
 *  Async only so it can yield: it returns the same number the synchronous form did. */
export async function sweep(
  r: Relief,
  sites: readonly [number, number][],
  n: number,
  a: number,
  b: number,
  headings: readonly number[],
  offsets: readonly (readonly [number, number])[] = OFFSETS
): Promise<number> {
  let worst = 0;
  let last = performance.now();
  for (const [x, z] of sites) {
    for (const [dx, dz] of offsets) {
      for (const h of headings) worst = Math.max(worst, worstBurial(r, n, x + dx, z + dz, a, b, h));
    }
    if (performance.now() - last >= YIELD_EVERY_MS) {
      await yieldToLoop();
      last = performance.now();
    }
  }
  return worst;
}
