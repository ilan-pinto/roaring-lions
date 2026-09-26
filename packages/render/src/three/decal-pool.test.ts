/**
 * Pure geometry/bookkeeping and GPU-facing construction for the shared
 * decal pool's core (Task 10 -- ring buffer, conforming grid, sim-time
 * clock) -- and, appended at the end, Task 11's kind shader
 * (`decalAlpha`, `createDecalMaterial`, `DecalPalette`).
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
  CRATER_BOWL_ALPHA,
  CRATER_LIP_ALPHA,
  craterRadiusTiles,
  createDecalMaterial,
  decalAlpha,
  decalMultiplier,
  DECAL_LIFT_CAP,
  DECAL_SAG_STEPS,
  DECAL_PALETTE_ORDER,
  DecalPool,
  FADING_CAPACITY,
  FADING_GRID,
  gridTriangles,
  OIL_ALPHA,
  PERSISTENT_CAPACITY,
  PERSISTENT_GRID,
  presentationSimMs,
  RUBBLE_ALPHA,
  RUBBLE_CELL_TILES,
  rubbleRadiusTiles,
  SCORCH_ALPHA,
  SCORCH_EDGE_INNER,
  stampSimMs,
  TILE_HASH_MIX,
  TILE_HASH_MX,
  TILE_HASH_MY,
  TILE_HASH_SHIFT_A,
  TILE_HASH_SHIFT_B,
  TRACK_ALPHA,
  TRACK_FADE_SEC,
  TRACK_STAMP_HALF_LENGTH,
  writeDecalGrid,
  writeDecalOffsets,
  writeGridIndices,
  type DecalStamp,
} from './decal-pool';
import { isAoOccluder } from './post-chain';
import { decalGroundY } from './ground-height';
import { buildTerrainSurface, isTerrace, surfaceWorldY } from './terrain/surface';
import { scorchRadiusTiles } from './scorch-decals';
import { hexToLinear, MARK_EPSILON, WORLD_PER_LEVEL } from './terrain/shared';
import { ROAD_DISTANCE_RANGE_TILES } from './terrain/control-map';
import { ROAD_EDGE_BEND, ROAD_EDGE_FALLOFF, ROAD_HALF_WIDTH, SHOULDER_ALPHA, SHOULDER_TILES } from './terrain/road-graph';
import { tileHash } from '../tile-hash';
import { DECAL_FADING_RENDER_ORDER, DECAL_PERSISTENT_RENDER_ORDER } from './units/render-order';

const flat = (): number => 0;
const GREY: [number, number, number] = [0.5, 0.5, 0.5];
/** `tileHash(7, 11)` computed with the literal constants 13 and 16. */
const TILE_HASH_7_11 = 0.3646712712943554;
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
      writeDecalGrid(pos, 0, n, { cx: 0, cz: 0, halfLength: 1, halfWidth: 1, facingRad: 0 }, flat);
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
    writeDecalGrid(pos, 0, 4, { cx: 5, cz: 5, halfLength: 1, halfWidth: 1, facingRad: 0 }, slope);
    for (let v = 0; v < 16; v++) expect(pos[v * 3 + 1]).toBeCloseTo(0.1 * pos[v * 3] + MARK_EPSILON, 6);
  });
  it('turns with its facing', () => {
    const pos = new Float32Array(4 * 3);
    writeDecalGrid(pos, 0, 2, { cx: 0, cz: 0, halfLength: 1, halfWidth: 0.1, facingRad: Math.PI / 2 }, flat);
    const zs = [0, 1, 2, 3].map((v) => pos[v * 3 + 2]);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2, 6);
  });
  // Fix wave I-4: the grid samples whatever the caller's sampler returns at
  // EVERY vertex -- the terrace/off-map continuation is the sampler's job
  // (ThreeRenderer hands in the smooth field), not a hold at the centre.
  it('samples the caller\'s field at every vertex, with no centre hold', () => {
    const pos = new Float32Array(16 * 3);
    const tall = (x: number): number => (x > 5.5 ? 3 : 0.2);
    writeDecalGrid(pos, 0, 4, { cx: 5, cz: 5, halfLength: 1, halfWidth: 1, facingRad: 0 }, tall);
    for (let v = 0; v < 16; v++) expect(pos[v * 3 + 1]).toBeGreaterThanOrEqual(tall(pos[v * 3]) + MARK_EPSILON - 1e-6);
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
    for (let k = 0; k < 4; k++) p.stamp(stamp({ x: k }), flat, GREY);
    expect(p.liveCount).toBe(3);
    const pos = p.mesh.geometry.getAttribute('position');
    expect(pos.getX(0)).toBeCloseTo(3 - 0.5, 6); // slot 0 now holds the fourth stamp
    expect(p.mesh.geometry.drawRange.count).toBe(3 * 18 * 3);
  });
  // Found by Task 12's photographs: every slot's indices were written at the
  // start of the buffer, so the first slot's triangles referenced the LAST
  // slot's vertices and every other triangle was degenerate (all zeros). The
  // pool drew one call and no pixels, and no test looked at the index buffer.
  it("gives every slot its own share of the index buffer, referencing only that slot's vertices", () => {
    const n = 4;
    const perSlot = gridTriangles(n) * 3;
    const p = new DecalPool({ capacity: 3, grid: n, renderOrder: 0, material: material() });
    const idx = p.mesh.geometry.getIndex();
    expect(idx?.count).toBe(3 * perSlot);
    for (let slot = 0; slot < 3; slot++) {
      const share = Array.from((idx?.array as Uint32Array).subarray(slot * perSlot, (slot + 1) * perSlot));
      expect(Math.min(...share), `slot ${slot}`).toBe(slot * n * n);
      expect(Math.max(...share), `slot ${slot}`).toBe(slot * n * n + n * n - 1);
    }
  });
  // M-1: both shipped pools hold exactly 16,384 vertices, so 16-bit indices.
  it('indexes both shipped pools in 16 bits, and falls back to 32 past 65,536 vertices', () => {
    for (const [capacity, grid] of [
      [PERSISTENT_CAPACITY, PERSISTENT_GRID],
      [FADING_CAPACITY, FADING_GRID],
    ] as const) {
      expect(capacity * grid * grid).toBe(16384);
      const p = new DecalPool({ capacity, grid, renderOrder: 0, material: material() });
      expect(p.mesh.geometry.getIndex()?.array).toBeInstanceOf(Uint16Array);
    }
    const big = new DecalPool({ capacity: 4097, grid: 4, renderOrder: 0, material: material() });
    expect(big.mesh.geometry.getIndex()?.array).toBeInstanceOf(Uint32Array);
  });
  // M-1: a stamp uploads its own slot, not the whole pool.
  it('flags only the stamped slot for upload, on every dynamic attribute', () => {
    const n = 4;
    const p = new DecalPool({ capacity: 8, grid: n, renderOrder: 0, material: material() });
    const g = p.mesh.geometry;
    for (const name of ['position', 'aDecal', 'aGround']) (g.getAttribute(name) as THREE.BufferAttribute).clearUpdateRanges();
    p.stamp(stamp(), flat, GREY);
    p.stamp(stamp({ x: 6 }), flat, GREY);
    for (const name of ['position', 'aDecal', 'aGround']) {
      const attr = g.getAttribute(name) as THREE.BufferAttribute;
      const k = attr.itemSize * n * n;
      expect(attr.updateRanges, name).toEqual([
        { start: 0, count: k },
        { start: k, count: k },
      ]);
    }
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
  it('records kind, seed, date, length and the ground tone under it on every vertex', () => {
    const p = new DecalPool({ capacity: 2, grid: 2, renderOrder: 0, material: material() });
    p.stamp(stamp({ kind: 'crater' }), flat, GREY);
    p.stamp(stamp({ kind: 'tyre', seed: 0.25, simMs: 1500, halfLength: 0.29 }), flat, [0.1, 0.2, 0.3]);
    const a = p.mesh.geometry.getAttribute('aDecal');
    const g = p.mesh.geometry.getAttribute('aGround');
    for (let v = 4; v < 8; v++) {
      expect(a.getX(v)).toBe(5);
      expect(a.getY(v)).toBeCloseTo(0.25, 6);
      expect(a.getZ(v)).toBeCloseTo(1.5, 6);
      expect(a.getW(v)).toBeCloseTo(0.29, 6);
      // Slot 1's own tone, not slot 0's: the denominator is per decal.
      expect([g.getX(v), g.getY(v), g.getZ(v)].map((c) => +c.toFixed(6))).toEqual([0.1, 0.2, 0.3]);
    }
    for (let v = 0; v < 4; v++) expect(g.getX(v)).toBeCloseTo(0.5, 6);
  });
});

