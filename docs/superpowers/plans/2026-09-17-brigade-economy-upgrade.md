# Brigade Economy — Step 3 "Upgrade" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A KDF unit's JSON may declare upgrade tracks; the brigade account records the tier bought per track; an app-side pre-pass patches the unit before the sim registers it; the harness and the balance backtest prove the §5.7 targets and every optimal-ladder plan hold at maximum tier; the brigade screen sells tiers as pips.

**Architecture:** One pure function, `applyUpgrades(unit, tiers)`, exported from `@lions/data` and called by the app (`main.ts`, before `addUnitType`), the playtest harness and the balance backtest — so the sim registers a patched type and never learns a tier exists (spec §4.3, D5). The whitelist of patchable paths is closed and lives in the unit schema; `upgrades.ts` mirrors it as a constant pinned against the schema by a test. Tier prices and deltas are content, fitted by the balance analyst in `docs/campaign/economy/upgrades.md`.

**Tech Stack:** TypeScript strict, vitest (jsdom for UI), pnpm; `@lions/sim` untouched; Python 3 for `tools/validate_balance.py`.

**Spec:** `docs/superpowers/specs/2026-09-15-brigade-economy-design.md` §4.3 (unit upgrades), §4.5 (the shop's available rows), §6 (testing), §8 step 3. Numbers: `docs/campaign/economy/upgrades.md` (the balance analyst's fit — Task 6 waits for it if it is not yet committed).

