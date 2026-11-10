/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T11) gates for `beam-batch.node.ts`: the laser beam batch's material. Maths on numbers against literals; wiring on the
 * generated program text of the REAL batch's mesh; the batch re-derives `visible` every frame, so the flicker gate runs the node census
 * between frames.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NUMBER_OPS } from '../fog-ops';
import { censusUnported } from '../backend/unported';
import { adoptMaterials, createTwinCache } from '../node-material-adoption';
import { paletteHex } from '../palette-hex';
import { BeamBatch, beamShapeOps, KIND_CORE, KIND_DISC, KIND_SHEATH, type BeamDraw } from './beam-batch';
import { newBeamLook, newBeamLookState, stepBeamLook } from './beam-look';
import { adoptFx, compileFx, fxKit } from './fx-twin-test-kit';

const shape = (alpha: number, x: number, y: number, kind: number) => beamShapeOps(NUMBER_OPS, { alpha, shapeX: x, shapeY: y, kind });

describe('the beam shape on numbers (literals)', () => {
  it('the kinds are 0 sheath, 1 core, 2 disc, as the vertices carry them', () => {
    expect([KIND_SHEATH, KIND_CORE, KIND_DISC]).toEqual([0, 1, 2]);
  });
  it('the sheath falls off across its width: 1 on the axis, 0 at the edge, 0.75 at |x| 0.5', () => {
    expect(shape(0.8, 0, 0.3, 0).alpha).toBeCloseTo(0.8, 12);
    expect(shape(0.8, 1, 0.3, 0).alpha).toBeCloseTo(0, 12);
    expect(shape(0.8, 0.5, 0.3, 0).alpha).toBeCloseTo(0.6, 12);
    expect(shape(0.8, -0.5, 0.3, 0).alpha).toBeCloseTo(0.6, 12);
  });
  it('the core is a solid line: the alpha as authored, whatever the shape coordinates', () => {
    for (const [x, y] of [[0, 0], [1, 0.5], [0.7, 0.9]] as const) expect(shape(0.9, x, y, 1).alpha).toBe(0.9);
  });
  it('a glow disc is solid to r 0.35, half at the middle of the ramp, and 0 at the rim and beyond', () => {
    expect(shape(1, 0.35, 0, 2).alpha).toBeCloseTo(1, 12);
    expect(shape(1, 0, 0.1, 2).alpha).toBeCloseTo(1, 12);
    expect(shape(1, 0.675, 0, 2).alpha).toBeCloseTo(0.5, 12);
    expect(shape(1, 0.6, 0.8, 2).alpha).toBeCloseTo(0, 12);
    // Past the rim the factor is 0 already, which is why the twin needs no discard.
    expect(shape(1, 1.4, 0.2, 2).alpha).toBe(0);
  });
  it('the kind switch is branch-free and exclusive: the sheath weight and the disc weight are never both 1', () => {
    for (const k of [0, 1, 2]) {
      const s = shape(1, 0.3, 0.3, k);
      expect(s.isSheath + s.isDisc).toBeLessThanOrEqual(1);
    }
    expect(shape(1, 0, 0, 0).isSheath).toBe(1);
    expect(shape(1, 0, 0, 1).isSheath).toBe(0);
    expect(shape(1, 0, 0, 2).isDisc).toBe(1);
  });
});

function look() {
  return stepBeamLook(newBeamLookState(), { target: 3, dwell: 31, locked: false, dwellTicks: 30, alpha: 0, nowMs: 5000, struckAtMs: null, lockout: false }, newBeamLook());
}
const draw = (): BeamDraw => ({ ox: 10, oy: 1.5, oz: 10, ex: 14, ey: 0.4, ez: 12, look: look() });

function batch(): { b: BeamBatch; scene: THREE.Scene } {
  const scene = new THREE.Scene();
  const b = new BeamBatch(scene);
  b.setColors(paletteHex('vfx.white_hot'), paletteHex('vfx.ember'));
  return { b, scene };
}

describe('the beam twin graph', () => {
  it('wires aColor, aAlpha and aShape (x, y and the kind) and carries no discard', async () => {
    const { b } = batch();
    await adoptFx(b.mesh);
    const c = await compileFx(b.mesh);
    for (const a of ['aColor', 'aAlpha', 'aShape']) expect(c.vertex, a).toContain(a);
    expect(c.fragment).toMatch(/DiffuseColor = vec4\( nodeVarying\d+, 1\.0 \);/);
    // The sheath term (1 - x^2) and the disc term (the 0.35 feather) and the two kind steps are in the fragment.
    expect(c.fragment).toMatch(/\( 1\.0 - \( nodeVarying\d+\.x \* nodeVarying\d+\.x \) \)/);
    expect(c.fragment).toContain('smoothstep( 0.35, 1.0');
    expect(c.fragment).toContain('step( 0.5, nodeVarying');
    expect(c.fragment).toContain('step( 1.5, nodeVarying');
    expect(c.fragment).not.toContain('discard');
  });

  it('G4: the geometry is the batch\'s (sim clock); the twin has no clock and no uniform of its own', async () => {
    const { b } = batch();
    const twin = await adoptFx(b.mesh);
    const c = await compileFx(b.mesh);
    expect(c.frameClocked).toEqual([]);
    expect(twin.userData.rlFxBound).toEqual({});
  });

  it('G5: the batch re-derives visible every frame, and the node census never hides it', async () => {
    const { b, scene } = batch();
    const cache = createTwinCache();
    expect(adoptMaterials(scene, await fxKit(), cache)).toBe(1);
    for (let frame = 0; frame < 6; frame++) {
      const live = frame % 3 !== 2;
      b.beginFrame(1);
      if (live) b.add(draw());
      b.finish();
      // The census runs on node every 60 frames: here every frame. A ported beam is neither hidden nor reported.
      expect(censusUnported(scene)).toEqual([]);
      expect(b.mesh.visible, `frame ${frame}`).toBe(live);
    }
  });

  it('G5 control: with the beam slot empty the census hides the mesh, so the check can fail', async () => {
    const { b, scene } = batch();
    adoptMaterials(scene, { ...(await fxKit()), beam: null }, createTwinCache());
    b.beginFrame(1);
    b.add(draw());
    b.finish();
    expect(b.mesh.visible).toBe(true);
    expect(censusUnported(scene).map((h) => h.kind)).toContain('shader-material');
    expect(b.mesh.visible).toBe(false);
  });
});
