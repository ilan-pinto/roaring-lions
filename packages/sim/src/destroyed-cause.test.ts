/**
 * GH-1380: how a unit died rides on its own `destroyed` event (`cause`, and `weaponId` when a weapon dealt it). One real-sim case per
 * path the sim kills by, every expectation a LITERAL (the weapon ids are the fixtures' own strings, never read back from the sim):
 * a round on a soft man and through a hard hull, a beam, a kamikaze's strike, the munition spending itself, a bystander in its blast,
 * a called strike, a building coming down on its garrison, an air carrier taking its riders with it, and a dev kill. The bleed-out is
 * pinned beside its own fixture in `wounded.test.ts`.
 *
 * The fields are presentation-only: no event is folded into `hash()`, so the determinism golden does not move (`determinism.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

const SOFT = { front: 10, side: 10, rear: 10 };
const RIFLES: UnitTypeJson = {
  id: 'dc_inf', role: 'infantry', hull: { hp: 400, armor: SOFT }, mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 }, abilities: ['garrison'],
  weapons: [{ id: 'dc_rifles', type: 'small_arms', range_tiles: 8, effective_range_tiles: 6.4, accuracy: 0.6, penetration: 8, damage: 15, suppression: 50, rof_per_min: 300 }],
};
const MAN: UnitTypeJson = { ...RIFLES, id: 'dc_man', weapons: [] };
const AT_TEAM: UnitTypeJson = {
  id: 'dc_at', hull: { hp: 380, armor: SOFT }, mobility: { speed_tiles_s: 0.7 }, sensors: { optics: 1.0, sight_tiles: 9, signature: 0.5 },
  weapons: [{ id: 'dc_atgm', type: 'atgm', range_tiles: 9, effective_range_tiles: 7.2, accuracy: 0.78, penetration: 900, damage: 400, suppression: 10, rof_per_min: 3 }],
};
const HULL: UnitTypeJson = {
  id: 'dc_hull', role: 'apc', hull: { hp: 300, armor: { front: 700, side: 300, rear: 150 } }, mobility: { speed_tiles_s: 0 },
  sensors: { optics: 1, sight_tiles: 8, signature: 1 }, weapons: [],
};
const MUNITION: UnitTypeJson = {
  id: 'dc_munition', role: 'drone', hull: { hp: 90, armor: { front: 0, side: 0, rear: 0 } }, mobility: { speed_tiles_s: 3 },
  sensors: { optics: 1.4, sight_tiles: 14, signature: 0.3 }, abilities: ['kamikaze'],
  weapons: [{ id: 'dc_warhead', type: 'heat', range_tiles: 1.3, effective_range_tiles: 1.3, accuracy: 0.9, penetration: 480, damage: 520, splash_tiles: 1.2, suppression: 70, rof_per_min: 60 }],
};
const BEAM_CARRIER: UnitTypeJson = {
  id: 'dc_beamer', role: 'aa', hull: { hp: 1100, armor: { front: 40, side: 25, rear: 20 } }, mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1.4, sight_tiles: 12, signature: 0.9 },
  weapons: [{ id: 'dc_beam', type: 'directed_energy', range_tiles: 9, accuracy: 1, penetration: 5, damage: 80, rof_per_min: 40, can_target: ['air'], collateral_risk: 0, beam: { dwell_s: 1.5, heat_s: 12, cooldown_s: 6 } }],
};
const DRONE: UnitTypeJson = {
  id: 'dc_drone', role: 'drone', hull: { hp: 200, armor: { front: 0, side: 0, rear: 0 } }, mobility: { speed_tiles_s: 1.0, domain: 'air' },
  sensors: { optics: 1, sight_tiles: 6, signature: 1.0 },
};
const HELI: UnitTypeJson = {
  id: 'dc_heli', role: 'apc', hull: { hp: 900, armor: { front: 4, side: 4, rear: 4 }, transport_slots: 6 },
  mobility: { speed_tiles_s: 3.2, domain: 'air' }, sensors: { optics: 1, sight_tiles: 10, signature: 1 }, weapons: [],
};
const HE_GUN: UnitTypeJson = {
  id: 'dc_gun', role: 'mbt', hull: { hp: 3000, armor: { front: 700, side: 300, rear: 150 } }, mobility: { speed_tiles_s: 0 },
  sensors: { optics: 1.2, sight_tiles: 14, signature: 1 },
  weapons: [{ id: 'dc_he', type: 'he', range_tiles: 12, effective_range_tiles: 10, accuracy: 0.8, penetration: 60, damage: 300, splash_tiles: 1.5, suppression: 60, rof_per_min: 12 }],
};
const SWARM: UnitTypeJson = {
  id: 'dc_swarm', role: 'drone', hull: { hp: 180, armor: { front: 5, side: 5, rear: 5 } }, mobility: { speed_tiles_s: 2.6, domain: 'air' },
  sensors: { optics: 1.2, sight_tiles: 10, signature: 0.6 }, swarm: { count: 12, member_hp: 15, spread_tiles: 3 },
};
const CALLER: UnitTypeJson = { id: 'dc_caller', role: 'infantry', hull: { hp: 400, armor: SOFT }, mobility: { speed_tiles_s: 1 }, sensors: { optics: 1, sight_tiles: 4, signature: 0.5 } };

type Destroyed = Extract<SimEvent, { kind: 'destroyed' }>;

/** Every `destroyed` the sim pushes over `ticks` ticks (stops early once `until` is dead). */
function deaths(sim: Sim, ticks: number, until?: number): Destroyed[] {
  const out: Destroyed[] = [];
  for (let i = 0; i < ticks; i++) {
    for (const e of sim.tick()) if (e.kind === 'destroyed') out.push(e);
    if (until !== undefined && sim.state.alive[until] === 0) break;
  }
  return out;
}
const of = (ds: Destroyed[], id: number): Destroyed | undefined => ds.find((d) => d.entity === id);

