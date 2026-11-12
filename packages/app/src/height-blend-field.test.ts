/**
 * GH-1226 S2 (G3): the height-blend field on the real maps. Lives in `packages/app` for the reason `scatter-density.test.ts` gives
 * (`packages/render` may not import `@lions/data`). The synthetic cases and the encoding are in
 * `packages/render/src/three/terrain/height-blend-field.test.ts`.
 *
 *  - Every flat map bakes R 0 and G 128 at every texel.
 *  - Coverage on every relief map is within 3 points of the design's section 1.4 census (literals below, read once with a
 *    throwaway spec in the design PR), from the BAKED bytes and the design's smooth formulas typed out here as literals.
 *  - The TPI reads `smoothLevel`: from `surfaceLevel`, `tel_marum_2`'s hollow reads 22.8%, not 4.1%.
 *  - A collapse splices to the bytes a full bake makes, on real maps, chained, through the real `Sim`.
 */
import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { applyTerrain, maps, parseMap, structures as structureCatalogue, paletteColor, type MapId, type MapJson } from '@lions/data';
import { composeTerrainFrom, type ComposedTerrainBuild } from '@lions/render/three';
import {
  bakeHeightBlendField,
  buildRoadGraph,
  buildTerrainSurface,
  roadDistanceAt,
  spliceHeightBlendField,
  surfaceWeightsAt,
  type TerrainInput,
} from '@lions/render/terrain';
import { rendererOptionsFor } from './renderer-options';
import { terrainTonesFor } from './terrain-themes';

const HIGH = { colorVision: 'default', quality: 'high' } as const;
const BACKGROUND = paletteColor('shadow.1');
const MAP_IDS = Object.keys(maps) as MapId[];

function simFor(source: MapId | MapJson) {
  const pm = parseMap(typeof source === 'string' ? maps[source] : source);
  const sim = new Sim({ seed: 20261112, width: pm.width, height: pm.height, capacity: 64 });
  applyTerrain(pm, sim);
  const idx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) {
    idx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of pm.structures) {
    const t = idx.get(b.type);
    if (t === undefined) throw new Error(`map ${pm.id}: unknown structure type ${b.type}`);
    sim.addStructure(t, b.tiles);
  }
  return { pm, sim };
}

