# Contextual Cursor Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the inline right-click decision tree out of `main.ts` into one pure, tested resolver that a hover path can call, changing nothing a player can see.

**Architecture:** A pure `resolvePointer(world, ctx)` in `packages/app/src/input/intents.ts` returns a `Resolution` — the ordered `PlayerIntent[]` the click produces, plus the ROE tier, the order-marker flag and any HUD note. The `contextmenu` handler becomes: resolve, then act on the result. Four read-only sim queries replace lookups the app does by hand. No new intent vocabulary: `PlayerIntent` already names every verb.

**Tech Stack:** TypeScript (strict), vitest (`environment: 'node'` for input tests), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-24-contextual-cursor-design.md`

## Global Constraints

- **The determinism pin must NOT move.** It reads `1639983699` in `packages/sim/src/determinism.test.ts`. The sim gains read-only queries and no state. **A moved pin is a BLOCKED report, never a value to update.**
- **No floating point in `@lions/sim`.** `Math.*` and `Date.*` are banned there and lint-enforced. All four new queries are integer lookups and comparisons that never touch `fx.*`.
- **`packages/sim` imports nothing.** `packages/data` is a leaf. Dependency direction is `app → render → sim`.
- **No DOM in `intents.ts`.** Its tests run in `environment: 'node'`; the module header says so and it must stay true.
- **Nothing observable changes.** This slice ships no visual change and no behaviour change. If a parity test forces a behaviour choice, the OLD behaviour wins and the finding is reported.
- **Never** run `git add -A`, `git add .`, `git stash` in any form, or `git checkout <file>` / `git restore <file>`. The stash stack is shared with other live worktrees, and this repository has lost an entire uncommitted feature to `git checkout <file>`. Stage files by name.
- Every commit message ends with these two lines exactly:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
  ```

---

## Two conflicts found while writing this plan

Both are recorded here because an implementer would otherwise hit them mid-task.

**1. Shift is already taken.** `main.ts:881` passes `append: ev.shiftKey` — Shift queues a waypoint onto the end of a route. The spec's follow-on slice proposed Shift-to-confirm for ROE-protected targets; **it cannot be Shift.** Slice 2 must pick another modifier. Nothing in slice 1 depends on this, but the decision is now on record.

**2. The protected-site "deliberate confirm" already exists, and it is not a modifier.** `sortStructureOrder` (`intents.ts:131`) implements it: a protected site comes down only for a selection that is *nothing but* demolishers, because *"isolating the engineers IS the act of taking responsibility, and it needs no modifier key to say so."* That rule fixed a real bug — an ambiguous click past a mosque gave the D9 a 30-point demolish order while everything else attack-moved, so it read as a move and cost a third of the ROE budget.

**Slice 1 preserves that rule exactly.** It is passed through unchanged. Any confirm gate slice 2 adds belongs on the *attack* path, which has no ROE check at all today — not on demolish, which already has a considered one.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/sim/src/sim.ts` | **Modify.** Four read-only queries beside `structureAt` (`:1264`). | 1 |
| `packages/sim/src/queries.test.ts` | **Create.** Tests for the four, including empty cases. | 1 |
| `packages/app/src/input/intents.ts` | **Modify.** `RoeTier`, `IntentWorld`, `Resolution`, `resolvePointer`, `resolveKeyVerb`. | 2, 4 |
| `packages/app/src/input/resolve.test.ts` | **Create.** Pure resolver tests against a fake world. | 2, 4 |
| `packages/app/src/main.ts` | **Modify.** `contextmenu` (`:809-882`), the `g`/`u`/`f` branches (`:910-947`), `pointerup` (`:773-796`). | 3, 4 |

---

### Task 1: Four read-only sim queries

**Files:**
- Modify: `packages/sim/src/sim.ts` (beside `structureAt`, currently `:1264`)
- Test: `packages/sim/src/queries.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, all on `Sim`:
  - `tunnelAt(x: number, y: number): number` — id of a **living, player-identified** route under the tile, else `-1`
  - `isProtected(structIdx: number): boolean`
  - `structureRoePenalty(structIdx: number): number`
  - `garrisonFree(structIdx: number): number`

**Why four and not the spec's three.** The spec named `tunnelAt`, `isProtected` and `garrisonFree`. `structureRoePenalty` is the fourth because the ROE tier needs three outcomes, and `isProtected` alone cannot separate *costly* from *free* — `apartment` (14) and `wall` (0) are both "not protected". Exposing the number keeps `PROTECTED_ROE` from leaking further into the app; `isProtected` stays because it is the boolean every existing call site actually wants.

**`tunnelAt` folds in the identification gate deliberately.** The app's inline scan (`main.ts:857-862`) tests three things together: `tnAlive[r] === 1`, `tunnelContactLevel(0, r) === 2`, and `tunnelUnderTile(r, tx, ty)`. Keep all three inside the query so the call site cannot forget one. Side 0 is the player, matching the existing scan.

- [ ] **Step 1: Write the failing test**

Create `packages/sim/src/queries.test.ts`:

