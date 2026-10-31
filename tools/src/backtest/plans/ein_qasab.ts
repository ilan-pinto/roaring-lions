// The scripted winning plans for the Ein Qasab arc (GH-912): the flood week, three missions on two causeways.
//
// Side-effect free, like `wadi_halam.ts`: this module exports closures and constants and runs nothing.
// `playtest.ts` runs `EIN_QASAB_PLANS` down the ledger chain and holds the pins; `eq_ladder.ts` runs the very
// same objects for its `optimal` rung and writes the naive / sensible / foot / crest rungs beside them.
// Nothing here may be copied elsewhere.
import { fx } from '@lions/sim';
import { maps, missions } from '@lions/data';
import type { Plan } from '../playtest-run';

const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });

/** The arc's missions in play order: each is played on the ledger the one before it produced. */
export const EIN_QASAB_CHAIN = ['ein_qasab_1_recon', 'ein_qasab_2_foothold', 'ein_qasab_3_buildup'] as const;

// I — The Causeways. Everything the briefing says is true: "The Eitan reaches them fastest and drives past whatever
// is lying in the reeds to do it." The Eitan is sent to the hamlet at t=0. It drives the south causeway, and the two
// carriers standing in its road are within the shepherd radius (4 tiles) of a hull with seats, so they flee, board
// (the Eitan seats two) and ride to the hamlet with it, which is not the plan but costs nothing: the Eitan turns
// for the refuge at 40 s with them aboard, and the hamlet pair, shepherded by the hull as it comes up, walk home on
// their own. Three are in by about 80 s, before the first wave (100 s) leaves the map edge. Measured: the plan has no
// variance, 79 s on every seed. That is a finding about the mission, reported by the ladder, not a feature of the plan.
//
// The sniper goes to (10,41) on the west bank: from there its amr reaches the reed cell, and in the plan's first form
// (Eitan sent at 60 s) the cell was dead by 65 s with both carriers untouched. The drone goes to (20,18), where it
// identifies the causeway RPG team (`eq_causeway_rpg`), so the tag reaches `intel.marked_positions` by the ordinary
// end-of-mission write; from (15,21) it did not (measured). `find_the_reed_cell`, the carrying secondary and the
// third star, is completed by the Eitan's own pass at about 10 s.
export const eq1Plan: Plan = (sim, _rt, ids, at) => {
  const apc = ids('apc_eitan');
  at(0, () => {
    sim.queueCommand({ kind: 'move', ids: ids('sniper_team'), ...M(10, 41) });
    sim.queueCommand({ kind: 'move', ids: ids('recon_drone'), ...M(20, 18) });
    sim.queueCommand({ kind: 'move', ids: apc, ...M(43, 24) });
  });
  at(40, () => sim.queueCommand({ kind: 'move', ids: apc, ...M(5, 46) }));
};

// II — Dead Ground. The whole force goes to the middle of the hollow at t=1 and the engineers raise the outpost
// first: `rt.requestConstruct('kdf_outpost', 18, 24)`, the first call to it by any plan. Measured on 30 seeds:
// accepted at 1 s, staked at 24 s, complete at 55 s. Then they burn the barn (`demolish` the warehouse in
// `barn_yard`) as soon as the outpost is up and charges are all they have to do.
//
// Heavy ordnance (collateral >= 0.3: the Namer's cannon, the AT team's Spike, the mortar) is billed where a round
// LANDS, and the farmhouse zone [20,20,5,4] is two tiles from the barn cell. Measured over 30 seeds, Conduct (min):
//   whole force at the hollow centre (24.5,23), mortar left at the start line   87 (85), lost 0.0, 30/30
//   the same with the mortar too                                                 89 (82), lost 0.9, 30/30
//   Namer on the east flank (29,30), the rest at (22,27), mortar left            73 (65), 30/30
//   the Namer at the start line instead                                          99 (95) but the barn stands: 9/30
// The Namer is what kills the barn cell, and it is the only thing in the force that does; standing it off to spare the
// farmhouse costs the barn. Close and quick is cheaper than far and slow.
export const eq2Plan: Plan = (sim, rt, ids, at) => {
  const demo = ids('demo_squad');
  const rest = [...ids('apc_eitan'), ...ids('ifv_namer'), ...ids('inf_squad'), ...ids('at_team')];
  at(1, () => {
    rt.requestConstruct('kdf_outpost', 18, 24, demo);
    sim.queueCommand({ kind: 'attackMove', ids: rest, ...M(24.5, 23) });
  });
  for (let s = 60; s < 800; s += 15)
    at(s, () => {
      for (let ty = 21; ty <= 22; ty++) {
        const st = sim.structureAt(26, ty);
        if (st >= 0) return void sim.queueCommand({ kind: 'demolish', ids: demo, structure: st });
      }
    });
};

