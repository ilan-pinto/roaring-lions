/**
 * #470: the objective zone's hatched ground band. Each spec below was seen
 * red under a one-line mutation of `zone-band.ts` before it was trusted;
 * the commit message names them.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ZoneBandBatch,
  createZoneBandMaterial,
  zoneBandCells,
  ZONE_BAND_LIFT,
} from './zone-band';
import { DECAL_FADING_RENDER_ORDER, ZONE_BAND_RENDER_ORDER } from './render-order';

const area = (cells: readonly (readonly number[])[]): number =>
  cells.reduce((sum, [x0, y0, x1, y1]) => sum + (x1 - x0) * (y1 - y0), 0);

/** Distance from a cell to the rectangle's nearest edge, from inside. */
function edgeDistance(cell: readonly number[], rect: readonly number[]): number {
  const [x0, y0, x1, y1] = cell;
  const [zx, zy, zw, zh] = rect;
  return Math.min(x0 - zx, zx + zw - x1, y0 - zy, zy + zh - y1);
}

describe('zoneBandCells', () => {
  const town = [18, 8, 24, 32];

  it('covers exactly the ring 0.5 tile inside the edge -- the area of the zone less its interior', () => {
    const cells = zoneBandCells(town);
    // Literal: 24*32 - 23*31.
    expect(area(cells)).toBeCloseTo(768 - 713, 6);
  });

  it('never reaches the interior: every cell starts within 0.5 tile of an edge', () => {
    const cells = zoneBandCells(town);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) expect(edgeDistance(c, town)).toBeLessThan(0.5);
  });

  it('stays inside the zone', () => {
    for (const [x0, y0, x1, y1] of zoneBandCells(town)) {
      expect(x0).toBeGreaterThanOrEqual(18);
      expect(y0).toBeGreaterThanOrEqual(8);
      expect(x1).toBeLessThanOrEqual(42);
      expect(y1).toBeLessThanOrEqual(40);
    }
  });

  it('leaves the zone centre clear', () => {
    const [cx, cy] = [30, 24];
    const hit = zoneBandCells(town).some(([x0, y0, x1, y1]) => cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1);
    expect(hit).toBe(false);
  });

  it('fills a zone no wider than two bands all the way across', () => {
    expect(area(zoneBandCells([30, 23, 1, 3]))).toBeCloseTo(3, 6);
  });

  it('covers the whole ring of a zone whose size is not a multiple of the cell, at most one cell deeper', () => {
    // 2.1 x 3.3: the ring alone is 6.93 - 1.1 * 2.3. Cells are clipped to the
    // zone's outer edge but not to the band's inner one.
    const rect = [0, 0, 2.1, 3.3];
    const cells = zoneBandCells(rect);
    expect(area(cells)).toBeGreaterThanOrEqual(6.93 - 1.1 * 2.3 - 1e-9);
    for (const c of cells) expect(edgeDistance(c, rect)).toBeLessThan(0.5);
  });
});

describe('createZoneBandMaterial', () => {
  it('is depth-tested, so a roof, a wall or a hull in front of the band hides it', () => {
    const m = createZoneBandMaterial();
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(false);
  });

  it('multiplies onto the lit ground (DstColor * SrcColor) rather than adding an unlit colour', () => {
    const m = createZoneBandMaterial();
    expect(m.blending).toBe(THREE.CustomBlending);
    expect(m.blendSrc).toBe(THREE.DstColorFactor);
    expect(m.blendDst).toBe(THREE.ZeroFactor);
    expect(m.transparent).toBe(true);
  });
});

describe('ZoneBandBatch', () => {
  const flat = (): number => 0;

  it('draws in the fading-decal ground band', () => {
    const b = new ZoneBandBatch();
    expect(b.mesh.renderOrder).toBe(ZONE_BAND_RENDER_ORDER);
    expect(ZONE_BAND_RENDER_ORDER).toBe(DECAL_FADING_RENDER_ORDER);
  });

  it('hides itself when no zone is pushed, so an empty frame costs no draw call', () => {
    const b = new ZoneBandBatch();
    b.beginFrame();
    b.pushZone([0, 0, 4, 4], '#FF0000', flat);
    b.endFrame();
    expect(b.mesh.visible).toBe(true);
    b.beginFrame();
    b.endFrame();
    expect(b.mesh.visible).toBe(false);
    expect(b.mesh.geometry.drawRange.count).toBe(0);
  });

  it('puts every zone into its one mesh: six vertices a cell', () => {
    const b = new ZoneBandBatch();
    b.beginFrame();
    b.pushZone([0, 0, 4, 4], '#FF0000', flat);
    b.pushZone([10, 10, 3, 3], '#00FF00', flat);
    b.endFrame();
    const cells = zoneBandCells([0, 0, 4, 4]).length + zoneBandCells([10, 10, 3, 3]).length;
    expect(b.mesh.geometry.drawRange.count).toBe(6 * cells);
  });

  it('lies on the ground it is given, lifted by ZONE_BAND_LIFT', () => {
    const b = new ZoneBandBatch();
    b.beginFrame();
    b.pushZone([0, 0, 2, 2], '#FF0000', (x, y) => x + 10 * y);
    b.endFrame();
    const pos = b.mesh.geometry.getAttribute('position').array as Float32Array;
    for (let v = 0; v < b.mesh.geometry.drawRange.count; v++) {
      const x = pos[v * 3];
      const z = pos[v * 3 + 2];
      expect(pos[v * 3 + 1]).toBeCloseTo(x + 10 * z + ZONE_BAND_LIFT, 4);
    }
  });

  it('wears the colour it is handed, in linear', () => {
    const b = new ZoneBandBatch();
    b.beginFrame();
    b.pushZone([0, 0, 2, 2], '#FF0000', flat);
    b.endFrame();
    const col = b.mesh.geometry.getAttribute('aColor').array as Float32Array;
    expect([col[0], col[1], col[2]]).toEqual([1, 0, 0]);
  });
});
