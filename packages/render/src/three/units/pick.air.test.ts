import { describe, it, expect } from 'vitest';
import { AIR_AIRBORNE } from '@lions/sim';
import { pickUnitAtScreen, unitsInScreenRect, PICK_RADIUS_TILES, PICK_BODY_HEIGHT_TILES } from './pick';
import { worldToScreenThree, WORLD_Y_PER_LIFT_PIXEL } from '../camera';
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
 *
 * P2: the pick takes an optional per-unit `liftPx` (the renderer passes
 * `AIR_LIFT_PX * airLiftFrac`, never recomputed in pick.ts). Box-select then also
 * projects the drawn hull point, and the order/hover reach is widened UP the screen
 * by that lift so the whole drawn hull is pickable at the tight 0.5 radius.
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

/** How tall the pick body is, in lift pixels (the segment the ground-hidden reach is measured over). */
const BODY_PX = PICK_BODY_HEIGHT_TILES / WORLD_Y_PER_LIFT_PIXEL;

describe.each([AIR_LIFT_PX, 28])('air unit flying at %i px', (flyPx) => {
  const u = one(24, 24);
  const lift = drawnLiftPx(flyPx);
  const liftOf = (): number => lift;
  const hullCentre = worldToScreenThree(24, 24, CAM, VP, lift);
  /** `pickUnitAtScreen` with the P2 lift (default) or without it (`null`: today's call, no 17th argument). */
  const pick = (p: { x: number; y: number }, r: number, lf: (() => number) | null = liftOf) =>
    pickUnitAtScreen(p.x, p.y, u.curX, u.curY, u.alive, u.tunnelIn, 1, FLAT, 48, 48, CAM, VP, () => true, r, undefined, undefined, lf ?? undefined);
  const box = (x0: number, y0: number, x1: number, y1: number, lf: (() => number) | null = liftOf) =>
    unitsInScreenRect(x0, y0, x1, y1, u.curX, u.curY, u.alive, 1, FLAT, 48, 48, CAM, VP, undefined, lf ?? undefined);

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
  it('box-select: a box spanning hull and tile still selects it', () => {
    const tile = worldToScreenThree(24, 24, CAM, VP, 0);
    const { x, y } = hullCentre;
    expect(box(x - 6, y - 6, x + 6, tile.y + 6)).toEqual([0]);
  });
  it('box-select: a box drawn ONLY round the floating hull, clear of the tile, selects the carrier', () => {
    const { x, y } = hullCentre;
    const tile = worldToScreenThree(24, 24, CAM, VP, 0);
    expect(y + 6).toBeLessThan(tile.y - 6); // the box really is clear of the feet
    expect(box(x - 6, y - 6, x + 6, y + 6)).toEqual([0]);
  });
  it('box-select: without the lift (a ground unit, or the old call) the same hull-only box selects nothing', () => {
    const { x, y } = hullCentre;
    expect(box(x - 6, y - 6, x + 6, y + 6, null)).toEqual([]);
    expect(box(x - 6, y - 6, x + 6, y + 6, () => 0)).toEqual([]);
  });
  it('box-select: a box a hull-height ABOVE the drawn hull still selects nothing (the lift is a point, not a column)', () => {
    const { x, y } = hullCentre;
    expect(box(x - 6, y - 80, x + 6, y - 60)).toEqual([]);
  });
  it('order pick / hover (0.5) at the TOP of the drawn hull selects it', () => {
    const top = worldToScreenThree(24, 24, CAM, VP, lift + 0.9 * BODY_PX);
    expect(pick(top, ORDER_PICK_RADIUS_TILES)).toBe(0);
    expect(pick(top, PICK_RADIUS_TILES)).toBe(0);
  });
  it('the widened reach is bounded: a click far above the drawn hull, or beside it, still misses', () => {
    const farAbove = worldToScreenThree(24, 24, CAM, VP, lift + BODY_PX + 70);
    expect(pick(farAbove, ORDER_PICK_RADIUS_TILES)).toBe(-1);
    const beside = { x: hullCentre.x + 120, y: hullCentre.y };
    expect(pick(beside, ORDER_PICK_RADIUS_TILES)).toBe(-1);
  });
  it('a landed carrier (lift 0) reaches no further than a ground unit does', () => {
    const top = worldToScreenThree(24, 24, CAM, VP, lift + 0.9 * BODY_PX);
    expect(pick(top, ORDER_PICK_RADIUS_TILES, () => 0)).toBe(pick(top, ORDER_PICK_RADIUS_TILES, null));
  });
});

