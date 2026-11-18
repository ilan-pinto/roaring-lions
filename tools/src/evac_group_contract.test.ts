// E3 (GH-1438): the `evacuate_before.group` DATA CONTRACT, end to end, the shape of `escort_contract.test.ts`. One literal
// mission goes through the JSON schema (the gate `validate:data` runs) and then the SAME object goes into the runtime, so
// the schema and the runtime cannot drift apart: the schema used to refuse `group` on an objective outright (the civilian
// drama design §11, "the schema refuses `group` on an objective").
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { MissionRuntime, Sim, type MissionEvent, type MissionJson, type UnitTypeJson } from '@lions/sim';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel: string): object => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as object;

const validate = (() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(load('data/schemas/common.schema.json'));
  return ajv.compile(load('data/schemas/mission.schema.json'));
})();

const SQUAD: UnitTypeJson = {
  id: 'eg_squad',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.5 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};
const CIV: UnitTypeJson = {
  id: 'eg_civ',
  hull: { hp: 200, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 0.8 },
  sensors: { optics: 0.5, sight_tiles: 4, signature: 0.7 },
};

interface Fixture {
  [key: string]: unknown;
  objectives: Record<string, unknown>[];
}
/** A whole, valid mission: the villagers (group `village`) stand in the yard, the road crowd (group `road`) beside them. */
function mission(): Fixture {
  return {
    id: 'evac_group_contract',
    town: 'beit_sahwan',
    phase: 'breach',
    map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    time_limit_s: 900,
    starting_force: [{ unit: 'eg_squad', count: 1, at: [24, 2] }],
    civilians: {
      refuge: 'refuge',
      groups: [
        { unit: 'eg_civ', count: 1, at: [1, 9], group: 'village' },
        { unit: 'eg_civ', count: 2, at: [3, 9], group: 'road' },
      ],
    },
    objectives: [
      { id: 'out', type: 'evacuate_before', primary: true, target: 'yard', count: 1, seconds: 300, group: 'village', text: 'Bring the villagers in' },
      { id: 'road_in', type: 'evacuate_before', primary: false, target: 'yard', count: 2, seconds: 300, group: ['road'], text: 'Bring the road in' },
    ],
  };
}

function run(fixture: Fixture): MissionEvent[] {
  const sim = new Sim({ seed: 3, width: 28, height: 12, capacity: 16 });
  const ids = new Map<string, number>([
    [SQUAD.id, sim.addUnitType(SQUAD)],
    [CIV.id, sim.addUnitType(CIV)],
  ]);
  const runtime = new MissionRuntime(sim, fixture as unknown as MissionJson, {
    typeIdOf: (u) => {
      const t = ids.get(u);
      if (t === undefined) throw new Error(`unknown unit ${u}`);
      return t;
    },
    markers: { refuge: [2, 10] },
    zones: { yard: [0, 8, 6, 4] },
  });
  runtime.start();
  const out: MissionEvent[] = [];
  for (let i = 0; i < 10; i++) out.push(...runtime.step(sim.tick()));
  return out;
}

describe('evacuate_before.group: schema and runtime agree', () => {
  it('the schema accepts a name and a list of names, and the runtime counts each scope apart', () => {
    const m = mission();
    expect(validate(m), JSON.stringify(validate.errors)).toBe(true);
    const done = run(m).flatMap((e) => (e.kind === 'objective' && e.status === 'complete' ? [e.id] : []));
    expect(done).toEqual(['out', 'road_in']);
  });
  it('the schema refuses a group on another type, an empty list, a repeated name and an empty name', () => {
    const bad = (patch: Record<string, unknown>, at = 0): boolean => {
      const m = mission();
      m.objectives[at] = { ...m.objectives[at], ...patch };
      return validate(m);
    };
    expect(bad({ type: 'survive_until', target: undefined, count: undefined })).toBe(false);
    expect(bad({ group: [] })).toBe(false);
    expect(bad({ group: ['village', 'village'] })).toBe(false);
    expect(bad({ group: '' })).toBe(false);
    expect(bad({ group: 7 })).toBe(false);
    // The control: the same patch machinery leaves a good mission good.
    expect(bad({ group: ['village'] })).toBe(true);
  });
});
