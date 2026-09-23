/**
 * WP-A1.3 Task 6, fix round 1: the terrain-conform census.
 *
 * Every vehicle-passable tile of every shipped map, sixteen headings each, a
 * Lavi's measured footprint, three readings of the SAME four footprint
 * corners:
 *
 * - SHIPPED: `conformHull` (`packages/render/src/three/units/vehicle-conform.ts`),
 *   the exact function `ThreeRenderer.updateVehicleMeshes` calls;
 * - SMOOTH: the Catmull-Rom field alone (`smoothLevel`) at the same four
 *   points -- the open ground that is drawn, with every terrace replaced by
 *   its open neighbours' levels, and the map edge replicated rather than
 *   dropped to 0;
 * - RAW: `groundWorldY` at the four corners, which is what the renderer did
 *   before this fix. It answers a blocked tile with that tile's own TOP and
 *   an off-map point with 0.
 *
 * A tile is flagged when, at some heading, a reading tilts the hull by more
 * than 10 degrees (pitch or roll) while the smooth ground under the SAME
 * corners at the SAME heading reads under 5. That is a superset of the Task 6
 * reviewer's definition (the tile's steepest heading over 10, its smooth
 * ground under 5 at EVERY heading): on the RAW sampler the reviewer's reads
 * 130 of `tel_marum`'s 1,534 passable tiles and 86 of `deir_amun`'s 1,916,
 * exactly as reported, and this one 135 and 92 -- so an empty result here is
 * empty under both. Measured by removing one branch of the fix at a time:
 * every `tel_marum` flag is a corner over its `^` ridge, every `deir_amun`
 * flag a corner off its raised edge. By this definition RAW also flags
 * `qarn_hadid` (54), `tel_marum_1..3` (131, 133, 122) and the three
 * `umm_zeitoun` maps (7 each).
 * The shipped sampler must flag NONE, on any map.
 *
 * `tools` may not import `@lions/render` (eslint), and `packages/render` may
 * not import `@lions/data`, so no single package can hold both the maps and
 * the function. The four render modules imported below by relative path are
 * three.js-free (`vehicle-conform` -> `ground-height` -> `terrain/shared` ->
 * `project`, and `terrain/surface`), which is the precedent
 * `mesh_gait.test.ts` set for exactly this reason: the alternative is a
 * second copy of the rule under test, and a copy cannot see the original
 * drift.
 */
import { describe, expect, it } from 'vitest';
import { maps, parseMap, type MapJson } from '@lions/data';
import {
  conformHull,
  type HullConform,
  type HullConformInput,
} from '../../packages/render/src/three/units/vehicle-conform';
import {
  hullCornerOffsets,
  terrainPitchRad,
  terrainRollRad,
  type HullCorners,
} from '../../packages/render/src/three/units/vehicle-weight';
import { smoothLevel, terrainSurfaceFrom } from '../../packages/render/src/three/terrain/surface';
import { WORLD_PER_LEVEL } from '../../packages/render/src/three/terrain/shared';
import { groundWorldY } from '../../packages/render/src/three/ground-height';

/** `vehicleShroudBounds(mbt_lavi.glb)` -- length along the hull and width
 *  across it, in tiles, as the Task 6 reviewer measured it off the shipped
 *  GLB. The roster's heaviest ground vehicle; a longer hull tilts less. */
const LAVI_LENGTH = 2.107;
const LAVI_WIDTH = 0.965;
const HEADINGS = 16;
const FLAG_DEG = 10;
const SMOOTH_UNDER_DEG = 5;
const DEG = 180 / Math.PI;

interface Census {
  passable: number;
  /** Tiles the SHIPPED sampler flags, `x,y@heading shipped/smooth`. */
  shipped: string[];
  /** Tiles the RAW, pre-fix sampler flags. */
  raw: string[];
}

function tiltDeg(pitchRad: number, rollRad: number): number {
  return Math.max(Math.abs(pitchRad), Math.abs(rollRad)) * DEG;
}

