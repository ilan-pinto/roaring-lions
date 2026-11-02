/**
 * The ground and scatter of a large map, cut into chunks (`terrain/chunks.ts`), against the
 * whole-map build they are cut from.
 *
 * A chunk is a range of tiles copied float for float out of the whole build, so the claim worth
 * testing is exactly that, on real maps: every chunk is the bytes of its tiles; the two sides of
 * every chunk edge agree on the ground they both draw (the seam); and after a real building
 * collapse, the spliced build cut into chunks equals a full build cut into chunks, with only the
 * chunks the splice touched having changed.
 *
 * The maps: Rujm Sawda (the 80x80 map the game chunks), and four 48x48 relief maps forced into a
 * grid (`wholeUpTo` 0, 16- and 20-tile edges that do NOT divide 48, so partial chunks are
 * exercised) because they carry what Rujm does not: terraces, cliffs, ridges, the full terrain
 * alphabet. A seam that opened only on a cliff would pass on Rujm alone.
 *
 * Mutations run against this file are listed in the commit message and the ledger: each makes it go
 * red, which is the only evidence the checks can fail.
 */
import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { maps, parseMap, applyTerrain, structures as structureCatalogue, paletteColor, type MapId, type MapJson } from '@lions/data';
import { composeTerrainFrom, type ComposedTerrainBuild } from '@lions/render/three';
import {
  CHUNKED_ABOVE_TILES,
  CHUNK_EDGE_TILES,
  WALL_ALBEDO_TOP,
  chunkCount,
  chunkGridFor,
  chunkOfPoint,
  chunkOfTile,
  chunkTiles,
  chunksTouching,
  sliceChunk,
  type ChunkGrid,
  type MeshData,
  type TiledMeshData,
} from '@lions/render/terrain';
import { rendererOptionsFor } from './renderer-options';

const HIGH = { colorVision: 'default', quality: 'high' } as const;
const BACKGROUND = paletteColor('shadow.1');

interface Rig {
  readonly sim: Sim;
  build(prev: ComposedTerrainBuild | null): ComposedTerrainBuild;
}

function rig(source: MapId | MapJson): Rig {
  const id = typeof source === 'string' ? source : source.id;
  const parsed = parseMap(typeof source === 'string' ? maps[source] : source);
  const sim = new Sim({ seed: 20261101, width: parsed.width, height: parsed.height, capacity: 64 });
  applyTerrain(parsed, sim);
  const typeIdx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) {
    typeIdx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of parsed.structures) {
    const t = typeIdx.get(b.type);
    if (t === undefined) throw new Error(`map ${id}: unknown structure type ${b.type}`);
    sim.addStructure(t, b.tiles);
  }
  const tones = rendererOptionsFor(parsed, HIGH, '/').terrainTones;
  return {
    sim,
    build: (prev) =>
      composeTerrainFrom(prev?.state ?? null, sim, parsed.decor, parsed.elevation, () => true, tones, paletteColor, BACKGROUND, null, false),
  };
}

const ATTRS = ['positions', 'colors', 'normals', 'wallAlbedo', 'groundUv'] as const;
const SIZE: Record<(typeof ATTRS)[number], number> = { positions: 3, colors: 3, normals: 3, wallAlbedo: 1, groundUv: 2 };

/** The raw bytes of `a[from, to)` of a Float32Array. */
function bytesOf(a: Float32Array, from: number, to: number): Buffer {
  return Buffer.from(a.buffer, a.byteOffset + from * 4, (to - from) * 4);
}

/**
 * Every tile of every chunk, against the same tile in the whole build: its vertex floats byte for
 * byte and its indices as offsets from its own first vertex. Returns the tiles compared.
 */
