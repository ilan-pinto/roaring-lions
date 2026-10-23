/**
 * Defilade Task 6 (GH-705): unit SURFACE response and a Fresnel RIM.
 * PROTOTYPE -- nothing here ships until the lead decides (proposal in
 * `_coord/defilade-t6/`).
 *
 * ## 1. The surface pass: roughness and metalness per role
 *
 * Today every unit surface answers the sun the same way: a bake with no
 * metallic-roughness map is `WORLD_ROUGHNESS` 0.85 / metalness 0
 * (`texturedMaterial`), and the bakes that ship one carry a flat map
 * (measured: roughness mean 0.796-0.797, metalness 0.003-0.004 on all ten
 * read, every texel in the lowest metal fifth). So a barrel, a rubber track
 * and a cloth uniform are one material. This pass gives each NODE ROLE its
 * own `{ roughness, metalness }` -- the roles the GLBs already carry
 * (`rl_role` / node name: `uniform`, `weapon`, ... for teams; `hull_rubber`,
 * `turret_metal`, ... for vehicles). The palette is untouched: colour still
 * comes from the bake (or the role ramp), only the specular response moves.
 *
 * Mechanism: the GLB's one shared material is CLONED once per surface class
 * (memoised per original), so +0 programs (same defines) and +0 draw calls
 * (each role node is already its own draw). A bake with an MR map keeps it for
 * roughness (the factor rescales the map's own mean onto the target) and, on
 * a metal class only, drops it for metalness, since a factor cannot lift a
 * map that reads 0.
 *
 * ## 2. The rim: a view-angle term so silhouettes read through smoke
 *
 * `outgoingLight += uRlRimColor * (1 - smoothstep(0, width, N.V))`, on the
 * GEOMETRIC normal (`nonPerturbedNormal`: a normal map would sparkle). A plain
 * `pow(1 - N.V, p)` Fresnel is the wrong shape for THIS camera: it is
 * orthographic at a 30 degree pitch, so every flat top has N.V = 0.5 and a
 * power curve brightens all roofs and hull decks, not the edge. The
 * smoothstep cut puts the whole term on faces turning away from the view.
 *
 * The colour is a palette key (`limestone.0`, the sun's own key) times
 * `hazeRadiance` of the scene's lights -- the level lit ground sits at -- so
 * dusk's rim is dimmer by the ratio its light is, and times a gain. It is
 * neutral by design, not team-coloured (see the proposal, question M4).
 *
 * The uniforms are SHARED objects: every unit material reads the same three,
 * so the toggle is one uniform write and nothing recompiles.
 */
import * as THREE from 'three';
import { hexToLinear } from '../terrain/shared';
import { paletteHex } from '../palette-hex';

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
 * The numbers under review (proposal M1). The brief: "roughness 0.7-0.9 on
 * terrain, concrete and matte armour; metal/roughness contrast on barrels and
 * tracks".
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

/** The terrain arm: today's ground is roughness 1; the brief asks 0.7-0.9. */
export const TERRAIN_ROUGHNESS_PASS = 0.85;

/** The roughness map's measured mean on every shipped MR bake (0.796-0.797). */
export const MR_MAP_ROUGHNESS_MEAN = 0.797;

interface SurfaceEntry {
  readonly mat: THREE.MeshStandardMaterial;
  readonly off: { roughness: number; metalness: number; metalnessMap: THREE.Texture | null };
  readonly on: { roughness: number; metalness: number; metalnessMap: THREE.Texture | null };
}

/** Every surface clone, so the debug toggle can put today's values back. */
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
  if (hit) return hit;
  const mat = std.clone();
  // `clone` drops instance hooks and resets `defines`; the rim flag rides in
  // userData (deep-copied), so put the hook back.
  reapplyUnitRim(mat);
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
  };
  registry.add(entry);
  writeSurface(entry, surfacePassOn);
  perClass.set(cls, mat);
  fresh?.(mat);
  return mat;
}

/** The `unit-surface` debug layer: today's values (false) or the pass (true).
 *  Returns how many materials it wrote. */
export function setUnitSurfacePass(on: boolean): number {
  surfacePassOn = on;
  for (const e of registry) writeSurface(e, on);
  return registry.size;
}

// ---------------------------------------------------------------- the rim

/** The palette key the rim is tinted with: the sun's own. */
export const RIM_KEY = 'limestone.0';
/** The rim's level against lit ground (`hazeRadiance` x this). Proposal M3. */
export const RIM_GAIN = 0.35;
/** N.V below which the rim rises; 0.5 is a flat top at this camera's pitch. */
export const RIM_WIDTH = 0.32;

