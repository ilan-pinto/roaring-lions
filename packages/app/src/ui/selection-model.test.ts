// The selection cluster's arithmetic.
//
// The distinction this file exists to protect is the one the ticket calls out
// and the one a naive implementation loses: an order the selection CANNOT give
// is absent from the row, and an order it can give that would do nothing right
// now is present at 45%. Collapse those two and a player asking "why is Unload
// missing?" gets no answer, because the answer — "your transport is empty" —
// was never on screen.

import { describe, expect, it } from 'vitest';
import {
  ORDERS,
  chipStatus,
  groupChips,
  hpTone,
  orderRow,
  stepFocus,
  type SelectionFacts,
  type UnitFacts,
} from './selection-model';

/** A lone rifleman: nothing aboard, nothing carried, standing still. */
function facts(over: Partial<SelectionFacts> = {}): SelectionFacts {
  return {
    count: 1,
    underway: 0,
    smokers: 0,
    carriers: 0,
    slots: 0,
    aboard: 0,
    riders: 0,
    ...over,
  };
}

function ids(f: SelectionFacts): string[] {
  return orderRow(f, null).map((r) => r.id);
}

function row(f: SelectionFacts, id: string) {
  return orderRow(f, null).find((r) => r.id === id);
}

describe('order row — which orders are offered at all', () => {
  it('offers nothing for an empty selection', () => {
    expect(orderRow(facts({ count: 0 }), null)).toEqual([]);
  });

  it('offers attack-move and halt to anything alive', () => {
    expect(ids(facts())).toEqual(['attackMove', 'halt']);
  });

  it('omits smoke unless something in the selection carries it', () => {
    expect(ids(facts())).not.toContain('smoke');
    expect(ids(facts({ smokers: 1 }))).toContain('smoke');
  });

  it('omits load and unload unless a transport is selected', () => {
    // The infantry case: they can BOARD one, but with no carrier in hand
    // neither verb has a subject, so neither is offered.
    expect(ids(facts({ riders: 4 }))).toEqual(['attackMove', 'halt']);
    expect(ids(facts({ carriers: 1, slots: 8 }))).toContain('load');
    expect(ids(facts({ carriers: 1, slots: 8 }))).toContain('unload');
  });

  it('keeps the spec order regardless of which orders survive', () => {
    const all = ids(facts({ smokers: 1, carriers: 1, slots: 8 }));
    expect(all).toEqual(['attackMove', 'halt', 'smoke', 'load', 'unload']);
    expect(ORDERS.map((o) => o.id)).toEqual(all);
  });
});

describe('order row — capable, but it would do nothing right now', () => {
  it('dims unload for a transport carrying nobody, and does NOT hide it', () => {
    // This is the whole distinction. A rifle squad gets no Unload button at
    // all; an empty Namer gets one at 45%.
    const empty = row(facts({ carriers: 1, slots: 8, aboard: 0 }), 'unload');
    expect(empty).toBeDefined();
    expect(empty?.inert).toBe(true);
    const loaded = row(facts({ carriers: 1, slots: 8, aboard: 3 }), 'unload');
    expect(loaded?.inert).toBe(false);
  });

  it('dims load when no infantry is selected to put in the transport', () => {
    expect(row(facts({ carriers: 1, slots: 8 }), 'load')?.inert).toBe(true);
    expect(row(facts({ carriers: 1, slots: 8, riders: 2 }), 'load')?.inert).toBe(false);
  });

  it('dims halt when nothing is moving and nothing has a waypoint', () => {
    expect(row(facts(), 'halt')?.inert).toBe(true);
    expect(row(facts({ underway: 1 }), 'halt')?.inert).toBe(false);
  });

  it('never dims attack-move — a living unit can always be sent somewhere', () => {
    expect(row(facts(), 'attackMove')?.inert).toBe(false);
    expect(row(facts({ count: 40, underway: 40 }), 'attackMove')?.inert).toBe(false);
  });

  it('never dims smoke: if it is offered, the smokers that offered it can lay it', () => {
    // Mirrors resolveKeyVerb, which returns an intent whenever a smoker is in
    // the selection. Anything finer would be the row promising something the
    // `f` key does not deliver.
    expect(row(facts({ smokers: 1 }), 'smoke')?.inert).toBe(false);
  });
});

describe('order row — capacity and arming', () => {
  it('states seats taken over seats carried, beside Load only', () => {
    const r = orderRow(facts({ carriers: 2, slots: 13, aboard: 5 }), null);
    expect(r.find((o) => o.id === 'load')?.capacity).toBe('5/13');
    expect(r.find((o) => o.id === 'unload')?.capacity).toBeUndefined();
    expect(r.find((o) => o.id === 'halt')?.capacity).toBeUndefined();
  });

  it('marks exactly the armed order, and nothing when nothing is armed', () => {
    const armed = orderRow(facts({ smokers: 1 }), 'attackMove');
    expect(armed.filter((o) => o.armed).map((o) => o.id)).toEqual(['attackMove']);
    expect(orderRow(facts({ smokers: 1 }), null).some((o) => o.armed)).toBe(false);
  });
});

