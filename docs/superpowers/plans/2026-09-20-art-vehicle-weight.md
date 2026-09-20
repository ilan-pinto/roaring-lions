# Vehicle weight — the hull that leans, lags and settles (WP-A1.3, GH-177) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A vehicle stops gliding. It squats when it pulls away, leans into a turn, stands on the ground it is actually crossing, settles when it halts, and throws dust at a rate that follows how fast it is going. All of it presentation: a per-vehicle smoothed state in the renderer driven by the frame clock, with the sim's 20 Hz step function as its only input and nothing read back.

**Architecture:** Almost all of it is pure. `three/units/vehicle-weight.ts` is a new module with no `three` and no `Sim` import — four-corner terrain tilt with no history, and a per-entity smoothed speed/heading filter shaped exactly like `stepTurretFacing` (`three/units/frame-state.ts:436`). `three/units/vehicle-weight-params.ts` resolves the authored `mobility.weight` block against role defaults. `three/units/vehicle-fx.ts` gains a speed-driven dust interval. `ThreeRenderer.ts` is touched exactly once, in one task, in three adjacent regions (Ruling R-E), and that task is LAST. `packages/sim` is untouched; `packages/app` is untouched; `packages/render/src/renderer.ts` stays byte-identical to `main`.

**Tech Stack:** TypeScript strict, vitest (`environment: 'node'` for every file here), three.js r170, Playwright (the capture harness only). No new dependencies. One schema change: an optional `mobility.weight` block in `data/schemas/unit.schema.json`.

**Spec:** `docs/superpowers/specs/2026-09-20-art-vehicle-weight-design.md` — Decisions R-A…R-Q, Constraints, Architecture, Testing and evidence. The spec is the binding authority; this plan argues from it. Execution-plan package **WP-A1.3 (#177)**, art lane Phase 1 · Weight, sub-project 3. One branch (`feat/art-vehicle-weight`), one landing, one bless budgeted.

---

## Before Task 6: the wait

**Task 6 is the only task that opens `ThreeRenderer.ts`, and it does not start until Lane A's Phase 2 Tasks 15–16 are on `main`** (Ruling R-E; the file boundary in `docs/superpowers/specs/2026-09-16-shell-upgrade-design.md:489-508`, whose rule is that vehicle motion and the scene host are never both in flight on that file). Those are the range rings (`three/units/overlays.ts`, `three/units/overlay-geometry.ts`) and the minimap ground (`api.ts`), running in the sibling worktree `feat/shell-phase-2-render`.

Tasks 1–5 and their commits do not touch `ThreeRenderer.ts` at all and run regardless. When the run reaches Task 6:

1. Check the status board and `gh pr list` / `git log origin/main --oneline` for the Tasks 15–16 landing. **Do not assume it from this plan** — it was in flight when this was written.
2. If it has not landed, **stop and report**. Do not start Task 6 and do not reorder around it.
3. When it has, `/usr/bin/git fetch origin && /usr/bin/git merge origin/main` on this branch first, resolve nothing by guesswork, and re-run `pnpm lint && pnpm typecheck && pnpm test` before writing a line of Task 6.
4. Before editing, `/usr/bin/git diff main...HEAD -- packages/render/src/three/ThreeRenderer.ts` and read what Lane A changed. The spec expects their landing in `updateOverlays` (~line 6128 before the merge), 600–900 lines downstream of everything this task touches — a line-level conflict is unlikely *if* this task stays inside the per-entity field block (~1190–1360), `updateVehicleAmbientFx` (~3643) and `updateVehicleMeshes` (~5248–5500) and reorders no method. The shared risk is the field-declaration block, if Lane A also added class fields near the top.

## Global Constraints

Copied from the spec's "Constraints that bind every task", binding on every task below:

- **The four invariants.** Fixed 20 Hz tick with the renderer interpolating; Q16.16 in `@lions/sim` with no floating point; seeded per-entity PRNG; data one way, commands → sim → state + events. **This package's diff under `packages/sim/` is empty** — `git diff --stat <base>..HEAD -- packages/sim` must print nothing at landing, and `pnpm test:determinism` is in Task 6's gate line because "cannot move" is a claim and the gate is the evidence. Every clock touched here is the FRAME clock, through `frameDtMs`/`frameDtSeconds` (`ThreeRenderer.ts:4679-4687`), **never raw `dtMs`** — the 2026-09-18 ambient-FX drift is fixed and must not be reintroduced. Nothing presentation writes is ever read back by the sim.
- **The colour pipeline is the standard one and its two surviving rules still bite.** Nothing here adds a colour; if anything ever does, vertex and uniform colours are LINEAR (`hexToLinear`) and ground albedo alone stays `NoColorSpace`.
- **Render-order bands come from `units/render-order.ts`**, the single source of truth. Nothing here changes a band: the hull stays at 0, the turret at 1.
- **`three` may only be imported under `packages/render/src/three/**`**, enforced by eslint; the rule's `paths` entry does not catch subpath imports (`three/addons/...`), so keep those inside by discipline. **`@lions/render` may not import `@lions/data`** (`eslint.config.mjs:138-147`) — a raw `data/*.json` relative import is the sanctioned route, with two production precedents (`three/units/mesh-role.ts:44`, `three/terrain/tones.ts:27`). **This package adds no `api.ts` member and no dynamic-import door.**
- **Pixi owes no parity.** `packages/render/src/renderer.ts` stays byte-identical to `main`; none of the new code is reachable from it.
- **The file boundary with Lane A** (`docs/superpowers/specs/2026-09-16-shell-upgrade-design.md:489-508`). This session owns `packages/render/src/three/units/mesh-*.ts`, `packages/render/src/three/ThreeRenderer.ts`, `tools/src/perf/*`, `art/meshes/**`, `assets/meshes/**` and CLAUDE.md's "Mesh units" section. **Do not touch `packages/app/**`** (the shell programme's, `main.ts` included) and **do not touch `three/units/overlays.ts` or `three/units/overlay-geometry.ts`**.
- **The pure model imports neither `three` nor `Sim`.** `three/units/vehicle-weight.ts` takes plain numbers and returns plain numbers, the way `three/units/vehicle-fx.ts` already does, so it is testable with no `WebGLRenderer` and presentation-only by construction.
- **No `any`, no non-null assertion in new code.** Strict TypeScript; tests colocated as `*.test.ts`; the three-side suites run under `environment: 'node'` and, where they construct a `ThreeRenderer`, mock `WebGLRenderer` exactly the way `ThreeRenderer.collapse.test.ts:38-55` does.
- **Every check gets an input that makes it fail — constructed, and run.** Each task names the mutation that turns its test red and the commit message says it was seen red. **A sign flip is the cheapest and most valuable mutation in this package**: half of what it computes is a signed angle, and a tilt with the wrong sign looks plausible and is wrong.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data`. Plus `pnpm test:determinism` once, on Task 6. Nothing here needs `validate:assets`, `validate:meshes`, `validate:ui`, `balance` or `playtest` — no new PNG, no new GLB, no UI source, no sim change.
- **Git hygiene:** commit with explicit paths (`git add <paths>` / `git commit -s -- <paths>`), never `-A` — other sessions share this working tree; never `git checkout -- <file>`; DCO `-s`; the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` verbatim.
- **Do not kill the dev server.** No `pkill -f vite`, ever: other sessions share this machine. The harness starts and stops its own through `ensureDevServer`/`stopDevServer` (`tools/src/golden-diff/browser.ts`), which kills the process GROUP it created and nothing else.

## Rulings

The spec's Decisions, restated here as the ones that change what a task may do. Read the spec for each one's full reasoning and measurement.

- **R-A — Turret lag already exists and is NOT new scope.** `stepTurretFacing` (`frame-state.ts:436`) is a working damped spring with seeding and spring-back. **This plan does not touch it.** A different turret FEEL is a constant change and a G1 sentence — spec open question 2.
- **R-B — The per-vehicle weight parameters live in the unit JSON**, an optional schema-validated `mobility.weight` block, with role-based defaults in the renderer for units that declare none. `pnpm validate:data` validates it; `pnpm balance` and the sim never read it. Task 4.
- **R-C — The drawn hull may trail the sim by at most 0.25 tile, and never on a unit the sim reports stationary.** Picking keeps reading the sim position, unchanged. Pinned by a pure sweep spec, Task 3.
- **R-D — Everything is presentation**, driven by the frame clock, with the sim's 20 Hz step function as the input. Invariants 1 and 4 hold by construction.
- **R-E — `ThreeRenderer.ts` is ONE small region and it is the LAST code task** (Task 6), after Lane A's Tasks 15–16 land and `origin/main` is merged. See "Before Task 6" above.
- **R-F — The hull must not pitch or roll during its own death.** The weight state freezes when `alive === 0`.
- **R-G — Before-captures first** (Task 1), git-ignored under `.superpowers/art-captures/weight/<label>/`; the after-set is the acceptance evidence and the lead judges on motion. **The golden `vehicle` scenario must not move** — a parked vehicle's weight state is the identity transform, pinned by a spec in Task 3 and again in Task 6.
- **R-H — Pixi owes no parity; `packages/sim` untouched; `three` only.**
- **R-I — The unit JSON reaches the renderer by relative import of the JSON file**, not through `@lions/data` (eslint), not `RendererOptions` (`main.ts` is Lane A's), not `UnitType` (a sim edit R-H forbids). The hand-kept import list is pinned to `art/meshes/vehicles/*.glb` by a disk-reading test. Task 4.
- **R-J — Wheel spin and track-UV scroll are OUT**, measured: no shipped GLB has a `wheel_*` or `track_*` node, every one merges wheels and tracks into a single `hull_rubber` mesh, four carry no UVs on it at all, and the seven that do share the hull's material. Spec open question 1.
- **R-K — Tilt is composed in the hull's own frame, and the shipped recoil pitch comes with it.** Measured: `rotation.x` under yaw is a WORLD-axis tilt — full bank at every heading, zero pitch facing east, nose-DOWN facing north. **R-C's 0.25-tile bound is on the COMBINED offset**, recoil (up to `MESH_HULL_RECOIL_TILES` = 0.16) included, clamped once at the end.
- **R-L — Roll normalises by the unit's own authored `turn_rate_deg_s`**, because `turnToward` (`sim.ts:3459`) already rate-limits every facing change. No second constant.
- **R-M — Pitch fakes the ramp** the sim does not have, off a smoothed speed, normalised by `speed_tiles_s`. The authored maximum is ±2°, deliberately under the recoil's 3.4°.
- **R-N — The death freeze is free** (a dead entity leaves `vehicleMeshEntities` in the same frame); what needs writing is the first-frame `seeded` companion every other per-entity array here already has.
- **R-O — "Dust tied to speed" is the CADENCE and the ANCHOR.** The magnitude ramp already exists and is not re-implemented. Task 5 (pure) and Task 6 (wiring).
- **R-P — The harness is `blast-captures.ts` retargeted, and the one thing it cannot inherit is that the SIM must advance.** `__lions.step(n)` ends with one `renderer.frame(1, lastFrameMs)` at alpha 1; the weight ladder alternates `step(1)` with hand-pumped `renderer.frame(alpha, FRAME_MS)`.
- **R-Q — The acceptance instrument is numeric as well as photographic.** A layer toggle cannot see motion; a per-frame readback of the drawn transform against the sim's own position and heading can, and it measures R-C's bound on the running game. **A zero across every rung is a FAILURE.**

## File structure

| File | Responsibility | Task |
|---|---|---|
| `tools/src/perf/weight-captures.ts` (+test) | The three-phase motion ladder and the numeric readback, before and after | 1, 7 |
| `packages/render/src/three/units/vehicle-weight.ts` (+test) | Pure: four-corner terrain tilt (no history) | 2 |
| `packages/render/src/three/units/vehicle-weight.ts` (+test) | Pure: the per-entity smoothed state, and R-C's bound | 3 |
| `data/schemas/unit.schema.json` | The optional `mobility.weight` block (R-B) | 4 |
| `packages/render/src/three/units/vehicle-weight-params.ts` (+test) | Role defaults, JSON overrides, and the import-list pin (R-I) | 4 |
| `packages/render/src/three/units/vehicle-fx.ts` (+test) | `vehicleDustIntervalMs` — cadence from speed (R-O) | 5 |
| `packages/render/src/three/ThreeRenderer.ts` (+`ThreeRenderer.vehicle-weight.test.ts`) | The one region: the per-entity arrays, `updateVehicleMeshes`, the ambient-FX call | 6 |
| `CLAUDE.md` ("The three.js backend" and "Mesh units" sections only) | The stale `vehicle` noise line and the vehicle-motion state | 7 |

---

### Task 1: The before-captures, and the instrument that takes them

R-G: the before-set comes first, because it is the baseline every later task is judged against and because an instrument built after the change is an instrument nobody can trust to have seen the change. R-Q makes this harness the package's only real witness: the golden gate cannot see motion, and there is no layer to toggle — the hull draws either way.

**This is a retarget of `tools/src/perf/blast-captures.ts`, not a new instrument.** Read that file's header before writing a line of this one. Three of its behaviours are inherited verbatim and each was paid for once already: the frame loop frozen with `FREEZE_FRAME_LOOP_SCRIPT` (never a `sleep()` — `step()`'s own paint must be the last paint, the failure that cost the golden gate a 28% false-red rate); every frame after that pumped EXPLICITLY, because rAF is throttled in a hidden tab and a frame-driven read comes back stale with no error; and subjects SPAWNED rather than found, on the open northern band of `beit_sahwan_outskirts` (rows 0–7 are open end to end).

