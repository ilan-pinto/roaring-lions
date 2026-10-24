// E6 (GH-274) item 3: the directed_energy weapon class and its `beam` block. Engine only: no
// shipped unit carries one (aa_gachelet is built elsewhere), so these fixtures are the only
// content the sim sees. Numbers are the approved ones: dwell 1.5 s, heat 12 s, cooldown 6 s.
//
//   1. the dwell: damage lands only after dwell_s uninterrupted, then the dwell starts over;
//   2. the dwell resets on a target switch, on a line-of-sight break and on smoke;
//   3. smoke blocks even when another unit identifies the target;
//   4. the heat lockout and the cooldown;
//   5. the air-only filter and armour immunity;
//   6. the load rules and the deferred hash fold.
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, unitTypeFromJson, type SimEvent, type UnitTypeJson } from './sim';

const DWELL = 30; // 1.5 s
const HEAT = 240; // 12 s
const COOL = 120; // 6 s

const BEAM_WEAPON = {
  id: 'beam', type: 'directed_energy', range_tiles: 9, accuracy: 1, penetration: 5, damage: 80,
  rof_per_min: 40, can_target: ['air'], collateral_risk: 0,
  beam: { dwell_s: 1.5, heat_s: 12, cooldown_s: 6 },
};

const CARRIER: UnitTypeJson = {
  id: 'b_carrier',
  role: 'aa',
  hull: { hp: 1100, armor: { front: 40, side: 25, rear: 20 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1.4, sight_tiles: 12, signature: 0.9 },
  weapons: [BEAM_WEAPON],
};

/** A soft aircraft that survives a whole burst (8 hits of 80). */
const DRONE: UnitTypeJson = {
  id: 'b_drone',
  role: 'drone',
  hull: { hp: 5000, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 1.0, domain: 'air' },
  sensors: { optics: 1, sight_tiles: 6, signature: 1.0 },
};

/** The same airframe with plate on it: pen 5 must do nothing. */
const PLATED: UnitTypeJson = { ...DRONE, id: 'b_plated', hull: { hp: 5000, armor: { front: 80, side: 80, rear: 80 } } };

const TRUCK: UnitTypeJson = {
  id: 'b_truck',
  role: 'technical',
  hull: { hp: 5000, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 6, signature: 1.0 },
};

const SPOTTER: UnitTypeJson = {
  id: 'b_spotter',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1.4, sight_tiles: 14, signature: 0.4 },
  weapons: [],
};

const SAPPER: UnitTypeJson = {
  id: 'b_sapper',
  role: 'engineer',
  hull: { hp: 380, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.5 },
  abilities: ['smoke'],
  weapons: [],
};

interface World {
  sim: Sim;
  carrier: number;
  drone: number;
  events: SimEvent[];
}

/** Carrier (3.5,8.5) vs a drone 8 tiles east, both in the open. `tick` records events. */
function world(opts: { drone?: UnitTypeJson; seed?: number } = {}): World {
  const sim = new Sim({ seed: opts.seed ?? 7, width: 32, height: 16, capacity: 16 });
  const c = sim.addUnitType(CARRIER);
  const d = sim.addUnitType(opts.drone ?? DRONE);
  const carrier = sim.spawn(c, 0, fx.from(3.5), fx.from(8.5));
  const drone = sim.spawn(d, 1, fx.from(11.5), fx.from(8.5));
  return { sim, carrier, drone, events: [] };
}

function step(w: World, ticks = 1): void {
  for (let i = 0; i < ticks; i++) w.events.push(...w.sim.tick());
}

const struck = (w: World): SimEvent[] => w.events.filter((e) => e.kind === 'beam' && e.phase === 'struck');
const hpOf = (w: World, id: number): number => fx.toNumber(w.sim.state.hp[id]);

/** Tick until the beam first has the drone as its dwell target; returns once dwell is 1. */
function untilDwelling(w: World, max = 400): void {
  for (let i = 0; i < max; i++) {
    step(w);
    if (w.sim.beamState(w.carrier).target >= 0) return;
  }
  throw new Error('the beam never started dwelling');
}

