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

  it('names the scout car by its recon role, not the squad fallback', () => {
    // R1 (docs/campaign/special_units/design.md §4): `recon` joins
    // `kinds.vehicle_roles` in the same commit as the unit, since the Shachaf
    // is a scout car and would otherwise fall through to the squad table.
    expect(nameKind({ id: 'scout_shachaf', role: 'recon' }, table)).toBe('vehicle');
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
    // F6: task index 0 is `Eye Two`, not `Eye One` -- names.json §7 rule 3 is
    // append-only, and `Eye Two`/`Kite One` are the two pre-existing entries
    // (commit 15a2b5c) restored to indices 0/1 ahead of the 22 names added
    // alongside the motivation layer.
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
    expect(roster.map((r) => r.name)).toEqual(['Migdal', 'Chatzatz']);
    expect(issued.squad).toBe(7);

    // Past the last of the 40 callsigns (docs/campaign/names.md §4, ceiling 40)
    // the counter wraps to the head of the list with a lineage numeral: squad
    // 39 is "Kivun", the table's last entry, and squad 40 is "Sela" again.
    const wrapped = assignNames(
      [{ type: 'inf_squad', veterancy: 0 }, { type: 'inf_squad', veterancy: 0 }],
      { squad: 39, vehicle: 0, task: 0 },
      kindOf,
      table
    );
    expect(wrapped.roster.map((r) => r.name)).toEqual(['Kivun', 'Sela II']);
    expect(wrapped.issued.squad).toBe(41);
  });

  it('wraps a vehicle by cycling the hull number, not by a numeral', () => {
    // Spec §4.7: a vehicle is a hull number and a painted name, and two tanks
    // carrying the same hull is the one thing that definition cannot survive.
    // The 25-entry table (docs/campaign/names.md §4) does not wrap within six
    // draws from counter 0.
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
      '4-2 Kardom',
      '7-2 Mesor',
      '5-1 Mafuach',
    ]);
    expect(issued.vehicle).toBe(6);

    // From counter 22 the draw crosses the table's 25-entry end: the wrap
    // repaints the hull's first digit rather than appending a numeral to the
    // painted name.
    const wrapped = assignNames(
      Array.from({ length: 6 }, () => ({ type: 'mbt_lavi', veterancy: 0 })),
      { squad: 0, vehicle: 22, task: 0 },
      kindOf,
      table
    );
    expect(wrapped.roster.map((r) => r.name)).toEqual([
      '1-9 Machsan',
      '4-9 Metach',
      '7-9 Mafselet',
      '2-2 Ayil',
      '3-1 Gachelet',
      '3-4 Yated',
    ]);
    expect(wrapped.issued.vehicle).toBe(28);
  });

  it('reaches for the Roman numeral only once the hull digit has run out of room', () => {
    const nth = (n: number): string =>
      assignNames([{ type: 'mbt_lavi', veterancy: 0 }], { squad: 0, vehicle: n, task: 0 }, kindOf, table).roster[0]
        .name as string;
    // Mesor's hull starts at 7, so its third pass (7+2=9) is the last digit a
    // hull can hold; the fourth pass is where the Roman numeral takes over.
    expect(nth(54)).toBe('9-2 Mesor');
    expect(nth(79)).toBe('9-2 Mesor II');
    expect(nth(104)).toBe('9-2 Mesor III');
  });

  it('gives sixty-nine vehicles sixty-nine distinct hull numbers', () => {
    // docs/campaign/names.md §4: the 25-entry table is laid out so that no two
    // entries' first three passes collide, which covers a full campaign's
    // measured draw of ~69 vehicles with margin (the first hull collision is
    // at issue 75, past this).
    const names = Array.from(
      { length: 69 },
      (_, n) =>
        assignNames([{ type: 'mbt_lavi', veterancy: 0 }], { squad: 0, vehicle: n, task: 0 }, kindOf, table).roster[0]
          .name as string
    );
    expect(new Set(names.map((name) => name.split(' ')[0])).size).toBe(69);
  });

  it('issues the two pre-existing task names first, then the rest in table order', () => {
    // F6 / names.md §7 rule 3: table order is issue order, and a counter on a
    // live save is an index into it -- inserting ahead of an already-shipped
    // entry silently re-points a future issue to a name already given to
    // someone else. `Eye Two` and `Kite One` are the two entries that shipped
    // before the motivation layer (commit 15a2b5c); the 22 names added since
    // are appended after them in the order they appear in the table, not
    // grouped by callsign block the way a from-scratch table would read.
    const names = Array.from(
      { length: 24 },
      (_, n) =>
        assignNames([{ type: 'recon_drone', veterancy: 0 }], { squad: 0, vehicle: 0, task: n }, kindOf, table)
          .roster[0].name as string
    );
    expect(names.slice(0, 7)).toEqual([
      'Eye Two',
      'Kite One',
      'Eye One',
      'Lens One',
      'Gimbal One',
      'Aperture One',
      'Spool One',
    ]);
    expect(new Set(names).size).toBe(24);
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
