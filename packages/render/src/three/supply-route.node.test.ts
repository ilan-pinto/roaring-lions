/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T8) gates for `supply-route.node.ts`: the world supply route's node twin, and `dashOps`, the dash maths it shares with
 * the legacy file. The graph is compiled to GLSL by three's own `GLSLNodeBuilder` (no GPU) on the REAL route mesh. Each spec names
 * its one-line falsification, run by hand and listed in the commit message.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NUMBER_OPS } from './fog-ops';
import { MATERIAL_MATHS } from './material-maths';
import { adoptMaterials, createTwinCache, legacyTwinSlot, NULL_P3_SLOTS } from './node-material-adoption';
import { censusUnported, PORTED_MATERIAL_KEYS } from './backend/unported';
import { batchDeps, compileMesh } from './batch-twin-compile.test-support';
import { createSupplyRouteMaterial, SupplyRouteMesh } from './supply-route';
import { dashOps } from './supply-route-maths';
import { createNodeSupplyRouteMaterial, NODE_SUPPLY_ROUTE_MATERIAL_NAME, SUPPLY_ROUTE_BOUND_KEY, type SupplyRouteTwinBound, type SupplyRouteUniformRecord } from './supply-route.node';
import { hexToLinear } from './terrain/shared';

// LITERALS, never imported from the code under test: the cut stretch dashes with a 0.5-tile period and 55% duty.
const keep = (dist: number, cut: number): number => dashOps(NUMBER_OPS, dist, cut);

describe('G1: the dash maths on numbers, at literal distances', () => {
  it('the cut stretch keeps the first 55% of each 0.5-tile period and drops the rest', () => {
    // 0.25 tiles is half a period (fract 0.5): inside the duty. 0.4 is 0.8 of a period: in the gap.
    expect(keep(0.25, 1)).toBe(1);
    expect(keep(0.4, 1)).toBe(0);
    // The next period.
    expect(keep(0.5 + 0.25, 1)).toBe(1);
    expect(keep(0.5 + 0.4, 1)).toBe(0);
  });

  it('the duty is the share DRAWN: 0.55 of the period, strict, so a fragment exactly at the duty is kept', () => {
    // fract = 0.5 is under 0.55 and over 0.45: the duty read as 1 - duty would drop it.
    expect(keep(0.25, 1)).toBe(1);
    expect(keep(0.275, 1)).toBe(1);
    expect(keep(0.2751, 1)).toBe(0);
    // And the start of a period is drawn (fract 0).
    expect(keep(0, 1)).toBe(1);
  });

  it('the open line never dashes, whatever the distance, and the cut flag is > 0.5', () => {
    for (const d of [0.1, 0.4, 0.45, 0.9, 12.34]) expect(keep(d, 0), `dist ${d}`).toBe(1);
    expect(keep(0.4, 0.5)).toBe(1);
    expect(keep(0.4, 0.5001)).toBe(0);
  });
});

const W = 8;
const ROUTE = { tiles: [W * 2 + 1, W * 2 + 2, W * 2 + 3, W * 2 + 4], cutSpan: [1, 2] as const };

async function routeMesh(): Promise<{ route: SupplyRouteMesh; mesh: THREE.Mesh; legacy: THREE.ShaderMaterial; twin: THREE.Material }> {
  const d = await batchDeps();
  const route = new SupplyRouteMesh();
  route.set([ROUTE]);
  expect(route.sync(W, () => 0)).toBe(true);
  const mesh = route.group.children[0] as THREE.Mesh;
  const legacy = mesh.material as THREE.ShaderMaterial;
  const kit = {
    ...NULL_P3_SLOTS,
    ground: null,
    foliage: null,
    ring: null,
    supplyRoute: (l: THREE.ShaderMaterial) => createNodeSupplyRouteMaterial({ ...d, maths: MATERIAL_MATHS.supplyRoute }, l.uniforms as unknown as SupplyRouteUniformRecord),
  };
  adoptMaterials(route.group, kit, createTwinCache());
  return { route, mesh, legacy, twin: mesh.material as THREE.Material };
}

describe('G2: each attribute and uniform is wired, on program text', () => {
  it('aDist reaches the dash\'s fract(dist / 0.5) > 0.55 and aCut gates it and picks the colour; a failed test discards', async () => {
    const { mesh, twin } = await routeMesh();
    const { vertex, glsl, names } = await compileMesh(mesh);
    const cut = /(nodeVarying\d+) = aCut;/.exec(vertex);
    const dist = /(nodeVarying\d+) = aDist;/.exec(vertex);
    expect(cut, 'aCut never reaches a varying').not.toBeNull();
    expect(dist, 'aDist never reaches a varying').not.toBeNull();
    const c = (cut as RegExpExecArray)[1];
    const d = (dist as RegExpExecArray)[1];
    expect(glsl).toContain(`0.55 < fract( ( ${d} / 0.5 ) )`);
    expect(glsl).toContain(`( 0.5 < ${c} )`);
    expect(glsl).toContain('discard;');
    // The colour: the cut colour on the cut flag, the open colour otherwise.
    const bound = twin.userData[SUPPLY_ROUTE_BOUND_KEY] as SupplyRouteTwinBound;
    const open = names.get(bound.uOpen);
    const cutName = names.get(bound.uCut);
    expect(open, 'uOpen has no GLSL name').toBeDefined();
    expect(cutName, 'uCut has no GLSL name').toBeDefined();
    expect(glsl).toMatch(new RegExp(`if \\( \\( ${c} > 0\\.5 \\) \\) \\{\\s*(nodeVar\\d+) = ${cutName};\\s*\\} else \\{\\s*\\1 = ${open};`));
    expect(glsl).toContain('DiffuseColor.w = ( DiffuseColor.w * 0.9 );');
  });

  it('uOpen and uCut both reach the fragment, as distinct uniforms', async () => {
    const { mesh, twin } = await routeMesh();
    const bound = twin.userData[SUPPLY_ROUTE_BOUND_KEY] as SupplyRouteTwinBound;
    const { used } = await compileMesh(mesh);
    expect(used.has(bound.uOpen), 'uOpen is bound but the graph never reads it').toBe(true);
    expect(used.has(bound.uCut), 'uCut is bound but the graph never reads it').toBe(true);
    expect(bound.uOpen).not.toBe(bound.uCut);
  });
});