function comparePartition(whole: TiledMeshData, grid: ChunkGrid, label: string): number {
  let tiles = 0;
  let vertices = 0;
  for (let c = 0; c < chunkCount(grid); c++) {
    const chunk = sliceChunk(whole, grid, c);
    const { x0, y0, x1, y1 } = chunkTiles(grid, c);
    if (chunk === null) {
      // A chunk that draws nothing must own no vertices.
      for (let y = y0; y < y1; y++) {
        expect(whole.vertexStart[y * grid.width + x1] - whole.vertexStart[y * grid.width + x0], `${label} chunk ${c} empty`).toBe(0);
      }
      continue;
    }
    let at = 0; // vertices walked so far in the chunk
    let idx = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const t = y * grid.width + x;
        const v0 = whole.vertexStart[t];
        const n = whole.vertexStart[t + 1] - v0;
        for (const name of ATTRS) {
          const src = whole.mesh[name];
          if (src === undefined) {
            expect(chunk[name], `${label} chunk ${c} ${name}`).toBeUndefined();
            continue;
          }
          const dst = chunk[name] as Float32Array;
          const s = SIZE[name];
          expect(
            Buffer.compare(bytesOf(dst, at * s, (at + n) * s), bytesOf(src, v0 * s, (v0 + n) * s)),
            `${label} chunk ${c} tile (${x},${y}) ${name}`
          ).toBe(0);
        }
        const i0 = whole.indexStart[t];
        const m = whole.indexStart[t + 1] - i0;
        for (let k = 0; k < m; k++) {
          // the tile's index, as an offset from the tile's first vertex, is the same in both
          expect(chunk.indices[idx + k] - at, `${label} chunk ${c} tile (${x},${y}) index ${k}`).toBe(whole.mesh.indices[i0 + k] - v0);
        }
        at += n;
        idx += m;
        tiles++;
      }
    }
    expect(at, `${label} chunk ${c} vertex count`).toBe(chunk.positions.length / 3);
    expect(idx, `${label} chunk ${c} index count`).toBe(chunk.indices.length);
    vertices += at;
  }
  expect(vertices, `${label}: the chunks hold every vertex of the whole build`).toBe(whole.mesh.positions.length / 3);
  expect(tiles, `${label}: every tile belongs to exactly one chunk`).toBe(grid.width * grid.height);
  return tiles;
}

/**
 * The seam: across every chunk edge, a surface vertex that lies strictly inside a tile row (a
 * fractional coordinate along the edge) and has SMOOTH ground on both sides (neither tile is a
 * terrace: a terrace is a real height step, drawn as one in the whole-map build too) must exist on
 * both sides with the same height and the same normal, byte for byte. Returns how many shared
 * vertices were compared, so a map where nothing is shared cannot pass for free.
 */
function compareSeams(whole: TiledMeshData, terrace: Uint8Array, grid: ChunkGrid, label: string): number {
  let shared = 0;
  const surfaceRecords = (m: MeshData, axis: 0 | 2, line: number): Map<number, string[]> => {
    const out = new Map<number, string[]>();
    const n = m.positions.length / 3;
    const wall = m.wallAlbedo as Float32Array;
    const normals = m.normals as Float32Array;
    for (let i = 0; i < n; i++) {
      if (m.positions[i * 3 + axis] !== line) continue;
      if (wall[i] !== WALL_ALBEDO_TOP) continue;
      const along = m.positions[i * 3 + (axis === 0 ? 2 : 0)];
      if (Number.isInteger(along)) continue; // a tile corner: two tile rows meet here
      const rec = `${bytesOf(m.positions, i * 3 + 1, i * 3 + 2).toString('hex')}|${bytesOf(normals, i * 3, i * 3 + 3).toString('hex')}`;
      const list = out.get(along);
      if (list === undefined) out.set(along, [rec]);
      else list.push(rec);
    }
    return out;
  };
  for (let c = 0; c < chunkCount(grid); c++) {
    const cx = c % grid.cols;
    const cy = (c - cx) / grid.cols;
    const a = sliceChunk(whole, grid, c);
    if (a === null) continue;
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ] as const) {
      if (cx + dx >= grid.cols || cy + dy >= grid.rows) continue;
      const b = sliceChunk(whole, grid, (cy + dy) * grid.cols + cx + dx);
      if (b === null) continue;
      const axis = dx === 1 ? 0 : 2;
      const line = dx === 1 ? chunkTiles(grid, c).x1 : chunkTiles(grid, c).y1;
      const left = surfaceRecords(a, axis, line);
      const right = surfaceRecords(b, axis, line);
      for (const [along, recs] of left) {
        const mate = right.get(along);
        if (mate === undefined) continue;
        const row = Math.floor(along);
        const t0 = axis === 0 ? row * grid.width + (line - 1) : (line - 1) * grid.width + row;
        const t1 = axis === 0 ? row * grid.width + line : line * grid.width + row;
        if (terrace[t0] !== 0 || terrace[t1] !== 0) continue;
        expect(new Set(mate), `${label}: chunks ${c} and ${(cy + dy) * grid.cols + cx + dx} disagree at ${axis === 0 ? 'x' : 'z'}=${line}, ${axis === 0 ? 'z' : 'x'}=${along}`).toEqual(new Set(recs));
        shared++;
      }
    }
  }
  return shared;
}

