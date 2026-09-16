# Brigade Economy — Step 1 "Earn" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A victory pays credits into a brigade account that outlives the campaign, replays pay only for improvement, the debrief says what was paid, the brigade screen shows the balance and can reset the account, and the playtest harness pins the optimal ladder's credit total.

**Architecture:** One pure integer function in the sim package (`creditsFor`, beside the grade) computes a run's value from what the grade already reads. One pure app module (`brigade-account.ts`) owns a second local-storage key, its migrations, the improvement rule and the reset; `main.ts` calls both on the victory path and hands the result to the debrief. Nothing in the sim is called by the sim; the golden determinism hash cannot move.

**Tech Stack:** TypeScript strict, vitest (jsdom for UI files), pnpm workspace; `@lions/sim` integer-only rules (no `Math.*`, no `Date.*` — `Date.now()` is taken in the app and passed in).

**Spec:** `docs/superpowers/specs/2026-09-15-brigade-economy-design.md` — §4.1 the account, §4.2 credits and the payout, §4.5 the surfaces (header and reset only in this step), §6 testing, §8 step 1.

## Global Constraints

- `packages/sim` is integer-only: no `Math.*`, no `Date.*`, no division, no RNG in `credits.ts`; the file is never imported by `sim.ts` or `mission.ts`.
- Dependency direction `app → render → sim`; `data` is a leaf. `brigade-account.ts` lives in `packages/app`.
- The account key is `lions.brigade.account`; the ledger key `lions.campaign.ledger` is untouched; `?fresh` removes only the ledger and tutorial keys.
- A defeat pays nothing and writes nothing (motivation spec D4).
- Every client-written grant has `source: 'earned'`; no exported function constructs a `granted` entry.
- Provisional weights: win 100, carrying secondary 40, unit home 10, Conduct point over the ★★ floor 1. Named constants, one place.
- Colour: the `--commend` token for credits; no colour literal in UI source (`pnpm validate:ui`).
- Git in a worktree: `/usr/bin/git` by absolute path, one plain command per call; explicit paths; never stash; never `-A`. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Before Task 1, merge `origin/main` into the branch (`/usr/bin/git merge origin/main`) — the branch predates v0.64.0 — and run `pnpm test` once to prove a green base.

---

### Task 1: `creditsFor` — the payout function

**Files:**
- Create: `packages/sim/src/credits.ts`
- Create: `packages/sim/src/credits.test.ts`
- Modify: `packages/sim/src/index.ts:38` (the `./grade` export line — add a `./credits` export beside it)

**Interfaces:**
- Produces:
  ```ts
  export const CREDIT_WEIGHTS = { win: 100, carryingSecondary: 40, unitHome: 10, conductPoint: 1 } as const;
  export interface CreditInput {
    result: 'ongoing' | 'victory' | 'defeat';
    /** Secondaries flagged `carries: true` whose status is 'complete'. */
    carryingComplete: number;
    /** Player units that ever took the field (`MissionRuntime.fieldedCount`). */
    fielded: number;
    /** Player units that died (sum of `lostByType()`). */
    lost: number;
    roe: number;
    /** The mission's `roe.fail_below`, undefined when it declares none. */
    failBelow: number | undefined;
  }
  export function creditsFor(input: CreditInput): number;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/sim/src/credits.test.ts
import { describe, expect, it } from 'vitest';
import { CREDIT_WEIGHTS, creditsFor, type CreditInput } from './credits';

const base = (over: Partial<CreditInput> = {}): CreditInput => ({
  result: 'victory',
  carryingComplete: 0,
  fielded: 10,
  lost: 0,
  roe: 70,
  failBelow: undefined,
  ...over,
});

describe('creditsFor', () => {
  it('pays nothing for anything but a victory', () => {
    expect(creditsFor(base({ result: 'defeat' }))).toBe(0);
    expect(creditsFor(base({ result: 'ongoing' }))).toBe(0);
  });

  it('pays the win, then every unit brought home', () => {
    // 100 + 10 units home × 10; Conduct exactly at the default floor pays no extra.
    expect(creditsFor(base())).toBe(CREDIT_WEIGHTS.win + 10 * CREDIT_WEIGHTS.unitHome);
    expect(creditsFor(base({ lost: 4 }))).toBe(CREDIT_WEIGHTS.win + 6 * CREDIT_WEIGHTS.unitHome);
  });

  it('pays each carrying secondary completed', () => {
    expect(creditsFor(base({ carryingComplete: 2 })) - creditsFor(base())).toBe(2 * CREDIT_WEIGHTS.carryingSecondary);
  });

  it('pays Conduct only above the two-star floor, and never below zero', () => {
    // Floor is fail_below + 20 = 60; roe 75 is 15 over.
    expect(creditsFor(base({ roe: 75, failBelow: 40 })) - creditsFor(base({ roe: 60, failBelow: 40 }))).toBe(15);
    // Under the floor pays the same as at it: the term floors at zero, it never deducts.
    expect(creditsFor(base({ roe: 30, failBelow: 40 }))).toBe(creditsFor(base({ roe: 60, failBelow: 40 })));
    // No declared floor: the default ★★ floor of 70 applies.
    expect(creditsFor(base({ roe: 80 })) - creditsFor(base({ roe: 70 }))).toBe(10);
  });

  it('never pays a negative home count when lost exceeds fielded', () => {
    // Defensive: a corrupt input must not deduct.
    expect(creditsFor(base({ fielded: 2, lost: 5 }))).toBe(CREDIT_WEIGHTS.win);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/sim/src/credits.test.ts`
