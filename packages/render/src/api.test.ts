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
