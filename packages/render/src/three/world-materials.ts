/**
 * Every world object's material, in one place (spec §4).
 *
 * Before Phase 0 there were three: a toon ramp indexed by normal
 * (`palette-material.ts`), a photo bake under a 3-band 30% shade
 * (`textured-building.ts`) and a vertex-colour pass-through for terrain.
 * None of them consumed three.js's lights, so nothing could cast or receive
 * a shadow, and each carried its own private sun. All three are now
 * `MeshStandardMaterial`, lit by `lighting.ts`'s one sun.
 *
 * A kit-built asset keeps its palette identity: `liftTone` picks the ramp's
 * LIT step as a flat albedo, and the darker steps that used to be shade
 * bands are what the sun and ambient occlusion now produce. A Meshy asset
 * keeps the material `GLTFLoader` built for it -- "use as-is" is finally
 * literal, and a re-export that ships metalness/roughness/normal maps
 * (spec §8) is consumed with no change here.
 */
import * as THREE from 'three';
import { paletteHex } from './palette-hex';

export const WORLD_ROUGHNESS = 0.85;

/** The lit face of a ramp: index 1 of a ramp with three or more steps
 *  (index 0 is the lightest, `data/palette.json`'s own convention), index 0
 *  of a shorter one. */
export function liftTone(ramp: readonly string[]): string {
  if (ramp.length === 0) throw new Error('liftTone: empty ramp');
  return ramp.length >= 3 ? ramp[1] : ramp[0];
}

export function rampMaterial(ramp: readonly string[]): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(liftTone(ramp)),
    roughness: WORLD_ROUGHNESS,
    metalness: 0,
  });
}

/** Textures already prepared, by identity (not a `userData` flag: `Texture.clone`
 *  copies `userData` and would hand an unprepared copy a "done" mark). */
const prepared = new WeakSet<THREE.Texture>();

/** A base-colour map is a photograph: sRGB, mipmapped (a 2048 bake is drawn
 *  at ~40 px at zoom 0.35), repeat-safe.
 *
 *  Idempotent per texture: a vehicle's bake is shared by every build of it,
 *  and `needsUpdate` re-uploads the whole 2048 image plus its mips. The first
 *  call does exactly what it always did; a later call on a texture whose
 *  settings still read as prepared leaves `version` alone, so a garage
 *  purchase (a rebuild) never costs a re-upload. A texture someone has since
 *  re-tagged is prepared again. */
export function prepareTexturedMap(map: THREE.Texture): THREE.Texture {
  if (
    prepared.has(map) &&
    map.colorSpace === THREE.SRGBColorSpace &&
    map.generateMipmaps &&
    map.minFilter === THREE.LinearMipmapLinearFilter &&
    map.magFilter === THREE.LinearFilter
  ) {
    return map;
  }
  map.colorSpace = THREE.SRGBColorSpace;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  prepared.add(map);
  return map;
}

/**
 * Normalise the material `GLTFLoader` built for a textured asset and hand it
 * back. Metalness defaults to `metallicFactor` 1 in glTF; with no metalness
 * map and no environment map that renders black, so a bake that ships only
 * `base_color` is treated as dielectric. A bake that ships the maps keeps
 * its own factors.
 */
export function texturedMaterial(loaded: THREE.Material): THREE.MeshStandardMaterial {
  const withMap = loaded as THREE.Material & { map?: THREE.Texture | null };
  const map = withMap.map ?? null;
  if (!map) throw new Error(`texturedMaterial: ${loaded.type} has no base colour map`);
  const std = (loaded as THREE.MeshStandardMaterial).isMeshStandardMaterial
    ? (loaded as THREE.MeshStandardMaterial)
    : new THREE.MeshStandardMaterial({ map });
  prepareTexturedMap(map);
  if (!std.metalnessMap) std.metalness = 0;
  if (!std.roughnessMap) std.roughness = WORLD_ROUGHNESS;
  std.envMapIntensity = 0;
  std.needsUpdate = true;
  return std;
}

