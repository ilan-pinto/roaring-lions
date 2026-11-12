/** GH-1225 L7: a building holed AND cut draws one clone with both hooks, keeps its full model, and casts and occludes through
 *  ONE mask of both. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { maskHook } from './building-mask';
import { buildingMask, buildingSkin, keepsFullArt } from './building-skin';
import {
  BuildingCutMaterials,
  CUT_MASK_TERM,
  CUT_PARS_GLSL,
  CUT_PROGRAM_KEY,
  HOLES_CUT_MASK_PROGRAM_KEY,
  createCutMaskMaterials,
  createCutUniforms,
} from './cut-material';
import { BuildingHoleMaterials, HOLES_PARS_GLSL, HOLES_PROGRAM_KEY } from './holed-material';

const c = (r: number): THREE.Color => new THREE.Color(r, r, r);

describe('buildingSkin (L7: one twin, one hook)', () => {
  it('a holed and cut building shows both effects and the full model', () => {
    const band = new THREE.MeshStandardMaterial();
    const holes = new BuildingHoleMaterials({ lip: c(0.5), halo: c(0.3), crack: c(0.1), interior: c(0.05) });
    const cut = new BuildingCutMaterials(createCutUniforms(), { cap: c(0.8), interior: c(0.02) });
    const m = buildingSkin(band, holes, cut);
    expect(cut.owns(m)).toBe(true);
    expect(m.customProgramCacheKey().endsWith(`|${HOLES_PROGRAM_KEY}|${CUT_PROGRAM_KEY}`)).toBe(true);
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    m.onBeforeCompile(shader as never, {} as never);
    expect(Object.keys(shader.uniforms)).toEqual(expect.arrayContaining(['uRlHoleN', 'uRlCutN']));
    expect(m.side).toBe(THREE.DoubleSide);
    expect(keepsFullArt(true, true)).toBe(true);
    expect(keepsFullArt(true, false) && keepsFullArt(false, true)).toBe(true);
    expect(keepsFullArt(false, false)).toBe(false);
    holes.dispose();
    cut.dispose();
  });
});

/** The program a material really compiles from three's own ShaderLib text: its fragment, vertex and bound uniforms. */
function compiled(m: THREE.Material, lib: 'standard' | 'depth' | 'normal'): { vertex: string; fragment: string; uniforms: Record<string, unknown> } {
  const shader = { uniforms: {} as Record<string, unknown>, vertexShader: THREE.ShaderLib[lib].vertexShader, fragmentShader: THREE.ShaderLib[lib].fragmentShader };
  m.onBeforeCompile(shader as never, {} as never);
  return { vertex: shader.vertexShader, fragment: shader.fragmentShader, uniforms: shader.uniforms };
}

