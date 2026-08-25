# Contextual Cursor Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cursor name the verb — garrison, demolish, charge, mount, dismount, smoke — and wear a role badge saying who is doing it.

**Architecture:** A role classifier is extracted from `hud.ts` so the cursor and the inspect card bucket a unit identically. `cursorFor` gains verb rungs ordered by destructiveness. A separate `badgeFor` picks the winning intent's bucket and suppresses the badge when that group is mixed. The Vite plugin generates one rule per reachable `name-badge` pair, and a test asserts every generated selector matches a real DOM node.

**Tech Stack:** TypeScript (strict), vitest (`environment: 'node'`, jsdom in-test where a DOM is needed), Vite plugin API, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-25-cursor-slice-3-design.md`

## Global Constraints

- **The determinism pin must NOT move.** It reads `1639983699` in `packages/sim/src/determinism.test.ts`. This slice touches no sim code at all. **A moved pin is a BLOCKED report, never a value to update.**
- **`pnpm validate:ui` must stay clean with zero violations.** It scans `.ts`, `.css`, `.html`, `.svg` under `packages/app/src` and `assets/campaign`, rejecting hex and `rgb()/rgba()` literals **with no allowlist**, and any raw `--rl-*` outside `theme.css`. **The file count will grow as this slice adds in-scope files — that is correct.** Watch the violation count, not the file count.
- **Cursor colour lives only in `packages/app/vite-plugin-cursors.ts`**, outside those scan roots. Nothing under `packages/app/src` may hold a colour.
- **No DOM in `packages/app/src/input/`** — those tests run in `environment: 'node'`.
- **Never** run `git add -A`, `git add .`, `git stash` in any form, or `git checkout <file>` / `git restore <file>`. The stash stack is shared with other live worktrees, and this repository has lost an entire uncommitted feature to `git checkout <file>`. Stage files by name.
- Every commit message ends with these two lines exactly:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
  ```

---

## Two orderings the spec implies but does not pin, decided here

**1. The verb outranks the `costly` tier, and sits below `protected`.**

Buildings are blocked tiles with a non-zero `roe_penalty`, so under slice 2's chain an ordinary house already resolves to `costly` before `blocked` is ever consulted. Add verb rungs naively below `costly` and a `dozer_d9` over a house would show **`costly`** rather than **`demolish`** — the milder, less actionable answer.

So the final order is:

```
armed → refused → no intents → roe protected → THE VERB → roe costly → blocked → hostile → move
```

`protected` stays above the verb because "do not shoot here" outranks "here is what you would do". `costly` drops below it because a verb the player can act on beats a warning they cannot. A tank over a house — no special verb — still shows `costly`, so the tier is not lost, only outranked when something more specific is true.

**2. The destructiveness order, verbatim from the spec, with `attack` derived.**

```
demolish > charge > attack > garrison > mount > dismount > smoke > move
```

`attack` and `move` both come from the same `order` intent; `hints.hostile` separates them. So the winning-verb function tests `demolish`, then `chargeTunnel`, then *`order` with a hostile hint*, then `garrison`, `mount`, `dismount`, `smoke`, then bare `order`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/app/src/ui/role.ts` | **Create.** `RoleBucket`, `roleBucket()`, `ROLE_GLYPH`. | 1 |
| `packages/app/src/ui/role.test.ts` | **Create.** Classifier and the shared-with-HUD proof. | 1 |
| `packages/app/src/ui/hud.ts` | **Modify** (`:391-403`). Use the extracted classifier. | 1 |
| `packages/app/src/input/cursor.ts` | **Modify.** Verb names, `winningVerb`, the new rung order, `cursorKey`. | 2, 3 |
| `packages/app/src/input/cursor.test.ts` | **Modify.** Ordering table, rung guards, badge suppression. | 2, 3 |
| `packages/app/vite-plugin-cursors.ts` | **Modify.** Badged rules, badge marks. | 4 |
| `packages/app/vite-plugin-cursors.test.ts` | **Modify.** Every generated selector matches a real DOM node. | 4 |
| `packages/app/src/main.ts` | **Modify.** Compute the badge, write the composite key. | 5 |

---

### Task 1: One role classifier, two callers

**Files:**
- Create: `packages/app/src/ui/role.ts`
- Modify: `packages/app/src/ui/hud.ts` (the glyph rung at `:391-403`)
- Test: `packages/app/src/ui/role.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type RoleBucket = 'kamikaze' | 'drone' | 'gunship' | 'sniper' | 'transport' | 'soft' | 'armour'`
  - `export function roleBucket(type: { isKamikaze: boolean; role?: string; transportSlots: number; isSoft: boolean }): RoleBucket`
  - `export const ROLE_GLYPH: Record<RoleBucket, string>`

**Why.** `hud.ts:391-403` already buckets units into seven glyphs for the inspect card. The cursor needs the same buckets. Two copies would let the cursor call a unit a transport while its own inspect card calls it soft — and the player would be looking at both at once. Same reasoning as slice 2's `zoneContains`.

**The parameter is structural, not `UnitType`.** Taking the four fields it reads keeps `role.ts` free of a sim import and lets a test describe a unit without building one. `hud.ts` passes its real `type` and structural typing accepts it.

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/ui/role.test.ts`:

