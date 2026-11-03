/**
 * The wind's shader uniforms (GH-984 N1), shared BY REFERENCE with every foliage and trunk batch and
 * with the banners, so a terrain rebuild never needs to be told the wind. `ThreeRenderer` owns one set,
 * writes `mode` once a frame from the reduced-motion preference and never touches `dir` or `strength`
 * again (the map's `wind` block is read once, at construction); the sim CLOCK is `SwayUniforms.time`,
 * written by `frame()` from `presentationSimMs`. Nothing in this file reads time.
 *
 * Kept apart from `wind.ts` because a `Vector2` is a three import and `wind.ts` is three-free.
 */
import * as THREE from 'three';
import { DEFAULT_WIND, type WindSettings } from './wind';

export interface WindUniformSet {
  /** 1 plays the wind; 0 plays today's sway (reduced motion) and anything else is a bug. */
  readonly mode: { value: number };
  readonly strength: { value: number };
  /** World x, z of the unit heading. */
  readonly dir: { value: THREE.Vector2 };
}

/** A set that plays the wind at `settings` (default strength 1, screen-right). `mode` starts at 1. */
export function makeWindUniforms(settings: WindSettings = DEFAULT_WIND): WindUniformSet {
  return {
    mode: { value: 1 },
    strength: { value: settings.strength },
    dir: { value: new THREE.Vector2(settings.dirX, settings.dirZ) },
  };
}

/** The set a caller that was never told about the wind gets: today's sway. */
export function legacyWindUniforms(): WindUniformSet {
  const w = makeWindUniforms();
  w.mode.value = 0;
  return w;
}