**What it cannot inherit is the frozen sim (R-P).** The blast ladder freezes the sim and advances only the FX clock, which is right for an explosion and useless for a moving vehicle. `__lions.step(n)` (`packages/app/src/main.ts:3851`) runs n ticks and then exactly ONE `renderer.frame(1, lastFrameMs)` — alpha 1, at a frame delta this harness cannot read or set — so a ladder driven by `step()` alone photographs tick boundaries only and misses the interpolation the whole package lives in. Each rung is therefore `step(1)` followed by `FRAMES_PER_TICK` hand pumps of `renderer.frame(alpha, FRAME_MS)` with alpha walking across the tick, and the measured `stepJumpMs` is read from a dry `step(1)` at boot and written into the sheet exactly as the blast harness does.

Orders come from `L.sim.queueCommand({ kind: 'move', ids: [id], x, y })`, **one order per body** — `gait-captures.ts:741-762`'s reason: a group order lands in formation (`packages/sim/src/formation.ts`) and would shuffle the subjects off their own lane.

**Files:**
- Create: `tools/src/perf/weight-captures.ts`
- Create: `tools/src/perf/weight-captures.test.ts`
- Modify: `package.json` and `tools/package.json` (a `weight:capture` script beside `blast:capture`)

**Interfaces:**
- Consumes: `ensureDevServer`, `stopDevServer` (`tools/src/golden-diff/browser.ts`); `FREEZE_FRAME_LOOP_SCRIPT` (`tools/src/golden-diff/capture-protocol.ts`); `window.__lions` (`step`, `sim`, `renderer`, `units`, `goto`).
- Produces (Task 7 re-runs these exact names):
  - `export const SAMPLE_MS: readonly number[]` — the ten-second ladder
  - `export const WEIGHT_PHASES: readonly WeightPhase[]` — `'start' | 'stop' | 'turn'`
  - `export const WEIGHT_SUBJECTS: readonly WeightSubject[]`
  - `export function sampleLadder(windowMs: number, everyMs: number): number[]` (pure)
  - `export function framePumps(tickMs: number, frameMs: number): number[]` (pure) — the alpha walk across one tick
  - `export function sheetIndex(label: string, cells: readonly SheetCell[]): string` (pure)
  - `export interface WeightReading { ms, subject, phase, offsetTiles, pitchDeg, rollDeg, simSpeed, simFacing }`
  - output at `.superpowers/art-captures/weight/<label>/`, with `sheet.md` and `sheet.json`

- [ ] **Step 1: Write the failing tests**

```ts
// tools/src/perf/weight-captures.test.ts
import { describe, expect, it } from 'vitest';
import {
  SAMPLE_MS,
  WEIGHT_PHASES,
  WEIGHT_SUBJECTS,
  framePumps,
  sampleLadder,
  sheetIndex,
} from './weight-captures';

describe('the ten-second ladder', () => {
  // G0 #14's precedent, inherited from the blast: the lead judges this on ten
  // seconds of motion. 200 ms is the step blast-captures.ts settled on and
  // there is no reason to differ -- a start, a stop and a turn all take longer
  // than a fireball, so a coarser step would still catch them and a finer one
  // only costs frames.
  it('covers ten seconds inclusive of both ends, every 200 ms', () => {
    const ladder = sampleLadder(10_000, 200);
    expect(ladder[0]).toBe(0);
    expect(ladder[ladder.length - 1]).toBe(10_000);
    expect(ladder).toHaveLength(51);
    expect(SAMPLE_MS).toEqual(ladder);
  });

  // A standing start is over in well under a second at 1.1 tiles/s, and the
  // pitch it produces is the shortest-lived thing this package draws. A ladder
  // that first samples at 200 ms would photograph the settle and call it the
  // launch.
  it('samples the first half-second at least three times', () => {
    expect(SAMPLE_MS.filter((ms) => ms <= 500).length).toBeGreaterThanOrEqual(3);
  });

  it('refuses a step that does not divide the window, rather than silently truncating', () => {
    expect(() => sampleLadder(10_000, 300)).toThrow(/divide/);
  });
});

describe('the frame pumps inside one tick (R-P)', () => {
  // The whole package lives between ticks. A ladder that only photographs
  // alpha 1 is photographing the one frame per tick where interpolation has
  // nothing left to do, which is exactly the frame `__lions.step` draws by
  // itself -- so it would read identically with the feature and without it.
  it('walks alpha across the tick and ends at 1', () => {
    const alphas = framePumps(50, 16.67);
    expect(alphas.length).toBeGreaterThanOrEqual(3);
    expect(alphas[alphas.length - 1]).toBeCloseTo(1, 6);
    expect(alphas[0]).toBeGreaterThan(0);
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeGreaterThan(alphas[i - 1]);
  });

  it('never hands the renderer a frame delta past the clamp', () => {
    // FRAME_DT_CEILING_MS is 100. A pump longer than that is silently clamped
    // by `frameDtMs`, so the harness would be photographing a different
    // elapsed time from the one it prints.
    expect(framePumps(50, 16.67).length * 16.67).toBeLessThanOrEqual(50 + 16.67);
  });
});

describe('the subject and phase lists', () => {
  // The three motions the issue names, and the three vehicles that bracket the
  // roster: mbt_lavi is the slowest and the slowest-turning (1.1 tiles/s,
  // 60 deg/s), technical the fastest wheeled (2.6, 120), apc_eitan the middle
  // and the one 8-wheeler.
  it('carries a start, a stop and a turn', () => {
    expect([...WEIGHT_PHASES]).toEqual(['start', 'stop', 'turn']);
  });

  it('brackets the roster and gives every subject a distinct id on the open northern band', () => {
    const ids = WEIGHT_SUBJECTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('mbt_lavi');
    expect(ids).toContain('technical');
    // rows 0-7 of beit_sahwan_outskirts are open ground end to end -- the same
    // band wreck-captures.ts and blast-captures.ts parade on.
    for (const s of WEIGHT_SUBJECTS) {
      if (s.map === 'beit_sahwan_outskirts') expect(s.y).toBeLessThanOrEqual(7);
    }
  });

  // beit_sahwan_outskirts declares NO elevation grid, so the terrain-conform
  // half is arithmetically zero there and a sheet shot only on that map cannot
  // show it at all.
  it('shoots the terrain half somewhere with relief', () => {
    expect(WEIGHT_SUBJECTS.some((s) => s.map === 'tel_marum')).toBe(true);
  });
});

describe('sheetIndex', () => {
  // The index is the half of the evidence that survives R-G's git-ignored
  // storage: the PNGs live under .superpowers/ and the NUMBERS get quoted into
  // the task report and the PR body.
  it('names every capture condition, not just the file', () => {
    const md = sheetIndex('before', [
      {
        subject: 'mbt_lavi',
        phase: 'start',
        ms: 200,
        zoom: 2.5,
        tick: 40,
        file: 'a.png',
        offsetTiles: 0,
        pitchDeg: 0,
        rollDeg: 0,
      },
    ]);
    expect(md).toContain('before');
    expect(md).toContain('mbt_lavi');
    expect(md).toContain('start');
    expect(md).toContain('200');
    expect(md).toContain('2.5');
  });

  it('prints the numeric ladder beside the pictures (R-Q)', () => {
    const md = sheetIndex('before', [
      {
        subject: 'mbt_lavi',
        phase: 'start',
        ms: 200,
        zoom: 2.5,
        tick: 40,
        file: 'a.png',
        offsetTiles: 0.031,
        pitchDeg: -1.8,
        rollDeg: 0,
      },
    ]);
    expect(md).toContain('0.031');
    expect(md).toContain('-1.8');
  });
});
```

Run them: every one is red, because the module does not exist.

- [ ] **Step 2: Implement**