Expected: FAIL — `Cannot find module './credits'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/sim/src/credits.ts
/**
 * What a won mission pays into the brigade account (spec 2026-09-15 §4.2).
 *
 * Reads exactly what the grade and the debrief already read -- the win, the carrying
 * secondaries, the units brought home, Conduct over the two-star floor -- and adds them
 * with the weights below. Integer addition only, no division, no RNG, so it lives beside
 * `grade.ts` and is the one answer the app and the playtest harness share. Nothing in the
 * sim calls it: the sim never learns credits exist.
 *
 * The weights are provisional and belong to the balance analyst (spec §4.2's campaign
 * target). Change them here and nowhere else.
 */
import { starRoeFloor } from './grade';

export const CREDIT_WEIGHTS = {
  win: 100,
  carryingSecondary: 40,
  unitHome: 10,
  conductPoint: 1,
} as const;

export interface CreditInput {
  result: 'ongoing' | 'victory' | 'defeat';
  /** Secondaries flagged `carries: true` whose status is 'complete'. */
  carryingComplete: number;
  /** Player units that ever took the field (`MissionRuntime.fieldedCount`). */
  fielded: number;
  /** Player units that died (the sum of `lostByType()`). */
  lost: number;
  roe: number;
  /** The mission's `roe.fail_below`, undefined when it declares none. */
  failBelow: number | undefined;
}

export function creditsFor(input: CreditInput): number {
  if (input.result !== 'victory') return 0;
  const home = input.fielded - input.lost;
  const homePaid = home > 0 ? home * CREDIT_WEIGHTS.unitHome : 0;
  const over = input.roe - starRoeFloor(input.failBelow);
  const conductPaid = over > 0 ? over * CREDIT_WEIGHTS.conductPoint : 0;
  return (
    CREDIT_WEIGHTS.win +
    input.carryingComplete * CREDIT_WEIGHTS.carryingSecondary +
    homePaid +
    conductPaid
  );
}
```

Then in `packages/sim/src/index.ts`, next to the `./grade` export block (line ~38), add:

```ts
export { creditsFor, CREDIT_WEIGHTS, type CreditInput } from './credits';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/sim/src/credits.test.ts`
Expected: PASS, 5 tests.

Run: `pnpm lint` and `pnpm typecheck` (the sim lint rule bans `Math.*`/`Date.*` in this package; the file uses neither).
Expected: clean.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/sim/src/credits.ts packages/sim/src/credits.test.ts packages/sim/src/index.ts
/usr/bin/git commit -m "feat(sim): creditsFor -- what a won mission pays, beside the grade" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The brigade account module

