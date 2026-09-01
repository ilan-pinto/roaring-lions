/**
 * The closed role vocabulary for scattered terrain decor.
 *
 * Decor is its own asset class, so it gets its own set -- the same reason
 * VFX got `core/mid/outer` rather than borrowing the vehicle set. `foliage`
 * and `trunk` are not `hull` and `plate` in any useful sense, and reusing
 * those names would make a decor GLB silently loadable as a vehicle.
 *
 * Unlike vehicles, decor has NO per-object table: a rock is the same grey
 * whichever family placed it, because decor has no faction and no paint job.
 * One role, one ramp, shared by every family.
 */
import { readRamp } from '../units/mesh-role';

export const DECOR_MESH_ROLES = ['foliage', 'trunk', 'rock', 'sand'] as const;

export type DecorMeshRole = (typeof DECOR_MESH_ROLES)[number];

export function isDecorMeshRole(role: string): role is DecorMeshRole {
  return (DECOR_MESH_ROLES as readonly string[]).includes(role);
}

/** `readRamp(band).slice(index)` to the END of the band, the same shading
 *  convention `vehicle-mesh-role.ts` uses for every entry in its own table. */
function sliceFrom(band: string, index: number): readonly string[] {
  return readRamp(band).slice(index);
}

const DECOR_ROLE_PALETTE: Record<DecorMeshRole, readonly string[]> = {
  // Living green, distinct from the olive a KDF uniform uses.
  // OLIVE, not scrub. The procedural canopy this replaced shaded its leaves
  // through `terrain-themes.ts`'s `leafDark`/`leafMid`/`leafLit` = olive.2/1/0
  // -- a muted grey-green with three steps. `scrub` is a bright, saturated
  // grass-green with only TWO, so mesh trees came out flat and vivid: the
  // project lead's word for it was "broccoli". Switching to olive restores the
  // hue the game already calls leaves AND gains a fourth shading step, so a
  // crown reads as rounded rather than as one lump of colour.
  foliage: sliceFrom('olive', 0),
  // Woody stems. Starts at dust.3 to match the theme's own `trunkLit`
  // (`#AC8248`) rather than one step darker, which left the lit side of a
  // trunk too close to its shadow to read as round.
  trunk: sliceFrom('dust', 3),
  // Warm brown stone, matching the terrain it sits on: `terrain-themes.ts`
  // sets `rock: paletteColor('limestone.6')` in BOTH themes ("A knoll in the
  // basin is a dry-stone terrace wall, so it stays limestone in both themes
  // rather than becoming a green rock" -- that file's own comment). Slicing
  // from index 6 starts this ramp at that exact tone. NOT gunmetal: that is
  // a cold metal grey -- the same ramp `mesh-role.ts` gives `metal` and
  // `weapon` -- which would draw a mesh rock in cold blue-grey directly on
  // warm brown terrain stone.
  rock: sliceFrom('limestone', 6),
  // Ground litter: pale, so it reads as sand rather than as shadow.
  sand: sliceFrom('limestone', 3),
};

export function rampForDecorRole(role: string): readonly string[] {
  if (!isDecorMeshRole(role)) {
    throw new Error(
      `decor-role: unknown rl_role "${role}" -- not in the closed decor role vocabulary`
    );
  }
  return DECOR_ROLE_PALETTE[role];
}
