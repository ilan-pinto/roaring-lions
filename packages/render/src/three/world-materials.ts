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

/** A base-colour map is a photograph: sRGB, mipmapped (a 2048 bake is drawn
 *  at ~40 px at zoom 0.35), repeat-safe. */
export function prepareTexturedMap(map: THREE.Texture): THREE.Texture {
  map.colorSpace = THREE.SRGBColorSpace;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
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
 * The tint a charred wreck multiplies its own bake by.
 *
 * A TINT rather than a replacement because the bake is the asset: the lead's
 * "use as-is" applies to a wreck exactly as it applies to a live vehicle, so
 * the photograph's own panel lines, rivets and roughness must survive, only
 * darker and desaturated by the multiply. `MeshStandardMaterial.color`
 * multiplies `map` per-fragment, which is precisely that.
 *
 * **Chosen by the project lead on 2026-09-15: "a sooty dark grey that keeps the
 * bakes' detail visible".** It was `0x2a2620` until then, and the reason it
 * moved is the eleven-pair screenshot sheet: at that value seven of the eleven
 * wrecks photographed as featureless black silhouettes at gameplay zoom, with
 * no panel line, hatch or wheel surviving. Measured inside `mbt_lavi`'s own
 * hull at zoom 2.2, **67.2%** of the body's pixels were crushed below
 * luminance 8 and the whole hull held 545 distinct colours; at this value it
 * is **39.1%** and 949. The lead's call is detail over darkness, and the
 * shipped value is the darker of the two candidates captured for it -- the
 * lighter one (`0x8a7f74`) reads as a dusty vehicle rather than a burnt one.
 *
 * Kept in step with `CHARRED_RAMP` (`units/vehicle-mesh-role.ts`), which is
 * the same decision on the palette path: the two must land on the same TONE or
 * a burnt Lavi and a burnt Eitan read as different events.
 * `mesh-vehicle-death.test.ts` pins that they do.
 */
export const CHARRED_TINT_HEX = 0x6a5f55;

/**
 * The charred sibling of `texturedMaterial`: the same normalised bake, on a
 * material of its OWN, tinted to `CHARRED_TINT_HEX` and driven fully rough.
 *
 * A clone, never a mutation, for the reason every material rule in this file
 * turns on: `loaded` is the one material `GLTFLoader` built for that glTF
 * primitive, and a wreck mesh SHARES it with its live twin (the wreck pass
 * gives the two nodes the same `mesh` index), so darkening it in place would
 * char the living vehicle too. The clone keeps `map`, `metalnessMap` and
 * `normalMap` by reference -- one upload, two draws.
 *
 * `roughness: 1` and `metalness: 0` are not cosmetic defaults: a burnt-out
 * hull has no specular highlight left, and leaving the bake's own gloss
 * would put a clean sheen on a wreck. They are applied AFTER
 * `texturedMaterial`'s own normalisation, so they win over it deliberately,
 * including over a bake that ships its own `roughnessMap`.
 */
export function charredTexturedMaterial(loaded: THREE.Material): THREE.MeshStandardMaterial {
  const charred = texturedMaterial(loaded).clone();
  charred.color.setHex(CHARRED_TINT_HEX);
  charred.roughness = 1;
  charred.metalness = 0;
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
