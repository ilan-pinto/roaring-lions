// GH-1389: data/computer/levels.json, its schema, and the rules tools/validate_computer_levels.mjs holds over it -- above
// all that no level can carry a hidden income or vision boost, and that what the ladder prints about boosts is derived from
// the level data. Every fixture is the shipped file deep-copied with ONE thing changed.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { COMPUTER_FACTIONS, computerLevels, withholdOf, type ComputerLevelCatalogue } from '@lions/data';
import { computerLevelFailures, levelBoosts, placedForcesFromSource, withheldValue, PLACED_FORCE_SOURCES } from '../validate_computer_levels.mjs';
import { VERSUS_KDF, VERSUS_SARIM } from '../../packages/app/src/net/versus-force';
import en from '../../packages/app/src/i18n/en.json';
import { ladderTable } from './backtest/computer-ladder-gate';
import { levelStatements } from './backtest/computer-ladder-match';

const ROOT = join(__dirname, '..', '..');
const FILE = 'data/computer/levels.json';
const shipped = JSON.parse(readFileSync(join(ROOT, FILE), 'utf8')) as ComputerLevelCatalogue;
type Row = { unit: string; count: number };
type LevelDoc = Record<string, unknown> & { withhold: Record<string, Row[]> };
const clone = (): { levels: LevelDoc[] } => JSON.parse(JSON.stringify(shipped)) as { levels: LevelDoc[] };

const unitsById = new Map<string, { id: string; faction: string; cost?: { logistics?: number } }>();
for (const e of readdirSync(join(ROOT, 'data', 'units'), { withFileTypes: true, recursive: true })) {
  if (!e.isFile() || !e.name.endsWith('.json')) continue;
  const u = JSON.parse(readFileSync(join(e.parentPath, e.name), 'utf8')) as { id: string; faction: string; cost?: { logistics?: number } };
  unitsById.set(u.id, u);
}

const Ajv = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const ajv = new (Ajv as unknown as new (o: object) => { compile(s: object): ((d: unknown) => boolean) & { errors?: unknown[] | null } })({ allErrors: true, strict: false });
const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'data/schemas/computer_levels.schema.json'), 'utf8')) as object);
/** The placed forces as the app holds them: one unit id a placement. */
const PLACED = { kdf: VERSUS_KDF.map(([id]) => id), sarim: VERSUS_SARIM.map(([id]) => id) };
const failures = (doc: unknown): string[] => computerLevelFailures({ file: FILE, doc }, unitsById, PLACED);

