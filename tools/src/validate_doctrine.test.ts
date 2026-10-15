// N3 prep (network lane; LD2 and LD3, ruled 16 Oct): data/doctrines/*.json, its schema, and the
// rules tools/validate_doctrine.mjs holds over it. Its own module for the reason every
// validate_*.mjs is one: validate_data.mjs runs its whole sweep at import time and exits.
//
// The one check the plain-node sweep cannot make lives here: the Sarim menu is the shipped
// VERSUS_SARIM's unit types plus `recoilless_team` (LD3), and the KDF menu is VERSUS_KDF's types,
// both computed from the constants in packages/app/src/net/versus-force.ts, so a force change
// that the doctrine does not follow goes red.
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
    const top = { ...clone(byFaction('kdf')), pop_cap: 20 };
    expect(validate(top)).toBe(false);
    const inner = clone(byFaction('kdf'));
    (inner.budget as Record<string, unknown>).logistics_rate_per_min = 0;
    expect(validate(inner)).toBe(false);
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
