// @vitest-environment jsdom
// WP-P5 acceptance: an alert line carries the unit and the place, fed by the
// REAL mission runtime's events through the adapter `main.ts` uses -- not by
// a fixture that agrees with the model by construction. First Light is the
// mission the audit photographed the defect in (play-22).
import { describe, expect, it } from 'vitest';
import { MissionRuntime, Sim, TICKS_PER_SECOND, type MissionJson } from '@lions/sim';
import { applyTerrain, maps, missions, parseMap, units } from '@lions/data';
import { standMapStructures } from '../map-sim';
import { placeOnScreen } from './alert-place';
import { alertWorldFor } from './alert-world';
import { alertsForTick, initAlertState, type Alert } from './alerts';
import { alertNotice } from './mission-notice';

const S = TICKS_PER_SECOND;

/** A camera parked over the compound centre (24, 23): 40 px a tile into a
 *  1000 x 600 viewport, so the view is 25 x 15 tiles and the raid markers on
 *  the map's rim are all off screen. Screen up is tile -y here. */
const placeOf = (x: number, y: number) => placeOnScreen({ x: (x - 24) * 40 + 500, y: (y - 23) * 40 + 300 }, 1000, 600);

function firstLight() {
  const mission = missions.beit_sahwan_breach as unknown as MissionJson;
  const map = parseMap(maps[mission.map.file as keyof typeof maps]);
  const sim = new Sim({ seed: 424242, width: map.width, height: map.height, capacity: 512 });
  applyTerrain(map, sim);
  standMapStructures(sim, map);
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as never));
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: (u) => typeOf.get(u) as number,
    markers: map.markers,
    zones: map.zones,
    tunnels: [],
    ledger: {},
    unitInfo: () => null,
  });
  rt.start();
  const world = alertWorldFor({
    sim,
    runtime: () => rt,
    mission,
    map,
    units: units as Record<string, { name?: string }>,
    placeOf,
    viewer: 0,
  });
  let state = initAlertState();
  /** Steps until `until` holds or the tick budget runs out; every alert raised
   *  on the way, in order. */
  const run = (ticks: number, until: (a: Alert[]) => boolean = () => false): Alert[] => {
    const out: Alert[] = [];
    for (let i = 0; i < ticks; i++) {
      const simEvents = sim.tick();
      const missionEvents = rt.step(simEvents);
      const r = alertsForTick(state, simEvents, missionEvents, world, sim.tickCount);
      state = r.state;
      out.push(...r.alerts);
      if (until(out)) break;
    }
    return out;
  };
  return { sim, rt, run };
}

describe('alerts fed by First Light\'s own runtime carry who and where', () => {
  it('the first waves say they come from every side, and jump to an entry marker', () => {
    const { run } = firstLight();
    const alerts = run(20 * S, (a) => a.filter((x) => x.kind === 'wave').length >= 2);
    const waves = alerts.filter((a) => a.kind === 'wave');
    expect(waves).toHaveLength(2);
    for (const w of waves) {
      expect(w.tier).toBe('important');
      expect(w.at).not.toBeNull();
      // Five entry markers, then three: more than two bearings each.
      expect(new Set(w.line?.place).size).toBeGreaterThanOrEqual(3);
      const [text] = alertNotice(w.line!);
      expect(text).toMatch(/inbound · from several sides$/);
    }
  });

  it('an under-fire line names the unit and where it is', () => {
    const { run } = firstLight();
    const alerts = run(60 * S, (a) => a.some((x) => x.kind === 'underFire'));
    const hit = alerts.find((a) => a.kind === 'underFire');
    expect(hit, 'nobody of ours was shot at in the first minute').toBeDefined();
    const line = hit!.line!;
    const name = line.params.name as string;
    // A display name out of the unit catalogue, never a type id.
    expect(Object.values(units).map((u) => u.name)).toContain(name);
    expect(line.place?.length).toBeGreaterThan(0);
    const [text] = alertNotice(line);
    expect(text).toContain(name);
    expect(text).toMatch(/ · (in view|north|south|east|west|(north|south)-(east|west))$/);
  });

  it('a lost jeep is a major alert, named, and placed where it fell', () => {
    const { sim, run } = firstLight();
    run(S);
    let jeep = -1;
    for (let i = 0; i < sim.entityCount; i++) {
      if (sim.state.side[i] === 0 && sim.unitTypes[sim.state.typeIdx[i]].id === 'jeep_shoded') jeep = i;
    }
    expect(jeep).toBeGreaterThanOrEqual(0);
    sim.debugKill(jeep);
    const alerts = run(2, (a) => a.some((x) => x.kind === 'unitLost'));
    const loss = alerts.find((a) => a.kind === 'unitLost');
    expect(loss).toMatchObject({ tier: 'major', line: { params: { name: units.jeep_shoded.name }, place: ['here'] } });
    expect(alertNotice(loss!.line!)[0]).toBe(`<b>lost</b> — ${units.jeep_shoded.name} · in view`);
  });
});

