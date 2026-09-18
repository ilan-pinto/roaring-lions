import { describe, it, expect } from 'vitest';
import { QUALITY_PRESETS, type RenderQuality } from './quality';
import { SHADOW_MAP_SIZE } from './three/lighting';
import { AO_RESOLUTION_SCALE } from './three/post-chain';

describe('QUALITY_PRESETS', () => {
  it('pins the three presets exactly', () => {
    // Falsify: flip `low.smaa` to `true` here and this goes red -- which is
    // the whole point of pinning literal values rather than shapes. A test
    // that only checked `typeof preset.smaa === 'boolean'` would pass on any
    // of the eight combinations.
    const expected: Record<'low' | 'medium' | 'high', RenderQuality> = {
      low: { ao: false, smaa: false, shadowMapSize: 1024 },
      medium: { ao: false, smaa: true, shadowMapSize: 2048 },
      high: { ao: true, smaa: true, shadowMapSize: 4096 },
    };
    expect(QUALITY_PRESETS).toEqual(expected);
  });

  it('covers exactly low, medium, high -- no fourth tier, none dropped', () => {
    expect(Object.keys(QUALITY_PRESETS).sort()).toEqual(['high', 'low', 'medium']);
  });

  it('high reaches every player who has never touched the setting, and must equal the pre-preset frame', () => {
    // `DEFAULT_SETTINGS.video.quality` (`packages/app/src/settings.ts`) is
    // `'high'`, and this preset existing must not move that player's frame.
    // The two constants below are the ones the renderer built unconditionally
    // before this file did -- `AO_RESOLUTION_SCALE` at the ambient-occlusion
    // pass's own half-frame resolution, `SHADOW_MAP_SIZE` at the sun's shadow
    // map -- so `high` pinning them is the property the visual gate at High
    // depends on: same deltas, not merely "AO and SMAA both on".
    expect(QUALITY_PRESETS.high.shadowMapSize).toBe(SHADOW_MAP_SIZE);
    expect(QUALITY_PRESETS.high.shadowMapSize).toBe(4096);
    expect(AO_RESOLUTION_SCALE).toBe(0.5);
    expect(QUALITY_PRESETS.high.ao).toBe(true);
    expect(QUALITY_PRESETS.high.smaa).toBe(true);
  });

  it('shadowMapSize halves at each step down, and never exceeds SHADOW_MAP_SIZE', () => {
    expect(QUALITY_PRESETS.low.shadowMapSize).toBe(1024);
    expect(QUALITY_PRESETS.medium.shadowMapSize).toBe(2048);
    expect(QUALITY_PRESETS.high.shadowMapSize).toBeLessThanOrEqual(SHADOW_MAP_SIZE);
  });

  it('low drops both AO and SMAA; medium keeps SMAA and drops only AO', () => {
    expect(QUALITY_PRESETS.low.ao).toBe(false);
    expect(QUALITY_PRESETS.low.smaa).toBe(false);
    expect(QUALITY_PRESETS.medium.ao).toBe(false);
    expect(QUALITY_PRESETS.medium.smaa).toBe(true);
  });
});
