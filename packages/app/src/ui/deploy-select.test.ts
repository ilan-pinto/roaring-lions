import { describe, expect, it } from 'vitest';
import type { LedgerRosterEntry } from '@lions/sim';
import { deployRosterView, drawFromPool } from './deploy-roster';
import {
  defaultSelection,
  isComplete,
  permutePool,
  slotsLeft,
  toggleEntry,
  type DeploySelection,
} from './deploy-select';

/** A multiset comparison of two entry lists -- order-blind, so it checks
 *  "the same bag of entries" rather than "the same array". Shared by the
 *  fixed-fixture tests and the property test below. */
const sameMultiset = (a: readonly LedgerRosterEntry[], b: readonly LedgerRosterEntry[]): boolean => {
  const key = (e: LedgerRosterEntry): string => JSON.stringify(e);
  return [...a].map(key).sort().join('|') === [...b].map(key).sort().join('|');
};

/**
 * mulberry32 -- a small, deterministic, dependency-free PRNG for the
 * property test below (code review, fix round 1, Important 2). No
 * `Math.random`, no new package: a fixed seed makes a "500 random cases"
 * test reproducible, which `Math.random` cannot be.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  // THE invariant. mission.ts:1887 writes whatever is left in rosterPool
  // straight back into the campaign ledger, so an entry dropped here is a
  // veteran deleted from the player's brigade forever.
  it('is a permutation: every entry survives, exactly once', () => {
    const v = view();
    const p = pool();
    const out = permutePool(p, toggleEntry(v, toggleEntry(v, defaultSelection(v), 0), 2));
    expect(out).toHaveLength(p.length);
    expect(sameMultiset(out, p)).toBe(true);
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

// Code review, fix round 1, Important 1: `permutePool` used to read
// `pool[idx].type` with no bounds check on `sel.chosen`, so a stale or
// malformed selection (a longer pool's indices carried over, a UI bug, a
// negative or fractional value) threw instead of degrading. Each case below
// is constructed directly, without going through `toggleEntry`, because the
// defect was in `permutePool` reading a `DeploySelection` it did not mint.
describe('permutePool — out-of-range indices in sel.chosen', () => {
  it('drops an index past the end of the pool instead of throwing', () => {
    const p = pool();
    const sel: DeploySelection = { chosen: new Set([99]) };
    expect(() => permutePool(p, sel)).not.toThrow();
    const out = permutePool(p, sel);
    expect(out).toHaveLength(p.length);
    expect(sameMultiset(out, p)).toBe(true);
  });

  it('drops a negative index instead of throwing', () => {
    const p = pool();
    const sel: DeploySelection = { chosen: new Set([-1]) };
    expect(() => permutePool(p, sel)).not.toThrow();
    const out = permutePool(p, sel);
    expect(out).toHaveLength(p.length);
    expect(sameMultiset(out, p)).toBe(true);
  });

  it('drops a non-integer index instead of throwing', () => {
    const p = pool();
    const sel: DeploySelection = { chosen: new Set([1.5]) };
    expect(() => permutePool(p, sel)).not.toThrow();
    const out = permutePool(p, sel);
    expect(out).toHaveLength(p.length);
    expect(sameMultiset(out, p)).toBe(true);
  });

  // The realistic case: a selection built while the pool was longer (a
  // previous mission's roster, before this mission's losses shrank it).
  it('a stale selection built for a longer pool still permutes the shorter one', () => {
    const p = pool(); // length 5
    const stale: DeploySelection = { chosen: new Set([0, 1, 2, 3, 4, 5, 6, 7]) }; // 5-7 don't exist in p
    expect(() => permutePool(p, stale)).not.toThrow();
    const out = permutePool(p, stale);
    expect(out).toHaveLength(p.length);
    expect(sameMultiset(out, p)).toBe(true);
  });

  // toggleEntry never indexes into a raw pool array, so it could not throw
  // the way permutePool did -- but it carries the same sanitizing guard
  // (code review ruling), so a stale sel.chosen does not silently persist
  // garbage into the selection it returns.
  it('toggleEntry does not throw on a stale sel.chosen either, and still fields normally', () => {
    const v = view();
    const stale: DeploySelection = { chosen: new Set([0, 1, 99, -1]) };
    expect(() => toggleEntry(v, stale, 3)).not.toThrow();
    const s = toggleEntry(v, stale, 3);
    expect([...s.chosen].sort((a, b) => a - b)).toEqual([0, 1, 3]);
  });
});

// Code review, fix round 1, Important 2: the fixed 5-entry fixture above is
// the only coverage the invariant this task exists to protect ever had.
// This property test builds random pools with 0-12 entries over 1-4 types,
// scattered non-contiguously (a plain per-entry random type assignment does
// this without any special-casing), and checks the three properties a
// correct `permutePool` must have, over at least 500 cases. `mulberry32` is
// hand-rolled above -- no new dependency, no `Math.random` (which cannot be
// seeded, so a failure could never be reproduced).
describe('permutePool — property: 500 random pools and selections', () => {
  const TYPES = ['type_a', 'type_b', 'type_c', 'type_d'];
  const name = (id: string): string => id;

  it('holds for a true permutation, the default-order identity, and the per-type draw prefix', () => {
    const rng = mulberry32(0xc0ffee);
    const randInt = (maxExclusive: number): number => Math.floor(rng() * maxExclusive);

    for (let run = 0; run < 500; run++) {
      const n = randInt(13); // 0..12 entries
      const typeCount = 1 + randInt(4); // 1..4 types
      const types = TYPES.slice(0, typeCount);

      const randomPool: LedgerRosterEntry[] = [];
      for (let i = 0; i < n; i++) {
        randomPool.push({ type: types[randInt(types.length)], veterancy: randInt(4), missions: i, kills: i });
      }

      const demandedTypes = types.filter(() => rng() < 0.7);
      if (demandedTypes.length === 0) demandedTypes.push(types[0]);
      const force = demandedTypes.map((unit) => ({ unit, count: 1 + randInt(3), from_ledger: true as const }));
      const mission = { ledger: { requires: ['roster.surviving_units'] }, starting_force: force };
      const randomView = deployRosterView(mission, { 'roster.surviving_units': randomPool }, name);
      if (!randomView) throw new Error('property fixture: the view must exist');

      // A genuine selection, reached only through the real API: default,
      // then a handful of random legal toggles (bench and field both).
      let sel = defaultSelection(randomView);
      const toggleCount = randInt(4);
      for (let t = 0; t < toggleCount; t++) {
        if (randomPool.length === 0) break;
        sel = toggleEntry(randomView, sel, randInt(randomPool.length));
      }

      // (a) a true permutation for the clean selection...
      const out = permutePool(randomPool, sel);
      expect(out).toHaveLength(randomPool.length);
      expect(sameMultiset(out, randomPool)).toBe(true);

      // ...and unaffected by out-of-range noise riding along in `chosen`
      // (past the end, negative, non-integer): sanitizing must make these
      // invisible, not merely non-throwing.
      const dirty = new Set(sel.chosen);
      dirty.add(randomPool.length + randInt(10));
      dirty.add(-1 - randInt(10));
      dirty.add(randInt(Math.max(randomPool.length, 1)) + 0.5);
      const outDirty = permutePool(randomPool, { chosen: dirty });
      expect(outDirty).toHaveLength(randomPool.length);
      expect(sameMultiset(outDirty, randomPool)).toBe(true);
      expect(outDirty).toEqual(out);

      // (b) the default selection reproduces the input order exactly, not
      // just as a multiset -- the identity a bare "open the screen, deploy"
      // must have, regardless of how the pool's types are interleaved.
      expect(permutePool(randomPool, defaultSelection(randomView))).toEqual(randomPool);

      // (c) for every demanded type, the entries drawFromPool draws off the
      // permuted pool START with exactly that type's chosen entries, in
      // pool order -- because permutePool always seats a type's chosen
      // entries in that type's own earliest slots.
      const drawn = drawFromPool(out, force).map((i) => out[i]);
      for (const type of randomView.demand.keys()) {
        const chosenOfType = randomPool.filter((e, i) => e.type === type && sel.chosen.has(i));
        const drawnOfType = drawn.filter((e) => e.type === type);
        expect(drawnOfType.slice(0, chosenOfType.length)).toEqual(chosenOfType);
      }
    }
  });
});
