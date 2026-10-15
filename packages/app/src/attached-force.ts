import type { AttachedUnit } from './ui/force-bar';

/** The slice of a `starting_force` placement the Field order reads. */
export interface ForcePlacement {
  unit: string;
  count: number;
  from_ledger?: boolean;
}

/**
 * The Field order's fixed cards: the mission's own (non-ledger) placements, one
 * entry per placement -- a placement of count 3 is one entry of count 3, never
 * three -- each marked `onLoan` when its index is in `loaned`.
 *
 * `resolvedForce` MUST be the force `loanedPlacements` indexes: the RESOLVED
 * `starting_force`, after `resolveUpgrades`. An `upgrades_to` placement changes
 * its unit and a `gate_only` one is dropped, so indices into the authored array
 * would point at the wrong row. Filtering out `from_ledger` rows happens here,
 * after the indices are read, so a lent placement that follows a ledger one
 * still lands on its own index.
 */
export function attachedFor(
  resolvedForce: readonly ForcePlacement[],
  loaned: readonly number[] | undefined,
  unitName: (type: string) => string
): AttachedUnit[] {
  const lent = new Set(loaned ?? []);
  const out: AttachedUnit[] = [];
  resolvedForce.forEach((p, i) => {
    if (p.from_ledger === true) return;
    out.push({ type: p.unit, name: unitName(p.unit), count: p.count, onLoan: lent.has(i) });
  });
  return out;
}
