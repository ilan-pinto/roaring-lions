import { describe, expect, it } from 'vitest';
import { startLoadout, type SideView } from './loadout';

function world(rows: [side: number, alive: number, type: string][]): SideView {
  const types = [...new Set(rows.map((r) => r[2]))];
  return {
    count: rows.length,
    side: rows.map((r) => r[0]),
    alive: rows.map((r) => r[1]),
    typeIdx: rows.map((r) => types.indexOf(r[2])),
    typeId: (k) => types[k],
  };
}

describe('startLoadout (GH-254 R-3, R-4)', () => {
  const w = world([
    [0, 1, 'inf_squad'], [0, 1, 'inf_squad'], [0, 1, 'inf_squad'], [0, 1, 'mbt_lavi'],
    [0, 0, 'at_team'],      // dead at tick 0: not deployed
    [1, 1, 'sarim_rifles'], // enemy
    [2, 1, 'civilians'],    // civilians are side 2
  ]);

  it('counts living side-0 units by type as deployed', () => {
    expect(startLoadout(w, undefined, []).deployed).toEqual({ inf_squad: 3, mbt_lavi: 1 });
  });

  it('counts the roster draw with the deploy screen’s own rule, by type only', () => {
    const pool = [
      { type: 'inf_squad', veterancy: 2, name: 'Sgt. Free Text' },
      { type: 'mbt_lavi', veterancy: 0 },
      { type: 'inf_squad', veterancy: 1 },
      { type: 'inf_squad', veterancy: 0 },
    ];
    const force = [
      { unit: 'inf_squad', count: 2, from_ledger: true as const },
      { unit: 'mbt_lavi', count: 1 }, // issued by the mission, not drawn
    ];
    const l = startLoadout(w, pool, force);
    expect(l.fromRoster).toEqual({ inf_squad: 2 });
    expect(JSON.stringify(l)).not.toContain('Free Text');
  });

  it('a mission with no roster pool draws nothing from it', () => {
    expect(startLoadout(w, undefined, [{ unit: 'inf_squad', count: 2, from_ledger: true as const }]).fromRoster).toEqual({});
  });

  it('an unknown type index is skipped, never sent as "undefined"', () => {
    const odd: SideView = { ...w, typeId: () => undefined };
    expect(startLoadout(odd, undefined, []).deployed).toEqual({});
  });
});
