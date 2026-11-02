/**
 * Look uplift L3 (GH-943): materials whose normal and occlusion-roughness-metal (ORM) maps are
 * AUTHORED (`extras.rl_orm`, written by `tools/src/meshes/maps-pass.ts`), as opposed to the flat
 * maps a Meshy export carries.
 *
 * This file owns the three facts that are not about the team mask:
 *
 *  - **Colour space.** The normal map and the ORM map are DATA, so `NoColorSpace`; the base colour
 *    stays `SRGBColorSpace` (`prepareTexturedMap`). `GLTFLoader` leaves both maps untagged, and a
 *    test pins it: a normal map decoded as sRGB tilts every surface.
 *  - **Anisotropy.** 8, so the 7 mm-per-texel detail survives the dimetric view's oblique angle.
 *    three clamps it to what the GPU supports.
 *  - **The `normal-maps` debug layer.** Hiding it drops `normalMap` on every registered material
 *    and puts it back. A material-field write nothing per-frame re-asserts, so the toggle holds.
 *    Materials made while it is off start with their normal map off, so a hidden layer stays
 *    hidden across a rebuild. Clones the surface pass, the team mask, the scars and the running
 *    gear cut are registered as they are cut (`registerAuthored`).
 */
import * as THREE from 'three';

/** The material extras key (`GLTFLoader` hands extras over as `userData`). */
export const ORM_USERDATA_KEY = 'rl_orm';

export const AUTHORED_ANISOTROPY = 8;

/** True for a standard material whose maps are authored: the extras mark AND both maps present. */
export function isAuthoredMaterial(m: THREE.Material): boolean {
  const std = m as THREE.MeshStandardMaterial;
  return (
    std.isMeshStandardMaterial === true &&
    (std.userData as Record<string, unknown> | undefined)?.[ORM_USERDATA_KEY] === true &&
    (std.normalMap !== null || stashed.has(std)) &&
    std.roughnessMap !== null
  );
}

/** Pin the data maps' colour space and anisotropy. Idempotent: `needsUpdate` only on a change. */
export function prepareAuthoredMaps(std: THREE.MeshStandardMaterial): void {
  for (const t of [std.normalMap ?? stashed.get(std) ?? null, std.roughnessMap, std.metalnessMap, std.aoMap]) {
    if (!t) continue;
    let changed = false;
    if (t.colorSpace !== THREE.NoColorSpace) {
      t.colorSpace = THREE.NoColorSpace;
      changed = true;
    }
    if (t.anisotropy !== AUTHORED_ANISOTROPY) {
      t.anisotropy = AUTHORED_ANISOTROPY;
      changed = true;
    }
    if (changed) t.needsUpdate = true;
  }
}

const registry = new Set<WeakRef<THREE.MeshStandardMaterial>>();
/** The normal map a material had before the layer took it away. */
const stashed = new WeakMap<THREE.MeshStandardMaterial, THREE.Texture>();
let normalMapsOn = true;

/** Track `mat` for the `normal-maps` layer. A material made while the layer is off starts without its normal map. */
export function registerAuthored(mat: THREE.MeshStandardMaterial, source?: THREE.Material): void {
  registry.add(new WeakRef(mat));
  // A clone cut while the layer is off copied a null `normalMap`: it inherits its source's stash.
  const inherited = source ? stashed.get(source as THREE.MeshStandardMaterial) : undefined;
  if (mat.normalMap === null && inherited) stashed.set(mat, inherited);
  if (!normalMapsOn && mat.normalMap) {
    stashed.set(mat, mat.normalMap);
    mat.normalMap = null;
    mat.needsUpdate = true;
  }
}

/** The `normal-maps` debug layer: returns how many materials it wrote. */
export function setNormalMapsPass(on: boolean): number {
  normalMapsOn = on;
  let n = 0;
  for (const ref of [...registry]) {
    const m = ref.deref();
    if (!m) {
      registry.delete(ref);
      continue;
    }
    if (!on && m.normalMap) {
      stashed.set(m, m.normalMap);
      m.normalMap = null;
      m.needsUpdate = true;
      n++;
    } else if (on && m.normalMap === null) {
      const t = stashed.get(m);
      if (t) {
        m.normalMap = t;
        stashed.delete(m);
        m.needsUpdate = true;
        n++;
      }
    }
  }
  return n;
}

/** Live registered materials (test seam). */
export function authoredCount(): number {
  let n = 0;
  for (const ref of registry) if (ref.deref()) n++;
  return n;
}

/** Test seam: forget everything, and switch the pass back on. */
export function resetAuthoredRegistry(): void {
  registry.clear();
  normalMapsOn = true;
}
