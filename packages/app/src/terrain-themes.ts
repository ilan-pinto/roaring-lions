/**
 * Terrain tones by theme -- shared between the live app (`main.ts`) and
 * `terrain-parity.test.ts`'s three.js conformance suite, both of which need
 * the exact bundle every terrain builder resolves a tile's tone through.
 *
 * Until Task B3.1, each one declared its own verbatim copy: `main.ts`'s
 * module body is `main().catch(...)`, which boots the live app against
 * `document`/`window`, so `terrain-parity.test.ts` could not import it
 * directly and copied the table instead (its own doc comment said so).
 * Neither file is `packages/render` (which may not import `@lions/data`) or
 * `packages/sim` (which imports nothing) -- both copies were always
 * `packages/app`-internal, so the fix is a third, app-internal module both
 * import, not a package boundary to cross.
 *
 * Task B3.1's inventory diffed the two copies line-by-line (ignoring
 * comments/whitespace) before this extraction and found them identical
 * across all 40 tone values in both themes -- this file is a lossless
 * extraction of `main.ts`'s copy (the more heavily annotated of the two,
 * so its doctrinal comments -- why `grass.4` and not `grass.3`, why
 * `crownRatio` must be below 1 -- are kept rather than lost), not a merge
 * of two divergent tables.
 *
 * The arid bundle is byte-identical to the values that were hardcoded in
 * `renderer.ts`'s `drawTerrain` -- `drawTerrain` has no tests, so "Beit
 * Sahwan renders unchanged" is proven by these numbers not moving and by
 * looking at it. Typing this as a `Record` makes a missing theme a compile
 * error, not a test.
 */
import { paletteColor, type TerrainTheme } from '@lions/data';
import type { TerrainTones } from '@lions/render';

export const TERRAIN_THEMES: Record<TerrainTheme, TerrainTones> = {
  arid: {
    open: paletteColor('limestone.3'),
    cover: [paletteColor('limestone.2'), paletteColor('dust.1'), paletteColor('dust.0')],
    blocked: paletteColor('limestone.4'),
    underBuilding: paletteColor('shadow.0'),
    road: paletteColor('dust.3'),
    rut: paletteColor('dust.5'),
    rock: paletteColor('limestone.6'),
    rockLit: paletteColor('limestone.3'),
    earth: paletteColor('terracotta.2'),
    low: paletteColor('olive.1'),
    trunk: paletteColor('dust.5'),
    trunkLit: paletteColor('dust.3'),
    leafDark: paletteColor('olive.2'),
    leafMid: paletteColor('olive.1'),
    leafLit: paletteColor('olive.0'),
    // The stone branch never reads these; the type is total, so it needs values.
    bladeLit: paletteColor('limestone.2'),
    bladeShade: paletteColor('limestone.5'),
    // Spoil: freshly turned subsoil, redder and darker than anything the
    // limestone surface shows, so a dig line reads as a wound in the ground.
    spoil: paletteColor('terracotta.1'),
    crownRatio: 0.52,
    scatter: 'stone',
  },
  green: {
    open: paletteColor('grass.2'),
    // grass.3 is the blade-shade tone; a hedgerow in that same colour would not
    // separate from the ground it sits on.
    cover: [paletteColor('grass.4'), paletteColor('scrub.0'), paletteColor('scrub.1')],
    // Buildings stay limestone. Stone in a green valley is correct, not a
    // compromise, and it ties the village to the dry-stone terrace walls.
    blocked: paletteColor('limestone.4'),
    underBuilding: paletteColor('shadow.0'),
    road: paletteColor('dust.4'),
    rut: paletteColor('dust.6'),
    // A knoll in the basin is a dry-stone terrace wall, so it stays limestone
    // in both themes rather than becoming a green rock.
    rock: paletteColor('limestone.6'),
    rockLit: paletteColor('limestone.3'),
    earth: paletteColor('dust.5'),
    low: paletteColor('scrub.0'),
    trunk: paletteColor('dust.5'),
    trunkLit: paletteColor('dust.3'),
    leafDark: paletteColor('scrub.1'),
    leafMid: paletteColor('grass.4'),
    leafLit: paletteColor('grass.2'),
    bladeLit: paletteColor('grass.0'),
    // grass.4, not grass.3. The shade blade sits on a grass.2 wash, and
    // grass.3 is only 16 luma below it -- close enough that half the marks
    // vanished and the sward read as a flat field with a few light flecks.
    // grass.4 is 37 below, which is the same order of separation the arid
    // pass gets from limestone.6 against limestone.3.
    bladeShade: paletteColor('grass.4'),
    // Spoil on sward is dark loam, not laterite: dust.5 sits well below the
    // grass.2 wash in value, which is what makes the line legible.
    spoil: paletteColor('dust.5'),
    // Taller than wide. drawCanopy computes ry = rx * crownRatio, so ANY
    // value below 1 is a squat crown -- 0.95 drew near-perfect circles and
    // the poplar gallery read as a bramble thicket. The olive's 0.52 is
    // correct for what it is; a poplar needs the ratio the other side of 1.
    crownRatio: 1.5,
    scatter: 'sward',
  },
};

/**
 * The OPEN-GROUND albedo each theme draws, as the basename of a file in
 * `assets/textures/` (and a key of `terrain/mesh.ts`'s `GROUND_ALBEDOS`,
 * which is where its mean colour and repeat scale live).
 *
 * A second table beside `TERRAIN_THEMES` rather than a field inside
 * `TerrainTones`, for the reason `TerrainTones` is what it is: that bundle is
 * COLOUR, resolved through `paletteColor` and consumed by pure builders in
 * `packages/render` that have no idea what a URL is. `main.ts` is what turns
 * this basename into a URL, because `BASE` and the `assets/` publicDir are
 * app facts.
 *
 * `Record<TerrainTheme, ...>` and not a partial one: a theme added to
 * `map.schema.json` and to `TERRAIN_THEMES` but not here is a compile error,
 * where a lookup with a fallback would have been a map that silently drew the
 * desert. Which is the defect this table exists to fix -- `wadi_halam_basin`
 * has been the only `green` map since Naharin was authored, and until
 * 2026-09-03 every renderer drew its river basin with `desert_sand_tile`.
 */
export const TERRAIN_GROUND_TEXTURE: Record<TerrainTheme, string> = {
  arid: 'desert_sand_tile',
  green: 'green_basin_tile',
};
