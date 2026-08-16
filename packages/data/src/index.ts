// @lions/data — typed access to game content JSON.
// Leaf package: imports no other @lions package (enforced by lint).
// Content JSON lives at repo-root data/ — the path CONTRIBUTING.md, the
// Python validators, and the art pipeline all reference.

import palette from '../../../data/palette.json';
import audioManifest from '../../../data/audio.json';
import worldJson from '../../../data/campaign/world.json';
import countriesJson from '../../../data/campaign/countries.json';
import beitSahwanOutskirts from '../../../data/maps/beit_sahwan_outskirts.json';
import marjPerimeter from '../../../data/maps/marj_perimeter.json';
import tutorialGround from '../../../data/maps/tutorial_ground.json';
import wadiHalamBasin from '../../../data/maps/wadi_halam_basin.json';
import structureCatalogue from '../../../data/structures.json';
import beitSahwanBreach from '../../../data/missions/beit_sahwan_breach.json';
import beitSahwan0 from '../../../data/missions/beit_sahwan_0_tutorial.json';
import beitSahwan1 from '../../../data/missions/beit_sahwan_1_recon.json';
import beitSahwan2 from '../../../data/missions/beit_sahwan_2_foothold.json';
import beitSahwan3 from '../../../data/missions/beit_sahwan_3_clearance.json';
import wadiHalam1Fords from '../../../data/missions/wadi_halam_1_fords.json';
import wadiHalam2Laager from '../../../data/missions/wadi_halam_2_laager.json';
import wadiHalam3Counterraid from '../../../data/missions/wadi_halam_3_counterraid.json';
import wadiHalam4Village from '../../../data/missions/wadi_halam_4_village.json';
import wadiHalam5Depot from '../../../data/missions/wadi_halam_5_depot.json';
import tutorialBeitSahwan0 from '../../../data/tutorial/beit_sahwan_0.json';

import mbtLavi from '../../../data/units/kdf/mbt_lavi.json';
import ifvNamer from '../../../data/units/kdf/ifv_namer.json';
import apcEitan from '../../../data/units/kdf/apc_eitan.json';
import infSquad from '../../../data/units/kdf/inf_squad.json';
import atTeam from '../../../data/units/kdf/at_team.json';
import mortarTeam from '../../../data/units/kdf/mortar_team.json';
import reconDrone from '../../../data/units/kdf/recon_drone.json';
import demoSquad from '../../../data/units/kdf/demo_squad.json';
import attackDrone from '../../../data/units/kdf/attack_drone.json';
import sniperTeam from '../../../data/units/kdf/sniper_team.json';
import jeepShoded from '../../../data/units/kdf/jeep_shoded.json';
import dozerD9 from '../../../data/units/kdf/dozer_d9.json';
import heliPeten from '../../../data/units/kdf/heli_peten.json';
import militiaCell from '../../../data/units/enemy/militia_cell.json';
import rpgTeam from '../../../data/units/enemy/rpg_team.json';
import atgmCell from '../../../data/units/enemy/atgm_cell.json';
import technical from '../../../data/units/enemy/technical.json';
import mortarCrew from '../../../data/units/enemy/mortar_crew.json';
import gunTruck from '../../../data/units/enemy/gun_truck.json';
import motoRpg from '../../../data/units/enemy/moto_rpg.json';
import chargeSquad from '../../../data/units/enemy/charge_squad.json';
import paramotor from '../../../data/units/enemy/paramotor.json';
import loiterDrone from '../../../data/units/enemy/loiter_drone.json';
import civilians from '../../../data/units/civilians.json';

import fireApfsds from '../../../data/vfx/fire_apfsds.json';
import fireAutocannon from '../../../data/vfx/fire_autocannon.json';
import fireHeat from '../../../data/vfx/fire_heat.json';
import fireHmg from '../../../data/vfx/fire_hmg.json';
import fireMissile from '../../../data/vfx/fire_missile.json';
import fireMortar from '../../../data/vfx/fire_mortar.json';
import cigaretteEmber from '../../../data/vfx/cigarette_ember.json';
import cigaretteSmoke from '../../../data/vfx/cigarette_smoke.json';
import fireSmallArms from '../../../data/vfx/fire_small_arms.json';
import structureCollapse from '../../../data/vfx/structure_collapse.json';

export { palette };
export type Palette = typeof palette;

/** Battle audio manifest — clips are served from assets/audio/. */
export { audioManifest };

