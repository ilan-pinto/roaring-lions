/**
 * Tear down a `THREE.WebGLRenderer` AND hand its WebGL context back.
 *
 * `WebGLRenderer.dispose()` does not do the second half. In three r170 it
 * frees what its own caches hold (programs, render lists, bindings), removes
 * its three canvas listeners, and returns -- the context itself stays alive
 * until the browser garbage-collects the canvas. Measured on 2026-09-24
 * (headless Chromium, ANGLE/Metal, Apple M3 Pro): a mission-sized scene
 * held 437-450 MB of GPU-process footprint after `dispose()`, and 41-43 MB
 * once `WEBGL_lose_context.loseContext()` was called on top of it.
 * `dispose()` lost the context in 0 of 3 runs. Through the app's own leave
 * (`beit_sahwan_1_recon` at 1400x900, the HUD's leave and then the board's
 * back link, same browser and GPU path) the GPU process read 374-420 MB back
 * on the menu, against 82-84 MB with this call, 3 runs each. When the
 * garbage collector gets to a canvas is not something this code can know,
 * and a browser caps live contexts at roughly 16.
 *
 * The ORDER is deliberate, and each half of it was measured rather than
 * assumed (headless Chromium, Metal, SwiftShader and the default GPU path
 * alike):
 *
 * - **`dispose()` first, while the context is still live**, so the GL
 *   objects it deletes are deleted by a context that can act on the call.
 * - **Then `forceContextLoss()`, in the same task.** The `webglcontextlost`
 *   event is dispatched ASYNCHRONOUSLY, and by the time it arrives
 *   `dispose()` has already taken three's listener off the canvas -- so
 *   three prints nothing. Lose first and let the event land before
 *   `dispose()`, and three prints `THREE.WebGLRenderer: Context Lost.` at
 *   console level `log` on every leave. Nothing at `error` either way, which
 *   is what `pnpm ui:routes` fails on.
 * - **Not at all if the context is already lost** -- the browser took it
 *   (a GPU reset), or this ran twice. `loseContext()` on a lost context prints
 *   `WebGL: INVALID_OPERATION: loseContext: context already lost` at level
 *   `warning`. `isContextLost()` is the only honest guard: three's own
 *   `_isContextLost` is set by the very listener `dispose()` removes.
 *
 * The consequence a caller must own: three never learns the context is gone,
 * so `render()` is NOT a no-op afterwards the way it is after a loss three
 * saw. Measured on a lost context: a plain `render()` returned quietly, but a
 * render into a fresh `WebGLRenderTarget` threw `TypeError: Cannot read
 * properties of null (reading 'trim')` from shader compilation. Whoever
 * calls this must stop drawing first and never draw again --
 * `ThreeRenderer`'s `disposed` flag and the campaign view's are that.
 */
import type * as THREE from 'three';

/** The three members this touches. Structural so a test's stand-in for
 *  `THREE.WebGLRenderer` -- which cannot construct without a GPU -- can
 *  satisfy it without being one. */
export type ContextOwner = Pick<THREE.WebGLRenderer, 'dispose' | 'getContext' | 'forceContextLoss'>;

/** Dispose `renderer`, then lose its context unless it is lost already.
 *  Returns whether this call was the one that lost it. */
export function disposeAndReleaseContext(renderer: ContextOwner): boolean {
  renderer.dispose();
  if (renderer.getContext().isContextLost()) return false;
  renderer.forceContextLoss();
  return true;
}
