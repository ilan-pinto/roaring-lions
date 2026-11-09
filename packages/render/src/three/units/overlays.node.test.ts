/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T8) gates for `overlays.node.ts`: the overlay batch's node twin. The graph is compiled to GLSL by three's own
 * `GLSLNodeBuilder` (no GPU) on the REAL batch's mesh. Each spec names its one-line falsification, run by hand and listed in the
 * commit message.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { adoptMaterials, createTwinCache, legacyTwinSlot, NULL_P3_SLOTS } from '../node-material-adoption';
import { censusUnported, PORTED_MATERIAL_KEYS } from '../backend/unported';
import { RENDER_STATE_KEYS } from '../twin-identity';
import { batchDeps, compileMesh } from '../batch-twin-compile.test-support';
import { OverlayBatch } from './overlays';
import { createNodeOverlayMaterial, NODE_OVERLAY_MATERIAL_NAME } from './overlays.node';

const legacyOf = (b: OverlayBatch): THREE.ShaderMaterial => b.mesh.material as THREE.ShaderMaterial;

async function adopted(): Promise<{ batch: OverlayBatch; root: THREE.Group; legacy: THREE.ShaderMaterial; calls: number }> {
  const d = await batchDeps();
  const batch = new OverlayBatch(120);
  const legacy = legacyOf(batch);
  const root = new THREE.Group();
  root.add(batch.mesh);
  let calls = 0;
  const kit = {
    ...NULL_P3_SLOTS,
    ground: null,
    foliage: null,
    ring: null,
    overlay: () => {
      calls++;
      return createNodeOverlayMaterial(d);
    },
  };
  adoptMaterials(root, kit, createTwinCache());
  return { batch, root, legacy, calls };
}

describe('the twin graph', () => {
  it('G2: aColor is the colour and aAlpha the alpha, each read from its own attribute through its own varying', async () => {
    const { batch } = await adopted();
    const { vertex, glsl } = await compileMesh(batch.mesh);
    // Each attribute reaches a varying in the vertex stage; the fragment stage reads THOSE.
    const color = /(nodeVarying\d+) = aColor;/.exec(vertex);
    const alpha = /(nodeVarying\d+) = aAlpha;/.exec(vertex);
    expect(color, 'aColor never reaches a varying').not.toBeNull();
    expect(alpha, 'aAlpha never reaches a varying').not.toBeNull();
    expect(glsl).toContain(`DiffuseColor = vec4( ${(color as RegExpExecArray)[1]}, 1.0 );`);
    expect(glsl).toContain(`DiffuseColor.w = ( DiffuseColor.w * ${(alpha as RegExpExecArray)[1]} );`);
    // Plain "over": nothing else touches the colour (no discard, no lighting term, no uniform).
    expect(glsl).not.toContain('discard');
  });

  it('is the census-named node twin, with no normal and no uniform of its own', async () => {
    const { batch } = await adopted();
    expect((batch.mesh.material as THREE.Material).name).toBe(NODE_OVERLAY_MATERIAL_NAME);
    expect(batch.mesh.geometry.getAttribute('normal')).toBeUndefined();
    const { used } = await compileMesh(batch.mesh);
    expect(used.size).toBe(0);
  });
});

describe('G3: the overlay draws over everything', () => {
  it('the twin carries the legacy pipeline state through adoption: depthTest and depthWrite off, normal blend, transparent, double-sided', async () => {
    const { batch, legacy } = await adopted();
    const twin = batch.mesh.material as THREE.Material;
    expect(legacy.depthTest).toBe(false);
    expect(twin).not.toBe(legacy);
    // The brief's value, not the legacy field read back: the overlay is a faithful port of the un-occluded unit layer.
    expect(twin.depthTest).toBe(false);
    expect(twin.depthWrite).toBe(false);
    expect(twin.blending).toBe(THREE.NormalBlending);
    expect(twin.transparent).toBe(true);
    expect(twin.side).toBe(THREE.DoubleSide);
  });

  it('depthTest is one of the render-state keys adoption copies (the key is what carries it)', () => {
    expect(RENDER_STATE_KEYS).toContain('depthTest');
    expect(RENDER_STATE_KEYS).toContain('depthWrite');
  });
});

describe('adoption and the census', () => {
  it('the legacy material is keyed rl-overlay, on the overlay slot, and listed as ported', () => {
    const legacy = legacyOf(new OverlayBatch(12));
    expect(legacy.name).toBe('rl-overlay');
    expect(legacyTwinSlot(legacy)).toBe('overlay');
    expect(PORTED_MATERIAL_KEYS.has('rl-overlay')).toBe(true);
  });

  it('L-matched keeps the legacy overlay visible with the ported keys; without them the census hides and names it', () => {
    const b = new OverlayBatch(12);
    b.mesh.visible = true;
    const scene = new THREE.Scene();
    scene.add(b.mesh);
    expect(censusUnported(scene, { portedKeys: PORTED_MATERIAL_KEYS })).toEqual([]);
    expect(b.mesh.visible).toBe(true);
    expect(censusUnported(scene).map((h) => h.key)).toEqual(['rl-overlay']);
    expect(b.mesh.visible).toBe(false);
  });

  it('adoption swaps the mesh to the twin once, and the legacy object keeps its state', async () => {
    const { calls, legacy } = await adopted();
    expect(calls).toBe(1);
    expect(legacy.depthTest).toBe(false);
  });
});
