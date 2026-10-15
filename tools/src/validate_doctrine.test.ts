// N3 prep (network lane; LD2 and LD3, ruled 16 Oct): data/doctrines/*.json, its schema, and the
// rules tools/validate_doctrine.mjs holds over it. Its own module for the reason every
// validate_*.mjs is one: validate_data.mjs runs its whole sweep at import time and exits.
//
// The one check the plain-node sweep cannot make lives here: the Sarim menu is the shipped
// VERSUS_SARIM's unit types plus `recoilless_team` (LD3), and the KDF menu is VERSUS_KDF's types,
// both computed from the constants in packages/app/src/net/versus-force.ts, so a force change
// that the doctrine does not follow goes red.
//
// kdf.json's menu holds `recon_drone`, population 0: like the `loiter_drone` LD3 keeps off the
// Sarim menu, it is bounded by the purse alone, since no cap refuses population 0 (F3 C-R8).
// The later pass that sets `pop_cap` values should keep that in mind.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  BANNED_MENU_UNITS,
  OPPOSITION_FACTIONS,
  SARIM_BUDGET_RATIO,
  doctrineFailures,
} from '../validate_doctrine.mjs';
import { VERSUS_KDF, VERSUS_SARIM } from '../../packages/app/src/net/versus-force';

const ROOT = join(__dirname, '..', '..');

interface Doctrine {
  id: string;
  faction: 'kdf' | 'sarim';
  name: string;
  menu: string[];
  budget: { logistics_start: number; status: string };
}

