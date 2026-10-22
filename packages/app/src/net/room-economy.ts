import { doctrines } from '@lions/data';
import type { Faction } from '@lions/net';
import type { Fx, MissionRuntime } from '@lions/sim';
import type { ProductionRuntime } from '../ui/production';

/**
 * What an economy room (N3 Task 6: KDF against Sarim, `economyRoom`) shows the
 * seat that is looking: the dock, the purse and the population of the VIEWER's
 * side, never side 0's by default.
 *
 * The runtime answers every production question by side (F4, LD6); the dock
 * (`production.ts`) asks the one-side `ProductionRuntime` it always has. This is
 * the seam between them: a view of the runtime with the side bound, so no dock
 * method can reach the other seat's line, purse or cap.
 */

/** The economy runtime's half the room views read: production by side, plus
 *  `supportCost`, which the dock's type asks for although a room draws no
 *  support tile (LD5). */
export type RoomEconomyRuntime = Pick<
  MissionRuntime,
  | 'logisticsOf'
  | 'productionOf'
  | 'productionLines'
  | 'populationView'
  | 'popCapped'
  | 'buildBlockedReason'
  | 'canBuild'
  | 'canSetRally'
  | 'supportCost'
  | 'incomeZones'
  | 'roeScore'
>;

/** The dock's runtime for `side`: every read and pre-check the side's own. The
 *  orders the dock dispatches carry the side too (`ProductionOptions.side`):
 *  this view only answers questions. Intel is 0 and there are no field works:
 *  a versus room has neither (LD5). */
export function roomDockRuntime(rt: RoomEconomyRuntime, side: 0 | 1): ProductionRuntime {
  return {
    get logistics() {
      return rt.logisticsOf(side);
    },
    get production() {
      return rt.productionOf(side);
    },
    intel: 0,
    supportCost: (kind) => rt.supportCost(kind),
    buildBlockedReason: (unitId) => rt.buildBlockedReason(unitId, side),
    popCapped: (unitId) => rt.popCapped(unitId, side),
    populationView: () => rt.populationView(side),
    canBuild: (unitId, line) => rt.canBuild(unitId, line, side),
    // The argument is ignored on purpose: the view is ONE side's.
    productionLines: () => rt.productionLines(side),
    canSetRally: (line: number, x: Fx, y: Fx) => rt.canSetRally(line, x, y, side),
  };
}

/** The unit ids a faction's seat may build, in its doctrine's own order
 *  (`data/doctrines/<faction>.json`): what the dock lists. */
export function roomDockMenu(faction: Faction): readonly string[] {
  return doctrines[faction].menu;
}

/** The strip's purse in an economy room: the viewer's logistics, what its held
 *  zones pay a minute, and Conduct -- the KDF seat's alone (LD7), never shown to
 *  the Sarim seat. A versus room has no base rate (`logisticsRatePerMin` 0, 0),
 *  so the zones are the whole rate. */
export interface RoomEconomyView {
  logistics: number;
  ratePerMin: number;
  /** The KDF seat's Conduct; absent for the Sarim seat (LD7). */
  conduct?: number;
}

export function roomEconomyView(rt: RoomEconomyRuntime, side: 0 | 1, faction: Faction): RoomEconomyView {
  let rate = 0;
  for (const z of rt.incomeZones) if (z.holder === side) rate += z.paysPerMin;
  return {
    logistics: rt.logisticsOf(side),
    ratePerMin: rate,
    ...(showsConduct(faction) ? { conduct: rt.roeScore } : {}),
  };
}

/** LD7: Conduct is the KDF seat's, report-only, and never shown to Sarim. */
export function showsConduct(faction: Faction): boolean {
  return faction === 'kdf';
}
