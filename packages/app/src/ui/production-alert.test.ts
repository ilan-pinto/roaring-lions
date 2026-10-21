// F4: the paused alert, fed by a REAL `MissionRuntime` through the adapter
// `main.ts` uses (`alertWorldFor`) -- the runtime reports a pause as a FIELD
// (`productionLines(side)[i].contested`), never as an event, so the alert is
// `alertsForTick`'s edge of it, and only a real runtime can say when that
// field flips. Literal unit and mission JSON, as the sim's own production
// tests build theirs; nothing shipped is read.
import { describe, expect, it } from 'vitest';
import { MissionRuntime, Sim, fx, type MissionJson, type UnitTypeJson } from '@lions/sim';
import { alertWorldFor } from './alert-world';
import { PRODUCTION_PAUSED_COOLDOWN_TICKS, alertsForTick, initAlertState, type Alert, type AlertState } from './alerts';
import { alertNotice } from './mission-notice';

const SQUAD: UnitTypeJson = {
  id: 'f4_squad', role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1 }, sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};
const CAMP = { id: 'camp', name: 'Field Camp', hp_per_tile: 300, garrison_slots: 3, rubble_cover: 2, produces_for: 0 };

/** Two camps on a 40 x 14 map; `f4_squad` costs 100 and builds in 10 s. */
function world() {
  const sim = new Sim({ seed: 7, width: 40, height: 14, capacity: 64 });
  const t = sim.addUnitType(SQUAD);
  sim.addStructureType(CAMP);
  const mission: MissionJson = {
    id: 'f4_alert', map: { file: 'none', player_start: [3, 5] },
    ledger: { requires: [], produces: [] },
    objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
    starting_force: [{ unit: 'f4_squad', count: 1, at: [2, 12] }],
    structures: [
      { type: 'camp', at: [10, 2], size: [2, 2] },
      { type: 'camp', at: [28, 9], size: [2, 2] },
    ],
  };
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: () => t, markers: {}, zones: {},
    economy: { logisticsStart: [2000, 2000], logisticsRatePerMin: [0, 0] },
    unitInfo: (u) => (u === 'f4_squad' ? { logistics: 100, buildTimeS: 10, population: 1 } : null),
  });
  rt.start();
  const aw = alertWorldFor({
    sim,
    runtime: () => rt,
    mission,
    map: { zones: {}, markers: {}, width: 40 },
    units: { f4_squad: { name: 'Squad' } },
    placeOf: () => 'here',
    viewer: 0,
  });
  let state: AlertState = initAlertState();
  const paused: Alert[] = [];
  const step = (n: number): void => {
    for (let i = 0; i < n; i++) {
      const missionEvents = rt.step(sim.tick());
      const r = alertsForTick(state, [], missionEvents, aw, sim.tickCount);
      state = r.state;
      paused.push(...r.alerts.filter((a) => a.kind === 'production'));
    }
  };
  /** An enemy squad `d` tiles east of line `k`'s exit. */
  const foeAt = (k: number, d: number): number => {
    const e = rt.productionLines(0)[k].exit;
    return sim.spawn(t, 1, e[0] + fx.from(d), e[1]);
  };
  return { sim, rt, step, paused, foeAt };
}

describe('the production-paused alert (F4)', () => {
  it('a building camp an enemy walks up to raises one important/warn line, at its exit, naming the camp', () => {
    const w = world();
    w.step(5);
    expect(w.rt.requestBuild('f4_squad', 1)).toBe(true);
    w.step(5);
    expect(w.paused).toEqual([]);
    w.foeAt(1, 4);
    w.step(3);
    expect(w.paused).toHaveLength(1);
    const a = w.paused[0];
    const exit = w.rt.productionLines(0)[1].exit;
    expect(a).toMatchObject({ tier: 'important', tone: 'warn', at: { x: fx.toNumber(exit[0]), y: fx.toNumber(exit[1]) }, cue: 'alert.important' });
    expect(a.marks).toEqual([a.at]);
    // Camp 2 by line index (the lead's ruling), worded through the feed's own path.
    const [html, tone] = alertNotice(a.line ?? { key: '', params: {}, tone: 'mute' });
    expect(html).toContain('production paused');
    expect(html).toContain('Camp 2');
    expect(tone).toBe('warn');
    // Still paused: no second line while it stays so.
    w.step(40);
    expect(w.paused).toHaveLength(1);
  });

  it('says nothing for an idle camp under the same enemy -- nothing is paused', () => {
    const w = world();
    w.foeAt(0, 3);
    w.step(20);
    expect(w.paused).toEqual([]);
  });

  it('says nothing on resume, and a re-pause inside the cooldown is silent; after it, it speaks again', () => {
    const w = world();
    w.step(2);
    w.rt.requestBuild('f4_squad', 0);
    w.rt.requestBuild('f4_squad', 0);
    w.rt.requestBuild('f4_squad', 0);
    w.rt.requestBuild('f4_squad', 0);
    const foe = w.foeAt(0, 3);
    w.step(2);
    expect(w.paused).toHaveLength(1);
    const first = w.sim.tickCount;
    // Resume: the enemy leaves. No line.
    w.sim.debugKill(foe);
    w.step(5);
    expect(w.paused).toHaveLength(1);
    // A fresh pause well inside the cooldown: silent.
    w.foeAt(0, 3);
    w.step(5);
    expect(w.paused).toHaveLength(1);
    expect(w.sim.tickCount - first).toBeLessThan(PRODUCTION_PAUSED_COOLDOWN_TICKS);
  });

  it('a re-pause after the cooldown speaks again', () => {
    const w = world();
    w.step(2);
    for (let i = 0; i < 6; i++) w.rt.requestBuild('f4_squad', 0);
    const foe = w.foeAt(0, 3);
    w.step(2);
    expect(w.paused).toHaveLength(1);
    w.sim.debugKill(foe);
    w.step(PRODUCTION_PAUSED_COOLDOWN_TICKS);
    w.foeAt(0, 3);
    w.step(3);
    expect(w.paused).toHaveLength(2);
  });

  it('a camp that stays paused past the cooldown is not re-announced when another camp changes', () => {
    const w = world();
    w.step(2);
    for (let i = 0; i < 6; i++) w.rt.requestBuild('f4_squad', 0);
    w.foeAt(0, 3);
    w.step(PRODUCTION_PAUSED_COOLDOWN_TICKS + 20);
    expect(w.paused).toHaveLength(1);
    // Camp 2 pauses too (the flags move, Camp 1's own does not): one new line, Camp 2's.
    w.rt.requestBuild('f4_squad', 1);
    w.foeAt(1, 3);
    w.step(3);
    expect(w.rt.productionLines(0)[0].contested).toBe(true);
    expect(w.paused).toHaveLength(2);
    expect(w.paused[1].line?.params).toEqual({ n: 2 });
  });
});
