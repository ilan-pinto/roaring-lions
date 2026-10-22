// Every primary `raze` objective can be met by engineers ordered from the
// player's own start line, through the real `demolish` order, inside the
// objective's own clock -- with the enemy removed, so what is measured is the
// ROUTE and nothing else.
//
// Why it exists (21 Oct, the lead: "Qarn Hadid II cannot be beaten"). The
// revetment there is a 4x1 `concrete` plugging the shoulder's cutting. A
// `demolish` order routed to the first open tile a row-major scan met around
// the centroid -- the NORTH face, reachable only through the notch -- so
// engineers ordered from the south walked the whole map round and the
// five-minute raze could not be made. `pnpm playtest` stayed green because
// its plan MOVES the engineers beside the wall rather than ordering a demolish,
// and the charges set themselves on arrival.
import { describe, expect, it } from 'vitest';
import { fx } from '../../packages/sim/src/fixed';
import { COST_ORTH, FlowField } from '../../packages/sim/src/flowfield';
import { TICKS_PER_SECOND } from '../../packages/sim/src/sim';
import { ROOT, makeWorld, read } from './walk_world';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';

interface Obj { id: string; type: string; target?: string; seconds?: number; primary?: boolean }
interface MissionJson { id: string; map: { file: string; player_start: [number, number] }; objectives: Obj[] }

const CASES: { mission: string; obj: Obj }[] = [];
for (const f of readdirSync(join(ROOT, 'data/missions')).sort()) {
  if (!f.endsWith('.json')) continue;
  const m = read(join(ROOT, 'data/missions', f)) as MissionJson;
  for (const o of m.objectives ?? []) if (o.type === 'raze' && o.primary === true && o.seconds) CASES.push({ mission: m.id, obj: o });
}

describe('a raze primary is reachable by a demolish order from the start line', () => {
  it('finds the cases', () => {
    expect(CASES.map((c) => c.mission)).toContain('qarn_hadid_2_foothold');
  });

  for (const { mission, obj } of CASES) {
    it(`${mission}: ${obj.id} inside ${obj.seconds}s`, () => {
      const m = read(join(ROOT, 'data/missions', `${mission}.json`)) as MissionJson;
      const mapJson = read(join(ROOT, 'data/maps', `${m.map.file}.json`)) as { zones: Record<string, [number, number, number, number]> };
      const zone = mapJson.zones[obj.target ?? ''];
      expect(zone, `zone ${obj.target}`).toBeDefined();
      const [zx, zy, zw, zh] = zone;
      const { sim, runtime, nameOf } = makeWorld(mission);
      const typeOf = new Map([...nameOf].map(([t, id]) => [id, t]));
      runtime.step(sim.tick());
      // The enemy is not the question here: it is removed every tick below.
      const clear = () => {
        for (let i = 0; i < sim.state.alive.length; i++) if (sim.state.alive[i] === 1 && sim.state.side[i] === 1) sim.debugKill(i);
      };
      const [sx, sy] = m.map.player_start;
      const demo = sim.spawn(typeOf.get('demo_squad') ?? -1, 0, fx.from(sx + 0.5), fx.from(sy + 0.5));
      const inZone = (s: number) => {
        const x = fx.toNumber(sim.structures.cx[s]);
        const y = fx.toNumber(sim.structures.cy[s]);
        return x >= zx && x < zx + zw && y >= zy && y < zy + zh;
      };
      // The first leg is also held to the shortest foot route from the start
      // to ground beside the building: on main the Qarn Hadid II engineers
      // still made the clock here (nothing shoots them) but walked the notch.
      const fromStart = new FlowField(sim.width, sim.height);
      fromStart.compute(sim.blocked, sim.elevation, sx, sy);
      const shortestTo = (s: number): number => {
        let best = Infinity;
        for (let y = 0; y < sim.height; y++)
          for (let x = 0; x < sim.width; x++) {
            if (sim.structureAt(x, y) !== s) continue;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= sim.width || ny >= sim.height || sim.blocked[ny * sim.width + nx] !== 0) continue;
                best = Math.min(best, fromStart.costAt(ny * sim.width + nx) / COST_ORTH);
              }
          }
        return best;
      };
      let firstLeg = -1;
      let walked = 0;
      let firstDone = false;
      let doneAt = -1;
      const limit = (obj.seconds ?? 0) * TICKS_PER_SECOND;
      for (let t = 0; t < limit; t++) {
        clear(); // waves too
        if (sim.state.moving[demo] === 0 && sim.state.demoTarget[demo] < 0) {
          // Re-issue toward the nearest standing structure in the zone, as a
          // player re-clicks the next building.
          let best = -1;
          let bestD = Infinity;
          for (let s = 0; s < sim.structures.alive.length; s++) {
            if (sim.structures.alive[s] !== 1 || !inZone(s)) continue;
            const d = (fx.toNumber(sim.structures.cx[s]) - fx.toNumber(sim.state.posX[demo])) ** 2 + (fx.toNumber(sim.structures.cy[s]) - fx.toNumber(sim.state.posY[demo])) ** 2;
            if (d < bestD) {
              bestD = d;
              best = s;
            }
          }
          if (best >= 0) {
            if (firstLeg < 0) firstLeg = shortestTo(best);
            sim.queueCommand({ kind: 'demolish', ids: [demo], structure: best });
          }
        }
        const px = fx.toNumber(sim.state.posX[demo]);
        const py = fx.toNumber(sim.state.posY[demo]);
        runtime.step(sim.tick());
        if (!firstDone) {
          walked += Math.hypot(fx.toNumber(sim.state.posX[demo]) - px, fx.toNumber(sim.state.posY[demo]) - py);
          if (sim.state.demoTarget[demo] >= 0) firstDone = true;
        }
        if (runtime.objectiveStatus(obj.id) === 'complete') {
          doneAt = t / TICKS_PER_SECOND;
          break;
        }
      }
      expect(sim.state.alive[demo], 'the engineers live (nothing shoots them here)').toBe(1);
      expect(doneAt, `${obj.id} complete inside ${obj.seconds}s`).toBeGreaterThanOrEqual(0);
      expect(walked, 'the first leg walks the shortest foot route, give or take three tiles').toBeLessThanOrEqual(firstLeg + 3);
    });
  }
});
