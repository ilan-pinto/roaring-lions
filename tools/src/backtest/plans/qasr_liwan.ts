// The scripted winning plans for Qasr Liwan (The Long Ground, town 1): five missions on the Marj's city.
// Side-effect free: exports closures and constants, runs nothing. `playtest.ts` runs `QASR_LIWAN_PLANS` down the
// ledger chain.
import { fx } from '@lions/sim';
import type { Plan } from '../playtest-run';

const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });

export const QASR_LIWAN_CHAIN = [
  'qasr_liwan_1_recon',
  'qasr_liwan_2_foothold',
  'qasr_liwan_3_buildup',
  'qasr_liwan_4_clearance',
  'qasr_liwan_5_subterranean',
] as const;

/** Enemy ids alive within `r` tiles of (x, y). */
const foeNear = (sim: Parameters<Plan>[0], x: number, y: number, r: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < sim.entityCount; i++) {
    if (sim.state.side[i] !== 1 || sim.state.alive[i] !== 1 || sim.unitTypes[sim.state.typeIdx[i]].id.startsWith('wounded')) continue;
    const dx = Number(sim.state.posX[i]) / 65536 - x;
    const dy = Number(sim.state.posY[i]) / 65536 - y;
    if (dx * dx + dy * dy <= r * r) out.push(i);
  }
  return out;
};

/** The first living enemy standing inside the rectangle [x, y, w, h], or -1. */
const foeIn = (sim: Parameters<Plan>[0], z: readonly number[]): number => {
  for (let i = 0; i < sim.entityCount; i++) {
    if (sim.state.side[i] !== 1 || sim.state.alive[i] !== 1 || sim.unitTypes[sim.state.typeIdx[i]].id.startsWith('wounded')) continue;
    const x = Number(sim.state.posX[i]) / 65536;
    const y = Number(sim.state.posY[i]) / 65536;
    if (x >= z[0] && x < z[0] + z[2] && y >= z[1] && y < z[1] + z[3]) return i;
  }
  return -1;
};

// I — One House. The sniper and the Eitan (not the squads: they broke and ran from the knoll post on the first
// build of this plan) take the tower post on the north road from the start line, the squads then walk the road to the
// gate lane, take the guard there and stand in the lane (a soldier within four tiles of the person shepherds them out),
// and the drone, kept off the courtyard (a drone over it wakes the street, G-QL5), looks at the coast post from the
// road for the carrying secondary. 30 of 30 sweep seeds win (slowest 2.1 min, 1.1 on 424242), three stars, Conduct 100.
export const ql1Plan: Plan = (sim, rt, ids, at) => {
  const feet = ids('inf_squad');
  at(0, () => {
    sim.queueCommand({ kind: 'move', ids: ids('recon_drone'), ...M(40, 3.5) });
    sim.queueCommand({ kind: 'move', ids: ids('sniper_team'), ...M(42, 3) });
    sim.queueCommand({ kind: 'attackMove', ids: ids('apc_eitan'), ...M(38.5, 3.5) });
  });
  let go = false;
  for (let s = 5; s < 400; s += 5)
    at(s, () => {
      if (go || foeNear(sim, 32.5, 5.5, 3).length > 0) return;
      go = true;
      sim.queueCommand({ kind: 'attackMove', ids: feet, ...M(21, 3.5) });
    });
  // Once the gate guard is down the squads close on the gate lane: a soldier within four tiles of the person shepherds them out.
  let lane = false;
  for (let s = 5; s < 400; s += 5)
    at(s, () => {
      if (lane || !go || foeNear(sim, 19.5, 5.5, 2.5).length > 0) return;
      lane = true;
      sim.queueCommand({ kind: 'move', ids: feet.filter((i) => sim.state.alive[i] === 1), ...M(18.5, 6) });
    });
  // The drone looks at the rest of the edge once the guard is known: from the north road it sees the seam post.
  let looked = false;
  for (let s = 5; s < 300; s += 5)
    at(s, () => {
      if (looked || rt.objectiveStatus('find_the_gate_guard') !== 'complete') return;
      looked = true;
      sim.queueCommand({ kind: 'move', ids: ids('recon_drone'), ...M(22, 1.5) });
    });
};

