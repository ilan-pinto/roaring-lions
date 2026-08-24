# Elevation E3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift an observer's eyes off the dirt, so a unit standing level with a rise can see over it — and close the elevation milestone.

**Architecture:** One constant, `EYE_HEIGHT = 1`, added to both endpoint heights in `losRay`. It must stay strictly below `BLOCK_RISE` (2) or buildings stop blocking on flat ground, so a test asserts that relationship. Two questions deferred twice — aircraft exemptions and sight range from elevation — are closed in the documentation rather than deferred again.

**Tech Stack:** TypeScript strict, vitest, `@lions/sim` (Q16.16 fixed-point, `Math.*` and `Date.*` banned).

**Spec:** `docs/superpowers/specs/2026-08-24-elevation-e3-design.md` (committed `eb617f6`)

## Global Constraints

- **The determinism pin must NOT move. It reads `1639983699`.** Every flat-ground path lands where it lands today; a moved pin means E3 changed flat-ground sight, which all eleven shipped missions depend on it not having. **Report BLOCKED rather than updating the value.**
- **`EYE_HEIGHT` must be strictly less than `BLOCK_RISE`.** At 2 a flat-ground building becomes `2 × total > 2 × total` — false — and buildings stop blocking sight on every shipped map at once.
- **Changes confined to `packages/sim/src/`**, plus documentation in Task 2. Nothing under `packages/render/`, `packages/app/`, `packages/data/`, `tools/`, `data/`.
- **`@lions/sim` bans `Math.*` and `Date.*`** and requires Q16.16 for fractional quantities. `EYE_HEIGHT` is a plain integer that never combines with an `fx.*` value — if you reach for `fx.mul` or `Math.floor`, the design has been misread.
- **No `isAir` branch.** Terrain blocks aircraft exactly as it blocks ground units — now permanently, not deferred.
- **No sight-range change.** `sightSq` and its three comparison sites are not yours to touch.
- TypeScript strict. No `any`. No non-null assertions.
- **Never `git add -A`, `git add .`, `git stash` in any form, or `git checkout <file>` / `git restore <file>`.** This repository has lost uncommitted work to the latter, and the stash stack is shared with other live worktrees where concurrent sessions push and pop it. If you need code in two states, edit it and edit it back.
- **Commit message trailers** — every commit ends with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
  ```

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/sim/src/sim.ts` | `EYE_HEIGHT`, applied to both endpoint heights in `losRay` | 1 |
| `packages/sim/src/elevation.test.ts` | the terracing cases, and the constant-relationship guard | 1 |
| `CLAUDE.md`, the E2 and E3 specs | close the aircraft and sight-range questions; record the two-level authoring rule | 2 |

---

### Task 1: Eyes above the dirt

