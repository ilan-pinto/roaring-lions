/**
 * The kit a seat may claim in a `brigade` room (per-seat kit, Task 2): every
 * KDF type, each track it declares, and that track's maximum tier. The room
 * cleans a seat's claim against this table (`seatTiersField`) and refuses
 * nothing else about it: there is no server ledger to check a claim against
 * until ST6, so the check is structural (decision 22). Kept here as a plain
 * table, as `map-ids.ts` keeps the maps, so the Worker does not bundle the
 * unit data; `kit-tracks.test.ts` pins it to `@lions/data`'s `units` and
 * `maxTiers` both ways.
 */
export const KIT_TRACKS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  mbt_lavi: { armour: 3, sensors: 3, firepower: 3 },
  ifv_namer: { armour: 3, sensors: 3, firepower: 3 },
  apc_eitan: { armour: 3, sensors: 3, firepower: 3 },
  inf_squad: { armour: 3, sensors: 3, firepower: 3 },
  at_team: { armour: 3, sensors: 3, firepower: 3 },
  mortar_team: { armour: 3, sensors: 3, firepower: 3 },
  recon_drone: { armour: 3, sensors: 3 },
  demo_squad: { armour: 3, sensors: 3, firepower: 3 },
  attack_drone: { armour: 3, sensors: 3, firepower: 3 },
  sniper_team: { armour: 3, sensors: 3, firepower: 3 },
  jeep_shoded: { armour: 3, sensors: 3, firepower: 3 },
  dozer_d9: { armour: 3, sensors: 3 },
  heli_peten: { armour: 3, sensors: 3, firepower: 3 },
  yahalom_squad: { armour: 3, sensors: 3, firepower: 3 },
  breach_team: { armour: 3, sensors: 3, firepower: 3 },
  scout_shachaf: { armour: 3, sensors: 3, firepower: 3 },
  apc_kipod: { armour: 3, sensors: 3, firepower: 3 },
  recon_zikit: { sensors: 3, armour: 3 },
  heli_peten_gunship: { armour: 3, sensors: 3, firepower: 3 },
  heli_yanshuf: { armour: 3, sensors: 3, firepower: 3 },
  demo_tzav: { armour: 3, firepower: 3 },
  // GH-1077: the nine bought-only units that shipped with no tracks (WP8).
  mbt_lavi_camo: { armour: 3, sensors: 3, firepower: 3 },
  spg_long_range: { armour: 3, sensors: 3 },
  spg_cluster: { armour: 3, sensors: 3 },
  at_nlos_team: { armour: 3, sensors: 3, firepower: 3 },
  veh_ambulance: { armour: 3, sensors: 3 },
  air_medevac_heli: { armour: 3, sensors: 3 },
  inf_medic_squad: { armour: 3, sensors: 3 },
  inf_grenadier: { armour: 3, sensors: 3, firepower: 3 },
  ugv_recon_dog: { armour: 3, sensors: 3 },
};

/**
 * GH-1384: the BRANCHED tracks of each KDF type, a set per type (one today, under the content cap C1, but
 * nothing here assumes one). A branched track's last tier is an either/or of two branches, and a seat's
 * `picks` name which one it fields (`seatPicksField`). A pick is read only for a track listed here, and only
 * where the seat's cleaned tiers hold that track's LAST tier (`KIT_TRACKS`). Pinned to `@lions/data`'s
 * `branchedTracks` both ways by `kit-tracks.test.ts`, as `KIT_TRACKS` is to `maxTiers`.
 */
export const KIT_BRANCHES: Readonly<Record<string, readonly string[]>> = {
  mbt_lavi: ['firepower'],
  ifv_namer: ['firepower'],
  apc_eitan: ['firepower'],
  inf_squad: ['firepower'],
  at_team: ['sensors'],
  mortar_team: ['sensors'],
  recon_drone: ['sensors'],
  sniper_team: ['firepower'],
  jeep_shoded: ['armour'],
  dozer_d9: ['armour'],
  heli_peten: ['firepower'],
  scout_shachaf: ['sensors'],
  apc_kipod: ['armour'],
};
