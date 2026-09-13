# Motivation Layer, Step 3 "Earn" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give stars something to buy: a `stars_min` unlock gate, three special units earned by it (one per act, all enablers below the collateral thresholds), an `upgrades_to` slot so a placed force fields the earned unit, a brigade screen that shows every unit and what opens it, and the widened name tables the cumulative roster needs.

**Architecture:** The gate is one more field on `UnlockGate`, read by the same pure `unlockReason` every screen and the runtime already share; stars are summed with integer addition over `campaign.mission_results`. An `upgrades_to` placement is resolved by a pure pre-pass in the sim package (`resolveUpgrades`) that both the app and the playtest harness call before constructing the runtime, so the spawner never consults a gate and there is exactly one implementation. The three units are ordinary content: JSON in `data/units/kdf/`, meshes through the existing pipeline, placements in six missions. The brigade screen is a DOM module fed by the campaign helpers.

**Tech Stack:** TypeScript strict, vitest, ajv JSON Schema, Python cost-curve validator (`tools/validate_balance.py`), Blender pipeline for the meshes (dispatched separately; Task 8 lands it).

**Spec:** `docs/superpowers/specs/2026-09-10-motivation-layer-design.md` §4.6 (star-gated special units), with the unit design in `docs/campaign/special_units/design.md` and the name table design in `docs/campaign/names.md` (both written 2026-09-13, committed by Task 1). Steps 1 and 2 landed as `f383d31` and `15a2b5c`.

## Global Constraints

