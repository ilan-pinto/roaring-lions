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
import { composite, quantise, groundTone, PALETTE_HEXES } from './tones';
import { hexToUnit, levelAt, pushPolygon, WORLD_PER_LEVEL } from './shared';
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

export function buildGround(input: TerrainInput, tones: TerrainTones, background: string): MeshData {
  const { width, height } = input;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const faceEastHex = quantise(composite(background, tones.rock, FACE_ALPHA_EAST), PALETTE_HEXES);
  const faceSouthHex = quantise(composite(background, tones.rock, FACE_ALPHA_SOUTH), PALETTE_HEXES);
  const faceEastColor = hexToUnit(faceEastHex);
  const faceSouthColor = hexToUnit(faceSouthHex);

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
  ): void => pushPolygon(positions, colors, indices, [p0, p1, p2, p3], color, flip);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ti = y * width + x;
      const levelHere = levelAt(input, x, y);
      const topY = levelHere * WORLD_PER_LEVEL;

      const toneHex = groundTone(input, tones, ti, PALETTE_HEXES, background);
      const toneColor = hexToUnit(toneHex);

      // Tile top: a flat quad at its own height, four fresh vertices, no
      // sharing with any neighbour. `flip: false` gives it an up-facing
      // (+Y) normal -- see the winding note above.
      pushQuad(
        [x, topY, y],
        [x + 1, topY, y],
        [x + 1, topY, y + 1],
        [x, topY, y + 1],
        toneColor,
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
          false
        );
      }
    }
  }

  return {
    positions: Float32Array.from(positions),
    colors: Float32Array.from(colors),
    indices: Uint32Array.from(indices),
  };
}
