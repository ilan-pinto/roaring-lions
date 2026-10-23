import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSceneLights, shadowBoxRadius, SUN_DIRECTION } from './lighting';
import { dimetricCamera } from './camera';
import { fitShadowBox, viewReceiverBox } from './shadow-fit';

const W = 48;
const H = 48;
const centre = new THREE.Vector3(W / 2, 0, H / 2);
const R = shadowBoxRadius(W, H);

function fit(x: number, y: number, zoom: number, snap = true) {
  const lights = createSceneLights(W, H);
  const view = dimetricCamera({ x, y, zoom }, { width: 1440, height: 900 });
  const r = fitShadowBox(lights.sun, 'view', view, SUN_DIRECTION, centre, R, -1, 4, snap);
  return { r, lights, view };
}

/** Clip-space position of a world point in the sun's shadow camera. */
function shadowClip(sun: THREE.DirectionalLight, p: THREE.Vector3): THREE.Vector3 {
  sun.updateMatrixWorld(true);
  sun.target.updateMatrixWorld(true);
  sun.shadow.updateMatrices(sun);
  const cam = sun.shadow.camera;
  return p.clone().applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
}

describe('shadow-fit (Defilade Task 2 prototype)', () => {
  it('map mode is the map-wide box createSceneLights builds, to the bit', () => {
    const a = createSceneLights(W, H);
    const b = createSceneLights(W, H);
    const view = dimetricCamera({ x: 20, y: 20, zoom: 1 }, { width: 1440, height: 900 });
    fitShadowBox(b.sun, 'map', view, SUN_DIRECTION, centre, R, -1, 4);
    expect(b.sun.position.toArray()).toEqual(a.sun.position.toArray());
    expect(b.sun.target.position.toArray()).toEqual(a.sun.target.position.toArray());
    expect(b.sun.shadow.camera.left).toBe(a.sun.shadow.camera.left);
  });

  it('is tighter than the map box at zoom 1 and falls back to it zoomed far out', () => {
    expect(fit(24, 24, 1).r.halfX).toBeLessThan(R * 0.75);
    expect(fit(24, 24, 1).r.halfY).toBeLessThan(R * 0.5);
    expect(fit(24, 24, 0.35).r.halfX).toBe(R);
  });

  it('size does not depend on the pan, and the centre sits on the texel grid', () => {
    const a = fit(20, 22, 1).r;
    const b = fit(20.137, 22.291, 1).r;
    expect(b.halfX).toBe(a.halfX);
    expect(b.halfY).toBe(a.halfY);
    // Near the map edge too, where an intersect (rather than a clamp) with
    // the map box would shrink the box as it pans.
    const e1 = fit(2, 3, 1).r;
    const e2 = fit(0.4, 1.1, 1).r;
    expect(e1.halfX).toBe(a.halfX);
    expect(e2.halfX).toBe(a.halfX);
    expect(e2.halfY).toBe(a.halfY);
    for (const r of [a, b]) {
      expect(Math.abs(r.cx / r.texelX - Math.round(r.cx / r.texelX))).toBeLessThan(1e-6);
      expect(Math.abs(r.cy / r.texelY - Math.round(r.cy / r.texelY))).toBeLessThan(1e-6);
    }
  });

  it('the snapped box contains the whole receiver slab at any pan', () => {
    for (const [x, y] of [[14, 30], [14.0371, 30.219], [24.5, 24.5], [3.3, 40.1]]) {
      const { r, lights, view } = fit(x, y, 1.6);
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const n = new THREE.Vector3(sx, sy, -1).unproject(view);
          const f = new THREE.Vector3(sx, sy, 1).unproject(view);
          for (const h of [-1, 4]) {
            const p = n.clone().lerp(f, (h - n.y) / (f.y - n.y));
            // Inside the map box only: the clamp keeps the box there.
            if (p.x < -2 || p.z < -2 || p.x > W + 2 || p.z > H + 2) continue;
            const c = shadowClip(lights.sun, p);
            expect(Math.abs(c.x)).toBeLessThanOrEqual(1 + 1e-9);
            expect(Math.abs(c.y)).toBeLessThanOrEqual(1 + 1e-9);
          }
        }
      }
      expect(r.halfX).toBeGreaterThan(0);
    }
  });

  it('every receiver the view can draw is inside the fitted box, and every caster is inside its depth', () => {
    const { r, lights, view } = fit(14, 30, 1.6);
    const b = viewReceiverBox(view, SUN_DIRECTION, centre, -1, 4);
    expect(b.maxX - b.minX).toBeLessThanOrEqual(2 * r.halfX + 1e-9);
    // The view's own ground corners, through the shadow camera.
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const n = new THREE.Vector3(sx, sy, -1).unproject(view);
        const f = new THREE.Vector3(sx, sy, 1).unproject(view);
        const t = (0 - n.y) / (f.y - n.y);
        const p = n.clone().lerp(f, t);
        const c = shadowClip(lights.sun, p);
        expect(Math.abs(c.x)).toBeLessThanOrEqual(1 + 1e-6);
        expect(Math.abs(c.y)).toBeLessThanOrEqual(1 + 1e-6);
      }
    }
    // A roof at the far map corner still sits inside the depth range.
    for (const p of [new THREE.Vector3(0, 8, 0), new THREE.Vector3(W, 8, H), new THREE.Vector3(0, -1, H)]) {
      expect(Math.abs(shadowClip(lights.sun, p).z)).toBeLessThanOrEqual(1);
    }
  });
});