- `@lions/sim` bans floating point, `Math.*`, division and any RNG draw outside the per-entity streams; every number it writes is an integer. `unlockReason` and `resolveUpgrades` are pure and never touch `Sim`.
- The golden determinism hash `3160666129` (`packages/sim/src/determinism.test.ts:381`) must not move. Nothing here touches combat.
- Dependency direction `app → render → sim`, `data` a leaf.
- **Gates, measured not guessed** (design §2): `breach_team` 12, `scout_shachaf` 30, `apc_kipod` 44 stars. The shipped optimal ladder reaches 12 / 31 / 45 exactly where each unit's act needs it; a ★★ player reaches them at missions 6, 15 and 22; a ★★★ player at 4, 10, 15. The spec's provisional 55 is unreachable (a pure ★★ ceiling is 52) and is retired.
- **Set A, the three enablers**: every weapon's `collateral_risk` sits below both thresholds in `mission.ts` (`STRUCTURAL_COLLATERAL` 0.3, `HEAVY_COLLATERAL` 0.5); no unit raises armour, penetration, rate of fire or APS beyond the shipped roster (armour 700, penetration 1300, rof 800, APS only on `mbt_lavi`). `pnpm balance` cannot move (its targets name six unit ids and never enumerate the roster); `python3 tools/validate_balance.py --units data/units` must pass with all 17 KDF units in band.
- `upgrades_to` is an UPGRADE only: the base unit always fields, the special unit fields when its gate is open; never on a `from_ledger: true` placement (a survivor's veterancy cannot survive a type swap) — the data gate refuses that combination.
- A unit with no mesh and no sprite draws nothing (`SPRITE_MAP`, "art existing is not art drawing"); the three units are not shippable until Task 8 lands their GLBs and `pnpm validate:meshes` passes.
- Player-facing strings say Conduct, never the acronym; UI colour only via `theme.css` tokens; the stripe/star colour is `--commend`.
- Run commands from the repository root. In an EnterWorktree session call git as `/usr/bin/git`, one plain command per call; never `git add -A`; never `git stash`; never kill or restart a dev server. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File map

| file | responsibility |
|---|---|
| `data/campaign/names.json`, `docs/campaign/names.md`, `packages/app/src/names.test.ts` | the widened, screened name table (already edited in the worktree) and its tests |
| `docs/campaign/special_units/design.md` | the unit design (already written in the worktree) |
| `data/schemas/unit.schema.json`, `packages/sim/src/unlock.ts` + test | `stars_min` / `UnlockGate.starsMin`, `starsEarned`, `resolveUpgrades` |
| `data/schemas/mission.schema.json`, `tools/validate_data.mjs`, `packages/sim/src/mission.ts` (`PlacementJson` only) | `upgrades_to` |
| `packages/app/src/main.ts`, `tools/src/backtest/playtest.ts` | map `stars_min`, call `resolveUpgrades`, gate-opens assertions |
| `packages/app/src/campaign.ts` + test, `packages/app/src/ui/dock-model.ts` + test | `newlyUnlocked` gate kind `stars`; `lockLabel` `★ ≥N` |
| `packages/app/src/ui/brigade.ts` (new) + test, `ui/menu.ts`, `ui/theme.css` | the brigade screen and its menu entry and route |
| `data/units/kdf/breach_team.json`, `scout_shachaf.json`, `apc_kipod.json` | the three units |
| `data/missions/{khan_rafid_3_clearance,deir_amun_2_foothold,qarn_hadid_3_clearance,umm_zeitoun_3_clearance,wadi_halam_4_village,wadi_halam_5_depot}.json` | the six `upgrades_to` sites |
| `art/meshes/breach_team.glb`, `art/meshes/vehicles/scout_shachaf.glb`, `art/meshes/vehicles/apc_kipod.glb` (+ `tools/units/*` changes) | the meshes, produced by the blender-art agent dispatched 2026-09-13, landed by Task 8 |
| spec §4.6, `CLAUDE.md`, `docs/campaign/README.md` | docs |

---

### Task 1: Land the two design inputs

**Files:**
- Already modified in the worktree (uncommitted): `data/campaign/names.json`, `docs/campaign/names.md`, `docs/campaign/special_units/design.md`
- Modify: `data/campaign/names.json` (`kinds.vehicle_roles` gains `"recon"`), `packages/app/src/names.test.ts`

**Interfaces:**
- Produces: the committed table (40 squads, 25 vehicles, 24 tasks) and the design doc; `nameKind` classifies role `recon` as a vehicle.

- [ ] **Step 1: Confirm the inputs are what the two agents left**

Run: `/usr/bin/git status --short` — expected exactly three entries: `M data/campaign/names.json`, `?? docs/campaign/names.md`, `?? docs/campaign/special_units/design.md`. Anything else in the tree belongs to the blender-art agent (under `art/` or `tools/units/`) and is NOT this task's; leave it.

- [ ] **Step 2: Add the scout's role to the vehicle kinds**

In `data/campaign/names.json`, change `"vehicle_roles": ["apc", "ifv", "mbt"]` to `"vehicle_roles": ["apc", "ifv", "mbt", "recon"]`. (`validate_data.mjs`'s cross-check requires every listed role to exist in `data/units/kdf`; `recon` will exist once Task 5 adds `scout_shachaf`, so until then this line makes `pnpm validate:data` FAIL — that is expected, and Task 5 clears it. Run the gate now and record the failure naming `recon`; do not "fix" it here.)

- [ ] **Step 3: Update the name tests to the new table, and add the two design guarantees**

`docs/campaign/names.md` §6 tabulates every replacement. In `packages/app/src/names.test.ts`:
- "names the unnamed in table order": the task name becomes `'Eye One'`.
- "continues from the issued counter and wraps": squad counter 5 → `['Migdal', 'Chatzatz']`; add a case at squad counter **39** → `['Kivun', 'Sela II']` with `issued.squad` 41.
- "wraps a vehicle by cycling the hull": vehicle counter 0, six names → `['1-2 Ayil', '2-1 Gachelet', '2-4 Yated', '4-2 Kardom', '7-2 Mesor', '5-1 Mafuach']`; add a case at vehicle counter **22**, six names → `['1-9 Machsan', '4-9 Metach', '7-9 Mafselet', '2-2 Ayil', '3-1 Gachelet', '3-4 Yated']`, issued 28.
- "reaches for the Roman only past the last digit": `nth(54/79/104)` → `'9-2 Mesor'`, `'9-2 Mesor II'`, `'9-2 Mesor III'` (if the test calls the exported helper differently, keep its shape).
- New: `it('gives sixty-nine vehicles sixty-nine distinct hull numbers')` — assign 69 vehicle entries from counter 0 and assert the set of hull prefixes (`name.split(' ')[0]`) has size 69.
- New: `it('issues the first twenty-four task names across the blocks then down the numbers')` — assert the first six task names are `['Eye One', 'Kite One', 'Lens One', 'Gimbal One', 'Aperture One', 'Spool One']` and the seventh is `'Eye Two'`.
- Also `nameKind({ id: 'scout_shachaf', role: 'recon' }, table)` → `'vehicle'`.

Run: `npx vitest run packages/app/src/names.test.ts` — expected: all pass (the RED for the two new tests is the OLD table; run them once against `git show HEAD:data/campaign/names.json` piped to a temp file if you want the failure on record, otherwise state that they encode §4's measured claims).

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add data/campaign/names.json docs/campaign/names.md docs/campaign/special_units/design.md packages/app/src/names.test.ts
/usr/bin/git commit -m "content(campaign): the screened name table at campaign size, and the special-unit design" -m "Squads 40, vehicles 25 with collision-free hulls, tasks 24 as a callsign-plus-number scheme; every 2026-09-13 entry screened through three Wikipedia probes (docs/campaign/names.md §3). The three star-gated units are docs/campaign/special_units/design.md, set A, gates 12/30/44 fitted to the measured ladder." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The `stars_min` gate

**Files:**
- Modify: `data/schemas/unit.schema.json` (`properties.unlock`)
- Modify: `packages/sim/src/unlock.ts`, `packages/sim/src/index.ts`
- Modify: `packages/app/src/main.ts` (the two `unlock` mapping sites ~600 and ~1960), `tools/src/backtest/playtest.ts` (`unitInfo` ~62–75)
- Modify: `packages/app/src/campaign.ts` (`newlyUnlocked`), `packages/app/src/ui/dock-model.ts` (`lockLabel`)
- Test: `packages/sim/src/unlock.test.ts`, `packages/app/src/campaign.test.ts`, `packages/app/src/ui/dock-model.test.ts`, `packages/app/src/ui/production.test.ts`

**Interfaces:**
- Produces: `UnlockGate.starsMin?: number`; `starsEarned(ledger: LedgerData | undefined): number` (integer sum of `stars` over `campaign.mission_results`, 0 with none); `unlockReason` says `requires N stars (currently M)` when short, checked AFTER the Conduct gate and BEFORE `afterMission`; `newlyUnlocked` gate kind `'stars'`; `lockLabel` renders `★ ≥N` for that sentence; authoring spelling `unlock.stars_min`.

- [ ] **Step 1: Write the failing tests**

`unlock.test.ts`:

```ts
  it('sums earned stars with integer addition and gates on them', () => {
    const ledger = { 'campaign.mission_results': { a: { stars: 2, roe: 90, ticks: 1, lost: 0 }, b: { stars: 3, roe: 90, ticks: 1, lost: 0 } } };
    expect(starsEarned(ledger)).toBe(5);
    expect(starsEarned(undefined)).toBe(0);
    expect(unlockReason({ starsMin: 5 }, ledger)).toBe(null);
    expect(unlockReason({ starsMin: 6 }, ledger)).toBe('requires 6 stars (currently 5)');
    expect(unlockReason({ starsMin: 1 }, {})).toBe('requires 1 star (currently 0)');
  });

  it('reports Conduct before stars, and stars before the mission gate', () => {
    const why = unlockReason({ roeMin: 60, starsMin: 9, afterMission: 'x' }, { 'roe.mission_ratings': { a: 10 } });
    expect(why).toContain('Conduct 60');
    const why2 = unlockReason({ starsMin: 9, afterMission: 'x' }, {});
    expect(why2).toBe('requires 9 stars (currently 0)');
  });
```

`campaign.test.ts`, in the `newlyUnlocked` describe:

```ts
  it('names the stars gate kind when stars opened the unit', () => {
    const units = [{ id: 's', name: 'S', unlock: { starsMin: 2 } }];
    const before = { 'campaign.mission_results': { a: { stars: 1, roe: 90, ticks: 1, lost: 0 } } };
    const after = { 'campaign.mission_results': { a: { stars: 1, roe: 90, ticks: 1, lost: 0 }, b: { stars: 1, roe: 90, ticks: 1, lost: 0 } } };
    expect(newlyUnlocked(units, before, after)).toEqual([{ id: 's', name: 'S', gate: 'stars' }]);
  });
```

`dock-model.test.ts`: `expect(lockLabel('requires 12 stars (currently 4)')).toBe('★ ≥12');` and `production.test.ts`: a locked tile with that reason shows `★ ≥12` and keeps the sentence on its title.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/sim/src/unlock.test.ts packages/app/src/campaign.test.ts packages/app/src/ui/dock-model.test.ts packages/app/src/ui/production.test.ts`
Expected: FAIL — `starsEarned` missing; `starsMin` ignored; gate kind `'mission'`; label `locked`.

- [ ] **Step 3: Implement**

`unit.schema.json`, inside `properties.unlock.properties`:

```json
"stars_min": {
  "type": "integer",
  "minimum": 0,
  "description": "Opens when the campaign's earned stars (the sum of best-of stars over campaign.mission_results, spec 2026-09-10 §4.6) reach this. The three star-gated units carry 12, 30 and 44, fitted to the measured optimal ladder (docs/campaign/special_units/design.md §2)."
}
```

`unlock.ts`:

```ts
export interface UnlockGate {
  roeMin?: number;
  starsMin?: number;
  afterMission?: string;
}

/** Earned stars: the integer sum of each mission's best grade. No division. */
export function starsEarned(ledger: LedgerData | undefined): number {
  const results = ledger?.['campaign.mission_results'];
  if (results === null || typeof results !== 'object') return 0;
  let total = 0;
  for (const k of Object.keys(results as Record<string, { stars?: number }>)) {
    const s = (results as Record<string, { stars?: number }>)[k]?.stars;
    if (typeof s === 'number') total += s;
  }
  return total;
}
```

and in `unlockReason`, after the `roeMin` block and before the `afterMission` block:

```ts
  if (unlock.starsMin !== undefined) {
    const have = starsEarned(ledger);
    if (have < unlock.starsMin) {
      return `requires ${unlock.starsMin} star${unlock.starsMin === 1 ? '' : 's'} (currently ${have})`;
    }
  }
```

Export `starsEarned` from `index.ts` beside `unlockReason`. In `main.ts` both mapping sites and in `playtest.ts`'s `unitInfo`, extend the cast type with `stars_min?: number` and the mapped object with `starsMin: unlock.stars_min`. In `campaign.ts` `newlyUnlocked`, the gate kind becomes `u.unlock?.roeMin !== undefined ? 'conduct' : u.unlock?.starsMin !== undefined ? 'stars' : 'mission'` and the return type `'conduct' | 'stars' | 'mission'`; in `main.ts` where the unlocked strings are built, the `stars` kind renders `${starsEarned(updatedLedger)} stars: ${name} available`. In `dock-model.ts`:

```ts
export function lockLabel(reason: string): string {
  const roe = /^requires campaign Conduct (\d+)/.exec(reason);
  if (roe !== null) return `Conduct ≥${roe[1]}`;
  const stars = /^requires (\d+) stars? \(/.exec(reason);
  if (stars !== null) return `★ ≥${stars[1]}`;
  return 'locked';
}
```

- [ ] **Step 4: Run the tests and gates**

Run: `npx vitest run packages/sim packages/app && pnpm validate:data && pnpm typecheck && pnpm lint && pnpm test:determinism`
Expected: pass (the `recon` role failure from Task 1 persists in `validate:data` until Task 5 — record it, it is the only expected red).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add data/schemas/unit.schema.json packages/sim/src/unlock.ts packages/sim/src/unlock.test.ts packages/sim/src/index.ts packages/app/src/main.ts tools/src/backtest/playtest.ts packages/app/src/campaign.ts packages/app/src/campaign.test.ts packages/app/src/ui/dock-model.ts packages/app/src/ui/dock-model.test.ts packages/app/src/ui/production.test.ts
/usr/bin/git commit -m "feat(sim,app): unlock.stars_min -- earned stars open a unit" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `upgrades_to`, resolved once, before the runtime

**Files:**
- Modify: `data/schemas/mission.schema.json` (`starting_force.items.properties`), `tools/validate_data.mjs`
- Modify: `packages/sim/src/mission.ts` (`PlacementJson` only), `packages/sim/src/unlock.ts`, `packages/sim/src/index.ts`
- Modify: `packages/app/src/main.ts` (before `new MissionRuntime`), `tools/src/backtest/playtest.ts` (`run()` before `new MissionRuntime`)
- Test: `packages/sim/src/unlock.test.ts`

**Interfaces:**
- Produces: `PlacementJson.upgrades_to?: string`; `resolveUpgrades(mission: MissionJson, ledger: LedgerData | undefined, unlockOf: (unitId: string) => UnlockGate | undefined): MissionJson` — pure; returns a shallow copy whose `starting_force` entries with an open `upgrades_to` gate have `unit` replaced by the upgrade id and `upgrades_to` removed; closed gates and entries without the field are untouched; the input is never mutated. The runtime never sees `upgrades_to`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('resolveUpgrades', () => {
  const gates: Record<string, UnlockGate | undefined> = { breach_team: { starsMin: 12 } };
  const unlockOf = (id: string): UnlockGate | undefined => gates[id];
  const mission = {
    id: 'm', starting_force: [
      { unit: 'inf_squad', count: 1, at: [1, 1], upgrades_to: 'breach_team' },
      { unit: 'mbt_lavi', count: 1, at: [2, 2] },
    ],
  } as unknown as MissionJson;

  it('fields the base unit while the gate is closed', () => {
    const out = resolveUpgrades(mission, {}, unlockOf);
    expect(out.starting_force[0].unit).toBe('inf_squad');
    expect('upgrades_to' in out.starting_force[0]).toBe(false);
  });

  it('fields the upgrade once the gate is open, and never mutates the input', () => {
    const ledger = { 'campaign.mission_results': { a: { stars: 3, roe: 90, ticks: 1, lost: 0 }, b: { stars: 3, roe: 90, ticks: 1, lost: 0 }, c: { stars: 3, roe: 90, ticks: 1, lost: 0 }, d: { stars: 3, roe: 90, ticks: 1, lost: 0 } } };
    const out = resolveUpgrades(mission, ledger, unlockOf);
    expect(out.starting_force[0].unit).toBe('breach_team');
    expect(out.starting_force[1].unit).toBe('mbt_lavi');
    expect(mission.starting_force[0].unit).toBe('inf_squad');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/sim/src/unlock.test.ts -t resolveUpgrades`
Expected: FAIL — `resolveUpgrades` is not exported.

- [ ] **Step 3: Implement**

`PlacementJson` (mission.ts): add
```ts
  /** The unit this placement fields INSTEAD when that unit's `unlock` is open — an
   *  upgrade only, never a downgrade, resolved by `resolveUpgrades` before the runtime
   *  is built (the spawner never consults a gate). Refused beside `from_ledger`. */
  upgrades_to?: string;
```

`unlock.ts`:

```ts
import type { LedgerData, MissionJson, PlacementJson } from './mission';

/**
 * Field the earned unit where a placement offers one (spec §4.6, `upgrades_to`). Pure and
 * called ONCE, by the app and by the playtest harness, before `new MissionRuntime` -- so
 * the runtime never learns a gate exists (spawnPlacement stays gate-blind on purpose: the
 * Wadi Halam V D9 hole is a separate decision) and both callers share one implementation.
 */
export function resolveUpgrades(
  mission: MissionJson,
  ledger: LedgerData | undefined,
  unlockOf: (unitId: string) => UnlockGate | undefined
): MissionJson {
  const force = (mission.starting_force ?? []).map((p: PlacementJson) => {
    if (p.upgrades_to === undefined) return p;
    const { upgrades_to, ...rest } = p;
    if (unlockReason(unlockOf(upgrades_to), ledger) === null) return { ...rest, unit: upgrades_to };
    return rest;
  });
  return { ...mission, starting_force: force };
}
```

(`MissionJson.starting_force`'s exact type name may differ; match it.) Export from `index.ts`.

`mission.schema.json` `starting_force.items.properties`:

```json
"upgrades_to": {
  "type": "string",
  "description": "Field this unit instead when its unlock is open -- an upgrade only, never a downgrade (spec 2026-09-10 §4.6). Resolved before the runtime is built; the spawner never consults a gate. Not allowed beside from_ledger: a survivor's veterancy cannot survive a type swap."
}
```

`validate_data.mjs`, in the mission cross-checks: for every `starting_force` entry with `upgrades_to`, fail if `from_ledger === true` (`"<file>: <unit> upgrades_to <target> on a from_ledger placement -- a survivor cannot change type"`), fail if the target is not a KDF unit id, and fail if the target declares no `unlock` (`"… upgrades_to <target>, which has no unlock -- an upgrade with no gate is a free unit"`).

`main.ts`: where the mission JSON is handed to `new MissionRuntime(sim, mission, …)`, pass `resolveUpgrades(mission, ledger, (id) => unitInfoUnlock(id))` where the unlock lookup reuses the same mapping the `unitInfo` builder does (extract that mapping into a small `kdfUnlockGate(u)` helper if it is not one already — the whole-branch review of step 1 asked for it). Note `getMission()` and every other reader of `mission` (briefing, debrief, `broughtFor`) keep the ORIGINAL JSON; only the runtime gets the resolved copy, and `broughtFor` must be given the resolved copy too so the deploy panel names what actually fields — pass it there as well. `playtest.ts` `run()`: same call before `new MissionRuntime`, using its `unitInfo` mapping for the gate.

- [ ] **Step 4: Run the tests and gates**

Run: `npx vitest run packages/sim && pnpm validate:data && pnpm playtest && pnpm typecheck && pnpm lint && pnpm test:determinism`
Expected: pass; `pnpm playtest` byte-identical (no mission carries `upgrades_to` yet).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add data/schemas/mission.schema.json tools/validate_data.mjs packages/sim/src/mission.ts packages/sim/src/unlock.ts packages/sim/src/unlock.test.ts packages/sim/src/index.ts packages/app/src/main.ts tools/src/backtest/playtest.ts
/usr/bin/git commit -m "feat(sim,app): upgrades_to -- a placed force fields the earned unit, resolved once before the runtime" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The brigade screen

**Files:**
- Create: `packages/app/src/ui/brigade.ts`, `packages/app/src/ui/brigade.test.ts`
- Modify: `packages/app/src/ui/menu.ts` (a `Brigade` entry beside `Campaign`), `packages/app/src/main.ts` (route `?brigade`), `packages/app/src/ui/theme.css`

**Interfaces:**
- Produces: `interface BrigadeOptions { units: { id: string; name: string; role: string; unlock?: UnlockGate }[]; ledger: LedgerData; portrait?: (typeId: string) => string | null; possibleStars: number }`; `showBrigade(host: HTMLElement, opts: BrigadeOptions): void` — a panel headed `The brigade` with `N of P stars` and `Conduct M` (or `no missions rated yet`), then one row per unit (`data-unit`, `data-locked`): portrait or hatch, name, role, and either `available` or the `unlockReason` sentence, with a star gate additionally rendered as `★ N` in the commend colour; locked rows dimmed. Rows sorted: available first, then by the gate that opens soonest.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/brigade.test.ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { showBrigade } from './brigade';

const units = [
  { id: 'inf_squad', name: 'Rifle Squad', role: 'infantry' },
  { id: 'ifv_namer', name: 'Namer IFV', role: 'ifv', unlock: { roeMin: 40 } },
  { id: 'breach_team', name: 'Tzinah Breach Team', role: 'support', unlock: { starsMin: 12 } },
];

describe('showBrigade', () => {
  it('shows the star total and Conduct, and every unit with what opens it', () => {
    const host = document.createElement('div');
    showBrigade(host, {
      units,
      ledger: { 'campaign.mission_results': { a: { stars: 2, roe: 90, ticks: 1, lost: 0 } }, 'roe.mission_ratings': { a: 90 } },
      possibleStars: 78,
    });
    expect(host.querySelector('.rl-brigade__stars')?.textContent).toBe('2 of 78 stars');
    expect(host.querySelector('.rl-brigade__conduct')?.textContent).toBe('Conduct 90');
    const rows = [...host.querySelectorAll('[data-unit]')].map((r) => r.getAttribute('data-unit'));
    expect(rows).toEqual(['inf_squad', 'ifv_namer', 'breach_team']);
    expect(host.querySelector('[data-unit="ifv_namer"]')?.getAttribute('data-locked')).toBe('0');
    expect(host.querySelector('[data-unit="breach_team"] .rl-brigade__why')?.textContent).toBe('requires 12 stars (currently 2)');
    expect(host.querySelector('[data-unit="breach_team"] .rl-brigade__gate')?.textContent).toBe('★ 12');
  });

  it('reads a fresh campaign honestly', () => {
    const host = document.createElement('div');
    showBrigade(host, { units, ledger: {}, possibleStars: 78 });
    expect(host.querySelector('.rl-brigade__stars')?.textContent).toBe('0 of 78 stars');
    expect(host.querySelector('.rl-brigade__conduct')?.textContent).toBe('no missions rated yet');
    expect(host.querySelector('[data-unit="ifv_namer"]')?.getAttribute('data-locked')).toBe('1');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/app/src/ui/brigade.test.ts` — expected: FAIL, module missing.

- [ ] **Step 3: Implement**

`brigade.ts` builds with the `panel()` helper (rank `mission`, title `The brigade`, `mark: true`) and the file's own `el()` helper pattern (`textContent` only); reads `starsEarned` and `unlockReason` from `@lions/sim` and `campaignRoe` from `../campaign`; sorts rows as specified; `data-locked` is `'1'` when `unlockReason` is non-null. Nav: `campaign map` (`?campaign`) and `menu` (`?`). `menu.ts`: `add('Brigade', '?brigade', 'brigade')` after the Campaign entry. `main.ts`: beside the `?campaign` route, `if (params.get('brigade') !== null) { showBrigade(stage, { units: kdfUnits, ledger: loadLedger(), portrait: <the same resolver the HUD's card uses>, possibleStars: 3 * <number of missions in world.json with a non-empty ledger.produces> }); return; }` — compute `possibleStars` from `worldData`'s towns (every campaign mission is 3 stars; the tutorial is off the map) so it stays true when a town is added. `theme.css`: `.rl-brigade__row[data-locked='1'] { opacity: 0.6; }`, `.rl-brigade__gate, .rl-brigade__stars { color: var(--commend); }`, `.rl-brigade__why { color: var(--ink-dim); font-size: var(--t-xs); }`.

- [ ] **Step 4: Run the tests and gates**

Run: `npx vitest run packages/app && pnpm validate:ui && pnpm typecheck && pnpm lint`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/app/src/ui/brigade.ts packages/app/src/ui/brigade.test.ts packages/app/src/ui/menu.ts packages/app/src/main.ts packages/app/src/ui/theme.css
/usr/bin/git commit -m "feat(ui): the brigade screen -- every unit, what opens it, and the stars in hand" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The three units

**Files:**
- Create: `data/units/kdf/breach_team.json`, `data/units/kdf/scout_shachaf.json`, `data/units/kdf/apc_kipod.json` — bodies from `docs/campaign/special_units/design.md` §3, §4, §5 (the draft JSON blocks), verbatim except where the schema rejects a key
- Modify: `docs/campaign/README.md` (the census line naming fourteen KDF units)

**Interfaces:**
- Produces: three KDF units with `"unlock": { "stars_min": 12 | 30 | 44 }`, roles `support` / `recon` / `apc`, ids exactly `breach_team`, `scout_shachaf`, `apc_kipod` (the GLB file names Task 8 lands).

- [ ] **Step 1: Write the three files** from the design doc's blocks. Non-negotiables to check against the doc: every weapon `collateral_risk` < 0.3; armour ≤ 700, penetration ≤ 1300, rof ≤ 800, no `aps`; costs 306 / 410 / 562 logistics; the `name` fields `Tzinah Breach Team`, `Shachaf Scout Car`, `Kipod Screen Carrier`.

- [ ] **Step 2: Gates**

Run: `pnpm validate:data` (the `recon` failure from Task 1 clears now) and `python3 tools/validate_balance.py --units data/units` — expected: 32 units in band (the design measured +1.1% / +1.5% / −1.5% for the three). Then `pnpm balance` — expected unchanged (its targets never enumerate the roster; record the five lines).

- [ ] **Step 3: Commit**

```bash
/usr/bin/git add data/units/kdf/breach_team.json data/units/kdf/scout_shachaf.json data/units/kdf/apc_kipod.json docs/campaign/README.md
/usr/bin/git commit -m "content(units): the three star-gated units -- Tzinah, Shachaf, Kipod" -m "Set A of docs/campaign/special_units/design.md: three enablers below both collateral thresholds, gates 12/30/44. Meshes land separately." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The six placements, re-measured

**Files:**
- Modify: `data/missions/khan_rafid_3_clearance.json`, `deir_amun_2_foothold.json` (add `{ "unit": "inf_squad", "count": 1, "at": …, "upgrades_to": "breach_team" }` at a start tile beside the existing force), `qarn_hadid_3_clearance.json`, `umm_zeitoun_3_clearance.json` (add `{ "unit": "jeep_shoded", "count": 1, "at": …, "upgrades_to": "scout_shachaf" }`), `wadi_halam_4_village.json`, `wadi_halam_5_depot.json` (add `"upgrades_to": "apc_kipod"` to the EXISTING fresh `jeep_shoded ×1` entry)
- Modify: `tools/src/backtest/playtest.ts` only if a plan must be re-pinned

**Interfaces:**
- Consumes: `upgrades_to` (Task 3), the units (Task 5).

- [ ] **Step 1: Author the six sites.** For the four NEW placements pick an `at` tile adjacent to the mission's existing player start (read the mission's `starting_force` and the map's rows; a placement of count 1 occupies one tile; `walk_mission.ts` per `docs/campaign/README.md` prints the world if in doubt).

- [ ] **Step 2: Re-measure.** Run `pnpm validate:data && pnpm playtest`. Under the harness's `{}` and chained ledgers the Marj chain reaches 12 stars only at Khan Rafid I (mission 6) and Deir Amun II is mission 8, so `deir_amun_2_foothold`'s slot OPENS in the chained run and fields a breach team there; `khan_rafid_3_clearance` (mission 8 of 11? — check the chain order in the harness) likewise; the Sur chain reaches 30 at Umm Zeitoun II, so `umm_zeitoun_3_clearance`'s slot opens and `qarn_hadid_3_clearance`'s does not; the Naharin chain reaches 44 at Wadi Halam IV, so V's slot opens. Record every line whose result, stars, time or `roster out` moved. Stars must not fall below the pinned expectation anywhere; if a plan LOSES because a new fresh unit changed a fight, that is a content finding — re-pin nothing, report it, and the controller rules.

- [ ] **Step 3: Commit**

```bash
/usr/bin/git add data/missions/khan_rafid_3_clearance.json data/missions/deir_amun_2_foothold.json data/missions/qarn_hadid_3_clearance.json data/missions/umm_zeitoun_3_clearance.json data/missions/wadi_halam_4_village.json data/missions/wadi_halam_5_depot.json tools/src/backtest/playtest.ts
/usr/bin/git commit -m "content(missions): six upgrades_to sites -- where the earned units field" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The harness proves the gates open where the ladder says

**Files:**
- Modify: `tools/src/backtest/playtest.ts`

**Interfaces:**
- Consumes: the chained ledgers (`led…` values) the harness already threads; `unlockReason`, `starsEarned`.

- [ ] **Step 1: Add the assertions.** After the Marj chain's last `run(...)`: assert `starsEarned(ledMarjLast) >= 12` and `unlockReason({ starsMin: 12 }, ledMarjLast) === null`, printing `gate breach_team: OPEN at <stars> stars`; after the Sur chain: `starsMin: 30`; after the Naharin chain: `starsMin: 44`. Also assert the gate is CLOSED one mission earlier than the design says it opens (Marj: after mission 5; Sur: after mission 14; Naharin: after mission 21), so a future re-flag that hands stars out early goes red. `process.exitCode = 1` with a `FAILED` line on any miss, the same shape as the star assertion.

- [ ] **Step 2: Prove it can fail.** Temporarily set the Marj check to `starsMin: 13`; run; expect a FAILED line and exit 1; revert.

- [ ] **Step 3: Commit**

```bash
/usr/bin/git add tools/src/backtest/playtest.ts
/usr/bin/git commit -m "test(playtest): the three star gates open exactly where the measured ladder says" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Land the meshes

**Files:**
- Add (produced by the blender-art agent dispatched 2026-09-13, left uncommitted in this worktree): `art/meshes/breach_team.glb`, `art/meshes/vehicles/scout_shachaf.glb`, `art/meshes/vehicles/apc_kipod.glb`, any `.blend` sources under `art/`, and any `tools/units/kit.py` / `rig.py` changes

**Interfaces:**
- Consumes: the GLB file names = the unit ids (Task 5).

- [ ] **Step 1: Confirm the art is present and the gate passes.** `ls art/meshes/breach_team.glb art/meshes/vehicles/scout_shachaf.glb art/meshes/vehicles/apc_kipod.glb`; read `.superpowers/queue/special-units-art-report.md`; run `pnpm validate:meshes` (needs Blender; if it is not on this machine, run what CI runs — `python3 tools/validate_mesh_assets.py` — and record the exact failure if it cannot render; do not skip). If the agent reported BLOCKED, stop this task and report BLOCKED with its reason: the units cannot ship without art.

- [ ] **Step 2: See them draw.** Build this worktree (`vite build` into a temp outDir), seed a ledger with 12 stars (`campaign.mission_results` with six 2-star entries), open `?brigade` — the Tzinah row reads `available` — then load `?mission=khan_rafid_3_clearance`, deploy, and confirm a breach team fields at the `upgrades_to` slot and draws as a mesh with its own silhouette; screenshot. Repeat for the Kipod at 44 stars on `wadi_halam_5_depot`. If no browser is available, report the build result and the outstanding look.

- [ ] **Step 3: Commit** the art and any `tools/units` changes with explicit paths (never `-A`; list what `git status --short` shows under `art/` and `tools/units/` and add exactly those):

```bash
/usr/bin/git commit -m "art(meshes): Tzinah, Shachaf and Kipod through the mesh pipeline" -m "Generated geometry via tools/units (kit.py/rig.py/export_mesh_*.py); gate: pnpm validate:meshes." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Docs and the full gate line

**Files:**
- Modify: `docs/superpowers/specs/2026-09-10-motivation-layer-design.md` §4.6 (gates 12/30/44 measured against the 26-mission ladder; the provisional 8/32/55 sentence replaced; the three units named; `resolveUpgrades` named as the pre-pass), `CLAUDE.md` (the "starting_force never consults a unit's unlock gate" bullet: still true of the spawner by design; `upgrades_to` is the sanctioned path, resolved by `resolveUpgrades` before the runtime; the D9 hole stands), `docs/campaign/README.md` ("Unit availability is gated by campaign ROE rating and completed missions" → add stars)

- [ ] **Step 1: Edit the three documents** as above, one sentence each where possible.
- [ ] **Step 2: Run the full gate line** — `pnpm test && pnpm lint && pnpm typecheck && pnpm validate:data && pnpm validate:ui && pnpm playtest && pnpm test:determinism && python3 tools/validate_balance.py --units data/units` (and `pnpm validate:meshes` where Blender exists) — expected: all green; hash unmoved.
- [ ] **Step 3: Commit**

```bash
/usr/bin/git add docs/superpowers/specs/2026-09-10-motivation-layer-design.md CLAUDE.md docs/campaign/README.md
/usr/bin/git commit -m "docs: the star gates as measured, and upgrades_to as the sanctioned path" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Decisions recorded for the lead (not blocking; from the two design inputs)

- A pure ★ player tops out at 26 stars and never sees the Shachaf (30) or the Kipod (44). That is the design — Conduct is the second score — and it is stated here so it is a decision, not a surprise.
- `heli_peten` ships as `"AH-64 Peten"`, a real platform designation inside the fiction (storyline §2.4 rule 5). Not changed here.
- Nine inherited names (Sela, Barzel, Tzur, Marom, Keshet, Migdal; 1-2 Ayil, 2-1 Gachelet, 2-4 Yated) would not pass the screen applied to the sixty new ones (`docs/campaign/names.md` §3); kept for save stability, flagged.
- The Peten shares the task-number pool with the drones by design ("a task number names the task, not the airframe").
