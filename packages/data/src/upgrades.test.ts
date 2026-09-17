import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  UPGRADE_PATHS,
  applyUpgrades,
  maxTiers,
  nextTierPrice,
  type UpgradableUnit,
} from './upgrades';

const __dirname = dirname(fileURLToPath(import.meta.url));

function fixture(): UpgradableUnit {
  return {
    id: 'fixture_unit',
    hull: { hp: 400, armor: { front: 10, side: 10 } },
    sensors: { optics: 1.0 },
    weapons: [{ accuracy: 0.6, penetration: 50 }, { accuracy: 0.5, penetration: 30 }],
    upgrades: {
      armour: {
        tiers: [
          { price: 300, patch: { 'hull.armor.front': 10, 'hull.armor.side': 5 } },
          { price: 600, patch: { 'hull.armor.front': 20, 'hull.armor.side': 10 } },
        ],
      },
      optics: {
        tiers: [{ price: 250, patch: { 'sensors.optics': 0.2, 'weapons[0].accuracy': 0.05 } }],
      },
    },
  };
}

describe('applyUpgrades', () => {
  it('is the identity for an empty tier map, and returns a new object', () => {
    const u = fixture();
    const out = applyUpgrades(u, {});
    expect(out).toEqual(u);
    expect(out).not.toBe(u);
  });

  it('is the identity for tier 0 on a declared track', () => {
    const u = fixture();
    const out = applyUpgrades(u, { armour: 0 });
    expect(out).toEqual(u);
    expect(out).not.toBe(u);
  });

  it('applies exact cumulative deltas across tracks', () => {
    const u = fixture();
    const out = applyUpgrades(u, { armour: 2, optics: 1 });
    expect(out.hull?.armor).toEqual({ front: 30, side: 20 });
    expect(out.sensors?.optics).toBeCloseTo(1.2);
    expect(out.weapons?.[0].accuracy).toBeCloseTo(0.65);
    expect(out.weapons?.[1]).toEqual({ accuracy: 0.5, penetration: 30 });
    expect(out.hull?.hp).toBe(400);
  });

  it('never mutates the input unit', () => {
    const u = fixture();
    applyUpgrades(u, { armour: 2, optics: 1 });
    expect((u.hull!.armor as { front: number }).front).toBe(10);
    expect((u.weapons![0] as { accuracy: number }).accuracy).toBe(0.6);
  });

  it('clamps a tier above the track maximum to the maximum', () => {
    const u = fixture();
    const clamped = applyUpgrades(u, { armour: 9 });
    const atMax = applyUpgrades(u, { armour: 2 });
    expect(clamped).toEqual(atMax);
  });

  it('ignores an unknown track', () => {
    const u = fixture();
    const out = applyUpgrades(u, { nothing: 1 });
    expect(out).toEqual(u);
  });

  it('throws on a patch path outside the whitelist, naming the path', () => {
    const u: UpgradableUnit = {
      id: 'bad_unit',
      hull: { hp: 100 },
      upgrades: {
        mobility: {
          tiers: [{ price: 100, patch: { 'mobility.speed_tiles_s': 0.5 } }],
        },
      },
    };
    expect(() => applyUpgrades(u, { mobility: 1 })).toThrow(/mobility\.speed_tiles_s/);
  });

  it('sums same-path deltas from two different tracks rather than dropping one', () => {
    const u: UpgradableUnit = {
      id: 'cross_track_unit',
      hull: { hp: 400 },
      upgrades: {
        armour: { tiers: [{ price: 300, patch: { 'hull.hp': 50 } }] },
        survivability: { tiers: [{ price: 300, patch: { 'hull.hp': 30 } }] },
      },
    };
    const out = applyUpgrades(u, { armour: 1, survivability: 1 });
    expect(out.hull?.hp).toBe(480); // 400 + 50 + 30, not last-write-wins' 430
  });

  it('throws when a whitelisted weapons index is past the unit\'s own array', () => {
    const u = fixture(); // two weapons, indices 0 and 1
    const withOverreach: UpgradableUnit = {
      ...u,
      upgrades: {
        overreach: {
          tiers: [{ price: 100, patch: { 'weapons[5].accuracy': 0.1 } }],
        },
      },
    };
    expect(() => applyUpgrades(withOverreach, { overreach: 1 })).toThrow(
      /fixture_unit has no weapons\[5\]/,
    );
  });

  it('throws when a whitelisted scalar path has no leaf on the unit, rather than defaulting to 0', () => {
    const u: UpgradableUnit = {
      id: 'no_rear_armor_unit',
      hull: { hp: 100, armor: { front: 10, side: 10 } }, // no `rear`
      upgrades: {
        armour: {
          tiers: [{ price: 100, patch: { 'hull.armor.rear': 5 } }],
        },
      },
    };
    expect(() => applyUpgrades(u, { armour: 1 })).toThrow(
      /no_rear_armor_unit has no hull\.armor\.rear/,
    );
  });

  it('sums a same-path float delta from two tracks the same way regardless of the tiers object\'s own key order', () => {
    const u: UpgradableUnit = {
      id: 'float_order_unit',
      sensors: { optics: 1.0 },
      upgrades: {
        zzz_track: { tiers: [{ price: 100, patch: { 'sensors.optics': 0.11 } }] },
        aaa_track: { tiers: [{ price: 100, patch: { 'sensors.optics': 0.21 } }] },
      },
    };
    // Two calls, same two tracks, `tiers` object literal written in opposite
    // key order each time -- `applyUpgrades` must read the same result
    // either way, because it sorts `Object.keys(tiers)` itself rather than
    // trusting insertion order.
    const forward = applyUpgrades(u, { zzz_track: 1, aaa_track: 1 });
    const backward = applyUpgrades(u, { aaa_track: 1, zzz_track: 1 });
    expect(forward.sensors?.optics).toBeCloseTo(1.0 + 0.32);
    expect(backward.sensors?.optics).toBeCloseTo(1.0 + 0.32);
    expect(forward.sensors?.optics).toBe(backward.sensors?.optics);
  });
});