**Files:**
- Create: `packages/app/src/brigade-account.ts`
- Create: `packages/app/src/brigade-account.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (the account stores numbers; it does not compute them).
- Produces:
  ```ts
  export const ACCOUNT_KEY = 'lions.brigade.account';
  export const ACCOUNT_VERSION = 1;
  export interface Grant { source: 'earned'; amount: number; missionId: string; at: number }
  export interface BrigadeAccount {
    version: 1;
    balance: number;
    earned_total: number;
    paid: Record<string, number>;
    unlocks: string[];
    upgrades: Record<string, Record<string, number>>;
    grants: Grant[];
  }
  export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
  export function emptyAccount(): BrigadeAccount;
  export function migrateAccount(raw: unknown): BrigadeAccount;   // any junk → a valid account
  export function loadAccount(store: StorageLike): BrigadeAccount;
  export function saveAccount(store: StorageLike, account: BrigadeAccount): void;
  export function payMission(account: BrigadeAccount, missionId: string, value: number, at: number): { account: BrigadeAccount; paid: number };
  export function resetAccount(store: StorageLike): BrigadeAccount;
  ```
  The `Grant.source` union is deliberately `'earned'` only in the type: the spec's `'granted'` shape is documented in the module comment and rejected by `migrateAccount` (kept as data, never constructed) — see the test "no client path writes a granted entry".

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/brigade-account.test.ts
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_KEY,
  emptyAccount,
  loadAccount,
  migrateAccount,
  payMission,
  resetAccount,
  saveAccount,
  type StorageLike,
} from './brigade-account';

/** Map-backed, the shape a browser hands over -- not a spy. */
const store = (): StorageLike & { box: Map<string, string> } => {
  const box = new Map<string, string>();
  return {
    box,
    getItem: (k) => box.get(k) ?? null,
    setItem: (k, v) => void box.set(k, v),
    removeItem: (k) => void box.delete(k),
  };
};

describe('brigade account', () => {
  it('starts empty and round-trips through storage under its own key', () => {
    const s = store();
    expect(loadAccount(s)).toEqual(emptyAccount());
    const paid = payMission(emptyAccount(), 'beit_sahwan_1_recon', 160, 1000);
    saveAccount(s, paid.account);
    expect(s.box.has(ACCOUNT_KEY)).toBe(true);
    expect(loadAccount(s)).toEqual(paid.account);
  });

  it('pays a first win in full and records it', () => {
    const { account, paid } = payMission(emptyAccount(), 'm1', 160, 1000);
    expect(paid).toBe(160);
    expect(account.balance).toBe(160);
    expect(account.earned_total).toBe(160);
    expect(account.paid.m1).toBe(160);
    expect(account.grants).toEqual([{ source: 'earned', amount: 160, missionId: 'm1', at: 1000 }]);
  });

  it('pays a replay only for improvement, and moves the record up', () => {
    const first = payMission(emptyAccount(), 'm1', 160, 1000).account;
    const worse = payMission(first, 'm1', 120, 2000);
    expect(worse.paid).toBe(0);
    expect(worse.account.balance).toBe(160);
    expect(worse.account.paid.m1).toBe(160);
    expect(worse.account.grants).toHaveLength(1);
    const better = payMission(worse.account, 'm1', 190, 3000);
    expect(better.paid).toBe(30);
    expect(better.account.balance).toBe(190);
    expect(better.account.earned_total).toBe(190);
    expect(better.account.paid.m1).toBe(190);
  });

  it('never mutates the account it is given', () => {
    const before = emptyAccount();
    const snapshot = JSON.stringify(before);
    payMission(before, 'm1', 160, 1000);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('migrates junk and partial saves to a valid account', () => {
    expect(migrateAccount(null)).toEqual(emptyAccount());
    expect(migrateAccount('not json shaped')).toEqual(emptyAccount());
    expect(migrateAccount({ version: 1, balance: 50 })).toEqual({ ...emptyAccount(), balance: 50 });
    // A negative or non-integer balance is corruption, not a debt.
    expect(migrateAccount({ version: 1, balance: -5 }).balance).toBe(0);
    expect(migrateAccount({ version: 1, balance: 2.5 }).balance).toBe(0);
  });

  it('drops a granted entry it did not write, and no client path writes one', () => {
    // The paid path's shape (spec §4.6) is data this module carries but never creates:
    // a save that contains one was edited by hand, and the balance it implies is not
    // honoured.
    const raw = { ...emptyAccount(), balance: 900, grants: [{ source: 'granted', amount: 900, at: 1 }] };
    const migrated = migrateAccount(raw);
    expect(migrated.grants).toEqual([]);
    expect(migrated.balance).toBe(0);
    const paid = payMission(emptyAccount(), 'm1', 10, 1).account;
    expect(paid.grants.every((g) => g.source === 'earned')).toBe(true);
  });

  it('loads a corrupt key as empty rather than throwing', () => {
    const s = store();
    s.setItem(ACCOUNT_KEY, '{not json');
    expect(loadAccount(s)).toEqual(emptyAccount());
  });

  it('resets to empty and removes the key', () => {
    const s = store();
    saveAccount(s, payMission(emptyAccount(), 'm1', 160, 1000).account);
    expect(resetAccount(s)).toEqual(emptyAccount());
    expect(s.box.has(ACCOUNT_KEY)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/app/src/brigade-account.test.ts`
