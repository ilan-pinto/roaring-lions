/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T3) gates for the team-mark term of the node unit twin (`team-mask.node.ts`), built by the backend's own factory body
 * from a REAL team variant (`VehicleTeamMaterials`) and compiled by three's `GLSLNodeBuilder`. Oracles are LITERALS. Each gate has
 * a one-line falsification, run by hand and listed in the commit message:
 *  - G1 the mark maths on numbers (`teamMarkOps` through `NUMBER_OPS`): swap `i.a` and `i.b` in `teamMarkOps`'s roof;
 *  - G2 each input is wired, on program text: read `positionWorld` for `positionGeometry` (`vMarkPos`); drop the kit term
 *    (`kit: []`); bind `uTeamStrength` by value (no render update);
 *  - G3 slot colours by reference: copy the colour at build (`renderUniform(() => hook.color.value.clone(), ...)`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NUMBER_OPS } from '../fog-ops';
import {
  MARK_EDGE_PX,
  MARK_MIN_WIDTH,
  TEAM_LUMA_WEIGHTS,
  TEAM_MASK_FRAGMENT,
  TEAM_MASK_STRENGTH,
  TEAM_NORMAL_SOFT,
  TEAM_PANEL_GRIME,
  TeamMaskSlots,
  VehicleTeamMaterials,
  setTeamMaskPass,
  teamMarkOps,
  type TeamMarkInput,
} from './team-mask';
import { compile, laviMaterial, mainOf, MARK, runUpdate, taggedGeometry, uniformOf, unitDeps, unitFactory, type UnitDeps } from './unit-twin.test-support';

afterEach(() => setTeamMaskPass(true));

const A: [number, number, number, number] = [MARK.roof.x[0], MARK.roof.x[1], MARK.roof.z_half, MARK.roof.min_ny];
const B: [number, number, number, number] = [MARK.roof.y[0], MARK.roof.y[1], MARK.band.min_nz, MARK.exclude_radius];
const C: [number, number, number, number] = [MARK.band.x[0], MARK.band.x[1], MARK.band.y[0], MARK.band.y[1]];
const KIT = MARK.exclude_uv.map((k) => [k[0], k[1]] as const);
const TEAM: [number, number, number] = [0.0284, 0.159, 0.6939];

function input(over: Partial<TeamMarkInput<number>>): TeamMarkInput<number> {
  return {
    p: [-1.0, 2.4, 0.0],
    n: [0, 1, 0],
    uv: [0.5, 0.5],
    rate: [1e-6, 1e-6, 1e-6],
    a: A,
    b: B,
    c: C,
    kit: KIT,
    strength: TEAM_MASK_STRENGTH,
    luma: MARK.luma,
    team: TEAM,
    diffuse: [0.3, 0.2, 0.1],
    ...over,
  };
}

describe('G1: the mark maths on numbers (NUMBER_OPS)', () => {
  it('a point inside the roof box, facing up, reads the full strength 0.85; one outside reads 0', () => {
    expect(teamMarkOps(NUMBER_OPS, input({})).mask).toBe(0.85);
    // Off the roof's x span (and the band's).
    expect(teamMarkOps(NUMBER_OPS, input({ p: [1.0, 2.4, 0.0] })).mask).toBe(0);
    // On the roof's footprint but facing sideways: the normal test (min_ny 0.6) rejects it.
    expect(teamMarkOps(NUMBER_OPS, input({ n: [1, 0, 0] })).mask).toBe(0);
  });

  it('a point at a kit part\'s uv centre reads 0 (the kit exclusion), inside the box', () => {
    for (const k of KIT) expect(teamMarkOps(NUMBER_OPS, input({ uv: [k[0], k[1]] })).mask).toBe(0);
  });

  it('the band on a flank (|n.z| 1) reads the strength', () => {
    expect(teamMarkOps(NUMBER_OPS, input({ p: [-1.0, 2.2, 0.9], n: [0, 0, -1] })).mask).toBe(0.85);
  });

  it('the panel at luma(diffuse) = uTeamLuma is the team colour, exactly mixed in at full strength', () => {
    const g = MARK.luma;
    const r = teamMarkOps(NUMBER_OPS, input({ strength: 1, diffuse: [g, g, g] }));
    expect(r.mask).toBe(1);
    for (let c = 0; c < 3; c++) expect(r.rgb[c]).toBeCloseTo(TEAM[c] as number, 12);
    // At strength 0 the colour is the diffuse, untouched.
    const off = teamMarkOps(NUMBER_OPS, input({ strength: 0, diffuse: [0.3, 0.2, 0.1] }));
    expect(off.rgb).toEqual([0.3, 0.2, 0.1]);
  });

  it('is the chunk the legacy material runs: its constants, literal by literal', () => {
    expect(TEAM_MASK_FRAGMENT).toContain(`vec3( ${TEAM_LUMA_WEIGHTS.join(', ')} )`);
    expect(TEAM_MASK_FRAGMENT).toContain(`mix( 1.0, rlBakeY / uTeamLuma, ${TEAM_PANEL_GRIME} )`);
    expect(TEAM_MASK_FRAGMENT).toContain(`smoothstep( uMarkA.w - ${TEAM_NORMAL_SOFT}, uMarkA.w + ${TEAM_NORMAL_SOFT}, rlN.y )`);
    expect(MARK_MIN_WIDTH).toBe(1e-5);
    expect(TEAM_LUMA_WEIGHTS).toEqual([0.2126, 0.7152, 0.0722]);
  });
});

