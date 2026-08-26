# three.js Renderer — Phase B1: skeleton, camera, and a conformance suite

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a second `Renderer` implementation behind `?renderer=three` whose camera and projection agree with `PixiRenderer` exactly, proven by a conformance suite that runs against both.

**Architecture:** `ThreeRenderer` implements the same `Renderer` interface `PixiRenderer` does. B1 draws nothing but the ground plane — it exists to pin the camera, the projection, and the colour pipeline, and to give later sub-plans a suite that fails loudly when a second implementation drifts from the first.

**Tech Stack:** TypeScript (strict), three.js 0.170, Vitest (`environment: 'node'`).

**Spec:** `docs/superpowers/specs/2026-08-26-three-renderer-design.md`
**Phase 0 verdict (GO, and the source of Task B1.4):** `docs/superpowers/specs/2026-08-26-phase-0-verdict.md`

## Global Constraints

- **Branch:** `feat/three-renderer`, in the worktree at `.claude/worktrees/three-renderer`. Never touch the primary tree at `~/dev/roaring-lions` — other sessions work there with uncommitted files.
- **Never run** `git reset --hard`, `git checkout <branch>`, `git stash`, `git add -A`, or `git commit -a`. Stage explicit paths.
- `@lions/sim` must not change. No file under `packages/sim/`. `data/` must not change.
- TypeScript strict mode. No `any`. No non-null assertions.
- Green on `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:ui` at every task boundary.
- `pnpm validate:ui` has **no allowlist** and reads `#` + three hex digits as a colour literal. Never write a bare issue reference like `#123` under `packages/app/src` or in `packages/render/src/overlay.ts`. Write `issue 123`.
- **Pixi stays the default renderer throughout B1.** `?renderer=three` is opt-in. Nothing a default-path player sees may change.
- Baseline entering B1: **876 tests / 51 files**, all green.

---

## Two rulings this plan is built on

**Fog moves from Phase C into Phase B.** The spec assigns fog to C, but `isVisible` decides what is *drawn*, and Phase D's gate is a golden-image diff between the two renderers. A diff taken while one renderer hides fogged units and the other does not differs everywhere fog applies — useless exactly where it is meant to be the gate. Fog lands in a later B sub-plan (B4), not in C.
*Cost if wrong:* Phase B is one sub-plan larger and Phase C one smaller. No rework.

**Runtime conformance runs headless in `environment: 'node'`, with no WebGL.** The Phase A final review said the `tsc`-only interface check "stops being acceptable in Phase B, where the suite must run against constructed renderers rather than a stub" — which implied headless-gl or a browser in CI. It does not. Verified directly: three.js's `OrthographicCamera.project()`, `Object3D` world matrices, view-space depth ordering and `Raycaster` all work in plain node with no GL context and no DOM. Only *rasterization* needs a browser.
So: projection, depth ordering, picking and scene contents are unit-tested in CI as they are today; the golden-image diff stays a browser-driven check outside `pnpm test`, the same status `playtest.ts` has.
*Cost if wrong:* if something later genuinely needs rasterization in CI, that is a new decision with `@vitest/browser` as the obvious answer — none of this work is wasted.

---

## Where B1 sits

Phase B is too large for one plan. It decomposes into four, each producing something testable:

| | | deliverable |
|---|---|---|
| **B1** | skeleton, camera, projection, colour pipeline | `?renderer=three` loads, projects identically to Pixi, emits only palette colours |
| B2 | terrain + elevation as a height mesh | the map is visible and matches Pixi's terrain |
| B3 | units + buildings as billboards, depth from feet | units visible, correct occlusion against ridges — the four elevation debts close |
| B4 | fog and visibility | `isVisible` honoured, so the golden-image diff becomes meaningful |

**This plan is B1 only.** B2–B4 get their own plans, written once B1's conformance suite exists to hold them to.

---

## File Structure

