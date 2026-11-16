/**
 * GH-1400 (G2): the preset wiring for ragdolls and soft particles, prepared and left dark (`preset-live.ts`).
 *
 * The OFF half pins the resolved presets against LITERALS recorded from origin/main (af37b20, 16 Nov 2026) before this change,
 * never against `QUALITY_PRESETS` read back. The ON half pins the lead's caps (rulings of 16 Nov 2026): ragdolls high 16 / medium 8 /
 * low 0, soft particles on `high` only. Each check was run red once by a one-line mutation of the implementation (commit message).
 */
import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS, type RenderQuality } from '../quality';
import {
  PRESET_SWITCHES,
  RAGDOLL_PRESETS_LIVE,
  RAGDOLL_PRESET_CAPS,
  SOFT_PARTICLES_PRESETS,
  SOFT_PARTICLES_PRESET_LIVE,
  liveQuality,
  liveRendererOptions,
  menuRendererOptions,
  presetTierOf,
  type PresetSwitches,
} from './preset-live';

/** The three presets as origin/main shipped them (16 Nov 2026), copied by hand. */
const MAIN: Record<'low' | 'medium' | 'high', RenderQuality> = {
  low: { grade: false, ao: false, smaa: false, shadowMapSize: 1024, bloom: 'off', shadowFit: 'view', fxDetail: 0, rain: { drops: 525, ripples: false, ground: 'minimal' }, nature: { slots: 8, wakes: false, foot: false }, debris: { pool: 0, shadows: false }, grass: 'off', groundBlend: 'tone', physics: { ragdolls: 0 } },
  medium: { grade: true, ao: false, smaa: true, shadowMapSize: 2048, bloom: 'off', shadowFit: 'view', fxDetail: 1, rain: { drops: 3500, ripples: true, ground: 'lite' }, nature: { slots: 16, wakes: true, foot: false }, debris: { pool: 512, shadows: false }, grass: 'coarse', groundBlend: 'full', physics: { ragdolls: 0 } },
  high: {
    grade: true,
    ao: true,
    smaa: true,
    shadowMapSize: 4096,
    bloom: 'quarter',
    shadowFit: 'view',
    aoScale: 0.25,
    fxDetail: 1,
    smokeBillboardGain: 0.8,
    rain: { drops: 6000, ripples: true, ground: 'full' },
    nature: { slots: 24, wakes: true, foot: true },
    physics: { ragdolls: 0 },
    debris: { pool: 1024, shadows: true },
    grass: 'full',
    groundBlend: 'full',
  },
};

const TIERS = ['low', 'medium', 'high'] as const;
const ON: PresetSwitches = { ragdolls: true, softParticles: true };
const RAGDOLLS_ONLY: PresetSwitches = { ragdolls: true, softParticles: false };
const SOFT_ONLY: PresetSwitches = { ragdolls: false, softParticles: true };

describe('GH-1400: both switches ship OFF', () => {
  it('the two constants are false, and the renderer reads exactly them', () => {
    // Falsify: `RAGDOLL_PRESETS_LIVE: boolean = true` (or the soft one) in preset-live.ts.
    expect(RAGDOLL_PRESETS_LIVE).toBe(false);
    expect(SOFT_PARTICLES_PRESET_LIVE).toBe(false);
    expect(PRESET_SWITCHES).toEqual({ ragdolls: false, softParticles: false });
  });

  it('with the switches off, every resolved preset is the very object and deep-equals what main shipped', () => {
    // Falsify: `ragdolls: true` in place of `ragdolls: RAGDOLL_PRESETS_LIVE` in PRESET_SWITCHES (high and medium move).
    for (const t of TIERS) {
      const q = liveQuality(QUALITY_PRESETS[t], PRESET_SWITCHES);
      expect(q, t).toBe(QUALITY_PRESETS[t]);
      expect(q, t).toEqual(MAIN[t]);
      const opts = { quality: QUALITY_PRESETS[t] };
      // Falsify: liveRendererOptions always copying (`return { ...opts, quality }`), or menuRendererOptions ignoring the switch.
      expect(liveRendererOptions(opts, PRESET_SWITCHES), t).toBe(opts);
      expect(menuRendererOptions(opts, PRESET_SWITCHES), t).toBe(opts);
    }
  });

  it('with the switches off, a sandbox copy and no quality at all are untouched too', () => {
    const soft = { ...QUALITY_PRESETS.high, softParticles: true };
    const showcase = { ...QUALITY_PRESETS.low, physics: { ragdolls: 16 as const } };
    expect(liveQuality(soft, PRESET_SWITCHES)).toBe(soft);
    expect(liveQuality(showcase, PRESET_SWITCHES)).toBe(showcase);
    expect(liveQuality(undefined, PRESET_SWITCHES)).toBeUndefined();
  });
});

