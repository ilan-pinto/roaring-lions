/**
 * The three.js camera must reproduce the projection PixiRenderer already
 * draws with. Not approximately: a disagreement of a few pixels puts every
 * sprite in the wrong place, and the golden-image diff that gates Phase D
 * would be comparing two different worlds.
 *
 * These assertions are the specification. The camera's position, frustum and
 * elevation angle are whatever satisfies them.
 */
import { describe, it, expect } from 'vitest';
import { worldToScreen, screenToWorldFlat, isoX, isoY, ELEV_STEP, type Camera, type Viewport } from '../project';
import { worldToScreenThree, screenToWorldThree, dimetricCamera } from './camera';
import { groundLevelAt } from './ground-height';

const VP: Viewport = { width: 800, height: 600 };
const CAM: Camera = { x: 24, y: 24, zoom: 1 };

/** Points chosen to exercise both diagonals, the origin, and fractional tiles. */
const POINTS: [number, number][] = [
  [24, 24], [0, 0], [47, 12], [12, 47], [3.5, 41.25], [30, 30], [10, 38],
];

describe('the three.js camera reproduces the dimetric projection', () => {
  it('agrees with project.worldToScreen at every sample point', () => {
    for (const [wx, wy] of POINTS) {
      const pixi = worldToScreen(wx, wy, CAM, VP);
      const three = worldToScreenThree(wx, wy, CAM, VP);
      expect(three.x).toBeCloseTo(pixi.x, 3);
      expect(three.y).toBeCloseTo(pixi.y, 3);
    }
  });

  it('agrees under zoom', () => {
    const cam: Camera = { x: 10, y: 30, zoom: 2.5 };
    for (const [wx, wy] of POINTS) {
      const pixi = worldToScreen(wx, wy, cam, VP);
      const three = worldToScreenThree(wx, wy, cam, VP);
      expect(three.x).toBeCloseTo(pixi.x, 3);
      expect(three.y).toBeCloseTo(pixi.y, 3);
    }
  });

  it('agrees under a non-square viewport', () => {
    const vp: Viewport = { width: 1280, height: 400 };
    for (const [wx, wy] of POINTS) {
      const pixi = worldToScreen(wx, wy, CAM, vp);
      const three = worldToScreenThree(wx, wy, CAM, vp);
      expect(three.x).toBeCloseTo(pixi.x, 3);
      expect(three.y).toBeCloseTo(pixi.y, 3);
    }
  });

  // The pure self-round-trip ("round-trips its own screenToWorld[...]") moved
  // to conformance.ts's "worldToScreen and screenToWorld are inverses on flat
  // ground" -- that property now runs against this implementation too, so it
  // is asserted once rather than duplicated here.

  it('agrees with project.screenToWorldFlat on the inverse too', () => {
    for (const [px, py] of [[400, 300], [0, 0], [799, 599], [123, 456]]) {
      const pixi = screenToWorldFlat(px, py, CAM, VP);
      const three = screenToWorldThree(px, py, CAM, VP);
      expect(three.x).toBeCloseTo(pixi.x, 3);
      expect(three.y).toBeCloseTo(pixi.y, 3);
    }
  });

  it('agrees with project.screenToWorldFlat on the inverse under zoom and a panned camera', () => {
    const cam: Camera = { x: -8, y: 60, zoom: 1.75 };
    for (const [px, py] of [[400, 300], [0, 0], [799, 599], [123, 456]]) {
      const pixi = screenToWorldFlat(px, py, cam, VP);
      const three = screenToWorldThree(px, py, cam, VP);
      expect(three.x).toBeCloseTo(pixi.x, 3);
      expect(three.y).toBeCloseTo(pixi.y, 3);
    }
  });

  it('puts higher ground higher on screen, and by the same amount Pixi does', () => {
    // Elevation is three.js +Y. The dimetric projection turns a unit of height
    // into a fixed number of screen pixels; whatever that number is, it must
    // match what project.worldToScreen's `lift` parameter does -- checked
    // against Pixi's own answer rather than a hand-computed pixel count, so
    // this stays correct even if `lift`'s pixel-per-unit rate ever changes.
    const flat = worldToScreenThree(30, 30, CAM, VP, 0);
    const high = worldToScreenThree(30, 30, CAM, VP, 24);
    const pixiHigh = worldToScreen(30, 30, CAM, VP, 24);
    expect(high.y).toBeLessThan(flat.y);
    expect(high.x).toBeCloseTo(pixiHigh.x, 3);
    expect(high.y).toBeCloseTo(pixiHigh.y, 3);
  });

  it('builds a camera that is orthographic and looks along the dimetric axis', () => {
    const c = dimetricCamera(CAM, VP);
    expect(c.isOrthographicCamera).toBe(true);
    // 45 degrees around: equal contribution from the two ground axes.
    expect(Math.abs(c.position.x)).toBeCloseTo(Math.abs(c.position.z), 6);
    expect(c.position.y).toBeGreaterThan(0);
  });

  it('projects with square pixels: the frustum aspect matches the viewport', () => {
    // The load-bearing test for the elevation angle. Every assertion above
    // is a *ground-plane* match, and the ground projection alone cannot
    // constrain the elevation angle: `halfHeight` (camera.ts) is solved to
    // reproduce Pixi's ground pixels for whatever elevation angle is chosen,
    // so a wrong angle still passes all of them. What pins the angle at 30
    // degrees is requiring the SAME screen-pixels-per-view-space-unit scale
    // on both frustum axes ("square pixels") -- otherwise a three.js mesh
    // (terrain in B2, units in B3) renders vertically stretched relative to
    // the ground plane, even though every 2D screen coordinate above still
    // agrees with Pixi.
    for (const vp of [VP, { width: 1280, height: 400 }, { width: 600, height: 900 }]) {
      for (const cam of [CAM, { x: 10, y: 30, zoom: 2.5 }]) {
        const c = dimetricCamera(cam, vp);
        const frustumAspect = (c.right - c.left) / (c.top - c.bottom);
        expect(frustumAspect).toBeCloseTo(vp.width / vp.height, 6);
      }
    }
  });
});

