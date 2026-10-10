/**
 * A building collapse rebuilds the ground, the scatter and the control map
 * only around its own footprint (`terrain/incremental.ts`,
 * `terrain/tiled-mesh.ts`, `control-map.ts`'s `updateControlMapRegion`) --
 * and the result must be BYTE-IDENTICAL to a full rebuild, or the splice has
 * drawn something the map does not say.
 *
 * Real collapses on shipped maps, through the real `Sim`
 * (`debugDestroyStructure`, the same path a shell takes), each spliced from
 * the PREVIOUS splice, so an error would compound rather than hide. Every
 * vertex attribute, every index, both control textures, compared to the byte.
 *
 * Measured once over every structure of every shipped map (1,724 single
 * collapses, 2026-10-10): 0 differences at the shipped margins, and both
 * margins are tight -- a splice one tile narrower differs on 13 of the 20
 * relief maps, and a control-map margin one texel narrower on 25 of 33. The
 * last block pins one witness of each, so a margin cannot be shrunk past
 * what the builders read without this file going red.
 */
import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { maps, parseMap, applyTerrain, structures as structureCatalogue, paletteColor, type MapId } from '@lions/data';
import { composeTerrainFrom, type ComposedTerrainBuild } from '@lions/render/three';
import {
  buildControlMap,
  buildTerrainSurface,
  changedControlTiles,
  snapshotControlInputs,
  updateControlMapRegion,
  CONTROL_SPLICE_MARGIN_TEXELS,
  changedTerrainTiles,
  spliceGround,
  spliceMask,
  SPLICE_RADIUS_TILES,
  type ControlMap,
  type MeshData,
} from '@lions/render/terrain';
import { rendererOptionsFor } from './renderer-options';

const HIGH = { colorVision: 'default', quality: 'high' } as const;
const BACKGROUND = paletteColor('shadow.1');

interface MapRig {
  readonly sim: Sim;
  build(prev: ComposedTerrainBuild | null): ComposedTerrainBuild;
}

function rig(id: MapId): MapRig {
  const parsed = parseMap(maps[id]);
  const sim = new Sim({ seed: 20261010, width: parsed.width, height: parsed.height, capacity: 64 });
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
      composeTerrainFrom(prev?.state ?? null, sim, parsed.decor, parsed.elevation, () => true, tones, paletteColor, BACKGROUND),
  };
}

const MESH_KEYS = ['positions', 'colors', 'indices', 'normals', 'wallAlbedo', 'groundUv'] as const;

/** The first attribute where two meshes differ, or null when they are the
 *  same bytes. */
function meshDiff(a: MeshData, b: MeshData): string | null {
  for (const k of MESH_KEYS) {
    const x = a[k];
    const y = b[k];
    if (x === undefined || y === undefined) {
      if (x !== y) return `${k}: present on one side only`;
      continue;
    }
    if (x.length !== y.length) return `${k}: length ${x.length} vs ${y.length}`;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return `${k}[${i}]: ${x[i]} vs ${y[i]}`;
  }
  return null;
}

