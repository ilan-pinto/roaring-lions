# Lit Renderer (Art Uplift Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light the three.js backend with one real sun, a map-wide shadow map, hemisphere bounce, sRGB/ACES output, antialiasing, pixel ratio 2 and a feathered fog-of-war post pass, retiring the per-pixel palette guarantee as a runtime rule.

**Architecture:** Every world object moves onto `THREE.MeshStandardMaterial` (flat ramp albedo for kit-built assets, the loader's own PBR material for Meshy bakes, a subclass with the six-slot albedo blend for the ground). `ThreeRenderer` gains scene lights, a persistent orthographic camera with a tight depth range, and an `EffectComposer` chain built in `init()` (RenderPass → FogOfWarPass → GTAOPass → OutputPass → SMAAPass). Fog of war becomes a feathered R8 texture sampled by world position in a depth-reading post pass; the muzzle flash becomes a pool of eight `PointLight`s.

**Tech Stack:** TypeScript strict, three.js 0.170 (`three/addons/postprocessing/*`), vitest (`environment: 'node'`, real three.js JS objects, no WebGL), Playwright (tools), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-14-lit-renderer-design.md`

## Global Constraints

- Branch `worktree-art-uplift` in worktree `/Users/ilpinto/dev/roaring-lions/.claude/worktrees/art-uplift` (from `main` @ `8db0215`). All paths below are relative to that root. Use `/usr/bin/git` by absolute path, one plain git command per Bash call (the rtk hook refuses compound git commands in worktrees).
- `three` may only be imported under `packages/render/src/three/**` (eslint). Addon subpaths (`three/addons/...`) are allowed there by discipline.
- `packages/render/src/renderer.ts` (Pixi) stays byte-identical. Nothing in this plan touches Pixi, `@lions/sim`, or any JSON under `data/`.
- No `any`. No non-null assertions in sim code (none is touched).
- Every task ends with `pnpm test` green (3638 tests at start), `pnpm typecheck` green, `pnpm lint` green. `pnpm test:determinism`, `pnpm playtest` and `pnpm balance` must be byte-identical to `main` at the end (renderer only).
- Constructor of `ThreeRenderer` stays free of WebGL calls: nine test files construct it against a `FakeWebGLRenderer` that has only `outputColorSpace`, `domElement`, `setClearColor`, `dispose`. Everything that needs a real context (pixel ratio, shadow map enable, the composer) lives in `init()`, which no test calls.
- Dev server for browser checks: run from THIS worktree with Bash in the background, `pnpm --filter @lions/app exec vite --port 5178 --strictPort --host 127.0.0.1`, then `navigate` the Browser pane to `http://127.0.0.1:5178/...`. Never `preview_start` (it serves the launch directory, not this worktree). Never kill a process you did not start (`pkill -f vite` has taken the lead's server down four times; do not run it).
- Numbers from the spec, verbatim: sun 135°/55° (render rig), sun : hemisphere 1.0 : 0.35 expressed as intensities 2.6 : 0.9, shadow map 4096², PCF soft, one map-wide box; AO radius 0.6 tile / scale 1.2; ACES / exposure 1.0; pixel ratio cap 2; fog never-seen 85% / explored 40% / feather 1.5 tiles; track alpha 0.35, life 180 s (unchanged).
- Two deliberate deviations from the spec text, both recorded in Task 15's spec edit: (1) antialiasing is `SMAAPass` on a single-sampled target rather than hardware MSAA 4×, because the fog pass reads the composer target's depth texture and a multisampled depth attachment would have to be resolved first; (2) ground albedo textures stay `NoColorSpace`, because the ground blend uses them as a ratio to their own byte mean (`mix(1, texel/mean, gain)`) and decoding them would move that mean off 1.
- ~~The `SUN_DIRECTION` sign pair is settled ON SCREEN in Task 9 step 7 against a billboard's baked lighting. Do not skip that step.~~ **SETTLED 2026-09-15 and NOT that way (Task 16).** A billboard's bake has no lit flank to compare against — the rig's lamp back-lights it — so that step cannot discriminate. The project lead ruled the spec's stated azimuth: `SUN_DIRECTION` is `(-0.406, 0.819, 0.406)`, a side light with X and Z differing in sign. See the spec's Deviations entry 3.

---

## File Structure

**Create**
- `packages/render/src/three/lighting.ts` — sun, hemisphere, shadow box. Pure construction, no renderer.
- `packages/render/src/three/lighting.test.ts`
- `packages/render/src/three/world-materials.ts` — `liftTone`, `rampMaterial`, `texturedMaterial`, `texturedMapMaterial`, `WORLD_ROUGHNESS`.
- `packages/render/src/three/world-materials.test.ts`
- `packages/render/src/three/post-chain.ts` — `createPostChain` (composer, passes, resize, render, dispose).
- `packages/render/src/three/post-chain.test.ts`
- `packages/render/src/three/shroud-texture.ts` — fog levels → feathered R8 `DataTexture`.
- `packages/render/src/three/shroud-texture.test.ts`
- `packages/render/src/three/fog-pass.ts` — the depth-reading fog-of-war pass.
- `packages/render/src/three/fog-pass.test.ts`
- `tools/src/perf/art-captures.ts` — the nine repeatable captures.

**Modify**
- `packages/render/src/three/camera.ts` — persistent camera, depth range.
- `packages/render/src/three/terrain/shared.ts` — `srgbToLinear`, `hexToLinear`.
- `packages/render/src/three/terrain/mesh.ts` — `toGeometry` linear colours + normals; `GroundMaterial`, `GroveMaterial`, `vertexColorMaterial` replace the three shader materials.
- `packages/render/src/three/units/mesh-unit.ts`, `mesh-vehicle.ts`, `mesh-building.ts`, `mesh-death.ts` — standard materials, shadow flags, opacity fade.
- `packages/render/src/three/terrain/decor-mesh.ts`, `decor-textured-mesh.ts`, `textured-decor.ts` — standard materials.
- `packages/render/src/three/units/textured-building.ts` — list only.
- `packages/render/src/three/flash-light.ts` — `PointLight` pool.
- `packages/render/src/three/vehicle-tracks.ts` — alpha.
- `packages/render/src/three/units/atlas.ts`, `units/structures.ts` — sRGB tagging.
- `packages/render/src/three/units/overlays.ts`, `units/fx.ts`, `trail-mesh.ts`, `smoke-mesh.ts`, `vehicle-tracks.ts` — `hexToLinear`.
- `packages/render/src/three/ThreeRenderer.ts` — lights, camera, pipeline, composer, fog, flash, shadows, size getters.
- `packages/render/src/three/units/render-order.ts` — fog band retired.
- `tools/vehicles/textured.py`, `tools/export_mesh_building.py` — map policy.
- `tools/src/golden-diff/baseline.ts` — re-measured floors.
- `docs/PERFORMANCE.md`, `CLAUDE.md`, `docs/ART_PIPELINE.md`, `docs/superpowers/specs/2026-09-14-lit-renderer-design.md`.

**Delete**
- `packages/render/src/three/palette-material.ts` (+ `.test.ts`, `.coursing.test.ts`)
- `packages/render/src/three/units/mesh-material.ts` (+ `.test.ts`)
- `packages/render/src/three/fog-mesh.ts` (+ `.test.ts`)
- `packages/render/src/three/unit-shadows.ts` (+ `.test.ts`)

---

### Task 1: Scene lights and the shadow box

**Files:**
- Create: `packages/render/src/three/lighting.ts`
- Test: `packages/render/src/three/lighting.test.ts`

**Interfaces:**
- Produces: `SUN_DIRECTION: THREE.Vector3`, `SUN_INTENSITY`, `HEMISPHERE_INTENSITY`, `SHADOW_MAP_SIZE`, `SHADOW_MARGIN_TILES`, `interface SceneLights { sun: THREE.DirectionalLight; hemisphere: THREE.HemisphereLight; addTo(scene: THREE.Object3D): void; dispose(): void }`, `createSceneLights(width: number, height: number): SceneLights`, `shadowBoxRadius(width, height): number`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/render/src/three/lighting.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  SUN_DIRECTION,
  SUN_INTENSITY,
  HEMISPHERE_INTENSITY,
  SHADOW_MAP_SIZE,
  createSceneLights,
  shadowBoxRadius,
} from './lighting';

/** Clip-space position of a world point as the sun's shadow camera sees it. */
function shadowClip(sun: THREE.DirectionalLight, p: THREE.Vector3): THREE.Vector3 {
  const cam = sun.shadow.camera;
  return p.clone().applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
}

function scene(width: number, height: number) {
  const s = new THREE.Scene();
  const lights = createSceneLights(width, height);
  lights.addTo(s);
  s.updateMatrixWorld(true);
  lights.sun.shadow.updateMatrices(lights.sun);
  return { s, lights };
}

describe('lighting', () => {
  // SUPERSEDED 2026-09-15 -- this assertion shipped and was then REPLACED. The
  // sun is a side light, `(-0.406, 0.819, 0.406)`, and its X and Z signs
  // DIFFER on purpose; the live test pins all three components and asserts
  // exactly that. Kept here as written because this file is the plan as it
  // was executed, not the current contract.
  it('sun direction is a unit vector pointing up, on the camera side of the map', () => {
    expect(SUN_DIRECTION.length()).toBeCloseTo(1, 6);
    expect(SUN_DIRECTION.y).toBeGreaterThan(0.5);
    // Task 9 step 7 may flip both signs together; they must always agree.
    expect(Math.sign(SUN_DIRECTION.x)).toBe(Math.sign(SUN_DIRECTION.z));
  });

  it('sun : hemisphere is the spec ratio (2.6 : 0.9)', () => {
    expect(SUN_INTENSITY).toBe(2.6);
    expect(HEMISPHERE_INTENSITY).toBe(0.9);
    expect(SHADOW_MAP_SIZE).toBe(4096);
  });

  it('adds exactly one directional and one hemisphere light, plus the sun target', () => {
    const { s, lights } = scene(48, 48);
    expect(s.children.filter((c) => (c as THREE.Light).isLight)).toHaveLength(2);
    expect(s.children).toContain(lights.sun.target);
    expect(lights.sun.castShadow).toBe(true);
    expect(lights.sun.shadow.mapSize.x).toBe(SHADOW_MAP_SIZE);
  });

  it.each([
    [48, 48],
    [64, 64],
    [48, 96],
  ])('shadow box contains every tile corner of a %dx%d map from -1 to +6 world units up', (w, h) => {
    const { lights } = scene(w, h);
    for (const y of [-1, 0, 3, 6]) {
      for (const [x, z] of [
        [0, 0],
        [w, 0],
        [0, h],
        [w, h],
        [w / 2, h / 2],
      ]) {
        const c = shadowClip(lights.sun, new THREE.Vector3(x, y, z));
        expect(Math.abs(c.x), `x at ${x},${y},${z}`).toBeLessThan(1);
        expect(Math.abs(c.y), `y at ${x},${y},${z}`).toBeLessThan(1);
        expect(Math.abs(c.z), `z at ${x},${y},${z}`).toBeLessThan(1);
      }
    }
  });

  it('shadow box radius is half the map diagonal plus the margin', () => {
    expect(shadowBoxRadius(48, 48)).toBeCloseTo(Math.hypot(24, 24) + 2, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/render/src/three/lighting.test.ts`
Expected: FAIL — `Cannot find module './lighting'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/render/src/three/lighting.ts
// SUPERSEDED 2026-09-15: this snippet's `SUN_DIRECTION` and the derivation in
// its header are BOTH retired. The shipped vector is `(-0.406, 0.819, 0.406)`
// -- the rig's stated azimuth 135 (= the camera's LEFT) rather than its lamp's
// actual beam, which points from 45 and back-lights every sprite sheet. Read
// the live `lighting.ts` header, not this. Kept verbatim because this file
// records the plan as it was executed.
/**
 * The scene's light: one sun, one sky/ground bounce, one map-wide shadow box.
 *
 * Phase 0 of the art uplift (docs/superpowers/specs/2026-09-14-lit-renderer-
 * design.md §2-3). Before this file the backend had NO lights: every
 * material quantised its own N·L against a private `uLightDir`, and the
 * three colour systems on screen disagreed on where the sun was.
 *
 * `SUN_DIRECTION` is the render rig's own sun (`tools/dimetric.py`
 * `build_lights`, azimuth 135°, altitude 55°) carried into three's frame:
 * Blender's beam `(-0.406, -0.406, -0.819)` (X, Y, Z-up) points AWAY from
 * the sun, so the to-sun vector is `(0.406, 0.406, 0.819)`, and with tile
 * x -> world X, tile y -> world Z, Blender Y -> world Z, that is
 * `(0.406, 0.819, 0.406)`. Its XZ sign pair (+, +) puts the sun on the same
 * side of the map as the camera (`camera.ts` `VIEW_DIRECTION`), i.e. the
 * faces the camera sees are the lit ones -- which is what a sprite sheet
 * rendered by that rig shows, and what Task 9 verifies on screen against a
 * billboard before the vector is trusted.
 */
import * as THREE from 'three';

export const SUN_DIRECTION = new THREE.Vector3(0.406, 0.819, 0.406).normalize();
/** ACES needs headroom: 2.6 lands a `limestone.0` wall facing the sun at
 *  roughly its authored brightness after tone mapping. Tune by eye only
 *  against that property (spec §1). */
export const SUN_INTENSITY = 2.6;
export const HEMISPHERE_INTENSITY = 0.9;
/** Palette keys, resolved by the caller: `limestone.0` sun, `water.0` sky,
 *  `dust.4` ground. Hex fallbacks are those entries as of 2026-09-14. */
export const SUN_COLOR_HEX = '#F2E8D5';
export const SKY_COLOR_HEX = '#A9C4D1';
export const GROUND_BOUNCE_COLOR_HEX = '#96703C';
export const SHADOW_MAP_SIZE = 4096;
/** World units beyond the map edge the shadow box covers, so a unit standing
 *  on the last tile still casts onto the ground beside it. */
export const SHADOW_MARGIN_TILES = 2;
/** The tallest thing the box must contain: a building roof (< 4 world units)
 *  over elevation level 9 (~2.3). Rounded up. */
export const SHADOW_BOX_TOP = 8;
export const SHADOW_BOX_BOTTOM = -1;

export interface SceneLights {
  readonly sun: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;
  addTo(scene: THREE.Object3D): void;
  dispose(): void;
}

/** Half the map diagonal plus the margin: a box this wide, centred on the map
 *  and oriented along the sun, covers the whole map at any sun azimuth. */
export function shadowBoxRadius(width: number, height: number): number {
  return Math.hypot(width / 2, height / 2) + SHADOW_MARGIN_TILES;
}

export function createSceneLights(width: number, height: number): SceneLights {
  const centre = new THREE.Vector3(width / 2, 0, height / 2);
  const r = shadowBoxRadius(width, height);

  const sun = new THREE.DirectionalLight(new THREE.Color(SUN_COLOR_HEX), SUN_INTENSITY);
  sun.position.copy(centre).addScaledVector(SUN_DIRECTION, r * 2);
  sun.target.position.copy(centre);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  const cam = sun.shadow.camera;
  cam.left = -r;
  cam.right = r;
  cam.top = r;
  cam.bottom = -r;
  // The box is oriented along the sun and centred r*2 away, so the map's
  // vertical extent projects onto the sun axis at most r*2 +/- (r + top).
  cam.near = 1;
  cam.far = r * 4;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;

  const hemisphere = new THREE.HemisphereLight(
    new THREE.Color(SKY_COLOR_HEX),
    new THREE.Color(GROUND_BOUNCE_COLOR_HEX),
    HEMISPHERE_INTENSITY
  );

  return {
    sun,
    hemisphere,
    addTo(scene) {
      scene.add(sun, sun.target, hemisphere);
    },
    dispose() {
      sun.dispose();
      hemisphere.dispose();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/render/src/three/lighting.test.ts`
Expected: PASS (5 tests). If the shadow-box test fails on `z`, widen `cam.far` — the map's far corner along the sun axis is `r*2 + r + SHADOW_BOX_TOP`, under `r*4` for every map ≥ 8 tiles.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/render/src/three/lighting.ts packages/render/src/three/lighting.test.ts
/usr/bin/git commit -m "feat(render): scene lights -- one sun, one hemisphere, a map-wide shadow box

Phase 0 of the art uplift. Pure construction, no renderer touched yet.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: A persistent camera with a tight depth range

**Files:**
- Modify: `packages/render/src/three/camera.ts:60-105`
- Test: `packages/render/src/three/camera.test.ts` (append)

**Interfaces:**
- Consumes: `Camera`, `Viewport` from `../project`.
- Produces: `updateDimetricCamera(cam: Camera, vp: Viewport, camera: THREE.OrthographicCamera): THREE.OrthographicCamera` (mutates and returns `camera`); `CAMERA_NEAR = 1`, `CAMERA_FAR = 300`; `dimetricCamera` unchanged in signature.

- [ ] **Step 1: Write the failing test** (append to `camera.test.ts`)

```ts
describe('updateDimetricCamera', () => {
  it('reuses one camera instance and matches a fresh dimetricCamera for the same input', () => {
    const persistent = new THREE.OrthographicCamera();
    const vp = { width: 1440, height: 900 };
    for (const cam of [
      { x: 5, y: 22, zoom: 2.5 },
      { x: 24, y: 24, zoom: 0.5 },
    ]) {
      const a = updateDimetricCamera(cam, vp, persistent);
      const b = dimetricCamera(cam, vp);
      expect(a).toBe(persistent);
      expect(a.projectionMatrix.toArray()).toEqual(b.projectionMatrix.toArray());
      expect(a.matrixWorld.toArray()).toEqual(b.matrixWorld.toArray());
    }
  });

  it('near/far bracket a 64x64 map with 8 units of height from any target on it', () => {
    expect(CAMERA_NEAR).toBe(1);
    expect(CAMERA_FAR).toBe(300);
    const vp = { width: 1440, height: 900 };
    for (const [tx, ty] of [
      [0, 0],
      [64, 64],
      [32, 32],
      [0, 64],
    ]) {
      const cam = dimetricCamera({ x: tx, y: ty, zoom: 1 }, vp);
      for (const [x, z] of [
        [0, 0],
        [64, 0],
        [0, 64],
        [64, 64],
      ]) {
        for (const y of [-1, 8]) {
          const ndc = new THREE.Vector3(x, y, z).project(cam);
          expect(Math.abs(ndc.z), `depth of ${x},${y},${z} from target ${tx},${ty}`).toBeLessThan(1);
        }
      }
    }
  });
});
```

Add to the file's imports: `import { dimetricCamera, updateDimetricCamera, CAMERA_NEAR, CAMERA_FAR } from './camera';` (keep whatever it already imports).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/render/src/three/camera.test.ts`
Expected: FAIL — `updateDimetricCamera` is not exported.

- [ ] **Step 3: Write the implementation**

In `camera.ts`, replace the `CAMERA_DISTANCE` constant and the `dimetricCamera` function body:

```ts
/** Orthographic projection depends only on view direction, not distance, so
 *  this only has to keep the whole map in front of the camera: the far
 *  corner of a 64x64 map is ~45 world units from its centre along
 *  `VIEW_DIRECTION`, and a roof is under 8 up. 120 puts every depth in
 *  [~70, ~170]. It was 10,000 with far at 20,000 -- a 20,000-unit range for a
 *  50-unit scene, which starved the depth buffer the AO and fog passes read
 *  (spec §5). */
const CAMERA_DISTANCE = 120;
export const CAMERA_NEAR = 1;
export const CAMERA_FAR = 300;

/**
 * Configure `camera` in place for the given pan/zoom and viewport and return
 * it. `ThreeRenderer` keeps ONE camera and calls this every frame: the post
 * passes and the AO pass hold a camera reference, so a fresh instance per
 * frame would leave them pointed at last frame's object.
 */
export function updateDimetricCamera(
  cam: Camera,
  vp: Viewport,
  camera: THREE.OrthographicCamera
): THREE.OrthographicCamera {
  const target = new THREE.Vector3(cam.x, 0, cam.y);
  const halfWidth = vp.width / (TILE_W * cam.zoom * Math.SQRT2);
  const halfHeight = (vp.height * SIN_EL) / (TILE_H * cam.zoom * Math.SQRT2);
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.near = CAMERA_NEAR;
  camera.far = CAMERA_FAR;
  camera.position.copy(target).addScaledVector(VIEW_DIRECTION, CAMERA_DISTANCE);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

export function dimetricCamera(cam: Camera, vp: Viewport): THREE.OrthographicCamera {
  return updateDimetricCamera(cam, vp, new THREE.OrthographicCamera());
}
```

Keep every doc comment above `dimetricCamera` that explains the halfWidth/halfHeight derivation; move it above `updateDimetricCamera`.

- [ ] **Step 4: Run the whole render test suite**

Run: `pnpm vitest run packages/render`
Expected: PASS. `worldToScreenThree`/`screenToWorldThree` build their own camera through `dimetricCamera` and are unaffected by distance (orthographic). If a silhouette or pick test pins a depth value derived from the old 10,000, update the expected value and say so in the commit.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/render/src/three/camera.ts packages/render/src/three/camera.test.ts
/usr/bin/git commit -m "feat(render): persistent dimetric camera, depth range 1-300

CAMERA_DISTANCE 10000 -> 120 with near 1 / far 300: a 50-unit scene no longer
spans a 20,000-unit depth buffer. updateDimetricCamera configures one camera
in place so the post passes can hold a reference.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Linear vertex colours and normals for terrain geometry

**Files:**
- Modify: `packages/render/src/three/terrain/shared.ts:86-94`
- Modify: `packages/render/src/three/terrain/mesh.ts:36-56` (`toGeometry`)
- Test: `packages/render/src/three/terrain/shared.test.ts` (append), `packages/render/src/three/terrain/mesh.test.ts` (update)

**Interfaces:**
- Produces: `srgbToLinear(c: number): number`, `hexToLinear(hex: string): [number, number, number]` in `shared.ts`; `toGeometry(data: MeshData, opts?: { normals?: 'up' | 'compute' })` — the `color` attribute is linear, there is no `litColor` attribute, and a geometry with no `data.normals` gets either all-up normals (default) or computed ones.
- Consumes: `hexToUnit` (unchanged, still sRGB bytes/255 — the pure builders and `terrain-parity.test.ts` keep asserting palette bytes on `MeshData.colors`).

- [ ] **Step 1: Write the failing tests**

Append to `shared.test.ts`:

```ts
describe('srgbToLinear / hexToLinear', () => {
  it('decodes the sRGB transfer curve (0, mid grey, white)', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 9);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 5);
    expect(srgbToLinear(0.04)).toBeCloseTo(0.04 / 12.92, 9);
  });
  it('hexToLinear agrees with three.js Color (ColorManagement on)', () => {
    const [r, g, b] = hexToLinear('#C8B494');
    const c = new THREE.Color('#C8B494');
    expect(r).toBeCloseTo(c.r, 6);
    expect(g).toBeCloseTo(c.g, 6);
    expect(b).toBeCloseTo(c.b, 6);
  });
});
```

(`shared.test.ts` may not import three yet: add `import * as THREE from 'three';` and `srgbToLinear, hexToLinear` to its `./shared` import.)

Append to `mesh.test.ts`:

```ts
describe('toGeometry colour space and normals', () => {
  const data = (): MeshData => ({
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    colors: Float32Array.from([200 / 255, 180 / 255, 148 / 255, 1, 1, 1, 0, 0, 0]),
    indices: Uint32Array.from([0, 1, 2]),
  });
  it('writes LINEAR vertex colours from the builders sRGB bytes and no litColor', () => {
    const g = toGeometry(data());
    const c = g.getAttribute('color');
    expect(c.getX(0)).toBeCloseTo(srgbToLinear(200 / 255), 6);
    expect(c.getX(1)).toBeCloseTo(1, 6);
    expect(c.getX(2)).toBe(0);
    expect(g.getAttribute('litColor')).toBeUndefined();
  });
  it('gives a normal-less mark an up normal by default', () => {
    const n = toGeometry(data()).getAttribute('normal');
    expect(n.count).toBe(3);
    expect([n.getX(0), n.getY(0), n.getZ(0)]).toEqual([0, 1, 0]);
  });
  it('computes face normals on request', () => {
    const n = toGeometry(data(), { normals: 'compute' }).getAttribute('normal');
    // The triangle (0,0,0)-(1,0,0)-(0,0,1) lies in the XZ plane: its normal is +/-Y.
    expect(Math.abs(n.getY(0))).toBeCloseTo(1, 6);
  });
  it('keeps authored normals verbatim', () => {
    const d = data();
    d.normals = Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const n = toGeometry(d, { normals: 'compute' }).getAttribute('normal');
    expect(n.getZ(0)).toBe(1);
  });
});
```

(Check `MeshData` in `terrain/types.ts` for the exact required fields — `positions`, `colors`, `indices` are the three every builder writes; if `indices` is `Uint16Array` there, use that.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/render/src/three/terrain/shared.test.ts packages/render/src/three/terrain/mesh.test.ts`
Expected: FAIL — `srgbToLinear` not exported; `litColor` attribute is defined; `normal` undefined.

- [ ] **Step 3: Write the implementation**

In `shared.ts`, after `hexToUnit`:

```ts
/** The sRGB electro-optical transfer function, one channel. Vertex colours
 *  and shader uniforms must be LINEAR now that the output pass encodes to
 *  sRGB (spec §1): a palette hex fed in raw would be encoded twice and land
 *  brighter than authored. `hexToUnit` stays sRGB for the pure builders,
 *  whose `MeshData.colors` are still asserted against palette bytes. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexToLinear(hex: string): [number, number, number] {
  const [r, g, b] = hexToUnit(hex);
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}
```

In `mesh.ts`, replace `toGeometry`:

```ts
export interface GeometryOptions {
  /** What to do when `data.normals` is absent: `'up'` (default) writes
   *  (0, 1, 0) for every vertex -- right for flat ground marks and canopy
   *  billboards, which should light like the ground they stand on;
   *  `'compute'` derives face normals -- right for the extruded structure
   *  boxes, whose walls must shade as walls. */
  normals?: 'up' | 'compute';
}

export function toGeometry(data: MeshData, opts: GeometryOptions = {}): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  const linear = new Float32Array(data.colors.length);
  for (let i = 0; i < linear.length; i++) linear[i] = srgbToLinear(data.colors[i]);
  geometry.setAttribute('color', new THREE.BufferAttribute(linear, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  if (data.sway) geometry.setAttribute('sway', new THREE.BufferAttribute(data.sway, 1));
  if (data.normals) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  } else if ((opts.normals ?? 'up') === 'compute') {
    geometry.computeVertexNormals();
  } else {
    const up = new Float32Array(data.positions.length);
    for (let i = 1; i < up.length; i += 3) up[i] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(up, 3));
  }
  if (data.sandMask) geometry.setAttribute('sandMask', new THREE.BufferAttribute(data.sandMask, 1));
  if (data.rockMask) geometry.setAttribute('rockMask', new THREE.BufferAttribute(data.rockMask, 1));
  if (data.roadMask) geometry.setAttribute('roadMask', new THREE.BufferAttribute(data.roadMask, 1));
  if (data.roadAxis) geometry.setAttribute('roadAxis', new THREE.BufferAttribute(data.roadAxis, 1));
  if (data.scrubMask) geometry.setAttribute('scrubMask', new THREE.BufferAttribute(data.scrubMask, 1));
  if (data.groveMask) geometry.setAttribute('groveMask', new THREE.BufferAttribute(data.groveMask, 1));
  if (data.knollMask) geometry.setAttribute('knollMask', new THREE.BufferAttribute(data.knollMask, 1));
  if (data.groundUv) geometry.setAttribute('groundUv', new THREE.BufferAttribute(data.groundUv, 2));
  return geometry;
}
```

Add `import { srgbToLinear } from './shared';` to `mesh.ts`. Delete the `litColor` line and the comment block above `toGeometry` that describes `litColor`. In `ThreeRenderer.rebuildTerrain` (line ~5782) change the structure-box call to `toGeometry(box.mesh, { normals: 'compute' })`.

- [ ] **Step 4: Run the render tests and fix the ones that pinned the old attribute**

Run: `pnpm vitest run packages/render`
Expected: the new tests pass; any existing `mesh.test.ts`/`ground.test.ts`/`grove.test.ts` assertion of the form `getAttribute('litColor')` or `getAttribute('color').getX(i) === data.colors[i]` fails. Update each to `srgbToLinear(data.colors[i])` or delete the `litColor` assertion; the builders' own `MeshData.colors` assertions stay untouched. `packages/app/src/terrain-parity.test.ts` reads `MeshData.colors` from the builders, not the geometry, and stays green.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/render/src/three/terrain/shared.ts packages/render/src/three/terrain/shared.test.ts packages/render/src/three/terrain/mesh.ts packages/render/src/three/terrain/mesh.test.ts packages/render/src/three/ThreeRenderer.ts
/usr/bin/git commit -m "feat(render): terrain geometry carries linear vertex colours and normals

toGeometry decodes the builders' sRGB palette bytes to linear for the GPU
(the output pass encodes to sRGB now), drops litColor, and gives every mark
a normal: up by default, computed for the extruded structure boxes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The world materials module

**Files:**
- Create: `packages/render/src/three/world-materials.ts`
- Test: `packages/render/src/three/world-materials.test.ts`

**Interfaces:**
- Produces: `WORLD_ROUGHNESS = 0.85`; `liftTone(ramp: readonly string[]): string`; `rampMaterial(ramp): THREE.MeshStandardMaterial`; `texturedMaterial(loaded: THREE.Material): THREE.MeshStandardMaterial` (normalises the GLTFLoader material in place, or wraps a `map`-carrying non-standard material); `texturedMapMaterial(map: THREE.Texture): THREE.MeshStandardMaterial`; `prepareTexturedMap(map): THREE.Texture` (sRGB + mipmaps — the OLD function's name, NEW behaviour, so the two decor/building call sites need no rename).

- [ ] **Step 1: Write the failing test**

```ts
// packages/render/src/three/world-materials.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  WORLD_ROUGHNESS,
  liftTone,
  rampMaterial,
  texturedMaterial,
  texturedMapMaterial,
  prepareTexturedMap,
} from './world-materials';

const OLIVE = ['#8F9464', '#6E7449', '#4E5433', '#333821'];

describe('liftTone', () => {
  it('picks the lit face of a ramp: index 1 of three or more steps, index 0 of fewer', () => {
    expect(liftTone(OLIVE)).toBe('#6E7449');
    expect(liftTone(['#A9C4D1', '#4E7186'])).toBe('#A9C4D1');
    expect(liftTone(['#C78773'])).toBe('#C78773');
    expect(() => liftTone([])).toThrow(/empty/);
  });
});

describe('rampMaterial', () => {
  it('is a lit standard material carrying the lifted tone as a linear colour', () => {
    const m = rampMaterial(OLIVE);
    expect(m).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(m.color.getHexString().toUpperCase()).toBe('6E7449');
    expect(m.roughness).toBe(WORLD_ROUGHNESS);
    expect(m.metalness).toBe(0);
  });
});

describe('texturedMaterial', () => {
  it('keeps the loader material and its map, tags the map sRGB, and zeroes metalness with no metalness map', () => {
    const loaded = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    loaded.metalness = 1; // GLTFLoader's default metallicFactor
    const m = texturedMaterial(loaded);
    expect(m).toBe(loaded);
    expect(m.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(m.metalness).toBe(0);
    expect(m.roughness).toBe(WORLD_ROUGHNESS);
    expect(m.envMapIntensity).toBe(0);
  });
  it('leaves metalness and roughness alone when the GLB carries the maps (Phase 0b re-export)', () => {
    const loaded = new THREE.MeshStandardMaterial({
      map: new THREE.Texture(),
      metalnessMap: new THREE.Texture(),
      roughnessMap: new THREE.Texture(),
      normalMap: new THREE.Texture(),
    });
    loaded.metalness = 1;
    loaded.roughness = 1;
    const m = texturedMaterial(loaded);
    expect(m.metalness).toBe(1);
    expect(m.roughness).toBe(1);
    expect(m.normalMap).not.toBeNull();
  });
  it('wraps a non-standard material that carries a map (KHR_materials_unlit)', () => {
    const map = new THREE.Texture();
    const m = texturedMaterial(new THREE.MeshBasicMaterial({ map }));
    expect(m).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(m.map).toBe(map);
  });
  it('refuses a material with no map -- that is a palette asset, not a textured one', () => {
    expect(() => texturedMaterial(new THREE.MeshStandardMaterial())).toThrow(/no base colour map/);
  });
});

describe('texturedMapMaterial / prepareTexturedMap', () => {
  it('builds a lit material around a bare map with mipmaps and sRGB', () => {
    const m = texturedMapMaterial(new THREE.Texture());
    expect(m.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(m.map?.generateMipmaps).toBe(true);
    expect(m.map?.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(m.roughness).toBe(WORLD_ROUGHNESS);
  });
  it('prepareTexturedMap tags sRGB (the reverse of what the retired palette pipeline did)', () => {
    const map = new THREE.Texture();
    map.colorSpace = THREE.NoColorSpace;
    expect(prepareTexturedMap(map).colorSpace).toBe(THREE.SRGBColorSpace);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/render/src/three/world-materials.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/render/src/three/world-materials.ts
/**
 * Every world object's material, in one place (spec §4).
 *
 * Before Phase 0 there were three: a toon ramp indexed by normal
 * (`palette-material.ts`), a photo bake under a 3-band 30% shade
 * (`textured-building.ts`) and a vertex-colour pass-through for terrain.
 * None of them consumed three.js's lights, so nothing could cast or receive
 * a shadow, and each carried its own private sun. All three are now
 * `MeshStandardMaterial`, lit by `lighting.ts`'s one sun.
 *
 * A kit-built asset keeps its palette identity: `liftTone` picks the ramp's
 * LIT step as a flat albedo, and the darker steps that used to be shade
 * bands are what the sun and ambient occlusion now produce. A Meshy asset
 * keeps the material `GLTFLoader` built for it -- "use as-is" is finally
 * literal, and a re-export that ships metalness/roughness/normal maps
 * (spec §8) is consumed with no change here.
 */
import * as THREE from 'three';

export const WORLD_ROUGHNESS = 0.85;

/** The lit face of a ramp: index 1 of a ramp with three or more steps
 *  (index 0 is the lightest, `data/palette.json`'s own convention), index 0
 *  of a shorter one. */
export function liftTone(ramp: readonly string[]): string {
  if (ramp.length === 0) throw new Error('liftTone: empty ramp');
  return ramp.length >= 3 ? ramp[1] : ramp[0];
}

export function rampMaterial(ramp: readonly string[]): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(liftTone(ramp)),
    roughness: WORLD_ROUGHNESS,
    metalness: 0,
  });
}

/** A base-colour map is a photograph: sRGB, mipmapped (a 2048 bake is drawn
 *  at ~40 px at zoom 0.35), repeat-safe. */
export function prepareTexturedMap(map: THREE.Texture): THREE.Texture {
  map.colorSpace = THREE.SRGBColorSpace;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}

/**
 * Normalise the material `GLTFLoader` built for a textured asset and hand it
 * back. Metalness defaults to `metallicFactor` 1 in glTF; with no metalness
 * map and no environment map that renders black, so a bake that ships only
 * `base_color` is treated as dielectric. A bake that ships the maps keeps
 * its own factors.
 */
export function texturedMaterial(loaded: THREE.Material): THREE.MeshStandardMaterial {
  const withMap = loaded as THREE.Material & { map?: THREE.Texture | null };
  const map = withMap.map ?? null;
  if (!map) throw new Error(`texturedMaterial: ${loaded.type} has no base colour map`);
  const std = (loaded as THREE.MeshStandardMaterial).isMeshStandardMaterial
    ? (loaded as THREE.MeshStandardMaterial)
    : new THREE.MeshStandardMaterial({ map });
  prepareTexturedMap(map);
  if (!std.metalnessMap) std.metalness = 0;
  if (!std.roughnessMap) std.roughness = WORLD_ROUGHNESS;
  std.envMapIntensity = 0;
  std.needsUpdate = true;
  return std;
}

export function texturedMapMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: prepareTexturedMap(map),
    roughness: WORLD_ROUGHNESS,
    metalness: 0,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/render/src/three/world-materials.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/render/src/three/world-materials.ts packages/render/src/three/world-materials.test.ts
/usr/bin/git commit -m "feat(render): world-materials -- lit standard materials for ramp and textured assets

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Units, vehicles and buildings on lit materials

**Files:**
- Modify: `packages/render/src/three/units/mesh-unit.ts:84-120`
- Modify: `packages/render/src/three/units/mesh-vehicle.ts:212-262`
- Modify: `packages/render/src/three/units/mesh-building.ts:88-132`
- Modify: `packages/render/src/three/units/mesh-death.ts:141-210`
- Modify: `packages/render/src/three/ThreeRenderer.ts` — the four `flashLights.register(material as THREE.ShaderMaterial)` calls at lines ~3397, ~3443, ~3579, ~3646.
- Test: `packages/render/src/three/units/mesh-unit.test.ts`, `mesh-vehicle.test.ts`, `mesh-building.test.ts`, `mesh-death.test.ts`, `textured-building.test.ts` (update)

**Interfaces:**
- Consumes: `rampMaterial`, `texturedMaterial` from `../world-materials`.
- Produces: every mesh in a unit/vehicle/building template has `castShadow = true`, `receiveShadow = true`, and a `MeshStandardMaterial`; `MeshFadeSwap.fade` is typed `THREE.Material` and `setMeshDeathOpacity` writes `fade.opacity`.

- [ ] **Step 1: Update the tests first**

In `mesh-unit.test.ts`, the test titled `'assigns one toon-ramp material per role and scales the root by MESH_SCALE'` becomes:

```ts
  it('assigns one lit standard material per role, shadows on, and scales the root by MESH_SCALE', async () => {
    const gltf = await parseFixture({ roleName: 'uniform', clipName: 'move' });
    const template = buildMeshUnitTemplate(gltf, 'kdf');
    expect(template.materials).toHaveLength(1);
    const m = template.materials[0] as THREE.MeshStandardMaterial;
    expect(m.isMeshStandardMaterial).toBe(true);
    expect(m.color.getHexString().toUpperCase()).toBe(liftTone(rampForRole('uniform', 'kdf')).slice(1).toUpperCase());
    template.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
    });
    expect(template.root.scale.x).toBeCloseTo(MESH_SCALE, 9);
  });
```

Add imports: `import { liftTone } from '../world-materials'; import { rampForRole } from './mesh-role';`. Keep the rest of the file; delete any assertion that reads `uniforms.uRamp` or `uSteps` (they no longer exist) and replace it with the `color` assertion above.

In `mesh-vehicle.test.ts` and `mesh-building.test.ts`: same treatment — every `toBeInstanceOf(THREE.ShaderMaterial)` / `uniforms.uRamp` assertion becomes `isMeshStandardMaterial === true` plus the `color` check via `liftTone(rampForVehicleRole(id, role))` / `liftTone(rampForBuildingRole(role, wallKey))`; every textured-branch assertion that expected a NEW `ShaderMaterial` (`not.toBe(loaded)`) becomes `toBe(loaded)` with `map.colorSpace === SRGBColorSpace`; add `castShadow`/`receiveShadow` checks like the unit test.

In `textured-building.test.ts`: delete the `prepareTexturedMap` and `texturedBuildingMaterial` describes (the module keeps only the list); keep the `TEXTURED_BUILDING_TYPES` parity-with-Python test.

In `mesh-death.test.ts`: any assertion on `fade.uniforms.uOpacity.value` becomes `fade.opacity`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run packages/render/src/three/units`
Expected: FAIL on the updated assertions (materials are still `ShaderMaterial`).

- [ ] **Step 3: Implement**

`mesh-unit.ts`:
```ts
import { rampMaterial } from '../world-materials';
// ...inside buildMeshUnitTemplate's traverse, replacing the toonRampSkinnedMaterial line:
    const mat = rampMaterial(rampForRole(role, faction));
    mesh.material = mat;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = HULL_RENDER_ORDER;
```
Remove the `toonRampSkinnedMaterial` import.

`mesh-vehicle.ts` textured branch and ramp branch:
```ts
import { rampMaterial, texturedMaterial } from '../world-materials';
// textured branch:
    if (loadedMap) {
      if (!allowTextured) {
        smuggled.add(role || '(unnamed mesh)');
        return;
      }
      const textured = texturedMaterial(loaded as THREE.Material);
      mesh.material = textured;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.renderOrder = renderOrderForPart(mesh.name);
      materials.push(textured);
      geometries.push(mesh.geometry);
      return;
    }
// ramp branch:
    const mat = rampMaterial(rampForVehicleRole(vehicleId, role));
    mesh.material = mat;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = renderOrderForPart(mesh.name);
```
Remove the `loaded?.dispose()` line in the textured branch (the loader material is kept now) and the `texturedBuildingMaterial`/`toonRampMaterial` imports.

`mesh-building.ts`: identical shape — textured branch `texturedMaterial(loaded as THREE.Material)`, ramp branch `rampMaterial(rampForBuildingRole(role, wallColorKey))` (keep whatever second argument the file passes today), both with `castShadow`/`receiveShadow` true; drop the `{ coursing: ... }` option and its import.

`mesh-death.ts`:
```ts
export interface MeshFadeSwap {
  readonly mesh: THREE.Mesh;
  readonly original: THREE.Material;
  readonly fade: THREE.Material;
}
export function beginMeshDeathFade(root: THREE.Object3D): MeshFadeSwap[] {
  const swaps: MeshFadeSwap[] = [];
  const cloned = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const original = mesh.material as THREE.Material;
    let fade = cloned.get(original);
    if (!fade) {
      fade = original.clone();
      fade.transparent = true;
      cloned.set(original, fade);
    }
    mesh.material = fade;
    swaps.push({ mesh, original, fade });
  });
  return swaps;
}
export function setMeshDeathOpacity(swaps: readonly MeshFadeSwap[], opacity: number): void {
  for (const s of swaps) s.fade.opacity = opacity;
}
```
(Keep the dedup comment; the `uniforms.uOpacity` write goes.)

`ThreeRenderer.ts`: delete the four `this.flashLights.register(material as THREE.ShaderMaterial);` lines that follow `buildMeshUnitTemplate` / `buildVehicleMeshTemplate` / `buildBuildingMeshTemplate` (≈3397, 3443, 3579, 3646). The flash light is rebuilt as real lights in Task 8; until then it is inert, which is fine.

- [ ] **Step 4: Run the suite**

Run: `pnpm vitest run packages/render && pnpm typecheck`
Expected: PASS. `mesh-vehicle-shipped.test.ts` / `civilian-mesh-shipped.test.ts` / `mesh-team-death-shipped.test.ts` load real GLBs — they should still pass (they assert roles and clips, not material class); if one asserts `ShaderMaterial`, update it the same way.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/render/src/three/units packages/render/src/three/ThreeRenderer.ts
/usr/bin/git commit -m "feat(render): units, vehicles and buildings draw through lit standard materials

Ramp assets take their ramp's lit tone as a flat albedo; Meshy bakes keep
the loader's own material, normalised (sRGB map, dielectric unless the GLB
says otherwise). Every mesh casts and receives shadows. The death fade
writes material opacity instead of a shader uniform.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Terrain, scatter, grove and decor on lit materials

**Files:**
- Modify: `packages/render/src/three/terrain/mesh.ts:100-330, 530-800` — replace `terrainMaterial`, `groveMaterial`, `groundSurfaceMaterial`, `GROUND_LIGHT_DIR`, `GROUND_RELIEF_STRENGTH`, `GROUND_SHADE_FLOOR/CEIL`.
- Modify: `packages/render/src/three/terrain/decor-mesh.ts:128-145`, `decor-textured-mesh.ts:76-82`, `textured-decor.ts:130-200`.
- Modify: `packages/render/src/three/ThreeRenderer.ts` — fields `terrainMat`, `groundMat`, `groveMat`; `rebuildTerrain` shadow flags; the two decor `flashLights.register` loops (~5807, ~5820) and the two at construction (~1646-1647).
- Test: `packages/render/src/three/terrain/mesh.test.ts`, `decor-mesh.test.ts`, `decor-textured-mesh.test.ts`, `textured-decor.test.ts`, `debug-layers.test.ts` (should pass unchanged).

**Interfaces:**
- Produces in `terrain/mesh.ts`: `vertexColorMaterial(): THREE.MeshStandardMaterial`; `class GroundMaterial extends THREE.MeshStandardMaterial { readonly uniforms: Record<string, THREE.IUniform> }` (same uniform names as today: `uSand`, `uSandStrength`, `uSandMean`, `uSandTiles`, … per `GROUND_SLOTS`/`slotUniforms`); `class GroveMaterial extends THREE.MeshStandardMaterial { readonly uniforms: { uTime: THREE.IUniform<number> } }`; `GROUND_ALBEDOS`, `albedoMean`, `slotUniforms`, `GROUND_SLOTS`, `prepareGroundTexture`, `whitePixel` unchanged (`prepareGroundTexture` keeps `NoColorSpace` — see Global Constraints).
- Consumes: `rampMaterial`, `texturedMapMaterial` from `../world-materials`.

- [ ] **Step 1: Write the failing tests** (append to `mesh.test.ts`)

```ts
describe('GroundMaterial', () => {
  it('is a lit, vertex-coloured, double-sided standard material with the six albedo slots as uniforms', () => {
    const m = new GroundMaterial();
    expect(m.isMeshStandardMaterial).toBe(true);
    expect(m.vertexColors).toBe(true);
    expect(m.side).toBe(THREE.DoubleSide);
    for (const slot of GROUND_SLOTS) {
      const u = slotUniforms(slot);
      expect(m.uniforms[u.map]).toBeDefined();
      expect(m.uniforms[u.strength].value).toBe(0);
      expect(m.uniforms[u.mean]).toBeDefined();
      expect(m.uniforms[u.tiles]).toBeDefined();
    }
  });
  it('injects the albedo blend into the standard fragment shader after the vertex colour', () => {
    const m = new GroundMaterial();
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderChunk.meshphysical_vert,
      fragmentShader: THREE.ShaderChunk.meshphysical_frag,
    };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.uSandStrength).toBe(m.uniforms.uSandStrength);
    expect(shader.vertexShader).toContain('attribute vec2 groundUv;');
    expect(shader.fragmentShader).toContain('diffuseColor.rgb *= rlAlbedo;');
    expect(shader.fragmentShader.indexOf('#include <color_fragment>')).toBeLessThan(
      shader.fragmentShader.indexOf('diffuseColor.rgb *= rlAlbedo;')
    );
    expect(m.customProgramCacheKey()).toBe('rl-ground');
  });
});

describe('GroveMaterial', () => {
  it('injects the wind offset into the vertex shader and exposes uTime', () => {
    const m = new GroveMaterial();
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderChunk.meshphysical_vert,
      fragmentShader: THREE.ShaderChunk.meshphysical_frag,
    };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.uTime).toBe(m.uniforms.uTime);
    expect(shader.vertexShader).toContain('attribute float sway;');
    expect(shader.vertexShader).toContain('transformed += vec3(rlWind, 0.0, -rlWind);');
    expect(m.customProgramCacheKey()).toBe('rl-grove');
  });
});

describe('vertexColorMaterial', () => {
  it('is a lit vertex-coloured standard material', () => {
    const m = vertexColorMaterial();
    expect(m.isMeshStandardMaterial).toBe(true);
    expect(m.vertexColors).toBe(true);
  });
});
```

(`THREE.ShaderChunk.meshphysical_vert`/`_frag` are the standard material's sources; `@types/three` 0.170 declares `ShaderChunk` without an index signature for some keys — if TypeScript rejects the property access, read it as `(THREE.ShaderChunk as unknown as Record<string, string>).meshphysical_vert`. The `WebGLProgramParametersWithUniforms` cast is what `onBeforeCompile`'s signature demands; the test only needs the three fields it sets.)

Delete the existing tests of `GROUND_LIGHT_DIR`, `GROUND_RELIEF_STRENGTH`, `GROUND_SHADE_FLOOR/CEIL`, `terrainMaterial`, `groveMaterial`, `groundSurfaceMaterial` shader strings (`uLightDir`, `flashShiftSteps`, `uRelief`), keeping every `GROUND_ALBEDOS` mean/tiles test and every `toGeometry` test.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run packages/render/src/three/terrain/mesh.test.ts`
Expected: FAIL — `GroundMaterial` not exported.

- [ ] **Step 3: Implement in `terrain/mesh.ts`**

Delete `terrainMaterial`, `groveMaterial`, `groundSurfaceMaterial`, `GROUND_LIGHT_DIR`, `GROUND_RELIEF_STRENGTH`, `GROUND_SHADE_FLOOR`, `GROUND_SHADE_CEIL` and the `../palette-material` import. Add:

```ts
import { WORLD_ROUGHNESS } from '../world-materials';

/** Scatter marks, the residual layer and the structure boxes: flat palette
 *  tones from the builders, lit by the scene. */
export function vertexColorMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
}

const GROUND_ATTRIBUTES_GLSL = /* glsl */ `
attribute float sandMask;
attribute float rockMask;
attribute float roadMask;
attribute float roadAxis;
attribute float scrubMask;
attribute float groveMask;
attribute float knollMask;
attribute vec2 groundUv;
varying float vSandMask;
varying float vRockMask;
varying float vRoadMask;
varying float vRoadAxis;
varying float vScrubMask;
varying float vGroveMask;
varying float vKnollMask;
varying vec2 vGroundUv;
`;

const GROUND_VARYINGS_GLSL = /* glsl */ `
uniform sampler2D uSand; uniform float uSandStrength; uniform vec3 uSandMean; uniform float uSandTiles;
uniform sampler2D uRock; uniform float uRockStrength; uniform vec3 uRockMean; uniform float uRockTiles;
uniform sampler2D uRoad; uniform float uRoadStrength; uniform vec3 uRoadMean; uniform float uRoadTiles;
uniform sampler2D uScrub; uniform float uScrubStrength; uniform vec3 uScrubMean; uniform float uScrubTiles;
uniform sampler2D uGrove; uniform float uGroveStrength; uniform vec3 uGroveMean; uniform float uGroveTiles;
uniform sampler2D uKnoll; uniform float uKnollStrength; uniform vec3 uKnollMean; uniform float uKnollTiles;
varying float vSandMask;
varying float vRockMask;
varying float vRoadMask;
varying float vRoadAxis;
varying float vScrubMask;
varying float vGroveMask;
varying float vKnollMask;
varying vec2 vGroundUv;
`;

/** The six-slot albedo blend, verbatim from the retired custom shader: each
 *  texel is a RATIO to its image's own mean, so the blend cannot move the
 *  surface's average off the palette tone the vertex colour carries. */
const GROUND_BLEND_GLSL = /* glsl */ `
vec3 rlSand = texture2D(uSand, vGroundUv / uSandTiles).rgb / uSandMean;
vec3 rlRock = texture2D(uRock, vGroundUv / uRockTiles).rgb / uRockMean;
vec2 rlRoadUv = vGroundUv / uRoadTiles;
vec3 rlRoad = mix(texture2D(uRoad, rlRoadUv).rgb, texture2D(uRoad, rlRoadUv.yx).rgb, vRoadAxis) / uRoadMean;
vec3 rlScrub = texture2D(uScrub, vGroundUv / uScrubTiles).rgb / uScrubMean;
vec3 rlGrove = texture2D(uGrove, vGroundUv / uGroveTiles).rgb / uGroveMean;
vec3 rlKnoll = texture2D(uKnoll, vGroundUv / uKnollTiles).rgb / uKnollMean;
vec3 rlAlbedo = vec3(1.0);
rlAlbedo *= mix(vec3(1.0), rlSand, uSandStrength * vSandMask);
rlAlbedo *= mix(vec3(1.0), rlRock, uRockStrength * vRockMask);
rlAlbedo *= mix(vec3(1.0), rlRoad, uRoadStrength * vRoadMask);
rlAlbedo *= mix(vec3(1.0), rlScrub, uScrubStrength * vScrubMask);
rlAlbedo *= mix(vec3(1.0), rlGrove, uGroveStrength * vGroveMask);
rlAlbedo *= mix(vec3(1.0), rlKnoll, uKnollStrength * vKnollMask);
diffuseColor.rgb *= rlAlbedo;
`;

function groundUniforms(): Record<string, THREE.IUniform> {
  const u: Record<string, THREE.IUniform> = {};
  for (const slot of GROUND_SLOTS) {
    const names = slotUniforms(slot);
    const id = DEFAULT_ALBEDO_FOR_SLOT[slot];
    u[names.map] = { value: whitePixel() };
    u[names.strength] = { value: 0 };
    u[names.mean] = { value: albedoMean(id) };
    u[names.tiles] = { value: GROUND_ALBEDOS[id].tiles };
  }
  return u;
}

/**
 * The drawn ground: `MeshStandardMaterial` with the vertex palette tone
 * multiplied by the six-slot albedo blend, lit and shadowed by the scene.
 * The retired `groundSurfaceMaterial` shaded slopes itself against a private
 * light; the sun does that now, so `GROUND_RELIEF_STRENGTH` and its floor and
 * ceiling are gone with it.
 *
 * `uniforms` is a field on this subclass so `ThreeRenderer.loadGroundTexture`
 * and the `ground-albedo` debug layer keep writing `uniforms.uSandStrength.value`
 * exactly as before; `onBeforeCompile` hands the SAME uniform objects to the
 * program, so a write here is a write the GPU sees.
 */
export class GroundMaterial extends THREE.MeshStandardMaterial {
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor() {
    // DoubleSide: a heightfield patch turns its back on this camera past
    // ~3.2 levels per tile of slope; measured 0 back faces on every shipped
    // map, but qarn_hadid clears the threshold by a dot product of 0.00001.
    // Culling it would read as a hole, not a lighting bug.
    super({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    this.uniforms = groundUniforms();
    this.onBeforeCompile = (shader) => {
      for (const [name, uniform] of Object.entries(this.uniforms)) shader.uniforms[name] = uniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GROUND_ATTRIBUTES_GLSL}`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vSandMask = sandMask; vRockMask = rockMask; vRoadMask = roadMask; vRoadAxis = roadAxis;
vScrubMask = scrubMask; vGroveMask = groveMask; vKnollMask = knollMask; vGroundUv = groundUv;`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GROUND_VARYINGS_GLSL}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${GROUND_BLEND_GLSL}`);
    };
  }

  override customProgramCacheKey(): string {
    return 'rl-ground';
  }
}

/**
 * The grove canopy: vertex palette tone, lit, plus the wind offset the
 * retired `groveMaterial` applied -- ported verbatim. Phase and amplitude
 * read the vertex's own position (object space == world space for the grove
 * mesh, which carries no transform) BEFORE the offset, never after.
 */
export class GroveMaterial extends THREE.MeshStandardMaterial {
  readonly uniforms: { uTime: THREE.IUniform<number> };

  constructor() {
    super({ vertexColors: true, roughness: 1, metalness: 0 });
    this.uniforms = { uTime: { value: 0 } };
    this.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
float rlPhase = uTime * 1.6 + position.x * 0.6 + position.z * 0.9;
float rlWind = sin(rlPhase) * sway * 0.05;
transformed += vec3(rlWind, 0.0, -rlWind);`
        );
    };
  }

  override customProgramCacheKey(): string {
    return 'rl-grove';
  }
}
```

`DEFAULT_ALBEDO_FOR_SLOT` is the slot → default image id table the old `groundSurfaceMaterial` spelled out inline (`sand → desert_sand_tile`, `rock → rock_ground_tile`, `road → road_track_tile`, `scrub → rough_scrub_tile`, `grove → orchard_floor_tile`, `knoll → knoll_scree_tile`); declare it as `const DEFAULT_ALBEDO_FOR_SLOT: Record<GroundSlot, GroundAlbedoId>` next to `GROUND_SLOTS`. Keep the doc comment that explains `mix(1, texel/mean, g)` (it is above `GROUND_ALBEDOS` and still true).

`decor-mesh.ts`:
```ts
import { rampMaterial } from '../world-materials';
// ...
    const mesh = new THREE.BatchedMesh(maxInstances, acc.verts, acc.idx, rampMaterial(rampForDecorRole(role)));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
```

`decor-textured-mesh.ts`: `texturedDecorMaterial(part.map)` → `texturedMapMaterial(part.map)` from `../world-materials`, and set `castShadow`/`receiveShadow` true on the `InstancedMesh`. In `textured-decor.ts` delete `texturedDecorMaterial` and the `TEXTURED_SHADE*`/flash imports; keep `isTexturedDecorKey` and the key list.

`ThreeRenderer.ts`:
```ts
  private readonly terrainMat: THREE.MeshStandardMaterial = vertexColorMaterial();
  private readonly groundMat: GroundMaterial = new GroundMaterial();
  private readonly groveMat: GroveMaterial = new GroveMaterial();
```
Delete the two constructor lines `this.flashLights.register(this.terrainMat ...)` / `register(this.groveMat)` and the two decor `register` loops (~5807, ~5820). In `rebuildTerrain`: after each `new THREE.Mesh(...)` for `terrainMesh`, `scatterMesh`, `residualMesh` set `receiveShadow = true`; for `groveMesh` set `receiveShadow = true` and `castShadow = false` (a billboard casts a sliver); for each structure box set both true. `this.groveMat.uniforms.uTime.value = ...` in `frame()` keeps working. Update the field type used by `setGroundAlbedoOn` (it reads `this.groundMat.uniforms[...]` — unchanged).

- [ ] **Step 4: Run the suite**

Run: `pnpm vitest run packages/render && pnpm typecheck && pnpm lint`
Expected: PASS, including `debug-layers.test.ts` (it writes `groundMat.uniforms.uSandStrength.value` — still a field). If `textured-decor.test.ts` pinned the shade uniforms, delete those tests.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/render/src/three
/usr/bin/git commit -m "feat(render): ground, scatter, grove and decor draw through lit standard materials

GroundMaterial keeps the six-slot albedo blend (verbatim, injected after the
vertex colour) and drops its private slope shade: the sun shades slopes now.
GroveMaterial keeps the wind. Decor casts and receives shadows.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Delete the palette pipeline

**Files:**
- Delete: `packages/render/src/three/palette-material.ts`, `palette-material.test.ts`, `palette-material.coursing.test.ts`, `units/mesh-material.ts`, `units/mesh-material.test.ts`
- Modify: `packages/render/src/three/units/textured-building.ts` (list only), `flash-light.ts` (own `FLASH_CAPACITY`), `ThreeRenderer.ts` (constructor pipeline lines), `spike/rig-scene.ts`, `spike/soldier-view.ts`, `ThreeRenderer.test.ts`, `flash-light.test.ts`
- Test: whole render suite

**Interfaces:**
- Produces: `FLASH_CAPACITY` exported from `flash-light.ts`; `ThreeRenderer` sets `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`, `toneMappingExposure = 1`, and calls `setClearColor(new THREE.Color(opts.background))` in its constructor; `WebGLRenderer({ antialias: true, stencil: true })`.

- [ ] **Step 1: Update `ThreeRenderer.test.ts` expectations first**

Find the test(s) asserting the palette pipeline (`outputColorSpace` equals `LinearSRGBColorSpace`, or "sets the clear colour after the colour space") and replace with:

```ts
  it('configures the standard sRGB + ACES output and the palette background as clear colour', () => {
    const renderer = new ThreeRenderer(makeSim(), makeOpts());
    const gl = (renderer as unknown as { renderer: { outputColorSpace: string; toneMapping: number; clearColorCalls: string[] } }).renderer;
    expect(gl.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(gl.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(gl.clearColorCalls).toEqual(['14150f']);
    renderer.dispose();
  });
```
and make the file's `FakeWebGLRenderer.setClearColor(color: THREE.Color)` push `color.getHexString()` into `clearColorCalls: string[] = []`. (The other eight test files' fakes need no change: assigning `toneMapping` to a plain object is legal, `setClearColor` exists on all of them.)

- [ ] **Step 2: Delete and rewire**

```bash
/usr/bin/git rm -q packages/render/src/three/palette-material.ts packages/render/src/three/palette-material.test.ts packages/render/src/three/palette-material.coursing.test.ts packages/render/src/three/units/mesh-material.ts packages/render/src/three/units/mesh-material.test.ts
```

Then `grep -rn "palette-material\|mesh-material" packages/render/src` and fix every hit:

- `flash-light.ts`: add `export const FLASH_CAPACITY = 8;` at the top (the old import goes); `flash-light.test.ts` imports it from `./flash-light`.
- `textured-building.ts`: reduce to the `TEXTURED_BUILDING_TYPES` export and its doc comment (delete `TEXTURED_SHADE`, `TEXTURED_SHADE_STEPS`, `prepareTexturedMap`, `texturedBuildingMaterial`, all imports).
- `ThreeRenderer.ts` constructor, replacing `new THREE.WebGLRenderer({ antialias: false, stencil: true })` and the `applyPalettePipeline(...)` call:
```ts
    // Antialiasing on the raw renderer covers the composer-less path (tests,
    // spikes); the composer's SMAA pass covers the game (post-chain.ts).
    this.renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setClearColor(new THREE.Color(this.opts.background));
```
  Delete the comment block above it that argues for antialiasing off.
- `spike/rig-scene.ts`, `spike/soldier-view.ts`: replace `toonRampSkinnedMaterial(ramp)` / `toonRampMaterial(ramp)` with `rampMaterial(ramp)` from `../world-materials`; delete `applyPalettePipeline` calls (set `outputColorSpace = SRGBColorSpace` + `setClearColor` inline as above). These are throwaway harnesses; they only need to compile.
- `units/vfx-mesh-material.ts`, `smoke-mesh.ts`, `units/collapse-shroud.ts` and anything else that imported `FLASH_UNIFORMS_GLSL`/`defaultFlashUniforms`: delete the import and the `${FLASH_UNIFORMS_GLSL}`/`${FLASH_SHIFT_GLSL}` splices and `...defaultFlashUniforms()` spreads; where a fragment shader called `flashShiftSteps(...)`, delete that line and the branch it fed (the material draws its base colour).

- [ ] **Step 3: Run everything**

Run: `pnpm vitest run packages/render && pnpm typecheck && pnpm lint`
Expected: PASS. `grep -rn "flashShiftSteps\|uFlashPos\|LinearSRGBColorSpace\|paletteColorNoConvert" packages/render/src` prints nothing.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add -A packages/render/src/three
/usr/bin/git commit -m "refactor(render): retire the per-pixel palette pipeline

Deletes the toon ramp materials, the ramp-shift flash GLSL, the pass-through
colour space and the antialiasing ban. The palette remains the source of
every authored colour; it is no longer a claim about every pixel.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The muzzle flash as a pool of point lights

**Files:**
- Modify: `packages/render/src/three/flash-light.ts` (rewrite)
- Modify: `packages/render/src/three/ThreeRenderer.ts` — construction (~938), scene add, `frame()` step, spawn site (~2675)
- Test: `packages/render/src/three/flash-light.test.ts` (rewrite)

**Interfaces:**
- Produces: `FLASH_CAPACITY = 8`, `FLASH_INTENSITY_SCALE = 12`, `FLASH_HEIGHT = 0.6`, `interface FlashLightSpec { color?: string; intensity?: number; radius_tiles?: number; decay_ms?: number }`, `class FlashLightManager { readonly lights: readonly THREE.PointLight[]; readonly liveCount: number; addTo(scene): void; spawn(x: number, z: number, groundY: number, spec: FlashLightSpec, colorHex: string): void; step(dtMs: number): void; dispose(): void }`.
- Consumes: `groundWorldY(elevation, width, height, x, y)` from `./ground-height` (already imported by `ThreeRenderer`).

- [ ] **Step 1: Write the failing test** (replace `flash-light.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FlashLightManager, FLASH_CAPACITY, FLASH_INTENSITY_SCALE, FLASH_HEIGHT } from './flash-light';

const spec = { intensity: 3.5, radius_tiles: 7, decay_ms: 500 };

describe('FlashLightManager (point-light pool)', () => {
  it('owns FLASH_CAPACITY lights, all always in the scene at zero intensity when idle', () => {
    const m = new FlashLightManager();
    const scene = new THREE.Scene();
    m.addTo(scene);
    expect(m.lights).toHaveLength(FLASH_CAPACITY);
    expect(scene.children.filter((c) => (c as THREE.PointLight).isPointLight)).toHaveLength(FLASH_CAPACITY);
    for (const l of m.lights) {
      expect(l.intensity).toBe(0);
      expect(l.visible).toBe(true); // a changing light COUNT recompiles every material
      expect(l.castShadow).toBe(false);
    }
  });

  it('spawns nothing without decay_ms or with a rounded intensity of 0', () => {
    const m = new FlashLightManager();
    m.spawn(1, 2, 0, { intensity: 3 }, '#FFB43C');
    m.spawn(1, 2, 0, { intensity: 0.3, radius_tiles: 0.5, decay_ms: 420 }, '#FFB43C');
    expect(m.liveCount).toBe(0);
  });

  it('a live flash drives one light: position above ground, colour, distance, peak at midlife, gone after decay', () => {
    const m = new FlashLightManager();
    m.spawn(4, 6, 0.5, spec, '#FFB43C');
    expect(m.liveCount).toBe(1);
    m.step(250);
    const l = m.lights[0];
    expect(l.position.toArray()).toEqual([4, 0.5 + FLASH_HEIGHT, 6]);
    expect(l.color.getHexString().toUpperCase()).toBe('FFB43C');
    expect(l.distance).toBe(7);
    expect(l.intensity).toBeCloseTo(3.5 * FLASH_INTENSITY_SCALE, 6);
    m.step(300);
    expect(m.liveCount).toBe(0);
    expect(l.intensity).toBe(0);
  });

  it('evicts the OLDEST flash past capacity, keeping the newest', () => {
    const m = new FlashLightManager();
    for (let i = 0; i < FLASH_CAPACITY + 1; i++) m.spawn(i, 0, 0, spec, '#FFB43C');
    expect(m.liveCount).toBe(FLASH_CAPACITY);
    m.step(250);
    const xs = m.lights.map((l) => l.position.x).sort((a, b) => a - b);
    expect(xs[0]).toBe(1); // x=0 (the oldest) was evicted
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/render/src/three/flash-light.test.ts`
Expected: FAIL — `addTo`/`lights` missing, `spawn` arity.

- [ ] **Step 3: Rewrite `flash-light.ts`**

```ts
/**
 * The muzzle flash and blast "light" -- real `THREE.PointLight`s now.
 *
 * Under the palette pipeline this was a ramp-index shift baked into every
 * material's shader; a light could not be a light because nothing consumed
 * three.js lighting. Everything world-side is `MeshStandardMaterial` since
 * Phase 0, so an emitter's `light` block (`data/vfx/*.json`: `color`,
 * `intensity`, `radius_tiles`, `decay_ms`) drives a pooled point light.
 *
 * The pool is FIXED at `FLASH_CAPACITY` lights that are always in the scene:
 * three.js compiles the light COUNT into every shader, so toggling `visible`
 * per flash would recompile every material on the first shot of a fight.
 * Idle lights sit at intensity 0. Overflow evicts the oldest flash -- the
 * newest is what the player is looking at.
 */
import * as THREE from 'three';

export const FLASH_CAPACITY = 8;
/** Emitter `intensity` is 0.3-3.5 across `data/vfx/`; point-light intensity
 *  under physically correct lights is candela-ish, so a flash needs an order
 *  of magnitude more to read on a sunlit surface. Judged on screen. */
export const FLASH_INTENSITY_SCALE = 12;
/** World units above the ground the light sits: a rifle's muzzle height. */
export const FLASH_HEIGHT = 0.6;

export interface FlashLightSpec {
  color?: string;
  intensity?: number;
  radius_tiles?: number;
  decay_ms?: number;
}

interface ActiveFlash {
  x: number;
  y: number;
  z: number;
  peak: number;
  radius: number;
  decayMs: number;
  ageMs: number;
  color: THREE.Color;
}

export class FlashLightManager {
  readonly lights: readonly THREE.PointLight[];
  private readonly active: ActiveFlash[] = [];

  constructor(capacity = FLASH_CAPACITY) {
    this.lights = Array.from({ length: capacity }, () => {
      const light = new THREE.PointLight(0xffffff, 0, 0.01, 2);
      light.castShadow = false;
      light.visible = true;
      return light;
    });
  }

  get liveCount(): number {
    return this.active.length;
  }

  addTo(scene: THREE.Object3D): void {
    for (const light of this.lights) scene.add(light);
  }

  spawn(x: number, z: number, groundY: number, spec: FlashLightSpec, colorHex: string): void {
    const decayMs = spec.decay_ms ?? 0;
    if (decayMs <= 0) return;
    const rounded = Math.round(spec.intensity ?? 0);
    if (rounded <= 0) return;
    if (this.active.length >= this.lights.length) this.active.shift();
    this.active.push({
      x,
      y: groundY + FLASH_HEIGHT,
      z,
      peak: (spec.intensity ?? 0) * FLASH_INTENSITY_SCALE,
      radius: Math.max(0.01, spec.radius_tiles ?? 0),
      decayMs,
      ageMs: 0,
      color: new THREE.Color(colorHex),
    });
  }

  /** Ages every flash, retires the finished ones, and writes the survivors
   *  into the pool. `sin(progress * PI)`: rise fast, peak at midlife, fall. */
  step(dtMs: number): void {
    for (const f of this.active) f.ageMs += dtMs;
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i].ageMs >= this.active[i].decayMs) this.active.splice(i, 1);
    }
    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i];
      const f = this.active[i];
      if (!f) {
        light.intensity = 0;
        continue;
      }
      const progress = Math.min(1, f.ageMs / f.decayMs);
      light.position.set(f.x, f.y, f.z);
      light.color.copy(f.color);
      light.distance = f.radius;
      light.intensity = f.peak * Math.sin(progress * Math.PI);
    }
  }

  dispose(): void {
    for (const light of this.lights) light.dispose();
    this.active.length = 0;
  }
}
```

`ThreeRenderer.ts`:
- constructor: after the scene lights are added (Task 9 adds them; for now right after `this.flashLights` is constructed) call `this.flashLights.addTo(this.scene);`
- `frame()`: `this.flashLights.step(dtMs);` stays where it is.
- spawn site (~2675): replace `if (emitter?.light) this.flashLights.spawn(mzX, mzY, emitter.light);` with
```ts
    if (emitter?.light) {
      const light = emitter.light;
      this.flashLights.spawn(
        mzX,
        mzY,
        groundWorldY(this.retained.elevation, this.sim.width, this.sim.height, mzX, mzY),
        light,
        this.overlayColor(light.color ?? 'vfx.fire', '#FFB43C')
      );
    }