```ts
// Read-only queries the app used to do by hand.
//
// Each replaces an inline lookup in packages/app/src/main.ts. They exist so
// one resolver can answer "what would clicking here do" without the app
// importing sim constants or hand-rolling a scan over tunnel routes.
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';
import { PROTECTED_ROE } from './structures';

const HOUSE = { id: 'house', name: 'House', hp_per_tile: 200, garrison_slots: 2, rubble_cover: 2 };
const SHRINE = { id: 'shrine', name: 'Shrine', hp_per_tile: 200, garrison_slots: 0, rubble_cover: 1, low_profile: true, roe_penalty: 30 };
const FENCE = { id: 'wall', name: 'Compound Wall', hp_per_tile: 200, garrison_slots: 0, rubble_cover: 1, low_profile: true, standing_cover: 2 };
const APARTMENT = { id: 'apartment', name: 'Apartment', hp_per_tile: 300, garrison_slots: 4, rubble_cover: 2, roe_penalty: 14 };

const ROUTE = { id: 'q_route', points: [[5, 5], [9, 5]] as const, dig_tiles_per_s: 1 };

/** mark_tunnel and nothing else — the walk-by scout's shape. */
const SCOUT: UnitTypeJson = {
  id: 'q_scout',
  role: 'infantry',
  hull: { hp: 300, armor: { front: 8, side: 8, rear: 8 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 20, signature: 0.5 },
  abilities: ['mark_tunnel'],
};

const RIFLE: UnitTypeJson = {
  id: 'q_rifle',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
  abilities: ['garrison'],
};

/** A bare 24x24 world with no structures and no tunnels. */
function bare(): Sim {
  return new Sim({ seed: 5, width: 24, height: 24, capacity: 16 });
}

/** addStructure takes FLAT tile indices, not coordinates. */
const tileIdx = (sim: Sim, x: number, y: number): number => y * sim.width + x;

describe('tunnelAt', () => {
  it('returns -1 on a map with no tunnels at all', () => {
    expect(bare().tunnelAt(5, 5)).toBe(-1);
  });

  it('refuses a route the player has not identified, even standing on it', () => {
    // The gate is the point: tunnelUnderTile says yes and tunnelAt still says
    // no. Without this pairing the next case would pass on a query that
    // ignored contact level entirely.
    const sim = bare();
    const r = sim.addTunnel(ROUTE);
    expect(sim.tunnelUnderTile(r, 5, 5)).toBe(true);
    expect(sim.tunnelContactLevel(0, r)).toBeLessThan(2);
    expect(sim.tunnelAt(5, 5)).toBe(-1);
  });

  it('returns the route once identified, and only under its own tiles', () => {
    const sim = bare();
    const r = sim.addTunnel(ROUTE);
    const scout = sim.spawn(sim.addUnitType(SCOUT), 0, fx.from(7.5), fx.from(6.5));
    expect(scout).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 20 * TICKS_PER_SECOND && sim.tunnelContactLevel(0, r) < 2; i++) sim.tick();
    expect(sim.tunnelContactLevel(0, r)).toBe(2);
    expect(sim.tunnelAt(5, 5)).toBe(r);
    expect(sim.tunnelAt(20, 20)).toBe(-1);
  });
});

describe('structure queries', () => {
  it('reads a penalty back and calls the shrine protected', () => {
    const sim = bare();
    const s = sim.addStructure(sim.addStructureType(SHRINE), [tileIdx(sim, 3, 3)]);
    expect(sim.structureRoePenalty(s)).toBe(30);
    expect(sim.structureRoePenalty(s)).toBeGreaterThanOrEqual(PROTECTED_ROE);
    expect(sim.isProtected(s)).toBe(true);
  });

  it('leaves an apartment unprotected but not free — the middle tier', () => {
    const sim = bare();
    const s = sim.addStructure(sim.addStructureType(APARTMENT), [tileIdx(sim, 8, 8)]);
    expect(sim.isProtected(s)).toBe(false);
    expect(sim.structureRoePenalty(s)).toBe(14);
  });

  it('gives a wall no penalty at all', () => {
    const sim = bare();
    const s = sim.addStructure(sim.addStructureType(FENCE), [tileIdx(sim, 20, 20)]);
    expect(sim.structureRoePenalty(s)).toBe(0);
    expect(sim.isProtected(s)).toBe(false);
  });

  it('reports garrison space and counts an occupant against it', () => {
    const sim = bare();
    const s = sim.addStructure(sim.addStructureType(HOUSE), [tileIdx(sim, 12, 12)]);
    expect(sim.garrisonFree(s)).toBe(2);
    const id = sim.spawn(sim.addUnitType(RIFLE), 0, fx.from(12.5), fx.from(13.5));
    sim.queueCommand({ kind: 'garrison', ids: [id], structure: s });
    for (let i = 0; i < 30 * TICKS_PER_SECOND && sim.garrisonFree(s) === 2; i++) sim.tick();
    expect(sim.garrisonFree(s)).toBe(1);
  });

  it('reports zero free slots for a structure nobody can garrison', () => {
    const sim = bare();
    const s = sim.addStructure(sim.addStructureType(FENCE), [tileIdx(sim, 21, 21)]);
    expect(sim.garrisonFree(s)).toBe(0);
  });
});
```

