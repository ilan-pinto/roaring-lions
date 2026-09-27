import { describe, expect, it } from 'vitest';
import { DECOR_GROVE, DECOR_RIDGE, DECOR_ROAD } from './shared';
import { buildRoadGraph, roadDistanceAt } from './road-graph';
import {
  PROP_CAP,
  PROP_SPACING,
  ROADSIDE_BAND,
  isBuildingTile,
  propPlacements,
  type PropPlacement,
} from './prop-place';
import type { TerrainInput } from './types';

/** A w x h town: a building tile every 6 tiles on a grid, a road along
 *  row `roadY` and column `roadX`, grove on every 13th tile, cover on every
 *  17th, a ridge on every 19th. */
function town(w: number, h: number, roadY = 10, roadX = 30): TerrainInput {
  const n = w * h;
  const decor = new Uint8Array(n);
  const blocked = new Uint8Array(n);
  const cover = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = y * w + x;
    if (y === roadY || x === roadX) decor[t] = DECOR_ROAD;
    else if (x % 6 === 3 && y % 6 === 3) blocked[t] = 1;
    else if (t % 13 === 0) decor[t] = DECOR_GROVE;
    else if (t % 17 === 0) cover[t] = 1;
    else if (t % 19 === 0) { decor[t] = DECOR_RIDGE; blocked[t] = 1; }
  }
  return { width: w, height: h, decor, elevation: null, blocked, cover };
}

const YARD_ONLY = new Set(['water_tank', 'satellite_dish', 'laundry_line']);
const ROAD_ONLY = new Set(['jersey_barrier', 'wrecked_car']);

function chebyshevToBuilding(i: TerrainInput, px: number, pz: number): number {
  const tx = Math.floor(px);
  const ty = Math.floor(pz);
  let best = Infinity;
  for (let y = 0; y < i.height; y++) for (let x = 0; x < i.width; x++) {
    if (isBuildingTile(i, x, y)) best = Math.min(best, Math.max(Math.abs(x - tx), Math.abs(y - ty)));
  }
  return best;
}

describe('propPlacements (N-9, N-10)', () => {
  const m = town(48, 48);
  const graph = buildRoadGraph(m);
  const ps = propPlacements(m);

  it('places some, and never more than PROP_CAP', () => {
    expect(ps.length).toBeGreaterThan(20);
    expect(ps.length).toBeLessThanOrEqual(PROP_CAP);
  });
  it('never stands on a building, ridge, road surface, grove or cover tile (N-10)', () => {
    for (const p of ps) {
      const t = Math.floor(p.z) * m.width + Math.floor(p.x);
      expect(m.blocked[t], `${p.kind} at (${p.x}, ${p.z})`).toBe(0);
      expect(m.decor?.[t] === DECOR_GROVE).toBe(false);
      expect(m.cover[t]).toBe(0);
      expect(roadDistanceAt(graph, p.x, p.z)).toBeGreaterThanOrEqual(ROADSIDE_BAND[0]);
    }
  });
  it('puts yard kinds in the yard band and road kinds in the roadside band', () => {
    for (const p of ps) {
      if (YARD_ONLY.has(p.kind)) {
        const d = chebyshevToBuilding(m, p.x, p.z);
        expect(d, `${p.kind} at (${p.x}, ${p.z})`).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(2);
      }
      if (ROAD_ONLY.has(p.kind)) {
        const d = roadDistanceAt(graph, p.x, p.z);
        expect(d, `${p.kind} at (${p.x}, ${p.z})`).toBeLessThanOrEqual(ROADSIDE_BAND[1]);
      }
    }
  });
  it('keeps PROP_SPACING between any two props', () => {
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      expect(Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z)).toBeGreaterThanOrEqual(PROP_SPACING);
    }
  });
  it('lays a jersey barrier along its road', () => {
    const along = (p: PropPlacement): number => (((p.yawTurns % 0.5) + 0.5) % 0.5); // 0 or 0.25, mod half a turn
    for (const p of ps.filter((q) => q.kind === 'jersey_barrier')) {
      const onRow = Math.abs(p.z - 10.5) < 1;
      const onCol = Math.abs(p.x - 30.5) < 1;
      if (onRow && !onCol) expect(Math.min(along(p), 0.5 - along(p))).toBeLessThan(0.02);
      if (onCol && !onRow) expect(Math.abs(along(p) - 0.25)).toBeLessThan(0.02);
    }
  });
  it('fills the cap in hash order, not scan order: no north-west bias when the cap binds', () => {
    const big = town(96, 96, 40, 60);
    const capped = propPlacements(big);
    expect(capped.length).toBe(PROP_CAP);
    const meanZ = capped.reduce((a, p) => a + p.z, 0) / capped.length;
    expect(meanZ).toBeGreaterThan(96 * 0.38);
    expect(meanZ).toBeLessThan(96 * 0.62);
  });
  it('sheds by prefix: the 75-cap is the first 75 of the 150-cap (N-22)', () => {
    const big = town(96, 96, 40, 60);
    expect(propPlacements(big, 75)).toEqual(propPlacements(big).slice(0, 75));
  });
  it('places nothing on a map with no road and no building', () => {
    const empty: TerrainInput = { width: 16, height: 16, decor: null, elevation: null, blocked: new Uint8Array(256), cover: new Uint8Array(256) };
    expect(propPlacements(empty)).toEqual([]);
  });
  it('is deterministic', () => expect(propPlacements(m)).toEqual(ps));
});
