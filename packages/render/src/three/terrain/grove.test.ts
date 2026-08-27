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
import {
  buildGroves,
  TRUNK_EPSILON,
  TRUNK_LIT_EPSILON,
  CROWN_EPSILON,
  CROWN_MID_EPSILON,
  CROWN_LIT_EPSILON,
} from './grove';
import { WORLD_PER_LEVEL } from './ground';
import { PALETTE_HEXES } from './tones';
import { tileHash } from '../../tile-hash';
import { VIEW_DIRECTION, WORLD_Y_PER_LIFT_PIXEL } from '../camera';
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
    // One tree = 2 quads (trunk, trunk highlight -- 2 triangles each) + 5
    // octagon-approximated crown ellipses (3 dark lobes, 2 highlights -- 6
    // triangles each, CROWN_LOBE_SEGMENTS - 2). The trunk shadow is one
    // quad per TILE, not per tree.
    const TRUNK_QUAD_TRIANGLES = 2;
    const TRUNK_HIGHLIGHT_TRIANGLES = 2;
    const CROWN_ELLIPSE_TRIANGLES = 6; // 8-corner fan: 8 - 2
    const CROWN_ELLIPSES_PER_TREE = 5; // 3 dark lobes + 2 highlights
    const TRIANGLES_PER_TREE =
      TRUNK_QUAD_TRIANGLES + TRUNK_HIGHLIGHT_TRIANGLES + CROWN_ELLIPSE_TRIANGLES * CROWN_ELLIPSES_PER_TREE;
    const SHADOW_TRIANGLES = 2;

    it('draws one tree below the threshold', () => {
      const m = buildGroves(groveAt(1, 1, SINGLE_X, SINGLE_Y), TONES, '#14150F');
      expect(m.indices.length).toBe((SHADOW_TRIANGLES + TRIANGLES_PER_TREE) * 3);
    });

    it('draws two trees above the threshold', () => {
      const w = TWIN_X + 1;
      const m = buildGroves(groveAt(w, 1, TWIN_X, TWIN_Y), TONES, '#14150F');
      expect(m.indices.length).toBe((SHADOW_TRIANGLES + 2 * TRIANGLES_PER_TREE) * 3);
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

  describe('the inter-lobe epsilon layering', () => {
    // Every quad of one tree is coplanar (right/up are both literal world
    // axes shared by the whole tree), so wherever two layers' polygons
    // genuinely overlap in screen space they are, before the epsilon, an
    // EXACT depth tie -- the ordering below is the only thing that resolves
    // it, in either paint-order direction. A future edit that reorders or
    // collapses these constants would make some layer render behind one it
    // should cover, silently -- this asserts the ordering directly rather
    // than trusting the module doc comment that describes it.
    it('is strictly increasing, in Pixi paint order', () => {
      expect(TRUNK_EPSILON).toBeLessThan(TRUNK_LIT_EPSILON);
      expect(TRUNK_LIT_EPSILON).toBeLessThan(CROWN_EPSILON);
      expect(CROWN_EPSILON).toBeLessThan(CROWN_MID_EPSILON);
      expect(CROWN_MID_EPSILON).toBeLessThan(CROWN_LIT_EPSILON);
    });

    it('is large enough to break a coplanar tie, and small enough not to read as floating apart', () => {
      // Converted to screen-pixel-equivalent rise (divide by
      // WORLD_Y_PER_LIFT_PIXEL): every epsilon here should be a real,
      // non-zero nudge -- 0.05px is comfortably above float32 noise at this
      // scale, so a value that rounds away to nothing would fail this --
      // and stay well clear of 2px, the reviewer's own measured ceiling
      // (~1.6px for CROWN_LIT_EPSILON) with headroom: a nudge anywhere near
      // a real lobe's own extent (several px) would read as the layers
      // visibly pulling apart rather than a hairline depth fix.
      const MIN_SCREEN_PX = 0.05;
      const MAX_SCREEN_PX = 2;
      for (const epsilon of [TRUNK_EPSILON, TRUNK_LIT_EPSILON, CROWN_EPSILON, CROWN_MID_EPSILON, CROWN_LIT_EPSILON]) {
        const screenPx = epsilon / WORLD_Y_PER_LIFT_PIXEL;
        expect(screenPx).toBeGreaterThan(MIN_SCREEN_PX);
        expect(screenPx).toBeLessThan(MAX_SCREEN_PX);
      }
    });
  });
});
