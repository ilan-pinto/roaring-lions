/**
 * A4 Task 3 (GH-186): `SelectionRingBatch`, the selection ring drawn on the
 * ground. Built and tested here, wired by Task 5. Every assertion below was
 * turned red by a named mutation before this file landed (see the task
 * report): `depthTest: false`, dropping `mesh.visible = count > 0`, a retyped
 * `0.06` in the GLSL, and a render order of 1.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DECAL_POLYGON_OFFSET_FACTOR, DECAL_POLYGON_OFFSET_UNITS, glslFloat, writeDecalGrid, writeDecalOffsets } from '../decal-pool';
import { MARK_EPSILON } from '../terrain/shared';
import { TILE_H, TILE_W } from '../../project';
import { SELECTION_RING } from './readability';
import { SELECTION_RING_RENDER_ORDER } from './render-order';
import { tileRadiusToEllipsePx } from './overlays';
import {
  createSelectionRingMaterial,
  RING_GRID,
  RING_GRID_LARGE,
  RING_GRID_XL,
  RING_LARGE_TILES,
  RING_SAG_STEPS,
  ringGridFor,
  ringCoreAlpha,
  ringHaloAlpha,
  ringPxPerTile,
  ringSignedDistance,
  ringThicknessTiles,
  SelectionRingBatch,
  type RingPlacement,
} from './selection-ring';

const SHADOW: readonly [number, number, number] = [0.02, 0.03, 0.04];
const TEAM: readonly [number, number, number] = [0.1, 0.6, 0.3];
const VERTS = RING_GRID * RING_GRID;
const EXTRA = SELECTION_RING.haloTiles + SELECTION_RING.featherTiles;

const batch = (capacity = 4): SelectionRingBatch => new SelectionRingBatch({ capacity, resolveShadow: () => SHADOW });
const ring = (over: Partial<RingPlacement> = {}): RingPlacement => ({ x: 10, z: 7, radiusTiles: 0.7, color: TEAM, ...over });
const attr = (b: SelectionRingBatch, name: string): THREE.BufferAttribute =>
  b.mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
/** A sloped, curved field, so a grid written in the wrong place cannot match by accident. */
const hill = (x: number, z: number): number => 0.3 * x - 0.1 * z + 0.05 * x * z;
const LARGE_VERTS = RING_GRID_LARGE * RING_GRID_LARGE;
const XL_VERTS = RING_GRID_XL * RING_GRID_XL;
/** The `k`-th small (or large) ring written this frame, read back from
 *  `name`: its first `verts` vertices (a 6x6 ring by default for 'large'). */
const ringOf = (b: SelectionRingBatch, name: string, k: number, kind: 'small' | 'large' = 'small', verts?: number): number[] => {
  const a = attr(b, name);
  const first = b.firstVertexOf(kind, k);
  const n = verts ?? (kind === 'small' ? VERTS : LARGE_VERTS);
  return Array.from((a.array as Float32Array).subarray(first * a.itemSize, (first + n) * a.itemSize));
};

