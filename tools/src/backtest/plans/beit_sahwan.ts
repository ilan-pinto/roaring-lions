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

// Beit Sahwan I's challenge, Whole Picture (GH-1395 slice 2, C6/C7): no drone (`recon_no_drone`), and the ATGM pair
// (`hvt_seen`, the two `bs_hvt_atgm` cells at (38.5, 20.5) and (39.5, 20.5)) identified before the picture closes.
// `picture` counts identified ENEMIES, not tags, and ends the mission at the sixth, whoever they are; the pair is two of
// the six, so the plan may identify four others first and no more. The plain plan with the drone taken away advances its screen
// into the town, identifies the west alley, the hunters, the market lane, the centre and the track, and closes the picture with the pair
// unseen (0 of 30 seeds).
//
// So the Lavi goes alone, the long way round: south off the assembly area to the empty bottom of the map, east along
// y 46 under every garrison, then north to (37, 29), the open ground south of the clinic block, which looks up the east
// road at the pair. What it sees on the way, measured on 424242 (seed 7 read the same order, to the second):
// three enemies on the move east of the town (the two hunters, which first contact sends west across its path, and the
// paramotor), then the pair at 93 s and 94 s, then the mortar crew as the sixth at 95 s. One spare identification; the rest of the force holds the start line. Five route
// variants probed on 18 Nov (stops at (38, 27), (38, 28), (40, 28) and (38, 29); legs at y 44, 45 and 46; turns 5 to 10 s
// apart) also beat it on 30 of 30 seeds.
export const wholePicturePlan: Plan = (sim, _rt, ids, at) => {
  const lavi = ids('mbt_lavi');
  at(0, () => sim.queueCommand({ kind: 'move', ids: lavi, ...M(10, 46) }));
  at(20, () => sim.queueCommand({ kind: 'move', ids: lavi, ...M(38, 46) }));
  at(70, () => sim.queueCommand({ kind: 'move', ids: lavi, ...M(37, 29) }));
};
