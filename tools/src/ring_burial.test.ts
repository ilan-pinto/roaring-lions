/**
 * A4 Task 5 (GH-186): a vehicle's selection ellipse lies ON tel_marum's
 * steepest shoulder, not partly under it.
 *
 * The drive photographed a Namer's ellipse broken on the western shoulder:
 * on the 4x4 grid, the chord between two vertices a tile and a half apart
 * cuts under a three-level slope by more than `writeDecalGrid`'s capped lift
 * can raise it. `RING_GRID_LARGE` is the fix; this pins it on the real map
 * and relief, paired with the 4x4 control that shows the defect is there to
 * be caught.
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
import { ELLIPSE_BY_TYPE, SELECTION_RING } from '../../packages/render/src/three/units/readability';
import {
  RING_GRID,
  RING_GRID_XL,
  ringGridFor,
  ringPxPerTile,
  ringThicknessTiles,
  writeRingAttributes,
  type GridScratch,
} from '../../packages/render/src/three/units/selection-ring';

const pm = parseMap(maps.tel_marum);
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
const groundY = (x: number, z: number): number => decalGroundY(surface, pm.width, pm.height, x, z);
const EXTRA = SELECTION_RING.haloTiles + SELECTION_RING.featherTiles;
const W = ringThicknessTiles(ringPxPerTile(1));

/** Worst depth (world units) of ground above the drawn ring, over its core band. */
function worstBurial(n: number, cx: number, cz: number, a: number, b: number, heading: number): number {
  const pos = new Float32Array(n * n * 3);
  const grid: GridScratch = { cx: 0, cz: 0, halfLength: 0, halfWidth: 0, facingRad: 0 };
  const colors = new Float32Array(n * n * 3);
  const axes = new Float32Array(n * n * 2);
  writeRingAttributes(pos, colors, axes, 0, { x: cx, z: cz, radiusTiles: a, alongTiles: a, acrossTiles: b, headingRad: heading, color: [1, 1, 1] }, groundY, grid, n);
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
      worst = Math.max(worst, groundY(cx + lx * c - lz * s, cz + lx * s + lz * c) - chord);
    }
  }
  return worst;
}

/** Every tile a VEHICLE can stand on across both shoulders of the pass. */
function shoulderSites(): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 14; y <= 20; y++) {
    for (let x = 17; x <= 31; x++) {
      const t = y * pm.width + x;
      if (sim.blocked[t] === 0 && sim.boulder[t] === 0) out.push([x + 0.5, y + 0.5]);
    }
  }
  return out;
}

describe("a vehicle ellipse on tel_marum's shoulder (GH-186)", () => {
  const { along, across } = ELLIPSE_BY_TYPE.ifv_namer;
  const sites = shoulderSites();

  it('the site sweep is not vacuous: the shoulders carry relief and dozens of vehicle tiles', () => {
    expect(sites.length).toBeGreaterThan(40);
  });

  it('control: on the 4x4 grid the Namer ellipse is buried by over 0.1 wu somewhere on the shoulder', () => {
    let worst = 0;
    for (const [x, z] of sites) for (let h = 0; h < 8; h++) worst = Math.max(worst, worstBurial(RING_GRID, x, z, along, across, (h / 8) * Math.PI));
    expect(worst).toBeGreaterThan(0.1);
  });

  it('control: on the 6x6 grid the grown Namer (fix round 1, 1.61 x 1.03) is buried past 0.02 wu', () => {
    let worst = 0;
    for (const [x, z] of sites) for (let h = 0; h < 8; h++) worst = Math.max(worst, worstBurial(6, x, z, along, across, (h / 8) * Math.PI));
    expect(worst).toBeGreaterThan(0.02);
  });

  it('the Namer is on the 7x7 tier', () => {
    expect(ringGridFor(along, across)).toBe(RING_GRID_XL);
  });

  it('on the grid the batch actually picks, no placement is buried by more than 0.02 wu', () => {
    const n = ringGridFor(along, across);
    let worst = 0;
    for (const [x, z] of sites) for (let h = 0; h < 8; h++) worst = Math.max(worst, worstBurial(n, x, z, along, across, (h / 8) * Math.PI));
    expect(worst).toBeLessThan(0.02);
  });
});
