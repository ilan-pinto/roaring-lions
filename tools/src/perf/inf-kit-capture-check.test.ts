import { describe, expect, it } from 'vitest';
import { BREACH_ENCODED_BASE_TRIS, BREACH_STATES, DEMO_ENCODED_BASE_TRIS, DEMO_STATES, MODEL_REGION, STATES, TEAM_CHECKS, differingPixels, mergeFailures, type Pixels, type Reading } from './inf-kit-capture-check';

/** The kit triangles of each state, literals from the 29 Oct art file (the redesign). */
const KIT: Record<string, [Record<string, number>, number]> = {
  A1: [{ armour: 1 }, 786], A2: [{ armour: 2 }, 1074], A3: [{ armour: 3 }, 1242],
  S1: [{ sensors: 1 }, 372], S2: [{ sensors: 2 }, 728], S3: [{ sensors: 3 }, 958],
  F1: [{ firepower: 1 }, 570], F2: [{ firepower: 2 }, 906], F3: [{ firepower: 3 }, 1158],
  full: [{ armour: 3, sensors: 3, firepower: 3 }, 3358],
};
const MEASURED: Record<string, Reading> = {
  T0: { tiers: {}, loaded: true, tris: 8172, kitTris: 0, meshes: 4, calls: 54 },
  ...Object.fromEntries(Object.entries(KIT).map(([id, [tiers, kit]]) => [id, { tiers, loaded: true, tris: 8172 + kit, kitTris: kit, meshes: 4, calls: 54 }])),
};
const read = (over: (m: Record<string, Reading>) => void): string[] => {
  const m = structuredClone(MEASURED);
  over(m);
  return mergeFailures(new Map(Object.entries(m)));
};

describe('inf-kit capture merge check', () => {
  it('passes what the real capture read', () => {
    expect(read(() => undefined)).toEqual([]);
    expect(STATES).toHaveLength(11);
  });
  it('fails when the seed never arrived, a merge kept nothing, the kit added a mesh or a draw call', () => {
    expect(read((m) => { m.full.tiers = {}; })[0]).toMatch(/full: renderer tiers/);
    expect(read((m) => { m.A3.kitTris = 0; m.A3.tris = 8172; })[0]).toMatch(/A3: 0 kit triangles merged, expected 1242/);
    expect(read((m) => { m.S3.meshes = 5; })).toEqual([expect.stringMatching(/S3: 5 meshes/)]);
    expect(read((m) => { m.F3.calls = 56; })).toEqual([expect.stringMatching(/F3: 56 draw calls/)]);
    expect(read((m) => { m.T0.tris = 8604; m.T0.kitTris = 0; })[0]).toMatch(/T0: 8604 triangles/);
    expect(read((m) => { delete (m as Record<string, Reading | undefined>).A3; })).toContain('A3: not captured');
  });
});

