// F2 Task 2 (GH-183): the held-ground income table, as data (the lead approved it 15 Oct; it ships in
// `data/missions/`).
//
// REPORT-ONLY. Nothing here is read by the game, by `pnpm playtest` or by CI. It is the table
// `docs/campaign/economy/income-numbers.md` records as approved, kept as code so the measurement can be
// repeated: `income-probe.ts` applies one of these tables IN MEMORY to the
// parsed mission JSON (never to `data/missions/*.json`, which is the lead's: F2 ruling C-R1) and
// records what the real `MissionRuntime` does with it, and `income-probe-report.ts` prints it.

/** One mission's income authoring: the zones that pay (map zone id, logistics a minute), whether the
 *  mission names its convoy entry (`resources.supply_entry`), and, for a deliberate red only, a zone
 *  rectangle moved in memory. */
export interface MissionIncome {
  zones: readonly (readonly [zone: string, ratePerMin: number])[];
  supplyEntry?: string;
  /** Moves a MAP zone's rectangle in memory: the "zone the plan never enters" red (plan Task 8 Step 4). */
  moveZone?: { zone: string; rect: readonly [number, number, number, number] };
  /** Adds MAP markers in memory: a convoy entry the lead could choose instead (a map edit, his call). */
  addMarkers?: Record<string, readonly [number, number]>;
}

/** The four D7 missions (BS II left D7 on 6 Oct). */
export const D7_MISSIONS = [
  'umm_zeitoun_2_buildup',
  'umm_zeitoun_4_clearance',
  'deir_amun_2_foothold',
  'wadi_halam_2_laager',
] as const;
export type D7Mission = (typeof D7_MISSIONS)[number];

/** The GDD's logistics anchors a minute by phase (docs/GDD.md, "Economy anchors"). */
export const PHASE_ANCHOR = { foothold: 120, buildup: 200, clearance: 80 } as const;
/** The phase each D7 mission is priced against: its own `phase` field. */
export const MISSION_PHASE: Record<D7Mission, keyof typeof PHASE_ANCHOR> = {
  umm_zeitoun_2_buildup: 'buildup',
  umm_zeitoun_4_clearance: 'clearance',
  deir_amun_2_foothold: 'foothold',
  wadi_halam_2_laager: 'foothold',
};
/** Task 2 Step 2: a full hold of every paying zone adds about 40% of the phase anchor. */
export const ZONE_SHARE_PERCENT = 40;

export type IncomeTable = Partial<Record<D7Mission, MissionIncome>>;

export const INCOME_TABLES: Record<string, IncomeTable> = {
  /** Nothing authored: the shipped missions, for the before side of every comparison. */
  none: {},
  /** Every declared zone at 1 a minute, both UZ entries named: who stands where, and what cuts what. */
  survey: {
    umm_zeitoun_2_buildup: { zones: [['staging', 1], ['crest_line', 1], ['post_stone', 1]], supplyEntry: 'supply_entry' },
    umm_zeitoun_4_clearance: {
      zones: [['hamlet', 1], ['crest_top', 1], ['stockpile', 1], ['north_shelf', 1]],
      supplyEntry: 'supply_entry',
    },
    deir_amun_2_foothold: {
      zones: [['staging', 1], ['the_wadi', 1], ['pump_yard', 1], ['hamlet', 1], ['store_yard', 1], ['north_bank', 1]],
    },
    wadi_halam_2_laager: { zones: [['ford_watch', 1], ['pasture', 1], ['refuge', 1], ['east_road', 1]] },
  },
  /** THE PROPOSAL (docs/campaign/economy/income-numbers.md). No zone that holds a starting force pays,
   *  so a force that never moves earns nothing from ground. Full holds: 80, 32, 48, 48. */
  proposal: {
    umm_zeitoun_2_buildup: { zones: [['crest_line', 50], ['post_stone', 30]], supplyEntry: 'supply_entry' },
    umm_zeitoun_4_clearance: { zones: [['stockpile', 16], ['crest_top', 8], ['hamlet', 8]], supplyEntry: 'supply_entry' },
    deir_amun_2_foothold: { zones: [['pump_yard', 28], ['the_wadi', 20]] },
    wadi_halam_2_laager: { zones: [['pasture', 32], ['ford_watch', 16]] },
  },
  /** The alternative the lead may prefer: the two staging zones pay too (same full-hold totals), which
   *  pays every passive control on DA II and UZ II by construction (ZONE_PASSIVE_INCOME > 0). */
  'proposal+staging': {
    umm_zeitoun_2_buildup: { zones: [['staging', 16], ['crest_line', 40], ['post_stone', 24]], supplyEntry: 'supply_entry' },
    umm_zeitoun_4_clearance: { zones: [['stockpile', 16], ['crest_top', 8], ['hamlet', 8]], supplyEntry: 'supply_entry' },
    deir_amun_2_foothold: { zones: [['staging', 8], ['pump_yard', 24], ['the_wadi', 16]] },
    wadi_halam_2_laager: { zones: [['pasture', 32], ['ford_watch', 16]] },
  },
  /** FOR THE LEAD: the proposal with each UZ convoy entering on a FLANK edge instead of (24,47), so the
   *  convoy has to cross ground the Sarim waves use. Markers added in memory only; a real one is a map
   *  edit. West rim: UZ II (3,31), UZ IV (0,30). */
  'alt-entry-west': {
    umm_zeitoun_2_buildup: { zones: [['crest_line', 50], ['post_stone', 30]], supplyEntry: 'alt_entry', addMarkers: { alt_entry: [3, 31] } },
    umm_zeitoun_4_clearance: {
      zones: [['stockpile', 16], ['crest_top', 8], ['hamlet', 8]],
      supplyEntry: 'alt_entry',
      addMarkers: { alt_entry: [0, 30] },
    },
  },
  /** The same on the east rim: UZ II (44,31), UZ IV (47,40). */
  'alt-entry-east': {
    umm_zeitoun_2_buildup: { zones: [['crest_line', 50], ['post_stone', 30]], supplyEntry: 'alt_entry', addMarkers: { alt_entry: [44, 31] } },
    umm_zeitoun_4_clearance: {
      zones: [['stockpile', 16], ['crest_top', 8], ['hamlet', 8]],
      supplyEntry: 'alt_entry',
      addMarkers: { alt_entry: [47, 40] },
    },
  },
  /** Plan Task 8 Step 4's red: the proposal with WH II's `ford_watch` pointed at a rectangle the plan
   *  never enters (open ground in the south-west corner). Its walk must read empty for the whole run. */
  red: {
    umm_zeitoun_2_buildup: { zones: [['crest_line', 50], ['post_stone', 30]], supplyEntry: 'supply_entry' },
    umm_zeitoun_4_clearance: { zones: [['stockpile', 16], ['crest_top', 8], ['hamlet', 8]], supplyEntry: 'supply_entry' },
    deir_amun_2_foothold: { zones: [['pump_yard', 28], ['the_wadi', 20]] },
    wadi_halam_2_laager: { zones: [['pasture', 32], ['ford_watch', 16]], moveZone: { zone: 'ford_watch', rect: [0, 44, 3, 3] } },
  },
};

