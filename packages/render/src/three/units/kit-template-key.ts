// Which vehicle template a unit draws from (per-seat kit plan, Task 6).
//
// Pure and three-free. A mesh vehicle's bought kit is merged into its
// TEMPLATE at load (`vehicle-kit.ts`, +0 draw calls), so a template wears one
// kit. A versus room can field two kits on one type id: `buildMatchWorld`
// registers side 1 its own sim type when its kit differs from side 0's, and
// both copies keep the SAME id, so the renderer keys a template by (id, side)
// rather than by id -- and only where the two kits really differ.
//
// - Side 0, any side past 1 (civilians), and single-player (no `bySide`)
//   draw the id's one template, exactly as before this file existed.
// - Side 1 shares that template when its tiers for the id equal side 0's,
//   under `sameTrackTiers`, the rule `buildMatchWorld` itself decides with
//   (zero tiers field nothing;
//   key order does not matter). So a matched room, or a brigade room whose
//   seats hold the same kit, loads nothing new.
// - Otherwise side 1 draws `${id}${SIDE_1_TEMPLATE_SUFFIX}` (`#s1`), built
//   with side 1's tiers.
//
// The tables are plain data from the app's room world (`net/room-kit.ts`);
// `render` never imports `net`.

/** One unit type's bought tiers by track (`armour`, `sensors`, `firepower`). */
export type TrackTiers = Readonly<Record<string, number>>;
/** Each type's tiers by track, keyed by type id: `RendererOptions.unitKitTiers`. */
export type KitTiers = Readonly<Record<string, TrackTiers>>;
/** Side 0's table, then side 1's: `RendererOptions.unitKitTiersBySide`. */
export type KitTiersBySide = readonly [KitTiers, KitTiers];

/** The suffix a side-1 template's key carries: the ONE spelling, which
 *  `templateKey` builds the key from and `ThreeRenderer` looks it up by.
 *  Side 1 is the only side whose key can differ from the id. */
export const SIDE_1_TEMPLATE_SUFFIX = '#s1';

/**
 * Whether two tier tables field the same kit: key-sorted entries with zero
 * tiers dropped. The ONE "same kit" predicate: `buildMatchWorld`
 * (`app/net/match-world.ts`) imports it to decide whether side 1 gets its own
 * sim type, and `room-kit.test.ts` holds `templateKey` against that world.
 */
export function sameTrackTiers(a: TrackTiers | undefined, b: TrackTiers | undefined): boolean {
  const entries = (t: TrackTiers | undefined): string =>
    JSON.stringify(
      Object.entries(t ?? {})
        .filter(([, n]) => n > 0)
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
    );
  return entries(a) === entries(b);
}

/**
 * The template key a unit of type `id` on `side` draws from. Written without
 * a side literal (`side-literals.test.ts`): a side's own table is compared
 * with side 0's, so side 0 always matches itself, and a side past the two
 * seats (civilians) has no table and draws the id's one template.
 */
export function templateKey(id: string, side: number, bySide: KitTiersBySide | undefined): string {
  const own: KitTiers | undefined = bySide?.[side];
  if (bySide === undefined || own === undefined) return id;
  // Only side 1 can get here unshared: side 0 compares equal to itself, and
  // a side past the two seats has no table.
  return sameTrackTiers(bySide[0][id], own[id]) ? id : `${id}${SIDE_1_TEMPLATE_SUFFIX}`;
}

/**
 * The tiers the template for (`id`, `side`) is built with. A room reads each
 * side its own table; with no `bySide` (single-player, a mission, the
 * sandbox) `unitKitTiers` is read for every side -- it is side 0's table, and
 * side 1 shares side 0's template there.
 */
export function templateKitTiers(
  id: string,
  side: 0 | 1,
  unitKitTiers: KitTiers | undefined,
  bySide: KitTiersBySide | undefined
): TrackTiers | undefined {
  return bySide !== undefined ? bySide[side][id] : unitKitTiers?.[id];
}
