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
 * `wounded_kdf` and `wounded_sarim` (GH-707): held, and wounds are OFF in every
 * room (the lead, 22 Oct: wounds in versus is a later decision). Registering the two
 * would move the roster-count literals every net spec pins and the type index
 * layout; and since P3 every infantry type carries `hull.wounds`, which on its own
 * turns the sim's wound hash fold on at `addUnitType` -- so `versusRoster` also
 * strips `hull.wounds` and `hull.figures` from what it hands a room (below). A room
 * is therefore byte-identical to main before P3. Opening wounds to versus deletes
 * the two ids here and the strip in `versusRoster`, and moves the versus pins.
 *
 * `veh_ambulance` and `air_medevac_heli` (GH-709), and `inf_medic_squad` (GH-707
 * P2): on no doctrine menu, so no versus side can field them, and each turns the
 * sim's wound hash fold on (`can_carry`, `rescue`; the medevac is an AIR carrier,
 * which turns the air fold on besides). Held with the Yanshuf and the wounded pair
 * until the rescue loop opens to versus.
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
 *
 * Each type comes WITHOUT `hull.wounds` and `hull.figures` (GH-707 P3): wounds are
 * off in versus until the lead opens them (see `VERSUS_HELD_UNITS`). A copy, never
 * the shared `units` object, so the campaign keeps both.
 */
export function versusRoster(): readonly VersusRosterUnit[] {
  return (Object.values(units) as VersusRosterUnit[])
    .filter((u) => !VERSUS_HELD_UNITS.has(u.id))
    .map((u) => withoutWounds(u));
}

/** `u` with no `hull.wounds` and no `hull.figures`; `u` itself when it has neither. */
function withoutWounds(u: VersusRosterUnit): VersusRosterUnit {
  const hull = u.hull as Record<string, unknown>;
  if (!('wounds' in hull) && !('figures' in hull)) return u;
  const { wounds: _w, figures: _f, ...rest } = hull;
  void _w;
  void _f;
  return { ...u, hull: rest } as unknown as VersusRosterUnit;
}
