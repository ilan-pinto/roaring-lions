/**
 * The ground mesh: an interpolated, smoothly-shaded surface over the open
 * ground, flat terraces where the sim says there is a wall, and the vertical
 * faces between the two.
 *
 * ## This file used to say the opposite, and both of its reasons are gone
 *
 * Until 2026-09-03 a tile top here was a flat quad at its own integer height
 * -- "terraces, not ramps" -- corners were never interpolated and vertices
 * were never shared, because a shared vertex would interpolate across a
 * terrace edge and produce an off-palette gradient. Two reasons stood behind
 * that: Pixi parity, and the palette guarantee.
 *
 * Pixi parity is retired. VFX have been exempt since 2026-08-30, the
 * cross-backend gate has been report-only since 2026-09-02, and three-only
 * is the intended end state. The palette guarantee is not retired -- it is
 * NARROWED, by a named exemption written to the same shape as the three that
 * came before it (see `surface.ts`'s `SURFACE_SHADING_EXEMPTION`, which is
 * the authority; this file's job is to keep to it). Concretely, and this
 * file is where it is kept:
 *
 *  - **Every vertex colour this builder emits is still a palette entry**,
 *    and so is every `litColors` entry. `tones.ts` was not touched. Colour
 *    is still decided ONCE PER TILE and written identically to every vertex
 *    of that tile, which is also why vertices are still not shared BETWEEN
 *    tiles: a shared vertex would interpolate a road tone into the open
 *    ground beside it. Within a tile they are shared freely -- one colour,
 *    nothing to smear.
 *  - **The exemption is the fragment stage.** `groundSurfaceMaterial`
 *    multiplies by a smooth normal-driven shade and by a sampled albedo --
 *    sand on the interpolated open ground, rock on a `^` ridge. Every OTHER
 *    vertex this builder emits carries the UP normal, where that shade term
 *    is exactly 1.0, and a zero in both masks, where the albedo term is
 *    exactly 1.0 -- so its pixels are the same palette bytes they always
 *    were.
 *
 * ## A map with no relief takes the old path, byte for byte
 *
 * Four of the six shipped maps have no relief. `buildGround` still emits
 * exactly two triangles per tile and no side faces for those, with the same
 * vertices in the same order and the same colours -- the pre-existing code,
 * unchanged, below `if (surface.flat)`. That is what makes "nothing moved on
 * a flat map" a property rather than a hope, and it is why the `quiet`,
 * `open-ground` and `vehicle` golden scenarios are expected to hold their
 * noise floor across this change while `relief` moves wholesale.
 */
import { composite, quantise, groundTone, rampNeighbor, PALETTE_HEXES } from './tones';
import { DECOR_GROVE, DECOR_RIDGE, DECOR_ROAD, hexToUnit, levelAt, pushPolygon, WORLD_PER_LEVEL } from './shared';
import {
  buildTerrainSurface,
  hasWall,
  isTerrace,
  smoothLevel,
  smoothNormal,
  SURFACE_SUBDIVISIONS,
  type TerrainSurface,
} from './surface';
import type { MeshData, TerrainInput } from './types';
import type { TerrainTones } from '../../api';

export type { MeshData, TerrainInput };

/** How many ramp steps `buildGround`'s `litColors` output shifts a tone
 *  toward its lightest step -- see this file's own `buildGround` doc
 *  comment. One step is deliberately modest: unlike a vehicle/building
 *  hull's `toonRampMaterial` (which can shift up to `MAX_SHIFT_STEPS` in
 *  `flash-light.ts`, four bands), terrain's own "ramp" per tile has no fixed
 *  length to reason about -- a tone can be one step from its ramp's own
 *  lightest entry already, and `rampNeighbor` clamps rather than wrapping,
 *  so asking for more than 1 buys nothing on a short ramp while still
 *  costing the same lookup on a long one. */
const GROUND_LIT_STEPS = 1;

/** Alphas Pixi composites the two visible side faces at (`renderer.ts:1421`,
 *  `:1432`) -- different on purpose, so a ridge reads as mass rather than a
 *  flat shape. Exported so `scatter.ts`'s slope-face dressing (strata lines,
 *  lit edge, foot scree) composites over the same base tone this module's
 *  own faces use, rather than a second, independently-retunable copy that
 *  could silently drift off the face it sits on. */
export const FACE_ALPHA_EAST = 0.7;
export const FACE_ALPHA_SOUTH = 0.85;

