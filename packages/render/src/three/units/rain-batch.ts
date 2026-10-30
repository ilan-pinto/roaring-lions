/**
 * The falling rain, ONE instanced draw (GH-871 P4, Task 8; R-7; spec 4.4).
 *
 * One `InstancedBufferGeometry`, one `ShaderMaterial`, drawn once, built the way
 * the flipbook pool is (`flipbook-fx.ts`): every instance owns a static seed and
 * the shader AGES it from a time uniform, so nothing is uploaded per frame but a
 * handful of uniforms. The maths is `rain-maths.ts`; this file is the GLSL copy of
 * it (every constant interpolated from the same exports, never retyped) and the
 * mesh around it.
 *
 * ## One instance, two quads
 *
 * The base geometry holds a STREAK quad (kind 0) and a SPLASH quad (kind 1), so a
 * drop and the ring it leaves are one instance in one draw:
 *
 *  - the streak runs from the drop's head up its slanted path, `RAIN_STREAK_LENGTH`
 *    long, and is `RAIN_STREAK_CSS_PX` CSS pixels wide at every zoom
 *    (`uStreakHalfWidth`, rewritten per frame from the zoom: a world-unit width
 *    vanishes zoomed out and becomes a pipe zoomed in);
 *  - the splash is a flat ring on the ground at the landing point, for 150 ms after
 *    the drop lands (the fall phase just wrapped), growing 0.04 -> 0.10 wu and
 *    fading 0.35 -> 0.
 *
 * ## The ground
 *
 * A drop lands where the ground is. The ground height comes from an R16F texture,
 * four texels a tile, baked at boot (and on a terrain rebuild) from the renderer's
 * own `groundWorldY` (`bakeHeightTexels`), sampled at the LANDING point.
 *
 * ## The draw (S-5)
 *
 * Transparent, depth test ON (a roof in front of a drop hides it, and the fog pass
 * shrouds a streak by the ground behind it), depth write OFF, `castShadow` false,
 * NO `normal` attribute: `post-chain.ts`'s `isAoOccluder` and the shadow pass both
 * skip it. +1 draw call in the main pass, 0 elsewhere, fixed in the instance count
 * (`rain-batch.test.ts` counts it through three's own render lists). Its colour is
 * `overcast.0` x the rain `hazeRadiance`, whose largest channel stays under 0.9, so
 * it never blooms and `hdr-gains.ts` has no entry for it. Band `RAIN_RENDER_ORDER`.
 *
 * Nothing here reads the wall clock: the time is the SIM clock the caller passes.
 */
import * as THREE from 'three';
import {
  RAIN_FALL_HEIGHT,
  RAIN_FALL_SPEED,
  RAIN_SPLASH_ALPHA,
  RAIN_SPLASH_LIFT,
  RAIN_SPLASH_MS,
  RAIN_SPLASH_R0,
  RAIN_SPLASH_R1,
  RAIN_STREAK_ALPHA,
  RAIN_STREAK_LENGTH,
} from '../weather';
import { SWAY_DIR_X, SWAY_DIR_Z } from '../terrain/sway';
import {
  bakeHeightTexels,
  dropSeed,
  heightTexels,
  rainWindow,
  posMod,
  RAIN_EDGE_FADE,
  RAIN_SLANT_COS,
  RAIN_SLANT_SIN,
  RAIN_SLANT_TAN,
  streakWidthWorld,
  toHalfFloat,
  type RainView,
} from './rain-maths';
import { RAIN_RENDER_ORDER } from './render-order';

/** A float literal for the shader source, to the precision the sway chunk uses. */
export function glslFloat(v: number): string {
  return v.toFixed(8);
}

/** The splash quad's half-size over its ring radius (room for the ring's soft edge). */
export const RAIN_SPLASH_QUAD = 1.25;

