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
 * GH-943 P3 (T1):
 *  - the P3 slots: a `ShaderMaterial` by its `name` (`P3_MATERIAL_NAMES`); a hooked material whose `rl-` segments are all unit
 *    hooks (`UNIT_HOOK_SEGMENTS`) to `unit`; the outline, banner and backdrop by their one-segment keys;
 *  - SHARED unit twins: a `unit` twin is memoised by (the base legacy material, `legacyBaseOf`; its hook segments; `transparent`,
 *    `side` and the stencil state), refcounted by the legacy materials using it. A per-vehicle running-gear clone or a per-entity
 *    fade clone shares its base's twin (no program per vehicle); per-object values arrive through object-scoped uniforms (T3,
 *    ruling P3-R3). The last legacy user's `dispose` frees it;
 *  - every swap writes the per-mesh record (`recordAdoption`, ruling P3-R2) and every P3 twin takes the legacy pipeline state
 *    (`copyRenderState`). The P2 slots (ground, foliage, ring) keep exactly their P2 behaviour;
 *  - `mirrorTwinVisibility`: `visible` from each live twin's legacy material to the twin, both ways, run before the scene is
 *    traversed (ruling P3-R4).
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as THREE from 'three';
import type { MaterialKit } from './backend/backend';
import { FOLIAGE_SWAY_KEY, FOLIAGE_SWAY_WET_KEY, TRUNK_SWAY_KEY, TRUNK_SWAY_WET_KEY } from './terrain/decor-mesh';
import { SELECTION_RING_MATERIAL_NAME } from './units/selection-ring';
import { BACKDROP_HOOK_KEY, BANNER_HOOK_KEY, hookSegments, OUTLINE_HOOK_KEY, P3_MATERIAL_NAMES, UNIT_HOOK_SEGMENTS } from './material-names';
import { copyRenderState, isTwin, legacyBaseOf, markTwin, recordAdoption, TWIN_LEGACY_KEY } from './twin-identity';

export type TwinSlot = keyof MaterialKit;

const FOLIAGE_KEYS: ReadonlySet<string> = new Set([FOLIAGE_SWAY_KEY, FOLIAGE_SWAY_WET_KEY, TRUNK_SWAY_KEY, TRUNK_SWAY_WET_KEY]);
/** The P2 slots: adopted exactly as in P2 (one twin per legacy object, no render-state copy). */
const P2_SLOTS: ReadonlySet<TwinSlot> = new Set<TwinSlot>(['ground', 'foliage', 'ring']);
const ONE_SEGMENT_SLOTS: ReadonlyMap<string, TwinSlot> = new Map<string, TwinSlot>([
  [OUTLINE_HOOK_KEY, 'outline'],
  [BANNER_HOOK_KEY, 'banner'],
  [BACKDROP_HOOK_KEY, 'backdrop'],
]);

/** The P3 slots (T1), every one null: what a kit with only the P2 twins spreads in (`{ ...NULL_P3_SLOTS, ring }`). */
export const NULL_P3_SLOTS: Readonly<Omit<MaterialKit, 'ground' | 'foliage' | 'ring'>> = Object.freeze({
  unit: null,
  outline: null,
  banner: null,
  backdrop: null,
  decal: null,
  overlay: null,
  zoneBand: null,
  supplyRoute: null,
  trail: null,
  xray: null,
  particle: null,
  tracer: null,
  vfxMesh: null,
  rimFade: null,
  beam: null,
  rotor: null,
  flipbook: null,
  smokeScreen: null,
});

/** The kit slot whose twin replaces `m`, or null for a material with no twin slot (stock materials, every other hook). */
export function legacyTwinSlot(m: THREE.Material): TwinSlot | null {
  if ((m as THREE.ShaderMaterial).isShaderMaterial === true) {
    if (m.name === SELECTION_RING_MATERIAL_NAME) return 'ring';
    return (P3_MATERIAL_NAMES as Readonly<Record<string, TwinSlot>>)[m.name] ?? null;
  }
  let key: string;
  try {
    key = m.customProgramCacheKey();
  } catch {
    return null;
  }
  // `rl-ground`, and the wet programs `rl-ground-wet` / `rl-ground-wet-<id>` (`GroundMaterial.customProgramCacheKey`).
  if (key === 'rl-ground' || key.startsWith('rl-ground-wet')) return 'ground';
  if (FOLIAGE_KEYS.has(key)) return 'foliage';
  const segments = hookSegments(m);
  if (segments.length === 0) return null;
  if (segments.every((s) => UNIT_HOOK_SEGMENTS.has(s))) return 'unit';
  return segments.length === 1 ? (ONE_SEGMENT_SLOTS.get(segments[0] as string) ?? null) : null;
}

/** One shared unit twin and how many legacy materials draw through it. */
interface SharedTwin {
  readonly twin: THREE.Material;
  users: number;
}

