# Elevation E2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `losRay` read terrain elevation, so high ground sees over low obstacles and valleys become dead ground — without changing a single flat-ground outcome.

**Architecture:** At each intervening tile of the Bresenham walk, compare that tile's sight height against the sight line's interpolated height and block when terrain is higher. The interpolation cross-multiplies rather than dividing, so it stays in plain integers. Every blocked tile — rock or building — stands `BLOCK_RISE` (2) above its own ground; open ground is its elevation alone.

**Tech Stack:** TypeScript strict, vitest, `@lions/sim` (Q16.16 fixed-point, `Math.*` and `Date.*` banned).

**Spec:** `docs/superpowers/specs/2026-08-24-elevation-e2-design.md` (committed `a33f2c6`)

## Global Constraints

- **The determinism pin must NOT move. It reads `1639983699`.** This is the inverse of E1, which moved it deliberately. E2 changes behaviour only where relief exists and the pinned replay runs on a flat map, so **a moved pin means E2 changed flat-ground sight — a bug, never a value to update.**
- **Changes confined to `packages/sim/src/`.** Nothing under `packages/render/`, `packages/app/`, `packages/data/`, `tools/`, `data/`.
- **`@lions/sim` bans `Math.*` and `Date.*`** and requires Q16.16 for fractional quantities. Everything E2 adds is a plain integer that never combines with an `fx.*` value — if you find yourself reaching for `fx.div` or `Math.floor`, the design has been misread.
- **No `isAir` branch.** Terrain blocks aircraft exactly as it blocks ground units. Decided; revisit in E3.
- **Existing `losRay` semantics survive unchanged on flat ground:** endpoint structures stay transparent, `lowProfile` still adds cover instead of blocking, the smoke early-return is untouched, and cover accumulation is unchanged.
- TypeScript strict. No `any`. No non-null assertions.
- **Never `git add -A` or `git add .`, and never `git stash` in any form.** This repository's stash stack is shared with other live worktrees and concurrent sessions.
- **Commit message trailers** — every commit ends with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
  ```

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/sim/src/sim.ts` | `BLOCK_RISE`, the height comparison inside `losRay` | 1 |
| `packages/sim/src/elevation.test.ts` | the relief tests — both directions of the rule | 1 |
| *(measurement only, no file)* | detection cost profile at scale | 2 |
| `docs/superpowers/specs/2026-08-24-elevation-e2-design.md`, `CLAUDE.md` | record what shipped and the measured cost | 3 |

---

### Task 1: `losRay` reads height

