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
  SCORCH_EDGE_INNER,
  SCORCH_OPACITY,
  ScorchDecalMesh,
  createScorchMaterial,
  scorchRadiusTiles,
  writeScorchOffsets,
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

describe('the radial fade (I1)', () => {
  // The mark was a hard-edged square until this, photographed at `f75e5dbf`
  // through `pnpm blast:capture`: a flat translucent rhombus with knife-sharp
  // tile-aligned edges and uniform opacity, on bare sand (`mortar_team` at
  // 4 s) and under a wreck (`mbt_lavi` at 4 s) alike. What makes it round and
  // soft is one per-vertex attribute and one `smoothstep`, so both halves are
  // pinned: an attribute nothing writes and a shader that ignores it are two
  // different silent failures.

  it('writes each corner at unit distance per axis, so the centre is the origin', () => {
    const out = new Float32Array(6 * 2);
    writeScorchOffsets(out, 0);
    // Six vertices, two floats each; every component is exactly +/-1.
    for (const v of out) expect(Math.abs(v)).toBe(1);
    // The interpolated centre of the quad is the MEAN of its corners, and it
    // has to be (0, 0) or the fade is about a point that is not the mark's
    // centre. Each triangle is weighted equally by being written whole.
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < out.length; i += 2) {
      sx += out[i];
      sy += out[i + 1];
    }
    expect(sx).toBe(0);
    expect(sy).toBe(0);
  });

  it('orders its corners exactly as writeScorchVertices does', () => {
    // The two arrays are read as ONE vertex stream. An offset written against
    // a different winding fades the mark about a point that is not its centre,
    // which at these opacities photographs as a slightly lopsided mark rather
    // than as a bug -- so the order is pinned rather than trusted.
    const pos = new Float32Array(6 * 3);
    const off = new Float32Array(6 * 2);
    const cx = 10;
    const cy = 12;
    const radius = 2;
    writeScorchVertices(pos, 0, cx, cy, 0, radius);
    writeScorchOffsets(off, 0);
    for (let v = 0; v < 6; v++) {
      expect(pos[v * 3], `vertex ${v} x`).toBeCloseTo(cx + off[v * 2] * radius, 6);
      expect(pos[v * 3 + 2], `vertex ${v} z`).toBeCloseTo(cy + off[v * 2 + 1] * radius, 6);
    }
  });

  it('writes exactly one mark of offsets into its own slot and touches no other', () => {
    const out = new Float32Array(SCORCH_CAPACITY * 6 * 2);
    writeScorchOffsets(out, 3);
    const slotStart = 3 * 6 * 2;
    expect(out.slice(0, slotStart).every((v) => v === 0)).toBe(true);
    expect(out.slice(slotStart, slotStart + 12).every((v) => v !== 0)).toBe(true);
    expect(out.slice(slotStart + 12).every((v) => v === 0)).toBe(true);
  });

  it('gives the mesh an aOffset attribute, filled for every slot at construction', () => {
    // Filled once, never per stamp: a mark's offsets are the same twelve
    // numbers at every size and position, so a per-stamp write would upload a
    // buffer nothing had changed. A pool whose later slots were left at zero
    // would draw those marks at full alpha everywhere (length((0,0)) = 0), i.e.
    // as the hard square this fix removes -- for every mark past the first.
    const pool = new ScorchDecalMesh(4);
    const attr = pool.mesh.geometry.getAttribute('aOffset');
    expect(attr).toBeDefined();
    expect(attr.itemSize).toBe(2);
    expect(attr.count).toBe(4 * 6);
    const arr = attr.array as Float32Array;
    for (const v of arr) expect(Math.abs(v)).toBe(1);
  });

  it('fades the alpha off with distance from the centre, in the shader', () => {
    const mat = createScorchMaterial('#3A3C33');
    expect(mat.uniforms.uEdgeInner.value).toBe(SCORCH_EDGE_INNER);
    expect(mat.vertexShader).toContain('aOffset');
    expect(mat.fragmentShader).toContain('length(vOffset)');
    expect(mat.fragmentShader).toContain('smoothstep(uEdgeInner, 1.0, d)');
    // The alpha that reaches the frame buffer is the product, never the flat
    // uniform: a shader that read `uOpacity` alone would pass every check
    // above and still draw the square.
    expect(mat.fragmentShader).toContain('uOpacity * fade');
  });

  it('fades to nothing before the corners, so the visible mark is a circle', () => {
    // length((1,1)) is 1.414, past the fade's own 1.0 -- which is what makes
    // `scorchRadiusTiles` the radius of the mark a player SEES rather than the
    // half-width of a square 27% larger in area.
    expect(SCORCH_EDGE_INNER).toBeGreaterThan(0);
    expect(SCORCH_EDGE_INNER).toBeLessThan(1);
    expect(Math.hypot(1, 1)).toBeGreaterThan(1);
  });
});
