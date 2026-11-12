/**
 * GH-1226 S1, gate G2: the height blend's composites must leave the KDF uniform readable (design 2.3; `rts-art-direction`
 * principle 1). Same ruler as `wetland-readability.test.ts` (`delta-e2000.ts`), and like it the oracle takes LITERALS: the
 * uniform's hex, the floors, and every composite's hex as the design prints it. Nothing is read from `height-blend.ts` but the
 * KEYS, which are linked to the literals below by a linear-light mix of `data/palette.json`.
 *
 * The rule: every composite is at least dE2000 15.6 from olive.1, AND its linear luminance is at least 1.3x olive.1's, unless it
 * replaces a ground that is already under 1.3x, in which case it must not be darker than that ground. A composite is judged
 * against what IT replaces: a joint is cut into the exposed rock, not into the open ground.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HEIGHT_BLEND_THEMES } from '../../packages/render/src/three/terrain/height-blend';
import { deltaE2000, linearHex } from './delta-e2000';

const KDF_UNIFORM_HEX = '#6E7449';
const MIN_DE2000 = 15.6;
const MIN_LUMINANCE_RATIO = 1.3;

const Y = (hex: string): number => {
  const [r, g, b] = linearHex(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (hex: string): number => Y(hex) / Y(KDF_UNIFORM_HEX);
const de = (hex: string): number => deltaE2000(linearHex(KDF_UNIFORM_HEX), linearHex(hex));

/** The design's rule. `replaces` is the ground this composite is drawn over. */
function verdict(hex: string, replaces: string): { ok: boolean; why: string[] } {
  const why: string[] = [];
  if (de(hex) < MIN_DE2000) why.push(`dE2000 ${de(hex).toFixed(2)} < ${MIN_DE2000}`);
  if (ratio(hex) < MIN_LUMINANCE_RATIO) {
    if (ratio(replaces) >= MIN_LUMINANCE_RATIO) why.push(`luminance ${ratio(hex).toFixed(2)}x < ${MIN_LUMINANCE_RATIO}x over a ground at ${ratio(replaces).toFixed(2)}x`);
    else if (Y(hex) < Y(replaces)) why.push(`darker than the ${ratio(replaces).toFixed(2)}x ground it replaces`);
  }
  return { ok: why.length === 0, why };
}

interface Composite { readonly name: string; readonly hex: string; readonly replaces: string; readonly passes: boolean }
/** The design's section 2.3 table, as literals. Highland open today is dust.5 (#806032), arid open today limestone.3 (#C8B494). */
const HIGHLAND_OPEN = '#806032';
const ARID_OPEN = '#C8B494';
const HIGHLAND_ROCK = '#A29887';
const COMPOSITES: readonly Composite[] = [
  { name: 'highland exposed rock', hex: HIGHLAND_ROCK, replaces: HIGHLAND_OPEN, passes: true },
  { name: 'highland joint (0.6)', hex: '#A37B6A', replaces: HIGHLAND_ROCK, passes: true },
  { name: 'highland joint at 0.8 (REJECTED)', hex: '#A16853', replaces: HIGHLAND_ROCK, passes: false },
  { name: 'highland hollow', hex: '#8F5931', replaces: HIGHLAND_OPEN, passes: true },
  { name: 'arid exposed rock', hex: '#CDC4B3', replaces: ARID_OPEN, passes: true },
  { name: 'arid loess hollow', hex: '#BFA98A', replaces: ARID_OPEN, passes: true },
];