```ts
// The role buckets the cursor and the inspect card share.
//
// hud.ts had this rung inline. The cursor needs the same answer, and two
// copies would let the cursor call a unit a transport while the card beside
// it says soft. One classifier, two callers -- the same reasoning as
// zoneContains in the slice before this one.
import { describe, expect, it } from 'vitest';
import { ROLE_GLYPH, roleBucket, type RoleBucket } from './role';

/** The four fields the classifier reads, defaulted to an armour unit. */
function unit(over: Partial<Parameters<typeof roleBucket>[0]> = {}) {
  return { isKamikaze: false, role: 'mbt', transportSlots: 0, isSoft: false, ...over };
}

describe('roleBucket', () => {
  it('puts kamikaze first, above everything it also is', () => {
    // attack_drone is BOTH kamikaze and a drone. The rung order decides, and
    // kamikaze is the more urgent fact about a unit you are about to spend.
    expect(roleBucket(unit({ isKamikaze: true, role: 'drone' }))).toBe('kamikaze');
  });

  it('buckets a drone, a gunship and a sniper by role', () => {
    expect(roleBucket(unit({ role: 'drone' }))).toBe('drone');
    expect(roleBucket(unit({ role: 'gunship' }))).toBe('gunship');
    expect(roleBucket(unit({ role: 'sniper' }))).toBe('sniper');
  });

  it('calls anything with transport slots a transport', () => {
    expect(roleBucket(unit({ role: 'apc', transportSlots: 2 }))).toBe('transport');
  });

  it('puts transport above soft, so a carrier is not merely infantry', () => {
    expect(roleBucket(unit({ role: 'apc', transportSlots: 2, isSoft: true }))).toBe('transport');
  });

  it('calls a soft unit with no slots soft, and everything else armour', () => {
    expect(roleBucket(unit({ role: 'infantry', isSoft: true }))).toBe('soft');
    expect(roleBucket(unit({ role: 'mbt' }))).toBe('armour');
  });

  it('gives every bucket a glyph', () => {
    const buckets: RoleBucket[] = [
      'kamikaze', 'drone', 'gunship', 'sniper', 'transport', 'soft', 'armour',
    ];
    for (const b of buckets) expect(ROLE_GLYPH[b]).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/app/src/ui/role.test.ts`
Expected: FAIL — `./role` does not exist.

- [ ] **Step 3: Implement it**

Create `packages/app/src/ui/role.ts`:

```ts
/**
 * The seven buckets a unit falls into for display.
 *
 * Extracted from hud.ts's inspect-card rung so the cursor's badge and the
 * card's glyph cannot disagree about what a unit is -- the player sees both
 * at once. What is shared is the BUCKET; the two render it differently, the
 * card as a Unicode glyph and the cursor as an SVG path, because font
 * availability inside a cursor image is not something to bet on.
 *
 * Seven and not fourteen because a badge is about 10px in motion, and
 * hud.ts's own comment already calls these a placeholder until the art
 * pipeline produces portraits. When it does, both callers change together.
 */
export type RoleBucket =
  | 'kamikaze'
  | 'drone'
  | 'gunship'
  | 'sniper'
  | 'transport'
  | 'soft'
  | 'armour';

/** Structural on purpose: the four fields it reads, so this module needs no
 *  sim import and a test can describe a unit without building one. */
export function roleBucket(type: {
  isKamikaze: boolean;
  role?: string;
  transportSlots: number;
  isSoft: boolean;
}): RoleBucket {
  if (type.isKamikaze) return 'kamikaze';
  if (type.role === 'drone') return 'drone';
  if (type.role === 'gunship') return 'gunship';
  if (type.role === 'sniper') return 'sniper';
  if (type.transportSlots > 0) return 'transport';
  return type.isSoft ? 'soft' : 'armour';
}

/** The inspect card's glyphs, unchanged from what hud.ts drew inline. */
export const ROLE_GLYPH: Record<RoleBucket, string> = {
  kamikaze: '✹',
  drone: '⬡',
  gunship: '✈',
  sniper: '✛',
  transport: '▤',
  soft: '▲',
  armour: '■',
};
```

