// Wadi Tarfan (48x48): where the Sarim tunnel routes surface (GH-884).
//
// The KDF v Sarim cell "tunnels, cell 3" leaned to the Sarim (65.6% in both seat orders on 384 games, 39000+). The lever is
// WHERE EACH VENT STANDS: a raider that surfaces fires its Kornet (14 tiles, outranging the Lavi's 12 and the Namer's 10) from
// the vent tile, and the sim's own `losRay` from that tile decides how much of the KDF's approach it sees. Route A's vent
// moved one tile south (hostile (25,32) -> (25,33); its half-turn, friendly (22,15) -> (22,14)) brings the cell from Sarim
// 65.6% to 53.1% (39000+) and to 48.4% (held-out 40000+), both seat orders inside 60/40. Route B's vent is not a dial: it
// stands on the edge of a level-4 plateau, and one tile off it loses 66 of its 72 centre tiles (Sarim 35%), one tile the other
// way raises them (Sarim 76% to 88%). So this file pins the two route-A vents, their mirror, and the two route-B vents.
//
// The routes are half-turn mirrors of each other (tile (x, y) <-> (47 - x, 47 - y)); the map and its elevation are exactly
// half-turn symmetric, which is why one vent moved at both ends and nowhere else. A vent that is moved at one end only leaves
// the two seat orders reading different games.
import { describe, expect, it } from 'vitest';
import { versusRules, type VersusRulesJson } from '@lions/data';

type Route = { id: string; points: number[][]; capacity: number };
const rules = (versusRules as Record<string, VersusRulesJson>).wadi_tarfan;
const routes = (end: 'friendly' | 'hostile'): Route[] => (rules.tunnels?.[end] ?? []) as Route[];
const route = (end: 'friendly' | 'hostile', id: string): Route => {
  const r = routes(end).find((t) => t.id === id);
  if (r === undefined) throw new Error(`wadi_tarfan has no ${end} route ${id}`);
  return r;
};
const vent = (r: Route): number[] => r.points[r.points.length - 1];
const turn = (p: number[]): number[] => [47 - p[0], 47 - p[1]];

describe('wadi_tarfan tunnel vents (GH-884)', () => {
  it('route A: the vents stand one tile south of the old (25,32) and (22,15)', () => {
    expect(vent(route('hostile', 'wt_h_south'))).toEqual([25, 33]);
    expect(vent(route('friendly', 'wt_f_north'))).toEqual([22, 14]);
  });

  it('route B: the vents stay where they were, on the level-4 plateau edge', () => {
    expect(vent(route('hostile', 'wt_h_east'))).toEqual([34, 26]);
    expect(vent(route('friendly', 'wt_f_west'))).toEqual([13, 21]);
  });

  it('every point of each friendly route is the half-turn of its hostile twin, and capacities match', () => {
    for (const [h, f] of [['wt_h_south', 'wt_f_north'], ['wt_h_east', 'wt_f_west']] as const) {
      const hostile = route('hostile', h);
      const friendly = route('friendly', f);
      expect(friendly.points, `${f} is the half-turn of ${h}`).toEqual(hostile.points.map(turn));
      expect(friendly.capacity).toBe(hostile.capacity);
    }
  });
});