/** II, report only: the same plan with the outpost on the crest, (28,9), the engineers escorted to (28,12). */
export const eq2CrestPlan: Plan = (sim, rt, ids, at) => {
  const demo = ids('demo_squad');
  const rest = [...ids('apc_eitan'), ...ids('ifv_namer'), ...ids('inf_squad'), ...ids('at_team')];
  at(1, () => {
    rt.requestConstruct('kdf_outpost', 28, 9, demo);
    sim.queueCommand({ kind: 'attackMove', ids: ids('inf_squad'), ...M(28, 12) });
    sim.queueCommand({ kind: 'attackMove', ids: rest.filter((i) => !ids('inf_squad').includes(i)), ...M(24.5, 23) });
  });
  for (let s = 90; s < 800; s += 15)
    at(s, () => {
      for (let ty = 21; ty <= 22; ty++) {
        const st = sim.structureAt(26, ty);
        if (st >= 0) return void sim.queueCommand({ kind: 'demolish', ids: demo, structure: st });
      }
    });
};

/** III: from `from` s, every 15 s while Hallaq's man lives, `armour` attack-moves up the north road to the lip above
 *  `north_exit` (18.5,5), beyond the hamlet; once he is dead it comes back down to the head, which needs someone
 *  standing in it for the hold. */
function stopHimOnTheLip(sim: Parameters<Plan>[0], rt: Parameters<Plan>[1], at: Parameters<Plan>[3], armour: readonly number[], from: number): void {
  let hunting = false;
  for (let s = from; s < 700; s += 15)
    at(s, () => {
      const live = armour.filter((i) => sim.state.alive[i] === 1);
      if (rt.objectiveStatus('kill_hallaqs_man') !== 'active') {
        if (hunting) sim.queueCommand({ kind: 'attackMove', ids: live, ...M(24, 15) });
        hunting = false;
        return;
      }
      hunting = true;
      sim.queueCommand({ kind: 'attackMove', ids: live, ...M(18.5, 5) });
    });
}

// III — One Road. The armour and the feet push up the causeway to its head at t=0 (a Namer cannot wade, and the
// causeway is the only road), the jeep and every squad the camp builds stay at the camp door, where the 100 s,
// 200 s and 300 s waders come, and the engineers follow to the stock and bring the warehouse down once its guard is
// quiet. The camp buys a rifle squad or an AT team whenever the purse allows (`requestBuild`).
//
// Hallaq's man runs for the north road the moment anything of ours sets foot on the mill islet (GH-912: the trigger
// was `casualties_pct` 40, which fired on 30/30 seeds of every rung with his truck already dead). The column is on the
// islet at 12 s, so he drives out of the head at 12 s and parks at `north_exit` (18,0), on the reverse slope behind
// the lip: nothing south of the houses can see him there, and nothing removes him. From 60 s, while he lives, the
// Namer and the Eitan go up the north road to the lip and stop him there, beyond the hamlet, and come back down to the
// head once he is dead: the hold needs someone standing in it. Measured over 30 seeds: he dies on the lip on 30/30.
//
// The briefing's sharp play, the starting AT team walked across the west island to the lip, was measured too and is
// not this plan: it gets there at about 60 s, long after he has parked, and a lone AT team walking up to a parked
// technical loses the duel on most seeds (the DShK sees it first while it moves). It is the stop for a player who
// holds the column back until the team is on the lip.
//
// With the marks the chain forwards (`eq_reed_cell`, `eq_causeway_rpg` from I, `eq_saddle_truck` from II) the three
// ambushers spawn identified and without their ambush, so the push meets no first shot. The same plan with no marks
// is the carry probe in `eq_ladder.ts`.
export const eq3Plan: Plan = (sim, rt, ids, at) => {
  const apc = ids('apc_eitan');
  const armour = [...ids('ifv_namer'), ...apc];
  const feet = [...ids('inf_squad'), ...ids('at_team')];
  const demo = ids('demo_squad');
  const jeep = ids('jeep_shoded');
  at(0, () => {
    sim.queueCommand({ kind: 'attackMove', ids: armour, ...M(24, 16) });
    sim.queueCommand({ kind: 'attackMove', ids: feet, ...M(24, 19) });
    sim.queueCommand({ kind: 'move', ids: demo, ...M(24, 26) });
    sim.queueCommand({ kind: 'attackMove', ids: jeep, ...M(11, 41) });
  });
  for (let s = 45; s < 330; s += 15)
    at(s, () => {
      const st = sim.structureAt(20, 13);
      if (st >= 0) sim.queueCommand({ kind: 'demolish', ids: demo, structure: st });
    });
  stopHimOnTheLip(sim, rt, at, armour, 60);
  const bought = new Set<number>();
  for (let s = 0; s < 400; s += 10)
    at(s, () => {
      if (!rt.requestBuild('inf_squad')) rt.requestBuild('at_team');
      const fresh: number[] = [];
      for (const id of [...ids('inf_squad'), ...ids('at_team')])
        if (!feet.includes(id) && !bought.has(id)) {
          bought.add(id);
          fresh.push(id);
        }
      if (fresh.length) sim.queueCommand({ kind: 'attackMove', ids: fresh, ...M(11, 41) });
    });
};

