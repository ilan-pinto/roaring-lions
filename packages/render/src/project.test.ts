import { describe, it, expect } from 'vitest';
import {
  TILE_W, TILE_H, isoX, isoY, worldToScreen, screenToWorldFlat,
  type Camera, type Viewport,
} from './project';

const VP: Viewport = { width: 800, height: 600 };
const CAM: Camera = { x: 24, y: 24, zoom: 1 };

describe('isoX / isoY', () => {
  it('places the origin at zero', () => {
    expect(isoX(0, 0)).toBe(0);
    expect(isoY(0, 0)).toBe(0);
  });

  it('is 2:1 dimetric — one tile east is half a tile-width right and half a tile-height down', () => {
    expect(isoX(1, 0)).toBe(TILE_W / 2);
    expect(isoY(1, 0)).toBe(TILE_H / 2);
  });

  it('sends the two diagonals to pure horizontal and pure vertical', () => {
    expect(isoY(1, -1)).toBe(0);   // x-y axis runs flat across the screen
    expect(isoX(1, 1)).toBe(0);    // x+y axis runs straight down it
  });
});

describe('worldToScreen', () => {
  it('puts whatever the camera looks at in the middle of the viewport', () => {
    const p = worldToScreen(CAM.x, CAM.y, CAM, VP);
    expect(p.x).toBeCloseTo(VP.width / 2);
    expect(p.y).toBeCloseTo(VP.height / 2);
  });

  it('scales displacement from the camera by zoom', () => {
    const one = worldToScreen(CAM.x + 4, CAM.y, CAM, VP);
    const two = worldToScreen(CAM.x + 4, CAM.y, { ...CAM, zoom: 2 }, VP);
    expect(two.x - VP.width / 2).toBeCloseTo((one.x - VP.width / 2) * 2);
  });

  it('lifts a raised tile UP the screen, and by zoom-scaled amount', () => {
    const flat = worldToScreen(CAM.x + 2, CAM.y + 2, CAM, VP, 0);
    const high = worldToScreen(CAM.x + 2, CAM.y + 2, CAM, VP, 30);
    expect(high.y).toBeLessThan(flat.y);
    expect(flat.y - high.y).toBeCloseTo(30);
  });
});

describe('screenToWorldFlat', () => {
  it('round-trips with worldToScreen on flat ground', () => {
    for (const [wx, wy] of [[24, 24], [0, 0], [47, 12], [3.5, 41.25]]) {
      const s = worldToScreen(wx, wy, CAM, VP);
      const back = screenToWorldFlat(s.x, s.y, CAM, VP);
      expect(back.x).toBeCloseTo(wx);
      expect(back.y).toBeCloseTo(wy);
    }
  });

  it('round-trips under zoom too', () => {
    const cam: Camera = { x: 10, y: 30, zoom: 2.5 };
    const s = worldToScreen(18, 22, cam, VP);
    const back = screenToWorldFlat(s.x, s.y, cam, VP);
    expect(back.x).toBeCloseTo(18);
    expect(back.y).toBeCloseTo(22);
  });

  it('maps the viewport centre back to the camera', () => {
    const back = screenToWorldFlat(VP.width / 2, VP.height / 2, CAM, VP);
    expect(back.x).toBeCloseTo(CAM.x);
    expect(back.y).toBeCloseTo(CAM.y);
  });
});
