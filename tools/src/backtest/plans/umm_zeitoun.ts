// The scripted winning plan for Umm Zeitoun II (Build-up), lifted verbatim out of `playtest.ts` so the forward-camp probe
// (`forward-camp-probe.ts`, GH-277) and its build variant run the very same closure. Side-effect free: it exports closures
// and runs nothing. Nothing here may be copied elsewhere.
import { fx } from '@lions/sim';
import type { Plan } from '../playtest-run';
import { e6Remetz, isRemetz } from './e6-remetz';

const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });

// The whole force clears the knoll TOGETHER before anything splits off to
// hold. A first version sent the demo squad in with only two rifle squads as
// escort while the rest dug in on the crest line immediately -- it survived,
// but the two escorting `inf_squad` did not, and UZ III's own `from_ledger`
// draw for `inf_squad` (a fresh mission's own precondition per the design
// draft) came up empty against that roster, spawning one fresh body where
// three were expected. `hold_for` has no deadline of its own and does not
// reset on a contest (only pauses), so nothing is lost by holding off the
// crest line until the ground that can see it is cleared first -- only the
// 300s `raze` deadline is a hard clock, and it is reached with room to
// spare either way.
export const uz2Plan: Plan = (sim, _rt, ids, at) => {
  e6Remetz(sim, _rt, ids, at, 'umm_zeitoun_2_buildup', [24, 31]);
  const demo = ids('demo_squad');
  const strike = [...ids('apc_eitan'), ...ids('mbt_lavi'), ...ids('mortar_team'), ...ids('at_team'), ...ids('inf_squad')];
  at(1, () => {
    // Everyone but the demo squad clears the ground around the shed first.
    sim.queueCommand({ kind: 'attackMove', ids: strike, ...M(24, 24) });
    // GH-382: the knoll is 22 tiles up the slope now, and a demo squad that walks it unescorted
    // arrives under the picket's rifle ahead of everyone (three seeds of twelve lost the post
    // that way). It waits on the crest line and is sent when the ground is being cleared.
    sim.queueCommand({ kind: 'move', ids: demo, ...M(24, 33) });
  });
  // Starts charges the moment it is within 2 tiles and the ground around it is unshaken; re-sent
  // every 25 s until the shed is down, because a squad that halts to fight drops the order.
  for (let when = 30; when <= 290; when += 25)
    at(when, () => {
      const shed = sim.structureAt(22, 23);
      if (shed >= 0) sim.queueCommand({ kind: 'demolish', ids: demo, structure: shed });
    });
  // Once the knoll is down, the whole strike force pulls back onto the
  // crest line and digs in for the hold. Re-anchored periodically after
  // that: attackMove does not mean "stand here", and the 180s/300s waves
  // both march straight into the zone (`rim_crest` sits inside
  // `crest_line`).
  at(100, () => sim.queueCommand({ kind: 'attackMove', ids: strike, ...M(24, 31) }));
  for (let when = 140; when <= 420; when += 40) {
    at(when, () => {
      const cur: number[] = [];
      for (let i = 0; i < sim.entityCount; i++) {
        if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && !demo.includes(i) && !isRemetz(sim, i)) cur.push(i);
      }
      sim.queueCommand({ kind: 'attackMove', ids: cur, ...M(24, 31) });
    });
  }
};