- [ ] **Step 4: Adopt it in the HUD**

In `packages/app/src/ui/hud.ts`, replace the nested ternary at `:391-403` with:

```ts
    const glyph = ROLE_GLYPH[roleBucket(type)];
```

and import both from `./role`. **The glyphs must not change** — this is an extraction, and the card must render exactly what it rendered before.

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run packages/app/src/ui/role.test.ts`
Expected: PASS, 6 cases.

Run: `pnpm test`
Expected: all pass. Note the total.

- [ ] **Step 6: Prove the rung order is load-bearing**

Two reorderings, one at a time, each naming the case that must redden:

1. Move the `isKamikaze` check **below** the `role === 'drone'` check → *"puts kamikaze first"* must fail.
2. Move the `transportSlots > 0` check **below** the `isSoft` return → *"puts transport above soft"* must fail.

Restore by editing back — never `git checkout` — and confirm `git diff packages/app/src/ui/role.ts` is empty. **Report both results.**

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/ui/role.ts packages/app/src/ui/role.test.ts packages/app/src/ui/hud.ts
git commit
```

Message: `refactor(app): one role classifier for the card and the cursor`.

---

### Task 2: The cursor names the verb

**Files:**
- Modify: `packages/app/src/input/cursor.ts`
- Test: `packages/app/src/input/cursor.test.ts`

**Interfaces:**
- Consumes: `Resolution` from `./intents`.
- Produces:
  - `CursorName` extended to `'default' | 'move' | 'attack' | 'blocked' | 'costly' | 'protected' | 'support' | 'garrison' | 'demolish' | 'charge' | 'mount' | 'dismount' | 'smoke'`
  - `export function winningVerb(res: Resolution, hints: CursorHints): CursorName | null`

**The new rung order**, and it changes an existing one:

```
armed → refused → no intents → roe protected → THE VERB → roe costly → blocked → hostile → move
```

The verb now sits **above `costly`**. Buildings are blocked tiles with a non-zero `roe_penalty`, so without this a `dozer_d9` over an ordinary house would show `costly` instead of `demolish` — the milder and less actionable answer. `protected` stays above the verb, because "do not shoot here" outranks "here is what you would do".

**Also close the gap slice 2 parked:** `armed` must be pinned above `refused`. Hoisting `refused` over `armed` currently leaves every test green. It is unreachable today only because `resolvePointer` early-returns on `armed` before the structure branch can set `refused` — an implementation invariant, not a type one, and this task reorders the chain.

- [ ] **Step 1: Write the failing test**

Append to `packages/app/src/input/cursor.test.ts`:

```ts
describe('the cursor names the verb', () => {
  const at = (kind: string, extra: Record<string, unknown> = {}) =>
    ({ kind, ids: [1], ...extra }) as unknown as Resolution['intents'][number];

  const res = (intents: Resolution['intents'], over: Partial<Resolution> = {}): Resolution => ({
    intents, roe: 'free', marker: true, ...over,
  });

  it('says demolish, charge, garrison, mount, dismount and smoke', () => {
    expect(cursorFor(res([at('demolish', { structure: 3 })]), NONE)).toBe('demolish');
    expect(cursorFor(res([at('chargeTunnel', { tunnel: 1 })]), NONE)).toBe('charge');
    expect(cursorFor(res([at('garrison', { structure: 3 })]), NONE)).toBe('garrison');
    expect(cursorFor(res([at('mount', { carrier: 2, riders: [1] })]), NONE)).toBe('mount');
    expect(cursorFor(res([at('dismount', { carriers: [1] })]), NONE)).toBe('dismount');
    expect(cursorFor(res([at('smoke', { x: 1, y: 1 })]), NONE)).toBe('smoke');
  });

  it('ranks a mixed click by what it destroys, heaviest first', () => {
    // sortStructureOrder can emit all three at once. One cursor, so it names
    // the worst thing the click will cause.
    const all = res([
      at('demolish', { structure: 3 }),
      at('garrison', { structure: 3 }),
      at('order', { verb: 'attackMove', x: 1, y: 1, append: false }),
    ]);
    expect(cursorFor(all, NONE)).toBe('demolish');
  });

  it('puts charge above garrison when a tunnel click splits', () => {
    const both = res([at('chargeTunnel', { tunnel: 1 }), at('garrison', { structure: 3 })]);
    expect(cursorFor(both, NONE)).toBe('charge');
  });

  it('puts attack above garrison, since firing outranks entering', () => {
    const both = res([at('garrison', { structure: 3 }), at('order', { verb: 'attackMove' })]);
    expect(cursorFor(both, { hostile: true, blocked: false })).toBe('attack');
  });

  it('is the verb over a costly building, not the warning', () => {
    // A house is a blocked tile with a non-zero roe_penalty, so without the
    // verb outranking costly a D9 over a house would read "costly" -- true,
    // milder, and useless next to "you are about to level this".
    const r = res([at('demolish', { structure: 3 })], { roe: 'costly' });
    expect(cursorFor(r, { hostile: false, blocked: true })).toBe('demolish');
  });

  it('but still says protected over a mosque, whatever the verb', () => {
    const r = res([at('demolish', { structure: 3 })], { roe: 'protected' });
    expect(cursorFor(r, NONE)).toBe('protected');
  });

  it('falls back to costly when no special verb applies', () => {
    const r = res([at('order', { verb: 'attackMove' })], { roe: 'costly' });
    expect(cursorFor(r, NONE)).toBe('costly');
  });

  it('keeps armed above refused — the gap slice 2 left open', () => {
    // Unreachable through resolvePointer today, because armed early-returns
    // before the structure branch can set refused. That is an implementation
    // invariant, not a type one: change the resolver and the order starts
    // mattering with nothing to catch it.
    const r = res([], { armed: 'sweep', refused: true });
    expect(cursorFor(r, NONE)).toBe('support');
  });
});
```

If `Resolution` is not already imported in this file, add `import type { Resolution } from './intents';`.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/app/src/input/cursor.test.ts`
Expected: the new cases fail; the existing ones still pass. If an existing case fails, stop — the extension has changed behaviour it should not.

- [ ] **Step 3: Implement the verb rungs**

In `cursor.ts`, widen `CursorName` with the six verb names, then add:

```ts
/** The heaviest thing this click will cause, or null if it is a plain order.
 *
 *  One click can emit demolish, garrison and attack-move at once -- there is
 *  one cursor, so it names the worst outcome. The cost, stated: it hides that
 *  the other two groups are also acting. Ranking by the resolver's dispatch
 *  order instead would key the cursor to an implementation detail. */
export function winningVerb(res: Resolution, hints: CursorHints): CursorName | null {
  const has = (kind: string): boolean => res.intents.some((i) => i.kind === kind);
  if (has('demolish')) return 'demolish';
  if (has('chargeTunnel')) return 'charge';
  if (has('order') && hints.hostile) return 'attack';
  if (has('garrison')) return 'garrison';
  if (has('mount')) return 'mount';
  if (has('dismount')) return 'dismount';
  if (has('smoke')) return 'smoke';
  return null;
}
```

and rebuild the chain in `cursorFor`:

```ts
  if (res.armed) return 'support';
  if (res.refused) return 'protected';
  if (res.intents.length === 0) return 'default';
  if (res.roe === 'protected') return 'protected';
  const verb = winningVerb(res, hints);
  if (verb) return verb;
  if (res.roe === 'costly') return 'costly';
  if (hints.blocked) return 'blocked';
  return hints.hostile ? 'attack' : 'move';
