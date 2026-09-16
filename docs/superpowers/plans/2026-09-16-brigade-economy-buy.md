# Brigade Economy — Step 2 "Buy" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A unit with a `price` can be bought with credits from the brigade screen; buying opens it everywhere the earned gates are read (dock, brigade, `upgrades_to`), a unit with only a price is bought-only, and the harness proves a bought gate opens a placement.

**Architecture:** The gate type grows two fields, `price` (authored) and `bought` (resolved by the app from the brigade account, never authored). `unlockReason` — the one predicate every surface already calls — returns null when `bought` is true and otherwise appends the buy clause to its sentence, so the dock, the brigade screen and the `resolveUpgrades` pre-pass agree by construction. The account module gains `buyUnlock`. The brigade screen gains a Buy control per priced locked row. Prices are data, fitted by the balance analyst in `docs/campaign/economy/prices.md`.

**Tech Stack:** TypeScript strict, vitest (jsdom for UI), pnpm; `@lions/sim` integer-only.

**Spec:** `docs/superpowers/specs/2026-09-15-brigade-economy-design.md` — §2 D1, §4.4 (unlocks by price), §4.5 (the shop's locked rows), §6, §8 step 2. Prices: `docs/campaign/economy/prices.md` (the balance analyst's fit; if it is not yet committed on this branch when Task 5 runs, the controller waits for it).

## Global Constraints

- `packages/sim` integer-only: no `Math.*`/`Date.*`; `unlock.ts` stays pure. No sim file the sim calls changes behaviour; the golden determinism hash must not move.
- `bought` is NEVER authored in JSON: the schema does not admit it, the validator refuses it, only the app's gate mapper sets it from `account.unlocks`.
- The buy clause text is exactly `, or buy for N credits` appended to an earned sentence, and exactly `buy for N credits` for a price-only gate. The dock label for a price-only lock is `N cr`.
- Buying refuses when the balance is short or the unit is already bought; it deducts the price, appends the id to `account.unlocks`, writes no grant, and never touches `earned_total`.
- A bought unit is still built with logistics inside a mission; nothing here touches the in-mission economy.
- Git in a worktree: `/usr/bin/git` by absolute path, one plain command per call; explicit paths; never stash; never `-A`. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: `price` and `bought` on the gate, and the buy clause

**Files:**
- Modify: `packages/sim/src/unlock.ts:1-60`
- Modify: `packages/sim/src/unlock.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface UnlockGate {
    roeMin?: number;
    starsMin?: number;
    afterMission?: string;
    /** Credits that open this unit without the earned gates (spec 2026-09-15 §4.4). Authored. */
    price?: number;
    /** True when the brigade account lists this unit as bought. Resolved by the app; never authored. */
    bought?: boolean;
  }
  ```
  `unlockReason(unlock, ledger)`: unchanged signature. Returns `null` when `bought === true`. When an earned check fails and `price` is set, the sentence gains `, or buy for ${price} credits`. When the gate has no earned field at all but has a `price` and is not bought, returns `buy for ${price} credits`.

- [ ] **Step 1: Write the failing tests** — append inside `describe('unlockReason', ...)`:

```ts
  it('opens a bought unit whatever its earned gates say', () => {
    expect(unlockReason({ roeMin: 90, starsMin: 44, afterMission: 'x', price: 900, bought: true }, {})).toBe(null);
  });

  it('offers the price after an earned sentence', () => {
    expect(unlockReason({ starsMin: 12, price: 600 }, {})).toBe('requires 12 stars (currently 0), or buy for 600 credits');
    expect(unlockReason({ roeMin: 55, price: 400 }, { 'roe.mission_ratings': { a: 20 } })).toBe(
      'requires campaign Conduct 55, or buy for 400 credits'
    );
  });

  it('names only the price for a bought-only unit', () => {
    expect(unlockReason({ price: 1200 }, {})).toBe('buy for 1200 credits');
    expect(unlockReason({ price: 1200, bought: true }, {})).toBe(null);
  });

  it('adds no clause when there is no price', () => {
    expect(unlockReason({ starsMin: 12 }, {})).toBe('requires 12 stars (currently 0)');
  });
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run packages/sim/src/unlock.test.ts`: the four new cases FAIL (`price`/`bought` unknown or wrong text).

