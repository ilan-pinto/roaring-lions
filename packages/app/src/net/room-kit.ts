// The kit a versus seat's screen draws, read from the room's world alone
// (per-seat kit plan, Task 5).
//
// In single-player the HUD card, the unit icons and the renderer all read ONE
// prepass, built from this machine's account (`bootBattlefield`). A versus
// room has two: `buildMatchWorld` runs one per SIDE from the config both
// machines share, and side 1's kitted units carry the SAME type id as side 0's
// -- only their sim type index differs. So a table keyed by id can describe
// one side and no more, and which side it describes must be chosen, never
// inherited from whichever prepass happened to be nearest.
//
// - The HUD's tables (`kitByType`, `unitKit`) are the VIEWER's side: the card,
//   the chips and the frame sign are drawn only for an own unit
//   (`hud.ts`, `isOwnSide`), so the viewer's side is the only side they read.
// - The renderer draws both sides, so it gets both (`unitKitTiersBySide`),
//   and keys a vehicle template by (type id, side): side 1 draws its own
//   template exactly where its kit differs from side 0's (`templateKey`,
//   `@lions/render`), and shares side 0's everywhere else.
//
// Nothing here reads the account: a tier one machine read locally would be a
// desync at the first shot, and a kit drawn that the sim is not running.
import type { KitLevel } from '@lions/data';
import type { KitTiers, KitTiersBySide } from '@lions/render';
import type { KitSummary } from '../ui/kit-sign';
import type { UpgradePrepass } from '../upgrade-prepass';
import type { MatchWorld } from './match-world';

/** Each KDF type's tiers by track, as `RendererOptions.unitKitTiers` takes them. */
export type { KitTiers };

/** The tables a seat's screen draws, from the world alone. */
export function roomKitTables(world: MatchWorld, me: 0 | 1): {
  kitByType: Map<string, KitSummary>;
  unitKit: Readonly<Record<string, KitLevel>>;
  unitKitTiersBySide: KitTiersBySide;
} {
  const mine = world.kitBySide[me];
  return {
    kitByType: mine.kitByType,
    unitKit: mine.unitKit,
    unitKitTiersBySide: [world.kitBySide[0].unitKitTiers, world.kitBySide[1].unitKitTiers],
  };
}

/** The kit tables one battlefield screen reads: the HUD's two and the
 *  renderer's (one table, plus both sides' in a versus room). */
export interface ScreenKit {
  kitByType: Map<string, KitSummary>;
  unitKit: Readonly<Record<string, KitLevel>>;
  /** `RendererOptions.unitKitTiers`: side 0's table. */
  unitKitTiers: KitTiers;
  /** Both sides' tiers in a versus room, for the renderer's per-side
   *  templates (`RendererOptions.unitKitTiersBySide`); absent everywhere
   *  else, which keeps every other screen on one template per type. */
  unitKitTiersBySide?: KitTiersBySide;
}

/**
 * `bootBattlefield`'s one choice of kit source. No versus world (single-player,
 * a mission, the sandbox, a sandbox room): the boot's own prepass, exactly the
 * tables it read before rooms had kit. A versus world: `roomKitTables` for
 * this viewer, and both sides' tables for the renderer (`unitKitTiers` is
 * side 0's, as `RendererOptions` reads it) -- never the boot prepass, which a
 * room builds from no account and which describes neither seat.
 */
export function screenKit(
  prepass: Pick<UpgradePrepass<unknown>, 'kitByType' | 'unitKit' | 'unitKitTiers'>,
  world: MatchWorld | null,
  me: 0 | 1
): ScreenKit {
  if (world === null) return { kitByType: prepass.kitByType, unitKit: prepass.unitKit, unitKitTiers: prepass.unitKitTiers };
  const room = roomKitTables(world, me);
  return {
    kitByType: room.kitByType,
    unitKit: room.unitKit,
    unitKitTiers: room.unitKitTiersBySide[0],
    unitKitTiersBySide: room.unitKitTiersBySide,
  };
}