describe('inf-kit capture merge check: demo_squad', () => {
  // Literals from the art file (the kit's parts table, highest tier of each slot) and the Draco encode (7,206 live triangles).
  const DEMO_KIT: Record<string, [Record<string, number>, number]> = {
    A1: [{ armour: 1 }, 484], A2: [{ armour: 2 }, 556], A3: [{ armour: 3 }, 616],
    S1: [{ sensors: 1 }, 160], S2: [{ sensors: 2 }, 412], S3: [{ sensors: 3 }, 572],
    F1: [{ firepower: 1 }, 310], F2: [{ firepower: 2 }, 422], F3: [{ firepower: 3 }, 546],
    full: [{ armour: 3, sensors: 3, firepower: 3 }, 1734],
  };
  const DEMO: Record<string, Reading> = {
    T0: { tiers: {}, loaded: true, tris: 7206, kitTris: 0, meshes: 6, calls: 58 },
    ...Object.fromEntries(Object.entries(DEMO_KIT).map(([id, [tiers, kit]]) => [id, { tiers, loaded: true, tris: 7206 + kit, kitTris: kit, meshes: 6, calls: 58 }])),
  };
  const readDemo = (over: (m: Record<string, Reading>) => void): string[] => {
    const m = structuredClone(DEMO);
    over(m);
    return mergeFailures(new Map(Object.entries(m)), DEMO_STATES, DEMO_ENCODED_BASE_TRIS, 'demo_squad');
  };
  it('is registered, and passes what the art file says', () => {
    expect(TEAM_CHECKS.demo_squad.states).toBe(DEMO_STATES);
    expect(TEAM_CHECKS.demo_squad.baseTris).toBe(7206);
    expect(readDemo(() => undefined)).toEqual([]);
  });
  it('fails on the Rifle Squad\'s numbers, a lost tier, a kit mesh or a draw call', () => {
    expect(mergeFailures(new Map(Object.entries(DEMO)), STATES)[0]).toBeDefined();
    expect(readDemo((m) => { m.A3.kitTris = 0; m.A3.tris = 7206; })[0]).toMatch(/A3: 0 kit triangles merged, expected 616/);
    expect(readDemo((m) => { m.full.tris = 8172 + 1734; })[0]).toMatch(/full: 9906 triangles/);
    expect(readDemo((m) => { m.S3.meshes = 7; })).toEqual([expect.stringMatching(/S3: 7 meshes/)]);
    expect(readDemo((m) => { m.F3.calls = 60; })).toEqual([expect.stringMatching(/F3: 60 draw calls/)]);
    expect(readDemo((m) => { m.T0.loaded = false; })[0]).toMatch(/T0: no demo_squad template loaded/);
  });
});

describe('inf-kit capture merge check: breach_team', () => {
  // Literals from the art file (the kit's parts table, highest tier of each slot) and the Draco encode (7,910 live triangles).
  const KIT_B: Record<string, [Record<string, number>, number]> = {
    A1: [{ armour: 1 }, 536], A2: [{ armour: 2 }, 588], A3: [{ armour: 3 }, 632],
    S1: [{ sensors: 1 }, 248], S2: [{ sensors: 2 }, 500], S3: [{ sensors: 3 }, 660],
    F1: [{ firepower: 1 }, 380], F2: [{ firepower: 2 }, 632], F3: [{ firepower: 3 }, 800],
    full: [{ armour: 3, sensors: 3, firepower: 3 }, 2092],
  };
  const BASE: Record<string, Reading> = {
    T0: { tiers: {}, loaded: true, tris: 7910, kitTris: 0, meshes: 6, calls: 58 },
    ...Object.fromEntries(Object.entries(KIT_B).map(([id, [tiers, kit]]) => [id, { tiers, loaded: true, tris: 7910 + kit, kitTris: kit, meshes: 6, calls: 58 }])),
  };
  const readB = (over: (m: Record<string, Reading>) => void): string[] => {
    const m = structuredClone(BASE);
    over(m);
    return mergeFailures(new Map(Object.entries(m)), BREACH_STATES, BREACH_ENCODED_BASE_TRIS, 'breach_team');
  };
  it('is registered, and passes what the art file says', () => {
    expect(TEAM_CHECKS.breach_team.states).toBe(BREACH_STATES);
    expect(TEAM_CHECKS.breach_team.baseTris).toBe(7910);
    expect(readB(() => undefined)).toEqual([]);
  });
  it('fails on the Demolition squad\'s numbers, a lost tier, a kit mesh or a draw call', () => {
    expect(mergeFailures(new Map(Object.entries(BASE)), DEMO_STATES, DEMO_ENCODED_BASE_TRIS)[0]).toBeDefined();
    expect(readB((m) => { m.F2.kitTris = 0; m.F2.tris = 7910; })[0]).toMatch(/F2: 0 kit triangles merged, expected 632/);
    expect(readB((m) => { m.full.tris = 7910 + 2092 + 1; })[0]).toMatch(/full: 10003 triangles/);
    expect(readB((m) => { m.S3.meshes = 7; })).toEqual([expect.stringMatching(/S3: 7 meshes/)]);
    expect(readB((m) => { m.A1.calls = 59; })).toEqual([expect.stringMatching(/A1: 59 draw calls/)]);
    expect(readB((m) => { m.T0.loaded = false; })[0]).toMatch(/T0: no breach_team template loaded/);
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