function bytesDiff(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

function cloneMap(m: ControlMap): ControlMap {
  return { width: m.width, height: m.height, a: m.a.slice(), b: m.b.slice() };
}

/**
 * Collapses `structures` one at a time, splicing each rebuild from the
 * previous SPLICE (never from a fresh build), and checks every step against a
 * full rebuild of the same world.
 */
function walkCollapses(id: MapId, structures: readonly number[]): void {
  const r = rig(id);
  let spliced = r.build(null);
  const map = buildControlMap(spliced.composed.input);
  let inputs = snapshotControlInputs(spliced.composed.input);
  const total = spliced.composed.input.width * spliced.composed.input.height;
  for (const s of structures) {
    expect(r.sim.structures.alive[s], `${id}: structure ${s} is standing before the shot`).toBe(1);
    r.sim.debugDestroyStructure(s);
    spliced = r.build(spliced);
    const full = r.build(null);
    // It really spliced -- a full rebuild would pass the comparison trivially.
    expect(spliced.rebuiltTiles).toBeGreaterThan(0);
    expect(spliced.rebuiltTiles).toBeLessThan(total / 10);
    expect(meshDiff(spliced.composed.ground, full.composed.ground), `${id} s${s}: ground`).toBeNull();
    expect(meshDiff(spliced.composed.scatter, full.composed.scatter), `${id} s${s}: scatter`).toBeNull();
    expect(Array.from(spliced.state.ground.vertexStart)).toEqual(Array.from(full.state.ground.vertexStart));
    expect(Array.from(spliced.state.scatter.indexStart)).toEqual(Array.from(full.state.scatter.indexStart));

    const changed = changedControlTiles(inputs, full.composed.input);
    expect(changed, `${id} s${s}: a collapse updates the control map in place`).not.toBeNull();
    const written = updateControlMapRegion(map, full.composed.input, changed as Uint8Array);
    expect(written).toBeLessThan((map.width * map.height) / 10);
    const fresh = buildControlMap(full.composed.input);
    expect(bytesDiff(map.a, fresh.a), `${id} s${s}: control A`).toBe(0);
    expect(bytesDiff(map.b, fresh.b), `${id} s${s}: control B`).toBe(0);
    inputs = snapshotControlInputs(full.composed.input);
  }
}

describe('a collapse splices the terrain to the bytes a full rebuild makes', () => {
  // The low-end assessment's own mission map (`umm_zeitoun_4_clearance`), with
  // relief: 1 is a warehouse and 54 a house whose reopened pads move the
  // smooth field around them; 29 is the building `pnpm perf:lowend` levels.
  it('umm_zeitoun_4 (relief), five collapses in a row', () => {
    walkCollapses('umm_zeitoun_4', [1, 29, 54, 13, 43]);
  }, 60_000);

  // Flat: a pad reopening changes tone and scatter only.
  it('khan_rafid_3 (flat), three collapses in a row', () => {
    walkCollapses('khan_rafid_3', [0, 40, 120]);
  }, 60_000);

  // The other relief map with the steepest ground under a town.
  it('beit_sahwan_2 (relief), three collapses in a row', () => {
    walkCollapses('beit_sahwan_2', [0, 60, 150]);
  }, 60_000);
});

describe('the margins are no wider than the builders read (the falsification, kept)', () => {
  // umm_zeitoun_4's warehouse, structure 1: the witness for both margins,
  // found by sweeping every structure on every shipped map.
  const WITNESS: { id: MapId; structure: number } = { id: 'umm_zeitoun_4', structure: 1 };

  it(`a ground splice at ${SPLICE_RADIUS_TILES - 1} tile(s) draws the wrong ground`, () => {
    const r = rig(WITNESS.id);
    const before = r.build(null);
    r.sim.debugDestroyStructure(WITNESS.structure);
    const full = r.build(null);
    const { input } = full.composed;
    const surface = buildTerrainSurface(input);
    const changed = changedTerrainTiles(before.state, input, surface) as Uint8Array;
    const tones = rendererOptionsFor(parseMap(maps[WITNESS.id]), HIGH, '/').terrainTones;
    const narrow = spliceGround(
      before.state.ground,
      spliceMask(changed, input.width, input.height, SPLICE_RADIUS_TILES - 1),
      input,
      tones,
      BACKGROUND,
      surface
    );
    expect(meshDiff(narrow.mesh, full.composed.ground)).not.toBeNull();
  }, 30_000);

  it(`a control-map update at ${CONTROL_SPLICE_MARGIN_TEXELS - 1} texel(s) writes the wrong map`, () => {
    const r = rig(WITNESS.id);
    const before = r.build(null);
    const map = buildControlMap(before.composed.input);
    const inputs = snapshotControlInputs(before.composed.input);
    r.sim.debugDestroyStructure(WITNESS.structure);
    const full = r.build(null);
    const changed = changedControlTiles(inputs, full.composed.input) as Uint8Array;
    const narrow = cloneMap(map);
    updateControlMapRegion(narrow, full.composed.input, changed, CONTROL_SPLICE_MARGIN_TEXELS - 1);
    const fresh = buildControlMap(full.composed.input);
    expect(bytesDiff(narrow.a, fresh.a) + bytesDiff(narrow.b, fresh.b)).toBeGreaterThan(0);
  }, 30_000);
});