**These fixtures are copied from the real ones** — `SHRINE`/`HOUSE`/`FENCE` from `packages/sim/src/breach.test.ts:10-30`, the route shape and the `mark_tunnel` scout from `packages/sim/src/determinism.test.ts:77` and `:148-156`. `addStructure(typeIdx, tiles)` takes flat tile indices via `addStructureType` first; there is **no** `addStructure({type, x, y})` and **no** debug identification hook.

**Two cases may need their scaffolding adjusted, and adjusting it is expected rather than a failure.** The identified-tunnel case drives contact through a `mark_tunnel` carrier with line of sight — if it does not reach level 2 inside the tick budget, read how `packages/sim/src/mission.test.ts` drives tunnel identification and copy that. The garrison case assumes the order completes within 30 s of sim time.

**Adjust scaffolding, never an assertion.** The values 30, 14, 0, 2 and 1 are the behaviour being pinned.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/sim/src/queries.test.ts`
Expected: FAIL — the four methods do not exist. If a case fails for a *different* reason (a missing `addTunnel`, say), fix the test's scaffolding first; the four failures must be about the four methods.

- [ ] **Step 3: Implement the queries**

In `packages/sim/src/sim.ts`, directly after `structureAt`:

```ts
  /** Living, player-identified tunnel route under a tile, or -1.
   *
   *  The identification gate lives here on purpose. The app used to test
   *  alive + contact level + tile membership as three separate conditions at
   *  the call site, which is three chances to forget one. Contact level 2 is
   *  the same gate stepTunnelCharge enforces, so the player is never offered
   *  an order the sim would refuse. */
  tunnelAt(x: number, y: number): number {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    for (let r = 0; r < this.tunnelCount; r++) {
      if (this.tnAlive[r] === 1 && this.tunnelContactLevel(0, r) === 2 && this.tunnelUnderTile(r, tx, ty)) {
        return r;
      }
    }
    return -1;
  }

  /** ROE cost of levelling this structure. Exposed as a number, not just a
   *  boolean, because the cursor needs three tiers: protected, costly, free. */
  structureRoePenalty(structIdx: number): number {
    return this.structureTypes[this.structures.typeIdx[structIdx]].roePenalty;
  }

  /** A protected site — the mosque case. Kept as its own query so the app
   *  does not import PROTECTED_ROE to ask a sim question. */
  isProtected(structIdx: number): boolean {
    return this.structureRoePenalty(structIdx) >= PROTECTED_ROE;
  }

  /** Free garrison slots, 0 for anything that cannot be garrisoned. */
  garrisonFree(structIdx: number): number {
    const slots = this.structureTypes[this.structures.typeIdx[structIdx]].garrisonSlots;
    const used = this.structures.occupants[structIdx];
    return slots > used ? slots - used : 0;
  }
```

**`Math.floor` is permitted here**: invariant 2 bans `Math.*` in the sim's *arithmetic*, and the existing `structureAt` call sites already floor world coordinates the same way. If lint rejects it, floor at the call site instead and take `tunnelAt(tx: number, ty: number)` as integer tile coordinates — **report which you did.**

If `PROTECTED_ROE` is not already imported into `sim.ts`, import it from `./structures`.

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run packages/sim/src/queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the pin did not move**

Run: `pnpm test:determinism`
Expected: PASS with `1639983699`. These queries add no state and no tick-path work. **If it moved, stop and report BLOCKED.**

- [ ] **Step 6: Commit**

```bash
git add packages/sim/src/sim.ts packages/sim/src/queries.test.ts
git commit
```

Message: `feat(sim): four read-only queries the app was doing by hand`.

---

### Task 2: The resolver, pure and unwired

**Files:**
- Modify: `packages/app/src/input/intents.ts`
- Test: `packages/app/src/input/resolve.test.ts`

**Interfaces:**
- Consumes: Task 1's four queries — but **only through the `IntentWorld` port below**, never by importing `Sim`. `intents.ts` has no sim dependency today and must not gain one.
- Produces:
  - `export type RoeTier = 'free' | 'costly' | 'protected'`
  - `export interface IntentWorld { ... }`
  - `export interface Resolution { intents: PlayerIntent[]; roe: RoeTier; marker: boolean; note?: { text: string; tone: 'info' | 'mute' } }`
  - `export function resolvePointer(world: IntentWorld, ctx: PointerContext): Resolution`

**The key design fact: there is no new intent vocabulary.** `PlayerIntent` (`intents.ts:21`) already names every verb a click can produce. The resolver returns the *ordered sequence* the click would dispatch, so a parity test is an array comparison against a type the codebase already exercises.

`Resolution` carries the other three things the handler does today — `renderer.addOrderMarker` becomes `marker`, `hud.note` becomes `note`, and `roe` is the tier slice 2 will draw. **Nothing in slice 1 reads `roe`;** it is computed and returned so the resolver is complete when the cursor arrives.

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/input/resolve.test.ts`:

```ts
// The right-click decision, as a pure function.
//
// This tree lived inline in main.ts's contextmenu handler and had no tests at
// all. It is lifted here so slice 2's cursor can ask "what would this click
// do" and get the same answer the click gives -- two code paths would drift,
// and the failure mode is a cursor that promises what the click will not do.
import { describe, expect, it } from 'vitest';
import { resolvePointer, type IntentWorld } from './intents';

/** A world where nothing exists unless a test says it does. */
function emptyWorld(over: Partial<IntentWorld> = {}): IntentWorld {
  return {
    structureAt: () => -1,
    tunnelAt: () => -1,
    isProtected: () => false,
    structureRoePenalty: () => 0,
    garrisonFree: () => 0,
    canDemolish: () => false,
    canGarrison: () => false,
    canTunnelCharge: () => false,
    inFlaggedZone: () => false,
    ...over,
  };
}

describe('right-clicking open ground', () => {
  it('is one attack-move for the whole selection', () => {
    const r = resolvePointer(emptyWorld(), { ids: [1, 2], x: 4.5, y: 6.5, append: false });
    expect(r.intents).toEqual([
      { kind: 'order', verb: 'attackMove', ids: [1, 2], x: 4.5, y: 6.5, append: false },
    ]);
    expect(r.marker).toBe(true);
    expect(r.roe).toBe('free');
  });

  it('passes Shift through as append — the waypoint rule', () => {
    const r = resolvePointer(emptyWorld(), { ids: [1], x: 1.5, y: 1.5, append: true });
    expect(r.intents[0]).toMatchObject({ kind: 'order', append: true });
  });

  it('does nothing at all with an empty selection', () => {
    const r = resolvePointer(emptyWorld(), { ids: [], x: 1.5, y: 1.5, append: false });
    expect(r.intents).toEqual([]);
    expect(r.marker).toBe(false);
  });
});

describe('right-clicking a building', () => {
  const world = (over: Partial<IntentWorld> = {}): IntentWorld =>
    emptyWorld({ structureAt: () => 7, garrisonFree: () => 2, ...over });

  it('splits a mixed selection three ways, in order', () => {
    const r = resolvePointer(
      world({ canDemolish: (i) => i === 1, canGarrison: (i) => i === 2 }),
      { ids: [1, 2, 3], x: 3.5, y: 3.5, append: false }
    );
    expect(r.intents).toEqual([
      { kind: 'demolish', ids: [1], structure: 7 },
      { kind: 'garrison', ids: [2], structure: 7 },
      { kind: 'order', verb: 'attackMove', ids: [3], x: 3.5, y: 3.5, append: false },
    ]);
  });

  it('omits an empty group rather than dispatching it', () => {
    const r = resolvePointer(world({ canGarrison: () => true }), {
      ids: [2],
      x: 3.5,
      y: 3.5,
      append: false,
    });
    expect(r.intents).toEqual([{ kind: 'garrison', ids: [2], structure: 7 }]);
  });

  it('levels a protected site only for a selection that is all demolishers', () => {
    const pure = resolvePointer(
      world({ isProtected: () => true, structureRoePenalty: () => 30, canDemolish: () => true }),
      { ids: [1, 2], x: 3.5, y: 3.5, append: false }
    );
    expect(pure.intents).toEqual([{ kind: 'demolish', ids: [1, 2], structure: 7 }]);
    expect(pure.roe).toBe('protected');
  });

  it('and turns the same click into a move when anything else is selected', () => {
    // The mosque bug: an ambiguous click past a protected site used to give
    // the D9 a 30-point demolish order while everything else attack-moved.
    const mixed = resolvePointer(
      world({ isProtected: () => true, structureRoePenalty: () => 30, canDemolish: (i) => i === 1 }),
      { ids: [1, 2], x: 3.5, y: 3.5, append: false }
    );
    expect(mixed.intents).toEqual([
      { kind: 'order', verb: 'attackMove', ids: [1, 2], x: 3.5, y: 3.5, append: false },
    ]);
  });
});

describe('right-clicking an identified tunnel', () => {
  const tunnelWorld = (over: Partial<IntentWorld> = {}): IntentWorld =>
    emptyWorld({ tunnelAt: () => 3, ...over });

  it('sends charge teams and attack-moves everyone else', () => {
    const r = resolvePointer(tunnelWorld({ canTunnelCharge: (i) => i === 9 }), {
      ids: [9, 4],
      x: 8.5,
      y: 2.5,
      append: false,
    });
    expect(r.intents).toEqual([
      { kind: 'chargeTunnel', ids: [9], tunnel: 3 },
      { kind: 'order', verb: 'attackMove', ids: [4], x: 8.5, y: 2.5, append: false },
    ]);
    expect(r.note?.tone).toBe('info');
  });

  it('falls through to an ordinary order when nobody can charge', () => {
    const r = resolvePointer(tunnelWorld(), { ids: [4], x: 8.5, y: 2.5, append: false });
    expect(r.intents).toEqual([
      { kind: 'order', verb: 'attackMove', ids: [4], x: 8.5, y: 2.5, append: false },
    ]);
    expect(r.note).toBeUndefined();
  });

  it('prefers the building when a structure and a tunnel share a tile', () => {
    // main.ts returns inside the structure branch, so the tunnel is never
    // reached. Pinned because it is invisible in the source.
    const r = resolvePointer(
      tunnelWorld({ structureAt: () => 7, canTunnelCharge: () => true, canGarrison: () => true }),
      { ids: [9], x: 8.5, y: 2.5, append: false }
    );
    expect(r.intents[0]?.kind).toBe('garrison');
  });
});

describe('the ROE tier', () => {
  it('is free over open ground and over a zero-penalty structure', () => {
    expect(resolvePointer(emptyWorld(), { ids: [1], x: 1.5, y: 1.5, append: false }).roe).toBe('free');
    expect(
      resolvePointer(emptyWorld({ structureAt: () => 7, structureRoePenalty: () => 0 }), {
        ids: [1], x: 1.5, y: 1.5, append: false,
      }).roe
    ).toBe('free');
  });

  it('is costly for a penalty below the protected threshold', () => {
    const r = resolvePointer(
      emptyWorld({ structureAt: () => 7, structureRoePenalty: () => 14 }),
      { ids: [1], x: 1.5, y: 1.5, append: false }
    );
    expect(r.roe).toBe('costly');
  });

  it('is protected inside a flagged zone even on open ground', () => {
    const r = resolvePointer(emptyWorld({ inFlaggedZone: () => true }), {
      ids: [1], x: 1.5, y: 1.5, append: false,
    });
    expect(r.roe).toBe('protected');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/app/src/input/resolve.test.ts`
