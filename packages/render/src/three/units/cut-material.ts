/**
 * GH-1225 slice 1: the cut clone of a building's material, the WebGL2 path (design `2026-11-11-roof-cutaway-design.md`).
 *
 * A building takes these only while a cutaway volume reaches it: `BuildingCutMaterials` is minted then and released when the
 * last volume leaves, so a frame with nothing selected draws every building on its band material, untouched, and binds no new
 * program, material or uniform.
 *
 * Every cut clone shares ONE volume block by reference (`CutUniforms`: `uRlCutV`, two `vec4`s a volume, and `uRlCutN`), so one
 * write a frame moves every cut. Each building owns only its two colours. The clone is the band's own material (the template's,
 * or the band's scar clone) cloned, `DoubleSide`, with an `onBeforeCompile` hook that:
 *
 * - **discards** every fragment a volume cuts (`cutawayOps`, `building-cutaway.ts`, spelled in GLSL below);
 * - paints the **section cap** on a front face within `CUT_SECTION_TILES` under the cut: the wall ramp's lightest key;
 * - shades **back faces** -- the far walls seen through the cut -- as interior: the wall ramp's darkest key, 0.6 toward
 *   `gunmetal.2` (P4's interior, GH-1197).
 *
 * Slice 2 cuts the shadow and the AO G-buffer with the same mask (`CutMaskMaterials`): one shared depth material, set as a
 * cut mesh's `customDepthMaterial` (the sun's shadow map reads it, `WebGLShadowMap.getDepthMaterial`), and one shared normal
 * material that the AO pre-pass swaps onto a cut mesh (`post-chain.ts`, `userData.rlCutAo`), because GTAO draws its G-buffer
 * through `scene.overrideMaterial` and so never reads a depth material. Both carry `cutMaskHook`, which discards and paints
 * nothing, over the SAME volume block, so the minimap's forced count of 0 (`photographGround`) suspends them too. The node
 * backend draws the cut through its TSL twin (slice 3, `building-cut.node.ts`, reading `cutHookOf`). A building both holed and cut takes
 * its own pair instead, ONE mask of holes and cut (`maskWith`, `building-mask.ts`), so depth, AO and colour discard alike.
 *
 * `Material.clone()` drops `onBeforeCompile`, so the hook is put on every clone, chained after any hook the base already had;
 * the program key is the base's plus `|rl-cut`. Positions are WORLD space: a standing building never moves (P4's ruling).
 */
import * as THREE from 'three';
import paletteJson from '../../../../../data/palette.json';
import { paletteHex } from '../palette-hex';
import { hexToLinear } from '../terrain/shared';
import { CUT_FLOATS_PER_VOLUME, CUT_SECTION_TILES, CUT_VOLUME_CAP } from './building-cutaway';
import { createMaskMaterials, maskHook, type MaskMaterials, type MaskTerm } from './building-mask';
import { HOLES_MASK_TERM, type BuildingHoleMaterials } from './holed-material';

export const CUT_PROGRAM_KEY = 'rl-cut';
/** How far the interior colour is taken from the wall ramp's darkest key toward `gunmetal.2` (P4's `HOLE_INTERIOR_TOWARD_CHAR`). */
export const CUT_INTERIOR_TOWARD_CHAR = 0.6;
export const CUT_INTERIOR_CHAR_KEY = 'gunmetal.2';

const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/** The hook's declarations and functions. Line for line `cutawayOps`: the reach, the sloped cut height, the cut, the cap. */
export const CUT_PARS_GLSL = /* glsl */ `
uniform vec4 uRlCutV[${CUT_VOLUME_CAP * 2}];
uniform int uRlCutN;
uniform vec3 uRlCutCap;
uniform vec3 uRlCutInterior;
varying vec3 vRlCutW;
float rlCutSection;
void rlCutApply() {
  rlCutSection = 0.0;
  for (int i = 0; i < ${CUT_VOLUME_CAP}; i++) {
    if (i >= uRlCutN) break;
    vec4 a = uRlCutV[2 * i];
    vec4 b = uRlCutV[2 * i + 1];
    float rho = length(vRlCutW.xz - a.xy);
    if (rho >= a.z + a.w) continue;
    float h = b.x + (b.y - b.x) * clamp((rho - a.z) / a.w, 0.0, 1.0);
    if (vRlCutW.y > h) discard;
    if (vRlCutW.y > h - ${f(CUT_SECTION_TILES)}) rlCutSection = 1.0;
  }
}
`;

/** The colour splice after the base colour is known: the interior on a back face, the section cap on a front one. */
export const CUT_COLOUR_GLSL = /* glsl */ `
  if (!gl_FrontFacing) diffuseColor.rgb = uRlCutInterior;
  else if (rlCutSection > 0.5) diffuseColor.rgb = uRlCutCap;
`;