describe('SelectionRingBatch geometry', () => {
  it('writes an n = 4 grid that is writeDecalGrid\'s own output for the same placement', () => {
    expect(RING_GRID).toBe(4);
    const b = batch();
    b.beginFrame();
    b.push(ring({ x: 3 }), hill);
    b.push(ring({ x: 12, z: 9, radiusTiles: 0.45 }), hill);
    const expected = new Float32Array(2 * VERTS * 3);
    writeDecalGrid(expected, 0, 4, { cx: 3, cz: 7, halfLength: 0.7 + EXTRA, halfWidth: 0.7 + EXTRA, facingRad: 0 }, hill, RING_SAG_STEPS);
    writeDecalGrid(expected, 1, 4, { cx: 12, cz: 9, halfLength: 0.45 + EXTRA, halfWidth: 0.45 + EXTRA, facingRad: 0 }, hill, RING_SAG_STEPS);
    expect(ringOf(b, 'position', 0)).toEqual(Array.from(expected.subarray(0, VERTS * 3)));
    expect(ringOf(b, 'position', 1)).toEqual(Array.from(expected.subarray(VERTS * 3)));
  });

  it('half-extent is radius + halo + feather, so the halo is never clipped by the quad', () => {
    const b = batch();
    b.beginFrame();
    b.push(ring({ x: 0, z: 0, radiusTiles: 0.55 }), () => 0);
    const pos = ringOf(b, 'position', 0);
    let maxX = 0;
    let maxZ = 0;
    for (let v = 0; v < VERTS; v++) {
      maxX = Math.max(maxX, Math.abs(pos[v * 3]));
      maxZ = Math.max(maxZ, Math.abs(pos[v * 3 + 2]));
    }
    const half = 0.55 + SELECTION_RING.haloTiles + SELECTION_RING.featherTiles;
    expect(maxX).toBeCloseTo(half, 6);
    expect(maxZ).toBeCloseTo(half, 6);
    // And the shader's own quad edge is where both the core and the halo
    // have fully faded: nothing the ring draws lies outside the quad.
    const edge = ringSignedDistance(half, 0, 0.55, 0.55);
    expect(ringCoreAlpha(edge, ringThicknessTiles(ringPxPerTile(1)))).toBeCloseTo(0, 9);
    expect(ringHaloAlpha(edge)).toBeCloseTo(0, 9);
  });

  it('repeats the colour on every vertex, and on flat ground every y is sampleY + MARK_EPSILON', () => {
    const b = batch();
    b.beginFrame();
    b.push(ring(), () => 2.5);
    const col = ringOf(b, 'aRingColor', 0);
    const pos = ringOf(b, 'position', 0);
    for (let v = 0; v < VERTS; v++) {
      expect(col.slice(v * 3, v * 3 + 3).map((c) => +c.toFixed(6))).toEqual(TEAM.map((c) => +c.toFixed(6)));
      expect(pos[v * 3 + 1]).toBeCloseTo(2.5 + MARK_EPSILON, 6);
    }
  });

  it('a circle carries a = b = radius on every vertex', () => {
    const b = batch();
    b.beginFrame();
    b.push(ring({ radiusTiles: 0.45 }), () => 0);
    const axes = ringOf(b, 'aAxes', 0);
    for (let v = 0; v < VERTS; v++) {
      expect(axes[v * 2]).toBeCloseTo(0.45, 6);
      expect(axes[v * 2 + 1]).toBeCloseTo(0.45, 6);
    }
  });
});

describe('SelectionRingBatch, the ellipse option (G-MOCK)', () => {
  it('a hull-aligned ellipse is a placement field, not another code path: same grid call, semi-axes + heading', () => {
    const b = batch();
    b.beginFrame();
    const e = ring({ alongTiles: 1.3, acrossTiles: 0.6, headingRad: 0.7 });
    b.push(e, hill);
    // 1.3 > RING_LARGE_TILES: drawn on the large grid.
    const expected = new Float32Array(LARGE_VERTS * 3);
    writeDecalGrid(expected, 0, RING_GRID_LARGE, { cx: 10, cz: 7, halfLength: 1.3 + EXTRA, halfWidth: 0.6 + EXTRA, facingRad: 0.7 }, hill, RING_SAG_STEPS);
    expect(ringOf(b, 'position', 0, 'large')).toEqual(Array.from(expected));
    const axes = ringOf(b, 'aAxes', 0, 'large');
    for (let v = 0; v < LARGE_VERTS; v++) {
      expect(axes[v * 2]).toBeCloseTo(1.3, 6);
      expect(axes[v * 2 + 1]).toBeCloseTo(0.6, 6);
    }
  });

  it('the ellipse is exact on both semi-axes, and a circle is exact everywhere', () => {
    // On-axis the approximation is exact: the outer edge sits at a along
    // and b across.
    expect(ringSignedDistance(1.3, 0, 1.3, 0.6)).toBeCloseTo(0, 9);
    expect(ringSignedDistance(0, 0.6, 1.3, 0.6)).toBeCloseTo(0, 9);
    expect(ringSignedDistance(1.4, 0, 1.3, 0.6)).toBeCloseTo(0.1, 9);
    expect(ringSignedDistance(0, 0.5, 1.3, 0.6)).toBeCloseTo(-0.1, 9);
    // A circle is the a = b case, and its distance is |p| - R exactly.
    for (const [px, pz] of [[0.3, 0.4], [0.7, -0.2], [-0.05, 0.9]]) {
      expect(ringSignedDistance(px, pz, 0.7, 0.7)).toBeCloseTo(Math.hypot(px, pz) - 0.7, 9);
    }
    // The centre is deep inside, not on the edge (0/0 there).
    expect(ringSignedDistance(0, 0, 0.7, 0.7)).toBeCloseTo(-0.7, 9);
    expect(ringSignedDistance(0, 0, 1.3, 0.6)).toBeCloseTo(-0.6, 9);
  });

  it('the ellipse draws the same band as the circle: core on [-w, 0], halo outside only', () => {
    const w = ringThicknessTiles(ringPxPerTile(1));
    for (const [a, b] of [[0.7, 0.7], [1.3, 0.6]]) {
      expect(ringCoreAlpha(ringSignedDistance(a - w / 2, 0, a, b), w)).toBeCloseTo(1, 9);
      expect(ringCoreAlpha(ringSignedDistance(0, b - w / 2, a, b), w)).toBeCloseTo(1, 9);
      expect(ringHaloAlpha(ringSignedDistance(0, b - w / 2, a, b))).toBeCloseTo(0, 9);
      expect(ringCoreAlpha(ringSignedDistance(0, 0, a, b), w)).toBeCloseTo(0, 9);
    }
  });
});

