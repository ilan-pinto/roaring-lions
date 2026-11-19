// GH-1438 E14: the `civilians.figures` DATA CONTRACT (D18, Option A). The JSON schema (the gate `validate:data` runs)
// takes `all` or `adults` and nothing else. The behaviour is packages/app/src/mesh-catalogue.test.ts, "civilians.figures".
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel: string): object => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as object;
const validate = (() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(load('data/schemas/common.schema.json'));
  return ajv.compile(load('data/schemas/mission.schema.json'));
})();
const mission = (figures: unknown): object => ({
  id: 'figures_contract',
  town: 'beit_sahwan',
  phase: 'breach',
  map: { file: 'none' },
  ledger: { requires: [], produces: [] },
  time_limit_s: 900,
  starting_force: [{ unit: 'inf_squad', count: 1, at: [2, 2] }],
  civilians: { refuge: 'refuge', groups: [{ unit: 'civilians', count: 2, at: [5, 5] }], ...(figures === undefined ? {} : { figures }) },
  objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 300, text: 'Hold' }],
});

describe('civilians.figures: the schema', () => {
  it('takes adults, all, or nothing', () => {
    expect(validate(mission('adults'))).toBe(true);
    expect(validate(mission('all'))).toBe(true);
    expect(validate(mission(undefined))).toBe(true);
  });
  it('refuses any other value', () => {
    expect(validate(mission('children'))).toBe(false);
    expect(validate(mission(true))).toBe(false);
  });
});
