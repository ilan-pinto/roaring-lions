import { describe, expect, it } from 'vitest';
import type { LedgerData } from '@lions/sim';
import { sanitiseLedger } from './ledger-shape';

describe('sanitiseLedger and the wound counts (GH-707 P2)', () => {
  it('keeps numeric wounded_in_action / rescued on a roster entry, byte for byte', () => {
    const ledger: LedgerData = { 'roster.surviving_units': [{ type: 'inf_squad', veterancy: 1, wounded_in_action: 3, rescued: 2 }] };
    expect(sanitiseLedger(ledger)).toBe(ledger);
  });

  it('drops a wrong-typed count and keeps the row', () => {
    const bad = { 'roster.surviving_units': [{ type: 'inf_squad', veterancy: 1, rescued: 'two' }, { type: 'at_team', veterancy: 0 }] } as unknown as LedgerData;
    expect(sanitiseLedger(bad)['roster.surviving_units']).toEqual([{ type: 'inf_squad', veterancy: 1 }, { type: 'at_team', veterancy: 0 }]);
  });
});
