// The sheet exporter's own checks (GH-1360 S0): the JSON the python drawer reads. Literal inputs; mutations in the commit message.
import { describe, expect, it } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import { units } from '@lions/data';
import type { Start } from './spacing-census';
import { sheetOf, strayOnBlocked } from './spacing-sheet';

function start(): { st: Start; ids: number[] } {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 16 });
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as unknown as UnitTypeJson));
  sim.setBlocked(9, 9, true);
  const squad = typeOf.get('inf_squad') as number;
  const ids = [
    sim.spawn(squad, 0, fx.from(5.5), fx.from(5.5), 0),
    sim.spawn(squad, 0, fx.from(5.5), fx.from(5.5), 0), // stacked on the first
    sim.spawn(squad, 0, fx.from(15.5), fx.from(15.5), 0),
  ];
  return { st: { name: 'literal', group: 'mission', sim, garrisonIds: new Set() }, ids };
}

describe('sheetOf', () => {
  it('flags the stacked pair, not the team standing alone', () => {
    // mutation: armOf marks no body as overlapping
    const { st, ids } = start();
    const s = sheetOf(st);
    expect(s.today.overlapPairs).toBe(1);
    expect(s.today.bodies.map((b) => [b.id, b.overlap])).toEqual([[ids[0], true], [ids[1], true], [ids[2], false]]);
  });
  it('draws the terrain: a blocked tile is # at its own row and column', () => {
    const s = sheetOf(start().st);
    expect(s.rows[9][9]).toBe('#');
    expect(s.rows[9][8]).toBe('.');
    expect(s.rows).toHaveLength(24);
  });
  it('the layout arm moves the bodies it names and re-reads the overlap', () => {
    // mutation: the layout positions ignored (the layout arm reads the same as today)
    const { st, ids } = start();
    const s = sheetOf(st, { front: 'E', bodies: [{ id: ids[1], x: 8.5, y: 5.5, facing_deg: 90 }] });
    expect(s.layout?.overlapPairs).toBe(0);
    const moved = s.layout?.bodies.find((b) => b.id === ids[1]);
    expect(moved?.x).toBe(8.5);
    expect(moved?.facing).toBeCloseTo(0.25, 9);
    expect(s.layout?.front).toBe('E');
    expect(s.today.bodies.find((b) => b.id === ids[1])?.x).toBe(5.5); // today is untouched
  });
  it('a layout that puts a body on a blocked tile is counted as stray unless it was ordered to garrison', () => {
    // mutation: the layout arm computes onBlocked from today's tile
    const { st, ids } = start();
    const s = sheetOf(st, { bodies: [{ id: ids[2], x: 9.5, y: 9.5 }] });
    expect(strayOnBlocked(s.today)).toBe(0);
    expect(strayOnBlocked(s.layout as NonNullable<typeof s.layout>)).toBe(1);
    const g = sheetOf({ ...st, garrisonIds: new Set([ids[2]]) }, { bodies: [{ id: ids[2], x: 9.5, y: 9.5 }] });
    expect(strayOnBlocked(g.layout as NonNullable<typeof g.layout>)).toBe(0);
  });
});
