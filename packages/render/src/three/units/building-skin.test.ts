/** GH-1225 L7: a building holed AND cut draws one clone with both hooks, and keeps its full model. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildingSkin, keepsFullArt } from './building-skin';
import { BuildingCutMaterials, CUT_PROGRAM_KEY, createCutUniforms } from './cut-material';
import { BuildingHoleMaterials, HOLES_PROGRAM_KEY } from './holed-material';

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