// PA-19, through the real adapter: an enemy one of ours kills is a feed line
// named from the unit catalogue; the same enemy killed by nobody is not.
describe('an enemy kill, through First Light\'s own runtime (PA-19)', () => {
  it('a kill by one of ours is a named line; a death with no killer says nothing', () => {
    const { sim } = firstLight();
    sim.tick();
    let ours = -1;
    const enemies: number[] = [];
    for (let i = 0; i < sim.entityCount; i++) {
      if (sim.state.alive[i] !== 1) continue;
      if (sim.state.side[i] === 0 && ours < 0) ours = i;
      if (sim.state.side[i] === 1) enemies.push(i);
    }
    expect(ours).toBeGreaterThanOrEqual(0);
    expect(enemies.length).toBeGreaterThanOrEqual(2);
    const world = alertWorldFor({
      sim,
      runtime: () => null,
      mission: missions.beit_sahwan_breach as unknown as MissionJson,
      map: { zones: {}, markers: {}, width: 32 },
      units: units as Record<string, { name?: string }>,
      placeOf,
      viewer: 0,
    });
    const type = sim.unitTypes[sim.state.typeIdx[enemies[0]]].id;
    const kill = alertsForTick(
      initAlertState(),
      [{ kind: 'destroyed', tick: 1, entity: enemies[0], by: ours }],
      [],
      world,
      1,
    ).alerts;
    expect(kill).toHaveLength(1);
    expect(kill[0].line?.params.name).toBe((units as Record<string, { name?: string }>)[type]?.name);
    expect(alertNotice(kill[0].line!)[0]).toMatch(/^<b>enemy destroyed<\/b> — /);
    const unclaimed = alertsForTick(initAlertState(), [{ kind: 'destroyed', tick: 1, entity: enemies[1], by: -1 }], [], world, 1).alerts;
    expect(unclaimed).toEqual([]);
  });
});

// N1a task 6: the dock's delivery is the newest unit of its type on the
// VIEWER's side, so a seat on side 1 is pointed at its own arrival.
describe('arrivedAt follows the viewer (N1a task 6)', () => {
  it('finds the newest living unit of the type on the viewer\'s side only', () => {
    const sim = new Sim({ seed: 1, width: 32, height: 32, capacity: 16 });
    const jeep = sim.addUnitType(units.jeep_shoded as never);
    sim.spawn(jeep, 0, 3 << 16, 3 << 16);
    sim.spawn(jeep, 1, 20 << 16, 20 << 16);
    sim.spawn(jeep, 0, 5 << 16, 5 << 16);
    const worldFor = (viewer: number) =>
      alertWorldFor({ sim, runtime: () => null, mission: null, map: { zones: {}, markers: {}, width: 32 }, units: {}, placeOf, viewer });
    expect(worldFor(0).arrivedAt('jeep_shoded')).toEqual({ x: 5, y: 5 });
    expect(worldFor(1).arrivedAt('jeep_shoded')).toEqual({ x: 20, y: 20 });
  });
});

