import { describe, it, expect } from 'vitest';
import { AIR_AIRBORNE } from '@lions/sim';
import { pickUnitAtScreen, unitsInScreenRect, PICK_RADIUS_TILES } from './pick';
import { worldToScreenThree } from '../camera';
import { airLiftFrac } from './air-lift';
import { AIR_LIFT_PX } from './frame-state';
import { type Camera, type Viewport } from '../../project';

/**
 * GH-1007 D6: the lead approved a 28 px flying height for air carriers on the
 * condition that clicking the DRAWN hull selects it. The renderer draws an air
 * unit at `AIR_LIFT_PX * airLiftFrac` lift pixels above its tile
 * (`ThreeRenderer.airLiftY`); picking reads the sim position `curX/curY`.
 * Left-click (1.2), order/hover pick (0.5) and box-select are checked at the
 * drawn hull centre for the lift the renderer uses today and for 28.
 */
const CAM: Camera = { x: 24, y: 24, zoom: 1 };
const VP: Viewport = { width: 800, height: 600 };
const ORDER_PICK_RADIUS_TILES = 0.5; // packages/app/src/input/pointer.ts (render cannot import app)
const FLAT = null; // flat ground: the lift is the only vertical term under test

const one = (x: number, y: number) => ({
  curX: Float64Array.of(x),
  curY: Float64Array.of(y),
  alive: Uint8Array.of(1),
  tunnelIn: Int32Array.of(-1),
});

/** The lift, in pixels, the renderer draws a fully airborne unit at, for a flying height. */
const drawnLiftPx = (flyPx: number): number => flyPx * airLiftFrac(AIR_AIRBORNE, 0, 1);

describe.each([AIR_LIFT_PX, 28])('air unit flying at %i px', (flyPx) => {
  const u = one(24, 24);
  const hullCentre = worldToScreenThree(24, 24, CAM, VP, drawnLiftPx(flyPx));
  const pick = (p: { x: number; y: number }, r: number) =>
    pickUnitAtScreen(p.x, p.y, u.curX, u.curY, u.alive, u.tunnelIn, 1, FLAT, 48, 48, CAM, VP, () => true, r);

  it('left-click (1.2) on the drawn hull selects it', () => {
    expect(pick(hullCentre, PICK_RADIUS_TILES)).toBe(0);
  });
  it('order pick / hover (0.5) on the drawn hull selects it', () => {
    expect(pick(hullCentre, ORDER_PICK_RADIUS_TILES)).toBe(0);
  });
  it('a click on the empty tile under the hull still selects it (the tile is within the hull-hiding reach)', () => {
    const tile = worldToScreenThree(24, 24, CAM, VP, 0);
    expect(pick(tile, PICK_RADIUS_TILES)).toBe(0);
  });
  it('box-select tests the FEET (the tile), not the hull: a box spanning hull and tile selects it', () => {
    const tile = worldToScreenThree(24, 24, CAM, VP, 0);
    const { x, y } = hullCentre;
    expect(unitsInScreenRect(x - 6, y - 6, x + 6, tile.y + 6, u.curX, u.curY, u.alive, 1, FLAT, 48, 48, CAM, VP)).toEqual([0]);
  });
  it('box-select drawn only round the hull, clear of the tile, selects nothing (documented, same at 14 and 28)', () => {
    const { x, y } = hullCentre;
    expect(unitsInScreenRect(x - 6, y - 6, x + 6, y + 6, u.curX, u.curY, u.alive, 1, FLAT, 48, 48, CAM, VP)).toEqual([]);
  });
});
