// packages/app/src/ui/idle.ts
/**
 * The idle-unit finder (Task 11, GDD §6): "control groups, idle finder, edge
 * pan, zoom to cursor" listed one thing that did not exist in any form
 * before this file. It is deliberately a plain node module -- `isIdle` and
 * `nextIdle` take a facts struct and an id list, never a `Sim`, so the whole
 * of "what counts as idle" and "which one comes next" is testable with no
 * world at all. `main.ts` is the one place that builds `IdleFacts` from
 * `sim.state` and `sim.waypointCount(id)`.
 */

/** Everything `isIdle` needs to know about one entity. Mirrors the sim's own
 *  typed-array fields by name (`sim.state.moving`, `.curTarget`,
 *  `.curStructure`, `.demoTarget`, `.carriedBy`, `.garrisonedIn`) plus
 *  `sim.waypointCount(id)` for `waypoints` -- so building one in `main.ts` is
 *  a straight read, not a translation. */
export interface IdleFacts {
  alive: boolean;
  side: number;
  moving: boolean;
  waypoints: number;
  curTarget: number;
  curStructure: number;
  demoTarget: number;
  carriedBy: number;
  garrisonedIn: number;
}

/**
 * A unit is idle only when EVERY one of these is the "doing nothing" value --
 * `-1` is the sim's own sentinel for "no target/structure/demolition/carrier/
 * garrison" (`sim.ts`'s `.fill(-1)`), so every comparison below reads the
 * same way. A passenger or a garrisoned unit is not idle-and-forgotten: it is
 * where the player put it, and finding it via this key would walk the player
 * through the same handful of passengers every time they pressed it -- so
 * `carriedBy`/`garrisonedIn` count as work, same as an active order does.
 * Side 0 only: an idle finder that could land the player's selection on the
 * enemy would be a targeting tool wearing a management tool's key.
 */
export function isIdle(f: IdleFacts): boolean {
  return (
    f.alive &&
    f.side === 0 &&
    !f.moving &&
    f.waypoints === 0 &&
    f.curTarget < 0 &&
    f.curStructure < 0 &&
    f.demoTarget < 0 &&
    f.carriedBy < 0 &&
    f.garrisonedIn < 0
  );
}

/**
 * The next idle id strictly after `after` in `ids`' own order, wrapping once
 * back to the front -- so repeated presses cycle the whole idle set exactly
 * once per lap rather than sticking on the first hit. `after` not present in
 * `ids` (the remembered unit died, or nothing has been jumped to yet, coded
 * as `-1`) is treated identically to "start before the front": `indexOf`
 * answers `-1` for both, and a search that starts at `-1 + 1 = 0` begins
 * exactly at the front either way. Returns `-1`, never loops forever, when
 * nobody in `ids` is idle.
 */
export function nextIdle(
  ids: readonly number[],
  after: number,
  idle: (id: number) => boolean
): number {
  const n = ids.length;
  if (n === 0) return -1;
  const startIdx = ids.indexOf(after);
  for (let step = 1; step <= n; step++) {
    const id = ids[(startIdx + step) % n];
    if (idle(id)) return id;
  }
  return -1;
}
