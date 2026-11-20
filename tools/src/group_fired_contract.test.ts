// E7 (GH-1438): the `on.kind: group_fired` DATA CONTRACT. A whole mission goes through the JSON schema (the gate
// `validate:data` runs): `group_fired` needs `group` and takes no `zone`, and `group_in_zone` keeps needing both (the
// `else` branch added here must not loosen it). The runtime half is `packages/sim/src/mission.test.ts`, "group_fired".
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

function mission(on: Record<string, unknown>): object {
  return {
    id: 'group_fired_contract',
    town: 'beit_sahwan',
    phase: 'breach',
    map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    time_limit_s: 900,
    starting_force: [{ unit: 'inf_squad', count: 1, at: [2, 2] }],
    enemy: { garrison: [{ unit: 'militia_cell', count: 1, at: [9, 9], group: 'grove' }] },
    objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 300, text: 'Hold' }],
    triggers: [{ id: 'cue', label: 'The grove opens fire', on, do: { kind: 'commit', group: 'grove', to: 'm' } }],
  };
}
const ok = (on: Record<string, unknown>): boolean => validate(mission(on)) === true;

describe('on.kind group_fired: the schema', () => {
  it('accepts it with a group', () => {
    expect(ok({ kind: 'group_fired', group: 'grove' })).toBe(true);
  });
  it('refuses it without a group', () => {
    expect(ok({ kind: 'group_fired' })).toBe(false);
  });
  it('refuses a zone on it (no zone is read)', () => {
    expect(ok({ kind: 'group_fired', group: 'grove', zone: 'yard' })).toBe(false);
  });
  it('leaves group_in_zone as it was: both fields, and neither alone', () => {
    expect(ok({ kind: 'group_in_zone', group: 'grove', zone: 'yard' })).toBe(true);
    expect(ok({ kind: 'group_in_zone', group: 'grove' })).toBe(false);
    expect(ok({ kind: 'group_in_zone', zone: 'yard' })).toBe(false);
  });
  it('leaves the other kinds alone: a timer with a value', () => {
    expect(ok({ kind: 'timer_s', value: 10 })).toBe(true);
  });
});
