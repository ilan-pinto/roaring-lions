import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWetField, CONTROL_TEXELS_PER_TILE as N } from './control-map';
import { buildRoadGraph } from './road-graph';
import { DECOR_ROAD, WORLD_PER_LEVEL } from './shared';
import { buildTerrainSurface, smoothNormal, type TerrainSurface } from './surface';
import type { TerrainInput } from './types';
import * as masks from './wet-masks';
import {
  marshTexel,
  neverWater,
  PUDDLE_MAX_SLOPE_DEG,
  PUDDLE_MAX_SLOPE_NY,
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
  return buildWetField(input, buildRoadGraph(input), buildTerrainSurface(input));
}

/** The same field with the water table far BELOW the ground, so no road counts as low and the ford (GH-940) is off:
 *  the rut-puddle and never-water tests are about the ruts alone. */
function rutsOnly(input: TerrainInput): WetField {
  return { ...fieldFor(input), waterLevel: -100 };
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

/** An east-west road along row 8 of the 16x16 map: its centreline is z = 8.5. */
function roadInput(patch: Partial<TerrainInput> = {}): TerrainInput {
  const decor = new Uint8Array(W * W);
  for (let x = 0; x < W; x++) decor[8 * W + x] = DECOR_ROAD;
  return flatInput({ decor, ...patch });
}

/** The first texel (as a world point) of the road whose puddle mask is on, or
 *  throws: the control every never-water case is measured against. Puddles
 *  live only in a road's rut band (there are none on open ground), so the
 *  control texel is a road texel. */
function aPuddleTexel(input: TerrainInput, surface: TerrainSurface, field: WetField): [number, number] {
  // from tile 5 east: the slope cases tilt a plane, and a texel at the map's
  // edge reads a clamped (flat) normal
  for (let j = 0; j < W * N; j++) {
    for (let i = 5 * N; i < W * N; i++) {
      const px = (i + 0.5) / N;
      const pz = (j + 0.5) / N;
      if (puddleTexel(input, surface, field, px, pz) >= 0.5) return [px, pz];
    }
  }
  throw new Error('no puddle texel on the control map: the never-water cases would be vacuous');
}

describe('wet-masks.ts imports (pure, three-free, pinned)', () => {
  it('imports exactly the tile hash, the road graph, the marsh function, the surface and the input type', () => {
    const src = readFileSync(join(__dirname, 'wet-masks.ts'), 'utf8');
    const specs = [...src.matchAll(/^import [^;]*? from '([^']+)';/gms)].map((m) => m[1]).sort();
    expect(specs).toEqual(['../../tile-hash', './road-graph', './shared', './surface', './types']);
    expect(src).not.toMatch(/from 'three/);
    expect(src).not.toContain("from './control-map'");
  });
});

describe('the constants (literals)', () => {
  it('holds the brief\'s values', () => {
    expect(PUDDLE_MAX_SLOPE_DEG).toBe(10);
    expect(WATER_RIM_TILES).toBe(0.06);
    expect(PUDDLE_MAX_SLOPE_NY).toBeCloseTo(0.98481, 4);
  });

  it('has no open-ground or low-ground puddle left to export (the lead\'s S-L1 ruling)', () => {
    const names = Object.keys(masks);
    for (const gone of [
      'PUDDLE_OPEN_THRESHOLD',
      'PUDDLE_OPEN_MACRO_WEIGHT',
      'PUDDLE_OPEN_FINE_CYCLES',
      'PUDDLE_OPEN_STREAM',
      'PUDDLE_LOW_BOOST',
      'PUDDLE_LOW_CYCLES',
      'PUDDLE_LOW_STREAM',
      'PUDDLE_FLAT_NY',
      'openPuddleTerm',
      'openPuddleScore',
      'lowPuddleTerm',
    ]) {
      expect(names, gone).not.toContain(gone);
    }
    expect(names).toContain('PUDDLE_RUT_STREAM'); // the list is real, not empty
  });

  it('draws its one tileHash stream from an offset no other terrain or decal source uses', () => {
    const dir = __dirname;
    const files = [
      ...readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'wet-masks.ts').map((f) => join(dir, f)),
      ...readdirSync(join(dir, '..'))
        .filter((f) => /^decal-.*\.ts$/.test(f) && !f.endsWith('.test.ts'))
        .map((f) => join(dir, '..', f)),
    ];
    expect(files.length).toBeGreaterThan(40);
    const all = [...PUDDLE_RUT_STREAM];
    // as literals, so a retyped constant here cannot drift from the source
    expect(all).toEqual([14011, 14153]);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const n of all) expect(text.includes(String(n)), `${f} mentions ${n}`).toBe(false);
    }
  });
});

