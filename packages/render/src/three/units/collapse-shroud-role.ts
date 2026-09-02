/**
 * The collapse shroud's own closed shade vocabulary -- `deep`/`body`/`crown`,
 * three `data/palette.json` `ramps.dust` entries assigned by a puff's HEIGHT
 * in the lattice `collapse-shroud.ts`'s `collapseShroudLayout` builds.
 *
 * Its own small vocabulary rather than a re-export of
 * `./smoke-plume-role.ts`, for the same two reasons that file gives for not
 * re-exporting `./vfx-mesh-role.ts`, both of which genuinely apply again:
 *
 *   - The GEOMETRY relationship differs in kind. `base`/`mid`/`top` name
 *     three SLABS cut out of one column mesh by height -- a fixed, exhaustive
 *     partition of one asset. These name three SHADES a variable number of
 *     free-floating puffs are assigned from, and the count of puffs at each
 *     shade changes with the building's own size (a compound wall's shroud is
 *     one puff deep; an apartment's is three). "Which slab am I" and "which
 *     shade did the lattice hand me" are not the same question.
 *   - The palette TABLE points somewhere else again. The plume resolves to
 *     `ramps.gunmetal` -- sooty smoke off a burning hull. A building coming
 *     down throws pulverised masonry, which is what `ramps.dust`' own `role`
 *     string in `data/palette.json` names in as many words: "sand, dirt
 *     roads, rubble, particulate". `structure_collapse.json`'s own authored
 *     dust layer already grades `["dust.2", "dust.4"]` for exactly this
 *     event, so this is the established reading in this codebase for a
 *     collapse specifically, not a fresh guess.
 *
 * The plume and the shroud therefore differ in colour family ON PURPOSE and
 * that is the point of having both: the shroud is the pulverised stone the
 * building throws at the instant it fails (warm, `dust`), and the plume is
 * the sooty column that goes on rising from the wreck afterwards (cold,
 * `gunmetal`). Painting them the same would collapse two events into one.
 */

export const COLLAPSE_SHROUD_SHADES = ['deep', 'body', 'crown'] as const;

export type CollapseShroudShade = (typeof COLLAPSE_SHROUD_SHADES)[number];

/**
 * shade -> the one `ramps.dust` entry it always resolves to, unconditionally
 * -- never a ramp slice, never blended with its neighbours, the same rule
 * every VFX-mesh colour table in this backend states for its own table.
 *
 * Index direction is the trap CLAUDE.md names ("Palette ramps descend in
 * brightness... index 0 is lightest; 'higher terrain = higher index' comes
 * out inverted, and it cost three renders"). `dust.colors` is seven stops
 * from `#E0B87A` (0, lightest) to `#6B4F29` (6, darkest). So the table below
 * reads DESCENDING index from `deep` to `crown` deliberately: `deep` is the
 * lowest lattice row, packed against the rubble where the dust is thickest
 * and least lit, so it takes the DARKER entry; `crown` is the top row, thin
 * and lit from above, so it takes the LIGHTEST.
 *
 * `dust.4`/`dust.2` are the exact pair `data/vfx/structure_collapse.json`'s
 * own `smoke_puff` layer already grades between for this same event
 * (`color_over_life: ["dust.2", "dust.4"]`), so the mesh shroud and the
 * particle dust it draws among cannot read as two different materials.
 * `dust.1` extends that pair one stop lighter for the crown rather than
 * inventing a third family.
 */
const COLLAPSE_SHROUD_SHADE_KEY: Readonly<Record<CollapseShroudShade, string>> = {
  deep: 'dust.4',
  body: 'dust.2',
  crown: 'dust.1',
};

export function collapseShroudPaletteKey(shade: CollapseShroudShade): string {
  return COLLAPSE_SHROUD_SHADE_KEY[shade];
}

/**
 * Which shade the puff on lattice row `row` of `rows` takes -- the one place
 * the "lowest row is thickest" reading above is turned into an index.
 *
 * A one-row lattice (every low_profile structure in the game: a compound
 * wall, a fence) gets `body`, not `deep`: `deep` means "the bottom of a
 * column of dust with more dust above it", and a wall panel's shroud has no
 * column. Reading it as the darkest stop would make the shortest thing on
 * the map also the darkest, which is backwards.
 */
export function collapseShroudShadeForRow(row: number, rows: number): CollapseShroudShade {
  if (rows <= 1) return 'body';
  if (row <= 0) return 'deep';
  if (row >= rows - 1) return 'crown';
  return 'body';
}