Copy `blast-captures.ts` and retarget. Say in the header which behaviours are inherited rather than re-derived, and which one is NOT (R-P's advancing sim), with the reason.

Per subject and phase:

- **`start`** — the vehicle stands still for ten ticks, then takes a `move` order to a tile 12 away. The ladder starts on the tick the order is issued.
- **`stop`** — the vehicle is already at cruise (ordered 20 ticks earlier) and the ladder starts on the tick its goal is 2 tiles away, so the halt lands inside the window.
- **`turn`** — the vehicle is at cruise and takes a second `move` order 90° off its heading. `mbt_lavi` at 60 °/s takes 1.5 s to come round, which is why the window is ten seconds and not two.

For each rung: `step(1)`, then pump `framePumps(50, FRAME_MS)` through `renderer.frame(alpha, FRAME_MS)`, then screenshot at zoom 2.5, plus one zoom-1.0 establishing still per subject/phase.

**The numeric readback (R-Q)**, written into `sheet.json` beside every cell — read back off the running game, never recomputed:

```ts
// A DOM/scene READ, not a recomputation, for the same reason `cursorKey()`
// reads `canvas.dataset.cursor` instead of re-deriving it: the failure worth
// catching is a model whose logic is right and whose WIRING is not, and a
// recomputation would agree with the logic and tell you nothing. So this asks
// the scene where the hull was actually drawn and the sim where it actually
// is, and reports the difference.
const reading = await page.evaluate((entityId: number) => {
  const L = (window as unknown as LionsWindow).__lions;
  const drawn = L.renderer.debugVehicleTransform(entityId); // added in Task 6
  return {
    offsetTiles: Math.hypot(drawn.x - L.sim.state.posX[entityId] / 65536, /* … */),
    pitchDeg: drawn.pitchDeg,
    rollDeg: drawn.rollDeg,
    simSpeed: drawn.simSpeed,
  };
}, subjectId);
```

`debugVehicleTransform` does not exist until Task 6 — **on the before-set this reads `undefined` and the harness records a stated "not wired yet", exactly as `blast-captures.ts` reports two zeroes with a reason on its own before-set.** It must not throw and it must not silently write zeroes: a zero and an absence read identically, which is the whole `measureFacing` lesson.

Add `"weight:capture": "pnpm --filter @lions/tools weight:capture"` to the root `package.json` and the `tsx` entry to `tools/package.json`, beside `blast:capture`.

- [ ] **Step 3: Gates, capture, falsify, commit**

Gates: `pnpm lint && pnpm typecheck && pnpm test`.

**Falsify the ladder:** change `sampleLadder` to start at `everyMs` instead of 0 — the first test goes red, and it matters because frame 0 is the only frame that shows the hull at rest immediately before it moves. **Falsify the pumps:** make `framePumps` return `[1]` — the alpha-walk test goes red, and that is the mutation that would have turned this harness back into `__lions.step`'s own single frame. **Falsify the instrument itself:** run it once with the `FREEZE_FRAME_LOOP_SCRIPT` line commented out and confirm two runs of the same subject produce visibly different ladders; restore. Record all three in the task report.

**Take the before-set:**

```bash
pnpm weight:capture -- --label=before
```

Confirm by eye that the strip matches today's shipped behaviour — an instant start with no squat, a dead stop with no settle, a flat hull through a turn, a flat hull on Tel Marum's slope, and dust at a constant rate whatever the speed — and quote `sheet.json`'s counts and conditions in the task report. This is the reading Task 7 is measured against.

```bash
/usr/bin/git add tools/src/perf/weight-captures.ts tools/src/perf/weight-captures.test.ts package.json tools/package.json
/usr/bin/git commit -s -- tools/src/perf/weight-captures.ts tools/src/perf/weight-captures.test.ts package.json tools/package.json
```

Message: `feat(tools): a three-phase vehicle-motion contact sheet, and the before-set it took`, body naming the three mutations seen red and the before-set's conditions (machine, GL backend, viewport, zoom, `stepJumpMs`).

**Model: opus.** The harness is the acceptance instrument, and its failure modes — a frozen sim where the sim must advance, a frame loop that is not frozen, a throttled rAF, a subject that never spawns — are the ones this project has paid for repeatedly.

---

### Task 2: The terrain conform, which has no memory

The spec's Architecture splits the model in two and this is the half that must have **no state at all**: four `groundWorldY` calls at the hull's own footprint corners, a pitch from the front/rear delta and a roll from the left/right delta, recomputed from scratch every frame exactly like the single sample it joins (`ThreeRenderer.ts:5321`). Keeping it separate from Task 3 is deliberate — conflating them is how a purely geometric answer acquires a filter it does not need and stops agreeing with the ground the player can see.

**The half-extents are measured, not authored.** `vehicleShroudBounds(root)` (`units/mesh-vehicle.ts:477`) already returns the live body's size in tile units excluding `death_root`, and the blast package already stores it per template in `vehicleMeshBounds` (`ThreeRenderer.ts:4088`). The template root carries only `MESH_SCALE` and no rotation, and the mesh contract's rest pose is +X forward, so `bounds.x` is length along the hull's forward axis and `bounds.z` is its width. There is no per-vehicle footprint table to author and nothing to go stale when a vehicle is re-exported.

**Zero on flat ground is the load-bearing property**, not an edge case: `beit_sahwan_outskirts` and `tutorial_ground` declare no `elevation` grid at all, so three of the four gated golden scenarios get four equal samples and must return exactly 0 (R-G).

**Files:**
- Create: `packages/render/src/three/units/vehicle-weight.ts`
- Create: `packages/render/src/three/units/vehicle-weight.test.ts`

**Interfaces:**
- Consumes: nothing. No `three` import, no `Sim` import, no `@lions/data` import.
- Produces (Task 6 consumes these exact names):
  - `export interface HullCorners { frontX, frontY, rearX, rearY, leftX, leftY, rightX, rightY: number }`
  - `export function hullCornerOffsets(facingNorm: number, halfLengthTiles: number, halfWidthTiles: number): HullCorners`
  - `export function terrainPitchRad(frontGroundY: number, rearGroundY: number, lengthWorld: number): number`
  - `export function terrainRollRad(leftGroundY: number, rightGroundY: number, widthWorld: number): number`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/render/src/three/units/vehicle-weight.test.ts
import { describe, expect, it } from 'vitest';
import { hullCornerOffsets, terrainPitchRad, terrainRollRad } from './vehicle-weight';

describe('the four footprint corners', () => {
  // Facing 0 turns is +X in game space (`fx.atan2` of the movement delta, and
  // `meshYawFromFacing`'s own -2*PI*facing maps it onto the mesh's +X-forward
  // rest pose). So at facing 0 "front" is +X and "left"/"right" are +/-Y.
  it('puts the front ahead and the flanks abeam at facing 0', () => {
    const c = hullCornerOffsets(0, 0.6, 0.25);
    expect(c.frontX).toBeCloseTo(0.6, 6);
    expect(c.frontY).toBeCloseTo(0, 6);
    expect(c.rearX).toBeCloseTo(-0.6, 6);
    expect(Math.abs(c.leftY)).toBeCloseTo(0.25, 6);
    expect(c.leftY).toBeCloseTo(-c.rightY, 6);
  });

  it('rotates the whole footprint with the hull', () => {
    const c = hullCornerOffsets(0.25, 0.6, 0.25); // a quarter turn
    expect(c.frontX).toBeCloseTo(0, 6);
    expect(Math.abs(c.frontY)).toBeCloseTo(0.6, 6);
  });

  // Symmetry at EVERY heading, not only the two convenient ones -- an offset
  // table that is right at the axes and skewed in between is the shape a
  // transposed sin/cos produces, and it looks plausible in a screenshot.
  it('keeps front/rear and left/right symmetric about the centre at every heading', () => {
    for (let t = 0; t < 1; t += 1 / 16) {
      const c = hullCornerOffsets(t, 0.6, 0.25);
      expect(c.frontX).toBeCloseTo(-c.rearX, 6);
      expect(c.frontY).toBeCloseTo(-c.rearY, 6);
      expect(c.leftX).toBeCloseTo(-c.rightX, 6);
      expect(c.leftY).toBeCloseTo(-c.rightY, 6);
      // The flank axis is perpendicular to the forward axis, always.
      expect(c.frontX * c.leftX + c.frontY * c.leftY).toBeCloseTo(0, 6);
    }
  });
});

describe('terrain pitch and roll', () => {
  // THE golden-gate pin (R-G). beit_sahwan_outskirts and tutorial_ground carry
  // no elevation grid at all, so all four samples are equal there and this must
  // be exactly 0 -- not 1e-17, not "close to". A parked vehicle on a flat map
  // draws where it always drew, and the `vehicle` baseline cannot move.
  it('is exactly zero when the four samples agree', () => {
    expect(terrainPitchRad(3, 3, 1.2)).toBe(0);
    expect(terrainRollRad(3, 3, 0.5)).toBe(0);
    expect(terrainPitchRad(0, 0, 1.2)).toBe(0);
  });

  // Positive pitch is NOSE-UP, matching MESH_HULL_PITCH_RAD's own sign (the
  // recoil rocks a tank back onto its rear road wheels). Ground rising ahead
  // therefore reads positive.
  it('points the nose up when the ground ahead is higher', () => {
    expect(terrainPitchRad(1, 0, 1.2)).toBeGreaterThan(0);
    expect(terrainPitchRad(0, 1, 1.2)).toBeLessThan(0);
  });

  // Positive roll drops the RIGHT side, so ground falling away to the right
  // reads positive. Stated here because the sign is otherwise a coin flip and
  // a coin flip looks fine on a screenshot of a symmetric hull.
  it('drops the downhill side', () => {
    expect(terrainRollRad(1, 0, 0.5)).toBeGreaterThan(0);
    expect(terrainRollRad(0, 1, 0.5)).toBeLessThan(0);
  });

  // The angle is atan(delta / span), so a LONGER vehicle tilts LESS on the
  // same step in the ground -- which is the physical answer and the reason the
  // span is a parameter rather than a constant.
  it('tilts a long hull less than a short one on the same step', () => {
    const short = terrainPitchRad(0.4, 0, 0.8);
    const long = terrainPitchRad(0.4, 0, 1.6);
    expect(long).toBeLessThan(short);
    expect(long).toBeCloseTo(Math.atan2(0.4, 1.6), 6);
  });

  // A one-level step is 10 px of elevation (E1) and the biggest thing the
  // shipped maps contain; nothing should ever return a right angle.
  it('stays inside a quarter turn for any input', () => {
    expect(Math.abs(terrainPitchRad(50, -50, 0.1))).toBeLessThan(Math.PI / 2);
  });
});
```

- [ ] **Step 2: Implement**

Four small functions, no state, no clamps beyond what `atan2` gives. Give the module a header that states the two properties a later reader will otherwise get wrong: **positive pitch is nose-up and positive roll drops the right side**, chosen to match `MESH_HULL_PITCH_RAD`'s own recoil sign; and **the span is a parameter because a longer hull tilts less**, which is why the half-extents come from `vehicleMeshBounds` rather than a constant.

- [ ] **Step 3: Gates, capture, falsify, commit**

Gates: `pnpm lint && pnpm typecheck && pnpm test`.

**Falsify by sign flip, twice** — negate `terrainPitchRad`'s numerator and confirm "points the nose up when the ground ahead is higher" goes red; negate `terrainRollRad`'s and confirm "drops the downhill side" goes red. **Falsify the zero** — return `1e-15` instead of `0` on equal samples and confirm `toBe(0)` goes red; this is the assertion standing between this package and a moved golden baseline, so watch it fail. **Falsify the symmetry** — transpose the sin and cos in `hullCornerOffsets` and confirm the every-heading test goes red while the facing-0 test stays green, which is exactly why that test sweeps sixteen headings instead of checking two.

```bash
/usr/bin/git add packages/render/src/three/units/vehicle-weight.ts packages/render/src/three/units/vehicle-weight.test.ts
/usr/bin/git commit -s -- packages/render/src/three/units/vehicle-weight.ts packages/render/src/three/units/vehicle-weight.test.ts
```

Message: `feat(render): a hull that stands on the ground it is crossing`, body naming the four mutations seen red and recording that the flat-map answer is exactly zero.

**Model: sonnet.** Four pure trigonometric functions with a shipped sibling (`vehicle-fx.ts`) to copy the module shape from.

---

### Task 3: The dynamic weight, and the bound it may not cross

This is the half that needs memory, and the reason is measured: `stepMovement` (`packages/sim/src/sim.ts:4918`) moves a moving unit by exactly `type.stepPerTick`, shifted only by rout and pin, and snaps onto the goal on arrival. **There is no acceleration anywhere in the sim.** `entitySpeed[i]` is `Math.hypot(dx, dy) * SIM_HZ` from the tick-to-tick delta (`ThreeRenderer.ts:2752`), recomputed once per 20 Hz tick and held for up to three frames at 60 fps — a step function. A literal derivative of it reads zero at cruise and spikes for one tick at a standing start. **So the presentation layer fakes the ramp** (R-M): a smoothed speed per entity, and the pitch comes off the derivative of the smoothed value.

Roll is the opposite case and costs much less (R-L): `turnToward` (`sim.ts:3459`) already clamps every facing change to `type.turnPerTick` from an authored `mobility.turn_rate_deg_s`, and every vehicle authors one (`mbt_lavi` 60 °/s through `moto_rpg` 220). So the yaw rate is real, rate-limited and has a known per-unit ceiling, and `roll = maxRoll · clamp(yawRate / turnRate, −1, 1)` is bounded by construction with no second constant.

**The shape is `stepTurretFacing`'s** (`three/units/frame-state.ts:436`), deliberately: persisted `Float64Array`s mutated in place, a `seeded` `Uint8Array` consulted first, `dtSeconds` from `frameDtSeconds`, a plain return value the caller writes onto the object. Per-entity and never shared, because a group order does not land vehicles on the same tick — `formation.ts` assigns slots and each unit walks to its own, so two vehicles in one order can stop a second apart.

**R-C's bound is the assertion this task exists to make true**, and R-K widens what it covers: the recoil shove (up to `MESH_HULL_RECOIL_TILES` = 0.16 tiles) and the weight lag write the same `entity.root.position` in the same frame, so the budget is on the COMBINED offset and the lag's own share is 0.09.

**Files:**
- Modify: `packages/render/src/three/units/vehicle-weight.ts` (the state half, beside Task 2's geometry)
- Modify: `packages/render/src/three/units/vehicle-weight.test.ts` (extend; **do not edit a Task 2 assertion** — if one goes red the geometry moved and that is the bug)

**Interfaces:**
- Produces (Tasks 4 and 6 consume these exact names):
  - `export const MAX_DRAWN_OFFSET_TILES = 0.25` (R-C)
  - `export const MAX_LAG_TILES = 0.09` (R-K: 0.25 − `MESH_HULL_RECOIL_TILES`)
  - `export interface VehicleWeightParams { maxPitchRad, maxRollRad, accelSeconds, settleSeconds, settleDamping, lagTiles: number }`
  - `export interface VehicleWeightArrays { smoothedSpeed, smoothedHeading, lagX, lagY, settle, settleVel: Float64Array; seeded: Uint8Array }`
  - `export interface VehicleWeightInput { entityId, speedTilesS, cruiseTilesS, headingTurns, turnRateTurnsS, trueX, trueY, dtSeconds: number; params: VehicleWeightParams }`
  - `export interface VehicleWeightOutput { drawX, drawY, pitchRad, rollRad: number }`
  - `export function stepVehicleWeight(arrays: VehicleWeightArrays, input: VehicleWeightInput): VehicleWeightOutput`
  - `export function makeVehicleWeightArrays(n: number): VehicleWeightArrays`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/render/src/three/units/vehicle-weight.test.ts -- append
import {
  MAX_DRAWN_OFFSET_TILES,
  MAX_LAG_TILES,
  makeVehicleWeightArrays,
  stepVehicleWeight,
} from './vehicle-weight';
import type { VehicleWeightInput, VehicleWeightParams } from './vehicle-weight';

const HEAVY: VehicleWeightParams = {
  maxPitchRad: (2 * Math.PI) / 360, // 2 degrees -- the issue's own figure (R-M)
  maxRollRad: (3 * Math.PI) / 360,
  accelSeconds: 0.35,
  settleSeconds: 0.5,
  settleDamping: 0.6,
  lagTiles: 0.06,
};

function at(over: Partial<VehicleWeightInput> = {}): VehicleWeightInput {
  return {
    entityId: 0,
    speedTilesS: 0,
    cruiseTilesS: 1.1, // mbt_lavi
    headingTurns: 0,
    turnRateTurnsS: 60 / 360, // mbt_lavi's authored turn_rate_deg_s
    trueX: 10,
    trueY: 10,
    dtSeconds: 1 / 60,
    params: HEAVY,
    ...over,
  };
}

describe('a vehicle the sim reports stationary draws exactly where it stands', () => {
  // R-G, and the single most load-bearing assertion in this package. The golden
  // `vehicle` scenario is beit_sahwan_outskirts at tick 140 with the sandbox
  // force PARKED and no orders. If this returns anything but the identity, that
  // baseline moves and the run goes red for a reason nobody will find quickly.
  it('is the identity transform at rest, and stays there', () => {
    const a = makeVehicleWeightArrays(4);
    let out = stepVehicleWeight(a, at());
    for (let i = 0; i < 600; i++) out = stepVehicleWeight(a, at());
    expect(out.drawX).toBe(10);
    expect(out.drawY).toBe(10);
    expect(out.pitchRad).toBe(0);
    expect(out.rollRad).toBe(0);
  });

  it('is the identity on an entity\'s very first frame, not after it has settled', () => {
    const a = makeVehicleWeightArrays(4);
    const out = stepVehicleWeight(a, at({ entityId: 3 }));
    expect(out.drawX).toBe(10);
    expect(out.pitchRad).toBe(0);
  });
});

describe('the seeded companion (R-N)', () => {
  // Every per-entity array in ThreeRenderer carries one -- turretSeeded,
  // animSeeded, vehicleTrackSeeded -- because a reinforcement spawning
  // mid-mission would otherwise start from the Float64Array zero-fill and read
  // as a vehicle that materialised at full speed.
  it('seeds an entity to its own current speed rather than to zero', () => {
    const a = makeVehicleWeightArrays(4);
    stepVehicleWeight(a, at({ entityId: 2, speedTilesS: 1.1 }));
    expect(a.seeded[2]).toBe(1);
    expect(a.smoothedSpeed[2]).toBeCloseTo(1.1, 6);
    // ... and therefore no launch pitch on the frame it appears.
    const out = stepVehicleWeight(a, at({ entityId: 2, speedTilesS: 1.1 }));
    expect(Math.abs(out.pitchRad)).toBeLessThan(1e-9);
  });

  it('leaves a neighbouring slot alone', () => {
    const a = makeVehicleWeightArrays(4);
    stepVehicleWeight(a, at({ entityId: 2, speedTilesS: 1.1 }));
    expect(a.seeded[1]).toBe(0);
    expect(a.smoothedSpeed[1]).toBe(0);
  });
});

describe('pitch under acceleration (R-M)', () => {
  // The sim jumps 0 -> cruise in one tick. If the model passed that through,
  // the pitch would be one spike on one frame and nothing after it -- which is
  // the defect, not the feature.
  it('does not spike on the frame the step arrives', () => {
    const a = makeVehicleWeightArrays(1);
    stepVehicleWeight(a, at({ speedTilesS: 0 }));
    const first = stepVehicleWeight(a, at({ speedTilesS: 1.1 }));
    expect(Math.abs(first.pitchRad)).toBeLessThan(HEAVY.maxPitchRad);
  });

  it('ramps to the authored maximum over the launch and returns to zero at cruise', () => {
    const a = makeVehicleWeightArrays(1);
    stepVehicleWeight(a, at({ speedTilesS: 0 }));
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      const out = stepVehicleWeight(a, at({ speedTilesS: 1.1 }));
      peak = Math.max(peak, Math.abs(out.pitchRad));
    }
    expect(peak).toBeGreaterThan(HEAVY.maxPitchRad * 0.5);
    expect(peak).toBeLessThanOrEqual(HEAVY.maxPitchRad + 1e-9);
    // Held at cruise for another second: the acceleration is over, so is the pitch.
    let last = 0;
    for (let i = 0; i < 60; i++) last = stepVehicleWeight(a, at({ speedTilesS: 1.1 })).pitchRad;
    expect(Math.abs(last)).toBeLessThan(HEAVY.maxPitchRad * 0.05);
  });

  // Braking is the opposite sign: the nose goes DOWN. Asserted because it is
  // the half a one-directional implementation silently drops.
  it('pitches the other way under braking', () => {
    const a = makeVehicleWeightArrays(1);
    for (let i = 0; i < 60; i++) stepVehicleWeight(a, at({ speedTilesS: 1.1 }));
    const launch = (() => {
      const b = makeVehicleWeightArrays(1);
      stepVehicleWeight(b, at({ speedTilesS: 0 }));
      return stepVehicleWeight(b, at({ speedTilesS: 1.1 })).pitchRad;
    })();
    const brake = stepVehicleWeight(a, at({ speedTilesS: 0 })).pitchRad;
    expect(Math.sign(brake)).toBe(-Math.sign(launch));
  });
});

describe('roll from the sim\'s own rate-limited yaw (R-L)', () => {
  it('is zero when the heading is not changing', () => {
    const a = makeVehicleWeightArrays(1);
    for (let i = 0; i < 30; i++) stepVehicleWeight(a, at({ speedTilesS: 1.1, headingTurns: 0.3 }));
    expect(stepVehicleWeight(a, at({ speedTilesS: 1.1, headingTurns: 0.3 })).rollRad).toBeCloseTo(0, 9);
  });

  // `turnToward` caps the facing change at turnPerTick, so the fastest a hull
  // can possibly yaw is its own authored rate -- which is exactly where full
  // lean belongs, and why no second constant is needed.
  it('reaches the authored maximum at the unit\'s own turn rate and no further', () => {
    const a = makeVehicleWeightArrays(1);
    const perFrame = (60 / 360) / 60; // turns per frame at 60 deg/s, 60 fps
    let h = 0;
    let peak = 0;
    for (let i = 0; i < 90; i++) {
      h += perFrame;
      peak = Math.max(peak, Math.abs(stepVehicleWeight(a, at({ speedTilesS: 1.1, headingTurns: h })).rollRad));
    }
    expect(peak).toBeGreaterThan(HEAVY.maxRollRad * 0.8);
    expect(peak).toBeLessThanOrEqual(HEAVY.maxRollRad + 1e-9);
  });

  it('leans into the turn, and the other way for the other turn', () => {
    const left = makeVehicleWeightArrays(1);
    const right = makeVehicleWeightArrays(1);
    const perFrame = (60 / 360) / 60;
    let l = 0;
    let r = 0;
    let lo = 0;
    let ro = 0;
    for (let i = 0; i < 30; i++) {
      l += perFrame;
      r -= perFrame;
      lo = stepVehicleWeight(left, at({ speedTilesS: 1.1, headingTurns: l })).rollRad;
      ro = stepVehicleWeight(right, at({ speedTilesS: 1.1, headingTurns: r })).rollRad;
    }
    expect(Math.sign(lo)).toBe(-Math.sign(ro));
  });

  // Facing is 0..1 turns and wraps. A yaw rate computed without wrapping reads
  // a 0.99 -> 0.01 step as a 0.98-turn slew and slams the roll to full lean on
  // a hull that barely moved.
  it('does not slam the lean when the heading wraps past 1', () => {
    const a = makeVehicleWeightArrays(1);
    const perFrame = (60 / 360) / 60;
    let h = 0.99;
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      h = (h + perFrame) % 1;
      peak = Math.max(peak, Math.abs(stepVehicleWeight(a, at({ speedTilesS: 1.1, headingTurns: h })).rollRad));
    }
    expect(peak).toBeLessThanOrEqual(HEAVY.maxRollRad + 1e-9);
  });
});

describe('the settle on stop', () => {
  it('overshoots once and returns to rest', () => {
    const a = makeVehicleWeightArrays(1);
    for (let i = 0; i < 60; i++) stepVehicleWeight(a, at({ speedTilesS: 1.1 }));
    const trail: number[] = [];
    for (let i = 0; i < 120; i++) trail.push(stepVehicleWeight(a, at({ speedTilesS: 0 })).pitchRad);
    const signs = new Set(trail.filter((p) => Math.abs(p) > 1e-6).map((p) => Math.sign(p)));
    expect(signs.size).toBe(2); // it crossed zero: that is the overshoot
    expect(Math.abs(trail[trail.length - 1])).toBeLessThan(1e-6);
  });
});

describe('the drawn hull never trails the sim by more than a quarter tile (R-C, R-K)', () => {
  const MESH_HULL_RECOIL_TILES = 0.16; // ThreeRenderer.ts:432 -- the other writer

  // A sweep, not a sample. A bound checked at one speed with one parameter set
  // is a bound that holds for that speed and that parameter set.
  it('holds across every shipped parameter set and the whole speed range', async () => {
    const { VEHICLE_WEIGHT_ROLE_DEFAULTS } = await import('./vehicle-weight-params');
    for (const params of Object.values(VEHICLE_WEIGHT_ROLE_DEFAULTS)) {
      for (const speed of [0, 0.25, 0.5, 1.1, 1.8, 2.6, 3.4]) {
        const a = makeVehicleWeightArrays(1);
        let worst = 0;
        let h = 0;
        for (let i = 0; i < 300; i++) {
          h = (h + 0.01) % 1;
          const out = stepVehicleWeight(
            a,
            at({ speedTilesS: speed, headingTurns: h, cruiseTilesS: speed || 1, params })
          );
          worst = Math.max(worst, Math.hypot(out.drawX - 10, out.drawY - 10));
        }
        expect(worst + MESH_HULL_RECOIL_TILES).toBeLessThanOrEqual(MAX_DRAWN_OFFSET_TILES + 1e-9);
      }
    }
  });

  it('leaves the budget the recoil already spends', () => {
    expect(MAX_LAG_TILES).toBeCloseTo(MAX_DRAWN_OFFSET_TILES - MESH_HULL_RECOIL_TILES, 9);
  });

  // R-C's second half, and the one a lag filter gets wrong by default: a
  // filter that is merely CONVERGING toward the true position is still offset
  // from it, so "the sim says stationary" has to be an explicit case.
  it('is exactly zero offset the moment the sim reports the unit stationary', () => {
    const a = makeVehicleWeightArrays(1);
    for (let i = 0; i < 60; i++) stepVehicleWeight(a, at({ speedTilesS: 2.6, trueX: 10 + i * 0.04 }));
    const out = stepVehicleWeight(a, at({ speedTilesS: 0, trueX: 12 }));
    expect(out.drawX).toBe(12);
    expect(out.drawY).toBe(10);
  });
});
```

- [ ] **Step 2: Implement**

One `stepVehicleWeight`, modelled line for line on `stepTurretFacing`'s structure. Order inside it:

1. `seeded[entityId] === 0` → seed `smoothedSpeed` to `speedTilesS`, `smoothedHeading` to `headingTurns`, everything else to 0, set the flag, and **return the identity** for this frame.
2. First-order filter of `smoothedSpeed` toward `speedTilesS` over `accelSeconds`; the same for `smoothedHeading`, **with the ±0.5-turn wrap `stepTurretFacing` already does** (`delta > 0.5 → −1`, `delta < −0.5 → +1`).
3. Pitch = `clamp(dSmoothedSpeed/dt / (cruiseTilesS / accelSeconds), −1, 1) · maxPitchRad`, plus the settle term.
4. Roll = `clamp(dSmoothedHeading/dt / turnRateTurnsS, −1, 1) · maxRollRad`.
5. Lag: the drawn position trails the true one along the heading by `lagTiles` scaled by `smoothedSpeed / cruiseTilesS`, clamped to `lagTiles`, and **forced to exactly zero when `speedTilesS === 0`**.

Give the module's second half a header saying the three things a reader will otherwise get wrong: **the sim has no acceleration and this is where the ramp is invented**; **the roll needs no constant because the sim already rate-limits yaw**; and **the heading wrap is not optional** — a yaw rate computed without it reads 0.99 → 0.01 as most of a full turn.

- [ ] **Step 3: Gates, capture, falsify, commit**

Gates: `pnpm lint && pnpm typecheck && pnpm test`.

**Falsify the rest state** — make the seed path return the filter's output instead of the identity and confirm "is the identity transform at rest" goes red. That mutation is the exact shape of a moved golden baseline, so watch it fail.
**Falsify the wrap** — delete the ±0.5 adjustment and confirm the wrap test goes red while every other roll test stays green.
**Falsify the bound** — set one role default's `lagTiles` to 0.12 and confirm the sweep goes red; restore.
**Falsify the smoothing** — set `accelSeconds` to 0 and confirm "does not spike on the frame the step arrives" goes red, which is the difference between this model and passing `entitySpeed` straight through.

```bash
/usr/bin/git add packages/render/src/three/units/vehicle-weight.ts packages/render/src/three/units/vehicle-weight.test.ts
/usr/bin/git commit -s -- packages/render/src/three/units/vehicle-weight.ts packages/render/src/three/units/vehicle-weight.test.ts
```

Message: `feat(render): a hull that squats, leans and settles, on the frame clock`, body naming the four mutations seen red, the measured reason the ramp has to be invented (`stepMovement` has none), and the combined 0.25-tile bound with the recoil's 0.16 inside it.

**Model: opus.** This is the package's only stateful code, its sign conventions are where a plausible-looking wrong answer lives, and the rest-state assertion is what stands between the branch and a moved visual baseline.

---

### Task 4: The authored numbers, and how they reach a renderer that may not read them

R-B puts the per-vehicle parameters in the unit JSON with role defaults in the renderer, and CLAUDE.md's rule behind it is "adding a unit means adding JSON, never engine code". R-I is the mechanism, and it exists because all three obvious routes are closed: `@lions/render` may import `@lions/sim` only (`eslint.config.mjs:138-147`); `RendererOptions` is built in `main.ts`, which the shell programme owns; and putting it on `UnitType` is a `packages/sim` edit R-H forbids. What IS open, and is already how two production files in this backend read authored data, is importing the raw JSON by relative path — `three/units/mesh-role.ts:44` and `three/terrain/tones.ts:27` both do it with `data/palette.json`, each with a comment saying why.

**Nothing is transcribed.** The numbers live in the JSON and are read from it. What is hand-kept is the import LIST, and that list is pinned to the shipped vehicle set by a test that reads `art/meshes/vehicles/` from disk. Read at test time rather than made an `import.meta.glob`, for the reason `packages/data`'s own `index.test.ts` gives: a glob derives the list from the directory and makes the check vacuous. That pin is not decoration — `catastrophic_kill.json` was forgotten one sub-project ago, three blast effects shipped inert behind a passing suite, and only a capture run found it.

**Expect zero to three units to actually declare a block.** The precedent is `mobility.wheeled`, whose own schema description says "Set it only where the default gets a unit wrong."

**Files:**
- Modify: `data/schemas/unit.schema.json` (`mobility.weight`; note `mobility` is `additionalProperties: false`, so it must be named)
- Create: `packages/render/src/three/units/vehicle-weight-params.ts`
- Create: `packages/render/src/three/units/vehicle-weight-params.test.ts`
- Modify: `data/units/kdf/mbt_lavi.json` and `data/units/enemy/moto_rpg.json` (the two ends of the roster, only if the role default is genuinely wrong for them — **and if it is not, author nothing and say so in the report**)

**Interfaces:**
- Consumes: `VehicleWeightParams`, `MAX_LAG_TILES` (Task 3); the vehicle unit JSONs by relative path (R-I).
- Produces (Task 6 consumes these exact names):
  - `export const VEHICLE_WEIGHT_ROLE_DEFAULTS: Readonly<Record<string, VehicleWeightParams>>`
  - `export const VEHICLE_WEIGHT_MASS_CLASS: Readonly<Record<'light' | 'medium' | 'heavy', VehicleWeightParams>>`
  - `export function vehicleWeightParamsFor(unitId: string, role: string): VehicleWeightParams`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/render/src/three/units/vehicle-weight-params.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_LAG_TILES } from './vehicle-weight';
