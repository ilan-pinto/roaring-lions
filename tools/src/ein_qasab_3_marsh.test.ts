// The lower causeway (Ein Qasab III, GH-912 MDD 3.3), measured on the world it builds.
//
// The same two halves as ein_qasab_marsh.test.ts, for the map with the most marsh in the game:
// the WATER half is S-4 on this realisation (25-35% open water inside the `~` tiles, no reed
// standing on it), because the water field is world-anchored and the share is a property of
// ONE realisation, so the channels' shape is the lever when it misses; the BUDGET half is the
// placed-decor triangle census against the 0.9 M ceiling (rain-terrain spec decision 11), which
// MDD G7 flagged for exactly this map: 370 marsh tiles at three reed clumps a tile.
//
// The census is `tools/terrain/wetland_census.py` read by a test. It counts the oak, willow and
// shrub at their Meshy CAPS (the worst case: those three families are stand-ins until P3), the
// reeds and wet grass at their builders' triangle counts, and the rocks at the shipped GLBs'.
// The per-variant figures below are LITERALS from that tool, run on this commit; the placement
// counts are the placer's own output. The same tool reads 809,940 on `ein_qasab` (90%), which is
// the number the spec records, so the figures are not a re-derivation of the code under test.
//
// Oracles are literals. `marshWaterAt` and `decorPlacements` are the only imports from the code
// under test, because the share and the counts ARE their output.
import { describe, expect, it } from 'vitest';
import { Sim } from '../../packages/sim/src/sim';
import { applyTerrain, maps, parseMap, structures as structureCatalogue, type MapJson } from '@lions/data';
import { decorPlacements, type TerrainInput } from '../../packages/render/src/three/terrain/index';
import { buildTerrainSurface } from '../../packages/render/src/three/terrain/surface';
import { terrainTonesFor } from '../../packages/app/src/terrain-themes';
import { marshWaterAt } from '../../packages/render/src/three/terrain/shared';

const json = maps.ein_qasab_3 as MapJson;
const map = parseMap(json);
const W = map.width;
const H = map.height;
const rows = json.rows;
const symbolAt = (x: number, y: number): string => rows[y]?.[x] ?? '?';

function build(): { input: TerrainInput; surface: ReturnType<typeof buildTerrainSurface> } {
  const sim = new Sim({ seed: 20260727, width: W, height: H, capacity: 256 });
  applyTerrain(map, sim);
  const idx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) {
    idx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of map.structures) {
    const t = idx.get(b.type);
    if (t === undefined) throw new Error(`unknown structure type ${b.type}`);
    sim.addStructure(t, b.tiles);
  }
  const tones = terrainTonesFor(map);
  const input: TerrainInput = {
    width: W,
    height: H,
    decor: map.decor,
    elevation: map.elevation,
    blocked: sim.blocked,
    cover: sim.cover,
    boulder: sim.boulder,
    groveFamily: tones.groveFamily,
    openScatter: tones.openScatter,
    familyRemap: tones.familyRemap,
    waterside: tones.waterside,
    propMix: tones.propMix,
  };
  return { input, surface: buildTerrainSurface(input) };
}

const marshTiles: [number, number][] = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (symbolAt(x, y) === '~') marshTiles.push([x, y]);

describe('Ein Qasab III: the fen (S-4)', () => {
  it('is a wetland map with 370 marsh tiles: two full-width channels and the meanders between', () => {
    expect(json.terrain).toBe('wetland');
    expect(marshTiles).toHaveLength(370);
    // The two channels are 3 rows each, 48 wide, with the causeway (`r`) the only open tile in each row.
    for (const y of [17, 18, 19, 29, 30, 31]) {
      expect(rows[y]?.split('~').length, `row ${y}`).toBe(48);
      expect(symbolAt(24, y)).toBe('r');
    }
  });

  it('holds 25-35% open water by area inside its marsh tiles', () => {
    const S = 8;
    let water = 0;
    for (const [x, y] of marshTiles) {
      for (let b = 0; b < S; b++) {
        for (let a = 0; a < S; a++) {
          if (marshWaterAt(map.decor, W, H, x + (a + 0.5) / S, y + (b + 0.5) / S) >= 0.5) water++;
        }
      }
    }
    const share = water / (marshTiles.length * S * S);
    console.info(`ein_qasab_3 water share: ${share.toFixed(4)} (${water}/${marshTiles.length * S * S}), ${marshTiles.length} marsh tiles`);
    expect(share).toBeGreaterThanOrEqual(0.25);
    expect(share).toBeLessThanOrEqual(0.35);
  });

  it('puts no reed centre on the open water, and does place reeds', () => {
    const reeds = decorPlacements(build().input).filter((p) => p.family === 'reed');
    // Not vacuous: the wetland path ran and the fen carries a real mat (1,082 at this seed).
    expect(reeds.length).toBeGreaterThan(900);
    for (const r of reeds) expect(marshWaterAt(map.decor, W, H, r.x, r.z), `${r.x},${r.z}`).toBeLessThan(0.5);
  });

  it('places willows along the banks (the waterside pass ran)', () => {
    const willows = decorPlacements(build().input).filter((p) => p.family === 'willow');
    expect(willows.length).toBeGreaterThanOrEqual(20);
  });
});