/**
 * The SCAR tint: what a damaged-but-living hull or building is lerped toward
 * (`units/vehicle-damage.ts`, `units/building-damage.ts`). It was the wreck's
 * tint too until the soot recolour below (2026-10-15); the scars were approved
 * on their own mock sheet (`_coord/vehicle-damage`, 2026-10-14) against THIS
 * value, so they keep it and the wreck has a constant of its own.
 *
 * History, kept because the measurement explains the wreck's own move: chosen
 * by the project lead on 2026-09-15 ("a sooty dark grey that keeps the bakes'
 * detail visible") as `0x6a5f55`, a palette entry (`limestone.7`, `#75624A`)
 * since polish VR-10 (2026-10-08). As a MULTIPLIER on a bake whose mean linear
 * luminance is 0.04-0.13 it put a wreck's effective albedo at 0.005-0.016 --
 * the retired `shadow.1` near-black -- and on the bakes that shipped by
 * 2026-10-15 58-78 % of every wreck's pixels sat below luma 8.
 */
export const CHARRED_TINT_KEY = 'limestone.7';
export const CHARRED_TINT_HEX = parseInt(paletteHex(CHARRED_TINT_KEY).slice(1), 16);

/**
 * The palette key a textured WRECK is recoloured onto: `gunmetal.2`
 * (`#5C625F`), the lit face of `CHARRED_RAMP` (`units/vehicle-mesh-role.ts`),
 * so the textured and the palette wreck are one decision with one key.
 * `mesh-vehicle-death.test.ts` pins the two together, albedo against albedo.
 */
export const CHARRED_WRECK_KEY = 'gunmetal.2';

/**
 * The brightness cap: a wreck's mean albedo may reach at most this fraction of
 * its OWN live bake's mean, so a wreck never reads lighter dead than alive.
 * Uncapped, the darkest bakes are gained up past the vehicle they were:
 * `apc_eitan` (bake mean 0.052) read luma 57 dead against 39 alive in the mock,
 * the grey-livery look the lead rejected on 2026-09-15.
 *
 * **0.8, measured, not 1.** Equal albedo is not equal brightness on screen: a
 * wreck lies tilted, and at some headings its slumped faces catch more sun than
 * the level hull did. Fourteen textured vehicles, four headings x zoom 1 and
 * 2, wreck mean luma over its own pixels against the live hull's at the same
 * spot and heading (ANGLE/Metal, wrecks in sight; `_coord/wreck-tone/`): the
 * WORST single frame read 1.10x the live hull at cap 1 (`apc_kipod`; the
 * Namer and the jeep 1.08, the Eitan 1.05), 1.03 at 0.9, 0.99 at 0.85, and
 * **0.95 at 0.8** -- the first rung with headroom on every vehicle, which this
 * is. The cap binds on every shipped bake darker than `keyLuma / cap` (0.148):
 * all of them but `paramotor`'s wing (0.164), which lands on the key itself.
 */
export const CHARRED_WRECK_CAP = 0.8;

/** The material extras key the wreck pass writes (`tools/src/meshes/bake-luma.ts`):
 *  the bake's mean linear luminance. `GLTFLoader` hands extras over as `userData`. */
export const BAKE_LUMA_KEY = 'rl_bake_luma';

