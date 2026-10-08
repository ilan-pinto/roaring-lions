// Buildings drawn to their footprints (lead rulings 7 and 8 Oct): no building on any shipped map
// may be stretched past FIT_MAX_DISTORTION (2x) by the renderer's default fit. The fit's own cap
// holds a plan axis to 2x, but it cannot cure a plot whose HEIGHT FLOOR is more than 2x a plan
// axis -- a warehouse on a one-tile-deep plot -- so this is the gate that keeps a map author from
// shipping one. It reads the same mesh bounds and the same rule the renderer draws
// (`units/building-fit.ts` through map_visibility's occluders).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadParsedMap, occluderFor, ROOT } from './map_visibility';
import {
  DEFAULT_BUILDING_FIT,
  FIT_MAX_DISTORTION,
  buildingFitScale,
  fitDistortion,
} from '../../packages/render/src/three/units/building-fit';

const perTile = new Set(
  Object.values(
    (JSON.parse(readFileSync(join(ROOT, 'data/structures.json'), 'utf8')) as {
      types: Record<string, { id: string; per_tile?: boolean }>;
    }).types
  )
    .filter((t) => t.per_tile === true)
    .map((t) => t.id)
);
const mapIds = readdirSync(join(ROOT, 'data/maps'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5));

describe('building fit census: no shipped building stretched past 2x', async () => {
  const worst: { map: string; type: string; at: string; d: number }[] = [];
  let measured = 0;
  for (const id of mapIds) {
    const m = loadParsedMap(id);
    for (const st of m.structures) {
      if (perTile.has(st.type)) continue;
      const o = await occluderFor(st.type);
      if (!o) continue;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const t of st.tiles) {
        const x = t % m.width, y = Math.floor(t / m.width);
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      const s = buildingFitScale(o.planW, o.planD, o.planH, x1 - x0 + 1, y1 - y0 + 1, DEFAULT_BUILDING_FIT);
      measured++;
      worst.push({ map: id, type: st.type, at: `${x0},${y0} ${x1 - x0 + 1}x${y1 - y0 + 1}`, d: fitDistortion(s) });
    }
  }
  worst.sort((a, b) => b.d - a.d);

  it('measures a real population (every map, hundreds of buildings)', () => {
    expect(mapIds.length).toBeGreaterThan(25);
    expect(measured).toBeGreaterThan(500);
  });

  it(`every building's largest axis scale is at most ${FIT_MAX_DISTORTION}x its smallest`, () => {
    const over = worst.filter((w) => w.d > FIT_MAX_DISTORTION + 1e-9);
    expect(
      over.map((w) => `${w.map} ${w.type} at ${w.at}: ${w.d.toFixed(3)}x`),
      'give the plot a shape nearer its building (ground-ladder §15, rule 3)'
    ).toEqual([]);
  });
});