function census(json: MapJson): Census {
  const map = parseMap(json);
  const { width: w, height: h, blocked, boulder } = map;
  const surface = terrainSurfaceFrom(map.elevation, blocked, w, h);
  const corners: HullCorners = { frontX: 0, frontY: 0, rearX: 0, rearY: 0, leftX: 0, leftY: 0, rightX: 0, rightY: 0 };
  const out: HullConform = { pitchRad: 0, rollRad: 0 };
  const input: HullConformInput = {
    elevation: surface,
    blocked,
    mapWidth: w,
    mapHeight: h,
    centreX: 0,
    centreY: 0,
    centreGroundY: 0,
    facingNorm: 0,
    lengthTiles: LAVI_LENGTH,
    widthTiles: LAVI_WIDTH,
  };
  const smoothY = (x: number, y: number): number => smoothLevel(surface, x, y) * WORLD_PER_LEVEL;
  const rawY = (x: number, y: number): number => groundWorldY(surface, w, h, x, y);
  const result: Census = { passable: 0, shipped: [], raw: [] };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = y * w + x;
      if (blocked[t] !== 0 || boulder[t] !== 0) continue;
      result.passable++;
      const cx = x + 0.5;
      const cy = y + 0.5;
      input.centreX = cx;
      input.centreY = cy;
      input.centreGroundY = groundWorldY(surface, w, h, cx, cy);
      let shippedHit = '';
      let rawHit = '';
      for (let k = 0; k < HEADINGS; k++) {
        const facing = k / HEADINGS;
        input.facingNorm = facing;
        conformHull(input, corners, out);
        const shipped = tiltDeg(out.pitchRad, out.rollRad);
        const c = hullCornerOffsets(facing, LAVI_LENGTH / 2, LAVI_WIDTH / 2, corners);
        const at = (read: (x: number, y: number) => number): number =>
          tiltDeg(
            terrainPitchRad(read(cx + c.frontX, cy + c.frontY), read(cx + c.rearX, cy + c.rearY), LAVI_LENGTH),
            terrainRollRad(read(cx + c.leftX, cy + c.leftY), read(cx + c.rightX, cy + c.rightY), LAVI_WIDTH)
          );
        const smooth = at(smoothY);
        const raw = at(rawY);
        if (smooth < SMOOTH_UNDER_DEG) {
          if (!shippedHit && shipped > FLAG_DEG) shippedHit = `${x},${y}@${facing} ${shipped.toFixed(1)}/${smooth.toFixed(1)}`;
          if (!rawHit && raw > FLAG_DEG) rawHit = `${x},${y}@${facing} ${raw.toFixed(1)}/${smooth.toFixed(1)}`;
        }
      }
      if (shippedHit) result.shipped.push(shippedHit);
      if (rawHit) result.raw.push(rawHit);
    }
  }
  return result;
}

const ALL = maps as Readonly<Record<string, MapJson>>;

describe('the terrain conform stands a hull on the ground it is crossing', () => {
  // The reviewer's two maps, with the reviewer's own tile counts pinned so
  // this census is provably measuring the same set -- and the raw sampler's
  // flags asserted NON-empty, the control that proves the census can see the
  // defect it exists to keep out.
  it.each([
    ['tel_marum', 1534],
    ['deir_amun', 1916],
  ])('%s: no passable tile tilts a hull off a ridge top or a map edge', (id, passable) => {
    const c = census(ALL[id]);
    expect(c.passable).toBe(passable);
    expect(c.raw.length).toBeGreaterThan(0);
    expect(c.shipped).toEqual([]);
  });

  // And every other shipped map: most are flat (every reading 0), the rest
  // carry relief nobody has censused by hand.
  it('holds on every shipped map', () => {
    const offenders: string[] = [];
    for (const [id, json] of Object.entries(ALL)) {
      for (const hit of census(json).shipped) offenders.push(`${id} ${hit}`);
    }
    expect(offenders).toEqual([]);
  });
});