describe('beam: the dwell', () => {
  it('lands no damage before dwell_s of uninterrupted time on target, then exactly one hit', () => {
    const w = world();
    untilDwelling(w);
    expect(w.sim.beamState(w.carrier).dwell).toBe(1);
    expect(hpOf(w, w.drone)).toBe(5000);
    step(w, DWELL - 2); // dwell is now DWELL - 1
    expect(struck(w)).toHaveLength(0);
    expect(hpOf(w, w.drone)).toBe(5000);
    step(w); // the DWELLth tick on target
    expect(struck(w)).toHaveLength(1);
    expect(hpOf(w, w.drone)).toBe(5000 - 80);
    expect(w.sim.beamState(w.carrier).dwell).toBe(0); // starts over
  });

  it('delivers one hit every dwell_s after that', () => {
    const w = world();
    untilDwelling(w);
    step(w, DWELL - 1 + 3 * DWELL);
    const ticks = struck(w).map((e) => e.tick);
    expect(ticks).toHaveLength(4);
    expect(ticks[1] - ticks[0]).toBe(DWELL);
    expect(ticks[3] - ticks[2]).toBe(DWELL);
    expect(hpOf(w, w.drone)).toBe(5000 - 4 * 80);
  });

  it('puts no projectile in the air: no fire event, no round', () => {
    const w = world();
    untilDwelling(w);
    step(w, 2 * DWELL);
    expect(w.events.some((e) => e.kind === 'fire')).toBe(false);
    expect(struck(w).length).toBeGreaterThan(0);
  });
});

describe('beam: the dwell resets', () => {
  it('on a target switch', () => {
    const w = world();
    const d2 = w.sim.addUnitType({ ...DRONE, id: 'b_drone2' });
    const other = w.sim.spawn(d2, 1, fx.from(9.5), fx.from(10.5)); // nearer: the scan takes it first
    untilDwelling(w);
    for (let i = 0; i < 300 && w.sim.contactLevel(0, w.drone) < 2; i++) step(w);
    expect(w.sim.contactLevel(0, w.drone)).toBe(2);
    // Land mid-dwell: pad to dwell 15 of the current run on the nearer aircraft.
    for (let i = 0; i < 100 && w.sim.beamState(w.carrier).dwell !== 15; i++) step(w);
    expect(w.sim.beamState(w.carrier).dwell).toBe(15);
    expect(w.sim.beamState(w.carrier).target).toBe(other);
    const hits = struck(w).length;
    // An order onto the other aircraft is a switch.
    w.sim.queueCommand({ kind: 'attack', ids: [w.carrier], target: w.drone });
    step(w);
    expect(w.sim.beamState(w.carrier)).toMatchObject({ target: w.drone, dwell: 1 });
    expect(struck(w)).toHaveLength(hits);
  });

  it('when the target leaves the beam own line of sight (a wall), and does not resume', () => {
    const w = world();
    untilDwelling(w);
    step(w, 19);
    expect(w.sim.beamState(w.carrier).dwell).toBe(20);
    w.sim.setBlocked(7, 8, true);
    step(w, 5);
    expect(w.sim.beamState(w.carrier).target).toBe(-1);
    expect(w.sim.beamState(w.carrier).dwell).toBe(0);
    w.sim.setBlocked(7, 8, false);
    step(w);
    // Back on target, but from one: the 20 ticks already spent are gone.
    expect(w.sim.beamState(w.carrier)).toMatchObject({ target: w.drone, dwell: 1 });
    step(w, DWELL - 2);
    expect(struck(w)).toHaveLength(0);
    step(w);
    expect(struck(w)).toHaveLength(1);
  });

  it('when smoke is laid across the line mid-dwell', () => {
    const w = world();
    const sap = w.sim.addUnitType(SAPPER);
    const sapper = w.sim.spawn(sap, 0, fx.from(4.5), fx.from(9.5));
    untilDwelling(w);
    step(w, 10);
    expect(w.sim.beamState(w.carrier).dwell).toBeGreaterThan(5);
    w.sim.queueCommand({ kind: 'smoke', ids: [sapper], x: fx.from(7.5), y: fx.from(11.5) });
    step(w, 3);
    expect(w.sim.smokeAt(7, 8)).toBeGreaterThan(0);
    expect(w.sim.beamState(w.carrier)).toMatchObject({ target: -1, dwell: 0 });
    step(w, 3 * DWELL);
    expect(struck(w)).toHaveLength(0);
  });
});