describe('decalAlpha -- spec §5, kind by kind', () => {
  // The lead's approved numbers, as literals: every other test here reads
  // the constants symbolically, so a retuned constant would pass them all.
  it('pins the approved opacities and the 180 s fade (spec §5, D6)', () => {
    expect([CRATER_BOWL_ALPHA, CRATER_LIP_ALPHA, OIL_ALPHA, RUBBLE_ALPHA, TRACK_ALPHA, SCORCH_ALPHA]).toEqual([
      0.4, 0.25, 0.55, 0.6, 0.35, 0.45,
    ]);
    expect(SCORCH_EDGE_INNER).toBe(0.55);
    expect(TRACK_FADE_SEC).toBe(180);
  });
  it("keeps A1.2's scorch to the value", () => {
    expect(decalAlpha('scorch', 0, 0, 0, 0, 1).alpha).toBeCloseTo(SCORCH_ALPHA, 9);
    expect(decalAlpha('scorch', 0.55, 0, 0, 0, 1).alpha).toBeCloseTo(SCORCH_ALPHA, 9);
    expect(decalAlpha('scorch', 1, 0, 0, 0, 1).alpha).toBe(0);
    expect(scorchRadiusTiles(1)).toBe(1.6); // unchanged (spec §5, "Scorch")
  });
  it('draws a crater as a dark bowl inside a pale lip', () => {
    expect(decalAlpha('crater', 0, 0, 0, 0, 1)).toEqual({ alpha: 0.4, colour: 0 });
    const lip = decalAlpha('crater', 0.88, 0, 0, 0, 1);
    expect(lip.colour).toBe(1);
    expect(lip.alpha).toBeGreaterThan(0.2);
    expect(decalAlpha('crater', 1.1, 0, 0, 0, 1).alpha).toBe(0);
  });
  it('pools oil at 55% under the wreck', () => {
    expect(decalAlpha('oil', 0, 0, 0.5, 0, 1)).toEqual({ alpha: 0.55, colour: 3 });
    expect(decalAlpha('oil', 1.2, 0, 0.5, 0, 1).alpha).toBe(0);
  });
  // Fix wave I-5. The first cut filled whole square cells 0.2 r across in a
  // hard step, which on grass drew a checkerboard of limestone tiles. Rubble
  // is now small soft chips on a seed-turned lattice of world-sized cells.
  describe('rubble chips (fix wave I-5)', () => {
    /** Every sample of a spill of radius `r` tiles on a `step`-tile lattice. */
    const spill = (r: number, seed: number, step = 0.01) => {
      const out: { x: number; z: number; alpha: number; colour: number }[] = [];
      for (let z = -r; z <= r; z += step)
        for (let x = -r; x <= r; x += step) {
          const d = decalAlpha('rubble', x / r, z / r, seed, 0, r);
          out.push({ x, z, alpha: d.alpha, colour: d.colour });
        }
      return out;
    };
    it('draws both limestone tones at the approved 60%', () => {
      const lit = spill(1, 0.37).filter((p) => p.alpha > 0);
      expect(new Set(lit.map((p) => p.colour))).toEqual(new Set([4, 5]));
      expect(Math.max(...lit.map((p) => p.alpha))).toBeCloseTo(RUBBLE_ALPHA, 6);
    });
    it('sizes its cells in world units: a bigger spill has more chips, not bigger ones', () => {
      // Chip COUNT, by connected lit samples on a coarse proxy: the lit area
      // grows with r^2 while each chip stays RUBBLE_CELL_TILES-sized, so the
      // mean lit run along a row is the same at r = 0.8 and r = 2.4.
      const meanRun = (r: number): number => {
        const pts = spill(r, 0.21, 0.005);
        const row = Math.round((2 * r) / 0.005) + 1;
        let runs = 0;
        let lit = 0;
        for (let i = 0; i < pts.length; i++) {
          const on = pts[i].alpha > 0.3;
          if (on) lit++;
          if (on && (i % row === 0 || !(pts[i - 1].alpha > 0.3))) runs++;
        }
        return (lit / runs) * 0.005;
      };
      const small = meanRun(0.8);
      const big = meanRun(2.4);
      expect(small).toBeLessThan(RUBBLE_CELL_TILES);
      expect(big / small).toBeGreaterThan(0.8);
      expect(big / small).toBeLessThan(1.25);
    });
    it('draws a soft chip, never a filled cell: no cell is more than half covered', () => {
      const r = 1.2;
      const per = new Map<string, { n: number; lit: number }>();
      for (const p of spill(r, 0, 0.005)) {
        // seed 0 is unrotated, so cells are axis-aligned here.
        const key = `${Math.floor(p.x / RUBBLE_CELL_TILES)},${Math.floor(p.z / RUBBLE_CELL_TILES)}`;
        const c = per.get(key) ?? { n: 0, lit: 0 };
        c.n++;
        if (p.alpha > 0) c.lit++;
        per.set(key, c);
      }
      const full = [...per.values()].filter((c) => c.n > 300);
      expect(full.length).toBeGreaterThan(100);
      for (const c of full) expect(c.lit / c.n).toBeLessThan(0.5);
      // ...and it is soft: a chip has partial-alpha samples, not a hard step.
      const partial = spill(r, 0, 0.005).filter((p) => p.alpha > 0.05 && p.alpha < RUBBLE_ALPHA - 0.05);
      expect(partial.length).toBeGreaterThan(0);
    });
    it('turns the lattice by the seed, so no two spills line up', () => {
      const a = spill(1, 0.1).map((p) => p.alpha > 0);
      const b = spill(1, 0.35).map((p) => p.alpha > 0);
      // Jaccard overlap of the lit samples: two unrelated spills of this
      // density share a small fraction; the same lattice would share all.
      let both = 0;
      let either = 0;
      for (let i = 0; i < a.length; i++) {
        if (a[i] && b[i]) both++;
        if (a[i] || b[i]) either++;
      }
      expect(both / either).toBeLessThan(0.3);
      // The same seed is the same spill, to the sample.
      expect(spill(1, 0.1).map((p) => p.alpha)).toEqual(spill(1, 0.1).map((p) => p.alpha));
    });
    // A chip's solid core (alpha at the full 60%) sits within 0.2 of a cell of
    // the jittered centre, which is within 0.1 of the cell's middle: on an
    // axis-aligned lattice no core sample falls in the outer 0.15 of a cell
    // along x. Turned by the seed, plenty do.
    it('turns the lattice itself, not just the hash', () => {
      const offGrid = (seed: number): number => {
        const cores = spill(1, seed, 0.004).filter((p) => p.alpha >= RUBBLE_ALPHA * 0.999);
        const edge = cores.filter((p) => {
          const f = ((p.x / RUBBLE_CELL_TILES) % 1 + 1) % 1;
          return f < 0.15 || f > 0.85;
        });
        return edge.length / cores.length;
      };
      expect(offGrid(0)).toBe(0); // seed 0 is unturned: the control
      expect(offGrid(0.1)).toBeGreaterThan(0.1);
    });
    it('thins toward the edge', () => {
      const pts = spill(2, 0.6, 0.01);
      const cover = (lo: number, hi: number): number => {
        const ring = pts.filter((p) => Math.hypot(p.x, p.z) / 2 >= lo && Math.hypot(p.x, p.z) / 2 < hi);
        return ring.filter((p) => p.alpha > 0).length / ring.length;
      };
      const inner = cover(0, 0.4);
      const outer = cover(0.8, 1);
      expect(inner).toBeGreaterThan(0.05);
      expect(outer).toBeLessThan(inner * 0.5);
      expect(cover(1.05, 1.5)).toBe(0);
    });
  });
  it('fades tread linearly from 35% to nothing over 180 s of SIM time (D6)', () => {
    expect(decalAlpha('tyre', 0, 0, 0, 0, 0.29).alpha).toBeCloseTo(TRACK_ALPHA, 9);
    expect(decalAlpha('tyre', 0, 0, 0, TRACK_FADE_SEC / 2, 0.29).alpha).toBeCloseTo(TRACK_ALPHA / 2, 9);
    expect(decalAlpha('tyre', 0, 0, 0, TRACK_FADE_SEC, 0.29).alpha).toBe(0);
    expect(decalAlpha('tyre', 0, 0, 0, -0.05, 0.29).alpha).toBeCloseTo(TRACK_ALPHA, 9);
  });
  it('gives tread a pattern and tyre none', () => {
    const along = (k: 'tread' | 'tyre'): number[] =>
      Array.from({ length: 20 }, (_, i) => decalAlpha(k, -0.5 + i / 20, 0, 0, 0, 0.29).alpha);
    expect(Math.min(...along('tread'))).toBeLessThan(Math.max(...along('tread')));
    expect(new Set(along('tyre').map((a) => a.toFixed(6))).size).toBe(1);
  });
  // G7, R-15: two abutting stamps never double their alpha, and the seam dips at most A^2/4.
  it('joins consecutive stamps without a seam or a double', () => {
    const hl = 0.29;
    const spacing = 0.5;
    for (let u = 0.15; u <= 0.35; u += 0.005) {
      const a = decalAlpha('tyre', u / hl, 0, 0, 0, hl).alpha;
      const b = decalAlpha('tyre', (u - spacing) / hl, 0, 0, 0, hl).alpha;
      const over = 1 - (1 - a) * (1 - b);
      expect(over, `u=${u.toFixed(3)}`).toBeLessThanOrEqual(TRACK_ALPHA + 1e-9);
      expect(over, `u=${u.toFixed(3)}`).toBeGreaterThanOrEqual(TRACK_ALPHA - (TRACK_ALPHA * TRACK_ALPHA) / 4 - 1e-9);
    }
  });
});

