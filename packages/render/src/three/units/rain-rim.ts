/**
 * The KDF figure's rain rim (GH-871 P4 PR 914, the lead's ruling 1 of 31 Oct 2026).
 *
 * Under rain a KDF figure's surface clones (`unit-surface.ts`) take a thin, soft,
 * light edge on the figure's outline: a view-angle Fresnel term added as
 * emission after `#include <emissivemap_fragment>`, where the fragment's
 * `normal` (view space) and `vViewPosition` already exist:
 *
 *     totalEmissiveRadiance += uRimColor * uRimGain * pow(1 - saturate(n.v), uRimPower)
 *
 * with `v` the view vector three itself uses (`lights_fragment_begin`): `(0, 0, 1)` for an orthographic camera
 * (the game's camera is one, `camera.ts`), `normalize(vViewPosition)` for a perspective one. The perspective
 * form on an orthographic view skews the rim toward the screen edges (about 3 degrees at zoom 2.5, 7 at zoom 1
 * and 20 at the 0.35 floor), so the rim would be asymmetric when zoomed out. `isOrthographic` is in the
 * fragment prefix three builds for every non-raw shader (`WebGLProgram.js`), `onBeforeCompile`d standard
 * materials included. `rimFactor` below is the TS mirror the tests pin.
 *
 * It REPLACES the flat emissive lift of S-L2 ruling 3 (`overcast.1 x 0.4` on every
 * texel), which cleared the readability floor and drew the soldiers as flat pale
 * grey-blue ghosts with their camouflage, faces and helmets washed out. The
 * rim leaves the middle of a figure alone (n.v near 1 is a factor near 0), so
 * camouflage, faces and team colour read as they did before the lift.
 *
 * ONE set of uniform objects (`rimUniforms`) is handed to every program compiled
 * from a rim material, so a single `.value` write moves every figure on screen:
 * the `unit-surface` debug layer (gain 0 and back) and
 * `ThreeRenderer.debugSetRainRim` (the capture tool's calibration knob). three
 * re-uploads a material's `onBeforeCompile` uniforms on the first draw of each
 * material every frame (`_currentMaterialId` is reset per render), so a write
 * between frames reaches every figure (`wounded-read.ts` relies on the same).
 *
 * The rim is a COMPILE-TIME variant: a clone built for it carries its own
 * `customProgramCacheKey` (`RAIN_RIM_PROGRAM_KEY`) and `unit-surface.ts` keeps
 * it apart from an unrimmed clone of the same base in its memo. A renderer that
 * does not rain never builds one, so its materials, programs and digests are
 * today's. `userData.rlRainRim` marks a rim material (`Material.clone` copies
 * `userData`, so a wounded copy keeps the mark; its own `onBeforeCompile`
 * chains this one, see `wounded-read.ts`).
 */
import * as THREE from 'three';
import { paletteHex } from '../palette-hex';
import { RAIN_KDF_RIM_GAIN, RAIN_KDF_RIM_KEY, RAIN_KDF_RIM_POWER } from '../weather';

/** The program cache key of a rim clone (a constant: every figure shares one program). */
export const RAIN_RIM_PROGRAM_KEY = 'rl-unit-rain-rim';
/** The `userData` mark of a rim material. */
export const RAIN_RIM_USERDATA_KEY = 'rlRainRim';

/** The fragment declarations (after `#include <common>`). */
export const RAIN_RIM_DECLARE_GLSL = 'uniform vec3 uRimColor;\nuniform float uRimGain;\nuniform float uRimPower;';
/** The rim line (after `#include <emissivemap_fragment>`). */
export const RAIN_RIM_GLSL =
  'totalEmissiveRadiance += uRimColor * uRimGain * pow( 1.0 - saturate( dot( normalize( normal ), isOrthographic ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition ) ) ), uRimPower );';

/**
 * The TS mirror of the rim factor `pow(1 - saturate(n.v), power)`: `normal` is the view-space shading normal,
 * `viewPosition` is `vViewPosition` (the vector from the fragment to the eye, view space), and under an
 * orthographic camera `v` is `(0, 0, 1)` whatever the fragment's view-space xy.
 */
