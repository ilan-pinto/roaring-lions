// The scripted winning plans for Bir Tarsha (The Long Ground, town 2). Side-effect free: exports closures and constants, runs nothing.
// `playtest.ts` runs `BIR_TARSHA_PLANS` down the ledger chain.
import { fx } from '@lions/sim';
import type { Plan } from '../playtest-run';

export const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });

export const BIR_TARSHA_CHAIN = ['bir_tarsha_1_recon', 'bir_tarsha_2_foothold', 'bir_tarsha_3_clearance', 'bir_tarsha_5_subterranean'] as const;

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

export const bt3Plan: Plan = () => {};
export const bt5Plan: Plan = () => {};

export const BIR_TARSHA_PLANS: Record<(typeof BIR_TARSHA_CHAIN)[number], Plan> = {
  bir_tarsha_1_recon: bt1Plan,
  bir_tarsha_2_foothold: bt2Plan,
  bir_tarsha_3_clearance: bt3Plan,
  bir_tarsha_5_subterranean: bt5Plan,
};
