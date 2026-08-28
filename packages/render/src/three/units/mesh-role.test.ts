/**
 * Per this project's own testing standard: every assertion below that
 * matters was verified by breaking the corresponding line in `mesh-role.ts`
 * by hand and confirming the SPECIFIC test named goes red, then reverting.
 * Reported in `.superpowers/f-runtime-report.md`.
 */
import { describe, it, expect } from 'vitest';
import { MESH_ROLES, isMeshRole, rampForRole, readRamp } from './mesh-role';
import paletteJson from '../../../../../data/palette.json';

const ramps = paletteJson.ramps as Record<string, { colors: string[] }>;

describe('readRamp', () => {
  it('returns the named ramp\'s colours, straight from data/palette.json', () => {
    expect(readRamp('olive')).toEqual(ramps.olive.colors);
  });

  // Break: change `if (!entry)` to `if (false)`. Verified by hand -- this
  // test goes red with "expected [Function] to throw" instead of a match,
  // because `readRamp('not-a-real-ramp')` returns `undefined.colors` and
  // throws a TypeError instead of the named error, so the message
  // assertion below is what actually catches it.
  it('throws by name for a ramp not in data/palette.json', () => {
    expect(() => readRamp('not-a-real-ramp')).toThrow(/no ramp named "not-a-real-ramp"/);
  });
});

describe('isMeshRole / rampForRole', () => {
  it('accepts every role in the closed vocabulary', () => {
    for (const role of MESH_ROLES) {
      expect(isMeshRole(role)).toBe(true);
      expect(() => rampForRole(role)).not.toThrow();
      expect(rampForRole(role).length).toBeGreaterThan(0);
    }
  });

  // Break: delete the `if (!isMeshRole(role))` guard in `rampForRole` (fall
  // through to `RAMP_FOR_ROLE[role]` unconditionally). Verified by hand --
  // this test goes red because `rampForRole('turret_gun')` returns
  // `undefined` instead of throwing, so `.toThrow()` fails.
  it('throws loudly for a role outside the closed set -- never a default colour', () => {
    expect(isMeshRole('turret_gun')).toBe(false);
    expect(() => rampForRole('turret_gun')).toThrow(/unknown rl_role "turret_gun"/);
  });

  // Break: change `webbing: readRamp('gunmetal').slice(1, 4)` to
  // `readRamp('gunmetal')` (the whole ramp). Verified by hand -- this test
  // goes red: `rampForRole('webbing').length` is 4 (the whole ramp) rather
  // than 3, since `data/palette.json`'s gunmetal ramp has 4 steps at the
  // time this was written. This is the guard against silently handing a
  // role the whole ramp when the R0 rationale explicitly calls for a slice
  // (`webbing` distinguished from `metal` by VALUE inside one ramp).
  it('slices, rather than hands over, a shared ramp for webbing/metal/weapon/charge', () => {
    const gunmetal = readRamp('gunmetal');
    expect(rampForRole('webbing').length).toBeLessThan(gunmetal.length);
    expect(rampForRole('metal').length).toBeLessThan(gunmetal.length);
    // webbing and metal must be genuinely different slices of the same
    // ramp -- both non-empty and not identical -- or a uniform and a
    // weapon would shade indistinguishably despite the art direction
    // deliberately separating them by value.
    expect(rampForRole('webbing')).not.toEqual(rampForRole('metal'));
  });

  it('gives uniform the whole olive ramp (KDF only -- see this file\'s top comment)', () => {
    expect(rampForRole('uniform')).toEqual(readRamp('olive'));
  });
});
