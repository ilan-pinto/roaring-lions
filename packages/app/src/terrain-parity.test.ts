/**
 * Task B2.8: the positional parity check.
 *
 * Runs the whole terrain pipeline -- `buildGround`, `buildScatter`,
 * `buildGroves`, `buildBuildings` -- against every shipped map
 * (`data/maps/*.json`), loaded exactly the way the game loads them: through
 * `parseMap`, into a real `Sim`, with `applyTerrain` and `addStructure`
 * carrying the mechanical layer across -- not a synthetic fixture.
 *
 * This file lives here, not in `packages/render/src/three/terrain/` where
 * the phase plan originally put it, because `eslint.config.mjs`'s
 * `packages/render/src/**\/*.ts` rule bans any `@lions/(app|data)` import
 * (tests included) and this suite needs `parseMap`/`applyTerrain` to load
 * real maps. `app -> render -> sim`, `data` a leaf: an app-level test may
 * import both, the way `sandbox-extras.test.ts` and `sandbox-anchors.test.ts`
 * already do. `packages/render/package.json`'s `exports` map grew three
 * paths for this file to import through -- `./terrain` (the pure builders,
 * barrelled; deliberately excludes `mesh.ts`, never names `ThreeRenderer`,
 * and -- since a whole-branch review found `ground.ts`/`buildings.ts`/
 * `grove.ts` reaching `WORLD_Y_PER_LIFT_PIXEL` through `../camera`, which
 * imports three.js unconditionally, so excluding `mesh.ts` alone was not
 * enough -- imports that constant from `project.ts` directly instead, so
 * importing this barrel costs nothing beyond the builders themselves,
 * verified by walking its full transitive module graph), `./project`
 * (the Pixi-side pure projection arithmetic this suite compares against) and
 * `./three-camera` (three.js's camera, pinned to reproduce that arithmetic).
 * Only `./terrain` was named by the phase's own ruling; `./project` and
 * `./three-camera` were added here because the round-trip assertion cannot
 * exist without reaching both, and neither was reachable through any
 * existing export path -- see the task report for the reasoning.
 *
 * What this suite does NOT do: compare colours to Pixi's. Three.js terrain
 * is deliberately not pixel-identical (the quantisation ruling: Pixi's
 * composited tones are not palette entries, only the quantised three.js
 * output is supposed to be) -- so "parity" here is positional and
 * palette-membership only, per the phase's own ruling on what this check
 * means. Four things are pinned, one per describe block below:
 *
 *   1. Triangle-count arithmetic: two triangles per tile top, plus exactly
 *      the side-face quads the map's own elevation implies -- computed
 *      independently of `ground.ts`'s own drop-comparison, from the map's
 *      raw elevation grid, so a missing or spurious face is caught rather
 *      than the test re-deriving the same number `buildGround` derives.
 *   2. The palette guarantee -- every vertex colour across all four
 *      builders is a `data/palette.json` entry -- asserted on real map data
 *      rather than synthetic fixtures, which is the one thing every
 *      builder's own test suite cannot do.
 *   3. The ground mesh's world-space bounding box against the map's own
 *      width/height (and its highest point against the map's own highest
 *      elevation level).
 *   4. The round-trip: a tile's world position, asked of `worldToScreenThree`
 *      at that tile's own elevation, lands where `project.worldToScreen`
 *      says it should. This is the one check tying the three.js backend to
 *      the Pixi-side conformance suite, and the one the phase brief singles
 *      out as "the check that would have caught Phase B1's wrong camera
 *      angle" -- ONLY at a raised tile: a flat map cannot distinguish a
 *      right camera from a wrong one, which is why `tel_marum`, the only
 *      shipped map with relief, gets its own dedicated describe block below
 *      in addition to its turn in the per-map loop.
 *
 * A final `describe` breaks each of the three invariants the task brief
 * calls out by name (the palette guarantee, the round-trip, the tile-count
 * arithmetic) and asserts the break is actually caught -- see its own doc
 * comment for what "break" means here, given `packages/render/src/three/
 * terrain/*.ts` is off limits to edit while a review runs over it.
 */
