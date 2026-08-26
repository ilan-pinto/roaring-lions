# three.js Renderer — Phase 0 and Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer whether the game's quantized palette survives real-time shading (GO/NO-GO), and — independently of that answer — extract a backend-agnostic `Renderer` seam from `PixiRenderer` so a second implementation becomes possible.

**Architecture:** Phase 0 is a throwaway spike outside the repo whose only deliverable is a written verdict. Phase A extracts the projection arithmetic into a pure, tested module, defines a `Renderer` interface over `PixiRenderer`'s existing public surface, and closes the four places where `packages/app` reaches through the renderer into PixiJS. Phase A ships on Pixi and changes no behaviour.

**Tech Stack:** TypeScript (strict), PixiJS 8.19 (existing), three.js 0.170 (Phase 0 spike only, never committed), Vitest (`environment: 'node'`).

**Spec:** `docs/superpowers/specs/2026-08-26-three-renderer-design.md`

## Global Constraints

- **Branch:** all work on `feat/three-renderer`, in the worktree at `.claude/worktrees/three-renderer`. Never touch the primary working tree at `~/dev/roaring-lions` — other sessions work there and their uncommitted files must survive.
- **Never run `git reset --hard`, `git checkout <branch>`, or `git stash`** anywhere in this repository. Stage explicit paths; never `git add -A` or `git commit -a`.
- `@lions/sim` must not change. No file under `packages/sim/` is touched by this plan.
- The determinism golden hash must not change.
- `data/` must not change.
- TypeScript strict mode. No `any`. No non-null assertions in sim code.
- Every task ends green on: `pnpm typecheck`, `pnpm lint`, `pnpm test` (863 tests baseline), `pnpm validate:ui`.
- `pnpm validate:ui` has **no allowlist** and reads a `#` followed by three hex digits as a colour literal. A bare issue reference like `#123` therefore cannot appear anywhere under `packages/app/src` or in `packages/render/src/overlay.ts`. Write `issue 123`.
- Phase A must produce **no visible behaviour change**. It is a refactor.

---

## File Structure

| file | responsibility |
|---|---|
| `packages/render/src/project.ts` | **new.** Pure dimetric projection: `TILE_W`, `TILE_H`, `isoX`, `isoY`, `worldToScreen`, `screenToWorldFlat`. No Pixi, no DOM, no sim. |
| `packages/render/src/project.test.ts` | **new.** Round-trip and known-value tests for the above. |
| `packages/render/src/api.ts` | **new.** The `Renderer` interface and its `Camera` / `Viewport` types. Types only — no implementation. |
| `packages/render/src/renderer.ts` | **modify.** Imports projection from `project.ts` and re-exports for compatibility; gains `canvas`, `width`, `height`, `worldToScreen`; declares `implements Renderer`. |
| `packages/render/src/index.ts` | **modify.** Exports the `Renderer` type and the projection module. |
| `packages/app/src/main.ts` | **modify.** Stops reaching through `renderer.app`; stops importing `isoX`/`isoY`; owns its own frame loop. |

`project.ts` is named `project.ts` rather than `projection.ts` because `packages/sim/src/projection.test.ts` already exists and is about something else entirely (ballistic flight). Two files named for the same concept in two packages would be a trap.

---

## Task 0.1: Phase 0 — palette identity spike (GO / NO-GO)

This is a **spike**, not a feature. Its deliverable is a written verdict and two images. **No code from this task is committed to `packages/`.** If the verdict is NO-GO, Tasks A1–A4 are still worth doing (the seam is valuable on its own) but Phases B–G of the spec are abandoned.

**Files:**
- Create: `/tmp/palette-spike/` (outside the repository entirely — never inside the worktree, so no `.gitignore` entry is needed and nothing can be swept into a commit)
- Create: `docs/superpowers/specs/2026-08-26-phase-0-verdict.md` (the only committed artifact)

**Interfaces:**
- Consumes: nothing.
- Produces: a verdict document containing the string `VERDICT: GO` or `VERDICT: NO-GO`. Task A1 does not depend on it; Phase B does.

- [ ] **Step 1: Read the palette and pick the subject**

The palette is `data/palette.json`. The subject is `INF_SQUAD`, because infantry is the type Phase F migrates first and the one whose silhouette matters most at gameplay size.

Run this to get the exact ramp the sprite was quantized to, and the sprite's own draw size:

