/**
 * Unit SURFACE response: roughness and metalness per node role (GH-705 Task 6,
 * the lead's ruling of 23 Oct 2026 shipping the pass).
 *
 * Today every unit surface answers the sun the same way: a bake with no
 * metallic-roughness map is `WORLD_ROUGHNESS` 0.85 / metalness 0
 * (`texturedMaterial`), and the bakes that ship one carry a flat map
 * (measured: roughness mean 0.796-0.797, metalness 0.003-0.004 on all ten
 * read, every texel in the lowest metal fifth). So a barrel, a rubber track
 * and a cloth uniform were one material. This pass gives each NODE ROLE its
 * own `{ roughness, metalness }` -- the roles the GLBs already carry
 * (`rl_role` / node name: `uniform`, `weapon`, ... for teams; `hull_rubber`,
 * `turret_metal`, ... for vehicles). The palette is untouched: colour still
 * comes from the bake (or the role ramp), only the specular response moves.
 *
 * Mechanism: the GLB's one shared material is CLONED once per surface class
 * (memoised per original): +0 textures and +0 draw calls (each role node is
 * already its own draw), and +0 programs on a bake with no MR map (same
 * defines). On a bake WITH one, a metal class drops the metalness map, which
 * is one more program permutation (no `USE_METALNESSMAP`). A bake with an MR map
 * keeps it for roughness (the factor rescales the map's own mean onto the
 * target) and, on a metal class only, drops it for metalness, since a factor
 * cannot lift a map that reads 0.
 *
 * Metalness is capped at 0.45 (`gunmetal`): a unit material has no
 * environment map (`envMapIntensity = 0`), so a metal surface keeps only the
 * sun's specular lobe and no diffuse term. Higher draws near-black.
 *
 * The `unit-surface` debug layer writes every clone back to today's values
 * (and the pass back on). A clone's `dispose` event drops it from the
 * registry and from the memo once every template that was handed it has
 * released it (a count: two templates built from one loaded GLTF share the
 * original material, so they share its clones too).
 *
 * Known limit: a scar clone (`vehicle-damage`) or a running-gear clone
 * (`running-gear-binding`) is cut with `Material.clone()` from the surface
 * clone and copies the roughness/metalness in force when it was cut; it is
 * not in the registry, so toggling `unit-surface` afterwards does not reach
 * it. A debug-only effect: the shipped pass is always on. And a scar on a
 * mapped bake's rubber lerps the roughness FACTOR (about 1.2 there) toward 1,
 * so a scar makes that rubber marginally less rough rather than more; tiny,
 * and presentation-only.
 */
import * as THREE from 'three';

export interface SurfaceParams {
  readonly roughness: number;
  readonly metalness: number;
}

/** The surface classes. Team roles map to themselves; vehicle nodes map by
 *  the suffix after the part prefix (`hull_rubber` -> `rubber`). */
export type SurfaceClass =
  | 'cloth'
  | 'leather'
  | 'skin'
  | 'wood'
  | 'gear'
  | 'gunmetal'
  | 'armour'
  | 'plate'
  | 'rubber'
  | 'glass';

/**
 * The shipped numbers: matte cloth, armour and rubber at 0.78-0.96, metal
 * contrast on barrels (0.42 / 0.45), a glossier glass.
 */
export const SURFACE_PARAMS: Readonly<Record<SurfaceClass, SurfaceParams>> = {
  cloth: { roughness: 0.92, metalness: 0 },
  leather: { roughness: 0.7, metalness: 0 },
  skin: { roughness: 0.6, metalness: 0 },
  wood: { roughness: 0.8, metalness: 0 },
  gear: { roughness: 0.8, metalness: 0 },
  gunmetal: { roughness: 0.42, metalness: 0.45 },
  armour: { roughness: 0.78, metalness: 0 },
  plate: { roughness: 0.7, metalness: 0.1 },
  rubber: { roughness: 0.96, metalness: 0 },
  glass: { roughness: 0.2, metalness: 0 },
};

const TEAM_ROLE_CLASS: Readonly<Record<string, SurfaceClass>> = {
  uniform: 'cloth',
  keffiyeh: 'cloth',
  webbing: 'gear',
  charge: 'gear',
  boot: 'leather',
  face: 'skin',
  skin_shadow: 'skin',
  wood: 'wood',
  metal: 'gunmetal',
  weapon: 'gunmetal',
};

