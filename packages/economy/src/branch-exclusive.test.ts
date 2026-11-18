/**
 * GH-1384 §5: both branches of a branched tier can never be owned at once.
 *
 * Every `applyUpgrades` here passes the branch switch OPEN (`true`), and every economy function a branched table, so the
 * branch rules are tested while the shipped switch (`BRANCHES_OPEN`) stays closed; `branch-switch.test.ts` holds the closed
 * build to dev.
 *
 * The fixtures are LITERAL and inline (an oracle takes literals: CLAUDE.md, the falsification
 * casebook), and every economy function under test is handed `branchedTable([FX_TANK, FX_IFV])`, so
 * nothing here reads the shipped roster except case 7, which pins the shipped content against
 * literals copied from the design's §2.1 table. Two fixture units branch the SAME track name
 * (`firepower`), so a picks map keyed by track alone conflates them; `FX_TANK` branches two tracks,
 * so a map keyed by unit alone, or an `applyUpgrades` that reads one track's pick for another, is
 * seen too (the lead, Q3).
 *
 * The invariant (§5.1), checked at every state the search reaches from the empty pair and from the
 * literal legacy roots L1 to L7: the resolved kit of each branched (unit, track) is branch 1, branch
 * 2, or a tier below the branched one, NEVER the envelope; (s1) no edge takes the two stores from at
 * most one distinct pick on a (unit, track) to two; (s2) a store's pick changes only through the
 * legacy Switch on THAT (unit, track), or leaves with its tier.
 */
import { describe, expect, it } from 'vitest';
import { applyUpgrades, branchedTable, units, type BranchPick, type UpgradableUnit } from '@lions/data';
import { buyBranch, buyUpgradeRun, emptyAccount, migrateAccount, type BrigadeAccount } from './brigade';
import { legacyOffer, returnLegacy, switchLegacy } from './branch-legacy';
import { buildCoinHalf } from './store-input';
import { buyWithCoins, coinPrice, type StoreInput } from './stores';
import { buyBranchWithCoins, buyTierWithCoins, emptyRoar, migrateRoar, singlePlayerView, type RoarWallet } from './wallet';

// ---- the literal fixtures (§5.2) --------------------------------------------------------------------

const FX_TANK: UpgradableUnit = {
  id: 'fx_tank',
  hull: { hp: 2000, armor: { front: 600 } },
  weapons: [{ accuracy: 0.85, penetration: 1300 }],
  upgrades: {
    firepower: {
      tiers: [
        { price: 455, patch: { 'weapons[0].accuracy': 0.03, 'weapons[0].penetration': 104 } },
        { price: 680, patch: { 'weapons[0].accuracy': 0.06, 'weapons[0].penetration': 208 } },
        {
          price: 950,
          branches: [
            { id: 'a', label: 'garage.branch.fx_tank.a', patch: { 'weapons[0].accuracy': 0.1, 'weapons[0].penetration': 208 } },
            { id: 'b', label: 'garage.branch.fx_tank.b', patch: { 'weapons[0].accuracy': 0.06, 'weapons[0].penetration': 325 } },
          ],
        },
      ],
    },
    armour: {
      tiers: [
        { price: 300, patch: { 'hull.hp': 100, 'hull.armor.front': 30 } },
        { price: 450, patch: { 'hull.hp': 200, 'hull.armor.front': 60 } },
        {
          price: 640,
          branches: [
            { id: 'a', label: 'garage.branch.fx_tank.armour_a', patch: { 'hull.hp': 300, 'hull.armor.front': 60 } },
            { id: 'b', label: 'garage.branch.fx_tank.armour_b', patch: { 'hull.hp': 200, 'hull.armor.front': 90 } },
          ],
        },
      ],
    },
  },
};

const FX_IFV: UpgradableUnit = {
  id: 'fx_ifv',
  weapons: [{ accuracy: 0.7, penetration: 120 }],
  upgrades: {
    firepower: {
      tiers: [
        { price: 330, patch: { 'weapons[0].accuracy': 0.03, 'weapons[0].penetration': 10 } },
        { price: 495, patch: { 'weapons[0].accuracy': 0.06, 'weapons[0].penetration': 19 } },
        {
          price: 660,
          branches: [
            { id: 'a', label: 'garage.branch.fx_ifv.a', patch: { 'weapons[0].accuracy': 0.1, 'weapons[0].penetration': 19 } },
            { id: 'b', label: 'garage.branch.fx_ifv.b', patch: { 'weapons[0].accuracy': 0.06, 'weapons[0].penetration': 30 } },
          ],
        },
      ],
    },
  },
};

const FIXTURES = [FX_TANK, FX_IFV] as const;
const BRANCHED = branchedTable(FIXTURES);
const PRICES: Record<string, Record<string, readonly number[]>> = {
  fx_tank: { firepower: [455, 680, 950], armour: [300, 450, 640] },
  fx_ifv: { firepower: [330, 495, 660] },
};
/** Every branched (unit, track) of the fixtures, written out (not read off the table under test). */
const TRACKS: readonly (readonly [UpgradableUnit, string])[] = [
  [FX_TANK, 'firepower'],
  [FX_TANK, 'armour'],
  [FX_IFV, 'firepower'],
];