/** The normal every terrace top, every wall and every vertex of a map with
 *  no relief carries. `groundSurfaceMaterial`'s shade term is exactly 1.0
 *  here -- see `surface.ts`'s `SURFACE_SHADING_EXEMPTION`. */
const UP_NORMAL: readonly [number, number, number] = [0, 1, 0];

/**
 * Which of `groundSurfaceMaterial`'s five albedo slots a vertex draws, and
 * how strongly.
 *
 * One value per slot rather than one enum, because they are five separate
 * decisions about five separate surfaces and each is asserted on its own
 * (`types.ts` gives the same reason for keeping `sandMask` and `rockMask`
 * apart). They are nevertheless MUTUALLY EXCLUSIVE by construction -- a tile
 * is one surface -- and `ground.test.ts` asserts that on every shipped map,
 * because two non-zero slots would multiply two albedos onto one fragment
 * and the result would be neither.
 */
interface Albedo {
  /** Open ground: sand on an `arid` map, dry sward on a `green` one. */
  readonly sand: number;
  /** A `^` rock ridge: its flat top, and the cliff faces below it. */
  readonly rock: number;
  /** An `r` dirt road. */
  readonly road: number;
  /** Which way this road tile's ruts run -- see `roadAxisAt`. Meaningless,
   *  and 0, wherever `road` is 0. */
  readonly roadAxis: number;
  /** A `1`/`2`/`3` cover tile, at its tier's own strength. */
  readonly scrub: number;
  /** An `o` olive grove's floor. */
  readonly grove: number;
}

/** No albedo at all: the palette tone, untouched. A building footprint, and
 *  every wall that is not a ridge face. */
const NO_ALBEDO: Albedo = { sand: 0, rock: 0, road: 0, roadAxis: 0, scrub: 0, grove: 0 };
const SAND_ALBEDO: Albedo = { ...NO_ALBEDO, sand: 1 };
const RIDGE_ALBEDO: Albedo = { ...NO_ALBEDO, rock: 1 };
const GROVE_ALBEDO: Albedo = { ...NO_ALBEDO, grove: 1 };

/**
 * How strongly each cover tier samples the scrub albedo -- the mix weight
 * toward the image's own variation, so tier 1 is faintly rough ground and
 * tier 3 is a thicket.
 *
 * **A contrast ladder, not a tone ladder, and that was decided by
 * measurement rather than taste.** The obvious move is to branch `groundTone`
 * on cover and composite the already-authored `tones.cover[tier - 1]` over
 * the open wash, which would give each tier its own palette entry. It does
 * not work, twice over. Quantisation eats it: sweeping the alpha for `arid`,
 * everything below 0.5 snaps all three tiers back onto `limestone.3` -- the
 * open-ground tone itself -- so there is no gentle version. And at the 0.6
 * where three distinct entries finally appear, the entries are
 * `limestone.2` / `dust.1` / `dust.0`, whose luminances are 193 / 175 / 185
 * against open ground's 182: three different colours in no order at all.
 * That triple was authored for TUFTS, which need to contrast with the ground
 * they sit on, not for a density ramp. Inventing new palette keys to fix
 * that is a palette change, not a terrain one.
 *
 * Contrast is also the physically right cue. Seen from above, sparse bushes
 * on open ground are mostly the open ground, so the tile's variation is low;
 * a thicket is all highlight and shadow. The scrub source's per-pixel std is
 * 29.1 grey levels on a mean of 92, so the ratio it applies swings roughly
 * 0.6-1.5 -- at strength 0.4 that is a +/-24% mottle and at 1.0 a +/-60% one.
 *
 * The tuft marks `scatter.ts` already places (`cover + 2` of them, in the
 * tier's own authored tone) are KEPT on top and are the second, palette-legal
 * cue: count and colour, over contrast and texture.
 */
export const SCRUB_TIER_STRENGTH: readonly [number, number, number] = [0.4, 0.65, 1.0];