```
  (`mzX`/`mzY` are tile-space = world X/Z at that site; `groundWorldY` is already called two lines above it for `mzZ` — reuse `mzZ` if it is the same quantity.)
- `dispose()`: add `this.flashLights.dispose();`.

- [ ] **Step 4: Run the suite**

Run: `pnpm vitest run packages/render && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/render/src/three/flash-light.ts packages/render/src/three/flash-light.test.ts packages/render/src/three/ThreeRenderer.ts
/usr/bin/git commit -m "feat(render): muzzle flashes and blasts are pooled point lights

Eight PointLights, always in the scene (a changing light count recompiles
every material), driven from the emitters' existing light blocks.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Lights in the scene, the composer, shadows, pixel ratio — and the sun check on screen

**Files:**
- Create: `packages/render/src/three/post-chain.ts`
- Test: `packages/render/src/three/post-chain.test.ts`
- Modify: `packages/render/src/three/ThreeRenderer.ts` — fields, constructor, `init`, `fitToHost`, `frame`, `threeCamera`, `width`/`height` getters, `dispose`.

**Interfaces:**
- Produces: `interface PostChain { readonly composer: EffectComposer; readonly passNames: readonly string[]; setSize(cssWidth: number, cssHeight: number, pixelRatio: number): void; render(): void; dispose(): void; setFogPass(pass: Pass | null): void /* Task 10 */; setAoPass(pass: Pass | null): void /* Task 13 */ }`, `createPostChain(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, cssWidth: number, cssHeight: number, pixelRatio: number): PostChain`, `PIXEL_RATIO_CAP = 2`.
- `ThreeRenderer`: `private readonly viewCamera = new THREE.OrthographicCamera()`, `private post: PostChain | null`, `private cssWidth/cssHeight`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/render/src/three/post-chain.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createPostChain, PIXEL_RATIO_CAP } from './post-chain';

