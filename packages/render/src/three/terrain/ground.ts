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
 *  - **Every vertex colour this builder emits is still a palette entry.**
 *    `tones.ts` was not touched (beyond `rampNeighbor`'s deletion on
 *    2026-09-15, which served only the retired `litColors` array). Colour
 *    is still decided ONCE PER TILE and written identically to every vertex
 *    of that tile, which is also why vertices are still not shared BETWEEN
 *    tiles: a shared vertex would interpolate a road tone into the open
 *    ground beside it. Within a tile they are shared freely -- one colour,
 *    nothing to smear.
 *  - **The exemption is the fragment stage.** `GroundMaterial` multiplies by
 *    a lit shade and by an albedo blend read from the control map at the
 *    fragment's own position (`control-map.ts`) -- sand on the interpolated
 *    open ground, rock on a `^` ridge, and so on. This builder no longer
 *    carries a per-vertex opinion about WHICH surface a fragment samples; the
 *    one per-vertex fact it still emits is `wallAlbedo`, which tells a WALL
 *    vertex (sitting exactly on the control map's own texel boundary, where
 *    the map cannot answer) apart from a top, which can. Every vertex still
 *    carries a colour that is a palette entry, and every wall still carries
 *    the UP normal, where the shade term is exactly 1.0 -- so its pixels are
 *    the same palette bytes they always were.
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
import { composite, quantise, groundTone, PALETTE_HEXES } from './tones';
import { DECOR_RIDGE, DECOR_ROAD, hexToUnit, levelAt, pushPolygon, WORLD_PER_LEVEL } from './shared';
import {
  buildTerrainSurface,
  hasWall,
  isTerrace,
  smoothLevel,
  smoothNormal,
  SURFACE_SUBDIVISIONS,
  type TerrainSurface,
} from './surface';
import { SCRUB_TIER_STRENGTH, tileSurface } from './control-map';
import type { MeshData, TerrainInput } from './types';
import type { TerrainTones } from '../../api';

export type { MeshData, TerrainInput };

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

/** How strongly each cover tier samples the scrub albedo. Owned by
 *  `control-map.ts` now (`tileSurface`'s only reader) -- re-exported here so
 *  this module's own existing callers and `ground.test.ts` are unaffected.
 *  See that module's own doc comment for the full account of why a contrast
 *  ladder rather than a tone ladder, and why it moved. */
export { SCRUB_TIER_STRENGTH };

/**
 * The one per-vertex surface fact the fragment shader still reads now the
 * control map carries the surfaces (R-5): whether a vertex belongs to a TOP
 * -- which samples the control map -- or to a WALL, and which kind.
 *
 * A wall cannot ask the control map. A vertical face sits exactly on the
 * texel boundary between the two tiles it separates, so the map would answer
 * with whichever side the rasteriser's rounding lands on -- and a ridge wall
 * and a building wall read the same there anyway. So the builder, which knows,
 * says: `WALL_ALBEDO_ROCK` is a ridge's cliff face and draws the rock image at
 * full weight; `WALL_ALBEDO_NONE` is a building's wall and keeps its authored
 * `FACE_ALPHA_*` composite untextured. `GroundMaterial` reads the value
 * directly as the wall's rock weight, which is why ROCK is 1 and NONE is 0
 * rather than any other pair of codes.
 */
export const WALL_ALBEDO_TOP = -1;
export const WALL_ALBEDO_NONE = 0;
export const WALL_ALBEDO_ROCK = 1;

/**
 * The five ground-albedo slots `mesh.ts`'s `GROUND_SLOTS` names, spelled out
 * again here rather than imported: `mesh.ts` is the one file in this
 * directory that touches `THREE.*` (`toGeometry`'s `BufferAttribute`,
 * `whitePixel`'s `DataTexture`), and this barrel's own doc comment
 * (`terrain/index.ts`) is explicit that nothing in it may drag three.js in.
 * `mesh.test.ts` pins that the two lists agree.
 *
 * `road` is not one of them -- since Task 6 (#226) the road is drawn from
 * control B's distance field, not from a slot of its own -- but a road tile
 * still needs the knoll image fetched, for its grain (R-7); see
 * `groundAlbedoSlotsUsed` below for where that rule now lives.
 */
export type GroundAlbedoSlot = 'sand' | 'rock' | 'scrub' | 'grove' | 'knoll';

