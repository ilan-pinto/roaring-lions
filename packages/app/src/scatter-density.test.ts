/**
 * Ground plan 2, Task 1 (G8): the real-map density check for clustered
 * grass and sand. `decorPlacements`'s clustering pass (`decor-place.ts`)
 * cannot be exercised against real shipped map data from inside
 * `packages/render` -- `eslint.config.mjs` bans that package from importing
 * `@lions/data`, which is what turns `data/maps/*.json` into the `Sim` +
 * `TerrainInput` this needs. Same reason `ground-texture-slots.test.ts` and
 * `terrain-parity.test.ts` live here rather than alongside the builders they
 * test.
 */
import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { applyTerrain, maps, parseMap, structures as structureCatalogue, type MapId } from '@lions/data';
import {
  DECOR_GROVE,
  PROP_CAP,
  SCATTER_ROAD_CLEAR,
  buildRoadGraph,
  decorPlacements,
  propPlacements,
  roadDistanceAt,
  type TerrainInput,
} from '@lions/render/terrain';
import { propKindsFor } from './mesh-catalogue';

const MAP_IDS = Object.keys(maps) as MapId[];

/** The same bring-up as `ground-texture-slots.test.ts`'s `loadInput`, kept
 *  local for the reason that file gives (two suites, no coupling). */
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
  };
}

function openTileCount(i: TerrainInput): number {
  let n = 0;
  for (let t = 0; t < i.width * i.height; t++) {
    const d = i.decor ? i.decor[t] : 0;
    const b = i.boulder ? i.boulder[t] : 0;
    if (i.blocked[t] === 0 && d === 0 && i.cover[t] === 0 && b === 0) n++;
  }
  return n;
}

describe.each(MAP_IDS)('scatter density on %s', (id) => {
  const input = loadInput(id);
  const open = decorPlacements(input).filter((p) => p.family === 'grass' || p.family === 'sand');

  // Measured, not derived: members that land on a road, a building or off the
  // map are dropped (R-3), so a map with more edges reads under the all-open
  // fixture's 0.87. The band is N-1's "0.9" with that loss allowed for.
  it('carries 0.65-1.0 grass and sand objects an open tile', () => {
    const n = openTileCount(input);
    if (n < 500) return; // the tile_* fixtures that are nearly all one surface
    const perTile = open.length / n;
    expect(perTile).toBeGreaterThan(0.65);
    expect(perTile).toBeLessThan(1.0);
  });
  it('keeps every grass and sand object off the road (N-3)', () => {
    const graph = buildRoadGraph(input);
    for (const p of open) expect(roadDistanceAt(graph, p.x, p.z)).toBeGreaterThanOrEqual(SCATTER_ROAD_CLEAR);
  });
});

describe.each(MAP_IDS)('prop placement on %s (ground plan 2, Task 4)', (id) => {
  const input = loadInput(id);
  const placements = propPlacements(input);

  it('never exceeds PROP_CAP', () => {
    expect(placements.length).toBeLessThanOrEqual(PROP_CAP);
  });

  it('never stands on a building, ridge, road surface, grove or cover tile (N-10)', () => {
    for (const p of placements) {
      const t = Math.floor(p.z) * input.width + Math.floor(p.x);
      expect(input.blocked[t], `${p.kind} at (${p.x}, ${p.z})`).toBe(0);
      expect(input.decor?.[t] === DECOR_GROVE).toBe(false);
      expect(input.cover[t]).toBe(0);
    }
  });

  it('places only kinds propKindsFor allows', () => {
    const allowed = propKindsFor(parseMap(maps[id]));
    for (const p of placements) expect(allowed.has(p.kind), p.kind).toBe(true);
  });
});
