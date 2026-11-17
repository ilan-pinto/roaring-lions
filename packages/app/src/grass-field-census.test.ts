/**
 * GH-1167 S1: the census of the five Wadi Halam maps. Lives in `packages/app` for the reason `scatter-density.test.ts`
 * gives: `packages/render` may not import `@lions/data`, which is what turns a shipped map into a `TerrainInput`.
 *
 * Spec §6 S1: clumps per open tile in 12 +/- 1.1 (13 Nov: was 8.4 +/- 0.8) on every map, open `.` tiles only; none on a road, cover, grove,
 * boulder or building.
 */
import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { applyTerrain, maps, parseMap, structures as structureCatalogue, type MapId } from '@lions/data';
import {
  SCATTER_ROAD_CLEAR,
  buildRoadGraph,
  buildTerrainSurface,
  placeGrassClumps,
  roadDistanceAt,
  type TerrainInput,
} from '@lions/render/terrain';
import { terrainTonesFor } from './terrain-themes';

const HALAM: readonly MapId[] = ['wadi_halam_basin', 'wadi_halam_2', 'wadi_halam_3', 'wadi_halam_4', 'wadi_halam_5'] as MapId[];

function loadInput(id: MapId): TerrainInput {
  const pm = parseMap(maps[id]);
  const sim = new Sim({ seed: 20260727, width: pm.width, height: pm.height, capacity: 256 });
  applyTerrain(pm, sim);
  const idx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) {
    idx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of pm.structures) {
    const t = idx.get(b.type);
    if (t === undefined) throw new Error(`map ${id} references unknown structure type ${b.type}`);
    sim.addStructure(t, b.tiles);
  }
  return {
    width: pm.width,
    height: pm.height,
    decor: pm.decor,
    elevation: pm.elevation,
    blocked: sim.blocked,
    cover: sim.cover,
    boulder: pm.boulder,
    familyRemap: terrainTonesFor(pm).familyRemap,
    waterside: terrainTonesFor(pm).waterside,
  };
}

/** An open `.` tile: nothing blocked, covered, drawn as decor (road, grove, ridge, ditch...) or boulder. */
function isOpenTile(i: TerrainInput, t: number): boolean {
  return i.blocked[t] === 0 && i.cover[t] === 0 && (i.decor ? i.decor[t] === 0 : true) && (i.boulder ? i.boulder[t] === 0 : true);
}

describe.each(HALAM)('grass field census on %s', (id) => {
  const input = loadInput(id);
  const clumps = placeGrassClumps(input, buildTerrainSurface(input));
  let open = 0;
  for (let t = 0; t < input.width * input.height; t++) if (isOpenTile(input, t)) open++;

  it('is a green map with real open ground', () => {
    expect(parseMap(maps[id]).terrain).toBe('green');
    expect(open).toBeGreaterThan(1500);
  });

  it('carries 12 +/- 1.1 clumps an open tile', () => {
    const perTile = clumps.count / open;
    expect(perTile).toBeGreaterThan(12 - 1.1);
    expect(perTile).toBeLessThan(12 + 1.1);
  });

  it('puts every clump on an open `.` tile and clear of the road', () => {
    const graph = buildRoadGraph(input);
    for (let i = 0; i < clumps.count; i++) {
      const t = Math.floor(clumps.z[i]) * input.width + Math.floor(clumps.x[i]);
      expect(isOpenTile(input, t)).toBe(true);
      expect(roadDistanceAt(graph, clumps.x[i], clumps.z[i])).toBeGreaterThanOrEqual(SCATTER_ROAD_CLEAR - 1e-4);
    }
  });

  it('is deterministic', () => {
    const again = placeGrassClumps(loadInput(id), buildTerrainSurface(input));
    expect(again.count).toBe(clumps.count);
    expect(Array.from(again.x)).toEqual(Array.from(clumps.x));
    expect(Array.from(again.variant)).toEqual(Array.from(clumps.variant));
  });

});