export function rimFactor(
  normal: readonly [number, number, number],
  viewPosition: readonly [number, number, number],
  orthographic: boolean,
  power: number
): number {
  const len = (a: readonly [number, number, number]): number => Math.hypot(a[0], a[1], a[2]);
  const nl = len(normal);
  const v: readonly [number, number, number] = orthographic ? [0, 0, 1] : viewPosition;
  const vl = orthographic ? 1 : len(v);
  const nv = (normal[0] * v[0] + normal[1] * v[1] + normal[2] * v[2]) / (nl * vl);
  return Math.pow(1 - Math.min(1, Math.max(0, nv)), power);
}

function replaceOnce(src: string, find: string, by: string): string {
  const at = src.indexOf(find);
  if (at < 0) throw new Error(`rain-rim: the shader has no "${find}" to patch (three changed its chunks?)`);
  return src.slice(0, at) + by + src.slice(at + find.length);
}

/** The rim patch of a meshphysical fragment shader. */
export function patchRainRim(fragmentShader: string): string {
  const declared = replaceOnce(fragmentShader, '#include <common>', `#include <common>\n${RAIN_RIM_DECLARE_GLSL}`);
  return replaceOnce(declared, '#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${RAIN_RIM_GLSL}`);
}

export interface RimUniforms {
  readonly colour: { value: THREE.Color };
  readonly gain: { value: number };
  readonly power: { value: number };
}

/** The gain the knob wants (the shipped default until `setRainRimGain`), and whether the
 *  `unit-surface` debug layer has the pass on. The uniform reads `passOn ? wanted : 0`. */
let wanted = RAIN_KDF_RIM_GAIN;
let passOn = true;
let shared: RimUniforms | null = null;

/** The one set of uniform objects. Built on first use (the palette read is not a module-load cost). */
export function rimUniforms(): RimUniforms {
  if (!shared) {
    shared = {
      colour: { value: new THREE.Color(paletteHex(RAIN_KDF_RIM_KEY)) },
      gain: { value: passOn ? wanted : 0 },
      power: { value: RAIN_KDF_RIM_POWER },
    };
  }
  return shared;
}

function sync(): void {
  if (shared) shared.gain.value = passOn ? wanted : 0;
}

/** The `unit-surface` debug layer: the rim off (gain 0) or on (the stashed gain). Idempotent both ways. */
export function setRainRimPass(on: boolean): void {
  passOn = on;
  sync();
}

/** The calibration knob: the gain every rim material reads. Throws on a non-finite or negative gain. */
export function setRainRimGain(gain: number): void {
  if (!Number.isFinite(gain) || gain < 0) {
    throw new Error(`rain rim: the gain must be a finite number >= 0, got ${String(gain)}`);
  }
  wanted = gain;
  sync();
}

/** What the shaders read now: the effective `gain` (0 while the `unit-surface` debug layer has the pass off),
 *  the `power`, and the `wanted` gain the knob holds (what the effective gain returns to when the layer is on). */
export function rainRimNow(): { gain: number; power: number; wanted: number } {
  const u = rimUniforms();
  return { gain: u.gain.value, power: u.power.value, wanted };
}

/**
 * Makes `mat` a rim material: its fragment shader gains the rim lines, its program its own cache key, and
 * the compile hook it already has (if any) still runs first. `mat` must be a standard / physical material.
 */
export function applyRainRim(mat: THREE.MeshStandardMaterial): void {
  const prior = mat.onBeforeCompile;
  const baseKey = mat.customProgramCacheKey();
  mat.customProgramCacheKey = () => `${baseKey}|${RAIN_RIM_PROGRAM_KEY}`;
  mat.onBeforeCompile = (shader, renderer) => {
    prior.call(mat, shader, renderer);
    const u = rimUniforms();
    shader.uniforms.uRimColor = u.colour;
    shader.uniforms.uRimGain = u.gain;
    shader.uniforms.uRimPower = u.power;
    shader.fragmentShader = patchRainRim(shader.fragmentShader);
  };
  mat.userData = { ...mat.userData, [RAIN_RIM_USERDATA_KEY]: true };
}

/** True for a material `applyRainRim` made (or a clone of one). */
export function isRainRimMaterial(mat: THREE.Material): boolean {
  return (mat.userData as Record<string, unknown>)[RAIN_RIM_USERDATA_KEY] === true;
}
