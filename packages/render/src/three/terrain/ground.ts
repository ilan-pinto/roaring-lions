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
  const sandMask: number[] = [];
  const rockMask: number[] = [];
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
    rock: number
  ): void => {
    pushPolygon(positions, colors, indices, [p0, p1, p2, p3], color, flip);
    // A horizontal quad: the albedo projects straight down, so its sampling
    // coordinates are its own world (x, z).
    for (const p of [p0, p1, p2, p3]) groundUv.push(p[0], p[2]);
    // `pushPolygon` already pushed 4 fresh vertices into `positions`/`colors`
    // and their triangles into `indices` -- `litColors`, `normals` and the
    // two masks need no positions or indices of their own, only 4 more
    // entries in the same vertex order, so appending them directly (rather
    // than calling `pushPolygon` a second time, which would duplicate
    // `positions`/`indices`) keeps every array's vertex count in lockstep
    // with `colors`.
    for (let i = 0; i < 4; i++) {
      litColors.push(litColor[0], litColor[1], litColor[2]);
      normals.push(UP_NORMAL[0], UP_NORMAL[1], UP_NORMAL[2]);
      // Never SAND: everything routed through this helper is a flat terrace
      // top, a wall, or a whole tile of a map with no relief.
      sandMask.push(0);
      rockMask.push(rock);
    }
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ti = y * width + x;
      const levelHere = levelAt(input, x, y);
      const topY = levelHere * WORLD_PER_LEVEL;
      const decorHere = input.decor ? input.decor[ti] : 0;

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
        // A `^` ridge TOP takes the rock albedo; a building footprint does
        // not. On a map with no relief nothing does -- `surface.flat`
        // short-circuits ahead of the ridge test, so all four relief-free
        // maps stay byte-identical.
        pushQuad(
          [x, topY, y],
          [x + 1, topY, y],
          [x + 1, topY, y + 1],
          [x, topY, y + 1],
          toneColor,
          litToneColor,
          false,
          !surface.flat && decorHere === DECOR_RIDGE ? 1 : 0
        );
      } else {
        pushSmoothTile(
          positions,
          colors,
          litColors,
          normals,
          sandMask,
          rockMask,
          groundUv,
          indices,
          surface,
          x,
          y,
          toneColor,
          litToneColor,
          // A ROAD keeps its authored tone: it is drawn as an interpolated
          // patch like the ground either side of it, but sand over the top
          // would turn the one piece of legible, authored navigation on the
          // map into more sand. Everything else that reaches here is open
          // ground -- cover tiles included, since `groundTone` does not
          // branch on cover at all (their cover reads as `scatter.ts`'s
          // rubble marks, not as a ground tint), so a cover-3 thicket is
          // sand with debris on it, which is what it is.
          decorHere !== DECOR_ROAD ? 1 : 0
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
          sandMask,
          rockMask,
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
          sandMask,
          rockMask,
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
    sandMask: Float32Array.from(sandMask),
    rockMask: Float32Array.from(rockMask),
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
  sandMask: number[],
  rockMask: number[],
  groundUv: number[],
  indices: number[],
  surface: TerrainSurface,
  x: number,
  y: number,
  color: readonly [number, number, number],
  litColor: readonly [number, number, number],
  sand: number
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
      sandMask.push(sand);
      // Never ROCK: this is the interpolated OPEN surface, and rock is the
      // `^` ridge, which is a terrace and never reaches this function.
      rockMask.push(0);
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
  sandMask: number[],
  rockMask: number[],
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
      sandMask.push(0);
      rockMask.push(rock);
    }
  }
}
