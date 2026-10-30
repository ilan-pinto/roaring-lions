import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMacroField, buildWetField, CONTROL_TEXELS_PER_TILE as N } from './control-map';
import { buildRoadGraph } from './road-graph';
import { DECOR_RIDGE, DECOR_ROAD, WORLD_PER_LEVEL } from './shared';
import { buildTerrainSurface, smoothNormal, type TerrainSurface } from './surface';
import type { TerrainInput } from './types';
import {
  marshTexel,
  neverWater,
  PUDDLE_FLAT_NY,
  PUDDLE_LOW_BOOST,
  PUDDLE_LOW_STREAM,
  PUDDLE_MAX_SLOPE_DEG,
  PUDDLE_MAX_SLOPE_NY,
  PUDDLE_OPEN_STREAM,
  PUDDLE_RUT_STREAM,
  puddleTexel,
  WATER_RIM_TILES,
  type WetField,
} from './wet-masks';

const W = 16;

/** A flat open 16x16 wet input. */
function flatInput(patch: Partial<TerrainInput> = {}): TerrainInput {
  return {
    width: W,
    height: W,
    decor: null,
    elevation: null,
    blocked: new Uint8Array(W * W),
    cover: new Uint8Array(W * W),
    wet: true,
    ...patch,
  };
}

function fieldFor(input: TerrainInput): WetField {
  return buildWetField(input, buildRoadGraph(input), buildMacroField(input.width, input.height), true);
}

/** A surface that is NOT flat (so terraces and slopes are expressed), with
 *  its smoothing field a plane: `rise` levels per tile along x. */
function planeSurface(rise: number, terrace: ReadonlySet<number> = new Set()): TerrainSurface {
  const field = new Float32Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) field[y * W + x] = 4 + rise * x;
  const t = new Uint8Array(W * W);
  for (const i of terrace) t[i] = 1;
  return { width: W, height: W, levels: null, terrace: t, field, flat: false };
}

/** The first texel (as a world point) of the flat input whose puddle mask is
 *  on, or throws: the control every never-water case is measured against. */
function aPuddleTexel(input: TerrainInput, surface: TerrainSurface, field: WetField): [number, number] {
  for (let j = 0; j < W * N; j++) {
    for (let i = 0; i < W * N; i++) {
      const px = (i + 0.5) / N;
      const pz = (j + 0.5) / N;
      if (puddleTexel(input, surface, field, px, pz) >= 0.5) return [px, pz];
    }
  }
  throw new Error('no puddle texel on the control map: the never-water cases would be vacuous');
}

describe('wet-masks.ts imports (pure, three-free, pinned)', () => {
  it('imports exactly the tile hash, the haze maths, the road graph, the marsh function, the surface and the input type', () => {
    const src = readFileSync(join(__dirname, 'wet-masks.ts'), 'utf8');
    const specs = [...src.matchAll(/^import [^;]*? from '([^']+)';/gms)].map((m) => m[1]).sort();
    expect(specs).toEqual(['../../tile-hash', '../haze', './road-graph', './shared', './surface', './types']);
    expect(src).not.toMatch(/from 'three/);
    expect(src).not.toContain("from './control-map'");
  });
});

describe('the constants (literals)', () => {
  it('holds the brief\'s values', () => {
    expect(PUDDLE_FLAT_NY).toBe(0.985);
    expect(PUDDLE_MAX_SLOPE_DEG).toBe(10);
    expect(PUDDLE_LOW_BOOST).toBe(0.06);
    expect(WATER_RIM_TILES).toBe(0.06);
    expect(PUDDLE_MAX_SLOPE_NY).toBeCloseTo(0.98481, 4);
  });

  it('draws its three tileHash streams from offsets no other terrain or decal source uses', () => {
    const dir = __dirname;
    const files = [
      ...readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'wet-masks.ts').map((f) => join(dir, f)),
      ...readdirSync(join(dir, '..'))
        .filter((f) => /^decal-.*\.ts$/.test(f) && !f.endsWith('.test.ts'))
        .map((f) => join(dir, '..', f)),
    ];
    expect(files.length).toBeGreaterThan(40);
    const all = [...PUDDLE_RUT_STREAM, ...PUDDLE_OPEN_STREAM, ...PUDDLE_LOW_STREAM];
    // as literals, so a retyped constant here cannot drift from the source
    expect(all).toEqual([14011, 14153, 14243, 14369, 14411, 14519]);
    expect(new Set(all).size).toBe(6);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const n of all) expect(text.includes(String(n)), `${f} mentions ${n}`).toBe(false);
    }
  });
});

