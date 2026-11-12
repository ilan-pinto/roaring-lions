/**
 * GH-1226 S2: the height-blend field's bake, on synthetic maps with literal oracles. The real-map census and the real-collapse splice
 * walk are in `packages/app/src/height-blend-field.test.ts` (this package may not import `@lions/data`).
 */
import { describe, expect, it } from 'vitest';
import { buildTerrainSurface, smoothLevel, smoothNormal, terrainSurfaceFrom } from './surface';
import { fbm2 } from './noise';
import { bakeHeightBlendField, levelAndNormalY, spliceHeightBlendField } from './height-blend-field';
import { heightBlendTexture } from './height-blend-texture';
import * as THREE from 'three';

function surfaceOf(w: number, h: number, levelAt: (x: number, y: number) => number, blockedAt: (x: number, y: number) => number = () => 0) {
  const elevation = new Uint8Array(w * h);
  const blocked = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      elevation[y * w + x] = levelAt(x, y);
      blocked[y * w + x] = blockedAt(x, y);
    }
  return { surface: terrainSurfaceFrom(elevation, blocked, w, h), elevation, blocked };
}

const px = (f: { data: Uint8Array; width: number }, i: number, j: number, c: number) => f.data[(j * f.width + i) * 4 + c];

describe('the field encoding', () => {
  it('has the size, and the alpha 255, a texel every quarter tile', () => {
    const { surface } = surfaceOf(6, 5, (x) => x);
    const f = bakeHeightBlendField(surface, 6, 5);
    expect([f.width, f.height, f.data.length]).toEqual([24, 20, 24 * 20 * 4]);
    for (let k = 3; k < f.data.length; k += 4) expect(f.data[k]).toBe(255);
  });

  it('bakes a flat map to exactly R 0 and G 128 everywhere, the byte S1 reads as zero', () => {
    const flat = terrainSurfaceFrom(new Uint8Array(100), new Uint8Array(100), 10, 10);
    const f = bakeHeightBlendField(flat, 10, 10);
    for (let k = 0; k < f.data.length; k += 4) {
      expect(f.data[k]).toBe(0);
      expect(f.data[k + 1]).toBe(128);
    }
    // The decode S1 uses (`macroDecode`: (r x 255 - 128) / 127) reads that byte as exactly 0.
    expect((128 / 255) * 255 - 128).toBe(0);
  });

  it('also bakes a uniform raised plateau to G 128 at every texel, edges included (the clamp, not a zero fill)', () => {
    const { surface } = surfaceOf(12, 12, () => 3);
    const f = bakeHeightBlendField(surface, 12, 12);
    for (let k = 0; k < f.data.length; k += 4) expect(f.data[k + 1]).toBe(128);
    for (let k = 0; k < f.data.length; k += 4) expect(f.data[k]).toBe(0);
  });

  it('reads a one-level-a-tile ramp as the Catmull-Rom slope atan(0.2552) = 14.316 degrees, byte 57', () => {
    const { surface } = surfaceOf(16, 16, (x) => x);
    const f = bakeHeightBlendField(surface, 16, 16);
    // round(14.3163 / 64 x 255) = round(57.04) = 57, in the interior (the rim is clamped).
    for (let j = 24; j < 40; j++) for (let i = 24; i < 40; i++) expect(px(f, i, j, 0)).toBe(57);
    // A uniform ramp has TPI 0 where the box does not touch the map edge.
    for (let j = 24; j < 40; j++) expect(px(f, 32, j, 1)).toBe(128);
  });

  it('reads a crest above its 1.5-tile mean as G above 128 and a hollow as G below', () => {
    const { surface } = surfaceOf(24, 24, (x, y) => (x === 12 && y === 12 ? 3 : x === 6 && y === 6 ? 0 : 1));
    const f = bakeHeightBlendField(surface, 24, 24);
    expect(px(f, 12 * 4 + 2, 12 * 4 + 2, 1)).toBeGreaterThan(200);
    expect(px(f, 6 * 4 + 2, 6 * 4 + 2, 1)).toBeLessThan(128);
  });

  it('zeroes the slope on a terrace tile and leaves its neighbours alone', () => {
    const { surface } = surfaceOf(
      12,
      12,
      (x) => (x < 6 ? 0 : 5),
      (x) => (x === 6 ? 1 : 0)
    );
    const f = bakeHeightBlendField(surface, 12, 12);
    for (let j = 0; j < 4; j++) for (let i = 24; i < 28; i++) expect(px(f, i, 24 + j, 0)).toBe(0);
    expect(px(f, 4 * 5 + 3, 24, 0)).toBeGreaterThan(0);
  });

  it('is deterministic: two bakes are byte-equal', () => {
    const { surface } = surfaceOf(20, 20, (x, y) => (x * 3 + y * 5) % 7);
    const a = bakeHeightBlendField(surface, 20, 20);
    const b = bakeHeightBlendField(surface, 20, 20);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });

  it('has a patch noise whose mean maps to about 128 and which is not constant', () => {
    const { surface } = surfaceOf(30, 30, () => 0);
    const f = bakeHeightBlendField(surface, 30, 30);
    let sum = 0;
    let lo = 255;
    let hi = 0;
    const n = f.width * f.height;
    for (let k = 0; k < n; k++) {
      const v = f.data[k * 4 + 2];
      sum += v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(Math.abs(sum / n - 127.5)).toBeLessThan(12);
    expect(hi - lo).toBeGreaterThan(60);
  });
});

describe('the one-pass level and slope', () => {
  it('is bit-equal to smoothLevel and smoothNormal on a grid of points, rim and terraces included', () => {
    const { surface } = surfaceOf(
      14,
      11,
      (x, y) => (x * 5 + y * 3 + ((x * y) % 4)) % 9,
      (x, y) => (x === 5 && y > 2 && y < 6 ? 1 : 0)
    );
    for (let z = -0.4; z < 11.4; z += 0.137)
      for (let x = -0.4; x < 14.4; x += 0.113) {
        const r = levelAndNormalY(surface, x, z);
        expect(r.level).toBe(smoothLevel(surface, x, z));
        expect(r.ny).toBe(smoothNormal(surface, x, z)[1]);
      }
  });
});

describe('the patch noise', () => {
  it('is fbm2 (3-tile period, 2 octaves, seed 1226) at every texel centre, to the byte: the B channel read back', () => {
    const { surface } = surfaceOf(23, 17, () => 0);
    const f = bakeHeightBlendField(surface, 23, 17);
    for (let j = 0; j < f.height; j++)
      for (let i = 0; i < f.width; i++) {
        const v = fbm2((i + 0.5) / 4, (j + 0.5) / 4, 3, 2, 1226);
        if (px(f, i, j, 2) !== Math.round((v * 0.5 + 0.5) * 255)) throw new Error(`texel ${i},${j}`);
      }
  });
});

describe('the region splice', () => {
  function world(open: boolean) {
    const w = 28;
    const h = 24;
    return surfaceOf(
      w,
      h,
      (x, y) => (x * 2 + y * 3) % 6,
      (x, y) => (!open && x >= 12 && x <= 14 && y >= 10 && y <= 12 ? 1 : 0)
    );
  }
  it('is byte-identical to a full bake after a pad reopens, rewrites a small region, and does it twice in a row', () => {
    const before = world(false);
    const after = world(true);
    const f = bakeHeightBlendField(before.surface, 28, 24);
    const written = spliceHeightBlendField(f, after.surface);
    const full = bakeHeightBlendField(after.surface, 28, 24);
    expect(Buffer.from(f.data).equals(Buffer.from(full.data))).toBe(true);
    expect(written).toBeGreaterThan(0);
    expect(written as number).toBeLessThan((28 * 24 * 16) / 2);
    // Back again, from the splice, never from a fresh bake.
    expect(spliceHeightBlendField(f, before.surface)).toBeGreaterThan(0);
    expect(Buffer.from(f.data).equals(Buffer.from(bakeHeightBlendField(before.surface, 28, 24).data))).toBe(true);
  });

  it('rewrites nothing when nothing changed, and refuses (null) a flatness change', () => {
    const w = world(true);
    const f = bakeHeightBlendField(w.surface, 28, 24);
    expect(spliceHeightBlendField(f, buildTerrainSurface({ width: 28, height: 24, decor: null, elevation: w.elevation, blocked: w.blocked, cover: new Uint8Array(0) }))).toBe(0);
    const flat = terrainSurfaceFrom(new Uint8Array(28 * 24), new Uint8Array(28 * 24), 28, 24);
    expect(spliceHeightBlendField(f, flat)).toBeNull();
  });

  it('with the box radius one texel short is NOT byte-identical (the margin is tight)', () => {
    const before = world(false);
    const after = world(true);
    const f = bakeHeightBlendField(before.surface, 28, 24);
    spliceHeightBlendField(f, after.surface, 2, 5);
    const full = bakeHeightBlendField(after.surface, 28, 24);
    expect(Buffer.from(f.data).equals(Buffer.from(full.data))).toBe(false);
  });
});

describe('the texture', () => {
  it('is RGBA8 data, no mips, Linear, clamped, NoColorSpace, 4 texels a tile', () => {
    const { surface } = surfaceOf(6, 5, (x) => x);
    const f = bakeHeightBlendField(surface, 6, 5);
    const t = heightBlendTexture(f);
    expect(t.image.width).toBe(24);
    expect(t.image.height).toBe(20);
    expect(t.format).toBe(THREE.RGBAFormat);
    expect(t.type).toBe(THREE.UnsignedByteType);
    expect(t.generateMipmaps).toBe(false);
    expect(t.minFilter).toBe(THREE.LinearFilter);
    expect(t.magFilter).toBe(THREE.LinearFilter);
    expect(t.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(t.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(t.colorSpace).toBe(THREE.NoColorSpace);
    expect((t.image.data as Uint8Array).buffer).toBe(f.data.buffer);
  });
});
