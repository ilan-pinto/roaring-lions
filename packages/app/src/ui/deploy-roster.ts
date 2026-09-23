// What deploy is allowed to know about the brigade (spec Decision 4, plan
// R-3/R-4). One read-only adapter between the campaign roster and the deploy
// screen: `deployRosterView` says which pool entries a mission's placements
// could field and how many slots each type has, and `drawFromPool` is the
// one place the spawner's own draw is replayed.
//
// R-3 is why this never removes an entry from the ledger. `starting_force`
// has no field that could bench a placement (`mission.schema.json` pins its
// keys), so deleting an entry from a ledger the runtime reads would delete
// that unit from the campaign permanently -- data loss, not a decision. The
// only thing the app can safely do is reorder the pool a `from_ledger`
// placement draws from (Task 2's `permutePool`); this module only reads.

import type { LedgerData, LedgerRosterEntry, MissionJson } from '@lions/sim';
import { ROSTER_CAP } from '../roster-cap';

/** One pool entry in the player's terms: what a deploy row names and ranks a
 *  body by, plus the index that lets a choice be expressed as a permutation
 *  of the pool (Task 2) rather than a copy of it. */
export interface DeployEntry {
  readonly poolIndex: number;
  readonly type: string;
  readonly typeName: string;
  readonly veterancy: number;
  readonly name?: string;
  readonly missions: number;
  readonly kills: number;
}

/** What deploy may show and choose from, for one mission. Null when the
 *  mission's ledger contract reads nothing (spec §5) -- the same gate
 *  `broughtFor` uses, so a sandbox and First Light get no deploy screen
 *  either. Reads only `roster.surviving_units`; `roster.reserve` (WP-G-E2)
 *  is structurally undrawable -- `MissionRuntime` seeds its pool from
 *  `roster.surviving_units` and nothing else -- so it never appears here. */
export interface DeployRosterView {
  /** One row per pool entry whose TYPE at least one `from_ledger` placement
   *  demands, in pool order. Every body a placement could draw, not only as
   *  many as the mission asks for -- picking which ones is the point. */
  readonly eligible: readonly DeployEntry[];
  /** How many of each type this mission's own placements ask for, in
   *  placement order. Deploy chooses WHO fields those slots, never how many
   *  of them exist (R-3): this count comes from the mission, not a player. */
  readonly demand: ReadonlyMap<string, number>;
  /** Pool entries no placement can draw at all -- their type has no demand.
   *  Never selectable: there is no slot for them. */
  readonly undrawable: readonly DeployEntry[];
  /** The roster cap (`../roster-cap.ts`, WP-G-E2, GH-174): the ceiling
   *  `roster.surviving_units` is bounded to. Filled now that `ROSTER_CAP`
   *  exists; nothing in this task reads it, but the screen's "of N" line can
   *  be written once against a shape that already carries the number. */
  readonly cap: number | null;
}

/**
 * The spawner's own draw, replayed -- not a lookalike. Mirrors
 * `MissionRuntime.spawnPlacement`'s ledger draw, `packages/sim/src/mission.ts:1256-1263`,
 * step for step: each `from_ledger` placement takes up to `count` entries of
 * its type in pool order, one at a time, and an entry taken is out of
 * contention for the next placement (or the next `count` iteration of the
 * same one). Re-read that range before changing this function -- it is the
 * one place this rule lives, so the two must never drift apart again (R-4).
 *
 * Returns pool INDICES, in draw order, rather than entries: an index is the
 * handle that survives a permutation of the pool (Task 2); a copied entry
 * is not.
 */
export function drawFromPool(
  pool: readonly LedgerRosterEntry[],
  starting_force: MissionJson['starting_force']
): readonly number[] {
  const remaining = pool.map((_, i) => i);
  const drawn: number[] = [];
  for (const p of starting_force ?? []) {
    if (p.from_ledger !== true) continue;
    for (let k = 0; k < p.count; k++) {
      const at = remaining.findIndex((i) => pool[i].type === p.unit);
      if (at < 0) break;
      drawn.push(remaining[at]);
      remaining.splice(at, 1);
    }
  }
  return drawn;
}

export function deployRosterView(
  mission: { ledger: { requires: readonly string[] }; starting_force?: MissionJson['starting_force'] },
  ledger: LedgerData,
  unitName: (id: string) => string
): DeployRosterView | null {
  if (!mission.ledger.requires.includes('roster.surviving_units')) return null;

  const pool = ledger['roster.surviving_units'] ?? [];
  const demand = new Map<string, number>();
  for (const p of mission.starting_force ?? []) {
    if (p.from_ledger !== true) continue;
    demand.set(p.unit, (demand.get(p.unit) ?? 0) + p.count);
  }

  const eligible: DeployEntry[] = [];
  const undrawable: DeployEntry[] = [];
  pool.forEach((entry, poolIndex) => {
    const row: DeployEntry = {
      poolIndex,
      type: entry.type,
      typeName: unitName(entry.type),
      veterancy: entry.veterancy,
      ...(entry.name !== undefined ? { name: entry.name } : {}),
      missions: entry.missions ?? 0,
      kills: entry.kills ?? 0,
    };
    (demand.has(entry.type) ? eligible : undrawable).push(row);
  });

  return { eligible, demand, undrawable, cap: ROSTER_CAP };
}
