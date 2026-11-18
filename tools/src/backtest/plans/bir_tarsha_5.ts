import type { Plan } from '../playtest-run';
import { M, foesIn } from './bir_tarsha_util';

/**
 * V: the squads and the Lavi sweep east along the Fence Road ahead of the engineers (the two charge squads walk into them at the corral, the buried cells
 * and the digger crew fall on the way). The Yahalom teams take the routes west to east, each only once nothing hostile stands within 12 tiles of its mouth.
 * The Hummer and the medic fetch the person from the chamber and walk them to the refuge; the wide route is held back until the person is out
 * (or 300 s), because the mission ends the moment the last charge goes.
 */
export const bt5Plan: Plan = (sim, rt, ids, at) => {
  const yah = ids('yahalom_squad');
  const front = [...ids('inf_squad'), ...ids('mbt_lavi')];
  const shep = [...ids('recon_zikit'), ...ids('inf_medic_squad')];
  const live = (a: number[]) => a.filter((i) => sim.state.alive[i] === 1);
  const mouth: [number, number][] = [[8, 27], [19, 25], [29, 27], [34, 24], [40, 26]];
  const civ = () => { for (let i = 0; i < sim.entityCount; i++) if (sim.state.alive[i] === 1 && sim.state.side[i] === 2) return i; return -1; };
  at(0, () => {
    sim.queueCommand({ kind: 'attackMove', ids: front, ...M(28.5, 23.5) });
    sim.queueCommand({ kind: 'move', ids: yah, ...M(10.5, 22.5) });
    sim.queueCommand({ kind: 'move', ids: shep, ...M(43.5, 24.5) });
  });
  // The engineers: the next standing route, ordered once (a re-order restarts the charge clock).
  let k = -1;
  for (let s = 10; s < 600; s += 2) at(s, () => {
    let n = 0;
    while (n < 5 && sim.tnAlive[n] === 0) n++;
    if (n >= 5 || n === k) return;
    const [mx, my] = mouth[n];
    if (n === 4 && rt.objectiveStatus('walk_the_person_out') === 'active' && s < 300) return;
    if (n >= 2 && foesIn(sim, [mx - 12, my - 12, 24, 24]).length > 0) return;
    k = n;
    sim.queueCommand({ kind: 'chargeTunnel', ids: live(yah), tunnel: n });
  });
  // The squads press on to the east end once the third route is down.
  let east = false;
  for (let s = 10; s < 600; s += 5) at(s, () => {
    if (east || sim.tnAlive[2] === 1) return;
    east = true;
    sim.queueCommand({ kind: 'attackMove', ids: live(front), ...M(38.5, 23.5) });
  });
  // The shepherds: once beside the person (inside four tiles) they walk home to the refuge and the person follows.
  let home = false;
  for (let s = 2; s < 600; s += 2) at(s, () => {
    if (home) return;
    const c = civ();
    if (c < 0) return;
    const cx = Number(sim.state.posX[c]) / 65536;
    const cy = Number(sim.state.posY[c]) / 65536;
    const d = live(shep).map((i) => Math.hypot(Number(sim.state.posX[i]) / 65536 - cx, Number(sim.state.posY[i]) / 65536 - cy));
    if (d.length > 0 && Math.min(...d) < 3.5) {
      home = true;
      sim.queueCommand({ kind: 'move', ids: live(shep), ...M(7.5, 17.5) });
    }
  });
};