/** The sum a full hold of every paying zone adds a minute. */
export function fullHold(m: MissionIncome): number {
  let s = 0;
  for (const [, r] of m.zones) s += r;
  return s;
}

/** The anchor target for a mission: ZONE_SHARE_PERCENT of its phase anchor, in whole logistics. */
export function anchorTarget(id: D7Mission): number {
  return Math.round((PHASE_ANCHOR[MISSION_PHASE[id]] * ZONE_SHARE_PERCENT) / 100);
}

/** Whatever is wrong with a table against the maps it names: unknown zone, repeated zone, a rate that
 *  is not an integer >= 1 (the schema's rule), a mission outside D7. Empty when clean. */
export function tableProblems(
  table: IncomeTable | CensusTable,
  zonesOf: (id: D7Mission) => Record<string, unknown>,
  markersOf: (id: D7Mission) => Record<string, unknown>,
  /** The mission ids the table may name: the four D7 missions, or (GH-1386) the census candidates. */
  allowed: readonly string[] = D7_MISSIONS,
): string[] {
  const out: string[] = [];
  for (const [id, m] of Object.entries(table) as [string, MissionIncome][]) {
    if (!allowed.includes(id)) {
      out.push(`${id}: not an allowed mission`);
      continue;
    }
    const d7 = id as D7Mission;
    const zones = zonesOf(d7);
    const seen = new Set<string>();
    for (const [zone, rate] of m.zones) {
      if (!(zone in zones)) out.push(`${id}: unknown zone ${zone}`);
      if (seen.has(zone)) out.push(`${id}: zone ${zone} repeated`);
      seen.add(zone);
      if (!Number.isInteger(rate) || rate < 1) out.push(`${id}: ${zone} rate ${rate} is not an integer >= 1`);
    }
    const markers = { ...markersOf(d7), ...(m.addMarkers ?? {}) };
    if (m.supplyEntry !== undefined && !(m.supplyEntry in markers)) out.push(`${id}: unknown marker ${m.supplyEntry}`);
  }
  return out;
}

// --- GH-1386: the census of the missions that could carry held-ground income ------------------------
//
// Same idiom, same report-only status: `docs/campaign/economy/held-ground-census.md` is the plan, and this
// is the measurement behind it. A census table names missions OUTSIDE the four D7 ones; `income-probe.ts`
// applies it in memory exactly as it applies the tables above.

/** A census table: any mission id (checked against `CENSUS_MISSIONS` by `tableProblems`). */
export type CensusTable = Record<string, MissionIncome>;

