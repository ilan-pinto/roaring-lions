/**
 * GH-943 P3 (T14b, GH-1152) F2, the pure half: G2b (the verdict never skips a change) and the installer over fake render objects
 * (first sight, per-RENDER-OBJECT keys, the mode switch). The end-to-end half, on real unit twins compiled by three's builder, is
 * `refresh-policy.node.test.ts` (G2c and the reviewer's moving / fading pin).
 *
 * Falsifications (run by hand, in the commit message):
 *  - G2b: in `refreshVerdict`, return SHARED when only the LAST element differs (`i < now.length - 1`): the declared-input case
 *    (the last value of the key) reads SHARED and goes red;
 *  - per render object: key the WeakMap by `ro.object` instead of `ro`: the shadow render object of a moved mesh reads SHARED.
 */
import { describe, expect, it } from 'vitest';
import { classifyUpdateNodes, installRefreshPolicy, objectTextures, plainMesh, REFRESH, refreshVerdict, writeKey, type NodesLike, type RenderObjectLike, type UpdateNodeLike } from './refresh-policy';
import { ABSENT, declareObjectInputs, pushValue } from './object-inputs';

const key = (...v: number[]): number[] => v;

describe('refreshVerdict (G2b, pure records)', () => {
  const base = key(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1, 7, 0.5);
  it('parked and unchanged: SHARED', () => {
    expect(refreshVerdict(REFRESH.FULL, 'hasNode', base, base.slice())).toBe(REFRESH.SHARED);
  });
  it('every single element that moves gives FULL (matrix, versions, every declared input, the last included)', () => {
    for (let i = 0; i < base.length; i++) {
      const now = base.slice();
      now[i] = (now[i] as number) + 0.001;
      expect(refreshVerdict(REFRESH.FULL, 'hasNode', base, now), `element ${i}`).toBe(REFRESH.FULL);
    }
  });
  it('first sight, a key of another length, hasAnimation, other and ineligible give FULL', () => {
    expect(refreshVerdict(REFRESH.FULL, 'hasNode', null, base)).toBe(REFRESH.FULL);
    expect(refreshVerdict(REFRESH.FULL, 'hasNode', base, [...base, 0])).toBe(REFRESH.FULL);
    expect(refreshVerdict(REFRESH.FULL, 'hasAnimation', base, base)).toBe(REFRESH.FULL);
    expect(refreshVerdict(REFRESH.FULL, 'other', base, base)).toBe(REFRESH.FULL);
    expect(refreshVerdict(REFRESH.FULL, 'ineligible', base, base)).toBe(REFRESH.FULL);
  });
  it('never raises or lowers a verdict three did not make FULL', () => {
    expect(refreshVerdict(REFRESH.SHARED, 'hasNode', base, base)).toBe(REFRESH.SHARED);
    expect(refreshVerdict(REFRESH.NONE, 'hasNode', base, base)).toBe(REFRESH.NONE);
  });
  it('a NaN in the key never compares equal (FULL), and absent is a value', () => {
    expect(refreshVerdict(REFRESH.FULL, 'hasNode', [Number.NaN], [Number.NaN])).toBe(REFRESH.FULL);
    const a: number[] = [];
    pushValue(null, a);
    expect(a).toEqual([ABSENT]);
  });
});

describe('pushValue', () => {
  it('flattens numbers, booleans, colours, vectors, matrices, textures and arrays, and a texture version moves the key', () => {
    const out: number[] = [];
    pushValue(2, out);
    pushValue(true, out);
    pushValue({ isColor: true, r: 0.1, g: 0.2, b: 0.3 }, out);
    pushValue({ x: 1, y: 2, z: 3, w: 4 }, out);
    pushValue({ elements: [9, 8] }, out);
    pushValue({ isTexture: true, id: 5, version: 1 }, out);
    pushValue([{ x: 1, y: 0, z: 1, w: 0 }], out);
    expect(out).toEqual([2, 1, 0.1, 0.2, 0.3, 1, 2, 3, 4, 9, 8, 5, 1, 1, 1, 0, 1, 0]);
    const v2: number[] = [];
    pushValue({ isTexture: true, id: 5, version: 2 }, v2);
    expect(v2).toEqual([5, 2]);
  });
});

