/**
 * Sun glint on unit metal and glass (GH-1361, slice 1: technique G).
 *
 * The orthographic camera and the side sun fix the half-vector H between them for every pixel, so a surface mirrors the sun to the
 * viewer only where its NORMAL is near H, whatever its screen position. The physical GGX lobe on `glass` (roughness 0.2) and
 * `gunmetal` (0.42) is both narrow and low (peak under 1.0 at battle zoom), so nothing reads. G adds ONE extra, wider lobe on
 * the sun's DIRECT light for those two surface classes only:
 *
 *     directSpecular += directLight.color * gain * smoothstep(cosCone, mix(cosCone, 1, 0.6), n.h) * step(0, n.l)
 *
 * with `h = normalize(sunDirection + viewDirection)`. It decouples the highlight's width (a ~10 degree cone) from its peak (an HDR
 * gain, `HDR_GAINS.sunGlint`, so it crosses the bloom threshold on `high`, and ACES clips it to a small bright point on `medium` and
 * `low`, where there is no bloom).
 *
 * **Shadowed by construction.** `directLight.color` already carries the sun's shadow (three multiplies it in
 * `lights_fragment_begin` before `RE_Direct`), and the colour is the preset's sun colour at the rain's `RAIN_SUN_SCALE` under rain. No
 * colour is written here, so there is no hex and no palette key to name: the gain is a pure number in `hdr-gains.ts`.
 *
 * **Which surfaces.** `SUN_GLINT_CLASSES`: the `glass` and `gunmetal` classes of `unit-surface.ts`, applied where
 * `surfaceMaterialFor` cuts the clone. That is every vehicle metal and glass node and every infantry weapon (lead ruling D2). It is
 * NOT applied to `armour`, `plate`, `rubber`, cloth, buildings, props or the swarm drone batch (one `unitDielectric` material), nor to
 * the support helicopter, which `support-aircraft.ts` builds with `SUPPORT_SURFACES`, a table whose clones carry no glint (ruling D7); the
 * main tanks have no glass node, so their optics stay metal (D8).
 *
 * **Corpses do not glint.** A settled wreck keeps its live weapon materials on explored-but-unseen ground, where the fog pass dims only
 * 0.4 before bloom and a glint of about 4 would still bloom through the shroud. `stripSunGlint` (called by `pushMeshWreck`, the one
 * entry every settled corpse and ragdoll passes) swaps each glint material for a memoised twin that runs the SAME hook chain (so a
 * rain rim, a mark, a wounded floor all stay) with its glint gain bound to a constant 0. Living units are drawn only where visible.
 *
 * **The sun.** The unit programs light with the sun as their only `DirectionalLight` (`lighting.ts`; the muzzle-flash lights are point
 * lights), so the term is restricted to the directional loop and, in the shader, to the light whose direction IS
 * `directionalLights[0]`'s. The sun is the only shadow caster, so three's light sort puts it first.
 *
 * **Compile-time variant.** A glint clone carries its own `customProgramCacheKey` segment (`SUN_GLINT_PROGRAM_KEY`) and chains
 * whatever `onBeforeCompile` it already has, the `applyRainRim` shape. `Material.clone()` drops the hook and the key, so
 * `carrySunGlint` re-applies it at every clone site that carries `carryTeamMark` (a scar, a running-gear clone, a death fade). A
 * wounded copy chains its source's hook itself (`wounded-read.ts`).
 *
 * **The flag.** ONE module flag (`passOn`) and ONE pair of shared uniforms, handed to every glint program. `setSunGlintPass` is the
 * `glint` debug layer; `stepSunGlint` is the per-frame write (ThreeRenderer, every frame) and CONSULTS the flag, so a hide holds
 * across a repaint however many writers there are.
 *
 * **Slice 2 seam.** Water glitter (W) on the THEME_WET ground reads this same flag and gain through `sunGlintGainNow()`; it is a
 * separate hook in `terrain/mesh.ts` and is not built here. The WebGPU twin of G is not built either: the segment is declared in
 * `UNIT_HOOK_SEGMENTS` with no node term, so the node census names it (`rl-unit: rl-sun-glint`) rather than hiding it.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as THREE from 'three';
import { HDR_GAINS } from './hdr-gains';
import type { SurfaceClass } from './unit-surface';

/** The program-key segment of a glint clone. */
export const SUN_GLINT_PROGRAM_KEY = 'rl-sun-glint';
/** The `userData` mark of a glint material (`Material.clone` copies `userData`, so a clone knows what its source was). */
export const SUN_GLINT_USERDATA_KEY = 'rlSunGlint';