describe('SelectionRingBatch frame lifecycle', () => {
  it('endFrame at count 0 hides the mesh -- +1 draw call only while something is selected', () => {
    const b = batch();
    b.beginFrame();
    b.endFrame(1);
    expect(b.mesh.visible).toBe(false);
    b.beginFrame();
    b.push(ring(), () => 0);
    b.endFrame(1);
    expect(b.mesh.visible).toBe(true);
    expect(b.mesh.geometry.drawRange.count).toBe(1 * 18 * 3);
    b.beginFrame();
    b.endFrame(1);
    expect(b.mesh.visible).toBe(false);
    expect(b.mesh.geometry.drawRange.count).toBeCloseTo(0, 9);
  });

  it('a push past capacity returns false and draws nothing', () => {
    const b = batch(2);
    b.beginFrame();
    expect(b.push(ring({ x: 1 }), () => 0)).toBe(true);
    expect(b.push(ring({ x: 2 }), () => 0)).toBe(true);
    const before = Array.from(attr(b, 'position').array as Float32Array);
    expect(b.push(ring({ x: 3 }), () => 0)).toBe(false);
    expect(Array.from(attr(b, 'position').array as Float32Array)).toEqual(before);
    b.endFrame(1);
    expect(b.mesh.geometry.drawRange.count).toBe(2 * 18 * 3);
    expect(b.count).toBe(2);
  });

  it('uploads only the rings written this frame', () => {
    const b = batch(8);
    b.beginFrame();
    b.push(ring(), () => 0);
    b.push(ring(), () => 0);
    b.endFrame(1);
    const small0 = b.firstVertexOf('small', 0);
    for (const [name, size] of [['position', 3], ['aRingColor', 3], ['aAxes', 2]] as const) {
      const a = attr(b, name);
      expect(a.updateRanges).toEqual([{ start: small0 * size, count: 2 * VERTS * size }]);
      expect(a.version).toBeGreaterThan(0);
    }
    // Another frame replaces the range rather than stacking a second one.
    b.beginFrame();
    b.push(ring(), () => 0);
    b.endFrame(1);
    expect(attr(b, 'position').updateRanges).toEqual([{ start: small0 * 3, count: VERTS * 3 }]);
  });

  it('endFrame sets the pixel-floor uniform from zoom, and re-reads the halo colour', () => {
    let shadow: readonly [number, number, number] = SHADOW;
    const b = new SelectionRingBatch({ capacity: 2, resolveShadow: () => shadow });
    const m = b.mesh.material as THREE.ShaderMaterial;
    expect((m.uniforms.uHaloColor.value as THREE.Vector3).toArray()).toEqual([...SHADOW]);
    b.beginFrame();
    b.push(ring(), () => 0);
    b.endFrame(0.35);
    expect(m.uniforms.uPxPerTile.value).toBeCloseTo(ringPxPerTile(0.35), 9);
    shadow = [0.2, 0.2, 0.2];
    b.endFrame(2);
    expect(m.uniforms.uPxPerTile.value).toBeCloseTo(ringPxPerTile(2), 9);
    expect((m.uniforms.uHaloColor.value as THREE.Vector3).toArray()).toEqual([0.2, 0.2, 0.2]);
  });

  it('push rejects a non-positive or non-finite axis (it would divide by zero into a NaN fragment) and writes nothing', () => {
    const b = batch(2);
    b.beginFrame();
    const before = Array.from(attr(b, 'position').array as Float32Array);
    for (const bad of [
      ring({ radiusTiles: 0 }),
      ring({ radiusTiles: -0.5 }),
      ring({ radiusTiles: Number.NaN }),
      ring({ alongTiles: 0, acrossTiles: 0.5 }),
      ring({ alongTiles: 1.2, acrossTiles: -0.1 }),
      ring({ alongTiles: Number.POSITIVE_INFINITY }),
    ]) {
      expect(b.push(bad, hill), JSON.stringify(bad)).toBe(false);
    }
    expect(b.count).toBe(0);
    expect(Array.from(attr(b, 'position').array as Float32Array)).toEqual(before);
    expect(b.push(ring(), hill)).toBe(true);
  });

  it('capacity defaults to SELECTION_RING.capacity', () => {
    const b = new SelectionRingBatch({ resolveShadow: () => SHADOW });
    b.beginFrame();
    for (let k = 0; k < SELECTION_RING.capacity; k++) expect(b.push(ring(), hill)).toBe(true);
    expect(b.push(ring(), hill)).toBe(false);
    b.dispose();
  });

  it('large and small rings share ONE contiguous draw and upload range, whatever the mix (Task 5)', () => {
    const b = batch(4);
    b.beginFrame();
    b.push(ring({ radiusTiles: 0.45 }), hill); // small
    b.push(ring({ alongTiles: 1.5, acrossTiles: 0.9, headingRad: 1 }), hill); // 7x7: over RING_XL_TILES
    b.push(ring({ radiusTiles: 0.56 }), hill); // small
    b.push(ring({ radiusTiles: 0.9 }), hill); // 6x6: a circle over RING_LARGE_TILES
    b.endFrame(1);
    const smallIdx = 18 * 3;
    const largeSlotIdx = 72 * 3; // a large slot is sized for 7x7
    const dr = b.mesh.geometry.drawRange;
    expect(dr.count).toBe(2 * smallIdx + 2 * largeSlotIdx);
    // The indices in range reference exactly the four rings' vertices, and nothing else.
    const idx = b.mesh.geometry.getIndex();
    const used = new Set<number>();
    for (let k = dr.start; k < dr.start + dr.count; k++) used.add(idx?.getX(k) ?? -1);
    const expected = new Set<number>();
    for (const [kind, k, n] of [['large', 0, XL_VERTS], ['large', 1, LARGE_VERTS], ['small', 0, VERTS], ['small', 1, VERTS]] as const) {
      const first = b.firstVertexOf(kind, k);
      for (let v = 0; v < n; v++) expected.add(first + v);
    }
    expect(used).toEqual(expected);
    // The upload range covers the same vertices, as one run.
    expect(attr(b, 'position').updateRanges).toEqual([
      { start: b.firstVertexOf('large', 1) * 3, count: (2 * XL_VERTS + 2 * VERTS) * 3 },
    ]);
    // And every vertex drawn carries the axes of the ring it belongs to.
    expect(ringOf(b, 'aAxes', 1, 'large').slice(0, 2).map((v) => +v.toFixed(6))).toEqual([0.9, 0.9]);
    expect(ringOf(b, 'aAxes', 1).slice(0, 2).map((v) => +v.toFixed(6))).toEqual([0.56, 0.56]);
  });

  it('a large slot re-lays its offsets and indices when the grid it holds changes (fix round 2)', () => {
    const b = batch(2);
    const idx = (): number[] => {
      const a = b.mesh.geometry.getIndex();
      const out: number[] = [];
      // The first large slot written is the LAST large slot: capacity - 1.
      for (let k = 72 * 3; k < 2 * 72 * 3; k++) out.push(a?.getX(k) ?? -1);
      return out;
    };
    const base = b.firstVertexOf('large', 0);
    const offsetsFor = (n: number): number[] => {
      const o = new Float32Array(n * n * 2);
      writeDecalOffsets(o, 0, n);
      return Array.from(o);
    };
    const off = (n: number): number[] => ringOf(b, 'aOffset', 0, 'large', n * n);
    for (const [r, n] of [[1.2, 6], [1.5, 7], [1.2, 6]] as const) {
      b.beginFrame();
      b.push(ring({ radiusTiles: r }), hill);
      b.endFrame(1);
      const used = (n - 1) * (n - 1) * 6;
      const i = idx();
      expect(new Set(i.slice(0, used)), `n=${n}`).toEqual(new Set(Array.from({ length: n * n }, (_, v) => base + v)));
      expect(i.slice(used).every((v) => v === base), `n=${n} tail`).toBe(true);
      expect(off(n), `n=${n} offsets`).toEqual(offsetsFor(n));
      expect(b.mesh.geometry.getIndex()?.version, `n=${n} upload`).toBeGreaterThan(0);
      // The ring's positions are the n x n grid itself.
      const expected = new Float32Array(n * n * 3);
      writeDecalGrid(expected, 0, n, { cx: 10, cz: 7, halfLength: r + EXTRA, halfWidth: r + EXTRA, facingRad: 0 }, hill, RING_SAG_STEPS);
      expect(ringOf(b, 'position', 0, 'large', n * n), `n=${n} grid`).toEqual(Array.from(expected));
    }
  });

  it('capacity bounds the TOTAL of both kinds', () => {
    const b = batch(3);
    b.beginFrame();
    expect(b.push(ring({ radiusTiles: 1.2 }), hill)).toBe(true);
    expect(b.push(ring({ radiusTiles: 0.4 }), hill)).toBe(true);
    expect(b.push(ring({ radiusTiles: 1.2 }), hill)).toBe(true);
    expect(b.push(ring({ radiusTiles: 0.4 }), hill)).toBe(false);
    expect(b.count).toBe(3);
  });

  it('the grid is chosen by the larger semi-axis: every foot ring small, every vehicle ellipse large', () => {
    expect(RING_GRID_LARGE).toBe(6);
    expect(ringGridFor(0.58, 0.58)).toBe(RING_GRID);
    expect(ringGridFor(RING_LARGE_TILES, RING_LARGE_TILES)).toBe(RING_GRID);
    expect(ringGridFor(0.9, 0.9)).toBe(RING_GRID_LARGE);
    expect(ringGridFor(1.07, 0.65)).toBe(RING_GRID_LARGE);
    expect(ringGridFor(1.4, 1)).toBe(RING_GRID_LARGE);
    expect(ringGridFor(1.61, 1.03)).toBe(RING_GRID_XL);
  });

  it('rejects a capacity that could not hold a ring', () => {
    expect(() => batch(0)).toThrow(/capacity/);
    expect(() => batch(1.5)).toThrow(/capacity/);
  });

  it('dispose releases the geometry and the material it owns', () => {
    const b = batch();
    let geo = 0;
    let mat = 0;
    b.mesh.geometry.addEventListener('dispose', () => geo++);
    (b.mesh.material as THREE.Material).addEventListener('dispose', () => mat++);
    b.dispose();
    expect([geo, mat]).toEqual([1, 1]);
  });
});

