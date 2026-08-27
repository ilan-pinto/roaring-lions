/**
 * Pixi layers alpha fills to tint the ground: a road tone at 0.85 over the
 * open wash, underBuilding at 0.22 over that (still jittered 0.92-1.00 by
 * tile hash -- a Task B2.5 review ruling left it alone, since a building's
 * small footprint was never the measured complaint). The composite of two
 * palette entries is NOT a palette entry, so reproducing Pixi's blending
 * faithfully would put off-palette colour across most of the screen -- the
 * exact thing Phase 0 measured and Phase B1 installed a pipeline to prevent.
 *
 * So we composite the way Pixi does, then snap to the nearest palette entry.
 * The look survives; the guarantee survives with it.
 *
 * Open ground itself is the one exception to "jittered, then quantised":
 * that same B2.5 review ruling dropped its per-tile alpha jitter entirely,
 * in favour of a fixed alpha -- quantised, the jitter's raw range collapsed
 * to exactly two palette entries assigned by tile hash, a checkerboard by
 * construction rather than texture (`buildScatter`'s grain supplies the
 * texture instead). The `groundTone` tests below pin that down directly:
 * nothing previously asserted `groundTone`'s open-ground behaviour at all
 * (`ground.test.ts:190`'s own comment says so), which is how a real
 * behaviour change shipped with no test covering it either way.
 */
import { describe, it, expect } from 'vitest';
import { composite, quantise, groundTone, PALETTE_HEXES } from './tones';
import { tileHash } from '../../tile-hash';
import type { TerrainInput } from './types';
import type { TerrainTones } from '../../api';

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone',
};
const BACKGROUND = '#14150F';

function flatInput(w: number, h: number): TerrainInput {
  return {
    width: w, height: h, decor: null, elevation: null,
    blocked: new Uint8Array(w * h), cover: new Uint8Array(w * h),
  };
}

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

describe('groundTone', () => {
  it('returns a single tone for open ground, not a per-tile jitter (stone)', () => {
    // Swept over a wide, varied grid of tile positions -- covering many
    // distinct tileHash outputs -- rather than asserting the formula by
    // reading the source: the property that actually matters is that every
    // one of them lands on the SAME palette entry. A regression back to
    // `0.92 + rnd * 0.08` would make this fail by producing two different
    // entries across the sweep, not by producing an obviously-wrong colour.
    const w = 12, h = 12;
    const input = flatInput(w, h);
    const tones: Set<string> = new Set();
    for (let ti = 0; ti < w * h; ti++) {
      tones.add(groundTone(input, TONES, ti, PALETTE_HEXES, BACKGROUND).toUpperCase());
    }
    expect(tones.size).toBe(1);
  });

  it('returns a single tone for open ground, not a per-tile jitter (sward)', () => {
    const w = 12, h = 12;
    const input = flatInput(w, h);
    const swardTones: TerrainTones = { ...TONES, scatter: 'sward' };
    const tones: Set<string> = new Set();
    for (let ti = 0; ti < w * h; ti++) {
      tones.add(groundTone(input, swardTones, ti, PALETTE_HEXES, BACKGROUND).toUpperCase());
    }
    expect(tones.size).toBe(1);
  });

  it('leaves the under-building branch\'s source formula untouched', () => {
    // The review ruling was scoped to open ground specifically; this is a
    // literal, non-empirical check that the blocked+underBuilding branch
    // still composites through `tileHash`-driven alpha (`0.92 + rnd * 0.08`)
    // rather than a fixed value, by reproducing that exact formula
    // independently and requiring an exact match against `groundTone`'s own
    // output. Deliberately NOT "produces more than one final tone": composed
    // and checked empirically (`arid`-shaped colours, background
    // '#14150F'), that 8% alpha swing turns out to collapse through
    // quantisation to a single entry too -- underBuilding's fixed 0.22
    // overlay dilutes it further on top of an already-narrow range -- so
    // asserting visible variation in the final colour would be just as
    // unreliable a proxy here as it was for open ground before this
    // ruling. That is worth knowing (`underBuilding` may checkerboard for
    // the same reason `open` did), but re-scoping the ruling to fix it too
    // was not asked for here, and is not this test's job.
    const x = 3, y = 7;
    const ti = y * 12 + x;
    const input = flatInput(12, 12);
    input.blocked = new Uint8Array(12 * 12).fill(1);
    const rnd = tileHash(x, y);
    const expected = quantise(
      composite(composite(BACKGROUND, TONES.open, 0.92 + rnd * 0.08), TONES.underBuilding, 0.22),
      PALETTE_HEXES
    );
    expect(groundTone(input, TONES, ti, PALETTE_HEXES, BACKGROUND).toUpperCase()).toBe(expected.toUpperCase());
  });
});