/** The hand-computed readings (§5.2's tables): [first path, second path] per state. */
type Reading = 'ONE' | 'TWO' | 'T2' | 'BOTH' | 'LOW';
const TABLE: Record<string, Record<string, Record<'ONE' | 'TWO' | 'T2' | 'BOTH', readonly [number, number]>>> = {
  fx_tank: {
    firepower: { ONE: [0.95, 1508], TWO: [0.91, 1625], T2: [0.91, 1508], BOTH: [0.95, 1625] },
    armour: { ONE: [2300, 660], TWO: [2200, 690], T2: [2200, 660], BOTH: [2300, 690] },
  },
  fx_ifv: { firepower: { ONE: [0.8, 139], TWO: [0.76, 150], T2: [0.76, 139], BOTH: [0.8, 150] } },
};
const PATHS: Record<string, readonly [(u: UpgradableUnit) => number, (u: UpgradableUnit) => number]> = {
  firepower: [(u) => (u.weapons?.[0] as { accuracy: number }).accuracy, (u) => (u.weapons?.[0] as { penetration: number }).penetration],
  armour: [(u) => (u.hull as { hp: number }).hp, (u) => ((u.hull as { armor: { front: number } }).armor).front],
};
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

function readingOf(unit: UpgradableUnit, track: string, kitted: UpgradableUnit): Reading {
  const [p, q] = PATHS[track];
  const got = [p(kitted), q(kitted)];
  for (const k of ['BOTH', 'ONE', 'TWO', 'T2'] as const) {
    const want = TABLE[unit.id][track][k];
    if (near(got[0], want[0]) && near(got[1], want[1])) return k;
  }
  return 'LOW';
}

function viewReading(s: State, unit: UpgradableUnit, track: string): Reading {
  const v = singlePlayerView(s.account, s.roar);
  return readingOf(unit, track, applyUpgrades(unit, v.ownedTiers[unit.id] ?? {}, v.ownedPicks[unit.id] ?? {}, true));
}

// ---- states and operations ----------------------------------------------------------------------------

interface State {
  account: BrigadeAccount;
  roar: RoarWallet;
}

const FUND = 5000;
/** A funded account: the grants log explains the balance plus `spent`, as a real account's does (a
 *  balance the log cannot explain is reduced by `migrateAccount`). */
function funded(over: Partial<BrigadeAccount> = {}, spent = 0): BrigadeAccount {
  return { ...emptyAccount(), balance: FUND, earned_total: FUND + spent, grants: [{ source: 'granted', amount: FUND + spent, at: 0 }], ...over };
}
const fundedRoar = (over: Partial<RoarWallet> = {}): RoarWallet => ({ ...emptyRoar(), coins: { free: FUND, paid: 0 }, ...over });

const storeUnits = FIXTURES.map((u) => ({ id: u.id, name: u.id, upgrades: u.upgrades }));
function storeInput(s: State): StoreInput {
  const v = singlePlayerView(s.account, s.roar);
  return { units: storeUnits, ledger: {}, credits: s.account.balance, owned: v.ownedTiers, ownedPicks: v.ownedPicks, coin: buildCoinHalf(storeUnits, s.account, s.roar) };
}

type Op = { name: string; unit: string; track: string; kind: 'buy' | 'switch' | 'return' | 'migrate'; run: (s: State) => State | null };

const tierIn = (s: State, u: string, t: string): number => s.account.upgrades[u]?.[t] ?? 0;
const coinTierIn = (s: State, u: string, t: string): number => s.roar.entitlements.upgrades[u]?.[t]?.tier ?? 0;
const viewTier = (s: State, u: string, t: string): number => Math.max(tierIn(s, u, t), coinTierIn(s, u, t));

