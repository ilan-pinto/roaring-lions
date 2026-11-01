/**
 * What a chunked map actually SUBMITS, counted through three's own render lists (GH-913, GH-920).
 *
 * The census (`@lions/render/chunk-census`) runs the real `WebGLRenderer` on a fake GL over the real
 * map, the real decor and ditch GLBs, the renderer's own camera and shadow fit, and counts every
 * draw and triangle in the main, shadow and AO passes. It is the only thing in CI that can say a
 * chunk is being CULLED rather than merely existing: a chunked map whose chunks all survive the
 * frustum test draws exactly what the whole map did, plus more draw calls.
 *
 * Rujm Sawda (80x80) before this change: 19 draws and 22.9M triangles in every view, 96% of them the
 * ditch's (one InstancedMesh, never culled; 7.34M a pass). `perf:fx --breakdown` read the same
 * 23.2M in the browser, so the census and the GPU agree on what is submitted.
 *
 * The decor batches are NOT chunked, on purpose: they were, and the browser said no gain for +0.2 to
 * +1.8 ms (docs/agent-notes/terrain-rendering.md, "Chunks"). The census says why in this file's
 * terms: they walk the same 8,774 instances (both cameras) chunked or not.
 *
 * The budgets are the measured numbers with room: the point is the order of magnitude. The last test
 * is the falsification kept: the same census with the layers left whole must BLOW the budgets.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { maps, parseMap, applyTerrain, paletteColor, type MapId } from '@lions/data';
import { composeTerrainFrom, type ComposedTerrainBuild } from '@lions/render/three';
import { chunkGridFor, type ChunkLayer } from '@lions/render/terrain';
import { censusTerrain, decorSetFromGlbs, texturedSetFromGlbs, type CensusInput, type CensusRow, type CensusView } from '@lions/render/chunk-census';
import type { DecorGeometrySet, TexturedDecorSet } from '@lions/render/chunk-census';
import { rendererOptionsFor } from './renderer-options';

const DECOR = fileURLToPath(new URL('../../../art/meshes/decor/', import.meta.url));
const LAYERS: readonly ChunkLayer[] = ['ground', 'ditch'];

let decorSet: DecorGeometrySet;
let texturedSet: TexturedDecorSet;

beforeAll(async () => {
  const files = new Map<string, Uint8Array>();
  for (const f of readdirSync(DECOR)) if (f.endsWith('.glb')) files.set(f.replace('.glb', ''), readFileSync(DECOR + f));
  decorSet = await decorSetFromGlbs(files);
  texturedSet = await texturedSetFromGlbs(files);
}, 60_000);

function build(id: MapId): { input: Omit<CensusInput, 'edges'>; markers: Record<string, [number, number]>; whole: CensusInput['edges']; game: CensusInput['edges'] } {
  const parsed = parseMap(maps[id]);
  const sim = new Sim({ seed: 20261101, width: parsed.width, height: parsed.height, capacity: 64 });
  applyTerrain(parsed, sim);
  const tones = rendererOptionsFor(parsed, { colorVision: 'default', quality: 'high' } as never, '/').terrainTones;
  const b: ComposedTerrainBuild = composeTerrainFrom(null, sim, parsed.decor, parsed.elevation, () => true, tones, paletteColor, paletteColor('shadow.1'), null, false);
  const game = Object.fromEntries(LAYERS.map((l) => [l, chunkGridFor(parsed.width, parsed.height, l)?.edge ?? null])) as CensusInput['edges'];
  return {
    input: {
      width: parsed.width,
      height: parsed.height,
      ground: b.state.ground,
      scatter: b.state.scatter,
      placements: b.composed.decorPlacements,
      decorSet,
      texturedSet,
      maxLevel: 9,
    },
    markers: parsed.markers as Record<string, [number, number]>,
    whole: { ground: null, ditch: null },
    game,
  };
}

const at = (m: Record<string, [number, number]>, k: string, zoom: number): CensusView => ({ x: m[k][0], y: m[k][1], zoom });
const MTRI = 1e6;

describe('Rujm Sawda (80x80) submits a fraction of what the whole-map build did', () => {
  // Measured on the browser (Metal, DPR 2, `ground:capture`): seat 23.7M -> 2.5M triangles, centre
  // 23.2M -> 13.3M, and the frame 2.1 to 4.0 ms faster. The census below is the same count, in CI.
  let rujm: ReturnType<typeof build>;
  let chunked: CensusRow[];
  let whole: CensusRow[];
  beforeAll(() => {
    rujm = build('rujm_sawda');
    // seat (the force, in a corner), centre (the ditches), a mesa zoomed in
    const list = [at(rujm.markers, 'versus_0', 1), at(rujm.markers, 'centre', 1), at(rujm.markers, 'mesa_ne', 2.5)];
    chunked = censusTerrain({ ...rujm.input, edges: rujm.game }, list);
    whole = censusTerrain({ ...rujm.input, edges: rujm.whole }, list);
  }, 60_000);

  it('the game chunks the ground and the ditch of this map', () => {
    expect(rujm.game).toEqual({ ground: 32, ditch: 8 });
  });

  it('the whole-map build draws the ditch in full in every view (the number being fixed)', () => {
    for (const row of whole) {
      expect(row.total.triangles / MTRI, 'a never-culled ditch').toBeGreaterThan(20);
      expect(row.total.calls).toBeLessThanOrEqual(20);
    }
  });

  it('seat view (the force, a corner of the map): the ditch is culled away', () => {
    const [seat] = chunked;
    expect(seat.total.triangles / MTRI, 'triangles a frame, three passes').toBeLessThan(3);
    expect(seat.total.calls, 'draws a frame, three passes (19 whole, 28 chunked)').toBeLessThan(45);
    expect(seat.layers.ditch?.main.calls ?? 0, 'no ditch chunk reaches the screen from the seat').toBe(0);
  });

  it('centre view at zoom 1 (ditches in view): less than two thirds of the whole-map triangles', () => {
    const centre = chunked[1];
    expect(centre.total.triangles / MTRI).toBeLessThan(15);
    expect(centre.total.triangles).toBeLessThan(whole[1].total.triangles * 0.66);
    expect(centre.total.calls, 'draws (19 whole, 54 chunked)').toBeLessThan(90);
  });

  it('zoomed in on a mesa: a quarter of the whole-map triangles', () => {
    expect(chunked[2].total.triangles).toBeLessThan(whole[2].total.triangles * 0.25);
    expect(chunked[2].total.calls, 'draws (19 whole, 24 chunked)').toBeLessThan(40);
  });

  it('the decor batches are left whole and still walk every instance, for both cameras (chunking them was measured and refused)', () => {
    for (const row of [...chunked, ...whole]) expect(row.decorInstancesWalked).toBeGreaterThan(8000);
  });

  it('draws only the chunks in view: ground draws fewer than the 9 chunks a frame, every pass', () => {
    const seat = chunked[0].layers.ground;
    expect(seat.main.calls).toBeLessThan(9);
    expect(seat.main.calls).toBeGreaterThan(0);
    expect(seat.ao.calls, 'the AO pre-pass culls the same chunks').toBe(seat.main.calls);
  });
});

describe('Wadi Tarfan (48x48) is exactly as it was', () => {
  let wadi: ReturnType<typeof build>;
  let row: CensusRow;
  beforeAll(() => {
    wadi = build('wadi_tarfan');
    [row] = censusTerrain({ ...wadi.input, edges: wadi.game }, [at(wadi.markers, 'centre', 1)]);
  }, 60_000);

  it('the game chunks none of its layers', () => {
    expect(wadi.game).toEqual({ ground: null, ditch: null });
  });

  it('one ground draw, one scatter draw and one ditch draw a pass, and four decor batches that still cull per instance', () => {
    for (const layer of ['ground', 'scatter', 'ditch']) {
      expect(row.layers[layer].main.calls, layer).toBe(1);
      expect(row.layers[layer].ao.calls, layer).toBe(1);
    }
    expect(row.layers.decor.main.calls).toBe(4);
    expect(row.decorInstancesWalked, 'the exact per-instance cull and sort, both cameras').toBeGreaterThan(2000);
  });

  it('and still submits the whole ditch (the follow-up the lead decides): over 18M triangles', () => {
    expect(row.total.triangles / MTRI).toBeGreaterThan(18);
  });
});
