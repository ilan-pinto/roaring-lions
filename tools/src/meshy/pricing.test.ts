/**
 * `estimateCredits` against every row of the pricing table quoted in this
 * file's own header comment, plus the USD conversion helpers. No network --
 * this is a pure function over a hardcoded table.
 */
import { describe, expect, it } from 'vitest';
import type { ModelType, TextureResolution } from './options';
import { DEFAULT_USD_PER_CREDIT, estimateCredits, estimateUsd, formatUsd, PRICING, resolveUsdPerCredit } from './pricing';

describe('estimateCredits', () => {
  describe('text-preview', () => {
    it('is 20 for standard, any ai_model', () => {
      expect(estimateCredits('text-preview', { modelType: 'standard' })).toBe(20);
    });
    it('is 20 for lowpoly', () => {
      expect(estimateCredits('text-preview', { modelType: 'lowpoly' })).toBe(20);
    });
    it('is 5 for smart-topology', () => {
      expect(estimateCredits('text-preview', { modelType: 'smart-topology' })).toBe(5);
    });
    it('adds 5 for ultra_mode on standard', () => {
      expect(estimateCredits('text-preview', { modelType: 'standard', ultra: true })).toBe(25);
    });
    it('adds 5 for ultra_mode on lowpoly', () => {
      expect(estimateCredits('text-preview', { modelType: 'lowpoly', ultra: true })).toBe(25);
    });
    it('does not add the ultra surcharge to smart-topology', () => {
      expect(estimateCredits('text-preview', { modelType: 'smart-topology', ultra: true })).toBe(5);
    });
    it('defaults to the standard rate when no modelType is given', () => {
      expect(estimateCredits('text-preview', {})).toBe(20);
    });
  });

  describe('text-refine', () => {
    it('is 10 at 2k', () => {
      expect(estimateCredits('text-refine', { textureResolution: '2k' })).toBe(10);
    });
    it('is 10 at 4k', () => {
      expect(estimateCredits('text-refine', { textureResolution: '4k' })).toBe(10);
    });
    it('is 15 at 8k', () => {
      expect(estimateCredits('text-refine', { textureResolution: '8k' })).toBe(15);
    });
  });

  describe('image', () => {
    it('is 20 without texture, standard', () => {
      expect(estimateCredits('image', { modelType: 'standard', shouldTexture: false })).toBe(20);
    });
    it('is 30 with texture (non-8k), standard', () => {
      expect(estimateCredits('image', { modelType: 'standard', shouldTexture: true, textureResolution: '2k' })).toBe(30);
      expect(estimateCredits('image', { modelType: 'standard', shouldTexture: true, textureResolution: '4k' })).toBe(30);
    });
    it('is 35 with texture at 8k, standard', () => {
      expect(estimateCredits('image', { modelType: 'standard', shouldTexture: true, textureResolution: '8k' })).toBe(35);
    });
    it('should_texture defaults to true, per the API contract', () => {
      expect(estimateCredits('image', { modelType: 'standard' })).toBe(30);
    });
    it('adds 5 for ultra on every standard tier', () => {
      expect(estimateCredits('image', { modelType: 'standard', shouldTexture: false, ultra: true })).toBe(25);
      expect(estimateCredits('image', { modelType: 'standard', shouldTexture: true, textureResolution: '2k', ultra: true })).toBe(35);
      expect(estimateCredits('image', { modelType: 'standard', shouldTexture: true, textureResolution: '8k', ultra: true })).toBe(40);
    });
    it('smart-topology is 5 / 15 / 20', () => {
      expect(estimateCredits('image', { modelType: 'smart-topology', shouldTexture: false })).toBe(5);
      expect(estimateCredits('image', { modelType: 'smart-topology', shouldTexture: true, textureResolution: '4k' })).toBe(15);
      expect(estimateCredits('image', { modelType: 'smart-topology', shouldTexture: true, textureResolution: '8k' })).toBe(20);
    });

    // Important 2 (review): https://docs.meshy.ai/en/api/pricing (checked
    // 2026-09-18) documents the +5 ultra surcharge only under each section's
    // "Meshy-7 models" row and never mentions it under "Smart Topology
    // (Meshy T2) models" in EITHER section -- so it does not explicitly say
    // whether image-to-3d's smart-topology tier takes the surcharge. This
    // pins the current, deliberately conservative (over-estimating) choice:
    // apply it unconditionally, same as every other image tier. See the
    // comment beside this branch in pricing.ts for the full citation: if
    // that comment's reasoning changes, this literal must change with it.
    it('adds the ultra surcharge to smart-topology too (kept as the safe over-estimate; see pricing.ts)', () => {
      expect(estimateCredits('image', { modelType: 'smart-topology', shouldTexture: false, ultra: true })).toBe(10);
      expect(estimateCredits('image', { modelType: 'smart-topology', shouldTexture: true, textureResolution: '4k', ultra: true })).toBe(20);
      expect(estimateCredits('image', { modelType: 'smart-topology', shouldTexture: true, textureResolution: '8k', ultra: true })).toBe(25);
    });
  });

  it('remesh is a flat 5', () => {
    expect(estimateCredits('remesh')).toBe(5);
  });

  describe('retexture', () => {
    it('is 10 at 2k/4k, 15 at 8k', () => {
      expect(estimateCredits('retexture', { textureResolution: '2k' })).toBe(10);
      expect(estimateCredits('retexture', { textureResolution: '4k' })).toBe(10);
      expect(estimateCredits('retexture', { textureResolution: '8k' })).toBe(15);
    });
  });

  it('rigging is a flat 5', () => {
    expect(estimateCredits('rigging')).toBe(5);
  });

  describe('animation', () => {
    it('is 3 per action, defaulting to 1 action', () => {
      expect(estimateCredits('animation')).toBe(3);
      expect(estimateCredits('animation', { actions: 4 })).toBe(12);
    });
  });

  // Minor 1 (review): the old version of this test only checked that
  // Object.values(PRICING) were positive numbers -- true of any pricing
  // table and blind to a row nothing ever reads. This sweeps the real input
  // space of every `EstimateKind` through the real `estimateCredits` and
  // diffs the achievable numbers against PRICING itself, so a row with no
  // reachable branch (or a surcharge that stops being added) goes red here.
  //
  // A "flat" row (remesh, rigging, a resolution tier, ...) must appear
  // verbatim among the swept RETURN values. `ultra_mode` never appears
  // alone -- it is always added to a base -- so it is checked as the
  // difference between two calls that differ ONLY in `ultra`, holding every
  // other parameter fixed (`ultraDeltas`), rather than as a difference
  // between any two arbitrary swept numbers: an all-pairs diff of a dozen
  // values from 3 to 40 turns out to cover nearly every integer up to ~32
  // by sheer arithmetic coincidence (falsified by hand -- a deliberately
  // unreachable orphan row of 17 still read "achievable" under that
  // version), which would have made the check nearly impossible to fail.
  it('every PRICING row is achievable from a full sweep of estimateCredits: a flat row verbatim, ultra_mode as an isolated delta', () => {
    const MODEL_TYPES: readonly ModelType[] = ['standard', 'lowpoly', 'smart-topology'];
    const TEXTURE_RESOLUTIONS: readonly TextureResolution[] = ['2k', '4k', '8k'];
    const BOOLS = [false, true] as const;

    const returned = new Set<number>();
    const ultraDeltas = new Set<number>();

    for (const modelType of MODEL_TYPES) {
      const withUltra = estimateCredits('text-preview', { modelType, ultra: true });
      const withoutUltra = estimateCredits('text-preview', { modelType, ultra: false });
      returned.add(withUltra).add(withoutUltra);
      ultraDeltas.add(Math.abs(withUltra - withoutUltra));
    }
    for (const textureResolution of TEXTURE_RESOLUTIONS) {
      returned.add(estimateCredits('text-refine', { textureResolution }));
    }
    for (const modelType of MODEL_TYPES) {
      for (const shouldTexture of BOOLS) {
        for (const textureResolution of TEXTURE_RESOLUTIONS) {
          const withUltra = estimateCredits('image', { modelType, shouldTexture, textureResolution, ultra: true });
          const withoutUltra = estimateCredits('image', { modelType, shouldTexture, textureResolution, ultra: false });
          returned.add(withUltra).add(withoutUltra);
          ultraDeltas.add(Math.abs(withUltra - withoutUltra));
        }
      }
    }
    returned.add(estimateCredits('remesh'));
    for (const textureResolution of TEXTURE_RESOLUTIONS) returned.add(estimateCredits('retexture', { textureResolution }));
    returned.add(estimateCredits('rigging'));
    for (let actions = 1; actions <= 5; actions++) returned.add(estimateCredits('animation', { actions }));

    const achievable = new Set([...returned, ...ultraDeltas]);
    const unreachable = Object.entries(PRICING).filter(([, value]) => !achievable.has(value));
    expect(unreachable).toEqual([]);
  });
});