function loadInput(id: MapId): TerrainInput {
  const { pm, sim } = simFor(id);
  return {
    width: pm.width,
    height: pm.height,
    decor: pm.decor,
    elevation: pm.elevation,
    blocked: sim.blocked,
    cover: sim.cover,
    boulder: pm.boulder,
    familyRemap: terrainTonesFor(pm).familyRemap,
    waterside: terrainTonesFor(pm).waterside,
  };
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Section 1.4's method: ground texels only (off road, no terrace, soil weight above 0.5), the section 3.2 formulas with no patch
 *  and no texture edge, as MEAN weights, in percent. All the numbers are literals. */
function coverage(input: TerrainInput, surfaceField: { data: Uint8Array; width: number; height: number }): { rock: number; hollow: number } {
  const surface = buildTerrainSurface(input);
  const graph = buildRoadGraph(input);
  let n = 0;
  let rock = 0;
  let hollow = 0;
  for (let j = 0; j < surfaceField.height; j++) {
    for (let i = 0; i < surfaceField.width; i++) {
      const x = (i + 0.5) / 4;
      const z = (j + 0.5) / 4;
      if (surface.terrace[Math.floor(z) * input.width + Math.floor(x)] !== 0) continue;
      if (roadDistanceAt(graph, x, z) < 1) continue;
      const w = surfaceWeightsAt(input, x, z);
      if (w.open + w.knoll + 0.5 * w.scrub <= 0.5) continue;
      const o = (j * surfaceField.width + i) * 4;
      const s = (surfaceField.data[o] * 64) / 255;
      const t = (surfaceField.data[o + 1] - 128) / 127;
      const e = Math.min(1, smoothstep(10, 22, s) + 0.6 * smoothstep(0.15, 0.45, t));
      n++;
      rock += e;
      hollow += smoothstep(0.12, 0.4, -t) * (1 - smoothstep(8, 16, s)) * (1 - e);
    }
  }
  return { rock: (100 * rock) / n, hollow: (100 * hollow) / n };
}

/** Design section 1.4, exposed rock and hollow fill, percent. */
const CENSUS: Record<string, readonly [number, number]> = {
  tel_marum: [4.2, 2.8],
  tel_marum_1: [24.9, 8.2],
  tel_marum_2: [5.4, 4.1],
  tel_marum_3: [2.4, 2.4],
  qarn_hadid: [18.4, 8.2],
  qarn_hadid_2: [16.2, 7.7],
  qarn_hadid_3: [7.0, 4.6],
  umm_zeitoun: [25.8, 10.2],
  umm_zeitoun_2: [9.9, 4.3],
  umm_zeitoun_3: [20.6, 8.2],
  umm_zeitoun_4: [6.7, 3.9],
  beit_sahwan_2: [4.2, 3.9],
  beit_sahwan_4: [18.0, 8.8],
  deir_amun: [15.6, 7.8],
  deir_amun_2: [19.0, 10.6],
  deir_amun_3: [11.0, 6.3],
  khan_rafid_2: [4.8, 1.2],
  milh_flats: [15.0, 6.2],
  milh_flats_l: [8.6, 4.5],
  rujm_sawda: [11.3, 5.8],
  wadi_tarfan: [12.2, 5.6],
  wadi_tarfan_l: [6.9, 3.6],
  wadi_halam_2: [17.9, 11.9],
  wadi_halam_4: [9.6, 6.6],
};

const hasRelief = (id: MapId): boolean => {
  const e = parseMap(maps[id]).elevation;
  return e !== null && e.some((v) => v !== 0);
};

describe('the field on every shipped map', () => {
  it('names every relief map the census covers, and only those (no map slips past it)', () => {
    const relief = MAP_IDS.filter(hasRelief);
    for (const id of Object.keys(CENSUS)) expect(relief, id).toContain(id);
    // Relief maps the design table omits (the wetland ones, the other greens) bake all the same; the table is a subset.
    expect(relief.length).toBeGreaterThanOrEqual(Object.keys(CENSUS).length);
  });

  it.each(MAP_IDS.filter((id) => !hasRelief(id)))('bakes %s (no relief) to exactly R 0, G 128 everywhere', (id) => {
    const input = loadInput(id);
    const f = bakeHeightBlendField(buildTerrainSurface(input), input.width, input.height);
    expect(f.data.length).toBe(input.width * input.height * 16 * 4);
    for (let k = 0; k < f.data.length; k += 4) {
      if (f.data[k] !== 0 || f.data[k + 1] !== 128) throw new Error(`${id}: texel ${k / 4} reads R ${f.data[k]} G ${f.data[k + 1]}`);
    }
  });

  it.each(Object.keys(CENSUS))('covers %s within 3 points of the design census', (id) => {
    const input = loadInput(id as MapId);
    const f = bakeHeightBlendField(buildTerrainSurface(input), input.width, input.height);
    const { rock, hollow } = coverage(input, f);
    const [wantRock, wantHollow] = CENSUS[id] as readonly [number, number];
    expect(Math.abs(rock - wantRock), `${id} rock ${rock.toFixed(1)} against ${wantRock}`).toBeLessThanOrEqual(3);
    expect(Math.abs(hollow - wantHollow), `${id} hollow ${hollow.toFixed(1)} against ${wantHollow}`).toBeLessThanOrEqual(3);
  });

  it('is deterministic on a real map: two bakes are byte-equal', () => {
    const input = loadInput('tel_marum_1');
    const surface = buildTerrainSurface(input);
    const a = bakeHeightBlendField(surface, input.width, input.height);
    const b = bakeHeightBlendField(surface, input.width, input.height);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });

  it('reads the TPI from the SMOOTH surface: tel_marum_2 keeps its hollow near 4.1%, not the terrace-fed 22.8%', () => {
    const input = loadInput('tel_marum_2');
    const f = bakeHeightBlendField(buildTerrainSurface(input), input.width, input.height);
    const { hollow } = coverage(input, f);
    expect(hollow).toBeGreaterThan(2);
    expect(hollow).toBeLessThan(7);
  });
});

describe('a collapse splices the field to the bytes a full bake makes', () => {
  interface Rig {
    readonly sim: Sim;
    build(prev: ComposedTerrainBuild | null): ComposedTerrainBuild;
  }
  function rig(source: MapId): Rig {
    const { pm, sim } = simFor(source);
    const tones = rendererOptionsFor(pm, HIGH, '/').terrainTones;
    return {
      sim,
      build: (prev) =>
        composeTerrainFrom(prev?.state ?? null, sim, pm.decor, pm.elevation, () => true, tones, paletteColor, BACKGROUND, null, false),
    };
  }

  function walk(id: MapId, structures: readonly number[], margin?: { level: number; box: number }): number {
    const r = rig(id);
    let built = r.build(null);
    const { width, height } = built.composed.input;
    const field = bakeHeightBlendField(buildTerrainSurface(built.composed.input), width, height);
    let mismatches = 0;
    let spliced = 0;
    for (const s of structures) {
      expect(r.sim.structures.alive[s], `${id}: structure ${s} stands`).toBe(1);
      r.sim.debugDestroyStructure(s);
      built = r.build(null);
      const surface = buildTerrainSurface(built.composed.input);
      const written = spliceHeightBlendField(field, surface, margin?.level, margin?.box);
      const full = bakeHeightBlendField(surface, width, height);
      // It really spliced: a whole-map rewrite would pass the comparison vacuously. (A collapse that reopens a pad whose fill
      // equals its neighbours changes no smoothing source, so a step may legitimately write 0; the walk counts the others.)
      expect(written, `${id} s${s}`).not.toBeNull();
      expect(written as number, `${id} s${s}: a small region`).toBeLessThan((width * height * 16) / 10);
      if ((written as number) > 0) spliced++;
      if (!Buffer.from(field.data).equals(Buffer.from(full.data))) {
        mismatches++;
        field.data.set(full.data);
      }
    }
    expect(spliced, `${id}: collapses that moved the field`).toBeGreaterThanOrEqual(1);
    return mismatches;
  }

  it('umm_zeitoun_4 (relief), five collapses in a row, each spliced from the last', () => {
    expect(walk('umm_zeitoun_4', [1, 29, 54, 13, 43])).toBe(0);
  }, 60_000);

  it('beit_sahwan_2 (relief), four collapses in a row', () => {
    expect(walk('beit_sahwan_2', [0, 9, 60, 150])).toBe(0);
  }, 60_000);

  it('umm_zeitoun_2 (highland), two collapses in a row', () => {
    expect(walk('umm_zeitoun_2', [14, 19])).toBe(0);
  }, 60_000);

  it('a box margin one texel short (5, not 6) is not byte-identical on the same walk (the falsification, kept)', () => {
    expect(walk('umm_zeitoun_4', [1, 29, 54, 13, 43], { level: 2, box: 5 })).toBeGreaterThan(0);
  }, 60_000);

  it('a level margin one tile short (1, not 2) is not byte-identical on the same walk', () => {
    expect(walk('umm_zeitoun_4', [1, 29, 54, 13, 43], { level: 1, box: 6 })).toBeGreaterThan(0);
  }, 60_000);
});
