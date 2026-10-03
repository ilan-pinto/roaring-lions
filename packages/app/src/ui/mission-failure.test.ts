// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MissionRuntime, Sim, TICKS_PER_SECOND, type MissionJson } from '@lions/sim';
import { applyTerrain, maps, missions, parseMap, units } from '@lions/data';
import { standMapStructures } from '../map-sim';
import { DEADLINE_WARN_TICKS, deadlineWarningLine, deadlineWarnings, failureReason } from './mission-failure';
import { holdClock, stripObjectives, type MissionView, type ObjectiveView } from './hud-model';
import { outcomeMoment, outcomeMomentOptions } from './outcome-moment';

const S = TICKS_PER_SECOND;
const obj = (over: Partial<ObjectiveView>): ObjectiveView => ({
  id: 'o',
  text: 'Hold the crest line for four minutes',
  primary: true,
  status: 'active',
  ...over,
});
const view = (objectives: ObjectiveView[], result: MissionView['result'] = 'ongoing'): MissionView => ({
  name: 'UZ II',
  objectives,
  result,
});

describe('1. failureReason: a lost mission names the primary that lost it, and when', () => {
  const objs = [
    { id: 'hold_the_crest_line', text: 'Hold the crest line for four minutes' },
    { id: 'level_the_stone_post', text: 'Level the post above the stone knoll inside five minutes' },
  ];
  it('a failed objective', () => {
    expect(failureReason({ objective: 'level_the_stone_post' }, objs, 300 * S)).toBe(
      'FAILED — Level the post above the stone knoll inside five minutes · 5:00'
    );
  });
  it('a wiped force and a Conduct collapse', () => {
    expect(failureReason('force_destroyed', objs, 61 * S)).toBe('FAILED — every unit lost · 1:01');
    expect(failureReason('roe_collapse', objs, 61 * S)).toBe('FAILED — Conduct fell below the floor · 1:01');
  });
  it('nothing when the mission is not lost', () => {
    expect(failureReason(undefined, objs, 300 * S)).toBeNull();
  });

  describe('on the outcome card', () => {
    afterEach(() => {
      document.body.innerHTML = '';
      vi.useRealTimers();
    });
    it('draws the reason under the verdict on a defeat, never on a victory', () => {
      vi.useFakeTimers();
      const m = missions.umm_zeitoun_2_buildup as unknown as MissionJson;
      const d = outcomeMoment(document.body, outcomeMomentOptions('defeat', m, undefined, 'FAILED — x · 5:00'));
      expect(d.el.querySelector('.rl-outcome__reason')?.textContent).toBe('FAILED — x · 5:00');
      d.dismiss();
      const v = outcomeMoment(document.body, outcomeMomentOptions('victory', m, undefined, 'FAILED — x · 5:00'));
      expect(v.el.querySelector('.rl-outcome__reason')).toBeNull();
      v.dismiss();
    });
  });

  it("Umm Zeitoun II passive: the runtime's own cause words the 300 s raze", () => {
    const mission = missions.umm_zeitoun_2_buildup as unknown as MissionJson;
    const map = parseMap(maps[mission.map.file as keyof typeof maps]);
    const sim = new Sim({ seed: 424242, width: map.width, height: map.height, capacity: 256 });
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
    let end = -1;
    for (let t = 0; t < 400 * S && end < 0; t++) {
      for (const e of rt.step(sim.tick())) if (e.kind === 'missionEnd') end = e.tick;
    }
    expect(rt.result).toBe('defeat');
    expect(failureReason(rt.defeatCause, rt.objectiveList, end)).toBe(
      'FAILED — Level the post above the stone knoll inside five minutes · 5:00'
    );
  });
});

describe('2. a lost mission stops every clock with MISSION FAILED, never a frozen count', () => {
  it('the big clock', () => {
    const lost = view([obj({ ticksLeft: 52 * S, paused: 'unheld' })], 'defeat');
    expect(holdClock(lost)).toEqual({ id: 'o', text: 'MISSION FAILED', tone: 'bad', contested: false });
    // Still counting while the mission runs.
    expect(holdClock(view([obj({ ticksLeft: 52 * S })]))?.text).toBe('0:52');
  });
  it("the strip's deadline line", () => {
    const rows = [obj({ id: 'hold', ticksLeft: 52 * S }), obj({ id: 'evac', type: 'evacuate_before', text: 'Get them out', ticksLeft: 40 * S })];
    expect(stripObjectives(view(rows)).deadline?.text).toBe('0:40');
    const lost = stripObjectives(view(rows, 'defeat')).deadline;
    expect(lost?.text).toBe('MISSION FAILED');
    expect(lost?.tone).toBe('bad');
  });
});

describe('3. a deadline that loses the mission warns once, a minute out', () => {
  const raze = (ticksLeft: number, over: Partial<ObjectiveView> = {}) =>
    obj({ id: 'raze', type: 'raze', text: 'Level the post', ticksLeft, ...over });

  it('fires at 1:00 and not at 1:01', () => {
    expect(deadlineWarnings([raze(DEADLINE_WARN_TICKS + 1)], new Set()).warn).toEqual([]);
    expect(deadlineWarnings([raze(DEADLINE_WARN_TICKS)], new Set()).warn.map((o) => o.id)).toEqual(['raze']);
  });
  it('once per deadline', () => {
    const first = deadlineWarnings([raze(DEADLINE_WARN_TICKS)], new Set());
    expect(deadlineWarnings([raze(DEADLINE_WARN_TICKS - 5)], first.warned).warn).toEqual([]);
  });
  it('only for the failable three, only while active and unexpired', () => {
    for (const type of ['raze', 'collapse', 'evacuate_before']) {
      expect(deadlineWarnings([raze(30 * S, { type })], new Set()).warn).toHaveLength(1);
    }
    expect(deadlineWarnings([raze(30 * S, { type: 'hold_for' })], new Set()).warn).toEqual([]);
    expect(deadlineWarnings([raze(30 * S, { type: 'survive_until' })], new Set()).warn).toEqual([]);
    expect(deadlineWarnings([raze(30 * S, { status: 'complete' })], new Set()).warn).toEqual([]);
    expect(deadlineWarnings([raze(0)], new Set()).warn).toEqual([]);
    expect(deadlineWarnings([raze(30 * S, { ticksLeft: undefined })], new Set()).warn).toEqual([]);
  });
  it('words the line through the catalogue', () => {
    expect(deadlineWarningLine({ text: 'Level the post', ticksLeft: DEADLINE_WARN_TICKS })).toBe('1:00 left — Level the post');
  });
});