describe('createDecalMaterial', () => {
  const palette = {
    craterBowl: '#23241F',
    craterLip: '#E6D8BE',
    scorch: '#23241F',
    oil: '#14150F',
    rubbleA: '#A28C6E',
    rubbleB: '#75624A',
    tread: '#806032',
    tyre: '#8C7659',
  };
  const m = createDecalMaterial(palette);
  it('is a translucent, depth-tested, non-writing decal', () => {
    expect(m.transparent).toBe(true);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(false);
  });
  // F-23: a 4x4 cell of a full-power scorch spans ~1.07 tiles, and its chord
  // can sag under a bicubic crest by more than MARK_EPSILON.
  it('carries the polygon offset that keeps a coarse cell off a crest (F-23)', () => {
    expect(m.polygonOffset).toBe(true);
    expect(m.polygonOffsetFactor).toBe(-1);
    expect(m.polygonOffsetUnits).toBe(-4);
  });
  it('takes linear colours in the palette order the kinds index', () => {
    const c = m.uniforms.uColors.value as THREE.Vector3[];
    expect(c).toHaveLength(8);
    expect(c[0].toArray()).toEqual(hexToLinear('#23241F'));
    expect(c[7].toArray()).toEqual(hexToLinear('#8C7659'));
    // Every slot, not just the ends: a swapped pair in the middle would draw
    // rubble in the tread's colour and no endpoint check would see it. The
    // order is pinned literally -- it is the index `decalAlpha` returns.
    expect(DECAL_PALETTE_ORDER).toEqual(['craterBowl', 'craterLip', 'scorch', 'oil', 'rubbleA', 'rubbleB', 'tread', 'tyre']);
    DECAL_PALETTE_ORDER.forEach((key, i) => expect(c[i].toArray()).toEqual(hexToLinear(palette[key])));
  });
  // F-22 (fix round 1): multiplied onto the LIT ground, so a lip in shade
  // stays in shade. The ratio's denominator is the ground's palette tone.
  it('multiplies onto the lit ground, as an albedo ratio over each decal\'s own ground tone (F-22)', () => {
    expect(m.blending).toBe(THREE.CustomBlending);
    expect(m.blendEquation).toBe(THREE.AddEquation);
    expect(m.blendSrc).toBe(THREE.DstColorFactor);
    expect(m.blendDst).toBe(THREE.ZeroFactor);
    expect(m.blendSrcAlpha).toBe(THREE.ZeroFactor);
    expect(m.blendDstAlpha).toBe(THREE.OneFactor);
    // The denominator's TILE tone is per decal (fix round 2), never a
    // map-wide uniform; the road is mixed in per fragment (fix wave I-3).
    expect(m.uniforms.uGroundTone).toBeUndefined();
    expect(m.vertexShader).toContain('attribute vec3 aGround');
    expect(m.fragmentShader).toContain('vec3 ground = mix(mix(vGround, uRoadTone, rlRoadSurf), uShoulderTone, rlShoulder);');
    expect(m.fragmentShader).toContain('colour / max(ground');
    expect(m.fragmentShader).toContain('gl_FragColor = vec4(1.0 + a * (ratio - 1.0), 1.0)');
  });
  it('carries the tested constants', () => {
    for (const k of [SCORCH_ALPHA, TRACK_FADE_SEC]) expect(m.fragmentShader).toContain(k.toFixed(3));
    // The track's own opacity, at its own use: 0.350000 also appears nowhere
    // else, but a bare toContain would be shadowed the moment it did.
    expect(m.fragmentShader).toContain(`${TRACK_ALPHA.toFixed(6)} * feather`);
    expect(m.uniforms.uNowSec.value).toBe(0);
  });
  // Fix wave I-3: the road profile the decal divides by is the ground's own,
  // transcribed from the same constants -- a drifted constant moves both.
  it('mixes the road into its divisor per fragment, from the ground\'s own control B', () => {
    const src = m.fragmentShader;
    const h = ROAD_HALF_WIDTH.toFixed(3);
    const fo = ROAD_EDGE_FALLOFF.toFixed(3);
    expect(src).toContain(`(${h} - 0.5 * ${fo})`);
    expect(src).toContain(`(${h} + 0.5 * ${fo})`);
    expect(src).toContain(`rlB.g * ${ROAD_DISTANCE_RANGE_TILES.toFixed(3)} + ${ROAD_EDGE_BEND.toFixed(3)} * (rlB.a * 2.0 - 1.0)`);
    expect(src).toContain(`uRoadOn * ${SHOULDER_ALPHA.toFixed(3)} * rlRoadEdge`);
    expect(src).toContain(`rlRoadH1 + ${SHOULDER_TILES.toFixed(3)}`);
    // Fetched before any discard: its implicit gradient needs uniform flow.
    expect(src.indexOf('texture2D(uControlB')).toBeGreaterThan(-1);
    expect(src.indexOf('texture2D(uControlB')).toBeLessThan(src.indexOf(') discard;'));
  });
  it('shares the ground\'s road uniforms by reference, and falls back to "no road" alone', () => {
    const ground = {
      uControlB: { value: new THREE.DataTexture() },
      uMapSize: { value: new THREE.Vector2(48, 48) },
      uRoadTone: { value: new THREE.Vector3(0.1, 0.2, 0.3) },
      uShoulderTone: { value: new THREE.Vector3(0.4, 0.5, 0.6) },
      uRoadOn: { value: 1 },
    };
    const shared = createDecalMaterial(palette, ground);
    for (const k of Object.keys(ground) as (keyof typeof ground)[]) expect(shared.uniforms[k]).toBe(ground[k]);
    // Alone: control B is the 1x1 "no road within range" texel.
    const b = m.uniforms.uControlB.value as THREE.DataTexture;
    expect(Array.from(b.image.data as Uint8Array)).toEqual([0, 255, 255, 128]);
  });
  // Fix wave I-4: nothing hangs past the map edge over the skirt.
  it('discards a fragment off the map, before it draws anything', () => {
    const src = m.fragmentShader;
    const edge = src.indexOf('if (vWorldXZ.x < 0.0 || vWorldXZ.y < 0.0 || vWorldXZ.x > uMapSize.x || vWorldXZ.y > uMapSize.y) discard;');
    expect(edge).toBeGreaterThan(-1);
    expect(edge).toBeLessThan(src.indexOf('int kind ='));
    expect(m.vertexShader).toContain('vWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;');
  });
  it('writes no colour into the GLSL -- palette uniforms only', () => {
    expect(m.fragmentShader).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    expect(m.fragmentShader).not.toMatch(/vec3\(\s*[0-9.]/);
  });
  // rlHash is tileHash transcribed: its multipliers are interpolated from
  // these exports, so pin the exports against tileHash's own output.
  it("transcribes tileHash's multipliers into rlHash", () => {
    const mirror = (x: number, y: number): number => {
      let h = (x * TILE_HASH_MX + y * TILE_HASH_MY) | 0;
      h = Math.imul(h ^ (h >>> 13), TILE_HASH_MIX);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    for (let x = 59; x <= 69; x++) for (let y = 59; y <= 1069; y += 37) expect(mirror(x, y)).toBe(tileHash(x, y));
    for (const k of [TILE_HASH_MX, TILE_HASH_MY, TILE_HASH_MIX]) expect(m.fragmentShader).toContain(`${k}u`);
  });
  // The shifts too, from the same exports (the parked hash-literal item,
  // folded into I-5): tileHash reads them and so does rlHash.
  it("transcribes tileHash's two shifts into rlHash", () => {
    expect([TILE_HASH_SHIFT_A, TILE_HASH_SHIFT_B]).toEqual([13, 16]);
    expect(m.fragmentShader).toContain(`(h ^ (h >> ${TILE_HASH_SHIFT_A}u))`);
    expect(m.fragmentShader).toContain(`h ^ (h >> ${TILE_HASH_SHIFT_B}u)`);
    // Pinned against a literal, so a changed constant is caught here rather
    // than moving tileHash, rlHash and every scatter mark together.
    expect(tileHash(7, 11)).toBe(TILE_HASH_7_11);
  });
});

describe('decalMultiplier -- the albedo ratio (F-22, fix round 1)', () => {
  const ground = hexToLinear('#C8B494');
  const lip = hexToLinear('#E6D8BE');
  const bowl = hexToLinear('#23241F');
  it('leaves the ground untouched at alpha 0', () => {
    expect(decalMultiplier(lip, ground, 0)).toEqual([1, 1, 1]);
  });
  // The approved alphas keep their meaning: on ground whose albedo is its
  // palette tone, multiplying by this under ANY light L is the old "over"
  // blend lit by L -- a lip in shade (L small) stays in shade.
  it('is the over blend lit like the ground, in sun and in shade alike', () => {
    for (const light of [1, 0.2]) {
      for (const [tone, a] of [
        [lip, CRATER_LIP_ALPHA],
        [bowl, CRATER_BOWL_ALPHA],
      ] as const) {
        const mult = decalMultiplier(tone, ground, a);
        for (let c = 0; c < 3; c++) {
          expect(ground[c] * light * mult[c]).toBeCloseTo(light * (ground[c] * (1 - a) + tone[c] * a), 12);
        }
      }
    }
  });
  it('writes a pale kind as a ratio above 1, which the HalfFloat scene target carries', () => {
    for (const v of decalMultiplier(lip, ground, 1)) expect(v).toBeGreaterThan(1);
  });
});

describe('the sag lift (F-23, fix round 1)', () => {
  const place = { cx: 0, cz: 0, halfLength: 1, halfWidth: 1, facingRad: 0.3 };
  it('is 0 on a plane', () => {
    const plane = (x: number, z: number): number => 0.4 * x - 0.25 * z + 0.1;
    const pos = new Float32Array(16 * 3);
    writeDecalGrid(pos, 0, 4, place, plane);
    for (let v = 0; v < 16; v++) {
      expect(pos[v * 3 + 1] - MARK_EPSILON).toBeCloseTo(plane(pos[v * 3], pos[v * 3 + 2]), 6);
    }
  });
  // One cell over a crest y = -k x^2 across x in [-1, 1]: all four corners
  // sit at -k, the chord is the plane y = -k, and the ground rises to 0 at the
  // cell's middle -- a sag of exactly k, which every corner is lifted by.
  // k = 0.05 sits under DECAL_LIFT_CAP, so the lift is the sag itself.
  it('lifts every vertex by its cell\'s sag over a crest', () => {
    const k = 0.05;
    const crest = (x: number): number => -k * x * x;
    const pos = new Float32Array(4 * 3);
    writeDecalGrid(pos, 0, 2, { cx: 0, cz: 0, halfLength: 1, halfWidth: 1, facingRad: 0 }, crest);
    for (let v = 0; v < 4; v++) {
      expect(crest(pos[v * 3])).toBeCloseTo(-k, 6);
      expect(pos[v * 3 + 1]).toBeCloseTo(-k + k + MARK_EPSILON, 6);
    }
  });
  // Fix round 2: a lifted decal floats over a unit's feet and the multiply
  // darkens its legs, so the lift stops at DECAL_LIFT_CAP -- the same crest
  // made twenty times taller lifts by the cap, not by its sag of 1.
  it('never lifts a vertex by more than DECAL_LIFT_CAP', () => {
    expect(DECAL_LIFT_CAP).toBe(0.08);
    const crest = (x: number): number => -x * x;
    const pos = new Float32Array(4 * 3);
    writeDecalGrid(pos, 0, 2, { cx: 0, cz: 0, halfLength: 1, halfWidth: 1, facingRad: 0 }, crest);
    for (let v = 0; v < 4; v++) expect(pos[v * 3 + 1]).toBeCloseTo(-1 + DECAL_LIFT_CAP + MARK_EPSILON, 6);
  });
  // Measured through the triangles the index buffer DRAWS (diagonal a-c).
  // A ridge along the other diagonal (b-d) sags 4k under the drawn chord at
  // the cell's centre, and only k under the undrawn one; 4k stays under the cap.
  it('measures the sag through the drawn diagonal, not the other one', () => {
    const k = 0.015;
    const ridge = (x: number, z: number): number => -k * (x + z) ** 2;
    const pos = new Float32Array(4 * 3);
    writeDecalGrid(pos, 0, 2, { cx: 0, cz: 0, halfLength: 1, halfWidth: 1, facingRad: 0 }, ridge);
    for (let v = 0; v < 4; v++) {
      expect(pos[v * 3 + 1] - MARK_EPSILON - ridge(pos[v * 3], pos[v * 3 + 2])).toBeCloseTo(4 * k, 6);
    }
  });
  // The guarantee the lift buys, on the persistent grid over a 2-D crest:
  // at every point of the sag lattice, both triangles of every cell are on
  // or above the ground. Without the lift this crest sags by ~0.1.
  // Built from `writeGridIndices`' own output, so the triangles checked here
  // are the triangles drawn: the sag's diagonal and the index buffer's cannot
  // diverge without this going red.
  // A crest whose sag stays under the cap (the cap's own test is above).
  it('keeps every drawn triangle of a 4x4 grid on or above a crest', () => {
    const crest = (x: number, z: number): number => -0.06 * (x * x + z * z) + 0.03 * Math.sin(3 * x);
    const n = 4;
    const pos = new Float32Array(n * n * 3);
    writeDecalGrid(pos, 0, n, { cx: 0.2, cz: -0.1, halfLength: 1.6, halfWidth: 1.6, facingRad: 0.4 }, crest);
    const idx = new Uint32Array(gridTriangles(n) * 3);
    writeGridIndices(idx, 0, n);
    const at = (k: number): [number, number, number] => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
    let worst = Infinity;
    for (let t = 0; t < idx.length; t += 3) {
      const [p0, p1, p2] = [at(idx[t]), at(idx[t + 1]), at(idx[t + 2])];
      // Barycentric lattice over the drawn triangle, edges included.
      for (let i = 0; i <= DECAL_SAG_STEPS; i++) {
        for (let j = 0; j <= DECAL_SAG_STEPS - i; j++) {
          const w1 = i / DECAL_SAG_STEPS;
          const w2 = j / DECAL_SAG_STEPS;
          const w0 = 1 - w1 - w2;
          const p = (c: number): number => w0 * p0[c] + w1 * p1[c] + w2 * p2[c];
          worst = Math.min(worst, p(1) - crest(p(0), p(2)));
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(MARK_EPSILON - 1e-6);
  });
});

// Fix wave I-4: what a grid vertex over a terrace or off the map samples.
// `decalGroundY` (the smooth field) against the drawn surface, on real
// `buildTerrainSurface` relief, each paired with the rule it replaced.
describe('the conforming grid on relief (fix wave I-4)', () => {
  const W = 12;
  const n = PERSISTENT_GRID;

  function surfaceOf(levels: number[][], blocked: (x: number, y: number) => boolean) {
    const elevation = new Uint8Array(W * W);
    const mask = new Uint8Array(W * W);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        elevation[y * W + x] = levels[y][x];
        mask[y * W + x] = blocked(x, y) ? 1 : 0;
      }
    return buildTerrainSurface({ width: W, height: W, decor: null, elevation, blocked: mask, cover: new Uint8Array(W * W) });
  }

  /** How far the DRAWN decal sits below the drawn ground, over open tiles on
   *  the map -- `sag-scan.ts`'s own walk: both triangles of every cell at 8x8. */
  function worstBelow(pos: Float32Array, s: ReturnType<typeof surfaceOf>): number {
    const V = (i: number, j: number): number[] => [0, 1, 2].map((k) => pos[(j * n + i) * 3 + k]);
    let worst = 0;
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const [a, b, c, d] = [V(i, j), V(i + 1, j), V(i + 1, j + 1), V(i, j + 1)];
        for (let sv = 0; sv <= 8; sv++)
          for (let su = 0; su <= 8; su++) {
            const u = su / 8;
            const v = sv / 8;
            const p = [0, 1, 2].map((k) =>
              u >= v ? a[k] + u * (b[k] - a[k]) + v * (c[k] - b[k]) : a[k] + v * (d[k] - a[k]) + u * (c[k] - d[k])
            );
            if (p[0] < 0 || p[2] < 0 || p[0] >= W || p[2] >= W) continue;
            if (isTerrace(s, Math.floor(p[0]), Math.floor(p[2]))) continue;
            worst = Math.max(worst, surfaceWorldY(s, p[0], p[2]) - p[1]);
          }
      }
    return worst;
  }

  // Open ground climbing east 0-2-4-6 to the foot of a level-8 ridge at x >= 7:
  // the qarn_hadid ridge-foot shape, with a full-power scorch (r 1.6) on the
  // slope whose grid reaches onto the ridge.
  const ridge = surfaceOf(
    Array.from({ length: W }, () => Array.from({ length: W }, (_, x) => (x >= 7 ? 8 : Math.max(0, Math.min(6, 2 * (x - 4)))))),
    (x) => x >= 7
  );
  const place = { cx: 5.4, cz: 6, halfLength: 1.6, halfWidth: 1.6, facingRad: 0 };

  it('follows the apron to the foot of a ridge, and on under it', () => {
    const pos = new Float32Array(n * n * 3);
    writeDecalGrid(pos, 0, n, place, (x, z) => decalGroundY(ridge, W, W, x, z));
    expect(pos.filter((_, k) => k % 3 === 0).some((x) => x >= 7)).toBe(true); // the grid does reach the ridge
    expect(worstBelow(pos, ridge)).toBeLessThanOrEqual(RIDGE_FOOT_WORST_WU);
    // ...and no vertex climbs the wall: over the ridge it stays far under the top.
    for (let v = 0; v < n * n; v++)
      if (pos[v * 3] >= 7) expect(pos[v * 3 + 1]).toBeLessThan(surfaceWorldY(ridge, 7.5, 6) - WORLD_PER_LEVEL);
  });
  it('(control) the retired centre hold cut under that apron', () => {
    const centreY = surfaceWorldY(ridge, place.cx, place.cz);
    const hold = (x: number, z: number): number =>
      isTerrace(ridge, Math.floor(x), Math.floor(z)) ? centreY : surfaceWorldY(ridge, x, z);
    const pos = new Float32Array(n * n * 3);
    writeDecalGrid(pos, 0, n, place, hold);
    expect(worstBelow(pos, ridge)).toBeGreaterThan(RIDGE_FOOT_OLD_MIN_WU);
  });

  // A level-2 plateau running to the east edge: a mark within its radius of
  // the edge must stay on its level, not dive toward height 0 off the map.
  const rim = surfaceOf(
    Array.from({ length: W }, () => Array.from({ length: W }, (_, x) => (x >= 8 ? 2 : x >= 6 ? x - 6 : 0))),
    () => false
  );
  const edge = { cx: W - 0.4, cz: 6, halfLength: 1, halfWidth: 1, facingRad: 0.3 };

  it('stays on a raised rim at the map edge', () => {
    const pos = new Float32Array(n * n * 3);
    writeDecalGrid(pos, 0, n, edge, (x, z) => decalGroundY(rim, W, W, x, z));
    const top = surfaceWorldY(rim, W - 0.5, 6);
    for (let v = 0; v < n * n; v++) expect(pos[v * 3 + 1]).toBeGreaterThanOrEqual(top - 1e-6);
    expect(worstBelow(pos, rim)).toBeLessThanOrEqual(1e-6);
  });
  it('(control) the drawn surface reads 0 off the map, and the mark dived', () => {
    const pos = new Float32Array(n * n * 3);
    writeDecalGrid(pos, 0, n, edge, (x, z) => surfaceWorldY(rim, x, z));
    expect(worstBelow(pos, rim)).toBeGreaterThan(0.2);
  });
  it('is the drawn surface wherever the ground is open, and 0 on a flat map', () => {
    for (const [x, z] of [[2.3, 4.1], [5.5, 6], [6.9, 2.2]] as const)
      expect(decalGroundY(ridge, W, W, x, z)).toBeCloseTo(surfaceWorldY(ridge, x, z), 12);
    const flat = surfaceOf(Array.from({ length: W }, () => new Array<number>(W).fill(0)), () => false);
    expect(decalGroundY(flat, W, W, -3, 40)).toBe(0);
  });
});

/** Measured on this fixture: 0.016 wu with the smooth field, 0.473 with the
 *  retired centre hold (the shape of qarn_hadid's 0.62 wu ridge foot). */
const RIDGE_FOOT_WORST_WU = 0.03;
const RIDGE_FOOT_OLD_MIN_WU = 0.3;
