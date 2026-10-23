import { describe, expect, it } from 'vitest';
import { infantrySmokeOutlinePx, INFANTRY_SMOKE_OUTLINE_PX, SMOKE_OUTLINE_MIN, wearsSmokeOutline } from './smoke-outline';

describe('wearsSmokeOutline', () => {
  it('is true for a living, visible own unit at the threshold', () => {
    expect(wearsSmokeOutline(1, 0, 0, SMOKE_OUTLINE_MIN, true)).toBe(true);
  });
  it('is false one level below the threshold', () => {
    expect(wearsSmokeOutline(1, 0, 0, SMOKE_OUTLINE_MIN - 1, true)).toBe(false);
  });
  it('is never true for an enemy, however dense the smoke', () => {
    expect(wearsSmokeOutline(1, 1, 0, 255, true)).toBe(false);
  });
  it('is false for a dead or fogged unit', () => {
    expect(wearsSmokeOutline(0, 0, 0, 255, true)).toBe(false);
    expect(wearsSmokeOutline(1, 0, 0, 255, false)).toBe(false);
  });
  it('follows the viewer, not side 0', () => {
    expect(wearsSmokeOutline(1, 1, 1, 255, true)).toBe(true);
    expect(wearsSmokeOutline(1, 0, 1, 255, true)).toBe(false);
  });
  it('pins the threshold the lead ruled', () => {
    expect(SMOKE_OUTLINE_MIN).toBe(48);
  });
});

describe('infantrySmokeOutlinePx', () => {
  it('keeps the full width at zoom 1 and below', () => {
    expect(infantrySmokeOutlinePx(1, 2.5)).toBe(2.5);
    expect(infantrySmokeOutlinePx(0.35, 2.5)).toBe(2.5);
  });
  it('is thinnest at zoom 2 and above', () => {
    expect(infantrySmokeOutlinePx(2, 2.5)).toBe(INFANTRY_SMOKE_OUTLINE_PX);
    expect(infantrySmokeOutlinePx(2.5, 2.5)).toBe(INFANTRY_SMOKE_OUTLINE_PX);
  });
  it('tapers monotonically between', () => {
    expect(infantrySmokeOutlinePx(1.5, 2.5)).toBeCloseTo(2.0, 6);
  });
});
