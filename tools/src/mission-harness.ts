// tools/src/mission-harness.ts
//
// A shipped mission on its shipped map, built the way the app builds it, with
// nothing driving it: the ONE copy of the "real Sim plus real MissionRuntime"
// recipe that tools tests share.
//
// There were three hand copies of this before it existed --
// `backtest/playtest.ts`'s `run()`, `first_light_fence.test.ts`'s
// `passiveResult()` and `roster-carry.test.ts`'s `runMission()` -- and a
// fourth was about to be written for `deploy_choice.test.ts` (shell-upgrade
// Phase 3, Task 4; pre-flight scan M10/E5). The two test copies were
// byte-for-byte the same twenty lines and now call this. `playtest.ts` keeps
// its own: its `run()` also resolves `upgrades_to`, registers max-tier unit
// types, answers `unitInfo` for production and drives a timed plan, none of
// which a passive run needs, and its printed output is a gate that must stay
// byte-identical.
//
// What it builds, in the app's order (`main.ts`'s `bootBattlefield`): a `Sim`
// sized to the map at capacity 256, the map's terrain (`applyTerrain`, the one
// way terrain reaches a `Sim`), every structure type and every building the
// map stands, the map's tunnel routes -- registered from ONE array whose
// position IS the sim's route index, the same array the runtime is handed --
// and every unit type. Then the runtime, started: `start()` spawns the
// starting force, so a caller can read who was fielded before a tick runs.
//
// What it deliberately does NOT do, and why a caller may want to know:
//   - `resolveUpgrades` is not called. The mission is fielded exactly as its
//     JSON is written, the way both test copies always ran it. A mission with
//     an `upgrades_to` placement therefore fields the base unit here.
//   - `unitInfo` answers null for everything: nothing is buildable. The
//     runtime reads it only for production, which a passive run never asks for.
//   - Unit types register from their raw JSON -- no owned upgrade tiers.
//
// The seed defaults to 424242, `playtest.ts`'s own. It is not arbitrary:
// First Light's passive control is seed-sensitive (see
// `first_light_fence.test.ts`) and 424242 is the seed its verdict is pinned at.

import { applyTerrain, maps, missions, parseMap, structures as structureCatalogue, units } from '@lions/data';
import type { ParsedMap } from '@lions/data';
import {
  MissionRuntime,
  Sim,
  TICKS_PER_SECOND,
  type LedgerData,
  type MissionJson,
  type TunnelRouteJson,
} from '@lions/sim';

/** `playtest.ts`'s seed, and the one First Light's passive verdict is pinned at. */
export const HARNESS_SEED = 424242;

/** Twenty minutes of ticks: the ceiling `playtest.ts` gives every mission. A
 *  runtime still `ongoing` past it is a hang, not a result, and throws. */
export const HARNESS_MAX_TICKS = 20 * 60 * TICKS_PER_SECOND;

export interface MissionWorld {
  /** The mission JSON the runtime was built from -- read it rather than
   *  transcribing its placements, so a test cannot pass against a stale copy. */
  readonly mission: MissionJson;
  readonly map: ParsedMap;
  readonly sim: Sim;
  /** Already started: the starting force is on the map. */
  readonly runtime: MissionRuntime;
  /**
   * Ticks the sim and steps the runtime, issuing no orders at all, until the
   * runtime leaves `ongoing`. Returns the ledger the mission produced (its
   * `missionEnd` event's), which `checkEnd` writes on a victory and a defeat
   * alike -- read `runtime.result` for which one it was.
   *
   * Throws past `maxTicks` rather than answering `{}`: a mission that never
   * ends would otherwise hand the caller an empty ledger that reads exactly
   * like one in which every unit was deleted.
   */
  runToEnd(maxTicks?: number): LedgerData;
}

/**
 * Builds `missionId` on its own map and starts it with `ledger` as the
 * campaign state it reads on entry (`ledger.requires`). The ledger is handed
 * to the runtime as given -- the runtime copies its roster pool at
 * construction (`mission.ts:550`), so what the caller passes IS the pool the
 * spawner draws from, in that order.
 */
export function missionWorld(missionId: string, ledger: LedgerData, seed: number = HARNESS_SEED): MissionWorld {
  const found = (missions as Record<string, unknown>)[missionId];
  if (found === undefined) throw new Error(`unknown mission ${missionId}`);
  const mission = found as MissionJson;
  const mapJson = (maps as Record<string, unknown>)[mission.map.file];
  if (mapJson === undefined) throw new Error(`mission ${missionId} names unknown map ${mission.map.file}`);
  const map = parseMap(mapJson as Parameters<typeof parseMap>[0]);

  const sim = new Sim({ seed, width: map.width, height: map.height, capacity: 256 });
  applyTerrain(map, sim);
  const structIdx = new Map<string, number>();
  for (const [id, spec] of Object.entries(structureCatalogue)) {
    structIdx.set(id, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of map.structures) {
    const ti = structIdx.get(b.type);
    if (ti === undefined) throw new Error(`unknown structure type ${b.type}`);
    sim.addStructure(ti, b.tiles);
  }
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
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as Parameters<typeof sim.addUnitType>[0]));

  const runtime = new MissionRuntime(sim, mission, {
    typeIdOf: (id) => {
      const t = typeOf.get(id);
      if (t === undefined) throw new Error(`mission ${missionId} references unknown unit ${id}`);
      return t;
    },
    markers: map.markers,
    zones: map.zones,
    tunnels: tunnelRoutes,
    ledger,
    unitInfo: () => null,
  });
  runtime.start();

  const runToEnd = (maxTicks: number = HARNESS_MAX_TICKS): LedgerData => {
    let produced: LedgerData = {};
    for (let t = 0; t < maxTicks; t++) {
      for (const me of runtime.step(sim.tick())) {
        if (me.kind === 'missionEnd') produced = me.ledger;
      }
      if (runtime.result !== 'ongoing') return produced;
    }
    throw new Error(`${missionId} never ended inside ${maxTicks} ticks`);
  };

  return { mission, map, sim, runtime, runToEnd };
}