import { describe, it, expect } from 'vitest';
import { Sim } from '@lions/sim';
import {
  maps,
  parseMap,
  applyTerrain,
  structures as structureCatalogue,
  paletteColor,
  type MapId,
} from '@lions/data';
import type { TerrainTones } from '@lions/render';
import {
  buildGround,
  PALETTE_HEXES,
  WORLD_PER_LEVEL,
  levelAt,
  type TerrainInput,
  type MeshData,
  type StructureFootprint,
} from '@lions/render/terrain';
import { worldToScreen, TILE_W, TILE_H, ELEV_STEP, type Camera, type Viewport } from '@lions/render/project';
import { worldToScreenThree } from '@lions/render/three-camera';
import { structureFootprintsFor, composeTerrain } from '@lions/render/three';
import { TERRAIN_THEMES } from './terrain-themes';

// --- world setup: the same steps main.ts takes to go from map JSON to a
// live Sim, minus everything terrain does not need (missions, tunnels,
// units, the renderer itself). main.ts cannot be imported directly -- its
// module body is `main().catch(...)`, which boots the live app against
// `document`/`window` -- so the pieces terrain cares about are reproduced
// here rather than shared. ------------------------------------------------

// `TERRAIN_THEMES` (Task B3.1: moved to `./terrain-themes`, shared with
// `main.ts` -- both used to keep their own verbatim copy) and
// `structureFootprintsFor` (Task B3.1: moved to `ThreeRenderer.ts`, the one
// place `Sim` is legitimately turned into the plain-array snapshot
// `buildBuildings` needs, and exported from there now that the file is no
// longer off limits to edit) are imported above rather than declared here.

const BACKGROUND = paletteColor('shadow.1');

/**
 * Task C4: vitest's default `testTimeout` is 5000ms. This file's heaviest
 * test -- four full-map meshes built and walked vertex by vertex, per map --
 * measured at ~1.3s for the whole file run in isolation but ~8s under a
 * loaded CI machine running the rest of the suite concurrently, close enough
 * to the default that it has already flaked. 20s is generous headroom over
 * the measured worst case without raising the budget for every other,
 * genuinely-fast test in this file (each heavy test opts in explicitly by
 * passing this as its own third argument, rather than this file reaching
 * into `vitest.config.ts`'s global `testTimeout` and changing the budget for
 * every OTHER suite in the monorepo too).
 */
const HEAVY_TEST_TIMEOUT_MS = 20_000;

interface LoadedMap {
  parsedMap: ReturnType<typeof parseMap>;
  /** The real `Sim` this map was built into -- retained (not just its
   *  derived `TerrainInput`/`footprints`) so `composeTerrain` (Task B1's own
   *  test, below) can be driven directly, exactly the way `ThreeRenderer.
   *  rebuildTerrain` drives it: `composeTerrain` takes a `Sim`, not a
   *  pre-extracted snapshot. */
  sim: Sim;
  input: TerrainInput;
  footprints: StructureFootprint[];
  tones: TerrainTones;
}

const mapCache = new Map<MapId, LoadedMap>();

/** Builds a real `Sim` from a shipped map's JSON, the way `main.ts` does --
 *  `applyTerrain` for the mechanical layer, `addStructure` per parsed
 *  building -- then reads back exactly the fields `ThreeRenderer.
 *  rebuildTerrain` reads to build its `TerrainInput`. Memoised: every
 *  describe block below asks for the same map more than once, and building
 *  a fresh `Sim` is not free. */
