import { units } from '@lions/data';

/** One unit of the shipped roster, as the versus room registers it. */
export type VersusRosterUnit = (typeof units)[keyof typeof units];

/**
 * Shipped unit ids a versus room does NOT register.
 *
 * `heli_yanshuf` (GH-698): registering an AIR CARRIER type in a `Sim` turns on
 * the air block's hash fold (`airLive`), which moves every versus/net hash pin
 * even though no versus side can field the unit. The Yanshuf is off the versus
 * menu (`data/doctrines/*.json`) until the air-assault probe gives it a bar
 * (spec Q9). Deleting the id here registers it again and moves the versus pins,
 * in that same commit -- which is the right time for them to move.
 *
 * `wounded_kdf` and `wounded_sarim` (GH-707 P2): two more registered types would
 * move the roster-count literals every net spec pins (35, 36, ...) and the type
 * index layout. No unit declares `hull.wounds` yet and no versus side can field
 * either, so the room leaves them out until the rescue loop is opened to versus
 * (the lead's call); that commit deletes the ids here and moves the literals.
 *
 * `veh_ambulance` and `air_medevac_heli` (GH-709): both declare `hull.can_carry:
 * ['wounded']`, which turns the sim's wound hash fold on (and the medevac is an
 * AIR carrier, which turns the air fold on besides), so registering either moves
 * every versus/net hash pin although no versus side can field them. Held with
 * the Yanshuf and the wounded pair until the rescue loop opens to versus.
 *
 * `inf_medic_squad` (GH-707 P2): its `rescue` block does the same to the wound hash fold
 * (the sim keys `woundLive` off a type carrying one), so it is held with the others.
 *
 * `mbt_lavi_camo` and `spg_long_range` (GH-709 Phase 2), and `spg_cluster` (Phase 7):
 * credit-only store units, on no
 * doctrine menu. Registering a type a versus side can never field would move the
 * roster-count and hash pins for nothing, so they are held the same way until a versus
 * design gives a special unit a seat. `ugv_recon_dog` (Phase 8) joins them for the same
 * reason. So does `at_nlos_team` (Phase 7).
 */
export const VERSUS_HELD_UNITS: ReadonlySet<string> = new Set([
  'at_nlos_team',
  'heli_yanshuf',
  'wounded_kdf',
  'wounded_sarim',
  'veh_ambulance',
  'air_medevac_heli',
  'inf_medic_squad',
  'mbt_lavi_camo',
  'spg_cluster',
  'spg_long_range',
  'ugv_recon_dog',
]);

/**
 * The unit types a versus room registers, in roster order: the shipped
 * `units` minus `VERSUS_HELD_UNITS`. The ONE list every versus/net world walks
 * (`buildMatchWorld`, `seatKitTiers`, the net test world, the versus probe), so
 * the type-index layout cannot differ between them.
 */
export function versusRoster(): readonly VersusRosterUnit[] {
  return (Object.values(units) as VersusRosterUnit[]).filter((u) => !VERSUS_HELD_UNITS.has(u.id));
}