describe('the destroyed event says how (GH-1380)', () => {
  it('a round on a soft man: direct, with the rifle that fired it', () => {
    const sim = new Sim({ seed: 5, width: 32, height: 16, capacity: 8 });
    const man = sim.spawn(sim.addUnitType(MAN), 1, fx.from(7.5), fx.from(8.5));
    const sq = sim.spawn(sim.addUnitType(RIFLES), 0, fx.from(3.5), fx.from(8.5));
    expect(of(deaths(sim, 400 * TICKS_PER_SECOND, man), man)).toEqual({ kind: 'destroyed', tick: expect.any(Number), entity: man, by: sq, cause: 'direct', weaponId: 'dc_rifles' });
  });

  it('a penetration of a hard hull: direct, with the missile', () => {
    const sim = new Sim({ seed: 21, width: 32, height: 32, capacity: 8 });
    const hull = sim.spawn(sim.addUnitType(HULL), 1, fx.from(16.5), fx.from(16.5), 0);
    const at = sim.spawn(sim.addUnitType(AT_TEAM), 0, fx.from(10.5), fx.from(16.5));
    expect(of(deaths(sim, 400 * TICKS_PER_SECOND, hull), hull)).toMatchObject({ by: at, cause: 'direct', weaponId: 'dc_atgm' });
  });

  it('a beam: direct, with the beam', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 16, capacity: 16 });
    const drone = sim.spawn(sim.addUnitType(DRONE), 1, fx.from(11.5), fx.from(8.5));
    const truck = sim.spawn(sim.addUnitType(BEAM_CARRIER), 0, fx.from(3.5), fx.from(8.5));
    expect(of(deaths(sim, 60 * TICKS_PER_SECOND, drone), drone)).toMatchObject({ by: truck, cause: 'direct', weaponId: 'dc_beam' });
  });

  it('a kamikaze: the hull it struck is direct, the munition is spent, and a man beside the hull is splash -- all the warhead', () => {
    const sim = new Sim({ seed: 3, width: 40, height: 24, capacity: 8 });
    const hull = sim.spawn(sim.addUnitType({ ...HULL, hull: { hp: 60, armor: { front: 300, side: 10, rear: 10 } } }), 1, fx.from(20.5), fx.from(12.5), 32768);
    const bystander = sim.spawn(sim.addUnitType({ ...MAN, hull: { hp: 60, armor: SOFT } }), 1, fx.from(20.5), fx.from(12.8));
    const drone = sim.spawn(sim.addUnitType(MUNITION), 0, fx.from(20.5), fx.from(6.5), 16384);
    sim.identifyTo(0, hull);
    const ds = deaths(sim, 20 * 30, drone);
    expect(of(ds, hull)).toMatchObject({ by: drone, cause: 'direct', weaponId: 'dc_warhead' });
    expect(of(ds, bystander)).toMatchObject({ by: drone, cause: 'splash', weaponId: 'dc_warhead' });
    expect(of(ds, drone)).toMatchObject({ by: hull, cause: 'spent', weaponId: 'dc_warhead' });
  });

  it('a shell\'s blast: a man of the gun\'s own side beside its target is splash, with the shell', () => {
    // The bystander is on the gun's side, so it is never the gun's target: only the round's blast (`splashAt`) can reach him.
    const sim = new Sim({ seed: 11, width: 32, height: 16, capacity: 8 });
    sim.spawn(sim.addUnitType({ ...MAN, id: 'dc_tough', hull: { hp: 30000, armor: SOFT } }), 1, fx.from(14.5), fx.from(8.5));
    const bystander = sim.spawn(sim.addUnitType({ ...MAN, hull: { hp: 20, armor: SOFT } }), 0, fx.from(14.5), fx.from(8.9));
    const gun = sim.spawn(sim.addUnitType(HE_GUN), 0, fx.from(6.5), fx.from(8.5));
    expect(of(deaths(sim, 120 * TICKS_PER_SECOND, bystander), bystander)).toEqual({ kind: 'destroyed', tick: expect.any(Number), entity: bystander, by: gun, cause: 'splash', weaponId: 'dc_he' });
  });

  it('a swarm caught whole in a blast: splash (a bare blast names no weapon)', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 16, capacity: 8 });
    const swarm = sim.spawn(sim.addUnitType(SWARM), 1, fx.from(4.5), fx.from(4.5));
    sim.debugSplash(fx.from(4.5), fx.from(4.5), fx.from(3), fx.from(1), 0, -1, -1);
    expect(of(deaths(sim, 1), swarm)).toEqual({ kind: 'destroyed', tick: expect.any(Number), entity: swarm, by: -1, cause: 'splash' });
  });

  it('a called strike: strike, credited to the caller, with no weapon named', () => {
    const sim = new Sim({ seed: 7, width: 48, height: 32, capacity: 16 });
    const caller = sim.spawn(sim.addUnitType(CALLER), 0, fx.from(5.5), fx.from(5.5));
    const victim = sim.spawn(sim.addUnitType({ ...CALLER, id: 'dc_victim', hull: { hp: 50, armor: SOFT } }), 1, fx.from(24.5), fx.from(16.5));
    sim.queueCommand({ kind: 'callStrike', caller, x: fx.from(24.5), y: fx.from(16.5) });
    const d = of(deaths(sim, 400, victim), victim);
    expect(d).toEqual({ kind: 'destroyed', tick: expect.any(Number), entity: victim, by: caller, cause: 'strike' });
  });

  it('a building brought down on its garrison: collapse', () => {
    const sim = new Sim({ seed: 5, width: 32, height: 16, capacity: 16 });
    const house = sim.addStructure(sim.addStructureType({ id: 'dc_house', name: 'House', hp_per_tile: 260, garrison_slots: 2, rubble_cover: 2 }), [6 * 32 + 14, 6 * 32 + 15, 7 * 32 + 14, 7 * 32 + 15]);
    const holder = sim.spawn(sim.addUnitType(MAN), 1, fx.from(13.0), fx.from(6.5));
    sim.queueCommand({ kind: 'garrison', ids: [holder], structure: house });
    for (let i = 0; i < 20 * TICKS_PER_SECOND && sim.state.garrisonedIn[holder] !== house; i++) sim.tick();
    expect(sim.state.garrisonedIn[holder]).toBe(house); // the fixture put him inside
    sim.debugDestroyStructure(house);
    expect(of(deaths(sim, 1), holder)).toEqual({ kind: 'destroyed', tick: expect.any(Number), entity: holder, by: -1, cause: 'collapse' });
  });

  it('a tunnel brought down on the men in it: collapse', () => {
    const sim = new Sim({ seed: 5, width: 20, height: 12, capacity: 8 });
    const route = sim.addTunnel({ id: 'dc_tn', points: [[4, 6], [14, 6]], dig_tiles_per_s: 1, pre_dug: true, side: 1, capacity: 4 });
    const below = sim.spawn(sim.addUnitType(MAN), 1, fx.from(6.5), fx.from(6.5));
    sim.putInTunnel(below, route);
    expect(sim.state.tunnelIn[below]).toBe(route); // the fixture put him below
    sim.debugCollapseTunnel(route);
    expect(of(deaths(sim, 1), below)).toEqual({ kind: 'destroyed', tick: expect.any(Number), entity: below, by: -1, cause: 'collapse' });
  });

  it('a rider too hurt to survive the bail-out of a ground carrier: carrier', () => {
    const sim = new Sim({ seed: 5, width: 20, height: 12, capacity: 8 });
    const jeep = sim.spawn(sim.addUnitType({ ...HELI, id: 'dc_jeep', mobility: { speed_tiles_s: 2 } }), 0, fx.from(8.5), fx.from(6.5));
    const rider = sim.spawn(sim.addUnitType(MAN), 0, fx.from(8.5), fx.from(6.5));
    expect(sim.embarkAtSpawn(jeep, rider)).toBe(true);
    sim.state.hp[rider] = fx.from(10); // a test setup: the bail-out's 40% of 400 hp is lethal to him now
    sim.debugKill(jeep);
    expect(of(deaths(sim, 1), rider)).toEqual({ kind: 'destroyed', tick: expect.any(Number), entity: rider, by: -1, cause: 'carrier' });
  });

  it('an air carrier killed in the air: it is the dev kill (other), and every rider went down with it (carrier)', () => {
    const sim = new Sim({ seed: 0x6980_0003, width: 40, height: 40, capacity: 16 });
    const heli = sim.spawn(sim.addUnitType(HELI), 0, fx.from(20.5), fx.from(20.5));
    const inf = sim.addUnitType(MAN);
    const riders = [0, 1].map(() => sim.spawn(inf, 0, fx.from(20.5), fx.from(20.5)));
    for (const r of riders) expect(sim.embarkAtSpawn(heli, r)).toBe(true);
    sim.debugKill(heli);
    const ds = deaths(sim, 1);
    expect(of(ds, heli)).toEqual({ kind: 'destroyed', tick: expect.any(Number), entity: heli, by: -1, cause: 'other' });
    for (const r of riders) expect(of(ds, r)).toEqual({ kind: 'destroyed', tick: expect.any(Number), entity: r, by: -1, cause: 'carrier' });
  });
});
