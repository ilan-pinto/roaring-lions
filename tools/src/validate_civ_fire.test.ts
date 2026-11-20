// GH-1438 E6: `fires_on_civilians` on an enemy placement only (docs/campaign/civilian-drama.md §10.2 E6). Its own
// module for the reason every validate_*.mjs is one: validate_data.mjs runs its whole sweep at import time and exits.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { civFireFailures } from '../validate_civ_fire.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel: string): object => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as object;

const FLAG = { fires_on_civilians: true };

describe('civFireFailures', () => {
  it('accepts the flag on an enemy garrison, a wave unit and a spawn trigger', () => {
    const m = {
      enemy: {
        garrison: [{ unit: 'militia_cell', count: 1, at: [1, 1], ...FLAG }],
        waves: [{ at_seconds: 10, units: [{ unit: 'militia_cell', count: 1, from: 'w', ...FLAG }] }],
      },
      triggers: [{ id: 's', on: { kind: 'timer_s', value: 1 }, do: { kind: 'spawn', units: [{ unit: 'militia_cell', count: 1, at: [2, 2], ...FLAG }] } }],
    };
    expect(civFireFailures(m, 'f.json')).toEqual([]);
  });

  it('refuses it on the starting force, the crowd and a reinforce trigger, each by name', () => {
    const m = {
      starting_force: [{ unit: 'inf_squad', count: 1, at: [1, 1], ...FLAG }],
      civilians: { groups: [{ unit: 'civilians', count: 3, at: [5, 5], ...FLAG }] },
      triggers: [{ id: 'r', on: { kind: 'timer_s', value: 1 }, do: { kind: 'reinforce', units: [{ unit: 'inf_squad', count: 1, at: [2, 2], ...FLAG }] } }],
    };
    expect(civFireFailures(m, 'f.json')).toEqual([
      'f.json: starting_force inf_squad carries fires_on_civilians, which only an enemy placement takes (GH-1438 E6)',
      'f.json: civilians.groups civilians carries fires_on_civilians, which only an enemy placement takes (GH-1438 E6)',
      'f.json: trigger "r" reinforce inf_squad carries fires_on_civilians, which only an enemy placement takes (GH-1438 E6)',
    ]);
  });

  // A carrier's passengers spawn on the carrier's side: unchecked, a flagged rider of a `reinforce` carrier passed here
  // and at load, then threw from `spawnPlacement` when the trigger fired. Mutation: drop the `passengers` walk.
  it('refuses it on a passenger of a reinforce carrier, a starting-force carrier and a crowd placement; takes an enemy one', () => {
    const rider = (unit: string, flag: object): object => ({ unit: 'apc_m113', count: 1, at: [2, 2], passengers: [{ unit, count: 1, ...flag }] });
    const m = {
      starting_force: [rider('inf_squad', FLAG)],
      civilians: { groups: [{ unit: 'civilians', count: 1, at: [5, 5], passengers: [{ unit: 'civilians', count: 1, fires_on_civilians: false }] }] },
      enemy: { garrison: [rider('militia_cell', FLAG)] },
      triggers: [
        { id: 'relief', on: { kind: 'timer_s', value: 60 }, do: { kind: 'reinforce', units: [rider('inf_squad', FLAG)] } },
        { id: 'raid', on: { kind: 'timer_s', value: 60 }, do: { kind: 'spawn', units: [rider('militia_cell', FLAG)] } },
      ],
    };
    expect(civFireFailures(m, 'f.json')).toEqual([
      'f.json: starting_force apc_m113 passenger inf_squad carries fires_on_civilians, which only an enemy placement takes (GH-1438 E6)',
      'f.json: civilians.groups civilians passenger civilians carries fires_on_civilians, which only an enemy placement takes (GH-1438 E6)',
      'f.json: trigger "relief" reinforce apc_m113 passenger inf_squad carries fires_on_civilians, which only an enemy placement takes (GH-1438 E6)',
    ]);
  });

  it('refuses false too: the field means nothing there, so it may not appear', () => {
    expect(civFireFailures({ civilians: { groups: [{ unit: 'civilians', count: 1, at: [1, 1], fires_on_civilians: false }] } }, 'f.json')).toHaveLength(1);
  });

  it('every shipped mission passes', () => {
    let read = 0;
    const failures: string[] = [];
    for (const f of readdirSync(join(ROOT, 'data/missions'))) {
      if (!f.endsWith('.json')) continue;
      failures.push(...civFireFailures(JSON.parse(readFileSync(join(ROOT, 'data/missions', f), 'utf8')), f));
      read++;
    }
    expect(read).toBeGreaterThanOrEqual(40); // 40 on dev today: a glob that read nothing would pass vacuously
    expect(failures).toEqual([]);
  });
});

// The schema half: the flag is a boolean on the shared placement and on a wave unit, where it used to be dropped or refused.
describe('fires_on_civilians: the schema', () => {
  const validate = (() => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    ajv.addSchema(load('data/schemas/common.schema.json'));
    return ajv.compile(load('data/schemas/mission.schema.json'));
  })();
  const mission = (garrison: Record<string, unknown>, wave: Record<string, unknown>): object => ({
    id: 'civ_fire_contract',
    town: 'beit_sahwan',
    phase: 'breach',
    map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    time_limit_s: 900,
    starting_force: [{ unit: 'inf_squad', count: 1, at: [2, 2] }],
    enemy: {
      garrison: [{ unit: 'militia_cell', count: 1, at: [9, 9], ...garrison }],
      waves: [{ at_seconds: 30, units: [{ unit: 'militia_cell', count: 1, from: 'w', ...wave }] }],
    },
    objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 300, text: 'Hold' }],
  });
  it('takes a boolean on a garrison and on a wave unit', () => {
    expect(validate(mission(FLAG, FLAG))).toBe(true);
  });
  it('refuses a non-boolean on either', () => {
    expect(validate(mission({ fires_on_civilians: 1 }, {}))).toBe(false);
    expect(validate(mission({}, { fires_on_civilians: 'yes' }))).toBe(false);
  });
});