describe('SelectionRingBatch position cache (fix round 1)', () => {
  /** `hill`, counting its calls: a rebuild samples the ground, a reuse does not. */
  const counted = () => {
    const c = { n: 0 };
    return { c, Y: (x: number, z: number): number => { c.n++; return hill(x, z); } };
  };
  const frame = (b: SelectionRingBatch, p: RingPlacement, Y: (x: number, z: number) => number, key?: number): void => {
    b.beginFrame();
    b.push(p, Y, key);
    b.endFrame(1);
  };
  const deg = Math.PI / 180;

  it('a unit that has not moved reuses its vertices: no ground sample, same bytes', () => {
    const b = batch();
    const { c, Y } = counted();
    frame(b, ring(), Y, 7);
    expect(c.n).toBeGreaterThan(0);
    const built = ringOf(b, 'position', 0);
    c.n = 0;
    frame(b, ring(), Y, 7);
    expect(c.n).toBe(0);
    expect(ringOf(b, 'position', 0)).toEqual(built);
  });

  it('rebuilds past RING_CACHE.moveTiles of travel from the LAST BUILD, not before', () => {
    const b = batch();
    const { c, Y } = counted();
    frame(b, ring({ x: 10 }), Y, 7);
    const built = ringOf(b, 'position', 0);
    c.n = 0;
    frame(b, ring({ x: 10.04 }), Y, 7);
    expect(c.n).toBe(0);
    expect(ringOf(b, 'position', 0)).toEqual(built);
    frame(b, ring({ x: 10.06 }), Y, 7); // 0.06 from the build, though 0.02 from last frame
    expect(c.n).toBeGreaterThan(0);
    const fresh = new Float32Array(VERTS * 3);
    writeDecalGrid(fresh, 0, 4, { cx: 10.06, cz: 7, halfLength: 0.7 + EXTRA, halfWidth: 0.7 + EXTRA, facingRad: 0 }, hill, RING_SAG_STEPS);
    expect(ringOf(b, 'position', 0)).toEqual(Array.from(fresh));
  });

  it('rebuilds past about 2 degrees of turn, across the 0/360 seam too', () => {
    const b = batch();
    const { c, Y } = counted();
    const e = (h: number): RingPlacement => ring({ alongTiles: 1.3, acrossTiles: 0.6, headingRad: h });
    frame(b, e(0.5 * deg), Y, 3);
    c.n = 0;
    frame(b, e(-0.5 * deg + 2 * Math.PI), Y, 3); // 1 degree away, through the seam
    expect(c.n).toBe(0);
    frame(b, e(1.5 * deg), Y, 3);
    expect(c.n).toBe(0);
    frame(b, e(3 * deg), Y, 3);
    expect(c.n).toBeGreaterThan(0);
  });

  it('rebuilds when the size or shape changes, when another unit takes the slot, and after invalidate()', () => {
    const b = batch();
    const { c, Y } = counted();
    frame(b, ring(), Y, 7);
    c.n = 0;
    frame(b, ring({ radiusTiles: 0.71 }), Y, 7);
    expect(c.n, 'radius').toBeGreaterThan(0);
    c.n = 0;
    frame(b, ring({ radiusTiles: 0.71 }), Y, 8);
    expect(c.n, 'another unit').toBeGreaterThan(0);
    c.n = 0;
    b.invalidate();
    frame(b, ring({ radiusTiles: 0.71 }), Y, 8);
    expect(c.n, 'invalidate').toBeGreaterThan(0);
  });

  it('a push with no key is never cached', () => {
    const b = batch();
    const { c, Y } = counted();
    frame(b, ring(), Y);
    c.n = 0;
    frame(b, ring(), Y);
    expect(c.n).toBeGreaterThan(0);
  });

  it('a reused slot still takes this frame\'s colour', () => {
    const b = batch();
    frame(b, ring(), hill, 7);
    frame(b, ring({ color: [0.9, 0.1, 0.1] }), hill, 7);
    expect(ringOf(b, 'aRingColor', 0).slice(0, 3).map((v) => +v.toFixed(6))).toEqual([0.9, 0.1, 0.1]);
  });
});

