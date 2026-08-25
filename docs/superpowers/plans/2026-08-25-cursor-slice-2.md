# Contextual Cursor Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cursor say what a right-click will do — move, attack, blocked, costly, protected, armed — driven by the resolver slice 1 built.

**Architecture:** A pure `cursorFor(res, hints)` maps a `Resolution` to a cursor name. A Vite plugin injects `cursor: url("data:image/svg+xml,…")` rules built from `data/palette.json`, mirroring `vite-plugin-palette.ts`. Hover resolution moves from the unthrottled `pointermove` handler into the existing Pixi ticker. The ROE gate lives in the resolver so the cursor and the click cannot disagree.

**Tech Stack:** TypeScript (strict), vitest (`environment: 'node'`), Vite plugin API, PixiJS v8, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-25-cursor-slice-2-design.md`

## Global Constraints

- **The determinism pin must NOT move.** It reads `1639983699` in `packages/sim/src/determinism.test.ts`. The only sim change is a pure exported helper with no state. **A moved pin is a BLOCKED report, never a value to update.**
- **No floating point in `@lions/sim`.** `Math.*` and `Date.*` are banned there and lint-enforced. The zone helper compares four integers.
- **`pnpm validate:ui` must stay at 18 files clean.** It scans `.ts`, `.css`, `.html`, `.svg` under `packages/app/src` and `assets/campaign`, rejecting hex and `rgb()/rgba()` literals **with no allowlist**, and rejecting any raw `--rl-*` outside `theme.css`. **The cursor plugin lives at `packages/app/vite-plugin-cursors.ts`, outside those roots** — the same place `vite-plugin-palette.ts` sits. Do not put cursor colours in `theme.css` or anywhere under `packages/app/src`.
- **No DOM and no `Sim` import in `packages/app/src/input/`.** Those tests run in `environment: 'node'`.
- **Never** run `git add -A`, `git add .`, `git stash` in any form, or `git checkout <file>` / `git restore <file>`. The stash stack is shared with other live worktrees, and this repository has lost an entire uncommitted feature to `git checkout <file>`. Stage files by name.
- Every commit message ends with these two lines exactly:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
  ```

---

## Two rules the spec implies but does not state, decided here

**1. The X warns everywhere; the gate refuses only an attack on a protected structure.**

`roe: 'protected'` comes from two sources — a structure at or above `PROTECTED_ROE`, and a tile inside a mission's `roe.flagged_zones`. They are not the same kind of thing. A mosque is a target you must not shoot. A flagged clinic zone is *ground*, and ordering troops to walk into it is not an attack.

So: the **cursor** shows the X for both, because "do not shoot here" is true of both. The **click gate** refuses only the attack-move produced by the *structure* branch when that structure is protected. Movement into a flagged zone stays legal, and the existing ROE scoring charges the player if they fire there — which is what `stepRoe` already does.

Refusing movement into a flagged zone would make a clinic an impassable wall, which no mission author asked for.

**2. Demolish and garrison are never gated.**

