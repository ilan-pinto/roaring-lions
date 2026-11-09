/**
 * Look uplift L2 (GH-943): the colour grade as MATHS -- no `three`, no GL.
 *
 * Spec `docs/superpowers/specs/2026-11-01-look-uplift-design.md` section 3. A grade is DATA
 * (`data/grades/<id>.json`, `data/schemas/grade.schema.json`): lift / gamma / gain, saturation,
 * warmth and a split tone, every colour a PALETTE KEY. This file turns one into numbers and
 * bakes the 32^3 LUT; `output-grade.ts` owns the GL half. It is split out so the readability
 * gate (`tools/src/grade_team_colours.test.ts`) can run the very same maths the renderer
 * bakes, with no GPU.
 *
 * DISPLAY-REFERRED. The input is the colour AFTER the ACES tone map and the sRGB encode (what
 * the player would see ungraded), 0..1, so the operations below are the familiar display-space
 * ones. Order: warmth, lift/gamma/gain, saturation, split tone, clamp.
 *
 * A palette key contributes only its HUE DIRECTION: the key's sRGB colour minus its own
 * Rec.709 luma, scaled so the largest channel has magnitude 1 (a grey key has none). The
 * sibling `amount` is the strength. So the palette decides WHICH way a grade leans, and the
 * number decides how far, and a palette revision reaches every grade.
 *
 * STRENGTH. `strength` scales every deviation from identity (amounts, levels, `value - 1`,
 * `saturation - 1`, warmth), so 0 is identity and 1 is the file as authored. The mock sheet
 * judges 0.5 / 1 / 1.5.
 */
import { paletteHex } from './palette-hex';
import type { Ops } from './fog-ops';

export type Rgb = readonly [number, number, number];

/** One lift/gamma/gain stage as it appears in `grade.schema.json`. */
export interface GradeStage {
  readonly tint: string;
  readonly amount: number;
}
export interface GradeJson {
  readonly id: string;
  readonly lift: GradeStage & { readonly level: number };
  readonly gamma: GradeStage & { readonly value: number };
  readonly gain: GradeStage & { readonly value: number };
  readonly saturation: number;
  readonly warmth: number;
  readonly split_tone: {
    readonly shadows: GradeStage;
    readonly highlights: GradeStage;
    readonly balance: number;
  };
}

/** The LUT edge. 32^3 is the spec's size: 32768 entries, 256 KB as RGBA half float. */
export const GRADE_LUT_SIZE = 32;

/** Red up / blue down per unit of `warmth`, in encoded units. */
export const WARMTH_GAIN = 0.12;

const LUMA: Rgb = [0.2126, 0.7152, 0.0722];
const luma = (c: Rgb): number => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function hexToSrgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

/** A palette key's hue direction: colour minus its own luma, scaled so the largest channel is +-1. Grey is (0,0,0). */
export function hueDirection(hex: string): Rgb {
  const c = hexToSrgb(hex);
  const y = luma(c);
  const d: Rgb = [c[0] - y, c[1] - y, c[2] - y];
  const m = Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]));
  return m < 1e-6 ? [0, 0, 0] : [d[0] / m, d[1] / m, d[2] / m];
}

/** A grade with its keys resolved and its strength applied: everything the per-colour function needs. */
export interface ResolvedGrade {
  /** Per-channel black point. */
  readonly lift: Rgb;
  /** Per-channel highlight multiplier. */
  readonly gain: Rgb;
  /** Per-channel mid-tone exponent denominator (out = v ^ (1 / gamma)). */
  readonly gamma: Rgb;
  readonly saturation: number;
  readonly warmth: number;
  /** Added to a shadow / to a highlight, in encoded units. */
  readonly shadowTone: Rgb;
  readonly highlightTone: Rgb;
  readonly balance: number;
}