Expected: FAIL — `resolvePointer` is not exported. Every case fails at import.

- [ ] **Step 3: Implement the resolver**

Append to `packages/app/src/input/intents.ts`:

```ts
/** How much a click here costs against the rules of engagement. Three tiers,
 *  because the data supports three: a mosque (30) is protected, an apartment
 *  (14) is costly, a wall (0) is free. */
export type RoeTier = 'free' | 'costly' | 'protected';

/** The narrow slice of the world the resolver needs — so a test can describe
 *  a situation instead of building a Sim, exactly as CommandSink does for
 *  applyIntent. No Sim import: intents.ts has no sim dependency and must not
 *  gain one. */
export interface IntentWorld {
  structureAt(x: number, y: number): number;
  tunnelAt(x: number, y: number): number;
  isProtected(structIdx: number): boolean;
  structureRoePenalty(structIdx: number): number;
  garrisonFree(structIdx: number): number;
  canDemolish(id: number): boolean;
  canGarrison(id: number): boolean;
  canTunnelCharge(id: number): boolean;
  /** Mission-declared no-fire zone. Wired in slice 2; false until then. */
  inFlaggedZone(x: number, y: number): boolean;
}

export interface PointerContext {
  /** Already filtered to living units on side 0 by the caller. */
  ids: number[];
  x: number;
  y: number;
  append: boolean;
}

/** Everything the click does, as data: the intents to dispatch in order, the
 *  ROE tier of what is under the pointer, whether to drop an order marker,
 *  and any HUD note. */
export interface Resolution {
  intents: PlayerIntent[];
  roe: RoeTier;
  marker: boolean;
  note?: { text: string; tone: 'info' | 'mute' };
}

/**
 * What a right-click here means.
 *
 * Lifted verbatim from main.ts's contextmenu handler so that one decision can
 * serve two callers: the click dispatches the result, and slice 2's cursor
 * draws it. Written as two code paths they would drift, and the failure mode
 * is a cursor that confidently promises an order the click does not issue.
 *
 * Order matters and is preserved: structure, then identified tunnel, then
 * ordinary attack-move. A structure wins a tile it shares with a tunnel
 * because the structure branch returns first.
 */
export function resolvePointer(world: IntentWorld, ctx: PointerContext): Resolution {
  const { ids, x, y, append } = ctx;
  const roe = roeTierAt(world, x, y);
  if (ids.length === 0) return { intents: [], roe, marker: false };

  const struct = world.structureAt(x, y);
  if (struct >= 0) {
    const { razers, enterers, rest } = sortStructureOrder(
      ids,
      (i) => world.canDemolish(i),
      (i) => world.canGarrison(i),
      world.isProtected(struct)
    );
    const intents: PlayerIntent[] = [];
    if (razers.length > 0) intents.push({ kind: 'demolish', ids: razers, structure: struct });
    if (enterers.length > 0) intents.push({ kind: 'garrison', ids: enterers, structure: struct });
    if (rest.length > 0) {
      intents.push({ kind: 'order', verb: 'attackMove', ids: rest, x, y, append: false });
    }
    return { intents, roe, marker: true };
  }

  const route = world.tunnelAt(x, y);
  if (route >= 0) {
    const chargers = ids.filter((i) => world.canTunnelCharge(i));
    if (chargers.length > 0) {
      const rest = ids.filter((i) => !world.canTunnelCharge(i));
      const intents: PlayerIntent[] = [{ kind: 'chargeTunnel', ids: chargers, tunnel: route }];
      if (rest.length > 0) {
        intents.push({ kind: 'order', verb: 'attackMove', ids: rest, x, y, append: false });
      }
      return {
        intents,
        roe,
        marker: true,
        note: { text: '<b>tunnel charge</b> — team moving to the route', tone: 'info' },
      };
    }
    // Nobody can charge: fall through to the ordinary order, as main.ts does.
  }

  return {
    intents: [{ kind: 'order', verb: 'attackMove', ids, x, y, append }],
    roe,
    marker: true,
  };
}

/** The tier of whatever is under the pointer. A mission-flagged zone is
 *  protected regardless of what stands on it. */
function roeTierAt(world: IntentWorld, x: number, y: number): RoeTier {
  if (world.inFlaggedZone(x, y)) return 'protected';
  const struct = world.structureAt(x, y);
  if (struct < 0) return 'free';
  if (world.isProtected(struct)) return 'protected';
  return world.structureRoePenalty(struct) > 0 ? 'costly' : 'free';
}
```

