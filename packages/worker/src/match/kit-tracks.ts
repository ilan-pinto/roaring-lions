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
};