/**
 * Bugfix: `screenToWorldThree` used to intersect the flat `y = 0` plane
 * unconditionally, ignoring elevation entirely -- and every existing test
 * above only ever compared it against `screenToWorldFlat`, the flat HALF of
 * `PixiRenderer.screenToWorld`'s own answer (`renderer.ts:951-971` applies
 * one iteration of lift correction on top of the flat guess). That made the
 * divergence untestable by construction: a test that only ever asks "does
 * this match the flat helper" cannot fail when the thing under test IS the
 * flat helper.
 *
 * Every other shipped map is flat (`elevation` absent or all-zero), so it
 * cannot distinguish a correct implementation from a broken one either --
 * `groundWorldY` returns 0 everywhere on them regardless of which formula
 * feeds it. `tel_marum` is the one shipped map with real relief, so its
 * elevation grid is reproduced HERE, verbatim from `data/maps/tel_marum.json`
 * (a literal copy of real digits, not synthesized) -- `packages/render` may
 * not import `@lions/data` (this package's own layering rule; `parseMap`
 * lives on the other side of it), so there is no `parseMap` to load the map
 * through instead.
 */
describe('screenToWorldThree is elevation-aware (bugfix)', () => {
  // Verbatim from data/maps/tel_marum.json's own "elevation" field -- see
  // this describe block's own top comment for why it is reproduced here
  // rather than loaded through `@lions/data`.
  const TEL_MARUM_ELEVATION_ROWS = [
    '333333111111111111111111111111111111111111333333',
    '333333111111111111111111111111111111111111333333',
    '333333111111111111111111111111111111111111333333',
    '333333111111111111111111111111111111111111333333',
    '333333111111111111111111111111111111111111333333',
    '333333111111111111111111111111111111111111333333',
    '333333111111111111111111111111111111111111333333',
    '333333111111111111111111111111111111111111333333',
    '333333111111111111111111111111111111111111333333',
    '333333111111111111111111111111111111111111333333',
    '333333111111144444111111111111111111111111333333',
    '333333111111144444111111111111111111111111333333',
    '333333444433444444444422222444444444444444333333',
    '333333444433444444444422222444444444444444333333',
    '333333444433444444444422222444444444444444333333',
    '333333444433444444433322222333444444444444333333',
    '333333444433444444433322222333444444444444333333',
    '333333444433444444433322222333444444444444333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000001110000000000000000333333',
    '333333000000000000000001110000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000222222222222200000000000333333',
    '333333000000000000222222222222200000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
    '333333000000000000000000000000000000000000333333',
  ];
  // Matches `tel_marum.json`'s own declared `width`/`height` (both 48) --
  // every row above is 48 characters, verbatim.
  const TEL_MARUM_WIDTH = 48;
  const TEL_MARUM_HEIGHT = TEL_MARUM_ELEVATION_ROWS.length;

  function elevationGrid(rows: readonly string[], width: number): Uint8Array {
    const out = new Uint8Array(rows.length * width);
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < width; x++) {
        out[y * width + x] = rows[y].charCodeAt(x) - 48;
      }
    }
    return out;
  }
  const TEL_MARUM_ELEVATION = elevationGrid(TEL_MARUM_ELEVATION_ROWS, TEL_MARUM_WIDTH);

  /**
   * Verbatim reproduction of `PixiRenderer.screenToWorld`'s own correction
   * (`renderer.ts:951-971`) -- read-only, comparison-only. `renderer.ts`
   * itself must not change (it is the source this bugfix ports FROM), and
   * importing the real `PixiRenderer` class here would drag `pixi.js` into
   * `three/`'s own test graph merely to reach ~10 lines of pure arithmetic
   * this file already has every primitive for (`worldToScreen`,
   * `screenToWorldFlat`, `isoX`, `isoY`, `ELEV_STEP`, all from `../project`).
   */
  function pixiScreenToWorld(
    px: number,
    py: number,
    cam: Camera,
    vp: Viewport,
    elevation: Uint8Array,
    mapWidth: number,
    mapHeight: number
  ): { x: number; y: number } {
    const flat = screenToWorldFlat(px, py, cam, vp);
    const level = groundLevelAt(elevation, mapWidth, mapHeight, flat.x, flat.y);
    const lift = level * ELEV_STEP;
    if (lift === 0) return flat;
    const z = cam.zoom;
    const sy = (py - vp.height / 2) / z + isoY(cam.x, cam.y) + lift;
    const sx = (px - vp.width / 2) / z + isoX(cam.x, cam.y);
    return { x: sx / TILE_W_ + sy / TILE_H_, y: sy / TILE_H_ - sx / TILE_W_ };
  }
  // `TILE_W`/`TILE_H` aren't imported above (nothing else in this file
  // needed the raw constants) -- re-derived from the one relationship
  // `screenToWorldFlat`'s own inverse depends on: `isoX(1,0) - isoX(0,0) =
  // TILE_W/2`, `isoY(1,0) - isoY(0,0) = TILE_H/2`. Avoids a second import
  // line for two numbers `project.ts` already exports directly, but keeps
  // this helper self-contained against drift if it ever isn't re-exported.
  const TILE_W_ = 2 * (isoX(1, 0) - isoX(0, 0));
  const TILE_H_ = 2 * (isoY(1, 0) - isoY(0, 0));

  const CAM_TM: Camera = { x: TEL_MARUM_WIDTH / 2, y: TEL_MARUM_HEIGHT / 2, zoom: 1 };
  const VP_TM: Viewport = { width: 4096, height: 4096 };

  it('closes the specific divergence: a real level-4 plateau tile, unclickable before this fix, clickable after', () => {
    // Tile (20, 13) and all four of its neighbours are elevation 4 in the
    // real map -- an interior plateau tile, not a terrace edge, so the
    // one-iteration correction (this file's own top comment on
    // `screenToWorldThree`) is exact here, not merely approximate.
    const trueX = 20.5;
    const trueY = 13.5;
    const lift = 4 * ELEV_STEP;
    const screen = worldToScreen(trueX, trueY, CAM_TM, VP_TM, lift);

    // Before this fix: screenToWorldThree took no elevation and always hit
    // the y = 0 plane -- reproduced here by simply not passing elevation.
    const beforeFix = screenToWorldThree(screen.x, screen.y, CAM_TM, VP_TM);
    const dBefore = (beforeFix.x - trueX) ** 2 + (beforeFix.y - trueY) ** 2;
    // 30 lift-px (4 levels * ELEV_STEP 10... actually 4 levels here) gives
    // far more than the 1.2-tile pick radius' worth of error -- this is the
    // "hard cliff", not a rounding difference.
    expect(dBefore).toBeGreaterThan(1.2 * 1.2);

    // After this fix: elevation-aware, matches the tile it actually landed on.
    const afterFix = screenToWorldThree(screen.x, screen.y, CAM_TM, VP_TM, TEL_MARUM_ELEVATION, TEL_MARUM_WIDTH, TEL_MARUM_HEIGHT);
    expect(afterFix.x).toBeCloseTo(trueX, 6);
    expect(afterFix.y).toBeCloseTo(trueY, 6);
  });

  it('matches Pixi\'s own elevation-corrected screenToWorld, tile-for-tile, over every interior tile of tel_marum\'s real relief', () => {
    // Interior only (excludes the outermost 1-tile border ring) -- the same
    // scope the whole-branch review's own per-tile sweep used, which is what
    // reproduces its reported counts exactly: 1460 tiles at levels 0-2, 490
    // at level 3, 166 at level 4, 2116 total.
    const byLevel = new Map<number, { total: number; pixi: number; three: number }>();
    for (let y = 1; y < TEL_MARUM_HEIGHT - 1; y++) {
      for (let x = 1; x < TEL_MARUM_WIDTH - 1; x++) {
        const level = TEL_MARUM_ELEVATION[y * TEL_MARUM_WIDTH + x];
        const trueX = x + 0.5;
        const trueY = y + 0.5;
        const screen = worldToScreen(trueX, trueY, CAM_TM, VP_TM, level * ELEV_STEP);

        const pixi = pixiScreenToWorld(screen.x, screen.y, CAM_TM, VP_TM, TEL_MARUM_ELEVATION, TEL_MARUM_WIDTH, TEL_MARUM_HEIGHT);
        const three = screenToWorldThree(screen.x, screen.y, CAM_TM, VP_TM, TEL_MARUM_ELEVATION, TEL_MARUM_WIDTH, TEL_MARUM_HEIGHT);

        const R2 = 1.2 * 1.2;
        const pixiHit = (pixi.x - trueX) ** 2 + (pixi.y - trueY) ** 2 < R2;
        const threeHit = (three.x - trueX) ** 2 + (three.y - trueY) ** 2 < R2;

        const bucket = byLevel.get(level) ?? { total: 0, pixi: 0, three: 0 };
        bucket.total++;
        if (pixiHit) bucket.pixi++;
        if (threeHit) bucket.three++;
        byLevel.set(level, bucket);
      }
    }

    // The exact re-run numbers (see the phase's final-fixes report): three
    // now matches Pixi tile-for-tile at every level, including the two
    // levels (3, 4) where it used to score 0.
    expect(byLevel.get(0)).toEqual({ total: 1012, pixi: 1012, three: 1012 });
    expect(byLevel.get(1)).toEqual({ total: 392, pixi: 392, three: 392 });
    expect(byLevel.get(2)).toEqual({ total: 56, pixi: 56, three: 56 });
    expect(byLevel.get(3)).toEqual({ total: 490, pixi: 462, three: 462 });
    expect(byLevel.get(4)).toEqual({ total: 166, pixi: 137, three: 137 });
  });
});