/** The identity cache: legacy -> twin, and the set of twins (so a twin is never taken for a legacy material). */
export interface TwinCache {
  readonly twinOf: WeakMap<THREE.Material, THREE.Material>;
  readonly twins: WeakSet<THREE.Material>;
  /** P3 (T1): the shared `unit` twins, base legacy material -> memo key -> twin. */
  readonly shared: WeakMap<THREE.Material, Map<string, SharedTwin>>;
  /** P3 (T1): every twin not yet disposed, for the pre-traversal `visible` mirror. Weak: a dropped twin leaves it. */
  readonly live: Set<WeakRef<THREE.Material>>;
}

export function createTwinCache(): TwinCache {
  return { twinOf: new WeakMap(), twins: new WeakSet(), shared: new WeakMap(), live: new Set() };
}

interface DrawLike extends THREE.Object3D {
  material?: THREE.Material | THREE.Material[];
}

/** The pipeline state two users of one shared unit twin must agree on (the memo key past the base). */
function unitMemoKey(m: THREE.Material): string {
  return [
    hookSegments(m).join('|'),
    m.transparent,
    m.side,
    m.stencilWrite,
    m.stencilFunc,
    m.stencilRef,
    m.stencilFuncMask,
    m.stencilWriteMask,
    m.stencilFail,
    m.stencilZFail,
    m.stencilZPass,
  ].join(',');
}

/** Runs `fn` the first time `m` is disposed, never again. */
function onFirstDispose(m: THREE.Material, fn: () => void): void {
  const once = (): void => {
    m.removeEventListener('dispose', once);
    fn();
  };
  m.addEventListener('dispose', once);
}

function registerLive(cache: TwinCache, twin: THREE.Material): void {
  const ref = new WeakRef(twin);
  cache.live.add(ref);
  onFirstDispose(twin, () => cache.live.delete(ref));
}

/**
 * Swaps every legacy material under `root` that has a twin factory in `kit` for its twin. Returns how many objects it swapped.
 * A material whose slot is null in `kit` is left as it is (the node census hides or names it).
 */
export function adoptMaterials(root: THREE.Object3D, kit: MaterialKit, cache: TwinCache): number {
  let swapped = 0;
  const sharedTwin = (m: THREE.Material, make: (legacy: THREE.Material) => THREE.Material): THREE.Material => {
    const base = legacyBaseOf(m);
    const key = unitMemoKey(m);
    let perBase = cache.shared.get(base);
    if (perBase === undefined) {
      perBase = new Map();
      cache.shared.set(base, perBase);
    }
    let entry = perBase.get(key);
    if (entry === undefined) {
      const twin = make(m);
      // A shared twin records its memo BASE (ruling P3-R2): `legacyOf` without a mesh record resolves to the template material.
      markTwin(twin, base);
      copyRenderState(m, twin);
      entry = { twin, users: 0 };
      perBase.set(key, entry);
      cache.twins.add(twin);
      registerLive(cache, twin);
    }
    const held = entry;
    const memo = perBase;
    held.users++;
    cache.twinOf.set(m, held.twin);
    onFirstDispose(m, () => {
      cache.twinOf.delete(m);
      held.users--;
      if (held.users > 0) return;
      if (memo.get(key) === held) memo.delete(key);
      held.twin.dispose();
    });
    return held.twin;
  };
  const twinFor = (m: THREE.Material): THREE.Material | null => {
    if (cache.twins.has(m) || isTwin(m)) return null;
    const hit = cache.twinOf.get(m);
    if (hit !== undefined) return hit;
    const slot = legacyTwinSlot(m);
    if (slot === null) return null;
    const make = kit[slot] as ((legacy: THREE.Material) => THREE.Material) | null;
    if (make === null) return null;
    if (slot === 'unit') return sharedTwin(m, make);
    const twin = make(m);
    // Every twin names its legacy material (a factory may already have; the record is the same object).
    if ((twin.userData as Record<string, unknown>)[TWIN_LEGACY_KEY] === undefined) markTwin(twin, m);
    if (!P2_SLOTS.has(slot)) copyRenderState(m, twin);
    cache.twinOf.set(m, twin);
    cache.twins.add(twin);
    registerLive(cache, twin);
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
      // The per-mesh record (ruling P3-R2): this mesh's own legacy material, which a clone site reads back through `legacyOf`.
      recordAdoption(d, mat, t);
      swapped++;
    }
  });
  return swapped;
}

/**
 * Ruling P3-R4: `visible` from each live twin's legacy material (a shared unit twin: its base) onto the twin, BOTH ways, before the
 * scene is traversed (`ThreeRenderer.flushNodeAdoption`, the top of every node render). Traversal skips a material that is not
 * visible, so a twin's own per-render update could never show it again. Returns how many twins it changed.
 */
export function mirrorTwinVisibility(cache: TwinCache): number {
  let changed = 0;
  for (const ref of cache.live) {
    const twin = ref.deref();
    if (twin === undefined) {
      cache.live.delete(ref);
      continue;
    }
    const legacy = (twin.userData as Record<string, unknown>)[TWIN_LEGACY_KEY] as THREE.Material | undefined;
    if (legacy === undefined || twin.visible === legacy.visible) continue;
    twin.visible = legacy.visible;
    changed++;
  }
  return changed;
}