describe('resolveUsdPerCredit', () => {
  it('falls back to the documented default with no override', () => {
    expect(resolveUsdPerCredit({})).toBe(DEFAULT_USD_PER_CREDIT);
  });

  it('reads MESHY_USD_PER_CREDIT when present and valid', () => {
    expect(resolveUsdPerCredit({ MESHY_USD_PER_CREDIT: '0.05' })).toBe(0.05);
  });

  it('falls back on an unparsable or non-positive override', () => {
    expect(resolveUsdPerCredit({ MESHY_USD_PER_CREDIT: 'not-a-number' })).toBe(DEFAULT_USD_PER_CREDIT);
    expect(resolveUsdPerCredit({ MESHY_USD_PER_CREDIT: '0' })).toBe(DEFAULT_USD_PER_CREDIT);
    expect(resolveUsdPerCredit({ MESHY_USD_PER_CREDIT: '-1' })).toBe(DEFAULT_USD_PER_CREDIT);
  });
});

describe('estimateUsd / formatUsd', () => {
  it('multiplies credits by the rate', () => {
    expect(estimateUsd(100, 0.02)).toBeCloseTo(2, 10);
  });

  it('formats to two decimal places with a dollar sign', () => {
    expect(formatUsd(0.4)).toBe('$0.40');
    expect(formatUsd(1)).toBe('$1.00');
    expect(formatUsd(12.345)).toBe('$12.35');
  });
});