export {
  parseMap,
  DECOR,
  STRUCTURE_SYMBOLS,
  TERRAIN_LEGEND,
  type MapJson,
  type ParsedMap,
  type DecorKind,
  type TerrainTheme,
} from './map';

/** Battlefield maps, keyed by map id. Shapes match map.schema.json. */
export const maps = {
  beit_sahwan_outskirts: beitSahwanOutskirts,
  marj_perimeter: marjPerimeter,
  tutorial_ground: tutorialGround,
  wadi_halam_basin: wadiHalamBasin,
} as const;

export type MapId = keyof typeof maps;

/** Building types, keyed by id. Shapes match structure.schema.json. */
export const structures = structureCatalogue.types;
export type StructureId = keyof typeof structures;

/** Missions, keyed by mission id. Shapes match mission.schema.json. */
export const missions = {
  beit_sahwan_breach: beitSahwanBreach,
  beit_sahwan_0_tutorial: beitSahwan0,
  beit_sahwan_1_recon: beitSahwan1,
  beit_sahwan_2_foothold: beitSahwan2,
  beit_sahwan_3_clearance: beitSahwan3,
  wadi_halam_1_fords: wadiHalam1Fords,
  wadi_halam_2_laager: wadiHalam2Laager,
  wadi_halam_3_counterraid: wadiHalam3Counterraid,
  wadi_halam_4_village: wadiHalam4Village,
  wadi_halam_5_depot: wadiHalam5Depot,
} as const;

/** The campaign world. Shape matches world.schema.json; parsed by app/src/campaign.ts. */
export const world = worldJson;

/** Generated country geometry for the world render. Shape matches
 *  countries.schema.json; parsed by app/src/campaign.ts. */
export const countries = countriesJson;

export type MissionId = keyof typeof missions;

/** Tutorial step lists, keyed by id. Shapes match tutorial.schema.json.
 *
 *  Read by @lions/app only. A step's gate may test player input, which the sim
 *  does not know about — putting these in the mission runtime would mean
 *  pushing selection state into @lions/sim.
 */
export const tutorials = {
  beit_sahwan_0: tutorialBeitSahwan0,
} as const;

export type TutorialId = keyof typeof tutorials;

/** The full unit roster, keyed by unit id. Shapes match unit.schema.json. */
export const units = {
  mbt_lavi: mbtLavi,
  ifv_namer: ifvNamer,
  apc_eitan: apcEitan,
  inf_squad: infSquad,
  at_team: atTeam,
  mortar_team: mortarTeam,
  recon_drone: reconDrone,
  demo_squad: demoSquad,
  attack_drone: attackDrone,
  sniper_team: sniperTeam,
  jeep_shoded: jeepShoded,
  dozer_d9: dozerD9,
  heli_peten: heliPeten,
  militia_cell: militiaCell,
  rpg_team: rpgTeam,
  atgm_cell: atgmCell,
  technical: technical,
  mortar_crew: mortarCrew,
  gun_truck: gunTruck,
  moto_rpg: motoRpg,
  charge_squad: chargeSquad,
  paramotor: paramotor,
  loiter_drone: loiterDrone,
  civilians: civilians,
} as const;

export type UnitId = keyof typeof units;

/** Every emitter the renderer may need.
 *
 * Weapon-fire ones are indexed by weapon class; the two `ambient_idle` ones are
 * looked up by name, because idling is not a sim event and must not become one.
 * `structure_collapse` is looked up by name too, off the `structureDestroyed`
 * event — the sim says a building fell, the renderer decides what that looks
 * like.
 */
export const vfxEmitters = [
  fireSmallArms,
  fireHmg,
  fireAutocannon,
  fireApfsds,
  fireHeat,
  fireMissile,
  fireMortar,
  cigaretteEmber,
  cigaretteSmoke,
  structureCollapse,
];

/** Resolve a palette key like "vfx.fire" or "dust.2" to its hex colour. */
export function paletteColor(key: string): string {
  const dot = key.indexOf('.');
  const band = key.slice(0, dot);
  const name = key.slice(dot + 1);
  const ramps = palette.ramps as Record<string, { colors: string[] }>;
  const reserved = palette.reserved as Record<string, { colors: Record<string, string> }>;
  if (band in ramps) return ramps[band].colors[Number(name)] ?? '#FF00FF';
  if (band in reserved) return reserved[band].colors[name] ?? '#FF00FF';
  return '#FF00FF';
}