async function marked(d: UnitDeps): Promise<{ slots: TeamMaskSlots; variant: THREE.MeshStandardMaterial; twin: THREE.Material; mesh: THREE.Mesh }> {
  const slots = new TeamMaskSlots(['#2F6FD9', '#D93A2B', '#F2E8D5']);
  const variant = new VehicleTeamMaterials(slots).materialFor(laviMaterial(), 0) as THREE.MeshStandardMaterial;
  const twin = unitFactory(d)(variant);
  return { slots, variant, twin, mesh: new THREE.Mesh(taggedGeometry(0), twin) };
}

describe('G2: each mark input is wired, on program text', () => {
  it('the fragment reads every mark uniform, the kit taps 0..2, and the varyings of the GEOMETRY position and normal', async () => {
    const d = await unitDeps();
    const { twin, mesh } = await marked(d);
    const built = compile(d, mesh, twin);
    for (const name of ['uTeamColor', 'uTeamStrength', 'uTeamLuma', 'uMarkA', 'uMarkB', 'uMarkC', 'uMarkKit0', 'uMarkKit1', 'uMarkKit2', 'uMarkEdge']) {
      expect(built.usedFragment.has(uniformOf(twin, name)), `${name} is bound but the fragment never reads it`).toBe(true);
    }
    const frag = mainOf(built.fragment);
    // The three kit taps, every one, against the map uv.
    for (const i of [0, 1, 2]) expect(frag).toMatch(new RegExp(`step\\( uMarkB\\.w, length\\( vec2\\( \\( \\w+\\.x - uMarkKit${i}\\.x \\), \\( \\w+\\.y - uMarkKit${i}\\.y \\) \\) \\) \\)`));
    // The object-space varyings are the raw attributes (no matrix): the mark turns with the turret.
    const vert = mainOf(built.vertex);
    expect(vert).toMatch(/\bvMarkPos = position;/);
    expect(vert).toMatch(/\bvMarkNrm = normal;/);
    // The coverage's edge width is fwidth x uMarkEdge, per coordinate.
    expect(frag).toContain('fwidth( vMarkPos.x ) * uMarkEdge');
    expect(frag).toContain('fwidth( abs( vMarkPos.z ) ) * uMarkEdge');
    expect(frag).toContain('fwidth( vMarkPos.y ) * uMarkEdge');
  });

  it('every number uniform follows its record on a render update (the strength, the luma, the boxes, the edge)', async () => {
    const d = await unitDeps();
    const { variant, twin } = await marked(d);
    const rec = await import('./team-mask').then((m) => m.teamHookOf(variant));
    if (rec === undefined) throw new Error('spec: the variant has no hook');
    rec.luma.value = 0.25;
    rec.edgePx.value = 2;
    rec.a.value.set(1, 2, 3, 4);
    setTeamMaskPass(false);
    for (const name of ['uTeamStrength', 'uTeamLuma', 'uMarkA', 'uMarkEdge']) runUpdate(uniformOf(twin, name));
    expect(uniformOf(twin, 'uTeamStrength').value).toBe(0);
    expect(uniformOf(twin, 'uTeamLuma').value).toBe(0.25);
    expect(uniformOf(twin, 'uMarkEdge').value).toBe(2);
    expect((uniformOf(twin, 'uMarkA').value as THREE.Vector4).toArray()).toEqual([1, 2, 3, 4]);
    expect(MARK_EDGE_PX).toBe(1);
  });

  it('a material with no map draws no mark (the legacy #ifdef USE_MAP), and no mark uniform', async () => {
    const d = await unitDeps();
    const slots = new TeamMaskSlots(['#2F6FD9', '#D93A2B', '#F2E8D5']);
    const variant = new VehicleTeamMaterials(slots).materialFor(laviMaterial(), 0) as THREE.MeshStandardMaterial;
    variant.map = null;
    const twin = unitFactory(d)(variant);
    const built = compile(d, new THREE.Mesh(taggedGeometry(0), twin), twin);
    expect(built.fragment).not.toContain('uTeamColor');
  });
});

describe('G3: the slot colours and the shared strength, by reference', () => {
  it('after TeamMaskSlots.set and one render update the twin reads the new colour; the team-mask layer at 0 zeroes it', async () => {
    const d = await unitDeps();
    const { slots, twin } = await marked(d);
    const color = uniformOf(twin, 'uTeamColor');
    slots.set(['#FF0000', '#D93A2B', '#F2E8D5']);
    runUpdate(color);
    // #FF0000 is linear (1, 0, 0).
    expect((color.value as THREE.Vector3).toArray()).toEqual([1, 0, 0]);
    const strength = uniformOf(twin, 'uTeamStrength');
    setTeamMaskPass(false);
    runUpdate(strength);
    expect(strength.value).toBe(0);
    setTeamMaskPass(true);
    runUpdate(strength);
    expect(strength.value).toBe(TEAM_MASK_STRENGTH);
  });
});