function opsFor(): Op[] {
  const ops: Op[] = [];
  for (const [unit, track] of TRACKS) {
    const u = unit.id;
    const prices = PRICES[u][track];
    for (let to = 1; to <= 3; to++) {
      ops.push({
        name: `credit run ${u}.${track} -> ${to}`, unit: u, track, kind: 'buy',
        run: (s) => {
          const r = buyUpgradeRun(s.account, u, track, tierIn(s, u, track) + 1, to, prices, BRANCHED);
          return r.ok ? { ...s, account: r.account } : null;
        },
      });
    }
    for (const pick of [1, 2] as const) {
      // Every `from`, not only `earned + 1`: a caller can pass any, and the run rule is what must refuse a held tier.
      for (const from of [1, 2, 3]) {
        ops.push({
          name: `credit branch ${u}.${track} ${pick} from ${from}`, unit: u, track, kind: 'buy',
          run: (s) => {
            const r = buyBranch(s.account, s.roar, u, track, from, pick, prices, BRANCHED);
            return r.ok ? { ...s, account: r.account } : null;
          },
        });
      }
      ops.push({
        name: `coin branch ${u}.${track} ${pick}`, unit: u, track, kind: 'buy',
        run: (s) => {
          const r = buyWithCoins(storeInput(s), s.roar, { kind: 'tier', unitId: u, track, tier: viewTier(s, u, track) + 1, branch: pick }, 0, BRANCHED);
          return r.ok ? { ...s, roar: r.account } : null;
        },
      });
    }
    ops.push({
      name: `coin tier ${u}.${track}`, unit: u, track, kind: 'buy',
      run: (s) => {
        const r = buyWithCoins(storeInput(s), s.roar, { kind: 'tier', unitId: u, track, tier: viewTier(s, u, track) + 1 }, 0, BRANCHED);
        return r.ok ? { ...s, roar: r.account } : null;
      },
    });
    ops.push({
      name: `switch ${u}.${track}`, unit: u, track, kind: 'switch',
      run: (s) => {
        const r = switchLegacy(s.account, s.roar, u, track, BRANCHED);
        return r.ok ? { account: r.account, roar: r.roar } : null;
      },
    });
    ops.push({
      name: `return ${u}.${track}`, unit: u, track, kind: 'return',
      run: (s) => {
        const r = returnLegacy(s.account, s.roar, u, track, 0, BRANCHED);
        return r.ok ? { account: r.account, roar: r.roar } : null;
      },
    });
  }
  ops.push({
    name: 'migrate both stores (a reload)', unit: '', track: '', kind: 'migrate',
    run: (s) => ({
      account: migrateAccount(JSON.parse(JSON.stringify(s.account)), undefined, BRANCHED),
      roar: migrateRoar(JSON.parse(JSON.stringify(s.roar)), BRANCHED),
    }),
  });
  return ops;
}

/** The two stores' picks on (u, t), each only where that store holds the branched tier. */
function storePicks(s: State, u: string, t: string): { account?: BranchPick; coins?: BranchPick } {
  const out: { account?: BranchPick; coins?: BranchPick } = {};
  if (tierIn(s, u, t) >= 3) out.account = s.account.picks?.[u]?.[t];
  const e = s.roar.entitlements.upgrades[u]?.[t];
  if (e !== undefined && e.tier >= 3) out.coins = e.branch;
  return out;
}
const distinct = (p: { account?: BranchPick; coins?: BranchPick }): number => new Set([p.account, p.coins].filter((x) => x !== undefined)).size;

/** A dedup key. The receipts change what no operation does except the one a Return reads (the newest tier-3
 *  purchase receipt of each (unit, track)), so only that one is in the key. */
function keyOf(s: State): string {
  const newest: Record<string, unknown> = {};
  for (const r of s.roar.receipts) if (r.kind === 'tier' && r.tier === 3 && r.refund !== true) newest[`${r.unitId}.${r.track}`] = r.coins;
  return JSON.stringify([s.account, s.roar.coins, s.roar.entitlements, newest]);
}

// ---- the literal legacy roots (§5.2) -----------------------------------------------------------------

/** A tier receipt an old build left for the wallet's coin tiers 1..3 (`coins` literal). */
const receipt = (u: string, t: string, tier: number, free: number, credits: number) => ({ kind: 'tier', id: `0-${u}-${t}-${tier}`, at: 0, coins: { free, paid: 0 }, unitId: u, track: t, tier, credits });
const coinRun = (u: string, t: string, prices: readonly number[]) => prices.map((p, i) => receipt(u, t, i + 1, i === 2 ? 80 : coinPrice(p), p));

/** The raw stores as an old build wrote them (no `picks`, no `legacy`, no `branch`), for `u` firepower. */
function rootsFor(u: 'fx_tank' | 'fx_ifv'): Record<string, { account: unknown; roar: unknown }> {
  const prices = PRICES[u].firepower;
  const spent = prices[0] + prices[1] + prices[2];
  const oldAccount = (over: Record<string, unknown> = {}) => ({ ...funded({}, spent), version: 2, upgrades: { [u]: { firepower: 3 } }, picks: undefined, legacy: undefined, ...over });
  const oldWallet = (entitlement: Record<string, unknown> = { tier: 3, paidTiers: 0 }) => ({
    ...fundedRoar(),
    version: 1,
    entitlements: { units: {}, upgrades: { [u]: { firepower: entitlement } } },
    receipts: coinRun(u, 'firepower', prices),
  });
  return {
    L1: { account: oldAccount(), roar: fundedRoar() },
    L2: { account: funded(), roar: oldWallet() },
    L3: { account: oldAccount(), roar: oldWallet() },
    // A guest strip of the wallet alone: the account kept its fresh branch-2 pick, the wallet lost its `branch`.
    L4: { account: oldAccount({ version: 3, picks: { [u]: { firepower: 2 } }, legacy: {} }), roar: oldWallet() },
    // The hand-edit: account pick 1, wallet branch 2, neither legacy.
    L5: { account: oldAccount({ version: 3, picks: { [u]: { firepower: 1 } }, legacy: {} }), roar: oldWallet({ tier: 3, paidTiers: 0, branch: 2 }) },
    // The mirror of L4: the wallet a fresh branch-2 coin buy, the account an old linear tier 3.
    L7: { account: oldAccount(), roar: oldWallet({ tier: 3, paidTiers: 0, branch: 2 }) },
  };
}
/** L6: `fx_tank` at firepower 3 AND armour 3 in the account, no `picks`, no `legacy`. */
const L6 = (): { account: unknown; roar: unknown } => ({
  account: { ...funded({}, 455 + 680 + 950 + 300 + 450 + 640), version: 2, upgrades: { fx_tank: { firepower: 3, armour: 3 } } },
  roar: fundedRoar(),
});

