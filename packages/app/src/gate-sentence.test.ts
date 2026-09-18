import { describe, expect, it } from 'vitest';
import type { LedgerData, UnlockGate } from '@lions/sim';
import { gateRequirement, gateSentence, gateShort } from './gate-sentence';

const names = (id: string): string | undefined => ({ beit_sahwan_2_foothold: 'Foothold' })[id];

describe('gateSentence', () => {
  it('is null for no gate and for an open gate', () => {
    expect(gateSentence(undefined, {}, names)).toBeNull();
    expect(
      gateSentence(
        { afterMission: 'beit_sahwan_2_foothold' },
        { 'campaign.completed_missions': ['beit_sahwan_2_foothold'] },
        names
      )
    ).toBeNull();
  });
  it('names the mission, never its id', () => {
    expect(gateSentence({ afterMission: 'beit_sahwan_2_foothold' }, {}, names)).toBe('Clear Foothold first');
  });
  it('falls back to a neutral sentence when the mission is unknown to the catalogue', () => {
    expect(gateSentence({ afterMission: 'zz' }, {}, names)).toBe('Clear an earlier mission first');
  });
  it('speaks Conduct as a standing, not a number to reach', () => {
    expect(gateSentence({ roeMin: 35 }, {}, names)).toBe('Needs a campaign Conduct of 35 or better');
  });
  it('counts stars', () => {
    expect(gateSentence({ starsMin: 3 }, {}, names)).toBe('Needs 3 stars (you have 0)');
  });
  it('is null for a bought gate, regardless of what price or an earned field would otherwise say', () => {
    expect(gateSentence({ price: 600, bought: true }, {}, names)).toBeNull();
    expect(gateSentence({ roeMin: 90, price: 600, bought: true }, {}, names)).toBeNull();
  });
  it('speaks a price-only gate (D1, no earned field at all) as a Buy sentence', () => {
    expect(gateSentence({ price: 600 }, {}, names)).toBe('Buy for 600 credits');
  });
  it('keeps the binding earned sentence for a gate that is both priced and Conduct/stars/mission-gated', () => {
    expect(gateSentence({ roeMin: 40, price: 600 }, {}, names)).toBe('Needs a campaign Conduct of 40 or better');
    expect(gateSentence({ starsMin: 3, price: 600 }, {}, names)).toBe('Needs 3 stars (you have 0)');
    expect(gateSentence({ afterMission: 'beit_sahwan_2_foothold', price: 600 }, {}, names)).toBe('Clear Foothold first');
  });
});

describe('gateShort', () => {
  it('is null exactly where gateSentence is null', () => {
    expect(gateShort(undefined, {}, names)).toBeNull();
    expect(
      gateShort(
        { afterMission: 'beit_sahwan_2_foothold' },
        { 'campaign.completed_missions': ['beit_sahwan_2_foothold'] },
        names
      )
    ).toBeNull();
    expect(gateShort({ price: 600, bought: true }, {}, names)).toBeNull();
    expect(gateShort({ roeMin: 90, price: 600, bought: true }, {}, names)).toBeNull();
  });

  it('says the number, not the instruction', () => {
    expect(gateShort({ roeMin: 75 }, {}, names)).toBe('Conduct 75');
    expect(gateShort({ starsMin: 12 }, {}, names)).toBe('12★');
    expect(gateShort({ price: 240 }, {}, names)).toBe('Buy 240');
  });

  it('names the mission, never its id, and falls back to a neutral phrase', () => {
    expect(gateShort({ afterMission: 'beit_sahwan_2_foothold' }, {}, names)).toBe('Foothold');
    expect(gateShort({ afterMission: 'zz' }, {}, names)).toBe('Earlier mission');
  });

  // Two Conduct floors that differ must read differently -- the defect this
  // function exists for. `Needs a campaign Conduct of 35 or better` and
  // `... of 75 or better` share their first two dozen characters, so a clipped
  // chip showed both as `Needs a campaign Conduc…` and distinguished nothing.
  it('distinguishes two floors a clipped sentence could not', () => {
    expect(gateShort({ roeMin: 35 }, {}, names)).not.toBe(gateShort({ roeMin: 75 }, {}, names));
    expect(gateSentence({ roeMin: 35 }, {}, names)?.slice(0, 24)).toBe(
      gateSentence({ roeMin: 75 }, {}, names)?.slice(0, 24)
    );
  });
});

// The whole reason `gateRequirement` exists: one branch order, two renderings.
// A second copy of the precedence inside `gateShort` would be free to drift,
// and the drift would be invisible -- both functions would still return a
// perfectly good string, about different gates.
describe('gateShort and gateSentence agree about which gate binds', () => {
  const ledgers: [string, LedgerData][] = [
    ['fresh', {}],
    ['two ratings short of 40', { 'roe.mission_ratings': { a: 39, b: 40 } }],
    ['conduct cleared', { 'roe.mission_ratings': { a: 90, b: 90 } }],
    [
      'six missions at two stars',
      {
        'campaign.mission_results': Object.fromEntries(
          ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => [k, { stars: 2, roe: 90, ticks: 1, lost: 0 }])
        ),
        'roe.mission_ratings': { a: 90 },
      },
    ],
    ['foothold cleared', { 'campaign.completed_missions': ['beit_sahwan_2_foothold'] }],
  ];
  const gates: [string, UnlockGate][] = [
    ['conduct', { roeMin: 40 }],
    ['stars', { starsMin: 12 }],
    ['mission', { afterMission: 'beit_sahwan_2_foothold' }],
    ['price only', { price: 600 }],
    ['conduct + price', { roeMin: 40, price: 600 }],
    ['stars + price', { starsMin: 12, price: 600 }],
    ['mission + price', { afterMission: 'beit_sahwan_2_foothold', price: 600 }],
    [
      'conduct + stars + mission + price',
      { roeMin: 40, starsMin: 12, afterMission: 'beit_sahwan_2_foothold', price: 600 },
    ],
    ['bought', { roeMin: 90, price: 600, bought: true }],
  ];
  let closed = 0;
  for (const [ln, ledger] of ledgers) {
    for (const [gn, gate] of gates) {
      it(`${gn} on a ${ln} ledger`, () => {
        const need = gateRequirement(gate, ledger);
        const sentence = gateSentence(gate, ledger, names);
        const short = gateShort(gate, ledger, names);
        // Open or closed, all three agree.
        expect(sentence === null).toBe(need === null);
        expect(short === null).toBe(need === null);
        if (need === null || sentence === null || short === null) return;
        closed++;
        // And they agree about WHICH gate: both carry the binding
        // requirement's own number, or the mission's own name.
        const token =
          need.kind === 'conduct'
            ? String(need.floor)
            : need.kind === 'stars'
              ? String(need.need)
              : need.kind === 'price'
                ? String(need.price)
                : (names(need.id) ?? 'earlier');
        expect(short.toLowerCase()).toContain(token.toLowerCase());
        expect(sentence.toLowerCase()).toContain(token.toLowerCase());
      });
    }
  }
  it('compared a real spread of CLOSED gates, not an empty one', () => {
    expect(closed).toBeGreaterThan(25);
  });
});
