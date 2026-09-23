import { describe, expect, it } from 'vitest';
import { appendLost, fillVacancies, lostRecordFor, predecessorOf } from './roster-lost';
import type { LostRecord, RosterEntry } from './ledger-store';

const e = (o: Partial<RosterEntry> & { type: string }): RosterEntry => ({ veterancy: 0, missions: 1, kills: 0, ...o });
const rec = (slot: number, o: Partial<LostRecord> = {}): LostRecord =>
  ({ slot, type: 'inf_squad', veterancy: 1, missions: 2, kills: 3, missionId: 'beit_sahwan_2_foothold', tick: 100, ...o });

describe('lostRecordFor', () => {
  it('records the whole service record of a unit that had one', () => {
    const entry = e({ type: 'inf_squad', name: 'Barkai', veterancy: 2, missions: 4, kills: 11, slot: 7 });
    expect(lostRecordFor(entry, 'inf_squad', 'beit_sahwan_2_foothold', 3200)).toEqual({
      slot: 7, name: 'Barkai', type: 'inf_squad', veterancy: 2, missions: 4, kills: 11,
      missionId: 'beit_sahwan_2_foothold', tick: 3200,
    });
  });

  // R-11. A fresh remnant spawned and killed inside one mission never reached the
  // roster and has no place to leave vacant. `lostByType()` still counts it, which
  // is why the debrief keeps its aggregate beside the named list.
  it('refuses a unit with no slot, and a unit the sim never drew from the roster', () => {
    expect(lostRecordFor(e({ type: 'inf_squad', name: 'Barkai' }), 'inf_squad', 'm', 1)).toBe(null);
    expect(lostRecordFor(undefined, 'inf_squad', 'm', 1)).toBe(null);
  });
});

describe('appendLost', () => {
  it('appends and never removes, reorders or de-duplicates', () => {
    const before = [rec(1), rec(2)];
    const got = appendLost(before, [rec(3)]);
    expect(got.map((l) => l.slot)).toEqual([1, 2, 3]);
    expect(appendLost(got, [rec(3, { tick: 900 })]).map((l) => l.slot)).toEqual([1, 2, 3, 3]);
  });

  // A slot that is lost twice has two chapters, and both are kept. This is what
  // makes `roster.lost` a record rather than a lookup table.
  it('keeps two records for a slot that has been lost twice', () => {
    const twice = appendLost([rec(7, { name: 'Barkai' })], [rec(7, { name: 'Dekel', tick: 5000 })]);
    expect(twice.filter((l) => l.slot === 7)).toHaveLength(2);
  });
});

describe('fillVacancies — the replacement takes the lost slot (R-6)', () => {
  it('gives a new body of the same type the most recent vacant slot', () => {
    const got = fillVacancies([e({ type: 'inf_squad' })], [rec(7, { name: 'Barkai' })], []);
    expect(got[0].slot).toBe(7);
  });

  it('matches on type: a vacancy of another type is left open', () => {
    const got = fillVacancies([e({ type: 'mbt_lavi' })], [rec(7, { type: 'inf_squad' })], []);
    expect(got[0].slot).toBeUndefined();
  });

  // The brief's own falsification. Two losses of one type, one replacement:
  // exactly one pairing, and the older vacancy stays open for the next body.
  it('pairs one replacement to one vacancy, never two', () => {
    const lost = [rec(7, { name: 'Barkai' }), rec(8, { name: 'Dekel', tick: 900 })];
    const got = fillVacancies([e({ type: 'inf_squad' })], lost, []);
    expect(got.map((r) => r.slot)).toEqual([8]);
  });

  it('fills two vacancies newest-first when two bodies arrive', () => {
    const lost = [rec(7), rec(8, { tick: 900 })];
    const got = fillVacancies([e({ type: 'inf_squad' }), e({ type: 'inf_squad' })], lost, []);
    expect(got.map((r) => r.slot)).toEqual([8, 7]);
  });

  // A vacancy is DERIVED (R-6). A slot still held by a living entry -- in the
  // active list or stood down in reserve -- is not vacant, so a replacement can
  // never take a place somebody is standing in.
  it('will not take a slot an active or a stood-down entry still holds', () => {
    const lost = [rec(7), rec(8, { tick: 900 })];
    const held = fillVacancies([e({ type: 'inf_squad', slot: 8 }), e({ type: 'inf_squad' })], lost, []);
    expect(held[1].slot).toBe(7);
    const inReserve = fillVacancies([e({ type: 'inf_squad' })], lost, [e({ type: 'inf_squad', slot: 8 })]);
    expect(inReserve[0].slot).toBe(7);
  });

  it('leaves an entry that already has a slot alone', () => {
    const got = fillVacancies([e({ type: 'inf_squad', slot: 2 })], [rec(7)], []);
    expect(got[0].slot).toBe(2);
  });

  it('is length-preserving and never assigns one slot twice', () => {
    const lost = [rec(7), rec(8, { tick: 900 })];
    const got = fillVacancies([e({ type: 'inf_squad' }), e({ type: 'inf_squad' }), e({ type: 'inf_squad' })], lost, []);
    expect(got).toHaveLength(3);
    expect(new Set(got.map((r) => r.slot).filter((s) => s !== undefined)).size).toBe(2);
  });
});

