/**
 * The `kit_*` node contract, shared by `kit-pass.ts` (which writes kit nodes)
 * and `wreck-pass.ts` (which must never twin, measure or key one).
 *
 * A separate module rather than an export of either pass because each pass
 * already wants a constant from the other, and an import cycle between two
 * CLI entry points is the kind of thing that works until it does not.
 *
 * The contract itself is written down in
 * `docs/superpowers/specs/2026-08-28-mesh-unit-contract.md`, "v5 (vehicles)".
 */

/** Every kit part's node name starts with this, and nothing else's does. */
export const KIT_PREFIX = 'kit_';

/** True for a node the kit pass wrote (or a hand-made one claiming to be). */
export const isKitName = (name: string): boolean => name.startsWith(KIT_PREFIX);

/** A track name: lower-case letters only, so `kit_<track>_<tier>_<host>`
 *  parses back unambiguously however many underscores the host carries. */
export const KIT_TRACK_PATTERN = /^[a-z]+$/;

/** The highest tier a track has: tiers are 1, 2 and 3 (cumulative). */
export const KIT_MAX_TIER = 3;

/** The one name a kit part with this `rl_kit` may carry. */
export const kitNodeName = (track: string, tier: number, host: string): string =>
  `${KIT_PREFIX}${track}_${tier}_${host}`;
