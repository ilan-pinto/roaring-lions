/**
 * Olive groves: one dominant tree per grove tile, a second smaller one on
 * roughly a third of them, each a splayed two-stem trunk under a three-lobe
 * crown. Ported from `drawCanopy` (`renderer.ts:1675-1757`) and the flat
 * trunk shadow at `renderer.ts:1561`.
 *
 * THE NEW PROBLEM (why this file is not just another `scatter.ts` mark):
 * every mark `buildScatter` places is a flat quad lying on a tile's own
 * ground plane -- true of a limestone fleck, a rut, even a ridge's rock
 * blob. A canopy is the first thing in Phase B2 that is meant to have
 * *height*: it must occlude terrain standing behind it, which only works if
 * its geometry actually stands above the ground rather than painting a
 * bigger, greener version of the same flat trick.
 *
 * The choice made here: trunk and crown are camera-facing billboards --
 * quads standing upright, always facing the viewer. That is the "billboards
 * first" framing Phase B's own spec uses, and it is cheap to make *correct*
 * rather than merely plausible because this camera never orbits: `ELEVATION`
 * (`project.ts`) and `AZIMUTH` (`camera.ts`) are consts derived from layout
 * constants, and `Camera` is `{x, y, zoom}` -- no orbit field exists to
 * animate. So "facing the camera" is not a per-frame computation, it is two
 * constant world-space axes baked in at build time, and they are exact, not
 * approximate:
 *
 *   - a local "right" axis, horizontal and independent of pitch:
 *     `screenOffsetToWorld(r, 0)` returns `{ dx: r / TILE_W, dy: -r / TILE_W
 *     }`, and feeding that back through `isoX` gives exactly `r` screen
 *     pixels -- not close to `r`, exactly `r`, because `screenOffsetToWorld`
 *     is `isoX`/`isoY`'s exact algebraic inverse (proven by
 *     `scatter.test.ts`'s own round-trip test). A crown built from these
 *     corners projects to the identical pixel shape `drawCanopy` draws in
 *     Pixi, not an approximation of it.
 *   - a local "up" axis: world Y itself, and `up * WORLD_Y_PER_LIFT_PIXEL`
 *     is exactly one screen pixel of rise per unit of `up` by that
 *     constant's own construction (`project.ts`'s doc comment derives it by
 *     solving for exactly this). A billboard that stands upright in world Y
 *     (rather than tilting to face the camera's own tilted "up", which a
 *     full spherical billboard would do) is also simply more correct for a
 *     tree that has to look planted on the ground from every zoom level.
 *
 * So every corner in this file is authored as a `[rightPx, upPx]` pair local
 * to a tree's own ground anchor -- `rightPx` run through `screenOffsetToWorld`
 * for (x, z), `upPx` scaled by `WORLD_Y_PER_LIFT_PIXEL` for true world-Y
 * height -- which is what turns Pixi's flat canopy drawing into standing
 * geometry pixel-for-pixel, without inventing a new projection this module
 * would have to re-derive by hand. The ground anchor itself (where in the
 * tile the trunk base sits) is placed exactly like a scatter mark: a full
 * two-axis `screenOffsetToWorld` offset from the tile centre, clamped the
 * same way (`clampCenterToTile`, shared with `scatter.ts` -- see
 * `clamp.ts`).
 *
 * Depth between the tree's own overlapping layers (trunk under crown, dark
 * lobes under the sunlit highlights) is real geometry, not alpha order --
 * this file carries no alpha channel, per the palette-quantised-composite
 * rule every terrain builder follows. Each layer is composited on the CPU
 * over what Pixi actually draws it on top of (the highlight over its own
 * base lobe's colour, matching `scatter.ts`'s blob/highlight chain) and then
 * nudged a hair closer to the camera along world Y, the same guaranteed-safe
 * trick `scatter.ts`'s `HIGHLIGHT_EPSILON` uses (world Y is monotonic with
 * camera distance for this fixed pitch, independent of pan or zoom) so the
 * depth test always resolves the layers in the same order Pixi's paint order
 * would have.
 */
