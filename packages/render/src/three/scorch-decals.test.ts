/**
 * Pure geometry/bookkeeping and GPU-facing construction for scorch marks,
 * exercised without a `WebGLRenderer` -- same split `vehicle-tracks.test.ts`
 * already establishes. See `scorch-decals.ts`'s top comment for the full
 * design account.
 *
 * Deliberately drops the brief's own `import * as THREE from 'three'`: this
 * suite never names `THREE.*` directly (every assertion reads a plain
 * number or a property off `m.mesh`), and an unused namespace import fails
 * `pnpm typecheck` under this repo's `noUnusedLocals` (confirmed by hand
 * before writing this file, not assumed) -- the same class of defect
 * CLAUDE.md's "every check gets an input that makes it fail" section asks
 * to catch rather than carry forward.
 */
import { describe, expect, it } from 'vitest';
import {
  SCORCH_CAPACITY,
  SCORCH_OPACITY,
  ScorchDecalMesh,
  createScorchMaterial,
  scorchRadiusTiles,
  writeScorchVertices,
} from './scorch-decals';
import { MAX_MESH_WRECKS } from './units/mesh-death';

describe('the pool', () => {
  // R-N: one-to-one with the wreck it sits under. A scorch outliving its
  // wreck's own eviction is a mark with nothing under it.
  it('is capped where the mesh wrecks are capped', () => {
    expect(SCORCH_CAPACITY).toBe(MAX_MESH_WRECKS);
  });

  it('accepts its whole capacity and then recycles oldest-first, never grows', () => {
    const m = new ScorchDecalMesh();
    for (let i = 0; i < SCORCH_CAPACITY; i++) m.stamp(i % 40, Math.floor(i / 40), 0, 1);
    expect(m.liveCount).toBe(SCORCH_CAPACITY);
    m.stamp(1.5, 1.5, 0, 1);
    expect(m.liveCount).toBe(SCORCH_CAPACITY);
    const positions = m.mesh.geometry.getAttribute('position');
    expect(positions.count).toBe(SCORCH_CAPACITY * 6); // two triangles a mark
  });

  // The falsification the plan names: a pool of zero must be a red test, not
  // a renderer that silently draws nothing.
  it('a capacity of zero is refused at construction rather than drawing nothing', () => {
    expect(() => new ScorchDecalMesh(0)).toThrow(/capacity/);
  });
});

describe('scorchRadiusTiles', () => {
  // Strength scales; a mortar bomb leaves a smaller mark than a burning hull,
  // and sqrt rather than linear because the mark is an AREA -- a 0.3-power
  // round that left 30% of the radius would leave 9% of the mark and read as
  // nothing at all.
  it('grows with power, sublinearly, and is zero at zero', () => {
    expect(scorchRadiusTiles(0)).toBe(0);
    expect(scorchRadiusTiles(1)).toBeGreaterThan(scorchRadiusTiles(0.3));
    expect(scorchRadiusTiles(0.3)).toBeGreaterThan(0.3 * scorchRadiusTiles(1));
  });
});

describe('writeScorchVertices', () => {
  it('writes exactly one mark into its own slot and touches no other', () => {
    const out = new Float32Array(SCORCH_CAPACITY * 6 * 3);
    writeScorchVertices(out, 3, 10, 12, 0.5, 1);
    const slotStart = 3 * 6 * 3;
    expect(out.slice(0, slotStart).every((v) => v === 0)).toBe(true);
    expect(out.slice(slotStart, slotStart + 18).some((v) => v !== 0)).toBe(true);
    expect(out.slice(slotStart + 18).every((v) => v === 0)).toBe(true);
  });

  it('lies flat on the sampled ground height, never on y=0', () => {
    const out = new Float32Array(6 * 3);
    writeScorchVertices(out, 0, 0, 0, 2.25, 1);
    for (let i = 1; i < out.length; i += 3) expect(out[i]).toBeCloseTo(2.25, 6);
  });
});

describe('createScorchMaterial', () => {
  it('is a translucent, depth-tested ground decal that writes no depth', () => {
    const mat = createScorchMaterial('#3A3C33');
    expect(mat.transparent).toBe(true);
    expect(mat.depthTest).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.uniforms.uOpacity.value).toBe(SCORCH_OPACITY);
  });

  // vehicle-tracks.ts's own trap: OutputPass encodes the whole frame to sRGB
  // once at the end, so an un-linearised hex lands brighter than the palette
  // entry authored. #FFFFFF is the one value where the two agree, so the
  // check uses a mid tone where they do not.
  it('feeds the shader a LINEAR colour, not the sRGB hex', () => {
    const mat = createScorchMaterial('#808080');
    expect(mat.uniforms.uColor.value.x).toBeLessThan(0.5);
    expect(mat.uniforms.uColor.value.x).toBeGreaterThan(0.1);
  });
});
