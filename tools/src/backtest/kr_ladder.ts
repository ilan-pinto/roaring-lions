/* eslint-disable @typescript-eslint/no-explicit-any -- reads mission/map JSON by shape, tree-agnostic on purpose */
// Plan ladder for Khan Rafid II-III (GH-382): passive / naive / sensible over many seeds.
//
//   npx tsx tools/src/backtest/kr_ladder.ts [seeds=12] [mission-id ...]
//
// The three plans are written against MARKERS AND ZONES, never coordinates, so the SAME script
// runs on the old ground and the new: that is what makes a before/after table honest. Run it
// in both trees and diff. The scripted plans in playtest.ts are the optimal rung and are tied
// to coordinates, so they are not on this ladder.
//
//   passive  - no orders.
//   naive    - one attackMove of the whole force to the objective's focus at t=0, never re-issued.
//   sensible - the same, re-anchored every 45 s; demolishers demolish what is standing inside a
//              raze zone (nothing else will level a building); one rifle squad walks out to each
//              civilian group in turn; a jeep+APC pair runs at an eliminate_hvt marker.
//
// A fresh ledger, no purchases, no `upgrades_to` gates open, 12 minute cap.
//
// Two knobs, both for reading a result rather than for tuning one:
//   LEG=<seconds>  the shepherd's time on each civilian group (default 22 with an IFV, 40 on foot). It is a
//                  property of the RUNG, not of the mission: Khan Rafid III's families sit 18-35 tiles
//                  from the refuge, so a 22 s leg leaves the IFV driving past a group it has not reached.
//   LADDER_V=1|2   print each run's objective states / every living unit at the end.
// The garrisoned-house sweep is for the `village` mission only (a hall that nothing will fire on, as in
// Khan Rafid III, would otherwise hold the sensible rung at the hall for the whole run).
import { fx } from '../../../packages/sim/src/fixed';
import { TICKS_PER_SECOND } from '../../../packages/sim/src/sim';
import { readFileSync } from 'node:fs';
import { ROOT, makeWorld, idsOf } from '../walk_world';

type Tier = 'passive' | 'naive' | 'sensible';
const seedsN = Number(process.argv[2] ?? 12);
const only = process.argv.slice(3);
const MISSIONS = only.length > 0 ? only : ['khan_rafid_2_foothold', 'khan_rafid_3_clearance'];
const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });
const CAP_TICKS = 12 * 60 * TICKS_PER_SECOND;

interface Obj { id: string; type: string; target?: string; primary?: boolean }
interface Civ { at: [number, number]; count: number }

function focusOf(mission: any, map: any): [number, number] {
  const zone = (n: string) => map.zones[n] as number[];
  const centre = (z: number[]): [number, number] => [z[0] + z[2] / 2, z[1] + z[3] / 2];
  const objs: Obj[] = mission.objectives;
  const hold = objs.find((o) => o.type === 'hold_for' || o.type === 'capture' || o.type === 'raze');
  if (mission.id.includes('depot')) return map.markers.depot_gate;
  if (mission.id.includes('village')) return map.markers.village_center;
  return centre(zone(hold!.target!));
}