import { WORLD_PER_LEVEL } from './ground';
import { TILE_W, TILE_H, WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import { composite, quantise, groundTone, PALETTE_HEXES } from './tones';
import { tileHash } from '../../tile-hash';
import { screenOffsetToWorld } from './scatter';
import { CLAMP_LIMIT, clampCenterToTile } from './clamp';
import type { MeshData, TerrainInput } from './types';
import type { TerrainTones } from '../../api';

/** Mirrors `DECOR.grove` (`@lions/data`'s `map.ts`) and the same redeclaration
 *  in `scatter.ts`/`tones.ts` -- `@lions/render` must not depend on
 *  `@lions/data` (ESLint-enforced), so every terrain builder keeps its own
 *  copy of the handful of DECOR values it reads. */
const DECOR_GROVE = 2;

/** Marks sit this far above the exact ground plane so a flat mark (the
 *  trunk shadow) does not z-fight the tile-top quad directly beneath it --
 *  same constant, same reasoning as `scatter.ts`'s own `MARK_EPSILON`. */
const MARK_EPSILON = 0.01;

/**
 * Per-layer nudge toward the camera (added to world Y after real height),
 * one per paint layer in the order Pixi actually draws them: trunk body,
 * its lit edge, the crown's three dark lobes (all one layer -- they never
 * need to out-rank each other), the sun-mid highlight over those, and the
 * brightest highlight over that. Each strictly larger than the last, same
 * order of magnitude as `scatter.ts`'s `HIGHLIGHT_EPSILON` (0.02) -- large
 * enough to always win the depth test against a neighbouring layer's own
 * real height variation at this scale, small enough that no tree reads as
 * "floating apart." Exported so `grove.test.ts` can assert the ordering and
 * the screen-pixel-converted margin directly, rather than trusting a comment.
 *
 * Every quad of one tree is coplanar (right/up are both literal world axes,
 * shared by every layer of one tree), so wherever two layers' quads
 * genuinely overlap in screen space they are, before this nudge, an EXACT
 * depth tie -- the epsilon is not competing against some other source of
 * separation, it is the only thing resolving that tie, in either direction,
 * deterministically. Converted to screen-pixel-equivalent rise (divide by
 * `WORLD_Y_PER_LIFT_PIXEL`): 0.005-0.04 world units is about 0.2-1.6px,
 * comfortably under the crown's own real inter-lobe separation (the
 * smallest offset any lobe/highlight centre sits from another is
 * `ry * 0.16`, at minimum around 2.5px for the smallest crown this module
 * builds) -- large enough to break a tie, nowhere near large enough to read
 * as the layers floating apart from each other.
 */
export const TRUNK_EPSILON = 0.005;
export const TRUNK_LIT_EPSILON = 0.01;
export const CROWN_EPSILON = 0.02;
export const CROWN_MID_EPSILON = 0.03;
export const CROWN_LIT_EPSILON = 0.04;

/** Trunk shadow: `renderer.ts:1561`'s flat ellipse, `t.rock` at alpha 0.22,
 *  offset `cy + 3`, radii (9, 4.5). Diamond-approximated at fleck scale --
 *  see `ellipseCorners`'s doc comment for why the crown itself needs more
 *  segments and this does not. */
const SHADOW_OFFSET_Y = 3;
const SHADOW_RX = 9;
const SHADOW_RY = 4.5;
const SHADOW_ALPHA = 0.22;

/**
 * Corners per crown ellipse (each dark lobe and each highlight). A 4-corner
 * diamond -- fine for a 2-4px scatter fleck, which is what `scatter.ts`'s
 * own `diamondCorners` exists for -- holds only `2/π` (~64%) of its
 * inscribed ellipse's area and reads as a hard-edged rhombus at crown scale
 * (a main lobe's own radius runs 12.5-16.5px, several times larger than
 * anything `scatter.ts` approximates this way). Raised to an octagon here:
 * every lobe/highlight is materially closer to Pixi's filled ellipse and no
 * longer hard-edged, at a cost of 4 extra vertices and triangles per
 * ellipse -- cheap for the handful of trees a grove tile draws, and not
 * worth paying anywhere `scatter.ts` uses `diamondCorners`, where the
 * shapes are small enough that a diamond and an ellipse are visually
 * indistinguishable. `SHADOW_RX`/`SHADOW_RY` above stay a 4-corner diamond
 * for the same reason -- the shadow is fleck-scale, not crown-scale. */
const CROWN_LOBE_SEGMENTS = 8;

function hexToUnit(hex: string): [number, number, number] {
  const h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** Mirrors `ground.ts`'s private `levelAt` (also redeclared in `scatter.ts`
 *  for the same reason): elevation level (0-9) at `(x, y)`, or 0 off the
 *  map. */
function levelAt(input: TerrainInput, x: number, y: number): number {
  if (x < 0 || x >= input.width || y < 0 || y >= input.height) return 0;
  if (!input.elevation) return 0;
  return input.elevation[y * input.width + x];
}

/** A billboard corner, local to a tree's own ground anchor: `right` in
 *  screen-pixel-equivalent units along the camera's local right axis,
 *  `up` the same along world Y (positive is up, away from the ground). */
type Corner = readonly [right: number, up: number];

/**
 * `CROWN_LOBE_SEGMENTS` corners approximating an ellipse centred at
 * `(cr, cu)`, starting at the top and stepping clockwise -- the same
 * rotational sense `scatter.ts`'s `diamondCorners` starts from (top, then
 * right, then bottom, then left), generalised from 4 points to
 * `CROWN_LOBE_SEGMENTS`. At 4 segments this reduces to exactly that
 * diamond; at 8 it adds the four diagonal points, closer to the ellipse's
 * own boundary at every angle. Ordered so a single shared winding
 * (`pushPolygon`'s fixed fan below) is correct for every polygon this
 * module builds -- verified directly by this file's own winding test, not
 * assumed from `scatter.ts`'s (a different plane, orthogonal reasoning). */
function ellipseCorners(cr: number, cu: number, rr: number, ru: number): readonly Corner[] {
  const corners: Corner[] = [];
  for (let i = 0; i < CROWN_LOBE_SEGMENTS; i++) {
    const theta = Math.PI / 2 - (i * 2 * Math.PI) / CROWN_LOBE_SEGMENTS;
    corners.push([cr + rr * Math.cos(theta), cu + ru * Math.sin(theta)]);
  }
  return corners;
}

/** Four corners of a rectangle spanning `[rMin, rMax] x [uMin, uMax]`, in the
 *  same top-left/top-right/bottom-right/bottom-left rotational order. */
function rectCorners(rMin: number, rMax: number, uMin: number, uMax: number): readonly Corner[] {
  return [
    [rMin, uMax],
    [rMax, uMax],
    [rMax, uMin],
    [rMin, uMin],
  ];
}

export function buildGroves(input: TerrainInput, tones: TerrainTones, background: string): MeshData {
  const { width, height } = input;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  /**
   * One flat-shaded convex polygon, fan-triangulated from its own first
   * vertex. A single shared winding for every polygon in this file: every
   * one of them lies in one of exactly two planes (a tree's camera-facing
   * billboard plane, or the ground plane the trunk shadow sits flat on),
   * and both were authored so their own top/right/bottom/left (or
   * top-left/.../bottom-left) corner order already traces the correct
   * front-facing perimeter -- see `ellipseCorners`/`rectCorners` above and
   * the flat diamond built by `pushShadow` below. No polygon here needs the
   * alternate winding `ground.ts`'s east/south faces do, so there is no
   * `flip` parameter to thread through -- one fan direction, confirmed by
   * this file's own winding test rather than assumed. The fan itself
   * mirrors a 4-point quad's proven-correct triangle pair exactly: for
   * `n` points, triangle `i` is `(0, i+1, i)` -- at `n = 4` that is
   * `(0,2,1)` and `(0,3,2)`, the same two triangles a plain quad always
   * used here.
   */
  const pushPolygon = (points: readonly [number, number, number][], color: [number, number, number]): void => {
    const base = positions.length / 3;
    for (const p of points) positions.push(p[0], p[1], p[2]);
    for (let i = 0; i < points.length; i++) colors.push(color[0], color[1], color[2]);
    for (let i = 1; i < points.length - 1; i++) {
      indices.push(base, base + i + 1, base + i);
    }
  };

  /**
   * The trunk shadow: a flat ground mark, positioned and clamped exactly
   * like `scatter.ts`'s own `pushMark`, via the shared `clampCenterToTile`
   * (`clamp.ts`).
   */
  const pushShadow = (originX: number, originZ: number, topY: number, colorHex: string): void => {
    const color = hexToUnit(colorHex);
    const corners: readonly (readonly [number, number])[] = [
      [0, -SHADOW_RY],
      [SHADOW_RX, 0],
      [0, SHADOW_RY],
      [-SHADOW_RX, 0],
    ];
    const center = screenOffsetToWorld(0, SHADOW_OFFSET_Y);
    const cornerDeltas = corners.map(([cdx, cdy]) => screenOffsetToWorld(cdx, cdy));
    const { centerX, centerZ, scale } = clampCenterToTile(center.dx, center.dy, cornerDeltas, CLAMP_LIMIT);
    const world = cornerDeltas.map(
      (d) =>
        [originX + centerX + d.dx * scale, topY + MARK_EPSILON, originZ + centerZ + d.dy * scale] as [
          number,
          number,
          number,
        ]
    );
    pushPolygon(world, color);
  };

  /**
   * One tree instance (trunk + crown), anchored at `(originTileX,
   * originTileZ)` -- the tile centre plus a jittered, clamped ground offset
   * -- and standing on `topY`. `tw`/`th` are the trunk's half-width/height,
   * `rx`/`ry` the crown's own half-extents, all still in Pixi's screen-pixel
   * units -- exactly what `renderer.ts:1699-1732` computes, unconverted.
   */
  const pushTree = (
    tileX: number,
    tileZ: number,
    topY: number,
    offsetPxX: number,
    offsetPxY: number,
    tw: number,
    th: number,
    rx: number,
    ry: number,
    trunkHex: string,
    trunkLitHex: string,
    leafDarkHex: string,
    leafMidHex: string,
    leafLitHex: string
  ): void => {
    // Splayed two-stem trunk (renderer.ts:1699-1708): a flared trapezoid,
    // narrower at the top, plus a small lit rect near its crown-facing edge.
    const trunkQuad: readonly Corner[] = [
      [-tw, 0],
      [-tw * 0.45, th],
      [tw * 0.45, th],
      [tw, 0],
    ];
    const trunkHlQuad = rectCorners(-tw * 0.15, tw * 0.35, th - 1, th + 1);

    // Crown: three overlapping dark lobes (renderer.ts:1710-1723), then a
    // sun-mid and a brightest highlight biased toward the upper-left, the
    // 135-degree key the sprites use (renderer.ts:1724).
    const crownBaseU = th + ry * 0.62;
    const lobe0 = ellipseCorners(0, crownBaseU, rx, ry);
    const lobe1 = ellipseCorners(-rx * 0.44, crownBaseU - ry * 0.16, rx * 0.52, ry * 0.72);
    const lobe2 = ellipseCorners(rx * 0.44, crownBaseU - ry * 0.2, rx * 0.46, ry * 0.66);
    const hlMid = ellipseCorners(-rx * 0.22, crownBaseU + ry * 0.3, rx * 0.62, ry * 0.5);
    const hlLit = ellipseCorners(-rx * 0.38, crownBaseU + ry * 0.46, rx * 0.3, ry * 0.26);

    // Every corner across every polygon of this one tree, gathered once so
    // the whole tree clamps and scales together -- `clampCenterToTile`'s own
    // doc comment explains why per-shape clamping is wrong: it can leave
    // some corners of a shared shape repositioned and others not, producing
    // a near-degenerate polygon. Only the RIGHT component matters for the
    // ground-footprint clamp -- UP is real world height, never ground
    // position, so it never pushes a vertex outside the tile.
    const allCorners: readonly Corner[] = [
      ...trunkQuad,
      ...trunkHlQuad,
      ...lobe0,
      ...lobe1,
      ...lobe2,
      ...hlMid,
      ...hlLit,
    ];
    const cornerGroundDeltas = allCorners.map(([right]) => screenOffsetToWorld(right, 0));
    const anchorGround = screenOffsetToWorld(offsetPxX, offsetPxY);
    const { centerX, centerZ, scale } = clampCenterToTile(
      anchorGround.dx,
      anchorGround.dy,
      cornerGroundDeltas,
      CLAMP_LIMIT
    );

    const originX = tileX + centerX;
    const originZ = tileZ + centerZ;

    const toWorld = (corner: Corner, epsilon: number): [number, number, number] => {
      const g = screenOffsetToWorld(corner[0], 0);
      return [originX + g.dx * scale, topY + corner[1] * WORLD_Y_PER_LIFT_PIXEL * scale + epsilon, originZ + g.dy * scale];
    };

    const pushBillboard = (quad: readonly Corner[], colorHex: string, epsilon: number): void => {
      const color = hexToUnit(colorHex);
      pushPolygon(
        quad.map((c) => toWorld(c, epsilon)),
        color
      );
    };

    pushBillboard(trunkQuad, trunkHex, TRUNK_EPSILON);
    pushBillboard(trunkHlQuad, trunkLitHex, TRUNK_LIT_EPSILON);
    pushBillboard(lobe0, leafDarkHex, CROWN_EPSILON);
    pushBillboard(lobe1, leafDarkHex, CROWN_EPSILON);
    pushBillboard(lobe2, leafDarkHex, CROWN_EPSILON);
    pushBillboard(hlMid, leafMidHex, CROWN_MID_EPSILON);
    pushBillboard(hlLit, leafLitHex, CROWN_LIT_EPSILON);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ti = y * width + x;
      if (input.blocked[ti] !== 0) continue;
      if ((input.decor ? input.decor[ti] : 0) !== DECOR_GROVE) continue;

      const levelHere = levelAt(input, x, y);
      const topY = levelHere * WORLD_PER_LEVEL;
      const cx = x + 0.5;
      const cz = y + 0.5;
      const baseHex = groundTone(input, tones, ti, PALETTE_HEXES, background);

      pushShadow(cx, cz, topY, quantise(composite(baseHex, tones.rock, SHADOW_ALPHA), PALETTE_HEXES));

      // One dominant tree, a second smaller one on the same threshold Pixi
      // uses (renderer.ts:1690).
      const twin = tileHash(x * 3, y * 7) > 0.62;
      const count = twin ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const a = tileHash(x * 13 + k * 5, y * 29 + k * 3);
        const b = tileHash(x * 37 + k * 2, y * 11 + k * 7);
        const scale = k === 0 ? 1 : 0.68;
        const offsetPxX = (a - 0.5) * (TILE_W - 30) + (k === 0 ? 0 : 9);
        const offsetPxY = (b - 0.5) * (TILE_H - 16) + (k === 0 ? 0 : 4);

        const tw = 3.2 * scale;
        const th = (5.5 + a * 2.5) * scale;
        const rx = (12.5 + b * 4) * scale;
        const ry = rx * tones.crownRatio;

        const trunkHex = quantise(composite(baseHex, tones.trunk, 0.98), PALETTE_HEXES);
        const trunkLitHex = quantise(composite(trunkHex, tones.trunkLit, 0.5), PALETTE_HEXES);
        const leafDarkHex = quantise(composite(baseHex, tones.leafDark, 0.97), PALETTE_HEXES);
        const leafMidHex = quantise(composite(leafDarkHex, tones.leafMid, 0.92), PALETTE_HEXES);
        const leafLitHex = quantise(composite(leafMidHex, tones.leafLit, 0.8), PALETTE_HEXES);

        pushTree(
          cx,
          cz,
          topY,
          offsetPxX,
          offsetPxY,
          tw,
          th,
          rx,
          ry,
          trunkHex,
          trunkLitHex,
          leafDarkHex,
          leafMidHex,
          leafLitHex
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
