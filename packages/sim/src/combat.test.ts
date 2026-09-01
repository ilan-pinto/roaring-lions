import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

// Combat model tests (GDD §5). These assert *directional* behaviour with wide
// statistical bounds; the calibrated targets (3:1 urban, ATGM Pk 0.7, APS
// 0.6–0.9, Lanchester) live in the backtest harness, not here.

const INF: UnitTypeJson = {
  id: 'c_inf',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [
    {
      id: 'rifle',
      type: 'small_arms',
      range_tiles: 8,
      effective_range_tiles: 6.4,
      accuracy: 0.6,
      penetration: 8,
      damage: 15,
      suppression: 50,
      rof_per_min: 300,
    },
  ],
};

const AT_TEAM: UnitTypeJson = {
  id: 'c_at',
  hull: { hp: 380, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.7 },
  sensors: { optics: 1.0, sight_tiles: 9, signature: 0.5 },
  weapons: [
    {
      id: 'atgm',
      type: 'atgm',
      range_tiles: 9,
      effective_range_tiles: 7.2,
      accuracy: 0.78,
      penetration: 900,
      damage: 400,
      suppression: 10,
      rof_per_min: 3,
    },
  ],
};

const MBT: UnitTypeJson = {
  id: 'c_mbt',
  hull: { hp: 3000, armor: { front: 700, side: 300, rear: 150 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 1.0, sight_tiles: 12, signature: 1.0 },
  weapons: [
    {
      id: 'gun',
      type: 'apfsds',
      range_tiles: 12,
      effective_range_tiles: 9.6,
      accuracy: 0.85,
      penetration: 1300,
      damage: 520,
      rof_per_min: 9,
    },
  ],
};

const MBT_APS: UnitTypeJson = {
  ...MBT,
  id: 'c_mbt_aps',
  hull: {
    ...MBT.hull,
    aps: { base_pk: 0.75, magazine: 3, reload_s: 8, ineffective_vs: ['apfsds', 'kinetic'] },
  },
};

/** A dug-in infantry company that soaks fire without dying: soft, so
 *  suppression applies in full, but deep enough to survive a long beating.
 *  (HP stays well inside the Q16.16 range — 32767 is the ceiling.) */
const DUMMY_COMPANY: UnitTypeJson = {
  ...INF,
  id: 'c_dummy_company',
  hull: { hp: 20000, armor: { front: 10, side: 10, rear: 10 } },
  weapons: [],
};

/** MBT stats without a gun — a target that shoots nothing back and (against
 *  low-pen fire) never dies, so statistics can accumulate. */
const DUMMY_MBT: UnitTypeJson = { ...MBT, id: 'c_dummy_mbt', weapons: [] };
const DUMMY_INF: UnitTypeJson = { ...INF, id: 'c_dummy_inf', weapons: [] };

/** Rapid low-penetration gun on a tank chassis: hits often, penetrates never. */
const TESTGUN: UnitTypeJson = {
  ...MBT,
  id: 'c_testgun',
  weapons: [
    {
      id: 'testgun',
      type: 'autocannon',
      range_tiles: 12,
      effective_range_tiles: 9.6,
      accuracy: 0.85,
      penetration: 30,
      damage: 5,
      rof_per_min: 30,
    },
  ],
};

function collect(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

describe('detection (GDD 5.1)', () => {
  it('identifies a visible enemy, faster when close, never through walls', () => {
    const sim = new Sim({ seed: 5, width: 32, height: 32, capacity: 16 });
    const inf = sim.addUnitType(INF);
    sim.spawn(inf, 0, fx.fromInt(10), fx.fromInt(10)); // observer
    sim.spawn(inf, 1, fx.fromInt(14), fx.fromInt(10)); // 4 tiles east
    const events = collect(sim, 10 * TICKS_PER_SECOND);
    const ident = events.find((e) => e.kind === 'contact' && e.level === 'identified' && e.target === 1);
    expect(ident).toBeDefined();

    // Same geometry with a wall between: never even suspected.
    const sim2 = new Sim({ seed: 5, width: 32, height: 32, capacity: 16 });
    const inf2 = sim2.addUnitType(INF);
    for (let y = 0; y < 32; y++) sim2.setBlocked(12, y, true);
    sim2.spawn(inf2, 0, fx.fromInt(10), fx.fromInt(10));
    sim2.spawn(inf2, 1, fx.fromInt(14), fx.fromInt(10));
    const events2 = collect(sim2, 10 * TICKS_PER_SECOND);
    expect(events2.some((e) => e.kind === 'contact' && e.target === 1)).toBe(false);
  });

  it('cover slows detection down', () => {
    const timeToIdentify = (coverLevel: number): number => {
      const sim = new Sim({ seed: 9, width: 32, height: 32, capacity: 16 });
      const inf = sim.addUnitType(INF);
      if (coverLevel > 0) sim.setCover(16, 10, coverLevel);
      sim.spawn(inf, 0, fx.fromInt(10), fx.fromInt(10));
      sim.spawn(inf, 1, fx.from(16.5), fx.from(10.5));
      for (let t = 0; t < 60 * TICKS_PER_SECOND; t++) {
        const evs = sim.tick();
        if (evs.some((e) => e.kind === 'contact' && e.level === 'identified' && e.target === 1)) {
          return t;
        }
      }
      return Infinity;
    };
    const open = timeToIdentify(0);
    const covered = timeToIdentify(3);
    expect(open).toBeLessThan(covered);
  });

  it('firing multiplies signature — shooting reveals you', () => {
    // Two hidden AT teams in cover at the same range from an observer;
    // one has a target to shoot at, the other stays silent.
    const sim = new Sim({ seed: 31, width: 48, height: 48, capacity: 16 });
    const at = sim.addUnitType(AT_TEAM);
    const mbt = sim.addUnitType(MBT);
    sim.setCover(30, 10, 2);
    sim.setCover(30, 40, 2);
    const shooterAt = sim.spawn(at, 1, fx.from(30.5), fx.from(10.5));
    sim.spawn(at, 1, fx.from(30.5), fx.from(40.5)); // silent — its tank is out of ATGM range
    // One tank inside the shooter's 9-tile range; the other 10 tiles from the
    // silent team (outside ATGM range, inside the tank's 12-tile sight).
    sim.spawn(mbt, 0, fx.from(24.5), fx.from(10.5));
    sim.spawn(mbt, 0, fx.from(20.5), fx.from(40.5));

    let shooterIdentifiedAt = Infinity;
    let silentIdentifiedAt = Infinity;
    for (let t = 0; t < 40 * TICKS_PER_SECOND; t++) {
      for (const e of sim.tick()) {
        if (e.kind === 'contact' && e.level === 'identified' && e.side === 0) {
          if (e.target === shooterAt && shooterIdentifiedAt === Infinity) shooterIdentifiedAt = t;
          if (e.target === 1 && silentIdentifiedAt === Infinity) silentIdentifiedAt = t;
        }
      }
    }
    expect(shooterIdentifiedAt).toBeLessThan(silentIdentifiedAt);
  });
});

describe('hit chance (GDD 5.2)', () => {
  it('close stationary shots hit more often than long-range ones', () => {
    const hitRate = (rangeTiles: number): number => {
      const sim = new Sim({ seed: 77, width: 64, height: 16, capacity: 8 });
      const gun = sim.addUnitType(TESTGUN);
      const dummy = sim.addUnitType(DUMMY_MBT);
      sim.spawn(gun, 0, fx.from(2.5), fx.from(8.5));
      sim.spawn(dummy, 1, fx.from(2.5 + rangeTiles), fx.from(8.5));
      const evs = collect(sim, 120 * TICKS_PER_SECOND);
      const fires = evs.filter((e) => e.kind === 'fire' && e.shooter === 0);
      const hits = fires.filter((e) => e.kind === 'fire' && e.willHit);
      return fires.length > 0 ? hits.length / fires.length : 0;
    };
    const close = hitRate(4);
    const far = hitRate(11);
    expect(close).toBeGreaterThan(far);
    expect(close).toBeGreaterThan(0.5);
  });

  it('fire events expose the full factor breakdown for the overlay', () => {
    const sim = new Sim({ seed: 3, width: 32, height: 16, capacity: 8 });
    const mbt = sim.addUnitType(MBT);
    sim.spawn(mbt, 0, fx.from(2.5), fx.from(8.5));
    sim.spawn(mbt, 1, fx.from(8.5), fx.from(8.5));
    const evs = collect(sim, 20 * TICKS_PER_SECOND);
    const fire = evs.find((e) => e.kind === 'fire');
    expect(fire).toBeDefined();
    if (fire && fire.kind === 'fire') {
      expect(fire.pHit).toBeGreaterThan(0);
      expect(fire.pHit).toBeLessThanOrEqual(65536);
      for (const k of ['accuracy', 'rangeFalloff', 'coverMod', 'motionMod', 'stanceMod', 'suppressionMod'] as const) {
        expect(fire.breakdown[k], k).toBeGreaterThan(0);
        expect(fire.breakdown[k], k).toBeLessThanOrEqual(65536);
      }
    }
  });
});

describe('penetration as a curve with facing arcs (GDD 5.3)', () => {
  it('rifles never penetrate an MBT front; ATGMs usually do', () => {
    const penRate = (attacker: UnitTypeJson): { pens: number; impacts: number } => {
      const sim = new Sim({ seed: 13, width: 32, height: 16, capacity: 8 });
      const a = sim.addUnitType(attacker);
      const m = sim.addUnitType(DUMMY_MBT);
      sim.spawn(a, 0, fx.from(2.5), fx.from(8.5));
      // Tank deployed facing its attacker (west) — shots land on the front arc.
      const tank = sim.spawn(m, 1, fx.from(7.5), fx.from(8.5), 32768);
      const evs = collect(sim, 150 * TICKS_PER_SECOND);
      const impacts = evs.filter((e) => e.kind === 'impact' && e.target === tank);
      const pens = impacts.filter((e) => e.kind === 'impact' && e.penetrated);
      return { pens: pens.length, impacts: impacts.length };
    };

    const rifle = penRate(INF);
    expect(rifle.impacts).toBeGreaterThan(5);
    expect(rifle.pens).toBe(0);

    const atgm = penRate(AT_TEAM);
    expect(atgm.impacts).toBeGreaterThan(3);
    expect(atgm.pens / atgm.impacts).toBeGreaterThan(0.75);
  });

  it('flanking works: rear shots see rear armor and higher pen probability', () => {
    const sim = new Sim({ seed: 21, width: 32, height: 32, capacity: 8 });
    const at = sim.addUnitType(AT_TEAM);
    const m = sim.addUnitType(DUMMY_MBT);
    // Deployed facing east, shot from the west — pure rear aspect.
    const tank = sim.spawn(m, 1, fx.from(16.5), fx.from(16.5), 0);
    sim.spawn(at, 0, fx.from(10.5), fx.from(16.5));
    const evs = collect(sim, 60 * TICKS_PER_SECOND);
    const impacts = evs.filter((e) => e.kind === 'impact' && e.target === tank);
    expect(impacts.length).toBeGreaterThan(0);
    for (const e of impacts) {
      if (e.kind === 'impact') {
        expect(e.arc).toBe('rear');
        expect(e.pPen).toBeGreaterThan(fx.from(0.95));
      }
    }
  });
});

describe('component damage (GDD 5.4)', () => {
  it('most penetrations do not destroy the vehicle at moderate overmatch', () => {
    let componentEvents = 0;
    let catastrophic = 0;
    let crewShaken = 0;
    for (let seed = 0; seed < 30; seed++) {
      const sim = new Sim({ seed: 1000 + seed, width: 32, height: 16, capacity: 8 });
      const at = sim.addUnitType(AT_TEAM);
      const m = sim.addUnitType(DUMMY_MBT);
      sim.spawn(at, 0, fx.from(2.5), fx.from(8.5));
      const tank = sim.spawn(m, 1, fx.from(7.5), fx.from(8.5), 32768); // facing its attacker
      const evs = collect(sim, 60 * TICKS_PER_SECOND);
      for (const e of evs) {
        if (e.kind === 'component' && e.target === tank) {
          componentEvents++;
          if (e.result === 'catastrophic') catastrophic++;
          if (e.result === 'crew_shaken') crewShaken++;
        }
      }
    }
    expect(componentEvents).toBeGreaterThan(30);
    expect(catastrophic / componentEvents).toBeLessThan(0.4);
    expect(crewShaken / componentEvents).toBeGreaterThan(0.2);
  });

  it('mobility kills stop movement but leave the gun firing', () => {
    // Deterministic search across seeds for a mobility-kill case, then assert
    // the immobilised tank keeps shooting.
    for (let seed = 0; seed < 60; seed++) {
      const sim = new Sim({ seed: 400 + seed, width: 48, height: 16, capacity: 8 });
      const at = sim.addUnitType(AT_TEAM);
      const m = sim.addUnitType(MBT);
      sim.spawn(at, 0, fx.from(2.5), fx.from(8.5));
      const tank = sim.spawn(m, 1, fx.from(8.5), fx.from(8.5));
      sim.queueCommand({ kind: 'move', ids: [tank], x: fx.fromInt(40), y: fx.from(8.5) });
      let sawMobilityKill = false;
      let firedAfter = false;
      for (let t = 0; t < 60 * TICKS_PER_SECOND; t++) {
        for (const e of sim.tick()) {
          if (e.kind === 'component' && e.result === 'mobility_kill' && e.target === tank) {
            sawMobilityKill = true;
          }
          if (sawMobilityKill && e.kind === 'fire' && e.shooter === tank) firedAfter = true;
        }
        if (firedAfter) break;
      }
      if (sawMobilityKill) {
        expect(sim.state.moving[tank]).toBe(0);
        expect(firedAfter).toBe(true);
        return;
      }
    }
    throw new Error('no mobility kill observed across 60 seeds — weights broken?');
  });
});

describe('suppression (GDD 5.5)', () => {
  it('near misses pin infantry, and suppression decays after fire lifts', () => {
    const sim = new Sim({ seed: 55, width: 32, height: 16, capacity: 16 });
    const inf = sim.addUnitType(INF);
    const dummy = sim.addUnitType(DUMMY_COMPANY);
    // Three squads pour rifle fire onto a dug-in position: the rounds do
    // little, but the men stop moving — suppression is what volume of fire
    // buys you (GDD 5.5). (Against armour it would barely register: rifle
    // rounds cracking off a hull are noise, not a threat.)
    sim.spawn(inf, 0, fx.from(3.5), fx.from(7.5));
    sim.spawn(inf, 0, fx.from(3.5), fx.from(8.5));
    sim.spawn(inf, 0, fx.from(3.5), fx.from(9.5));
    const target = sim.spawn(dummy, 1, fx.from(9.5), fx.from(8.5));

    let pinnedTick = -1;
    for (let t = 0; t < 60 * TICKS_PER_SECOND; t++) {
      for (const e of sim.tick()) {
        if (e.kind === 'pinned' && e.entity === target) pinnedTick = t;
      }
      if (pinnedTick >= 0) break;
    }
    expect(pinnedTick).toBeGreaterThanOrEqual(0);
    const sAtPin = sim.state.suppression[target];
    expect(sAtPin).toBeGreaterThan(fx.from(0.7));

    // Kill the shooters' will: remove them, watch suppression decay.
    sim.debugKill(0);
    sim.debugKill(1);
    sim.debugKill(2);
    for (let t = 0; t < 20 * TICKS_PER_SECOND; t++) sim.tick();
    expect(sim.state.suppression[target]).toBeLessThan(sAtPin / 2);
  });

  it('suppressed shooters are less accurate (1/(1+kS) shows up in fire events)', () => {
    const sim = new Sim({ seed: 8, width: 32, height: 16, capacity: 16 });
    const inf = sim.addUnitType(INF);
    sim.spawn(inf, 0, fx.from(3.5), fx.from(7.5));
    sim.spawn(inf, 0, fx.from(3.5), fx.from(9.5));
    const shooter = sim.spawn(inf, 1, fx.from(9.5), fx.from(8.5));
    const evs = collect(sim, 30 * TICKS_PER_SECOND);
    const late = evs.filter(
      (e): e is Extract<SimEvent, { kind: 'fire' }> => e.kind === 'fire' && e.shooter === shooter
    );
    expect(late.length).toBeGreaterThan(2);
    const lastFire = late[late.length - 1];
    expect(lastFire.breakdown.suppressionMod).toBeLessThan(fx.from(0.85));
  });
});

describe('rout (GDD 5.5a)', () => {
  it('soft units pinned too long break, flee the kill zone, and rally when fire lifts', () => {
    const sim = new Sim({ seed: 77, width: 32, height: 16, capacity: 16 });
    const inf = sim.addUnitType(INF);
    // Soft (routs) but durable enough to survive the fire until it breaks.
    const victim = sim.addUnitType({
      ...DUMMY_INF,
      id: 'c_tough_inf',
      hull: { ...DUMMY_INF.hull, hp: 6000 },
    });
    sim.spawn(inf, 0, fx.from(3.5), fx.from(7.5));
    sim.spawn(inf, 0, fx.from(3.5), fx.from(8.5));
    sim.spawn(inf, 0, fx.from(3.5), fx.from(9.5));
    const target = sim.spawn(victim, 1, fx.from(9.5), fx.from(8.5));

    let routTick = -1;
    for (let t = 0; t < 40 * TICKS_PER_SECOND && routTick < 0; t++) {
      for (const e of sim.tick()) if (e.kind === 'routed' && e.entity === target) routTick = t;
    }
    expect(routTick).toBeGreaterThan(0);
    expect(sim.state.routed[target]).toBe(1);
    // Fleeing AWAY from the shooters (they are west), at speed, while pinned.
    const xAtRout = fx.toNumber(sim.state.posX[target]);
    for (let t = 0; t < 4 * TICKS_PER_SECOND; t++) sim.tick();
    expect(fx.toNumber(sim.state.posX[target])).toBeGreaterThan(xAtRout + 1);

    // Fire lifts: suppression decays, the unit rallies and stops.
    sim.debugKill(0);
    sim.debugKill(1);
    sim.debugKill(2);
    let rallied = false;
    for (let t = 0; t < 30 * TICKS_PER_SECOND && !rallied; t++) {
      for (const e of sim.tick()) if (e.kind === 'rallied' && e.entity === target) rallied = true;
    }
    expect(rallied).toBe(true);
    expect(sim.state.routed[target]).toBe(0);
    expect(sim.state.moving[target]).toBe(0);
  });
});

describe('Trophy APS (GDD 5.6)', () => {
  it('intercepts shaped charge in the 0.6-0.9 band, never APFSDS', () => {
    let atgmShots = 0;
    let atgmIntercepts = 0;
    for (let seed = 0; seed < 40; seed++) {
      const sim = new Sim({ seed: 7000 + seed, width: 32, height: 16, capacity: 8 });
      const at = sim.addUnitType(AT_TEAM);
      const m = sim.addUnitType(MBT_APS);
      sim.spawn(at, 0, fx.from(2.5), fx.from(8.5));
      const tank = sim.spawn(m, 1, fx.from(8.5), fx.from(8.5));
      const evs = collect(sim, 10 * TICKS_PER_SECOND);
      for (const e of evs) {
        if (e.kind === 'aps' && e.target === tank) {
          atgmShots++;
          if (e.intercepted) atgmIntercepts++;
        }
      }
    }
    expect(atgmShots).toBeGreaterThan(20);
    const rate = atgmIntercepts / atgmShots;
    expect(rate).toBeGreaterThan(0.55);
    expect(rate).toBeLessThan(0.95);

    // APFSDS: the APS never attempts an intercept (ineffective_vs).
    const sim = new Sim({ seed: 99, width: 32, height: 16, capacity: 8 });
    const m1 = sim.addUnitType(MBT);
    const m2 = sim.addUnitType(MBT_APS);
    sim.spawn(m1, 0, fx.from(2.5), fx.from(8.5));
    sim.spawn(m2, 1, fx.from(10.5), fx.from(8.5));
    const evs = collect(sim, 20 * TICKS_PER_SECOND);
    expect(evs.filter((e) => e.kind === 'aps').length).toBe(0);
    expect(evs.filter((e) => e.kind === 'impact' && e.target === 1).length).toBeGreaterThan(0);
  });

  it('saturation beats the magazine: a salvo gets missiles through', () => {
    // 6 AT teams volley at one 3-round APS tank. With a finite magazine the
    // 4th+ missiles cannot be intercepted at all.
    let through = 0;
    let salvos = 0;
    for (let seed = 0; seed < 15; seed++) {
      const sim = new Sim({ seed: 300 + seed, width: 32, height: 32, capacity: 16 });
      const at = sim.addUnitType(AT_TEAM);
      const m = sim.addUnitType(MBT_APS);
      for (let i = 0; i < 6; i++) sim.spawn(at, 0, fx.from(3.5), fx.from(11.5 + i * 2));
      sim.spawn(m, 1, fx.from(9.5), fx.from(16.5));
      const evs = collect(sim, 8 * TICKS_PER_SECOND);
      const impacts = evs.filter((e) => e.kind === 'impact' && e.target === 6).length;
      salvos++;
      if (impacts > 0) through++;
    }
    expect(through / salvos).toBeGreaterThan(0.6);
  });
});

describe('death and cleanup', () => {
  it('destroyed units stop existing for combat and emit one destroyed event', () => {
    const sim = new Sim({ seed: 2, width: 32, height: 16, capacity: 8 });
    const at = sim.addUnitType(AT_TEAM);
    const inf = sim.addUnitType(DUMMY_INF);
    sim.spawn(at, 0, fx.from(2.5), fx.from(8.5));
    const victim = sim.spawn(inf, 1, fx.from(6.5), fx.from(8.5));
    const evs = collect(sim, 120 * TICKS_PER_SECOND);
    const destroyed = evs.filter((e) => e.kind === 'destroyed' && e.entity === victim);
    expect(destroyed.length).toBe(1);
    expect(sim.state.alive[victim]).toBe(0);
    const destroyTick = destroyed[0].kind === 'destroyed' ? destroyed[0].tick : 0;
    const firesAfter = evs.filter(
      (e) => e.kind === 'fire' && e.target === victim && e.tick > destroyTick
    );
    expect(firesAfter.length).toBe(0);
  });
});

// #105: a firepower kill at point-blank range deadlocked the engagement
// forever. Both halves are needed to reproduce it: the target must be inside
// the shooter's minimum range AND already firepower-killed, so it can neither
// shoot nor be shot. Nothing errored -- the fight simply never ended, and any
// objective waiting on that unit hung with it.
describe('point-blank firepower kill (#105)', () => {
  const MIN_RANGE_AT: UnitTypeJson = {
    id: 'c_minat',
    hull: { hp: 380, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 0.7 },
    sensors: { optics: 1.0, sight_tiles: 9, signature: 0.5 },
    weapons: [
      {
        id: 'kornet',
        type: 'atgm',
        range_tiles: 10,
        effective_range_tiles: 8,
        accuracy: 0.9,
        penetration: 1200,
        damage: 500,
        suppression: 10,
        rof_per_min: 12,
        min_range_tiles: 1,
      },
    ],
  };

  const HULK: UnitTypeJson = {
    id: 'c_hulk',
    hull: { hp: 900, armor: { front: 600, side: 400, rear: 200 } },
    mobility: { speed_tiles_s: 0.8 },
    sensors: { optics: 1.0, sight_tiles: 9, signature: 1.0 },
    weapons: [
      {
        id: 'main',
        type: 'apfsds',
        range_tiles: 10,
        effective_range_tiles: 8,
        accuracy: 0.8,
        penetration: 700,
        damage: 600,
        suppression: 40,
        rof_per_min: 6,
      },
    ],
  };

  /** Cell and hulk 0.7 tiles apart -- inside the Kornet's 1-tile minimum. */
  function pointBlank(): { sim: Sim; cell: number; hulk: number } {
    const sim = new Sim({ seed: 11016, width: 24, height: 24, capacity: 8 });
    const at = sim.addUnitType(MIN_RANGE_AT);
    const tank = sim.addUnitType(HULK);
    const cell = sim.spawn(at, 0, fx.from(14), fx.from(10), 0);
    const hulk = sim.spawn(tank, 1, fx.from(14.7), fx.from(10), 0);
    return { sim, cell, hulk };
  }

  it('a HEALTHY target inside minimum range is still refused', () => {
    // The narrowness of the fix, pinned. Minimum range is a real constraint
    // and this must not become "shoot anything close".
    const { sim, hulk } = pointBlank();
    for (let i = 0; i < 400; i++) sim.tick();
    expect(sim.state.alive[hulk]).toBe(1);
  });

  it('a firepower-killed target inside minimum range can be finished off', () => {
    const { sim, hulk } = pointBlank();
    sim.debugDisableFirepower(hulk);
    let died = -1;
    for (let i = 0; i < 1200 && died < 0; i++) {
      sim.tick();
      if (sim.state.alive[hulk] === 0) died = i;
    }
    // Before the fix this ran to the cap with both units standing still: the
    // hulk could not shoot (firepowerKilled) and could not be shot (min range).
    expect(sim.state.alive[hulk]).toBe(0);
    expect(died).toBeGreaterThan(0);
  });
});
