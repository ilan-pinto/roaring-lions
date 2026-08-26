# Phase B1 outcome — what B2 inherits

**Date:** 2026-08-27
**Issue:** 123
**Plan:** `docs/superpowers/plans/2026-08-26-three-renderer-phase-b1.md`
**Spec:** `docs/superpowers/specs/2026-08-26-three-renderer-design.md`
**Commits:** `2104293..81ecc6a`, twelve commits on `feat/three-renderer`

B1 delivered what it set out to: `?renderer=three` boots to the palette background,
projects identically to Pixi, and cannot emit an off-palette colour. Pixi remains the
default and its behaviour is unchanged.

This document is the part worth keeping — the hazards B2 walks into. Every one of them
is dormant only because B1 draws nothing.

---

## Two mistakes B1 made, and the shape they share

Both were caught, both were expensive to find, and both will recur in B2 if the lesson
is not carried.

**The camera shipped a wrong elevation angle that seven green tests could not see.**
Under a ground-plane projection match alone, the elevation angle is a *free parameter* —
`sin(EL)` cancels between the up axis and `halfHeight`, so every angle reproduces Pixi's
iso formula exactly. The fix required deriving the condition that actually pins it
(square pixels, giving `asin(TILE_H/TILE_W)` = 30°) and adding a test for *that*. The
frustum-aspect test in `camera.test.ts` is now the **sole** guard on the angle; because
`WORLD_Y_PER_LIFT_PIXEL` is derived from `ELEVATION`, even the lift test stays green
under a wrong angle. Weaken that one test and the camera is un-pinned, silently.

**The first conformance suite missed a 1% `halfWidth` error entirely.** Five properties
that all described *relationships* pinned no absolute scale. A sixth property was added
to anchor it.

The shared shape: a test that constrains relationships while leaving a parameter free
looks exactly like a test that constrains everything. **The only reliable check is to
break the thing deliberately and confirm which test fails.** Every task in B1 was
required to do this, and it caught something every time it was run.

## What B2 inherits

**1. `ThreeRenderer` cannot be constructed in `environment: 'node'`.** `new
THREE.WebGLRenderer()` runs in the *constructor*, not `init`, and needs real WebGL2 —
node and jsdom both fail. There is no `ThreeRenderer.test.ts` and there cannot be one,
so B1's store-and-return members, `fitToHost` and the resize observer are all unreachable
from `pnpm test`; they rest entirely on browser sessions. B1's plan promised "scene
contents are unit-tested in CI" and that is not currently reachable.

**Decide this in B2's plan, not during it.** Either extract mesh construction into pure
functions (`buildTerrainMesh(map, tones) → THREE.Mesh`, testable headless) or inject the
`WebGLRenderer`. Retrofitting after mesh code exists is far worse than choosing now.

**2. The toon shader has never been compiled by a GL driver.** `toonRampMaterial` is
exported, tested, and used by nothing. Its tests assert JS-side uniform *data* —
`uRamp` padding to `RAMP_MAX`, `uSteps`, hex round-trip. Phase 0's central guarantee, that
a fragment can only write values read out of the LUT, is therefore **asserted, not
demonstrated**. The first GLSL compile error, precision issue, or GLSL3 mismatch lands
on B2.

**3. Only the clear colour is proven byte-exact through a real GPU.** The browser
readback (`#14150F` = `paletteColor('shadow.1')`, centre and corner) walks the real
product path, but nothing shader-drawn exists yet, so `outputColorSpace`'s texel encode
is untested end to end. **B2 owes the same `readPixels` check on a shaded fragment** —
that is the first moment the palette guarantee is testable rather than argued.

**4. The conformance suite's Pixi arm tests a function below the seam.**
`conformance.test.ts` binds `project.screenToWorldFlat`, not `PixiRenderer.screenToWorld`,
which layers a lift approximation on top that three's ground-plane raycast does not
reproduce. It reads as "the seam agrees across backends"; it is really "two flat-ground
helpers agree", and it is green only because nothing has terrain. **The instant B2 draws
elevation this suite needs rewriting, not extending**, and `screenToWorld` conformance on
relief is an open design question — Pixi's own comment calls its answer "approximate, and
deliberately so".

**5. Two height conventions already coexist in `camera.ts`.** `WORLD_Y_PER_LIFT_PIXEL`
converts Pixi's lift-pixels into world-Y; B2's terrain uses world-Y natively. The
`Renderer` seam deliberately has no `lift` at all. B2 must not grow a third path. The
world-space convention — game tile `(x, y)` → three.js `(x, elevation, y)`, three's Y is
up — is stated in `camera.ts`, which is where B2's author will be reading.

**6. Projection allocates per call.** `worldToScreenThree`/`screenToWorldThree` each
construct a fresh `OrthographicCamera` (plus matrix updates, `Raycaster`, `Plane`,
`Vector3`s). Free at B1's call volume. **B3 calls these per unit per frame** — memoise
the camera then, where it can be measured rather than guessed.

## The stub rule, which B2 must keep applying

Members not yet implemented are classified, not blanket-thrown. The rule, learned the
hard way after a `notYet` throw inside `updateHover` silently killed the contextual
cursor and another inside the tick loop killed `runtime.completeObjective`:

> Nothing reached from the frame loop, the tick loop, or a block whose tail matters may
> throw — unless fabricating an answer is the only alternative.

- **Retain and return** data pushed in that a later phase will draw (`setDecor`,
  `setElevation`, `useEmitters`, `loadSprites`, `loadStructureSprite`,
  `setTutorialFocus`, `clearTutorialFocus`).
- **Truthful no-op** where "nothing to do" is the honest answer (`snapshot`, `onEvents`,
  `addOrderMarker`, and `isVisible` returning `true` — no fog exists until B4, so nothing
  is hidden).
- **Throw** only where an answer would have to be invented: `pickUnit` and
  `unitsInScreenRect`. Both would return `-1`/`[]`, both read as "empty ground", and both
  would be acted on. Neither is loop-reached, so the cost is one stuck drag box per stray
  click — paid deliberately, because silent wrongness in a selection is worse.

A sweep for this is only as good as the path it walks. B1's first two sweeps ran the
**sandbox** path and came back clean while `clearTutorialFocus` was throwing at 20 Hz on
the **mission** path. Walk both.

## Bundling

`ThreeRenderer` is behind its own entry point and dynamically imported, and is
deliberately **not** exported from `packages/render/src/index.ts` — the barrel pulls
three.js in for every importer, so re-adding it there puts a second renderer in the
default player's main chunk. That regression was live in B1 until the final review:
main chunk 1,081 kB → 617 kB (gzip 306 → 190) once fixed. Keep new three.js code behind
that boundary and check the built chunks, not the reasoning.
