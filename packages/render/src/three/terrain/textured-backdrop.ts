/**
 * The named exemption that lets a backdrop kit GLB ship its own baked atlas,
 * and the closed list of pieces its nodes may name.
 *
 * ## Why a fifth exemption exists
 *
 * `TEXTURED_BUILDING_TYPES`, `TEXTURED_DECOR_FAMILIES`,
 * `TEXTURED_CAMPAIGN_MAPS` and the infantry list each cover one kind of asset,
 * and none can be stretched over a landform without making it mean something
 * vaguer than it says. This is the backdrop counterpart, with the same two
 * locks and the same Python twin.
 *
 * It is not a close call either. The palette path colours an asset by ROLE and
 * SLOPE through one flat albedo per role; a valley wall's subject is colour
 * that varies at a constant normal: pale scree streaks running down one
 * scrub-green face, strata banding a single cliff, olive rows on a flat tread.
 * That is the same structural reason `ditch` and `sahar_basin` were granted
 * theirs (GH-161, lead ruling of 26 Oct 2026: one 2048 baked atlas, base colour
 * and ambient occlusion only, every colour a `data/palette.json` key, no
 * directional light in the bake).
 *
 * ## Two locks, the same pair the others carry
 *
 *  1. The GLB says what it is: every mesh node carries `extras.rl_textured =
 *     true` and `extras.rl_piece`, a name from `KIT_PIECES`.
 *  2. The list says who is ALLOWED to: a GLB in `art/meshes/backdrop/` whose
 *     basename is not in `TEXTURED_BACKDROP_KITS` that ships a texture fails
 *     `pnpm validate:meshes`, and a listed kit that lost its texture fails too.
 *
 * `TEXTURED_BACKDROP_EXEMPT` and `BACKDROP_PIECES` in
 * `tools/validate_mesh_assets.py` are the other half of both;
 * `textured-backdrop.test.ts` parses that Python and fails if they drift.
 *
 * ## Colour space
 *
 * The atlas is an ordinary base-colour map: `GLTFLoader` stamps
 * `SRGBColorSpace` on it and `prepareTexturedMap` confirms it, exactly like
 * every textured building. Move one half without the other and the valley
 * renders too dark or too pale and still looks like a plausible valley.
 */

/** The kits whose GLBs may ship their own baked atlas. The id is the GLB's
 *  basename and joins with a map's `backdrop.kit`. Must stay in step with
 *  `TEXTURED_BACKDROP_EXEMPT` in `tools/validate_mesh_assets.py`. */
export const TEXTURED_BACKDROP_KITS: ReadonlySet<string> = new Set(['wadi_halam_kit']);

/**
 * The closed list of piece names a kit node may carry in `extras.rl_piece`,
 * and the triangle cap of each (`PIECE_CAPS` in `tools/backdrop/pieces.py`).
 * Must stay in step with `BACKDROP_PIECES` in `tools/validate_mesh_assets.py`.
 */
export const KIT_PIECES: Readonly<Record<string, number>> = {
  bd_wall_far_a: 8000,
  bd_wall_far_b: 8000,
  bd_wall_far_c: 8000,
  bd_wall_corner: 10000,
  bd_head_wall: 12000,
  bd_taper: 6000,
  bd_outer_corner: 6000,
  bd_crest_a: 2500,
  bd_crest_b: 2500,
  bd_slope_near_a: 5000,
  bd_slope_near_b: 5000,
  bd_slope_corner: 6000,
  bd_terrace_a: 2500,
  bd_terrace_b: 2500,
  bd_terrace_end: 1500,
  bd_scree_a: 1000,
  bd_scree_b: 1000,
  bd_scree_c: 1000,
  bd_olive: 64,
};

/** The one non-placed piece: the olive every terrace instances. */
export const OLIVE_PIECE = 'bd_olive';

/** Whether a kit id is allowed to ship its own baked atlas. */
export function isTexturedBackdropKit(kit: string): boolean {
  return TEXTURED_BACKDROP_KITS.has(kit);
}

/** Whether a piece name is in the kit's closed list. */
export function isKitPiece(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(KIT_PIECES, name);
}