describe('the pixel floor', () => {
  it('px per tile is the ring\'s THIN (foreshortened) screen axis at that zoom', () => {
    expect(ringPxPerTile(1)).toBeCloseTo(tileRadiusToEllipsePx(1, TILE_W, TILE_H).upR, 9);
    expect(ringPxPerTile(0.35)).toBeCloseTo(0.35 * ringPxPerTile(1), 9);
  });

  it('the thickness is 0.06 tiles when that is thick enough, and holds 1.5 px at the 0.35 zoom clamp', () => {
    expect(ringThicknessTiles(ringPxPerTile(2.5))).toBe(SELECTION_RING.thicknessTiles);
    expect(ringThicknessTiles(ringPxPerTile(0.35)) * ringPxPerTile(0.35)).toBeCloseTo(SELECTION_RING.minThicknessPx, 9);
  });

  it('the core is solid over [-w, 0] and the halo lies outside the ring only', () => {
    const w = ringThicknessTiles(ringPxPerTile(1));
    expect(ringCoreAlpha(-w, w)).toBeCloseTo(1, 9);
    expect(ringCoreAlpha(-w / 2, w)).toBeCloseTo(1, 9);
    expect(ringCoreAlpha(0, w)).toBeCloseTo(1, 9);
    expect(ringCoreAlpha(-w - SELECTION_RING.featherTiles, w)).toBeCloseTo(0, 9);
    expect(ringCoreAlpha(SELECTION_RING.featherTiles, w)).toBeCloseTo(0, 9);
    for (const s of [-0.3, -w, -w / 2, 0]) expect(ringHaloAlpha(s)).toBeCloseTo(0, 9);
    expect(ringHaloAlpha(SELECTION_RING.featherTiles)).toBeCloseTo(1, 9);
    expect(ringHaloAlpha(SELECTION_RING.haloTiles)).toBeCloseTo(1, 9);
    expect(ringHaloAlpha(SELECTION_RING.haloTiles + SELECTION_RING.featherTiles)).toBeCloseTo(0, 9);
  });
});

