# Motivation Layer, Step 1 "Surface" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the progression the game already earns visible: a three-tier mission grade stored on the ledger and asserted by CI, a debrief screen, stars and villain cards and the account of the taken on both campaign boards, a "what you brought" panel on the deploy screen, promotion beats and unlock announcements, and the dead Conduct figure on the menu fixed.

**Architecture:** The grade is a pure function in `@lions/sim` (`grade.ts`) so the runtime, the harness and the app compute one answer; the runtime stores it best-of per mission under `campaign.mission_results` in the same produce loop that stores ratings. Everything presentational is app-side: pure helpers in `packages/app/src/campaign.ts` (tested without a DOM) feed two DOM modules, the new `ui/debrief.ts` and the existing boards. Authored copy (tier names, tier lines, villain lines, promotion lines) lives in `data/campaign/commander.json` and `ui/grade-copy.ts`, never in rendering code.

**Tech Stack:** TypeScript strict, vitest (jsdom for UI tests), JSON Schema via ajv in `tools/validate_data.mjs`, pnpm workspace. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-10-motivation-layer-design.md` (§4.1–§4.5 and §5–§7 are this plan; §4.6–§4.8 are steps 2 and 3, separate plans).

## Global Constraints

- `@lions/sim` bans floating point: every number written by the sim in this plan is an integer, best-of is `max` and lexicographic comparison, no division anywhere in `packages/sim`.
- Dependency direction is `app → render → sim`, `data` a leaf. `grade.ts` imports nothing but a type from `./mission`.
- The player-facing name of the rating is **Conduct**; the acronym ROE never appears in a string the player can see. Ledger keys and identifiers keep `roe`.
- Conduct is a threshold in the grade, never a summed component and never spent. Nothing grades kills, losses or time.
- Tier names, verbatim: **Entered in the log**, **Named in brigade orders**, **Ari'im citation**.
- ★★ floor: `roe.fail_below + 20`, or `70` where no floor is declared.
- UI colour comes only from `theme.css` semantic tokens; `pnpm validate:ui` must stay clean. No hex, no `rgba()`.
- Every mission JSON edit passes `pnpm validate:data`; every sim edit passes `pnpm test:determinism` unchanged (the golden hash `3160666129` in `determinism.test.ts:381` must not move — nothing here touches combat).
- Run all commands from the repository root. Use `/usr/bin/git` by absolute path in an EnterWorktree session (the command hook rejects the wrapped `git`).
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File map

| file | responsibility |
|---|---|
| `packages/sim/src/grade.ts` (new) | `starsFor`, `starRoeFloor`, `betterResult`, the `Stars`/`MissionResult` types. Pure. |
| `packages/sim/src/mission.ts` | `carries`/`hostages` on `ObjectiveJson`, `hostages_place` on `MissionJson`, `campaign.mission_results` and `civ.hostages_recovered` on `LedgerData`, getters `stars`, `fieldedCount`, `lostByType`, `markedCount`, `promotedCount`, `carries` on `objectiveList`, produce both keys. |
| `packages/sim/src/index.ts` | export the grade module. |
| `data/schemas/mission.schema.json` | `carries`, `hostages`, `hostages_place`. |
| `data/schemas/world.schema.json`, `data/campaign/world.json` | `taken`. |
| `data/schemas/commander.schema.json`, `data/campaign/commander.json` | `promotion_line` on ranks, `name` and `lines` on villains. |
| `data/missions/*.json` | `carries: true` on thirteen secondaries; `hostages: true` and `hostages_place` on Beit Sahwan IV. |
| `tools/src/backtest/playtest.ts` | `expectStar`, stars in the log line. |
| `packages/app/src/campaign.ts` | pure helpers: `campaignSummary`, `townStars`, `regionStars`, `newlyUnlocked`, `promotionAfter`, `villainState`, `hostagesAccount`, `hostagesLine`; commander parsing extended. |
| `packages/app/src/ui/grade-copy.ts` (new) | tier names and tier lines. |
| `packages/app/src/ui/debrief.ts` (new) | `showDebrief`. |
| `packages/app/src/ui/menu.ts` | `showEndScreen` gains an `onDebrief` button. |
| `packages/app/src/ui/worldmap.ts`, `worldmap3d.ts` | stars on pins; `regionCard` gains the villain card; `ledgerLine` gains the account of the taken. |
| `packages/app/src/ui/loading.ts` | the "what you brought" panel. |
| `packages/app/src/ui/theme.css` | `--commend` token, debrief and panel styles. |
| `packages/app/src/main.ts` | wiring only: deductions memory, `DebriefOptions`, deploy panel, menu summary. |

---

### Task 1: The grade as a pure function

**Files:**
- Create: `packages/sim/src/grade.ts`
- Create: `packages/sim/src/grade.test.ts`
- Modify: `packages/sim/src/index.ts`
- Modify: `data/schemas/mission.schema.json` (objective `carries`)

**Interfaces:**
- Produces: `type Stars = 0 | 1 | 2 | 3`; `interface GradedObjective { primary: boolean; carries?: boolean; status: 'active' | 'complete' | 'failed' }`; `starRoeFloor(failBelow: number | undefined): number`; `starsFor(result: 'ongoing' | 'victory' | 'defeat', roe: number, failBelow: number | undefined, objectives: readonly GradedObjective[]): Stars`; `interface MissionResult { stars: Stars; roe: number; ticks: number; lost: number }`; `betterResult(a: MissionResult, b: MissionResult): boolean` (true when `a` should replace `b`).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/sim/src/grade.test.ts
import { describe, expect, it } from 'vitest';
import { betterResult, starRoeFloor, starsFor, type GradedObjective } from './grade';

const prim = (status: GradedObjective['status']): GradedObjective => ({ primary: true, status });
const sec = (status: GradedObjective['status'], carries?: boolean): GradedObjective => ({
  primary: false,
  status,
  ...(carries === undefined ? {} : { carries }),
});

describe('starRoeFloor', () => {
  it('is the mission floor plus twenty, or seventy with no floor', () => {
    expect(starRoeFloor(40)).toBe(60);
    expect(starRoeFloor(45)).toBe(65);
    expect(starRoeFloor(undefined)).toBe(70);
  });
});

describe('starsFor', () => {
  it('gives nothing to anything but a victory', () => {
    expect(starsFor('defeat', 100, undefined, [prim('complete')])).toBe(0);
    expect(starsFor('ongoing', 100, undefined, [prim('complete')])).toBe(0);
  });

  it('enters a victory in the log', () => {
    expect(starsFor('victory', 50, undefined, [prim('complete')])).toBe(1);
  });

  it('names the company in orders when Conduct clears the floor plus twenty', () => {
    expect(starsFor('victory', 60, 40, [prim('complete')])).toBe(2);
    expect(starsFor('victory', 59, 40, [prim('complete')])).toBe(1);
    expect(starsFor('victory', 70, undefined, [prim('complete')])).toBe(2);
  });

  it('cites the company only when every carrying secondary is complete', () => {
    const objs = [prim('complete'), sec('complete', true), sec('active', true)];
    expect(starsFor('victory', 100, undefined, objs)).toBe(2);
    objs[2] = sec('complete', true);
    expect(starsFor('victory', 100, undefined, objs)).toBe(3);
  });

  it('caps at two stars when no secondary carries, however many are complete', () => {
    expect(starsFor('victory', 100, undefined, [prim('complete'), sec('complete')])).toBe(2);
  });

  it('never reaches three stars without two: Conduct is a threshold, not a component', () => {
    expect(starsFor('victory', 60, undefined, [prim('complete'), sec('complete', true)])).toBe(1);
  });
});

describe('betterResult', () => {
  it('prefers more stars, then higher Conduct, then fewer ticks', () => {
    const base = { stars: 2 as const, roe: 80, ticks: 6000, lost: 2 };
    expect(betterResult({ ...base, stars: 3 }, base)).toBe(true);
    expect(betterResult({ ...base, roe: 81 }, base)).toBe(true);
    expect(betterResult({ ...base, ticks: 5999 }, base)).toBe(true);
    expect(betterResult({ ...base, lost: 0 }, base)).toBe(false); // losses never decide
    expect(betterResult(base, base)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/sim/src/grade.test.ts`
Expected: FAIL — `Cannot find module './grade'`.

- [ ] **Step 3: Write the module**

```ts
// packages/sim/src/grade.ts
/**
 * The mission grade (spec 2026-09-10 §4.1): three tiers in the brigade's own paperwork.
 *
 *   ★   Entered in the log        -- victory
 *   ★★  Named in brigade orders   -- and Conduct at or above the mission's floor + 20
 *                                    (70 where no floor is declared)
 *   ★★★ Ari'im citation           -- and every secondary flagged `carries` complete
 *
 * Conduct is a THRESHOLD here and never a component: summing it into a score would turn
 * restraint into points. Losses and time are shown on the debrief and never graded -- the
 * roster already prices a loss as next mission's force. Integer-only, no division, so it
 * can live in this package and be the one answer the runtime, the harness and the app share.
 */
import type { ObjectiveStatus } from './mission';

export type Stars = 0 | 1 | 2 | 3;

export const STAR_ROE_MARGIN = 20;
export const STAR_ROE_DEFAULT = 70;

export interface GradedObjective {
  primary: boolean;
  /** A secondary whose result a later mission reads (`carries: true` in the JSON). */
  carries?: boolean;
  status: ObjectiveStatus;
}

export function starRoeFloor(failBelow: number | undefined): number {
  return failBelow === undefined ? STAR_ROE_DEFAULT : failBelow + STAR_ROE_MARGIN;
}

export function starsFor(
  result: 'ongoing' | 'victory' | 'defeat',
  roe: number,
  failBelow: number | undefined,
  objectives: readonly GradedObjective[]
): Stars {
  if (result !== 'victory') return 0;
  if (roe < starRoeFloor(failBelow)) return 1;
  const carrying = objectives.filter((o) => !o.primary && o.carries === true);
  if (carrying.length === 0) return 2;
  return carrying.every((o) => o.status === 'complete') ? 3 : 2;
}

/** One mission's best result, as the ledger stores it. Every field is an integer. */
export interface MissionResult {
  stars: Stars;
  roe: number;
  /** Sim ticks at the end (20 per second). Shown against `target_minutes`; never graded. */
  ticks: number;
  /** Player units that died. Shown on the debrief; never graded. */
  lost: number;
}

/** Whether `a` should replace `b` as the stored best: more stars, then higher Conduct,
 *  then a faster clock. `lost` is deliberately not consulted. */
