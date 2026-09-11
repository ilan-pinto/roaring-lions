import { describe, expect, it } from 'vitest';
import namesJson from '../../../data/campaign/names.json';
import { assignNames, nameKind, type NamesJson } from './names';

const table = namesJson as NamesJson;
const kindOf = (typeId: string): ReturnType<typeof nameKind> => {
  const roles: Record<string, string> = { inf_squad: 'infantry', mbt_lavi: 'mbt', recon_drone: 'drone', dozer_d9: 'engineer', heli_peten: 'gunship' };
  return nameKind({ id: typeId, role: roles[typeId] ?? 'infantry' }, table);
};

describe('nameKind', () => {
  it('reads the kind from the table, with the id override for the D9', () => {
    expect(kindOf('inf_squad')).toBe('squad');
    expect(kindOf('mbt_lavi')).toBe('vehicle');
    expect(kindOf('recon_drone')).toBe('task');
    expect(kindOf('heli_peten')).toBe('task');
    expect(kindOf('dozer_d9')).toBe('vehicle');
  });
});

describe('assignNames', () => {
  it('names the unnamed in table order and leaves the named alone', () => {
    const { roster, issued } = assignNames(
      [
        { type: 'inf_squad', veterancy: 0 },
        { type: 'mbt_lavi', veterancy: 1, name: '2-1 Gachelet' },
        { type: 'inf_squad', veterancy: 2 },
        { type: 'recon_drone', veterancy: 0 },
      ],
      { squad: 0, vehicle: 0, task: 0 },
      kindOf,
      table
    );
    expect(roster.map((r) => r.name)).toEqual(['Sela', '2-1 Gachelet', 'Barzel', 'Eye Two']);
    expect(issued).toEqual({ squad: 2, vehicle: 0, task: 1 });
  });

  it('continues from the issued counter and wraps with a numeral', () => {
    const { roster, issued } = assignNames(
      [{ type: 'inf_squad', veterancy: 0 }, { type: 'inf_squad', veterancy: 0 }],
      { squad: 5, vehicle: 0, task: 0 },
      kindOf,
      table
    );
    expect(roster.map((r) => r.name)).toEqual(['Migdal', 'Sela II']);
    expect(issued.squad).toBe(7);
  });

  it('is pure: the input roster is not mutated', () => {
    const input = [{ type: 'inf_squad', veterancy: 0 }];
    assignNames(input, { squad: 0, vehicle: 0, task: 0 }, kindOf, table);
    expect(input[0]).toEqual({ type: 'inf_squad', veterancy: 0 });
  });
});
