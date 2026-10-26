// Tel Marum III (`tel_marum_3_clearance`): the scripted winning plan (GH-382, GH-802).
//
// Lifted out of `playtest.ts` (which runs its whole gate at import and so cannot be imported). No side
// effects here: closures and constants only. `playtest.ts` runs the plan down its ledger chain; the
// tools that used to hold a hand copy of it import this one object (GH-830 found a copy that had
// drifted), and `plans/plans.test.ts` pins that they do.
//
// The plan is built from halves so that `saddle-price.ts`, whose experiment varies only the foot's
// orders, can share the armour and mortar half instead of keeping a copy (GH-830 follow-up):
//
//   telMarum3ArmourPlan = telMarum3ColumnPlan + telMarum3MortarPlan   (what saddle-price composes)
//   telMarum3Plan       = telMarum3ColumnPlan + telMarum3FootPlan + telMarum3MortarPlan
//
// The order matters, and the two compositions differ on purpose. Orders for one tick run in the order
// they were registered, and `pnpm playtest` has always issued tick 2 as column, foot, mortar, while
// `saddle-price.ts` has always issued it as column, mortar, foot. Folding both into one two-part
// split would reorder one consumer's same-tick commands, so the mortar order is its own part and each
// composition keeps the order its numbers were measured with.
import { fx } from '@lions/sim';
import type { Plan } from '../playtest-run';

const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });

/** The column and the Lavis: staging behind the rib, the climb, the families (every armour order). */
export const telMarum3ColumnPlan: Plan = (sim, _rt, ids, at) => {
  const tanks = ids('mbt_lavi');
  const namer = ids('ifv_namer');
  const armour = ids('apc_eitan');
  // The column stages in the L2 leg, behind the rib: nothing on the plateau sees it (the rock
  // rim blocks every line), and the exit column is the only way up for wheels.
  at(2, () => sim.queueCommand({ kind: 'move', ids: [...tanks, ...namer, ...armour], ...M(28, 19) }));
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

/** The mortar team stages with the column. */
export const telMarum3MortarPlan: Plan = (sim, _rt, ids, at) => {
  const mortar = ids('mortar_team');
  at(2, () => sim.queueCommand({ kind: 'move', ids: mortar, ...M(26, 19) }));
};

/** The armour and mortar half, column first: the order `saddle-price.ts` has always issued tick 2 in. */
export const telMarum3ArmourPlan: Plan = (sim, rt, ids, at) => {
  telMarum3ColumnPlan(sim, rt, ids, at);
  telMarum3MortarPlan(sim, rt, ids, at);
};

/** The foot go up the defile to `saddle_narrow`, cutting the relay on the way (GH-802). */
export const telMarum3FootPlan: Plan = (sim, _rt, ids, at) => {
  const foot = ids('inf_squad');
  const at_ = ids('at_team');
  at(2, () => sim.queueCommand({ kind: 'attackMove', ids: [...foot, ...at_], ...M(10, 14) }));
};

/** The whole plan. Tick 2 is the column, then the foot, then the mortar, as it was before the split. */
export const telMarum3Plan: Plan = (sim, rt, ids, at) => {
  telMarum3ColumnPlan(sim, rt, ids, at);
  telMarum3FootPlan(sim, rt, ids, at);
  telMarum3MortarPlan(sim, rt, ids, at);
};