/** The composer needs only these members of a renderer at construction. */
function fakeRenderer(): THREE.WebGLRenderer {
  const size = new THREE.Vector2(1440, 900);
  return {
    getSize: (v: THREE.Vector2) => v.copy(size),
    getPixelRatio: () => 1,
    setRenderTarget: () => undefined,
    getRenderTarget: () => null,
    getContext: () => ({}),
  } as unknown as THREE.WebGLRenderer;
}

describe('createPostChain', () => {
  it('orders RenderPass, OutputPass, SMAAPass with a single-sampled HalfFloat target that carries depth+stencil', () => {
    const chain = createPostChain(fakeRenderer(), new THREE.Scene(), new THREE.OrthographicCamera(), 1440, 900, 1);
    expect(chain.passNames).toEqual(['RenderPass', 'OutputPass', 'SMAAPass']);
    const target = chain.composer.renderTarget1;
    expect(target.samples).toBe(0);
    expect(target.texture.type).toBe(THREE.HalfFloatType);
    expect(target.stencilBuffer).toBe(true);
    expect(target.depthTexture).not.toBeNull();
    expect(target.depthTexture?.format).toBe(THREE.DepthStencilFormat);
    expect(chain.composer.renderTarget2.depthTexture).not.toBeNull();
  });

  it('slots the fog pass after RenderPass and the AO pass after fog, OutputPass and SMAA last', () => {
    const chain = createPostChain(fakeRenderer(), new THREE.Scene(), new THREE.OrthographicCamera(), 800, 600, 1);
    const fog = { name: 'FogOfWarPass', render() {}, setSize() {}, dispose() {}, needsSwap: true, enabled: true, clear: false, renderToScreen: false } as unknown as import('three/addons/postprocessing/Pass.js').Pass;
    const ao = { ...fog, name: 'GTAOPass' } as unknown as import('three/addons/postprocessing/Pass.js').Pass;
    chain.setFogPass(fog);
    chain.setAoPass(ao);
    expect(chain.passNames).toEqual(['RenderPass', 'FogOfWarPass', 'GTAOPass', 'OutputPass', 'SMAAPass']);
    chain.setAoPass(null);
    expect(chain.passNames).toEqual(['RenderPass', 'FogOfWarPass', 'OutputPass', 'SMAAPass']);
  });

  it('sizes the target by css size times pixel ratio', () => {
    const chain = createPostChain(fakeRenderer(), new THREE.Scene(), new THREE.OrthographicCamera(), 800, 600, 2);
    expect(chain.composer.renderTarget1.width).toBe(1600);
    chain.setSize(400, 300, 2);
    expect(chain.composer.renderTarget1.width).toBe(800);
    expect(PIXEL_RATIO_CAP).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/render/src/three/post-chain.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `post-chain.ts`**

```ts
/**
 * The frame's post chain (spec §5): RenderPass -> [FogOfWarPass] -> [GTAOPass]
 * -> OutputPass -> SMAAPass.
 *
 * Why SMAA on a single-sampled target rather than hardware MSAA: the fog
 * pass reads the RenderPass's depth texture, and a multisampled depth
 * attachment has to be resolved before it can be sampled -- support for that
 * in three r170 is the one thing in this chain nobody here has measured, and
 * the pass that needs it is the higher-value one. SMAA after the output
 * transform is the textbook order (it edge-detects on display-referred
 * colour).
 *
 * Why the target is HalfFloat: the scene renders linear, tone mapping and
 * the sRGB encode happen in OutputPass, so the intermediate must not clip.
 * Why it carries a stencil: `units/silhouette.ts` masks the occlusion
 * outline with a one-bit stencil; on a target with no stencil attachment the
 * test silently always passes and every vehicle grows flat blue patches --
 * measured on the raw renderer, and the same failure on a render target.
 * With a stencil, the depth texture must be `DepthStencilFormat` /
 * `UnsignedInt248Type`.
 *
 * Fog sits BEFORE ambient occlusion so it reads the RenderPass's own buffer
 * (a pass that swaps leaves the scene depth in the OTHER target); AO is
 * self-contained and re-renders normals itself.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';

export const PIXEL_RATIO_CAP = 2;

export interface PostChain {
  readonly composer: EffectComposer;
  readonly passNames: readonly string[];
  setSize(cssWidth: number, cssHeight: number, pixelRatio: number): void;
  render(): void;
  setFogPass(pass: Pass | null): void;
  setAoPass(pass: Pass | null): void;
  dispose(): void;
}

function depthStencilTexture(w: number, h: number): THREE.DepthTexture {
  const t = new THREE.DepthTexture(w, h, THREE.UnsignedInt248Type);
  t.format = THREE.DepthStencilFormat;
  return t;
}

export function createPostChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number
): PostChain {
  const w = Math.max(1, Math.round(cssWidth * pixelRatio));
  const h = Math.max(1, Math.round(cssHeight * pixelRatio));
  const target = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    stencilBuffer: true,
    samples: 0,
  });
  target.depthTexture = depthStencilTexture(w, h);
  const composer = new EffectComposer(renderer, target);
  if (!composer.renderTarget2.depthTexture) {
    composer.renderTarget2.depthTexture = depthStencilTexture(w, h);
  }
  composer.setPixelRatio(pixelRatio);
  composer.setSize(cssWidth, cssHeight);

  const renderPass = new RenderPass(scene, camera);
  const outputPass = new OutputPass();
  const smaa = new SMAAPass();
  let fogPass: Pass | null = null;
  let aoPass: Pass | null = null;

  const rebuild = (): void => {
    composer.passes.length = 0;
    composer.addPass(renderPass);
    if (fogPass) composer.addPass(fogPass);
    if (aoPass) composer.addPass(aoPass);
    composer.addPass(outputPass);
    composer.addPass(smaa);
  };
  rebuild();

  return {
    composer,
    get passNames() {
      return composer.passes.map((p) => p.constructor.name === 'Object' ? (p as { name?: string }).name ?? 'Pass' : p.constructor.name);
    },
    setSize(cw, ch, pr) {
      composer.setPixelRatio(pr);
      composer.setSize(cw, ch);
    },
    render() {
      composer.render();
    },
    setFogPass(pass) {
      fogPass = pass;
      rebuild();
    },
    setAoPass(pass) {
      aoPass = pass;
      rebuild();
    },
    dispose() {
      composer.dispose();
      renderPass.dispose();
      outputPass.dispose();
      smaa.dispose();
    },
  };
}
```

(`passNames` reads `constructor.name` for real passes and a `name` field for the test's plain-object stand-ins; the real fog pass (Task 10) is a class named `FogOfWarPass`.)

- [ ] **Step 4: Run the post-chain test**

Run: `pnpm vitest run packages/render/src/three/post-chain.test.ts`
Expected: PASS. If `SMAAPass`'s constructor demands width/height in this version, pass `(w, h)` and re-run. If `EffectComposer.setSize` throws on the fake, add the missing member to `fakeRenderer` rather than to the chain.

- [ ] **Step 5: Wire `ThreeRenderer`**

```ts
import { createSceneLights, type SceneLights } from './lighting';
import { updateDimetricCamera } from './camera';
import { createPostChain, PIXEL_RATIO_CAP, type PostChain } from './post-chain';
// fields
  private readonly sceneLights: SceneLights;
  private readonly viewCamera = new THREE.OrthographicCamera();
  private post: PostChain | null = null;
  private cssWidth = 0;
  private cssHeight = 0;
// constructor, right after `this.scene` is usable (with the other scene.add calls):
    this.sceneLights = createSceneLights(sim.width, sim.height);
    this.sceneLights.addTo(this.scene);
    this.flashLights.addTo(this.scene);
// getters
  get width(): number { return this.cssWidth; }
  get height(): number { return this.cssHeight; }
// init
  async init(host: HTMLElement): Promise<void> {
    this.host = host;
    this.loadGroundTexture();
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, PIXEL_RATIO_CAP));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.fitToHost();
    this.post = createPostChain(this.renderer, this.scene, this.viewCamera, this.cssWidth, this.cssHeight, this.renderer.getPixelRatio());
    host.appendChild(this.renderer.domElement);
    // ...rest unchanged (ResizeObserver, snapshot x2, await)
  }
  private fitToHost(): void {
    if (!this.host) return;
    this.cssWidth = this.host.clientWidth;
    this.cssHeight = this.host.clientHeight;
    this.renderer.setSize(this.cssWidth, this.cssHeight);
    this.post?.setSize(this.cssWidth, this.cssHeight, this.renderer.getPixelRatio());
  }
  private threeCamera(): THREE.OrthographicCamera {
    return updateDimetricCamera(this.camera, { width: this.width, height: this.height }, this.viewCamera);
  }
// frame(): replace the last line
    const camera = this.threeCamera();
    if (this.post) this.post.render();
    else this.renderer.render(this.scene, camera);
// dispose(): add
    this.post?.dispose();
    this.post = null;
    this.sceneLights.dispose();
```

Check that nothing else reads `this.renderer.domElement.width` (only the two getters did). `pnpm typecheck` decides.

- [ ] **Step 6: Run the suite**

Run: `pnpm vitest run packages/render && pnpm typecheck && pnpm lint`
Expected: PASS (the nine fakes never see `init`).

- [ ] **Step 7: Look at it, and settle the sun**

Start the dev server (background Bash, this worktree): `pnpm --filter @lions/app exec vite --port 5178 --strictPort --host 127.0.0.1`. In the Browser pane `navigate` to `http://127.0.0.1:5178/?sandbox=beit_sahwan_outskirts`, wait 10 s, run in `javascript_tool`:
```js
const c = window.__lions.renderer.camera; c.x = 5; c.y = 22; c.zoom = 2.5; 'ok'
```
and screenshot. Check, in this order:
1. Console has no shader compile errors (`read_console_messages onlyErrors`). A `GroundMaterial` GLSL typo shows here as `THREE.WebGLProgram: Shader Error`.
2. Every vehicle and infantry figure has a cast shadow on the sand. If shadows are missing entirely, `renderer.shadowMap.enabled` did not run (is `init` reached?) or the sun's `target` is not in the scene.
3. ~~**The sun check.** The `recon_drone` at (8, 23) is a billboard whose sprite was rendered by the Blender rig; the `apc_eitan` beside it is a lit mesh. The drone's BRIGHT side and the Eitan's lit hull faces must be on the same screen side. If the Eitan is lit from the opposite side, flip BOTH signs in `SUN_DIRECTION` to `(-0.406, 0.819, -0.406)` in `lighting.ts`, re-run `lighting.test.ts` (the sign-pair test still passes), and record the outcome in the commit message. Do not leave this step on a guess.~~ **SUPERSEDED — do not run this step, and do not flip "BOTH signs".** This check cannot discriminate (an equal XZ pair lights both camera-facing faces identically, and the rig's bakes have no lit flank at all), and the project lead settled the vector on 2026-09-15 at `(-0.406, 0.819, 0.406)` — a SIDE light, X and Z differing in sign on purpose. `lighting.test.ts` now pins all three components and asserts the signs DIFFER, so following this step would make it red. See `lighting.ts`'s header and the spec's Deviations entry 3.
4. Shadow acne (moiré stripes on flat sand) → raise `normalBias` to 0.04; peter-panning (a shadow detached from the feet) → lower `bias` toward 0.
5. Zoom 0.5 at (22, 24): the picture is antialiased (no staircase on the Eitan's hull edge at 2.5 either).

Fix what the screen shows, re-run the suite, then:

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add packages/render/src/three/post-chain.ts packages/render/src/three/post-chain.test.ts packages/render/src/three/ThreeRenderer.ts packages/render/src/three/lighting.ts
/usr/bin/git commit -m "feat(render): the scene is lit -- sun, shadows, sRGB/ACES output, SMAA, pixel ratio 2

One DirectionalLight with a map-wide 4096 shadow box, one HemisphereLight,
an EffectComposer built in init() (RenderPass -> OutputPass -> SMAAPass), the
camera held as one instance, and the canvas at up to 2x device pixel ratio.
SUN_DIRECTION verified on screen against the recon drone's baked lighting: <say which sign pair won>.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Fog of war as a feathered shroud texture and a depth-reading pass

**Files:**
- Create: `packages/render/src/three/shroud-texture.ts`, `packages/render/src/three/fog-pass.ts`
- Test: `packages/render/src/three/shroud-texture.test.ts`, `packages/render/src/three/fog-pass.test.ts`
- Delete: `packages/render/src/three/fog-mesh.ts`, `fog-mesh.test.ts`
- Modify: `packages/render/src/three/ThreeRenderer.ts` (fog field, dirty flag, frame, dispose), `packages/render/src/three/units/render-order.ts` (band 10)

**Interfaces:**
- `shroud-texture.ts`: `SHROUD_UPSAMPLE = 2`, `SHROUD_NEVER_SEEN = 0`, `SHROUD_EXPLORED = 128`, `SHROUD_VISIBLE = 255`, `buildShroudData(fog: Uint8Array, width: number, height: number, out?: Uint8Array): Uint8Array` (length `4*width*height`), `class ShroudTexture { readonly texture: THREE.DataTexture; constructor(width, height); update(fog: Uint8Array): void; dispose(): void }`.
- `fog-pass.ts`: `FOG_NEVER_SEEN = 0.85`, `FOG_EXPLORED = 0.40`, `FOG_TINT_HEX = '#14150F'` (shadow.1), `class FogOfWarPass extends Pass { constructor(shroud: THREE.Texture, mapWidth: number, mapHeight: number); updateCamera(camera: THREE.Camera): void; readonly uniforms; render(renderer, writeBuffer, readBuffer): void; setSize(): void; dispose(): void }`.
- Consumes: `hexToLinear` from `./terrain/shared`; `PostChain.setFogPass`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/render/src/three/shroud-texture.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildShroudData, ShroudTexture, SHROUD_NEVER_SEEN, SHROUD_EXPLORED, SHROUD_VISIBLE } from './shroud-texture';

describe('buildShroudData', () => {
  it('is 2x2 texels per tile, level 0/1/2 -> 0/128/255 far from any boundary', () => {
    const w = 6, h = 6;
    const fog = new Uint8Array(w * h);
    fog.fill(2);
    const data = buildShroudData(fog, w, h);
    expect(data).toHaveLength(4 * w * h);
    expect(data[0]).toBe(SHROUD_VISIBLE);
    fog.fill(0);
    expect(buildShroudData(fog, w, h)[2 * 12 + 6]).toBe(SHROUD_NEVER_SEEN);
    fog.fill(1);
    expect(buildShroudData(fog, w, h)[2 * 12 + 6]).toBe(SHROUD_EXPLORED);
  });

  it('feathers a boundary monotonically over about 1.5 tiles', () => {
    const w = 8, h = 1;
    const fog = new Uint8Array(w);
    for (let x = 0; x < w; x++) fog[x] = x < 4 ? 2 : 0;
    const data = buildShroudData(fog, w, h);
    // row 0 of the 16x2 texel image
    const row = Array.from(data.slice(0, 16));
    for (let i = 1; i < row.length; i++) expect(row[i]).toBeLessThanOrEqual(row[i - 1]);
    expect(row[0]).toBe(SHROUD_VISIBLE);
    expect(row[15]).toBe(SHROUD_NEVER_SEEN);
    // strictly between at the boundary texels
    expect(row[7]).toBeLessThan(SHROUD_VISIBLE);
    expect(row[8]).toBeGreaterThan(SHROUD_NEVER_SEEN);
  });

  it('reuses the out buffer', () => {
    const out = new Uint8Array(16);
    expect(buildShroudData(new Uint8Array(4), 2, 2, out)).toBe(out);
  });
});

describe('ShroudTexture', () => {
  it('is an R8 DataTexture, linear filtered, clamped, not flipped, updated in place', () => {
    const s = new ShroudTexture(4, 4);
    expect(s.texture.image.width).toBe(8);
    expect(s.texture.format).toBe(THREE.RedFormat);
    expect(s.texture.type).toBe(THREE.UnsignedByteType);
    expect(s.texture.minFilter).toBe(THREE.LinearFilter);
    expect(s.texture.magFilter).toBe(THREE.LinearFilter);
    expect(s.texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(s.texture.flipY).toBe(false);
    expect(s.texture.unpackAlignment).toBe(1);
    const fog = new Uint8Array(16).fill(2);
    s.texture.needsUpdate = false;
    s.update(fog);
    expect(s.texture.needsUpdate).toBe(true);
    expect((s.texture.image.data as Uint8Array)[0]).toBe(SHROUD_VISIBLE);
  });
});
```

```ts
// packages/render/src/three/fog-pass.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FogOfWarPass, FOG_NEVER_SEEN, FOG_EXPLORED, FOG_TINT_HEX } from './fog-pass';
import { hexToLinear } from './terrain/shared';

describe('FogOfWarPass', () => {
  it('carries the spec constants as uniforms and the tint as a LINEAR colour', () => {
    const pass = new FogOfWarPass(new THREE.Texture(), 48, 48);
    expect(FOG_NEVER_SEEN).toBe(0.85);
    expect(FOG_EXPLORED).toBe(0.4);
    expect(pass.uniforms.uNeverSeen.value).toBe(FOG_NEVER_SEEN);
    expect(pass.uniforms.uExplored.value).toBe(FOG_EXPLORED);
    expect(pass.uniforms.uMapSize.value.toArray()).toEqual([48, 48]);
    const [r] = hexToLinear(FOG_TINT_HEX);
    expect((pass.uniforms.uTint.value as THREE.Vector3).x).toBeCloseTo(r, 6);
    expect(pass.needsSwap).toBe(true);
  });

  it('updateCamera copies the inverse projection and world matrix', () => {
    const pass = new FogOfWarPass(new THREE.Texture(), 8, 8);
    const cam = new THREE.OrthographicCamera(-2, 2, 1, -1, 1, 10);
    cam.position.set(3, 4, 5);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    pass.updateCamera(cam);
    expect((pass.uniforms.uInvProjection.value as THREE.Matrix4).toArray()).toEqual(cam.projectionMatrixInverse.toArray());
    expect((pass.uniforms.uCameraWorld.value as THREE.Matrix4).toArray()).toEqual(cam.matrixWorld.toArray());
  });

  it('shader reconstructs world XZ from depth and skips the clear colour', () => {
    const pass = new FogOfWarPass(new THREE.Texture(), 8, 8);
    const frag = pass.material.fragmentShader;
    expect(frag).toContain('if (depth >= 1.0)');
    expect(frag).toContain('uInvProjection * clip');
    expect(frag).toContain('uCameraWorld * view');
    expect(frag).toContain('world.x / uMapSize.x, world.z / uMapSize.y');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run packages/render/src/three/shroud-texture.test.ts packages/render/src/three/fog-pass.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `shroud-texture.ts`**

```ts
/**
 * Fog of war as a texture (spec §6). `computeFog` (`./fog.ts`) still owns
 * the RULE -- level 0 never seen, 1 explored, 2 in sight -- and the unit
 * visibility gate still reads it. This file only turns that byte grid into
 * something a shader can sample smoothly: each tile becomes a 2x2 texel
 * block, then a 3x3 box blur feathers every boundary over ~1.5 tiles.
 *
 * The retired `FogMesh` drew one opaque black quad per tile at band 10 with
 * `depthTest: false`, so a building standing in an explored tile wore a
 * black slab on its roof and every fog edge was a tile staircase. A texture
 * read by world position in a depth-aware pass cannot do either.
 */
import * as THREE from 'three';

export const SHROUD_UPSAMPLE = 2;
export const SHROUD_NEVER_SEEN = 0;
export const SHROUD_EXPLORED = 128;
export const SHROUD_VISIBLE = 255;
const LEVEL_VALUE = [SHROUD_NEVER_SEEN, SHROUD_EXPLORED, SHROUD_VISIBLE] as const;

export function buildShroudData(fog: Uint8Array, width: number, height: number, out?: Uint8Array): Uint8Array {
  const tw = width * SHROUD_UPSAMPLE;
  const th = height * SHROUD_UPSAMPLE;
  const size = tw * th;
  const upsampled = new Uint8Array(size);
  for (let y = 0; y < th; y++) {
    const ty = Math.floor(y / SHROUD_UPSAMPLE);
    for (let x = 0; x < tw; x++) {
      const tx = Math.floor(x / SHROUD_UPSAMPLE);
      upsampled[y * tw + x] = LEVEL_VALUE[fog[ty * width + tx]] ?? SHROUD_NEVER_SEEN;
    }
  }
  const result = out && out.length === size ? out : new Uint8Array(size);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const sy = Math.min(th - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const sx = Math.min(tw - 1, Math.max(0, x + dx));
          sum += upsampled[sy * tw + sx];
        }
      }
      result[y * tw + x] = Math.round(sum / 9);
    }
  }
  return result;
}

export class ShroudTexture {
  readonly texture: THREE.DataTexture;
  private readonly data: Uint8Array;
  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * SHROUD_UPSAMPLE * SHROUD_UPSAMPLE);
    this.texture = new THREE.DataTexture(
      this.data,
      width * SHROUD_UPSAMPLE,
      height * SHROUD_UPSAMPLE,
      THREE.RedFormat,
      THREE.UnsignedByteType
    );
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.flipY = false;
    this.texture.generateMipmaps = false;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true;
  }

  update(fog: Uint8Array): void {
    buildShroudData(fog, this.width, this.height, this.data);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
```

- [ ] **Step 4: Write `fog-pass.ts`**

```ts
/**
 * The fog-of-war post pass (spec §5-6). Reads the RenderPass's depth,
 * reconstructs each pixel's world XZ through the orthographic camera, samples
 * the shroud texture there, and pulls the colour toward a desaturated tint:
 * 85% for never-seen ground, 40% for explored, 0 in sight, blended across the
 * texture's own feather. A pixel with no depth (the clear colour beyond the
 * map) is left alone.
 *
 * Sits directly after RenderPass in `post-chain.ts`, so `readBuffer` is the
 * target the scene was just drawn into and `readBuffer.depthTexture` is that
 * scene's depth.
 */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { hexToLinear } from './terrain/shared';

export const FOG_NEVER_SEEN = 0.85;
export const FOG_EXPLORED = 0.4;
/** `shadow.1` -- the same key the app hands `RendererOptions.background`. */
export const FOG_TINT_HEX = '#14150F';

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform sampler2D uShroud;
uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
uniform vec2 uMapSize;
uniform vec3 uTint;
uniform float uNeverSeen;
uniform float uExplored;
varying vec2 vUv;
void main() {
  vec4 color = texture2D(tDiffuse, vUv);
  float depth = texture2D(tDepth, vUv).x;
  if (depth >= 1.0) { gl_FragColor = color; return; }
  vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uInvProjection * clip;
  vec4 world = uCameraWorld * view;
  vec2 tex = vec2(world.x / uMapSize.x, world.z / uMapSize.y);
  float v = texture2D(uShroud, tex).r;
  float dim = v < 0.5 ? mix(uNeverSeen, uExplored, v * 2.0) : mix(uExplored, 0.0, (v - 0.5) * 2.0);
  float lum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 shrouded = lum * uTint * 2.0;
  gl_FragColor = vec4(mix(color.rgb, shrouded, dim), color.a);
}
`;

export class FogOfWarPass extends Pass {
  readonly uniforms: {
    tDiffuse: THREE.IUniform<THREE.Texture | null>;
    tDepth: THREE.IUniform<THREE.Texture | null>;
    uShroud: THREE.IUniform<THREE.Texture>;
    uInvProjection: THREE.IUniform<THREE.Matrix4>;
    uCameraWorld: THREE.IUniform<THREE.Matrix4>;
    uMapSize: THREE.IUniform<THREE.Vector2>;
    uTint: THREE.IUniform<THREE.Vector3>;
    uNeverSeen: THREE.IUniform<number>;
    uExplored: THREE.IUniform<number>;
  };
  readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;

  constructor(shroud: THREE.Texture, mapWidth: number, mapHeight: number) {
    super();
    const [r, g, b] = hexToLinear(FOG_TINT_HEX);
    this.uniforms = {
      tDiffuse: { value: null },
      tDepth: { value: null },
      uShroud: { value: shroud },
      uInvProjection: { value: new THREE.Matrix4() },
      uCameraWorld: { value: new THREE.Matrix4() },
      uMapSize: { value: new THREE.Vector2(mapWidth, mapHeight) },
      uTint: { value: new THREE.Vector3(r, g, b) },
      uNeverSeen: { value: FOG_NEVER_SEEN },
      uExplored: { value: FOG_EXPLORED },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.needsSwap = true;
  }

  updateCamera(camera: THREE.Camera): void {
    this.uniforms.uInvProjection.value.copy(camera.projectionMatrixInverse);
    this.uniforms.uCameraWorld.value.copy(camera.matrixWorld);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget
  ): void {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);
  }

  override setSize(): void {
    // Screen-space; nothing to resize.
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}
```

(`uTint * 2.0`: `shadow.1` is very dark; doubling keeps explored ground readable as dusk rather than black. Judge on screen in step 7 and adjust the multiplier, not the spec percentages.)

- [ ] **Step 5: Wire `ThreeRenderer`, delete `FogMesh`**

```bash
/usr/bin/git rm -q packages/render/src/three/fog-mesh.ts packages/render/src/three/fog-mesh.test.ts
```

In `ThreeRenderer.ts`:
- replace the `FogMesh` import with `import { ShroudTexture } from './shroud-texture'; import { FogOfWarPass } from './fog-pass';`
- field `private readonly fogMesh: FogMesh` → `private readonly shroud: ShroudTexture; private fogPass: FogOfWarPass | null = null;`; rename `fogMeshDirty` → `shroudDirty` (keep it `true` initially).
- constructor: `this.shroud = new ShroudTexture(sim.width, sim.height);` and delete `this.scene.add(this.fogMesh.mesh)` (and its comment).
- `init()`: after `this.post = createPostChain(...)`: `this.fogPass = new FogOfWarPass(this.shroud.texture, this.sim.width, this.sim.height); this.post.setFogPass(this.fogPass);`
- `frame()`: replace the `fogMesh.update` block with `if (this.shroudDirty) { this.shroud.update(this.fog); this.shroudDirty = false; }` and, just before rendering, `this.fogPass?.updateCamera(camera);` (after `const camera = this.threeCamera();`).
- wherever `this.fogMeshDirty = true` was set (the `computeFog` site ~2287), set `this.shroudDirty = true`.
- `dispose()`: `this.shroud.dispose(); this.fogPass?.dispose();` replacing `this.fogMesh.dispose()`.

`units/render-order.ts`: delete `FOG_RENDER_ORDER` and rewrite the band table's row 10 as "10 (retired 2026-09-14): fog of war is a post pass now (`fog-pass.ts`); nothing in the scene draws at 10". Every comment that says overlays sit "below `FOG_RENDER_ORDER`" now says "below the retired fog band; fog no longer competes with any object". `overlays.ts:53` gets the same one-line edit. Grep: `grep -rn FOG_RENDER_ORDER packages/render/src` must print nothing.

- [ ] **Step 6: Run the suite**

Run: `pnpm vitest run packages/render && pnpm typecheck && pnpm lint`
Expected: PASS. `render-order.test.ts` may pin the band table — update its expectation to the retired row.

- [ ] **Step 7: Look at it**

Dev server as in Task 9. `?sandbox=beit_sahwan_outskirts`, camera `(22, 24)` zoom `0.5`: the black diamond is gone; unexplored ground reads as dark desaturated sand with soft edges; the clear colour outside the map is unchanged. Then `(31, 21)` zoom `2.0` after ordering the force into town (`sel` all, right-click the town, `step(500)`): no black slab on any roof; an explored building is a darker building. If a roof still shows a hard rectangle, `tDepth` is not the RenderPass's depth: check `post-chain.ts` puts the fog pass immediately after `RenderPass` and both composer targets carry a depth texture.

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add -A packages/render/src/three
/usr/bin/git commit -m "feat(render): fog of war is a feathered shroud texture read by a depth-aware post pass

Replaces the instanced black tile quads (alpha 1.0 / 0.55, drawn over
rooftops at band 10). Never-seen dims 85%, explored 40%, feathered ~1.5
tiles; a building in an explored tile darkens as a building.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Delete the blob shadows; track marks become translucent

**Files:**
- Delete: `packages/render/src/three/unit-shadows.ts`, `unit-shadows.test.ts`
- Modify: `packages/render/src/three/ThreeRenderer.ts` (~273 import, ~1524 field, ~1583 construction, ~1682 scene add, ~1930 dispose, ~5128/5201/5669 frame calls), `packages/render/src/three/vehicle-tracks.ts:482-510`
- Test: `packages/render/src/three/vehicle-tracks.test.ts`

**Interfaces:**
- Produces: `TRACK_OPACITY = 0.35` exported from `vehicle-tracks.ts`; the track material is `transparent: true`, `depthWrite: false`, and writes `gl_FragColor = vec4(uColor, uOpacity)`.

- [ ] **Step 1: Update the tests**

`vehicle-tracks.test.ts`: find the test that asserts `transparent === false` / "opaque, one colour, never blended" and replace with:
```ts
  it('track marks are translucent decals: 0.35 alpha, no depth write, 180 s life unchanged', () => {
    const mat = createTrackMaterial('#4E5433');
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.uniforms.uOpacity.value).toBe(TRACK_OPACITY);
    expect(TRACK_OPACITY).toBe(0.35);
  });
```
(Use whatever the file already imports the material factory as; if `createTrackMaterial` is not exported, export it.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/render/src/three/vehicle-tracks.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`vehicle-tracks.ts` material factory (around line 482):
```ts
export const TRACK_OPACITY = 0.35;
// ...
  const [r, g, b] = hexToLinear(color);
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3(r, g, b) }, uOpacity: { value: TRACK_OPACITY } },
    // vertex shader unchanged
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() { gl_FragColor = vec4(uColor, uOpacity); }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
```
Rewrite the module's top comment paragraph "Palette exactness: opaque, one colour, never blended" to say the marks are 35%-alpha decals since Phase 0 and why (opaque planks read as tape across the sand).

`ThreeRenderer.ts`: `git rm` the two unit-shadow files, delete the import, the `unitShadowMesh` field and constructor, the `scene.add(this.unitShadowMesh.mesh)`, the `beginFrame`/`push`/`endFrame` calls in `updateOverlays`, and the `dispose()` call. The `else` branch that called `push` becomes nothing (ground units get real shadows; the `isAir` ellipse branch stays).

- [ ] **Step 4: Run the suite**

Run: `pnpm vitest run packages/render && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add -A packages/render/src/three
/usr/bin/git commit -m "feat(render): real shadows replace the blob; track marks are 35% decals

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Every remaining colour enters the linear pipeline correctly

**Files:**
- Modify: `packages/render/src/three/units/atlas.ts:511-520`, `units/structures.ts:818`, `units/overlays.ts:359`, `units/fx.ts:642`, `trail-mesh.ts:273`, `smoke-mesh.ts:735`
- Test: `units/atlas.test.ts`, `units/structures.test.ts`, the `hexToUnit` tests in `trail-mesh.test.ts`, `smoke-mesh.test.ts`, `units/fx.test.ts`

- [ ] **Step 1: Update tests**

- `atlas.test.ts` / `structures.test.ts`: add (or change) an assertion that the sprite atlas `DataArrayTexture` and the structure frame `Texture` have `colorSpace === THREE.SRGBColorSpace`.
- `trail-mesh.test.ts`, `smoke-mesh.test.ts`, `units/fx.test.ts`: wherever a uniform/attribute colour is compared with `hexToUnit(hex)`, compare with `hexToLinear(hex)` instead (import it from `./terrain/shared` / `../terrain/shared`).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run packages/render/src/three/units/atlas.test.ts packages/render/src/three/trail-mesh.test.ts packages/render/src/three/smoke-mesh.test.ts packages/render/src/three/units/fx.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `atlas.ts`: replace the "No colour-space tag" comment block with `texture.colorSpace = THREE.SRGBColorSpace;` plus a two-line comment: the sheets are sRGB PNGs; three uploads an sRGB texture as `SRGB8_ALPHA8`, so the custom sampler reads linear texels and the output pass encodes them back.
- `structures.ts:818`: after `const texture = new THREE.Texture(bitmap);` add `texture.colorSpace = THREE.SRGBColorSpace;`. Rewrite the comment at ~601 that explained the `NoColorSpace` default.
- `overlays.ts:359`, `fx.ts:642`, `trail-mesh.ts:273`, `smoke-mesh.ts:735`: `hexToUnit(...)` → `hexToLinear(...)` (adjust the import). Then `grep -rn "hexToUnit" packages/render/src/three --include='*.ts' | grep -v test | grep -v terrain/` must list nothing outside `terrain/` (the builders keep it).
- `grep -rn "NoColorSpace" packages/render/src/three` must list only `terrain/mesh.ts` (`prepareGroundTexture`, deliberate) and its test.

- [ ] **Step 4: Run the suite**

Run: `pnpm vitest run packages/render && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Look once**

Dev server, `?sandbox=beit_sahwan_outskirts&nomesh`, camera `(5, 22)` zoom `2.5`: the billboard vehicles read at their authored brightness (not washed out, not dark); the green HP bars are the palette green, not neon. Then `?sandbox=beit_sahwan_outskirts`, fire a Lavi (order the force into town, `step(520)`): a tracer, a shell streak and a dust puff are visible and not blown out.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add packages/render/src/three
/usr/bin/git commit -m "fix(render): sprites, structures and effect colours enter the linear pipeline correctly

Sprite atlases and structure frames are tagged sRGB; overlay, particle,
tracer, trail and smoke colours are decoded to linear before upload.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Ambient occlusion, with the performance gate

**Files:**
- Modify: `packages/render/src/three/post-chain.ts` (add `createAoPass`), `ThreeRenderer.ts` (`init`), `packages/render/src/three/post-chain.test.ts`
- Create: `tools/src/perf/render-frame-cost.ts`

**Interfaces:**
- Produces: `createAoPass(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number): Pass` in `post-chain.ts` (`GTAOPass` with `radius 0.6`, `scale 1.2`, `blendIntensity 1.0`); `AO_RADIUS_TILES = 0.6`, `AO_SCALE = 1.2`.

- [ ] **Step 1: Baseline the frame cost on `main` BEFORE this task's change**

Write `tools/src/perf/render-frame-cost.ts`:

```ts
/**
 * Frame cost of the REAL renderer at the sandbox's own roster, three points
 * of view, hardware GPU. Not a unit-count curve (see three-units.ts for
 * that) -- a before/after instrument for a renderer change. Prints median
 * and p95 of `renderer.frame(1, 16)` in ms over 240 frames per view.
 *
 * Run against a dev server you started yourself:
 *   npx tsx tools/src/perf/render-frame-cost.ts http://127.0.0.1:5178 '?sandbox=beit_sahwan_outskirts&sur&civ'
 */
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:5178', query = '?sandbox=beit_sahwan_outskirts&sur&civ'] = process.argv.slice(2);
const VIEWS: [number, number, number][] = [
  [5, 22, 2.5],
  [22, 24, 0.5],
  [26, 22, 1.6],
];

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(base + '/' + query, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, { timeout: 60000 });
await page.waitForTimeout(3000);
const gpu = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
});
console.log(`renderer: ${gpu}`);
if (/SwiftShader/i.test(gpu)) console.warn('SOFTWARE GPU -- numbers are not comparable to a hardware run');
for (const [x, y, zoom] of VIEWS) {
  const stats = await page.evaluate(([cx, cy, cz]) => {
    const L = (window as unknown as { __lions: { renderer: { camera: { x: number; y: number; zoom: number }; frame(a: number, dt: number): void }; step(n: number): void } }).__lions;
    L.renderer.camera.x = cx;
    L.renderer.camera.y = cy;
    L.renderer.camera.zoom = cz;
    const times: number[] = [];
    for (let i = 0; i < 30; i++) L.renderer.frame(1, 16);
    for (let i = 0; i < 240; i++) {
      const t0 = performance.now();
      L.renderer.frame(1, 16);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { median: times[120], p95: times[228] };
  }, [x, y, zoom]);
  console.log(`view (${x},${y}) zoom ${zoom}: median ${stats.median.toFixed(2)} ms, p95 ${stats.p95.toFixed(2)} ms`);
}
await browser.close();
```

Run it against a dev server started from a `main` checkout (the lead's own worktree `.claude/worktrees/upgrades-easing` is at `main` but locked to another session — instead `git stash`-free option: check out `main` in a throwaway worktree: `/usr/bin/git worktree add --detach /tmp/rl-main main`, `pnpm install --prefer-offline` there, start its dev server on port 5179 in the background, run the script with `http://127.0.0.1:5179`, then stop that server (it is yours) and `git worktree remove --force /tmp/rl-main`). Record the three lines as "BEFORE (main @ 8db0215)".

- [ ] **Step 2: Add the AO pass**

`post-chain.ts`:
```ts
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
export const AO_RADIUS_TILES = 0.6;
export const AO_SCALE = 1.2;
export function createAoPass(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number): Pass {
  const pass = new GTAOPass(scene, camera, width, height);
  pass.updateGtaoMaterial({ radius: AO_RADIUS_TILES, scale: AO_SCALE, distanceExponent: 1, thickness: 1, distanceFallOff: 1, screenSpaceRadius: false });
  pass.blendIntensity = 1.0;
  pass.output = GTAOPass.OUTPUT.Default;
  return pass;
}
```
(`updateGtaoMaterial`'s parameter names are the r170 API; if TypeScript rejects a key, drop that key rather than guessing another.)

`ThreeRenderer.init()`: after `setFogPass`: `this.post.setAoPass(createAoPass(this.scene, this.viewCamera, this.cssWidth, this.cssHeight));`

`post-chain.test.ts`: add
```ts
  it('createAoPass is a GTAOPass at the spec radius and scale', () => {
    const pass = createAoPass(new THREE.Scene(), new THREE.OrthographicCamera(), 800, 600) as GTAOPass;
    expect(pass.constructor.name).toBe('GTAOPass');
    expect(AO_RADIUS_TILES).toBe(0.6);
    expect(AO_SCALE).toBe(1.2);
  });
```

- [ ] **Step 3: Run the suite and look**

Run: `pnpm vitest run packages/render && pnpm typecheck`. Then dev server, `?sandbox=beit_sahwan_outskirts`, camera `(5, 22)` zoom `2.5`: contact darkening under the Eitan's hull and along the house's wall base; no dark halo around the drone in the sky (if there is one, set `pass.updateGtaoMaterial({ ..., screenSpaceRadius: false })` is already false — reduce `AO_SCALE` to 0.8 and record the change).

- [ ] **Step 4: Measure AFTER, and decide**

Run `render-frame-cost.ts` against THIS worktree's server (5178). Acceptance: the zoom-0.5 view's p95 stays under 16.7 ms on the hardware GPU. If it does not: (a) set `pass.scale`/`radius` unchanged but construct the pass at half resolution (`createAoPass(scene, camera, width/2, height/2)`) and re-measure; (b) if still over, `setAoPass(null)` in `init` and leave `createAoPass` in place with a comment naming the measured cost — AO ships off, recorded. Write BEFORE/AFTER (and each ladder step tried) into `docs/PERFORMANCE.md` under a new heading "Lit renderer frame cost (2026-09-14)" with the GPU string the script printed.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/render/src/three/post-chain.ts packages/render/src/three/post-chain.test.ts packages/render/src/three/ThreeRenderer.ts tools/src/perf/render-frame-cost.ts docs/PERFORMANCE.md
/usr/bin/git commit -m "feat(render): ambient occlusion (GTAO, radius 0.6 tile) with the frame-cost instrument

BEFORE/AFTER at three views on <gpu>: <paste the six lines>.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Exporters stop dropping the PBR maps (Phase 0b, code only)

**Files:**
- Modify: `tools/vehicles/textured.py:56`, `tools/export_mesh_building.py:371`
- Test: `tools/test_textured.py` if it exists (`ls tools/test_*.py`), otherwise a Python doctest-free assertion run below

- [ ] **Step 1: Change the policy**

`tools/vehicles/textured.py`: `DROPPED_PREFIXES = ("metallic_roughness", "normal")` → `DROPPED_PREFIXES: tuple[str, ...] = ()` and rewrite the docstring paragraph that says the scene has no lights to read them: it does since 2026-09-14 (`packages/render/src/three/lighting.ts`); the maps ship at `TEXTURE_PX` like the base colour (the lead: "dont drop resolution").

`tools/export_mesh_building.py:371`: keep `export_materials="NONE"` for KIT-BUILT buildings (they are palette-painted at runtime) — this script exports kit geometry, so no change unless it is also the path for a textured source; read its docstring: if it only ever exports `kit.py` buildings, change nothing and say so in the commit. The Meshy building exporters (`tools/export_meshy_*.py`) route through `tools/vehicles/textured.py`'s policy or their own `export_materials="EXPORT"` — grep `DROPPED_PREFIXES\|export_materials` in `tools/export_meshy_*.py` and remove any local drop of `metallic_roughness`/`normal`.

- [ ] **Step 2: Verify the Python still imports**

Run: `python3 -c "import sys; sys.path.insert(0,'tools/vehicles'); import textured; print(textured.DROPPED_PREFIXES)"`
Expected: `()`. If `tools/test_textured.py` exists, run `python3 -m pytest tools/test_textured.py -q` and update any test that pinned the two dropped names.

- [ ] **Step 3: Commit**

```bash
/usr/bin/git add tools
/usr/bin/git commit -m "chore(tools): textured exports keep metallic_roughness and normal maps

The lit renderer consumes them (world-materials.ts texturedMaterial). The
re-export of the thirteen textured assets is a separate art task needing
Blender and the untracked sources in the main checkout.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Captures, the visual gate, and the documents

**Files:**
- Create: `tools/src/perf/art-captures.ts`
- Modify: `tools/src/golden-diff/baseline.ts` (floors), `tools/golden-baselines/<envKey>/*` (blessed), `CLAUDE.md`, `docs/ART_PIPELINE.md`, `docs/superpowers/specs/2026-09-14-lit-renderer-design.md`, `packages/render/src/three/terrain/surface.ts` (`SURFACE_SHADING_EXEMPTION`) and `surface.test.ts`

- [ ] **Step 1: The repeatable capture set**

```ts
// tools/src/perf/art-captures.ts
/**
 * The nine captures the 2026-09-14 art review was argued from, repeatable:
 *   npx tsx tools/src/perf/art-captures.ts http://127.0.0.1:5178 out/dir
 * Headless Chromium, SwiftShader, 1440x900, device pixel ratio 1.
 */
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';

const [base = 'http://127.0.0.1:5178', out = 'art-captures'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page: Page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

async function boot(url: string): Promise<void> {
  await page.goto(base + url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
}
async function cam(x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate(([cx, cy, cz]) => {
    const c = (window as unknown as { __lions: { renderer: { camera: { x: number; y: number; zoom: number } } } }).__lions.renderer.camera;
    c.x = cx; c.y = cy; c.zoom = cz;
  }, [x, y, zoom]);
  await page.waitForTimeout(600);
}
async function shot(name: string): Promise<void> {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('saved', name);
}

await boot('/?sandbox=beit_sahwan_outskirts&sur&civ');
await cam(22, 24, 0.5); await shot('01-wide-fog');
await cam(5, 22, 2.5); await shot('02-force-closeup');
await page.evaluate(() => { const L = (window as unknown as { __lions: { sel(ids: number[]): void; units(): { id: number }[] } }).__lions; L.sel(L.units().map((u) => u.id)); });
await page.mouse.click(784, 418, { button: 'right' });
await page.evaluate(() => (window as unknown as { __lions: { step(n: number): void } }).__lions.step(520));
await page.keyboard.press('Escape');
await cam(26, 22, 1.6); await shot('03-town-fight');
await cam(27, 22, 2.5); await shot('04-fight-closeup');
await cam(31, 21, 2.0); await shot('05-town-fog-blocks');
await boot('/?sandbox=beit_sahwan_outskirts&nomesh');
await cam(5, 22, 2.5); await shot('06-nomesh-billboards');
await boot('/?sandbox=tel_marum&tunnel&sur&roe&civ');
await cam(20, 18, 0.55); await shot('07-tel-marum-fog');
await page.goto(base + '/?campaign', { waitUntil: 'load' }); await page.waitForTimeout(6000); await shot('08-campaign-board');
await page.goto(base + '/', { waitUntil: 'load' }); await page.waitForTimeout(2500); await shot('09-menu');
await browser.close();
```

Run it from `tools/` against the 5178 server into `.superpowers/art-captures/after/` (gitignored). Read `02`, `01`, `03`, `05`, `07` and check the spec's acceptance list §"Acceptance" items 1–3. Fix anything that fails before blessing.

- [ ] **Step 2: Re-bless the visual gate**

Run: `pnpm golden-baseline` — expected exit 1 (every gated scenario differs; the run prints the deltas). Then:
```bash
pnpm golden-baseline:bless -- --reason="Phase 0 lit renderer: sun, shadows, AO, sRGB output, SMAA, texture fog (spec 2026-09-14-lit-renderer-design.md)"
```
Then run `pnpm golden-baseline` five times in a row and collect every layer-check delta line it prints (`scatter`, `decor`, `ground-albedo`, `buildings`, `units` over `quiet`, `open-ground`, `relief`, `vehicle`). For each check, set its floor in `baseline.ts` to one third of the smallest of the five measured signals (the file's own rule), and set `vehicle`'s `repaintControl` to the largest measured repaint drift plus 20%. Re-run once more: exit 0. Do NOT widen a scenario's `maxDiffPixels`/`maxMeanAbsChannelDelta` — those are noise ceilings against the fresh baseline and the noise model is unchanged.

- [ ] **Step 3: The exemption record**

`terrain/surface.ts` `SURFACE_SHADING_EXEMPTION`: rewrite `what` to "the drawn ground's six sampled albedos, applied as a ratio to each image's own mean" and `why` to "material and relief are legible; since 2026-09-14 the ground is lit and shadowed by the scene sun like every other object, so the shade term is no longer an exemption from anything"; trim `notExempt` to the entries that are still true (vertex colours palette-only; building footprints no albedo; knoll blobs). Update `surface.test.ts`'s `SURFACE_SHADING_EXEMPTION` describe to match (it checks that named assets appear in `what`/`notExempt`).

- [ ] **Step 4: Documents**

- `CLAUDE.md`, "The three.js backend" section: replace the bullet "**The colour pipeline is not the default one and fails silently.**" with a bullet "**The colour pipeline is the standard one since Phase 0 (2026-09-14).**" that states: `SRGBColorSpace` output, ACES in `OutputPass`, every world material is `MeshStandardMaterial` (`world-materials.ts`, `terrain/mesh.ts` `GroundMaterial`/`GroveMaterial`), one sun + hemisphere in `lighting.ts`, a 4096 map-wide shadow box, the composer in `post-chain.ts` (RenderPass → FogOfWarPass → GTAOPass → OutputPass → SMAAPass), fog as `shroud-texture.ts` + `fog-pass.ts`, flashes as pooled `PointLight`s, and the two rules that survive: vertex colours and shader-uniform colours must be LINEAR (`hexToLinear`, `toGeometry` decodes), and ground albedo textures stay `NoColorSpace` because they are ratio fields. Delete the bullets that describe `applyPalettePipeline`, the antialiasing ban and the `NoColorSpace` building maps; update the render-order bullet's band 10; update the "measured 0 of 65 colours in palette" sentence to say that guarantee was retired and why (the 11–25% measurement, with the report link).
- `docs/ART_PIPELINE.md` §0 and §2: §0 keeps "nobody hand-authors a sprite" for the sprite path and adds that mesh assets are lit at runtime by one sun; §2's "42 colors. Locked." becomes "the palette is the authored-colour source for UI, team colours, VFX keys, ramp albedos and terrain tones; it is not a per-pixel guarantee on the three.js backend since 2026-09-14". Note the sprite gate (`validate_assets.py`) is unchanged.
- The spec (`2026-09-14-lit-renderer-design.md`): set **Status** to "implemented on `worktree-art-uplift`", and add a "Deviations" section listing SMAA-for-MSAA and `NoColorSpace` ground albedos with the reasons from this plan's Global Constraints, plus the measured sun sign pair from Task 9 and the AO decision from Task 13.

- [ ] **Step 5: Full gate**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm validate:ui && pnpm test:determinism && pnpm playtest && pnpm balance
```
Expected: all green; `playtest` and `balance` output identical to `main` (renderer only — diff the printed tables against a run from the `/tmp/rl-main` worktree if it still exists, otherwise against the tables recorded in CLAUDE.md).

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add tools/src/perf/art-captures.ts tools/src/golden-diff/baseline.ts tools/golden-baselines CLAUDE.md docs/ART_PIPELINE.md docs/superpowers/specs/2026-09-14-lit-renderer-design.md packages/render/src/three/terrain/surface.ts packages/render/src/three/terrain/surface.test.ts
/usr/bin/git commit -m "docs,ci: bless the lit-renderer baselines, re-measure the layer floors, record the pipeline

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** §1 colour pipeline → Tasks 7, 12 (ground albedo deviation recorded). §2 lights → Tasks 1, 9. §3 shadows → Tasks 1, 5, 6, 9. §4 materials → Tasks 4, 5, 6 (billboards unchanged, tracks Task 11, flash Task 8, blob shadow Task 11). §5 camera/post → Tasks 2, 9, 13 (AA deviation recorded). §6 fog → Task 10. §7 debug layers/gate → Task 6 (uniforms field), Task 15. §8 exporters → Task 14. §9 campaign board → optional, not planned. §10 tests → each task. §11 performance → Task 13 (instrument + ladder). Acceptance 1–7 → Task 15 (1–3, 5, 7), Task 13 (6), Task 15 step 5 (4).

**Placeholders.** None: every step has code or an exact command. Two steps ask the executor to "update assertions" in existing tests by naming the assertion shape to change (`uniforms.uRamp` → `color`, `hexToUnit` → `hexToLinear`), with the replacement shown.

**Type consistency.** `createSceneLights(width, height): SceneLights { sun, hemisphere, addTo, dispose }` used in Task 9. `updateDimetricCamera(cam, vp, camera)` used in Task 9. `srgbToLinear`/`hexToLinear` used in Tasks 3, 10, 11, 12. `rampMaterial`/`texturedMaterial`/`texturedMapMaterial`/`prepareTexturedMap`/`liftTone` used in Tasks 5, 6, 7. `GroundMaterial.uniforms` used by `setGroundAlbedoOn`/`loadGroundTexture` (unchanged code) and `debug-layers.test.ts`. `PostChain.setFogPass/setAoPass` used in Tasks 10, 13. `FogOfWarPass.updateCamera` used in Task 10. `FlashLightManager.spawn(x, z, groundY, spec, colorHex)` used in Task 8's renderer edit. `TRACK_OPACITY` in Task 11.