const VERTEX = /* glsl */ `
attribute vec3 aSeed;
uniform float uFall;
uniform vec2 uLow;
uniform float uPeriod;
uniform vec2 uMapSize;
uniform sampler2D uHeight;
uniform float uStreakHalfWidth;
uniform vec3 uStreakColor;
uniform vec3 uSplashColor;
varying vec4 vColor;
varying vec2 vUv;
varying float vKind;
const float RAIN_H = ${glslFloat(RAIN_FALL_HEIGHT)};
const float RAIN_V = ${glslFloat(RAIN_FALL_SPEED)};
const float RAIN_LEN = ${glslFloat(RAIN_STREAK_LENGTH)};
const float RAIN_TAN = ${glslFloat(RAIN_SLANT_TAN)};
const float RAIN_SIN = ${glslFloat(RAIN_SLANT_SIN)};
const float RAIN_COS = ${glslFloat(RAIN_SLANT_COS)};
const vec2 RAIN_WIND = vec2(${glslFloat(SWAY_DIR_X)}, ${glslFloat(SWAY_DIR_Z)});
const float RAIN_STREAK_A = ${glslFloat(RAIN_STREAK_ALPHA)};
const float RAIN_SPLASH_A = ${glslFloat(RAIN_SPLASH_ALPHA)};
const float RAIN_SPLASH_MS = ${glslFloat(RAIN_SPLASH_MS)};
const float RAIN_SPLASH_R0 = ${glslFloat(RAIN_SPLASH_R0)};
const float RAIN_SPLASH_R1 = ${glslFloat(RAIN_SPLASH_R1)};
const float RAIN_SPLASH_LIFT = ${glslFloat(RAIN_SPLASH_LIFT)};
const float RAIN_SPLASH_QUAD = ${glslFloat(RAIN_SPLASH_QUAD)};
const float RAIN_EDGE_FADE = ${glslFloat(RAIN_EDGE_FADE)};
void main() {
  // The landing point: world-anchored modulo the period, inside the window at uLow.
  vec2 land = vec2(
    uLow.x + mod(aSeed.x * uPeriod - uLow.x, uPeriod),
    uLow.y + mod(aSeed.z * uPeriod - uLow.y, uPeriod)
  );
  float ground = texture2D(uHeight, clamp(land / uMapSize, 0.0, 1.0)).r;
  // The fall phase in [0, H): 0 the instant the drop lands. uFall is mod(V * t, H), built on the CPU.
  float phase = mod(aSeed.y * RAIN_H + uFall, RAIN_H);
  vKind = position.z;
  vUv = position.xy;
  // The map edge: a drop whose LANDING point is off the map [0, W] x [0, H] is removed, and one
  // within RAIN_EDGE_FADE tiles inside the edge thins out (the splash follows its drop).
  float edge = min(min(land.x, uMapSize.x - land.x), min(land.y, uMapSize.y - land.y));
  float edgeFade = smoothstep(0.0, RAIN_EDGE_FADE, edge);
  if (edgeFade <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vColor = vec4(0.0);
    return;
  }
  if (position.z < 0.5) {
    float h = RAIN_H - phase;
    vec3 head = vec3(land.x - RAIN_TAN * h * RAIN_WIND.x, ground + h, land.y - RAIN_TAN * h * RAIN_WIND.y);
    vec3 dirMove = vec3(RAIN_SIN * RAIN_WIND.x, -RAIN_COS, RAIN_SIN * RAIN_WIND.y);
    vec3 tail = head - dirMove * RAIN_LEN;
    // The strip faces the camera: its width axis is perpendicular to the path and the view.
    vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
    vec3 side = normalize(cross(dirMove, fwd));
    vec3 p = mix(head, tail, position.y) + side * (position.x * uStreakHalfWidth);
    vColor = vec4(uStreakColor, RAIN_STREAK_A * edgeFade);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  } else {
    float ageMs = phase / RAIN_V * 1000.0;
    if (ageMs >= RAIN_SPLASH_MS) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vColor = vec4(0.0);
      return;
    }
    float life = ageMs / RAIN_SPLASH_MS;
    float r = RAIN_SPLASH_R0 + (RAIN_SPLASH_R1 - RAIN_SPLASH_R0) * clamp(life, 0.0, 1.0);
    vec3 p = vec3(land.x, ground + RAIN_SPLASH_LIFT, land.y) + vec3(position.x, 0.0, position.y) * (r * RAIN_SPLASH_QUAD);
    vColor = vec4(uSplashColor, RAIN_SPLASH_A * (1.0 - life) * edgeFade);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
}
`;

const FRAGMENT = /* glsl */ `
varying vec4 vColor;
varying vec2 vUv;
varying float vKind;
const float RAIN_SPLASH_QUAD = ${glslFloat(RAIN_SPLASH_QUAD)};
void main() {
  float a = vColor.a;
  if (vKind > 0.5) {
    // A ring: its distance from the centre in units of the ring's own radius.
    float d = length(vUv) * RAIN_SPLASH_QUAD;
    a *= smoothstep(0.45, 0.7, d) * (1.0 - smoothstep(0.92, 1.0, d));
  }
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}
`;

/** The shader sources, for the test that proves they carry the maths' constants. */
export const RAIN_VERTEX_SHADER = VERTEX;
export const RAIN_FRAGMENT_SHADER = FRAGMENT;

export interface RainBatchOptions {
  /** Instance count (`quality.rain.drops`). */
  readonly drops: number;
  /** The map in tiles: the height texture's extent and the lattice's clip. */
  readonly mapWidth: number;
  readonly mapHeight: number;
}