// II — The Ring. One Eitan and the Namer take the seam in the north and re-press it every 15 s (a lost hull must not leave the
// zone unheld); the second Eitan, the squads and the jeep take the Cut and the residents. Measured: both civilian
// transports MUST drive their riders to the refuge, because a civilian who boards a hull is carried where the hull goes (the
// first build parked the Eitan beside the people and never delivered them: 28 of 32 seeds lost `residents_through`); the
// squads stand off the Cut's two-tile lane, which civilians walk through; the Spike and the 60 mm stay home, because a
// stray beside `south_quarter` bills 5 each (six of them took Conduct to the 70 floor). The camp buys rifle squads. 30 of 30
// sweep seeds win (slowest 6.0 min), two stars, Conduct 100.
export const ql2Plan: Plan = (sim, rt, ids, at) => {
  const apcs = ids('apc_eitan');
  const north = [...apcs.slice(0, 1), ...ids('ifv_namer')];
  // The Spike and the 60 mm bill a stray beside a house (`south_quarter` is flagged), so the AT team and the mortar stay home.
  const feet = [...ids('inf_squad'), ...ids('inf_medic_squad'), ...apcs.slice(1)];
  const jeep = ids('jeep_shoded');
  at(0, () => {
    sim.queueCommand({ kind: 'attackMove', ids: north, ...M(8, 3) });
    sim.queueCommand({ kind: 'attackMove', ids: feet.filter((i) => !apcs.includes(i)), ...M(34.5, 40.5) });
    sim.queueCommand({ kind: 'move', ids: apcs.slice(1), ...M(35.5, 40.5) });
    sim.queueCommand({ kind: 'move', ids: jeep, ...M(18, 41) });
  });
  // The seam: whatever is left of the armour re-presses the zone every 15 s, so a hull lost at the post does not leave it unheld.
  for (let s = 20; s < 800; s += 15)
    at(s, () => sim.queueCommand({ kind: 'attackMove', ids: north.filter((i) => sim.state.alive[i] === 1), ...M(7.5, 2.5) }));
  // Both hulls seat civilians who stand near them, and a hull that has them aboard must drive them to the refuge.
  at(12, () => sim.queueCommand({ kind: 'move', ids: jeep, ...M(21.5, 40.5) }));
  at(20, () => {
    sim.queueCommand({ kind: 'move', ids: jeep, ...M(28.5, 45.5) });
    sim.queueCommand({ kind: 'move', ids: apcs.slice(1), ...M(29.5, 45.5) });
  });
  at(45, () => {
    sim.queueCommand({ kind: 'move', ids: jeep, ...M(34.5, 43.5) });
    sim.queueCommand({ kind: 'move', ids: apcs.slice(1), ...M(31.5, 43.5) });
  });
  // The camp buys a rifle squad whenever the purse allows; they join the garrison of the Cut's east side.
  const seen = new Set<number>([...ids('inf_squad'), ...ids('at_team'), ...ids('mortar_team'), ...ids('inf_medic_squad'), ...apcs, ...jeep, ...north]);
  for (let s = 5; s < 600; s += 10)
    at(s, () => {
      rt.requestBuild('inf_squad');
      const fresh: number[] = [];
      for (const id of ids('inf_squad')) if (!seen.has(id)) { seen.add(id); fresh.push(id); }
      if (fresh.length) sim.queueCommand({ kind: 'move', ids: fresh, ...M(33.5, 42.5) });
    });
  // From 60 s the Cut's garrison clears whatever has walked into the checkpoint, then stands off the lane again.
  const cut = [24, 39, 10, 5];
  let busy = false;
  for (let s = 60; s < 800; s += 5)
    at(s, () => {
      const f = foeIn(sim, cut);
      const south = [...feet.filter((i) => !apcs.includes(i)), ...apcs.slice(1)].filter((i) => sim.state.alive[i] === 1);
      if (f >= 0) {
        busy = true;
        sim.queueCommand({ kind: 'attackMove', ids: south, x: sim.state.posX[f], y: sim.state.posY[f] });
      } else if (busy) {
        busy = false;
        sim.queueCommand({ kind: 'move', ids: south, ...M(33.5, 42.5) });
      }
    });
};