/**
 * Which axis a road tile's ruts run along: 0 north-south, 1 east-west, 0.5
 * both at once. `groundSurfaceMaterial` blends its two samples of the wheel
 * track by this -- see the fragment shader.
 *
 * The source is a single track running down the image, so an unrotated
 * sample IS a north-south road; the swap is east-west; and the average of
 * the two is a plus-shaped patch of lane with the gravel left in the four
 * corners, which is what a junction looks like from above.
 *
 * The rule is `decor-place.ts`'s `ditchYawTurns`, case for case, because it
 * is the same question about the same neighbourhood:
 *
 *  * STRAIGHT (road neighbours on one axis only) -- that axis.
 *  * JUNCTION (neighbours on BOTH axes: a corner, a T, a crossroads) -- the
 *    blend. A corner takes it too, and pays for it with two arms of lane
 *    that run to the tile edge and stop. That is the honest trade: the
 *    alternative is picking one of the corner's two axes, which leaves the
 *    OTHER arm's neighbour running its lane into a tile that has no lane
 *    where it joins -- a break in the road rather than a widening of it.
 *  * ISOLATED (no road neighbour at all) -- the blend as well, and unlike
 *    the ditch's arbitrary-but-fixed choice this one is not arbitrary: a
 *    lone `r` tile is a patch of hardstanding with no run to agree with, so
 *    the directionless answer is the correct one.
 *
 * Deterministic, and never `tileHash`: an authored road must not change
 * orientation because a tile was added somewhere else on the map.
 */
export const ROAD_AXIS_NORTH_SOUTH = 0;
export const ROAD_AXIS_EAST_WEST = 1;
export const ROAD_AXIS_JUNCTION = 0.5;

export function roadAxisAt(input: TerrainInput, x: number, y: number): number {
  const { width, height } = input;
  const isRoad = (rx: number, ry: number): boolean =>
    rx >= 0 &&
    rx < width &&
    ry >= 0 &&
    ry < height &&
    (input.decor ? input.decor[ry * width + rx] : 0) === DECOR_ROAD;
  const eastWest = isRoad(x - 1, y) || isRoad(x + 1, y);
  const northSouth = isRoad(x, y - 1) || isRoad(x, y + 1);
  if (eastWest && northSouth) return ROAD_AXIS_JUNCTION;
  if (eastWest) return ROAD_AXIS_EAST_WEST;
  if (northSouth) return ROAD_AXIS_NORTH_SOUTH;
  return ROAD_AXIS_JUNCTION;
}

/**
 * The albedo of tile `(x, y)`'s own TOP surface -- the one decision, in one
 * place, for both the flat/terrace quad and the interpolated patch.
 *
 * Ordered as a chain of exclusions, and the order is the meaning:
 *
 *  1. **Blocked.** A `^` ridge is bedrock and takes rock. Every other
 *     blocked tile is a building footprint and takes NOTHING -- a structure
 *     pad is not ground, and `groundTone`'s own `underBuilding` wash is what
 *     belongs there.
 *  2. **A road** (`r`) takes the wheel track, at the axis its neighbours
 *     imply.
 *  3. **A grove** (`o`) takes the orchard floor. It reaches this line before
 *     the cover test deliberately: `o` IS cover 1 (`@lions/data`'s `LEGEND`),
 *     so without the ordering every olive grove in the game would draw as
 *     scrub.
 *  4. **A plain cover tile** (`1`/`2`/`3` -- cover with no decor kind) takes
 *     scrub at its tier's strength. Keyed on the SYMBOL, not on the cover
 *     number, which is what keeps an `n` rocky knoll (cover 2, decor
 *     `knoll`) exactly as it was: neither the brief nor the art named it,
 *     and quietly restyling a symbol is how a map stops looking like the one
 *     its author drew.
 *  5. **Everything else** is open ground and takes sand. A `b` boulder field
 *     and a `d` anti-tank ditch land here, as they did before: both are open
 *     ground the sim charges nothing for on foot, and both already carry
 *     their own drawn object on top.
 */
function albedoFor(input: TerrainInput, x: number, y: number): Albedo {
  const ti = y * input.width + x;
  const decorHere = input.decor ? input.decor[ti] : 0;
  if (input.blocked[ti] !== 0) return decorHere === DECOR_RIDGE ? RIDGE_ALBEDO : NO_ALBEDO;
  if (decorHere === DECOR_ROAD) return { ...NO_ALBEDO, road: 1, roadAxis: roadAxisAt(input, x, y) };
  if (decorHere === DECOR_GROVE) return GROVE_ALBEDO;
  // DECOR none is 0 -- `shared.ts` names every kind but that one, since
  // "no decor" is the absence of an entry rather than a kind of its own.
  const tier = decorHere === 0 ? input.cover[ti] : 0;
  if (tier > 0) return { ...NO_ALBEDO, scrub: SCRUB_TIER_STRENGTH[Math.min(tier, 3) - 1] };
  return SAND_ALBEDO;
}

