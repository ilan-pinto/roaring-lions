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
 * `mbt_lavi_camo` and `spg_long_range` (GH-709 Phase 2), and `spg_cluster` (Phase 7):
 * credit-only store units, on no
 * doctrine menu. Registering a type a versus side can never field would move the
 * roster-count and hash pins for nothing, so they are held the same way until a versus
 * design gives a special unit a seat. `ugv_recon_dog` (Phase 8) joins them for the same
 * reason.
 */
export const VERSUS_HELD_UNITS: ReadonlySet<string> = new Set([
  'heli_yanshuf',
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
