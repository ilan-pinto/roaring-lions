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