| file | responsibility |
|---|---|
| `packages/render/src/three/ThreeRenderer.ts` | **new.** The second `Renderer` implementation. B1: canvas, size, camera, projection, colour pipeline. Everything else throws a named "not implemented in B1" error. |
| `packages/render/src/three/camera.ts` | **new.** Pure. Builds the dimetric orthographic camera and converts between world and screen. No renderer, no DOM. |
| `packages/render/src/three/camera.test.ts` | **new.** Pins the camera against the Pixi formula. |
| `packages/render/src/three/palette-material.ts` | **new.** The toon + palette-LUT material, and the renderer colour-pipeline settings Phase 0 proved are required. |
| `packages/render/src/three/palette-material.test.ts` | **new.** Pins the LUT quantization and that no conversion is applied. |
| `packages/render/src/conformance.ts` | **new.** The shared suite: given a factory for a `Renderer`, assert the contract. Exported so both implementations run it. |
| `packages/render/src/conformance.test.ts` | **new.** Runs the suite against `PixiRenderer`'s projection and `ThreeRenderer`'s. |
| `packages/render/src/index.ts` | **modify.** Export `ThreeRenderer`. |
| `packages/app/src/main.ts` | **modify.** Pick the implementation from `?renderer=`. |
| `packages/app/src/sandbox-help.ts` | **modify.** Add `renderer` to `KNOWN_PARAMS`, or `unknownParams` warns about the very flag we just added. |

`three/` is a subdirectory because B2–B4 add several more files to it and a flat `packages/render/src` already holds fourteen.

---

## Task B1.1: `ThreeRenderer` skeleton behind an opt-in flag

**Files:**
- Create: `packages/render/src/three/ThreeRenderer.ts`
- Modify: `packages/render/src/api.ts` (move `RendererOptions` and its types in)
- Modify: `packages/render/src/renderer.ts` (re-export them for compatibility)
- Modify: `packages/render/src/index.ts`, `packages/app/src/main.ts`, `packages/app/src/sandbox-help.ts`
- Modify: `packages/render/package.json` (add `three`)

**Interfaces:**
- Consumes: `Renderer`, `Camera` from `packages/render/src/api.ts` and `./project`.
- Produces: `class ThreeRenderer implements Renderer`, constructed as `new ThreeRenderer(sim, opts)` — the same two arguments `PixiRenderer` takes, so `main.ts` can choose between them with one ternary.

- [ ] **Step 1: Add three.js to the render package**

```bash
cd /Users/ilpinto/dev/roaring-lions/.claude/worktrees/three-renderer
pnpm --filter @lions/render add three@^0.170.0
pnpm --filter @lions/render add -D @types/three@^0.170.0
```

- [ ] **Step 2: Move `RendererOptions` to where the contract lives**

`RendererOptions` is currently declared in `renderer.ts` — the Pixi file — along
with `TerrainTones` and `TerrainScatter`. Both `Renderer` implementations are
constructed with it, and it references **no Pixi type**: every field is a string,
a tuple of strings, or `TerrainTones`. Verified before moving it.

Leaving it there would make `ThreeRenderer` import its constructor's type from the
Pixi backend, which is the coupling this whole phase exists to remove.

Move `RendererOptions`, `TerrainTones` and `TerrainScatter` into `api.ts`, and
re-export all three from `renderer.ts` so every existing importer is unaffected —
the same pattern Task A1 used when the projection moved to `project.ts`:

```ts
// in renderer.ts, beside the existing ./project re-export
export type { RendererOptions, TerrainTones, TerrainScatter } from './api';
```

`index.ts` already re-exports them from `./renderer`; leave that line alone so no
consumer changes. Confirm with `pnpm typecheck` before continuing.

- [ ] **Step 3: Write the skeleton**

Create `packages/render/src/three/ThreeRenderer.ts`. Every member of `Renderer` must be present or `implements Renderer` fails — B1 implements the surface and the camera, and every drawing member throws a *named* error rather than silently doing nothing.

