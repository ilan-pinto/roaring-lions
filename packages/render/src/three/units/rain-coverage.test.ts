/**
 * The rain fills the whole frame (GH-940): the lead saw Ein Qasab II's screen corners and its off-map margin
 * DRY, because the lattice window was clipped to the map plus 8 tiles and the shader removed every streak whose
 * landing point lay off the map. At game zoom the corners of the screen are off the map at every focus (a
 * dimetric map is a diamond), so a quarter of the frame never rained.
 *
 * This test drives the PRODUCTION path (a real `RainBatch.update`, its uniforms read back as the capture tool
 * reads them), mirrors the vertex shader's placement of every kept drop on the CPU (`dropLanding`,
 * `dropPosition`, the keep seed), projects the head and the tail of its streak through the REAL dimetric camera
 * and counts, per cell of a grid laid over the whole frame, the drops that cross it. A cell that holds none is
 * a hole in the rain. The oracles are literals: the grid, the floors, the focus and the zooms.
 *
 * What it cannot see: the vertex shader itself. The streak branch having no edge term is pinned as source in
 * `rain-batch.test.ts` ('the STREAK carries no map-edge term'); the pair is what keeps the rain whole.
 *
 * Falsified by hand (GH-940), each against this file and run red before it was put back: `footprintBox`
 * clipped to the map plus 8 tiles; `RAIN_PERIOD_MAX` back at 64; the keep fraction computed over the map.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { updateDimetricCamera } from '../camera';
import { RainBatch } from './rain-batch';
import { dropKeepSeed, dropPosition, dropSeed, rainWindScale } from './rain-maths';

const VIEW = { width: 1400, height: 900 };

/** Where the focus can be, on a 48 x 48 map: the middle, the start of Ein Qasab II (24,45), a map corner. */
const FOCI: ReadonlyArray<readonly [number, number]> = [
  [24, 24],
  [24, 45],
  [44, 4],
];

interface Cover {
  /** Drops crossing each cell of the grid, row-major. */
  readonly cells: number[];
  readonly cols: number;
  readonly rows: number;
  /** Kept drops with their head on screen. */
  readonly onScreen: number;
}

/** The coverage of one frame: `cols x rows` cells over the whole canvas, several sim times accumulated. */
function cover(total: number, focus: readonly [number, number], zoom: number, cols: number, rows: number, times: readonly number[]): Cover {
  const scene = { add: (): void => undefined } as unknown as ConstructorParameters<typeof RainBatch>[0];
  const batch = new RainBatch(scene, { drops: total, mapWidth: 48, mapHeight: 48 });
  const view = { x: focus[0], y: focus[1], zoom, ...VIEW };
  const cam = updateDimetricCamera({ x: view.x, y: view.y, zoom }, VIEW, new THREE.OrthographicCamera());
  const project = (x: number, y: number, z: number): [number, number] => {
    const p = new THREE.Vector3(x, y, z).project(cam);
    return [((p.x + 1) / 2) * VIEW.width, ((1 - p.y) / 2) * VIEW.height];
  };
  const cells = new Array<number>(cols * rows).fill(0);
  let onScreen = 0;
  for (const t of times) {
    batch.update({ simSec: t, view, dpr: 1 });
    const u = batch.mesh.material.uniforms;
    const lo = u.uLow.value as THREE.Vector2;
    const period = u.uPeriod.value as number;
    const keep = u.uKeep.value as number;
    const wind = u.uWind.value as number;
    expect(wind, 'the batch writes the wind from the sim clock').toBeCloseTo(rainWindScale(t), 12);
    for (let i = 0; i < total; i++) {
      if (dropKeepSeed(i) >= keep) continue;
      const seed = dropSeed(i);
      const head = dropPosition(seed, { x: lo.x, z: lo.y }, period, t, 0, wind);
      // The streak runs from the head up its path 0.42 wu: the path is slanted by atan(tan 14 deg x wind) down-wind
      // (tan 14 deg = 0.249328, a literal), so the tail is the head moved back up it.
      const tanS = 0.249328 * wind;
      const sinS = tanS / Math.sqrt(1 + tanS * tanS);
      const cosS = 1 / Math.sqrt(1 + tanS * tanS);
      const tail = { x: head.x - sinS * Math.SQRT1_2 * 0.42, y: head.y + cosS * 0.42, z: head.z + sinS * Math.SQRT1_2 * 0.42 };
      const [hx, hy] = project(head.x, head.y, head.z);
      const [tx, ty] = project(tail.x, tail.y, tail.z);
      const hit = new Set<number>();
      for (const [sx, sy] of [[hx, hy], [tx, ty]] as const) {
        if (sx < 0 || sx >= VIEW.width || sy < 0 || sy >= VIEW.height) continue;
        hit.add(Math.floor((sy / VIEW.height) * rows) * cols + Math.floor((sx / VIEW.width) * cols));
      }
      if (hx >= 0 && hx < VIEW.width && hy >= 0 && hy < VIEW.height) onScreen++;
      for (const c of hit) cells[c]++;
    }
  }
  return { cells, cols, rows, onScreen: onScreen / times.length };
}

