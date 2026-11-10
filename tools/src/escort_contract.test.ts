// GH-2: the escort objective's DATA CONTRACT, end to end. One literal mission goes through the JSON schema (the gate
// `validate:data` runs) and then the SAME object goes into the runtime, so the schema and the runtime cannot drift
// apart again: the first cut let the runtime read a `tag` on a starting_force placement that the schema refused.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { fx, MissionRuntime, Sim, TICKS_PER_SECOND, type MissionJson, type UnitTypeJson } from '@lions/sim';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel: string): object => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as object;

const validate = (() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(load('data/schemas/common.schema.json'));
  return ajv.compile(load('data/schemas/mission.schema.json'));
})();

const SQUAD: UnitTypeJson = {
  id: 'ec_squad',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.5 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};

interface Fixture {
  [key: string]: unknown;
  starting_force: Record<string, unknown>[];
  objectives: Record<string, unknown>[];
}
/** A whole, valid mission carrying one escort: the engineers (tag `vip`) are to reach the `pump` zone. */
function mission(): Fixture {
  return {
    id: 'escort_contract',
    town: 'beit_sahwan',
    phase: 'subterranean',
    map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    time_limit_s: 600,
    starting_force: [
      { unit: 'ec_squad', count: 1, at: [3, 5], tag: 'vip' },
      { unit: 'ec_squad', count: 1, at: [3, 8] },
    ],
    objectives: [{ id: 'vip', type: 'escort', primary: true, target: 'vip', zone: 'pump', text: 'Bring the engineers to the pump house' }],
  };
}

function runtimeFor(fixture: Fixture): { sim: Sim; runtime: MissionRuntime } {
  const sim = new Sim({ seed: 2, width: 28, height: 12, capacity: 16 });
  const ids = new Map<string, number>([[SQUAD.id, sim.addUnitType(SQUAD)]]);
  const runtime = new MissionRuntime(sim, fixture as unknown as MissionJson, {
    typeIdOf: (u) => {
      const t = ids.get(u);
      if (t === undefined) throw new Error(`unknown unit ${u}`);
      return t;
    },
    markers: {},
    zones: { pump: [20, 2, 5, 7] },
  });
  runtime.start();
  return { sim, runtime };
}

describe('the escort data contract (GH-2)', () => {
  it('the mission passes the schema', () => {
    const ok = validate(mission());
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('and the very same object plays: the engineers walk to the zone and the objective completes', () => {
    const m = mission();
    expect(validate(m)).toBe(true);
    const { sim, runtime } = runtimeFor(m);
    sim.queueCommand({ kind: 'move', ids: [0], x: fx.from(21.5), y: fx.from(5.5) });
    const done: string[] = [];
    for (let t = 0; t < 60 * TICKS_PER_SECOND && runtime.result === 'ongoing'; t++) {
      for (const e of runtime.step(sim.tick())) if (e.kind === 'objective') done.push(`${e.id}:${e.status}`);
    }
    expect(done).toEqual(['vip:complete']);
    expect(runtime.result).toBe('victory');
  });

  it('the schema still bites: a stray key on a starting_force item is refused, and a tag must be a string', () => {
    const stray = mission();
    stray.starting_force[0].bogus = 1;
    expect(validate(stray)).toBe(false);
    const numeric = mission();
    numeric.starting_force[0].tag = 7;
    expect(validate(numeric)).toBe(false);
  });

  it('a zone is typed as a string on any objective', () => {
    const m = mission();
    m.objectives[0].zone = 5;
    expect(validate(m)).toBe(false);
  });
});