```ts
/**
 * The three.js backend. Phase B1: it exists, it sizes itself, and its camera
 * agrees with PixiRenderer's projection. It draws nothing yet.
 *
 * Unimplemented members throw rather than no-op on purpose. A no-op renderer
 * looks like a working renderer drawing an empty world, and the failure would
 * surface as "the map is blank" three sub-plans later instead of as a stack
 * trace naming the method.
 */
import * as THREE from 'three';
import type { Sim, SimEvent } from '@lions/sim';
import type { Renderer, RendererOptions } from '../api'; // both, after Step 2
import type { Camera } from '../project';

function notYet(member: string): never {
  throw new Error(
    `ThreeRenderer.${member} is not implemented until a later Phase B sub-plan. ` +
      `Use ?renderer=pixi (the default) for anything that needs it.`
  );
}

export class ThreeRenderer implements Renderer {
  readonly camera: Camera = { x: 24, y: 24, zoom: 1 };
  selection: number[] = [];
  readonly unitGroup: Uint8Array;
  hoverEntity = -1;
  hoverStructure = -1;
  hoverCanGarrison = false;
  objectiveZone: readonly number[] | null = null;
  objectiveZoneState: 'held' | 'unheld' | 'contested' = 'held';

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private host: HTMLElement | null = null;

  constructor(
    private readonly sim: Sim,
    private readonly opts: RendererOptions
  ) {
    this.unitGroup = new Uint8Array(sim.capacity);
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
  get width(): number {
    return this.renderer.domElement.width;
  }
  get height(): number {
    return this.renderer.domElement.height;
  }

  async init(host: HTMLElement): Promise<void> {
    this.host = host;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(this.renderer.domElement);
    await Promise.resolve();
  }

  frame(_alpha: number, _dtMs: number): void {
    // B1 draws only the clear colour. B2 adds terrain.
    this.renderer.render(this.scene, this.threeCamera());
  }

  snapshot(): void {
    /* nothing to latch until B3 draws units */
  }
  onEvents(_events: SimEvent[]): void {
    /* B3 */
  }

  worldToScreen(_wx: number, _wy: number): { x: number; y: number } {
    return notYet('worldToScreen'); // Task B1.2
  }
  screenToWorld(_px: number, _py: number): { x: number; y: number } {
    return notYet('screenToWorld'); // Task B1.2
  }

  pickUnit(): number {
    return notYet('pickUnit');
  }
  isVisible(): boolean {
    return notYet('isVisible');
  }
  unitsInScreenRect(): number[] {
    return notYet('unitsInScreenRect');
  }
  setElevation(): void {
    return notYet('setElevation');
  }
  setDecor(): void {
    return notYet('setDecor');
  }
  useEmitters(): void {
    return notYet('useEmitters');
  }
  async loadSprites(): Promise<void> {
    return notYet('loadSprites');
  }
  async loadStructureSprite(): Promise<void> {
    return notYet('loadStructureSprite');
  }
  addOrderMarker(): void {
    return notYet('addOrderMarker');
  }
  setTutorialFocus(): void {
    return notYet('setTutorialFocus');
  }
  clearTutorialFocus(): void {
    return notYet('clearTutorialFocus');
  }

  private threeCamera(): THREE.OrthographicCamera {
    return notYet('threeCamera'); // Task B1.2
  }
}
```

**If `implements Renderer` complains that a signature does not match**, fix the signature here to match `api.ts` — never edit `api.ts` to accommodate this class. The interface is the contract `PixiRenderer` already satisfies.

- [ ] **Step 4: Export it**

In `packages/render/src/index.ts`, beside the existing `PixiRenderer` export:

```ts
export { ThreeRenderer } from './three/ThreeRenderer';
```

- [ ] **Step 5: Declare the URL parameter before using it**

`packages/app/src/sandbox-help.ts` holds one table that three callers read — `readFlags` parses from it, `sandboxHelp` prints from it, and `unknownParams` checks against it. A parameter used but not declared there gets warned about by name as a typo. Add to `KNOWN_PARAMS`:

```ts
  { name: 'renderer', blurb: 'pixi (default) | three — which backend draws' },
```

- [ ] **Step 6: Choose the implementation in `main.ts`**

Replace the single construction line (`const renderer: Renderer = new PixiRenderer(sim, opts);`) with:

```ts
  // Pixi is the default and stays the default until the three.js backend
  // reaches parity (spec, Phase D). The annotation is what makes this a real
  // choice: both sides must satisfy `Renderer` or this does not compile.
  const renderer: Renderer =
    params.get('renderer') === 'three' ? new ThreeRenderer(sim, opts) : new PixiRenderer(sim, opts);
```

Add `ThreeRenderer` to the existing `@lions/render` import block.

- [ ] **Step 7: Verify the default path is untouched and the flag reaches the new class**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm validate:ui
```

Expected: green, still **876 tests / 51 files** (this task adds no tests).

Then check both paths in a browser. `pnpm dev` serves on 5173.

- `http://localhost:5173/?sandbox=1` — must behave exactly as before. This is the regression that matters.
- `http://localhost:5173/?sandbox=1&renderer=three` — must fail with a `ThreeRenderer.<member> is not implemented until a later Phase B sub-plan` error in the console, naming a member. A blank screen with no error means the stubs are no-ops and Step 2 was not followed.

