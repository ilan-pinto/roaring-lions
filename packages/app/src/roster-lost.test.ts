import { describe, expect, it } from 'vitest';
import { appendLost, fillVacancies, lostRecordFor, predecessorOf } from './roster-lost';
import { issueSlots, reattachSlots } from './roster-slots';
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

// A parked finding from Task 3's review: `reattachSlots(out, before)` takes two
// POSITIONAL `readonly RosterEntry[]` arguments, so a swap type-checks silently,
// and reading `before` off the POST-mission ledger (instead of the one the
// mission was sent IN with) would re-issue every survivor a fresh slot on every
// write, with every pure spec above still green -- none of them drive the real
// `main.ts` seam, and a single mission cannot distinguish "reattached correctly"
// from "issued fresh, coincidentally starting from the same counter". Only a
// SECOND mission, run through the exact sequence `main.ts`'s victory branch
// uses (R-13 steps 3-6), tells the two apart.
describe('the R-13 seam — a slot survives a two-mission round trip through main.ts\'s own pipeline shape', () => {
  // `before` = the roster THIS mission was sent in with (`ledger[...]`, read
  // before `checkEnd` ran); `out` = what `checkEnd` just produced
  // (`updatedLedger[...]`). Getting the two swapped, or sourcing `before` from
  // `out`'s own object, type-checks -- both are `readonly RosterEntry[]`.
  const pipeline = (
    before: readonly RosterEntry[],
    out: readonly RosterEntry[],
    lostSoFar: readonly LostRecord[],
    lostThisMission: readonly LostRecord[],
    reserve: readonly RosterEntry[],
    issued: number,
  ): { roster: RosterEntry[]; lost: LostRecord[]; issued: number } => {
    const lost = appendLost(lostSoFar, lostThisMission);
    const filled = fillVacancies(reattachSlots(out, before), lost, reserve);
    const carried = issueSlots(filled, issued);
    return { roster: carried.roster, lost, issued: carried.issued };
  };

  it('gives a replacement the lost slot across two missions, and never re-issues a survivor a fresh one', () => {
    // Mission 1: a fresh campaign. There is no previous save, so `before` is
    // empty and `checkEnd` hands back two fresh, slotless bodies.
    const m1 = pipeline([], [e({ type: 'inf_squad', name: 'Barkai' }), e({ type: 'inf_squad', name: 'Dekel' })], [], [], [], 0);
    expect(m1.roster.map((r) => r.slot)).toEqual([0, 1]);

    // Mission 2: Barkai survives -- `checkEnd` rebuilds a fielded survivor
    // field by field and copies only `name` (mission.ts:1874-1883), so the
    // entry that comes back out has no slot of its own. Dekel dies mid-mission
    // (captured at the `unitLost` event, off the entry `rosterEntryOf` still
    // has -- the one `before` carries, with its slot) and a fresh body of the
    // same type fills the roster line instead.
    const dekelLost = lostRecordFor(m1.roster.find((r) => r.name === 'Dekel'), 'inf_squad', 'm2', 500);
    expect(dekelLost).not.toBeNull();
    const m2 = pipeline(
      m1.roster,
      [e({ type: 'inf_squad', name: 'Barkai' }), e({ type: 'inf_squad' })],
      m1.lost,
      dekelLost ? [dekelLost] : [],
      [],
      m1.issued,
    );

    // Barkai keeps slot 0 -- reattached by name, never re-issued.
    expect(m2.roster.find((r) => r.name === 'Barkai')?.slot).toBe(0);
    // The replacement takes Dekel's OLD slot, 1 -- not a fresh slot 2.
    expect(m2.roster.find((r) => r.name === undefined)?.slot).toBe(1);
    expect(m2.issued).toBe(2);
    expect(predecessorOf(m2.lost, 1)?.name).toBe('Dekel');
  });
});
