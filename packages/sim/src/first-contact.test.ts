// `first_contact` is the two fighting sides, 0 and 1, meeting -- not a militiaman spotting a civilian, not a gun truck cutting a
// neutral wall. Before this was pinned, four shipped missions fired their first-contact reply at tick 1 to 12 of a passive run.
// Two kinds of test: a truth table over hand-built events (the rule itself), and real sim runs (the events the sim really makes,
// so a predicate that tests a stale shape cannot pass). Every number is a literal.
import { describe, expect, it } from 'vitest';
import { MissionRuntime, type MissionEvent, type MissionJson } from './mission';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

const SQUAD: UnitTypeJson = {
  id: 'fc_squad',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.5 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [
    { id: 'rifles', type: 'small_arms', range_tiles: 7, effective_range_tiles: 5.5, accuracy: 0.6, penetration: 8, damage: 25, suppression: 40, rof_per_min: 300 },
  ],
};
const CIVILIANS: UnitTypeJson = {
  id: 'fc_civ',
  hull: { hp: 200, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 0.8 },
  sensors: { optics: 0.5, sight_tiles: 4, signature: 0.7 },
};
const WALL = { id: 'fc_wall', name: 'Wall', hp_per_tile: 100, garrison_slots: 0, rubble_cover: 1 };

function mission(partial: Partial<MissionJson>): MissionJson {
  return {
    id: 'fc_mission',
    map: { file: 'none' },
    ledger: { requires: [], produces: [] },
    objectives: [{ id: 'win', type: 'destroy_all', primary: true }],
    triggers: [{ id: 'contact', on: { kind: 'first_contact' }, do: { kind: 'commit', group: 'reserve', to: 'rally' } }],
    ...partial,
  };
}

interface World {
  readonly sim: Sim;
  readonly runtime: MissionRuntime;
  /** Ticks `n` times; the mission events are returned, the sim events appended to `seen`. */
  run(n: number, seen?: SimEvent[]): MissionEvent[];
  /** One tick with `extra` events handed to the runtime beside the sim's own (the truth-table cases). */
  stepWith(extra: SimEvent[]): MissionEvent[];
}

function world(m: MissionJson, prep?: (sim: Sim) => { wall: number; own0: number; own1: number }): { w: World; s: { wall: number; own0: number; own1: number } } {
  const sim = new Sim({ seed: 7, width: 40, height: 12, capacity: 32 });
  const ids = new Map<string, number>();
  for (const t of [SQUAD, CIVILIANS]) ids.set(t.id, sim.addUnitType(t));
  const s = prep?.(sim) ?? { wall: -1, own0: -1, own1: -1 };
  const runtime = new MissionRuntime(sim, m, {
    typeIdOf: (u) => {
      const t = ids.get(u);
      if (t === undefined) throw new Error(`unknown unit ${u}`);
      return t;
    },
    markers: { rally: [20, 5] },
    zones: {},
  });
  runtime.start();
  return {
    s,
    w: {
      sim,
      runtime,
      run: (n, seen = []) => {
        const out: MissionEvent[] = [];
        for (let i = 0; i < n; i++) {
          const se = sim.tick();
          seen.push(...se);
          out.push(...runtime.step(se));
        }
        return out;
      },
      stepWith: (extra) => {
        const se = sim.tick();
        return runtime.step([...se, ...extra]);
      },
    },
  };
}

const fired = (evs: MissionEvent[]): boolean => evs.some((e) => e.kind === 'trigger' && e.id === 'contact');

describe('first_contact is the two combat sides meeting (real sim runs)', () => {
  // ids by spawn order: starting force first, then the garrison, then the civilians
  const farApart = (extra: Partial<MissionJson> = {}): MissionJson =>
    mission({
      starting_force: [{ unit: 'fc_squad', count: 1, at: [2, 5] }],
      enemy: { garrison: [{ unit: 'fc_squad', count: 1, at: [34, 5], facing_deg: 180 }] },
      ...extra,
    });

  it('control: a player squad and an enemy squad in sight of each other fire the trigger', () => {
    const m = mission({
      starting_force: [{ unit: 'fc_squad', count: 1, at: [14, 5] }],
      enemy: { garrison: [{ unit: 'fc_squad', count: 1, at: [22, 5], facing_deg: 180 }] },
    });
    const { w } = world(m);
    expect(fired(w.run(30 * TICKS_PER_SECOND))).toBe(true);
  });

  it('an enemy that identifies a civilian is not first contact (the player is 32 tiles away)', () => {
    const m = farApart({ civilians: { groups: [{ unit: 'fc_civ', count: 1, at: [36, 6] }] } });
    const { w } = world(m);
    const seen: SimEvent[] = [];
    const mission = w.run(20 * TICKS_PER_SECOND, seen);
    // not vacuous: the sim DID make the event the old rule fired on -- side 1 identifying a side-2 unit
    const civ = 2;
    expect(w.sim.state.side[civ]).toBe(2);
    expect(seen.some((e) => e.kind === 'contact' && e.level === 'identified' && e.side === 1 && e.target === civ)).toBe(true);
    expect(fired(mission)).toBe(false);
  });

  it('a player squad that identifies a civilian is not first contact either', () => {
    const m = mission({
      starting_force: [{ unit: 'fc_squad', count: 1, at: [2, 5] }],
      enemy: { garrison: [{ unit: 'fc_squad', count: 1, at: [34, 5], facing_deg: 180 }] },
      civilians: { groups: [{ unit: 'fc_civ', count: 1, at: [4, 6] }] },
    });
    const { w } = world(m);
    const seen: SimEvent[] = [];
    const out = w.run(20 * TICKS_PER_SECOND, seen);
    expect(seen.some((e) => e.kind === 'contact' && e.level === 'identified' && e.side === 0 && w.sim.state.side[e.target] === 2)).toBe(true);
    expect(fired(out)).toBe(false);
  });
});

