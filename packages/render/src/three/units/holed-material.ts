/**
 * GH-1197 P4: the holed clone of a building's material -- the cut, its edge and the dark room behind it (design 3a).
 *
 * A building takes these only on its FIRST hole: `BuildingHoleMaterials` is minted then, never before, so a map nobody
 * has shot draws its buildings on their band materials, untouched, and binds no new program, material or side.
 *
 * Each holed building owns ONE uniform set (up to `HOLE_CAP` holes: centre + radius, axis + seed) shared by its colour
 * clones and its depth material, so one write moves every mesh of the building and its shadow. The clone is the band's
 * own material (the template's, or the band's scar clone) cloned, `DoubleSide`, with an `onBeforeCompile` hook that:
 *
 * - **discards** every fragment inside a hole's cylinder: radial distance under `r (0.85 + 0.30 e(theta))`, axial
 *   distance under `HOLE_DEPTH_TILES`, so the near wall is cut and never the far one;
 * - paints the **edge** on what is left: six thin `shadow.1` cracks, a 0.03 t lip one ramp key darker than the wall, and
 *   a 0.15 t `gunmetal.3` char halo at 0.7 fading out (the halo the P3 coordinator ruling deferred to here);
 * - shades **back faces** -- the far walls, floor and roof seen through the hole -- as interior: the wall ramp's
 *   darkest key, 0.6 toward `gunmetal.2`.
 *
 * The same cut is hooked onto the building's `customDepthMaterial`, so the hole cuts the sun's shadow and light falls
 * through it. AO draws through an override material and still sees the wall whole (accepted by the design).
 *
 * `Material.clone()` drops `onBeforeCompile`, so the hook is put on every clone here, chained after any hook the base
 * already had; the program key is the base's plus `|rl-holes`. The node backend has no twin: there a holed building
 * draws its stock material, whole (the census names `rl-holes`).
 *
 * Positions are WORLD space: a standing building is frozen in place (`freezeStatic`), so its world frame is fixed.
 */
import * as THREE from 'three';
import { TILE_HASH_MIX, TILE_HASH_MX, TILE_HASH_MY, TILE_HASH_SHIFT_A, TILE_HASH_SHIFT_B } from '../../tile-hash';
import {
  HOLE_CAP,
  HOLE_CRACK_ALPHA,
  HOLE_CRACK_LEN,
  HOLE_CRACK_ROOT_RAD,
  HOLE_CRACKS,
  HOLE_DEPTH_TILES,
  HOLE_EDGE_AMP,
  HOLE_EDGE_BASE,
  HOLE_EDGE_CELLS,
  HOLE_EDGE_OCTAVES,
  HOLE_HALO_ALPHA,
  HOLE_HALO_TILES,
  HOLE_LIP_TILES,
  HOLE_SALT_CRACK_ANGLE,
  HOLE_SALT_CRACK_LEN,
  type Hole,
} from './building-holes';

export const HOLES_PROGRAM_KEY = 'rl-holes';
export const HOLES_DEPTH_PROGRAM_KEY = 'rl-holes-depth';