/**
 * The five ground-albedo slots `mesh.ts`'s `GROUND_SLOTS` names, spelled out
 * again here rather than imported: `mesh.ts` is the one file in this
 * directory that touches `THREE.*` (`toGeometry`'s `BufferAttribute`,
 * `whitePixel`'s `DataTexture`), and this barrel's own doc comment
 * (`terrain/index.ts`) is explicit that nothing in it may drag three.js in.
 * `mesh.test.ts` pins that the two lists agree.
 */
export type GroundAlbedoSlot = 'sand' | 'rock' | 'road' | 'scrub' | 'grove';

/**
 * Which of the five ground-albedo slots a map's own tiles can ever land on --
 * derived by walking every tile through `albedoFor`, the SAME per-tile
 * decision `buildGround` itself makes, rather than a second, hand-kept rule
 * about which map symbols imply which texture (a hand-kept list is exactly
 * the `SPRITE_MAP` failure mode CLAUDE.md already names elsewhere, and it
 * would go stale the same silent way).
 *
 * The one caller today is `packages/app`'s ground-texture loader
 * (`ground-textures.ts`): a map with no `^` ridge has no use for
 * `rock_ground_tile.png`, one with no `o` grove has no use for
 * `orchard_floor_tile.png`, and so on -- fetching an image no vertex will
 * ever sample costs bytes and a request for nothing. `sand` covers BOTH
 * open-ground images (`desert_sand_tile`/`green_basin_tile`); which one a
 * caller resolves it to is a `map.terrain` decision this function has no
 * opinion on, the same split `TERRAIN_GROUND_TEXTURE` already keeps.
 *
 * Short-circuits once all five slots have been seen: a slot already present
 * cannot become "more present" by scanning further tiles, so a large map
 * that uses everything pays for a partial scan, not a full one.
 */
export function groundAlbedoSlotsUsed(input: TerrainInput): ReadonlySet<GroundAlbedoSlot> {
  const used = new Set<GroundAlbedoSlot>();
  const { width, height } = input;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = albedoFor(input, x, y);
      if (a.sand > 0) used.add('sand');
      if (a.rock > 0) used.add('rock');
      if (a.road > 0) used.add('road');
      if (a.scrub > 0) used.add('scrub');
      if (a.grove > 0) used.add('grove');
      if (used.size === 5) return used;
    }
  }
  return used;
}

/** The six per-vertex albedo channels, as the plain arrays `buildGround`
 *  accumulates before they become `Float32Array`s. One struct rather than
 *  six positional parameters: `pushSmoothTile` and `pushWall` already took
 *  fifteen arguments apiece. */
interface AlbedoArrays {
  sand: number[];
  rock: number[];
  road: number[];
  roadAxis: number[];
  scrub: number[];
  grove: number[];
}

/** Appends `a` to every channel of `into`, `times` times -- one call per
 *  vertex batch, keeping all six arrays in lockstep with `colors` by
 *  construction rather than by six remembered `push` calls. */
function pushAlbedo(into: AlbedoArrays, a: Albedo, times: number): void {
  for (let i = 0; i < times; i++) {
    into.sand.push(a.sand);
    into.rock.push(a.rock);
    into.road.push(a.road);
    into.roadAxis.push(a.roadAxis);
    into.scrub.push(a.scrub);
    into.grove.push(a.grove);
  }
}

/**
 * Builds the ground mesh's `positions`/`colors`/`normals`/`indices`, its two
 * albedo masks, plus `litColors` (same length and vertex order as `colors`)
 * -- each vertex's tone recomputed through the IDENTICAL
 * `groundTone`/`composite`/`quantise` pipeline, fed a "lit" `tones`/
 * `background` (every source tone this module reads -- `open`, `road`,
 * `rock`, `underBuilding`, plus `background` itself -- shifted
 * `GROUND_LIT_STEPS` toward its own ramp's lightest entry via `rampNeighbor`,
 * computed ONCE here, not per vertex). Reusing `groundTone` unchanged for the
 * lit pass (rather than a second, hand-written variant) is what keeps the two
 * outputs from silently drifting apart -- whatever `groundTone`'s own
 * branching does for the normal tones, it does identically for the lit ones,
 * by construction. `litColors` is still always a `quantise`d, on-palette
 * entry: `rampNeighbor` only ever returns another member of a named ramp (or
 * its input unchanged), and `quantise` runs on the composite the same way it
 * always did.
 */
