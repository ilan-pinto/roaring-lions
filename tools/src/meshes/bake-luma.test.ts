/**
 * `extras.rl_bake_luma`: the measurement, the stamp, and the SHIPPED files.
 *
 * The oracle for the measurement is literals (the sRGB EOTF of a known 8-bit
 * value, worked by hand), never a second call into `bake-luma.ts`. The shipped
 * half compares each file's DECLARED value against a fresh measurement of the
 * same bytes -- the `rl_gait` rule: a re-export that skipped `pnpm
 * wreck:meshes` keeps a stale number, and that is what this catches.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { BAKE_LUMA_KEY, decodeImage, meanLinearLuma, measureBakeLuma, stampBakeLuma } from './bake-luma';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const ART = path.join(REPO, 'art', 'meshes', 'vehicles');
const SHIPPED = path.join(REPO, 'assets', 'meshes', 'vehicles');

/** sRGB 128 -> linear: ((128/255 + 0.055) / 1.055) ^ 2.4 = 0.215861. */
const GREY_128_LINEAR = 0.215861;

function solid(w: number, h: number, rgb: [number, number, number]): Uint8Array {
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = rgb[0];
    d[i + 1] = rgb[1];
    d[i + 2] = rgb[2];
    d[i + 3] = 255;
  }
  return d;
}

function png(w: number, h: number, rgb: [number, number, number]): Uint8Array {
  const p = new PNG({ width: w, height: h });
  p.data = Buffer.from(solid(w, h, rgb));
  return new Uint8Array(PNG.sync.write(p));
}

function texturedDoc(image: Uint8Array, mime: string, factor: [number, number, number, number] = [1, 1, 1, 1]): Document {
  const doc = new Document();
  const tex = doc.createTexture('bake').setImage(image).setMimeType(mime);
  doc.createMaterial('material').setBaseColorTexture(tex).setBaseColorFactor(factor);
  return doc;
}

function glbJson(file: string): { materials?: { name?: string; extras?: Record<string, unknown>; pbrMetallicRoughness?: { baseColorTexture?: unknown } }[] } {
  const b = readFileSync(file);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}

describe('meanLinearLuma', () => {
  it('decodes sRGB per channel before weighting (grey 128 is 0.2159 linear, not 0.502)', () => {
    expect(meanLinearLuma(solid(4, 4, [128, 128, 128]))).toBeCloseTo(GREY_128_LINEAR, 5);
  });
  it('uses Rec. 709 weights (pure red is 0.2126, pure green 0.7152)', () => {
    expect(meanLinearLuma(solid(2, 2, [255, 0, 0]))).toBeCloseTo(0.2126, 6);
    expect(meanLinearLuma(solid(2, 2, [0, 255, 0]))).toBeCloseTo(0.7152, 6);
  });
  it('is a MEAN over every texel: half black, half white reads 0.5', () => {
    const d = solid(2, 1, [255, 255, 255]);
    d[0] = d[1] = d[2] = 0;
    expect(meanLinearLuma(d)).toBeCloseTo(0.5, 6);
  });
});

describe('decodeImage / measureBakeLuma', () => {
  it('reads a PNG bake exactly and a JPEG bake within its quantisation', () => {
    const fromPng = measureBakeLuma(texturedDoc(png(8, 8, [128, 128, 128]), 'image/png').getRoot().listMaterials()[0]!);
    expect(fromPng).toBeCloseTo(GREY_128_LINEAR, 4);
    const jpg = new Uint8Array(jpeg.encode({ width: 16, height: 16, data: Buffer.from(solid(16, 16, [128, 128, 128])) }, 100).data);
    const fromJpg = measureBakeLuma(texturedDoc(jpg, 'image/jpeg').getRoot().listMaterials()[0]!);
    expect(Math.abs(fromJpg! - GREY_128_LINEAR)).toBeLessThan(0.004);
  });
  it('multiplies in the material\'s own baseColorFactor, as the GPU does', () => {
    const half = measureBakeLuma(texturedDoc(png(4, 4, [128, 128, 128]), 'image/png', [0.5, 0.5, 0.5, 1]).getRoot().listMaterials()[0]!);
    expect(half).toBeCloseTo(GREY_128_LINEAR / 2, 4);
  });
  it('refuses an image type it cannot decode, by name', () => {
    expect(() => decodeImage(new Uint8Array([1, 2, 3]), 'image/webp')).toThrow(/image\/webp/);
  });
  it('returns null for a material with no bake', () => {
    const doc = new Document();
    expect(measureBakeLuma(doc.createMaterial('flat'))).toBeNull();
  });
});

describe('stampBakeLuma', () => {
  it('stamps the value on the material extras, keeps other extras, and is idempotent', () => {
    const doc = texturedDoc(png(4, 4, [128, 128, 128]), 'image/png');
    const mat = doc.getRoot().listMaterials()[0]!;
    mat.setExtras({ keep: 1 });
    stampBakeLuma(doc);
    const first = { ...(mat.getExtras() as Record<string, unknown>) };
    expect(first['keep']).toBe(1);
    expect(first[BAKE_LUMA_KEY]).toBeCloseTo(GREY_128_LINEAR, 4);
    stampBakeLuma(doc);
    expect(mat.getExtras()).toEqual(first);
  });
  it('removes a stale value from a material that lost its bake', () => {
    const doc = new Document();
    const mat = doc.createMaterial('flat').setExtras({ [BAKE_LUMA_KEY]: 0.5 });
    stampBakeLuma(doc);
    expect((mat.getExtras() as Record<string, unknown>)[BAKE_LUMA_KEY]).toBeUndefined();
  });
});

describe('the shipped vehicles', () => {
  const files = readdirSync(ART).filter((f) => f.endsWith('.glb')).sort();

  it('every textured vehicle material declares rl_bake_luma, and it equals a fresh measurement of its own bake', { timeout: 120_000 }, async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    let textured = 0;
    for (const f of files) {
      const doc = await io.read(path.join(ART, f));
      for (const mat of doc.getRoot().listMaterials()) {
        const fresh = measureBakeLuma(mat);
        const declared = (mat.getExtras() as Record<string, unknown>)[BAKE_LUMA_KEY];
        if (fresh === null) {
          expect(declared, `${f}/${mat.getName()}: untextured but declares ${String(declared)}`).toBeUndefined();
          continue;
        }
        textured++;
        expect(declared, `${f}/${mat.getName()}: no ${BAKE_LUMA_KEY} -- run pnpm wreck:meshes`).toBeTypeOf('number');
        expect(Math.abs((declared as number) - fresh), `${f}/${mat.getName()}: declared ${String(declared)}, measured ${fresh}`).toBeLessThan(2e-5);
      }
    }
    // Not vacuous: 17 of the 18 vehicles carry a bake (loiter_drone is palette).
    expect(textured).toBeGreaterThanOrEqual(17);
  });

  it('the Draco copy the game loads declares the same numbers as the source', () => {
    for (const f of files) {
      const src = glbJson(path.join(ART, f)).materials ?? [];
      const shipped = glbJson(path.join(SHIPPED, f)).materials ?? [];
      expect(shipped.map((m) => m.extras?.[BAKE_LUMA_KEY]), f).toEqual(src.map((m) => m.extras?.[BAKE_LUMA_KEY]));
    }
  });
});
