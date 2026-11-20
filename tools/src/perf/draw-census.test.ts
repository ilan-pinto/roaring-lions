// The census gate's verdict (GH-1411), on literal reports. The gate's own falsification is a renderer mutation run
// through the CI command (the commit message); these hold the decision logic the mutation goes through.
import { describe, expect, it } from 'vitest';
import { CENSUS_BUDGET, censusRepeatsAgree, censusVerdict, type CensusBudget } from './draw-census';
import type { BackendReport, CheckpointReport } from './three-units';

const BUDGET: CensusBudget = { target: 300, perUnit: 12, tolerance: 0.1, maxEmptyCalls: 150, minLiving: 200 };

const stats = { samples: 1, avgMs: 0, medianMs: 0, p95Ms: 0, maxMs: 0, totalMs: 0 };
function checkpoint(target: number, living: number, calls: number[]): CheckpointReport {
  return { target, livingAtMeasure: living, tickCount: 135, tick: stats, render: null, synced: null, census: { calls, triangles: calls.map(() => 1) } };
}
function report(emptyCalls: number[], at300: number[], living = 250): BackendReport {
  return {
    backend: 'three',
    quality: 'high',
    canvas: { cssWidth: 1280, cssHeight: 720, pixelRatio: 1, bufferWidth: 1280, bufferHeight: 720 },
    emptyCensus: { calls: emptyCalls, triangles: emptyCalls.map(() => 1) },
    checkpoints: [checkpoint(65, 65, [900, 900, 900]), checkpoint(300, living, at300)],
  };
}

describe('censusVerdict', () => {
  it('passes inside the band: (3100 - 100) / 250 = 12 calls a unit', () => {
    const v = censusVerdict(report([100, 100, 100], [3100, 3100, 3100]), BUDGET, []);
    expect(v.kind).toBe('pass');
    if (v.kind === 'pass') expect(v.reading.perUnit).toBe(12);
  });

  it('fails over the band: 13.4 calls a unit against 12 +- 10%', () => {
    // mutation: the `perUnit > hi` branch dropped
    expect(censusVerdict(report([100, 100, 100], [3450, 3450, 3450]), BUDGET, []).kind).toBe('over-budget');
  });

  it('fails UNDER the band, because units that stopped drawing are not a saving', () => {
    // mutation: the `perUnit < lo` branch dropped (an upper-bound-only gate)
    expect(censusVerdict(report([100, 100, 100], [2700, 2700, 2700]), BUDGET, []).kind).toBe('over-budget');
  });

  it('reads per unit over the empty scene: a map that costs 50 more calls everywhere does not move it', () => {
    // mutation: perUnit computed as calls / living (no control)
    expect(censusVerdict(report([140, 140, 140], [3140, 3140, 3140]), BUDGET, []).kind).toBe('pass');
  });

  it('fails an empty scene over its ceiling', () => {
    expect(censusVerdict(report([160, 160, 160], [3160, 3160, 3160]), BUDGET, []).kind).toBe('over-budget');
  });

  it('tolerates the measured frame-to-frame churn (1 call in 1280) and fails a count that moves more than 1%', () => {
    expect(censusVerdict(report([100, 100, 100], [3100, 3101, 3100]), BUDGET, []).kind).toBe('pass');
    expect(censusVerdict(report([100, 100, 100], [3100, 3200, 3100]), BUDGET, []).kind).toBe('instrument');
    expect(censusVerdict(report([100, 98, 100], [3100, 3100, 3100]), BUDGET, []).kind).toBe('instrument');
  });

  it('two pages of the same census must agree to the call, or the count is not reproducible', () => {
    // mutation: censusRepeatsAgree compares only the empty scene, or returns null unconditionally
    const a = report([100, 100, 100], [3100, 3100, 3100]);
    expect(censusRepeatsAgree([a, report([100, 100, 100], [3100, 3100, 3100])], 300)).toBeNull();
    expect(censusRepeatsAgree([a, report([100, 100, 100], [3101, 3100, 3100])], 300)).not.toBeNull();
    expect(censusRepeatsAgree([a, report([101, 101, 101], [3100, 3100, 3100])], 300)).not.toBeNull();
    expect(censusRepeatsAgree([a, report([100, 100, 100], [3100, 3100, 3100], 249)], 300)).not.toBeNull();
    expect(censusRepeatsAgree([a], 300)).toBeNull();
  });

  it('is an instrument failure on a page error (a proxy box is not a shipped unit)', () => {
    const v = censusVerdict(report([100, 100, 100], [3100, 3100, 3100]), BUDGET, ['console.error: mesh failed: x.glb']);
    expect(v.kind).toBe('instrument');
  });

  it('is an instrument failure when the world did not fight, or the checkpoint is missing', () => {
    expect(censusVerdict(report([100, 100, 100], [2500, 2500, 2500], 199), BUDGET, []).kind).toBe('instrument');
    expect(censusVerdict(report([100, 100, 100], [3100, 3100, 3100]), { ...BUDGET, target: 400 }, []).kind).toBe('instrument');
  });

  it('the shipped budget is pinned (no NaN), with a band no wider than +-10%', () => {
    // mutation: CENSUS_BUDGET left at NaN, or the tolerance widened to clear a red run
    expect(Number.isFinite(CENSUS_BUDGET.perUnit)).toBe(true);
    expect(Number.isFinite(CENSUS_BUDGET.maxEmptyCalls)).toBe(true);
    expect(CENSUS_BUDGET.tolerance).toBeLessThanOrEqual(0.1);
    expect(CENSUS_BUDGET.target).toBe(300);
  });
});
