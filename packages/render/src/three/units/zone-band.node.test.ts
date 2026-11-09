/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T8) gates for `zone-band.node.ts`: the zone band's node twin, and `zoneHatchOps`, the hatch maths it shares with the
 * legacy file. The graph is compiled to GLSL by three's own `GLSLNodeBuilder` (no GPU) on the REAL batch's mesh. Each spec names its
 * one-line falsification, run by hand and listed in the commit message.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NUMBER_OPS } from '../fog-ops';
import { MATERIAL_MATHS } from '../material-maths';
import { adoptMaterials, createTwinCache, legacyTwinSlot, NULL_P3_SLOTS } from '../node-material-adoption';
import { censusUnported, PORTED_MATERIAL_KEYS } from '../backend/unported';
import { batchDeps, compileMesh } from '../batch-twin-compile.test-support';
import { createZoneBandMaterial, zoneHatchOps, ZoneBandBatch } from './zone-band';
import { createNodeZoneBandMaterial, NODE_ZONE_BAND_MATERIAL_NAME } from './zone-band.node';

// LITERALS, never imported from the code under test: the hatch is a 0.45-tile period along x + z, a soft stripe over the first half.
const stripe = (x: number, z: number): number => zoneHatchOps(NUMBER_OPS, x, z);

describe('G1: the hatch maths on numbers, at literal world points', () => {
  it('is a full stripe over the first half of each 0.45 period and nothing over the second', () => {
    // x + z = 0.1125 is a quarter of the period (s = 0.25): inside the stripe. 0.3375 is three quarters (s = 0.75): outside.
    expect(stripe(0.1125, 0)).toBeCloseTo(1, 12);
    expect(stripe(0.3375, 0)).toBeCloseTo(0, 12);
    // The next period, shifted by exactly 0.45.
    expect(stripe(0.45 + 0.1125, 0)).toBeCloseTo(1, 9);
    expect(stripe(0.45 + 0.3375, 0)).toBeCloseTo(0, 9);
  });

  it('runs along x + z: every point with one sum reads one value, and (x, z) is symmetric', () => {
    expect(stripe(0.1, 0.0125)).toBeCloseTo(stripe(0.1125, 0), 12);
    expect(stripe(0, 0.1125)).toBeCloseTo(stripe(0.1125, 0), 12);
    // x + z = 0.2875 (s = 0.639) is outside the stripe; x - z = 0.1125 would be inside it.
    expect(stripe(0.2, 0.0875)).toBeCloseTo(0, 12);
  });

  it('the stripe\'s edges are soft: halfway up the rise at s = 0.03 and halfway down the fall at s = 0.47', () => {
    expect(stripe(0.03 * 0.45, 0)).toBeCloseTo(0.5, 9);
    expect(stripe(0.47 * 0.45, 0)).toBeCloseTo(0.5, 9);
    // The very start of a period is closed (smoothstep(0, 0.06, 0) = 0).
    expect(stripe(0, 0)).toBeCloseTo(0, 12);
  });
});

async function adopted(): Promise<{ batch: ZoneBandBatch; legacy: THREE.ShaderMaterial }> {
  const d = await batchDeps();
  const batch = new ZoneBandBatch(60);
  const legacy = batch.mesh.material as THREE.ShaderMaterial;
  const root = new THREE.Group();
  root.add(batch.mesh);
  const kit = {
    ...NULL_P3_SLOTS,
    ground: null,
    foliage: null,
    ring: null,
    zoneBand: () => createNodeZoneBandMaterial({ ...d, maths: MATERIAL_MATHS.zoneBand }),
  };
  adoptMaterials(root, kit, createTwinCache());
  return { batch, legacy };
}

