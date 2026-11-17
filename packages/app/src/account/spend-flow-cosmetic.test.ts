// E13 (GH-1415): the signed-in coin Buy under "coins buy cosmetics only". Switch on, a unit or tier ask is refused HERE,
// before anything is marked pending or sent; switch off, the ask goes on to the sync loop as today (which, unattached,
// throws: the proof it got that far).
import { describe, expect, it } from 'vitest';
import { COINS_COSMETIC_ONLY } from '@lions/economy';
import type { AccountLedgerStore } from './account-store';
import { spendFlow } from './spend-flow';

/** A store that records every touch: a refused ask must leave it untouched. */
function store() {
  const touched: string[] = [];
  const s = {
    sync: { markPending: (k: string) => touched.push(`mark:${k}`), clearPending: (k: string) => touched.push(`clear:${k}`) },
  } as unknown as AccountLedgerStore;
  return { s, touched };
}

describe('spendFlow.buy and the switch', () => {
  it('ON: a unit and a tier ask answer `refused` and touch nothing', async () => {
    const { s, touched } = store();
    const flow = spendFlow({ store: s, online: () => true, cosmeticOnly: true });
    expect(await flow.buy({ kind: 'unit', unitId: 'dozer_d9' })).toBe('refused');
    expect(await flow.buy({ kind: 'tier', unitId: 'inf_squad', track: 'armour', tier: 1 })).toBe('refused');
    expect(touched).toEqual([]);
  });

  it('OFF: the ask goes on toward the server, as today', async () => {
    const { s } = store();
    const flow = spendFlow({ store: s, online: () => true, cosmeticOnly: false });
    await expect(flow.buy({ kind: 'unit', unitId: 'dozer_d9' })).rejects.toThrow(/attach\(sync\)/);
  });

  it('no switch in the options: the flow reads COINS_COSMETIC_ONLY', async () => {
    const { s, touched } = store();
    const flow = spendFlow({ store: s, online: () => true });
    const ask = flow.buy({ kind: 'unit', unitId: 'dozer_d9' });
    if (COINS_COSMETIC_ONLY) {
      expect(await ask).toBe('refused');
      expect(touched).toEqual([]);
    } else {
      await expect(ask).rejects.toThrow(/attach\(sync\)/);
    }
  });
});
