/**
 * Pure geometry/bookkeeping and GPU-facing construction for the shared
 * decal pool's core (Task 10 -- ring buffer, conforming grid, sim-time
 * clock). Task 11's kind shader (`decalAlpha`, `createDecalMaterial`,
 * `DecalPalette`) is a separate task and is not exercised here.
 *
 * F-20: the plan's own draft carried
 * `presentationSimMs(200, 1) === presentationSimMs(200, 1)` as its "does
 * not move without a tick" test -- a tautology, since calling any pure
 * function twice with the same arguments and comparing the results proves
 * nothing about the function. Replaced below with a value pinned against
 * an independent hand computation: `(200 - 1 + 1) * 50 = 10000`. The real
 * guard for "presentation never advances without a tick" is Task 12's own
 * "ages on sim clock only" test, which drives the pool through a captured
 * frame with no intervening `step()`.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  craterRadiusTiles,
  DecalPool,
  FADING_CAPACITY,
  FADING_GRID,
  gridTriangles,
  PERSISTENT_CAPACITY,
  PERSISTENT_GRID,
  presentationSimMs,
  rubbleRadiusTiles,
  stampSimMs,
  TRACK_STAMP_HALF_LENGTH,
  writeDecalGrid,
  writeDecalOffsets,
  writeGridIndices,
  type DecalStamp,
} from './decal-pool';
import { isAoOccluder } from './post-chain';
import { MARK_EPSILON } from './terrain/shared';
import { DECAL_FADING_RENDER_ORDER, DECAL_PERSISTENT_RENDER_ORDER } from './units/render-order';

const flat = (): number => 0;
const never = (): boolean => false;
const stamp = (over: Partial<DecalStamp> = {}): DecalStamp => ({
  kind: 'crater',
  x: 5,
  z: 5,
  halfLength: 0.5,
  halfWidth: 0.5,
  facingRad: 0,
  seed: 0.3,
  simMs: 0,
  ...over,
});

describe('the sim-time clock (R-14)', () => {
  it('presents (tick - 1 + alpha) x 50 ms, never negative', () => {
    expect(presentationSimMs(10, 1)).toBe(500);
    expect(presentationSimMs(10, 0.5)).toBe(475);
    expect(presentationSimMs(0, 0)).toBe(0);
  });
  it('dates a snapshot stamp at the tick it will be presented at alpha 1', () => {
    expect(stampSimMs(10)).toBe(presentationSimMs(10, 1));
  });
  // F-20: pinned against an independent hand computation, not a tautology
  // -- see this file's top comment.
  it('does not move without a tick: the gate\'s repaint is frame(1, 0), the same clock to the bit', () => {
    expect(presentationSimMs(200, 1)).toBe(10000); // (200 - 1 + 1) * 50
    expect(presentationSimMs(200, 1)).toBe(presentationSimMs(200, 1));
  });
});

describe('the conforming grid', () => {
  it('is 18 triangles at 4x4 and 2 at 2x2, which is what keeps the pools under 27k (R-10)', () => {
    expect(gridTriangles(PERSISTENT_GRID)).toBe(18);
    expect(gridTriangles(FADING_GRID)).toBe(2);
    expect(PERSISTENT_CAPACITY * 18 + FADING_CAPACITY * 2).toBe(26624);
  });
  it('winds every triangle up at facing 0', () => {
    for (const n of [PERSISTENT_GRID, FADING_GRID]) {
      const pos = new Float32Array(n * n * 3);
      writeDecalGrid(pos, 0, n, { cx: 0, cz: 0, halfLength: 1, halfWidth: 1, facingRad: 0 }, flat, never);
      const idx = new Uint32Array(gridTriangles(n) * 3);
      writeGridIndices(idx, 0, n);
      for (let t = 0; t < idx.length / 3; t++) {
        const v = (k: number): THREE.Vector3 => new THREE.Vector3().fromArray(pos, idx[t * 3 + k] * 3);
        const nrm = new THREE.Vector3().subVectors(v(1), v(0)).cross(new THREE.Vector3().subVectors(v(2), v(0)));
        expect(nrm.y, `n=${n} t=${t}`).toBeGreaterThan(0);
      }
    }
  });
  it('offsets the indices by the slot', () => {
    const idx = new Uint32Array(gridTriangles(4) * 3);
    writeGridIndices(idx, 3, 4);
    expect(Math.min(...idx)).toBe(3 * 16);
    expect(Math.max(...idx)).toBe(3 * 16 + 15);
  });
  it('conforms to the ground under every vertex, lifted by MARK_EPSILON', () => {
    const pos = new Float32Array(16 * 3);
    const slope = (x: number): number => 0.1 * x;
    writeDecalGrid(pos, 0, 4, { cx: 5, cz: 5, halfLength: 1, halfWidth: 1, facingRad: 0 }, slope, never);
    for (let v = 0; v < 16; v++) expect(pos[v * 3 + 1]).toBeCloseTo(0.1 * pos[v * 3] + MARK_EPSILON, 6);
  });
  it('turns with its facing', () => {
    const pos = new Float32Array(4 * 3);
    writeDecalGrid(pos, 0, 2, { cx: 0, cz: 0, halfLength: 1, halfWidth: 0.1, facingRad: Math.PI / 2 }, flat, never);
    const zs = [0, 1, 2, 3].map((v) => pos[v * 3 + 2]);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2, 6);
  });
  // R-19: a vertex over a terrace must not climb the wall.
  it("holds a vertex over a terrace at the centre's height", () => {
    const pos = new Float32Array(16 * 3);
    const terraceEast = (x: number): boolean => x > 5.5;
    const tall = (x: number): number => (x > 5.5 ? 3 : 0.2);
    writeDecalGrid(pos, 0, 4, { cx: 5, cz: 5, halfLength: 1, halfWidth: 1, facingRad: 0 }, tall, terraceEast);
    for (let v = 0; v < 16; v++) expect(pos[v * 3 + 1]).toBeCloseTo(0.2 + MARK_EPSILON, 6);
  });
  it('writes offsets in the same vertex order as positions', () => {
    const off = new Float32Array(16 * 2);
    writeDecalOffsets(off, 0, 4);
    expect([off[0], off[1]]).toEqual([-1, -1]);
    expect([off[30], off[31]]).toEqual([1, 1]);
  });
});

describe('sizes -- spec §5', () => {
  it('sizes a crater at 0.45 tile for a mortar and 0.6 for a Grad (R-13)', () => {
    expect(craterRadiusTiles(0.3)).toBeCloseTo(0.45, 9);
    expect(craterRadiusTiles(0.45)).toBeCloseTo(0.6, 9);
    expect(craterRadiusTiles(0)).toBe(0);
  });
  it('spills rubble 1.2x the footprint half-diagonal', () => {
    expect(rubbleRadiusTiles(3, 3, 3, 3)).toBeCloseTo(1.2 * Math.SQRT1_2, 9);
    expect(rubbleRadiusTiles(0, 0, 2, 1)).toBeCloseTo(1.2 * 0.5 * Math.hypot(3, 2), 9);
  });
  it('makes a tread stamp one spacing plus one feather long (R-15)', () => {
    expect(2 * TRACK_STAMP_HALF_LENGTH).toBeCloseTo(0.58, 9);
  });
});

describe('DecalPool', () => {
  const material = (): THREE.Material => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  it('refuses an empty pool', () => {
    expect(() => new DecalPool({ capacity: 0, grid: 4, renderOrder: 0, material: material() })).toThrow(/capacity/);
  });
  it('grows to its capacity and never past it, evicting the oldest', () => {
    const p = new DecalPool({ capacity: 3, grid: 4, renderOrder: DECAL_PERSISTENT_RENDER_ORDER, material: material() });
    for (let k = 0; k < 4; k++) p.stamp(stamp({ x: k }), flat, never);
    expect(p.liveCount).toBe(3);
    const pos = p.mesh.geometry.getAttribute('position');
    expect(pos.getX(0)).toBeCloseTo(3 - 0.5, 6); // slot 0 now holds the fourth stamp
    expect(p.mesh.geometry.drawRange.count).toBe(3 * 18 * 3);
  });
  // The AO pre-pass and the shadow pass must never see a decal (spec §8, "AO pre-pass").
  it('stays out of the shadow and AO passes, and draws in its named band', () => {
    const p = new DecalPool({ capacity: 2, grid: 2, renderOrder: DECAL_FADING_RENDER_ORDER, material: material() });
    expect(isAoOccluder(p.mesh)).toBe(false);
    expect(p.mesh.castShadow).toBe(false);
    expect(p.mesh.receiveShadow).toBe(false);
    expect(p.mesh.frustumCulled).toBe(false);
    expect(p.mesh.renderOrder).toBe(DECAL_FADING_RENDER_ORDER);
    expect(p.mesh.geometry.getAttribute('normal')).toBeUndefined();
  });
  it('records kind, seed, date and length on every vertex', () => {
    const p = new DecalPool({ capacity: 1, grid: 2, renderOrder: 0, material: material() });
    p.stamp(stamp({ kind: 'tyre', seed: 0.25, simMs: 1500, halfLength: 0.29 }), flat, never);
    const a = p.mesh.geometry.getAttribute('aDecal');
    for (let v = 0; v < 4; v++) {
      expect(a.getX(v)).toBe(5);
      expect(a.getY(v)).toBeCloseTo(0.25, 6);
      expect(a.getZ(v)).toBeCloseTo(1.5, 6);
      expect(a.getW(v)).toBeCloseTo(0.29, 6);
    }
  });
});