describe('beam: smoke blocks it even when another unit spots the target', () => {
  /** Carrier west, drone east, a spotter south of the drone with a clear line, smoke between. */
  function smoked(withSmoke: boolean): World {
    const w = world();
    const sp = w.sim.addUnitType(SPOTTER);
    const sap = w.sim.addUnitType(SAPPER);
    w.sim.spawn(sp, 0, fx.from(11.5), fx.from(12.5));
    const sapper = w.sim.spawn(sap, 0, fx.from(4.5), fx.from(9.5));
    if (withSmoke) w.sim.queueCommand({ kind: 'smoke', ids: [sapper], x: fx.from(7.5), y: fx.from(11.5) });
    step(w, 6 * TICKS_PER_SECOND);
    return w;
  }

  it('fires with a clear line (the control)', () => {
    const w = smoked(false);
    expect(struck(w).length).toBeGreaterThan(0);
  });

  it('does not fire through one plume the spotter keeps the target identified past', () => {
    const w = smoked(true);
    expect(w.sim.smokeAt(7, 8)).toBeGreaterThan(0);
    // The plume is one thin screen (SMOKE_MAX is under the sight-blocking threshold): the
    // target is still identified by side, which is exactly the case the rule is for.
    expect(w.sim.contactLevel(0, w.drone)).toBe(2);
    expect(struck(w)).toHaveLength(0);
    expect(w.sim.beamState(w.carrier).target).toBe(-1);
    expect(hpOf(w, w.drone)).toBe(5000);
  });
});

describe('beam: heat and cooldown', () => {
  function burst(): World {
    const w = world();
    untilDwelling(w);
    return w;
  }

  it('fires for heat_s, then locks out: eight hits, then silence', () => {
    const w = burst();
    step(w, HEAT - 1); // the HEATth tick on target
    const lock = w.events.filter((e) => e.kind === 'beam' && e.phase === 'lockout');
    expect(lock).toHaveLength(1);
    expect(struck(w)).toHaveLength(HEAT / DWELL);
    expect(w.sim.beamState(w.carrier).locked).toBe(true);
    expect(w.sim.beamState(w.carrier).heat).toBe(0);
    const n = struck(w).length;
    step(w, COOL - 1);
    expect(struck(w)).toHaveLength(n);
    expect(w.sim.beamState(w.carrier)).toMatchObject({ locked: true, target: -1, dwell: 0 });
  });

  it('is silent for exactly cooldown_s, then starts cool and dwells again from one', () => {
    const w = burst();
    step(w, HEAT - 1);
    step(w, COOL - 1); // lockout ticks lockTick + 1 .. lockTick + COOL - 1 so far
    expect(w.sim.beamState(w.carrier).locked).toBe(true); // the COOLth silent tick is next
    step(w);
    expect(w.sim.beamState(w.carrier).locked).toBe(false);
    expect(struck(w)).toHaveLength(HEAT / DWELL);
    step(w);
    expect(w.sim.beamState(w.carrier)).toMatchObject({ locked: false, target: w.drone, dwell: 1, heat: 1 });
    const n = struck(w).length;
    step(w, DWELL - 1);
    expect(struck(w)).toHaveLength(n + 1); // a full burst budget is back
  });

  it('drains heat while off target, one per tick', () => {
    const w = burst();
    step(w, 99); // 100 ticks on target
    expect(w.sim.beamState(w.carrier).heat).toBe(100);
    w.sim.setBlocked(7, 8, true);
    step(w, 40);
    w.sim.setBlocked(7, 8, false);
    step(w);
    // 100 on target, then 40 idle ticks drained (the tick it resumed on is the next one on).
    const { heat } = w.sim.beamState(w.carrier);
    expect(heat).toBeGreaterThan(55);
    expect(heat).toBeLessThan(65);
  });
});

