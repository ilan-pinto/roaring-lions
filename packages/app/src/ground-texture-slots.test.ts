/**
 * `ThreeRenderer.loadGroundTexture`'s boot-cost fix (2026-09-06, "Ground
 * tiles load unconditionally"): it now skips fetching a ground-albedo image
 * no tile on the CURRENT map can ever sample, decided by
 * `groundAlbedoSlotsUsed` (`@lions/render/terrain`, `terrain/ground.ts`).
 *
 * That function cannot be exercised against real shipped map data from
 * inside `packages/render` at all -- `eslint.config.mjs` bans that package
 * from importing `@lions/data`, which is what turns `data/maps/*.json` into
 * the `Sim` + `TerrainInput` this needs. This suite (a `packages/app` test
 * file, therefore exempt from the production-app `@lions/render/terrain`
 * import restriction the same rule adds) is where the real-map pin has to
 * live, the same reason `terrain-parity.test.ts` lives here rather than
 * alongside the builders it tests.
 *
 * The guard rail this task must not fail: "if a map's tiles can sample a
 * slot the loader would skip, that is the bug this task must not
 * introduce." Asserted by walking the REAL `buildGround` mesh's own masks
 * (`sandMask`/`rockMask`/`roadMask`/`scrubMask`/`groveMask`) for every
 * shipped map -- the exact attributes `groundSurfaceMaterial` samples at
 * render time -- rather than comparing `groundAlbedoSlotsUsed` against
 * itself, which would only prove the function agrees with itself and could
 * never catch a bug shared by both call sites.
 */
import { describe, it, expect } from 'vitest';
import { Sim } from '@lions/sim';
import { maps, parseMap, applyTerrain, structures as structureCatalogue, type MapId } from '@lions/data';
import { buildGround, groundAlbedoSlotsUsed, type TerrainInput, type MeshData } from '@lions/render/terrain';
import { TERRAIN_THEMES } from './terrain-themes';

const BACKGROUND = '#14150F';
const MAP_IDS = Object.keys(maps) as MapId[];

type GroundAlbedoSlot = 'sand' | 'rock' | 'road' | 'scrub' | 'grove';

/**
 * Builds the same `TerrainInput` `ThreeRenderer.loadGroundTexture` now
 * builds -- `sim.width`/`height`/`blocked`/`cover` (populated by
 * `applyTerrain`/`addStructure`, exactly `main.ts`'s own boot sequence) and
 * the map's own `decor`/`elevation` arrays. Not imported from
 * `terrain-parity.test.ts`'s own `loadMap`: that file is under active review
 * elsewhere in this branch, and duplicating a dozen lines of `Sim` bring-up
 * is cheaper than coupling two independent test suites together.
 */
function loadInput(id: MapId): { input: TerrainInput; terrain: 'arid' | 'green' } {
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
  return {
    input: {
      width: parsedMap.width,
      height: parsedMap.height,
      decor: parsedMap.decor,
      elevation: parsedMap.elevation,
      blocked: sim.blocked,
      cover: sim.cover,
    },
    terrain: parsedMap.terrain,
  };
}

/** Which of `buildGround`'s five masks the mesh actually carries a non-zero
 *  value on, read directly off the uploaded geometry the material samples --
 *  an INDEPENDENT walk of the real mesh, not the private per-tile decision
 *  (`albedoFor`) that produced it. */
function slotsInMesh(mesh: MeshData): Set<GroundAlbedoSlot> {
  const used = new Set<GroundAlbedoSlot>();
  const n = mesh.colors.length / 3;
  const has = (arr?: Float32Array): boolean => {
    if (!arr) return false;
    for (let i = 0; i < n; i++) if (arr[i] !== 0) return true;
    return false;
  };
  if (has(mesh.sandMask)) used.add('sand');
  if (has(mesh.rockMask)) used.add('rock');
  if (has(mesh.roadMask)) used.add('road');
  if (has(mesh.scrubMask)) used.add('scrub');
  if (has(mesh.groveMask)) used.add('grove');
  return used;
}

describe.each(MAP_IDS)('ground albedo slot derivation: %s', (id) => {
  it("the derived set is a superset of every albedo the real mesh's own vertices sample", () => {
    const { input, terrain } = loadInput(id);
    const mesh = buildGround(input, TERRAIN_THEMES[terrain], BACKGROUND);
    const meshSlots = slotsInMesh(mesh);
    const derived = groundAlbedoSlotsUsed(input);

    // The superset the task exists to guarantee: every slot the mesh ever
    // samples must be in the derived set, on every shipped map, or the
    // corresponding texture would silently never be fetched.
    for (const slot of meshSlots) {
      expect(derived.has(slot), `${id}: the mesh samples ${slot} but groundAlbedoSlotsUsed omits it`).toBe(true);
    }
    // Not merely a superset by accident: a slot the mesh NEVER samples has
    // no business being in the derived set either -- that is exactly the
    // unconditional-fetch waste this task exists to remove.
    expect([...derived].sort(), `${id}: derived set vs. the mesh's own slots`).toEqual([...meshSlots].sort());
  });
});