**Deviation from the spec, recorded:** §4.3 names `packages/app/src/upgrades.ts`; this plan puts `applyUpgrades` in `packages/data/src/upgrades.ts` (exported from `@lions/data`). Reason: `tools/src/backtest/{harness,playtest}.ts` import only `@lions/data` and `@lions/sim`, and §4.3 requires the app, the harness and the backtest to call the SAME function. `@lions/data` stays a leaf (the function is JSON→JSON, generic over the unit's own type).

## Two phases

**Phase A (Tasks 1–6) runs now.** Nothing in it touches `packages/app/src/ui/`.

**Phase B (Tasks 7–8) runs only after `feat/shell-upgrade` has landed on `main`** (the "Game art commercial quality review" session's branch; it reshapes the gate sentence into `packages/app/src/gate-sentence.ts`, makes `lockLabel` take `(unlock, ledger)`, converts `theme.css` to rem behind `--ui-scale`, and makes `pnpm validate:ui` refuse any `px` ≥ 4 on a line not ending in `/* px-ok */`). Before Task 7: merge `origin/main` into this branch, re-run the full gate line, and read `brigade.ts` and `theme.css` as they are THEN. The brief for Task 7 must be written against that merged state, not against this plan's memory of the files.

## Global Constraints

- `packages/sim` does not change. The golden determinism hash must not move; `pnpm test:determinism` runs before every commit that touches data or the pre-pass.
- Whitelist (closed, spec §4.3): `hull.hp`, `hull.armor.front`, `hull.armor.side`, `hull.armor.rear`, `hull.suppression_resistance`, `sensors.optics`, `sensors.sight_tiles`, `weapons[<i>].accuracy`, `weapons[<i>].penetration`. Nothing else, ever: not cost, speed, rate of fire, collateral risk.
- A patch is a cumulative DELTA over base (tier 2 states the total delta). Tiers are monotone: each tier's price ≥ the previous tier's, and each delta ≥ the previous tier's for the same path. A tier may only patch a path that EXISTS on the unit (an infantry hull with no `armor.rear` cannot take a rear delta; weapon index in range).
- `applyUpgrades` never mutates its input; tier 0 (or an absent track) is the identity; a tier above the track's maximum is clamped to the maximum (data may shrink a track after a purchase; the account is never "wrong", only ahead).
- `buyUpgrade` buys exactly the NEXT tier of a track (current + 1), refuses when the balance is short or the tier is not the next one, deducts the tier's price, writes no grant, never touches `earned_total`. No refunds.
- Prices and deltas are the analyst's, copied verbatim from `docs/campaign/economy/upgrades.md`; the plan never invents a number.
- `pnpm balance`, `tools/validate_balance.py` and `pnpm playtest` all run at base AND at maximum tier; base output stays byte-identical to today; the max-tier pass must reach the same result and stars on every optimal-ladder mission and the credit ladder (5544) must not move.
- UI colours only via semantic tokens; credits and their controls use `--commend`. Phase B follows the merged `theme.css`'s rem/`--ui-scale` rules.
- Git in a worktree: `/usr/bin/git` by absolute path, one plain command per call; explicit paths; never stash; never `-A`; no heredocs. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## Phase A

### Task 1: Schema and validator for `upgrades`

**Files:**
- Modify: `data/schemas/unit.schema.json` (top-level `upgrades` property beside `unlock`)
- Modify: `tools/validate_data.mjs` (beside the per-unit `unlock` checks added in step 2, in the all-faction loop that builds `unitsById`)

**Interfaces (schema):**
```json
"upgrades": {
  "type": "object",
  "description": "Upgrade tracks (spec 2026-09-15 §4.3). Each tier's patch is the cumulative DELTA over base on the closed whitelist; tiers are monotone. Bought per track from the brigade account; applied by @lions/data's applyUpgrades before the sim registers the type. KDF units only.",
  "additionalProperties": false,
  "minProperties": 1,
  "maxProperties": 3,
  "patternProperties": {
    "^[a-z][a-z_]{1,15}$": {
      "type": "object",
      "additionalProperties": false,
      "required": ["tiers"],
      "properties": {
        "tiers": {
          "type": "array", "minItems": 1, "maxItems": 3,
          "items": {
            "type": "object", "additionalProperties": false, "required": ["price", "patch"],
            "properties": {
              "price": { "type": "integer", "minimum": 1 },
              "patch": {
                "type": "object", "minProperties": 1, "additionalProperties": false,
                "propertyNames": { "pattern": "^(hull\\.hp|hull\\.armor\\.(front|side|rear)|hull\\.suppression_resistance|sensors\\.optics|sensors\\.sight_tiles|weapons\\[[0-9]+\\]\\.(accuracy|penetration))$" },
                "patternProperties": { "": { "type": "number", "minimum": 0 } }
              }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 1: Schema** — add the block above beside `unlock`. `pnpm validate:data` still passes (no unit carries `upgrades` yet).
- [ ] **Step 2: Validator rules**, each with its own sentence, added in the all-faction per-unit loop:
  - (a) `upgrades` on a unit whose `faction !== 'kdf'` → `"<file>: upgrades are only valid on faction 'kdf' units"`.
  - (b) a patch path that does not exist on the unit (`hull.armor.rear` absent, `sensors.optics` absent, `weapons[3]` out of range) → `"<file>: upgrades.<track> tier <n> patches <path>, which this unit does not have"`. Resolve the path with a tiny reader that understands `a.b.c` and `weapons[i].field`.
  - (c) non-monotone tiers: price or any delta lower than the previous tier's (a path present in tier n but absent in tier n+1 counts as lower) → `"<file>: upgrades.<track> tier <n> is not monotone over tier <n-1> (<what>)"`.
- [ ] **Step 3: Falsify each rule once** against scratch copies under `data/units/kdf/` (and `data/units/enemy/` for rule a), run `pnpm validate:data`, paste the three refusal lines into the report, delete the scratch files, confirm `git status` clean. Also falsify the schema's own whitelist once (`"mobility.speed_tiles_s": 1` in a patch → schema refusal line) and paste it.
- [ ] **Step 4: Gates** — `pnpm validate:data` (all files valid), `pnpm lint`.
- [ ] **Step 5: Commit** — `data/schemas/unit.schema.json tools/validate_data.mjs`, message `feat(data): the upgrades schema and its whitelist; the validator refuses a bad track`.

### Task 2: `applyUpgrades` in `@lions/data`

**Files:**
- Create: `packages/data/src/upgrades.ts`, `packages/data/src/upgrades.test.ts`
- Modify: `packages/data/src/index.ts` (export)

**Interfaces:**
```ts
/** The closed whitelist, mirrored from unit.schema.json (pinned by a test). */
export const UPGRADE_PATHS: readonly RegExp[];
export interface UpgradeTier { price: number; patch: Record<string, number> }
export interface UpgradeTrack { tiers: UpgradeTier[] }
export type UpgradeTracks = Record<string, UpgradeTrack>;
/** A unit's JSON as far as this module needs to see it. */
export interface UpgradableUnit { id: string; upgrades?: UpgradeTracks; hull?: Record<string, unknown>; sensors?: Record<string, unknown>; weapons?: Record<string, unknown>[] }
/** Pure. Returns a NEW unit with each track's tier deltas added to base; tier 0 / absent track is the identity; a tier above the track's max is clamped. Throws on a path outside the whitelist (data is validated, so this is a programming error). */
export function applyUpgrades<T extends UpgradableUnit>(unit: T, tiers: Readonly<Record<string, number>>): T;
/** Every track at its maximum tier — what the harness and the backtest run. */
export function maxTiers(unit: UpgradableUnit): Record<string, number>;
/** The next tier's price, or null when the track is maxed / absent. */
export function nextTierPrice(unit: UpgradableUnit, track: string, current: number): number | null;
```

- [ ] **Step 1: Failing tests** (the fixture is a hand-written unit with `hull.hp 400`, `hull.armor {front 10, side 10}`, `sensors.optics 1.0`, two weapons, and two tracks: `armour` tiers `[{price 300, patch {hull.armor.front 10, hull.armor.side 5}}, {price 600, patch {hull.armor.front 20, hull.armor.side 10}}]`, `optics` tiers `[{price 250, patch {sensors.optics 0.2, weapons[0].accuracy 0.05}}]`):
  - identity: `applyUpgrades(u, {})` deep-equals `u` and is not the same object; `applyUpgrades(u, {armour: 0})` likewise.
  - deltas exact: `{armour: 2, optics: 1}` → front 30, side 20, optics 1.2, weapons[0].accuracy +0.05, weapons[1] untouched, `hull.hp` untouched.
  - no mutation: after the call, `u.hull.armor.front` is still 10 and `u.weapons[0].accuracy` unchanged.
  - clamp: `{armour: 9}` equals `{armour: 2}`.
  - unknown track ignored: `{nothing: 1}` is the identity.
  - unknown path throws: a fixture whose patch names `mobility.speed_tiles_s` → `applyUpgrades` throws with the path in the message.
  - `maxTiers(u)` → `{armour: 2, optics: 1}`; `maxTiers({id:'x'})` → `{}`.
  - `nextTierPrice(u, 'armour', 0)` → 300; `(u,'armour',1)` → 600; `(u,'armour',2)` → null; `(u,'nope',0)` → null.
  - whitelist pin: read `data/schemas/unit.schema.json`, extract the `propertyNames.pattern` under `upgrades`, and assert every path `UPGRADE_PATHS` accepts matches the schema pattern and vice versa over a fixed list of 12 candidate paths (9 legal, 3 illegal).
- [ ] **Step 2: Run red**, implement (structuredClone-free: rebuild the nested objects along each patched path, share everything else by reference is NOT acceptable for `weapons` array items that are patched — copy the patched item; unpatched siblings may be shared), run green.
- [ ] **Step 3: Gates** — `pnpm lint`, `pnpm typecheck`, `pnpm test` (the data package's lint rule forbids importing any `@lions/*` — keep it so).
- [ ] **Step 4: Commit** — `packages/data/src/upgrades.ts packages/data/src/upgrades.test.ts packages/data/src/index.ts`, message `feat(data): applyUpgrades -- a pure pre-pass over a unit's tiers`.

### Task 3: `buyUpgrade` on the account

**Files:**
- Modify: `packages/app/src/brigade-account.ts`, `packages/app/src/brigade-account.test.ts`

**Interface:**
```ts
/** Buys exactly the NEXT tier of a track (spec §4.3): refuses -- same object by identity -- when
 *  `tier !== (account.upgrades[unitId]?.[track] ?? 0) + 1`, when `price` is not an integer ≥ 1,
 *  or when the balance is short. Deducts, records the tier, writes no grant, never touches earned_total. */
export function buyUpgrade(account: BrigadeAccount, unitId: string, track: string, tier: number, price: number): { account: BrigadeAccount; ok: boolean };
```

- [ ] **Step 1: Failing tests** — buys tier 1 (balance 1000 → 700, `upgrades.inf_squad.armour === 1`, grants length unchanged, `earned_total` unchanged, input untouched); buys tier 2 after tier 1; refuses tier 2 when at 0, tier 1 when already 1, tier 0, a short balance, price 0 / 2.5; round-trips through `saveAccount`/`loadAccount`; `resetAccount` clears it (existing behaviour, pin it).
- [ ] **Step 2: Implement; gates** `pnpm lint`, `pnpm typecheck`, the test file.
- [ ] **Step 3: Commit** — `feat(app): buyUpgrade -- the next tier only, no refunds, no grant`.

### Task 4: The app's pre-pass

**Files:**
- Modify: `packages/app/src/main.ts` — the `for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u));` line (~802) and wherever else the app hands a KDF unit's stats to the sim or the HUD (grep `addUnitType`, and `unitInfo:`'s `logistics`/`buildTimeS` — cost is NOT patchable, so `unitInfo` stays on the raw JSON).

- [ ] **Step 1** — build `const ownedTiers = storage ? loadAccount(storage).upgrades : {}` once beside `boughtUnits` (same place, same null-storage handling), then register `sim.addUnitType(u.faction === 'kdf' ? applyUpgrades(u, ownedTiers[u.id] ?? {}) : u)`. Enemy units never go through the pre-pass. Import `applyUpgrades` from `@lions/data`.
- [ ] **Step 2** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:determinism` (the golden replay uses an empty account, so the hash cannot move — say so in the report with the run's output).
- [ ] **Step 3: Commit** — `feat(app): register each KDF type through applyUpgrades, so the sim never sees a tier`.

### Task 5: Max-tier passes in the harness, the backtest and the cost-curve validator

**Files:**
- Modify: `tools/src/backtest/playtest.ts`, `tools/src/backtest/harness.ts`, `tools/src/balance/cli.ts` (read it first), `tools/validate_balance.py`, `.github/workflows/ci.yml`

- [ ] **Step 1: Harness** — `run()` gains an optional `tiers?: 'max'` parameter; when set, `typeOf` registers KDF types through `applyUpgrades(u, maxTiers(u))` and the printed label carries ` (max tier)`. Rather than editing 26 call sites, `run()` records every plain `label === id` victory run's arguments in a module-level list, and a second pass at the END of the file (before the ladder assertions) replays each with `tiers: 'max'`, asserting the SAME `result` and the SAME `stars` as the base run; a mismatch prints `<id> (max tier): FAILED — base VICTORY/2★, max <result>/<n>★` and sets `exitCode = 1`. The max-tier lines are excluded from both ladders by the existing `label === id` guard (the label differs). Print one summary line: `max tier: N missions unchanged`. Capture `pnpm playtest` before/after; the base lines must be byte-identical; `LADDER_CREDITS` unchanged. Runtime roughly doubles (~8 s); acceptable, say what it measured.
- [ ] **Step 2: Backtest** — `harness.ts` exports `unitsAtMaxTier` (the `units` record with every KDF entry through `applyUpgrades(u, maxTiers(u))`); the balance CLI runs the §5.7 targets twice, printing two labelled tables (`base` then `max tier`) and failing if either table fails. `MBT_BARE` derives from the max-tier Lavi in the second pass. `pnpm balance` must pass both (the analyst fitted the tracks so it does; if a target fails, STOP and report — that is content to retune, never a gate to widen).
- [ ] **Step 3: Cost curve** — `tools/validate_balance.py` gains `--max-tier` and `--upgrade-cost-factor K` (K from `docs/campaign/economy/upgrades.md` §5): with `--max-tier`, each KDF unit's stats are patched by its max tiers (a small Python `apply_upgrades` mirroring the TS one — the duplication is accepted and named in the file's docstring) and its cost is `logistics + K × sum(track tier prices)`; the band check runs on the patched roster. `ci.yml` runs the validator twice: base (as today) and `--max-tier --upgrade-cost-factor K`.
- [ ] **Step 4: Falsify** — set one track's max tier to an absurd delta in a scratch copy (e.g. `hull.hp +100000` on `inf_squad`) and show `pnpm balance`'s max-tier table go red and the playtest max-tier pass report a changed result on at least one mission; restore, confirm `git status` clean, paste both red lines.
- [ ] **Step 5: Gates** — `pnpm playtest` (exit 0), `pnpm balance`, `python3 tools/validate_balance.py --units data/units` and with `--max-tier --upgrade-cost-factor K`, `pnpm lint`, `pnpm typecheck`.
- [ ] **Step 6: Commit** — `test: every optimal plan, every §5.7 target and the cost curve at max tier`.

