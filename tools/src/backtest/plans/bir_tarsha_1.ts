import type { Plan } from '../playtest-run';
import { M } from './bir_tarsha_util';

/** I: the squads and the medic shepherd the west quarter's residents to the refuge, the recon group names the gate from the road without entering `gate_approach`. */
export const bt1Plan: Plan = (sim, _rt, ids, at) => {
  const squads = ids('inf_squad');
  const feet = [...squads, ...ids('inf_medic_squad')];
  const recon = [...ids('recon_zikit'), ...ids('ugv_recon_dog'), ...ids('sniper_team')];
  at(0, () => {
    sim.queueCommand({ kind: 'move', ids: feet, ...M(9.5, 25.5) });
    sim.queueCommand({ kind: 'move', ids: recon, ...M(24.5, 24.5) });
  });
  // The three groups stand 6 to 12 tiles apart: once the first walk, the shepherds step south so the rest are inside four tiles too.
  at(40, () => sim.queueCommand({ kind: 'move', ids: feet.filter((i) => sim.state.alive[i] === 1), ...M(12.5, 28.5) }));
  // Once the gate is named the recon group swings east, out of `gate_approach`, to read the crew on the works (the carrying secondary).
  at(35, () => sim.queueCommand({ kind: 'move', ids: recon.filter((i) => sim.state.alive[i] === 1), ...M(38.5, 26.5) }));
  if (process.env.BT_DBG)
    for (const t of [20, 40, 60, 90, 120, 200]) at(t, () => {
      const rows: string[] = [];
      for (let i = 0; i < sim.entityCount; i++) if (sim.state.alive[i] === 1 && (sim.state.side[i] === 2 || feet.includes(i))) rows.push(`${sim.state.side[i]}:${sim.unitTypes[sim.state.typeIdx[i]].id}@${(Number(sim.state.posX[i]) / 65536).toFixed(1)},${(Number(sim.state.posY[i]) / 65536).toFixed(1)}`);
      console.log(`DBG t=${t} ${rows.join(' ')}`);
    });
};