function loadMap(id: MapId): LoadedMap {
  const cached = mapCache.get(id);
  if (cached) return cached;

  const parsedMap = parseMap(maps[id]);
  const sim = new Sim({ seed: 20260727, width: parsedMap.width, height: parsedMap.height, capacity: 256 });
  applyTerrain(parsedMap, sim);

  const structTypeIdx = new Map<string, number>();
  for (const [structId, spec] of Object.entries(structureCatalogue)) {
    structTypeIdx.set(structId, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of parsedMap.structures) {
    const t = structTypeIdx.get(b.type);
    if (t === undefined) throw new Error(`map ${id} references unknown structure type ${b.type}`);
    sim.addStructure(t, b.tiles);
  }

  const input: TerrainInput = {
    width: parsedMap.width,
    height: parsedMap.height,
    decor: parsedMap.decor,
    elevation: parsedMap.elevation,
    blocked: sim.blocked,
    cover: sim.cover,
  };
  const loaded: LoadedMap = {
    parsedMap,
    sim,
    input,
    footprints: structureFootprintsFor(sim),
    tones: TERRAIN_THEMES[parsedMap.terrain],
  };
  mapCache.set(id, loaded);
  return loaded;
}

// --- shared assertions -----------------------------------------------------

const PALETTE_ENTRIES = new Set(PALETTE_HEXES.map((h) => h.toUpperCase()));

/** Recovers the hex a vertex colour rounds to -- the exact inverse of
 *  every builder's own `hexToUnit`, so this is comparing in the same space
 *  `quantise` produced its output in, not a lossy re-derivation of it. */
function hexAt(mesh: MeshData, i: number): string {
  return (
    '#' +
    [0, 1, 2]
      .map((k) => Math.round(mesh.colors[i + k] * 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/** The phase's central guarantee: every vertex colour a builder emits is a
 *  `data/palette.json` entry, never a raw composite. Each builder's own test
 *  suite already asserts this on synthetic fixtures; this is the same
 *  assertion run on what a shipped map actually produces. */
function assertPaletteColors(mesh: MeshData, label: string): void {
  for (let i = 0; i < mesh.colors.length; i += 3) {
    const hex = hexAt(mesh, i);
    expect(PALETTE_ENTRIES, `${label}: vertex colour ${hex} at colour index ${i / 3} is not a palette entry`).toContain(
      hex
    );
  }
}

/**
 * `<mapId>:<builder>` pairs where a builder legitimately emits NO geometry --
 * either a property of the map's own decor, or (grove, every map, as of
 * Task 7) a builder `composeTerrain` no longer calls at all.
 *
 * `grove` is now empty for EVERY map, not just `tel_marum`: retiring the
 * procedural canopy means `composeTerrain` stopped calling `buildGroves`
 * (`ThreeRenderer.ts`, `composeTerrain`'s own comment) -- grove tiles now get
 * real tree meshes from `decor-place.ts`'s `tree` family instead, drawn in
 * the decor batch, which this per-builder mesh check does not cover (decor
 * meshes are GPU `BatchedMesh` state built by `buildDecorMesh`, not a
 * `MeshData` this suite walks). `buildGroves` and its own test suite
 * (`grove.ts`, `grove.test.ts`) still exist and are still exercised
 * directly by `grove.test.ts` -- only the CALL from `composeTerrain` is
 * gone, kept as a one-line revert. Before Task 7, only `tel_marum` (no `o`
 * tile in its rows at all) was in this set; every other map produced real
 * grove geometry (912-16,368 vertices) through this same call.
 *
 * This matters because, without `assertNonEmptyUnless` below, "every vertex
 * colour is a palette entry" is checking an empty loop for a listed
 * map/builder pair -- passing while verifying nothing, exactly the failure
 * mode this task exists to find and remove (discovered by actually running
 * this suite against real map data and reading the vertex counts, not by
 * inspection). Every OTHER map/builder pair among the five shipped maps
 * still produces real geometry (checked directly: ground 9,216-9,964
 * vertices, scatter 53,140-86,288, buildings 80-1,984) -- so grove is now a
 * total, named exception across all five maps, not a per-map one.
 */
// `Object.keys(maps)` directly, not `MAP_IDS` -- that constant is declared
// further down this file (after `KNOWN_EMPTY` is used by the assertion
// helpers just below), and both are top-level `const`s, so referencing it
// here would throw on the temporal-dead-zone, not merely warn.
const KNOWN_EMPTY: ReadonlySet<string> = new Set(
  Object.keys(maps).map((id) => `${id}:grove`)
);

/** A builder producing real geometry somewhere is the precondition for its
 *  palette check meaning anything -- see `KNOWN_EMPTY`'s doc comment. */
function assertNonEmptyUnless(mesh: MeshData, key: string, label: string): void {
  if (mesh.colors.length === 0 && !KNOWN_EMPTY.has(key)) {
    throw new Error(`${label}: emitted no geometry at all -- either a real regression or a missing KNOWN_EMPTY entry`);
  }
}

// `levelAt` (Task B3.1: moved to `packages/render/src/three/terrain/
// shared.ts`, reached here through the `@lions/render/terrain` barrel) was
// the fifth of five identical copies this task's inventory found -- the
// other four were each terrain builder's own private redeclaration.

/**
 * Two triangles per tile top, plus one side-face quad (two triangles) for
 * every east or south neighbour that sits lower -- `ground.ts`'s own rule,
 * computed independently here from the map's raw elevation grid rather than
 * by calling anything `ground.ts` exports, so a bug in `ground.ts`'s own
 * drop comparison cannot cancel out against this count agreeing with itself.
 */
function expectedGroundIndexCount(input: TerrainInput): number {
  let faceQuads = 0;
  for (let y = 0; y < input.height; y++) {
    for (let x = 0; x < input.width; x++) {
      const here = levelAt(input, x, y);
      if (here - levelAt(input, x + 1, y) > 0) faceQuads++;
      if (here - levelAt(input, x, y + 1) > 0) faceQuads++;
    }
  }
  const tileQuads = input.width * input.height;
  return (tileQuads + faceQuads) * 6; // 2 triangles/quad * 3 indices/triangle
}

function distinctLevels(input: TerrainInput): number[] {
  if (!input.elevation) return [0];
  const seen = new Set<number>();
  for (const v of input.elevation) seen.add(v);
  return [...seen].sort((a, b) => a - b);
}

/** The first tile (row-major) sitting at exactly `level`. Every level
 *  `distinctLevels` reports is guaranteed to have one. */
function firstTileAt(input: TerrainInput, level: number): [number, number] {
  for (let y = 0; y < input.height; y++) {
    for (let x = 0; x < input.width; x++) {
      if (levelAt(input, x, y) === level) return [x, y];
    }
  }
  throw new Error(`no tile at level ${level}`);
}

/** The round-trip: a tile centre at `level`, asked of both backends'
 *  projection arithmetic with the SAME `lift` (Pixi's own convention --
 *  elevation level times `ELEV_STEP` raw screen pixels), must land on the
 *  same screen point. This is the assertion the phase brief singles out as
 *  the one that would have caught Phase B1's wrong camera angle. */
function assertRoundTrip(wx: number, wy: number, level: number, cam: Camera, vp: Viewport, label: string): void {
  const lift = level * ELEV_STEP;
  const pixi = worldToScreen(wx, wy, cam, vp, lift);
  const three = worldToScreenThree(wx, wy, cam, vp, lift);
  expect(three.x, `${label}: x`).toBeCloseTo(pixi.x, 3);
  expect(three.y, `${label}: y`).toBeCloseTo(pixi.y, 3);
}

// --- per-map suite -----------------------------------------------------

const MAP_IDS = Object.keys(maps) as MapId[];

it('covers exactly the five shipped maps this task names', () => {
  expect(MAP_IDS.sort()).toEqual(
    ['beit_sahwan_outskirts', 'marj_perimeter', 'tel_marum', 'tutorial_ground', 'wadi_halam_basin'].sort()
  );
});

describe.each(MAP_IDS)('terrain parity: %s', (id) => {
  const { sim, parsedMap, input, tones } = loadMap(id);

  it('ground mesh has exactly two triangles per tile plus the expected side faces', () => {
    const mesh = buildGround(input, tones, BACKGROUND);
    expect(mesh.indices.length).toBe(expectedGroundIndexCount(input));
  });

  it(
    'every vertex colour across ground, scatter, groves and buildings is a palette entry',
    () => {
      // Task B2: wired through `composeTerrain` -- the actual composition
      // `ThreeRenderer.rebuildTerrain` performs (Task B3.9) -- rather than a
      // hand-rolled merged `buildBuildings` call over unmasked input. That
      // hand-rolled call stopped describing what production does the moment
      // `composeTerrain` split buildings per-structure and started feeding
      // the RESIDUAL layer alone a masked view: a suite asserting a
      // composition production no longer performs is worse than an
      // untested path, since it reads as coverage. `hasArt: () => false`
      // reproduces the "every structure is un-arted, box everything" case
      // this test always meant to cover -- `structureFootprintsFor`'s own
      // doc comment is explicit that its whole job is "every living
      // structure, unconditionally", regardless of art; see the dedicated
      // `composeTerrain` describe block below for the hasArt=true side.
      const composed = composeTerrain(
        sim,
        parsedMap.decor,
        parsedMap.elevation,
        () => false,
        tones,
        paletteColor,
        BACKGROUND
      );

      // Non-empty first: a palette check on an empty mesh passes by checking
      // nothing (see `KNOWN_EMPTY`'s doc comment -- this is exactly how
      // `tel_marum`'s grove mesh was found to be empty in the first place).
      assertNonEmptyUnless(composed.ground, `${id}:ground`, `${id} ground`);
      assertNonEmptyUnless(composed.scatter, `${id}:scatter`, `${id} scatter`);
      assertNonEmptyUnless(composed.groves, `${id}:grove`, `${id} grove`);
      // Buildings are no longer one merged mesh: one `ComposedBuildingBox`
      // per live, un-arted structure, plus the always-near-empty `residual`
      // fallback layer (`composeTerrain`'s own doc comment). Non-emptiness
      // is checked over their SUM, matching what the single merged mesh
      // this test used to check covered.
      const buildingVertexCount =
        composed.buildings.reduce((n, b) => n + b.mesh.colors.length, 0) + composed.residual.colors.length;
      if (buildingVertexCount === 0 && !KNOWN_EMPTY.has(`${id}:buildings`)) {
        throw new Error(`${id} buildings: emitted no geometry at all -- either a real regression or a missing KNOWN_EMPTY entry`);
      }

      assertPaletteColors(composed.ground, `${id} ground`);
      assertPaletteColors(composed.scatter, `${id} scatter`);
      assertPaletteColors(composed.groves, `${id} grove`);
      for (const box of composed.buildings) {
        assertPaletteColors(box.mesh, `${id} buildings (structure ${box.structureIndex})`);
      }
      assertPaletteColors(composed.residual, `${id} buildings (residual)`);
    },
    // Task C4: this is the heaviest test in the file -- four full-map
    // meshes (scatter alone runs 53,140-86,288 vertices on a shipped map,
    // per this file's own KNOWN_EMPTY comment) built and then walked vertex
    // by vertex. Measured at ~1.3s for the whole file run in isolation but
    // ~8s under a loaded CI machine running the rest of the suite
    // concurrently -- close enough to vitest's 5000ms default `testTimeout`
    // that it has already flaked on load. Raised, not split: splitting
    // would mean building the same four meshes twice (once per assertion
    // group) for no measurement benefit, since the cost is the mesh
    // construction, not the vertex walk.
    HEAVY_TEST_TIMEOUT_MS
  );

  // Cannot detect an X/Z transpose: every shipped map (data/maps/*.json) is
  // 48x48, so a swapped [z, topY, x] would still produce maxX === maxZ ===
  // 48 here -- the bound comes out identical either way on a square map. Not
  // uncovered, though: `packages/render/src/three/terrain/ground.test.ts`'s
  // "maps game (x, y) to three (x, height, y)" test uses a deliberately
  // non-square `flat(3, 2)` fixture for exactly this reason, and would catch
  // a transpose this suite cannot. Read this assertion as "matches on every
  // shipped map's real data", not as a stronger claim about axis order.
  it("the ground mesh's world-space bounding box matches the map's dimensions", () => {
    const mesh = buildGround(input, tones, BACKGROUND);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i];
      const y = mesh.positions[i + 1];
      const z = mesh.positions[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    expect(minX).toBe(0);
    expect(maxX).toBe(parsedMap.width);
    expect(minZ).toBe(0);
    expect(maxZ).toBe(parsedMap.height);
    expect(minY).toBeGreaterThanOrEqual(0);
    const maxLevel = Math.max(...distinctLevels(input));
    expect(maxY).toBeCloseTo(maxLevel * WORLD_PER_LEVEL, 5);
  });

  it("a tile's world position round-trips through worldToScreenThree to the screen point project.worldToScreen gives, at every elevation level the map contains", () => {
    const cam: Camera = { x: parsedMap.width / 2, y: parsedMap.height / 2, zoom: 1 };
    const vp: Viewport = { width: 800, height: 600 };
    for (const level of distinctLevels(input)) {
      const [x, y] = firstTileAt(input, level);
      assertRoundTrip(x + 0.5, y + 0.5, level, cam, vp, `${id} tile (${x},${y}) at level ${level}`);
    }
  });
});

// --- composeTerrain: the art-masked split (Task B1) ------------------------

describe('composeTerrain: ground/scatter/groves ignore hasArt, buildings do not', () => {
  // `composeTerrain`'s own doc comment claims exactly this shape can "now be
  // asserted directly against a real Sim with hasArt both true and false for
  // the same structure" -- the affordance `structureBillboardGeometry`/
  // `withoutLiveStructures`/`composeTerrain` were built to enable, and this
  // is that test. Before it, nothing in this repo called `composeTerrain`
  // with `hasArt` returning true for anything: `terrain-parity.test.ts`'s
  // own palette check (above) always passed `() => false`, and no other test
  // file reaches `composeTerrain` at all (it lives on `ThreeRenderer.ts`,
  // untestable outside `packages/app` -- see this file's own top comment).
  //
  // Every shipped map has at least one structure (checked directly against
  // every `data/maps/*.json`'s own symbol counts), so picking the first
  // structure off the first map gives a stable, always-reachable target
  // rather than a per-map conditional skip.
  const mapId = MAP_IDS[0];
  const { sim, parsedMap, tones, footprints } = loadMap(mapId);
  const target = parsedMap.structures[0];
  if (!target) {
    throw new Error(`${mapId} has no structures -- this test needs a map with at least one`);
  }
  const targetTileX = target.tiles[0] % parsedMap.width;
  const targetTileY = Math.floor(target.tiles[0] / parsedMap.width);

  it('BREAK CHECK (B1): a structure with art keeps its ground tone unmasked -- only its own box is skipped', () => {
    const withArt = composeTerrain(
      sim,
      parsedMap.decor,
      parsedMap.elevation,
      (id) => id === target.type,
      tones,
      paletteColor,
      BACKGROUND
    );
    const withoutArt = composeTerrain(
      sim,
      parsedMap.decor,
      parsedMap.elevation,
      () => false,
      tones,
      paletteColor,
      BACKGROUND
    );

    // The regression this task's own doc comment names by name: an earlier
    // draft fed `buildGround` the ART-MASKED blocked array instead of the
    // raw one, which would make this structure's ground tile read as OPEN
    // the instant its sheet finished loading. Ground/scatter/groves must be
    // byte-identical between the two calls -- `hasArt` has no business
    // reaching any of the three.
    expect(Array.from(withArt.ground.positions)).toEqual(Array.from(withoutArt.ground.positions));
    expect(Array.from(withArt.ground.colors)).toEqual(Array.from(withoutArt.ground.colors));
    expect(Array.from(withArt.scatter.colors)).toEqual(Array.from(withoutArt.scatter.colors));
    expect(Array.from(withArt.groves.colors)).toEqual(Array.from(withoutArt.groves.colors));

    // But buildings DO differ: hasArt=true must skip `target`'s own box, and
    // every other LIVE structure sharing its type -- hasArt is a per-TYPE
    // predicate in production (`this.structureIdle.has(id)`, keyed by
    // structure type id, never by instance), so a map where several
    // structures share `target.type` (a town's several houses, say) must
    // skip all of them, not merely the first. Counted independently from
    // `parsedMap.structures` (one entry per `sim.addStructure` call
    // `loadMap` made, per its own doc comment) rather than assumed to be 1.
    const structureIndex = sim.structureAt(targetTileX, targetTileY);
    expect(structureIndex).toBeGreaterThanOrEqual(0);
    expect(withoutArt.buildings.some((b) => b.structureIndex === structureIndex)).toBe(true);
    expect(withArt.buildings.some((b) => b.structureIndex === structureIndex)).toBe(false);
    const sameTypeCount = parsedMap.structures.filter((s) => s.type === target.type).length;
    expect(withoutArt.buildings.length).toBe(withArt.buildings.length + sameTypeCount);

    // The neutral, art-blind snapshot `structureFootprintsFor` returns (kept
    // exercised here, not only inside `loadMap`) has one entry per live
    // structure regardless of art -- matching `composeTerrain`'s own
    // `hasArt: () => false` count exactly, since both walk the identical
    // structure set (`walkStructureFootprints`).
    expect(footprints.length).toBe(withoutArt.buildings.length);
  });
});

// --- tel_marum: the only shipped map with relief --------------------------

describe('tel_marum (relief): the round-trip check at a raised tile, not only elevation 0', () => {
  // "Assert it on Tel Marum, at raised tiles, not only at elevation 0. A flat
  // map cannot distinguish a right camera from a wrong one" -- every other
  // map is flat (`distinctLevels` above is `[0]` for all four of them), so
  // this block exists to give that specific claim its own, unmissable home
  // rather than leaving it implicit in the generic per-map loop above.
  const { input } = loadMap('tel_marum');
  const levels = distinctLevels(input);
  const maxLevel = Math.max(...levels);

  it('has relief -- otherwise this whole block would be exercising nothing', () => {
    expect(levels.length).toBeGreaterThan(1);
    expect(maxLevel).toBeGreaterThan(0);
  });

  it('agrees with project.worldToScreen at elevation 0 and at every raised level, under three cameras', () => {
    const vp: Viewport = { width: 1024, height: 768 };
    const cameras: Camera[] = [
      { x: 24, y: 24, zoom: 1 },
      { x: 10, y: 35, zoom: 1.6 },
      { x: 40, y: 5, zoom: 0.75 },
    ];
    for (const cam of cameras) {
      for (const level of levels) {
        const [x, y] = firstTileAt(input, level);
        assertRoundTrip(x + 0.5, y + 0.5, level, cam, vp, `tel_marum tile (${x},${y}) at level ${level}, cam ${JSON.stringify(cam)}`);
      }
    }
  });
});

// --- break checks -----------------------------------------------------
//
// "Before you commit, break each invariant your suite claims to cover and
// report which test caught it and what it said." `packages/render/src/
// three/terrain/*.ts` (and `ThreeRenderer.ts`) are off limits to edit while
// a review runs over them, so the mechanism a real regression in one of
// those files would actually go through cannot be sabotaged directly here.
// What follows instead breaks each invariant at the boundary this suite
// itself controls: a hand-built `MeshData` for the palette check (proving
// the check rejects a colour that never went through `quantise`, since
// `quantise` is unconditional and total over any hex input -- there is no
// way to make a REAL builder emit an off-palette colour through its public
// input surface, which is the point of it existing), a hand-derived
// "wrong camera" for the round-trip check (reproducing, from `camera.ts`'s
// own doc comments on its right/up axes and half-extents, what a height
// constant desynced from the camera's own pitch looks like -- without
// touching `camera.ts` itself), and a deliberately flattened `TerrainInput`
// fed to the REAL, unmodified `buildGround` for the tile-count check.
describe('break checks: proving each assertion actually discriminates', () => {
  it('the palette check rejects a colour that never went through quantise', () => {
    // An arbitrary mid-grey. Not hand-picked to dodge the palette -- verified
    // below, at runtime, rather than asserted by construction, which is the
    // point: this proves the CHECK catches a real off-palette value, not
    // that a specific literal happens to be one.
    const r = 128;
    const g = 130;
    const b = 132;
    const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    expect(PALETTE_ENTRIES.has(hex), `${hex} needs to be off-palette for this test to mean anything`).toBe(false);

    const bad: MeshData = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
      colors: Float32Array.from(
        Array(4)
          .fill(0)
          .flatMap(() => [r / 255, g / 255, b / 255])
      ),
      indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
    };
    expect(() => assertPaletteColors(bad, 'synthetic off-palette mesh')).toThrow(/is not a palette entry/);
  });

  it('the round-trip check catches a height constant desynced from the camera pitch -- but only at a raised tile', () => {
    // `camera.ts`'s own doc comment on `ELEVATION`: "atan(TILE_H/TILE_W) is a
    // different, wrong angle that also happens to pass every ground-only
    // test above." Reproduced here as a companion projection using exactly
    // the right/up axes and half-extent formulas that same doc comment
    // derives -- not `camera.ts` itself, which stays untouched -- with the
    // camera's own pitch correct but the height-per-lift-pixel constant
    // computed from the wrong angle instead, the shape of bug two
    // independently-tuned constants going out of sync produces.
    const correctEl = Math.asin(TILE_H / TILE_W);
    const wrongEl = Math.atan(TILE_H / TILE_W);

    function wrongWorldToScreen(wx: number, wy: number, cam: Camera, vp: Viewport, lift: number): { x: number; y: number } {
      const sinCam = Math.sin(correctEl);
      const cosCam = Math.cos(correctEl);
      const worldYPerLiftPixel = (Math.SQRT2 * Math.tan(wrongEl)) / TILE_H;
      const liftY = lift * worldYPerLiftPixel;
      const rightAxis: [number, number, number] = [Math.SQRT1_2, 0, -Math.SQRT1_2];
      const upAxis: [number, number, number] = [-sinCam * Math.SQRT1_2, cosCam, -sinCam * Math.SQRT1_2];
      const halfWidth = vp.width / (TILE_W * cam.zoom * Math.SQRT2);
      const halfHeight = (vp.height * sinCam) / (TILE_H * cam.zoom * Math.SQRT2);
      const dx = wx - cam.x;
      const dy = liftY;
      const dz = wy - cam.y;
      const ndcX = (dx * rightAxis[0] + dz * rightAxis[2]) / halfWidth;
      const ndcY = (dx * upAxis[0] + dy * upAxis[1] + dz * upAxis[2]) / halfHeight;
      return { x: ((ndcX + 1) / 2) * vp.width, y: ((1 - ndcY) / 2) * vp.height };
    }

    const cam: Camera = { x: 24, y: 24, zoom: 1 };
    const vp: Viewport = { width: 800, height: 600 };

    const flatPixi = worldToScreen(13.5, 10.5, cam, vp, 0);
    const flatWrong = wrongWorldToScreen(13.5, 10.5, cam, vp, 0);
    expect(flatWrong.y, 'a desynced height constant is invisible at elevation 0 -- ground alone cannot catch it').toBeCloseTo(
      flatPixi.y,
      3
    );

    const raisedLift = 4 * ELEV_STEP;
    const raisedPixi = worldToScreen(13.5, 10.5, cam, vp, raisedLift);
    const raisedWrong = wrongWorldToScreen(13.5, 10.5, cam, vp, raisedLift);
    expect(
      Math.abs(raisedWrong.y - raisedPixi.y),
      'a desynced height constant should be caught at a raised tile'
    ).toBeGreaterThan(1);
  });

  it('the tile-count assertion is sensitive to a missing side face -- and only relief can exercise it', () => {
    const relief = loadMap('tel_marum');
    // As if buildGround silently dropped every elevation face: fed to the
    // REAL, unmodified buildGround, not a hand-simulated count.
    const flattened: TerrainInput = { ...relief.input, elevation: null };
    const brokenMesh = buildGround(flattened, relief.tones, BACKGROUND);
    const realExpected = expectedGroundIndexCount(relief.input);
    expect(brokenMesh.indices.length).not.toBe(realExpected);

    // Contrast: on a genuinely flat map, the same mistake (elevation -> null)
    // changes nothing, because there was no relief to lose -- proving why the
    // brief calls out that a flat map "cannot exercise a single elevation
    // side face" and this check needs tel_marum specifically.
    const flat = loadMap('marj_perimeter');
    const flatFlattened: TerrainInput = { ...flat.input, elevation: null };
    expect(buildGround(flatFlattened, flat.tones, BACKGROUND).indices.length).toBe(
      expectedGroundIndexCount(flat.input)
    );
  });

  it('the non-emptiness guard rejects an unlisted empty mesh, and only an unlisted one', () => {
    // Proves KNOWN_EMPTY/assertNonEmptyUnless itself discriminates, since it
    // is what stood between the palette check and quietly checking nothing
    // on grove meshes, every one of which is now legitimately empty (Task
    // 7 retired the `composeTerrain` -> `buildGroves` call) -- see that
    // constant's own doc comment. An empty mesh with no KNOWN_EMPTY entry
    // must fail; a listed entry must not.
    const empty: MeshData = { positions: new Float32Array(0), colors: new Float32Array(0), indices: new Uint32Array(0) };
    expect(() => assertNonEmptyUnless(empty, 'not_a_real_map:ground', 'unlisted empty mesh')).toThrow(
      /emitted no geometry/
    );
    expect(() => assertNonEmptyUnless(empty, 'tel_marum:grove', 'tel_marum grove')).not.toThrow();
  });
});
