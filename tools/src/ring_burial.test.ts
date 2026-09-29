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
 * Burial is measured the way the depth test sees it: the drawn height of the
 * ring's two triangles per cell (the index buffer's own a-c diagonal, as
 * `writeDecalGrid`'s chord) against the smooth ground field the ground mesh
 * is built from, sampled on the ring's core band.
 */
import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { applyTerrain, maps, parseMap } from '@lions/data';
import { buildTerrainSurface } from '../../packages/render/src/three/terrain/surface';
import { decalGroundY } from '../../packages/render/src/three/ground-height';
import {
  ELLIPSE_BY_TYPE,
  RADIUS_BY_TYPE,
  RING_LARGE_TILES,
  RING_XL_TILES,
  SELECTION_RING,
} from '../../packages/render/src/three/units/readability';
import {
  RING_GRID,
  RING_GRID_XL,
  ringGridFor,
  ringPxPerTile,
  ringThicknessTiles,
  writeRingAttributes,
  type GridScratch,
} from '../../packages/render/src/three/units/selection-ring';

/** The most a ring's core may sit under the ground anywhere, world units. */
const BURIAL_LIMIT = 0.02;
const EXTRA = SELECTION_RING.haloTiles + SELECTION_RING.featherTiles;
const W = ringThicknessTiles(ringPxPerTile(1));
const HEADINGS = [0, 1, 2, 3, 4, 5, 6, 7].map((h) => (h / 8) * Math.PI);
/** A unit stands anywhere in its tile, not only at the centre: the tile
 *  centre and four quarter-tile diagonal offsets. */
const OFFSETS: readonly (readonly [number, number])[] = [[0, 0], [-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];

/** A tile is swept when the ground within two tiles of it spans this many
 *  levels: every burial measured on either map (whole-map sweeps, all open
 *  tiles, fix round 3) sat on such ground, and one level of change never
 *  produced the worst case. */
const STEEP_LEVELS = 2;

interface Relief {
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

const RELIEFS = [relief('tel_marum'), relief('qarn_hadid')];

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

const CENTRE: readonly (readonly [number, number])[] = [[0, 0]];

/** The worst burial of one shape on grid `n` over `sites`, every offset and heading given. */
function sweep(
  r: Relief,
  sites: readonly [number, number][],
  n: number,
  a: number,
  b: number,
  headings: readonly number[],
  offsets: readonly (readonly [number, number])[] = OFFSETS
): number {
  let worst = 0;
  for (const [x, z] of sites) {
    for (const [dx, dz] of offsets) {
      for (const h of headings) worst = Math.max(worst, worstBurial(r, n, x + dx, z + dz, a, b, h));
    }
  }
  return worst;
}

describe('the sweep is not vacuous', () => {
  it('both relief maps carry hundreds of steep tiles, for foot and vehicle alike', () => {
    for (const r of RELIEFS) {
      expect(r.footSteep.length, r.id).toBeGreaterThan(300);
      expect(r.vehicleSteep.length, r.id).toBeGreaterThan(300);
    }
  });
});

describe('every shipped ring, on the grid ringGridFor picks, stays on the relief (GH-186)', () => {
  // Circles are drawn at heading 0 (`pushSelectionRing` passes none), so one
  // heading is the real case; ellipses turn with the hull, so all eight.
  const circles = [...new Set(Object.entries(RADIUS_BY_TYPE).filter(([id]) => !ELLIPSE_BY_TYPE[id]).map(([, r]) => r))];

  it.each(circles)('the circle at %s tiles', (radius) => {
    for (const r of RELIEFS) {
      expect(sweep(r, r.footSteep, ringGridFor(radius, radius), radius, radius, [0]), r.id).toBeLessThanOrEqual(BURIAL_LIMIT);
    }
  });

  // Ellipses at tile centres only, to keep this file affordable (eight
  // headings times five offsets was 4 s a type). Measured with the five
  // offsets over EVERY open tile of both maps in fix round 3, every shipped
  // ellipse on its tier buried 0.0000 wu -- nothing near the limit for an
  // offset to find. The boundary sweep below keeps the offsets.
  it.each(Object.entries(ELLIPSE_BY_TYPE))('the %s ellipse', (_id, e) => {
    for (const r of RELIEFS) {
      expect(sweep(r, r.vehicleSteep, ringGridFor(e.along, e.across), e.along, e.across, HEADINGS, CENTRE), r.id).toBeLessThanOrEqual(BURIAL_LIMIT);
    }
  }, 30_000);
});

describe('the tier boundaries (fix round 3): a ring near a threshold cannot bury', () => {
  // At, just under and just over each threshold, on whatever grid it gets.
  // Swept at every heading: a future ellipse near a boundary will turn.
  const STEP = 0.01;
  const cases = [RING_LARGE_TILES, RING_XL_TILES].flatMap((t) => [t - STEP, t, t + STEP]);

  it.each(cases)('a ring of %s tiles', (radius) => {
    for (const r of RELIEFS) {
      expect(sweep(r, r.footSteep, ringGridFor(radius, radius), radius, radius, HEADINGS), r.id).toBeLessThanOrEqual(BURIAL_LIMIT);
    }
  }, 60_000);
});

describe('Namer tier-justification tripwires (fail safe; the per-type sweep above is the real guard)', () => {
  // These only prove the tiers are NEEDED: if the ground or the lift changed
  // so the Namer no longer buried on the smaller grids, they would go red and
  // say the tiers can be revisited. They never excuse a bury.
  const tm = RELIEFS[0];
  const { along, across } = ELLIPSE_BY_TYPE.ifv_namer;

  it('on the 4x4 grid the Namer ellipse is buried by over 0.1 wu on tel_marum', () => {
    expect(sweep(tm, tm.vehicleSteep, RING_GRID, along, across, HEADINGS, CENTRE)).toBeGreaterThan(0.1);
  }, 30_000);

  it('on the 6x6 grid the grown Namer (1.61 x 1.03) is buried past the limit on tel_marum', () => {
    expect(sweep(tm, tm.vehicleSteep, 6, along, across, HEADINGS, CENTRE)).toBeGreaterThan(BURIAL_LIMIT);
  }, 30_000);

  it('the Namer is on the 7x7 tier', () => {
    expect(ringGridFor(along, across)).toBe(RING_GRID_XL);
  });
});
