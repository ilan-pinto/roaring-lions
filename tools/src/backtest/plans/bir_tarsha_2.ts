import type { Plan } from '../playtest-run';
import { M, foesIn } from './bir_tarsha_util';

/** II: the squads shepherd the cross road's residents west out of the mortar's reach, the camp buys infantry, the Lavi, the sniper and the tube take the missile teams and the mortar crew from the cross road, then the force steps into the gate. */
export const bt2Plan: Plan = (sim, rt, ids, at) => {
  const squads = ids('inf_squad');
  const feet = [...squads, ...ids('inf_medic_squad')];
  const armour = ids('mbt_lavi');
  const guns = [...armour, ...ids('sniper_team'), ...ids('mortar_team')];
  const gate = [17, 30, 14, 7];
  at(0, () => {
    sim.queueCommand({ kind: 'move', ids: feet, ...M(23.5, 17.5) });
    sim.queueCommand({ kind: 'move', ids: guns, ...M(24.5, 21.5) });
  });
  at(25, () => sim.queueCommand({ kind: 'move', ids: feet.filter((i) => sim.state.alive[i] === 1), ...M(14.5, 24.5) }));
  const seen = new Set<number>([...squads, ...ids('inf_medic_squad'), ...guns]);
  const alive = (l: number[]): number[] => l.filter((i) => sim.state.alive[i] === 1);
  for (let s = 5; s < 400; s += 10)
    at(s, () => {
      rt.requestBuild('inf_squad');
      const fresh: number[] = [];
      for (const id of ids('inf_squad')) if (!seen.has(id)) { seen.add(id); fresh.push(id); }
      if (fresh.length) sim.queueCommand({ kind: 'move', ids: fresh, ...M(24.5, 22.5) });
    });
  // The Lavi and the sniper step out to the cross road's south edge, where the missile teams on the fence road are inside their sight (the Lavi sees 12, the sniper 16, a Kornet reaches 14).
  at(60, () => sim.queueCommand({ kind: 'move', ids: alive([...armour, ...ids('sniper_team')]), ...M(24.5, 26.5) }));
  let cleared = false;
  for (let s = 75; s < 420; s += 5)
    at(s, () => {
      const hostile = foesIn(sim, [0, 22, 48, 20], ['atgm_cell', 'mortar_crew', 'rpg_team', 'charge_squad']);
      if (hostile.length > 0) sim.queueCommand({ kind: 'attack', ids: alive(guns), target: hostile[0] });
      const posts = foesIn(sim, [0, 28, 48, 10], ['atgm_cell']).filter((i) => ['atgm_cell', 'mortar_crew'].includes(sim.unitTypes[sim.state.typeIdx[i]].id));
      if (!cleared && s > 150 && posts.length === 0) {
        cleared = true;
        sim.queueCommand({ kind: 'attackMove', ids: alive(armour), ...M(24.5, 34.5) });
        sim.queueCommand({ kind: 'move', ids: alive(ids('mortar_team')), ...M(24.5, 26.5) });
      }
      // The terminal's garrison is fought from outside the blocks, by the Lavi, the tube and the sniper, before a squad goes into the zone.
      if (cleared) {
        const inside = foesIn(sim, [15, 34, 16, 6]);
        if (inside.length > 0) sim.queueCommand({ kind: 'attack', ids: alive(guns), target: inside[0] });
        else sim.queueCommand({ kind: 'move', ids: alive(squads), ...M(24.5, 31.5) });
      }
    });
  if (process.env.BT_DBG)
    for (const t of [60, 120, 180, 240, 300]) at(t, () => {
      const rows: string[] = [];
      for (let i = 0; i < sim.entityCount; i++) if (sim.state.alive[i] === 1) rows.push(`${sim.state.side[i]}:${sim.unitTypes[sim.state.typeIdx[i]].id}@${Math.round(Number(sim.state.posX[i]) / 65536)},${Math.round(Number(sim.state.posY[i]) / 65536)}`);
      console.log(`DBG t=${t} gate=${rt.objectiveStatus('hold_the_gate')} seven=${rt.objectiveStatus('seven_in')} ${rows.join(' ')}`);
    });
  void gate;
};