`sortStructureOrder` already governs demolition of a protected site through selection purity — a protected site comes down only for a selection that is nothing but demolishers. That rule fixed a real bug and it is not this slice's to revisit. Garrisoning a protected building is not an attack either. **Only the `rest` group's attack-move is dropped.**

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/sim/src/mission.ts` | **Modify.** Export `zoneContains`; use it in both `stepRoe` copies and in `zone()`'s callers. | 1 |
| `packages/sim/src/zones.test.ts` | **Create.** The helper and its boundaries. | 1 |
| `packages/app/src/input/cursor.ts` | **Create.** `CursorName`, `CursorHints`, `cursorFor`. | 2 |
| `packages/app/src/input/cursor.test.ts` | **Create.** The mapping, rung by rung. | 2 |
| `packages/app/src/input/intents.ts` | **Modify.** `PointerContext.confirm`; the protected-structure gate. | 3 |
| `packages/app/src/input/resolve.test.ts` | **Modify.** Gate cases. | 3 |
| `packages/app/vite-plugin-cursors.ts` | **Create.** Palette → `<style>` with data-URI cursors. | 4 |
| `packages/app/vite-plugin-cursors.test.ts` | **Create.** The generated CSS. | 4 |
| `packages/app/vite.config.ts` | **Modify** (`:18`). Register the plugin. | 4 |
| `packages/app/src/main.ts` | **Modify.** Frame-coalesced hover, cursor application, `altKey`, real `inFlaggedZone`. | 5 |

---

### Task 1: One zone test, two callers

**Files:**
- Modify: `packages/sim/src/mission.ts` (the two inline tests at `:1033` and `:1048`)
- Test: `packages/sim/src/zones.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function zoneContains(zone: readonly number[] | undefined, tx: number, ty: number): boolean` from `packages/sim/src/mission.ts`, re-exported from `@lions/sim` if that package's index re-exports mission symbols — **check `packages/sim/src/index.ts` and follow whatever it already does for `PROTECTED_ROE`.**

**Why.** `MissionRuntime.stepRoe` performs the containment test **twice, inline** — once for the fire branch (`:1033`) and once for the strike branch (`:1048`) — and that method is what actually scores the player's ROE. Task 5 needs the same test in the app to decide whether the cursor shows an X. A third hand-written copy that drifts by one tile means a cursor saying "safe" over ground the sim charges for.

Zones are `[x, y, w, h]` in tile coordinates, axis-aligned, upper bound exclusive.

- [ ] **Step 1: Write the failing test**

Create `packages/sim/src/zones.test.ts`:

```ts
// Zone containment, exported because three callers need to agree.
//
// stepRoe tests this twice inline -- once for fire, once for strikes -- and it
// is what actually deducts ROE. The app needs the same answer to decide
// whether the cursor shows a "do not shoot here" mark. Three copies of a
// four-integer comparison is three chances to be off by one, and the symptom
// would be a cursor that says safe over ground the sim charges for.
import { describe, expect, it } from 'vitest';
import { zoneContains } from './mission';

const ZONE = [10, 20, 4, 3] as const; // x, y, w, h

