// Tel Marum III (`tel_marum_3_clearance`): the scripted winning plan (GH-382, GH-802).
//
// Lifted out of `playtest.ts` (which runs its whole gate at import and so cannot be imported). No side
// effects here: closures and constants only. `playtest.ts` runs the plan down its ledger chain; the
// tools that used to hold a hand copy of it import this one object (GH-830 found a copy that had
// drifted), and `plans/plans.test.ts` pins that they do.
import { fx } from '@lions/sim';
import type { Plan } from '../playtest-run';

const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });

export const telMarum3Plan: Plan = (sim, _rt, ids, at) => {
  const tanks = ids('mbt_lavi');
  const namer = ids('ifv_namer');
  const armour = ids('apc_eitan');
  const foot = ids('inf_squad');
  const at_ = ids('at_team');
  const mortar = ids('mortar_team');
  // The column stages in the L2 leg, behind the rib: nothing on the plateau sees it (the rock
  // rim blocks every line), and the exit column is the only way up for wheels.
  at(2, () => {
    sim.queueCommand({ kind: 'move', ids: [...tanks, ...namer, ...armour], ...M(28, 19) });
    // the foot go up the defile to `saddle_narrow`, cutting the relay on the way (GH-802)
    sim.queueCommand({ kind: 'attackMove', ids: [...foot, ...at_], ...M(10, 14) });
    sim.queueCommand({ kind: 'move', ids: mortar, ...M(26, 19) });
  });
  // Two Lavis alone go up the column and onto the plateau: they outrange both pockets.
  at(40, () => sim.queueCommand({ kind: 'attackMove', ids: tanks, ...M(33, 16) }));
  at(62, () => sim.queueCommand({ kind: 'move', ids: tanks, ...M(33, 11) }));
  at(80, () => {
    sim.queueCommand({ kind: 'move', ids: armour, ...M(33, 14) });
  });
  at(100, () => {
    // One Eitan to the families, and only one: a civilian boards the first hull in id order
    // with a free seat within four tiles, and a Namer parked in the pass would keep them.
    sim.queueCommand({ kind: 'move', ids: armour, ...M(28, 6) });
  });
  at(115, () => sim.queueCommand({ kind: 'move', ids: armour, ...M(29, 36) }));
};