describe('createSelectionRingMaterial', () => {
  it('is depth-tested, not depth-writing, transparent, with the decal polygon offset', () => {
    const m = createSelectionRingMaterial(SHADOW);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.transparent).toBe(true);
    expect(m.polygonOffset).toBe(true);
    expect(m.polygonOffsetFactor).toBe(DECAL_POLYGON_OFFSET_FACTOR);
    expect(m.polygonOffsetUnits).toBe(DECAL_POLYGON_OFFSET_UNITS);
  });

  it('outputs premultiplied "over", and is unlit: no light, no fog', () => {
    const m = createSelectionRingMaterial(SHADOW);
    expect(m.blending).toBe(THREE.CustomBlending);
    expect([m.blendSrc, m.blendDst]).toEqual([THREE.OneFactor, THREE.OneMinusSrcAlphaFactor]);
    expect([m.blendSrcAlpha, m.blendDstAlpha]).toEqual([THREE.OneFactor, THREE.OneMinusSrcAlphaFactor]);
    expect(m.lights).toBe(false);
    expect(m.fog).toBe(false);
    const src = m.vertexShader + m.fragmentShader;
    expect(src).not.toMatch(/light|fog/i);
    expect(Object.keys(m.uniforms).sort()).toEqual(['uHaloColor', 'uPxPerTile']);
  });

  it('carries every SELECTION_RING shader constant through glslFloat, and no hex literal', () => {
    const m = createSelectionRingMaterial(SHADOW);
    const src = m.vertexShader + m.fragmentShader;
    for (const k of ['thicknessTiles', 'minThicknessPx', 'featherTiles', 'coreAlpha', 'haloTiles', 'haloAlpha'] as const) {
      expect(m.fragmentShader + m.vertexShader, k).toContain(glslFloat(SELECTION_RING[k]));
    }
    expect(m.fragmentShader).toContain(`max(${glslFloat(SELECTION_RING.thicknessTiles)}, ${glslFloat(SELECTION_RING.minThicknessPx)} / uPxPerTile)`);
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|0x[0-9a-fA-F]+/);
  });
});

describe('the ring mesh', () => {
  it('draws at SELECTION_RING_RENDER_ORDER, casts and receives no shadow, has no normals (AO skips it)', () => {
    const b = batch();
    expect(b.mesh.renderOrder).toBe(SELECTION_RING_RENDER_ORDER);
    expect(b.mesh.castShadow).toBe(false);
    expect(b.mesh.receiveShadow).toBe(false);
    expect(b.mesh.geometry.getAttribute('normal')).toBeUndefined();
    expect(b.mesh.frustumCulled).toBe(false);
  });
});