```bash
cd /Users/ilpinto/dev/roaring-lions/.claude/worktrees/three-renderer
python3 -c "
import json
p = json.load(open('data/palette.json'))
print('ramps:', list(p['ramps'].keys()))
print('reserved:', list(p['reserved'].keys()))
m = json.load(open('assets/sprites/INF_SQUAD/manifest.json'))
print('sprite size:', m['size'], 'scale:', m['scale'], 'facings:', m['facings'])
print('clips:', {k: v['frames'] for k, v in m['clips'].items()})
"
```

- [ ] **Step 2: Scaffold the spike outside the repo**

```bash
mkdir -p /tmp/palette-spike && cd /tmp/palette-spike
cat > package.json <<'JSON'
{ "name": "palette-spike", "private": true, "type": "module",
  "scripts": { "dev": "vite --port 5198" },
  "dependencies": { "three": "^0.170.0" },
  "devDependencies": { "vite": "^7.0.0" } }
JSON
npm install
```

- [ ] **Step 3: Build the comparison page**

Two panels, side by side, at the size a unit actually draws at in play — **not zoomed in**. Left: the shipped `assets/sprites/INF_SQUAD/idle_f00_000.png`. Right: a low-poly stand-in mesh under an orthographic camera at `atan(0.5)` elevation / 45° azimuth, shaded through a toon ramp whose steps are the palette's own colours, then passed through a palette lookup so no off-palette pixel can be emitted.

The mesh does not need to be a good soldier. It needs to be the right size, the right silhouette mass, and lit the way a real one would be. The question under test is *colour and shading identity*, not modelling.

Copy the sprite in so the page can load it:

```bash
cp /Users/ilpinto/dev/roaring-lions/.claude/worktrees/three-renderer/assets/sprites/INF_SQUAD/idle_f00_000.png /tmp/palette-spike/sprite.png
```

- [ ] **Step 4: Judge at gameplay size, then zoomed**

Screenshot both panels at 1× first. The prior recorded in memory is that this user judges sprites zoomed in, and that this is the wrong altitude for a gameplay-read decision — so **record the 1× verdict before looking at the zoom**, and report both.

Three specific questions, each answered yes/no with the image as evidence:
1. Does the 3D unit read as the same art direction as the sprite, at 1×?
2. Does the toon ramp produce banding that the quantized sprite does not have?
3. Does the silhouette hold at 1×, or does real-time shading wash out the edge the sprite has?

- [ ] **Step 5: Write the verdict**

Create `docs/superpowers/specs/2026-08-26-phase-0-verdict.md` containing the two screenshots' descriptions, the three answers, and a line reading exactly `VERDICT: GO` or `VERDICT: NO-GO`. State what was NOT tested: one unit type, one lighting setup, no terrain behind it, no fog.

- [ ] **Step 6: Delete the spike, commit only the verdict**

```bash
rm -rf /tmp/palette-spike
cd /Users/ilpinto/dev/roaring-lions/.claude/worktrees/three-renderer
git add docs/superpowers/specs/2026-08-26-phase-0-verdict.md
git commit -m "docs(spec): Phase 0 verdict — does the palette survive real-time shading

<verdict and reasoning here>

Refs issue 123."
```

---

## Task A1: Pure projection module