Task 5 needs the tracks in the data to measure anything real; if Task 6's data is not yet in, run Task 6 first (they are independent in code; Task 6 is pure content).

### Task 6: The seventeen `upgrades` blocks

**Files:**
- Modify: every `data/units/kdf/*.json` that `docs/campaign/economy/upgrades.md` §3 gives tracks to (up to seventeen).

- [ ] **Step 1** — copy each unit's `upgrades` JSON block from the analyst's §3 verbatim (prices, tracks, tier patches), placed after `unlock` (or after `abilities` when there is no `unlock`), keeping the file's formatting. No other field changes.
- [ ] **Step 2: Gates** — `pnpm validate:data`, `pnpm test`, `pnpm test:determinism`, `pnpm balance` (both tables), `python3 tools/validate_balance.py` both ways, `pnpm playtest` (base lines byte-identical; max-tier pass green).
- [ ] **Step 3: Commit** — `data/units/kdf`, message `content(units): upgrade tracks for the KDF roster, fitted at base and max tier`.

---

## Phase B — after `feat/shell-upgrade` lands on `main`

### Task 7: Tier pips and per-track Buy on the brigade screen

**Pre-step (controller):** `/usr/bin/git fetch origin` then `/usr/bin/git merge origin/main`; resolve; full gate line; re-read `packages/app/src/ui/brigade.ts`, `brigade.test.ts`, `theme.css` (rem rules), `gate-sentence.ts`. Write the brief against those files.

