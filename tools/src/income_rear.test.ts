// F2 Task 11 (Task 7 finding 1): a supply convoy drives to its side's rear, so the rear must be
// open on the VEHICLE mask. C-R17 reads it as the exit tile of side 0's production anchor
// (`Sim.structureExit`, which reads the FOOT mask) or, with no camp, `map.player_start`, which is
// authored for boots. The runtime now moves a vehicle-blocked rear to the nearest vehicle-open
// tile (`MissionRuntime.openRear`); this pins that no shipped mission needs it today, so that
// change moved no shipped answer, and a map edit that drops a boulder on a rear is named here.
//
// The oracle restates C-R17 from the sim's own structure table, never the runtime's private
// lookup: the first living structure that produces for side 0, else player_start.
import { describe, expect, it } from 'vitest';
import { missions } from '@lions/data';
import type { MissionJson } from '@lions/sim';
import { missionWorld } from './mission-harness';

const withResources = Object.values(missions as Record<string, MissionJson>)
  .filter((m) => m.resources !== undefined)
  .map((m) => m.id)
  .sort();

describe("side 0's rear is vehicle-open on every shipped mission with a resources block", () => {
  // 18 on 15 Oct 2026. Every test below builds what it needs itself, so `-t <id>` runs alone.
  /** Side 0's rear on one mission: which rule found it, and the tile. */
  function rearOf(id: string): { rule: 'camp' | 'start'; x: number; y: number; open: number; onMap: boolean } {
    const { sim, mission } = missionWorld(id, {});
    let anchor = -1;
    for (let s = 0; s < sim.structureCount && anchor < 0; s++) {
      if (sim.structures.alive[s] === 0) continue;
      if (sim.structureTypes[sim.structures.typeIdx[s]].producesFor === 0) anchor = s;
    }
    let x: number;
    let y: number;
    let rule: 'camp' | 'start';
    if (anchor >= 0) {
      rule = 'camp';
      const e = sim.structureExit(anchor);
      x = e[0] >> 16;
      y = e[1] >> 16;
    } else {
      rule = 'start';
      const ps = mission.map.player_start;
      expect(ps, `${id} has neither a camp nor a player_start`).toBeDefined();
      x = ps?.[0] ?? -1;
      y = ps?.[1] ?? -1;
    }
    const onMap = x >= 0 && y >= 0 && x < sim.width && y < sim.height;
    return { rule, x, y, onMap, open: onMap ? sim.blockedVehicle[y * sim.width + x] : 1 };
  }

  it('finds the missions (the loop below is not vacuous)', () => {
    expect(withResources.length).toBeGreaterThanOrEqual(18);
  });

  for (const id of withResources) {
    it(id, () => {
      const r = rearOf(id);
      expect(r.onMap, `${id} rear (${r.x}, ${r.y}) is on the map`).toBe(true);
      expect(r.open, `${id} rear (${r.x}, ${r.y}) is vehicle-blocked`).toBe(0);
    });
  }

  it('walked both rear rules: a camp exit and a player_start', () => {
    const rules = new Set(withResources.map((id) => rearOf(id).rule));
    expect(rules.has('camp')).toBe(true);
    expect(rules.has('start')).toBe(true);
  });
});
