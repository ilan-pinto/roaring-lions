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

export function texturedMapMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: prepareTexturedMap(map),
    roughness: WORLD_ROUGHNESS,
    metalness: 0,
  });
}
