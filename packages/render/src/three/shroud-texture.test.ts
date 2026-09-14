/**
 * Task 10, spec 6: fog of war stops being tile quads and becomes a texture.
 * This half is the pure one -- the byte grid `computeFog` owns turned into a
 * 2x2-per-tile, feathered R8 image -- so it needs no `WebGLRenderer` at all,
 * the same `environment: 'node'` split the retired `fog-mesh.test.ts` and
 * `trail-mesh.test.ts` already run under. `ShroudTexture` is a `DataTexture`,
 * which three.js constructs happily headless; only sampling it needs GL.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildShroudData, ShroudTexture, SHROUD_NEVER_SEEN, SHROUD_EXPLORED, SHROUD_VISIBLE } from './shroud-texture';

describe('buildShroudData', () => {
  it('is 2x2 texels per tile, level 0/1/2 -> 0/128/255 far from any boundary', () => {
    const w = 6,
      h = 6;
    const fog = new Uint8Array(w * h);
    fog.fill(2);
    const data = buildShroudData(fog, w, h);
    expect(data).toHaveLength(4 * w * h);
    expect(data[0]).toBe(SHROUD_VISIBLE);
    fog.fill(0);
    expect(buildShroudData(fog, w, h)[2 * 12 + 6]).toBe(SHROUD_NEVER_SEEN);
    fog.fill(1);
    expect(buildShroudData(fog, w, h)[2 * 12 + 6]).toBe(SHROUD_EXPLORED);
  });

  it('feathers a boundary monotonically over about 1.5 tiles', () => {
    const w = 8,
      h = 1;
    const fog = new Uint8Array(w);
    for (let x = 0; x < w; x++) fog[x] = x < 4 ? 2 : 0;
    const data = buildShroudData(fog, w, h);
    // row 0 of the 16x2 texel image
    const row = Array.from(data.slice(0, 16));
    for (let i = 1; i < row.length; i++) expect(row[i]).toBeLessThanOrEqual(row[i - 1]);
    expect(row[0]).toBe(SHROUD_VISIBLE);
    expect(row[15]).toBe(SHROUD_NEVER_SEEN);
    // strictly between at the boundary texels
    expect(row[7]).toBeLessThan(SHROUD_VISIBLE);
    expect(row[8]).toBeGreaterThan(SHROUD_NEVER_SEEN);
  });

  it('reuses the out buffer', () => {
    const out = new Uint8Array(16);
    expect(buildShroudData(new Uint8Array(4), 2, 2, out)).toBe(out);
  });
});

describe('ShroudTexture', () => {
  it('is an R8 DataTexture, linear filtered, clamped, not flipped, updated in place', () => {
    const s = new ShroudTexture(4, 4);
    expect(s.texture.image.width).toBe(8);
    expect(s.texture.format).toBe(THREE.RedFormat);
    expect(s.texture.type).toBe(THREE.UnsignedByteType);
    expect(s.texture.minFilter).toBe(THREE.LinearFilter);
    expect(s.texture.magFilter).toBe(THREE.LinearFilter);
    expect(s.texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(s.texture.flipY).toBe(false);
    expect(s.texture.unpackAlignment).toBe(1);
    const fog = new Uint8Array(16).fill(2);
    // `Texture.needsUpdate` is a WRITE-ONLY accessor in three r170 (`set
    // needsUpdate(value) { if (value === true) { this.version++; ... } }`,
    // with no getter), so reading it back always gives `undefined` and an
    // assertion on that value can neither pass nor fail honestly. `version`
    // is the field the setter actually bumps, and the field `WebGLTextures`
    // compares against its cached upload -- so it is the real observable
    // behind "flagged for re-upload".
    const version = s.texture.version;
    s.update(fog);
    expect(s.texture.version).toBeGreaterThan(version);
    expect((s.texture.image.data as Uint8Array)[0]).toBe(SHROUD_VISIBLE);
  });
});