describe('the shipped levels', () => {
  it('pass the schema and every cross-file rule', () => {
    expect(validate(shipped), JSON.stringify(validate.errors)).toBe(true);
    expect(failures(shipped)).toEqual([]);
  });

  it('are the catalogue @lions/data exports, easy, medium, hard', () => {
    expect(computerLevels).toEqual(shipped);
    expect(shipped.levels.map((l) => l.id)).toEqual(['easy', 'medium', 'hard']);
  });

  it('withhold, per faction, no more of a unit than that faction\'s placed force fields (VERSUS_KDF, VERSUS_SARIM)', () => {
    const forces = { kdf: VERSUS_KDF, sarim: VERSUS_SARIM } as const;
    for (const f of COMPUTER_FACTIONS) {
      const fielded = new Map<string, number>();
      for (const [id] of forces[f]) fielded.set(id, (fielded.get(id) ?? 0) + 1);
      for (const l of shipped.levels) {
        for (const [id, n] of Object.entries(withholdOf(l, f))) {
          expect(fielded.get(id) ?? 0, `${l.id} ${f}: ${id}`).toBeGreaterThanOrEqual(n);
        }
      }
    }
  });

  it('are the lead\'s ruling (GH-1389, 19 Nov 2026): KDF 2, 1, 0 Lavis; Sarim option A, 8, 4, 0 Kornets', () => {
    expect(shipped.levels.map((l) => withholdOf(l, 'kdf'))).toEqual([{ mbt_lavi: 2 }, { mbt_lavi: 1 }, {}]);
    expect(shipped.levels.map((l) => withholdOf(l, 'sarim'))).toEqual([{ atgm_cell: 8 }, { atgm_cell: 4 }, {}]);
  });

  it('the validator reads the placed forces from source exactly as the app holds them', () => {
    const read = placedForcesFromSource(PLACED_FORCE_SOURCES.map((p: string) => readFileSync(join(ROOT, p), 'utf8')));
    expect(read).toEqual(PLACED);
    expect(read.sarim.filter((u: string) => u === 'atgm_cell')).toHaveLength(14);
    expect(() => placedForcesFromSource([])).toThrow(/no `export const VERSUS_KDF/);
    expect(() => placedForcesFromSource(["export const VERSUS_KDF: readonly SandboxPlacement[] = [['mbt_lavi', 0, 0], oops];\nexport const VERSUS_SARIM: readonly SandboxPlacement[] = [['atgm_cell', 1, 0]];"])).toThrow(/not a \['unit', dx, dy\] tuple/);
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
    (w.levels[0].withhold.sarim[0] as Record<string, unknown>).purse_bonus = 400;
    expect(validate(w)).toBe(false);
    const f = clone();
    (f.levels[0].withhold as Record<string, unknown>).rif = [];
    expect(validate(f)).toBe(false);
    const missing = clone();
    delete (missing.levels[1].withhold as Record<string, unknown>).sarim;
    expect(validate(missing)).toBe(false);
    expect(failures(missing).join('\n')).toMatch(/level "medium" states no "sarim" withhold/);
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
    const st = levelStatements('kdf');
    expect(st.map((s) => [s.level, s.income, s.vision])).toEqual(shipped.levels.map((l) => [l.id, levelBoosts(l).income, levelBoosts(l).vision]));
    // The same derivation over a catalogue that carries a boost reads it: the statement is not a literal "no".
    const boosted = clone();
    boosted.levels[1].income_share = 2;
    const read = levelStatements('kdf', boosted as unknown as ComputerLevelCatalogue);
    expect(read.map((s) => s.income)).toEqual([false, true, false]);
    expect(ladderTable({}, read, [])).toMatch(/\| medium \| [^|]+ \| [^|]+ \| YES \| no \|/);
    expect(ladderTable({}, st, [])).not.toMatch(/YES/);
  });

  it('the force share it prints rises strictly from easy to hard, and hard fields the whole force, for either faction', () => {
    for (const f of COMPUTER_FACTIONS) {
      const shares = levelStatements(f).map((s) => s.forceShare);
      expect(shares[0], f).toBeLessThan(shares[1]);
      expect(shares[1], f).toBeLessThan(shares[2]);
      expect(shares[2], f).toBe(1);
    }
  });

  it('the statements are per faction: KDF leaves Lavis home (27.2%, 13.6% of 6,664), Sarim Kornets (27.9%, 14.0% of 6,736)', () => {
    const k = levelStatements('kdf');
    const z = levelStatements('sarim');
    expect(k.map((s) => s.withheld)).toEqual(['2 mbt_lavi', '1 mbt_lavi', 'nothing']);
    expect(z.map((s) => s.withheld)).toEqual(['8 atgm_cell', '4 atgm_cell', 'nothing']);
    expect(k.map((s) => +(100 * (1 - s.forceShare)).toFixed(1))).toEqual([27.2, 13.6, 0]);
    expect(z.map((s) => +(100 * (1 - s.forceShare)).toFixed(1))).toEqual([27.9, 14, 0]);
  });
});

describe('the cross-file rules', () => {
  it('refuses levels that are not strictly ordered by the value they leave at home', () => {
    const tie = clone();
    tie.levels[1].withhold = JSON.parse(JSON.stringify(tie.levels[0].withhold)) as Record<string, Row[]>;
    expect(withheldValue(tie.levels[1], unitsById, 'kdf')).toBe(withheldValue(tie.levels[0], unitsById, 'kdf'));
    expect(failures(tie).join('\n')).toMatch(/level "medium" leaves \d+ of kdf value at home, not less than "easy"/);
    expect(failures(tie).join('\n')).toMatch(/level "medium" leaves 1880 of sarim value at home, not less than "easy"'s 1880/);
    const flip = clone();
    flip.levels[2].withhold.kdf = [{ unit: 'mbt_lavi', count: 2 }];
    expect(failures(flip).join('\n')).toMatch(/level "hard" leaves 1812 of kdf value at home, not less than "medium"'s 906/);
  });

  it('holds the order per faction: Sarim levels that are not strictly ordered fail though KDF is clean', () => {
    const tie = clone();
    tie.levels[1].withhold.sarim = [{ unit: 'atgm_cell', count: 8 }];
    const lines = failures(tie);
    expect(lines.join('\n')).toMatch(/level "medium" leaves 1880 of sarim value at home, not less than "easy"'s 1880/);
    expect(lines.some((x) => / kdf /.test(x))).toBe(false);
  });

  it('refuses, per faction, a level that does not withhold everything the level above it does (easy ⊇ medium ⊇ hard)', () => {
    // Medium swaps a Kornet for a gun truck: still less value at home than easy, but not a subset of it.
    const swap = clone();
    swap.levels[1].withhold.sarim = [{ unit: 'atgm_cell', count: 3 }, { unit: 'gun_truck', count: 1 }];
    expect(withheldValue(swap.levels[1], unitsById, 'sarim')).toBeLessThan(withheldValue(swap.levels[0], unitsById, 'sarim'));
    expect(failures(swap).join('\n')).toMatch(/level "medium" withholds 1 "gun_truck" for sarim, more than "easy"'s 0 -- each level withholds at least everything/);
    const kdf = clone();
    kdf.levels[2].withhold.kdf = [{ unit: 'recon_drone', count: 1 }];
    expect(failures(kdf).join('\n')).toMatch(/level "hard" withholds 1 "recon_drone" for kdf, more than "medium"'s 0/);
  });

  it('refuses a count above what the placed force fields: 15 Kornets of 14', () => {
    const over = clone();
    over.levels[0].withhold.sarim = [{ unit: 'atgm_cell', count: 15 }];
    expect(failures(over).join('\n')).toMatch(/level "easy" withholds 15 "atgm_cell" for sarim, but VERSUS_SARIM fields only 14/);
    const kdf = clone();
    kdf.levels[0].withhold.kdf = [{ unit: 'mbt_lavi', count: 3 }];
    expect(failures(kdf).join('\n')).toMatch(/withholds 3 "mbt_lavi" for kdf, but VERSUS_KDF fields only 2/);
  });

  it('checks membership in the placed force, not the faction id: a Sarim gun_truck (faction rif) passes, a KDF unit on the Sarim row fails', () => {
    expect(unitsById.get('gun_truck')?.faction).toBe('rif');
    const truck = clone();
    truck.levels[0].withhold.sarim = [{ unit: 'atgm_cell', count: 8 }, { unit: 'gun_truck', count: 1 }];
    expect(failures(truck)).toEqual([]);
    const cross = clone();
    cross.levels[0].withhold.sarim = [{ unit: 'atgm_cell', count: 8 }, { unit: 'mbt_lavi', count: 1 }];
    expect(failures(cross).join('\n')).toMatch(/withholds "mbt_lavi" for sarim, which VERSUS_SARIM does not field/);
    // A Sarim-faction unit the placed force does not field fails too: a faction check alone would let it through.
    const rcl = clone();
    rcl.levels[0].withhold.sarim = [{ unit: 'atgm_cell', count: 8 }, { unit: 'recoilless_team', count: 1 }];
    expect(unitsById.get('recoilless_team')?.faction).toBe('sarim');
    expect(failures(rcl).join('\n')).toMatch(/withholds "recoilless_team" for sarim, which VERSUS_SARIM does not field/);
  });

  it('refuses to check against a placed force it was not given, rather than passing vacuously', () => {
    expect(computerLevelFailures({ file: FILE, doc: shipped }, unitsById, { kdf: PLACED.kdf, sarim: [] }).join('\n')).toMatch(/no placed force \(VERSUS_SARIM\) was given for "sarim"/);
    expect(computerLevelFailures({ file: FILE, doc: shipped }, unitsById, null).length).toBeGreaterThanOrEqual(2);
  });

  it('refuses a Sarim unit on the KDF row, an unknown unit, a repeated unit, and levels out of order', () => {
    const sarim = clone();
    sarim.levels[0].withhold.kdf = [{ unit: 'atgm_cell', count: 1 }, { unit: 'mbt_lavi', count: 2 }];
    expect(failures(sarim).join('\n')).toMatch(/withholds "atgm_cell" for kdf, which VERSUS_KDF does not field/);
    const ghost = clone();
    ghost.levels[0].withhold.kdf = [{ unit: 'no_such_unit', count: 9 }];
    expect(failures(ghost).join('\n')).toMatch(/"no_such_unit" \(kdf\), which is not a unit id/);
    const twice = clone();
    twice.levels[0].withhold.kdf = [{ unit: 'mbt_lavi', count: 1 }, { unit: 'mbt_lavi', count: 1 }];
    expect(failures(twice).join('\n')).toMatch(/names "mbt_lavi" twice in its kdf withhold/);
    const order = clone();
    order.levels.reverse();
    expect(failures(order).join('\n')).toMatch(/levels are \[hard, medium, easy\]/);
  });
});