**Note the two `append: false` values inside the structure and tunnel branches.** That is not a slip — `main.ts` hardcodes `append: false` there and only passes `ev.shiftKey` on the final fall-through. Preserving it is the point of the slice.

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run packages/app/src/input/resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the tests discriminate**

A parity suite that passes against a broken resolver is worthless, and this project has shipped four such tests. Break the resolver three ways, one at a time, and confirm the expected case goes red each time:

1. Swap the structure and tunnel branches (tunnel checked first) → the shared-tile case must fail.
2. Pass `append` instead of `false` inside the structure branch → no test may fail. **If none does, add a case that catches it** and say so in your report.
3. Drop the `razers.length > 0` guard so an empty demolish intent is emitted → the "omits an empty group" case must fail.

Restore after each by editing back — never `git checkout`. Confirm `git diff packages/app/src/input/intents.ts` shows only your intended change before committing. **Report the outcome of all three.**

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/input/intents.ts packages/app/src/input/resolve.test.ts
git commit
```

Message: `feat(app): the right-click decision becomes a pure function`.

---

### Task 3: Wire the click to the resolver

**Files:**
- Modify: `packages/app/src/main.ts` (`contextmenu`, `:809-882`)

**Interfaces:**
- Consumes: `resolvePointer`, `IntentWorld`, `Resolution` from Task 2; the four queries from Task 1.
- Produces: an `IntentWorld` adapter over the live `Sim`, used again by Task 4 and by slice 2.

**This task must change nothing observable.** The handler shrinks to: build the world adapter, resolve, dispatch each intent in order, drop the marker, show the note.

- [ ] **Step 1: Replace the handler body**

In `main.ts`, define the adapter once near the other input wiring (above the `contextmenu` listener):

```ts
  // The resolver's view of the world. One adapter, so the click and (in slice
  // 2) the hover cursor ask the same object the same questions.
  const intentWorld: IntentWorld = {
    structureAt: (x, y) => sim.structureAt(Math.floor(x), Math.floor(y)),
    tunnelAt: (x, y) => sim.tunnelAt(x, y),
    isProtected: (s) => sim.isProtected(s),
    structureRoePenalty: (s) => sim.structureRoePenalty(s),
    garrisonFree: (s) => sim.garrisonFree(s),
    canDemolish: (i) => sim.unitTypes[sim.state.typeIdx[i]].canDemolish,
    canGarrison: (i) => sim.unitTypes[sim.state.typeIdx[i]].canGarrison,
    canTunnelCharge: (i) => sim.unitTypes[sim.state.typeIdx[i]].canTunnelCharge,
    // Slice 2 wires this to the mission's roe.flagged_zones. Until then the
    // tier comes from the structure alone, which is what ships today.
    inFlaggedZone: () => false,
  };
```

Then the handler becomes:

```ts
  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const w = renderer.screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    const mine = renderer.selection.filter((i) => sim.state.side[i] === 0 && sim.state.alive[i] === 1);
    const res = resolvePointer(intentWorld, { ids: mine, x: w.x, y: w.y, append: ev.shiftKey });
    for (const intent of res.intents) dispatch(intent);
    if (res.note) hud.note(res.note.text, res.note.tone);
    if (res.marker) renderer.addOrderMarker(w.x, w.y);
  });
```

Delete the now-dead `sortStructureOrder` call, the inline `isProtected` expression, and the inline tunnel scan from the handler. **Keep the explanatory comments** — move the ones about sapper precedence and the identified-only tunnel gate onto `resolvePointer`, where the logic now lives. A comment left behind describing code that moved is worse than no comment.

If `PROTECTED_ROE` is now unused in `main.ts`, remove the import; `pnpm lint` will say so.

- [ ] **Step 2: Verify by suite, not by eye**

Run: `pnpm test`
Expected: all pass. Note the total.

Run: `pnpm typecheck` and `pnpm lint`
Expected: clean. Typecheck is what catches an adapter whose shape does not match `IntentWorld`.

- [ ] **Step 3: Prove the wiring is live**

A resolver nothing calls would still pass every test above. Temporarily make `resolvePointer` return `{ intents: [], roe: 'free', marker: false }` as its first statement, run `pnpm test`, and confirm `resolve.test.ts` goes red. Restore by editing back and confirm `git diff` is clean.

This proves the tests cover the resolver. It does **not** prove `main.ts` calls it — nothing headless can, since the handler needs a DOM. Say so plainly in your report rather than implying coverage you do not have.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main.ts
git commit
```