import {
  VEHICLE_WEIGHT_MASS_CLASS,
  VEHICLE_WEIGHT_ROLE_DEFAULTS,
  vehicleWeightParamsFor,
} from './vehicle-weight-params';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');
const VEHICLE_MESHES = path.join(REPO, 'art/meshes/vehicles');
const UNIT_DIRS = ['data/units/kdf', 'data/units/enemy'];

function shippedVehicleIds(): string[] {
  return readdirSync(VEHICLE_MESHES)
    .filter((f) => f.endsWith('.glb'))
    .map((f) => f.replace(/\.glb$/, ''));
}

function unitJson(id: string): Record<string, unknown> | null {
  for (const dir of UNIT_DIRS) {
    const p = path.join(REPO, dir, `${id}.json`);
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    } catch {
      /* next dir */
    }
  }
  return null;
}

describe('the import list is pinned to the directory (R-I)', () => {
  // The `SPRITE_MAP` failure, and the `vfxEmitters` failure one sub-project
  // ago: a hand-kept list of content goes stale silently, the missing entry
  // answers `undefined`, and the effect ships inert behind a passing suite.
  // Read from DISK here, never an import glob -- a glob would derive the list
  // from the directory and make this check vacuous.
  it('resolves params for every unit with a shipped vehicle GLB', () => {
    for (const id of shippedVehicleIds()) {
      const json = unitJson(id);
      if (json === null) continue; // a GLB with no unit JSON is another gate's problem
      const role = (json.role ?? '') as string;
      expect(() => vehicleWeightParamsFor(id, role)).not.toThrow();
      const p = vehicleWeightParamsFor(id, role);
      expect(p.maxPitchRad).toBeGreaterThan(0);
      expect(p.accelSeconds).toBeGreaterThan(0);
    }
  });

  it('has a role default for every role a shipped vehicle declares', () => {
    for (const id of shippedVehicleIds()) {
      const json = unitJson(id);
      if (json === null) continue;
      const role = (json.role ?? '') as string;
      expect(Object.keys(VEHICLE_WEIGHT_ROLE_DEFAULTS)).toContain(role);
    }
  });

  // The whole point of R-I: an authored block must actually be READ. If a unit
  // declares `mobility.weight` and the resolver answers the role default, the
  // JSON is inert and looks authored.
  it('reads an authored block rather than the role default', () => {
    for (const id of shippedVehicleIds()) {
      const json = unitJson(id);
      const mobility = (json?.mobility ?? {}) as Record<string, unknown>;
      const weight = mobility.weight as Record<string, number> | undefined;
      if (!weight || weight.pitch_deg === undefined) continue;
      const role = (json?.role ?? '') as string;
      expect(vehicleWeightParamsFor(id, role).maxPitchRad).toBeCloseTo(
        (weight.pitch_deg * Math.PI) / 180,
        9
      );
    }
  });
});

