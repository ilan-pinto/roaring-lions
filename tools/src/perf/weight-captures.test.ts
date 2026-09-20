import { describe, expect, it } from 'vitest';
import {
  SAMPLE_MS,
  WEIGHT_PHASES,
  WEIGHT_SUBJECTS,
  framePumps,
  sampleLadder,
  sheetIndex,
} from './weight-captures';

describe('the ten-second ladder', () => {
  // G0 #14's precedent, inherited from the blast: the lead judges this on ten
  // seconds of motion. 200 ms is the step blast-captures.ts settled on and
  // there is no reason to differ -- a start, a stop and a turn all take longer
  // than a fireball, so a coarser step would still catch them and a finer one
  // only costs frames.
  it('covers ten seconds inclusive of both ends, every 200 ms', () => {
    const ladder = sampleLadder(10_000, 200);
    expect(ladder[0]).toBe(0);
    expect(ladder[ladder.length - 1]).toBe(10_000);
    expect(ladder).toHaveLength(51);
    expect(SAMPLE_MS).toEqual(ladder);
  });

  // A standing start is over in well under a second at 1.1 tiles/s, and the
  // pitch it produces is the shortest-lived thing this package draws. A ladder
  // that first samples at 200 ms would photograph the settle and call it the
  // launch.
  it('samples the first half-second at least three times', () => {
    expect(SAMPLE_MS.filter((ms) => ms <= 500).length).toBeGreaterThanOrEqual(3);
  });

  it('refuses a step that does not divide the window, rather than silently truncating', () => {
    expect(() => sampleLadder(10_000, 300)).toThrow(/divide/);
  });
});

describe('the frame pumps inside one tick (R-P)', () => {
  // The whole package lives between ticks. A ladder that only photographs
  // alpha 1 is photographing the one frame per tick where interpolation has
  // nothing left to do, which is exactly the frame `__lions.step` draws by
  // itself -- so it would read identically with the feature and without it.
  it('walks alpha across the tick and ends at 1', () => {
    const alphas = framePumps(50, 16.67);
    expect(alphas.length).toBeGreaterThanOrEqual(3);
    expect(alphas[alphas.length - 1]).toBeCloseTo(1, 6);
    expect(alphas[0]).toBeGreaterThan(0);
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeGreaterThan(alphas[i - 1]);
  });

  it('never hands the renderer a frame delta past the clamp', () => {
    // FRAME_DT_CEILING_MS is 100. A pump longer than that is silently clamped
    // by `frameDtMs`, so the harness would be photographing a different
    // elapsed time from the one it prints.
    expect(framePumps(50, 16.67).length * 16.67).toBeLessThanOrEqual(50 + 16.67);
  });
});

describe('the subject and phase lists', () => {
  // The three motions the issue names, and the three vehicles that bracket the
  // roster: mbt_lavi is the slowest and the slowest-turning (1.1 tiles/s,
  // 60 deg/s), technical the fastest wheeled (2.6, 120), apc_eitan the middle
  // and the one 8-wheeler.
  it('carries a start, a stop and a turn', () => {
    expect([...WEIGHT_PHASES]).toEqual(['start', 'stop', 'turn']);
  });

  it('brackets the roster and gives every subject a distinct id on the open northern band', () => {
    const ids = WEIGHT_SUBJECTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('mbt_lavi');
    expect(ids).toContain('technical');
    // rows 0-7 of beit_sahwan_outskirts are open ground end to end -- the same
    // band wreck-captures.ts and blast-captures.ts parade on.
    for (const s of WEIGHT_SUBJECTS) {
      if (s.map === 'beit_sahwan_outskirts') expect(s.y).toBeLessThanOrEqual(7);
    }
  });

  // beit_sahwan_outskirts declares NO elevation grid, so the terrain-conform
  // half is arithmetically zero there and a sheet shot only on that map cannot
  // show it at all.
  it('shoots the terrain half somewhere with relief', () => {
    expect(WEIGHT_SUBJECTS.some((s) => s.map === 'tel_marum')).toBe(true);
  });
});

describe('sheetIndex', () => {
  // The index is the half of the evidence that survives R-G's git-ignored
  // storage: the PNGs live under .superpowers/ and the NUMBERS get quoted into
  // the task report and the PR body.
  it('names every capture condition, not just the file', () => {
    const md = sheetIndex('before', [
      {
        subject: 'mbt_lavi',
        phase: 'start',
        ms: 200,
        zoom: 2.5,
        tick: 40,
        file: 'a.png',
        offsetTiles: 0,
        pitchDeg: 0,
        rollDeg: 0,
      },
    ]);
    expect(md).toContain('before');
    expect(md).toContain('mbt_lavi');
    expect(md).toContain('start');
    expect(md).toContain('200');
    expect(md).toContain('2.5');
  });

  it('prints the numeric ladder beside the pictures (R-Q)', () => {
    const md = sheetIndex('before', [
      {
        subject: 'mbt_lavi',
        phase: 'start',
        ms: 200,
        zoom: 2.5,
        tick: 40,
        file: 'a.png',
        offsetTiles: 0.031,
        pitchDeg: -1.8,
        rollDeg: 0,
      },
    ]);
    expect(md).toContain('0.031');
    expect(md).toContain('-1.8');
  });
});
