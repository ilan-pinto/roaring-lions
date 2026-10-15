import { applyTerrain, maps, parseMap, units, type MapJson, type ParsedMap } from '@lions/data';
import type { Faction, MatchConfig } from '@lions/net';
import { Sim, type TunnelRouteJson } from '@lions/sim';
import { standMapStructures } from '../map-sim';
import { sandboxAnchors, type SandboxAnchors } from '../sandbox-anchors';
import { upgradePrepass } from '../upgrade-prepass';
import { factionsBySide, versusSpawns } from './versus-force';

/** The world a versus room plays at tick 0. */
export interface MatchWorld {
  sim: Sim;
  typeOf: Map<string, number>;
  mapJson: MapJson;
  /** The parsed map `sim` was built from -- what the renderer is handed. */
  map: ParsedMap;
  anchors: SandboxAnchors;
  factions: [Faction, Faction];
  /** Entity ids each side spawned with, by side. */
  bySide: [number[], number[]];
}

/**
 * The world a versus room plays, from its config alone -- the ONE place the
 * versus boot's sim-state writes live, so the browser (`bootBattlefield`) and
 * a headless client (the AI harness) build the same bytes. A copy in `tools/`
 * would drift silently.
 *
 * The statements are `bootBattlefield`'s own, in its order: the sim, the map's
 * terrain and buildings, the map's own tunnel routes, the unit types the
 * browser's prepass registers (base ladder, no bought tier -- a room's
 * `kit: 'matched'`), the anchors, then the two forces. Throws on a sandbox
 * config, and on a map that is not shipped (the browser's quiet fall-back to
 * another map would put the two machines on different worlds).
 */
export function buildMatchWorld(config: MatchConfig): MatchWorld {
  if (config.mode !== 'versus') throw new Error(`buildMatchWorld: a versus config is required, got mode "${config.mode}"`);
  const mapJson = (maps as Record<string, MapJson | undefined>)[config.map];
  if (mapJson === undefined) throw new Error(`buildMatchWorld: map "${config.map}" is not shipped`);
  const map = parseMap(mapJson);
  // 256: see `bootBattlefield` -- `spawn` never reuses a dead unit's slot.
  const sim = new Sim({ seed: config.seed, width: map.width, height: map.height, capacity: 256 });
  applyTerrain(map, sim);
  standMapStructures(sim, map);

  // Positional: entry r IS the sim's route index, so assert it (see main.ts).
  const tunnelRoutes: TunnelRouteJson[] = map.tunnels.map((t) => ({
    id: t.id,
    points: t.points,
    dig_tiles_per_s: t.digTilesPerS,
    pre_dug: t.preDug,
  }));
  for (let i = 0; i < tunnelRoutes.length; i++) {
    const got = sim.addTunnel(tunnelRoutes[i]);
    if (got !== i) throw new Error(`tunnel "${tunnelRoutes[i].id}" registered as route ${got}, expected ${i}`);
  }

  // A room takes the base ladder for everyone (`bootKit` is `{}` in a room).
  const typeOf = new Map<string, number>();
  for (const registered of upgradePrepass(Object.values(units), {}).registered) {
    typeOf.set(registered.id, sim.addUnitType(registered));
  }

  const anchors = sandboxAnchors(mapJson);
  const factions = factionsBySide(config);
  const { bySide } = versusSpawns(sim, typeOf, anchors, factions);
  return { sim, typeOf, mapJson, map, anchors, factions, bySide };
}
