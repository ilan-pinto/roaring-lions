import { describe, expect, it } from 'vitest';
import { MODEL_REGION, STATES, differingPixels, mergeFailures, type Pixels, type Reading } from './inf-kit-capture-check';

/** The readings of the 28 Oct 2026 Metal capture (Apple M3 Pro), literals. */
const MEASURED: Record<string, Reading> = {
  T0: { tiers: {}, loaded: true, tris: 8172, kitTris: 0, meshes: 4, calls: 54 },
  A3: { tiers: { armour: 3 }, loaded: true, tris: 9462, kitTris: 1290, meshes: 4, calls: 54 },
  S3: { tiers: { sensors: 3 }, loaded: true, tris: 9232, kitTris: 1060, meshes: 4, calls: 54 },
  F3: { tiers: { firepower: 3 }, loaded: true, tris: 9240, kitTris: 1068, meshes: 4, calls: 54 },
  full: { tiers: { armour: 3, sensors: 3, firepower: 3 }, loaded: true, tris: 11590, kitTris: 3418, meshes: 4, calls: 54 },
};
const read = (over: (m: Record<string, Reading>) => void): string[] => {
  const m = structuredClone(MEASURED);
  over(m);
  return mergeFailures(new Map(Object.entries(m)));
};

describe('inf-kit capture merge check', () => {
  it('passes what the real capture read', () => {
    expect(read(() => undefined)).toEqual([]);
    expect(STATES).toHaveLength(5);
  });
  it('fails when the seed never arrived, a merge kept nothing, the kit added a mesh or a draw call', () => {
    expect(read((m) => { m.full.tiers = {}; })[0]).toMatch(/full: renderer tiers/);
    expect(read((m) => { m.A3.kitTris = 0; m.A3.tris = 8172; })[0]).toMatch(/A3: 0 kit triangles merged, expected 1290/);
    expect(read((m) => { m.S3.meshes = 5; })).toEqual([expect.stringMatching(/S3: 5 meshes/)]);
    expect(read((m) => { m.F3.calls = 56; })).toEqual([expect.stringMatching(/F3: 56 draw calls/)]);
    expect(read((m) => { m.T0.tris = 8604; m.T0.kitTris = 0; })[0]).toMatch(/T0: 8604 triangles/);
    expect(read((m) => { delete (m as Record<string, Reading | undefined>).A3; })).toContain('A3: not captured');
  });
});

describe('inf-kit garage capture: the model-region pixel comparison', () => {
  const W = 100;
  const H = 50;
  const plate = (paint?: (x: number, y: number) => number): Pixels => {
    const data = new Uint8Array(W * H * 4).fill(40);
    if (paint) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.fill(paint(x, y), (y * W + x) * 4, (y * W + x) * 4 + 3);
    }
    return { width: W, height: H, data };
  };
  const inRegion = (x: number, y: number): boolean =>
    x >= W * MODEL_REGION.x0 && x < W * MODEL_REGION.x1 && y >= H * MODEL_REGION.y0 && y < H * MODEL_REGION.y1;

  it('reads zero for two identical plates, and counts what changed inside the region', () => {
    expect(differingPixels(plate(), plate())).toBe(0);
    // A 10 x 5 patch of the model region painted bright: exactly 50 pixels.
    const kit = plate((x, y) => (x >= 40 && x < 50 && y >= 20 && y < 25 ? 200 : 40));
    expect(differingPixels(plate(), kit)).toBe(50);
  });
  it('ignores the DOM overlays at the corners (the kit mark, the Maxed stamp, the hint)', () => {
    const overlays = plate((x, y) => (inRegion(x, y) ? 40 : 255));
    expect(differingPixels(plate(), overlays)).toBe(0);
  });
  it('ignores a change under the 8/255 floor and refuses two sizes', () => {
    expect(differingPixels(plate(), plate(() => 48))).toBe(0);
    expect(differingPixels(plate(), plate(() => 49))).toBe(1500); // x 20..79 by y 12..36 of a 100 x 50 plate
    expect(differingPixels(plate(), { width: W, height: H + 1, data: new Uint8Array(W * (H + 1) * 4) })).toBe(Number.POSITIVE_INFINITY);
  });
});
