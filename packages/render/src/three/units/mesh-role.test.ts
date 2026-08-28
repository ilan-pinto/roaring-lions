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
  it('accepts every role in the closed vocabulary, on BOTH sides', () => {
    // Both factions, not just KDF: the whole reason this parameter exists is
    // that five enemy teams shipped meshes while every role still resolved
    // through the KDF table. A per-faction gap in coverage is exactly the
    // shape of that bug.
    for (const faction of ['kdf', 'enemy'] as const) {
      for (const role of MESH_ROLES) {
        expect(isMeshRole(role)).toBe(true);
        expect(() => rampForRole(role, faction)).not.toThrow();
        expect(rampForRole(role, faction).length).toBeGreaterThan(0);
      }
    }
  });

  it('shades uniform and webbing differently per side, and inverts the two ramps', () => {
    // Not merely "different" -- INVERTED. render_team.py's own design: KDF
    // wear grey nylon over olive, the militia wear olive gear over tan. So
    // the enemy's webbing must come from the ramp KDF uses for cloth.
    expect(rampForRole('uniform', 'kdf')).not.toEqual(rampForRole('uniform', 'enemy'));
    expect(rampForRole('webbing', 'kdf')).not.toEqual(rampForRole('webbing', 'enemy'));
    const olive = readRamp('olive');
    expect(rampForRole('uniform', 'kdf').every((c) => olive.includes(c))).toBe(true);
    expect(rampForRole('webbing', 'enemy').every((c) => olive.includes(c))).toBe(true);
    const dust = readRamp('dust');
    expect(rampForRole('uniform', 'enemy').every((c) => dust.includes(c))).toBe(true);
  });

  it('shades every OTHER role identically on both sides -- a rifle is a rifle', () => {
    for (const role of MESH_ROLES) {
      if (role === 'uniform' || role === 'webbing') continue;
      expect(rampForRole(role, 'kdf')).toEqual(rampForRole(role, 'enemy'));
    }
  });

  // Break: delete the `if (!isMeshRole(role))` guard in `rampForRole` (fall
  // through to `RAMP_FOR_ROLE[role]` unconditionally). Verified by hand --
  // this test goes red because `rampForRole('turret_gun', 'kdf')` returns
  // `undefined` instead of throwing, so `.toThrow()` fails.
  it('throws loudly for a role outside the closed set -- never a default colour', () => {
    expect(isMeshRole('turret_gun')).toBe(false);
    expect(() => rampForRole('turret_gun', 'kdf')).toThrow(/unknown rl_role "turret_gun"/);
  });

  // Break: change `webbing: readRamp('gunmetal').slice(1, 4)` to
  // `readRamp('gunmetal')` (the whole ramp). Verified by hand -- this test
  // goes red: `rampForRole('webbing', 'kdf').length` is 4 (the whole ramp) rather
  // than 3, since `data/palette.json`'s gunmetal ramp has 4 steps at the
  // time this was written. This is the guard against silently handing a
  // role the whole ramp when the R0 rationale explicitly calls for a slice
  // (`webbing` distinguished from `metal` by VALUE inside one ramp).
  it('slices, rather than hands over, a shared ramp for webbing/metal/weapon/charge', () => {
    const gunmetal = readRamp('gunmetal');
    expect(rampForRole('webbing', 'kdf').length).toBeLessThan(gunmetal.length);
    expect(rampForRole('metal', 'kdf').length).toBeLessThan(gunmetal.length);
    // webbing and metal must be genuinely different slices of the same
    // ramp -- both non-empty and not identical -- or a uniform and a
    // weapon would shade indistinguishably despite the art direction
    // deliberately separating them by value.
    expect(rampForRole('webbing', 'kdf')).not.toEqual(rampForRole('metal', 'kdf'));
  });

  it('gives uniform the whole olive ramp (KDF only -- see this file\'s top comment)', () => {
    expect(rampForRole('uniform', 'kdf')).toEqual(readRamp('olive'));
  });
});
