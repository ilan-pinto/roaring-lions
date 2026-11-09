/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T8) gates for `trail-mesh.node.ts`: the tunnel trail's node twin. The graph is compiled to GLSL by three's own
 * `GLSLNodeBuilder` (no GPU) on the REAL instanced mesh. Each spec names its one-line falsification, run by hand and listed in the
 * commit message.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { adoptMaterials, createTwinCache, legacyTwinSlot, NULL_P3_SLOTS } from './node-material-adoption';
import { censusUnported, PORTED_MATERIAL_KEYS } from './backend/unported';
import { batchDeps, compileMesh } from './batch-twin-compile.test-support';
import { TrailMesh } from './trail-mesh';
import { createNodeTrailMaterial, NODE_TRAIL_MATERIAL_NAME, TRAIL_BOUND_KEY, type TrailTwinBound, type TrailUniformRecord } from './trail-mesh.node';
import { hexToLinear } from './terrain/shared';

async function adopted(): Promise<{ trail: TrailMesh; legacy: THREE.ShaderMaterial; twin: THREE.Material }> {
  const d = await batchDeps();
  const trail = new TrailMesh(4, 4, '#aa8855');
  const legacy = trail.mesh.material as THREE.ShaderMaterial;
  const root = new THREE.Group();
  root.add(trail.mesh);
  const kit = { ...NULL_P3_SLOTS, ground: null, foliage: null, ring: null, trail: (l: THREE.ShaderMaterial) => createNodeTrailMaterial(d, l.uniforms as unknown as TrailUniformRecord) };
  adoptMaterials(root, kit, createTwinCache());
  return { trail, legacy, twin: trail.mesh.material as THREE.Material };
}

describe('G2: the colour uniform and the per-instance alpha are wired, on program text', () => {
  it('uColor is the colour and aAlpha (an INSTANCE attribute) the alpha', async () => {
    const { trail, twin } = await adopted();
    const { vertex, glsl, used } = await compileMesh(trail.mesh);
    const alpha = /(nodeVarying\d+) = aAlpha;/.exec(vertex);
    expect(alpha, 'aAlpha never reaches a varying').not.toBeNull();
    expect(glsl).toContain(`DiffuseColor.w = ( DiffuseColor.w * ${(alpha as RegExpExecArray)[1]} );`);
    const bound = twin.userData[TRAIL_BOUND_KEY] as TrailTwinBound;
    expect(used.has(bound.uColor), 'uColor is bound but the graph never reads it').toBe(true);
    expect(glsl).toMatch(/DiffuseColor = vec4\( nodeUniform\d+, 1\.0 \);/);
    // The instance transform is applied (the legacy vertex shader multiplies instanceMatrix in).
    expect(vertex).toMatch(/gl_InstanceID/);
  });

  it('the colour is the legacy uColor vector BY REFERENCE: a write to the legacy record reaches the twin', async () => {
    const { legacy, twin } = await adopted();
    const bound = twin.userData[TRAIL_BOUND_KEY] as TrailTwinBound;
    const v = bound.uColor.value as THREE.Vector3;
    expect([v.x, v.y, v.z]).toEqual(hexToLinear('#aa8855'));
    (legacy.uniforms.uColor.value as THREE.Vector3).set(0.25, 0.5, 0.75);
    expect([v.x, v.y, v.z]).toEqual([0.25, 0.5, 0.75]);
  });
});

describe('G3: the legacy state reaches the twin', () => {
  it('normal blend, depth-tested, not depth-writing, front faces only', async () => {
    const { legacy, twin } = await adopted();
    expect(twin.name).toBe(NODE_TRAIL_MATERIAL_NAME);
    expect(twin).not.toBe(legacy);
    expect(twin.transparent).toBe(true);
    expect(twin.depthTest).toBe(true);
    expect(twin.depthWrite).toBe(false);
    expect(twin.blending).toBe(THREE.NormalBlending);
    expect(twin.side).toBe(THREE.FrontSide);
  });
});

describe('adoption and the census', () => {
  it('the legacy material is keyed rl-trail, on the trail slot, listed as ported; L-matched keeps it visible', () => {
    const t = new TrailMesh(4, 4, '#aa8855');
    const legacy = t.mesh.material as THREE.ShaderMaterial;
    expect(legacy.name).toBe('rl-trail');
    expect(legacyTwinSlot(legacy)).toBe('trail');
    expect(PORTED_MATERIAL_KEYS.has('rl-trail')).toBe(true);
    t.mesh.visible = true;
    const scene = new THREE.Scene();
    scene.add(t.mesh);
    expect(censusUnported(scene, { portedKeys: PORTED_MATERIAL_KEYS })).toEqual([]);
    expect(t.mesh.visible).toBe(true);
    expect(censusUnported(scene).map((h) => h.key)).toEqual(['rl-trail']);
  });
});
