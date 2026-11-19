// N3 prep (network lane; LD2 and LD3, ruled 16 Oct): data/doctrines/*.json, its schema, and the
// rules tools/validate_doctrine.mjs holds over it. Its own module for the reason every
// validate_*.mjs is one: validate_data.mjs runs its whole sweep at import time and exits.
//
// The one check the plain-node sweep cannot make lives here: the Sarim menu is the shipped
// VERSUS_SARIM's unit types plus `recoilless_team` (LD3), and the KDF menu is VERSUS_KDF's types
// plus `yahalom_squad` (ruled 15 Oct, lead, #681: the one KDF answer to the Sarim seat's tunnels),
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
  OP_ORDER,
  PICKS_PER_FACTION,
  PRICE_STEP_PCT,
  SARIM_BUDGET_RATIO,
  doctrineFailures,
  doctrinePickFailures,
  neutralCap,
  resolvePick,
  storeSpecialIds,
} from '../validate_doctrine.mjs';
import { VERSUS_KDF, VERSUS_SARIM } from '../../packages/app/src/net/versus-force';
import { VERSUS_HELD_UNITS, versusRoster } from '../../packages/app/src/net/versus-roster';
import { STORE_SPECIALS } from '../../packages/worker/src/match/store-specials';
import { doctrinePicks, doctrines as dataDoctrines, resolveDoctrine } from '@lions/data';

const ROOT = join(__dirname, '..', '..');

interface Doctrine {
  id: string;
  faction: 'kdf' | 'sarim';
  name: string;
  menu: string[];
  budget: { logistics_start: number; status: string };
}

