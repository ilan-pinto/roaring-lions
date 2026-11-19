// F2 Task 2: the proposal table is report-only data, but the doc quotes it, so three facts about it are
// held here against the shipped maps: every table names real zones at legal rates, the proposal's full
// holds are the 40% anchors the doc states, and no proposed zone covers a starting placement (the
// reason ZONE_PASSIVE_INCOME reads 0 under it: a force that never moves stands where it was placed).
import { describe, expect, it } from 'vitest';
import { maps, missions } from '@lions/data/content';
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
 *  x=7, rectangle ending at x=6, a distance of one tile, and the still passive control held it 100% of the run), so the check is not "inside".
 *  The margin is two tiles for every mission; a zone measured to pay a still force nothing at that distance is a NAMED exemption below, not a looser margin. */
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

/**
 * Zones the static check would flag at two tiles that the MEASUREMENT clears. Each names its evidence, and a demotion test fails when the exemption stops being
 * needed (the placement moved, or the zone did), so the entry is deleted and does not linger. An exemption covers the band between one and two tiles only: a zone
 * within one tile of a placement, or inside one, can never be exempted here (that is the case that measured as paying a still force, `wadi_halam_4`'s `refuge`).
 */
const START_GROUND_EXEMPT: Record<string, string> = {
  'beit_sahwan_2_foothold:terrace_crest':
    "two tiles from a placement (x=6 against the zone's x=8); the still passive control earned 0 from it on all 30 seeds (ZONE_PASSIVE_INCOME 0 over 15 controls), and PR 1483 made it the hold zone nobody starts on",
};

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
      'beit_sahwan_2_foothold=48',
      'beit_sahwan_3_clearance=32',
      'deir_amun_3_subterranean=32',
      'khan_rafid_2_foothold=48',
      'qarn_hadid_2_foothold=48',
      'tel_marum_2_foothold=48',
      'tel_marum_3_clearance=32',
      'umm_zeitoun_3_clearance=32',
      'wadi_halam_3_counterraid=80',
      'wadi_halam_5_depot=32',
    ]);
  });

  it('no candidate zone stands within two tiles of a starting placement unless it is a named, measured exemption, and the check is not vacuous', () => {
    const near = startZonesNear(CENSUS_TABLES['census-candidate'], 2);
    expect(near.filter((z) => !(z in START_GROUND_EXEMPT))).toEqual([]);
    // The survey table pays every declared zone, so it must trip on the starting grounds the passive controls measured.
    const found = startZonesNear(CENSUS_TABLES['census-survey'], 2);
    for (const known of ['khan_rafid_2_foothold:staging', 'khan_rafid_3_clearance:staging', 'qarn_hadid_2_foothold:south_staging', 'wadi_halam_4_village:refuge', 'wadi_halam_5_depot:refuge'])
      expect(found, known).toContain(known);
  });

  it('every start-ground exemption is still needed (delete the entry when this fails) and never covers a zone within one tile', () => {
    const within2 = startZonesNear(CENSUS_TABLES['census-candidate'], 2);
    const within1 = startZonesNear(CENSUS_TABLES['census-candidate'], 1);
    for (const z of Object.keys(START_GROUND_EXEMPT)) {
      expect(within2, `${z} is no longer near a placement: delete its exemption`).toContain(z);
      expect(within1, `${z} is within one tile of a placement: that is the paying case, not an exemption`).not.toContain(z);
    }
  });

  it("no candidate pays umm_zeitoun_3's horn_west, which no wheeled route reaches (C-R22, tools/src/income_census.test.ts)", () => {
    expect(CENSUS_TABLES['census-candidate'].umm_zeitoun_3_clearance.zones.map(([z]) => z)).not.toContain('horn_west');
  });

  it('the candidate adds ten missions to the eight that authored zones before GH-1386 (five D7 missions, Qasr Liwan II and III and Bir Tarsha II): eighteen, none counted twice, and whatever has shipped since is one of them', () => {
    const before = [...D7_MISSIONS, 'ein_qasab_3_buildup', 'qasr_liwan_2_foothold', 'qasr_liwan_3_buildup', 'bir_tarsha_2_foothold'];
    const shipped = Object.keys(missions as object).filter((id) => (phased(id).resources?.income_zones?.length ?? 0) > 0).sort();
    const candidate = Object.keys(CENSUS_TABLES['census-candidate']);
    expect(candidate.filter((id) => before.includes(id))).toEqual([]);
    expect(new Set([...before, ...candidate]).size).toBe(18);
    // a mission that authors zones is one of the five or one of the ten: nothing is landed outside the plan
    expect(shipped.filter((id) => !before.includes(id) && !candidate.includes(id))).toEqual([]);
    expect(before.every((id) => shipped.includes(id))).toBe(true);
  });

});
