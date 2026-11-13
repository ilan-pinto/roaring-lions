/**
 * GH-1225 slice 1: the cut clone and its hook. No GL in this suite: what the clone is, what the hook splices, and the GLSL
 * pinned line for line against `cutawayOps` (`building-cutaway.ts`), the copy the tests run.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { paletteHex } from '../palette-hex';
import { hexToLinear } from '../terrain/shared';
import { CUT_VOLUME_CAP } from './building-cutaway';
import {
  BuildingCutMaterials,
  CUT_COLOUR_GLSL,
  CUT_PARS_GLSL,
  CUT_PROGRAM_KEY,
  createCutUniforms,
  cutColorKeys,
  cutColorsFor,
  cutShaderHook,
  cutMaskHook,
} from './cut-material';

const colors = { cap: new THREE.Color(0.8, 0.7, 0.6), interior: new THREE.Color(0.02, 0.02, 0.03) };

describe('BuildingCutMaterials', () => {
  it('clones each base once, double-sided, keyed rl-cut on top of the base key, and leaves the base alone', () => {
    const base = new THREE.MeshStandardMaterial({ color: 0xc8b494 });
    base.customProgramCacheKey = () => 'rl-soot';
    const mats = new BuildingCutMaterials(createCutUniforms(), colors);
    const a = mats.materialFor(base);
    expect(a).not.toBe(base);
    expect(mats.materialFor(base)).toBe(a);
    expect(mats.size).toBe(1);
    expect(a.side).toBe(THREE.DoubleSide);
    expect(base.side).toBe(THREE.FrontSide);
    expect(a.customProgramCacheKey()).toBe(`rl-soot|${CUT_PROGRAM_KEY}`);
    expect((a as THREE.MeshStandardMaterial).color.getHex()).toBe(0xc8b494);
    expect(mats.owns(a)).toBe(true);
    expect(mats.owns(base)).toBe(false);
    mats.dispose();
    expect(mats.size).toBe(0);
  });

  it('passes a material it cannot hook through unchanged', () => {
    const basic = new THREE.MeshBasicMaterial();
    const mats = new BuildingCutMaterials(createCutUniforms(), colors);
    expect(mats.materialFor(basic)).toBe(basic);
    expect(mats.size).toBe(0);
  });

  it('binds the ONE shared volume block by reference, and its own colours', () => {
    const shared = createCutUniforms();
    expect(shared.uRlCutV.value).toHaveLength(CUT_VOLUME_CAP * 8);
    const one = new BuildingCutMaterials(shared, colors);
    const two = new BuildingCutMaterials(shared, cutColorsFor('limestone.3'));
    const compile = (m: THREE.Material): Record<string, { value: unknown }> => {
      const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
      m.onBeforeCompile(shader as never, {} as never);
      return shader.uniforms;
    };
    const u1 = compile(one.materialFor(new THREE.MeshStandardMaterial()));
    const u2 = compile(two.materialFor(new THREE.MeshStandardMaterial()));
    expect(u1.uRlCutV).toBe(shared.uRlCutV);
    expect(u2.uRlCutV).toBe(shared.uRlCutV);
    expect(u1.uRlCutN).toBe(shared.uRlCutN);
    expect(u1.uRlCutCap).not.toBe(u2.uRlCutCap);
    expect((u1.uRlCutCap.value as THREE.Color).toArray()).toEqual(colors.cap.toArray());
  });

  it("chains a base material's own hook before its own", () => {
    const base = new THREE.MeshStandardMaterial();
    const seen: string[] = [];
    base.onBeforeCompile = () => {
      seen.push('base');
    };
    const mats = new BuildingCutMaterials(createCutUniforms(), colors);
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    mats.materialFor(base).onBeforeCompile(shader as never, {} as never);
    expect(seen).toEqual(['base']);
    expect(shader.fragmentShader).toContain('rlCutApply();');
  });
});

describe('the cut colours', () => {
  it('the cap is the wall ramp lightest key taken halfway to the interior, the interior its darkest 0.6 toward gunmetal.2, both LINEAR', () => {
    // The limestone ramp has nine keys (data/palette.json: #F2E8D5 .. #5E4E3A), so its darkest is index 8: a literal, not whatever the code picks.
    expect(cutColorKeys('limestone.3')).toEqual({ cap: 'limestone.0', interior: 'limestone.8' });
    expect(paletteHex('limestone.8')).toBe('#5E4E3A');
    const keys = { cap: 'limestone.0', interior: 'limestone.8' };
    const c = cutColorsFor('limestone.3');
    const [r, g, b] = hexToLinear(paletteHex(keys.cap));
    const dark = hexToLinear(paletteHex(keys.interior));
    const char = hexToLinear(paletteHex('gunmetal.2'));
    const interior = [0, 1, 2].map((i) => dark[i] + (char[i] - dark[i]) * 0.6);
    expect(c.interior.r).toBeCloseTo(interior[0], 6);
    // Rim B: the cap sits HALFWAY from the lightest key to the interior (a literal 0.5, not CUT_CAP_TONE).
    expect(c.cap.r).toBeCloseTo(r + (interior[0] - r) * 0.5, 6);
    expect(c.cap.g).toBeCloseTo(g + (interior[1] - g) * 0.5, 6);
    expect(c.cap.b).toBeCloseTo(b + (interior[2] - b) * 0.5, 6);
  });
});

describe('the hook', () => {
  it('cuts first in main, colours after the base colour, and carries the world position', () => {
    const out = cutShaderHook(THREE.ShaderLib.standard.vertexShader, THREE.ShaderLib.standard.fragmentShader);
    expect(out.vertex).toContain('vRlCutW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    expect(out.fragment).toMatch(/void main\(\)\s*\{\n {2}rlCutApply\(\);/);
    expect(out.fragment.indexOf(CUT_COLOUR_GLSL)).toBeGreaterThan(out.fragment.indexOf('#include <map_fragment>'));
  });

  it('throws when three no longer holds a splice point, rather than compiling a building with no cut', () => {
    expect(() => cutShaderHook('void main() {}', THREE.ShaderLib.standard.fragmentShader)).toThrow(/common/);
    expect(() => cutShaderHook(THREE.ShaderLib.standard.vertexShader, 'void main() {}')).toThrow(/common/);
  });

  // The GLSL is the copy that DRAWS; `cutawayOps` is the copy the tests run. Pinned line for line, so neither moves alone:
  // `a` is (cx, cz, r, w), `b` is (yCut, yTop, j); `h` is `cutHeightOps`, `rho >= r + w` the reach, `y > h` the cut and
  // `y > h - 0.06` the section cap, `yc` the ragged kept height. Falsify: change `0.06` (CUT_SECTION_TILES) in the GLSL alone and this goes red.
  it('the GLSL cut is cutawayOps: pinned line for line', () => {
    const lines = CUT_PARS_GLSL.trim().split('\n').map((l) => l.trim());
    expect(lines).toEqual([
      'uniform vec4 uRlCutV[16];',
      'uniform int uRlCutN;',
      'uniform vec3 uRlCutCap;',
      'uniform vec3 uRlCutInterior;',
      'varying vec3 vRlCutW;',
      'float rlCutSection;',
      'float rlCutHash(int xi, int yi) {',
      'uint h = uint(xi) * 374761393u + uint(yi) * 668265263u;',
      'h = (h ^ (h >> 13u)) * 1274126177u;',
      'h = h ^ (h >> 16u);',
      'return float(h >> 8u) / 16777216.0;',
      '}',
      'void rlCutApply() {',
      'rlCutSection = 0.0;',
      'for (int i = 0; i < 8; i++) {',
      'if (i >= uRlCutN) break;',
      'vec4 a = uRlCutV[2 * i];',
      'vec4 b = uRlCutV[2 * i + 1];',
      'float rho = length(vRlCutW.xz - a.xy);',
      'if (rho >= a.z + a.w) continue;',
      'float yc = b.x + b.z * (rlCutHash(int(floor(vRlCutW.x * 4.0)), int(floor(vRlCutW.z * 4.0))) * 2.0 - 1.0);',
      'float h = yc + (b.y - yc) * clamp((rho - a.z) / a.w, 0.0, 1.0);',
      'if (vRlCutW.y > h) discard;',
      'if (vRlCutW.y > h - 0.06) rlCutSection = 1.0;',
      '}',
      '}',
    ]);
    expect(CUT_COLOUR_GLSL.trim().split('\n').map((l) => l.trim())).toEqual([
      'if (!gl_FrontFacing) diffuseColor.rgb = uRlCutInterior;',
      'else if (rlCutSection > 0.5) diffuseColor.rgb = uRlCutCap;',
    ]);
  });
});

describe('slice 2: the mask hook (shadow depth and AO normal)', () => {
  const v = '#include <common>\nvoid main() {\n#include <project_vertex>\n}';
  const f = '#include <common>\nvoid main() {\n}';
  it('splices the SAME pars text and the cut at the top of main, and no colour', () => {
    const out = cutMaskHook(v, f);
    expect(out.fragment).toContain(CUT_PARS_GLSL);
    expect(out.fragment).toMatch(/void main\(\) \{\n {2}rlCutApply\(\);/);
    expect(out.fragment).not.toContain('diffuseColor');
    expect(out.vertex).toContain('vRlCutW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  });
  it('refuses a program that lost its anchor', () => {
    expect(() => cutMaskHook('#include <common>\nvoid main() {}', f)).toThrow(/project_vertex/);
  });
  // The text r186 really hands `onBeforeCompile` for the two mask materials (the depth fragment has no `#include <common>`).
  // Falsify: put back a `#include <common>` requirement on the fragment and the depth row throws.
  it('takes the real ShaderLib depth and normal programs', () => {
    for (const k of ['depth', 'normal'] as const) {
      const out = cutMaskHook(THREE.ShaderLib[k].vertexShader, THREE.ShaderLib[k].fragmentShader);
      expect(out.fragment).toContain(CUT_PARS_GLSL);
      expect(out.fragment).toMatch(/void main\(\) \{\n {2}rlCutApply\(\);/);
      expect(out.vertex).toContain('vRlCutW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      expect(out.vertex.indexOf('varying vec3 vRlCutW;')).toBeLessThan(out.vertex.indexOf('void main'));
    }
  });
});
