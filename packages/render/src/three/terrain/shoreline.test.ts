/**
 * The marsh's ragged shoreline (GH-871 P2 S-6): the marsh floor's tone must
 * cross a tile edge as a wandering soft band, not a tile staircase, without
 * ever lapping a causeway, a ridge or a building, and without touching a map
 * or a theme that has no marsh. Every oracle is a literal.
 */
import { describe, it, expect } from 'vitest';
import { marshWeightAt, mixTones, shoreTileMask } from './shoreline';
import { buildGround, buildGroundTiled, spliceGround } from './ground';
import { buildTerrainSurface } from './surface';
import { changedTerrainTiles, spliceMask, terrainBuildState, SPLICE_RADIUS_TILES } from './incremental';
import { SURFACE_SUBDIVISIONS } from './surface';
import type { MeshData, TerrainInput } from './types';
import type { TerrainTones } from '../../api';

// The wetland's tones as LITERALS (fen.0, mud.1, mud.2, shadow.0 ...), with the
// theme's own palette ramps: the endpoints below are what `groundTone` yields.
const WET: TerrainTones = {
  open: '#7F9F57', cover: ['#4F6732', '#3E5C2E', '#2E4421'],
  blocked: '#656B70', underBuilding: '#23241F', road: '#725944', rut: '#413327',
  rock: '#4A4F54', rockLit: '#656B70', earth: '#584535', low: '#4F6732',
  trunk: '#413327', trunkLit: '#584535', leafDark: '#2E4421', leafMid: '#3E5C2E',
  leafLit: '#7F9F57', bladeLit: '#9FB26A', bladeShade: '#4F6732', spoil: '#413327',
  crownRatio: 0.8, scatter: 'sward', groveFamily: 'oak', haze: '#C4C8C9',
  paletteRamps: ['fen', 'mud', 'overcast'], marsh: '#584535',
};
const NO_MARSH: TerrainTones = { ...WET, marsh: undefined };
const BACKGROUND = '#14150F';
// What the two ends of the blend are on screen, as bytes: the open fen and the marsh mud.
const FEN = [127, 159, 87];
const MUD = [88, 69, 53];

const MARSH = 6;
const ROAD = 1;

function grid(w: number, h: number, decorAt: (x: number, y: number) => number, blockedAt: (x: number, y: number) => number = () => 0): TerrainInput {
  const decor = new Uint8Array(w * h);
  const blocked = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      decor[y * w + x] = decorAt(x, y);
      blocked[y * w + x] = blockedAt(x, y);
    }
  }
  return { width: w, height: h, decor, elevation: null, blocked, cover: new Uint8Array(w * h) };
}

/** Marsh on the left half (tiles 0..7), fen on the right: a straight vertical boundary on the tile edge x = 8. */
function straightShore(): TerrainInput {
  return grid(16, 24, (x) => (x < 8 ? MARSH : 0));
}

function bytes(m: MeshData, i: number): number[] {
  return [0, 1, 2].map((k) => Math.round(m.colors[i * 3 + k] * 255));
}

