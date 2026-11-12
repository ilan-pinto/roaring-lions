/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T4) gates for the figure hooks as a CHAIN on the node unit twin: the rim then the floor (G5), and the fade clone of a
 * rim figure, which drops the hooks on legacy (`Material.clone` drops `onBeforeCompile`, and only `carryTeamMark` re-applies one).
 * Falsifications, run by hand and listed in the commit message:
 *  - G5 the chain: swap `'rl-unit-rain-rim'` and `'rl-wounded-floor'` in `UNIT_TERM_ORDER`;
 *  - the fade: make `unitMemoKey` / the composer take the base's segments instead of the clone's (`hookSegments(base)`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyRainRim, setRainRead } from './rain-rim';
import { liftWoundedTemplate } from './wounded-read';
import { VehicleTeamMaterials, TeamMaskSlots } from './team-mask';
import { beginMeshDeathFade } from './mesh-death';
import { hookSegments } from '../material-names';
import { legacyOf } from '../twin-identity';
import { nodeUnitBindings } from './unit-material.node';
import { adoptUnits, compile, laviMaterial, mainOf, taggedGeometry, unitDeps, unitFactory } from './unit-twin.test-support';

afterEach(() => setRainRead({ rimGain: 0, rimPower: 3, exposure: 6, contrast: 1.5 }));

/** A KDF-figure-shaped material: the rim (exposure, contrast, rim) then lifted by the wounded floor. */
function rimThenFloor(): THREE.MeshStandardMaterial {
  const fig = laviMaterial();
  applyRainRim(fig);
  const g = new THREE.Group().add(new THREE.Mesh(taggedGeometry(0), fig));
  liftWoundedTemplate(g);
  return (g.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
}

describe('G5: a rim-plus-floor figure composes the rim, then the floor', () => {
  it('the key reads rim then floor; the twin applies them in that order; the floor measures the TREATED colour and the rim-lit output', async () => {
    const d = await unitDeps();
    const m = rimThenFloor();
    expect(hookSegments(m)).toEqual(['rl-unit-rain-rim', 'rl-wounded-floor']);
    const twin = unitFactory(d)(m);
    expect(nodeUnitBindings(twin)?.applied).toEqual(['rl-unit-rain-rim', 'rl-wounded-floor']);
    const frag = mainOf(compile(d, new THREE.Mesh(taggedGeometry(0), twin), twin).fragment);
    const rain = frag.indexOf('rlUnitColorRain = ');
    const emissive = frag.indexOf('EmissiveColor = ');
    const output = frag.indexOf('Output = ');
    const floor = frag.indexOf('smoothstep(');
    expect(rain).toBeGreaterThan(0);
    expect(emissive).toBeGreaterThan(rain);
    expect(output).toBeGreaterThan(emissive);
    expect(floor).toBeGreaterThan(output);
    // The floor's albedo is the rim-treated colour (the legacy `diffuseColor` after the exposure), the light is the output with the rim in it.
    expect(frag).toMatch(/\( Output\.x \* 0\.2126 \).*\/ max\( \( \( \( rlUnitColorRain\.x \* 0\.2126 \)/);
  });
});

describe('the fade clone of a figure drops the hooks the legacy clone lost, so the node twin does too', () => {
  const slots = (): TeamMaskSlots => new TeamMaskSlots(['#2F6FD9', '#D93A2B', '#F2E8D5']);

  it('a rim-plus-team hull fades as a team-only twin: no rim uniform, the base twin keeps both', async () => {
    const d = await unitDeps();
    const hull = new VehicleTeamMaterials(slots()).materialFor(laviMaterial(), 0) as THREE.MeshStandardMaterial;
    applyRainRim(hull);
    expect(hookSegments(hull)).toEqual(['rl-unit-mark-3', 'rl-unit-rain-rim']);
    const root = new THREE.Group().add(new THREE.Mesh(taggedGeometry(0), hull));
    const scene = new THREE.Scene().add(root);
    const cache = adoptUnits(d, scene);
    const mesh = root.children[0] as THREE.Mesh;
    const baseTwin = mesh.material as THREE.Material;
    expect(nodeUnitBindings(baseTwin)?.applied).toEqual(['rl-unit-mark-3', 'rl-unit-rain-rim']);
    const swaps = beginMeshDeathFade(root);
    const fade = swaps[0]?.fade as THREE.MeshStandardMaterial;
    expect(legacyOf(baseTwin, mesh)).toBe(hull);
    expect(hookSegments(fade)).toEqual(['rl-unit-mark-3']); // the legacy clone lost the rim
    adoptUnits(d, scene, cache);
    const fadeTwin = mesh.material as THREE.Material;
    expect(fadeTwin).not.toBe(baseTwin);
    expect(nodeUnitBindings(fadeTwin)?.applied).toEqual(['rl-unit-mark-3']);
    expect(nodeUnitBindings(fadeTwin)?.uniforms.has('uRimGain')).toBe(false);
    expect(nodeUnitBindings(baseTwin)?.uniforms.has('uRimGain')).toBe(true);
    const frag = mainOf(compile(d, mesh, fadeTwin).fragment);
    expect(frag).not.toContain('uRimGain');
    expect(frag).not.toContain('uRainExposure');
  });

  it('a rim-only figure\'s fade clone has NO hook segments: it is not adopted, as on legacy (a stock material)', async () => {
    const d = await unitDeps();
    const fig = laviMaterial();
    applyRainRim(fig);
    const root = new THREE.Group().add(new THREE.Mesh(taggedGeometry(0), fig));
    const scene = new THREE.Scene().add(root);
    const cache = adoptUnits(d, scene);
    const mesh = root.children[0] as THREE.Mesh;
    expect(nodeUnitBindings(mesh.material as THREE.Material)?.applied).toEqual(['rl-unit-rain-rim']);
    const swaps = beginMeshDeathFade(root);
    const fade = swaps[0]?.fade as THREE.Material;
    expect(hookSegments(fade)).toEqual([]);
    adoptUnits(d, scene, cache);
    expect(mesh.material).toBe(fade);
    expect(nodeUnitBindings(mesh.material as THREE.Material)).toBeNull();
  });
});