describe('predecessorOf', () => {
  it('answers with the most recent chapter of that slot', () => {
    const lost = [rec(7, { name: 'Barkai', tick: 100 }), rec(7, { name: 'Dekel', tick: 5000 }), rec(9, { name: 'Nachshon' })];
    expect(predecessorOf(lost, 7)?.name).toBe('Dekel');
    expect(predecessorOf(lost, 9)?.name).toBe('Nachshon');
    expect(predecessorOf(lost, 3)).toBeUndefined();
  });
});

// Final review, Important 1. `tick` is the sim's tick count WITHIN one mission and
// restarts at 0 every time a mission boots, so it orders two deaths in the same
// mission and says nothing about two deaths in different ones. `roster.lost` is
// append-only (`appendLost`), so its ARRAY ORDER is the history. Every case here
// puts the OLDER loss at the HIGHER tick: a long first mission, then a death early
// in a short second one.
describe('recency is array order, never tick — tick restarts every mission', () => {
  it('predecessorOf answers with the last record for the slot, whatever its tick', () => {
    const lost = [
      rec(7, { name: 'Barkai', missionId: 'beit_sahwan_2_foothold', tick: 5000 }),
      rec(7, { name: 'Dekel', missionId: 'beit_sahwan_3_clearance', tick: 100 }),
    ];
    expect(predecessorOf(lost, 7)?.name).toBe('Dekel');
  });

  it('fillVacancies offers the most recent vacancy first, whatever its tick', () => {
    const lost = [
      rec(7, { name: 'Barkai', missionId: 'beit_sahwan_2_foothold', tick: 5000 }),
      rec(8, { name: 'Dekel', missionId: 'beit_sahwan_3_clearance', tick: 100 }),
    ];
    expect(fillVacancies([e({ type: 'inf_squad' })], lost, []).map((r) => r.slot)).toEqual([8]);
    expect(fillVacancies([e({ type: 'inf_squad' }), e({ type: 'inf_squad' })], lost, []).map((r) => r.slot)).toEqual([8, 7]);
  });

  // The half that `bySlot` decides: a slot lost twice is represented by its LAST
  // record, so its place in the queue is that record's place. Slot 7 was lost in
  // the first mission (tick 9000), refilled, and lost again in the third (tick
  // 100); slot 8 was lost in the second. The newest vacancy is slot 7's.
  it('ranks a slot lost twice by its last loss, not its first', () => {
    const lost = [
      rec(7, { name: 'Barkai', missionId: 'm1', tick: 9000 }),
      rec(8, { name: 'Nachshon', missionId: 'm2', tick: 500 }),
      rec(7, { name: 'Dekel', missionId: 'm3', tick: 100 }),
    ];
    expect(fillVacancies([e({ type: 'inf_squad' })], lost, []).map((r) => r.slot)).toEqual([7]);
  });
});