describe('the marsh weight across a straight tile edge', () => {
  const input = straightShore();
  const rows: number[] = [];
  for (let z = 3; z <= 21; z += 0.5) rows.push(z);

  /** First x, scanning east from 6.5, where the weight drops under one half. */
  function midpoint(z: number): number {
    for (let x = 6.5; x <= 9.5; x += 0.01) if (marshWeightAt(input, x, z, x < 8) < 0.5) return x;
    return NaN;
  }

  it('takes intermediate values within half a tile of the edge, on every row (not a step)', () => {
    let total = 0;
    let fewest = Infinity;
    for (const z of rows) {
      let n = 0;
      for (let x = 7.5; x <= 8.5; x += 0.01) {
        const w = marshWeightAt(input, x, z, x < 8);
        if (w > 0.05 && w < 0.95) n++;
      }
      total += n;
      fewest = Math.min(fewest, n);
    }
    // Measured: 1556 samples in all, at least ~30 on the thinnest row; a hard edge reads 0.
    expect(total).toBeGreaterThan(1000);
    expect(fewest).toBeGreaterThanOrEqual(15);
  });

  it('puts the boundary at a different place on different rows (ragged, not a straight blur)', () => {
    const mids = rows.map(midpoint);
    expect(mids.every((m) => Number.isFinite(m))).toBe(true);
    // Measured: 7.71 .. 8.21 over 37 rows. A straight blur reads one value.
    expect(Math.max(...mids) - Math.min(...mids)).toBeGreaterThan(0.3);
    // and it is not one bump: many rows sit well off the tile edge on either side.
    expect(mids.filter((m) => m < 7.95).length).toBeGreaterThanOrEqual(8);
    expect(mids.filter((m) => m > 8.05).length).toBeGreaterThanOrEqual(8);
  });

  it('is exactly marsh from 0.7 of a tile inside the edge, and exactly fen from 0.8 of a tile past it', () => {
    for (let z = 3; z <= 21; z += 0.25) {
      for (let x = 6; x <= 7.3; x += 0.05) expect(marshWeightAt(input, x, z, true)).toBe(1);
      for (let x = 8.8; x <= 10; x += 0.05) expect(marshWeightAt(input, x, z, false)).toBe(0);
    }
    // the tone does cross the edge at all (a wetland path that ran): some fen-side point is above zero.
    let crossed = 0;
    for (let z = 3; z <= 21; z += 0.25) if (marshWeightAt(input, 8.2, z, false) > 0) crossed++;
    expect(crossed).toBeGreaterThan(10);
  });
});

describe('buildGround with a marsh tone', () => {
  const input = straightShore();
  const withMarsh = buildGround(input, WET, BACKGROUND);

  it('carries mixed vertex colours across the edge and the two plain tones either side', () => {
    let fen = 0;
    let mud = 0;
    let mixed = 0;
    for (let i = 0; i < withMarsh.colors.length / 3; i++) {
      const c = bytes(withMarsh, i);
      if (c.every((v, k) => v === FEN[k])) fen++;
      else if (c.every((v, k) => v === MUD[k])) mud++;
      else mixed++;
    }
    expect(fen).toBeGreaterThan(1000);
    expect(mud).toBeGreaterThan(1000);
    // Measured on this 16x24 map: a three-tile-wide fringe of 25-vertex patches.
    expect(mixed).toBeGreaterThan(150);
  });

  it('emits a 25-vertex patch for the fringe tiles and a plain quad elsewhere (flat map)', () => {
    const n = (SURFACE_SUBDIVISIONS + 1) ** 2;
    // Fringe: tiles x = 7 (marsh) and x = 8 (fen) on all 24 rows. The marsh interior and the far fen stay quads.
    const fringe = 24 * 2;
    expect(withMarsh.positions.length / 3).toBe(fringe * n + (16 * 24 - fringe) * 4);
  });

  it('keeps each shoreline tile seamless with its neighbour: shared edge vertices agree', () => {
    // vertices on x = 8 of tile 7 and of tile 8 are at the same point, so the same colour
    const at = new Map<string, string>();
    let pairs = 0;
    for (let i = 0; i < withMarsh.positions.length / 3; i++) {
      const x = withMarsh.positions[i * 3];
      const z = withMarsh.positions[i * 3 + 2];
      if (x !== 8) continue;
      const key = `${x},${z}`;
      const c = bytes(withMarsh, i).join(',');
      const prev = at.get(key);
      if (prev !== undefined) {
        expect(c).toBe(prev);
        pairs++;
      }
      at.set(key, c);
    }
    expect(pairs).toBeGreaterThan(50);
  });
});

