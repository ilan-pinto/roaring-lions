/**
 * Whether this browser can draw three.js at all -- asked by the two screens
 * that draw a three.js scene outside a mission: the campaign board
 * (`worldmap3d.ts`) and the scene host behind the menu (`scene-host.ts`).
 *
 * Probed BEFORE the dynamic import, not after it fails: three.js is ~700 kB
 * and a browser with no WebGL2 will not draw a pixel of it. Cheap -- one
 * throwaway canvas -- and it is also what keeps both screens out of three in
 * a jsdom test run.
 *
 * The probe's context is LOST before returning, as `atlas.ts`'s
 * `queryArrayLayerLimit` does with its own: otherwise it holds one of the
 * browser's ~16 context slots until the canvas is garbage-collected, and it
 * was measured still alive 7 s after a visit to the campaign board. The scene
 * host probes on every menu mount, so without the release every return to the
 * menu would cost one more slot.
 *
 * Moved here from `worldmap3d.ts` (scene-host plan, Task 6), unchanged, rather
 * than copied: two copies of a probe is two places for that release to be
 * forgotten. `worldmap3d.test.ts`'s "the WebGL2 probe gives its own context
 * back" is its guard.
 */
export function webgl2Available(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}
