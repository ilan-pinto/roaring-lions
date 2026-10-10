/* eslint-disable @typescript-eslint/no-explicit-any -- reads mission/map JSON by shape, tree-agnostic on purpose */
// Plan ladder for Deir Amun II-III (GH-382): passive / naive / sensible over many seeds.
//
//   npx tsx tools/src/backtest/da_ladder.ts [seeds=12] [mission-id ...]
//
// Same idea as uz_ladder.ts: the plans are written against MARKERS, ZONES AND THE MAP'S OWN
// TUNNEL LIST, never coordinates, so ONE script runs on the old ground and the new, and that is
// what makes a before/after table honest. Run it in both trees and diff.
//
//   passive  - no orders.
//   naive    - one attackMove of the whole force to the mission's focus at t=0, never re-issued.
//   sensible - what a player who read the briefing would do, re-anchored every 45 s:
//     II  the hold force walks to the yard floor, both Yahalom teams walk to the mouth of the route
//         whose mouth is inside the objective's zone and charge it, then come home; the mortar and
//         the drone stay back;
//     III each Yahalom team takes two of the routes (mouths in the objective zone, in the map's own
//         order), charging from the mouth with an escort; the heavy force walks to the spoil field.
//
// A fresh ledger, no purchases, no `upgrades_to` gates open, 12 minute cap.
import { fx } from '../../../packages/sim/src/fixed';
import { TICKS_PER_SECOND } from '../../../packages/sim/src/sim';
import { readFileSync } from 'node:fs';
import { ROOT, makeWorld, idsOf } from '../walk_world';

type Tier = 'passive' | 'naive' | 'sensible';
const seedsN = Number(process.argv[2] ?? 12);
const only = process.argv.slice(3);
const MISSIONS = only.length > 0 ? only : ['deir_amun_2_foothold', 'deir_amun_3_subterranean'];
const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });
const CAP_TICKS = 12 * 60 * TICKS_PER_SECOND;

