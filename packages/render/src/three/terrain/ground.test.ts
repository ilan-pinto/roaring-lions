/**
 * The ground mesh is where the palette guarantee either holds across the whole
 * screen or quietly stops applying. These tests assert it directly.
 */
import { describe, it, expect } from 'vitest';
import { buildGround, WORLD_PER_LEVEL } from './ground';
import { PALETTE_HEXES } from './tones';
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
    const input = flat(2, 2);
    const m = buildGround(input, TONES, '#14150F');
    let maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      maxX = Math.max(maxX, m.positions[i]);
      maxZ = Math.max(maxZ, m.positions[i + 2]);
    }
    expect(maxX).toBeCloseTo(2, 10);
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
    const a = buildGround(flat(6, 6), TONES, '#14150F');
    const b = buildGround(flat(6, 6), TONES, '#14150F');
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
  });
});