**Files:**
- Create: `packages/render/src/project.ts`
- Create: `packages/render/src/project.test.ts`
- Modify: `packages/render/src/renderer.ts` (delete the local `TILE_W`/`TILE_H`/`isoX`/`isoY` definitions at lines 84–85 and 211–216; import and re-export from `project.ts`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `TILE_W: 64`, `TILE_H: 32`
  - `interface Camera { x: number; y: number; zoom: number }`
  - `interface Viewport { width: number; height: number }`
  - `isoX(x: number, y: number): number`
  - `isoY(x: number, y: number): number`
  - `worldToScreen(wx: number, wy: number, cam: Camera, vp: Viewport, lift?: number): { x: number; y: number }`
  - `screenToWorldFlat(px: number, py: number, cam: Camera, vp: Viewport): { x: number; y: number }`

- [ ] **Step 1: Write the failing test**

Create `packages/render/src/project.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  TILE_W, TILE_H, isoX, isoY, worldToScreen, screenToWorldFlat,
  type Camera, type Viewport,
} from './project';

const VP: Viewport = { width: 800, height: 600 };
const CAM: Camera = { x: 24, y: 24, zoom: 1 };

describe('isoX / isoY', () => {
  it('places the origin at zero', () => {
    expect(isoX(0, 0)).toBe(0);
    expect(isoY(0, 0)).toBe(0);
  });

  it('is 2:1 dimetric — one tile east is half a tile-width right and half a tile-height down', () => {
    expect(isoX(1, 0)).toBe(TILE_W / 2);
    expect(isoY(1, 0)).toBe(TILE_H / 2);
  });

  it('sends the two diagonals to pure horizontal and pure vertical', () => {
    expect(isoY(1, -1)).toBe(0);   // x-y axis runs flat across the screen
    expect(isoX(1, 1)).toBe(0);    // x+y axis runs straight down it
  });
});

describe('worldToScreen', () => {
  it('puts whatever the camera looks at in the middle of the viewport', () => {
    const p = worldToScreen(CAM.x, CAM.y, CAM, VP);
    expect(p.x).toBeCloseTo(VP.width / 2);
    expect(p.y).toBeCloseTo(VP.height / 2);
  });

  it('scales displacement from the camera by zoom', () => {
    const one = worldToScreen(CAM.x + 4, CAM.y, CAM, VP);
    const two = worldToScreen(CAM.x + 4, CAM.y, { ...CAM, zoom: 2 }, VP);
    expect(two.x - VP.width / 2).toBeCloseTo((one.x - VP.width / 2) * 2);
  });

  it('lifts a raised tile UP the screen, and by zoom-scaled amount', () => {
    const flat = worldToScreen(CAM.x + 2, CAM.y + 2, CAM, VP, 0);
    const high = worldToScreen(CAM.x + 2, CAM.y + 2, CAM, VP, 30);
    expect(high.y).toBeLessThan(flat.y);
    expect(flat.y - high.y).toBeCloseTo(30);
  });
});

describe('screenToWorldFlat', () => {
  it('round-trips with worldToScreen on flat ground', () => {
    for (const [wx, wy] of [[24, 24], [0, 0], [47, 12], [3.5, 41.25]]) {
      const s = worldToScreen(wx, wy, CAM, VP);
      const back = screenToWorldFlat(s.x, s.y, CAM, VP);
      expect(back.x).toBeCloseTo(wx);
      expect(back.y).toBeCloseTo(wy);
    }
  });

  it('round-trips under zoom too', () => {
    const cam: Camera = { x: 10, y: 30, zoom: 2.5 };
    const s = worldToScreen(18, 22, cam, VP);
    const back = screenToWorldFlat(s.x, s.y, cam, VP);
    expect(back.x).toBeCloseTo(18);
    expect(back.y).toBeCloseTo(22);
  });

  it('maps the viewport centre back to the camera', () => {
    const back = screenToWorldFlat(VP.width / 2, VP.height / 2, CAM, VP);
    expect(back.x).toBeCloseTo(CAM.x);
    expect(back.y).toBeCloseTo(CAM.y);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/ilpinto/dev/roaring-lions/.claude/worktrees/three-renderer
npx vitest run packages/render/src/project.test.ts
```

Expected: FAIL — `Failed to resolve import "./project"`.

- [ ] **Step 3: Write the implementation**

Create `packages/render/src/project.ts`:

```ts
/**
 * The dimetric projection, as arithmetic rather than as a renderer.
 *
 * Split out of `renderer.ts` for two reasons. It is pure — no Pixi, no DOM, no
 * sim — so it can be tested in `environment: 'node'` where the renderer itself
 * cannot be built at all. And `packages/app` used to import `isoX`/`isoY` and
 * redo the camera arithmetic itself, which made the app a second and
 * independently drifting source of truth for where things are on screen; that
 * call site now asks the renderer instead, and the renderer answers from here.
 *
 * A three.js backend will NOT use these functions — there the projection is the
 * camera. That is the point of the seam: `Renderer.worldToScreen` is the
 * contract, and this file is one backend's way of honouring it.
 */

/** Tile footprint in screen pixels at zoom 1. 2:1 dimetric. */
export const TILE_W = 64;
export const TILE_H = 32;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** World (tile) coords → unscaled, uncentred dimetric screen offsets. */
export function isoX(x: number, y: number): number {
  return ((x - y) * TILE_W) / 2;
}

export function isoY(x: number, y: number): number {
  return ((x + y) * TILE_H) / 2;
}

/**
 * World point → pixel in the viewport.
 *
 * `lift` is how far terrain raises this tile up the screen, in unscaled pixels.
 * It is subtracted before the zoom multiply, matching the draw path, so a
 * raised tile and the sprite standing on it move together at every zoom.
 * Callers that deliberately want the flat projection pass 0 — the cursor
 * readout does exactly that, because `screenToWorld` only approximates the
 * inverse of the lift and reporting an unlifted answer is honest where
 * pretending would not be.
 */
export function worldToScreen(
  wx: number,
  wy: number,
  cam: Camera,
  vp: Viewport,
  lift = 0
): { x: number; y: number } {
  const z = cam.zoom;
  return {
    x: (isoX(wx, wy) - isoX(cam.x, cam.y)) * z + vp.width / 2,
    y: (isoY(wx, wy) - lift - isoY(cam.x, cam.y)) * z + vp.height / 2,
  };
}

/**
 * Pixel → world point, assuming flat ground.
 *
 * Named `Flat` because it is only half the inverse: terrain lift means one
 * screen point can correspond to several tiles at different heights, and
 * resolving that needs the height field. `PixiRenderer.screenToWorld` layers
 * that approximation on top of this.
 */
export function screenToWorldFlat(
  px: number,
  py: number,
  cam: Camera,
  vp: Viewport
): { x: number; y: number } {
  const z = cam.zoom;
  const sx = (px - vp.width / 2) / z + isoX(cam.x, cam.y);
  const sy = (py - vp.height / 2) / z + isoY(cam.x, cam.y);
  return { x: sx / TILE_W + sy / TILE_H, y: sy / TILE_H - sx / TILE_W };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run packages/render/src/project.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Make `renderer.ts` use it instead of its own copies**

In `packages/render/src/renderer.ts`:

1. Delete the `TILE_W` / `TILE_H` constants (lines 84–85) and the `isoX` / `isoY` functions (lines 211–216).
2. Add to the import block at the top:

```ts
import { TILE_W, TILE_H, isoX, isoY, screenToWorldFlat, type Camera, type Viewport } from './project';
```

3. Re-export them so every existing importer keeps working unchanged:

```ts
export { TILE_W, TILE_H, isoX, isoY, worldToScreen, screenToWorldFlat } from './project';
export type { Camera, Viewport } from './project';
```

4. Replace the flat-projection arithmetic inside `screenToWorld` (renderer.ts:975–998) so it delegates. The lift approximation stays exactly as it is:

```ts
  screenToWorld(px: number, py: number): { x: number; y: number } {
    const vp = { width: this.app.renderer.width, height: this.app.renderer.height };
    const flat = screenToWorldFlat(px, py, this.camera, vp);
    // Approximate, and deliberately so. Terrain lifts a tile on screen, so a
    // click lands on the tile BEHIND a raised one -- further off the taller the
    // ground. Exactly inverting that needs a raycast down the height field,
    // because one screen point can correspond to several tiles at different
    // heights.
    //
    // Instead: read the height where the flat projection lands, undo that much
    // lift, and project again. Accurate on flat and gently sloped ground, and
    // it drifts on steep relief. That is a real limitation, not a rounding
    // error -- worth replacing with the raycast if it proves annoying in play,
    // and not worth building before anyone has found it annoying.
    const lift = this.groundOffset(flat.x, flat.y);
    if (lift === 0) return flat;
    const z = this.camera.zoom;
    const sy = (py - vp.height / 2) / z + isoY(this.camera.x, this.camera.y) + lift;
    const sx = (px - vp.width / 2) / z + isoX(this.camera.x, this.camera.y);
    return { x: sx / TILE_W + sy / TILE_H, y: sy / TILE_H - sx / TILE_W };
  }
```

- [ ] **Step 6: Verify nothing regressed**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: typecheck clean, lint clean, **872 tests pass** (863 baseline + 9 new). In particular `packages/render/src/depth.test.ts` must still pass — it imports `bandKey`, `bandZ`, `unitZ` from `renderer.ts`, which this task does not move.

- [ ] **Step 7: Commit**

```bash
git add packages/render/src/project.ts packages/render/src/project.test.ts packages/render/src/renderer.ts
git commit -m "refactor(render): the dimetric projection becomes arithmetic, not a renderer

Pure, so it can be tested in environment: 'node' where the renderer itself
cannot be constructed. renderer.ts re-exports every name it used to own, so
this is invisible to callers.

A three.js backend will not use these functions -- there the projection is
the camera -- which is exactly why worldToScreen wants to be a question the
renderer answers rather than arithmetic its callers repeat.

Refs issue 123."
```

---

## Task A2: The `Renderer` interface, and the members the seam needs

**Files:**
- Create: `packages/render/src/api.ts`
- Modify: `packages/render/src/renderer.ts` (add `canvas`, `width`, `height`, `worldToScreen`; declare `implements Renderer`)
- Modify: `packages/render/src/index.ts` (export the type)

**Interfaces:**
- Consumes: `Camera`, `Viewport`, `worldToScreen` from Task A1's `project.ts`.
- Produces:
  - `interface Renderer` — the full seam
  - On `PixiRenderer`: `get canvas(): HTMLCanvasElement`, `get width(): number`, `get height(): number`, `worldToScreen(wx: number, wy: number, lift?: number): { x: number; y: number }`

- [ ] **Step 1: Write the failing test**

Create `packages/render/src/api.test.ts`:

```ts
/**
 * The seam's contract, tested where it can be tested without a GPU.
 *
 * `PixiRenderer` cannot be constructed under environment: 'node' -- it needs a
 * WebGL context -- so this suite does NOT instantiate it. What it pins is the
 * part of the contract that is arithmetic: that a renderer's worldToScreen and
 * screenToWorld are inverses of each other on flat ground, expressed against a
 * minimal stand-in. When ThreeRenderer arrives it runs this same suite.
 */
import { describe, it, expect } from 'vitest';
import { worldToScreen, screenToWorldFlat, type Camera, type Viewport } from './project';
import type { Renderer } from './api';

/** The smallest thing that can satisfy the projection half of the seam. */
function stubRenderer(cam: Camera, vp: Viewport): Pick<Renderer, 'worldToScreen' | 'screenToWorld' | 'camera' | 'width' | 'height'> {
  return {
    camera: cam,
    width: vp.width,
    height: vp.height,
    worldToScreen: (wx, wy, lift = 0) => worldToScreen(wx, wy, cam, vp, lift),
    screenToWorld: (px, py) => screenToWorldFlat(px, py, cam, vp),
  };
}

describe('Renderer projection contract', () => {
  const r = stubRenderer({ x: 24, y: 24, zoom: 1 }, { width: 800, height: 600 });

  it('worldToScreen and screenToWorld are inverses on flat ground', () => {
    for (const [wx, wy] of [[24, 24], [10, 40], [47.5, 2.25]]) {
      const s = r.worldToScreen(wx, wy);
      const back = r.screenToWorld(s.x, s.y);
      expect(back.x).toBeCloseTo(wx);
      expect(back.y).toBeCloseTo(wy);
    }
  });

  it('reports its own viewport rather than making callers find it', () => {
    expect(r.width).toBe(800);
    expect(r.height).toBe(600);
  });

  it('centres the camera in the viewport', () => {
    const s = r.worldToScreen(r.camera.x, r.camera.y);
    expect(s.x).toBeCloseTo(r.width / 2);
    expect(s.y).toBeCloseTo(r.height / 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/render/src/api.test.ts
```

Expected: FAIL — `Failed to resolve import "./api"`.

- [ ] **Step 3: Write the interface**

Create `packages/render/src/api.ts`:

```ts
/**
 * What `packages/app` is allowed to know about a renderer.
 *
 * Extracted so a second backend is possible. The surface is small for a
 * 5,000-line implementation -- thirteen methods and ten properties -- and that
 * smallness is the whole reason replacing the backend is tractable.
 *
 * Types only. No implementation, no imports from Pixi or three.
 */
import type { SimEvent } from '@lions/sim';
import type { Camera } from './project';
import type { EmitterSpec } from './vfx';

export interface Renderer {
  // --- lifecycle
  init(host: HTMLElement): Promise<void>;
  /** Draw one frame. `alpha` is the 0..1 interpolation between sim ticks. */
  frame(alpha: number): void;
  /** Latch current sim positions as the previous frame's, before the next tick. */
  snapshot(): void;
  onEvents(events: SimEvent[]): void;

  // --- the surface itself
  /** The element to attach input listeners to. Callers must not ask which
   *  graphics library made it. */
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;

  // --- projection. Both directions belong to the renderer because in a 3D
  //     backend the projection IS the camera, and a caller that recomputes it
  //     becomes a second source of truth that drifts.
  worldToScreen(wx: number, wy: number, lift?: number): { x: number; y: number };
  screenToWorld(px: number, py: number): { x: number; y: number };

  // --- queries
  pickUnit(wx: number, wy: number, radiusTiles?: number): number;
  isVisible(wx: number, wy: number): boolean;

  // --- world data pushed in
  setElevation(elevation: Uint8Array): void;
  setDecor(decor: Uint8Array): void;
  useEmitters(list: EmitterSpec[], resolve: (key: string) => string): void;

  // --- presentation state the app drives
  readonly camera: Camera;
  selection: number[];
  readonly unitGroup: Uint8Array;
  hoverEntity: number;
  hoverStructure: number;
  hoverCanGarrison: boolean;
  objectiveZone: readonly number[] | null;
  objectiveZoneState: 'held' | 'unheld' | 'contested';

  addOrderMarker(x: number, y: number): void;
  setTutorialFocus(x: number, y: number, radius: number): void;
  clearTutorialFocus(): void;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run packages/render/src/api.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Add the new members to `PixiRenderer`**

In `packages/render/src/renderer.ts`, inside the class, near the existing `readonly app` / `readonly camera` declarations (around line 219):

```ts
  /** The canvas, without making callers name the backend to reach it. */
  get canvas(): HTMLCanvasElement {
    return this.app.canvas as HTMLCanvasElement;
  }

  get width(): number {
    return this.app.renderer.width;
  }

  get height(): number {
    return this.app.renderer.height;
  }

  /** Forward projection. `lift` defaults to 0, which is the flat answer the
   *  cursor readout wants -- see project.ts's note on why that is honest. */
  worldToScreen(wx: number, wy: number, lift = 0): { x: number; y: number } {
    return projectWorldToScreen(wx, wy, this.camera, { width: this.width, height: this.height }, lift);
  }
```

Add to the `project.ts` import added in Task A1:

```ts
import { worldToScreen as projectWorldToScreen } from './project';
```

Then declare the implementation:

```ts
export class PixiRenderer implements Renderer {
```

with `import type { Renderer } from './api';` at the top.

- [ ] **Step 6: Export the type**

In `packages/render/src/index.ts`, add:

```ts
export type { Renderer } from './api';
export {
  TILE_W as PROJECT_TILE_W,
  worldToScreen,
  screenToWorldFlat,
  type Camera,
  type Viewport,
} from './project';
```

Note: `TILE_W`/`TILE_H` are already exported from `./renderer` in this file. Do **not** export them twice — re-exporting `TILE_W` under a second name here would be two names for one constant. If `TILE_W` is already in the `./renderer` export block, omit it from this block entirely and export only `worldToScreen`, `screenToWorldFlat`, `Camera`, `Viewport`.

- [ ] **Step 7: Verify**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: typecheck clean — and if `PixiRenderer` is missing any member of `Renderer`, this is where it says so, by name. Fix by adding the member, never by widening the interface. **875 tests pass.**

- [ ] **Step 8: Commit**

```bash
git add packages/render/src/api.ts packages/render/src/api.test.ts packages/render/src/renderer.ts packages/render/src/index.ts
git commit -m "feat(render): a Renderer interface the app can hold instead of PixiRenderer

Thirteen methods and ten properties over a 5,000-line implementation. The
smallness is the point: it is what makes a second backend tractable.

Adds the three members the app currently reaches through the backend for --
canvas, width, height -- and worldToScreen, which it currently recomputes
itself from exported isoX/isoY. \`implements Renderer\` on PixiRenderer means
the compiler now reports a missing member by name.

Refs issue 123."
```

---

## Task A3: The app stops reaching through the renderer

**Files:**
- Modify: `packages/app/src/main.ts` (lines 23–24, 825, 1338–1342)

**Interfaces:**
- Consumes: `Renderer.canvas`, `.width`, `.height`, `.worldToScreen` from Task A2.
- Produces: nothing new. This task removes usages.

- [ ] **Step 1: Find every reach-through**

```bash
cd /Users/ilpinto/dev/roaring-lions/.claude/worktrees/three-renderer
grep -n "renderer\.app\|isoX\|isoY" packages/app/src/main.ts
```

Expected, before the change: `renderer.app.canvas` at 825, `renderer.app.renderer.width`/`.height` at 1338–1339, `renderer.app.ticker.add` at 1447 (Task A4 handles that one), and `isoX`/`isoY` in the import block at 23–24 plus the cursor calculation at 1341–1342.

- [ ] **Step 2: Replace the canvas reach-through**

`packages/app/src/main.ts:825` becomes:

```ts
  const canvas = renderer.canvas;
```

- [ ] **Step 3: Replace the cursor projection**

`packages/app/src/main.ts:1338–1342` becomes:

```ts
        // Forward projection, the inverse of screenToWorld's flat path. It
        // does NOT undo terrain lift -- screenToWorld only approximates that
        // itself (see its comment), so rather than pretend, this reports the
        // tile it actually landed on and lets the caller see any drift.
        //
        // Asked of the renderer rather than recomputed here: in a 3D backend
        // the projection is the camera, and a second copy of the arithmetic
        // would drift from it silently.
        const p = renderer.worldToScreen(wx, wy);
        lastCursor.x = p.x;
        lastCursor.y = p.y;
```

- [ ] **Step 4: Drop the now-unused imports**

Remove `isoX,` and `isoY,` from the `@lions/render` import block at `packages/app/src/main.ts:23–24`. Leave `TILE_W` / `TILE_H` if they are imported and still used — check with:

```bash
grep -n "TILE_W\|TILE_H" packages/app/src/main.ts
```

- [ ] **Step 5: Verify no reach-throughs remain except the ticker**

```bash
grep -n "renderer\.app\|isoX\|isoY" packages/app/src/main.ts
```

Expected: exactly one line remains — `renderer.app.ticker.add` at ~1447. Task A4 removes it.

- [ ] **Step 6: Verify behaviour is unchanged**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm validate:ui
```

Then drive the real UI, because this touches the cursor readout and a passing type check proves nothing about where the pointer thinks it is:

```bash
pnpm dev
```

Open `http://localhost:5173/?sandbox=1`, wait for the map, and confirm in the console:

```js
__lions.goto(6, 23); __lions.sel([0]);
__lions.hover(800, 400);            // must still return a cursor key, e.g. "move-armour"
__lions.cursorKey();                 // must agree with it
```

Then click once on the map and re-run `__lions.cursorKey()` — it must still be the contextual cursor, not `default`. (That is the regression this repo shipped once already; see `cursor-ownership.ts`.)

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/main.ts
git commit -m "refactor(app): ask the renderer where things are, do not recompute it

main.ts held its own copy of the forward projection, built from exported
isoX/isoY plus the camera arithmetic. That is a second source of truth for
where a world point lands on screen, and in a 3D backend -- where the
projection IS the camera -- it would drift from the real one silently.

Also stops reaching through renderer.app for the canvas and the viewport
size. Behaviour is unchanged; verified by driving the sandbox, not only by
the type checker.

Refs issue 123."
```

---

## Task A4: The app owns its frame loop

**Files:**
- Modify: `packages/app/src/main.ts` (around line 1447)

**Interfaces:**
- Consumes: `Renderer.frame(alpha)` from Task A2.
- Produces: nothing new.

- [ ] **Step 1: Read what the ticker currently drives**

```bash
sed -n '1440,1470p' packages/app/src/main.ts
```

Record exactly what runs inside `renderer.app.ticker.add(...)` — the replacement must run the same work in the same order. Do not paraphrase it; move it.

- [ ] **Step 2: Replace the ticker with a `requestAnimationFrame` loop**

Substitute the `renderer.app.ticker.add(cb)` call with:

```ts
  // The app owns the frame loop, not the renderer.
  //
  // Pixi's ticker is backend-specific, and a renderer that schedules the
  // application's work is the wrong way round: the app decides when a frame
  // happens and asks the renderer to draw it. A three.js backend has no
  // ticker to offer at all.
  let rafId = 0;
  const loop = (): void => {
    rafId = requestAnimationFrame(loop);
    <the exact body that was inside ticker.add, unchanged>
  };
  rafId = requestAnimationFrame(loop);
```

Keep `rafId` in scope wherever teardown happens; if the app has a shutdown path, call `cancelAnimationFrame(rafId)` there. If it has none, leave the handle assigned and add no teardown — inventing a lifecycle this task does not need is scope creep.

- [ ] **Step 3: Verify no reach-through remains**

```bash
grep -n "renderer\.app" packages/app/src/main.ts
```

Expected: **no output.** Every one of the four leaks is now closed.

- [ ] **Step 4: Verify the game still runs at all**

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm dev
```

Open `http://localhost:5173/?sandbox=1`. This task can fail in exactly one visible way — the frame loop not running — and it fails totally, so the check is simply: do units animate and does the camera pan with the arrow keys? Confirm both.

Then confirm the loop is actually rAF-driven and not accidentally double-scheduled:

```js
let n = 0; const t0 = performance.now();
const id = requestAnimationFrame(function f() { n++; requestAnimationFrame(f); });
await new Promise(r => setTimeout(r, 1000));
n  // ~60 on a 60 Hz display. Wildly above that means two loops are running.
```

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main.ts
git commit -m "refactor(app): the app drives its own frame loop

Pixi's ticker is backend-specific, and a renderer that schedules the
application's work is the wrong way round -- the app decides when a frame
happens and asks the renderer to draw one. A three.js backend has no ticker
to offer.

This closes the last of the four places packages/app reached through the
renderer into PixiJS. \`grep 'renderer\.app' packages/app/src\` is now empty,
which is the whole of Phase A's deliverable: the app holds a Renderer, not a
PixiRenderer.

Refs issue 123."
```

---

## Task A5: Record what Phase A established

**Files:**
- Modify: `CLAUDE.md` (the "Package layout" section and the "Known scaling debts" list)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code depends on.

- [ ] **Step 1: Update the package-layout note**

In `CLAUDE.md`, the layout block currently reads `render/   Pixi renderer, VFX — imports sim types read-only`. Change to:

```
  render/   renderer + VFX — imports sim types read-only. `app` holds the
            `Renderer` interface (api.ts), never `PixiRenderer` directly, so a
            second backend is a new implementation rather than a rewrite.
```

- [ ] **Step 2: Add a dev-instruments line**

Under "Dev instruments", add:

```markdown
- The renderer is behind an interface (`packages/render/src/api.ts`). `app` may
  use only what that interface declares — `grep 'renderer\.app' packages/app/src`
  must stay empty, and projection is asked for (`renderer.worldToScreen`) rather
  than recomputed from `isoX`/`isoY`. The projection arithmetic itself is pure and
  tested in `project.ts`; `renderer.ts` re-exports its names for compatibility.
```

- [ ] **Step 3: Verify and commit**

```bash
pnpm validate:ui   # CLAUDE.md is not under a validate:ui root, but run the full gate anyway
pnpm typecheck && pnpm lint && pnpm test
git add CLAUDE.md
git commit -m "docs: the app holds a Renderer, not a PixiRenderer

Records the invariant Phase A creates, in the file that is actually read
before work starts. The grep is the enforceable half: an empty
\`renderer\.app\` in packages/app/src is what 'the seam holds' means.

Refs issue 123."
```

- [ ] **Step 4: Push**

```bash
git push -u origin feat/three-renderer
```

---

## Self-Review

**Spec coverage.** The spec's Phase 0 maps to Task 0.1. Phase A's four leak fixes map to A2 (`canvas`, `width`/`height`, `worldToScreen` members), A3 (app stops using `renderer.app` and `isoX`/`isoY`), and A4 (ticker). The spec's "conformance suite written against `PixiRenderer` first" is partly delivered: A1 and A2 test the projection contract, which is what can be tested without a GPU. **Gap, stated rather than hidden:** the spec also names `pickUnit` at known tiles, `isVisible` against fog, and mid-slope picking as conformance targets. Those need a constructed renderer and therefore a GPU, so they cannot run under `environment: 'node'`. They belong to Phase B's golden-image harness, and Phase B's plan must pick them up — this plan does not silently drop them.

**Placeholders.** One deliberate placeholder survives, in Task A4 Step 2: `<the exact body that was inside ticker.add, unchanged>`. It is deliberate because Step 1 requires reading that body first and the instruction is explicitly *move it, do not paraphrase it* — writing a guessed body here would be worse than naming the operation. Task 0.1's commit message likewise carries `<verdict and reasoning here>`, which cannot be known before the task runs.

**Type consistency.** `Camera` and `Viewport` are defined once in `project.ts` and imported everywhere else. `worldToScreen` has the same signature in `project.ts` (5 params, camera and viewport explicit) and on `Renderer` (3 params, camera and viewport implicit from the instance) — these are deliberately different functions, and `PixiRenderer.worldToScreen` imports the former under the alias `projectWorldToScreen` so the two names never collide. `screenToWorldFlat` is the pure half; `Renderer.screenToWorld` is the lift-approximating whole. Both names appear consistently in every task.

**Test counts.** Baseline 863. A1 adds 9 → 872. A2 adds 3 → 875. A3 and A4 add none. Any task reporting a different total has broken something and must stop rather than update the number.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-26-three-renderer-phase-0-and-a.md`.