describe('zoneContains', () => {
  it('includes the top-left corner', () => {
    expect(zoneContains(ZONE, 10, 20)).toBe(true);
  });

  it('includes the last tile inside, at x+w-1 and y+h-1', () => {
    expect(zoneContains(ZONE, 13, 22)).toBe(true);
  });

  it('excludes x+w and y+h — the bound is exclusive', () => {
    // The off-by-one that would make a cursor disagree with stepRoe.
    expect(zoneContains(ZONE, 14, 20)).toBe(false);
    expect(zoneContains(ZONE, 10, 23)).toBe(false);
  });

  it('excludes tiles before the origin', () => {
    expect(zoneContains(ZONE, 9, 20)).toBe(false);
    expect(zoneContains(ZONE, 10, 19)).toBe(false);
  });

  it('is false for an undefined zone rather than throwing', () => {
    // stepRoe calls this.zone(name), which returns undefined for a name the
    // map does not declare. A mission may flag a zone a map never defined.
    expect(zoneContains(undefined, 10, 20)).toBe(false);
  });

  it('is false for a zero-width zone', () => {
    expect(zoneContains([10, 20, 0, 3], 10, 20)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/sim/src/zones.test.ts`
Expected: FAIL — `zoneContains` is not exported.

- [ ] **Step 3: Implement and adopt it**

In `packages/sim/src/mission.ts`, near the `zone()` helper (`:792`):

```ts
/** Is a tile inside an `[x, y, w, h]` zone rectangle? Upper bound exclusive.
 *
 *  Exported because three callers must agree: stepRoe's fire branch, its
 *  strike branch, and the app's cursor, which tells the player whether firing
 *  here will cost them. A private copy in any of the three is a chance for the
 *  warning and the penalty to disagree by a tile. */
export function zoneContains(
  zone: readonly number[] | undefined,
  tx: number,
  ty: number
): boolean {
  if (!zone) return false;
  return tx >= zone[0] && tx < zone[0] + zone[2] && ty >= zone[1] && ty < zone[1] + zone[3];
}
```

Then replace **both** inline tests in `stepRoe` with it:

```ts
          if (zoneContains(this.zone(zoneName), tx, ty)) {
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/sim/src/zones.test.ts`
Expected: PASS, 6 cases.

Run: `pnpm test`
Expected: all pass. The ROE tests already in the suite are what prove the adoption did not change `stepRoe`'s behaviour — note the total.

- [ ] **Step 5: Prove the pin did not move**

Run: `pnpm test:determinism`
Expected: PASS with `1639983699`. The helper is a pure comparison and `stepRoe`'s logic is unchanged. **If it moved, stop and report BLOCKED** — it would mean the extraction changed behaviour.

- [ ] **Step 6: Commit**

```bash
git add packages/sim/src/mission.ts packages/sim/src/zones.test.ts
git commit
```

Message: `refactor(sim): one zone containment test, three callers`.

---

### Task 2: The cursor mapping

**Files:**
- Create: `packages/app/src/input/cursor.ts`
- Test: `packages/app/src/input/cursor.test.ts`

**Interfaces:**
- Consumes: `Resolution` from `packages/app/src/input/intents.ts`.
- Produces:
  - `export type CursorName = 'default' | 'move' | 'attack' | 'blocked' | 'costly' | 'protected' | 'support'`
  - `export interface CursorHints { hostile: boolean; blocked: boolean }`
  - `export function cursorFor(res: Resolution, hints: CursorHints): CursorName`

**Why two hints rather than reading them off the Resolution.** `resolvePointer` never consults enemy positions or tile passability — a right-click on an enemy and a right-click on empty ground both produce the same `attackMove` intent. So "is a hostile under the pointer" and "is this tile impassable" have to come from the caller, which already computes both: `renderer.hoverEntity >= 0` and `sim.blocked[t]`.

**The order of the rungs is the design.** Each is testable and each exists for a reason:

1. `armed` — an armed support call is what the pointer means, whatever is under it, and it works with an empty selection. **This rung must come first**, and slice 1 has a test proving the resolver returns `armed` for an empty selection precisely because that is the real call shape.
2. no intents — nothing is selected, so nothing will happen. An ROE mark over a click that cannot fire would be a lie.
3. `protected` — the X.
4. `costly` — the warning.
5. `blocked` — impassable ground.
6. `hostile` — attack.
7. otherwise — move.

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/input/cursor.test.ts`:

```ts
// Which cursor a resolution means.
//
// The rungs are ordered, and the order is the design: an armed support call
// outranks everything because that is what the pointer means; an empty
// selection outranks the ROE marks because a click that cannot fire must not
// warn about firing.
import { describe, expect, it } from 'vitest';
import { cursorFor, type CursorHints } from './cursor';
import type { Resolution } from './intents';

const NONE: CursorHints = { hostile: false, blocked: false };

/** A resolution that would order a plain attack-move. */
function moving(over: Partial<Resolution> = {}): Resolution {
  return {
    intents: [{ kind: 'order', verb: 'attackMove', ids: [1], x: 2.5, y: 3.5, append: false }],
    roe: 'free',
    marker: true,
    ...over,
  };
}

describe('cursorFor', () => {
  it('is move over open ground with something selected', () => {
    expect(cursorFor(moving(), NONE)).toBe('move');
  });

  it('is attack when a hostile is under the pointer', () => {
    expect(cursorFor(moving(), { hostile: true, blocked: false })).toBe('attack');
  });

  it('is blocked over impassable ground, even with a hostile hint', () => {
    // Rock is impassable and can hide a unit behind it; the ground is still
    // the thing you cannot stand on.
    expect(cursorFor(moving(), { hostile: true, blocked: true })).toBe('blocked');
  });

  it('is costly over a structure that scores against you', () => {
    expect(cursorFor(moving({ roe: 'costly' }), NONE)).toBe('costly');
  });

  it('is protected over a mosque or a flagged zone', () => {
    expect(cursorFor(moving({ roe: 'protected' }), NONE)).toBe('protected');
  });

  it('puts protected above costly, blocked and attack', () => {
    expect(cursorFor(moving({ roe: 'protected' }), { hostile: true, blocked: true })).toBe(
      'protected'
    );
  });

  it('is default when nothing is selected', () => {
    expect(cursorFor({ intents: [], roe: 'free', marker: false }, NONE)).toBe('default');
  });

  it('stays default over a protected target when nothing is selected', () => {
    // A click that cannot issue an order must not warn about one.
    expect(cursorFor({ intents: [], roe: 'protected', marker: false }, NONE)).toBe('default');
  });

  it('is support whenever a call is armed', () => {
    expect(cursorFor({ intents: [], roe: 'free', marker: false, armed: 'sweep' }, NONE)).toBe(
      'support'
    );
  });

  it('keeps support above protected and above the empty selection', () => {
    // Armed support fires with no selection at all -- pointerup always passes
    // ids: []. If this rung slipped below the empty-selection rung, the armed
    // cursor would never appear.
    expect(
      cursorFor({ intents: [], roe: 'protected', marker: false, armed: 'strike' }, NONE)
    ).toBe('support');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/app/src/input/cursor.test.ts`
Expected: FAIL — `./cursor` does not exist. All ten cases fail at import.

- [ ] **Step 3: Implement it**

Create `packages/app/src/input/cursor.ts`:

```ts
/**
 * Which cursor a resolution means.
 *
 * The cursor is the click decision drawn instead of dispatched, so it reads
 * the same Resolution the click acts on. Anything it decided for itself would
 * be a second opinion, and the failure mode is a cursor that promises an order
 * the click will not issue.
 *
 * No DOM here: this module is pure and its tests run in environment: 'node'.
 */
import type { Resolution } from './intents';

export type CursorName =
  | 'default'
  | 'move'
  | 'attack'
  | 'blocked'
  | 'costly'
  | 'protected'
  | 'support';

/** What the resolution cannot know, because resolvePointer never looks at
 *  enemy positions or tile passability. The caller has both already. */
export interface CursorHints {
  hostile: boolean;
  blocked: boolean;
}

export function cursorFor(res: Resolution, hints: CursorHints): CursorName {
  // Armed support outranks everything: it is what the pointer means, and it
  // fires with an empty selection, which is how pointerup always calls it.
  if (res.armed) return 'support';
  // Nothing selected means nothing will happen. Warning about rules of
  // engagement over a click that cannot fire would be a lie.
  if (res.intents.length === 0) return 'default';
  if (res.roe === 'protected') return 'protected';
  if (res.roe === 'costly') return 'costly';
  if (hints.blocked) return 'blocked';
  return hints.hostile ? 'attack' : 'move';
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run packages/app/src/input/cursor.test.ts`
Expected: PASS, 10 cases.

- [ ] **Step 5: Prove the rungs are load-bearing**

A mapping whose order does not matter would pass these tests in any order. Reorder it three ways, one at a time, and confirm the named case goes red:

1. Move the `armed` rung **below** the empty-selection rung → *"keeps support above protected and above the empty selection"* must fail.
2. Move the empty-selection rung **below** `protected` → *"stays default over a protected target when nothing is selected"* must fail.
3. Move `hints.blocked` **above** `res.roe === 'protected'` → *"puts protected above costly, blocked and attack"* must fail.

Restore after each by editing back — never `git checkout` — and confirm `git diff packages/app/src/input/cursor.ts` is empty before committing. **Report all three results.**

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/input/cursor.ts packages/app/src/input/cursor.test.ts
git commit
```

Message: `feat(app): a resolution knows which cursor it means`.

---

### Task 3: The Alt gate

**Files:**
- Modify: `packages/app/src/input/intents.ts`
- Test: `packages/app/src/input/resolve.test.ts`

**Interfaces:**
- Consumes: `PointerContext`, `Resolution`, `resolvePointer` from slice 1.
- Produces: `PointerContext.confirm: boolean` — **required**, like `armed`, so `typecheck` catches an unupdated call site.

**The rule, restated because it is narrow on purpose.** When the pointer is over a **protected structure** and `confirm` is false, the `rest` group's attack-move is dropped and a note explains why. Demolish and garrison are untouched. A flagged **zone** does not gate anything — walking into a clinic is not an attack, and refusing it would make the zone an impassable wall.

- [ ] **Step 1: Write the failing test**

Append to `packages/app/src/input/resolve.test.ts`:

```ts
describe('attacking a protected structure needs a deliberate confirm', () => {
  const mosque = (over: Partial<IntentWorld> = {}): IntentWorld =>
    emptyWorld({
      structureAt: () => 7,
      isProtected: () => true,
      structureRoePenalty: () => 30,
      garrisonFree: () => 2,
      ...over,
    });

  it('drops the attack-move and says why, without the modifier', () => {
    const r = resolvePointer(mosque(), {
      ids: [1, 2], x: 3.5, y: 3.5, append: false, armed: null, confirm: false,
    });
    expect(r.intents).toEqual([]);
    expect(r.roe).toBe('protected');
    expect(r.note?.tone).toBe('mute');
    expect(r.marker).toBe(false);
  });

  it('issues exactly the same order with it', () => {
    const r = resolvePointer(mosque(), {
      ids: [1, 2], x: 3.5, y: 3.5, append: false, armed: null, confirm: true,
    });
    expect(r.intents).toEqual([
      { kind: 'order', verb: 'attackMove', ids: [1, 2], x: 3.5, y: 3.5, append: false },
    ]);
    expect(r.marker).toBe(true);
  });

  it('never gates demolition — selection purity already governs that', () => {
    // sortStructureOrder lets a pure demolisher selection level a protected
    // site with no modifier, because isolating the engineers IS the act of
    // taking responsibility. That rule fixed a real bug and is not this
    // slice's to revisit.
    const r = resolvePointer(mosque({ canDemolish: () => true }), {
      ids: [1, 2], x: 3.5, y: 3.5, append: false, armed: null, confirm: false,
    });
    expect(r.intents).toEqual([{ kind: 'demolish', ids: [1, 2], structure: 7 }]);
  });

  it('never gates garrisoning', () => {
    const r = resolvePointer(mosque({ canGarrison: () => true }), {
      ids: [2], x: 3.5, y: 3.5, append: false, armed: null, confirm: false,
    });
    expect(r.intents).toEqual([{ kind: 'garrison', ids: [2], structure: 7 }]);
  });

  it('does not gate movement into a flagged zone — a clinic is not a wall', () => {
    // The zone raises the tier, so the cursor still warns. It does not refuse
    // the order: walking into a zone is not an attack, and stepRoe already
    // charges the player for firing there.
    const r = resolvePointer(emptyWorld({ inFlaggedZone: () => true }), {
      ids: [1], x: 9.5, y: 9.5, append: false, armed: null, confirm: false,
    });
    expect(r.roe).toBe('protected');
    expect(r.intents).toEqual([
      { kind: 'order', verb: 'attackMove', ids: [1], x: 9.5, y: 9.5, append: false },
    ]);
  });
});
```

**Every existing call to `resolvePointer` in this file needs `confirm` added.** `typecheck` will list them.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/app/src/input/resolve.test.ts`
Expected: FAIL — compile errors on the missing `confirm` field, then the five new cases.

- [ ] **Step 3: Implement the gate**

In `intents.ts`, add to `PointerContext`:

```ts
  /** Alt is held. Only a protected STRUCTURE is gated on it; a flagged zone
   *  raises the tier without refusing the order. Required rather than
   *  optional so typecheck names every call site when it changes. */
  confirm: boolean;
```

Then in `resolvePointer`'s structure branch, after the `sortStructureOrder` call and before the intents are assembled:

```ts
    // Attacking a protected site is refused unless the player says so with a
    // modifier. Demolition is NOT gated here -- sortStructureOrder already
    // governs it through selection purity, and garrisoning is not an attack.
    const gated = world.isProtected(struct) && !ctx.confirm;
    if (gated && razers.length === 0 && enterers.length === 0) {
      return {
        intents: [],
        roe,
        marker: false,
        note: { text: 'protected site — hold Alt to order fire on it', tone: 'mute' },
      };
    }
```

and drop the `rest` push when `gated`:

```ts
    if (!gated && rest.length > 0) {
      intents.push({ kind: 'order', verb: 'attackMove', ids: rest, x, y, append: false });
    }
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/app/src/input/resolve.test.ts`
Expected: PASS, all cases.

Run: `pnpm typecheck`
Expected: clean once every call site passes `confirm`.

- [ ] **Step 5: Prove the gate can fail**

Change `!ctx.confirm` to `false` so the gate never fires, run the file, and confirm *"drops the attack-move and says why"* goes red while *"issues exactly the same order with it"* stays green. Then change it to `true` so the gate always fires, and confirm the opposite. Restore by editing back and check `git diff` is clean. **Report both results** — a gate that is stuck in either position must be caught.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/input/intents.ts packages/app/src/input/resolve.test.ts
git commit
```

Message: `feat(app): firing on a protected site takes a deliberate modifier`.

---

### Task 4: The cursor images

**Files:**
- Create: `packages/app/vite-plugin-cursors.ts`
- Create: `packages/app/vite-plugin-cursors.test.ts`
- Modify: `packages/app/vite.config.ts:18`

**Interfaces:**
- Consumes: `CursorName` from `packages/app/src/input/cursor.ts` — **as a type-only import**, so the plugin has no runtime dependency on app source.
- Produces:
  - `export function cursorRules(palette: Palette): string` — the CSS text
  - `export function cursorsPlugin(paletteUrl: URL): Plugin`

**Why a plugin and not a stylesheet.** `validate:ui` scans `.ts`, `.css`, `.html` and `.svg` under `packages/app/src` and rejects hex literals with no allowlist. Cursor art needs colour. `packages/app/vite-plugin-cursors.ts` sits **outside** those roots, exactly where `vite-plugin-palette.ts` sits, and injects a `<style>` block through `transformIndexHtml` — which Vite runs in **both dev and build**. Nothing on disk under a scanned root ever holds a colour.

**Read `packages/app/vite-plugin-palette.ts` first and follow its shape**: the `Palette` interface, `readFileSync` on the URL, the `configureServer` watcher that triggers a full reload when the palette changes, and the `transformIndexHtml` return.

**Every rule needs a hotspot.** The `x y` after the URL is where the cursor actually points. A reticle points from its centre; an arrow from its tip. Nothing in the suite can catch a wrong one — it is felt in play — so get it from the shape's geometry rather than by eye.

- [ ] **Step 1: Write the failing test**

Create `packages/app/vite-plugin-cursors.test.ts`:

```ts
// The generated cursor CSS.
//
// Colour comes from data/palette.json at inject time, so nothing on disk under
// a validate:ui root ever holds a literal -- the same reason vite-plugin-
// palette.ts injects rather than emitting a stylesheet.
import { describe, expect, it } from 'vitest';
import { cursorRules } from './vite-plugin-cursors';

const PALETTE = {
  ramps: { limestone: { colors: ['#EEE', '#DDD', '#CCC', '#BBB', '#AAA', '#999', '#888'] } },
  reserved: { ui: { colors: { bad: '#C0392B', good: '#27AE60', ink: '#111111' } } },
};

describe('cursorRules', () => {
  const css = cursorRules(PALETTE);

  it('emits a rule for every cursor name the app can ask for', () => {
    // 'default' deliberately has no rule: it is the OS arrow.
    for (const name of ['move', 'attack', 'blocked', 'costly', 'protected', 'support']) {
      expect(css).toContain(`[data-cursor='${name}']`);
    }
  });

  it('gives every rule a hotspot rather than defaulting to the top-left', () => {
    // `url(...) auto` with no coordinates points from 0,0, which is wrong for
    // every shape here and invisible in a screenshot.
    const rules = css.split('\n').filter((l) => l.includes('url('));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).toMatch(/\)\s+\d+\s+\d+\s*,\s*auto/);
    }
  });

  it('takes its colours from the palette it is given', () => {
    // Proves the palette is actually read rather than the colours hardcoded:
    // a colour from PALETTE must appear, URL-encoded.
    expect(css).toContain(encodeURIComponent('#C0392B').toLowerCase().replace('%23', '%23'));
  });

  it('encodes the SVG so it survives a CSS url()', () => {
    // A raw '#' inside a data URI terminates it and the cursor silently
    // becomes the default arrow.
    expect(css).not.toMatch(/data:image\/svg\+xml,[^"]*[^%]#/);
  });

  it('changes when the palette changes', () => {
    const other = cursorRules({
      ...PALETTE,
      reserved: { ui: { colors: { bad: '#00FF00', good: '#27AE60', ink: '#111111' } } },
    });
    expect(other).not.toBe(css);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/app/vite-plugin-cursors.test.ts`
Expected: FAIL — the module does not exist.

**Check first that vitest picks up files outside `src/`.** If the workspace config restricts the glob, the test will not run at all rather than failing — which looks like success. Confirm you see five failures, not zero tests. If vitest does not collect it, put the test beside its subject anyway and **report what you had to change** to make it run.

- [ ] **Step 3: Implement the plugin**

Create `packages/app/vite-plugin-cursors.ts`. Structure it as: a `Palette` interface matching `vite-plugin-palette.ts`'s; a small table mapping each `CursorName` to an SVG string built from palette colours; `cursorRules(palette)` returning `[data-cursor='name'] canvas { cursor: url("data:image/svg+xml,<encoded>") hx hy, auto; }` lines; and `cursorsPlugin(paletteUrl)` returning a `Plugin` with `configureServer` (watch + full-reload, copied from the palette plugin) and `transformIndexHtml` (inject the `<style>` at `head-prepend`).

Shapes, kept deliberately simple because they are read at 32px in motion:

| Name | Shape | Colour | Hotspot |
|---|---|---|---|
| `move` | a small open circle with a centre dot | `limestone` light | centre |
| `attack` | a four-tick reticle, open centre | `ui.bad` | centre |
| `blocked` | a circle with a diagonal bar | `limestone` mid | centre |
| `costly` | the attack reticle plus a small filled triangle upper-right | `ui.bad` + `limestone` light | centre |
| `protected` | **a bold X**, thick strokes, full box | `ui.bad` | centre |
| `support` | a square bracket frame with a centre dot | `ui.good` | centre |

Use `encodeURIComponent` on the SVG. **`#` must be encoded** — a raw `#` ends the data URI and the cursor silently falls back to the arrow.

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run packages/app/vite-plugin-cursors.test.ts`
Expected: PASS, 5 cases.

- [ ] **Step 5: Register it**

In `packages/app/vite.config.ts:18`, add it beside the palette plugin:

```ts
  plugins: [
    palettePlugin(new URL('../../data/palette.json', import.meta.url)),
    cursorsPlugin(new URL('../../data/palette.json', import.meta.url)),
  ],
```

- [ ] **Step 6: Prove the gate still passes and the build still works**

Run: `pnpm validate:ui`
Expected: **18 files clean.** The plugin is outside the scan roots; if this number changes, something landed in the wrong place.

Run: `pnpm build`
Expected: succeeds. Then confirm the built HTML carries the cursor style block:

```bash
grep -c "data-cursor" packages/app/dist/index.html
```

Expected: at least 1. **This is the only proof that `transformIndexHtml` ran in build mode** — the unit test only exercises the string builder.

- [ ] **Step 7: Commit**

```bash
git add packages/app/vite-plugin-cursors.ts packages/app/vite-plugin-cursors.test.ts packages/app/vite.config.ts
git commit
```

Message: `feat(app): cursor art generated from the palette`.

---

### Task 5: Wire it up

**Files:**
- Modify: `packages/app/src/main.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing further.

Four changes, in this order.

**(a) `inFlaggedZone` stops being a stub.** The adapter at `main.ts:833-845` currently returns `false`. `map.zones` and the mission's `roe.flagged_zones` are both in scope. Use `zoneContains` from `@lions/sim` — **do not hand-write the rectangle test**, that is the whole point of Task 1:

```ts
    inFlaggedZone: (x, y) => {
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      for (const name of mission?.roe?.flagged_zones ?? []) {
        if (zoneContains(map.zones[name], tx, ty)) return true;
      }
      return false;
    },
```

Check the real names of `mission` and `map` in that scope and use them.

**(b) `pointermove` stops computing.** Strip it to recording the pointer position and the modifier state, plus the drag-box update it already does. Everything else it computed — `screenToWorld`, `structureAt`, `hoverCanGarrison`, the entity scan — moves to (c). Keep `lastCursor` updated: the `'f'` smoke key reads it.

Add a module-level `let altHeld = false;` and set it from `ev.altKey` on each pointer event.

**(c) The ticker resolves and applies.** Inside the existing `renderer.app.ticker.add(...)` callback at `main.ts:1103`, **after** `renderer.frame(...)`, do what `pointermove` used to do — then resolve and set the cursor:

```ts
    // Hover work runs once per frame rather than once per pointer event. A
    // high-poll mouse fires several moves a frame, and this loop includes an
    // O(N) scan over every entity, so this is strictly cheaper than before.
    const hw = renderer.screenToWorld(lastCursor.x, lastCursor.y);
    // ... the existing hoverStructure / hoverCanGarrison / hoverEntity work ...
    const mine = renderer.selection.filter((i) => sim.state.side[i] === 0 && sim.state.alive[i] === 1);
    const res = resolvePointer(intentWorld, {
      ids: mine, x: hw.x, y: hw.y, append: false, armed: armedSupport, confirm: altHeld,
    });
    const tx = Math.floor(hw.x);
    const ty = Math.floor(hw.y);
    const inBounds = tx >= 0 && ty >= 0 && tx < sim.width && ty < sim.height;
    const name = cursorFor(res, {
      hostile: renderer.hoverEntity >= 0,
      blocked: inBounds && sim.blocked[ty * sim.width + tx] !== 0,
    });
    if (name !== lastCursorName) {
      canvas.dataset.cursor = name;
      lastCursorName = name;
    }
```

`append: false` here is deliberate — the hover cursor does not depend on Shift, and passing the live Shift state would make the cursor flicker while a player queues waypoints.

Guard the write with `lastCursorName` so the DOM is touched only when the name changes; setting a dataset attribute every frame is needless style invalidation.

**(d) The click passes the modifier.** In the `contextmenu` handler, pass `confirm: ev.altKey` — and **not** `altHeld`, because the event's own state is authoritative at the moment of the click.

- [ ] **Step 1: Make the changes above**

- [ ] **Step 2: Verify by suite and by gate**

Run: `pnpm test`
Expected: all pass. Note the total.

Run: `pnpm typecheck` and `pnpm lint`
Expected: clean. Typecheck is what catches a `resolvePointer` call site missing `confirm` or `armed`.

- [ ] **Step 3: The full sweep**

| Gate | Expectation |
|---|---|
| `pnpm test` | passes; note the total |
| `pnpm test:determinism` | **`1639983699`, UNMOVED** |
| `pnpm typecheck` / `pnpm lint` | clean |
| `pnpm validate:data` | 70 files |
| `pnpm validate:ui` | **18 files clean** |
| `pnpm build` | succeeds |
| `pnpm balance` | five §5.7 figures unchanged |
| `pnpm playtest` | exits 1 on exactly `beit_sahwan_breach (passive control)` and `beit_sahwan_3_clearance` |

**A moved pin is a BLOCKED report.** So is a changed balance figure.

- [ ] **Step 4: Say what you could not verify**

Nothing headless proves the cursor appears, that the hotspots point where they should, or that the X reads at gameplay zoom. `typecheck` proves the wiring's shape; the suite proves the mapping. **State this plainly in your report** rather than implying coverage you do not have — a browser check follows, and it is not yours.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main.ts
git commit
```

Message: `feat(app): the cursor says what the click will do`.

---

## Self-review

**Spec coverage.** The Vite plugin and palette-derived data URIs → Task 4. Frame-coalesced hover → Task 5(c). The tier → cursor mapping → Task 2. The Alt confirm → Task 3, wired in Task 5(d). The exported zone helper and real `inFlaggedZone` → Tasks 1 and 5(a). The six states → Task 4's table and Task 2's mapping. The spec's Out list adds no tasks.

**Two rules the spec implied without stating, decided at the top of this plan**: the X warns for both protected sources but the gate refuses only an attack on a protected *structure*; and demolish and garrison are never gated. Both are recorded with reasoning, and both have tests.

**Placeholder scan.** No TBD, no "handle edge cases", no "similar to Task N". Every code step carries its code. Task 4's shapes are specified as a table of geometry, colour and hotspot rather than left to taste.

**Type consistency.** `CursorName`, `CursorHints`, `cursorFor` are defined in Task 2 and used under those names in Tasks 4 and 5. `PointerContext.confirm` is added in Task 3 and supplied in Task 5(c) and 5(d). `zoneContains(zone, tx, ty)` is defined in Task 1 and called in Task 5(a). `Resolution` is slice 1's and unchanged.