describe('Ein Qasab III: the placed-decor triangle census (MDD G7)', () => {
  /** Triangles per placement, by `<family>_<variant>`, from tools/terrain/wetland_census.py: reed and wet
   *  grass from their builders, rock/boulder/slab from the shipped GLBs, the three Meshy families at
   *  their caps (oak 2,500, willow 2,500, shrub 600). */
  const TRIS: Record<string, number> = {
    reed_0: 388,
    reed_1: 390,
    reed_2: 382,
    wet_grass_0: 198,
    wet_grass_1: 198,
    wet_grass_2: 198,
    oak_0: 2500,
    oak_1: 2500,
    oak_2: 2500,
    willow_0: 2500,
    willow_1: 2500,
    willow_2: 2500,
    shrub_0: 600,
    shrub_1: 600,
    shrub_2: 600,
    rock_0: 229,
    rock_1: 200,
    rock_2: 218,
    boulder_0: 347,
    boulder_1: 326,
    boulder_2: 330,
    slab_0: 280,
    slab_1: 269,
    slab_2: 233,
  };
  const CEILING = 900_000;

  function census(): { total: number; byFamily: Record<string, number> } {
    const { input, surface } = build();
    const byFamily: Record<string, number> = {};
    let total = 0;
    for (const p of decorPlacements(input, undefined, surface)) {
      const key = `${p.family}_${p.variant}`;
      const t = TRIS[key];
      if (t === undefined) throw new Error(`no triangle figure for ${key}: the census table is stale`);
      total += t;
      byFamily[p.family] = (byFamily[p.family] ?? 0) + t;
    }
    return { total, byFamily };
  }

  it('is under the 0.9 M ceiling with the trees at their caps, and the reeds are the biggest load', () => {
    const { total, byFamily } = census();
    console.info(`ein_qasab_3 placed decor: ${total.toLocaleString()} triangles (${((total / CEILING) * 100).toFixed(1)}% of ${CEILING.toLocaleString()})`, byFamily);
    expect(total).toBeLessThanOrEqual(CEILING);
    // Not vacuous: the census counted a real fen (872,101 on this commit), and the reeds lead it. The floor
    // is low on purpose: narrowing each channel to 2 rows (MDD 3.3's lever, about -100 k) must stay legal.
    expect(total).toBeGreaterThan(500_000);
    const top = Object.entries(byFamily).sort((a, b) => b[1] - a[1])[0];
    expect(top?.[0]).toBe('reed');
  });
});

describe('Ein Qasab III: the greybox facts (MDD 3.3)', () => {
  const WALLS = new Set(['^', 'h', '=', 'w', 'p']);

  it('is 48x48 and declares the mission markers at their literal tiles', () => {
    expect([json.width, json.height, json.name]).toEqual([48, 48, 'Ein Qasab — The Lower Causeway']);
    expect(json.markers).toMatchObject({
      kdf_start: [8, 44],
      wounded_evac: [4, 41],
      camp_door: [10, 41],
      civ_refuge: [3, 1],
      supply_entry: [0, 40],
      causeway_head: [24, 13],
      south_landing: [24, 36],
      mill: [23, 25],
      north_exit: [18, 0],
      rif_n: [30, 0],
      rif_nw: [10, 0],
      reed_w: [0, 24],
      reed_e: [45, 23],
    });
  });

  it('raises the causeway to level 1 across both channels, and it is the only road over them', () => {
    for (const y of [17, 18, 19, 29, 30, 31]) expect(map.elevation[y * W + 24], `(24,${y}) level`).toBe(1);
    for (const y of [17, 18, 19, 29, 30, 31]) expect(rows[y]?.replace(/~/g, '').length, `row ${y} has one open tile`).toBe(1);
  });

  it('keeps built share at or under 3%, and every building on a single level', () => {
    const built = map.structures.reduce((n, st) => n + st.tiles.length, 0);
    expect(built / (W * H)).toBeLessThanOrEqual(0.03);
    const by: Record<string, number> = {};
    for (const s of map.structures) by[s.type] = (by[s.type] ?? 0) + 1;
    expect(by).toEqual({ house: 4, wall: 6, warehouse: 1, pump_house: 1 });
    for (const s of map.structures) {
      const levels = new Set(s.tiles.map((t) => map.elevation[t]));
      expect([...levels], `${s.type} at tile ${s.tiles[0]}`).toHaveLength(1);
    }
  });

  it('has no open step over one level between orthogonal neighbours', () => {
    let steps = 0;
    const open = (i: number): boolean => !WALLS.has(symbolAt(i % W, Math.floor(i / W)));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = y * W + x;
        for (const u of [x + 1 < W ? t + 1 : -1, y + 1 < H ? t + W : -1]) {
          if (u < 0) continue;
          const a = map.elevation[t] ?? 0;
          const b = map.elevation[u] ?? 0;
          if (a !== b) steps++;
          if (open(t) && open(u)) expect(Math.abs(a - b), `(${x},${y}) -> tile ${u}`).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(steps).toBeGreaterThan(100); // not vacuous: terraces, lip, riser
  });
});
