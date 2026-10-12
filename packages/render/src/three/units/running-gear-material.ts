/**
 * The running-gear shader: the vehicle's own baked material, cloned once per
 * live vehicle that has moved, with two chunks added.
 *
 * - **Vertex**: a vertex tagged `_rl_wheel = k` (`running-gear-pass.ts`) turns
 *   about wheel `k`'s axle, spin about mesh-local +Z and then steering yaw about
 *   +Y. The normal turns with it. It is written as `p + (R d - d)`, so the rest
 *   rotation `(1, 0, 1, 0)` returns `p` bit for bit.
 * - **Fragment**: a vertex with `_rl_track >= 0` lies on a track, and the bake
 *   under it is darkened by a band of bars across the track that runs with the
 *   phase (A6). The bars are mean-preserving (`bar - duty`), box-filtered by
 *   their own `fwidth`, and fade to the bake's own tone once a bar spans less
 *   than about 3 px. The bars' strength (A7) is 0 at rest.
 *
 * **One clone per live vehicle, and it was measured that it has to be.**
 * three r170 re-uploads a material's `onBeforeCompile` uniforms only when
 * the material, program or camera changes between draws. `uniformsNeedUpdate`
 * is honoured for `ShaderMaterial` alone (`WebGLRenderer.js`, `setProgram`).
 * Two jeeps sharing one material would both draw whichever wheel angle was
 * uploaded first. A clone shares the program (the cache key below) and the
 * textures, so it adds no draw call and no program per vehicle.
 *
 * **Only the main pass runs these chunks.** The shadow depth material and the
 * GTAO normal override do not, so in those passes a wheel keeps its rest pose.
 * A spinning near-round wheel has the same silhouette and the same normals
 * either way. A steered front wheel (at most 20 degrees) is the one thing the
 * shadow does not show, and the design accepted that (§3.4).
 */
import * as THREE from 'three';
import { RG_MAX_WHEELS, RG_TREAD_DEPTH, RG_TREAD_DUTY, type RunningGearSpec } from './running-gear';

/** The geometry attribute names `GLTFLoader` gives `_RL_WHEEL`/`_RL_TRACK`
 *  (it lower-cases a custom attribute it has no mapping for). */
export const RG_WHEEL_GEOMETRY_ATTR = '_rl_wheel';
export const RG_TRACK_GEOMETRY_ATTR = '_rl_track';

/** True for a geometry the running-gear pass tagged. */
export function hasRunningGear(geometry: THREE.BufferGeometry): boolean {
  return geometry.getAttribute(RG_WHEEL_GEOMETRY_ATTR) !== undefined && geometry.getAttribute(RG_TRACK_GEOMETRY_ATTR) !== undefined;
}

export interface RunningGearUniforms {
  /** Per wheel: axle centre xyz, w unused. */
  readonly uRgAxle: { value: THREE.Vector4[] };
  /** Per wheel: (cos spin, sin spin, cos yaw, sin yaw). */
  readonly uRgRot: { value: THREE.Vector4[] };
  /** (phase right, phase left, bar strength 0..1, unused). */
  readonly uRgTrack: { value: THREE.Vector4 };
  /** (1 / pitch right, 1 / pitch left). */
  readonly uRgPitchInv: { value: THREE.Vector2 };
}

/** The GLSL the vertex chunk uses to turn a vertex, mirrored by
 *  `applyWheelRotation` in `running-gear.ts`. */
export const RG_APPLY_GLSL = /* glsl */ `
vec3 rgApply(vec3 d, vec4 rot) {
  vec3 a = vec3(rot.x * d.x - rot.y * d.y, rot.y * d.x + rot.x * d.y, d.z);
  return vec3(rot.z * a.x + rot.w * a.z, a.y, -rot.w * a.x + rot.z * a.z);
}`;

const VERTEX_HEAD = /* glsl */ `#include <common>
#define RG_MAX_WHEELS ${RG_MAX_WHEELS}
attribute float ${RG_WHEEL_GEOMETRY_ATTR};
attribute float ${RG_TRACK_GEOMETRY_ATTR};
uniform vec4 uRgAxle[RG_MAX_WHEELS];
uniform vec4 uRgRot[RG_MAX_WHEELS];
varying float vRgTrack;
varying float vRgSide;
${RG_APPLY_GLSL}`;

const VERTEX_NORMAL = /* glsl */ `#include <beginnormal_vertex>
int rgK = int(${RG_WHEEL_GEOMETRY_ATTR} + 0.5) - 1;
if (rgK >= 0) {
  objectNormal = rgApply(objectNormal, uRgRot[rgK]);
}`;