describe('GH-1400: the lead caps, with the switches ON', () => {
  it('ragdolls: high 16, medium 8, low 0 (and low is the very object: nothing for the renderer to fetch)', () => {
    // Falsify: `medium: 8` -> `medium: 4` in RAGDOLL_PRESET_CAPS; or `RAGDOLL_PRESET_CAPS[tier]` -> `RAGDOLL_PRESET_CAPS.high` in liveQuality.
    expect(liveQuality(QUALITY_PRESETS.high, RAGDOLLS_ONLY)?.physics).toEqual({ ragdolls: 16 });
    expect(liveQuality(QUALITY_PRESETS.medium, RAGDOLLS_ONLY)?.physics).toEqual({ ragdolls: 8 });
    expect(liveQuality(QUALITY_PRESETS.low, RAGDOLLS_ONLY)).toBe(QUALITY_PRESETS.low);
    expect(liveQuality(QUALITY_PRESETS.low, ON)?.physics).toEqual({ ragdolls: 0 });
    expect(RAGDOLL_PRESET_CAPS).toEqual({ low: 0, medium: 8, high: 16 });
  });

  it('soft particles: high only', () => {
    // Falsify: `medium: false` -> `medium: true` in SOFT_PARTICLES_PRESETS.
    expect(liveQuality(QUALITY_PRESETS.high, SOFT_ONLY)?.softParticles).toBe(true);
    expect(liveQuality(QUALITY_PRESETS.medium, SOFT_ONLY)).toBe(QUALITY_PRESETS.medium);
    expect(liveQuality(QUALITY_PRESETS.low, SOFT_ONLY)).toBe(QUALITY_PRESETS.low);
    for (const t of TIERS) expect(liveQuality(QUALITY_PRESETS[t], ON)?.softParticles === true, t).toBe(t === 'high');
    expect(SOFT_PARTICLES_PRESETS).toEqual({ low: false, medium: false, high: true });
  });

  it('each switch moves only its own field: everything else is still what main shipped', () => {
    // Falsify: `RAGDOLL_PRESET_CAPS[tier]` -> `RAGDOLL_PRESET_CAPS.high`, or `medium: true` in SOFT_PARTICLES_PRESETS.
    expect(liveQuality(QUALITY_PRESETS.high, ON)).toEqual({ ...MAIN.high, physics: { ragdolls: 16 }, softParticles: true });
    expect(liveQuality(QUALITY_PRESETS.medium, ON)).toEqual({ ...MAIN.medium, physics: { ragdolls: 8 } });
    expect(liveQuality(QUALITY_PRESETS.high, RAGDOLLS_ONLY)).toEqual({ ...MAIN.high, physics: { ragdolls: 16 } });
    expect(liveQuality(QUALITY_PRESETS.high, SOFT_ONLY)).toEqual({ ...MAIN.high, softParticles: true });
    // The table itself is never written.
    for (const t of TIERS) expect(QUALITY_PRESETS[t], t).toEqual(MAIN[t]);
  });

  it('an explicit opinion wins: the `&ragdoll` showcase, the `&soft` look and the menu keep what they say', () => {
    // Falsify: drop `&& q.physics === preset.physics` (the menu's explicit 0 on medium is raised to 8).
    const showcaseLow = { ...QUALITY_PRESETS.low, physics: { ragdolls: 16 as const } };
    expect(liveQuality(showcaseLow, ON)?.physics).toEqual({ ragdolls: 16 });
    const menu = menuRendererOptions({ quality: QUALITY_PRESETS.medium }, ON);
    expect(menu.quality?.physics).toEqual({ ragdolls: 0 });
    expect(liveRendererOptions(menu, ON).quality?.physics).toEqual({ ragdolls: 0 });
    // `&soft` on medium stays on (it is the sandbox's A/B), and a high copy with `&soft` still gets high's ragdolls.
    expect(liveQuality({ ...QUALITY_PRESETS.medium, softParticles: true }, ON)?.softParticles).toBe(true);
    expect(liveQuality({ ...QUALITY_PRESETS.high, softParticles: true }, ON)?.physics).toEqual({ ragdolls: 16 });
    // An explicit `false` is an opinion too. Falsify: drop `&& q.softParticles === undefined`.
    expect(liveQuality({ ...QUALITY_PRESETS.high, softParticles: false }, SOFT_ONLY)?.softParticles).toBe(false);
  });

  it('a quality that is no preset (a test fake, a hand-built one) and no quality keep exactly what they say', () => {
    // Falsify: presetTierOf's last line `return 'high'`; or skip `shadowMapSize` in its field comparison.
    const fake: RenderQuality = { ...QUALITY_PRESETS.high, shadowMapSize: 2048 };
    expect(presetTierOf(fake)).toBeNull();
    expect(liveQuality(fake, ON)).toBe(fake);
    expect(liveQuality(undefined, ON)).toBeUndefined();
    const deep: RenderQuality = { ...QUALITY_PRESETS.high, rain: { drops: 6000, ripples: true, ground: 'full' } };
    expect(presetTierOf(deep)).toBeNull();
    for (const t of TIERS) expect(presetTierOf(QUALITY_PRESETS[t]), t).toBe(t);
    expect(presetTierOf({ ...QUALITY_PRESETS.medium, softParticles: true })).toBe('medium');
  });
});