describe('puddleTexel -- there is no puddle on open ground', () => {
  it('every texel of a flat open map reads 0, and the map has thousands of them', () => {
    const input = flatInput();
    const surface = buildTerrainSurface(input);
    const field = fieldFor(input);
    let texels = 0;
    let over = 0;
    for (let j = 0; j < W * N; j++) {
      for (let i = 0; i < W * N; i++) {
        texels++;
        if (puddleTexel(input, surface, field, (i + 0.5) / N, (j + 0.5) / N) > 0) over++;
      }
    }
    expect(texels).toBe(16 * 16 * 64);
    expect(over).toBe(0);
  });

  it('nor do a bowl\'s open floor texels, however far below the median it sits', () => {
    // an open floor (tiles 3..12) 2 levels below a rim: the plan's low-ground boost lived here
    const elevation = new Uint8Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) elevation[y * W + x] = x >= 3 && x < 13 && y >= 3 && y < 13 ? 0 : 2;
    const input = flatInput({ elevation });
    const surface = buildTerrainSurface(input);
    expect(surface.flat).toBe(false);
    const field = fieldFor(input);
    let floorFlat = 0;
    let over = 0;
    for (let j = 3 * N; j < 13 * N; j++) {
      for (let i = 3 * N; i < 13 * N; i++) {
        const px = (i + 0.5) / N;
        const pz = (j + 0.5) / N;
        if (smoothNormal(surface, px, pz)[1] > 0.985) floorFlat++;
        if (puddleTexel(input, surface, field, px, pz) > 0) over++;
      }
    }
    expect(floorFlat, 'a real flat floor').toBeGreaterThan(3000);
    expect(over).toBe(0);
  });
});

