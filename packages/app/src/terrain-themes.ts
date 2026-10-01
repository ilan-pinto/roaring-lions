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
import { paletteColor, type GroveSpecies, type ParsedMap, type TerrainTheme } from '@lions/data';
import type { GroveFamily, TerrainTones } from '@lions/render';

export const TERRAIN_THEMES: Record<TerrainTheme, TerrainTones> = {
  arid: {
    open: paletteColor('limestone.3'),
    cover: [paletteColor('limestone.2'), paletteColor('dust.1'), paletteColor('dust.0')],
    blocked: paletteColor('limestone.4'),
    underBuilding: paletteColor('shadow.0'),
    // The approved arid road tone (ground plan Task 8, D2/F-8): the road is
    // now a procedural surface drawn from the control map's own distance
    // field, not a decorated tile tone, so it reads as packed limestone
    // rather than the loose dust `dust.3` gave it.
    road: paletteColor('limestone.4'),
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
    // A desert tree, not an olive -- the lead's call, 2026-09-07. See
    // `TerrainTones.groveFamily`: the two supplied olive sources are the only
    // tree in the blend library, and this default-`arid` theme is every map
    // in the game but Wadi Halam.
    groveFamily: 'desert_tree',
    // N-18: the haze is dust, not fog -- the desert's own lightest dust.
    haze: paletteColor('dust.0'),
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
    // D2/F-8: `dust.3`, not the darker `dust.4` -- the same approved tone
    // family the arid theme takes, one ramp step lighter to sit on a green
    // basin's own wash instead of limestone.
    road: paletteColor('dust.3'),
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
    // The olive stays where it belongs: the one green map is the river basin,
    // and an olive terrace there is the picture the Naharin arc is written on.
    groveFamily: 'tree',
    // N-18: a pale limestone haze over the basin rather than a desert dust.
    haze: paletteColor('limestone.1'),
  },
  // GH-322: the Sur front -- "rockets range onto Kedem's north from behind a
  // mountain wall". The lead's rulings of 1 Oct, on the revision-2 mock:
  // brown terra rossa earth dominant between grey limestone (ground V2), the
  // Meshy Cedrus libani, more stones and outcrops, the mock's densities.
  // Every value below is the approved mock's (GH-322's numbers table, R2.1-
  // R2.5), and any non-highland map is pinned unmoved by
  // `terrain-defaults.test.ts`.
  highland: {
    // dust.5 over the V2 image. The ratio form keeps the image's own hue
    // per texel, so this sets the AVERAGE only: limestone.6 on the same image
    // read tan-orange, limestone.5 read as sand again.
    open: paletteColor('dust.5'),
    // Maquis is green, not dust: the scrub tile's twigs on olive.
    cover: [paletteColor('olive.1'), paletteColor('olive.2'), paletteColor('olive.3')],
    // Grey limestone, the theme-only `karst` ramp (`paletteRamps` below).
    blocked: paletteColor('karst.3'),
    underBuilding: paletteColor('shadow.0'),
    road: paletteColor('karst.3'),
    rut: paletteColor('dust.5'),
    rock: paletteColor('karst.3'),
    rockLit: paletteColor('karst.1'),
    earth: paletteColor('terracotta.2'),
    low: paletteColor('olive.2'),
    trunk: paletteColor('dust.5'),
    trunkLit: paletteColor('dust.3'),
    leafDark: paletteColor('olive.3'),
    leafMid: paletteColor('scrub.1'),
    leafLit: paletteColor('olive.1'),
    bladeLit: paletteColor('limestone.2'),
    bladeShade: paletteColor('limestone.5'),
    spoil: paletteColor('terracotta.1'),
    crownRatio: 0.52,
    scatter: 'stone',
    groveFamily: 'cedar',
    // A cool pale-stone haze instead of the desert's dust.
    haze: paletteColor('karst.0'),
    // `karst` is `theme_only` in palette.json: only a theme that names it
    // quantises onto it, which is what keeps every other map unmoved.
    paletteRamps: ['karst'],
    decorColors: {
      // The lead's pick: cedar needles on scrub.1, a deep blue-green that
      // reads as a conifer under the sun where olive reads as an olive.
      'cedar:foliage': paletteColor('scrub.1'),
      // Grey-green garrigue, one olive step darker than the ramp's own lift.
      'bush:foliage': paletteColor('olive.2'),
      // Left at limestone.6 the chips and outcrops read as orange crumbs on
      // the earth; grey limestone, the ridge walls' own family.
      'boulder:rock': paletteColor('karst.2'),
      'rock:rock': paletteColor('karst.2'),
      'slab:rock': paletteColor('karst.3'),
    },
    openScatter: {
      tree: 'cedar',
      // Cedars climb the slopes; the basin floor stays open for the fight.
      // Tel Marum: ~26 cedars on 1534 open tiles.
      treePlain: 0.008,
      treeFoothill: 0.035,
      boulderPlain: 0.015,
      boulderFoothill: 0.05,
      bush: 0.05,
      chipPlain: 0.12,
      chipFoothill: 0.2,
      chipCluster: 0.5,
      // No sand tufts: pale litter on this ground read as yellow patches.
      sandKeep: 0,
    },
    macroHue: [paletteColor('karst.0'), paletteColor('terracotta.2')],
  },
};

/**
 * The `GroveFamily` a map's grove override names (`map.schema.json`'s
 * `grove`). Total, so a species added to the schema without a mesh family is
 * a compile error.
 */
export const GROVE_SPECIES_FAMILY: Record<GroveSpecies, GroveFamily> = {
  olive: 'tree',
  desert: 'desert_tree',
  cedar: 'cedar',
};

/**
 * The tones a map draws with: its theme's bundle, with the grove species
 * swapped when the map overrides it (GH-322 -- Umm Zeitoun keeps its olive
 * terraces inside the cedar highland). A map with no override gets the
 * theme's bundle BY IDENTITY, so every map before the override existed is
 * handed exactly the object it always was.
 */
export function terrainTonesFor(map: Pick<ParsedMap, 'terrain' | 'grove'>): TerrainTones {
  const theme = TERRAIN_THEMES[map.terrain];
  if (map.grove === null) return theme;
  const groveFamily = GROVE_SPECIES_FAMILY[map.grove];
  return groveFamily === theme.groveFamily ? theme : { ...theme, groveFamily };
}

/**
 * The OPEN-GROUND albedo each theme draws, as the basename of a file in
 * `assets/textures/` -- a `.jpg` since 2026-09-07, encoded from the tracked
 * PNG source in `art/textures/` by `tools/textures/encode_ground_tiles.py`
 * (level load time, step 2) -- (and a key of `terrain/mesh.ts`'s `GROUND_ALBEDOS`,
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
  // GH-322's "V2": terra rossa between grey limestone chips.
  highland: 'highland_v2_tile',
};