export function betterResult(a: MissionResult, b: MissionResult): boolean {
  if (a.stars !== b.stars) return a.stars > b.stars;
  if (a.roe !== b.roe) return a.roe > b.roe;
  return a.ticks < b.ticks;
}
```

Check that `ObjectiveStatus` is exported from `mission.ts` (`grep -n "export type ObjectiveStatus" packages/sim/src/mission.ts`). If it is not, add `export` to its declaration; it is a type-only import so no runtime cycle exists.

- [ ] **Step 4: Export from the package**

In `packages/sim/src/index.ts`, next to the `unlock` export line (line 28):

```ts
export {
  starsFor,
  starRoeFloor,
  betterResult,
  STAR_ROE_MARGIN,
  STAR_ROE_DEFAULT,
  type Stars,
  type MissionResult,
  type GradedObjective,
} from './grade';
```

- [ ] **Step 5: Add `carries` to the objective schema**

In `data/schemas/mission.schema.json`, inside `properties.objectives.items.properties`, after `primary`:

```json
"carries": {
  "type": "boolean",
  "description": "A secondary whose result a later mission reads -- a locate whose target tag reappears as an enemy tag in a later mission that requires intel.marked_positions, or an evacuation that feeds civ.hostages_recovered. The third star (Ari'im citation) needs every carrying secondary complete; a mission with none caps at two stars. Never on a primary."
}
```

And add to the same `items` object, beside `required` and `additionalProperties`:

```json
"if": { "properties": { "carries": { "const": true } }, "required": ["carries"] },
"then": { "properties": { "primary": { "const": false } } }
```

- [ ] **Step 6: Run the tests and the data gate**

Run: `npx vitest run packages/sim/src/grade.test.ts && pnpm validate:data`
Expected: 7 tests pass; `data gate passed`.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add packages/sim/src/grade.ts packages/sim/src/grade.test.ts packages/sim/src/index.ts data/schemas/mission.schema.json
/usr/bin/git commit -m "feat(sim): the mission grade as a pure function" -m "Three tiers, Conduct as a threshold, the third star on carrying secondaries. Integer-only so the runtime, the harness and the app share one answer." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Runtime getters for the grade and the debrief

**Files:**
- Modify: `packages/sim/src/mission.ts` (`ObjectiveJson` ~137, `objectiveList` ~639, `checkEnd` ~1603, class fields ~392–442)
- Test: `packages/sim/src/mission.test.ts`

**Interfaces:**
- Consumes: `starsFor`, `Stars` from Task 1.
- Produces on `MissionRuntime`: `get stars(): Stars`; `get fieldedCount(): number`; `lostByType(): Record<string, number>`; `get markedCount(): number`; `get promotedCount(): number`; `objectiveList[i].carries: boolean`. On `ObjectiveJson`: `carries?: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/sim/src/mission.test.ts` inside the file's top-level scope (after the `'emits only the keys the mission contract declares'` test's `describe` closes, ~line 610), using the file's existing `makeWorld` / `baseMission` helpers and `TICKS_PER_SECOND`:

```ts
describe('the grade and the debrief figures', () => {
  it('reads the live grade: two stars for a clean win with no carrying secondary', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_tank', count: 1, at: [4, 5] }],
        enemy: { garrison: [{ unit: 'm_rpg', count: 1, at: [11, 5], facing_deg: 180 }] },
      })
    );
    expect(w.runtime.stars).toBe(0); // ongoing
    w.step(90 * TICKS_PER_SECOND);
    expect(w.runtime.result).toBe('victory');
    expect(w.runtime.stars).toBe(2);
  });

  it('counts fielded, lost by type, marked and promoted', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_tank', count: 1, at: [4, 5] }],
        enemy: { garrison: [{ unit: 'm_rpg', count: 1, at: [11, 5], facing_deg: 180 }] },
      })
    );
    expect(w.runtime.fieldedCount).toBe(1);
    w.step(90 * TICKS_PER_SECOND);
    expect(w.runtime.lostByType()).toEqual({});
    expect(w.runtime.promotedCount).toBe(1); // the tank got the kill
    expect(w.runtime.markedCount).toBe(0);
  });

  it('exposes carries on the objective list', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
        objectives: [
          { id: 'hold', type: 'survive_until', primary: true, seconds: 2 },
          { id: 'see', type: 'locate', primary: false, count: 1, carries: true },
        ],
      })
    );
    const list = w.runtime.objectiveList;
    expect(list.find((o) => o.id === 'hold')?.carries).toBe(false);
    expect(list.find((o) => o.id === 'see')?.carries).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/sim/src/mission.test.ts -t "the grade and the debrief figures"`
Expected: FAIL — `stars`, `fieldedCount`, `lostByType`, `promotedCount`, `markedCount` are undefined; `carries` is not on the list item type (typecheck) and `undefined` at runtime.

- [ ] **Step 3: Implement**

In `ObjectiveJson` (after `primary: boolean;`):

```ts
  /** A secondary whose result a later mission reads; the third star needs every one
   *  of these complete. Schema-enforced never on a primary. */
  carries?: boolean;
```

Add the import at the top of `mission.ts`:

```ts
import { betterResult, starsFor, type MissionResult, type Stars } from './grade';
```

(`betterResult` and `MissionResult` are used in Task 3; importing them now keeps that task a pure addition.)

Add a class field beside `roeFailed` (~line 433):

```ts
  /** Survivors that came back a stripe more veteran this mission; set in checkEnd. */
  private promotedValue = 0;
```

In `objectiveList`'s mapped return object add `carries: o.def.carries === true,` and to its declared item type add `carries: boolean;` after `primary: boolean;`.

Add the getters after `get roeScore()` (~line 615):

```ts
  /** The live grade (spec §4.1). 0 until the mission is won. */
  get stars(): Stars {
    return starsFor(
      this.result,
      this.roeScoreValue,
      this.mission.roe?.fail_below,
      this.objectives.map((o) => ({ primary: o.def.primary, carries: o.def.carries, status: o.status }))
    );
  }

  /** Every player unit that ever took the field, dead or alive. Losses in a mission that
   *  builds units cannot be read from the survivor count alone; this can. */
  get fieldedCount(): number {
    return this.playerIds.length;
  }

  /** Player units lost, by type id. Empty when nobody died. */
  lostByType(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of this.playerIds) {
      if (this.sim.state.alive[id] !== 0) continue;
      const typeId = this.sim.unitTypes[this.sim.state.typeIdx[id]].id;
      out[typeId] = (out[typeId] ?? 0) + 1;
    }
    return out;
  }

  /** Placement tags this mission's recon identified. */
  get markedCount(): number {
    return this.markedThisMission.size;
  }

  /** Survivors that gained a stripe at the end. 0 until the mission ends. */
  get promotedCount(): number {
    return this.promotedValue;
  }
```

In `checkEnd`, inside the survivor loop, replace `if ((this.kills.get(id) ?? 0) > 0 && vet < 3) vet++;` with:

```ts
      if ((this.kills.get(id) ?? 0) > 0 && vet < 3) {
        vet++;
        this.promotedValue++;
      }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/sim/src/mission.test.ts && pnpm typecheck`
Expected: all pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/sim/src/mission.ts packages/sim/src/mission.test.ts
/usr/bin/git commit -m "feat(sim): the runtime reports its grade, fielded, lost, marked and promoted" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `campaign.mission_results` on the ledger

**Files:**
- Modify: `packages/sim/src/mission.ts` (`LedgerData` ~89–135, `checkEnd` produce loop ~1625–1641)
- Test: `packages/sim/src/mission.test.ts`

**Interfaces:**
- Consumes: `MissionResult`, `betterResult` (Task 1), `stars` getter (Task 2).
- Produces: `LedgerData['campaign.mission_results']?: Record<string, MissionResult>`, written when the mission's `produces` lists it, best-of, sorted keys.

- [ ] **Step 1: Write the failing tests**

Append to the `'the grade and the debrief figures'` describe from Task 2:

```ts
  it('produces campaign.mission_results best-of, keyed by mission, all integers', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_tank', count: 1, at: [4, 5] }],
        enemy: { garrison: [{ unit: 'm_rpg', count: 1, at: [11, 5], facing_deg: 180 }] },
        ledger: { requires: [], produces: ['campaign.mission_results'] },
      }),
      // A prior, better run of this same mission and a run of another mission.
      {
        ledger: {
          'campaign.mission_results': {
            zzz_other: { stars: 1, roe: 50, ticks: 100, lost: 0 },
            test_mission: { stars: 3, roe: 100, ticks: 10, lost: 0 },
          },
        },
      }
    );
    const { mission } = w.step(90 * TICKS_PER_SECOND);
    const end = mission.find((e) => e.kind === 'missionEnd');
    if (end?.kind !== 'missionEnd') throw new Error('no end');
    const results = end.ledger['campaign.mission_results'] as Record<string, unknown>;
    // The prior three-star run stays; this two-star run does not replace it.
    expect(results.test_mission).toEqual({ stars: 3, roe: 100, ticks: 10, lost: 0 });
    expect(Object.keys(results)).toEqual(['test_mission', 'zzz_other']); // sorted
  });

  it('stores this run when it beats the prior, with the real tick and loss counts', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_tank', count: 1, at: [4, 5] }],
        enemy: { garrison: [{ unit: 'm_rpg', count: 1, at: [11, 5], facing_deg: 180 }] },
        ledger: { requires: [], produces: ['campaign.mission_results'] },
      }),
      { ledger: { 'campaign.mission_results': { test_mission: { stars: 1, roe: 50, ticks: 100, lost: 3 } } } }
    );
    const { mission } = w.step(90 * TICKS_PER_SECOND);
    const end = mission.find((e) => e.kind === 'missionEnd');
    if (end?.kind !== 'missionEnd') throw new Error('no end');
    const r = (end.ledger['campaign.mission_results'] as Record<string, { stars: number; roe: number; ticks: number; lost: number }>).test_mission;
    expect(r.stars).toBe(2);
    expect(r.roe).toBe(100);
    expect(r.lost).toBe(0);
    expect(Number.isInteger(r.ticks) && r.ticks > 0 && r.ticks <= 90 * TICKS_PER_SECOND).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/sim/src/mission.test.ts -t "mission_results"`
Expected: FAIL — `results` is `undefined`.

- [ ] **Step 3: Implement**

In `LedgerData`, after `'campaign.completed_missions'?: string[];`:

```ts
  /**
   * Each mission's best grade (spec 2026-09-10 §4.1), keyed by mission id. Best-of by
   * `betterResult` (stars, then Conduct, then a faster clock) so a replay can only help,
   * exactly the property `roe.mission_ratings` has. Every field is an integer; the app
   * sums stars for the board and the star-gated unlocks with integer addition.
   */
  'campaign.mission_results'?: Record<string, MissionResult>;
```

In `checkEnd`, after the `ratings` object is built and before `const produced: LedgerData = {};`:

```ts
    // The grade, best-of per mission, sorted keys -- the same shape and the same
    // reasoning as `ratings` above. `this.stars` reads `resultValue`, set above.
    let lostCount = 0;
    for (const id of this.playerIds) if (this.sim.state.alive[id] === 0) lostCount++;
    const thisResult: MissionResult = { stars: this.stars, roe: roeRating, ticks: tick, lost: lostCount };
    const prevResults = this.ctx.ledger?.['campaign.mission_results'];
    const mergedResults: Record<string, MissionResult> = {};
    if (prevResults !== null && typeof prevResults === 'object') {
      const prior = prevResults as Record<string, MissionResult>;
      for (const k of Object.keys(prior)) mergedResults[k] = prior[k];
    }
    const priorResult = mergedResults[this.mission.id];
    if (priorResult === undefined || betterResult(thisResult, priorResult)) {
      mergedResults[this.mission.id] = thisResult;
    }
    const results: Record<string, MissionResult> = {};
    for (const k of Object.keys(mergedResults).sort()) results[k] = mergedResults[k];