**Files:**
- Modify: `packages/sim/src/sim.ts` (a constant beside `BLOCK_RISE` at `:622`; `losRay`'s endpoint heights at `:1820-1821`)
- Modify: `packages/sim/src/elevation.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `BLOCK_RISE` (2) and the `losRay` height comparison, both shipped in E2. `Sim.setElevation(x, y, h)` and `Sim.setBlocked(x, y, b)` are public.
- Produces: nothing later tasks import. Task 2 documents the behaviour this task creates.

- [ ] **Step 1: Write the failing tests**

**Placement matters here, so it is settled rather than left to judgement.** The `SCOUT` type and the `watch` / `ridge` helpers exist in `packages/sim/src/elevation.test.ts` from E2, but they are scoped **inside** `describe('elevation and line of sight', ...)` — `SCOUT` at `:109`, `watch` at `:118`, `ridge` at `:135`. A sibling `describe` at module level cannot reach them.

So add the block below as a **nested `describe` inside** `describe('elevation and line of sight', ...)`, after its existing `it` cases and before its closing `});`. Do not hoist the helpers to module scope, and do not redefine them.

```ts
// Elevation E3: an observer's eyes are not on the dirt.
//
// E2 modelled a unit as a point at ground level, which made a one-level rise
// an absolute sight wall even for someone standing at that same height: the
// line descended from 1 to 0 and clipped the rise's far shoulder. On a
// terraced map a unit saw nothing off its own terrace until adjacent to the
// drop.
describe('eye height', () => {
  it('a unit level with a one-level rise now sees over it', () => {
    // The case E2's final review measured as broken. Observer on elevation 1,
    // target on the flat beyond a single raised column, also elevation 1.
    const { sim, a, b } = watch(
      (sim) => {
        for (let y = 0; y < 12; y++) sim.setElevation(8, y, 1);
        for (let y = 0; y < 12; y++) sim.setElevation(4, y, 1);
      },
      4,
      6,
      14,
      6
    );
    expect(sim.debugDetection(a, b)?.visible).toBe(true);
  });

  it('but two levels of rise still block them', () => {
    // The authoring rule this creates: one level is cosmetic, two is tactical.
    const { sim, a, b } = watch(ridge(2), 4, 6, 14, 6);
    expect(sim.debugDetection(a, b)?.visible).toBe(false);
  });

  it('a one-level rise no longer blocks two units on the flat', () => {
    // Follows from eye height 1: the rise sits exactly at eye level, so the
    // comparison is `1 * total > 1 * total`, which is false. Stated in the
    // spec as an authoring consequence rather than discovered later on a map.
    const { sim, a, b } = watch(ridge(1), 4, 6, 14, 6);
    expect(sim.debugDetection(a, b)?.visible).toBe(true);
  });

  it('buildings still block on flat ground, which is what bounds EYE_HEIGHT', () => {
    // The guard that matters. If EYE_HEIGHT ever reaches BLOCK_RISE, a
    // flat-ground building becomes `2 * total > 2 * total` -- false -- and
    // every shipped mission loses its walls at once. This asserts the
    // behaviour; the next test asserts the relationship that produces it.
    const { sim, a, b } = watch(
      (sim) => {
        for (let y = 0; y < 12; y++) sim.setBlocked(8, y, true);
      },
      4,
      6,
      14,
      6
    );
    expect(sim.debugDetection(a, b)?.visible).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and watch the first one fail**

```bash
pnpm vitest run packages/sim/src/elevation.test.ts
```

Expected: `a unit level with a one-level rise now sees over it` **FAILS** — this is the case E3 exists to fix.

The other three should **PASS already**: two levels blocks today, a one-level rise blocks today (so the third test fails *after* the fix flips it — see Step 5), and buildings block today.

**Read that carefully:** the third case, `a one-level rise no longer blocks two units on the flat`, asserts the *post-fix* behaviour, so at RED it fails too. Two failures, two passes. If you see a different split, work out why before implementing rather than adjusting a test.

- [ ] **Step 3: Add the constant**

In `packages/sim/src/sim.ts`, immediately after `BLOCK_RISE` at `:622`:

```ts
/** How far above its own tile a unit's eyes sit, in elevation levels.
 *
 *  Without this a unit is a point on the dirt, and a one-level rise is an
 *  absolute sight wall even for someone standing at that same height -- the
 *  line descends from 1 to 0 and clips the rise's far shoulder. Measured on a
 *  terraced map, a unit saw nothing off its own terrace until adjacent to the
 *  drop.
 *
 *  MUST STAY STRICTLY BELOW BLOCK_RISE. At 2 a flat-ground building becomes
 *  `(0 + 2) * total > 2 * total` -- false -- and buildings stop blocking sight
 *  on every shipped map at once. The two constants are coupled and the coupling
 *  is invisible here, so elevation.test.ts asserts it. */
const EYE_HEIGHT = 1;
```

- [ ] **Step 4: Apply it to both endpoints**

`losRay`'s endpoint heights at `:1820-1821` currently read:

```ts
    const h0 = this.elevation[y0 * w + x0];
    const h1 = this.elevation[y1 * w + x1];
```

Replace with:

```ts
    // Both ends, symmetrically: you see a body, and a body has height.
    const h0 = this.elevation[y0 * w + x0] + EYE_HEIGHT;
    const h1 = this.elevation[y1 * w + x1] + EYE_HEIGHT;
```

Nothing else in `losRay` changes. The comparison, the `rise` local, `total` and `k` all stay exactly as E2 left them.

- [ ] **Step 5: Run the tests**

```bash
pnpm vitest run packages/sim/src/elevation.test.ts
```

Expected: all pass, including E2's cases. If `a rise between two units on the valley floor blocks them` (E2's, using `ridge(3)`) now fails, the constant is too large — three levels must still block two units at elevation 0.

- [ ] **Step 6: Add the relationship guard**

Append to the same describe block. This asserts the coupling directly, not just its consequence, so someone tuning one constant sees the reason rather than a mystery failure three files away.

```ts
  it('EYE_HEIGHT stays below BLOCK_RISE, or walls stop being walls', () => {
    // Not a behavioural test -- an assertion about two constants that sit in
    // sim.ts as unrelated numbers a tuning pass could move independently.
    //
    // If EYE_HEIGHT ever reaches BLOCK_RISE, a flat-ground building computes
    // `(0 + BLOCK_RISE) * total > EYE_HEIGHT * total`, which stops being true,
    // and every building on every shipped map stops blocking sight. The failure
    // would surface as eleven missions changing at once, with nothing pointing
    // at the cause.
    expect(EYE_HEIGHT).toBeLessThan(BLOCK_RISE);
  });
```

**Both constants are module-private in `sim.ts`.** Export them for the test — `export const EYE_HEIGHT` and `export const BLOCK_RISE` — and import them in `elevation.test.ts`. If you would rather not widen the module's surface, say so in your report and assert the relationship through behaviour instead; do not invent a third way of reaching them.

- [ ] **Step 7: Prove flat ground is untouched**

```bash
pnpm test
pnpm test:determinism
pnpm balance
pnpm playtest
```

| Command | Expectation |
|---|---|
| `test` | all pass |
| `test:determinism` | **`1639983699`, UNMOVED** |
| `balance` | five §5.7 figures byte-identical |
| `playtest` | exits 1 on exactly `beit_sahwan_breach (passive control)` and `beit_sahwan_3_clearance` |

**If the pin moved, STOP and report BLOCKED.** Do not update it. The pin moving is the single most informative failure available here — it would mean eye height changed flat-ground sight, and the flat-ground reasoning in the spec is wrong.

- [ ] **Step 8: Commit**

```bash
git add packages/sim/src/sim.ts packages/sim/src/elevation.test.ts
git commit -F - <<'EOF'
feat(sim): a unit's eyes are not on the dirt

E2 modelled an observer as a point at ground level, which made a
one-level rise an absolute sight wall even for someone standing at that
same height: the line descended from 1 to 0 and clipped the rise's far
shoulder. Measured on a terraced map, a unit saw nothing off its own
terrace until it was adjacent to the drop.

EYE_HEIGHT = 1 on both endpoints fixes it, symmetrically, because you see
a body and a body has height.

It must stay strictly below BLOCK_RISE. At 2 a flat-ground building
becomes 2*total > 2*total -- false -- and every building on every shipped
map stops blocking sight at once. The two constants sit in sim.ts as
unrelated numbers a tuning pass could move independently, so a test now
asserts the relationship rather than leaving it in someone's head.

The pin does not move. Open ground stays 0 > 1*total (false), an opaque
blocked tile stays 2*total > 1*total (true), and endpoint structures and
fences carry rise 0 so they stay transparent. Every flat path lands where
it landed.

One authoring consequence follows, and the tests state it: a single-level
rise no longer blocks anyone, since it sits exactly at eye level. Terrain
needs two levels to obscure ground troops -- one-level features are
cosmetic, two-level features tactical.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
EOF
```

---

### Task 2: Close the milestone in the documentation

Two questions have now been deferred twice each. This task closes them in writing so nobody reopens them by accident, and records the authoring rule Tel Marum will be drawn against.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-24-elevation-e2-design.md`

**Interfaces:** consumes Task 1's behaviour. Produces nothing.

- [ ] **Step 1: Update `CLAUDE.md`**

The map bullet currently describes what reads elevation after E2. Extend its last sentence so it also carries the three properties a map author needs before drawing:

- terrain needs **two levels or more** to obscure ground troops, because a one-level rise sits at eye level;
- every **opaque** blocked tile stands two levels above its own ground (fences do not block, but the ground under them does);
- **nothing sees further for being higher** — elevation affects what you can see *over*, never how far.

Keep it to a sentence or two. That bullet is already long, and these are authoring facts rather than a design essay.

- [ ] **Step 2: Close the aircraft question in E2's spec**

`docs/superpowers/specs/2026-08-24-elevation-e2-design.md` has an "Aircraft are not exempt" section ending with *"Revisit in E3, which already touches sight and elevation, and by then Tel Marum exists to measure whether the drone is dead weight or merely repositioned."*

E3 is here and the question is decided: **no exemption, permanently.** Replace that sentence with the decision and its reasoning:

- an exemption is **not pin-neutral** — for aircraft to clear a building their altitude must exceed `BLOCK_RISE`, which changes flat-ground sight on all four shipped maps, moves the pin, and requires `pnpm balance` re-run;
- it would be evaluated on maps with no relief;
- reopening it later is a deliberate new change with its own measurement, not an unfinished piece of this milestone.

- [ ] **Step 3: Verify the E3 spec needs no correction**

Read `docs/superpowers/specs/2026-08-24-elevation-e3-design.md` end to end against what shipped in Task 1. It was written before implementation, so check its claims survived: the constant's value, the flat-ground table, the two-level authoring rule, and the statement that E3 adds no per-tick cost because the addition happens once per ray rather than per tile.

**If anything differs from what was built, correct the spec** — it is the document a future reader consults. If everything matches, say so in your report and change nothing; do not edit for the sake of editing.

- [ ] **Step 4: Run the full gate sweep**

```bash
pnpm test
pnpm test:determinism
pnpm typecheck
pnpm lint
pnpm validate:data
pnpm validate:ui
pnpm build
pnpm balance
pnpm playtest
```

| Gate | Expectation |
|---|---|
| `test` | passes, including Task 1's new cases |
| `test:determinism` | **`1639983699`, unmoved** |
| `typecheck` / `lint` | clean |
| `validate:data` | 69 files |
| `validate:ui` | 18 files clean |
| `build` | succeeds |
| `balance` | five §5.7 figures unchanged |
| `playtest` | exits 1 on exactly `beit_sahwan_breach (passive control)` and `beit_sahwan_3_clearance` |

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-24-elevation-e2-design.md
git commit -F - <<'EOF'
docs: close the elevation milestone

CLAUDE.md's map bullet gains the three properties a map author needs
before drawing: terrain needs two levels to obscure ground troops, opaque
blocked tiles stand two levels above their own ground while fences do not
block at all, and nothing sees further for being higher.

E2's spec said the aircraft question would be revisited in E3. E3 is here
and it is decided: no exemption, permanently. An exemption is not
pin-neutral -- clearing a building needs altitude above BLOCK_RISE, which
changes flat-ground sight on all four shipped maps -- and it would be
evaluated on maps that have no relief. Reopening it is a deliberate new
change, not an unfinished piece of this one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
EOF
```

If Step 3 found the E3 spec needed correcting, stage it in this commit too and say so in the message.

---

## Self-review

**Spec coverage.**

| Spec section | Task |
|---|---|
| `EYE_HEIGHT = 1` on both endpoints | 1, Steps 3-4 |
| The `EYE_HEIGHT < BLOCK_RISE` constraint, with a test | 1, Step 6 |
| Flat ground untouched; pin does not move | 1, Step 7 |
| The terracing fix (the three-case measurement) | 1, Step 1 |
| The two-level authoring rule | 1 Step 1's third test, 2 Step 1 |
| Aircraft: no exemption, permanently | Global Constraints, 2 Step 2 |
| Sight range cut, with reasoning | Global Constraints; already recorded in the E3 spec |
| Verification sweep | 1 Step 7, 2 Step 4 |

**Placeholder scan.** No TBD/TODO. Every code step carries real code. Task 2 Step 3 is conditional on a reading whose outcome the implementer reports either way — an instruction, not a deferral.

**Type consistency.** `EYE_HEIGHT` is defined once in Task 1 Step 3, used in Step 4, and asserted in Step 6. `BLOCK_RISE` is E2's, unchanged. The tests reuse `SCOUT`, `watch` and `ridge` from E2's describe block rather than redefining them — and I checked the file rather than guessing: all three are scoped *inside* `describe('elevation and line of sight', ...)` at `:109`, `:118` and `:135`, so Step 1 specifies a nested `describe` rather than a sibling. Three defects in this milestone came from placement instructions that described a location instead of naming one; this one names it.

**Two risks the plan cannot remove.** Task 1 Step 2's RED state is **two failures and two passes**, not one and three — the "one-level rise no longer blocks" case asserts post-fix behaviour. An implementer expecting a single failure could conclude a test is wrong. And Task 1 Step 6 asks to export two module-private constants purely for a test; if that feels like the wrong trade, the plan says to report it rather than invent a third way of reaching them.
