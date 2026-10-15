import { describe, expect, it } from 'vitest';
import { loanedPlacements, resolveUpgrades, type MissionJson, type UnlockGate } from '@lions/sim';
import { attachedFor } from './attached-force';

const name = (id: string): string => `N:${id}`;

describe('attachedFor (F3 Task 8, S-F)', () => {
  it('marks a lent placement that sits after a from_ledger one by its index into the whole force', () => {
    const force = [
      { unit: 'inf_squad', count: 2, from_ledger: true },
      { unit: 'at_team', count: 1, from_ledger: true },
      { unit: 'apc_eitan', count: 1 },
      { unit: 'mbt_lavi', count: 3 },
    ];
    const out = attachedFor(force, [3], name);
    expect(out).toEqual([
      { type: 'apc_eitan', name: 'N:apc_eitan', count: 1, onLoan: false },
      { type: 'mbt_lavi', name: 'N:mbt_lavi', count: 3, onLoan: true },
    ]);
  });

  it('a placement split by count stays one entry', () => {
    expect(attachedFor([{ unit: 'mbt_lavi', count: 3 }], [0], name)).toHaveLength(1);
  });

  it('nothing lent when loaned is absent or empty', () => {
    const force = [{ unit: 'dozer_d9', count: 1 }];
    expect(attachedFor(force, undefined, name).map((a) => a.onLoan)).toEqual([false]);
    expect(attachedFor(force, [], name).map((a) => a.onLoan)).toEqual([false]);
  });

  it('indices follow the RESOLVED force: a gate_only drop before a lent row shifts it, and upgrades_to changes the unit', () => {
    const mission = {
      starting_force: [
        { unit: 'jeep_shoded', count: 1, at: [1, 1], upgrades_to: 'apc_kipod', gate_only: true },
        { unit: 'inf_squad', count: 1, at: [2, 2], from_ledger: true },
        { unit: 'mbt_lavi', count: 1, at: [3, 3] },
        { unit: 'jeep_shoded', count: 1, at: [4, 4], upgrades_to: 'apc_kipod' },
      ],
    } as unknown as MissionJson;
    // apc_kipod is closed, so the gate_only row is dropped and the other jeep stays a jeep.
    const gates: Record<string, UnlockGate> = { apc_kipod: { starsMin: 1 }, mbt_lavi: { roeMin: 90 } };
    const gateOf = (id: string): UnlockGate | undefined => gates[id];
    const resolved = resolveUpgrades(mission, {}, gateOf).starting_force ?? [];
    const loaned = loanedPlacements(mission, {}, gateOf);
    expect(resolved.map((p) => p.unit)).toEqual(['inf_squad', 'mbt_lavi', 'jeep_shoded']);
    expect(loaned).toEqual([1]);
    // Reading the AUTHORED force with the same indices would mark the ledger row's neighbour
    // wrongly: index 1 there is the from_ledger squad.
    expect(attachedFor(resolved, loaned, name)).toEqual([
      { type: 'mbt_lavi', name: 'N:mbt_lavi', count: 1, onLoan: true },
      { type: 'jeep_shoded', name: 'N:jeep_shoded', count: 1, onLoan: false },
    ]);
  });
});