- [ ] **Step 3: Implement** — in `unlock.ts`, extend the interface as above, then restructure `unlockReason`:

```ts
export function unlockReason(unlock: UnlockGate | undefined, ledger: LedgerData | undefined): string | null {
  if (!unlock) return null;
  // A purchase opens the unit outright (spec 2026-09-15 §4.4). Resolved by the app from
  // the brigade account; nothing in data can author it.
  if (unlock.bought === true) return null;
  const earned = earnedReason(unlock, ledger);
  if (earned === null) {
    // No earned field failed. A gate with no earned field at all is bought-only
    // (D1: the special forces shape): closed until bought.
    const hasEarnedField = unlock.roeMin !== undefined || unlock.starsMin !== undefined || unlock.afterMission !== undefined;
    if (!hasEarnedField && unlock.price !== undefined) return `buy for ${unlock.price} credits`;
    return null;
  }
  return unlock.price !== undefined ? `${earned}, or buy for ${unlock.price} credits` : earned;
}

/** The earned checks exactly as before, in the same order (Conduct, stars, mission). */
function earnedReason(unlock: UnlockGate, ledger: LedgerData | undefined): string | null {
  // ... the existing three checks, moved verbatim ...
  return null;
}
```

Keep the Conduct sentence's `detail` behaviour byte-identical (the existing tests pin it).

- [ ] **Step 4: Run to verify they pass** — the whole file green; `pnpm lint`, `pnpm typecheck` clean.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/sim/src/unlock.ts packages/sim/src/unlock.test.ts
/usr/bin/git commit -m "feat(sim): a gate may carry a price, and a bought gate is open" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `buyUnlock` on the account

**Files:**
- Modify: `packages/app/src/brigade-account.ts` (after `payMission`)
- Modify: `packages/app/src/brigade-account.test.ts`

**Interfaces:**
- Produces: `export function buyUnlock(account: BrigadeAccount, unitId: string, price: number): { account: BrigadeAccount; ok: boolean }` — `ok: false` and the same account object when `price` is not a non-negative integer, the balance is short, or the id is already in `unlocks`; otherwise a new account with `balance - price` and `unlocks` + id. No grant is written; `earned_total` and `paid` are untouched.

- [ ] **Step 1: Write the failing tests** — append inside `describe('brigade account', ...)`:

```ts
  it('buys an unlock: deducts the price and records the id, without a grant', () => {
    const funded = payMission(emptyAccount(), 'm1', 1000, 1).account;
    const { account, ok } = buyUnlock(funded, 'mbt_lavi', 600);
    expect(ok).toBe(true);
    expect(account.balance).toBe(400);
    expect(account.unlocks).toEqual(['mbt_lavi']);
    expect(account.earned_total).toBe(1000);
    expect(account.grants).toHaveLength(1);
    expect(funded.balance).toBe(1000); // input untouched
  });

  it('refuses when the balance is short, the id is already bought, or the price is not an integer', () => {
    const funded = payMission(emptyAccount(), 'm1', 500, 1).account;
    expect(buyUnlock(funded, 'mbt_lavi', 600)).toEqual({ account: funded, ok: false });
    const bought = buyUnlock(funded, 'mbt_lavi', 500).account;
    expect(buyUnlock(bought, 'mbt_lavi', 0)).toEqual({ account: bought, ok: false });
    expect(buyUnlock(funded, 'x', 2.5)).toEqual({ account: funded, ok: false });
    expect(buyUnlock(funded, 'x', -1)).toEqual({ account: funded, ok: false });
  });

  it('round-trips a bought unlock through storage', () => {
    const s = store();
    saveAccount(s, buyUnlock(payMission(emptyAccount(), 'm1', 700, 1).account, 'ifv_namer', 700).account);
    expect(loadAccount(s).unlocks).toEqual(['ifv_namer']);
    expect(loadAccount(s).balance).toBe(0);
  });
```