function run(id: string, tier: Tier, seed: number): { result: string; mins: number; lost: number; roe: number } {
  const w = makeWorld(id, { seed });
  const { sim, runtime, mission } = w;
  const map = JSON.parse(readFileSync(`${ROOT}/data/maps/${(mission as any).map.file}.json`, 'utf8'));
  const m: any = mission;
  const focus = focusOf(m, map);
  const ownIds = () => idsOf(sim, 0);
  const typeOf = (i: number) => w.nameOf.get(sim.state.typeIdx[i]) ?? '';
  const start0 = ownIds().length;
  const specialists = new Set(ownIds().filter((i) => ['demo_squad', 'dozer_d9'].includes(typeOf(i))));
  const civGroups: Civ[] = (m.civilians?.groups ?? []).map((g: any) => ({ at: g.at, count: g.count }));
  const refuge: [number, number] | null = m.civilians ? map.markers[m.civilians.refuge] : null;
  const hvt = m.objectives.find((o: Obj) => o.type === 'eliminate_hvt' && mission.id.includes('counterraid'));
  const razeZone = m.objectives.find((o: Obj) => o.type === 'raze');
  // An armoured carrier shepherds when the roster has one (IV's scripted plan does the same: nothing in
  // the mission can scratch an IFV, so it cannot die mid-lift and strand its passengers); otherwise a squad.
  const ifvs = ownIds().filter((i) => typeOf(i) === 'ifv_namer');
  const useIfv = ifvs.length > 0 && !hvt;
  const shepherd = tier === 'sensible' && civGroups.length > 0 ? (useIfv ? ifvs : ownIds().filter((i) => typeOf(i) === 'inf_squad').slice(0, 1)) : [];
  const chase = tier === 'sensible' && hvt ? ownIds().filter((i) => ['jeep_shoded', 'apc_eitan'].includes(typeOf(i))) : [];
  const apart = new Set<number>([...(tier === 'naive' ? [] : specialists), ...shepherd, ...chase]);

  const anchor = () => {
    const ids = ownIds().filter((i) => !apart.has(i));
    if (ids.length) sim.queueCommand({ kind: 'attackMove', ids, ...M(focus[0], focus[1]) });
  };
  const demolishNext = () => {
    if (!razeZone) return;
    const z = map.zones[razeZone.target] as number[];
    const spec = [...specialists].filter((i) => sim.state.alive[i] === 1);
    if (!spec.length) return;
    const seen = new Set<number>();
    const list: number[] = [];
    for (let y = z[1]; y < z[1] + z[3]; y++) for (let x = z[0]; x < z[0] + z[2]; x++) { const s = sim.structureAt(x, y); if (s >= 0 && !seen.has(s)) { seen.add(s); list.push(s); } }
    // the mission-raised pump house is not on the map grid: find it by scanning the zone is enough, structureAt sees it
    spec.forEach((u, k) => { if (list.length) sim.queueCommand({ kind: 'demolish', ids: [u], structure: list[(k * 3) % list.length] }); });
  };

  // Garrisoned houses (IV): a garrisoned man cannot be shot, so his house is levelled. The
  // sensible plan takes them nearest-first, `move`ing to the tile the placement itself names.
  const houses = (!id.includes('village') ? [] : (m.enemy?.garrison ?? []) as any[])
    .filter((g) => g.stance?.kind === 'garrison' && g.at)
    .map((g) => ({ b: g.stance.building as [number, number], at: g.at as [number, number] }))
    .sort((a, b) => Math.hypot(a.at[0] - 9, a.at[1] - 21) - Math.hypot(b.at[0] - 9, b.at[1] - 21));
  let stage = -1;
  const advance = () => {
    if (tier !== 'sensible' || houses.length === 0) return;
    if (stage >= houses.length) return;
    if (stage >= 0 && sim.structureAt(houses[stage].b[0], houses[stage].b[1]) >= 0) return;
    stage++;
    const ids = ownIds().filter((i) => !apart.has(i));
    if (stage < houses.length) sim.queueCommand({ kind: 'move', ids, ...M(houses[stage].at[0], houses[stage].at[1] - 1) });
    else sim.queueCommand({ kind: 'attackMove', ids, ...M(focus[0], focus[1]) });
  };
  let t = 0;
  for (; t < CAP_TICKS; t++) {
    const s = t / TICKS_PER_SECOND;
    if (tier !== 'passive') {
      if (t === 0) { if (tier === 'sensible' && houses.length) advance(); else anchor(); if (chase.length) sim.queueCommand({ kind: 'attackMove', ids: chase, ...M(map.markers.hide_north[0], map.markers.hide_north[1] + 3) }); }
      if (tier === 'sensible') {
        if (houses.length) { if (t % (5 * TICKS_PER_SECOND) === 0) advance(); }
        else if (t % (45 * TICKS_PER_SECOND) === TICKS_PER_SECOND) anchor();
        if (t % (15 * TICKS_PER_SECOND) === 0) demolishNext();
        if (shepherd.length) {
          const leg = Number(process.env.LEG ?? (useIfv ? 22 : 40));
          const k = Math.floor(s / leg);
          if (t % (leg * TICKS_PER_SECOND) === 0 && k < civGroups.length) sim.queueCommand({ kind: 'move', ids: shepherd, ...M(civGroups[k].at[0], civGroups[k].at[1]) });
          if (useIfv && refuge && s === leg * civGroups.length) sim.queueCommand({ kind: 'move', ids: shepherd, ...M(refuge[0], refuge[1]) });
          if (!useIfv && s === leg * civGroups.length + 40) { for (const q of shepherd) apart.delete(q); }
        }
      }
    }
    runtime.step(sim.tick());
    if (runtime.result !== 'ongoing') break;
  }
  void refuge;
  if (process.env.LADDER_V) console.log(`    ${id} ${tier} seed ${seed}: ${runtime.result} ${runtime.objectiveList.map((o) => `${o.id}=${o.status[0]}`).join(' ')}`);
  if (process.env.LADDER_V === '2') {
    for (let i = 0; i < sim.entityCount; i++) if (sim.state.alive[i] === 1) console.log(`      ${sim.state.side[i] === 0 ? 'own' : 'ENEMY'} ${typeOf(i)} (${(sim.state.posX[i] / 65536).toFixed(1)},${(sim.state.posY[i] / 65536).toFixed(1)})`);
  }
  const alive = ownIds().length;
  return { result: runtime.result, mins: t / TICKS_PER_SECOND / 60, lost: start0 - alive, roe: runtime.roeScore };
}

console.log(`seeds 1..${seedsN}; tiers passive/naive/sensible; cap 12 min; tree ${ROOT}`);
for (const id of MISSIONS) {
  for (const tier of ['passive', 'naive', 'sensible'] as Tier[]) {
    const rs = Array.from({ length: seedsN }, (_, k) => run(id, tier, k + 1));
    const wins = rs.filter((r) => r.result === 'victory').length;
    const avg = (f: (r: (typeof rs)[number]) => number, sel = rs) => (sel.length ? sel.reduce((a, r) => a + f(r), 0) / sel.length : NaN);
    const won = rs.filter((r) => r.result === 'victory');
    console.log(
      `${id.padEnd(26)} ${tier.padEnd(8)} win ${String(wins).padStart(2)}/${seedsN} (${((100 * wins) / seedsN).toFixed(0).padStart(3)}%)  ` +
        `min(all) ${avg((r) => r.mins).toFixed(1)}  min(won) ${avg((r) => r.mins, won).toFixed(1)}  lost ${avg((r) => r.lost).toFixed(1)}  roe ${avg((r) => r.roe).toFixed(0)}`
    );
  }
}
