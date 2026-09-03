/**
 * The visual gate's toggle seam, pinned where it is implemented.
 *
 * `tools/src/golden-diff/baseline.test.ts` checks the other end -- that every
 * layer the gate declares is a name this module knows. This file checks that a
 * name the gate uses actually reaches a scene object, which is the half a
 * string-matching test cannot see. Both halves matter: a check that toggles
 * nothing reads as a layer that draws nothing, and would fail the gate on a
 * healthy tree; a check that toggles the wrong thing passes on a broken one.
 *
 * `new THREE.WebGLRenderer(...)` cannot construct under this suite's headless
 * `environment: 'node'`, so the same `vi.mock` stand-in `ThreeRenderer.test.ts`
 * established is used here, for the same reason and with the same scope.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { DEBUG_LAYERS, isDebugLayer, unknownDebugLayerMessage } from './debug-layers';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone',
};

function makeOpts(): RendererOptions {
  return {
    background: '#14150F',
    teamColors: ['#C8B494', '#6E7449', '#8E9491'],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#C8B494', '#6E7449', '#8E9491', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: TONES,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
  };
}

function makeRenderer(): ThreeRenderer {
  return new ThreeRenderer(new Sim({ seed: 1, width: 4, height: 4, capacity: 1 }), makeOpts());
}

/** Reaches the private fields the same way `ThreeRenderer.test.ts` reaches
 *  `fogMesh`: there is no public accessor, and adding one purely for a test
 *  would widen `Renderer`'s surface for no runtime reason. */
function internals(r: ThreeRenderer): {
  scatterMesh: THREE.Object3D | null;
  decorGroup: THREE.Object3D | null;
  texturedDecorGroup: THREE.Object3D | null;
  structureBoxes: Map<number, THREE.Object3D>;
  buildingMeshIdleEntities: Map<number, THREE.Object3D>;
  groundMat: THREE.ShaderMaterial;
} {
  return r as unknown as ReturnType<typeof internals>;
}

describe('DEBUG_LAYERS', () => {
  it('rejects a name it does not know, loudly and by name', () => {
    // The distinction this preserves: an unknown name must NOT return 0
    // objects, because 0 is also what a real layer with nothing on screen
    // returns, and the gate would read a typo as "this layer draws nothing".
    const r = makeRenderer();
    expect(() => r.setDebugLayerVisible('scater', false)).toThrow(/unknown layer "scater"/);
    expect(unknownDebugLayerMessage('x')).toContain(DEBUG_LAYERS.join(', '));
    expect(isDebugLayer('scatter')).toBe(true);
    expect(isDebugLayer('units')).toBe(false);
    r.dispose();
  });

  it('flips visibility on the real scatter mesh, and back', () => {
    const r = makeRenderer();
    const i = internals(r);
    i.scatterMesh = new THREE.Mesh();
    expect(r.setDebugLayerVisible('scatter', false)).toBe(1);
    expect(i.scatterMesh.visible).toBe(false);
    expect(r.setDebugLayerVisible('scatter', true)).toBe(1);
    expect(i.scatterMesh.visible).toBe(true);
    r.dispose();
  });

  it('covers BOTH decor batches under one name, because one authoring fault empties both', () => {
    // `decor-place.ts`'s `familyFor` feeds the palette batch and the textured
    // batch alike. A toggle that hid only one would leave a real erasure
    // half-visible and the delta above the floor.
    const r = makeRenderer();
    const i = internals(r);
    i.decorGroup = new THREE.Group();
    i.texturedDecorGroup = new THREE.Group();
    expect(r.setDebugLayerVisible('decor', false)).toBe(2);
    expect(i.decorGroup.visible).toBe(false);
    expect(i.texturedDecorGroup.visible).toBe(false);
    r.dispose();
  });

  it('reaches every building collection, palette boxes and mesh clones alike', () => {
    const r = makeRenderer();
    const i = internals(r);
    i.structureBoxes.set(0, new THREE.Mesh());
    i.buildingMeshIdleEntities.set(1, new THREE.Object3D());
    expect(r.setDebugLayerVisible('buildings', false)).toBe(2);
    expect(i.structureBoxes.get(0)?.visible).toBe(false);
    expect(i.buildingMeshIdleEntities.get(1)?.visible).toBe(false);
    r.dispose();
  });

  it('counts zero, without throwing, for a layer nothing has built yet', () => {
    // A scenario that frames no building must be able to run the toggle and
    // read a zero PIXEL delta -- the honest reading -- rather than crash the
    // capture. (Which is also why no scenario declares `buildings` where the
    // measured delta is 0.)
    const r = makeRenderer();
    expect(r.setDebugLayerVisible('scatter', false)).toBe(0);
    expect(r.setDebugLayerVisible('buildings', false)).toBe(0);
    r.dispose();
  });

  it('drives the ground albedo to the material\'s own fail-soft path, and restores the loaded gains', () => {
    // Not a visibility flag: strength 0 is exactly what a 404 leaves behind
    // (`loadGroundTexture`), so this measures the shipped tiles' whole
    // contribution over the flat palette tone. Restoring must put back the
    // image's OWN gain, never 1 -- getting that wrong would leave the ground
    // permanently over- or under-driven for every later scenario in the run.
    const r = makeRenderer();
    const i = internals(r);
    i.groundMat.uniforms.uSandStrength.value = 0.7;
    i.groundMat.uniforms.uRockStrength.value = 0.4;
    expect(r.setDebugLayerVisible('ground-albedo', false)).toBe(5);
    expect(i.groundMat.uniforms.uSandStrength.value).toBe(0);
    expect(i.groundMat.uniforms.uRockStrength.value).toBe(0);
    r.setDebugLayerVisible('ground-albedo', true);
    expect(i.groundMat.uniforms.uSandStrength.value).toBe(0.7);
    expect(i.groundMat.uniforms.uRockStrength.value).toBe(0.4);
    r.dispose();
  });

  it('does not stash a set of zeroes when hidden twice', () => {
    // The idempotence that matters: a second hide must not overwrite the
    // stashed gains with the zeroes it just wrote, or restoring would leave the
    // ground flat for the rest of the run and every later ground-albedo check
    // would read a delta of nothing -- a red gate with no defect behind it.
    const r = makeRenderer();
    const i = internals(r);
    i.groundMat.uniforms.uSandStrength.value = 0.7;
    r.setDebugLayerVisible('ground-albedo', false);
    r.setDebugLayerVisible('ground-albedo', false);
    r.setDebugLayerVisible('ground-albedo', true);
    expect(i.groundMat.uniforms.uSandStrength.value).toBe(0.7);
    r.dispose();
  });
});