Import `buyUnlock` at the top of the test file.

- [ ] **Step 2: Run to verify they fail** — `npx vitest run packages/app/src/brigade-account.test.ts`.

- [ ] **Step 3: Implement**

```ts
/** Buying an unlock (spec §4.4): one step, no refunds. Refuses — returning the same account
 *  by identity — when the price is not a non-negative integer, the balance is short, or the
 *  unit is already bought. Spending writes no grant: `grants` is the earned history, and
 *  `earned_total` never moves on a purchase. */
export function buyUnlock(account: BrigadeAccount, unitId: string, price: number): { account: BrigadeAccount; ok: boolean } {
  if (!isNonNegInt(price)) return { account, ok: false };
  if (account.unlocks.includes(unitId)) return { account, ok: false };
  if (account.balance < price) return { account, ok: false };
  return {
    account: { ...account, balance: account.balance - price, unlocks: [...account.unlocks, unitId] },
    ok: true,
  };
}
```

- [ ] **Step 4: Run to verify they pass**; `pnpm lint`, `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/app/src/brigade-account.ts packages/app/src/brigade-account.test.ts
/usr/bin/git commit -m "feat(app): buyUnlock -- one step, no refunds, no grant" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The dock label and the brigade's Buy controls

**Files:**
- Modify: `packages/app/src/ui/dock-model.ts:89-95` (`lockLabel`), `packages/app/src/ui/dock-model.test.ts`
- Modify: `packages/app/src/ui/brigade.ts` (`BrigadeOptions`, `bindingGate`, the row loop), `packages/app/src/ui/brigade.test.ts`
- Modify: `packages/app/src/ui/theme.css` (one rule, `.rl-brigade__buy`)

**Interfaces:**
- Produces on `BrigadeOptions`: `onBuy?: (unitId: string, price: number) => void` — the caller buys, saves and re-renders; the screen only asks.
- `lockLabel('buy for 600 credits')` → `'600 cr'`; an earned sentence with the buy clause still labels by its earned number (`'★ ≥12'`, `'Conduct ≥55'`).

- [ ] **Step 1: Write the failing tests**

`dock-model.test.ts`, inside `describe('lockLabel', ...)`:

```ts
  it('labels a bought-only lock by its price, and an earned lock by its earned number even with a buy clause', () => {
    expect(lockLabel('buy for 600 credits')).toBe('600 cr');
    expect(lockLabel('requires 12 stars (currently 0), or buy for 600 credits')).toBe('★ ≥12');
    expect(lockLabel('requires campaign Conduct 55, or buy for 400 credits')).toBe('Conduct ≥55');
    const why = unlockReason({ price: 1200 }, {});
    expect(lockLabel(why ?? '')).toBe('1200 cr');
  });