/** Every JSON file under `dir`, recursively, minus the sub-directories `skip` names (as validate_data.mjs's `jsonFilesIn`). */
function jsonIn(dir: string, skip: string[] = []): { file: string; doc: unknown }[] {
  const out: { file: string; doc: unknown }[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (skip.includes(e.parentPath.slice(dir.length + 1).split(/[\\/]/)[0])) continue;
    if (e.isFile() && e.name.endsWith('.json')) {
      const path = join(e.parentPath, e.name);
      out.push({ file: path.slice(ROOT.length + 1), doc: JSON.parse(readFileSync(path, 'utf8')) });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

// GH-1383: data/doctrines/picks/ holds the doctrine PICKS, which are not base doctrines (validate_data.mjs skips them the same way).
const shipped = jsonIn(join(ROOT, 'data', 'doctrines'), ['picks']);
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

  it("KDF's menu is VERSUS_KDF's types plus yahalom_squad and inf_medic_squad (LD3; ruled 15 Oct, lead, #681; the medic team 3 Nov 2026, GH-707)", () => {
    // On the MENU, not in the placed force: fielding one in VERSUS_KDF moved the mirror
    // (kdf/kdf) probe outside 60/40 on three open maps (PR table), and the placed force
    // is what a room fights with until production lands. The medic team (GH-707) is bought, never placed.
    const versus = typesOf(VERSUS_KDF);
    expect(versus).not.toContain('yahalom_squad'); // else "plus" would add nothing
    expect(versus).not.toContain('inf_medic_squad');
    expect([...byFaction('kdf').menu].sort()).toEqual([...versus, 'yahalom_squad', 'inf_medic_squad'].sort());
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

  it('takes an optional pop_cap, an integer of at least 1, set in both shipped doctrines (Q4: KDF 40, Sarim 56)', () => {
    expect(validate({ ...clone(byFaction('sarim')), pop_cap: 27 })).toBe(true);
    expect(validate({ ...clone(byFaction('sarim')), pop_cap: 0 })).toBe(false);
    expect(validate({ ...clone(byFaction('sarim')), pop_cap: 1.5 })).toBe(false);
    expect(byFaction('kdf')).toHaveProperty('pop_cap', 40);
    expect(byFaction('sarim')).toHaveProperty('pop_cap', 56);
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
    expect(src).toContain("validateDir(join(ROOT, 'data/doctrines'), validators.doctrine, 'doctrine.schema', ['picks'])");
    expect(src).toContain("jsonFilesIn(join(ROOT, 'data/doctrines'), ['picks'])");
    expect(src).toContain('failures.push(...doctrineFailures(doctrines, doctrineUnits))');
  });

  it('validates data/doctrines/picks against its own schema, runs P1-P10 and the cost-curve gate (GH-1383)', () => {
    const src = readFileSync(join(ROOT, 'tools', 'validate_data.mjs'), 'utf8');
    expect(src).toContain("validateDir(join(ROOT, 'data/doctrines/picks'), validators.doctrinePick, 'doctrine_pick.schema')");
    expect(src).toContain('failures.push(...doctrinePickFailures(picks, doctrines, doctrineUnits, pickEn, formationIds))');
    expect(src).toContain("spawnSync('python3', ['tools/doctrine_balance.py', '--upgrade-cost-factor', '0.02', '--json']");
  });

  it('without the skip, every pick would fail the base rules (the fix is load-bearing)', () => {
    const all = jsonIn(join(ROOT, 'data', 'doctrines'));
    expect(all.length).toBe(shipped.length + Object.keys(doctrinePicks).length);
    const out = doctrineFailures(all, unitsById);
    for (const id of Object.keys(doctrinePicks)) expect(out.join('\n')).toContain(`data/doctrines/picks/${id}.json: id "${id}" is not its faction`);
  });
});

// --- GH-1383 slice 1: the doctrine picks, P1-P10 and T5 -------------------------------------------
interface Pick {
  id: string;
  extends: 'kdf' | 'sarim';
  label: string;
  blurb: string;
  gives_up: string;
  signature: { formation: string };
  status: string;
  ops: Record<string, unknown>[];
}
const shippedPicks = jsonIn(join(ROOT, 'data', 'doctrines', 'picks'));
const en = JSON.parse(readFileSync(join(ROOT, 'packages', 'app', 'src', 'i18n', 'en.json'), 'utf8')) as Record<string, string>;
const formationIds = jsonIn(join(ROOT, 'data', 'formations')).map(({ doc }) => (doc as { id: string }).id);
const picksCopy = (): { file: string; doc: Pick }[] => shippedPicks.map(({ file, doc }) => ({ file, doc: clone(doc as Pick) }));
const pickFails = (p: { file: string; doc: unknown }[], b: { file: string; doc: unknown }[] = shipped): string[] =>
  doctrinePickFailures(p, b, unitsById, en, formationIds);
/** The shipped picks with the one named pick edited by `edit`; returns every failure. */
const mutate = (id: string, edit: (p: Pick) => void): string[] => {
  const p = picksCopy();
  const hit = p.find(({ doc }) => doc.id === id);
  if (!hit) throw new Error(`no pick ${id}`);
  edit(hit.doc);
  return pickFails(p);
};
const opOf = (p: Pick, kind: string): Record<string, unknown> => {
  const o = p.ops.find((x) => x.op === kind);
  if (!o) throw new Error(`${p.id} has no ${kind}`);
  return o;
};

describe('the shipped doctrine picks', () => {
  it('are the six, and pass P1-P10', () => {
    expect(shippedPicks.map(({ file }) => file)).toEqual([
      'data/doctrines/picks/kdf_airmobile.json',
      'data/doctrines/picks/kdf_armour.json',
      'data/doctrines/picks/kdf_urban.json',
      'data/doctrines/picks/sarim_militia.json',
      'data/doctrines/picks/sarim_raid.json',
      'data/doctrines/picks/sarim_standoff.json',
    ]);
    expect(pickFails(shippedPicks)).toEqual([]);
    for (const { doc } of shippedPicks) expect((doc as Pick).status).toBe('proposed');
  });

  it('the constants are the rulings: three per faction, the canonical order, a 10% price step', () => {
    expect(PICKS_PER_FACTION).toBe(3);
    expect(OP_ORDER).toEqual(['menu_remove', 'menu_add', 'set_pop_cap', 'set_price']);
    expect(PRICE_STEP_PCT).toBe(10);
  });

  it('P4 (app half): every added unit is in versusRoster(), none is held out of a room', () => {
    const roster = new Set(versusRoster().map((u) => u.id));
    let n = 0;
    for (const { doc } of shippedPicks) {
      for (const id of (opOf(doc as Pick, 'menu_add').units as string[])) {
        n++;
        expect(roster.has(id), id).toBe(true);
        expect(VERSUS_HELD_UNITS.has(id), id).toBe(false);
      }
    }
    expect(n).toBe(10);
  });

  it("P4: the validator's Store specials are the Worker's STORE_SPECIALS, both ways", () => {
    expect(STORE_SPECIALS.length).toBeGreaterThan(0);
    expect([...storeSpecialIds(unitsById)].sort()).toEqual([...STORE_SPECIALS].sort());
  });

  it("the validator's resolvePick reads every pick as @lions/data's resolveDoctrine does", () => {
    expect(Object.keys(doctrinePicks)).toHaveLength(6);
    for (const [id, p] of Object.entries(doctrinePicks)) {
      const ts = resolveDoctrine(dataDoctrines[p.extends], p);
      const js = resolvePick(dataDoctrines[p.extends], p);
      expect(js.menu, id).toEqual(ts.menu);
      expect(js.prices, id).toEqual(ts.prices);
      expect(js.popCap, id).toBe(ts.popCap);
    }
  });

  it('neutralCap: the base is its own neutral cap, and kdf_armour is 42 (design Appendix A, by hand: 40 x 1.4 / 1.333)', () => {
    expect(neutralCap(40, byFaction('kdf').menu, byFaction('kdf').menu, unitsById)).toBe(40);
    expect(neutralCap(56, byFaction('sarim').menu, byFaction('sarim').menu, unitsById)).toBe(56);
    const armour = resolvePick(byFaction('kdf'), doctrinePicks.kdf_armour);
    expect(neutralCap(40, byFaction('kdf').menu, armour.menu, unitsById)).toBe(42);
  });
});

describe('doctrinePickFailures, one data mutation per rule', () => {
  const has = (out: string[], rule: string, text: string) => {
    expect(out.length, out.join('\n')).toBeGreaterThan(0);
    expect(out.some((l) => l.includes(rule) && l.includes(text)), out.join('\n')).toBe(true);
  };

  it('P1: extends no base, a prefix off its faction, an id off its filename', () => {
    has(mutate('kdf_armour', (p) => { p.extends = 'rif' as 'kdf'; }), 'P1', 'which is no base doctrine');
    has(mutate('sarim_raid', (p) => { p.extends = 'kdf'; }), 'P1', 'does not start with its faction "kdf_"');
    has(mutate('kdf_urban', (p) => { p.id = 'kdf_city'; }), 'P1', 'is not its filename "kdf_urban"');
  });

  it('P2: a fourth pick of one faction, and a missing one', () => {
    const p = picksCopy();
    const extra = clone(p[0]);
    extra.file = 'data/doctrines/picks/kdf_extra.json';
    extra.doc.id = 'kdf_extra';
    extra.doc.signature.formation = 'kdf_extra_sig';
    has(pickFails([...p, extra]), 'P2', '4 "kdf" picks');
    has(pickFails(p.slice(1)), 'P2', '2 "kdf" picks');
  });

  it('P3: ops out of order, a kind twice, prices out of unit order', () => {
    has(mutate('kdf_armour', (p) => { p.ops.reverse(); }), 'P3', 'the order is');
    has(mutate('kdf_armour', (p) => { p.ops.splice(1, 0, { op: 'menu_remove', units: ['mortar_team'] }); }), 'P3', '2 "menu_remove" ops');
    has(mutate('kdf_armour', (p) => { const [a, b] = [p.ops[3], p.ops[4]]; p.ops[3] = b; p.ops[4] = a; }), 'P3', 'sorted by unit id');
  });

  it('P4: a removal off the base, an addition on it, the other side, loiter_drone, a Store special', () => {
    has(mutate('kdf_armour', (p) => { (opOf(p, 'menu_remove').units as string[]).push('apc_kipod'); }), 'P4', 'is not on the kdf base menu');
    has(mutate('kdf_armour', (p) => { (opOf(p, 'menu_add').units as string[]).push('mortar_team'); }), 'P4', 'is already on the kdf base menu');
    has(mutate('kdf_armour', (p) => { (opOf(p, 'menu_add').units as string[]).push('technical'); }), 'P4', 'on a KDF pick');
    has(mutate('sarim_raid', (p) => { (opOf(p, 'menu_add').units as string[]).push('sniper_team'); }), 'P4', 'on a Sarim pick');
    has(mutate('kdf_armour', (p) => { (opOf(p, 'menu_add').units as string[]).push('loiter_drone'); }), 'P4', 'LD3');
    has(mutate('kdf_airmobile', (p) => { (opOf(p, 'menu_add').units as string[]).push('heli_peten_gunship'); }), 'P4', 'Store special');
  });

  it('P5: a pick that removes nothing, and one that adds nothing', () => {
    has(mutate('sarim_standoff', (p) => { p.ops = p.ops.filter((o) => o.op !== 'menu_remove'); }), 'P5', 'removes no base unit');
    has(mutate('sarim_standoff', (p) => { p.ops = p.ops.filter((o) => o.op !== 'menu_add' && o.unit !== 'mortar_crew'); }), 'P5', 'adds no unit');
  });

  it('P7: a price for a unit off the resolved menu, and one moved past 10%', () => {
    has(mutate('kdf_armour', (p) => { p.ops.push({ op: 'set_price', unit: 'yahalom_squad', logistics: 260 }); }), 'P7', 'not on the resolved menu');
    has(mutate('kdf_armour', (p) => { opOf(p, 'set_price').logistics = 212; }), 'P7', 'by more than 10%');
    // 236 -> 260 is +10.2%, 236 -> 259 is +9.7%: the bound is inclusive and exact.
    expect(mutate('kdf_armour', (p) => { opOf(p, 'set_price').logistics = 259; }).filter((l) => l.includes('P7'))).toEqual([]);
  });

  it('P8: a cap off the neutral rule, and a missing cap where the rule moves it', () => {
    has(mutate('kdf_armour', (p) => { opOf(p, 'set_pop_cap').value = 43; }), 'P8', 'is not the neutral cap 42');
    has(mutate('sarim_raid', (p) => { p.ops = p.ops.filter((o) => o.op !== 'set_pop_cap'); }), 'P8', "cap 56 (the base's, no set_pop_cap) is not the neutral cap 44");
  });

  it('P9 (slice 1 half): a signature shared by two picks, and a signature that is a shipped formation', () => {
    has(mutate('kdf_urban', (p) => { p.signature.formation = 'kdf_armour_thrust'; }), 'P9', "already kdf_armour's");
    has(mutate('kdf_urban', (p) => { p.signature.formation = 'column'; }), 'P9', 'shipped data/formations id');
  });

  it('P10: a label, a blurb and a gives_up key that en.json does not have', () => {
    has(mutate('sarim_militia', (p) => { p.label = 'doctrine.sarim_militia.title'; }), 'P10', 'label key');
    has(mutate('sarim_militia', (p) => { p.blurb = 'doctrine.sarim_militia.blurbs'; }), 'P10', 'blurb key');
    has(mutate('sarim_militia', (p) => { p.gives_up = 'doctrine.sarim_militia.give_up'; }), 'P10', 'gives_up key');
  });
});

describe('T5: no doctrine is a superset of another (P6)', () => {
  it('refuses the base plus scout_shachaf with nothing removed (P5 and P6, against the base)', () => {
    const p = picksCopy();
    const sup = clone(p.find(({ doc }) => doc.id === 'kdf_airmobile') as { file: string; doc: Pick });
    sup.doc.ops = [{ op: 'menu_add', units: ['scout_shachaf'] }];
    const out = pickFails(p.map((x) => (x.doc.id === 'kdf_airmobile' ? sup : x)));
    expect(out.some((l) => l.includes('P5') && l.includes('removes no base unit'))).toBe(true);
    expect(out).toContain("data/doctrines/picks/kdf_airmobile.json: P6 its menu contains all of kdf's -- no doctrine is a superset of another");
  });

  it("refuses a menu that is kdf_urban's plus kdf_armour's (P6, against both)", () => {
    const p = picksCopy();
    const sup = clone(p.find(({ doc }) => doc.id === 'kdf_airmobile') as { file: string; doc: Pick });
    sup.doc.ops = [
      { op: 'menu_remove', units: ['heli_peten'] },
      { op: 'menu_add', units: ['apc_kipod', 'breach_team', 'demo_squad'] },
      { op: 'set_pop_cap', value: 39 },
    ];
    const out = pickFails(p.map((x) => (x.doc.id === 'kdf_airmobile' ? sup : x)));
    expect(out.filter((l) => l.includes('P6'))).toEqual([
      "data/doctrines/picks/kdf_airmobile.json: P6 its menu contains all of kdf_armour's -- no doctrine is a superset of another",
      "data/doctrines/picks/kdf_airmobile.json: P6 its menu contains all of kdf_urban's -- no doctrine is a superset of another",
    ]);
  });

  it('the shipped six: each holds a unit no other menu of its faction does', () => {
    for (const f of ['kdf', 'sarim'] as const) {
      const menus = Object.values(doctrinePicks).filter((p) => p.extends === f).map((p) => resolveDoctrine(dataDoctrines[f], p).menu);
      expect(menus).toHaveLength(3);
      for (const m of menus) {
        const others = [dataDoctrines[f].menu, ...menus.filter((x) => x !== m)];
        expect(m.some((u) => others.every((o) => !o.includes(u)))).toBe(true);
      }
    }
  });
});
