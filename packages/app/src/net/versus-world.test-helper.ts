import { Sim } from '@lions/sim';
import { applyTerrain, maps, parseMap, type MapId, type ParsedMap } from '@lions/data';
import { standMapStructures } from '../map-sim';
import { versusRoster } from './versus-roster';

/** A bare world for the net tests: the room's seed, the map's terrain and
 *  buildings, every versus unit type registered (`versusRoster()`, so not the
 *  GH-698 held ids that `tools/src/walk_world.ts` and `bootBattlefield` do
 *  register), minus the mission runtime. */
export function buildWorld(mapId: MapId): { sim: Sim; typeOf: Map<string, number>; map: ParsedMap } {
  const map = parseMap(maps[mapId]);
  const sim = new Sim({ seed: 20260727, width: map.width, height: map.height, capacity: 256 });
  applyTerrain(map, sim);
  standMapStructures(sim, map);
  const typeOf = new Map<string, number>();
  for (const u of versusRoster()) typeOf.set(u.id, sim.addUnitType(u as never));
  return { sim, typeOf, map };
}
