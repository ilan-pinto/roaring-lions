import { describe, expect, it } from 'vitest';
import { advancePhase, phaseOffset, SIM_HZ, STRIDE_TILES, walkFps, walkFrameIndex } from './anim';

describe('walkFps', () => {
  it('paces the gait so one cycle covers STRIDE_TILES of ground', () => {
    // A unit crossing STRIDE_TILES in one second must complete exactly one
    // cycle in that second — otherwise the feet slide over the terrain.
    expect(walkFps(STRIDE_TILES, 4)).toBeCloseTo(4);
    expect(walkFps(STRIDE_TILES * 2, 4)).toBeCloseTo(8);
  });

  it('reproduces the legacy cadence for infantry at its data speed', () => {
    // inf_squad is 0.9 tiles/s; the old hardcoded 0.12-per-frame counter ran
    // at 7.2 walk-frames/s on a 60 fps display. Matching it keeps foot troops
    // looking exactly as they did before, with everything else now correct.
    expect(walkFps(0.9, 4)).toBeCloseTo(7.2);
  });

  it('scales with speed, so a technical scrambles and a mortar team shuffles', () => {
    const technical = walkFps(2.6, 4);
    const infantry = walkFps(0.9, 4);
    expect(technical / infantry).toBeCloseTo(2.6 / 0.9);
  });

  it('is zero for a stationary unit', () => {
    expect(walkFps(0, 4)).toBe(0);
  });

  it('never runs backwards on a negative measured speed', () => {
    // Measured speed comes from a position delta, which can go negative on a
    // teleport or a respawned entity slot reusing a stale previous position.
    expect(walkFps(-1.5, 4)).toBe(0);
  });

  it('is zero when a sheet has no walk frames', () => {
    expect(walkFps(1.0, 0)).toBe(0);
  });
});

describe('phaseOffset', () => {
  it('gives every entity a different starting foot', () => {
    // The whole point: a squad ordered to move must not step in unison.
    const offsets = new Set<number>();
    for (let i = 0; i < 12; i++) offsets.add(phaseOffset(i, 4));
    expect(offsets.size).toBe(12);
  });

  it('stays inside the walk-frame range', () => {
    for (let i = 0; i < 400; i++) {
      const o = phaseOffset(i, 4);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThan(4);
    }
  });

  it('separates adjacent entity ids, which is how squads are numbered', () => {
    // Consecutive ids are the realistic case: units spawn in blocks.
    for (let i = 0; i < 20; i++) {
      expect(Math.abs(phaseOffset(i, 4) - phaseOffset(i + 1, 4))).toBeGreaterThan(0.2);
    }
  });

  it('is stable for a given entity', () => {
    expect(phaseOffset(7, 4)).toBe(phaseOffset(7, 4));
  });

  it('is zero when a sheet has no walk frames', () => {
    expect(phaseOffset(3, 0)).toBe(0);
  });
});

describe('advancePhase', () => {
  it('advances by elapsed time, not by frame count', () => {
    // The defect this replaces: the old counter added a constant per rendered
    // frame, so a 30 fps machine animated at half speed. Two 1/60 s steps and
    // one 1/30 s step must land in the same place.
    const twoSmall = advancePhase(advancePhase(0, 8, 1 / 60, 4), 8, 1 / 60, 4);
    const oneBig = advancePhase(0, 8, 1 / 30, 4);
    expect(twoSmall).toBeCloseTo(oneBig);
  });

  it('wraps within the cycle', () => {
    const p = advancePhase(0, 8, 10, 4);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(4);
  });

  it('holds position when stopped, so gait resumes mid-stride', () => {
    // Resetting to 0 on stop is what made every unit restart on the same foot.
    expect(advancePhase(2.4, 0, 1 / 60, 4)).toBeCloseTo(2.4);
  });

  it('survives a long frame hitch without desyncing', () => {
    const p = advancePhase(0, 8, 3.7, 4);
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeLessThan(4);
  });
});

describe('walkFrameIndex', () => {
  it('never returns the idle frame, which is reserved as frame 0', () => {
    for (const phase of [0, 0.9, 1.5, 3.99, 2.0]) {
      const f = walkFrameIndex(phase, 4);
      expect(f).toBeGreaterThanOrEqual(1);
      expect(f).toBeLessThanOrEqual(4);
    }
  });

  it('steps through the cycle in order', () => {
    expect(walkFrameIndex(0, 4)).toBe(1);
    expect(walkFrameIndex(1, 4)).toBe(2);
    expect(walkFrameIndex(2, 4)).toBe(3);
    expect(walkFrameIndex(3, 4)).toBe(4);
  });

  it('falls back to the idle frame when a sheet has no walk frames', () => {
    expect(walkFrameIndex(1.2, 0)).toBe(0);
  });
});

describe('SIM_HZ', () => {
  it('matches the fixed sim tick rate', () => {
    // Invariant 1. Measured speed is derived from a per-tick position delta,
    // so this constant being wrong silently mis-paces every unit in the game.
    expect(SIM_HZ).toBe(20);
  });
});
