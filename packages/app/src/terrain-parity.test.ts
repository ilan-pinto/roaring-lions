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
  type TerrainTheme,
} from '@lions/data';
import type { TerrainTones } from '@lions/render';
import {
  buildGround,
  buildScatter,
  buildGroves,
  buildBuildings,
  PALETTE_HEXES,
  WORLD_PER_LEVEL,
  type TerrainInput,
  type MeshData,
  type StructureFootprint,
} from '@lions/render/terrain';
import { worldToScreen, TILE_W, TILE_H, ELEV_STEP, type Camera, type Viewport } from '@lions/render/project';
import { worldToScreenThree } from '@lions/render/three-camera';

// --- world setup: the same steps main.ts takes to go from map JSON to a
// live Sim, minus everything terrain does not need (missions, tunnels,
// units, the renderer itself). main.ts cannot be imported directly -- its
// module body is `main().catch(...)`, which boots the live app against
// `document`/`window` -- so the pieces terrain cares about are reproduced
// here rather than shared. ------------------------------------------------

/**
 * Terrain tones by theme, copied verbatim from `main.ts` (lines ~480-545 at
 * the time of writing) rather than imported, for the reason above. Every
 * shipped map's `terrain` field is `'arid'` or `'green'` (checked below),
 * so this Record stays total without needing a third entry.
 */
const TERRAIN_THEMES: Record<TerrainTheme, TerrainTones> = {
  arid: {
    open: paletteColor('limestone.3'),
    cover: [paletteColor('limestone.2'), paletteColor('dust.1'), paletteColor('dust.0')],
    blocked: paletteColor('limestone.4'),
    underBuilding: paletteColor('shadow.0'),
    road: paletteColor('dust.3'),
    rut: paletteColor('dust.5'),
    rock: paletteColor('limestone.6'),
    rockLit: paletteColor('limestone.3'),
    earth: paletteColor('terracotta.2'),
    low: paletteColor('olive.1'),
    trunk: paletteColor('dust.5'),
    trunkLit: paletteColor('dust.3'),
    leafDark: paletteColor('olive.2'),
    leafMid: paletteColor('olive.1'),
    leafLit: paletteColor('olive.0'),
    bladeLit: paletteColor('limestone.2'),
    bladeShade: paletteColor('limestone.5'),
    spoil: paletteColor('terracotta.1'),
    crownRatio: 0.52,
    scatter: 'stone',
  },
  green: {
    open: paletteColor('grass.2'),
    cover: [paletteColor('grass.4'), paletteColor('scrub.0'), paletteColor('scrub.1')],
    blocked: paletteColor('limestone.4'),
    underBuilding: paletteColor('shadow.0'),
    road: paletteColor('dust.4'),
    rut: paletteColor('dust.6'),
    rock: paletteColor('limestone.6'),
    rockLit: paletteColor('limestone.3'),
    earth: paletteColor('dust.5'),
    low: paletteColor('scrub.0'),
    trunk: paletteColor('dust.5'),
    trunkLit: paletteColor('dust.3'),
    leafDark: paletteColor('scrub.1'),
    leafMid: paletteColor('grass.4'),
    leafLit: paletteColor('grass.2'),
    bladeLit: paletteColor('grass.0'),
    bladeShade: paletteColor('grass.4'),
    spoil: paletteColor('dust.5'),
    crownRatio: 1.5,
    scatter: 'sward',
  },
};

const BACKGROUND = paletteColor('shadow.1');

/**
 * Every LIVING structure as the plain-array snapshot `buildBuildings` needs.
 * Copied from `ThreeRenderer.private structureFootprints()` (which cannot be
 * imported: it is a private method, and `ThreeRenderer.ts` is off limits to
 * edit while a review runs over it) rather than reimplemented from scratch --
 * same walk, same reasoning: `structureAt` is the one query that already
 * gets a `per_tile` structure's shape right, where trusting
 * `structures.minX/maxX/minY/maxY` as a solid rectangle would not.
 */
function structureFootprintsFor(sim: Sim): StructureFootprint[] {
  const { width, height, structures: st, structureTypes } = sim;
  const tilesByStructure = new Map<number, number[]>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sIdx = sim.structureAt(x, y);
      if (sIdx < 0) continue;
      const tiles = tilesByStructure.get(sIdx);
      if (tiles) tiles.push(y * width + x);
      else tilesByStructure.set(sIdx, [y * width + x]);
    }
  }
  const footprints: StructureFootprint[] = [];
  for (const [sIdx, tiles] of tilesByStructure) {
    const type = structureTypes[st.typeIdx[sIdx]];
    footprints.push({
      tiles,
      heightPx: type.heightPx,
      colorKey: type.color,
      hp: st.hp[sIdx],
      maxHp: st.maxHp[sIdx],
    });
  }
  return footprints;
}