// --- chips ---------------------------------------------------------------

function unit(over: Partial<UnitFacts> = {}): UnitFacts {
  return {
    typeId: 'inf_squad',
    name: 'Rifle Squad',
    bucket: 'soft',
    hp: 100,
    hpMax: 100,
    routed: false,
    pinned: false,
    moving: false,
    aboard: false,
    ...over,
  };
}

describe('chips — grouping', () => {
  it('makes one chip per unit type and counts the members', () => {
    const chips = groupChips([
      unit(),
      unit({ typeId: 'at_team', name: 'Spike AT', bucket: 'soft' }),
      unit(),
    ]);
    expect(chips.map((c) => [c.typeId, c.count])).toEqual([
      ['inf_squad', 2],
      ['at_team', 1],
    ]);
  });

  it('orders chips by first appearance, not by size', () => {
    // A chip that moves while the player is reaching for it is worse than a
    // chip in an unhelpful order, and casualties change the sizes constantly.
    const chips = groupChips([
      unit({ typeId: 'mbt_lavi', name: 'Lavi', bucket: 'armour' }),
      unit(),
      unit(),
      unit(),
    ]);
    expect(chips.map((c) => c.typeId)).toEqual(['mbt_lavi', 'inf_squad']);
  });

  it('reports the health of the whole sub-group, not of its first member', () => {
    const chips = groupChips([unit({ hp: 100 }), unit({ hp: 0 }), unit({ hp: 50 })]);
    expect(chips[0].hpPct).toBeCloseTo(150 / 300, 5);
    expect(chips[0].hpTone).toBe('warn');
  });

  it('bands the health track at a half and a quarter', () => {
    expect(hpTone(1)).toBe('good');
    expect(hpTone(0.51)).toBe('good');
    expect(hpTone(0.5)).toBe('warn');
    expect(hpTone(0.26)).toBe('warn');
    expect(hpTone(0.25)).toBe('bad');
    expect(hpTone(0)).toBe('bad');
  });
});

describe('chips — the one status line', () => {
  const s = (over: Parameters<typeof chipStatus>[0]) => chipStatus(over);

  it('reports the worst thing true of the group, broken first', () => {
    expect(s({ count: 3, routed: 1, pinned: 2, aboard: 0, moving: 3 })).toEqual({
      status: '1 BROKEN',
      statusTone: 'bad',
    });
  });

  it('reports pinned over anything recoverable, in the warmer ink', () => {
    expect(s({ count: 3, routed: 0, pinned: 1, aboard: 1, moving: 2 })).toEqual({
      status: '1 PINNED',
      statusTone: 'hot',
    });
  });

  it('prefers APS to moving — a Namer under way still reports its rounds', () => {
    // The spec's own reading: its Namer chip says `APS 3/4` while the card
    // beside it says the same unit is moving.
    expect(s({ count: 1, routed: 0, pinned: 0, aboard: 0, moving: 1, aps: { ammo: 3, magazine: 4 } })
    ).toEqual({ status: 'APS 3/4', statusTone: null });
  });

  it('falls through moving to holding', () => {
    expect(s({ count: 2, routed: 0, pinned: 0, aboard: 0, moving: 2 }).status).toBe('2 moving');
    expect(s({ count: 2, routed: 0, pinned: 0, aboard: 0, moving: 0 }).status).toBe('holding');
  });

  it('says who is aboard a transport before it says anything calmer', () => {
    expect(s({ count: 4, routed: 0, pinned: 0, aboard: 4, moving: 4 }).status).toBe('4 aboard');
  });

  it('sums APS across the sub-group rather than showing one unit’s magazine', () => {
    const chips = groupChips([
      unit({ typeId: 'mbt_lavi', bucket: 'armour', aps: { ammo: 3, magazine: 3 } }),
      unit({ typeId: 'mbt_lavi', bucket: 'armour', aps: { ammo: 1, magazine: 3 } }),
    ]);
    expect(chips[0].status).toBe('APS 4/6');
  });
});

describe('chip focus', () => {
  it('wraps, so the last chip has a way back to the first', () => {
    expect(stepFocus(0, 3)).toBe(1);
    expect(stepFocus(2, 3)).toBe(0);
  });

  it('survives an empty row rather than dividing by zero', () => {
    expect(stepFocus(0, 0)).toBe(0);
  });
});