**Files:**
- Modify: `packages/sim/src/sim.ts` (a constant near the other tuning constants; `losRay` at `:1780`)
- Modify: `packages/sim/src/elevation.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `Sim.elevation` (`Uint8Array`, row-major) and `Sim.setElevation(x, y, h)`, both shipped in E1. `Sim.setBlocked(x, y, b)` is public and already used by `movement.test.ts`.
- Produces: nothing later tasks import. Task 2 measures the code this task writes.

- [ ] **Step 1: Write the failing tests**

Append to `packages/sim/src/elevation.test.ts`. These build relief explicitly, because **on flat ground E2's new code path is provably never taken** — a flat corpus would pass with the rule implemented backwards.

```ts
// Elevation E2: losRay reads height. Each case authors relief, because on
// flat ground the new comparison can never fire -- every elevation is 0, so
// `0 > 0` is false for open ground and the rule is untestable there.
//
// The pairing is the point. "Cannot see" alone passes for a broken spawn, a
// too-short sight range, or too few ticks; each case below is paired with the
// arrangement that SHOULD see, so the assertions discriminate.
describe('elevation and line of sight', () => {
  const SCOUT: UnitTypeJson = {
    id: 'e_scout',
    role: 'infantry',
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1.0 },
    sensors: { optics: 1, sight_tiles: 16, signature: 0.6 },
  };

  /** Two scouts on opposing sides at the given tiles, after detection settles. */
  function watch(
    build: (sim: Sim) => void,
    ax: number,
    ay: number,
    bx: number,
    by: number
  ): { sim: Sim; a: number; b: number } {
    const sim = new Sim({ seed: 9, width: 24, height: 12, capacity: 8 });
    build(sim);
    const t = sim.addUnitType(SCOUT);
    const a = sim.spawn(t, 0, fx.from(ax + 0.5), fx.from(ay + 0.5));
    const b = sim.spawn(t, 1, fx.from(bx + 0.5), fx.from(by + 0.5));
    for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.tick();
    return { sim, a, b };
  }

  /** A wall of raised open ground down column 8, `h` levels high. */
  const ridge = (h: number) => (sim: Sim): void => {
    for (let y = 0; y < 12; y++) sim.setElevation(8, y, h);
  };

  it('a rise between two units on the valley floor blocks them', () => {
    const { sim, a, b } = watch(ridge(3), 4, 6, 14, 6);
    expect(sim.debugDetection(a, b)?.visible).toBe(false);
  });

  it('and the same ground flat does not — the control', () => {
    const { sim, a, b } = watch(() => {}, 4, 6, 14, 6);
    expect(sim.debugDetection(a, b)?.visible).toBe(true);
  });

  it('a unit on high ground sees over a lower rise', () => {
    // Observer level with the ridge top, target beyond it. The sight line
    // runs from 3 down to 0, passing above the ridge's own 3 at its start.
    const { sim, a, b } = watch(
      (sim) => {
        ridge(2)(sim);
        for (let y = 0; y < 12; y++) sim.setElevation(4, y, 4);
      },
      4,
      6,
      14,
      6
    );
    expect(sim.debugDetection(a, b)?.visible).toBe(true);
  });

  it('rock blocks two units standing at its own elevation', () => {
    // The case that falsified the first draft of the rule. With rock's sight
    // height being its bare elevation, `3 > 3` is false and a solid ridge
    // goes transparent. BLOCK_RISE is what makes this block.
    const { sim, a, b } = watch(
      (sim) => {
        for (let y = 0; y < 12; y++) {
          for (let x = 0; x < 24; x++) sim.setElevation(x, y, 3);
        }
        for (let y = 0; y < 12; y++) sim.setBlocked(8, y, true);
      },
      4,
      6,
      14,
      6
    );
    expect(sim.debugDetection(a, b)?.visible).toBe(false);
  });

  it('a plateau with no obstruction does not block, however high', () => {
    // Guards the opposite error: raising everything equally must change
    // nothing, or the rule is comparing against the wrong baseline.
    const { sim, a, b } = watch(
      (sim) => {
        for (let y = 0; y < 12; y++) {
          for (let x = 0; x < 24; x++) sim.setElevation(x, y, 5);
        }
      },
      4,
      6,
      14,
      6
    );
    expect(sim.debugDetection(a, b)?.visible).toBe(true);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm vitest run packages/sim/src/elevation.test.ts
```

Expected: the three cases that require blocking (`a rise between two units`, `rock blocks two units`) FAIL — nothing reads elevation yet, so nothing blocks. The controls (`the same ground flat`, `sees over a lower rise`, `a plateau`) PASS already, which is correct and expected: they assert visibility, and everything is visible today.

**Those passing controls are not a problem — they are the discrimination.** If a control ever fails, the harness is wrong and the failing cases prove nothing.

- [ ] **Step 3: Add the constant**

In `packages/sim/src/sim.ts`, near the other module-level constants:

```ts
/** How far a blocked tile — rock or building — stands above its own ground,
 *  in elevation levels.
 *
 *  2 is what the renderer already draws: a building at H = 18 px against E1's
 *  ELEV_STEP of 10, and rock scatter that sits proud of its own tile. Sight
 *  and drawing agreeing is the whole point of the elevation milestone.
 *
 *  It also has to be non-zero for a reason found while designing: with rock's
 *  sight height being its bare elevation, two units on a plateau at elevation
 *  3 would see through rock also at elevation 3, because `3 > 3` is false. A
 *  solid, impassable ridge would go transparent. */
const BLOCK_RISE = 2;
```

- [ ] **Step 4: Add the endpoint heights and the step count**

Inside `losRay`, immediately after the existing `dx`/`dy` absolute-value lines and before `let err = dx - dy;`:

```ts
    // Endpoint sight heights, and the ray's step count.
    //
    // `total` is the iteration count: this is classical two-branch Bresenham,
    // so the major axis advances exactly once per iteration. It is zero only
    // when both endpoints are the same tile, and such a ray returns from the
    // equality check at the top of the loop before reaching the comparison
    // below. The cross-multiply assumes `total > 0` and is protected by that
    // early return rather than by a guard of its own -- a refactor that moved
    // the early return would divide this assumption out from under it.
    const h0 = this.elevation[y0 * w + x0];
    const h1 = this.elevation[y1 * w + x1];
    const total = dx > dy ? dx : dy;
    let k = 0;
```

- [ ] **Step 5: Add the height comparison**

Inside the loop, the existing blocked-tile block reads:

```ts
      const t = y * w + x;
      if (this.blocked[t] !== 0) {
        const st = this.structureOfTile[t];
        if (st >= 0 && this.structureTypes[this.stTypeIdx[st]].lowProfile) {
          if (coverCount < 8) coverCount++;
        } else if (st < 0 || (st !== sFrom && st !== sTo)) {
          return -1;
        }
      }
```

Replace it with:

```ts
      const t = y * w + x;
      k++;
      // Terrain against the sight line, cross-multiplied so this stays in
      // plain integers -- no division, no fixed point. Elevations are 0-9,
      // BLOCK_RISE adds 2, and maps are at most 128 wide, so every term here
      // is under about 1,400.
      //
      // On flat ground h0, h1 and every elevation are 0, so the right-hand
      // side is 0: open ground can never block, and a blocked tile's
      // `0 + 2 > 0` blocks exactly as it did before elevation existed.
      const lineH = h0 * total + (h1 - h0) * k;
      if (this.blocked[t] !== 0) {
        const st = this.structureOfTile[t];
        if (st >= 0 && this.structureTypes[this.stTypeIdx[st]].lowProfile) {
          if (coverCount < 8) coverCount++;
        } else if (st < 0 || (st !== sFrom && st !== sTo)) {
          if ((this.elevation[t] + BLOCK_RISE) * total > lineH) return -1;
        }
      } else if (this.elevation[t] * total > lineH) {
        return -1;
      }
```

Three things preserved deliberately: `lowProfile` still adds cover and never blocks, a structure at either endpoint is still transparent to its own ray, and cover accumulation below is untouched.

- [ ] **Step 6: Run the tests**

```bash
pnpm vitest run packages/sim/src/elevation.test.ts
```

Expected: all cases PASS, controls included.

If `a unit on high ground sees over a lower rise` fails, the interpolation's direction is likely inverted — check that `k` counts from the *observer* end, since `h0` is the observer's height.

- [ ] **Step 7: Prove flat ground is untouched — the gate that matters**

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

**If the pin moved, STOP and report BLOCKED.** It means E2 changed flat-ground sight. Do not update the value — that would bury the bug this gate exists to catch.

- [ ] **Step 8: Commit**

```bash
git add packages/sim/src/sim.ts packages/sim/src/elevation.test.ts
git commit -F - <<'EOF'
feat(sim): line of sight reads terrain height

losRay now compares each intervening tile's sight height against the
sight line's interpolated height and blocks when terrain is higher. High
ground sees over a rise; the valley floor does not. Dead ground is real
for the first time.

The interpolation cross-multiplies rather than dividing, so it needs no
fixed point at all: elevations are 0-9, BLOCK_RISE adds 2, maps are at
most 128 wide, and every term stays under about 1,400. These integers
never combine with an fx.* quantity, so invariant 2 is satisfied
trivially rather than carefully.

Every blocked tile stands BLOCK_RISE above its own ground, rock and
building alike. Rock's bare elevation was the first draft and it had a
hole: two units on a plateau at elevation 3, with rock also at elevation
3 between them, would see through it because 3 > 3 is false -- a solid
impassable ridge going transparent. One rule for all blocked tiles fixes
that, keeps see-over-from-high-ground, and matches what the renderer
already draws.

The determinism pin does NOT move, and that is the gate. Every shipped
map is flat, so the right-hand side is zero throughout: open ground can
never block and a blocked tile's 0 + 2 > 0 blocks exactly as before. A
moved pin would have meant flat-ground sight changed.

Which is also why the tests author relief explicitly. On flat ground
this code path is provably never taken, so the whole suite would pass
with the rule implemented backwards.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
EOF
```

---

### Task 2: Measure what it costs per tick

`losRay` is called from ten sites, including `detectionPair` inside a detection loop this project's own notes flag as **O(N²) pairs per tick**. Task 1 adds an integer multiply and compare per tile walked. That is a constant factor rather than a new order of growth — but the GDD's 300-unit target has never been validated, and a measurement taken alongside the change is worth more than one taken after it.

**This task produces a number and a recommendation, not a code change.** If the cost is material, that is a finding to route to the perf specialist, not something to fix here.

**Files:** none permanently. Any measurement harness is throwaway and must not be committed.

**Interfaces:**
- Consumes: the `losRay` change from Task 1.
- Produces: a measured figure recorded in Task 3's docs.

- [ ] **Step 1: Measure detection cost before and after**

Build a throwaway timing harness under `tools/src/backtest/` with a `__probe_` prefix marking it disposable. Spawn a realistic worst case — **300 units**, split between two sides on open ground large enough that most pairs are in sight range — and time a fixed number of ticks.

Measure twice: once on the current code, and once with the height comparison disabled (comment out the two `return -1` height checks Task 1 added, leaving the rest intact). Restore afterwards, and **restore by undoing the edit, never with `git checkout`** — in this repository that has previously destroyed unrelated uncommitted work.

Report tick time for both, as a percentage difference.

- [ ] **Step 2: Measure at the authored scale too**

300 units is the GDD's target, not today's reality. The largest authored mission fields 65. Take the same measurement at 65 units so the report says both what it costs now and what it would cost at the target.

- [ ] **Step 3: Judge and report**

State plainly whether the added cost is material. Rough guidance: under about 2% at 300 units is noise and needs no action; 2–10% is worth recording for the perf specialist; above 10% at 300 units is a finding that should be raised before merge rather than after.

**Do not optimise anything.** If the number is bad, that is the deliverable. Optimising `losRay` is its own change with its own review, and guessing at an optimisation inside a measurement task produces neither a reliable measurement nor a reviewable optimisation.

- [ ] **Step 4: Delete the harness and confirm the tree is clean**

```bash
git status --short
```

Expected: empty. The probe is throwaway; nothing from this task is committed.

---

### Task 3: Docs, and the measured cost

**Files:**
- Modify: `docs/superpowers/specs/2026-08-24-elevation-e2-design.md`
- Modify: `CLAUDE.md`

**Interfaces:** consumes Task 2's measurement. Produces nothing.

- [ ] **Step 1: Record the measurement in the spec**

The spec's Verification section says a profile is routed to perf-analyst alongside merge. Replace that forward-looking sentence with what was actually measured: the figure at 65 units, the figure at 300, and the judgement.

If the cost turned out material, say so plainly rather than softening it — the spec is what a future reader consults, and a recorded number they can act on is worth more than reassurance.

- [ ] **Step 2: Update `CLAUDE.md`**

The map bullet currently ends with E1's sentence:

> E1 stores and draws it at 10 px per level; nothing reads it for line of sight, sight range or pathing yet.

That is now false. Replace from "nothing reads it" onward so it says line of sight reads elevation — high ground sees over lower obstacles, every blocked tile stands two levels above its own ground — and that sight range and pathing still do not.

- [ ] **Step 3: Run the full gate sweep**

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
| `test` | passes, including the new relief cases |
| `test:determinism` | **`1639983699`, unmoved** |
| `typecheck` / `lint` | clean |
| `validate:data` | 69 files |
| `validate:ui` | 18 files clean |
| `build` | succeeds |
| `balance` | five §5.7 figures unchanged |
| `playtest` | exits 1 on exactly `beit_sahwan_breach (passive control)` and `beit_sahwan_3_clearance` |

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-24-elevation-e2-design.md CLAUDE.md
git commit -F - <<'EOF'
docs: line of sight reads elevation, and what it costs

CLAUDE.md's map bullet said nothing reads elevation for line of sight.
That is no longer true, and the sentence is replaced with what does and
does not read it now: sight does, range and pathing still do not.

The spec's forward-looking note about routing a profile to perf-analyst
is replaced with the measurement itself, at both the authored scale and
the GDD's 300-unit target.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018ViEbsUskSPGL6KVPajDn9
EOF
```

---

## Self-review

**Spec coverage.**

| Spec section | Task |
|---|---|
| The cross-multiplied rule | 1, Steps 4-5 |
| `total > 0` protected by control flow, documented | 1, Step 4 |
| Sight height per tile, `BLOCK_RISE` for every blocked tile | 1, Step 3 and 5 |
| Why one rule for all blocked tiles | 1, Step 3's comment and Step 1's rock test |
| No `isAir` exemption | Global Constraints |
| Flat ground bit-identical; pin must not move | 1 Step 7, 3 Step 3 |
| The fixture is mandatory | 1, Step 1 |
| Perf profile alongside merge | 2 |
| Verification sweep | 3, Step 3 |

**Placeholder scan.** No TBD/TODO. Every code step carries real code. Task 2's harness is deliberately unspecified in shape — it is throwaway measurement scaffolding, and prescribing its internals would be prescribing a file that gets deleted in the same task.

**Type consistency.** `BLOCK_RISE` is defined once in Task 1 Step 3 and used once in Step 5. `h0`, `h1`, `total`, `k` and `lineH` are all introduced in Steps 4-5 and used only there. The tests use `Sim.setElevation` and `Sim.setBlocked`, both public and both already exercised by existing tests (`elevation.test.ts` and `movement.test.ts` respectively).

**One risk the plan cannot remove.** Task 1 Step 7 can legitimately fail — the pin can move — and it is instructed to STOP rather than update the value. That is deliberate: a moved pin is the single most informative failure available here, because it means the rule changed flat-ground sight, and every shipped mission depends on it not having done so.