// III — The Pause. The rescue squad and the jeep wait out of the handover party's sight until it steps back at 90 s,
// then walk up to the four and home; the rest of the force takes the forward ground and keeps buying rifle squads.
// Measured (F-1): the forward ground is stood on from about 6 s, `hold_for` banks from the first uncontested tick, so 234 s of the
// 300 are banked when the pause ends at 240 s, and the hold completes at 306 s on every seed: the waves never contest it
// once the force is dug in. The 300 s was left as authored. The mortar and the Spike must not be in reach of the lines before
// 240 s (a mortar that fired at a line from the forward ground broke the pause at 25 s). 30 of 30 sweep seeds win at 5.1 min,
// three stars (the drone identifies the yard watch from (27.5,34.5)), Conduct 100.
export const ql3Plan: Plan = (sim, rt, ids, at) => {
  const squads = ids('inf_squad');
  const rescue = squads.slice(0, 1);
  const line = [...squads.slice(1), ...ids('inf_medic_squad')];
  // The Spike and the 60 mm reach the enemy lines from the forward ground and would break the pause on the first shot:
  // they stay at the start line until the pause is over.
  const heavy = [...ids('at_team'), ...ids('mortar_team')];
  const apc = ids('apc_eitan');
  const jeep = ids('jeep_shoded');
  at(0, () => {
    sim.queueCommand({ kind: 'move', ids: line, ...M(29.5, 38.5) });
    sim.queueCommand({ kind: 'move', ids: apc, ...M(31.5, 38.5) });
    sim.queueCommand({ kind: 'move', ids: ids('recon_drone'), ...M(27.5, 34.5) });
    sim.queueCommand({ kind: 'move', ids: [...rescue, ...jeep], ...M(12.5, 43.5) });
  });
  at(92, () => sim.queueCommand({ kind: 'move', ids: [...rescue, ...jeep], ...M(12.5, 40) }));
  // A civilian who has boarded the jeep rides where the jeep goes: it goes to the refuge.
  at(104, () => sim.queueCommand({ kind: 'move', ids: jeep, ...M(12, 45.5) }));
  at(125, () => sim.queueCommand({ kind: 'move', ids: [...rescue, ...jeep], ...M(29.5, 38.5) }));
  at(232, () => sim.queueCommand({ kind: 'move', ids: heavy.filter((i) => sim.state.alive[i] === 1), ...M(31.5, 39.5) }));
  const seen = new Set<number>([...squads, ...heavy, ...ids('inf_medic_squad'), ...apc, ...jeep]);
  for (let s = 1; s < 500; s += 10)
    at(s, () => {
      if (!rt.requestBuild('inf_squad')) if (s > 240) rt.requestBuild('at_team');
      const fresh: number[] = [];
      for (const id of [...ids('inf_squad'), ...ids('at_team')]) if (!seen.has(id)) { seen.add(id); fresh.push(id); }
      if (fresh.length) sim.queueCommand({ kind: 'move', ids: fresh, ...M(29.5, 38.5) });
    });
};

// IV — The Clinic Yard. Rifles and the Eitan's fifty only: the Lavi, the Namer and the Spike each bill a stray beside the clinic.
// IV — The Clinic Yard. The squads walk the forecourt out through the south gate (it is one tile wide: armour parked in it
// strands the people, so the armour waits outside until `walk_the_forecourt_out` is done); the armour then takes the yard from
// the gate with the Lavi, the Namer and the Eitan, none of which bills while its target is west of the clinic, and the
// engineers charge the shaft once the dog has found it. 30 of 30 sweep seeds win (slowest 4.2 min), two stars, Conduct 100.
export const ql4Plan: Plan = (sim, rt, ids, at) => {
  const squads = ids('inf_squad');
  const feet = [...squads, ...ids('inf_medic_squad')];
  const apc = ids('apc_eitan');
  const armour = [...apc, ...ids('ifv_namer'), ...ids('mbt_lavi')];
  const yah = ids('yahalom_squad');
  const dog = ids('ugv_recon_dog');
  at(0, () => {
    sim.queueCommand({ kind: 'attackMove', ids: feet, ...M(30.5, 30.5) });
    sim.queueCommand({ kind: 'attackMove', ids: armour, ...M(29.5, 34.5) });
    sim.queueCommand({ kind: 'move', ids: [...yah, ...dog], ...M(29.5, 40) });
  });
  // The south gate is one tile wide: the armour waits outside it until the forecourt has walked out through it.
  let pushed = false;
  for (let s = 20; s < 360; s += 5)
    at(s, () => {
      if (pushed || (rt.objectiveStatus('walk_the_forecourt_out') !== 'complete' && s < 200)) return;
      pushed = true;
      sim.queueCommand({ kind: 'attackMove', ids: armour.filter((i) => sim.state.alive[i] === 1), ...M(28.5, 28.5) });
    });
  for (let s = 20; s < 360; s += 10)
    at(s, () => {
      if (pushed && sim.tnAlive[0] === 1) {
        sim.queueCommand({ kind: 'attackMove', ids: feet.filter((i) => sim.state.alive[i] === 1), ...M(27.5, 27.5) });
        sim.queueCommand({ kind: 'move', ids: dog.filter((i) => sim.state.alive[i] === 1), ...M(27.5, 30) });
        sim.queueCommand({ kind: 'chargeTunnel', ids: yah.filter((i) => sim.state.alive[i] === 1), tunnel: 0 });
      }
    });
};