```

Note `winningVerb` returns `'attack'` for a hostile plain order, so the final `hints.hostile` line is now only reached when there are no intents of any ranked kind — keep it, because an unranked future intent kind would otherwise fall through to `move` over a hostile.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/app/src/input/cursor.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Prove the new order is load-bearing**

Four mutations, one at a time, each naming the case that must redden:

1. Move the verb rung **below** `roe === 'costly'` → *"is the verb over a costly building"* must fail.
2. Move the verb rung **above** `roe === 'protected'` → *"but still says protected over a mosque"* must fail.
3. Swap `demolish` and `garrison` inside `winningVerb` → *"ranks a mixed click by what it destroys"* must fail.
4. Move `refused` **above** `armed` → *"keeps armed above refused"* must fail.

Restore after each and confirm `git diff packages/app/src/input/cursor.ts` is empty before committing. **Report all four.** If any produces no failure, add the case that catches it and say so.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/input/cursor.ts packages/app/src/input/cursor.test.ts
git commit
```

Message: `feat(app): the cursor names the verb, heaviest first`.

---

### Task 3: The badge, and when it lies

**Files:**
- Modify: `packages/app/src/input/cursor.ts`
- Test: `packages/app/src/input/cursor.test.ts`

**Interfaces:**
- Consumes: `RoleBucket` from `../ui/role` (**type-only**), `winningVerb` from Task 2.
- Produces:
  - `export interface BadgeHints { bucketOf(id: number): RoleBucket }`
  - `export function badgeFor(res: Resolution, hints: CursorHints, badges: BadgeHints): RoleBucket | null`
  - `export function cursorKey(name: CursorName, badge: RoleBucket | null): string` — `name` when badge is null, `` `${name}-${badge}` `` otherwise

**The suppression rule is the point.** A badge asserts *this kind of unit is doing this*. The winning intent's `ids` may span buckets — an `apc_eitan` and a `demo_squad` can both lay smoke, and they are `transport` and `soft`. **When the winning group is not one bucket, there is no badge**, and the cursor shows the bare verb.

Badges are suppressed entirely for `default`, `blocked`, `costly`, `protected` and `support`: those describe the target or the mode, not the actor.

- [ ] **Step 1: Write the failing test**

Append to `packages/app/src/input/cursor.test.ts`:

```ts
describe('the badge says who is doing it', () => {
  const buckets = (map: Record<number, RoleBucket>): BadgeHints => ({
    bucketOf: (id) => map[id] ?? 'armour',
  });

  const res = (intents: Resolution['intents'], over: Partial<Resolution> = {}): Resolution => ({
    intents, roe: 'free', marker: true, ...over,
  });

  it('badges the winning group when it is one kind', () => {
    const r = res([{ kind: 'demolish', ids: [1, 2], structure: 3 }] as Resolution['intents']);
    expect(badgeFor(r, NONE, buckets({ 1: 'soft', 2: 'soft' }))).toBe('soft');
  });

  it('says nothing when the winning group spans two kinds', () => {
    // An apc_eitan and a demo_squad both lay smoke; they are transport and
    // soft. A badge would have to pick one and would be lying about the other.
    const r = res([{ kind: 'smoke', ids: [1, 2], x: 1, y: 1 }] as Resolution['intents']);
    expect(badgeFor(r, NONE, buckets({ 1: 'transport', 2: 'soft' }))).toBeNull();
  });

  it('badges the WINNING group, not the whole selection', () => {
    // The D9 demolishes and the infantry garrisons. demolish wins, so the
    // badge is the D9's -- the infantry's bucket must not leak into it.
    const r = res([
      { kind: 'demolish', ids: [1], structure: 3 },
      { kind: 'garrison', ids: [2], structure: 3 },
    ] as Resolution['intents']);
    expect(badgeFor(r, NONE, buckets({ 1: 'armour', 2: 'soft' }))).toBe('armour');
  });

  it('gives no badge when there is no verb', () => {
    expect(badgeFor(res([]), NONE, buckets({}))).toBeNull();
  });

  it('gives no badge for an armed support call', () => {
    const r = res([], { armed: 'strike' });
    expect(badgeFor(r, NONE, buckets({ 1: 'soft' }))).toBeNull();
  });
});

describe('cursorKey', () => {
  it('joins a name and a badge', () => {
    expect(cursorKey('demolish', 'armour')).toBe('demolish-armour');
  });

  it('is the bare name when there is no badge', () => {
    expect(cursorKey('blocked', null)).toBe('blocked');
  });
});
```