/** The identity, spelled out. `isIdentity` compares against it. */
export const IDENTITY_GRADE: ResolvedGrade = {
  lift: [0, 0, 0],
  gain: [1, 1, 1],
  gamma: [1, 1, 1],
  saturation: 1,
  warmth: 0,
  shadowTone: [0, 0, 0],
  highlightTone: [0, 0, 0],
  balance: 0,
};

/**
 * Resolves a grade's palette keys (through `resolveHex`, default the palette file) and applies `strength`.
 * An unknown key throws (`paletteHex`), so a typo is a failing boot, not a wrong pixel.
 */
export function resolveGrade(spec: GradeJson, strength = 1, resolveHex: (key: string) => string = paletteHex): ResolvedGrade {
  const s = strength;
  const dir = (key: string): Rgb => hueDirection(resolveHex(key));
  const scale = (d: Rgb, k: number): Rgb => [d[0] * k, d[1] * k, d[2] * k];
  const liftDir = scale(dir(spec.lift.tint), spec.lift.amount * s);
  const gammaDir = dir(spec.gamma.tint);
  const gainDir = dir(spec.gain.tint);
  const gammaV = 1 + (spec.gamma.value - 1) * s;
  const gainV = 1 + (spec.gain.value - 1) * s;
  const sh = scale(dir(spec.split_tone.shadows.tint), spec.split_tone.shadows.amount * s);
  const hi = scale(dir(spec.split_tone.highlights.tint), spec.split_tone.highlights.amount * s);
  return {
    lift: [liftDir[0] + spec.lift.level * s, liftDir[1] + spec.lift.level * s, liftDir[2] + spec.lift.level * s],
    gain: [0, 1, 2].map((i) => gainV * (1 + gainDir[i] * spec.gain.amount * s)) as unknown as Rgb,
    gamma: [0, 1, 2].map((i) => Math.max(0.05, gammaV * (1 + gammaDir[i] * spec.gamma.amount * s))) as unknown as Rgb,
    saturation: 1 + (spec.saturation - 1) * s,
    warmth: spec.warmth * s,
    shadowTone: sh,
    highlightTone: hi,
    balance: spec.split_tone.balance,
  };
}

/** True when the grade changes no colour at all, so the renderer builds NO pass for it. */
export function isIdentity(g: ResolvedGrade): boolean {
  const eq = (a: Rgb, b: Rgb): boolean => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  return (
    eq(g.lift, IDENTITY_GRADE.lift) &&
    eq(g.gain, IDENTITY_GRADE.gain) &&
    eq(g.gamma, IDENTITY_GRADE.gamma) &&
    Math.abs(g.saturation - 1) < 1e-9 &&
    Math.abs(g.warmth) < 1e-9 &&
    eq(g.shadowTone, IDENTITY_GRADE.shadowTone) &&
    eq(g.highlightTone, IDENTITY_GRADE.highlightTone)
  );
}

/** One display-referred colour (0..1 per channel, sRGB-encoded) through the grade. */
export function gradeColor(c: Rgb, g: ResolvedGrade): Rgb {
  // Warmth: a white-balance nudge.
  let r = c[0] * (1 + WARMTH_GAIN * g.warmth);
  let gr = c[1];
  let b = c[2] * (1 - WARMTH_GAIN * g.warmth);
  const v: [number, number, number] = [r, gr, b];
  // Lift / gamma / gain: black point and white point per channel, then the mid-tone exponent.
  for (let i = 0; i < 3; i++) {
    const x = clamp01(v[i]);
    const lg = g.lift[i] * (1 - x) + g.gain[i] * x;
    v[i] = Math.pow(Math.max(0, lg), 1 / g.gamma[i]);
  }
  // Saturation about Rec.709 luma.
  const y = luma(v);
  for (let i = 0; i < 3; i++) v[i] = y + (v[i] - y) * g.saturation;
  // Split tone: shadow tint where it is dark, highlight tint where it is bright.
  const m = smoothstep(0.15, 0.85, luma(v) + g.balance * 0.25);
  for (let i = 0; i < 3; i++) v[i] += g.shadowTone[i] * (1 - m) + g.highlightTone[i] * m;
  r = clamp01(v[0]);
  gr = clamp01(v[1]);
  b = clamp01(v[2]);
  return [r, gr, b];
}

