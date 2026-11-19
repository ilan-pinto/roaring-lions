// @vitest-environment jsdom
/**
 * GH-1384 slice 2: the Garage fork with the branch switch OPEN (`vi.mock` of the one module that holds it, as
 * economy's `branch-switch-open.test.ts` does), so the cards read each branch through the same `tierPatch` the sim's
 * `applyUpgrades` reads. The closed build is `garage-fork-closed.test.ts`'s.
 *
 * Literals from data/units/kdf/mbt_lavi.json, firepower: base accuracy 0.85 and penetration 1300; tier 2 +0.06 / +208
 * (91%, 1508); tier 3 (950 credits) branch 1 `fire_control` +0.10 / +208 (95%, 1508), branch 2 `long_rod` +0.06 / +325
 * (91%, 1625). Tier prices 455, 680, 950. The en.json names: "Fire-control computer", "Long-rod round".
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../data/src/branches-open', () => ({ BRANCHES_OPEN: true }));

const { units, branchedTable } = await import('@lions/data');
const { emptyAccount, emptyRoar } = await import('@lions/economy');
const { givesUp, givesUpText, forkRung } = await import('./garage-fork');
const { trackEl } = await import('./garage-board');
const { showBrigade } = await import('./brigade');
const { showStores } = await import('./stores');
const { legacyOffers, legacyOnStore } = await import('../garage-legacy');
const { buyTierWithCredits } = await import('../credit-buy');

type Unit = import('@lions/data').UpgradableUnit;
type BrigadeUnit = import('./brigade').BrigadeUnit;
type ForkDeps = import('./garage-fork').ForkDeps;
type ConfirmOptions = import('./confirm').ConfirmOptions;

const lavi = units.mbt_lavi as unknown as Unit & { role: string };
const LAVI = branchedTable([lavi]);
const firepower = lavi.upgrades?.firepower;
if (firepower === undefined) throw new Error('fixture: the Lavi has no firepower track');

/** A confirm that records what it was asked and answers `yes`. */
function confirmer(yes: boolean) {
  const asked: ConfirmOptions[] = [];
  return { asked, confirm: (o: ConfirmOptions) => (asked.push(o), Promise.resolve(yes)) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const texts = (root: ParentNode | null | undefined, sel: string): string[] => [...(root?.querySelectorAll(sel) ?? [])].map((e) => e.textContent ?? '');

function board(owned: number, fork: Partial<ForkDeps>, onBuy?: (...a: unknown[]) => void) {
  return trackEl('firepower', firepower as NonNullable<typeof firepower>, {
    unit: lavi,
    unitId: 'mbt_lavi',
    unitName: 'Lavi',
    owned,
    preview: () => {},
    ...(onBuy !== undefined ? { buy: { credits: 5000, onBuy } } : {}),
    fork: { tier: 3, confirm: () => Promise.resolve(true), ...fork },
  });
}

describe('givesUp: computed, never authored (§3.1)', () => {
  it('each branch gives up the path the other ends higher on, with both numbers', () => {
    expect(givesUp(lavi, 'firepower', 1).map((l) => [l.path, l.mine, l.theirs])).toEqual([['weapons[0].penetration', 1508, 1625]]);
    expect(givesUp(lavi, 'firepower', 2).map((l) => [l.path, l.mine, l.theirs])).toEqual([['weapons[0].accuracy', 0.91, 0.95]]);
    expect(givesUp(lavi, 'firepower', 1).map(givesUpText)).toEqual(['Penetration stays 1508 (not 1625)']);
    expect(givesUp(lavi, 'firepower', 2).map(givesUpText)).toEqual(['Accuracy stays 91% (not 95%)']);
  });
  it('a path both branches end level on is not given up (an inline fixture: hp ties at +10)', () => {
    const fx = {
      id: 'fx',
      hull: { hp: 100 },
      weapons: [{ accuracy: 0.5, penetration: 100 }],
      upgrades: {
        kit: {
          tiers: [
            {
              price: 10,
              branches: [
                { id: 'a', label: 'x.a', patch: { 'hull.hp': 10, 'weapons[0].accuracy': 0.1 } },
                { id: 'b', label: 'x.b', patch: { 'hull.hp': 10, 'weapons[0].penetration': 50 } },
              ],
            },
          ],
        },
      },
    } as unknown as Unit;
    expect(givesUp(fx, 'kit', 1).map((l) => [l.path, l.mine, l.theirs])).toEqual([['weapons[0].penetration', 100, 150]]);
    expect(givesUp(fx, 'kit', 2).map((l) => [l.path, l.mine, l.theirs])).toEqual([['weapons[0].accuracy', 0.5, 0.6]]);
  });
  it('an unbranched track gives up nothing', () => {
    expect(givesUp(lavi, 'armour', 1)).toEqual([]);
  });
});

describe('the fork rung, next (two cards)', () => {
  it('draws both branches with their own benefit lines and what each gives up', () => {
    const el = board(2, {});
    const rung = el.querySelector<HTMLElement>('.rl-garage__rung[data-tier="3"]');
    expect(rung?.dataset.fork).toBe('1');
    const cards = [...(rung?.querySelectorAll<HTMLElement>('.rl-garage__fork-card') ?? [])];
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['Fire-control computer', 'Long-rod round']);
    expect(texts(cards[0], '.rl-garage__benefit')).toEqual(['Accuracy 91% → 95%']);
    expect(texts(cards[1], '.rl-garage__benefit')).toEqual(['Penetration 1508 → 1625']);
    expect(texts(cards[0], '.rl-garage__fork-gives-line')).toEqual(['Penetration stays 1508 (not 1625)']);
    expect(texts(cards[1], '.rl-garage__fork-gives-line')).toEqual(['Accuracy stays 91% (not 95%)']);
    expect(texts(rung, '.rl-garage__fork-final')).toEqual(['This choice is final. The branch you do not choose cannot be bought later.']);
    // Tiers 1 and 2 are the plain rungs.
    expect(el.querySelectorAll('[data-fork]')).toHaveLength(1);
  });
  it('Choose asks the confirm first, naming both branches, and buys only on yes, with its pick', async () => {
    const no = confirmer(false);
    const bought: unknown[][] = [];
    const el = board(2, { confirm: no.confirm }, (...a) => bought.push(a));
    const choose = el.querySelectorAll<HTMLButtonElement>('button.rl-garage__fork-buy');
    expect([...choose].map((b) => b.textContent)).toEqual(['Choose · 950 credits', 'Choose · 950 credits']);
    expect(choose[1]?.getAttribute('aria-label')).toBe('choose Long-rod round for Lavi, 950 credits, gives up Fire-control computer');
    choose[1]?.click();
    await flush();
    expect(no.asked.map((o) => o.body)).toEqual(['You are choosing Long-rod round. Fire-control computer is given up for good.']);
    expect(bought).toEqual([]);
    expect(choose[1]?.disabled).toBe(false); // a cancel puts the Choose back

    const yes = confirmer(true);
    const el2 = board(2, { confirm: yes.confirm }, (...a) => bought.push(a));
    el2.querySelectorAll<HTMLButtonElement>('button.rl-garage__fork-buy')[1]?.click();
    await flush();
    expect(yes.asked.map((o) => o.title)).toEqual(['Choose Long-rod round?']);
    expect(bought).toEqual([[3, 950, 'buy:firepower', 2]]);
  });
  it('a locked unit shows the cards with no Choose', () => {
    const el = trackEl('firepower', firepower as NonNullable<typeof firepower>, {
      unit: lavi, unitId: 'mbt_lavi', unitName: 'Lavi', owned: 2, preview: () => {}, locked: true,
      buy: { credits: 5000, onBuy: () => {} },
      fork: { tier: 3, confirm: () => Promise.resolve(true) },
    });
    expect(el.querySelectorAll('.rl-garage__fork-card')).toHaveLength(2);
    expect(el.querySelectorAll('button.rl-garage__fork-buy')).toHaveLength(0);
    expect(texts(el, '.rl-garage__track-lock')).toEqual(['Unlock first']);
  });
});

describe('the fork rung, owned and future', () => {
  it('owned: the branch named, and what was given up muted with its numbers', () => {
    const rung = board(3, { pick: 2 }).querySelector('.rl-garage__rung[data-tier="3"]');
    expect(texts(rung, '.rl-garage__fork-name')).toEqual(['Long-rod round']);
    expect(texts(rung, '.rl-garage__fork-given-name')).toEqual(['Given up: Fire-control computer']);
    expect(texts(rung, '.rl-garage__fork-given-line')).toEqual(['Accuracy stays 91% (not 95%)']);
    expect(rung?.querySelectorAll('button')).toHaveLength(0);
  });
  it('future: one line naming both branches', () => {
    const rung = board(1, {}).querySelector<HTMLElement>('.rl-garage__rung[data-tier="3"]');
    expect(rung?.title).toBe('Choice of Fire-control computer or Long-rod round');
    expect(rung?.querySelectorAll('.rl-garage__fork-card')).toHaveLength(0);
  });
});

describe('the legacy controls (Q8, Q11, R12)', () => {
  const legacyFork = (legacy: { canSwitch: boolean; canReturn: boolean }, yes = true) => {
    const c = confirmer(yes);
    const asked: string[] = [];
    const rung = forkRung({
      unit: lavi, unitId: 'mbt_lavi', unitName: 'Lavi', trackName: 'firepower', trackLabel: 'Firepower', owned: 3, price: 950,
      state: 'owned', locked: false, preview: () => {},
      fork: { tier: 3, pick: 1, confirm: c.confirm, legacy, onLegacy: (a) => asked.push(a) },
    });
    return { rung, asked, c };
  };
  it('offers Switch and Return, each confirmed before it asks', async () => {
    const { rung, asked, c } = legacyFork({ canSwitch: true, canReturn: true });
    expect(texts(rung, '.rl-garage__fork-legacy-title')).toEqual(['Your Tier 3 became a choice']);
    const btns = [...rung.querySelectorAll<HTMLButtonElement>('button[data-legacy]')];
    expect(btns.map((b) => b.textContent)).toEqual(['Switch to Long-rod round, free', 'Return Tier 3 for a full refund']);
    btns[0]?.click();
    btns[1]?.click();
    await flush();
    expect(c.asked.map((o) => o.title)).toEqual(['Switch to Long-rod round?', 'Return Tier 3?']);
    expect(asked).toEqual(['switch', 'return']);
  });
  it('a cancelled confirm asks nothing', async () => {
    const { rung, asked } = legacyFork({ canSwitch: true, canReturn: true }, false);
    rung.querySelector<HTMLButtonElement>('button[data-legacy="return"]')?.click();
    await flush();
    expect(asked).toEqual([]);
  });
  it('Switch is withheld on a mix of legacy and fresh (L4: the account fresh at branch 2, the wallet legacy)', () => {
    const account = { ...emptyAccount(), upgrades: { mbt_lavi: { firepower: 3 } }, picks: { mbt_lavi: { firepower: 2 as const } }, legacy: {} };
    const roar = { ...emptyRoar(), entitlements: { units: {}, upgrades: { mbt_lavi: { firepower: { tier: 3, paidTiers: 0, branch: 1 as const, legacy: true as const } } } } };
    const offer = legacyOffers(account, roar, LAVI);
    expect(offer).toEqual({ mbt_lavi: { firepower: { canSwitch: false, canReturn: true } } });
    const { rung } = legacyFork(offer.mbt_lavi.firepower);
    expect([...rung.querySelectorAll<HTMLButtonElement>('button[data-legacy]')].map((b) => b.dataset.legacy)).toEqual(['return']);
  });
  it('no marker standing: no offer, and no legacy block', () => {
    const account = { ...emptyAccount(), upgrades: { mbt_lavi: { firepower: 3 } }, picks: { mbt_lavi: { firepower: 2 as const } }, legacy: {} };
    expect(legacyOffers(account, emptyRoar(), LAVI)).toEqual({});
    const rung = board(3, { pick: 2, legacy: null, onLegacy: () => {} }).querySelector('.rl-garage__rung[data-tier="3"]');
    expect(rung?.querySelectorAll('[data-legacy]')).toHaveLength(0);
  });
});

describe('legacyOnStore: both stores, all or none', () => {
  const legacyAccount = () => ({
    ...emptyAccount(),
    balance: 100,
    earned_total: 3000,
    upgrades: { mbt_lavi: { firepower: 3 } },
    picks: { mbt_lavi: { firepower: 1 as const } },
    legacy: { mbt_lavi: { firepower: true as const } },
  });
  function store(account: ReturnType<typeof legacyAccount>, refuseRoar = false) {
    const s = {
      account: account as ReturnType<typeof emptyAccount>,
      roar: emptyRoar(),
      writes: [] as string[],
      readAccount: () => s.account,
      writeAccount: (a: ReturnType<typeof emptyAccount>) => {
        s.writes.push('account');
        s.account = a;
      },
      readRoar: () => s.roar,
      writeRoar: (w: ReturnType<typeof emptyRoar>) => {
        if (refuseRoar) throw new Error('quota');
        s.writes.push('roar');
        s.roar = w;
      },
    };
    return s;
  }
  it('Switch moves the account to branch 2 and clears its marker, free', () => {
    const s = store(legacyAccount());
    expect(legacyOnStore(s, 'mbt_lavi', 'firepower', 'switch', 7, LAVI)).toEqual({ ok: true, refund: { credits: 0, coins: { free: 0, paid: 0 } } });
    expect([s.account.balance, s.account.picks, s.account.legacy]).toEqual([100, { mbt_lavi: { firepower: 2 } }, {}]);
  });
  it('Return drops the account to tier 2 and refunds the 950 the branched tier costs', () => {
    const s = store(legacyAccount());
    expect(legacyOnStore(s, 'mbt_lavi', 'firepower', 'return', 7, LAVI)).toEqual({ ok: true, refund: { credits: 950, coins: { free: 0, paid: 0 } } });
    expect([s.account.balance, s.account.upgrades.mbt_lavi.firepower, s.account.picks, s.account.legacy]).toEqual([1050, 2, {}, {}]);
  });
  it('a refused wallet write puts the account back (a wallet marker too, so both stores move)', () => {
    const s = store(legacyAccount(), true);
    s.roar = { ...emptyRoar(), entitlements: { units: {}, upgrades: { mbt_lavi: { firepower: { tier: 3, paidTiers: 0, branch: 1, legacy: true } } } } };
    const before = s.account;
    expect(legacyOnStore(s, 'mbt_lavi', 'firepower', 'return', 7, LAVI)).toEqual({ ok: false });
    expect(s.account).toEqual(before);
    expect(s.writes).toEqual(['account', 'account']);
  });
  it('refuses, writing nothing, where no marker stands', () => {
    const s = store({ ...legacyAccount(), legacy: {} as never });
    expect(legacyOnStore(s, 'mbt_lavi', 'firepower', 'return', 7, LAVI)).toEqual({ ok: false });
    expect(s.writes).toEqual([]);
  });
});

describe('buyTierWithCredits buys the branch the fork chose', () => {
  const read = () => ({ account: { ...emptyAccount(), balance: 2000, earned_total: 2000, upgrades: { mbt_lavi: { firepower: 2 } } }, owned: { mbt_lavi: { firepower: 2 } }, roar: emptyRoar() });
  it('with pick 2 the account holds tier 3 at branch 2; with no pick it is refused', () => {
    const r = buyTierWithCredits(read(), [455, 680, 950], 'mbt_lavi', 'firepower', 3, 950, 2, LAVI);
    expect([r.ok, r.account.balance, r.account.upgrades.mbt_lavi.firepower, r.account.picks]).toEqual([true, 1050, 3, { mbt_lavi: { firepower: 2 } }]);
    expect(buyTierWithCredits(read(), [455, 680, 950], 'mbt_lavi', 'firepower', 3, 950, undefined, LAVI).ok).toBe(false);
  });
});

const roster = (): BrigadeUnit[] => [
  { id: 'mbt_lavi', name: 'Lavi', role: lavi.role, isKamikaze: false, transportSlots: 0, isSoft: false, canCarry: null, canEmbark: false, upgrades: lavi.upgrades },
];

describe('the Garage screen, open', () => {
  function mount(opts: Record<string, unknown>) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = showBrigade(host, {
      units: roster(),
      ledger: {},
      missionName: () => undefined,
      baseOf: (id: string) => ((units as Record<string, unknown>)[id] as { id: string } | undefined) ?? { id },
      possibleStars: 3,
      credits: 5000,
      ...opts,
    } as Parameters<typeof showBrigade>[1]);
    return { host, dispose };
  }
  it('draws the fork; Choose opens the confirm dialog, and yes asks onBuyUpgrade with the pick', async () => {
    const asked: unknown[][] = [];
    const { host, dispose } = mount({
      owned: { mbt_lavi: { firepower: 2 } },
      earned: { mbt_lavi: { firepower: 2 } },
      branched: LAVI,
      onBuyUpgrade: (...a: unknown[]) => (asked.push(a), undefined),
    });
    expect(host.querySelectorAll('.rl-garage__fork-card')).toHaveLength(2);
    host.querySelectorAll<HTMLButtonElement>('button.rl-garage__fork-buy')[0]?.click();
    const dialog = host.querySelector('.rl-confirm');
    expect(dialog?.querySelector('.rl-confirm__body')?.textContent).toBe('You are choosing Fire-control computer. Long-rod round is given up for good.');
    dialog?.querySelector<HTMLButtonElement>('.rl-confirm__yes')?.click();
    await flush();
    expect(asked).toEqual([['mbt_lavi', 'firepower', 3, 950, 1]]);
    dispose();
  });
  it('the disposer takes an open confirm down, and its late answer buys nothing', async () => {
    const asked: unknown[][] = [];
    const { host, dispose } = mount({
      owned: { mbt_lavi: { firepower: 2 } },
      branched: LAVI,
      onBuyUpgrade: (...a: unknown[]) => (asked.push(a), undefined),
    });
    host.querySelectorAll<HTMLButtonElement>('button.rl-garage__fork-buy')[1]?.click();
    expect(document.querySelectorAll('.rl-confirm')).toHaveLength(1);
    dispose();
    expect(document.querySelectorAll('.rl-confirm')).toHaveLength(0);
    await flush();
    expect(asked).toEqual([]);
  });
  it('the notice names each legacy (unit, track) and only beside onLegacy; Switch asks onLegacy', async () => {
    const legacy = { mbt_lavi: { firepower: { canSwitch: true, canReturn: true } } };
    const base = { owned: { mbt_lavi: { firepower: 3 } }, picks: { mbt_lavi: { firepower: 1 } }, legacy, branched: LAVI };
    const without = mount(base);
    expect(without.host.querySelectorAll('.rl-garage__branch-notice, [data-legacy]')).toHaveLength(0);
    without.dispose();
    const asked: string[] = [];
    const { host, dispose } = mount({ ...base, onLegacy: (_u: string, _t: string, a: string) => (asked.push(a), undefined) });
    expect(texts(host, '.rl-garage__branch-notice li')).toEqual(['Lavi, Firepower: now Fire-control computer']);
    host.querySelector<HTMLButtonElement>('button[data-legacy="switch"]')?.click();
    host.querySelector<HTMLButtonElement>('.rl-confirm .rl-confirm__yes')?.click();
    await flush();
    expect(asked).toEqual(['switch']);
    dispose();
  });
});

