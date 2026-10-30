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
 *
 * The decor placements splice too (`decor-place.ts`, `spliceDecorPlacements`),
 * with their own margin, `DECOR_SPLICE_RADIUS_TILES` = 3: a clump member lands
 * up to a tile from the tile that seeds it, and its height reads the smooth
 * field two tiles further. Swept the same way (the same 1,724 collapses on all
 * 33 maps, 2026-10-10): 0 differences at 3; at 2, 10 collapses on 6 relief
 * maps place a member at a different height; at 1, 77 on 17.
 */
import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { maps, parseMap, applyTerrain, structures as structureCatalogue, paletteColor, type MapId, type MapJson } from '@lions/data';
import { composeTerrainFrom, type ComposedTerrainBuild } from '@lions/render/three';
import {
  buildControlMap,
  buildTerrainSurface,
  changedControlTiles,
  snapshotControlInputs,
  updateControlMapRegion,
  CONTROL_SPLICE_MARGIN_TEXELS,
  WET_SPLICE_MARGIN_TEXELS,
  changedTerrainTiles,
  spliceGround,
  spliceMask,
  SPLICE_RADIUS_TILES,
  DECOR_SPLICE_RADIUS_TILES,
  spliceDecorPlacements,
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

function rig(source: MapId | MapJson, wet = false): MapRig {
  const id = typeof source === 'string' ? source : source.id;
  const parsed = parseMap(typeof source === 'string' ? maps[source] : source);
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
      composeTerrainFrom(
        prev?.state ?? null,
        sim,
        parsed.decor,
        parsed.elevation,
        () => true,
        tones,
        paletteColor,
        BACKGROUND,
        null,
        wet
      ),
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
  return { width: m.width, height: m.height, a: m.a.slice(), b: m.b.slice(), c: m.c ? m.c.slice() : null };
}

/**
 * Collapses `structures` one at a time, splicing each rebuild from the
 * previous SPLICE (never from a fresh build), and checks every step against a
 * full rebuild of the same world.
 */
function walkCollapses(source: MapId | MapJson, structures: readonly number[]): void {
  const id = typeof source === 'string' ? source : source.id;
  const r = rig(source);
  let spliced = r.build(null);
  const map = buildControlMap(spliced.composed.input);
  let inputs = snapshotControlInputs(spliced.composed.input);
  const total = spliced.composed.input.width * spliced.composed.input.height;
  for (const s of structures) {
    expect(r.sim.structures.alive[s], `${id}: structure ${s} is standing before the shot`).toBe(1);
    r.sim.debugDestroyStructure(s);
    const previous = spliced;
    spliced = r.build(spliced);
    const full = r.build(null);
    // It really spliced -- a full rebuild would pass the comparison trivially.
    expect(spliced.rebuiltTiles).toBeGreaterThan(0);
    expect(spliced.rebuiltTiles).toBeLessThan(total / 10);
    expect(meshDiff(spliced.composed.ground, full.composed.ground), `${id} s${s}: ground`).toBeNull();
    expect(meshDiff(spliced.composed.scatter, full.composed.scatter), `${id} s${s}: scatter`).toBeNull();
    expect(Array.from(spliced.state.ground.vertexStart)).toEqual(Array.from(full.state.ground.vertexStart));
    expect(Array.from(spliced.state.scatter.indexStart)).toEqual(Array.from(full.state.scatter.indexStart));
    // Decor: the same placements in the same order, and really spliced -- most
    // of them the very objects the previous build placed, a few re-emitted.
    expect(spliced.composed.decorPlacements, `${id} s${s}: decor`).toEqual(full.composed.decorPlacements);
    expect(Array.from(spliced.state.decorPlacements.starts)).toEqual(Array.from(full.state.decorPlacements.starts));
    const prevObjects = new Set(previous.composed.decorPlacements);
    const reused = spliced.composed.decorPlacements.filter((p) => prevObjects.has(p)).length;
    expect(reused, `${id} s${s}: decor copied`).toBeGreaterThan(spliced.composed.decorPlacements.length * 0.8);
    expect(reused, `${id} s${s}: decor re-emitted`).toBeLessThan(spliced.composed.decorPlacements.length);

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

  // The other relief map with the steepest ground under a town. 9 is a
  // decor witness: one tile less margin puts a grass tuft at the wrong height.
  it('beit_sahwan_2 (relief), four collapses in a row', () => {
    walkCollapses('beit_sahwan_2', [0, 9, 60, 150]);
  }, 60_000);

  // The highland theme's open-ground pass (cedars, outcrops, chips) as well.
  it('umm_zeitoun_2 (relief, highland chips), two collapses in a row', () => {
    walkCollapses('umm_zeitoun_2', [14, 19]);
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

  it(`a decor splice at ${DECOR_SPLICE_RADIUS_TILES - 1} tile(s) places the wrong decor`, () => {
    // umm_zeitoun's structure 0: a grass clump member a tile out of the
    // margin, standing on ground the collapse re-shaped.
    const r = rig('umm_zeitoun');
    const before = r.build(null);
    r.sim.debugDestroyStructure(0);
    const full = r.build(null);
    const { input } = full.composed;
    const surface = buildTerrainSurface(input);
    const changed = changedTerrainTiles(before.state, input, surface) as Uint8Array;
    const at = (radius: number) =>
      spliceDecorPlacements(before.state.decorPlacements, spliceMask(changed, input.width, input.height, radius), input, surface)
        .placements;
    expect(at(DECOR_SPLICE_RADIUS_TILES)).toEqual(full.composed.decorPlacements);
    expect(at(DECOR_SPLICE_RADIUS_TILES - 1)).not.toEqual(full.composed.decorPlacements);
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

// -- The wetland's waterside willow pass (GH-871 P2, Task 6c) -------------

/**
 * A 48x48 wetland: an 8x8 marsh at tiles 20..27 and a two-tile house (`hh`)
 * on its west bank, the inner tile (19, 24) in the ring and the outer one two
 * tiles out. Through the real `Sim`, as the shell collapses it.
 *
 * What this proves, and what it cannot: the spliced placements equal a full
 * build, the `starts` array is the four-pass layout, and the willows really
 * stand on the bank (so the fourth pass ran). It cannot show a splice that
 * skipped pass 3 going red, because no real collapse changes what pass 3
 * emits: a standing house is blocked and its rubble (`rubble_cover` 1 or 2)
 * is cover, so the tile is not plain open ground before OR after, and a
 * fence is drawn out of the terrain's blocked mask (`draw-mask.ts`). The
 * falsifiable splice case is `spliceDecorPlacements` itself, in
 * `decor-place.test.ts`, on a tile that reopens with no rubble.
 */
function wetlandWithHouse(): MapJson {
  const w = 48;
  const rows: string[] = [];
  for (let y = 0; y < w; y++) {
    let line = '';
    for (let x = 0; x < w; x++) {
      if (x >= 20 && x <= 27 && y >= 20 && y <= 27) line += '~';
      else if (y === 24 && (x === 18 || x === 19)) line += 'h';
      else line += '.';
    }
    rows.push(line);
  }
  return { id: 'splice_wetland', name: 'Splice Wetland', width: w, height: w, terrain: 'wetland', rows };
}

describe('a collapse beside the marsh splices the willow pass to the bytes a full rebuild makes', () => {
  it('a house on the bank: the spliced decor equals the full build, four passes of starts', () => {
    const json = wetlandWithHouse();
    expect(parseMap(json).structures.map((s) => s.type)).toEqual(['house']);
    const r = rig(json);
    const before = r.build(null);
    // The wetland path ran: the theme's waterside reached the placer, the marsh
    // laid its reeds, and willows stand on the bank.
    expect(before.composed.input.waterside).toEqual({ tree: 'willow', p: 0.12, reach: 1 });
    expect(before.composed.decorPlacements.filter((p) => p.family === 'reed').length).toBeGreaterThan(30);
    expect(before.composed.decorPlacements.filter((p) => p.family === 'willow').length).toBeGreaterThan(0);
    expect(before.state.decorPlacements.starts.length).toBe(4 * (48 * 48 + 1));

    expect(r.sim.structures.alive[0]).toBe(1);
    r.sim.debugDestroyStructure(0);
    const spliced = r.build(before);
    const full = r.build(null);
    expect(spliced.rebuiltTiles).toBeGreaterThan(0);
    expect(spliced.rebuiltTiles).toBeLessThan((48 * 48) / 10);
    expect(spliced.composed.decorPlacements).toEqual(full.composed.decorPlacements);
    expect(Array.from(spliced.state.decorPlacements.starts)).toEqual(Array.from(full.state.decorPlacements.starts));
    const prevObjects = new Set(before.composed.decorPlacements);
    const reused = spliced.composed.decorPlacements.filter((p) => prevObjects.has(p)).length;
    expect(reused).toBeGreaterThan(spliced.composed.decorPlacements.length * 0.8);
    expect(reused).toBeLessThan(spliced.composed.decorPlacements.length);
  }, 30_000);
});

// -- Control C, the wet bake (GH-871 P4, Task 3) ---------------------------

/**
 * Ein Qasab under rain: every structure collapsed on its own, the control map
 * spliced against a full wet build, to the byte in A, B AND C.
 *
 * C reads the drawn surface (the puddle rule is a slope and a level), so a
 * collapse reaches it further than A and B: a tile whose smoothing field
 * changed moves the normal at every texel two tiles out (a Catmull-Rom sample
 * reads columns -2..+2), `WET_SPLICE_MARGIN_TEXELS` = 16. Swept once over
 * every structure of Ein Qasab (2026-10-30): see the numbers in the last test.
 */
function wetWalk(structures: readonly number[]): { collapses: number; surfaceTiles: number; differing: number } {
  let collapses = 0;
  let surfaceTiles = 0;
  let differing = 0;
  for (const s of structures) {
    const r = rig('ein_qasab', true);
    const before = r.build(null);
    const map = buildControlMap(before.composed.input, before.state.surface);
    expect(map.c, 'C is allocated under rain').not.toBeNull();
    const inputs = snapshotControlInputs(before.composed.input, before.state.surface);
    expect(r.sim.structures.alive[s], `structure ${s} is standing before the shot`).toBe(1);
    r.sim.debugDestroyStructure(s);
    const full = r.build(null);
    const changed = changedControlTiles(inputs, full.composed.input, full.state.surface);
    collapses++;
    if (changed === null) {
      differing++; // a full build was demanded: nothing to splice, nothing to compare
      continue;
    }
    for (let t = 0; t < changed.length; t++) if ((changed[t] & 2) !== 0) surfaceTiles++;
    updateControlMapRegion(map, full.composed.input, changed, undefined, full.state.surface);
    const fresh = buildControlMap(full.composed.input, full.state.surface);
    const c = map.c as Uint8Array;
    const d =
      bytesDiff(map.a, fresh.a) + bytesDiff(map.b, fresh.b) + bytesDiff(c, fresh.c as Uint8Array);
    if (d > 0) differing++;
  }
  return { collapses, surfaceTiles, differing };
}

describe('a collapse on Ein Qasab splices control C to the bytes a full wet build makes', () => {
  const count = parseMap(maps.ein_qasab).structures.length;
  const all = Array.from({ length: count }, (_, i) => i);

  it('has structures to collapse', () => {
    expect(count).toBeGreaterThanOrEqual(8);
  });

  it('every single-structure collapse, spliced, equals the full build in A, B and C', () => {
    const r = wetWalk(all);
    expect(r.collapses).toBe(count);
    expect(r.differing).toBe(0);
  }, 240_000);

  it('the margin is the stencil bound: 16 texels, two tiles of Catmull-Rom', () => {
    expect(WET_SPLICE_MARGIN_TEXELS).toBe(16);
  });
});

/**
 * The wet margin's falsification lives in `control-map.test.ts` (a road beside
 * a constructed hump). It cannot live here any more: with no puddles on open
 * ground (the lead's S-L1 ruling) the only C bytes a surface change can move
 * are a road's rut band, and neither Ein Qasab's collapses nor
 * umm_zeitoun_4's warehouse (structure 1: 11 surface tiles) sit near one.
 * What this keeps: a relief map compiled wet, collapsed, splices to the bytes
 * of a full build at the shipped margin.
 */
describe('a warehouse collapse on a relief map splices C to the full build at the shipped margin', () => {
  it('umm_zeitoun_4, structure 1: the spliced C is the full build', () => {
    const r = rig('umm_zeitoun_4', true);
    const before = r.build(null);
    const map = buildControlMap(before.composed.input, before.state.surface);
    const inputs = snapshotControlInputs(before.composed.input, before.state.surface);
    r.sim.debugDestroyStructure(1);
    const full = r.build(null);
    const changed = changedControlTiles(inputs, full.composed.input, full.state.surface) as Uint8Array;
    let surfaceTiles = 0;
    for (const v of changed) if ((v & 2) !== 0) surfaceTiles++;
    expect(surfaceTiles, 'the warehouse reflows the smoothing field').toBeGreaterThan(5);
    updateControlMapRegion(map, full.composed.input, changed, undefined, full.state.surface);
    const fresh = buildControlMap(full.composed.input, full.state.surface);
    expect(bytesDiff(map.c as Uint8Array, fresh.c as Uint8Array)).toBe(0);
  }, 60_000);
});
