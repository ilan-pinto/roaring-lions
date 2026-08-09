import { describe, expect, it } from 'vitest';
import { advancePhase, phaseOffset, SIM_HZ, STRIDE_TILES, walkFps, ambientCue, SMOKE_EMBER_FRAME, SMOKE_EXHALE_FRAME } from './anim';

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

describe('SIM_HZ', () => {
  it('matches the fixed sim tick rate', () => {
    // Invariant 1. Measured speed is derived from a per-tick position delta,
    // so this constant being wrong silently mis-paces every unit in the game.
    expect(SIM_HZ).toBe(20);
  });
});

describe('ambientCue — the smoking idle beats', () => {
  it('fires the ember only on the frame the hand reaches the mouth', () => {
    expect(ambientCue('idle', 10, 4, SMOKE_EMBER_FRAME)).toBe('ember');
    expect(ambientCue('idle', 10, 6, SMOKE_EXHALE_FRAME)).toBe('smoke');
    expect(ambientCue('idle', 10, 2, 3)).toBeNull();
  });

  it('fires on entry only, never while the clip sits on the frame', () => {
    // The bug this guards: without the edge-detect an idling squad emits once
    // per *rendered* frame, so sixty puffs a second instead of one.
    expect(ambientCue('idle', 10, SMOKE_EMBER_FRAME, SMOKE_EMBER_FRAME)).toBeNull();
    expect(ambientCue('idle', 10, SMOKE_EXHALE_FRAME, SMOKE_EXHALE_FRAME)).toBeNull();
  });

  it('never fires outside the idle clip', () => {
    for (const clip of ['move', 'fire', 'down', 'wreck']) {
      expect(ambientCue(clip, 10, 4, SMOKE_EMBER_FRAME)).toBeNull();
    }
  });

  it('never fires for a team with a one-frame idle', () => {
    // The four crew-served and prone teams keep a static idle. They must not
    // smoke, and frames <= 1 is what tells the renderer so.
    expect(ambientCue('idle', 1, 0, 0)).toBeNull();
  });

  it('walks a whole loop and fires each beat exactly once', () => {
    const fired: string[] = [];
    let prev = 0;
    for (let f = 1; f <= 10; f++) {
      const frame = f % 10;
      const cue = ambientCue('idle', 10, prev, frame);
      if (cue) fired.push(`${frame}:${cue}`);
      prev = frame;
    }
    expect(fired).toEqual(['5:ember', '7:smoke']);
  });
});
