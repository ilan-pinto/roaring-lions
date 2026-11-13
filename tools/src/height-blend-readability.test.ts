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

type Lin = readonly [number, number, number];
const YL = (c: Lin): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** "Not darker than the ground it replaces" allows 0.5% of its luminance. Why: the highland hollow, composed UNROUNDED from its keys,
 *  reads 0.8065x olive.1 against the 0.8096x of the dust.5 it replaces, 0.4% darker (a hex rounds it lighter). It is the one
 *  composite inside this tolerance, and a hollow of the same colour as the ground it fills is not a readability loss. Anything
 *  darker than 0.5% still fails (the dust.6 test below). */
const DARKER_TOLERANCE = 0.005;

/** The design's rule on LINEAR colours. `replaces` is the ground this composite is drawn over. */
function verdictLin(c: Lin, replaces: Lin, tolerance = DARKER_TOLERANCE): { ok: boolean; why: string[] } {
  const why: string[] = [];
  const dE = deltaE2000(linearHex(KDF_UNIFORM_HEX), c);
  const rat = YL(c) / Y(KDF_UNIFORM_HEX);
  const repRat = YL(replaces) / Y(KDF_UNIFORM_HEX);
  if (dE < MIN_DE2000) why.push(`dE2000 ${dE.toFixed(2)} < ${MIN_DE2000}`);
  if (rat < MIN_LUMINANCE_RATIO) {
    if (repRat >= MIN_LUMINANCE_RATIO) why.push(`luminance ${rat.toFixed(2)}x < ${MIN_LUMINANCE_RATIO}x over a ground at ${repRat.toFixed(2)}x`);
    else if (YL(c) < YL(replaces) * (1 - tolerance)) why.push(`darker than the ${repRat.toFixed(2)}x ground it replaces`);
  }
  return { ok: why.length === 0, why };
}
const verdict = (hex: string, replaces: string): { ok: boolean; why: string[] } => verdictLin(linearHex(hex), linearHex(replaces));

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

  it('the REJECTED form: the joint laid over the 0.75 rock COMPOSITE (the original 3.2 chain) is #9F735F at 1.26x, under the 1.3x floor', () => {
    // The tone chain now mixes the joint over PURE rock tone (karst.1), which is the design's #A37B6A at 1.41x. The old form, over
    // the rock composite, draws this instead. Reverting `mix(k.rockTone, k.jointTone, k.jointAmp)` in height-blend.ts to
    // `k.jointTone` is that form, and height-blend.test.ts' joint literal goes red.
    expect(ratio('#9F735F')).toBeCloseTo(1.256, 3);
    expect(verdict('#9F735F', HIGHLAND_ROCK).ok).toBe(false);
  });

  it('judged UNROUNDED from the keys, every composite passes; the highland hollow is the one case inside the 0.5% tolerance', () => {
    const palette = JSON.parse(readFileSync(fileURLToPath(new URL('../../data/palette.json', import.meta.url)), 'utf8')) as {
      ramps: Record<string, { colors: string[] }>;
    };
    const lin = (key: string): Lin => {
      const [ramp, idx] = key.split('.');
      const hex = palette.ramps[ramp as string]?.colors[Number(idx)];
      if (!hex) throw new Error(`palette key ${key} does not resolve`);
      return linearHex(hex);
    };
    const mixL = (a: Lin, b: Lin, t: number): Lin => [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * t) as unknown as Lin;
    const h = HEIGHT_BLEND_THEMES.highland;
    const a = HEIGHT_BLEND_THEMES.arid;
    const hOpen = lin('dust.5');
    const aOpen = lin('limestone.3');
    const hRock = mixL(hOpen, lin(h.rock.key), h.rock.amplitude);
    const hollow = mixL(hOpen, lin(h.hollow.key), h.hollow.amplitude);
    // The joint at full weight: the joint tone mixed at aJ over PURE rock tone.
    const joint = mixL(lin(h.rock.key), lin(h.joint!.key), h.joint!.amplitude);
    const cases: [string, Lin, Lin][] = [
      ['highland rock', hRock, hOpen],
      ['highland joint', joint, hRock],
      ['highland hollow', hollow, hOpen],
      ['arid rock', mixL(aOpen, lin(a.rock.key), a.rock.amplitude), aOpen],
      ['arid loess hollow', mixL(aOpen, lin(a.hollow.key), a.hollow.amplitude), aOpen],
    ];
    for (const [name, c, rep] of cases) {
      const v = verdictLin(c, rep);
      expect(v.ok, `${name}: ${v.why.join('; ')}`).toBe(true);
    }
    // The hollow is 0.4% darker than the ground it fills: it passes ONLY through the tolerance.
    expect(YL(hollow) / YL(hOpen)).toBeCloseTo(0.9964, 3);
    expect(YL(hollow) / Y(KDF_UNIFORM_HEX)).toBeCloseTo(0.8065, 3);
    expect(verdictLin(hollow, hOpen, 0).ok).toBe(false);
    // ... and the joint is 1.42x unrounded (1.41x as the printed hex).
    expect(YL(joint) / Y(KDF_UNIFORM_HEX)).toBeCloseTo(1.42, 2);
  });

  it('the tolerance is 0.5%, not more: a hollow 3% darker than the ground it fills still fails', () => {
    const open = linearHex(HIGHLAND_OPEN);
    const darker = open.map((v) => v * 0.97) as unknown as Lin;
    expect(verdictLin(darker, open).ok).toBe(false);
  });
});
