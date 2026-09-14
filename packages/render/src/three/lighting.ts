/**
 * The scene's light: one sun, one sky/ground bounce, one map-wide shadow box.
 *
 * Phase 0 of the art uplift (docs/superpowers/specs/2026-09-14-lit-renderer-
 * design.md §2-3). Before this file the backend had NO lights: every
 * material quantised its own N·L against a private `uLightDir`, and the
 * three colour systems on screen disagreed on where the sun was.
 *
 * `SUN_DIRECTION` is the render rig's own sun (`tools/dimetric.py`
 * `build_lights`, azimuth 135°, altitude 55°) carried into three's frame:
 * Blender's beam `(-0.406, -0.406, -0.819)` (X, Y, Z-up) points AWAY from
 * the sun, so the to-sun vector is `(0.406, 0.406, 0.819)`, and with tile
 * x -> world X, tile y -> world Z, Blender Y -> world Z, that is
 * `(0.406, 0.819, 0.406)`. Its XZ sign pair (+, +) puts the sun on the same
 * side of the map as the camera (`camera.ts` `VIEW_DIRECTION`), i.e. the
 * faces the camera sees are the lit ones -- which is what a sprite sheet
 * rendered by that rig shows, and what Task 9 verifies on screen against a
 * billboard before the vector is trusted.
 */
import * as THREE from 'three';

export const SUN_DIRECTION = new THREE.Vector3(0.406, 0.819, 0.406).normalize();
/** ACES needs headroom: 2.6 lands a `limestone.0` wall facing the sun at
 *  roughly its authored brightness after tone mapping. Tune by eye only
 *  against that property (spec §1). */
export const SUN_INTENSITY = 2.6;
export const HEMISPHERE_INTENSITY = 0.9;
/** Palette keys, resolved by the caller: `limestone.0` sun, `water.0` sky,
 *  `dust.4` ground. Hex fallbacks are those entries as of 2026-09-14. */
export const SUN_COLOR_HEX = '#F2E8D5';
export const SKY_COLOR_HEX = '#A9C4D1';
export const GROUND_BOUNCE_COLOR_HEX = '#96703C';
export const SHADOW_MAP_SIZE = 4096;
/** World units beyond the map edge the shadow box covers, so a unit standing
 *  on the last tile still casts onto the ground beside it. */
export const SHADOW_MARGIN_TILES = 2;
/** The tallest thing the box must contain: a building roof (< 4 world units)
 *  over elevation level 9 (~2.3). Rounded up. */
export const SHADOW_BOX_TOP = 8;
export const SHADOW_BOX_BOTTOM = -1;

export interface SceneLights {
  readonly sun: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;
  addTo(scene: THREE.Object3D): void;
  dispose(): void;
}

/** Half the map diagonal plus the margin: a box this wide, centred on the map
 *  and oriented along the sun, covers the whole map at any sun azimuth. */
export function shadowBoxRadius(width: number, height: number): number {
  return Math.hypot(width / 2, height / 2) + SHADOW_MARGIN_TILES;
}

export function createSceneLights(width: number, height: number): SceneLights {
  const centre = new THREE.Vector3(width / 2, 0, height / 2);
  const r = shadowBoxRadius(width, height);

  const sun = new THREE.DirectionalLight(new THREE.Color(SUN_COLOR_HEX), SUN_INTENSITY);
  sun.position.copy(centre).addScaledVector(SUN_DIRECTION, r * 2);
  sun.target.position.copy(centre);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  const cam = sun.shadow.camera;
  cam.left = -r;
  cam.right = r;
  cam.top = r;
  cam.bottom = -r;
  // The box is oriented along the sun and centred r*2 away, so the map's
  // vertical extent projects onto the sun axis at most r*2 +/- (r + top).
  cam.near = 1;
  cam.far = r * 4;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;

  const hemisphere = new THREE.HemisphereLight(
    new THREE.Color(SKY_COLOR_HEX),
    new THREE.Color(GROUND_BOUNCE_COLOR_HEX),
    HEMISPHERE_INTENSITY
  );

  return {
    sun,
    hemisphere,
    addTo(scene) {
      scene.add(sun, sun.target, hemisphere);
    },
    dispose() {
      sun.dispose();
      hemisphere.dispose();
    },
  };
}