const VEHICLE_SUFFIX_CLASS: Readonly<Record<string, SurfaceClass>> = {
  hull: 'armour',
  plate: 'plate',
  metal: 'gunmetal',
  rubber: 'rubber',
  glass: 'glass',
};

/** The class a node role draws as, or null (left exactly as today). */
export function surfaceClassOf(role: string): SurfaceClass | null {
  const team = TEAM_ROLE_CLASS[role];
  if (team) return team;
  const cut = role.lastIndexOf('_');
  const suffix = cut >= 0 ? role.slice(cut + 1) : role;
  return VEHICLE_SUFFIX_CLASS[suffix] ?? null;
}

/** The roughness map's measured mean on every shipped MR bake (0.796-0.797). */
export const MR_MAP_ROUGHNESS_MEAN = 0.797;

interface SurfaceEntry {
  readonly mat: THREE.MeshStandardMaterial;
  readonly off: { roughness: number; metalness: number; metalnessMap: THREE.Texture | null };
  readonly on: { roughness: number; metalness: number; metalnessMap: THREE.Texture | null };
  /** Templates holding this clone; it leaves the registry at 0. */
  users: number;
}

/** Every LIVE surface clone, so the debug toggle can put today's values back. */
const registry = new Set<SurfaceEntry>();
let surfacePassOn = true;

function writeSurface(e: SurfaceEntry, on: boolean): void {
  const v = on ? e.on : e.off;
  const mapChanged = e.mat.metalnessMap !== v.metalnessMap;
  e.mat.roughness = v.roughness;
  e.mat.metalness = v.metalness;
  e.mat.metalnessMap = v.metalnessMap;
  if (mapChanged) e.mat.needsUpdate = true;
}

/** A clone's registry entry, for the hand-out count. */
const entryOf = new WeakMap<THREE.Material, SurfaceEntry>();

/** Per original material, its clone per class. */
const clones = new WeakMap<THREE.Material, Map<SurfaceClass, THREE.MeshStandardMaterial>>();

/**
 * The material a role node draws with: `base` itself for an unclassified
 * role or a non-standard material, else the memoised clone for its class.
 * `fresh` receives every clone made, so the template can dispose it.
 */
export function surfaceMaterialFor(
  base: THREE.Material,
  role: string,
  fresh?: (m: THREE.Material) => void
): THREE.Material {
  const std = base as THREE.MeshStandardMaterial;
  const cls = surfaceClassOf(role);
  if (!cls || !std.isMeshStandardMaterial) return base;
  let perClass = clones.get(base);
  if (!perClass) {
    perClass = new Map();
    clones.set(base, perClass);
  }
  const hit = perClass.get(cls);
  if (hit) {
    const held = entryOf.get(hit);
    if (held) held.users++;
    return hit;
  }
  const mat = std.clone();
  const p = SURFACE_PARAMS[cls];
  const mapped = mat.roughnessMap !== null;
  const entry: SurfaceEntry = {
    mat,
    off: { roughness: std.roughness, metalness: std.metalness, metalnessMap: std.metalnessMap },
    on: {
      roughness: mapped ? Math.min(1 / MR_MAP_ROUGHNESS_MEAN, p.roughness / MR_MAP_ROUGHNESS_MEAN) : p.roughness,
      metalness: p.metalness,
      metalnessMap: p.metalness > 0 ? null : std.metalnessMap,
    },
    users: 1,
  };
  entryOf.set(mat, entry);
  registry.add(entry);
  writeSurface(entry, surfacePassOn);
  perClass.set(cls, mat);
  // Each holder disposes it once; at the last, it leaves the registry and the
  // memo, so released templates do not pin it (and the next ask for the
  // class makes a fresh one).
  mat.addEventListener('dispose', () => {
    entry.users--;
    if (entry.users > 0) return;
    registry.delete(entry);
    entryOf.delete(mat);
    if (perClass.get(cls) === mat) perClass.delete(cls);
  });
  fresh?.(mat);
  return mat;
}

/** Number of live surface clones (test seam). */
export function surfaceCloneCount(): number {
  return registry.size;
}

/** The `unit-surface` debug layer: today's values (false) or the pass (true).
 *  Returns how many materials it wrote. */
export function setUnitSurfacePass(on: boolean): number {
  surfacePassOn = on;
  for (const e of registry) writeSurface(e, on);
  return registry.size;
}
