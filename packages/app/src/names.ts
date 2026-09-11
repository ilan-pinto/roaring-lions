/**
 * Unit names (spec 2026-09-10 §4.7). Assigned HERE, in the app, never in the sim: the
 * sim's per-entity RNG is folded into the state hash, and a draw for a name would move
 * every later combat roll. Determinism comes from table order and a counter on the
 * ledger instead, so the same campaign always names the same units the same way.
 */
import type { LedgerRosterEntry } from '@lions/sim';

export type NameKind = 'squad' | 'vehicle' | 'task';

export interface NamesJson {
  kinds: { task_roles: string[]; vehicle_roles: string[]; vehicle_ids: string[] };
  squads: { name: string; screened: string }[];
  vehicles: { hull: string; name: string; screened: string }[];
  tasks: { name: string; screened: string }[];
}

export function nameKind(unit: { id: string; role: string }, table: NamesJson): NameKind {
  if (table.kinds.task_roles.includes(unit.role)) return 'task';
  if (table.kinds.vehicle_ids.includes(unit.id) || table.kinds.vehicle_roles.includes(unit.role)) return 'vehicle';
  return 'squad';
}

const ROMAN = ['', '', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const suffix = (round: number): string => (round < 2 ? '' : ` ${ROMAN[round] ?? String(round)}`);

function nthName(kind: NameKind, n: number, table: NamesJson): string {
  if (kind === 'vehicle') {
    const v = table.vehicles[n % table.vehicles.length];
    return `${v.hull} ${v.name}${suffix(1 + Math.floor(n / table.vehicles.length))}`;
  }
  const list = kind === 'squad' ? table.squads : table.tasks;
  const e = list[n % list.length];
  return `${e.name}${suffix(1 + Math.floor(n / list.length))}`;
}

export function assignNames(
  roster: readonly LedgerRosterEntry[],
  issued: Record<NameKind, number>,
  kindOf: (typeId: string) => NameKind,
  table: NamesJson
): { roster: LedgerRosterEntry[]; issued: Record<NameKind, number> } {
  const next = { ...issued };
  const out = roster.map((entry) => {
    if (entry.name !== undefined) return { ...entry };
    const kind = kindOf(entry.type);
    const name = nthName(kind, next[kind], table);
    next[kind] += 1;
    return { ...entry, name };
  });
  return { roster: out, issued: next };
}
