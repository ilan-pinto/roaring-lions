/* eslint-disable @typescript-eslint/no-explicit-any -- reads mission/map JSON by shape, tree-agnostic on purpose */
// Plan ladder for Tel Marum I-III (GH-382): passive / naive / sensible over many seeds.
//
//   npx tsx tools/src/backtest/tm_ladder.ts [seeds=12] [mission-id ...]
//
// Same idea as qh_ladder.ts: the plans are written against MARKERS AND ZONES, never coordinates, so
// ONE script runs on the old ground (copies of `tel_marum`) and the new, which is what makes a
// before/after table honest. The scripted plans in playtest.ts are the optimal rung and are tied to
// coordinates, so they are not on this ladder.
//
//   passive  - no orders.
//   naive    - one attackMove of the whole force to the mission's focus at t=0, never re-issued.
//   sensible - what a player who read the briefing would do:
//     I   armour and foot park in the hollow, the drone shepherds the herders on its way to the
//         west post, then stands off the battery (`drone_standoff` where the map has one);
//     II  armour, AT and the mortar take the approach, the demolition party goes to the cache, the
//         foot climbs to the west overwatch;
//     III the mortar, AT and foot park in the hollow and the mortar kills the west observer, armour
//         takes the wide saddle in two arms, then everything goes through the pass to the battery.
// A fresh ledger, no purchases, 12 minute cap.
import { fx } from '../../../packages/sim/src/fixed';
import { TICKS_PER_SECOND } from '../../../packages/sim/src/sim';
import { readFileSync } from 'node:fs';
import { ROOT, makeWorld, idsOf } from '../walk_world';

type Tier = 'passive' | 'naive' | 'sensible';
const seedsN = Number(process.argv[2] ?? 12);
const only = process.argv.slice(3);
const MISSIONS = only.length > 0 ? only : ['tel_marum_1_recon', 'tel_marum_2_foothold', 'tel_marum_3_clearance'];
const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });
const CAP_TICKS = 12 * 60 * TICKS_PER_SECOND;

function run(id: string, tier: Tier, seed: number): { result: string; mins: number; lost: number; roe: number } {
  const w = makeWorld(id, { seed });
  const { sim, runtime, mission } = w;
  const m: any = mission;
  const map = JSON.parse(readFileSync(`${ROOT}/data/maps/${m.map.file}.json`, 'utf8'));
  const mk = (n: string, fallback?: [number, number]): [number, number] => map.markers[n] ?? fallback ?? map.markers.approach;
  const zc = (n: string): [number, number] => {
    const z = map.zones[n] as number[];
    return [z[0] + Math.floor(z[2] / 2), z[1] + Math.floor(z[3] / 2)];
  };
  const own = () => idsOf(sim, 0);
  const typeOf = (i: number) => w.nameOf.get(sim.state.typeIdx[i]) ?? '';
  const ofType = (...t: string[]) => own().filter((i) => t.includes(typeOf(i)));
  const start0 = own().length;
  const kind = id.includes('recon') ? 'I' : id.includes('foothold') ? 'II' : 'III';
  const go = (ids: number[], p: [number, number]) => {
    const live = ids.filter((i) => sim.state.alive[i] === 1);
    if (live.length) sim.queueCommand({ kind: 'attackMove', ids: live, ...M(p[0], p[1]) });
  };
  const walk = (ids: number[], p: [number, number]) => {
    const live = ids.filter((i) => sim.state.alive[i] === 1);
    if (live.length) sim.queueCommand({ kind: 'move', ids: live, ...M(p[0], p[1]) });
  };
  const focus: [number, number] = kind === 'I' ? mk('approach') : kind === 'II' ? zc('approach') : mk('pass');
  const inf = ofType('inf_squad');
  const drone = ofType('recon_drone');
  const hollow = mk('hollow');
  let t = 0;
  for (; t < CAP_TICKS; t++) {
    const s = t / TICKS_PER_SECOND;
    if (tier === 'naive' && t === 0) go(own(), focus);
    if (tier === 'sensible') {
      if (kind === 'I') {
        // The body parks at the hollow; the drone shepherds the herders from the approach, then
        // flies the flank to a standoff point (`drone_1..3` and `drone_standoff` where the map has
        // them, the old west-side waypoints where it does not) and lingers at each.
        const body = own().filter((i) => !drone.includes(i));
        if (t === 1) {
          walk(body, hollow);
          walk(drone, mk('drone_0', [24, 25]));
        }
        // The drone lingers at the approach for 30 s (the new valley's spotter reads slowly, 12.7 tiles
        // out) on EVERY ground, old and new, so the tier is the same instrument on both.
        const when = [34, 44, 50, 58];
        if (s === when[0]) walk(drone, mk('drone_1', [16, 27]));
        if (s === when[1]) walk(drone, mk('drone_2', [11, 22]));
        if (s === when[2]) walk(drone, mk('drone_3', [11, 12]));
        if (s === when[3]) walk(drone, mk('drone_standoff', [15, 8]));
      } else if (kind === 'II') {
        const armour = ofType('mbt_lavi', 'apc_eitan', 'at_team', 'mortar_team');
        if (t === 1) {
          walk(armour, mk('approach'));
          walk(ofType('demo_squad'), zc('ammo_draw'));
        }
        if (s === 20) go(inf, mk('approach'));
        if (s === 60) go(inf, mk('overwatch_west'));
        if (s === 100) go(ofType('mbt_lavi'), zc('ammo_draw'));
      } else {
        // The column stages at the hollow, two Lavis go through the pass alone (they outrange
        // the pockets), the rest follow, and ONE Eitan collects the families and takes them to
        // the approach.
        const tanks = ofType('mbt_lavi');
        const apc = ofType('apc_eitan');
        const rest = own().filter((i) => !tanks.includes(i) && !apc.includes(i) && !drone.includes(i));
        const civAt: [number, number] = m.civilians?.groups?.[0]?.at ?? mk('town_edge');
        if (t === 2 * TICKS_PER_SECOND) walk([...tanks, ...apc, ...rest], hollow);
        if (s === 40) go(tanks, mk('saddle_wide'));
        if (s === 62) walk(tanks, mk('pass'));
        if (s === 80) walk([...apc, ...rest], mk('saddle_wide'));
        if (s === 100) {
          walk(rest, mk('pass'));
          walk(apc, [Math.floor(civAt[0]), Math.floor(civAt[1])]);
        }
        if (s === 115) walk(apc, mk('approach'));
        if (s >= 150 && t % (30 * TICKS_PER_SECOND) === 0) go(tanks, mk('battery_position'));
      }
    }
    if (process.env.LADDER_V === '3' && t % (10 * TICKS_PER_SECOND) === 0) console.log(`      t=${s} ` + [...own()].filter((i) => typeOf(i) !== 'recon_drone').map((i) => `${typeOf(i).slice(0, 5)}(${(sim.state.posX[i] / 65536).toFixed(0)},${(sim.state.posY[i] / 65536).toFixed(0)})`).join(' '));
    runtime.step(sim.tick());
    if (runtime.result !== 'ongoing') break;
  }
  if (process.env.LADDER_V) console.log(`    ${id} ${tier} seed ${seed}: ${runtime.result} ${runtime.objectiveList.map((o) => `${o.id}=${o.status[0]}`).join(' ')} left ${own().map((i) => typeOf(i).slice(0, 5)).join(',')}`);
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