Expected: FAIL — `Cannot find module './brigade-account'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/app/src/brigade-account.ts
/**
 * The brigade account (spec 2026-09-15 §4.1): what the player has earned and bought,
 * kept BESIDE the campaign ledger under its own key so a fresh campaign leaves it alone.
 * This module is the only reader and writer of that key.
 *
 * Every entry the client writes into `grants` has `source: 'earned'`. The paid path
 * (spec §4.6) would write `source: 'granted'` -- from a server or a store entitlement,
 * never from here. `migrateAccount` treats a granted entry in a local save as
 * hand-editing: it is dropped and the balance is rebuilt from the earned grants alone.
 * That rule is what makes "no client code can create a granted entry" true rather than
 * merely intended.
 *
 * `payMission` is the improvement rule: a mission pays the difference between this run's
 * value and what it has paid before, never less than zero, and the record moves up.
 */
export const ACCOUNT_KEY = 'lions.brigade.account';
export const ACCOUNT_VERSION = 1 as const;

export interface Grant {
  source: 'earned';
  amount: number;
  missionId: string;
  /** Wall-clock milliseconds, taken by the caller (the sim never reads a clock). */
  at: number;
}

export interface BrigadeAccount {
  version: typeof ACCOUNT_VERSION;
  /** Integer credits on hand. */
  balance: number;
  /** Every earned credit ever; never decremented. */
  earned_total: number;
  /** What each mission has paid so far -- the improvement rule's memory. */
  paid: Record<string, number>;
  /** Unit ids opened by purchase (step 2 "Buy"). Empty in step 1. */
  unlocks: string[];
  /** Per unit type, the tier reached on each track (step 3 "Upgrade"). Empty in step 1. */
  upgrades: Record<string, Record<string, number>>;
  grants: Grant[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function emptyAccount(): BrigadeAccount {
  return { version: ACCOUNT_VERSION, balance: 0, earned_total: 0, paid: {}, unlocks: [], upgrades: {}, grants: [] };
}

const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function migrateGrants(raw: unknown): Grant[] {
  if (!Array.isArray(raw)) return [];
  const out: Grant[] = [];
  for (const g of raw) {
    if (g === null || typeof g !== 'object') continue;
    const r = g as Record<string, unknown>;
    // Only what this module writes survives; a 'granted' entry is dropped (see above).
    if (r.source !== 'earned' || !isNonNegInt(r.amount) || typeof r.missionId !== 'string' || !isNonNegInt(r.at)) continue;
    out.push({ source: 'earned', amount: r.amount, missionId: r.missionId, at: r.at });
  }
  return out;
}

function migratePaid(raw: unknown): Record<string, number> {
  if (raw === null || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isNonNegInt(v)) out[k] = v;
  return out;
}

function migrateUpgrades(raw: unknown): Record<string, Record<string, number>> {
  if (raw === null || typeof raw !== 'object') return {};
  const out: Record<string, Record<string, number>> = {};
  for (const [unit, tracks] of Object.entries(raw as Record<string, unknown>)) {
    if (tracks === null || typeof tracks !== 'object') continue;
    const t: Record<string, number> = {};
    for (const [track, tier] of Object.entries(tracks as Record<string, unknown>)) if (isNonNegInt(tier)) t[track] = tier;
    out[unit] = t;
  }
  return out;
}

/** Any raw value -> a valid account. Unknown fields are dropped; a balance that the
 *  earned grants cannot account for is reduced to what they can. */
export function migrateAccount(raw: unknown): BrigadeAccount {
  if (raw === null || typeof raw !== 'object') return emptyAccount();
  const r = raw as Record<string, unknown>;
  const grants = migrateGrants(r.grants);
  let earnedFromGrants = 0;
  for (const g of grants) earnedFromGrants += g.amount;
  const hadGrantsField = Array.isArray(r.grants);
  // A save with no grants log at all is an older or partial write: trust its balance.
  // A save WITH a log is bounded by it: a balance no earned grant explains was edited.
  const balanceRaw = isNonNegInt(r.balance) ? r.balance : 0;
  const balance = hadGrantsField ? (balanceRaw > earnedFromGrants ? earnedFromGrants : balanceRaw) : balanceRaw;
  const earnedTotalRaw = isNonNegInt(r.earned_total) ? r.earned_total : 0;
  return {
    version: ACCOUNT_VERSION,
    balance,
    earned_total: hadGrantsField ? (earnedTotalRaw > earnedFromGrants ? earnedFromGrants : earnedTotalRaw) : earnedTotalRaw,
    paid: migratePaid(r.paid),
    unlocks: Array.isArray(r.unlocks) ? r.unlocks.filter((u): u is string => typeof u === 'string') : [],
    upgrades: migrateUpgrades(r.upgrades),
    grants,
  };
}

export function loadAccount(store: StorageLike): BrigadeAccount {
  try {
    const text = store.getItem(ACCOUNT_KEY);
    return text === null ? emptyAccount() : migrateAccount(JSON.parse(text));
  } catch {
    return emptyAccount();
  }
}

export function saveAccount(store: StorageLike, account: BrigadeAccount): void {
  store.setItem(ACCOUNT_KEY, JSON.stringify(account));
}

/** The improvement rule (spec §4.2 D2). Pure: returns a new account and what was paid. */
export function payMission(
  account: BrigadeAccount,
  missionId: string,
  value: number,
  at: number
): { account: BrigadeAccount; paid: number } {
  const before = account.paid[missionId] ?? 0;
  const paid = value > before ? value - before : 0;
  if (paid === 0) return { account, paid: 0 };
  return {
    account: {
      ...account,
      balance: account.balance + paid,
      earned_total: account.earned_total + paid,
      paid: { ...account.paid, [missionId]: value },
      grants: [...account.grants, { source: 'earned', amount: paid, missionId, at }],
    },
    paid,
  };
}

export function resetAccount(store: StorageLike): BrigadeAccount {
  store.removeItem(ACCOUNT_KEY);
  return emptyAccount();
}
```

