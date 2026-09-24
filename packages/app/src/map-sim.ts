/**
 * Stand a parsed map's buildings in a `Sim`, out of `bootBattlefield` (Task 2
 * of the scene-host plan) -- so a scene host that wants the same buildings a
 * mission gets can ask for them the same way, rather than keeping a second
 * copy of this loop.
 *
 * Buildings are entities, not terrain: each contiguous run of identical map
 * symbols becomes one structure with HP, a garrison and rubble. The type
 * catalogue is registered in full every time (every structure type the game
 * knows, not just the ones this map uses) so a mission that spawns a `camp`
 * mid-run -- the one building type that arrives from mission JSON rather than
 * a map symbol -- still finds a registered type index for it.
 */
import type { Sim } from '@lions/sim';
import { structures as structureCatalogue, type ParsedMap } from '@lions/data';

/**
 * Register every structure type the game knows against `sim`, then stand one
 * structure per run the map declares. Returns the type-id -> sim type-index
 * map, keyed exactly like `structures` (`@lions/data`).
 */
export function standMapStructures(sim: Sim, map: ParsedMap): ReadonlyMap<string, number> {
  const structTypeIdx = new Map<string, number>();
  for (const [id, spec] of Object.entries(structureCatalogue)) {
    structTypeIdx.set(id, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of map.structures) {
    const t = structTypeIdx.get(b.type);
    if (t === undefined) throw new Error(`map references unknown structure type ${b.type}`);
    sim.addStructure(t, b.tiles);
  }
  return structTypeIdx;
}