interface LoadedMap {
  parsedMap: ReturnType<typeof parseMap>;
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
 * a property of the map's own decor, not a bug. `tel_marum`'s rows contain
 * no `o` (grove) tile at all (checked against the shipped JSON directly), so
 * `buildGroves` correctly returns empty `MeshData` there.
 *
 * This matters because, without `assertNonEmptyUnless` below, "every vertex
 * colour is a palette entry" is checking an empty loop for that one
 * map/builder pair -- passing while verifying nothing, exactly the failure
 * mode this task exists to find and remove (discovered by actually running
 * this suite against real map data and reading the vertex counts, not by
 * inspection). Every OTHER map/builder pair among the five shipped maps
 * produces real geometry (checked directly: ground 9,216-9,964 vertices,
 * scatter 53,140-86,288, buildings 80-1,984, and grove 912-16,368 on the
 * four maps that have olive groves at all) -- so this is the one, named,
 * deliberate hole in an otherwise-total requirement, not a general
 * allowance.
 */
const KNOWN_EMPTY: ReadonlySet<string> = new Set(['tel_marum:grove']);

/** A builder producing real geometry somewhere is the precondition for its
 *  palette check meaning anything -- see `KNOWN_EMPTY`'s doc comment. */
function assertNonEmptyUnless(mesh: MeshData, key: string, label: string): void {
  if (mesh.colors.length === 0 && !KNOWN_EMPTY.has(key)) {
    throw new Error(`${label}: emitted no geometry at all -- either a real regression or a missing KNOWN_EMPTY entry`);
  }
}

/** Elevation level (0-9) at `(x, y)`, or 0 off the map -- mirrors every
 *  terrain builder's own private `levelAt`, redeclared here for the same
 *  reason they redeclare it from each other: five lines is not worth a
 *  shared export for. */
function levelAt(input: TerrainInput, x: number, y: number): number {
  if (x < 0 || x >= input.width || y < 0 || y >= input.height) return 0;
  if (!input.elevation) return 0;
  return input.elevation[y * input.width + x];
}

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
  const { parsedMap, input, footprints, tones } = loadMap(id);

  it('ground mesh has exactly two triangles per tile plus the expected side faces', () => {
    const mesh = buildGround(input, tones, BACKGROUND);
    expect(mesh.indices.length).toBe(expectedGroundIndexCount(input));
  });

  it('every vertex colour across ground, scatter, groves and buildings is a palette entry', () => {
    const ground = buildGround(input, tones, BACKGROUND);
    const scatter = buildScatter(input, tones, BACKGROUND);
    const grove = buildGroves(input, tones, BACKGROUND);
    const buildings = buildBuildings(input, footprints, tones, paletteColor, BACKGROUND);

    // Non-empty first: a palette check on an empty mesh passes by checking
    // nothing (see `KNOWN_EMPTY`'s doc comment -- this is exactly how
    // `tel_marum`'s grove mesh was found to be empty in the first place).
    assertNonEmptyUnless(ground, `${id}:ground`, `${id} ground`);
    assertNonEmptyUnless(scatter, `${id}:scatter`, `${id} scatter`);
    assertNonEmptyUnless(grove, `${id}:grove`, `${id} grove`);
    assertNonEmptyUnless(buildings, `${id}:buildings`, `${id} buildings`);

    assertPaletteColors(ground, `${id} ground`);
    assertPaletteColors(scatter, `${id} scatter`);
    assertPaletteColors(grove, `${id} grove`);
    assertPaletteColors(buildings, `${id} buildings`);
  });

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
    // on tel_marum's (real, legitimately empty) grove mesh -- see that
    // constant's own doc comment. An empty mesh with no KNOWN_EMPTY entry
    // must fail; the one real entry that exists must not.
    const empty: MeshData = { positions: new Float32Array(0), colors: new Float32Array(0), indices: new Uint32Array(0) };
    expect(() => assertNonEmptyUnless(empty, 'not_a_real_map:ground', 'unlisted empty mesh')).toThrow(
      /emitted no geometry/
    );
    expect(() => assertNonEmptyUnless(empty, 'tel_marum:grove', 'tel_marum grove')).not.toThrow();
  });
});