export function buildGround(input: TerrainInput, tones: TerrainTones, background: string): MeshData {
  const { width, height } = input;
  const surface = buildTerrainSurface(input);
  const positions: number[] = [];
  const colors: number[] = [];
  const litColors: number[] = [];
  const normals: number[] = [];
  const albedo: AlbedoArrays = { sand: [], rock: [], road: [], roadAxis: [], scrub: [], grove: [] };
  const groundUv: number[] = [];
  const indices: number[] = [];

  const litTones: TerrainTones = {
    ...tones,
    open: rampNeighbor(tones.open, GROUND_LIT_STEPS),
    road: rampNeighbor(tones.road, GROUND_LIT_STEPS),
    rock: rampNeighbor(tones.rock, GROUND_LIT_STEPS),
    underBuilding: rampNeighbor(tones.underBuilding, GROUND_LIT_STEPS),
  };
  const litBackground = rampNeighbor(background, GROUND_LIT_STEPS);

  const faceEastHex = quantise(composite(background, tones.rock, FACE_ALPHA_EAST), PALETTE_HEXES);
  const faceSouthHex = quantise(composite(background, tones.rock, FACE_ALPHA_SOUTH), PALETTE_HEXES);
  const faceEastColor = hexToUnit(faceEastHex);
  const faceSouthColor = hexToUnit(faceSouthHex);
  const litFaceEastHex = quantise(composite(litBackground, litTones.rock, FACE_ALPHA_EAST), PALETTE_HEXES);
  const litFaceSouthHex = quantise(composite(litBackground, litTones.rock, FACE_ALPHA_SOUTH), PALETTE_HEXES);
  const litFaceEastColor = hexToUnit(litFaceEastHex);
  const litFaceSouthColor = hexToUnit(litFaceSouthHex);

  /** Is the tile at `(x, y)` a `^` rock ridge? A wall between a ridge and
   *  anything lower IS the cliff face, so it takes the rock albedo. A
   *  BUILDING's wall deliberately does not: a structure footprint is not
   *  bedrock, and `groundTone`'s own `underBuilding` wash is what belongs
   *  under it. Off-map is false. */
  const ridgeAt = (rx: number, ry: number): boolean =>
    rx >= 0 &&
    rx < width &&
    ry >= 0 &&
    ry < height &&
    (input.decor ? input.decor[ry * width + rx] : 0) === DECOR_RIDGE;

  // `p0, p1, p2, p3` trace the quad's perimeter, not its diagonal. The two
  // fans through that perimeter -- (0,1,2)/(0,2,3) and its reverse
  // (0,2,1)/(0,3,2) -- point in opposite directions; which one is "up"
  // depends on which two edges of the perimeter are being crossed, so the
  // caller picks per quad (checked by hand against the camera's
  // +X/+Y/+Z-facing convention, not guessed). `pushPolygon` (`shared.ts`) is
  // the shared fan this delegates to -- see its own doc comment for why a
  // 4-point call reproduces this exact index sequence.
  const pushQuad = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    color: [number, number, number],
    litColor: [number, number, number],
    flip: boolean,
    tileAlbedo: Albedo
  ): void => {
    pushPolygon(positions, colors, indices, [p0, p1, p2, p3], color, flip);
    // A horizontal quad: the albedo projects straight down, so its sampling
    // coordinates are its own world (x, z).
    for (const p of [p0, p1, p2, p3]) groundUv.push(p[0], p[2]);
    // `pushPolygon` already pushed 4 fresh vertices into `positions`/`colors`
    // and their triangles into `indices` -- `litColors`, `normals` and the
    // albedo channels need no positions or indices of their own, only 4 more
    // entries in the same vertex order, so appending them directly (rather
    // than calling `pushPolygon` a second time, which would duplicate
    // `positions`/`indices`) keeps every array's vertex count in lockstep
    // with `colors`.
    for (let i = 0; i < 4; i++) {
      litColors.push(litColor[0], litColor[1], litColor[2]);
      normals.push(UP_NORMAL[0], UP_NORMAL[1], UP_NORMAL[2]);
    }
    pushAlbedo(albedo, tileAlbedo, 4);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ti = y * width + x;
      const levelHere = levelAt(input, x, y);
      const topY = levelHere * WORLD_PER_LEVEL;
      // One decision per tile, made once and used by whichever of the two
      // top-surface paths this tile takes -- see `albedoFor`.
      const tileAlbedo = albedoFor(input, x, y);

      const toneHex = groundTone(input, tones, ti, PALETTE_HEXES, background);
      const toneColor = hexToUnit(toneHex);
      const litToneHex = groundTone(input, litTones, ti, PALETTE_HEXES, litBackground);
      const litToneColor = hexToUnit(litToneHex);

      if (surface.flat || isTerrace(surface, x, y)) {
        // Tile top: a flat quad at its own height, four fresh vertices, no
        // sharing with any neighbour, up normal. `flip: false` gives it an
        // up-facing (+Y) geometric normal -- see the winding note above.
        // This is the pre-2026-09-03 path verbatim, and it is what a map
        // with no relief draws for every one of its tiles.
        //
        // Which albedo it draws is `albedoFor`'s single decision, and it
        // needs no `surface.flat` guard of its own -- worth stating, because
        // an obvious one looks like it is doing work here and is not.
        // `isTerrace` IS `blocked !== 0` (`surface.ts`), so a relief map's
        // terrace already takes `albedoFor`'s first branch (rock for a `^`
        // ridge, nothing for a building pad) and a flat map's ordinary
        // ground falls through it to the same open-ground answer a hill's
        // does. "Flat sand is still sand" is the project lead's own call,
        // made once he saw that `beit_sahwan_outskirts`, the DEFAULT sandbox
        // map, would otherwise greet a player with untextured palette ground
        // while `qarn_hadid` and `tel_marum` were sand.
        //
        // No shipped flat map has a single `^` tile (counted: 0 on all
        // four), so the rock branch is only ever reached on relief today --
        // but the rule is written as the rule rather than guarded on
        // `surface.flat`, so a flat map that ever authors a ridge gets the
        // same bedrock every other ridge gets instead of a silent
        // palette-grey exception.
        pushQuad(
          [x, topY, y],
          [x + 1, topY, y],
          [x + 1, topY, y + 1],
          [x, topY, y + 1],
          toneColor,
          litToneColor,
          false,
          tileAlbedo
        );
      } else {
        pushSmoothTile(
          positions,
          colors,
          litColors,
          normals,
          albedo,
          groundUv,
          indices,
          surface,
          x,
          y,
          toneColor,
          litToneColor,
          tileAlbedo
        );
      }

      if (surface.flat) {
        // No relief: `levelAt` is 0 everywhere on and off the map, so no drop
        // exists in any direction and no face was ever emitted. Kept as an
        // explicit early-out rather than falling through the wall code below,
        // so the claim "a flat map's mesh is unchanged" needs no argument
        // about what `hasWall` returns.
        continue;
      }

      // East face (this tile vs. the neighbour at x + 1), then south (vs.
      // y + 1). `hasWall` (`surface.ts`) is the single predicate deciding
      // whether either exists; `scatter.ts`'s slope dressing reads the same
      // one, so a strata band can never float over a hillside with no wall
      // beneath it.
      if (hasWall(surface, x, y, 0)) {
        pushWall(
          positions,
          colors,
          litColors,
          normals,
          albedo,
          groundUv,
          indices,
          surface,
          x,
          y,
          0,
          faceEastColor,
          litFaceEastColor,
          ridgeAt(x, y) || ridgeAt(x + 1, y) ? 1 : 0
        );
      }
      if (hasWall(surface, x, y, 1)) {
        pushWall(
          positions,
          colors,
          litColors,
          normals,
          albedo,
          groundUv,
          indices,
          surface,
          x,
          y,
          1,
          faceSouthColor,
          litFaceSouthColor,
          ridgeAt(x, y) || ridgeAt(x, y + 1) ? 1 : 0
        );
      }
    }
  }

  return {
    positions: Float32Array.from(positions),
    colors: Float32Array.from(colors),
    litColors: Float32Array.from(litColors),
    normals: Float32Array.from(normals),
    sandMask: Float32Array.from(albedo.sand),
    rockMask: Float32Array.from(albedo.rock),
    roadMask: Float32Array.from(albedo.road),
    roadAxis: Float32Array.from(albedo.roadAxis),
    scrubMask: Float32Array.from(albedo.scrub),
    groveMask: Float32Array.from(albedo.grove),
    groundUv: Float32Array.from(groundUv),
    indices: Uint32Array.from(indices),
  };
}

