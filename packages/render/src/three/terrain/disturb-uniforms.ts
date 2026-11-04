/**
 * The disturbance's shader uniforms (GH-984 N2), shared BY REFERENCE with every foliage and trunk
 * batch exactly as `wind-uniforms.ts` shares the wind: `ThreeRenderer` owns one set, fills `a`, `b`
 * and `box` from its `DisturbField` and writes `n` and `spring` once a frame; the `disturb` debug
 * layer is the only writer of `amp`. A terrace rebuild never needs to be told.
 *
 * Kept apart from `disturb.ts` because a `Vector4` is a three import and that file is three-free.
 * Nothing in this file reads time.
 */
import * as THREE from 'three';
import { DISTURB_MAX } from './disturb';

export interface DisturbUniformSet {
  /** `(ax, az, bx, bz)` per slot, the `DisturbField`'s own array (a typed array three uploads as is). */
  readonly a: { value: Float32Array };
  /** `(radius, strength)` per slot. */
  readonly b: { value: Float32Array };
  readonly box: { value: THREE.Vector4 };
  /** The live slot count; 0 turns the loop off for every vertex. */
  readonly n: { value: number };
  /** 1 shipped; the `disturb` layer drives it to 0. Nothing per frame writes it. */
  readonly amp: { value: number };
  /** 1 plays the spring; 0 (reduced motion) a monotone fall: a static displacement. */
  readonly spring: { value: number };
}

/** A set bound to a `DisturbField`'s arrays, count 0 until the first frame fills it. */
export function makeDisturbUniforms(a?: Float32Array, b?: Float32Array): DisturbUniformSet {
  return {
    a: { value: a ?? new Float32Array(DISTURB_MAX * 4) },
    b: { value: b ?? new Float32Array(DISTURB_MAX * 2) },
    box: { value: new THREE.Vector4(0, 0, 0, 0) },
    n: { value: 0 },
    amp: { value: 1 },
    spring: { value: 1 },
  };
}

/** What a caller that was never told about the disturbance gets: nothing moves. */
export function inertDisturbUniforms(): DisturbUniformSet {
  return makeDisturbUniforms();
}
