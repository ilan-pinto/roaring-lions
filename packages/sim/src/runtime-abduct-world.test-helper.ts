import { MissionRuntime, type MissionJson } from './mission';
import { Sim, type UnitTypeJson } from './sim';

// The abduct world (GH-1438 E8 pacing): the snapshot witness's world for a runtime whose mission has an `abduct` trigger, the
// one kind of runtime that carries the `when: 'abduct'` row `abductPace`. No shipped mission authors an abduct, and none of the
// other witness worlds has one, so without this world that row would be one no fork ever restored. The file name is not matched
// by vitest's `*.test.ts` glob on purpose, as `golden-worlds.test-helper.ts`.
//
// A 12-high strip: the escort at (5,5), its one captive a tile behind it at (4,5), `to` 40 tiles east. The types are TEST
// types with whole-number speeds (2 and 1 tiles a second), so the escort outwalks its captive at once and the pacing halts
// and walks on again and again. At 1 s the abduct fires; at 30 s a `withdraw_to` of the escort's group turns pacing OFF.
// Ids: 0 the escort, 1 the captive.

export const ABD_ESCORT: UnitTypeJson = {
  id: 'abd_escort',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 2 },
  sensors: { optics: 1, sight_tiles: 6, signature: 1 },
  weapons: [],
};

export const ABD_CAPTIVE: UnitTypeJson = {
  id: 'abd_captive',
  role: 'support',
  faction: 'civilian',
  hull: { hp: 200, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 1, sight_tiles: 4, signature: 1 },
};

/** The route, in tiles east of the escort. */
const ROUTE = 40;
const TO_X = 5 + ROUTE;

/** The mission: one abduct, one later `withdraw_to` of the same group, and nothing else that moves anyone. */
export function abductMission(): MissionJson {
  return {
    id: 'abduct_world',
    map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 900 }],
    enemy: { garrison: [{ unit: ABD_ESCORT.id, count: 1, at: [5, 5], group: 'takers' }] },
    civilians: { refuge: 'refuge', groups: [{ unit: ABD_CAPTIVE.id, count: 1, at: [4, 5], group: 'taken' }] },
    triggers: [
      {
        id: 'led_away',
        label: 'They are led away',
        on: { kind: 'timer_s', value: 1 },
        do: { kind: 'abduct', group: 'takers', captives: 'taken', to: 'exit', zone: 'exit_zone' },
      },
      { id: 'fall_back', label: 'They fall back', on: { kind: 'timer_s', value: 30 }, do: { kind: 'withdraw_to', group: 'takers', to: 'back' } },
    ],
  };
}

/** The world, started. `mission` replaces the abduct mission (the same map, markers and types): a caller's variant. */
export function abductWorld(mission: MissionJson = abductMission()): { sim: Sim; rt: MissionRuntime } {
  const sim = new Sim({ seed: 0x1438e8, width: TO_X + 6, height: 12, capacity: 8 });
  const ids = new Map<string, number>();
  for (const t of [ABD_ESCORT, ABD_CAPTIVE]) ids.set(t.id, sim.addUnitType(t));
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: (u) => {
      const t = ids.get(u);
      if (t === undefined) throw new Error(`abduct world: unknown unit ${u}`);
      return t;
    },
    markers: { exit: [TO_X, 5], refuge: [1, 10], back: [2, 9] },
    zones: { exit_zone: [TO_X - 1, 2, 3, 7] },
  });
  rt.start();
  return { sim, rt };
}

/** No inputs: the triggers drive it. */
export function abductDrive(): void {}

export function abductAdvance(w: { readonly sim: Sim; readonly rt: MissionRuntime }): void {
  w.rt.step(w.sim.tick());
}

/** The world's length, in ticks: past the withdraw (600) and well into the walk back. */
export const ABD_TICKS = 800;
