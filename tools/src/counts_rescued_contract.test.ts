// E12 (GH-1438): the `counts_rescued` DATA CONTRACT. The JSON schema (the gate `validate:data` runs) takes it on an
// evacuate_before and refuses it on any other type, as it does `group` and `hostages`; the runtime refuses it the same
// way at load. The behaviour is `packages/sim/src/mission.test.ts`, "E12: counts_rescued".
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

function mission(objective: Record<string, unknown>): object {
  return {
    id: 'counts_rescued_contract',
    town: 'beit_sahwan',
    phase: 'breach',
    map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    time_limit_s: 900,
    starting_force: [{ unit: 'inf_squad', count: 1, at: [2, 2] }],
    civilians: { refuge: 'refuge', groups: [{ unit: 'civilians', count: 2, at: [5, 5], group: 'village' }] },
    objectives: [objective],
  };
}
const EVAC = { id: 'save', type: 'evacuate_before', primary: true, target: 'yard', count: 1, seconds: 300, text: 'Save them' };
const CAPTURE = { id: 'take', type: 'capture', primary: true, target: 'yard', text: 'Take it' };
const ok = (o: Record<string, unknown>): boolean => validate(mission(o)) === true;

describe('counts_rescued: the schema', () => {
  it('takes it on an evacuate_before, true or false, scoped or not', () => {
    expect(ok(EVAC)).toBe(true);
    expect(ok({ ...EVAC, counts_rescued: true })).toBe(true);
    expect(ok({ ...EVAC, counts_rescued: false, group: 'village' })).toBe(true);
  });
  it('refuses it on any other type', () => {
    expect(ok(CAPTURE)).toBe(true);
    expect(ok({ ...CAPTURE, counts_rescued: true })).toBe(false);
  });
  it('refuses a non-boolean', () => {
    expect(ok({ ...EVAC, counts_rescued: 1 })).toBe(false);
  });
});