```

`brigade.test.ts`, inside `describe('showBrigade', ...)` (reuse the file's `units` fixture; give one unit `unlock: { starsMin: 12, price: 600 }` and another `unlock: { price: 1200 }` by mapping over the fixture):

```ts
  it('offers a Buy control on a priced locked row, disabled when the balance is short', () => {
    const host = document.createElement('div');
    const priced = units.map((u) =>
      u.id === 'breach_team' ? { ...u, unlock: { starsMin: 12, price: 600 } } : u.id === 'mbt_lavi' ? { ...u, unlock: { price: 1200 } } : u
    );
    const bought: [string, number][] = [];
    showBrigade(host, { units: priced, ledger: {}, possibleStars: 78, credits: 700, onBuy: (id, p) => bought.push([id, p]) });
    const breach = host.querySelector<HTMLButtonElement>('[data-unit="breach_team"] .rl-brigade__buy');
    expect(breach?.textContent).toBe('buy for 600');
    expect(breach?.disabled).toBe(false);
    breach?.click();
    expect(bought).toEqual([['breach_team', 600]]);
    const lavi = host.querySelector<HTMLButtonElement>('[data-unit="mbt_lavi"] .rl-brigade__buy');
    expect(lavi?.textContent).toBe('buy for 1200');
    expect(lavi?.disabled).toBe(true);
    expect(host.querySelector('[data-unit="mbt_lavi"] .rl-brigade__why')?.textContent).toBe('buy for 1200 credits');
  });

  it('shows no Buy control without an account, and none on an unpriced or open row', () => {
    const host = document.createElement('div');
    showBrigade(host, { units, ledger: {}, possibleStars: 78 });
    expect(host.querySelector('.rl-brigade__buy')).toBeNull();
    const host2 = document.createElement('div');
    showBrigade(host2, { units: units.map((u) => ({ ...u, unlock: { price: 5, bought: true } })), ledger: {}, possibleStars: 78, credits: 0, onBuy: () => {} });
    expect(host2.querySelector('.rl-brigade__buy')).toBeNull();
    expect(host2.querySelector('.rl-brigade__why')?.textContent).toBe('available');
  });
```

- [ ] **Step 2: Run to verify they fail** — both files.

- [ ] **Step 3: Implement**

`dock-model.ts` `lockLabel`: keep the two regexes (they anchor at `^requires` and still match a sentence with the clause appended), add before the fallback:

```ts
  const price = /^buy for (\d+) credits/.exec(reason);
  if (price !== null) return `${price[1]} cr`;
```

`brigade.ts`: add `onBuy?: (unitId: string, price: number) => void;` to `BrigadeOptions` with a doc comment. In `bindingGate`, a gate with no earned field but a price returns `[3, unlock.price]` so bought-only rows sort after the mission-gated ones by price. In the row loop, after the `rl-brigade__why` element:

```ts
    if (row.locked && row.unlock.price !== undefined && opts.credits !== undefined && opts.onBuy) {
      const price = row.unlock.price;
      const buy = document.createElement('button');
      buy.type = 'button';
      buy.className = 'rl-btn rl-brigade__buy';
      buy.textContent = `buy for ${price}`;
      // Short balance: the control stays visible so the price is legible, and disabled so
      // a click cannot reach `buyUnlock`'s refusal path from here.
      buy.disabled = opts.credits < price;
      buy.addEventListener('click', () => {
        buy.disabled = true; // one purchase per render; the caller re-renders
        opts.onBuy?.(u.id, price);
      });
      rowEl.appendChild(buy);
    }
```

`theme.css`, beside `.rl-brigade__credits`: `.rl-brigade__buy { color: var(--commend); }`.

- [ ] **Step 4: Run to verify they pass** — both test files; `pnpm validate:ui`, `pnpm lint`, `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/app/src/ui/dock-model.ts packages/app/src/ui/dock-model.test.ts packages/app/src/ui/brigade.ts packages/app/src/ui/brigade.test.ts packages/app/src/ui/theme.css
/usr/bin/git commit -m "feat(ui): the brigade sells a priced lock; the dock labels a bought-only lock by its price" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Wire `bought` and `onBuy` in `main.ts`

**Files:**
- Modify: `packages/app/src/main.ts` — `kdfUnlockGate` (~line 196), the `?brigade` route (~line 559), the `resolveUpgrades` lookup (~line 808) and the runtime's `unitInfo` gate (~line 828)

**Interfaces:**
- Consumes: `UnlockGate.price/bought` (Task 1), `buyUnlock` (Task 2), `BrigadeOptions.onBuy` (Task 3).
- Produces: `kdfUnlockGate(u, bought: ReadonlySet<string>)` — maps `price: unlock.price` and `bought: bought.has(u.id)`.