Add `import type { RoleBucket } from '../ui/role';` and the new names to the existing import from `./cursor`.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/app/src/input/cursor.test.ts`
Expected: the seven new cases fail; everything else passes.

- [ ] **Step 3: Implement it**

Append to `cursor.ts`:

```ts
/** How the caller turns a unit id into its display bucket. A port, so this
 *  module needs no sim import and a test can describe a selection. */
export interface BadgeHints {
  bucketOf(id: number): RoleBucket;
}

/** The bucket of the group doing the winning verb, or null.
 *
 *  Null when there is no verb, when a support call is armed, or -- the case
 *  that matters -- when the winning group spans buckets. A badge asserts
 *  "this kind of unit is doing this"; when it is not one kind, saying nothing
 *  beats picking one. */
export function badgeFor(
  res: Resolution,
  hints: CursorHints,
  badges: BadgeHints
): RoleBucket | null {
  if (res.armed) return null;
  const verb = winningVerb(res, hints);
  if (!verb) return null;
  const winner = res.intents.find((i) => intentVerb(i, hints) === verb);
  const ids = winner ? idsOf(winner) : [];
  if (ids.length === 0) return null;
  const first = badges.bucketOf(ids[0]);
  return ids.every((id) => badges.bucketOf(id) === first) ? first : null;
}

/** `name` alone, or `name-badge`. The plugin generates a rule per key, and a
 *  test asserts both sides agree -- a mismatch here is silent, which is how
 *  slice 2 shipped a cursor that could never appear. */
export function cursorKey(name: CursorName, badge: RoleBucket | null): string {
  return badge ? `${name}-${badge}` : name;
}
```

You will need two small helpers beside them: `intentVerb(intent, hints)` returning the ranked name for one intent (mirroring `winningVerb`'s mapping for a single item, with `order` → `attack` when `hints.hostile` else `move`), and `idsOf(intent)` returning whichever id field that kind carries — `ids`, `riders`, or `carriers`. **Write them explicitly rather than casting**, because `PlayerIntent`'s variants genuinely differ.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/app/src/input/cursor.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the suppression rule can fail**

Replace the `ids.every(...)` check with `return first;` so a mixed group is badged anyway. Run the file and confirm *"says nothing when the winning group spans two kinds"* reddens. Then restore, and separately make `badgeFor` read `res.intents[0]` instead of the winning intent — confirm *"badges the WINNING group, not the whole selection"* reddens.

Restore by editing back and confirm `git diff` is clean. **Report both.**

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/input/cursor.ts packages/app/src/input/cursor.test.ts
git commit
```

Message: `feat(app): the badge names the actor, or says nothing`.

---

### Task 4: Generate a rule for every reachable key

**Files:**
- Modify: `packages/app/vite-plugin-cursors.ts`
- Test: `packages/app/vite-plugin-cursors.test.ts`

**Interfaces:**
- Consumes: `CursorName` and `cursorKey` from `./src/input/cursor`, `RoleBucket` from `./src/ui/role`.
- Produces: a `<style>` block with one rule per reachable key.

**On importing from `src`.** Slice 2 imported `CursorName` **type-only** to keep a build-time plugin free of a runtime dependency on app source. `cursorKey` is a runtime function, and it must be imported for real — because the alternative is the plugin defining the key format a second time, which is exactly how slice 2 shipped a selector that could never match. `cursor.ts`'s only import is `type { Resolution }`, which vanishes at compile time, so this pulls nothing else in. **Verify that stays true** — if `cursor.ts` ever gains a runtime import, this becomes a real dependency.

**Which keys are reachable.** Badge a verb only for buckets that can actually perform it. From the roster:

| verb | buckets that can reach it |
|---|---|
| `garrison` | soft, sniper |
| `demolish` | soft, armour |
| `charge` | soft |
| `mount` | transport |
| `dismount` | transport |
| `smoke` | transport, soft, armour |
| `move` | all seven |
| `attack` | all seven |

Unbadged, exactly as today: `move`, `attack`, `blocked`, `costly`, `protected`, `support`. `default` keeps no rule.

**The badge mark** rides the base shape's lower-right, drawn as an SVG path shaped like `ROLE_GLYPH`'s Unicode for that bucket — a hexagon for `drone`, a filled triangle for `soft`, a square for `armour`, and so on. They must **read as the same thing** the inspect card shows, because a player sees both at once. Keep each to a few path commands: this is 10 px riding a 32 px reticle.

- [ ] **Step 1: Write the failing test**

