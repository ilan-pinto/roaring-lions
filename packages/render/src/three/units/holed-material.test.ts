/**
 * GH-1197 P4: the holed clone and its hook. The GLSL itself is checked against `glslangValidator` in the PR (no GL in
 * this suite); here: what the clone is, what the hook splices, and that the shader spells the module's constants.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HOLE_CAP } from './building-holes';
import { BuildingHoleMaterials, HOLES_PARS_GLSL, HOLES_PROGRAM_KEY, holesShaderHook } from './holed-material';

const colors = {
  lip: new THREE.Color(0.5, 0.4, 0.3),
  halo: new THREE.Color(0.1, 0.1, 0.1),
  crack: new THREE.Color(0.01, 0.01, 0.01),
  interior: new THREE.Color(0.02, 0.02, 0.03),
};

describe('BuildingHoleMaterials', () => {
  it('clones each base once, double-sided, keyed rl-holes on top of the base key, and leaves the base alone', () => {
    const base = new THREE.MeshStandardMaterial({ color: 0xc8b494 });
    base.customProgramCacheKey = () => 'rl-soot';
    const mats = new BuildingHoleMaterials(colors);
    const a = mats.materialFor(base);
    expect(a).not.toBe(base);
    expect(mats.materialFor(base)).toBe(a);
    expect(mats.size).toBe(1);
    expect(a.side).toBe(THREE.DoubleSide);
    expect(base.side).toBe(THREE.FrontSide);
    expect(a.customProgramCacheKey()).toBe(`rl-soot|${HOLES_PROGRAM_KEY}`);
    expect((a as THREE.MeshStandardMaterial).color.getHex()).toBe(0xc8b494);
    expect(mats.owns(a)).toBe(true);
    expect(mats.owns(base)).toBe(false);
    mats.dispose();
  });

  it('passes a material it cannot hook through unchanged', () => {
    const basic = new THREE.MeshBasicMaterial();
    const mats = new BuildingHoleMaterials(colors);
    expect(mats.materialFor(basic)).toBe(basic);
    expect(mats.size).toBe(0);
    mats.dispose();
  });

  it('writes the holes into ONE uniform set the colour clones and the depth material share', () => {
    const mats = new BuildingHoleMaterials(colors);
    mats.setHoles([{ c: [1, 2, 3], radius: 0.3, axis: [0, 0, 1], seed: 9, classRadius: 0.3 }]);
    expect(mats.uniforms.uRlHoleN.value).toBe(1);
    expect(mats.uniforms.uRlHoleC.value[0].toArray()).toEqual([1, 2, 3, 0.3]);
    expect(mats.uniforms.uRlHoleA.value[0].toArray()).toEqual([0, 0, 1, 9]);
    expect(mats.uniforms.uRlHoleC.value).toHaveLength(HOLE_CAP);
    // The hook hands the SAME objects to a compiled program.
    const base = new THREE.MeshStandardMaterial();
    const holed = mats.materialFor(base);
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    holed.onBeforeCompile(shader as never, {} as never);
    expect(shader.uniforms.uRlHoleC).toBe(mats.uniforms.uRlHoleC);
    const depth = { uniforms: {} as Record<string, unknown>, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader };
    mats.depth.onBeforeCompile(depth as never, {} as never);
    expect(depth.uniforms.uRlHoleC).toBe(mats.uniforms.uRlHoleC);
    expect(depth.fragmentShader).toContain('rlHoleApply();');
    expect(depth.fragmentShader).not.toContain('uRlInterior;\n  else');
    mats.dispose();
  });

  it("chains a base material's own hook before its own", () => {
    const base = new THREE.MeshStandardMaterial();
    const seen: string[] = [];
    base.onBeforeCompile = () => {
      seen.push('base');
    };
    const mats = new BuildingHoleMaterials(colors);
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    mats.materialFor(base).onBeforeCompile(shader as never, {} as never);
    expect(seen).toEqual(['base']);
    mats.dispose();
  });
});

describe('the hook', () => {
  it('cuts first in main, colours after the base colour, and carries the world position', () => {
    const out = holesShaderHook(THREE.ShaderLib.standard.vertexShader, THREE.ShaderLib.standard.fragmentShader, true);
    expect(out.vertex).toContain('vRlHoleW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    expect(out.fragment).toMatch(/void main\(\)\s*\{\n {2}rlHoleApply\(\);/);
    expect(out.fragment).toContain('#include <map_fragment>\n');
    expect(out.fragment.indexOf('if (!gl_FrontFacing) diffuseColor.rgb = uRlInterior;')).toBeGreaterThan(out.fragment.indexOf('#include <map_fragment>'));
  });
  it('throws when three no longer holds a splice point, rather than compiling a building with no holes', () => {
    expect(() => holesShaderHook('void main() {}', THREE.ShaderLib.standard.fragmentShader, true)).toThrow(/project_vertex/);
  });
  // PR 1221 review: the GLSL edge is the copy that DRAWS, so its lattice is pinned as text, line for line. The TS
  // mirror's seam test (building-holes.test.ts) cannot see a change here; this can.
  it('the GLSL edge noise is the periodic lattice the TypeScript mirror tests: pinned line for line', () => {
    const start = HOLES_PARS_GLSL.indexOf('float rlHoleEdge(float theta, int seed) {');
    const end = HOLES_PARS_GLSL.indexOf('void rlHoleApply() {');
    expect(start).toBeGreaterThan(0);
    const body = HOLES_PARS_GLSL.slice(start, end).trim().split('\n').map((l) => l.trim());
    expect(body).toEqual([
      'float rlHoleEdge(float theta, int seed) {',
      'float turn = fract(theta / 6.283185307179586);',
      'float sum = 0.0;',
      'float norm = 0.0;',
      'float amp = 1.0;',
      'for (int o = 0; o < 4; o++) {',
      'int cells = 4 << o;',
      'float u = turn * float(cells);',
      'int i0 = int(floor(u)) % cells;',
      'int i1 = (i0 + 1) % cells;',
      'float fr = u - floor(u);',
      'float s = fr * fr * (3.0 - 2.0 * fr);',
      'float a = rlHoleHash(i0, seed * 128 + o);',
      'float b = rlHoleHash(i1, seed * 128 + o);',
      'sum += amp * mix(a, b, s);',
      'norm += amp;',
      'amp *= 0.5;',
      '}',
      'return sum / norm;',
      '}',
    ]);
  });

  it('spells the module constants: the cap, the depth, the +-15% edge, 4 octaves, the lip and the halo', () => {
    expect(HOLES_PARS_GLSL).toContain(`uniform vec4 uRlHoleC[${HOLE_CAP}];`);
    expect(HOLES_PARS_GLSL).toContain('if (abs(ax) >= 0.6) continue;');
    expect(HOLES_PARS_GLSL).toContain('r * (0.85 + 0.3 * rlHoleEdge(th, seed))');
    expect(HOLES_PARS_GLSL).toContain('for (int o = 0; o < 4; o++)');
    expect(HOLES_PARS_GLSL).toContain('if (o < 0.03) rlHoleTint = vec4(uRlLip, 1.0);');
    expect(HOLES_PARS_GLSL).toContain('0.7 * (1.0 - ho / 0.15)');
  });
});