/** Rec. 709 luminance of a LINEAR colour -- the shader's own weights. */
export function linearLuma(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * The colour a soot-recoloured wreck carries in `color`: the key, times the
 * gain that puts the wreck's MEAN albedo on `min(keyLuma, cap x bakeLuma)`.
 *
 * The shader multiplies `color` by each texel's luminance `Y`, so the albedo's
 * mean luminance is `luma(color) x bakeLuma`. Solving for that mean:
 * `gain = min(1 / bakeLuma, cap / keyLuma)`. Uncapped, every wreck lands on the
 * key whatever its bake ("charring is the fire, not the paint"); capped, it
 * lands on its own live bake's mean and never above it.
 */
export function sootColor(bakeLuma: number, key: string = CHARRED_WRECK_KEY, cap: number = CHARRED_WRECK_CAP): THREE.Color {
  if (!(bakeLuma > 0)) throw new Error(`sootColor: bake luminance must be positive, got ${bakeLuma}`);
  const color = new THREE.Color(paletteHex(key));
  const gain = Math.min(1 / bakeLuma, cap / linearLuma(color));
  return color.multiplyScalar(gain);
}

/** The fragment chunk: the bake's LUMINANCE, not its colour, times `color`.
 *  Clamped at 1, the physical ceiling of an albedo. Replaces `map_fragment`. */
export const SOOT_MAP_FRAGMENT = /* glsl */ `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  diffuseColor.rgb = min( diffuseColor.rgb * dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), vec3( 1.0 ) );
  diffuseColor.a *= sampledDiffuseColor.a;
#endif`;

/** One program for every wreck: the per-vehicle number rides in `color`. */
export const SOOT_PROGRAM_KEY = 'rl-soot';

function sootOnBeforeCompile(shader: { fragmentShader: string }): void {
  if (!shader.fragmentShader.includes('#include <map_fragment>')) {
    throw new Error('charredTexturedMaterial: the fragment shader has no <map_fragment> to replace');
  }
  shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', SOOT_MAP_FRAGMENT);
}

/**
 * The charred sibling of `texturedMaterial`: a SOOT RECOLOUR of the same bake,
 * on a material of its own, driven fully rough.
 *
 * Settled 2026-10-15 (the wreck-tone mock, `_coord/wreck-tone/`): the bake's
 * detail survives as LUMINANCE, its livery hue does not, and the mean lands on
 * `CHARRED_WRECK_KEY` under `CHARRED_WRECK_CAP` (`sootColor`). It replaced a
 * plain multiply by `CHARRED_TINT_HEX`, which no palette key could lift off
 * near-black on these bakes: a multiply tops out at the bake itself, and the
 * brightest neutral key kept the livery hue, so an Eitan read as a live green
 * APC.
 *
 * Needs `extras.rl_bake_luma` on the loaded material, written by the wreck
 * pass, and refuses loudly without it: a wreck charred off a guessed mean is
 * the near-black this replaced, or the grey livery the cap exists to prevent.
 *
 * A clone, never a mutation: `loaded` is shared with the live twin (the wreck
 * pass gives both nodes the same `mesh`), so recolouring it in place would
 * char the living vehicle too. The clone keeps `map`, `metalnessMap` and
 * `normalMap` by reference -- one upload, two draws -- and every wreck shares
 * one program (`SOOT_PROGRAM_KEY`).
 *
 * `roughness: 1` and `metalness: 0` are not cosmetic defaults: a burnt-out
 * hull has no specular highlight left, and leaving the bake's own gloss
 * would put a clean sheen on a wreck. They are applied AFTER
 * `texturedMaterial`'s own normalisation, so they win over it deliberately,
 * including over a bake that ships its own `roughnessMap`.
 */
export function charredTexturedMaterial(loaded: THREE.Material): THREE.MeshStandardMaterial {
  const bakeLuma = (loaded.userData as Record<string, unknown> | undefined)?.[BAKE_LUMA_KEY];
  if (typeof bakeLuma !== 'number' || !(bakeLuma > 0)) {
    throw new Error(
      `charredTexturedMaterial: material "${loaded.name}" carries no extras.${BAKE_LUMA_KEY} -- ` +
        'run `pnpm wreck:meshes` (then damage:meshes and encode:meshes) on its GLB'
    );
  }
  const charred = texturedMaterial(loaded).clone();
  charred.color.copy(sootColor(bakeLuma));
  charred.roughness = 1;
  charred.metalness = 0;
  charred.onBeforeCompile = sootOnBeforeCompile;
  charred.customProgramCacheKey = () => SOOT_PROGRAM_KEY;
  charred.needsUpdate = true;
  return charred;
}

export function texturedMapMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: prepareTexturedMap(map),
    roughness: WORLD_ROUGHNESS,
    metalness: 0,
  });
}
