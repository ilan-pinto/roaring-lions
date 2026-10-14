/**
 * The three.js camera must reproduce the projection PixiRenderer already
 * draws with. Not approximately: a disagreement of a few pixels puts every
 * sprite in the wrong place, and the golden-image diff that gates Phase D
 * would be comparing two different worlds.
 *
 * These assertions are the specification. The camera's position, frustum and
 * elevation angle are whatever satisfies them.
 */
import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { worldToScreen, screenToWorldFlat, isoX, isoY, ELEV_STEP, WORLD_Y_PER_LIFT_PIXEL, type Camera, type Viewport } from '../project';
import { worldToScreenThree, screenToWorldThree, dimetricCamera, updateDimetricCamera, CAMERA_NEAR, CAMERA_FAR } from './camera';
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

describe('updateDimetricCamera', () => {
  it('reuses one camera instance and matches a fresh dimetricCamera for the same input', () => {
    const persistent = new THREE.OrthographicCamera();
    const vp = { width: 1440, height: 900 };
    for (const cam of [
      { x: 5, y: 22, zoom: 2.5 },
      { x: 24, y: 24, zoom: 0.5 },
    ]) {
      const a = updateDimetricCamera(cam, vp, persistent);
      const b = dimetricCamera(cam, vp);
      expect(a).toBe(persistent);
      expect(a.projectionMatrix.toArray()).toEqual(b.projectionMatrix.toArray());
      expect(a.matrixWorld.toArray()).toEqual(b.matrixWorld.toArray());
    }
  });

  it('near/far bracket a 64x64 map with 8 units of height from any target on it', () => {
    expect(CAMERA_NEAR).toBe(1);
    expect(CAMERA_FAR).toBe(300);
    const vp = { width: 1440, height: 900 };
    for (const [tx, ty] of [
      [0, 0],
      [64, 64],
      [32, 32],
      [0, 64],
    ]) {
      const cam = dimetricCamera({ x: tx, y: ty, zoom: 1 }, vp);
      for (const [x, z] of [
        [0, 0],
        [64, 0],
        [0, 64],
        [64, 64],
      ]) {
        for (const y of [-1, 8]) {
          const ndc = new THREE.Vector3(x, y, z).project(cam);
          expect(Math.abs(ndc.z), `depth of ${x},${y},${z} from target ${tx},${ty}`).toBeLessThan(1);
        }
      }
    }
  });
});

/**
 * Very tall viewports (#571's "Known remaining issues"). An orthographic
 * ray starts on the CAMERA's own plane (three's `setFromCamera`: "set origin
 * in plane of camera"), so a row reaches the plane `y = h` only while that
 * row's start stands above `h`:
 *
 *   D * sin(EL) + ndcY * halfHeight * cos(EL) >= h
 *
 * At the old fixed distance of 120 that failed on the bottom rows of any
 * frustum taller than about 2,190 CSS px at the 0.35 zoom floor (a 5K
 * display at DPR 1, or a 1440p screen at 50% browser zoom), and a pointer
 * over those rows threw out of `screenToWorldThree`. Raised ground fails
 * sooner, which is why 3840x2160 is here at all: its flat ground resolved
 * on the old camera and its level-9 ground did not.
 *
 * The oracle is `project.ts`'s own arithmetic (`worldToScreen` with Pixi's
 * `lift`), which has no camera and so nothing to clip.
 */
