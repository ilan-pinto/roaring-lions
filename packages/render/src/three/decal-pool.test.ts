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
  rubbleRadiusTiles,
  SCORCH_ALPHA,
  SCORCH_EDGE_INNER,
  stampSimMs,
  TILE_HASH_MIX,
  TILE_HASH_MX,
  TILE_HASH_MY,
  TRACK_ALPHA,
  TRACK_FADE_SEC,
  TRACK_STAMP_HALF_LENGTH,
  writeDecalGrid,
  writeDecalOffsets,
  writeGridIndices,
  type DecalStamp,
} from './decal-pool';
import { isAoOccluder } from './post-chain';
import { scorchRadiusTiles } from './scorch-decals';
import { hexToLinear, MARK_EPSILON } from './terrain/shared';
import { tileHash } from '../tile-hash';
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
  it('scatters rubble as chips in both limestone tones, about half the cells', () => {
    let chips = 0;
    let cells = 0;
    const tones = new Set<number>();
    for (let i = -3; i <= 3; i++)
      for (let j = -3; j <= 3; j++) {
        const s = (i + 0.5) / 5;
        const t = (j + 0.5) / 5;
        if (Math.hypot(s, t) > 0.7) continue;
        cells++;
        const d = decalAlpha('rubble', s, t, 0.37, 0, 1);
        if (d.alpha > 0) {
          chips++;
          tones.add(d.colour);
        }
      }
    expect(chips / cells).toBeGreaterThan(0.25);
    expect(chips / cells).toBeLessThan(0.7);
    expect(tones).toEqual(new Set([4, 5]));
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
  it('carries the tested constants', () => {
    for (const k of [SCORCH_ALPHA, TRACK_ALPHA, TRACK_FADE_SEC]) expect(m.fragmentShader).toContain(k.toFixed(3));
    expect(m.uniforms.uNowSec.value).toBe(0);
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
});
