/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T3) gates for the soot term of the node unit twin (`world-materials.node.ts`), built by the backend's own factory body
 * from a REAL wreck material (`charredTexturedMaterial`) and compiled by three's `GLSLNodeBuilder`. Oracles are LITERALS. Each gate
 * has a one-line falsification, run by hand and listed in the commit message:
 *  - G8 the soot on numbers: weight the texel's colour instead of its luminance (`min(color * texel, 1)`) in `sootOps`;
 *  - G8 a later `color` write reaches the twin: read `color` at build (`materialColor` bound to `legacy.color.clone()`, no update).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NUMBER_OPS } from './fog-ops';
import { charredTexturedMaterial, SOOT_MAP_FRAGMENT, SOOT_PROGRAM_KEY, sootOps } from './world-materials';
import { compile, laviMaterial, mainOf, runUpdate, taggedGeometry, uniformOf, unitDeps, unitFactory, bindingsOf } from './units/unit-twin.test-support';

describe('G8: the soot on numbers (NUMBER_OPS)', () => {
  it('colour (0.5, 0.5, 0.5) over a texel of luma 0.4 reads 0.2, and the alpha is the texel\'s', () => {
    const out = sootOps(NUMBER_OPS, [0.5, 0.5, 0.5], [0.4, 0.4, 0.4, 0.75]);
    for (let c = 0; c < 3; c++) expect(out[c]).toBeCloseTo(0.2, 12);
    expect(out[3]).toBe(0.75);
    // The LUMINANCE, not the colour: a pure red texel (luma 0.2126) greys the soot evenly.
    const red = sootOps(NUMBER_OPS, [0.5, 0.5, 0.5], [1, 0, 0, 1]);
    expect(red[0]).toBeCloseTo(0.1063, 12);
    expect(red[1]).toBeCloseTo(0.1063, 12);
    // Clamped at 1 (an albedo's ceiling).
    expect(sootOps(NUMBER_OPS, [9, 9, 9], [1, 1, 1, 1])).toEqual([1, 1, 1, 1]);
  });

  it('is the chunk the legacy wreck runs', () => {
    expect(SOOT_MAP_FRAGMENT).toContain('min( diffuseColor.rgb * dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), vec3( 1.0 ) )');
    expect(SOOT_MAP_FRAGMENT).toContain('diffuseColor.a *= sampledDiffuseColor.a;');
  });
});

describe('G8: the soot twin', () => {
  it('replaces the map stage (no stock colour x texel) and reads the object colour; a later colour write reaches the twin', async () => {
    const d = await unitDeps();
    const wreck = charredTexturedMaterial(laviMaterial());
    expect(wreck.customProgramCacheKey()).toBe(SOOT_PROGRAM_KEY);
    const twin = unitFactory(d)(wreck);
    expect(bindingsOf(twin).applied).toEqual(['rl-soot']);
    const mesh = new THREE.Mesh(taggedGeometry(0), twin);
    // The mesh record adoption writes (`recordAdoption`), so the object update finds THIS mesh's legacy wreck.
    Object.defineProperty(mesh.userData, 'rlLegacy', { value: wreck, enumerable: false, configurable: true, writable: true });
    Object.defineProperty(wreck.userData, 'rlTwinOf', { value: twin, enumerable: false, configurable: true, writable: true });
    const frag = mainOf(compile(d, mesh, twin).fragment);
    // The texel's luminance, then min(colour x luma, 1) per channel, the texel's alpha; and nothing multiplies the colour by the texel.
    const tap = /(\w+) = texture\( \w+, \w+ \);/.exec(frag)?.[1];
    expect(tap).toBeDefined();
    const y = new RegExp(`(\\w+) = \\( \\( \\( ${tap}\\.x \\* 0\\.2126 \\) \\+ \\( ${tap}\\.y \\* 0\\.7152 \\) \\) \\+ \\( ${tap}\\.z \\* 0\\.0722 \\) \\);`).exec(frag)?.[1];
    expect(y).toBeDefined();
    expect(frag).toContain(
      `rlUnitColorSoot = vec4( min( ( uUnitColor.x * ${y} ), 1.0 ), min( ( uUnitColor.y * ${y} ), 1.0 ), min( ( uUnitColor.z * ${y} ), 1.0 ), ${tap}.w );`
    );
    expect(frag).not.toContain(`uUnitColor * ${tap}`);
    expect(frag).toContain('DiffuseColor = rlUnitColorSoot;');
    wreck.color.setRGB(0.25, 0.5, 0.75);
    const color = uniformOf(twin, 'uUnitColor');
    runUpdate(color, mesh);
    expect(color.value).toBe(wreck.color);
    expect((color.value as THREE.Color).toArray()).toEqual([0.25, 0.5, 0.75]);
    // Fully rough and dielectric, per object, as `charredTexturedMaterial` sets them.
    runUpdate(uniformOf(twin, 'uUnitRoughness'), mesh);
    runUpdate(uniformOf(twin, 'uUnitMetalness'), mesh);
    expect(uniformOf(twin, 'uUnitRoughness').value).toBe(1);
    expect(uniformOf(twin, 'uUnitMetalness').value).toBe(0);
  });
});
