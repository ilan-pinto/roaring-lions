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
