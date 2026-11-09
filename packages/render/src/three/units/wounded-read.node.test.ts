/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T4) gates for the wounded floor term of the node unit twin (`wounded-read.node.ts`), built by the backend's own factory
 * body from a REAL lifted material (`liftWoundedTemplate`), and compiled by three's `GLSLNodeBuilder`. Each gate has a one-line
 * falsification, run by hand and listed in the commit message:
 *  - G1 the floor on numbers (`floorOps` through `NUMBER_OPS`): drop the `0.7` fill, or take the gate from `lo` alone;
 *  - G2 each input is wired: bind `uWoundedFloor` / `uWoundedGateLo` / `uWoundedGateHi` by value;
 *  - G3 the floor is a post-lighting term: read the colour node for `out` (`const lit = ctx.color`) in `floorTerms`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NUMBER_OPS } from '../fog-ops';
import { WOUNDED_GATE_HI, WOUNDED_GATE_LO, WOUNDED_LIFT, floorOps, liftWoundedTemplate, setWoundedLift, woundedUniforms } from './wounded-read';
import { compile, laviMaterial, mainOf, runUpdate, taggedGeometry, uniformOf, unitDeps, unitFactory, type UnitDeps } from './unit-twin.test-support';

afterEach(() => {
  setWoundedLift(true);
  const u = woundedUniforms();
  u.lo.value = WOUNDED_GATE_LO;
  u.hi.value = WOUNDED_GATE_HI;
});

/** A lifted copy of a textured material, as `liftWoundedTemplate` makes it for a wounded template. */
function lifted(): THREE.MeshStandardMaterial {
  const g = new THREE.Group().add(new THREE.Mesh(taggedGeometry(0), laviMaterial()));
  liftWoundedTemplate(g);
  return (g.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
}

async function floorTwin(d: UnitDeps): Promise<{ twin: THREE.Material; mesh: THREE.Mesh }> {
  const twin = unitFactory(d)(lifted());
  return { twin, mesh: new THREE.Mesh(taggedGeometry(0), twin) };
}

describe('G1: the floor on numbers', () => {
  const run = (litLuma: number): number => {
    const out = floorOps(NUMBER_OPS, { diffuse: [0.5, 0.5, 0.5], out: [litLuma, litLuma, litLuma], floor: WOUNDED_LIFT, lo: WOUNDED_GATE_LO, hi: WOUNDED_GATE_HI });
    return out[0];
  };

  it('lit 0.1 under the floor 0.5 lifts a 0.5 albedo by 0.5 x (0.5 - 0.1) x 0.7 x (1 - smoothstep(0.05, 0.2, 0.1))', () => {
    // smoothstep = (1/3)^2 (3 - 2/3) = 0.259259; gate 0.740741; add 0.4 * 0.7 * 0.740741 = 0.207407; out 0.05 + 0.5 * 0.207407.
    expect(run(0.05)).toBeCloseTo(0.1537037, 6);
  });

  it('deep shadow (lit 0.01, gate 1) takes the whole 70% of the deficit; a lit body (lit 0.3, over the gate) is untouched', () => {
    expect(run(0.005)).toBeCloseTo(0.005 + 0.5 * 0.49 * 0.7, 12);
    expect(run(0.15)).toBe(0.15);
  });

  it('the albedo luma is floored at 0.02, and the lift is albedo-coloured', () => {
    const out = floorOps(NUMBER_OPS, { diffuse: [0.02, 0.0, 0.0], out: [0, 0, 0], floor: 0.5, lo: 0.05, hi: 0.2 });
    // albedoLuma = max(0.2126 * 0.02, 0.02) = 0.02, lit 0, gate 1: add 0.5 * 0.7 = 0.35 of the albedo, red only.
    expect(out[0]).toBeCloseTo(0.007, 12);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });
});

describe('G2: each floor input is wired, on program text and by reference', () => {
  it('the fragment reads uWoundedFloor, uWoundedGateLo and uWoundedGateHi', async () => {
    const d = await unitDeps();
    const { twin, mesh } = await floorTwin(d);
    const built = compile(d, mesh, twin);
    for (const name of ['uWoundedFloor', 'uWoundedGateLo', 'uWoundedGateHi']) {
      expect(built.usedFragment.has(uniformOf(twin, name)), `${name} is bound but the fragment never reads it`).toBe(true);
    }
    const frag = mainOf(built.fragment);
    expect(frag).toContain('uWoundedFloor - ');
    expect(frag).toContain('smoothstep( uWoundedGateLo, uWoundedGateHi, ');
  });

  it('each follows the shared uniform objects on a render update (the wounded-read layer, the tuning sweep)', async () => {
    const d = await unitDeps();
    const { twin } = await floorTwin(d);
    const u = woundedUniforms();
    setWoundedLift(false);
    u.lo.value = 0.07;
    u.hi.value = 0.31;
    for (const [name, want] of [['uWoundedFloor', 0], ['uWoundedGateLo', 0.07], ['uWoundedGateHi', 0.31]] as const) {
      const n = uniformOf(twin, name);
      runUpdate(n);
      expect(n.value, name).toBe(want);
    }
    setWoundedLift(true);
    const n = uniformOf(twin, 'uWoundedFloor');
    runUpdate(n);
    expect(n.value).toBe(WOUNDED_LIFT);
  });
});

describe('G3: the floor is a post-lighting term', () => {
  it('the floor reads the LIT output (`Output`), writes the fragment result, and leaves the colour node alone', async () => {
    const d = await unitDeps();
    const { twin, mesh } = await floorTwin(d);
    const frag = mainOf(compile(d, mesh, twin).fragment);
    // The albedo luma is the colour's, the light's luma is the lit output's.
    expect(frag).toMatch(/\( \( \( \( Output\.x \* 0\.2126 \) \+ \( Output\.y \* 0\.7152 \) \) \+ \( Output\.z \* 0\.0722 \) \) \/ max\( \( \( \( rlUnitColorMap\.x \* 0\.2126 \)/);
    expect(frag).toMatch(/fragColor = vec4\( vec3\( \( Output\.x \+ \( rlUnitColorMap\.x \* \w+ \) \)/);
    // The colour node is the map colour, untouched by the floor.
    expect(frag).toContain('DiffuseColor = rlUnitColorMap;');
    expect((twin as THREE.MeshStandardMaterial & { outputNode: unknown }).outputNode).not.toBeNull();
  });
});