/**
 * The 32^3 LUT as RGBA floats, red fastest then green then blue (the layout `Data3DTexture` reads:
 * x = red, y = green, z = blue). Texel (i, j, k) holds the grade of the colour
 * (i, j, k) / (size - 1), so a lookup at `c * (size-1)/size + 0.5/size` lands on texel centres and
 * trilinear filtering interpolates between them.
 */
export function bakeLutFloats(g: ResolvedGrade, size = GRADE_LUT_SIZE): Float32Array {
  const out = new Float32Array(size * size * size * 4);
  const d = size - 1;
  let o = 0;
  for (let k = 0; k < size; k++) {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const [r, gg, b] = gradeColor([i / d, j / d, k / d], g);
        out[o++] = r;
        out[o++] = gg;
        out[o++] = b;
        out[o++] = 1;
      }
    }
  }
  return out;
}

/** The grade id a time-of-day preset ships, or null for the identity (day). `night` resolves to dusk elsewhere (D10). */
export function gradeIdForPreset(preset: 'dawn' | 'day' | 'dusk'): 'dawn' | 'dusk' | null {
  return preset === 'day' ? null : preset;
}

/**
 * The LUT lookup coordinate for a display-referred colour: `clamp(c, 0, 1) * (N - 1) / N + 0.5 / N`, which lands on texel centres
 * (see `bakeLutFloats`). Written ONCE against `ops`, so the node twin and a vitest read the same maths. `c` may be a scalar or a
 * vector in the ops' own type (the node chain hands it a vec3). The legacy GLSL (`LOOKUP_GLSL` in `output-grade.ts`) spells the
 * same two constants from `GRADE_LUT_SIZE`.
 */
export function lutCoord<T>(ops: Ops<T>, c: T, size = GRADE_LUT_SIZE): T {
  return ops.add(ops.mul(ops.clamp(c, 0, 1), ops.lit((size - 1) / size)), ops.lit(0.5 / size));
}

/** The dither's interleaved-gradient noise, 0..1, of a pixel position (`gradeNoise` in `output-grade.ts`'s GLSL). */
export function gradeNoise<T>(ops: Ops<T>, x: T, y: T): T {
  const dot = ops.add(ops.mul(x, ops.lit(0.06711056)), ops.mul(y, ops.lit(0.00583715)));
  return ops.fract(ops.mul(ops.lit(52.9829189), ops.fract(dot)));
}

/** The second IGN sample's offset (pixels): far enough from the first that the pair is not the same pattern shifted by one tap. */
export const GRADE_DITHER_OFFSET = { x: 47, y: 113 } as const;

/**
 * What the dither adds to a colour (display-referred 0..1 units): TRIANGULAR noise of +-1 LSB at `lsb` = 1, centred on zero (GH-943 P2 T8,
 * R10). Two interleaved-gradient samples summed, `(n1 + n2 - 1)`, where a single sample (rectangular, +-0.5 LSB) left a flat gradient
 * banding at 0.058 / 0.075 (L) and 0.070 / 0.065 (G) on the Metal sheet. The legacy GLSL spells the same two samples (`DITHER_GLSL`).
 */
export function gradeDitherOffset<T>(ops: Ops<T>, x: T, y: T, lsb: T): T {
  const second = gradeNoise(ops, ops.add(x, ops.lit(GRADE_DITHER_OFFSET.x)), ops.add(y, ops.lit(GRADE_DITHER_OFFSET.y)));
  return ops.mul(ops.sub(ops.add(gradeNoise(ops, x, y), second), ops.lit(1)), ops.div(lsb, ops.lit(255)));
}