/**
 * One open tile as a `SURFACE_SUBDIVISIONS`-square patch of the interpolated
 * surface.
 *
 * Vertices are shared WITHIN the tile (25 of them at the shipped
 * subdivision, not 4 per sub-quad) and never ACROSS tiles -- the same split
 * the palette rule has always drawn, for the same reason: one tile, one
 * colour. Two neighbouring tiles evaluate `smoothLevel`/`smoothNormal` at
 * the identical boundary points, so their duplicated edge vertices coincide
 * to the bit in both position and normal: no crack, no shading seam, and the
 * colour still steps cleanly at the tile line where a road meets open
 * ground.
 *
 * The normal is analytic (Catmull-Rom's own derivative), not face-averaged,
 * which is what makes that possible at all -- averaging faces needs shared
 * vertices.
 */
function pushSmoothTile(
  positions: number[],
  colors: number[],
  litColors: number[],
  normals: number[],
  albedo: AlbedoArrays,
  groundUv: number[],
  indices: number[],
  surface: TerrainSurface,
  x: number,
  y: number,
  color: readonly [number, number, number],
  litColor: readonly [number, number, number],
  tileAlbedo: Albedo
): void {
  const n = SURFACE_SUBDIVISIONS;
  const base = positions.length / 3;
  for (let j = 0; j <= n; j++) {
    const pz = y + j / n;
    for (let i = 0; i <= n; i++) {
      const px = x + i / n;
      positions.push(px, smoothLevel(surface, px, pz) * WORLD_PER_LEVEL, pz);
      colors.push(color[0], color[1], color[2]);
      litColors.push(litColor[0], litColor[1], litColor[2]);
      const nrm = smoothNormal(surface, px, pz);
      normals.push(nrm[0], nrm[1], nrm[2]);
      // The tile's own albedo, verbatim -- never ROCK in practice, since
      // rock is the `^` ridge and a ridge is a terrace that never reaches
      // this function, but `albedoFor` is the one decision and this path
      // does not get to hold a second opinion about it.
      pushAlbedo(albedo, tileAlbedo, 1);
      // A (near-)horizontal surface: project straight down.
      groundUv.push(px, pz);
    }
  }
  // Same rotational order and the same winding the flat tile top above uses:
  // corners (i,j) -> (i+1,j) -> (i+1,j+1) -> (i,j+1) fanned as (0,2,1) and
  // (0,3,2), which is `pushPolygon`'s `flip: false`.
  const idx = (i: number, j: number): number => base + j * (n + 1) + i;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = idx(i, j);
      const b = idx(i + 1, j);
      const c = idx(i + 1, j + 1);
      const d = idx(i, j + 1);
      indices.push(a, c, b, a, d, c);
    }
  }
}

