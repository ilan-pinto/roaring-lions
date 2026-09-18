import { describe, expect, it } from 'vitest';
import { paletteColor, paletteTeamColors, variantAwareResolver } from './index';

// Task 12 fix round 1: `variantAwareResolver` is what closes the gap
// `paletteTeamColors` alone left open -- most of the renderer's team-coloured
// draws (the occlusion silhouette, the HP bar, the objective-zone tint, the
// min-range ring) ask `resolveColor('team.hostile')` by STRING KEY rather
// than reading the `teamColors` tuple, so `main.ts` passing plain
// `paletteColor` as `resolveColor` left every one of them on the default
// palette regardless of the player's setting. These two functions read the
// same palette entry (`teamColorsFor`, index.ts), so a mismatch between them
// is not expressible.
describe('paletteTeamColors', () => {
  it('default returns the plain reserved.team.colors triple', () => {
    expect(paletteTeamColors('default')).toEqual([
      paletteColor('team.kedem'),
      paletteColor('team.hostile'),
      paletteColor('team.neutral'),
    ]);
  });

  it('deuteranopia returns the variant triple, distinct from default', () => {
    const [kedem, hostile, neutral] = paletteTeamColors('deuteranopia');
    expect(kedem).toBe('#0072B2');
    expect(hostile).toBe('#D55E00');
    expect(neutral).toBe('#F0E442');
  });
});

describe('variantAwareResolver', () => {
  it("deuteranopia routes every team.* key through the variant's own entry", () => {
    const resolve = variantAwareResolver('deuteranopia');
    expect(resolve('team.kedem')).toBe('#0072B2');
    expect(resolve('team.hostile')).toBe('#D55E00');
    expect(resolve('team.neutral')).toBe('#F0E442');
    expect(resolve('team.hostile_text')).toBe('#F2A15C');
  });

  it('leaves every non-team key on the plain palette, unaffected by the variant', () => {
    const resolve = variantAwareResolver('deuteranopia');
    expect(resolve('vfx.tracer')).toBe(paletteColor('vfx.tracer'));
    expect(resolve('shadow.1')).toBe(paletteColor('shadow.1'));
    expect(resolve('dust.0')).toBe(paletteColor('dust.0'));
  });

  it('default resolves all four team.* keys identically to paletteColor', () => {
    const resolve = variantAwareResolver('default');
    for (const key of ['team.kedem', 'team.hostile', 'team.neutral', 'team.hostile_text']) {
      expect(resolve(key)).toBe(paletteColor(key));
    }
  });
});

// Minor 18 (final review): `teamColorsFor` indexed `team.variants[variant]`
// and the caller then read `.kedem` off the result. That is an index into JSON
// on disk, not into a type -- a variant the palette has not grown yet reads
// `undefined` and the read throws. Unreachable through the typed path today,
// which is why the cast is deliberate here: the point is what happens when the
// union and the file part company, and the only way to ask that question is to
// widen past the union the way a stale palette would.
describe('an unknown colour-vision variant', () => {
  it('falls back to the default team colours instead of throwing', () => {
    const unknown = 'monochromacy' as Parameters<typeof paletteTeamColors>[0];
    expect(() => paletteTeamColors(unknown)).not.toThrow();
    expect(paletteTeamColors(unknown)).toEqual(paletteTeamColors('default'));
    const resolve = variantAwareResolver(unknown);
    for (const key of ['team.kedem', 'team.hostile', 'team.neutral', 'team.hostile_text']) {
      expect(resolve(key)).toBe(paletteColor(key));
    }
  });
});