Append to `packages/app/vite-plugin-cursors.test.ts`:

```ts
describe('badged rules', () => {
  const css = cursorRules(deriveUiBand(REAL_PALETTE));

  it('emits a rule for every reachable name-badge key', () => {
    for (const key of ['demolish-soft', 'demolish-armour', 'charge-soft', 'garrison-soft',
                       'mount-transport', 'dismount-transport', 'smoke-armour', 'move-drone',
                       'attack-gunship']) {
      expect(css).toContain(`canvas[data-cursor='${key}']`);
    }
  });

  it('emits no rule for a badge that bucket can never earn', () => {
    // A gunship cannot garrison and a drone cannot demolish. A rule for it
    // would be dead bytes shipped on every page load.
    expect(css).not.toContain("data-cursor='garrison-gunship'");
    expect(css).not.toContain("data-cursor='demolish-drone'");
  });

  it('leaves the target-describing states unbadged', () => {
    for (const key of ['blocked', 'costly', 'protected', 'support']) {
      expect(css).toContain(`canvas[data-cursor='${key}']`);
      expect(css).not.toContain(`data-cursor='${key}-`);
    }
  });

  it('every generated selector matches a real canvas node', () => {
    // The check slice 2 lacked, which is why the cursor could never appear:
    // the selector was `[data-cursor='x'] canvas` while the attribute was set
    // ON the canvas. A string assertion cannot see that; a DOM node can.
    const { JSDOM } = require('jsdom') as typeof import('jsdom');
    const dom = new JSDOM('<div id="stage"><canvas></canvas></div>');
    const canvas = dom.window.document.querySelector('canvas')!;
    const selectors = [...css.matchAll(/canvas\[data-cursor='([^']+)'\]/g)].map((m) => m[1]);
    expect(selectors.length).toBeGreaterThan(20);
    for (const key of selectors) {
      canvas.setAttribute('data-cursor', key);
      expect(`${key}:${canvas.matches(`canvas[data-cursor='${key}']`)}`).toBe(`${key}:true`);
    }
  });

  it('agrees with cursorKey about how a key is spelled', () => {
    // The contract nothing typechecks. If these two ever disagree the cursor
    // silently falls back to the OS arrow, which is what happened in slice 2.
    expect(css).toContain(`canvas[data-cursor='${cursorKey('demolish', 'soft')}']`);
    expect(css).toContain(`canvas[data-cursor='${cursorKey('move', null)}']`);
  });
});
```

Import `cursorKey` from `./src/input/cursor` and reuse whatever the file already calls the real-palette fixture — if the existing real-palette test binds it under another name, use that name rather than introducing `REAL_PALETTE`.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/app/vite-plugin-cursors.test.ts`
Expected: the new cases fail; the existing seven pass.

- [ ] **Step 3: Implement the badged rules**

Extend the generator: keep the six base shapes, add the six verb shapes, add a `badgeMark(bucket, colour)` returning a small path, and emit one rule per reachable key by composing base markup plus badge markup inside the same `svg()` wrapper. Use `cursorKey` for every selector — **never build the string inline.**

Hotspot stays `CENTER CENTER`: the badge rides the corner and must not move where the cursor points.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/app/vite-plugin-cursors.test.ts`
Expected: PASS.

- [ ] **Step 5: Kill the mutants**

Slice 2's plugin suite killed **none** of four mutations. Run these four and confirm each reddens something:

1. Change one selector to the descendant form `[data-cursor='x'] canvas` → the DOM-match case must fail.
2. Emit `garrison-gunship` → the unreachable-badge case must fail.
3. Emit a badge on `protected` → the unbadged case must fail.
4. Change `cursorKey`'s join from `-` to `_` in `cursor.ts` → the agreement case must fail.

Restore after each and confirm both files are clean. **Report all four.**

- [ ] **Step 6: Measure and check the gate**

Run: `pnpm build`, then:

```bash
grep -c "data-cursor" packages/app/dist/index.html
node -e "const h=require('fs').readFileSync('packages/app/dist/index.html','utf8');const m=h.match(/<style data-cursor-rules[^>]*>([\s\S]*?)<\/style>/);console.log('bytes',m?m[1].length:0)"
```

Expected: the count matches the number of rules generated, and the block is **under 40 KB**. The spec estimated ~36 rules at ~23 KB. **If it is materially larger, report the number rather than proceeding** — that is the figure the build-time decision rested on.

Run: `pnpm validate:ui`
Expected: clean, zero violations. The plugin is outside the scan roots.

- [ ] **Step 7: Commit**

```bash
git add packages/app/vite-plugin-cursors.ts packages/app/vite-plugin-cursors.test.ts
git commit
```

Message: `feat(app): a cursor rule for every verb and actor`.

---

### Task 5: Wire the badge

**Files:**
- Modify: `packages/app/src/main.ts`

**Interfaces:**
- Consumes: `cursorFor`, `badgeFor`, `cursorKey`, `BadgeHints` from `./input/cursor`; `roleBucket` from `./ui/role`.
- Produces: nothing further.

Three changes in the ticker block where the cursor is already resolved.

**(a) Build the badge port.** Beside the existing `hints`, add:

```ts
    const badges: BadgeHints = {
      bucketOf: (id) => roleBucket(sim.unitTypes[sim.state.typeIdx[id]]),
    };
