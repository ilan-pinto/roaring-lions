import { describe, expect, it } from 'vitest';
import type { LedgerData, MissionResult } from '@lions/sim';
import { gateRequirement } from './gate';

// GH-1385 F6: `gate.ts`'s branch order was read only through its two renderers' tests, which never tried the star
// boundary or a priced gate that also carries an earned field. These call `gateRequirement` with literal gates.

const starsLedger = (stars: MissionResult['stars'][]): LedgerData => ({
  'campaign.mission_results': Object.fromEntries(stars.map((s, i) => [`m${i}`, { stars: s, roe: 90, ticks: 0, lost: 0 }])),
});

describe('gateRequirement', () => {
  it('no gate, or a bought one, holds nothing back whatever else it says', () => {
    expect(gateRequirement(undefined, {})).toBeNull();
    expect(gateRequirement({ bought: true, starsMin: 99, price: 500 }, {})).toBeNull();
  });

  it('stars: exactly the floor opens it; one short names the need and the count', () => {
    expect(gateRequirement({ starsMin: 9 }, starsLedger([3, 3, 3]))).toBeNull();
    expect(gateRequirement({ starsMin: 9 }, starsLedger([3, 3, 2]))).toEqual({ kind: 'stars', need: 9, have: 8 });
  });

  it('a mission gate names the mission until the ledger lists it', () => {
    expect(gateRequirement({ afterMission: 'm9' }, {})).toEqual({ kind: 'mission', id: 'm9' });
    expect(gateRequirement({ afterMission: 'm9' }, { 'campaign.completed_missions': ['m9'] })).toBeNull();
  });

  it('a price is the binding gate only for a bought-only gate: an earned field that is met keeps the price out', () => {
    expect(gateRequirement({ price: 500 }, {})).toEqual({ kind: 'price', price: 500 });
    // Stars met, a price set as well: nothing is holding the unit back.
    expect(gateRequirement({ starsMin: 1, price: 500 }, starsLedger([3]))).toBeNull();
    // No earned field and no price: nothing to ask for.
    expect(gateRequirement({}, {})).toBeNull();
  });
});
