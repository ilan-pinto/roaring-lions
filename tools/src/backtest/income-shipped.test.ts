// GH-1386: the held-ground income the campaign SHIPS, pinned mission by mission. `income-proposal.test.ts` holds the report-only tables; this
// holds the data. A zone deleted from a mission (or a rate nudged, or a new mission quietly given zones) goes red here, and `playtest.ts` reads
// the same count (`ZONE_MISSIONS`). Each batch of `docs/campaign/economy/held-ground-census.md` adds its rows to LANDED and raises the pin.
import { describe, expect, it } from 'vitest';
import { missions } from '@lions/data/content';
import { CENSUS_TABLES } from './income-proposal';

type Zones = [zone: string, rate: number][];
/** Every mission that authors zones today, with its exact zones. Batch 0 is the five that shipped before GH-1386 (F2, 15 Oct, and Ein Qasab III). */
const LANDED: Record<string, { batch: number; zones: Zones }> = {
  deir_amun_2_foothold: { batch: 0, zones: [['pump_yard', 28], ['the_wadi', 20]] },
  ein_qasab_3_buildup: { batch: 0, zones: [['mill_islet', 80]] },
  umm_zeitoun_2_buildup: { batch: 0, zones: [['crest_line', 50], ['post_stone', 30]] },
  umm_zeitoun_4_clearance: { batch: 0, zones: [['stockpile', 16], ['crest_top', 8], ['hamlet', 8]] },
  wadi_halam_2_laager: { batch: 0, zones: [['pasture', 32], ['ford_watch', 16]] },
  // Authored with their town (Qasr Liwan II and III, GH-1438), not by a GH-1386 batch: batch 0, like the five D7 missions before the census.
  qasr_liwan_2_foothold: { batch: 0, zones: [['coast_road', 28], ['the_cut', 20]] },
  qasr_liwan_3_buildup: { batch: 0, zones: [['water_point', 80]] },
  // Bir Tarsha II (GH-1438), authored with its town like the two above.
  bir_tarsha_2_foothold: { batch: 0, zones: [['the_gate', 28]] },
  khan_rafid_2_foothold: { batch: 1, zones: [['ward', 48]] },
  qarn_hadid_2_foothold: { batch: 1, zones: [['the_gates', 32], ['hollow', 16]] },
  tel_marum_2_foothold: { batch: 1, zones: [['approach', 32], ['overwatch_west', 16]] },
  beit_sahwan_3_clearance: { batch: 2, zones: [['clinic', 32]] },
  tel_marum_3_clearance: { batch: 2, zones: [['pass', 20], ['overwatch_east', 12]] },
  umm_zeitoun_3_clearance: { batch: 2, zones: [['hamlet', 32]] },
  wadi_halam_5_depot: { batch: 2, zones: [['depot', 20], ['village', 12]] },
  beit_sahwan_2_foothold: { batch: 3, zones: [['terrace_crest', 48]] },
  wadi_halam_3_counterraid: { batch: 3, zones: [['pasture', 80]] },
  deir_amun_3_subterranean: { batch: 3, zones: [['hamlet', 20], ['spoil_field', 12]] },
};

type M = { id: string; resources?: { income_zones?: { zone: string; rate_per_min: number }[] } };
const all = Object.values(missions as unknown as Record<string, M>);
const zonesOf = (m: M): Zones => (m.resources?.income_zones ?? []).map((z) => [z.zone, z.rate_per_min]);

describe('shipped held-ground income (GH-1386)', () => {
  it('every landed mission carries exactly its zones and rates', () => {
    for (const [id, want] of Object.entries(LANDED)) {
      const m = (missions as unknown as Record<string, M>)[id];
      expect(m, id).toBeDefined();
      expect(zonesOf(m), id).toEqual(want.zones);
    }
  });

  it('no other mission authors zones: the census line is exactly the landed set (18 of 39: batches 2 and 3, plus Qasr Liwan II and III and Bir Tarsha II)', () => {
    const authors = all.filter((m) => zonesOf(m).length > 0).map((m) => m.id).sort();
    expect(authors).toEqual(Object.keys(LANDED).sort());
    expect(authors.length).toBe(18);
    expect(all.length).toBe(39);
  });

  it("each landed batch-1, -2 and -3 row is the census plan's candidate row, verbatim", () => {
    for (const [id, row] of Object.entries(LANDED).filter(([, r]) => r.batch >= 1)) {
      expect(CENSUS_TABLES['census-candidate'][id].zones, id).toEqual(row.zones);
    }
  });
});
