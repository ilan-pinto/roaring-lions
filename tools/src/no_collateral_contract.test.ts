// GH-4: the `no_collateral_above` objective's DATA CONTRACT, end to end. One literal mission goes through the JSON schema (the
// gate `validate:data` runs) and then the SAME object goes into the runtime, so the schema and the runtime cannot drift apart
// again: the first cut let the runtime read a `threshold` on an objective the schema refused.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { MissionRuntime, Sim, TICKS_PER_SECOND, type MissionJson, type UnitTypeJson } from '@lions/sim';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel: string): object => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as object;

const validate = (() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(load('data/schemas/common.schema.json'));
  return ajv.compile(load('data/schemas/mission.schema.json'));
})();

const SQUAD: UnitTypeJson = {
  id: 'nc_squad',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.5 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};

const CIV: UnitTypeJson = {
  id: 'nc_civ',
  hull: { hp: 200, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 0.8 },
  sensors: { optics: 0.5, sight_tiles: 4, signature: 0.7 },
};

interface Fixture {
  [key: string]: unknown;
  starting_force: Record<string, unknown>[];
  objectives: Record<string, unknown>[];
}

/** A whole, valid mission carrying one `no_collateral_above` guard beside a `survive_until`. */
function mission(): Fixture {
  return {
    id: 'no_collateral_contract',
    town: 'beit_sahwan',
    phase: 'subterranean',
    map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    time_limit_s: 600,
    starting_force: [{ unit: 'nc_squad', count: 1, at: [3, 5] }],
    civilians: { groups: [{ unit: 'nc_civ', count: 1, at: [10, 5] }] },
    roe: { enabled: true, civilian_casualty_penalty: 8 },
    objectives: [
      { id: 'hold_conduct', type: 'no_collateral_above', primary: true, threshold: 95, text: 'Cause no collateral above the line' },
      { id: 'hold', type: 'survive_until', primary: true, seconds: 5 },
    ],
  };
}

function runtimeFor(fixture: Fixture): { sim: Sim; runtime: MissionRuntime } {
  const sim = new Sim({ seed: 2, width: 28, height: 12, capacity: 16 });
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
    markers: {},
    zones: {},
  });
  runtime.start();
  return { sim, runtime };
}

describe('the no_collateral_above data contract (GH-4)', () => {
  it('the mission passes the schema', () => {
    const ok = validate(mission());
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('and the very same object plays: the guard completes with the survive_until and the mission is won', () => {
    const m = mission();
    expect(validate(m)).toBe(true);
    const { sim, runtime } = runtimeFor(m);
    const done: string[] = [];
    for (let t = 0; t < 5 * TICKS_PER_SECOND && runtime.result === 'ongoing'; t++) {
      for (const e of runtime.step(sim.tick())) if (e.kind === 'objective') done.push(`${e.id}:${e.status}`);
    }
    expect(done).toEqual(['hold:complete', 'hold_conduct:complete']);
    expect(runtime.result).toBe('victory');
  });

  it('and the very same object fails the guard the tick Conduct drops below its threshold', () => {
    const m = mission();
    expect(validate(m)).toBe(true);
    const { sim, runtime } = runtimeFor(m);
    runtime.step(sim.tick()); // tick 1, nothing happens
    // The player kills the one civilian (id 1): Conduct 100 -> 92, below the 95 floor.
    const events = runtime.step([{ kind: 'destroyed', tick: 2, entity: 1, by: 0 }]);
    expect(events.some((e) => e.kind === 'objective' && e.id === 'hold_conduct' && e.status === 'failed')).toBe(true);
    expect(runtime.result).toBe('defeat');
  });

  it('the schema still bites: the threshold must be an integer 1..100', () => {
    const zero = mission();
    zero.objectives[0].threshold = 0;
    expect(validate(zero)).toBe(false);
    const big = mission();
    big.objectives[0].threshold = 101;
    expect(validate(big)).toBe(false);
    const frac = mission();
    frac.objectives[0].threshold = 70.5;
    expect(validate(frac)).toBe(false);
  });

  it('the runtime refuses a threshold on any other objective type', () => {
    const m = mission();
    m.objectives[1].threshold = 50;
    expect(() => runtimeFor(m)).toThrow(/takes no threshold/);
  });
});