**Files:** `packages/app/src/ui/brigade.ts`, `brigade.test.ts`, `theme.css`.

**Interfaces:**
- `BrigadeUnit` gains `upgrades?: UpgradeTracks` (from `@lions/data`), `BrigadeOptions` gains `owned?: Record<string, Record<string, number>>` (the account's `upgrades`) and `onBuyUpgrade?: (unitId: string, track: string, tier: number, price: number) => void`.
- An AVAILABLE row with tracks renders, per track, a `.rl-brigade__track` line: the track name, a pip per tier (`.rl-brigade__pip`, `data-filled="1"` up to the owned tier), and a `button.rl-brigade__buy-tier` reading `tier N · P` (N = next tier, P = its price; `aria-label` `buy <unit> <track> tier N for P credits`), disabled when the balance is short; a maxed track shows the pips full and `maxed` in place of the control. Locked rows show no tracks. No control without `credits`+`onBuyUpgrade`.
- Tests (jsdom): pips count and fill; the control's text, disabled state, click → `onBuyUpgrade('inf_squad','armour',2,600)`; maxed track; no tracks on a locked row; nothing without an account.
- CSS: only semantic tokens; rem; `--commend` for the control.

### Task 8: Wiring, browser walk, docs

- `main.ts`: pass `upgrades` (from the unit JSON) and `owned` into the brigade's `kdfUnits`/options; `onBuyUpgrade` → `buyUpgrade(loadAccount(storage), …)`, save on `ok`, reload; a bought tier is visible on the next mission through Task 4's pre-pass.
- Browser walk (scratchpad script on the golden-diff helpers, port 5179, this worktree): seed 3000 credits; on `?brigade` buy `inf_squad` armour tier 1; read the account (`upgrades.inf_squad.armour === 1`, balance down by the price), the pip fill; then boot a mission and read the registered type's patched stat via `__lions.sim` (e.g. `sim.unitTypes[typeIdx].hull.armor.front`) against the raw JSON + delta. Screenshots.
- Docs: spec §8 step 3 "landed <date>, tracks in docs/campaign/economy/upgrades.md"; CLAUDE.md brigade-account bullet: one sentence on `applyUpgrades` in `@lions/data` and the three callers; `docs/campaign/README.md` if it lists the account.
- Full gate line, commit.

---

## Self-review

- **Spec coverage (§8 step 3):** schema + whitelist — Task 1; `applyUpgrades` — Task 2 (path deviation recorded above); balance passes — Task 5 (backtest twice, cost curve twice); tracks and prices for the roster — Task 6 from the analyst's doc; tier pips — Task 7; maximum-tier harness run — Task 5. `buyUpgrade` (implied by §4.5's Buy per track) — Task 3; the pre-pass in the app — Task 4.
- **Placeholders:** prices/deltas and the cost factor K are read from the analyst's committed document; Task 8's date is the landing date; Task 7's brief is written after the shell-upgrade merge by design.
- **Type consistency:** `UpgradeTracks`/`applyUpgrades`/`maxTiers`/`nextTierPrice` (Task 2) are what Tasks 4, 5, 7 consume; `buyUpgrade(account, unitId, track, tier, price) → {account, ok}` (Task 3) is what Task 8 calls; `onBuyUpgrade(unitId, track, tier, price)` (Task 7) matches.