describe('first_contact truth table (hand-built events on a real world)', () => {
  /** A world with a neutral wall, a wall owned by side 0 and one owned by side 1, a player squad (id 0), an enemy squad (id 1)
   *  and a civilian (id 2), all far apart so that nothing real happens in the one tick the case runs. */
  const make = () =>
    world(
      mission({
        starting_force: [{ unit: 'fc_squad', count: 1, at: [2, 5] }],
        enemy: { garrison: [{ unit: 'fc_squad', count: 1, at: [36, 5], facing_deg: 180 }] },
        civilians: { groups: [{ unit: 'fc_civ', count: 1, at: [20, 10] }] },
      }),
      (sim) => {
        const t = sim.addStructureType(WALL);
        const w = 40;
        return {
          wall: sim.addStructure(t, [1 * w + 10]),
          own0: sim.addStructure(t, [1 * w + 12], { owner: 0 }),
          own1: sim.addStructure(t, [1 * w + 14], { owner: 1 }),
        };
      }
    );
  const PLAYER = 0;
  const ENEMY = 1;
  const CIV = 2;
  const fire = (shooter: number, target: number, structure?: number): SimEvent => ({
    kind: 'fire',
    tick: 1,
    shooter,
    target,
    ...(structure === undefined ? {} : { structure }),
    weaponId: 'rifles',
    pHit: 1,
    roll: 0,
    willHit: true,
    breakdown: { accuracy: 1, rangeFalloff: 1, coverMod: 1, motionMod: 1, stanceMod: 1, suppressionMod: 1 },
  });
  const contact = (side: number, target: number, observer: number): SimEvent => ({ kind: 'contact', tick: 1, side, target, level: 'identified', confidence: 1, observer });

  it('the world is what these cases assume', () => {
    const { w, s } = make();
    expect([w.sim.state.side[PLAYER], w.sim.state.side[ENEMY], w.sim.state.side[CIV]]).toEqual([0, 1, 2]);
    expect([w.sim.structures.owner[s.wall], w.sim.structures.owner[s.own0], w.sim.structures.owner[s.own1]]).toEqual([-1, 0, 1]);
  });

  const cases: readonly [string, (s: { wall: number; own0: number; own1: number }) => SimEvent, boolean][] = [
    ['the player fires on an enemy unit', () => fire(PLAYER, ENEMY), true],
    ['an enemy fires on a player unit', () => fire(ENEMY, PLAYER), true],
    ['an enemy fires on a structure the player owns', (s) => fire(ENEMY, -1, s.own0), true],
    ['the player fires on a structure the enemy owns', (s) => fire(PLAYER, -1, s.own1), true],
    ['an enemy fires on a civilian', () => fire(ENEMY, CIV), false],
    ['the player fires on a civilian', () => fire(PLAYER, CIV), false],
    ['an enemy breaches a NEUTRAL wall on its way somewhere', (s) => fire(ENEMY, -1, s.wall), false],
    ['an enemy fires on a structure its OWN side owns', (s) => fire(ENEMY, -1, s.own1), false],
    ['the player fires on a structure it owns itself', (s) => fire(PLAYER, -1, s.own0), false],
    ['a fire event with no target and no structure', () => fire(ENEMY, -1), false],
    ['a neutral (side 2) shooter hits a player unit', () => fire(CIV, PLAYER), false],
    ['the enemy identifies a player unit', () => contact(1, PLAYER, ENEMY), true],
    ['the player identifies an enemy unit', () => contact(0, ENEMY, PLAYER), true],
    ['a reveal: the player is handed an enemy (no observer)', () => contact(0, ENEMY, -1), true],
    ['the enemy identifies a civilian', () => contact(1, CIV, ENEMY), false],
    ['the player identifies a civilian', () => contact(0, CIV, PLAYER), false],
  ];
  for (const [name, build, expected] of cases) {
    it(`${expected ? 'fires' : 'does not fire'}: ${name}`, () => {
      const { w, s } = make();
      expect(fired(w.stepWith([build(s)]))).toBe(expected);
    });
  }

  it('a non-identified contact (suspected) never fires, whoever it is between', () => {
    const { w } = make();
    const e: SimEvent = { kind: 'contact', tick: 1, side: 0, target: ENEMY, level: 'suspected', confidence: 1, observer: PLAYER };
    expect(fired(w.stepWith([e]))).toBe(false);
  });
});
