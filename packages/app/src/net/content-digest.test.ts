import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { doctrines, formations, maps, structures, units, versusModes, versusRules } from '@lions/data';
import { canonicalJson, contentDigest, shippedContent, shippedContentDigest, type Content } from './content-digest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** A deep copy with every object's keys REVERSED: equal content, different insertion order. */
function reversed(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reversed);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).reverse()) out[k] = reversed((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

const infSquad = units.inf_squad;
const withInfHp = (hp: number): Content => ({
  ...shippedContent(),
  units: { ...units, inf_squad: { ...infSquad, hull: { ...infSquad.hull, hp } } },
});

describe('canonicalJson', () => {
  it('sorts object keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1, 2], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,1,2]},"b":1}');
  });
  it('writes a number as ECMAScript does (RFC 8785): 1.0 is 1, -0 is 0, a fraction is its shortest round-trip', () => {
    expect(canonicalJson([1.0, -0, 0.12, 1e21, 2.5e-7])).toBe('[1,0,0.12,1e+21,2.5e-7]');
  });
  it('refuses what JSON content cannot hold, rather than hashing it some arbitrary way', () => {
    expect(() => canonicalJson(NaN)).toThrow();
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson(() => 1)).toThrow();
  });
});

describe('contentDigest (L4)', () => {
  it('is an int32', () => {
    const d = shippedContentDigest();
    expect(Number.isInteger(d)).toBe(true);
    expect(d | 0).toBe(d);
  });

  it('the shipped digest covers units, structures, maps, doctrines, versus rules, versus modes and formations, as they are shipped', () => {
    expect(shippedContent()).toEqual({ units, structures, maps, doctrines, versusRules, versusModes, formations });
    expect(shippedContentDigest()).toBe(contentDigest({ units, structures, maps, doctrines, versusRules, versusModes, formations }));
  });

  it('GH-976 P3: a flag zone and the flag hold count (the hold 30 -> 31, the friendly flag one tile over), and put back it is the same', () => {
    const shipped = shippedContent();
    const file = versusModes.wadi_tarfan;
    const withFile = (over: Partial<typeof file>): Content => ({ ...shipped, versusModes: { ...versusModes, wadi_tarfan: { ...file, ...over } } });
    expect(file.modes.flag!.hold_s).toBe(30); // literal: the shipped hold
    expect(contentDigest(withFile({ modes: { ...file.modes, flag: { hold_s: 31 } } }))).not.toBe(shippedContentDigest());
    expect(contentDigest(withFile({ flags: { ...file.flags!, friendly: { ...file.flags!.friendly, at: [file.flags!.friendly.at[0] + 1, file.flags!.friendly.at[1]] } } }))).not.toBe(shippedContentDigest());
    expect(contentDigest(withFile({}))).toBe(shippedContentDigest());
  });

  it('GH-976 P2: one win-mode value counts (the points target 600 -> 601), and put back it is the same', () => {
    const shipped = shippedContent();
    const file = versusModes.wadi_tarfan;
    const withTarget = (target: number): Content => ({
      ...shipped,
      versusModes: { ...versusModes, wadi_tarfan: { ...file, modes: { ...file.modes, points: { ...file.modes.points!, target } } } },
    });
    expect(file.modes.points!.target).toBe(600); // literal: the shipped target
    expect(contentDigest(withTarget(601))).not.toBe(shippedContentDigest());
    expect(contentDigest(withTarget(600))).toBe(shippedContentDigest());
    // and a whole file dropped counts too
    const rest = Object.fromEntries(Object.entries(versusModes).filter(([id]) => id !== 'wadi_tarfan'));
    expect(Object.keys(rest)).toEqual(['milh_flats']);
    expect(contentDigest({ ...shipped, versusModes: rest })).not.toBe(shippedContentDigest());
  });

  it('is key-sorted: the same content in a different insertion order digests the same', () => {
    const shipped = shippedContent();
    const turned: Content = {
      units: reversed(shipped.units) as Content['units'],
      structures: reversed(shipped.structures) as Content['structures'],
      maps: reversed(shipped.maps) as Content['maps'],
      doctrines: reversed(shipped.doctrines) as Content['doctrines'],
      versusRules: reversed(shipped.versusRules) as Content['versusRules'],
      versusModes: reversed(shipped.versusModes) as Content['versusModes'],
      // key order inside each formation, NOT the order of the list (that is content, tested below)
      formations: (shipped.formations as unknown[]).map(reversed),
    };
    // The control: the reversal really changed the text an unsorted hash would see.
    expect(JSON.stringify(turned.units)).not.toBe(JSON.stringify(shipped.units));
    expect(contentDigest(turned)).toBe(contentDigest(shipped));
  });

  it('one unit\'s hp changed by one is a different digest; put back, it is the same', () => {
    expect(contentDigest(withInfHp(infSquad.hull.hp + 1))).not.toBe(shippedContentDigest());
    expect(contentDigest(withInfHp(infSquad.hull.hp))).toBe(shippedContentDigest());
  });

  it('N3: one doctrine value and one versus-rules rate each count; put back, the same', () => {
    const shipped = shippedContent();
    const withDoctrine = (by: number): Content => ({
      ...shipped,
      doctrines: { ...doctrines, kdf: { ...doctrines.kdf, budget: { ...doctrines.kdf.budget, logistics_start: doctrines.kdf.budget.logistics_start + by } } },
    });
    expect(contentDigest(withDoctrine(1))).not.toBe(shippedContentDigest());
    expect(contentDigest(withDoctrine(0))).toBe(shippedContentDigest());
    const tel = versusRules.tel_marum;
    const withRate = (by: number): Content => ({
      ...shipped,
      versusRules: { ...versusRules, tel_marum: { ...tel, income_zones: tel.income_zones.map((z, i) => (i === 0 ? { ...z, rate_per_min: z.rate_per_min + by } : z)) } },
    });
    expect(contentDigest(withRate(1))).not.toBe(shippedContentDigest());
    expect(contentDigest(withRate(0))).toBe(shippedContentDigest());
  });

  it('GH-859 P1a: one formation value counts (min_members 2 -> 3), and put back it is the same', () => {
    const shipped = shippedContent();
    const withMin = (by: number): Content => ({
      ...shipped,
      formations: formations.map((f, i) => (i === 0 ? { ...f, min_members: f.min_members + by } : f)),
    });
    expect(contentDigest(withMin(1))).not.toBe(shippedContentDigest());
    expect(contentDigest(withMin(0))).toBe(shippedContentDigest());
  });

  it('GH-859 P1a: the ORDER formations are registered in counts, because a group row stores an index into it', () => {
    const shipped = shippedContent();
    // literal: the shipped order is ambush, attack, column (sorted directory order)
    expect(formations.map((f) => f.id)).toEqual(['ambush', 'attack', 'column']);
    const swapped: Content = { ...shipped, formations: [formations[1], formations[0], formations[2]] };
    expect((swapped.formations as { id: string }[]).map((f) => f.id).sort()).toEqual(['ambush', 'attack', 'column']); // the same SET of files...
    expect(contentDigest(swapped)).not.toBe(shippedContentDigest()); // ...in another order is another digest
    expect(contentDigest({ ...shipped, formations: [formations[0], formations[1], formations[2]] })).toBe(shippedContentDigest());
  });

  it('a structure, a map row, and array order all count', () => {
    const shipped = shippedContent();
    const house = structures.house;
    expect(contentDigest({ ...shipped, structures: { ...structures, house: { ...house, hp_per_tile: house.hp_per_tile + 1 } } }))
      .not.toBe(shippedContentDigest());
    const tel = maps.tel_marum;
    const rows = [...tel.rows];
    const i = rows.findIndex((r, k) => k + 1 < rows.length && r !== rows[k + 1]);
    [rows[i], rows[i + 1]] = [rows[i + 1], rows[i]];
    expect(rows).not.toEqual(tel.rows);
    expect(contentDigest({ ...shipped, maps: { ...maps, tel_marum: { ...tel, rows } } })).not.toBe(shippedContentDigest());
  });

  it('is stable across two processes', () => {
    // A second Node process, through `tools`' own tsx (the one `pnpm agent` runs on).
    const module = fileURLToPath(new URL('./content-digest.ts', import.meta.url));
    const script = `import { shippedContentDigest } from ${JSON.stringify(module)}; console.log(shippedContentDigest());`;
    const r = spawnSync('pnpm', ['--silent', '--filter', '@lions/tools', 'exec', 'tsx', '--eval', script], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(Number(r.stdout.trim())).toBe(shippedContentDigest());
  }, 60_000);
});