describe('puddleTexel -- each never-water rule, on a constructed road tile', () => {
  const input = roadInput();
  const surface = buildTerrainSurface(input); // flat
  const field = rutsOnly(input);
  const [px, pz] = aPuddleTexel(input, surface, field);
  const tx = Math.floor(px);
  const tz = Math.floor(pz);
  const ti = tz * W + tx;

  it('control: the chosen texel holds a puddle in a rut of the flat road', () => {
    expect(tz).toBe(8);
    expect(puddleTexel(input, surface, field, px, pz)).toBeGreaterThanOrEqual(0.5);
  });

  it('a building pad or a rock top (the tile kind): G = 0 where the same texel held a puddle', () => {
    expect(puddleTexel(input, surface, { ...field, kindAt: () => 'pad' }, px, pz)).toBe(0);
    expect(puddleTexel(input, surface, { ...field, kindAt: () => 'rock' }, px, pz)).toBe(0);
    expect(puddleTexel(input, surface, { ...field, kindAt: () => 'road' }, px, pz)).toBeGreaterThanOrEqual(0.5);
  });

  it('a crown (a smooth dome the draw mask cleared): G = 0', () => {
    const crown = new Uint8Array(W * W);
    crown[ti] = 1;
    const i2 = roadInput({ crown });
    expect(puddleTexel(i2, buildTerrainSurface(i2), rutsOnly(i2), px, pz)).toBe(0);
  });

  it('a terrace top on the drawn surface: G = 0', () => {
    // the same road tile, on a surface that marks the tile a terrace
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
  const road = roadInput();
  const surface = buildTerrainSurface(road);
  const field = rutsOnly(road);
  const at = (d: number, x: number) => puddleTexel(road, surface, field, x, 8.5 + d);

  it('holds puddles inside the rut band, none on the crown of the road or on its verge', () => {
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
    // the pass rate follows the rut fill (0.62 since GH-940, it was 0.56; the soft edge and the band's own edges
    // read about 0.51 here), not 1 and not 0
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

describe('lowness, the flood margin and the ford (GH-940)', () => {
  const MARSH = 6; // DECOR_MARSH, as the marshTexel test above writes it
  /** A 16x16 flat map with a marsh block over tiles 6..9 (a 4x4 block, edges at 6 and 10). */
  function marshInput(patch: Partial<TerrainInput> = {}): TerrainInput {
    const decor = new Uint8Array(W * W);
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) decor[y * W + x] = MARSH;
    return flatInput({ decor, ...patch });
  }

  it('lowness is 1 at or under the table plus 0.6 and 0 from 1.1 above it, 0.5 half way (literals)', () => {
    expect(masks.lowness(-3, 0)).toBe(1);
    expect(masks.lowness(0.6, 0)).toBe(1);
    expect(masks.lowness(0.85, 0)).toBeCloseTo(0.5, 12);
    expect(masks.lowness(1.1, 0)).toBe(0);
    expect(masks.lowness(7, 0)).toBe(0);
    expect(masks.lowness(5.85, 5)).toBeCloseTo(0.5, 12);
  });

  it('marshEdgeDistance is 0 inside a marsh tile, the gap to its edge outside, and Infinity past 3 tiles', () => {
    const input = marshInput();
    expect(masks.marshEdgeDistance(input, 7.5, 7.5)).toBe(0);
    expect(masks.marshEdgeDistance(input, 5.5, 7.5)).toBeCloseTo(0.5, 12);
    expect(masks.marshEdgeDistance(input, 11.25, 7.5)).toBeCloseTo(1.25, 12);
    expect(masks.marshEdgeDistance(input, 2.5, 7.5)).toBe(Infinity);
    // a corner is the hypotenuse
    expect(masks.marshEdgeDistance(input, 11, 11)).toBeCloseTo(Math.SQRT2, 12);
    expect(masks.marshEdgeDistance(flatInput(), 7.5, 7.5)).toBe(Infinity);
  });

  it('the pool is zero inside the marsh and past the 2 tile reach, whatever the noise, and the share falls with the distance', () => {
    const input = marshInput();
    const surface = buildTerrainSurface(input);
    const field = fieldFor(input);
    expect(field.waterLevel, 'a flat map has no relief to be above the table').toBe(0);
    const share = (lo: number, hi: number): number => {
      let n = 0;
      let on = 0;
      for (let z = 0; z < W; z += 1 / N) {
        for (let x = 0; x < W; x += 1 / N) {
          const px = x + 0.5 / N;
          const pz = z + 0.5 / N;
          const d = masks.marshEdgeDistance(input, px, pz);
          if (!(d > lo && d <= hi)) continue;
          n++;
          if (masks.poolTexel(input, surface, field, px, pz) >= 0.5) on++;
        }
      }
      return on / n;
    };
    for (const [px, pz] of [[7.5, 7.5], [6.2, 8.1], [9.9, 9.9]] as const) expect(masks.poolTexel(input, surface, field, px, pz)).toBe(0);
    expect(share(2, 3), 'nothing past the reach').toBe(0);
    const near = share(0, 0.5);
    const mid = share(0.5, 1.2);
    const far = share(1.2, 2);
    // the fill is 0.85 x (1 - d / 2): about 0.7 at 0.3, 0.5 at 0.85, 0.2 at 1.6 (the soft edge and the finite sample move it a little)
    expect(near).toBeGreaterThan(0.55);
    expect(near).toBeLessThan(0.85);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.62);
    expect(far).toBeGreaterThan(0.04);
    expect(far).toBeLessThan(0.3);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
  });

  it('is zero above the water table: the same margin on ground 2 levels higher holds nothing (the control is not vacuous)', () => {
    const input = marshInput();
    const flat = buildTerrainSurface(input);
    // the water table is the marsh's own level; a plane that rises 0.5 a tile puts the far side of the margin over 0.6 above it
    const level = new Uint8Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) level[y * W + x] = x < 10 ? 2 : 4;
    const high = buildTerrainSurface(marshInput({ elevation: level }));
    expect(high.flat).toBe(false);
    const fieldFlat = fieldFor(input);
    const fieldHigh = buildWetField(marshInput({ elevation: level }), buildRoadGraph(input), high);
    expect(fieldHigh.waterLevel, 'the table is the marsh tiles` own level').toBe(2);
    let flatOn = 0;
    let eastOn = 0;
    let westOn = 0;
    for (let z = 4; z < 12; z += 1 / N) {
      for (let x = 10.05; x < 12; x += 1 / N) {
        if (masks.poolTexel(input, flat, fieldFlat, x, z) >= 0.5) flatOn++;
        if (masks.poolTexel(marshInput({ elevation: level }), high, fieldHigh, x, z) >= 0.5) eastOn++;
      }
      for (let x = 4.05; x < 5.95; x += 1 / N) if (masks.poolTexel(marshInput({ elevation: level }), high, fieldHigh, x, z) >= 0.5) westOn++;
    }
    expect(flatOn, 'on flat ground the east margin floods').toBeGreaterThan(100);
    expect(westOn, 'the west margin is at the marsh`s own level and floods').toBeGreaterThan(100);
    expect(eastOn, 'the east margin is 2 levels above the table and does not').toBe(0);
  });

  it('is zero on a grove, a building pad or a rock top beside the marsh, and a map with no marsh has no pool', () => {
    const input = marshInput();
    const surface = buildTerrainSurface(input);
    const field = fieldFor(input);
    let px = 0;
    let pz = 0;
    for (let z = 5; z < 6 && px === 0; z += 1 / N) for (let x = 6; x < 10; x += 1 / N) if (masks.poolTexel(input, surface, field, x, z) >= 0.5) { px = x; pz = z; break; }
    expect(px, 'a pool texel beside the marsh to turn off').toBeGreaterThan(0);
    for (const kind of ['grove', 'knoll', 'pad', 'rock'] as const) expect(masks.poolTexel(input, surface, { ...field, kindAt: () => kind }, px, pz), kind).toBe(0);
    expect(masks.poolTexel(input, surface, { ...field, kindAt: () => 'scrub' }, px, pz)).toBeGreaterThanOrEqual(0.5);
    const dry = flatInput();
    expect(masks.poolTexel(dry, buildTerrainSurface(dry), fieldFor(dry), px, pz)).toBe(0);
  });

  it('the ford floods a road in low ground across its whole width in stretches, and not a road above the table', () => {
    const road = roadInput();
    const surface = buildTerrainSurface(road);
    const field = fieldFor(road);
    expect(field.waterLevel).toBe(0);
    let on = 0;
    let total = 0;
    let crown = 0;
    let verge = 0;
    let offRoad = 0;
    for (let x = 1; x < 15; x += 1 / 16) {
      total++;
      if (masks.puddleTexel(road, surface, field, x, 8.5 + 0.45) > 0) offRoad++;
      if (masks.puddleTexel(road, surface, field, x, 8.5) >= 0.5) crown++;
      if (masks.puddleTexel(road, surface, field, x, 8.5 + 0.33) >= 0.5) verge++;
      if (masks.puddleTexel(road, surface, field, x, 8.5 + 0.17) >= 0.5) on++;
    }
    // The crown of the road holds water exactly where the ford passes (the ruts never reach it): about half of it
    expect(crown / total).toBeGreaterThan(0.25);
    expect(crown / total).toBeLessThan(0.75);
    expect(verge / total, 'the ford reaches the verge (0.33 is inside the road`s 0.36 half width)').toBeGreaterThan(0.2);
    expect(offRoad, 'and stops at the road: 0.45 off the centreline is grass').toBe(0);
    expect(on / total).toBeGreaterThan(0.5);
    // The same road with the water table 5 levels under it: ruts only, no crown water.
    const high = rutsOnly(road);
    let crownHigh = 0;
    for (let x = 1; x < 15; x += 1 / 16) if (masks.puddleTexel(road, surface, high, x, 8.5) >= 0.5) crownHigh++;
    expect(crownHigh).toBe(0);
  });
});
