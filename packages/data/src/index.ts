// @lions/data — typed access to game content JSON.
// Leaf package: imports no other @lions package (enforced by lint).
// Content JSON lives at repo-root data/ — the path CONTRIBUTING.md, the
// Python validators, and the art pipeline all reference.

import palette from '../../../data/palette.json';
import beitSahwanOutskirts from '../../../data/maps/beit_sahwan_outskirts.json';
import beitSahwan1 from '../../../data/missions/beit_sahwan_1_recon.json';
import beitSahwan2 from '../../../data/missions/beit_sahwan_2_foothold.json';
import beitSahwan3 from '../../../data/missions/beit_sahwan_3_clearance.json';

import mbtLavi from '../../../data/units/kdf/mbt_lavi.json';
import ifvNamer from '../../../data/units/kdf/ifv_namer.json';
import apcEitan from '../../../data/units/kdf/apc_eitan.json';
import infSquad from '../../../data/units/kdf/inf_squad.json';
import atTeam from '../../../data/units/kdf/at_team.json';
import mortarTeam from '../../../data/units/kdf/mortar_team.json';
import reconDrone from '../../../data/units/kdf/recon_drone.json';
import militiaCell from '../../../data/units/enemy/militia_cell.json';
import rpgTeam from '../../../data/units/enemy/rpg_team.json';
import atgmCell from '../../../data/units/enemy/atgm_cell.json';
import technical from '../../../data/units/enemy/technical.json';
import mortarCrew from '../../../data/units/enemy/mortar_crew.json';
import civilians from '../../../data/units/civilians.json';

export { palette };
export type Palette = typeof palette;

export { parseMap, type MapJson, type ParsedMap } from './map';

/** Battlefield maps, keyed by map id. Shapes match map.schema.json. */
export const maps = {
  beit_sahwan_outskirts: beitSahwanOutskirts,
} as const;

export type MapId = keyof typeof maps;

/** Missions, keyed by mission id. Shapes match mission.schema.json. */
export const missions = {
  beit_sahwan_1_recon: beitSahwan1,
  beit_sahwan_2_foothold: beitSahwan2,
  beit_sahwan_3_clearance: beitSahwan3,
} as const;

export type MissionId = keyof typeof missions;

/** The full unit roster, keyed by unit id. Shapes match unit.schema.json. */
export const units = {
  mbt_lavi: mbtLavi,
  ifv_namer: ifvNamer,
  apc_eitan: apcEitan,
  inf_squad: infSquad,
  at_team: atTeam,
  mortar_team: mortarTeam,
  recon_drone: reconDrone,
  militia_cell: militiaCell,
  rpg_team: rpgTeam,
  atgm_cell: atgmCell,
  technical: technical,
  mortar_crew: mortarCrew,
  civilians: civilians,
} as const;

export type UnitId = keyof typeof units;

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
