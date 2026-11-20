// GH-1384 §4.4, case 8: the server's sticky pick, on literal accounts and a literal branched table (fx_tank forks BOTH its firepower
// and its armour at tier 3, so every rule is also held per track). Each case runs the rule and then `migrateAccount`, the way the
// Worker's canonical write does, because the rule's whole point is what the migration would otherwise do to a stripped body.
import { describe, expect, it } from 'vitest';
import { emptyAccount, migrateAccount, type BrigadeAccount } from './brigade';
import { stickyPicks } from './branch-sticky';
import type { BranchedTable } from './branches';

const BRANCHED: BranchedTable = { fx_tank: { firepower: { tier: 3, price: 950 }, armour: { tier: 3, price: 770 } } };
const acct = (upgrades: Record<string, number>, extra: Partial<BrigadeAccount> = {}): BrigadeAccount => ({
  ...emptyAccount(),
  upgrades: { fx_tank: upgrades },
  ...extra,
});
/** What the Worker writes: the rule, then the migration. */
const written = (stored: BrigadeAccount | undefined, incoming: BrigadeAccount) =>
  migrateAccount(stickyPicks(stored, incoming, BRANCHED), undefined, BRANCHED);
const FP = (a: BrigadeAccount) => [a.picks?.['fx_tank']?.['firepower'], a.legacy?.['fx_tank']?.['firepower']];
const AR = (a: BrigadeAccount) => [a.picks?.['fx_tank']?.['armour'], a.legacy?.['fx_tank']?.['armour']];

describe('a stripped body (an old build) cannot undo a stored pick', () => {
  it('keeps pick 2 with no marker, where an unguarded migration would have made it pick 1 with a fresh marker', () => {
    const stored = acct({ firepower: 3 }, { picks: { fx_tank: { firepower: 2 } } });
    const body = acct({ firepower: 3 });
    expect(FP(written(stored, body))).toEqual([2, undefined]);
    expect(FP(migrateAccount(body, undefined, BRANCHED))).toEqual([1, true]); // the control: this is what the rule prevents
  });
  it('keeps a stored LEGACY marker with its pick, so the one free Switch is not lost', () => {
    const stored = acct({ firepower: 3 }, { picks: { fx_tank: { firepower: 1 } }, legacy: { fx_tank: { firepower: true } } });
    expect(FP(written(stored, acct({ firepower: 3 })))).toEqual([1, true]);
  });
  it('never reads the body\'s own `legacy`: a forged marker is dropped, and a cleared one comes back', () => {
    const fresh = acct({ firepower: 3 }, { picks: { fx_tank: { firepower: 2 } } });
    expect(FP(written(fresh, acct({ firepower: 3 }, { picks: { fx_tank: { firepower: 2 } }, legacy: { fx_tank: { firepower: true } } })))).toEqual([2, undefined]);
    const marked = acct({ firepower: 3 }, { picks: { fx_tank: { firepower: 2 } }, legacy: { fx_tank: { firepower: true } } });
    expect(FP(written(marked, acct({ firepower: 3 }, { picks: { fx_tank: { firepower: 2 } } })))).toEqual([2, true]);
  });
});

describe('a pick that changes', () => {
  it('is refused with no stored marker: the stored pick stands (a fresh branch buy is final)', () => {
    const stored = acct({ firepower: 3 }, { picks: { fx_tank: { firepower: 2 } } });
    expect(FP(written(stored, acct({ firepower: 3 }, { picks: { fx_tank: { firepower: 1 } } })))).toEqual([2, undefined]);
  });
  it('is refused WITH a stored marker too, and the marker stands: a body never Switches (Q11: the Switch is the route\'s, both stores in one write)', () => {
    const stored = acct({ firepower: 3 }, { picks: { fx_tank: { firepower: 1 } }, legacy: { fx_tank: { firepower: true } } });
    expect(FP(written(stored, acct({ firepower: 3 }, { picks: { fx_tank: { firepower: 2 } } })))).toEqual([1, true]);
    // Even a body that also claims the marker is gone, or claims one: the stored marker is what stands.
    expect(FP(written(stored, acct({ firepower: 3 }, { picks: { fx_tank: { firepower: 2 } }, legacy: { fx_tank: { firepower: true } } })))).toEqual([1, true]);
  });
});

describe('every rule is per (unit, track)', () => {
  it('a stored row with firepower 2 and armour 1, both at tier 3, and a body stripped of both: each keeps its own', () => {
    const stored = acct({ firepower: 3, armour: 3 }, { picks: { fx_tank: { firepower: 2, armour: 1 } } });
    const r = written(stored, acct({ firepower: 3, armour: 3 }));
    expect([FP(r), AR(r)]).toEqual([[2, undefined], [1, undefined]]);
  });
  it('firepower held at tier 3 with pick 2 and armour at tier 2: a body with both at tier 3 keeps firepower 2 and gives armour pick 1 with a marker (a genuine old-build buy)', () => {
    const stored = acct({ firepower: 3, armour: 2 }, { picks: { fx_tank: { firepower: 2 } } });
    const r = written(stored, acct({ firepower: 3, armour: 3 }));
    expect([FP(r), AR(r)]).toEqual([[2, undefined], [1, true]]);
  });
  it('a changed pick on one marked track moves neither track: each keeps its own pick and marker', () => {
    const stored = acct({ firepower: 3, armour: 3 }, { picks: { fx_tank: { firepower: 1, armour: 1 } }, legacy: { fx_tank: { firepower: true } } });
    const body = acct({ firepower: 3, armour: 3 }, { picks: { fx_tank: { firepower: 2, armour: 2 } } });
    const r = written(stored, body);
    expect([FP(r), AR(r)]).toEqual([[1, true], [1, undefined]]);
  });
});

describe('what it leaves alone', () => {
  it('a body below the branched tier: the pick leaves with its tier (a Return or a reset) and nothing is forced back', () => {
    const stored = acct({ firepower: 3 }, { picks: { fx_tank: { firepower: 2 } } });
    const body = acct({ firepower: 2 });
    // The rule alone (the migration would drop a pick below its tier anyway, so it cannot be the only witness).
    expect(stickyPicks(stored, body, BRANCHED)).toEqual(body.picks === undefined ? { ...body, picks: {}, legacy: {} } : body);
    const r = written(stored, body);
    expect(r.upgrades['fx_tank']?.['firepower']).toBe(2);
    expect(FP(r)).toEqual([undefined, undefined]);
  });
  it('a fresh buy where the stored row held less carries its pick and no marker, even if the body claims one', () => {
    const stored = acct({ firepower: 2 });
    expect(FP(written(stored, acct({ firepower: 3 }, { picks: { fx_tank: { firepower: 2 } }, legacy: { fx_tank: { firepower: true } } })))).toEqual([2, undefined]);
  });
  it('no stored row (a first write) is the migration alone', () => {
    expect(FP(written(undefined, acct({ firepower: 3 })))).toEqual([1, true]);
  });
  it('with no branched table in force the body comes back as the same object', () => {
    const body = acct({ firepower: 3 });
    expect(stickyPicks(acct({ firepower: 3 }, { picks: { fx_tank: { firepower: 2 } } }), body, {})).toBe(body);
  });
});
