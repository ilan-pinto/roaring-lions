// F2 Task 2: the proposal table is report-only data, but the doc quotes it, so three facts about it are
// held here against the shipped maps: every table names real zones at legal rates, the proposal's full
// holds are the 40% anchors the doc states, and no proposed zone covers a starting placement (the
// reason ZONE_PASSIVE_INCOME reads 0 under it: a force that never moves stands where it was placed).
import { describe, expect, it } from 'vitest';
import { maps, missions } from '@lions/data';
import {
  INCOME_TABLES,
  CENSUS_TABLES,
  CENSUS_MISSIONS,
  D7_MISSIONS,
  PHASE_ANCHOR,
  ZONE_SHARE_PERCENT,
  type CensusTable,
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

// --- GH-1386: the census tables (docs/campaign/economy/held-ground-census.md) -------------------------------

type PhasedMission = MissionLike & { phase: string; resources?: { income_zones?: unknown[] } };
const phased = (id: string): PhasedMission => (missions as unknown as Record<string, PhasedMission>)[id];
const censusZonesOf = (id: string): Record<string, unknown> => zonesOf(id as D7Mission);
const censusMarkersOf = (id: string): Record<string, unknown> => markersOf(id as D7Mission);
/** Subterranean has base income and no GDD anchor: the census borrows the clearance trickle for it, and says so. */
const ANCHOR_OF: Record<string, number> = { ...PHASE_ANCHOR, subterranean: PHASE_ANCHOR.clearance };

/** Zones of `table` with a starting placement inside them or within `margin` tiles of their rectangle. A force that
 *  is placed on a zone's edge spreads onto it the moment the mission starts (wadi_halam_4's `refuge`: placements at
 *  x=7, rectangle ending at x=6, and the still passive control held it 100% of the run), so the check is not "inside". */
function startZonesNear(table: CensusTable, margin: number): string[] {
  const out: string[] = [];
  for (const [id, m] of Object.entries(table)) {
    const placed = phased(id).starting_force.map((p) => p.at);
    for (const [zone] of m.zones) {
      const r = censusZonesOf(id)[zone] as number[] | undefined;
      if (!r) continue;
      if (placed.some(([sx, sy]) => sx >= r[0] - margin && sx < r[0] + r[2] + margin && sy >= r[1] - margin && sy < r[1] + r[3] + margin)) out.push(`${id}:${zone}`);
    }
  }
  return out;
}

describe('census income tables (GH-1386)', () => {
  it('every census table names declared zones at integer rates >= 1, on census missions only', () => {
    for (const [name, t] of Object.entries(CENSUS_TABLES)) expect(tableProblems(t, censusZonesOf, censusMarkersOf, CENSUS_MISSIONS), name).toEqual([]);
  });

  it('a census table naming a D7 mission or an unknown zone is refused', () => {
    const bad: CensusTable = { wadi_halam_2_laager: { zones: [['pasture', 5]] }, khan_rafid_2_foothold: { zones: [['nowhere', 5]] } };
    expect(tableProblems(bad, censusZonesOf, censusMarkersOf, CENSUS_MISSIONS)).toEqual([
      'wadi_halam_2_laager: not an allowed mission',
      'khan_rafid_2_foothold: unknown zone nowhere',
    ]);
  });

  it('the candidate full hold is 40% of the phase anchor on every mission: foothold 48, build-up 80, clearance 32', () => {
    const t = CENSUS_TABLES['census-candidate'];
    const read = Object.keys(t).map((id) => [id, fullHold(t[id]), Math.round((ANCHOR_OF[phased(id).phase] * ZONE_SHARE_PERCENT) / 100)]);
    expect(read.filter(([, got, want]) => got !== want)).toEqual([]);
    expect(read.map(([id, , want]) => `${id}=${want}`).sort()).toEqual([
      'beit_sahwan_3_clearance=32',
      'deir_amun_3_subterranean=32',
      'ein_qasab_2_foothold=48',
      'khan_rafid_2_foothold=48',
      'qarn_hadid_2_foothold=48',
      'tel_marum_2_foothold=48',
      'tel_marum_3_clearance=32',
      'umm_zeitoun_3_clearance=32',
      'wadi_halam_3_counterraid=80',
      'wadi_halam_5_depot=32',
    ]);
  });

  it('no candidate zone stands within two tiles of a starting placement, and the check is not vacuous', () => {
    expect(startZonesNear(CENSUS_TABLES['census-candidate'], 2)).toEqual([]);
    // The survey table pays every declared zone, so it must trip on the starting grounds the passive controls measured.
    const found = startZonesNear(CENSUS_TABLES['census-survey'], 2);
    for (const known of ['khan_rafid_2_foothold:staging', 'khan_rafid_3_clearance:staging', 'qarn_hadid_2_foothold:south_staging', 'wadi_halam_4_village:refuge', 'wadi_halam_5_depot:refuge'])
      expect(found, known).toContain(known);
  });

  it("no candidate pays umm_zeitoun_3's horn_west, which no wheeled route reaches (C-R22, tools/src/income_census.test.ts)", () => {
    expect(CENSUS_TABLES['census-candidate'].umm_zeitoun_3_clearance.zones.map(([z]) => z)).not.toContain('horn_west');
  });

  it('the candidate adds ten missions to the five that already author zones: fifteen, none counted twice', () => {
    const shipped = Object.keys(missions as object).filter((id) => (phased(id).resources?.income_zones?.length ?? 0) > 0).sort();
    expect(shipped).toEqual([...D7_MISSIONS, 'ein_qasab_3_buildup'].sort());
    const candidate = Object.keys(CENSUS_TABLES['census-candidate']);
    expect(candidate.filter((id) => shipped.includes(id))).toEqual([]);
    expect(new Set([...shipped, ...candidate]).size).toBe(15);
  });
});
