/**
 * GH-1197 P2: debris takes the ground's own ramp (the coordinator's ruling Q2): a clod one step lighter, chunks
 * one and two steps darker, a charred chunk gunmetal.2. Oracles are palette keys spelled out.
 */
import { describe, expect, it } from 'vitest';
import { paletteHex } from '../palette-hex';
import { DEBRIS_FALLBACK_KEY, debrisKeysFor, paletteKeyOfHex, rampStep } from './debris-tone';

describe('the ground palette key', () => {
  it('finds a ramp entry by its hex, in any case', () => {
    expect(paletteKeyOfHex(paletteHex('limestone.3'))).toBe('limestone.3');
    expect(paletteKeyOfHex(paletteHex('grass.2').toLowerCase())).toBe('grass.2');
    expect(paletteKeyOfHex('#010203')).toBeNull();
  });

  it('steps along its own ramp, darker for +, clamped at both ends', () => {
    expect(rampStep('limestone.3', 1)).toBe('limestone.4');
    expect(rampStep('limestone.3', -1)).toBe('limestone.2');
    expect(rampStep('limestone.0', -1)).toBe('limestone.0');
    expect(rampStep('basalt.0', 2)).toBe('basalt.0');
  });
});

describe('debris on each theme ground', () => {
  it('arid open ground (limestone.3): pale clods, darker limestone chunks', () => {
    expect(debrisKeysFor(paletteHex('limestone.3'), paletteHex('limestone.3'))).toEqual({
      clod: 'limestone.2',
      chunks: ['limestone.4', 'limestone.5'],
      charred: 'gunmetal.2',
    });
  });
  it('green open ground (grass.2) and highland (dust.5) keep their own ramps', () => {
    expect(debrisKeysFor(paletteHex('grass.2'), paletteHex('grass.2')).chunks).toEqual(['grass.3', 'grass.4']);
    expect(debrisKeysFor(paletteHex('dust.5'), paletteHex('dust.5')).clod).toBe('dust.4');
  });
  it('a basalt ground throws basalt', () => {
    expect(debrisKeysFor(paletteHex('basalt.0'), paletteHex('limestone.3')).chunks).toEqual(['basalt.0', 'basalt.0']);
  });
  it('falls back to the open tone, then to dust.2', () => {
    expect(debrisKeysFor('#010203', paletteHex('grass.2')).clod).toBe('grass.1');
    expect(debrisKeysFor('#010203', '#030201').chunks[0]).toBe(`dust.${Number(DEBRIS_FALLBACK_KEY.split('.')[1]) + 1}`);
  });
});