describe('puddleTexel -- each never-water rule, on a constructed tile', () => {
  const input = flatInput();
  const surface = buildTerrainSurface(input); // flat
  const field = fieldFor(input);
  const [px, pz] = aPuddleTexel(input, surface, field);
  const tx = Math.floor(px);
  const tz = Math.floor(pz);
  const ti = tz * W + tx;

  it('control: the chosen texel holds a puddle on plain flat open ground', () => {
    expect(puddleTexel(input, surface, field, px, pz)).toBeGreaterThanOrEqual(0.5);
  });

  it('a building pad (a blocked tile): G = 0', () => {
    const blocked = new Uint8Array(W * W);
    blocked[ti] = 1;
    const i2 = flatInput({ blocked });
    expect(puddleTexel(i2, buildTerrainSurface(i2), fieldFor(i2), px, pz)).toBe(0);
  });

  it('a ^ top (a ridge tile): G = 0', () => {
    const blocked = new Uint8Array(W * W);
    const decor = new Uint8Array(W * W);
    blocked[ti] = 1;
    decor[ti] = DECOR_RIDGE;
    const i2 = flatInput({ blocked, decor });
    expect(puddleTexel(i2, buildTerrainSurface(i2), fieldFor(i2), px, pz)).toBe(0);
  });

  it('a crown (a smooth dome the draw mask cleared): G = 0', () => {
    const crown = new Uint8Array(W * W);
    crown[ti] = 1;
    const i2 = flatInput({ crown });
    expect(puddleTexel(i2, buildTerrainSurface(i2), fieldFor(i2), px, pz)).toBe(0);
  });

  it('a terrace top on the drawn surface: G = 0', () => {
    // the same open tile, on a surface that marks the tile a terrace
    const plane = planeSurface(0, new Set([ti]));
    expect(puddleTexel(input, planeSurface(0), field, px, pz)).toBeGreaterThanOrEqual(0.5); // control
    expect(puddleTexel(input, plane, field, px, pz)).toBe(0);
  });

  it('a slope over 10 degrees: G = 0; at 9 degrees the same texel still holds its puddle', () => {
    // WORLD_PER_LEVEL world units a level, one tile a unit: rise = tan(slope) / WORLD_PER_LEVEL
    const rise = (deg: number) => Math.tan((deg * Math.PI) / 180) / WORLD_PER_LEVEL;
    const s11 = planeSurface(rise(11));
    const s9 = planeSurface(rise(9));
    // the fixtures really are 11 and 9 degrees: cos(11) = 0.98163, cos(9) = 0.98769
    expect(smoothNormal(s11, px, pz)[1]).toBeCloseTo(0.98163, 3);
    expect(smoothNormal(s9, px, pz)[1]).toBeCloseTo(0.98769, 3);
    expect(puddleTexel(input, s9, field, px, pz)).toBeGreaterThanOrEqual(0.5);
    expect(puddleTexel(input, s11, field, px, pz)).toBe(0);
  });

  it('the flat threshold (0.985) is stricter than the slope rule (cos 10 degrees): two numbers, not one', () => {
    expect(PUDDLE_FLAT_NY).toBeGreaterThan(PUDDLE_MAX_SLOPE_NY);
  });

  it('neverWater is the one predicate: each rule, alone', () => {
    const open = flatInput();
    const flat = buildTerrainSurface(open);
    expect(neverWater(open, flat, 'open', 3, 3, 1)).toBe(false);
    expect(neverWater(open, flat, 'pad', 3, 3, 1)).toBe(true);
    expect(neverWater(open, flat, 'rock', 3, 3, 1)).toBe(true);
    expect(neverWater(open, flat, 'open', 3, 3, 0.98)).toBe(true);
    expect(neverWater(open, planeSurface(0, new Set([3 * W + 3])), 'open', 3, 3, 1)).toBe(true);
  });
});

describe('marshTexel', () => {
  it('is zero without decor and positive inside a marsh', () => {
    expect(marshTexel(flatInput(), 5.5, 5.5)).toBe(0);
    const decor = new Uint8Array(W * W);
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) decor[y * W + x] = 6;
    const i = flatInput({ decor });
    let max = 0;
    for (let z = 3; z < 13; z += 0.125) for (let x = 3; x < 13; x += 0.125) max = Math.max(max, marshTexel(i, x, z));
    expect(max).toBeGreaterThanOrEqual(0.5);
  });
});

describe('puddleTexel -- the road term', () => {
  // an east-west road along row 8: its centreline is z = 8.5
  const decor = new Uint8Array(W * W);
  for (let x = 0; x < W; x++) decor[8 * W + x] = DECOR_ROAD;
  const road = flatInput({ decor });
  const surface = buildTerrainSurface(road);
  const field = fieldFor(road);
  const at = (d: number, x: number) => puddleTexel(road, surface, field, x, 8.5 + d);

  it('holds puddles inside the rut band, none on the crown of the road or on its verge, and the open term never reaches a road tile', () => {
    let inBand = 0;
    let band = 0;
    for (let x = 2; x < 14; x += 1 / 16) {
      for (const d of [0.1, 0.17, 0.24]) {
        band++;
        if (at(d, x) >= 0.5) inBand++;
      }
      expect(at(0.0, x)).toBeLessThan(0.5); // the crown between the ruts
      expect(at(0.33, x)).toBeLessThan(0.5); // the verge
    }
    // the pass rate is the rut fill (0.56), not 1 and not 0
    expect(inBand / band).toBeGreaterThan(0.4);
    expect(inBand / band).toBeLessThan(0.75);
  });

  it('an 11 degree slope switches a rut puddle off, and 9 degrees does not', () => {
    const rise = (deg: number) => Math.tan((deg * Math.PI) / 180) / WORLD_PER_LEVEL;
    let x = 2;
    while (at(0.17, x) < 0.5) x += 1 / 16;
    expect(puddleTexel(road, planeSurface(rise(9)), field, x, 8.67)).toBeGreaterThanOrEqual(0.5);
    expect(puddleTexel(road, planeSurface(rise(11)), field, x, 8.67)).toBe(0);
  });
});
