/**
 * The map ids the game ships (#559 F5): a room's `map` must be one of them.
 * Before, any string up to 64 characters was stored and handed to both
 * clients in the lobby and the config, and a prototype key such as
 * `__proto__` or `constructor` crashed their boot. Kept here as a plain list,
 * as `campaign-order.ts` keeps its missions, so the Worker does not bundle the
 * maps themselves; `map-ids.test.ts` pins it to `@lions/data`'s `maps` both ways.
 */
export const SHIPPED_MAP_IDS: readonly string[] = [
  'beit_sahwan_2',
  'beit_sahwan_3',
  'beit_sahwan_4',
  'beit_sahwan_outskirts',
  'deir_amun',
  'deir_amun_2',
  'deir_amun_3',
  'ein_qasab',
  'ein_qasab_3',
  'jebel_matar',
  'khan_rafid',
  'khan_rafid_2',
  'khan_rafid_3',
  'marj_perimeter',
  'milh_flats',
  'milh_flats_l',
  'qarn_hadid',
  'qarn_hadid_2',
  'qarn_hadid_3',
  'qasr_liwan',
  'qasr_liwan_2',
  'qasr_liwan_3',
  'qasr_liwan_4',
  'qasr_liwan_5',
  'bir_tarsha',
  'bir_tarsha_2',
  'bir_tarsha_3',
  'bir_tarsha_4',
  'bir_tarsha_5',
  'rujm_sawda',
  'tel_marum',
  'tel_marum_1',
  'tel_marum_2',
  'tel_marum_3',
  'tile_green',
  'tile_knoll',
  'tile_orchard',
  'tile_road',
  'tile_scrub',
  'tutorial_ground',
  'umm_zeitoun',
  'umm_zeitoun_2',
  'umm_zeitoun_3',
  'umm_zeitoun_4',
  'wadi_halam_2',
  'wadi_halam_3',
  'wadi_halam_4',
  'wadi_halam_5',
  'wadi_halam_basin',
  'wadi_tarfan',
  'wadi_tarfan_l',
];

const SHIPPED = new Set(SHIPPED_MAP_IDS);
/** Own membership only: `has` on a Set never reads the prototype chain. */
export const isShippedMap = (id: string): boolean => SHIPPED.has(id);
