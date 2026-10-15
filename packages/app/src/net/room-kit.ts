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
// - The renderer draws both sides, so it gets both (`unitKitTiersBySide`).
//
// Nothing here reads the account: a tier one machine read locally would be a
// desync at the first shot, and a kit drawn that the sim is not running.
import type { KitLevel } from '@lions/data';
import type { KitSummary } from '../ui/kit-sign';
import type { UpgradePrepass } from '../upgrade-prepass';
import type { MatchWorld } from './match-world';

/** Each KDF type's tiers by track, as `RendererOptions.unitKitTiers` takes them. */
export type KitTiers = Readonly<Record<string, Readonly<Record<string, number>>>>;

/** The tables a seat's screen draws, from the world alone. */
export function roomKitTables(world: MatchWorld, me: 0 | 1): {
  kitByType: Map<string, KitSummary>;
  unitKit: Readonly<Record<string, KitLevel>>;
  unitKitTiersBySide: readonly [KitTiers, KitTiers];
} {
  const mine = world.kitBySide[me];
  return {
    kitByType: mine.kitByType,
    unitKit: mine.unitKit,
    unitKitTiersBySide: [world.kitBySide[0].unitKitTiers, world.kitBySide[1].unitKitTiers],
  };
}

/**
 * What a renderer with ONE template per type id may draw in a room: each id's
 * tiers where the two sides agree, and `{}` (no kit) where they differ -- so
 * neither side's hull ever wears a kit its sim type is not running. A matched
 * room, or a brigade room whose seats hold the same kit, therefore passes its
 * tiers through whole. The interim until the renderer builds a template per
 * side (`unitKitTiersBySide`, plan Task 6), which draws a differing id right.
 */
export function sharedKitTiers(bySide: readonly [KitTiers, KitTiers]): KitTiers {
  const out: Record<string, Readonly<Record<string, number>>> = {};
  for (const [id, zero] of Object.entries(bySide[0])) {
    out[id] = sameTiers(zero, bySide[1][id]) ? zero : Object.freeze({});
  }
  return out;
}

/** Two tier tables equal on key-sorted entries, zero tiers ignored. */
function sameTiers(a: Readonly<Record<string, number>> | undefined, b: Readonly<Record<string, number>> | undefined): boolean {
  const entries = (t: Readonly<Record<string, number>> | undefined): string =>
    JSON.stringify(Object.entries(t ?? {}).filter(([, n]) => n > 0).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  return entries(a) === entries(b);
}

/** The kit tables one battlefield screen reads: the HUD's two and the
 *  renderer's one. */
export interface ScreenKit {
  kitByType: Map<string, KitSummary>;
  unitKit: Readonly<Record<string, KitLevel>>;
  /** `RendererOptions.unitKitTiers`. */
  unitKitTiers: KitTiers;
  /** Both sides' tiers in a versus room, for the renderer's per-side
   *  templates (plan Task 6); absent everywhere else. */
  unitKitTiersBySide?: readonly [KitTiers, KitTiers];
}

/**
 * `bootBattlefield`'s one choice of kit source. No versus world (single-player,
 * a mission, the sandbox, a sandbox room): the boot's own prepass, exactly the
 * tables it read before rooms had kit. A versus world: `roomKitTables` for
 * this viewer, and the renderer's single table through `sharedKitTiers` until
 * it takes one per side -- never the boot prepass, which a room builds from no
 * account and which describes neither seat.
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
    unitKitTiers: sharedKitTiers(room.unitKitTiersBySide),
    unitKitTiersBySide: room.unitKitTiersBySide,
  };
}
