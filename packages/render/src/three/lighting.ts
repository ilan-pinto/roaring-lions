/**
 * The scene's light: one sun, one sky/ground bounce, one map-wide shadow box.
 *
 * Phase 0 of the art uplift (docs/superpowers/specs/2026-09-14-lit-renderer-
 * design.md §2-3). Before this file the backend had NO lights: every
 * material quantised its own N·L against a private `uLightDir`, and the
 * three colour systems on screen disagreed on where the sun was.
 *
 * `SUN_DIRECTION` is the SIDE light the render rig's stated azimuth names
 * (`tools/dimetric.py`: `SUN_AZIMUTH = 135`, `SUN_ALTITUDE = 55`, against a
 * camera `AZIMUTH` of 225). The camera sits at ground azimuth 225 in
 * Blender's XY plane, so its right-hand vector points at 315 and **135 is
 * the camera's LEFT**. A ground azimuth `a` at altitude `el` is the to-sun
 * vector `(cos a * cos el, sin a * cos el, sin el)` in Blender (X, Y, Z-up);
 * at 135/55 that is `(-0.406, 0.406, 0.819)`, and with tile x -> world X,
 * tile y -> world Z, Blender Z-up -> world Y, three's frame gets
 * `(-0.406, 0.819, 0.406)`.
 *
 * The XZ signs DIFFER, and that is the whole point: `+x` is screen-right and
 * `+y` (world Z) is screen-left on this dimetric camera (`dimetric.py`'s own
 * note on `AZIMUTH`, and `camera.ts` `VIEW_DIRECTION`). So a box's
 * screen-left face (`+Z` normal) takes `N.L = +0.406`, its screen-right face
 * (`+X`) takes `-0.406` and falls to hemisphere light alone, and its top
 * takes `0.819`. Shadows run along `-L` in XZ, i.e. toward `(+X, -Z)`, which
 * is screen-right with the two vertical components exactly cancelling: a
 * caster of height `h` lays its shadow `0.99h` tiles across the ground
 * BESIDE it, against the `1.225h` its own roof is drawn up-screen. That is
 * the classic isometric key, and it is why a building's shadow crosses the
 * road instead of hiding inside the building.
 *
 * Two alternatives are retired, both with their measurement:
 *
 * 1. **The lamp's own beam is back-lit and does not implement the rig's
 *    stated azimuth.** `build_lights` sets `rotation_euler = (90 - 55, 0,
 *    135)`, i.e. it yaws a beam already tilted toward `+Y`, which lands the
 *    light SOURCE at azimuth 45 -- opposite the camera. That is a rig
 *    convention bug, not an authored intent, and the sprite sheets show it:
 *    `assets/sprites/BLD_WALL/idle_f00_000.png` is a plain single-material
 *    box whose top is `limestone.0` (`#F2E8D5`) and whose TWO visible sides
 *    are both `limestone.7` (`#75624A`), identical to the byte -- a bright
 *    top over two equally dark sides is what a sun behind the subject
 *    produces, and it is why no sprite sheet carries a lit side to match.
 *    Taking the rig's number rather than the rig's lamp is a deliberate
 *    choice by the project lead (Task 16).
 * 2. **The front-lit `(+0.406, 0.819, +0.406)` Task 1 derived from that beam,
 *    and Task 9 kept on a flank-to-up-face luminance ratio, is retired.**
 *    That pair lies in the camera's own azimuth plane, so both camera-facing
 *    faces take an identical `N.L` and there is no left/right asymmetry at
 *    all; its shadows fall straight up-screen, 40% of the caster's own screen
 *    height, entirely inside any box-shaped silhouette. Task 9's ratio was
 *    measured on a VEHICLE bake, whose shading is `render_team.py`'s
 *    `ROLE_PALETTE`/`LIT_GAIN` table rather than a physical render, so it was
 *    probably measuring albedo.
 *
 * Full account: the spec's "Deviations" entry 3 and "Open questions".
 */
import * as THREE from 'three';

export const SUN_DIRECTION = new THREE.Vector3(-0.406, 0.819, 0.406).normalize();
/** ACES needs headroom: 2.6 lands a `limestone.0` wall facing the sun at
 *  roughly its authored brightness after tone mapping. That is a judgement
 *  about ONE surface at ONE orientation, and it is the only sense in which
 *  an authored hex survives to the screen -- the spec's original "a palette
 *  hex lands on screen as that hex under neutral light" was measured false
 *  (deviation 7: `#14150F` photographs as `#050503`) and is retired. Tune by
 *  eye, against the lit frame, not against a swatch. */
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

/**
 * `shadowMapSize` defaults to `SHADOW_MAP_SIZE` (4096) so every caller that
 * predates the quality preset -- every `ThreeRenderer*.test.ts` fake, every
 * `createSceneLights(w, h)` this file's own tests still write -- keeps
 * building today's shadow map without change. `ThreeRenderer` is the one
 * caller that passes something else, from `(opts.quality ??
 * QUALITY_PRESETS.high).shadowMapSize` (`quality.ts`).
 */
export function createSceneLights(width: number, height: number, shadowMapSize: number = SHADOW_MAP_SIZE): SceneLights {
  const centre = new THREE.Vector3(width / 2, 0, height / 2);
  const r = shadowBoxRadius(width, height);

  const sun = new THREE.DirectionalLight(new THREE.Color(SUN_COLOR_HEX), SUN_INTENSITY);
  sun.position.copy(centre).addScaledVector(SUN_DIRECTION, r * 2);
  sun.target.position.copy(centre);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
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
