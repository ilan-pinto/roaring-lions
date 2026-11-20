// E8 (GH-1438): the `do.kind: abduct` DATA CONTRACT. The JSON schema (the gate `validate:data` runs) takes an abduct with
// its escort `group`, its `captives`, a `to` and a `zone`, refuses one missing any of them, and refuses `captives` on any
// other kind. The behaviour is packages/sim/src/mission.test.ts, "E8: abduct".
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
const mission = (doBlock: Record<string, unknown>): object => ({
  id: 'abduct_contract',
  town: 'beit_sahwan',
  phase: 'breach',
  map: { file: 'none' },
  ledger: { requires: [], produces: [] },
  time_limit_s: 900,
  starting_force: [{ unit: 'inf_squad', count: 1, at: [2, 2] }],
  enemy: { garrison: [{ unit: 'militia_cell', count: 1, at: [9, 9], group: 'takers' }] },
  civilians: { refuge: 'refuge', groups: [{ unit: 'civilians', count: 2, at: [5, 5], group: 'taken' }] },
  objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 300, text: 'Hold' }],
  triggers: [{ id: 'led', label: 'They are led away', on: { kind: 'timer_s', value: 60 }, do: doBlock }],
});
const FULL = { kind: 'abduct', group: 'takers', captives: 'taken', to: 'exit', zone: 'exit_zone' };

describe('do.kind abduct: the schema', () => {
  it('takes an abduct with group, captives, to and zone', () => {
    expect(validate(mission(FULL))).toBe(true);
  });
  it('refuses one missing any of the four', () => {
    for (const k of ['group', 'captives', 'to', 'zone']) {
      const d: Record<string, unknown> = { ...FULL };
      delete d[k];
      expect(validate(mission(d)), k).toBe(false);
    }
  });
  it('refuses units on it, and captives on any other kind', () => {
    expect(validate(mission({ ...FULL, units: [] }))).toBe(false);
    expect(validate(mission({ kind: 'withdraw_to', group: 'takers', to: 'exit', captives: 'taken' }))).toBe(false);
    expect(validate(mission({ kind: 'withdraw_to', group: 'takers', to: 'exit' }))).toBe(true); // the control
  });
});
