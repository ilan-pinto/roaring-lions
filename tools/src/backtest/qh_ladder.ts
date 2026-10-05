/* eslint-disable @typescript-eslint/no-explicit-any -- reads mission/map JSON by shape, tree-agnostic on purpose */
// Plan ladder for Qarn Hadid II-III (GH-382): passive / naive / sensible over many seeds.
//
//   npx tsx tools/src/backtest/qh_ladder.ts [seeds=12] [mission-id ...]
//
// Same idea as uz_ladder.ts / kr_ladder.ts, and the same reason: the plans are written against
// MARKERS AND ZONES, never coordinates, so ONE script runs on the old ground (the shared
// `qarn_hadid` file) and the new (`qarn_hadid_2`, `qarn_hadid_3`), and that is what makes a
// before/after table honest. Run it in both trees and diff. The scripted plans in playtest.ts are
// the optimal rung and are tied to coordinates, so they are not on this ladder.
//
//   passive  - no orders.
//   naive    - one attackMove of the whole force to the mission's focus at t=0, never re-issued.
//   sensible - what a player who read the briefing would do, re-anchored every 45 s:
//     II  armour, mortar and the demolition party go to the high gate and the demolishers level
//         what stands in the_gates; the foot walks the notch to the hollow;
//     III one rifle squad climbs the terraces, a second with the AT team walks out to the families
//         and on to the clinic, the rest take the village.
//
// A fresh ledger, no purchases, no `upgrades_to` gates open, 12 minute cap.
import { fx } from '../../../packages/sim/src/fixed';
import { TICKS_PER_SECOND } from '../../../packages/sim/src/sim';
import { readFileSync } from 'node:fs';
import { ROOT, makeWorld, idsOf } from '../walk_world';

type Tier = 'passive' | 'naive' | 'sensible';
const seedsN = Number(process.argv[2] ?? 12);
const only = process.argv.slice(3);
const MISSIONS = only.length > 0 ? only : ['qarn_hadid_2_foothold', 'qarn_hadid_3_clearance'];
const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });
const CAP_TICKS = 12 * 60 * TICKS_PER_SECOND;

