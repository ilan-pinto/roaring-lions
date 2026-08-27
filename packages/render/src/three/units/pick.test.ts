import { describe, it, expect } from 'vitest';
import { pickUnit, unitsInScreenRect } from './pick';
import { worldToScreen, type Camera, type Viewport } from '../../project';

const CAM: Camera = { x: 24, y: 24, zoom: 1 };
const VP: Viewport = { width: 800, height: 600 };

/** Builds the plain-array roster `pickUnit`/`unitsInScreenRect` take, from a
 *  short list of (x, y, alive, tunnelIn) tuples -- entity id is the index. */
function roster(units: readonly [number, number, number, number][]) {
  const n = units.length;
  const curX = new Float64Array(n);
  const curY = new Float64Array(n);
  const alive = new Uint8Array(n);
  const tunnelIn = new Int32Array(n);
  units.forEach(([x, y, a, t], i) => {
    curX[i] = x;
    curY[i] = y;
    alive[i] = a;
    tunnelIn[i] = t;
  });
  return { curX, curY, alive, tunnelIn, n };
}

describe('pickUnit', () => {
  it('finds the nearest living unit within the default radius', () => {
    const { curX, curY, alive, tunnelIn, n } = roster([
      [10, 10, 1, -1],
      [10.5, 10, 1, -1],
      [15, 15, 1, -1],
    ]);
    // Closer to unit 0 than unit 1.
    expect(pickUnit(10.1, 10, curX, curY, alive, tunnelIn, n)).toBe(0);
    // Closer to unit 1 than unit 0.
    expect(pickUnit(10.4, 10, curX, curY, alive, tunnelIn, n)).toBe(1);
  });

  it('returns -1 when nothing living is within radiusTiles', () => {
    const { curX, curY, alive, tunnelIn, n } = roster([[10, 10, 1, -1]]);
    expect(pickUnit(50, 50, curX, curY, alive, tunnelIn, n)).toBe(-1);
  });

  it('defaults radiusTiles to 1.2, matching PixiRenderer.pickUnit', () => {
    const { curX, curY, alive, tunnelIn, n } = roster([[10, 10, 1, -1]]);
    // 1.19 tiles away: inside the default radius.
    expect(pickUnit(10 + 1.19, 10, curX, curY, alive, tunnelIn, n)).toBe(0);
    // 1.21 tiles away: outside it.
    expect(pickUnit(10 + 1.21, 10, curX, curY, alive, tunnelIn, n)).toBe(-1);
  });

  it('honours a caller-supplied radius', () => {
    const { curX, curY, alive, tunnelIn, n } = roster([[10, 10, 1, -1]]);
    expect(pickUnit(15, 10, curX, curY, alive, tunnelIn, n, 10)).toBe(0);
    expect(pickUnit(15, 10, curX, curY, alive, tunnelIn, n, 2)).toBe(-1);
  });

  it('skips dead units even when they are the closest', () => {
    const { curX, curY, alive, tunnelIn, n } = roster([
      [10, 10, 0, -1], // dead, would otherwise win
      [11, 10, 1, -1],
    ]);
    expect(pickUnit(10, 10, curX, curY, alive, tunnelIn, n)).toBe(1);
  });

  it('skips a buried unit (tunnelIn >= 0) even when it is the closest', () => {
    const { curX, curY, alive, tunnelIn, n } = roster([
      [10, 10, 1, 3], // alive but buried in route 3
      [11, 10, 1, -1],
    ]);
    expect(pickUnit(10, 10, curX, curY, alive, tunnelIn, n)).toBe(1);
    // And with nothing else on the surface, buried-only ground picks nothing.
    const solo = roster([[10, 10, 1, 0]]);
    expect(pickUnit(10, 10, solo.curX, solo.curY, solo.alive, solo.tunnelIn, solo.n)).toBe(-1);
  });
});

