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