describe('containment: a causeway, a ridge and a building are never lapped', () => {
  // marsh x 0..3; column x = 4 is a road on rows 0..5, a building pad on rows 6..11, plain fen on rows 12..17;
  // fen beyond. 10 wide, 18 tall.
  const input = grid(
    10,
    18,
    (x, y) => (x < 4 ? MARSH : x === 4 && y < 6 ? ROAD : 0),
    (x, y) => (x === 4 && y >= 6 && y < 12 ? 1 : 0)
  );
  const m = buildGround(input, WET, BACKGROUND);

  // The same map with the marsh turned to plain fen: no `~` tile, so the old path, the reference for what the
  // causeway and the pad look like when nothing is near them.
  const plain = buildGround(
    grid(
      10,
      18,
      (x, y) => (x === 4 && y < 6 ? ROAD : 0),
      (x, y) => (x === 4 && y >= 6 && y < 12 ? 1 : 0)
    ),
    WET,
    BACKGROUND
  );

  /** `x,z -> colour` for every vertex on the column-4 tiles' own side, x in (4, 5], rows 0..11. */
  function columnFour(g: MeshData): string[] {
    const out: string[] = [];
    for (let i = 0; i < g.positions.length / 3; i++) {
      const x = g.positions[i * 3];
      const z = g.positions[i * 3 + 2];
      if (x > 4 && x <= 5 && z >= 0 && z < 12) out.push(`${x},${z}:${bytes(g, i).join(',')}`);
    }
    return out.sort();
  }

  it('draws every road tile vertex and every building tile vertex exactly as with no marsh on the map', () => {
    const got = columnFour(m);
    // 12 tiles of quads (and plain tile 5's west corners on x = 5): none is a patch.
    expect(got.length).toBeGreaterThan(40);
    expect(got).toEqual(columnFour(plain));
    // and the road's vertices are the open fen, the pad's are not mud (they are their own tone)
    const fenOrPad = new Set(got.map((e) => e.split(':')[1]));
    expect(fenOrPad.has(MUD.join(','))).toBe(false);
    expect(fenOrPad.has(FEN.join(','))).toBe(true);
  });

  it('keeps a marsh tile at full mud right up to the causeway and the pad (no fen eats into it)', () => {
    // On x = 4 the vertices of marsh tile 3 and of the column-4 tile coincide: each is exactly mud (the marsh
    // tile's) or exactly a colour the column-4 tile has on its own, never a mix.
    const own = new Set(columnFour(plain).map((e) => e.split(':')[1]));
    let mud = 0;
    for (let i = 0; i < m.positions.length / 3; i++) {
      const x = m.positions[i * 3];
      const z = m.positions[i * 3 + 2];
      if (x !== 4 || z < 0 || z > 11.25) continue;
      const c = bytes(m, i).join(',');
      const isMud = c === MUD.join(',');
      expect(isMud || own.has(c), `(${x}, ${z}) is ${c}`).toBe(true);
      if (isMud) mud++;
    }
    // Rows 0..11 at a quarter-tile pitch, down to z = 11.25 (below that the fen row 12 is within reach, rightly).
    expect(mud).toBeGreaterThanOrEqual(46);
  });

  it('does not select a road or a pad tile as a shoreline tile', () => {
    const mask = shoreTileMask(input);
    expect(mask).not.toBeNull();
    for (let y = 0; y < 12; y++) expect(mask![y * 10 + 4]).toBe(0);
    // the plain fen below them is a shoreline tile (marsh on its west)
    expect(mask![14 * 10 + 4]).toBe(1);
    expect(mask![14 * 10 + 3]).toBe(1);
    // and a tile two away from any marsh is not
    expect(mask![14 * 10 + 6]).toBe(0);
  });
});

