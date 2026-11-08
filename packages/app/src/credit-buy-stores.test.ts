// @vitest-environment jsdom
// The Stores tier row, driven through `buildCoinHalf` -- the one construction path `main.ts` uses --
// never a hand-built `CoinHalf` with an explicit 0 (that is the very shape that hid the bug).
import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import type { BrigadeAccount } from './brigade-account';
import { buildCoinHalf, buyTierWithCredits } from './credit-buy';
import { emptyRoar } from './roar-wallet';
import { creditAsk } from './upgrade-pay';
import { showStores } from './ui/stores';
import { storeItems } from './ui/stores-model';
import type { BrigadeUnit } from './ui/brigade';

const UNIT = 'mbt_lavi';
const TRACK = 'armour';

const roster = (): BrigadeUnit[] =>
  Object.values(units)
    .filter((u) => u.faction === 'kdf')
    .map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      isKamikaze: false,
      transportSlots: 0,
      isSoft: false,
      canCarry: null,
      canEmbark: false,
      upgrades: 'upgrades' in u ? u.upgrades : undefined,
    })) as BrigadeUnit[];

const prices = (): number[] => (roster().find((u) => u.id === UNIT)?.upgrades?.[TRACK]?.tiers ?? []).map((x) => x.price);
const account = (): BrigadeAccount =>
  ({ balance: 5000, earned_total: 5000, unlocks: [], upgrades: {}, grants: [], campaign_paid: {}, paid: 0 }) as unknown as BrigadeAccount;
const roarAt = (tier: number) => {
  const w = emptyRoar();
  w.entitlements.upgrades[UNIT] = { [TRACK]: { tier, paidTiers: 0 } };
  return w;
};

describe('the Stores tier row, earned 0 and coin tier 2', () => {
  it('prices the run 1..3, not the single tier, through the app construction path', () => {
    const p = prices();
    expect(p.length).toBeGreaterThanOrEqual(3);
    const acct = account();
    const coin = buildCoinHalf(roster(), acct, roarAt(2));
    // The app's own owned view: max(earned, coins).
    const owned = { [UNIT]: { [TRACK]: 2 } };
    const item = storeItems({ units: roster(), ledger: {}, credits: 5000, owned, coin }).tiers.find((x) => x.unitId === UNIT && x.track === TRACK);
    expect(item?.owned).toBe(2);
    expect(item?.earned).toBe(0);
    const ask = creditAsk(p, item?.earned ?? -1, item?.owned ?? -1);
    const run = p[0] + p[1] + p[2];
    expect(run).not.toBe(p[2]);
    expect(ask).toEqual({ from: 1, to: 3, price: run, again: 2 });

    // The row draws the run's total beside the Buy, and a press lands earned 3 for exactly that.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const pressed: [string, string, number, number][] = [];
    showStores(host, {
      units: roster(),
      ledger: {},
      credits: 5000,
      owned,
      coin,
      coinSrc: (s) => `/c${s}.png`,
      missionName: () => undefined,
      onBuyTierCredits: (u, tr, to, price) => pressed.push([u, tr, to, price]),
    });
    const row = host.querySelector<HTMLElement>(`[data-buy="credits:${UNIT}.${TRACK}"]`);
    expect(row).not.toBeNull();
    expect(row?.closest('.rl-stores__tier')?.querySelector('.rl-stores__credits')?.textContent).toContain(String(run));
    row?.click();
    expect(pressed).toEqual([[UNIT, TRACK, 3, run]]);

    const done = buyTierWithCredits({ account: acct, owned }, p, UNIT, TRACK, pressed[0][2], pressed[0][3]);
    expect(done.ok).toBe(true);
    expect(done.account.upgrades[UNIT]?.[TRACK]).toBe(3);
    expect(done.account.balance).toBe(5000 - run);
    host.remove();
  });
});