function run(id: string, tier: Tier, seed: number): { result: string; mins: number; lost: number; roe: number } {
  const w = makeWorld(id, { seed });
  const { sim, runtime, mission } = w;
  const m: any = mission;
  const map = JSON.parse(readFileSync(`${ROOT}/data/maps/${m.map.file}.json`, 'utf8'));
  const mk = (n: string): [number, number] => map.markers[n];
  const own = () => idsOf(sim, 0);
  const typeOf = (i: number) => w.nameOf.get(sim.state.typeIdx[i]) ?? '';
  const ofType = (...t: string[]) => own().filter((i) => t.includes(typeOf(i)));
  const start0 = own().length;
  const kind = id.includes('2_') ? 'II' : 'III';
  const go = (ids: number[], p: [number, number]) => {
    const live = ids.filter((i) => sim.state.alive[i] === 1);
    if (live.length) sim.queueCommand({ kind: 'attackMove', ids: live, ...M(p[0], p[1]) });
  };
  const walk = (ids: number[], p: [number, number]) => {
    const live = ids.filter((i) => sim.state.alive[i] === 1);
    if (live.length) sim.queueCommand({ kind: 'move', ids: live, ...M(p[0], p[1]) });
  };
  const collapseObj = m.objectives.find((o: any) => o.type === 'collapse' && o.primary);
  const cz = map.zones[collapseObj.target] as number[];
  const routes: { idx: number; mouth: [number, number] }[] = (map.tunnels as any[])
    .map((t, idx) => ({ idx, mouth: t.mouth as [number, number] }))
    .filter((r) => r.mouth[0] >= cz[0] && r.mouth[0] < cz[0] + cz[2] && r.mouth[1] >= cz[1] && r.mouth[1] < cz[1] + cz[3]);
  const yahalom = ofType('yahalom_squad');
  const drone = ofType('recon_drone');
  const mortar = ofType('mortar_team');
  const main = () => own().filter((i) => !yahalom.includes(i) && !drone.includes(i) && !mortar.includes(i));
  const inf = ofType('inf_squad');
  const eitan = ofType('apc_eitan');
  const heavy = [...ofType('ifv_namer', 'mbt_lavi', 'at_team')];
  const focus: [number, number] = kind === 'II' ? mk('pump_gate') : mk('spoil_field_centre');

  // A demolition crew works its routes in order: walk to the mouth (escort beside it), charge once
  // within two and a half tiles (or after 45 s of trying), wait for the route to come down (or 60 s), then the next. Written as a state
  // machine on the map's own geometry so the same script is honest on both grounds.
  const state = new Map<number, { k: number; phase: 'go' | 'charge'; since: number }>();
  const crew = (team: number[], rs: { idx: number; mouth: [number, number] }[], _x: number, esc: number[] = []) => {
    const key = team[0];
    const live = team.filter((i) => sim.state.alive[i] === 1);
    if (!live.length) return;
    let st = state.get(key);
    if (!st) { st = { k: 0, phase: 'go', since: t }; state.set(key, st); }
    if (st.k >= rs.length) return;
    const r = rs[st.k];
    if (st.phase === 'go') {
      if (t === st.since || t % (10 * TICKS_PER_SECOND) === 0) { walk(live, r.mouth); if (esc.length) go(esc, r.mouth); }
      const px = Number(sim.state.posX[live[0]]) / 65536, py = Number(sim.state.posY[live[0]]) / 65536;
      if (Math.hypot(px - r.mouth[0], py - r.mouth[1]) <= 2.5 || t - st.since > 45 * TICKS_PER_SECOND) {
        sim.queueCommand({ kind: 'chargeTunnel', ids: live, tunnel: r.idx });
        st.phase = 'charge'; st.since = t;
      }
    } else if (sim.tnAlive[r.idx] === 0 || t - st.since > 60 * TICKS_PER_SECOND) {
      st.k++; st.phase = 'go'; st.since = t;
    }
  };
  let t = 0;
  for (; t < CAP_TICKS; t++) {
    const s = t / TICKS_PER_SECOND;
    if (tier === 'naive' && t === 0) go(own(), focus);
    if (tier === 'sensible') {
      if (kind === 'II') {
        if (t === 1) { go(main(), mk('pump_gate')); walk(drone, mk('pump_gate')); walk(mortar, mk('da_start')); }
        crew(yahalom, [routes[0]], 1);
        if (s > 45 && t % (45 * TICKS_PER_SECOND) === 0) go(main(), mk('pump_gate'));
      } else {
        const west = [yahalom[0]];
        const east = [yahalom[1]];
        const wEsc = [inf[0], inf[1], eitan[0]];
        const eEsc = [inf[2], inf[3], eitan[1]];
        if (t === 1) { go(heavy, mk('spoil_field_centre')); walk(drone, mk('spoil_field_centre')); walk(mortar, mk('da_start')); }
        crew(west, [routes[0], routes[1]], 0, wEsc);
        crew(east, [routes[2], routes[3]], 0, eEsc);
        if (s > 90 && t % (45 * TICKS_PER_SECOND) === 0) go(heavy, mk('spoil_field_centre'));
      }
    }
    runtime.step(sim.tick());
    if (process.env.LADDER_D && t % (20 * TICKS_PER_SECOND) === 0) console.log(`      t=${t / TICKS_PER_SECOND} ${runtime.objectiveList.map((o: any) => `${o.id}=${o.status[0]}${o.paused ? '(' + o.paused + ')' : ''}${o.holdTicks ?? ''}`).join(' ')} own=${own().length}`);
    if (runtime.result !== 'ongoing') break;
  }
  if (process.env.LADDER_V) console.log(`    ${id} ${tier} seed ${seed}: ${runtime.result} ${runtime.objectiveList.map((o) => `${o.id}=${o.status[0]}`).join(' ')}`);
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
