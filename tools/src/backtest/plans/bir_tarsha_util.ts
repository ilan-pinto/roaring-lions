// Shared helpers for the Bir Tarsha plans.
import { fx } from '@lions/sim';
import type { Plan } from '../playtest-run';

export const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });

/** Enemy ids alive on side 1 (wounded fighters excluded) whose centre lies in the rectangle [x, y, w, h], missile teams and the mortar first. */
export const foesIn = (sim: Parameters<Plan>[0], z: readonly number[], order: readonly string[] = []): number[] => {
  const out: number[] = [];
  for (let i = 0; i < sim.entityCount; i++) {
    if (sim.state.side[i] !== 1 || sim.state.alive[i] !== 1) continue;
    const t = sim.unitTypes[sim.state.typeIdx[i]].id;
    if (t.startsWith('wounded')) continue;
    const x = Number(sim.state.posX[i]) / 65536;
    const y = Number(sim.state.posY[i]) / 65536;
    if (x >= z[0] && x < z[0] + z[2] && y >= z[1] && y < z[1] + z[3]) out.push(i);
  }
  const rank = (i: number): number => {
    const k = order.indexOf(sim.unitTypes[sim.state.typeIdx[i]].id);
    return k < 0 ? order.length : k;
  };
  return out.sort((a, b) => rank(a) - rank(b));
};