function jsonIn(dir: string): { file: string; doc: unknown }[] {
  const out: { file: string; doc: unknown }[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile() && e.name.endsWith('.json')) {
      const path = join(e.parentPath, e.name);
      out.push({ file: path.slice(ROOT.length + 1), doc: JSON.parse(readFileSync(path, 'utf8')) });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

const shipped = jsonIn(join(ROOT, 'data', 'doctrines'));
const unitsById = new Map(
  jsonIn(join(ROOT, 'data', 'units')).map(({ doc }) => [(doc as { id: string }).id, doc as { faction: string }]),
);
const byFaction = (f: 'kdf' | 'sarim'): Doctrine => {
  const found = shipped.filter(({ doc }) => (doc as Doctrine).faction === f);
  expect(found, `one ${f} doctrine`).toHaveLength(1);
  return found[0].doc as Doctrine;
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** The two shipped doctrines, deep-copied, for a fixture to mutate one field of. */
const pair = (): { file: string; doc: Doctrine }[] => [
  { file: 'kdf.json', doc: clone(byFaction('kdf')) },
  { file: 'sarim.json', doc: clone(byFaction('sarim')) },
];
const typesOf = (force: readonly (readonly [string, number, number])[]): string[] => [...new Set(force.map(([id]) => id))];

describe('the shipped doctrines', () => {
  it('pass every rule', () => {
    expect(shipped.map(({ file }) => file)).toEqual(['data/doctrines/kdf.json', 'data/doctrines/sarim.json']);
    expect(doctrineFailures(shipped, unitsById)).toEqual([]);
  });

  it("Sarim's menu is VERSUS_SARIM's types plus recoilless_team, and nothing else (LD3)", () => {
    const versus = typesOf(VERSUS_SARIM);
    expect(versus).not.toContain('recoilless_team'); // else "plus" would add nothing
    expect([...byFaction('sarim').menu].sort()).toEqual([...versus, 'recoilless_team'].sort());
  });

  it("KDF's menu is VERSUS_KDF's types (LD3, a matched room)", () => {
    expect([...byFaction('kdf').menu].sort()).toEqual(typesOf(VERSUS_KDF).sort());
  });

  it('no menu holds loiter_drone (LD3)', () => {
    expect(BANNED_MENU_UNITS).toContain('loiter_drone');
    for (const { doc } of shipped) expect((doc as Doctrine).menu).not.toContain('loiter_drone');
  });

  it('Sarim starts with exactly 1.6x the KDF purse (G3 Q7), and both numbers say they are provisional', () => {
    expect(SARIM_BUDGET_RATIO).toEqual([8, 5]);
    const k = byFaction('kdf').budget;
    const s = byFaction('sarim').budget;
    expect(s.logistics_start * 5).toBe(k.logistics_start * 8);
    // Placeholders pending G4's re-sweep: no balance is claimed for either number.
    expect([k.status, s.status]).toEqual(['provisional', 'provisional']);
  });
});

describe('doctrineFailures, one mutation at a time', () => {
  it('refuses loiter_drone on a menu, citing LD3', () => {
    const d = pair();
    d[1].doc.menu.push('loiter_drone');
    const out = doctrineFailures(d, unitsById);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('loiter_drone');
    expect(out[0]).toContain('LD3');
  });

  it('refuses a unit id that does not exist', () => {
    const d = pair();
    d[1].doc.menu[0] = 'sarim_rifle';
    expect(doctrineFailures(d, unitsById)).toEqual([
      'sarim.json: menu names "sarim_rifle", which is not a unit id in data/units',
    ]);
  });

  it('refuses a KDF unit on the Sarim menu and an opposition unit on the KDF menu', () => {
    expect(OPPOSITION_FACTIONS).toEqual(['sarim', 'rif', 'ashwar']);
    const d = pair();
    d[1].doc.menu.push('inf_squad');
    d[0].doc.menu.push('atgm_cell');
    const out = doctrineFailures(d, unitsById);
    expect(out).toHaveLength(2);
    expect(out.join('\n')).toContain('"atgm_cell" (faction sarim) on a KDF doctrine');
    expect(out.join('\n')).toContain('"inf_squad" (faction kdf) on a Sarim doctrine');
  });

  it('refuses a budget off 1.6x by one logistics point, either way', () => {
    for (const delta of [-1, 1]) {
      const d = pair();
      d[1].doc.budget.logistics_start += delta;
      const out = doctrineFailures(d, unitsById);
      expect(out).toHaveLength(1);
      expect(out[0]).toContain('G3 Q7');
    }
  });

  it('an empty set names both missing factions', () => {
    expect(doctrineFailures([], unitsById)).toEqual([
      'data/doctrines: no KDF doctrine (N3 needs one per seat faction)',
      'data/doctrines: no Sarim doctrine (N3 needs one per seat faction)',
    ]);
  });

  it("refuses an id that is not the doctrine's faction", () => {
    const d = pair();
    d[0].doc.id = 'sarim';
    expect(doctrineFailures(d, unitsById)).toEqual([
      'kdf.json: id "sarim" is not its faction "kdf" -- a doctrine\'s id is its faction',
    ]);
  });

  it('refuses a missing faction and a second doctrine of one faction', () => {
    expect(doctrineFailures([pair()[0]], unitsById)).toEqual([
      'data/doctrines: no Sarim doctrine (N3 needs one per seat faction)',
    ]);
    const d = pair();
    const out = doctrineFailures([...d, { file: 'sarim2.json', doc: clone(d[1].doc) }], unitsById);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('a second "sarim" doctrine');
  });
});

describe('doctrine.schema.json', () => {
  const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
  const ajv = new (Ajv2020 as unknown as new (o: object) => {
    compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown };
  })({ allErrors: true, strict: false });
  const validate = ajv.compile(
    JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', 'doctrine.schema.json'), 'utf8')) as object,
  );

  it('accepts both shipped doctrines', () => {
    for (const { file, doc } of shipped) expect(validate(doc), file).toBe(true);
  });

  it('refuses an extra property at the top and inside the budget', () => {
    const top = { ...clone(byFaction('kdf')), commander: 'g_g0' };
    expect(validate(top)).toBe(false);
    const inner = clone(byFaction('kdf'));
    (inner.budget as Record<string, unknown>).logistics_rate_per_min = 0;
    expect(validate(inner)).toBe(false);
  });

  it('takes an optional pop_cap, an integer of at least 1, set in no shipped doctrine yet', () => {
    expect(validate({ ...clone(byFaction('sarim')), pop_cap: 27 })).toBe(true);
    expect(validate({ ...clone(byFaction('sarim')), pop_cap: 0 })).toBe(false);
    expect(validate({ ...clone(byFaction('sarim')), pop_cap: 1.5 })).toBe(false);
    for (const { doc } of shipped) expect(doc).not.toHaveProperty('pop_cap');
  });

  it('refuses each required key missing', () => {
    for (const key of ['id', 'faction', 'name', 'menu', 'budget']) {
      const d = clone(byFaction('kdf')) as unknown as Record<string, unknown>;
      delete d[key];
      expect(validate(d), key).toBe(false);
    }
    for (const key of ['logistics_start', 'status']) {
      const d = clone(byFaction('kdf'));
      delete (d.budget as Record<string, unknown>)[key];
      expect(validate(d), `budget.${key}`).toBe(false);
    }
  });

  it('refuses an unknown status, an empty name and an id outside the pattern', () => {
    const status = clone(byFaction('kdf'));
    status.budget.status = 'final';
    expect(validate(status)).toBe(false);
    expect(validate({ ...clone(byFaction('kdf')), name: '' })).toBe(false);
    expect(validate({ ...clone(byFaction('kdf')), id: 'KDF' })).toBe(false);
    expect(validate({ ...clone(byFaction('kdf')), id: 'kdf-2' })).toBe(false);
  });

  it('holds logistics_start to 1..894784, the most an Int32 purse in 1/2400ths can start with', () => {
    expect(894784 * 2400).toBeLessThanOrEqual(2 ** 31 - 1);
    expect(894785 * 2400).toBeGreaterThan(2 ** 31 - 1);
    const at = (n: number) => {
      const d = clone(byFaction('kdf'));
      d.budget.logistics_start = n;
      return validate(d);
    };
    expect([at(0), at(1), at(894784), at(894785)]).toEqual([false, true, true, false]);
  });

  it('refuses a repeated menu id, an empty menu, a third faction and a fractional purse', () => {
    const repeat = clone(byFaction('sarim'));
    repeat.menu.push(repeat.menu[0]);
    expect(validate(repeat)).toBe(false);
    expect(validate({ ...clone(byFaction('sarim')), menu: [] })).toBe(false);
    expect(validate({ ...clone(byFaction('sarim')), faction: 'rif' })).toBe(false);
    const frac = clone(byFaction('sarim'));
    frac.budget.logistics_start = 4800.5;
    expect(validate(frac)).toBe(false);
  });
});

describe('validate_data.mjs wiring', () => {
  // The sweep runs at import time, so the call site cannot be imported; pin it as text.
  it('validates data/doctrines against the schema and calls doctrineFailures', () => {
    const src = readFileSync(join(ROOT, 'tools', 'validate_data.mjs'), 'utf8');
    expect(src).toContain("from './validate_doctrine.mjs'");
    expect(src).toContain("validateDir(join(ROOT, 'data/doctrines'), validators.doctrine, 'doctrine.schema')");
    expect(src).toContain('failures.push(...doctrineFailures(doctrines, doctrineUnits))');
  });
});