/** The hook as a pure function of a program's text (vertex, fragment). */
export function cutShaderHook(vertex: string, fragment: string): { vertex: string; fragment: string } {
  const need = (src: string, token: string): void => {
    if (!src.includes(token)) throw new Error(`cut hook: program no longer holds "${token}"`);
  };
  need(vertex, '#include <common>');
  need(vertex, '#include <project_vertex>');
  need(fragment, '#include <common>');
  need(fragment, '#include <map_fragment>');
  if (!/void main\(\)\s*\{/.test(fragment)) throw new Error('cut hook: program no longer holds "void main() {"');
  const v = vertex
    .replace('#include <common>', '#include <common>\nvarying vec3 vRlCutW;')
    .replace('#include <project_vertex>', '#include <project_vertex>\n  vRlCutW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  const fr = fragment
    .replace('#include <common>', `#include <common>\n${CUT_PARS_GLSL}`)
    .replace(/void main\(\)\s*\{/, (m) => `${m}\n  rlCutApply();`)
    .replace('#include <map_fragment>', `#include <map_fragment>\n${CUT_COLOUR_GLSL}`);
  return { vertex: v, fragment: fr };
}

/** The cut as a mask term (`building-mask.ts`): `CUT_PARS_GLSL`, the same text the colour hook splices, so the text pin
 *  covers both. */
export const CUT_MASK_TERM: MaskTerm = { varying: 'vRlCutW', pars: CUT_PARS_GLSL, call: 'rlCutApply();' };

/** The hook that only discards, for the shadow's depth material and the AO's normal material: the cut at the top of `main`,
 *  no colour splice (`maskHook` over the one cut term). */
export function cutMaskHook(vertex: string, fragment: string): { vertex: string; fragment: string } {
  return maskHook(vertex, fragment, [CUT_MASK_TERM]);
}

export const CUT_MASK_PROGRAM_KEY = 'rl-cut-mask';
/** The mask of a building both holed and cut: holes then cut, as its colour clone. */
export const HOLES_CUT_MASK_PROGRAM_KEY = 'rl-holes|rl-cut-mask';

/**
 * The two mask materials every cut mesh WITHOUT holes shares, over the shared volume block (the cut reads world position
 * alone, so one of each serves every such building). Minted with the block, on the first cut; nothing exists before it. A
 * holed building's cut takes its own pair (`BuildingCutMaterials.maskWith`), because its holes are its own uniforms.
 */
export type CutMaskMaterials = MaskMaterials;

export function createCutMaskMaterials(shared: CutUniforms): CutMaskMaterials {
  return createMaskMaterials({ uRlCutV: shared.uRlCutV, uRlCutN: shared.uRlCutN }, [CUT_MASK_TERM], CUT_MASK_PROGRAM_KEY);
}

/** The volume block every cut clone binds BY REFERENCE: `CUT_VOLUME_CAP` volumes of `CUT_FLOATS_PER_VOLUME` floats, and the
 *  count. A `Float32Array`, so the TSL twin can take it as a `uniformArray` without a copy. */
export interface CutUniforms {
  readonly uRlCutV: { value: Float32Array };
  readonly uRlCutN: { value: number };
}

export function createCutUniforms(): CutUniforms {
  return { uRlCutV: { value: new Float32Array(CUT_VOLUME_CAP * CUT_FLOATS_PER_VOLUME) }, uRlCutN: { value: 0 } };
}

/** A cut building's LINEAR section-cap and interior colours. */
export interface CutColors {
  readonly cap: THREE.Color;
  readonly interior: THREE.Color;
}

const ramps = paletteJson.ramps as Record<string, { colors: string[] }>;

/** The palette keys of a building's cut colours from its type's colour key: the cap is its ramp's lightest key (index 0;
 *  ramps descend in brightness), the interior its darkest. A key with no ramp keeps itself for both. */
export function cutColorKeys(colorKey: string): { cap: string; interior: string } {
  const ramp = colorKey.slice(0, colorKey.indexOf('.'));
  const colors = ramps[ramp]?.colors;
  if (colors === undefined) return { cap: colorKey, interior: colorKey };
  return { cap: `${ramp}.0`, interior: `${ramp}.${colors.length - 1}` };
}

const linear = (key: string): THREE.Color => {
  const [r, g, b] = hexToLinear(paletteHex(key));
  return new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
};

/** A building's cut colours, resolved through `hexToLinear` (shader-uniform colours are LINEAR). */
export function cutColorsFor(colorKey: string): CutColors {
  const keys = cutColorKeys(colorKey);
  return { cap: linear(keys.cap), interior: linear(keys.interior).lerp(linear(CUT_INTERIOR_CHAR_KEY), CUT_INTERIOR_TOWARD_CHAR) };
}

const STOCK_HOOK = THREE.Material.prototype.onBeforeCompile;

/** GH-1225 slice 3: the uniform record of one building's cut clones (the shared volume block by reference, and its two colours). */
export type CutHookUniforms = CutUniforms & { readonly uRlCutCap: { value: THREE.Color }; readonly uRlCutInterior: { value: THREE.Color } };

/** GH-1225 slice 3: what the TSL twin (`building-cut.node.ts`) reads off a cut clone: the record its hook binds, and the material
 *  it was cloned from (a holed clone, for a building both holed and cut, whose holes the twin reads through `holesHookOf`). */
export interface CutHook {
  readonly uniforms: CutHookUniforms;
  readonly base: THREE.Material;
}

const cutHooks = new WeakMap<THREE.Material, CutHook>();

/** The cut hook a cut clone carries, or undefined for any other material. Handed to the twin as a value (`MATERIAL_MATHS`). */
export function cutHookOf(m: THREE.Material): CutHook | undefined {
  return cutHooks.get(m);
}

/**
 * The cut of ONE building: its cut colour clones (one per band material it draws) over the shared volume block. Minted when a
 * volume first reaches the building, disposed when the last leaves.
 */
export class BuildingCutMaterials {
  private readonly uniforms: CutHookUniforms;
  private readonly byBase = new Map<THREE.Material, THREE.Material>();
  private holed: { readonly holes: BuildingHoleMaterials; readonly mask: MaskMaterials } | null = null;

  constructor(shared: CutUniforms, colors: CutColors) {
    this.uniforms = {
      uRlCutV: shared.uRlCutV,
      uRlCutN: shared.uRlCutN,
      uRlCutCap: { value: colors.cap.clone() },
      uRlCutInterior: { value: colors.interior.clone() },
    };
  }

  /** The cut clone of `base` (memoised); a material that is not a `MeshStandardMaterial` is returned as it is. */
  materialFor(base: THREE.Material): THREE.Material {
    if (!(base as THREE.MeshStandardMaterial).isMeshStandardMaterial) return base;
    let cut = this.byBase.get(base);
    if (cut === undefined) {
      cut = base.clone();
      cut.side = THREE.DoubleSide;
      cut.userData = { ...base.userData, rlCut: true };
      const prior = base.onBeforeCompile !== STOCK_HOOK ? base.onBeforeCompile : null;
      const baseKey = base.customProgramCacheKey();
      const uniforms = this.uniforms;
      const material = cut;
      cut.onBeforeCompile = (shader, renderer) => {
        if (prior) prior.call(material, shader, renderer);
        Object.assign(shader.uniforms, uniforms);
        const out = cutShaderHook(shader.vertexShader, shader.fragmentShader);
        shader.vertexShader = out.vertex;
        shader.fragmentShader = out.fragment;
      };
      cut.customProgramCacheKey = () => (baseKey ? `${baseKey}|${CUT_PROGRAM_KEY}` : CUT_PROGRAM_KEY);
      cut.needsUpdate = true;
      cutHooks.set(cut, { uniforms, base });
      this.byBase.set(base, cut);
    }
    return cut;
  }

  /**
   * The ONE mask of this building cut AND holed by `holes`: depth and AO discard on a hole OR the cut, over the holes'
   * uniforms and the shared volume block by reference, the terms in the colour clone's order (holes, then cut). Memoised
   * on `holes`; released with the cut.
   */
  maskWith(holes: BuildingHoleMaterials): MaskMaterials {
    if (this.holed !== null && this.holed.holes === holes) return this.holed.mask;
    this.disposeMask();
    const uniforms = { ...holes.uniforms, uRlCutV: this.uniforms.uRlCutV, uRlCutN: this.uniforms.uRlCutN };
    const mask = createMaskMaterials(uniforms, [HOLES_MASK_TERM, CUT_MASK_TERM], HOLES_CUT_MASK_PROGRAM_KEY);
    this.holed = { holes, mask };
    return mask;
  }

  private disposeMask(): void {
    if (this.holed === null) return;
    this.holed.mask.depth.dispose();
    this.holed.mask.ao.dispose();
    this.holed = null;
  }

  /** How many cut colour clones exist. */
  get size(): number {
    return this.byBase.size;
  }

  /** Is `m` one of this building's cut clones? */
  owns(m: THREE.Material): boolean {
    for (const v of this.byBase.values()) if (v === m) return true;
    return false;
  }

  /** Releases every clone. The maps they share with their base are the base's to release (`Material.clone` copies the texture
   *  REFERENCE), and the volume block is shared. */
  dispose(): void {
    for (const m of this.byBase.values()) m.dispose();
    this.byBase.clear();
    this.disposeMask();
  }
}
