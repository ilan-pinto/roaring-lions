// The control plans a swept control can name (`passive-sweep.ts`), re-creatable in a worker process from a string.
// 'none' is the no-orders control every swept control always was. 'medic' (GH-277 Task 15) is the same passive
// player who does ONE thing: at 1 s he orders a medic station on the open pad nearest his units, and then does nothing.
// A mission whose clock is a survive-until must still be LOST by him: a passive plan that wins is a station that
// turned the endure clock into a walkover (spec §9, the endure-clock band).
import type { Plan } from './playtest-run';

export type ControlPlan = 'none' | 'medic';

/** The open 2x2 pad nearest the centroid of side 0's living units, by the sim's own `placementReason`. */
function nearestPad(sim: Parameters<Plan>[0], type: number): [number, number] | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < sim.entityCount; i++) {
    if (sim.state.side[i] !== 0 || sim.state.alive[i] !== 1) continue;
    sx += sim.state.posX[i] / 65536;
    sy += sim.state.posY[i] / 65536;
    n++;
  }
  if (n === 0) return null;
  const cx = sx / n;
  const cy = sy / n;
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let y = 0; y < sim.height; y++) {
    for (let x = 0; x < sim.width; x++) {
      const d = (x + 1 - cx) ** 2 + (y + 1 - cy) ** 2;
      if (d < bestD && sim.placementReason(type, x, y, 0) === null) {
        best = [x, y];
        bestD = d;
      }
    }
  }
  return best;
}

const medicOnly: Plan = (sim, rt, ids, at) => {
  at(1, () => {
    const type = sim.structureTypes.findIndex((t) => t.id === 'kdf_medic_station');
    const pad = type < 0 ? null : nearestPad(sim, type);
    if (pad === null) throw new Error('the medic control found no pad to build on');
    if (!rt.requestConstruct('kdf_medic_station', pad[0], pad[1], ids('demo_squad'))) {
      throw new Error(`the medic control's order at (${pad[0]},${pad[1]}) was refused: it would prove nothing`);
    }
  });
};

export function controlPlan(kind: ControlPlan | undefined): Plan {
  return kind === 'medic' ? medicOnly : () => {};
}
