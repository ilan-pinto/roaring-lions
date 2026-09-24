import world from '../../../data/campaign/world.json';

const TUTORIAL = 'beit_sahwan_0_tutorial';

/** The funnel's order: the tutorial, then every town's missions as world.json lists them. */
export const CAMPAIGN_ORDER: readonly string[] = [
  TUTORIAL,
  ...(world as { regions: { towns: { missions: string[] }[] }[] }).regions.flatMap((r) => r.towns.flatMap((t) => t.missions)),
];

/** Each mission's authored `target_minutes`. Hand-kept so the Worker bundle does
 *  not carry every mission file; campaign-order.test.ts pins it to data/missions/. */
export const MISSION_TARGET_MINUTES: Readonly<Record<string, number>> = {
  beit_sahwan_0_tutorial: 10,
  beit_sahwan_1_recon: 7,
  beit_sahwan_2_foothold: 7,
  beit_sahwan_3_clearance: 7,
  beit_sahwan_4_subterranean: 6,
  beit_sahwan_breach: 5,
  deir_amun_1_recon: 6,
  deir_amun_2_foothold: 7,
  deir_amun_3_subterranean: 7,
  khan_rafid_1_recon: 6,
  khan_rafid_2_foothold: 7,
  khan_rafid_3_clearance: 7,
  qarn_hadid_1_recon: 6,
  qarn_hadid_2_foothold: 7,
  qarn_hadid_3_clearance: 7,
  tel_marum_1_recon: 7,
  tel_marum_2_foothold: 6,
  tel_marum_3_clearance: 7,
  umm_zeitoun_1_recon: 6,
  umm_zeitoun_2_buildup: 7,
  umm_zeitoun_3_clearance: 7,
  umm_zeitoun_4_clearance: 7,
  wadi_halam_1_fords: 6,
  wadi_halam_2_laager: 7,
  wadi_halam_3_counterraid: 6,
  wadi_halam_4_village: 7,
  wadi_halam_5_depot: 7,
};