describe('inertness', () => {
  it('a map with no marsh tile builds the same mesh with a marsh tone as without (byte for byte)', () => {
    const plain = grid(12, 12, (x, y) => (x === 6 && y < 6 ? ROAD : 0));
    const a = buildGround(plain, WET, BACKGROUND);
    const b = buildGround(plain, NO_MARSH, BACKGROUND);
    expect(a.positions.length).toBe(12 * 12 * 4 * 3);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    expect(shoreTileMask(plain)).toBeNull();
  });

  it('a map WITH marsh tiles under a theme with no marsh tone draws no fringe: plain quads, open wash', () => {
    const input = straightShore();
    const m = buildGround(input, NO_MARSH, BACKGROUND);
    expect(m.positions.length / 3).toBe(16 * 24 * 4);
    for (let i = 0; i < m.colors.length / 3; i++) expect(bytes(m, i)).toEqual(FEN);
  });
});

describe('on a map with relief', () => {
  // A raised causeway column (level 1) across a marsh and fen map: every tile but the pad is a smooth patch.
  const w = 12;
  const h = 12;
  const input = grid(w, h, (x) => (x < 5 ? MARSH : x === 7 ? ROAD : 0));
  input.elevation = new Uint8Array(w * h).map((_, t) => (t % w === 7 ? 1 : 0));

  it('keeps the geometry exactly as it was: only the colours of the fringe differ', () => {
    const a = buildGround(input, WET, BACKGROUND);
    const b = buildGround(input, NO_MARSH, BACKGROUND);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    expect(Array.from(a.normals as Float32Array)).toEqual(Array.from((b.normals as Float32Array)));
    let differing = 0;
    for (let i = 0; i < a.colors.length; i++) if (a.colors[i] !== b.colors[i]) differing++;
    // The marsh interior (x < 4) is mud against fen: many; and the fringe is in there.
    expect(differing).toBeGreaterThan(500);
  });

  it('a splice around a collapse beside the marsh is byte-equal to a full build', () => {
    // A building pad at (5, 5) next to the marsh, then standing no more.
    const before = grid(w, h, (x) => (x < 5 ? MARSH : 0), (x, y) => (x === 5 && y === 5 ? 1 : 0));
    // `decor` and `elevation` are shared by reference, as a running mission shares them; only `blocked` changes.
    const after: TerrainInput = { ...before, blocked: new Uint8Array(w * h) };
    before.elevation = new Uint8Array(w * h).map((_, t) => (t % w >= 6 ? 1 : 0));
    after.elevation = before.elevation;
    const sBefore = buildTerrainSurface(before);
    const sAfter = buildTerrainSurface(after);
    const tiledBefore = buildGroundTiled(before, WET, BACKGROUND, sBefore);
    const scatterStub = tiledBefore; // the state wants a scatter mesh; only `ground` is read here
    const state = terrainBuildState(before, sBefore, tiledBefore, scatterStub, undefined as never);
    const changed = changedTerrainTiles(state, after, sAfter);
    expect(changed).not.toBeNull();
    expect(changed![5 * w + 5]).toBe(1);
    const dirty = spliceMask(changed!, w, h, SPLICE_RADIUS_TILES);
    const spliced = spliceGround(tiledBefore, dirty, after, WET, BACKGROUND, sAfter);
    const full = buildGround(after, WET, BACKGROUND);
    expect(Array.from(spliced.mesh.colors)).toEqual(Array.from(full.colors));
    expect(Array.from(spliced.mesh.positions)).toEqual(Array.from(full.positions));
  });
});

describe('mixTones', () => {
  it('returns each end as itself and the midpoint in between', () => {
    expect(mixTones([0.2, 0.4, 0.6], [0.4, 0.2, 0.0], 0)).toEqual([0.2, 0.4, 0.6]);
    expect(mixTones([0.2, 0.4, 0.6], [0.4, 0.2, 0.0], 1)).toEqual([0.4, 0.2, 0.0]);
    const mid = mixTones([0.2, 0.4, 0.6], [0.4, 0.2, 0.0], 0.5);
    expect(mid[0]).toBeCloseTo(0.3, 10);
    expect(mid[1]).toBeCloseTo(0.3, 10);
    expect(mid[2]).toBeCloseTo(0.3, 10);
  });
});