const migrated = (raw: { account: unknown; roar: unknown }): State => ({
  account: migrateAccount(raw.account, undefined, BRANCHED),
  roar: migrateRoar(raw.roar, BRANCHED),
});

// ---- case 1: the search --------------------------------------------------------------------------------

describe('case 1: exhaustive reachability, from the empty pair and from the legacy roots L1 to L7', () => {
  it('never reaches the envelope, never splits the picks (s1), never moves a pick but by its own Switch (s2)', () => {
    const roots: State[] = [
      { account: funded(), roar: fundedRoar() },
      ...(['fx_tank', 'fx_ifv'] as const).flatMap((u) => Object.values(rootsFor(u)).map(migrated)),
      migrated(L6()),
    ];
    const ops = opsFor();
    const seen = new Set<string>();
    let frontier = roots.filter((s) => {
      const k = keyOf(s);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const reached = new Set<string>();
    const fired = { switch: 0, return: 0 };
    let mixedFirepower = false;
    const failures: string[] = [];
    const check = (s: State): void => {
      for (const [unit, track] of TRACKS) {
        const r = viewReading(s, unit, track);
        reached.add(`${unit.id}.${track}.${r}`);
        if (r === 'BOTH') failures.push(`${unit.id}.${track} reads BOTH`);
      }
      reached.add(`pair ${viewReading(s, FX_TANK, 'firepower')} ${viewReading(s, FX_TANK, 'armour')}`);
      const v = singlePlayerView(s.account, s.roar);
      const a = v.ownedPicks.fx_tank?.firepower;
      const b = v.ownedPicks.fx_ifv?.firepower;
      if (a !== undefined && b !== undefined && a !== b) mixedFirepower = true;
    };
    frontier.forEach(check);
    const t0 = Date.now();
    // Stops at the first depth that found a failure: a broken rule can open far more states than a sound one, and the
    // search must go red on its assertion, never run the worker out of memory first.
    for (let depth = 0; depth < 8 && frontier.length > 0 && failures.length === 0; depth++) {
      console.log(`depth ${depth}: ${frontier.length} states, ${seen.size} seen, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      const next: State[] = [];
      for (const s of frontier) {
        for (const op of ops) {
          const t = op.run(s);
          if (t === null) continue;
          if (op.kind === 'switch') fired.switch++;
          if (op.kind === 'return') fired.return++;
          for (const [unit, track] of TRACKS) {
            const before = storePicks(s, unit.id, track);
            const after = storePicks(t, unit.id, track);
            if (distinct(before) <= 1 && distinct(after) === 2) failures.push(`(s1) ${op.name} split ${unit.id}.${track}`);
            for (const store of ['account', 'coins'] as const) {
              const p = before[store];
              const q = after[store];
              if (p === undefined || p === q) continue;
              const ownSwitch = op.kind === 'switch' && op.unit === unit.id && op.track === track;
              const leftWithTier = q === undefined && (op.kind === 'return' && op.unit === unit.id && op.track === track);
              if (!ownSwitch && !leftWithTier) failures.push(`(s2) ${op.name} moved ${store} ${unit.id}.${track} ${p} -> ${q ?? 'none'}`);
            }
          }
          const k = keyOf(t);
          if (seen.has(k)) continue;
          seen.add(k);
          check(t);
          next.push(t);
        }
      }
      frontier = next;
    }
    console.log(`branch-exclusive search: ${seen.size} states, ${fired.switch} switches and ${fired.return} returns fired`);
    expect(failures.slice(0, 10)).toEqual([]);
    // It reached something: ONE and TWO for every (unit, track), all four fx_tank pairs, a Switch, a Return, and the two
    // fixture units' firepower on different picks at once.
    for (const [unit, track] of TRACKS) for (const r of ['ONE', 'TWO'] as const) expect(reached.has(`${unit.id}.${track}.${r}`), `${unit.id}.${track} ${r}`).toBe(true);
    for (const pair of ['ONE ONE', 'ONE TWO', 'TWO ONE', 'TWO TWO']) expect(reached.has(`pair ${pair}`), pair).toBe(true);
    expect(fired.switch).toBeGreaterThan(0);
    expect(fired.return).toBeGreaterThan(0);
    expect(mixedFirepower).toBe(true);
  }, 300_000);
});

// ---- case 2: the single guards, one each, with everything else permitting -----------------------------

describe('case 2: a branch buy refuses the other branch, in either store', () => {
  const credits = (s: State, pick: BranchPick) => buyBranch(s.account, s.roar, 'fx_tank', 'firepower', tierIn(s, 'fx_tank', 'firepower') + 1, pick, PRICES.fx_tank.firepower, BRANCHED);
  // `current` is passed as 2, the tier below the branched one, so the tier rule permits the buy and only the
  // cross-store guard can refuse it (the single-player view would refuse a coin buy of a tier the account holds).
  const coins = (s: State, pick: BranchPick) => buyBranchWithCoins(s.roar, s.account, 'fx_tank', 'firepower', 3, 2, pick, 95, 950, 0, BRANCHED);
  const at2 = (): State => ({
    account: funded({ upgrades: { fx_tank: { firepower: 2 } } }, 1135),
    roar: fundedRoar({ entitlements: { units: {}, upgrades: { fx_tank: { firepower: { tier: 2, paidTiers: 0 } } } } }),
  });

  it('credits own branch a: a credit buy of b is refused (no tier left to buy), returning the same account', () => {
    const s0 = at2();
    const own = credits(s0, 1);
    expect(own.ok).toBe(true);
    const again = buyBranch(own.account, s0.roar, 'fx_tank', 'firepower', 3, 2, PRICES.fx_tank.firepower, BRANCHED);
    expect(again.ok).toBe(false);
    expect(again.account).toBe(own.account);
    expect(own.account.balance).toBeGreaterThanOrEqual(950); // the balance would cover it
  });
  it('credits own branch a: a coin buy of b with the coins on hand is refused; of a it is allowed', () => {
    const s = { ...at2(), account: credits(at2(), 1).account };
    const b = coins(s, 2);
    expect(b.ok).toBe(false);
    expect(b.account).toBe(s.roar);
    expect(coins(s, 1).ok).toBe(true); // the same branch in the other store is legal (a GH-1143 double payment)
  });
  it('coins own branch a: a coin buy of b is refused (nothing left to buy), and a credit buy of b is refused', () => {
    const s0 = at2();
    const own = coins(s0, 1);
    expect(own.ok).toBe(true);
    const s = { ...s0, roar: own.account };
    const b = credits(s, 2);
    expect(b.ok).toBe(false);
    expect(b.account).toBe(s.account);
    expect(credits(s, 1).ok).toBe(true);

  });
  it('a run or a coin tier with no branch named is refused at a branched tier', () => {
    const s = at2();
    expect(buyUpgradeRun(s.account, 'fx_tank', 'firepower', 3, 3, PRICES.fx_tank.firepower, BRANCHED).ok).toBe(false);
    expect(buyTierWithCoins(s.roar, 'fx_tank', 'firepower', 3, 2, 95, 950, 0, BRANCHED).ok).toBe(false);
    expect(buyWithCoins(storeInput(s), s.roar, { kind: 'tier', unitId: 'fx_tank', track: 'firepower', tier: 3 }, 0, BRANCHED).ok).toBe(false);
    // and a branch named on a plain tier is refused too
    expect(buyWithCoins(storeInput({ account: funded(), roar: fundedRoar() }), fundedRoar(), { kind: 'tier', unitId: 'fx_tank', track: 'firepower', tier: 1, branch: 1 }, 0, BRANCHED).ok).toBe(false);
  });
});

// ---- cases 3 to 6 ---------------------------------------------------------------------------------------

describe('case 3: the hand-edited conflict (L5) resolves to ONE, from the earned pick', () => {
  it('reads ONE', () => {
    expect(viewReading(migrated(rootsFor('fx_tank').L5), FX_TANK, 'firepower')).toBe('ONE');
  });
});

describe('case 4: the legacy migration, one store', () => {
  it('L1 migrates to pick 1 and a marker that holds no number, and reads ONE, never BOTH', () => {
    const s = migrated(rootsFor('fx_tank').L1);
    expect(s.account.picks).toEqual({ fx_tank: { firepower: 1 } });
    expect(s.account.legacy).toEqual({ fx_tank: { firepower: true } });
    expect(viewReading(s, FX_TANK, 'firepower')).toBe('ONE');
  });
  it('Switch once reads TWO and clears the marker; a second Switch and a Return are refused (one of the two, once)', () => {
    const s = migrated(rootsFor('fx_tank').L1);
    const sw = switchLegacy(s.account, s.roar, 'fx_tank', 'firepower', BRANCHED);
    expect(sw.ok).toBe(true);
    const t = { account: sw.account, roar: sw.roar };
    expect(viewReading(t, FX_TANK, 'firepower')).toBe('TWO');
    expect(t.account.legacy).toEqual({});
    const again = switchLegacy(t.account, t.roar, 'fx_tank', 'firepower', BRANCHED);
    expect(again.ok).toBe(false);
    expect(again.account).toBe(t.account);
    const ret = returnLegacy(t.account, t.roar, 'fx_tank', 'firepower', 0, BRANCHED);
    expect(ret.ok).toBe(false);
    expect(ret.account).toBe(t.account);
  });
  it('Return reads T2 and refunds exactly 950 credits, once; the bound keeps it through a reload', () => {
    const s = migrated(rootsFor('fx_tank').L1);
    const ret = returnLegacy(s.account, s.roar, 'fx_tank', 'firepower', 0, BRANCHED);
    expect(ret.ok).toBe(true);
    expect(ret.account.balance - s.account.balance).toBe(950);
    expect(ret.account.upgrades.fx_tank.firepower).toBe(2);
    expect(viewReading({ account: ret.account, roar: ret.roar }, FX_TANK, 'firepower')).toBe('T2');
    expect(ret.account.earned_total).toBe(s.account.earned_total); // a spend reversed, not an earning (G3)
    expect(ret.account.grants).toBe(s.account.grants);
    const again = returnLegacy(ret.account, ret.roar, 'fx_tank', 'firepower', 0, BRANCHED);
    expect(again.ok).toBe(false);
    expect(again.account.balance).toBe(ret.account.balance);
    expect(migrateAccount(JSON.parse(JSON.stringify(ret.account)), undefined, BRANCHED).balance).toBe(FUND + 950);
  });
  it('L2: Return refunds the receipt\'s literal CoinSplit; with the receipt pruned, coinPrice(950) = 95 free coins', () => {
    const s = migrated(rootsFor('fx_tank').L2);
    expect(s.roar.entitlements.upgrades.fx_tank.firepower).toEqual({ tier: 3, paidTiers: 0, branch: 1, legacy: true });
    const ret = returnLegacy(s.account, s.roar, 'fx_tank', 'firepower', 0, BRANCHED);
    expect(ret.ok).toBe(true);
    expect(ret.roar.coins).toEqual({ free: FUND + 80, paid: 0 });
    expect(ret.roar.entitlements.upgrades.fx_tank.firepower).toEqual({ tier: 2, paidTiers: 0 });
    expect(ret.account).toBe(s.account);
    const refund = ret.roar.receipts[ret.roar.receipts.length - 1];
    expect(refund).toMatchObject({ kind: 'tier', unitId: 'fx_tank', track: 'firepower', tier: 3, refund: true, coins: { free: 80, paid: 0 } });
    const pruned = { ...s.roar, receipts: s.roar.receipts.filter((r) => !(r.kind === 'tier' && r.tier === 3)) };
    expect(returnLegacy(s.account, pruned, 'fx_tank', 'firepower', 0, BRANCHED).roar.coins).toEqual({ free: FUND + 95, paid: 0 });
  });
  it('two branched tracks (L6): a marker on each, and a Switch or a Return on one never touches the other', () => {
    const s = migrated(L6());
    expect(s.account.picks).toEqual({ fx_tank: { firepower: 1, armour: 1 } });
    expect(s.account.legacy).toEqual({ fx_tank: { firepower: true, armour: true } });
    const sw = switchLegacy(s.account, s.roar, 'fx_tank', 'firepower', BRANCHED);
    const t = { account: sw.account, roar: sw.roar };
    expect(viewReading(t, FX_TANK, 'firepower')).toBe('TWO');
    expect(viewReading(t, FX_TANK, 'armour')).toBe('ONE');
    expect(t.account.legacy).toEqual({ fx_tank: { armour: true } });
    const ret = returnLegacy(t.account, t.roar, 'fx_tank', 'armour', 0, BRANCHED);
    expect(viewReading({ account: ret.account, roar: ret.roar }, FX_TANK, 'armour')).toBe('T2');
    expect(ret.account.balance - t.account.balance).toBe(640);
    expect(viewReading({ account: ret.account, roar: ret.roar }, FX_TANK, 'firepower')).toBe('TWO');
  });
});

describe('case 5: the legacy migration, both stores', () => {
  it('L3: Switch moves BOTH stores to b in one write and clears both markers', () => {
    const s = migrated(rootsFor('fx_tank').L3);
    expect(legacyOffer(s.account, s.roar, 'fx_tank', 'firepower', BRANCHED)).toMatchObject({ canSwitch: true, canReturn: true });
    const sw = switchLegacy(s.account, s.roar, 'fx_tank', 'firepower', BRANCHED);
    expect(sw.account.picks?.fx_tank.firepower).toBe(2);
    expect(sw.roar.entitlements.upgrades.fx_tank.firepower).toEqual({ tier: 3, paidTiers: 0, branch: 2 });
    expect(sw.account.legacy).toEqual({});
  });
  it('L3: Return drops both to tier 2 and refunds each store in its own currency, all at once', () => {
    const s = migrated(rootsFor('fx_tank').L3);
    const ret = returnLegacy(s.account, s.roar, 'fx_tank', 'firepower', 0, BRANCHED);
    expect(ret.account.balance - s.account.balance).toBe(950);
    expect(ret.roar.coins.free - s.roar.coins.free).toBe(80);
    expect(ret.account.upgrades.fx_tank.firepower).toBe(2);
    expect(ret.roar.entitlements.upgrades.fx_tank.firepower.tier).toBe(2);
  });
  it('L4 (account fresh b, wallet legacy): Switch is withheld; Return refunds the wallet ONLY (R12), and the view reads TWO', () => {
    const s = migrated(rootsFor('fx_tank').L4);
    expect(s.account.picks?.fx_tank.firepower).toBe(2);
    expect(s.account.legacy).toEqual({});
    expect(s.roar.entitlements.upgrades.fx_tank.firepower).toEqual({ tier: 3, paidTiers: 0, branch: 1, legacy: true });
    expect(switchLegacy(s.account, s.roar, 'fx_tank', 'firepower', BRANCHED).ok).toBe(false);
    const ret = returnLegacy(s.account, s.roar, 'fx_tank', 'firepower', 0, BRANCHED);
    expect(ret.ok).toBe(true);
    expect(ret.roar.coins.free - s.roar.coins.free).toBe(80);
    expect(ret.roar.entitlements.upgrades.fx_tank.firepower.tier).toBe(2);
    expect(ret.account).toBe(s.account); // tier 3, pick b and the balance, to the digit
    expect(ret.account.balance).toBe(FUND);
    expect(viewReading({ account: ret.account, roar: ret.roar }, FX_TANK, 'firepower')).toBe('TWO');
  });
  it('L7 (wallet fresh b, account legacy): Return refunds the account its literal 950 ONLY, and the wallet keeps b', () => {
    const s = migrated(rootsFor('fx_tank').L7);
    expect(s.account.legacy).toEqual({ fx_tank: { firepower: true } });
    expect(switchLegacy(s.account, s.roar, 'fx_tank', 'firepower', BRANCHED).ok).toBe(false);
    const ret = returnLegacy(s.account, s.roar, 'fx_tank', 'firepower', 0, BRANCHED);
    expect(ret.account.balance - s.account.balance).toBe(950);
    expect(ret.account.upgrades.fx_tank.firepower).toBe(2);
    expect(ret.roar).toBe(s.roar);
    expect(ret.roar.entitlements.upgrades.fx_tank.firepower).toEqual({ tier: 3, paidTiers: 0, branch: 2 });
  });
  it('L2, then a credit buy of the same branch: the wallet\'s Return is still offered, and refunds the same literal split (Q11)', () => {
    const s = migrated(rootsFor('fx_tank').L2);
    const a2 = { ...s.account, balance: FUND, upgrades: { fx_tank: { firepower: 2 } } };
    const bought = buyBranch(a2, s.roar, 'fx_tank', 'firepower', 3, 1, PRICES.fx_tank.firepower, BRANCHED);
    expect(bought.ok).toBe(true);
    expect(legacyOffer(bought.account, s.roar, 'fx_tank', 'firepower', BRANCHED)).toMatchObject({ canSwitch: false, canReturn: true });
    const ret = returnLegacy(bought.account, s.roar, 'fx_tank', 'firepower', 0, BRANCHED);
    expect(ret.roar.coins.free - s.roar.coins.free).toBe(80);
    expect(ret.account).toBe(bought.account);
  });
});

describe('case 6: no pick, no stats, per track', () => {
  it('a branched tier with no pick reads T2; a missing pick on one track takes nothing from the other', () => {
    expect(readingOf(FX_TANK, 'firepower', applyUpgrades(FX_TANK, { firepower: 3 }, {}, true))).toBe('T2');
    const both = applyUpgrades(FX_TANK, { firepower: 3, armour: 3 }, { firepower: 2 }, true);
    expect(readingOf(FX_TANK, 'firepower', both)).toBe('TWO');
    expect(readingOf(FX_TANK, 'armour', both)).toBe('T2');
    const mixed = applyUpgrades(FX_TANK, { firepower: 3, armour: 3 }, { firepower: 1, armour: 2 }, true);
    expect([readingOf(FX_TANK, 'firepower', mixed), readingOf(FX_TANK, 'armour', mixed)]).toEqual(['ONE', 'TWO']);
  });
});

// ---- case 7: the shipped sweep (§2.1, literals) -----------------------------------------------------------

/** Per shipped branched (unit, track): base + branch-1 values, base + branch-2 values, and the pre-branch tier 3
 *  (base + "T3 today"), all copied BY HAND from the design's §2.1 table, path by path. */
const SHIPPED: Record<string, { track: string; one: Record<string, number>; two: Record<string, number>; t3: Record<string, number> }> = {
  mbt_lavi: { track: 'firepower', one: { 'weapons[0].accuracy': 0.95, 'weapons[0].penetration': 1508 }, two: { 'weapons[0].accuracy': 0.91, 'weapons[0].penetration': 1625 }, t3: { 'weapons[0].accuracy': 0.95, 'weapons[0].penetration': 1625 } },
  ifv_namer: { track: 'firepower', one: { 'weapons[0].accuracy': 0.8, 'weapons[0].penetration': 139 }, two: { 'weapons[0].accuracy': 0.76, 'weapons[0].penetration': 150 }, t3: { 'weapons[0].accuracy': 0.8, 'weapons[0].penetration': 150 } },
  apc_eitan: { track: 'firepower', one: { 'weapons[0].accuracy': 0.7, 'weapons[0].penetration': 29 }, two: { 'weapons[0].accuracy': 0.66, 'weapons[0].penetration': 31 }, t3: { 'weapons[0].accuracy': 0.7, 'weapons[0].penetration': 31 } },
  sniper_team: { track: 'firepower', one: { 'weapons[0].accuracy': 0.98, 'weapons[0].penetration': 52 }, two: { 'weapons[0].accuracy': 0.94, 'weapons[0].penetration': 56 }, t3: { 'weapons[0].accuracy': 0.98, 'weapons[0].penetration': 56 } },
  heli_peten: { track: 'firepower', one: { 'weapons[0].accuracy': 0.7, 'weapons[0].penetration': 139 }, two: { 'weapons[0].accuracy': 0.66, 'weapons[0].penetration': 150 }, t3: { 'weapons[0].accuracy': 0.7, 'weapons[0].penetration': 150 } },
  inf_squad: { track: 'firepower', one: { 'weapons[0].accuracy': 0.7, 'weapons[0].penetration': 9 }, two: { 'weapons[0].accuracy': 0.66, 'weapons[0].penetration': 10 }, t3: { 'weapons[0].accuracy': 0.7, 'weapons[0].penetration': 10 } },
  jeep_shoded: { track: 'armour', one: { 'hull.hp': 650, 'hull.armor.front': 16, 'hull.armor.side': 12, 'hull.armor.rear': 12 }, two: { 'hull.hp': 598, 'hull.armor.front': 18, 'hull.armor.side': 12, 'hull.armor.rear': 12 }, t3: { 'hull.hp': 650, 'hull.armor.front': 18, 'hull.armor.side': 12, 'hull.armor.rear': 12 } },
  dozer_d9: { track: 'armour', one: { 'hull.hp': 3000, 'hull.armor.front': 276, 'hull.armor.side': 196, 'hull.armor.rear': 126 }, two: { 'hull.hp': 2760, 'hull.armor.front': 300, 'hull.armor.side': 212, 'hull.armor.rear': 138 }, t3: { 'hull.hp': 3000, 'hull.armor.front': 300, 'hull.armor.side': 212, 'hull.armor.rear': 138 } },
  apc_kipod: { track: 'armour', one: { 'hull.hp': 2188, 'hull.armor.front': 299, 'hull.armor.side': 184, 'hull.armor.rear': 115 }, two: { 'hull.hp': 2012, 'hull.armor.front': 325, 'hull.armor.side': 200, 'hull.armor.rear': 125 }, t3: { 'hull.hp': 2188, 'hull.armor.front': 325, 'hull.armor.side': 200, 'hull.armor.rear': 125 } },
  at_team: { track: 'sensors', one: { 'sensors.optics': 1.38, 'sensors.sight_tiles': 11 }, two: { 'sensors.optics': 1.27, 'sensors.sight_tiles': 12 }, t3: { 'sensors.optics': 1.38, 'sensors.sight_tiles': 12 } },
  scout_shachaf: { track: 'sensors', one: { 'sensors.optics': 2.37, 'sensors.sight_tiles': 18 }, two: { 'sensors.optics': 2.18, 'sensors.sight_tiles': 19 }, t3: { 'sensors.optics': 2.37, 'sensors.sight_tiles': 19 } },
  mortar_team: { track: 'sensors', one: { 'sensors.optics': 1.13, 'sensors.sight_tiles': 9 }, two: { 'sensors.optics': 1.04, 'sensors.sight_tiles': 10 }, t3: { 'sensors.optics': 1.13, 'sensors.sight_tiles': 10 } },
  recon_drone: { track: 'sensors', one: { 'sensors.optics': 2.5, 'sensors.sight_tiles': 18 }, two: { 'sensors.optics': 2.3, 'sensors.sight_tiles': 19 }, t3: { 'sensors.optics': 2.5, 'sensors.sight_tiles': 19 } },
};

function read(u: unknown, path: string): number {
  let cur: unknown = u;
  for (const part of path.split('.')) {
    const m = /^(\w+)\[(\d+)\]$/.exec(part);
    cur = m ? ((cur as Record<string, unknown[]>)[m[1]] ?? [])[Number(m[2])] : (cur as Record<string, unknown>)[part];
  }
  return cur as number;
}

describe('case 7: the shipped sweep, against the design\'s §2.1 literals', () => {
  it('names exactly the thirteen units, one branched track each', () => {
    const shipped = branchedTable(Object.values(units) as unknown as UpgradableUnit[]);
    expect(Object.keys(shipped).sort()).toEqual(Object.keys(SHIPPED).sort());
    for (const [id, row] of Object.entries(SHIPPED)) expect(Object.keys(shipped[id]), id).toEqual([row.track]);
  });
  for (const [id, row] of Object.entries(SHIPPED)) {
    it(`${id} ${row.track}: each pick reads its branch, and the envelope is the pre-branch tier 3 (B6)`, () => {
      const u = (units as unknown as Record<string, UpgradableUnit>)[id];
      const one = applyUpgrades(u, { [row.track]: 3 }, { [row.track]: 1 }, true);
      const two = applyUpgrades(u, { [row.track]: 3 }, { [row.track]: 2 }, true);
      for (const path of Object.keys(row.t3)) {
        expect(read(one, path), `${id} ${path} branch 1`).toBeCloseTo(row.one[path], 9);
        expect(read(two, path), `${id} ${path} branch 2`).toBeCloseTo(row.two[path], 9);
        expect(Math.max(read(one, path), read(two, path)), `${id} ${path} envelope`).toBeCloseTo(row.t3[path], 9);
      }
    });
  }
});