/**
 * III, report only (the `head` rung): the other side of the stop decision, killing him at the head before he runs.
 * Nothing of ours may touch the mill islet until he is dead, so the column holds on the causeway south of it, and the
 * feet (both rifle squads and the AT team) wade across the west island and east along the north channel, which is not
 * the islet, to within the AT team's sight of the head yard. Once he is dead the column goes up as `eq3Plan` does.
 */
export const eq3HeadPlan: Plan = (sim, rt, ids, at) => {
  const apc = ids('apc_eitan');
  const armour = [...ids('ifv_namer'), ...apc];
  const feet = [...ids('inf_squad'), ...ids('at_team')];
  const demo = ids('demo_squad');
  const jeep = ids('jeep_shoded');
  at(0, () => {
    sim.queueCommand({ kind: 'attackMove', ids: armour, ...M(24, 23) });
    sim.queueCommand({ kind: 'attackMove', ids: feet, ...M(24, 25) });
    sim.queueCommand({ kind: 'move', ids: demo, ...M(24, 28) });
    sim.queueCommand({ kind: 'attackMove', ids: jeep, ...M(11, 41) });
  });
  // Up to the head once he is dead, or at 90 s whatever has happened: then he runs, and the lip is the stop.
  let pushed = false;
  for (let s = 5; s <= 90; s += 5)
    at(s, () => {
      if (pushed || (s < 90 && rt.objectiveStatus('kill_hallaqs_man') === 'active')) return;
      pushed = true;
      sim.queueCommand({ kind: 'attackMove', ids: armour.filter((i) => sim.state.alive[i] === 1), ...M(24, 16) });
      sim.queueCommand({ kind: 'attackMove', ids: feet.filter((i) => sim.state.alive[i] === 1), ...M(24, 19) });
      sim.queueCommand({ kind: 'move', ids: demo, ...M(24, 26) });
    });
  stopHimOnTheLip(sim, rt, at, armour, 105);
  for (let s = 45; s < 330; s += 15)
    at(s, () => {
      const st = sim.structureAt(20, 13);
      if (pushed && st >= 0) sim.queueCommand({ kind: 'demolish', ids: demo, structure: st });
    });
  const bought = new Set<number>();
  for (let s = 0; s < 400; s += 10)
    at(s, () => {
      if (!rt.requestBuild('inf_squad')) rt.requestBuild('at_team');
      const fresh: number[] = [];
      for (const id of [...ids('inf_squad'), ...ids('at_team')])
        if (!feet.includes(id) && !bought.has(id)) {
          bought.add(id);
          fresh.push(id);
        }
      if (fresh.length) sim.queueCommand({ kind: 'attackMove', ids: fresh, ...M(11, 41) });
    });
};

export const EIN_QASAB_PLANS: Record<(typeof EIN_QASAB_CHAIN)[number], Plan> = {
  ein_qasab_1_recon: eq1Plan,
  ein_qasab_2_foothold: eq2Plan,
  ein_qasab_3_buildup: eq3Plan,
};

