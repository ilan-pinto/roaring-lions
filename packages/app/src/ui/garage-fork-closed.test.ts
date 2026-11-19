// @vitest-environment jsdom
/**
 * GH-1384 slice 2, the switch CLOSED (the shipped `BRANCHES_OPEN = false`): the Garage and the Stores draw no fork, no
 * notice, no Switch or Return, and every Buy on a branched track asks exactly what it asked on dev. The open behaviour is
 * `garage-fork.test.ts`'s, which flips the switch through `vi.mock`.
 *
 * Literals: the Lavi's firepower track (data/units/kdf/mbt_lavi.json) prices 455, 680, 950; its tier 3 is branched in the
 * data, and closed it reads as its envelope, accuracy 0.85 + 0.10 = 95% and penetration 1300 + 325 = 1625.
 */
import { describe, expect, it } from 'vitest';
import { BRANCHES_OPEN, units } from '@lions/data';
import { showBrigade, type BrigadeUnit } from './brigade';
import { showStores } from './stores';

const lavi = units.mbt_lavi as unknown as { role: string; upgrades: NonNullable<BrigadeUnit['upgrades']> };
const roster = (): BrigadeUnit[] => [
  { id: 'mbt_lavi', name: 'Lavi', role: lavi.role, isKamikaze: false, transportSlots: 0, isSoft: false, canCarry: null, canEmbark: false, upgrades: lavi.upgrades },
];

function mount(owned: Record<string, Record<string, number>>, view: 'brigade' | 'stores', withLegacy: boolean) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const asked: unknown[][] = [];
  const dispose = showBrigade(host, {
    units: roster(),
    ledger: {},
    missionName: () => undefined,
    baseOf: (id) => ((units as Record<string, unknown>)[id] as { id: string } | undefined) ?? { id },
    possibleStars: 3,
    credits: 5000,
    owned,
    earned: owned,
    picks: {},
    // A legacy offer handed in by a confused caller still draws nothing: the fork never renders while closed.
    ...(withLegacy ? { legacy: { mbt_lavi: { firepower: { canSwitch: true, canReturn: true } } }, onLegacy: () => undefined } : {}),
    onBuyUpgrade: (...a: unknown[]) => {
      asked.push(a);
      return undefined;
    },
    stores: {
      coinSrc: (n) => `c${n}.png`,
      open: view === 'stores',
      read: () => ({ coin: { earnedUnits: new Set(['mbt_lavi']), coinUnits: new Set(), earnedTiers: owned, coinTiers: {} }, wallet: { coins: 900, receipts: [] } }),
      onBuy: (a) => {
        asked.push([a]);
        return undefined;
      },
    },
  });
  return { host, asked, dispose };
}

const FORK = '[data-fork], .rl-garage__fork, .rl-garage__fork-card, .rl-garage__fork-legacy, .rl-garage__branch-notice, .rl-stores__branches';

describe('the Garage fork, switch closed (GH-1384 slice 2)', () => {
  it('the switch is closed', () => {
    expect(BRANCHES_OPEN).toBe(false);
  });
  it('draws no fork on the branched tier: the plain rung and its plain Buy, asking four arguments as on dev', () => {
    const { host, asked, dispose } = mount({ mbt_lavi: { firepower: 2 } }, 'brigade', true);
    expect(host.querySelectorAll(FORK)).toHaveLength(0);
    const rung = host.querySelector<HTMLElement>('.rl-garage__track[data-track="firepower"] .rl-garage__rung[data-tier="3"]');
    expect(rung?.dataset.state).toBe('next');
    expect([...(rung?.querySelectorAll('.rl-garage__benefit') ?? [])].map((e) => e.textContent)).toEqual(['Accuracy 91% → 95%', 'Penetration 1508 → 1625']);
    const buy = rung?.querySelector<HTMLButtonElement>('button.rl-garage__buy-tier');
    expect(buy?.textContent).toBe('Buy tier 3 · 950');
    buy?.click();
    expect(asked).toEqual([['mbt_lavi', 'firepower', 3, 950]]);
    expect(asked[0]).toHaveLength(4);
    dispose();
  });
  it('an owned branched tier 3 reads Owned with no branch, no Given up, and no Switch or Return', () => {
    const { host, dispose } = mount({ mbt_lavi: { firepower: 3 } }, 'brigade', true);
    expect(host.querySelectorAll(FORK)).toHaveLength(0);
    expect(host.querySelectorAll('[data-legacy]')).toHaveLength(0);
    const head = host.querySelector('.rl-garage__track[data-track="firepower"] .rl-garage__rung[data-tier="3"] .rl-garage__rung-head');
    expect(head?.textContent?.trim()).toBe('Tier 3950Owned');
    dispose();
  });
  it('the Stores sells the branched tier as one coin Buy with no branch, and one credit Buy of four arguments', () => {
    const { host, asked, dispose } = mount({ mbt_lavi: { firepower: 2 } }, 'stores', false);
    expect(host.querySelectorAll(FORK)).toHaveLength(0);
    const row = host.querySelector<HTMLElement>('[data-item="tiers:mbt_lavi"] .rl-stores__tier[data-track="firepower"]');
    const coin = row?.querySelectorAll<HTMLButtonElement>('button[data-buy^="tier:"]');
    expect([...(coin ?? [])].map((b) => b.dataset.buy)).toEqual(['tier:mbt_lavi.firepower.3']);
    coin?.[0]?.click();
    row?.querySelector<HTMLButtonElement>('button[data-buy="credits:mbt_lavi.firepower"]')?.click();
    expect(asked).toEqual([[{ kind: 'tier', unitId: 'mbt_lavi', track: 'firepower', tier: 3 }], ['mbt_lavi', 'firepower', 3, 950]]);
    dispose();
  });
  it('the Stores on its own (no `branched` handed in) reads the shipped table: one coin Buy, no branch', () => {
    const host = document.createElement('div');
    const asks: unknown[] = [];
    const dispose = showStores(host, {
      units: roster().map((u) => ({ id: u.id, name: u.name, upgrades: u.upgrades })),
      ledger: {},
      owned: { mbt_lavi: { firepower: 2 } },
      credits: 5000,
      coin: { earnedUnits: new Set(['mbt_lavi']), coinUnits: new Set(), earnedTiers: { mbt_lavi: { firepower: 2 } }, coinTiers: {} },
      wallet: { coins: 900, receipts: [] },
      coinSrc: (n) => `c${n}.png`,
      missionName: () => undefined,
      confirm: () => Promise.resolve(true),
      onBuy: (a) => asks.push(a),
    });
    expect(host.querySelectorAll(FORK)).toHaveLength(0);
    host.querySelector<HTMLButtonElement>('button[data-buy="tier:mbt_lavi.firepower.3"]')?.click();
    expect(asks).toEqual([{ kind: 'tier', unitId: 'mbt_lavi', track: 'firepower', tier: 3 }]);
    dispose();
  });
});