/** What a frame hands the batch. */
export interface RainFrame {
  /** The SIM clock, seconds (`presentationSimMs / 1000`). */
  readonly simSec: number;
  readonly view: RainView;
  /** The drawing buffer's pixel ratio. */
  readonly dpr: number;
}

export class RainBatch {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly heightTexture: THREE.DataTexture;
  private readonly heightData: Uint16Array;
  private readonly mapWidth: number;
  private readonly mapHeight: number;
  private periodNow = 0;
  /** The highest baked ground, wu: the rain's reach grows with it. */
  private maxGround = 0;
  private disposed = false;

  constructor(scene: THREE.Object3D, opts: RainBatchOptions) {
    this.mapWidth = opts.mapWidth;
    this.mapHeight = opts.mapHeight;
    const geometry = new THREE.InstancedBufferGeometry();
    // position = (across, along, kind): the streak, then the splash. NO normal attribute (S-5).
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          -1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0,
          -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
        ]),
        3
      )
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    const seeds = new Float32Array(opts.drops * 3);
    for (let i = 0; i < opts.drops; i++) seeds.set(dropSeed(i), i * 3);
    const seedAttr = new THREE.InstancedBufferAttribute(seeds, 3);
    seedAttr.setUsage(THREE.StaticDrawUsage);
    geometry.setAttribute('aSeed', seedAttr);
    geometry.instanceCount = opts.drops;

    const w = heightTexels(opts.mapWidth);
    const h = heightTexels(opts.mapHeight);
    this.heightData = new Uint16Array(w * h);
    this.heightTexture = new THREE.DataTexture(this.heightData, w, h, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTexture.magFilter = THREE.LinearFilter;
    this.heightTexture.minFilter = THREE.LinearFilter;
    this.heightTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.heightTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTexture.generateMipmaps = false;
    this.heightTexture.needsUpdate = true;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uFall: { value: 0 },
        uLow: { value: new THREE.Vector2() },
        uPeriod: { value: 8 },
        uMapSize: { value: new THREE.Vector2(opts.mapWidth, opts.mapHeight) },
        uHeight: { value: this.heightTexture },
        uStreakHalfWidth: { value: streakWidthWorld(1, 1) / 2 },
        // Zeros until `setColors` hands over the palette colours: a default here would be a
        // colour no palette entry names, and one the renderer overwrites before the first frame.
        uStreakColor: { value: new THREE.Vector3() },
        uSplashColor: { value: new THREE.Vector3() },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      // S-5: tested (a roof hides a drop), never written (the fog pass shrouds a streak by the ground).
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      // The strip is rebuilt from the view every frame: no winding to prove once.
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'rain-batch';
    this.mesh.renderOrder = RAIN_RENDER_ORDER;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }

  /** The instance count. */
  get drops(): number {
    return this.mesh.geometry.instanceCount;
  }

  /** The lattice period the last `update` chose, tiles. */
  get period(): number {
    return this.periodNow;
  }

  /** The two LINEAR colours (already scaled by the lights' `hazeRadiance`). */
  setColors(streak: readonly [number, number, number], splash: readonly [number, number, number]): void {
    (this.mesh.material.uniforms.uStreakColor.value as THREE.Vector3).set(streak[0], streak[1], streak[2]);
    (this.mesh.material.uniforms.uSplashColor.value as THREE.Vector3).set(splash[0], splash[1], splash[2]);
  }

  /**
   * (Re)bakes the height texture from `sampler` (world x, z -> world y): the
   * renderer passes `groundWorldY`. Writes into the same texture and re-uploads;
   * called at the first build and again after every terrain rebuild.
   */
  bakeHeights(sampler: (x: number, z: number) => number): void {
    const f32 = bakeHeightTexels(sampler, this.mapWidth, this.mapHeight);
    let hi = 0;
    for (let i = 0; i < f32.length; i++) {
      this.heightData[i] = toHalfFloat(f32[i]);
      if (f32[i] > hi) hi = f32[i];
    }
    this.maxGround = hi;
    this.heightTexture.needsUpdate = true;
  }

  /**
   * The per-frame uniforms: the fall offset (SIM clock), the window and the lattice
   * period, the streak's constant-pixel half width. Everything else is static.
   */
  update(frame: RainFrame): void {
    const u = this.mesh.material.uniforms;
    u.uFall.value = posMod(RAIN_FALL_SPEED * frame.simSec, RAIN_FALL_HEIGHT);
    const { period, low: lo } = rainWindow(frame.view, { width: this.mapWidth, height: this.mapHeight }, this.maxGround);
    this.periodNow = period;
    (u.uLow.value as THREE.Vector2).set(lo.x, lo.z);
    u.uPeriod.value = this.periodNow;
    u.uStreakHalfWidth.value = streakWidthWorld(frame.view.zoom, frame.dpr) / 2;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.heightTexture.dispose();
  }
}