/** The discard calls a fragment makes before anything else in `main`, and whether their pars (with the discards) are there. */
function discards(fragment: string): string[] {
  const at = fragment.search(/void main\(\)\s*\{/);
  const head = fragment.slice(at).split('\n').slice(1).map((l) => l.trim());
  const calls: string[] = [];
  for (const l of head) {
    if (l !== 'rlHoleApply();' && l !== 'rlCutApply();') break;
    calls.push(l);
  }
  if (calls.includes('rlHoleApply();') && !fragment.includes(HOLES_PARS_GLSL)) throw new Error('rlHoleApply called, never declared');
  if (calls.includes('rlCutApply();') && !fragment.includes(CUT_PARS_GLSL)) throw new Error('rlCutApply called, never declared');
  return calls.sort();
}

// GH-1225 x GH-1197 P4: ONE mask. A fragment inside a hole OR the cut is discarded by every pass that draws the building:
// the colour clone, the shadow's depth material and the AO G-buffer's material, each compiled from three's real program.
// Each pass must call BOTH discard terms at the top of main, with the same pars text (pinned line for line in the holes and
// cut suites) and the SAME uniform objects, so the three passes test one hole set and one volume block.
// Falsify: drop `CUT_MASK_TERM` from `maskWith`'s terms (the AO and depth lose the cut), or `HOLES_MASK_TERM` (they lose the
// holes), and the depth and AO rows go red.
describe('buildingMask (one mask for holes and cut)', () => {
  it('a fragment in a hole OR the cut is discarded in depth, AO and colour alike', () => {
    const band = new THREE.MeshStandardMaterial();
    const holes = new BuildingHoleMaterials({ lip: c(0.5), halo: c(0.3), crack: c(0.1), interior: c(0.05) });
    const shared = createCutUniforms();
    const cut = new BuildingCutMaterials(shared, { cap: c(0.8), interior: c(0.02) });
    const sharedMask = createCutMaskMaterials(shared);
    const colour = compiled(buildingSkin(band, holes, cut), 'standard');
    const mask = buildingMask(holes, cut, sharedMask);
    expect(mask.depth).toBeDefined();
    expect(mask.ao).toBeDefined();
    expect(mask.depth).not.toBe(sharedMask.depth);
    const depth = compiled(mask.depth!, 'depth');
    const ao = compiled(mask.ao!, 'normal');
    for (const p of [colour, depth, ao]) {
      expect(discards(p.fragment)).toEqual(['rlCutApply();', 'rlHoleApply();']);
      expect(p.vertex).toContain('vRlHoleW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      expect(p.vertex).toContain('vRlCutW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      expect(p.uniforms.uRlHoleC).toBe(holes.uniforms.uRlHoleC);
      expect(p.uniforms.uRlHoleN).toBe(holes.uniforms.uRlHoleN);
      expect(p.uniforms.uRlCutV).toBe(shared.uRlCutV);
      expect(p.uniforms.uRlCutN).toBe(shared.uRlCutN);
    }
    expect(depth.fragment).not.toContain('diffuseColor.rgb = uRl');
    expect(ao.fragment).not.toContain('diffuseColor.rgb = uRl');
    expect(mask.depth!.customProgramCacheKey()).toBe(HOLES_CUT_MASK_PROGRAM_KEY);
    expect(mask.ao!.allowOverride).toBe(false);
    expect(mask.ao!.side).toBe(THREE.DoubleSide);
    // Memoised on the holes; released with the cut.
    expect(buildingMask(holes, cut, sharedMask)).toBe(mask);
    cut.dispose();
    holes.dispose();
    sharedMask.depth.dispose();
    sharedMask.ao.dispose();
  });

  it('off the joint path nothing moves: cut alone takes the shared slice-2 pair, holes alone the P4 depth and no AO mask', () => {
    const holes = new BuildingHoleMaterials({ lip: c(0.5), halo: c(0.3), crack: c(0.1), interior: c(0.05) });
    const shared = createCutUniforms();
    const cut = new BuildingCutMaterials(shared, { cap: c(0.8), interior: c(0.02) });
    const sharedMask = createCutMaskMaterials(shared);
    expect(buildingMask(null, cut, sharedMask)).toBe(sharedMask);
    expect(discards(compiled(sharedMask.depth, 'depth').fragment)).toEqual(['rlCutApply();']);
    expect(discards(compiled(sharedMask.ao, 'normal').fragment)).toEqual(['rlCutApply();']);
    expect(buildingMask(holes, null, sharedMask)).toEqual({ depth: holes.depth, ao: undefined });
    expect(buildingMask(null, null, sharedMask)).toEqual({ depth: undefined, ao: undefined });
    cut.dispose();
    holes.dispose();
  });

  // The slice-2 mask text, byte for byte, now that it is `maskHook` over one term: the cut-only program did not move.
  it('one term reproduces the slice-2 cut mask hook byte for byte', () => {
    for (const k of ['depth', 'normal'] as const) {
      const v = THREE.ShaderLib[k].vertexShader;
      const f = THREE.ShaderLib[k].fragmentShader;
      const main = /void main\(\)\s*\{/;
      expect(maskHook(v, f, [CUT_MASK_TERM])).toEqual({
        vertex: v.replace(main, (m) => `varying vec3 vRlCutW;\n${m}`).replace('#include <project_vertex>', '#include <project_vertex>\n  vRlCutW = (modelMatrix * vec4(transformed, 1.0)).xyz;'),
        fragment: f.replace(main, (m) => `${CUT_PARS_GLSL}\n${m}\n  rlCutApply();`),
      });
    }
  });
});