/** The missions the census measures: those with a purse and no zones when the survey was taken, whose phase has a GDD anchor (foothold,
 *  build-up, clearance) or is subterranean (a base rate and no anchor; `deir_amun_3_subterranean` borrows the clearance 32). `beit_sahwan_2_foothold` joined at
 *  batch 3, once PR 1483 (GH-1378 Q12) gave it a hold zone nobody starts on; `ein_qasab_2_foothold` is surveyed but not in the plan (its briefing says
 *  "the logistics for one outpost", section 10 of the census doc). The plan itself is `census-candidate` below. */
export const CENSUS_MISSIONS = [
  'beit_sahwan_2_foothold',
  'ein_qasab_2_foothold',
  'khan_rafid_2_foothold',
  'qarn_hadid_2_foothold',
  'tel_marum_2_foothold',
  'wadi_halam_3_counterraid',
  'beit_sahwan_3_clearance',
  'khan_rafid_3_clearance',
  'qarn_hadid_3_clearance',
  'tel_marum_3_clearance',
  'umm_zeitoun_3_clearance',
  'wadi_halam_4_village',
  'wadi_halam_5_depot',
  'beit_sahwan_4_subterranean',
  'deir_amun_3_subterranean',
] as const;

export const CENSUS_TABLES: Record<string, CensusTable> = {
  /** THE CANDIDATE (docs/campaign/economy/held-ground-census.md; `ein_qasab_2_foothold` was replaced by `beit_sahwan_2_foothold` at batch 3: see section 10): ten missions, zones the plan holds, none that holds a
   *  starting force, a full hold of 40% of the phase anchor (foothold 48, build-up 80, clearance 32; the subterranean
   *  reserve borrows the clearance 32, the GDD names no anchor for it). Split 60/40 between a mission's primary zone
   *  and the rest where there is more than one. */
  'census-candidate': {
    khan_rafid_2_foothold: { zones: [['ward', 48]] },
    qarn_hadid_2_foothold: { zones: [['the_gates', 32], ['hollow', 16]] },
    tel_marum_2_foothold: { zones: [['approach', 32], ['overwatch_west', 16]] },
    beit_sahwan_2_foothold: { zones: [['terrace_crest', 48]] },
    wadi_halam_3_counterraid: { zones: [['pasture', 80]] },
    beit_sahwan_3_clearance: { zones: [['clinic', 32]] },
    tel_marum_3_clearance: { zones: [['pass', 20], ['overwatch_east', 12]] },
    umm_zeitoun_3_clearance: { zones: [['hamlet', 32]] },
    wadi_halam_5_depot: { zones: [['depot', 20], ['village', 12]] },
    deir_amun_3_subterranean: { zones: [['hamlet', 20], ['spoil_field', 12]] },
  },
  /** Every declared zone of every candidate at 1 a minute: who stands where, when, and whether a wheeled route
   *  to the rear exists at t=0. Pays nothing worth a decision; the plan's play is what is read. */
  'census-survey': {
    beit_sahwan_2_foothold: { zones: [['terrace_crest', 1], ['west_approach', 1], ['tunnel_mouth_west', 1]] },
    ein_qasab_2_foothold: { zones: [['hollow', 1], ['barn_yard', 1], ['farmhouse', 1], ['north_saddle', 1], ['north_crest', 1]] },
    khan_rafid_2_foothold: { zones: [['staging', 1], ['ward', 1], ['market', 1], ['souk', 1], ['old_town', 1]] },
    qarn_hadid_2_foothold: { zones: [['the_gates', 1], ['hollow', 1], ['south_staging', 1]] },
    tel_marum_2_foothold: { zones: [['approach', 1], ['ammo_draw', 1], ['overwatch_west', 1], ['overwatch_east', 1]] },
    wadi_halam_3_counterraid: { zones: [['pasture', 1], ['refuge', 1], ['east_road', 1]] },
    beit_sahwan_3_clearance: { zones: [['town', 1], ['clinic', 1]] },
    khan_rafid_3_clearance: { zones: [['staging', 1], ['ward', 1], ['souk', 1], ['store', 1], ['orchard_west', 1], ['orchard_east', 1], ['orchard_south', 1]] },
    qarn_hadid_3_clearance: { zones: [['village', 1], ['clinic', 1], ['the_terraces', 1]] },
    tel_marum_3_clearance: { zones: [['pass', 1], ['overwatch_east', 1], ['overwatch_west', 1], ['approach', 1], ['town_block', 1], ['muster_ground', 1]] },
    umm_zeitoun_3_clearance: { zones: [['refuge_wadi', 1], ['hamlet', 1], ['horn_west', 1], ['horn_east', 1]] },
    wadi_halam_4_village: { zones: [['village', 1], ['hall_block', 1], ['refuge', 1], ['east_road', 1]] },
    wadi_halam_5_depot: { zones: [['depot', 1], ['hall_block', 1], ['village', 1], ['refuge', 1], ['east_road', 1]] },
    beit_sahwan_4_subterranean: { zones: [['town', 1], ['clinic', 1], ['shaft_head', 1], ['collection_point', 1]] },
    deir_amun_3_subterranean: { zones: [['staging', 1], ['hamlet', 1], ['spoil_field', 1], ['plateau', 1]] },
  },
};
