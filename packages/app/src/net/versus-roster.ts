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
 * Wounds are ON in versus (the lead, 23 Oct 2026, after the versus-wounds probe):
 * every infantry type a room registers keeps `hull.wounds` and `hull.figures`, and
 * `wounded_kdf` / `wounded_sarim` are registered, so a man who falls wounded goes
 * down instead of dying. Rescue stays OUT (next paragraph): a man down in a room
 * bleeds out or is overrun, nobody carries him. Both wounded types take population
 * 0 (`cost.population`), so a side's own wounded never block its builds.
 *
 * `veh_ambulance` and `air_medevac_heli` (GH-709), and `inf_medic_squad` (GH-707
 * P2): on no doctrine menu, so no versus side can field them, and each turns the
 * sim's wound hash fold on (`can_carry`, `rescue`; the medevac is an AIR carrier,
 * which turns the air fold on besides). Held with the Yanshuf until the rescue loop
 * opens to versus: only the KDF has a rescue unit, and the probe has no rescue arm.
 *
 * `mbt_lavi_camo` and `spg_long_range` (GH-709 Phase 2), and `spg_cluster` (Phase 7):
 * credit-only store units, on no
 * doctrine menu. Registering a type a versus side can never field would move the
 * roster-count and hash pins for nothing, so they are held the same way until a versus
 * design gives a special unit a seat. `ugv_recon_dog` (Phase 8) joins them for the same
 * reason. So does `at_nlos_team` (Phase 7), and `demo_tzav` (GH-274, bought-only).
 *
 * `drone_swarm` (E6, GH-274 chunk A1): a Sarim campaign enemy (E6 Q10) that no doctrine menu
 * builds and no seat fields, and one entity standing for twelve drones, which a lockstep
 * versus world has no rule for yet. Held the same way until a versus design gives it a seat;
 * `drone_swarm` is registered last in `units`, so no earlier type index moves either.
 *
 * `aa_remetz` (E6, GH-274 chunk A2): the KDF laser carrier. Its beam has no versus rule yet (the lockstep world does
 * not step `directed_energy`), and it exists to answer the swarm, which is itself held; both stay held until a
 * versus design gives them seats. It follows `drone_swarm` in `units`, so no earlier type index moves.
 */
export const VERSUS_HELD_UNITS: ReadonlySet<string> = new Set([
  'at_nlos_team',
  'demo_tzav',
  'heli_yanshuf',
  'veh_ambulance',
  'air_medevac_heli',
  'inf_medic_squad',
  'mbt_lavi_camo',
  'spg_cluster',
  'spg_long_range',
  'ugv_recon_dog',
  'drone_swarm',
  'aa_remetz',
]);

/**
 * The unit types a versus room registers, in roster order: the shipped
 * `units` minus `VERSUS_HELD_UNITS`. The ONE list every versus/net world walks
 * (`buildMatchWorld`, `seatKitTiers`, the net test world, the versus probe), so
 * the type-index layout cannot differ between them. Each type is the shipped
 * one, wounds included (see `VERSUS_HELD_UNITS`).
 */
export function versusRoster(): readonly VersusRosterUnit[] {
  return (Object.values(units) as VersusRosterUnit[]).filter((u) => !VERSUS_HELD_UNITS.has(u.id));
}
