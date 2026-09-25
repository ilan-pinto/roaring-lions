/**
 * The one `RendererOptions` object a map's mission or sandbox boot builds --
 * extracted out of `bootBattlefield` (Task 2 of the scene-host plan) so the
 * host that will draw a lit diorama behind the main menu (spec §3.2) can ask
 * for exactly the same options a mission gets, rather than keeping a second,
 * drifting copy of this literal.
 *
 * Parameterised on the three things `bootBattlefield` used to close over:
 * the parsed map (`map.terrain` picks the theme and the ground texture), the
 * player's own settings (colour-vision variant and video quality -- both read
 * ONCE, at construction time, the same way `bootBattlefield` always did: a
 * change mid-mission takes effect from the next boot, which is what
 * `settings.quality.hint` tells the player), and the deploy base (`'/'`
 * locally, `'/<repo>/'` on GitHub Pages) every asset URL is built from.
 */
import { paletteColor, paletteTeamColors, variantAwareResolver, type ParsedMap } from '@lions/data';
import { QUALITY_PRESETS, type RendererOptions } from '@lions/render';
import { dracoDecoderPath } from './mesh-catalogue';
import type { ColorVision, Quality } from './settings';
import { TERRAIN_GROUND_TEXTURE, TERRAIN_THEMES } from './terrain-themes';

/** The slice of the player's settings a `RendererOptions` is built from.
 *  Named rather than passed as the whole `Settings` object so a caller with
 *  no save file -- the scene host, before Task 3 -- can supply just these
 *  two fields instead of a full settings store. */
export interface RendererSettings {
  readonly colorVision: ColorVision;
  readonly quality: Quality;
}

/**
 * Build the `RendererOptions` a `ThreeRenderer` or `PixiRenderer` is
 * constructed with for one map.
 *
 * `base` is `bootBattlefield`'s own `BASE` (`import.meta.env.BASE_URL`) --
 * passed in rather than read here so this stays a pure function of its
 * arguments, the same reason `map` and `s` are parameters instead of module
 * state.
 */
export function rendererOptionsFor(map: ParsedMap, s: RendererSettings, base: string): RendererOptions {
  return {
    background: paletteColor('shadow.1'),
    teamColors: paletteTeamColors(s.colorVision),
    hullColors: [paletteColor('olive.1'), paletteColor('dust.2'), paletteColor('limestone.1')],
    infantryColors: [paletteColor('olive.0'), paletteColor('dust.0'), paletteColor('limestone.1')],
    groupColors: [
      paletteColor('group.g1'),
      paletteColor('group.g2'),
      paletteColor('group.g3'),
      paletteColor('group.g4'),
      paletteColor('group.g5'),
      paletteColor('group.g6'),
      paletteColor('group.g7'),
      paletteColor('group.g8'),
      paletteColor('group.g9'),
    ],
    terrainTones: TERRAIN_THEMES[map.terrain],
    tracerColors: [paletteColor('vfx.tracer'), paletteColor('vfx.ember')],
    // GH-149. Deliberately NOT `tracerColors` -- an arcing round is
    // ordnance, not a bullet, and drew green until now. See
    // `RendererOptions.shellColors`.
    shellColors: [paletteColor('vfx.fire'), paletteColor('vfx.ember')],
    flashColor: paletteColor('vfx.fire'),
    nearMissColor: paletteColor('dust.0'),
    interceptColor: paletteColor('vfx.interceptor'),
    // `variantAwareResolver` (@lions/data) is `paletteColor` for every key
    // except the four `team.*` ones, which it routes through this same
    // `s.colorVision` -- the silhouette outline (`silhouette.ts`'s
    // `SILHOUETTE_COLOR_KEY_BY_SIDE`, every billboard `UnitInstancer`'s
    // `uTeam` and the mesh path's shared materials), the HP bar
    // (`hpBarColorKey`), the objective-zone tint (`objectiveZoneColorKey`)
    // and the min-range ring all ask for a palette key by name rather than
    // reading `teamColors` above, so a bare `paletteColor` here would leave
    // every one of them on the default palette no matter what the player
    // picked.
    resolveColor: variantAwareResolver(s.colorVision),
    // The ground albedos, served out of the repo-root `assets/` publicDir
    // like every sprite sheet and font. Three-only and fail-soft: Pixi
    // ignores the fields and the three ground draws its flat palette tone if
    // an image never arrives. See `RendererOptions.groundTextureUrl`.
    //
    // Open ground is chosen by the map's own theme, the SAME read that picks
    // `terrainTones` two lines up -- `TERRAIN_GROUND_TEXTURE[map.terrain]`,
    // typed as a total `Record<TerrainTheme, ...>` so a new theme is a
    // compile error here rather than a map that silently draws sand.
    //
    // All six of these are requested UNCONDITIONALLY here -- this file has no
    // per-tile view of the map (and, since 2026-09-06, is expressly forbidden
    // from building one: `@lions/render/terrain` is production-app-restricted
    // by `eslint.config.mjs`, precisely because this package has no other use
    // for the pure builders). Deciding which of the six this map's own tiles
    // can actually sample -- and skipping a fetch for the rest -- is
    // `ThreeRenderer.loadGroundTexture`'s own job now: it already holds the
    // real `sim`/decor/elevation once `init()` runs, and building a second,
    // independent copy of that state here just to answer the same question
    // twice is exactly the risk of two answers drifting apart.
    groundTextureUrl: `${base}textures/${TERRAIN_GROUND_TEXTURE[map.terrain]}.jpg`,
    // Each of the four below is one surface, one image, and one independent
    // failure: a ridge that loses its texture is still a ridge. The road has
    // no image of its own any more (GH-226): it is drawn procedurally from
    // control texture B's distance field, tone and grain both, and no
    // longer asks for `roadTextureUrl` at all.
    rockTextureUrl: `${base}textures/rock_ground_tile.jpg`,
    scrubTextureUrl: `${base}textures/rough_scrub_tile.jpg`,
    groveTextureUrl: `${base}textures/orchard_floor_tile.jpg`,
    knollTextureUrl: `${base}textures/knoll_scree_tile.jpg`,
    // Where the Draco decoder is fetched from. Self-hosted in `assets/draco/`
    // like the fonts, never a CDN. Every shipped GLB is Draco-compressed
    // (level load time, step 4), so a mesh renderer without this loads no
    // mesh at all -- it is not a nicety, and `gltf-loader.ts` says so.
    dracoDecoderPath: dracoDecoderPath(),
    // Shell upgrade Phase 1: the video-quality setting, read once like
    // `s.colorVision` above -- a change mid-mission takes effect from the
    // next one, which is what `settings.quality.hint` tells the player.
    // Three-only (see `RendererOptions.quality`); Pixi ignores it like every
    // other field in this stretch.
    quality: QUALITY_PRESETS[s.quality],
  };
}