describe('classifyUpdateNodes (G2c, the rule)', () => {
  const singleton = { type: 'UniformNode', isUniformNode: true };
  it("three's matrix, reference and texture nodes, shared-group uniforms and declared names are keyed; anything else blocks", () => {
    const mine: UpdateNodeLike = { type: 'UniformNode', isUniformNode: true, name: 'NodeBuffer_7' };
    const decl = { nodes: new Set<unknown>([mine]), events: false, read: (): void => {} };
    const nodes: UpdateNodeLike[] = [
      { type: 'UniformGroupNode' },
      singleton,
      { type: 'ModelNode' },
      { type: 'Object3DNode', object3d: { matrixWorld: { elements: [1] } } },
      { type: 'MaterialReferenceNode' },
      { type: 'TextureNode', isTextureNode: true },
      { type: 'UniformNode', isUniformNode: true, groupNode: { shared: true }, name: 'uTime' },
      mine,
    ];
    const ok = classifyUpdateNodes(nodes, decl, new Set([singleton]));
    expect(ok.downgradable).toBe(true);
    expect(ok.object3dNodes).toHaveLength(1);
    expect(ok.referenceNodes).toHaveLength(1);
    // Declared by identity: a node of the same NAME that is not the declared one is not declared.
    const bad = classifyUpdateNodes([...nodes, { type: 'UniformNode', isUniformNode: true, name: 'uSecret' }, { type: 'EventNode' }], decl, new Set([singleton]));
    expect(classifyUpdateNodes([{ ...mine }], decl, new Set()).downgradable).toBe(false);
    expect(bad.downgradable).toBe(false);
    expect(bad.undeclared).toEqual(['UniformNode:uSecret', 'EventNode:?']);
    // The anonymous matrix uniform is keyed only as a named singleton.
    expect(classifyUpdateNodes([singleton], undefined, new Set()).undeclared).toEqual(['UniformNode:?']);
  });
});