Note the tab must be FOREGROUND for anything to run — `requestAnimationFrame` does not fire in a hidden tab, and a hidden tab looks exactly like a frozen game.

- [ ] **Step 8: Commit**

```bash
git add packages/render/src/api.ts packages/render/src/renderer.ts packages/render/package.json pnpm-lock.yaml packages/render/src/three/ThreeRenderer.ts packages/render/src/index.ts packages/app/src/main.ts packages/app/src/sandbox-help.ts
git commit -m "feat(render): a three.js backend that exists but draws nothing yet

Implements the Renderer seam so \`implements\` proves the contract is
satisfiable by something that is not Pixi. Every drawing member throws a
named error rather than no-opping: a no-op renderer looks like a working
renderer drawing an empty world, and that failure surfaces as 'the map is
blank' several sub-plans later instead of as a stack trace naming the method.

Pixi remains the default. ?renderer=three is opt-in and declared in
KNOWN_PARAMS, so it is not warned about as a typo by the very table that
exists to catch typos.

Refs issue 123."
```

---

## Task B1.2: the dimetric camera, pinned against Pixi's own formula

**Files:**
- Create: `packages/render/src/three/camera.ts`, `packages/render/src/three/camera.test.ts`
- Modify: `packages/render/src/three/ThreeRenderer.ts`

**Interfaces:**
- Consumes: `TILE_W`, `TILE_H`, `Camera`, `Viewport`, `worldToScreen`, `screenToWorldFlat` from `../project`.
- Produces:
  - `dimetricCamera(cam: Camera, vp: Viewport): THREE.OrthographicCamera`
  - `worldToScreenThree(wx: number, wy: number, cam: Camera, vp: Viewport): { x: number; y: number }`
  - `screenToWorldThree(px: number, py: number, cam: Camera, vp: Viewport): { x: number; y: number }`
  - World-space convention, used by every later sub-plan: **game tile `(x, y)` maps to three.js `(x, elevation, y)`** — game Y is three.js Z, and three.js Y is up.

- [ ] **Step 1: Write the failing test**

The test does not assert camera *parameters* — those are the implementer's to solve for. It asserts the camera *agrees with the projection the game already uses*, which is the only property that matters and the only one that cannot drift silently.

Create `packages/render/src/three/camera.test.ts`:

```ts
/**
 * The three.js camera must reproduce the projection PixiRenderer already
 * draws with. Not approximately: a disagreement of a few pixels puts every
 * sprite in the wrong place, and the golden-image diff that gates Phase D
 * would be comparing two different worlds.
 *
 * These assertions are the specification. The camera's position, frustum and
 * elevation angle are whatever satisfies them.
 */
import { describe, it, expect } from 'vitest';
import { worldToScreen, screenToWorldFlat, type Camera, type Viewport } from '../project';
import { worldToScreenThree, screenToWorldThree, dimetricCamera } from './camera';

const VP: Viewport = { width: 800, height: 600 };
const CAM: Camera = { x: 24, y: 24, zoom: 1 };

/** Points chosen to exercise both diagonals, the origin, and fractional tiles. */
const POINTS: [number, number][] = [
  [24, 24], [0, 0], [47, 12], [12, 47], [3.5, 41.25], [30, 30], [10, 38],
];

describe('the three.js camera reproduces the dimetric projection', () => {
  it('agrees with project.worldToScreen at every sample point', () => {
    for (const [wx, wy] of POINTS) {
      const pixi = worldToScreen(wx, wy, CAM, VP);
      const three = worldToScreenThree(wx, wy, CAM, VP);
      expect(three.x).toBeCloseTo(pixi.x, 3);
      expect(three.y).toBeCloseTo(pixi.y, 3);
    }
  });

  it('agrees under zoom', () => {
    const cam: Camera = { x: 10, y: 30, zoom: 2.5 };
    for (const [wx, wy] of POINTS) {
      const pixi = worldToScreen(wx, wy, cam, VP);
      const three = worldToScreenThree(wx, wy, cam, VP);
      expect(three.x).toBeCloseTo(pixi.x, 3);
      expect(three.y).toBeCloseTo(pixi.y, 3);
    }
  });

  it('agrees under a non-square viewport', () => {
    const vp: Viewport = { width: 1280, height: 400 };
    for (const [wx, wy] of POINTS) {
      const pixi = worldToScreen(wx, wy, CAM, vp);
      const three = worldToScreenThree(wx, wy, CAM, vp);
      expect(three.x).toBeCloseTo(pixi.x, 3);
      expect(three.y).toBeCloseTo(pixi.y, 3);
    }
  });

  it('round-trips its own screenToWorld', () => {
    for (const [wx, wy] of POINTS) {
      const s = worldToScreenThree(wx, wy, CAM, VP);
      const back = screenToWorldThree(s.x, s.y, CAM, VP);
      expect(back.x).toBeCloseTo(wx, 3);
      expect(back.y).toBeCloseTo(wy, 3);
    }
  });

  it('agrees with project.screenToWorldFlat on the inverse too', () => {
    for (const [px, py] of [[400, 300], [0, 0], [799, 599], [123, 456]]) {
      const pixi = screenToWorldFlat(px, py, CAM, VP);
      const three = screenToWorldThree(px, py, CAM, VP);
      expect(three.x).toBeCloseTo(pixi.x, 3);
      expect(three.y).toBeCloseTo(pixi.y, 3);
    }
  });

  it('puts higher ground higher on screen, and by the same amount Pixi does', () => {
    // Elevation is three.js +Y. The dimetric projection turns a unit of height
    // into a fixed number of screen pixels; whatever that number is, it must
    // match what project.worldToScreen's `lift` parameter does.
    const flat = worldToScreenThree(30, 30, CAM, VP, 0);
    const high = worldToScreenThree(30, 30, CAM, VP, 24);
    expect(high.y).toBeLessThan(flat.y);
    expect(flat.y - high.y).toBeCloseTo(24, 3);
  });

  it('builds a camera that is orthographic and looks along the dimetric axis', () => {
    const c = dimetricCamera(CAM, VP);
    expect(c.isOrthographicCamera).toBe(true);
    // 45 degrees around: equal contribution from the two ground axes.
    expect(Math.abs(c.position.x)).toBeCloseTo(Math.abs(c.position.z), 6);
    expect(c.position.y).toBeGreaterThan(0);
  });
});
```

Note the sixth test calls `worldToScreenThree` with a fourth argument. Give it the signature `(wx, wy, cam, vp, lift = 0)` — matching `project.worldToScreen`, whose `lift` is in unscaled screen pixels.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/render/src/three/camera.test.ts
```

Expected: FAIL — `Failed to resolve import "./camera"`.

- [ ] **Step 3: Implement the camera**

Create `packages/render/src/three/camera.ts`. The shape to aim for:

- Game tile `(x, y)` is three.js `(x, 0, y)`; elevation is +Y.
- An orthographic camera at 45° azimuth (equal `|x|` and `|z|` offsets) and an elevation angle that makes the two ground axes project at the game's `TILE_W : TILE_H` ratio.
- The frustum sized from `vp` and `cam.zoom` so one world tile spans `TILE_W` pixels horizontally at zoom 1.
- `worldToScreenThree` projects with `camera.project()` and maps NDC to pixels; `screenToWorldThree` inverts it by unprojecting onto the `y = 0` plane.

**Solve for the angle rather than guessing it.** The test is the specification: adjust until all seven pass. Two facts that shorten the search — for a 2:1 dimetric the ground axes must project to a slope of `TILE_H / TILE_W`, and `Math.atan(0.5)` is the elevation that produces it. Verify rather than assume.

**Do not duplicate `project.ts`'s arithmetic here.** If `worldToScreenThree` ends up computing `isoX`/`isoY` itself, the second source of truth this whole refactor removed has been reintroduced in a new file. It must go through the camera.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run packages/render/src/three/camera.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Wire it into `ThreeRenderer`**

Replace the three `notYet` stubs for `worldToScreen`, `screenToWorld` and `threeCamera` with delegations to `camera.ts`, passing `this.camera` and `{ width: this.width, height: this.height }`.

- [ ] **Step 6: Verify**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm validate:ui
```

Expected: green, **883 tests / 52 files** (876 + 7).

- [ ] **Step 7: Commit**

