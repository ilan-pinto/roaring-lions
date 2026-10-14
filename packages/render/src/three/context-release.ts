/**
 * Tear down a `THREE.WebGLRenderer` AND hand its WebGL context back.
 *
 * `WebGLRenderer.dispose()` does not do the second half. In three r170 (and
 * still in r186) it
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

/**
 * three's DFG lookup texture, once any renderer here has drawn a physical
 * material -- and the reason a released renderer stayed reachable for the
 * rest of the session on three r181-r186.
 *
 * From r181 every `MeshStandardMaterial` samples ONE module-level
 * `DataTexture` (`getDFGLUT()`, never exported), and every `WebGLRenderer`
 * that uploads it hangs its `onTextureDispose` listener on it. Nothing ever
 * disposes that texture, and `WebGLRenderer.dispose()` does not take the
 * listener off, so the closure -- that renderer's texture manager, its
 * program cache, its render lists, and through them the canvas, the context
 * and the last scene it drew -- is reachable from a module scope for ever.
 * Measured on the r186 upgrade (dependabot #569, then this branch's heap
 * snapshot, menu -> campaign board): the scene host's renderer retained via
 * `DFG_LUT._listeners.dispose[0]` -> `onTextureDispose`, one lost context
 * "still reachable" per screen left, and +772..+2298 DOM nodes by the third
 * mission. Upstream mrdoob/three.js#34571, fixed for r187 by #34530.
 *
 * It is reached through the one place three puts it where a caller can see
 * it: the `dfgLUT` uniform of a physical material this renderer has drawn
 * (`renderer.properties.get(material).uniforms`). It is a singleton, so one
 * sighting serves every renderer for the rest of the page.
 */
let dfgLut: THREE.Texture | null = null;

/** Structural, like `ContextOwner`: test stand-ins have no `properties`. */
type PropertiesOwner = { properties?: { get(object: object): { uniforms?: Record<string, { value?: unknown } | undefined> } } };

/**
 * Note three's shared DFG lookup texture (see `dfgLut`) from any material
 * under `root` that `renderer` has drawn. Call it BEFORE the materials are
 * disposed: a disposed material's renderer properties are gone with it.
 * Cheap once found -- it returns at the first call after that.
 */
export function noteSharedTextures(renderer: PropertiesOwner | object, root: THREE.Object3D | null | undefined): void {
  if (dfgLut !== null || !root) return;
  const properties = (renderer as PropertiesOwner).properties;
  if (!properties) return;
  root.traverse((o) => {
    if (dfgLut !== null) return;
    const m = (o as { material?: THREE.Material | THREE.Material[] }).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      const value = properties.get(mat).uniforms?.dfgLUT?.value;
      if (value && (value as THREE.Texture).isTexture === true) {
        dfgLut = value as THREE.Texture;
        return;
      }
    }
  });
}

/** Test seam: what `noteSharedTextures` found, and a way to forget it. */
export function sharedDfgLutForTest(): THREE.Texture | null {
  return dfgLut;
}
export function forgetSharedTexturesForTest(): void {
  dfgLut = null;
}

/** Dispose `renderer`, then lose its context unless it is lost already.
 *  Returns whether this call was the one that lost it.
 *
 *  First, while the context is still live, it disposes three's shared DFG
 *  lookup texture if one has been noted (`dfgLut`): dispatching `dispose`
 *  runs EVERY renderer's listener on it, so each drops its GL copy and its
 *  listener -- the only way to get this renderer's listener off. A renderer
 *  still drawing re-uploads the 16x16 texture on its next frame and hangs
 *  a fresh listener, which its own release will take off again. */
export function disposeAndReleaseContext(renderer: ContextOwner): boolean {
  dfgLut?.dispose();
  renderer.dispose();
  if (renderer.getContext().isContextLost()) return false;
  renderer.forceContextLoss();
  return true;
}