type MapLike = { markers: Record<string, [number, number]>; zones: Record<string, number[]> };
const mapOf = (id: string): MapLike => {
  const file = (missions as Record<string, { map: { file: string } }>)[id].map.file;
  return maps[file as keyof typeof maps] as unknown as MapLike;
};
const centre = (z: number[]): [number, number] => [z[0] + z[2] / 2, z[1] + z[3] / 2];
const own = (sim: Parameters<Plan>[0]): number[] => {
  const out: number[] = [];
  for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0 && sim.state.alive[i] === 1) out.push(i);
  return out;
};

/** The skill floor: the whole force attack-moves to the mission's focus at t=0 and is never given another order. */
export const eqNaive = (id: string): Plan => {
  const map = mapOf(id);
  const focus = id === 'ein_qasab_1_recon' ? map.markers.hamlet : id === 'ein_qasab_2_foothold' ? centre(map.zones.hollow) : map.markers.causeway_head;
  return (sim, _rt, _ids, at) => at(0, () => sim.queueCommand({ kind: 'attackMove', ids: own(sim), ...M(focus[0], focus[1]) }));
};

/**
 * What a player who read the briefing and did not know the ground would do, written against markers and zones.
 *  I   on foot, as the briefing's second option: the sniper to the west bank, the drone over the west causeway
 *      mouth, both rifle squads and the AT team walk out to the carriers (shepherd radius, 4 tiles) and then home,
 *      the jeep fetches the hamlet pair. The Eitan stays at the start line.
 *  II  the force holds the hollow centre, re-anchored every 45 s; the engineers raise the outpost in the hollow and
 *      then demolish what stands in the barn yard; the mortar sits behind.
 *  III the force pushes to the causeway head and re-anchors every 45 s; from 60 s, while Hallaq's man lives, the
 *      armour goes up the north road to the lip above `north_exit` to stop him, as the briefing says; the engineers
 *      take the stock; the camp buys a squad whenever the purse allows.
 */
export const eqSensible = (id: string): Plan => {
  const map = mapOf(id);
  if (id === 'ein_qasab_1_recon')
    return (sim, _rt, ids, at) => {
      const apc = ids('apc_eitan');
      const refuge = map.markers.civ_refuge;
      const cs = map.markers.causeway_s;
      const hamlet = map.markers.hamlet;
      // Two trips, nothing else risked: the Eitan to the south causeway for the carriers it can seat, home, then to the hamlet for the rest.
      at(0, () => {
        sim.queueCommand({ kind: 'move', ids: apc, ...M(cs[0], cs[1]) });
        sim.queueCommand({ kind: 'move', ids: ids('recon_drone'), ...M(map.markers.causeway_n[0] - 4, map.markers.causeway_n[1] + 6) });
      });
      at(25, () => sim.queueCommand({ kind: 'move', ids: apc, ...M(refuge[0], refuge[1]) }));
      at(75, () => sim.queueCommand({ kind: 'move', ids: apc, ...M(hamlet[0] + 1, hamlet[1] + 2) }));
      at(150, () => sim.queueCommand({ kind: 'move', ids: apc, ...M(refuge[0], refuge[1]) }));
    };
  return eqSensibleLegacy(id);
};

/** Ein Qasab I on foot, the briefing's second option: reported as the `foot` rung, not gated. */
export const eqFoot = (id: string): Plan => {
  const map = mapOf(id);
  if (id === 'ein_qasab_1_recon')
    return (sim, _rt, ids, at) => {
      const foot = [...ids('inf_squad'), ...ids('at_team')];
      const refuge = map.markers.civ_refuge;
      const hamlet = map.markers.hamlet;
      at(0, () => {
        sim.queueCommand({ kind: 'move', ids: ids('sniper_team'), ...M(10, 41) });
        sim.queueCommand({ kind: 'move', ids: ids('recon_drone'), ...M(map.markers.causeway_n[0] - 4, map.markers.causeway_n[1] + 6) });
        sim.queueCommand({ kind: 'move', ids: foot, ...M(map.markers.causeway_s[0] - 3.5, map.markers.causeway_s[1] + 0.5) });
      });
      // The squads close the last two tiles once the first wave is on its way: the carriers cannot be walked out from the edge of the ring.
      at(70, () => sim.queueCommand({ kind: 'move', ids: foot, ...M(map.markers.causeway_s[0] - 1.5, map.markers.causeway_s[1] + 0.5) }));
      at(120, () => sim.queueCommand({ kind: 'move', ids: foot, ...M(refuge[0], refuge[1]) }));
      at(20, () => sim.queueCommand({ kind: 'move', ids: ids('jeep_shoded'), ...M(hamlet[0] + 2, hamlet[1] + 3) }));
      at(75, () => sim.queueCommand({ kind: 'move', ids: ids('jeep_shoded'), ...M(refuge[0], refuge[1]) }));
    };
  return () => {};
};