const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/** The hook's declarations and functions (both programs). */
export const HOLES_PARS_GLSL = /* glsl */ `
uniform vec4 uRlHoleC[${HOLE_CAP}];
uniform vec4 uRlHoleA[${HOLE_CAP}];
uniform int uRlHoleN;
uniform vec3 uRlLip;
uniform vec3 uRlHalo;
uniform vec3 uRlCrack;
uniform vec3 uRlInterior;
varying vec3 vRlHoleW;
vec4 rlHoleTint;
float rlHoleHash(int xi, int yi) {
  uint h = uint(xi) * ${TILE_HASH_MX}u + uint(yi) * ${TILE_HASH_MY}u;
  h = (h ^ (h >> ${TILE_HASH_SHIFT_A}u)) * ${TILE_HASH_MIX}u;
  h = h ^ (h >> ${TILE_HASH_SHIFT_B}u);
  return float(h >> 8u) / 16777216.0;
}
float rlHoleEdge(float theta, int seed) {
  float turn = fract(theta / 6.283185307179586);
  float sum = 0.0;
  float norm = 0.0;
  float amp = 1.0;
  for (int o = 0; o < ${HOLE_EDGE_OCTAVES}; o++) {
    int cells = ${HOLE_EDGE_CELLS} << o;
    float u = turn * float(cells);
    int i0 = int(floor(u)) % cells;
    int i1 = (i0 + 1) % cells;
    float fr = u - floor(u);
    float s = fr * fr * (3.0 - 2.0 * fr);
    float a = rlHoleHash(i0, seed * 128 + o);
    float b = rlHoleHash(i1, seed * 128 + o);
    sum += amp * mix(a, b, s);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}
void rlHoleApply() {
  rlHoleTint = vec4(0.0);
  for (int i = 0; i < ${HOLE_CAP}; i++) {
    if (i >= uRlHoleN) break;
    vec3 c = uRlHoleC[i].xyz;
    float r = uRlHoleC[i].w;
    vec3 a = uRlHoleA[i].xyz;
    int seed = int(uRlHoleA[i].w + 0.5);
    vec3 d = vRlHoleW - c;
    float ax = dot(d, a);
    if (abs(ax) >= ${f(HOLE_DEPTH_TILES)}) continue;
    vec3 hlp = abs(a.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 t = normalize(cross(hlp, a));
    vec3 b = cross(a, t);
    float x = dot(d, t);
    float y = dot(d, b);
    float rho = length(vec2(x, y));
    float th = atan(y, x);
    float rr = r * (${f(HOLE_EDGE_BASE)} + ${f(HOLE_EDGE_AMP)} * rlHoleEdge(th, seed));
    if (rho < rr) discard;
    float o = rho - rr;
    for (int k = 0; k < ${HOLE_CRACKS}; k++) {
      float ang = rlHoleHash(k, seed * 128 + ${HOLE_SALT_CRACK_ANGLE}) * 6.283185307179586;
      float len = ${f(HOLE_CRACK_LEN[0])} + ${f(HOLE_CRACK_LEN[1] - HOLE_CRACK_LEN[0])} * rlHoleHash(k, seed * 128 + ${HOLE_SALT_CRACK_LEN});
      float s = o / len;
      if (s > 1.0) continue;
      float dth = mod(abs(th - ang), 6.283185307179586);
      if (dth > 3.141592653589793) dth = 6.283185307179586 - dth;
      if (dth < ${f(HOLE_CRACK_ROOT_RAD)} * (1.0 - s) && ${f(HOLE_CRACK_ALPHA)} > rlHoleTint.a) rlHoleTint = vec4(uRlCrack, ${f(HOLE_CRACK_ALPHA)});
    }
    if (o < ${f(HOLE_LIP_TILES)}) rlHoleTint = vec4(uRlLip, 1.0);
    float ho = o - ${f(HOLE_LIP_TILES)};
    if (ho >= 0.0 && ho < ${f(HOLE_HALO_TILES)}) {
      float al = ${f(HOLE_HALO_ALPHA)} * (1.0 - ho / ${f(HOLE_HALO_TILES)});
      if (al > rlHoleTint.a) rlHoleTint = vec4(uRlHalo, al);
    }
  }
}
`;

/** The colour program's splice after the base colour is known: the interior on a back face, the edge on a front one. */
export const HOLES_COLOUR_GLSL = /* glsl */ `
  if (!gl_FrontFacing) diffuseColor.rgb = uRlInterior;
  else diffuseColor.rgb = mix(diffuseColor.rgb, rlHoleTint.rgb, rlHoleTint.a);
`;