describe('maxTiers', () => {
  it('reports every track at its maximum tier', () => {
    expect(maxTiers(fixture())).toEqual({ armour: 2, optics: 1 });
  });

  it('is empty for a unit with no upgrade tracks', () => {
    expect(maxTiers({ id: 'x' })).toEqual({});
  });
});

describe('nextTierPrice', () => {
  const u = fixture();

  it('returns the next tier price for an unbought track', () => {
    expect(nextTierPrice(u, 'armour', 0)).toBe(300);
  });

  it('returns the price of the tier above the current one', () => {
    expect(nextTierPrice(u, 'armour', 1)).toBe(600);
  });

  it('returns null once a track is maxed', () => {
    expect(nextTierPrice(u, 'armour', 2)).toBeNull();
  });

  it('returns null for an unknown track', () => {
    expect(nextTierPrice(u, 'nope', 0)).toBeNull();
  });
});

describe('UPGRADE_PATHS pin against unit.schema.json', () => {
  const schemaPath = join(__dirname, '../../../data/schemas/unit.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
    properties: { upgrades: { patternProperties: Record<string, unknown> } };
  };

  function findPattern(): string {
    const upgrades = schema.properties.upgrades as unknown as {
      patternProperties: Record<
        string,
        { properties?: { tiers?: { items?: { properties?: { patch?: { propertyNames?: { pattern?: string } } } } } } }
      >;
    };
    for (const key of Object.keys(upgrades.patternProperties)) {
      const pattern =
        upgrades.patternProperties[key]?.properties?.tiers?.items?.properties?.patch?.propertyNames?.pattern;
      if (pattern) return pattern;
    }
    throw new Error('could not find the patch propertyNames.pattern in unit.schema.json');
  }

  const pattern = new RegExp(findPattern());

  const CANDIDATES = [
    // legal
    'hull.hp',
    'hull.armor.front',
    'hull.armor.side',
    'hull.armor.rear',
    'hull.suppression_resistance',
    'sensors.optics',
    'sensors.sight_tiles',
    'weapons[0].accuracy',
    'weapons[3].penetration',
    // illegal
    'mobility.speed_tiles_s',
    'hull.armor.top',
    'weapons[0].rate_of_fire',
  ] as const;

  function acceptedByUpgradePaths(path: string): boolean {
    return UPGRADE_PATHS.some((re) => re.test(path));
  }

  it.each(CANDIDATES)('agrees with the schema pattern on %s', (path) => {
    expect(acceptedByUpgradePaths(path)).toBe(pattern.test(path));
  });

  it('has at least one legal and one illegal candidate in the fixed list', () => {
    const legal = CANDIDATES.filter((p) => pattern.test(p));
    const illegal = CANDIDATES.filter((p) => !pattern.test(p));
    expect(legal.length).toBe(9);
    expect(illegal.length).toBe(3);
  });
});

// Review finding 1: tools/validate_balance.py's own docstring claims this
// pin exists ("the two are pinned together by packages/data/src/upgrades.test.ts
// reading this file's own whitelist back out"). It did not, until this block --
// the Python `UPGRADE_PATHS` was a hand-kept, unchecked mirror of the TS one
// above. This reads the .py file off disk (no Node/Python bridge; the two
// stay in sync only because this test fails the moment they diverge) and
// compares regex SOURCE strings as a set, so reordering either list cannot
// cause a false failure.
describe('UPGRADE_PATHS pin against tools/validate_balance.py', () => {
  const pyPath = join(__dirname, '../../../tools/validate_balance.py');
  const py = readFileSync(pyPath, 'utf8');

  function pythonUpgradePathSources(): string[] {
    const block = /UPGRADE_PATHS\s*=\s*\[([\s\S]*?)\n\]/.exec(py);
    if (!block) throw new Error('could not find the UPGRADE_PATHS = [ ... ] block in validate_balance.py');
    const sources: string[] = [];
    // Each entry is `re.compile(r"...")` -- a Python RAW string, so (unlike a
    // plain Python string literal) a single backslash in the source text
    // already means a single backslash in the compiled pattern, exactly as a
    // JS regex literal's own `.source` reads it. No de-doubling or other
    // escape normalisation is needed for that reason; every pattern here is
    // asserted byte-for-byte against `UPGRADE_PATHS[i].source`.
    const re = /re\.compile\(r"([^"]+)"\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block[1])) !== null) sources.push(m[1]);
    return sources;
  }

  it('is the exact same set of regex source strings as the TS whitelist', () => {
    const pySources = pythonUpgradePathSources();
    const tsSources = UPGRADE_PATHS.map((re) => re.source);
    expect(pySources.length).toBeGreaterThan(0);
    expect(new Set(pySources)).toEqual(new Set(tsSources));
    // Also same COUNT -- two lists could share a set but disagree on a
    // duplicate entry, which a plain Set comparison would hide.
    expect(pySources.length).toBe(tsSources.length);
  });

  it("pins apply_upgrades' cross-track semantics textually: its docstring names summing across tracks", () => {
    const docstring = /def apply_upgrades\(unit, tiers\):\s*"""([\s\S]*?)"""/.exec(py);
    expect(docstring, 'could not find apply_upgrades\' docstring in validate_balance.py').not.toBeNull();
    expect((docstring as RegExpExecArray)[1]).toMatch(/summed across tracks/);
  });
});