/**
 * The vertical face along tile `(x, y)`'s east (`axis` 0) or south (`axis`
 * 1) edge.
 *
 * Sized to the DROP rather than to this tile's absolute height, exactly as
 * before -- two tiles at the same height show no wall along their shared
 * edge, which is why a continuous slope has no crack across it.
 *
 * What is new is that either side of the edge may be a POLYLINE rather than
 * a constant: a hillside's edge follows the interpolated surface. So the
 * face is a strip of `SURFACE_SUBDIVISIONS` quads following both profiles,
 * unless both sides are constant (terrace against terrace, or a terrace
 * against the map edge), in which case one quad reproduces the pre-existing
 * single face exactly. The bottom of each segment is clamped to its own
 * top, so a Catmull-Rom overshoot that crosses the terrace it is being
 * walled against degenerates to a zero-height segment rather than inverting
 * the quad and flipping its winding.
 *
 * Wall vertices carry the UP normal deliberately, not the face's own
 * outward one: the shade term is exactly 1.0 there, so the shading half of
 * the palette exemption stays scoped to sloped open ground and a wall keeps
 * the authored `FACE_ALPHA_EAST`/`SOUTH` composite it has always had. A
 * RIDGE wall gets a real rock texture instead (`rock`), which is a better
 * answer than a synthetic normal on a face that is vertical by construction.
 */