describe('which maps are chunked', () => {
  it('every layer leaves a 48x48 map whole, which is what keeps the golden baselines still', () => {
    for (const layer of ['ground', 'ditch'] as const) {
      expect(chunkGridFor(48, 48, layer), layer).toBeNull();
      expect(chunkGridFor(40, 57, layer), `${layer}: 2280 tiles is under the line`).toBeNull();
    }
    expect(CHUNKED_ABOVE_TILES).toBe(48 * 48);
  });

  it('is by area: one tile over the line is chunked, and so is Rujm Sawda', () => {
    expect(chunkGridFor(49, 48, 'ground')).not.toBeNull();
    const rujm = chunkGridFor(80, 80, 'ground') as ChunkGrid;
    expect(rujm.edge).toBe(CHUNK_EDGE_TILES.ground);
    expect([rujm.cols, rujm.rows]).toEqual([3, 3]);
    expect((chunkGridFor(80, 80, 'ditch') as ChunkGrid).cols).toBe(10);
  });

  it('files a tile and a point into the same chunk, clamps a point off the map, and rejects a fractional edge', () => {
    const g = chunkGridFor(80, 80, 'ground', 16) as ChunkGrid;
    expect(chunkOfTile(g, 0, 0)).toBe(0);
    expect(chunkOfTile(g, 79, 79)).toBe(24);
    expect(chunkOfTile(g, 16, 0)).toBe(1);
    expect(chunkOfPoint(g, 15.99, 0.2)).toBe(0);
    expect(chunkOfPoint(g, 16, 0.2)).toBe(1);
    expect(chunkOfPoint(g, 80.4, -0.3)).toBe(4);
    expect(() => chunkGridFor(80, 80, 'ground', 2.5)).toThrow();
  });
});

describe('which chunks a dirty tile touches', () => {
  it('a single marked tile touches exactly its own chunk, wherever in the chunk it stands', () => {
    // 80 is not a multiple of 12, so the last row and column of chunks are partial.
    const g = chunkGridFor(80, 80, 'ground', 12) as ChunkGrid;
    for (let c = 0; c < chunkCount(g); c++) {
      const { x0, y0, x1, y1 } = chunkTiles(g, c);
      for (const [x, y] of [
        [x0, y0],
        [x1 - 1, y0],
        [x0, y1 - 1],
        [x1 - 1, y1 - 1],
        [x1 - 1, Math.floor((y0 + y1) / 2)],
      ] as const) {
        const mask = new Uint8Array(80 * 80);
        mask[y * 80 + x] = 1;
        expect(chunksTouching(g, mask), `tile (${x},${y}) of chunk ${c}`).toEqual([c]);
      }
    }
    expect(chunksTouching(g, new Uint8Array(80 * 80))).toEqual([]);
    expect(() => chunksTouching(g, new Uint8Array(10))).toThrow();
  });
});

describe('a chunk is the bytes of its tiles in the whole-map build', () => {
  // [map, edge, wholeUpTo]: Rujm at the game's own edges, the relief maps forced and uneven.
  const CASES: { id: MapId; edge: number; label: string }[] = [
    { id: 'rujm_sawda', edge: CHUNK_EDGE_TILES.ground, label: 'rujm_sawda at the ground edge' },
    { id: 'rujm_sawda', edge: 16, label: 'rujm_sawda at 16' },
    { id: 'wadi_tarfan_l', edge: CHUNK_EDGE_TILES.ground, label: 'wadi_tarfan_l (96x96, a 3x3 grid) at the ground edge' },
    { id: 'qarn_hadid', edge: 20, label: 'qarn_hadid (all ten terrain symbols) at 20' },
    { id: 'tel_marum', edge: 16, label: 'tel_marum (boulders) at 16' },
    { id: 'beit_sahwan_2', edge: 20, label: 'beit_sahwan_2 (relief under a town) at 20' },
    { id: 'umm_zeitoun_4', edge: 16, label: 'umm_zeitoun_4 (relief) at 16' },
  ];

  for (const c of CASES) {
    it(`${c.label}: ground and scatter partition exactly, and the seams agree`, () => {
      const build = rig(c.id).build(null);
      const grid = chunkGridFor(build.composed.input.width, build.composed.input.height, 'ground', c.edge, 0) as ChunkGrid;
      comparePartition(build.state.ground, grid, `${c.id} ground`);
      comparePartition(build.state.scatter, grid, `${c.id} scatter`);
      // Non-vacuous: a real number of surface vertices sit on both sides of a chunk edge.
      const shared = compareSeams(build.state.ground, build.state.surface.terrace, grid, `${c.id} ground`);
      expect(shared, `${c.id}: vertices compared across chunk edges`).toBeGreaterThan(grid.cols * grid.rows);
    }, 60_000);
  }
});

