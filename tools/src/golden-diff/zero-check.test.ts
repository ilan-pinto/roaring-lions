import { describe, expect, it } from 'vitest';
import { evaluateLayerCheck, type LayerCheckSpec } from './baseline';
import type { DiffSummary } from './diff';

const summary = (over: Partial<DiffSummary>): DiffSummary =>
  ({ diffPixels: 0, changedPixels: 0, meanAbsChannelDelta: 0, ...over }) as DiffSummary;
const ZERO: LayerCheckSpec = { kind: 'zero', layer: 'bloom', minMeanAbsChannelDelta: 0, minDiffPixels: 0, rationale: 'test' };
const FLOOR: LayerCheckSpec = { layer: 'bloom', minMeanAbsChannelDelta: 0.1, minDiffPixels: 10, rationale: 'test' };

describe('the zero check kind (GH-943 P1)', () => {
  it('passes only on an exactly unchanged frame', () => {
    expect(evaluateLayerCheck(summary({}), ZERO).ok).toBe(true);
  });
  it.each([
    ['one exactly-changed pixel', { changedPixels: 1 }],
    ['a perceptual pixel', { diffPixels: 1 }],
    ['a sub-display mean', { meanAbsChannelDelta: 0.00001 }],
  ])('fails on %s', (_n, over) => {
    expect(evaluateLayerCheck(summary(over), ZERO).ok).toBe(false);
  });
  it('is not the floor check: a floor check passes a moved frame and fails an unchanged one', () => {
    expect(evaluateLayerCheck(summary({ diffPixels: 50, meanAbsChannelDelta: 1 }), FLOOR).ok).toBe(true);
    expect(evaluateLayerCheck(summary({}), FLOOR).ok).toBe(false);
  });
});
