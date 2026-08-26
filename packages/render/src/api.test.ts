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
