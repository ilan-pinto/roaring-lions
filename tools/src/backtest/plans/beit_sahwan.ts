// First Light (`beit_sahwan_breach`): the scripted winning plan.
//
// Lifted out of `playtest.ts` (which runs its whole gate at import and so cannot be imported). No side
// effects here: closures and constants only. `playtest.ts` runs the plan down its ledger chain; the
// tools that used to hold a hand copy of it import this one object (GH-830 found a copy that had
// drifted), and `plans/plans.test.ts` pins that they do.
import { fx } from '@lions/sim';
import type { Plan } from '../playtest-run';

const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });

export const firstLightPlan: Plan = (sim, _rt, ids, at) => {
  const shepherds = ids('jeep_shoded');
  // Both western villages, out and back through the west gate, before the
  // south-west and west spawns build up. Two families is the objective and the
  // two western groups are six between them, so there is no reason to cross the
  // map for the eastern ones and every reason not to.
  const armour = ids('apc_eitan');
  at(5, () => {
    sim.queueCommand({ kind: 'move', ids: shepherds, ...M(13, 19) });
    sim.queueCommand({ kind: 'move', ids: armour, ...M(13, 28) });
  });
  at(45, () => {
    sim.queueCommand({ kind: 'move', ids: shepherds, ...M(20, 21) });
    sim.queueCommand({ kind: 'move', ids: armour, ...M(20, 26) });
  });
};