describe('the resolution order', () => {
  it('falls back to the role default for a unit that declares nothing', () => {
    expect(vehicleWeightParamsFor('no_such_unit', 'mbt')).toEqual(VEHICLE_WEIGHT_ROLE_DEFAULTS.mbt);
  });

  it('answers something usable for a role nobody has thought of, rather than throwing', () => {
    // `rampForVehicleRole` throws for an unmapped role and is right to -- a
    // vehicle with no ramp draws nothing. This is cosmetic: an unmapped role
    // should draw a plausible hull, not stop the frame.
    expect(() => vehicleWeightParamsFor('x', 'submarine')).not.toThrow();
  });
});

describe('the schema ceilings are real', () => {
  // The bound in two places on purpose: a constraint enforced in one place
  // only is a constraint with one way around it. `validate:data` stops the
  // author; this stops the defaults table.
  it('keeps every default and every mass class inside the lag budget', () => {
    const all = [
      ...Object.values(VEHICLE_WEIGHT_ROLE_DEFAULTS),
      ...Object.values(VEHICLE_WEIGHT_MASS_CLASS),
    ];
    for (const p of all) expect(p.lagTiles).toBeLessThanOrEqual(MAX_LAG_TILES);
  });

  it('keeps every default under the recoil\'s own pitch, which is a bigger event', () => {
    const MESH_HULL_PITCH_RAD = 0.06; // ThreeRenderer.ts:440
    for (const p of Object.values(VEHICLE_WEIGHT_ROLE_DEFAULTS)) {
      expect(p.maxPitchRad).toBeLessThan(MESH_HULL_PITCH_RAD);
    }
  });

  // A heavier vehicle leans and squats MORE and recovers SLOWER. Asserted as an
  // ordering rather than as numbers, so retuning the table cannot silently
  // invert the one property the whole package is about.
  it('orders the mass classes the way mass orders them', () => {
    const { light, medium, heavy } = VEHICLE_WEIGHT_MASS_CLASS;
    expect(heavy.maxPitchRad).toBeGreaterThan(medium.maxPitchRad);
    expect(medium.maxPitchRad).toBeGreaterThan(light.maxPitchRad);
    expect(heavy.accelSeconds).toBeGreaterThan(light.accelSeconds);
    expect(heavy.settleSeconds).toBeGreaterThan(light.settleSeconds);
  });
});
```

- [ ] **Step 2: Implement**

The schema first, inside `mobility` (which is `additionalProperties: false`), exactly as the spec's Architecture writes it: `mass_class` as the cheap surface plus four optional numbers as the escape hatch, `lag_tiles` capped at **0.09** and `pitch_deg`/`roll_deg` at 6. Say in the `description` that it is **presentation only, read by the three.js renderer and by nothing in the sim** — a schema field with no reader is how a later session concludes the sim must be reading it.

Then `vehicle-weight-params.ts`: import the vehicle unit JSONs by relative path (with the `mesh-role.ts`/`tones.ts` comment explaining why not `@lions/data`), build the id → block map from them, and resolve `unitId` block → `mass_class` → role default → a safe fallback. The role table covers `mbt`, `ifv`, `apc`, `technical`, `recon`, `artillery`, `aa`, `gunship`, `drone`; note in the header that nothing on foot can reach it, because `updateVehicleMeshes` gates on `vehicleMeshTemplates.has(type.id)` and only the eleven types with a shipped GLB have one — which is why `manpad_team`, classed `wheeled` by the `FOOT_ROLES` default and genuinely four men with a launcher, never gets a hull tilt.

Author a `mobility.weight` block **only where the role default is genuinely wrong**. If the table covers the whole roster, author none and say so — an override that restates the default is a second source of truth for nothing.

- [ ] **Step 3: Gates, capture, falsify, commit**

Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data`.

