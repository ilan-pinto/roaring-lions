/**
 * PA-25: a Free Play sandbox's feed.
 *
 * The alert layer (`alerts.ts`) already words every ordinary combat line --
 * a man of ours under fire, pinned, broken, a vehicle hit, an enemy killed,
 * a unit lost -- and `alert-world.ts` already answers for a world with no
 * mission. The sandbox was simply never handed to it: `main.ts` ran the
 * layer inside `if (runtime && mission)`, so in Free Play units died in
 * silence and the feed stayed empty for the whole session.
 *
 * One half of that layer is not the sim's. A loss of ours is a MISSION event
 * (`unitLost`), emitted by `MissionRuntime.step` from the sim's own
 * `destroyed`; a sandbox has no runtime, so this derives the same event by
 * the same rule (`mission.ts`: a `destroyed` whose entity is side 0, with or
 * without a killer). Nothing else a runtime emits -- objectives, waves,
 * Conduct, triggers -- exists in a sandbox, and none of it is invented here:
 * Free Play scores nothing.
 *
 * Pure: it reads two lookups and returns the alerts; `main.ts` places them.
 */

import type { MissionEvent, SimEvent } from '@lions/sim';
import { alertsForTick, type Alert, type AlertState, type AlertWorld } from './alerts';

/** The `unitLost` events a runtime would have emitted for this tick. */
export function sandboxLosses(
  events: readonly SimEvent[],
  sideOf: (entity: number) => number,
  typeOf: (entity: number) => string,
  tick: number
): MissionEvent[] {
  const out: MissionEvent[] = [];
  for (const e of events) {
    if (e.kind === 'destroyed' && sideOf(e.entity) === 0) {
      out.push({ kind: 'unitLost', tick, entity: e.entity, side: 0, unit: typeOf(e.entity) });
    }
  }
  return out;
}

/** One sandbox tick through the alert layer: the sim's own events plus the
 *  losses above, and nothing a mission would add. */
export function sandboxAlertsForTick(
  state: AlertState,
  events: readonly SimEvent[],
  world: AlertWorld,
  tick: number
): { state: AlertState; alerts: Alert[] } {
  return alertsForTick(state, events, sandboxLosses(events, world.sideOf, world.typeOf, tick), world, tick);
}