Message: `refactor(app): the click asks the resolver`.

---

### Task 4: Fold in the strays

**Files:**
- Modify: `packages/app/src/input/intents.ts`
- Modify: `packages/app/src/main.ts` (`g` `:910`, `u` `:924`, `f` `:930`, and `pointerup` `:773-796`)
- Test: `packages/app/src/input/resolve.test.ts`

**Interfaces:**
- Consumes: `IntentWorld`, `Resolution` from Task 2.
- Produces: `export function resolveKeyVerb(world: IntentWorld, verb: 'mount' | 'dismount' | 'smoke', ctx: KeyContext): Resolution`

**Why.** `mount`, `dismount` and `smoke` are keyboard branches with their own inline eligibility filters, and `armedSupport` is a second state machine with its own early return. Leaving them out would make the resolver the single source of truth for everything *except* the modes that already exist.

**Their triggers do not change.** `g`, `u` and `f` keep working exactly as now; only the decision moves.

- [ ] **Step 1: Write the failing test**

Append to `packages/app/src/input/resolve.test.ts`:

```ts
describe('the keyboard verbs, resolved the same way', () => {
  const world = (over: Partial<IntentWorld> = {}): IntentWorld =>
    emptyWorld({ ...over }) as IntentWorld;

  it('mounts riders into the one carrier', () => {
    const r = resolveKeyVerb(world(), 'mount', {
      ids: [1, 2, 3],
      x: 0, y: 0,
      isCarrier: (i) => i === 1,
      canEmbark: (i) => i !== 1,
      canSmoke: () => false,
      passengerCount: () => 0,
    });
    expect(r.intents).toEqual([{ kind: 'mount', riders: [2, 3], carrier: 1 }]);
    expect(r.note?.tone).toBe('info');
  });

  it('explains itself when there is no carrier', () => {
    const r = resolveKeyVerb(world(), 'mount', {
      ids: [2, 3], x: 0, y: 0,
      isCarrier: () => false, canEmbark: () => true,
      canSmoke: () => false, passengerCount: () => 0,
    });
    expect(r.intents).toEqual([]);
    expect(r.note?.tone).toBe('mute');
  });

  it('dismounts only carriers that hold somebody', () => {
    const r = resolveKeyVerb(world(), 'dismount', {
      ids: [1, 2], x: 0, y: 0,
      isCarrier: () => true, canEmbark: () => false,
      canSmoke: () => false, passengerCount: (i) => (i === 1 ? 2 : 0),
    });
    expect(r.intents).toEqual([{ kind: 'dismount', carriers: [1] }]);
  });

  it('lays smoke at the point, from whoever carries it', () => {
    const r = resolveKeyVerb(world(), 'smoke', {
      ids: [4, 5], x: 9.5, y: 2.5,
      isCarrier: () => false, canEmbark: () => false,
      canSmoke: (i) => i === 4, passengerCount: () => 0,
    });
    expect(r.intents).toEqual([{ kind: 'smoke', ids: [4], x: 9.5, y: 2.5 }]);
    expect(r.marker).toBe(true);
  });

  it('says so when nothing selected carries smoke', () => {
    const r = resolveKeyVerb(world(), 'smoke', {
      ids: [5], x: 9.5, y: 2.5,
      isCarrier: () => false, canEmbark: () => false,
      canSmoke: () => false, passengerCount: () => 0,
    });
    expect(r.intents).toEqual([]);
    expect(r.marker).toBe(false);
    expect(r.note?.tone).toBe('mute');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/app/src/input/resolve.test.ts`
Expected: the five new cases fail — `resolveKeyVerb` is not exported. The Task 2 cases still pass.

- [ ] **Step 3: Implement it**

Append to `intents.ts`:

