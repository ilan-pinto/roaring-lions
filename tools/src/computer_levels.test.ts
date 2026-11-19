// GH-1389: data/computer/levels.json, its schema, and the rules tools/validate_computer_levels.mjs holds over it -- above
// all that no level can carry a hidden income or vision boost, and that what the ladder prints about boosts is derived from
// the level data. Every fixture is the shipped file deep-copied with ONE thing changed.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { computerLevels, withholdOf, type ComputerLevelCatalogue } from '@lions/data';
import { computerLevelFailures, levelBoosts, withheldValue } from '../validate_computer_levels.mjs';
import { VERSUS_KDF } from '../../packages/app/src/net/versus-force';
import en from '../../packages/app/src/i18n/en.json';
import { ladderTable } from './backtest/computer-ladder-gate';
import { levelStatements } from './backtest/computer-ladder-match';

const ROOT = join(__dirname, '..', '..');
const FILE = 'data/computer/levels.json';
const shipped = JSON.parse(readFileSync(join(ROOT, FILE), 'utf8')) as ComputerLevelCatalogue;
const clone = (): { levels: Record<string, unknown>[] } => JSON.parse(JSON.stringify(shipped)) as { levels: Record<string, unknown>[] };

const unitsById = new Map<string, { id: string; faction: string; cost?: { logistics?: number } }>();
for (const e of readdirSync(join(ROOT, 'data', 'units'), { withFileTypes: true, recursive: true })) {
  if (!e.isFile() || !e.name.endsWith('.json')) continue;
  const u = JSON.parse(readFileSync(join(e.parentPath, e.name), 'utf8')) as { id: string; faction: string; cost?: { logistics?: number } };
  unitsById.set(u.id, u);
}

const Ajv = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const ajv = new (Ajv as unknown as new (o: object) => { compile(s: object): ((d: unknown) => boolean) & { errors?: unknown[] | null } })({ allErrors: true, strict: false });
const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'data/schemas/computer_levels.schema.json'), 'utf8')) as object);
const failures = (doc: unknown): string[] => computerLevelFailures({ file: FILE, doc }, unitsById);

describe('the shipped levels', () => {
  it('pass the schema and every cross-file rule', () => {
    expect(validate(shipped), JSON.stringify(validate.errors)).toBe(true);
    expect(failures(shipped)).toEqual([]);
  });

  it('are the catalogue @lions/data exports, easy, medium, hard', () => {
    expect(computerLevels).toEqual(shipped);
    expect(shipped.levels.map((l) => l.id)).toEqual(['easy', 'medium', 'hard']);
  });

  it('withhold no more of a unit than the placed force fields (VERSUS_KDF), so every count is a real unit left home', () => {
    const fielded = new Map<string, number>();
    for (const [id] of VERSUS_KDF) fielded.set(id, (fielded.get(id) ?? 0) + 1);
    for (const l of shipped.levels) {
      for (const [id, n] of Object.entries(withholdOf(l))) {
        expect(fielded.get(id) ?? 0, `${l.id}: ${id}`).toBeGreaterThanOrEqual(n);
      }
    }
  });

  it('name en.json keys that exist, for the label and the stated handicap', () => {
    const cat = en as Record<string, string>;
    for (const l of shipped.levels) {
      expect(cat[l.label_key], l.label_key).toBeTruthy();
      expect(cat[l.blurb_key], l.blurb_key).toBeTruthy();
    }
  });
});

describe('a hidden boost is refused', () => {
  it('the schema refuses a hidden-income field on a level', () => {
    const d = clone();
    d.levels[2].income_share = 1.5;
    expect(validate(d)).toBe(false);
  });

  it('the schema refuses a vision field on a level, and any field inside a withhold row', () => {
    const v = clone();
    v.levels[1].reveal_map = true;
    expect(validate(v)).toBe(false);
    const w = clone();
    (w.levels[0].withhold as Record<string, unknown>[])[0].purse_bonus = 400;
    expect(validate(w)).toBe(false);
  });

  it('the cross-file sweep refuses the same hidden income and vision, as a second lock behind the schema', () => {
    const i = clone();
    i.levels[2].income_share = 1.5;
    expect(failures(i).join('\n')).toMatch(/level "hard" carries an income field \(income_share\)/);
    const v = clone();
    v.levels[0].fog = 'off';
    expect(failures(v).join('\n')).toMatch(/level "easy" carries a vision field \(fog\)/);
  });
});

