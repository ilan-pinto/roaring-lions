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
import { WORLD_Y_PER_LIFT_PIXEL } from '../camera';
import { ELEV_STEP } from '../../project';
import { composite, quantise, groundTone, PALETTE_HEXES } from './tones';
import type { MeshData, TerrainInput } from './types';
import type { TerrainTones } from '../../api';

export type { MeshData, TerrainInput };

/**
 * World units of height per elevation level.
 *
 * Derived, not chosen. Pixi raises a tile by ELEV_STEP screen pixels per level;
 * three.js works in world units, and WORLD_Y_PER_LIFT_PIXEL is the bridge B1
 * solved for. Going through it means a four-level ridge stands exactly as tall
 * on screen in both backends, and it keeps ELEV_STEP the single place that
 * number is decided.
 */
export const WORLD_PER_LEVEL = ELEV_STEP * WORLD_Y_PER_LIFT_PIXEL;

/** Alphas Pixi composites the two visible side faces at (`renderer.ts:1421`,
 *  `:1432`) -- different on purpose, so a ridge reads as mass rather than a
 *  flat shape. */
const FACE_ALPHA_EAST = 0.7;
const FACE_ALPHA_SOUTH = 0.85;

function hexToUnit(hex: string): [number, number, number] {
  const h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** Elevation level (0-9) at `(x, y)`, or 0 off the map -- the rule that makes
 *  a rim tile show its full face rather than nothing at all. */
function levelAt(input: TerrainInput, x: number, y: number): number {
  if (x < 0 || x >= input.width || y < 0 || y >= input.height) return 0;
  if (!input.elevation) return 0;
  return input.elevation[y * input.width + x];
}

export function buildGround(input: TerrainInput, tones: TerrainTones, background: string): MeshData {
  const { width, height } = input;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const faceEastHex = quantise(composite(background, tones.rock, FACE_ALPHA_EAST), PALETTE_HEXES);
  const faceSouthHex = quantise(composite(background, tones.rock, FACE_ALPHA_SOUTH), PALETTE_HEXES);
  const faceEastColor = hexToUnit(faceEastHex);
  const faceSouthColor = hexToUnit(faceSouthHex);

  const pushQuad = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    color: [number, number, number],
    flip: boolean
  ): void => {
    const base = positions.length / 3;
    for (const p of [p0, p1, p2, p3]) positions.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) colors.push(color[0], color[1], color[2]);
    // `p0, p1, p2, p3` trace the quad's perimeter, not its diagonal. The two
    // fans through that perimeter -- (0,1,2)/(0,2,3) and its reverse
    // (0,2,1)/(0,3,2) -- point in opposite directions; which one is "up"
    // depends on which two edges of the perimeter are being crossed, so the
    // caller picks per quad (checked by hand against the camera's
    // +X/+Y/+Z-facing convention, not guessed).
    if (flip) {
      indices.push(base + 0, base + 1, base + 2, base + 0, base + 2, base + 3);
    } else {
      indices.push(base + 0, base + 2, base + 1, base + 0, base + 3, base + 2);
    }
  };

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