/**
 * Which of the five ground-albedo slots a map's own tiles can ever land on --
 * derived by walking every tile through `tileSurface` (`control-map.ts`),
 * the SAME per-tile decision the control map itself is built from, rather
 * than a second, hand-kept rule about which map symbols imply which texture
 * (a hand-kept list is exactly the `SPRITE_MAP` failure mode CLAUDE.md
 * already names elsewhere, and it would go stale the same silent way).
 *
 * The one caller today is `packages/app`'s ground-texture loader
 * (`ThreeRenderer.loadGroundTexture`): a map with no `^` ridge has no use for
 * `rock_ground_tile.jpg`, one with no `o` grove has no use for
 * `orchard_floor_tile.jpg`, and so on -- fetching an image no fragment will
 * ever sample costs bytes and a request for nothing. `sand` covers BOTH
 * open-ground images (`desert_sand_tile`/`green_basin_tile`); which one a
 * caller resolves it to is a `map.terrain` decision this function has no
 * opinion on, the same split `TERRAIN_GROUND_TEXTURE` already keeps.
 *
 * A `road` tile reports BOTH `sand` (the open wash its vertex colour now
 * carries, since it draws through the ordinary top-surface path) AND
 * `knoll` -- not because a road samples the knoll ALBEDO slot, but because
 * the road's own grain, drawn from the distance field, borrows the knoll
 * IMAGE wholesale (R-7: one shared image, no road asset). Skipping the
 * fetch on a road map would leave that grain permanently white.
 *
 * A `pad` (a building footprint with no ridge decor) contributes nothing:
 * it is not ground, and `groundTone`'s own `underBuilding` wash is what
 * belongs there.
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
      const { kind } = tileSurface(input, x, y);
      switch (kind) {
        case 'open':
          used.add('sand');
          break;
        case 'road':
          used.add('sand');
          used.add('knoll');
          break;
        case 'pad':
          break;
        default:
          used.add(kind);
      }
      if (used.size === 5) return used;
    }
  }
  return used;
}

/**
 * The palette tone a tile's TOP vertices carry -- what `diffuseColor` holds
 * before `GroundMaterial` mixes the road in and multiplies the albedo and
 * macro ratio fields over it. One function for `buildGround` and for the
 * decal pool's local ground tone (`decal-ground-tone.ts`), so the two cannot
 * disagree about what the ground under a decal is.
 *
 * A road tile does not take `groundTone`'s own DECOR_ROAD branch
 * (`tones.road` composited over the open wash): the road's tone is the
 * shader's job, drawn from control B's distance field over whatever is
 * beneath it (Task 6, #226), and what belongs beneath it is the open
 * ground's own wash -- `groundTone`'s open branch, transcribed rather than
 * reached through `groundTone` itself so this one exception does not have to
 * route through (and risk disturbing) every other branch that function
 * still owns.
 */
export function tileBaseToneHex(input: TerrainInput, tones: TerrainTones, ti: number, background: string): string {
  const decorHere = input.decor ? input.decor[ti] : 0;
  return decorHere === DECOR_ROAD
    ? quantise(composite(background, tones.open, 1), PALETTE_HEXES)
    : groundTone(input, tones, ti, PALETTE_HEXES, background);
}

/**
 * Builds the ground mesh's `positions`/`colors`/`normals`/`indices` and its
 * one remaining per-vertex surface fact, `wallAlbedo`.
 *
 * It used to build a parallel `litColors` array as well -- every vertex's
 * tone recomputed through this same pipeline against a ramp-shifted "lit"
 * tone set, for the toon era's ramp-shift muzzle flash. That flash has been
 * a pooled `THREE.PointLight` since 2026-09-14 (`../flash-light.ts`),
 * `toGeometry` stopped uploading the attribute in the same change, and the
 * array was deleted on 2026-09-15 along with `tones.ts`'s `rampNeighbor`,
 * which nothing else called. Every vertex colour emitted here is still a
 * `quantise`d palette entry, and `surface.ts`'s `SURFACE_SHADING_EXEMPTION`
 * still says so.
 *
 * It used to build seven per-vertex albedo channels as well -- one for
 * WHICH surface a fragment was allowed to texture, mutually exclusive by
 * construction. Task 5 of the ground plan moved that decision to the
 * control map (`control-map.ts`'s `tileSurface`/`surfaceWeightsAt`), sampled
 * per FRAGMENT rather than decided per vertex, and Task 6 moved the road off
 * a slot entirely and onto control B's own distance field. Both channels
 * (all seven, `roadMask`/`roadAxis` included) had stopped reaching the
 * shader by the time this function still emitted them; this is where they
 * stop being emitted too.
 */