/** The hook as a pure function of a program's text (vertex, fragment): `colour` adds the edge and interior splice. */
export function holesShaderHook(vertex: string, fragment: string, colour: boolean): { vertex: string; fragment: string } {
  const need = (src: string, token: string): void => {
    if (!src.includes(token)) throw new Error(`holes hook: program no longer holds "${token}"`);
  };
  need(vertex, '#include <project_vertex>');
  need(fragment, '#include <common>');
  const v = vertex
    .replace('#include <common>', '#include <common>\nvarying vec3 vRlHoleW;')
    .replace('#include <project_vertex>', '#include <project_vertex>\n  vRlHoleW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  let fr = fragment.replace('#include <common>', `#include <common>\n${HOLES_PARS_GLSL}`);
  fr = fr.replace(/void main\(\)\s*\{/, (m) => `${m}\n  rlHoleApply();`);
  if (colour) {
    need(fragment, '#include <map_fragment>');
    fr = fr.replace('#include <map_fragment>', `#include <map_fragment>\n${HOLES_COLOUR_GLSL}`);
  }
  return { vertex: v, fragment: fr };
}

/** The linear colours of a holed building's edge and interior. */
export interface HoleColors {
  readonly lip: THREE.Color;
  readonly halo: THREE.Color;
  readonly crack: THREE.Color;
  readonly interior: THREE.Color;
}

interface HoleUniforms {
  uRlHoleC: { value: THREE.Vector4[] };
  uRlHoleA: { value: THREE.Vector4[] };
  uRlHoleN: { value: number };
  uRlLip: { value: THREE.Color };
  uRlHalo: { value: THREE.Color };
  uRlCrack: { value: THREE.Color };
  uRlInterior: { value: THREE.Color };
}

const STOCK_HOOK = THREE.Material.prototype.onBeforeCompile;

function hook(material: THREE.Material, base: THREE.Material | null, uniforms: HoleUniforms, colour: boolean, key: string): void {
  const prior = base !== null && base.onBeforeCompile !== STOCK_HOOK ? base.onBeforeCompile : null;
  const baseKey = base !== null ? base.customProgramCacheKey() : '';
  material.onBeforeCompile = (shader, renderer) => {
    if (prior) prior.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    const out = holesShaderHook(shader.vertexShader, shader.fragmentShader, colour);
    shader.vertexShader = out.vertex;
    shader.fragmentShader = out.fragment;
  };
  material.customProgramCacheKey = () => (baseKey ? `${baseKey}|${key}` : key);
}

/**
 * The holes of ONE building: its uniform set, its holed colour clones (one per band material it draws), and its depth
 * material. Minted on the building's first hole.
 */
export class BuildingHoleMaterials {
  readonly uniforms: HoleUniforms;
  readonly depth: THREE.MeshDepthMaterial;
  private readonly byBase = new Map<THREE.Material, THREE.Material>();

  constructor(colors: HoleColors) {
    this.uniforms = {
      uRlHoleC: { value: Array.from({ length: HOLE_CAP }, () => new THREE.Vector4()) },
      uRlHoleA: { value: Array.from({ length: HOLE_CAP }, () => new THREE.Vector4()) },
      uRlHoleN: { value: 0 },
      uRlLip: { value: colors.lip.clone() },
      uRlHalo: { value: colors.halo.clone() },
      uRlCrack: { value: colors.crack.clone() },
      uRlInterior: { value: colors.interior.clone() },
    };
    this.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    this.depth.name = HOLES_DEPTH_PROGRAM_KEY;
    hook(this.depth, null, this.uniforms, false, HOLES_DEPTH_PROGRAM_KEY);
  }

  /** The holed clone of `base` (memoised); a material that is not a `MeshStandardMaterial` is returned as it is. */
  materialFor(base: THREE.Material): THREE.Material {
    if (!(base as THREE.MeshStandardMaterial).isMeshStandardMaterial) return base;
    let holed = this.byBase.get(base);
    if (holed === undefined) {
      holed = base.clone();
      holed.side = THREE.DoubleSide;
      holed.userData = { ...base.userData, rlHoles: true };
      hook(holed, base, this.uniforms, true, HOLES_PROGRAM_KEY);
      holed.needsUpdate = true;
      this.byBase.set(base, holed);
    }
    return holed;
  }

  /** Writes the holes into the shared uniforms. */
  setHoles(holes: readonly Hole[]): void {
    const n = Math.min(holes.length, HOLE_CAP);
    for (let i = 0; i < n; i++) {
      const h = holes[i];
      this.uniforms.uRlHoleC.value[i].set(h.c[0], h.c[1], h.c[2], h.radius);
      this.uniforms.uRlHoleA.value[i].set(h.axis[0], h.axis[1], h.axis[2], h.seed);
    }
    this.uniforms.uRlHoleN.value = n;
  }

  /** How many holed colour clones exist. */
  get size(): number {
    return this.byBase.size;
  }

  /** Is `m` one of this building's holed clones? */
  owns(m: THREE.Material): boolean {
    for (const v of this.byBase.values()) if (v === m) return true;
    return false;
  }

  dispose(): void {
    for (const m of this.byBase.values()) m.dispose();
    this.byBase.clear();
    this.depth.dispose();
  }
}
