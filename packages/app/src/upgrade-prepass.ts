// The battlefield's one read of the brigade's bought tiers (WP-S3g §3.4, the
// final review's parked item (e)).
//
// A mission runs with the kit the account held when it booted (brigade D3:
// tiers are type-wide and fixed for the mission). Three things need that
// kit: the unit types `bootBattlefield` registers with the sim, patched by
// `applyUpgrades`; the HUD card, which draws each KDF type's pips and the
// hit points they bought; and the kit sign on each own unit's icon
// (WP-S3g plan 2b). They used to be two loops over `ownedTiers` -- the card's
// behind an `as unknown as UpgradableUnit` cast -- and separate loops over
// one read are separate places a filter or a default can drift, after which
// the card, or an icon, shows a kit the mission is not running. Here all
// of them come out of ONE loop, from the SAME per-type tiers object, so they
// cannot disagree -- and since GH-238 (kitted vehicles) a fourth: the tiers
// themselves, handed to the renderer, which merges the bought parts into
// each mesh vehicle at load.
import { applyUpgrades, type KitLevel, type UpgradableUnit } from '@lions/data';
import { kitSummary, type KitSummary } from './ui/kit-sign';

export interface UpgradePrepass<T> {
  /** Every unit, in roster order (the sim numbers its types by it): a KDF
   *  type patched with its owned tiers, any other faction untouched -- only
   *  the player's brigade buys kit, and an enemy id in the account is noise. */
  readonly registered: T[];
  /** The kit on each KDF type, for the HUD card -- every KDF type, bought or
   *  not (level 0 draws nothing), and no other faction. */
  readonly kitByType: Map<string, KitSummary>;
  /** The kit sign's level on every unit icon (chips, card frame, dock tiles)
   *  -- from the same summary the card draws; every KDF type, bought or not,
   *  and no other faction. The world mark this once fed was rejected
   *  (plan 2b). */
  readonly unitKit: Readonly<Record<string, KitLevel>>;
  /** Each KDF type's bought tiers by track, for `RendererOptions.
   *  unitKitTiers` (GH-238): the renderer keeps the kit parts they own when
   *  it builds a vehicle's template. A frozen copy of the SAME tiers object
   *  `applyUpgrades` patched the registered type with and `kitSummary` drew
   *  the card from -- every KDF type, bought or not (`{}` draws no kit), and
   *  no other faction. */
  readonly unitKitTiers: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export function upgradePrepass<T extends UpgradableUnit & { readonly faction: string }>(
  roster: readonly T[],
  ownedTiers: Readonly<Record<string, Readonly<Record<string, number>>>>
): UpgradePrepass<T> {
  const registered: T[] = [];
  const kitByType = new Map<string, KitSummary>();
  const unitKit: Record<string, KitLevel> = {};
  const unitKitTiers: Record<string, Readonly<Record<string, number>>> = {};
  for (const u of roster) {
    if (u.faction !== 'kdf') {
      registered.push(u);
      continue;
    }
    const tiers = ownedTiers[u.id] ?? {};
    registered.push(applyUpgrades(u, tiers));
    const summary = kitSummary(u, tiers);
    kitByType.set(u.id, summary);
    unitKit[u.id] = summary.level;
    unitKitTiers[u.id] = Object.freeze({ ...tiers });
  }
  return { registered, kitByType, unitKit, unitKitTiers };
}
