// packages/app/src/roster-lost.ts
/**
 * Who was lost, and who took their place (WP-G-E4, GH-176).
 *
 * `roster.lost` is the memorial half of a service record: an append-only list
 * of `LostRecord`s, one per unit that died while it still held a `slot`. It is
 * never counted against the roster cap (R-6) -- `splitRoster` (`roster-cap.ts`)
 * runs over `roster.surviving_units` + `roster.reserve` only.
 *
 * ## The capture is a read, not a diff
 *
 * `MissionRuntime.step` already emits `{ kind: 'unitLost'; tick; entity; side:
 * 0; unit }` for every player-side death (`mission.ts:1018-1025`), and
 * `entityRoster` is only ever added to (`mission.ts:1304`; no `delete`, no
 * `clear` anywhere in that file) -- so the dead unit's own ledger entry is
 * still readable through `runtime.rosterEntryOf(me.entity)` at the exact tick
 * it died. `main.ts` calls `lostRecordFor` there, once per `unitLost` event,
 * and keeps the result in a per-mission list until the victory write.
 *
 * ## Only a unit with a slot gets a memorial (R-11)
 *
 * A fresh remnant spawned and killed inside one mission never reached the
 * roster (`spawnPlacement`'s one-per-type substitute, `mission.ts:1254-1267`,
 * draws no ledger entry for it) and has no place in the order of battle to
 * leave vacant -- a memorial for it would be a memorial for nobody.
 * `lostByType()`'s aggregate (`mission.ts:741-749`) still counts every dead
 * player entity regardless, and Task 7 keeps that aggregate as the total
 * beside the named list, unchanged. A save written before this branch has no
 * slots during its first mission, so that mission's deaths leave no memorial
 * -- a documented gap (plan R-7), closed by that mission's own victory write.
 *
 * ## A vacancy is derived, never flagged (R-6)
 *
 * A slot is a place, not a body: the entry that once held it and the memorial
 * record left behind share the same `slot` number, so "is this slot vacant"
 * is answered by looking at who is standing in it RIGHT NOW rather than by a
 * flag that could drift out of sync. `fillVacancies` asks exactly that -- does
 * any entry in `roster.surviving_units` or `roster.reserve` still carry this
 * slot -- and hands an unheld slot to the next slotless body of the same
 * type, newest vacancy first. A slot can therefore accumulate a whole
 * history -- held, lost, refilled, lost again -- and `predecessorOf` answers
 * with its most recent chapter.
 *
 * ## Why `fillVacancies` takes `reserve` as well as `roster`
 *
 * A stood-down veteran (WP-G-E2's overflow) still holds their slot; only
 * death vacates one. Building the held-slot set from `roster` alone would let
 * a replacement take a living veteran's place the moment the cap pushed that
 * veteran into `roster.reserve` -- two bodies in one place in the order of
 * battle, and a card naming a predecessor who is still alive. Both inputs are
 * READ, never mutated: this function only ever writes to `roster`'s own
 * returned copy.
 */
import type { LostRecord, RosterEntry } from './ledger-store';

/**
 * The memorial record for one death, or `null` if the dead unit never held a
 * slot (R-11). `unit` is the sim's own type id at the moment of death
 * (`unitLost`'s `unit` field) rather than `entry.type`, because the whole
 * point of reading `entry` here is the identity and history it carries, not
 * what it was built from -- the two agree in every case this can fire, but
 * the death event is the fact actually being recorded.
 */
export function lostRecordFor(
  entry: Readonly<RosterEntry> | undefined,
  unit: string,
  missionId: string,
  tick: number,
): LostRecord | null {
  if (entry === undefined || entry.slot === undefined) return null;
  return {
    slot: entry.slot,
    ...(entry.name !== undefined ? { name: entry.name } : {}),
    type: unit,
    veterancy: entry.veterancy,
    missions: entry.missions ?? 0,
    kills: entry.kills ?? 0,
    missionId,
    tick,
  };
}

/**
 * Append this mission's memorial records to the ledger's own list. Never
 * removes, reorders or de-duplicates -- a slot lost twice keeps both
 * chapters, which is what makes `roster.lost` a record rather than a lookup
 * table.
 */
export function appendLost(lost: readonly LostRecord[], fresh: readonly LostRecord[]): LostRecord[] {
  return [...lost, ...fresh];
}

/**
 * Hand a vacant slot of the right type to a slotless body, newest vacancy
 * first. `roster` and `reserve` are read only, to build the held-slot set
 * (R-6's "still standing somewhere" test); every returned entry is `roster`'s
 * own, in the same order and the same length -- `reserve` is never returned
 * or altered.
 *
 * **Recency is ARRAY ORDER, never `tick`.** `roster.lost` is append-only
 * (`appendLost`), so a later record is a later loss; `tick` is the sim's
 * count WITHIN one mission and restarts at 0 every time a mission boots, so a
 * death late in a long mission carries a higher tick than a death early in
 * the next one. Ordering by it offered the older vacancy first (final review,
 * Important 1).
 *
 * A vacancy is one per SLOT, not one per memorial record: a slot lost twice
 * with no refill in between is still a single place, and its LAST unheld
 * record is the one offered (`predecessorOf`'s own rule, applied here to
 * decide ordering rather than to answer a query). Vacancies are then offered
 * newest-first, and each is consumed by the first still-slotless entry of its
 * type in `roster`'s own order -- so a body can take at most one vacancy, and
 * a vacancy can be given to at most one body.
 */
export function fillVacancies(
  roster: readonly RosterEntry[],
  lost: readonly LostRecord[],
  reserve: readonly RosterEntry[],
): RosterEntry[] {
  const held = new Set<number>();
  for (const entry of roster) if (entry.slot !== undefined) held.add(entry.slot);
  for (const entry of reserve) if (entry.slot !== undefined) held.add(entry.slot);

  // Walked from the END, so the first record met for a slot is its last, and
  // the list comes out newest-first with no sort at all.
  const offered = new Set<number>();
  const vacancies: LostRecord[] = [];
  for (let i = lost.length - 1; i >= 0; i--) {
    const record = lost[i];
    if (held.has(record.slot) || offered.has(record.slot)) continue;
    offered.add(record.slot);
    vacancies.push(record);
  }

  const out = roster.map((entry) => ({ ...entry }));
  for (const vacancy of vacancies) {
    // `entry.slot === undefined` excludes every body already given a vacancy
    // earlier in this same loop, which is what stops one body from taking two
    // places and one vacancy from being handed out twice.
    const idx = out.findIndex((entry) => entry.slot === undefined && entry.type === vacancy.type);
    if (idx === -1) continue;
    out[idx] = { ...out[idx], slot: vacancy.slot };
  }
  return out;
}

/** The most recent chapter of a slot's history, or `undefined` if that slot
 *  has never been lost: the LAST record for it in `roster.lost`, which is
 *  append-only and therefore in the order the losses happened. Not the
 *  highest `tick` -- `tick` restarts at 0 every mission, so it orders two
 *  deaths inside one mission and nothing across two. */
export function predecessorOf(lost: readonly LostRecord[], slot: number): LostRecord | undefined {
  for (let i = lost.length - 1; i >= 0; i--) if (lost[i].slot === slot) return lost[i];
  return undefined;
}