function pushWall(
  positions: number[],
  colors: number[],
  litColors: number[],
  normals: number[],
  albedo: AlbedoArrays,
  groundUv: number[],
  indices: number[],
  surface: TerrainSurface,
  x: number,
  y: number,
  axis: 0 | 1,
  color: readonly [number, number, number],
  litColor: readonly [number, number, number],
  rock: number
): void {
  const nx = axis === 0 ? x + 1 : x;
  const ny = axis === 0 ? y : y + 1;
  const offMap = nx < 0 || nx >= surface.width || ny < 0 || ny >= surface.height;
  const hereTerrace = isTerrace(surface, x, y);
  const thereTerrace = !offMap && isTerrace(surface, nx, ny);
  const hereLevel = surface.levels ? surface.levels[y * surface.width + x] : 0;
  const thereLevel = surface.levels && !offMap ? surface.levels[ny * surface.width + nx] : 0;

  const constantTop = hereTerrace;
  const constantBottom = offMap || thereTerrace;
  const segments = constantTop && constantBottom ? 1 : SURFACE_SUBDIVISIONS;

  const pointAt = (f: number): { px: number; pz: number } =>
    axis === 0 ? { px: x + 1, pz: y + f } : { px: x + f, pz: y + 1 };

  const topAt = (f: number): number => {
    if (constantTop) return hereLevel * WORLD_PER_LEVEL;
    const { px, pz } = pointAt(f);
    return smoothLevel(surface, px, pz) * WORLD_PER_LEVEL;
  };
  const bottomAt = (f: number): number => {
    if (offMap) return 0;
    if (thereTerrace) return thereLevel * WORLD_PER_LEVEL;
    const { px, pz } = pointAt(f);
    return smoothLevel(surface, px, pz) * WORLD_PER_LEVEL;
  };

  for (let k = 0; k < segments; k++) {
    const f0 = k / segments;
    const f1 = (k + 1) / segments;
    const t0 = topAt(f0);
    const t1 = topAt(f1);
    const b0 = Math.min(bottomAt(f0), t0);
    const b1 = Math.min(bottomAt(f1), t1);
    if (t0 - b0 <= 0 && t1 - b1 <= 0) continue;
    const a0 = pointAt(f0);
    const a1 = pointAt(f1);
    const base = positions.length / 3;
    positions.push(a0.px, t0, a0.pz, a1.px, t1, a1.pz, a1.px, b1, a1.pz, a0.px, b0, a0.pz);
    // A VERTICAL face: project onto its own plane, not straight down. An east
    // face has a constant world X, so `(x, z)` would give every fragment on
    // it the same U and smear one column of the texture down the whole cliff.
    // `(z, y)` for east and `(x, y)` for south run the image across the face
    // and up it, at the same world scale the horizontal projection uses -- so
    // a ridge top and the wall beneath it show the same grain size.
    if (axis === 0) {
      groundUv.push(a0.pz, t0, a1.pz, t1, a1.pz, b1, a0.pz, b0);
    } else {
      groundUv.push(a0.px, t0, a1.px, t1, a1.px, b1, a0.px, b0);
    }
    // Each of the quad's two triangles is skipped when its own end is
    // PINCHED (top meets bottom there) rather than the quad being skipped
    // only when both ends are. A wall strip that runs out where a hillside
    // rises to meet the terrace it is being walled against has exactly one
    // pinched end, and the resulting zero-area triangle has a zero normal --
    // which is not merely wasteful, it fails this module's own "every
    // terrace top and every wall winds toward the camera" test, whose
    // `d > 0` cannot be satisfied by a degenerate. The two areas are
    // proportional to `t1 - b1` and `t0 - b0` respectively (worked out from
    // the cross products, not guessed), so those are the exact conditions.
    if (axis === 0) {
      // East: matches the pre-existing face quad's `flip: true` winding,
      // giving a +X-facing geometric normal.
      if (t1 - b1 > 0) indices.push(base, base + 1, base + 2);
      if (t0 - b0 > 0) indices.push(base, base + 2, base + 3);
    } else {
      // South: `flip: false`, a +Z-facing geometric normal.
      if (t1 - b1 > 0) indices.push(base, base + 2, base + 1);
      if (t0 - b0 > 0) indices.push(base, base + 3, base + 2);
    }
    for (let i = 0; i < 4; i++) {
      colors.push(color[0], color[1], color[2]);
      litColors.push(litColor[0], litColor[1], litColor[2]);
      normals.push(UP_NORMAL[0], UP_NORMAL[1], UP_NORMAL[2]);
    }
    // A wall is bedrock or it is nothing. Not sand, not a road, not scrub,
    // not an orchard floor: the four surfaces added on 2026-09-03 are all
    // things that lie ON ground, and a wall is the cut through it. A
    // building's wall is the `NO_ALBEDO` case and keeps its authored
    // `FACE_ALPHA_EAST`/`SOUTH` composite.
    pushAlbedo(albedo, rock !== 0 ? RIDGE_ALBEDO : NO_ALBEDO, 4);
  }
}
