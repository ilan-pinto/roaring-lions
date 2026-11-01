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
 * ## The exposure and contrast (GH-871 cheap-wet follow-up, the lead's readability ask)
 *
 * The rim lights only the grazing edge, so it cannot lift a figure off a dark wet road. Measured (look 5,
 * `_coord/wet-theme/p5-read/`): the KDF camouflage is so dark under rain (mean sRGB 27 against the wet road's 50
 * and the marsh water's 32) that its darkest 15% sits at CIEDE2000 11.9 from the road and 7.0 from the water
 * when it is already as dark as it can be, and a lift only brings it TOWARD the ground. The floor 15.6 on the
 * mean or the darkest 15% is out of reach on that ground for anything short of the pale ghosts the lead rejected
 * (a flat lift of 0.3 reaches 14.5 on the road). What does change the read is the figure's own exposure: the
 * texture is a desert-tan camouflage that the rain's dim light and the wet table have crushed to near black.
 * `RAIN_KDF_EXPOSURE` multiplies the albedo (capped at 1: a soft shoulder, `a k / (1 + a (k - 1))`, was tried and
 * compresses the figure toward the ground's own luminance, which lowers every number), and `RAIN_KDF_CONTRAST` is
 * a gamma above 1 that puts the darks back, so the camouflage keeps its pattern: both are shared uniforms like the rim's, applied BEFORE lighting (after
 * `emissivemap_fragment`, ahead of `lights_physical_fragment`), so faces, gear and team colour are lit as they
 * were, only from a lifted albedo.
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
import { RAIN_KDF_CONTRAST, RAIN_KDF_EXPOSURE, RAIN_KDF_RIM_GAIN, RAIN_KDF_RIM_KEY, RAIN_KDF_RIM_POWER } from '../weather';

/** The program cache key of a rim clone (a constant: every figure shares one program). */
export const RAIN_RIM_PROGRAM_KEY = 'rl-unit-rain-rim';
/** The `userData` mark of a rim material. */
export const RAIN_RIM_USERDATA_KEY = 'rlRainRim';

/** The fragment declarations (after `#include <common>`). */
export const RAIN_RIM_DECLARE_GLSL =
  'uniform vec3 uRimColor;\nuniform float uRimGain;\nuniform float uRimPower;\nuniform float uRainExposure;\nuniform float uRainContrast;';
/** The exposure and rim lines (after `#include <emissivemap_fragment>`). */
export const RAIN_RIM_GLSL =
  'diffuseColor.rgb = min( diffuseColor.rgb * uRainExposure, vec3( 1.0 ) );\n' +
  'diffuseColor.rgb = pow( max( diffuseColor.rgb, vec3( 0.0001 ) ), vec3( uRainContrast ) );\n' +
  'totalEmissiveRadiance += uRimColor * uRimGain * pow( 1.0 - saturate( dot( normalize( normal ), isOrthographic ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition ) ) ), uRimPower );';

/** The TS mirror of the exposure: `min(a * k, 1)` per channel, `k` = 1 the identity (an albedo is never above 1). */
export function exposureCurve(albedo: number, k: number): number {
  return Math.min(albedo * k, 1);
}

/** The TS mirror of the whole albedo treatment: exposure, then the contrast gamma (`max` floor as the shader's). */
export function treatedAlbedo(albedo: number, exposure: number, contrast: number): number {
  return Math.pow(Math.max(exposureCurve(albedo, exposure), 0.0001), contrast);
}

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
  readonly exposure: { value: number };
  readonly contrast: { value: number };
}

/** What `ThreeRenderer.debugSetRainRead` writes: every knob of the KDF rain treatment. */
export interface RainRead {
  rimGain: number;
  rimPower: number;
  exposure: number;
  contrast: number;
}

/** The gains the knob wants (the shipped defaults until `setRainRead` / `setRainRimGain`), and whether the
 *  `unit-surface` debug layer has the pass on. The uniforms read `passOn ? wanted : neutral`. */
let wanted = RAIN_KDF_RIM_GAIN;
let wantedExposure = RAIN_KDF_EXPOSURE;
let wantedContrast = RAIN_KDF_CONTRAST;
let passOn = true;
let shared: RimUniforms | null = null;

/** The one set of uniform objects. Built on first use (the palette read is not a module-load cost). */
export function rimUniforms(): RimUniforms {
  if (!shared) {
    shared = {
      colour: { value: new THREE.Color(paletteHex(RAIN_KDF_RIM_KEY)) },
      gain: { value: passOn ? wanted : 0 },
      power: { value: RAIN_KDF_RIM_POWER },
      exposure: { value: passOn ? wantedExposure : 1 },
      contrast: { value: passOn ? wantedContrast : 1 },
    };
  }
  return shared;
}

function sync(): void {
  if (!shared) return;
  shared.gain.value = passOn ? wanted : 0;
  shared.exposure.value = passOn ? wantedExposure : 1;
  shared.contrast.value = passOn ? wantedContrast : 1;
}

/** Writes every treatment knob (the capture tool's sweep). Throws on a non-finite or out-of-range value. */
export function setRainRead(p: RainRead): void {
  const bad = (n: string, v: number, ok: boolean): void => {
    if (!Number.isFinite(v) || !ok) throw new Error(`rain read: ${n} is out of range: ${String(v)}`);
  };
  bad('rimGain', p.rimGain, p.rimGain >= 0);
  bad('rimPower', p.rimPower, p.rimPower > 0);
  bad('exposure', p.exposure, p.exposure >= 0.25 && p.exposure <= 16);
  bad('contrast', p.contrast, p.contrast > 0 && p.contrast <= 3);
  const u = rimUniforms();
  wanted = p.rimGain;
  wantedExposure = p.exposure;
  wantedContrast = p.contrast;
  u.power.value = p.rimPower;
  sync();
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

/** Every treatment knob as the shaders read it now (effective: the `unit-surface` layer off reads gain 0, exposure and contrast 1). */
export function rainReadNow(): RainRead {
  const u = rimUniforms();
  return { rimGain: u.gain.value, rimPower: u.power.value, exposure: u.exposure.value, contrast: u.contrast.value };
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
    shader.uniforms.uRainExposure = u.exposure;
    shader.uniforms.uRainContrast = u.contrast;
    shader.fragmentShader = patchRainRim(shader.fragmentShader);
  };
  mat.userData = { ...mat.userData, [RAIN_RIM_USERDATA_KEY]: true };
}

/** True for a material `applyRainRim` made (or a clone of one). */
export function isRainRimMaterial(mat: THREE.Material): boolean {
  return (mat.userData as Record<string, unknown>)[RAIN_RIM_USERDATA_KEY] === true;
}