Note for the "never mutates" test: `payMission` returns the same object when nothing is paid; the test snapshots the input before a PAYING call, so it proves the paying branch copies. Keep it that way.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/app/src/brigade-account.test.ts`
Expected: PASS, 8 tests. Then `pnpm lint` and `pnpm typecheck`: clean.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/app/src/brigade-account.ts packages/app/src/brigade-account.test.ts
/usr/bin/git commit -m "feat(app): the brigade account -- its key, migrations and the improvement rule" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The debrief's payout line

**Files:**
- Modify: `packages/app/src/ui/debrief.ts:7-29` (`DebriefOptions`) and the grid rows around line 70
- Modify: `packages/app/src/ui/debrief.test.ts`
- Modify: `packages/app/src/ui/theme.css` (one rule beside `.rl-debrief__conduct`)

**Interfaces:**
- Produces on `DebriefOptions`:
  ```ts
  /** What this run paid into the brigade account (spec 2026-09-15 §4.2). Absent on a
   *  defeat, which pays nothing and shows nothing. */
  credits?: { paid: number; balance: number };
  ```

- [ ] **Step 1: Write the failing tests**

Append to `packages/app/src/ui/debrief.test.ts` inside `describe('showDebrief', ...)`:

```ts
  it('prints what the run paid into the brigade account', () => {
    const host = document.createElement('div');
    showDebrief(host, base({ credits: { paid: 120, balance: 460 } }));
    expect(text(host, '.rl-debrief__credits')).toBe('+120 credits · 460 on hand');
  });

  it('says so when a replay did not improve on the best', () => {
    const host = document.createElement('div');
    showDebrief(host, base({ credits: { paid: 0, balance: 460 } }));
    expect(text(host, '.rl-debrief__credits')).toBe('no improvement over your best, nothing paid · 460 on hand');
  });

  it('shows no credits row at all on a defeat', () => {
    const host = document.createElement('div');
    showDebrief(host, base({ result: 'defeat', stars: 0 }));
    expect(host.querySelector('.rl-debrief__credits')).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/app/src/ui/debrief.test.ts`
Expected: FAIL — the first two: expected text, received `''` (typecheck also flags `credits` as an unknown option until Step 3).

- [ ] **Step 3: Implement**

In `packages/app/src/ui/debrief.ts`, add to `DebriefOptions` after `promoted: number;`:

```ts
  /** What this run paid into the brigade account (spec 2026-09-15 §4.2). Absent on a
   *  defeat, which pays nothing and shows nothing. */
  credits?: { paid: number; balance: number };
```

In `showDebrief`, after the `row('Promoted', ...)` line and before `b.appendChild(grid)`:

```ts
  if (o.credits) {
    const paidText = o.credits.paid > 0 ? `+${o.credits.paid} credits` : 'no improvement over your best, nothing paid';
    row('Credits', `${paidText} · ${o.credits.balance} on hand`, 'rl-debrief__credits');
  }
```

In `packages/app/src/ui/theme.css`, next to the existing `.rl-debrief__conduct` rule, add:

```css
.rl-debrief__credits {
  color: var(--commend);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/app/src/ui/debrief.test.ts` — PASS. `pnpm validate:ui` — clean (a token, not a literal).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/app/src/ui/debrief.ts packages/app/src/ui/debrief.test.ts packages/app/src/ui/theme.css
/usr/bin/git commit -m "feat(ui): the debrief says what the run paid into the brigade account" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The brigade screen's balance and reset

**Files:**
- Modify: `packages/app/src/ui/brigade.ts:29-40` (`BrigadeOptions`) and the header block at lines 98-102
- Modify: `packages/app/src/ui/brigade.test.ts`
- Modify: `packages/app/src/ui/theme.css` (`.rl-brigade__credits`, `.rl-brigade__reset`)

**Interfaces:**
- Produces on `BrigadeOptions`:
  ```ts
  /** The brigade account's balance, for the header. Absent when the caller has no account
   *  (tests, or a boot where storage is blocked): the header then prints no credits line. */
  credits?: number;
  /** Called after the second click on the reset control. The caller resets the account and
   *  re-renders; this screen only asks twice. */
  onReset?: () => void;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `packages/app/src/ui/brigade.test.ts` inside `describe('showBrigade', ...)`; reuse the file's existing `units` fixture and its `host` pattern:

```ts
  it('prints the credit balance in the header and asks twice before resetting the account', () => {
    const host = document.createElement('div');
    let resets = 0;
    showBrigade(host, { units, ledger: {}, possibleStars: 78, credits: 460, onReset: () => resets++ });
    expect(host.querySelector('.rl-brigade__credits')?.textContent).toBe('460 credits');
    const btn = host.querySelector<HTMLButtonElement>('.rl-brigade__reset');
    expect(btn?.textContent).toBe('reset brigade account');
    btn?.click();
    expect(resets).toBe(0);
    expect(btn?.textContent).toBe('click again to reset — this cannot be undone');
    btn?.click();
    expect(resets).toBe(1);
  });

  it('prints no credits line and no reset control without an account', () => {
    const host = document.createElement('div');
    showBrigade(host, { units, ledger: {}, possibleStars: 78 });
    expect(host.querySelector('.rl-brigade__credits')).toBeNull();
    expect(host.querySelector('.rl-brigade__reset')).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/app/src/ui/brigade.test.ts`
Expected: the two new tests FAIL (`credits` unknown; no `.rl-brigade__credits` element).

- [ ] **Step 3: Implement**

In `packages/app/src/ui/brigade.ts`, add to `BrigadeOptions`:

```ts
  /** The brigade account's balance, for the header. Absent when the caller has no
   *  account (tests, or a boot where storage is blocked): no credits line is printed. */
  credits?: number;
  /** Called after the SECOND click on the reset control; the caller resets the account
   *  and re-renders. Two clicks because the account survives a fresh campaign on
   *  purpose (spec §4.1) and an accidental wipe undoes hours. */
  onReset?: () => void;
```

In `showBrigade`, after the Conduct line is appended to `head` (line ~101) and before `b.appendChild(head)`:

```ts
  if (opts.credits !== undefined) {
    head.appendChild(el('div', 'rl-brigade__credits', `${opts.credits} credits`));
  }
```

After the nav links at the bottom (before `host.appendChild(p.el)`), add the reset control only when both an account and a handler exist:

```ts
  if (opts.credits !== undefined && opts.onReset) {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'rl-btn rl-brigade__reset';
    reset.textContent = 'reset brigade account';
    let armed = false;
    reset.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        reset.textContent = 'click again to reset — this cannot be undone';
        return;
      }
      opts.onReset?.();
    });
    nav.appendChild(reset);
  }
```

In `theme.css`, beside `.rl-brigade__stars`:

```css
.rl-brigade__credits {
  color: var(--commend);
}
.rl-brigade__reset {
  margin-left: auto;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/app/src/ui/brigade.test.ts` — PASS (all existing tests still pass: they pass no `credits`, so nothing new renders). `pnpm validate:ui` clean.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/app/src/ui/brigade.ts packages/app/src/ui/brigade.test.ts packages/app/src/ui/theme.css
/usr/bin/git commit -m "feat(ui): the brigade screen shows the credit balance and can reset the account" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Wire the account into `main.ts`

**Files:**
- Modify: `packages/app/src/main.ts` — imports (near line 66), the victory block (lines ~2028-2058, inside `if (me.result === 'victory')`), the `debriefOpts` build (line ~2092), the `?brigade` route (line ~541 `showBrigade(stage, {...})`)

**Interfaces:**
- Consumes: `creditsFor`, `CreditInput` (Task 1); `loadAccount`, `saveAccount`, `payMission`, `resetAccount` (Task 2); `DebriefOptions.credits` (Task 3); `BrigadeOptions.credits`/`onReset` (Task 4).

There is no unit test for `main.ts` (it is the shell); the proof is Task 7's browser walk plus the module tests above. Keep every line here a call into a tested function.

- [ ] **Step 1: Add the imports**

Next to `import { showDebrief, type DebriefOptions } from './ui/debrief';`:

```ts
import { creditsFor } from '@lions/sim';
import { loadAccount, payMission, resetAccount, saveAccount } from './brigade-account';
```

(`creditsFor` may join the existing `@lions/sim` import list instead of a second import; follow the file's style.)

- [ ] **Step 2: Pay at victory**

Inside `if (me.result === 'victory') { ... }`, immediately after `saveLedger(updatedLedger);` and before the `hud.note(...)` line, add:

```ts
            // The brigade account (spec 2026-09-15 §4.2): what this run is worth, paid
            // only for improvement over what this mission has paid before. Read from the
            // runtime's own counters -- the same numbers the debrief prints -- and the
            // wall clock is taken here, never in the sim.
            const lostTotal = Object.values(runtime.lostByType()).reduce((n, c) => n + c, 0);
            const runValue = creditsFor({
              result: me.result,
              carryingComplete: runtime.objectiveList.filter((o) => !o.primary && o.carries && o.status === 'complete').length,
              fielded: runtime.fieldedCount,
              lost: lostTotal,
              roe: me.roeRating,
              failBelow: mission.roe?.fail_below,
            });
            const payout = missionId ? payMission(loadAccount(window.localStorage), missionId, runValue, Date.now()) : null;
            if (payout) saveAccount(window.localStorage, payout.account);
```

`missionId` is the same variable the block below already tests (`if (missionId)`); declare `payout` with `let payout: ReturnType<typeof payMission> | null = null;` ABOVE the `if (me.result === 'victory')` line if TypeScript's scoping needs it for the debrief build below (the debrief build sits inside `if (missionId)` after this block).

- [ ] **Step 3: Hand it to the debrief**

In the `debriefOpts` literal, after `promoted: runtime.promotedCount,`:

```ts
              credits: payout ? { paid: payout.paid, balance: payout.account.balance } : undefined,
```

- [ ] **Step 4: The brigade screen**

In the `?brigade` route's `showBrigade(stage, { ... })` call, add two fields:

```ts
        credits: loadAccount(window.localStorage).balance,
        onReset: () => {
          resetAccount(window.localStorage);
          window.location.reload();
        },
```

- [ ] **Step 5: Check `?fresh` leaves the account alone**

Read lines 495-503: the branch removes `LEDGER_KEY` and `TUTORIAL_DONE_KEY` only. Do not add `ACCOUNT_KEY` there. Add one comment line under the `removeItem(TUTORIAL_DONE_KEY)` line:

```ts
    // The brigade account (`brigade-account.ts`) deliberately survives this: spec
    // 2026-09-15 §4.1 -- a second campaign starts with the brigade you built.
```

- [ ] **Step 6: Gates**

Run: `pnpm typecheck`, `pnpm lint`, `pnpm test` — all clean; `pnpm validate:ui` clean.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add packages/app/src/main.ts
/usr/bin/git commit -m "feat(app): a victory pays the brigade account; the debrief and the brigade screen read it" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The harness pins the optimal ladder's credit total

**Files:**
- Modify: `tools/src/backtest/playtest.ts` — the `run()` summary (lines ~150-184) and the ladder block after `GATES` (line ~2113)

**Interfaces:**
- Consumes: `creditsFor` (Task 1), the existing `missionOrder` and `missionStars` machinery.
- Produces: a printed `credits` figure per winning run and a `credit ladder: N` line; a pinned constant `LADDER_CREDITS` with the measured total.

- [ ] **Step 1: Record each winning plan's value**

Near `const missionStars = new Map<string, Stars>();` add:

```ts
/** Each mission's own winning-plan credit value (spec 2026-09-15 §4.2), recorded under
 *  the same `label === id` guard as `missionStars`, so probes and controls never count. */
const missionCredits = new Map<string, number>();
```

In `run()`, after the summary `console.log(...)` and before the `if (rt.result !== expect)` check, compute the value and print it:

```ts
  const lostTotal = Object.values(rt.lostByType()).reduce((n, c) => n + c, 0);
  const credits = creditsFor({
    result: rt.result,
    carryingComplete: rt.objectiveList.filter((o) => !o.primary && o.carries && o.status === 'complete').length,
    fielded: rt.fieldedCount,
    lost: lostTotal,
    roe: rt.roeScore,
    failBelow: mission.roe?.fail_below,
  });
  console.log(`${label}: credits ${credits}`);
```

(`mission` is the parsed mission JSON `run()` already holds — use the same identifier the function uses for `resolveUpgrades`.) Then, beside `if (expect === 'victory' && label === id) missionStars.set(id, rt.stars);`:

```ts
  if (expect === 'victory' && label === id) missionCredits.set(id, credits);
```

Import `creditsFor` from `@lions/sim` alongside the existing `starsEarned`/`unlockReason` import.

- [ ] **Step 2: Sum the ladder and pin it**

After the `GATES` loop, add:

```ts
// --- Brigade economy step 1: the optimal ladder's credit total ---------------
//
// The sum of every winning plan's value in `world.json` order. Pinned here the way
// the star gates are, so a content or weight change that moves what the campaign
// pays is a red line with a number, not a silent drift. Re-pin deliberately, in the
// same commit as the change that moved it, and say why. The balance analyst fits
// prices (steps 2-3) against this figure.
let ladderCredits = 0;
for (const missionId of missionOrder) ladderCredits += missionCredits.get(missionId) ?? 0;
const LADDER_CREDITS = 0; // measured on the first run of this task; replace before committing
console.log(`credit ladder: ${ladderCredits} over ${missionOrder.length} missions`);
if (ladderCredits !== LADDER_CREDITS) {
  console.error(`credit ladder: FAILED — expected ${LADDER_CREDITS}, got ${ladderCredits}`);
  process.exitCode = 1;
}
```

- [ ] **Step 3: Measure, then pin**

Run: `pnpm playtest` — it goes red once with `expected 0, got N`. Put `N` into `LADDER_CREDITS`, delete the placeholder comment, and add a one-line comment naming the date and the weights it was measured under (`win 100 / secondary 40 / home 10 / conduct 1`).

Run: `pnpm playtest` again — exit 0, and every pre-existing line unchanged except the new `credits` lines (diff the two captures; only additions).

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add tools/src/backtest/playtest.ts
/usr/bin/git commit -m "test(playtest): pin the optimal ladder's credit total beside the star gates" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Browser proof and docs

**Files:**
- Modify: `CLAUDE.md` — the "Dev instruments" list (add one bullet after the `?sandbox` bullets)
- Modify: `docs/campaign/README.md` — the ledger paragraph near line 49 ("The player force is placed, not built")
- Modify: `docs/superpowers/specs/2026-09-15-brigade-economy-design.md` §8 (mark step 1 landed with the pinned ladder figure)

- [ ] **Step 1: Walk it in the browser**

Use the golden harness's own helpers the way the 2026-09-14 captures did (`tools/src/golden-diff/browser.ts`: `ensureDevServer`, `launchCaptureBrowser`, `dismissDeployGate`), in a throwaway script under the session scratchpad, never committed:
1. Boot `?mission=beit_sahwan_1_recon` with an empty ledger and an empty account, drive the mission to victory with `__lions.sim.debugKill` on every enemy or by the mission's own plan, open the debrief, and read `.rl-debrief__credits` — expect `+N credits · N on hand` with N > 0.
2. Read `localStorage['lions.brigade.account']` — expect `balance === N`, one `earned` grant naming the mission.
3. Boot the same mission again and win it no better — expect `no improvement over your best, nothing paid · N on hand`.
4. Boot `?brigade` — expect the header's `N credits`; click reset twice — expect the key gone and `0 credits` after reload.
5. Boot `?fresh=1&campaign` — expect the account key still present.
Record every read value in the report with the command that produced it.

- [ ] **Step 2: Docs**

`CLAUDE.md`, in "Dev instruments", after the `?sandbox` flag bullets, add:

```markdown
- **The brigade account is a second save, not a ledger key.** `lions.brigade.account`
  (`packages/app/src/brigade-account.ts`, the only reader and writer) holds credits and
  what they bought, and it SURVIVES `?fresh` on purpose (spec 2026-09-15 §4.1): a second
  campaign starts with the brigade you built. Reset it from the brigade screen, twice.
  A victory pays `creditsFor` (`packages/sim/src/credits.ts`, integer-only, never called
  by the sim) only for improvement over what that mission paid before; `pnpm playtest`
  pins the optimal ladder's total (`LADDER_CREDITS`) beside the star gates.
```

`docs/campaign/README.md`, after the sentence that names `from_ledger`, add one sentence: "Credits (the brigade account) are not a ledger key: a mission never reads or produces them, and nothing in mission JSON can reference the balance."

Spec §8, step 1: append "— landed &lt;date&gt;, ladder total &lt;N&gt;" once Task 6's number exists.

- [ ] **Step 3: Full gate line, then commit**

Run: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm validate:data`, `pnpm validate:ui`, `pnpm playtest`, `pnpm balance` — all exit 0. `pnpm test:determinism` — the hash is unchanged (no sim file the sim calls was touched).

```bash
/usr/bin/git add CLAUDE.md docs/campaign/README.md docs/superpowers/specs/2026-09-15-brigade-economy-design.md
/usr/bin/git commit -m "docs: the brigade account and the credit ladder" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage (step 1 of §8):** account module and reset — Tasks 2, 4, 5; `creditsFor` — Task 1; improvement rule — Task 2; debrief line — Tasks 3, 5; ladder assertion — Task 6; docs — Task 7. §4.1's "no client path writes a granted entry" — Task 2's test and `migrateAccount`. §4.1's "`?fresh` leaves the account alone" — Task 5 step 5 and Task 7's walk. Steps 2 and 3 of §8 (price gates, upgrades) are deliberately absent: separate plans.
- **Placeholders:** Task 6's `LADDER_CREDITS = 0` is a measured-then-pinned constant with an explicit instruction to replace it before committing, mirroring how the star gates were pinned; it is not a TBD.
- **Type consistency:** `CreditInput` fields (`result`, `carryingComplete`, `fielded`, `lost`, `roe`, `failBelow`) are used identically in Tasks 1, 5 and 6; `payMission` returns `{ account, paid }` in Tasks 2 and 5; `DebriefOptions.credits` is `{ paid, balance }` in Tasks 3 and 5; `BrigadeOptions.credits`/`onReset` in Tasks 4 and 5.