describe('beam: what it can shoot', () => {
  it('ignores a ground target entirely (the existing can_target filter)', () => {
    const w = world({ drone: TRUCK });
    step(w, 3 * TICKS_PER_SECOND + DWELL * 3);
    expect(w.sim.contactLevel(0, w.drone)).toBe(2); // seen, and still not a beam target
    expect(w.sim.beamState(w.carrier).target).toBe(-1);
    expect(struck(w)).toHaveLength(0);
    expect(hpOf(w, w.drone)).toBe(5000);
  });

  it('does nothing to armour: pen 5 against plate', () => {
    const w = world({ drone: PLATED });
    untilDwelling(w);
    step(w, HEAT);
    expect(struck(w).length).toBeGreaterThan(0); // it dwelt and fired...
    expect(hpOf(w, w.drone)).toBe(5000); // ...and the plate took none of it
  });
});

describe('beam: load rules', () => {
  const unit = (weapon: object): UnitTypeJson => ({ ...CARRIER, weapons: [weapon as NonNullable<UnitTypeJson['weapons']>[number]] });

  it('requires a beam block on directed_energy', () => {
    const bare: Record<string, unknown> = { ...BEAM_WEAPON };
    delete bare.beam;
    expect(() => unitTypeFromJson(unit(bare))).toThrow(/needs a beam block/);
  });

  it('refuses a beam block on any other weapon class', () => {
    expect(() =>
      unitTypeFromJson(unit({ ...BEAM_WEAPON, type: 'small_arms' })),
    ).toThrow(/only for directed_energy/);
  });

  it('refuses indirect, and a heat budget under one dwell', () => {
    expect(() => unitTypeFromJson(unit({ ...BEAM_WEAPON, indirect: true }))).toThrow(/own line of sight/);
    expect(() =>
      unitTypeFromJson(unit({ ...BEAM_WEAPON, beam: { dwell_s: 3, heat_s: 2, cooldown_s: 6 } })),
    ).toThrow(/shorter than dwell_s/);
  });
});

describe('beam: the deferred hash fold', () => {
  it('registering a beam type moves no hash; only a beam on target does', () => {
    const a = new Sim({ seed: 3, width: 32, height: 16, capacity: 16 });
    const b = new Sim({ seed: 3, width: 32, height: 16, capacity: 16 });
    a.addUnitType(DRONE);
    b.addUnitType(DRONE);
    b.addUnitType(CARRIER);
    expect(b.hash()).toBe(a.hash());

    // The beam columns are not in the hash while no beam has been on a target: scribbling on
    // one changes nothing. (A private column, reached by cast; that is the point of the test.)
    const w = world();
    const cols = w.sim as unknown as { beamDwell: Int32Array };
    step(w, 2);
    const before = w.sim.hash();
    cols.beamDwell[0] = 17;
    expect(w.sim.hash()).toBe(before);
    cols.beamDwell[0] = 0;

    // Once a beam has been on a target the columns are folded, so the same scribble shows.
    untilDwelling(w);
    const live = w.sim.hash();
    cols.beamDwell[0] = cols.beamDwell[0] + 5;
    expect(w.sim.hash()).not.toBe(live);
  });

  it('once a beam is on target its state is hashed, and a replay agrees', () => {
    const run = (): number[] => {
      const w = world({ seed: 9 });
      untilDwelling(w);
      const out: number[] = [];
      for (let i = 0; i < 100; i++) {
        step(w);
        out.push(w.sim.hash());
      }
      return out;
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(new Set(a).size).toBeGreaterThan(50); // dwell counts move the hash tick to tick
  });
});