describe('what a level boosts is derived from its data', () => {
  it('reads no for income and vision on every shipped level, and yes on a level that carries either', () => {
    for (const l of shipped.levels) expect(levelBoosts(l), l.id).toMatchObject({ income: false, vision: false });
    expect(levelBoosts({ ...shipped.levels[2], logistics_bonus: 600 })).toMatchObject({ income: true, vision: false });
    expect(levelBoosts({ ...shipped.levels[2], extra: { sight_tiles: 4 } })).toMatchObject({ income: false, vision: true });
  });

  it("the ladder's statements are levelBoosts' reading of each level, and its table prints YES for a boost", () => {
    const st = levelStatements();
    expect(st.map((s) => [s.level, s.income, s.vision])).toEqual(shipped.levels.map((l) => [l.id, levelBoosts(l).income, levelBoosts(l).vision]));
    // The same derivation over a catalogue that carries a boost reads it: the statement is not a literal "no".
    const boosted = clone();
    boosted.levels[1].income_share = 2;
    const read = levelStatements(boosted as unknown as ComputerLevelCatalogue);
    expect(read.map((s) => s.income)).toEqual([false, true, false]);
    expect(ladderTable({}, read, [])).toMatch(/\| medium \| [^|]+ \| [^|]+ \| YES \| no \|/);
    expect(ladderTable({}, st, [])).not.toMatch(/YES/);
  });

  it('the force share it prints rises strictly from easy to hard, and hard fields the whole force', () => {
    const shares = levelStatements().map((s) => s.forceShare);
    expect(shares[0]).toBeLessThan(shares[1]);
    expect(shares[1]).toBeLessThan(shares[2]);
    expect(shares[2]).toBe(1);
  });
});

describe('the cross-file rules', () => {
  it('refuses levels that are not strictly ordered by the value they leave at home', () => {
    const tie = clone();
    tie.levels[1].withhold = JSON.parse(JSON.stringify(tie.levels[0].withhold)) as unknown;
    expect(withheldValue(tie.levels[1], unitsById)).toBe(withheldValue(tie.levels[0], unitsById));
    expect(failures(tie).join('\n')).toMatch(/level "medium" leaves \d+ of value at home, not less than "easy"/);
    const flip = clone();
    flip.levels[2].withhold = [{ unit: 'mbt_lavi', count: 2 }];
    expect(failures(flip).join('\n')).toMatch(/level "hard" leaves 1812 of value at home, not less than "medium"'s 906/);
  });

  it('refuses a unit that is not a KDF unit, an unknown unit, a repeated unit, and levels out of order', () => {
    const sarim = clone();
    sarim.levels[0].withhold = [{ unit: 'atgm_cell', count: 1 }, { unit: 'mbt_lavi', count: 2 }];
    expect(failures(sarim).join('\n')).toMatch(/withholds "atgm_cell" \(faction sarim\)/);
    const ghost = clone();
    ghost.levels[0].withhold = [{ unit: 'no_such_unit', count: 9 }];
    expect(failures(ghost).join('\n')).toMatch(/"no_such_unit", which is not a unit id/);
    const twice = clone();
    twice.levels[0].withhold = [{ unit: 'mbt_lavi', count: 1 }, { unit: 'mbt_lavi', count: 1 }];
    expect(failures(twice).join('\n')).toMatch(/names "mbt_lavi" twice/);
    const order = clone();
    order.levels.reverse();
    expect(failures(order).join('\n')).toMatch(/levels are \[hard, medium, easy\]/);
  });
});