```

In the produce loop, after the `'roe.mission_ratings'` branch:

```ts
      else if (key === 'campaign.mission_results') produced[key] = results;
```

- [ ] **Step 4: Run the sim suite and the determinism canary**

Run: `npx vitest run packages/sim && pnpm test:determinism`
Expected: all pass; the golden hash is unchanged (this code runs only in `MissionRuntime`, which the golden replay never builds).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/sim/src/mission.ts packages/sim/src/mission.test.ts
/usr/bin/git commit -m "feat(sim): campaign.mission_results -- each mission's best grade on the ledger" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The harness asserts the grade

**Files:**
- Modify: `tools/src/backtest/playtest.ts:9–102`

**Interfaces:**
- Consumes: `rt.stars` (Task 2).
- Produces: `run(id, plan, ledger, expect, label, expectStar)` where `expectStar: 0 | 1 | 2 | 3` defaults to `2` for an expected victory and `0` otherwise; the log line gains `stars N`.

- [ ] **Step 1: Make the harness fail on a grade shortfall**

This harness is a CLI, not a vitest spec; its "test" is its own exit code. Change the signature:

```ts
function run(
  id: keyof typeof missions,
  plan: Plan,
  ledger: LedgerData = {},
  expect: 'victory' | 'defeat' | 'ongoing' = 'victory',
  label: string = id,
  /** The grade the plan must reach (spec §4.1). Every winning plan clears ★★ under the
   *  rule -- the lowest Conduct any plan posts is 75 -- and a control that loses gets 0
   *  by construction, so the defaults assert the gradient with no per-plan edits. Pass 3
   *  only where the plan completes every carrying secondary. */
  expectStar: 0 | 1 | 2 | 3 = expect === 'victory' ? 2 : 0
): LedgerData {
```

Change the log line to include the grade:

```ts
  console.log(
    `${label}: ${rt.result.toUpperCase()} in ${mins} min, ROE ${rt.roeScore}, stars ${rt.stars}, ` +
      `objectives ${rt.objectiveList.map((o) => `${o.id}=${o.status[0]}`).join(' ')}, ` +
      `roster out ${(produced['roster.surviving_units'] ?? []).length}`
  );
```

After the existing `if (rt.result !== expect) { ... }` block:

```ts
  if (rt.stars < expectStar) {
    console.error(`${label}: FAILED — expected ${expectStar} star(s), got ${rt.stars}`);
    process.exitCode = 1;
  }
```

- [ ] **Step 2: Prove it can fail, then that it passes**

Run: `pnpm playtest 2>&1 | grep -c "stars"` — expected: one line per plan, every winning plan `stars 2` (no mission has a `carries` flag yet, so nobody can reach 3), exit 0.

Then temporarily change the default to `expect === 'victory' ? 3 : 0`, run `pnpm playtest; echo exit $?` and confirm every winning plan prints a FAILED line and the exit code is 1. Revert the default to 2. Do not commit the temporary change.

- [ ] **Step 3: Commit**

```bash
/usr/bin/git add tools/src/backtest/playtest.ts
/usr/bin/git commit -m "test(playtest): every winning plan must earn two stars; a control earns none" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `carries` on the secondaries that carry

**Files:**
- Modify: `data/missions/beit_sahwan_1_recon.json`, `beit_sahwan_3_clearance.json`, `khan_rafid_1_recon.json`, `deir_amun_1_recon.json`, `qarn_hadid_1_recon.json`, `umm_zeitoun_1_recon.json`, `umm_zeitoun_3_clearance.json`
- Modify: `tools/src/backtest/playtest.ts` (the `run(...)` calls for those missions)
- Modify: `docs/campaign/README.md` (one bullet)

**Interfaces:**
- Consumes: the `carries` schema field (Task 1), `expectStar` (Task 4).

A secondary carries when its `locate` target tag reappears as an enemy `tag` in a later mission of the same town that lists `intel.marked_positions` in `ledger.requires`. Measured 2026-09-11 from the mission JSON, these are the thirteen:

| mission | objective id | target tag | read by |
|---|---|---|---|
| beit_sahwan_1_recon | hvt_seen | bs_hvt_atgm | beit_sahwan_3_clearance |
| beit_sahwan_1_recon | find_the_column | bs_track_north | beit_sahwan_4_subterranean |
| beit_sahwan_3_clearance | picture | (count 4, marks whatever it sees) | beit_sahwan_4_subterranean |
| khan_rafid_1_recon | find_the_west_lane | kr_lane_west | khan_rafid_2_foothold |
| khan_rafid_1_recon | find_the_east_lane | kr_lane_east | khan_rafid_2_foothold, _3 |
| khan_rafid_1_recon | find_the_block_commander | kr_hvt_ward | khan_rafid_2_foothold, _3 |
| deir_amun_1_recon | find_the_chief | da_hvt_engineer | deir_amun_2_foothold, _3 |
| deir_amun_1_recon | find_the_gap_gun | da_watch_gap | deir_amun_2_foothold |
| qarn_hadid_1_recon | find_the_tube, find_the_bench_post, find_the_ditch_gun | qh_hvt_tube, qh_watch_bench, qh_atgm_ditch | qarn_hadid_2_foothold, _3 |
| umm_zeitoun_1_recon | find_the_missile_team | uz_manpad_basin | umm_zeitoun_2_buildup, _3 |
| umm_zeitoun_3_clearance | find_adhal | uz_hvt_lantern | umm_zeitoun_4_clearance |

Not flagged, on purpose: the three `screen_out` / `no_bleed` `survive_until` secondaries (the passive control completes them), every `capture` / `eliminate_hvt` / `raze` / `collapse` secondary (nothing later reads them), `beit_sahwan_4_subterranean`'s two locates and `qarn_hadid_3_clearance`'s (last mission of the town), and `wadi_halam_3_counterraid`'s `mark_hides` (Wadi Halam IV requires only the roster). Those missions cap at ★★ until `mission-author` gives them a carrying secondary; record that in the README bullet below.

- [ ] **Step 1: Flag the thirteen objectives**

In each listed mission JSON, add `"carries": true` to the named objective, after its `"primary": false` line. Example for `beit_sahwan_1_recon.json`:

```json
{
  "id": "hvt_seen",
  "type": "locate",
  "primary": false,
  "carries": true,
  "target": "bs_hvt_atgm",
  "text": "…unchanged…"
}
```

- [ ] **Step 2: Validate and measure**

Run: `pnpm validate:data && pnpm playtest 2>&1 | grep -E "^(beit_sahwan_1_recon|beit_sahwan_3_clearance|khan_rafid_1_recon|deir_amun_1_recon|qarn_hadid_1_recon|umm_zeitoun_1_recon|umm_zeitoun_3_clearance):"`
Expected: the data gate passes (the `if/then` accepts every flag because each is on a `primary: false` objective). Record which of the seven winning plans now print `stars 3`. On 2026-09-10 the `beit_sahwan_3_clearance` plan completed all its secondaries and `beit_sahwan_1_recon`, `umm_zeitoun_1_recon` and `umm_zeitoun_3_clearance` did not; the four newer towns were not measured.

- [ ] **Step 3: Pin the three-star plans**

For every plan that printed `stars 3`, pass `3` as the sixth argument of its `run(...)` call. Where a call passes fewer than five arguments, spell the defaults out: `run('beit_sahwan_3_clearance', plan, ledger, 'victory', 'beit_sahwan_3_clearance', 3)`. Do not change any plan's orders in this task: a plan that earns two stars is a content finding for `mission-author`, not a harness bug.

- [ ] **Step 4: Record the content finding**

In `docs/campaign/README.md`, after the `**ROE is the second score, and the player calls it Conduct.**` bullet, add:

```markdown
- **The third star is the carrying secondaries.** `carries: true` marks a secondary a later
  mission reads (spec 2026-09-10 §4.1); the Ari'im citation needs every one complete, and a
  mission with none caps at two stars. As of 2026-09-11 that is Beit Sahwan II and IV, every
  Tel Marum mission, Umm Zeitoun II and IV, Wadi Halam I–V, and the last mission of every
  other town. Giving one of them a third star means authoring a secondary something later
  reads, never flagging a `survive_until` clock. `pnpm playtest` prints each plan's stars and
  asserts the authored expectation.
```

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add data/missions tools/src/backtest/playtest.ts docs/campaign/README.md
/usr/bin/git commit -m "content(missions): the thirteen secondaries that carry, and the plans that cite" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The account of the taken, sim and data

**Files:**
- Modify: `data/schemas/mission.schema.json` (objective `hostages`, root `hostages_place`)
- Modify: `data/schemas/world.schema.json`, `data/campaign/world.json` (`taken`)
- Modify: `packages/sim/src/mission.ts` (`ObjectiveJson`, `MissionJson`, `LedgerData`, produce loop)
- Modify: `data/missions/beit_sahwan_4_subterranean.json`
- Test: `packages/sim/src/mission.test.ts`

**Interfaces:**
- Produces: `ObjectiveJson.hostages?: boolean`; `MissionJson.hostages_place?: string`; `LedgerData['civ.hostages_recovered']?: Record<string, number>` (per mission, best-of `max`); world JSON root `taken: 19`.

- [ ] **Step 1: Write the failing test**

Append to the `'the grade and the debrief figures'` describe:

```ts
  it('writes this mission\'s recovered hostages best-of, and only from flagged evacuations', () => {
    // A two-second survive primary wins the mission; the flagged evacuation never completes
    // (no civilians on this map), so the count written is 0 -- and the prior 2 is kept.
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
        objectives: [
          { id: 'hold', type: 'survive_until', primary: true, seconds: 2 },
          { id: 'out', type: 'evacuate_before', primary: false, target: 'refuge', count: 2, seconds: 300, hostages: true },
        ],
        ledger: { requires: [], produces: ['civ.hostages_recovered'] },
      }),
      { ledger: { 'civ.hostages_recovered': { test_mission: 2 } } }
    );
    const { mission } = w.step(4 * TICKS_PER_SECOND);
    const end = mission.find((e) => e.kind === 'missionEnd');
    if (end?.kind !== 'missionEnd') throw new Error('no end');
    expect(end.ledger['civ.hostages_recovered']).toEqual({ test_mission: 2 });
  });
```

If `baseMission`'s map has no zone named `refuge`, use whichever zone name the file's other `evacuate_before` tests use (search the file for `type: 'evacuate_before'`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/sim/src/mission.test.ts -t "recovered hostages"`
Expected: FAIL — the key is `undefined` (unknown keys are produced by nothing).

- [ ] **Step 3: Implement**

`ObjectiveJson`, after `carries`:

```ts
  /** This evacuation brings back people the enemy TOOK (spec §4.4). On completion its
   *  `count` is written to `civ.hostages_recovered` for this mission. */
  hostages?: boolean;
```

`MissionJson`, after `name?: string;`:

```ts
  /** Where the taken came back, for the board's line "N came back at <place>" (≤ 40 chars). */
  hostages_place?: string;
```

`LedgerData`, after `'campaign.mission_results'`:

```ts
  /** People the enemy took who a mission brought back, keyed by mission id, best-of (max)
   *  so a replay never double-counts. The app sums it and subtracts from world.json's
   *  `taken` for the board's account of the taken (spec §4.4). */
  'civ.hostages_recovered'?: Record<string, number>;
```

In `checkEnd`, next to the `results` block:

```ts
    let recoveredHere = 0;
    for (const o of this.objectives) {
      if (o.def.hostages === true && o.status === 'complete') recoveredHere += o.def.count ?? 1;
    }
    const prevRecovered = this.ctx.ledger?.['civ.hostages_recovered'];
    const mergedRecovered: Record<string, number> = {};
    if (prevRecovered !== null && typeof prevRecovered === 'object') {
      const prior = prevRecovered as Record<string, number>;
      for (const k of Object.keys(prior)) mergedRecovered[k] = prior[k];
    }
    const priorRecovered = mergedRecovered[this.mission.id];
    if (typeof priorRecovered !== 'number' || recoveredHere > priorRecovered) {
      mergedRecovered[this.mission.id] = recoveredHere;
    }
    const recovered: Record<string, number> = {};
    for (const k of Object.keys(mergedRecovered).sort()) recovered[k] = mergedRecovered[k];
```

In the produce loop:

```ts
      else if (key === 'civ.hostages_recovered') produced[key] = recovered;
```

- [ ] **Step 4: Schemas and data**

`mission.schema.json`, objective properties, after `carries`:

```json
"hostages": {
  "type": "boolean",
  "description": "This evacuate_before brings back people the enemy took. On completion its count is written to the ledger key civ.hostages_recovered for this mission, and the campaign board's account of the taken moves. Only meaningful on evacuate_before."
}
```

Root properties, after `name`:

```json
"hostages_place": {
  "type": "string",
  "maxLength": 40,
  "description": "Where the taken came back, for the board's line \"N came back at <place>\". Author it on any mission with a hostages evacuation."
}
```

`world.schema.json`, root properties, after `art`:

```json
"taken": {
  "type": "integer",
  "minimum": 0,
  "description": "How many people the enemy took on the first morning (storyline D12). The board subtracts the ledger's civ.hostages_recovered from it."
}
```

`data/campaign/world.json`: add `"taken": 19,` after the `"art"` line.

`data/missions/beit_sahwan_4_subterranean.json`: on the objective whose text is "Get five people out to the collection point before the routes come down", add `"hostages": true`; at the root add `"hostages_place": "the shaft head"`; add `"civ.hostages_recovered"` to `ledger.produces`.

- [ ] **Step 5: Run the gates**

Run: `npx vitest run packages/sim && pnpm validate:data && pnpm playtest 2>&1 | grep beit_sahwan_4`
Expected: all pass; Beit Sahwan IV's plan line is unchanged in result and stars.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add packages/sim/src/mission.ts packages/sim/src/mission.test.ts data/schemas/mission.schema.json data/schemas/world.schema.json data/campaign/world.json data/missions/beit_sahwan_4_subterranean.json
/usr/bin/git commit -m "feat(sim): civ.hostages_recovered -- the account of the taken, written by rescues" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Pure campaign helpers and the authored lines

**Files:**
- Modify: `packages/app/src/campaign.ts`
- Modify: `packages/app/src/main.ts:149–160` (delete `campaignSummary`, import it)
- Modify: `data/schemas/commander.schema.json`, `data/campaign/commander.json`
- Test: `packages/app/src/campaign.test.ts`

**Interfaces:**
- Consumes: `LedgerData`, `MissionResult`, `unlockReason`, `UnlockGate` from `@lions/sim`; `ParsedWorld`, `WorldTown`, `WorldRegion`, `CommanderData`, `commanderForMission` already in `campaign.ts`.
- Produces (all exported from `campaign.ts`):
  - `campaignSummary(ledger: LedgerData): string` — the menu/strip tooltip line, reading `campaignRoe`.
  - `townStars(town: WorldTown, ledger: LedgerData | undefined): { earned: number; possible: number }`; `regionStars(region, ledger)` same shape.
  - `newlyUnlocked(units: readonly { id: string; name: string; unlock?: UnlockGate }[], before: LedgerData, after: LedgerData): { id: string; name: string }[]`.
  - `promotionAfter(commander: CommanderData, world: ParsedWorld, missionId: string): { rank: string; stars: number; line?: { speaker: string; text: string } } | null`.
  - `villainState(region: WorldRegion, ledger: LedgerData | undefined, missionOf: (id: string) => { objectives: readonly { type: string; primary: boolean }[] } | undefined): 'at_large' | 'captured' | 'killed'`.
  - `hostagesAccount(world: ParsedWorld, ledger: LedgerData | undefined): { taken: number; recovered: number } | null` (null when the world declares no `taken`).
  - `hostagesLine(account: { taken: number; recovered: number }, last?: { count: number; place: string }): string`.
  - `CommanderRank.promotionLine?: { speaker: string; text: string }`; `CommanderVillain.name?: string; lines?: { at_large: string; captured: string; killed: string }`; `ParsedWorld.taken?: number`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/app/src/campaign.test.ts` (it already imports `parseWorld`, `parseCommander` and the world/commander JSON; reuse its `world`/`commander` constants, or add them the way the file's first describe does):

```ts
import {
  campaignSummary,
  hostagesAccount,
  hostagesLine,
  newlyUnlocked,
  promotionAfter,
  regionStars,
  townStars,
  villainState,
} from './campaign';

describe('campaignSummary', () => {
  it('reads the mean of the per-mission ratings, not the legacy key nothing writes', () => {
    expect(campaignSummary({ 'roe.mission_ratings': { a: 80, b: 60 } })).toBe('campaign: Conduct 70');
    expect(campaignSummary({})).toBe('campaign: fresh start');
  });
});

describe('stars on the board', () => {
  const bs = world.regions[0]!.towns[0]!;
  it('sums each mission\'s best stars against three per mission', () => {
    const ledger = { 'campaign.mission_results': { [bs.missions[0]!]: { stars: 2, roe: 90, ticks: 1, lost: 0 } } };
    expect(townStars(bs, ledger)).toEqual({ earned: 2, possible: bs.missions.length * 3 });
    expect(regionStars(world.regions[0]!, ledger).earned).toBe(2);
    expect(townStars(bs, undefined)).toEqual({ earned: 0, possible: bs.missions.length * 3 });
  });
});

describe('newlyUnlocked', () => {
  it('lists units locked before and open after, and nothing else', () => {
    const units = [
      { id: 'a', name: 'A', unlock: { roeMin: 60 } },
      { id: 'b', name: 'B', unlock: { roeMin: 90 } },
      { id: 'c', name: 'C' },
    ];
    const before = { 'roe.mission_ratings': { m1: 50 } };
    const after = { 'roe.mission_ratings': { m1: 50, m2: 80 } }; // mean 65
    expect(newlyUnlocked(units, before, after)).toEqual([{ id: 'a', name: 'A' }]);
  });
});

describe('promotionAfter', () => {
  it('names the next rank when the mission ends a rank, and nothing otherwise', () => {
    const p = promotionAfter(commander, world, 'beit_sahwan_4_subterranean');
    expect(p?.rank).toBe('Major');
    expect(p?.stars).toBe(3);
    expect(promotionAfter(commander, world, 'beit_sahwan_1_recon')).toBeNull();
  });
});

describe('villainState', () => {
  const marj = world.regions[0]!;
  const last = marj.towns[marj.towns.length - 1]!.missions.at(-1)!;
  it('is at large until the front\'s last mission is done', () => {
    expect(villainState(marj, {}, () => undefined)).toBe('at_large');
  });
  it('is captured when that mission\'s primaries include a capture, else killed', () => {
    const done = { 'campaign.completed_missions': [last] };
    expect(villainState(marj, done, () => ({ objectives: [{ type: 'capture', primary: true }] }))).toBe('captured');
    expect(villainState(marj, done, () => ({ objectives: [{ type: 'eliminate_hvt', primary: true }] }))).toBe('killed');
  });
});

describe('the account of the taken', () => {
  it('subtracts what came back from what was taken, and reads nothing when the world names no number', () => {
    expect(hostagesAccount(world, { 'civ.hostages_recovered': { a: 2, b: 3 } })).toEqual({ taken: 19, recovered: 5 });
    expect(hostagesAccount({ ...world, taken: undefined }, {})).toBeNull();
  });
  it('is Idit\'s line', () => {
    expect(hostagesLine({ taken: 19, recovered: 0 })).toBe('Nineteen still out.');
    expect(hostagesLine({ taken: 19, recovered: 2 }, { count: 2, place: 'the shaft head' })).toBe(
      'Seventeen still out. Two came back at the shaft head.'
    );
    expect(hostagesLine({ taken: 19, recovered: 19 })).toBe('Nobody still out.');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/app/src/campaign.test.ts`
Expected: FAIL — the new exports do not exist.

- [ ] **Step 3: Implement the helpers**

In `campaign.ts`, extend the types: on `ParsedWorld` add `taken?: number;` and in `parseWorld` copy `if (typeof w.taken === 'number') world.taken = w.taken;` (add `taken?: number` to `WorldJson`). On `CommanderRank` add `promotionLine?: { speaker: string; text: string };` and in `parseCommander`'s rank map add `if (r.promotion_line) rank.promotionLine = { ...r.promotion_line };` (add `promotion_line?: { speaker: string; text: string }` to `CommanderRankJson`). On `CommanderVillain` add `name?: string; lines?: { at_large: string; captured: string; killed: string };` — the existing spread `{ ...v }` already copies them once the JSON type declares them.

Add the helpers (imports: `type MissionResult` from `@lions/sim` alongside the existing `unlockReason`/`LedgerData`/`UnlockGate` import):

```ts
/** The between-missions line for the menu and the strip tooltip. Reads `campaignRoe`, not
 *  `roe.cumulative_rating`: nothing has written that key since per-mission ratings landed,
 *  so the figure was dead on every fresh save. */
export function campaignSummary(ledger: LedgerData): string {
  const parts: string[] = [];
  const roster = ledger['roster.surviving_units'];
  if (Array.isArray(roster) && roster.length > 0) {
    const vets = roster.filter((r) => r.veterancy > 0).length;
    parts.push(`roster ${roster.length}${vets > 0 ? ` (${vets}★)` : ''}`);
  }
  const roe = campaignRoe(ledger);
  if (roe !== null) parts.push(`Conduct ${roe.mean}`);
  return parts.length > 0 ? `campaign: ${parts.join(' · ')}` : 'campaign: fresh start';
}

const results = (ledger: LedgerData | undefined): Record<string, MissionResult> => {
  const r = ledger?.['campaign.mission_results'];
  return r !== null && typeof r === 'object' ? (r as Record<string, MissionResult>) : {};
};

export function townStars(town: WorldTown, ledger: LedgerData | undefined): { earned: number; possible: number } {
  const r = results(ledger);
  let earned = 0;
  for (const m of town.missions) earned += r[m]?.stars ?? 0;
  return { earned, possible: town.missions.length * 3 };
}

export function regionStars(region: WorldRegion, ledger: LedgerData | undefined): { earned: number; possible: number } {
  let earned = 0;
  let possible = 0;
  for (const t of region.towns) {
    const s = townStars(t, ledger);
    earned += s.earned;
    possible += s.possible;
  }
  return { earned, possible };
}

/** Units a mission just opened: locked against the ledger before it, open against the
 *  ledger after it. The debrief announces these by name. */
export function newlyUnlocked(
  units: readonly { id: string; name: string; unlock?: UnlockGate }[],
  before: LedgerData,
  after: LedgerData
): { id: string; name: string }[] {
  return units
    .filter((u) => unlockReason(u.unlock, before) !== null && unlockReason(u.unlock, after) === null)
    .map((u) => ({ id: u.id, name: u.name }));
}

/** The rank Shai is promoted TO when `missionId` is the mission some rank holds through,
 *  with that rank's authored line. Null when the mission ends no rank. */
export function promotionAfter(
  commander: CommanderData,
  world: ParsedWorld,
  missionId: string
): { rank: string; stars: number; line?: { speaker: string; text: string } } | null {
  const i = commander.ranks.findIndex((r) => r.untilMission === missionId);
  if (i < 0 || i + 1 >= commander.ranks.length) return null;
  const next = commander.ranks[i + 1];
  const out: { rank: string; stars: number; line?: { speaker: string; text: string } } = { rank: next.rank, stars: next.stars };
  if (next.promotionLine) out.line = next.promotionLine;
  return out;
}

export type VillainState = 'at_large' | 'captured' | 'killed';

/** A front's villain is at large until the front's last authored mission is complete, then
 *  captured if that mission's primaries include a `capture`, otherwise killed. */
export function villainState(
  region: WorldRegion,
  ledger: LedgerData | undefined,
  missionOf: (id: string) => { objectives: readonly { type: string; primary: boolean }[] } | undefined
): VillainState {
  const towns = region.towns.filter((t) => t.missions.length > 0);
  const last = towns.length > 0 ? towns[towns.length - 1].missions[towns[towns.length - 1].missions.length - 1] : undefined;
  if (last === undefined || !completed(ledger).has(last)) return 'at_large';
  const m = missionOf(last);
  return m?.objectives.some((o) => o.primary && o.type === 'capture') ? 'captured' : 'killed';
}

export function hostagesAccount(
  world: ParsedWorld,
  ledger: LedgerData | undefined
): { taken: number; recovered: number } | null {
  if (typeof world.taken !== 'number') return null;
  const rec = ledger?.['civ.hostages_recovered'];
  let recovered = 0;
  if (rec !== null && typeof rec === 'object') {
    for (const v of Object.values(rec as Record<string, number>)) recovered += v;
  }
  return { taken: world.taken, recovered };
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const asWords = (n: number): string => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Idit's line under the region cards: who is still out there, and who just came home. */
export function hostagesLine(
  account: { taken: number; recovered: number },
  last?: { count: number; place: string }
): string {
  const out = account.taken - account.recovered;
  const head = out <= 0 ? 'Nobody still out.' : `${cap(asWords(out))} still out.`;
  if (!last || last.count <= 0) return head;
  return `${head} ${cap(asWords(last.count))} came back at ${last.place}.`;
}
```

Then in `main.ts` delete the local `campaignSummary` function (lines 149–160) and add `campaignSummary` to the existing `import { ... } from './campaign'` line.

- [ ] **Step 4: The authored lines in commander.json and its schema**

`data/campaign/commander.json` becomes:

```json
{
  "people": {
    "shai": { "name": "Shai Hammai", "plate": "Hammai", "portrait": "shai_hammai.png" },
    "idit": { "name": "Idit Zohar", "plate": "Zohar", "portrait": "idit_zohar.png" }
  },
  "ranks": [
    { "rank": "Captain", "stars": 2, "until_mission": "beit_sahwan_4_subterranean" },
    {
      "rank": "Major", "stars": 3, "until_mission": "umm_zeitoun_4_clearance",
      "promotion_line": { "speaker": "idit", "text": "Third star. Nobody said promotion — they handed him a wider map and a longer list of towns." }
    },
    {
      "rank": "Lieutenant Colonel", "stars": 4, "until_mission": "wadi_halam_5_depot",
      "promotion_line": { "speaker": "idit", "text": "Fourth star. The north has not been shelled in two days and he has not mentioned it once." }
    },
    {
      "rank": "Colonel", "stars": 5,
      "promotion_line": { "speaker": "shai", "text": "Five. They are giving me the brigade because the corridor is cut, and it is cut because you kept off the village." }
    }
  ],
  "villains": {
    "marj": {
      "portrait": "nadir_sahim.png", "name": "Nadir Sahim",
      "lines": {
        "at_large": "The digger. Four years under the Marj, and still under it.",
        "captured": "Taken at the shaft head with his hands empty.",
        "killed": "Killed at the shaft head. The routes were his; so was the map of them."
      }
    },
    "sur": {
      "portrait": "karim_adhal.png", "name": "Karim Adhal",
      "lines": {
        "at_large": "He has never fired at us. He has seen every round that came back.",
        "captured": "Taken on the crest. He gave us the road before he gave us his name.",
        "killed": "Off the crest, with the basin still in front of him."
      }
    },
    "naharin": {
      "portrait": "jubran_hallaq.png", "name": "Jubran Hallaq",
      "lines": {
        "at_large": "Everything under the Marj and over Sur came up his road.",
        "captured": "Taken at his own gate. He asks what happens to the road.",
        "killed": "Dead at the gate he would not leave."
      }
    }
  }
}
```

Keep any other keys the file already carries (check with `cat data/campaign/commander.json` first and merge, do not drop). In `commander.schema.json`: add to the rank item's `properties` a `promotion_line` referencing the same `say`-shaped object the schema uses for speaker/text (if it has none, add `{ "type": "object", "required": ["speaker", "text"], "additionalProperties": false, "properties": { "speaker": { "enum": ["shai", "idit"] }, "text": { "type": "string", "minLength": 1 } } }`); add to `$defs.villain.properties` `name: { "type": "string", "minLength": 1 }` and `lines: { "type": "object", "required": ["at_large", "captured", "killed"], "additionalProperties": false, "properties": { "at_large": {"type":"string","minLength":1}, "captured": {"type":"string","minLength":1}, "killed": {"type":"string","minLength":1} } }`.

- [ ] **Step 5: Run the tests and gates**

Run: `npx vitest run packages/app/src/campaign.test.ts && pnpm validate:data && pnpm typecheck`
Expected: all pass. If `validate_narrative.mjs`'s `commanderRankFailures` rejects the new rank key, extend its allowed-keys list there.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add packages/app/src/campaign.ts packages/app/src/campaign.test.ts packages/app/src/main.ts data/campaign/commander.json data/schemas/commander.schema.json tools/validate_narrative.mjs
/usr/bin/git commit -m "feat(app): campaign helpers for stars, unlocks, promotions, villains and the taken; menu Conduct figure fixed" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Both boards: stars on pins, villain cards, the account of the taken

**Files:**
- Modify: `packages/app/src/ui/theme.css` (`--commend` beside `--warn` ~line 128; card and line styles)
- Modify: `packages/app/src/ui/worldmap.ts:170–245`
- Modify: `packages/app/src/ui/worldmap3d.ts:220–241` and its `regionCard`/`ledgerLine` calls
- Modify: `packages/app/src/ui/menu.ts` (`showCampaign` passes `commander` and `missionOf` through)
- Modify: `packages/app/src/main.ts` (the `showCampaign` call)
- Test: `packages/app/src/ui/worldmap.test.ts`

**Interfaces:**
- Consumes: `townStars`, `villainState`, `hostagesAccount`, `hostagesLine`, `CommanderData` (Task 7).
- Produces: `regionCard(region, opts: { ledger: LedgerData; commander?: CommanderData; missionOf?: (id: string) => { objectives: readonly { type: string; primary: boolean }[] } | undefined })`; `ledgerLine(ledger: LedgerData, world?: ParsedWorld)`; `WorldMapOptions.commander?`, `.missionOf?`; a `--commend` token.

- [ ] **Step 1: Write the failing tests**

Append to `packages/app/src/ui/worldmap.test.ts` (extend the file's `render` helper to accept optional `commander`/`missionOf`, passing them through to `worldMap`; import `commanderJson` from `../../../../data/campaign/commander.json` and `parseCommander`):

```ts
describe('the board's motivation surfaces', () => {
  it('shows each town\'s stars beside its progress', () => {
    const first = ALL_BS[0]!;
    const el = render({ 'campaign.mission_results': { [first]: { stars: 2, roe: 90, ticks: 1, lost: 0 } } });
    const pin = el.querySelector('[data-town="beit_sahwan"]')!;
    expect(pin.textContent).toContain(`2/${ALL_BS.length * 3}★`);
  });

  it('shows a villain card per front, at large until the front is done', () => {
    const el = render({}, parseCommander(commanderJson), () => undefined);
    const card = el.querySelector('[data-villain="marj"]')!;
    expect(card.textContent).toContain('Nadir Sahim');
    expect(card.getAttribute('data-state')).toBe('at_large');
    expect(card.textContent).toContain('The digger.');
  });

  it('keeps the account of the taken under the cards', () => {
    const el = render({ 'civ.hostages_recovered': { beit_sahwan_4_subterranean: 2 } });
    expect(el.querySelector('.rl-world__taken')?.textContent).toBe('Seventeen still out.');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/app/src/ui/worldmap.test.ts`
Expected: FAIL on all three.

- [ ] **Step 3: Token and styles**

In `theme.css`, after `--warn: var(--rl-team-neutral);`:

```css
  /* Earned, not a state: stars, citations, the stripe. Its own token so a reward never
     borrows the caution colour (the stripe stars used --warn until 2026-09-11). */
  --commend: var(--rl-dust-0);
```

Next to `.rl-world__card` (line 428):

```css
.rl-world__stars { color: var(--commend); }
.rl-world__villain {
  margin-top: 6px;
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 8px;
  align-items: start;
}
.rl-world__villain-face { width: 40px; height: 52px; object-fit: cover; background: var(--panel-frame); }
.rl-world__villain-name { color: var(--ink); }
.rl-world__villain[data-state='captured'] .rl-world__villain-name,
.rl-world__villain[data-state='killed'] .rl-world__villain-name { text-decoration: line-through; color: var(--ink-mute); }
.rl-world__villain-line { color: var(--ink-mute); font-style: italic; }
.rl-world__taken { margin-top: 8px; color: var(--ink); }
```

(`--panel-frame` exists; if the name differs in this tree, use the token `.rl-world__card`'s border uses.)

- [ ] **Step 4: Both boards**

`worldmap.ts`: extend `WorldMapOptions` (or whatever the exported options interface is named; check the top of the file) with `commander?: CommanderData; missionOf?: (id: string) => { objectives: readonly { type: string; primary: boolean }[] } | undefined;`. In the town loop replace the `label` line with:

```ts
      const stars = townStars(town, opts.ledger);
      const label = `${town.name}${tp.total > 0 ? ` ${tp.done}/${tp.total}` : ''}`;
```

and after the link/span is appended, when `stars.possible > 0`:

```ts
      if (stars.possible > 0) {
        marker.appendChild(el('span', 'rl-world__stars', ` ${stars.earned}/${stars.possible}★`));
      }
```

Change `regionCard`'s signature to the one in Interfaces and, before the badge is appended:

```ts
  const villain = opts.commander?.villains?.[region.id];
  if (villain && opts.missionOf) {
    const state = villainState(region, opts.ledger, opts.missionOf);
    const box = el('div', 'rl-world__villain');
    box.dataset.villain = region.id;
    box.dataset.state = state;
    const face = document.createElement('img');
    face.className = 'rl-world__villain-face';
    face.alt = '';
    if (villain.portrait) face.src = `${opts.base ?? ''}portraits/${villain.portrait}`;
    const text = el('div', '');
    text.appendChild(el('div', 'rl-world__villain-name', villain.name ?? region.faction));
    if (villain.lines) text.appendChild(el('div', 'rl-world__villain-line', villain.lines[state]));
    box.append(face, text);
    card.appendChild(box);
  }
```

Portrait URL: use the same resolver the commander bar uses (`portrait-catalogue.ts`'s function for a villain portrait; grep `villainPortrait` in `main.ts` to see how it is turned into a URL, and pass the resolved URL in via a `portraitUrl?: (file: string) => string` option rather than building the path here if that is how the rest of the app does it). Add `base?: string` or `portraitUrl?` to the card opts accordingly.

Change `ledgerLine(ledger)` to `ledgerLine(ledger: LedgerData, world?: ParsedWorld)` and append, after `line` is built, a sibling returned in a wrapper:

```ts
  const wrap = el('div', 'rl-world__ledgerwrap');
  wrap.appendChild(line);
  const account = world ? hostagesAccount(world, ledger) : null;
  if (account) wrap.appendChild(el('div', 'rl-world__taken', hostagesLine(account)));
  return wrap;
```

Update `worldMap`'s call to `ledgerLine(opts.ledger, opts.world)` and its `regionCard(region, opts)` call (opts now carries `commander`/`missionOf`). In `worldmap3d.ts`, mirror the pin stars in its town loop (same two lines) and pass the same opts through its `regionCard` and `ledgerLine` calls (grep both names in that file). In `menu.ts` `showCampaign`, add `commander?: CommanderData` and `missionOf?` to `CampaignOptions` and pass them to both boards; in `main.ts`, at the `showCampaign` call, pass `commander: commanderData` and `missionOf: (id) => (missions as Record<string, MissionJson | undefined>)[id]`.

- [ ] **Step 5: Run the tests and the gates**

Run: `npx vitest run packages/app/src/ui && pnpm validate:ui && pnpm typecheck`
Expected: pass; the palette gate reports every token known.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add packages/app/src/ui/theme.css packages/app/src/ui/worldmap.ts packages/app/src/ui/worldmap3d.ts packages/app/src/ui/worldmap.test.ts packages/app/src/ui/menu.ts packages/app/src/main.ts
/usr/bin/git commit -m "feat(ui): stars on the pins, a villain card per front, the account of the taken -- on both boards" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The debrief screen

**Files:**
- Create: `packages/app/src/ui/grade-copy.ts`
- Create: `packages/app/src/ui/debrief.ts`
- Create: `packages/app/src/ui/debrief.test.ts`
- Modify: `packages/app/src/ui/menu.ts` (`EndScreenOptions.onDebrief`, a "debrief" button)
- Modify: `packages/app/src/ui/theme.css`

**Interfaces:**
- Produces:
  - `grade-copy.ts`: `TIER_NAMES: readonly ['', 'Entered in the log', 'Named in brigade orders', "Ari'im citation"]`; `TIER_LINES: readonly [null, {speaker:'shai',text}, {speaker:'idit',text}, {speaker:'shai',text}]`.
  - `debrief.ts`: `interface DebriefOptions { result: 'victory' | 'defeat'; stars: Stars; tierLine?: { plate: string; text: string; portrait?: string }; roe: number; roeFloor: number; deductions: { penalty: number; reason: string }[]; ticks: number; targetMinutes?: number; lost: { type: string; count: number }[]; secondaries: { text: string; complete: boolean; carries: boolean }[]; marked: number; promoted: number; unlocked: string[]; promotion?: { rank: string; stars: number; line?: { plate: string; text: string } }; next?: { id: string; name: string; villainLine?: string }; missionId: string }`; `showDebrief(host: HTMLElement, opts: DebriefOptions): void`.
  - `menu.ts`: `EndScreenOptions.onDebrief?: () => void` renders a `debrief` button before the nav links.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/debrief.test.ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { showDebrief, type DebriefOptions } from './debrief';
import { TIER_NAMES } from './grade-copy';

const base = (over: Partial<DebriefOptions> = {}): DebriefOptions => ({
  result: 'victory',
  stars: 2,
  tierLine: { plate: 'Zohar', text: 'Brigade read the file to the end.' },
  roe: 84,
  roeFloor: 60,
  deductions: [{ penalty: 5, reason: 'fire into protected structure (clinic)' }],
  ticks: 20 * 60 * 4 + 20 * 30,
  targetMinutes: 7,
  lost: [{ type: 'inf_squad', count: 2 }],
  secondaries: [{ text: 'Build the picture', complete: true, carries: true }],
  marked: 3,
  promoted: 1,
  unlocked: ['Namer IFV'],
  missionId: 'beit_sahwan_3_clearance',
  ...over,
});

const text = (host: HTMLElement, sel: string): string => host.querySelector(sel)?.textContent ?? '';

describe('showDebrief', () => {
  it('names the tier and speaks its line', () => {
    const host = document.createElement('div');
    showDebrief(host, base());
    expect(text(host, '.rl-debrief__tier')).toBe(TIER_NAMES[2]);
    expect(text(host, '.rl-debrief__stars')).toBe('★★');
    expect(text(host, '.rl-debrief__line')).toContain('Brigade read the file');
  });

  it('shows Conduct with its floor and every deduction by reason', () => {
    const host = document.createElement('div');
    showDebrief(host, base());
    expect(text(host, '.rl-debrief__conduct')).toContain('Conduct 84');
    expect(text(host, '.rl-debrief__conduct')).toContain('60');
    expect(text(host, '.rl-debrief__deductions')).toContain('−5 fire into protected structure (clinic)');
  });

  it('shows time against target and losses by type, never as a grade', () => {
    const host = document.createElement('div');
    showDebrief(host, base());
    expect(text(host, '.rl-debrief__time')).toBe('4:30 of 7:00');
    expect(text(host, '.rl-debrief__lost')).toContain('inf_squad ×2');
  });

  it('lists secondaries, marking the ones that carry', () => {
    const host = document.createElement('div');
    showDebrief(host, base());
    const row = host.querySelector('.rl-debrief__secondary')!;
    expect(row.getAttribute('data-carries')).toBe('1');
    expect(row.getAttribute('data-complete')).toBe('1');
  });

  it('announces unlocks and a promotion when there is one', () => {
    const host = document.createElement('div');
    showDebrief(host, base({ promotion: { rank: 'Major', stars: 3, line: { plate: 'Zohar', text: 'Third star.' } } }));
    expect(text(host, '.rl-debrief__unlocked')).toContain('Namer IFV');
    expect(text(host, '.rl-debrief__promotion')).toContain('Major');
    expect(text(host, '.rl-debrief__promotion')).toContain('Third star.');
  });

  it('names the next mission with the villain\'s line, and links to it', () => {
    const host = document.createElement('div');
    showDebrief(host, base({ next: { id: 'beit_sahwan_4_subterranean', name: 'Beit Sahwan IV — Subterranean', villainLine: 'The digger.' } }));
    const a = host.querySelector<HTMLAnchorElement>('a.rl-debrief__next')!;
    expect(a.getAttribute('href')).toBe('?mission=beit_sahwan_4_subterranean');
    expect(a.textContent).toContain('Beit Sahwan IV');
    expect(text(host, '.rl-debrief__villain')).toBe('The digger.');
  });

  it('renders a defeat with no tier and no stars', () => {
    const host = document.createElement('div');
    showDebrief(host, base({ result: 'defeat', stars: 0, tierLine: undefined }));
    expect(text(host, '.rl-debrief__tier')).toBe('Withdraw and regroup');
    expect(host.querySelector('.rl-debrief__stars')).toBeNull();
  });
});
```

And in `menu.test.ts`, inside the `showEndScreen` describe:

```ts
  it('offers the debrief when a caller wires one', () => {
    const host = document.createElement('div');
    let opened = 0;
    showEndScreen(host, { result: 'victory', roe: 94, survivors: 11, missionId: 'x', onDebrief: () => opened++ });
    host.querySelector<HTMLButtonElement>('button.rl-endnav__debrief')!.click();
    expect(opened).toBe(1);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/app/src/ui/debrief.test.ts packages/app/src/ui/menu.test.ts`
Expected: FAIL — modules and button missing.

- [ ] **Step 3: The copy module**

```ts
// packages/app/src/ui/grade-copy.ts
/** The tier names and their closing lines (spec 2026-09-10 §4.1, decided by the lead). Fixed
 *  here so no screen rewrites them; the debrief resolves `speaker` to a plate and portrait
 *  the same way the commander bar does. Index by stars; 0 has neither. */
export const TIER_NAMES = ['', 'Entered in the log', 'Named in brigade orders', "Ari'im citation"] as const;

export const TIER_LINES = [
  null,
  { speaker: 'shai', text: 'It is in the log. That is what the log is for.' },
  {
    speaker: 'idit',
    text: 'Brigade read the file to the end and put the company in Thursday’s orders. They do not read many to the end.',
  },
  { speaker: 'shai', text: 'A citation. Put it with the slip and get the men fed.' },
] as const;
```

- [ ] **Step 4: The screen**

```ts
// packages/app/src/ui/debrief.ts
// The debrief: a full screen after a mission (storyline O7, spec §4.2). The end panel keeps
// its portrait and quote; this is the card that would not fit in 420px. Pure DOM, no sim.
import type { Stars } from '@lions/sim';
import { panel } from './panel';
import { TIER_NAMES } from './grade-copy';

export interface DebriefOptions {
  result: 'victory' | 'defeat';
  stars: Stars;
  tierLine?: { plate: string; text: string; portrait?: string };
  roe: number;
  roeFloor: number;
  deductions: { penalty: number; reason: string }[];
  ticks: number;
  targetMinutes?: number;
  lost: { type: string; count: number }[];
  secondaries: { text: string; complete: boolean; carries: boolean }[];
  marked: number;
  promoted: number;
  unlocked: string[];
  promotion?: { rank: string; stars: number; line?: { plate: string; text: string } };
  next?: { id: string; name: string; villainLine?: string };
  missionId: string;
}

const el = (tag: string, cls: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function clock(ticks: number): string {
  const s = Math.floor(ticks / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function showDebrief(host: HTMLElement, o: DebriefOptions): void {
  const won = o.result === 'victory';
  const p = panel({
    rank: 'mission',
    title: won ? TIER_NAMES[o.stars] || 'Entered in the log' : 'Withdraw and regroup',
    tag: won ? 'Debrief' : 'Defeat',
    mark: true,
    place: 'top:6%;left:50%;transform:translateX(-50%);width:min(720px,94vw);max-height:88vh;overflow:auto',
  });
  p.el.classList.add('rl-debrief', 'rl-enter');
  const b = p.body;

  const head = el('div', 'rl-debrief__head');
  head.appendChild(el('div', 'rl-debrief__tier', won ? TIER_NAMES[o.stars] : 'Withdraw and regroup'));
  if (won && o.stars > 0) head.appendChild(el('div', 'rl-debrief__stars', '★'.repeat(o.stars)));
  b.appendChild(head);

  if (o.tierLine) {
    const q = el('blockquote', 'rl-debrief__line', `“${o.tierLine.text}”`);
    q.appendChild(el('cite', 'rl-debrief__who', o.tierLine.plate));
    b.appendChild(q);
  }

  const grid = el('dl', 'rl-debrief__grid');
  const row = (k: string, v: string, cls: string): void => {
    grid.appendChild(el('dt', '', k));
    grid.appendChild(el('dd', cls, v));
  };
  row('Conduct', `Conduct ${o.roe} · orders floor ${o.roeFloor}`, 'rl-debrief__conduct');
  row('Time', o.targetMinutes !== undefined ? `${clock(o.ticks)} of ${o.targetMinutes}:00` : clock(o.ticks), 'rl-debrief__time');
  row('Lost', o.lost.length === 0 ? 'nobody' : o.lost.map((l) => `${l.type} ×${l.count}`).join(', '), 'rl-debrief__lost');
  row('Marked', String(o.marked), 'rl-debrief__marked');
  row('Promoted', String(o.promoted), 'rl-debrief__promoted');
  b.appendChild(grid);

  if (o.deductions.length > 0) {
    const ul = el('ul', 'rl-debrief__deductions');
    for (const d of o.deductions) ul.appendChild(el('li', '', `−${d.penalty} ${d.reason}`));
    b.appendChild(ul);
  }

  if (o.secondaries.length > 0) {
    const ul = el('ul', 'rl-debrief__secondaries');
    for (const s of o.secondaries) {
      const li = el('li', 'rl-debrief__secondary', `${s.complete ? '☑' : '☐'} ${s.text}${s.carries ? ' · carries' : ''}`);
      li.dataset.carries = s.carries ? '1' : '0';
      li.dataset.complete = s.complete ? '1' : '0';
      ul.appendChild(li);
    }
    b.appendChild(ul);
  }

  if (o.unlocked.length > 0) b.appendChild(el('div', 'rl-debrief__unlocked', `Now available: ${o.unlocked.join(', ')}`));

  if (o.promotion) {
    const pr = el('div', 'rl-debrief__promotion', `Promoted: ${o.promotion.rank} · ${'★'.repeat(o.promotion.stars)}`);
    if (o.promotion.line) pr.appendChild(el('blockquote', 'rl-debrief__line', `“${o.promotion.line.text}” — ${o.promotion.line.plate}`));
    b.appendChild(pr);
  }

  const nav = el('div', 'rl-endnav');
  if (won && o.next) {
    const a = document.createElement('a');
    a.className = 'rl-btn rl-debrief__next';
    a.href = `?mission=${o.next.id}`;
    a.textContent = `next: ${o.next.name} →`;
    nav.appendChild(a);
    if (o.next.villainLine) b.appendChild(el('div', 'rl-debrief__villain', o.next.villainLine));
  }
  const back = (label: string, href: string): void => {
    const a = document.createElement('a');
    a.className = 'rl-btn';
    a.href = href;
    a.textContent = label;
    nav.appendChild(a);
  };
  back(won ? 'replay' : 'try again', `?mission=${o.missionId}`);
  back('campaign map', '?campaign');
  b.appendChild(nav);

  host.appendChild(p.el);
}
```

`menu.ts`: add `onDebrief?: () => void;` to `EndScreenOptions` and, in `showEndScreen` before the `link(...)` calls:

```ts
  if (opts.onDebrief) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rl-btn rl-endnav__debrief';
    btn.textContent = 'debrief';
    btn.addEventListener('click', () => {
      p.el.remove();
      opts.onDebrief?.();
    });
    nav.appendChild(btn);
  }
```

`theme.css`, beside `.rl-enddebrief` (line 1984):

```css
.rl-debrief__head { display: flex; align-items: baseline; gap: 12px; }
.rl-debrief__tier { font-size: var(--t-lg); color: var(--ink); }
.rl-debrief__stars { color: var(--commend); letter-spacing: 2px; }
.rl-debrief__line { margin: 8px 0; color: var(--ink); font-style: italic; }
.rl-debrief__who { display: block; margin-top: 2px; font-style: normal; color: var(--ink-dim); }
.rl-debrief__grid { display: grid; grid-template-columns: 6em 1fr; gap: 2px 12px; margin: 10px 0; }
.rl-debrief__grid dt { color: var(--ink-dim); }
.rl-debrief__deductions, .rl-debrief__secondaries { margin: 4px 0 8px 1.2em; padding: 0; }
.rl-debrief__deductions li { color: var(--bad); }
.rl-debrief__secondary[data-carries='1'] { color: var(--commend); }
.rl-debrief__unlocked, .rl-debrief__promotion { margin-top: 8px; color: var(--good); }
.rl-debrief__villain { margin-top: 8px; color: var(--ink-mute); font-style: italic; }
```

(Use the file's existing size tokens; if `--t-lg` does not exist, use whichever the `.rl-panel__title` uses.)

- [ ] **Step 5: Run the tests and gates**

Run: `npx vitest run packages/app/src/ui && pnpm validate:ui && pnpm typecheck`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add packages/app/src/ui/grade-copy.ts packages/app/src/ui/debrief.ts packages/app/src/ui/debrief.test.ts packages/app/src/ui/menu.ts packages/app/src/ui/menu.test.ts packages/app/src/ui/theme.css
/usr/bin/git commit -m "feat(ui): the debrief screen -- tier, Conduct and reasons, card, promotion, unlocks, next mission" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Wire the debrief in the app

**Files:**
- Modify: `packages/app/src/main.ts` (`describeMissionEvent` ~257–300; the `missionEnd` handler ~1880–1930; the `unitInfo` builder for a units list)

**Interfaces:**
- Consumes: `showDebrief`, `DebriefOptions` (Task 9); `TIER_LINES` (Task 9); `newlyUnlocked`, `promotionAfter`, `villainState` (Task 7); runtime getters (Task 2); `starRoeFloor` (Task 1); `speakerPlate`, `speakerPortrait` (`hud-model.ts`).

- [ ] **Step 1: Remember every deduction**

Beside `const narratedRoeReasons = new Set<string>();` (line 554):

```ts
  /** Every Conduct deduction this mission, for the debrief. The sim keeps no
   *  presentation log; the events are the record. */
  const deductions: { penalty: number; reason: string }[] = [];
```

In the mission-event loop, before `const described = describeMissionEvent(...)`:

```ts
        if (me.kind === 'roe') deductions.push({ penalty: me.penalty, reason: me.reason });
```

- [ ] **Step 2: Build the debrief at mission end**

In the `missionEnd` branch, after `const nextMissionId = ...` and before `showEndScreen(...)`:

```ts
            const kdfUnits = Object.values(units)
              .filter((u) => u.faction === 'kdf')
              .map((u) => ({
                id: u.id,
                name: u.name ?? u.id,
                unlock: u.unlock
                  ? { roeMin: u.unlock.roe_rating_min, afterMission: u.unlock.after_mission }
                  : undefined,
              }));
            const tier = TIER_LINES[runtime.stars];
            const promotion = me.result === 'victory' ? promotionAfter(commanderData, worldData, missionId) : null;
            const nextJson = nextMissionId ? (missions as Record<string, MissionJson | undefined>)[nextMissionId] : undefined;
            const region = regionForTown(worldData, mission.town);
            const villain = region ? commanderData.villains?.[region.id] : undefined;
            const debriefOpts: DebriefOptions = {
              result: me.result,
              stars: runtime.stars,
              tierLine: tier ? { plate: speakerPlate(hudCommander, tier.speaker), text: tier.text, portrait: speakerPortrait(hudCommander, tier.speaker) } : undefined,
              roe: me.roeRating,
              roeFloor: starRoeFloor(mission.roe?.fail_below),
              deductions,
              ticks: sim.tickCount,
              targetMinutes: mission.target_minutes,
              lost: Object.entries(runtime.lostByType()).map(([type, count]) => ({ type, count })),
              secondaries: runtime.objectiveList
                .filter((o) => !o.primary)
                .map((o) => ({ text: o.text, complete: o.status === 'complete', carries: o.carries })),
              marked: runtime.markedCount,
              promoted: runtime.promotedCount,
              unlocked: me.result === 'victory' ? newlyUnlocked(kdfUnits, ledger, updatedLedger).map((u) => u.name) : [],
              promotion: promotion
                ? { rank: promotion.rank, stars: promotion.stars, line: promotion.line ? { plate: speakerPlate(hudCommander, promotion.line.speaker), text: promotion.line.text } : undefined }
                : undefined,
              next: nextMissionId
                ? {
                    id: nextMissionId,
                    name: nextJson?.name ?? nextMissionId,
                    villainLine: region && villain?.lines
                      ? villain.lines[villainState(region, updatedLedger, (id) => (missions as Record<string, MissionJson | undefined>)[id])]
                      : undefined,
                  }
                : undefined,
              missionId,
            };
```

Then add to the `showEndScreen(...)` call: `onDebrief: () => showDebrief(document.body, debriefOpts),`. Import `showDebrief`, `type DebriefOptions` from `./ui/debrief`, `TIER_LINES` from `./ui/grade-copy`, `starRoeFloor` from `@lions/sim`, and `newlyUnlocked`, `promotionAfter`, `villainState`, `regionForTown` from `./campaign` (check which are already imported). `units`, `missions`, `worldData`, `commanderData`, `hudCommander`, `sim`, `runtime`, `mission`, `ledger`, `updatedLedger` are all in scope at that point (lines 390–400 and 1880–1925); `mission.town` is the mission JSON's `town` field (check `MissionJson` declares it; if not, add `town?: string;`).

Note `runtime` is typed possibly-null earlier in the closure; the branch is inside `if (runtime && mission)`, so it narrows. If TypeScript complains about the narrowing across the callback, capture `const rt = runtime;` at the top of the branch.

- [ ] **Step 3: Check it in the browser**

Run: `pnpm typecheck && pnpm lint`, then open the dev server with the preview tool (`preview_start` with the project's launch config, or `pnpm dev` if you are the user), load `?mission=beit_sahwan_1_recon&fresh=1`, deploy, and in the console run `__lions.step(6000)` until the end panel shows. Click **debrief**. Expected: the card shows a tier, `Conduct N · orders floor 70`, time of `5:00`, the two secondaries with `· carries`, and a next-mission link named "Beit Sahwan II — Foothold". Take a screenshot for the PR.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add packages/app/src/main.ts
/usr/bin/git commit -m "feat(app): the end panel opens the debrief" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: "What you brought" on the deploy screen

**Files:**
- Modify: `packages/app/src/ui/loading.ts` (`showLoading` signature ~83–101; `box` assembly ~198–202)
- Modify: `packages/app/src/ui/theme.css`
- Modify: `packages/app/src/main.ts` (the `showLoading` call ~935)
- Test: `packages/app/src/ui/loading.test.ts`

**Interfaces:**
- Produces: `interface BroughtPanel { roster: { type: string; count: number; stripes: number }[]; marked: number; conduct: number | null; sentences: string[] }`; `showLoading(host, title, briefing?, commander?, briefingVideo?, brought?: BroughtPanel)`; `broughtFor(mission: { ledger: { requires: string[] } }, ledger: LedgerData, unitName: (id: string) => string): BroughtPanel | null` exported from `loading.ts` (pure; null when the mission requires nothing).

- [ ] **Step 1: Write the failing tests**

Append to `packages/app/src/ui/loading.test.ts`:

```ts
import { broughtFor, showLoading } from './loading';

describe('what you brought', () => {
  const ledger = {
    'roster.surviving_units': [
      { type: 'inf_squad', veterancy: 2 },
      { type: 'inf_squad', veterancy: 0 },
      { type: 'mbt_lavi', veterancy: 1 },
    ],
    'intel.marked_positions': ['bs_hvt_atgm', 'bs_track_north'],
    'roe.mission_ratings': { a: 80 },
  };
  const name = (id: string): string => (id === 'inf_squad' ? 'Rifle Squad' : 'Lavi');

  it('is nothing for a mission that requires nothing', () => {
    expect(broughtFor({ ledger: { requires: [] } }, ledger, name)).toBeNull();
  });

  it('groups the roster by type with its best stripes, counts the marks, reads Conduct', () => {
    const b = broughtFor({ ledger: { requires: ['roster.surviving_units', 'intel.marked_positions'] } }, ledger, name)!;
    expect(b.roster).toEqual([
      { type: 'Rifle Squad', count: 2, stripes: 2 },
      { type: 'Lavi', count: 1, stripes: 1 },
    ]);
    expect(b.marked).toBe(2);
    expect(b.conduct).toBe(80);
    expect(b.sentences).toContain('Two positions your recon marked are on your map before a shot is fired.');
  });

  it('says so when the ledger is thin', () => {
    const b = broughtFor({ ledger: { requires: ['roster.surviving_units', 'intel.marked_positions'] } }, {}, name)!;
    expect(b.roster).toEqual([]);
    expect(b.sentences).toContain('Nothing marked. Whatever is out there, you find under fire.');
  });

  it('renders beside the orders without becoming a beat', () => {
    const host = document.createElement('div');
    showLoading(host, 'X', 'Orders. More orders.', undefined, undefined, {
      roster: [{ type: 'Rifle Squad', count: 2, stripes: 2 }],
      marked: 2,
      conduct: 80,
      sentences: ['Two positions your recon marked are on your map before a shot is fired.'],
    });
    expect(host.querySelectorAll('.rl-loading__beat').length).toBe(1);
    expect(host.querySelector('.rl-loading__brought')?.textContent).toContain('Rifle Squad ×2 ★★');
    expect(host.querySelector('.rl-loading__brought')?.textContent).toContain('Conduct 80');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/app/src/ui/loading.test.ts`
Expected: FAIL — `broughtFor` is not exported; the panel is absent.

- [ ] **Step 3: Implement**

In `loading.ts`, near `briefingBeats`:

```ts
import type { LedgerData } from '@lions/sim';
import { campaignRoe } from '../campaign';

export interface BroughtPanel {
  roster: { type: string; count: number; stripes: number }[];
  marked: number;
  conduct: number | null;
  sentences: string[];
}

const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const num = (n: number): string => (n < NUM.length ? NUM[n] : String(n));

/** What the ledger hands this mission, in the player's terms (spec §5). Null when the
 *  mission's contract reads nothing, so a sandbox and First Light show no panel. */
export function broughtFor(
  mission: { ledger: { requires: string[] } },
  ledger: LedgerData,
  unitName: (id: string) => string
): BroughtPanel | null {
  const req = mission.ledger.requires;
  if (req.length === 0) return null;
  const roster: BroughtPanel['roster'] = [];
  if (req.includes('roster.surviving_units')) {
    const entries = ledger['roster.surviving_units'] ?? [];
    const byType = new Map<string, { count: number; stripes: number }>();
    for (const e of entries) {
      const cur = byType.get(e.type) ?? { count: 0, stripes: 0 };
      cur.count++;
      if (e.veterancy > cur.stripes) cur.stripes = e.veterancy;
      byType.set(e.type, cur);
    }
    for (const [type, v] of byType) roster.push({ type: unitName(type), ...v });
  }
  const marked = req.includes('intel.marked_positions') ? (ledger['intel.marked_positions'] ?? []).length : 0;
  const conduct = campaignRoe(ledger)?.mean ?? null;
  const sentences: string[] = [];
  if (req.includes('intel.marked_positions')) {
    sentences.push(
      marked > 0
        ? `${num(marked)} position${marked === 1 ? '' : 's'} your recon marked ${marked === 1 ? 'is' : 'are'} on your map before a shot is fired.`
        : 'Nothing marked. Whatever is out there, you find under fire.'
    );
  }
  if (req.includes('roster.surviving_units') && roster.length === 0) {
    sentences.push('No survivors carried forward. The brigade fields a fresh remnant for each slot.');
  }
  return { roster, marked, conduct, sentences };
}
```

Add the sixth parameter `brought?: BroughtPanel` to `showLoading` and, after `orders` is built and before the video block, build the panel:

```ts
  let broughtEl: HTMLElement | null = null;
  if (holds && brought) {
    broughtEl = document.createElement('div');
    broughtEl.className = 'rl-loading__brought';
    const h = document.createElement('div');
    h.className = 'rl-loading__brought-head';
    h.textContent = 'What you brought';
    broughtEl.appendChild(h);
    const ul = document.createElement('ul');
    for (const r of brought.roster) {
      const li = document.createElement('li');
      li.textContent = `${r.type} ×${r.count}${r.stripes > 0 ? ` ${'★'.repeat(r.stripes)}` : ''}`;
      ul.appendChild(li);
    }
    if (brought.conduct !== null) {
      const li = document.createElement('li');
      li.textContent = `Conduct ${brought.conduct}`;
      ul.appendChild(li);
    }
    broughtEl.appendChild(ul);
    for (const s of brought.sentences) {
      const p = document.createElement('p');
      p.className = 'rl-loading__brought-line';
      p.textContent = s;
      broughtEl.appendChild(p);
    }
  }
```

Then where `box` gets its children (the `box.append(...)`/`appendChild` sequence around lines 198–202), insert `broughtEl` immediately after `orders` and before `deploy`, guarded on `if (broughtEl)`. Nothing about the deploy gate changes.

`theme.css`, beside `.rl-loading__brief`:

```css
.rl-loading__brought { margin: 10px 0 0; padding: 8px 10px; border-left: 2px solid var(--commend); color: var(--ink); }
.rl-loading__brought-head { color: var(--ink-dim); font-size: var(--t-xs); text-transform: uppercase; letter-spacing: 1px; }
.rl-loading__brought ul { margin: 4px 0; padding-left: 1.1em; }
.rl-loading__brought-line { margin: 4px 0 0; color: var(--ink-mute); }
```

`main.ts`, the `showLoading` call (line 935): add the sixth argument

```ts
    mission ? broughtFor(mission, ledger, (id) => units[id as keyof typeof units]?.name ?? id) : undefined
```

and import `broughtFor` from `./ui/loading` (the line already imports `briefingBeats, showLoading`). `mission.ledger` is required by the schema, so the type is non-optional; if `MissionJson` types `ledger` as optional, guard with `mission?.ledger ? … : undefined`.

- [ ] **Step 4: Run the tests and gates**

Run: `npx vitest run packages/app && pnpm validate:ui && pnpm typecheck && pnpm lint`
Expected: pass.

- [ ] **Step 5: Look at it**

Load `?mission=beit_sahwan_3_clearance` on a save that has played Beit Sahwan I (or seed one: in the console, `localStorage.setItem('lions.campaign.ledger', JSON.stringify({ 'roster.surviving_units': [{type:'inf_squad',veterancy:2}], 'intel.marked_positions': ['bs_hvt_atgm'], 'roe.mission_ratings': {beit_sahwan_1_recon: 88} }))` then reload). Expected: the panel sits between the orders beats and the Deploy button, reading `Rifle Squad ×1 ★★`, `Conduct 88`, and "One position your recon marked is on your map before a shot is fired." Screenshot for the PR.

- [ ] **Step 6: Commit and run everything**

```bash
/usr/bin/git add packages/app/src/ui/loading.ts packages/app/src/ui/loading.test.ts packages/app/src/ui/theme.css packages/app/src/main.ts
/usr/bin/git commit -m "feat(ui): what you brought -- the deploy screen names the carry-over" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
pnpm test && pnpm lint && pnpm typecheck && pnpm validate:data && pnpm validate:ui && pnpm playtest && pnpm test:determinism
```

Expected: every gate green; `pnpm playtest` exit 0 with every winning plan at `stars 2` or `3`; the golden hash unmoved.

---

## After the plan

- The visual gate's gated scenarios are sandboxes and draw none of these surfaces, so no bless is expected; check `gh run list` after the push anyway.
- Steps 2 ("Own": names, the veterancy earn rule, the pool carry) and 3 ("Earn": `stars_min`, the brigade screen, `upgrades_to`, the three special units) are separate plans against spec §4.6–§4.8, written once this one has landed and the harness reports the optimal plans' star totals, which is what the star gates are fitted to.
