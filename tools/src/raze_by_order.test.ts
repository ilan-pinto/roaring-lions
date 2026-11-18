// GH-1438 (Bir Tarsha IV): a `raze` zone may hold low-profile and per-tile works when its objective says `by_order: true`.
//
// The change is a schema field plus an authoring-time validator rule, and nothing else: the sim never reads it. Each claim here is
// run on a constructed input that makes it fail (CLAUDE.md, "Every check gets an input that makes it fail"):
//   - the new allowed case: a berm or a wall in a raze zone passes WITH the flag;
//   - the still-refused cases: the same zone WITHOUT the flag, a protected work WITH it, the flag on any other objective type, and
//     the flag as a non-boolean;
//   - the sim does not read it: the same shipped mission, flag on and off, hashes the same after 200 ticks.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { objectiveFailures, razeZoneFailures } from '../validate_objectives.mjs';
import { missionWorld } from './mission-harness';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel: string): object => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as object;

type Obj = Record<string, unknown>;
const PROTECTED = 20;
const catalogue = {
  types: {
    house: { symbol: 'h' },
    berm: { symbol: 'g', low_profile: true },
    wall: { symbol: 'w', low_profile: true, per_tile: true },
    fence: { symbol: 'e', per_tile: true },
    hall: { symbol: 'm', roe_penalty: 20 },
  },
};
const symbols = new Map(Object.entries(catalogue.types).map(([id, s]) => [s.symbol, id]));
const rows = (zoneRow: string): string[] => ['..........', zoneRow, '..........'];
const razeOf = (extra: Obj = {}): Obj => ({ id: 'clear', type: 'raze', primary: true, target: 'zone', seconds: 300, ...extra });
const failuresFor = (zoneRow: string, o: Obj, mi: Obj = {}): string[] =>
  razeZoneFailures(o, { map: { file: 'fx' }, ...mi }, { zones: { zone: [0, 1, 10, 1] }, rows: rows(zoneRow) }, catalogue, symbols, PROTECTED, 'fx.json');

describe('a raze zone holding low-profile or per-tile works', () => {
  it('is refused by default: a berm, a wall (both reasons), a fence', () => {
    expect(failuresFor('..g.......', razeOf())).toHaveLength(1);
    expect(failuresFor('..g.......', razeOf())[0]).toContain('low_profile');
    expect(failuresFor('..w.......', razeOf())).toHaveLength(2);
    expect(failuresFor('..e.......', razeOf())[0]).toContain('per_tile');
  });
  it('passes with by_order: true', () => {
    for (const row of ['..g.......', '..w.......', '..e.......', 'gggwwweee.']) expect(failuresFor(row, razeOf({ by_order: true })), row).toEqual([]);
  });
  it('passes with by_order: true for a work the mission places itself, and refuses it without', () => {
    const mi = { structures: [{ type: 'berm', at: [3, 1], size: [2, 1] }] };
    expect(failuresFor('..........', razeOf(), mi)[0]).toContain('placed by the mission');
    expect(failuresFor('..........', razeOf({ by_order: true }), mi)).toEqual([]);
  });
  it('does not excuse a plain work: a house is fine either way', () => {
    expect(failuresFor('..h.......', razeOf())).toEqual([]);
    expect(failuresFor('..h.......', razeOf({ by_order: true }))).toEqual([]);
  });
  it('still refuses a PROTECTED work with by_order: true, and a protected work mixed in with allowed ones', () => {
    expect(failuresFor('..m.......', razeOf({ by_order: true }))[0]).toContain('protected');
    expect(failuresFor('..m.......', razeOf())[0]).toContain('protected');
    const mixed = failuresFor('ggwwmgg...', razeOf({ by_order: true }));
    expect(mixed).toHaveLength(1);
    expect(mixed[0]).toContain('protected');
  });
  it('only a flag of exactly true lifts the refusal (a string or 1 does not)', () => {
    for (const v of ['true', 1, 'yes'])
      for (const row of ['..g.......', '..e.......']) expect(failuresFor(row, razeOf({ by_order: v })), `${String(v)} on ${row}`).toHaveLength(1);
  });
  it('is only for raze: any other type that carries by_order is refused by name', () => {
    const base = { id: 'cap', type: 'capture', primary: true, target: 'zone', seconds: 60 };
    expect(objectiveFailures({ ...base, by_order: true }, { id: 'fx', objectives: [base] }, { zones: { zone: [0, 1, 10, 1] } }, 'fx.json')).toEqual([
      'fx.json: objective "cap" is a capture, which takes no by_order (only raze does)',
    ]);
    expect(objectiveFailures(razeOf({ by_order: true }), { id: 'fx', objectives: [razeOf()] }, { zones: { zone: [0, 1, 10, 1] } }, 'fx.json')).toEqual([]);
  });
});

describe('the schema', () => {
  const validate = (() => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    ajv.addSchema(load('data/schemas/common.schema.json'));
    return ajv.compile(load('data/schemas/mission.schema.json'));
  })();
  // A whole shipped mission with its objectives swapped, so every other field stays as valid as it ships.
  const withObjectives = (objectives: Obj[]): object => ({ ...(load('data/missions/bir_tarsha_1_recon.json') as Obj), objectives });
  const first = (load('data/missions/bir_tarsha_1_recon.json') as { objectives: Obj[] }).objectives[0];
  it('the baseline mission is valid, so the cases below fail for the field alone', () => {
    expect(validate(withObjectives([first]))).toBe(true);
  });
  it('accepts by_order on a raze and refuses it on anything else', () => {
    const raze = { id: 'clear', type: 'raze', primary: true, target: 'zone', seconds: 300, text: 'Level the works' };
    expect(validate(withObjectives([raze]))).toBe(true);
    expect(validate(withObjectives([{ ...raze, by_order: true }]))).toBe(true);
    expect(validate(withObjectives([{ ...raze, type: 'capture', by_order: true }]))).toBe(false);
    expect(validate(withObjectives([{ ...first, by_order: true }]))).toBe(false);
  });
  it('refuses a non-boolean by_order', () => {
    const raze = { id: 'clear', type: 'raze', primary: true, target: 'zone', seconds: 300, text: 'Level the works' };
    expect(validate(withObjectives([{ ...raze, by_order: 'yes' }]))).toBe(false);
  });
});

describe('the sim does not read it (invariant 4: nothing outside the sim changes sim state, and this field is outside it)', () => {
  it('a shipped raze mission hashes the same after 200 ticks with the flag on and off', () => {
    const id = 'ein_qasab_2_foothold';
    const run = (flag: boolean): string => {
      const w = missionWorld(id, {});
      expect(w.mission.objectives.some((o) => o.type === 'raze')).toBe(true);
      // Not vacuous: the runtime was built from objectives that do (or do not) carry the field.
      expect(w.mission.objectives.some((o) => (o as unknown as Obj).by_order === true), `flag ${flag}`).toBe(flag);
      for (let t = 0; t < 200; t++) {
        w.runtime.step(w.sim.tick());
      }
      return String(w.sim.hash());
    };
    const off = run(false);
    // The registry is shared, so set the field on the live objects, run, and put it back.
    const objectives = (missionWorld(id, {}).mission.objectives as unknown as Obj[]).filter((o) => o.type === 'raze');
    for (const o of objectives) o.by_order = true;
    const on = run(true);
    for (const o of objectives) delete o.by_order;
    expect(on).toBe(off);
    expect(run(false)).toBe(off);
  });
});
