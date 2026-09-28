// packages/render/src/three/lighting.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  SUN_DIRECTION,
  SUN_INTENSITY,
  HEMISPHERE_INTENSITY,
  SHADOW_MAP_SIZE,
  SHADOW_BOX_TOP,
  SHADOW_BOX_BOTTOM,
  SUN_COLOR_HEX,
  SKY_COLOR_HEX,
  GROUND_BOUNCE_COLOR_HEX,
  DAY_LIGHTS,
  createSceneLights,
  shadowBoxRadius,
} from './lighting';
import { TIME_OF_DAY_PRESETS, sunDirectionFor } from './time-of-day';

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
  it('sun is the side light at rig azimuth 135 / altitude 55: X and Z differ in sign ON PURPOSE', () => {
    // The rig's stated azimuth 135 is the CAMERA'S LEFT (the camera sits at
    // 225, so its right-hand vector points at 315). Normalised, the to-sun
    // vector is (-0.406, 0.819, 0.406) to three decimals. The X/Z signs
    // differing is the whole point -- an equal pair lies in the camera's own
    // azimuth plane, lights both camera-facing faces identically and throws
    // its shadow straight up-screen, inside the caster. Do NOT "restore" the
    // agreement this test used to demand; see lighting.ts's header for the
    // two retired alternatives and their measurements.
    expect(SUN_DIRECTION.length()).toBeCloseTo(1, 6);
    expect(SUN_DIRECTION.x).toBeCloseTo(-0.406, 3);
    expect(SUN_DIRECTION.y).toBeCloseTo(0.819, 3);
    expect(SUN_DIRECTION.z).toBeCloseTo(0.406, 3);
    expect(Math.sign(SUN_DIRECTION.x)).not.toBe(Math.sign(SUN_DIRECTION.z));
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
  ])('shadow box contains every tile corner of a %dx%d map over its whole declared height', (w, h) => {
    // Sampled from the CONSTANTS, not from the -1/+6 literals this used to
    // carry: `SHADOW_BOX_TOP` is 8, so the old top sample sat two world units
    // BELOW the box's own declared roof and a regression that shortened the
    // box to 6 would have passed. The constants are the claim; the test has
    // to read them.
    const { lights } = scene(w, h);
    for (const y of [SHADOW_BOX_BOTTOM, 0, SHADOW_BOX_TOP / 2, SHADOW_BOX_TOP]) {
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

  it('defaults the shadow map to SHADOW_MAP_SIZE, and follows an explicit shadowMapSize otherwise', () => {
    // Task 14: the quality preset. Every pre-existing caller (this file's own
    // `scene()` included) passes nothing for the third argument and must keep
    // building today's 4096 map -- falsify by hard-coding the low preset's
    // 1024 as the default and watch this go red.
    const { lights: defaultLights } = scene(48, 48);
    expect(defaultLights.sun.shadow.mapSize.x).toBe(SHADOW_MAP_SIZE);
    expect(defaultLights.sun.shadow.mapSize.y).toBe(SHADOW_MAP_SIZE);

    for (const size of [1024, 2048, 4096] as const) {
      const s = new THREE.Scene();
      const lights = createSceneLights(48, 48, size);
      lights.addTo(s);
      expect(lights.sun.shadow.mapSize.x).toBe(size);
      expect(lights.sun.shadow.mapSize.y).toBe(size);
    }
  });
});

describe('createSceneLights takes a preset, and day is today', () => {
  it('builds identical lights with no preset and with DAY_LIGHTS', () => {
    const a = createSceneLights(48, 48);
    const b = createSceneLights(48, 48, SHADOW_MAP_SIZE, DAY_LIGHTS);
    for (const k of ['x', 'y', 'z'] as const) expect(Object.is(a.sun.position[k], b.sun.position[k])).toBe(true);
    expect(b.sun.color.getHex()).toBe(a.sun.color.getHex());
    expect(b.sun.intensity).toBe(a.sun.intensity);
    expect(b.hemisphere.color.getHex()).toBe(a.hemisphere.color.getHex());
    expect(b.hemisphere.groundColor.getHex()).toBe(a.hemisphere.groundColor.getHex());
    expect(b.hemisphere.intensity).toBe(a.hemisphere.intensity);
  });

  // DAY_LIGHTS is today's constants by name, not a copy of their values.
  it("holds today's constants exactly", () => {
    expect(DAY_LIGHTS.direction).toBe(SUN_DIRECTION);
    expect(DAY_LIGHTS.sunHex).toBe(SUN_COLOR_HEX);
    expect(DAY_LIGHTS.sunIntensity).toBe(SUN_INTENSITY);
    expect(DAY_LIGHTS.skyHex).toBe(SKY_COLOR_HEX);
    expect(DAY_LIGHTS.bounceHex).toBe(GROUND_BOUNCE_COLOR_HEX);
    expect(DAY_LIGHTS.hemiIntensity).toBe(HEMISPHERE_INTENSITY);
  });

  it('follows the colours and intensities it is handed', () => {
    const l = createSceneLights(48, 48, SHADOW_MAP_SIZE, {
      ...DAY_LIGHTS,
      sunHex: '#E0B87A',
      sunIntensity: 1.8,
      skyHex: '#8E9491',
      hemiIntensity: 0.7,
    });
    expect(l.sun.color.getHex()).toBe(new THREE.Color('#E0B87A').getHex());
    expect(l.sun.intensity).toBe(1.8);
    expect(l.hemisphere.color.getHex()).toBe(new THREE.Color('#8E9491').getHex());
    expect(l.hemisphere.groundColor.getHex()).toBe(new THREE.Color(GROUND_BOUNCE_COLOR_HEX).getHex());
    expect(l.hemisphere.intensity).toBe(0.7);
  });

  // A low sun lengthens shadows; the box must still hold every caster.
  it.each(['dawn', 'day', 'dusk'] as const)('%s: every corner of the map box sits inside the shadow frustum', (t) => {
    const [x, y, z] = sunDirectionFor(TIME_OF_DAY_PRESETS[t]);
    const lights = createSceneLights(48, 40, SHADOW_MAP_SIZE, { ...DAY_LIGHTS, direction: new THREE.Vector3(x, y, z) });
    const cam = lights.sun.shadow.camera;
    lights.sun.updateMatrixWorld();
    lights.sun.target.updateMatrixWorld();
    cam.position.copy(lights.sun.position);
    cam.lookAt(lights.sun.target.position);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    for (const cx of [0, 48]) for (const cz of [0, 40]) for (const cy of [SHADOW_BOX_BOTTOM, SHADOW_BOX_TOP]) {
      const p = new THREE.Vector3(cx, cy, cz).applyMatrix4(inv);
      expect(p.x).toBeGreaterThanOrEqual(cam.left);
      expect(p.x).toBeLessThanOrEqual(cam.right);
      expect(p.y).toBeGreaterThanOrEqual(cam.bottom);
      expect(p.y).toBeLessThanOrEqual(cam.top);
      expect(-p.z).toBeGreaterThanOrEqual(cam.near);
      expect(-p.z).toBeLessThanOrEqual(cam.far);
    }
  });
});