```bash
git add packages/render/src/three/camera.ts packages/render/src/three/camera.test.ts packages/render/src/three/ThreeRenderer.ts
git commit -m "feat(render): the three.js camera reproduces the dimetric projection

Pinned against project.worldToScreen rather than against camera parameters:
the assertions are the specification, and the position, frustum and elevation
angle are whatever satisfies them. A disagreement of a few pixels would put
every sprite in the wrong place and leave Phase D's golden-image diff
comparing two different worlds.

Game tile (x, y) is three.js (x, elevation, y). That convention is used by
every later Phase B sub-plan.

Refs issue 123."
```

---

## Task B1.3: the shared conformance suite

**Files:**
- Create: `packages/render/src/conformance.ts`, `packages/render/src/conformance.test.ts`
- Modify: `packages/render/src/api.test.ts` (fold its stub-based projection tests in, so the contract is asserted in one place)

**Interfaces:**
- Consumes: `Renderer` from `./api`; both implementations' projection entry points.
- Produces: `runProjectionConformance(name: string, project: ProjectionUnderTest): void` — a describe-block factory, called once per implementation.

- [ ] **Step 1: Write the failing test**

Create `packages/render/src/conformance.test.ts`:

```ts
/**
 * One contract, asserted against every implementation of it.
 *
 * This runs headless with no WebGL: three.js's camera projection, world
 * matrices and Raycaster are all pure maths and work in environment: 'node'.
 * Only rasterization needs a browser, and that is the golden-image diff, which
 * is a separate check outside `pnpm test`.
 *
 * The value here is asymmetric. Running it against PixiRenderer's projection
 * proves the suite describes something real; running it against ThreeRenderer's
 * proves the second backend has not drifted. A suite written against only one
 * implementation would pass forever while the two diverged.
 */
import { runProjectionConformance } from './conformance';
import { worldToScreen, screenToWorldFlat } from './project';
import { worldToScreenThree, screenToWorldThree } from './three/camera';

runProjectionConformance('PixiRenderer (project.ts)', {
  worldToScreen,
  screenToWorld: screenToWorldFlat,
});

runProjectionConformance('ThreeRenderer (three/camera.ts)', {
  worldToScreen: worldToScreenThree,
  screenToWorld: screenToWorldThree,
});
```

Create `packages/render/src/conformance.ts` with the suite. It must assert, for any implementation:

1. the camera's own position lands at the viewport centre;
2. `worldToScreen` and `screenToWorld` are inverses on flat ground, at zoom 1, at zoom ≠ 1, and on a non-square viewport;
3. displacement from the camera scales linearly with zoom;
4. the two dimetric diagonals map to pure horizontal and pure vertical screen movement;
5. `lift` moves a point up the screen by the lift amount, unscaled by zoom.

Each assertion gets its own `it`, named for the property rather than the mechanism, so a failure names what broke.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/render/src/conformance.test.ts
```

Expected: FAIL — `Failed to resolve import "./conformance"`.

- [ ] **Step 3: Implement the suite, then fold `api.test.ts` in**

`api.test.ts` currently asserts the projection round-trip against a hand-built stub. The final Phase A review flagged that it duplicates `project.test.ts` and that its only unique value is the `Pick<Renderer, …>` signature check. Move the round-trip assertions into `conformance.ts`; keep only the signature check in `api.test.ts`, with a comment saying where the behaviour is now asserted.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run packages/render/src/conformance.test.ts packages/render/src/api.test.ts
```

Expected: PASS. The same suite runs twice, once per implementation.

- [ ] **Step 5: Prove the suite has teeth**

A conformance suite that cannot fail is decoration. Temporarily break one implementation — in `three/camera.ts`, change the frustum size by 1% — and confirm the ThreeRenderer block fails while the Pixi block still passes.

```bash
npx vitest run packages/render/src/conformance.test.ts
```

Expected: failures under `ThreeRenderer (three/camera.ts)` only. **Then revert the deliberate break** and re-run to confirm green. Record both outcomes in your report.

- [ ] **Step 6: Verify**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm validate:ui
```

Expected: green. Report the exact test/file totals; the number moves as `api.test.ts` sheds duplicated cases and the suite runs twice, so state what you measured rather than predicting it.

- [ ] **Step 7: Commit**

```bash
git add packages/render/src/conformance.ts packages/render/src/conformance.test.ts packages/render/src/api.test.ts
git commit -m "test(render): one projection contract, asserted against both backends

Runs headless with no WebGL. three.js's camera projection, world matrices and
Raycaster are pure maths and work in environment: 'node' -- verified before
building on it, since the Phase A review's 'must run against constructed
renderers' implied headless-gl or a browser in CI and neither is needed.
Only rasterization needs a browser, and that is the golden-image diff, which
stays outside pnpm test.

