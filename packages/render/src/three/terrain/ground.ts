/**
 * The ground mesh: tile tops at true elevation, and the vertical faces where
 * a tile is higher than its neighbour.
 *
 * A tile top is a flat quad at its own height -- terraces, not ramps. Corners
 * are not interpolated between neighbours, matching Pixi exactly: `groundOffset`
 * samples at the containing tile rather than interpolated across the four
 * corners, deliberately, so a unit crossing a terrace steps up rather than
 * ramping.
 *
 * Vertices are never shared between tiles, nor between a tile top and its own
 * side faces. Adjacent tiles differ in both height and colour, so a shared
 * vertex would interpolate across a terrace edge and produce an off-palette
 * gradient -- silently breaking the guarantee this module's test suite
 * asserts directly.
 */
import { composite, quantise, groundTone, rampNeighbor, PALETTE_HEXES } from './tones';
import { hexToUnit, levelAt, pushPolygon, WORLD_PER_LEVEL } from './shared';
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

/**
 * Builds the ground mesh's `positions`/`colors`/`indices` exactly as before,
 * plus `litColors` (same length and vertex order as `colors`) -- each
 * vertex's tone recomputed through the IDENTICAL `groundTone`/`composite`/
 * `quantise` pipeline, fed a "lit" `tones`/`background` (every source tone
 * this module reads -- `open`, `road`, `rock`, `underBuilding`, plus
 * `background` itself -- shifted `GROUND_LIT_STEPS` toward its own ramp's
 * lightest entry via `rampNeighbor`, computed ONCE here, not per vertex).
 * Reusing `groundTone` unchanged for the lit pass (rather than a second,
 * hand-written variant) is what keeps the two outputs from silently
 * drifting apart -- whatever `groundTone`'s own branching does for the
 * normal tones, it does identically for the lit ones, by construction.
 * `litColors` is still always a `quantise`d, on-palette entry: `rampNeighbor`
 * only ever returns another member of a named ramp (or its input unchanged),
 * and `quantise` runs on the composite the same way it always did.
 */
export function buildGround(input: TerrainInput, tones: TerrainTones, background: string): MeshData {
  const { width, height } = input;
  const positions: number[] = [];
  const colors: number[] = [];
  const litColors: number[] = [];
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
    flip: boolean
  ): void => {
    pushPolygon(positions, colors, indices, [p0, p1, p2, p3], color, flip);
    // `pushPolygon` already pushed 4 fresh vertices into `positions`/`colors`
    // and their triangles into `indices` -- `litColors` needs no positions or
    // indices of its own, only 4 more colour triples in the same vertex
    // order, so appending them directly (rather than calling `pushPolygon` a
    // second time, which would duplicate `positions`/`indices`) keeps every
    // array's vertex count in lockstep with `colors`.
    for (let i = 0; i < 4; i++) litColors.push(litColor[0], litColor[1], litColor[2]);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ti = y * width + x;
      const levelHere = levelAt(input, x, y);
      const topY = levelHere * WORLD_PER_LEVEL;

      const toneHex = groundTone(input, tones, ti, PALETTE_HEXES, background);
      const toneColor = hexToUnit(toneHex);
      const litToneHex = groundTone(input, litTones, ti, PALETTE_HEXES, litBackground);
      const litToneColor = hexToUnit(litToneHex);

      // Tile top: a flat quad at its own height, four fresh vertices, no
      // sharing with any neighbour. `flip: false` gives it an up-facing
      // (+Y) normal -- see the winding note above.
      pushQuad(
        [x, topY, y],
        [x + 1, topY, y],
        [x + 1, topY, y + 1],
        [x, topY, y + 1],
        toneColor,
        litToneColor,
        false
      );

      // East face (this tile vs. the neighbour at x + 1): sized to the drop,
      // not this tile's absolute height, so two equal-height tiles show no
      // wall along their shared edge. `flip: true` gives it a +X normal.
      const levelEast = levelAt(input, x + 1, y);
      const dropEast = levelHere - levelEast;
      if (dropEast > 0) {
        const bottomY = levelEast * WORLD_PER_LEVEL;
        pushQuad(
          [x + 1, topY, y],
          [x + 1, topY, y + 1],
          [x + 1, bottomY, y + 1],
          [x + 1, bottomY, y],
          faceEastColor,
          litFaceEastColor,
          true
        );
      }

      // South face (this tile vs. the neighbour at y + 1). `flip: false`
      // gives it a +Z normal.
      const levelSouth = levelAt(input, x, y + 1);
      const dropSouth = levelHere - levelSouth;
      if (dropSouth > 0) {
        const bottomY = levelSouth * WORLD_PER_LEVEL;
        pushQuad(
          [x, topY, y + 1],
          [x + 1, topY, y + 1],
          [x + 1, bottomY, y + 1],
          [x, bottomY, y + 1],
          faceSouthColor,
          litFaceSouthColor,
          false
        );
      }
    }
  }

  return {
    positions: Float32Array.from(positions),
    colors: Float32Array.from(colors),
    litColors: Float32Array.from(litColors),
    indices: Uint32Array.from(indices),
  };
}
