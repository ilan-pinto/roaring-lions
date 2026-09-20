/**
 * The seam's contract, tested where it can be tested without a GPU.
 *
 * `PixiRenderer` cannot be constructed under environment: 'node' -- it needs a
 * WebGL context -- so this suite does NOT instantiate it. What remains here is
 * the one check that is about the `Renderer` interface itself rather than
 * about projection arithmetic: that `width`/`height` report the constructed
 * viewport instead of making callers recompute it. The `Pick<Renderer, ...>`
 * annotation on `stubRenderer` is the interface's own signature check -- it
 * fails to typecheck if `worldToScreen`/`screenToWorld`/`camera` drift from
 * `Renderer`'s declared shape.
 *
 * The projection behaviour itself -- worldToScreen/screenToWorld inverting,
 * the camera centring, and the rest of the contract -- is asserted once,
 * against every implementation, in conformance.ts/conformance.test.ts.
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
    worldToScreen: (wx, wy) => worldToScreen(wx, wy, cam, vp),
    screenToWorld: (px, py) => screenToWorldFlat(px, py, cam, vp),
  };
}

describe('Renderer projection contract', () => {
  const r = stubRenderer({ x: 24, y: 24, zoom: 1 }, { width: 800, height: 600 });

  it('reports its own viewport rather than making callers find it', () => {
    expect(r.width).toBe(800);
    expect(r.height).toBe(600);
  });
});

/**
 * The optional half of the seam, which is where a FROZEN backend lives.
 *
 * `renderer.ts` (Pixi) is frozen and cannot grow a member, so anything only
 * the three.js backend can answer arrives on this interface as optional and
 * the app carries the fallback. That optionality is a compile-time property
 * with no runtime shadow, so the check below is half a TYPE assertion -- the
 * annotated literal compiles only while the member is optional, and making
 * it required is what turns this file red under `pnpm typecheck` -- and half
 * a runtime one, exercising the exact `?.() ?? null` shape `main.ts` uses so
 * that "the app falls back" is asserted rather than assumed.
 */
describe('Renderer optional members', () => {
  it('lets a frozen backend implement captureGroundAlbedo not at all', () => {
    // No `captureGroundAlbedo` key. This annotation is the assertion: if the
    // member were required, `tsc` would reject the literal here.
    const frozenBackend: Pick<Renderer, 'width' | 'height' | 'captureGroundAlbedo'> = {
      width: 800,
      height: 600,
    };
    expect(frozenBackend.captureGroundAlbedo).toBeUndefined();
    // What `main.ts` actually writes, and what makes the Pixi minimap keep
    // the painted terrain rather than throw.
    expect(frozenBackend.captureGroundAlbedo?.(210) ?? null).toBeNull();
  });

  it('types the photograph as ImageData a 2D context can take, or null', () => {
    // A backend that DOES implement it. The annotation is again the
    // assertion: a signature that drifted -- a different argument, a texture
    // or a canvas in place of `ImageData`, a return that cannot be null --
    // fails to typecheck here rather than at the one call site in `main.ts`.
    const threeLike: Pick<Renderer, 'captureGroundAlbedo'> = {
      captureGroundAlbedo: (sizePx: number): ImageData | null => (sizePx > 0 ? null : null),
    };
    expect(threeLike.captureGroundAlbedo?.(210)).toBeNull();
  });
});
