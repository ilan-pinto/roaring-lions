/**
 * VR-08: a palette hex that render code needs before `resolveColor` exists is
 * READ from `data/palette.json`, never restated. The proof is behavioural: swap
 * the palette for one with every hex inverted, re-import each module, and
 * require its fallback constant to be the inverted entry of its own key. A
 * constant that goes back to a literal keeps its old hex and fails here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import realPalette from '../../../../data/palette.json';
import { paletteHex } from './palette-hex';

const invert = (hex: string): string => '#' + [1, 3, 5].map((i) => (255 - parseInt(hex.slice(i, i + 2), 16)).toString(16).padStart(2, '0')).join('').toUpperCase();
const invertTree = (v: unknown): unknown =>
  typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v)
    ? invert(v)
    : Array.isArray(v)
      ? v.map(invertTree)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, invertTree(x)]))
        : v;

describe('paletteHex', () => {
  it('returns the palette entry exactly as the JSON spells it', () => {
    expect(paletteHex('limestone.0')).toBe(realPalette.ramps.limestone.colors[0]);
    expect(paletteHex('team.hostile')).toBe(realPalette.reserved.team.colors.hostile);
    expect(paletteHex('vfx.tracer')).toBe(realPalette.reserved.vfx.colors.tracer);
  });

  it('throws on a key the palette does not hold, rather than inventing a colour', () => {
    expect(() => paletteHex('limestone.99')).toThrow(/no palette entry/);
    expect(() => paletteHex('nosuchramp.0')).toThrow(/no palette entry/);
    expect(() => paletteHex('vfx.nosuch')).toThrow(/no palette entry/);
  });
});

describe('render fallbacks follow a palette revision', () => {
  afterEach(() => {
    vi.doUnmock('../../../../data/palette.json');
    vi.resetModules();
  });

  // [module, export, the palette key that constant stands for]
  const CASES: ReadonlyArray<readonly [string, string, string]> = [
    ['./lighting', 'SUN_COLOR_HEX', 'limestone.0'],
    ['./lighting', 'SKY_COLOR_HEX', 'water.0'],
    ['./lighting', 'GROUND_BOUNCE_COLOR_HEX', 'dust.4'],
    ['./fog-pass', 'FOG_TINT_HEX', 'shadow.1'],
    ['./smoke-mesh', 'SMOKE_COLOR', 'gunmetal.0'],
    ['./units/overlays', 'WORLD_HALO_FALLBACK', 'shadow.1'],
    ['./units/overlays', 'OBJECTIVE_ZONE_HALO_FALLBACK', 'shadow.1'],
    ['./units/overlays', 'FIREPOWER_KILL_FALLBACK_COLOR', 'terracotta.2'],
    ['./units/overlays', 'CHARGE_RING_FILL_FALLBACK_COLOR', 'vfx.ember'],
    ['./units/overlays', 'REFUGE_RING_FALLBACK_COLOR', 'scrub.0'],
    ['./units/overlays', 'REFUGE_RING_EDGE_FALLBACK_COLOR', 'shadow.1'],
  ];

  it('every fallback constant is the (inverted) entry of its own key', async () => {
    vi.resetModules();
    vi.doMock('../../../../data/palette.json', () => ({ default: invertTree(realPalette) }));
    for (const [mod, name, key] of CASES) {
      const m = (await import(/* @vite-ignore */ mod)) as Record<string, unknown>;
      expect(m[name], `${mod} ${name}`).toBe(invert(paletteHex(key)));
    }
  });

  it('the preset and side tables follow too', async () => {
    vi.resetModules();
    vi.doMock('../../../../data/palette.json', () => ({ default: invertTree(realPalette) }));
    const tod = await import('./time-of-day');
    for (const preset of Object.values(tod.TIME_OF_DAY_PRESETS)) {
      expect(preset.sunFallback).toBe(invert(paletteHex(preset.sunKey)));
      expect(preset.skyFallback).toBe(invert(paletteHex(preset.skyKey)));
    }
    const sil = await import('./units/silhouette');
    expect([...sil.SILHOUETTE_FALLBACK_HEX_BY_SIDE]).toEqual(['team.kedem', 'team.hostile', 'team.neutral'].map((k) => invert(paletteHex(k))));
    const ov = await import('./units/overlays');
    expect(ov.objectiveZoneFallbackColor('contested')).toBe(invert(paletteHex('team.hostile')));
    expect(ov.objectiveZoneFallbackColor('unheld')).toBe(invert(paletteHex('team.neutral')));
    expect(ov.objectiveZoneFallbackColor('held')).toBe(invert(paletteHex('vfx.tracer')));
  });
});