```

`roleBucket` is structural and `UnitType` carries `isKamikaze`, `role`, `transportSlots` and `isSoft`, so it accepts the real type directly.

**(b) Compose the key.**

```ts
    const name = cursorFor(res, hints);
    const key = cursorKey(name, badgeFor(res, hints, badges));
```

**(c) Guard on the composite, not the name.** The existing `lastCursorName` guard compares the base name. It must now compare **the key**, or the badge would change without the DOM being updated — a cursor stuck showing the wrong actor. Rename the variable to `lastCursorKey`, type it `string | null`, and compare against `key`.

That last one is the bug this task is most likely to ship: everything would look right, and the badge would simply never change after the first frame.

- [ ] **Step 1: Make the changes above**

- [ ] **Step 2: Verify by suite and gate**

Run: `pnpm test`, `pnpm typecheck`, `pnpm lint`
Expected: all pass and clean. Note the test total.

- [ ] **Step 3: The full sweep**

| Gate | Expectation |
|---|---|
| `pnpm test` | passes; note the total |
| `pnpm test:determinism` | **`1639983699`, UNMOVED** |
| `pnpm typecheck` / `pnpm lint` | clean |
| `pnpm validate:data` | 70 files |
| `pnpm validate:ui` | clean, **zero violations** (the file count grows with this slice's new files — that is correct) |
| `pnpm build` | succeeds |
| `pnpm balance` | five §5.7 figures unchanged |
| `pnpm playtest` | exits 1 on exactly `beit_sahwan_breach (passive control)` and `beit_sahwan_3_clearance` |

**A moved pin is a BLOCKED report.** So is a changed balance figure.

- [ ] **Step 4: Say what you could not verify**

Nothing headless proves the badge appears, that seven glyphs are distinguishable at 10 px in motion, or that a mark riding a reticle reads as information rather than noise. **State this plainly** — three slices of visual work are now waiting on one browser check, and a false "it works" here would be the third in this project's history.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main.ts
git commit
```

Message: `feat(app): the cursor wears the actor's mark`.

---

## Self-review

**Spec coverage.** Verb-aware names → Task 2. The destructiveness ordering → Task 2's ranking test. The shared classifier extracted from `hud.ts` → Task 1. Badge suppression for mixed buckets → Task 3. Generated badged rules → Task 4. The `armed`/`refused` guard carried from slice 2 → Task 2, Step 5 mutation 4. The spec's Out list adds no tasks.

**Two orderings the spec left implicit, decided at the top with reasoning**: the verb outranks `costly` but not `protected`; and `attack`/`move` are derived from the same `order` intent via `hints.hostile`.

**Placeholder scan.** No TBD, no "handle edge cases", no "similar to Task N". Every code step carries its code. Task 4's badge marks are specified as "a path shaped like `ROLE_GLYPH`'s Unicode, a few commands, 10 px" rather than left to taste, and its reachability table is explicit.

**Type consistency.** `RoleBucket`, `roleBucket`, `ROLE_GLYPH` are defined in Task 1 and used under those names in Tasks 3, 4 and 5. `winningVerb` is Task 2's and consumed by Task 3's `badgeFor`. `BadgeHints`, `badgeFor` and `cursorKey` are Task 3's and consumed by Tasks 4 and 5. `CursorHints` is slice 2's and unchanged. `Resolution` is slice 1's and unchanged.
