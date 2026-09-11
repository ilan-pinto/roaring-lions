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
        { type: 'dozer_d9', veterancy: 0 },
      ],
      { squad: 0, vehicle: 0, task: 0 },
      kindOf,
      table
    );
    expect(roster.map((r) => r.name)).toEqual(['Sela', '2-1 Gachelet', 'Barzel', 'Eye Two', '1-2 Ayil']);
    expect(issued).toEqual({ squad: 2, vehicle: 1, task: 1 });
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

  it('wraps a vehicle by cycling the hull number, not by a numeral', () => {
    // Spec §4.7: a vehicle is a hull number and a painted name, and two tanks
    // carrying the same hull is the one thing that definition cannot survive.
    // The table holds three, so the fourth vehicle is Ayil again -- repainted
    // 2-2, not called "1-2 Ayil II".
    const { roster, issued } = assignNames(
      Array.from({ length: 6 }, () => ({ type: 'mbt_lavi', veterancy: 0 })),
      { squad: 0, vehicle: 0, task: 0 },
      kindOf,
      table
    );
    expect(roster.map((r) => r.name)).toEqual([
      '1-2 Ayil',
      '2-1 Gachelet',
      '2-4 Yated',
      '2-2 Ayil',
      '3-1 Gachelet',
      '3-4 Yated',
    ]);
    expect(issued.vehicle).toBe(6);
  });

  it('reaches for the Roman numeral only once the hull digit has run out of room', () => {
    const nth = (n: number): string =>
      assignNames([{ type: 'mbt_lavi', veterancy: 0 }], { squad: 0, vehicle: n, task: 0 }, kindOf, table).roster[0]
        .name as string;
    // Ayil starts at 1, so its ninth pass is the last digit a hull can hold.
    expect(nth(24)).toBe('9-2 Ayil');
    expect(nth(27)).toBe('9-2 Ayil II');
    expect(nth(30)).toBe('9-2 Ayil III');
  });

  it('gives thirty vehicles thirty different names', () => {
    // The property the hull cycle exists for. Three table entries would have
    // repainted the same three hulls ten times over under the old suffix rule.
    const names = Array.from(
      { length: 30 },
      (_, n) =>
        assignNames([{ type: 'mbt_lavi', veterancy: 0 }], { squad: 0, vehicle: n, task: 0 }, kindOf, table).roster[0]
          .name as string
    );
    expect(new Set(names).size).toBe(30);
  });

  it('is pure: the input roster is not mutated', () => {
    const input = [{ type: 'inf_squad', veterancy: 0 }];
    assignNames(input, { squad: 0, vehicle: 0, task: 0 }, kindOf, table);
    expect(input[0]).toEqual({ type: 'inf_squad', veterancy: 0 });
  });
});