describe('G3: the legacy state reaches the twin', () => {
  it('normal blend, depth-tested, not depth-writing, the decal polygon offset, double-sided, no normal', async () => {
    const { mesh, legacy, twin } = await routeMesh();
    expect(twin.name).toBe(NODE_SUPPLY_ROUTE_MATERIAL_NAME);
    expect(twin).not.toBe(legacy);
    expect(twin.transparent).toBe(true);
    expect(twin.depthTest).toBe(true);
    expect(twin.depthWrite).toBe(false);
    expect(twin.polygonOffset).toBe(true);
    expect([twin.polygonOffsetFactor, twin.polygonOffsetUnits]).toEqual([legacy.polygonOffsetFactor, legacy.polygonOffsetUnits]);
    expect(twin.side).toBe(THREE.DoubleSide);
    expect(mesh.geometry.getAttribute('normal')).toBeUndefined();
  });
});

describe('G4: the colours follow setColors', () => {
  const vec = (n: unknown): [number, number, number] => {
    const v = (n as { value: THREE.Vector3 }).value;
    return [v.x, v.y, v.z];
  };

  it('after setColors the twin reads the NEW colours, and again after a second call', async () => {
    const { route, twin } = await routeMesh();
    const bound = twin.userData[SUPPLY_ROUTE_BOUND_KEY] as SupplyRouteTwinBound;
    // Before: the legacy material's white defaults.
    expect(vec(bound.uOpen)).toEqual([1, 1, 1]);
    route.setColors('#ff8000', '#0040ff');
    expect(vec(bound.uOpen)).toEqual(hexToLinear('#ff8000'));
    expect(vec(bound.uCut)).toEqual(hexToLinear('#0040ff'));
    // A colour-vision switch: the second write reaches a route already drawn.
    route.setColors('#00ff00', '#ff0000');
    expect(vec(bound.uOpen)).toEqual(hexToLinear('#00ff00'));
    expect(vec(bound.uCut)).toEqual(hexToLinear('#ff0000'));
    // The two colours are different values (a swapped pair would still be "new").
    expect(vec(bound.uOpen)).not.toEqual(vec(bound.uCut));
  });
});

describe('the mesh and the census', () => {
  it('sync says whether it made a NEW mesh: yes for a new set, no for the same set, no for null', () => {
    const route = new SupplyRouteMesh();
    expect(route.sync(W, () => 0)).toBe(false);
    const set = [ROUTE];
    route.set(set);
    expect(route.sync(W, () => 0)).toBe(true);
    route.set(set);
    expect(route.sync(W, () => 0)).toBe(false);
    route.set([{ tiles: [W * 5 + 1, W * 5 + 2], cutSpan: null }]);
    expect(route.sync(W, () => 0)).toBe(true);
    route.set(null);
    expect(route.sync(W, () => 0)).toBe(false);
    expect(route.group.children).toHaveLength(0);
  });

  it('the legacy material is keyed rl-supply-route, on the supplyRoute slot, listed as ported; L-matched keeps it visible', () => {
    const legacy = createSupplyRouteMaterial();
    expect(legacy.name).toBe('rl-supply-route');
    expect(legacyTwinSlot(legacy)).toBe('supplyRoute');
    expect(PORTED_MATERIAL_KEYS.has('rl-supply-route')).toBe(true);
    const route = new SupplyRouteMesh();
    route.set([ROUTE]);
    route.sync(W, () => 0);
    const scene = new THREE.Scene();
    scene.add(route.group);
    expect(censusUnported(scene, { portedKeys: PORTED_MATERIAL_KEYS })).toEqual([]);
    expect((route.group.children[0] as THREE.Mesh).visible).toBe(true);
    expect(censusUnported(scene).map((h) => h.key)).toEqual(['rl-supply-route']);
  });

  it('the legacy fragment text still carries the constants dashOps reads (the two cannot drift)', () => {
    const f = createSupplyRouteMaterial().fragmentShader;
    expect(f).toContain('fract(vDist / 0.500000) > 0.550000');
    expect(f).toContain('0.900000');
  });
});