/** `rujm_sawda` with two houses a map apart: collapsible, and in different chunks. */
function rujmWithHouses(): MapJson {
  const base = maps.rujm_sawda as MapJson;
  const rows = base.rows.map((r) => r.split(''));
  for (const [x, y] of [
    [26, 28],
    [27, 28],
    [58, 56],
    [59, 56],
  ] as const) rows[y][x] = 'h';
  return { ...base, id: 'rujm_sawda_houses', rows: rows.map((r) => r.join('')) };
}

describe('a collapse touches only the chunks it re-emitted', () => {
  it('rujm_sawda: the spliced build cut into chunks is the full build cut into chunks, and only touched chunks changed', () => {
    const json = rujmWithHouses();
    // The two houses are the structures standing on the tiles stamped above (Rujm has walls of its own).
    const structures = parseMap(json).structures;
    const houses = [26, 58].map((x) => structures.findIndex((st) => st.type === 'house' && st.tiles.some((t) => t % 80 === x)));
    expect(houses.every((i) => i >= 0), 'both stamped houses are structures').toBe(true);
    const r = rig(json);
    const before = r.build(null);
    const grid = chunkGridFor(80, 80, 'ground') as ChunkGrid;
    const total = chunkCount(grid);

    let current = before;
    for (const s of houses) {
      expect(r.sim.structures.alive[s], `structure ${s} stands before the shot`).toBe(1);
      r.sim.debugDestroyStructure(s);
      const previous = current;
      const spliced = r.build(previous);
      current = spliced;
      const full = r.build(null);
      expect(spliced.dirtyTiles, 'a splice reports the tiles it re-emitted').not.toBeNull();
      expect(full.dirtyTiles, 'a full build reports none').toBeNull();
      const touched = new Set(chunksTouching(grid, spliced.dirtyTiles as Uint8Array));
      expect(touched.size, `structure ${s}: the splice is local`).toBeGreaterThan(0);
      expect(touched.size, `structure ${s}: the splice is local`).toBeLessThan(total);

      for (const [layer, was, now, fresh] of [
        ['ground', previous.state.ground, spliced.state.ground, full.state.ground],
        ['scatter', previous.state.scatter, spliced.state.scatter, full.state.scatter],
      ] as const) {
        const changed: number[] = [];
        for (let c = 0; c < total; c++) {
          const a = sliceChunk(was, grid, c);
          const b = sliceChunk(now, grid, c);
          const f = sliceChunk(fresh, grid, c);
          expect(same(b, f), `structure ${s} ${layer}: chunk ${c} of the splice equals the full build`).toBe(true);
          if (!same(a, b)) changed.push(c);
        }
        expect(changed.length, `structure ${s} ${layer}: the collapse changed something`).toBeGreaterThan(0);
        // The property ChunkedMeshLayer.update leans on: a chunk the splice did not touch is the
        // bytes it was, so leaving its mesh alone is exact.
        for (const c of changed) expect(touched.has(c), `structure ${s} ${layer}: chunk ${c} changed but was not touched`).toBe(true);
      }
    }
  }, 120_000);
});

function same(a: MeshData | null, b: MeshData | null): boolean {
  if (a === null || b === null) return a === b;
  for (const name of ['positions', 'colors', 'normals', 'wallAlbedo', 'groundUv'] as const) {
    const x = a[name];
    const y = b[name];
    if (x === undefined || y === undefined) {
      if (x !== y) return false;
      continue;
    }
    if (Buffer.compare(bytesOf(x, 0, x.length), bytesOf(y, 0, y.length)) !== 0) return false;
  }
  return a.indices.length === b.indices.length && a.indices.every((v, i) => v === b.indices[i]);
}