describe('the camera reaches the ground on very tall viewports (#571 follow-up)', () => {
  /** `main.ts`'s zoom clamp floor: the tallest frustum a viewport can ask for. */
  const ZOOM_FLOOR = 0.35;
  /** Elevation is one digit a tile (map.schema.json): 9 is the top level. */
  const TOP_LEVEL = 9;
  /** A roof stands under 8 world units above its own ground (camera.ts). */
  const ROOF = 8;
  /** World-Y of a roof on level-9 ground, via project.ts's lift conversion. */
  const ROOF_Y = TOP_LEVEL * ELEV_STEP * WORLD_Y_PER_LIFT_PIXEL + ROOF;

  // A uniform level-9 grid wide enough that no probe below lands off it:
  // `groundLevelAt` reads 0 past the edge, which would quietly turn the
  // raised case back into the flat one.
  const N = 1024;
  const NINES = new Uint8Array(N * N).fill(TOP_LEVEL);
  const CENTRE: Camera = { x: N / 2, y: N / 2, zoom: ZOOM_FLOOR };

  /** The four corners, plus three more points along the bottom row. */
  function probes(vp: Viewport): [number, number][] {
    const right = vp.width - 1;
    const bottom = vp.height - 1;
    return [
      [0, 0],
      [right, 0],
      [0, bottom],
      [right, bottom],
      [Math.floor(vp.width / 4), bottom],
      [Math.floor(vp.width / 2), bottom],
      [Math.floor((3 * vp.width) / 4), bottom],
    ];
  }

  const CASES: { label: string; vp: Viewport; raised: boolean }[] = [
    { label: '5120x2880, flat ground', vp: { width: 5120, height: 2880 }, raised: false },
    { label: '5120x2880, level-9 ground', vp: { width: 5120, height: 2880 }, raised: true },
    { label: '2560x2560, flat ground', vp: { width: 2560, height: 2560 }, raised: false },
    { label: '2560x2560, level-9 ground', vp: { width: 2560, height: 2560 }, raised: true },
    // The control: this one resolved on the old camera too.
    { label: '3840x2160, flat ground', vp: { width: 3840, height: 2160 }, raised: false },
    { label: '3840x2160, level-9 ground', vp: { width: 3840, height: 2160 }, raised: true },
  ];
  const VIEWPORTS = [...new Map(CASES.map(({ vp }) => [`${vp.width}x${vp.height}`, vp])).entries()];

  it.each(CASES)('screenToWorldThree resolves every corner and the bottom row at zoom 0.35: $label', ({ vp, raised }) => {
    const lift = raised ? TOP_LEVEL * ELEV_STEP : 0;
    const missed: string[] = [];
    for (const [px, py] of probes(vp)) {
      let hit: { x: number; y: number };
      try {
        hit = raised ? screenToWorldThree(px, py, CENTRE, vp, NINES, N, N) : screenToWorldThree(px, py, CENTRE, vp);
      } catch {
        missed.push(`(${px}, ${py})`);
        continue;
      }
      // Resolving is not enough: it must resolve to the point project.ts
      // draws at that pixel.
      const back = worldToScreen(hit.x, hit.y, CENTRE, vp, lift);
      expect(back.x, `x at (${px}, ${py})`).toBeCloseTo(px, 3);
      expect(back.y, `y at (${px}, ${py})`).toBeCloseTo(py, 3);
    }
    expect(missed, 'pixels whose ray never met the ground').toEqual([]);
  });

  it.each(VIEWPORTS)('the ground and a level-9 roof under every probe lie inside [near, far] at zoom 0.35: %s', (_, vp) => {
    // Picking is the half of this that threw; drawing is the other half. A
    // roof the bottom row looks at must be in front of the near plane, and
    // the ground the top row looks at must be inside the far one.
    const camera = dimetricCamera(CENTRE, vp);
    const outside: string[] = [];
    for (const [px, py] of probes(vp)) {
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2((px / vp.width) * 2 - 1, 1 - (py / vp.height) * 2), camera);
      for (const y of [0, ROOF_Y]) {
        const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
        const z = hit ? hit.project(camera).z : NaN;
        if (!(Math.abs(z) < 1)) outside.push(`(${px}, ${py}) at y=${y.toFixed(2)}: ndc.z ${z}`);
      }
    }
    expect(outside).toEqual([]);
  });
});

describe('every ordinary viewport keeps the fixed-distance camera, to the bit', () => {
  /**
   * The camera as it was built before the tall-viewport fit, with every
   * constant spelled out as a literal (TILE_W 64, TILE_H 32, distance 120,
   * near 1, far 300) rather than imported from the module under test. The
   * golden gate captures at 1400x900 and `ui:shots` tops out at 2560x1440,
   * so if both stay bit-identical across the whole zoom clamp, nothing the
   * gates photograph can move.
   */
  function fixedDistanceCamera(cam: Camera, vp: Viewport): THREE.OrthographicCamera {
    const el = Math.asin(32 / 64);
    const sinEl = Math.sin(el);
    const dir = new THREE.Vector3(Math.cos(el) * Math.SQRT1_2, sinEl, Math.cos(el) * Math.SQRT1_2);
    const halfWidth = vp.width / (64 * cam.zoom * Math.SQRT2);
    const halfHeight = (vp.height * sinEl) / (32 * cam.zoom * Math.SQRT2);
    const c = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 1, 300);
    const target = new THREE.Vector3(cam.x, 0, cam.y);
    c.position.copy(target).addScaledVector(dir, 120);
    c.up.set(0, 1, 0);
    c.lookAt(target);
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
    return c;
  }

  // 0.35 to 2.5 in steps of 0.05, both clamp ends exact.
  const ZOOMS = [...Array.from({ length: 43 }, (_, i) => 0.35 + i * 0.05), 2.5];

  for (const vp of [
    { width: 1400, height: 900 },
    { width: 2560, height: 1440 },
  ]) {
    it(`${vp.width}x${vp.height}: position and projection equal the distance-120 build at every zoom from 0.35 to 2.5`, () => {
      for (const zoom of ZOOMS) {
        for (const [x, y] of [
          [24, 24],
          [0, 0],
          [64, 64],
          [5.5, 40.25],
        ]) {
          const cam: Camera = { x, y, zoom };
          const want = fixedDistanceCamera(cam, vp);
          const got = dimetricCamera(cam, vp);
          const at = `zoom ${zoom} at (${x}, ${y})`;
          expect(got.position.toArray(), at).toEqual(want.position.toArray());
          expect(got.projectionMatrix.toArray(), at).toEqual(want.projectionMatrix.toArray());
          expect(got.matrixWorld.toArray(), at).toEqual(want.matrixWorld.toArray());
          expect([got.near, got.far], at).toEqual([1, 300]);
        }
      }
    });
  }
});