```ts
export interface KeyContext {
  ids: number[];
  /** Where the cursor is, for smoke. Ignored by mount and dismount. */
  x: number;
  y: number;
  isCarrier(id: number): boolean;
  canEmbark(id: number): boolean;
  canSmoke(id: number): boolean;
  passengerCount(id: number): number;
}

/**
 * The three verbs the keyboard owns, resolved through the same door as the
 * mouse. Their bindings are unchanged — g, u and f still trigger them. What
 * moves is the decision, so that slice 2's cursor can ask what `g` would do
 * right now instead of re-deriving the eligibility rules a second time.
 */
export function resolveKeyVerb(
  _world: IntentWorld,
  verb: 'mount' | 'dismount' | 'smoke',
  ctx: KeyContext
): Resolution {
  const free: RoeTier = 'free';
  if (verb === 'mount') {
    const { carrier, riders } = sortMount(ctx.ids, ctx.isCarrier, ctx.canEmbark);
    if (carrier === undefined || riders.length === 0) {
      return {
        intents: [],
        roe: free,
        marker: false,
        note: { text: 'select a transport and the infantry to load', tone: 'mute' },
      };
    }
    return {
      intents: [{ kind: 'mount', riders, carrier }],
      roe: free,
      marker: false,
      note: { text: '<b>mount up</b> — infantry boarding', tone: 'info' },
    };
  }
  if (verb === 'dismount') {
    const carriers = ctx.ids.filter((i) => ctx.passengerCount(i) > 0);
    if (carriers.length === 0) return { intents: [], roe: free, marker: false };
    return {
      intents: [{ kind: 'dismount', carriers }],
      roe: free,
      marker: false,
      note: { text: '<b>dismount</b> — infantry debussing', tone: 'info' },
    };
  }
  const smokers = ctx.ids.filter((i) => ctx.canSmoke(i));
  if (smokers.length === 0) {
    return {
      intents: [],
      roe: free,
      marker: false,
      note: { text: 'nothing selected that carries smoke', tone: 'mute' },
    };
  }
  return {
    intents: [{ kind: 'smoke', ids: smokers, x: ctx.x, y: ctx.y }],
    roe: free,
    marker: true,
  };
}
```

`_world` is unused today and named with a leading underscore for lint. It is in the signature because slice 2's cursor asks the same question about a *hovered tile*, where the ROE tier does matter — changing the signature later would touch every call site.

**If lint rejects an unused parameter even underscored, drop it** and add `world` back in slice 2. Report which you did.

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run packages/app/src/input/resolve.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Wire the three keys**

Replace the bodies of the `g`, `u` and `f` branches in `main.ts` with calls that build a `KeyContext` from `renderer.selection` (filtered to living side-0 units, exactly as they do now) and act on the `Resolution` the same way Task 3's handler does — dispatch each intent, show the note, drop the marker if asked. For `f`, the point is `renderer.screenToWorld(lastCursor.x, lastCursor.y)`.

**Do not change the keys, the filters' meaning, or the note text.** The strings are asserted in Step 1.

- [ ] **Step 6: Route the armed-support click through the resolver**

In `pointerup` (`main.ts:773-796`), the armed-support early return stays — but it should ask rather than read the flag directly. Give the resolution a shape the cursor can use in slice 2:

```ts
      if (armedSupport !== null) {
        const w = renderer.screenToWorld(p.x, p.y);
        // Armed support is what the pointer means right now; the resolver says
        // so, rather than a flag read at one call site and nowhere else.
        const call = armedSupport;
        armedSupport = null;
        production?.setArmed(null);
        if (call === 'sweep') runtime.requestSweep(w.x, w.y);
        else runtime.requestStrike(w.x, w.y);
        return;
      }
```

If the existing code already does exactly this minus the comment, **leave it alone and say so** — the point is that slice 2 can see the armed state, not that this block must be rewritten for its own sake.

- [ ] **Step 7: Full sweep**

| Gate | Expectation |
|---|---|
| `pnpm test` | passes; note the total |
| `pnpm test:determinism` | **`1639983699`, UNMOVED** |
| `pnpm typecheck` / `pnpm lint` | clean |
| `pnpm validate:data` | 70 files |
| `pnpm validate:ui` | 18 files clean |
| `pnpm build` | succeeds |
| `pnpm balance` | five §5.7 figures unchanged |
| `pnpm playtest` | exits 1 on exactly `beit_sahwan_breach (passive control)` and `beit_sahwan_3_clearance` |

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/input/intents.ts packages/app/src/input/resolve.test.ts packages/app/src/main.ts
git commit
```

Message: `refactor(app): the keyboard verbs ask the same resolver`.

---

## Self-review

**Spec coverage.** One resolver, two callers → Tasks 2 and 3. The three (now four) sim queries → Task 1. ROE as a three-tier verdict → Task 2's `roeTierAt` and its four tier cases. Fold in the strays → Task 4. Click parity as the gate → Task 2's structure/tunnel/ground cases plus Task 3's suite run. Performance (no second entity scan) → satisfied by construction: the resolver takes ids the caller already filtered and never scans entities. Nothing observable changes → no task touches rendering.

**Two spec deviations, both deliberate and both recorded above.** The spec named three sim queries; this plan adds `structureRoePenalty` because `isProtected` alone cannot separate *costly* from *free*. And the spec's follow-on slice proposed Shift-to-confirm, which is impossible — Shift is already the waypoint-append modifier at `main.ts:881`.

**Placeholder scan.** No TBD, no "handle edge cases", no "similar to Task N". Every code step carries its code; every test step carries its assertions.

**Type consistency.** `IntentWorld`, `PointerContext`, `KeyContext`, `Resolution`, `RoeTier`, `resolvePointer`, `resolveKeyVerb` are defined in Tasks 1–2 and used under those exact names in Tasks 3–4. `Resolution.note.tone` is `'info' | 'mute'`, matching `hud.note`'s existing argument. The resolver returns `PlayerIntent[]`, the union already declared at `intents.ts:21` — no new vocabulary anywhere.