describe('G2: each attribute and the world position are wired, on program text', () => {
  it('the hatch reads the WORLD x and z, a period of 0.45, and the soft stripe edges', async () => {
    const { batch } = await adopted();
    const { glsl } = await compileMesh(batch.mesh);
    // Falsify: positionLocal for positionWorld (the hatch would move with the mesh).
    expect(glsl).toMatch(/fract\( \( \( v_positionWorld\.x \+ v_positionWorld\.z \) \/ 0\.45 \) \)/);
    expect(glsl).toContain('smoothstep( 0.0, 0.06,');
    expect(glsl).toContain('smoothstep( 0.44, 0.5,');
  });

  it('aColor is the colour mixed in and aAlpha scales the stripe: mix(1, colour, alpha * stripe), opaque alpha', async () => {
    const { batch } = await adopted();
    const { vertex, glsl } = await compileMesh(batch.mesh);
    const color = /(nodeVarying\d+) = aColor;/.exec(vertex);
    const alpha = /(nodeVarying\d+) = aAlpha;/.exec(vertex);
    expect(color, 'aColor never reaches a varying').not.toBeNull();
    expect(alpha, 'aAlpha never reaches a varying').not.toBeNull();
    const c = (color as RegExpExecArray)[1];
    const a = (alpha as RegExpExecArray)[1];
    expect(glsl).toMatch(new RegExp(`mix\\( vec3\\( 1\\.0, 1\\.0, 1\\.0 \\), ${c}, \\( ${a} \\* \\( smoothstep`));
    // The legacy fragment writes alpha 1: a multiply onto the ground must not fade out through the blend's alpha.
    expect(glsl).toMatch(/DiffuseColor = vec4\( mix\(.*, 1\.0 \);/);
    expect(glsl).toContain('DiffuseColor.w = ( DiffuseColor.w * 1.0 );');
    expect(glsl).not.toContain('discard');
  });
});

describe('G3: the legacy blend and depth state reach the twin', () => {
  it('the decal multiply (DstColor x Zero, alpha kept), depth-tested, not depth-writing, the decal polygon offset, double-sided', async () => {
    const { batch, legacy } = await adopted();
    const twin = batch.mesh.material as THREE.Material;
    expect(twin.name).toBe(NODE_ZONE_BAND_MATERIAL_NAME);
    expect(twin).not.toBe(legacy);
    expect(twin.blending).toBe(THREE.CustomBlending);
    expect([twin.blendSrc, twin.blendDst, twin.blendSrcAlpha, twin.blendDstAlpha]).toEqual([
      THREE.DstColorFactor,
      THREE.ZeroFactor,
      THREE.ZeroFactor,
      THREE.OneFactor,
    ]);
    expect(twin.depthTest).toBe(true);
    expect(twin.depthWrite).toBe(false);
    expect(twin.polygonOffset).toBe(true);
    expect([twin.polygonOffsetFactor, twin.polygonOffsetUnits]).toEqual([legacy.polygonOffsetFactor, legacy.polygonOffsetUnits]);
    expect(twin.side).toBe(THREE.DoubleSide);
    expect(batch.mesh.geometry.getAttribute('normal')).toBeUndefined();
  });
});

describe('adoption and the census', () => {
  it('the legacy material is keyed rl-zone-band, on the zoneBand slot, listed as ported; L-matched keeps it visible', () => {
    const legacy = createZoneBandMaterial();
    expect(legacy.name).toBe('rl-zone-band');
    expect(legacyTwinSlot(legacy)).toBe('zoneBand');
    expect(PORTED_MATERIAL_KEYS.has('rl-zone-band')).toBe(true);
    const b = new ZoneBandBatch(12);
    b.mesh.visible = true;
    const scene = new THREE.Scene();
    scene.add(b.mesh);
    expect(censusUnported(scene, { portedKeys: PORTED_MATERIAL_KEYS })).toEqual([]);
    expect(b.mesh.visible).toBe(true);
    expect(censusUnported(scene).map((h) => h.key)).toEqual(['rl-zone-band']);
  });

  it('the legacy fragment text still carries the constants zoneHatchOps reads (the two cannot drift)', () => {
    const f = createZoneBandMaterial().fragmentShader;
    expect(f).toContain('/ 0.450000');
    expect(f).toContain('smoothstep(0.0, 0.06, s)');
    expect(f).toContain('smoothstep(0.440000, 0.500000, s)');
  });
});
