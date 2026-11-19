import type { MissionRuntime } from '@lions/sim';
import type { WorksSeat } from '../input/works-call';
import type { ProductionRuntime } from '../ui/production';
import type { RoomEconomyView } from './room-economy';

/**
 * What a field-works room (the lead's ruling, 18 Nov 2026: field works as an annihilation option, KDF v KDF) shows the seat
 * that is looking: ITS works menu, ITS sites and ITS purse, never side 0's by default. The works-only runtime answers every
 * works question by side (`ctx.worksOnly`); these are the seams that bind the viewer's side, as `room-economy.ts` binds an
 * economy room's dock. Room-only code: it loads with the versus kit (`versus-kit.ts`), never on the entry chunk.
 */

/** The works runtime's half a room view reads. */
export type RoomWorksRuntime = Pick<
  MissionRuntime,
  'logisticsOf' | 'worksOffers' | 'constructReason' | 'canCancelWorks' | 'worksAt' | 'unstakedWorksAt' | 'unstakedWorksAtSite' | 'supportCost'
>;

/** The battlefield's works runtime for `side`: the armed click, the card's Cancel and the selection read this. The commands
 *  they send carry the same side (`callWorks`, `callCancelWorks`). */
export function roomWorksSeat(rt: RoomWorksRuntime, side: 0 | 1): WorksSeat {
  return {
    worksOffers: () => rt.worksOffers(side),
    constructReason: (typeId, tx, ty, builders) => rt.constructReason(typeId, tx, ty, builders, side),
    canCancelWorks: (site) => rt.canCancelWorks(site, side),
    worksAt: (structure) => rt.worksAt(structure, side),
    unstakedWorksAt: (tx, ty) => rt.unstakedWorksAt(tx, ty, side),
    unstakedWorksAtSite: (site) => rt.unstakedWorksAtSite(site, side),
  };
}

/** The dock's runtime for `side` in a field-works room: the "Field works" group and the purse, and no unit to build (the
 *  room has no production), no intel and no fire support. */
export function roomWorksDockRuntime(rt: RoomWorksRuntime, side: 0 | 1): ProductionRuntime {
  return {
    get logistics() {
      return rt.logisticsOf(side);
    },
    production: [],
    intel: 0,
    supportCost: (kind) => rt.supportCost(kind),
    buildBlockedReason: () => null,
    canBuild: () => false,
    worksOffers: () => rt.worksOffers(side),
    constructReason: (typeId, tx, ty, builders) => rt.constructReason(typeId, tx, ty, builders, side),
  };
}

/** The strip's purse in a field-works room: the viewer's logistics and no income (no rate is drawn at 0), and no Conduct. */
export function roomWorksPurse(rt: Pick<MissionRuntime, 'logisticsOf'>, side: 0 | 1): RoomEconomyView {
  return { logistics: rt.logisticsOf(side), ratePerMin: 0 };
}
