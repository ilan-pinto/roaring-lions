// P3 R1 helper, NOT a check: dumps the real placer's output and the marsh water
// field for a window of Ein Qasab as JSON, for tools/terrain/render_wetland_r1.py.
// It does nothing unless WET_P3_DUMP_OUT is set, so `pnpm test` skips it.
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { Sim } from '../../packages/sim/src/sim';
import { applyTerrain, maps, parseMap, structures as structureCatalogue, type MapJson } from '@lions/data';
import { decorPlacements, type TerrainInput } from '../../packages/render/src/three/terrain/index';
import { buildTerrainSurface, smoothWorldY } from '../../packages/render/src/three/terrain/surface';
import { terrainTonesFor } from '../../packages/app/src/terrain-themes';
import { marshWaterAt } from '../../packages/render/src/three/terrain/shared';

const OUT = process.env.WET_P3_DUMP_OUT;

describe.skipIf(!OUT)('wetland p3 dump', () => {
  it('writes the window', () => {
    const json = maps.ein_qasab as MapJson;
    const map = parseMap(json);
    const W = map.width;
    const H = map.height;
    const sim = new Sim({ seed: 20260727, width: W, height: H, capacity: 256 });
    applyTerrain(map, sim);
    const idx = new Map<string, number>();
    for (const [sid, spec] of Object.entries(structureCatalogue)) {
      idx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
    }
    for (const b of map.structures) sim.addStructure(idx.get(b.type) as number, b.tiles);
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
    };
    const x0 = Number(process.env.WET_P3_X0 ?? 8);
    const x1 = Number(process.env.WET_P3_X1 ?? 29);
    const y0 = Number(process.env.WET_P3_Y0 ?? 13);
    const y1 = Number(process.env.WET_P3_Y1 ?? 22);
    const S = 32;
    const surface = buildTerrainSurface(input);
    const all = decorPlacements(input, undefined, surface);
    const inWin = all.filter((p) => p.x >= x0 - 0.5 && p.x <= x1 + 1.5 && p.z >= y0 - 0.5 && p.z <= y1 + 1.5);
    const water: number[] = [];
    for (let j = 0; j < (y1 - y0 + 1) * S; j++) {
      for (let i = 0; i < (x1 - x0 + 1) * S; i++) {
        water.push(Math.round(marshWaterAt(map.decor, W, H, x0 + (i + 0.5) / S, y0 + (j + 0.5) / S) * 1000) / 1000);
      }
    }
    const SH = 8;
    const heights: number[] = [];
    for (let j = 0; j <= (y1 - y0 + 1) * SH; j++) {
      for (let i = 0; i <= (x1 - x0 + 1) * SH; i++) {
        heights.push(Math.round(smoothWorldY(surface, x0 + i / SH, y0 + j / SH) * 100000) / 100000);
      }
    }
    const rows = json.rows.slice(y0, y1 + 1).map((r) => r.slice(x0, x1 + 1));
    const elev: number[][] = [];
    for (let y = y0; y <= y1; y++) elev.push(Array.from({ length: x1 - x0 + 1 }, (_, i) => map.elevation[y * W + x0 + i]));
    writeFileSync(
      OUT as string,
      JSON.stringify({
        window: { x0, x1, y0, y1, S },
        rows,
        elev,
        water,
        heights,
        heightsPerTile: SH,
        placements: inWin,
        decorColors: tones.decorColors,
        tones: { open: tones.open, marsh: tones.marsh, road: tones.road, cover: tones.cover, rock: tones.rock, blocked: tones.blocked },
        familyCounts: all.reduce<Record<string, number>>((m, p) => ((m[p.family] = (m[p.family] ?? 0) + 1), m), {}),
        variantCounts: all.reduce<Record<string, number>>((m, p) => ((m[`${p.family}_${p.variant}`] = (m[`${p.family}_${p.variant}`] ?? 0) + 1), m), {}),
      })
    );
  });
});
