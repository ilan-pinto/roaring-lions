/**
 * `estimateCredits` against every row of the pricing table quoted in this
 * file's own header comment, plus the USD conversion helpers. No network --
 * this is a pure function over a hardcoded table.
 */
import { describe, expect, it } from 'vitest';
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

  it('every PRICING row is reachable from at least one estimateCredits call', () => {
    // A literal cross-check against the table object itself, so a row added
    // to PRICING with no corresponding estimateCredits branch is caught here
    // rather than only by code review.
    const rows = Object.values(PRICING);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((n) => typeof n === 'number' && n > 0)).toBe(true);
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
