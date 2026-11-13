/**
 * GH-943 WebGPU P3 (T1): the names every P3 legacy material is recognised by, and the reader of a hooked material's program key.
 *
 * THREE-FREE and import-free on purpose (the bundle census, G9): the legacy materials (ThreeRenderer chunk), the adoption table
 * (`node-material-adoption.ts`, same chunk) and the node census (`backend/unported.ts`, node chunk) all read it, and a module with no
 * imports can sit in either chunk without dragging the other one in.
 *
 * - `P3_MATERIAL_NAMES`: the `name` of each legacy `ShaderMaterial` P3 ports, and the `MaterialKit` slot whose twin replaces it.
 *   A `ShaderMaterial`'s program is keyed on its source (`WebGLPrograms.getProgramCacheKey`), never on its name, so a name moves
 *   no legacy pixel and costs no program.
 * - `UNIT_HOOK_SEGMENTS`: the `customProgramCacheKey` segments of the five unit `onBeforeCompile` hooks. A hooked material whose
 *   segments are ALL in this set is a `unit` material: one twin composes the terms its segments name.
 * - `hookSegments`: the `rl-` segments of a material's program key, in order (`stock|rl-running-gear-1|rl-unit-mark-3` gives
 *   `['rl-running-gear-1', 'rl-unit-mark-3']`). The census keys a hooked material by them (`censusKey`), so a reader sees which
 *   hook it is, not the GLB material name the 60-character rule used to fall back to.
 *
 * Presentation only. Nothing here is read by the sim.
 */

/** Legacy `ShaderMaterial` name -> the `MaterialKit` slot of its twin. Every P3 batch carries one of these as its `name:`. */
export const P3_MATERIAL_NAMES = {
  'rl-decal': 'decal',
  'rl-overlay': 'overlay',
  'rl-zone-band': 'zoneBand',
  'rl-supply-route': 'supplyRoute',
  'rl-trail': 'trail',
  'rl-xray-tube': 'xray',
  'rl-xray-collar': 'xray',
  'rl-xray-figure': 'xray',
  'rl-xray-beam': 'xray',
  'rl-fx-particle': 'particle',
  'rl-fx-particle-hot': 'particle',
  'rl-fx-tracer': 'tracer',
  'rl-fx-mesh': 'vfxMesh',
  'rl-flipbook-smoke': 'flipbook',
  'rl-flipbook-fire': 'flipbook',
  'rl-smoke-screen': 'smokeScreen',
  'rl-smoke-plume': 'rimFade',
  'rl-collapse-shroud': 'rimFade',
  'rl-beam': 'beam',
  'rl-swarm-rotors': 'rotor',
} as const;

export type P3MaterialName = keyof typeof P3_MATERIAL_NAMES;
export type P3ShaderSlot = (typeof P3_MATERIAL_NAMES)[P3MaterialName];

/** The five unit hooks' program-key segments (team mark, running gear, rain rim, wounded floor, soot). */
export const UNIT_HOOK_SEGMENTS: ReadonlySet<string> = new Set([
  'rl-unit-mark-3',
  'rl-running-gear-1',
  'rl-unit-rain-rim',
  'rl-wounded-floor',
  'rl-soot',
]);

/** GH-1225 slice 3 (L7): the program-key segments of a clone-drawn building's holed (`rl-holes`, GH-1197 P4) and cut (`rl-cut`)
 *  colour clones. A hooked material whose segments are ALL in this set is a `building` material: one twin draws both. */
export const BUILDING_HOOK_SEGMENTS: ReadonlySet<string> = new Set(['rl-holes', 'rl-cut']);

/** The other hooked P3 materials, each a single-segment program key: the occlusion outline, the garrison banner, the backdrop. */
export const OUTLINE_HOOK_KEY = 'rl-silhouette-outline';
export const BANNER_HOOK_KEY = 'rl-garrison-banner';
export const BACKDROP_HOOK_KEY = 'rl-backdrop-fade';

/** Anything with a program key: a `THREE.Material` (structural, so this module stays import-free). */
export interface ProgramKeyed {
  customProgramCacheKey(): string;
}

/** The `rl-` segments of a program key string, in order. */
export function keySegments(key: string): string[] {
  const out: string[] = [];
  for (const part of key.split('|')) {
    const s = part.trim();
    if (s.startsWith('rl-') && !/\s/.test(s)) out.push(s);
  }
  return out;
}

/** The `rl-` segments of `m.customProgramCacheKey()`, in order; empty for a stock material, a `ShaderMaterial`, or a throw. */
export function hookSegments(m: ProgramKeyed): string[] {
  let key: string;
  try {
    key = m.customProgramCacheKey();
  } catch {
    return [];
  }
  return typeof key === 'string' ? keySegments(key) : [];
}