const eqSensibleLegacy = (id: string): Plan => {
  const map = mapOf(id);
  if (id === 'ein_qasab_2_foothold')
    return (sim, rt, ids, at) => {
      const demo = ids('demo_squad');
      const kept = new Set([...demo, ...ids('mortar_team'), ...ids('inf_medic_squad')]);
      const c = centre(map.zones.hollow);
      const anchor = (): void => {
        const cur = own(sim).filter((i) => !kept.has(i));
        sim.queueCommand({ kind: 'attackMove', ids: cur, ...M(c[0], c[1] + 3) });
      };
      at(1, () => {
        rt.requestConstruct('kdf_outpost', 18, 24, demo);
        anchor();
        sim.queueCommand({ kind: 'attackMove', ids: ids('mortar_team'), ...M(c[0], c[1] + 9) });
      });
      for (let s = 45; s < 800; s += 45) at(s, anchor);
      for (let s = 60; s < 800; s += 15)
        at(s, () => {
          const z = map.zones.barn_yard;
          for (let ty = z[1]; ty < z[1] + z[3]; ty++)
            for (let tx = z[0]; tx < z[0] + z[2]; tx++) {
              const st = sim.structureAt(tx, ty);
              if (st >= 0) return void sim.queueCommand({ kind: 'demolish', ids: demo, structure: st });
            }
        });
    };
  return (sim, rt, ids, at) => {
    const demo = ids('demo_squad');
    // "Stop him beyond the hamlet": once he has run, the armour goes up the north road to the lip above `north_exit`
    // (written against the marker) and comes back to the head when he is dead.
    const armour = [...ids('ifv_namer'), ...ids('apc_eitan')];
    const kept = new Set(demo);
    const head = map.markers.causeway_head;
    const exit = map.markers.north_exit;
    const hunting = (): boolean => rt.objectiveStatus('kill_hallaqs_man') === 'active';
    const anchor = (s: number): void => {
      const away = new Set(s >= 60 && hunting() ? armour : []);
      sim.queueCommand({ kind: 'attackMove', ids: own(sim).filter((i) => !kept.has(i) && !away.has(i)), ...M(head[0], head[1] + 2) });
    };
    at(1, () => {
      anchor(1);
      sim.queueCommand({ kind: 'move', ids: demo, ...M(head[0], head[1] + 8) });
    });
    for (let s = 45; s < 800; s += 45) at(s, () => anchor(s));
    for (let s = 60; s < 800; s += 45)
      at(s, () => {
        if (hunting()) sim.queueCommand({ kind: 'attackMove', ids: armour.filter((i) => sim.state.alive[i] === 1), ...M(exit[0] + 0.5, exit[1] + 5) });
      });
    for (let s = 60; s < 800; s += 15)
      at(s, () => {
        const z = map.zones.stock_yard;
        for (let ty = z[1]; ty < z[1] + z[3]; ty++)
          for (let tx = z[0]; tx < z[0] + z[2]; tx++) {
            const st = sim.structureAt(tx, ty);
            if (st >= 0) return void sim.queueCommand({ kind: 'demolish', ids: demo, structure: st });
          }
      });
    for (let s = 0; s < 400; s += 20) at(s, () => void rt.requestBuild('inf_squad'));
  };
};

export const eq2B: Plan = (sim, rt, ids, at) => {
  const demo = ids('demo_squad');
  const rest = [...ids('apc_eitan'), ...ids('ifv_namer'), ...ids('inf_squad'), ...ids('at_team'), ...(process.env.EQ_NOMORTAR ? [] : ids('mortar_team'))];
  at(1, () => {
    rt.requestConstruct('kdf_outpost', 18, 24, demo);
    sim.queueCommand({ kind: 'attackMove', ids: rest, ...M(24.5, 23) });
  });
  for (let s = 60; s < 800; s += 15)
    at(s, () => {
      for (let ty = 21; ty <= 22; ty++) {
        const st = sim.structureAt(26, ty);
        if (st >= 0) { sim.queueCommand({ kind: 'demolish', ids: demo, structure: st }); return; }
      }
    });
};