// F2 P2-4: the supply half reads the runtime at alert time. A stub runtime
// stands in for the F2 surface (`incomeZones`, `convoyRoute`).
describe('zoneAt, zoneHolder and supplyCutAt (F2)', () => {
  const sim = new Sim({ seed: 1, width: 32, height: 32, capacity: 4 });
  const at = (x: number, y: number) => y * 32 + x;
  const rt = {
    incomeZones: [
      { zone: 'a', holder: 0, route: [at(1, 1), at(2, 1), at(3, 1), at(4, 1)], cutSpan: [2, 3] },
      { zone: 'b', holder: 1, route: [at(5, 5), at(6, 5), at(7, 5)], cutSpan: null },
      { zone: 'c', holder: 0, route: null, cutSpan: null },
    ],
    convoyRoute: { route: [at(9, 9), at(9, 10)], cut: null, cutSpan: null },
  } as unknown as MissionRuntime;
  const world = (runtime: MissionRuntime | null) =>
    alertWorldFor({ sim, runtime: () => runtime, mission: null, map: { zones: { a: [10, 20, 4, 6] }, markers: {}, width: 32 }, units: {}, placeOf, viewer: 0 });

  it('the zone centre, the holder, and -1 for anything unknown', () => {
    const w = world(rt);
    expect(w.zoneAt('a')).toEqual({ x: 12, y: 23 });
    expect(w.zoneAt('nope')).toBeNull();
    expect(w.zoneHolder('a')).toBe(0);
    expect(w.zoneHolder('b')).toBe(1);
    expect(w.zoneHolder('nope')).toBe(-1);
    expect(world(null).zoneHolder('a')).toBe(-1);
  });

  it('the cut tile is route[cutSpan[0]]; with no span, the route midpoint; with no route, null', () => {
    const w = world(rt);
    expect(w.supplyCutAt('a')).toEqual({ x: 3.5, y: 1.5 });
    expect(w.supplyCutAt('b')).toEqual({ x: 6.5, y: 5.5 });
    expect(w.supplyCutAt(null)).toEqual({ x: 9.5, y: 10.5 });
    expect(w.supplyCutAt('c')).toBeNull();
    expect(w.supplyCutAt('nope')).toBeNull();
    expect(world(null).supplyCutAt(null)).toBeNull();
  });

  it('supplyCut is the live line\'s own cause, null while it is open or absent', () => {
    const w = world(rt);
    expect(w.supplyCut('a')).toBeNull();
    expect(w.supplyCut(null)).toBeNull();
    expect(w.supplyCut('nope')).toBeNull();
    expect(world(null).supplyCut(null)).toBeNull();
    const cutRt = { incomeZones: [{ zone: 'a', holder: 0, cut: 'vent', route: [at(1, 1)], cutSpan: [0, 0] }], convoyRoute: { route: [at(9, 9)], cut: 'interdicted', cutSpan: null } } as unknown as MissionRuntime;
    expect(world(cutRt).supplyCut('a')).toBe('vent');
    expect(world(cutRt).supplyCut(null)).toBe('interdicted');
  });

  // Final review, Critical 1: taking a zone whose line is OPEN is gained
  // ground and nothing else -- and a real cut afterwards is still news.
  // Through the REAL adapter, whose `supplyCutAt` answers the route's
  // midpoint for any line with a route, cut or not.
  it('gaining a zone whose line is open raises no cut, and the later real cut is announced', () => {
    const line = { zone: 'a', holder: 0, cut: null as string | null, route: [at(1, 1), at(2, 1), at(3, 1), at(4, 1)], cutSpan: null as [number, number] | null };
    const live = { incomeZones: [line], convoyRoute: null } as unknown as MissionRuntime;
    const w = world(live);
    const keys = (a: readonly Alert[]) => a.map((x) => x.line?.key);
    const gained = alertsForTick(initAlertState(), [], [{ kind: 'zoneHolder', tick: 0, zone: 'a', holder: 0, contested: false }], w, 40);
    expect(keys(gained.alerts)).toEqual(['alert.zone.gained']);
    line.cut = 'interdicted';
    line.cutSpan = [2, 3];
    const cut = alertsForTick(gained.state, [], [{ kind: 'corridor', tick: 0, zone: 'a', cut: 'interdicted' }], w, 400);
    expect(keys(cut.alerts)).toEqual(['alert.supply.cut']);
    expect(cut.alerts[0].at).toEqual({ x: 3.5, y: 1.5 });
  });
});