// Ground units are byte-identical: recorded from origin/main's pick.ts BEFORE this change (literals, not recomputed).
// Seven ground units, a lattice of clicks at both radii (837 points each) and 63 box-select rects.
const GROUND_GOLDEN_RADIUS_05 = [
  '0000000000000666660000000000000',
  '0000000000000666660000000000000',
  '0000000000000666660000000000000',
  '0000000000000066600000000000000',
  '0000000000000000000000000000000',
  '0000000000000000000000000000000',
  '0000000000000000000000000000000',
  '0000000000000000000000000000000',
  '0000000000000000000555500000000',
  '0003333300000000005555550000000',
  '0003333300000111115555550000000',
  '0003333300000111122555550000000',
  '0003333300000111222555550444000',
  '0003333300000111222255004444400',
  '0000333000000111222200004444440',
  '0000000000000022222000004444440',
  '0000000000000002220000004444440',
  '0000000000000000000000004444400',
  '0000000000000000000000000000000',
  '0000000000000000000000000000000',
  '0000000000000000000000000000000',
  '0000000000000000007770000000000',
  '0000000000000000777777000000000',
  '0000000000000000777777000000000',
  '0000000000000000777777000000000',
  '0000000000000000777777000000000',
  '0000000000000000077770000000000',
].join("");
const GROUND_GOLDEN_RADIUS_12 = [
  '0000000006666666666666000000000',
  '0000000006666666666666000000000',
  '0000000006666666666666000000000',
  '0000000006666666666666000000000',
  '0000000000666666666660000000000',
  '0000000000000066600000000000000',
  '0000000000000000055555555000000',
  '0033333330000005555555555550000',
  '3333333333301111555555555555000',
  '3333333333311111155555555555000',
  '3333333333311111115555555555400',
  '3333333333311111122555555544444',
  '3333333333311111222555554444444',
  '3333333333111111222255544444444',
  '3333333333111111222225444444444',
  '3333333333111122222222444444444',
  '0000333000222222222224444444444',
  '0000000000002222222224444444444',
  '0000000000000002222004444444444',
  '0000000000000000077770044444440',
  '0000000000000077777777770000000',
  '0000000000000777777777777000000',
  '0000000000007777777777777700000',
  '0000000000007777777777777700000',
  '0000000000007777777777777700000',
  '0000000000007777777777777700000',
  '0000000000000777777777777700000',
].join("");
const GROUND_GOLDEN_BOXES = "[];[];[];[];[];[];[];[];[];[];[];[];[5];[5];[5];[];[];[];[];[];[];[5];[4,5];[4,5];[];[];[];[];[];[2];[0,1,2];[0,1,4];[0,1,3,4];[3];[];[];[];[];[];[0,1];[0,1];[0,1,3];[3];[];[];[];[];[];[];[6];[6];[];[];[];[];[];[];[];[];[];[];[];[];";

const GXS = Float64Array.of(24, 24.4, 22.5, 26, 24.2, 21, 27.3);
const GYS = Float64Array.of(24, 24.1, 25, 23.2, 22.8, 21, 26.4);
const GALIVE = Uint8Array.of(1, 1, 1, 1, 1, 1, 1);
const GTUN = Int32Array.of(-1, -1, -1, -1, -1, -1, -1);

describe('ground units are byte-identical (GH-1007 P2)', () => {
  const clicks = (r: number, liftPx?: (i: number) => number): string => {
    let s = '';
    for (let py = 190; py <= 400; py += 8) {
      for (let px = 280; px <= 520; px += 8) {
        s += String(pickUnitAtScreen(px, py, GXS, GYS, GALIVE, GTUN, 7, FLAT, 48, 48, CAM, VP, () => true, r, undefined, undefined, liftPx) + 1);
      }
    }
    return s;
  };
  const boxes = (liftPx?: (i: number) => number): string => {
    let b = '';
    for (let y0 = 100; y0 <= 400; y0 += 50) {
      for (let x0 = 150; x0 <= 550; x0 += 50) {
        b += JSON.stringify(unitsInScreenRect(x0, y0, x0 + 120, y0 + 90, GXS, GYS, GALIVE, 7, FLAT, 48, 48, CAM, VP, undefined, liftPx)) + ';';
      }
    }
    return b;
  };
  it('the old call (no lift argument) still answers exactly what origin/main answered', () => {
    expect(clicks(ORDER_PICK_RADIUS_TILES)).toBe(GROUND_GOLDEN_RADIUS_05);
    expect(clicks(PICK_RADIUS_TILES)).toBe(GROUND_GOLDEN_RADIUS_12);
    expect(boxes()).toBe(GROUND_GOLDEN_BOXES);
  });
  it('a lift function that reads 0 for every ground unit changes nothing', () => {
    const zero = (): number => 0;
    expect(clicks(ORDER_PICK_RADIUS_TILES, zero)).toBe(GROUND_GOLDEN_RADIUS_05);
    expect(clicks(PICK_RADIUS_TILES, zero)).toBe(GROUND_GOLDEN_RADIUS_12);
    expect(boxes(zero)).toBe(GROUND_GOLDEN_BOXES);
  });
  it('an air unit among them lifts only itself: any click whose answer moves, moves onto the carrier', () => {
    // Unit 6 is the carrier (lift 28 px); every other unit reads 0. A click on the carrier's drawn hull may now
    // pick it instead of a ground unit; no click may change to anything else, and the carrier gains reach, never loses it.
    const only6 = (i: number): number => (i === 6 ? 28 : 0);
    for (const [r, golden] of [[ORDER_PICK_RADIUS_TILES, GROUND_GOLDEN_RADIUS_05], [PICK_RADIUS_TILES, GROUND_GOLDEN_RADIUS_12]] as const) {
      const got = clicks(r, only6);
      let moved = 0;
      for (let k = 0; k < got.length; k++) {
        if (got[k] === golden[k]) continue;
        moved++;
        expect(got[k]).toBe('7');
      }
      expect(moved).toBeGreaterThan(0); // the lift does something, or this test proves nothing
      expect([...golden].filter((c) => c === '7').length).toBeLessThanOrEqual([...got].filter((c) => c === '7').length);
    }
  });
});