export const RIM_UNIFORMS = {
  uRlRimColor: { value: new THREE.Color(0, 0, 0) },
  uRlRimWidth: { value: RIM_WIDTH },
  /** The DARK mode's edge darkening, 0..1 (0 in the light mode). */
  uRlRimDark: { value: 0 },
};

/** `light`: the edge brightens toward the sun key. `dark`: the edge darkens
 *  by `RIM_DARK_GAIN` -- the opposite tool, for bright ground and smoke. */
export type RimMode = 'light' | 'dark';
export const RIM_DARK_GAIN = 0.55;
let rimMode: RimMode = 'light';
let rimDarkGain = RIM_DARK_GAIN;

let rimRadiance = 0;
let rimGain = RIM_GAIN;
let rimOn = true;

function writeRimColor(): void {
  const [r, g, b] = hexToLinear(paletteHex(RIM_KEY));
  const k = rimOn && rimMode === 'light' ? rimRadiance * rimGain : 0;
  RIM_UNIFORMS.uRlRimColor.value.setRGB(r * k, g * k, b * k);
  RIM_UNIFORMS.uRlRimDark.value = rimOn && rimMode === 'dark' ? rimDarkGain : 0;
}

/** The scene's lit-ground level (`hazeRadiance`), written when lights resolve. */
export function setUnitRimRadiance(radiance: number): void {
  rimRadiance = radiance;
  writeRimColor();
}
/** Harness seam: the gain ladder. */
export function setUnitRimGain(gain: number): void {
  rimGain = gain;
  writeRimColor();
}
/** Harness seam: the mode, and the dark mode's gain. */
export function setUnitRimMode(mode: RimMode, darkGain?: number): void {
  rimMode = mode;
  if (darkGain !== undefined) rimDarkGain = darkGain;
  writeRimColor();
}
/** Harness seam: N.V width. */
export function setUnitRimWidth(width: number): void {
  RIM_UNIFORMS.uRlRimWidth.value = width;
}
/** The `unit-rim` debug layer. Returns 1 when it changed, 0 when not. */
export function setUnitRimVisible(on: boolean): number {
  const changed = rimOn === on ? 0 : 1;
  rimOn = on;
  writeRimColor();
  return changed;
}

export const RIM_FRAGMENT_HEAD = /* glsl */ `#include <common>
uniform vec3 uRlRimColor;
uniform float uRlRimWidth;
uniform float uRlRimDark;`;

export const RIM_FRAGMENT_APPLY = /* glsl */ `{
  float rlNdV = abs( dot( normalize( nonPerturbedNormal ), geometryViewDir ) );
  float rlRim = 1.0 - smoothstep( 0.0, uRlRimWidth, rlNdV );
  outgoingLight = outgoingLight * ( 1.0 - uRlRimDark * rlRim ) + uRlRimColor * rlRim;
}
#include <opaque_fragment>`;

export const RIM_PROGRAM_KEY = 'rl-rim-1';
const RIM_FLAG = 'rlRim';
const hooked = new WeakSet<THREE.Material>();

function patch(src: string, find: string, by: string): string {
  const at = src.indexOf(find);
  if (at < 0) throw new Error(`unit-surface: the shader has no "${find}" to patch`);
  return src.slice(0, at) + by + src.slice(at + find.length);
}

/**
 * Give a unit material the rim, chaining whatever hook it already has (the
 * running gear's tread) and folding the rim into its program key.
 * Idempotent per material object.
 */
export function applyUnitRim(material: THREE.Material): THREE.Material {
  if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return material;
  if (hooked.has(material)) return material;
  hooked.add(material);
  material.userData = { ...material.userData, [RIM_FLAG]: true };
  const prevCompile = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prevCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, RIM_UNIFORMS);
    shader.fragmentShader = patch(shader.fragmentShader, '#include <common>', RIM_FRAGMENT_HEAD);
    shader.fragmentShader = patch(shader.fragmentShader, '#include <opaque_fragment>', RIM_FRAGMENT_APPLY);
  };
  material.customProgramCacheKey = () => `${prevKey()}|${RIM_PROGRAM_KEY}`;
  material.needsUpdate = true;
  return material;
}

/** For a CLONE of a rim material (`clone` keeps userData, not the hook). */
export function reapplyUnitRim(material: THREE.Material): THREE.Material {
  const flagged = (material.userData as Record<string, unknown> | undefined)?.[RIM_FLAG] === true;
  if (!flagged) return material;
  // The flag came over by copy; the hook did not.
  return applyUnitRim(material);
}
