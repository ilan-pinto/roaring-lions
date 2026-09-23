import { describe, expect, it } from 'vitest';
import { issueSlots, reattachSlots } from './roster-slots';
import type { RosterEntry } from './ledger-store';

const e = (o: Partial<RosterEntry> & { type: string }): RosterEntry =>
  ({ veterancy: 0, missions: 1, kills: 0, ...o });

describe('reattachSlots — R-2\'s rule', () => {
  // `checkEnd` pushes an unfielded pool entry with `{ ...left }` (mission.ts:1887),
  // a FULL spread, so its slot is still on it. Nothing to reattach.
  it('leaves an unfielded pass-through alone', () => {
    const before = [e({ type: 'mortar_team', name: 'Nachshon', slot: 4 })];
    const out = [e({ type: 'mortar_team', name: 'Nachshon', slot: 4 })];
    expect(reattachSlots(out, before)).toEqual(out);
  });

  // The whole reason this function exists: a FIELDED survivor is rebuilt field by
  // field (mission.ts:1874-1883) and only `name` comes through, so the slot is
  // gone and the name is the only thing left to find it by.
  it('gives a fielded survivor its slot back, by name', () => {
    const before = [e({ type: 'inf_squad', name: 'Barkai', slot: 7, veterancy: 1, missions: 3 })];
    const out = [e({ type: 'inf_squad', name: 'Barkai', veterancy: 2, missions: 4, kills: 5 })];
    const got = reattachSlots(out, before);
    expect(got[0].slot).toBe(7);
    // ...and nothing else moves: the sim's own numbers win, not the ones sent in.
    expect(got[0]).toEqual({ type: 'inf_squad', name: 'Barkai', veterancy: 2, missions: 4, kills: 5, slot: 7 });
  });

  it('leaves a new body slotless for issueSlots to number', () => {
    const before = [e({ type: 'inf_squad', name: 'Barkai', slot: 7 })];
    const out = [e({ type: 'inf_squad', name: 'Barkai' }), e({ type: 'recon_drone' })];
    expect(reattachSlots(out, before)[1].slot).toBeUndefined();
  });

  // The hole R-2 names rather than papers over. Unreachable once slot and name
  // are issued together, and constructed here to prove the fallback neither
  // throws nor hands out somebody else's number.
  it('treats a slotted-but-nameless predecessor as unmatchable, not as a collision', () => {
    const before = [e({ type: 'inf_squad', slot: 7 })];
    const out = [e({ type: 'inf_squad' })];
    expect(reattachSlots(out, before)[0].slot).toBeUndefined();
  });

  it('never gives two out entries the same slot', () => {
    const before = [e({ type: 'inf_squad', name: 'Barkai', slot: 7 }), e({ type: 'inf_squad', name: 'Dekel', slot: 8 })];
    const out = [e({ type: 'inf_squad', name: 'Barkai' }), e({ type: 'inf_squad', name: 'Dekel' }), e({ type: 'inf_squad' })];
    const slots = reattachSlots(out, before).map((r) => r.slot);
    expect(slots).toEqual([7, 8, undefined]);
  });

  it('is length-preserving and deletes nothing', () => {
    const before = [e({ type: 'inf_squad', name: 'Barkai', slot: 7 })];
    const out = [e({ type: 'inf_squad' }), e({ type: 'mbt_lavi' }), e({ type: 'recon_drone' })];
    expect(reattachSlots(out, before)).toHaveLength(3);
  });
});

describe('issueSlots — a counter, never a reuse', () => {
  it('numbers only what is slotless and advances the counter by that many', () => {
    const got = issueSlots([e({ type: 'inf_squad', slot: 2 }), e({ type: 'mbt_lavi' }), e({ type: 'recon_drone' })], 5);
    expect(got.roster.map((r) => r.slot)).toEqual([2, 5, 6]);
    expect(got.issued).toBe(7);
  });

  it('is a no-op when everything already has a slot', () => {
    const got = issueSlots([e({ type: 'inf_squad', slot: 0 })], 9);
    expect(got.roster[0].slot).toBe(0);
    expect(got.issued).toBe(9);
  });

  // R-7: a save written before this package has no slots anywhere and no counter.
  // The first write after upgrade numbers everything, and no two agree.
  it('numbers a whole pre-change roster on the first pass, with no collisions', () => {
    const pre = [e({ type: 'inf_squad', name: 'Barkai' }), e({ type: 'mbt_lavi', name: '1-2 Ayil' }), e({ type: 'mortar_team', name: 'Nachshon' })];
    const got = issueSlots(pre, 0);
    expect(new Set(got.roster.map((r) => r.slot)).size).toBe(3);
    expect(got.issued).toBe(3);
  });

  // The counter is the chronology R-4's eviction order sorts by, so a reused id
  // would make "newest falls first" answer differently on two identical saves.
  it('never reuses an id across successive passes', () => {
    const first = issueSlots([e({ type: 'inf_squad' })], 0);
    const second = issueSlots([e({ type: 'mbt_lavi' })], first.issued);
    expect(second.roster[0].slot).not.toBe(first.roster[0].slot);
  });
});