describe('the height blend leaves the KDF uniform readable (GH-1226 G2)', () => {
  for (const c of COMPOSITES) {
    it(`${c.name} ${c.hex} ${c.passes ? 'passes' : 'FAILS'} the rule`, () => {
      const v = verdict(c.hex, c.replaces);
      expect(v.ok, `${c.name}: ${v.why.join('; ')}`).toBe(c.passes);
    });
  }

  it('the instrument reads the design table: ratios 0.81 / 1.96 / 1.41 / 0.81 / 3.42 / 2.54 and dE2000 15.6 / 19.3 / 24.9 / 23.0 / 29.5 / 24.1', () => {
    expect(ratio(HIGHLAND_OPEN)).toBeCloseTo(0.81, 2);
    expect(ratio('#A29887')).toBeCloseTo(1.96, 2);
    expect(ratio('#A37B6A')).toBeCloseTo(1.41, 2);
    expect(ratio('#8F5931')).toBeCloseTo(0.81, 2);
    expect(ratio('#CDC4B3')).toBeCloseTo(3.42, 2);
    expect(ratio('#BFA98A')).toBeCloseTo(2.54, 2);
    expect(de(HIGHLAND_OPEN)).toBeCloseTo(15.6, 1);
    expect(de('#A29887')).toBeCloseTo(19.3, 1);
    expect(de('#A37B6A')).toBeCloseTo(24.9, 1);
    expect(de('#8F5931')).toBeCloseTo(23.0, 1);
    expect(de('#CDC4B3')).toBeCloseTo(29.5, 1);
    expect(de('#BFA98A')).toBeCloseTo(24.1, 1);
  });

  // The falsifications, as inputs: each is a composite the design refused or would refuse.
  it('REFUSES the joint at amplitude 0.8 (#A16853, 1.11x, cut into 1.96x rock): the design\'s own falsification', () => {
    expect(ratio('#A16853')).toBeCloseTo(1.11, 2);
    const v = verdict('#A16853', HIGHLAND_ROCK);
    expect(v.ok).toBe(false);
    expect(v.why.join(';')).toMatch(/luminance 1\.11x/);
  });
  it('would pass the same joint if it were judged against the open ground (0.81x), which is why the baseline is per composite', () => {
    expect(verdict('#A16853', HIGHLAND_OPEN).ok).toBe(true);
  });
  it('REFUSES a colour that dissolves into the uniform (scrub.0 #6B8A4A, dE2000 9.8)', () => {
    expect(verdict('#6B8A4A', ARID_OPEN).ok).toBe(false);
    expect(verdict('#6B8A4A', ARID_OPEN).why.join(';')).toMatch(/dE2000 9\.8/);
  });
  it('REFUSES a hollow darker than the ground it replaces (dust.6 #6B4F29 over dust.5), though both are under 1.3x', () => {
    const v = verdict('#6B4F29', HIGHLAND_OPEN);
    expect(v.ok).toBe(false);
    expect(v.why.join(';')).toMatch(/darker than/);
  });

  it('the keys in height-blend.ts resolve in data/palette.json, and the composites above ARE the linear-light mixes the design describes', () => {
    const palette = JSON.parse(readFileSync(fileURLToPath(new URL('../../data/palette.json', import.meta.url)), 'utf8')) as {
      ramps: Record<string, { colors: string[] }>;
    };
    const keyHex = (key: string): string => {
      const [ramp, idx] = key.split('.');
      const hex = palette.ramps[ramp as string]?.colors[Number(idx)];
      if (!hex) throw new Error(`palette key ${key} does not resolve`);
      return hex;
    };
    const mix = (a: string, b: string, t: number): string => {
      const la = linearHex(a);
      const lb = linearHex(b);
      const enc = (v: number): number => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
      return '#' + [0, 1, 2].map((i) => enc(la[i]! + (lb[i]! - la[i]!) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
    };
    const h = HEIGHT_BLEND_THEMES.highland;
    const a = HEIGHT_BLEND_THEMES.arid;
    // The ground each theme draws today (the ramps' own entries; `levant`'s open tones are dust.5 and limestone.3).
    expect(keyHex('dust.5').toUpperCase()).toBe(HIGHLAND_OPEN);
    expect(keyHex('limestone.3').toUpperCase()).toBe(ARID_OPEN);
    expect(mix(HIGHLAND_OPEN, keyHex(h.rock.key), h.rock.amplitude)).toBe('#A29887');
    expect(mix(HIGHLAND_OPEN, keyHex(h.hollow.key), h.hollow.amplitude)).toBe('#8F5931');
    expect(mix(ARID_OPEN, keyHex(a.rock.key), a.rock.amplitude)).toBe('#CDC4B3');
    expect(mix(ARID_OPEN, keyHex(a.hollow.key), a.hollow.amplitude)).toBe('#BFA98A');
    // The design's joint #A37B6A is the joint tone mixed at 0.6 over PURE karst.1 ...
    expect(mix(keyHex('karst.1'), keyHex(h.joint!.key), h.joint!.amplitude)).toBe('#A37B6A');
  });

  it('OPEN QUESTION (GH-1226 S1): the design 3.2 chain mixes the joint over the 0.75 rock COMPOSITE, which is #A0735F at 1.26x, under the 1.3x floor', () => {
    // Design 2.3 prints the joint as #A37B6A (1.41x), which is the 0.6 mix over pure karst.1. The tone chain in 3.2
    // (`mix(mix(mix(vertexTone, hollow), rock), joint)`) lays it over the rock composite instead. This test PINS that fact, so
    // the lead's ruling (a higher rock-over joint amplitude would also need re-judging) flips it on purpose, not by accident.
    expect(ratio('#A0735F')).toBeCloseTo(1.26, 2);
    expect(verdict('#A0735F', HIGHLAND_ROCK).ok).toBe(false);
  });
});
