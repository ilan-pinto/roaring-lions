/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T4) gates for the rain rim term of the node unit twin (`rain-rim.node.ts`), built by the backend's own factory body from
 * a REAL rim material (`applyRainRim`), and compiled by three's `GLSLNodeBuilder`. Each gate has a one-line falsification, run by
 * hand and listed in the commit message:
 *  - G1 the maths on numbers (`rimOps` through `NUMBER_OPS`): apply the contrast before the exposure in `treatedOps`;
 *  - G2 each input is wired: bind `uRimGain` by value (`const g = u.gain.value; renderUniform(() => g, ...)`); one per uniform;
 *  - G4 the orthographic view: use `T.positionViewDirection` unconditionally in `rimTerms`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NUMBER_OPS } from '../fog-ops';
import { applyRainRim, exposureCurve, rimOps, rimUniforms, setRainRead, setRainRimPass, treatedAlbedo } from './rain-rim';
import { compile, laviMaterial, mainOf, runUpdate, taggedGeometry, uniformOf, unitDeps, unitFactory, type UnitDeps } from './unit-twin.test-support';

afterEach(() => {
  setRainRimPass(true);
  setRainRead({ rimGain: 0, rimPower: 3, exposure: 6, contrast: 1.5 });
});

async function rimTwin(d: UnitDeps): Promise<{ twin: THREE.Material; mesh: THREE.Mesh }> {
  const fig = laviMaterial();
  applyRainRim(fig);
  const twin = unitFactory(d)(fig);
  return { twin, mesh: new THREE.Mesh(taggedGeometry(0), twin) };
}

describe('G1: the rim and the albedo treatment on numbers', () => {
  const base = { rimColor: [0.5, 0.25, 1] as const, gain: 0.4, power: 3, exposure: 6, contrast: 1.5 };

  it('the exposure FIRST, then the contrast: 0.02 at exposure 6, contrast 1.5 is 0.12^1.5, and an albedo past the cap is 1', () => {
    const r = rimOps(NUMBER_OPS, { ...base, diffuse: [0.02, 0.3, 0.5], nDotV: 1 });
    expect(r.rgb[0]).toBeCloseTo(0.0415692, 6); // min(0.12, 1)^1.5, not (0.02^1.5) * 6 = 0.0170
    expect(r.rgb[1]).toBe(1); // min(1.8, 1)^1.5
    expect(r.rgb[2]).toBe(1);
    expect(treatedAlbedo(0.02, 6, 1.5)).toBeCloseTo(0.0415692, 6);
    expect(exposureCurve(0.3, 6)).toBe(1);
  });

  it('the rim is rimColor x gain x (1 - saturate(n.v))^power: 0.5 gives an eighth of the gain, grazing the whole gain, facing nothing', () => {
    const em = (nDotV: number): number[] => rimOps(NUMBER_OPS, { ...base, diffuse: [0.1, 0.1, 0.1], nDotV }).emissive;
    const half = em(0.5);
    expect(half[0]).toBeCloseTo(0.025, 12);
    expect(half[1]).toBeCloseTo(0.0125, 12);
    expect(half[2]).toBeCloseTo(0.05, 12);
    expect(em(-0.3)).toEqual([0.2, 0.1, 0.4]); // saturate: behind the surface is the full rim
    expect(em(1)).toEqual([0, 0, 0]);
  });
});

describe('G2: each rim input is wired, on program text and by reference', () => {
  it('the fragment reads uRimColor, uRimGain, uRimPower, uRainExposure and uRainContrast, in the exposure and rim expressions', async () => {
    const d = await unitDeps();
    const { twin, mesh } = await rimTwin(d);
    const built = compile(d, mesh, twin);
    for (const name of ['uRimColor', 'uRimGain', 'uRimPower', 'uRainExposure', 'uRainContrast']) {
      expect(built.usedFragment.has(uniformOf(twin, name)), `${name} is bound but the fragment never reads it`).toBe(true);
    }
    const frag = mainOf(built.fragment);
    expect(frag).toContain('min( ( rlUnitColorMap.x * uRainExposure ), 1.0 )');
    expect(frag).toContain('0.0001 ), uRainContrast )');
    expect(frag).toContain('uRimGain * pow( ( 1.0 - clamp( dot( normalize( normalView ),');
    expect(frag).toContain('uRimPower )');
    expect(frag).toContain('uRimColor.x *');
    // The exposure runs on the colour before lighting, the rim lands in the emissive.
    expect(frag).toContain('DiffuseColor = rlUnitColorRain;');
    expect(frag).toMatch(/EmissiveColor = .*uRimColor\.x/);
  });

  it('every uniform follows rimUniforms() on a render update (a write between frames), and the unit-surface layer zeroes the pass', async () => {
    const d = await unitDeps();
    const { twin } = await rimTwin(d);
    const u = rimUniforms();
    setRainRead({ rimGain: 0.7, rimPower: 2, exposure: 4, contrast: 1.25 });
    for (const [name, want] of [['uRimGain', 0.7], ['uRimPower', 2], ['uRainExposure', 4], ['uRainContrast', 1.25]] as const) {
      const n = uniformOf(twin, name);
      runUpdate(n);
      expect(n.value, name).toBe(want);
    }
    const colour = uniformOf(twin, 'uRimColor');
    u.colour.value.setRGB(1, 0, 0);
    runUpdate(colour);
    expect((colour.value as THREE.Color).toArray()).toEqual([1, 0, 0]);
    setRainRimPass(false);
    for (const [name, want] of [['uRimGain', 0], ['uRainExposure', 1], ['uRainContrast', 1]] as const) {
      const n = uniformOf(twin, name);
      runUpdate(n);
      expect(n.value, name).toBe(want);
    }
  });
});

describe('G4: the rim\'s view vector follows the camera type', () => {
  it('an OrthographicCamera uses (0, 0, 1); a PerspectiveCamera uses the position\'s view direction', async () => {
    const d = await unitDeps();
    const { twin, mesh } = await rimTwin(d);
    const ortho = mainOf(compile(d, mesh, twin, new THREE.OrthographicCamera()).fragment);
    expect(ortho).toContain('dot( normalize( normalView ), vec3( 0.0, 0.0, 1.0 ) )');
    const persp = mainOf(compile(d, mesh, twin, new THREE.PerspectiveCamera()).fragment);
    expect(persp).not.toContain('dot( normalize( normalView ), vec3( 0.0, 0.0, 1.0 ) )');
    expect(persp).toContain('dot( normalize( normalView ), positionViewDirection )');
  });
});
