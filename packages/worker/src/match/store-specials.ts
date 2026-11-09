/**
 * The Store specials a seat may claim in a `brigade` room (GH-1102): every unit whose
 * `unlock` is bought-only (a price and no earned field, `isBoughtOnly`), in `@lions/data`'s
 * `units` order. All twelve are KDF; Sarim has no store. The room cleans a seat's claim
 * against this table (`seatSpecialsField`) and refuses nothing else about it: there is no
 * server ledger to check a claim against, so the check is structural (decision 22, the
 * same posture as the tier claim's `KIT_TRACKS`). Kept as a plain table so the Worker does
 * not bundle the unit data; `store-specials.test.ts` pins it to `units` both ways.
 *
 * Which of these a versus room then refuses outright, and why, is `@lions/net`'s
 * `VERSUS_REFUSED_SPECIALS`: the room lists those in the lobby and mints the rest.
 */
export const STORE_SPECIALS: readonly string[] = [
  'recon_zikit',
  'heli_peten_gunship',
  'inf_medic_squad',
  'veh_ambulance',
  'air_medevac_heli',
  'mbt_lavi_camo',
  'spg_long_range',
  'ugv_recon_dog',
  'spg_cluster',
  'at_nlos_team',
  'inf_grenadier',
  'demo_tzav',
];
