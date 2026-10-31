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
 * (and the pass back on). The registry holds clones WEAKLY, and a clone's
 * first `dispose` drops it from the registry and the memo -- see `registry`
 * for the leak a strong one caused.
 *
 * The RAIN LIFT (GH-871 P4 S-L2 ruling 3): under rain a KDF figure's clones
 * also carry a small self-lit term, `emissive = overcast.1 x kdfFigureLift`
 * (see `WET_SURFACE_PARAMS`). It rides the same clone, memo, debug toggle and
 * disposer as the roughness, and exists only when the table asks for it, so a
 * shipped renderer's clones are exactly today's.
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
import { paletteHex } from '../palette-hex';
import { RAIN_SKY_KEY } from '../weather';

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

/**
 * A table of surface params, one per class: the shipped one or the wet one.
 * `kdfFigureLift` is the rain lift's gain (see `WET_SURFACE_PARAMS`); ABSENT on
 * the shipped table, and absent means no lift, no emissive write, and no change
 * to a clone's cache key.
 */
export type SurfaceTable = Readonly<Record<SurfaceClass, SurfaceParams>> & {
  readonly kdfFigureLift?: number;
};

/**
 * The rain lift's gain (GH-871 P4 S-L2 ruling 3, calibrated in
 * `tools/src/wet-unit-lift.test.ts`): a KDF figure's surfaces gain a self-lit
 * `emissive = overcast.1 x 0.4` under rain, the cold sheen of a wet surface
 * answering the overcast sky.
 *
 * Why a CONSTANT colour and not the albedo (the cheaper-looking `emissive =
 * colour x gain`): the S-L2 readability frames read the KDF squad at CIEDE2000
 * 8.2 / 9.0 on the wet road and 4.0 / 6.4 in marsh water (floor 15.6) because
 * the figures are near black (mean pixel (15, 10, 5), the Meshy camouflage bake
 * averages 0.066 linear luminance), and the lead's second method reads the
 * DARKEST 15% of the figure. An emissive proportional to the texel lifts a
 * near-black texel by almost nothing; a constant lifts every texel by the same
 * radiance, so both methods move. A cold colour also keeps clear of the green
 * grass, where the figure is already 30.7 and a warm albedo-proportional lift
 * of the same brightness fell to 19 (the figure reaching the ground's own
 * lightness). 0.4 is the smallest grid step at which the model clears road and
 * marsh water at 18.6 (the floor plus a margin of 3) and grass at 20; at 0.30
 * the road misses (18.3).
 */
export const RAIN_KDF_FIGURE_LIFT = 0.4;

/**
 * The wet table (GH-871 P4, T5): what a unit's surface answers under rain.
 * Rain films every surface, so cloth, armour and plate lose 0.12-0.22 of their
 * roughness and a barrel's 0.10. EVERY other class and EVERY metalness is the
 * shipped number (the 0.45 cap holds: there is no environment map), and the
 * albedo is untouched -- only the specular response moves. Built from
 * `SURFACE_PARAMS` so a class this task did not name cannot drift from it.
 */
export const WET_SURFACE_PARAMS: SurfaceTable = {
  ...SURFACE_PARAMS,
  cloth: { roughness: 0.8, metalness: 0 },
  armour: { roughness: 0.52, metalness: 0 },
  plate: { roughness: 0.48, metalness: 0.1 },
  gunmetal: { roughness: 0.32, metalness: 0.45 },
  kdfFigureLift: RAIN_KDF_FIGURE_LIFT,
};

/**
 * The emissive gain a figure of `faction` takes from `table`: the table's
 * `kdfFigureLift` for `'kdf'`, else 0. Vehicles never ask (their loader passes
 * no lift), and the shipped table has none.
 */
export function figureLiftFor(table: SurfaceTable, faction: string): number {
  return faction === 'kdf' ? (table.kdfFigureLift ?? 0) : 0;
}

/** The table a renderer built with `weather` uses: `'rain'` is the wet one,
 *  anything else (absent, `'clear'`) is the shipped one. */
export function surfaceTableFor(weather: 'clear' | 'rain' | undefined): SurfaceTable {
  return weather === 'rain' ? WET_SURFACE_PARAMS : SURFACE_PARAMS;
}

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
  /** The rain lift's emissive, off and on. ABSENT on every clone made with no
   *  lift, so `writeSurface` never touches `emissive` for a shipped renderer. */
  readonly emissive?: { readonly off: THREE.Color; readonly on: THREE.Color };
}

/**
 * The live surface clones, for the debug toggle -- held WEAKLY, and dropped on
 * the clone's own `dispose`. Never a strong module-level reference: a clone
 * carries the bake's `map` (a decoded ImageBitmap) and, once drawn, three's
 * own `dispose` listener closing over the WebGLRenderer, so a strong Set here
 * kept every mission's renderer, textures and DOM alive after leaving it
 * (GH-705: the CI memory walk read 3/5/7 released contexts still reachable
 * and ImageBitmaps at 48/96/152 MiB on the menu). The first cut counted
 * hand-outs and dropped a clone at zero, but it counted one per role NODE and
 * a template disposes each material ONCE, so no clone was ever dropped.
 */
const registry = new Set<WeakRef<SurfaceEntry>>();
/** A clone's entry: the WeakMap keeps the entry alive exactly as long as the
 *  material, and the registry's WeakRef to it is cleared with both. */