/** The surface classes that glint. A literal list: the selection test pins it against every class. */
export const SUN_GLINT_CLASSES: ReadonlySet<SurfaceClass> = new Set<SurfaceClass>(['glass', 'gunmetal']);

/** True when a clone of class `cls` takes the lobe. */
export function surfaceGlints(cls: SurfaceClass): boolean {
  return SUN_GLINT_CLASSES.has(cls);
}

/** The cone's half-angle, degrees (ruling D5: "about 10 degrees"). The lobe is 1 inside `SUN_GLINT_INNER` of it and 0 beyond. */
export const SUN_GLINT_CONE_DEG = 10;
/** `cos(SUN_GLINT_CONE_DEG)`: the n.h at which the lobe starts to rise. */
export const SUN_GLINT_COS = Math.cos((SUN_GLINT_CONE_DEG * Math.PI) / 180);
/** The smoothstep's upper edge is `mix(cosCone, 1, SUN_GLINT_INNER)`. */
export const SUN_GLINT_INNER = 0.6;

function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/**
 * The TS mirror of the shader's lobe, a factor in [0, 1] on the gain: `smoothstep(cos, mix(cos, 1, inner), saturate(n.h))`, and 0 on
 * the far side of the light (`n.l <= 0`; the GLSL's `step(0.0, nl)` is 1 AT zero, matching `nDotL >= 0`).
 */
export function sunGlintLobe(nDotH: number, nDotL: number, cosCone = SUN_GLINT_COS): number {
  if (nDotL < 0) return 0;
  const nh = Math.min(1, Math.max(0, nDotH));
  return smoothstep(cosCone, cosCone + (1 - cosCone) * SUN_GLINT_INNER, nh);
}

/** The lobe added to `directSpecular` at one fragment, as a multiple of the sun's (shadowed) colour. */
export function sunGlintAdd(nDotH: number, nDotL: number, gain: number): number {
  return gain * sunGlintLobe(nDotH, nDotL);
}

/** The declarations and the wrapper, spliced after `#include <lights_physical_pars_fragment>`. */
export const SUN_GLINT_GLSL = /* glsl */ `
uniform float uGlintGain;
uniform float uGlintCos;
void RE_Direct_Glint( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#if NUM_DIR_LIGHTS > 0
  if ( all( equal( directLight.direction, directionalLights[ 0 ].direction ) ) ) {
    vec3 rlGlintH = normalize( directLight.direction + geometryViewDir );
    float rlGlintNH = saturate( dot( geometryNormal, rlGlintH ) );
    float rlGlintLobe = smoothstep( uGlintCos, mix( uGlintCos, 1.0, ${SUN_GLINT_INNER.toFixed(1)} ), rlGlintNH );
    reflectedLight.directSpecular += directLight.color * ( uGlintGain * rlGlintLobe * step( 0.0, dot( geometryNormal, directLight.direction ) ) );
  }
#endif
}
#undef RE_Direct
#define RE_Direct RE_Direct_Glint
`;

const ANCHOR = '#include <lights_physical_pars_fragment>';

function replaceOnce(src: string, find: string, by: string): string {
  const at = src.indexOf(find);
  if (at < 0) throw new Error(`sun-glint: the shader has no "${find}" to patch (three changed its chunks?)`);
  return src.slice(0, at) + by + src.slice(at + find.length);
}

/** The glint patch of a meshphysical fragment shader. */
export function patchSunGlint(fragmentShader: string): string {
  return replaceOnce(fragmentShader, ANCHOR, `${ANCHOR}\n${SUN_GLINT_GLSL}`);
}

export interface SunGlintUniforms {
  readonly gain: { value: number };
  readonly cos: { value: number };
}

let passOn = true;
const shared: SunGlintUniforms = { gain: { value: HDR_GAINS.sunGlint }, cos: { value: SUN_GLINT_COS } };

/** The one set of uniform objects every glint program is handed. */
export function sunGlintUniforms(): SunGlintUniforms {
  return shared;
}

/** What the shaders read now: the gain is 0 while the `glint` layer is hidden. (The seam water glitter reads in slice 2.) */
export function sunGlintGainNow(): number {
  return passOn ? HDR_GAINS.sunGlint : 0;
}

