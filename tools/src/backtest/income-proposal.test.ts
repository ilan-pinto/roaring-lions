// F2 Task 2: the proposal table is report-only data, but the doc quotes it, so three facts about it are
// held here against the shipped maps: every table names real zones at legal rates, the proposal's full
// holds are the 40% anchors the doc states, and no proposed zone covers a starting placement (the
// reason ZONE_PASSIVE_INCOME reads 0 under it: a force that never moves stands where it was placed).
import { describe, expect, it } from 'vitest';
import { maps, missions } from '@lions/data';
import {
  INCOME_TABLES,
  D7_MISSIONS,
  anchorTarget,
  fullHold,
  tableProblems,
  type D7Mission,
  type IncomeTable,
} from './income-proposal';

type MapLike = { zones?: Record<string, number[]>; markers?: Record<string, number[]> };
type MissionLike = { map: { file: string }; starting_force: { at: [number, number] }[] };
const mapOf = (id: D7Mission): MapLike =>
  (maps as unknown as Record<string, MapLike>)[(missions as unknown as Record<string, MissionLike>)[id].map.file];
const zonesOf = (id: D7Mission): Record<string, unknown> => mapOf(id).zones ?? {};
const markersOf = (id: D7Mission): Record<string, unknown> => mapOf(id).markers ?? {};

/** The proposed zones of `table` whose rectangle holds a starting placement's `at` tile. */
function startZones(table: IncomeTable): string[] {
  const out: string[] = [];
  for (const id of D7_MISSIONS) {
    const m = table[id];
    if (!m) continue;
    const placed = (missions as unknown as Record<string, MissionLike>)[id].starting_force.map((p) => p.at);
    for (const [zone] of m.zones) {
      const r = mapOf(id).zones?.[zone];
      if (r && placed.some(([sx, sy]) => sx >= r[0] && sx < r[0] + r[2] && sy >= r[1] && sy < r[1] + r[3])) out.push(`${id}:${zone}`);
    }
  }
  return out;
}

describe('income proposal tables', () => {
  it('every table names declared zones at integer rates >= 1', () => {
    for (const [name, t] of Object.entries(INCOME_TABLES)) expect(tableProblems(t, zonesOf, markersOf), name).toEqual([]);
  });

  it('tableProblems refuses an unknown zone, a repeat, a fractional or zero rate and an unknown marker', () => {
    const bad: IncomeTable = {
      wadi_halam_2_laager: { zones: [['nowhere', 5], ['pasture', 0], ['pasture', 1.5]], supplyEntry: 'no_marker' },
    };
    expect(tableProblems(bad, zonesOf, markersOf)).toEqual([
      'wadi_halam_2_laager: unknown zone nowhere',
      'wadi_halam_2_laager: pasture rate 0 is not an integer >= 1',
      'wadi_halam_2_laager: zone pasture repeated',
      'wadi_halam_2_laager: pasture rate 1.5 is not an integer >= 1',
      'wadi_halam_2_laager: unknown marker no_marker',
    ]);
  });

  it("the proposal's full hold is 40% of each mission's phase anchor: 80, 32, 48, 48", () => {
    const p = INCOME_TABLES.proposal;
    expect(D7_MISSIONS.map((id) => [id, fullHold(p[id] ?? { zones: [] })])).toEqual(
      D7_MISSIONS.map((id) => [id, anchorTarget(id)]),
    );
    expect(D7_MISSIONS.map(anchorTarget)).toEqual([80, 32, 48, 48]);
  });

  it('no proposed zone covers a starting placement; the staging alternative covers two', () => {
    expect(startZones(INCOME_TABLES.proposal)).toEqual([]);
    expect(startZones(INCOME_TABLES['proposal+staging'])).toEqual([
      'umm_zeitoun_2_buildup:staging',
      'deir_amun_2_foothold:staging',
    ]);
  });
});
