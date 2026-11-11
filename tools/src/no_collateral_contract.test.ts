// GH-4: the no_collateral_above data contract, end to end, as escort_contract.test.ts does for escort. One literal
// mission goes through the JSON schema (the gate `validate:data` runs) and the SAME object then plays in the runtime,
// so the schema and the runtime cannot drift apart. The ceiling reads the ROE score the HUD shows as Conduct.
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
const CIVILIANS: UnitTypeJson = {
  id: 'nc_civ',
  hull: { hp: 200, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 0.8 },
  sensors: { optics: 0.5, sight_tiles: 4, signature: 0.7 },
};

interface Fixture {
  [key: string]: unknown;
  objectives: Record<string, unknown>[];
}
/** A whole, valid mission: hold out 3 s (primary) without losing more than 30 Conduct (the ceiling, a secondary). */
function mission(): Fixture {
  return {
    id: 'no_collateral_contract',
    town: 'beit_sahwan',
    phase: 'subterranean',
    map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    time_limit_s: 600,
    roe: { enabled: true, civilian_casualty_penalty: 15 },
    starting_force: [{ unit: 'nc_squad', count: 1, at: [3, 5] }],
    civilians: { groups: [{ unit: 'nc_civ', count: 3, at: [14, 8] }] },
    objectives: [
      { id: 'hold', type: 'survive_until', primary: true, seconds: 3, text: 'Hold the street' },
      { id: 'clean', type: 'no_collateral_above', primary: false, threshold: 30, text: 'Keep the civilians out of it' },
    ],
  };
}

function runtimeFor(fixture: Fixture): { sim: Sim; runtime: MissionRuntime } {
  const sim = new Sim({ seed: 4, width: 28, height: 12, capacity: 16 });
  const ids = new Map<string, number>([SQUAD, CIVILIANS].map((t) => [t.id, sim.addUnitType(t)] as const));
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

  it('and the very same object plays: a clean run completes the ceiling with the hold', () => {
    const m = mission();
    expect(validate(m)).toBe(true);
    const { sim, runtime } = runtimeFor(m);
    const done: string[] = [];
    for (let t = 0; t < 6 * TICKS_PER_SECOND && runtime.result === 'ongoing'; t++) {
      for (const e of runtime.step(sim.tick())) if (e.kind === 'objective') done.push(`${e.id}:${e.status}`);
    }
    expect(done.sort()).toEqual(['clean:complete', 'hold:complete']);
    expect(runtime.result).toBe('victory');
  });

  it('and the same object fails the ceiling the tick Conduct lost passes 30, on the one ROE score', () => {
    const { runtime } = runtimeFor(mission());
    const kill = (civ: number) => runtime.step([{ kind: 'destroyed', tick: 1, entity: civ, by: 0 }]);
    kill(1);
    kill(2); // 30 lost: at the line
    expect(runtime.objectiveList.find((o) => o.id === 'clean')?.status).toBe('active');
    expect(runtime.objectiveList.find((o) => o.id === 'clean')?.collateral).toEqual({ lost: 30, limit: 30 });
    expect(runtime.roeScore).toBe(70);
    kill(3); // 45 lost
    expect(runtime.objectiveList.find((o) => o.id === 'clean')?.status).toBe('failed');
    expect(runtime.roeScore).toBe(55);
  });

  it('the schema holds the threshold to the runtime\'s rule: a whole number from 0 to 100', () => {
    for (const bad of [12.5, -1, 101, 'thirty']) {
      const m = mission();
      m.objectives[1].threshold = bad;
      expect(validate(m), String(bad)).toBe(false);
    }
    for (const good of [0, 30, 100]) {
      const m = mission();
      m.objectives[1].threshold = good;
      expect(validate(m), String(good)).toBe(true);
    }
  });

  it('the schema still bites: an unknown objective key is refused', () => {
    const stray = mission();
    stray.objectives[1].bogus = 1;
    expect(validate(stray)).toBe(false);
  });
});