const TIMES = [0, 0.37, 0.81, 1.23, 1.66];

describe('every cell of the frame is rained on, at the zoom floor and the zoom ceiling (GH-940)', () => {
  // 7 x 5 cells of 200 x 180 px over the 1400 x 900 canvas: the four corner cells and the edge strips among them.
  for (const zoom of [0.35, 2.5]) {
    for (const [fx, fy] of FOCI) {
      it(`high (6,000 drops), zoom ${zoom}, focus (${fx},${fy}): none of the 35 cells is empty, and the corners hold as much as the middle's worst`, () => {
        const c = cover(6000, [fx, fy], zoom, 7, 5, TIMES);
        // Over 5 times, a cell of an even spread of 1,320 drops holds about 190; 40 is a floor 4.7x below that,
        // far above the 0 an unrained corner reads (the old clip left whole cells at 0).
        const worst = Math.min(...c.cells);
        expect(c.cells, `the cells: ${c.cells.join(' ')}`).toHaveLength(35);
        expect(worst, `the emptiest cell holds ${worst}: ${c.cells.join(' ')}`).toBeGreaterThanOrEqual(40);
        // The four corner cells specifically (top-left, top-right, bottom-left, bottom-right).
        for (const k of [0, 6, 28, 34]) expect(c.cells[k], `corner cell ${k}: ${c.cells.join(' ')}`).toBeGreaterThanOrEqual(40);
      });
    }
  }

  it('low (525 drops) rains on every cell of a coarse 3 x 3 grid, corners included, at both zooms', () => {
    for (const zoom of [0.35, 2.5]) {
      for (const [fx, fy] of FOCI) {
        const c = cover(525, [fx, fy], zoom, 3, 3, [0, 0.37, 0.81, 1.23, 1.66, 2.09, 2.51, 2.94, 3.37]);
        expect(Math.min(...c.cells), `low zoom ${zoom} focus ${fx},${fy}: ${c.cells.join(' ')}`).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('the on-screen count is the same N x 0.22 wherever the camera is: the map is not what limits it', () => {
    for (const zoom of [0.35, 1, 2.5]) {
      const counts = FOCI.map((f) => cover(6000, f, zoom, 1, 1, [0]).onScreen);
      // 1,320 is the aim; 1,120..1,680 is the lead's +-20% band. Every focus is in it, the corner foci included.
      for (const n of counts) {
        expect(n, `zoom ${zoom}: ${counts.join(', ')}`).toBeGreaterThan(1050);
        expect(n).toBeLessThan(1680);
      }
    }
  });

  it('the grid is not vacuous: a drop-free batch leaves every cell at 0', () => {
    const c = cover(0, [24, 45], 1, 7, 5, [0]);
    expect(Math.max(...c.cells)).toBe(0);
  });
});