- [ ] **Step 1: The mapper** — change `kdfUnlockGate` to take the bought set:

```ts
function kdfUnlockGate(u: (typeof units)[keyof typeof units], bought: ReadonlySet<string>): UnlockGate | undefined {
  const unlock = 'unlock' in u
    ? (u.unlock as { roe_rating_min?: number; stars_min?: number; after_mission?: string; price?: number })
    : undefined;
  if (!unlock) return undefined;
  return {
    roeMin: unlock.roe_rating_min,
    starsMin: unlock.stars_min,
    afterMission: unlock.after_mission,
    price: unlock.price,
    // Resolved here and nowhere else (spec §4.4): a purchase opens the unit on every
    // surface that reads this gate -- dock, brigade, resolveUpgrades -- by construction.
    bought: bought.has(u.id),
  };
}
```

Build the set once near the top of `main()` from the account: `const boughtUnits = new Set(storage ? loadAccount(storage).unlocks : []);` (reuse the existing `safeStorage()`; `storage` may be null). Pass `boughtUnits` at every `kdfUnlockGate` call site (the brigade route's `kdfUnits`, the `resolveUpgrades` lookup, the runtime `unitInfo`, the debrief's `kdfUnits`).

- [ ] **Step 2: The brigade route** — add to `showBrigade(stage, {...})`:

```ts
        onBuy: storage
          ? (unitId, price) => {
              const { account, ok } = buyUnlock(loadAccount(storage), unitId, price);
              if (ok) saveAccount(storage, account);
              window.location.reload();
            }
          : undefined,
```

Import `buyUnlock` beside the other account imports.

- [ ] **Step 3: Gates** — `pnpm typecheck`, `pnpm lint`, `pnpm test`.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add packages/app/src/main.ts
/usr/bin/git commit -m "feat(app): a bought unit is open on every surface; the brigade route buys" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Schema, validator, and the twelve prices

