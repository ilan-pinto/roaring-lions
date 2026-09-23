import { describe, expect, it } from 'vitest';
import type { LedgerRosterEntry } from '@lions/sim';
import { deployRosterView, drawFromPool } from './deploy-roster';
import {
  defaultSelection,
  isComplete,
  permutePool,
  slotsLeft,
  toggleEntry,
} from './deploy-select';

const pool = (): LedgerRosterEntry[] => [
  { type: 'inf_squad', veterancy: 2, name: '1-1 Erez', missions: 4, kills: 7 },
  { type: 'inf_squad', veterancy: 0, missions: 1, kills: 0 },
  { type: 'inf_squad', veterancy: 3, name: '1-3 Nachshon', missions: 9, kills: 21 },
  { type: 'at_team', veterancy: 1, name: '2-1 Gachelet', missions: 3, kills: 5 },
  { type: 'recon_drone', veterancy: 0, missions: 2, kills: 0 },
];
const force = [
  { unit: 'inf_squad', count: 2, from_ledger: true },
  { unit: 'at_team', count: 1, from_ledger: true },
];
const mission = { ledger: { requires: ['roster.surviving_units'] }, starting_force: force };
const name = (id: string): string => id;
const view = () => {
  const v = deployRosterView(mission, { 'roster.surviving_units': pool() }, name);
  if (!v) throw new Error('fixture: the view must exist');
  return v;
};

describe('defaultSelection', () => {
  // Opening the screen and touching nothing must field exactly what the
  // mission fields today. Anything else is a silent balance change.
  it('is what the spawner would have drawn with no screen at all', () => {
    expect([...defaultSelection(view()).chosen].sort((a, b) => a - b)).toEqual(
      [...drawFromPool(pool(), force)].sort((a, b) => a - b)
    );
  });
});

describe('toggleEntry', () => {
  it('benching a chosen entry frees exactly one slot of its own type', () => {
    const v = view();
    const s = toggleEntry(v, defaultSelection(v), 0);
    expect(s.chosen.has(0)).toBe(false);
    expect(slotsLeft(v, s, 'inf_squad')).toBe(1);
    expect(slotsLeft(v, s, 'at_team')).toBe(0);
  });

  it('fields a benched entry into a free slot of its own type', () => {
    const v = view();
    const s = toggleEntry(v, toggleEntry(v, defaultSelection(v), 0), 2);
    expect([...s.chosen].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(isComplete(v, s)).toBe(true);
  });

  // The count is the mission's. A screen that let the player field a third
  // squad would be authoring `starting_force` from the UI (spec §8).
  it('refuses a third body of a type the mission fields two of', () => {
    const v = view();
    const s = toggleEntry(v, defaultSelection(v), 2);
    expect([...s.chosen].sort((a, b) => a - b)).toEqual([0, 1, 3]);
  });

  it('refuses an entry no placement can draw', () => {
    const v = view();
    const before = defaultSelection(v);
    expect(toggleEntry(v, before, 4)).toBe(before);
  });

  it('never returns a mutated input', () => {
    const v = view();
    const before = defaultSelection(v);
    toggleEntry(v, before, 0);
    expect([...before.chosen].sort((a, b) => a - b)).toEqual([0, 1, 3]);
  });
});

describe('isComplete', () => {
  it('is false while a slot is empty — the screen may not deploy short', () => {
    const v = view();
    expect(isComplete(v, toggleEntry(v, defaultSelection(v), 0))).toBe(false);
  });

  // A pool with fewer bodies than the mission asks for is the case
  // `spawnPlacement` handles by substituting one fresh remnant
  // (mission.ts:1264). The screen must not block on it.
  it('is true when the pool simply cannot fill a slot', () => {
    const thin = [{ type: 'inf_squad', veterancy: 0 }];
    const v = deployRosterView(mission, { 'roster.surviving_units': thin }, name);
    if (!v) throw new Error('fixture');
    expect(isComplete(v, defaultSelection(v))).toBe(true);
  });
});

describe('permutePool', () => {
  const same = (a: readonly LedgerRosterEntry[], b: readonly LedgerRosterEntry[]): boolean => {
    const key = (e: LedgerRosterEntry): string => JSON.stringify(e);
    return [...a].map(key).sort().join('|') === [...b].map(key).sort().join('|');
  };

  // THE invariant. mission.ts:1887 writes whatever is left in rosterPool
  // straight back into the campaign ledger, so an entry dropped here is a
  // veteran deleted from the player's brigade forever.
  it('is a permutation: every entry survives, exactly once', () => {
    const v = view();
    const p = pool();
    const out = permutePool(p, toggleEntry(v, toggleEntry(v, defaultSelection(v), 0), 2));
    expect(out).toHaveLength(p.length);
    expect(same(out, p)).toBe(true);
  });

  // Pre-flight scan correction (T2 row): the brief's own draw-order
  // expectation here (`['1-3 Nachshon', undefined, '2-1 Gachelet']`) is
  // wrong against the spec'd implementation. `permutePool` orders a type's
  // CHOSEN entries in POOL order before its unchosen ones -- index 1 (the
  // unnamed veteran) before index 2 (Nachshon), since 1 < 2 in the pool --
  // and `drawFromPool` then takes them off the front of that group in that
  // same order. The correct expectation is the unnamed body first.
  it('the spawner’s own draw over the permutation takes exactly the chosen entries', () => {
    const v = view();
    const p = pool();
    const sel = toggleEntry(v, toggleEntry(v, defaultSelection(v), 0), 2);
    const out = permutePool(p, sel);
    const drawn = drawFromPool(out, force).map((i) => out[i]);
    expect(drawn.map((e) => e.name)).toEqual([undefined, '1-3 Nachshon', '2-1 Gachelet']);
  });

  it('a benched veteran is still in the pool the runtime will hand back', () => {
    const v = view();
    const p = pool();
    const sel = toggleEntry(v, toggleEntry(v, defaultSelection(v), 0), 2);
    const out = permutePool(p, sel);
    const left = out.filter((_, i) => !drawFromPool(out, force).includes(i));
    expect(left.map((e) => e.name)).toContain('1-1 Erez');
  });

  it('the default selection permutes to the identity draw', () => {
    const v = view();
    const p = pool();
    const out = permutePool(p, defaultSelection(v));
    expect(drawFromPool(out, force).map((i) => out[i])).toEqual(
      drawFromPool(p, force).map((i) => p[i])
    );
  });
});