**Falsify the gate, not just the test:** set a `lag_tiles` to `0.5` in a unit JSON and run `pnpm validate:data` — it must fail on the schema's maximum. Then set `mass_class` to `"enormous"` and confirm it fails the enum. Restore both. **Falsify the pin:** delete one vehicle's import from `vehicle-weight-params.ts` and confirm "resolves params for every unit with a shipped vehicle GLB" goes red — that is the assertion standing between this package and the `vfxEmitters` inertness. **Falsify the ordering:** swap `light` and `heavy` in the mass-class table and confirm the ordering test goes red.

```bash
/usr/bin/git add data/schemas/unit.schema.json packages/render/src/three/units/vehicle-weight-params.ts packages/render/src/three/units/vehicle-weight-params.test.ts
/usr/bin/git commit -s -- data/schemas/unit.schema.json packages/render/src/three/units/vehicle-weight-params.ts packages/render/src/three/units/vehicle-weight-params.test.ts
```

(Add any `data/units/**` file actually authored to both commands.)

Message: `feat(data): a vehicle declares how it carries its weight`, body recording the two `validate:data` failures constructed and seen, the pin deletion seen red, how many units ended up declaring a block, and why the JSON is read by relative import rather than through `@lions/data`.

**Model: sonnet.** A schema block, a lookup table and a resolver, with the shape of the check already written down in two shipped precedents.

---

### Task 5: Dust that knows how fast it is going

R-O, and it starts by NOT re-implementing what ships. `vehicleDustMagnitude` (`three/units/vehicle-fx.ts:89`) already ramps 0 → 1 linearly to `VEHICLE_DUST_FULL_SPEED_TILES_S` (1.0 tiles/s) and clamps, and that magnitude already sizes and populates each puff. What is fixed is the spawn INTERVAL: `updateVehicleAmbientFx` (`ThreeRenderer.ts:3672`) adds to a per-entity accumulator and spawns every `VEHICLE_DUST_INTERVAL_MS` regardless of speed, so a crawling `mbt_lavi` (1.1 tiles/s) and a sprinting `technical` (2.6) lay dust at exactly the same rate. That is the whole of "dust tied to speed" that is genuinely missing.

Two additions, both pure and both in this task; the wiring is Task 6's.

**A distance-based interval was considered and rejected.** `vehicle-tracks.ts` stamps by distance deliberately — a tyre mark is a mark on the ground and a fixed time would leave gaps at speed and clumps at a crawl. Dust is thrown by the engine, not laid by the wheel: a vehicle spinning its wheels at a standstill throws dust while covering no ground, and a distance rule would give it none.

**Files:**
- Modify: `packages/render/src/three/units/vehicle-fx.ts`
- Modify: `packages/render/src/three/units/vehicle-fx.test.ts` (extend; **do not edit an existing assertion** — if one goes red the existing ambient behaviour moved and that is the bug)

**Interfaces:**
- Produces (Task 6 consumes these exact names):
  - `export const VEHICLE_DUST_MIN_INTERVAL_MS: number`
  - `export const VEHICLE_DUST_LAUNCH_SURGE: number`
  - `export function vehicleDustIntervalMs(speedTilesS: number, accelFraction: number): number`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/render/src/three/units/vehicle-fx.test.ts -- append
import {
  VEHICLE_DUST_INTERVAL_MS,
  VEHICLE_DUST_MIN_INTERVAL_MS,
  VEHICLE_DUST_FULL_SPEED_TILES_S,
  vehicleDustIntervalMs,
} from './vehicle-fx';