/** The per-frame write. It CONSULTS the flag, so no other writer can turn a hidden glint back on. */
export function stepSunGlint(): void {
  shared.gain.value = sunGlintGainNow();
  shared.cos.value = SUN_GLINT_COS;
}

/** The `glint` debug layer: the lobe on (true) or off (false). Idempotent both ways. */
export function setSunGlintPass(on: boolean): void {
  passOn = on;
  stepSunGlint();
}

/** Whether the layer shows the glint (the flag). */
export function sunGlintPassOn(): boolean {
  return passOn;
}

/** The materials whose compile hook IS the glint patch (identity, not the key: a running-gear clone's key can name glint while its hook does not). */
const hooked = new WeakSet<THREE.Material>();

function install(mat: THREE.MeshStandardMaterial, addKey: boolean): void {
  const prior = mat.onBeforeCompile;
  if (addKey) {
    const baseKey = mat.customProgramCacheKey();
    mat.customProgramCacheKey = () => `${baseKey}|${SUN_GLINT_PROGRAM_KEY}`;
  }
  mat.onBeforeCompile = (shader, renderer) => {
    prior.call(mat, shader, renderer);
    const u = sunGlintUniforms();
    shader.uniforms.uGlintGain = u.gain;
    shader.uniforms.uGlintCos = u.cos;
    shader.fragmentShader = patchSunGlint(shader.fragmentShader);
  };
  mat.userData = { ...mat.userData, [SUN_GLINT_USERDATA_KEY]: true };
  hooked.add(mat);
  mat.needsUpdate = true;
}

/**
 * Makes `mat` a glint material: its fragment shader gains the lobe, its program its own cache key, and the compile hook it
 * already has (if any) still runs first. Idempotent. `mat` must be a standard / physical material.
 */
export function applySunGlint(mat: THREE.MeshStandardMaterial): void {
  if (hooked.has(mat)) return;
  install(mat, !mat.customProgramCacheKey().includes(SUN_GLINT_PROGRAM_KEY));
}

/** True for a material `applySunGlint` made (or a clone of one: `Material.clone` copies the `userData` mark). */
export function isSunGlintMaterial(mat: THREE.Material): boolean {
  return (mat.userData as Record<string, unknown>)[SUN_GLINT_USERDATA_KEY] === true;
}

/**
 * A clone cut from `source`: keep what `source` carries. `Material.clone()` copies `userData` but drops `onBeforeCompile` (and
 * the program key, unless the clone's own code read it from the source, as the running gear's does), so a clone whose source was a
 * glint material is re-hooked here, AFTER the clone's own hook (which it chains), and the key is added only when it does not
 * already name glint. A no-op for an ordinary material and for a clone that already carries the patch.
 */
export function carrySunGlint(clone: THREE.Material, source: THREE.Material): void {
  if (!isSunGlintMaterial(source) || hooked.has(clone)) return;
  const std = clone as THREE.MeshStandardMaterial;
  if (!std.isMeshStandardMaterial) return;
  install(std, !std.customProgramCacheKey().includes(SUN_GLINT_PROGRAM_KEY));
}

/** The constant-zero gain a corpse's twin is bound to. */
const deadGain: { value: number } = { value: 0 };
const twinOf = new WeakMap<THREE.Material, THREE.Material>();
const deadTwins = new WeakSet<THREE.Material>();

/** The material a corpse draws with: `mat`'s twin, whose glint gain is a constant 0 (everything else `mat` does it still does). */
export function deadSunGlintMaterial(mat: THREE.Material): THREE.Material {
  if (!isSunGlintMaterial(mat) || deadTwins.has(mat)) return mat;
  const hit = twinOf.get(mat);
  if (hit) return hit;
  const src = mat as THREE.MeshStandardMaterial;
  const twin = src.clone();
  twin.customProgramCacheKey = src.customProgramCacheKey.bind(src);
  twin.onBeforeCompile = (shader, renderer) => {
    src.onBeforeCompile(shader, renderer);
    shader.uniforms.uGlintGain = deadGain;
  };
  hooked.add(twin);
  deadTwins.add(twin);
  twinOf.set(mat, twin);
  mat.addEventListener('dispose', () => {
    twinOf.delete(mat);
    twin.dispose();
  });
  return twin;
}

/** Swaps every glint material under `root` for its corpse twin (see the header). Idempotent: a twin is itself marked, and is returned as is. */
export function stripSunGlint(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(deadSunGlintMaterial);
    else mesh.material = deadSunGlintMaterial(mesh.material);
  });
}