**Files:**
- Modify: `data/schemas/unit.schema.json:85-104` (`unlock.price`)
- Modify: `tools/validate_data.mjs` (beside the F7 `upgrades_to` block)
- Modify: the twelve `data/units/kdf/*.json` files that carry an `unlock` block
- Read: `docs/campaign/economy/prices.md` (the balance analyst's fit — the numbers come from its table, never from this plan)

- [ ] **Step 1: Schema** — add to `unlock.properties`:

```json
        "price": {
          "type": "integer",
          "minimum": 1,
          "description": "Credits that open this unit from the brigade screen without its earned gates (spec 2026-09-15 §4.4). A unit whose unlock carries ONLY a price is bought-only. Never `bought`: that is resolved by the app from the brigade account and cannot be authored."
        }
```

`additionalProperties: false` already refuses `bought`.

- [ ] **Step 2: Validator** — in `tools/validate_data.mjs`, where units are checked, add: a unit with `unlock.bought` present → failure `"<unit>: unlock.bought is resolved from the brigade account and cannot be authored"` (belt and braces beside the schema); a unit with `unlock.price` must have `faction: 'kdf'` → failure otherwise. Falsify each once against a scratch copy and paste the refusal lines into your report; delete the scratch copy.

- [ ] **Step 3: Prices** — open `docs/campaign/economy/prices.md`, copy each of the twelve prices into the unit's `unlock` block as `"price": N`, preserving the file's formatting. Do not change any other field.

- [ ] **Step 4: Gates** — `pnpm validate:data` (115 files), `pnpm test`, `pnpm playtest` (no harness line may change: prices do not affect the earned path).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add data/schemas/unit.schema.json tools/validate_data.mjs data/units/kdf
/usr/bin/git commit -m "content(units): unlock.price on the twelve gated units, fitted to the credit ladder" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The harness's bought-gate probe, the browser walk, and the docs

**Files:**
- Modify: `tools/src/backtest/playtest.ts` — `unlockOf` (~line 114) and the `khan_rafid_3_clearance` probes (~line 1133)
- Modify: `docs/superpowers/specs/2026-09-15-brigade-economy-design.md` §8 step 2; `CLAUDE.md` (the `starting_force` bullet's `resolveUpgrades` sentence; the brigade-account bullet in Dev instruments)

- [ ] **Step 1: The probe** — give `unlockOf` an optional `bought: ReadonlySet<string>` (default empty) mapped into `bought`, and add ONE probe after the existing `khan_rafid_3_clearance (gate open)` run: label `'khan_rafid_3_clearance (bought)'`, ledger `{}`, `bought = new Set(['breach_team'])`, `fielded: 'breach_team'`. Expected line: VICTORY, 2 stars, `fielded breach_team=true` — proving a purchase opens an `upgrades_to` slot with no stars at all. The `label === id` guard keeps it out of both ladders. Run `pnpm playtest`: exit 0, every pre-existing line byte-identical (capture before/after, diff).

- [ ] **Step 2: Browser walk** — a throwaway Playwright script under the session scratchpad (never committed), on the harness's own helpers (`ensureDevServer`, `launchCaptureBrowser`, `dismissDeployGate`, port 5179; the earlier `walk.mts` in the scratchpad is the reference): seed an account with balance 2000 via `page.addInitScript` ONCE (not on every navigation), boot `?brigade`, read the Buy control on a priced locked row and its text, click it, read the account's `unlocks` and `balance` from local storage after the reload, and read the row's `.rl-brigade__why` now `available`. Then boot `?mission=beit_sahwan_3_clearance` with an EMPTY ledger and the same account: the dock tile for the bought unit is buildable (no lock), and a priced-but-unbought locked unit's tile shows either its earned label or `N cr`. Screenshots of the brigade before/after and the dock; every reading with its command.

- [ ] **Step 3: Docs** — spec §8 step 2: "— landed <date>, prices in docs/campaign/economy/prices.md". CLAUDE.md `starting_force` bullet: after the `gate_only` sentence add "A bought unit (`unlock.price`, brigade account) counts as an open gate for `resolveUpgrades` too — `bought` is resolved by `kdfUnlockGate` from the account and is never authored." CLAUDE.md brigade-account bullet: one sentence: "Buying an unlock deducts and records `unlocks`; it writes no grant."

- [ ] **Step 4: Full gate line** — `pnpm test`, `pnpm test:determinism`, `pnpm lint`, `pnpm typecheck`, `pnpm validate:data`, `pnpm validate:ui`, `pnpm playtest`, `pnpm balance`.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add tools/src/backtest/playtest.ts docs/superpowers/specs/2026-09-15-brigade-economy-design.md CLAUDE.md
/usr/bin/git commit -m "test,docs: a bought gate opens a placement; step 2 recorded" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage (§8 step 2):** `unlock.price` — Tasks 1, 5; bought-only units — Task 1 (sentence), Task 3 (row), Task 5 (schema); `unlockReason` with the account — Task 1 + Task 4's mapper; the shop's locked rows — Task 3; the dock sentence — Task 3 (`lockLabel`) and Task 4 (the runtime gate carries `bought`); the harness's bought-gate probe — Task 6. Prices — Task 5 from the analyst's doc.
- **Placeholders:** Task 5's prices are read from the analyst's committed document, named by path; Task 6's `<date>` is the landing date.
- **Type consistency:** `UnlockGate.price?: number; bought?: boolean` (Task 1) is what `kdfUnlockGate` (Task 4) and `unlockOf` (Task 6) produce; `buyUnlock` returns `{ account, ok }` (Tasks 2, 4); `onBuy(unitId, price)` (Tasks 3, 4); `.rl-brigade__buy` text `buy for N` (Task 3) and `lockLabel` `N cr` (Task 3).