function run(id: string, tier: Tier, seed: number): { result: string; mins: number; lost: number; roe: number } {
  const w = makeWorld(id, { seed });
  const { sim, runtime, mission } = w;
  const m: any = mission;
  const map = JSON.parse(readFileSync(`${ROOT}/data/maps/${m.map.file}.json`, 'utf8'));
  const mk = (n: string): [number, number] => map.markers[n];
  const zc = (n: string): [number, number] => {
    const z = map.zones[n] as number[];
    return [z[0] + Math.floor(z[2] / 2), z[1] + Math.floor(z[3] / 2)];
  };
  const own = () => idsOf(sim, 0);
  const typeOf = (i: number) => w.nameOf.get(sim.state.typeIdx[i]) ?? '';
  const ofType = (...t: string[]) => own().filter((i) => t.includes(typeOf(i)));
  const start0 = own().length;
  const kind = id.includes('foothold') ? 'II' : 'III';
  const demo = new Set(ofType('demo_squad'));
  const drone = new Set(ofType('recon_drone'));
  const go = (ids: number[], p: [number, number]) => {
    const live = ids.filter((i) => sim.state.alive[i] === 1);
    if (live.length) sim.queueCommand({ kind: 'attackMove', ids: live, ...M(p[0], p[1]) });
  };
  const walk = (ids: number[], p: [number, number]) => {
    const live = ids.filter((i) => sim.state.alive[i] === 1);
    if (live.length) sim.queueCommand({ kind: 'move', ids: live, ...M(p[0], p[1]) });
  };
  const structsIn = (zone: string): number[] => {
    const z = map.zones[zone] as number[];
    const seen = new Set<number>();
    for (let y = z[1]; y < z[1] + z[3]; y++) for (let x = z[0]; x < z[0] + z[2]; x++) { const s = sim.structureAt(x, y); if (s >= 0) seen.add(s); }
    return [...seen];
  };
  const razeZone: string | undefined = m.objectives.find((o: any) => o.type === 'raze' && o.primary)?.target;
  const demolishAll = () => {
    if (!razeZone) return;
    const list = structsIn(razeZone);
    const live = [...demo].filter((i) => sim.state.alive[i] === 1);
    live.forEach((u, k) => { if (list.length) sim.queueCommand({ kind: 'demolish', ids: [u], structure: list[(k * 2) % list.length] }); });
  };

  const focus: [number, number] = kind === 'II' ? zc('the_gates') : mk('village_square');
  const main = () => own().filter((i) => !demo.has(i) && !drone.has(i));
  const inf = ofType('inf_squad');
  // II groups
  const armourII = [...ofType('mbt_lavi', 'ifv_namer', 'apc_eitan', 'mortar_team')];
  const footII = [...inf, ...ofType('at_team')];
  // III groups
  const west = inf.slice(0, 1);
  const civTeam = [...inf.slice(1, 2), ...ofType('at_team')];
  const rest = () => own().filter((i) => !demo.has(i) && !drone.has(i) && !west.includes(i) && !civTeam.includes(i));
  const civAt: [number, number][] = (m.civilians?.groups ?? []).map((g: any) => g.at);
  let t = 0;
  for (; t < CAP_TICKS; t++) {
    const s = t / TICKS_PER_SECOND;
    if (tier === 'naive' && t === 0) go(own(), focus);
    if (tier === 'sensible') {
      if (kind === 'II') {
        // armour and mortar drive the switchback (`move`, not attackMove: a column that chases contacts leaves the leg),
        // the foot takes the hollow by the plain, then the demolition party follows the armour up
        if (t === 1) { walk(armourII, mk('shoulder_gate')); go(footII, mk('hollow_floor')); walk([...drone], mk('south_plain')); }
        if (s === 100) walk([...demo], mk('shoulder_gate'));
        // no explicit `demolish`: its snap tile is on the far side of the concrete, so the order routes the party round by the notch
        if (s === 150) go(footII, mk('saddle_gate'));
      } else {
        if (t === 1) { go(west, mk('knoll_top')); walk([...drone], mk('shoulder_gate')); }
        if (s === 130) walk(civTeam, civAt[0] ? [civAt[0][0] + 1, civAt[0][1]] : mk('village_square'));
        if (s === 60) go(rest(), mk('north_junction'));
        if (s === 160) go(rest(), mk('village_square'));
        if (s >= 220 && t % (45 * TICKS_PER_SECOND) === 0) go(rest(), mk('village_square'));
      }
    }
    if (process.env.LADDER_V === '3' && t % (10 * TICKS_PER_SECOND) === 0) console.log(`      t=${s} ` + [...own()].filter((i) => typeOf(i) !== 'recon_drone').map((i) => `${typeOf(i).slice(0, 5)}(${(sim.state.posX[i] / 65536).toFixed(0)},${(sim.state.posY[i] / 65536).toFixed(0)})`).join(' '));
    runtime.step(sim.tick());
    if (runtime.result !== 'ongoing') break;
  }
  if (process.env.LADDER_V) console.log(`    ${id} ${tier} seed ${seed}: ${runtime.result} ${runtime.objectiveList.map((o) => `${o.id}=${o.status[0]}`).join(' ')}`);
  if (process.env.LADDER_V === '2') console.log(`      demo alive ${[...demo].filter((i) => sim.state.alive[i] === 1).length}/${demo.size}; structures in raze zone ${razeZone ? structsIn(razeZone).length : '-'}; own ${own().length}/${start0}`);
  return { result: runtime.result, mins: t / TICKS_PER_SECOND / 60, lost: start0 - own().length, roe: runtime.roeScore };
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