describe('the dust cadence follows the speed (R-O)', () => {
  // The defect, stated as a test: before this, these two were equal.
  it('lays dust faster the faster the vehicle goes', () => {
    const crawl = vehicleDustIntervalMs(1.1, 0); // mbt_lavi at cruise
    const sprint = vehicleDustIntervalMs(2.6, 0); // technical at cruise
    expect(sprint).toBeLessThan(crawl);
  });

  it('is monotone across the whole roster range', () => {
    let previous = Infinity;
    for (const s of [0.2, 0.5, 1.0, 1.3, 1.8, 2.0, 2.6, 3.4]) {
      const ms = vehicleDustIntervalMs(s, 0);
      expect(ms).toBeLessThanOrEqual(previous);
      previous = ms;
    }
  });

  // Today's behaviour, kept exactly at today's reference speed, so the
  // existing ambient-FX suite and the `vehicle` golden frame both stay put.
  it('equals the shipped constant at the reference speed', () => {
    expect(vehicleDustIntervalMs(VEHICLE_DUST_FULL_SPEED_TILES_S, 0)).toBeCloseTo(
      VEHICLE_DUST_INTERVAL_MS,
      6
    );
  });

  // FRAME_DT_CEILING_MS is 100 and the accumulator gains at most that per
  // frame. An interval under it means one frame can cross it more than once,
  // and a `while` loop there is how the 2026-09-18 emission backlog spent
  // itself one puff per CALL. The floor is what keeps the spend single.
  it('never asks for an interval the frame clamp cannot deliver singly', () => {
    for (const s of [0.2, 1.0, 2.6, 3.4, 99]) {
      expect(vehicleDustIntervalMs(s, 1)).toBeGreaterThan(100);
    }
    expect(VEHICLE_DUST_MIN_INTERVAL_MS).toBeGreaterThan(100);
  });

  // The launch surge: the moment a vehicle breaks traction is the moment it
  // throws the most dust, and this is the first time the renderer has had an
  // acceleration signal to hang that on (Task 3's model).
  it('throws more dust under acceleration than at the same speed cruising', () => {
    expect(vehicleDustIntervalMs(1.1, 1)).toBeLessThan(vehicleDustIntervalMs(1.1, 0));
  });

  it('ignores an out-of-range acceleration fraction rather than inverting on it', () => {
    expect(vehicleDustIntervalMs(1.1, 5)).toBeGreaterThan(0);
    expect(vehicleDustIntervalMs(1.1, -5)).toBeGreaterThan(0);
    expect(vehicleDustIntervalMs(1.1, -5)).toBeLessThanOrEqual(vehicleDustIntervalMs(1.1, 0));
  });
});
```

- [ ] **Step 2: Implement**

`vehicleDustIntervalMs(speedTilesS, accelFraction)`: the shipped `VEHICLE_DUST_INTERVAL_MS` scaled by `VEHICLE_DUST_FULL_SPEED_TILES_S / max(speed, ε)`, shortened by up to `VEHICLE_DUST_LAUNCH_SURGE` on a clamped `accelFraction`, and floored at `VEHICLE_DUST_MIN_INTERVAL_MS` (comfortably above `FRAME_DT_CEILING_MS` = 100). Clamp `accelFraction` to [0, 1] at the top — an out-of-range input from a future caller must not invert the curve.

Extend the module header with the two things this adds and the one it deliberately does not: the magnitude ramp is untouched; the interval is now speed-driven; and dust is time-based rather than distance-based on purpose, unlike `vehicle-tracks.ts`, with the spun-wheels reason stated.

- [ ] **Step 3: Gates, capture, falsify, commit**

Gates: `pnpm lint && pnpm typecheck && pnpm test`.

**Falsify the monotonicity** — invert the speed term and confirm both the "faster" and the "monotone" tests go red. **Falsify the floor** — set `VEHICLE_DUST_MIN_INTERVAL_MS` to 50 and confirm the frame-clamp test goes red; that floor is the guard against reintroducing the emission backlog the 2026-09-18 fix removed. **Falsify the reference point** — change the scale so the reference speed no longer returns today's constant, and confirm both this test and the existing `ThreeRenderer.vehicle-ambient-fx.test.ts` suite react.

```bash
/usr/bin/git add packages/render/src/three/units/vehicle-fx.ts packages/render/src/three/units/vehicle-fx.test.ts
/usr/bin/git commit -s -- packages/render/src/three/units/vehicle-fx.ts packages/render/src/three/units/vehicle-fx.test.ts
```

Message: `feat(render): dust laid at the rate the vehicle is actually moving`, body naming the three mutations seen red and recording the measured defect (a fixed interval, so a 1.1 tiles/s tank and a 2.6 tiles/s technical dusted identically).

**Model: sonnet.** One pure curve in a file that already holds three of them, with the existing ambient-FX suite as the guard.

---

### Task 6: The one `ThreeRenderer.ts` region

**Read "Before Task 6" at the top of this plan first.** This task does not start until Lane A's Tasks 15–16 are on `main` and `origin/main` is merged into this branch (R-E).

Everything above is pure and untested against a renderer. This task wires it, and R-E confines it to one task and three adjacent places so Lane A's next landing merges into untouched code:

1. **New per-entity arrays** beside `rotorPhase` and the `vehicleMoving`/`vehicleDustAccumMs` block (`~:1190-1230`), allocated in the constructor beside `this.rotorPhase`, with their `seeded` companion (R-N).
2. **`updateVehicleMeshes`** (`:5248`): four `groundWorldY` calls in place of the single one at `:5321`; a `stepVehicleWeight` call composed after the hull-recoil block (`~:5348`) and before the turret block (`:5353`); and `entity.root.position`/`quaternion` written once from the composition.
3. **`updateVehicleAmbientFx`** (`:3643`): the interval becomes `vehicleDustIntervalMs(speed, accel)` and the anchor takes the drawn position. The accumulators keep feeding on `frameDtMs(dtMs)` — **that one call is the whole of the 2026-09-18 drift fix and must not be touched.**

**R-K is the part that is easy to get wrong.** Measured, with the shipped constants: `entity.root.rotation.x = hullPitch` with yaw on `rotation.y` is a WORLD-axis tilt — three.js composes `Rx · Ry · Rz`, so the hull is banked by the full amount at every heading, gets no pitch at all facing east (nose lift 0.00000 at facing 0) and pitches nose-DOWN facing north (−0.05996 at facing 0.25). `MESH_HULL_PITCH_RAD`'s own doc comment claims the opposite. Nobody noticed because it is 3.4° for 0.4 s on a one-shot; a continuous weight tilt through the same field would be nailed to the screen. So this task composes yaw, pitch and roll into `entity.root.quaternion` in the hull's own frame, **and the recoil's `hullPitch` becomes one more term in the pitch sum rather than a separate write.** That is a deliberate, disclosed behaviour change to the recoil; the `vehicle` golden scenario is parked with nothing firing, so recoil is zero there and the baseline cannot move on account of it. Correct the constant's doc comment in the same commit.

`debugVehicleTransform(entityId)` lands here too — the read-back Task 1's harness calls (R-Q). It returns what was actually written onto the object, never a recomputation, for the reason `cursorKey()` reads `canvas.dataset.cursor`.

Not touched: `addWreck`'s `hasWreck` guard, the death fork, `stepVehicleDeaths`, `updateMeshUnits` (infantry), `pickUnit`, `worldToScreen`, `threeCamera`, `api.ts`, `three/units/overlays.ts`, `three/units/overlay-geometry.ts`.

**Files:**
- Modify: `packages/render/src/three/ThreeRenderer.ts` (the three regions above, and `MESH_HULL_PITCH_RAD`'s doc comment)
- Create: `packages/render/src/three/ThreeRenderer.vehicle-weight.test.ts`

**Interfaces:**
- Consumes: `hullCornerOffsets`, `terrainPitchRad`, `terrainRollRad`, `stepVehicleWeight`, `makeVehicleWeightArrays`, `MAX_DRAWN_OFFSET_TILES` (Tasks 2–3); `vehicleWeightParamsFor` (Task 4); `vehicleDustIntervalMs` (Task 5); the existing `groundWorldY`, `vehicleMeshBounds`, `frameDtSeconds`, `frameDtMs`, `meshYawFromFacing`, `entitySpeed`.
- Produces: `debugVehicleTransform(entityId: number): { x, y, pitchDeg, rollDeg, simSpeed } | null`. **No new `api.ts` member** — the harness reaches it through `window.__lions.renderer`, which is the concrete backend.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/render/src/three/ThreeRenderer.vehicle-weight.test.ts
// Headless: `environment: 'node'`, with the same FakeWebGLRenderer stand-in
// ThreeRenderer.collapse.test.ts:38-55 uses -- copy that mock verbatim, and
// its TONES/makeOpts helpers, rather than inventing a second harness.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MAX_DRAWN_OFFSET_TILES } from './units/vehicle-weight';

describe('a parked vehicle on flat ground draws exactly where it stands (R-G)', () => {
  // The golden `vehicle` scenario in a unit test: beit_sahwan_outskirts declares
  // no elevation grid, the sandbox force is parked, and the baseline must not
  // move. Asserted here because it is cheap here and expensive in Playwright.
  it('holds the identity transform over a hundred frames', () => {
    const { renderer, sim, tankId } = flatWorldWithParkedTank(); // helper below
    for (let f = 0; f < 100; f++) renderer.frame(1, 16.67);
    const e = vehicleEntity(renderer, tankId);
    expect(e.root.position.x).toBeCloseTo(sim.state.posX[tankId] / 65536, 9);
    expect(e.root.position.z).toBeCloseTo(sim.state.posY[tankId] / 65536, 9);
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      e.root.rotation.y || 0
    );
    // Yaw alone: no pitch, no roll, nothing accumulating.
    expect(e.root.quaternion.angleTo(q)).toBeCloseTo(0, 6);
  });
});

describe('the tilt is in the HULL\'s frame at every heading (R-K)', () => {
  // The measurement this ruling came from, turned into an assertion. With the
  // shipped `rotation.x = pitch` + `rotation.y = yaw` composition, the nose
  // lift reads 0.00000 facing east, -0.05996 facing north and +0.05996 facing
  // west -- a world-axis tilt, while MESH_HULL_PITCH_RAD's comment claims a
  // local one. A continuous weight tilt through that field is nailed to the
  // screen instead of to the hull.
  it('lifts the nose by the same amount whichever way the hull faces', () => {
    const lifts: number[] = [];
    for (const facing of [0, 0.25, 0.5, 0.75]) {
      const { renderer, tankId } = flatWorldWithParkedTank({ facing, pitchRad: 0.06 });
      renderer.frame(1, 16.67);
      const e = vehicleEntity(renderer, tankId);
      const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(e.root.quaternion);
      const yaw = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        -2 * Math.PI * facing
      );
      const hullFwd = new THREE.Vector3(1, 0, 0).applyQuaternion(yaw);
      // The nose lift, measured against the hull's own forward direction.
      lifts.push(fwd.y);
      // And the hull still points where the sim says it points.
      expect(new THREE.Vector3(fwd.x, 0, fwd.z).normalize().dot(hullFwd)).toBeGreaterThan(0.99);
    }
    for (const lift of lifts) expect(lift).toBeCloseTo(lifts[0], 6);
    expect(Math.abs(lifts[0])).toBeGreaterThan(0.01); // it really is pitching
  });
});

describe('the hull freezes at death (R-F)', () => {
  it('does not advance a dead vehicle\'s weight state', () => {
    const { renderer, sim, tankId } = flatWorldWithParkedTank();
    for (let f = 0; f < 10; f++) renderer.frame(1, 16.67);
    const before = renderer.debugVehicleTransform(tankId);
    sim.debugKill(tankId);
    for (let f = 0; f < 30; f++) renderer.frame(1, 16.67);
    // Off the live loop entirely -- `updateVehicleMeshes` deletes the entity
    // from `vehicleMeshEntities` in the same frame `alive` goes to 0.
    expect(renderer.debugVehicleTransform(tankId)).toBeNull();
    expect(before).not.toBeNull();
  });
});

describe('picking still reads the sim, not the drawing (R-C)', () => {
  it('hits the same entity while the hull is lagged behind its true position', () => {
    const { renderer, sim, tankId } = flatWorldWithMovingTank();
    for (let f = 0; f < 40; f++) renderer.frame(0.5, 16.67);
    const trueX = sim.state.posX[tankId] / 65536;
    const trueY = sim.state.posY[tankId] / 65536;
    expect(renderer.pickUnit(trueX, trueY)).toBe(tankId);
    const drawn = renderer.debugVehicleTransform(tankId);
    expect(drawn).not.toBeNull();
    expect(Math.hypot(drawn!.x - trueX, drawn!.y - trueY)).toBeLessThanOrEqual(
      MAX_DRAWN_OFFSET_TILES
    );
  });
});

describe('the ground is sampled at four corners, not one', () => {
  it('tilts a hull standing across a slope', () => {
    const { renderer, tankId } = slopedWorldWithParkedTank(); // a 2-level step under the hull
    renderer.frame(1, 16.67);
    const t = renderer.debugVehicleTransform(tankId);
    expect(t).not.toBeNull();
    expect(Math.abs(t!.pitchDeg) + Math.abs(t!.rollDeg)).toBeGreaterThan(1);
  });

  it('leaves it flat on a map with no elevation grid', () => {
    const { renderer, tankId } = flatWorldWithParkedTank();
    renderer.frame(1, 16.67);
    const t = renderer.debugVehicleTransform(tankId);
    expect(t!.pitchDeg).toBe(0);
    expect(t!.rollDeg).toBe(0);
  });
});
```

- [ ] **Step 2: Implement**

In order, and nothing reordered in the file:

1. Declare the arrays beside `rotorPhase` with a doc comment in this class's own style, saying what they hold, that they are frame-clock driven, and that they are meaningless for a type with no vehicle mesh template. Allocate beside `this.rotorPhase`.
2. In `updateVehicleMeshes`, replace the single `groundWorldY` call with the centre sample (still needed for the hull's own height) plus four corner samples from `hullCornerOffsets(facingNorm, bounds.x / 2, bounds.z / 2)`, `bounds` from `vehicleMeshBounds.get(type.id)`. **Guard the missing-bounds case by skipping the terrain half, not by substituting a default** — a wrong footprint tilts the wrong way and a skipped one draws what shipped yesterday.
3. Call `stepVehicleWeight` with `entitySpeed[i]`, `facingNorm`, `curX`/`curY`, `frameDtSeconds(dtMs)` and `vehicleWeightParamsFor(type.id, type.role)`; skip the whole block for `type.isAir` (a helicopter conforming to the ground under it would be a bug with a straight face).
4. Compose: `position` from `stepVehicleWeight`'s `drawX`/`drawY` plus the recoil shove, clamped once against `MAX_DRAWN_OFFSET_TILES`; `quaternion` from yaw, then hull-frame pitch (terrain + dynamic + recoil), then hull-frame roll. Delete the `rotation.x`/`rotation.y` writes and correct `MESH_HULL_PITCH_RAD`'s doc comment to say what the composition now does and what it used to do.
5. `updateVehicleAmbientFx`: `vehicleDustIntervalMs(speed, accelFraction)` in place of the constant, the anchor from the drawn position. **Leave `frameDtMs(dtMs)` exactly where it is.**
6. `debugVehicleTransform`: read `entity.root.position` and decompose `entity.root.quaternion`, return `null` for an entity with no live vehicle entity. A read, never a recomputation.

- [ ] **Step 3: Gates, capture, falsify, commit**

Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm test:determinism`.

`pnpm test:determinism` is here because "the sim cannot have moved" is a claim; run `/usr/bin/git diff --stat main...HEAD -- packages/sim` and paste the empty output into the report beside it.

**Falsify the composition** — put the pitch back on `rotation.x` and confirm the hull-frame test goes red at facing 0 and 0.25 while every other test in the file stays green. That is the assertion R-K exists for, and seeing it fail is what proves the measurement was real rather than a reading of the docs.
**Falsify the four samples** — feed all four corners the centre sample and confirm "tilts a hull standing across a slope" goes red.
**Falsify the air guard** — remove it and confirm `heli_peten` picks up a terrain tilt (add the assertion if it is not already there).
**Falsify the rest state** — skip the `speedTilesS === 0` short-circuit and confirm the parked-vehicle test goes red.

**Then the visual gate**, for information: `pnpm golden-baseline`. Expect `quiet`, `open-ground` and `vehicle` **green** — those three stand on maps with no `elevation` grid and their forces are parked, so both halves of the model are arithmetically zero and a red one is a DEFECT to find, not drift to bless. `relief` (`tel_marum`) is the one gated scenario on real relief; whether it moves is a measurement, not a prediction — if it does, confirm by eye that the change is a vehicle standing on the slope it is parked on, record the numbers, and leave the bless to Task 7. `combat` will move and is report-only.

```bash
/usr/bin/git add packages/render/src/three/ThreeRenderer.ts packages/render/src/three/ThreeRenderer.vehicle-weight.test.ts
/usr/bin/git commit -s -- packages/render/src/three/ThreeRenderer.ts packages/render/src/three/ThreeRenderer.vehicle-weight.test.ts
```

Message: `feat(render): the hull leans, lags and settles on screen`, body carrying the four mutations seen red, the empty `packages/sim` diff, the determinism hash unmoved, the four gated scenarios' readings, and the disclosed recoil-axis change with the facing-by-facing numbers behind it.

**Model: opus.** A 7,500-line file, three regions, a rotation composition whose shipped version is measurably not what its own comment says, and a golden gate that must not move — the one task here where a wrong guess costs a whole re-run.

---

### Task 7: The after-captures, the numeric verdict, and the stale lines

R-G's after-set is the acceptance evidence and the lead judges on motion. R-Q is why the numeric ladder goes with it: the golden gate is near-blind to this package by construction, there is no layer to toggle because the hull draws either way, and a sheet of pretty frames cannot tell a working model from one wired to nothing. **A zero across every rung is a FAILURE here**, for the same reason `debug-layers.ts` gives about zero deltas — a model wired to nothing reads exactly like a model at rest.

This task also pays the issue's own last bullet: **"tighten CLAUDE.md's stale 'vehicle noise' line inside this bless."** That line is in the visual-gate paragraph and it is stale twice over — it attributes `vehicle`'s 5–157 px noise to renderer noise, the same paragraph already records that the cause was the ambient-FX emission backlog fixed on 2026-09-18, and it still carries thresholds (300 px / 0.02) nobody has re-derived against the zero floor that fix produced. Re-measure it here, with the sample size beside it, because **a range with no sample size is an anecdote** is this repository's own rule.

**Files:**
- Modify: `tools/src/perf/weight-captures.ts` (the numeric ladder stops reporting "not wired yet" and starts asserting its floors)
- Modify: `tools/src/perf/weight-captures.test.ts` (extend)
- Modify: `CLAUDE.md` — the "The three.js backend" visual-gate paragraph and the "Mesh units" section only (edit per section, never wholesale)

**Interfaces:**
- Consumes: everything Tasks 1–6 produced, `debugVehicleTransform` included.
- Produces: `.superpowers/art-captures/weight/after/` with `sheet.md` + `sheet.json`; `export const MOTION_FLOORS` and `export function motionVerdict(...)`, with each floor's measured reading and sample size in its `rationale`.

- [ ] **Step 1: Write the failing tests**

```ts
// tools/src/perf/weight-captures.test.ts -- append
import { MOTION_FLOORS, motionVerdict } from './weight-captures';

describe('the numeric ladder votes now (R-Q)', () => {
  // A model wired to nothing and a model at rest produce the same pictures.
  // The only thing that tells them apart is whether the numbers ever move.
  it('fails a ladder that never moves, rather than passing it', () => {
    const flat = Array.from({ length: 51 }, (_, i) => ({
      ms: i * 200,
      offsetTiles: 0,
      pitchDeg: 0,
      rollDeg: 0,
    }));
    expect(motionVerdict('start', flat).ok).toBe(false);
    expect(motionVerdict('turn', flat).ok).toBe(false);
  });

  it('passes a ladder that clears the measured floor', () => {
    const f = MOTION_FLOORS.start;
    const moving = Array.from({ length: 51 }, (_, i) => ({
      ms: i * 200,
      offsetTiles: 0,
      pitchDeg: i < 5 ? f.minPeakPitchDeg * 2 : 0,
      rollDeg: 0,
    }));
    expect(motionVerdict('start', moving).ok).toBe(true);
  });

  // A phase must show the motion it is NAMED for. A turn ladder that pitches
  // and never rolls is a roll that is not wired, reported as a pass.
  it('requires each phase\'s own axis, not merely some movement', () => {
    const f = MOTION_FLOORS.turn;
    const pitchOnly = Array.from({ length: 51 }, (_, i) => ({
      ms: i * 200,
      offsetTiles: 0,
      pitchDeg: f.minPeakRollDeg * 5,
      rollDeg: 0,
    }));
    expect(motionVerdict('turn', pitchOnly).ok).toBe(false);
  });

  // R-C on the running game, which is the point: the pure sweep proves the
  // model, this proves the WIRING -- the composition, the clamp and the recoil
  // all in the same frame.
  it('fails a ladder that breaks the quarter-tile bound', () => {
    const over = [{ ms: 0, offsetTiles: 0.4, pitchDeg: 2, rollDeg: 0 }];
    expect(motionVerdict('start', over).ok).toBe(false);
    expect(motionVerdict('start', over).reasons.join(' ')).toMatch(/0\.25/);
  });

  it('records a sample size beside every floor, because a range with no n is an anecdote', () => {
    for (const f of Object.values(MOTION_FLOORS)) expect(f.rationale).toMatch(/\b\d+ runs?\b/);
  });
});
```

- [ ] **Step 2: Measure the floors, then implement**

Run the harness three times against the head and record each phase's peak pitch, peak roll and peak offset. Set each floor at roughly a third of the smallest reading — the standard `baseline.ts`'s own `layerChecks` are held to — and write the measured triple, the sample size, the machine, the GL backend, the viewport and the zoom into each `rationale`. **Do not fit a floor to a single run**, and do not widen one to clear a red: a bimodal reading is a bug to find, not a band to widen.

Then take the after-set:

```bash
pnpm weight:capture -- --label=after
```

Put the before and after strips side by side and read them against G0 #14's own line — ten seconds of motion at 2.5×, a start, a stop and a turn, plus the Tel Marum slope run. Quote `sheet.json`'s conditions and the numeric ladder in the task report, and attach both directories' contents to the PR description (R-G).

**CLAUDE.md, two sections, edited per section:**

- *The three.js backend*, visual-gate paragraph: replace the stale `vehicle` noise line with the re-measured figure and its sample size, and say what this package changed about that frame (in the expected case: nothing — three of the four gated scenarios stand on maps with no `elevation` grid and their forces are parked, so both halves of the weight model are arithmetically zero there). If `relief` moved, record the number and the bless.
- *Mesh units*: replace the "vehicle motion" claim with what ships — the four-sample terrain conform, the acceleration pitch, the turn roll, the settle, and dust whose cadence follows speed — and record the two things a later reader will otherwise get wrong: **`rotation.x` under yaw is a world-axis tilt and this backend composes hull-frame tilt through the quaternion instead** (with the facing-by-facing measurement), and **no shipped vehicle GLB has a `wheel_*` or `track_*` node, every one merges its wheels and tracks into a single `hull_rubber` mesh, four carry no UVs on it at all, and the seven that do share the hull's material** — so wheel spin and track scroll need geometry work, not a pivot name (R-J). Name the open GH-177 half explicitly, so nobody reads this package as having delivered it.

- [ ] **Step 3: Gates, capture, falsify, commit, and the bless**

Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data`.

**Falsify the verdict, which is this task's whole point:** make `stepVehicleWeight` return the identity unconditionally and re-run the harness — every phase must go red on its own axis. Then restore it and make only the roll term zero — `turn` must go red while `start` stays green. Restore both and record the four numbers.

**The visual gate.** Run `pnpm golden-baseline` locally for information and read it against Task 6's reading. `quiet`, `open-ground` and `vehicle` must be green; a red one is a defect in Task 6, not drift. If `relief` moved and the frame is right by eye, that is the one bless this package budgets: dispatch the `visual-baseline-bless` workflow with an explicit `--reason`, take the numbers from the CI run and **never from the local darwin baseline** (stale since 2026-09-03), download the `visual-baseline-bless-captures` artifact and actually look at the picture, and serialise against Lane A's own landing — a bless dispatched while `main` is moving retries its push three times, and its bot commit triggers no `ci.yml` run.

```bash
/usr/bin/git add tools/src/perf/weight-captures.ts tools/src/perf/weight-captures.test.ts CLAUDE.md
/usr/bin/git commit -s -- tools/src/perf/weight-captures.ts tools/src/perf/weight-captures.test.ts CLAUDE.md
```

Message: `feat(tools): the weight after-set, and the numeric floors that vote on it`, body carrying the four falsification numbers, the before/after conditions, the re-measured `vehicle` noise figure with its sample size, and the CLAUDE.md sections corrected.

**Model: opus.** Floor calibration is judgement against measurement, the CLAUDE.md edits are the ones a later session will trust without checking, and the bless decision has to be read rather than executed.

---

## What this plan does not do

Named here so an implementer does not reach for them: **wheel spin and track-UV scroll** (R-J — the other half of GH-177's own bullet, blocked on geometry no shipped GLB has; spec open question 1); **turret lag** (R-A — it ships and works; a different feel is a constant change and a G1 sentence, spec open question 2); **suspension bounce** (named nowhere in the issue, the art page or the execution plan — do not invent it); **a standalone recoil-feel pass** (R-K fixes the recoil's axis as a consequence of composing in the hull's frame, and nothing more); **any `packages/sim` change** (R-H — no acceleration model, no `UnitType` field; spec open question 3); **any `packages/app` change** (the shell programme's, which is why `RendererOptions` is not the wiring route); **a gated `weight` visual scenario** (a scripted vehicle in motion at a pinned tick — the thing that would let the golden gate see this package at all, same shape as the `blast` scenario the last sub-project also left open); **Pixi** (no parity owed; `renderer.ts` stays byte-identical).