describe('objectTextures and plainMesh', () => {
  it('reads the non-shared sampled textures; a storage buffer makes the object ineligible', () => {
    const t = { value: 1 };
    expect(objectTextures([{ bindings: [{ isSampledTexture: true, textureNode: t }, { isSampledTexture: true, textureNode: { value: 2 }, groupNode: { shared: true } }] }])).toEqual([t]);
    expect(objectTextures([{ bindings: [{ isStorageBuffer: true }] }])).toBeNull();
  });
  it('only a plain mesh', () => {
    const m = { matrixWorld: { elements: [] }, isMesh: true };
    expect(plainMesh(m)).toBe(true);
    expect(plainMesh({ ...m, isSkinnedMesh: true })).toBe(false);
    expect(plainMesh({ ...m, isInstancedMesh: true })).toBe(false);
    expect(plainMesh({ ...m, isBatchedMesh: true })).toBe(false);
    expect(plainMesh({ ...m, morphTargetInfluences: [0] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The installer, over fake render objects.

const identity = (): { elements: number[] } => ({ elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });

function fakeRo(object: RenderObjectLike['object'], material: { version: number }, camera: RenderObjectLike['camera'], nodes: UpdateNodeLike[] = [{ type: 'ModelNode' }]): RenderObjectLike {
  const state = { updateNodes: nodes };
  return {
    object,
    material,
    camera,
    geometry: { id: 1, index: null, attributes: { position: { version: 0 } }, drawRange: { start: 0, count: Infinity } },
    getMonitor: () => ({ hasNode: true, hasAnimation: false }),
    getNodeBuilderState: () => state,
    getBindings: () => [],
  };
}

function rig(mode: 'parked' | 'three' | 'unsafe-shared' = 'parked'): { nodes: NodesLike; handle: ReturnType<typeof installRefreshPolicy> } {
  const nodes: NodesLike = { needsRefresh: () => REFRESH.FULL };
  return { nodes, handle: installRefreshPolicy(nodes, {}, mode, new Set()) };
}

describe('installRefreshPolicy', () => {
  it('FULL at first sight and while the key is learnt, SHARED once parked; a moved object is FULL in BOTH of its render objects', () => {
    const { nodes } = rig();
    const object = { matrixWorld: identity(), isMesh: true };
    const material = { version: 0 };
    const sceneRo = fakeRo(object, material, { matrixWorld: identity(), projectionMatrix: identity() });
    const shadowRo = fakeRo(object, material, { matrixWorld: identity(), projectionMatrix: identity() });
    const frame = (): number[] => [nodes.needsRefresh(sceneRo), nodes.needsRefresh(shadowRo)];
    expect(frame()).toEqual([REFRESH.FULL, REFRESH.FULL]);
    expect(frame()).toEqual([REFRESH.FULL, REFRESH.FULL]);
    expect(frame()).toEqual([REFRESH.SHARED, REFRESH.SHARED]);
    object.matrixWorld.elements[12] = 3;
    expect(frame()).toEqual([REFRESH.FULL, REFRESH.FULL]);
    expect(frame()).toEqual([REFRESH.SHARED, REFRESH.SHARED]);
    material.version++;
    expect(frame()).toEqual([REFRESH.FULL, REFRESH.FULL]);
  });

  it('a camera move is FULL (the object group holds camera-derived matrices)', () => {
    const { nodes } = rig();
    const camera = { matrixWorld: identity(), projectionMatrix: identity() };
    const ro = fakeRo({ matrixWorld: identity(), isMesh: true }, { version: 0 }, camera);
    nodes.needsRefresh(ro);
    nodes.needsRefresh(ro);
    expect(nodes.needsRefresh(ro)).toBe(REFRESH.SHARED);
    camera.matrixWorld.elements[13] = 1;
    expect(nodes.needsRefresh(ro)).toBe(REFRESH.FULL);
  });

  it('a declared input that moves is FULL; an undeclared object uniform keeps the program FULL and is censused', () => {
    const { nodes, handle } = rig();
    const material = { version: 0 };
    const state = { opacity: 1 };
    const uOpacity: UpdateNodeLike = { type: 'UniformNode', isUniformNode: true, name: 'uOpacity' };
    declareObjectInputs(material, { nodes: new Set<unknown>([uOpacity]), events: false, read: (_o, out) => out.push(state.opacity) });
    const cam = { matrixWorld: identity(), projectionMatrix: identity() };
    const ro = fakeRo({ matrixWorld: identity(), isMesh: true }, material, cam, [uOpacity]);
    nodes.needsRefresh(ro);
    nodes.needsRefresh(ro);
    expect(nodes.needsRefresh(ro)).toBe(REFRESH.SHARED);
    state.opacity = 0.5;
    expect(nodes.needsRefresh(ro)).toBe(REFRESH.FULL);
    const blocked = fakeRo({ matrixWorld: identity(), isMesh: true }, { version: 0 }, cam, [{ type: 'UniformNode', isUniformNode: true, name: 'uSecret' }]);
    for (let i = 0; i < 4; i++) expect(nodes.needsRefresh(blocked)).toBe(REFRESH.FULL);
    expect(handle.undeclared()).toContain('UniformNode:uSecret');
  });

  it("'three' is three's verdict; a mode change starts every object from first sight; unsafe-shared skips the key", () => {
    const { nodes, handle } = rig('three');
    const object = { matrixWorld: identity(), isMesh: true };
    const ro = fakeRo(object, { version: 0 }, { matrixWorld: identity(), projectionMatrix: identity() });
    for (let i = 0; i < 4; i++) expect(nodes.needsRefresh(ro)).toBe(REFRESH.FULL);
    handle.setMode('parked');
    expect([nodes.needsRefresh(ro), nodes.needsRefresh(ro), nodes.needsRefresh(ro)]).toEqual([REFRESH.FULL, REFRESH.FULL, REFRESH.SHARED]);
    handle.setMode('unsafe-shared');
    nodes.needsRefresh(ro);
    object.matrixWorld.elements[12] = 9;
    expect(nodes.needsRefresh(ro)).toBe(REFRESH.SHARED);
    expect(handle.takeTally().downgraded).toBeGreaterThan(0);
  });

  it('a skinned mesh and a hasAnimation monitor are never downgraded; dispose puts needsRefresh back', () => {
    const { nodes, handle } = rig();
    const ro = fakeRo({ matrixWorld: identity(), isMesh: true, isSkinnedMesh: true }, { version: 0 }, { matrixWorld: identity(), projectionMatrix: identity() });
    for (let i = 0; i < 4; i++) expect(nodes.needsRefresh(ro)).toBe(REFRESH.FULL);
    const anim = { ...fakeRo({ matrixWorld: identity(), isMesh: true }, { version: 0 }, { matrixWorld: identity(), projectionMatrix: identity() }), getMonitor: () => ({ hasNode: true, hasAnimation: true }) };
    for (let i = 0; i < 4; i++) expect(nodes.needsRefresh(anim)).toBe(REFRESH.FULL);
    handle.dispose();
    expect(nodes.needsRefresh.name).not.toBe('');
    expect(nodes.needsRefresh(anim)).toBe(REFRESH.FULL);
    expect(handle.takeTally().full).toBe(8);
  });

  it('writeKey holds the attribute versions (a dynamic attribute write is FULL)', () => {
    const ro = fakeRo({ matrixWorld: identity(), isMesh: true }, { version: 0 }, { matrixWorld: identity(), projectionMatrix: identity() });
    const plan = classifyUpdateNodes([], undefined, new Set());
    const a: number[] = [];
    writeKey(ro, plan, [], a);
    (ro.geometry.attributes.position as { version: number }).version = 4;
    const b: number[] = [];
    writeKey(ro, plan, [], b);
    expect(refreshVerdict(REFRESH.FULL, 'hasNode', a, b)).toBe(REFRESH.FULL);
  });
});
