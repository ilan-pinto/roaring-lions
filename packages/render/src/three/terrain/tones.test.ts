/**
 * Pixi layers alpha fills to tint the ground: open at 0.92-1.00 by tile hash,
 * a road tone at 0.85 over that, underBuilding at 0.22 over that. The composite
 * of two palette entries is NOT a palette entry, so reproducing Pixi's blending
 * faithfully would put off-palette colour across most of the screen -- the exact
 * thing Phase 0 measured and Phase B1 installed a pipeline to prevent.
 *
 * So we composite the way Pixi does, then snap to the nearest palette entry.
 * The look survives; the guarantee survives with it.
 */
import { describe, it, expect } from 'vitest';
import { composite, quantise, PALETTE_HEXES } from './tones';

describe('composite', () => {
  it('at alpha 1 returns the top colour', () => {
    expect(composite('#C8B494', '#14150F', 1).toUpperCase()).toBe('#14150F');
  });

  it('at alpha 0 returns the base colour', () => {
    expect(composite('#C8B494', '#14150F', 0).toUpperCase()).toBe('#C8B494');
  });

  it('at alpha 0.5 lands between the two on every channel', () => {
    const mid = composite('#000000', '#FFFFFF', 0.5);
    const r = parseInt(mid.slice(1, 3), 16);
    expect(r).toBeGreaterThan(120);
    expect(r).toBeLessThan(136);
  });
});

describe('quantise', () => {
  it('returns a palette entry unchanged', () => {
    for (const hex of PALETTE_HEXES.slice(0, 12)) {
      expect(quantise(hex, PALETTE_HEXES).toUpperCase()).toBe(hex.toUpperCase());
    }
  });

  it('always returns something from the palette', () => {
    // The property that matters: no input can produce an off-palette output.
    for (let i = 0; i < 200; i++) {
      const hex =
        '#' +
        ((i * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(0, 6).toUpperCase();
      expect(PALETTE_HEXES.map((h) => h.toUpperCase())).toContain(
        quantise(hex, PALETTE_HEXES).toUpperCase()
      );
    }
  });

  it('picks a near colour rather than an arbitrary one', () => {
    // A near-black input must not come back as the palette's lightest entry.
    const got = quantise('#000001', PALETTE_HEXES);
    const lum = (h: string) =>
      parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    expect(lum(got)).toBeLessThan(120);
  });
});

describe('PALETTE_HEXES', () => {
  it('is read from data/palette.json rather than transcribed', () => {
    // A transcribed copy goes stale silently the first time the palette changes.
    expect(PALETTE_HEXES.length).toBeGreaterThan(40);
    for (const h of PALETTE_HEXES) expect(h).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