const VERTEX_POSITION = /* glsl */ `#include <begin_vertex>
if (rgK >= 0) {
  vec3 rgD = transformed - uRgAxle[rgK].xyz;
  transformed += rgApply(rgD, uRgRot[rgK]) - rgD;
}
vRgTrack = ${RG_TRACK_GEOMETRY_ATTR};
vRgSide = position.z;`;

const FRAGMENT_HEAD = /* glsl */ `#include <common>
uniform vec4 uRgTrack;
uniform vec2 uRgPitchInv;
varying float vRgTrack;
varying float vRgSide;
// The integral of a square wave of duty RG_DUTY: floor(x) bars plus the part
// of the current one, so a box filter over [a, b] is (F(b) - F(a)) / (b - a).
float rgBarIntegral(float x) {
  return floor(x) * ${RG_TREAD_DUTY.toFixed(4)} + min(fract(x), ${RG_TREAD_DUTY.toFixed(4)});
}`;

// Derivatives are taken OUTSIDE any branch (non-uniform control flow would
// leave them undefined), and the track mask multiplies instead of branching.
const FRAGMENT_TREAD = /* glsl */ `#include <map_fragment>
{
  float rgOnTrack = step(0.0, vRgTrack);
  float rgSideR = step(0.0, vRgSide);
  float rgPhase = vRgTrack * mix(uRgPitchInv.y, uRgPitchInv.x, rgSideR) - mix(uRgTrack.y, uRgTrack.x, rgSideR);
  float rgW = max(fwidth(rgPhase), 1e-4);
  float rgBar = (rgBarIntegral(rgPhase + 0.5 * rgW) - rgBarIntegral(rgPhase - 0.5 * rgW)) / rgW;
  float rgFade = 1.0 - smoothstep(0.25, 0.5, rgW);
  diffuseColor.rgb *= 1.0 - ${RG_TREAD_DEPTH.toFixed(4)} * uRgTrack.z * rgFade * rgOnTrack * (rgBar - ${RG_TREAD_DUTY.toFixed(4)});
}`;

/** The cache key every running-gear clone shares: one program for every
 *  textured vehicle type, since the per-type facts are uniforms. */
export const RG_PROGRAM_KEY = 'rl-running-gear-1';

/**
 * A clone of `base` that draws `spec`'s running gear, and the uniform objects
 * the caller writes every frame. `base` itself is untouched.
 */
export function runningGearMaterial(
  base: THREE.Material,
  spec: RunningGearSpec
): { material: THREE.Material; uniforms: RunningGearUniforms } {
  const uniforms: RunningGearUniforms = {
    uRgAxle: { value: Array.from({ length: RG_MAX_WHEELS }, () => new THREE.Vector4()) },
    uRgRot: { value: Array.from({ length: RG_MAX_WHEELS }, () => new THREE.Vector4(1, 0, 1, 0)) },
    uRgTrack: { value: new THREE.Vector4(0, 0, 0, 0) },
    uRgPitchInv: {
      value: new THREE.Vector2(spec.track.r ? 1 / spec.track.r[1] : 0, spec.track.l ? 1 / spec.track.l[1] : 0),
    },
  };
  spec.wheels.forEach((w, k) => uniforms.uRgAxle.value[k].set(w.centre[0], w.centre[1], w.centre[2], 0));
  const material = base.clone();
  const baseKey = base.customProgramCacheKey();
  material.customProgramCacheKey = () => `${baseKey}|${RG_PROGRAM_KEY}`;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = replaceOnce(shader.vertexShader, '#include <common>', VERTEX_HEAD);
    shader.vertexShader = replaceOnce(shader.vertexShader, '#include <beginnormal_vertex>', VERTEX_NORMAL);
    shader.vertexShader = replaceOnce(shader.vertexShader, '#include <begin_vertex>', VERTEX_POSITION);
    shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <common>', FRAGMENT_HEAD);
    shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <map_fragment>', FRAGMENT_TREAD);
  };
  material.userData = { ...material.userData, rlRunningGear: true };
  return { material, uniforms };
}

function replaceOnce(src: string, find: string, by: string): string {
  const at = src.indexOf(find);
  if (at < 0) throw new Error(`running-gear-material: the shader has no "${find}" to patch (three changed its chunks?)`);
  return src.slice(0, at) + by + src.slice(at + find.length);
}
