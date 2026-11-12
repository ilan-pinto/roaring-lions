/**
 * @vitest-environment jsdom
 *
 * GH-1096 S1, gate 4: the insignia term of the node unit twin (`insignia.node.ts`), built by the backend's own factory body from a
 * REAL insignia variant (`VehicleTeamMaterials` with a frame) and compiled by three's `GLSLNodeBuilder` (and the WGSL one). Oracles
 * are LITERALS. Each gate has a one-line falsification, run by hand and listed in the commit message:
 *  - G1 the term is wired, on program text: remove the term (`insigniaTerms` returns `[]`), and the uniform reads go red;
 *  - G2 by reference: copy the texture at build (`renderTexture(() => hook.sdf.value.clone(), ...)`), and the swap check goes red.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { InsigniaShared, setInsigniaStrength } from './insignia';
import { TeamMaskSlots, UNIT_MARK_PROGRAM_KEY, VehicleTeamMaterials, setInsigniaPass } from './team-mask';
import { bindingsOf, compile, compileWgsl, laviMaterial, mainOf, runUpdate, taggedGeometry, uniformOf, unitDeps, unitFactory, type UnitDeps } from './unit-twin.test-support';

afterEach(() => setInsigniaStrength(true));

const FRAME = { centre: [0.95, 1.0, 1.7], d: 0.6, slab: [1.6, 1.95], min_n: 0.6, luma: 0.12277, host_sha256: 'x' } as const;
const slots = (): TeamMaskSlots => new TeamMaskSlots(['#2F6FD9', '#D93A2B', '#F2E8D5']);

function insOnlyMaterial(): THREE.MeshStandardMaterial {
  const m = laviMaterial();
  m.userData = { rl_bake_luma: 0.09 }; // no team mark: the insignia alone
  return m;
}

async function built(d: UnitDeps, base: THREE.MeshStandardMaterial, withInsignia = true) {
  const shared = new InsigniaShared();
  const variant = new VehicleTeamMaterials(slots(), undefined, withInsignia ? { frame: FRAME, shared } : null).materialFor(base, 0) as THREE.MeshStandardMaterial;
  const twin = unitFactory(d)(variant);
  const mesh = new THREE.Mesh(taggedGeometry(0), twin);
  return { shared, variant, twin, mesh, prog: compile(d, mesh, twin) };
}

const INS_UNIFORMS = ['uInsFrame', 'uInsSlab', 'uInsBands', 'uInsColor', 'uInsStrength', 'uInsLuma', 'uInsPixelRatio'];

describe('G1: the insignia term is wired, on program text', () => {
  it('an insignia-only twin draws the rl-unit-mark-3 segment, reads every insignia uniform, samples the field, and no team uniform', async () => {
    const d = await unitDeps();
    const { twin, prog } = await built(d, insOnlyMaterial());
    expect(bindingsOf(twin).applied).toEqual([UNIT_MARK_PROGRAM_KEY]);
    for (const name of INS_UNIFORMS) {
      expect(prog.usedFragment.has(uniformOf(twin, name)), `${name} is bound but the fragment never reads it`).toBe(true);
    }
    expect(prog.usedFragment.has(uniformOf(twin, 'uInsSdf')), 'the field is never sampled').toBe(true);
    expect(prog.fragment).not.toContain('uTeamColor');
    const frag = mainOf(prog.fragment);
    // the screen-space rates are taken in the graph: of the emblem coordinate, of the sample, of |p.z|
    expect(frag).toMatch(/fwidth\(/);
    expect(frag).toContain('fwidth( abs( vMarkPos.z ) )');
    // the object-space varyings are the raw attributes (no matrix): the emblem turns with a turret
    const vert = mainOf(prog.vertex);
    expect(vert).toMatch(/\bvMarkPos = position;/);
    expect(vert).toMatch(/\bvMarkNrm = normal;/);
  });

  it('a team + insignia twin draws both terms off ONE pair of varyings, and the team-only twin has no insignia', async () => {
    const d = await unitDeps();
    const both = await built(d, laviMaterial());
    for (const name of [...INS_UNIFORMS, 'uTeamColor', 'uMarkA']) expect(both.prog.usedFragment.has(uniformOf(both.twin, name)), name).toBe(true);
    expect(both.prog.vertex.match(/\bvMarkPos = position;/g)).toHaveLength(1);
    const wgsl = compileWgsl(d, both.mesh, both.twin);
    expect(wgsl.fragment).toContain('textureSample');
    const teamOnly = await built(d, laviMaterial(), false);
    expect(teamOnly.prog.fragment).not.toContain('uInsFrame');
    expect(() => uniformOf(teamOnly.twin, 'uInsSdf')).toThrow();
  });

  it('a material with no map draws no insignia (the legacy #ifdef USE_MAP)', async () => {
    const d = await unitDeps();
    const variant = new VehicleTeamMaterials(slots(), undefined, { frame: FRAME, shared: new InsigniaShared() }).materialFor(insOnlyMaterial(), 0) as THREE.MeshStandardMaterial;
    variant.map = null;
    const twin = unitFactory(d)(variant);
    const prog = compile(d, new THREE.Mesh(taggedGeometry(0), twin), twin);
    expect(prog.fragment).not.toContain('uInsFrame');
  });
});

describe('G2: the owner\'s field, colour and ratio and the module\'s strength, by reference', () => {
  it('a late load swaps the texture with no rebuild; the `insignia` layer at 0 zeroes the strength', async () => {
    const d = await unitDeps();
    const { shared, twin } = await built(d, insOnlyMaterial());
    const sdf = uniformOf(twin, 'uInsSdf');
    const placeholder = shared.sdf.value;
    expect(sdf.value).toBe(placeholder);
    const real = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
    shared.setTexture(real);
    runUpdate(sdf);
    expect(sdf.value).toBe(real);
    shared.setPixelRatio(2);
    const ratio = uniformOf(twin, 'uInsPixelRatio');
    runUpdate(ratio);
    expect(ratio.value).toBe(2);
    const strength = uniformOf(twin, 'uInsStrength');
    setInsigniaPass(false);
    runUpdate(strength);
    expect(strength.value).toBe(0);
    setInsigniaPass(true);
    runUpdate(strength);
    expect(strength.value).toBe(0.85);
    expect((uniformOf(twin, 'uInsFrame').value as THREE.Vector4).toArray()).toEqual([0.95, 1.0, 0.6, 0.6]);
  });
});