The value is asymmetric: against Pixi it proves the suite describes something
real, against three it proves the second backend has not drifted. Written
against one implementation it would pass forever while the two diverged.

api.test.ts keeps only the signature check; its round-trip assertions moved
here rather than being duplicated a third time.

Refs issue 123."
```

---

## Task B1.4: the colour pipeline Phase 0 proved is required

**Files:**
- Create: `packages/render/src/three/palette-material.ts`, `packages/render/src/three/palette-material.test.ts`
- Modify: `packages/render/src/three/ThreeRenderer.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks except `ThreeRenderer` itself.
- Produces:
  - `applyPalettePipeline(renderer: THREE.WebGLRenderer): void` — the pass-through colour settings.
  - `paletteColorNoConvert(hex: string): THREE.Color` — a colour whose bytes survive to the framebuffer.
  - `toonRampMaterial(rampHexes: readonly string[]): THREE.ShaderMaterial`
  - `RAMP_MAX = 9` — the longest ramp in `data/palette.json`, and the shader's array length.

- [ ] **Step 1: Read the verdict this task implements**

`docs/superpowers/specs/2026-08-26-phase-0-verdict.md`, "Two findings that are requirements for Phase B". Do not re-derive them: the naive pipeline was measured at **0 of 65 colours in palette**, and the fix is three specific settings.

- [ ] **Step 2: Write the failing test**

Create `packages/render/src/three/palette-material.test.ts`:

```ts
/**
 * Phase 0 measured the obvious setup at ZERO colours in palette: building LUT
 * colours with convertSRGBToLinear() and leaving three.js's default output
 * colour space moves every value off its palette entry. It fails silently --
 * the render looks fine, it is merely not the palette.
 *
 * These tests pin the three settings that fix it, so the failure cannot come
 * back as a surprise in B2 or B3.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { paletteColorNoConvert, toonRampMaterial, RAMP_MAX } from './palette-material';

const OLIVE = ['#8F9464', '#6E7449', '#4E5433', '#333821'];

describe('paletteColorNoConvert', () => {
  it('preserves the exact bytes of the palette entry', () => {
    for (const hex of OLIVE) {
      const c = paletteColorNoConvert(hex);
      expect('#' + c.getHexString().toUpperCase()).toBe(hex.toUpperCase());
    }
  });

  it('differs from the converting path — the bug this exists to prevent', () => {
    // If these ever agree, three.js changed its conversion and this guard is
    // no longer measuring anything.
    const plain = paletteColorNoConvert('#8F9464');
    const converted = new THREE.Color('#8F9464').convertSRGBToLinear();
    expect(plain.getHexString()).not.toBe(converted.getHexString());
  });
});

describe('toonRampMaterial', () => {
  it('pads the ramp to the shader array length so three.js can upload it', () => {
    // A short ramp left short makes three.js read past the end of the array
    // while uploading a vec3[RAMP_MAX] uniform.
    const m = toonRampMaterial(OLIVE);
    expect(m.uniforms.uRamp.value).toHaveLength(RAMP_MAX);
  });

  it('reports the true step count separately from the padded length', () => {
    const m = toonRampMaterial(OLIVE);
    expect(m.uniforms.uSteps.value).toBe(OLIVE.length);
  });

  it('carries the ramp colours unconverted', () => {
    const m = toonRampMaterial(OLIVE);
    const first = m.uniforms.uRamp.value[0] as THREE.Color;
    expect('#' + first.getHexString().toUpperCase()).toBe(OLIVE[0]);
  });

  it('handles the shortest ramp in the palette without padding past the end', () => {
    const skin = ['#C78773', '#A87262'];
    const m = toonRampMaterial(skin);
    expect(m.uniforms.uRamp.value).toHaveLength(RAMP_MAX);
    expect(m.uniforms.uSteps.value).toBe(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run packages/render/src/three/palette-material.test.ts
```

Expected: FAIL — `Failed to resolve import "./palette-material"`.

- [ ] **Step 4: Implement it**

Create `packages/render/src/three/palette-material.ts`. The three settings, from the verdict:

- `paletteColorNoConvert(hex)` → `new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace)`
- `applyPalettePipeline(renderer)` → `renderer.outputColorSpace = THREE.LinearSRGBColorSpace`, and a `setClearColor` helper that takes a `paletteColorNoConvert` value — the verdict records the background landing at `#93744C` instead of `#C8B494` when it does not.
- Antialiasing stays off; the `WebGLRenderer` in `ThreeRenderer` is already constructed with `antialias: false`. Add a comment there pointing at the verdict, since a future reader will otherwise switch it on.

The shader quantizes `N·L` into `uSteps` bands and indexes `uRamp`. **Index 0 of every ramp in this project is the LIGHTEST step**, so brighter light means a lower index — getting this backwards inverts every unit's shading and is the kind of thing that reads as "the art looks wrong" rather than as a bug.

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run packages/render/src/three/palette-material.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Apply it in `ThreeRenderer.init`**

Call `applyPalettePipeline(this.renderer)` in `init`, and set the clear colour from `opts.background` through `paletteColorNoConvert`.

- [ ] **Step 7: Verify**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm validate:ui
```

Then in a browser, `http://localhost:5173/?sandbox=1&renderer=three` — the canvas must clear to the map's background colour, and reading a pixel must give exactly that palette hex:

```js
const c = document.querySelector('canvas');
const g = c.getContext('webgl2');
const p = new Uint8Array(4);
g.readPixels(1, 1, 1, 1, g.RGBA, g.UNSIGNED_BYTE, p);
'#' + [...p].slice(0,3).map(v => v.toString(16).padStart(2,'0')).join('').toUpperCase();
```

Report the value you got. If it is not the palette's background entry exactly, the pipeline is not right and B2 will build terrain on top of a wrong colour space.

- [ ] **Step 8: Commit**

```bash
git add packages/render/src/three/palette-material.ts packages/render/src/three/palette-material.test.ts packages/render/src/three/ThreeRenderer.ts
git commit -m "feat(render): the colour pipeline that keeps three.js inside the palette

Phase 0 measured the obvious setup -- convertSRGBToLinear plus three.js's
default output colour space -- at ZERO of 65 colours in palette, because the
linear/sRGB round trip moves every value off its entry. It fails silently: the
render looks fine, it is merely not the palette.

Three settings fix it: LUT colours via setStyle(hex, LinearSRGBColorSpace),
outputColorSpace set to pass-through, and setClearColor given the same
treatment or the background alone lands off-palette. Antialiasing stays off,
since a blended edge pixel is by definition not a palette colour and the
sprite pipeline quantizes rather than blends.

Tested here rather than left to be rediscovered in B2 or B3, including a guard
that fails if three.js ever changes its conversion and the two paths agree.

Refs issue 123."
```

---

## Self-Review

**Spec coverage.** B1 covers the spec's Phase B insofar as Phase B begins: the second implementation exists, the camera matches, the colour pipeline is right, and the conformance suite the final Phase A review asked for exists and runs against both backends. Terrain (B2), units (B3) and fog (B4) are explicitly out of this plan and named above.

**Gaps, stated rather than hidden.** The spec's Testing section promises a golden-image diff between the two renderers as Phase D's gate. B1 does not build it — there is nothing to diff until B2 draws terrain. It belongs to B2, and B2's plan must pick it up. B1 also does not implement `pickUnit`, `isVisible` or `unitsInScreenRect`; the `Raycaster`-based picking that the headless probe confirmed is available lands in B3 with the units it picks.

**Placeholders.** None. Task B1.2's Step 3 deliberately does not hand over the camera's numeric parameters — the test is the specification and the implementer solves for them. That is a chosen method, not an omission; handing over an angle I derived on paper would be handing over an unverified number, and the test would then be checking my arithmetic rather than the projection.

**Type consistency.** `Camera` and `Viewport` come from `../project` everywhere. `worldToScreenThree` takes `(wx, wy, cam, vp, lift = 0)`, matching `project.worldToScreen`'s five-parameter form — deliberately *not* the seam's two-parameter `Renderer.worldToScreen`, which drops `lift` because it encodes a Pixi convention (Phase A, finding 4). `RAMP_MAX = 9` is used by both the shader's array declaration and the padding assertion.

**Test counts.** Entering: 876 / 51. B1.1 adds none. B1.2 adds 7 → 883 / 52. B1.3 moves cases and runs the suite twice, so its total is measured rather than predicted. B1.4 adds 6.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-26-three-renderer-phase-b1.md`.