const entryOf = new WeakMap<THREE.Material, SurfaceEntry>();
const refOf = new WeakMap<SurfaceEntry, WeakRef<SurfaceEntry>>();
let surfacePassOn = true;

function writeSurface(e: SurfaceEntry, on: boolean): void {
  const v = on ? e.on : e.off;
  const mapChanged = e.mat.metalnessMap !== v.metalnessMap;
  e.mat.roughness = v.roughness;
  e.mat.metalness = v.metalness;
  e.mat.metalnessMap = v.metalnessMap;
  if (mapChanged) e.mat.needsUpdate = true;
  if (e.emissive) e.mat.emissive.copy(on ? e.emissive.on : e.emissive.off);
}

function track(entry: SurfaceEntry): void {
  let ref = refOf.get(entry);
  if (!ref) {
    ref = new WeakRef(entry);
    refOf.set(entry, ref);
  }
  registry.add(ref);
}

function untrack(entry: SurfaceEntry): void {
  const ref = refOf.get(entry);
  if (ref) registry.delete(ref);
}

/**
 * Per original material, its clone per class AND table. Keyed weakly on the
 * original. The key carries the table's numbers (`cacheKey`), so a base handed
 * to a wet renderer and to a dry one never shares a clone: the second would
 * otherwise come back wearing the first's roughness.
 */
const clones = new WeakMap<THREE.Material, Map<string, THREE.MeshStandardMaterial>>();

/** `class/roughness/metalness`: the clone memo's key (the table is part of it).
 *  A lifted clone appends `/lift<gain>`; an unlifted one keeps today's key. */
function cacheKey(cls: SurfaceClass, p: SurfaceParams, lift: number): string {
  const base = `${cls}/${p.roughness}/${p.metalness}`;
  return lift > 0 ? `${base}/lift${lift}` : base;
}

/**
 * The material a role node draws with: `base` itself for an unclassified
 * role or a non-standard material, else the memoised clone for its class.
 * `fresh` receives every clone made, so the template can dispose it. `table`
 * is the one the renderer was built with (`surfaceTableFor(opts.weather)`);
 * absent, the shipped `SURFACE_PARAMS`. `lift` is the rain lift's gain
 * (`figureLiftFor`): above 0 the clone also carries `emissive = overcast.1 x
 * lift`, and the memo keeps a lifted and an unlifted clone apart; 0 (the
 * default) is exactly today's clone.
 */
export function surfaceMaterialFor(
  base: THREE.Material,
  role: string,
  fresh?: (m: THREE.Material) => void,
  table: SurfaceTable = SURFACE_PARAMS,
  lift = 0
): THREE.Material {
  const std = base as THREE.MeshStandardMaterial;
  const cls = surfaceClassOf(role);
  if (!cls || !std.isMeshStandardMaterial) return base;
  let perClass = clones.get(base);
  if (!perClass) {
    perClass = new Map();
    clones.set(base, perClass);
  }
  const p = table[cls];
  const key = cacheKey(cls, p, lift);
  const hit = perClass.get(key);
  if (hit) {
    // A second template built from the same loaded original (whose first
    // template may already have released the clone) re-registers it.
    const held = entryOf.get(hit);
    if (held) {
      track(held);
      writeSurface(held, surfacePassOn);
    }
    return hit;
  }
  const mat = std.clone();
  const mapped = mat.roughnessMap !== null;
  const emissiveOff = std.emissive.clone();
  const entry: SurfaceEntry = {
    mat,
    off: { roughness: std.roughness, metalness: std.metalness, metalnessMap: std.metalnessMap },
    on: {
      roughness: mapped ? Math.min(1 / MR_MAP_ROUGHNESS_MEAN, p.roughness / MR_MAP_ROUGHNESS_MEAN) : p.roughness,
      metalness: p.metalness,
      metalnessMap: p.metalness > 0 ? null : std.metalnessMap,
    },
    ...(lift > 0
      ? {
          emissive: {
            off: emissiveOff,
            on: emissiveOff.clone().add(new THREE.Color(paletteHex(RAIN_SKY_KEY)).multiplyScalar(lift)),
          },
        }
      : {}),
  };
  entryOf.set(mat, entry);
  track(entry);
  writeSurface(entry, surfacePassOn);
  perClass.set(key, mat);
  // The disposer is registered where the clone is created: its first
  // `dispose` (the template's teardown) drops it from the registry and the
  // memo, however many role nodes shared it.
  const memo = perClass;
  mat.addEventListener('dispose', () => {
    untrack(entry);
    if (memo.get(key) === mat) memo.delete(key);
  });
  fresh?.(mat);
  return mat;
}

/** Number of live surface clones (test seam). */
export function surfaceCloneCount(): number {
  let n = 0;
  for (const ref of registry) if (ref.deref()) n++;
  return n;
}

/** The `unit-surface` debug layer: today's values (false) or the pass (true).
 *  Returns how many materials it wrote. */
export function setUnitSurfacePass(on: boolean): number {
  surfacePassOn = on;
  let n = 0;
  for (const ref of [...registry]) {
    const e = ref.deref();
    if (!e) {
      registry.delete(ref);
      continue;
    }
    writeSurface(e, on);
    n++;
  }
  return n;
}