describe('unitsInScreenRect', () => {
  it('agrees with project.worldToScreen on flat ground', () => {
    const { curX, curY, alive, n } = roster([
      [20, 20, 1, -1],
      [26, 26, 1, -1],
      [40, 40, 1, -1],
    ]);
    // A screen rect around unit 0 and unit 1's projected points, built from
    // Pixi's own projection formula so this test does not merely check pick.ts
    // against itself.
    const p0 = worldToScreen(20, 20, CAM, VP);
    const p1 = worldToScreen(26, 26, CAM, VP);
    const lo = { x: Math.min(p0.x, p1.x) - 5, y: Math.min(p0.y, p1.y) - 5 };
    const hi = { x: Math.max(p0.x, p1.x) + 5, y: Math.max(p0.y, p1.y) + 5 };
    const hits = unitsInScreenRect(
      lo.x, lo.y, hi.x, hi.y,
      curX, curY, alive, n,
      null, 48, 48, CAM, VP
    );
    expect(hits.sort()).toEqual([0, 1]);
  });

  it('excludes dead units', () => {
    const { curX, curY, alive, n } = roster([
      [20, 20, 0, -1],
      [20, 20, 1, -1],
    ]);
    const p = worldToScreen(20, 20, CAM, VP);
    const hits = unitsInScreenRect(
      p.x - 5, p.y - 5, p.x + 5, p.y + 5,
      curX, curY, alive, n,
      null, 48, 48, CAM, VP
    );
    expect(hits).toEqual([1]);
  });

  it('normalises the rect regardless of corner order', () => {
    const { curX, curY, alive, n } = roster([[20, 20, 1, -1]]);
    const p = worldToScreen(20, 20, CAM, VP);
    // Drag from bottom-right to top-left -- x1 < x0, y1 < y0.
    const hits = unitsInScreenRect(
      p.x + 5, p.y + 5, p.x - 5, p.y - 5,
      curX, curY, alive, n,
      null, 48, 48, CAM, VP
    );
    expect(hits).toEqual([0]);
  });

  it('does NOT skip buried units, matching PixiRenderer.unitsInScreenRect', () => {
    const { curX, curY, alive, n } = roster([[20, 20, 1, 4]]);
    const p = worldToScreen(20, 20, CAM, VP);
    const hits = unitsInScreenRect(
      p.x - 5, p.y - 5, p.x + 5, p.y + 5,
      curX, curY, alive, n,
      null, 48, 48, CAM, VP
    );
    expect(hits).toEqual([0]);
  });

  it('projects a raised unit at its own tile height, matching Pixi lift for lift', () => {
    // A 4x4 map, all level 0 except tile (2, 2) at level 5.
    const W = 4, H = 4;
    const elevation = new Uint8Array(W * H);
    elevation[2 * W + 2] = 5;
    const { curX, curY, alive, n } = roster([[2.5, 2.5, 1, -1]]);

    // Pixi's own answer for this tile: isoY - groundOffset, groundOffset =
    // level * ELEV_STEP (10 px/level) -- i.e. project.worldToScreen with
    // lift = 50.
    const pixiHigh = worldToScreen(2.5, 2.5, CAM, VP, 50);
    const pixiFlat = worldToScreen(2.5, 2.5, CAM, VP, 0);

    const tightAroundHigh = unitsInScreenRect(
      pixiHigh.x - 2, pixiHigh.y - 2, pixiHigh.x + 2, pixiHigh.y + 2,
      curX, curY, alive, n,
      elevation, W, H, CAM, VP
    );
    expect(tightAroundHigh).toEqual([0]);

    // A tight box at the FLAT (unlifted) screen point must miss it: the
    // raised unit's feet genuinely project higher on screen.
    const tightAroundFlat = unitsInScreenRect(
      pixiFlat.x - 2, pixiFlat.y - 2, pixiFlat.x + 2, pixiFlat.y + 2,
      curX, curY, alive, n,
      elevation, W, H, CAM, VP
    );
    expect(tightAroundFlat).toEqual([]);
  });
});
