/**
 * The ground mesh is where the palette guarantee either holds across the whole
 * screen or quietly stops applying. These tests assert it directly.
 */
import { describe, it, expect } from 'vitest';
import { buildGround } from './ground';
import { WORLD_PER_LEVEL } from './shared';
import { PALETTE_HEXES } from './tones';
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

describe('buildGround', () => {
  it('emits two triangles per tile on flat ground', () => {
    const m = buildGround(flat(4, 4), TONES, '#14150F');
    expect(m.indices.length).toBe(4 * 4 * 6);
  });

  it('every vertex colour is a palette entry', () => {
    // The guarantee. Phase 0 proved a LUT makes off-palette output
    // unrepresentable for shaded geometry; this is the equivalent claim for
    // terrain, which is unlit and carries its colour per vertex.
    //
    // Elevation varies here on purpose: flat ground alone never emits a side
    // face (drop is 0 in every direction), so a flat-only grid cannot see a
    // quantise skipped on a face colour -- it would exercise only the top
    // quad's tone and pass regardless. A stair pattern guarantees both the
    // x+1 and y+1 comparisons produce positive drops somewhere on the grid.
    const input = flat(8, 8);
    input.elevation = new Uint8Array(8 * 8).map((_, ti) => ((ti % 8) + Math.floor(ti / 8)) % 6);
    const m = buildGround(input, TONES, '#14150F');
    const entries = new Set(PALETTE_HEXES.map((h) => h.toUpperCase()));
    for (let i = 0; i < m.colors.length; i += 3) {
      const hex =
        '#' +
        [0, 1, 2]
          .map((k) => Math.round(m.colors[i + k] * 255).toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase();
      expect(entries).toContain(hex);
    }
  });

  it('litColors matches colors in length and vertex order, and is ALSO always a palette entry', () => {
    // The muzzle-flash ramp-shift effect (`../palette-material.ts`'s "The
    // muzzle-flash 'light'" doc comment) swaps a fragment's colour for
    // `litColors` wholesale, never blends the two -- so `litColors` has to
    // carry the SAME on-palette guarantee `colors` does, proven the same
    // direct way, not merely argued from `rampNeighbor` only ever returning
    // a ramp member (or its input unchanged).
    const input = flat(8, 8);
    input.elevation = new Uint8Array(8 * 8).map((_, ti) => ((ti % 8) + Math.floor(ti / 8)) % 6);
    const m = buildGround(input, TONES, '#14150F');
    expect(m.litColors).toBeDefined();
    expect(m.litColors!.length).toBe(m.colors.length);
    const entries = new Set(PALETTE_HEXES.map((h) => h.toUpperCase()));
    for (let i = 0; i < m.litColors!.length; i += 3) {
      const hex =
        '#' +
        [0, 1, 2]
          .map((k) => Math.round(m.litColors![i + k] * 255).toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase();
      expect(entries).toContain(hex);
    }
  });

  it('litColors is never DARKER than colors at the same vertex -- the "lit" step is a step TOWARD index 0, never away from it', () => {
    // Guards the actual direction, not just palette membership: a regression
    // that fed rampNeighbor a positive-but-wrong sign, or looked up the wrong
    // ramp, could still land on a valid palette entry while getting brighter
    // and darker backwards -- exactly the "index 0 is the LIGHTEST step"
    // mistake `palette-material.ts` warns has already cost three renders.
    // Luminance (perceptual weights, matching common practice) is a coarse
    // proxy for "brighter", but it is directionally reliable for the specific
    // tone/ramp pairs this map's TONES use, and every one of them is checked.
    const input = flat(8, 8);
    input.elevation = new Uint8Array(8 * 8).map((_, ti) => ((ti % 8) + Math.floor(ti / 8)) % 6);
    const m = buildGround(input, TONES, '#14150F');
    const luminance = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    for (let i = 0; i < m.colors.length; i += 3) {
      const base = luminance(m.colors[i], m.colors[i + 1], m.colors[i + 2]);
      const lit = luminance(m.litColors![i], m.litColors![i + 1], m.litColors![i + 2]);
      expect(lit).toBeGreaterThanOrEqual(base - 1e-6);
    }
  });

  it('puts a tile at the height its elevation says', () => {
    const input = flat(2, 1);
    input.elevation = new Uint8Array([0, 3]);
    const m = buildGround(input, TONES, '#14150F');
    let maxY = -Infinity;
    for (let i = 1; i < m.positions.length; i += 3) maxY = Math.max(maxY, m.positions[i]);
    // Precision 5, not 10: `MeshData.positions` is a Float32Array (fixed by
    // B2.2's shared types), and WORLD_PER_LEVEL is irrational (it runs
    // through sqrt2/tan), so round-tripping it through a 32-bit float loses
    // precision past ~7 decimal digits. Asking for 10 fails on every run
    // regardless of correctness; 5 still catches a wrong constant or a wrong
    // multiplication by a wide margin.
    expect(maxY).toBeCloseTo(3 * WORLD_PER_LEVEL, 5);
  });

  it('maps game (x, y) to three (x, height, y)', () => {
    // The world-space convention every later sub-plan depends on. If this
    // flips, terrain and units disagree about which way south is.
    //
    // A square grid cannot catch a transposed axis -- maxX and maxZ come out
    // 2 either way, swapped or not. width != height so a [y, topY, x] swap
    // is visible as a swapped bound, not silently absorbed by symmetry.
    const input = flat(3, 2);
    const m = buildGround(input, TONES, '#14150F');
    let maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      maxX = Math.max(maxX, m.positions[i]);
      maxZ = Math.max(maxZ, m.positions[i + 2]);
    }
    expect(maxX).toBeCloseTo(3, 10);
    expect(maxZ).toBeCloseTo(2, 10);
  });

  it('adds a side face only where a neighbour is lower', () => {
    // Two tiles at the same height share an internal edge with nothing to show.
    // Pixi sizes each face to the DROP for exactly this reason -- sizing off
    // absolute height drew a wall along the shared edge and left a visible
    // crack across what should read as one continuous slope.
    //
    // Isolated on a grid big enough that the compared tile and everything
    // that reads its elevation sit away from the map edge: a bare 2x1 strip
    // makes the *changed* tile a rim tile on two more sides at once, and
    // dropping it to ground level removes its own rim faces on those sides
    // faster than the one new internal face is gained, backwards from the
    // property under test. Here every tile but one holds elevation 2 --
    // including the neighbours the varying tile's own east/south checks
    // read, so it never draws a wall regardless of its own height -- and the
    // lone tile at (2, 1) is the only thing that changes between the two
    // grids.
    const w = 4, h = 3;
    const varyAt = 1 * w + 2; // tile (2, 1): interior on every side
    const level = flat(w, h);
    level.elevation = new Uint8Array(w * h).fill(2);
    const stepped = flat(w, h);
    stepped.elevation = new Uint8Array(w * h).fill(2);
    stepped.elevation[varyAt] = 0;
    expect(buildGround(stepped, TONES, '#14150F').indices.length).toBeGreaterThan(
      buildGround(level, TONES, '#14150F').indices.length
    );
  });

  it('treats off-map as elevation zero, so a rim tile shows its full face', () => {
    const rim = flat(1, 1);
    rim.elevation = new Uint8Array([4]);
    const m = buildGround(rim, TONES, '#14150F');
    expect(m.indices.length).toBeGreaterThan(6);
  });

  it('is deterministic', () => {
    // Flat ground alone never emits a side face, so comparing colors only
    // on flat(6, 6) never exercises positions, indices, or a single face
    // quad. A stair-step grid puts all three quad types, and their vertex
    // counts, in scope.
    const stair = (): TerrainInput => {
      const input = flat(6, 6);
      input.elevation = new Uint8Array(6 * 6).map((_, ti) => ((ti % 6) + Math.floor(ti / 6)) % 5);
      return input;
    };
    const a = buildGround(stair(), TONES, '#14150F');
    const b = buildGround(stair(), TONES, '#14150F');
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
  });

  it('every triangle winds toward the camera', () => {
    // MeshBasicMaterial defaults to FrontSide, so a wrong winding does not
    // render dark -- it renders as nothing, a hole in the map that reads as
    // missing geometry rather than a lighting bug. VIEW_DIRECTION (target
    // -> camera) is fixed and always points +X/+Y/+Z, so every triangle's
    // (b - a) x (c - a) must have a positive dot with it, tile top, east
    // face, and south face alike. Purely a MeshData property -- no THREE.Mesh,
    // no GL context, exactly what makes terrain testable under
    // environment: 'node' at all.
    const input = flat(6, 6);
    input.elevation = new Uint8Array(6 * 6).map((_, ti) => ((ti % 6) + Math.floor(ti / 6)) % 5);
    const m = buildGround(input, TONES, '#14150F');
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
    // Classified from the triangle's own vertices, not from buildGround's
    // internals: a tile top has all three vertices at the same world Y: an
    // east face, the same world X; a south face, the same world Z. Purely
    // so a failure names which of the three quad kinds broke, rather than
    // just an index into a flat array.
    const kindOf = (a: [number, number, number], b: [number, number, number], c: [number, number, number]): string => {
      if (a[1] === b[1] && b[1] === c[1]) return 'tile top';
      if (a[0] === b[0] && b[0] === c[0]) return 'east face';
      if (a[2] === b[2] && b[2] === c[2]) return 'south face';
      return 'unrecognised quad';
    };
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = at(m.indices[i]);
      const b = at(m.indices[i + 1]);
      const c = at(m.indices[i + 2]);
      const normal = cross(sub(b, a), sub(c, a));
      const d = dot(normal, [VIEW_DIRECTION.x, VIEW_DIRECTION.y, VIEW_DIRECTION.z]);
      expect(d, `${kindOf(a, b, c)} at triangle ${i / 3} (indices ${i}-${i + 2}) winds away from the camera`).toBeGreaterThan(0);
    }
  });

  it('reaches every groundTone branch: open, road, cover, blocked, ridge', () => {
    // tones.test.ts has no groundTone cases at all, and the palette test
    // above uses blocked/cover all zero with decor: null -- only the open
    // branch. Every branch ends in one quantise() call so the risk is low,
    // but "low risk because I read the code" is exactly the shape of the
    // last two holes.
    //
    // groundTone (tones.ts) does not currently branch on `cover` at all --
    // read to confirm before writing this -- so the cover tile below routes
    // through the same open-ground branch as an uncovered one. It stays in
    // the map anyway: TerrainInput.cover is real per-tile game data
    // (packages/data's cover levels), and this is the map buildGround gets
    // handed in practice, not a hand-trimmed one that happens to dodge an
    // unused field.
    const w = 5, h = 1;
    const input: TerrainInput = {
      width: w,
      height: h,
      decor: new Uint8Array([0, 1, 0, 0, 4]), // open, road, open(cover), open, ridge
      elevation: null,
      blocked: new Uint8Array([0, 0, 0, 1, 1]), // ..., blocked(no decor), blocked+ridge
      cover: new Uint8Array([0, 0, 1, 0, 0]),
    };
    const m = buildGround(input, TONES, '#14150F');
    const entries = new Set(PALETTE_HEXES.map((h2) => h2.toUpperCase()));
    for (let i = 0; i < m.colors.length; i += 3) {
      const hex =
        '#' +
        [0, 1, 2]
          .map((k) => Math.round(m.colors[i + k] * 255).toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase();
      expect(entries).toContain(hex);
    }
  });
});
