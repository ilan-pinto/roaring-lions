/**
 * GH-943 P2 (T3): the ground blend's shared maths on numbers (`NUMBER_OPS`), against LITERAL expected values worked by hand from
 * the spec numbers (half-width 0.36, falloff 0.18, bend 0.08, shoulder 0.12 at 40%, ruts 0.17 out, 0.06 wide, 35%, junction fade
 * 0.4; height blend 0.15; macro luminance 0.07, hue 0.04), never from the code under test.
 */
import { describe, expect, it } from 'vitest';
import { NUMBER_OPS } from '../fog-ops';
import { heightBiased, macroDecode, macroFactor, rescaleWeights, roadBands } from './ground-maths';

const o = NUMBER_OPS;
const FAR = 10;

describe('roadBands', () => {
  it('is packed surface on the centreline, no shoulder, no rut', () => {
    expect(roadBands(o, 0, 0, FAR)).toEqual({ surface: 1, shoulder: 0, rut: 0 });
  });
  it('is half surface at the half-width, with a 20% shoulder (0.4 x 0.5 x 1)', () => {
    const b = roadBands(o, 0.36, 0, FAR);
    expect(b.surface).toBeCloseTo(0.5, 12);
    expect(b.shoulder).toBeCloseTo(0.2, 12);
    expect(b.rut).toBe(0);
  });
  it('bends the edge out by 0.08 at bend 1: surface 0.0089163 at the half-width', () => {
    expect(roadBands(o, 0.36, 1, FAR).surface).toBeCloseTo(0.0089163237, 9);
  });
  it('lays the shoulder past the edge: 0.4 x (1 - smoothstep(0.45, 0.57, 0.5)) = 0.249537', () => {
    const b = roadBands(o, 0.5, 0, FAR);
    expect(b.surface).toBe(0);
    expect(b.shoulder).toBeCloseTo(0.2495370370, 9);
  });
  it('puts a full 35% rut at 0.17 from the centre, and none at 0.06 (the rut width, not its offset)', () => {
    expect(roadBands(o, 0.17, 0, FAR).rut).toBeCloseTo(0.35, 12);
    expect(roadBands(o, 0.06, 0, FAR).rut).toBe(0);
    expect(roadBands(o, 0.1, 0, FAR).rut).toBe(0);
  });
  it('half a rut band, half faded by a junction 0.2 away: 0.35 x 0.5 x 0.5 = 0.0875', () => {
    expect(roadBands(o, 0.2, 0, 0.2).rut).toBeCloseTo(0.0875, 10);
    expect(roadBands(o, 0.17, 0, 0).rut).toBe(0);
  });
});

describe('heightBiased and rescaleWeights', () => {
  it('biases a mid-blend weight by 0.15 x h, and leaves 0 and 1 alone', () => {
    expect(heightBiased(o, 0.5, 1)).toBeCloseTo(0.65, 12);
    expect(heightBiased(o, 0.25, 0.5)).toBeCloseTo(0.30625, 12);
    expect(heightBiased(o, 1, 1)).toBe(1);
    expect(heightBiased(o, 0, 1)).toBe(0);
  });
  it('never goes below 0 (0.5 - 1.5 clamps)', () => {
    expect(heightBiased(o, 0.5, -10)).toBe(0);
  });
  it('rescales the biased weights to the input total', () => {
    const r = rescaleWeights(o, [0.5, 0.5], [0.9, 0.3]);
    expect(r[0]).toBeCloseTo(0.75, 12);
    expect(r[1]).toBeCloseTo(0.25, 12);
    expect(rescaleWeights(o, [0.3, 0.3], [0.5, 0.1])).toEqual([0.5, 0.1]);
  });
  it('returns the weights unchanged when every biased weight is 0', () => {
    expect(rescaleWeights(o, [0, 0, 0], [0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('macroDecode and macroFactor', () => {
  it('decodes the byte exactly: 128 is 0, 255 is 1, 0 is -128/127', () => {
    expect(macroDecode(o, 128 / 255)).toBeCloseTo(0, 12);
    expect(macroDecode(o, 1)).toBe(1);
    expect(macroDecode(o, 0)).toBeCloseTo(-1.0078740157, 9);
  });
  it('is neutral at m = 0 and at amp = 0', () => {
    expect(macroFactor(o, 0, 1, 1.2, 0.8)).toBe(1);
    expect(macroFactor(o, 1, 0, 1.2, 0.8)).toBe(1);
  });
  it('pulls bright toward the bright tint and dark toward the dark one', () => {
    expect(macroFactor(o, 1, 1, 1.2, 0.8)).toBeCloseTo(1.07856, 12);
    expect(macroFactor(o, -1, 1, 1.2, 0.8)).toBeCloseTo(0.92256, 12);
    expect(macroFactor(o, 0.5, 0.5, 1.2, 0.8)).toBeCloseTo(1.019535, 12);
  });
});
