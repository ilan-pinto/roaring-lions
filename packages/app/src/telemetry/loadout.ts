// What a mission was sent in with (GH-254 R-3, R-4): living side-0 units by
// type at the moment `startMission` returns, and how many of them the
// placements drew from the campaign roster. A read of sim arrays through a
// structural view -- never `Sim` itself, never a write (invariant 4).
import type { CountMap } from '@lions/data/telemetry';
import type { LedgerRosterEntry, MissionJson } from '@lions/sim';
import { drawFromPool } from '../ui/deploy-roster';
import { tally, type Loadout } from './events';

/** The four sim arrays and one type lookup the loadout reads. */
export interface SideView {
  readonly count: number;                       // sim.entityCount
  readonly side: ArrayLike<number>;             // sim.state.side
  readonly alive: ArrayLike<number>;            // sim.state.alive
  readonly typeIdx: ArrayLike<number>;          // sim.state.typeIdx
  typeId(idx: number): string | undefined;      // (k) => sim.unitTypes[k]?.id
}

export function startLoadout(
  v: SideView,
  pool: readonly { readonly type: string }[] | undefined,
  startingForce: MissionJson['starting_force']
): Loadout {
  const deployed: CountMap = {};
  for (let i = 0; i < v.count; i++) {
    if (v.side[i] !== 0 || v.alive[i] === 0) continue;
    const id = v.typeId(v.typeIdx[i]);
    // `tally` would accept the string "undefined" as a unit id, so an
    // unknown index is skipped here rather than stringified.
    if (id !== undefined) tally(deployed, id);
  }

  // Stand-ins BEFORE the draw, as `defaultSelection` builds them: only `type`
  // is read off a roster entry, so a player-written `name` never enters this
  // module's data flow. The draw is by type, so veterancy cannot change it.
  const fromRoster: CountMap = {};
  if (pool) {
    const standIns: LedgerRosterEntry[] = pool.map((e) => ({ type: e.type, veterancy: 0 }));
    for (const i of drawFromPool(standIns, startingForce)) tally(fromRoster, standIns[i].type);
  }
  return { deployed, fromRoster };
}