describe('the Stores, open: a branched tier sells as two confirmed Buys', () => {
  function stores(confirm?: (o: ConfirmOptions) => Promise<boolean>) {
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
      branched: LAVI,
      ...(confirm !== undefined ? { confirm } : {}),
      onBuy: (a) => asks.push(a),
      onBuyTierCredits: (...a: unknown[]) => asks.push(a),
    });
    const row = host.querySelector<HTMLElement>('.rl-stores__tier[data-track="firepower"]');
    return { row, asks, dispose };
  }
  it('names both branches, and each Buy asks with its branch only after yes', async () => {
    const yes = confirmer(true);
    const { row, asks, dispose } = stores(yes.confirm);
    expect(texts(row, '.rl-stores__branch-name')).toEqual(['Fire-control computer', 'Long-rod round']);
    row?.querySelector<HTMLButtonElement>('button[data-buy="tier:mbt_lavi.firepower.3:2"]')?.click();
    row?.querySelector<HTMLButtonElement>('button[data-buy="credits:mbt_lavi.firepower:1"]')?.click();
    await flush();
    expect(yes.asked).toHaveLength(2);
    expect(asks).toEqual([{ kind: 'tier', unitId: 'mbt_lavi', track: 'firepower', tier: 3, branch: 2 }, ['mbt_lavi', 'firepower', 3, 950, 1]]);
    dispose();
  });
  it('a cancelled confirm asks nothing, and with no confirm no Buy is drawn', async () => {
    const no = confirmer(false);
    const a = stores(no.confirm);
    a.row?.querySelector<HTMLButtonElement>('button[data-buy="tier:mbt_lavi.firepower.3:1"]')?.click();
    await flush();
    expect(a.asks).toEqual([]);
    a.dispose();
    const b = stores();
    expect(texts(b.row, '.rl-stores__branch-name')).toHaveLength(2);
    expect(b.row?.querySelectorAll('button')).toHaveLength(0);
    b.dispose();
  });
});