export function buildGround(input: TerrainInput, tones: TerrainTones, background: string): MeshData {
  const { width, height } = input;
  const surface = buildTerrainSurface(input);
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const wallAlbedo: number[] = [];
  const groundUv: number[] = [];
  const indices: number[] = [];

  const faceEastHex = quantise(composite(background, tones.rock, FACE_ALPHA_EAST), PALETTE_HEXES);
  const faceSouthHex = quantise(composite(background, tones.rock, FACE_ALPHA_SOUTH), PALETTE_HEXES);
  const faceEastColor = hexToUnit(faceEastHex);
  const faceSouthColor = hexToUnit(faceSouthHex);

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
    flip: boolean
  ): void => {
    pushPolygon(positions, colors, indices, [p0, p1, p2, p3], color, flip);
    // A horizontal quad: the albedo projects straight down, so its sampling
    // coordinates are its own world (x, z).
    for (const p of [p0, p1, p2, p3]) groundUv.push(p[0], p[2]);
    // `pushPolygon` already pushed 4 fresh vertices into `positions`/`colors`
    // and their triangles into `indices` -- `normals` and `wallAlbedo` need
    // no positions or indices of their own, only 4 more entries in the same
    // vertex order, so appending them directly (rather than calling
    // `pushPolygon` a second time, which would duplicate
    // `positions`/`indices`) keeps every array's vertex count in lockstep
    // with `colors`.
    for (let i = 0; i < 4; i++) {
      normals.push(UP_NORMAL[0], UP_NORMAL[1], UP_NORMAL[2]);
      wallAlbedo.push(WALL_ALBEDO_TOP);
    }
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ti = y * width + x;
      const levelHere = levelAt(input, x, y);
      const topY = levelHere * WORLD_PER_LEVEL;

      // See `tileBaseToneHex` for the road tile's exception.
      const toneColor = hexToUnit(tileBaseToneHex(input, tones, ti, background));

      if (surface.flat || isTerrace(surface, x, y)) {
        // Tile top: a flat quad at its own height, four fresh vertices, no
        // sharing with any neighbour, up normal. `flip: false` gives it an
        // up-facing (+Y) geometric normal -- see the winding note above.
        // This is the pre-2026-09-03 path verbatim, and it is what a map
        // with no relief draws for every one of its tiles.
        //
        // No shipped flat map has a single `^` tile (counted: 0 on all
        // four), and a flat map's ordinary ground takes the same open-ground
        // tone a hill's does. "Flat sand is still sand" is the project
        // lead's own call, made once he saw that `beit_sahwan_outskirts`,
        // the DEFAULT sandbox map, would otherwise greet a player with
        // untextured palette ground while `qarn_hadid` and `tel_marum` were
        // sand.
        pushQuad([x, topY, y], [x + 1, topY, y], [x + 1, topY, y + 1], [x, topY, y + 1], toneColor, false);
      } else {
        pushSmoothTile(positions, colors, normals, wallAlbedo, groundUv, indices, surface, x, y, toneColor);
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
          normals,
          wallAlbedo,
          groundUv,
          indices,
          surface,
          x,
          y,
          0,
          faceEastColor,
          ridgeAt(x, y) || ridgeAt(x + 1, y) ? 1 : 0
        );
      }
      if (hasWall(surface, x, y, 1)) {
        pushWall(
          positions,
          colors,
          normals,
          wallAlbedo,
          groundUv,
          indices,
          surface,
          x,
          y,
          1,
          faceSouthColor,
          ridgeAt(x, y) || ridgeAt(x, y + 1) ? 1 : 0
        );
      }
    }
  }

  return {
    positions: Float32Array.from(positions),
    colors: Float32Array.from(colors),
    normals: Float32Array.from(normals),
    wallAlbedo: Float32Array.from(wallAlbedo),
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
  normals: number[],
  wallAlbedo: number[],
  groundUv: number[],
  indices: number[],
  surface: TerrainSurface,
  x: number,
  y: number,
  color: readonly [number, number, number]
): void {
  const n = SURFACE_SUBDIVISIONS;
  const base = positions.length / 3;
  for (let j = 0; j <= n; j++) {
    const pz = y + j / n;
    for (let i = 0; i <= n; i++) {
      const px = x + i / n;
      positions.push(px, smoothLevel(surface, px, pz) * WORLD_PER_LEVEL, pz);
      colors.push(color[0], color[1], color[2]);
      const nrm = smoothNormal(surface, px, pz);
      normals.push(nrm[0], nrm[1], nrm[2]);
      // Every vertex an interpolated patch emits is a TOP: rock is the `^`
      // ridge and a ridge is a terrace that never reaches this function.
      wallAlbedo.push(WALL_ALBEDO_TOP);
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
  normals: number[],
  wallAlbedo: number[],
  groundUv: number[],
  indices: number[],
  surface: TerrainSurface,
  x: number,
  y: number,
  axis: 0 | 1,
  color: readonly [number, number, number],
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
      normals.push(UP_NORMAL[0], UP_NORMAL[1], UP_NORMAL[2]);
    }
    // A wall is bedrock or it is nothing. Not sand, not scrub, not an orchard
    // floor: every OTHER surface lies ON ground, and a wall is the cut
    // through it. A building's wall keeps its authored
    // `FACE_ALPHA_EAST`/`SOUTH` composite untextured.
    const wall = rock !== 0 ? WALL_ALBEDO_ROCK : WALL_ALBEDO_NONE;
    for (let i = 0; i < 4; i++) wallAlbedo.push(wall);
  }
}
