/**
 * Groves are the first terrain builder whose geometry stands above the
 * ground rather than lying flat on it -- these tests carry the same palette
 * and determinism guarantees `ground.test.ts`/`scatter.test.ts` prove, plus
 * the three properties specific to a billboard: a tree's footprint stays
 * inside its own tile even though its height does not, a crown actually
 * clears its tile's own ground height (not just an epsilon), and the twin
 * tree threshold matches Pixi's `tileHash(x * 3, y * 7) > 0.62`.
 */
import { describe, it, expect } from 'vitest';
import { buildGroves } from './grove';
import { WORLD_PER_LEVEL } from './ground';
import { PALETTE_HEXES } from './tones';
import { tileHash } from '../../tile-hash';
import { VIEW_DIRECTION } from '../camera';
import type { TerrainInput } from './types';

const TONES = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'] as [string, string, string],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone' as const,
};

function flat(w: number, h: number): TerrainInput {
  return {
    width: w, height: h, decor: null, elevation: null,
    blocked: new Uint8Array(w * h), cover: new Uint8Array(w * h),
  };
}

function paletteEntries(): Set<string> {
  return new Set(PALETTE_HEXES.map((h) => h.toUpperCase()));
}

function colorAt(colors: Float32Array, i: number): string {
  return (
    '#' +
    [0, 1, 2]
      .map((k) => Math.round(colors[i + k] * 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/** A single grove tile at `(x, y)` on a `w x h` grid, decor 2 (DECOR_GROVE)
 *  there and 0 (none) everywhere else -- so every vertex the builder emits
 *  belongs to that one tile, unambiguously. */
function groveAt(w: number, h: number, x: number, y: number): TerrainInput {
  const input = flat(w, h);
  input.decor = new Uint8Array(w * h);
  input.decor[y * w + x] = 2;
  return input;
}

// Found by brute force over tileHash(x * 3, y * 7): (0, 0) sits below Pixi's
// 0.62 twin threshold (single tree), (2, 0) sits above it (twin). Picking
// real coordinates rather than a stub keeps this test exercising the actual
// hash `buildGroves` calls, not a fake standing in for it.
const SINGLE_X = 0;
const SINGLE_Y = 0;
const TWIN_X = 2;
const TWIN_Y = 0;

describe('buildGroves', () => {
  it('the fixture coordinates actually straddle the twin threshold', () => {
    // Guards the two tiles picked above against `tileHash` ever changing --
    // if this fails, every other test below is exercising the wrong branch
    // silently.
    expect(tileHash(SINGLE_X * 3, SINGLE_Y * 7)).toBeLessThanOrEqual(0.62);
    expect(tileHash(TWIN_X * 3, TWIN_Y * 7)).toBeGreaterThan(0.62);
  });

  it('emits nothing on a map with no grove tiles', () => {
    const m = buildGroves(flat(4, 4), TONES, '#14150F');
    expect(m.indices.length).toBe(0);
    expect(m.positions.length).toBe(0);
  });

  it('every vertex colour is a palette entry', () => {
    const entries = paletteEntries();
    // A grid with grove on several tiles, elevation varying, so both the
    // twin and single-tree branches and a non-zero topY are all exercised
    // in one pass.
    const w = 6, h = 6;
    const input = flat(w, h);
    input.elevation = new Uint8Array(w * h).map((_, ti) => ((ti % w) + Math.floor(ti / w)) % 4);
    input.decor = new Uint8Array(w * h).map((_, ti) => (ti % 3 === 0 ? 2 : 0));
    const m = buildGroves(input, TONES, '#14150F');
    expect(m.colors.length).toBeGreaterThan(0);
    for (let i = 0; i < m.colors.length; i += 3) {
      expect(entries).toContain(colorAt(m.colors, i));
    }
  });

  it('is deterministic', () => {
    const w = 6, h = 6;
    const build = (): TerrainInput => {
      const input = flat(w, h);
      input.elevation = new Uint8Array(w * h).map((_, ti) => ((ti % w) + Math.floor(ti / w)) % 4);
      input.decor = new Uint8Array(w * h).map((_, ti) => (ti % 3 === 0 ? 2 : 0));
      return input;
    };
    const a = buildGroves(build(), TONES, '#14150F');
    const b = buildGroves(build(), TONES, '#14150F');
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
  });

  describe('the twin-tree threshold', () => {
    it('draws one tree (trunk + 6 crown quads + shadow = 8 quads) below the threshold', () => {
      const m = buildGroves(groveAt(1, 1, SINGLE_X, SINGLE_Y), TONES, '#14150F');
      expect(m.indices.length).toBe(8 * 6);
    });

    it('draws two trees (14 crown/trunk quads + shadow = 15 quads) above the threshold', () => {
      const w = TWIN_X + 1;
      const m = buildGroves(groveAt(w, 1, TWIN_X, TWIN_Y), TONES, '#14150F');
      expect(m.indices.length).toBe(15 * 6);
    });
  });

  it("crowns stand above their tile's ground height", () => {
    // Elevation non-zero so a bug that reused a hardcoded 0 instead of this
    // tile's own topY would not accidentally pass.
    const input = groveAt(1, 1, 0, 0);
    input.elevation = new Uint8Array([4]);
    const m = buildGroves(input, TONES, '#14150F');
    const topY = 4 * WORLD_PER_LEVEL;
    let maxY = -Infinity;
    for (let i = 1; i < m.positions.length; i += 3) maxY = Math.max(maxY, m.positions[i]);
    // 0.1 world units comfortably clears every epsilon this module adds
    // (at most 0.04) -- only real trunk/crown height can reach this margin,
    // the same reasoning scatter.test.ts's own raised-tile test uses.
    expect(
      maxY,
      'crown does not clear its own tile top by a real margin -- suggests height collapsed to an epsilon-only nudge'
    ).toBeGreaterThan(topY + 0.1);
  });

  describe('keeps every tree inside its own tile footprint', () => {
    // Both the single-tree and twin-tree branches, each isolated on its own
    // tile so every vertex in the mesh can be checked against that one
    // tile's own bounds unambiguously.
    it('single tree', () => {
      const m = buildGroves(groveAt(1, 1, SINGLE_X, SINGLE_Y), TONES, '#14150F');
      expect(m.positions.length).toBeGreaterThan(0);
      for (let i = 0; i < m.positions.length; i += 3) {
        expect(m.positions[i]).toBeGreaterThanOrEqual(SINGLE_X - 1e-6);
        expect(m.positions[i]).toBeLessThanOrEqual(SINGLE_X + 1 + 1e-6);
        expect(m.positions[i + 2]).toBeGreaterThanOrEqual(SINGLE_Y - 1e-6);
        expect(m.positions[i + 2]).toBeLessThanOrEqual(SINGLE_Y + 1 + 1e-6);
      }
    });

    it('twin trees', () => {
      const w = TWIN_X + 1;
      const m = buildGroves(groveAt(w, 1, TWIN_X, TWIN_Y), TONES, '#14150F');
      expect(m.positions.length).toBeGreaterThan(0);
      for (let i = 0; i < m.positions.length; i += 3) {
        expect(m.positions[i]).toBeGreaterThanOrEqual(TWIN_X - 1e-6);
        expect(m.positions[i]).toBeLessThanOrEqual(TWIN_X + 1 + 1e-6);
        expect(m.positions[i + 2]).toBeGreaterThanOrEqual(TWIN_Y - 1e-6);
        expect(m.positions[i + 2]).toBeLessThanOrEqual(TWIN_Y + 1 + 1e-6);
      }
    });
  });

  it('every triangle winds toward the camera', () => {
    // MeshBasicMaterial defaults to FrontSide, so a wrong winding does not
    // render dark -- it renders as nothing. Unlike ground.ts/scatter.ts, a
    // billboard quad has no pair of vertices sharing a coordinate in
    // general (it is tilted in all three axes at once), so there is no
    // "kind" to classify by shared X/Y/Z -- this just checks every triangle
    // directly, which is what actually matters.
    const w = 6, h = 6;
    const input = flat(w, h);
    input.elevation = new Uint8Array(w * h).map((_, ti) => ((ti % w) + Math.floor(ti / w)) % 4);
    input.decor = new Uint8Array(w * h).map((_, ti) => (ti % 3 === 0 ? 2 : 0));
    const m = buildGroves(input, TONES, '#14150F');
    expect(m.indices.length).toBeGreaterThan(0);
    const at = (i: number): [number, number, number] => [
      m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2],
    ];
    const sub = (u: [number, number, number], v: [number, number, number]): [number, number, number] => [
      u[0] - v[0], u[1] - v[1], u[2] - v[2],
    ];
    const cross = (u: [number, number, number], v: [number, number, number]): [number, number, number] => [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const dot = (u: [number, number, number], v: [number, number, number]): number =>
      u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = at(m.indices[i]);
      const b = at(m.indices[i + 1]);
      const c = at(m.indices[i + 2]);
      const normal = cross(sub(b, a), sub(c, a));
      const magnitude = Math.hypot(normal[0], normal[1], normal[2]);
      if (magnitude < 1e-9) continue;
      const d = dot(normal, [VIEW_DIRECTION.x, VIEW_DIRECTION.y, VIEW_DIRECTION.z]);
      expect(d, `triangle ${i / 3} (indices ${i}-${i + 2}) winds away from the camera`).toBeGreaterThan(0);
    }
  });
});
