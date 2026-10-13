/**
 * Element-wise shape check for a campaign ledger (security review review 559, F4).
 *
 * A ledger is player-editable storage, and an imported save is another
 * player's file. `JSON.parse(...) as LedgerData` is a cast, so `[1, null, {}]`
 * used to arrive as a roster and the first reader to touch `entry.veterancy`
 * threw -- "Something went wrong" on /campaign. This checks every known key's
 * elements, DROPS what is wrong and keeps the rest; it never throws, and a
 * well-formed ledger comes back as the SAME object, so a read that finds
 * nothing to fix writes nothing and moves no hash.
 *
 * Keys it does not know are left exactly as stored: the ledger is open by
 * design (`LedgerData`'s index signature), and a per-key schema for a mission
 * author's future key would be a second validator for one door.
 */
import type { LedgerData } from '@lions/sim';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** Keep elements `keep` maps to something; `undefined` drops one. Same array
 *  back when nothing changed. */
function mapArray<T>(arr: readonly unknown[], keep: (e: unknown) => T | undefined): unknown[] {
  const out: unknown[] = [];
  let changed = false;
  for (const e of arr) {
    const k = keep(e);
    if (k === undefined) changed = true;
    else {
      out.push(k);
      if (k !== e) changed = true;
    }
  }
  return changed ? out : (arr as unknown[]);
}

/** A record's entries, kept where `keep` accepts the value; same object back when nothing changed. */
function mapRecord(r: Rec, keep: (v: unknown) => unknown | undefined): Rec {
  const out: Rec = {};
  let changed = false;
  for (const [k, v] of Object.entries(r)) {
    const kept = k === '__proto__' ? undefined : keep(v);
    if (kept === undefined) changed = true;
    else {
      out[k] = kept;
      if (kept !== v) changed = true;
    }
  }
  return changed ? out : r;
}

/** A record with typed fields: drop the whole element if a REQUIRED field is wrong,
 *  and just the field if an OPTIONAL one is. Same object back when nothing changed. */
function shaped(
  e: unknown,
  required: Readonly<Record<string, (v: unknown) => boolean>>,
  optional: Readonly<Record<string, (v: unknown) => boolean>>,
): Rec | undefined {
  if (!isRec(e)) return undefined;
  for (const [k, ok] of Object.entries(required)) if (!ok(e[k])) return undefined;
  let out: Rec = e;
  for (const [k, ok] of Object.entries(optional)) {
    if (e[k] === undefined || ok(e[k])) continue;
    if (out === e) out = { ...e };
    delete out[k];
  }
  return out;
}

const ROSTER_REQUIRED = { type: isStr, veterancy: isNum } as const;
const ROSTER_OPTIONAL = { name: isStr, missions: isNum, kills: isNum, slot: isNum, enlisted: isStr } as const;
const LOST_REQUIRED = { slot: isNum, type: isStr, veterancy: isNum, missions: isNum, kills: isNum, missionId: isStr, tick: isNum } as const;
const LOST_OPTIONAL = { name: isStr } as const;
const RESULT_REQUIRED = { stars: isNum, roe: isNum, ticks: isNum, lost: isNum } as const;

type KeyRule = (v: unknown) => unknown | undefined;
const stringList: KeyRule = (v) => (Array.isArray(v) ? mapArray(v, (e) => (isStr(e) ? e : undefined)) : undefined);
const numberRecord: KeyRule = (v) => (isRec(v) ? mapRecord(v, (x) => (isNum(x) ? x : undefined)) : undefined);
const rows = (required: Readonly<Record<string, (v: unknown) => boolean>>, optional: Readonly<Record<string, (v: unknown) => boolean>>): KeyRule =>
  (v) => (Array.isArray(v) ? mapArray(v, (e) => shaped(e, required, optional)) : undefined);

const RULES: Readonly<Record<string, KeyRule>> = {
  'roster.surviving_units': rows(ROSTER_REQUIRED, ROSTER_OPTIONAL),
  'roster.reserve': rows(ROSTER_REQUIRED, ROSTER_OPTIONAL),
  'roster.lost': rows(LOST_REQUIRED, LOST_OPTIONAL),
  'campaign.completed_missions': stringList,
  'intel.marked_positions': stringList,
  'roe.mission_ratings': numberRecord,
  'civ.hostages_recovered': numberRecord,
  'campaign.names_issued': numberRecord,
  'campaign.mission_results': (v) =>
    isRec(v) ? mapRecord(v, (x) => shaped(x, RESULT_REQUIRED, {})) : undefined,
  'roe.cumulative_rating': (v) => (isNum(v) ? v : undefined),
  'civ.settlements_evacuated': (v) => (isNum(v) ? v : undefined),
  'campaign.slots_issued': (v) => (Number.isInteger(v) ? v : undefined),
};

/** `ledger` with every known key's elements checked; wrong ones dropped, a wrong
 *  container removed outright (a missing key is the shape an old save has). */
export function sanitiseLedger<L extends LedgerData>(ledger: L): L {
  if (!isRec(ledger)) return {} as L;
  let out: Rec = ledger;
  for (const [key, rule] of Object.entries(RULES)) {
    if (!Object.hasOwn(ledger, key) || ledger[key] === undefined) continue;
    const kept = rule(ledger[key]);
    if (kept === ledger[key]) continue;
    if (out === ledger) out = { ...ledger };
    if (kept === undefined) delete out[key];
    else out[key] = kept;
  }
  return out as L;
}
