/**
 * GH-943 WebGPU P2 (T1): which legacy material a node twin replaces, and the swap itself, for `ThreeRenderer.adoptNodeMaterials`.
 *
 * A legacy material is recognised by the key it already compiles under (the ground's `customProgramCacheKey`, the foliage sway's,
 * the ring's `name`), never by a new tag, so the census, the program cache and this table read one name. The legacy OBJECT stays
 * the owner of its uniform record and its debug setters: only `mesh.material` changes, so no toggle code changes.
 *
 * One legacy object gets one twin (an identity cache), and the twin is disposed with the legacy object it stands for. A twin is
 * never adopted again (it may carry its legacy key as its name). Loaded by the ThreeRenderer chunk only: types from the backend.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as THREE from 'three';
import type { MaterialKit } from './backend/backend';
import { FOLIAGE_SWAY_KEY, FOLIAGE_SWAY_WET_KEY, TRUNK_SWAY_KEY, TRUNK_SWAY_WET_KEY } from './terrain/decor-mesh';
import { SELECTION_RING_MATERIAL_NAME } from './units/selection-ring';

export type TwinSlot = keyof MaterialKit;

const FOLIAGE_KEYS: ReadonlySet<string> = new Set([FOLIAGE_SWAY_KEY, FOLIAGE_SWAY_WET_KEY, TRUNK_SWAY_KEY, TRUNK_SWAY_WET_KEY]);

/** The kit slot whose twin replaces `m`, or null for a material with no twin slot (stock materials, every other hook). */
export function legacyTwinSlot(m: THREE.Material): TwinSlot | null {
  if ((m as THREE.ShaderMaterial).isShaderMaterial === true) return m.name === SELECTION_RING_MATERIAL_NAME ? 'ring' : null;
  let key: string;
  try {
    key = m.customProgramCacheKey();
  } catch {
    return null;
  }
  // `rl-ground`, and the wet programs `rl-ground-wet` / `rl-ground-wet-<id>` (`GroundMaterial.customProgramCacheKey`).
  if (key === 'rl-ground' || key.startsWith('rl-ground-wet')) return 'ground';
  return FOLIAGE_KEYS.has(key) ? 'foliage' : null;
}

/** The identity cache: legacy -> twin, and the set of twins (so a twin is never taken for a legacy material). */
export interface TwinCache {
  readonly twinOf: WeakMap<THREE.Material, THREE.Material>;
  readonly twins: WeakSet<THREE.Material>;
}

export function createTwinCache(): TwinCache {
  return { twinOf: new WeakMap(), twins: new WeakSet() };
}

interface DrawLike extends THREE.Object3D {
  material?: THREE.Material | THREE.Material[];
}

/**
 * Swaps every legacy material under `root` that has a twin factory in `kit` for its twin. Returns how many objects it swapped.
 * A material whose slot is null in `kit` is left as it is (the node census hides or names it).
 */
export function adoptMaterials(root: THREE.Object3D, kit: MaterialKit, cache: TwinCache): number {
  let swapped = 0;
  const twinFor = (m: THREE.Material): THREE.Material | null => {
    if (cache.twins.has(m)) return null;
    const hit = cache.twinOf.get(m);
    if (hit !== undefined) return hit;
    const slot = legacyTwinSlot(m);
    if (slot === null) return null;
    const make = kit[slot] as ((legacy: THREE.Material) => THREE.Material) | null;
    if (make === null) return null;
    const twin = make(m);
    cache.twinOf.set(m, twin);
    cache.twins.add(twin);
    // The twin lives as long as the legacy object it stands for: whoever disposes the legacy material frees both.
    m.addEventListener('dispose', () => twin.dispose());
    return twin;
  };
  root.traverse((o) => {
    const d = o as DrawLike;
    const mat = d.material;
    if (mat === undefined) return;
    if (Array.isArray(mat)) {
      let changed = false;
      const next = mat.map((m) => {
        const t = twinFor(m);
        if (t === null) return m;
        changed = true;
        return t;
      });
      if (changed) {
        d.material = next;
        swapped++;
      }
      return;
    }
    const t = twinFor(mat);
    if (t !== null) {
      d.material = t;
      swapped++;
    }
  });
  return swapped;
}