// V — The Pumps. A pump party holds the yard on the west edge; a routes party finds and charges the three deep routes;
// the Namer and the Spike stay out of the shore quarter (a house is 24 Conduct here), and the Namer watches the apron.
// V — The Pumps. No drone is issued in the shipped force (level-script F-4: a drone alone can hold `pump_yard`). The Namer opens
// the grid chief's firing position from the lane south of it (rifles cannot dislodge a garrison in cover 3, and the chief
// killed both Yahalom teams on the first build); the rest of the force waits out of his range at the apron until he is down, then a pump party
// holds the yard and the engineers take the three deep routes, nearest first. 30 of 30 sweep seeds win (slowest 5.9 min), two stars,
// Conduct 100. `run_the_pumps` completes last, on the same tick as the win, so the two trigger-keyed flush waves never play
// in this plan; a variant that held the routes back until the pumps were done (run once, not kept) spawned both at 333.7 s,
// one tick after `run_the_pumps`, which is the first shipped use of a wave `trigger`.
export const ql5Plan: Plan = (sim, rt, ids, at) => {
  const squads = ids('inf_squad');
  const apc = ids('apc_eitan');
  const pump = [...squads.slice(0, 2), ...apc, ...ids('inf_medic_squad')];
  const routes = squads.slice(2);
  const yah = ids('yahalom_squad');
  const dog = ids('ugv_recon_dog');
  const namer = ids('ifv_namer');
  at(0, () => {
    sim.queueCommand({ kind: 'attackMove', ids: namer, ...M(14.5, 37.5) });
    sim.queueCommand({ kind: 'move', ids: [...pump, ...routes, ...yah, ...dog], ...M(17, 42.5) });
  });
  // The camp buys a rifle squad whenever the purse allows; they hold the apron beside the Namer.
  const seen = new Set<number>([...squads, ...ids('at_team'), ...ids('inf_medic_squad'), ...apc, ...namer]);
  for (let s = 5; s < 600; s += 10)
    at(s, () => {
      rt.requestBuild('inf_squad');
      const fresh: number[] = [];
      for (const id of ids('inf_squad')) if (!seen.has(id)) { seen.add(id); fresh.push(id); }
      if (fresh.length) sim.queueCommand({ kind: 'move', ids: fresh, ...M(21.5, 41.5) });
    });
  let phase2 = -1;
  for (let s = 5; s < 700; s += 5)
    at(s, () => {
      if (phase2 < 0 && (rt.objectiveStatus('the_grid_chief') === 'complete' || s >= 150)) {
        phase2 = s;
        sim.queueCommand({ kind: 'attackMove', ids: pump.filter((i) => sim.state.alive[i] === 1), ...M(5.5, 31.5) });
        sim.queueCommand({ kind: 'attackMove', ids: routes.filter((i) => sim.state.alive[i] === 1), ...M(13, 34) });
      }
      if (phase2 < 0) return;
      const deep = [4, 3, 2];
      const next = deep.find((r) => sim.tnAlive[r] === 1);
      if (next === undefined) return;
      if (s >= phase2 + 15 && s % 10 === 0) sim.queueCommand({ kind: 'chargeTunnel', ids: yah.filter((i) => sim.state.alive[i] === 1), tunnel: next });
    });
};

export const QASR_LIWAN_PLANS: Record<(typeof QASR_LIWAN_CHAIN)[number], Plan> = {
  qasr_liwan_1_recon: ql1Plan,
  qasr_liwan_2_foothold: ql2Plan,
  qasr_liwan_3_buildup: ql3Plan,
  qasr_liwan_4_clearance: ql4Plan,
  qasr_liwan_5_subterranean: ql5Plan,
};
